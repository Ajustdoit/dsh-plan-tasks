// 本文件由 build.mjs 从 src/client/*.js 生成，请勿直接修改。
// 改逻辑请改 src/client/ 下的片段，然后 node build.mjs。
// 改样式请改 src/styles/*.css，然后 node build.mjs。
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
     * 只作用于待执行（groupKey === 'todo'）：待审核 / 已审核要能一眼看清全称
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

    // id=71-D：ICON_BLUE 常量已删除 —— 图标颜色改由 CSS 类 .plt-ico-brand 承担，
    // 走同一个 static 层 token，不再需要 JS 侧的字符串中转。


    /**
     * 任务 id 的生成与校验（id=77-A）—— **客户端内联版**。
     *
     * 这份实现与 `lib/host/taskid.js` 的**函数体逐字相同**，由
     * `scripts/check-taskid-parity.mjs` 守着（不一致就让 npm test 失败）。
     *
     * 为什么不能直接 import：
     * 客户端半边是一个工厂函数体，片段共享同一作用域且**禁止 import/export**
     * （build.mjs 会直接把带 import 的片段拦下来）。所以只能内联。
     *
     * 为什么不干脆只在客户端写一份、Node 那边抄：
     * 那会得到两份会各自漂移的实现 —— 而 id 的字符集/长度一旦两边不一致，
     * 前端认为合法的 id 后端会拒绝（或反过来），表现为「新建的任务打不开」。
     * 所以选了「一份权威实现 + 一份内联副本 + 自动比对」。
     */

    /** 字符集：小写字母 + 大写字母 + 数字。顺序固定，改动会让「同随机序列 → 同 id」失效。 */
    const TASK_ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

    /** 长度：恰好 6 位。 */
    const TASK_ID_LENGTH = 6

    /**
     * 默认随机源：返回 [0,1) 的浮点数。
     *
     * 用 `getRandomValues` 取 4 字节转成 [0,1)，而不是取 1 字节 —— 后者只有 256 档，
     * 映射到 62 个字符上分布会不均（`256 % 62 = 8`，前 8 个字符会多出约 3% 的概率）。
     * 4 字节有 2^32 档，偏差小到可以忽略。
     *
     * @returns {() => number} 无参函数，每次调用返回 [0,1)
     */
    function defaultRandom() {
      const g = globalThis.crypto
      if (g !== undefined && typeof g.getRandomValues === 'function') {
        return () => {
          const buf = new Uint32Array(1)
          g.getRandomValues(buf)
          // 除以 2^32 得到 [0,1)
          return buf[0] / 4294967296
        }
      }
      // Node 的 crypto 模块（老版本没有 globalThis.crypto）
      try {
        // 动态引入会让本函数变成 async，破坏「同步生成」的契约，
        // 所以只在需要时尝试同步 require —— Node 的 CJS 环境里可用。
        const nodeCrypto = globalThis.require?.('node:crypto') ?? globalThis.require?.('crypto')
        if (nodeCrypto !== undefined && typeof nodeCrypto.randomBytes === 'function') {
          return () => nodeCrypto.randomBytes(4).readUInt32BE(0) / 4294967296
        }
      } catch {
        /* 落到下面的抛错 */
      }
      throw new Error('makeId: 找不到可用的加密随机源（crypto.getRandomValues 或 crypto.randomBytes）')
    }

    /**
     * 生成一个 6 位任务 id。
     *
     * @param {() => number} [random] 随机源，返回 [0,1)；默认用加密随机
     * @returns {string} 形如 `"aB3xK9"` 的 6 位字符串
     * @throws 随机源缺失，或注入的函数返回了非法值
     */
    function makeId(random = defaultRandom()) {
      if (typeof random !== 'function') {
        throw new TypeError('makeId: random 必须是返回 [0,1) 的函数')
      }
      let out = ''
      for (let i = 0; i < TASK_ID_LENGTH; i += 1) {
        const r = random()
        if (typeof r !== 'number' || !Number.isFinite(r) || r < 0 || r >= 1) {
          throw new RangeError(`makeId: 随机源返回了非法值 ${String(r)}（要求 [0,1)）`)
        }
        // floor(r * 62) 落在 0..61；r < 1 保证不会越界
        out += TASK_ID_ALPHABET.charAt(Math.floor(r * TASK_ID_ALPHABET.length))
      }
      return out
    }

    /**
     * 校验一个值是否是可用的任务 id：**恰好 6 位、只含 0-9A-Za-z**。
     *
     * 刻意不接受数字 id（历史数据里的 `12`、`12-A`）—— 那是 `ids.js` 的
     * `isChildId` / `codeOf` 管的领域。本函数只回答「这能不能当新 id 用」。
     *
     * @param {unknown} value
     * @returns {boolean}
     *
     * @public —— 本步（77-A）只要求模块导出这个函数，实际调用在 77-B 接上。
     * 标记 @public 让 `unused-decls.mjs` 跳过「暂未引用」告警，
     * 而不是去写一个假装在用它的占位调用。
     */
    function isTaskId(value) {
      return typeof value === 'string' && new RegExp(`^[0-9A-Za-z]{${TASK_ID_LENGTH}}$`).test(value)
    }


    /**
     * 页签图标：蓝色清单 + 勾选。
     * 网格换成 16×16 并画满 1..15（原来 64 网格里只占 81%，14px 下看着比
     * 「任务管理」「文件」这些内置 codicon 小一圈），现在同样 size 下视觉尺寸对齐。
     *
     * 底色不用 --dsw-alias-brand-primary：alias 层会被主题包改写，装了
     * dsh-official-homepage-theme 之后它变成 #f3f8ff（近白），白底 + 白勾
     * 就糊成一坨白。改用 static 层 --dsw-static-deepseek-500（#4176e6）并写死
     * 兜底色，保证任何主题下都是明显的蓝底白字。
     */
    function PlanIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 14
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          role: 'img',
          'aria-label': '任务列表',
          className: 'plt-ico plt-ico-fixed plt-ico-brand',
        },
        h('rect', {
          x: 1,
          y: 1,
          width: 14,
          height: 14,
          rx: 3.2,
          fill: 'currentColor',
        }),
        h('path', {
          d: 'M3.6 6l1.2 1.2 2.1-2.45',
          fill: 'none',
          stroke: '#fff',
          strokeWidth: 1.35,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M3.6 10.45l1.2 1.2 2.1-2.45',
          fill: 'none',
          stroke: '#fff',
          strokeWidth: 1.35,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          opacity: 0.72,
        }),
        h('path', {
          d: 'M8.4 5.6h4.1M8.4 10.05h4.1',
          fill: 'none',
          stroke: '#fff',
          strokeWidth: 1.35,
          strokeLinecap: 'round',
          opacity: 0.92,
        }),
      )
    }

    /** 发送按钮图标：向上的箭头（Cursor 风格发送键）。 */
    function SendIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 15
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          role: 'img',
          'aria-label': '提交',
          className: 'plt-ico',
        },
        h('path', {
          d: 'M12 19V5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2.4,
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M5.5 11.5L12 5l6.5 6.5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /** 深入按钮图标：三条横线（层层深入）+ 一条向下的箭头穿过它们。 */
    function DeepIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 15
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          role: 'img',
          'aria-label': '深入',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          className: 'plt-ico',
        },
        h('path', { d: 'M4 7h16' }),
        h('path', { d: 'M6.5 12h11' }),
        h('path', { d: 'M9 17h6' }),
        h('path', { d: 'M12 4.5v7.5' }),
        h('path', { d: 'M9.6 9.6L12 12l2.4-2.4' }),
      )
    }

    /** 拆解按钮图标：一个方块向下分出三条支线，像把一件事拆成几条。 */
    function SplitIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 15
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          role: 'img',
          'aria-label': '拆解',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          className: 'plt-ico',
        },
        h('path', { d: 'M12 3v4' }),
        h('path', { d: 'M12 7H5.5v3.2' }),
        h('path', { d: 'M12 7h6.5v3.2' }),
        h('path', { d: 'M12 7v3.2' }),
        h('rect', { x: '3', y: '10.2', width: '5', height: '4.2', rx: '1.2' }),
        h('rect', { x: '9.5', y: '10.2', width: '5', height: '4.2', rx: '1.2' }),
        h('rect', { x: '16', y: '10.2', width: '5', height: '4.2', rx: '1.2' }),
        h('path', { d: 'M5.5 14.4v2.4M12 14.4v2.4M18.5 14.4v2.4' }),
      )
    }

    /** 任务类型胶囊里的小图标：仅回答=对话气泡，目标=靶心，修改=铅笔。 */
    function ModeIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 12
      const kind = props?.kind ?? '目标'
      const common = {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.9,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        className: 'plt-ico',
      }
      if (kind === '仅回答') {
        // 对话气泡 + 里面的点
        return h(
          'svg',
          common,
          h('path', { d: 'M20 12.5a7.5 7.5 0 0 1-7.5 7.5H7l-3.5 2.2V12.5A7.5 7.5 0 0 1 11 5h1.5A7.5 7.5 0 0 1 20 12.5z' }),
          h('path', { d: 'M9 12h.01M12.5 12h.01M16 12h.01' }),
        )
      }
      if (kind === '修改') {
        // 铅笔
        return h(
          'svg',
          common,
          h('path', { d: 'M4 20h4.2L20.1 8.1a2.1 2.1 0 0 0 0-3L19 4a2.1 2.1 0 0 0-3 0L4.1 15.9 4 20z' }),
          h('path', { d: 'M14.5 5.5l4 4' }),
        )
      }
      // 目标：靶心
      return h(
        'svg',
        common,
        h('circle', { cx: 12, cy: 12, r: 8.2 }),
        h('circle', { cx: 12, cy: 12, r: 4.4 }),
        h('circle', { cx: 12, cy: 12, r: 1.1, fill: 'currentColor', stroke: 'none' }),
      )
    }

    /** 空组里的占位图标：虚线条目框 + 中间一道横线，跟列表图形一个家族。 */
    function EmptyIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 22
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          className: 'plt-ico',
        },
        h('rect', { x: 3.2, y: 4.6, width: 17.6, height: 14.8, rx: 3, strokeDasharray: '3 2.6' }),
        h('path', { d: 'M8 10.5h8M8 14h5' }),
      )
    }

    /** 线段风格的展开箭头（不用实心三角形）。 */
    function CaretIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 12
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          className: 'plt-ico',
        },
        h('path', { d: 'M9 5.5 15.5 12 9 18.5' }),
      )
    }

    /** 复制图标：两张叠在一起的纸，和常见编辑器一致。 */
    function CopyIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 12
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          className: 'plt-ico plt-ico-fixed',
        },
        h('rect', { x: 9, y: 9, width: 12, height: 12, rx: 2.4 }),
        h('path', { d: 'M5.6 15H4.4A2.4 2.4 0 0 1 2 12.6V4.4A2.4 2.4 0 0 1 4.4 2h8.2A2.4 2.4 0 0 1 15 4.4v1.2' }),
      )
    }

    /**
     * 对勾图标（id=382）：待审核条目操作区里的「通过」。
     *
     * 与 TrashIcon 成对：两者尺寸相同、线稿风格相同（viewBox 24、stroke 2、圆角端点），
     * 所以同一排里并排放着时视觉重量一致 —— 这正是一条任务要求的
     * 「图标风格、尺寸、颜色、hover/禁用态与垃圾桶一致」。
     * 颜色走 currentColor：深/浅两套主题由 .plt-pass-icon 的规则决定，图标本身不管配色。
     * 尺寸默认 13，与 TrashIcon 的默认值一致（不是巧合 —— 两者要并排对齐）。
     */
    function CheckIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 13
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          className: 'plt-ico plt-ico-fixed',
        },
        // 一个略带起伏的长勾：起笔在左下、转折在中下、收笔在右上。
        // 只画一条路径而不是「圆底 + 勾」—— 圆底在 13px 下会被糊成一坨。
        h('path', { d: 'M20 6.5L9.4 17.1a1.2 1.2 0 0 1-1.7 0L3.6 13' }),
      )
    }

    /**
     * 垃圾桶图标（id=353）：待执行条目操作区里的「删除这一条」。
     *
     * 线稿风格与 CopyIcon / PinTopIcon 一脉相承（viewBox 24、stroke 2、圆角端点），
     * 颜色走 currentColor —— 深色主题下不需要单独换色，浅色主题由 .plt-actions 的颜色决定。
     * 尺寸默认 13（与相邻按钮的文字行高 20px 视觉齐平），不参与基线对齐。
     */
    function TrashIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 13
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          className: 'plt-ico plt-ico-fixed',
        },
        // 桶盖：顶盖 + 提手
        h('path', { d: 'M4 6.5h16' }),
        h('path', { d: 'M9.5 6.5V4.6a1.1 1.1 0 0 1 1.1-1.1h2.8a1.1 1.1 0 0 1 1.1 1.1v1.9' }),
        // 桶身：上宽下窄的梯形
        h('path', { d: 'M6.2 6.5l1 13.1a1.6 1.6 0 0 0 1.6 1.4h6.4a1.6 1.6 0 0 0 1.6-1.4l1-13.1' }),
        // 两道竖纹
        h('path', { d: 'M10.2 10.4v7' }),
        h('path', { d: 'M13.8 10.4v7' }),
      )
    }

    /** 置顶图标：一根竖线 + 向上的箭头，表示「排到最前面」。 */
    function PinTopIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 12
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          className: 'plt-ico plt-ico-fixed',
        },
        h('path', { d: 'M12 19V6' }),
        h('path', { d: 'M6.5 11.5 12 6l5.5 5.5' }),
        h('path', { d: 'M5 3.4h14' }),
      )
    }

    /**
     * 执行中用的转圈图标：一段圆弧匀速旋转，比文字更直观。
     *
     * 只保留「一直转」这一种形态：顶栏那颗手点「刷新」的按钮连同它的
     * spinning / idle 状态类已经移除（id=357），而它是唯一需要「由外层决定何时转」
     * 的调用点。留着 `spin` 参数只会是一个没人传的开关，读代码的人还得猜它什么时候会被用上。
     */
    function SpinnerIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 12
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2.6,
          strokeLinecap: 'round',
          'aria-hidden': 'true',
          // id=79-D：这里曾出现两个 className 键 —— 迁移时把原来的
          // `style:{display:'block',flex:'0 0 auto'}` 改成 className 后，
          // 与原有的 `className:'plt-spin'` 撞成重复键。JS 对象字面量里**后者胜**，
          // 于是 plt-spin 被静默丢弃，转圈图标完全不转（且不报任何错）。
          // 现在合并成一个：plt-spin 负责动画，plt-ico / plt-ico-fixed 负责基础形态。
          className: 'plt-spin plt-ico plt-ico-fixed',
        },
        h('path', { d: 'M12 3.2a8.8 8.8 0 1 1-8.8 8.8', opacity: 0.95 }),
      )
    }

    /**
     * 「开始」按钮的实心三角（id=207）：顶栏里与文字并排，沿用 SpinnerIcon 的约定 ——
     * 尺寸默认 12、颜色走 currentColor、display:block 不参与基线对齐。
     * 与其余图标唯一的差别是实心（fill）而不是线稿，14px 字号下这个形状更认得出。
     */
    function PlayIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 12
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'currentColor',
          stroke: 'none',
          'aria-hidden': 'true',
          className: 'plt-ico plt-ico-fixed',
        },
        h('path', { d: 'M8.5 4.8v14.4L20 12z' }),
      )
    }

    /**
     * 「暂停」按钮的两条竖线（id=207）：与 PlayIcon 配成一对，线稿风格与其余图标一致。
     * strokeWidth 取 3.2 —— 12px 下两根细线用 2.6 会糊成一坨，这个值刚好能分辨出两条。
     */
    function PauseIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 12
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 3.2,
          strokeLinecap: 'round',
          'aria-hidden': 'true',
          className: 'plt-ico plt-ico-fixed',
        },
        h('path', { d: 'M9 5v14' }),
        h('path', { d: 'M15 5v14' }),
      )
    }

/**
 * 序号派生（id=fzTvER-A）—— **与 `lib/host/order.js` 的 `sequenceOf` / `sequenceMapOf`
 * 保持逐字一致**。
 *
 * ── 为什么要复制一份 ──────────────────────────
 * 客户端片段只能 `require('react')`，无法 import 宿主的 `order.js`
 * （见 00-loader-head.js 的加载方式）。而任务要求「该函数作为唯一序号来源，
 * 供宿主接口与客户端渲染共用」——
 *
 * 在「不能跨端 import」的前提下，能做到的最接近的形式是：
 *   · 宿主那份是**权威实现**（`lib/host/order.js`）；
 *   · 这里这份是**镜像**，函数体逐字相同；
 *   · 用 `scripts/check-seq-parity.mjs` 做**一致性测试**：
 *     逐字比对两边的函数体，任何一边改了另一边没跟上就直接报错。
 *
 * 这比「两边各写一套、靠注释提醒」可靠：注释不会失败，测试会。
 *
 * ── 约定（与宿主那份完全相同）──────────────
 * 1. 不写回、不改 order；返回新数组
 * 2. order 缺失或相等时**保持入参顺序**（不二次排序）
 * 3. 跳过非对象元素，序号保持连续
 */

/** 派生序号：按入参顺序映射成 1 起序号。 */
function sequenceOf(items) {
  const out = []
  let seq = 0
  for (const item of Array.isArray(items) ? items : []) {
    if (item === null || typeof item !== 'object') continue
    seq += 1
    out.push({ id: item.id, seq })
  }
  return out
}

/** 便捷形态：直接返回「id → 序号」的 Map。 */
function sequenceMapOf(items) {
  const map = new Map()
  for (const { id, seq } of sequenceOf(items)) map.set(id, seq)
  return map
}


    /**
     * 直接在浏览器侧往当前会话发一条提示词（等价于用户自己敲）。
     * 走 Client 的 sessions 服务：beginSubmission 先登记本地回声（左侧对话立刻出现），
     * 再 prompt 真正发到 Host。这样不依赖 Host 是否已加载最新路由。
     * @returns true 表示已发出；false 表示这条路不可用，调用方可以回退到 Host 路由。
     */
    async function kickoffViaClient(ctx, sessionId, text) {
      if (typeof sessionId !== 'string' || sessionId === '') return false
      const sessions = ctx?.get?.('sessions')
      if (sessions === undefined || typeof sessions.binding !== 'function') return false
      // 优先借现成的绑定（侧边栏已经 retain 过当前会话）；没有就自己 retain 一次再放掉。
      let session = sessions.binding(sessionId)?.session
      let owned = null
      if (session === undefined && typeof sessions.retain === 'function') {
        try {
          owned = sessions.retain({ sessionId }, { source: 'controllerOperation' })
          session = owned?.binding?.session
        } catch {
          owned = null
        }
      }
      try {
        if (session === undefined || typeof session.prompt !== 'function') return false
        if (typeof session.beginSubmission !== 'function') return false
        const handle = session.beginSubmission({ mode: 'queue', text, attachments: [] })
        const result = await session.prompt([{ type: 'text', text }], 'queue', undefined, handle.requestId)
        if (result !== null && typeof result === 'object' && result.ok === false) {
          handle.abandon()
          const failure = result.error
          throw new Error(failure?.message ?? '发送失败')
        }
        return true
      } finally {
        if (owned !== null) {
          try {
            owned.release()
          } catch {
            /* 释放失败不影响发送结果 */
          }
        }
      }
    }

    /**
     * 直接在浏览器侧中止当前会话正在跑的这一轮（id=208「暂停」）。
     * 与 kickoffViaClient 对称：优先用现成的 Session 绑定，没有就 retain 一次再放掉。
     *
     * `session.cancel()` 的语义是「停掉当前 turn，但保留待处理的收件箱」—— 正好是我们要的
     * 「挂起而不是清空」：plan.json 已经写进去的 startedAt / note / execute 一个字段都不会被动。
     *
     * @returns true 表示已请求中止；false 表示这条路不可用，调用方应回退到 Host 路由。
     */
    async function stopViaClient(ctx, sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return false
      const sessions = ctx?.get?.('sessions')
      if (sessions === undefined || typeof sessions.binding !== 'function') return false
      let session = sessions.binding(sessionId)?.session
      let owned = null
      if (session === undefined && typeof sessions.retain === 'function') {
        try {
          owned = sessions.retain({ sessionId }, { source: 'controllerOperation' })
          session = owned?.binding?.session
        } catch {
          owned = null
        }
      }
      try {
        if (session === undefined || typeof session.cancel !== 'function') return false
        const result = await session.cancel()
        if (result !== null && typeof result === 'object' && result.ok === false) {
          const failure = result.error
          throw new Error(failure?.message ?? '中止失败')
        }
        return true
      } finally {
        if (owned !== null) {
          try {
            owned.release()
          } catch {
            /* 释放失败不影响中止结果 */
          }
        }
      }
    }

    /**
     * 调 Host 半边：同源 POST + x-requested-with。
     * options.timeoutMs 是超时预算（默认 120s）：到点 abort 并抛 code='timeout' 的错误，
     * 让调用方一定收到一个结局，不会因为请求悬着而把遮罩/转圈永远留在界面上。
     */
    async function call(method, payload, options) {
      const timeoutMs = typeof options?.timeoutMs === 'number' ? options.timeoutMs : 120000
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const timer = controller === null ? null : setTimeout(() => controller.abort(), timeoutMs)
      let response
      try {
        response = await fetch(API_BASE + method, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
          body: JSON.stringify(payload ?? {}),
          signal: controller === null ? undefined : controller.signal,
        })
      } catch (error) {
        // abort 在浏览器里报的是 AbortError；统一换成人能看懂的超时文案。
        if (error instanceof Error && (error.name === 'AbortError' || error.code === 20)) {
          const timeout = new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒没有返回）`)
          timeout.code = 'timeout'
          throw timeout
        }
        throw error
      } finally {
        if (timer !== null) clearTimeout(timer)
      }
      const parsed = await response.json().catch(() => null)
      if (parsed === null || parsed.ok !== true) {
        const message = parsed?.error?.message ?? `HTTP ${response.status}`
        const error = new Error(message)
        error.code = parsed?.error?.code ?? 'http'
        throw error
      }
      return parsed.value
    }

    /**
     * 列表数据的指纹：只取驱动界面的那些字段。
     * 自动刷新每 5 秒一次，绝大多数轮次里只有 1 条真的变了；指纹相同就跳过 setState，
     * 省掉 100 个条目全树的重新 diff。
     */
    function dataSignature(data) {
      if (data === null || typeof data !== 'object') return ''
      const items = Array.isArray(data.items) ? data.items : []
      // id=272：父节点下面挂着 children，子任务的状态变化也要让指纹变 ——
      // 否则「子任务被标记完成」这一步在面板上不会重渲染，要等下一次别的变动才显示。
      const one = (it) =>
        `${it.id}|${it.order}|${it.execute === true ? 1 : 0}|${it.review === true ? 1 : 0}|${it.draft === true ? 1 : 0}|${it.failed === true ? 1 : 0}|${it.startedAt ?? ''}|${it.noteLen ?? ''}|${it.planLen ?? ''}|${it.time ?? 0}|${it.name ?? ''}`
      const parts = items.map((it) => {
        if (!Array.isArray(it.children) || it.children.length === 0) return one(it)
        return `${one(it)}[${it.children.map(one).join(',')}]`
      })
      return `${data.planExists === true ? 1 : 0}|${data.broken === true ? 1 : 0}|s${data.settings?.noteLimit ?? ''}|${parts.join(';')}`
    }

    /**
     * id=348：耗时字段的唯一解析口。宿主侧 store.normalizeItem 用的是同一套规则
     * （缺失 / 非法 / 负数一律 0），这里必须对齐 —— 否则「盘上写的是 0、界面算成 NaN」
     * 就会出现「同一批条目有的显示耗时、有的空白」。
     */
    function toMillis(ms) {
      const n = Number(ms)
      return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
    }

    function fmtTime(ms) {
      const n = toMillis(ms)
      if (n <= 0) return ''
      if (n < 1000) return `${n}ms`
      const s = Math.round(n / 1000)
      if (s < 60) return `${s} 秒`
      const m = Math.floor(s / 60)
      const rs = s % 60
      if (m < 60) return rs === 0 ? `${m} 分` : `${m} 分 ${rs} 秒`
      const hh = Math.floor(m / 60)
      return `${hh} 时 ${m % 60} 分`
    }

    /* id=177：标题行的紧凑耗时文本。输入与 fmtTime 一样是**毫秒**——拆解批次里写的
       「秒数」是口径笔误：store 落盘的 time 就是毫秒（Date.now() - startedAt），
       按秒处理会放大 1000 倍。措辞用「X分钟Y秒」，与详情的 fmtTime 分工：
       详情给人细看，标题给人扫。缺失 / 0 / 非法一律返回空串，由调用方把整个节点
       隐藏（0 在 store 语义里就是「还没测出耗时」：默认值和 clearTime 都归 0）。
       正数但不足 1 秒显示「1秒」，免得给真跑过的任务挂个「0秒」。 */
    function fmtDur(ms) {
      const n = toMillis(ms)
      if (n <= 0) return ''
      const s = Math.max(1, Math.round(n / 1000))
      if (s < 60) return `${s}秒`
      const m = Math.floor(s / 60)
      const rs = s % 60
      if (m < 60) return rs === 0 ? `${m}分钟` : `${m}分钟${rs}秒`
      const hh = Math.floor(m / 60)
      const rm = m % 60
      return rm === 0 ? `${hh}小时` : `${hh}小时${rm}分钟`
    }

    function fmtDate(iso) {
      if (typeof iso !== 'string' || iso === '') return ''
      const t = Date.parse(iso)
      if (!Number.isFinite(t)) return ''
      const d = new Date(t)
      const pad = (v) => String(v).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    /**
     * 状态标签统一成三段：待执行 / 待审核 / 已审核。
     * 执行中的条目属于「待执行」组的中间态，标签换成「转圈图标 + 执行中」，
     * 让右侧一眼能区分「还没轮到」和「正在跑」（颜色与流光继续承担视觉强调）。
     * 执行完成后的两种审核态（待审核 / 已审核）直接由这里给出，不再叠第二个标签。
     */
    function statusOf(item, impliedRunning = false, delivered = undefined) {
      // id=274：父节点（拆解批次）自己没有执行状态 —— 它的 execute / review 只是容器
      // 标记，真正在跑的是 children。所以父级的状态按子任务**聚合**：
      // 只要有一条在跑就是「执行中」，整批做完未审是「待审核」，整批审完是「已审核」，
      // 其余（还没轮到 / 有失败 / 有中断）才按待执行那一档的既有规则给。
      const kids = Array.isArray(item.children) ? item.children : []
      if (kids.length > 0) {
        // id=405：草稿分组已从界面移除，「草稿优先」这条判定随之删除。
        // 即使数据里还留着 draft:true（历史条目），也不再产出 'draft' 状态 ——
        // 否则卡片会画出一枚界面上已经没有对应分组的「草稿」徽标。
        // id=344：整批做完、但还有子任务没审 —— 这条父是「待审核」，不是「待执行」。
        // 队列侧已经不把它当可执行任务（正文为空），面板这一侧也必须同口径，
        // 否则会出现「点了开始，什么都没发生」的观感。
        // 注意要排除「全都审完了」：那是下面的 reviewed 分支，不能被这里抢走。
        if (item.review !== true
          && kids.every((kid) => kid?.execute === true)
          && !kids.every((kid) => kid?.review === true)) {
          return { key: 'unreviewed', label: '待审核' }
        }
        // id=89-D：子任务也要带上同一份 delivered ——「执行中」的判定对父子一视同仁，
        // 否则父聚合出来的状态与子行自己显示的状态会打架。
        const states = kids.map((child) => statusOf(child, false, delivered))
        if (states.some((s) => s.key === 'running')) return { key: 'running', label: '执行中' }
        if (states.every((s) => s.key === 'reviewed')) return { key: 'reviewed', label: '已审核' }
        if (states.every((s) => s.key === 'reviewed' || s.key === 'unreviewed')) return { key: 'unreviewed', label: '待审核' }
        if (states.every((s) => s.key === 'failed')) return { key: 'failed', label: '失败' }
        if (states.some((s) => s.key === 'failed')) return { key: 'failed', label: '部分失败' }
        if (states.every((s) => s.key === 'interrupted')) return { key: 'interrupted', label: '已中断' }
        if (impliedRunning === true) return { key: 'running', label: '执行中' }
        return { key: 'todo', label: '待执行' }
      }
      // id=405：同上，草稿档已移除。draft 标记不再参与状态计算。
      if (item.execute === true) {
        return item.review === true
          ? { key: 'reviewed', label: '已审核' }
          : { key: 'unreviewed', label: '待审核' }
      }
      // id=233：「已中断」必须排在 running 之前。中断后 startedAt 是故意保留的
      // （它是「继续 = 续做而不是重跑」的依据），若仍按 startedAt 判 running，
      // 被中断的条目会一直显示「执行中」、上方按钮一直显示「干活中」——
      // 这正是用户报的那个 bug。落盘的 interrupted 才是这一档的真源，内存态不参与。
      // 失败的条目留在待执行组里，但不再显示成「执行中」，模型也不会再选它。
      if (item.failed === true) return { key: 'failed', label: '失败' }
      if (item.interrupted === true) return { key: 'interrupted', label: '已中断' }
      // id=89-D：**「执行中」必须由派发记录派生，不能只看 startedAt。**
      //
      // 为什么：`startedAt` 会被故意保留下来（id=233，为了「继续 = 续做而不是重跑」），
      // 所以任何"曾经开过工、后来没走完"的条目都会永远显示「执行中」——
      // 用户看到的是「这一轮根本没派发，界面却在转圈」。
      //
      // 判据与宿主侧的 running.js 完全一致：
      //   执行中 = 有 startedAt **且** 该 id 出现在这次的 delivered[] 里。
      // 查不到就当作待执行（题面要求），而不是已中断 —— 「已中断」得由回填链路
      // 明确写 interrupted 才算数，不能因为"查不到记录"就给人扣一顶中断的帽子。
      //
      // `delivered` 为 undefined 时（老版本宿主 / 测试）**退化成只信 startedAt**，
      // 保持向后兼容：宁可多显示一个执行中，也不要在拿不到数据时把在跑的任务
      // 显示成待执行导致重复点击开始。
      if (typeof item.startedAt === 'string' && item.startedAt !== '') {
        if (!Array.isArray(delivered)) return { key: 'running', label: '执行中' }
        const wasDispatched = delivered.some((x) => String(x) === String(item.id))
        if (wasDispatched) return { key: 'running', label: '执行中' }
        // 派发记录里没有它 → 回落待执行（继续往下走，由后面的规则决定）
      }
      // 模型刚开始干活、还没来得及把 startedAt 写进 plan.json 的这一小段：
      // 会话已经是 running 了，就把排在最前面的那条待执行按「执行中」显示，
      // 否则界面上会出现「AI 明明在跑，待执行里每条都写着待执行」的错位。
      if (impliedRunning) return { key: 'running', label: '执行中' }
      return { key: 'todo', label: '待执行' }
    }

    /**
     * 任务类型 → 提交时自动加在提示词前面的前缀。
     *
     * `目标` 以前也会拼一个 `/目标 `，id=217 定位时发现那是个雷：harness 的
     * slash 命令把「目标」注册成了 `/goal` 的中文别名（`dsh-client-ui-commands`
     * 的 `token.goal`），这段文字一旦被人粘进左侧输入框，整条任务就会被当成
     * `/goal` 的 objective 参数吞掉，根本到不了模型。真正的目标模式改由
     * `mode` 字段承载（宿主 `modeForTaskType`），前缀不再需要。
     */
    function typePrefix(type) {
      if (type === '仅回答') return '仅回答：'
      return ''
    }

    /**
     * 深入模板的识别句。正文里已经含这一句，就说明它已经包过一层（id=262 幂等）：
     * 用户把改好的提示词再粘回来、或者撤回了又重新发送，都不该再套第二层。
     * 它同时是「深入模式生效过」的落盘证据，比另存一个 boolean 更耐改。
     */
    const DEEP_MARK = '我想让这项任务做得更深入'

    /**
     * 多行原文包成 Markdown 引用块（id=262）。
     *
     * 之前原文直接拼在「当前任务：」后面，第二行以下顶格混进正文，模型读不出
     * 哪几行是用户原话、哪几行是我们加的模板。引用块是最省字、模型又最认的边界标记：
     * 每行一个 `> `，空行留一个裸 `>`，多段原文也不会被压成一段。
     */
    function quoteLines(text) {
      return String(text ?? '')
        .split('\n')
        .map((line) => (line.trim() === '' ? '>' : `> ${line}`))
        .join('\n')
    }

    /**
     * 深入模式：把用户随手写的一行任务改写成一段「要求做深、不许做大」的提示词。
     * 原文放在最上面（模型第一眼要看到用户到底要什么），后面追加四问 + 重写要求。
     *
     * id=262 的三处修正：
     * 1. 幂等：已含 {@link DEEP_MARK} 就原样返回，重复粘贴不会得到「当前任务：当前任务：…」；
     * 2. CRLF 归一：`\r\n` 先收成 `\n`，否则模板里会夹着孤立的 `\r`，模型侧常被读成空行；
     * 3. 原文包引用块，多行原文不再顶格混进模板正文。
     */
    function deepPrompt(task) {
      const body = String(task ?? '')
        .replace(/\r\n?/g, '\n')
        .trim()
      if (body.includes(DEEP_MARK)) return body
      return [
        '当前任务原文如下（引用块里是我的原话，可能有多行）：',
        body === '' ? '> （空）' : quoteLines(body),
        '',
        DEEP_MARK + '，而不是把规模做得更大。在重写任务之前，请先：',
        '1. 说明这个领域的顶尖专业人士在这里会做哪些我没有要求的事',
        '2. 指出他们会从哪些最原始的材料入手，而不是从已经替我加工整理过的信息入手',
        '3. 列出他们会使用的具体方法和工具',
        '4. 说明除了你或我之外，还有什么能够证明结果是正确的',
        '',
        '然后重写我的提示词，明确要求完成上述这些事。',
      ].join('\n')
    }

    /**
     * 提交时拼出最终写进 plan 的那段提示词（id=262）。
     *
     * 叠加规则收在这一个函数里，别处不再各拼各的：
     * - 仅回答：前缀单独占一行（`仅回答：\n<正文>`）——以前是 `仅回答：当前任务：…`
     *   直接贴在一起，两个标签连成一串谁也读不懂；
     * - 深入：先过 {@link deepPrompt}（自带幂等与 CRLF 归一），再叠前缀。
     *
     * 前缀先剥后加，保证「一条提示词里最多一个前缀」：用户自己写着「仅回答：」
     * 又选了仅回答类型时，不会变成两个。
     *
     * id=405：原来这里还有一条 `draft` 短路分支（草稿一律存原话、不加前缀）。
     * 草稿模式移除后没有任何调用方再传 draft，那条分支成了死代码 —— 已删。
     */
    function composePrompt(options) {
      const body = String(options?.text ?? '')
      const prefix = typePrefix(options?.taskType)
      const raw = options?.deep === true ? deepPrompt(body) : body.replace(/\r\n?/g, '\n')
      if (prefix === '') return raw
      const bare = raw.trimStart().startsWith(prefix) ? raw.trimStart().slice(prefix.length).trimStart() : raw.trimStart()
      return `${prefix}\n${bare}`
    }

    function InitDialog(props) {
      return h(
        'div',
        { className: 'plt-mask', onClick: props.onClose },
        h(
          'div',
          { className: 'plt-dialog', onClick: (e) => e.stopPropagation() },
          h('h3', null, '初始化项目任务进度？'),
          h(
            'p',
            null,
            '当前项目还没有任务进度文件。要创建它吗？',
            h('br'),
            h('code', null, '.plan/plan.json'),
            ' —— 计划列表',
            h('br'),
            '执行技能「plan-tasks」是插件内置的，已经通过技能系统注册好，',
            '不往项目里写任何文件、点完就能用，也不需要额外同步。',
          ),
          h(
            'div',
            { className: 'plt-actions' },
            h('button', { className: 'plt-btn', onClick: props.onClose, disabled: props.busy }, '稍后'),
            h('button', { className: 'plt-btn primary', onClick: props.onInit, disabled: props.busy }, props.busy ? '初始化中…' : '初始化'),
          ),
        ),
      )
    }

    /** 复制文本到剪贴板：优先 clipboard API，非安全上下文/权限被拒时退回 execCommand。 */
    async function copyText(text) {
      const value = typeof text === 'string' ? text : String(text ?? '')
      try {
        if (navigator?.clipboard?.writeText !== undefined) {
          await navigator.clipboard.writeText(value)
          return true
        }
      } catch {
        /* 掉到下面的兜底 */
      }
      try {
        const area = document.createElement('textarea')
        area.value = value
        area.setAttribute('readonly', '')
        // id=71-D：三处固定内联样式（position/top/opacity）收敛成一个类。
        // 这个节点挂在 document.body 上（不在 .plt-root 里），
        // 而 .plt-offscreen 的规则本身不依赖任何变量，所以全局定义是安全的
        // —— 它不会命中宿主页面上的其它元素，因为类名是本插件专属前缀。
        area.className = 'plt-offscreen'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(area)
        return ok !== false
      } catch {
        return false
      }
    }

    /**
     * 统一悬浮提示的运行时（id=249：样式 + 最小组件逻辑）。
     *
     * 为什么样式之外还要在这里给几行 JS：气泡的类名一旦只出现在 CSS 里，
     * `scripts/dead-css.mjs` 会把它判成死规则（确实没人挂）。而 250 才逐个替换
     * `title:`，此刻还没有元素带 `data-tip`。所以这里把「谁负责画气泡」定下来：
     * 事件委托 + 单例节点 + 纯几何计算，250 只负责把 `title` 换成 `data-tip`。
     *
     * 三个刻意的选择：
     * 1. **事件委托挂在面板根上**，不给 40 个元素各挂 listener —— 卡片是每次
     *    render 重建的，逐个绑会把内存与解绑都搞复杂。
     * 2. **气泡是单例**（一个 div 复用）。连续快速 hover 只可能有一个气泡，
     *    从结构上就不可能出现「残留多个」。
     * 3. **几何计算是纯函数** `tipPlace()`：给定锚点矩形、面板矩形、气泡尺寸，
     *    返回方向与坐标。放成纯函数是为了 249 就能直接单测翻转逻辑，
     *    不用先把它塞进 DOM 里。
     */

    const TIP_SELECTOR = '[data-tip]'

    /** 贴着面板边缘时的最小留白（px）。 */
    const TIP_MARGIN = 6

    /**
     * 算气泡该放哪。坐标相对面板（面板是 fixed 后代的包含块，见 06-tooltip.js）。
     *
     * @param {{left:number,top:number,right:number,bottom:number,width:number,height:number}} anchor
     * @param {{width:number,height:number}} panel
     * @param {{width:number,height:number}} size
     * @param {{offset?:number, margin?:number}} [opts]
     * @returns {{side:'top'|'bottom'|'left'|'right', left:number, top:number}}
     */
    function tipPlace(anchor, panel, size, opts) {
      const offset = opts?.offset ?? 8
      const margin = opts?.margin ?? TIP_MARGIN
      const centerX = anchor.left + anchor.width / 2
      const centerY = anchor.top + anchor.height / 2
      // 水平方向上先按「居中」算，再夹进面板，免得贴着左右边时气泡一半在外。
      const clampX = (value) => Math.min(Math.max(value, margin), Math.max(margin, panel.width - size.width - margin))
      // 上方放不下就翻到下面；下面也放不下就挑空间大的那一侧（宁可压住一点也别飘出去）。
      const above = anchor.top - offset - size.height
      const below = anchor.bottom + offset
      if (above >= margin) {
        return { side: 'top', left: clampX(centerX - size.width / 2), top: above }
      }
      if (below + size.height <= panel.height - margin) {
        return { side: 'bottom', left: clampX(centerX - size.width / 2), top: below }
      }
      // 上下都挤：改成左右。左优先（侧栏左边就是宿主界面，气泡朝右更不容易被挡）。
      const leftOf = anchor.left - offset - size.width
      const rightOf = anchor.right + offset
      if (rightOf + size.width <= panel.width - margin) {
        return { side: 'right', left: rightOf, top: Math.min(Math.max(centerY - size.height / 2, margin), Math.max(margin, panel.height - size.height - margin)) }
      }
      if (leftOf >= margin) {
        return { side: 'left', left: leftOf, top: Math.min(Math.max(centerY - size.height / 2, margin), Math.max(margin, panel.height - size.height - margin)) }
      }
      return { side: 'top', left: clampX(centerX - size.width / 2), top: Math.max(margin, above) }
    }

    /**
     * 单例气泡节点：第一次用的时候建，之后一直复用。
     *
     * **必须挂在面板根里，不能挂 document.body**（id=252 联合回归抓到的真 bug）。
     * 两个后果，都只在真实页面上才显形：
     * 1. 颜色全在 `.plt-root` 上定义（05-tooltip-vars.js），挂 body 就出了变量作用域 ——
     *    `var(--plt-tip-bg,rgba(34,42,56,.97))` 解析成空，气泡变成透明底黑字、0 圆角无边框。
     * 2. `tipPlace()` 给的坐标是「相对面板」的，而 body 下的 fixed 元素按视口定位 ——
     *    侧栏在窗口右侧时，气泡会整体偏出去一个侧栏偏移量。
     * 挂进面板根之后：变量在同一条链上，且 `.plt-root` 的 `container-type:size`
     * 让它成为 fixed 后代的包含块，坐标系正好对上。
     */
    function tipElement(panelEl) {
      const host = panelEl ?? document.body
      let el = document.querySelector('.plt-tip')
      if (el !== null) {
        // 面板换了（换会话/重挂载）就跟着搬过去，别留在上一块面板里。
        if (el.parentNode !== host) host.appendChild(el)
        return el
      }
      el = document.createElement('div')
      el.className = 'plt-tip plt-tip--top'
      el.setAttribute('role', 'tooltip')
      // id=71-D：可见性改由 .is-hidden 类控制，不再逐条写 el.style.visibility。
      el.classList.add('is-hidden')
      // 文字装在里层（id=251）：外层要留出 1px 边框与四支箭头的位置，
      // 高度夹紧只能作用在里层 —— 给外层加 overflow:hidden 会把箭头一并裁掉。
      const inner = document.createElement('div')
      inner.className = 'plt-tip-inner'
      el.appendChild(inner)
      host.appendChild(el)
      return el
    }

    /** 里层文字容器（外层只管边框、箭头与定位）。 */
    function tipInner(el) {
      const found = el.querySelector('.plt-tip-inner')
      if (found !== null) return found
      const inner = document.createElement('div')
      inner.className = 'plt-tip-inner'
      el.appendChild(inner)
      return inner
    }

    /**
     * 这个元素该不该弹提示（id=251）。
     *
     * 禁用态不弹：`disabled` 的表单控件在各浏览器上收不收鼠标事件并不一致
     * （Chrome 收、Firefox 不收），同一套交互在两处表现不同比「少一条说明」更糟。
     * 统一成「不弹」之后，禁用态要传达的信息交给 `aria-label` 与页面上的可见文案。
     */
    function tipBlocked(anchorEl) {
      if (anchorEl === null || anchorEl === undefined) return true
      if (typeof anchorEl.matches !== 'function') return false
      if (anchorEl.matches(':disabled') === true) return true
      if (anchorEl.getAttribute('aria-disabled') === 'true') return true
      // 冒泡上来的目标可能是禁用控件内部的 span/svg：往上再看一层宿主元素。
      const host = anchorEl.closest('[aria-disabled="true"]')
      return host !== null
    }

    /**
     * 把气泡挪到锚点旁边并显示。
     * 文案直接取 `data-tip`；空串等于没有，不弹。
     */
    function tipShow(anchorEl, panelEl, text) {
      const body = String(text ?? '').trim()
      if (body === '' || panelEl === null || anchorEl === null) return
      if (tipBlocked(anchorEl) === true) return
      const el = tipElement(panelEl)
      const inner = tipInner(el)
      inner.textContent = body
      // 先落上方向类再量尺寸：max-width 与换行都跟方向无关，但箭头位置有关，量之前得让类名生效。
      // id=71-D：这里原来还有 visibility='hidden' 与 left/top='0px' 三行内联。
      // 可见性改走 .is-hidden 类；但 left/top 的「测量前归零」**必须保留** ——
      // 气泡是单例复用的（tipElement 里 querySelector 拿回同一个节点），
      // 上一次显示时写下的 left/top 会残留在节点上。不归零的话，
      // 下面那段「量到的位置 = 包含块原点」的换算基准就被上一次的坐标污染，
      // 表现为气泡在连续 hover 不同目标时越飘越远。
      // 这两个 0 是**运行时复位**，不是静态样式，所以仍用内联（CSS 里写了 0 反而会
      // 把「未定位」和「已定位到原点」两种状态混成一种）。
      el.className = 'plt-tip plt-tip--top is-hidden'
      el.style.left = '0px'
      el.style.top = '0px'
      const panel = panelEl.getBoundingClientRect()
      // 窄面板（侧栏被拖到 300px 以下）时，变量里的 320px 上限比面板还宽 ——
      // 那样气泡会横向探出面板。按面板实际宽度再夹一次（id=251）。
      // id=71-D：下面这两处**保留内联**，因为值是运行时量出来的，CSS 表达不了：
      //   · maxW 取决于面板实时宽度（侧栏可拖动）；
      //   · maxHeight 取决于面板实时高度。
      // CSS 里已有 max-width:var(--plt-tip-max-w,320px) 作为**上限兜底**，
      // 这两行是在上限之内再按实际面板收一次，二者不冲突。
      const maxW = Math.max(120, panel.width - TIP_MARGIN * 2)
      el.style.maxWidth = `${Math.round(maxW)}px`
      // 极长文案（卡片名带整段计划正文）可能高过面板：夹住高度，否则气泡底边会探出去。
      // 被裁掉的部分仍完整留在数据源里（data-tip 与 aria-label），不是信息丢失。
      inner.style.maxHeight = `${Math.round(Math.max(48, panel.height - TIP_MARGIN * 2))}px`
      const anchor = anchorEl.getBoundingClientRect()
      const size = { width: el.offsetWidth, height: el.offsetHeight }
      // 面板里量出来的矩形是相对视口的，而气泡的包含块是面板 → 统一减掉面板原点（下方 tipPlace 的入参就用相对值）。
      const place = tipPlace(
        { left: anchor.left - panel.left, top: anchor.top - panel.top, right: anchor.right - panel.left, bottom: anchor.bottom - panel.top, width: anchor.width, height: anchor.height },
        { width: panel.width, height: panel.height },
        size,
      )
      // id=71-D：这里**必须**带上 is-hidden —— 整串 className 赋值会把上面刚加的
      // is-hidden 一起冲掉，气泡就会在算好坐标之前先闪一下（在原位置可见）。
      // 原先用内联 visibility 时不存在这个问题：style 与 className 互不干扰。
      el.className = `plt-tip plt-tip--${place.side} is-hidden`
      // 气泡此刻还在 left/top = 0，量到的视口位置就是**包含块原点**。
      // 不靠猜 `.plt-root` 的 container-type 是否真把 fixed 收成了自己的包含块
      // （各引擎/层叠上下文下并不一致），直接量一次再换算：
      //   包含块是面板 → base.left ≈ panel.left，修正量为 0；
      //   包含块是视口 → base.left = 0，修正量正好是面板原点。
      // 少了这一步，侧栏不在窗口左上角时整块气泡会整体平移一个侧栏偏移（id=299）。
      // 量之前先把方向类带来的 3px 位移抵消掉：否则换成相反方向时那 3px 会翻倍成 6px 偏差。
      // id=71-D：这三行原来是 transform='none' → 量 → transform=''。
      // 改成加/去一个 .is-measuring 类（CSS 里把它置为 transform:none），
      // 语义更清楚，也不用在 JS 里直接推样式字符串。
      el.classList.add('is-measuring')
      const base = el.getBoundingClientRect()
      el.classList.remove('is-measuring')
      // id=71-D：left/top **保留内联** —— 它们是每次显示时按锚点位置算出来的
      // （place 是纯函数 tipPlace 的结果，再叠加包含块原点修正 base/panel）。
      // 这类「贴着目标走」的坐标不可能预先写成 CSS 规则。
      el.style.left = `${Math.round(place.left + (panel.left - base.left))}px`
      el.style.top = `${Math.round(place.top + (panel.top - base.top))}px`
      // 可见性交还给类：去掉 is-hidden 即显示（opacity 仍由 is-on 控制过渡）。
      el.classList.remove('is-hidden')
      // 下一帧再加 is-on，让 opacity 从 0 过渡过去；同一帧设会跳过过渡直接显示。
      el.dataset.on = 'pending'
      requestAnimationFrame(() => {
        if (el.dataset.on === 'pending') {
          el.dataset.on = 'yes'
          el.classList.add('is-on')
        }
      })
    }

    function tipHide() {
      const el = document.querySelector('.plt-tip')
      if (el === null) return
      el.classList.remove('is-on')
      el.dataset.on = 'no'
      // id=71-D：改成加 .is-hidden 类。
      el.classList.add('is-hidden')
    }

    /** 从事件目标往上找最近的带 `data-tip` 的祖先（气泡本身不接事件，不会命中）。 */
    function tipAnchorOf(target, panelEl) {
      let node = target
      while (node !== null && node !== undefined && node !== panelEl) {
        if (typeof node.matches === 'function' && node.matches(TIP_SELECTOR)) return node
        node = node.parentElement
      }
      return null
    }

    /**
     * 在面板根上挂一套委托监听：移入/聚焦显示、移出/失焦/滚动收起（id=251 补齐）。
     *
     * 键盘用户靠 Tab 移动焦点，`pointerover` 永远不触发 —— 所以 `focusin` 也走同一条显示路径。
     * 收起侧对应 `focusout`（已经有），外加 `pointerdown`（点下去就别挡视线）、
     * `scroll`（capture：任何内层滚动容器滚了，气泡的位置就过时了）、窗口失焦。
     */
    function useTipLayer(rootRef) {
      React.useEffect(() => {
        const root = rootRef.current
        if (root === null || root === undefined) return undefined
        let current = null
        const reveal = (anchor) => {
          if (anchor === current) return
          current = anchor
          if (anchor === null) {
            tipHide()
            return
          }
          // 禁用元素不弹（tipBlocked 里判）：disabled 控件收不收鼠标事件各浏览器不一致，
          // 统一成不弹，避免同一套交互在两处表现不同。
          tipShow(anchor, root, anchor.getAttribute('data-tip'))
        }
        const onOver = (event) => reveal(tipAnchorOf(event.target, root))
        const onFocusIn = (event) => {
          // 只在键盘来的焦点上弹：鼠标点按钮也会触发 focusin，那时 pointerover 已经弹过了，
          // 这里再 show 一次会把刚隐藏的气泡又拉回来（点一下就闪一下）。
          if (event.target !== current) reveal(tipAnchorOf(event.target, root))
        }
        const onLeave = () => {
          current = null
          tipHide()
        }
        root.addEventListener('pointerover', onOver)
        root.addEventListener('focusin', onFocusIn)
        root.addEventListener('pointerdown', onLeave)
        root.addEventListener('focusout', onLeave)
        root.addEventListener('scroll', onLeave, true)
        window.addEventListener('blur', onLeave)
        return () => {
          root.removeEventListener('pointerover', onOver)
          root.removeEventListener('focusin', onFocusIn)
          root.removeEventListener('pointerdown', onLeave)
          root.removeEventListener('focusout', onLeave)
          root.removeEventListener('scroll', onLeave, true)
          window.removeEventListener('blur', onLeave)
          const el = document.querySelector('.plt-tip')
          if (el !== null && el.parentNode !== null) el.parentNode.removeChild(el)
        }
      }, [rootRef])
    }

    /**
     * 父节点展开后的子任务列表（id=273）。
     *
     * 拆解产物是一条父 + 若干 children：父只当这批的容器，展开后不再画父自己的
     * 「计划 / 备注」，而是把每条子任务按顺序铺开 —— 每行显示自己的标题、正文、状态。
     * 数据优先用 detail 取回的全量 children（列表轮询是 lite 投影：正文截断、备注只留长度），
     * 拿不到就退回列表里那份，至少结构不缺。
     *
     * 子任务不参与拖拽与勾选（宿主 reorder / 批量操作都只认顶层 id），这里也照此：
     * 只读展示 + 每行一个「通过」，一个父批次里就能逐条审完。
     */
    function KidsList(props) {
      // id=371：不再接 `onPatch` 与 `busy` —— 它们此前唯一的用途是给
      // 子任务行内那颗「单个通过」按钮（disabled + onClick）。按钮删掉之后
      // 这两个 prop 就没有读者了，留着是「传了但没人用」的假接口：
      // 后来的人会以为子任务行还能改点什么。
      // `groupKey` 保留：耗时节点的显示条件还要用它（待审核/已审核才画）。
      // id=89-D：`delivered` 由上层透传 —— 子任务的「执行中」也要按派发记录判定。
      // id=fzTvER-C：`parentSeq` / `parentId` 也一并透传 —— 子任务行要显示成
      // `1 # QSX45D -A`（序号与父相同 + 父 id + 空格 + 后缀），不再各自从 1 编号。
      const { kids, groupKey, delivered, parentSeq, parentId } = props
      // 父 id 的文本形态，用于和后缀拼接。
      const parentIdText = String(parentId ?? '').trim()
      return h(
        'div',
        { className: 'plt-kids-list' },
        kids.map((child) => {
          const status = statusOf(child, false, delivered)
          const durText = fmtDur(child.time)
          const note = String(child.note ?? '')
          // id=360/361：子任务编号（形如 `PddZRy-A`）由宿主在读投影里派生好（store.js 的
          // toLiteItem 与 api.js 的 detail 各给一份，见 docs/subtask-numbering.md），
          // 这里只负责画，不再从 id 里切字符串 —— 同一个规则只留一份实现。
          //
          // id=86-B：原来这里写着「为什么不拼 `#`」——那时候编号是 `2-A` 这种纯序号形状，
          // 跟顶层的 `#12` 是两种记号，混着读别扭。id 改成随机 6 位后，
          // 子任务编号变成 `PddZRy-A`，与顶层 `#PddZRy` 是同一种身份形状，
          // 统一加 `#` 反而是消歧而不是制造歧义。该决定已由用户确认。
          //
          // 空值处理（题面要求）：编号文本为空时**整个节点不渲染**，
          // 也不留一个固定宽度的空槽 —— 手工新建的条目没有父子关系，
          // 给它留编号位就等于凭空多出一段缩进，标题会比别的行短一截还找不到原因。
          //
          // id=86-B：`code` 缺失时回退到 `child.id`。
          // `code` 由宿主在 lite 投影里派生（store.js 的 toLiteItem），正常一定有；
          // 但若调用方拿了未投影的 children（没传 lite:true），就会变成「子任务没有编号」——
          // 那是**身份丢失**，比显示一个 id 更糟。回退到 id 至少还能对上号；
          // 两者都空才真的不渲染。
          // 这里绝不能直接模板化 null/undefined，否则会渲染出 `#undefined`。
          const rawCode = String(child.code ?? '').trim()
          const codeText = rawCode !== '' ? rawCode : String(child.id ?? '').trim()
          // id=fzTvER-C：把完整子 id 拆成「父 id + 后缀」，供新格式使用。
          //
          // 子 id 形如 `QSX45D-A`（父 6 位随机 + `-` + 后缀）。
          // 后缀可能是 A / Z / AA（见 ids.js 的 childSuffix：0→A、25→Z、26→AA），
          // 所以只切**第一个** `-` 之后的全部，不能只取一个字母。
          //
          // 拆不出来（没有 `-`，或前半段与 parentId 不一致）就退回原样显示，
          // 不做任何猜测 —— 猜错会把别的节点的后缀挂到这一行上。
          const suffix = (() => {
            const at = codeText.indexOf('-')
            if (at <= 0 || at === codeText.length - 1) return ''
            const head = codeText.slice(0, at)
            // 前半段必须就是父 id，否则说明这条不是这一批的孩子（历史数据 / 数据异常）。
            if (parentIdText !== '' && head !== parentIdText) return ''
            return codeText.slice(at + 1)
          })()
          // id=322 曾把 children 行的编号整个删掉，理由是「子任务不参与拖拽 / 批量，
          // 编号只在父行有意义」。id=361 把这个理由收回来一半：**身份还是要显示的**，
          // 只是形状不同（窄胶囊，不是顶层那枚裸 `#id`），而且位置从「标题之前的最左端」
          // 挪到了对勾之后 —— 编号是配角，不该抢占标题的起点。
          // `data-id` 一直都留着（批量请求与验证脚本靠它定位具体那一条）：
          // 去掉显示 ≠ 去掉身份，现在两者终于对上了。
          // id=316：已执行（做完，不论审没审）的子任务要一眼看出来 —— 与未执行项区分，
          // 但不削弱未执行项的强调。用 `.plt-kid-done` 而不是复用 status.key：
          // 「待审核」「已审核」两种都算做完，而它们在状态机里是两个不同的 key。
          const doneKid = child.execute === true
          return h(
            'div',
            { key: child.id, className: `plt-kid ${status.key}${doneKid ? ' plt-kid-done' : ''}`, 'data-id': String(child.id), 'data-done': doneKid ? 'true' : 'false' },
            h(
              'div',
              { className: 'plt-kid-h' },
              // 前置对勾：做完的那一条显示 ✓。槽位对**所有**行都占 12px（id=322）——
              // 编号列删掉之后，如果只有做完的行多出这个图标，两种行的标题起点会差 18px，
              // 纵向扫下来就是锯齿。未做的行只把对勾藏起来（visibility），不占位就没有对齐。
              doneKid
                ? h('span', { className: 'plt-kid-check', 'aria-hidden': 'true' }, '✓')
                : h('span', { className: 'plt-kid-check is-off', 'aria-hidden': 'true' }),
              // 编号标签：在任务名称左侧、对勾之后（id=361）。
              // 所有状态（待执行 / 待审核 / 已审核 / 执行中 / 失败…）都渲染同一个节点，
              // 不做条件分支 —— 编号是身份，不是状态，状态一变编号就消失会让人对不上号。
              // `code` 为空串时返回 null，DOM 里连元素都没有（题面：不留占位空隙）。
              //
              // id=86-B：**改为与顶层一致，也带 `#` 前缀**。
              //
              // 原先这里刻意不带 `#`，理由是「父已用组带子任务，`2-A` 连读就是第2组A条，
              // 再加 `#` 成了两种记号混排」。该理由在 id 改为随机 6 位后不再成立：
              // 子任务编号现在是 `PddZRy-A` 这种，它和顶层的 `#PddZRy` 是同一种身份形状，
              // 用户的诉求是「列表里所有编号统一成 #xxx」。混排问题反而因为统一前缀而消失。
              // id=fzTvER-C：新格式 `1 # QSX45D -A` ——
              //   序号与**父条目相同**（子任务不各自从 1 编号），
              //   后面是父 id + 空格 + 子任务的后缀。
              //
              // 为什么序号跟父一样：子任务是这一批的组成部分，不是独立排位。
              // 若各自从 1 编号，展开一组后会出现「1 号父下面挂着 1、2、3 号子任务」，
              // 两套编号在同一屏里打架，用户没法用「3 号」指代任何东西。
              //
              // 后缀拆不出来时（suffix === ''）退回原来的 `#codeText`，
              // 保证身份永远可见 —— 格式可以退化，身份不能丢。
              codeText !== ''
                ? h(
                    'span',
                    {
                      className: 'plt-kid-code',
                      // 复制不了也点不了，只是视觉定位；读屏念一遍编号同样是有效信息。
                      'data-tip': `编号 #${codeText}`,
                    },
                    Number.isFinite(parentSeq) && parentSeq > 0
                      ? h(
                          'span',
                          { className: 'plt-kid-id' },
                          h('span', { className: 'plt-seq' }, String(parentSeq)),
                          ' ',
                          h('span', { className: 'plt-id-hash' }, '#'),
                          ' ',
                          parentIdText !== '' ? parentIdText : codeText,
                          suffix !== '' ? h('span', { className: 'plt-kid-suffix' }, ` -${suffix}`) : null,
                        )
                      : `#${codeText}`,
                  )
                : null,
              h(
                'span',
                { className: 'plt-kid-name', 'data-tip': `${child.name}\n\n${child.plan ?? ''}` },
                // id=362：省略号截断挪到内层 span 上，外层只当 flex 项。
                // 原因是一个浏览器/规范细节：flex 项一旦带 overflow:hidden，
                // 它的「基线」就不再取首行文字的基线，而是退回**底边**（inline-block
                // 那条规则被套用到了 flex 项上）。于是上一行的 align-items:baseline
                // 会把编号胶囊对齐到标题的底边 —— 看起来正是题面要避免的那种错位。
                // 拆成两层后：外层 overflow 保持 visible（有真基线），内层负责截断。
                h('span', { className: 'plt-kid-name-text' }, child.name),
              ),
              // id=383：子任务这一行的耗时原本就有，但显示条件里少了一种情况 ——
              // 它是 `durText !== ''`（无耗时就整个节点不渲染）。待审核组里每条子任务
              // 都跑过了，所以正常情况都有数字；可一旦 time 缺失/为 0
              //（老数据、手工改过的 plan.json、或执行没来得及回填），
              // 那一行就比同组别的行**少一截**，看起来像渲染坏了而不是「这一条没有耗时」。
              // 现在待审核/已审核两组统一给兜底「—」：
              //   · 有数字 → 照旧显示（3分钟47秒）
              //   · 没数字 → 显示 —，占位与字号都和数字一致，纵向扫视时这一列是齐的
              // 与单任务那一行用同一套兜底（见上方 item 的 durText 处），
              // 所以「拆解的子任务」和「单任务」在待审核里长得一样。
              (groupKey === 'unreviewed' || groupKey === 'reviewed')
                ? h(
                    'span',
                    {
                      className: `plt-dur${durText === '' ? ' is-empty' : ''}`,
                      'data-tip': durText === '' ? '这条任务没有记录耗时' : `这条任务耗时 ${durText}`,
                    },
                    durText === '' ? '—' : durText,
                  )
                : null,
              child.taskType === '仅回答' || child.taskType === '目标'
                ? h('span', { className: `plt-tag type plt-type-${child.taskType}`, 'data-tip': `任务类型：${child.taskType}` }, h(ModeIcon, { kind: child.taskType, size: 12 }))
                : null,
              // id=274：状态徽标只挂在父级行上（父行显示整批的聚合状态），
              // 子任务行不再重复一遍 —— 否则一屏里同一句话要说 N+1 次。
              // 子任务自己的状态由行底色 / 左边框表达。
              status.key === 'running' ? h(SpinnerIcon, { size: 11 }) : null,
              // id=371：子任务行右侧那颗「单个通过」已删除。
              // 理由：整批通过（父行头部那颗）已经是这条链路上的唯一入口 ——
              // 同一份「标成已审核」的动作留两个入口（一个整批、一个逐条），
              // 用户要自己判断「我该点哪个」，而两条路落盘后的形态完全一样。
              // 删掉之后：子任务行只剩对勾 / 编号 / 标题 / 耗时 / 类型图标 / 执行中，
              // 审核动作统一收到父行头部，与 6- 那批把「通过」搬到头部的方向一致。
            ),
            h('div', { className: 'plt-kid-plan' }, String(child.plan ?? '') || '（空）'),
            note !== ''
              ? h('div', { className: 'plt-kid-note' }, h('span', { className: 'plt-kid-note-h' }, '备注'), note)
              : (Number(child.noteLen ?? 0) > 0
                  ? h('div', { className: 'plt-kid-note' }, h('span', { className: 'plt-kid-note-h' }, '备注'), '（加载中…）')
                  : null),
          )
        }),
      )
    }

    function Item(props) {
      // id=405：草稿模式移除后，onPromote / onDemote / canDemote / editable 四个 prop
      // 一并从解构里删掉 —— 它们只服务草稿组（转进 / 转出 / 就地编辑），组没了就没对象。
      const { item, seq, open, detail, onToggle, onPatch, onRemove, onFetchDetail, busy, dragging, dropTarget, dropped, onDragStart, onDragOver, onDrop, onDragEnd, dragEnabled, selectable, selected, onSelect, showExecute, showReview, groupKey, impliedRunning, canPin, onPinTop, onApproveBatch, delivered } = props
      // id=273：父节点（带 children 的拆解批次）只当容器 —— 它没有正文、不参与执行，
      // 标题行就只显示原始提示词标题（name 本身就是从 sourcePrompt 压出来的），
      // 展开后交给下面的子任务列表，父自己的「计划 / 备注」一块都不渲染。
      const kids = Array.isArray(item.children) ? item.children : []
      const isParent = kids.length > 0
      const groupCount = isParent
        ? kids.filter((c) => statusOf(c, false, delivered).key === 'todo' || statusOf(c, false, delivered).key === 'running').length
        : 0
      const status = statusOf(item, impliedRunning === true, delivered)
      const time = fmtTime(item.time)
      // id=178：标题行的紧凑耗时（毫秒走 fmtDur）。空串代表缺失/0/非法，整节点不渲染。
      //
      // id=383：**批次的耗时改从子任务汇总**。
      //   父节点自己是容器，从不执行，所以 `item.time` 恒为 0（落盘里确实是 0）。
      //   原来这里只读父自己的 time，于是「单任务有待耗时、拆解批次没有」——
      //   待审核组里两条并排、一条有数字一条光秃秃，用户看到的就是「拆解任务没显示耗时」。
      //   真正的耗时在每个 child 上（每个子任务跑完各记各的），汇总才是这一批的答案。
      //
      //   取 sum 而不是 max/last：一个批次的总开销就是各段之和，
      //   而 max 会把「三条各 2 分钟」说成 2 分钟，跟用户排队等待的实际感受不符。
      //   没有 time 的子任务按 0 计；全为 0 时 fmtDur 仍返回空串，整节点缺席
      //   （与单任务「缺失/0 就不画」的口径一致）。
      const batchMillis = kids.reduce((sum, c) => sum + (Number(c?.time) > 0 ? Number(c.time) : 0), 0)
      const durText = fmtDur(isParent ? batchMillis : item.time)
      // 列表数据是 lite 的（正文截断、备注只留长度）；展开时用按需取回的全文覆盖。
      // 取不到就退回 lite 的截断正文，至少不会空白。
      const loaded = detail !== null && detail !== undefined && detail.id === item.id ? detail : null
      const planText = loaded === null ? item.plan : loaded.plan
      const noteText = loaded === null ? item.note : loaded.note
      // 正在执行（已开始、未完成）的条目不允许删除，避免打断模型的执行。
      const running = status.key === 'running'
      // 置顶按钮只在「待执行」组、且这一条不是正在执行的那条时出现
      // （执行中的条目本来就排在最上面，再置顶没有意义）。
      const pinTop = canPin === true && running !== true
      // 「复制内容」「复制 ID」三组都给：待执行组要先把写好的计划原文/编号取走别处用，
      // 待审核组要再喂给别的会话，已审核组要回看/复用历史计划。
      // 父节点没有自己的正文可复制（plan 恒为空），「内容」按钮给了只会复制出一串空串。
      const canCopyPlan = isParent !== true
      const canCopyId = true
      // 原始提示词的长度与正文：宿主有两种投影，必须两边都认。
      //   lite 列表（自动刷新 / 静默重读）→ 只给 sourcePromptLen，sourcePrompt 被抹成空串；
      //   全量 read（首挂载 / 会话切换那几次）→ 直接给 sourcePrompt 全文，压根没有 sourcePromptLen。
      // 早先这里只读 sourcePromptLen，于是首屏那一次渲染里「提示词」按钮整批消失、
      // 「提示词 → 通过」的顺序第一次画出来就是错的（id=194 联合回归抓到）。
      const sourceLen = Math.max(
        Number(item.sourcePromptLen ?? 0) || 0,
        typeof item.sourcePrompt === 'string' ? item.sourcePrompt.length : 0,
        loaded === null ? 0 : Number(loaded.sourcePromptLen ?? 0) || 0,
      )
      // 手上就已经有全文的情形（全量 read / detail 已回）：省掉一次 detail 请求。
      const sourceText =
        loaded !== null && typeof loaded.sourcePrompt === 'string' && loaded.sourcePrompt !== ''
          ? loaded.sourcePrompt
          : typeof item.sourcePrompt === 'string'
            ? item.sourcePrompt
            : ''
      // 「复制提示词」只给待执行及之后的真实任务卡（没有出处的不给）；
      // 没有原始提示词的条目（手工提交的）直接不渲染按钮，而不是给一个点了没反应的空壳。
      const canCopyPrompt = groupKey !== 'draft' && sourceLen > 0
      const [copied, setCopied] = React.useState('')
      // 「原始提示词」的展开状态。
      //
      // 默认值（id=375 起，id=387 扩到待审核）：
      //   · 待执行里的**拆解批次**  → 展开（id=375）
      //   · 待审核里的**所有条目**  → 展开（id=387，本步）
      //   · 其余一律折叠
      //
      // 为什么待审核也要放开（题面：「待审核里面的原始提示词 需要自动展开」）：
      //  待审核是**核对**的地方 —— 要判断「模型交的这份活对不对」，必须能对照
      //  当初的要求。原来这段原文默认折着，等于让人先点开再评审，
      //  而这恰恰是审核动作里最该摆在眼前的依据。
      //  与待执行不同，这里不区分是不是拆解批次：审核时单任务同样需要原文对照，
      //  题面说的也是「里面的」而不是「拆解任务的」。
      //
      // 为什么敢默认铺开：`.plt-source` 自带 `max-height:200px; overflow:auto`，
      //  再长的需求也封顶 200px 并在内部滚动，不会把卡片撑成一条。
      //
      // 仍然不放开的两档：
      //  · 已审核：那时已经定稿，用户多半是回看结果，铺开原文只会盖住执行结果；
      //  · 待执行里的单任务：没有子任务列表，展开区只剩这段原文，
      //    而标题已经压自同一段提示词，默认展开只是把卡片撑成两倍高（id=375 定的）。
      //
      // 状态仍是本地 useState、仍可手动收起/展开（按钮一字未改）。
      // 只在初次挂载时取这个默认值：条目换组时是整棵子树重新挂载
      //（各组是独立容器），所以会按新组重新取默认，不会把旧状态带过去。
      const [sourceOpen, setSourceOpen] = React.useState(
        (groupKey === 'todo' && isParent === true) || groupKey === 'unreviewed',
      )
      // id=405：草稿就地编辑整套（editing / draftText / saveState / 自动保存定时器 /
      // 卸载补写逻辑）随草稿模式一并删除 —— 草稿组已不存在，没有可编辑的对象。
      const doCopy = async (kind) => {
        // 复制要给完整原文：lite 数据里正文是截断的，展开时已取回全文就用全文，
        // 没取回则先补一次 detail 再复制（保证复制到的不是带省略号的半截）。
        // 复制提示词时不碰计划正文，省掉一次没必要的 detail 请求。
        let full = planText
        if (kind !== 'prompt' && (item.planLen ?? 0) > (typeof full === 'string' ? full.length : 0)) {
          const fetched = typeof onFetchDetail === 'function' ? await onFetchDetail(item.id) : null
          if (fetched !== null && fetched !== undefined && typeof fetched.plan === 'string') full = fetched.plan
        }
        // 原始提示词同理：lite 里只有长度，非要复制时补一次 detail 取全文。
        let source = sourceText
        if (source === '' && sourceLen > 0) {
          const fetched = typeof onFetchDetail === 'function' ? await onFetchDetail(item.id) : null
          if (fetched !== null && fetched !== undefined && typeof fetched.sourcePrompt === 'string') source = fetched.sourcePrompt
        }
        if (kind === 'prompt' && source === '') return
        // 复制 ID 时带上「任务id:」前缀：粘到别的会话里能直接看出这是任务编号，
        // 而不是一串裸数字（容易被误读成版本号 / 行号）。
        //
        // id=86-C：**id 只出现一次，且必须是当前任务的真实 id**。
        // 这里用一个局部变量把取值收敛掉，避免三件事：
        //   1. 模板里直接写 `item.id` —— id 缺失时会复制出「任务id:undefined」，
        //      粘到会话里既没用又会误导模型（它可能真去按 undefined 找任务）；
        //   2. 将来有人在别处再拼一次前缀，变成「任务任务id:80」那种重复；
        //   3. 复制到历史数字 id（80）与随机 id（a1b2c3）时出现两种格式。
        // 前缀固定为 `任务id:`，候值是任务当前的 id（历史数字原样、随机 6 位原样）。
        let payloadText = ''
        if (kind === 'id') {
          const currentId = String(item.id ?? '').trim()
          // 取不到 id 就不复制 —— 复制一个「任务id:」空壳比不复制更糟。
          if (currentId === '') return
          payloadText = `任务id:${currentId}`
        } else if (kind === 'prompt') {
          payloadText = source
        } else {
          payloadText = String(full ?? '')
        }
        const ok = await copyText(payloadText)
        if (ok) {
          setCopied(kind)
          window.setTimeout(() => setCopied(''), 1200)
        }
      }
      // 条目内容一律只读：计划文本由侧边栏输入框写入，执行/审核状态由模型回填，
      // 所以列表里不再提供就地编辑入口（想改内容就删掉重写，或让模型改）。
      return h(
        'div',
        {
          className: `plt-item${isParent ? ' plt-parent' : ''}${open ? ' open' : ''}${running ? ' running' : ''}${dragging ? ' dragging' : ''}${dropTarget ? ' drop-target' : ''}${dropped === true ? ' plt-dropped' : ''}${props.sublime === true ? ' plt-sublime' : ''}`,
          onDragOver: (e) => {
            if (dragEnabled !== true) return
            e.preventDefault()
            onDragOver()
          },
          onDrop: (e) => {
            if (dragEnabled !== true) return
            e.preventDefault()
            onDrop()
          },
        },
        h(
          'div',
          { className: 'plt-head', onClick: onToggle },
          dragEnabled === true
            ? h(
                'span',
                {
                  className: 'plt-grip',
                  'data-tip': '按住拖拽可调整顺序（执行顺序也跟着变）',
                  draggable: true,
                  onClick: (e) => e.stopPropagation(),
                  onDragStart: (e) => {
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', String(item.id))
                    onDragStart()
                  },
                  onDragEnd,
                },
                '⠿',
              )
            : h('span', { className: 'plt-grip plt-grip-off', 'aria-hidden': 'true' }),
          selectable === true
            ? h(
                'span',
                { className: 'plt-pick', onClick: (e) => e.stopPropagation() },
                h('input', {
                  type: 'checkbox',
                  checked: selected === true,
                  disabled: busy,
                  'data-tip': selected === true ? '取消选择这一条' : '选中这一条，稍后批量处理',
                  onChange: (e) => onSelect(e.target.checked),
                }),
              )
            : null,
          h('span', { className: 'plt-caret' }, h(CaretIcon, { size: 13 })),
          // 编号单独占一个窄标签，标题就能把剩下的宽度全用上。
          //
          // id=fzTvER-B：显示成 `1 # QSX45D` ——
          //   · 前面是**该页签内的位置**（1 起），由上层传下来的 `seq`；
          //   · 后面是**原始 id**，一字不改。
          //
          // 为什么两者都要：序号回答「排到第几个」，id 回答「是哪一条」。
          // id 仍是点击、复制、派发的唯一依据 —— 这里只是多显示一个序号，
          // 展示层不动任何数据的 id（`item.id` 原样用于 key / 事件 / 复制）。
          //
          // `seq` 取不到（0 / 非数字）时只显示 `# id`：
          // 硬编一个「1」会让所有查不到的条目都显示成第 1 条，比不显示更误导。
          //
          // 拆成两个 span 而不是拼成一个字符串：序号要弱化（浅色、小一号），
          // 混在一个文本节点里就没法单独上色了。
          Number.isFinite(seq) && seq > 0
            ? h(
                'span',
                { className: 'plt-id' },
                // 格式固定为 `1 # QSX45D`（题面要求：序号 + 空格 + # + 空格 + 原 id）。
                // 三个 span 之间必须显式写出空格字符串 —— 相邻的行内元素在 HTML 里
                // 不会自动插入空白，不加就会渲染成 `1#QSX45D`。
                h('span', { className: 'plt-seq' }, String(seq)),
                ' ',
                h('span', { className: 'plt-id-hash' }, '#'),
                ' ',
                String(item.id),
              )
            : h('span', { className: 'plt-id' }, `# ${item.id}`),
          h(
            'span',
            {
              className: 'plt-name',
              // id=352：原生 title 也带上全称 —— 除了自绘气泡，浏览器自带的悬停提示
              // 也该显示完整标题（有人习惯等系统 tooltip）。
              title: `#${item.id} ${item.name}`,
              'data-tip': isParent
                ? `#${item.id} ${item.name}\n\n拆解批次：${kids.length} 条子任务`
                : `#${item.id} ${item.name}\n\n${planText}`,
            },
            // id=352：待执行区的标题按字数截短（其余区保持全称），完整名字在 data-tip 里。
            groupKey === 'todo' ? clipName(item.name, TODO_NAME_MAX) : item.name,
          ),
          // 父节点：标题右侧的「N 条」徽标。拆解产物的归属关系就靠它一眼认出来。
          isParent === true
            ? h(
                'span',
                {
                  className: 'plt-kids',
                  'data-tip': `这一批拆成了 ${kids.length} 条子任务${groupCount > 0 ? `，其中 ${groupCount} 条还没做完` : ''}`,
                },
                `${kids.length} 条`,
              )
            : null,
          // id=178/179：待审核的每一项在标题右侧挂耗时，扫一眼就知道这条跑了多久，
          // 不用展开。必须是 .plt-name 的**兄弟**节点——塞进标题里会跟着一起被
          // ellipsis 截掉，还会污染悬浮提示的全文。
          // id=183：已审核组同样挂耗时。两边走的是**同一个** fmtDur、同一个 .plt-dur
          // 节点、同一份样式，只是组白名单多一项——不复制第二份格式化实现，
          // 这样「6分钟28秒」在两处永远长得一样。空串（缺失/0/非法）时整节点缺席。
          (groupKey === 'unreviewed' || groupKey === 'reviewed')
            ? h(
                'span',
                {
                  className: `plt-dur${durText === '' ? ' is-empty' : ''}`,
                  'data-tip': durText === '' ? '这条任务没有记录耗时' : `这条任务耗时 ${durText}`,
                },
                durText === '' ? '—' : durText,
              )
            : null,
          // 类型只用图标表示（和输入栏的胶囊图标一致）：「修改」是默认类型，不显示。
          // 放在状态标签左侧，先看到「这是什么类型的活」，再看到「进行到哪一步」。
          item.taskType === '仅回答' || item.taskType === '目标'
            ? h('span', { className: `plt-tag type plt-type-${item.taskType}`, 'data-tip': `任务类型：${item.taskType}` }, h(ModeIcon, { kind: item.taskType, size: 13 }))
            : null,
          // 置顶（id=319 位置调整）：只有「待执行」组给，正在执行的那条不给（它本来就在最上面）。
          // 必须排在状态徽标**之前** —— 状态列要贴着行尾对齐（见 13-item.js 的
          // .plt-head 右对齐规则），按钮放在它后面会把徽标顶得长短不一。
          // id=320：没有按钮的行也要占同样的宽度，所以「是否有按钮」只决定画不画图标，
          // 槽位本身恒定存在（.plt-pin-slot 固定 20px）—— 否则拆分批次行（永远没有置顶按钮）
          // 的状态标签会比普通行右移 20px，纵向扫视时那一列是锯齿。
          //
          // id=399：**但槽位不该在没有后续内容时也占位**（题面：待审核通过按钮右侧有间距，
          // 想靠右一点、与其它组保持一致的右边距）。
          //
          // 间距的来源就在这个槽位：它恒定 20px，而待审核组（id=368）与已审核组（id=358）
          // 都**不再画状态徽标**，头部最后一颗控件之后就没有东西了 ——
          // 于是那 20px 成了一段纯空白，加上 .plt-head 的 gap，
          // 通过按钮看起来比别的组往里缩了一截。
          //
          // 修法：只有当这一行**后面还有东西要画**时才保留槽位。
          // 「后面还有东西」的判定与下面状态徽标那段完全同源：
          //   · running                → 画转圈徽标
          //   · 待执行/待审核/已审核   → 不画（id=407 起待执行也不画了）
          //   · 其余（失败/已中断）    → 画文字徽标
          // 这样槽位的存在与否跟「右边到底有没有东西」严格一致，
          // 不会出现「留了位置却空着」或「没留位置结果把徽标挤出去」。
          //
          // 注意：id=320 原本要求「同一组内部一律留槽」，那是因为当时三组都要画徽标。
          // id=407 之后待执行也不画了，于是整个待执行组都不收这个槽 —— 组内仍然对齐，
          // 与待审核/已审核同一口径。
          //
          // id=402：**整块从复制组之后搬到它之前**（题面：置顶放在 id 按钮前）。
          //
          // 位置变化：原来顺序是 [复制ID][复制内容][置顶槽]，现在变成
          // [置顶槽][复制ID][复制内容]。置顶是"把这条往前挪"的动作，
          // 放在复制之前更符合"先安排位置、再取内容"的读序。
          //
          // 注意**没有**破坏上面 id=319 那条约束：置顶仍然排在状态徽标之前。
          // 整块只是从复制组后方移到前方，与徽标的前后关系一字未动。
          // 也没动复制组自身的渲染条件（三组白名单）。
          // id=gR3lBM：**置顶槽位只在真的能放出置顶按钮时渲染**。
          //
          // 原来条件是「执行中 / 失败 / 已中断都画槽」，但槽里那颗按钮的条件是
          // `pinTop = canPin && running !== true`：
          //   · 执行中的行 —— running 为真 → 永远拿不到按钮；
          //   · 拆分父（有 decomposeKey，canPin 恒假）→ 也永远拿不到。
          // 于是这些行渲染出一个**空槽**，DOM 位置正好夹在「N 条」徽标与
          // 「复制 ID」按钮之间（439 行 vs 498 行），表现为
          // **20px 槽宽 + 两侧各 8px gap = 36px 的纯空白** —— 用户报的就是这段。
          //
          // 修法：条件收敛成 `pinTop === true`。
          // 这样「有槽必有按钮、没按钮就没槽」，不会再有「留了位置却空着」。
          //
          // 代价（已与用户确认接受）：执行中 / 失败 / 已中断这几行的状态徽标会
          // 比之前靠左 28px。这不影响跨行对齐 —— 徽标是行尾最后一个元素，
          // 每行都紧贴自己的行尾，右边界仍然一致；只是不再被一段空槽人为推开。
          //
          // 待执行组不受影响：那里 pinTop 与 drawPin 一致（有按钮时才画），
          // 原本就有按钮的行照旧。
          pinTop === true
            ? h(
                'span',
                { className: 'plt-pin-slot' },
                h(
                  'button',
                  {
                    className: 'plt-pin',
                    'data-tip': '置顶：排到待执行的第一位（执行中那条之后）',
                    onClick: (e) => {
                      e.stopPropagation()
                      onPinTop()
                    },
                  },
                  h(PinTopIcon, { size: 12 }),
                ),
              )
            : null,
          // id=382：头部这颗「通过」**已移除**，改到待审核卡片的底部操作区，
          // 与「删除」并排成一对图标（[✓ 通过] [🗑 删除]）。
          //
          // 为什么不两处都留：一张卡上出现两颗「通过」（头部一颗胶囊、底部一颗图标），
          // 用户会犹豫该点哪个 —— 它们其实是同一个动作。这一点与 id=354/368 把「通过」
          // 搬去头部时的取舍相同，只是方向反过来了：当时是为了「不展开也能点」，
          // 现在的要求是「与垃圾桶图标同区对齐」，两者都要，只能选一处。
          //
          // 选底部操作区之后的一个代价（如实记录）：待审核卡在**收起状态**下不再有
          // 通过入口，要先展开卡片才看得到这一排。这是题面明确指定的位置，不是疏忽；
          // 若以后想找回「收起也能逐条过」的手感，正确做法是在头部加图标
          // （与这里同尺寸），而不是把文字胶囊再加回来。
          // id=389：待审核卡片的「复制 ID / 复制内容」搬到**头部**（题面要求）。
          // id=393：待执行组的同样搬到头部（题面：待执行里面 复制id 和内容 也放在头部）。
          //
          // 为什么放头部：这两个复制动作是「把这条的正文取走」—— 复制完就去别处用，
          // 不需要先展开正文。放在展开区里，每条都要点开才够得着，与 id=382 把「通过」
          // 搬到底部操作区是同一类取舍：高频动作不该藏在展开态后面。
          //
          // 覆盖范围现在只有这两组：待审核（id=389）+ 待执行（id=393）。
          // 已审核保持原样 —— 题面两次都只点了具体的组名，不顺手扩大。
          //
          // 形态用头部复制按钮那套文字胶囊样式：
          // 头部不能塞图标 —— 与垃圾桶并排时两个图标容易点错，
          // 而复制是无害动作、删除是破坏性的，形状上就该分得开。
          //
          // 「复制内容」在几个组里的差异：
          //   · 拆解批次（isParent）→ **原始提示词**。父自己没有正文（plan 恒为空），
          //     对它来说「内容」就是这批任务当初的需求原文。
          //   · 普通条目 → 自己的计划正文。
          // 两种情况都可能需要 detail 取全文，doCopy 已按 kind 分别处理。
          //
          // id=396：已审核也纳入（题面：已审核里面也将复制id和内容放在头，
          // 展开里面移除这两个按钮）。三组齐全了：待执行 / 待审核 / 已审核。
          // （id=405：草稿组已删除，原来关于「草稿不纳入」的说明随之作废。）
          //
          // 已审核的「复制内容」为什么也是批次取提示词：
          // 已审核里既有单任务也有整批（整批审完会连父带 children 一起归档），
          // 而归档的父同样没有正文 —— 判定沿用同一个 isParent，无需另立规则。
          groupKey === 'unreviewed' || groupKey === 'todo' || groupKey === 'reviewed'
            ? h(
                'div',
                { className: 'plt-head-copies' },
                // 复制 ID：所有条目都有（id 是身份）。
                h(
                  'button',
                  {
                    className: `plt-btn plt-head-copy${copied === 'id' ? ' done' : ''}`,
                    type: 'button',
                    title: `复制这条计划的 ID（${item.id}）`,
                    'aria-label': '复制 ID',
                    'data-tip': `复制这条计划的 ID（${item.id}）`,
                    onClick: (e) => {
                      e.stopPropagation()
                      void doCopy('id')
                    },
                  },
                  copied === 'id' ? '已复制' : 'ID',
                ),
                (isParent === true ? sourceLen > 0 : canCopyPlan === true)
                  ? h(
                      'button',
                      {
                        className: `plt-btn plt-head-copy${copied === (isParent === true ? 'prompt' : 'plan') ? ' done' : ''}`,
                        type: 'button',
                        disabled: isParent === true && sourceLen === 0,
                        title: isParent === true ? '复制这一批的原始提示词' : '复制这条计划的完整内容',
                        'aria-label': isParent === true ? '复制原始提示词' : '复制内容',
                        'data-tip': isParent === true
                          ? `复制这一批的原始提示词（${sourceLen} 字）`
                          : '复制这条计划的完整内容',
                        onClick: (e) => {
                          e.stopPropagation()
                          void doCopy(isParent === true ? 'prompt' : 'plan')
                        },
                      },
                      copied === (isParent === true ? 'prompt' : 'plan') ? '已复制' : '内容',
                    )
                  : null,
              )
            : null,
          // id=390：待审核的「通过」搬到**头部**（题面：通过放在头部，不再放在展开里面）。
          //
          // 位置在复制组之后、置顶槽 / 状态徽标之前 —— 这样右侧状态那一列仍然对齐
          //（id=320 的「槽位恒定」约定不为它让路）。
          //
          // 为什么放头部：审核是逐条扫读的动作。通过按钮藏在展开区里，意味着
          // 每审一条都要先展开、找到按钮、再收起 —— 而「这条做完了没有」看标题
          // 就够了，根本不需要读正文。搬到头部之后，待审核组在**收起状态下**
          // 就是一张可以逐条点过的清单。
          //
          // 形态：图标按钮（CheckIcon），与旁边的复制胶囊同高 26px，
          // 但用 .plt-pass-icon 的实色描边强调「这是推进状态的动作」，
          // 与复制那种中性动作在颜色上分开。
          //
          // 两类条目共用同一位置，用 isParent 分派动作（与 id=354/368 完全一致）：
          //   批次 → onApproveBatch（一次改完整批）
          //   普通 → onPatch({ review: true })
          // running 时两颗都不画：执行中还没有结果可审。
          ((isParent === true && status.key === 'unreviewed') || (isParent !== true && showReview === true && running !== true))
            ? h(
                'button',
                {
                  className: 'plt-btn plt-icon-btn plt-pass-icon plt-head-pass-btn',
                  type: 'button',
                  disabled: busy === true || (isParent !== true && item.review === true),
                  title: isParent === true ? '通过：把这一批标成已审核' : '通过：标记为已通过',
                  'aria-label': isParent === true ? '整批通过' : '通过',
                  'data-tip': isParent === true
                    ? `整批通过：把这一批 ${kids.length} 条子任务一起标成已审核`
                    : '人工审核这一条的执行结果：标记为已通过',
                  onClick: (e) => {
                    // 头部整行是展开/收起的热区，按钮必须自己吃掉点击。
                    e.stopPropagation()
                    if (isParent === true) {
                      if (typeof onApproveBatch === 'function') onApproveBatch(item.id)
                      return
                    }
                    onPatch({ review: true })
                  },
                },
                h(CheckIcon, { size: 13 }),
              )
            : null,
          /**
           * 状态徽标（id=352-D）。
           *
           * 执行中不再显示「执行中」三个字，只留一个转圈：这一列是竖着扫的，
           * 三个字占的宽度随字号变，而图标是一个定宽方块 —— 一列里只有它一个「词」，
           * 眼睛会被反复拉过去。转圈本身已经把「在跑」说清楚了。
           *
           * 尺寸（见 .plt-tag.running / .plt-tag.plt-run-only）：外框固定 26×20，与文字徽标
           * 的行高 20px 对齐，所以整列右边界不会因为这一条从文字变成图标而移动。
           * 其余状态（待执行/待审核/失败/中断）一个字都没改。
           * id=407：待执行现在也不画标记了（原先是空心圆点），所以只剩失败/中断那两档还画文字徽标。
           *
           * id=358：「已审核」这一档**不再画徽标**。已审核组里的每一条都必然是已审核
           *（进组条件就是 execute+review），右端再挂一个「已审核」等于把同一句话说 N 遍，
           * 而且它是整列里最长的一个词，把标题挤短最多。分组位置本身已经说明了状态，
           * 所以这条分支只留空 —— 不是隐藏（visibility），是真的不渲染节点。
           * 只影响这一档：其余状态照旧，`statusOf` 与分组判断一个字没动。
           *
           * id=368：**待审核这一档也去掉徽标**，理由与「已审核」同一个：
           * 进组条件就把状态说完了 —— 待在「待审核」组里，每条必然是待审核。
           * 右端再挂一个「待审核」= 把组名重复 N 遍，还是整列里较长的词。
           * 省下来的宽度给标题：待审核组是逐条扫读、逐条点「通过」的地方，
           * 标题截断得越少越好。
           * 于是 running 之外**只剩**需要「与所在组不同」的状态才画徽标
           *（待执行 / 草稿 / 失败 / 已中断），组内一致的两种（待审核 / 已审核）都不画。
           *
           * id=401：**待执行这一档从文字改成一个空心圆点**（题面：待执行组里
           * 显示一个文字不好看，换一种展示方式）。
           *
           * 为什么不是像待审核/已审核那样直接不画：
           * 待执行组里**不只有 todo**。执行中的显示转圈、失败的显示「失败」、
           * 中断的显示「已中断」—— 所以这一列是有内容的，不能整体留空。
           * 而「正常待执行」是组内主体，占绝大多少行；每行挂一个「待执行」
           * 等于把组名重复 N 遍，还都是同一个词，扫视时这一列毫无信息量。
           *
           * 空心圆点的语义：一个还没被勾掉的待办。它与执行中的转圈形成一组对照
           *（空圈 = 还没开始 / 转圈 = 正在跑），比文字更轻，也更容易在一列里
           * 一眼扫出「哪些还没动」。
           *
           * 尺寸仍是固定的 20×20 外壳（与文字徽标行高一致），所以这一列右边界
           * 不会因为某行从点变成字而移动 —— 与 id=352-D 给转圈定的规矩同源。
           * 点本身 7px + 1.5px 描边，颜色取 caption 而非组色：
           * 它是「尚未开始」的状态标记，不是组身份，用中性色才不会跟
           * 组头的彩虹 accent 打架。
           */
          status.key === 'running'
            ? h(
                'span',
                {
                  className: 'plt-tag running plt-run-only',
                  'data-tip': '任务正在执行中',
                  // 没有文字了，必须给可访问名，否则屏幕阅读器读到的是一个空 span。
                  'aria-label': '执行中',
                  role: 'status',
                },
                h(SpinnerIcon, { size: 13 }),
              )
            // id=407：待执行**不再画状态标记**（题面：这条设计方式不要了）。
            // 原来是 20px 的透明胶囊里放一颗 7px 空心圆点 —— 单独看还行，
            // 但它与「执行中」的转圈、其它状态的字徽标挤在同一列，
            // 而待执行组本身已经有组色（绿）标识身份，再挂一个灰圆点属于重复表达。
            // 现在三组统一：组名说明状态时不画徽标（待审核/已审核同理）。
            : status.key === 'todo' || status.key === 'reviewed' || status.key === 'unreviewed'
              ? null
                : h(
                    'span',
                    { className: `plt-tag ${status.key}` },
                    h('span', null, status.label),
                  ),
          /**
           * 头部删除入口（id=359 建，id=374 扩到待执行）。
           *
           * id=359 时只有「已审核」有：那是回看历史的地方，底部那排要先展开卡片才看得见，
           * 而删除恰恰是最不需要先读正文的动作。
           *
           * id=374 把**待执行**也纳进来，且要求「拆分的和单任务一视同仁」：
           * 这两类在数据里形状不同（一个父带 children、一个是普通条目），
           * 但在界面上都是待执行列表里的一行 —— 一行一个垃圾桶，位置统一在头部右端。
           * 于是「删掉这条」这个动作不再依赖「这条是不是批次」，用户不必记两套位置。
           *
           * 为什么用图标：头部是标题行，右侧已经有耗时 / 类型 / 状态 / 通过按钮；
           * 再塞一个两字中文会跟标题抢宽度，而垃圾桶是这行里唯一的破坏性动作，
           * 图标 + 红描边既省地方也不容易误点错行。
           *
           * title / aria-label / data-tip 三者措辞**按类型换句子**：
           * 批次是「删除整批」（会连带子任务），普通条目是「删除这条计划」。
           * 图标没有文字，读屏与悬停全靠这几个属性，措辞必须说清后果。
           *
           * 执行中（running）不给：正在跑的条目删掉会打断模型，与底部那排的取舍一致。
           */
          // id=405：头部这颗「转为草稿」按钮随草稿模式删除。
          // 它的唯一去向是草稿组，草稿组已不存在。
          (groupKey === 'reviewed' || (groupKey === 'todo' && running !== true))
            ? h(
                'button',
                {
                  className: 'plt-btn plt-icon-btn plt-trash plt-head-del',
                  type: 'button',
                  disabled: busy,
                  title: isParent === true ? '删除整批（含全部子任务）' : '删除这条计划',
                  'aria-label': isParent === true ? '删除整批' : '删除这条计划',
                  'data-tip': isParent === true ? '删除整批：父节点与它的全部子任务一起删掉' : '删除这条计划',
                  onClick: (e) => {
                    // 头部整行是展开/收起的热区，按钮必须自己吃掉点击。
                    e.stopPropagation()
                    if (typeof onRemove === 'function') onRemove()
                  },
                },
                h(TrashIcon, { size: 13 }),
              )
            : null,
        ),
        open && isParent === true
          ? h(
              'div',
              { className: 'plt-body plt-body-parent' },
              // 父自己的「计划 / 备注」一块都不画：它没有正文，备注是拆分批注，
              // 摊在这儿只会把子任务列表往下挤。展开就是要看这一批到底拆成了什么。
              h(KidsList, {
                // detail 取回的全量 children 优先（正文没被 lite 截断），没有就用列表那份。
                kids: loaded !== null && Array.isArray(loaded.children) && loaded.children.length > 0 ? loaded.children : kids,
                // id=371：只传 groupKey（耗时节点的显示条件要用它）。
                // busy / onPatch 已随「单个通过」按钮一起移除，理由见 KidsList 顶部。
                groupKey,
                // id=89-D：子任务的「执行中」也按派发记录判定，与父同一份数据。
                delivered,
                // id=fzTvER-C：父的序号与父 id —— 子任务行要显示成
                // `1 # QSX45D -A`：**序号与父条目相同**，不各自从 1 开始。
                //
                // 这两个值父组件本来就有（`seq` 是渲染时传进来的，`item.id` 就在手边），
                // 直接传下去即可，不需要去 children.js 里补字段，也不用客户端二次推算：
                // 子任务在同一批里共享父的位置，这是「位置」的语义，不是「身份」的语义。
                parentSeq: seq,
                parentId: item.id,
              }),
              // 原始提示词仍留在最下面：这一批当初是根据哪句话拆出来的。
              // 默认展开的组：待执行（id=375，批次）与待审核（id=387，全部）——
              // 默认值统一在 Item 顶部的 sourceOpen 算，这里不重复判断，
              // 否则「默认值」与「渲染条件」会变成两处口径。
              // 按钮行为不变：点一下仍可收起，收起后就只留这一行标题。
              (sourceText !== '' || (loaded === null && sourceLen > 0))
                ? h(
                    'div',
                    { className: 'plt-sec' },
                    h(
                      'button',
                      {
                        className: `plt-sec-toggle${sourceOpen ? ' open' : ''}`,
                        type: 'button',
                        'aria-expanded': sourceOpen === true,
                        'data-tip': sourceOpen ? '收起原始提示词' : `展开原始提示词（${sourceLen} 字）`,
                        onClick: (e) => {
                          e.stopPropagation()
                          setSourceOpen((v) => v !== true)
                        },
                      },
                      h(
                        'span',
                        { className: 'plt-sec-h' },
                        '原始提示词',
                        h('span', { className: 'plt-sec-hint' }, `${sourceLen} 字`),
                      ),
                      h('span', { className: 'plt-sec-caret' }, h(CaretIcon, { size: 12 })),
                    ),
                    sourceOpen ? h('div', { className: 'plt-source' }, sourceText !== '' ? sourceText : '（加载中…）') : null,
                  )
                : null,
              // id=395：批次这一档的 .plt-meta（子任务数 / 创建时间）**保留独立一行**。
              //
              // 题面说的是「计划那一排右侧」—— 而批次卡片**没有**「计划」那一排：
              // 父自己的正文恒为空，展开区的第一块直接就是子任务列表 + 原始提示词
              //（见上方 plt-body-parent 的注释）。没有可并入的行，硬塞就会变成
              // 在子任务列表中间插一行读数，比原来更乱。
              // 所以这里的取舍是：单任务合进「计划」排（题面明确要求），
              // 批次维持原样。等批次有了自己的标题行再说，不为对齐而制造新的一行。
              h(
                'div',
                { className: 'plt-meta' },
                h('span', null, `子任务：${kids.length} 条`),
                h('span', null, `创建：${fmtDate(item.createdAt) || '—'}`),
              ),
              h(
                'div',
                { className: 'plt-checks' },
                h(
                  'div',
                  { className: 'plt-actions' },
                  // id=359：已审核组里整批删除已经在头部右侧了（plt-head-del），
                  // 这里不再重复画一颗 —— 两处都调 onRemove(item.id)（父连带整批），
                  // 是同一件事，留两个入口只会让人犹豫该点哪个。
                  // id=374：待执行（todo）的整批删除也搬到头部了，原因同上 ——
                  // 而且这一档还要求「拆分的与单任务一视同仁」，所以两者的删除
                  // 必须落在同一个位置（头部右端），不能再一个在头、一个在底。
                  // id=382：待审核这一档的两颗按钮改成**图标**，且并排放在同一排里：
                  //   [✓ 通过] [🗑 删除整批]
                  // 两者共用 .plt-icon-btn 的尺寸与热区、共用同一套 hover/disabled 规则，
                  // 只有颜色不同（通过走主色、删除走删除色），右对齐与间距由 .plt-actions 保证。
                  //
                  // 为什么这一档要改：待审核是唯一「两个动作都高频」的分组 ——
                  // 一条看完要么通过、要么删掉重写。原来是「头部通过 + 底部删除整批」，
                  // 一个在上一行、一个在下一行，且一个是胶囊一个是文字，扫视时对不齐。
                  // 收进同一排之后，一行就是一次决策。
                  //
                  // id=386：待审核**不再提供删除入口**（题面：将删除功能去除）。
                  //   这一档只保留「通过」——审核的唯一动作就是把这条标成已通过。
                  //   想删的话，正确路径是先在别处处理它再删，
                  //   而不是在「正在评审」的这一步顺手把证据删掉。
                  //   一并说明：删掉图标之后，这一档**不能**再落到下面那个
                  //   「文字删除」的兜底分支（否则只是把图标换回文字，等于没删）——
                  //   所以兜底条件里也加上了 groupKey === 'unreviewed'。
                  // id=390：这一档的「通过」也已搬到**头部**（见上方 plt-head-pass-btn）。
                  // 展开区因此**什么都不画** —— 待审核卡片的操作全部收在头部，
                  // 展开只是用来看正文，不再承载动作。
                  // 仍然保留 groupKey === 'unreviewed' 分支（返回 null）而不是删掉它：
                  // 让下面那个 `: running || ...` 的兜底条件无需再改一次，
                  // 也让「待审核这一档由谁处理」在代码里仍然一目了然。
                  groupKey === 'unreviewed'
                    ? null
                    : running || groupKey === 'reviewed' || groupKey === 'todo'
                      ? null
                      : h(
                          'button',
                          {
                            className: 'plt-btn plt-del',
                            disabled: busy,
                            'data-tip': '删除整批：父节点与它的全部子任务一起删掉',
                            onClick: onRemove,
                          },
                          '删除整批',
                        ),
                ),
              ),
            )
          : open
          ? h(
              'div',
              { className: 'plt-body' },
              h(
                'div',
                { className: 'plt-sec' },
                h(
                  'div',
                  { className: 'plt-sec-h' },
                  h('span', null, '计划'),
                  // 「计划」标题右侧：复制内容、复制 ID。
                  h(
                    'span',
                    { className: 'plt-copy' },
                    // id=405：草稿就地编辑入口已随草稿模式删除。
                    // id=389/393/396：待审核、待执行、已审核这三组的复制按钮都已搬到**头部**
                    //（见上方 plt-head-copies）。
                    // 这里跳过它们，避免同一张卡上出现两个复制入口 ——
                    // 这两个动作在逐条扫读时是高频的，放头部就够得着，
                    // 展开区这一排因此只剩「提示词」那类补充复制。
                    // （id=405：草稿组已删除。）
                    //
                    // 三处条件必须与头部那个 `groupKey === 'unreviewed' || groupKey === 'todo'
                    // || groupKey === 'reviewed'` 保持一致 —— 否则会出现「头部有、展开区也有」
                    //（重复）或「两边都没有」（入口消失）。改一处就要改三处，
                    // 这是这段唯一的维护要点。
                    (groupKey === 'unreviewed' || groupKey === 'todo' || groupKey === 'reviewed' ? null : canCopyId === true)
                      ? h(
                          'button',
                          {
                            className: `plt-copy-btn${copied === 'id' ? ' done' : ''}`,
                            'data-tip': `复制这条计划的 ID（${item.id}）`,
                            onClick: (e) => {
                              e.stopPropagation()
                              void doCopy('id')
                            },
                          },
                          h(CopyIcon, { size: 12 }),
                          h('span', null, copied === 'id' ? '已复制' : 'ID'),
                        )
                      : null,
                    (groupKey === 'unreviewed' || groupKey === 'todo' || groupKey === 'reviewed' ? null : canCopyPlan === true)
                      ? h(
                          'button',
                          {
                            className: `plt-copy-btn${copied === 'plan' ? ' done' : ''}`,
                            'data-tip': '复制这条计划的完整内容',
                            onClick: (e) => {
                              e.stopPropagation()
                              void doCopy('plan')
                            },
                          },
                          h(CopyIcon, { size: 12 }),
                          h('span', null, copied === 'plan' ? '已复制' : '内容'),
                        )
                      : null,
                    // 复制原始提示词：拆解产物才有，点一下把这批任务当初的需求原文取走。
                    canCopyPrompt === true
                      ? h(
                          'button',
                          {
                            className: `plt-copy-btn${copied === 'prompt' ? ' done' : ''}`,
                            'data-tip': `复制这条任务的原始提示词（${item.sourcePromptLen} 字）`,
                            onClick: (e) => {
                              e.stopPropagation()
                              void doCopy('prompt')
                            },
                          },
                          h(CopyIcon, { size: 12 }),
                          h('span', null, copied === 'prompt' ? '已复制' : '提示词'),
                        )
                      : null,
                    // id=382：「通过」现在在**底部操作区**，与「删除」并排成一对图标
                    //（见这一排上方 plt-actions 那段）。这里（展开区的复制按钮排）
                    // 本来就没有它 —— 第 368 号曾把它搬去头部，第 382 号又搬到下面；
                    // 两次都只留一个入口，理由一致：同一屏出现两个「通过」会让人犹豫。
                    // 展开区的这一排保留复制类按钮（ID / 内容 / 提示词），它们仍然需要在
                    // 读到正文之后才用得上。
                  ),
                  // id=395：创建 / 开始 / 耗时这些「时间戳」从原来**独占一行**的
                  // .plt-meta 搬到「计划」这一排的**右侧**（题面要求）。
                  //
                  // 为什么合进来：那行元信息本来就只有三四个短片段，
                  // 独占一行等于在「计划」标题和正文之间插了一条几乎空着的横带 ——
                  // 一行只为了放「创建：2026/10/30」。而「计划」标题右侧现在
                  // 只有复制类按钮（高频动作都已搬到头部，见 id=389/393/394），
                  // 那一侧本来就有富余空间，正好收进来。
                  //
                  // 位置放在 .plt-copy **之后**：复制按钮是操作，时间戳是说明性的读数，
                  // 读数该在操作更外侧（贴着行尾），这样整行读起来是
                  // 「计划 [复制…] [创建…]」，操作集中、说明收口。
                  // 形态用 .plt-sec-meta（见 15-detail.js）：更小的字号 + 更淡的颜色，
                  // 明确它是「附注」而不是和标题同级的第二个标题。
                  // 它在 .plt-sec-h 内部 → 与标题、复制按钮同一行（flex + align-items:center），
                  // 不会因为换行把这一排撑成两行（.plt-sec-h 本身不换行）。
                  h(
                    'span',
                    { className: 'plt-sec-meta' },
                    item.mode ? h('span', null, `模式：${item.mode}`) : null,
                    h('span', null, `创建：${fmtDate(item.createdAt) || '—'}`),
                    item.startedAt ? h('span', null, `开始：${fmtDate(item.startedAt)}`) : null,
                    time ? h('span', null, `耗时：${time}`) : null,
                  ),
                ),
                // id=405：草稿就地编辑框（textarea + 任务类型切换 + 保存状态 + 取消）
                // 随草稿模式一并删除 —— 它只在 editable（草稿组）时渲染。
                // 现在正文一律只读展示，与其它组一致。
                h('div', { className: 'plt-plan' }, planText || '（空）'),
              ),
              noteText
                ? h('div', { className: 'plt-sec' }, h('div', { className: 'plt-sec-h' }, '备注 / 执行结果'), h('div', { className: 'plt-note' }, noteText))
                : (item.noteLen ?? 0) > 0
                  ? h('div', { className: 'plt-sec' }, h('div', { className: 'plt-sec-h' }, '备注 / 执行结果'), h('div', { className: 'plt-note' }, '（备注加载中…）'))
                  : null,
              // 拆解产物才有的「原始提示词」：这条计划当初是根据哪段需求拆出来的。
              // 手工提交的条目 sourcePrompt 为空，整段不渲染，展开后不会多出一块空框。
              // 默认折叠：原文可能很长（整段需求），默认铺开会把卡片撑得很长，
              // 用户是来看「做完了没」的，不是来重读需求的 —— 想看得自己点开。
              //
              // id=375：上面这段理由现在**只适用于单任务的待执行档**。
              // id=387：待审核里的（含单任务）也默认展开了 —— 审核要对照原始需求，
              // 那段原文正是判断依据，藏在折叠里等于让人先点开再评审。
              // 现在两档默认展开、两档默认折叠：
              //   展开 = 待执行里的批次（id=375）｜ 待审核里的全部（id=387）
              //   折叠 = 已审核里的全部 ｜ 待执行里的单任务
              // 这里（单任务渲染路径）在待审核组里因此是**展开**的：
              // 两条路径共用同一个 sourceOpen，默认值在 Item 顶部统一算，
              // 本处不做第二次判断 —— 否则「默认值」与「渲染条件」会变成两处口径。
              (sourceText !== '' || (loaded === null && sourceLen > 0))
                ? h(
                    'div',
                    { className: 'plt-sec' },
                    h(
                      'button',
                      {
                        className: `plt-sec-toggle${sourceOpen ? ' open' : ''}`,
                        type: 'button',
                        'aria-expanded': sourceOpen === true,
                        'data-tip': sourceOpen ? '收起原始提示词' : `展开原始提示词（${sourceLen} 字）`,
                        onClick: (e) => {
                          e.stopPropagation()
                          setSourceOpen((v) => v !== true)
                        },
                      },
                      h(
                        'span',
                        { className: 'plt-sec-h' },
                        '原始提示词',
                        h('span', { className: 'plt-sec-hint' }, `${sourceLen} 字`),
                      ),
                      h('span', { className: 'plt-sec-caret' }, h(CaretIcon, { size: 12 })),
                    ),
                    // id=375：同父批次路径 —— 默认展开后首屏可能还没有全文，
                    // 渲染空框会是一块有边框有内边距的空白。单任务默认仍是折叠，
                    // 但用户点开那一刻 detail 也可能还没回来，所以同样要兜。
                    sourceOpen ? h('div', { className: 'plt-source' }, sourceText !== '' ? sourceText : '（加载中…）') : null,
                  )
                : null,
              h(
                'div',
                { className: 'plt-checks' },
                // 「已执行」是模型自动回填的只读状态，三组都不再重复展示。
                showExecute === false
                  ? null
                  : h(
                      'label',
                      { className: 'plt-check locked', 'data-tip': '「已执行」由模型在执行完成后自动回填，不能手动修改' },
                      h('input', {
                        type: 'checkbox',
                        checked: item.execute === true,
                        disabled: true,
                        readOnly: true,
                      }),
                      h('span', null, '已执行'),
                    ),
                // 「审核通过」已按 id=193 搬到「计划」标题行的「提示词」之后（改名「通过」、
                // 复用 .plt-copy-btn），这里不再重复放一个入口，免得一张卡上两个审核按钮。
                // 「删除」统一收进右侧的 .plt-actions。
                h(
                  'div',
                  { className: 'plt-actions' },
                  // id=405：原来这里有一颗「转为待执行」（仅草稿组）。
                  // 草稿模式整体移除后它没有对象了 —— 不存在「在草稿里等人捞出来」的条目。
                  // id=376：「转为草稿」曾搬到头部，
                  // 这里不再重复画一颗。id=405 起那颗也随草稿模式删除了。
                  /**
                   * id=374：待执行的删除入口已从这一排**上移到头部右端**
                   *（见上方那颗 plt-head-del 的注释），这里不再重复画一颗。
                   *
                   * 原来这颗是 id=353 加在这里的：当时理由是「这一排已有两个文字按钮，
                   * 再加第三个会挤成两行」。那个理由仍然成立，只是结论要换个位置 ——
                   * 待执行的删除不该在展开区里等用户先展开卡片，而头部右端本来就是
                   * 已审核那一档删除的位置。两档统一过去，「删除这条」在待执行与已审核
                   * 里的位置就一致了，批次与单任务也一致（题面要求的「一视同仁」）。
                   *
                   * .plt-icon-btn / .plt-trash 这两个类没有废弃：头部那颗仍在用它们，
                   * 尺寸与删除色同源，只是挪了宿主节点。
                   */
                  // 执行中的条目整排操作都不给：删除直接隐藏，不留灰按钮。
                  // 待执行栏的删除已经在头部（id=374），这里不再重复放文字按钮 ——
                  // 一栏只留一个删除入口，免得用户犹豫该点哪个。
                  // id=359：已审核那一档的删除也在头部（plt-head-del）。
                  // 于是头部有删除图标的两档（待执行 / 已审核）底部都不再画；
                  // 待审核档的头部没有删除图标，底部这颗必须留着，
                  // 否则这两个入口就真的丢了。
                  // id=382：待审核（非批次）这一档的两颗按钮也改成图标，并排在同一排：
                  //   [✓ 通过] [🗑 删除]
                  // 与父批次那条路径保持完全一样的形态 —— 一张卡上是批次还是单条，
                  // 用户不该看出两种排法。
                  //
                  // id=390：这一档的「通过」也已搬到**头部**（见上方 plt-head-pass-btn）。
                  // 展开区因此什么都不画 —— 待审核卡片的操作全部收在头部。
                  // 条件与头部那颗一致（isParent !== true 时看 showReview 与 running）。
                  // 行为一字未改：仍是 onPatch({ review: true })。
                  // id=386：删除按钮已去掉（题面「将删除功能去除」）。
                  // 保留这个分支（返回 null）而不是删掉它：让下面那个兜底条件无需再改，
                  // 也让「待审核这一档由谁处理」在代码里仍然一目了然。
                  groupKey === 'unreviewed'
                    ? null
                    : running === true || groupKey === 'todo' || groupKey === 'reviewed'
                      ? null
                      : h(
                          'button',
                          {
                            className: 'plt-btn plt-del',
                            disabled: busy,
                            'data-tip': '删除这条计划',
                            onClick: onRemove,
                          },
                          '删除',
                        ),
                ),
              ),
            )
          : null,
      )
    }

    function PlanTasksTab(props) {
      const scope = props.scope ?? {}
      const ctx = props.ctx
      const sessionId = scope.sessionId ?? ''
      const cwd = scope.cwd ?? ''
      // 页签是否真的在前台可见。better-sidebar 的语义是「当前页签且右侧栏展开」，
      // 不可见时继续轮询纯属白烧流量与渲染。
      const visible = props.visible !== false
      // id=384：payload 必须**稳定引用**，否则「干完一条不派下一条」。
      //
      // 这是一个隐蔽的连锁反应，三步：
      //   1. 这里原来是 `const payload = { sessionId, cwd }` —— 每次渲染都新建一个对象；
      //   2. dispatchNext 的依赖数组里有 payload，于是它每次渲染都是新函数；
      //   3. 派发 effect 的依赖里有 dispatchNext，于是**每次渲染都会重跑 effect**：
      //      重跑 → cleanup 执行 → `if (!started) clearTimeout(timer)` → 定时器被取消。
      //      而面板在执行期间本来就在不停重渲染（轮询 sync、agentRunning、notice 计时器），
      //      DISPATCH_SETTLE_MS（1.2s）几乎总会被下一次渲染打断。
      //      结果就是：计时器永远走不到点，dispatchNext 永远不被调用 ——
      //      用户看到的现象正是「干完一个任务后没有自动下发下一个」。
      //
      // 用 useMemo 固定：sessionId / cwd 不变时，payload 是同一个对象引用，
      // dispatchNext 与 effect 也就不再抖动。
      //
      // 注意：**不能**只把 dispatchNext 的依赖改成 [] 来「解决」——
      // 那样它会永久捕获首次渲染的 payload，切会话后会把任务派进旧会话。
      // 这里修的是源头（引用不稳定），不是把症状盖住。
      const payload = React.useMemo(() => ({ sessionId, cwd }), [sessionId, cwd])
      // 输入框文本等面板状态按项目根目录隔离存放，刷新 / 重新挂载都不丢。
      const storeKey = `dsh-plan-tasks:${cwd || 'default'}`

      // id=405：这个函数原来叫 readDraft —— 名字里的「Draft」指的是「输入框草稿」，
      // 与草稿模式无关。但草稿模式删除后，这个名字会让人误以为它读的是草稿开关状态。
      // 改成 readSaved：它读的就是「面板上次保存的状态」，与草稿没有任何关系。
      const readSaved = () => {
        try {
          const raw = window.localStorage.getItem(storeKey)
          if (raw === null) return null
          const parsed = JSON.parse(raw)
          return parsed !== null && typeof parsed === 'object' ? parsed : null
        } catch {
          return null
        }
      }
      const saved = readSaved()

      const [state, setState] = React.useState({ loading: true, error: '', data: null })
      // 统一悬浮提示（id=249）：气泡挂在面板根上做事件委托，这里只提供根节点。
      // 250 会把各处原生 title 换成 data-tip，届时不用再动这一行。
      const rootRef = React.useRef(null)
      useTipLayer(rootRef)
      const [openId, setOpenId] = React.useState(saved?.openId ?? null)
      const [busy, setBusy] = React.useState(false)
      const [showInit, setShowInit] = React.useState(false)
      // id=405：**草稿模式整体移除**（题面：找出草稿模式的所有 UI 承载并删除，
      // 保证界面不再出现任何草稿相关元素）。
      // 原来这里有一个 draftMode 开关，点亮后「发送」把内容推进「草稿」组。
      // 现在没有草稿这个概念了：提交一律进待执行，不再有第二个落点。
      // 深入模式：点亮后「发送」会把输入框里的任务包装成一段要求「重写并做深」的提示词。
      const [deepMode, setDeepMode] = React.useState(saved?.deepMode === true)
      // 拆解模式：点亮后「发送」不直接落一条，而是交给宿主按项目情况拆成多条（落进待执行）。
      const [splitMode, setSplitMode] = React.useState(saved?.splitMode === true)
      // 拆解是异步 LLM 调用，比 append 慢得多，单独做「正在拆解…」的进度提示。
      const [splitting, setSplitting] = React.useState(false)
      // id=wZIKdd：顶栏的「自动确认」开关已按用户要求整体删除。
      // 它原本是个**空壳功能** —— settings.json 里存了 autoConfirm，
      // 但没有任何业务代码读它来执行自动审核（approveBatch 只看 backupBeforeTrim）。
      // 所以删除是干净的：不留行为空洞，也不影响任何既有流程。
      const [form, setForm] = React.useState({
        plan: typeof saved?.plan === 'string' ? saved.plan : '',
        mode: typeof saved?.mode === 'string' ? saved.mode : '',
        taskType: typeof saved?.taskType === 'string' ? saved.taskType : '修改',
        expanded: saved?.expanded === true,
      })
      const [notice, setNoticeState] = React.useState('')
      // 每条提示自己带一个停留时长（id=223）：默认 NOTICE_MS，个别调用处（拆分完成）
      // 显式要更久。用 ref 存是因为时长不是渲染内容 —— 放进 state 会白白多触发一轮渲染，
      // 而 effect 只需在文案变化时读一下当前值。每次调用都重置成默认值，
      // 免得「长提示」之后接着来的短提示继承了上一条的时长。
      const noticeMsRef = React.useRef(NOTICE_MS)
      const setNotice = (text, ms) => {
        noticeMsRef.current = typeof ms === 'number' && ms > 0 ? ms : NOTICE_MS
        setNoticeState(text)
      }
      const [dragId, setDragId] = React.useState(null)
      const [dropId, setDropId] = React.useState(null)
      // id=397：刚落下的那一条（播一记回弹确认「放好了」）。
      // 用 state 而不是直接改 DOM —— 与旁边两个拖拽状态同一套数据流，
      // 渲染层只管把类名拼上去（见 Item 的 className）。
      // 定时器要留住引用：连续快速拖两次时，后一次必须清掉前一次的 timer，
      // 否则第一次的回弹会在第二次拖拽途中被强行结束（或更糟：把状态清空）。
      const [droppedId, setDroppedId] = React.useState(null)
      const droppedTimerRef = React.useRef(null)
      // 「待审核」组里批量勾选的 id 集合。
      const [picked, setPicked] = React.useState(() => new Set())
      // 「已审核」组里批量勾选的 id 集合（用于批量删除）。
      const [pickedDone, setPickedDone] = React.useState(() => new Set())
      // id=405：草稿组的批量勾选状态随草稿组一并删除。
      // 分组展开态：手风琴互斥，同一时刻只有一个组展开（null = 全部折叠）。
      // 也存 localStorage，刷新后保持。
      // id=356：`null` 必须原样读回来。以前这里 `JSON.parse('null')` 得到 null 后
      // 走到最后一行 `return 'todo'` —— 也就是「所有组都收起」这个合法状态，
      // 一刷新 / 切页签重挂载就被翻译成「展开待执行」。审核完最后一条后正好会写进
      // 这个状态，于是看起来就像「点通过之后自动跳到了待执行」。
      const [openGroup, setOpenGroupState] = React.useState(() => {
        try {
          const raw = window.localStorage.getItem(`dsh-plan-tasks:groups:${cwd || 'default'}`)
          if (raw === null) return 'todo'
          const parsed = JSON.parse(raw)
          // 兼容旧版存的对象格式（{todo:true,...}），迁移成单个 key。
          if (typeof parsed === 'string') {
            // id=405：历史值可能是 'draft'（草稿组曾是可展开的一组）。草稿组已删，
            // 直接返回 'draft' 不会崩，但会让「没有任何组匹配 isOpen」——
            // 表现为刷新后所有组都收起了，用户会以为折叠状态没保存。
            // 归一成 null（明确的「全部收起」）更诚实，也与 id=356 的语义一致。
            return parsed === 'draft' ? null : parsed
          }
          // 「全部折叠」是一个真实的状态，不是「读不到」—— 直接返回 null，
          // 不要让它掉进下面的兜底分支。
          if (parsed === null) return null
          if (typeof parsed === 'object') {
            const first = ['todo', 'unreviewed', 'reviewed'].find((key) => parsed[key] === true)
            return first ?? null
          }
          return 'todo'
        } catch {
          return 'todo'
        }
      })
      const setOpenGroup = (next) => {
        setOpenGroupState(next)
        try {
          window.localStorage.setItem(`dsh-plan-tasks:groups:${cwd || 'default'}`, JSON.stringify(next))
        } catch {
          /* localStorage 不可用时忽略 */
        }
      }
      // 自动刷新：默认开启，每 AUTO_INTERVAL 秒静默重读一次 plan.json。
      const [auto, setAuto] = React.useState(saved?.auto !== false)
      const [tick, setTick] = React.useState(AUTO_INTERVAL)
      // 「开始干活」按钮的发送中状态（防连点）。
      const [starting, setStarting] = React.useState(false)
      // 暂停请求在飞（id=208）：挡住重复点击，也让按钮在请求期间进忙碌态。
      const [pausing, setPausing] = React.useState(false)
      // state 是快照：同一次渲染里连点两下，两份闭包都读到 pausing === false，
      // 于是会发两个 cancel。用 ref 做同步闸门，等重渲染救场已经太晚。
      const startingRef = React.useRef(false)
      const pausingRef = React.useRef(false)
      // id=234：模型响应中断的对账机制要用的三面旗子。
      // pausedByUserRef —— 这一轮是用户自己点暂停停的（暂停路径已经写过 interrupted，别再覆盖提示）；
      // wasRunningRef  —— 对账 effect 自己的上一帧 running。不能和派发共用：
      //   两个 effect 同一次提交里按声明顺序跑，谁先写谁就把 true→false 边沿吃掉。
      // wasDispatchRunningRef —— 派发 effect 自己的上一帧 running，只给「回答结束 → 派下一条」用。
      // reconcilingRef —— 对账请求在飞，别叠第二次。派发看到它是真的就等它落盘，不能因此丢掉边沿。
      // agentRunningRef —— 异步派发途中读「现在是不是又跑起来了」，闭包里的 agentRunning 是旧的。
      // dispatchEpochRef —— 换会话时加一，作废还在飞的派发，避免把上一个会话的下一条投进新会话。
      // id=352-E：初值必须是 null（**未知**），不能是 false。
      // 用 false 的话，页面刷新后第一次观测到的 running 已经是 false，
      // `was !== true` 直接 return —— 对账那次永远不跑，孤儿 startedAt 就再也救不回来。
      // 现在 null 表示「还没观测过」，第一次观测无条件对账一次。
      const pausedByUserRef = React.useRef(false)
      const wasRunningRef = React.useRef(null)
      const wasDispatchRunningRef = React.useRef(null)
      const reconcilingRef = React.useRef(false)
      const agentRunningRef = React.useRef(false)
      const dispatchEpochRef = React.useRef(0)
      // id=341：这一轮结束后是否已经派过下一条。会话 running 会抖（工具调用之间也算空闲），
      // 没有这个标记就会在同一个空档里连派几条。只在真正发出请求时置位；定时器被清掉或请求失败要放回来。
      const dispatchedRef = React.useRef(false)
      // id=384：「这一轮回答结束、但还没派发下一条」的待处理边沿。
      //
      // 为什么需要它（这是「干完一条不派下一条」的第二道保险）：
      // 派发靠 setTimeout 在 running 由 true→false 后等 1.2s 再动作，
      // 而这个 effect 的 cleanup 会取消未到点的定时器。只要结算期内面板重渲染一次
      // 且依赖随之变化，定时器就没了，边沿被白白消费掉 —— 之后再没有任何东西会补派。
      // 固定的引用（payload 用 useMemo）解决了绝大部分情况，但 effect 仍可能因
      // 其它原因重跑；有这面旗之后，「边沿还没人处理」这件事本身是可见的，
      // 下一次 effect 跑起来（无论因为什么）都能把它捡回来。
      const pendingEdgeRef = React.useRef(false)
      // 当前挂着的派发定时器（id=384）。用来避免「每次重渲染都重新挂一个」——
      // 那会把结算期无限推后，症状与「定时器被取消」相同（永远不派）。
      const dispatchTimerRef = React.useRef(null)
      // id=379：「完成后暂停」当前值 —— 派发 effect 要用它做闸门。
      //
      // 为什么必须是 ref 而不是直接读 state：派发 effect 的依赖只有
      // [agentRunning, sessionId, cwd]，它在**闭包里捕获的是那一次渲染的** pauseAfterDone。
      // 用户在第一轮跑到一半时拨开关，effect 不会重跑（依赖没变），
      // 于是它手里的还是旧值 —— 表现就是「拨了没用，下一条照样派出去」。
      // 用 ref 存「当前值」，异步回调与定时器里读到的永远是最新那份。
      // state 仍保留：界面渲染要用它触发重渲染。两者同源写入，见下面的 effect。
      const pauseAfterDoneRef = React.useRef(false)
      // 已挂起（id=208）：只存内存，不写 plan.json。页面刷新后按「有未完成且无 turn 在跑」
      // 自然回落为「未开始」，不需要一个跨会话会失效的持久状态字段。
      const [paused, setPaused] = React.useState(false)
      // id=377：「完成后暂停」开关 —— **本步只做 UI 结构与文案，状态源是占位变量**。
      //
      // 语义（题面）：开启后当前任务执行完不再自动派发下一个任务；关闭则继续自动派发。
      //
      // 为什么先只做占位：真正的拦截点在派发链路里（「这一轮结束后要不要派下一条」），
      // 那里现在由 `dispatchedRef` + running 的边沿驱动，改动它属于另一件事；
      // 本步先把控件、文案、显隐条件与可访问性落下来，让后续接上时不用再动结构。
      //
      // 命名就用 pauseAfterDone：与题面「完成后暂停」一一对应，
      // 不叫 autoDispatch 的反面 —— 否定式的开关名最容易被读反。
      const [pauseAfterDone, setPauseAfterDone] = React.useState(false)
      // id=379：把 state 同步进 ref，供派发 effect 在异步回调里读最新值。
      // 放在这里（state 声明旁边）而不是 effect 里，是为了「写入点只有一个」——
      // 无论是点击切换、空闲复位、还是以后别处改它，都会经过同一个 setPauseAfterDone，
      // 所以只要每次渲染同步一次就不会有落后的那一份。
      // 注意：这只覆盖「渲染之后」的读取；点击那一刻到下一次渲染之间，
      // 派发回调若正好跑起来读到的还是旧值 —— 下面 togglePauseAfterDone 里
      // 会**同步**写一次 ref，把那个窗口也关掉。
      // （ref 声明在这一段之前，见前面 pauseAfterDoneRef。）
      // id=379：开关的唯一写入口。
      //
      // 为什么要一个函数而不是直接用 setPauseAfterDone：
      //   1. 必须**同步**写 ref。React 的 setState 要等下一次渲染才生效，
      //      而派发 effect 里的定时器回调可能在同一个事件循环之后立刻跑 ——
      //      那时 state 还是旧值，读 state 会漏判。ref 是同步的，写进去立刻可见。
      //   2. 拨回「继续执行」时，要**立刻**把被拦下的那一条派出去（题面要求），
      //      不能等下一次 running 边沿 —— 那个边沿可能永远不会再来（已经空闲了）。
      // 两个方向都走这里，「谁改了它」永远只有一处。
      // 实现放在 dispatchNext 之后（见下方）—— 它要读 items / runningCount / sync /
      // dispatchNext，全都声明在组件更下面，写在这里会 TDZ。

      // 上一次列表数据的指纹，用来跳过「内容没变」的重渲染。
      const lastSignatureRef = React.useRef('')
      // 展开中的条目的正文 / 备注：列表只拿 lite 数据，展开时才按需取全文。
      const [detail, setDetail] = React.useState(null)
      // 可用模型目录 + 当前生效的选择（id=363）。挂载时立刻拉一次，
      // 所以「初始化完成」就等于「已经有一个可用模型」，不必先跑一条任务。
      const [modelState, setModelState] = React.useState({ providers: [], selection: null })
      // 「确实没有可用模型」（id=364）：只在 ensureModel 判定目录真的空时才置位。
      // 与「模型列表还没就绪」区分开 —— 后者会被等待 + 重试消化掉，不该弹任何东西。
      const [modelMissing, setModelMissing] = React.useState(false)
      // 「正在重新加载模型列表」：用户点引导按钮时的忙碌态，避免连点。
      const [modelLoading, setModelLoading] = React.useState(false)

      // 输入框草稿 / 展开项 / 自动刷新开关 / 深入模式 / 拆解模式，任何一项变化都落一次本地存储。
      // id=405：写入是「白名单式」的（显式列出字段，不是整体展开旧对象），
      // 所以老用户 localStorage 里残留的 draftMode 字段会在下一次写入时自然消失，
      // 不需要专门写一段清理代码。
      React.useEffect(() => {
        try {
          window.localStorage.setItem(storeKey, JSON.stringify({ ...form, openId, auto, deepMode, splitMode }))
        } catch {
          /* 隐私模式下写不进去就算了 */
        }
      }, [storeKey, form, openId, auto, deepMode, splitMode])

      const run = React.useCallback(
        async (fn) => {
          setBusy(true)
          setState((prev) => ({ ...prev, error: '' }))
          try {
            const data = await fn()
            setState({ loading: false, error: '', data })
            return data
          } catch (error) {
            setState((prev) => ({ ...prev, loading: false, error: error instanceof Error ? error.message : String(error) }))
            return undefined
          } finally {
            setBusy(false)
          }
        },
        [],
      )

      // 静默重读：不置 busy、不动 loading，避免自动刷新时按钮闪烁/输入被打断。
      // 自动刷新走 lite 模式：备注正文不进轮询载荷（历史备注占整份 json 七成体积），
      // 展开某一条时再单独取正文。指纹相同则整个跳过 setState。
      const sync = React.useCallback(async () => {
        try {
          const data = await call('read', { ...payload, lite: true })
          const signature = dataSignature(data)
          if (signature === lastSignatureRef.current) return
          lastSignatureRef.current = signature
          setState((prev) => ({ ...prev, loading: false, data }))
        } catch {
          /* 自动刷新失败时保持旧数据，不弹错 */
        }
      }, [sessionId, cwd])

      // —— 转组「升华」动画 ——
      // 记住上一次渲染时每条计划挂在哪个分组，任何一条换了分组
      // （待执行 → 待审核 → 已审核，或者退回）就在新分组里播一遍浮起动画。
      // 用数据指纹做 useMemo 依赖：自动刷新拿回一模一样的数据时不会重播。
      const groupOfItem = (it) => {
        // id=405：草稿组已移除，不再有 'draft' 这一档。
        if (it.execute === true) return it.review === true ? 'reviewed' : 'unreviewed'
        return 'todo'
      }
      const liveItems = state.data?.items ?? []
      // id=89-D：派发记录（由宿主 read 下发）。「执行中」靠它与条目 id 关联判定。
      // 每次轮询都重算 —— 派发记录一变（这轮投完了 / 下一条被投），
      // 状态立刻就跟着变，不会出现「本次没有派发、界面却显示执行中」的错位。
      // 拿不到时是 undefined，statusOf 会自动退化到只信 startedAt（向后兼容）。
      const delivered = state.data?.delivered
      const groupSig = liveItems.map((it) => `${it.id}:${groupOfItem(it)}`).join('|')
      const prevGroupsRef = React.useRef({ sig: '', map: new Map() })
      const moved = React.useMemo(() => {
        const prev = prevGroupsRef.current
        const ids = new Set()
        const groups = new Set()
        if (prev.sig !== '') {
          for (const it of liveItems) {
            const before = prev.map.get(it.id)
            const now = groupOfItem(it)
            if (before !== undefined && before !== now) {
              ids.add(it.id)
              groups.add(now)
            }
          }
        }
        return { ids, groups }
      }, [groupSig])
      const sublimeIds = moved.ids
      // 目标分组可能正折叠着，条目根本不在 DOM 里，动画等于没播。
      // 这些组的组头会亮一下，保证「审核通过」这类操作有明确反馈。
      const movedGroups = moved.groups
      const movedGroupKey = [...movedGroups].sort().join('|')
      const [arriveGroups, setArriveGroups] = React.useState(() => new Set())
      React.useEffect(() => {
        if (movedGroups.size === 0) return undefined
        setArriveGroups(new Set(movedGroups))
        const timer = window.setTimeout(() => setArriveGroups(new Set()), 980)
        return () => window.clearTimeout(timer)
      }, [movedGroupKey])
      React.useEffect(() => {
        const map = new Map()
        for (const it of liveItems) map.set(it.id, groupOfItem(it))
        prevGroupsRef.current = { sig: groupSig, map }
      }, [groupSig])

      // 「模型是不是真的在跑」——直接读 Client 的 sessions 服务里当前会话的 running。
      // 只看 plan.json 的 startedAt 不够：开工那一小段模型还没回写 startedAt，
      // 或者模型在思考 / 写代码时文件一直没变，按钮都会误判成「没在干活」。
      const [agentRunning, setAgentRunning] = React.useState(false)
      agentRunningRef.current = agentRunning === true
      React.useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId === '') {
          setAgentRunning(false)
          return undefined
        }
        const readRunning = () => {
          try {
            const list = ctx?.get?.('sessions')?.list
            if (list === undefined || typeof list.getSnapshot !== 'function') return false
            return list.getSnapshot()?.byId?.[sessionId]?.running === true
          } catch {
            return false
          }
        }
        setAgentRunning(readRunning())
        let off = null
        try {
          const list = ctx?.get?.('sessions')?.list
          if (list !== undefined && typeof list.subscribe === 'function') {
            off = list.subscribe(() => setAgentRunning(readRunning()))
          }
        } catch {
          off = null
        }
        return () => {
          try {
            if (typeof off === 'function') off()
          } catch {
            /* 退订失败忽略 */
          }
        }
      }, [sessionId])


      // —— 可用模型列表：初始化阶段就拉一次（id=363）——
      //
      // 原来这对数据只在「真发一次拆解请求」时才被问起，而宿主那边的
      // 路由来自 `session.requestHeader()` —— 会话一次请求都还没发过时它是 undefined，
      // 于是全新会话的第一次拆解必然报 no-route。用户唯一的绕法就是
      // 「先随便发条消息，再回来拆解」，这正是题面要拆掉的那条隐式依赖。
      //
      // 现在提到挂载阶段：面板一出现就拉目录，拿不到显式选择时立刻落一次默认，
      // 并把这笔写回状态。这样「初始化完成」就等于「模型可用」。
      //
      // 几个刻意的选择：
      // 1. **不挂进 `run()`**：那个是写型操作的忙碌壳子，会把整块面板置成 busy，
      //    第一屏就闪一下按钮禁用很难看。这里静默做，失败也不弹错 ——
      //    模型目录读不出来时，其余所有功能（增删改、审核、执行）都还能用。
      // 2. **只落一次默认**：判据是 `saved`（用户/上一轮显式存下的选择），
      //    不是 `selection`（那个永远有值）。拿 selection 判断的话，
      //    「自动选中的默认项」会被当成用户的选择，默认兜底就再也不触发了。
      // 3. **不覆盖用户已选的**：`saved` 只要在目录里就一个字都不改。
      // 4. 依赖只有 sessionId / cwd：会话切了就重新解析一遍，因为请求头是按会话来的。
      React.useEffect(() => {
        let alive = true
        void (async () => {
          let snapshot
          try {
            snapshot = await call('models', payload)
          } catch {
            return /* 目录读不出来：静默跳过，不打扰用户 */
          }
          if (!alive || snapshot === null || snapshot === undefined) return
          setModelState({ providers: Array.isArray(snapshot.providers) ? snapshot.providers : [], selection: snapshot.selection ?? null })
          // id=365：上次选的模型已经不在目录里了（下架 / 换 provider）。
          // 宿主那边已经把失效值按 null 处理，下面这段回写就是愈合动作本身。
          // 这里额外说一句，是因为「我明明选过，怎么变了」必须有解释 ——
          // 静默替换成默认模型会让人以为自己的选择被吞了。
          if (snapshot.stale === true) {
            const to = snapshot.selection === null ? null : snapshot.selection.model
            setNotice(to === null ? '上次选的模型已失效，当前没有可用模型' : `上次选的模型已失效，已改用 ${to}`, NOTICE_LONG_MS)
          }
          // 已经有显式选择（且在目录里）就什么都不做 —— 用户的决定优先。
          if (snapshot.saved !== null && snapshot.saved !== undefined) return
          const fallback = snapshot.selection ?? null
          if (fallback === null) return
          try {
            const written = await call('selectModel', { ...payload, provider: fallback.provider, model: fallback.model })
            if (alive) setModelState((prev) => ({ ...prev, selection: written?.selection ?? fallback }))
          } catch {
            /* 写不回也不影响这一次的可用性：selection 已经在手里了 */
          }
        })()
        return () => {
          alive = false
        }
      }, [sessionId, cwd])

      /**
       * 「重新加载模型列表」（id=364）。
       *
       * 只在「确实没有可用模型」的提示里出现。用户的处境通常是「刚配好 key / 刚连上
       * provider，面板还没刷新」—— 那时正确的动作不是让他重开页面，而是就地重试。
       *
       * 重试成功就顺手把默认落盘并收起提示；仍然失败则保留提示，让用户接着排查
       * （提示文案里已经写明「没配」还是「读不出来」两种情况）。
       */
      const reloadModels = React.useCallback(async () => {
        if (modelLoading) return
        setModelLoading(true)
        try {
          const snapshot = await call('models', payload)
          const picked = snapshot?.selection ?? null
          setModelState({ providers: Array.isArray(snapshot?.providers) ? snapshot.providers : [], selection: picked })
          if (picked === null) return
          setModelMissing(false)
          if (snapshot.saved === null || snapshot.saved === undefined) {
            try {
              await call('selectModel', { ...payload, provider: picked.provider, model: picked.model })
            } catch {
              /* 写不回不影响可用性 */
            }
          }
          setNotice(`已加载模型 ${picked.model}`, NOTICE_LONG_MS)
        } catch {
          setNotice('模型列表仍然读不出来，检查一下 provider 配置', NOTICE_LONG_MS)
        } finally {
          setModelLoading(false)
        }
      }, [modelLoading, sessionId, cwd])

      const items = state.data?.items ?? []

      // —— turn 结束上报（id=ImWOun 后续优化）——
      //
      // 为什么要做：宿主的「孤儿回收」原本靠「有没有产出（time / note）」推断
      // 「这一轮有没有跑起来」。于是「模型跑完了、只是没调 q.mjs done」会被误判成
      // 中断 —— 而这是**两个完全不同的信号**被混成了一个。
      //
      // 真正的信号「turn 是否结束」只有客户端有：`sessions.list` 的 running
      // 由 true 翻成 false 就是那一刻。这里在翻转时把它上报给宿主，
      // 宿主写 `turnEndedAt`，孤儿判据优先看这个字段。
      //
      // 为什么用 ref 记上一次而不是直接在 effect 里比：
      // `agentRunning` 是 state，effect 每次变化都会重跑，但我们只关心
      // **true → false** 这一个方向（false → true 是「开始了」，不是结束）。
      const prevRunningRef = React.useRef(false)
      React.useEffect(() => {
        const wasRunning = prevRunningRef.current
        prevRunningRef.current = agentRunning === true
        // 只处理「刚刚结束」这一跳；其余情况（包括首次挂载）一律不动作。
        if (!(wasRunning && agentRunning !== true)) return
        if (typeof sessionId !== 'string' || sessionId === '') return
        // 把所有「已经开始但没完成」的条目都报一遍 —— 正常情况下只有一条，
        // 但并发 / 上一次残留时可能是多条，逐条报比猜一条更稳。
        // 宿主端对同一条是幂等的（已有 turnEndedAt 就不重写）。
        const startedButOpen = (items ?? [])
          .filter(
            (it) =>
              it !== null
              && typeof it === 'object'
              && it.execute !== true
              && it.failed !== true
              && typeof it.startedAt === 'string'
              && it.startedAt !== ''
              && (typeof it.turnEndedAt !== 'string' || it.turnEndedAt === ''),
          )
          .map((it) => it.id)
        for (const id of startedButOpen) {
          // 失败不打扰用户：这只是给宿主补一个判据字段，不是主操作。
          // 报不上去最坏是退回「按产出 + 宽限」的老判据，不会更糟。
          call('markTurnEnd', { ...payload, id }).catch(() => null)
        }
      }, [agentRunning, items, sessionId])

      // 状态兜底：模型已经开始干活，但还没把 startedAt 写进 plan.json 的那几秒，
      // 把「待执行」里排在最前面的那条先按「执行中」展示，避免「AI 在跑，列表全写待执行」。
      // 模型一旦回填 startedAt，这里会自动让位给真实状态。
      const impliedRunningId = (() => {
        if (agentRunning !== true) return null
        const first = items.find(
          (it) => it.execute !== true && it.failed !== true && (typeof it.startedAt !== 'string' || it.startedAt === ''),
        )
        return first === undefined ? null : first.id
      })()

      // 「正在执行几条」的唯一口径：和列表里那些显示成「执行中」标签的条目逐条对齐。
      // 之前这里只数「有 startedAt 的待执行」，而界面上还会把排在最前面的那条
      // 还没写 startedAt 的待执行也显示成「执行中」（impliedRunning），
      // 于是会话在跑、模型还没回填的那几秒，上方写 0 条、下面却有一条「执行中」。
      // 现在统一交给 statusOf，两边不可能再对不上。
      // id=233：statusOf 把 interrupted 排在 running 之前，所以被中断的条目不会再被数进来。
      const runningCount = items.filter((it) => statusOf(it, impliedRunningId === it.id, delivered).key === 'running').length

      // id=378：「完成后暂停」在进入空闲（无执行中任务）时复位为默认「继续执行」。
      //
      // 为什么复位方向是 false：
      //   pauseAfterDone 的语义是「这一轮跑完之后先别派下一条」，是一个**针对当前这一轮**
      //   的临时决定，不是长期偏好 —— 任务跑完、界面回到空闲，那次决定的对象已经不存在了。
      //   留着 true 的话，下次开工会在用户毫无察觉的情况下停在第一条之后，
      //   症状是「点了开始，只跑了一条就不动了」，而且极难联想到是上一次那个开关没复位。
      //   所以默认值（继续自动派发）才是安全落点：漏派可以点一下补上，
      //   而「以为会继续却停了」会让人以为程序坏了。
      //
      // 判据用 runningCount 与 agentRunning —— 与「正在执行 N 条」那句、
      // 组头 data-running、以及开关自身的显隐条件同一个口径，不另算一套。
      //
      // 只在「从有到无」的**边沿**动作，且要求这段空闲稳定持续满 PAUSE_RESET_IDLE_MS：
      //   1. 边沿 —— 空闲期间每次 sync 都会重算，若不加边沿判断，会在空闲时反复写 state；
      //   2. 宽限 —— 会话的 running 在**工具调用之间**会短暂变 false（id=341 就为此
      //      专门用 dispatchedRef 挡连派）。一看到空闲就复位，一条跑十几步工具的任务
      //      会在第二个工具调用处被悄悄清掉：用户明明开着「完成后暂停」，它半路自己关了。
      //      这正是本步最容易写错的地方 —— 判据「看起来」是同一个 runningCount，
      //      但「瞬时为空」与「真的空闲」是两件事。
      //      所以起一个定时器，到点前又忙起来就取消（cleanup 里 clear）。
      //
      // 首次观测（wasBusy === null）不动作：页面刚加载时本来就没人跑，
      // pauseAfterDone 还是初值 false，没有需要复位的东西。
      const pauseIdleRef = React.useRef(null)
      React.useEffect(() => {
        const busyNow = agentRunning === true || runningCount > 0
        const wasBusy = pauseIdleRef.current
        pauseIdleRef.current = busyNow
        // 首帧：只记下这一帧，不动作（没人跑，也不该复位任何东西）。
        if (wasBusy === null) return undefined
        // 还在忙：把上一轮的定时器清掉（返回 undefined 会让 React 走 cleanup）。
        if (busyNow === true) return undefined
        // 从忙到闲：等宽限到点。期间又忙起来的话，本次 effect 的 cleanup 会取消它。
        // id=379：复位也走 ref —— 否则 state 变 false、ref 还停在 true，
        // 下一条永远派不出去（闸门读的是 ref）。
        if (wasBusy !== true) return undefined
        const timer = window.setTimeout(() => {
          pauseAfterDoneRef.current = false
          setPauseAfterDone(false)
        }, PAUSE_RESET_IDLE_MS)
        return () => window.clearTimeout(timer)
      }, [agentRunning, runningCount])

      // 当前「写着 startedAt 但还没完成」的条目 id：中断时要落盘成「已中断」的就是它们。
      // 放在这里而不是 pauseWork 里头算，是因为暂停的收尾阶段列表可能已被 sync 换过一轮。
      const startedIds = items
        .filter(
          (it) =>
            it.execute !== true
           
            && it.failed !== true
            && it.interrupted !== true
            && typeof it.startedAt === 'string'
            && it.startedAt !== '',
        )
        .map((it) => it.id)

      // 是否有任务正在执行（id=233 收紧口径）：只看「会话真的在跑」与「刚点下按钮那几秒」。
      // 原来还或上了 runningCount（= 有条目写着 startedAt），而 startedAt 在中断后是**故意保留**的
      // （续做的依据），于是被中断的条目会把 working 永久钉在 true —— 上方按钮一直显示
      // 「干活中」、开始/暂停全禁用，那正是用户报的 bug。startedAt 是「这条被做过」的痕迹，
      // 不是「此刻在跑」的证据；后者只有会话 running 能回答。
      const working = agentRunning || starting

      /**
       * id=235：渲染层兜底 —— 「发送中 / 暂停中」只描述「这一次点击的请求还在飞」，
       * 是纯内存态。一旦会话真的跑起来了，发送标记必须立刻让位：
       * 否则回包晚一点、或者回包干脆丢了，顶栏会一直停在「发送中…」，
       * 而上方的「干活中」又被 starting 顶着，模型明明在干活、界面上却像卡住。
       */
      React.useEffect(() => {
        if (agentRunning !== true || starting !== true) return undefined
        startingRef.current = false
        setStarting(false)
        return undefined
      }, [agentRunning, starting])

      /**
       * id=235：回包丢失的兜底 —— 一次点击的回包等太久就当它丢了，把内存标记放掉。
       * 「干活中」「发送中…」「暂停中」全部由这些标记驱动，任何一个漏放，
       * 界面上就会留下一句永远不该再出现的文案（这正是 id=235 要根治的残留）。
       * 有回包时 finally 会先把它清掉，这里的定时器到点只是空转。
       */
      React.useEffect(() => {
        if (starting !== true) return undefined
        const timer = window.setTimeout(() => {
          startingRef.current = false
          setStarting(false)
        }, ACTION_STALL_MS)
        return () => window.clearTimeout(timer)
      }, [starting])
      React.useEffect(() => {
        if (pausing !== true) return undefined
        const timer = window.setTimeout(() => {
          pausingRef.current = false
          setPausing(false)
        }, ACTION_STALL_MS)
        return () => window.clearTimeout(timer)
      }, [pausing])

      /**
       * id=235：换会话 / 换项目（等价于「连接重建」）时，把全部内存态清零。
       * 这些标记都不落盘，本来就不该跨会话继承；不清的话切过去会看到上一个会话
       * 残留的「发送中…」「暂停中」「继续」，而那个会话的条目一条都不在屏幕上。
       */
      React.useEffect(() => {
        startingRef.current = false
        pausingRef.current = false
        pausedByUserRef.current = false
        // 换会话 = 重新观测，回到「未知」。两面 running 边沿都要清，否则会把上一个会话的
        // true→false 当成这个会话的「回答结束」。
        wasRunningRef.current = null
        wasDispatchRunningRef.current = null
        reconcilingRef.current = false
        dispatchedRef.current = false
        dispatchEpochRef.current += 1
        setStarting(false)
        setPausing(false)
        setPaused(false)
      }, [sessionId, cwd])

      // id=209：只要有 turn 真的跑起来了，「已挂起」就该自动失效 —— 用户可能在左侧
      // 对话里直接接着聊，而不是点「继续」。不清的话按钮会一直停在「继续」上。
      // 放在 effect 里是因为它必须跟着 working 的变化走，且要等暂停请求收尾后再判。
      React.useEffect(() => {
        if (working === true && pausingRef.current !== true) {
          setPaused(false)
          // id=234：turn 又跑起来了（用户在左侧直接接着聊也算），主动暂停的事实已经不成立，
          // 不清的话下一轮真断了会被这里误当成「用户自己停的」而跳过对账。
          pausedByUserRef.current = false
        }
      }, [working])

      // 开始 / 暂停 这颗合成按钮的可用性（id=208，id=354 合并）：
      // 只由「有没有待办 / 是否在跑 / 有没有挂起」三个既存事实推导，
      // 不另存一份状态，否则四个来源迟早对不上。
      const pendingCount = items.filter((it) => it.execute !== true).length
      // 「已挂起」= 主动暂停过，且此刻确实没在跑。pause 请求刚发出、turn 还没停下时仍算执行中。
      const pausedIdle = paused === true && working !== true
      const canStart = busy !== true && starting !== true && working !== true && pendingCount > 0
      const canPause = busy !== true && pausing !== true && working === true

      // 自动刷新：按「截止时间」驱动，倒计时只是展示。
      // 旧实现用「倒计时归零」来触发刷新，setInterval 抖动时 left 会停在 1 不归零，
      // 于是界面卡在 1s、实际不再刷新（执行中把间隔压到 1s 时尤其明显）。
      // 现在每次 tick 直接比较 Date.now() 与 deadline，到点就刷新，与倒计时显示解耦。
      //
      // 【维护须知（id=283：这个功能不许顺手删）】
      // 面板自己不产生计划状态 —— 模型用 `.plan/q.mjs` 改 plan.json，宿主把结果写盘，
      // 页签要看见就必须有人去读。谁在读：
      //   1. 这里：auto 打开时每 5 秒静默 `sync()` 一次，是**唯一**的周期性读盘；
      //   2. 切回前台 / 窗口聚焦 / pageshow / 会话由空闲翻成执行中各补一次（下方三个 effect），
      //      但都只补**一次**，不是周期。
      // 所以删掉这段 = 模型干完活面板不动，用户只能重开页签。要改只能改间隔或
      // 触发方式，不能用「看起来没人用」为理由整段移除。
      // id=357：顶栏那颗手点「刷新」的按钮已经移除 —— 上一版这里还写着「用户手点刷新」，
      // 现在手动刷新的唯一手段就是下面这个 auto 开关（关掉后靠 2 里的几个时机补读）。
      // 关闭 auto 时定时器清掉、倒计时显示 0 —— 那是用户显式选择不自动读盘。
      React.useEffect(() => {
        if (!auto || !visible) {
          if (!auto) setTick(0)
          return undefined
        }
        const interval = runningCount > 0 || agentRunning ? AUTO_INTERVAL_RUNNING : AUTO_INTERVAL
        const intervalMs = interval * 1000
        let deadline = Date.now() + intervalMs
        setTick(interval)
        const timer = setInterval(() => {
          const now = Date.now()
          if (now >= deadline) {
            // 刷新后从当前时刻重新计时，避免定时器漂移累积成「连着补刷」。
            deadline = now + intervalMs
            setTick(interval)
            void sync()
            return
          }
          setTick(Math.max(1, Math.ceil((deadline - now) / 1000)))
        }, AUTO_TICK_MS)
        return () => clearInterval(timer)
      }, [auto, visible, sync, runningCount, agentRunning])

      // 会话从「空闲」翻成「执行中」（或反过来）时立刻补一次读取：
      // 开工/收工这两个瞬间最需要马上反映到列表状态上，等下一个 5 秒太迟。
      React.useEffect(() => {
        if (!auto) return undefined
        void sync()
        return undefined
      }, [auto, sync, agentRunning])

      // 页签从后台切回前台时立刻补一次：不可见期间定时器是停的，回来后要马上同步。
      React.useEffect(() => {
        if (!auto) return undefined
        if (visible) void sync()
        return undefined
      }, [auto, visible, sync])

      // 标签页切回前台 / 窗口重新聚焦时立刻补一次：
      // 后台标签的定时器会被浏览器节流，仅靠 setInterval 会看起来「不动了」。
      React.useEffect(() => {
        if (!auto) return undefined
        const kick = () => {
          if (document.visibilityState === 'hidden') return
          void sync()
        }
        document.addEventListener('visibilitychange', kick)
        window.addEventListener('focus', kick)
        window.addEventListener('pageshow', kick)
        return () => {
          document.removeEventListener('visibilitychange', kick)
          window.removeEventListener('focus', kick)
          window.removeEventListener('pageshow', kick)
        }
      }, [auto, sync])

      React.useEffect(() => {
        let alive = true
        ;(async () => {
          const data = await run(() => call('read', payload))
          if (!alive) return
          if (data !== undefined && data.planExists !== true) setShowInit(true)
        })()
        return () => {
          alive = false
        }
      }, [sessionId, cwd])

      // 展开某一条时按需取它的正文与备注（列表只拿 lite 数据）。
      const fetchDetail = React.useCallback(async (id) => {
        try {
          const value = await call('detail', { ...payload, id })
          if (value !== null && typeof value === 'object' && value.id === id) setDetail(value)
          return value
        } catch {
          return null
        }
      }, [sessionId, cwd])

      // 切换展开项：真正的取全文交给下面的 effect（openId 变化即触发）。
      const toggleItem = (id) => {
        setOpenId(openId === id ? null : id)
      }

      // 展开中的那条如果被别处改动（模型回写备注、自己被编辑），要重新取全文。
      // 判据是 lite 列表里它的长度/耗时指纹，指纹没变就不重复下载备注。
      // 必须带上「原始提示词」的长度：全量 read 的投影里它没有 sourcePromptLen、只有
      // sourcePrompt 全文，只算 planLen/noteLen 会让「首次由全量数据换 lite 数据」时
      // stamp 不变 → detail 永远不发 → 展开区的原文一直停在「加载中…」（id=194 抓到）。
      const openStamp = (() => {
        if (openId === null) return ''
        const it = (state.data?.items ?? []).find((x) => x.id === openId)
        if (it === undefined) return ''
        const srcLen = Number(it.sourcePromptLen ?? 0) || (typeof it.sourcePrompt === 'string' ? it.sourcePrompt.length : 0)
        // id=273：父节点的正文恒为空，只看它自己的指纹就永远不变 —— 子任务做完、
        // 审核通过都不会触发重新取详情，展开区就停在旧数据上。children 的子指纹一并算进去。
        const kids = Array.isArray(it.children)
          ? it.children.map((c) => `${c.id}:${c.execute === true ? 1 : 0}${c.review === true ? 1 : 0}:${c.noteLen ?? 0}:${c.time ?? 0}`).join(',')
          : ''
        return `${it.id}:${it.planLen ?? 0}:${it.noteLen ?? 0}:${it.time ?? 0}:${srcLen}:${kids}`
      })()
      React.useEffect(() => {
        if (openId === null) {
          setDetail(null)
          return undefined
        }
        void fetchDetail(openId)
        return undefined
      }, [openId, openStamp, fetchDetail])

      const doInit = async () => {
        const data = await run(() => call('init', payload))
        if (data !== undefined) {
          setShowInit(false)
          setNotice('已创建 .plan/plan.json；执行技能已内置，无需同步')
        }
      }

      const append = async () => {
        if (form.plan.trim() === '') {
          setState((prev) => ({ ...prev, error: '计划内容不能为空' }))
          return
        }
        // 拆解模式：不落一条，交给宿主按项目实际情况拆成 N 条。
        // id=262 起不再「深入模式被短路」：两个开关可以同时点亮，
        // 深入会作用到每一次拆解（见 split()），拆出来的每条子任务都按「做深」的要求写。
        if (splitMode) {
          await split()
          return
        }
        // 最终提示词统一由 composePrompt 拼（id=262）：仅回答前缀独占一行、
        // 深入模式先包模板再叠前缀，且自带幂等与 CRLF 归一。以前这段在 append 里手拼，
        // split() 那边另有一套，两处规则迟早走散。
        // id=405：draft 选项已随草稿模式移除，这里不再传它。
        const text = composePrompt({
          text: form.plan,
          taskType: form.taskType,
          deep: deepMode,
        })
        const data = await run(() =>
          // mode 由宿主按 taskType 推（客户端没有模式下拉，form.mode 恒为空串）；
          // 显式传 taskType 就够了，这里保留 mode 字段是为了将来加真下拉时不必改协议。
          call('append', { ...payload, plan: text, mode: form.mode, taskType: form.taskType }),
        )
        if (data !== undefined) {
          // 提交后停留在当前视图：只清空输入框并就地给一条提示，
          // 不展开新计划、不滚动列表、不切换选中项（否则会“跳走”）。
          setForm({ plan: '', mode: form.mode, taskType: form.taskType, expanded: false })
          // id=388：**不再自动展开待执行组**（题面：发送消息时不再自动展开）。
          //
          // 原来这里是 `setOpenGroup(draftMode ? 'draft' : 'todo')`，想让刚提交的
          // 计划立刻可见。但代价是：用户如果正看着「待审核」或「已审核」，
          // 一发消息就被拽回待执行组 —— 分组折叠状态是**用户自己设的视角**，
          // 不该被一次提交改掉。而「刚写进去的那条在哪」其实已经由
          // 下面那句 notice 说明了，不依赖展开。
          // 提交即刷新，并把倒计时拨回起点。
          await sync()
          setTick(AUTO_INTERVAL)
          // 提交后不再自动开工：开工由用户在「待执行」下方的「开始干活」按钮手动触发。
          // id=405：草稿模式移除后，「已存入草稿」这条分支不会再有。
          setNotice(
            deepMode
              ? `已追加计划 #${data.item?.id ?? '?'}（深入模式，已改写提示词）`
              : `已追加计划 #${data.item?.id ?? '?'}`,
          )
        }
      }

      /**
       * 确保「现在能用某个模型」（id=364）。
       *
       * 拆解是唯一真调模型的入口，所以这道校验只挂在这里。它要解决的是三件事，
       * 而原来的实现（如果 `modelState.selection` 为空就直接拦）三件都做错：
       *
       * 1. **空值 ≠ 没配模型**。`modelState.selection` 只是「上一轮拉到的结果」，
       *    首次挂载的那一小段时间它必然是 null（请求还在飞）。直接拦会造成
       *    「第一次点拆解被拦、等两秒再点就好了」的时序坑。所以先**等**一次，
       *    再**重试**一次目录请求（`call('models')`），而不是拿一个还没就绪的
       *    本地快照当结论。
       * 2. **拿得到就不该拦**。按 已有选择 > 默认模型 > 列表首个 的优先级挑一个
       *    （宿主侧 `model-route.js` 的解析链已经就是这个顺序，这里只是消费它），
       *    挑到了就继续拆，不再弹「没有选择模型」。
       * 3. **真的一个都没有才提示，并且给可点的出路**。目录为空 / 全部 provider 都
       *    探测失败时，提示里要说清是「没配」还是「读不出来」，并给一个「重新加载
       *    模型列表」的按钮 —— 只告诉用户「不行」而没有下一步，是这个提示最糟的形态。
       *
       * @returns {Promise<{provider:string, model:string}|null>} 可用路由；null 表示确实没有
       */
      const ensureModel = React.useCallback(async () => {
        // 先看手里这份快照：初始化 effect 已经拉过一次，命中就不用再问。
        if (modelState.selection !== null && modelState.selection !== undefined) return modelState.selection
        // 快照是空的：可能是「还没就绪」，也可能是「真的没有」。
        // 给初始化那一次请求一点时间落地（它和本函数几乎同时发出），再自己问一次 ——
        // 这就是题面说的「等待或重试一次」。
        for (let attempt = 0; attempt < MODEL_READY_ATTEMPTS; attempt += 1) {
          if (attempt > 0) await new Promise((resolve) => window.setTimeout(resolve, MODEL_READY_GAP_MS))
          let snapshot
          try {
            snapshot = await call('models', payload)
          } catch {
            continue // 这一次读失败：还有下一次
          }
          const picked = snapshot?.selection ?? null
          if (picked !== null) {
            // 顺手把这个结果记进状态：后面的气泡提示与按钮文案都读它。
            setModelState({ providers: Array.isArray(snapshot.providers) ? snapshot.providers : [], selection: picked })
            // 首次拿到默认值时也落一次盘，下次打开直接命中（和初始化 effect 同一套判据）。
            if (snapshot.saved === null || snapshot.saved === undefined) {
              try {
                await call('selectModel', { ...payload, provider: picked.provider, model: picked.model })
              } catch {
                /* 写不回不影响这一次能不能拆 */
              }
            }
            return picked
          }
          // 目录读到了但是没有可用项：不用再重试，重试也不会变出模型来。
          if (Array.isArray(snapshot?.providers)) {
            setModelState({ providers: snapshot.providers, selection: null })
            return null
          }
        }
        return null
      }, [modelState.selection, sessionId, cwd])

      /**
       * 拆解模式提交：交给宿主收集项目快照 → 一次 LLM → 写成 N 条。
       * id=405：草稿开关已删除，拆解产物一律进待执行。
       * 宿主会做幂等（同一句话重复提交不会产生重复条目）与原子写。
       */
      const split = async () => {
        if (splitting) return
        const text = form.plan.trim()
        if (text === '') {
          setState((prev) => ({ ...prev, error: '要拆解的内容不能为空' }))
          return
        }
        // 入口校验（id=364）：先确保有模型可用，再动手。
        // 注意顺序 —— 放在 `setSplitting(true)` **之前**：模型都还没定就不要先挂遮罩，
        // 否则「确实没有模型」时用户会先看到一个转圈、再看到一个失败，白等一场。
        const route = await ensureModel()
        if (route === null) {
          // 走到这里说明目录是真的空（或者全部 provider 都探测失败）。
          // 提示带上「重新加载」按钮 —— 有出路比说清楚更重要。
          setModelMissing(true)
          return
        }
        setModelMissing(false)
        // id=405：草稿模式移除后，拆解**固定落在待执行**，不再有第二个落点。
        setSplitting(true)
        setState((prev) => ({ ...prev, error: '' }))
        setNotice(`正在按项目情况拆解…（模型 ${route.model}）`)
        try {
          const data = await call(
            'decompose',
            {
              ...payload,
              question: text,
              mode: form.mode,
              taskType: form.taskType,
              // id=262：深入开关以前在拆解分支里被完全丢掉，用户在面板上点亮了「深入」
              // 却看不出任何差别。现在把意图明确传给宿主，由拆解提示词要求每条子任务
              // 都按「做深而不是做大」来写。
              deep: deepMode === true,
            },
            // 拆解要跑一次模型，给足 3 分钟；超时也一定会抛出来 → finally 里摘掉遮罩。
            { timeoutMs: 180000 },
          )
          // 模型一回来就摘遮罩：后面的 sync() 还要等一轮读盘，不该让用户继续看着遮罩。
          setSplitting(false)
          if (data?.duplicate === true) {
            setNotice('这份需求已经拆解过了，没有重复产生条目')
          } else {
            const count = Array.isArray(data?.created) ? data.created.length : 0
            const cut = Array.isArray(data?.cut) ? data.cut : []
            const missing = Array.isArray(data?.missingPaths) ? data.missingPaths : []
            const tips = []
            if (cut.length > 0) tips.push(`建议砍掉：${cut.join('；')}`)
            if (missing.length > 0) tips.push(`模型提到了不存在的文件：${missing.join('、')}`)
            // id=405：草稿落点已移除，拆解产物一律进待执行。
            // id=223：这条会带「建议砍掉 / 模型提到了不存在的文件」等附加信息，实测能到 79 字，
            // 默认 3.8 秒读不完，单独给更长时长。上面的「已拆解过了」是短答复，仍走默认。
            // id=262：深入模式下补一句，否则用户看不出这个开关到底做了什么。
            setNotice(
              `已拆解 ${count} 条到待执行${deepMode ? '（深入）' : ''}${tips.length > 0 ? ` · ${tips.join(' · ')}` : ''}`,
              NOTICE_LONG_MS,
            )
          }
          setForm({ plan: '', mode: form.mode, taskType: form.taskType, expanded: false })
          // id=388：同样不再自动展开（原因见 submit 那段注释）。
          // 拆解会一次落 N 条到待执行，但「落了几条」notice 里已经写了
          //（`已拆解 N 条到待执行…`），不需要再靠切分组来表达。
          await sync()
          setTick(AUTO_INTERVAL)
        } catch (error) {
          setState((prev) => ({
            ...prev,
            error: `拆解失败：${error instanceof Error ? error.message : String(error)}`,
          }))
        } finally {
          setSplitting(false)
        }
      }

      /**
       * 把「正在跑但被打断了」的条目落盘成「已中断」（id=233）。
       *
       * 为什么必须写盘：`startedAt` 是「继续 = 续做而不是重跑」的唯一依据，所以中断时**不能**清空它；
       * 而 `statusOf` 原来只要有 `startedAt` 就判「执行中」，于是被中断的条目会永久显示
       * 「执行中」、上方按钮永久显示「干活中」。新增的 `interrupted` 标记就是为了在这种
       * 「startedAt 还在、但 turn 已经停了」的状态下给出正确标签 —— 它必须持久化，
       * 因为「已挂起」原本是纯内存态（`paused`），刷新页面就丢，刷新后又变回「执行中」。
       *
       * 只挑「有 startedAt 且未完成、未中断」的条目：还没写 startedAt 的那条（`impliedRunningId`）
       * 不标中断 —— 它本来就没有开工痕迹，标了反而会在真正开跑时一直挂着「已中断」。
       */
      const markInterrupted = async (ids, value = true) => {
        const list = [...new Set(ids)]
        if (list.length === 0) return 0
        let done = 0
        for (const id of list) {
          try {
            await call('update', { ...payload, id, patch: { interrupted: value } })
            done += 1
          } catch {
            // 单条写失败不牵连同批其他条目：这一条下次中断/刷新时还会被再判一次。
          }
        }
        // 乐观更新：把标记先落进本地列表，界面立刻从「执行中」跳到「已中断」，
        // 不必等下一轮 sync（自动刷新最快也要 3~5 秒）。
        if (done > 0) {
          setState((prev) => {
            if (prev.data === null) return prev
            return {
              ...prev,
              data: {
                ...prev.data,
                items: (prev.data.items ?? []).map((it) => (list.includes(it.id) ? { ...it, interrupted: value } : it)),
              },
            }
          })
        }
        return done
      }

      /** 手动开工：把队首任务的派发正文发进当前会话，和一轮结束后的自动派发是同一段话。
       * 这样模型不用先读技能、再跑 status 才知道做什么。
       * id=209 起兼任「继续」：队首若已派过还没 done，force 会把同一条再发一遍（带上次做到）。 */
      const startWork = async () => {
        // 按钮 disabled 只是第一层：这里再挡一次，避免「执行中连点」重复灌提示词。
        // working 为 false 但 paused 为 true 时放行 —— 那正是「继续」的入口。
        if (startingRef.current || starting || working) return
        const resume = paused === true
        startingRef.current = true
        setStarting(true)
        // 续做前先记下要摘掉「已中断」标记的那一条：`startedAt` 还在，摘掉标记后
        // 它会自动回到「执行中」—— 用户点的是「继续」，界面就该显示在跑。
        // 只摘**数组里最靠前**的那一条：技能规定多条带 startedAt 时只续做最靠前的那条，
        // 全部摘掉会让后面那些明明没在跑的条目也显示成「执行中」。
        const resumeOne = (items ?? []).find(
          (it) => it.interrupted === true && it.execute !== true,
        )
        const resumeIds = resumeOne === undefined ? [] : [resumeOne.id]
        setPaused(false)
        try {
          const preview = await call('dispatch', { ...payload, dryRun: true, force: true })
          if (preview === null || typeof preview !== 'object' || preview.dispatched !== true) {
            if (resume) setPaused(true)
            setNotice(preview?.reason === 'empty' ? '没有可执行的待办' : '没有可派发的任务', NOTICE_LONG_MS)
            return
          }
          const text = typeof preview.text === 'string' ? preview.text : ''
          let sent = false
          try {
            sent = await kickoffViaClient(ctx, sessionId, text)
          } catch (error) {
            sent = false
            if (error instanceof Error && error.message !== '') throw error
          }
          // 浏览器发出去之后只记账（ack），避免宿主再 prompt 一次变成两条用户消息。
          if (sent) await call('dispatch', { ...payload, force: true, ack: true })
          else await call('dispatch', { ...payload, force: true })
          setNotice(`${resume ? '继续' : '已派发'}：${preview.taskId}`, NOTICE_LONG_MS)
          // id=234：新一轮开跑了，主动暂停的标记要撤掉，否则下一轮中断不会被对账处理。
          pausedByUserRef.current = false
          // 发送成功了才摘标记：发不出去还留在「已中断」是对的，不能被这次点击洗掉。
          if (resumeIds.length > 0) await markInterrupted(resumeIds, false)
        } catch (error) {
          // 发送失败要把「已挂起」还回去，否则界面会显示「继续」但其实什么都没发出去。
          if (resume) setPaused(true)
          setState((prev) => ({
            ...prev,
            error: `派发失败：${error instanceof Error ? error.message : String(error)}`,
          }))
        } finally {
          startingRef.current = false
          setStarting(false)
        }
      }

      /**
       * 挂起当前执行（id=208）。
       *
       * 只中止当前 turn，plan.json 里已写进去的 startedAt / note / execute
       * 一个字段都不动，所以再点「开始」能接着做而不是从头来。
       * 优先走浏览器侧的 `session.cancel()`；那条路不可用（没有绑定、旧版本）才回落到宿主 cancel 路由。
       *
       * id=233：收尾阶段必须把「正写着 startedAt 的那几条」落盘成 `interrupted: true`。
       * 只设内存里的 `paused` 不够 —— 刷新页面就丢，条目又变回「执行中」，那正是用户报的病。
       */
      const pauseWork = async () => {
        // 与 canPause 对齐：忙、正在发暂停、或此刻根本没在跑，都不发第二个 cancel。
        if (pausingRef.current || pausing || starting || working !== true) return
        pausingRef.current = true
        setPausing(true)
        // 先拍一张快照：cancel 成功后列表可能已经被 sync 换过一轮，那时再算就晚了。
        const interruptedIds = startedIds
        // 中止是否真的被受理：只有受理了才把条目判成「已中断」。
        // 两条路都失败时 turn 还在跑，条目继续显示「执行中」才是对的。
        let accepted = false
        try {
          let stopped = false
          try {
            stopped = await stopViaClient(ctx, sessionId)
          } catch (error) {
            stopped = false
            if (error instanceof Error && error.message !== '') throw error
          }
          if (!stopped) await call('cancel', payload)
          accepted = true
          // id=234：这一轮是用户主动停的，别再让「模型响应中断」的对账去覆盖提示文案。
          pausedByUserRef.current = true
          setPaused(true)
          setNotice('已挂起当前执行，进度已保留')
        } catch (error) {
          setState((prev) => ({
            ...prev,
            error: `暂停失败：${error instanceof Error ? error.message : String(error)}`,
          }))
        } finally {
          // 放在 finally 里：无论走哪条路径、是否已经抛错，只要中止确实被受理，
          // 「执行中」这个显示就已经是错的，必须对齐成「已中断」。
          // 写盘失败只影响单条，markInterrupted 内部已经吞掉逐条异常。
          if (accepted) await markInterrupted(interruptedIds)
          pausingRef.current = false
          setPausing(false)
        }
      }

      /**
       * id=234：模型响应中断（断流 / 超时 / 请求报错）时的状态同步。
       *
       * 这类中断拿不到任何「原因」：客户端能观测到的唯一信号就是会话 running 从 true 翻成 false
       * —— 客户端和宿主都没有 turn 结束事件的订阅（id=231 已核实 `ctx.on(` 全库零命中）。
       * 所以这里做的是**翻下去之后的对账**：等 INTERRUPT_SETTLE_MS 让收尾写盘落定，再回读一次
       * plan.json；如果还有条目「写着 startedAt 却没完成」，说明这一轮没走到回填 execute 就被掐断了。
       *
       * 为什么不会误伤正常收工：模型收工前一定先写 execute=true，那时这些条目已经不在
       * 「未完成 + 有 startedAt」的集合里，对账结果是空的，什么都不会写。
       * 为什么以磁盘为准而不是内存 items：中断这段时间自动刷新可能一次都没成功过，
       * 内存里的列表可能还停在开工前。
       * 为什么跳过主动暂停：pauseWork 已经写过一遍 interrupted，再写一次只会在界面上
       * 用「执行已中断」盖掉「已挂起当前执行」这句更准确的提示。
       */
      React.useEffect(() => {
        const was = wasRunningRef.current
        wasRunningRef.current = agentRunning === true
        // id=352-E：两处放宽。
        //   1. 首次观测（was === null）也做一次对账 —— 页面刷新后就是这个时机，
        //      不然刷新一次孤儿就再也救不回来（旧逻辑要求 was === true）。
        //   2. 真正的中断跳变（was === true → 现在 false）照旧。
        // 正在跑的时候当然不做（agentRunning === true 直接退出）。
        const firstLook = was === null
        if (agentRunning === true) return undefined
        if (firstLook !== true && was !== true) return undefined
        if (pausedByUserRef.current === true || reconcilingRef.current === true) return undefined
        reconcilingRef.current = true
        let cancelled = false
        const timer = setTimeout(() => {
          void (async () => {
            try {
              const data = await call('read', { ...payload, lite: true })
              if (cancelled || data === null || typeof data !== 'object') return
              // id=352-E：加 2 分钟宽限。刚被派出去的那条此刻正好「有 startedAt、没产出」，
              // 立刻判成中断会把正常在跑的任务打成孤儿 —— 首次观测（刷新页面）时尤其容易。
              // 真孤儿在宿主侧 30 分钟就被 read 回收了，这里 2 分钟只是兜住「宿主那份没跑到」。
              const cutoff = Date.now() - ORPHAN_CLIENT_GRACE_MS
              const losers = (data.items ?? []).filter(
                (it) =>
                  it.execute !== true
                 
                  && it.interrupted !== true
                  && typeof it.startedAt === 'string'
                  && it.startedAt !== ''
                  && Number.isFinite(Date.parse(it.startedAt))
                  && Date.parse(it.startedAt) < cutoff,
              )
              if (losers.length === 0) return
              const done = await markInterrupted(losers.map((it) => it.id))
              // 首次观测（刷新页面）时静默修复：它不是「刚刚中断」，弹提示只会让用户困惑。
              if (done > 0 && firstLook !== true) setNotice(`执行已中断（${done} 条）`, NOTICE_LONG_MS)
            } catch {
              // 对账失败不弹错：下一次 running 翻下去还会再来一次，别用噪音打搅用户。
            } finally {
              if (!cancelled) reconcilingRef.current = false
            }
          })()
        }, INTERRUPT_SETTLE_MS)
        return () => {
          cancelled = true
          window.clearTimeout(timer)
          reconcilingRef.current = false
        }
      }, [agentRunning, sessionId, cwd])

      /**
       * id=341：一个 turn 结束（running: true → false）就派发下一条任务。
       *
       * 这就是需求里的「先回答、再触发下一任务」：模型的回答已经写完了（turn 结束），
       * 我们才把下一条作为新的用户消息发进去。谁来做下一条由宿主算（queue-cli 的 nextTask），
       * 不再让模型自己扫待办 —— 技能正文里那条「做完立刻 start 下一条」已经删掉。
       *
       * 边沿必须用 wasDispatchRunningRef，不能读 wasRunningRef。对账 effect 写在前面，
       * 同一次提交里会先把那面旗子写成 false，派发再读就永远看不到 true→false，
       * 表现就是「这条做完了，下一条再不发」。
       *
       * 几种不该派的情况：
       * - 用户主动暂停（pausedByUserRef）：他要的就是停下来看看；
       * - 会话又跑起来了（工具空档、或用户接着聊）：这不是一轮的结束；
       * - 这一轮已经派过（dispatchedRef）：running 会抖，别连派；
       * - 队首已派发但还没 done（reason inflight）：不跳到后面的条目，短重试等回填；
       * - 队列空了：dispatch 自己会返回 empty。
       *
       * 对账进行中不能直接 return。那样边沿被消费掉，对账结束（只改 ref）不会再进这个 effect。
       * 定时器里等到 reconcilingRef 落下再发。
       *
       * 失败只记一条提示，不弹错误弹窗：派发失败最多是「停在原地」，用户再点一次开始即可，
       * 不该盖掉屏幕上更重要的内容。
       */
      /**
       * id=379：派发下一条的**唯一实现**。原来是内联在 effect 定时器里的匿名 async，
       * 现在抽出来，因为「拨回继续执行时立即恢复派发」需要走同一条路径 ——
       * 复制一份出来的话，两处会各自演化（一边补了 inflight 重试、一边忘了），
       * 而它们做的事完全一样：让宿主算下一条、发进会话、把结果说给用户听。
       *
       * 入参只有一句用于提示的前缀，其余全部读当前闭包 / ref 的最新值。
       * 传 ref 而不是值：这个函数可能在 setTimeout 里跑，captured 的旧值会漏判。
       */
      const dispatchNext = React.useCallback(
        async (lead, epoch) => {
          // 换会话、用户暂停、或会话又跑起来：这次空档不算「回答结束」。
          // id=379：**加上「完成后暂停」闸门** —— 这是本步的核心。
          // 用 ref 读，不用 state：这里跑在 setTimeout 回调里，
          // 闭包里的 state 可能已经是几秒前的旧值（用户中途拨了开关）。
          const still = () =>
            (epoch === undefined || dispatchEpochRef.current === epoch)
            && pausedByUserRef.current !== true
            && agentRunningRef.current !== true
            && pauseAfterDoneRef.current !== true
          const deadline = Date.now() + DISPATCH_SETTLE_MS
          while (reconcilingRef.current === true && Date.now() < deadline) {
            if (!still()) return
            await new Promise((resolve) => window.setTimeout(resolve, 100))
          }
          if (!still()) {
            // 被「停后」拦下时要说一句，否则用户只看到任务停了、没有任何解释。
            // 其他情况（换会话 / 暂停 / 又跑起来）本来就有各自的提示或天然可见的状态，不重复。
            if (pauseAfterDoneRef.current === true) {
              // id=6Gs9v1-C：文案跟着按钮一起改（「停后」/「继续」），
              // 否则提示里说「完成后暂停」、按钮上写着「停后」，用户要自己猜是不是同一个东西。
              setNotice('已完成，按「停后」停在空闲；点「继续」可恢复派发', NOTICE_LONG_MS)
            }
            return
          }
          if (dispatchedRef.current === true) return
          dispatchedRef.current = true
          try {
            let data = null
            for (let attempt = 0; attempt <= DISPATCH_INFLIGHT_RETRIES; attempt += 1) {
              if (!still()) {
                dispatchedRef.current = false
                return
              }
              data = await call('dispatch', { ...payload })
              if (epoch !== undefined && dispatchEpochRef.current !== epoch) {
                dispatchedRef.current = false
                return
              }
              if (data === null || typeof data !== 'object') {
                dispatchedRef.current = false
                return
              }
              if (data.reason !== 'inflight') break
              if (attempt === DISPATCH_INFLIGHT_RETRIES) break
              await new Promise((resolve) => window.setTimeout(resolve, DISPATCH_INFLIGHT_GAP_MS))
            }
            if (data === null || typeof data !== 'object') {
              dispatchedRef.current = false
              return
            }
            if (data.dispatched !== true) {
              // 没发出去就要允许下一次 true→false 再派。卡在 true 上，队列会一直停。
              dispatchedRef.current = false
              if (data.reason === 'empty') {
                // id=343：正常收工。把这一轮留下的运行态一起收掉，否则顶栏会停在
                // 「干活中 / 继续」上，而队列其实已经空了 —— 用户只能靠刷新页面摆脱它。
                setPaused(false)
                pausedByUserRef.current = false
                setNotice(data.finished === true ? '待办已清空，本轮执行结束' : '本轮执行结束', NOTICE_LONG_MS)
                void sync()
              } else if (data.reason === 'inflight') {
                const id = data.taskId === null || data.taskId === undefined ? '' : String(data.taskId)
                setNotice(
                  id !== '' ? `上一条 ${id} 还没回填完成，暂不派发下一条` : '上一条还没回填完成，暂不派发下一条',
                  NOTICE_LONG_MS,
                )
                void sync()
              }
              return
            }
            // 用长提示：成功派发是这条链还在走的唯一可见信号，短提示容易被下一帧盖掉。
            setNotice(
              lead !== undefined && lead !== ''
                ? `${lead}：${data.taskId}`
                : data.redelivered === true ? `重新派发：${data.taskId}` : `已派发下一条：${data.taskId}`,
              NOTICE_LONG_MS,
            )
            // 派出去之后立刻读一次，让新条目的「执行中」状态尽快出现。
            void sync()
          } catch (error) {
            dispatchedRef.current = false
            setNotice(`派发下一条失败：${error instanceof Error ? error.message : String(error)}`, NOTICE_LONG_MS)
          }
        },
        // payload / sync / setPaused 都是每次渲染重建的稳定闭包（或 state setter），
        // 不列全也不会读到过期的关键量：判定全部走 ref。
        [payload, sync],
      )

      React.useEffect(() => {
        const was = wasDispatchRunningRef.current
        wasDispatchRunningRef.current = agentRunning === true
        if (agentRunning === true) {
          // 新一轮开跑：允许它结束后再派一次。
          dispatchedRef.current = false
          pendingEdgeRef.current = false
          return undefined
        }
        if (pausedByUserRef.current === true) return undefined
        // id=384：两种进入方式——
        //   · 正常边沿：上一帧在跑、这一帧停了；
        //   · 补派：上一帧就已经停了，但那次边沿的定时器被 cleanup 取消了
        //     （pendingEdgeRef 仍是 true）。这是「干完一条不派下一条」的修复核心：
        //     即使定时器没走到点，这件事仍然记着，下一次 effect 会重新挂上。
        const isEdge = was === true
        const isResume = was !== true && pendingEdgeRef.current === true
        if (!isEdge && !isResume) return undefined
        // 已经有定时器在跑就别重复挂：否则每次重渲染都把计时器推后 1.2s，
        // 结算期永远走不完（这和「定时器被取消」是同一类症状，只是换了成因）。
        if (dispatchTimerRef.current !== null) return undefined
        // 这一轮已经派过（dispatchedRef）：running 会抖，别连派；
        // 队首已派发但还没 done（reason inflight）：不跳到后面的条目，短重试等回填；
        // 队列空了：dispatch 自己会返回 empty（这些判定都在 dispatchNext 里）。
        const epoch = dispatchEpochRef.current
        pendingEdgeRef.current = true
        let started = false
        const timer = window.setTimeout(() => {
          started = true
          dispatchTimerRef.current = null
          pendingEdgeRef.current = false
          void dispatchNext(undefined, epoch)
        }, DISPATCH_SETTLE_MS)
        dispatchTimerRef.current = timer
        return () => {
          // 请求已经发出就别清：prompt 会把 running 拉回 true，cleanup 若把结果扔掉，
          // 下一条其实发出去了，面板却没有任何「已派发」提示。
          if (!started) {
            window.clearTimeout(timer)
            if (dispatchTimerRef.current === timer) dispatchTimerRef.current = null
            // 注意：这里**不清** pendingEdgeRef —— 正是为了让下一轮 effect 能补派。
          }
        }
      }, [agentRunning, sessionId, cwd, dispatchNext])
      /**
       * id=379：「完成后暂停」开关的唯一写入口。放在 dispatchNext 之后定义 ——
       * 它要读 items / runningCount / sync / dispatchNext，全都声明在组件更上面或这一段之前。
       *
       * 为什么不直接用 setPauseAfterDone：
       *   1. 必须**同步**写 ref。setState 要等下一次渲染，而派发那边的定时器回调
       *      可能在同一个事件循环之后立刻跑 —— 那时 state 还是旧值，读 state 会漏判。
       *   2. 拨回「继续执行」时，要**立刻**把被拦下的那一条派出去（题面要求），
       *      不能等下一次 running 边沿 —— 那个边沿可能永远不会再来（已经空闲了）。
       */
      const togglePauseAfterDone = () => {
        const next = pauseAfterDone !== true
        pauseAfterDoneRef.current = next
        setPauseAfterDone(next)
        if (next === true) {
          // 拨到「暂停」：不中断当前任务，只是这一轮结束后不派下一条。
          setNotice('当前任务完成后将暂停，不再自动派发下一条', NOTICE_LONG_MS)
          return
        }
        // 拨回「继续执行」。题面条件：仍有待执行任务 + 当前无执行中任务 → 立即恢复派发。
        //
        // 「无执行中」用与别处同一套判据（agentRunning / starting / runningCount）。
        // 有任务在跑时**不动作**：它跑完后那个 running 边沿会自然派下一条，
        // 现在多发一次反而会插队。
        const idleNow = agentRunning !== true && starting !== true && runningCount === 0
        if (idleNow !== true) return
        // 「还有待执行」的判据必须与分组口径一致（todoList 那段），否则会出现
        // 「组里看得见一条，拨开关却说没活可派」。
        // 注意这里**不能**用渲染闭包里的 batchOf（它定义在下方 JSX 里，此处不可见），
        // 所以就地按同一个口径重算：批次看「是不是全做完了」，单条看 execute。
        // 两处口径一旦分叉，症状是「拨回继续执行但什么都没发生」——
        // 而 toggle 这边恰恰是唯一会被用户当成「开关坏了」的地方，宁可写得直白些。
        const hasTodo = items.some((it) => {
          // id=405：原来这里先排除草稿项；草稿组移除后不必再判。
          const kids = Array.isArray(it.children) ? it.children : []
          if (kids.length > 0) return kids.every((c) => c.execute === true) !== true
          return it.execute !== true
        })
        if (hasTodo !== true) return
        // 放开闸门，让 dispatchNext 的 `dispatchedRef === true` 早退不再拦住这一次。
        // 不自己拼 dispatch 请求：那条链路上的 inflight 重试、empty 收工、
        // 游标推进全在 dispatchNext 里，绕开它就是第二套实现。
        dispatchedRef.current = false
        // 等一个派发空档再发：与 running 边沿那条同速，避免刚拨开关就抢在
        // 状态落定之前把请求打出去。
        window.setTimeout(() => {
          void dispatchNext('用户已恢复自动派发')
        }, DISPATCH_SETTLE_MS)
      }



      /** 拖拽落位：只在「待执行」组内调整先后，随后整表重排并落盘。 */
      // 提交一整份「待执行组」的 id 顺序：Host 只认整表顺序，
      // 所以把待执行 → 待审核 → 已审核三段的 id 拼起来发过去，
      // order 重编号后各分组不会错位。界面先乐观更新，失败再回读。
      const commitOrder = async (order) => {
        const all = state.data?.items ?? []
        const ids = [
          ...order,
          // id=405：草稿段已删（草稿组不存在，没有要排在待执行之前的条目）。
          ...all.filter((it) => it.execute === true && it.review !== true).map((it) => it.id),
          ...all.filter((it) => it.execute === true && it.review === true).map((it) => it.id),
        ]
        // 乐观更新，界面立刻跟手。
        setState((prev) => {
          if (prev.data === null) return prev
          const map = new Map((prev.data.items ?? []).map((it) => [it.id, it]))
          return { ...prev, data: { ...prev.data, items: ids.map((id) => map.get(id)).filter(Boolean) } }
        })
        try {
          await call('reorder', { ...payload, ids })
          setNotice('顺序已保存')
        } catch (error) {
          setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }))
          void sync()
        }
      }

      const moveTo = async (from, to) => {
        if (from === null || to === null || from === to) return
        const todo = (state.data?.items ?? []).filter((it) => it.execute !== true)
        const order = todo.map((it) => it.id)
        const fromIndex = order.indexOf(from)
        const toIndex = order.indexOf(to)
        if (fromIndex < 0 || toIndex < 0) return
        order.splice(fromIndex, 1)
        order.splice(toIndex, 0, from)
        await commitOrder(order)
      }

      // 置顶：把这一条挪到「执行中」那条的正下方，即待执行组的第一位。
      // 正在执行的那条永远留在最上面（它是当前正在跑的，不能被打断）。
      const pinTop = async (id) => {
        const todo = (state.data?.items ?? []).filter((it) => it.execute !== true)
        // id=244：拦截放在这里，而不是只靠按钮消失。
        // 置顶的唯一入口虽然是 `50-item.js` 的按钮，但按钮消失只是「看不见入口」，
        // 不是「没有入口」——卡片外层、以后可能加的右键菜单、键盘快捷键，
        // 任何能拿到 id 的路径最终都汇到这一个函数。判在这里才算真的禁掉。
        // 同时它是写 order 的唯一出口（下一站 commitOrder → 宿主 reorder），
        // 提前 return 就不会动排序权重，也不会发出任何请求。
        if (todo.some((it) => it.id === id && (it.decomposeKey ?? '') !== '')) return
        const order = todo.map((it) => it.id)
        const fromIndex = order.indexOf(id)
        if (fromIndex < 0) return
        order.splice(fromIndex, 1)
        const runningIndex = order.findIndex((x) => {
          const it = todo.find((t) => t.id === x)
          return it !== undefined && statusOf(it, impliedRunningId === it.id, delivered).key === 'running'
        })
        order.splice(runningIndex >= 0 ? runningIndex + 1 : 0, 0, id)
        await commitOrder(order)
      }


      // 本地打补丁：只就地更新这一条，不重排、不滚动、不改变展开项。
      const patch = async (id, value) => {
        // id=380：**删掉了「审核通过后自动展开下一条待审核」**。
        //
        // 原来这里先算出 nextUnreviewed（审核完这一条就离开待审核组，于是把它后面
        // 那条设为展开），落盘后再 setOpenId(nextUnreviewed) + setOpenGroup('unreviewed')。
        //
        // 为什么要删：审核是一个**逐条扫读**的动作，用户的眼睛停在自己刚点的那一行。
        // 自动展开下一条会同时做三件用户没要求的事 —— 把下一张卡撑开、把刚审的那张
        // 收起来、列表整体位移一段。连续点几条时每点一次画面就重排一次，
        // 很容易点错行；而且「我正在看的那条突然缩起来了」比「要多点一下」更烦人。
        // 题面也是这个意思：只删自动展开，别的一律不动。
        //
        // 删掉之后保留的行为（逐条确认过，都没动）：
        //   · 数据流转 —— call('update') 与乐观合并（setState 那一段）原样；
        //   · 列表刷新 —— 用户的通过/取消都照旧生效（合并后重渲染）；
        //   · 通知 —— `已审核通过 #id` 等提示一字未改；
        //   · 展开项**失效时的清理** —— 见下面 remainingUnreviewed 那段：
        //     审完这一条后待审核空了，仍会把正展开的那条摘掉（它已经不在组里了，
        //     留着展开一个看不见的条目没有意义）。这不是「自动展开」，是清理，
        //     与题面要删的不是同一件事。
        const silent = value.silent === true
        // silent 是本地开关，别传给宿主（宿主只认 plan/review/draft 这些真实字段）。
        const patchValue = { ...value }
        delete patchValue.silent
        try {
          const data = await call('update', { ...payload, id, patch: patchValue })
          if (data === undefined) return data
          // 用宿主回写的条目做乐观更新：这样 refreshName 之类的派生字段（新标题）
          // 也能立刻反映到界面上，而不是等下一次轮询。
          const merged = data.item !== null && data.item !== undefined ? data.item : patchValue
          setState((prev) => {
            if (prev.data === null) return prev
            const list = (prev.data.items ?? []).map((it) => (it.id === id ? { ...it, ...merged } : it))
            return { ...prev, data: { ...prev.data, items: list } }
          })
          const reviewed = value.review === true
          // 审核完这一条后「待审核」是否已经空了。
          // id=356：空了也**不折叠**这一组 —— 用户点的是「通过」，不是「切换页面」。
          // 折叠会让整个列表当场消失（看起来就像被踢到别的组去了），
          // 留在原位、由组自己的空态文案（「暂无待审核内容」）说明结果更清楚；
          // 什么时候收起来、什么时候点别的组，交给用户。
          const remainingUnreviewed = (state.data?.items ?? []).filter(
            (it) => it.execute === true && it.review !== true && it.id !== id,
          ).length
          // id=380：只保留「摘掉失效的展开项」这一半，自动展开那一支已删除。
          // setOpenGroup('unreviewed') 也一并没了 —— 它原本只是为「展开下一条」
          // 服务（保证新展开项所在的分组是打开着的）；既然不再展开，就没有
          // 「顺手把分组展开」的理由了，否则点一下通过还会把收起的待审核组拽开。
          if (reviewed && remainingUnreviewed === 0) {
            setOpenId(null)
          }
          if (!silent) {
            setNotice(
              reviewed
                ? `已审核通过 #${id}`
                : value.review === false
                  ? `已取消审核 #${id}`
                  // id=405：这里原来是「已保存草稿 #<id>」—— 它对应的是「就地编辑草稿正文」
                  // 那条路径（value.plan 是字符串）。草稿编辑框已删除，不再有这种调用，
                  // 但分支留着会误导（读起来像「还能存草稿」）。改成中性的「已更新正文」。
                  : typeof value.plan === 'string'
                    ? `已更新正文 #${id}`
                    : `已更新 #${id}`,
            )
          }
          return data
        } catch (error) {
          setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }))
          return undefined
        }
      }

      // 删除后不要「跳转」：不能把 remove 的返回值直接塞进 state.data。
      // remove 只回 { cwd, items }，缺 planExists / taskTypes，塞进去会让整个面板
      // 瞬间变成「这个项目还没有任务进度」并弹初始化按钮（看起来像跳走了）。
      // 所以这里先删，再用 sync() 静默重读一次完整结构，视图原地更新。
      const remove = async (id) => {
        setBusy(true)
        setState((prev) => ({ ...prev, error: '' }))
        try {
          await call('remove', { ...payload, id })
          if (openId === id) setOpenId(null)
          setPicked((prev) => {
            if (!prev.has(id)) return prev
            const next = new Set(prev)
            next.delete(id)
            return next
          })
          setPickedDone((prev) => {
            if (!prev.has(id)) return prev
            const next = new Set(prev)
            next.delete(id)
            return next
          })
          // id=405：这里原来还要从 pickedDraft 里剪掉这个 id。
          // pickedDraft 已随草稿组删除，剩下这一句会在删除任何计划时抛 ReferenceError
          // （61-F 全目录复查时发现 —— 前面的测试只看语法与引用计数，抓不到运行时未定义）。
          await sync()
          setNotice(`已删除计划 #${id}`)
        } catch (error) {
          setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }))
        } finally {
          setBusy(false)
        }
      }

      /**
       * 整批通过入口（id=354 建按钮，id=355 落实为批量操作）：
       * 拆解批次头部那颗「通过」只发一个 id 进来，**整批**的审核在这里一次做完。
       *
       * 为什么不是「对每条子任务循环发 update」（上一版的做法）：
       *   十条子任务 = 十次请求、十次抢锁、十次写盘；中途失败会留下「审了一半」
       *   的中间态，界面上父行会在「待审核 / 已审核」之间抖 N 次。
       * 现在只发一次 `approveBatch`：宿主在**同一把锁、同一次读写**里把父 + 全部
       * children 一起置为已审核（形态由 `approveItem` 生成，与逐条点通过完全一致），
       * 再按既有归档规则把整批搬进 notes.json。要么全成、要么一条都不动。
       *
       * 失败时不做乐观更新：磁盘没改动，界面就不该先跳到「已审核」。
       */
      const approveBatch = async (id) => {
        const parent = items.find((it) => String(it.id) === String(id))
        if (parent === undefined) return
        const kids = Array.isArray(parent.children) ? parent.children : []
        // 与宿主同一口径：父自己的 review 是容器标记，也要算进「还剩几条没审」。
        // 两边各算一套的话，极端情况下（子任务都审过、父没落标记）按钮会显示可点，
        // 而宿主其实无事可做 —— 所以判据只写这一种。
        //
        // id=372：`one.review` 前先挡脏数据。kids 里混进 null / 字符串时
        // （手改 plan.json、旧版本写坏的数组），`one.review` 会抛
        // `Cannot read properties of null` —— 用户点「通过」看到的是失败提示，
        // 而真正该做的是照常把能审的审掉。宿主侧 approveItem 也已同步加固。
        const pool = (kids.length > 0 ? [parent, ...kids] : [parent]).filter((one) => one !== null && typeof one === 'object')
        const pendingCount = pool.filter((one) => one.review !== true).length
        if (pendingCount === 0) {
          setNotice('这一批已经全部审核过了')
          return
        }
        setBusy(true)
        setState((prev) => ({ ...prev, error: '' }))
        try {
          const data = await call('approveBatch', { ...payload, id: parent.id })
          const approvedCount = Number(data?.approvedCount ?? 0)
          setPicked((prev) => {
            // 这一批里被审掉的子任务若还留在勾选集合里，一并清掉。
            if (prev.size === 0) return prev
            const next = new Set(prev)
            // id=372：同一个脏数据防护 —— 这里的 kids 可能含 null。
            for (const one of kids) {
              if (one !== null && typeof one === 'object') next.delete(one.id)
            }
            next.delete(parent.id)
            return next.size === prev.size ? prev : next
          })
          setNotice(`整批已通过 ${approvedCount > 0 ? approvedCount : pendingCount} 条`)
          // id=356：通过之后这一批离开「待审核」，但**不切换分组**。
          // 以前这里在整组清空时 setOpenGroup(null)（全部折叠），而这种「收起」状态
          // 在重挂载时会被读成默认的待执行组 —— 用户看到的就是「点通过后跳去待执行」。
          // 现在什么都不动：组留在原位，用空态文案说明「暂无待审核内容」。
          // 唯一的例外是展开项还指向这一批里的某条（它已经不在这组了）：只清展开项。
          setOpenId((prev) => {
            if (prev === null) return prev
            // id=372：同上，`one.id` 前挡脏数据。
            const gone = kids.some((one) => one !== null && typeof one === 'object' && String(one.id) === String(prev)) || String(prev) === String(parent.id)
            return gone ? null : prev
          })
          // 写回后必须重新读一次：分组、条数、以及头部那颗「通过」的可见性
          // （statusOf 已经算成 reviewed → 按钮不再渲染）都从磁盘这份数据推导，不另存状态。
          await sync()
        } catch (error) {
          setState((prev) => ({
            ...prev,
            error: `整批通过失败：${error instanceof Error ? error.message : String(error)}`,
          }))
          await sync()
        } finally {
          setBusy(false)
        }
      }

      /** 批量审核：把勾选的待审核项一次性全部通过。 */
      const approvePicked = async (ids) => {
        if (ids.length === 0) {
          setNotice('先勾选要审核的计划')
          return
        }
        setBusy(true)
        setState((prev) => ({ ...prev, error: '' }))
        let done = 0
        try {
          for (const id of ids) {
            await call('update', { ...payload, id, patch: { review: true } })
            done += 1
          }
          setPicked(new Set())
          setNotice(`已批量审核通过 ${done} 条`)
          // id=356：批量通过后**不折叠、不切换分组**（同单条通过的取舍）。
          // 只把展开项从「这一批已经离开的条目」上摘掉，其余状态一律不动。
          setOpenId((prev) => (prev !== null && ids.some((id) => String(id) === String(prev)) ? null : prev))
          await sync()
        } catch (error) {
          setState((prev) => ({
            ...prev,
            error: `已通过 ${done} 条，其余失败：${error instanceof Error ? error.message : String(error)}`,
          }))
          await sync()
        } finally {
          setBusy(false)
        }
      }

      /** 批量删除「已审核」组里勾选的条目。正在执行的会被宿主跳过。 */
      const removePickedDone = async (ids) => {
        if (ids.length === 0) {
          setNotice('先勾选要删除的计划')
          return
        }
        setBusy(true)
        setState((prev) => ({ ...prev, error: '' }))
        try {
          let removed = []
          let skipped = []
          try {
            const result = await call('removeMany', { ...payload, ids })
            removed = Array.isArray(result?.removed) ? result.removed : []
            skipped = Array.isArray(result?.skipped) ? result.skipped : []
          } catch (bulkError) {
            // 宿主还是旧版本、没有 removeMany 时，逐条删除兜底。
            for (const id of ids) {
              try {
                await call('remove', { ...payload, id })
                removed.push(id)
              } catch (oneError) {
                skipped.push(id)
                void bulkError
                void oneError
              }
            }
          }
          setPickedDone(new Set())
          // id=405：setPickedDraft(new Set()) 同理已删（草稿组不存在）。

          if (openId !== null && removed.includes(openId)) setOpenId(null)
          if (skipped.length > 0) setNotice(`已删除 ${removed.length} 条，${skipped.length} 条执行中跳过`)
          else if (removed.length > 0) setNotice(`已删除 ${removed.length} 条`)
          else setNotice('没有可删除的计划')
          await sync()
        } catch (error) {
          setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }))
          await sync()
        } finally {
          setBusy(false)
        }
      }

      /**
       * id=391：「待审核自动通过条数」下拉与它的 change 一起删除了
       *（题面：取消待审核的自动审核机制，移除代码和下拉选项）。
       *
       * 原来这里有 `changeAutoReviewLimit`，写回 `autoReviewLimit` 后宿主会立刻
       * 补一轮自动通过。现在审核是 100% 人工动作 —— 待审核有多少条就显示多少条，
       * 不会因为超过某个阈值而悄悄少掉几条。
       *
       * 删掉它顺带解决一个老问题：那个下拉是待审核组头里唯一的 `<select>`，
       * 组头本来就只有一行高，它的 26px 高度一直在给标题施压。
       */

      React.useEffect(() => {
        if (notice === '') return undefined
        const timer = setTimeout(() => setNoticeState(''), noticeMsRef.current)
        return () => clearTimeout(timer)
      }, [notice])

      // 数据刷新后把已经不存在的 / 已审核的 id 从勾选集合里剔掉，避免「已选 N」虚高。
      React.useEffect(() => {
        const pending = new Set((state.data?.items ?? []).filter((it) => it.execute === true && it.review !== true).map((it) => it.id))
        setPicked((prev) => {
          const next = new Set([...prev].filter((id) => pending.has(id)))
          return next.size === prev.size ? prev : next
        })
        const reviewed = new Set((state.data?.items ?? []).filter((it) => it.execute === true && it.review === true).map((it) => it.id))
        setPickedDone((prev) => {
          const next = new Set([...prev].filter((id) => reviewed.has(id)))
          return next.size === prev.size ? prev : next
        })
        // id=405：草稿组的勾选剪枝随草稿组删除（setPickedDraft 已不存在）。
      }, [state.data])

      return h(
        'div',
        // id=71-D：原来这里还带 style: { position: 'relative' } ——
        // 而 .plt-root 的 CSS 规则里本来就有 position:relative（10-topbar.js），
        // 内联那份是纯冗余。删掉后定位行为不变。
        { className: 'plt-root', ref: rootRef },
        h(
          'div',
          // has-error（id=210）：让顶栏那颗「开始 / 暂停」跟着错误提示一起描红，操作失败时不用靠猜。
          { className: state.error === '' ? 'plt-top' : 'plt-top has-error' },
          h('span', { className: 'plt-title' }, `任务列表 · ${items.length}`),
          // 提交/审核的提示放在「自动刷新」左侧，不再占用下方空间。
          notice !== '' ? h('span', { className: 'plt-notice' }, notice) : null,
          h(
            'button',
            {
              className: `plt-btn plt-auto${auto ? ' on' : ''}`,
              'data-tip': auto ? `自动刷新已开启，${tick} 秒后重新读取 plan.json` : '自动刷新已关闭',
              onClick: () => setAuto((prev) => !prev),
            },
            h(
              'span',
              { className: 'plt-dot', 'aria-hidden': 'true' },
            ),
            h('span', null, auto ? `${tick}s` : '自动'),
          ),
          // 开始 / 暂停（id=207 渲染，id=208 接逻辑，id=354 合成一个按钮）：
          // 插在「自动刷新」与「刷新」之间，即口语需求说的「任务列表右边、倒计时左边」。
          // 原先并排两颗按钮、靠 disabled 让它们互斥，题面要求「显示一个就行」——
          // 现在同一个位置只渲染一颗，身份由「会话是不是真的在跑」决定：
          // 在跑 → 暂停；其余 → 开始 / 继续（开工指令在飞时显示「发送中…」）。
          // 这样「同一时刻只有一个可见动作」是结构上的事实，而不是靠两个 disabled 拼出来；
          // 图标、文案、onClick 都由同一个 showPause 决定，不可能出现文字与动作对不上。
          // 可用性仍然只由 canStart / canPause 推导（见上方 working 一带），不另存状态：
          //   未开始 → 开始可点；执行中 → 暂停可点；已挂起 → 文案变「继续」；
          //   全部完成（无待办）→ 开始禁用；busy（有请求在飞）→ 禁用。
          (() => {
            // showPause 只看「会话真的在跑」（agentRunning），不看 working：
            // working 还包含「开工指令刚发出、还没送到」的 starting 那几秒，
            // 那几秒画成「暂停」既不可点（pauseWork 会自己 return），
            // 又会让按钮在「开始」→「暂停」之间闪一下。这段时间继续留在「开始」上，
            // 文案换成「发送中…」并转圈，和列表底部那颗行内按钮的语义一致。
            // pausing 也算进来：点下暂停到 turn 真停下之间，按钮得继续显示「暂停中」，
            // 否则 `working` 还在、`agentRunning` 先翻下去的那一帧会闪回「开始」。
            const showPause = agentRunning === true || pausing === true
            const sending = showPause !== true && starting === true
            const pausingNow = showPause && pausing === true
            const enabled = showPause ? canPause === true : canStart === true
            const tip = showPause
              ? pausingNow
                ? '正在挂起当前执行，请稍候'
                : '挂起当前执行，已完成的进度会保留'
              : sending
                ? '正在把开工指令发进会话，稍候片刻'
                : pendingCount === 0
                  ? '没有待执行的计划'
                  : pausedIdle
                    ? '从挂起处继续队首这条计划，已完成的不会重做'
                    : `把队首任务发进会话（按钮「${KICKOFF_TEXT}」），模型不用再自己找下一条`
            return h(
              'button',
              {
                className: showPause
                  ? 'plt-btn plt-pause'
                  : `plt-btn plt-start${pausedIdle ? ' is-resume' : ''}`,
                // 给测试 / 排查一个稳定的定位点：同一颗按钮，多种身份。
                'data-act': showPause ? 'pause' : sending ? 'sending' : pausedIdle ? 'resume' : 'start',
                disabled: enabled !== true,
                'data-tip': tip,
                onClick: (e) => {
                  e.stopPropagation()
                  void (showPause ? pauseWork() : startWork())
                },
              },
              showPause
                ? pausingNow
                  ? h(SpinnerIcon, { size: 15 })
                  : h(PauseIcon, { size: 15 })
                : sending
                  ? h(SpinnerIcon, { size: 15 })
                  : h(PlayIcon, { size: 15 }),
              // id=88-B：文案单独包一层并带类名，窄屏（≤300px）时整段收起、只留图标。
              // 类名按当前身份二选一，方便样式分别定位，也方便调试时看出此刻是谁。
              h('span', { className: showPause ? 'plt-pause-sub' : 'plt-start-sub' }, showPause
                ? pausingNow ? '暂停中' : '暂停'
                : sending ? '发送中…' : pausedIdle ? '继续' : '开始'),
            )
          })(),
        // id=377：「停后」开关 —— 顶栏、紧跟「暂停」按钮之后。
        //
        // id=6Gs9v1-A：从待执行组头搬到这里。原先放组头是因为「最右端已被条数
        // 统计占着，插一个宽度会变的开关会打散那条对齐线」；搬到顶栏后这个顾虑
        // 不再存在，顶栏本来就是一行动作按钮。
        //
        // 显隐：**只在有任务正在执行时渲染**，判据是
        // `agentRunning === true || pausing === true` —— 与相邻那颗「暂停」按钮
        // 的 showPause 表达式完全一致，所以两者永远同进同出。
        //（注意：不能用组头那个 `isRunning`，它活在 groups.map 的闭包里，顶栏读不到；
        //  也不能用 `showPause`，它定义在下面那个 IIFE 内部。这两次都是踩过的坑。）
        //
        // 文案（id=6Gs9v1-C）：关闭态「停后」，开启态「继续」——
        // **都是 2 字**，与「开始」「暂停」「继续」「刷新」「自动」同一节奏。
        // 之前是「完成后暂停」(5 字) /「继续执行」(4 字)，一行里混着 2 字和 5 字，
        // 视觉上像「一排按钮旁边挂了个标签」。
        // 短文案省下的字由下面的 title 补回来。
        //
        // title（题面要求逐字）：解释这个开关到底做什么。
        // 同时也用 data-tip —— 这个插件的气泡提示统一走 40-tip.js，
        // 只有 title 的话悬停要等浏览器那个 ~1s 的延迟。
        //
        // ⚠ 判据用 showPause，**不是 isRunning**。
        // 搬家时这一行原本照抄了组头的 `isRunning`，但那是分组遍历里的局部变量
        //（定义在下面 `const isRunning = group.list.some(...)`，属于组头那个闭包），
        // 顶栏作用域根本看不到它 —— 直接渲染就抛 `isRunning is not defined`，
        // 整个插件白屏。这是搬家时**只搬了代码、没搬依赖**的典型事故。
        //
        // 顶栏里与「正在跑」等价的是 showPause（agentRunning || pausing），
        // ⚠ 判据必须是**顶栏作用域里真能读到的东西**。
        //
        // 搬家时这一行原本照抄了组头的 `isRunning`，但那是分组遍历里的局部变量
        //（`const isRunning = group.list.some(...)`，活在组头那个闭包里），
        // 顶栏看不到它 —— 一渲染就抛 `isRunning is not defined`，整个插件白屏。
        //
        // 也不能用 `showPause`：它定义在下面那个 IIFE 的**内部**，出了 `})()` 就没了。
        //（我第二次改正是这么写的，同样是 out-of-scope，只是报错点换了个地方。）
        //
        // 顶栏这里能直接读的组件级 state 只有 agentRunning / pausing。
        // 判据取 `agentRunning === true || pausing === true` —— 与 IIFE 里 showPause
        // 的表达式**完全一致**，所以「暂停按钮显示着」与「开关出现」永远同进同出。
        (agentRunning === true || pausing === true)
          ? h(
              'button',
              {
                // id=6Gs9v1-B：**直接复用 .plt-btn** —— 与相邻的「开始/暂停」同一套
                // 高度 / 圆角 / 字号 / 内边距 / 换行规则，不再自己定一份尺寸。
                // .plt-auto-pause 只保留它独有的部分（开关配色、圆点、on 态），
                // 尺寸与形状一律交给 .plt-btn，两边永远不会走散。
                className: `plt-btn plt-auto-pause${pauseAfterDone ? ' on' : ''}`,
                type: 'button',
                // 组头整行是展开/收起的热区，开关必须自己吃掉点击。
                // id=379：走统一写入口 —— 它同步写 ref（派发回调读的是 ref），
                // 并在拨回「继续执行」时立刻恢复派发。
                onClick: (e) => {
                  e.stopPropagation()
                  togglePauseAfterDone()
                },
                // id=6Gs9v1-C：**文案统一改成两字**，与同组按钮同节奏。
                //
                // 原先是「完成后暂停」（5 字）/「继续执行」（4 字），而旁边的
                // 「开始」「暂停」「继续」「刷新」「自动」全是 2 字 —— 一行里
                // 混着 2 字和 5 字，视觉上是「一排按钮 + 一个标签」，不像同类控件。
                //
                // 新文案：关 =「停后」（停止后续）、开 =「继续」。
                // 两者都 2 字，与「暂停」等长；含义靠下面这条 title 兜住。
                // 「停后」单独看略省略，所以 title 必须写清「停的是什么」——
                // 这也是题面要求「同步更新 title / aria-label」的原因：
                // 短文案省下的字，要在说明里补回来。
                title: '开启后：当前任务执行完就停下，不再自动派发下一条（「继续」可恢复）',
                'data-tip': '开启后：当前任务执行完就停下，不再自动派发下一条（「继续」可恢复）',
                // aria-label 用完整语义，读屏用户没有视觉上下文，
                // 不跟着按钮表面那两个字走。
                'aria-label': '完成后停止后续任务',
                // 读屏要的是「当前是开还是关」，不能只靠文案变化
                //（「停后 / 继续」两种文案都不是 on/off 本身）。
                'aria-pressed': pauseAfterDone === true,
              },
              // 小圆点承担开关状态：与顶栏那颗「自动刷新」（.plt-auto .plt-dot）
              // 同一套视觉语言 —— 亮起 = 开，灰点 = 关。不新造一个 toggle 皮肤。
              h('span', { className: 'plt-dot', 'aria-hidden': 'true' }),
              h('span', { className: 'plt-auto-pause-txt' }, pauseAfterDone ? '继续' : '停后'),
            )
          : null,
        ),
        state.error !== '' ? h('div', { className: 'plt-err' }, state.error) : null,
        // 「确实没有可用模型」的引导条（id=364）。
        //
        // 只在这一种情况下出现：ensureModel 已经等过、重试过，目录仍然是空的。
        // 「列表还没就绪」不会走到这里 —— 那个被等待 + 重试消化掉了。
        //
        // 文案里刻意把两种成因分开说（没配 vs 读不出来），因为下一步动作不同：
        // 前者要去配 provider，后者多半是 key / 端点的问题。
        // 右侧给一个可点的「重新加载」—— 用户刚配好就回到面板是最常见的场景，
        // 让他重开页面是没必要的惩罚。
        modelMissing
          ? h(
              'div',
              { className: 'plt-guide', role: 'status' },
              h(
                'span',
                { className: 'plt-guide-txt' },
                modelState.providers.length === 0
                  ? '没有可用的模型：这个部署还没有配置任何 provider。配好之后点右侧重新加载。'
                  : '模型列表读不出来：provider 已配置但探测失败，检查 key / 端点后重新加载。',
              ),
              h(
                'button',
                {
                  className: 'plt-btn plt-guide-btn',
                  type: 'button',
                  disabled: modelLoading,
                  'data-tip': '重新拉一次可用模型列表',
                  onClick: () => void reloadModels(),
                },
                modelLoading ? '加载中…' : '重新加载',
              ),
            )
          : null,
        h(
          'div',
          { className: 'plt-list' },
          state.loading
            ? h('div', { className: 'plt-empty' }, '读取中…')
            : state.data === null
              ? h('div', { className: 'plt-empty' }, '读取失败')
              : state.data.planExists !== true
                ? h('div', { className: 'plt-empty' }, '这个项目还没有任务进度。', h('br'), h('button', { className: 'plt-btn', onClick: () => setShowInit(true) }, '初始化'))
                : items.length === 0
                  ? h('div', { className: 'plt-empty' }, '还没有计划。', h('br'), '在下面的输入框写下第一条，或直接在对话窗口说需求。')
                  : (() => {
                      // 组顺序（从上到下）：已审核最上 → 待审核 → 待执行最下。
                      // 越靠下越接近底部输入框，写完就能直接提交，符合「干完的往上沉」的阅读习惯。
                      // 只有待执行组可拖拽排序；「已审核」组内部按倒序展示（最近完成的在最上）。
                      // id=273：父节点（拆解批次）的状态由 children 决定 —— 它自己的
                      // execute / draft 只是容器标记，整批都做完之前不该沉到「已审核」，
                      // 所以分组看的是「这一批里还剩几条没做完」，与宿主队列口径一致。
                      const batchOf = (it) => {
                        const kids = Array.isArray(it.children) ? it.children : []
                        if (kids.length === 0) return null
                        return {
                          allDone: kids.every((c) => c.execute === true),
                          allReviewed: kids.every((c) => c.execute === true && c.review === true),
                        }
                      }
                      // id=338：已审核组固定「完成时间倒序」——最近审核通过的在最上。
                      // 以前是「上游怎么给就整个 reverse 一遍」：来源是
                      // [归档(新→旧), plan.json(按 order)]，reverse 之后两段各自反向，
                      // 刚通过的一条反而沉到下面去了。改成按 finishedAt 显式排序，
                      // 与来源顺序解耦；老条目缺 finishedAt 时退到 createdAt、再退到 id。
                      // 拆解批次用 children 里最晚的完成时间（整批审完的那一刻才算完成）。
                      /**
                       * 列表排序口径（id=77-C）：**只由 order 决定**。
                       *
                       * order 升序；order 相同时按 id 的**字符串**比较兜底。
                       *
                       * 为什么不用 `a.id - b.id` / `Number(id.split('-')[0])`：
                       * 77-B 之后 id 是 6 位随机串，两种写法都会得到 NaN，
                       * 而 NaN 参与的比较不满足反对称性 —— 排序结果「未定义」。
                       *
                       * 为什么删掉原来的时间戳排序：
                       * 已审核组原来按 finishedAt 降序（最近完成的在上）、待审核组按
                       * startedAt 升序（先完成的在上），都写了不少注释解释「为什么要
                       * 按时间而不按来源顺序」。但那是「用时间模拟一个顺序」——
                       * 而顺序本来就应该由 order 这个字段唯一决定，否则同一份数据
                       * 在不同时间点刷新会排出不同结果。
                       * 现在统一按 order：用户拖成什么样，就是什么样。
                       */
                      const byTaskOrder = (a, b) => {
                        const oa = Number.isFinite(a?.order) ? Number(a.order) : 0
                        const ob = Number.isFinite(b?.order) ? Number(b.order) : 0
                        if (oa !== ob) return oa - ob
                        const ia = String(a?.id ?? '')
                        const ib = String(b?.id ?? '')
                        if (ia === ib) return 0
                        return ia < ib ? -1 : 1
                      }
                      // id=6-A：**已审核组恢复「审核时间倒序」**（最新审核的在最上）。
                      //
                      // 这条要求与 id=338 同一个诉求 —— 338 当初就实现了它，
                      // 后来 id=77-C 把三组排序统一成 `byTaskOrder`（order 升序），
                      // 顺带把这段删了。现在按本条恢复，但**只对已审核组生效**，
                      // 另外两组保持 byTaskOrder（用户拖拽的顺序不受影响）。
                      //
                      // 为什么已审核组要特殊：它的顺序对用户没有操作意义
                      //（已审核条目不可拖拽，drag: false），用户翻它是想找「刚审的」，
                      // 而 order 是提交时分配的，跟审核先后无关 —— 按 order 排会让
                      // 刚审完的一条沉到中间。
                      //
                      // 时间口径（沿用 338 的设计）：
                      //   finishedAt ──> createdAt ──> id 字符串
                      // finishedAt 是「审核通过那一刻」的权威字段（见 archive.js:37）。
                      // 拆解批次取 children 里**最晚**的完成时间 —— 整批审完才算这条完成。
                      const reviewedTimeOf = (it) => {
                        const pick = (x) => {
                          const f = Date.parse(String(x?.finishedAt ?? ''))
                          if (Number.isFinite(f)) return f
                          const c = Date.parse(String(x?.createdAt ?? ''))
                          return Number.isFinite(c) ? c : null
                        }
                        const kids = Array.isArray(it?.children) ? it.children : []
                        // 拆解批次：取最晚完成的那个子任务
                        if (kids.length > 0) {
                          const times = kids.map(pick).filter((x) => x !== null)
                          if (times.length > 0) return Math.max(...times)
                        }
                        return pick(it)
                      }
                      /** 已审核组：审核时间倒序；都没有时间时退回 id 倒序。 */
                      const byReviewedDesc = (a, b) => {
                        const ta = reviewedTimeOf(a)
                        const tb = reviewedTimeOf(b)
                        // 有时间的一律排在没时间的之前（没时间的沉底，不占顶部）
                        if (ta !== null && tb !== null && ta !== tb) return tb - ta
                        if (ta !== null && tb === null) return -1
                        if (ta === null && tb !== null) return 1
                        // 都无时间（或同一毫秒）：id 倒序兜底，保证顺序稳定
                        const ia = String(a?.id ?? '')
                        const ib = String(b?.id ?? '')
                        if (ia === ib) return 0
                        return ia > ib ? -1 : 1
                      }
                      const doneReviewed = items
                        .filter((it) => {
                          const batch = batchOf(it)
                          if (batch !== null) return batch.allReviewed
                          return it.execute === true && it.review === true
                        })
                        // id=6-A：排序作用在 **filter 之后的完整数据集** 上。
                        // 本组件没有分页/截断（全项目搜不到 slice/limit 分页），
                        // 所以「先排全量再渲染」天然成立，不存在「只排当前页」的问题。
                        .sort(byReviewedDesc)
                      // 待审核组同样按 byTaskOrder（order 升序 + id 字符串兜底）。
                      //
                      // id=77-C 删掉了这里的 pendingTimeOf / pendingRank：
                      // 那套按 startedAt → createdAt 排序是为了解决 id=403 报的
                      // 「待审核继承了归档的倒序、后完成的反而在上面」——
                      // 但那是**用时间模拟一个顺序**。现在顺序由 order 唯一决定，
                      // 「先完成的在上」变成「用户拖成什么样就是什么样」，
                      // 同一份数据在任何时间点刷新都排出同样结果。
                      //
                      // 已审核组同理（原 reviewedTimeOf 按 finishedAt 降序）。
                      // 两个组现在共用同一个比较器，不再一个倒序一个正序 ——
                      // 那种"方向差异"本身就是用时间当排序依据的副作用。
                      const donePending = items.filter((it) => {
                        const batch = batchOf(it)
                        if (batch !== null) return batch.allDone && batch.allReviewed !== true
                        return it.execute === true && it.review !== true
                      // 正序：时间早的在前；同一时刻用 id 递增兜底，保证顺序稳定
                      //（不稳定排序会让两条同时间戳的条目在每次轮询时互换位置）。
                      }).sort(byTaskOrder)
                      // id=405：草稿组已移除，待执行组不再需要排除草稿条目。
                      const todoList = items.filter((it) => {
                        const batch = batchOf(it)
                        if (batch !== null) return batch.allDone !== true
                        return it.execute !== true
                      })
                      // id=381：这里原来每个组还带一个 `defaultOpen` 字段
                      //（reviewed/unreviewed: false，todo/draft: true），但**全项目没有任何地方读它** ——
                      // 是个死字段。
                      //
                      // 为什么要删掉而不是留着：它长得就像「默认展开某个组」的初始化写法，
                      // 而实际生效的默认值只有一处 —— openGroup 的 useState 初值（见组件顶部）。
                      // 两处并存时，后来的人改完 `defaultOpen` 发现没反应，才会去翻真正的初值；
                      // 更糟的是照着它的语义去「修」，把 `unreviewed: true` 改成 true 期待
                      // 首个待审核项自动展开 —— 于是又造出本条要清掉的那种行为。
                      // 展开态只有一个来源：openGroup（组）与 openId（条目），
                      // 两者的初值都必须是 null（无默认展开项）。
                      const groups = [
                        { key: 'reviewed', title: '已审核', list: doneReviewed, drag: false, alwaysShow: false, emptyText: '还没有审核通过的计划' },
                        { key: 'unreviewed', title: '待审核', list: donePending, drag: false, alwaysShow: true, emptyText: '暂无待审核内容' },
                        { key: 'todo', title: '待执行', list: todoList, drag: true, alwaysShow: true, emptyText: '待执行里没有计划，在下面的输入框写一条。' },
                        // id=405：草稿组已移除（题面：界面不再出现任何草稿相关元素）。
                      ]
                      // id=fzTvER-B：每个组的「序号」——在**已排好序的列表**上算一次，
                      // 渲染时按 id 查。序号是展示用的位置（1 起），与 id 无关。
                      //
                      // 为什么按组算而不是全局算：三个页签各自的列表长度不同，
                      // 用户看到的「第 2 条」是该页签里的第 2 条。全局编号会在
                      // 每个页签里出现跳号（1、3、7），反而更难读。
                      //
                      // 为什么先算成 Map 再传下去：`sequenceOf` 按数组下标递增，
                      // 而渲染时拿到的是单个 item —— 用 Map 查是 O(1)，
                      // 也避免在渲染循环里重复算整份列表。
                      const seqByGroup = new Map()
                      for (const group of groups) {
                        seqByGroup.set(group.key, sequenceMapOf(group.list))
                      }
                      const renderItem = (item, dragEnabled, groupKey) => {
                        // 「待审核」「已审核」两组支持勾选：分别用于批量审核、批量删除。
                        // id=405：草稿组移除后，「批量转待执行」这个用途也不存在了。
                        // 正在执行的条目任何组都不参与勾选。
                        const selectable =
                          (groupKey === 'unreviewed' || groupKey === 'reviewed') &&
                          statusOf(item, false, delivered).key !== 'running'
                        const pickedSet = groupKey === 'reviewed' ? pickedDone : picked
                        const setPickedSet = groupKey === 'reviewed' ? setPickedDone : setPicked
                        // id=fzTvER-B：这一条在所属页签里的位置（1 起）。
                        // 查不到时退回 0 —— 由 Item 决定不渲染序号，
                        // 而不是在这里硬编一个可能错的数字。
                        //
                        // 注意用**原始 id 值**查：`sequenceMapOf` 用的就是 `item.id` 本身，
                        // 数字 id（历史数据）与字符串 id（随机 6 位）各自作为 Map 键，
                        // 这里若先 `String()` 一遍反而查不到历史数字 id。
                        const seqMap = seqByGroup.get(groupKey)
                        const seq = seqMap instanceof Map ? (seqMap.get(item.id) ?? 0) : 0
                        return h(Item, {
                          key: item.id,
                          item,
                          // id=fzTvER-B：展示用序号（1 起，所属页签内）。0 表示查不到。
                          seq,
                          // 这一条刚换了分组：让它在新的栏里播一次「升华 / 蒸腾」动画。
                          sublime: sublimeIds.has(item.id),
                          open: openId === item.id,
                          // 展开时按需取回的单条全文（正文 + 备注）。
                          detail: openId === item.id ? detail : null,
                          busy,
                          dragEnabled,
                          selectable,
                          // 所属分组，决定「复制 ID / 复制内容」这类组内专属按钮是否出现。
                          groupKey,
                          // id=89-D：派发记录透传给行组件 —— 「执行中」要靠它与 id 关联判定。
                          delivered,
                          // 置顶按钮只出现在待执行组，且拆分出来的子任务不给（id=243）。
                          // 判定依据只能是 `decomposeKey`：`[拆] ` 是宿主拼在 name 上的文案，
                          // 用户改个名就骗过去了，而 key 是落盘事实（宿主 `dedupeKeyOf` 生成）。
                          // 为什么不许置顶：拆解出来的是一组按顺序铺开的工作单元，把它们
                          // 挑一条顶到最前面，等于绕过拆解给出的执行顺序，用户看着也乱。
                          canPin: groupKey === 'todo' && (item.decomposeKey ?? '') === '',
                          onPinTop: () => void pinTop(item.id),
                          // id=354：拆解批次头部的「整批通过」统一入口。
                          // 只传 id，遍历 children 与收尾都在 approveBatch 里做 ——
                          // 按钮本身保持哑组件，不自己算「这一批还剩几条」。
                          onApproveBatch: (batchId) => void approveBatch(batchId),
                          // id=405：草稿模式整体移除后，这里原本的两组 prop 一并删掉：
                          //   · onPromote（草稿组专属「转为待执行」）
                          //   · canDemote / onDemote（待执行里的「转为草稿」）
                          // 它们的来源/目的地都是草稿组，草稿没了就不存在可转的组。
                          // 同时删掉 `editable: groupKey === 'draft'` —— 它只对草稿组为 true，
                          // 而草稿组已不存在，留着是一个永远为 false 的死 prop。
                          // 会话在跑但这条还没写 startedAt：先按「执行中」显示。
                          impliedRunning: impliedRunningId === item.id,
                          // 三组都不再显示「已执行」只读勾选框：待执行还没跑，待审核/已审核必然已执行。
                          showExecute: false,
                          // 「审核通过」只在待审核组需要：已审核的都通过了，不再重复勾一次。
                          showReview: groupKey === 'unreviewed',
                          selected: pickedSet.has(item.id),
                          onSelect: (on) => {
                            setPickedSet((prev) => {
                              const next = new Set(prev)
                              if (on) next.add(item.id)
                              else next.delete(item.id)
                              return next
                            })
                          },
                          dragging: dragId === item.id,
                          dropTarget: dropId === item.id && dragId !== null && dragId !== item.id,
                          // id=397：刚落下的那一条（播回弹确认）。
                          dropped: droppedId === item.id,
                          onDragStart: () => {
                            setDragId(item.id)
                            setDropId(null)
                            // 新一次拖拽开始：把上一次的回弹状态与它的 timer 都清掉，
                            // 否则上一记回弹会在这里被打断（观感是「刚放下又抖一下」）。
                            if (droppedTimerRef.current !== null) {
                              window.clearTimeout(droppedTimerRef.current)
                              droppedTimerRef.current = null
                            }
                            setDroppedId(null)
                          },
                          onDragOver: () => {
                            if (dragId !== null && dragId !== item.id) setDropId(item.id)
                          },
                          onDrop: () => {
                            // 松手的这一条要播「已落下」回弹（id=397）。
                            // 注意顺序：先记 droppedId 再清 dragId/dropId ——
                            // 三个 state 在同一次事件里批量更新，React 会合成一次渲染，
                            // 所以不存在「先渲染出没有 droppedId 的中间态」的问题。
                            const landed = item.id
                            void moveTo(dragId, item.id)
                            setDragId(null)
                            setDropId(null)
                            if (droppedTimerRef.current !== null) window.clearTimeout(droppedTimerRef.current)
                            setDroppedId(landed)
                            // 320ms 与 CSS 里 plt-dropped 的时长对齐（略多 20ms 余量，
                            // 保证动画先播完再摘类，避免它被截断在半途）。
                            droppedTimerRef.current = window.setTimeout(() => {
                              droppedTimerRef.current = null
                              setDroppedId(null)
                            }, 340)
                          },
                          onDragEnd: () => {
                            setDragId(null)
                            setDropId(null)
                          },
                          onToggle: () => toggleItem(item.id),
                          onFetchDetail: fetchDetail,
                          // id=273：父节点展开后是子任务列表，每行一个「通过」——
                          // 子任务不在顶层 openId 体系里，patch 的 id 由行内自己给。
                          // 顶层卡片的调用仍然只传值（不传 id）。
                          // id=325：子任务 id 现在是 "100-A" 这种字符串，只判 typeof number
                          // 会把它当成 patch 对象，于是「通过」实际打到了父上（子任务没变）。
                          onPatch: (a, b) => (typeof a === 'number' || typeof a === 'string' ? patch(a, b) : patch(item.id, a)),
                          onRemove: () => remove(item.id),
                        })
                      }
                      return groups
                        .filter((group) => group.alwaysShow === true || group.list.length > 0)
                        .map((group) => {
                          const isOpen = openGroup === group.key
                          // id=238：这一组里有没有「正在执行」的条目 —— 唯一口径还是 statusOf，
                          // 与卡片上那个「执行中」标签逐条对齐（含 impliedRunning 那一条）。
                          // 必须挂在组容器上：收起时组内卡片整块不渲染，后代选择器无从判断（见 id=237 定位）。
                          // 刻意不含 starting：刚点下「开始」、模型还没接手的那几秒组里一条执行中的都没有。
                          const isRunning = group.list.some((it) => statusOf(it, impliedRunningId === it.id, delivered).key === 'running')
                          const pendingIds = group.key === 'unreviewed' ? group.list.map((item) => item.id) : []
                          const allPicked = pendingIds.length > 0 && pendingIds.every((id) => picked.has(id))
                          // 「已审核」组同样支持勾选，用于批量删除。
                          const doneIds = group.key === 'reviewed' ? group.list.map((item) => item.id) : []
                          const allPickedDone = doneIds.length > 0 && doneIds.every((id) => pickedDone.has(id))
                          // （id=405：草稿组的勾选与批量操作已随草稿模式删除。）
                          return h(
                            'div',
                            { key: group.key, className: `plt-group plt-group-${group.key}${isOpen ? ' open' : ''}${isRunning ? ' is-running' : ''}`, 'data-running': isRunning ? 'true' : 'false' },
                            h(
                              'div',
                              {
                                className: `plt-group-h${isOpen ? ' open' : ''}${isOpen ? '' : arriveGroups.has(group.key) ? ' plt-arrive' : ''}`,
                                onClick: () => setOpenGroup(isOpen ? null : group.key),
                                'aria-expanded': isOpen ? 'true' : 'false',
                              },
                              h('span', { className: 'plt-caret' }, h(CaretIcon, { size: 13 })),
                              h('span', { className: 'plt-group-name' }, group.title),
                              // id=337：条数统计挪到组头最右端（所有控件之后），
                              // 读数固定补足三位（001 / 012 / 123）—— 组与组之间同一位置、
                              // 同一宽度，展开收起时右边界不会跟着数字位数来回跳。
                              // id=240：组收起、里面还有条目在跑时，给一句看得见的提示。
                              // 展开态不显示 —— 那时卡片自己的「执行中」标签就在眼前，再说一遍是噪音。
                              // 文字 + 转圈都放进去：侧栏很窄时 aria/title 是读屏与悬停的兜底。
                              isRunning && isOpen !== true
                                ? h(
                                    'span',
                                    { className: 'plt-group-run', 'data-tip': '这一组里还有任务正在执行', 'aria-label': '正在执行' },
                                    h(SpinnerIcon, { size: 11 }),
                                    h('span', { className: 'plt-group-run-txt' }, '正在执行'),
                                  )
                                : null,
                              // id=391：「待审核超过 N 条自动通过最旧一条」的下拉已删除
                              //（题面：取消自动审核机制 + 移除下拉选项）。
                              // 待审核组头现在只剩「条数统计」，不再有阈值控件。
                              // 组头因此回归到「名字 + 统计」这一种形状，与其它三组一致 ——
                              // 原来只有待审核组头有一个 <select>，那一行的高度和留白都
                              // 跟别的组对不上，收敛后整列终于齐了。
                              // id=337：条数统计压在所有控件之后（最右端），补足三位。
                              // 放最后而不是紧跟组名：下拉 / 提示 / 备份开关的长短各不相同，
                              // 数字挂在组名后面时每一组的位置都不一样，扫视时对不齐。
                              h('span', { className: 'plt-group-count' }, padCount(group.list.length)),
                            ),
                            isOpen
                              ? group.list.length > 0
                                ? h(
                                    React.Fragment,
                                    null,
                                    h('div', { className: 'plt-group-body' }, group.list.map((item) => renderItem(item, group.drag, group.key))),
                                    // 「待审核」组底部固定一排操作：全选 + 全部通过。
                                    group.key === 'unreviewed'
                                      ? h(
                                          'div',
                                          { className: 'plt-bulk' },
                                          h(
                                            'label',
                                            { className: 'plt-check', 'data-tip': allPicked ? '取消全选' : '全选本组全部' },
                                            h('input', {
                                              type: 'checkbox',
                                              checked: allPicked,
                                              disabled: busy,
                                              onChange: (e) => {
                                                if (e.target.checked) {
                                                  setPicked(new Set(pendingIds))
                                                } else {
                                                  setPicked(new Set())
                                                }
                                              },
                                            }),
                                            h('span', null, '全选'),
                                          ),
                                          h('span', { className: 'plt-bulk-count' }, picked.size > 0 ? `已选 ${picked.size}` : ''),
                                          h(
                                            'button',
                                            {
                                              className: 'plt-btn plt-bulk-pass',
                                              disabled: busy || picked.size === 0,
                                              'data-tip': '把勾选的计划一次性审核通过',
                                              onClick: (e) => {
                                                e.stopPropagation()
                                                void approvePicked([...picked])
                                              },
                                            },
                                            '全部通过',
                                          ),
                                        )
                                      : null,
                                    // 「已审核」组底部固定一排操作：全选 + 全部删除。
                                    group.key === 'reviewed'
                                      ? h(
                                          'div',
                                          { className: 'plt-bulk plt-bulk-danger' },
                                          h(
                                            'label',
                                            { className: 'plt-check', 'data-tip': allPickedDone ? '取消全选' : '全选本组全部' },
                                            h('input', {
                                              type: 'checkbox',
                                              checked: allPickedDone,
                                              disabled: busy,
                                              onChange: (e) => {
                                                if (e.target.checked) {
                                                  setPickedDone(new Set(doneIds))
                                                } else {
                                                  setPickedDone(new Set())
                                                }
                                              },
                                            }),
                                            h('span', null, '全选'),
                                          ),
                                          h('span', { className: 'plt-bulk-count' }, pickedDone.size > 0 ? `已选 ${pickedDone.size}` : ''),
                                          h(
                                            'button',
                                            {
                                              className: 'plt-btn plt-bulk-del',
                                              disabled: busy || pickedDone.size === 0,
                                              'data-tip': '把勾选的已审核计划一次性删除',
                                              onClick: (e) => {
                                                e.stopPropagation()
                                                void removePickedDone([...pickedDone])
                                              },
                                            },
                                            '全部删除',
                                          ),
                                        )
                                      : null,
                                    // id=405：草稿组底部那排操作（全选 / 全部删除 / 转待执行）
                                    // 随草稿组一并删除 —— 三个动作的对象都是草稿条目。
                                    // 「待执行」组底部固定一排操作：待执行存在时提供「开始干活」。
                                    // 点了才把提示词发进左侧会话，写完计划不再自动开工。
                                    // 只要模型在跑（会话 running / 某条已写 startedAt / 刚点下去），
                                    // 按钮就变成「干活中」+ 转圈图标，并且不可再点，避免重复投喂。
                                    group.key === 'todo' && group.list.length > 0
                                      ? h(
                                          'div',
                                          { className: 'plt-bulk plt-bulk-start' },
                                          h(
                                            'span',
                                            { className: 'plt-bulk-count' },
                                            runningCount > 0
                                              ? `正在执行 ${runningCount} 条…`
                                              : agentRunning
                                                ? '模型正在干活…'
                                                : `${group.list.length} 条待执行`,
                                          ),
                                          h(
                                            'button',
                                            {
                                              className: `plt-btn plt-bulk-go${working ? ' is-working' : ''}`,
                                              disabled: busy || working || starting,
                                              'data-tip':
                                                working
                                                  ? '模型正在干活，等它完成再开始下一条'
                                                  : '把队首任务发进左侧会话，和后面自动派发的是同一段正文',
                                              onClick: (e) => {
                                                e.stopPropagation()
                                                void startWork()
                                              },
                                            },
                                            working || starting ? h(SpinnerIcon, { size: 13 }) : null,
                                            h('span', null, starting ? '发送中…' : working ? '干活中' : `▶ ${KICKOFF_TEXT}`),
                                          ),
                                        )
                                      : null,
                                  )
                                : h(
                                    'div',
                                    { className: 'plt-group-empty' },
                                    h(EmptyIcon, { size: 22 }),
                                    h('span', null, group.emptyText ?? '暂无内容'),
                                  )
                              : null,
                          )
                        })
                    })(),
        ),
        state.data?.planExists === true
          ? h(
              'div',
              { className: 'plt-form-wrap' },
              h(
                'div',
                { className: 'plt-composer' },
                h('textarea', {
                  className: 'plt-input',
                  placeholder: '写下一条计划，按 Shift+Enter 追加（Ctrl/Cmd+Enter 也可以）…',
                  value: form.plan,
                  onChange: (e) => setForm({ ...form, plan: e.target.value }),
                  onKeyDown: (e) => {
                    // Shift+Enter 追加任务；Ctrl/Cmd+Enter 作为习惯动作也保留。
                    const submit = (e.shiftKey || e.metaKey || e.ctrlKey) && e.key === 'Enter'
                    if (submit) {
                      e.preventDefault()
                      void append()
                    }
                  },
                }),
                h(
                  'div',
                  { className: 'plt-bar' },
                  h(
                    'div',
                    { className: 'plt-chips' },
                    // 「仅回答」放最后面。
                    // 三个类型之间插一个「-」、拆解之前插一个「+」，用来说明「类型三选一」
                    // 与「拆解是叠加的第四项」这两层关系（id=145）。
                    // 连接符是 .plt-op 定高居中的纯文本，不参与点击、不占选位。
                    (() => {
                      const types = ['修改', '目标', '仅回答'].filter((type) =>
                        (state.data?.taskTypes ?? ['仅回答', '目标', '修改']).includes(type),
                      )
                      // 一个「段」= 可选连接符 + 一枚胶囊，段内不拆开。
                      // 这样换行时连接符永远跟着它右边的胶囊走，不会单独落在行首（id=145）。
                      const nodes = []
                      types.forEach((type, index) => {
                        const seg = []
                        if (index > 0) seg.push(h('span', { key: `op-${type}`, className: 'plt-op', 'aria-hidden': 'true' }, '-'))
                        seg.push(
                          h(
                            'button',
                            {
                              key: type,
                              type: 'button',
                              className: `plt-chip${form.taskType === type ? ' active' : ''}`,
                              disabled: busy,
                              'data-tip': `任务类型：${type}`,
                              onClick: () => setForm({ ...form, taskType: type }),
                            },
                            h('span', { className: 'plt-chip-ico' }, h(ModeIcon, { kind: type, size: 13 })),
                            h('span', { className: 'plt-chip-txt' }, type),
                          ),
                        )
                        nodes.push(h('span', { key: `seg-${type}`, className: 'plt-seg' }, seg))
                      })
                      // 拆解模式：紧贴在「仅回答」右侧，用一个「+」连起来，
                      // 表明它不是类型之一，而是叠加在已选类型上的开关。
                      nodes.push(
                        h(
                          'span',
                          { key: 'seg-split', className: 'plt-seg' },
                          h('span', { key: 'op-split', className: 'plt-op', 'aria-hidden': 'true' }, '+'),
                          h(
                            'button',
                            {
                              key: 'split',
                              type: 'button',
                              className: `plt-chip plt-chip-split${splitMode ? ' active' : ''}`,
                              disabled: busy || splitting,
                              'aria-pressed': splitMode ? 'true' : 'false',
                              // id=5-D：原文是「叠加开关，可与其他任务类型同时生效」——
                              // 说对了能同时开，但没说清叠加**只改文本深度、不改条数**。
                              // 与深入开关那条 tip 保持同一口径，避免两个按钮各说各话。
                              'aria-label': '拆解模式（可与深入模式同时开启；深入只影响每条写多深，不影响拆成几条）',
                              // id=363：气泡里带上「这一拆会用哪个模型」。拆解是唯一真调模型的动作，
                              // 而模型的选择以前完全不可见 —— 用户只能靠「拆出来才知道」。
                              // 目录还没回来（modelState.selection 为 null）时这句不出现，
                              // 不写「未知模型」那种更吓人的占位。
                              'data-tip': (() => {
                                const who = modelState.selection === null
                                  ? ''
                                  : `（模型 ${modelState.selection.model}）`
                                return splitMode
                                  ? `拆解模式已开启：发送时按项目情况自动拆成多条，落在「待执行」${who}（点击关闭）`
                                  : `开启拆解模式：发送时按项目情况把这段话拆成几条待执行任务${who}`
                              })(),
                              onClick: () => setSplitMode(!splitMode),
                            },
                            h('span', { className: 'plt-chip-ico' }, h(SplitIcon, { size: 13 })),
                            h('span', { className: 'plt-chip-txt' }, '拆解'),
                          ),
                        ),
                      )
                      return nodes
                    })(),
                  ),
                  // 深入开关（发送键左侧的圆形按钮）：默认不选中；
                  // 点亮后「发送」会把输入框里的任务改写为「要求做深」的提示词。
                  // id=262：草稿模式下深入本来就不生效（草稿只存原话），以前按钮照样能点、
                  // tip 照样承诺「会改写」，用户点了却发现什么都没变。现在直接置灰并说明原因。
                  h(
                    'button',
                    {
                      type: 'button',
                      className: `plt-deep-toggle${deepMode ? ' on' : ''}`,
                      disabled: busy,
                      'aria-pressed': deepMode ? 'true' : 'false',
                      // id=405：原来这里还会因为「草稿模式」置灰 —— 草稿只存原话、深入会改写，
                      // 两者互斥。草稿模式移除后这条互斥消失，深入开关只剩 busy 一个禁用条件。
                      // id=5-D：两个开关同时点亮时，用户最容易误以为「叠加会让拆出来的条数变多」。
                      // 实测（见 docs/toggle-combo-result.md）：条数只由 DECOMPOSE_MIN/SOFT_MAX 决定，
                      // deep 完全不参与；叠加的唯一效果是「每条写得更深」。这句必须说清，
                      // 否则用户点完两个开关、发现还是那几条，会以为开关坏了。
                      'data-tip': deepMode
                          ? splitMode
                            ? '深入模式已开启：拆解时要求把每一条子任务都做深；拆成几条不受它影响（点击关闭）'
                            : '深入模式已开启：发送时会改写提示词，要求把任务做深（点击关闭）'
                          : splitMode
                            ? '开启深入模式：拆解时要求把每一条子任务都做深；拆成几条不受它影响'
                            : '开启深入模式：发送时自动把任务改写成「做深而不是做大」的提示词',
                      // 读屏拿不到上面的长句，这里把叠加语义也带上
                      'aria-label': deepMode ? '深入模式（已开启）' : '深入模式',
                      onClick: () => setDeepMode(!deepMode),
                    },
                    h(DeepIcon, { size: 15 }),
                  ),
                  // id=405：草稿开关按钮（plt-draft-toggle）已删除 ——
                  // 它是草稿模式的唯一入口，草稿组不存在后这个开关没有落点。
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'plt-send',
                      disabled: busy || splitting,
                      // id=405：草稿模式移除后，发送键的文案回到单一含义 ——
                      // 拆解模式说「拆解成多条」，否则说「提交」。
                      'data-tip': splitting
                        ? '正在拆解，请稍候…'
                        : splitMode
                          ? '拆解成多条，落在待执行（Shift+Enter）'
                          : '提交（Shift+Enter）',
                      'aria-label': splitMode ? '拆解成待执行' : '提交计划',
                      onClick: append,
                    },
                    splitting ? h(SpinnerIcon, { size: 15 }) : h(SendIcon, { size: 15 }),
                  ),
                ),
              ),
            )
          : null,
        h(
          'div',
          { className: 'plt-foot' },
          h(
            'span',
            { className: 'plt-foot-text', 'data-tip': state.data?.planPath ?? '.plan/plan.json' },
            state.data?.planPath ?? '.plan/plan.json',
            // 技能是插件内置的虚拟技能（`ctx.skills.register`），不落到项目目录，
            // 所以不再有「未创建 / 已就绪」之分，也不需要任何同步入口。
            ' · 技能内置',
          ),
        ),

        showInit ? h(InitDialog, { busy, onInit: doInit, onClose: () => setShowInit(false) }) : null,
        // 拆解遮罩：点发送那一刻就盖上来（splitting 在 await 之前就已置 true）。
        // pointer-events:none —— 只提示、不拦点击，侧边栏其它按钮照常可用。
        splitting
          ? h(
              'div',
              { className: 'plt-split-mask', 'aria-live': 'polite', 'aria-busy': 'true' },
              h(
                'div',
                { className: 'plt-split-card' },
                // id=213：卡片整体放大一档，转圈图标跟着从 15 抬到 18，免得看着头重脚轻。
                h(SpinnerIcon, { size: 18 }),
                h(
                  'span',
                  { className: 'plt-split-text' },
                  h('strong', null, '正在拆解…'),
                  h('span', { className: 'plt-split-hint' }, '产物将落在待执行组'),
                ),
              ),
            )
          : null,
      )
    }

    function apply(ctx) {
      // id=79-C：样式注入已从客户端移除。
      // 原先这里用 ctx.effect 在运行时动态创建一个 style 元素、把 CSS 字符串塞进去；
      // 现在样式由宿主以静态资源提供（/plan-tasks/styles.css），
      // 并在 index.html 里注入 <link rel="stylesheet">（见 lib/host/styles.js）。
      // 好处：运行时不再生成任何 <style> 节点，样式可被浏览器当普通 CSS 处理
      // （缓存、CSP、样式覆盖率分析都正常工作），也不必为改一行颜色重建客户端包。

      // betterSidebar 是可选依赖：软注入，未安装时静默跳过。
      ctx.inject(['betterSidebar'], (bsCtx) => {
        const bs = bsCtx.betterSidebar
        if (bs === undefined || typeof bs.registerTab !== 'function') return
        bsCtx.effect(
          () =>
            bs.registerTab({
              id: TAB_ID,
              title: '任务列表',
              description: '读取项目根目录 .plan/plan.json，按计划查看进度、耗时与执行结果',
              order: 40,
              single: true,
              icon: (size) => h(PlanIcon, { size }),
              component: (props) => h(PlanTasksTab, props),
            }),
          'dsh-plan-tasks: 任务列表 tab',
        )
      })
    }

    return {
      // 只声明内核必定提供的服务；betterSidebar 走 apply 内软注入。
      inject: ['slots'],
      apply,
    }
  },
})
