    /**
     * 遮罩与顶部行内提示：拆解中的贴边提示卡、提交/审核结果的提示文字。
     *
     * 本片段是 CSS_PARTS 的一段，位置即层叠顺序（由 build.mjs 按文件名字典序拼接）。
     */
    CSS_PARTS.push(`/* 拆解遮罩：点发送立刻盖上，右侧贴边一张提示卡。
   pointer-events:none 是刻意的 —— 遮罩只做视觉提示，不接管点击，
   底下（以及侧边栏其它）按钮仍然可以正常点，不会出现「点不动了」。 */
.plt-split-mask{position:absolute;inset:0;z-index:18;background:rgba(6,14,26,.42);pointer-events:none;animation:plt-split-fade .16s ease both}
/* 卡片层级永远高于遮罩（它是遮罩的子节点，天然在上），贴右边缘、圆角只留左边两个。 */
.plt-split-card{
  position:absolute;top:50%;right:0;transform:translateY(-50%);
  display:flex;align-items:center;gap:9px;
  max-width:min(80%,250px);
  padding:11px 15px;
  border-radius:12px 0 0 12px;
  border:1px solid rgba(255,255,255,.16);border-right:none;
  background:rgba(30,34,42,.96);
  box-shadow:-12px 0 30px rgba(0,0,0,.38);
  color:#f2f4f7;font-size:13.5px;line-height:1.5;
  pointer-events:auto;
  animation:plt-split-in .22s cubic-bezier(.22,.9,.28,1) both;
}
.plt-split-card .plt-split-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.plt-split-card .plt-split-text strong{font-weight:600}
.plt-split-card .plt-split-hint{color:rgba(232,238,247,.62);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@keyframes plt-split-fade{from{opacity:0}to{opacity:1}}
/* 进场方向从左往右（往面板内部滑），不从右边缘外侧滑入 —— 后者会在动画期间
   把卡片顶出面板、撑出横向滚动条。 */
@keyframes plt-split-in{from{opacity:0;transform:translate(-14px,-50%)}to{opacity:1;transform:translate(0,-50%)}}
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
