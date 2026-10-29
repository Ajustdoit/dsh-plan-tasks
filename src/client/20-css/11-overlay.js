    /**
     * 遮罩与顶部行内提示：拆解中的贴边提示卡、提交/审核结果的提示文字。
     *
     * 本片段是 CSS_PARTS 的一段，位置即层叠顺序（由 build.mjs 按文件名字典序拼接）。
     */
    CSS_PARTS.push(`/* 拆解遮罩：点发送立刻盖上，右侧贴边一张提示卡。
   pointer-events:none 是刻意的 —— 遮罩只做视觉提示，不接管点击，
   底下（以及侧边栏其它）按钮仍然可以正常点，不会出现「点不动了」。 */
.plt-split-mask{position:absolute;inset:0;z-index:18;background:rgba(6,14,26,.42);pointer-events:none;animation:plt-split-fade .16s ease both}
/* 卡片层级永远高于遮罩（它是遮罩的子节点，天然在上）。
   id=171：从「贴右边缘探出来」改成面板正中 —— left:50% + translate(-50%,-50%)，
   圆角/边框/阴影都恢复四边对称（贴边时代的 border-right:none、单侧投影都是为贴合用的）。 */
.plt-split-card{
  position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
  display:flex;align-items:center;gap:12px;
  /* id=213：原来是纯内容撑开（实测恒为 164×64.3，跟面板宽高一点关系都没有），
     看着像个小气泡，用户反馈「有点小」。这里按面板宽度给个显式宽度（76% → 封顶 240px），
     纵向 padding 一并加厚，让卡片整体放大 ~1.45 倍而**宽高比基本不变**（原 2.55:1）。
     id=214：补上下限。四条全挂在面板尺寸上（cqw/cqh 以 .plt-root 为容器，见 10-topbar.js:13），
     不写死像素：
       · min-width 是硬下限（150px），保证极窄侧栏下不塌成一条；
         但它自身再被 92cqw 夹一次，所以「抬高下限」永远不会导致横向溢出。
       · max-width 是兜底封顶，比 width 宽一档，正常永远不生效 —— 只有将来 width 被改小/内容
         撑破时才会接管，避免横向跑出面板。
       · min-height / max-height 夹住纵向：矮面板下不让卡片高过面板（否则内容被面板裁掉），
         此时卡片内部自己滚动（overflow:auto），比静默裁切可读。
     width/max-width 这里刻意用 cqw 而不是百分比 —— 百分比算的是包含块（遮罩），
     与 min() 混用推不直观；cqw 就是面板宽度的 1%，一眼可算。 */
  width:min(76cqw,240px);
  min-width:min(150px,92cqw);
  max-width:min(92cqw,300px);
  min-height:min(64px,28cqh);
  max-height:min(78cqh,240px);
  overflow:auto;
  box-sizing:border-box;
  /* id=215：内边距从 22/20 改成 20/22 —— 横向略大于纵向是卡片的常规比例，
     原来的「纵向比横向还厚」让两行字看着被上下夹扁。 */
  padding:20px 22px;
  /* 圆角对齐输入区那张「悬浮卡片」（.plt-composer 的 14px），不再自成一套 12px。 */
  border-radius:14px;
  border:1px solid rgba(124,162,232,.22);
  /* 底色跟着输入区那套走：上亮下暗的极淡渐变（模拟顶部受光），不再是一块纯色。 */
  background:linear-gradient(180deg,rgba(28,36,50,.97),rgba(20,27,38,.97));
  /* 阴影分三层，和输入区卡片同一套「贴地影 + 中距扩散 + 远距弥散」再加一道顶部内高光：
     单层大投影会让卡片看着像贴在纸上，分层才有厚度。 */
  box-shadow:0 2px 4px rgba(3,9,22,.34),0 12px 26px -10px rgba(4,12,30,.6),0 32px 60px -26px rgba(8,20,48,.66),inset 0 1px 0 rgba(158,190,246,.14);
  color:#f2f4f7;font-size:15px;line-height:1.6;
  pointer-events:auto;
  animation:plt-split-in .22s cubic-bezier(.22,.9,.28,1) both;
}
/* 转圈给一点蓝：它原来跟正文同色（近白），在放大后的卡片里显得发灰、不像「正在进行」。
   取值与插件主色同一支（深色下偏亮的蓝，浅色下用深一档的蓝）。 */
.plt-split-card svg{color:#8ab0f5;flex:0 0 auto}
.plt-split-card .plt-split-text{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1 1 auto}
.plt-split-card .plt-split-text strong{font-weight:600;letter-spacing:.1px}
.plt-split-card .plt-split-hint{color:rgba(232,238,247,.68);font-size:13px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@keyframes plt-split-fade{from{opacity:0}to{opacity:1}}
/* 进场关键帧必须与基础样式的 transform 用同一套居中值：
   animation 的 fill-mode 是 both，动画跑完后保留的是**关键帧里的 to**，不是基础样式 ——
   若 to 还写着旧的 translate(0,-50%)，卡片会永久偏右半个身位（实测 dx=+56px）。
   方向也换了：贴边时代是从左往右滑进面板；居中后改成从中心上方 14px 落位，不再横向漂移。 */
@keyframes plt-split-in{from{opacity:0;transform:translate(-50%,calc(-50% - 14px))}to{opacity:1;transform:translate(-50%,-50%)}}
@media (prefers-reduced-motion: reduce){
  .plt-split-mask{animation:none}
  .plt-split-card{animation:none}
}
/* 顶部行内提示：提交 / 审核 / 拖拽保存的结果，显示在自动刷新按钮左侧。 */
.plt-notice{flex:0 1 auto;min-width:0;max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:18px;padding:0 7px;border-radius:999px;background:rgba(76,175,80,.13);border:1px solid rgba(76,175,80,.32);color:#6fc47a}
/* 输入区做成「悬浮卡片」：整块从列表里抬起来。
   立体感由四层叠出来 ——
   1) 渐变底：上亮下暗，模拟顶部受光；
   2) 内斜面：顶部 1px 白高光 + 底部 1px 暗边，形成厚度；
   3) 两层外投影：近距离贴地影 + 远距离扩散影；
   4) 卡片下方一道模糊的接触阴影（.plt-form-wrap::after），让它「离地」。 */
/* 输入区现在贴在面板底部（列表在上、输入在下）：上留白给列表一点呼吸，
   下留白让卡片离底边有距离，接触阴影落在卡片正下方。 */
/* 输入区保持在本层：拆解遮罩是 pointer-events:none，不会拦点击，
   而遮罩里的提示卡片（z-index 18）仍然盖在输入区之上，读起来是「浮在最上层」的那一层。 */
.plt-form-wrap{position:relative;z-index:2;flex:0 0 auto;padding:8px 12px 11px 12px}
/* 卡片正下方的接触阴影：横向收窄的椭圆模糊，投影越实、悬浮感越强。带一点蓝，和卡片同色系。 */
.plt-form-wrap::after{content:'';position:absolute;left:26px;right:26px;bottom:2px;height:14px;border-radius:50%;background:rgba(6,14,32,.52);filter:blur(10px);z-index:0;pointer-events:none}
/* 偏蓝的深色 + 蓝色渐变：底色走带蓝相的海军墨蓝，
   上面叠一层从左上到右下的蓝色渐变（蓝 → 微紫 → 深蓝收尾），
   再加第二层顶部高光，整体「沉一点的蓝」而不是发灰的黑。 */
.plt-composer{position:relative;z-index:1;display:flex;flex-direction:column;gap:7px;background:
  radial-gradient(120% 140% at 8% 0%,rgba(96,152,255,.22),rgba(96,152,255,0) 58%),
  linear-gradient(135deg,rgba(64,116,224,.20) 0%,rgba(92,120,232,.10) 46%,rgba(10,26,58,.30) 100%),
  linear-gradient(180deg,rgba(92,142,232,.10),rgba(92,142,232,0) 46%,rgba(2,8,20,.34)),
  var(--plt-composer-bg,#0d1830);border:1px solid rgba(96,146,236,.24);border-radius:14px;padding:10px 10px 9px;box-shadow:0 2px 3px rgba(3,9,22,.26),0 10px 22px -8px rgba(4,12,30,.62),0 26px 50px -22px rgba(8,20,48,.66),0 0 0 1px rgba(96,146,236,.05),inset 0 1px 0 rgba(140,180,255,.14),inset 0 -1px 0 rgba(2,8,20,.55),inset 0 0 0 1px rgba(120,166,246,.02);transition:border-color .16s ease,box-shadow .18s ease,transform .18s ease}
.plt-composer:hover{transform:translateY(-1px);border-color:rgba(112,164,250,.38);box-shadow:0 2px 3px rgba(3,9,22,.28),0 14px 28px -8px rgba(6,16,38,.64),0 34px 58px -24px rgba(10,26,60,.68),0 0 22px -6px rgba(76,132,224,.22),inset 0 1px 0 rgba(150,190,255,.18),inset 0 -1px 0 rgba(2,8,20,.56)}
.plt-composer:focus-within{transform:translateY(-2px);border-color:var(--dsw-alias-border-accent,rgba(96,152,255,.72));box-shadow:0 0 0 3px rgba(80,140,255,.16),0 2px 3px rgba(3,9,22,.2),0 18px 34px -8px rgba(6,18,44,.56),0 40px 70px -26px rgba(10,28,66,.64),0 0 30px -6px rgba(86,144,238,.3),inset 0 1px 0 rgba(168,202,255,.26),inset 0 -1px 0 rgba(2,8,20,.46)}
/* 聚焦时卡片顶部落一道淡蓝渐隐，强化「被拿起来」的感觉。 */
.plt-composer::before{content:'';position:absolute;inset:0;z-index:0;border-radius:inherit;pointer-events:none;opacity:0;transition:opacity .2s ease;background:linear-gradient(180deg,rgba(96,152,255,.20),transparent 52%)}
.plt-composer:focus-within::before{opacity:1}
/* 文字层与操作层压在渐隐之上，避免那层极淡的蓝把正文染灰。 */
.plt-composer .plt-input,.plt-composer .plt-bar{position:relative;z-index:1}
@media (prefers-reduced-motion: reduce){.plt-composer{transition:border-color .16s ease,box-shadow .18s ease}.plt-composer:hover,.plt-composer:focus-within{transform:none}}`)
