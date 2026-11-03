import { stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { DISPATCH_FILE, NOTES_FILE, PLAN_DIR, PLAN_FILE, SETTINGS_FILE, SKILL_NAME } from './constants.js'

const SKILL_REL = join('.dsh', 'skills', SKILL_NAME, 'SKILL.md')
/** 旧版本还会把技能写成 `.dsh/skills/plan-tasks.md`，一并认。 */
const SKILL_FLAT_REL = join('.dsh', 'skills', `${SKILL_NAME}.md`)

function planPathOf(cwd) {
  return join(cwd, PLAN_DIR, PLAN_FILE)
}

/**
 * 附件图片目录（id=UpcIC7-IMG）。
 *
 * 为什么存文件而不是把 base64 塞进 plan.json：
 *   · plan.json 每 5 秒被轮询读一次，条目还会全量下发给界面。
 *     一条 400KB 的 base64 图片 × 50 条 = 20MB/次，5 秒一次 ≈ 234MB/分钟，
 *     浏览器直接卡死。
 *   · 写盘要 JSON.stringify 整份数据，带几十 MB base64 时改一个 order 都要序列化几十 MB。
 * 存文件名后条目里只有 20 字节，轮询、写盘、渲染全都不受影响，
 * 浏览器自己还会缓存图片请求。
 */
function imagesDirOf(cwd) {
  return join(cwd, PLAN_DIR, 'images')
}

/** 某张图片的绝对路径。`name` 必须是 imagesDirOf 下的纯文件名（由调用方校验）。 */
function imagePathOf(cwd, name) {
  return join(imagesDirOf(cwd), name)
}
/** 已审核归档文件路径（与 plan.json 同目录，id=269）。 */
function notesPathOf(cwd) {
  return join(cwd, PLAN_DIR, NOTES_FILE)
}
/** 面板设置文件路径（与 plan.json 同目录）。 */
function settingsPathOf(cwd) {
  return join(cwd, PLAN_DIR, SETTINGS_FILE)
}
/** 投递游标文件路径（id=342）。 */
function dispatchPathOf(cwd) {
  return join(cwd, PLAN_DIR, DISPATCH_FILE)
}
function skillPathOf(cwd) {
  return join(cwd, SKILL_REL)
}

/** 把请求路径夹在项目根之内，避免越界写。 */
function inside(cwd, target) {
  const root = resolve(cwd)
  const full = resolve(root, target)
  return full === root || full.startsWith(root.endsWith(sep) ? root : root + sep) ? full : undefined
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** 展示 / 执行顺序：先按 order，再按 id 兜底。 */
/**
 * 展示 / 执行顺序：先按 order 升序，再按 id **字符串**兜底。
 *
 * id=77-C：原来兜底写的是 `a.id - b.id`。id 变成 6 位随机串之后（77-B），
 * `'aB3xK9' - 'Xy12Zz'` 是 NaN，而 NaN 参与的比较不满足反对称性 ——
 * 排序结果会变成「未定义」（不同浏览器/不同数据可能给出不同顺序）。
 * 改成字符串比较，顺序才是确定的。
 *
 * 同时把「缺失 order 时拿 id 当 order 用」的旧兜底去掉：那会让
 * `a.id` 与数字 order 直接相减，同样是 NaN 来源。缺失一律读作 0。
 */
function byOrder(a, b) {
  const oa = Number.isFinite(a?.order) ? Number(a.order) : 0
  const ob = Number.isFinite(b?.order) ? Number(b.order) : 0
  if (oa !== ob) return oa - ob
  const ia = String(a?.id ?? '')
  const ib = String(b?.id ?? '')
  if (ia === ib) return 0
  return ia < ib ? -1 : 1
}

export { SKILL_FLAT_REL, planPathOf, notesPathOf, settingsPathOf, dispatchPathOf, skillPathOf, imagesDirOf, imagePathOf, inside, exists, byOrder }
