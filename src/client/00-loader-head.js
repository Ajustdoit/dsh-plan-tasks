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
    const AUTO_INTERVAL = 5
    const AUTO_INTERVAL_RUNNING = 5
    // 定时器检查粒度（毫秒）。刷新由 deadline 判断、倒计时只是它的展示，
    // 这样定时器抖动 / 页面节流都不会让刷新「卡在 1s 不执行」（旧实现依赖倒计时归零）。
    const AUTO_TICK_MS = 250
    // 顶部行内提示（提交 / 审核 / 删除 / 拖拽保存的结果）的默认停留时长（id=222）。
    // 原来是 2600ms 的裸数字写在 setTimeout 里：短反馈（「顺序已保存」五个字）
    // 刚看清就没了，所以统一抬到 3.8 秒。只控制自动隐藏，不参与动画与刷新计时。
    const NOTICE_MS = 3800
    // 少数提示要更久的阅读时间（id=223）：拆分完成那条会带上「建议砍掉哪些、模型提到了
    // 哪些不存在的文件」这类附加信息，实测能到 79 个字，3.8 秒读不完。只在那个调用处
    // 显式传这个时长，其余提示仍走 NOTICE_MS —— 不整体拉长，短反馈才不会赖着不走。
    const NOTICE_LONG_MS = 5200
    // 待执行里一条都没有时，提交完自动发给模型的开工指令（原样进左侧对话）。
    const KICKOFF_TEXT = '开始干活'
    // 挂起后再点「开始」发的指令（id=209），与首次开工区分开：
    // 首次是「开始干活」（让模型自己去挑第一条），续跑是「继续干活」（接着上次中断处做）。
    const RESUME_TEXT = '继续干活'
    // 会话从「在跑」翻成「停」之后，等多久再回读 plan.json 判定这一轮是不是断了（id=234）。
    // 不能一翻就判：模型收尾时是先写盘、再结束 turn，但客户端拿到的 running=false
    // 经由 remote 事件推过来，可能比文件落盘早一点点。留 1 秒足够覆盖这个窗口，
    // 又不会让用户盯着「执行中」发愣 —— 判完之后界面立刻改口。
    const INTERRUPT_SETTLE_MS = 1000
    // 「发送中…」「暂停中」这类一次点击的标记，最多挂这么久就必须让位（id=235）。
    // 正常回包会在 finally 里立刻清掉，这个上限只兜住「回包丢了 / 请求被吞了」的情况：
    // 标记不放手，顶栏会一直显示那句文案，而模型其实早就在干活（或早就停了）。
    // 比请求超时（call 默认 120s）短得多 —— 卡住时宁可先让界面回到「干活中 / 空闲」。
    const ACTION_STALL_MS = 15000

    /** 图标底色：稳定的品牌蓝。取 static 层 token，主题包不会改写它。 */
    const ICON_BLUE = 'var(--dsw-static-deepseek-500, #4176e6)'
