/** 计划数据目录（相对项目根）。 */
const PLAN_DIR = '.plan'
const PLAN_FILE = 'plan.json'
/** 面板设置文件（与 plan.json 同目录）：目前只有 reviewedLimit 一个有效字段。 */
const SETTINGS_FILE = 'settings.json'
const SKILL_NAME = 'plan-tasks'

const TASK_TYPES = ['仅回答', '目标', '修改']

/**
 * 已审核区块的保留条数上限（id=187）。界面上的下拉就这五档，`0` 表示无限。
 * 刻意做成枚举而不是任意数字：写 37 进来既没有对应控件，也让「裁到哪」变成猜不出来的行为。
 */
const REVIEWED_LIMITS = [100, 500, 1000, 5000, 0]
const DEFAULT_REVIEWED_LIMIT = 0

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
  SETTINGS_FILE,
  SKILL_NAME,
  TASK_TYPES,
  REVIEWED_LIMITS,
  DEFAULT_REVIEWED_LIMIT,
  DECOMPOSE_MIN,
  DECOMPOSE_SOFT_MAX,
  DECOMPOSE_HARD_CAP,
  SNAP_README_MAX,
  SNAP_TREE_MAX,
  SNAP_LOG_MAX,
  SNAP_HISTORY_MAX,
  SNAP_TOTAL_MAX,
}
