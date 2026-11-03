# 序号派生：唯一来源与跨端共享（id=fzTvER-A）

## 一、需求

新增派生序号的纯函数：输入「某一状态下已按 order 排好序的条目数组」，
返回每条的 1 起序号；不写回、不改 `order`；order 缺失或相等时保持稳定次序。
作为唯一序号来源，供宿主接口与客户端渲染共用。

## 二、为什么需要

`order` 是**排序依据**，不是**展示序号**。真实数据里它是带间隙的：

```
order:  1000, 2000, 3000, 4000, 5000
界面要:   1,    2,    3,    4,    5
```

为什么步长 1000 而不是 1 —— 见 `order.js` 的注释：留间隙后**插入不必重编号全表**。

此前这个换算在各页签里各写一遍，于是同一份数据在不同地方可能显示不同数字。

## 三、实现

### 宿主：`lib/host/order.js`（权威实现）

```js
function sequenceOf(items) {
  const out = []
  let seq = 0
  for (const item of Array.isArray(items) ? items : []) {
    if (item === null || typeof item !== 'object') continue
    seq += 1
    out.push({ id: item.id, seq })
  }
  return out
}

function sequenceMapOf(items) {   // 便捷形态：id → 序号
  const map = new Map()
  for (const { id, seq } of sequenceOf(items)) map.set(id, seq)
  return map
}
```

### 三条约定（对应任务原文）

| 要求 | 实现 |
| --- | --- |
| 不写回、不改 order | 只读入参，返回**新数组**；`{id, seq}` 不含 order |
| order 缺失/相等时稳定 | **不二次排序**，直接用入参顺序 → 天然稳定 |
| 1 起序号 | `seq` 从 0 开始累加后自增，首条为 1 |

**关键设计选择：不排序。**
调用方应先 `sortByOrder()` 得到确定顺序，`sequenceOf` 再排一次只会
覆盖调用方的决定。不排序也就自动满足了「相等时稳定」。

## 四、跨端共享：为什么不能字面实现

客户端片段（`src/client/*.js`）只能 `require('react')`，
**无法 import 宿主的 `order.js`** —— 它们被 `build.mjs` 拼进同一个 factory 作用域。

所以「宿主与客户端共用同一个函数」在字面上做不到。取舍如下：

| 角色 | 文件 | 说明 |
| --- | --- | --- |
| **权威实现** | `lib/host/order.js` | 任务要求的位置 |
| **镜像** | `src/client/15-seq.js` | 函数体**逐字相同** |
| **保险** | `scripts/check-seq-parity.mjs` | 一致性测试，进 `npm test` |

这不是「各写一套靠注释提醒」—— 注释不会失败，**测试会**。

### 一致性测试查两个层面

1. **源码层**：剥掉注释与空白后，两边函数体必须逐字相同
2. **行为层**：8 组输入（普通/无 order/相同 order/混 null/空/非数组/子任务/1000 步长）
   两边输出必须完全一致

任一边改了另一边没跟上，`npm test` 直接红。

## 五、验证

| 组 | 条数 | 覆盖 |
| --- | --- | --- |
| `order.js` 单测 | 29 | 基本/不写回/稳定次序/边界/Map/配合排序/真实数据/子任务 |
| 一致性测试 | 22 | 源码一致 + 行为一致 + 不修改入参 |

### 几个关键断言

| 断言 | 结果 |
| --- | --- |
| `order: 1000,2000,3000` → `seq: 1,2,3` | ✅ |
| 入参未被修改（JSON 前后相同）| ✅ |
| 返回项只有 `id`/`seq` 两个键 | ✅ |
| 无 order 时保持入参顺序 | ✅ |
| 相同 order 时保持入参顺序 | ✅ |
| 入参反转 → 序号跟着反转 | ✅ |
| 混入 `null`/`undefined` 序号仍连续 | ✅ |
| `sortByOrder` + `sequenceOf` 组合正确 | ✅ |
| 相同 order 两次排序结果确定（与入参顺序无关）| ✅ |

## 六、产物验证

新片段 `src/client/15-seq.js` 被 `build.mjs` 按文件名顺序拼接：

```
00-loader-head  行    18
15-seq          行   691      ← 新增
30-runtime      行   800
60-tab          行  2468
```

作用域验证：`sequenceOf` 位于 factory 花括号区间 `657..211490` 之内，
与 `60-tab` 同作用域 —— **可以直接调用，无需 `require`**。

产物从 8 片段 → **9 片段**（299004 字节）。

## 七、用法

```js
// 典型：先排序，再编号
const sorted = sortByOrder(items)
const seq = sequenceOf(sorted)          // [{id, seq}, …]

// 渲染时按 id 取序号更顺手
const seqMap = sequenceMapOf(sorted)
const n = seqMap.get(item.id)
```

**顺序就是展示顺序** —— `sequenceOf` 不看 `order` 的具体数值。

## 八、部署

- `lib/host/order.js` 改动：**重启 `dsh web`**
- `src/client/15-seq.js` 新增：需 `node build.mjs` 后 **`Ctrl+F5`**

## 九、留给后续

本单只交付「函数 + 一致性保障」。**客户端三个页签尚未接入**：

- 待执行 / 待审核：过滤后用 `byTaskOrder` 排序，再调 `sequenceOf`
- 已审核：用 `byReviewedDesc`（审核时间倒序）排序，再调 `sequenceOf`

接入时要注意：客户端的分组不是简单按 `execute`/`review` 判断，
还包含**拆解批次整体归组**（`batchOf`）—— 父的 children 全审完才算已审核。
这套逻辑留在客户端，`sequenceOf` 只负责「已排好的数组 → 序号」。
