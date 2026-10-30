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
/* 开始 / 暂停（id=207）：顶栏里的图标按钮。
   inline-flex + gap 让图标与文字垂直居中并保持固定间距；flex:0 0 auto
   保证顶栏被压窄时这个按钮不参与收缩，压缩全部由 .plt-title 承担。
   id=354：两组类名保留，但同一时刻只会挂上其中一个（由 agentRunning 决定），
   所以下面那套「互斥」的配色实际上永远作用于屏幕上唯一的那颗按钮。
   min-width + 居中（id=354）：这颗按钮的文案会在 开始 / 继续 / 发送中… / 暂停 / 暂停中
   之间换，字数不同。给一个按最长文案（「发送中…」）量的固定宽度，
   换文案时按钮不伸缩，右侧的倒计时也不会跟着左右跳。 */
.plt-start,.plt-pause{display:inline-flex;align-items:center;justify-content:center;gap:5px;flex:0 0 auto;min-width:88px}
/* 开始按钮是这一行里的唯一的主动作，给一点绿色倾向（不是实心，仍然克制），
   让它在中性的「自动刷新」按钮旁边能被一眼找到。 */
.plt-start:not(:disabled){color:var(--dsw-alias-label-primary,#e6e6e6)}
.plt-start:not(:disabled):hover{background:rgba(34,150,84,.14);border-color:rgba(34,150,84,.42)}
/* 暂停是反向动作，hover 透出暖橙，与开始分得开又不至于像报错。 */
.plt-pause:not(:disabled):hover{background:rgba(216,120,32,.12);border-color:rgba(216,120,32,.38)}
/* —— 四个状态的视觉（id=210）——
   未开始 / 执行中 / 已暂停 / 异常，各自由既有的推导变量挂类，不新增状态：
   · .plt-start.is-resume —— 已挂起，这个按钮现在是「继续」，用蓝调与「开始」的绿区分；
   · .plt-pause:not(:disabled) —— 执行中它才是可点的，给琥珀描边说明「现在能停」；
   · :disabled —— 统一压到 .42（.plt-btn 的 .5 在这两个带色按钮上仍然偏亮）；
   · .plt-top.has-error —— 上次操作失败时描红，和顶部的错误提示对上。
   id=354 起屏幕上只有一颗按钮，这些规则按「它此刻是谁」生效，不再需要两颗对齐。 */
.plt-start.is-resume:not(:disabled){color:rgba(120,162,255,.98);border-color:rgba(80,140,255,.46);background:rgba(65,118,230,.12)}
.plt-start.is-resume:not(:disabled):hover{background:rgba(65,118,230,.20);border-color:rgba(80,140,255,.62)}
.plt-pause:not(:disabled){color:rgba(255,190,90,.96);border-color:rgba(255,180,60,.42)}
.plt-start:disabled,.plt-pause:disabled{opacity:.42}
/* 执行中把「暂停」的图标压暗一点点，让文字比图标更先被读到；
   文字保持可读，禁用时不受影响（:not(:disabled) 已经排除）。 */
.plt-pause:not(:disabled) svg{opacity:.92}
.plt-top.has-error .plt-start,.plt-top.has-error .plt-pause{border-color:rgba(214,68,68,.52)}
.plt-top.has-error .plt-start.is-resume:not(:disabled){border-color:rgba(214,68,68,.62)}`)
