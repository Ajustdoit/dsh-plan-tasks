/**
 * 已审核（note 数据）的裁剪，与 plan.json / notes.json 的分工（id=189，id=269 扩展）。
 *
 * 为什么要有这个：已审核组只增不减，一年后面板里躺着几千条历史，
 * 列表轮询、拖拽重编号、展开取详情都会被它拖慢，而且没人再回头看。
 *
 * id=269 起这里不再只回答「删哪几条」，而是回答「note 存哪、怎么按保留条数淘汰」：
 * - 已审核条目连同它的 note 从 `plan.json` 里**搬出去**，落到 `.plan/notes.json`；
 * - `plan.json` 只留还在流转的条目（草稿 / 待执行 / 待审核 / 未审核的已完成），
 *   于是「开始干活」时模型读到的队列里不再驮着几百条历史 note；
 * - 淘汰按**时间从旧到新**：留最新的 N 条，裁掉最旧的。
 *
 * 判新旧优先用**时间**（id=269 的要求），时间取不到才退回 `id`：
 * - `finishedAt` 是 id=269 新写的「审核通过 / 完成」时刻，最准确；
 * - 老数据没有它，退到 `startedAt`（开始执行的时刻，与完成先后基本同序）；
 * - 再没有就退到 `createdAt`；
 * - 三个都没有（手改文件）才退到 `id` —— `id` 由宿主 `maxId + 1 + index` 单调分配，
 *   与创建先后天然同序，是最后一道保险。
 * 不用 `order`：它会被手工拖拽改，也每次写盘重编号，跟时间无关。
 *
 * 只裁「已审核」（`execute === true && review === true && draft !== true`）：
 * 待执行是队列、待审核是等你打勾的，动它们是丢数据；草稿更不可能自动删。
 *
 * 返回新数组，不改入参 —— 调用方（api.js）后面还要拿原列表算别的。
 */
const isReviewed = (item) => item.execute === true && item.review === true && item.draft !== true

/** 解析出一条时间戳（毫秒）；解析不出来返回 null。 */
function parseTime(value) {
  if (typeof value !== 'string' || value === '') return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : null
}

/**
 * 一条 note 的「淘汰时间」：越小越旧、越先被裁。
 *
 * 导出是为了让 split 那一侧用**同一个**口径决定落盘顺序与淘汰顺序 ——
 * 两处各写一份「谁更旧」，一旦方向读反就会删掉最新的那条。
 */
function noteTimeOf(item) {
  const finished = parseTime(item?.finishedAt)
  if (finished !== null) return finished
  const started = parseTime(item?.startedAt)
  if (started !== null) return started
  const created = parseTime(item?.createdAt)
  if (created !== null) return created
  // 时间全缺：用 id 当假时间。id 一定有限，且与创建先后同序。
  return Number.isFinite(item?.id) ? Number(item.id) : Number.MAX_SAFE_INTEGER
}

/** 按淘汰时间从旧到新排序（稳定：同一时刻按 id 兜底，避免每次顺序抖动）。 */
function byNoteAge(a, b) {
  const ta = noteTimeOf(a)
  const tb = noteTimeOf(b)
  if (ta !== tb) return ta - tb
  const ia = Number.isFinite(a?.id) ? Number(a.id) : 0
  const ib = Number.isFinite(b?.id) ? Number(b.id) : 0
  return ia - ib
}

/**
 * 从一批 note 里挑出「该留下的」
 *
 * @param {Array} notes 全部已审核条目（已 normalize）
 * @param {number} limit noteLimit（需要保留的 note 条数），0 表示无限
 * @returns {{kept: Array, dropped: Array}} kept / dropped 都按淘汰时间升序
 */
function keepNewestNotes(notes, limit) {
  const list = Array.isArray(notes) ? notes : []
  const cap = Number.isInteger(limit) && limit > 0 ? limit : 0
  const sorted = list.slice().sort(byNoteAge)
  if (cap === 0 || sorted.length <= cap) return { kept: sorted, dropped: [] }
  // 保留最新的 cap 条 = 排序后掐掉最前面（最旧）的那么多条。
  return { kept: sorted.slice(sorted.length - cap), dropped: sorted.slice(0, sorted.length - cap) }
}

/**
 * @param {Array} items 全量条目（已 normalize）
 * @param {number} limit noteLimit（需要保留的 note 条数），0 表示无限
 * @returns {{items: Array, removed: number[], removedCount: number}}
 */
function trimReviewed(items, limit) {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : 0
  if (cap === 0) return { items, removed: [], removedCount: 0 }
  const reviewed = items.filter(isReviewed)
  if (reviewed.length <= cap) return { items, removed: [], removedCount: 0 }
  const { dropped } = keepNewestNotes(reviewed, cap)
  const drop = new Set(dropped.map((item) => item.id))
  return {
    items: items.filter((item) => !drop.has(item.id)),
    removed: [...drop],
    removedCount: drop.size,
  }
}

export { trimReviewed, isReviewed, keepNewestNotes, noteTimeOf, byNoteAge }
