    /**
     * 输入区骨架：悬浮卡片、聚焦光、列表容器与轮播/滚动条外壳。
     *
     * 本片段是 CSS_PARTS 的一段，位置即层叠顺序（由 build.mjs 按文件名字典序拼接）。
     */
    CSS_PARTS.push(`/* 外层列表自己绝不出滚动条：高度固定，只有展开的组内部滚动。 */
/* 列表容器：左右/下多留一点内边距，给三个组的外阴影留出扩散空间（否则会被 overflow 裁掉）。 */
.plt-list{flex:1 1 auto;min-height:0;overflow:hidden;display:flex;flex-direction:column;gap:9px;padding:8px 18px 16px 18px}`)
