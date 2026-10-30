/**
 * `.plan/dispatch.json` —— 投递游标的读写（id=342 / id=343）。
 *
 * 为什么单独成文件而不是塞进 settings.json：设置是「用户偏好」，游标是「运行时痕迹」，
 * 两者生命周期完全不同 —— 用户重置设置不该把「投到哪了」一起清掉，反过来，
 * 游标写坏了也不该让设置读不出来。放同目录、同一个 .plan 里，清理项目时一起走。
 *
 * 落盘形态 `{ ok: true, version: 1, cursor: {...} }`（与 notes.json 同款包装）。
 * 任何读取失败、JSON 坏掉、形状不对，一律当成「没有游标」—— 丢了最坏是重投一次，
 * `start` 对已有 `startedAt` 的条目是幂等的，绝不能因为一个游标文件挡住房间派发。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dispatchPathOf } from './paths.js'
import { EMPTY, normalized } from './cursor.js'

const DISPATCH_VERSION = 1

/** 递增序号：同一毫秒内并发写时临时文件名也不会撞（与 notes.js 同款）。 */
let seq = 0

/** 读游标。文件不存在 / 坏掉 / 形状不对都返回 EMPTY，不抛。 */
async function readCursor(cwd) {
  const path = dispatchPathOf(cwd)
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return { path, cursor: { ...EMPTY } }
  }
  try {
    const parsed = JSON.parse(raw)
    // 两种都认：包着的 `{cursor}` 与直接写成一个对象的裸形态（手工改过也读得出来）。
    const body = parsed !== null && typeof parsed === 'object' && parsed.cursor !== undefined ? parsed.cursor : parsed
    return { path, cursor: normalized(body) }
  } catch {
    return { path, cursor: { ...EMPTY } }
  }
}

/** 写游标（原子写：tmp + rename，中途失败不会留下半个文件）。 */
async function writeCursor(cwd, rawCursor) {
  const path = dispatchPathOf(cwd)
  const cursor = normalized(rawCursor)
  await mkdir(dirname(path), { recursive: true })
  const body = `${JSON.stringify({ ok: true, version: DISPATCH_VERSION, cursor }, null, 2)}\n`
  seq += 1
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${seq}`
  await writeFile(tmp, body, 'utf8')
  await rename(tmp, path)
  return { path, cursor }
}

/** 清空游标（一轮执行结束 / 用户点暂停时用）。已经空着就不写盘。 */
async function clearCursor(cwd) {
  const { path, cursor } = await readCursor(cwd)
  if (cursor.groupId === null && cursor.delivered.length === 0) return { path, cursor, wrote: false }
  const written = await writeCursor(cwd, { ...EMPTY })
  return { path, cursor: written.cursor, wrote: true }
}

export { DISPATCH_VERSION, clearCursor, readCursor, writeCursor }
