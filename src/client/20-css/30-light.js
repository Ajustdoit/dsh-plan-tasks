    /**
     * 浅色主题覆盖：全部 body:not([data-ds-dark-theme]) 规则。
     *
     * 必须在全部深色基础片段之后拼接 —— 覆盖靠「同特异度、后写者胜」，顺序错了浅色会立刻退回深色。
     */
    CSS_PARTS.push(`/* ============================================================
   主题变量兜底（只补浅色）
   ------------------------------------------------------------
   这个插件的样式引用了几个简写 token（--dsw-alias-bg-primary /
   bg-secondary / bg-tertiary / bg-hover / bg-accent / border-secondary /
   border-accent / label-accent）。它们不是 dsh-client-ui-theme 里定义的
   名字（那边用的是 bg-layer-N、interactive-bg-hover、border-lN、
   state-business-primary），所以一直走的是各条规则里 var() 的兜底值。
   深色主题下保持原样（不定义，继续走兜底）；浅色主题下在这里补出
   一套浅色值，作用域只到 .plt-root，不污染宿主其它区域。
   ============================================================ */
body:not([data-ds-dark-theme]) .plt-root{
  --dsw-alias-bg-primary:#fff;
  --dsw-alias-bg-secondary:rgba(15,30,60,.035);
  --dsw-alias-bg-tertiary:#f4f6f9;
  --dsw-alias-bg-hover:rgba(38,49,72,.06);
  --dsw-alias-bg-accent:#2f6fd0;
  --dsw-alias-border-secondary:rgba(0,0,0,.11);
  --dsw-alias-border-accent:rgba(47,111,208,.55);
  --dsw-alias-label-accent:#1f6fd0;
}

/* ============================================================
   浅色主题
   ------------------------------------------------------------
   上面的默认样式是照深色面板调的：大量写死的 rgba(255,255,255,…)
   半透明叠层、深海军蓝的输入卡、偏黑的投影，这些在浅色下会糊成一片白。
   主题插件是通过给 body 元素打 data-ds-dark-theme 属性来切换的
   （dsh-client-ui-theme/lib/index.js 里 document.body.toggleAttribute(...)），
   所以这里用 body:not([data-ds-dark-theme]) 覆盖：属性一变，
   这些规则立刻生效，不需要 JS 参与，也不怕「跟随系统」的自动切换。
   只覆盖在浅色下会失效的那些规则，能靠 --dsw-alias-* token 自适应的一律不动。
   ============================================================ */

/* —— 三组强调色在浅底上要压深，否则组名/标签几乎看不见 —— */
body:not([data-ds-dark-theme]) .plt-group-reviewed{--plt-accent:96,106,122}
body:not([data-ds-dark-theme]) .plt-group-unreviewed{--plt-accent:176,124,10}
body:not([data-ds-dark-theme]) .plt-group-todo{--plt-accent:31,111,208}
/* 草稿组：浅色下用深一点的绿，浅底上才看得见。 */
body:not([data-ds-dark-theme]) .plt-group-draft{--plt-accent:22,140,74}
body:not([data-ds-dark-theme]) .plt-group-draft .plt-tag.draft{background:rgba(22,140,74,.10);color:#177a41;border-color:rgba(22,140,74,.3)}
body:not([data-ds-dark-theme]) .plt-group-draft .plt-tag.type{color:rgba(22,140,74,.8);border-color:rgba(22,140,74,.26)}
body:not([data-ds-dark-theme]) .plt-tag.draft{background:rgba(22,140,74,.10);color:#177a41;border-color:rgba(22,140,74,.3)}
body:not([data-ds-dark-theme]) .plt-draft-toggle{color:#5b6472;border-color:rgba(20,40,70,.22)}
body:not([data-ds-dark-theme]) .plt-draft-toggle:hover:not(:disabled){background:rgba(20,40,70,.07);border-color:rgba(20,40,70,.34)}
body:not([data-ds-dark-theme]) .plt-draft-toggle.on{background:#178a48;box-shadow:0 2px 6px -2px rgba(22,140,74,.5),inset 0 1px 0 rgba(255,255,255,.25)}
body:not([data-ds-dark-theme]) .plt-draft-toggle.on:hover:not(:disabled){background:#12743c}
body:not([data-ds-dark-theme]) .plt-deep-toggle{color:#5b6472;border-color:rgba(20,40,70,.22)}
body:not([data-ds-dark-theme]) .plt-deep-toggle:hover:not(:disabled){background:rgba(20,40,70,.07);border-color:rgba(20,40,70,.34)}
body:not([data-ds-dark-theme]) .plt-deep-toggle.on{background:#4a54c8;box-shadow:0 2px 6px -2px rgba(74,84,200,.5),inset 0 1px 0 rgba(255,255,255,.25)}
body:not([data-ds-dark-theme]) .plt-deep-toggle.on:hover:not(:disabled){background:#3d47b4}
body:not([data-ds-dark-theme]) .plt-chip-split{background:#fff;border-color:rgba(160,110,20,.45);color:#7a5220}
body:not([data-ds-dark-theme]) .plt-chip-split:hover:not(:disabled){background:rgba(200,120,20,.09);border-color:rgba(180,112,18,.62);color:#8a5a12}
body:not([data-ds-dark-theme]) .plt-chip.plt-chip-split.active{background:#b06f10;border-color:#9a5f0c;color:#fff;box-shadow:0 1px 3px rgba(120,72,10,.28)}
body:not([data-ds-dark-theme]) .plt-chip.plt-chip-split.active:hover:not(:disabled){background:#c07a14;border-color:#b06f10;color:#fff}

/* —— 顶层结构：分隔线、提示条 —— */
body:not([data-ds-dark-theme]) .plt-top{border-bottom-color:var(--dsw-alias-border-l2,rgba(0,0,0,.10))}
body:not([data-ds-dark-theme]) .plt-btn{border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.10))}
body:not([data-ds-dark-theme]) .plt-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
body:not([data-ds-dark-theme]) .plt-notice{background:rgba(34,150,70,.10);border-color:rgba(34,150,70,.26);color:#1c7c3e}
body:not([data-ds-dark-theme]) .plt-auto.on{color:var(--dsw-alias-state-business-primary,#1f6fd0);border-color:rgba(47,111,208,.4)}

/* —— 输入卡：深海军蓝 → 素白玻璃卡 —— */
/* 外投影一律中性灰：深色主题里那几层偏蓝的投影（16,36,72 一带）是给海军蓝卡片
   做冷色晕染用的，落在白背景上就成了一片蓝雾，这里全部换成纯黑的低透明度。 */
body:not([data-ds-dark-theme]) .plt-form-wrap::after{background:rgba(0,0,0,.10);filter:blur(11px)}
body:not([data-ds-dark-theme]) .plt-composer{
  /* 浅色下不要顶部那道蓝光（深色主题里它是「顶部受光」，白卡上只会像一块蓝污渍），
     也不要有方向性的径向渐变 —— 只保留下部一点点极淡的冷灰，让卡片有一点体积感。 */
  background:
    linear-gradient(180deg,rgba(255,255,255,0) 0%,rgba(240,242,245,.55) 100%),
    linear-gradient(180deg,#ffffff 0%,#fdfdfe 100%);
  border-color:rgba(20,40,70,.14);
  /* 浅色下不要内阴影：白卡上叠 inset 会脏成一圈灰，只留向外的柔和投影（中性灰）。 */
  box-shadow:0 1px 2px rgba(0,0,0,.05),0 8px 18px -10px rgba(0,0,0,.14),0 22px 42px -24px rgba(0,0,0,.12);
}
body:not([data-ds-dark-theme]) .plt-composer:hover{border-color:rgba(20,40,70,.22);box-shadow:0 1px 2px rgba(0,0,0,.07),0 12px 24px -10px rgba(0,0,0,.17),0 28px 50px -26px rgba(0,0,0,.14)}
body:not([data-ds-dark-theme]) .plt-composer:focus-within{border-color:var(--dsw-alias-border-accent,#2f6fd0);box-shadow:0 1px 2px rgba(0,0,0,.05),0 16px 30px -10px rgba(0,0,0,.15),0 34px 60px -28px rgba(0,0,0,.12),0 0 0 3px rgba(20,40,70,.10)}
/* 聚焦时的顶部渐隐原本是蓝色光带，浅色下换成中性的白→透明，只做「顶面被照亮」的暗示。 */
body:not([data-ds-dark-theme]) .plt-composer::before{background:linear-gradient(180deg,rgba(255,255,255,.9),rgba(255,255,255,0) 52%)}
body:not([data-ds-dark-theme]) .plt-composer .plt-input::placeholder{color:var(--dsw-alias-label-tertiary,#98a1ad)}
body:not([data-ds-dark-theme]) .plt-composer .plt-chip{background:rgba(15,30,60,.05);border-color:rgba(15,30,60,.07);color:var(--dsw-alias-label-secondary,#4a5563)}
body:not([data-ds-dark-theme]) .plt-composer .plt-chip:hover:not(:disabled){background:rgba(15,30,60,.09);color:var(--dsw-alias-label-primary,#1f2328)}
/* 选中态：浅色下直接给实心品牌蓝底 + 白字白图标（原来是淡蓝底 + 蓝字，
   放在浅色卡片上对比太弱，看不出「已经被选中」）。 */
body:not([data-ds-dark-theme]) .plt-chip.active{background:#1f6fd0;border-color:#1a60b6;color:#fff;box-shadow:0 1px 3px rgba(20,60,120,.28),0 0 0 1px rgba(31,111,208,.18)}
body:not([data-ds-dark-theme]) .plt-chip.active:hover:not(:disabled){background:#2477d8;border-color:#1f6fd0;color:#fff}
body:not([data-ds-dark-theme]) .plt-chip.active svg{opacity:1}
/* 连接符：浅色下 label-caption 是 #adb2b8，白底上小符号几乎看不见，压深一档。 */
body:not([data-ds-dark-theme]) .plt-op{color:#59606c;opacity:.75}

/* —— 分组卡片：黑投影换成偏蓝的淡投影 —— */
/* 组头是 sticky 的，浅色下面板底色是白的，半透明会让滚动的内容透上来，压成接近实白。 */
body:not([data-ds-dark-theme]) .plt-group-h{background:rgba(250,252,255,.94);border-color:rgba(20,40,70,.10)}
body:not([data-ds-dark-theme]) .plt-group-h:hover{background:rgba(242,246,252,.96)}
body:not([data-ds-dark-theme]) .plt-group-reviewed,
body:not([data-ds-dark-theme]) .plt-group-unreviewed,
body:not([data-ds-dark-theme]) .plt-group-todo{box-shadow:0 1px 2px rgba(16,32,64,.05),0 6px 16px -12px rgba(16,36,72,.22)}
body:not([data-ds-dark-theme]) .plt-group-reviewed:hover,
body:not([data-ds-dark-theme]) .plt-group-unreviewed:hover,
body:not([data-ds-dark-theme]) .plt-group-todo:hover{box-shadow:0 1px 3px rgba(16,32,64,.07),0 10px 22px -14px rgba(16,36,72,.26),0 0 18px -12px rgba(var(--plt-accent),.5)}
body:not([data-ds-dark-theme]) .plt-group.open{box-shadow:0 2px 4px rgba(16,32,64,.07),0 16px 34px -18px rgba(16,36,72,.26),0 0 0 1px rgba(var(--plt-accent),.12)}

/* —— 条目底色：白色半透明 → 极淡的深色，浅底下才看得见边界 —— */
body:not([data-ds-dark-theme]) .plt-item{background:var(--dsw-alias-bg-primary,#fff)}
body:not([data-ds-dark-theme]) .plt-group-body .plt-item{background:rgba(var(--plt-accent),.055)}

/* —— 文字在浅底上要压深，不能沿用深色主题的「提亮」 —— */
body:not([data-ds-dark-theme]) .plt-head:hover .plt-name{color:var(--dsw-alias-label-primary,#141a22)}
body:not([data-ds-dark-theme]) .plt-tag.running{background:rgba(34,150,84,.10);color:#1c7c3e;border-color:rgba(34,150,84,.32)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-tag.todo{background:rgba(31,111,208,.08);color:#1a60b6;border-color:rgba(31,111,208,.26)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-tag.type{color:rgba(23,83,158,.86);border-color:rgba(31,111,208,.26)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-item.running .plt-name{color:#17539e;font-weight:600}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-item.running .plt-tag.running{background:rgba(31,111,208,.12);color:#17539e;border-color:rgba(31,111,208,.36)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-item.running .plt-tag.todo{background:rgba(31,111,208,.08);color:#1a60b6;border-color:rgba(31,111,208,.26)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-group-count{background:rgba(31,111,208,.10);color:#1a60b6;border-color:rgba(31,111,208,.26)}
body:not([data-ds-dark-theme]) .plt-tag.reviewed{background:rgba(120,130,145,.12);color:#5b6472;border-color:rgba(120,130,145,.32)}
body:not([data-ds-dark-theme]) .plt-tag.unreviewed{background:rgba(200,140,20,.12);color:#a07000;border-color:rgba(200,140,20,.34)}
body:not([data-ds-dark-theme]) .plt-tag.todo{background:rgba(120,130,145,.12);color:#5b6472;border-color:rgba(120,130,145,.3)}
body:not([data-ds-dark-theme]) .plt-copy-btn:hover{background:rgba(var(--plt-accent),.12);border-color:rgba(var(--plt-accent),.5);color:var(--dsw-alias-label-primary,#141a22)}
body:not([data-ds-dark-theme]) .plt-copy-btn.done{background:rgba(34,150,70,.12);border-color:rgba(34,150,70,.45);color:#1c7c3e}

/* —— 正在执行：浅底上把强度压到一半，绿色内阴影才不会糊成一块绿 —— */
body:not([data-ds-dark-theme]) .plt-item.running{border-color:rgba(31,111,208,.28)}
body:not([data-ds-dark-theme]) .plt-item.running::after{box-shadow:inset 0 0 20px -10px rgba(31,111,208,.24)}
body:not([data-ds-dark-theme]) .plt-group-body .plt-item.running{border-color:rgba(31,111,208,.3);box-shadow:inset 0 0 20px -10px rgba(31,111,208,.26)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-item.running{border-color:rgba(31,111,208,.36);background:rgba(31,111,208,.05);box-shadow:inset 0 0 0 1px rgba(31,111,208,.12),inset 0 0 22px -10px rgba(31,111,208,.30)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-item.running::after{box-shadow:inset 0 0 22px -10px rgba(31,111,208,.28),inset 0 0 0 1px rgba(31,111,208,.1);background:linear-gradient(100deg,transparent 20%,rgba(255,255,255,.5) 45%,rgba(255,255,255,.75) 50%,rgba(255,255,255,.5) 55%,transparent 80%);background-size:220% 100%;background-repeat:no-repeat}

/* —— 详情区：代码块 / 备注 在浅底下改用更淡的着色 —— */
body:not([data-ds-dark-theme]) .plt-plan{background:var(--dsw-alias-bg-tertiary,#f4f6f9)}
body:not([data-ds-dark-theme]) .plt-group-body .plt-plan{background:rgba(var(--plt-accent),.06);border-color:rgba(var(--plt-accent),.16)}
body:not([data-ds-dark-theme]) .plt-group-body .plt-note{background:rgba(var(--plt-accent),.045);border-left-color:rgba(var(--plt-accent),.5)}
body:not([data-ds-dark-theme]) .plt-note{border-left-color:var(--dsw-alias-border-accent,#2f6fd0)}
body:not([data-ds-dark-theme]) .plt-source{color:#4a5261;background:rgba(96,106,122,.05);border-color:rgba(96,106,122,.26)}
body:not([data-ds-dark-theme]) .plt-del{color:#c0392b;border-color:rgba(192,57,43,.32)}
/* 「审核通过」的浅色特化随 id=193 一起消失：现在它就是 .plt-copy-btn，
 * 已有 body:not([data-ds-dark-theme]) .plt-copy-btn:hover / .done 两条覆盖接管，不需要额外的。 */
body:not([data-ds-dark-theme]) .plt-err{background:rgba(192,57,43,.08);border-color:rgba(192,57,43,.3);color:#a93226}
body:not([data-ds-dark-theme]) .plt-input{background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-label-primary,#141a22);border-color:rgba(20,40,70,.16)}
/* 草稿编辑框在浅底下：白底 + 绿色描边，聚焦时描边加深并带一圈淡绿光。 */
body:not([data-ds-dark-theme]) .plt-edit-box .plt-edit-input{background:#fff;border-color:rgba(var(--plt-accent),.4);box-shadow:inset 0 1px 2px rgba(20,40,70,.05);color:#141a22}
body:not([data-ds-dark-theme]) .plt-edit-box .plt-edit-input:hover{border-color:rgba(var(--plt-accent),.58)}
body:not([data-ds-dark-theme]) .plt-save-state{color:#59606c}
body:not([data-ds-dark-theme]) .plt-save-state.pending,body:not([data-ds-dark-theme]) .plt-save-state.saving,body:not([data-ds-dark-theme]) .plt-save-state.saved{color:rgba(var(--plt-accent),.95)}
body:not([data-ds-dark-theme]) .plt-save-state.error{color:#c2410c}
body:not([data-ds-dark-theme]) .plt-edit-box .plt-edit-input:focus,body:not([data-ds-dark-theme]) .plt-edit-box .plt-edit-input:focus-visible{border-color:rgba(var(--plt-accent),.85);box-shadow:0 0 0 3px rgba(var(--plt-accent),.14),inset 0 1px 2px rgba(20,40,70,.05)}
body:not([data-ds-dark-theme]) .plt-dialog{background:var(--dsw-alias-bg-primary,#fff);box-shadow:0 12px 32px rgba(16,32,64,.18)}
body:not([data-ds-dark-theme]) .plt-mask{background:rgba(20,32,56,.28)}

/* —— 浅色下的次要文字：caption 在浅底上只有 2:1 出头，12.5px 会糊成一片 ——
   统一压到 bluish-700 一档（#61666b 附近），小字才有可读的对比度。 */
body:not([data-ds-dark-theme]) .plt-id{color:#5f6672;opacity:1}
/* id=179 浅色：label-caption 在白底上太淡（#adb2b8），跟 .plt-id 一样压深一档。 */
body:not([data-ds-dark-theme]) .plt-dur{color:#5f6672;opacity:1}
body:not([data-ds-dark-theme]) .plt-sec-h{color:#59606c}
/* 深色那条 hover 规则（.plt-sec-toggle:hover .plt-sec-h，特异度 (0,3,0)）比上面这行高，
   不补一条就会在白底上把标题刷成近白色（var 兜底 #e8e8e8）。 */
body:not([data-ds-dark-theme]) .plt-sec-toggle:hover .plt-sec-h{color:#2b3240}
body:not([data-ds-dark-theme]) .plt-sec-toggle .plt-sec-caret{color:#7a828e}
body:not([data-ds-dark-theme]) .plt-meta{color:#59606c}
body:not([data-ds-dark-theme]) .plt-group-count{color:#59606c}
/* 上限下拉（id=190）：浅色下白底，深色那条 #1c1f24 的 option 底色要翻回来；
   箭头的 data-uri 是写死的中灰，浅色下偏淡，换一版深灰的图。
   底色仍走组自身的 --plt-accent（浅色档已审核是 96,106,122），只把透明度提一档，
   免得在白底上几乎看不见这个控件。 */
body:not([data-ds-dark-theme]) .plt-limit{border-color:rgba(96,106,122,.34);background-color:rgba(96,106,122,.1);background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5L6 8l3.5-3.5' fill='none' stroke='%2359606c' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");color:#3c434e}
body:not([data-ds-dark-theme]) .plt-limit:hover:not(:disabled){border-color:rgba(96,106,122,.5);background-color:rgba(96,106,122,.16)}
body:not([data-ds-dark-theme]) .plt-limit option{background:#ffffff;color:#2b3240}
body:not([data-ds-dark-theme]) .plt-foot{color:#6a7280;opacity:1}
body:not([data-ds-dark-theme]) .plt-empty{color:#59606c}
/* 空组提示：深色下靠 opacity:.8 压暗，浅色下会直接糊掉，改成实色 + 图标稍亮。 */
body:not([data-ds-dark-theme]) .plt-group-empty{color:#59606c;opacity:1}
body:not([data-ds-dark-theme]) .plt-group-empty svg{opacity:.75}
body:not([data-ds-dark-theme]) .plt-caret,body:not([data-ds-dark-theme]) .plt-grip{color:#7b828d}
body:not([data-ds-dark-theme]) .plt-tag.type{color:#59606c;border-color:rgba(20,40,70,.18)}
body:not([data-ds-dark-theme]) .plt-check.locked{opacity:.72}
/* 「· 模型回填」是 .65 透明的小字，浅底下几乎化掉，改成实色深灰。 */
body:not([data-ds-dark-theme]) .plt-check.locked span::after{opacity:1;color:#6a7280}
/* placeholder 在浅底上原本是 #98a1ad，压到 bluish-600 一档才看得清。
   同样要 !important：主题包给所有 input::placeholder 打了浅白蓝的 !important。 */
body:not([data-ds-dark-theme]) .plt-composer .plt-input::placeholder{color:#6b7280!important;opacity:1!important}
/* 弹窗里的行内代码：--dsw-alias-bg-tertiary 在浅色下不存在，会落到深色兜底上，
   深底深字直接看不见，这里给出浅色专用的淡灰底。 */
body:not([data-ds-dark-theme]) .plt-dialog code{background:rgba(20,40,70,.06);color:#333a45}
/* 「开始干活」：白字压在浅蓝上对比不够，浅色下把填充压深一档（#1a60b6 一档）。 */
body:not([data-ds-dark-theme]) .plt-bulk-go{color:#fff;border-color:rgba(20,70,130,.9);background:linear-gradient(180deg,#2b7ada,#1a60b6);box-shadow:0 1px 2px rgba(0,0,0,.14),0 0 12px -4px rgba(30,90,170,.55)}
body:not([data-ds-dark-theme]) .plt-bulk-go:hover:not(:disabled){background:linear-gradient(180deg,#3486e6,#1f6fd0);box-shadow:0 1px 3px rgba(0,0,0,.18),0 0 18px -3px rgba(30,100,190,.6)}
/* 干活中的半透明底 + 白字 = 白字消失，浅色下改成深蓝字。 */
body:not([data-ds-dark-theme]) .plt-bulk-go.is-working{color:#17539e;background:rgba(31,111,208,.14);border-color:rgba(31,111,208,.4)}
body:not([data-ds-dark-theme]) .plt-bulk-go.is-working:hover:not(:disabled){background:rgba(31,111,208,.14)}
body:not([data-ds-dark-theme]) .plt-bulk-go:disabled{opacity:1;color:#77808c;background:rgba(20,40,70,.07);border-color:rgba(20,40,70,.12);box-shadow:none}
body:not([data-ds-dark-theme]) .plt-bulk-go.is-working:disabled{color:#17539e;background:rgba(31,111,208,.14);border-color:rgba(31,111,208,.38)}

/* —— 复选框：浅色下原生 checkbox 会跟着 color-scheme 画成深灰实心块，
   在白卡上就是「黑色的一坨」。这里在浅色下接管绘制（appearance:none），
   自己画一个白底 + 细边框的方框，勾选后填蓝并叠一个白色对勾。
   深色主题继续用原生绘制 + accent-color，一行不动。 */
body:not([data-ds-dark-theme]) .plt-check input[type='checkbox'],
body:not([data-ds-dark-theme]) .plt-pick input[type='checkbox'],
body:not([data-ds-dark-theme]) .plt-bulk input[type='checkbox']{
  -webkit-appearance:none;appearance:none;
  box-sizing:border-box;margin:0;padding:0;
  width:14px;height:14px;flex:0 0 auto;
  border:1.5px solid rgba(20,40,70,.34);
  border-radius:4px;
  background-color:#fff;
  cursor:pointer;
  transition:background-color .12s ease,border-color .12s ease,box-shadow .12s ease;
}
body:not([data-ds-dark-theme]) .plt-bulk input[type='checkbox'],
body:not([data-ds-dark-theme]) .plt-pick input[type='checkbox']{width:13.5px;height:13.5px}
body:not([data-ds-dark-theme]) .plt-check input[type='checkbox']:hover:not(:disabled),
body:not([data-ds-dark-theme]) .plt-pick input[type='checkbox']:hover:not(:disabled),
body:not([data-ds-dark-theme]) .plt-bulk input[type='checkbox']:hover:not(:disabled){border-color:rgba(31,111,208,.72);box-shadow:0 0 0 3px rgba(47,111,208,.12)}
body:not([data-ds-dark-theme]) .plt-check input[type='checkbox']:checked,
body:not([data-ds-dark-theme]) .plt-pick input[type='checkbox']:checked,
body:not([data-ds-dark-theme]) .plt-bulk input[type='checkbox']:checked{
  border-color:#1f6fd0;
  background-color:#1f6fd0;
  background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.2 8.6l3.1 3.1L12.8 5' fill='none' stroke='%23fff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:center;background-size:11px 11px;
}
/* 只读的「已执行」：勾选后是灰蓝的「已完成」色，不抢眼也不发黑。 */
body:not([data-ds-dark-theme]) .plt-check.locked input[type='checkbox']:checked{background-color:#8e97a4;border-color:#8e97a4}
/* 禁用且未勾选：浅灰虚化的空框。 */
body:not([data-ds-dark-theme]) .plt-check input[type='checkbox']:disabled:not(:checked),
body:not([data-ds-dark-theme]) .plt-pick input[type='checkbox']:disabled:not(:checked),
body:not([data-ds-dark-theme]) .plt-bulk input[type='checkbox']:disabled:not(:checked){border-color:rgba(20,40,70,.16);background-color:#f4f6f9;cursor:default}
body:not([data-ds-dark-theme]) .plt-check.locked input[type='checkbox']:disabled{cursor:not-allowed}
/* 拆解遮罩的浅色形态：白底界面下用淡蓝雾 + 白卡片，避免整块发黑。 */
body:not([data-ds-dark-theme]) .plt-split-mask{background:rgba(20,40,70,.22)}
body:not([data-ds-dark-theme]) .plt-split-card{
  border:1px solid rgba(24,44,74,.14);
  background:#ffffff;
  box-shadow:0 12px 30px rgba(16,32,64,.18);
  color:#20293a;
}
body:not([data-ds-dark-theme]) .plt-split-card .plt-split-hint{color:#5b6675}
`)
