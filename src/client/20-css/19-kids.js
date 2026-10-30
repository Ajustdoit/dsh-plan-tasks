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
   id=369 起标题比子任务大 1px（15 vs 14）且更重，左侧一道 3px 竖杠把「这是容器」说清楚。
   .plt-head 本来就是 flex，竖杠用 ::before 定宽定位，不参与排版。 */
.plt-item.plt-parent{background:linear-gradient(180deg,rgba(var(--plt-accent,120,168,255),.055),rgba(var(--plt-accent,120,168,255),.012) 42%,transparent 100%)}
.plt-item.plt-parent.open{border-color:rgba(var(--plt-accent,120,168,255),.42)}
.plt-item.plt-parent > .plt-head{position:relative;padding-left:13px}
.plt-item.plt-parent > .plt-head::before{content:'';position:absolute;left:5px;top:9px;bottom:9px;width:3px;border-radius:2px;background:rgba(var(--plt-accent,120,168,255),.55);transition:background .14s ease,box-shadow .16s ease}
.plt-item.plt-parent.open > .plt-head::before{background:rgba(var(--plt-accent,120,168,255),.9);box-shadow:0 0 8px -1px rgba(var(--plt-accent,120,168,255),.55)}
/* id=369：随子任务名一起上调一档（14px → 15px）。
   不是顺手改的：子任务名调大后会正好等于父行原来的 14px，两层标题一样大，
   「父行是容器、子任务在它里面」这个层级就没了 —— 而这是本文件开头第 1 条
   定下的规矩（「父行标题比子任务大一档」）。所以两级一起抬，相对差保持 1px。 */
.plt-item.plt-parent > .plt-head .plt-name{font-size:15px;font-weight:600;letter-spacing:.005em}
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
/* id=370：卡片改成 flex 纵向 + gap，三块（名称行 / 内容 / 备注）的间距由这一个
   gap 统一给，不再各块自带 margin-top。
   为什么换成 gap 而不是把 margin 调大：用 margin 时「有没有下一块」决定了间距，
   最后一块永远多留一段空气；而 gap 只画在**相邻两块之间**，缺块就自然没有间距 ——
   备注为空（节点根本不渲染）时不可能残留空白，这是结构保证，不靠再去补一条
   :last-child 规则抵消。
   gap 取 5px：原先是各 3px 的 margin，视觉上偏挤（两段正文几乎贴在一起）。
   行高（plan 1.6 / note 1.55）与换行（pre-wrap + break-word）一个字没动 ——
   这一条只动块与块之间的间距。 */
.plt-kid{display:flex;flex-direction:column;gap:5px;position:relative;border:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,.07));border-radius:7px;background:var(--dsw-alias-bg-secondary,rgba(255,255,255,.02));padding:7px 9px}
/* 横钩从左缘连接线（2px 宽 + 12px 内距 = 14px）一路画到卡片左边，两头都接上。 */
.plt-kid::before{content:'';position:absolute;left:-14px;top:13px;width:14px;height:2px;border-radius:1px;background:rgba(var(--plt-accent,120,168,255),.30)}
.plt-kid:hover{border-color:rgba(var(--plt-accent,120,168,255),.28);background:var(--dsw-alias-bg-secondary,rgba(255,255,255,.035))}
.plt-kid:hover::before{background:rgba(var(--plt-accent,120,168,255),.6)}
.plt-kid.running{border-color:rgba(236,72,153,.3)}
.plt-kid.running::before{background:rgba(236,72,153,.55)}
/* id=362：这一行改成**基线对齐**，并且明确禁止换行。
   原来是 align-items:center —— 对纯文字够用，但编号胶囊（11px/16px 行高）
   和标题（13px/1.5）字号行高都不同，居中对齐会让两者的字脚差 1~2px；
   一列扫下来编号像「浮」在标题左边。基线对齐后 2-A 与标题的第一个字
   踩在同一条线上，读起来才是一个整体。
   flex-wrap:nowrap 是显式写出来的（flex 默认就是 nowrap）：
   这一行的规矩是「标题可以让位，标签不许掉行」，写出来免得后来的人改成 wrap。
   注意：一旦改成 baseline，就不要再给子项写 vertical-align —— 那是行内排版的东西，
   flex 子项不认。 */
.plt-kid-h{display:flex;align-items:baseline;flex-wrap:nowrap;gap:6px;min-width:0}
/* 基线对齐只对**文字**成立。下面这几类不是文字、或者内部已经自己居中，
   让它们参与基线会被按「最后一行文字的基线」摆位置，视觉上会整体上浮：
   对勾方框、类型图标胶囊、按钮、以及裸 svg（转圈）。
   统一钉回 center，保持它们在 id=361 之前的样子。
   选择器都用直接子元素（>）：类型图标和「通过」按钮只挂在行首这一层。 */
.plt-kid-h > .plt-kid-check,.plt-kid-h > .plt-tag,.plt-kid-h > .plt-copy-btn,.plt-kid-h > svg{align-self:center}
/* id=322 立的规矩：children 行不再画顶层那套 #id（.plt-id）。
   但「不画编号」被推到了反面——子任务在展开区里排成一片，用户没法把
   「刚才那条 2-A」对上界面上的某一行。id=361 把它加回来，形状与顶层那枚不同：
   顶层是 #12 的裸文本，这里是一枚窄胶囊，因为它要在一行里跟标题抢宽度。
   位置：对勾之后、标题之前；所有状态都画（编号是身份，不是状态）。
   flex:0 0 auto + tabular-nums：宽度只随位数变化（2-A / 12-AA），
   同一批里各行的数字位数一致，纵向扫下来编号列是齐的。
   code 为空时 JS 直接不渲染这个节点（不是 visibility:hidden），
   所以这里不需要「占位」规则——手工新建的条目本来就没有编号可对齐。 */
/* id=362：宽度不够时的让位顺序，靠 flex 的伸缩比写死在两处（这里与 .plt-kid-name）：
   本标签 flex-shrink:0 → 一像素都不让，永远完整可读；
   标题 flex-shrink:1 + min-width:0 → 由它独自吃掉全部压缩，最后以省略号收尾。
   所以窄侧栏里看到的是「2-A 完整 + 标题变短」，不会是「标签被压成 2…」。 */
.plt-kid-code{flex:0 0 auto;font-size:11px;line-height:16px;padding:0 5px;border-radius:5px;font-variant-numeric:tabular-nums;letter-spacing:.01em;color:rgba(var(--plt-accent,120,168,255),.95);background:rgba(var(--plt-accent,120,168,255),.13);border:1px solid rgba(var(--plt-accent,120,168,255),.26);white-space:nowrap}
/* 已做的行：编号跟着整卡一起沉下去，但不能消失——回看历史时更需要编号定位。 */
.plt-kid-done .plt-kid-code{color:var(--dsw-alias-label-caption,#8a8a8a);background:rgba(var(--plt-accent,120,168,255),.07);border-color:rgba(var(--plt-accent,120,168,255),.16)}
/* id=362：标题是**唯一**可压缩项。min-width:0 必须留着 —— flex 子项默认
   min-width:auto（= 内容宽度），没有它这一行根本缩不进去，省略号永远不出现。
   注意本层**故意不写 overflow:hidden**（id=362 的第二个修正）：带 overflow:hidden
   的 flex 项在 baseline 对齐里没有文字基线，会退化成「按底边对齐」，
   于是编号胶囊会被拉到标题的底边 —— 那正是要避免的错位。
   截断交给下面那层内层块，本层只负责「我是可伸缩的 flex 项」。 */
/* id=369：子任务名 13px → 14px（调大一档）。
   为什么只动字号、别的一律不碰：字重 600、颜色（label-primary / 已做行的
   label-secondary）、换行与截断三件套都在别处或下一层，改字号不会牵动它们。
   调大之后这一行的行高会跟着长 1~2px（没有显式 line-height，走的是 normal），
   这是可接受的——编号胶囊 16px 行高 + 上下各 1px 描边 = 18px，
   原来 13px 的标题行盒约 18px、正好齐平，现在 14px 约 19.6px，标题成为行高的决定项。
   不会因此溢出：这一层是 flex:1 1 auto + min-width:0，压缩全部由它承担，
   真正的截断在内层 .plt-kid-name-text（nowrap + hidden + ellipsis），
   两者都与字号无关，放大一档不影响它们成立。 */
.plt-kid-name{flex:1 1 auto;min-width:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#f0f2f5)}
/* 内层：真正的截断层。display:block 让它撑满外层宽度，nowrap + hidden + ellipsis
   三件套都落在这一层，外层因此保住基线、内层负责省略号。 */
.plt-kid-name-text{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* id=370：不再自带 margin-top —— 三块的间距统一由 .plt-kid 的 gap 给。
   留着 margin 会与 gap 叠加（3 + 5 = 8px），而且最后一块仍然多出 3px 空气。
   内层的行高与换行原样保留：这条重建只动「块与块之间」。 */
.plt-kid-plan{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary,rgba(255,255,255,.78));white-space:pre-wrap;word-break:break-word}
.plt-kid-note{font-size:12px;line-height:1.55;color:var(--dsw-alias-label-caption,#8a8a8a);white-space:pre-wrap;word-break:break-word}
.plt-kid-note-h{display:inline-block;margin-right:6px;font-weight:600;opacity:.8}
/* id=371：子任务行内那颗「单个通过」的样式已随按钮一起删除。
   注意：这里刻意**不写出那个类名**。dead-css.mjs 扫的是整份文件的原始文本、
   不区分注释：
     - 在 CSS 文件里，形如「点 + 类名」的写法会被当成一次**定义**。
       这条删除就踩过它 —— 真规则删了、注释里留着带点的名字，
       扫描器照样判成「有人定义、没人用」，报错。
     - 反过来，在 JS 文件里裸写类名会被当成一次**引用**，
       让一条本该报死的规则看起来「有人在用」。
   结论：注释里用文字描述即可，别写出类名。 */
/* 拆解批次头部那颗「整批通过」（id=354）与普通条目头部那颗「通过」（id=368）。
 *
 * id=373：这两颗是**主任务按钮**，从「与复制按钮同款」升成实心主色。
 *
 * 为什么必须区分开：通过 是这条链路上唯一推进状态的动作（审核完 → 归档），
 * 而它旁边那排「ID / 内容 / 提示词」都只是把文字挪走、不改任何数据。
 * 原来两者共用 .plt-copy-btn 的透明底 + 细描边胶囊，视觉上完全同级 ——
 * 用户扫一行时无法一眼分出「这颗会改变状态」。
 *
 * 改法只作用在这两个类上（.plt-head-pass 挂在 .plt-copy-btn 之后），
 * 复制按钮那几条规则一个字没动，所以「主 / 次」的层级差是**加法**得来的，
 * 不是把次要按钮压暗换来的 —— 后者会让整块区域变灰，读起来更累。
 *
 * 具体提升（对照 .plt-copy-btn 的 3px 9px / 12px / 999px 透明底）：
 *   · 底色：--dsw-alias-bg-accent（与「发送」键、「初始化」同一条主色），白字；
 *   · 字号 12 → 13px、内边距 3/9 → 5/13px：主按钮允许比次要按钮大一档；
 *   · 圆角 999px → 8px：实心块用胶囊会显得像标签，8px 才读成按钮；
 *   · 描边用同色（border-color:transparent 会让高度少 2px，与旁边错位）。
 *
 * 三态反馈：
 *   · hover    —— 主色提亮一档（不去改背景色相），并加一层极轻的外发光；
 *   · active   —— 下沉 1px + 内阴影，按下去的「实感」；
 *   · disabled —— 压到 .45 并去掉所有位移/发光（禁用时不该有任何互动暗示）。
 *
 * flex:0 0 auto 保留：.plt-name 是 flex:1 1 auto，这颗不能参与标题的伸缩，
 * 否则侧栏一窄，标题和按钮会互相挤。 */
.plt-head-pass{flex:0 0 auto;padding:5px 13px;border-radius:8px;border-color:transparent;background:var(--dsw-alias-bg-accent,#2f6fd0);color:#fff;font-size:13px;line-height:18px;font-weight:600;letter-spacing:.01em;box-shadow:0 2px 6px -2px rgba(47,111,208,.55),inset 0 1px 0 rgba(255,255,255,.20);transition:background .14s ease,box-shadow .16s ease,transform .1s ease,opacity .12s ease}
/* hover：提亮主色（改成叠加高光层，而不是换一个色相 —— 深浅两套主题都不必再各写一条）。 */
.plt-head-pass:hover:not(:disabled){background:var(--dsw-alias-bg-accent,#2f6fd0);border-color:transparent;color:#fff;box-shadow:0 2px 10px -2px rgba(47,111,208,.72),inset 0 1px 0 rgba(255,255,255,.30),inset 0 0 0 99px rgba(255,255,255,.12)}
.plt-head-pass:active:not(:disabled){transform:translateY(1px);box-shadow:0 1px 3px -1px rgba(47,111,208,.5),inset 0 2px 5px rgba(0,0,0,.22)}
/* 禁用：压暗 + 清掉位移与发光。覆盖 .plt-copy-btn:disabled 与它的 hover 兜底，
   否则 busy 时这颗还会看着能点（那两条是给透明胶囊写的，套到实心块上不成立）。 */
.plt-head-pass:disabled{opacity:.45;cursor:default;background:var(--dsw-alias-bg-accent,#2f6fd0);border-color:transparent;color:#fff;box-shadow:none;transform:none}
.plt-head-pass:disabled:hover{background:var(--dsw-alias-bg-accent,#2f6fd0);border-color:transparent;color:#fff;box-shadow:none}
/* 窄侧栏（≤320px）：只收字号与内距，让宽度回到标题 —— 但**不减**圆角、
   不去掉实心底色，主按钮在任何宽度下都还是主按钮。 */
@container (max-width:320px){.plt-head-pass{font-size:12px;line-height:16px;padding:4px 10px}}
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
/* 窄侧栏：收紧缩进与字号，父行标题不与徽标抢宽度。
   id=361：编号胶囊在这个宽度下再收一档（字号 -1px、左右各减 1px 内距）——
   它恒占宽度且不会省略，是标题被压短时最先该让位的东西。
   id=369：子任务名也收一档（14 → 13px）。不加这一条的话，父行标题收下来变成
   14px、子任务名仍是 14px，两层一样大 —— 「父行比子任务大一档」的层级在窄侧栏里
   就失效了。现在父 14 / 子 13，层级在任何宽度下都保住。 */
@container (max-width:320px){.plt-kid-code{font-size:10px;padding:0 4px}.plt-kid-name{font-size:13px}.plt-kid-plan,.plt-kid-note{font-size:12px}.plt-kids{display:none}.plt-kids-list{gap:7px;margin-left:4px;padding-left:9px}.plt-kid{padding:6px 8px}.plt-kid::before{left:-11px;width:11px}.plt-item.plt-parent > .plt-head .plt-name{font-size:14px}}
`)
