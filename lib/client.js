// 本文件由 build.mjs 从 src/client/*.js 生成，请勿直接修改。
// 改样式或逻辑请改 src/client/ 下的片段，然后 node build.mjs。
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

    /** 图标底色：稳定的品牌蓝。取 static 层 token，主题包不会改写它。 */
    const ICON_BLUE = 'var(--dsw-static-deepseek-500, #4176e6)'


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
          style: {
            display: 'block',
            flex: '0 0 auto',
            color: ICON_BLUE,
          },
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
          style: { display: 'block' },
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

    /** 草稿按钮图标：一页带折角的文档（草稿 = 存下来还没用的文稿）。 */
    function DraftIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 15
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          role: 'img',
          'aria-label': '草稿',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { display: 'block' },
        },
        h('path', { d: 'M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z' }),
        h('path', { d: 'M13 3v6h6' }),
        h('path', { d: 'M9 13h6M9 17h4' }),
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
          style: { display: 'block' },
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
          style: { display: 'block' },
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
        style: { display: 'block' },
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

    /** 修改图标（铅笔，跟类型胶囊里的「修改」图标同款）。 */
    function EditIcon(props) {
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
          strokeWidth: 1.9,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          style: { display: 'block' },
        },
        h('path', { d: 'M4 20h4.2L20.1 8.1a2.1 2.1 0 0 0 0-3L19 4a2.1 2.1 0 0 0-3 0L4.1 15.9 4 20z' }),
        h('path', { d: 'M14.5 5.5l4 4' }),
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
          style: { display: 'block' },
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
          style: { display: 'block' },
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
          style: { display: 'block', flex: '0 0 auto' },
        },
        h('rect', { x: 9, y: 9, width: 12, height: 12, rx: 2.4 }),
        h('path', { d: 'M5.6 15H4.4A2.4 2.4 0 0 1 2 12.6V4.4A2.4 2.4 0 0 1 4.4 2h8.2A2.4 2.4 0 0 1 15 4.4v1.2' }),
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
          style: { display: 'block', flex: '0 0 auto' },
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
          style: { display: 'block', flex: '0 0 auto' },
        },
        h('path', { d: 'M12 19V6' }),
        h('path', { d: 'M6.5 11.5 12 6l5.5 5.5' }),
        h('path', { d: 'M5 3.4h14' }),
      )
    }

    /**
     * 执行中用的转转圈图标：一段圆弧匀速旋转，比文字更直观。
     * `spin: false` 时只画圆弧、不挂动画类 —— 给「刷新」按钮那种由外层状态类
     * 决定何时开始转的场景用，避免图标自带动画和父容器的状态类抢着控制。
     */
    function SpinnerIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 12
      const spinning = props?.spin !== false
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
          className: spinning ? 'plt-spin' : undefined,
          style: { display: 'block', flex: '0 0 auto' },
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
          style: { display: 'block', flex: '0 0 auto' },
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
          style: { display: 'block', flex: '0 0 auto' },
        },
        h('path', { d: 'M9 5v14' }),
        h('path', { d: 'M15 5v14' }),
      )
    }


    /**
     * 深色（默认主题）样式：插件所有颜色都在这里给出兜底值。
     *
     * 拆成片段数组是为了让样式也能按功能分文件（见 src/client/20-css/）。
     * 顺序即层叠优先级：深色基础片段永远排在浅色覆盖之前。
     */
    const CSS_PARTS = []

    /**
     * 悬浮提示（tooltip）主题变量（id=248）。
     *
     * 为什么单独开一个片段：气泡要同时被「卡片内的小标签」「顶栏按钮」「批量条按钮」
     * 三种完全不同的地方用到，颜色一旦散落到各处，下次调主题就得满仓找。
     * 变量都挂在 `.plt-root` 上（不是 `:root`）—— 作用域跟着面板走，
     * 不污染宿主其它区域，也不跟官方主题的 inline token 打架。
     *
     * 前缀统一 `--plt-tip-`；这里只给变量，不写任何组件规则（组件样式在 id=249）。
     *
     * 取值依据（实测对比度，见 id=248 note）：
     * - 深色：底 rgba(34,42,56,.97) 叠在 #151517 上合成 rgb(34,41,55)，
     *   配 #eef2f8 → 12.98:1；边框 rgba(150,175,215,.30) 与气泡底 1.82:1。
     * - 浅色（在 30-light.js 里覆盖）：底 #fff 上的 #1f2733 → 15.04:1。
     * 两套都远超 4.5:1 的正文门槛 —— 气泡本身是浮层，字又小，宁可比正文更硬。
     */
    CSS_PARTS.push(`
.plt-root{
  --plt-tip-bg:rgba(34,42,56,.97);
  --plt-tip-fg:#eef2f8;
  --plt-tip-fg-muted:#c7d2e2;
  --plt-tip-border:rgba(150,175,215,.30);
  --plt-tip-shadow:0 2px 6px rgba(0,0,0,.38),0 12px 28px -8px rgba(0,0,0,.5);
  --plt-tip-radius:8px;
  --plt-tip-pad:7px 10px;
  --plt-tip-font:12px;
  --plt-tip-line:18px;
  /* 最大宽度只是个上限：实际还要被「面板宽度 - 两侧留白」夹一次，
     那一步放在组件规则里做（这里若写 cqw，落进 .plt-bar 这类嵌套容器会量错宽度）。 */
  --plt-tip-max-w:320px;
  /* 出现延迟：鼠标扫过一排按钮时不该一路弹气泡；淡入比淡出快一点，退场才不突兀。 */
  --plt-tip-delay:320ms;
  --plt-tip-fade:140ms;
  /* 箭头是个旋转 45° 的正方形，边长与「气泡到目标元素」的间距分开给，
     否则想在窄栏里把气泡贴紧一点，箭头会跟着一起缩没。 */
  --plt-tip-arrow:5px;
  --plt-tip-offset:8px;
}
`)

    /**
     * 悬浮提示（tooltip）组件样式（id=249）。
     *
     * 颜色一个都不写死 —— 全部走 05-tooltip-vars.js 定义的 `--plt-tip-*`，
     * 所以主题一切换（body 上 data-ds-dark-theme 加/减）这里不用改一个字。
     *
     * 几个关键决定：
     * 1. `position:fixed` 而不是 absolute：面板里有 overflow:hidden 的滚动容器
     *    （.plt-group / .plt-list / .plt-body），absolute 的气泡一出面板就被裁掉半截。
     *    注意 .plt-root 带 container-type:size（见 10-topbar.js:13），按 CSS Containment
     *    规范它同时是 fixed 后代的包含块 —— 所以气泡会被夹在面板里，坐标相对面板算，
     *    正好是我们想要的：提示只在侧栏内活动，不会飘到宿主界面上。坐标由脚本传入（id=250）。
     * 2. `pointer-events:none`：气泡永远不接鼠标，否则它压在目标元素上会立刻触发
     *    mouseleave → 气泡消失 → 又触发 mouseenter，闪成一片（这是 hover 气泡的经典坑）。
     * 3. `white-space:pre-line`：原生 title 里本来就用 `\n` 分段（.plt-name 的
     *    `#id 名称\n\n正文`），pre-line 既保留换行又照常自动折行，比 `<br>` 省事。
     * 4. `overflow-wrap:anywhere`：正文里可能有超长路径（D:/cf/code/...），
     *    不加这条会横向撑破 max-width。
     * 5. 箭头用两个伪元素叠出来：`::before` 是比气泡大 1px 的描边三角、
     *    `::after` 是填色三角盖在上面。只用一层填色三角的话，气泡有 1px 边框、
     *    箭头没边框，接缝处会断一截，看着像贴歪了。
     * 6. `z-index:60`：要压过拆解遮罩（18）、组头 sticky（3）、弹窗（30 上下）。
     */
    CSS_PARTS.push(`
.plt-tip{position:fixed;z-index:60;box-sizing:border-box;max-width:var(--plt-tip-max-w);padding:var(--plt-tip-pad);border:1px solid var(--plt-tip-border);border-radius:var(--plt-tip-radius);background:var(--plt-tip-bg);color:var(--plt-tip-fg);box-shadow:var(--plt-tip-shadow);font-size:var(--plt-tip-font);line-height:var(--plt-tip-line);font-weight:400;font-style:normal;letter-spacing:.01em;text-align:left;white-space:pre-line;overflow-wrap:anywhere;word-break:break-word;pointer-events:none;opacity:0;transition:opacity var(--plt-tip-fade) ease,transform var(--plt-tip-fade) ease}
/* 出现时只把不透明度与位移收回来，不留 display 切换 —— 那会让淡出根本没时间播。 */
.plt-tip.is-on{opacity:1;transform:none}
/* 箭头基底：0 尺寸 + border 拼三角，颜色按方向各给一条。 */
.plt-tip::before,.plt-tip::after{content:'';position:absolute;width:0;height:0;border-style:solid;border-color:transparent;pointer-events:none}
.plt-tip::before{border-width:calc(var(--plt-tip-arrow) + 1px)}
.plt-tip::after{border-width:var(--plt-tip-arrow)}
/* —— 上：气泡在目标之上，箭头朝下 —— */
.plt-tip--top{transform:translateY(3px)}
.plt-tip--top::before{left:50%;bottom:calc(-1 * (var(--plt-tip-arrow) + 1px));margin-left:calc(-1 * (var(--plt-tip-arrow) + 1px));border-top-color:var(--plt-tip-border)}
.plt-tip--top::after{left:50%;bottom:calc(-1 * var(--plt-tip-arrow));margin-left:calc(-1 * var(--plt-tip-arrow));border-top-color:var(--plt-tip-bg)}
/* —— 下：箭头朝上 —— */
.plt-tip--bottom{transform:translateY(-3px)}
.plt-tip--bottom::before{left:50%;top:calc(-1 * (var(--plt-tip-arrow) + 1px));margin-left:calc(-1 * (var(--plt-tip-arrow) + 1px));border-bottom-color:var(--plt-tip-border)}
.plt-tip--bottom::after{left:50%;top:calc(-1 * var(--plt-tip-arrow));margin-left:calc(-1 * var(--plt-tip-arrow));border-bottom-color:var(--plt-tip-bg)}
/* —— 左：箭头朝右 —— */
.plt-tip--left{transform:translateX(3px)}
.plt-tip--left::before{top:50%;right:calc(-1 * (var(--plt-tip-arrow) + 1px));margin-top:calc(-1 * (var(--plt-tip-arrow) + 1px));border-left-color:var(--plt-tip-border)}
.plt-tip--left::after{top:50%;right:calc(-1 * var(--plt-tip-arrow));margin-top:calc(-1 * var(--plt-tip-arrow));border-left-color:var(--plt-tip-bg)}
/* —— 右：箭头朝左 —— */
.plt-tip--right{transform:translateX(-3px)}
.plt-tip--right::before{top:50%;left:calc(-1 * (var(--plt-tip-arrow) + 1px));margin-top:calc(-1 * (var(--plt-tip-arrow) + 1px));border-right-color:var(--plt-tip-border)}
.plt-tip--right::after{top:50%;left:calc(-1 * var(--plt-tip-arrow));margin-top:calc(-1 * var(--plt-tip-arrow));border-right-color:var(--plt-tip-bg)}
/* 文字装在内层，外层只负责边框、箭头与定位（id=251）。
   高度上限由脚本按面板高度写进 style，这里只声明「超了就裁」——
   放在外层会连箭头的位子一起裁掉，所以只能在内层裁。 */
.plt-tip-inner{overflow:hidden}
/* 气泡贴边翻到另一侧时，箭头不需要跟着重描 —— 方向类一换，上面四组自动就位。 */

/* 用户要求减少动效：连位移一起撤掉，只保留瞬时显隐（不做淡入也照样能读）。 */
@media (prefers-reduced-motion: reduce){
  .plt-tip{transition:none;transform:none}
}
/* 浅色不需要额外规则：颜色全部来自变量，而变量在 30-light.js 里已经换过一套。
   这里刻意不写 body:not([data-ds-dark-theme]) 覆盖 —— 多一套就多一处会忘记同步的地方。 */
`)

    /**
     * 顶部栏与通用按钮：面板根、标题、刷新/自动刷新按钮。
     *
     * 本片段是 CSS_PARTS 的一段，位置即层叠顺序（由 build.mjs 按文件名字典序拼接）。
     */
    CSS_PARTS.push(`
/* container-type:size（id=152）：让输入框的高度能按「面板实际高度」伸缩（cqh），
   而不是按窗口高度（vh）。侧栏被拖矮时 vh 察觉不到，会把列表挤成负数高度；
   用 cqh 后输入框自己先收，列表始终留得下。
   position:relative（id=171）：container-type 只建立 cqh 容器，**不建立 absolute 的包含块**。
   没有它，面板里 position:absolute;inset:0 的两块遮罩会锚到浏览器视口（ICB）而不是面板自己 ——
   实测面板 460×700 时遮罩撑成 512×602，于是「在遮罩里居中」= 在错误的盒子里居中。 */
.plt-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;container-type:size;font-size:14px;color:var(--dsw-alias-label-primary,#e6e6e6)}
.plt-top{flex:0 0 auto;display:flex;flex-wrap:nowrap;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,.08))}
.plt-title{font-weight:600;font-size:19px;letter-spacing:.01em;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.plt-btn{cursor:pointer;border:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,.14));background:transparent;color:inherit;border-radius:6px;padding:3px 9px;font-size:14px;line-height:20px;white-space:nowrap}
.plt-btn:hover:not(:disabled){background:var(--dsw-alias-bg-hover,rgba(255,255,255,.06))}
.plt-btn:disabled{opacity:.5;cursor:default}
.plt-btn.primary{background:var(--dsw-alias-bg-accent,#2f6fd0);border-color:transparent;color:#fff}
.plt-auto{display:inline-flex;align-items:center;gap:6px;min-width:62px;justify-content:center;font-variant-numeric:tabular-nums}
.plt-auto .plt-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-caption,#8a8a8a);flex:0 0 auto}
.plt-auto.on{color:var(--dsw-alias-label-accent,#7fb0ff);border-color:rgba(80,140,255,.45)}
.plt-auto.on .plt-dot{background:#4caf50;box-shadow:0 0 0 2px rgba(76,175,80,.18)}
/* 刷新按钮（id=196/197）：图标位 + 文案位，图标默认静止。
   inline-flex + gap 让图标与文字在一行内垂直居中；不用 margin 拼间距，
   否则按钮被压窄时两端留白不对称。颜色走 currentColor，
   深/浅色主题各自由 .plt-btn 的 color 决定，这里不写死颜色。 */
.plt-refresh{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto}
.plt-refresh-ico{display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;flex:0 0 auto;color:currentColor}
.plt-refresh-label{flex:0 0 auto}
/* 「旋转中」与「静止」两个状态类（id=197），由忙碌状态二选一挂上，见 id=198。
   - .spinning：圆弧匀速转；
   - .idle：显式声明不转，并把不透明度钉在 1（图标是装饰位，不该因为状态类
     切换而变淡/变亮，否则按钮文字看着会「闪」一下）。
   两者都只作用于 svg，容器尺寸不变，切换时不会触发重排。
   复用 15-detail.js 已有的 plt-spin 关键帧，避免同一套旋转写两遍；
   减少动态偏好下即使带 spinning 也不转。 */
.plt-refresh-ico.spinning svg{animation:plt-spin .9s linear infinite;transform-origin:50% 50%}
.plt-refresh-ico.idle svg{animation:none;opacity:1}
@media (prefers-reduced-motion: reduce){.plt-refresh-ico.spinning svg{animation:none}}
/* 开始 / 暂停（id=207）：与刷新同族的图标按钮。
   inline-flex + gap 让图标与文字垂直居中并保持固定间距；flex:0 0 auto
   保证顶栏被压窄时这两个按钮不参与收缩，压缩全部由 .plt-title 承担。 */
.plt-start,.plt-pause{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto}
/* 开始按钮是这一行里唯一的主动作，给一点绿色倾向（不是实心，仍然克制），
   让它在「自动刷新」「刷新」两个中性按钮里能被一眼找到。 */
.plt-start:not(:disabled){color:var(--dsw-alias-label-primary,#e6e6e6)}
.plt-start:not(:disabled):hover{background:rgba(34,150,84,.14);border-color:rgba(34,150,84,.42)}
/* 暂停是反向动作，hover 透出暖橙，与开始分得开又不至于像报错。 */
.plt-pause:not(:disabled):hover{background:rgba(216,120,32,.12);border-color:rgba(216,120,32,.38)}
/* —— 四个状态的视觉（id=210）——
   未开始 / 执行中 / 已暂停 / 异常，各自由既有的推导变量挂类，不新增状态：
   · .plt-start.is-resume —— 已挂起，这个按钮现在是「继续」，用蓝调与「开始」的绿区分；
   · .plt-pause:not(:disabled) —— 执行中它才是可点的，给琥珀描边说明「现在能停」；
   · :disabled —— 统一压到 .42（.plt-btn 的 .5 在这两个带色按钮上仍然偏亮）；
   · .plt-top.has-error —— 上次操作失败时两按钮描红，和顶部的错误提示对上。 */
.plt-start.is-resume:not(:disabled){color:rgba(120,162,255,.98);border-color:rgba(80,140,255,.46);background:rgba(65,118,230,.12)}
.plt-start.is-resume:not(:disabled):hover{background:rgba(65,118,230,.20);border-color:rgba(80,140,255,.62)}
.plt-pause:not(:disabled){color:rgba(255,190,90,.96);border-color:rgba(255,180,60,.42)}
.plt-start:disabled,.plt-pause:disabled{opacity:.42}
/* 执行中把「暂停」的图标压暗一点点，避免两个按钮的图标亮度互相抢眼；
   文字保持可读，禁用时不受影响（:not(:disabled) 已经排除）。 */
.plt-pause:not(:disabled) svg{opacity:.92}
.plt-top.has-error .plt-start,.plt-top.has-error .plt-pause{border-color:rgba(214,68,68,.52)}
.plt-top.has-error .plt-start.is-resume:not(:disabled){border-color:rgba(214,68,68,.62)}`)

    /**
     * 遮罩与顶部行内提示：拆解中的贴边提示卡、提交/审核结果的提示文字。
     *
     * 本片段是 CSS_PARTS 的一段，位置即层叠顺序（由 build.mjs 按文件名字典序拼接）。
     */
    CSS_PARTS.push(`/* 拆解遮罩：点发送立刻盖上，右侧贴边一张提示卡。
   pointer-events:none 是刻意的 —— 遮罩只做视觉提示，不接管点击，
   底下（以及侧边栏其它）按钮仍然可以正常点，不会出现「点不动了」。 */
.plt-split-mask{position:absolute;inset:0;z-index:18;background:rgba(6,14,26,.42);pointer-events:none;animation:plt-split-fade .16s ease both}
/* 卡片层级永远高于遮罩（它是遮罩的子节点，天然在上）。
   id=171：从「贴右边缘探出来」改成面板正中 —— left:50% + translate(-50%,-50%)，
   圆角/边框/阴影都恢复四边对称（贴边时代的 border-right:none、单侧投影都是为贴合用的）。 */
.plt-split-card{
  position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
  display:flex;align-items:center;gap:12px;
  /* id=213：原来是纯内容撑开（实测恒为 164×64.3，跟面板宽高一点关系都没有），
     看着像个小气泡，用户反馈「有点小」。这里按面板宽度给个显式宽度（76% → 封顶 240px），
     纵向 padding 一并加厚，让卡片整体放大 ~1.45 倍而**宽高比基本不变**（原 2.55:1）。
     id=214：补上下限。四条全挂在面板尺寸上（cqw/cqh 以 .plt-root 为容器，见 10-topbar.js:13），
     不写死像素：
       · min-width 是硬下限（150px），保证极窄侧栏下不塌成一条；
         但它自身再被 92cqw 夹一次，所以「抬高下限」永远不会导致横向溢出。
       · max-width 是兜底封顶，比 width 宽一档，正常永远不生效 —— 只有将来 width 被改小/内容
         撑破时才会接管，避免横向跑出面板。
       · min-height / max-height 夹住纵向：矮面板下不让卡片高过面板（否则内容被面板裁掉），
         此时卡片内部自己滚动（overflow:auto），比静默裁切可读。
     width/max-width 这里刻意用 cqw 而不是百分比 —— 百分比算的是包含块（遮罩），
     与 min() 混用推不直观；cqw 就是面板宽度的 1%，一眼可算。 */
  width:min(76cqw,240px);
  min-width:min(150px,92cqw);
  max-width:min(92cqw,300px);
  min-height:min(64px,28cqh);
  max-height:min(78cqh,240px);
  overflow:auto;
  box-sizing:border-box;
  /* id=215：内边距从 22/20 改成 20/22 —— 横向略大于纵向是卡片的常规比例，
     原来的「纵向比横向还厚」让两行字看着被上下夹扁。 */
  padding:20px 22px;
  /* 圆角对齐输入区那张「悬浮卡片」（.plt-composer 的 14px），不再自成一套 12px。 */
  border-radius:14px;
  border:1px solid rgba(124,162,232,.22);
  /* 底色跟着输入区那套走：上亮下暗的极淡渐变（模拟顶部受光），不再是一块纯色。 */
  background:linear-gradient(180deg,rgba(28,36,50,.97),rgba(20,27,38,.97));
  /* 阴影分三层，和输入区卡片同一套「贴地影 + 中距扩散 + 远距弥散」再加一道顶部内高光：
     单层大投影会让卡片看着像贴在纸上，分层才有厚度。 */
  box-shadow:0 2px 4px rgba(3,9,22,.34),0 12px 26px -10px rgba(4,12,30,.6),0 32px 60px -26px rgba(8,20,48,.66),inset 0 1px 0 rgba(158,190,246,.14);
  color:#f2f4f7;font-size:15px;line-height:1.6;
  pointer-events:auto;
  animation:plt-split-in .22s cubic-bezier(.22,.9,.28,1) both;
}
/* 转圈给一点蓝：它原来跟正文同色（近白），在放大后的卡片里显得发灰、不像「正在进行」。
   取值与插件主色同一支（深色下偏亮的蓝，浅色下用深一档的蓝）。 */
.plt-split-card svg{color:#8ab0f5;flex:0 0 auto}
.plt-split-card .plt-split-text{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1 1 auto}
.plt-split-card .plt-split-text strong{font-weight:600;letter-spacing:.1px}
.plt-split-card .plt-split-hint{color:rgba(232,238,247,.68);font-size:13px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@keyframes plt-split-fade{from{opacity:0}to{opacity:1}}
/* 进场关键帧必须与基础样式的 transform 用同一套居中值：
   animation 的 fill-mode 是 both，动画跑完后保留的是**关键帧里的 to**，不是基础样式 ——
   若 to 还写着旧的 translate(0,-50%)，卡片会永久偏右半个身位（实测 dx=+56px）。
   方向也换了：贴边时代是从左往右滑进面板；居中后改成从中心上方 14px 落位，不再横向漂移。 */
@keyframes plt-split-in{from{opacity:0;transform:translate(-50%,calc(-50% - 14px))}to{opacity:1;transform:translate(-50%,-50%)}}
@media (prefers-reduced-motion: reduce){
  .plt-split-mask{animation:none}
  .plt-split-card{animation:none}
}
/* 顶部行内提示：提交 / 审核 / 拖拽保存的结果，显示在自动刷新按钮左侧。 */
.plt-notice{flex:0 1 auto;min-width:0;max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:18px;padding:0 7px;border-radius:999px;background:rgba(76,175,80,.13);border:1px solid rgba(76,175,80,.32);color:#6fc47a}
/* 输入区做成「悬浮卡片」：整块从列表里抬起来。
   立体感由四层叠出来 ——
   1) 渐变底：上亮下暗，模拟顶部受光；
   2) 内斜面：顶部 1px 白高光 + 底部 1px 暗边，形成厚度；
   3) 两层外投影：近距离贴地影 + 远距离扩散影；
   4) 卡片下方一道模糊的接触阴影（.plt-form-wrap::after），让它「离地」。 */
/* 输入区现在贴在面板底部（列表在上、输入在下）：上留白给列表一点呼吸，
   下留白让卡片离底边有距离，接触阴影落在卡片正下方。 */
/* 输入区保持在本层：拆解遮罩是 pointer-events:none，不会拦点击，
   而遮罩里的提示卡片（z-index 18）仍然盖在输入区之上，读起来是「浮在最上层」的那一层。 */
.plt-form-wrap{position:relative;z-index:2;flex:0 0 auto;padding:8px 12px 11px 12px}
/* 卡片正下方的接触阴影：横向收窄的椭圆模糊，投影越实、悬浮感越强。带一点蓝，和卡片同色系。 */
.plt-form-wrap::after{content:'';position:absolute;left:26px;right:26px;bottom:2px;height:14px;border-radius:50%;background:rgba(6,14,32,.52);filter:blur(10px);z-index:0;pointer-events:none}
/* 偏蓝的深色 + 蓝色渐变：底色走带蓝相的海军墨蓝，
   上面叠一层从左上到右下的蓝色渐变（蓝 → 微紫 → 深蓝收尾），
   再加第二层顶部高光，整体「沉一点的蓝」而不是发灰的黑。 */
.plt-composer{position:relative;z-index:1;display:flex;flex-direction:column;gap:7px;background:
  radial-gradient(120% 140% at 8% 0%,rgba(96,152,255,.22),rgba(96,152,255,0) 58%),
  linear-gradient(135deg,rgba(64,116,224,.20) 0%,rgba(92,120,232,.10) 46%,rgba(10,26,58,.30) 100%),
  linear-gradient(180deg,rgba(92,142,232,.10),rgba(92,142,232,0) 46%,rgba(2,8,20,.34)),
  var(--plt-composer-bg,#0d1830);border:1px solid rgba(96,146,236,.24);border-radius:14px;padding:10px 10px 9px;box-shadow:0 2px 3px rgba(3,9,22,.26),0 10px 22px -8px rgba(4,12,30,.62),0 26px 50px -22px rgba(8,20,48,.66),0 0 0 1px rgba(96,146,236,.05),inset 0 1px 0 rgba(140,180,255,.14),inset 0 -1px 0 rgba(2,8,20,.55),inset 0 0 0 1px rgba(120,166,246,.02);transition:border-color .16s ease,box-shadow .18s ease,transform .18s ease}
.plt-composer:hover{transform:translateY(-1px);border-color:rgba(112,164,250,.38);box-shadow:0 2px 3px rgba(3,9,22,.28),0 14px 28px -8px rgba(6,16,38,.64),0 34px 58px -24px rgba(10,26,60,.68),0 0 22px -6px rgba(76,132,224,.22),inset 0 1px 0 rgba(150,190,255,.18),inset 0 -1px 0 rgba(2,8,20,.56)}
.plt-composer:focus-within{transform:translateY(-2px);border-color:var(--dsw-alias-border-accent,rgba(96,152,255,.72));box-shadow:0 0 0 3px rgba(80,140,255,.16),0 2px 3px rgba(3,9,22,.2),0 18px 34px -8px rgba(6,18,44,.56),0 40px 70px -26px rgba(10,28,66,.64),0 0 30px -6px rgba(86,144,238,.3),inset 0 1px 0 rgba(168,202,255,.26),inset 0 -1px 0 rgba(2,8,20,.46)}
/* 聚焦时卡片顶部落一道淡蓝渐隐，强化「被拿起来」的感觉。 */
.plt-composer::before{content:'';position:absolute;inset:0;z-index:0;border-radius:inherit;pointer-events:none;opacity:0;transition:opacity .2s ease;background:linear-gradient(180deg,rgba(96,152,255,.20),transparent 52%)}
.plt-composer:focus-within::before{opacity:1}
/* 文字层与操作层压在渐隐之上，避免那层极淡的蓝把正文染灰。 */
.plt-composer .plt-input,.plt-composer .plt-bar{position:relative;z-index:1}
@media (prefers-reduced-motion: reduce){.plt-composer{transition:border-color .16s ease,box-shadow .18s ease}.plt-composer:hover,.plt-composer:focus-within{transform:none}}`)

    /**
     * 输入区骨架：悬浮卡片、聚焦光、列表容器与轮播/滚动条外壳。
     *
     * 本片段是 CSS_PARTS 的一段，位置即层叠顺序（由 build.mjs 按文件名字典序拼接）。
     */
    CSS_PARTS.push(`/* 外层列表自己绝不出滚动条：高度固定，只有展开的组内部滚动。 */
/* 列表容器：左右/下多留一点内边距，给三个组的外阴影留出扩散空间（否则会被 overflow 裁掉）。 */
.plt-list{flex:1 1 auto;min-height:0;overflow:hidden;display:flex;flex-direction:column;gap:9px;padding:8px 18px 16px 18px}`)

    /**
     * 条目骨架：卡片边框、悬浮、拖拽落点、展开/折叠头部与抓手。
     *
     * 本片段是 CSS_PARTS 的一段，位置即层叠顺序（由 build.mjs 按文件名字典序拼接）。
     */
    CSS_PARTS.push(`.plt-item{border:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,.09));border-radius:8px;margin-bottom:7px;overflow:hidden;background:var(--dsw-alias-bg-secondary,rgba(255,255,255,.02));transition:opacity .12s ease,border-color .12s ease}
.plt-item.open{border-color:var(--dsw-alias-border-accent,rgba(80,140,255,.6))}
/* 正在执行：淡一点的粉红内阴影，表示「模型正在这一条上干活」，不抢眼。 */
.plt-item.running{border-color:rgba(236,72,153,.3);position:relative;overflow:hidden}
.plt-item.running::after{content:'';position:absolute;inset:0;pointer-events:none;border-radius:inherit;box-shadow:inset 0 0 20px -8px rgba(236,72,153,.32)}
.plt-item.running .plt-name{position:relative}
/* 执行中不再加圆点，只靠边框/内阴影与「正在执行」标签区分。 */
.plt-item.dragging{opacity:.42;border-style:dashed}
.plt-item.drop-target{border-color:var(--dsw-alias-border-accent,rgba(80,140,255,.85));box-shadow:inset 0 2px 0 -1px rgba(80,140,255,.9)}
/* 转组「升华」动画：草稿 → 待执行 → 待审核 → 已审核 换栏的那一次，
   在新一栏里从下方轻轻浮起（带一点虚化收焦），同时一层同色微光向上蒸腾消散。
   只在真正换组时播一遍（约 1.1s），平时不打扰。 */
.plt-item.plt-sublime{position:relative;animation:plt-sublime-in .86s cubic-bezier(.16,.86,.24,1) both}
.plt-item.plt-sublime::before{content:'';position:absolute;inset:-1px;pointer-events:none;border-radius:inherit;background:linear-gradient(0deg,rgba(var(--plt-accent,120,168,255),.22),rgba(var(--plt-accent,120,168,255),.07) 52%,transparent 82%);opacity:0;animation:plt-vapor 1.2s ease-out .04s both}
/* 缓入缓出、位移和虚化都收小：观感像被"托"上来，而不是被拍上去。 */
@keyframes plt-sublime-in{0%{opacity:.001;transform:translateY(9px) scale(.996);filter:blur(1.5px)}40%{opacity:.58;filter:blur(.7px)}74%{opacity:.93;filter:blur(.2px)}100%{opacity:1;transform:none;filter:none}}
@keyframes plt-vapor{0%{opacity:.40;transform:translateY(24%)}46%{opacity:.24}100%{opacity:0;transform:translateY(-30%)}}
/* 落到「折叠着」的组里时条目本身看不见：让那一组的组头轻轻亮一下，
   这样审核通过（待审核 → 已审核）也有反馈，不会被当成"没反应"。 */
.plt-group-h.plt-arrive{animation:plt-arrive .92s cubic-bezier(.16,.86,.24,1) both}
.plt-group-h.plt-arrive .plt-caret{animation:plt-arrive-caret .92s cubic-bezier(.16,.86,.24,1) both}
.plt-group-h.plt-arrive .plt-group-count{animation:plt-arrive-count .92s ease-out both}
@keyframes plt-arrive{0%{box-shadow:inset 0 0 0 1px rgba(var(--plt-accent,120,168,255),0);background-color:rgba(var(--plt-accent,120,168,255),0)}26%{box-shadow:inset 0 0 0 1px rgba(var(--plt-accent,120,168,255),.52),0 0 16px -6px rgba(var(--plt-accent,120,168,255),.42);background-color:rgba(var(--plt-accent,120,168,255),.15)}100%{box-shadow:inset 0 0 0 1px rgba(var(--plt-accent,120,168,255),0);background-color:rgba(var(--plt-accent,120,168,255),0)}}
@keyframes plt-arrive-caret{0%,100%{transform:none}34%{transform:translateY(-2px)}68%{transform:translateY(1px)}}
@keyframes plt-arrive-count{0%,100%{transform:none}30%{transform:scale(1.14)}}
@media (prefers-reduced-motion: reduce){.plt-item.plt-sublime{animation:none}.plt-item.plt-sublime::before{animation:none;opacity:0}.plt-group-h.plt-arrive,.plt-group-h.plt-arrive .plt-caret,.plt-group-h.plt-arrive .plt-group-count{animation:none}}
.plt-head{position:relative;display:flex;align-items:center;gap:8px;padding:11px 10px;cursor:pointer;user-select:none;transition:background .14s ease,box-shadow .16s ease}
/* hover：整行明显提亮 —— 左侧浓、右侧淡的横向渐变 + 左缘 3px 强调竖条 +
   一圈同色内描边并轻微右移，鼠标划到哪一行一眼就能看出来。 */
.plt-head:hover{background:linear-gradient(90deg,rgba(var(--plt-accent,120,168,255),.30),rgba(var(--plt-accent,120,168,255),.14) 45%,rgba(var(--plt-accent,120,168,255),.04) 92%);box-shadow:inset 0 0 0 1px rgba(var(--plt-accent,120,168,255),.28),inset 0 1px 0 rgba(var(--plt-accent,120,168,255),.16)}
.plt-head:hover::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:0 3px 3px 0;background:rgba(var(--plt-accent,120,168,255),1);box-shadow:0 0 10px 0 rgba(var(--plt-accent,120,168,255),.55)}
.plt-head:hover .plt-name{color:var(--dsw-alias-label-primary,#f0f2f5);font-weight:600}
.plt-head:hover .plt-caret{color:rgba(var(--plt-accent,120,168,255),1);transform:translateX(2px)}
.plt-head:hover .plt-id{opacity:1;color:rgba(var(--plt-accent,120,168,255),1);font-weight:600}
.plt-head:hover .plt-grip{color:rgba(var(--plt-accent,120,168,255),1)}
.plt-head:hover .plt-tag{border-color:rgba(var(--plt-accent,120,168,255),.5)}
@media (prefers-reduced-motion: reduce){.plt-head,.plt-head:hover .plt-caret{transition:none;transform:none}}
.plt-grip{flex:0 0 auto;width:12px;cursor:grab;color:var(--dsw-alias-label-caption,#777);line-height:1;letter-spacing:-1px;font-size:14px}
.plt-grip:active{cursor:grabbing}
.plt-grip-off{cursor:default;opacity:0;pointer-events:none}
.plt-caret{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:12px;color:var(--dsw-alias-label-caption,#8a8a8a);transition:transform .12s ease,color .14s ease}
.plt-item.open .plt-caret{transform:rotate(90deg)}
.plt-group{margin-bottom:0;display:flex;flex-direction:column;min-height:0;flex:0 0 auto;overflow:hidden;border:1px solid transparent;border-radius:10px;transition:border-color .12s ease,background .12s ease,box-shadow .16s ease}
/* 每个组（含折叠态）都带一层柔和外阴影，让三栏像三张卡片浮在面板上。 */
.plt-group-reviewed,.plt-group-unreviewed,.plt-group-todo{box-shadow:0 1px 2px rgba(0,0,0,.1),0 6px 16px -10px rgba(0,0,0,.4),0 0 0 0 rgba(var(--plt-accent),0)}
.plt-group-reviewed:hover,.plt-group-unreviewed:hover,.plt-group-todo:hover{box-shadow:0 1px 3px rgba(0,0,0,.12),0 10px 22px -12px rgba(0,0,0,.46),0 0 18px -10px rgba(var(--plt-accent),.55)}
/* 手风琴互斥：只有一个组展开，它吃掉剩余全部高度；折叠的组只留 34px 组头。
   三个组头永远同高同字号，切组时二级菜单可用高度一致，页面不跳。 */
.plt-group.open{flex:1 1 auto;min-height:0;border-color:rgba(var(--plt-accent),.3);background:rgba(var(--plt-accent),.035);box-shadow:0 2px 4px rgba(0,0,0,.16),0 16px 34px -14px rgba(0,0,0,.55),0 0 0 1px rgba(var(--plt-accent),.10),0 0 30px -12px rgba(var(--plt-accent),.7)}
/* 组头高度固定：三个组永远一样高，展开/折叠时不会被内容压扁。文字大一号，高度跟着加到 38px。 */
.plt-group-h{flex:0 0 auto;display:flex;align-items:center;gap:8px;height:38px;min-height:38px;padding:0 10px;box-sizing:border-box;cursor:pointer;user-select:none;border-radius:8px;background:var(--dsw-alias-bg-secondary,rgba(255,255,255,.03));border:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,.07));position:sticky;top:0;z-index:3;backdrop-filter:blur(6px)}
.plt-group-h:hover{background:var(--dsw-alias-bg-hover,rgba(255,255,255,.06))}
.plt-group-h.open .plt-caret{transform:rotate(90deg)}
.plt-group-name{flex:1 1 auto;font-size:14.5px;font-weight:600;color:var(--dsw-alias-label-secondary,#c8c8c8);letter-spacing:.02em}
/* id=337：条数统计固定在组头最右端（DOM 里也确实排在所有控件之后）。
   margin-left:auto 是双保险：即使将来有人在它后面又插了节点，读数仍然贴着右侧收口。
   等宽数字（tabular-nums）+ 三位补零：001 / 012 / 123 宽度一致，
   组与组之间同一列对齐，展开收起时右边界不会跟着数字位数抖。 */
.plt-group-count{flex:0 0 auto;margin-left:auto;min-width:46px;box-sizing:border-box;text-align:center;font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;font-size:12.5px;line-height:18px;padding:0 7px;border-radius:999px;background:var(--dsw-alias-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-caption,#9a9a9a)}
/* 「已审核」上限下拉（id=188/190）：只出现在已审核组头右侧。
   appearance:none + data-uri 箭头 —— 原生 select 的箭头在暗色面板里是一个亮块，
   颜色由系统画、CSS 管不着，只能自绘。
   底色取组自身的 --plt-accent（已审核组是灰蓝），和组头、计数胶囊同一色系，
   不引入新颜色变量。字号刻意比 .plt-group-count 小 0.5px：胶囊是「读数」、
   下拉是「控件」，控件略小一级，两者并排时不会互相抢；
   高度用 26px 而非字号推导，保证与组头 38px 的上下留白对称。 */
.plt-limit{flex:0 0 auto;max-width:104px;height:26px;box-sizing:border-box;appearance:none;-webkit-appearance:none;-moz-appearance:none;margin:0;padding:0 22px 0 8px;border-radius:8px;border:1px solid rgba(var(--plt-accent),.28);background:rgba(var(--plt-accent),.1) url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5L6 8l3.5-3.5' fill='none' stroke='%239a9a9a' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 6px center/10px 10px;color:var(--dsw-alias-label-secondary,#c8c8c8);font:inherit;font-size:12px;line-height:1;font-weight:500;letter-spacing:.02em;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.plt-limit:hover:not(:disabled){border-color:rgba(var(--plt-accent),.46);background-color:rgba(var(--plt-accent),.17)}
.plt-limit:focus-visible{outline:2px solid rgba(var(--plt-accent),.5);outline-offset:1px}
.plt-limit:disabled{opacity:.5;cursor:default}
/* 弹出列表由系统绘制，明暗各给一档底色，避免暗面板里浮出一张白单子。 */
.plt-limit option{background:#1c1f24;color:#e8e8e8}
/* 侧栏窄到 320px 以下时先让下拉瘦身，标题再收缩，两侧都不换行、不溢出。
   必须用 @container 不是 @media：@media 量的是视口，侧栏可以拖到 300px 而窗口仍是 1900px，
   那条规则永远不会触发。.plt-root 有 container-type:size（id=152），
   这里和 17-input.js 的档位胶囊一样按容器宽度走。 */
@container (max-width:320px){.plt-limit{max-width:84px;padding-right:20px}.plt-group-h{gap:6px}}
/* 组内自成滚动区：组头留在外面所以始终可见，条目在这一块里内滚动。
   左右各留 9px，条目不再顶着组的边框。 */
.plt-group-body{display:flex;flex-direction:column;gap:6px;padding:8px 9px 9px;overflow:auto;flex:1 1 auto;min-height:0;scrollbar-width:thin;scrollbar-color:rgba(var(--plt-accent),.45) transparent}
.plt-group-body::-webkit-scrollbar{width:7px}
.plt-group-body::-webkit-scrollbar-thumb{background:rgba(var(--plt-accent),.42);border-radius:4px;border:1px solid transparent;background-clip:padding-box}
.plt-group-body::-webkit-scrollbar-thumb:hover{background:rgba(var(--plt-accent),.62);background-clip:padding-box}
.plt-group-body::-webkit-scrollbar-track{background:rgba(var(--plt-accent),.06);border-radius:4px}
/* 组内是「二级」内容，整体比组头小一档，统一 13px。 */
/* 关键：flex 列容器 + max-height 会让子项被压扁成一条横条，必须禁止收缩。 */
.plt-group-body > *{flex:0 0 auto}
.plt-group-body .plt-item{flex:0 0 auto}
.plt-group-body .plt-name{font-size:13px}
.plt-group-body .plt-tag{font-size:13px;line-height:18px;padding:0 6px}
/* 组内条目：横向内边距收窄一点，把省下的宽度全给标题。 */
.plt-group-body .plt-head{padding:9px 8px;gap:6px}
.plt-group-body .plt-caret,.plt-group-body .plt-grip{font-size:13px}
.plt-group-body .plt-body{padding:2px 10px 10px 24px}
.plt-group-body .plt-sec-h{font-size:13px}
.plt-group-body .plt-plan,.plt-group-body .plt-note{font-size:13px;line-height:1.6}
.plt-group-body .plt-meta{font-size:13px;gap:5px 12px}
.plt-group-body .plt-check{font-size:13px;gap:5px}
.plt-group-body .plt-check input{width:14px;height:14px}
.plt-group-body .plt-check.locked span::after{font-size:13px}
.plt-group-body .plt-btn{font-size:13px;padding:2px 8px}
.plt-group-body .plt-body code{font-size:13px}
`)

    /**
     * 分组与配色：四组强调色 --plt-accent、组头、组内滚动区与二级内容。
     *
     * 本片段是 CSS_PARTS 的一段，位置即层叠顺序（由 build.mjs 按文件名字典序拼接）。
     */
    CSS_PARTS.push(`/* —— 分组配色：每组一个强调色，组头与条目共用同一套 --plt-accent —— */
/* 四组配色：已审核=灰，待审核=黄，待执行=粉红，草稿=绿。 */
.plt-group{--plt-accent:140,140,140}
.plt-group-reviewed{--plt-accent:156,163,175}
.plt-group-unreviewed{--plt-accent:255,180,60}
/* 待执行整组走粉红主题：组头、计数、条目、二级内容全部跟着 --plt-accent 走。 */
.plt-group-todo{--plt-accent:236,72,153}
/* 草稿组走绿色：和「执行中/待审核」的粉黄区分开，看起来像「存着还没用」。 */
.plt-group-draft{--plt-accent:52,190,110}
.plt-group-draft .plt-tag.draft{background:rgba(52,190,110,.12);color:#8fe6b6;border-color:rgba(52,190,110,.32)}
.plt-group-draft .plt-tag.type{color:rgba(52,190,110,.7);border-color:rgba(52,190,110,.26)}
/* 待执行组不再单独压缩：三组样式完全统一，切组时二级菜单高度一致。 */
.plt-group-todo .plt-group-body{gap:6px;padding:8px 9px 9px}
.plt-group-h{background:rgba(var(--plt-accent),.055);border-color:rgba(var(--plt-accent),.2)}
.plt-group-h:hover{background:rgba(var(--plt-accent),.11)}
.plt-group-h .plt-caret{color:rgba(var(--plt-accent),.95)}
.plt-group-name{color:rgba(var(--plt-accent),.98)}
.plt-group-count{background:rgba(var(--plt-accent),.16);color:rgba(var(--plt-accent),1);border:1px solid rgba(var(--plt-accent),.28)}
/* 条目：绿色/黄色内阴影区分状态。 */
.plt-group-body .plt-item{background:rgba(var(--plt-accent),.04);border-color:rgba(var(--plt-accent),.18);box-shadow:inset 0 0 0 1px rgba(var(--plt-accent),.05),inset 0 0 20px -10px rgba(var(--plt-accent),.55)}
.plt-group-body .plt-item:hover{border-color:rgba(var(--plt-accent),.32)}
.plt-group-body .plt-item.open{border-color:rgba(var(--plt-accent),.5);box-shadow:inset 0 0 0 1px rgba(var(--plt-accent),.12),inset 0 0 26px -8px rgba(var(--plt-accent),.6)}
/* 正在执行的条目优先级最高，保留粉红内阴影，不被分组配色盖掉（淡一点）。 */
.plt-group-body .plt-item.running{border-color:rgba(236,72,153,.34);box-shadow:inset 0 0 20px -8px rgba(236,72,153,.34)}
.plt-group-body .plt-item.running .plt-name{color:var(--dsw-alias-label-primary,#e6e6e6)}

/* 待执行组里的状态标签也走粉红，不再用中性灰。 */
.plt-group-todo .plt-tag.todo{background:rgba(236,72,153,.1);color:#f0a6c6;border-color:rgba(236,72,153,.26)}
.plt-group-todo .plt-tag.type{color:rgba(236,72,153,.7);border-color:rgba(236,72,153,.26)}
/* 组内正在执行 == 这一组的重点：比常态略深一点就够，别糊成一片粉。 */
.plt-group-todo .plt-item.running{border-color:rgba(236,72,153,.42);background:rgba(236,72,153,.045);box-shadow:inset 0 0 0 1px rgba(236,72,153,.14),inset 0 0 22px -8px rgba(236,72,153,.45)}
.plt-group-todo .plt-item.running .plt-name{color:#f6d3e2;font-weight:600}
.plt-group-todo .plt-item.running .plt-tag.running{background:rgba(236,72,153,.16);color:#fbd6e8;border-color:rgba(236,72,153,.42)}
.plt-group-todo .plt-item.running .plt-tag.todo{background:rgba(236,72,153,.12);color:#f6d3e2;border-color:rgba(236,72,153,.32)}
/* 执行中更粉的那条加一层缓慢的流光：一道柔光从左扫到右，3.2s 一轮，不刺眼。 */
.plt-group-todo .plt-item.running::after{content:'';position:absolute;inset:0;pointer-events:none;border-radius:inherit;box-shadow:inset 0 0 22px -8px rgba(236,72,153,.4),inset 0 0 0 1px rgba(236,72,153,.12);background:linear-gradient(100deg,transparent 20%,rgba(255,214,232,.07) 45%,rgba(255,255,255,.12) 50%,rgba(255,214,232,.07) 55%,transparent 80%);background-size:220% 100%;background-repeat:no-repeat;animation:plt-sheen 3.2s ease-in-out infinite}
@keyframes plt-sheen{0%{background-position:180% 0}100%{background-position:-80% 0}}
@media (prefers-reduced-motion: reduce){.plt-group-todo .plt-item.running::after{animation:none;background:none;box-shadow:inset 0 0 22px -8px rgba(236,72,153,.4)}}
/* id=239：组收起、但组里还有条目在跑 —— 卡片整个不在 DOM 里（收起时只渲染组头），
   上面那条卡片流光自然也跟着消失。这里让容器自己的边框走一道光，收起也能看见「还在干」。
   挂在 .plt-group 而不是 .plt-group-h：组头有 backdrop-filter 与 z-index:3 自成层叠上下文，
   光往外扩会被裁掉，而且会跟 hover 的 ::before 左竖条抢伪元素。
   边框流光用 padding + mask 挖空中间，只留 1px 环，避免在容器里铺一层色块压住内容。 */
.plt-group.is-running:not(.open){position:relative;border-color:rgba(var(--plt-accent),.55);box-shadow:0 1px 2px rgba(0,0,0,.1),0 6px 16px -10px rgba(0,0,0,.4),0 0 18px -6px rgba(var(--plt-accent),.5)}
.plt-group.is-running:not(.open)::after{content:'';position:absolute;inset:0;pointer-events:none;border-radius:inherit;padding:1px;background:linear-gradient(100deg,transparent 18%,rgba(var(--plt-accent),.18) 34%,rgba(var(--plt-accent),.95) 48%,rgba(255,255,255,.9) 52%,rgba(var(--plt-accent),.95) 56%,rgba(var(--plt-accent),.18) 70%,transparent 86%);background-size:240% 100%;background-repeat:no-repeat;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;animation:plt-group-sheen 3.2s linear infinite}
@keyframes plt-group-sheen{0%{background-position:200% 0}100%{background-position:-60% 0}}
/* 减弱动画时不留一条乱跑的亮边：换成稳态描边，仍在告诉用户「这组在干活」。 */
@media (prefers-reduced-motion: reduce){.plt-group.is-running:not(.open)::after{animation:none;background:linear-gradient(180deg,rgba(var(--plt-accent),.85),rgba(var(--plt-accent),.3));background-size:100% 100%}}
.plt-group-todo .plt-group-count{background:rgba(236,72,153,.14);color:#f0a6c6;border-color:rgba(236,72,153,.3)}
/* id=240：组收起时的「正在执行」提示。跟计数胶囊并排，但形状是纯文字 + 转圈，
   比胶囊更轻 —— 它说的是「还在动」，不是「有几条」。
   字号比 .plt-group-count 小 0.5px（与 .plt-limit 同款递减），三个控件并排时不抢。
   flex:0 0 auto + nowrap：组头高度固定 38px，提示绝不能被压成两行。
   max-width 与 ellipsis 是兜底：320px 侧栏下如果真放不下，宁可截断也不要挤掉组名。 */
.plt-group-run{flex:0 0 auto;display:inline-flex;align-items:center;gap:4px;max-width:92px;overflow:hidden;font-size:12px;line-height:18px;font-weight:500;letter-spacing:.01em;white-space:nowrap;text-overflow:ellipsis;color:rgba(var(--plt-accent),.95)}
/* 深数组的 accent 里有粉红(236,72,153)与琥珀(255,180,60)，直接当 12px 小字用只有 3.1~4.4:1，
   在深底上偏暗。往白里调 45% 保住色相、把亮度提上来；浅色那条覆盖会把它整条压回深色值。 */
@supports (color: color-mix(in srgb, red 50%, white)){
  .plt-group-run{color:color-mix(in srgb,rgb(var(--plt-accent)) 55%,#ffffff)}
}
.plt-group-run svg{flex:0 0 auto}
.plt-group-run-txt{overflow:hidden;text-overflow:ellipsis}
/* 组头本来就窄：320px 以下把「正在执行」缩成只有转圈，靠 title/aria-label 说明。
   必须用 @container —— @media 量的是视口，侧栏拖窄时窗口还是宽的。 */
@container (max-width:360px){.plt-group-run{max-width:20px;gap:0}.plt-group-run-txt{display:none}}

/* —— 二级内容统一：同一套内边距、分隔线、标题与代码块基调 —— */
.plt-group-body .plt-body{padding:6px 12px 13px 22px;margin-top:4px;border-top:1px solid rgba(var(--plt-accent),.14)}
.plt-group-body .plt-sec{margin-top:13px}
.plt-group-body .plt-sec-h{font-size:13px;letter-spacing:.05em;color:rgba(var(--plt-accent),.9);font-weight:600;margin-bottom:7px;text-transform:none}
/* 「计划」标题右侧的复制按钮组：平时低调，hover 才亮起来。 */
.plt-copy{margin-left:auto;display:inline-flex;align-items:center;gap:6px 8px;flex:0 1 auto;flex-wrap:wrap;justify-content:flex-end}
/* 「计划」标题右侧的小胶囊：字号 11→12、内边距 1px 6px→3px 9px、图标与文字间距 3→5px，
   三个按钮之间 5→8px。原来的尺寸贴着标题基线，点起来也太窄。 */
.plt-copy-btn{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;border:1px solid rgba(var(--plt-accent),.28);background:transparent;color:rgba(var(--plt-accent),.85);font-size:12px;line-height:16px;font-weight:500;letter-spacing:0;cursor:pointer;white-space:nowrap;transition:background .15s ease,border-color .15s ease,color .15s ease}
.plt-copy-btn:hover{background:rgba(var(--plt-accent),.14);border-color:rgba(var(--plt-accent),.55);color:#fff}
.plt-copy-btn:active{transform:translateY(.5px)}
.plt-copy-btn.done{background:rgba(76,175,80,.18);border-color:rgba(76,175,80,.55);color:#bfe6c1}
/* 禁用态：原来只有底部审批按钮的 disabled 规则管着，搬进标题行后必须补上，
 * 否则待审核条目在 busy（正在提交）时这个「通过」还看着能点。 */
.plt-copy-btn:disabled{opacity:.45;cursor:default}
.plt-copy-btn:disabled:hover{background:transparent;border-color:rgba(var(--plt-accent),.28);color:rgba(var(--plt-accent),.85)}
.plt-group-body .plt-plan{background:rgba(var(--plt-accent),.05);border:1px solid rgba(var(--plt-accent),.1);border-radius:6px;padding:10px 12px;max-height:260px}
.plt-group-body .plt-note{background:rgba(var(--plt-accent),.035);border-left:2px solid rgba(var(--plt-accent),.45);border-radius:0 6px 6px 0;padding:9px 11px;max-height:220px}
.plt-group-body .plt-meta{color:var(--dsw-alias-label-caption,#9a9a9a);gap:5px 12px;margin-top:12px}
.plt-group-body .plt-checks{gap:12px;margin-top:12px}
.plt-group-body .plt-del{color:#d46a6a;border-color:rgba(212,106,106,.35)}
.plt-group-body .plt-plan::-webkit-scrollbar,.plt-group-body .plt-note::-webkit-scrollbar{width:6px}
.plt-group-body .plt-plan::-webkit-scrollbar-thumb,.plt-group-body .plt-note::-webkit-scrollbar-thumb{background:rgba(var(--plt-accent),.3);border-radius:3px}`)

    /**
     * 条目详情区：编号与标题、状态/类型标签、正文与备注、元信息与勾选。
     *
     * 本片段是 CSS_PARTS 的一段，位置即层叠顺序（由 build.mjs 按文件名字典序拼接）。
     */
    CSS_PARTS.push(`/* 标题永远单行：长标题用省略号收尾，绝不换行 —— 一旦换行，条目会被撑成两三层高，
   右侧的状态胶囊还会被挤到下一行去。右边留 5px，让省略号和状态胶囊之间透一口气。 */
.plt-id{flex:0 0 auto;font-size:12.5px;line-height:1.32;color:var(--dsw-alias-label-caption,#8a8a8a);font-variant-numeric:tabular-nums;opacity:.85}
/* id=179：待审核标题右侧的耗时。字号比标题小一档（14.5→11.5）、字重降到 400、
   颜色用 caption 灰，和 .plt-name 的 600 字重主色拉开；.plt-name 是 flex:1 1 auto，
   所以这个节点固定落在标签左侧成一列，多行的耗时会竖向对齐，比贴着标题文字
    ragged 排更好扫。margin-left 收掉 .plt-head 的 8px gap 一部分（标题自带
   padding-right:5px，不然后距有 13px，看着像两个不相干的东西）。 */
.plt-dur{flex:0 0 auto;margin-left:-4px;font-size:11.5px;line-height:1.4;font-weight:400;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-caption,#8a8a8a);opacity:.9}
.plt-name{flex:1 1 auto;min-width:0;overflow:hidden;font-size:14.5px;letter-spacing:.005em;line-height:1.3;white-space:nowrap;text-overflow:ellipsis;padding-right:5px}
.plt-tag{flex:0 0 auto;font-size:14px;padding:0 7px;border-radius:999px;line-height:20px;border:1px solid transparent;white-space:nowrap}
.plt-tag.running{display:inline-flex;align-items:center;gap:4px;background:rgba(236,72,153,.16);color:#f472b6;border-color:rgba(236,72,153,.38)}
/* id=233「已中断」：琥珀告警色，和青色的「执行中」明确分开 —— 两个状态都发生在
   「还没完成」的条目上，只靠深浅区分会看错。不带转圈图标：它没有在跑，不能再假装活着。 */
.plt-tag.interrupted{background:rgba(255,180,60,.16);color:#f0b455;border-color:rgba(255,180,60,.44)}
/* 执行失败：模型已跳过。留在待执行组里，颜色和「执行中」分开，避免看起来还在跑。 */
.plt-tag.failed{background:rgba(220,80,70,.16);color:#f0a8a2;border-color:rgba(220,80,70,.42)}
/* 执行中：转圈图标匀速旋转，作为「还在跑」的活信号（减少动态偏好下停转）。 */
/* 执行中徽标只放一个转圈（id=352-D）：外框固定 26×20，与文字徽标的行高对齐，
   所以这一条从文字变图标时整列右边界不会移动。颜色继承 .plt-tag.running 的 color，
   深浅主题各自由 30-light.js 的既有规则决定，这里不再写第二套颜色。 */
.plt-tag.plt-run-only{width:26px;height:20px;padding:0;justify-content:center;box-sizing:border-box}
/* 空文字节点会撑出 1px 的基线空隙，转圈本身不占文字宽度，压掉。 */
.plt-tag.plt-run-only > span{display:none}
.plt-spin{animation:plt-spin .9s linear infinite;transform-origin:50% 50%}
@keyframes plt-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.plt-spin{animation:none}}
.plt-tag.todo{background:rgba(140,140,140,.16);color:var(--dsw-alias-label-caption,#9a9a9a);border-color:rgba(140,140,140,.3)}
.plt-tag.type{background:transparent;color:var(--dsw-alias-label-caption,#9a9a9a);border-color:var(--dsw-alias-border-secondary,rgba(255,255,255,.14))}
/* 置顶按钮：平时淡到几乎看不见，鼠标移到这一行才亮起来，不抢标题的宽度。 */
/* id=320：槽位恒定占 20px（与按钮同宽），按钮在槽位里居中。
   为什么要有槽位：拆分批次行永远没有置顶按钮（见 50-item.js 的 pinTop 判定），
   没有槽位时它们的状态标签会比普通行右移 20px，纵向扫视时那一列是锯齿。
   槽位空着也不收窄 —— 收窄就回到锯齿。 */
.plt-pin-slot{flex:0 0 20px;display:inline-flex;align-items:center;justify-content:center;height:20px}
.plt-pin{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border-radius:6px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-caption,#8a8a8a);opacity:0;cursor:pointer;transition:opacity .14s ease,background .14s ease,border-color .14s ease,color .14s ease}
.plt-head:hover .plt-pin,.plt-pin:focus-visible{opacity:1}
.plt-pin:hover{background:rgba(var(--plt-accent,120,168,255),.18);border-color:rgba(var(--plt-accent,120,168,255),.5);color:rgba(var(--plt-accent,120,168,255),1)}
.plt-pin:active{transform:translateY(.5px)}
/* 类型只用图标：去掉左右多余留白，跟输入栏胶囊里的图标一致。 */
.plt-tag.type{display:inline-flex;align-items:center;justify-content:center;padding:0 5px;line-height:18px}
.plt-tag.type svg{display:block}
.plt-tag.reviewed{background:rgba(156,163,175,.16);color:#c3c9d4;border-color:rgba(156,163,175,.4)}
.plt-tag.unreviewed{background:rgba(255,180,60,.14);color:#e9ae4a;border-color:rgba(255,180,60,.34)}
.plt-tag.draft{background:rgba(52,190,110,.14);color:#7fdca4;border-color:rgba(52,190,110,.36)}
.plt-body{padding:2px 12px 12px 28px;border-top:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,.07))}
.plt-sec{margin-top:9px}
.plt-sec-h{font-size:14px;letter-spacing:.03em;color:var(--dsw-alias-label-caption,#8a8a8a);margin-bottom:4px;font-weight:600;display:flex;align-items:center;gap:8px}
/* 就地编辑草稿：编辑框、模式胶囊、保存状态与操作区。 */
.plt-edit-actions{display:inline-flex;align-items:center;gap:10px;margin-left:auto;margin-top:4px}
.plt-edit-box{display:flex;flex-direction:column;gap:10px}
/* 草稿编辑框：边框用本组的强调色（草稿组是绿），并给足内边距，和面板里的只读正文区分开。
   选择器写成 .plt-edit-box .plt-edit-input（两个类），否则会被后面同权重的 .plt-input 覆盖掉 padding/border。 */
.plt-edit-box .plt-edit-input{min-height:96px;font-size:14px;line-height:1.6;resize:vertical;padding:9px 11px;border-radius:8px;border:1px solid rgba(var(--plt-accent),.36);background:rgba(var(--plt-accent),.05);box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}
.plt-edit-box .plt-edit-input:hover{border-color:rgba(var(--plt-accent),.5)}
.plt-edit-box .plt-edit-input:focus,.plt-edit-box .plt-edit-input:focus-visible{outline:none;border-color:rgba(var(--plt-accent),.78);box-shadow:0 0 0 3px rgba(var(--plt-accent),.16),inset 0 1px 0 rgba(255,255,255,.05)}
.plt-edit-input::placeholder{color:var(--dsw-alias-label-tertiary,#6b7280)!important;opacity:1!important}
/* 保存 / 取消：比普通小按钮大一号，和输入框之间留出距离。 */
.plt-edit-actions .plt-btn{padding:6px 16px;font-size:14px;line-height:20px;border-radius:8px}
/* 编辑即保存：左侧只留一个状态文字，替掉原来的「保存」按钮。 */
.plt-save-state{margin-right:auto;display:inline-flex;align-items:center;gap:5px;font-size:12.5px;line-height:1;color:var(--dsw-alias-label-caption,#8b929b);transition:color .16s ease;user-select:none}
/* 「停手即自动保存」一栏的左侧：任务类型切换（修改 / 目标 / 仅回答），紧跟状态文字。 */
.plt-edit-types{display:inline-flex;align-items:center;gap:5px;margin-right:2px}
.plt-edit-types .plt-chip-sm{padding:5px 9px 5px 7px;font-size:12.5px;border-radius:999px}
.plt-edit-types .plt-chip-sm svg{opacity:.9}
.plt-save-state.pending{color:rgba(var(--plt-accent),.85)}
.plt-save-state.saving{color:rgba(var(--plt-accent),.95)}
.plt-save-state.saved{color:rgba(var(--plt-accent),.95)}
.plt-save-state.saved::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 8px -1px currentColor}
.plt-save-state.error{color:#e0603f}
.plt-plan{white-space:pre-wrap;word-break:break-word;line-height:1.6;font-size:14px;max-height:300px;overflow:auto;background:var(--dsw-alias-bg-tertiary,rgba(0,0,0,.18));border-radius:6px;padding:8px 10px}
.plt-note{white-space:pre-wrap;word-break:break-word;line-height:1.6;font-size:14px;max-height:240px;overflow:auto;border-left:2px solid var(--dsw-alias-border-accent,rgba(80,140,255,.5));padding-left:8px}
/* 原始提示词：比备注更「档案」一点，用中性虚线框而不是左侧强调条，视觉上让它是旁证而不是结论。 */
.plt-source{white-space:pre-wrap;word-break:break-word;line-height:1.6;font-size:13px;max-height:200px;overflow:auto;color:var(--dsw-alias-label-secondary,inherit);background:rgba(127,127,127,.05);border:1px dashed var(--dsw-alias-border-l3,rgba(127,127,127,.3));border-radius:6px;padding:8px 10px}
/* 折叠标题：整行都是点击区（原文默认收起，卡片不至于被一段需求撑长）。
   图标在右侧，展开时转 90°，跟分组头、条目头的箭头保持同一套语言。 */
.plt-sec-toggle{display:flex;align-items:center;gap:8px;width:100%;margin:0 0 4px;padding:2px 0;background:none;border:0;cursor:pointer;text-align:left;color:inherit;font:inherit}
.plt-sec-toggle:hover .plt-sec-h{color:var(--dsw-alias-label-primary,#e8e8e8)}
.plt-sec-toggle .plt-sec-h{margin-bottom:0;flex:1 1 auto;min-width:0}
.plt-sec-toggle .plt-sec-caret{margin-left:auto;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:12px;transition:transform .16s ease;color:var(--dsw-alias-label-caption,#8a8a8a)}
.plt-sec-toggle.open .plt-sec-caret{transform:rotate(90deg)}
.plt-sec-hint{font-weight:400;font-size:12px;letter-spacing:0;color:var(--dsw-alias-label-caption,#8a8a8a)}
.plt-meta{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:9px;color:var(--dsw-alias-label-caption,#9a9a9a);font-size:14px}
.plt-checks{display:flex;gap:16px;align-items:center;margin-top:10px;flex-wrap:wrap}
/* 条目底部右侧的动作组：转为待执行 / 转为草稿 / 删除 挨在一起，整体靠右。 */
.plt-checks .plt-actions{display:inline-flex;align-items:center;gap:8px;margin-left:auto}
.plt-check{display:flex;align-items:center;gap:6px;cursor:pointer;font-size:14px;color:var(--dsw-alias-label-secondary,#c8c8c8)}
.plt-check input{cursor:pointer;accent-color:var(--dsw-alias-bg-accent,#2f6fd0);width:15px;height:15px}
.plt-check.locked{cursor:default;opacity:.62}
.plt-check.locked input{cursor:not-allowed}
.plt-check.locked span::after{content:' · 模型回填';font-size:14px;opacity:.65}
/* 图标按钮（id=353）：36×26 的固定热区，与相邻按钮同高（.plt-btn 的 20px 行高 +
   3px 上下内边距 = 26px），所以加进 .plt-actions 不会把这一排顶到第二行。
   宽度写死而不是靠 padding 撑 —— 图标宽度一变，热区不该跟着抖。 */
.plt-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:36px;height:26px;padding:0;border-radius:6px;line-height:1}
/* 垃圾桶用删除色，与文字「删除」按钮同一套色：两个入口看起来是同一件事。 */
.plt-icon-btn.plt-trash{color:#d46a6a;border-color:rgba(212,106,106,.35)}
.plt-icon-btn.plt-trash:hover:not(:disabled){background:rgba(212,106,106,.14);border-color:rgba(212,106,106,.6)}
/* 触屏上热区再放大一点（26px 的高度在手指下偏小），不影响桌面布局。 */
@media (hover:none){.plt-icon-btn{width:40px;height:32px}}
.plt-del{margin-left:auto;color:#d46a6a;border-color:rgba(212,106,106,.35)}
/* 删除键已经收进 .plt-actions，靠右由容器负责，这里不能再 margin-left:auto，否则会把同组的「转为待执行」推开。 */
.plt-checks .plt-actions .plt-del{margin-left:0}`)

    /**
     * 批量操作条与空态、错误条、通用弹窗（mask / dialog / actions）。
     *
     * 本片段是 CSS_PARTS 的一段，位置即层叠顺序（由 build.mjs 按文件名字典序拼接）。
     */
    CSS_PARTS.push(`/* —— 「待审核」组底部固定的一排批量操作 —— */
/* 批量操作条：底色加深一档 + 顶部一条更实的强调线，让「全选 / 全部通过 / 全部删除」
   这一排从列表里明确分离出来。 */
.plt-bulk{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:7px 8px;border-top:1px solid rgba(var(--plt-accent),.45);background:linear-gradient(180deg,rgba(var(--plt-accent),.16),rgba(var(--plt-accent),.08));flex-wrap:nowrap;min-width:0}
.plt-bulk .plt-check{flex:0 0 auto;font-size:12.5px;gap:5px;color:var(--dsw-alias-label-primary,#e6e6e6);font-weight:500}
.plt-bulk .plt-check input{width:14px;height:14px}
.plt-bulk-count{flex:1 1 auto;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary,#c8c8c8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 「全部通过」：实心强调色，跟「开始干活」同一档分量。 */
.plt-bulk-pass{flex:0 0 auto;font-size:12.5px;font-weight:600;padding:4px 12px;border-radius:999px;border:1px solid rgba(var(--plt-accent),.7);color:#1b1200;background:linear-gradient(180deg,rgba(var(--plt-accent),.98),rgba(var(--plt-accent),.82));box-shadow:0 1px 2px rgba(0,0,0,.2),0 0 12px -5px rgba(var(--plt-accent),.8)}
.plt-bulk-pass:hover:not(:disabled){background:linear-gradient(180deg,rgba(var(--plt-accent),1),rgba(var(--plt-accent),.9));box-shadow:0 1px 3px rgba(0,0,0,.24),0 0 18px -4px rgba(var(--plt-accent),.9)}
.plt-bulk-pass:active:not(:disabled){transform:translateY(1px)}
.plt-bulk-pass:disabled{opacity:.4;cursor:default;box-shadow:none}
/* 「已审核」组底部的批量删除：危险色实心，与「全部通过」区分开。 */
.plt-bulk-danger{border-top-color:rgba(214,68,68,.5);background:linear-gradient(180deg,rgba(214,68,68,.18),rgba(214,68,68,.09))}
.plt-bulk-del{flex:0 0 auto;font-size:12.5px;font-weight:600;padding:4px 12px;border-radius:999px;border:1px solid rgba(214,68,68,.75);color:#fff;background:linear-gradient(180deg,rgba(214,68,68,.92),rgba(178,48,48,.82));box-shadow:0 1px 2px rgba(0,0,0,.2),0 0 12px -5px rgba(214,68,68,.8)}
.plt-bulk-del:hover:not(:disabled){background:linear-gradient(180deg,rgba(230,80,80,1),rgba(198,56,56,.9));box-shadow:0 1px 3px rgba(0,0,0,.24),0 0 18px -4px rgba(214,68,68,.9)}
.plt-bulk-del:active:not(:disabled){transform:translateY(1px)}
.plt-bulk-del:disabled{opacity:.4;cursor:default;box-shadow:none}
/* 「草稿」组底部的批量转待执行：跟着本组绿色强调，和「全部通过」同款实心胶囊。 */
.plt-bulk-promote{flex:0 0 auto;font-size:12.5px;font-weight:600;padding:4px 12px;border-radius:999px;border:1px solid rgba(var(--plt-accent),.7);color:#08160d;background:linear-gradient(180deg,rgba(var(--plt-accent),.98),rgba(var(--plt-accent),.82));box-shadow:0 1px 2px rgba(0,0,0,.2),0 0 12px -5px rgba(var(--plt-accent),.8)}
.plt-bulk-promote:hover:not(:disabled){background:linear-gradient(180deg,rgba(var(--plt-accent),1),rgba(var(--plt-accent),.9));box-shadow:0 1px 3px rgba(0,0,0,.24),0 0 18px -4px rgba(var(--plt-accent),.9)}
.plt-bulk-promote:active:not(:disabled){transform:translateY(1px)}
.plt-bulk-promote:disabled{opacity:.4;cursor:default;box-shadow:none}
/* 条目内的「转为待执行 / 转为草稿」：小一号的描边胶囊，别抢删除的视觉重量。 */
.plt-promote,.plt-demote{border-radius:999px;border-color:rgba(var(--plt-accent),.55);color:rgba(var(--plt-accent),1)}
.plt-promote:hover:not(:disabled),.plt-demote:hover:not(:disabled){background:rgba(var(--plt-accent),.14);border-color:rgba(var(--plt-accent),.8)}
/* 条目内的「审核通过」在 id=193 已搬进「计划」标题行、改用 .plt-copy-btn（与「提示词」同款），
 * 这套实心琥珀胶囊样式与 30-light.js 里的浅色覆盖一并删除 —— 留着就是 dead-css 门禁要抓的死规则。 */
/* 「开始干活」：待执行组底部的主动作按钮。用本组的粉调做强调，实心填充，比其他按钮更显眼。 */
.plt-bulk-start{border-top-color:rgba(var(--plt-accent),.32);background:rgba(var(--plt-accent),.07)}
.plt-bulk-go{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;gap:5px;font-size:12.5px;font-weight:600;line-height:18px;white-space:nowrap;padding:4px 14px;border-radius:999px;border:1px solid rgba(var(--plt-accent),.62);color:#fff;background:linear-gradient(180deg,rgba(var(--plt-accent),.92),rgba(var(--plt-accent),.72));box-shadow:0 1px 2px rgba(0,0,0,.18),0 0 12px -4px rgba(var(--plt-accent),.7)}
/* 图标 + 文案都要单行：窄面板下也不许折成两行。 */
.plt-bulk-go>svg,.plt-bulk-go>span{flex:0 0 auto;white-space:nowrap}
/* 「干活中」：不再是可以点的主动作，改成半透明的进行中状态，转圈图标负责表示活着。 */
.plt-bulk-go.is-working{cursor:default;color:rgba(255,255,255,.92);border-color:rgba(var(--plt-accent),.34);background:rgba(var(--plt-accent),.16);box-shadow:none;opacity:1}
.plt-bulk-go.is-working:disabled{opacity:1}
.plt-bulk-go:hover:not(:disabled){background:linear-gradient(180deg,rgba(var(--plt-accent),1),rgba(var(--plt-accent),.82));box-shadow:0 1px 3px rgba(0,0,0,.22),0 0 18px -3px rgba(var(--plt-accent),.85)}
.plt-bulk-go:active:not(:disabled){transform:translateY(1px)}
.plt-bulk-go:disabled{opacity:.5;cursor:default}
/* 条目左侧的批量勾选框 */
.plt-pick{flex:0 0 auto;display:inline-flex;align-items:center;margin-right:1px}
.plt-pick input{width:13px;height:13px;cursor:pointer;margin:0}
.plt-pick input:disabled{cursor:default}
.plt-empty{padding:24px 12px;text-align:center;color:var(--dsw-alias-label-caption,#8a8a8a);line-height:1.75;font-size:14px}
/* 空组（比如待审核 0 条）仍然显示组头，展开时把提示图文上下左右居中。 */
.plt-group-empty{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:14px;color:var(--dsw-alias-label-caption,#8a8a8a);font-size:12.5px;opacity:.8;text-align:center;line-height:1.6}
.plt-group-empty svg{opacity:.6}
.plt-err{margin:6px 10px;padding:7px 10px;border-radius:6px;background:rgba(212,106,106,.12);border:1px solid rgba(212,106,106,.35);color:#e08b8b;line-height:1.55;word-break:break-word;font-size:14px}
.plt-mask{position:absolute;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;z-index:20}
.plt-dialog{width:100%;max-width:360px;background:var(--dsw-alias-bg-primary,#1e1e1e);border:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,.14));border-radius:10px;padding:16px;box-shadow:0 12px 32px rgba(0,0,0,.4)}
.plt-dialog h3{margin:0 0 9px;font-size:16px}
.plt-dialog p{margin:0 0 13px;line-height:1.7;color:var(--dsw-alias-label-secondary,#c0c0c0);font-size:14px}
.plt-dialog code{font-size:14px;background:var(--dsw-alias-bg-tertiary,rgba(0,0,0,.25));padding:1px 4px;border-radius:4px}
.plt-actions{display:flex;gap:8px;justify-content:flex-end}`)

    /**
     * 输入框与响应式：高度按容器收放、placeholder、容器查询分档。
     *
     * 本片段是 CSS_PARTS 的一段，位置即层叠顺序（由 build.mjs 按文件名字典序拼接）。
     */
    CSS_PARTS.push(`.plt-input{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-tertiary,rgba(0,0,0,.2));color:inherit;border:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,.14));border-radius:6px;padding:6px 8px;font-size:16px;font-family:inherit;resize:vertical;min-height:104px;line-height:1.5}
.plt-input::placeholder{font-size:16px;color:var(--dsw-alias-label-tertiary,#6b7280)!important;opacity:1!important}
/* —— Cursor 式输入区：整块一个圆角框，文字在上、胶囊标签在左下、圆形发送键在右下 ——
   （卡片外观与悬浮效果定义在 .plt-composer 的上面那段，这里只管内部排版） */
/* 输入区高度（id=152）：从固定的 104px 加高到 clamp(104px, 26cqh, 176px)。
   26cqh 按「本面板高度」算：常见窗口下取到上限 176px，输入面积比原来大六成；
   侧栏被拖矮时自动收到 104px 下限，把列表的空间让出来。 */
.plt-composer .plt-input{background:transparent;border:none;border-radius:0;padding:2px 2px 0;min-height:clamp(104px,26cqh,176px);resize:none;outline:none;line-height:1.55;caret-color:var(--dsw-alias-label-accent,#7fb0ff)}
/* 面板被拖到很矮时分档收缩（id=152）：26cqh 在 340px 以下已经到底限 104px，
   再矮就会把列表和操作条挤出面板。逐档收输入框、内外边距、胶囊与按钮尺寸，
   保证「操作条始终完整可见、列表至少留一行」。 */
@container (max-height: 340px){
  .plt-composer .plt-input{min-height:64px}
  .plt-form-wrap{padding-top:6px;padding-bottom:8px}
  .plt-list{padding-top:4px;padding-bottom:8px}
}
@container (max-height: 260px){
  .plt-composer .plt-input{min-height:52px}
  .plt-composer{gap:5px}
  .plt-form-wrap{padding:5px 10px 6px 10px}
}
@container (max-height: 200px){
  .plt-composer .plt-input{min-height:38px}
  .plt-chip{padding:3px 8px}
  .plt-deep-toggle,.plt-send{width:26px;height:26px}
  .plt-form-wrap{padding:4px 8px 5px 8px}
  .plt-list{padding-top:2px;padding-bottom:4px}
}
/* 暗色调：placeholder 用中灰而不是浅灰，避免整块看起来发白。
   注意：主题包 dsh-official-homepage-theme 会无条件给所有 input 的 placeholder
   打上 color:rgba(193,208,228,.72) !important（浅白蓝），在浅色主题的白底上等于隐形。
   这里必须同样用 !important 才能在层叠里压过它，否则默认提示文字会整个消失。 */
.plt-composer .plt-input::placeholder{color:var(--dsw-alias-label-tertiary,#6b7280)!important;opacity:1!important}
/* 胶囊标签在暗底上再压深一档，保持「暗色调」的统一。 */
.plt-composer .plt-chip{background:rgba(255,255,255,.045);border-color:rgba(255,255,255,.07);color:var(--dsw-alias-label-secondary,#aab2bf)}
.plt-composer .plt-chip:hover:not(:disabled){background:rgba(255,255,255,.09)}
/* 输入框下方的操作条：胶囊组 + D/F/S 三个圆钮，永远排成一行，不换行也不溢出（id=145）。
   宽度不够时按阶梯收缩：先收间距与内边距，最窄一档把胶囊文字换成纯图标
   （文字语义仍在 title / aria-label 上），这样四枚胶囊 + 三个圆钮始终齐整一行。 */
.plt-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;row-gap:6px;min-width:0;container-type:inline-size}
/* 面板窄到连纯图标的一行都放不下时，只让「三个圆钮」整体折到第二行并靠右，
   胶囊组始终完整一行、绝不截断 —— 这种情况下换行比切掉发送钮好。 */
.plt-bar>.plt-deep-toggle{margin-left:auto}
/* 胶囊组：横向可收缩但绝不换行；真的放下了也不许把胶囊截断，
   所以下限设 min-content —— 到那一步之前 .plt-chip-txt 已经被隐藏了。 */
.plt-chips{display:flex;flex-wrap:nowrap;align-items:center;gap:6px;flex:1 1 auto;min-width:min-content;overflow:hidden;scrollbar-width:none}
.plt-chips::-webkit-scrollbar{display:none}
/* 一个「段」= 可选连接符 + 一枚胶囊，段内不拆开，换行时连接符永远不会变成孤儿。 */
.plt-seg{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto}
/* 任务类型胶囊：定高 28px、左右内边距固定，四枚按钮高度与基线才能完全对齐。
   高度写死而不靠 padding 撑，是因为图标 13px 的中文行盒会随字体不同浮 1px。 */
.plt-bar .plt-chip{height:28px;box-sizing:border-box;padding:0 10px;justify-content:center}
/* 连接符（类型之间的「-」、拆解前的「+」）：定高与胶囊等高，靠 flex 居中，
   这样它和两侧文字的中线永远在同一条线上；左右由 .plt-seg 的 gap 拉开，因此等距。
   不能被选中，也不要响应鼠标。 */
.plt-op{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;height:28px;width:10px;font-size:14px;line-height:1;font-family:inherit;color:var(--dsw-alias-label-caption,#8a8a8a);opacity:.7;user-select:none;-webkit-user-select:none;pointer-events:none}
/* 窄一档：先收间距与内边距。 */
@container (max-width:560px){.plt-chips,.plt-seg{gap:4px}.plt-bar .plt-chip{padding:0 8px}}
/* 关键一档：图标+文字一起放不下时，先去掉图标、字号降一号 ——
   四个类型靠文字区分，读起来比看图省事，所以先舍图标而不是先舍文字。 */
@container (max-width:470px){.plt-bar .plt-chip-ico{display:none}.plt-bar .plt-chip{padding:0 9px;font-size:13px}.plt-chip-split{padding:0 9px}}
/* 再窄：连纯文字也挤了，才退回纯图标（语义仍在 title / aria-label 上）。 */
@container (max-width:360px){.plt-bar .plt-chip-txt{display:none}.plt-bar .plt-chip-ico{display:inline-flex}.plt-bar .plt-chip{padding:0 8px;font-size:14px}.plt-chip-split{padding:0 8px;border-radius:8px}}
/* 极窄面板：再收一档间隙。 */
@container (max-width:330px){.plt-chips,.plt-seg{gap:3px}.plt-bar .plt-chip{padding:0 5px}.plt-chip-split{padding:0 5px}.plt-bar{gap:6px}}`)

    /**
     * 操作条与胶囊：类型胶囊、拆解胶囊、发送/草稿/深入圆钮、操作符与页脚。
     *
     * 本片段是 CSS_PARTS 的一段，位置即层叠顺序（由 build.mjs 按文件名字典序拼接）。
     */
    CSS_PARTS.push(`.plt-chip{display:inline-flex;align-items:center;gap:5px;cursor:pointer;border:1px solid transparent;background:var(--dsw-alias-bg-secondary,rgba(255,255,255,.06));color:var(--dsw-alias-label-secondary,#c8c8c8);border-radius:999px;padding:6px 11px 6px 9px;font-size:14px;line-height:1;white-space:nowrap;font-family:inherit;transition:background .12s ease,color .12s ease,border-color .12s ease}
.plt-chip:hover:not(:disabled){background:var(--dsw-alias-bg-hover,rgba(255,255,255,.11));color:var(--dsw-alias-label-primary,#e6e6e6)}
.plt-chip.active{background:rgba(80,140,255,.18);border-color:rgba(80,140,255,.5);color:#9dc0ff}
.plt-chip:disabled{opacity:.5;cursor:default}
.plt-chip svg{flex:0 0 auto;opacity:.95;display:block}
/* 图标单独套一层定高定宽的居中盒：SVG 的 display:block 会让它按基线落位，
   和 14px 文字排在一起时矮半像素；这层 line-height:0 的 flex 盒子把它钉在文字中线上。 */
.plt-chip-ico{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;line-height:0}
.plt-chip-txt{display:inline-flex;align-items:center;line-height:1}
/* 发送钮加宽（id=174）：32 → 38px（+18.75%，落在需求给的 10%~20% 区间），只动水平方向。
   圆角必须跟着从 50% 换成定值 16px：50% 按各自轴算，38x32 得到 rx=19/ry=16 的压扁椭圆，
   端部不是半圆；16px = 高度的一半，两轴都不触发 CSS 半径收缩，是精确的「两端半圆 + 直边」胶囊。
   （实测比对 .shot/174-inset.mjs；999px 与 16px 在这台 Chrome 上逐行一致 —— 999 会被收缩规则
   clamp 回 16，但 16px 不依赖那条规则，且面板压矮的窄档把尺寸改成 26x26 时，
   16+16>26 自动 clamp 成 13 = 边长一半，回到正圆，一个值两种尺寸都对。）
   高度、字号、颜色、内边距、垂直居中（align/justify:center）全部保持不变。 */
.plt-send{flex:0 0 auto;width:38px;height:32px;border-radius:16px;border:none;padding:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-accent,#2f6fd0);color:#fff;box-shadow:0 2px 6px -2px rgba(47,111,208,.55),inset 0 1px 0 rgba(255,255,255,.22);transition:transform .1s ease,opacity .12s ease,background .12s ease,box-shadow .14s ease}
.plt-send:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 10px -3px rgba(47,111,208,.62),inset 0 1px 0 rgba(255,255,255,.26)}
.plt-send:active:not(:disabled){transform:translateY(0) scale(.96)}
.plt-send:disabled{opacity:.38;cursor:default}
/* 草稿开关：发送键同款圆形，默认只是灰圈（未启用），点亮后变绿实心。 */
.plt-draft-toggle{flex:0 0 auto;width:32px;height:32px;border-radius:50%;padding:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;background:transparent;color:var(--dsw-alias-label-caption,#9a9a9a);border:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,.16));transition:transform .1s ease,color .12s ease,border-color .12s ease,background .12s ease,box-shadow .14s ease}
/* hover 只做「当前状态稍微加深」，不换成另一种颜色（id=107）。 */
.plt-draft-toggle:hover:not(:disabled){background:rgba(150,158,170,.10);border-color:rgba(150,158,170,.4)}
.plt-draft-toggle:active:not(:disabled){transform:scale(.94)}
.plt-draft-toggle:disabled{opacity:.38;cursor:default}
.plt-draft-toggle.on{background:rgba(52,190,110,.92);color:#fff;border-color:transparent;box-shadow:0 2px 7px -2px rgba(52,190,110,.6),inset 0 1px 0 rgba(255,255,255,.22)}
.plt-draft-toggle.on:hover:not(:disabled){color:#fff;background:rgba(40,164,96,.96)}
/* 深入开关：与草稿开关同一套造型，点亮后用靛蓝，和「草稿=绿」区分开。 */
.plt-deep-toggle{flex:0 0 auto;width:32px;height:32px;border-radius:50%;padding:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;background:transparent;color:var(--dsw-alias-label-caption,#9a9a9a);border:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,.16));transition:transform .1s ease,color .12s ease,border-color .12s ease,background .12s ease,box-shadow .14s ease}
.plt-deep-toggle:hover:not(:disabled){background:rgba(150,158,170,.10);border-color:rgba(150,158,170,.4)}
.plt-deep-toggle:active:not(:disabled){transform:scale(.94)}
.plt-deep-toggle:disabled{opacity:.38;cursor:default}
.plt-deep-toggle.on{background:rgba(104,116,232,.92);color:#fff;border-color:transparent;box-shadow:0 2px 7px -2px rgba(104,116,232,.62),inset 0 1px 0 rgba(255,255,255,.22)}
.plt-deep-toggle.on:hover:not(:disabled){color:#fff;background:rgba(88,100,216,.96)}
/* 拆解模式：贴在「仅回答」右侧的独立开关（不属于任务类型，两者可共存）。
   与类型胶囊靠「形状」区分而不只是颜色：圆角方块 + 虚线空心（未选中）／ 琥珀实心 + 实线（选中）；
   类型胶囊是全圆胶囊、选中走蓝色，两者形状与色系都不同，一眼能看出它是「叠加」不是「三选一」。 */
.plt-chip-split{position:relative;border-radius:9px;padding:0 10px;gap:5px;background:rgba(255,255,255,.02);border:1px dashed rgba(255,255,255,.26);color:var(--dsw-alias-label-secondary,#aab2bf);letter-spacing:.02em}
.plt-chip-split:hover:not(:disabled){background:rgba(255,255,255,.08);border-color:rgba(255,163,64,.62);color:#f0b060}
.plt-chip.plt-chip-split.active{background:rgba(214,132,32,.88);border:1px solid rgba(255,186,104,.9);color:#fff;box-shadow:0 2px 8px -2px rgba(214,132,32,.6),inset 0 1px 0 rgba(255,255,255,.28)}
.plt-chip.plt-chip-split.active:hover:not(:disabled){background:rgba(226,144,40,.94);border-color:rgba(255,200,130,.95);color:#fff}
/* 选中态右上角小圆点：明示这是叠加在已选类型之上的开关，不是第四个互斥选项。 */
.plt-chip.plt-chip-split.active::after{content:'';position:absolute;top:3px;right:3px;width:5px;height:5px;border-radius:50%;background:#fff;opacity:.85}
.plt-foot{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:5px 12px 9px;color:var(--dsw-alias-label-caption,#8a8a8a);font-size:14px;opacity:.8}
.plt-foot-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`)

    /**
     * 拆解批次的父子层级视觉（id=273 建结构，id=275 定层级）。
     *
     * 父行只显示原始提示词标题 + 「N 条」徽标；展开后是子任务列表，父自己的
     * 计划 / 备注不渲染。层级靠三件事说清楚，不靠加粗堆叠：
     *   1. 父行标题比子任务大一档、左侧有一条强调竖杠 —— 一眼认出「这是一个批次」；
     *   2. 子任务整体缩进一层，并用一条贯穿的连接线（含每项的小横钩）挂回父行；
     *   3. 展开区不留父级计划块的空白：padding 收紧，只有子任务列表 + 折叠的原文。
     * 颜色全部走 --plt-accent 与 dsw 语义变量，深浅两套主题自动跟随。
     */
    CSS_PARTS.push(`/* —— 父行：批次标题 ——
   标题比子任务大 0.5px 且更重，左侧一道 3px 竖杠把「这是容器」说清楚。
   .plt-head 本来就是 flex，竖杠用 ::before 定宽定位，不参与排版。 */
.plt-item.plt-parent{background:linear-gradient(180deg,rgba(var(--plt-accent,120,168,255),.055),rgba(var(--plt-accent,120,168,255),.012) 42%,transparent 100%)}
.plt-item.plt-parent.open{border-color:rgba(var(--plt-accent,120,168,255),.42)}
.plt-item.plt-parent > .plt-head{position:relative;padding-left:13px}
.plt-item.plt-parent > .plt-head::before{content:'';position:absolute;left:5px;top:9px;bottom:9px;width:3px;border-radius:2px;background:rgba(var(--plt-accent,120,168,255),.55);transition:background .14s ease,box-shadow .16s ease}
.plt-item.plt-parent.open > .plt-head::before{background:rgba(var(--plt-accent,120,168,255),.9);box-shadow:0 0 8px -1px rgba(var(--plt-accent,120,168,255),.55)}
.plt-item.plt-parent > .plt-head .plt-name{font-size:14px;font-weight:600;letter-spacing:.005em}
.plt-item.plt-parent .plt-kids{flex:0 0 auto;font-size:11px;line-height:16px;padding:0 6px;border-radius:999px;color:rgba(var(--plt-accent,120,168,255),.95);background:rgba(var(--plt-accent,120,168,255),.14);border:1px solid rgba(var(--plt-accent,120,168,255),.28);white-space:nowrap;font-variant-numeric:tabular-nums}
.plt-item.plt-parent.open .plt-kids{background:rgba(var(--plt-accent,120,168,255),.24)}
/* —— 展开区：不留父级计划块的空白 ——
   父的 body 只有子任务列表 + 折叠的原文，上下 padding 收紧到 2/10，
   并去掉 15-detail.js 那条 28px 的左缩进（那是给「计划正文」对齐用的）。 */
.plt-body.plt-body-parent{padding:2px 10px 10px 10px;margin-top:0;border-top:1px solid rgba(var(--plt-accent,120,168,255),.16)}
/* —— 子任务列表：缩进一层 + 连接线 ——
   竖线挂在列表容器上（贯穿整批），每一项再用 ::before 画一小段横钩指回它，
   这样即便子任务之间的间隙变大，归属关系也不会断。 */
/* id=318/315：子任务之间原来是 5px 的紧贴，多行正文一多就糊成一片。
   拉到 9px，并把卡片内距从 6/8 提到 7/9 —— 每一条都能被当作独立一条来读。
   窄侧栏（≤320px）在文件末尾再收回去，否则小屏反而更挤。 */
.plt-kids-list{display:flex;flex-direction:column;gap:9px;margin:4px 0 8px 8px;padding-left:12px;border-left:2px solid rgba(var(--plt-accent,120,168,255),.26)}
.plt-kid{position:relative;border:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,.07));border-radius:7px;background:var(--dsw-alias-bg-secondary,rgba(255,255,255,.02));padding:7px 9px}
/* 横钩从左缘连接线（2px 宽 + 12px 内距 = 14px）一路画到卡片左边，两头都接上。 */
.plt-kid::before{content:'';position:absolute;left:-14px;top:13px;width:14px;height:2px;border-radius:1px;background:rgba(var(--plt-accent,120,168,255),.30)}
.plt-kid:hover{border-color:rgba(var(--plt-accent,120,168,255),.28);background:var(--dsw-alias-bg-secondary,rgba(255,255,255,.035))}
.plt-kid:hover::before{background:rgba(var(--plt-accent,120,168,255),.6)}
.plt-kid.running{border-color:rgba(236,72,153,.3)}
.plt-kid.running::before{background:rgba(236,72,153,.55)}
.plt-kid-h{display:flex;align-items:center;gap:6px;min-width:0}
/* id=322：children 行不再显示 #id，这两条规则（.plt-kid-h .plt-id / .plt-kid-done .plt-id）
   一起删掉 —— 留着就是死样式，且会让「已做」态多一个没有宿主的规则。
   删掉后标题左侧的缩进不变：对勾仍是 12px + 6px gap，只是不再有编号列。 */
.plt-kid-name{flex:1 1 auto;min-width:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#f0f2f5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.plt-kid-plan{margin-top:3px;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary,rgba(255,255,255,.78));white-space:pre-wrap;word-break:break-word}
.plt-kid-note{margin-top:3px;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-caption,#8a8a8a);white-space:pre-wrap;word-break:break-word}
.plt-kid-note-h{display:inline-block;margin-right:6px;font-weight:600;opacity:.8}
.plt-kid-pass{flex:0 0 auto}
/* —— 已做的子任务（id=316）——
   区分靠三件事叠加，任何一项单独都不够明显：
   1. 左侧对勾 + 标题与正文改用次要文字色（不再和未做项抢注意力）；
   2. 整卡略沉下去（浅底色 + 边框更淡），读起来像「已完成的历史」；
   3. 正文与备注降一档不透明度，但**不降到读不清**（id=317 会把两套主题的对比度补齐）。
   未做项一条规则都不碰 —— 保持原来的强调，避免整屏观感被拉平。 */
.plt-kid-done{background:var(--dsw-alias-bg-tertiary,rgba(255,255,255,.035));border-color:var(--dsw-alias-border-secondary,rgba(255,255,255,.05))}
.plt-kid-done .plt-kid-name{color:var(--dsw-alias-label-secondary,rgba(255,255,255,.78));font-weight:500}
.plt-kid-done .plt-kid-plan{color:var(--dsw-alias-label-secondary,rgba(255,255,255,.78));opacity:.86}
.plt-kid-done .plt-kid-note{opacity:.82}
.plt-kid-done::before{background:rgba(var(--plt-accent,120,168,255),.18)}
.plt-kid-done:hover{background:var(--dsw-alias-bg-hover,rgba(255,255,255,.055))}
/* 对勾：固定 12px 方框，不参与文字省略，未做项不占位（省下 12+6px 给标题）。 */
.plt-kid-check{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;border-radius:3px;font-size:10px;line-height:1;color:var(--dsw-alias-label-accent,#7fb0ff);background:rgba(var(--plt-accent,120,168,255),.16)}
/* id=322：未做的行也占这个 12px 槽位，只把颜色与底色收掉 —— 否则两种行标题起点差一截。 */
.plt-kid-check.is-off{visibility:hidden;background:transparent}
/* 窄侧栏：收紧缩进与字号，父行标题不与徽标抢宽度。 */
@container (max-width:320px){.plt-kid-plan,.plt-kid-note{font-size:12px}.plt-kids{display:none}.plt-kids-list{gap:7px;margin-left:4px;padding-left:9px}.plt-kid{padding:6px 8px}.plt-kid::before{left:-11px;width:11px}.plt-item.plt-parent > .plt-head .plt-name{font-size:13.5px}}
`)

    /**
     * 浅色主题覆盖：全部 body:not([data-ds-dark-theme]) 规则。
     *
     * 必须在全部深色基础片段之后拼接 —— 覆盖靠「同特异度、后写者胜」，顺序错了浅色会立刻退回深色。
     */
    CSS_PARTS.push(`/* ============================================================
   主题变量兜底（只补浅色）
   ------------------------------------------------------------
   这个插件的样式引用了几个简写 token（--dsw-alias-bg-primary /
   bg-secondary / bg-tertiary / bg-hover / bg-accent / border-secondary /
   border-accent / label-accent）。它们不是 dsh-client-ui-theme 里定义的
   名字（那边用的是 bg-layer-N、interactive-bg-hover、border-lN、
   state-business-primary），所以一直走的是各条规则里 var() 的兜底值。
   深色主题下保持原样（不定义，继续走兜底）；浅色主题下在这里补出
   一套浅色值，作用域只到 .plt-root，不污染宿主其它区域。
   ============================================================ */
body:not([data-ds-dark-theme]) .plt-root{
  --dsw-alias-bg-primary:#fff;
  --dsw-alias-bg-secondary:rgba(15,30,60,.035);
  --dsw-alias-bg-tertiary:#f4f6f9;
  --dsw-alias-bg-hover:rgba(38,49,72,.11);
  --dsw-alias-interactive-bg-hover:rgba(38,49,72,.11);
  --dsw-alias-bg-accent:#2f6fd0;
  --dsw-alias-border-secondary:rgba(20,40,70,.24);
  --dsw-alias-border-accent:rgba(47,111,208,.55);
  --dsw-alias-label-accent:#1f6fd0;
  /* 悬浮提示（id=248）：浅色用「浅底深字 + 柔和阴影」。
     底走不透明的 #fff —— 气泡底下可能是卡片、可能是输入框，半透明会跟着变脏；
     浮层本来就要脱离背景，宁可实心。文字 #1f2733 在白底上 15.04:1。
     阴影比深色轻一档（深色靠暗度分离，浅色靠柔和投影分离）；
     边框 .22 与气泡底 1.55:1，只求在浅底上勾出边界，不需要更强。 */
  --plt-tip-bg:#ffffff;
  --plt-tip-fg:#1f2733;
  --plt-tip-fg-muted:#4a5462;
  --plt-tip-border:rgba(20,40,70,.22);
  --plt-tip-shadow:0 1px 2px rgba(16,32,64,.10),0 10px 24px -8px rgba(16,32,64,.20);
}

/* ============================================================
   浅色主题
   ------------------------------------------------------------
   上面的默认样式是照深色面板调的：大量写死的 rgba(255,255,255,…)
   半透明叠层、深海军蓝的输入卡、偏黑的投影，这些在浅色下会糊成一片白。
   主题插件是通过给 body 元素打 data-ds-dark-theme 属性来切换的
   （dsh-client-ui-theme/lib/index.js 里 document.body.toggleAttribute(...)），
   所以这里用 body:not([data-ds-dark-theme]) 覆盖：属性一变，
   这些规则立刻生效，不需要 JS 参与，也不怕「跟随系统」的自动切换。
   只覆盖在浅色下会失效的那些规则，能靠 --dsw-alias-* token 自适应的一律不动。
   ============================================================ */

/* —— 三组强调色在浅底上要压深，否则组名/标签几乎看不见 —— */
body:not([data-ds-dark-theme]) .plt-group-reviewed{--plt-accent:96,106,122}
/* id=226：琥珀 176,124,10 在白卡上只有 3.4:1（组名 3.46、标签 2.83），压到 138,95,6 后
   alpha=1 时 5.25、组头 5.49，标签底也跟着变浅，仍然是同一个橙色相。 */
body:not([data-ds-dark-theme]) .plt-group-unreviewed{--plt-accent:138,95,6}
/* id=228：原本 31,111,208 太亮，「复制提示词」这类 accent@1 的文字落在 accent@.055 的卡片底上
   只有 4.39:1（同色系浅底压浅字）。压深一档到 #175aac，同色相不变、明度降一档，比值抬到 6 以上。 */
body:not([data-ds-dark-theme]) .plt-group-todo{--plt-accent:23,90,172}
/* 草稿组：浅色下用深一点的绿，浅底上才看得见。id=226：22,140,74 只有 4.0:1，
   压到 17,107,54 后 6.14:1，同时把沿用旧色号的标签一起换过来。 */
body:not([data-ds-dark-theme]) .plt-group-draft{--plt-accent:17,107,54}
body:not([data-ds-dark-theme]) .plt-group-draft .plt-tag.draft{background:rgba(17,107,54,.10);color:#116b36;border-color:rgba(17,107,54,.38)}
body:not([data-ds-dark-theme]) .plt-group-draft .plt-tag.type{color:rgba(17,107,54,.9);border-color:rgba(17,107,54,.26)}
body:not([data-ds-dark-theme]) .plt-tag.draft{background:rgba(17,107,54,.10);color:#116b36;border-color:rgba(17,107,54,.38)}
body:not([data-ds-dark-theme]) .plt-draft-toggle{color:#5b6472;border-color:rgba(20,40,70,.22)}
body:not([data-ds-dark-theme]) .plt-draft-toggle:hover:not(:disabled){background:rgba(20,40,70,.07);border-color:rgba(20,40,70,.34)}
body:not([data-ds-dark-theme]) .plt-draft-toggle.on{background:#178a48;box-shadow:0 2px 6px -2px rgba(22,140,74,.5),inset 0 1px 0 rgba(255,255,255,.25)}
body:not([data-ds-dark-theme]) .plt-draft-toggle.on:hover:not(:disabled){background:#12743c}
body:not([data-ds-dark-theme]) .plt-deep-toggle{color:#5b6472;border-color:rgba(20,40,70,.22)}
body:not([data-ds-dark-theme]) .plt-deep-toggle:hover:not(:disabled){background:rgba(20,40,70,.07);border-color:rgba(20,40,70,.34)}
body:not([data-ds-dark-theme]) .plt-deep-toggle.on{background:#4a54c8;box-shadow:0 2px 6px -2px rgba(74,84,200,.5),inset 0 1px 0 rgba(255,255,255,.25)}
body:not([data-ds-dark-theme]) .plt-deep-toggle.on:hover:not(:disabled){background:#3d47b4}
body:not([data-ds-dark-theme]) .plt-chip-split{background:#fff;border-color:rgba(160,110,20,.45);color:#7a5220}
body:not([data-ds-dark-theme]) .plt-chip-split:hover:not(:disabled){background:rgba(200,120,20,.09);border-color:rgba(180,112,18,.62);color:#8a5a12}
body:not([data-ds-dark-theme]) .plt-chip.plt-chip-split.active{background:#b06f10;border-color:#9a5f0c;color:#fff;box-shadow:0 1px 3px rgba(120,72,10,.28)}
body:not([data-ds-dark-theme]) .plt-chip.plt-chip-split.active:hover:not(:disabled){background:#c07a14;border-color:#b06f10;color:#fff}

/* —— 顶层结构：分隔线、提示条 —— */
body:not([data-ds-dark-theme]) .plt-top{border-bottom-color:rgba(20,40,70,.22)}
body:not([data-ds-dark-theme]) .plt-btn{border-color:rgba(20,40,70,.24)}
body:not([data-ds-dark-theme]) .plt-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
body:not([data-ds-dark-theme]) .plt-notice{background:rgba(34,150,70,.10);border-color:rgba(34,150,70,.39);color:#1c7c3e}
body:not([data-ds-dark-theme]) .plt-auto.on{color:#1a5db8;border-color:rgba(26,93,184,.45)}
/* 开始 / 暂停（id=207）浅色态：深色主题那两档 hover 底色在白底上偏灰，
   换成饱和一点的绿 / 橙，并把文字压深 —— 白底上 .plt-btn 的继承色足够，
   但 hover 时底色变浅会显得字发飘，所以显式钉一次。 */
body:not([data-ds-dark-theme]) .plt-start:not(:disabled):hover{background:rgba(34,150,84,.12);border-color:rgba(28,124,62,.46);color:#14663a}
body:not([data-ds-dark-theme]) .plt-pause:not(:disabled):hover{background:rgba(216,120,32,.12);border-color:rgba(176,94,20,.46);color:#8a4a0e}
/* 开始 / 暂停的状态色（id=210）浅色态：深色主题的亮蓝 / 亮琥珀在 #fdfefe 上几乎看不见，
   换成各自的深色系；禁用态沿用同一个 opacity，不另外调。 */
body:not([data-ds-dark-theme]) .plt-start.is-resume:not(:disabled){color:#17539e;border-color:rgba(31,111,208,.46);background:rgba(31,111,208,.10)}
body:not([data-ds-dark-theme]) .plt-start.is-resume:not(:disabled):hover{background:rgba(31,111,208,.17);border-color:rgba(31,111,208,.62)}
body:not([data-ds-dark-theme]) .plt-pause:not(:disabled){color:#8a4a0e;border-color:rgba(176,94,20,.44)}
body:not([data-ds-dark-theme]) .plt-top.has-error .plt-start,
body:not([data-ds-dark-theme]) .plt-top.has-error .plt-pause{border-color:rgba(198,40,40,.46)}

/* —— 输入卡：深海军蓝 → 素白玻璃卡 —— */
/* 外投影一律中性灰：深色主题里那几层偏蓝的投影（16,36,72 一带）是给海军蓝卡片
   做冷色晕染用的，落在白背景上就成了一片蓝雾，这里全部换成纯黑的低透明度。 */
body:not([data-ds-dark-theme]) .plt-form-wrap::after{background:rgba(0,0,0,.10);filter:blur(11px)}
body:not([data-ds-dark-theme]) .plt-composer{
  /* 浅色下不要顶部那道蓝光（深色主题里它是「顶部受光」，白卡上只会像一块蓝污渍），
     也不要有方向性的径向渐变 —— 只保留下部一点点极淡的冷灰，让卡片有一点体积感。 */
  background:
    linear-gradient(180deg,rgba(255,255,255,0) 0%,rgba(240,242,245,.55) 100%),
    linear-gradient(180deg,#ffffff 0%,#fdfdfe 100%);
  border-color:rgba(20,40,70,.24);
  /* 浅色下不要内阴影：白卡上叠 inset 会脏成一圈灰，只留向外的柔和投影（中性灰）。 */
  box-shadow:0 1px 2px rgba(0,0,0,.05),0 8px 18px -10px rgba(0,0,0,.14),0 22px 42px -24px rgba(0,0,0,.12);
}
body:not([data-ds-dark-theme]) .plt-composer:hover{border-color:rgba(20,40,70,.22);box-shadow:0 1px 2px rgba(0,0,0,.07),0 12px 24px -10px rgba(0,0,0,.17),0 28px 50px -26px rgba(0,0,0,.14)}
body:not([data-ds-dark-theme]) .plt-composer:focus-within{border-color:var(--dsw-alias-border-accent,#2f6fd0);box-shadow:0 1px 2px rgba(0,0,0,.05),0 16px 30px -10px rgba(0,0,0,.15),0 34px 60px -28px rgba(0,0,0,.12),0 0 0 3px rgba(20,40,70,.10)}
/* 聚焦时的顶部渐隐原本是蓝色光带，浅色下换成中性的白→透明，只做「顶面被照亮」的暗示。 */
body:not([data-ds-dark-theme]) .plt-composer::before{background:linear-gradient(180deg,rgba(255,255,255,.9),rgba(255,255,255,0) 52%)}
body:not([data-ds-dark-theme]) .plt-composer .plt-input::placeholder{color:var(--dsw-alias-label-tertiary,#98a1ad)}
body:not([data-ds-dark-theme]) .plt-composer .plt-chip{background:rgba(15,30,60,.05);border-color:rgba(15,30,60,.23);color:var(--dsw-alias-label-secondary,#4a5563)}
body:not([data-ds-dark-theme]) .plt-composer .plt-chip:hover:not(:disabled){background:rgba(15,30,60,.09);color:var(--dsw-alias-label-primary,#1f2328)}
/* 选中态：浅色下直接给实心品牌蓝底 + 白字白图标（原来是淡蓝底 + 蓝字，
   放在浅色卡片上对比太弱，看不出「已经被选中」）。 */
body:not([data-ds-dark-theme]) .plt-chip.active{background:#17539e;border-color:#134a8c;color:#fff;box-shadow:0 1px 3px rgba(20,60,120,.28),0 0 0 1px rgba(23,83,158,.18)}
body:not([data-ds-dark-theme]) .plt-chip.active:hover:not(:disabled){background:#1a60b6;border-color:#17539e;color:#fff}
body:not([data-ds-dark-theme]) .plt-chip.active svg{opacity:1}
/* 连接符：浅色下 label-caption 是 #adb2b8，白底上小符号几乎看不见，压深一档。 */
body:not([data-ds-dark-theme]) .plt-op{color:#59606c;opacity:.75}

/* —— 分组卡片：黑投影换成偏蓝的淡投影 —— */
/* 组头是 sticky 的，浅色下面板底色是白的，半透明会让滚动的内容透上来，压成接近实白。 */
body:not([data-ds-dark-theme]) .plt-group-h{background:rgba(250,252,255,.94);border-color:rgba(20,40,70,.26)}
body:not([data-ds-dark-theme]) .plt-group-h:hover{background:rgba(226,236,248,.96)}
body:not([data-ds-dark-theme]) .plt-group-reviewed,
body:not([data-ds-dark-theme]) .plt-group-unreviewed,
body:not([data-ds-dark-theme]) .plt-group-todo{box-shadow:0 1px 2px rgba(16,32,64,.05),0 6px 16px -12px rgba(16,36,72,.22)}
body:not([data-ds-dark-theme]) .plt-group-reviewed:hover,
body:not([data-ds-dark-theme]) .plt-group-unreviewed:hover,
body:not([data-ds-dark-theme]) .plt-group-todo:hover{box-shadow:0 1px 3px rgba(16,32,64,.07),0 10px 22px -14px rgba(16,36,72,.26),0 0 18px -12px rgba(var(--plt-accent),.5)}
body:not([data-ds-dark-theme]) .plt-group.open{box-shadow:0 2px 4px rgba(16,32,64,.07),0 16px 34px -18px rgba(16,36,72,.26),0 0 0 1px rgba(var(--plt-accent),.12)}
/* id=239：浅色下收起态的「干活中」流光。深色那套是往黑底上打亮光，浅底上反过来 ——
   外发光要淡（白底上重投影会糊），描边要实（对比度参考 id=227 的 1.5:1 门槛），
   扫过的那道高光保留 accent 本色 + 一段近白，走起来才看得见。 */
body:not([data-ds-dark-theme]) .plt-group.is-running:not(.open){border-color:rgba(var(--plt-accent),.62);box-shadow:0 1px 2px rgba(16,32,64,.05),0 6px 16px -12px rgba(16,36,72,.22),0 0 16px -8px rgba(var(--plt-accent),.42)}
/* 注意 background 是简写，会把基础规则里的 background-size:240% 一起重置回 auto ——
   那样 background-position 动画就没得走（光带会静止）。所以这里必须把尺寸与重复方式补回来。 */
body:not([data-ds-dark-theme]) .plt-group.is-running:not(.open)::after{background:linear-gradient(100deg,transparent 18%,rgba(var(--plt-accent),.22) 34%,rgba(var(--plt-accent),.98) 48%,#ffffff 52%,rgba(var(--plt-accent),.98) 56%,rgba(var(--plt-accent),.22) 70%,transparent 86%);background-size:240% 100%;background-repeat:no-repeat}
@media (prefers-reduced-motion: reduce){body:not([data-ds-dark-theme]) .plt-group.is-running:not(.open)::after{animation:none;background:linear-gradient(180deg,rgba(var(--plt-accent),.9),rgba(var(--plt-accent),.35));background-size:100% 100%}}

/* —— 条目底色：白色半透明 → 极淡的深色，浅底下才看得见边界 —— */
body:not([data-ds-dark-theme]) .plt-item{background:var(--dsw-alias-bg-primary,#fff)}
body:not([data-ds-dark-theme]) .plt-group-body .plt-item{background:rgba(var(--plt-accent),.055);border-color:rgba(var(--plt-accent),.32)}
/* id=227：卡片头与正文之间的分割线（基础样式是 accent@.14，白底上几乎看不见）。 */
body:not([data-ds-dark-theme]) .plt-group-body .plt-body{border-top-color:rgba(var(--plt-accent),.34)}

/* —— 文字在浅底上要压深，不能沿用深色主题的「提亮」 —— */
body:not([data-ds-dark-theme]) .plt-head:hover .plt-name{color:var(--dsw-alias-label-primary,#141a22)}
body:not([data-ds-dark-theme]) .plt-tag.running{background:rgba(13,107,116,.12);color:#0d6b74;border-color:rgba(13,107,116,.44)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-tag.todo{background:rgba(31,111,208,.08);color:#1a60b6;border-color:rgba(31,111,208,.26)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-tag.type{color:rgba(23,83,158,.86);border-color:rgba(31,111,208,.26)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-item.running .plt-name{color:#0d6b74;font-weight:600}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-item.running .plt-tag.running{background:rgba(13,107,116,.14);color:#0d6b74;border-color:rgba(13,107,116,.4)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-item.running .plt-tag.todo{background:rgba(31,111,208,.08);color:#1a60b6;border-color:rgba(31,111,208,.26)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-group-count{background:rgba(31,111,208,.10);color:#1a60b6;border-color:rgba(31,111,208,.26)}
body:not([data-ds-dark-theme]) .plt-tag.reviewed{background:rgba(120,130,145,.12);color:#5b6472;border-color:rgba(120,130,145,.41)}
body:not([data-ds-dark-theme]) .plt-tag.unreviewed{background:rgba(200,140,20,.12);color:#7c5405;border-color:rgba(200,140,20,.48)}
body:not([data-ds-dark-theme]) .plt-tag.todo{background:rgba(120,130,145,.12);color:#5b6472;border-color:rgba(120,130,145,.41)}
/* id=233「已中断」：与 id=228 给「待审核」定的琥珀同一族，但底色更浅一档 ——
   待审核是「干完了等人看」，已中断是「没干完等人续」，两者不该看起来一样重。 */
body:not([data-ds-dark-theme]) .plt-tag.interrupted{background:rgba(200,140,20,.10);color:#7c5405;border-color:rgba(200,140,20,.52)}
body:not([data-ds-dark-theme]) .plt-tag.failed{background:rgba(180,60,50,.10);color:#8a2e28;border-color:rgba(180,60,50,.45)}
/* id=226：基础样式是 rgba(var(--plt-accent),.85)，浅色下这条透明度会把文字再冲淡一层
   （待执行组只剩 3.59:1）。浅色一律用实色，悬停反色那条保持原样。 */
body:not([data-ds-dark-theme]) .plt-copy-btn{color:rgba(var(--plt-accent),1);border-color:rgba(var(--plt-accent),.32)}
body:not([data-ds-dark-theme]) .plt-copy-btn:hover{background:rgba(var(--plt-accent),.12);border-color:rgba(var(--plt-accent),.5);color:var(--dsw-alias-label-primary,#141a22)}
body:not([data-ds-dark-theme]) .plt-copy-btn:disabled:hover{color:rgba(var(--plt-accent),1)}
body:not([data-ds-dark-theme]) .plt-copy-btn.done{background:rgba(34,150,70,.12);border-color:rgba(34,150,70,.45);color:#116b36}

/* —— 正在执行：浅底上把强度压到一半，绿色内阴影才不会糊成一块绿 —— */
body:not([data-ds-dark-theme]) .plt-item.running{border-color:rgba(31,111,208,.33)}
body:not([data-ds-dark-theme]) .plt-item.running::after{box-shadow:inset 0 0 20px -10px rgba(31,111,208,.24)}
body:not([data-ds-dark-theme]) .plt-group-body .plt-item.running{border-color:rgba(31,111,208,.43);box-shadow:inset 0 0 20px -10px rgba(31,111,208,.26)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-item.running{border-color:rgba(31,111,208,.36);background:rgba(31,111,208,.05);box-shadow:inset 0 0 0 1px rgba(31,111,208,.12),inset 0 0 22px -10px rgba(31,111,208,.30)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-item.running::after{box-shadow:inset 0 0 22px -10px rgba(31,111,208,.28),inset 0 0 0 1px rgba(31,111,208,.1);background:linear-gradient(100deg,transparent 20%,rgba(255,255,255,.5) 45%,rgba(255,255,255,.75) 50%,rgba(255,255,255,.5) 55%,transparent 80%);background-size:220% 100%;background-repeat:no-repeat}

/* —— 详情区：代码块 / 备注 在浅底下改用更淡的着色 —— */
body:not([data-ds-dark-theme]) .plt-plan{background:var(--dsw-alias-bg-tertiary,#f4f6f9)}
body:not([data-ds-dark-theme]) .plt-group-body .plt-plan{background:rgba(var(--plt-accent),.06);border-color:rgba(var(--plt-accent),.32)}
body:not([data-ds-dark-theme]) .plt-group-body .plt-note{background:rgba(var(--plt-accent),.045);border-left-color:rgba(var(--plt-accent),.5)}
body:not([data-ds-dark-theme]) .plt-note{border-left-color:var(--dsw-alias-border-accent,#2f6fd0)}
body:not([data-ds-dark-theme]) .plt-source{color:#4a5261;background:rgba(96,106,122,.05);border-color:rgba(96,106,122,.34)}
body:not([data-ds-dark-theme]) .plt-del{color:#c0392b;border-color:rgba(192,57,43,.32)}
/* 「审核通过」的浅色特化随 id=193 一起消失：现在它就是 .plt-copy-btn，
 * 已有 body:not([data-ds-dark-theme]) .plt-copy-btn:hover / .done 两条覆盖接管，不需要额外的。 */
body:not([data-ds-dark-theme]) .plt-err{background:rgba(192,57,43,.08);border-color:rgba(192,57,43,.3);color:#a93226}
body:not([data-ds-dark-theme]) .plt-input{background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-label-primary,#141a22);border-color:rgba(20,40,70,.24)}
/* 草稿编辑框在浅底下：白底 + 绿色描边，聚焦时描边加深并带一圈淡绿光。 */
body:not([data-ds-dark-theme]) .plt-edit-box .plt-edit-input{background:#fff;border-color:rgba(var(--plt-accent),.4);box-shadow:inset 0 1px 2px rgba(20,40,70,.05);color:#141a22}
body:not([data-ds-dark-theme]) .plt-edit-box .plt-edit-input:hover{border-color:rgba(var(--plt-accent),.58)}
body:not([data-ds-dark-theme]) .plt-save-state{color:#59606c}
body:not([data-ds-dark-theme]) .plt-save-state.pending,body:not([data-ds-dark-theme]) .plt-save-state.saving,body:not([data-ds-dark-theme]) .plt-save-state.saved{color:rgba(var(--plt-accent),1)}
body:not([data-ds-dark-theme]) .plt-save-state.error{color:#b3261e}
body:not([data-ds-dark-theme]) .plt-edit-box .plt-edit-input:focus,body:not([data-ds-dark-theme]) .plt-edit-box .plt-edit-input:focus-visible{border-color:rgba(var(--plt-accent),.85);box-shadow:0 0 0 3px rgba(var(--plt-accent),.14),inset 0 1px 2px rgba(20,40,70,.05)}
/* 弹窗盒：与页面底同为纯白，只靠遮罩会显得「浮不起来」，因此描边抬到 1.85:1 并补三层阴影（近距贴边 + 中距扩散 + 远距氛围）。 */
body:not([data-ds-dark-theme]) .plt-dialog{background:var(--dsw-alias-bg-primary,#fff);border-color:rgba(20,40,70,.30);box-shadow:0 1px 2px rgba(16,32,64,.10),0 10px 24px -6px rgba(16,32,64,.20),0 28px 56px -18px rgba(20,40,80,.24)}
/* 弹窗遮罩：压暗 38.5%（原 46.9%），既压住底页又不过度发灰，白弹窗靠 1.58 的底差 + 描边 + 三层阴影分离。 */
body:not([data-ds-dark-theme]) .plt-mask{background:rgba(20,32,56,.22)}

/* —— 浅色下的次要文字：caption 在浅底上只有 2:1 出头，12.5px 会糊成一片 ——
   统一压到 bluish-700 一档（#61666b 附近），小字才有可读的对比度。 */
body:not([data-ds-dark-theme]) .plt-id{color:#5f6672;opacity:1}
/* id=179 浅色：label-caption 在白底上太淡（#adb2b8），跟 .plt-id 一样压深一档。 */
body:not([data-ds-dark-theme]) .plt-dur{color:#5f6672;opacity:1}
body:not([data-ds-dark-theme]) .plt-sec-h{color:#59606c}
/* 深色那条 hover 规则（.plt-sec-toggle:hover .plt-sec-h，特异度 (0,3,0)）比上面这行高，
   不补一条就会在白底上把标题刷成近白色（var 兜底 #e8e8e8）。 */
body:not([data-ds-dark-theme]) .plt-sec-toggle:hover .plt-sec-h{color:#2b3240}
body:not([data-ds-dark-theme]) .plt-sec-toggle .plt-sec-caret{color:#7a828e}
body:not([data-ds-dark-theme]) .plt-meta{color:#59606c}
body:not([data-ds-dark-theme]) .plt-group-count{color:#59606c}
/* id=275：拆解批次的层级线在白底上要压深一档，否则 2px 的 accent 半透明线和
   「小横钩」几乎看不见；父行的强调竖杠同理，浅色下用不透明的 accent。 */
body:not([data-ds-dark-theme]) .plt-kids-list{border-left-color:rgba(var(--plt-accent),.34)}
body:not([data-ds-dark-theme]) .plt-kid::before{background:rgba(var(--plt-accent),.40)}
body:not([data-ds-dark-theme]) .plt-kid:hover::before{background:rgba(var(--plt-accent),.72)}
body:not([data-ds-dark-theme]) .plt-item.plt-parent > .plt-head::before{background:rgba(var(--plt-accent),.72)}
body:not([data-ds-dark-theme]) .plt-item.plt-parent.open > .plt-head::before{background:rgba(var(--plt-accent),1)}
body:not([data-ds-dark-theme]) .plt-kid{background:rgba(15,30,60,.028);border-color:rgba(20,40,70,.14)}
body:not([data-ds-dark-theme]) .plt-kid:hover{background:rgba(15,30,60,.048);border-color:rgba(var(--plt-accent),.42)}
body:not([data-ds-dark-theme]) .plt-kid-h .plt-id{color:#5f6672}
body:not([data-ds-dark-theme]) .plt-kid-note{color:#59606c}
/* id=317：「已做的子任务」（id=316）在浅色下要逐项对齐 —— 深色那套吃的是
   rgba(255,255,255,.xx) 与 dsw 变量，白底上要么看不见、要么把字刷淡到读不清。
   这里只用两种既有色阶：bluish-700（文字）与 accent 的 alpha（装饰），不引入新色值。 */
body:not([data-ds-dark-theme]) .plt-kid.plt-kid-done{background:rgba(15,30,60,.045);border-color:rgba(20,40,70,.10)}
body:not([data-ds-dark-theme]) .plt-kid.plt-kid-done:hover{background:rgba(15,30,60,.075);border-color:rgba(var(--plt-accent),.34)}
body:not([data-ds-dark-theme]) .plt-kid-done .plt-kid-name{color:#3c4653}
body:not([data-ds-dark-theme]) .plt-kid-done .plt-kid-plan{color:#4a5563;opacity:1}
body:not([data-ds-dark-theme]) .plt-kid-done .plt-kid-note{color:#59606c;opacity:1}
body:not([data-ds-dark-theme]) .plt-kid-done::before{background:rgba(var(--plt-accent),.24)}
body:not([data-ds-dark-theme]) .plt-kid-check{color:#17559c;background:rgba(var(--plt-accent),.14)}
body:not([data-ds-dark-theme]) .plt-body.plt-body-parent{border-top-color:rgba(var(--plt-accent),.26)}
/* id=240：收起态「正在执行」提示。深色那条吃的是 rgba(var(--plt-accent),.95)，
   浅色下四组 accent 已压深（id=226/228），alpha 再拉满一档到这里：不放白底上会发灰。 */
body:not([data-ds-dark-theme]) .plt-group-run{color:rgba(var(--plt-accent),1)}
/* 上限下拉（id=190）：浅色下白底，深色那条 #1c1f24 的 option 底色要翻回来；
   箭头的 data-uri 是写死的中灰，浅色下偏淡，换一版深灰的图。
   底色仍走组自身的 --plt-accent（浅色档已审核是 96,106,122），只把透明度提一档，
   免得在白底上几乎看不见这个控件。 */
body:not([data-ds-dark-theme]) .plt-limit{border-color:rgba(96,106,122,.39);background-color:rgba(96,106,122,.1);background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5L6 8l3.5-3.5' fill='none' stroke='%2359606c' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");color:#3c434e}
body:not([data-ds-dark-theme]) .plt-limit:hover:not(:disabled){border-color:rgba(96,106,122,.5);background-color:rgba(96,106,122,.16)}
body:not([data-ds-dark-theme]) .plt-limit option{background:#ffffff;color:#2b3240}
body:not([data-ds-dark-theme]) .plt-foot{color:#6a7280;opacity:1}
body:not([data-ds-dark-theme]) .plt-empty{color:#59606c}
/* 空组提示：深色下靠 opacity:.8 压暗，浅色下会直接糊掉，改成实色 + 图标稍亮。 */
body:not([data-ds-dark-theme]) .plt-group-empty{color:#59606c;opacity:1}
body:not([data-ds-dark-theme]) .plt-group-empty svg{opacity:.75}
body:not([data-ds-dark-theme]) .plt-caret,body:not([data-ds-dark-theme]) .plt-grip{color:#646b77}
/* id=226：还有三处 caption 直接吃宿主的 --dsw-alias-label-caption，浅色下是 #adb2b8
   （白底 2.13:1、卡片底 1.98:1），小字基本看不见。统一压到 bluish-700 一档。
   .plt-pin 只在 hover 时才显现，但显现的那一下必须看得清，所以基线色也要给。 */
body:not([data-ds-dark-theme]) .plt-sec-hint{color:#646b77}
body:not([data-ds-dark-theme]) .plt-pin{color:#646b77}
body:not([data-ds-dark-theme]) .plt-tag.type{color:#59606c;border-color:rgba(20,40,70,.18)}
body:not([data-ds-dark-theme]) .plt-check.locked{opacity:.72}
/* 「· 模型回填」是 .65 透明的小字，浅底下几乎化掉，改成实色深灰。 */
body:not([data-ds-dark-theme]) .plt-check.locked span::after{opacity:1;color:#6a7280}
/* placeholder 在浅底上原本是 #98a1ad，压到 bluish-600 一档才看得清。
   同样要 !important：主题包给所有 input::placeholder 打了浅白蓝的 !important。 */
body:not([data-ds-dark-theme]) .plt-composer .plt-input::placeholder{color:#6b7280!important;opacity:1!important}
/* 弹窗里的行内代码：--dsw-alias-bg-tertiary 在浅色下不存在，会落到深色兜底上，
   深底深字直接看不见，这里给出浅色专用的淡灰底。 */
body:not([data-ds-dark-theme]) .plt-dialog code{background:rgba(20,40,70,.06);color:#333a45}
/* 「开始干活」：白字压在浅蓝上对比不够，浅色下把填充压深一档（#1a60b6 一档）。 */
body:not([data-ds-dark-theme]) .plt-bulk-go{color:#fff;border-color:rgba(20,70,130,.9);background:linear-gradient(180deg,#2b7ada,#1a60b6);box-shadow:0 1px 2px rgba(0,0,0,.14),0 0 12px -4px rgba(30,90,170,.55)}
body:not([data-ds-dark-theme]) .plt-bulk-go:hover:not(:disabled){background:linear-gradient(180deg,#3486e6,#1f6fd0);box-shadow:0 1px 3px rgba(0,0,0,.18),0 0 18px -3px rgba(30,100,190,.6)}
/* 干活中的半透明底 + 白字 = 白字消失，浅色下改成深蓝字。 */
body:not([data-ds-dark-theme]) .plt-bulk-go.is-working{color:#17539e;background:rgba(31,111,208,.14);border-color:rgba(31,111,208,.4)}
body:not([data-ds-dark-theme]) .plt-bulk-go.is-working:hover:not(:disabled){background:rgba(31,111,208,.14)}
body:not([data-ds-dark-theme]) .plt-bulk-go:disabled{opacity:1;color:#77808c;background:rgba(20,40,70,.07);border-color:rgba(20,40,70,.12);box-shadow:none}
body:not([data-ds-dark-theme]) .plt-bulk-go.is-working:disabled{color:#17539e;background:rgba(31,111,208,.14);border-color:rgba(31,111,208,.38)}
/* id=226：实心胶囊在浅色下的两处对比度修补。
   ①「全部通过 / 批量转待执行」原来用近黑的 #1b1200 压在琥珀/草绿强调色上，
      浅色档压深后底色变深（琥珀 138,95,6、草绿 17,107,54），近黑字只剩 3.4:1，
      换成白字后 4.70 / 5.44，两个强调色都过线。
   ②「批量删除」的红色是给深底调的 rgba(.92/.82) 半透明，浅底上合成出来只有 3.73:1，
      浅色改成实心红（#c0392b → #a83232，白字 5.98）。 */
body:not([data-ds-dark-theme]) .plt-bulk-pass,
body:not([data-ds-dark-theme]) .plt-bulk-promote{color:#fff}
/* 底色也要给：基础样式是 .98/.82 的半透明渐变，叠在浅色批量条上算出来只有 3.16:1，
   浅色下改成 1/.9 的实心渐变（琥珀 5.08、草绿 5.87），保留上下渐变的层次感。 */
body:not([data-ds-dark-theme]) .plt-bulk-pass{background:linear-gradient(180deg,rgba(var(--plt-accent),1),rgba(var(--plt-accent),.9))}
body:not([data-ds-dark-theme]) .plt-bulk-promote{background:linear-gradient(180deg,rgba(var(--plt-accent),1),rgba(var(--plt-accent),.9))}
body:not([data-ds-dark-theme]) .plt-bulk-pass:hover:not(:disabled),
body:not([data-ds-dark-theme]) .plt-bulk-promote:hover:not(:disabled){background:linear-gradient(180deg,rgba(var(--plt-accent),1),rgba(var(--plt-accent),.96))}
body:not([data-ds-dark-theme]) .plt-bulk-del{
  border-color:rgba(150,44,38,.85);
  background:linear-gradient(180deg,#c0392b,#a83232);
  box-shadow:0 1px 2px rgba(90,20,16,.22),0 0 12px -5px rgba(192,57,43,.7);
}
body:not([data-ds-dark-theme]) .plt-bulk-del:hover:not(:disabled){background:linear-gradient(180deg,#d94f43,#b83a30)}

/* —— 复选框：浅色下原生 checkbox 会跟着 color-scheme 画成深灰实心块，
   在白卡上就是「黑色的一坨」。这里在浅色下接管绘制（appearance:none），
   自己画一个白底 + 细边框的方框，勾选后填蓝并叠一个白色对勾。
   深色主题继续用原生绘制 + accent-color，一行不动。 */
body:not([data-ds-dark-theme]) .plt-check input[type='checkbox'],
body:not([data-ds-dark-theme]) .plt-pick input[type='checkbox'],
body:not([data-ds-dark-theme]) .plt-bulk input[type='checkbox']{
  -webkit-appearance:none;appearance:none;
  box-sizing:border-box;margin:0;padding:0;
  width:14px;height:14px;flex:0 0 auto;
  border:1.5px solid rgba(20,40,70,.34);
  border-radius:4px;
  background-color:#fff;
  cursor:pointer;
  transition:background-color .12s ease,border-color .12s ease,box-shadow .12s ease;
}
body:not([data-ds-dark-theme]) .plt-bulk input[type='checkbox'],
body:not([data-ds-dark-theme]) .plt-pick input[type='checkbox']{width:13.5px;height:13.5px}
body:not([data-ds-dark-theme]) .plt-check input[type='checkbox']:hover:not(:disabled),
body:not([data-ds-dark-theme]) .plt-pick input[type='checkbox']:hover:not(:disabled),
body:not([data-ds-dark-theme]) .plt-bulk input[type='checkbox']:hover:not(:disabled){border-color:rgba(31,111,208,.72);box-shadow:0 0 0 3px rgba(47,111,208,.12)}
body:not([data-ds-dark-theme]) .plt-check input[type='checkbox']:checked,
body:not([data-ds-dark-theme]) .plt-pick input[type='checkbox']:checked,
body:not([data-ds-dark-theme]) .plt-bulk input[type='checkbox']:checked{
  border-color:#1f6fd0;
  background-color:#1f6fd0;
  background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.2 8.6l3.1 3.1L12.8 5' fill='none' stroke='%23fff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:center;background-size:11px 11px;
}
/* 只读的「已执行」：勾选后是灰蓝的「已完成」色，不抢眼也不发黑。 */
body:not([data-ds-dark-theme]) .plt-check.locked input[type='checkbox']:checked{background-color:#8e97a4;border-color:#8e97a4}
/* 禁用且未勾选：浅灰虚化的空框。 */
body:not([data-ds-dark-theme]) .plt-check input[type='checkbox']:disabled:not(:checked),
body:not([data-ds-dark-theme]) .plt-pick input[type='checkbox']:disabled:not(:checked),
body:not([data-ds-dark-theme]) .plt-bulk input[type='checkbox']:disabled:not(:checked){border-color:rgba(20,40,70,.16);background-color:#f4f6f9;cursor:default}
body:not([data-ds-dark-theme]) .plt-check.locked input[type='checkbox']:disabled{cursor:not-allowed}
/* 拆解遮罩的浅色形态：白底界面下用淡蓝雾 + 白卡片，避免整块发黑。 */
body:not([data-ds-dark-theme]) .plt-split-mask{background:rgba(20,40,70,.16)}
body:not([data-ds-dark-theme]) .plt-split-card{
  border:1px solid rgba(20,40,70,.30);
  background:linear-gradient(180deg,#ffffff,#f8fbff);
  box-shadow:0 1px 2px rgba(16,32,64,.10),0 10px 22px -8px rgba(16,32,64,.20),0 30px 58px -24px rgba(20,40,80,.24),inset 0 1px 0 rgba(255,255,255,.92);
  color:#20293a;
}
/* 浅色下转圈用深一档的蓝，白底上 #8ab0f5 会糊。 */
body:not([data-ds-dark-theme]) .plt-split-card svg{color:#3a72c8}
body:not([data-ds-dark-theme]) .plt-split-card .plt-split-hint{color:#5b6675}
`)


    /** 最终样式文本（apply 里注入 <style>）。 */
    const CSS = CSS_PARTS.join('\n')


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
    function statusOf(item, impliedRunning = false) {
      // id=274：父节点（拆解批次）自己没有执行状态 —— 它的 execute / review 只是容器
      // 标记，真正在跑的是 children。所以父级的状态按子任务**聚合**：
      // 只要有一条在跑就是「执行中」，整批做完未审是「待审核」，整批审完是「已审核」，
      // 其余（还没轮到 / 有失败 / 有中断）才按待执行那一档的既有规则给。
      const kids = Array.isArray(item.children) ? item.children : []
      if (kids.length > 0) {
        // 草稿优先：整批被标成草稿时，即使子任务都做完了也还是草稿（不能因为
        // 下面那条「整批做完 = 待审核」把草稿洗成待审核）。
        if (item.draft === true) return { key: 'draft', label: '草稿' }
        // id=344：整批做完、但还有子任务没审 —— 这条父是「待审核」，不是「待执行」。
        // 队列侧已经不把它当可执行任务（正文为空），面板这一侧也必须同口径，
        // 否则会出现「点了开始，什么都没发生」的观感。
        // 注意要排除「全都审完了」：那是下面的 reviewed 分支，不能被这里抢走。
        if (item.review !== true
          && kids.every((kid) => kid?.execute === true)
          && !kids.every((kid) => kid?.review === true)) {
          return { key: 'unreviewed', label: '待审核' }
        }
        const states = kids.map((child) => statusOf(child))
        if (states.some((s) => s.key === 'running')) return { key: 'running', label: '执行中' }
        if (states.every((s) => s.key === 'reviewed')) return { key: 'reviewed', label: '已审核' }
        if (states.every((s) => s.key === 'reviewed' || s.key === 'unreviewed')) return { key: 'unreviewed', label: '待审核' }
        if (states.every((s) => s.key === 'failed')) return { key: 'failed', label: '失败' }
        if (states.some((s) => s.key === 'failed')) return { key: 'failed', label: '部分失败' }
        if (states.every((s) => s.key === 'interrupted')) return { key: 'interrupted', label: '已中断' }
        if (impliedRunning === true) return { key: 'running', label: '执行中' }
        return { key: 'todo', label: '待执行' }
      }
      if (item.draft === true) return { key: 'draft', label: '草稿' }
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
      if (typeof item.startedAt === 'string' && item.startedAt !== '') return { key: 'running', label: '执行中' }
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
     * 三种模式的优先级与叠加规则收在这一个函数里，别处不再各拼各的：
     * - 草稿：一律存用户原话（改写了就不是草稿了，转正/再编辑时再决定）；
     * - 仅回答：前缀单独占一行（`仅回答：\n<正文>`）——以前是 `仅回答：当前任务：…`
     *   直接贴在一起，两个标签连成一串谁也读不懂；
     * - 深入：先过 {@link deepPrompt}（自带幂等与 CRLF 归一），再叠前缀。
     *
     * 前缀先剥后加，保证「一条提示词里最多一个前缀」：用户自己写着「仅回答：」
     * 又选了仅回答类型时，不会变成两个。
     */
    function composePrompt(options) {
      const body = String(options?.text ?? '')
      if (options?.draft === true) return body.trim()
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
        area.style.position = 'fixed'
        area.style.top = '-1000px'
        area.style.opacity = '0'
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
     *    `var(--plt-tip-bg)` 解析成空，气泡变成透明底黑字、0 圆角无边框。
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
      el.style.visibility = 'hidden'
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
      el.className = 'plt-tip plt-tip--top'
      el.style.visibility = 'hidden'
      el.style.left = '0px'
      el.style.top = '0px'
      const panel = panelEl.getBoundingClientRect()
      // 窄面板（侧栏被拖到 300px 以下）时，变量里的 320px 上限比面板还宽 ——
      // 那样气泡会横向探出面板。按面板实际宽度再夹一次（id=251）。
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
      el.className = `plt-tip plt-tip--${place.side}`
      // 气泡此刻还在 left/top = 0，量到的视口位置就是**包含块原点**。
      // 不靠猜 `.plt-root` 的 container-type 是否真把 fixed 收成了自己的包含块
      // （各引擎/层叠上下文下并不一致），直接量一次再换算：
      //   包含块是面板 → base.left ≈ panel.left，修正量为 0；
      //   包含块是视口 → base.left = 0，修正量正好是面板原点。
      // 少了这一步，侧栏不在窗口左上角时整块气泡会整体平移一个侧栏偏移（id=299）。
      // 量之前先把方向类带来的 3px 位移抵消掉：否则换成相反方向时那 3px 会翻倍成 6px 偏差。
      el.style.transform = 'none'
      const base = el.getBoundingClientRect()
      el.style.transform = ''
      el.style.left = `${Math.round(place.left + (panel.left - base.left))}px`
      el.style.top = `${Math.round(place.top + (panel.top - base.top))}px`
      el.style.visibility = ''
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
      el.style.visibility = 'hidden'
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
      const { kids, groupKey, busy, onPatch } = props
      return h(
        'div',
        { className: 'plt-kids-list' },
        kids.map((child) => {
          const status = statusOf(child)
          const durText = fmtDur(child.time)
          const note = String(child.note ?? '')
          // id=322：children 行不再显示 `#id` —— 编号只在父/顶层行有意义（子任务不参与
          // 拖拽、批量、复制提示词，命令行也只会指到父）。但 `data-id` 必须留着：
          // 批量请求与验证脚本靠它定位具体那一条，去掉显示≠去掉身份。
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
              h(
                'span',
                { className: 'plt-kid-name', 'data-tip': `${child.name}\n\n${child.plan ?? ''}` },
                child.name,
              ),
              durText !== '' && (groupKey === 'unreviewed' || groupKey === 'reviewed')
                ? h('span', { className: 'plt-dur', 'data-tip': `这条任务耗时 ${durText}` }, durText)
                : null,
              child.taskType === '仅回答' || child.taskType === '目标'
                ? h('span', { className: `plt-tag type plt-type-${child.taskType}`, 'data-tip': `任务类型：${child.taskType}` }, h(ModeIcon, { kind: child.taskType, size: 12 }))
                : null,
              // id=274：状态徽标只挂在父级行上（父行显示整批的聚合状态），
              // 子任务行不再重复一遍 —— 否则一屏里同一句话要说 N+1 次。
              // 子任务自己的状态由行底色 / 左边框与「通过」按钮的可用性表达。
              status.key === 'running' ? h(SpinnerIcon, { size: 11 }) : null,
              groupKey === 'unreviewed' && status.key !== 'running' && child.review !== true
                ? h(
                    'button',
                    {
                      className: 'plt-copy-btn plt-kid-pass',
                      disabled: busy,
                      'data-tip': '人工审核这一条的执行结果：标记为已通过',
                      onClick: (e) => {
                        e.stopPropagation()
                        onPatch(child.id, { review: true })
                      },
                    },
                    h('span', null, '通过'),
                  )
                : null,
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
      const { item, open, detail, onToggle, onPatch, onRemove, onFetchDetail, busy, dragging, dropTarget, onDragStart, onDragOver, onDrop, onDragEnd, dragEnabled, selectable, selected, onSelect, showExecute, showReview, groupKey, impliedRunning, canPin, onPinTop, onPromote, onDemote, canDemote, editable } = props
      // id=273：父节点（带 children 的拆解批次）只当容器 —— 它没有正文、不参与执行，
      // 标题行就只显示原始提示词标题（name 本身就是从 sourcePrompt 压出来的），
      // 展开后交给下面的子任务列表，父自己的「计划 / 备注」一块都不渲染。
      const kids = Array.isArray(item.children) ? item.children : []
      const isParent = kids.length > 0
      const groupCount = isParent
        ? kids.filter((c) => statusOf(c).key === 'todo' || statusOf(c).key === 'running').length
        : 0
      const status = statusOf(item, impliedRunning === true)
      const time = fmtTime(item.time)
      // id=178：标题行的紧凑耗时（毫秒走 fmtDur）。空串代表缺失/0/非法，整节点不渲染。
      const durText = fmtDur(item.time)
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
      //   全量 read（首挂载、手点「刷新」）→ 直接给 sourcePrompt 全文，压根没有 sourcePromptLen。
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
      // 「复制提示词」只给待执行及之后的真实任务卡（草稿还没有出处，不给）；
      // 没有原始提示词的条目（手工提交的）直接不渲染按钮，而不是给一个点了没反应的空壳。
      const canCopyPrompt = groupKey !== 'draft' && sourceLen > 0
      const [copied, setCopied] = React.useState('')
      // 「原始提示词」默认折叠：展开状态只活在这个卡片里，切走再回来重新收起。
      const [sourceOpen, setSourceOpen] = React.useState(false)
      // 草稿就地编辑：editing = 是否展开编辑框，draftText = 编辑中的文本。
      // 编辑即保存：停止输入片刻就自动落盘，所以没有「保存」按钮；「取消」= 还原成进来时的原文。
      const [editing, setEditing] = React.useState(false)
      const [draftText, setDraftText] = React.useState('')
      const [saveState, setSaveState] = React.useState('idle')
      // openedRef = 点「编辑」那一刻的原文（取消时还原到它，永不改动）；
      // savedRef = 最近一次成功落盘的文本（用来跳过无意义的重复写入）。
      const openedRef = React.useRef('')
      const savedRef = React.useRef('')
      const saveTimerRef = React.useRef(null)
      const pendingRef = React.useRef(null)
      // 立刻把当前草稿文本落盘（标题跟着正文重新生成）。
      const flushDraft = async (text) => {
        pendingRef.current = null
        if (typeof text !== 'string' || text.trim() === '' || text === savedRef.current) {
          setSaveState('idle')
          return
        }
        setSaveState('saving')
        const ok = await onPatch({ plan: text, refreshName: true, silent: true })
        if (ok === undefined) {
          setSaveState('error')
          return
        }
        savedRef.current = text
        setSaveState('saved')
      }
      // 输入时不停改 draftText，停手 600ms 后自动保存一次（避免每敲一个字就写盘）。
      const onEditChange = (value) => {
        setDraftText(value)
        setSaveState('pending')
        if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
        pendingRef.current = value
        saveTimerRef.current = window.setTimeout(() => {
          saveTimerRef.current = null
          void flushDraft(pendingRef.current)
        }, 600)
      }
      // 收起编辑框 / 组件卸载时，把没来得及保存的那一下补上。
      const stopEditing = async (revert) => {
        if (saveTimerRef.current !== null) {
          window.clearTimeout(saveTimerRef.current)
          saveTimerRef.current = null
        }
        const pending = pendingRef.current
        pendingRef.current = null
        if (revert === true) {
          // 取消 = 还原到「点编辑那一刻」的原文（中途自动保存过也照样回滚）。
          if (openedRef.current !== savedRef.current) {
            setSaveState('saving')
            const ok = await onPatch({ plan: openedRef.current, refreshName: true, silent: true })
            if (ok === undefined) {
              setSaveState('error')
              return
            }
            savedRef.current = openedRef.current
          }
          setDraftText(openedRef.current)
          setSaveState('idle')
          setEditing(false)
          return
        }
        if (pending !== null) await flushDraft(pending)
        setEditing(false)
      }
      // 组件卸载（收起分组 / 切页签）时补最后一次写入：丢定时器可以，丢用户的字不行。
      React.useEffect(
        () => () => {
          if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
          const pending = pendingRef.current
          pendingRef.current = null
          if (pending !== null && pending !== savedRef.current && pending.trim() !== '') {
            void onPatch({ plan: pending, refreshName: true, silent: true })
          }
        },
        [],
      )
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
        const ok = await copyText(kind === 'id' ? `任务id:${item.id}` : kind === 'prompt' ? source : String(full ?? ''))
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
          className: `plt-item${isParent ? ' plt-parent' : ''}${open ? ' open' : ''}${running ? ' running' : ''}${dragging ? ' dragging' : ''}${dropTarget ? ' drop-target' : ''}${props.sublime === true ? ' plt-sublime' : ''}`,
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
          h('span', { className: 'plt-id' }, `#${item.id}`),
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
          (groupKey === 'unreviewed' || groupKey === 'reviewed') && durText !== ''
            ? h('span', { className: 'plt-dur', 'data-tip': `这条任务耗时 ${durText}` }, durText)
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
          h(
            'span',
            { className: 'plt-pin-slot' },
            pinTop === true
              ? h(
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
                )
              : null,
          ),
          /**
           * 状态徽标（id=352-D）。
           *
           * 执行中不再显示「执行中」三个字，只留一个转圈：这一列是竖着扫的，
           * 三个字占的宽度随字号变，而图标是一个定宽方块 —— 一列里只有它一个「词」，
           * 眼睛会被反复拉过去。转圈本身已经把「在跑」说清楚了。
           *
           * 尺寸（见 .plt-tag.running / .plt-run-dot）：外框固定 26×20，与文字徽标
           * 的行高 20px 对齐，所以整列右边界不会因为这一条从文字变成图标而移动。
           * 其余状态（待执行/待审核/已审核/草稿/失败/中断）一个字都没改。
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
            : h(
                'span',
                { className: `plt-tag ${status.key}` },
                h('span', null, status.label),
              ),
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
                groupKey,
                busy,
                onPatch,
              }),
              // 原始提示词仍留在最下面：这一批当初是根据哪句话拆出来的。
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
                    sourceOpen ? h('div', { className: 'plt-source' }, sourceText) : null,
                  )
                : null,
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
                  running
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
                  // 「计划」标题右侧：编辑（仅草稿）、复制内容、复制 ID。
                  h(
                    'span',
                    { className: 'plt-copy' },
                    editable === true
                      ? h(
                          'button',
                          {
                            className: `plt-copy-btn${editing ? ' done' : ''}`,
                            'data-tip': editing ? '收起编辑框' : '直接编辑这条草稿的内容',
                            onClick: (e) => {
                              e.stopPropagation()
                              if (editing) void stopEditing(false)
                              else {
                                const text = String(planText ?? '')
                                openedRef.current = text
                                savedRef.current = text
                                pendingRef.current = null
                                setDraftText(text)
                                setSaveState('idle')
                                setEditing(true)
                              }
                            },
                          },
                          h(EditIcon, { size: 12 }),
                          h('span', null, editing ? '收起' : '编辑'),
                        )
                      : null,
                    canCopyId === true
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
                    canCopyPlan === true
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
                    // 「通过」＝原来的底部「审核通过」，按 id=192 的定位搬到这一排、改名、
                    // 换成与「提示词」完全相同的 .plt-copy-btn 黄底样式（不新增样式类）。
                    // 触发逻辑一字未动：仍是 onPatch({ review: true })，走 60-tab.js:624 的
                    // patch，自动展开下一条 / 清空后折叠分组那套行为原样保留。
                    // 条件也照搬：只有待审核组（showReview）且这条不在执行中才给——
                    // 执行中的条目还没有结果可审，已审核的则早已整排不再重复出现。
                    showReview === false || running
                      ? null
                      : h(
                          'button',
                          {
                            className: 'plt-copy-btn',
                            disabled: busy || item.review === true,
                            'data-tip': '人工审核这一条的执行结果：标记为已通过',
                            onClick: (e) => {
                              e.stopPropagation()
                              onPatch({ review: true })
                            },
                          },
                          h('span', null, '通过'),
                        ),
                  ),
                ),
                editable === true && editing
                  ? h(
                      'div',
                      { className: 'plt-edit-box', onClick: (e) => e.stopPropagation() },
                      h('textarea', {
                        className: 'plt-input plt-edit-input',
                        value: draftText,
                        rows: 6,
                        spellCheck: false,
                        placeholder: '草稿内容，随时可以再改（停手自动保存）',
                        onChange: (e) => onEditChange(e.target.value),
                      }),
                      h(
                        'div',
                        { className: 'plt-edit-actions' },
                        // 正文左侧：任务类型切换（修改 / 目标 / 仅回答），改完立即落盘。
                        h(
                          'div',
                          { className: 'plt-edit-types' },
                          ['修改', '目标', '仅回答'].map((type) =>
                            h(
                              'button',
                              {
                                key: type,
                                type: 'button',
                                className: `plt-chip plt-chip-sm${item.taskType === type ? ' active' : ''}`,
                                disabled: busy,
                                'data-tip': `任务类型：${type}`,
                                onClick: (e) => {
                                  e.stopPropagation()
                                  onPatch({ taskType: type })
                                },
                              },
                              h('span', { className: 'plt-chip-ico' }, h(ModeIcon, { kind: type, size: 12 })),
                              h('span', { className: 'plt-chip-txt' }, type),
                            ),
                          ),
                        ),
                        // 编辑即保存：这里只显示保存状态，没有「保存」按钮。
                        h(
                          'span',
                          { className: `plt-save-state ${saveState}`, 'aria-live': 'polite' },
                          saveState === 'pending' ? '待保存…' : saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '已自动保存' : saveState === 'error' ? '保存失败，再改一下重试' : '停手即自动保存',
                        ),
                        h(
                          'button',
                          {
                            className: 'plt-btn',
                            disabled: busy || saveState === 'saving',
                            'data-tip': '放弃这次修改，还原成进入编辑时的内容',
                            onClick: (e) => {
                              e.stopPropagation()
                              void stopEditing(true)
                            },
                          },
                          '取消',
                        ),
                      ),
                    )
                  : h('div', { className: 'plt-plan' }, planText || '（空）'),
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
                    sourceOpen ? h('div', { className: 'plt-source' }, sourceText) : null,
                  )
                : null,
              h(
                'div',
                { className: 'plt-meta' },
                item.mode ? h('span', null, `模式：${item.mode}`) : null,
                h('span', null, `创建：${fmtDate(item.createdAt) || '—'}`),
                item.startedAt ? h('span', null, `开始：${fmtDate(item.startedAt)}`) : null,
                time ? h('span', null, `耗时：${time}`) : null,
              ),
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
                // 「转为待执行 / 转为草稿 / 删除」统一收进右侧的 .plt-actions，
                // 草稿组里「转为待执行」和「删除」因此挨在一起，不再被 margin-left:auto 拉开。
                h(
                  'div',
                  { className: 'plt-actions' },
                  // 草稿：给一个「转为待执行」，点一下才正式排队（草稿本身不参与执行）。
                  status.key === 'draft'
                    ? h(
                        'button',
                        {
                          className: 'plt-btn plt-promote',
                          disabled: busy,
                          'data-tip': '转为待执行：退出草稿，排进执行队列',
                          onClick: (e) => {
                            e.stopPropagation()
                            onPromote()
                          },
                        },
                        '转为待执行',
                      )
                    : null,
                  // 待执行里还没开工的条目可以退回草稿（执行中不给，见 canDemote）。
                  canDemote === true
                    ? h(
                        'button',
                        {
                          className: 'plt-btn plt-demote',
                          disabled: busy,
                          'data-tip': '转为草稿：退出执行队列，存进草稿组',
                          onClick: (e) => {
                            e.stopPropagation()
                            onDemote()
                          },
                        },
                        '转为草稿',
                      )
                    : null,
                  /**
                   * 待执行的条目在「转为草稿」之后多一个垃圾桶图标按钮（id=353）。
                   *
                   * 为什么用图标而不是再加一个「删除」文字按钮：这一排已经有两个文字按钮，
                   * 再加第三个在窄侧栏里会挤成两行。图标按钮宽度固定，永远不会换行。
                   *
                   * 样式要点（见 .plt-icon-btn）：36×26 的点击热区、与相邻按钮同高、
                   * gap 与 .plt-actions 一致，所以加进来不会把这一排顶到第二行。
                   *
                   * 点击走的就是现有删除通道（onRemove → remove），与文字「删除」按钮同一条路，
                   * 没有第二套逻辑 —— 两处行为不可能走散。
                   */
                  groupKey === 'todo' && running !== true
                    ? h(
                        'button',
                        {
                          className: 'plt-btn plt-icon-btn plt-trash',
                          type: 'button',
                          disabled: busy,
                          'data-tip': '删除这条待执行',
                          title: '删除这条待执行',
                          'aria-label': '删除这条待执行',
                          onClick: (e) => {
                            // 阻止冒泡：不然点按钮会连带把这一行展开/收起。
                            e.stopPropagation()
                            if (typeof onRemove === 'function') onRemove()
                          },
                        },
                        h(TrashIcon, { size: 13 }),
                      )
                    : null,
                  // 执行中的条目整排操作都不给：转草稿/删除直接隐藏，不留灰按钮。
                  // 待执行栏的删除已经收成上面的垃圾桶图标（id=353），这里不再重复放文字按钮 ——
                  // 一栏只留一个删除入口，免得用户犹豫该点哪个。
                  running === true || groupKey === 'todo'
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
      const payload = { sessionId, cwd }
      // 草稿按项目根目录隔离存放，刷新 / 重新挂载都不丢。
      const storeKey = `dsh-plan-tasks:${cwd || 'default'}`

      const readDraft = () => {
        try {
          const raw = window.localStorage.getItem(storeKey)
          if (raw === null) return null
          const parsed = JSON.parse(raw)
          return parsed !== null && typeof parsed === 'object' ? parsed : null
        } catch {
          return null
        }
      }
      const saved = readDraft()

      const [state, setState] = React.useState({ loading: true, error: '', data: null })
      // 统一悬浮提示（id=249）：气泡挂在面板根上做事件委托，这里只提供根节点。
      // 250 会把各处原生 title 换成 data-tip，届时不用再动这一行。
      const rootRef = React.useRef(null)
      useTipLayer(rootRef)
      const [openId, setOpenId] = React.useState(saved?.openId ?? null)
      const [busy, setBusy] = React.useState(false)
      const [showInit, setShowInit] = React.useState(false)
      // 草稿模式：点亮时「发送」把内容推进「草稿」组而不是「待执行」。
      const [draftMode, setDraftMode] = React.useState(saved?.draftMode === true)
      // 深入模式：点亮后「发送」会把输入框里的任务包装成一段要求「重写并做深」的提示词。
      const [deepMode, setDeepMode] = React.useState(saved?.deepMode === true)
      // 拆解模式：点亮后「发送」不直接落一条，而是交给宿主按项目情况拆成多条草稿。
      const [splitMode, setSplitMode] = React.useState(saved?.splitMode === true)
      // 拆解是异步 LLM 调用，比 append 慢得多，单独做「正在拆解…」的进度提示。
      const [splitting, setSplitting] = React.useState(false)
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
      // 「待审核」组里批量勾选的 id 集合。
      const [picked, setPicked] = React.useState(() => new Set())
      // 「已审核」组里批量勾选的 id 集合（用于批量删除）。
      const [pickedDone, setPickedDone] = React.useState(() => new Set())
      // 「草稿」组里批量勾选的 id 集合（用于批量转待执行 / 批量删除）。
      const [pickedDraft, setPickedDraft] = React.useState(() => new Set())
      // 分组展开态：手风琴互斥，同一时刻只有一个组展开（null = 全部折叠）。
      // 也存 localStorage，刷新后保持。
      const [openGroup, setOpenGroupState] = React.useState(() => {
        try {
          const raw = window.localStorage.getItem(`dsh-plan-tasks:groups:${cwd || 'default'}`)
          if (raw === null) return 'todo'
          const parsed = JSON.parse(raw)
          // 兼容旧版存的对象格式（{todo:true,...}），迁移成单个 key。
          if (typeof parsed === 'string') return parsed
          if (parsed !== null && typeof parsed === 'object') {
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
      // 已挂起（id=208）：只存内存，不写 plan.json。页面刷新后按「有未完成且无 turn 在跑」
      // 自然回落为「未开始」，不需要一个跨会话会失效的持久状态字段。
      const [paused, setPaused] = React.useState(false)
      // 上一次列表数据的指纹，用来跳过「内容没变」的重渲染。
      const lastSignatureRef = React.useRef('')
      // 展开中的条目的正文 / 备注：列表只拿 lite 数据，展开时才按需取全文。
      const [detail, setDetail] = React.useState(null)

      // 输入框草稿 / 展开项 / 自动刷新开关 / 草稿模式 / 深入模式 / 拆解模式，任何一项变化都落一次本地存储。
      React.useEffect(() => {
        try {
          window.localStorage.setItem(storeKey, JSON.stringify({ ...form, openId, auto, draftMode, deepMode, splitMode }))
        } catch {
          /* 隐私模式下写不进去就算了 */
        }
      }, [storeKey, form, openId, auto, draftMode, deepMode, splitMode])

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

      const refresh = React.useCallback(async () => {
        const data = await run(() => call('read', payload))
        return data
      }, [run, sessionId, cwd])

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
      // （草稿 → 待执行 → 待审核 → 已审核，或者退回）就在新分组里播一遍浮起动画。
      // 用数据指纹做 useMemo 依赖：自动刷新拿回一模一样的数据时不会重播。
      const groupOfItem = (it) => {
        if (it.draft === true) return 'draft'
        if (it.execute === true) return it.review === true ? 'reviewed' : 'unreviewed'
        return 'todo'
      }
      const liveItems = state.data?.items ?? []
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

      const items = state.data?.items ?? []

      // 状态兜底：模型已经开始干活，但还没把 startedAt 写进 plan.json 的那几秒，
      // 把「待执行」里排在最前面的那条先按「执行中」展示，避免「AI 在跑，列表全写待执行」。
      // 模型一旦回填 startedAt，这里会自动让位给真实状态。
      const impliedRunningId = (() => {
        if (agentRunning !== true) return null
        const first = items.find(
          (it) => it.execute !== true && it.draft !== true && it.failed !== true && (typeof it.startedAt !== 'string' || it.startedAt === ''),
        )
        return first === undefined ? null : first.id
      })()

      // 「正在执行几条」的唯一口径：和列表里那些显示成「执行中」标签的条目逐条对齐。
      // 之前这里只数「有 startedAt 的待执行」，而界面上还会把排在最前面的那条
      // 还没写 startedAt 的待执行也显示成「执行中」（impliedRunning），
      // 于是会话在跑、模型还没回填的那几秒，上方写 0 条、下面却有一条「执行中」。
      // 现在统一交给 statusOf，两边不可能再对不上。
      // id=233：statusOf 把 interrupted 排在 running 之前，所以被中断的条目不会再被数进来。
      const runningCount = items.filter((it) => statusOf(it, impliedRunningId === it.id).key === 'running').length

      // 当前「写着 startedAt 但还没完成」的条目 id：中断时要落盘成「已中断」的就是它们。
      // 放在这里而不是 pauseWork 里头算，是因为暂停的收尾阶段列表可能已被 sync 换过一轮。
      const startedIds = items
        .filter(
          (it) =>
            it.execute !== true
            && it.draft !== true
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

      // 开始 / 暂停 的可用性（id=208）：只由「有没有待办 / 是否在跑 / 有没有挂起」三个既存事实推导，
      // 不另存一份状态，否则四个来源迟早对不上。
      const pendingCount = items.filter((it) => it.execute !== true && it.draft !== true).length
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
      //   2. 用户手点「刷新」；
      //   3. 切回前台 / 窗口聚焦 / pageshow / 会话由空闲翻成执行中各补一次（下方三个 effect），
      //      但都只补**一次**，不是周期。
      // 所以删掉这段 = 模型干完活面板不动，用户得自己一直点刷新。要改只能改间隔或
      // 触发方式，不能用「看起来没人用」为理由整段移除。
      // 关闭 auto 时（用户点顶栏那个按钮）定时器清掉、倒计时显示 0 —— 那是用户显式选择手动刷新。
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
        // 最终提示词统一由 composePrompt 拼（id=262）：草稿存原文、仅回答前缀独占一行、
        // 深入模式先包模板再叠前缀，且自带幂等与 CRLF 归一。以前这段在 append 里手拼，
        // split() 那边另有一套，两处规则迟早走散。
        const text = composePrompt({
          text: form.plan,
          taskType: form.taskType,
          deep: deepMode,
          draft: draftMode,
        })
        const data = await run(() =>
          // mode 由宿主按 taskType 推（客户端没有模式下拉，form.mode 恒为空串）；
          // 显式传 taskType 就够了，这里保留 mode 字段是为了将来加真下拉时不必改协议。
          call('append', { ...payload, plan: text, mode: form.mode, taskType: form.taskType, draft: draftMode }),
        )
        if (data !== undefined) {
          // 提交后停留在当前视图：只清空输入框并就地给一条提示，
          // 不展开新计划、不滚动列表、不切换选中项（否则会“跳走”）。
          setForm({ plan: '', mode: form.mode, taskType: form.taskType, expanded: false })
          // 提交后自动展开落点那一栏（草稿 or 待执行），让刚写进去的计划立刻可见。
          setOpenGroup(draftMode ? 'draft' : 'todo')
          // 提交即刷新，并把倒计时拨回起点。
          await sync()
          setTick(AUTO_INTERVAL)
          // 提交后不再自动开工：开工由用户在「待执行」下方的「开始干活」按钮手动触发。
          setNotice(
            draftMode
              ? `已存入草稿 #${data.item?.id ?? '?'}`
              : deepMode
                ? `已追加计划 #${data.item?.id ?? '?'}（深入模式，已改写提示词）`
                : `已追加计划 #${data.item?.id ?? '?'}`,
          )
        }
      }

      /**
       * 拆解模式提交：交给宿主收集项目快照 → 一次 LLM → 写成 N 条。
       * 落在哪一组看右侧「草稿」开关：点亮 → 草稿组；没点亮 → 直接进待执行。
       * 宿主会做幂等（同一句话重复提交不会产生重复条目）与原子写。
       */
      const split = async () => {
        if (splitting) return
        const text = form.plan.trim()
        if (text === '') {
          setState((prev) => ({ ...prev, error: '要拆解的内容不能为空' }))
          return
        }
        // 拆解落点跟着「草稿」开关走，整段只取一次快照，避免异步期间开关被改。
        const toDraft = draftMode === true
        setSplitting(true)
        setState((prev) => ({ ...prev, error: '' }))
        setNotice('正在按项目情况拆解…')
        try {
          const data = await call(
            'decompose',
            {
              ...payload,
              question: text,
              mode: form.mode,
              taskType: form.taskType,
              draft: toDraft,
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
            const where = toDraft ? '草稿' : '待执行'
            // id=223：这条会带「建议砍掉 / 模型提到了不存在的文件」等附加信息，实测能到 79 字，
            // 默认 3.8 秒读不完，单独给更长时长。上面的「已拆解过了」是短答复，仍走默认。
            // id=262：深入模式下补一句，否则用户看不出这个开关到底做了什么。
            setNotice(
              `已拆解 ${count} 条到${where}${deepMode ? '（深入）' : ''}${tips.length > 0 ? ` · ${tips.join(' · ')}` : ''}`,
              NOTICE_LONG_MS,
            )
          }
          setForm({ plan: '', mode: form.mode, taskType: form.taskType, expanded: false })
          setOpenGroup(toDraft ? 'draft' : 'todo')
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
          (it) => it.interrupted === true && it.execute !== true && it.draft !== true,
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
                  && it.draft !== true
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
      React.useEffect(() => {
        const was = wasDispatchRunningRef.current
        wasDispatchRunningRef.current = agentRunning === true
        if (agentRunning === true) {
          // 新一轮开跑：允许它结束后再派一次。
          dispatchedRef.current = false
          return undefined
        }
        if (was !== true) return undefined
        if (pausedByUserRef.current === true) return undefined
        const epoch = dispatchEpochRef.current
        let started = false
        const timer = window.setTimeout(() => {
          started = true
          void (async () => {
            // 换会话、用户暂停、或会话又跑起来：这次空档不算「回答结束」。
            const still = () =>
              dispatchEpochRef.current === epoch
              && pausedByUserRef.current !== true
              && agentRunningRef.current !== true
            const deadline = Date.now() + DISPATCH_SETTLE_MS
            while (reconcilingRef.current === true && Date.now() < deadline) {
              if (!still()) return
              await new Promise((resolve) => window.setTimeout(resolve, 100))
            }
            if (!still()) return
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
                if (dispatchEpochRef.current !== epoch) {
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
              setNotice(data.redelivered === true ? `重新派发：${data.taskId}` : `已派发下一条：${data.taskId}`, NOTICE_LONG_MS)
              // 派出去之后立刻读一次，让新条目的「执行中」状态尽快出现。
              void sync()
            } catch (error) {
              dispatchedRef.current = false
              setNotice(`派发下一条失败：${error instanceof Error ? error.message : String(error)}`, NOTICE_LONG_MS)
            }
          })()
        }, DISPATCH_SETTLE_MS)
        return () => {
          // 请求已经发出就别清：prompt 会把 running 拉回 true，cleanup 若把结果扔掉，
          // 下一条其实发出去了，面板却没有任何「已派发」提示。
          if (!started) window.clearTimeout(timer)
        }
      }, [agentRunning, sessionId, cwd])

      /** 拖拽落位：只在「待执行」组内调整先后，随后整表重排并落盘。 */
      // 提交一整份「待执行组」的 id 顺序：Host 只认整表顺序，
      // 所以把待执行 → 待审核 → 已审核三段的 id 拼起来发过去，
      // order 重编号后各分组不会错位。界面先乐观更新，失败再回读。
      const commitOrder = async (order) => {
        const all = state.data?.items ?? []
        const ids = [
          ...order,
          ...all.filter((it) => it.draft === true).map((it) => it.id),
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
        const todo = (state.data?.items ?? []).filter((it) => it.execute !== true && it.draft !== true)
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
        const todo = (state.data?.items ?? []).filter((it) => it.execute !== true && it.draft !== true)
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
          return it !== undefined && statusOf(it, impliedRunningId === it.id).key === 'running'
        })
        order.splice(runningIndex >= 0 ? runningIndex + 1 : 0, 0, id)
        await commitOrder(order)
      }

      // 草稿 ⇄ 待执行 的互转：draft 只是条目上的一个布尔标记，
      // 转换 = 改这个标记，再把这一条挪到目标组末尾（保持组内相对顺序稳定）。
      // 转成待执行时顺手清掉 startedAt / time，避免带着草稿时期的残留状态进队列。
      const moveToGroup = async (ids, draft) => {
        const list = [...new Set(ids)]
        if (list.length === 0) {
          setNotice(draft ? '先把要转草稿的项勾上' : '先把要转待执行的草稿勾上')
          return
        }
        setBusy(true)
        setState((prev) => ({ ...prev, error: '' }))
        try {
          for (const id of list) {
            // id=233：转组时顺手摘掉「已中断」标记 —— 换组意味着用户重新安排了这条，
            // 再挂着上一次中断的标记会误导（尤其转回待执行时，会一进门就显示「已中断」）。
            await call('update', {
              ...payload,
              id,
              patch: draft ? { draft: true, interrupted: false } : { draft: false, clearTime: true, interrupted: false },
            })
          }
          // 乐观地把标记先改进本地数据，让条目立刻跳组，避免等 sync 的那一下闪烁。
          setState((prev) => {
            if (prev.data === null) return prev
            const next = (prev.data.items ?? []).map((it) =>
              list.includes(it.id)
                ? { ...it, draft: draft, interrupted: false, ...(draft ? {} : { startedAt: '', time: 0 }) }
                : it,
            )
            return { ...prev, data: { ...prev.data, items: next } }
          })
          if (draft) setPickedDraft((prev) => new Set())
          setNotice(draft ? `已转为草稿 ${list.length} 条` : `已转待执行 ${list.length} 条`)
          // 转待执行后，用户多半接着要开工：把「待执行」组展开，让它看得见。
          if (!draft) setOpenGroup('todo')
          await sync()
        } catch (error) {
          setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }))
          await sync()
        } finally {
          setBusy(false)
        }
      }

      // 本地打补丁：只就地更新这一条，不重排、不滚动、不改变展开项。
      const patch = async (id, value) => {
        // 审核通过前先算出「下一个待审核项」：审核完这一条，它就离开待审核组，
        // 于是自动展开它后面那条，省得用户再点一次。
        let nextUnreviewed = null
        if (value.review === true) {
          const unreviewed = (state.data?.items ?? []).filter((it) => it.execute === true && it.review !== true)
          const index = unreviewed.findIndex((it) => it.id === id)
          if (index >= 0 && index + 1 < unreviewed.length) nextUnreviewed = unreviewed[index + 1].id
        }
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
          // 审核完这一条后「待审核」是否已经空了：
          // 空了就把这一组自动折叠起来（不再赖在展开态占着整个面板）。
          const remainingUnreviewed = (state.data?.items ?? []).filter(
            (it) => it.execute === true && it.review !== true && it.id !== id,
          ).length
          if (reviewed && remainingUnreviewed === 0) {
            setOpenId(null)
            if (openGroup === 'unreviewed') setOpenGroup(null)
          } else if (reviewed && nextUnreviewed !== null) {
            setOpenId(nextUnreviewed)
            // 分组可能是折叠的，展开项在折叠组里看不见，顺手把它展开。
            setOpenGroup('unreviewed')
          }
          if (!silent) {
            setNotice(
              reviewed
                ? `已审核通过 #${id}`
                : value.review === false
                  ? `已取消审核 #${id}`
                  : typeof value.plan === 'string'
                    ? `已保存草稿 #${id}`
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
          setPickedDraft((prev) => {
            if (!prev.has(id)) return prev
            const next = new Set(prev)
            next.delete(id)
            return next
          })
          await sync()
          setNotice(`已删除计划 #${id}`)
        } catch (error) {
          setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }))
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
          // 批量通过后「待审核」清空了，就把这一组折叠起来，别占着整个面板。
          const remaining = (state.data?.items ?? []).filter(
            (it) => it.execute === true && it.review !== true && !ids.includes(it.id),
          ).length
          if (remaining === 0) {
            setOpenId(null)
            if (openGroup === 'unreviewed') setOpenGroup(null)
          }
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

      /** 批量删除「已审核」/「草稿」组里勾选的条目。正在执行的会被宿主跳过。 */
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
          setPickedDraft(new Set())
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
       * 「待审核自动通过条数」下拉的 change（id=300）。
       *
       * 写回 → 宿主立刻按新阈值补一轮自动通过 + 归档 → 重读。
       * `autoApproved` 是这次真被通过掉的 id（宿主回传），有就报一句，
       * 免得用户看到待审核凭空少了几条却不知道为什么。
       */
      const changeAutoReviewLimit = async (value) => {
        const next = Number(value)
        await run(async () => {
          const saved = await call('settings', { ...payload, patch: { autoReviewLimit: next } })
          const passed = Array.isArray(saved?.autoApproved) ? saved.autoApproved.length : 0
          setNotice(
            passed > 0
              ? `待审核超过 ${next} 条后自动通过 · 本次自动通过 ${passed} 条`
              : `待审核自动通过：超过 ${next} 条时通过最旧的一条`,
          )
          return call('read', { ...payload, lite: true })
        })
      }

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
        const drafting = new Set((state.data?.items ?? []).filter((it) => it.draft === true).map((it) => it.id))
        setPickedDraft((prev) => {
          const next = new Set([...prev].filter((id) => drafting.has(id)))
          return next.size === prev.size ? prev : next
        })
      }, [state.data])

      return h(
        'div',
        { className: 'plt-root', ref: rootRef, style: { position: 'relative' } },
        h(
          'div',
          // has-error（id=210）：让顶栏两个按钮跟着错误提示一起描红，操作失败时不用靠猜。
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
          // 开始 / 暂停（id=207 渲染，id=208 接逻辑）：插在「自动刷新」与「刷新」之间，
          // 即口语需求说的「任务列表右边、倒计时左边」。两个按钮都沿用 .plt-btn 的标签结构
          // （inline-flex + 图标 + 文字），与刷新按钮视觉同族。
          // 可用性全部由 canStart / canPause 推导（见上方 working 一带），不在别处另存状态：
          //   未开始 → 开始可点、暂停禁用；执行中 → 反过来；已挂起 → 开始变「继续」、暂停禁用；
          //   全部完成（无待办）→ 两个都禁用；busy（有请求在飞）→ 两个都禁用。
          h(
            'button',
            {
              className: `plt-btn plt-start${pausedIdle ? ' is-resume' : ''}`,
              disabled: canStart !== true,
              'data-tip':
                pendingCount === 0
                  ? '没有待执行的计划'
                  : pausedIdle
                    ? '从挂起处继续队首这条计划，已完成的不会重做'
                    : `把队首任务发进会话（按钮「${KICKOFF_TEXT}」），模型不用再自己找下一条`,
              onClick: (e) => {
                e.stopPropagation()
                void startWork()
              },
            },
            h(PlayIcon, { size: 12 }),
            h('span', null, pausedIdle ? '继续' : '开始'),
          ),
          h(
            'button',
            {
              className: 'plt-btn plt-pause',
              disabled: canPause !== true,
              'data-tip': working ? '挂起当前执行，已完成的进度会保留' : '当前没有正在执行的任务',
              onClick: (e) => {
                e.stopPropagation()
                void pauseWork()
              },
            },
            pausing ? h(SpinnerIcon, { size: 12 }) : h(PauseIcon, { size: 12 }),
            h('span', null, pausing ? '暂停中' : '暂停'),
          ),
          h(
            'button',
            { className: 'plt-btn plt-refresh', disabled: busy, 'data-tip': '立即重新读取 plan.json', onClick: refresh },
            // 转圈位（id=196/197/198）：图标默认静止（spin:false 只画圆弧、不自带动画），
            // 转不转完全由这里的状态类决定。两类互斥，切换时容器尺寸不变、不重排。
            //   spinning = 这一次读写请求在飞（busy） 或 模型正在干活（working）
            //   idle     = 两者皆无
            // 注意不要接静默自动刷新（sync 不置 busy），否则每 5 秒图标都要抖一下。
            h(
              'span',
              {
                className: `plt-refresh-ico${busy || working ? ' spinning' : ' idle'}`,
                'aria-hidden': 'true',
                'data-busy': busy ? 'true' : 'false',
                'data-working': working ? 'true' : 'false',
              },
              h(SpinnerIcon, { size: 12, spin: false }),
            ),
            h('span', { className: 'plt-refresh-label' }, '刷新'),
          ),
        ),
        state.error !== '' ? h('div', { className: 'plt-err' }, state.error) : null,
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
                      const reviewedTimeOf = (it) => {
                        const kids = Array.isArray(it.children) ? it.children : []
                        const pool = kids.length > 0 ? kids : [it]
                        const times = pool.map((one) => {
                          const done = typeof one?.finishedAt === 'string' ? Date.parse(one.finishedAt) : NaN
                          if (Number.isFinite(done)) return done
                          const born = typeof one?.createdAt === 'string' ? Date.parse(one.createdAt) : NaN
                          return Number.isFinite(born) ? born : 0
                        })
                        return times.length === 0 ? 0 : Math.max(...times)
                      }
                      const reviewedRank = (it) => {
                        const head = Number(String(it?.id ?? '').split('-')[0])
                        return Number.isFinite(head) ? head : 0
                      }
                      const doneReviewed = items
                        .filter((it) => {
                          const batch = batchOf(it)
                          if (batch !== null) return batch.allReviewed && it.draft !== true
                          return it.execute === true && it.review === true && it.draft !== true
                        })
                        .sort((a, b) => reviewedTimeOf(b) - reviewedTimeOf(a) || reviewedRank(b) - reviewedRank(a))
                      const donePending = items.filter((it) => {
                        const batch = batchOf(it)
                        if (batch !== null) return batch.allDone && batch.allReviewed !== true && it.draft !== true
                        return it.execute === true && it.review !== true && it.draft !== true
                      })
                      // 草稿单独成组（绿色、最靠下、贴着输入框）；没有草稿时整组不显示。
                      const draftList = items.filter((it) => it.draft === true)
                      const todoList = items.filter((it) => {
                        if (it.draft === true) return false
                        const batch = batchOf(it)
                        if (batch !== null) return batch.allDone !== true
                        return it.execute !== true
                      })
                      const groups = [
                        { key: 'reviewed', title: '已审核', list: doneReviewed, defaultOpen: false, drag: false, alwaysShow: false, emptyText: '还没有审核通过的计划' },
                        { key: 'unreviewed', title: '待审核', list: donePending, defaultOpen: false, drag: false, alwaysShow: true, emptyText: '暂无待审核内容' },
                        { key: 'todo', title: '待执行', list: todoList, defaultOpen: true, drag: true, alwaysShow: true, emptyText: '待执行里没有计划，在下面的输入框写一条。' },
                        { key: 'draft', title: '草稿', list: draftList, defaultOpen: true, drag: false, alwaysShow: false, emptyText: '' },
                      ]
                      const renderItem = (item, dragEnabled, groupKey) => {
                        // 「待审核」「已审核」「草稿」三组支持勾选：分别用于批量审核、
                        // 批量删除、批量转待执行。正在执行的条目任何组都不参与勾选。
                        const selectable =
                          (groupKey === 'unreviewed' || groupKey === 'reviewed' || groupKey === 'draft') &&
                          statusOf(item).key !== 'running'
                        const pickedSet = groupKey === 'reviewed' ? pickedDone : groupKey === 'draft' ? pickedDraft : picked
                        const setPickedSet =
                          groupKey === 'reviewed' ? setPickedDone : groupKey === 'draft' ? setPickedDraft : setPicked
                        return h(Item, {
                          key: item.id,
                          item,
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
                          // 置顶按钮只出现在待执行组，且拆分出来的子任务不给（id=243）。
                          // 判定依据只能是 `decomposeKey`：`[拆] ` 是宿主拼在 name 上的文案，
                          // 用户改个名就骗过去了，而 key 是落盘事实（宿主 `dedupeKeyOf` 生成）。
                          // 为什么不许置顶：拆解出来的是一组按顺序铺开的工作单元，把它们
                          // 挑一条顶到最前面，等于绕过拆解给出的执行顺序，用户看着也乱。
                          canPin: groupKey === 'todo' && (item.decomposeKey ?? '') === '',
                          onPinTop: () => void pinTop(item.id),
                          // 草稿组专属：单条「转为待执行」+ 正文可直接编辑。
                          // 草稿组里的父节点给「转为待执行」：整批一起出草稿（宿主按 id 改父）。
                          onPromote: () => void moveToGroup([item.id], false),
                          // 待执行里还没开工的才允许退回草稿（执行中不给）。
                          // 父节点（拆解批次）不给「转为草稿」：它的草稿态是整批的落点，
                          // 单条父退回草稿要连带处理 children，宿主没有这个语义（id=273）。
                          canDemote: groupKey === 'todo' && statusOf(item, impliedRunningId === item.id).key === 'todo' && !(Array.isArray(item.children) && item.children.length > 0),
                          onDemote: () => void moveToGroup([item.id], true),
                          editable: groupKey === 'draft',
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
                          onDragStart: () => {
                            setDragId(item.id)
                            setDropId(null)
                          },
                          onDragOver: () => {
                            if (dragId !== null && dragId !== item.id) setDropId(item.id)
                          },
                          onDrop: () => {
                            void moveTo(dragId, item.id)
                            setDragId(null)
                            setDropId(null)
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
                          const isRunning = group.list.some((it) => statusOf(it, impliedRunningId === it.id).key === 'running')
                          const pendingIds = group.key === 'unreviewed' ? group.list.map((item) => item.id) : []
                          const allPicked = pendingIds.length > 0 && pendingIds.every((id) => picked.has(id))
                          // 「已审核」组同样支持勾选，用于批量删除。
                          const doneIds = group.key === 'reviewed' ? group.list.map((item) => item.id) : []
                          const allPickedDone = doneIds.length > 0 && doneIds.every((id) => pickedDone.has(id))
                          // 「草稿」组也支持勾选：批量转待执行 / 批量删除。
                          const draftIds = group.key === 'draft' ? group.list.map((item) => item.id) : []
                          const allPickedDraft = draftIds.length > 0 && draftIds.every((id) => pickedDraft.has(id))
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
                              // 「待审核超过 N 条自动通过最旧一条」的条数（id=300）。
                              // 档位由宿主下发的 noteLimits 决定。已审核不再按条数删除，所以这个下拉只出现在待审核。
                              group.key === 'unreviewed' && Array.isArray(state.data?.noteLimits)
                                ? h(
                                    'select',
                                    {
                                      className: 'plt-limit',
                                      value: String(state.data?.settings?.autoReviewLimit ?? 200),
                                      disabled: busy,
                                      'aria-label': '待审核自动通过的条数',
                                      'data-tip': '待审核超过这个条数时，自动通过最旧的一条，并搬进已审核。已审核会一直保留',
                                      onClick: (e) => e.stopPropagation(),
                                      onChange: (e) => void changeAutoReviewLimit(e.target.value),
                                    },
                                    state.data.noteLimits.map((n) =>
                                      h('option', { key: String(n), value: String(n) }, String(n)),
                                    ),
                                  )
                                : null,
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
                                    // 「草稿」组底部一排操作：全选 + 全部删除 + 批量「转待执行」。
                                    group.key === 'draft'
                                      ? h(
                                          'div',
                                          { className: 'plt-bulk' },
                                          h(
                                            'label',
                                            { className: 'plt-check', 'data-tip': allPickedDraft ? '取消全选' : '全选本组全部' },
                                            h('input', {
                                              type: 'checkbox',
                                              checked: allPickedDraft,
                                              disabled: busy,
                                              onChange: (e) => {
                                                if (e.target.checked) setPickedDraft(new Set(draftIds))
                                                else setPickedDraft(new Set())
                                              },
                                            }),
                                            h('span', null, '全选'),
                                          ),
                                          h('span', { className: 'plt-bulk-count' }, pickedDraft.size > 0 ? `已选 ${pickedDraft.size}` : ''),
                                          h(
                                            'button',
                                            {
                                              className: 'plt-btn plt-bulk-del',
                                              disabled: busy || pickedDraft.size === 0,
                                              'data-tip': '把勾选的草稿一次性删除',
                                              onClick: (e) => {
                                                e.stopPropagation()
                                                void removePickedDone([...pickedDraft])
                                              },
                                            },
                                            '全部删除',
                                          ),
                                          h(
                                            'button',
                                            {
                                              className: 'plt-btn plt-bulk-promote',
                                              disabled: busy || pickedDraft.size === 0,
                                              'data-tip': '把勾选的草稿一次性转为待执行',
                                              onClick: (e) => {
                                                e.stopPropagation()
                                                void moveToGroup([...pickedDraft], false)
                                              },
                                            },
                                            '转待执行',
                                          ),
                                        )
                                      : null,
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
                              'aria-label': '拆解模式（叠加开关，可与其他任务类型同时生效）',
                              'data-tip': splitMode
                                ? `拆解模式已开启：发送时按项目情况自动拆成多条，落在「${draftMode ? '草稿' : '待执行'}」（点击关闭）`
                                : `开启拆解模式：发送时按项目情况把这段话拆成几条${draftMode ? '草稿' : '待执行任务'}`,
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
                  // 深入开关（在草稿开关左侧，同款圆形造型）：默认不选中；
                  // 点亮后「发送」会把输入框里的任务改写为「要求做深」的提示词。
                  // id=262：草稿模式下深入本来就不生效（草稿只存原话），以前按钮照样能点、
                  // tip 照样承诺「会改写」，用户点了却发现什么都没变。现在直接置灰并说明原因。
                  h(
                    'button',
                    {
                      type: 'button',
                      className: `plt-deep-toggle${deepMode ? ' on' : ''}`,
                      disabled: busy || draftMode,
                      'aria-pressed': deepMode ? 'true' : 'false',
                      'aria-disabled': draftMode ? 'true' : undefined,
                      'data-tip': draftMode
                        ? '草稿模式只存原话、不改写提示词，先关掉草稿才能用深入模式'
                        : deepMode
                          ? splitMode
                            ? '深入模式已开启：拆解时要求把每一条子任务都做深（点击关闭）'
                            : '深入模式已开启：发送时会改写提示词，要求把任务做深（点击关闭）'
                          : splitMode
                            ? '开启深入模式：拆解时要求把每一条子任务都做深'
                            : '开启深入模式：发送时自动把任务改写成「做深而不是做大」的提示词',
                      'aria-label': '深入模式',
                      onClick: () => setDeepMode(!deepMode),
                    },
                    h(DeepIcon, { size: 15 }),
                  ),
                  // 草稿开关（id=106：放在发送按钮左侧，发送键同款圆形造型）：
                  // 平时灰圈不点亮；点亮后「发送」不再进待执行，而是把这条推到「草稿」组。
                  h(
                    'button',
                    {
                      type: 'button',
                      className: `plt-draft-toggle${draftMode ? ' on' : ''}`,
                      disabled: busy,
                      'aria-pressed': draftMode ? 'true' : 'false',
                      'data-tip': draftMode
                        ? '草稿模式已开启：发送将存入「草稿」组（点击关闭）'
                        : '开启草稿模式：发送不再排入待执行，只存进「草稿」组',
                      'aria-label': '草稿模式',
                      onClick: () => setDraftMode(!draftMode),
                    },
                    h(DraftIcon, { size: 15 }),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'plt-send',
                      disabled: busy || splitting,
                      'data-tip': splitting
                        ? '正在拆解，请稍候…'
                        : splitMode
                          ? `拆解成多条，落在「${draftMode ? '草稿' : '待执行'}」（Shift+Enter）`
                          : draftMode
                            ? '存入草稿（Shift+Enter）'
                            : '提交（Shift+Enter）',
                      'aria-label': splitMode ? (draftMode ? '拆解成草稿' : '拆解成待执行') : draftMode ? '存入草稿' : '提交计划',
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
                  h('span', { className: 'plt-split-hint' }, draftMode ? '产物将落在草稿组' : '产物将落在待执行组'),
                ),
              ),
            )
          : null,
      )
    }

    function apply(ctx) {
      // 样式注入（挂到文档头，ctx.effect 负责卸载）。
      ctx.effect(() => {
        const el = document.createElement('style')
        el.setAttribute('data-dsh-plan-tasks', '')
        el.textContent = CSS
        document.head.appendChild(el)
        return () => {
          if (el.parentNode !== null) el.parentNode.removeChild(el)
        }
      }, 'dsh-plan-tasks: styles')

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
