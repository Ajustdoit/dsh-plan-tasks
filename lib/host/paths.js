import { stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { PLAN_DIR, PLAN_FILE, SETTINGS_FILE, SKILL_NAME } from './constants.js'

const SKILL_REL = join('.dsh', 'skills', SKILL_NAME, 'SKILL.md')
/** 旧版本还会把技能写成 `.dsh/skills/plan-tasks.md`，一并认。 */
const SKILL_FLAT_REL = join('.dsh', 'skills', `${SKILL_NAME}.md`)

function planPathOf(cwd) {
  return join(cwd, PLAN_DIR, PLAN_FILE)
}
/** 面板设置文件路径（与 plan.json 同目录）。 */
function settingsPathOf(cwd) {
  return join(cwd, PLAN_DIR, SETTINGS_FILE)
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
function byOrder(a, b) {
  const oa = Number.isFinite(a.order) ? a.order : a.id
  const ob = Number.isFinite(b.order) ? b.order : b.id
  return oa === ob ? a.id - b.id : oa - ob
}

export { SKILL_FLAT_REL, planPathOf, settingsPathOf, skillPathOf, inside, exists, byOrder }
