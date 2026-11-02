# `--plt-*` 变量审计（id=2-A / 分组 2 全组）

> 这份文档是 1-A 审计的**重跑与复核**（分组 2 是同一批任务的重新编号版本）。
> 数据与结论一致，重跑本身也是一次验证：跨时间、跨重新编号，结果必须稳定。

## 一、历史：同一条反馈出现过 4 次

来自 `.plan/notes.json`（9 条已归档记录里的相关项）：

| id | 标题 | 当时的结论 |
| --- | --- | --- |
| `Kp86HX` | 现在待执行组 只有个 白色border 没有样式 | 绿亮度 0.261 叠加差仅 10 像没样式；组头 .055→.12 |
| `Rczii8` | 待执行组 还是只有一个 光光的白色边框 | 深色吃掉低透明度：.055 差 10 → .18 差 35 |
| `IlSb8Z` | 还是 白色 审查 控制台 `--plt-todo is not defined` | 缺的是 `--plt-accent`（只在组上定义），`.plt-root` 各补 140,140,140 |
| `kjSFlr` | 现在 好像有点微微绿色 | 绿底 .18→.30（差 35→60），组头 .12→.30 修层次 |
| `twRXzh` | 待执行 组 还是没有样式， 仅有一个白色边框 | **真因是卡片占 82% 面积近白色**；改给卡片加绿底 .10 |

### 已被证伪的修法

1. **调组容器背景的原度透明**（`.035` → `.055` → `.18` → `.30`）——做了四轮。
   每轮都能算出"更明显了"，反馈依旧。**位置错了**：容器只占 18% 面积。
2. **给 `.plt-root` 补变量默认值**——判完"变量已定义"，反馈仍出现。
3. **只看 CSS 层叠与权重**——两次求解器都证明"权重够、会生效"，用户看到的仍没变。

### 本轮不再重复

> **本轮不再重复「靠调 `.plt-group-todo` 容器的透明度来让绿可见」这类改法。**

理由：四轮实测差 `8 → 10 → 35 → 60`，反馈却一字不差。若真是深浅问题，
`.30`（差 60）不可能还叫"白色边框"。容器只占组体 18% 面积（卡片占 82%），
在那 18% 上加数值，视觉上永远不够。真正有效的那次（`twRXzh`）改的是**卡片**。

---

## 二、全量检索

### `ls` 的真实文件清单（不假设文件名）

```
src/client/   00-loader-head.js 05-taskid.js 10-icons.js 30-runtime.js
              40-tip.js 50-item.js 60-tab.js 70-apply.js
src/styles/   01-base.css 02-content.css 03-theme.css
assets/       icon-180.png plan-tasks.css
lib/          client.js index.js  host/（39 个 .js）
```

合计 **53 个文件**，其中 CSS 4 个（3 源 + 1 产物）、JS 48 个、PNG 1 个。

### 检索命中

| 检索式 | 命中数 | 分布 |
| --- | --- | --- |
| `--plt-todo-` | **46** | `01-base.css` / `02-content.css` / `03-theme.css` / `assets/plan-tasks.css` |
| `var(--plt-` | **392** | `02-content.css` 110、`03-theme.css` 67、`01-base.css` 17、`assets/plan-tasks.css` 194、`40-tip.js` 2、`lib/client.js` 2 |

按规则块解析后：**25 个变量被定义（96 处）；17 个变量被引用（602 条 CSS + 2 条 JS）**。

---

## 三、定义表

（只列源文件；`assets/plan-tasks.css` 是它们的镜像，结构完全相同。）

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
| `--plt-todo-line` | 01-base.css | `.plt-root` 深浅各一 | `46,160,67` / `22,101,52` |
| `--plt-todo-bg` | 01-base.css | `.plt-root` 深浅各一 | `46,160,67` / `22,101,52` |
| `--plt-todo-hover` | 01-base.css | `.plt-root` 深浅各一 | `74,222,128` / `21,128,61` |
| `--plt-todo-on` | 01-base.css | `.plt-root` 深浅各一 | `63,185,80` / `21,128,61` |
| `--plt-run` | 01-base.css | `.plt-root` 深浅各一 | `255,214,10` / `161,98,7` |
| `--plt-run-fg` | 01-base.css | `.plt-root` 深浅各一 | `255,233,138` / `133,77,14` |
| `--plt-run-line` / `-bg` | 01-base.css | `.plt-root` 深浅各一 | 同 `--plt-run` |
| `--plt-tip-*`（12 个） | 01-base.css / 03-theme.css | `.plt-root` | 见文件 |

---

## 四、引用表（`--plt-todo-` 族全量）

| 变量名 | 文件 | 选择器 | 状态 |
| --- | --- | --- | --- |
| `--plt-todo` | 01-base.css | `.plt-start:not(:disabled):hover` | ✓ 已定义 |
| `--plt-todo` | 02-content.css | `.plt-group-todo` | ✓ 已定义 |
| `--plt-todo` | 02-content.css | `.plt-group-todo .plt-group-h` | ✓ 已定义 |
| `--plt-todo` | 02-content.css | `.plt-root .plt-group-todo` | ✓ 已定义 |
| `--plt-todo` | 02-content.css | `.plt-root .plt-group-todo.open` | ✓ 已定义 |
| `--plt-todo` | 02-content.css | `.plt-group-todo .plt-tag.type` | ✓ 已定义 |
| `--plt-todo` | 02-content.css | `.plt-group-todo .plt-item` | ✓ 已定义 |
| `--plt-todo` | 02-content.css | `.plt-group-todo .plt-item:hover` | ✓ 已定义 |
| `--plt-todo` | 02-content.css | `.plt-group-todo .plt-group-count` | ✓ 已定义 |
| `--plt-todo` | 03-theme.css | `body:not(...) .plt-group-todo`（多条） | ✓ 已定义 |
| `--plt-todo` | 03-theme.css | `body:not(...) .plt-start:hover` | ✓ 已定义 |
| `--plt-todo` | assets/plan-tasks.css | 同上全部（镜像） | ✓ 已定义 |
| `--plt-todo-fg` | 01-base.css | `.plt-root`（定义它的地方另有 5 处引用） | ✓ 已定义 |
| `--plt-todo-fg` | 02-content.css | `.plt-group-todo .plt-tag.type` 等 5 处 | ✓ 已定义 |
| `--plt-todo-fg` | 03-theme.css | `body:not(...) .plt-group-todo ...` 多条 | ✓ 已定义 |
| `--plt-todo-line` | — | **无引用**（死变量） | 已定义 |
| `--plt-todo-bg` | — | **无引用**（死变量） | 已定义 |
| `--plt-todo-hover` | — | **无引用**（死变量） | 已定义 |
| `--plt-todo-on` | — | **无引用**（死变量） | 已定义 |

---

## 五、控制台报出的每个变量：逐个判定

| 变量 | 定义 | 引用 | 判定 |
| --- | --- | --- | --- |
| `--plt-todo` | 4 处 | 54 | **✓ 已定义** |
| `--plt-todo-fg` | 4 处 | 14 | **✓ 已定义** |
| `--plt-accent` | 18 处 | 334 | **✓ 已定义** |
| `--plt-run` | 4 处 | 110 | **✓ 已定义** |
| `--plt-run-fg` | 4 处 | 14 | **✓ 已定义** |
| `--plt-todo-line` | 4 处 | 0 | **✓ 已定义**（未被引用） |
| `--plt-todo-bg` | 4 处 | 0 | **✓ 已定义**（未被引用） |

**控制台报出的每一个变量都是「已定义」。**

### 唯一未定义的变量

| 变量 | 状态 | 引用位置 | fallback |
| --- | --- | --- | --- |
| `--plt-composer-bg` | **未找到定义** | `01-base.css » .plt-composer` (行 177)<br>`assets/plan-tasks.css » .plt-composer` (行 180) | 有：`#0d1830` |

如实记录：搜遍 `src/`、`assets/`、`lib/`，**没有找到 `--plt-composer-bg` 的任何定义**。
它自带 `#0d1830` 回退值，且**不在控制台报出的变量之列**。

### 隐患与死变量

- **未定义且无 fallback**：0 处。
- **已定义但从未被引用**：`--plt-run-bg`、`--plt-run-line`、
  `--plt-tip-delay`、`--plt-tip-fg-muted`、`--plt-tip-offset`、
  `--plt-todo-bg`、`--plt-todo-hover`、`--plt-todo-line`、`--plt-todo-on`（9 个）。

---

## 六、结论

1. **变量侧没有问题。** 控制台报的 7 个变量全部已定义；
   唯一未定义的 `--plt-composer-bg` 有 fallback，且不是被报的那个。
2. 所以「控制台说 not defined」与「变量确实已定义」必须同时成立 ——
   唯一自洽的解释是：**浏览器加载的那份 CSS 与实际源文件不同步**（缓存或旧产物），
   或报错来自更早的一次加载。
3. 「只有一个白色边框」这个**视觉事实**稳定存在（四轮未变）。
   已定位到真因（`twRXzh` 那条）：**卡片占组体 82% 面积、本身是近白色**，
   组容器底色只影响剩下的 18% 缝隙。
4. **下一轮（2-B 起）不应再在变量或容器透明度上打转**，
   应验证「样式是否真的作用到了占 82% 面积的那个元素上」。

---

## 七、补齐实施（id=2-C）

### 实际要补的是哪个

2-A / 2-B 两轮已经把 `--plt-todo-*` 六项全部确认「已定义」（深浅各一份，都在 `.plt-root` 上）。
引用表里唯一的**未定义项**是：

| 变量 | 引用位置 | fallback |
| --- | --- | --- |
| `--plt-composer-bg` | `01-base.css » .plt-composer` | `#0d1830` |

它原先**只在消费处写了 fallback，全仓搜不到任何定义** —— 能工作纯粹靠那个 `#0d1830`。

### 为什么现在补、补在哪

| 决策 | 理由 |
| --- | --- |
| 补，而不是继续靠 fallback | fallback 只覆盖"未定义"，**改不了主题**；且审计要求被引用变量都有定义 |
| 落在 `.plt-root` 上 | 消费点的共同祖先（`.plt-composer` 是它的后代，缩进 16 vs 8）；与其它 `--plt-*` 主题变量同一处 |
| 不写 `:root` | 全局 `:root` 会污染宿主页面；`.plt-root` 已足够且作用域正确 |
| 值原样搬 `#0d1830` | 不趁机改色。这个深蓝黑不是随手挑的：卡片上面还叠三层蓝渐变，基底够深才压得住 |
| 只定义深色档 | 浅色档 `.plt-composer` 用字面量（`#ffffff → #fdfdfe`），根本不消费这个变量 |

### 改动（`src/styles/01-base.css`）

在深色 `.plt-root` 块之后集中加一条：

```css
.plt-root{
  --plt-composer-bg:#0d1830;   /* 深蓝黑 · 输入卡片基底，上面叠三层蓝渐变 */
}
```

同一处写完整注释（用途、为什么放这里、取值来源、为什么不写浅色档）。

### 完成标准核对

| 标准 | 结果 |
| --- | --- |
| 引用表「未定义」项全部转「已定义」 | ✓ 源文件 0 个、产物 0 个 |
| 无拼写差异 | ✓ 引用名全部能在定义表找到 |
| 无遗漏 | ✓ 17 个被引用变量全部有定义 |
| 集中一处、不散落 | ✓ 仅 `01-base.css` 一处 |
| 名字逐字一致 | ✓ `--plt-composer-bg` ↔ `--plt-composer-bg` |
| 构建后产物含定义 | ✓ 规则数 555 → 556 |
| 服务端实际下发 | ✓ 抓取确认 `--plt-composer-bg:` 1 处 |
| computed 能读到期望值 | ✓ 静态等价：定义在祖先、无更高权重覆盖 |

### `--plt-todo-*` 六项复核

| 变量 | 定义 | 引用 | 深浅各一份 |
| --- | --- | --- | --- |
| `--plt-todo` | 2 | 27 | ✓ |
| `--plt-todo-fg` | 2 | 7 | ✓ |
| `--plt-todo-line` | 2 | 0 | ✓ |
| `--plt-todo-bg` | 2 | 0 | ✓ |
| `--plt-todo-hover` | 2 | 0 | ✓ |
| `--plt-todo-on` | 2 | 0 | ✓ |

后四项是「已定义但未被引用」—— 不是错误，是预留的主题变量。

### 验证（23 条断言）

未定义清零 1 条、`--plt-composer-bg` 专项 5 条、`--plt-todo-*` 六项 12 条、
拼写一致性 1 条、产物 3 条、继承可达 1 条。

### 部署

纯 CSS，`Ctrl+F5`。产物 sha256 `e56d07ba576169a5`，规则数 556。

### 关于「控制台 0 条警告」这条标准

这一条**无法在本环境实测** —— DSH 页面需要认证（根路径 401），
无头浏览器拿不到真实 DOM，DevTools Issues 也无法读取。

但 2-B 已经证明：`--plt-todo-fg` 等被报变量在磁盘与产物里都有定义、
继承链完整、服务端确实下发。若硬刷新后仍有警告，问题就不在 CSS 内容，
而在「页面加载的 CSS 与磁盘这份不是同一份」—— 那属于缓存/部署问题，不是补变量能解决的。

---

## 八、全量补 fallback（id=2-D）

### 规模与范围

| 位置 | 补前 | 补后 |
| --- | --- | --- |
| `src/` 引用 | 303 处，仅 4 处带 fallback | **303 处全部带** |
| `assets/`（产物） | 301 处 | 由 `build.mjs` 重新生成，同样全带 |

`assets/plan-tasks.css` **不手改** —— 它是 `src/styles/*.css` 的产物，
手改会在下次构建时被覆盖。

### 取值原则（题面点名的那条坑）

> fallback 只做降级兜底，**不能替代真正的定义**。
> 历史上「有点微微绿」很可能就是兜底值被当成了正解。

所以每个 fallback 都取**定义处的原值**（深色档），做到「有定义」与「无定义」
两条路径算出**同一个颜色**。逐个核对：

| 变量 | 定义值 = fallback |
| --- | --- |
| `--plt-todo` | `46,160,67` |
| `--plt-todo-fg` | `187,247,208` |
| `--plt-run` | `255,214,10` |
| `--plt-run-fg` | `255,233,138` |
| `--plt-composer-bg` | `#0d1830` |
| `--plt-tip-bg` | `rgba(34,42,56,.97)` |
| `--plt-tip-fg` | `#eef2f8` |
| …（共 17 个变量，全部一致） | |

### `--plt-accent` 的特殊处理

它占 184 处引用，且值**随分组变**：

| 上下文 | 值 |
| --- | --- |
| 组外（顶栏 / 按钮 / 气泡） | `140,140,140` 中性灰 |
| 待审核组 / 审核按钮 `.plt-pass-icon` | `255,180,60` 琥珀（深色）· `138,95,6`（浅色） |

统一补一个 fallback 不会"拍平分组色"——组内的定义
（`.plt-group-todo{--plt-accent:var(--plt-todo)}` 等）会覆盖它，
fallback 只在变量完全没定义时生效，那时本来就该是中性灰。

### 顺带清掉 45 处历史遗留

发现 `var(--plt-accent,120,168,255)` **45 处** —— 这是早期**蓝色主题**的
硬编码 fallback，与当前绿/黄/灰配色完全不符。

全部改为 `140,140,140`（与 `.plt-root` 默认值一致）。
保留 `.plt-pass-icon` 的琥珀 6 处，那是正确的语义色。

最终分布：`140,140,140` 178 处 · `255,180,60` 4 处 · `138,95,6` 2 处。

### 完成标准的实证（真做了实验，不是模拟）

**步骤 1**：把 `01-base.css` 里 37 条变量定义全部注释掉 → 构建。

| 检查 | 结果 |
| --- | --- |
| 产物里裸 `var(--plt-*)`（无 fallback） | **0 处** → 没有声明会作废 |
| `var(--plt-todo,46,160,67)` | 29 处 |
| `var(--plt-todo-fg,187,247,208)` | 8 处 |
| `var(--plt-run,255,214,10)` | 39 处 |
| `var(--plt-composer-bg,#0d1830)` | 2 处 |
| 产物里 `--plt-todo:` 定义 | 0 处（确认实验有效） |

→ **定义全部消失，78 处关键色仍由 fallback 撑住**，配色保持绿 / 黄 / 深蓝，不会退化。

**步骤 2**：恢复定义 → 重新构建。

| 检查 | 结果 |
| --- | --- |
| 产物里 `--plt-todo:` 定义 | 2 处（深色 + 浅色） |
| `--plt-todo:46,160,67` | 1 处 |
| 裸 `var(--plt-*)` | 0 处 |

→ 定义存在时浏览器用定义值；fallback 与之逐字相同，
所以「有定义」与「无定义」算出的是**同一个颜色** —— 兜底没有覆盖真实值。

### 工具坑（两处，都真实踩到）

1. **`execSync` 被沙箱拦（EPERM）** —— 实验脚本里直接调 `node build.mjs` 失败。
   但 `writeFileSync` 在 `finally` 里先执行了，文件已还原，产物从未被污染。
   教训：先写盘、后构建，不要指望同一个脚本里串起来。
2. **正则被括号里的逗号截断** —— `var(--plt-tip-bg,rgba(34,42,56,.97))` 用
   `/var\(([^)]+)\)/` 会截成 `rgba(34,42,56,.97`。必须**按括号配平**扫描。

### 验证（12 条断言）

覆盖 1 条、fallback 与定义逐字一致 1 条（17 个变量逐一核对）、
定义缺失模拟 5 条、兜底不覆盖正解 1 条、未定义变量 1 条、产物 3 条。

### 部署

纯 CSS，`Ctrl+F5`。产物 sha256 `db9959493697f738`，规则数 556（不变）。

---

## 九、构建链路验证（id=2-E）

### 构建入口

| 项 | 值 |
| --- | --- |
| `package.json` `scripts.build` | `node build.mjs` |
| `package.json` `scripts.prepack` | `node build.mjs`（发版前自动构建，产物不会漏） |
| `main` | `lib/index.js` |
| `files` | `lib/` `src/` `scripts/` `assets/` `cordis.patch.yml` `icon.svg` `README.md` |
| `build.mjs` `STYLE_FILES` | `01-base.css` `02-content.css` `03-theme.css` |

**第三步（2-C）改动的 `01-base.css`、第四步（2-D）改动的三个文件，全部在构建清单里。**
没有孤立文件，没有被裁剪。

`build.mjs` 的收集方式是 `readdir(src/styles)` 后按 `STYLE_FILES` 顺序拼接，
顺序即层叠语义：`01 → 02 → 03`（浅色必须最后）。

### 产物检索

| 变量 | 定义处 | 消费处 |
| --- | --- | --- |
| `--plt-todo` | 2（深 + 浅） | 34 |
| `--plt-todo-fg` | 2 | 8 |
| `--plt-todo-bg` / `-line` / `-hover` / `-on` | 各 2 | 0（预留） |
| `--plt-composer-bg` | 1 | 2 |

**定义与消费处都能在 `assets/plan-tasks.css` 里命中。**

### 浏览器实际加载的正是这份产物

这是完成标准的后半句，用「抓服务端返回内容 vs 磁盘产物」做 DevTools Network 的等价核对：

| | 大小 | sha256（前 16） |
| --- | --- | --- |
| 磁盘 `assets/plan-tasks.css` | 202235 字节 | `db9959493697f738` |
| `GET /plan-tasks/styles.css` 返回 | 202235 字节 | `db9959493697f738` |

**逐字节相同。**

链路：`assets/plan-tasks.css` → `lib/host/styles.js` 的 `STYLES_FILE`
（`join(PACKAGE_ROOT, 'assets', 'plan-tasks.css')`）→ 每次请求 `readFile` 现读
→ `/plan-tasks/styles.css` → `<link rel="stylesheet">` 注入 `<head>`。

因为是**每次请求现读**，所以改完 CSS 只需 `Ctrl+F5`，不必重启服务。

### 三个源文件都被打包（特征串核对）

| 源文件 | 特征串 | 在产物中 |
| --- | --- | --- |
| `01-base.css` | `--plt-tip-bg:` | ✓ 位置 3817 |
| `02-content.css` | `.plt-group-todo{` | ✓ 位置 41524 |
| `03-theme.css` | `body:not([data-ds-dark-theme]) .plt-root` | ✓ 位置 102718 |

顺序 `3817 < 41524 < 102718` 正确。

### 反向验证：`--check` 真能发现不同步

人为往产物追加一行 → `node build.mjs --check`：

```
build: assets/plan-tasks.css 与 src/styles/ 不同步，请先跑「node build.mjs」
退出码 1
```

真能拦住。（恢复后产物 sha256 回到 `db9959493697f738`。）

### 一处测量陷阱（差点误判）

第一次量退出码时写成 `node build.mjs --check 2>&1 | tail -3; echo "退出码: $?"`，
结果显示 **0** —— 一度以为 `--check` 不会让 CI 失败。

实际 `$?` 取到的是**管道最后一段（`tail`）的退出码**，不是 `node` 的。
去掉管道重测：**真实退出码是 1**，代码里也确有 `process.exit(1)`（`build.mjs:219`）。

> 量退出码不要经过管道。这是「假绿」的又一个变体：
> 测到的不是被测对象，而是测量工具自己。

### 结论

| 完成标准 | 结果 |
| --- | --- |
| 产物能检索到变量定义 | ✓ 6 个变量各有深浅两份 |
| 产物能检索到消费处 | ✓ 34 + 8 处 |
| 浏览器加载的正是这份产物 | ✓ 逐字节相同 `db9959493697f738` |
| 改动未落在不被引用的源上 | ✓ 三个文件都在 `STYLE_FILES` |
| 构建幂等 | ✓ 源未变则产物不变 |

无需回到第三步修正。产物 sha256 `db9959493697f738`，556 条规则。

---

## 十、终验：三处耦合统一走一遍（id=2-F）

### 为什么最后要合起来走

定义处、消费处、构建产物三处相互耦合。分开验会漏掉两类组合问题：

- **定义了但没进产物**（改了不被构建包含的源）
- **进了产物但没继承到**（作用域不对 / 被更高权重覆盖）

所以这一轮从产物出发，一条链走到底。

### 构建

```
build: 无变化（8 个片段）
build: src/styles/ 3 个文件，556 条规则
PASS  39 个宿主模块，94 条依赖
css: 123 个类，无死规则
build: assets/plan-tasks.css 与 src/styles/ 一致
```

### 浏览器侧的一条说明（如实记录）

本机**无法跑真实浏览器**：

- Chrome 起不来（`crashpad` EPERM，`--dump-dom` 挂死）
- DSH 页面需认证：`GET /` 返回 `401 dsh web authentication required`
- `DSH_WEB_URL` 不带 token，无头浏览器过不去

因此「控制台 0 条 is not defined」与「硬刷新后视觉」这两条**无法直接实测**。
替代做法：**按 CSS 规范精确计算最终色值**，输入直接取自构建产物
（不是源文件）——这同时证明了「定义确实进了产物」。

### 改前 / 改后色值对照

深色主题，面板底 `rgb(22,24,28)`，`--plt-todo` = `46,160,67`。

| 项目 | 改前 | 改后 | 与面板底差 |
| --- | --- | --- | --- |
| 组容器底 | `rgb(23,29,29)` | `rgb(29,65,40)` | **7 → 60** |
| 卡片底 | `rgb(28,34,34)` | `rgb(31,75,43)` | **22 → 75** |

- 改前：卡片是通用 `.plt-item` 的白 `.02`，叠在几乎看不见的组底上 →
  与面板底只差 22，视觉上就是「整块白的，只剩一圈边框」。
- 改后：组容器 `.30`、卡片 `.10`，占 82% 面积的**卡片本身带绿** → 差 75。
- 卡片与组底仍差 15，卡片轮廓没有糊掉。

### 前景色可读性（改后）

| 元素 | 颜色 | 背景 | 对比度 |
| --- | --- | --- | --- |
| 组名 | `rgb(187,247,208)` | `rgb(29,65,40)` | **9.42:1** |
| 编号 | `rgb(200,200,200)` | `rgb(31,75,43)` | **5.98:1** |
| 标题 | `#e6e6e6` | `rgb(31,75,43)` | **8.01:1** |

三处均 ≥ 4.5:1。

### 与第三步设定的值一致

| 检查 | 结果 |
| --- | --- |
| 产物里 `--plt-todo:46,160,67` | ✓ |
| 产物里 `--plt-todo-fg:187,247,208` | ✓ |
| 组容器 alpha `.30` | ✓（产物行 847） |
| 卡片 alpha `.10` | ✓（产物行 955） |
| 卡片边 alpha `.34` | ✓ |

### 残留检查

| 项 | 结果 |
| --- | --- |
| 容器 `.035` 旧规则 | 已清 ✓ |
| 历史蓝色兜底 `120,168,255` | 已清 ✓ |
| 裸 `var(--plt-*)`（无兜底） | 0 处 ✓ |

### 本轮一个反复踩的坑：alpha 解析

`rgba(var(--plt-todo,46,160,67),.30)` 这种嵌套写法，连写三版解析器都读错：

1. `/,([\d.]+)\)$/` → 在 `var(...)` 里的第一个 `)` 处截断 → NaN
2. 按括号配平从字符串头算 depth → 跳过 `rgba(` 的 `(` 时 depth 变 1，
   之后全在内层，顶层串为空 → alpha 读成 1 → 算出**不透明的纯绿 rgb(46,160,67)，差 199**
3. 剥 `var(...)` 后按「段数 ≥ 4」判断 → 剥完只剩 2 段，又读成 1

最后可行的写法最简单：

```js
const m = decl.match(/\)\s*,\s*([\d.]+)\s*\)\s*$/)   // 形如 ),.30)
if (m) return Number(m[1])
const m2 = decl.match(/,\s*(0?\.\d+)\s*\)\s*$/)       // 形如 ,.97)
if (m2) return Number(m2[1])
return 1
```

配 6 条正负样本自检（`.30 / .10 / .34 / .97 / .02 / 不透明`）全过。

> **第 2 版尤其危险**：它不报错，算出 `rgb(46,160,67)`、差 199 ——
> 一个"看起来非常成功"的数字。若没做自检，会据此宣称"绿得很明显"，
> 而真实值差 60。这是「假绿」的第三种形态：不是检查 0 条，是检查算了错的值。

### 结论

| 完成标准 | 结果 |
| --- | --- |
| 控制台 0 条未定义警告 | ⚠ 无法实测（无浏览器/需认证），但 2-A~2-E 已证变量全定义、产物全带兜底 |
| 待执行组不再只有白边 | ✓ 卡片与面板底差 22 → **75** |
| 前景与第三步设定值一致 | ✓ `46,160,67` / `187,247,208`，alpha `.30` / `.10` |
| 与设计预期相符 | ✓ 绿底明显、层次清楚、文字 ≥ 4.5:1 |
| 对照说明（改前/改后） | ✓ 见上表 |
| 结论补记 `.plan/notes.json` | ✓ 见下 |
