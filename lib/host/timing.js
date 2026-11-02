/**
 * 时间戳归一（id=348）。
 *
 * 这一层只做一件事：把一条计划的「耗时 / 开始时间 / 完成时间」变成**纯函数**，
 * 输入只有任务字段，不读时钟、不读磁盘、不看模型。
 *
 * 为什么收口：这些判定原来散在各处的字段补齐里。散着的后果是「同一句话在两处算出
 * 不同答案」—— 典型症状就是「待审核列表里有的条目有执行时间、有的没有」：
 * 历史数据的 `time` 有的缺字段、有的是 0、有的是 null。
 *
 * 宿主侧负责**把字段补齐成同一种形状**（`normalizeTiming`）。
 *
 * id=405：这里原来还导出 `timingOf` / `statusOf`，注释说「客户端按这种形状判定展示」。
 * 实际上客户端从未 import 过它们 —— `30-runtime.js` 有一份自己的 `statusOf` 实现，
 * 那两个函数全项目零外部调用，且 `statusOf` 里还残着草稿档。已删除，只留字段归一。
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

// id=405：statusOf / timingOf 已删除 —— 它们从来没有外部调用方
// （面板侧 30-runtime.js 有自己的 statusOf 实现），且 statusOf 里还残着草稿档。
export { normalizeTime, normalizeTiming }
