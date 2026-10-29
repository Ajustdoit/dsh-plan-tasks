/**
 * `.plan/settings.json` 读写。
 *
 * 这个文件早先只是几个会话留下的死配置（`autoAppend/defaultMode/defaultTaskType`，
 * 宿主一行代码都没读过）。从 id=187 起它成为**真正的设置存储**；id=268 起
 * 字段名从 `reviewedLimit` 改成 `noteLimit` —— 「需要保留的 note 条数」，
 * 超出就按先进先出裁掉最旧的 note（已审核条目）。旧键仍可读，见 normalizeSettings。
 *
 * 取值刻意做成**枚举**而不是任意数字：界面上的下拉就这四档，写 37 进来既没有对应控件，
 * 也会让「裁到哪」变成猜不出来的行为。非法值回落到默认 200。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  DEFAULT_BACKUP_BEFORE_TRIM,
  DEFAULT_NOTE_LIMIT,
  DEFAULT_TODO_THRESHOLD,
  NOTE_LIMITS,
  TODO_THRESHOLD_MAX,
  TODO_THRESHOLD_MIN,
} from './constants.js'
import { settingsPathOf } from './paths.js'

/**
 * 把磁盘上任意形态的设置对象归一。
 * 未知字段原样保留（不吞掉历史遗留键），`noteLimit` 只接受枚举内的数字。
 *
 * 刻意不做隐式转换：字符串 `"100"` 只可能来自手改文件，若照单收下，文件里写的是字符串、
 * 界面下拉显示的是数字，两处表示就分家了。非法值回落到默认 200。
 *
 * id=268 旧键兼容：设置键从 `reviewedLimit` 改名为 `noteLimit`，但磁盘上已经存在
 * 形如 `reviewedLimit: 1000` 的旧文件，直接改名会让用户「明明调过、打开又变回 200」。
 * 读取顺序固定为 新键 → 旧键 → 默认值：
 * - 新键合法就用新键（改造后写过一次文件的，从此只认它）；
 * - 新键缺失/非法，旧键合法就用旧键（改造前的存量设置在这一步被接住）；
 * - 都没有才落回 200。
 * 旧键只读不写：`writeSettings` 落盘时不再带 `reviewedLimit`，避免同一个设置两处真值。
 */
function normalizeSettings(raw) {
  const base = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const { reviewedLimit: legacy, ...rest } = base
  return {
    ...rest,
    noteLimit: pickNoteLimit(base.noteLimit, legacy),
    todoThreshold: normalizeTodoThreshold(base.todoThreshold),
    backupBeforeTrim: normalizeBackupBeforeTrim(base.backupBeforeTrim),
  }
}

/** 枚举内的数才算合法；非枚举（含 0 / 5000 这些已下架的档位）一律当「读不到」。 */
const inNoteLimits = (value) => typeof value === 'number' && Number.isFinite(value) && NOTE_LIMITS.includes(value)

/**
 * 新键 → 旧键 → 默认值。
 *
 * 旧键的值按 id=268 的档位迁移过一遍再判：旧档位是 100/500/1000/5000/0，
 * 其中 100/500/1000 与新档位同名同义，直接沿用；5000 与 0（旧语义「无限」）
 * 在新语义里没有对应档位，映射到新上限 1000（保留条数里最大的一档）。
 * 「无限」不可能被继承 —— 它正是要修的病根。
 */
function pickNoteLimit(next, legacy) {
  if (inNoteLimits(next)) return next
  const migrated = migrateLegacyLimit(legacy)
  if (migrated !== null) return migrated
  return DEFAULT_NOTE_LIMIT
}

/** 旧档位 → 新档位；认不出的旧值返回 null（交给默认值兜底）。 */
function migrateLegacyLimit(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (NOTE_LIMITS.includes(value)) return value
  if (value === 5000) return 1000
  if (value === 0) return 1000
  // 手改出来的其他数字：夹到最近的合法档位（写 3000 的人意思是「多留一点」）。
  return NOTE_LIMITS.reduce((best, n) => (Math.abs(n - value) < Math.abs(best - value) ? n : best), DEFAULT_NOTE_LIMIT)
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

export { NOTE_LIMITS, normalizeBackupBeforeTrim, normalizeSettings, normalizeTodoThreshold, readSettings, writeSettings }
