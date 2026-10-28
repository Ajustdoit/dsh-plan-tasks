    /**
     * 操作条与胶囊：类型胶囊、拆解胶囊、发送/草稿/深入圆钮、操作符与页脚。
     *
     * 本片段是 CSS_PARTS 的一段，位置即层叠顺序（由 build.mjs 按文件名字典序拼接）。
     */
    CSS_PARTS.push(`.plt-chip{display:inline-flex;align-items:center;gap:5px;cursor:pointer;border:1px solid transparent;background:var(--dsw-alias-bg-secondary,rgba(255,255,255,.06));color:var(--dsw-alias-label-secondary,#c8c8c8);border-radius:999px;padding:6px 11px 6px 9px;font-size:14px;line-height:1;white-space:nowrap;font-family:inherit;transition:background .12s ease,color .12s ease,border-color .12s ease}
.plt-chip:hover:not(:disabled){background:var(--dsw-alias-bg-hover,rgba(255,255,255,.11));color:var(--dsw-alias-label-primary,#e6e6e6)}
.plt-chip.active{background:rgba(80,140,255,.18);border-color:rgba(80,140,255,.5);color:#9dc0ff}
.plt-chip:disabled{opacity:.5;cursor:default}
.plt-chip svg{flex:0 0 auto;opacity:.95;display:block}
/* 图标单独套一层定高定宽的居中盒：SVG 的 display:block 会让它按基线落位，
   和 14px 文字排在一起时矮半像素；这层 line-height:0 的 flex 盒子把它钉在文字中线上。 */
.plt-chip-ico{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;line-height:0}
.plt-chip-txt{display:inline-flex;align-items:center;line-height:1}
/* 发送钮加宽（id=174）：32 → 38px（+18.75%，落在需求给的 10%~20% 区间），只动水平方向。
   圆角必须跟着从 50% 换成定值 16px：50% 按各自轴算，38x32 得到 rx=19/ry=16 的压扁椭圆，
   端部不是半圆；16px = 高度的一半，两轴都不触发 CSS 半径收缩，是精确的「两端半圆 + 直边」胶囊。
   （实测比对 .shot/174-inset.mjs；999px 与 16px 在这台 Chrome 上逐行一致 —— 999 会被收缩规则
   clamp 回 16，但 16px 不依赖那条规则，且面板压矮的窄档把尺寸改成 26x26 时，
   16+16>26 自动 clamp 成 13 = 边长一半，回到正圆，一个值两种尺寸都对。）
   高度、字号、颜色、内边距、垂直居中（align/justify:center）全部保持不变。 */
.plt-send{flex:0 0 auto;width:38px;height:32px;border-radius:16px;border:none;padding:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-accent,#2f6fd0);color:#fff;box-shadow:0 2px 6px -2px rgba(47,111,208,.55),inset 0 1px 0 rgba(255,255,255,.22);transition:transform .1s ease,opacity .12s ease,background .12s ease,box-shadow .14s ease}
.plt-send:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 10px -3px rgba(47,111,208,.62),inset 0 1px 0 rgba(255,255,255,.26)}
.plt-send:active:not(:disabled){transform:translateY(0) scale(.96)}
.plt-send:disabled{opacity:.38;cursor:default}
/* 草稿开关：发送键同款圆形，默认只是灰圈（未启用），点亮后变绿实心。 */
.plt-draft-toggle{flex:0 0 auto;width:32px;height:32px;border-radius:50%;padding:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;background:transparent;color:var(--dsw-alias-label-caption,#9a9a9a);border:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,.16));transition:transform .1s ease,color .12s ease,border-color .12s ease,background .12s ease,box-shadow .14s ease}
/* hover 只做「当前状态稍微加深」，不换成另一种颜色（id=107）。 */
.plt-draft-toggle:hover:not(:disabled){background:rgba(150,158,170,.10);border-color:rgba(150,158,170,.4)}
.plt-draft-toggle:active:not(:disabled){transform:scale(.94)}
.plt-draft-toggle:disabled{opacity:.38;cursor:default}
.plt-draft-toggle.on{background:rgba(52,190,110,.92);color:#fff;border-color:transparent;box-shadow:0 2px 7px -2px rgba(52,190,110,.6),inset 0 1px 0 rgba(255,255,255,.22)}
.plt-draft-toggle.on:hover:not(:disabled){color:#fff;background:rgba(40,164,96,.96)}
/* 深入开关：与草稿开关同一套造型，点亮后用靛蓝，和「草稿=绿」区分开。 */
.plt-deep-toggle{flex:0 0 auto;width:32px;height:32px;border-radius:50%;padding:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;background:transparent;color:var(--dsw-alias-label-caption,#9a9a9a);border:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,.16));transition:transform .1s ease,color .12s ease,border-color .12s ease,background .12s ease,box-shadow .14s ease}
.plt-deep-toggle:hover:not(:disabled){background:rgba(150,158,170,.10);border-color:rgba(150,158,170,.4)}
.plt-deep-toggle:active:not(:disabled){transform:scale(.94)}
.plt-deep-toggle:disabled{opacity:.38;cursor:default}
.plt-deep-toggle.on{background:rgba(104,116,232,.92);color:#fff;border-color:transparent;box-shadow:0 2px 7px -2px rgba(104,116,232,.62),inset 0 1px 0 rgba(255,255,255,.22)}
.plt-deep-toggle.on:hover:not(:disabled){color:#fff;background:rgba(88,100,216,.96)}
/* 拆解模式：贴在「仅回答」右侧的独立开关（不属于任务类型，两者可共存）。
   与类型胶囊靠「形状」区分而不只是颜色：圆角方块 + 虚线空心（未选中）／ 琥珀实心 + 实线（选中）；
   类型胶囊是全圆胶囊、选中走蓝色，两者形状与色系都不同，一眼能看出它是「叠加」不是「三选一」。 */
.plt-chip-split{position:relative;border-radius:9px;padding:0 10px;gap:5px;background:rgba(255,255,255,.02);border:1px dashed rgba(255,255,255,.26);color:var(--dsw-alias-label-secondary,#aab2bf);letter-spacing:.02em}
.plt-chip-split:hover:not(:disabled){background:rgba(255,255,255,.08);border-color:rgba(255,163,64,.62);color:#f0b060}
.plt-chip.plt-chip-split.active{background:rgba(214,132,32,.88);border:1px solid rgba(255,186,104,.9);color:#fff;box-shadow:0 2px 8px -2px rgba(214,132,32,.6),inset 0 1px 0 rgba(255,255,255,.28)}
.plt-chip.plt-chip-split.active:hover:not(:disabled){background:rgba(226,144,40,.94);border-color:rgba(255,200,130,.95);color:#fff}
/* 选中态右上角小圆点：明示这是叠加在已选类型之上的开关，不是第四个互斥选项。 */
.plt-chip.plt-chip-split.active::after{content:'';position:absolute;top:3px;right:3px;width:5px;height:5px;border-radius:50%;background:#fff;opacity:.85}
.plt-foot{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:5px 12px 9px;color:var(--dsw-alias-label-caption,#8a8a8a);font-size:14px;opacity:.8}
.plt-foot-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`)
