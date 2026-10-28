/**
 * 「已审核」条目的先进先出裁剪（id=189）。
 *
 * 为什么要有这个：已审核组只增不减，一年后面板里躺着几千条历史，
 * 列表轮询、拖拽重编号、展开取详情都会被它拖慢，而且没人再回头看。
 *
 * 判新旧用 **`id` 最小 = 最旧**。三个候选里只有这个可靠：
 * - `order` 会被手工拖拽改，也每次写盘重编号，跟时间无关；
 * - `createdAt` 实测与 id 序一致，但它是字符串、可被手改、旧数据可能缺失或同毫秒；
 * - `id` 由宿主 `maxId + 1 + index` 单调分配，与创建先后天然同序。
 *
 * 只裁「已审核」（`execute === true && review === true && draft !== true`）：
 * 待执行是队列、待审核是等你打勾的，动它们是丢数据；草稿更不可能自动删。
 *
 * 返回新数组，不改入参 —— 调用方（api.js）后面还要拿原列表算别的。
 */
const isReviewed = (item) => item.execute === true && item.review === true && item.draft !== true

/**
 * @param {Array} items 全量条目（已 normalize）
 * @param {number} limit reviewedLimit，0 表示无限
 * @returns {{items: Array, removed: number[], removedCount: number}}
 */
function trimReviewed(items, limit) {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : 0
  if (cap === 0) return { items, removed: [], removedCount: 0 }
  const reviewed = items.filter(isReviewed)
  if (reviewed.length <= cap) return { items, removed: [], removedCount: 0 }
  // 已审核按 id 升序（旧 → 新），掐掉前面超出的那几个，就是「先进先出」。
  const overflow = reviewed.slice().sort((a, b) => a.id - b.id).slice(0, reviewed.length - cap)
  const drop = new Set(overflow.map((item) => item.id))
  return {
    items: items.filter((item) => !drop.has(item.id)),
    removed: [...drop],
    removedCount: drop.size,
  }
}

export { trimReviewed, isReviewed }
