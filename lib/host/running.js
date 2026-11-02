/**
 * 「执行中」的权威判定（id=89-C）。
 *
 * 问题：`startedAt` 只说明「这条开工过」，它会被**故意保留**下来
 * （id=233：中断后保留是为了「继续 = 续做而不是重跑」）。于是任何一条
 * 曾经开工、后来没走完的条目都会永远显示「执行中」——
 * 用户看到的就是「明明没在跑，却一直转圈」。
 *
 * 现在的判据：**执行中 = 有 startedAt 且这一轮真的被派发过且还没结算**。
 * 派发记录来自 `.plan/dispatch.json` 的 `delivered[]`（id=89-B 起删除时会同步清理）。
 *
 * 为什么把这种条目判成「待执行」而不是「已中断」：
 *   · 「已中断」有明确来源 —— `interrupted` 字段由回填链路写入，那是模型/会话
 *     真的断在半路；这里只是「派发记录里查不到」，不具备那个语义；
 *   · 题目要求「查不到对应 ID 时，状态回落到待执行」；
 *   · 判成待执行之后它会重新进入队列，可以再跑一次 —— 这正是期望行为。
 *
 * 这个模块**不写盘**。它只在读投影上把 `startedAt` 抹掉，
 * 让下游（客户端 statusOf、删除闸门）看到「没在跑」。
 * 真正的落盘清理是另一回事（`orphan.js` 的回收、用户主动删除）。
 */

/** 一个 id 是否在派发记录里（字符串/数字等价，与 cursor.js 的 isDelivered 同口径）。 */
function wasDispatched(delivered, id) {
  const list = Array.isArray(delivered) ? delivered : []
  const key = String(id ?? '')
  if (key === '') return false
  return list.some((x) => String(x) === key)
}

/**
 * 给一批条目做「执行中」校对，返回新数组（不改原对象）。
 *
 * 判据：
 *   · 有 `startedAt`（才可能是执行中）；
 *   · 且（`delivered` 里没有它）= 派发记录查不到 → 抹掉 startedAt，回落待执行。
 *
 * 注意：`execute === true`（已产出）与 `interrupted === true`（已中断）的条目
 * **不参与**这个校对 —— 它们本来就不是「执行中」，抹不抹 startedAt 都不影响状态，
 * 但保留原字段对「续做」有意义，不动它们。
 *
 * @param items 条目数组（可含 children）
 * @param delivered 派发记录里的 id 数组
 * @returns {{ items: any[], stale: any[] }} stale 是被判定为「派发记录里查不到」的那些 id
 */
function reconcileRunning(items, delivered) {
  const list = Array.isArray(items) ? items : []
  const stale = []

  const fixOne = (item) => {
    if (item === null || typeof item !== 'object') return item
    const startedAt = typeof item.startedAt === 'string' ? item.startedAt : ''
    if (startedAt === '') return item
    // 已产出 / 已中断的条目不参与：它们本就不是「执行中」。
    if (item.execute === true || item.interrupted === true) return item
    if (wasDispatched(delivered, item.id)) return item
    // 派发记录里查不到 → 抹掉 startedAt，让下游判成待执行。
    const next = { ...item }
    delete next.startedAt
    if (item.id !== undefined && item.id !== null) stale.push(item.id)
    return next
  }

  const out = list.map((item) => {
    if (item === null || typeof item !== 'object') return item
    // 父节点（拆解批次）自己的 startedAt 没有意义 —— 它的状态由 children 聚合。
    // 所以父只做「把 children 逐个修一遍」，不动自己。
    if (!Array.isArray(item.children) || item.children.length === 0) return fixOne(item)
    return { ...item, children: item.children.map(fixOne) }
  })
  return { items: out, stale }
}

export { reconcileRunning, wasDispatched }
