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
/* id=358：「已审核」的徽标样式已随节点一起删除 —— 已审核组里每条都必然已审核，
   分组位置已经把状态说清楚，右端再挂一个最长的词只会挤标题。
   id=368：「待审核」同理，一起删。两条分支现在都返回 null（见 50-item.js 的
   status.key 判断），这里若还留着规则就是死样式 —— 而 dead-css.mjs 抓不到它
   （它只认 .plt- 前缀，.plt-tag.unreviewed 会被记成 plt-tag），
   所以必须手动删，不能指望脚本报错。
   仍然保留的 .plt-tag.*：draft / todo / failed / interrupted / running ——
   这几种状态在组内不一致（同组里各条状态不同），徽标才有信息量。 */
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
/* 条目头部右侧的删除图标（id=359 建，id=374 扩到待执行）：复用 .plt-icon-btn + .plt-trash
   的尺寸与配色，这里只补两件头部特有的约束：
   1. flex:0 0 auto —— .plt-name 是 flex:1 1 auto，图标不能参与标题的伸缩；
   2. 头部只有 20px 行高（.plt-btn 的 line-height），而图标按钮是 26px 高，
      用 align-self:center 让它以标题行中线为基准居中，不把整行撑高 6px。
      高度仍用 26px：与底部那排按钮保持同一块可点面积，鼠标不必重新校准。
   id=374 补第 3 条：它现在要跟「通过」主按钮（.plt-head-pass，圆角 8px、
   主色实心底）并排站在标题行右端，两者高度必须齐。图标按钮是 26px，
   主按钮 line-height 18 + 上下 padding 5×2 + 描边 2 = 30px —— 差 4px。
   用 align-self:center 各自居中后视觉中线是对齐的（不靠撑高整行纠正），
   所以这里**不再额外改高度**：一改就把上面第 2 条的取舍推翻，
   底部那排的 26px 也会失去参照。 */
.plt-head-del{flex:0 0 auto;align-self:center;margin-left:2px}
/* 条目头部的「转为草稿」（id=376）：从底部操作排搬到标题行，排在垃圾桶左边。
   视觉沿用底部那颗描边胶囊（与 .plt-promote 同款视觉；原来那条共用的
   demote 规则已按 id=376 删除，这里是它唯一的宿主），只补头部特有的三件事：
   1. flex:0 0 auto —— 与删除图标同理，不能参与标题伸缩；
   2. align-self:center + 与图标同高 26px：这一行右端现在是「通过（30px）→
      转草稿 → 垃圾桶（26px）」并排，三者各自居中后视觉中线对齐；
      26px 这个高度是跟着 .plt-icon-btn 定的，不是另起一套；
   3. 右边界与垃圾桶之间留 2px（margin-right），与 head-del 的 margin-left
      一起构成两颗按钮之间的固定间距，不依赖父容器的 gap。
   窄屏（≤320px）再收一档字号与内距：头部本来就挤，先保标题不被压没。 */
.plt-head-demote{flex:0 0 auto;align-self:center;display:inline-flex;align-items:center;height:26px;padding:0 10px;margin-right:2px;border-radius:999px;border:1px solid rgba(var(--plt-accent),.55);background:transparent;color:rgba(var(--plt-accent),1);font-size:12px;line-height:1;font-weight:500;white-space:nowrap;cursor:pointer;transition:background .15s ease,border-color .15s ease,color .15s ease,opacity .12s ease}
.plt-head-demote:hover:not(:disabled){background:rgba(var(--plt-accent),.14);border-color:rgba(var(--plt-accent),.8)}
.plt-head-demote:active:not(:disabled){transform:translateY(.5px)}
.plt-head-demote:disabled{opacity:.45;cursor:default}
.plt-head-demote:disabled:hover{background:transparent;border-color:rgba(var(--plt-accent),.55)}
@container (max-width:320px){.plt-head-demote{font-size:11px;padding:0 8px}}
/* 触屏档：图标按钮在 @media (hover:none) 里会变 40×32，这里不能再覆盖它的宽度，
   否则「触屏热区更大」的既有约定会被头部这一处破例。 */
.plt-del{margin-left:auto;color:#d46a6a;border-color:rgba(212,106,106,.35)}
/* 删除键已经收进 .plt-actions，靠右由容器负责，这里不能再 margin-left:auto，否则会把同组的「转为待执行」推开。 */
.plt-checks .plt-actions .plt-del{margin-left:0}`)
