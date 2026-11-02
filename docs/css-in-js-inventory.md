# CSS 在 JS 中的分布清单（迁移依据）

> 本条（id=71-A）**只调查、不改代码**。目标是弄清「样式到底以哪几种方式、从哪些文件、
> 在什么时机进入 DOM/元素」，作为后续迁移的清单。
>
> 调查范围：`dsh-plan-tasks/src/`（22 个文件）+ `dsh-plan-tasks/lib/`（35 个文件），
> 共 57 个 `.js`/`.mjs`。其中 `lib/client.js` 是构建产物（不参与调查，只用于核对）。
>
> **本文档是第二版**。第一版由 id=61-A 产出；此后源码发生了这些改动，
> 数字与行号已按**当前源码**重新核对：
>
> | 期间改动 | 对本清单的影响 |
> | --- | --- |
> | 草稿模式整体移除（id=405） | 删掉 12 个类、约 50 条规则；C 类少 2 个图标 |
> | 待执行与执行中改绿（id=406） | 只换颜色值，规则数不变 |
> | 移除待执行空心圆点（id=68/73） | 再减 2 个类（`plt-dot-only` / `plt-todo-ring`） |
> | 宿主删死代码（id=61-F） | `timing.js` 少了 `statusOf`/`timingOf`，仍无样式代码 |
>
> 结论结构没变：**仍然只有 A/B/C/D 四类，E 类为零**。

---

## 结论摘要（先看这个）

> 注：以下数字是 **id=61-A/71-A 调查时**的快照。迁移已在 id=71-D 完成，
> **当前实际数字见第 10 节**（C 类已清零、D 类只剩 6 行）。

| 形态 | 处数 | 位置 | 迁移难度 |
| --- | --- | --- | --- |
| A. `CSS_PARTS.push(\`…\`)` 模板字面量 | **13** | `src/client/20-css/*.js` | 低（纯静态文本） |
| B. `<style>` 元素注入 | **1** | `src/client/70-apply.js` | 低 |
| C. 内联 `style: {…}` 对象 | **15** | `10-icons.js`(14) + `60-tab.js`(1) | 低 |
| D. 逐条 `el.style.xxx =` 赋值 | **15** | `40-tip.js`(12) + `30-runtime.js`(3) | **高**（几何/运行时计算） |
| E. `innerHTML` / `<style>` 字符串 / `createElement('style')` 滥用 | **0** | — | — |

**关键结论：`lib/` 侧完全不含任何样式代码**（见第 6 节），
所以这次迁移是纯客户端工作，不涉及宿主与重启。

---

## 1. A 类：`CSS_PARTS.push` 模板字面量（13 处）

### 机制

不是「样式写在 JS 字符串里各写各的」，而是**一个有意的分片体系**：

```js
// 15-css-decl.js
const CSS_PARTS = []
// 20-css/*.js（13 个片段，每个一次 push）
CSS_PARTS.push(`…纯 CSS 文本…`)
// 25-css-join.js
const CSS = CSS_PARTS.join('\n')
// 70-apply.js
el.textContent = CSS
```

片段顺序 = 文件名字典序（`build.mjs` 按文件名拼接），
所以 `20-css/` 下的前缀数字 `05 / 06 / 10 … 30` **就是层叠顺序**，
`30-light.js` 永远排在深色片段之后（浅色覆盖靠顺序 + 特异性双重生效）。

### 逐片段清单

| 文件 | push 次数 | 文件行数 | 规则数 | 运行时插值 | 主要类名前缀 |
| --- | --- | --- | --- | --- | --- |
| `20-css/05-tooltip-vars.js` | 1 | 40 | 1 | 无 | plt-root plt-bar |
| `20-css/06-tooltip.js` | 1 | 61 | 20 | 无 | plt-tip plt-tip--top plt-tip--bottom plt-tip--left plt-tip--right … |
| `20-css/10-topbar.js` | 1 | 55 | 22 | 无 | plt-root plt-top plt-title plt-btn plt-auto … |
| `20-css/11-overlay.js` | 1 | 98 | 21 | 无 | plt-split-mask plt-split-card plt-root plt-composer plt-split-text … |
| `20-css/12-composer.js` | 1 | 9 | 1 | 无 | plt-list |
| `20-css/13-item.js` | 1 | 130 | 68 | 无 | plt-item plt-name plt-dropped plt-sublime plt-group-h … |
| `20-css/14-groups.js` | 1 | 113 | 56 | 无 | plt-group plt-group-reviewed plt-group-unreviewed plt-group-todo plt-group-body … |
| `20-css/15-detail.js` | 1 | 221 | 61 | 无 | plt-id plt-name plt-head plt-dur plt-tag … |
| `20-css/16-bulk.js` | 1 | 64 | 37 | 无 | plt-bulk plt-check plt-bulk-count plt-bulk-pass plt-bulk-danger … |
| `20-css/17-input.js` | 1 | 71 | 31 | 无 | plt-input plt-composer plt-form-wrap plt-list plt-chip … |
| `20-css/18-chips.js` | 1 | 45 | 24 | 无 | plt-chip plt-chip-ico plt-chip-txt plt-send plt-deep-toggle … |
| `20-css/19-kids.js` | 1 | 148 | 34 | 无 | plt-head plt-item plt-parent plt-name plt-kids … |
| `20-css/30-light.js` | 1 | 364 | 137 | 无 | plt-root plt-group-reviewed plt-group-unreviewed plt-group-todo plt-deep-toggle … |

**规则总数 513 条**（13 个片段合计，按行首选择器计）。

### 触发时机

**初始化（模块加载时）**。`CSS_PARTS.push(...)` 在片段被求值时立即执行，
一次性拼成一个大字符串。此后不再变化。

### 是否依赖运行时变量

**不依赖。** 已逐文件核查：13 个片段全部是纯静态 CSS 文本，
**没有一处 `${...}` 插值**（`var(--plt-accent)` 这类 CSS 自定义属性是 CSS 自己的机制，
不是 JS 插值）。这是迁移最有利的条件 —— 片段可以原样搬到 `.css` 文件。

### 唯一的运行时挂钩

CSS 自定义属性 `--plt-accent` 由分组类名在**样式表里**定义
（`14-groups.js` 的 `.plt-group-unreviewed{--plt-accent:255,180,60}`），
JS 侧只在个别地方写内联色（见 C 类第 2 条），不透传数值进样式表。

---

## 2. B 类：`<style>` 元素注入（1 处）

`src/client/70-apply.js:3-11`

```js
ctx.effect(() => {
  const el = document.createElement('style')
  el.setAttribute('data-dsh-plan-tasks', '')
  el.textContent = CSS
  document.head.appendChild(el)
  return () => { if (el.parentNode !== null) el.parentNode.removeChild(el) }
}, 'dsh-plan-tasks: styles')
```

| 项目 | 值 |
| --- | --- |
| 触发时机 | **插件 apply 阶段**（挂载一次） |
| 选择器 | 无（内容就是第 1 节拼好的整份 CSS） |
| 依赖运行时变量 | 否（`CSS` 是常量） |
| 生命周期 | 由 `ctx.effect` 管理：卸载时移除节点 |

这是**唯一**把 CSS 文本写进 DOM 的入口。迁移时这里换成
`import './styles.css'` 或构建期抽取，其余 13 个片段不需要感知。

---

## 3. C 类：内联 `style: {…}` 对象（17 处）

hyperscript 写法里的 `style` 属性，渲染时由框架展开成 `element.style`。

### 3.1 `src/client/10-icons.js` —— 14 处

| 行号 | 内容 | 说明 |
| --- | --- | --- |
| 23-27 | `{display:'block', flex:'0 0 auto', color: ICON_BLUE}`（**多行写法**，`color` 在第 26 行） | `PlanIcon` 唯一带颜色的一处 |
| 77 / 114 / 141 / 215 / 238 | `{display:'block'}` | 各图标基础 |
| 169 | `{display:'block'}`（缩进 8 格，与上面几个不同层） | 同上 |
| 260 / 291 / 321 / 350 / 380 / 403 / 427 | `{display:'block', flex:'0 0 auto'}` | 需要与文字并排、不被压缩的图标 |

（行号按当前源码核对过两遍。注意 `PlanIcon` 那个 `style` 对象是**跨行**的：
`grep 'style: {'` 只命中第 23 行，`color` 却在第 26 行 —— 数「带颜色的图标」时容易漏。
id=405 删掉 `DraftIcon` / `EditIcon` 后，总数从 16 降到 **14**。）

| 项目 | 值 |
| --- | --- |
| 触发时机 | **每次渲染**（图标组件被调用时） |
| 选择器 | 无类名，直接作用于 `<svg>` |
| 依赖运行时变量 | **一处**：`ICON_BLUE`（`00-loader-head.js:133` 的 `var(--dsw-static-deepseek-500, #4176e6)`）。其余是固定字面量。 |

**迁移注意**：`display:'block'` 与 `flex:'0 0 auto'` 对**每一个**图标都相同，
适合收成一条 `.plt-ico` 类；`color: ICON_BLUE` 只属于 `PlanIcon`，
且值本身已经是一个 CSS 变量引用 —— 迁到样式表后可直接写成 `color: var(--dsw-static-deepseek-500, #4176e6)`，
**反而消除了 JS→CSS 的字符串中转**。

### 3.2 `src/client/60-tab.js` —— 1 处

`60-tab.js:1755`

```js
{ className: 'plt-root', ref: rootRef, style: { position: 'relative' } }
```

| 项目 | 值 |
| --- | --- |
| 触发时机 | **每次渲染** |
| 选择器/类名 | `.plt-root`（这个类同时在 5 个 CSS 片段里被引用） |
| 依赖运行时变量 | 否 |

**迁移注意**：`.plt-root` 已经有大量样式（含 `container-type:size`），
`position:relative` 完全可以并入 `.plt-root` 规则，去掉内联。

---

## 4. D 类：逐条 `el.style.xxx =` 赋值（15 处）

**这一类是迁移风险最高的**，因为值来自运行时测量。

### 4.1 `src/client/40-tip.js` —— 12 处（悬浮气泡定位）

| 行 | 赋值 | 是否运行时计算 |
| --- | --- | --- |
| 84 | `visibility = 'hidden'`（创建时） | 否 |
| 134 | `visibility = 'hidden'`（每次 show 先藏） | 否 |
| 135 | `left = '0px'` | 否（测量前归零） |
| 136 | `top = '0px'` | 否（测量前归零） |
| 141 | `maxWidth = ${Math.round(maxW)}px` | **是**（面板宽度 − 2×margin，下限 120） |
| 144 | `inner.maxHeight = ${…max(48, panel.height−12)}px` | **是**（面板高度夹紧） |
| 161 | `transform = 'none'` | 否（测量前抵消方向类位移） |
| 163 | `transform = ''` | 否（恢复） |
| 164 | `left = ${Math.round(place.left + (panel.left − base.left))}px` | **是**（几何计算 + 包含块修正） |
| 165 | `top = ${…}px` | **是**（同上） |
| 166 | `visibility = ''` | 否 |
| 182 | `visibility = 'hidden'`（hide） | 否 |

**5 处依赖运行时变量**：`maxW`、`panel.height`、`place.left`、`place.top`、`base.left/top`。
另外 7 处是固定值（开关显隐、测量前归零、transform 抵消）。

| 项目 | 值 |
| --- | --- |
| 触发时机 | **事件回调**（hover/focus 进入 → `tipShow`；离开 → `tipHide`）。每次显示都重新测量。 |
| 选择器/类名 | `.plt-tip`（定位）、`.plt-tip-inner`（夹高度） |
| 依赖运行时变量 | **5 处**：`maxW`、`panel.height`、`place.left`、`place.top`、`base.left/top` |

**迁移判断**：这 5 处**不该迁进样式表**。CSS 无法表达「贴着锚点、按面板边缘翻转」的
几何计算。正确的分层是：

- 尺寸上限（`--plt-tip-max-w`、内边距等）→ 已由 `05-tooltip-vars.js` 用变量给出，**保持**；
- 每次显示的坐标 → 留在 JS（用 `el.style.setProperty('--plt-tip-x', …)` 也未必更好，
  因为它是单次性的、不需要层叠）。

**结论：D 类中 40-tip.js 的这 5 处属于「合理的运行时样式」，迁移清单里应标记为
「保留，不迁」**，其余 10 处（visibility 开关、归零、transform 抵消）可以考虑
收成语义类名（`.is-hidden` / `.is-on`），但收益有限。

### 4.2 `src/client/30-runtime.js` —— 3 处（剪贴板兜底）

`30-runtime.js:380-382`

```js
area.style.position = 'fixed'
area.style.top = '-1000px'
area.style.opacity = '0'
```

| 项目 | 值 |
| --- | --- |
| 触发时机 | **事件回调**（`copyText` 里 `navigator.clipboard` 失败时的兜底） |
| 选择器 | 无（临时 `<textarea>`，用完即删） |
| 依赖运行时变量 | 否（三个固定值） |

**迁移判断**：这三行是「把临时节点移出视口」的经典写法，值固定。
可以收成一个类（如 `.plt-offscreen`），但收益很小 —— 节点从不进入可见状态，
也不会被样式覆盖。**建议保留原样**，仅在清单里记录。

---

## 5. E 类：不推荐的写法（0 处）

逐项核查，**全部为 0**：

| 模式 | 结果 |
| --- | --- |
| `innerHTML =` / `insertAdjacentHTML` / `outerHTML` | 无 |
| `createElement('style')` | 仅 `70-apply.js` 的 1 处（B 类，正常用法） |
| 直接拼 `<style>` 字符串塞进 DOM | 无 |
| `el.style.cssText =` | 无 |
| `setProperty` / `setAttribute('style', …)` | 无 |

**这一点值得记**：项目里没有「样式散落在 JS 里靠字符串拼接」的技术债，
唯一的字符串形态就是有组织的 `CSS_PARTS` 分片体系。

---

## 6. `lib/` 侧：完全没有样式代码

核查范围 35 个文件（`lib/host/*.js` 33 个 + `lib/index.js` + `lib/client.js` 产物）。

```
grep "\.style|className|document\." lib/host/*.js lib/index.js  →  无命中
grep "<style|<div|<span|innerHTML" lib/host/*.js              →  无命中
```

`lib/host/decompose.js:63,74` 出现 `.css` 字样，但那是**文件扩展名白名单**
（用于识别模型输出里提到的文件路径），与样式无关。

**结论**：宿主是纯逻辑层（读写 plan.json、路由、归档），
**一行样式代码都没有**。整个迁移风险面只在 `src/client/`。

顺带确认一条既有约定：`lib/client.js` 是构建产物，所有改动都应在 `src/` 做，
`build.mjs --check` 会验证产物与片段一致（当前 22 片段的约束）。

---

## 7. 迁移建议（供后续步骤参考，本步不执行）

按「收益 ÷ 风险」排序：

| 优先级 | 对象 | 做法 | 风险 |
| --- | --- | --- | --- |
| 1 | A 类 13 个片段（513 条规则） | 原样搬到 `.css`，用构建期拼接收回一个字符串 | 低（纯静态、无插值、无运行时依赖） |
| 2 | C 类 14 处图标 style | 收成 `.plt-ico` + `PlanIcon` 专用色 | 低（值固定，一处已是 CSS 变量） |
| 3 | C 类 `.plt-root` 的 `position:relative` | 并入 `.plt-root` 规则 | 低 |
| 4 | D 类 30-runtime 的 3 处 | 可选，收益小 | 低 |
| — | **D 类 40-tip 的 5 处几何** | **不迁**：CSS 表达不了按测量结果定位 | — |

### 迁移时必须保住的三条

1. **片段顺序即层叠顺序**（`30-light.js` 必须排在深色之后）。
   搬成独立 `.css` 后，靠 `@import` 顺序或构建拼接顺序维持，不能改。
2. **`dead-css.mjs` 的检测面**：它只认 `.plt-*` 前缀，
   复合选择器（`.plt-tag.unreviewed`）与注释里写出的带点类名都会造成误判。
   迁移后要重跑 `npm test`（**当前基线：117 个类、无死规则**）。
   还有一条工具局限：它判「有没有人用」是**按名字在文件里出现**，
   所以注释里提到某个类也算「有引用」—— 判断真正的死规则时要手工 grep 一次。
3. **CSS 片段内不许出现反引号**：`CSS_PARTS.push(\`…\`)` 是模板字面量，
   CSS 注释里一个反引号就会截断字符串、导致构建语法错误（**已踩过 6 次**，
   最近一次是 id=404 在注释里写了示例 CSS）。
   迁到独立 `.css` 文件后这个约束自然消失 —— 这也是迁移的实际收益之一。
4. **改颜色的连带面**：组色在 `14-groups.js` 与 `30-light.js` 两处，
   但执行中状态有 16 处**硬编码**色值散在 4 个文件里（id=406 的教训）。
   迁移时如果把这些硬编码一并改成 `var(--plt-accent)`，要确认「执行中」与「组身份」
   是否真的应该同色 —— 目前是有意的两级。

---

## 附：调查方法（可复现）

```bash
# A 类
grep -rn "CSS_PARTS.push" src/ --include=*.js
# B 类
grep -rn "createElement('style')" src/ lib/ --include=*.js
# C 类
grep -rn "style: {" src/ --include=*.js
# D 类
grep -rn "\.style\.[a-zA-Z]" src/ lib/ --include=*.js
# E 类（应全为空）
grep -rn "innerHTML\|cssText\|setProperty" src/ lib/ --include=*.js
```

插值与选择器统计用 node 脚本完成（避免 shell 对 `${}` 的转义干扰），
见本步对话记录。

---

## 8. 复核时发现的一个实例：`plt-run-dot`

第二版复核时，我数「产物里出现过的 `.plt-*`」得到 **118** 个，
而 `dead-css.mjs` 报 **117** —— 差的这一个叫 `plt-run-dot`。

查下来它是 `50-item.js:536` 注释里的一个**笔误**：

```
尺寸（见 .plt-tag.running / .plt-run-dot）：外框固定 26×20 ……
```

实际类名是 **`plt-run-only`**（`15-detail.js:36` 定义、`50-item.js:577` 挂载）。
`plt-run-dot` 从来不存在。

两个教训，都值得写下来：

1. **dead-css 的「定义」判定会把注释算进去**。它扫的是原始文件文本，
   `.plt-run-dot` 在注释里带点写一次，就等于声称「这个类有定义」。
   所以它的 117 是「文件里提过的类名」，不等于「真实定义的类」。
   判断真实类数时要剥注释再数 —— 剥完就是 117，与它一致（因为这个笔误恰好只在注释里）。
2. **注释里的类名会腐化**。它是唯一一处提到 `plt-run-dot` 的地方，
   当初可能真叫这个名字、后来重命名了却漏改注释。
   这类错误 `dead-css` 抓不到、`npm test` 抓不到，只有人工核对数字对不上时才暴露。

已把那条注释改成 `.plt-tag.plt-run-only`，并顺手删掉同一段里残留的「草稿」字样
（草稿模式早在 id=405 移除了）。

---

## 9. 独立样式文件（id=71-B 产出）

第 1 节的 A 类（13 个片段 / 513 条规则）现在有了**第二份形态**：

| 形态 | 位置 | 用途 | 谁生成 |
| --- | --- | --- | --- |
| 字符串 | `src/client/20-css/*.js` 的 `CSS_PARTS` | 随客户端包注入 `<style>`，**实际生效** | 手写 |
| 纯 CSS | `assets/plan-tasks.css`（1413 行） | 可独立加载 / 可用普通 CSS 工具检查 | `build.mjs` 自动生成 |

两份内容**严格同源**：`build.mjs` 的 `syncAssets()` 从片段里原样抽取拼接，
`build.mjs --check` 会校验同步（不同步则构建失败），`npm test` 也会跑这条。
已用「各段拼回来 vs 注入内容」比对验证等价（95460 = 95460 字符）。

因此第 7 节的迁移优先级里，A 类那条现在有了现成的落点：
`assets/plan-tasks.css` 已经是纯 CSS 形态，后续若真要迁成「构建期直接读 .css」，
可以反向把这份当源、片段改为读取它。当前选择保持「片段为源」是为了不打断
`lib/client.js` 的单文件分发方式。

**类名前缀**（写进了生成文件的头部）：

- `.plt-*` —— 118 个插件自有类；
- `--plt-*` —— CSS 变量，只挂 `.plt-root`，**无一处 `:root`**；
- `.is-*` / `.open` / `.running` / `.failed` / `.interrupted` / `.dragging` /
  `.drop-target` / `.locked` / `.active` / `.done` / `.is-empty` ——
  状态修饰符，一律叠加在 `.plt-*` 元素上，从不单独出现，不会命中宿主同名类。

---

## 10. 迁移完成后的实际数字（id=71-D 之后）

第 1 节那张表是调查时的快照。迁完之后：

| 形态 | 调查时 | 现在 | 说明 |
| --- | --- | --- | --- |
| C. 内联 `style: {…}` 对象 | 15 | **0** | 全部改 `className`（14 个图标 + 1 处冗余） |
| D. 逐条 `el.style.xxx =` | 15 | **6** | 仅 `40-tip.js`，全部运行时几何量 |
| A. `CSS_PARTS` | 513 条 | **519 条** | 新增 6 条：图标 3 + offscreen 1 + tooltip 状态 2 |
| 类数 | 117 | **121** | 新增 `plt-ico` / `plt-ico-fixed` / `plt-ico-brand` / `plt-offscreen` |

`40-tip.js` 保留的 6 行是四类键：

- `left` / `top` —— 定位（锚点坐标 + 包含块修正）与**测量前归零**（单例复用必须复位）；
- `maxWidth` —— 面板实时宽度；
- `maxHeight`（inner）—— 面板实时高度。

它们都无法写成静态 CSS：值来自 `getBoundingClientRect()` 的运行时结果。
每一处都在源码里加了注释说明「为什么必须留」。
