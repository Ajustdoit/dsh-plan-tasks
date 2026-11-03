# 待执行列表的拖动重排（id=fzTvER-D）

## 一、结论：功能已存在，本单做的是验证

代码里**已有完整的拖拽重排**，且已满足题面绝大部分要求：

| 题面要求 | 现状 |
| --- | --- |
| 待执行列表可拖动重排 | ✅ `drag: true` |
| 已审核、待审核不加拖拽 | ✅ 两者 `drag: false` |
| 复用已有拖拽逻辑，不新增第二套 | ✅ 各事件只有一处 |
| 提交给宿主接口 | ✅ `call('reorder')` |
| 成功后刷新列表 | ✅ 乐观更新 + 通知 |
| 执行 `build.mjs` | ✅ `build: 无变化（9 个片段）` |

**本单没有改任何源码**（`git status` 显示的两个文件是上一单 fzTvER-C 改的）。

## 二、唯一的协议差异（已与用户确认保留）

题面写「提交 `[{id, order}]`」，实际提交的是 **`ids` 数组**。

已确认**保留 `ids` 协议**：
- 现有实现完整可用（拖拽 / 乐观更新 / 失败回读 / 落盘）
- 改成 `[{id, order}]` 需要同时改宿主协议，改动面大于收益
- 宿主侧 `reorder` 用 `ids` 的顺序算 rank，再 `reindexOrders` 落盘，
  语义上等价于 `[{id, order}]`，只是形状更紧凑

## 三、现有链路

```
拖动条目
  → onDragStart  记 dragId
  → onDragOver   记 dropId（高亮落点）
  → onDrop       moveTo(dragId, dropId)
                  → 算出待执行组的新顺序
                  → commitOrder(order)
                      → 拼三段的完整 id 列表
                      → setState 乐观更新（界面立刻跟手）
                      → call('reorder', { ids })
                          → 成功：提示「顺序已保存」
                          → 失败：报错 + sync() 回读
  → onDragEnd    清 dragId / dropId
```

### 为什么要拼三段

`moveTo` 只算出**待执行组**的顺序，但宿主只认整表顺序。
`commitOrder` 把三段拼起来：

```js
const ids = [
  ...order,                                                          // 待执行（新顺序）
  ...all.filter((it) => it.execute === true && it.review !== true),  // 待审核
  ...all.filter((it) => it.execute === true && it.review === true),  // 已审核
].map(...)
```

不拼的话，`reorder` 会把待审核 / 已审核的条目当成「rank 里没有」，
全部排到 `MAX_SAFE_INTEGER`，位置就乱了。

## 四、验证（26 条）

把 `commitOrder` / `moveTo` 两个函数**抠出来真实执行**（假 state、假 call）。

### 提交内容

输入：`A,B,C`（待执行）+ `X`（待审核）+ `Y`（已审核），把 C 拖到 A 前：

```
提交顺序: C → A → B → X → Y
```

| 断言 | 结果 |
| --- | --- |
| 待执行段变成 `C,A,B` | ✅ |
| 待审核段跟随 | ✅ |
| 已审核段在最后 | ✅ |
| **无重复 id** | ✅ |
| 覆盖全部 5 条 | ✅ |

### 刷新

| 断言 | 结果 |
| --- | --- |
| 界面立即变成新顺序 | ✅ `C,A,B` |
| 提示「顺序已保存」 | ✅ |

### 失败回滚

让 `reorder` 抛错：

```
调用序列: reorder → sync
错误: 网络断了
```

| 断言 | 结果 |
| --- | --- |
| 失败后调用 `sync` 回读 | ✅ |
| 错误已上报 | ✅ |
| **没有**提示「顺序已保存」 | ✅ |

### 只影响待执行组

| 断言 | 结果 |
| --- | --- |
| 待执行 `drag: true` | ✅ |
| 已审核 `drag: false` | ✅ |
| 待审核 `drag: false` | ✅ |
| 抓手渲染受 `dragEnabled` 控制 | ✅ |
| `onDragOver` 提前 return | ✅ |

### 没有第二套事件

```
onDragStart: 1, onDragEnd: 1, onDrop: 1
```

`50-item.js` 里也只有一处 `onDragStart` handler、一处 `draggable: true`。

### 边界

| 输入 | 结果 |
| --- | --- |
| `from` 为 null | 不提交 |
| `to` 为 null | 不提交 |
| 同一个目标 | 不提交 |
| 不存在的 id | 不提交 |

### 拆解批次

父任务（带 children）在待执行组时可以拖拽，**只提交顶层 id**，children 不参与排序。

## 五、一个测试判据的修正

「没有第二套拖拽事件」第一次报 FAIL，因为我把 `50-item.js` 里所有
`onDragStart` 出现都算上了：

```
192 行：const { ..., onDragStart, ... } = props     ← 解构声明
354 行：onDragStart: (e) => { ... }                 ← 真正的 handler
357 行：onDragStart()                                ← 函数内调用
```

只有 354 是 handler。改成匹配 `onDragStart:\s*\(` 才对。

> 数「有几处」时，要先想清楚「什么样才算一处」——
> 变量名、声明、调用看起来都长得一样。

## 六、留给后续（可选的改进）

1. **协议可以统一**：如果将来要支持「只提交变动的两条」（而不是整表），
   那时改成 `[{id, order}]` 才有实际收益 —— 现在整表提交更简单可靠。
2. **失败回滚是「重读」而非「撤销」**：`sync()` 会拉最新数据，
   如果这期间别人改过，用户会看到合并后的结果而不是自己拖之前的样子的。
   当前单用户场景下没有影响。
