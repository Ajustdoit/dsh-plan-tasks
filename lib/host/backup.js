/**
 * 裁剪已审核之前，把完整 plan.json 另存一份（id=257）。
 *
 * 为什么单独成文件而不是塞进 store.js：它只做「复制一个文件」这一件事，
 * 不需要归一化、不需要排序、也不需要自己加锁（调用方 `mutatePlan` 已经持有锁）。
 * 一旦混进 store.js，很容易被当成又一个「读-改-写」入口，以后有人直接调它就绕过了队列。
 *
 * 三个刻意的选择：
 * 1. **先写临时文件再 rename**：备份本身也可能写一半就断电/被 kill，
 *    留一个半截的 planBack.json 比没有备份更糟（用户会以为有救）。
 * 2. **覆盖而不是累计**：只留最近一份。累计版本会让 `.plan/` 变成没人清理的垃圾桶，
 *    而真正的用途是「刚才那次裁剪砍错了，拉回来」，只需要最近一次。
 * 3. **失败就抛，由调用方中止裁剪**：备份写不下去（磁盘满 / 权限 / 目录只读）时，
 *    继续裁剪等于「用户开了保险却没人上保」，必须在动手前停下来。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { BACKUP_FILE, NOTES_BACKUP_FILE } from './constants.js'
import { notesPathOf, planPathOf } from './paths.js'

let backupSeq = 0

/**
 * 把当前的两个归档来源（`.plan/plan.json` + `.plan/notes.json`）各复制一份。
 *
 * 为什么要带上 notes.json（id=269）：保留条数同时裁「还没归档的已审核条目」和
 * 「notes.json 里的归档」，只备份 plan.json 就只保住了前一半，而真正会被淘汰的
 * 大头在后一半。两个文件独立复制，任一失败都抛 —— 备份不完整等于没有备份。
 *
 * @param {string} cwd 项目根目录
 * @returns {Promise<{path: string, bytes: number, notesPath: string|null, notesBytes: number}>}
 * @throws 读不到源文件、或写不进备份时抛出（`code` 为 `backup-failed`）
 */
async function backupPlan(cwd) {
  const planFile = await copyToBackup(planPathOf(cwd), BACKUP_FILE, 'plan.json')
  // notes.json 还可能不存在（从没审核通过过）：这不是错误，只是没有归档可备份。
  const notesFile = await copyToBackup(notesPathOf(cwd), NOTES_BACKUP_FILE, 'notes.json', { optional: true })
  return {
    path: planFile.path,
    bytes: planFile.bytes,
    notesPath: notesFile === null ? null : notesFile.path,
    notesBytes: notesFile === null ? 0 : notesFile.bytes,
  }
}

async function copyToBackup(from, fileName, label, options) {
  const optional = options !== undefined && options.optional === true
  const to = join(dirname(from), fileName)
  let raw
  try {
    raw = await readFile(from, 'utf8')
  } catch (error) {
    if (optional && error !== null && typeof error === 'object' && error.code === 'ENOENT') return null
    const wrapped = new Error(`裁剪前的备份失败：读不到 ${from}`)
    wrapped.code = 'backup-failed'
    wrapped.cause = error
    throw wrapped
  }
  // 空文件不算「有东西可备份」：正常项目不会出现，出现了也说明源头就有问题，
  // 这时候生成一份空的备份只会掩盖问题。
  if (raw.trim() === '') {
    if (optional) return null
    const error = new Error(`裁剪前的备份失败：${label} 是空的，没有可备份的内容`)
    error.code = 'backup-failed'
    throw error
  }
  backupSeq += 1
  const tmp = `${to}.tmp-${process.pid}-${Date.now()}-${backupSeq}`
  try {
    await mkdir(dirname(to), { recursive: true })
    await writeFile(tmp, raw, 'utf8')
    await rename(tmp, to)
  } catch (error) {
    const wrapped = new Error(`裁剪前的备份失败：写不进 ${to}`)
    wrapped.code = 'backup-failed'
    wrapped.cause = error
    throw wrapped
  }
  return { path: to, bytes: Buffer.byteLength(raw, 'utf8') }
}

export { backupPlan }
