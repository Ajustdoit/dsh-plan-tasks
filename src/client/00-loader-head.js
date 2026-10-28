/**
 * dsh-plan-tasks — Client 半边
 *
 * 在 dsh-better-sidebar 的右侧栏注册「任务列表」页签，读取项目根目录的
 * `.plan/plan.json` 渲染成互斥手风琴。所有文件读写都走 Host 半边的
 * `/plan-tasks/api/*` 路由（同源 XHR），因此不依赖 better-sidebar 的内部 API。
 *
 * betterSidebar 是可选依赖：绝不能放进 exports.inject，否则未安装它时
 * cordis fiber 会一直 pending（web boot 报 entry did not activate）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plan-tasks',
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
    // 待执行里一条都没有时，提交完自动发给模型的开工指令（原样进左侧对话）。
    const KICKOFF_TEXT = '开始干活'

    /** 图标底色：稳定的品牌蓝。取 static 层 token，主题包不会改写它。 */
    const ICON_BLUE = 'var(--dsw-static-deepseek-500, #4176e6)'
