# 新写型接口 `applyOrders`：按 `[{id, order}]` 只改 order（id=fzTvER-E）

## 一、需求

新增写型 handler，接收 `[{id, order}]` 数组，按 id 定位条目、
**只重写 order 字段**后落盘，返回最新列表。id 与其余字段一律不动。

## 二、与 `reorder` 的区别

| | `reorder`（已有）| `applyOrders`（本单新增）|
| --- | --- | --- |
| 入参 | `ids[]`，顺序即 rank | `[{id, order}]`，**显式给定 order 值** |
| 做什么 | 按 rank 重排数组，再由宿主 `reindexOrders` 重编号 | **只改 order 字段**，数组顺序交给 `writePlan` |
| 谁决定 order 值 | 宿主（`(index+1)*ORDER_STEP`）| **调用方** |
| 幂等性 | 每次都会重编号 | 值没变就**不写盘** |

两个接口并存，用途不同：
- `reorder`：拖一下就整表重排（order 由宿主算）。
- `applyOrders`：调用方已经算好每条该是多少 order，只想让宿主原样落盘。

## 三、实现要点

```js
async applyOrders({ ctx, sessionId, cwd: cwdHint, orders }) {
  return direct(ctx, sessionId, cwdHint, async (cwd) => {
    // 1. 规整成 Map：id → order（用 idKey 统一文本键）
    const wanted = new Map()
    for (const row of Array.isArray(orders) ? orders : []) {
      if (row === null || typeof row !== 'object') continue
      if (row.id === null || row.id === undefined) continue
      const key = idKey(row.id)
      if (key === '') continue
      if (!Number.isFinite(row.order)) continue
      wanted.set(key, Number(row.order))
    }
    if (wanted.size === 0) {
      // 没有任何有效项：不写盘，原样返回现状
      const current = await readPlan(cwd)
      return { cwd, items: current.items, updated: 0 }
    }
    let updated = 0
    const written = await mutatePlan(cwd, ({ items: current }) => {
      let dirty = false
      const next = current.map((item) => {
        if (item === null || typeof item !== 'object') return item
        const key = idKey(item.id)
        if (!wanted.has(key)) return item
        const order = wanted.get(key)
        if (orderOf(item.order) === order) return item   // 值没变 → 同一引用
        dirty = true
        updated += 1
        return { ...item, order }                        // **只**铺 order
      })
      return dirty ? next : null                         // null → mutatePlan 跳过写盘
    })
    return { cwd, items: written.items, updated }
  })
}
```

### 四个刻意的选择

**1. 用 `{...item, order}` 而不是 `normalizeItem`**

`normalizeItem` 会补默认值、可能顺带改动别的字段。题面要求「其余字段一律不动」，
所以只铺一个键。

**2. 用 `idKey` 统一文本键**

数字 id（历史数据 `12`）与随机字符串 id（`aB3xK9`）都是合法 id。
直接拿 id 当 Map 键会让 `12` 与 `'12'` 对不上 —— `reorder` 里踩过这个坑（id=77-B）。

**3. 找不到的 id 静默跳过**

调用方可能拿了旧列表，其中有的条目已被删。为一条不存在的条目让整批失败不划算。

**4. 值没变就不动**

返回同一个引用，`dirty` 保持 false，`mutatePlan` 收到 `null` 后跳过写盘。
这让接口**幂等** —— 重复提交同样的 order 不会产生无意义的 IO。

## 四、写盘路径一致

| 检查 | 结果 |
| --- | --- |
| 用 `direct` 外壳 | ✅ 与 `update` / `reorder` 同一套 |
| 用 `mutatePlan` | ✅ 含锁、坏文件修复、原子写 |
| **没有**直接调 `writePlan` | ✅ |
| **没有**用 `normalizeItem` | ✅ |

路由器用 `Object.hasOwn(API, method)` 分发，**新方法无需注册**即生效。

## 五、验证（39 条，全部真实读写盘）

用本仓内临时目录建真实 `plan.json`，调真实 API，读回验证。

### 基本功能

```
提交: [{Ab3xK9:3000}, {Cd4yL2:1000}, {Ef5zM8:2000}]
落盘: Cd4yL2=1000, Ef5zM8=2000, Ab3xK9=3000
数组顺序: Cd4yL2 → Ef5zM8 → Ab3xK9   ← writePlan 按 order 自动排
```

| 断言 | 结果 |
| --- | --- |
| `updated = 3` | ✅ |
| 返回最新列表 | ✅ |
| 写盘后数组按 order 排 | ✅ |

### 只改 order（核心）

改前 `order=2000`，改后 `order=500`，**逐字段比对**：

```
其余字段差异: (无)
```

| 断言 | 结果 |
| --- | --- |
| id 未被改 | ✅ |
| name 未被改 | ✅ |
| note 未被改 | ✅ |
| taskType 未被改 | ✅ |
| plan 未被改 | ✅ |
| **其余字段全等** | ✅ |

另做一次「改前改后 diff」验证：**变化的字段只有 `order` 一个**。

### 边界

| 输入 | 结果 |
| --- | --- |
| 空数组 / null / undefined | `updated=0`，不写盘 ✅ |
| 非对象项 / 缺 id / order 非数字 / NaN | 全部忽略 ✅ |
| 不存在的 id | 跳过，其余照常更新 ✅ |
| 值没变 | `updated=0`，不重复写盘 ✅ |

### 数字 id

历史数据 id 是数字（`2`），传 `{id: 2}` 能正确匹配 ✅

### 序号由 order 派生

```
序号: Ab3xK9=1, Cd4yL2=2, Ef5zM8=3
```

条目里**没有 `seq` 字段** —— 序号不写进数据，只由 `order` 派生
（`order.js` 的 `sequenceOf`）。

## 六、一个容易误判的点

读盘后的条目多了 `draft` / `turnEndedAt` 等字段，看起来像「被改了」。

**那是 `store.js` 的 `normalizeNode` 在读盘时补的默认值**，
`writePlan` 每次都会走一遍 —— 与 `applyOrders` 无关，
`reorder` / `update` / `append` 全都一样。

验证方式：对比「读盘后」与「applyOrders 后」的字段差异，
结果是**只有 `order` 变了**，其余全部相同。

## 七、部署

**宿主改动，需重启 `dsh web`**。

## 八、遗留

- 客户端**尚未调用**这个接口（现有拖拽走 `reorder`）。
  它是为「客户端自己算 order」的场景准备的，接入留给需要它的单子。
- 不支持子任务：只处理顶层条目（与 `reorder` 同口径）。
  子任务的 order 在父内部有意义，不参与全局排序。
