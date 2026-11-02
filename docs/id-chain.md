# id 生成 → 写入 → 读取 → 展示 链路（id=5-A）

## 一、一句话结论

**id 确实由加密随机源生成**（`crypto.getRandomValues`，6 位 `0-9A-Za-z`），
**没有**回退成索引 / 自增 / 时间戳。

但存在两条**会让随机 id 变成数字 id** 的通道：

1. `isTopId()` **认可正整数**（为兼容旧数据），于是数字 id 被原样保留；
2. `renumber()` 在「列表里没有任何随机 id」且 `sequential=true` 时，按 `base + index` 重排。

界面上看到的 `1` / `2` 就是这两条通道的产物，不是生成函数给的。

---

## 二、生成层

### 2.1 随机源

`lib/host/taskid.js:49` `defaultRandom()`：

```js
const g = globalThis.crypto
if (g !== undefined && typeof g.getRandomValues === 'function') {
  return () => {
    const buf = new Uint32Array(1)
    g.getRandomValues(buf)          // ← 真·加密随机
    return buf[0] / 2 ** 32         // [0,1)
  }
}
```

有降级路径（无 `crypto` 时用 `Math.random`），但仍是随机。

### 2.2 makeId

`taskid.js:80`：取 `TASK_ID_LENGTH = 6` 个字符，字母表 `0-9A-Za-z`（62 个）。
空间约 `62^6 ≈ 5.7e10`。

**实测**：200 次生成，去重后 200 个，形状全部合法，非自增。

### 2.3 allocateId

`taskid.js:129`：在 `makeId` 外包一层，传入「已占用集合」，撞了就重试。

**实测**：给 `['aB3xK9','12','aB3xK9-A']`，生成 50 个，全部避开且互不相同。

### 2.4 子任务 id：childIdOf

`lib/host/ids.js:41`：

```js
function childIdOf(parentId, index) {
  return `${String(parentId)}-${childSuffix(index)}`
}
```

后缀 0→A、25→Z、26→AA（26 进制，但无 0 位）。

**实测**：`childIdOf('aB3xK9',0)='aB3xK9-A'`、`('x',26)='x-AA'`。

**关键**：子 id 完全由父 id 派生，自身不调用随机函数。
父是随机串 → 子就是 `aB3xK9-A`；父是 `12` → 子就是 `12-A`。

---

## 三、生成点清单（10 处）

| 位置 | 场景 | 调用 |
| --- | --- | --- |
| `api.js:539` | 新建计划 | `allocateId([...collectIds(items), ...archivedIds])` |
| `api.js:677` | **拆解**出父任务 | `allocateId([...collectIds(fresh), ...archivedIds])` |
| `api.js:741` | 批量导入 | `allocateId(taken)` |
| `api.js:831` | 归档恢复 | `keepId ? next.id : allocateId(...)` |
| `children.js:120` | 折叠旧格式为父 | `allocateId(taken)` |
| `children.js:146` | 折叠时重排子 id | `childIdOf(parentId, index)` |
| `item.js:22` | 单条新建 | `allocateId(collectIds(items))` |
| `migrate.js:139` | 迁移：撞号 | `allocateId(taken)` |
| `migrate.js:142` | 迁移：非法 | `allocateId(taken)` |
| `store.js:65` | 读时兜底 | `makeId()` |

### 回退分支排查（逐项确认）

| 可能的回退方式 | 是否存在 | 证据 |
| --- | --- | --- |
| 回退成数组索引 | **否** | `store.js` 的注释明确写着「原来是 `: index + 1`」，已改掉 |
| 回退成自增数 | **否** | `api.js:537` 注释「不再『最大值加 1』」 |
| 回退成时间戳 | **否** | id 取值表达式里无 `Date.now()`（文件里的 `Date.now` 只用于临时文件名） |
| 回退成临时 key | **否** | 无 `tmp`/`temp` 形式的 id 分支 |

`store.js:61` 的实际分支：

```js
const id = Number.isInteger(item.id) && item.id > 0
  ? item.id                                              // ← 保留旧数字 id
  : typeof item.id === 'string' && item.id !== ''
    ? item.id                                            // ← 保留已有字符串
    : makeId()                                           // ← 都没有才生成
```

**注意第一行**：它不生成，但**放行**了正整数 id。这是数字 id 能存活的原因。

---

## 四、写入层：谁会把随机 id 改掉

### 4.1 isTopId 认可正整数

`lib/host/ids.js:114`：

```js
function isTopId(id) {
  if (typeof id === 'number') return Number.isInteger(id) && id > 0
  if (typeof id !== 'string') return false
  if (/^[1-9]\d*$/.test(id)) return true      // ← 纯数字串也算合法
  return /^[0-9A-Za-z]{6}$/.test(id)
}
```

实测：`isTopId(1)=true`、`isTopId('12')=true`、`isTopId('12-A')=false`。

这是**刻意的向后兼容**（旧 `plan.json` 里全是 `76,77,78` 这种）。

### 4.2 renumber 的重排条件

`lib/host/renumber.js:158`：

```js
// 含随机 id → 这是新格式数据，不参与「连续数字」重排。
if (list.some((item) => typeof item?.id === 'string' && !/^\d+$/.test(item.id))) {
  return { items: list, changes: [] }
}
```

**实测行为**：

| 输入 | sequential | changes |
| --- | --- | --- |
| `[3,7]` | true | `[{from:3,to:1},{from:7,to:2}]` ← 重排 |
| `[3,7]` | false | `[]` |
| `[1,2]` | true/false | `[]` |
| `[aB3xK9, 2]` | true | `[]` ← 有随机就不动 |

**风险点**：列表里剩的全是数字 id 时（用户只剩一条纯数字任务），
`sequential=true` 会把它重编成 `1,2,3...`。

### 4.3 startIdAfter 决定起点

`renumber.js:182`：从归档里取最大数字 + 1。

| 归档 | 起点 |
| --- | --- |
| 空 | 1 |
| 只有随机 id（无法转数字） | 1 |
| 含 12 与 7 | 13 |
| 含子 id `5-A` | 6 |

归档全是随机串时起点退回 **1** —— 这解释了为什么新数据里会出现 `1`、`2`。

---

## 五、读取与展示层

### 5.1 界面只认 id 字段

`src/client/50-item.js`：

| 用途 | 代码 |
| --- | --- |
| 展示 | `h('span', { className: 'plt-id' }, \`#${item.id}\`)` |
| 子任务 key | `{ key: child.id, ... }` |
| data 属性 | `'data-id': String(child.id)` |
| 详情请求 | `onFetchDetail(item.id)` |
| 拖拽载荷 | `e.dataTransfer.setData('text/plain', String(item.id))` |
| 复制 ID | 模板里读 `item.id` |

**没有第二个编号来源** —— 没有「序号」「行号」之类的旁路字段。
所以 id 一旦被重排，界面上的编号会立刻跟着变。

### 5.2 子任务的 code 回退

`50-item.js:47`：

```js
const codeText = rawCode !== '' ? rawCode : String(child.id ?? '').trim()
```

`code` 缺失时回退到 `child.id` —— 仍是同一字段族，不引入新编号。

---

## 六、完整链路

```
【生成】
  makeId() ← crypto.getRandomValues        ← 真随机，6 位
     ↓
  allocateId(existing)                      ← 避让已占用
     ↓
  父 id：aB3xK9
  子 id：childIdOf(parent, i) → aB3xK9-A / -B / -C   ← 派生，不调随机

【写入】
  normalizeNode (store.js)
     整数 id → 原样保留   ← ★ 数字 id 在此存活
     非法   → makeId()
     ↓
  migrateItems (migrate.js)
     isTopId 认可 → 保留；撞号/非法 → allocateId
     ↓
  renumber (renumber.js)
     列表含随机 id → 跳过   ← ★ 有随机就安全
     全是数字 + sequential → base+index 重排   ← ★ 风险点
     startIdAfter(归档) 决定 base

【读取】
  API → items[] → 每条带 id 字段

【展示】
  50-item.js: `#${item.id}`、key=child.id、data-id=String(child.id)
```

---

## 七、后续修复的落点（留给 5-B 起）

按已查明的事实，能改的地方只有三处，且各有代价：

| 落点 | 改什么 | 代价 |
| --- | --- | --- |
| `isTopId` | 不再认可纯数字 | 旧 `plan.json`（`76,77,78`）会被判非法 → 触发迁移换 id → 历史引用「任务id:45」变死链 |
| `renumber` | 去掉/收紧 `sequential` 重排 | 旧数据首次迁移时的「整队重排」行为改变 |
| `store.js:61` | 整数 id 也换随机 | 每次读都可能改 id，除非同时落盘 |

**共同约束**：这三处都是为了兼容历史数据而故意这么写的
（`ids.js:108` 的注释：「两种历史形状都认」）。改动必须先想清楚
「现存旧数据怎么办」，否则会把一条兼容性修复变成数据损坏。

本文档只记录事实，不含修复方案。

---

## 八、实测数据

| 项 | 结果 |
| --- | --- |
| makeId 200 次 | 200 个互不相同，形状全合法 |
| allocateId 50 次（3 个已占用） | 50 个互不相同，全部避开 |
| childIdOf 进位 | 25→Z，26→AA |
| isTopId 判定 | 9 个正负样本全过 |
| renumber | 5 种输入组合，行为符合上表 |
| startIdAfter | 4 种归档形态 |

共 27 条断言。

### 一处工具坑（第三次）

`store.js` 的注释里写着「原来是 `: index + 1`」这段历史，
我的检查一开始把**注释**当成了现存代码，误报「存在索引回退」。
`Date.now()` 同理（它用于临时文件名）。

> 扫源码找「某写法是否存在」时，**必须先剥注释**。
> 这是同一类坑第三次踩到（前两次：CSS 注释里的 `.xxx` 被算成类名）。

---

## 九、统一生成入口（id=5-B）

### 先澄清一处冲突

5-B 的正文要求「每个子任务 id **独立随机**」，但用户此前明确要求子任务用
「**随机id-A** 这种」格式。两者不能同时成立。

已向用户确认：**保持 `<父id>-<后缀>`**。理由是代码里三处依赖这个形状：

| 函数 | 用途 | 破坏后果 |
| --- | --- | --- |
| `codeOf(id)` | 从 id 取 `A/B/C` 后缀，界面编号的来源 | 编号整片消失 |
| `parentIdOfChild(id)` | 由子 id 反查父 id | 子任务的归属关系断掉 |
| `isTaskId(id)` | 判断是否子任务 id | 迁移时误判合法性 |

所以本条的落地是：**统一入口 + 保证三条不重复**，而不是把子 id 改成独立随机串。

### 新增统一入口

`lib/host/taskid.js` 新增并导出：

```js
createTaskIds({ existing, reserved, count })   // 一次分配 N 个，批内自动去重
createTaskId({ existing, reserved })           // 分配 1 个
```

两者都建立在已有的 `allocateId` 之上（复用既有随机源，没有另造一套）。

**为什么需要这一层**：原来 10 处生成点各自手动拼「已占用集合」，有两个隐患：

1. 有人漏传某个集合（比如忘了 `archivedIds`）→ 生成出与归档撞号的 id；
2. 同一批次连生成多个时，后生成的看不到先生成的 → **批内撞号**。

新入口把这两件事收进一处：**每分配一个就记进 `taken`**，批内天然不撞。
调用方只需一次性把外部已占用传进来。

### 生成点全部改造（8 处替换）

| 文件 | 调用点 | 改法 |
| --- | --- | --- |
| `api.js` | 新建计划 | `createTaskId({ existing: [...collectIds(items), ...archivedIds] })` |
| `api.js` | **拆解父任务** | `createTaskId({ existing: [...collectIds(fresh), ...archivedIds] })` |
| `api.js` | 批量导入 | `createTaskId({ existing: taken })` |
| `api.js` | 归档恢复 | `createTaskId({ existing: collectIds(items) })` |
| `children.js` | 折叠旧格式 | `createTaskId({ existing: taken })` |
| `item.js` | 单条新建 | `createTaskId({ existing: collectIds(items) })` |
| `migrate.js` | 迁移撞号 | `createTaskId({ existing: taken })` |
| `migrate.js` | 迁移非法 | `createTaskId({ existing: taken })` |

各文件的 `import { allocateId, ... }` 同步改为 `import { createTaskId, ... }`，
未再使用 `allocateId` 的不再导入（`unused-imports` 会拦）。

**保留一处 `makeId()`**：`store.js:65` 的读时兜底。它是「读盘时字段缺失」的
临时值，不是正式分配点，且下次写盘会被上层重新分配，所以不纳入统一入口。

### 三条不重复的实测

| 保证 | 结果 |
| --- | --- |
| ① 子 id 与父不重复 | ✓ `N7XTKM` vs `N7XTKM-A`… |
| ② 子之间互不相同 | ✓ 5 个子全不同 |
| ③ 与同批次其他任务不冲突 | ✓ 全集 9 个无重复 |

批次独立性：连续 5 次独立分配，5 个互不相同。

大样本：**5000 次分配无碰撞**；**批内一次要 500 个也无重复**。

### 落盘

| 文件 | 存什么 | 备注 |
| --- | --- | --- |
| `.plan/plan.json` | 每条任务的 `id` 字段 | 子任务在父的 `children[].id` |
| `.plan/dispatch.json` | `cursor.delivered[]` | 存原始类型（string 或整数），读时 `String()` 归一 |

`delivered` 这一条原本我写成「存储侧应出现 String()」，实测是**错的** ——
`cursor.js:47` 明确保留原始类型（`typeof id === 'string' || Number.isInteger(id)`），
归一发生在读取侧（`delivered.map(String)`）。断言已修正。

### 验证（26 条断言）

导出 2 条、生成点统一 10 条、批内去重 3 条、子任务三条保证 6 条、
`collectIds` 3 条、落盘结构 3 条。

### 本轮改动汇总

| 文件 | 改动 |
| --- | --- |
| `lib/host/taskid.js` | 新增 `createTaskId` / `createTaskIds` 并导出 |
| `lib/host/api.js` | 4 处调用 + import |
| `lib/host/children.js` | 1 处调用 + import |
| `lib/host/item.js` | 1 处调用 + import |
| `lib/host/migrate.js` | 2 处调用 + import |

CSS 产物无变化（530 条规则，sha256 `6b7f9744c3782f89`）。

---

## 十、界面侧核查（id=5-C）

### 结论：界面完全使用持久化 id，无需修改

逐项核对后，**没有发现任何用 index / 序号 / 循环 key / 临时占位值 覆盖真实 id 的地方**。
也没有字段名不匹配导致的取空回退。

### 展示

| 位置 | 取值 | 判定 |
| --- | --- | --- |
| 顶层编号 | `` h('span', { className: 'plt-id' }, `#${item.id}`) `` | ✓ 持久化 id |
| 子任务编号 | `child.code`，回退 `child.id` | ✓ 同源 |
| tooltip | `` `#${item.id} ${item.name}` `` | ✓ |
| 复制 ID | `` `复制这条计划的 ID（${item.id}）` `` | ✓ |

### 循环 key

| 位置 | key | 判定 |
| --- | --- | --- |
| 顶层任务列表 | `key: item.id` | ✓ 持久化 id |
| 子任务行 | `key: child.id` | ✓ |

全仓 `key: index` / `key: i` / `key: idx` 出现 **0 次**。

### 子任务遍历

```js
kids.map((child) => { ... })
```

回调**只取 `child`，不取 index**，所以不存在"用下标当 id"的可能。

### 编号回退链

```js
const rawCode = String(child.code ?? '').trim()
const codeText = rawCode !== '' ? rawCode : String(child.id ?? '').trim()
```

`code` 缺失时回退到 `child.id` —— 两者**同源**，不是退回序号。

`codeOf` 的实现印证了这一点：

```js
function codeOf(id) {
  if (typeof id === 'number') return Number.isInteger(id) && id > 0 ? String(id) : ''
  const text = String(id ?? '')
  if (isTopId(text)) return text
  if (isChildId(text)) return text
  return ''
}
```

**它只是把 id 文本返回，不做任何序号运算**（无 index、无 length、无下标）。

### 下发路径

| 场景 | 代码 |
| --- | --- |
| 拖拽排序 | `e.dataTransfer.setData('text/plain', String(item.id))` |
| 取详情 | `onFetchDetail(item.id)` |
| 批量通过 | `onApproveBatch(item.id, …)` |
| DOM 定位 | `'data-id': String(child.id)` |
| 派发比对 | `delivered.some((x) => String(x) === String(item.id))` |

全部用真实 id。

### 反证：六种「序号覆盖」写法全为 0

| 模式 | 命中 |
| --- | --- |
| `id = index` | 0 |
| `id: index` | 0 |
| `` id: `...${index}` `` | 0 |
| `id: i` | 0 |
| `index + 1` 参与 id | 0 |
| `String(index)` | 0 |

### 字段名一致性（全量核对）

界面消费 20 个字段，宿主产出点逐一核对：

```
children, code, createdAt, decomposeKey, execute, failed, id,
interrupted, mode, name, note, noteLen, plan, planLen, review,
sourcePrompt, sourcePromptLen, startedAt, taskType, time
```

**20 个字段全部能在宿主里找到产出点，0 个搜不到。**

编号相关的两个字段：

| 字段 | 宿主产出 | 界面消费 |
| --- | --- | --- |
| `id` | `normalizeNode` 返回 | `item.id` / `child.id` |
| `code` | `toLiteItem`：`code: codeOf(item.id)` | `child.code` |

`toLiteItem` 用 `...item` 展开，所以 `id` 原样透传，不会被裁掉。

### 所以本轮改动

**无。** 三条要求（用持久化 id、修正字段名不匹配、删掉序号兜底）
在现状下**都已经成立**，没有可修的东西。

如实记录：我一开始怀疑 `50-item.js:47` 的 `code → id` 回退是"取空回退"，
读 `codeOf` 后才确认它只是返回 id 文本，回退是**合理的健壮性**而非缺陷。
若强行删掉它，反而会让"未投影的 children"显示不出编号。

### 验证（25 条断言）

展示 3 条、key 3 条、子任务遍历 2 条、编号回退链 4 条、
下发 4 条、反证 6 条、字段匹配 3 条。

### 一处工具坑

提取函数体时用了 `[\s\S]*?\n\}`，遇到缩进的 `}` 就不匹配，
导致 `toLiteItem` / `codeOf` 提取为空、三个断言误报 FAIL。
改用**括号配平**提取后全部正常。

> 从源码里抠函数体，别用「到第一个 `}` 为止」这种正则。

---

## 十一、存量数据 id 重写（id=5-D）

### 动手前的现状

| 位置 | 数字 id |
| --- | --- |
| `plan.json` | `5`（5 个子任务 `5-A`…`5-E`）、`6`（3 个子任务 `6-A`…`6-C`） |
| `plan.json` | `8sg3iA` —— 已经是随机，不动 |
| `notes.json`（归档） | `2`、`3`（6 个子）、`4`（3 个子） |
| `dispatch.json` | `groupId: "5"`、`delivered: [4-A,4-B,4-C,5-A,5-B,5-C,5-D]` |

### 处理范围（已与用户确认）

| 对象 | 处理 |
| --- | --- |
| `plan.json` 的 `5`、`6` | **重写为随机 id**，子 id 同步重新派生 |
| `dispatch.json` 的 cursor | **同步更新**（groupId + delivered） |
| `notes.json` 的 `2/3/4` | **不动** —— 历史记录，重写会让「任务id:3」这类引用失效 |
| `delivered` 里的 `4-A/4-B/4-C` | **保留** —— 详见下面的判断修正 |

### 一个差点做错的决定

我一开始把 `4-A/4-B/4-C` 判成「悬空引用」，理由是它们既不在 plan 顶层、也不在归档顶层。
用户也同意「清掉悬空项」。

但写脚本时我查了归档的 `children`：

```
4 kids=3 → 4-A, 4-B, 4-C
```

**它们是归档条目 `4` 的子任务，完全合法。** 我之前那次检查只看了顶层 id，漏掉了 children，
把「子任务」误判成「悬空」。

所以真正执行时**没有删除它们**，脚本的存活判定也正确地把归档的 children 纳入了。

> 这是「假绿」的反面：一次**假红**。检查器给了错误结论，差点删掉三条有效记录。
> 教训：判「悬空」时，存活集合必须同时收顶层 id 与 children。

### 重写规则

直接调用与生成侧**同一套函数**，不自己造：

```js
const newId = createTaskId({ existing: taken })        // lib/host/taskid.js
const newKids = kids.map((_, i) => childIdOf(newId, i)) // lib/host/ids.js
```

`taken` = plan 全部 id + 归档全部 id（含 children），保证新 id 不与任何现存 id 撞。

### 结果

| 旧 | 新 |
| --- | --- |
| `5` | `QX5dyu` |
| `5-A`…`5-E` | `QX5dyu-A`…`QX5dyu-E` |
| `6` | `6Gs9v1` |
| `6-A`…`6-C` | `6Gs9v1-A`…`6Gs9v1-C` |

`dispatch.json`：

```
groupId:   "5"        → "QX5dyu"
delivered: [4-A,4-B,4-C,5-A,5-B,5-C,5-D]
        →  [4-A,4-B,4-C,QX5dyu-A,QX5dyu-B,QX5dyu-C,QX5dyu-D]
```

### 校验（18 条断言）

| 项 | 结果 |
| --- | --- |
| 3 个顶层 id 全是 6 位随机、无纯数字 | ✓ |
| 8 个子 id 依次为 `父id-A/B/C…` | ✓ |
| plan 内 11 个 id 无重复 | ✓ |
| 与归档 id 无重叠 | ✓ |
| `delivered` 无悬空 | ✓ |
| `groupId` 指向 plan 里的顶层 id | ✓ |
| 条目数、子任务数不变（3 / 8） | ✓ |
| 归档保留原数字 id | ✓ |

### 用真实读取路径复核（关键）

JSON.parse 自证不算数 —— 写回格式可能被下游读坏。用宿主自己的函数读：

```
store.readPlan()      → items=3, error=null
actionable()          → 6 条可执行（QX5dyu-D/E、6Gs9v1-A/B/C、8sg3iA）
applyCursor()         → reason: inflight, head: QX5dyu-D
```

`inflight` 是对的：`QX5dyu-D` 已派发、当时还没回填。

回填 `QX5dyu-D` 后再读：`reason: ok, taskId: QX5dyu-E` —— 派发链路完整恢复。

### 部署

数据变更，无需重建 CSS。插件每次请求都从 `.plan/*.json` 现读，刷新页面即生效。

备份：`.plan/plan.json.pre-5d`、`.plan/dispatch.json.pre-5d`。

---

## 十二、端到端验证 —— 抓到最后一处真 bug（id=QX5dyu-E）

### 端到端一跑就暴露

在隔离目录里走完整链路（生成 → 拆解 → 落盘 → 读回 → 展示），第一步就挂了：

```
=== 2. 生成拆解子任务 ===
  父: 1                ← 我传入的是随机的 ZqsS7q
    子: 1-A / 1-B / 1-C
FAIL  子是 父id-A/B/C
```

`createTaskId` 明明给了随机串 `ZqsS7q`，`buildBatch` 返回的父 id 却是 **`1`**。

### 根因：`decompose-batch.js:67`

```js
const parentId = Number.isInteger(ctx?.parentId) && ctx.parentId > 0 ? ctx.parentId : 1
```

**它只认整数。** `Number.isInteger('ZqsS7q')` 是 `false`，于是父 id 被
**静默替换成 `1`**，子任务跟着变成 `1-A/1-B/1-C`。

这就是 5-B 改造之后仍然产生数字 id 的原因：生成侧（`api.js:677`）给的随机串，
在**装配这一层**被丢掉了。5-B 只改了调用点，没有检查下游是否接受随机串。

> 教训：改「生成入口」时，必须顺着数据流往下走一遍，
> 确认每一层的类型守卫都接受新的形状。只看调用点是不够的。

### 修复

```js
const rawParent = ctx?.parentId
const validParent = typeof rawParent === 'number'
  ? Number.isInteger(rawParent) && rawParent > 0
  : typeof rawParent === 'string' && isTopId(rawParent)
const parentId = validParent ? rawParent : 1
```

与 `ids.js` 的 `isTopId` 同口径：正整数（历史）与 6 位随机串（新格式）都认。

### 八种输入的正负样本

| 输入 | 结果 | 期望 |
| --- | --- | --- |
| `'CN8U1A'` | `CN8U1A` | ✓ 随机串保留 |
| `12` | `12` | ✓ 历史整数 |
| `'12'` | `'12'` | ✓ 历史数字串 |
| `''` | `1` | ✓ 非法回退 |
| `undefined` | `1` | ✓ |
| `null` | `1` | ✓ |
| `0` | `1` | ✓ |
| `-5` | `1` | ✓ |

每个用例都额外验证「子 id 跟着父派生」。
另外重复生成 20 次，父 id 全不同且无一个是 `1`。

### 真实数据里有两条脏记录

验证时发现真实 `.plan/plan.json` 里**两条任务的 id 都是 `1`**：

| order | createdAt | 标题 |
| --- | --- | --- |
| 22003 | 07:01:12 | 待执行 组 的颜色还是有点问题 我要求的是 绿色主题… |
| 23003 | 07:02:31 | **我发现 普通模式添加的 id 是随机的，但是 拆解模式添加的 id 就是按数字开的** |

第二条的标题正是这个 bug 的用户描述 —— 时间和现象完全对得上。

已按用户确认重写：

| 旧 | 新 |
| --- | --- |
| `1`（Vrfpg7 组） | `Vrfpg7`，子 `Vrfpg7-A/B/C` |
| `1`（12MByl 组） | `12MByl`，子 `12MByl-A/B/C/D` |

### 重写后的真实数据（20 个 id）

```
QX5dyu      + A B C D E
6Gs9v1      + A B C
8sg3iA
Vrfpg7      + A B C
12MByl      + A B C D
```

| 检查 | 结果 |
| --- | --- |
| 无纯数字 id | ✓ |
| 全部形如 `随机串` 或 `随机串-后缀` | ✓ |
| plan 内无重复 | ✓ 20/20 |
| 与归档无重叠 | ✓ |
| 每组子 id 依次匹配父 | ✓ ×4 组 |
| `delivered` 无悬空 | ✓ |
| 归档保留历史 id（`2/3/4`） | ✓ |

用真实读取路径复核：`readPlan` → 5 条无 error；`actionable` → 12 条；
`applyCursor` → `inflight`（当前任务）。回填后恢复正常。

### 端到端复验（修复后）

```
父: CN8U1A
  子: CN8U1A-A / CN8U1A-B / CN8U1A-C
落盘 → readPlan 读回 → 主 id 不变、子 id 不变
再读一次（模拟刷新）→ 完全一致
无纯数字 id ✓
```

### 本轮改动

| 文件 | 改动 |
| --- | --- |
| `lib/host/decompose-batch.js` | 父 id 守卫接受随机串（1 处） |
| `.plan/plan.json` | 重写 2 条撞号记录（id + 子 id） |

CSS 产物无变化。备份：`.plan/plan.json.pre-e`。

### 至此 id 链路全通

| 环节 | 状态 |
| --- | --- |
| 生成（`createTaskId`） | ✓ 随机 |
| 装配（`buildBatch` / `children.js`） | ✓ 本轮修复 |
| 迁移（`migrate`） | ✓ 已走统一入口 |
| 重排（`renumber`） | ✓ 有随机 id 则跳过 |
| 读时兜底（`store`） | ✓ 缺失才生成 |
| 展示（`50-item.js`） | ✓ 用 `item.id` / `child.id` |
| 下发（`dispatch`） | ✓ `delivered` 用真实 id |
