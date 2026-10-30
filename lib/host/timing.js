/**
 * 状态与时间戳判定（id=348）。
 *
 * 这一层只做一件事：把「一条计划当前处于什么状态、该不该显示执行时间」变成**纯函数**，
 * 输入只有任务字段，不读时钟、不读磁盘、不看模型。
 *
 * 为什么收口：这些判定原来散在 `30-runtime.js` 的 `statusOf`、`50-item.js` 的几处 JSX 里，
 * 以及宿主侧的字段补齐里。散着的后果是「同一句话在两处算出不同答案」——
 * 典型症状就是「待审核列表里有的条目有执行时间、有的没有」：
 * 展示侧用的是 `time > 0`，而历史数据的 `time` 有的缺字段、有的是 0、有的是 null。
 *
 * 宿主侧负责**把字段补齐成同一种形状**（`normalizeTiming`），
 * 客户端只负责**按这种形状判定展示**（`timingOf` / `statusOf`）。两边用同一份规则表。
 */

/** 一条任务的耗时字段：一律归一成非负整数毫秒，缺失 / 非法 / 负数都当 0。 */
function normalizeTime(ms) {
  const n = Number(ms)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

/**
 * 时间戳归一（宿主侧用）：把一条任务的 `time` / `startedAt` / `finishedAt` 补成统一形状。
 *
 * 规则：
 * - `time` 缺省或非法 → 0（不是 NaN，也不是 null）；
 * - 已完成但没有 `finishedAt` → 用 `createdAt` 兜底（否则「已审核」排序会缺键）；
 * - 未完成却带着 `finishedAt` → 置空（那是上一次执行遗留的，会误导排序与展示）；
 * - `startedAt` 非法 → 置空（不能拿一个解析不了的时间当「正在跑」的证据）。
 *
 * 纯函数：同样的输入永远同样输出。
 */
function normalizeTiming(item) {
  if (item === null || typeof item !== 'object') return item
  const time = normalizeTime(item.time)
  const startedRaw = typeof item.startedAt === 'string' ? item.startedAt : ''
  const startedAt = Number.isFinite(Date.parse(startedRaw)) ? startedRaw : ''
  const done = item.execute === true
  const finishedRaw = typeof item.finishedAt === 'string' ? item.finishedAt : ''
  let finishedAt = Number.isFinite(Date.parse(finishedRaw)) ? finishedRaw : ''
  if (done !== true) finishedAt = ''
  else if (finishedAt === '') finishedAt = typeof item.createdAt === 'string' ? item.createdAt : ''
  if (time === item.time && startedAt === (item.startedAt ?? '') && finishedAt === (item.finishedAt ?? '')) return item
  return { ...item, time, startedAt, finishedAt }
}

/**
 * 展示口径（客户端用）：这条任务该不该显示执行时间 / 耗时。
 *
 * 三种情况刻意区分开：
 * - `hasTime`：真的量到过耗时（> 0）。**只有它为真才显示「耗时 xx」**；
 * - `hasStart`：有过开始时间（可以显示「开始于 …」，即使耗时还没测出来）；
 * - `pending`：已完成但没耗时（老数据 / 中途被打断后直接标完成）—— 显式标记出来，
 *   界面可以选择不显示，而不是显示一个会误导人的 `0秒`。
 */
function timingOf(item) {
  const time = normalizeTime(item?.time)
  const startedRaw = typeof item?.startedAt === 'string' ? item.startedAt : ''
  const startedAt = Number.isFinite(Date.parse(startedRaw)) ? startedRaw : ''
  return {
    time,
    startedAt,
    hasTime: time > 0,
    hasStart: startedAt !== '',
    // 已完成、但没有量到耗时：历史数据里最常见的那种「有的有、有的没有」。
    pending: item?.execute === true && time === 0,
  }
}

/**
 * 状态判定（客户端用，id=274 的父级聚合也在这里）。
 *
 * 与 `30-runtime.js` 里那份是同一套规则，抽出来是为了可单测、可被宿主复用。
 * 返回 `{ key, label }`，key 是稳定的机器值，label 只给人看。
 */
function statusOf(item, impliedRunning = false) {
  const kids = Array.isArray(item?.children) ? item.children : []
  if (kids.length > 0) {
    if (item?.draft === true) return { key: 'draft', label: '草稿' }
    // 整批做完、但还有子任务没审 → 待审核（不能显示成待执行）。
    if (item?.review !== true
      && kids.every((kid) => kid?.execute === true)
      && !kids.every((kid) => kid?.review === true)) {
      return { key: 'unreviewed', label: '待审核' }
    }
    const states = kids.map((child) => statusOf(child))
    if (states.some((s) => s.key === 'running')) return { key: 'running', label: '执行中' }
    if (states.every((s) => s.key === 'reviewed')) return { key: 'reviewed', label: '已审核' }
    if (states.every((s) => s.key === 'reviewed' || s.key === 'unreviewed')) return { key: 'unreviewed', label: '待审核' }
    if (states.every((s) => s.key === 'failed')) return { key: 'failed', label: '失败' }
    if (states.some((s) => s.key === 'failed')) return { key: 'failed', label: '部分失败' }
    if (states.every((s) => s.key === 'interrupted')) return { key: 'interrupted', label: '已中断' }
    if (impliedRunning === true) return { key: 'running', label: '执行中' }
    return { key: 'todo', label: '待执行' }
  }
  if (item?.draft === true) return { key: 'draft', label: '草稿' }
  if (item?.execute === true) {
    return item?.review === true ? { key: 'reviewed', label: '已审核' } : { key: 'unreviewed', label: '待审核' }
  }
  // 「已中断」必须排在 running 之前：中断后 startedAt 是故意保留的，不能当成在跑。
  if (item?.interrupted === true) return { key: 'interrupted', label: '已中断' }
  if (item?.failed === true) return { key: 'failed', label: '失败' }
  if (impliedRunning === true) return { key: 'running', label: '执行中' }
  // id=348：有 startedAt 且没完成 = 正在跑（哪怕耗时还没测出来）。
  // 以前这里只看 time > 0：id=343 之后派发只写 startedAt，刚开始的那条会被判成待执行。
  if (typeof item?.startedAt === 'string' && Number.isFinite(Date.parse(item.startedAt))) {
    return { key: 'running', label: '执行中' }
  }
  // 历史数据里也有「只有 time、没有 startedAt」的形态（老版本开工只写 time）。
  if (normalizeTime(item?.time) > 0) return { key: 'running', label: '执行中' }
  return { key: 'todo', label: '待执行' }
}

export { normalizeTime, normalizeTiming, statusOf, timingOf }
