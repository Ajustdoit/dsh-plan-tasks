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
