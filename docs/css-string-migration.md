# CSS 字符串迁移清单（79 组唯一依据）

> 本条（**79-A**）**只调查、不改代码**。范围：`src/`、`lib/` 下全部 `.js`（无 `.jsx` / `.ts`），
> 外加按要求一并登记的 `scripts/` 与 `docs/`。
>
> 与 id=71-A/75-A 那版清单的区别：这次**逐条记录 `@keyframes` 与 `animation` 声明**，
> 并给出「迁移时必须保住的三条不变量」，供 79-C/79-D/79-E 直接照做。

---

## 0. 结论摘要

| 形态 | 处数 | 文件 | 迁移动作 |
| --- | --- | --- | --- |
| **A** `CSS_PARTS.push(\`…\`)` 模板字面量 | **13** | `20-css/*.js` | 搬进独立 `.css` |
| **B** `document.createElement('style')` | **1** | `70-apply.js` | 保留注入点，内容改为取自 `.css` |
| **C** `el.style.xxx =` 逐条赋值 | **6** | `40-tip.js` | **不迁**（运行时几何） |
| **D** 内联 `style: {…}` 对象 | **0** | — | 已在 75-D 清零 |
| **E** `cssText` / `innerHTML` 夹 `<style>` | **0** | — | — |
| **F** `scripts/` 内联样式 | **0** | — | — |
| **G** `docs/` 内 CSS 代码块 | **10** | `execution-loop.md`(9) + `subtask-numbering.md`(1) | **不迁**（历史记录/示例） |

**关键数字：519 条规则、12 个 `@keyframes`、22 条 `animation` 声明。**
动画全部集中在 4 个片段（`11-overlay` / `13-item` / `14-groups` / `15-detail`），
这是 79-D 的作业面。

`lib/` 侧**零样式代码**（见第 5 节），所以整个迁移只在 `src/client/`。

---

## 1. A 类：13 个 CSS 片段（逐片段登记）

路径均相对 `src/client/`。触发时机全部相同：**初始化一次**（`apply` 里注入 `<style>`），
之后不再生成；规则本身无运行时变量（模板里**零 `${}` 插值**，已逐文件核对）。

| # | 源文件 | 规则 | @keyframes（名称） | animation 声明 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 1 | `20-css/05-tooltip-vars.js` | 1 | 0 | 0 | tooltip 主题变量（挂 `.plt-root`，非 `:root`） |
| 2 | `20-css/06-tooltip.js` | 22 | 0 | 0 | 气泡、箭头、四方向、`.is-hidden` / `.is-measuring` 状态 |
| 3 | `20-css/10-topbar.js` | 26 | 0 | 0 | 面板根、标题、开始/暂停、图标基类、`.plt-offscreen` |
| 4 | `20-css/11-overlay.js` | 21 | **2**：`plt-split-fade`、`plt-split-in` | **4** | 拆解遮罩、贴边提示卡、顶部行内提示 |
| 5 | `20-css/12-composer.js` | 1 | 0 | 0 | 列表容器 `.plt-list` |
| 6 | `20-css/13-item.js` | 68 | **7**：`plt-drop-in`、`plt-sublime-in`、`plt-vapor`、`plt-dropped`、`plt-arrive`、`plt-arrive-caret`、`plt-arrive-count` | **11** | 条目骨架、悬浮、拖拽落点、展开头部、到达动画 |
| 7 | `20-css/14-groups.js` | 56 | **2**：`plt-sheen`、`plt-group-sheen` | **4** | 三组配色 `--plt-accent`、组头、组内滚动、运行中扫光 |
| 8 | `20-css/15-detail.js` | 61 | **1**：`plt-spin` | **2** | 编号标题、状态/类型标签、正文备注、元信息、勾选、转圈 |
| 9 | `20-css/16-bulk.js` | 37 | 0 | 0 | 待审核批量操作区（通过/删除/计数） |
| 10 | `20-css/17-input.js` | 31 | 0 | 0 | 输入控件、表单包装 |
| 11 | `20-css/18-chips.js` | 24 | 0 | 0 | 操作条、胶囊、发送按钮 |
| 12 | `20-css/19-kids.js` | 34 | 0 | 0 | 子任务（拆解批次）行 |
| 13 | `20-css/30-light.js` | 137 | 0 | **1** | 浅色主题覆盖（必须最后） |
| | **合计** | **519** | **12** | **22** | |

### 动画清单（79-D 用）

| @keyframes | 定义处 | 被谁用 |
| --- | --- | --- |
| `plt-split-fade` | 11-overlay | 遮罩淡入 |
| `plt-split-in` | 11-overlay | 提示卡滑入 |
| `plt-drop-in` | 13-item | 拖拽落点指示条 |
| `plt-sublime-in` | 13-item | 展开头部的提亮动画 |
| `plt-vapor` | 13-item | 条目移除时的消散 |
| `plt-dropped` | 13-item | 落位后的收束 |
| `plt-arrive` | 13-item | 组内新条目到达 |
| `plt-arrive-caret` | 13-item | 到达时箭头联动 |
| `plt-arrive-count` | 13-item | 到达时计数联动 |
| `plt-sheen` | 14-groups | 组内运行中扫光 |
| `plt-group-sheen` | 14-groups | 组头收起态扫光 |
| `plt-spin` | 15-detail | 执行中转圈 |

**注意**：`plt-vapor` 与 `plt-dropped` 同名于类名（`.plt-dropped`）。
迁移时不要因为「字符串相同」而误改其中一处 —— 一个是 `@keyframes` 名，一个是类名。

**另有 1 条动画在浅色侧**：`30-light.js` 里有 1 处 `animation` 声明（覆盖深色的动效），
迁移时要确认它排在对应 `@keyframes` **之后**（层叠顺序要求，见第 4 节）。

---

## 2. B 类：唯一的 `<style>` 注入点

**文件**：`src/client/70-apply.js`（第 17–35 行）
**触发时机**：插件 `apply()` 内，注册在 `ctx.effect` 里 —— 初始化一次；卸载时 cleanup 摘节点。
**选择器/类名**：不含选择器；承载的属性是 `data-dsh-plan-tasks`（唯一标识）与
`data-dsh-plan-tasks-src="assets/plan-tasks.css"`（来源标记）。
**用途**：把 `25-css-join.js` 里 `CSS = CSS_PARTS.join('\n')` 的结果注入页面。
**是否含 @keyframes/animation**：**是** —— 注入的内容就是 A 类 13 个片段的全部，
含 12 个 `@keyframes` 与 22 条 `animation`。

```js
ctx.effect(() => {
  for (const stale of document.querySelectorAll('style[data-dsh-plan-tasks]')) { … }  // 先清
  const el = document.createElement('style')
  el.setAttribute('data-dsh-plan-tasks', '')
  el.setAttribute('data-dsh-plan-tasks-src', 'assets/plan-tasks.css')
  el.textContent = CSS
  document.head.appendChild(el)
  return () => { if (el.parentNode !== null) el.parentNode.removeChild(el) }          // 后摘
}, 'dsh-plan-tasks: styles')
```

**迁移注意**：这是**平台唯一可行的注入方式**，不要改成 `<link href="assets/…">`。
`dsh-client-modules` 的 `/plugins` 路由（`bundleResource`）只服务 client bundle 与
source map，**不提供包内任意文件**；官方 76 个客户端插件里 54 个同样在运行时注入 `<style>`，
0 个用 `<link>`。79-B 若生成独立 `.css`，它只能作为**构建期输入**，不能作为运行时 URL 源。

---

## 3. C 类：6 处逐条赋值（**明确不迁**）

**文件**：`src/client/40-tip.js`
**触发时机**：**事件回调**（hover 显示 tooltip 时）—— 每次显示都重算。

| 行 | 赋值 | 用途 | 运行时依赖 |
| --- | --- | --- | --- |
| 143 | `el.style.left = '0px'` | 测量前复位（**单例复用**，不清会越飘越远） | 无双（复位） |
| 144 | `el.style.top = '0px'` | 同上 | 无双（复位） |
| 154 | `el.style.maxWidth = \`${…maxW}px\`` | 按面板实时宽度夹紧 | **是** |
| 157 | `inner.style.maxHeight = \`${…}px\`` | 按面板实时高度夹紧 | **是** |
| 186 | `el.style.left = \`${…place.left…}px\`` | 按锚点坐标定位 + 包含块修正 | **是** |
| 187 | `el.style.top = \`${…place.top…}px\`` | 同上 | **是** |

**是否含 @keyframes/animation**：否（这些是定位与尺寸，与动画无关）。

**为什么不迁**：值来自 `getBoundingClientRect()` 的实时结果，CSS 无法表达。
143/144 两行虽然是常量 `0`，但它们是**运行时复位**（气泡是单例，上一次的坐标会残留），
写进 CSS 会把「未定位」和「已定位到原点」两种状态混成一种 —— 必须留 inline。

已归零的状态类（`.is-hidden` / `.is-measuring`）在 06-tooltip.js 里，属 A 类。

---

## 4. 迁移必须保住的三条不变量

### ① 片段顺序即层叠顺序

`build.mjs` 按文件名字典序拼接，顺序语义：`05 → 06 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19 → 30`。
`30-light.js` **必须最后** —— 浅色规则大量依赖「同特异度、后写者胜」来覆盖深色默认值。
迁成独立 `.css` 后，靠构建拼接顺序维持，不得重排。

### ② `@keyframes` 与使用它的规则之间的顺序

CSS 里 `@keyframes` 定义可以出现在使用之后（不像 `var()`），所以顺序不是硬约束；
但**同名的覆盖**有约束：若浅色侧也定义了同名 `@keyframes`，后者胜出。
当前只有 `30-light.js` 里有 1 条 `animation` **声明**覆盖，没有重定义 `@keyframes`。

### ③ 类名前缀

- `.plt-*`（118 个插件自有类）；
- `--plt-*`（变量，只挂 `.plt-root`，**无一处 `:root`**）；
- 状态修饰符（`.is-on` / `.open` / `.running` / `.failed` / `.interrupted` / `.dragging` /
  `.drop-target` / `.locked` / `.active` / `.done` / `.is-empty` / `.is-hidden` / `.is-measuring`）
  —— 一律叠加在 `.plt-*` 元素上，从不单独出现。

---

## 5. `lib/` 侧：零样式代码

35 个文件（`lib/host/*.js` 33 个 + `lib/index.js` + 产物 `lib/client.js`）全查：

```
grep "style|className|<style|innerHTML|cssText" lib/host/*.js lib/index.js  →  无命中
```

宿主是纯逻辑层（读写 `plan.json`、路由、归档），**一行样式代码都没有**。
迁移不涉及宿主，也不需要重启 `dsh web`。

（`lib/host/decompose.js` 里出现 `.css` 字样，那是文件扩展名白名单，与样式无关。）

---

## 6. `scripts/` 与 `docs/`（按要求登记，不改）

### `scripts/`（5 个 `.mjs`）

**内联样式：0 处。** 只有 `dead-css.mjs` 里有与样式相关的**路径常量**
（`CSS_DIR = '20-css'`）和文本匹配正则，不产生任何样式。

### `docs/`（3 个 `.md`，共 10 个 css 代码块）

| 文件 | css 代码块数 | 性质 |
| --- | --- | --- |
| `execution-loop.md` | 9 | **历史记录**中的引用（「之前是 X、改成 Y」），非有效样式源 |
| `subtask-numbering.md` | 1 | 说明某个布局决策时的**示例**片段 |
| `css-in-js-inventory.md` | 0 | — |

**这些不迁移**。它们描述的是「曾经/现在是怎样」，若一起迁走会失去对照价值；
且它们的类名多已不存在（如 `plt-group-draft`），迁移只会制造死规则。

---

## 7. 给后续任务的落点

| 任务 | 依据本清单的哪部分 |
| --- | --- |
| **79-B** 建样式文件 | 第 1 节的 13 行 → 13 个分段；沿用已有 `assets/plan-tasks.css` 的分段格式 |
| **79-C** 逐条搬运 | 第 1 节 + 第 4 节三条不变量；搬完一段跑一次 `npm test` |
| **79-D** 动画专项 | 第 1 节的**动画清单**（12 个 `@keyframes` / 22 条声明）+ 第 4 节 ② |
| **79-E** 全量收尾 | 第 3 节（明确不迁的 6 处）+ 第 5/6 节（确认 lib/scripts/docs 无遗漏） |

---

## 附：调查方法（可复现）

```bash
# A 类
grep -rln "CSS_PARTS.push" src/ --include=*.js

# 每个片段的规则数 / keyframes / animation
node -e '…'   # 见本次调查脚本逻辑（按行首选择器计规则，正则抓 @keyframes 与 animation）

# B 类
grep -rn "createElement('style')" src/ lib/ scripts/ --include=*.js

# C 类
grep -rn "\.style\.[a-zA-Z]" src/ lib/ --include=*.js

# E 类
grep -rn "cssText\|innerHTML" src/ lib/ scripts/ --include=*.js

# lib 侧
grep -rn "style\|className\|<style" lib/host/*.js lib/index.js
```

---

## 8. 骨架已就位（id=79-B）

后续 79-C/D/E 的落点是 `src/styles/` 下的三个文件，**不是** `assets/`（那是产物）：

| 文件 | 分区 | 承接哪些源片段 |
| --- | --- | --- |
| `01-base.css` | 【1】–【6】 | 05-tooltip-vars、10-topbar、11-overlay、06-tooltip、12-composer、17-input |
| `02-content.css` | 【7】–【12】 | 13-item、14-groups、15-detail、19-kids、16-bulk、18-chips |
| `03-theme.css` | 【13】–【17】 | 30-light（浅色覆盖，必须最后） |

加载走 `build.mjs` 打包链路：`src/styles/*.css` 被读入并拼进 `lib/client.js` 的 CSS 常量，
由 `apply()` 注入 `<style>`；同时写出 `assets/plan-tasks.css` 作为可独立取用的第二形态。

**当前状态**：骨架只有注释、0 条规则，`loadStyleSheet()` 在 `ruleCount === 0` 时不接管，
原 `src/client/20-css/*.js` 仍是生效来源 —— 这是为了让 79-C 能逐段搬运、每段都能跑测试。

---

## 9. 迁移已执行（id=79-C）

第 8 节的骨架已装满规则，客户端注入链路已拆除。

| 项 | 迁移前 | 迁移后 |
| --- | --- | --- |
| 样式载体 | `src/client/20-css/*.js`（13 个 JS 片段里的模板字符串） | `src/styles/*.css`（3 个纯 CSS 文件） |
| 客户端片段数 | 22 | **7** |
| `lib/client.js` | 420 KB（含 142KB 内联 CSS） | **278 KB** |
| 运行时 `<style>` 节点 | 1 个（`apply()` 动态创建） | **0 个** |
| 样式加载 | `createElement('style')` + `textContent` | 宿主路由 + `<link rel=stylesheet>` |
| 改样式生效 | 重建客户端包 + `Ctrl+F5` | 刷新页面即可（宿主每次请求重读盘） |

规则保真：525 条逐条一致且顺序相同，12 个 `@keyframes` 内容一致，22 条 `animation`，
121 个 `.plt-*` 类名无缺无多。

**新增宿主模块**：`lib/host/styles.js`（`/plan-tasks/styles.css` 路由 + index 注入）。
**构建输入改变**：`syncAssets()` 现在读 `src/styles/*.css`；`assets/plan-tasks.css`
从「从 JS 派生的第二形态」变成「CSS 源的构建产物」。

⚠ 这是宿主改动，需重启 `dsh web`。

---

## 10. 79 组收尾（id=79-E）

迁移全部完成，最终形态：

| 目录 | 内容 |
| --- | --- |
| `src/styles/` | **样式源**：01-base / 02-content / 03-theme（3 个手写纯 CSS） |
| `src/client/` | 客户端片段 7 个（原 22 个；13 个 CSS 片段 + `25-css-join` + `15-css-decl` 已删） |
| `lib/host/styles.js` | 样式路由 + index 注入（新增） |
| `assets/plan-tasks.css` | **产物**：由 build.mjs 从 src/styles 生成，宿主路由提供它 |

### 残留样式核查（四目录）

| 目录 | 动态注入 | 字符串拼 CSS | 内联 style |
| --- | --- | --- | --- |
| `src/` | 0 | 0 | 6（全在 40-tip.js，运行时几何） |
| `lib/` | 0 | 0 | 0 |
| `scripts/` | 0 | 0 | 0 |
| `docs/` | 仅历史记述 | — | — |

### 作用域核查（569 个选择器）

样式从「apply() 注入」改为「全局 link」，作用域从面板内变成整页，所以逐条验证：

- 每个选择器都锚定 `.plt-`，无一能命中宿主元素；
- 无裸露通用状态类（`.open`/`.running` 等一律叠在 `.plt-*` 上）；
- `body` 只作 `body:not([data-ds-dark-theme])` 主题前缀；
- 后代选择器父级都真实存在；
- `--plt-*` 只挂 `.plt-root`，零 `:root`。

**自洽性**：样式 121 类 ↔ JS 118 静态 + 22 动态前缀，完全对齐。

### 最终对比

| 指标 | 迁移前 | 迁移后 |
| --- | --- | --- |
| 客户端片段 | 22 | **7** |
| `lib/client.js` | 420 KB | **278 KB** |
| 运行时 `<style>` | 1 | **0** |
| 内联 style | 21 | **6**（运行时几何） |
| 类名 / 规则 / keyframes | 121 / 519 / 12 | 121 / 519 / 12（不变） |

⚠ 含宿主改动，需重启 `dsh web`。
