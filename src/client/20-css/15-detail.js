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
