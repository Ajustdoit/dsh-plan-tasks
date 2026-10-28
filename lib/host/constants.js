/** 计划数据目录（相对项目根）。 */
const PLAN_DIR = '.plan'
const PLAN_FILE = 'plan.json'
const SKILL_NAME = 'plan-tasks'

const TASK_TYPES = ['仅回答', '目标', '修改']

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
  SKILL_NAME,
  TASK_TYPES,
  DECOMPOSE_MIN,
  DECOMPOSE_SOFT_MAX,
  DECOMPOSE_HARD_CAP,
  SNAP_README_MAX,
  SNAP_TREE_MAX,
  SNAP_LOG_MAX,
  SNAP_HISTORY_MAX,
  SNAP_TOTAL_MAX,
}
