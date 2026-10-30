/** 计划数据目录（相对项目根）。 */
const PLAN_DIR = '.plan'
const PLAN_FILE = 'plan.json'
/** 已审核条目（含 note）的独立归档文件（id=269），与 plan.json 同目录。 */
const NOTES_FILE = 'notes.json'
/** 面板设置文件（与 plan.json 同目录）：noteLimit（note 保留多少条）与 todoThreshold（待办多少条算积压）。 */
const SETTINGS_FILE = 'settings.json'
/** 投递游标（id=342）：一组拆解任务投到哪了、投过哪几条，与 plan.json 同目录。 */
const DISPATCH_FILE = 'dispatch.json'
const SKILL_NAME = 'plan-tasks'

const TASK_TYPES = ['仅回答', '目标', '修改']

/**
 * 任务类型 → 执行模式（id=218）。
 *
 * 背景：`taskType` 原来只是个「标签 + 一段拼在提示词开头的字面前缀」，
 * 选「目标」的唯一效果是存下 `/目标 ` 这四个字符 —— 没有任何执行语义，
 * 用户点了跟没点一样（id=217 定位结论）。
 *
 * 现在把「执行模式」单独落成 `mode` 字段，和 `taskType` 分开存：
 * - `taskType` 是给人看的分类（三选一，决定前缀与图标）；
 * - `mode` 是给执行侧看的契约（决定这一条按什么方式推进）。
 *
 * 存中文而不是 `goal`:这个值会原样渲染成「模式：目标」给用户看，
 * 存成 `goal` 反而要前端再翻一次。取值也只有两种（`''` 或 `目标`），
 * 不会像枚举那样膨胀。
 */
const GOAL_MODE = '目标'

/** 由任务类型推出执行模式。目前只有「目标」有专属模式，其余一律普通执行（空串）。 */
function modeForTaskType(taskType) {
  return taskType === '目标' ? GOAL_MODE : ''
}

/**
 * 已审核（note）需要保留的条数（id=187，id=268 改造）。
 *
 * 语义从「已审核上限」变成「需要保留的 note 条数」：下拉就这四档，`200` 是默认值。
 * 不再提供「无限 / 0」档 —— 保留条数存在的意义就是给 note 定一个体积上限，
 * 留一个「无限」等于把这条设置关掉，而它正是被撑爆的那一头。
 *
 * 刻意做成枚举而不是任意数字：写 37 进来既没有对应控件，也让「裁到哪」变成猜不出来的行为。
 * 键名同步从 `reviewedLimit` 改成 `noteLimit`（见 settings.js 的旧键兼容读取）。
 */
const NOTE_LIMITS = [100, 200, 500, 1000]
const DEFAULT_NOTE_LIMIT = 200

/**
 * 「待审核」自动通过的条数阈值（id=300）。
 *
 * 待审核只增不减时，用户得一条条点「通过」，队列一长就没人再看。
 * 超过这个条数就自动把**最旧的一条**通过掉，于是它自然落进已审核归档，
 * 待审核永远不超过这个上限。默认 200 —— 与「需要保留的 note 条数」同档、
 * 下拉选项也复用同一组（界面要求「条数选项与已审核一致」）。
 */
const DEFAULT_AUTO_REVIEW_LIMIT = 200

/**
 * 裁剪已审核之前要不要先备份一份完整 plan.json（id=256/257）。
 *
 * 为什么默认关：裁剪本身是用户主动调小的，绝大多数时候就是想删；
 * 每次压缩都悄悄写一份全量副本，等于把 `.plan/` 变成没人看的垃圾桶。
 * 但对「把上限从 5000 调到 100」这种一次砍掉几千条的操作，手滑代价很大 ——
 * 所以给一个显式开关，勾了就每次裁剪前覆盖写一份 `.plan/planBack.json`。
 */
const DEFAULT_BACKUP_BEFORE_TRIM = false
/** 裁剪前的完整备份文件名（与 settings.json 同目录，即 `.plan/`）。 */
const BACKUP_FILE = 'planBack.json'
/** 已审核归档的备份文件名（id=269）：保留条数也裁 notes.json，它必须一起备份。 */
const NOTES_BACKUP_FILE = 'notesBack.json'

/**
 * 待办积压阈值（id=201）：待办条数**超过**这个数时，技能要求模型先进入「任务分析」
 * 再开干，而不是闷头一条条做。
 *
 * 为什么默认 30：待办队列到三十条量级时，「按顺序一条条做」本身已经不再是好策略——
 * 条目之间常有重叠、前置依赖或早已过时的需求，逐条硬做的代价（每条都要读文件、跑验证）
 * 会远高于先花一轮把队列理一遍。这个数是经验值，不是硬边界。
 *
 * 可配置：`.plan/settings.json` 里的 `todoThreshold`（正整数）。写在设置里而不是常量里，
 * 是因为不同项目节奏差别很大：小工具项目 10 条就该复盘，长期仓库 100 条也正常。
 */
const DEFAULT_TODO_THRESHOLD = 30
const TODO_THRESHOLD_MIN = 1
const TODO_THRESHOLD_MAX = 500

/**
 * 「拆解模式」产生的条数区间：默认拆 1~8 条，超过 12 条一律截断。
 * 硬上限存在的意义是防止模型把一句话拆成二十条，把列表塞爆。
 * 下限取 1：一句话本来就可能只够拆一件小事，逼着凑到 3 条只会逼出凑数条目。
 */
const DECOMPOSE_MIN = 1
const DECOMPOSE_SOFT_MAX = 8
const DECOMPOSE_HARD_CAP = 12
/** 项目快照每一段的截断长度，防止 token 爆炸。 */
const SNAP_README_MAX = 2400
const SNAP_TREE_MAX = 120
const SNAP_LOG_MAX = 2400
const SNAP_HISTORY_MAX = 1400
const SNAP_TOTAL_MAX = 9000

export {
  PLAN_DIR,
  PLAN_FILE,
  NOTES_FILE,
  SETTINGS_FILE,
  SKILL_NAME,
  TASK_TYPES,
  GOAL_MODE,
  modeForTaskType,
  NOTE_LIMITS,
  DEFAULT_NOTE_LIMIT,
  DEFAULT_AUTO_REVIEW_LIMIT,
  DEFAULT_BACKUP_BEFORE_TRIM,
  BACKUP_FILE,
  NOTES_BACKUP_FILE,
  DEFAULT_TODO_THRESHOLD,
  TODO_THRESHOLD_MIN,
  TODO_THRESHOLD_MAX,
  DECOMPOSE_MIN,
  DECOMPOSE_SOFT_MAX,
  DECOMPOSE_HARD_CAP,
  SNAP_README_MAX,
  SNAP_TREE_MAX,
  SNAP_LOG_MAX,
  SNAP_HISTORY_MAX,
  SNAP_TOTAL_MAX,
  DISPATCH_FILE,
}
