/**
 * `.plan/settings.json` 读写。
 *
 * 这个文件早先只是几个会话留下的死配置（`autoAppend/defaultMode/defaultTaskType`，
 * 宿主一行代码都没读过）。从 id=187 起它成为**真正的设置存储**；id=268 起
 * `noteLimit` 固定为 0：已审核只归档、不按条数删除。磁盘上的旧档位（100/200/500/1000）
 * 读出来也会收成 0，避免老项目打开面板后又删掉历史。
 *
 * id=391：`autoReviewLimit` 已移除（题面：取消待审核的自动审核机制）。
 * 磁盘上残留的这个键会在下次写回时被丢掉（见 `normalizeSettings`）——
 * 与 `reviewedLimit` 同一处理：死键不该留在文件里误导人。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  DEFAULT_BACKUP_BEFORE_TRIM,
  DEFAULT_NOTE_LIMIT,
  DEFAULT_ORPHAN_GRACE_ANSWER_MIN,
  DEFAULT_ORPHAN_GRACE_MIN,
  DEFAULT_TODO_THRESHOLD,
  ORPHAN_GRACE_MAX,
  ORPHAN_GRACE_MIN,
  TODO_THRESHOLD_MAX,
  TODO_THRESHOLD_MIN,
} from './constants.js'
import { settingsPathOf } from './paths.js'

/**
 * 把磁盘上任意形态的设置对象归一。
 * 未知字段原样保留。`noteLimit` 不再读取磁盘上的档位，一律写成 0。
 * 旧键 `reviewedLimit` / `autoReviewLimit` 拆出来丢掉，避免同一个设置在两处各有真值。
 *
 * id=391：`autoReviewLimit` 加进丢弃列表（与 `reviewedLimit` 同样处理）。
 * 它已经没有任何读取方了 —— 留着会让下一个人以为自动审核还在、只是没接上，
 * 于是又去翻 api.js 找那个不存在的扫描。删掉这个键是「让磁盘上的形状
 * 与代码的形状一致」，比在注释里解释「这个键是死的」可靠得多。
 */
/**
 * 归一化 settings.json。
 *
 * `delete` 的三条是**已废弃的键**：读进来就丢掉，下次写盘自然清掉。
 * 与代码形状一致总比在注释里解释「这个键是死的」可靠。
 */
function normalizeSettings(raw) {
  const base = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const rest = { ...base }
  delete rest.reviewedLimit
  delete rest.autoReviewLimit
  // id=wZIKdd：顶栏「自动确认」开关已整体删除，这个键不再有人读。
  // 不删的话它会被 `...rest` 原样带下去，settings.json 里永远躺着一个死设置。
  delete rest.autoConfirm
  return {
    ...rest,
    noteLimit: DEFAULT_NOTE_LIMIT,
    todoThreshold: normalizeTodoThreshold(base.todoThreshold),
    backupBeforeTrim: normalizeBackupBeforeTrim(base.backupBeforeTrim),
    // id=80-B：「自动确认」开关。与 backupBeforeTrim 同一套布尔归一（只认 true）。
    // id=326：编号规则迁移到了第几版。1（缺省）= 老数据，需要做一次「顶层重排 + children
    // 层级化」；2 = 已迁移，之后只修真缺陷（重复 / 撞归档号段 / children 形状不对），
    // 不再因为「删条目留下洞」而整体顺延 —— 编号是身份。
    idsVersion: Number.isInteger(base.idsVersion) && base.idsVersion >= 1 ? base.idsVersion : 1,
    // id=ImWOun 后续优化：孤儿判定宽限（分钟）。原来硬编码 30 分钟，
    // 比本仓实测最长任务（40 分钟）还短。现在可配：普通 120、仅回答 360。
    orphanGraceMin: normalizeOrphanGrace(base.orphanGraceMin, DEFAULT_ORPHAN_GRACE_MIN),
    orphanGraceAnswerMin: normalizeOrphanGrace(base.orphanGraceAnswerMin, DEFAULT_ORPHAN_GRACE_ANSWER_MIN),
  }
}

/**
 * 「裁剪前备份」开关归一（id=256）。
 *
 * 只认真正的 `true`：字符串 `"true"`、数字 `1`、`"是"` 一律当关闭。
 * 这个开关决定「要不要往磁盘写一份全量副本」，宁可少备份也不要因为手改出一个
 * 似是而非的值就每次裁剪都偷偷写盘 —— 用户看不到副作用的东西不能靠猜。
 */
function normalizeBackupBeforeTrim(value) {
  return value === undefined ? DEFAULT_BACKUP_BEFORE_TRIM : value === true
}

/**
 * 待办阈值归一（id=201）。
 *
 * 与 `noteLimit` 的「非法即回退」略有不同，这里是**分两种错处**：
 * - 数字但越界 / 小数 → 夹到最近的边界。写 `1000` 的人意思很清楚（「很多条再说」），
 *   把他打回默认 30 反而违背本意；夹到 500 是可解释的。
 * - 不是数字（含字符串 `"50"`、null、NaN）→ 默认 30。这类只能是手改坏了，
 *   给个安全值比夹边界更不容易让人误会「我明明写了 50」。
 */
function normalizeTodoThreshold(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TODO_THRESHOLD
  const rounded = Math.round(value)
  if (rounded < TODO_THRESHOLD_MIN) return TODO_THRESHOLD_MIN
  if (rounded > TODO_THRESHOLD_MAX) return TODO_THRESHOLD_MAX
  return rounded
}

/**
 * 「孤儿判定宽限」归一（id=ImWOun 后续优化）。
 *
 * 两个键：`orphanGraceMin`（普通任务）与 `orphanGraceAnswerMin`（仅回答）。
 * 单位分钟，范围 1 ~ 10080（7 天）。非法值退回默认，**不抛错** ——
 * 与 todoThreshold 同一套「非法即回退」口径。
 *
 * 为什么允许用户改：任务时长因项目而异。原来 30 分钟硬编码，
 * 对「跑 40 分钟的实测任务」根本不够；写死成 120 又会对别的项目偏松。
 */
function normalizeOrphanGrace(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.round(value)
  if (rounded < ORPHAN_GRACE_MIN) return ORPHAN_GRACE_MIN
  if (rounded > ORPHAN_GRACE_MAX) return ORPHAN_GRACE_MAX
  return rounded
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

export { normalizeBackupBeforeTrim, normalizeSettings, normalizeTodoThreshold, readSettings, writeSettings }
