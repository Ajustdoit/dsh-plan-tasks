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
