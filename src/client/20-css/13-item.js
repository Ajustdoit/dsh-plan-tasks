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
/* 「裁剪前备份」复选开关（id=256）。
   与 .plt-limit 并排出现在已审核组头，所以沿用同一套尺寸语言：
   26px 高、8px 圆角、组 accent 系、字号 12px，两个控件看起来是一对。
   自绘复选框而不是用浏览器默认：默认方块在深色面板上是刺眼的白，
   在浅色下又几乎看不见边框（id=89 踩过同样的坑）。 */
.plt-backup{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;height:26px;box-sizing:border-box;padding:0 8px;border-radius:8px;border:1px solid rgba(var(--plt-accent),.28);background:rgba(var(--plt-accent),.1);color:var(--dsw-alias-label-secondary,#c8c8c8);font-size:12px;line-height:1;font-weight:500;letter-spacing:.02em;cursor:pointer;white-space:nowrap;user-select:none;transition:border-color .12s ease,background .12s ease,color .12s ease}
.plt-backup:hover{border-color:rgba(var(--plt-accent),.46);background-color:rgba(var(--plt-accent),.17)}
.plt-backup:focus-within{outline:2px solid rgba(var(--plt-accent),.5);outline-offset:1px}
/* 勾上时整块转成实心强调：一眼能看出「现在会备份」，不用去数那个小方块。 */
/* 勾选态整块转实心，但文字不染 accent（id=258）：深色下四组 accent 亮度差很多，
   琥珀(255,180,60)与粉(236,72,153)压在 accent@.24 底上只有 4.18 / 3.50，
   比平时更难读；保持中性亮色后四组都是 8.5~11.2，勾没勾上靠底色与方块区分就够了。 */
.plt-backup.is-on{border-color:rgba(var(--plt-accent),.62);background-color:rgba(var(--plt-accent),.24);color:rgba(238,242,248,.98)}
.plt-backup-box{flex:0 0 auto;width:13px;height:13px;margin:0;padding:0;box-sizing:border-box;appearance:none;-webkit-appearance:none;border-radius:4px;border:1.5px solid rgba(var(--plt-accent),.5);background:transparent;cursor:pointer;position:relative;transition:background .12s ease,border-color .12s ease}
.plt-backup-box:checked{border-color:rgba(var(--plt-accent),.95);background:rgba(var(--plt-accent),.95)}
/* 对勾用 data-uri 而不是伪元素字符：字符在不同字体下粗细不一，13px 里会糊。 */
.plt-backup-box:checked::after{content:'';position:absolute;inset:0;background:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.6 6.2l2.2 2.2 4.6-4.6' fill='none' stroke='%23141a22' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/9px 9px no-repeat}
.plt-backup-box:disabled{opacity:.5;cursor:default}
.plt-backup-txt{flex:0 0 auto;line-height:24px}
@container (max-width:320px){.plt-backup{padding:0 6px;gap:4px}.plt-backup-txt{display:none}}
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
