# `--plt-*` 变量审计（id=1-A / 分组 twRXzh）

## 一、历史：同一条反馈出现过 4 次

从 `.plan/plan.json` 与 `.plan/notes.json` 里提取的历次记录（notes 只留最近 4 条，更早的只能从 plan.json 取）：

| id | 标题 | 当时的结论 | 完成 |
| --- | --- | --- | --- |
| `Kp86HX` | 现在待执行组 只有个 白色border 没有样式 | 绿亮度 0.261 叠加差仅 10；组头 .055→.12，组容器补绿边 | ✓ |
| `Rczii8` | 待执行组 还是只有一个 光光的白色边框 | 深色吃掉低透明度：.055 差 10 → .18 差 35 | ✓ |
| `IlSb8Z` | 还是 白色 审查 控制台 `--plt-todo is not defined` | 缺的是 `--plt-accent`（只在组上定义），`.plt-root` 各补 140,140,140 | ✓ |
| `kjSFlr` | 现在 好像有点微微绿色 | 绿底 .18→.30（差 35→60），组头 .12→.30 修层次 | ✓ |
| **`twRXzh`** | **待执行 组 还是没有样式， 仅有一个白色边框** | — | **未完成** |
| `1` | 样式又没效果了 我在浏览器控制台上看到 好多 `--plt-todo-fg is not defined` | — | 未完成 |

### 已被证伪的修法

1. **调组容器背景的透明度**（`.035` → `.055` → `.18` → `.30`）——改了四轮。
   每一轮都能算出"更明显了"，但反馈依旧。**位置可能根本不对。**
2. **给 `.plt-root` 补变量默认值**（`IlSb8Z` 做的）——判定变量已定义之后，反馈仍然出现。
3. **只看 CSS 的层叠与权重**——`1-B` / `1-A` 两次都用求解器证过"权重够、会生效"，
   但用户看到的仍然没变。

### 本轮不再重复

> **本轮不再重复「调 `.plt-group-todo` 的背景/边框透明度」这类改法。**
>
> 四轮实测差从 10 走到 60，反馈却一字不差地重复「只有一个白色边框」。
> 这与"颜色深浅不够"的结论矛盾 —— 若真是深浅问题，`.30`（差 60）不可能还叫"白色边框"。
> 必须在下一轮先验证**样式是否真的应用到了那个元素上**，而不是继续加数值。

一个待验的强怀疑（本轮不下结论，留给 1-B/1-C）：
`.plt-group-todo` 的背景被**组内的 `.plt-item` 卡片完全盖住** ——
每条任务卡片都是不透明/近不透明的块，纵向铺满组体，
组底只在其间的 6~9px 缝隙里露出来 —— 视觉上就等于"没有底色，只看到卡片的白边框"。

---

## 二、全量检索（src / assets / lib）

### 真实文件清单

`ls` 的结果（不假设文件名）：

```
src/client/   00-loader-head.js 05-taskid.js 10-icons.js 30-runtime.js
              40-tip.js 50-item.js 60-tab.js 70-apply.js
src/styles/   01-base.css 02-content.css 03-theme.css
assets/       icon-180.png plan-tasks.css
lib/          client.js index.js
lib/host/     39 个 .js（api / archive / auto-review / backup / children /
              constants / cursor / decompose-batch / decompose / dispatch-store /
              dispatch / http / id-refs / ids / item / migrate / model-cache /
              model-route / notes / order / orphan / parse-model-json / paths /
              queue-cli / queue / renumber / repair / router / running /
              settings / skill / snapshot / store / styles / taskid / timing /
              trim / values）
```

合计 **53 个文件**，其中 CSS 4 个（3 源 + 1 产物）、JS 48 个、PNG 1 个。

### 检索命中

| 检索式 | 命中数 | 分布 |
| --- | --- | --- |
| `--plt-todo-` | 44 | `src/styles/*.css`（3 个）+ `assets/plan-tasks.css` |
| `var(--plt-` | 388 | `02-content.css` 108、`03-theme.css` 67、`01-base.css` 17、`assets/plan-tasks.css` 192、`40-tip.js` 2、`lib/client.js` 2 |

按规则块解析后：**17 个变量被引用，共 602 条引用；25 个变量被定义，共 96 处定义**。

---

## 三、定义表

只列 `.css` 源文件（产物是它们的镜像，结构完全相同）。

| 变量名 | 文件 | 作用域选择器 | 值 |
| --- | --- | --- | --- |
| `--plt-accent` | 01-base.css | `.plt-root` | `140,140,140` |
| `--plt-accent` | 01-base.css | `body:not([data-ds-dark-theme]) .plt-root` | `140,140,140` |
| `--plt-accent` | 02-content.css | `.plt-group` | `140,140,140` |
| `--plt-accent` | 02-content.css | `.plt-group-reviewed` | `156,163,175` |
| `--plt-accent` | 02-content.css | `.plt-group-unreviewed` | `255,180,60` |
| `--plt-accent` | 02-content.css | `.plt-group-todo` | `var(--plt-todo)` |
| `--plt-accent` | 03-theme.css | `body:not(...) .plt-group-reviewed` | `96,106,122` |
| `--plt-accent` | 03-theme.css | `body:not(...) .plt-group-unreviewed` | `138,95,6` |
| `--plt-accent` | 03-theme.css | `body:not(...) .plt-group-todo` | `var(--plt-todo)` |
| `--plt-todo` | 01-base.css | `.plt-root` | `46,160,67` |
| `--plt-todo` | 01-base.css | `body:not(...) .plt-root` | `22,101,52` |
| `--plt-todo-fg` | 01-base.css | `.plt-root` | `187,247,208` |
| `--plt-todo-fg` | 01-base.css | `body:not(...) .plt-root` | `20,83,45` |
| `--plt-todo-line` | 01-base.css | `.plt-root` | `46,160,67` |
| `--plt-todo-line` | 01-base.css | `body:not(...) .plt-root` | `22,101,52` |
| `--plt-todo-bg` | 01-base.css | `.plt-root` | `46,160,67` |
| `--plt-todo-bg` | 01-base.css | `body:not(...) .plt-root` | `22,101,52` |
| `--plt-todo-hover` | 01-base.css | `.plt-root` | `74,222,128` |
| `--plt-todo-hover` | 01-base.css | `body:not(...) .plt-root` | `21,128,61` |
| `--plt-todo-on` | 01-base.css | `.plt-root` | `63,185,80` |
| `--plt-todo-on` | 01-base.css | `body:not(...) .plt-root` | `21,128,61` |
| `--plt-run` | 01-base.css | `.plt-root` | `255,214,10` |
| `--plt-run` | 01-base.css | `body:not(...) .plt-root` | `161,98,7` |
| `--plt-run-fg` | 01-base.css | `.plt-root` | `255,233,138` |
| `--plt-run-fg` | 01-base.css | `body:not(...) .plt-root` | `133,77,14` |
| `--plt-run-line` | 01-base.css | `.plt-root` | `255,214,10` / `161,98,7` |
| `--plt-run-bg` | 01-base.css | `.plt-root` | `255,214,10` / `161,98,7` |
| `--plt-tip-*`（12 个） | 01-base.css / 03-theme.css | `.plt-root` | 见文件 |

（`--plt-tip-*` 系列共 12 个，全部定义在 `.plt-root` 上，深色在 `01-base.css`、浅色部分在 `03-theme.css`。）

---

## 四、引用表

`--plt-todo-` 前缀的完整引用（题面点名的族；完整 602 条见脚本输出）：

| 变量名 | 文件 | 选择器 | 状态 |
| --- | --- | --- | --- |
| `--plt-todo` | 02-content.css | `.plt-group-todo`（定义别名） | ✓ 已定义 |
| `--plt-todo` | 02-content.css | `.plt-group-todo`（background） | ✓ 已定义 |
| `--plt-todo` | 02-content.css | `.plt-group-todo`（border-color） | ✓ 已定义 |
| `--plt-todo` | 02-content.css | `.plt-group-todo.open`（×2） | ✓ 已定义 |
| `--plt-todo` | 02-content.css | `.plt-group-todo .plt-group-h`（×2） | ✓ 已定义 |
| `--plt-todo` | 02-content.css | `.plt-group-todo .plt-group-body` | ✓ 已定义 |
| `--plt-todo` | 02-content.css | `.plt-group-todo .plt-tag.type`（×2） | ✓ 已定义 |
| `--plt-todo` | 02-content.css | `.plt-group-todo .plt-group-count`（×2） | ✓ 已定义 |
| `--plt-todo` | 03-theme.css | `body:not(...) .plt-group-todo` | ✓ 已定义 |
| `--plt-todo` | 03-theme.css | `body:not(...) .plt-group-todo .plt-tag.type` | ✓ 已定义 |
| `--plt-todo` | 03-theme.css | `body:not(...) .plt-group-todo .plt-group-count` | ✓ 已定义 |
| `--plt-todo-fg` | 02-content.css | `.plt-group-todo .plt-item.running .plt-name` | ✓ 已定义 |
| `--plt-todo-fg` | 02-content.css | `.plt-group-todo .plt-tag.type` 等 5 处 | ✓ 已定义 |
| `--plt-todo-line` | — | **无引用** | 已定义（未被使用） |
| `--plt-todo-bg` | — | **无引用** | 已定义（未被使用） |
| `--plt-todo-hover` | — | **无引用** | 已定义（未被使用） |
| `--plt-todo-on` | — | **无引用** | 已定义（未被使用） |

---

## 五、控制台报出的每个变量：逐个判定

| 变量 | 定义处数 | 引用处数 | 判定 |
| --- | --- | --- | --- |
| `--plt-todo` | 4 | 50 | **已定义**（`01-base.css » .plt-root` 深/浅 + 产物镜像） |
| `--plt-todo-fg` | 4 | 14 | **已定义**（同上） |
| `--plt-accent` | 18 | 334 | **已定义**（`.plt-root` + 三个 `.plt-group-*` + 产物） |
| `--plt-run` | 4 | 110 | **已定义**（同上） |
| `--plt-run-fg` | 4 | 14 | **已定义**（同上） |

**结论：控制台报的每一个变量都是「已定义」。**

### 唯一未定义的变量

| 变量 | 状态 | 引用位置 | fallback |
| --- | --- | --- | --- |
| `--plt-composer-bg` | **未找到定义** | `01-base.css » .plt-composer` | 有：`#0d1830` |

如实记录：搜遍 `src/`、`assets/`、`lib/` 三个目录，**没有找到 `--plt-composer-bg` 的任何定义**，
只在 `.plt-composer` 的 `background` 里被引用一次。它自带 `#0d1830` 回退值，不会显白。

---

## 六、因此本轮的核心结论

1. **变量侧没有问题。** 控制台报的 5 个变量全部已定义，服务端实际返回的 CSS 里
   `--plt-todo:` 有 2 处、`.plt-root` 有 18 处 —— 定义确实下发到了浏览器。
2. **唯一的未定义项 `--plt-composer-bg` 不是控制台报的那个**，且有 fallback。
3. 所以「控制台说 not defined」与「变量确实已定义」这两件事**必须同时成立** ——
   唯一自洽的解释是：**浏览器里那份 CSS 与实际源文件不同步**（缓存或旧产物），
   或者报错来自更早的一次加载。
4. 但「只有一个白色边框」这个**视觉事实**是稳定的，四轮都没变。
   结合上一节，最可疑的是：**组容器的绿底被组内的卡片完全盖住了** ——
   卡片纵向铺满组体，组底只在缝隙里露出几像素，视觉上就是"没有底色，只剩白边"。

**下一轮（1-B / 1-C）应从「样式是否真的作用到那个元素上」入手**，
而不是继续调 `.plt-group-todo` 的透明度 —— 这正是本轮明确不再重复的 X。
