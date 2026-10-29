    /**
     * 悬浮提示（tooltip）组件样式（id=249）。
     *
     * 颜色一个都不写死 —— 全部走 05-tooltip-vars.js 定义的 `--plt-tip-*`，
     * 所以主题一切换（body 上 data-ds-dark-theme 加/减）这里不用改一个字。
     *
     * 几个关键决定：
     * 1. `position:fixed` 而不是 absolute：面板里有 overflow:hidden 的滚动容器
     *    （.plt-group / .plt-list / .plt-body），absolute 的气泡一出面板就被裁掉半截。
     *    注意 .plt-root 带 container-type:size（见 10-topbar.js:13），按 CSS Containment
     *    规范它同时是 fixed 后代的包含块 —— 所以气泡会被夹在面板里，坐标相对面板算，
     *    正好是我们想要的：提示只在侧栏内活动，不会飘到宿主界面上。坐标由脚本传入（id=250）。
     * 2. `pointer-events:none`：气泡永远不接鼠标，否则它压在目标元素上会立刻触发
     *    mouseleave → 气泡消失 → 又触发 mouseenter，闪成一片（这是 hover 气泡的经典坑）。
     * 3. `white-space:pre-line`：原生 title 里本来就用 `\n` 分段（.plt-name 的
     *    `#id 名称\n\n正文`），pre-line 既保留换行又照常自动折行，比 `<br>` 省事。
     * 4. `overflow-wrap:anywhere`：正文里可能有超长路径（D:/cf/code/...），
     *    不加这条会横向撑破 max-width。
     * 5. 箭头用两个伪元素叠出来：`::before` 是比气泡大 1px 的描边三角、
     *    `::after` 是填色三角盖在上面。只用一层填色三角的话，气泡有 1px 边框、
     *    箭头没边框，接缝处会断一截，看着像贴歪了。
     * 6. `z-index:60`：要压过拆解遮罩（18）、组头 sticky（3）、弹窗（30 上下）。
     */
    CSS_PARTS.push(`
.plt-tip{position:fixed;z-index:60;box-sizing:border-box;max-width:var(--plt-tip-max-w);padding:var(--plt-tip-pad);border:1px solid var(--plt-tip-border);border-radius:var(--plt-tip-radius);background:var(--plt-tip-bg);color:var(--plt-tip-fg);box-shadow:var(--plt-tip-shadow);font-size:var(--plt-tip-font);line-height:var(--plt-tip-line);font-weight:400;font-style:normal;letter-spacing:.01em;text-align:left;white-space:pre-line;overflow-wrap:anywhere;word-break:break-word;pointer-events:none;opacity:0;transition:opacity var(--plt-tip-fade) ease,transform var(--plt-tip-fade) ease}
/* 出现时只把不透明度与位移收回来，不留 display 切换 —— 那会让淡出根本没时间播。 */
.plt-tip.is-on{opacity:1;transform:none}
/* 箭头基底：0 尺寸 + border 拼三角，颜色按方向各给一条。 */
.plt-tip::before,.plt-tip::after{content:'';position:absolute;width:0;height:0;border-style:solid;border-color:transparent;pointer-events:none}
.plt-tip::before{border-width:calc(var(--plt-tip-arrow) + 1px)}
.plt-tip::after{border-width:var(--plt-tip-arrow)}
/* —— 上：气泡在目标之上，箭头朝下 —— */
.plt-tip--top{transform:translateY(3px)}
.plt-tip--top::before{left:50%;bottom:calc(-1 * (var(--plt-tip-arrow) + 1px));margin-left:calc(-1 * (var(--plt-tip-arrow) + 1px));border-top-color:var(--plt-tip-border)}
.plt-tip--top::after{left:50%;bottom:calc(-1 * var(--plt-tip-arrow));margin-left:calc(-1 * var(--plt-tip-arrow));border-top-color:var(--plt-tip-bg)}
/* —— 下：箭头朝上 —— */
.plt-tip--bottom{transform:translateY(-3px)}
.plt-tip--bottom::before{left:50%;top:calc(-1 * (var(--plt-tip-arrow) + 1px));margin-left:calc(-1 * (var(--plt-tip-arrow) + 1px));border-bottom-color:var(--plt-tip-border)}
.plt-tip--bottom::after{left:50%;top:calc(-1 * var(--plt-tip-arrow));margin-left:calc(-1 * var(--plt-tip-arrow));border-bottom-color:var(--plt-tip-bg)}
/* —— 左：箭头朝右 —— */
.plt-tip--left{transform:translateX(3px)}
.plt-tip--left::before{top:50%;right:calc(-1 * (var(--plt-tip-arrow) + 1px));margin-top:calc(-1 * (var(--plt-tip-arrow) + 1px));border-left-color:var(--plt-tip-border)}
.plt-tip--left::after{top:50%;right:calc(-1 * var(--plt-tip-arrow));margin-top:calc(-1 * var(--plt-tip-arrow));border-left-color:var(--plt-tip-bg)}
/* —— 右：箭头朝左 —— */
.plt-tip--right{transform:translateX(-3px)}
.plt-tip--right::before{top:50%;left:calc(-1 * (var(--plt-tip-arrow) + 1px));margin-top:calc(-1 * (var(--plt-tip-arrow) + 1px));border-right-color:var(--plt-tip-border)}
.plt-tip--right::after{top:50%;left:calc(-1 * var(--plt-tip-arrow));margin-top:calc(-1 * var(--plt-tip-arrow));border-right-color:var(--plt-tip-bg)}
/* 文字装在内层，外层只负责边框、箭头与定位（id=251）。
   高度上限由脚本按面板高度写进 style，这里只声明「超了就裁」——
   放在外层会连箭头的位子一起裁掉，所以只能在内层裁。 */
.plt-tip-inner{overflow:hidden}
/* 气泡贴边翻到另一侧时，箭头不需要跟着重描 —— 方向类一换，上面四组自动就位。 */

/* 用户要求减少动效：连位移一起撤掉，只保留瞬时显隐（不做淡入也照样能读）。 */
@media (prefers-reduced-motion: reduce){
  .plt-tip{transition:none;transform:none}
}
/* 浅色不需要额外规则：颜色全部来自变量，而变量在 30-light.js 里已经换过一套。
   这里刻意不写 body:not([data-ds-dark-theme]) 覆盖 —— 多一套就多一处会忘记同步的地方。 */
`)
