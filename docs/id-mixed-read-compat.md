# 混合 id 的读取兼容性（id=12MByl-D）

> 目标：`.plan` 下的 dispatch / plan / notes，以及插件内的持久化逻辑，
> 在「纯数字 id 与随机 id 共存」时仍能正确解析、匹配、引用。

## 一、改动：一处真实缺陷

### `lib/host/notes.js` → `toNotesList()`

```js
// 改前
if (typeof parsed.plan === 'string' || Number.isInteger(parsed.id)) return [parsed]

// 改后
if (
  typeof parsed.plan === 'string'
  || (typeof parsed.id === 'string' && parsed.id !== '')
  || (Number.isInteger(parsed.id) && parsed.id > 0)
) return [parsed]
```

**问题**：原判断只认**数字** id。一个随机 id 的条目（`aB3xK9`）如果 `plan` 为空，
整个对象会被丢掉。

**为什么这是真问题**：`plan` 为空是**合法状态**——拆解产出的父节点就是
`plan: ''`（正文在 `sourcePrompt` 里）。实测差异：

| 输入 | 改前 | 改后 |
| --- | --- | --- |
| `{ id: 12 }` | 1 条 | 1 条 |
| `{ id: 'aB3xK9' }` | **0 条** ← 丢数据 | **1 条** |
| `{ id: '' }` | 0 条 | 0 条（仍正确丢弃） |
| `{ id: 0 }` | 0 条 | 0 条（仍正确丢弃） |

这是典型的「类型判断导致数据丢失」：同样的形状，数字 id 能读、随机 id 读不出。

`toNotesList` 用于解析**整个文件**（兼容裸数组 / `{notes:[]}` / `{items:[]}` /
单条对象四种历史形状），所以这条判断直接决定「文件里的单条对象能不能被认出来」。

## 二、逐条核查（未改动，确认安全）

### 1. `lib/host/ids.js` —— 两种形状都认

| 函数 | 数字 id | 随机 id |
| --- | --- | --- |
| `isTopId` | ✓ 正整数 | ✓ 6 位 `0-9A-Za-z` |
| `isChildId` | ✓ `12-A` | ✓ `aB3xK9-A` |
| `codeOf` | ✓ `"12"` | ✓ `"aB3xK9"` |
| `parentKeyOfChild` | ✓ `"12"` | ✓ `"aB3xK9"` |
| `parentIdOfChild` | ✓ 返回数字 `12` | **返回 `null`**（按设计只取数字） |
| `idKey` / `sameId` | ✓ `String()` 归一 | ✓ |

**`parentIdOfChild` 返回 null 是否丢数据？** 不丢。全项目只有 `renumber.js`
用它，且都是 `parentIdValue(...) ?? parentIdOfChild(...)` 兜底 ——
取不到数字就用 `parentKeyOfChild` 的字符串路径。

### 2. `lib/host/cursor.js` —— dispatch 游标

| 检查 | 结果 |
| --- | --- |
| `isGroupId` 接受 `12` / `'12'` / `'aB3xK9'` | ✓ 两种形状 |
| 非法 groupId | → `null`（正确拒绝） |
| `delivered` 含字符串 / 数字混合 | 全部保留 |
| `delivered` 含 null / 对象 | 被过滤 |
| `groupOpen` 找父 | `String(item.id) === String(groupId)`，跨类型匹配 |
| `delivered` 所有比较点 | 全部 `.map(String)` / `String(...)` |
| `forgetIds` 剔除 | 按 `Set<String>` 精确匹配，跨类型生效 |

`forgetIds` 的语义是**按传入的 id 精确剔除**。删除父时调用方
（`api.js:915-917`）会把父与它的 children 一起放进 `doomed`，
所以子任务的 `delivered` 记录也会被清掉 —— 实测 `12-A` 被正确剔除。

### 3. `lib/host/store.js` —— plan.json 归一

```js
const id = Number.isInteger(item.id) && item.id > 0
  ? item.id                        // 历史数字 id：原样保留
  : typeof item.id === 'string' && item.id !== ''
    ? item.id                      // 随机 id：原样保留
    : makeId()                     // 都没有：读时临时生成
```

三种情况都覆盖，且**保留原类型**（数字仍是数字），不会把 `12` 变成 `'12'`。

### 4. `lib/host/notes.js` —— 归档索引

`indexById` 用 `idKey(note.id)`（`String()` 归一）做 Map 键，
所以 `12` 与 `'12'` 被视为同一条 —— 实测 `mergeNotes` 覆盖行为正确。

### 5. `lib/host/renumber.js` —— 重编号

```js
if (list.some((item) => typeof item?.id === 'string' && !/^\d+$/.test(item.id))) {
  return { items: list, changes: [] }   // 含随机 id → 整体跳过
}
```

**混合数据零改动**（实测 `changes.length === 0`），纯数字数据仍可正常重编，
子 id 跟着父走（`1-A` → `10-A`）。

## 三、真实数据验证

`.plan/notes.json` 现有 15 条，**同时含历史数字 id 与随机 id**：

```
mBSaIn, wZIKdd, gR3lBM, k7xFdQ, Kp86HX, twRXzh, Rczii8, IlSb8Z, kjSFlr,
3, 2, 4, QX5dyu, 6Gs9v1, 8sg3iA
   ↑ 历史数字          ↑ 随机
```

| 检查 | 结果 |
| --- | --- |
| `readPlan` 无 error | ✓ 3 条 |
| `readNotes` 能读 | ✓ 15 条 |
| 归档 id 全部有效（无 undefined / 空） | ✓ |
| 含历史数字 id | ✓ |
| 含随机 id | ✓ |

混合场景在真实数据里已经存在，读路径全部正常。

## 四、验证（35 条断言）

| 组 | 条数 |
| --- | --- |
| `toNotesList` 修复（含 8 种输入） | 8 |
| `indexById` / `mergeNotes` 跨类型 | 2 |
| `cursor` groupId / delivered | 8 |
| `groupOpen` 跨类型找父 | 3 |
| `forgetIds` 剔除 | 4 |
| `renumber` 混合 / 纯数字 | 4 |
| 真实 `.plan` 三文件 | 6 |

## 五、一个小结

改前我一直以为「两种形状都认」这件事已经做完了 —— 确实 `isTopId`、`cursor`、
`store` 都做对了，但它们都是**显式调用** `isTopId` 的地方。

`toNotesList` 是例外：它**手写了一个内联判断**，没走 `isTopId`，
于是悄悄保留着「id 必须是数字」的旧假设。

> 同一类判断散落在多处时，**手写的那一处最容易漏**。
> 统一入口（`isTopId` / `idKey`）存在的意义就在这里。
