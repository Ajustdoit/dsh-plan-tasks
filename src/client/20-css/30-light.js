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
  --dsw-alias-bg-hover:rgba(38,49,72,.11);
  --dsw-alias-interactive-bg-hover:rgba(38,49,72,.11);
  --dsw-alias-bg-accent:#2f6fd0;
  --dsw-alias-border-secondary:rgba(20,40,70,.24);
  --dsw-alias-border-accent:rgba(47,111,208,.55);
  --dsw-alias-label-accent:#1f6fd0;
  /* 悬浮提示（id=248）：浅色用「浅底深字 + 柔和阴影」。
     底走不透明的 #fff —— 气泡底下可能是卡片、可能是输入框，半透明会跟着变脏；
     浮层本来就要脱离背景，宁可实心。文字 #1f2733 在白底上 15.04:1。
     阴影比深色轻一档（深色靠暗度分离，浅色靠柔和投影分离）；
     边框 .22 与气泡底 1.55:1，只求在浅底上勾出边界，不需要更强。 */
  --plt-tip-bg:#ffffff;
  --plt-tip-fg:#1f2733;
  --plt-tip-fg-muted:#4a5462;
  --plt-tip-border:rgba(20,40,70,.22);
  --plt-tip-shadow:0 1px 2px rgba(16,32,64,.10),0 10px 24px -8px rgba(16,32,64,.20);
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
/* id=226：琥珀 176,124,10 在白卡上只有 3.4:1（组名 3.46、标签 2.83），压到 138,95,6 后
   alpha=1 时 5.25、组头 5.49，标签底也跟着变浅，仍然是同一个橙色相。 */
body:not([data-ds-dark-theme]) .plt-group-unreviewed{--plt-accent:138,95,6}
/* id=228：原本 31,111,208 太亮，「复制提示词」这类 accent@1 的文字落在 accent@.055 的卡片底上
   只有 4.39:1（同色系浅底压浅字）。压深一档到 #175aac，同色相不变、明度降一档，比值抬到 6 以上。 */
body:not([data-ds-dark-theme]) .plt-group-todo{--plt-accent:23,90,172}
/* 草稿组：浅色下用深一点的绿，浅底上才看得见。id=226：22,140,74 只有 4.0:1，
   压到 17,107,54 后 6.14:1，同时把沿用旧色号的标签一起换过来。 */
body:not([data-ds-dark-theme]) .plt-group-draft{--plt-accent:17,107,54}
body:not([data-ds-dark-theme]) .plt-group-draft .plt-tag.draft{background:rgba(17,107,54,.10);color:#116b36;border-color:rgba(17,107,54,.38)}
body:not([data-ds-dark-theme]) .plt-group-draft .plt-tag.type{color:rgba(17,107,54,.9);border-color:rgba(17,107,54,.26)}
body:not([data-ds-dark-theme]) .plt-tag.draft{background:rgba(17,107,54,.10);color:#116b36;border-color:rgba(17,107,54,.38)}
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
body:not([data-ds-dark-theme]) .plt-top{border-bottom-color:rgba(20,40,70,.22)}
body:not([data-ds-dark-theme]) .plt-btn{border-color:rgba(20,40,70,.24)}
body:not([data-ds-dark-theme]) .plt-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
body:not([data-ds-dark-theme]) .plt-notice{background:rgba(34,150,70,.10);border-color:rgba(34,150,70,.39);color:#1c7c3e}
body:not([data-ds-dark-theme]) .plt-auto.on{color:#1a5db8;border-color:rgba(26,93,184,.45)}
/* 开始 / 暂停（id=207）浅色态：深色主题那两档 hover 底色在白底上偏灰，
   换成饱和一点的绿 / 橙，并把文字压深 —— 白底上 .plt-btn 的继承色足够，
   但 hover 时底色变浅会显得字发飘，所以显式钉一次。
   id=354 起两者互斥渲染，同一条规则只会命中屏幕上唯一那颗按钮。 */
body:not([data-ds-dark-theme]) .plt-start:not(:disabled):hover{background:rgba(34,150,84,.12);border-color:rgba(28,124,62,.46);color:#14663a}
body:not([data-ds-dark-theme]) .plt-pause:not(:disabled):hover{background:rgba(216,120,32,.12);border-color:rgba(176,94,20,.46);color:#8a4a0e}
/* 开始 / 暂停的状态色（id=210）浅色态：深色主题的亮蓝 / 亮琥珀在 #fdfefe 上几乎看不见，
   换成各自的深色系；禁用态沿用同一个 opacity，不另外调。 */
body:not([data-ds-dark-theme]) .plt-start.is-resume:not(:disabled){color:#17539e;border-color:rgba(31,111,208,.46);background:rgba(31,111,208,.10)}
body:not([data-ds-dark-theme]) .plt-start.is-resume:not(:disabled):hover{background:rgba(31,111,208,.17);border-color:rgba(31,111,208,.62)}
body:not([data-ds-dark-theme]) .plt-pause:not(:disabled){color:#8a4a0e;border-color:rgba(176,94,20,.44)}
body:not([data-ds-dark-theme]) .plt-top.has-error .plt-start,
body:not([data-ds-dark-theme]) .plt-top.has-error .plt-pause{border-color:rgba(198,40,40,.46)}

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
  border-color:rgba(20,40,70,.24);
  /* 浅色下不要内阴影：白卡上叠 inset 会脏成一圈灰，只留向外的柔和投影（中性灰）。 */
  box-shadow:0 1px 2px rgba(0,0,0,.05),0 8px 18px -10px rgba(0,0,0,.14),0 22px 42px -24px rgba(0,0,0,.12);
}
body:not([data-ds-dark-theme]) .plt-composer:hover{border-color:rgba(20,40,70,.22);box-shadow:0 1px 2px rgba(0,0,0,.07),0 12px 24px -10px rgba(0,0,0,.17),0 28px 50px -26px rgba(0,0,0,.14)}
body:not([data-ds-dark-theme]) .plt-composer:focus-within{border-color:var(--dsw-alias-border-accent,#2f6fd0);box-shadow:0 1px 2px rgba(0,0,0,.05),0 16px 30px -10px rgba(0,0,0,.15),0 34px 60px -28px rgba(0,0,0,.12),0 0 0 3px rgba(20,40,70,.10)}
/* 聚焦时的顶部渐隐原本是蓝色光带，浅色下换成中性的白→透明，只做「顶面被照亮」的暗示。 */
body:not([data-ds-dark-theme]) .plt-composer::before{background:linear-gradient(180deg,rgba(255,255,255,.9),rgba(255,255,255,0) 52%)}
body:not([data-ds-dark-theme]) .plt-composer .plt-input::placeholder{color:var(--dsw-alias-label-tertiary,#98a1ad)}
body:not([data-ds-dark-theme]) .plt-composer .plt-chip{background:rgba(15,30,60,.05);border-color:rgba(15,30,60,.23);color:var(--dsw-alias-label-secondary,#4a5563)}
body:not([data-ds-dark-theme]) .plt-composer .plt-chip:hover:not(:disabled){background:rgba(15,30,60,.09);color:var(--dsw-alias-label-primary,#1f2328)}
/* 选中态：浅色下直接给实心品牌蓝底 + 白字白图标（原来是淡蓝底 + 蓝字，
   放在浅色卡片上对比太弱，看不出「已经被选中」）。 */
body:not([data-ds-dark-theme]) .plt-chip.active{background:#17539e;border-color:#134a8c;color:#fff;box-shadow:0 1px 3px rgba(20,60,120,.28),0 0 0 1px rgba(23,83,158,.18)}
body:not([data-ds-dark-theme]) .plt-chip.active:hover:not(:disabled){background:#1a60b6;border-color:#17539e;color:#fff}
body:not([data-ds-dark-theme]) .plt-chip.active svg{opacity:1}
/* 连接符：浅色下 label-caption 是 #adb2b8，白底上小符号几乎看不见，压深一档。 */
body:not([data-ds-dark-theme]) .plt-op{color:#59606c;opacity:.75}

/* —— 分组卡片：黑投影换成偏蓝的淡投影 —— */
/* 组头是 sticky 的，浅色下面板底色是白的，半透明会让滚动的内容透上来，压成接近实白。 */
body:not([data-ds-dark-theme]) .plt-group-h{background:rgba(250,252,255,.94);border-color:rgba(20,40,70,.26)}
body:not([data-ds-dark-theme]) .plt-group-h:hover{background:rgba(226,236,248,.96)}
body:not([data-ds-dark-theme]) .plt-group-reviewed,
body:not([data-ds-dark-theme]) .plt-group-unreviewed,
body:not([data-ds-dark-theme]) .plt-group-todo{box-shadow:0 1px 2px rgba(16,32,64,.05),0 6px 16px -12px rgba(16,36,72,.22)}
body:not([data-ds-dark-theme]) .plt-group-reviewed:hover,
body:not([data-ds-dark-theme]) .plt-group-unreviewed:hover,
body:not([data-ds-dark-theme]) .plt-group-todo:hover{box-shadow:0 1px 3px rgba(16,32,64,.07),0 10px 22px -14px rgba(16,36,72,.26),0 0 18px -12px rgba(var(--plt-accent),.5)}
body:not([data-ds-dark-theme]) .plt-group.open{box-shadow:0 2px 4px rgba(16,32,64,.07),0 16px 34px -18px rgba(16,36,72,.26),0 0 0 1px rgba(var(--plt-accent),.12)}
/* id=239：浅色下收起态的「干活中」流光。深色那套是往黑底上打亮光，浅底上反过来 ——
   外发光要淡（白底上重投影会糊），描边要实（对比度参考 id=227 的 1.5:1 门槛），
   扫过的那道高光保留 accent 本色 + 一段近白，走起来才看得见。 */
body:not([data-ds-dark-theme]) .plt-group.is-running:not(.open){border-color:rgba(var(--plt-accent),.62);box-shadow:0 1px 2px rgba(16,32,64,.05),0 6px 16px -12px rgba(16,36,72,.22),0 0 16px -8px rgba(var(--plt-accent),.42)}
/* 注意 background 是简写，会把基础规则里的 background-size:240% 一起重置回 auto ——
   那样 background-position 动画就没得走（光带会静止）。所以这里必须把尺寸与重复方式补回来。 */
body:not([data-ds-dark-theme]) .plt-group.is-running:not(.open)::after{background:linear-gradient(100deg,transparent 18%,rgba(var(--plt-accent),.22) 34%,rgba(var(--plt-accent),.98) 48%,#ffffff 52%,rgba(var(--plt-accent),.98) 56%,rgba(var(--plt-accent),.22) 70%,transparent 86%);background-size:240% 100%;background-repeat:no-repeat}
@media (prefers-reduced-motion: reduce){body:not([data-ds-dark-theme]) .plt-group.is-running:not(.open)::after{animation:none;background:linear-gradient(180deg,rgba(var(--plt-accent),.9),rgba(var(--plt-accent),.35));background-size:100% 100%}}

/* —— 条目底色：白色半透明 → 极淡的深色，浅底下才看得见边界 —— */
body:not([data-ds-dark-theme]) .plt-item{background:var(--dsw-alias-bg-primary,#fff)}
body:not([data-ds-dark-theme]) .plt-group-body .plt-item{background:rgba(var(--plt-accent),.055);border-color:rgba(var(--plt-accent),.32)}
/* id=227：卡片头与正文之间的分割线（基础样式是 accent@.14，白底上几乎看不见）。 */
body:not([data-ds-dark-theme]) .plt-group-body .plt-body{border-top-color:rgba(var(--plt-accent),.34)}

/* —— 文字在浅底上要压深，不能沿用深色主题的「提亮」 —— */
body:not([data-ds-dark-theme]) .plt-head:hover .plt-name{color:var(--dsw-alias-label-primary,#141a22)}
body:not([data-ds-dark-theme]) .plt-tag.running{background:rgba(13,107,116,.12);color:#0d6b74;border-color:rgba(13,107,116,.44)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-tag.todo{background:rgba(31,111,208,.08);color:#1a60b6;border-color:rgba(31,111,208,.26)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-tag.type{color:rgba(23,83,158,.86);border-color:rgba(31,111,208,.26)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-item.running .plt-name{color:#0d6b74;font-weight:600}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-item.running .plt-tag.running{background:rgba(13,107,116,.14);color:#0d6b74;border-color:rgba(13,107,116,.4)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-item.running .plt-tag.todo{background:rgba(31,111,208,.08);color:#1a60b6;border-color:rgba(31,111,208,.26)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-group-count{background:rgba(31,111,208,.10);color:#1a60b6;border-color:rgba(31,111,208,.26)}
/* id=358 / id=368：浅色态的 .plt-tag.reviewed 与 .plt-tag.unreviewed 随节点一并删除
   （这两个组里不再画状态徽标）。深色那侧同步删掉了，两边保持对称。 */
body:not([data-ds-dark-theme]) .plt-tag.todo{background:rgba(120,130,145,.12);color:#5b6472;border-color:rgba(120,130,145,.41)}
/* id=233「已中断」：与 id=228 给「待审核」定的琥珀同一族，但底色更浅一档 ——
   待审核是「干完了等人看」，已中断是「没干完等人续」，两者不该看起来一样重。 */
body:not([data-ds-dark-theme]) .plt-tag.interrupted{background:rgba(200,140,20,.10);color:#7c5405;border-color:rgba(200,140,20,.52)}
body:not([data-ds-dark-theme]) .plt-tag.failed{background:rgba(180,60,50,.10);color:#8a2e28;border-color:rgba(180,60,50,.45)}
/* id=226：基础样式是 rgba(var(--plt-accent),.85)，浅色下这条透明度会把文字再冲淡一层
   （待执行组只剩 3.59:1）。浅色一律用实色，悬停反色那条保持原样。 */
body:not([data-ds-dark-theme]) .plt-copy-btn{color:rgba(var(--plt-accent),1);border-color:rgba(var(--plt-accent),.32)}
body:not([data-ds-dark-theme]) .plt-copy-btn:hover{background:rgba(var(--plt-accent),.12);border-color:rgba(var(--plt-accent),.5);color:var(--dsw-alias-label-primary,#141a22)}
body:not([data-ds-dark-theme]) .plt-copy-btn:disabled:hover{color:rgba(var(--plt-accent),1)}
body:not([data-ds-dark-theme]) .plt-copy-btn.done{background:rgba(34,150,70,.12);border-color:rgba(34,150,70,.45);color:#116b36}
/* id=373：头部「通过」在浅色下必须重新钉一次颜色。
   这几条不是重复劳动 —— 上面 .plt-copy-btn 那组（id=226）是给**透明胶囊**写的：
   color: accent 实色 + border-color: accent .32。头部那颗现在是实心主色块，
   而 body:not([data-ds-dark-theme]) .plt-copy-btn:hover 的特异度 (0,3,0) 高于
   .plt-head-pass:hover 的 (0,2,0) —— 不覆盖的话，白底主题下 hover 会把文字
   刷成深蓝（label-primary）压在深蓝实心底上，几乎看不见。
   所以这里把「白字 + 主色底 + 透明描边」按同样的特异度补一遍。
   底面沿用 --dsw-alias-bg-accent：浅色主题里它已经是 #2f6fd0（白字对比 5.9:1），
   不需要另设一个更深的蓝，也就不会和「发送」键分家。 */
body:not([data-ds-dark-theme]) .plt-head-pass,
body:not([data-ds-dark-theme]) .plt-head-pass:hover:not(:disabled),
body:not([data-ds-dark-theme]) .plt-head-pass:active:not(:disabled),
body:not([data-ds-dark-theme]) .plt-head-pass:disabled,
body:not([data-ds-dark-theme]) .plt-head-pass:disabled:hover{background:var(--dsw-alias-bg-accent,#2f6fd0);border-color:transparent;color:#fff}

/* —— 正在执行：浅底上把强度压到一半，绿色内阴影才不会糊成一块绿 —— */
body:not([data-ds-dark-theme]) .plt-item.running{border-color:rgba(31,111,208,.33)}
body:not([data-ds-dark-theme]) .plt-item.running::after{box-shadow:inset 0 0 20px -10px rgba(31,111,208,.24)}
body:not([data-ds-dark-theme]) .plt-group-body .plt-item.running{border-color:rgba(31,111,208,.43);box-shadow:inset 0 0 20px -10px rgba(31,111,208,.26)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-item.running{border-color:rgba(31,111,208,.36);background:rgba(31,111,208,.05);box-shadow:inset 0 0 0 1px rgba(31,111,208,.12),inset 0 0 22px -10px rgba(31,111,208,.30)}
body:not([data-ds-dark-theme]) .plt-group-todo .plt-item.running::after{box-shadow:inset 0 0 22px -10px rgba(31,111,208,.28),inset 0 0 0 1px rgba(31,111,208,.1);background:linear-gradient(100deg,transparent 20%,rgba(255,255,255,.5) 45%,rgba(255,255,255,.75) 50%,rgba(255,255,255,.5) 55%,transparent 80%);background-size:220% 100%;background-repeat:no-repeat}

/* —— 详情区：代码块 / 备注 在浅底下改用更淡的着色 —— */
body:not([data-ds-dark-theme]) .plt-plan{background:var(--dsw-alias-bg-tertiary,#f4f6f9)}
body:not([data-ds-dark-theme]) .plt-group-body .plt-plan{background:rgba(var(--plt-accent),.06);border-color:rgba(var(--plt-accent),.32)}
body:not([data-ds-dark-theme]) .plt-group-body .plt-note{background:rgba(var(--plt-accent),.045);border-left-color:rgba(var(--plt-accent),.5)}
body:not([data-ds-dark-theme]) .plt-note{border-left-color:var(--dsw-alias-border-accent,#2f6fd0)}
body:not([data-ds-dark-theme]) .plt-source{color:#4a5261;background:rgba(96,106,122,.05);border-color:rgba(96,106,122,.34)}
body:not([data-ds-dark-theme]) .plt-del{color:#c0392b;border-color:rgba(192,57,43,.32)}
/* 「审核通过」的浅色特化随 id=193 一起消失：现在它就是 .plt-copy-btn，
 * 已有 body:not([data-ds-dark-theme]) .plt-copy-btn:hover / .done 两条覆盖接管，不需要额外的。 */
body:not([data-ds-dark-theme]) .plt-err{background:rgba(192,57,43,.08);border-color:rgba(192,57,43,.3);color:#a93226}
body:not([data-ds-dark-theme]) .plt-input{background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-label-primary,#141a22);border-color:rgba(20,40,70,.24)}
/* 草稿编辑框在浅底下：白底 + 绿色描边，聚焦时描边加深并带一圈淡绿光。 */
body:not([data-ds-dark-theme]) .plt-edit-box .plt-edit-input{background:#fff;border-color:rgba(var(--plt-accent),.4);box-shadow:inset 0 1px 2px rgba(20,40,70,.05);color:#141a22}
body:not([data-ds-dark-theme]) .plt-edit-box .plt-edit-input:hover{border-color:rgba(var(--plt-accent),.58)}
body:not([data-ds-dark-theme]) .plt-save-state{color:#59606c}
body:not([data-ds-dark-theme]) .plt-save-state.pending,body:not([data-ds-dark-theme]) .plt-save-state.saving,body:not([data-ds-dark-theme]) .plt-save-state.saved{color:rgba(var(--plt-accent),1)}
body:not([data-ds-dark-theme]) .plt-save-state.error{color:#b3261e}
body:not([data-ds-dark-theme]) .plt-edit-box .plt-edit-input:focus,body:not([data-ds-dark-theme]) .plt-edit-box .plt-edit-input:focus-visible{border-color:rgba(var(--plt-accent),.85);box-shadow:0 0 0 3px rgba(var(--plt-accent),.14),inset 0 1px 2px rgba(20,40,70,.05)}
/* 弹窗盒：与页面底同为纯白，只靠遮罩会显得「浮不起来」，因此描边抬到 1.85:1 并补三层阴影（近距贴边 + 中距扩散 + 远距氛围）。 */
body:not([data-ds-dark-theme]) .plt-dialog{background:var(--dsw-alias-bg-primary,#fff);border-color:rgba(20,40,70,.30);box-shadow:0 1px 2px rgba(16,32,64,.10),0 10px 24px -6px rgba(16,32,64,.20),0 28px 56px -18px rgba(20,40,80,.24)}
/* 弹窗遮罩：压暗 38.5%（原 46.9%），既压住底页又不过度发灰，白弹窗靠 1.58 的底差 + 描边 + 三层阴影分离。 */
body:not([data-ds-dark-theme]) .plt-mask{background:rgba(20,32,56,.22)}

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
/* id=275：拆解批次的层级线在白底上要压深一档，否则 2px 的 accent 半透明线和
   「小横钩」几乎看不见；父行的强调竖杠同理，浅色下用不透明的 accent。 */
body:not([data-ds-dark-theme]) .plt-kids-list{border-left-color:rgba(var(--plt-accent),.34)}
body:not([data-ds-dark-theme]) .plt-kid::before{background:rgba(var(--plt-accent),.40)}
body:not([data-ds-dark-theme]) .plt-kid:hover::before{background:rgba(var(--plt-accent),.72)}
body:not([data-ds-dark-theme]) .plt-item.plt-parent > .plt-head::before{background:rgba(var(--plt-accent),.72)}
body:not([data-ds-dark-theme]) .plt-item.plt-parent.open > .plt-head::before{background:rgba(var(--plt-accent),1)}
body:not([data-ds-dark-theme]) .plt-kid{background:rgba(15,30,60,.028);border-color:rgba(20,40,70,.14)}
body:not([data-ds-dark-theme]) .plt-kid:hover{background:rgba(15,30,60,.048);border-color:rgba(var(--plt-accent),.42)}
/* id=361：子任务编号胶囊在浅底上要压深一档 —— 深色那条吃的是 accent 的 alpha
   叠加，白底上会淡成一条看不清的小方块。文字用 bluish-700（与 .plt-id 同色阶），
   底色/描边把 accent 的 alpha 提上去但不换色相，两套主题仍是同一族视觉。 */
body:not([data-ds-dark-theme]) .plt-kid-code{color:#17559c;background:rgba(var(--plt-accent),.12);border-color:rgba(var(--plt-accent),.30)}
body:not([data-ds-dark-theme]) .plt-kid-done .plt-kid-code{color:#5f6672;background:rgba(var(--plt-accent),.07);border-color:rgba(20,40,70,.16)}
body:not([data-ds-dark-theme]) .plt-kid-note{color:#59606c}
/* id=317：「已做的子任务」（id=316）在浅色下要逐项对齐 —— 深色那套吃的是
   rgba(255,255,255,.xx) 与 dsw 变量，白底上要么看不见、要么把字刷淡到读不清。
   这里只用两种既有色阶：bluish-700（文字）与 accent 的 alpha（装饰），不引入新色值。 */
body:not([data-ds-dark-theme]) .plt-kid.plt-kid-done{background:rgba(15,30,60,.045);border-color:rgba(20,40,70,.10)}
body:not([data-ds-dark-theme]) .plt-kid.plt-kid-done:hover{background:rgba(15,30,60,.075);border-color:rgba(var(--plt-accent),.34)}
body:not([data-ds-dark-theme]) .plt-kid-done .plt-kid-name{color:#3c4653}
body:not([data-ds-dark-theme]) .plt-kid-done .plt-kid-plan{color:#4a5563;opacity:1}
body:not([data-ds-dark-theme]) .plt-kid-done .plt-kid-note{color:#59606c;opacity:1}
body:not([data-ds-dark-theme]) .plt-kid-done::before{background:rgba(var(--plt-accent),.24)}
body:not([data-ds-dark-theme]) .plt-kid-check{color:#17559c;background:rgba(var(--plt-accent),.14)}
body:not([data-ds-dark-theme]) .plt-body.plt-body-parent{border-top-color:rgba(var(--plt-accent),.26)}
/* id=240：收起态「正在执行」提示。深色那条吃的是 rgba(var(--plt-accent),.95)，
   浅色下四组 accent 已压深（id=226/228），alpha 再拉满一档到这里：不放白底上会发灰。 */
body:not([data-ds-dark-theme]) .plt-group-run{color:rgba(var(--plt-accent),1)}
/* id=377：「完成后暂停」开关的浅色态。
   关闭态平时是灰字（走 label-caption），浅色下那颗 #9a9a9a 在白底上偏淡，
   往深里压一档到 #59606c —— 与同组其它 caption 文字（.plt-group-count 等）同一个值，
   这里不另设一个数。开启态的字/描边本来就吃 --plt-accent（浅色档已压深），
   不用再覆盖；只把 hover 也钉一次，避免默认那条 .42 的描边在白底上糊掉。 */
body:not([data-ds-dark-theme]) .plt-auto-pause{color:#59606c;border-color:rgba(20,40,70,.22)}
body:not([data-ds-dark-theme]) .plt-auto-pause .plt-dot{background:#8b929c}
body:not([data-ds-dark-theme]) .plt-auto-pause:hover{border-color:rgba(var(--plt-accent),.55);color:rgba(var(--plt-accent),1)}
body:not([data-ds-dark-theme]) .plt-auto-pause.on{color:rgba(var(--plt-accent),1);border-color:rgba(var(--plt-accent),.55)}
/* 上限下拉（id=190）：浅色下白底，深色那条 #1c1f24 的 option 底色要翻回来；
   箭头的 data-uri 是写死的中灰，浅色下偏淡，换一版深灰的图。
   底色仍走组自身的 --plt-accent（浅色档已审核是 96,106,122），只把透明度提一档，
   免得在白底上几乎看不见这个控件。 */
body:not([data-ds-dark-theme]) .plt-limit{border-color:rgba(96,106,122,.39);background-color:rgba(96,106,122,.1);background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5L6 8l3.5-3.5' fill='none' stroke='%2359606c' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");color:#3c434e}
body:not([data-ds-dark-theme]) .plt-limit:hover:not(:disabled){border-color:rgba(96,106,122,.5);background-color:rgba(96,106,122,.16)}
body:not([data-ds-dark-theme]) .plt-limit option{background:#ffffff;color:#2b3240}
body:not([data-ds-dark-theme]) .plt-foot{color:#6a7280;opacity:1}
body:not([data-ds-dark-theme]) .plt-empty{color:#59606c}
/* 空组提示：深色下靠 opacity:.8 压暗，浅色下会直接糊掉，改成实色 + 图标稍亮。 */
body:not([data-ds-dark-theme]) .plt-group-empty{color:#59606c;opacity:1}
body:not([data-ds-dark-theme]) .plt-group-empty svg{opacity:.75}
body:not([data-ds-dark-theme]) .plt-caret,body:not([data-ds-dark-theme]) .plt-grip{color:#646b77}
/* id=226：还有三处 caption 直接吃宿主的 --dsw-alias-label-caption，浅色下是 #adb2b8
   （白底 2.13:1、卡片底 1.98:1），小字基本看不见。统一压到 bluish-700 一档。
   .plt-pin 只在 hover 时才显现，但显现的那一下必须看得清，所以基线色也要给。 */
body:not([data-ds-dark-theme]) .plt-sec-hint{color:#646b77}
body:not([data-ds-dark-theme]) .plt-pin{color:#646b77}
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
/* id=226：实心胶囊在浅色下的两处对比度修补。
   ①「全部通过 / 批量转待执行」原来用近黑的 #1b1200 压在琥珀/草绿强调色上，
      浅色档压深后底色变深（琥珀 138,95,6、草绿 17,107,54），近黑字只剩 3.4:1，
      换成白字后 4.70 / 5.44，两个强调色都过线。
   ②「批量删除」的红色是给深底调的 rgba(.92/.82) 半透明，浅底上合成出来只有 3.73:1，
      浅色改成实心红（#c0392b → #a83232，白字 5.98）。 */
body:not([data-ds-dark-theme]) .plt-bulk-pass,
body:not([data-ds-dark-theme]) .plt-bulk-promote{color:#fff}
/* 底色也要给：基础样式是 .98/.82 的半透明渐变，叠在浅色批量条上算出来只有 3.16:1，
   浅色下改成 1/.9 的实心渐变（琥珀 5.08、草绿 5.87），保留上下渐变的层次感。 */
body:not([data-ds-dark-theme]) .plt-bulk-pass{background:linear-gradient(180deg,rgba(var(--plt-accent),1),rgba(var(--plt-accent),.9))}
body:not([data-ds-dark-theme]) .plt-bulk-promote{background:linear-gradient(180deg,rgba(var(--plt-accent),1),rgba(var(--plt-accent),.9))}
body:not([data-ds-dark-theme]) .plt-bulk-pass:hover:not(:disabled),
body:not([data-ds-dark-theme]) .plt-bulk-promote:hover:not(:disabled){background:linear-gradient(180deg,rgba(var(--plt-accent),1),rgba(var(--plt-accent),.96))}
body:not([data-ds-dark-theme]) .plt-bulk-del{
  border-color:rgba(150,44,38,.85);
  background:linear-gradient(180deg,#c0392b,#a83232);
  box-shadow:0 1px 2px rgba(90,20,16,.22),0 0 12px -5px rgba(192,57,43,.7);
}
body:not([data-ds-dark-theme]) .plt-bulk-del:hover:not(:disabled){background:linear-gradient(180deg,#d94f43,#b83a30)}

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
body:not([data-ds-dark-theme]) .plt-split-mask{background:rgba(20,40,70,.16)}
body:not([data-ds-dark-theme]) .plt-split-card{
  border:1px solid rgba(20,40,70,.30);
  background:linear-gradient(180deg,#ffffff,#f8fbff);
  box-shadow:0 1px 2px rgba(16,32,64,.10),0 10px 22px -8px rgba(16,32,64,.20),0 30px 58px -24px rgba(20,40,80,.24),inset 0 1px 0 rgba(255,255,255,.92);
  color:#20293a;
}
/* 浅色下转圈用深一档的蓝，白底上 #8ab0f5 会糊。 */
body:not([data-ds-dark-theme]) .plt-split-card svg{color:#3a72c8}
body:not([data-ds-dark-theme]) .plt-split-card .plt-split-hint{color:#5b6675}
`)
