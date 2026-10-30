/**
 * 已审核条目的归档与淘汰（id=269）。
 *
 * 两件事必须放在一起，因为它们共用**同一个顺序**：
 * 1. 归档：条目一旦是「已审核」，就从 `plan.json` 搬进 `.plan/notes.json`；
 * 2. 淘汰：归档超过「需要保留的 note 条数」时，按时间从旧到新删掉最旧的，只留最新 N 条。
 *
 * 为什么必须同序：归档顺序决定「谁算最新」，淘汰顺序决定「谁先被删」。
 * 两处各写一份判断，一旦方向读反，就会稳定地删掉最新那条、留下最旧的。
 * 所以顺序只有一个来源 —— `trim.js` 的 `byNoteAge`，这里只消费它。
 *
 * 为什么淘汰要跟归档捆在一起：「保留条数」是**保持**的约束，不是点一下的动作。
 * 用户把档位从 1000 调到 100 要立刻生效，之后每审核通过一条也要继续成立。
 * 因此 settings / update / 读盘自愈三条路都走到这里，而不是各写一遍。
 *
 * 不碰锁：调用约定是**必须在 `mutatePlan` 的 mutator 内部调用**（那时 plan.json 的锁
 * 已在手上）。notes.json 自己不带锁，靠这个约定保证同一项目只有一个写者 ——
 * 否则会形成 store ↔ archive 的双向锁依赖。
 * 例外是 `removeFromArchive` / `pullFromArchive`：它们只动归档、不碰 plan.json，
 * 由 api 的写型 handler 在 mutatePlan 之外调用，同一个请求内保持「先 plan 后归档」的顺序。
 *
 * 落盘顺序统一是 **按淘汰时间从旧到新**（`byNoteAge` 升序）。为什么不按「最新的在前」：
 * 数组顺序就是淘汰顺序，两处同一个方向，读的人一眼能对上「越靠前越先被删」。
 * 面板要的「最近的在前」是展示层的事，在 api.read 里反转一次即可，存储层只留一种顺序。
 */
import { backupPlan } from './backup.js'
import { mergeNotes, readNotesFile, writeNotes } from './notes.js'
import { idKey } from './ids.js'
import { byNoteAge, isReviewed, keepNewestNotes } from './trim.js'

/**
 * 给刚变成「已审核」的条目补一个 `finishedAt`（id=269）。
 *
 * 淘汰要「按时间从旧到新」，就必须有一个能比的时刻。三个候选里：
 * - `startedAt` 是开工时刻，不是完成时刻，长任务会因此显得比实际更老；
 * - `createdAt` 是创建时刻，很久以前创建、今天才做完的条目会被当成「最旧」直接删掉；
 * - `finishedAt` 是完成（审核通过）那一刻，正是「保留最新的 note」想要的口径。
 * 老数据没有这个字段，`noteTimeOf` 里已经做了三级回退，所以这里只在缺的时候补，
 * 不覆盖已有的值（否则一条历史条目每次重新审核都会刷新成「最新」）。
 */
function stampFinished(item, now) {
  if (item === null || typeof item !== 'object') return item
  if (typeof item.finishedAt === 'string' && item.finishedAt !== '') return item
  if (item.execute !== true) return item
  return { ...item, finishedAt: now }
}

/** 归档读不懂时的统一错误（拒绝写，绝不拿空数组当基底覆盖归档）。 */
function archiveError(status) {
  const error = new Error(
    'notes.json 无法解析（' + (status === 'broken' ? '不是合法 JSON' : '读取失败') + '），已拒绝写入以免覆盖归档',
  )
  error.code = status === 'broken' ? 'notes-broken' : 'notes-unreadable'
  return error
}

/**
 * 淘汰归档里超出的部分，返回落盘后的归档（最近的在前）。
 *
 * 单独抽出来是给「只改设置、没有新条目要归档」那条路用的：档位调小要立刻见效，
 * 不能因为这一刻没有新的审核通过就什么都不做。
 *
 * @returns {Promise<{notes: Array, dropped: number[], backupNeeded: boolean, path: string}>}
 */
async function pruneArchive(cwd, noteLimit, options) {
  const opt = options !== null && typeof options === 'object' ? options : {}
  const existing = await readNotesFile(cwd)
  if (existing.status === 'missing') return { notes: [], dropped: [], backupNeeded: false, path: existing.path }
  if (existing.status !== 'ok') throw archiveError(existing.status)

  const limit = Number.isInteger(noteLimit) ? noteLimit : 0
  const { kept, dropped } = keepNewestNotes(existing.notes, limit)
  const droppedIds = dropped.map((note) => note.id)
  if (droppedIds.length === 0) {
    return { notes: existing.notes.slice().sort(byNoteAge), dropped: [], backupNeeded: false, path: existing.path }
  }
  // 备份必须在写归档之前：此刻 notes.json 仍是裁剪前的完整内容。
  if (opt.backup === true) await backupPlan(cwd)
  const notes = kept.slice().sort(byNoteAge)
  await writeNotes(cwd, notes)
  return { notes, dropped: droppedIds, backupNeeded: true, path: existing.path }
}

/**
 * 归档 + 淘汰。
 *
 * @param {string} cwd 项目根
 * @param {Array} items mutatePlan 交给 mutator 的当前列表（已 normalize）
 * @param {{ noteLimit?: number, now?: string, backup?: boolean, force?: boolean }} options
 *   `noteLimit` 为 0 表示不淘汰（仍归档）；`backup` 为 true 时，真删归档前先备份；
 *   `force` 为 true 时即使没有新条目要归档，也照样按档位淘汰一次（改设置时用）。
 * @returns {Promise<{
 *   items: Array,           // 归档后应写回 plan.json 的列表
 *   archived: number[],     // 这次从 plan.json 搬进归档的 id
 *   dropped: number[],      // 这次按保留条数淘汰掉的 id
 *   backupNeeded: boolean,  // 是否真的删了归档里的东西
 *   notes: Array|null,      // 落盘后的完整归档（最近的在前）；没动归档时为 null
 *   notesPath: string,
 * }>}
 */
async function archiveReviewed(cwd, items, options) {
  const opt = options !== null && typeof options === 'object' ? options : {}
  const noteLimit = Number.isInteger(opt.noteLimit) ? opt.noteLimit : 0
  const now = typeof opt.now === 'string' && opt.now !== '' ? opt.now : new Date().toISOString()
  const list = Array.isArray(items) ? items : []
  const force = opt.force === true

  const fresh = list.filter(isReviewed).map((item) => stampFinished(item, now))
  if (fresh.length === 0 && !force) {
    // 没有待归档的条目：不动 plan.json，也不重写归档（避免每次轮询都白写一次盘）。
    return { items: list, archived: [], dropped: [], backupNeeded: false, notes: null, notesPath: '' }
  }

  const existing = await readNotesFile(cwd)
  if (existing.status !== 'ok' && existing.status !== 'missing') throw archiveError(existing.status)

  const merged = mergeNotes(existing.notes, fresh)
  // 淘汰只在归档这一侧做：`noteLimit` 是「需要保留的 note 条数」，
  // 说的是归档里留多少条历史。刚审完的那条也会被这条统一规则判定，
  // 不需要第二套「plan.json 里的不裁」特例 —— 它此刻已经算归档里的一员了。
  const { kept, dropped } = keepNewestNotes(merged, noteLimit)
  const droppedIds = dropped.map((note) => note.id)
  const existingIds = new Set(existing.notes.map((note) => idKey(note.id)))
  // 只有「原本就在归档里、这次被删掉」才算破坏性操作。备份救不了还没展示过的新条目。
  const backupNeeded = droppedIds.some((id) => existingIds.has(idKey(id)))
  if (backupNeeded && opt.backup === true) await backupPlan(cwd)

  const notes = kept.slice().sort(byNoteAge)
  const keptIds = new Set(kept.map((note) => idKey(note.id)))
  const movedIds = new Set(fresh.map((item) => idKey(item.id)))
  // 搬过来的条目一律从 plan.json 摘掉：留下的（kept）搬进了归档，超限的（dropped）
  // 是「按保留条数淘汰」的对象 —— 两者都不该继续驮在 plan.json 里，否则淘汰等于没淘汰。
  // 只在归档确定写成功之后才走到这里（失败会抛），所以不存在「两处都没有」的中间态。
  const nextItems = list.filter((item) => !movedIds.has(idKey(item.id)))

  if (fresh.length > 0 || droppedIds.length > 0 || existing.status === 'ok') {
    await writeNotes(cwd, notes)
  }

  return {
    items: nextItems,
    archived: fresh.map((item) => item.id).filter((id) => keptIds.has(idKey(id))),
    dropped: droppedIds,
    backupNeeded,
    notes,
    notesPath: existing.path,
  }
}

/**
 * 从归档里删掉若干条（「已审核」组的删除 / 批量删除），返回实际删掉的 id。
 *
 * 归档里没有这条不算错：删除是幂等的，重试不会报「不存在」。
 */
async function removeFromArchive(cwd, ids) {
  const wanted = new Set((Array.isArray(ids) ? ids : []).map((id) => idKey(id)).filter((id) => id !== ''))
  if (wanted.size === 0) return { removed: [], notes: null, path: '' }
  const existing = await readNotesFile(cwd)
  if (existing.status === 'missing') return { removed: [], notes: null, path: existing.path }
  if (existing.status !== 'ok') throw archiveError(existing.status)
  const kept = existing.notes.filter((note) => !wanted.has(idKey(note.id)))
  const removed = existing.notes.filter((note) => wanted.has(idKey(note.id))).map((note) => note.id)
  if (removed.length === 0) return { removed: [], notes: existing.notes, path: existing.path }
  const notes = kept.slice().sort(byNoteAge)
  await writeNotes(cwd, notes)
  return { removed, notes, path: existing.path }
}

/**
 * 把一条归档条目取出来（用于「把已审核的退回待审核 / 待执行」）。
 *
 * 返回 `{ found, item, notes }`：`found` 为 true 时调用方要负责把它写回 plan.json，
 * 这边已经从归档里删掉了。找不到时 `found:false`，调用方继续按「计划不存在」报错。
 */
async function pullFromArchive(cwd, id) {
  const target = idKey(id)
  const existing = await readNotesFile(cwd)
  if (existing.status === 'missing') return { found: false, item: null, notes: null, path: existing.path }
  if (existing.status !== 'ok') throw archiveError(existing.status)
  const item = existing.notes.find((note) => idKey(note.id) === target)
  if (item === undefined) return { found: false, item: null, notes: existing.notes, path: existing.path }
  const notes = existing.notes.filter((note) => idKey(note.id) !== target).sort(byNoteAge)
  await writeNotes(cwd, notes)
  return { found: true, item, notes, path: existing.path }
}

/** 只读：拿归档（最近的在前）。读不懂时 notes 为空、broken 为 true，不抛错。 */
async function readArchived(cwd) {
  const existing = await readNotesFile(cwd)
  if (existing.status !== 'ok') {
    return { notes: [], broken: existing.status === 'broken' || existing.status === 'unreadable', path: existing.path }
  }
  return { notes: existing.notes.slice().sort(byNoteAge), broken: false, path: existing.path }
}

export { archiveReviewed, pruneArchive, removeFromArchive, pullFromArchive, readArchived, stampFinished }
