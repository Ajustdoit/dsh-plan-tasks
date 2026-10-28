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

    /** 执行中用的转转圈图标：一段圆弧匀速旋转，比文字更直观。 */
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
          className: 'plt-spin',
          style: { display: 'block', flex: '0 0 auto' },
        },
        h('path', { d: 'M12 3.2a8.8 8.8 0 1 1-8.8 8.8', opacity: 0.95 }),
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
     * 顶部栏与通用按钮：面板根、标题、刷新/自动刷新/重启按钮。
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
.plt-top{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,.08))}
.plt-title{font-weight:600;font-size:19px;letter-spacing:.01em;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.plt-btn{cursor:pointer;border:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,.14));background:transparent;color:inherit;border-radius:6px;padding:3px 9px;font-size:14px;line-height:20px;white-space:nowrap}
.plt-btn:hover:not(:disabled){background:var(--dsw-alias-bg-hover,rgba(255,255,255,.06))}
.plt-btn:disabled{opacity:.5;cursor:default}
.plt-btn.primary{background:var(--dsw-alias-bg-accent,#2f6fd0);border-color:transparent;color:#fff}
.plt-auto{display:inline-flex;align-items:center;gap:6px;min-width:62px;justify-content:center;font-variant-numeric:tabular-nums}
.plt-auto .plt-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-caption,#8a8a8a);flex:0 0 auto}
.plt-auto.on{color:var(--dsw-alias-label-accent,#7fb0ff);border-color:rgba(80,140,255,.45)}
.plt-auto.on .plt-dot{background:#4caf50;box-shadow:0 0 0 2px rgba(76,175,80,.18)}
/* 重启按钮：幽灵按钮，只在 hover 时透出一点暖色，避免和「刷新」抢注意力。 */
.plt-restart{display:inline-flex;align-items:center;gap:5px}
.plt-restart:hover:not(:disabled){background:rgba(236,72,153,.10);border-color:rgba(236,72,153,.34)}
.plt-restart-tip{color:var(--dsw-alias-label-caption,#9a9a9a);font-size:13px}`)

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
  display:flex;align-items:center;gap:9px;
  max-width:min(80%,250px);
  padding:11px 15px;
  border-radius:12px;
  border:1px solid rgba(255,255,255,.16);
  background:rgba(30,34,42,.96);
  box-shadow:0 12px 30px rgba(0,0,0,.38);
  color:#f2f4f7;font-size:13.5px;line-height:1.5;
  pointer-events:auto;
  animation:plt-split-in .22s cubic-bezier(.22,.9,.28,1) both;
}
.plt-split-card .plt-split-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.plt-split-card .plt-split-text strong{font-weight:600}
.plt-split-card .plt-split-hint{color:rgba(232,238,247,.62);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
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
.plt-group-count{flex:0 0 auto;font-size:12.5px;line-height:18px;padding:0 7px;border-radius:999px;background:var(--dsw-alias-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-caption,#9a9a9a)}
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
.plt-group-todo .plt-group-count{background:rgba(236,72,153,.14);color:#f0a6c6;border-color:rgba(236,72,153,.3)}

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
/* 执行中：转圈图标匀速旋转，作为「还在跑」的活信号（减少动态偏好下停转）。 */
.plt-spin{animation:plt-spin .9s linear infinite;transform-origin:50% 50%}
@keyframes plt-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.plt-spin{animation:none}}
.plt-tag.todo{background:rgba(140,140,140,.16);color:var(--dsw-alias-label-caption,#9a9a9a);border-color:rgba(140,140,140,.3)}
.plt-tag.type{background:transparent;color:var(--dsw-alias-label-caption,#9a9a9a);border-color:var(--dsw-alias-border-secondary,rgba(255,255,255,.14))}
/* 置顶按钮：平时淡到几乎看不见，鼠标移到这一行才亮起来，不抢标题的宽度。 */
.plt-pin{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;margin-left:-2px;border-radius:6px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-caption,#8a8a8a);opacity:0;cursor:pointer;transition:opacity .14s ease,background .14s ease,border-color .14s ease,color .14s ease}
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
  --dsw-alias-bg-hover:rgba(38,49,72,.06);
  --dsw-alias-bg-accent:#2f6fd0;
  --dsw-alias-border-secondary:rgba(0,0,0,.11);
  --dsw-alias-border-accent:rgba(47,111,208,.55);
  --dsw-alias-label-accent:#1f6fd0;
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
body:not([data-ds-dark-theme]) .plt-group-unreviewed{--plt-accent:176,124,10}
body:not([data-ds-dark-theme]) .plt-group-todo{--plt-accent:31,111,208}
/* 草稿组：浅色下用深一点的绿，浅底上才看得见。 */
body:not([data-ds-dark-theme]) .plt-group-draft{--plt-accent:22,140,74}
body:not([data-ds-dark-theme]) .plt-group-draft .plt-tag.draft{background:rgba(22,140,74,.10);color:#177a41;border-color:rgba(22,140,74,.3)}
body:not([data-ds-dark-theme]) .plt-group-draft .plt-tag.type{color:rgba(22,140,74,.8);border-color:rgba(22,140,74,.26)}
body:not([data-ds-dark-theme]) .plt-tag.draft{background:rgba(22,140,74,.10);color:#177a41;border-color:rgba(22,140,74,.3)}
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
body:not([data-ds-dark-theme]) .plt-top{border-bottom-color:var(--dsw-alias-border-l2,rgba(0,0,0,.10))}
body:not([data-ds-dark-theme]) .plt-btn{border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.10))}
body:not([data-ds-dark-theme]) .plt-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
body:not([data-ds-dark-theme]) .plt-notice{background:rgba(34,150,70,.10);border-color:rgba(34,150,70,.26);color:#1c7c3e}
body:not([data-ds-dark-theme]) .plt-auto.on{color:var(--dsw-alias-state-business-primary,#1f6fd0);border-color:rgba(47,111,208,.4)}

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
  border-color:rgba(20,40,70,.14);
  /* 浅色下不要内阴影：白卡上叠 inset 会脏成一圈灰，只留向外的柔和投影（中性灰）。 */
  box-shadow:0 1px 2px rgba(0,0,0,.05),0 8px 18px -10px rgba(0,0,0,.14),0 22px 42px -24px rgba(0,0,0,.12);
}
body:not([data-ds-dark-theme]) .plt-composer:hover{border-color:rgba(20,40,70,.22);box-shadow:0 1px 2px rgba(0,0,0,.07),0 12px 24px -10px rgba(0,0,0,.17),0 28px 50px -26px rgba(0,0,0,.14)}
body:not([data-ds-dark-theme]) .plt-composer:focus-within{border-color:var(--dsw-alias-border-accent,#2f6fd0);box-shadow:0 1px 2px rgba(0,0,0,.05),0 16px 30px -10px rgba(0,0,0,.15),0 34px 60px -28px rgba(0,0,0,.12),0 0 0 3px rgba(20,40,70,.10)}
/* 聚焦时的顶部渐隐原本是蓝色光带，浅色下换成中性的白→透明，只做「顶面被照亮」的暗示。 */
body:not([data-ds-dark-theme]) .plt-composer::before{background:linear-gradient(180deg,rgba(255,255,255,.9),rgba(255,255,255,0) 52%)}
body:not([data-ds-dark-theme]) .plt-composer .plt-input::placeholder{color:var(--dsw-alias-label-tertiary,#98a1ad)}
body:not([data-ds-dark-theme]) .plt-composer .plt-chip{background:rgba(15,30,60,.05);border-color:rgba(15,30,60,.07);color:var(--dsw-alias-label-secondary,#4a5563)}
body:not([data-ds-dark-theme]) .plt-composer .plt-chip:hover:not(:disabled){background:rgba(15,30,60,.09);color:var(--dsw-alias-label-primary,#1f2328)}
/* 选中态：浅色下直接给实心品牌蓝底 + 白字白图标（原来是淡蓝底 + 蓝字，
   放在浅色卡片上对比太弱，看不出「已经被选中」）。 */
body:not([data-ds-dark-theme]) .plt-chip.active{background:#1f6fd0;border-color:#1a60b6;color:#fff;box-shadow:0 1px 3px rgba(20,60,120,.28),0 0 0 1px rgba(31,111,208,.18)}
body:not([data-ds-dark-theme]) .plt-chip.active:hover:not(:disabled){background:#2477d8;border-color:#1f6fd0;color:#fff}
body:not([data-ds-dark-theme]) .plt-chip.active svg{opacity:1}
/* 连接符：浅色下 label-caption 是 #adb2b8，白底上小符号几乎看不见，压深一档。 */
body:not([data-ds-dark-theme]) .plt-op{color:#59606c;opacity:.75}

/* —— 分组卡片：黑投影换成偏蓝的淡投影 —— */
/* 组头是 sticky 的，浅色下面板底色是白的，半透明会让滚动的内容透上来，压成接近实白。 */
body:not([data-ds-dark-theme]) .plt-group-h{background:rgba(250,252,255,.94);border-color:rgba(20,40,70,.10)}
body:not([data-ds-dark-theme]) .plt-group-h:hover{background:rgba(242,246,252,.96)}
body:not([data-ds-dark-theme]) .plt-group-reviewed,
body:not([data-ds-dark-theme]) .plt-group-unreviewed,
body:not([data-ds-dark-theme]) .plt-group-todo{box-shadow:0 1px 2px rgba(16,32,64,.05),0 6px 16px -12px rgba(16,36,72,.22)}
body:not([data-ds-dark-theme]) .plt-group-reviewed:hover,
body:not([data-ds-dark-theme]) .plt-group-unreviewed:hover,
body:not([data-ds-dark-theme]) .plt-group-todo:hover{box-shadow:0 1px 3px rgba(16,32,64,.07),0 10px 22px -14px rgba(16,36,72,.26),0 0 18px -12px rgba(var(--plt-accent),.5)}
body:not([data-ds-dark-theme]) .plt-group.open{box-shadow:0 2px 4px rgba(16,32,64,.07),0 16px 34px -18px rgba(16,36,72,.26),0 0 0 1px rgba(var(--plt-accent),.12)}

/* —— 条目底色：白色半透明 → 极淡的深色，浅底下才看得见边界 —— */
body:not([data-ds-dark-theme]) .plt-item{background:var(--dsw-alias-bg-primary,#fff)}
body:not([data-ds-dark-theme]) .plt-group-body .plt-item{background:rgba(var(--plt-accent),.055)}

/* —— 文字在浅底上要压深，不能沿用深色主题的「提亮」 —— */
body:not([data-ds-dark-theme]) .plt-head:hover .plt-name{color:var(--dsw-alias-label-primary,#141a22)}
body:not([data-ds-dark-theme]) .plt-tag.running{background:rgba(34,150,84,.10);color:#1c7c3e;border-color:rgba(34,150,84,.32)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-tag.todo{background:rgba(31,111,208,.08);color:#1a60b6;border-color:rgba(31,111,208,.26)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-tag.type{color:rgba(23,83,158,.86);border-color:rgba(31,111,208,.26)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-item.running .plt-name{color:#17539e;font-weight:600}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-item.running .plt-tag.running{background:rgba(31,111,208,.12);color:#17539e;border-color:rgba(31,111,208,.36)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-item.running .plt-tag.todo{background:rgba(31,111,208,.08);color:#1a60b6;border-color:rgba(31,111,208,.26)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-group-count{background:rgba(31,111,208,.10);color:#1a60b6;border-color:rgba(31,111,208,.26)}
body:not([data-ds-dark-theme]) .plt-tag.reviewed{background:rgba(120,130,145,.12);color:#5b6472;border-color:rgba(120,130,145,.32)}
body:not([data-ds-dark-theme]) .plt-tag.unreviewed{background:rgba(200,140,20,.12);color:#a07000;border-color:rgba(200,140,20,.34)}
body:not([data-ds-dark-theme]) .plt-tag.todo{background:rgba(120,130,145,.12);color:#5b6472;border-color:rgba(120,130,145,.3)}
body:not([data-ds-dark-theme]) .plt-copy-btn:hover{background:rgba(var(--plt-accent),.12);border-color:rgba(var(--plt-accent),.5);color:var(--dsw-alias-label-primary,#141a22)}
body:not([data-ds-dark-theme]) .plt-copy-btn.done{background:rgba(34,150,70,.12);border-color:rgba(34,150,70,.45);color:#1c7c3e}

/* —— 正在执行：浅底上把强度压到一半，绿色内阴影才不会糊成一块绿 —— */
body:not([data-ds-dark-theme]) .plt-item.running{border-color:rgba(31,111,208,.28)}
body:not([data-ds-dark-theme]) .plt-item.running::after{box-shadow:inset 0 0 20px -10px rgba(31,111,208,.24)}
body:not([data-ds-dark-theme]) .plt-group-body .plt-item.running{border-color:rgba(31,111,208,.3);box-shadow:inset 0 0 20px -10px rgba(31,111,208,.26)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-item.running{border-color:rgba(31,111,208,.36);background:rgba(31,111,208,.05);box-shadow:inset 0 0 0 1px rgba(31,111,208,.12),inset 0 0 22px -10px rgba(31,111,208,.30)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-item.running::after{box-shadow:inset 0 0 22px -10px rgba(31,111,208,.28),inset 0 0 0 1px rgba(31,111,208,.1);background:linear-gradient(100deg,transparent 20%,rgba(255,255,255,.5) 45%,rgba(255,255,255,.75) 50%,rgba(255,255,255,.5) 55%,transparent 80%);background-size:220% 100%;background-repeat:no-repeat}

/* —— 详情区：代码块 / 备注 在浅底下改用更淡的着色 —— */
body:not([data-ds-dark-theme]) .plt-plan{background:var(--dsw-alias-bg-tertiary,#f4f6f9)}
body:not([data-ds-dark-theme]) .plt-group-body .plt-plan{background:rgba(var(--plt-accent),.06);border-color:rgba(var(--plt-accent),.16)}
body:not([data-ds-dark-theme]) .plt-group-body .plt-note{background:rgba(var(--plt-accent),.045);border-left-color:rgba(var(--plt-accent),.5)}
body:not([data-ds-dark-theme]) .plt-note{border-left-color:var(--dsw-alias-border-accent,#2f6fd0)}
body:not([data-ds-dark-theme]) .plt-source{color:#4a5261;background:rgba(96,106,122,.05);border-color:rgba(96,106,122,.26)}
body:not([data-ds-dark-theme]) .plt-del{color:#c0392b;border-color:rgba(192,57,43,.32)}
/* 「审核通过」的浅色特化随 id=193 一起消失：现在它就是 .plt-copy-btn，
 * 已有 body:not([data-ds-dark-theme]) .plt-copy-btn:hover / .done 两条覆盖接管，不需要额外的。 */
body:not([data-ds-dark-theme]) .plt-err{background:rgba(192,57,43,.08);border-color:rgba(192,57,43,.3);color:#a93226}
body:not([data-ds-dark-theme]) .plt-input{background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-label-primary,#141a22);border-color:rgba(20,40,70,.16)}
/* 草稿编辑框在浅底下：白底 + 绿色描边，聚焦时描边加深并带一圈淡绿光。 */
body:not([data-ds-dark-theme]) .plt-edit-box .plt-edit-input{background:#fff;border-color:rgba(var(--plt-accent),.4);box-shadow:inset 0 1px 2px rgba(20,40,70,.05);color:#141a22}
body:not([data-ds-dark-theme]) .plt-edit-box .plt-edit-input:hover{border-color:rgba(var(--plt-accent),.58)}
body:not([data-ds-dark-theme]) .plt-save-state{color:#59606c}
body:not([data-ds-dark-theme]) .plt-save-state.pending,body:not([data-ds-dark-theme]) .plt-save-state.saving,body:not([data-ds-dark-theme]) .plt-save-state.saved{color:rgba(var(--plt-accent),.95)}
body:not([data-ds-dark-theme]) .plt-save-state.error{color:#c2410c}
body:not([data-ds-dark-theme]) .plt-edit-box .plt-edit-input:focus,body:not([data-ds-dark-theme]) .plt-edit-box .plt-edit-input:focus-visible{border-color:rgba(var(--plt-accent),.85);box-shadow:0 0 0 3px rgba(var(--plt-accent),.14),inset 0 1px 2px rgba(20,40,70,.05)}
body:not([data-ds-dark-theme]) .plt-dialog{background:var(--dsw-alias-bg-primary,#fff);box-shadow:0 12px 32px rgba(16,32,64,.18)}
body:not([data-ds-dark-theme]) .plt-mask{background:rgba(20,32,56,.28)}

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
/* 上限下拉（id=190）：浅色下白底，深色那条 #1c1f24 的 option 底色要翻回来；
   箭头的 data-uri 是写死的中灰，浅色下偏淡，换一版深灰的图。
   底色仍走组自身的 --plt-accent（浅色档已审核是 96,106,122），只把透明度提一档，
   免得在白底上几乎看不见这个控件。 */
body:not([data-ds-dark-theme]) .plt-limit{border-color:rgba(96,106,122,.34);background-color:rgba(96,106,122,.1);background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5L6 8l3.5-3.5' fill='none' stroke='%2359606c' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");color:#3c434e}
body:not([data-ds-dark-theme]) .plt-limit:hover:not(:disabled){border-color:rgba(96,106,122,.5);background-color:rgba(96,106,122,.16)}
body:not([data-ds-dark-theme]) .plt-limit option{background:#ffffff;color:#2b3240}
body:not([data-ds-dark-theme]) .plt-foot{color:#6a7280;opacity:1}
body:not([data-ds-dark-theme]) .plt-empty{color:#59606c}
/* 空组提示：深色下靠 opacity:.8 压暗，浅色下会直接糊掉，改成实色 + 图标稍亮。 */
body:not([data-ds-dark-theme]) .plt-group-empty{color:#59606c;opacity:1}
body:not([data-ds-dark-theme]) .plt-group-empty svg{opacity:.75}
body:not([data-ds-dark-theme]) .plt-caret,body:not([data-ds-dark-theme]) .plt-grip{color:#7b828d}
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
body:not([data-ds-dark-theme]) .plt-split-mask{background:rgba(20,40,70,.22)}
body:not([data-ds-dark-theme]) .plt-split-card{
  border:1px solid rgba(24,44,74,.14);
  background:#ffffff;
  box-shadow:0 12px 30px rgba(16,32,64,.18);
  color:#20293a;
}
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
      const parts = items.map(
        (it) =>
          `${it.id}|${it.order}|${it.execute === true ? 1 : 0}|${it.review === true ? 1 : 0}|${it.draft === true ? 1 : 0}|${it.startedAt ?? ''}|${it.noteLen ?? ''}|${it.planLen ?? ''}|${it.time ?? 0}|${it.name ?? ''}`,
      )
      return `${data.planExists === true ? 1 : 0}|${data.broken === true ? 1 : 0}|s${data.settings?.reviewedLimit ?? ''}|${parts.join(';')}`
    }

    function fmtTime(ms) {
      const n = Number(ms)
      if (!Number.isFinite(n) || n <= 0) return ''
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
      const n = Number(ms)
      if (!Number.isFinite(n) || n <= 0) return ''
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
      if (item.draft === true) return { key: 'draft', label: '草稿' }
      if (item.execute === true) {
        return item.review === true
          ? { key: 'reviewed', label: '已审核' }
          : { key: 'unreviewed', label: '待审核' }
      }
      if (typeof item.startedAt === 'string' && item.startedAt !== '') return { key: 'running', label: '执行中' }
      // 模型刚开始干活、还没来得及把 startedAt 写进 plan.json 的这一小段：
      // 会话已经是 running 了，就把排在最前面的那条待执行按「执行中」显示，
      // 否则界面上会出现「AI 明明在跑，待执行里每条都写着待执行」的错位。
      if (impliedRunning) return { key: 'running', label: '执行中' }
      return { key: 'todo', label: '待执行' }
    }

    /** 任务类型 → 提交时自动加在提示词前面的前缀。 */
    function typePrefix(type) {
      if (type === '仅回答') return '仅回答：'
      if (type === '目标') return '/目标 '
      return ''
    }

    /**
     * 深入模式：把用户随手写的一行任务改写成一段「要求做深、不许做大」的提示词。
     * 原文放在最上面（模型第一眼要看到用户到底要什么），后面追加四问 + 重写要求。
     * 换行用 \n 拼接，避免缩进把多行模板带歪。
     */
    function deepPrompt(task) {
      const body = String(task ?? '').trim()
      return [
        `当前任务：${body}`,
        '',
        '我想让这项任务做得更深入，而不是把规模做得更大。在重写任务之前，请先：',
        '1. 说明这个领域的顶尖专业人士在这里会做哪些我没有要求的事',
        '2. 指出他们会从哪些最原始的材料入手，而不是从已经替我加工整理过的信息入手',
        '3. 列出他们会使用的具体方法和工具',
        '4. 说明除了你或我之外，还有什么能够证明结果是正确的',
        '',
        '然后重写我的提示词，明确要求完成上述这些事。',
      ].join('\n')
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

    function Item(props) {
      const { item, open, detail, onToggle, onPatch, onRemove, onFetchDetail, busy, dragging, dropTarget, onDragStart, onDragOver, onDrop, onDragEnd, dragEnabled, selectable, selected, onSelect, showExecute, showReview, groupKey, impliedRunning, canPin, onPinTop, onPromote, onDemote, canDemote, editable } = props
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
      const canCopyPlan = true
      const canCopyId = true
      // 「复制提示词」只给待执行及之后的真实任务卡（草稿还没有出处，不给）；
      // 没有原始提示词的条目（手工提交的）直接不渲染按钮，而不是给一个点了没反应的空壳。
      const canCopyPrompt = groupKey !== 'draft' && (item.sourcePromptLen ?? 0) > 0
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
        let source = loaded !== null && typeof loaded.sourcePrompt === 'string' ? loaded.sourcePrompt : ''
        if (source === '' && (item.sourcePromptLen ?? 0) > 0) {
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
          className: `plt-item${open ? ' open' : ''}${running ? ' running' : ''}${dragging ? ' dragging' : ''}${dropTarget ? ' drop-target' : ''}${props.sublime === true ? ' plt-sublime' : ''}`,
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
                  title: '按住拖拽可调整顺序（执行顺序也跟着变）',
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
                  title: selected === true ? '取消选择这一条' : '选中这一条，稍后批量处理',
                  onChange: (e) => onSelect(e.target.checked),
                }),
              )
            : null,
          h('span', { className: 'plt-caret' }, h(CaretIcon, { size: 13 })),
          // 编号单独占一个窄标签，标题就能把剩下的宽度全用上。
          h('span', { className: 'plt-id' }, `#${item.id}`),
          h('span', { className: 'plt-name', title: `#${item.id} ${item.name}\n\n${planText}` }, item.name),
          // id=178/179：待审核的每一项在标题右侧挂耗时，扫一眼就知道这条跑了多久，
          // 不用展开。必须是 .plt-name 的**兄弟**节点——塞进标题里会跟着一起被
          // ellipsis 截掉，还会污染 title 的全文悬浮。
          // id=183：已审核组同样挂耗时。两边走的是**同一个** fmtDur、同一个 .plt-dur
          // 节点、同一份样式，只是组白名单多一项——不复制第二份格式化实现，
          // 这样「6分钟28秒」在两处永远长得一样。空串（缺失/0/非法）时整节点缺席。
          (groupKey === 'unreviewed' || groupKey === 'reviewed') && durText !== ''
            ? h('span', { className: 'plt-dur', title: `这条任务耗时 ${durText}` }, durText)
            : null,
          // 类型只用图标表示（和输入栏的胶囊图标一致）：「修改」是默认类型，不显示。
          // 放在状态标签左侧，先看到「这是什么类型的活」，再看到「进行到哪一步」。
          item.taskType === '仅回答' || item.taskType === '目标'
            ? h('span', { className: `plt-tag type plt-type-${item.taskType}`, title: `任务类型：${item.taskType}` }, h(ModeIcon, { kind: item.taskType, size: 13 }))
            : null,
          h(
            'span',
            { className: `plt-tag ${status.key}`, title: status.key === 'running' ? '任务正在执行中' : undefined },
            status.key === 'running' ? h(SpinnerIcon, { size: 12 }) : null,
            h('span', null, status.label),
          ),
          // 置顶：只有「待执行」组给，正在执行的那条不给（它本来就在最上面）。
          pinTop === true
            ? h(
                'button',
                {
                  className: 'plt-pin',
                  title: '置顶：排到待执行的第一位（执行中那条之后）',
                  onClick: (e) => {
                    e.stopPropagation()
                    onPinTop()
                  },
                },
                h(PinTopIcon, { size: 12 }),
              )
            : null,
        ),
        open
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
                            title: editing ? '收起编辑框' : '直接编辑这条草稿的内容',
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
                            title: `复制这条计划的 ID（${item.id}）`,
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
                            title: '复制这条计划的完整内容',
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
                            title: `复制这条任务的原始提示词（${item.sourcePromptLen} 字）`,
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
                            title: '人工审核这一条的执行结果：标记为已通过',
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
                                title: `任务类型：${type}`,
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
                            title: '放弃这次修改，还原成进入编辑时的内容',
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
              (loaded !== null && typeof loaded.sourcePrompt === 'string' && loaded.sourcePrompt !== '')
                ? h(
                    'div',
                    { className: 'plt-sec' },
                    h(
                      'button',
                      {
                        className: `plt-sec-toggle${sourceOpen ? ' open' : ''}`,
                        type: 'button',
                        'aria-expanded': sourceOpen === true,
                        title: sourceOpen ? '收起原始提示词' : `展开原始提示词（${item.sourcePromptLen ?? loaded.sourcePrompt.length} 字）`,
                        onClick: (e) => {
                          e.stopPropagation()
                          setSourceOpen((v) => v !== true)
                        },
                      },
                      h(
                        'span',
                        { className: 'plt-sec-h' },
                        '原始提示词',
                        h('span', { className: 'plt-sec-hint' }, `${item.sourcePromptLen ?? loaded.sourcePrompt.length} 字`),
                      ),
                      h('span', { className: 'plt-sec-caret' }, h(CaretIcon, { size: 12 })),
                    ),
                    sourceOpen ? h('div', { className: 'plt-source' }, loaded.sourcePrompt) : null,
                  )
                : (loaded === null && (item.sourcePromptLen ?? 0) > 0)
                  ? h('div', { className: 'plt-sec' }, h('div', { className: 'plt-sec-h' }, '原始提示词'), h('div', { className: 'plt-source' }, '（原始提示词加载中…）'))
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
                      { className: 'plt-check locked', title: '「已执行」由模型在执行完成后自动回填，不能手动修改' },
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
                          title: '转为待执行：退出草稿，排进执行队列',
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
                          title: '转为草稿：退出执行队列，存进草稿组',
                          onClick: (e) => {
                            e.stopPropagation()
                            onDemote()
                          },
                        },
                        '转为草稿',
                      )
                    : null,
                  // 执行中的条目整排操作都不给：转草稿/删除直接隐藏，不留灰按钮。
                  running
                    ? null
                    : h(
                        'button',
                        {
                          className: 'plt-btn plt-del',
                          disabled: busy,
                          title: '删除这条计划',
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
      const [notice, setNotice] = React.useState('')
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
      // 重启中：整个面板盖一层，等宿主把新进程拉起来后自动刷新页面。
      const [restarting, setRestarting] = React.useState(false)
      const [restartTip, setRestartTip] = React.useState('')
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
          (it) => it.execute !== true && it.draft !== true && (typeof it.startedAt !== 'string' || it.startedAt === ''),
        )
        return first === undefined ? null : first.id
      })()

      // 「正在执行几条」的唯一口径：和列表里那些显示成「执行中」标签的条目逐条对齐。
      // 之前这里只数「有 startedAt 的待执行」，而界面上还会把排在最前面的那条
      // 还没写 startedAt 的待执行也显示成「执行中」（impliedRunning），
      // 于是会话在跑、模型还没回填的那几秒，上方写 0 条、下面却有一条「执行中」。
      // 现在统一交给 statusOf，两边不可能再对不上。
      const runningCount = items.filter((it) => statusOf(it, impliedRunningId === it.id).key === 'running').length

      // 是否有任务正在执行：会话 running（最权威）+ plan.json 的 startedAt + 刚点按钮那一小段。
      const working = agentRunning || runningCount > 0 || starting

      // 自动刷新：按「截止时间」驱动，倒计时只是展示。
      // 旧实现用「倒计时归零」来触发刷新，setInterval 抖动时 left 会停在 1 不归零，
      // 于是界面卡在 1s、实际不再刷新（执行中把间隔压到 1s 时尤其明显）。
      // 现在每次 tick 直接比较 Date.now() 与 deadline，到点就刷新，与倒计时显示解耦。
      // 有任务正在执行（execute 为 false 且已写 startedAt）时用更短的间隔，尽量跟模型进度同步。
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
      const openStamp = (() => {
        if (openId === null) return ''
        const it = (state.data?.items ?? []).find((x) => x.id === openId)
        return it === undefined ? '' : `${it.id}:${it.planLen ?? 0}:${it.noteLen ?? 0}:${it.time ?? 0}`
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
        // 拆解模式：不落一条，交给宿主按项目实际情况拆成 N 条草稿。
        // 与草稿模式天然一致（产物就是草稿），不与深入模式叠加（改写提示词是另一回事）。
        if (splitMode) {
          await split()
          return
        }
        // 按任务类型自动加前缀：仅回答 → 「仅回答：」，目标 → 「/目标 」，修改 → 不加。
        // 草稿不加前缀 —— 它不进执行队列，前缀只会污染存下来的原文。
        const prefix = draftMode ? '' : typePrefix(form.taskType)
        // 深入模式：先把原文包装成「做深」的提示词，再按任务类型加前缀。
        // 草稿不包装也不加前缀 —— 草稿存的是用户原话，等转正/再编辑时再决定。
        const raw = deepMode && !draftMode ? deepPrompt(form.plan) : form.plan
        const text = raw.trimStart().startsWith(prefix.trim()) || prefix === '' ? raw : `${prefix}${raw}`
        const data = await run(() =>
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
            setNotice(`已拆解 ${count} 条到${where}${tips.length > 0 ? ` · ${tips.join(' · ')}` : ''}`)
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
       * 真正重启 dsh web。
       * 宿主那边的 restart 会先回包、再 spawn 一个游离 launcher、然后自己退出；
       * 这里随后就不停探活，新进程一上线就刷新页面（cookie 由持久密钥签名，重启后仍有效）。
       */
      const doRestart = async () => {
        if (restarting) return
        setRestarting(true)
        setRestartTip('正在请求重启…')
        try {
          await call('restart', { ...payload })
        } catch (error) {
          // 连接在宿主退出瞬间被掐断是正常的：请求可能已经生效，继续探活。
          const message = error instanceof Error ? error.message : String(error)
          if (!/fetch|network|abort|terminated|socket/i.test(message)) {
            setRestarting(false)
            setState((prev) => ({ ...prev, error: `重启失败：${message}` }))
            return
          }
        }
        setRestartTip('服务正在重启，等待新进程上线…')
        const deadline = Date.now() + 90_000
        let tries = 0
        const tickOnce = async () => {
          if (Date.now() > deadline) {
            setRestarting(false)
            setState((prev) => ({ ...prev, error: '服务没有在 90 秒内重新上线，请手动重启 dsh web' }))
            return
          }
          tries += 1
          try {
            const res = await fetch(`${API_BASE}read`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
              body: JSON.stringify({ ...payload, lite: true }),
            })
            const body = await res.json()
            if (body?.ok === true) {
              setRestartTip('已就绪，正在刷新页面…')
              window.location.reload()
              return
            }
          } catch {
            /* 还没起来，继续等 */
          }
          window.setTimeout(tickOnce, 1000)
        }
        // 先等一下再开始探活，否则探到的还是正要退出的旧进程。
        window.setTimeout(tickOnce, 1500)
      }

      /** 手动开工：把「开始干活」真的发进当前会话（左侧对话里能看到），
       * 由模型按 plan-tasks 技能去取待执行计划。 */
      const startWork = async () => {
        if (starting) return
        setStarting(true)
        try {
          let sent = false
          try {
            sent = await kickoffViaClient(ctx, sessionId, KICKOFF_TEXT)
          } catch (error) {
            sent = false
            if (error instanceof Error && error.message !== '') throw error
          }
          if (!sent) await call('kickoff', { ...payload, text: KICKOFF_TEXT })
          setNotice(`已发送「${KICKOFF_TEXT}」`)
        } catch (error) {
          setState((prev) => ({
            ...prev,
            error: `发送「${KICKOFF_TEXT}」失败：${error instanceof Error ? error.message : String(error)}`,
          }))
        } finally {
          setStarting(false)
        }
      }

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
            await call('update', { ...payload, id, patch: draft ? { draft: true } : { draft: false, clearTime: true } })
          }
          // 乐观地把标记先改进本地数据，让条目立刻跳组，避免等 sync 的那一下闪烁。
          setState((prev) => {
            if (prev.data === null) return prev
            const next = (prev.data.items ?? []).map((it) =>
              list.includes(it.id) ? { ...it, draft: draft, ...(draft ? {} : { startedAt: '', time: 0 }) } : it,
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
                ? `已审核通过 #${id}${
                    Number(data?.trimmedCount) > 0 ? ` · 超上限，已清理最旧 ${data.trimmedCount} 条` : ''
                  }`
                : value.review === false
                  ? `已取消审核 #${id}`
                  : typeof value.plan === 'string'
                    ? `已保存草稿 #${id}`
                    : `已更新 #${id}`,
            )
          }
          // 宿主这次顺带裁掉了旧条目：乐观合并只更新了改动的这一条，
          // 被删的那些还留在本地 state 里，会一直显示到下一次轮询（最多 5 秒）。
          // 立刻 sync 一次，别让已经不存在的东西摆在面板上。
          if (Number(data?.trimmedCount) > 0) await sync()
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
       * 「已审核」上限下拉的 change（id=188）。
       *
       * 值只有一个来源——宿主读回的 `data.settings.reviewedLimit`，所以这里不存本地副本：
       * 下拉显示的就是磁盘上的真值，不会出现「界面选了 100、文件里还是 0」的错位。
       *
       * 裁剪本身放在宿主写设置时做（见 #189），不在客户端算：两边各算一遍 FIFO，
       * 一旦排序方向理解不同就会删错条目。这里只负责「写回 + 重读 + 提示」。
       */
      const changeReviewedLimit = async (value) => {
        const next = Number(value)
        await run(async () => {
          const saved = await call('settings', { ...payload, patch: { reviewedLimit: next } })
          const cut = Number(saved?.trimmedCount) || 0
          setNotice(
            cut > 0
              ? `已审核上限 ${next === 0 ? '无限' : next} · 清理最旧 ${cut} 条`
              : `已审核上限：${next === 0 ? '无限' : next}`,
          )
          return call('read', { ...payload, lite: true })
        })
      }

      React.useEffect(() => {
        if (notice === '') return undefined
        const timer = setTimeout(() => setNotice(''), 2600)
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
        { className: 'plt-root', style: { position: 'relative' } },
        h(
          'div',
          { className: 'plt-top' },
          h('span', { className: 'plt-title' }, `任务列表 · ${items.length}`),
          // 提交/审核的提示放在「自动刷新」左侧，不再占用下方空间。
          notice !== '' ? h('span', { className: 'plt-notice' }, notice) : null,
          h(
            'button',
            {
              className: `plt-btn plt-auto${auto ? ' on' : ''}`,
              title: auto ? `自动刷新已开启，${tick} 秒后重新读取 plan.json` : '自动刷新已关闭',
              onClick: () => setAuto((prev) => !prev),
            },
            h(
              'span',
              { className: 'plt-dot', 'aria-hidden': 'true' },
            ),
            h('span', null, auto ? `${tick}s` : '自动'),
          ),
          h(
            'button',
            { className: 'plt-btn', disabled: busy, title: '立即重新读取 plan.json', onClick: refresh },
            '刷新',
          ),
          // 重启：改了宿主代码（lib/index.js）后必须整进程重开才生效，这里一键做完。
          h(
            'button',
            {
              className: 'plt-btn plt-restart',
              disabled: busy || restarting,
              title: '重启 dsh web（改过宿主代码后用），完成后页面会自动刷新',
              onClick: (e) => {
                e.stopPropagation()
                void doRestart()
              },
            },
            restarting ? h(SpinnerIcon, { size: 12 }) : null,
            h('span', null, restarting ? '重启中' : '重启'),
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
                      const doneReviewed = items.filter((it) => it.execute === true && it.review === true && it.draft !== true).slice().reverse()
                      const donePending = items.filter((it) => it.execute === true && it.review !== true && it.draft !== true)
                      // 草稿单独成组（绿色、最靠下、贴着输入框）；没有草稿时整组不显示。
                      const draftList = items.filter((it) => it.draft === true)
                      const todoList = items.filter((it) => it.execute !== true && it.draft !== true)
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
                          // 置顶按钮只出现在待执行组。
                          canPin: groupKey === 'todo',
                          onPinTop: () => void pinTop(item.id),
                          // 草稿组专属：单条「转为待执行」+ 正文可直接编辑。
                          onPromote: () => void moveToGroup([item.id], false),
                          // 待执行里还没开工的才允许退回草稿（执行中不给）。
                          canDemote: groupKey === 'todo' && statusOf(item, impliedRunningId === item.id).key === 'todo',
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
                          onPatch: (value) => patch(item.id, value),
                          onRemove: () => remove(item.id),
                        })
                      }
                      return groups
                        .filter((group) => group.alwaysShow === true || group.list.length > 0)
                        .map((group) => {
                          const isOpen = openGroup === group.key
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
                            { key: group.key, className: `plt-group plt-group-${group.key}${isOpen ? ' open' : ''}` },
                            h(
                              'div',
                              {
                                className: `plt-group-h${isOpen ? ' open' : ''}${isOpen ? '' : arriveGroups.has(group.key) ? ' plt-arrive' : ''}`,
                                onClick: () => setOpenGroup(isOpen ? null : group.key),
                              },
                              h('span', { className: 'plt-caret' }, h(CaretIcon, { size: 13 })),
                              h('span', { className: 'plt-group-name' }, group.title),
                              h('span', { className: 'plt-group-count' }, String(group.list.length)),
                              // 「已审核」上限下拉（id=188）。档位列表由宿主 constants.js 下发，
                              // 这里不抄第二份数组；宿主版本太旧、没有这个字段时整块不渲染，
                              // 避免出现一个点下去只会报错的死控件。
                              group.key === 'reviewed' && Array.isArray(state.data?.reviewedLimits)
                                ? h(
                                    'select',
                                    {
                                      className: 'plt-limit',
                                      value: String(state.data?.settings?.reviewedLimit ?? 0),
                                      disabled: busy,
                                      title: '已审核最多保留多少条；超出按先进先出删掉最旧的，选「无限」不删',
                                      onClick: (e) => e.stopPropagation(),
                                      onChange: (e) => void changeReviewedLimit(e.target.value),
                                    },
                                    state.data.reviewedLimits.map((n) =>
                                      h('option', { key: String(n), value: String(n) }, n === 0 ? '无限' : String(n)),
                                    ),
                                  )
                                : null,
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
                                            { className: 'plt-check', title: allPicked ? '取消全选' : '全选本组全部' },
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
                                              title: '把勾选的计划一次性审核通过',
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
                                            { className: 'plt-check', title: allPickedDone ? '取消全选' : '全选本组全部' },
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
                                              title: '把勾选的已审核计划一次性删除',
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
                                            { className: 'plt-check', title: allPickedDraft ? '取消全选' : '全选本组全部' },
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
                                              title: '把勾选的草稿一次性删除',
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
                                              title: '把勾选的草稿一次性转为待执行',
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
                                              title:
                                                working
                                                  ? '模型正在干活，等它完成再开始下一条'
                                                  : `向左侧会话发送「${KICKOFF_TEXT}」，开始执行待执行里的计划`,
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
                              title: `任务类型：${type}`,
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
                              title: splitMode
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
                  h(
                    'button',
                    {
                      type: 'button',
                      className: `plt-deep-toggle${deepMode ? ' on' : ''}`,
                      disabled: busy,
                      'aria-pressed': deepMode ? 'true' : 'false',
                      title: deepMode
                        ? '深入模式已开启：发送时会改写提示词，要求把任务做深（点击关闭）'
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
                      title: draftMode
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
                      title: splitting
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
            { className: 'plt-foot-text', title: state.data?.planPath ?? '.plan/plan.json' },
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
                h(SpinnerIcon, { size: 15 }),
                h(
                  'span',
                  { className: 'plt-split-text' },
                  h('strong', null, '正在拆解…'),
                  h('span', { className: 'plt-split-hint' }, draftMode ? '产物将落在草稿组' : '产物将落在待执行组'),
                ),
              ),
            )
          : null,
        // 重启罩层：盖住整个面板，防止用户在重启过程中继续点按钮。
        restarting
          ? h(
              'div',
              { className: 'plt-mask' },
              h(
                'div',
                { className: 'plt-dialog', onClick: (e) => e.stopPropagation() },
                h('h3', null, '正在重启 dsh web'),
                h('p', null, restartTip, h('br'), h('span', { className: 'plt-restart-tip' }, '宿主代码改动需要整进程重开才生效，页面会在服务就绪后自动刷新。')),
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
