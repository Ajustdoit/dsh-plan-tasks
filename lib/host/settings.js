/**
 * `.plan/settings.json` 读写。
 *
 * 这个文件早先只是几个会话留下的死配置（`autoAppend/defaultMode/defaultTaskType`，
 * 宿主一行代码都没读过）。从 id=187 起它成为**真正的设置存储**，目前只认一个字段：
 * `reviewedLimit` —— 已审核区块最多保留多少条，超出就按先进先出裁掉 plan.json 里的旧条目。
 *
 * 取值刻意做成**枚举**而不是任意数字：界面上的下拉就这五档，写 37 进来既没有对应控件，
 * 也会让「裁到哪」变成猜不出来的行为。非法值一律回退 0（无限）。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DEFAULT_REVIEWED_LIMIT, REVIEWED_LIMITS } from './constants.js'
import { settingsPathOf } from './paths.js'

/**
 * 把磁盘上任意形态的设置对象归一。
 * 未知字段原样保留（不吞掉历史遗留键），`reviewedLimit` 只接受枚举内的数字。
 *
 * 刻意不做隐式转换：字符串 `"100"` 只可能来自手改文件，若照单收下，文件里写的是字符串、
 * 界面下拉显示的是数字，两处表示就分家了。宁可判非法回退 0（无限）——下拉会因此显示
 * 「无限」，用户一眼看得见、改得回来，比悄悄接受一个奇怪形态好。
 */
function normalizeSettings(raw) {
  const base = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const n = base.reviewedLimit
  return {
    ...base,
    reviewedLimit: typeof n === 'number' && Number.isFinite(n) && REVIEWED_LIMITS.includes(n) ? n : DEFAULT_REVIEWED_LIMIT,
  }
}

/**
 * 读设置。文件不存在 / JSON 损坏 / 顶层不是对象，都退回默认值而不是抛错——
 * 设置是锦上添花的东西，不能因为它把整个面板读挂。
 * `broken` 只为界面提示留痕，默认 false。
 */
async function readSettings(cwd) {
  const path = settingsPathOf(cwd)
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    return { path, settings: normalizeSettings(parsed), broken: false }
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') {
      return { path, settings: normalizeSettings({}), broken: false }
    }
    return { path, settings: normalizeSettings({}), broken: true }
  }
}

/**
 * 合并写回：只改传进来的键，其余保留。写之前归一一次，防止绕过界面手改出非法值后
 * 又被原样写回去。原子写与 writePlan 同一套路（tmp → rename）。
 */
async function writeSettings(cwd, patch) {
  const current = await readSettings(cwd)
  const incoming = patch !== null && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
  const next = normalizeSettings({ ...current.settings, ...incoming })
  const path = settingsPathOf(cwd)
  await mkdir(dirname(path), { recursive: true })
  const body = `${JSON.stringify(next, null, 2)}\n`
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, body, 'utf8')
  await rename(tmp, path)
  return { path, settings: next }
}

export { REVIEWED_LIMITS, normalizeSettings, readSettings, writeSettings }
