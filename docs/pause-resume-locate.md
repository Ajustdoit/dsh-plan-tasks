# 暂停 / 继续按钮 · 定位报告（88-A 产出）

> 本步**只做定位与梳理，不改代码**。下面的行号对应当前工作副本。
> 目的：回答「它到底由谁渲染、样式真正来自哪里、上次改了为什么看起来没变」。

---

## 1. 一句话结论

「暂停 / 继续 / 开始」**是同一颗按钮**，由 `60-tab.js` 里的一个 `h('button', …)` 渲染，
靠 `showPause` 与 `pausedIdle` 两个布尔切换**类名与文案**。

样式全部来自 **`src/styles/01-base.css`**（深色档）与 **`03-theme.css`**（浅色档），
经 `build.mjs` 打包成 `assets/plan-tasks.css`，由宿主路由 `/plan-tasks/styles.css` 以
`<link>` 提供。

**「上次改了没变」的根因**：这颗按钮的琥珀色是**三处互不相关的硬编码**，
改一处另两处仍是旧值 —— 见第 5 节。

---

## 2. 渲染位置

| 项 | 值 |
| --- | --- |
| 文件 | `src/client/60-tab.js` |
| 行号 | **1859–1885**（`return h('button', …)` 起止） |
| 组件 | `PlanTasksTab` 内的顶栏渲染块 |
| 容器 | `.plt-top`（顶栏），在「自动刷新」之后、「自动确认」之前 |

### 一颗按钮，三种身份

```js
className: showPause
  ? 'plt-btn plt-pause'                              // 执行中
  : `plt-btn plt-start${pausedIdle ? ' is-resume' : ''}`  // 空闲 / 已挂起
```

| 状态 | 类名 | 文案 | 图标 |
| --- | --- | --- | --- |
| 执行中 | `.plt-btn.plt-pause` | 暂停 / 暂停中 | PauseIcon / SpinnerIcon |
| 已挂起 | `.plt-btn.plt-start.is-resume` | 继续 | PlayIcon |
| 空闲 | `.plt-btn.plt-start` | 开始 | PlayIcon |

**没有独立的 `.plt-resume` 类** —— 「继续」是 `.plt-start` 加一个 `is-resume` 修饰。
改「继续」的样式必须打 `.plt-start.is-resume`，打 `.plt-resume` 会**完全没有效果**。

### 状态来源

```js
const showPause = agentRunning === true || pausing === true
const pausedIdle = …   // 挂起过且当前没在跑
```

---

## 3. 样式真正来自哪里

### 加载链路（关键）

```
src/styles/01-base.css  ┐
src/styles/02-content.css ├─ build.mjs ─→ assets/plan-tasks.css
src/styles/03-theme.css  ┘                      │
                                                ↓
                            lib/host/styles.js 读它，挂到 /plan-tasks/styles.css
                                                ↓
                            lib/index.js 注入 <link rel="stylesheet" href="/plan-tasks/styles.css">
```

**宿主读的是 `assets/plan-tasks.css`（产
物），不是 `src/styles/`。**
所以改样式必须改 `src/`，再跑 `node build.mjs`。

### 具体规则

| 属性 | 深色（01-base.css） | 浅色（03-theme.css） |
| --- | --- | --- |
| `.plt-btn` 基础 | 169（尺寸/边框/圆角） | — |
| 暂停态文字 | **287** `rgba(255,190,90,.96)` | **114** `#8a4a0e` |
| 暂停态边框 | **287** `rgba(255,180,60,.42)` | **114** `rgba(176,94,20,.44)` |
| 暂停 hover | **277** 底 `.12` / 边 `216,120,32` | **109** 底 `.12` / 边 `176,94,20` / 字 `#8a4a0e` |
| 继续态文字 | **285** `rgba(120,162,255,.98)` | **112** `#17539e` |
| 继续态边框 | **285** `rgba(80,140,255,.46)` | **112** `rgba(31,111,208,.46)` |
| 继续态底色 | **285** `rgba(65,118,230,.12)` | **112** `rgba(31,111,208,.10)` |
| 继续 hover | **286** | **113** |
| disabled | **288** `opacity:.42` | — |
| has-error 描边 | **292–293** 红 `214,68,68` | **115–116** 红 `198,40,40` |

### 是否被主题变量覆盖

**没有。** 暂停/继续/开始这三态的**所有颜色都是硬编码 RGB**，
一个 `var()` 都没有（对比 `--plt-todo` / `--plt-run` 那套是按语义命名的变量）。

这是本步最重要的发现之一：**它们不跟随主题色**。

---

## 4. 层叠验证（用求解器实测，不是看代码顺序）

实现了一个按 `(specificity, 出现顺序)` 求最终值的求解器，实测结果：

**暂停态（深色）**

```
color = rgba(255,190,90,.96)
  竞争者: [0,1,0] .plt-btn = inherit
          [0,2,0] .plt-pause:not(:disabled) = rgba(255,190,90,.96)   ← 胜出
```

胜出靠**权重更高**（`.plt-pause:not(:disabled)` 的 `:not(:disabled)` 计一个伪类，
所以是 `[0,2,0]`，压过 `.plt-btn` 的 `[0,1,0]`），不是靠顺序碰巧。

**浅色暂停态**

```
color = #8a4a0e   来自 03-theme » body:not([data-ds-dark-theme]) .plt-pause:not(:disabled)
```

`body:not([data-ds-dark-theme])` 前缀使浅色规则天然多一层属性选择器，
同权重竞争时稳赢 —— 这是主题覆盖的**正常机制**，不是意外。

---

## 5. 「上次改了但看起来没变」的根因

这颗按钮的琥珀色是**三处互不相关的硬编码**：

| 位置 | 用途 | 值 | 对比度（深色底） |
| --- | --- | --- | --- |
| `01-base.css:287` | 常态**文字** | `255,190,90` | 10.80:1 |
| `01-base.css:287` | 常态**边框** | `255,180,60` | 10.03:1 |
| `01-base.css:277` | hover **边框** | `216,120,32` | **5.61:1** |

### 为什么“改了没变”

**只要改的不是这三处全体，你总会在某个交互状态看到旧颜色。**

最常见的几种情况：

1. **只改了常态（287），没改 hover（277）** → 鼠标一移上去立刻变回旧琥珀色。
   而且 hover 的边框比常态暗了近一半对比度（5.61 vs 10.03），
   视觉上像“鼠标一上去按钮就变暗”，很容易被当成“改动没生效”。
2. **只改了深色（01-base），没改浅色（03-theme）** → 切换主题一看还是旧的。
3. **改成了 `var(--plt-accent)`** → 这个变量**只在 `.plt-group*` 上定义**
   （`02-content.css:167–171` 的四条重定向），`.plt-root` 上**没有**它。
   顶栏 `.plt-top` 的祖先链是 `.plt-root > .plt-top`，**不经过任何 `.plt-group`** ——
   所以在那里 `--plt-accent` 是**未定义**的。
   而 `rgba(var(--plt-accent),.5)` 这种写法在变量未定义且**没有 fallback** 时，
   整条声明会在计算值阶段变为无效（`unset`）—— 按钮会退回继承来的颜色，
   看起来像"改动完全没生效"。**顶栏里不能用 `--plt-accent`。**
4. **直接改了 `assets/plan-tasks.css`** → 下次 `build.mjs` 一跑就被覆盖回原样。

### 唯一正确的落点

```
深色：src/styles/01-base.css   第 277 行（hover）+ 第 287 行（常态）
浅色：src/styles/03-theme.css  第 109 行（hover）+ 第 114 行（常态）
继续：01-base.css 285–286 / 03-theme.css 112–113
然后：node build.mjs
```

**这四处必须一起改**，否则一定会在某个状态/主题下露馅。

---

## 6. 排查清单（下次改之前先过一遍）

| # | 检查项 | 本步结论 |
| --- | --- | --- |
| a | 改的是 `src/` 还是 `assets/`？ | 必须 `src/`，`assets/` 是产物 |
| b | 改完跑 `node build.mjs` 了吗？ | 必须跑，否则页面还是旧的 |
| c | 深色与浅色都改了吗？ | 两套是独立规则，不是继承 |
| d | 常态与 hover 都改了吗？ | 两处硬编码，互不关联 |
| e | 用的是 `--plt-accent` 吗？ | **顶栏里它未定义**（只在 `.plt-group*` 上有），整条声明会失效 |
| f | 类名打对了吗？ | 「继续」是 `.plt-start.is-resume`，**没有** `.plt-resume` |
| g | 有没有被 `:disabled` / `.has-error` 压住？ | 有，`opacity:.42` 与红描边 |
| h | 刷新了吗？ | CSS 是 `<link>`，`Ctrl+F5` 才拿新的 |

---

## 7. 给后续两步的落点

| 任务 | 落点 |
| --- | --- |
| **88-B**（核实 #76 改动是否真写入源码） | 按第 6 节清单逐项核对；重点看四处是否**同时**改到 |
| **88-C**（按 #76 目标重写样式） | 只改 `01-base.css:277/287` + `03-theme.css:109/114`，跑 `build.mjs` |

### 建议（不是本步必须做）

暂停态的三种琥珀若能收敛成一组语义变量（像 `--plt-todo` / `--plt-run` 那样，
例如 `--plt-pause` / `-fg` / `-line` / `-hover`），就能从根本上消除
“改一处漏一处”的问题。当前它们各写各的，是这颗按钮最容易改错的原因。
