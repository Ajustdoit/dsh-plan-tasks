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
/* id=239：组收起、但组里还有条目在跑 —— 卡片整个不在 DOM 里（收起时只渲染组头），
   上面那条卡片流光自然也跟着消失。这里让容器自己的边框走一道光，收起也能看见「还在干」。
   挂在 .plt-group 而不是 .plt-group-h：组头有 backdrop-filter 与 z-index:3 自成层叠上下文，
   光往外扩会被裁掉，而且会跟 hover 的 ::before 左竖条抢伪元素。
   边框流光用 padding + mask 挖空中间，只留 1px 环，避免在容器里铺一层色块压住内容。 */
.plt-group.is-running:not(.open){position:relative;border-color:rgba(var(--plt-accent),.55);box-shadow:0 1px 2px rgba(0,0,0,.1),0 6px 16px -10px rgba(0,0,0,.4),0 0 18px -6px rgba(var(--plt-accent),.5)}
.plt-group.is-running:not(.open)::after{content:'';position:absolute;inset:0;pointer-events:none;border-radius:inherit;padding:1px;background:linear-gradient(100deg,transparent 18%,rgba(var(--plt-accent),.18) 34%,rgba(var(--plt-accent),.95) 48%,rgba(255,255,255,.9) 52%,rgba(var(--plt-accent),.95) 56%,rgba(var(--plt-accent),.18) 70%,transparent 86%);background-size:240% 100%;background-repeat:no-repeat;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;animation:plt-group-sheen 3.2s linear infinite}
@keyframes plt-group-sheen{0%{background-position:200% 0}100%{background-position:-60% 0}}
/* 减弱动画时不留一条乱跑的亮边：换成稳态描边，仍在告诉用户「这组在干活」。 */
@media (prefers-reduced-motion: reduce){.plt-group.is-running:not(.open)::after{animation:none;background:linear-gradient(180deg,rgba(var(--plt-accent),.85),rgba(var(--plt-accent),.3));background-size:100% 100%}}
.plt-group-todo .plt-group-count{background:rgba(236,72,153,.14);color:#f0a6c6;border-color:rgba(236,72,153,.3)}
/* id=240：组收起时的「正在执行」提示。跟计数胶囊并排，但形状是纯文字 + 转圈，
   比胶囊更轻 —— 它说的是「还在动」，不是「有几条」。
   字号比 .plt-group-count 小 0.5px（与 .plt-limit 同款递减），三个控件并排时不抢。
   flex:0 0 auto + nowrap：组头高度固定 38px，提示绝不能被压成两行。
   max-width 与 ellipsis 是兜底：320px 侧栏下如果真放不下，宁可截断也不要挤掉组名。 */
.plt-group-run{flex:0 0 auto;display:inline-flex;align-items:center;gap:4px;max-width:92px;overflow:hidden;font-size:12px;line-height:18px;font-weight:500;letter-spacing:.01em;white-space:nowrap;text-overflow:ellipsis;color:rgba(var(--plt-accent),.95)}
/* 深数组的 accent 里有粉红(236,72,153)与琥珀(255,180,60)，直接当 12px 小字用只有 3.1~4.4:1，
   在深底上偏暗。往白里调 45% 保住色相、把亮度提上来；浅色那条覆盖会把它整条压回深色值。 */
@supports (color: color-mix(in srgb, red 50%, white)){
  .plt-group-run{color:color-mix(in srgb,rgb(var(--plt-accent)) 55%,#ffffff)}
}
.plt-group-run svg{flex:0 0 auto}
.plt-group-run-txt{overflow:hidden;text-overflow:ellipsis}
/* 组头本来就窄：320px 以下把「正在执行」缩成只有转圈，靠 title/aria-label 说明。
   必须用 @container —— @media 量的是视口，侧栏拖窄时窗口还是宽的。 */
@container (max-width:360px){.plt-group-run{max-width:20px;gap:0}.plt-group-run-txt{display:none}}

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
