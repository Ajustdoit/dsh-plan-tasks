# id 数字语义审计（id=12MByl-C）

> 目标：确认改成随机 id 后，没有任何地方仍假设「id 是可比较的递增数字」。

扫描范围：`lib/host/*.js`（38 个）+ `src/client/*.js`（8 个），共 46 个文件。
（`lib/client.js` 是构建产物，不计入。）

## 一、结论先行

**没有发现仍在依赖数字语义的位置，本步无行为改动。**

所有「把 id 当数字」的写法（`a.id - b.id`、`parseInt(id)`、`id + 1`、`id > max`）
在源码中命中 **0 处**。三处排序实现全部已改为「先 order、再 id 字符串比较」。

两处 `Number(...id...)` 经逐个确认，都属于「取不到数字时安全兜底」，不是数字语义依赖。

## 二、危险写法扫描（全部 0 命中）

| 模式 | 命中 |
| --- | --- |
| `a.id - b.id` 相减 | 0 |
| `id` 减数字 | 0 |
| `parseInt(某.id)` | 0 |
| `Number(某.id)` 直接转换 | 0 |
| `id + 1` | 0 |
| `id - 1` | 0 |
| `id > max` | 0 |

## 三、排序：三处实现，全部字符串兜底

| 文件 | 函数 | 口径 |
| --- | --- | --- |
| `lib/host/paths.js` | `byOrder(a, b)` | order 升序 → `String(id)` 比较 |
| `lib/host/queue-cli.js` | `byOrder(a, b)` | 同上（独立实现，逻辑一致） |
| `src/client/60-tab.js` | `byTaskOrder(a, b)` | 同上（前端） |

三处都是：

```js
const oa = Number.isFinite(a?.order) ? Number(a.order) : 0
const ob = Number.isFinite(b?.order) ? Number(b.order) : 0
if (oa !== ob) return oa - ob
const ia = String(a?.id ?? '')
const ib = String(b?.id ?? '')
if (ia === ib) return 0
return ia < ib ? -1 : 1
```

**缺失/非法 order 一律读作 0** —— 旧的「缺失时拿 id 当 order 用」兜底已删除，
那会让 `a.id` 与数字 order 直接相减，是 NaN 来源。

### 行为实测

| 场景 | 结果 |
| --- | --- |
| 随机 id + 相同 order，正序/反序输入 | 结果一致 ✓ |
| 同一组数据重复排 20 次 | 20 次完全相同 ✓ |
| order 不同 | order 优先（不按 id）✓ |
| order 缺失/NaN | 当作 0，排在有效 order 之前 ✓ |
| 历史数字 id 与随机 id 混合 | 稳定、与输入顺序无关 ✓ |
| 200 条真实随机 id | 确定性排序、无重复无丢失 ✓ |

### 反证：为什么不能用 `a.id - b.id`

```
'Zz9aQ1' - 'aB3xK9'  =  NaN
NaN < 0  →  false
NaN > 0  →  false
```

两边都是 false，比较不满足反对称性，排序结果**未定义** ——
不同引擎、不同数据可能给出不同顺序，表现为「刷新一次顺序变一次」。

## 四、两处 `Number(...id...)` 的逐个判定

### 1. `lib/host/trim.js:59` 与 `:72`（归档淘汰排序）

```js
const head = Number(String(item?.id ?? '').split('-')[0])
return Number.isFinite(head) ? head : Number.MAX_SAFE_INTEGER
```

用途：`noteTimeOf()` 在 **createdAt / finishedAt / startedAt 三者全缺**时，
拿 id 当"假时间"。随机 id 取头部会得到 `NaN` → 回退 `MAX_SAFE_INTEGER`。

**判定：安全。** 两个理由：

1. 真实数据里归档条目**都有 `createdAt`**（实测 15/15），这条路径不会走到；
2. 即使走到，`byNoteAge` 末尾还有 `id` 字符串兜底，排序仍确定：
   ```
   场景B（三时间全缺）：正序输入保留 aB3xK9，反序输入仍保留 aB3xK9 → 稳定
   ```

它**不是**"假设 id 递增"，而是"取不到数字就退到字符串"——方向是对的。

### 2. `lib/host/store.js:61`（判断历史 id）与 `migrate.js`（同类判断）

```js
Number.isInteger(item.id) && item.id > 0 ? item.id : makeId()
```

用途：识别**历史遗留的数字 id** 并原样保留（兼容旧数据）。
这是**有意为之的兼容逻辑**，不是数字语义依赖 —— 随机 id 走另一条分支。

## 五、其他用途逐项确认

| 用途 | 位置 | 结论 |
| --- | --- | --- |
| **展示** | `50-item.js` `` `#${item.id}` `` 等 | 纯字符串插值 ✓ |
| **展示截断** | `store.js` `LITE_PLAN_MAX` | 与 id 无关 ✓ |
| **编号派生** | `ids.js` `codeOf(id)` | 从 id 文本派生，不造序号 ✓ |
| **去重** | `Set` + `collectIds` | 字符串天然可去重 ✓ |
| **查找** | `Map` 以 id 为键 | 字符串键 ✓ |
| **依赖引用** | `parentIdOfChild` | 按 `-` 切分，不要求数字父段 ✓ |
| **URL/锚点** | 12 处 `` `#${id}` `` | 全是**展示文案**，非路由 ✓ |
| **排队** | `queue-cli.js` `suffixNumber` | 只解析子任务**后缀字母**（A→0、AA→26），一级 id 返回 `MAX_SAFE_INTEGER` 排最后 ✓ |

### 关于 `suffixNumber`

它唯一的"数字"是子任务后缀的字母序（`-A` → 0、`-Z` → 25、`-AA` → 26）。
这与父 id 是什么形状无关 —— 父段完全不参与解析。

## 六、实际改了什么

**没有。** 所有要求项在本次审计前就已满足：

- 无数字递增假设 → 0 处
- 排序改为 order + 字符串 → 三处都已是
- 展示截断正常 → 与 id 无关
- URL/锚点 → 无路由依赖

原因是 `77-B`（生成侧换随机）与 `77-C`（排序去数字语义）两步做过一轮系统整改，
本次全量复查确认没有遗漏。

## 七、一个仍然值得注意的点

`byOrder` 在 `paths.js` 与 `queue-cli.js` 中**各写了一份**，前端又有第三份。
三份目前逻辑一致，但**没有机制保证它们不会走散**。

若将来要收敛，可以抽到 `order.js` 统一导出 —— 但这属于重构，超出本步范围，先记录在此。
