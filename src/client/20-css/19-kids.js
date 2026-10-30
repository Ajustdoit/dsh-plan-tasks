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
