/**
 * dsh-plan-tasks — Client 半边
 *
 * 在 dsh-better-sidebar 的右侧栏注册「任务列表」页签，读取项目根目录的
 * `.plan/plan.json` 渲染成互斥手风琴。所有文件读写都走 Host 半边的
 * `/plan-tasks/api/*` 路由（同源 XHR），因此不依赖 better-sidebar 的内部 API。
 *
 * betterSidebar 是可选依赖：绝不能放进 exports.inject，否则未安装它时
 * cordis fiber 会一直 pending（web boot 报 entry did not activate）。
 *
 * id 必须等于 package.json 的 name。浏览器按包名找工厂，短名对不上时
 * 预加载登记一次、正式启动再拉同一份脚本，就会报 duplicate factory，
 * 整页 web boot 起不来。
 */
window.__ModuleLoader__.load({
  id: '@chengfa/dsh-plan-tasks',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const API_BASE = '/plan-tasks/api/'
    const TAB_ID = 'plan-tasks'
    // 自动刷新间隔（秒）：统一 5 秒。空闲时不必更快，执行中也够跟上模型写盘的节奏。
    // 这是面板看见模型进度的唯一周期读盘（见 60-tab.js 里那段「维护须知」）。
    // AUTO_INTERVAL_RUNNING 保留成独立常量：将来想「执行中更快」只改这里，不动逻辑。
    const AUTO_INTERVAL = 5
    const AUTO_INTERVAL_RUNNING = 5
    // 定时器检查粒度（毫秒）。刷新由 deadline 判断、倒计时只是它的展示，
    // 这样定时器抖动 / 页面节流都不会让刷新「卡在 1s 不执行」（旧实现依赖倒计时归零）。
    const AUTO_TICK_MS = 250
    // 顶部行内提示（提交 / 审核 / 删除 / 拖拽保存的结果）的默认停留时长（id=222）。
    // 原来是 2600ms 的裸数字写在 setTimeout 里：短反馈（「顺序已保存」五个字）
    // 刚看清就没了，所以统一抬到 3.8 秒。只控制自动隐藏，不参与动画与刷新计时。
    const NOTICE_MS = 3800
    // 组头条数统计的位数（id=337）：固定三位，1234 条就显示 1234（不截断）。
    // 补零不是为了好看 —— 数字位数变化会让组头右边界跟着抖，三位之后才稳定。
    const GROUP_COUNT_DIGITS = 3
    const padCount = (n) => {
      const num = Number(n)
      const text = Number.isFinite(num) && num >= 0 ? String(Math.trunc(num)) : '0'
      return text.length >= GROUP_COUNT_DIGITS ? text : '0'.repeat(GROUP_COUNT_DIGITS - text.length) + text
    }
    /**
     * 按字符数截断标题，超出补省略号（id=352）。
     * 用 Array.from 而不是 slice：中文按码点算，emoji / 生僻字不会被切成半个。
     * limit 非法（<= 0 / 非数字）时原样返回 —— 宁可长，也不要把标题整个吞掉。
     */
    const clipName = (text, limit) => {
      const chars = Array.from(String(text ?? ''))
      if (!Number.isFinite(limit) || limit <= 0 || chars.length <= limit) return String(text ?? '')
      return chars.slice(0, limit).join('') + '…'
    }
    /**
     * 待执行列表里标题最多显示多少个字（id=352）。
     *
     * 待执行是唯一会堆很多行的一栏，标题一长就把「N 条 / 耗时 / 按钮」挤到看不见。
     * 这里按**字符数**截，不靠 CSS 的 ellipsis 兜底：CSS 截断的宽度随面板宽度变，
     * 窄侧栏里可能只剩三四个字，宽侧栏里又能显示一整行 —— 同一批条目看起来长短不一。
     * 按字数截之后，无论侧栏多宽，标题的「信息量」是一致的。
     *
     * 只作用于待执行（groupKey === 'todo'）：待审核 / 已审核 / 草稿要能一眼看清全称
     * （那些是已经做完或即将执行的东西，用户在核对内容，不是快速扫队列）。
     */
    const TODO_NAME_MAX = 14
    // 少数提示要更久的阅读时间（id=223）：拆分完成那条会带上「建议砍掉哪些、模型提到了
    // 哪些不存在的文件」这类附加信息，实测能到 79 个字，3.8 秒读不完。只在那个调用处
    // 显式传这个时长，其余提示仍走 NOTICE_MS —— 不整体拉长，短反馈才不会赖着不走。
    const NOTICE_LONG_MS = 5200
    // 「开始干活」按钮上的字。真正发进会话的是队首任务的派发正文，不是这四个字。
    const KICKOFF_TEXT = '开始干活'
    // 会话从「在跑」翻成「停」之后，等多久再回读 plan.json 判定这一轮是不是断了（id=234）。
    // 不能一翻就判：模型收尾时是先写盘、再结束 turn，但客户端拿到的 running=false
    // 经由 remote 事件推过来，可能比文件落盘早一点点。留 1 秒足够覆盖这个窗口，
    // 又不会让用户盯着「执行中」发愣 —— 判完之后界面立刻改口。
    const INTERRUPT_SETTLE_MS = 1000
    // 一轮回答结束后，等多久再派发下一条（id=341）。
    // 只留一点空档，让 running 的抖动先落定。中断对账（INTERRUPT_SETTLE_MS）若还在飞，
    // 派发 effect 会等到 reconcilingRef 落下再发，不必在这里固定多等 1.6 秒。
    /**
     * 客户端中断对账的宽限（id=352-E）：有 startedAt 但没产出的条目，至少要过这么久
     * 才判成「已中断」。刚派出去的那条此刻正好符合「有 startedAt、没产出」，
     * 立刻判会把它打成孤儿（页面刷新触发的首次对账尤其容易踩到）。
     * 宿主侧另有 30 分钟的回收阀（orphan.js），这里只是兜住「宿主那份没跑到」。
     */
    const ORPHAN_CLIENT_GRACE_MS = 2 * 60 * 1000
    const DISPATCH_SETTLE_MS = 1200
    // 队首已派发但 done 还没落盘时，不要当成「队列空了」也不要跳到后面的条目。
    // 短重试几次，盖住「回答已经结束、q.mjs 刚写完」的窗口。
    const DISPATCH_INFLIGHT_RETRIES = 4
    const DISPATCH_INFLIGHT_GAP_MS = 700
    // 「发送中…」「暂停中」这类一次点击的标记，最多挂这么久就必须让位（id=235）。
    // 正常回包会在 finally 里立刻清掉，这个上限只兜住「回包丢了 / 请求被吞了」的情况：
    // 标记不放手，顶栏会一直显示那句文案，而模型其实早就在干活（或早就停了）。
    // 比请求超时（call 默认 120s）短得多 —— 卡住时宁可先让界面回到「干活中 / 空闲」。
    const ACTION_STALL_MS = 15000
    /**
     * 「完成后暂停」复位前的空闲宽限（id=378）。
     *
     * 会话的 running 会在**工具调用之间**短暂变 false（id=341 的注释里已经记过这件事，
     * 派发逻辑为此专门用 dispatchedRef 挡连派）。如果一看到空闲就把开关复位，
     * 一条要跑十几步工具的任务会在第二个工具调用处被悄悄清掉 ——
     * 用户明明开着「完成后暂停」，它却在半路自己关了。
     *
     * 所以要求「连续空闲满这么久」才复位。取值比派发空档（DISPATCH_SETTLE_MS 1.2s）
     * 再长一档：既然派发自己都要等 1.2s 才敢判定「这一轮真结束了」，
     * 复位这个更不可逆的动作（用户可能已经忘了自己开过）就该等得更确定。
     * 代价是任务真结束后开关还会多挂 2.5 秒 —— 那期间它显示的仍是「继续执行」，
     * 只是仍占着位置，不影响正确性。
     */
    const PAUSE_RESET_IDLE_MS = 2500
    // id=379：PAUSE_RESET_IDLE_MS **必须大于** DISPATCH_SETTLE_MS。
    //
    // 顺序是承重的：任务结束那一刻，派发 effect 先等 DISPATCH_SETTLE_MS 再去读
    // 「完成后暂停」闸门；若复位定时器比它更早到点，闸门读到的就已经是 false ——
    // 开关形同虚设，下一条照派，而且症状极隐蔽（用户看到的是「开关自己关了」）。
    // 所以两者必须满足 复位宽限 > 派发空档。scripts 里的断言会锁住这个不等式，
    // 改任何一个数而破坏它都会被拦下。

    // 模型目录的「就绪等待」（id=364）。
    //
    // 场景：面板刚挂载，初始化那几个请求还在飞，用户已经点了「拆解」。
    // 这时本地快照里 selection 还是 null —— 但那是「还没回来」，不是「没有模型」。
    // 直接拦就是那个「第一次点被拦、过两秒再点就好了」的坑。
    //
    // 所以校验时最多问 3 次：第一次立即发（可能正好接上初始化那次在飞里的请求），
    // 之后两次各等 500ms，总共约 1 秒 —— 够一次本地 HTTP 往返。
    // 再多就是真没有，拖下去只会让用户干等。
    // 次数与间隔都写成常量而不是内联数字，是为了让调这两个值时能一眼看到它们是一对。
    const MODEL_READY_ATTEMPTS = 3
    const MODEL_READY_GAP_MS = 500

    /** 图标底色：稳定的品牌蓝。取 static 层 token，主题包不会改写它。 */
    const ICON_BLUE = 'var(--dsw-static-deepseek-500, #4176e6)'
