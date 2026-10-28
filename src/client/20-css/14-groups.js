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
.plt-copy{margin-left:auto;display:inline-flex;align-items:center;gap:8px;flex:0 0 auto}
/* 「计划」标题右侧的小胶囊：字号 11→12、内边距 1px 6px→3px 9px、图标与文字间距 3→5px，
   三个按钮之间 5→8px。原来的尺寸贴着标题基线，点起来也太窄。 */
.plt-copy-btn{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;border:1px solid rgba(var(--plt-accent),.28);background:transparent;color:rgba(var(--plt-accent),.85);font-size:12px;line-height:16px;font-weight:500;letter-spacing:0;cursor:pointer;white-space:nowrap;transition:background .15s ease,border-color .15s ease,color .15s ease}
.plt-copy-btn:hover{background:rgba(var(--plt-accent),.14);border-color:rgba(var(--plt-accent),.55);color:#fff}
.plt-copy-btn:active{transform:translateY(.5px)}
.plt-copy-btn.done{background:rgba(76,175,80,.18);border-color:rgba(76,175,80,.55);color:#bfe6c1}
.plt-group-body .plt-plan{background:rgba(var(--plt-accent),.05);border:1px solid rgba(var(--plt-accent),.1);border-radius:6px;padding:10px 12px;max-height:260px}
.plt-group-body .plt-note{background:rgba(var(--plt-accent),.035);border-left:2px solid rgba(var(--plt-accent),.45);border-radius:0 6px 6px 0;padding:9px 11px;max-height:220px}
.plt-group-body .plt-meta{color:var(--dsw-alias-label-caption,#9a9a9a);gap:5px 12px;margin-top:12px}
.plt-group-body .plt-checks{gap:12px;margin-top:12px}
.plt-group-body .plt-del{color:#d46a6a;border-color:rgba(212,106,106,.35)}
.plt-group-body .plt-plan::-webkit-scrollbar,.plt-group-body .plt-note::-webkit-scrollbar{width:6px}
.plt-group-body .plt-plan::-webkit-scrollbar-thumb,.plt-group-body .plt-note::-webkit-scrollbar-thumb{background:rgba(var(--plt-accent),.3);border-radius:3px}`)
