    /**
     * 输入框与响应式：高度按容器收放、placeholder、容器查询分档。
     *
     * 本片段是 CSS_PARTS 的一段，位置即层叠顺序（由 build.mjs 按文件名字典序拼接）。
     */
    CSS_PARTS.push(`.plt-input{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-tertiary,rgba(0,0,0,.2));color:inherit;border:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,.14));border-radius:6px;padding:6px 8px;font-size:16px;font-family:inherit;resize:vertical;min-height:104px;line-height:1.5}
.plt-input::placeholder{font-size:16px;color:var(--dsw-alias-label-tertiary,#6b7280)!important;opacity:1!important}
/* —— Cursor 式输入区：整块一个圆角框，文字在上、胶囊标签在左下、圆形发送键在右下 ——
   （卡片外观与悬浮效果定义在 .plt-composer 的上面那段，这里只管内部排版） */
/* 输入区高度（id=152）：从固定的 104px 加高到 clamp(104px, 26cqh, 176px)。
   26cqh 按「本面板高度」算：常见窗口下取到上限 176px，输入面积比原来大六成；
   侧栏被拖矮时自动收到 104px 下限，把列表的空间让出来。 */
.plt-composer .plt-input{background:transparent;border:none;border-radius:0;padding:2px 2px 0;min-height:clamp(104px,26cqh,176px);resize:none;outline:none;line-height:1.55;caret-color:var(--dsw-alias-label-accent,#7fb0ff)}
/* 面板被拖到很矮时分档收缩（id=152）：26cqh 在 340px 以下已经到底限 104px，
   再矮就会把列表和操作条挤出面板。逐档收输入框、内外边距、胶囊与按钮尺寸，
   保证「操作条始终完整可见、列表至少留一行」。 */
@container (max-height: 340px){
  .plt-composer .plt-input{min-height:64px}
  .plt-form-wrap{padding-top:6px;padding-bottom:8px}
  .plt-list{padding-top:4px;padding-bottom:8px}
}
@container (max-height: 260px){
  .plt-composer .plt-input{min-height:52px}
  .plt-composer{gap:5px}
  .plt-form-wrap{padding:5px 10px 6px 10px}
}
@container (max-height: 200px){
  .plt-composer .plt-input{min-height:38px}
  .plt-chip{padding:3px 8px}
  .plt-deep-toggle,.plt-send{width:26px;height:26px}
  .plt-form-wrap{padding:4px 8px 5px 8px}
  .plt-list{padding-top:2px;padding-bottom:4px}
}
/* 暗色调：placeholder 用中灰而不是浅灰，避免整块看起来发白。
   注意：主题包 dsh-official-homepage-theme 会无条件给所有 input 的 placeholder
   打上 color:rgba(193,208,228,.72) !important（浅白蓝），在浅色主题的白底上等于隐形。
   这里必须同样用 !important 才能在层叠里压过它，否则默认提示文字会整个消失。 */
.plt-composer .plt-input::placeholder{color:var(--dsw-alias-label-tertiary,#6b7280)!important;opacity:1!important}
/* 胶囊标签在暗底上再压深一档，保持「暗色调」的统一。 */
.plt-composer .plt-chip{background:rgba(255,255,255,.045);border-color:rgba(255,255,255,.07);color:var(--dsw-alias-label-secondary,#aab2bf)}
.plt-composer .plt-chip:hover:not(:disabled){background:rgba(255,255,255,.09)}
/* 输入框下方的操作条：胶囊组 + D/F/S 三个圆钮，永远排成一行，不换行也不溢出（id=145）。
   宽度不够时按阶梯收缩：先收间距与内边距，最窄一档把胶囊文字换成纯图标
   （文字语义仍在 title / aria-label 上），这样四枚胶囊 + 三个圆钮始终齐整一行。 */
.plt-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;row-gap:6px;min-width:0;container-type:inline-size}
/* 面板窄到连纯图标的一行都放不下时，只让「三个圆钮」整体折到第二行并靠右，
   胶囊组始终完整一行、绝不截断 —— 这种情况下换行比切掉发送钮好。 */
.plt-bar>.plt-deep-toggle{margin-left:auto}
/* 胶囊组：横向可收缩但绝不换行；真的放下了也不许把胶囊截断，
   所以下限设 min-content —— 到那一步之前 .plt-chip-txt 已经被隐藏了。 */
.plt-chips{display:flex;flex-wrap:nowrap;align-items:center;gap:6px;flex:1 1 auto;min-width:min-content;overflow:hidden;scrollbar-width:none}
.plt-chips::-webkit-scrollbar{display:none}
/* 一个「段」= 可选连接符 + 一枚胶囊，段内不拆开，换行时连接符永远不会变成孤儿。 */
.plt-seg{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto}
/* 任务类型胶囊：定高 28px、左右内边距固定，四枚按钮高度与基线才能完全对齐。
   高度写死而不靠 padding 撑，是因为图标 13px 的中文行盒会随字体不同浮 1px。 */
.plt-bar .plt-chip{height:28px;box-sizing:border-box;padding:0 10px;justify-content:center}
/* 连接符（类型之间的「-」、拆解前的「+」）：定高与胶囊等高，靠 flex 居中，
   这样它和两侧文字的中线永远在同一条线上；左右由 .plt-seg 的 gap 拉开，因此等距。
   不能被选中，也不要响应鼠标。 */
.plt-op{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;height:28px;width:10px;font-size:14px;line-height:1;font-family:inherit;color:var(--dsw-alias-label-caption,#8a8a8a);opacity:.7;user-select:none;-webkit-user-select:none;pointer-events:none}
/* 窄一档：先收间距与内边距。 */
@container (max-width:560px){.plt-chips,.plt-seg{gap:4px}.plt-bar .plt-chip{padding:0 8px}}
/* 关键一档：图标+文字一起放不下时，先去掉图标、字号降一号 ——
   四个类型靠文字区分，读起来比看图省事，所以先舍图标而不是先舍文字。 */
@container (max-width:470px){.plt-bar .plt-chip-ico{display:none}.plt-bar .plt-chip{padding:0 9px;font-size:13px}.plt-chip-split{padding:0 9px}}
/* 再窄：连纯文字也挤了，才退回纯图标（语义仍在 title / aria-label 上）。 */
@container (max-width:360px){.plt-bar .plt-chip-txt{display:none}.plt-bar .plt-chip-ico{display:inline-flex}.plt-bar .plt-chip{padding:0 8px;font-size:14px}.plt-chip-split{padding:0 8px;border-radius:8px}}
/* 极窄面板：再收一档间隙。 */
@container (max-width:330px){.plt-chips,.plt-seg{gap:3px}.plt-bar .plt-chip{padding:0 5px}.plt-chip-split{padding:0 5px}.plt-bar{gap:6px}}`)
