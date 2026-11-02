# 任务 id 生成点清单（id=12MByl-A）

> 本步只做定位与记录，**未改动任何行为**。

## 一、底层实现（唯一的随机源）

| 文件 | 函数 | 行 | 作用 |
| --- | --- | --- | --- |
| `lib/host/taskid.js` | `defaultRandom()` | 49 | 取 `crypto.getRandomValues` |
| `lib/host/taskid.js` | `makeId(random)` | 80 | 生成 6 位 `0-9A-Za-z` |
| `lib/host/taskid.js` | `allocateId(existing, opts)` | 129 | 撞号重试（上限 64 次） |
| `lib/host/taskid.js` | `createTaskIds(options)` | 161 | 批量分配，内部累积 `taken` |
| `lib/host/taskid.js` | `createTaskId(options)` | 184 | 单个版（`createTaskIds(...count:1)[0]`） |
| `lib/host/taskid.js` | `collectIds(items)` | 198 | 收集父 + 子全部 id |

字母表 `0-9A-Za-z`，长度 `TASK_ID_LENGTH = 6`。

## 二、子任务 id 的派生规则

| 文件 | 函数 | 行 | 规则 |
| --- | --- | --- | --- |
| `lib/host/ids.js` | `childSuffix(index)` | 19 | `0→A`、`25→Z`、`26→AA` |
| `lib/host/ids.js` | `childIdOf(parentId, index)` | 41 | `` `${parentId}-${childSuffix(index)}` `` |
| `lib/host/ids.js` | `parentIdOfChild(id)` | 75 | 反解父 id |
| `lib/host/ids.js` | `isTopId(id)` | 114 | 正整数 **或** 6 位随机串 |
| `lib/host/ids.js` | `isChildId(id)` | — | 形如 `父id-后缀` |
| `lib/host/ids.js` | `codeOf(id)` | 143 | 从 id 派生展示编号，**不造序号** |

**子 id = 父 id + 后缀**，不是独立随机串。这是 5-B 时确认过的取舍：
`codeOf` / `parentIdOfChild` / `isTaskId` 都依赖这个形状。

## 三、链路 A：普通模式新增任务

```
api.js:628  append()
   └─ api.js:539  composeItem(...) 的结果再补 id
        └─ item.js:22  createTaskId({ existing: collectIds(items) })
```

| 文件 | 函数 | 行 | 调用 |
| --- | --- | --- | --- |
| `lib/host/api.js` | `append()` | 539 | `id: createTaskId({ existing: [...collectIds(items), ...archivedIds] })` |
| `lib/host/item.js` | `composeItem()` | 22 | `id: createTaskId({ existing: collectIds(items) })` |

`api.js:539` 覆盖 `composeItem` 产出的 id，额外把**归档 id** 也纳入去重集合
（避免与历史任务撞号）。

## 四、链路 B：拆解模式新增子任务

```
api.js:640  decompose()                       ← 模型拆解
   └─ api.js:677  createTaskId → parentId     ← 父 id 随机
        └─ decompose-batch.js:65  buildBatch()
             └─ ids.js:41  childIdOf(parentId, index) → 子 id
```

| 文件 | 函数 | 行 | 调用 |
| --- | --- | --- | --- |
| `lib/host/api.js` | `decompose()` | 677 | `const parentId = createTaskId({ existing: [...collectIds(fresh), ...archivedIds] })` |
| `lib/host/decompose-batch.js` | `buildBatch()` | 65 | 接收 `parentId`，产出父 + children |
| `lib/host/decompose-batch.js` | `buildBatch()` | 85 | `id: childIdOf(parentId, index)` |

### 另外两个也走「父 + 后缀」的分支

| 文件 | 函数 | 行 | 场景 |
| --- | --- | --- | --- |
| `lib/host/api.js` | `appendMany()` | 742 | 批量新增（每条独立随机） |
| `lib/host/children.js` | `foldSplits()` | 120 | 把散条目折叠成一个父 |
| `lib/host/migrate.js` | `migrateItems()` | 139/142 | 历史数据迁移 |
| `lib/host/api.js` | `update()` | 832 | 归档恢复（`keepId` 时保留原 id） |

## 五、为什么拆解模式「曾经」走自增

### 不是独立实现，也不是传了不同参数

两条链路**调用的是同一个 `createTaskId`**。问题出在**装配层的一个类型守卫**。

`decompose()` 确实拿到了随机 `parentId`，但它把这个字符串传给 `buildBatch` 时，
`buildBatch` 里的这行把它丢掉了：

```js
// 修复前（decompose-batch.js:67）
const parentId = Number.isInteger(ctx?.parentId) && ctx.parentId > 0 ? ctx.parentId : 1
```

- `Number.isInteger('ZqsS7q')` → `false`
- 于是 `parentId` **静默回退成 `1`**
- 子任务跟着变成 `1-A / 1-B / 1-C`

**现象**：普通模式 id 是随机的，拆解模式 id 是 `1`、`1-A`——看起来像"拆解走了自增"，
实际上是**随机 id 在装配层被类型守卫吃掉，回退到了默认值 1**。

### 为什么会出现这个守卫

`id=77-B` 之前，id 是自增整数（"取最大值 + 1"）。
那时 `Number.isInteger(ctx?.parentId)` 是**正确**的判断——父 id 就该是整数。

`77-B` 把生成侧换成随机串，但**只改了调用点，没检查下游是否接受新形状**。
守卫按旧前提写死，就一直挡着。

### 修复（QX5dyu-E）

```js
const rawParent = ctx?.parentId
const validParent = typeof rawParent === 'number'
  ? Number.isInteger(rawParent) && rawParent > 0
  : typeof rawParent === 'string' && isTopId(rawParent)
const parentId = validParent ? rawParent : 1
```

两种形状都认（与 `isTopId` 同口径）：正整数（历史）、6 位随机串（新格式）。

## 六、实测确认（当前代码）

用真实函数跑四条链路：

| 链路 | 产出 | 形状 |
| --- | --- | --- |
| A 普通模式 `composeItem` | `WKEX8a` | 6 位随机 ✓ |
| B 拆解 `decompose → buildBatch` | 父 `V4Rsk0`，子 `V4Rsk0-A/B` | 父随机 + 后缀 ✓ |
| C 批量 `appendMany` | `fW0wif, dYxNAL, r7ERnC` | 全部随机 ✓ |
| D 折叠 `children.js` | 父 `ovjI3D`，子 `ovjI3D-A/B` | 父随机 + 后缀 ✓ |

**自增式写法（`max+1` / `nextId++` / `counter++` / `seq++`）在 lib/host 下命中 0 次。**

拆解模式已经和普通模式一样产出随机 id。正文所述的问题在 5-B（生成侧）与
QX5dyu-E（装配侧）两步中已修复。

## 七、仍有「数字」的地方（有意保留）

| 位置 | 为什么 |
| --- | --- |
| `isTopId` 接受正整数 | 历史数据 `12` / `12-A` 必须继续可读（ids.js:108 注释「两种历史形状都认」） |
| `buildBatch` 非法值回退 `1` | 兜底：调用方没给 parentId 时的行为 |
| `store.js:61` `makeId()` | 读时占位，不是真实分配点 |
| `.plan/notes.json` 里的 `2`/`3`/`4` | 归档历史，重写会让旧引用失效（已确认不动） |
| `renumber.js:192` `return max + 1` | **不是 id 生成器**。`startIdAfter()` 只处理「归档里全是旧数字 id」，算一个安全起始序号给 `renumber()`。归档全是随机 id 时返回 `1`，而 `renumber()` 会因守卫直接跳过，这个 1 从不被使用。 |
| `renumber.js:154` 的守卫 | 列表里只要有一条 id 不是纯数字，`renumber()` 原样返回 —— **随机 id 永不被重编号**。 |

## 八、检索过程中的一个判据修正

最初的「自增残留」扫描把 `renumber.js:192` 的 `max + 1` 报成命中，
但读代码后确认它**不是 id 生成器**：

- `startIdAfter()` 的输入是**归档**（历史数据），输出是个**起始序号**
- 它只在 `needsRenumber()` 为真时才被用到
- 而 `needsRenumber()` 要求列表里存在纯数字 id —— 当前 plan 全是随机 id，恒为假

> 「grep 到一个 `+1`」不等于「这是一条自增 id 链路」。
> 判定要看它**在谁身上、被谁调用、什么条件下才会执行**。

---

## 九、批量唯一性核查（id=12MByl-B）

题面要求：拆解链路调用与普通模式**完全相同**的随机函数；旁路掉自增计数器；
确认同一批次多个子任务各自得到互不重复的 id；若批量循环，确保每次迭代重新生成而非复用。

### 结论：三条要求现状全部成立，**本步无代码改动**

| 要求 | 现状 |
| --- | --- |
| 与普通模式同一函数 | ✓ 都 import `createTaskId` from `taskid.js` |
| 拆解链路无自增计数器 | ✓ `decompose-batch.js` / `children.js` 命中 0 处 |
| 批内互不重复 | ✓ 实测 500 个全不重复 |
| 每次迭代重新生成 | ✓ 两处批量循环每轮都重新调用并累积 |

### 为什么「每次迭代重新生成」不等于「每个都独立随机」

拆解的子 id 是 **`父id-后缀`**（`父id-A/B/C`），后缀由 `index` 经 `childSuffix()` 派生。

这**不是复用同一个值**——每次迭代 `index` 不同，产出必然不同。
它与「每条都独立随机」是两种设计，`5-B` 时已确认选择前者（后者会打断
`codeOf` / `parentIdOfChild` / `isTaskId` 对「父id-后缀」形状的依赖）。

### 实测数据

| 场景 | 数量 | 结果 |
| --- | --- | --- |
| 同一父、52 个子（跨 Z→AA→AZ） | 52 | 全不重复，进位正确 |
| 100 批 × 4 子（父各不同） | 500 | **500/500 全不重复** |
| `appendMany` 式循环 | 200 | 全不重复 |
| `createTaskIds` 批量 | 5 / 50 / 200 | 全部批内去重 |
| 已有 100 + 新增 100 | 200 | 与既有不撞 |

进位验证：索引 25 → `Z`、26 → `AA`、51 → `AZ`。

### 每处调用的去重是否正确

8 处 `createTaskId` 调用中，只有 2 处带 `taken.push`：

| 位置 | 是否批量 | 累积方式 |
| --- | --- | --- |
| `api.js:742` `appendMany` | **是**（`.map`） | `taken.push` ✓ |
| `children.js:120` `foldSplits` | **是**（`for`） | `taken.push` ✓ |
| `api.js:539` `append` | 否（单条） | 不需累积 |
| `api.js:677` `decompose` | 否（只生成 1 个父） | 不需累积 |
| `api.js:832` `update` | 否（单条） | 不需累积 |
| `item.js:22` `composeItem` | 否（单条） | 不需累积 |
| `migrate.js:139/142` | 否（逐条） | `taken.add()`（Set）✓ |

**批量处全部累积，单条处无需累积。** 没有遗漏。

### 一个反证值得记下

故意不累积 `taken`（每轮传同一个空数组）跑 50 次，**重复 0 个**。
36⁶ ≈ 2.2×10⁹ 的随机空间，50 次偶然不撞很正常。

> 所以「测了几次没撞」**不能证明**实现是对的 ——
> 真正保证不撞的是 `taken` 累积 + `allocateId` 的撞号重试。
> 验证这类去重逻辑要看**累积是否真的发生**，而不是抽样跑几次。

### 一点补充

`createTaskIds({ count: n })` 内部已经把每个生成的 id push 进 `taken`
（`taskid.js:161`），所以批量 API 天然批内去重 —— 这也是 5-B 时做的统一入口。
