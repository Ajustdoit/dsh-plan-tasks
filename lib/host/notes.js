/**
 * `.plan/notes.json` —— 已审核条目（含 note）的独立存储（id=269）。
 *
 * 为什么要把它们搬出 `plan.json`：加进 note 之后 plan.json 已经到几百 KB，
 * 而「开始干活」时技能只让模型读下一条（`q.mjs`），面板却仍在轮询整份文件。
 * 那些已审核的条目基本不会再变，却带着整段执行结果躺在同一个数组里 ——
 * 既拖慢轮询，也让「已审核上千条」的项目每个 5 秒都在搬运几 MB。
 *
 * 分工固定如下：
 * - `plan.json`：还在流转的条目（草稿 / 待执行 / 待审核 / 已审核但尚未归档）；
 * - `notes.json`：已审核条目归档，面板的「已审核」组从这里读（懒加载）。
 *
 * 落盘形态是 `{ ok: true, version: 1, notes: [...] }` 而不是裸数组：
 * 以后要加字段（比如分页游标）不必再猜「数组还是包装」。读取时两种都认，
 * 老文件 / 手写文件不会被当成损坏。
 *
 * 与 store.js 的分工：这里只管「这一个文件怎么读写」，不碰 plan.json、不排序归一
 * （条目在搬进来之前已经被 store 的 normalizeItem 洗过一遍）。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { notesPathOf } from './paths.js'

const NOTES_VERSION = 1

/** 把磁盘上的任意形状读成数组：裸数组 / `{notes:[…]}` / `{items:[…]}` / 单条对象。 */
function toNotesList(parsed) {
  if (Array.isArray(parsed)) return parsed
  if (parsed !== null && typeof parsed === 'object') {
    if (Array.isArray(parsed.notes)) return parsed.notes
    if (Array.isArray(parsed.items)) return parsed.items
    if (typeof parsed.plan === 'string' || Number.isInteger(parsed.id)) return [parsed]
  }
  return []
}

let seq = 0

/**
 * 读 notes.json。
 *
 * 三种退化分开报，和 `readPlanStrict` 同一个口径：
 * - `missing`：还没归档过（从没审核通过过），当成空列表继续；
 * - `unreadable`：文件在但读不出来；
 * - `broken`：读出来了但不是合法 JSON。
 * 写路径必须能分清「真的是空的」和「读不懂」，否则一次坏文件就把归档覆盖成空。
 */
async function readNotesFile(cwd) {
  const path = notesPathOf(cwd)
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') {
      return { path, status: 'missing', notes: [], raw: '' }
    }
    return { path, status: 'unreadable', notes: [], raw: '', error }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { path, status: 'broken', notes: [], raw, error }
  }
  return { path, status: 'ok', notes: toNotesList(parsed), raw }
}

/**
 * 宽松读：给 UI / 幂等判断用。读不懂就当空，不抛错 —— 归档读不出来时
 * 「已审核」组显示空，比整个面板 500 好；真要写盘时会走严格读并拒绝覆盖。
 */
async function readNotes(cwd) {
  const current = await readNotesFile(cwd)
  return { path: current.path, exists: current.status !== 'missing', broken: current.status === 'broken', notes: current.notes }
}

/**
 * 原子写 notes.json（tmp → rename，与 writePlan / writeSettings 同一套路）。
 *
 * 不做归一、不排序：调用方决定顺序（见 trim.js 的 byNoteAge —— 淘汰要按时间，
 * 展示要按「最近的在前」，这两个顺序不同，不能在这里擅自定一个）。
 */
async function writeNotes(cwd, notes) {
  const path = notesPathOf(cwd)
  const list = Array.isArray(notes) ? notes : []
  await mkdir(dirname(path), { recursive: true })
  const body = `${JSON.stringify({ ok: true, version: NOTES_VERSION, notes: list }, null, 2)}\n`
  seq += 1
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${seq}`
  await writeFile(tmp, body, 'utf8')
  await rename(tmp, path)
  return { path, notes: list }
}

/** 按 id 建索引，合并时用于判断「这条归档里有没有」。 */
function indexById(notes) {
  const map = new Map()
  for (const note of Array.isArray(notes) ? notes : []) {
    if (note !== null && typeof note === 'object' && Number.isFinite(note.id)) map.set(Number(note.id), note)
  }
  return map
}

/**
 * 把新归档的条目并进已有归档：同 id 以新的为准（再次审核通过时 note 会更新），
 * 其余原样保留。返回合并后的完整数组，不改入参。
 */
function mergeNotes(existing, incoming) {
  const map = indexById(existing)
  for (const note of Array.isArray(incoming) ? incoming : []) {
    if (note !== null && typeof note === 'object' && Number.isFinite(note.id)) map.set(Number(note.id), note)
  }
  return [...map.values()]
}

export { NOTES_VERSION, readNotes, readNotesFile, writeNotes, mergeNotes, indexById, toNotesList }
