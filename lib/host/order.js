/**
 * 任务排序字段 `order` 的规则集中地（id=77-C）。
 *
 * ── 为什么要有这个模块 ────────────────────────────────────────────────────
 * `order` 这个字段早就存在，但规则散在 7 个文件里，且**互相矛盾**：
 *
 * | 位置 | 原来怎么算 |
 * | --- | --- |
 * | `item.js` / `api.js` ×3 | `maxOrder + 1`（步长 1） |
 * | `decompose-batch.js` | `ctx.order + index + 1` |
 * | `children.js` | 直接沿用组内第一条的 order |
 * | `queue-cli.js` | `maxOrder + 1` |
 * | `api.js` reorder | `order: index`（0,1,2…） |
 * | `store.js` writePlan | **每次写盘都重编号成 0,1,2…** |
 *
 * 最后那条是致命的：即使别处按步长 1000 分配，一次写盘就全被抹平。
 * 把规则收到一个模块里，改的时候只有一处。
 *
 * ── 为什么要步长 1000（而不是 +1）────────────────────────────────────────
 * 步长 1 时「两条之间没有空隙」，任何插入都必须**重编号后面所有条目**，
 * 于是 `store.js` 才会去写 `order: index` —— 而重编号会让并发写盘互相踩踏，
 * 也会让「拖拽只改两条」变成「改全表」。
 *
 * 留 1000 的间隙后，插入只需给一个落在间隙里的值，不必动别人。
 * 间隙用尽（相邻两条差 1）时的处理见 `orderBetween`。
 *
 * ── 硬规则 ───────────────────────────────────────────────────────────────
 * 1. `order` 永远是**有限数字**，缺失/非法时读作 0（不许 undefined 参与比较）；
 * 2. 排序**只由 order 决定**，order 相同时才用 id 的**字符串**比较兜底
 *    （不能用 `a.id - b.id` —— 随机 id 相减是 NaN，排序结果未定义）；
 * 3. 新建任务取 `maxOrder + ORDER_STEP`，空列表从 `ORDER_STEP` 开始。
 */

/** 相邻两条之间的默认间隙。 */
const ORDER_STEP = 1000

/** 把任意值读成合法的 order（非法 → 0）。 */
function orderOf(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * 当前列表里最大的 order；空列表返回 0。
 *
 * 只算顶层：子任务不参与拖拽排序（见 store.js 的注释），它们的 order
 * 只在父内部有意义，不该影响全局分配。
 */
function maxOrderOf(items) {
  let max = 0
  for (const item of Array.isArray(items) ? items : []) {
    if (item === null || typeof item !== 'object') continue
    const n = orderOf(item.order)
    if (n > max) max = n
  }
  return max
}

/**
 * 一条新任务该拿的 order：`maxOrder + ORDER_STEP`；空列表则 `ORDER_STEP`。
 *
 * 注意「空列表返回 ORDER_STEP 而不是 0」—— 让 order=0 成为"非法/缺省"的
 * 保留值，`orderOf` 把缺失读成 0 时就不会与真实条目混淆。
 */
function nextOrder(items) {
  const list = Array.isArray(items) ? items.filter((x) => x !== null && typeof x === 'object') : []
  if (list.length === 0) return ORDER_STEP
  return maxOrderOf(list) + ORDER_STEP
}

/**
 * 批量新建时第 index 条该拿的 order。
 *
 * `nextOrder(items) + index * ORDER_STEP`：同批条目之间也留间隙，
 * 这样以后在批内插入同样不用重编号。
 */
function nextOrderAt(items, index) {
  const i = Number.isInteger(index) && index >= 0 ? index : 0
  return nextOrder(items) + i * ORDER_STEP
}

/**
 * 把列表按「order 升序、id 字符串升序」重排。
 *
 * 返回新数组，不改入参。这是全项目**唯一**的排序口径 ——
 * 客户端渲染、宿主写盘、CLI 输出都用它，才谈得上「顺序只由 order 决定」。
 */
function sortByOrder(items) {
  return (Array.isArray(items) ? items : []).slice().sort(compareOrder)
}

/**
 * 比较器：先 order，再 id 的字符串比较。
 *
 * id 兜底用 `String(a.id) < String(b.id)` 而不是相减：
 * 77-B 之后 id 是 6 位随机串，`'aB3xK9' - 'Xy12Zz'` 是 NaN，
 * 而 NaN 参与的比较**不满足反对称性**，会让各浏览器的排序结果不一致。
 */
function compareOrder(a, b) {
  const oa = orderOf(a?.order)
  const ob = orderOf(b?.order)
  if (oa !== ob) return oa - ob
  const ia = String(a?.id ?? '')
  const ib = String(b?.id ?? '')
  if (ia === ib) return 0
  return ia < ib ? -1 : 1
}

/**
 * 拖拽重排后重新分配 order：按给定顺序每条相差 `ORDER_STEP`。
 *
 * 与旧实现（`order: index`）的区别：保留间隙。
 * 用 index 的话，两次拖拽之间只要有一次并发写入，后面的条目就会因为
 * 「order 撞车」而顺序抖动。
 */
function reindexOrders(items) {
  return (Array.isArray(items) ? items : []).map((item, index) => ({
    ...item,
    order: (index + 1) * ORDER_STEP,
  }))
}

export {
  ORDER_STEP,
  orderOf,
  maxOrderOf,
  nextOrder,
  nextOrderAt,
  sortByOrder,
  compareOrder,
  reindexOrders,
}
