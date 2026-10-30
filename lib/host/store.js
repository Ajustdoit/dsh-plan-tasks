import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { foldSplit, hasChildren } from './children.js'
import { childIdOf } from './ids.js'
import { normalizeTiming } from './timing.js'
import { TASK_TYPES, modeForTaskType } from './constants.js'
import { byOrder, exists, planPathOf } from './paths.js'
import { ensureQueueCli } from './queue.js'
import { repairPlanFile } from './repair.js'
import { pick, str } from './values.js'

/**
 * 历史遗留的「置顶标记」键（id=245）。
 *
 * 本插件从来没有把置顶存成标记 —— 置顶就是重排 `order` 数组（见 `60-tab.js` 的
 * `pinTop`），落盘只有 `order` 一个字段。但计划 id=245 要处理「脏数据里带着置顶标记」
 * 的情况：旧版本、别人的分支、或者用户手工编辑 plan.json，都可能塞进这类键。
 *
 * 这些键今天会被下面的白名单天然丢掉，可那是「碰巧没人读」而不是「明确不认」——
 * 一旦将来有人写了读 pin 字段的排序逻辑，残留值就会真的影响顺序。
 * 所以在入口处显式剥掉：读盘得到的条目里永远不会带着它们，排序也就只可能看 `order`。
 */
const LEGACY_PIN_KEYS = ['pinned', 'pin', 'pinnedAt', 'pinnedOrder', 'isPinned', 'pinTop']

function scrubLegacyPin(raw) {
  if (raw === null || typeof raw !== 'object') return raw
  let hit = null
  for (const key of LEGACY_PIN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, key) === true) {
      if (hit === null) hit = []
      hit.push(key)
    }
  }
  if (hit === null) return raw
  const copy = { ...raw }
  for (const key of hit) delete copy[key]
  return copy
}

/** 单条计划补齐默认字段，并容忍用户手写的旧格式。 */
function normalizeItem(raw, index) {
  const item = raw !== null && typeof raw === 'object' ? scrubLegacyPin(raw) : {}
  // id=325：一级任务是正整数，子任务是 "<一级id>-<后缀>" 字符串，两种都收。
  const id = Number.isInteger(item.id) && item.id > 0
    ? item.id
    : typeof item.id === 'string' && item.id !== ''
      ? item.id
      : index + 1
  const plan = str(item.plan)
  const taskType = TASK_TYPES.includes(item.taskType) ? item.taskType : '目标'
  const mode = str(item.mode)
  return {
    id,
    // 手工拖拽决定的展示 / 执行顺序；缺失时退回数组下标。
    order: Number.isFinite(item.order) ? Number(item.order) : index,
    name: str(item.name).trim() !== '' && !isStaleAutoName(item.name, plan)
      ? item.name
      : autoName(plan),
    plan,
    // 执行模式（id=218）：显式存下的值优先，缺失时按 taskType 推。
    // 「任务创建时写进 mode、执行时优先读 mode」——读这一侧的回退逻辑就落在这里。
    // 旧数据（含 217 定位时那 39 条 `taskType: 目标` / `mode: ''` 的条目）因此
    // 一读出来就是目标模式，不用逐个改文件。
    mode: mode !== '' ? mode : modeForTaskType(taskType),
    taskType,
    execute: item.execute === true,
    review: item.review === true,
    // 草稿：侧边栏「草稿模式」下发送的计划。不进执行队列，模型按技能跳过它。
    draft: item.draft === true,
    // 已中断（id=233）：开工时写了 startedAt，但 turn 被中途停掉、没走到回填 execute。
    // 必须落盘而不是只放内存 —— 「已挂起」原来是纯内存态，刷新就丢，于是又显示成「执行中」。
    // 老数据没有这个字段，一律按 false 兼容。
    interrupted: item.interrupted === true,
    // 执行失败：模型用 .plan/q.mjs fail 标上。不再被下一条选中，面板显示「失败」。
    // 老数据没有这个字段，一律按 false。
    failed: item.failed === true,
    // id=348：耗时 / 时间戳统一走 timing.normalizeTiming —— 缺失、非法、负数一律 0；
    // 已完成但没有 finishedAt 的用 createdAt 兜底；未完成却带 finishedAt 的置空。
    // 这一段收口之前，历史数据里「有的有执行时间、有的没有」就是因为各写入路径
    // 对这三个字段的处理不一致（有的写 0、有的写 null、有的压根不写）。
    time: normalizeTiming(item).time,
    note: str(item.note),
    // 完成（审核通过）的时刻（id=269）：保留条数按「时间从旧到新」淘汰，靠的就是它。
    // 老数据没有这个字段，读出来是空串，trim.noteTimeOf 会三级回退到 startedAt / createdAt / id。
    // id=348：非法值（"不是时间"）也归成空串，避免下游 Date.parse 得到 NaN 后排序塌掉。
    finishedAt: normalizeTiming(item).finishedAt,
    createdAt: str(item.createdAt) !== '' ? item.createdAt : new Date().toISOString(),
    // id=348：startedAt 只保留「解析得出」的值。一个解析不了的时间戳不能当「正在跑」的证据，
    // 留着会让 statusOf 把普通待执行误判成执行中。
    ...normalizeTiming(item).startedAt === '' ? {} : { startedAt: normalizeTiming(item).startedAt },
    // 拆解模式的幂等键：同一次拆解产生的 N 条共用同一个键，重复提交直接认领旧条目。
    ...pick('decomposeKey', item.decomposeKey),
    // 这条计划是怎么来的：拆解模式里存本次拆解用的原始提示词全文；
    // 手工提交的条目为空串。旧数据没有这个字段，一律按空串兼容，不报错。
    sourcePrompt: str(item.sourcePrompt),
  }
}

/**
 * 归一一条「可能带 children 的条目」（id=272）。
 *
 * 为什么不在 normalizeItem 里递归：normalizeItem 被 item.js / repair.js 当成
 * 「单条叶子」的归一用，递归进去会让那些调用点多出一层不该有的结构。
 * 层级只在 store 的读写边界上处理 —— 读进来把 children 逐条清洗，写出去原样保留。
 *
 * children 只在**非空数组**时保留：空数组写盘是噪音，也会让 `hasChildren` 之外
 * 的判断（比如「这条有没有子任务」）多一个分支。
 */
function normalizeNode(raw, index) {
  const base = normalizeItem(raw, index)
  const children = raw !== null && typeof raw === 'object' && Array.isArray(raw.children) ? raw.children : []
  if (children.length === 0) return base
  return {
    ...base,
    // id=325：老数据的子任务还是全局数字 id，先按位置补成层级式，读出来就有一套统一写法。
    // 真正落盘的迁移在 id=326（可重复执行），这里只保证「怎么读都一致」。
    children: children.map((child, i) => {
      const one = normalizeItem(child, i)
      return { ...one, id: typeof one.id === 'string' ? one.id : childIdOf(base.id, i) }
    }),
  }
}

/** 自动名称的长度上限：标题栏现在最多显示两行，名称可以留得长一些。 */
const AUTO_NAME_MAX = 44

/** 从提示词里截一个自动名称，用于手风琴标题。 */
function autoName(text) {
  const flat = String(text ?? '')
    .replace(/[\s\u3000]+/g, ' ')
    .trim()
  if (flat === '') return '未命名计划'
  return flat.length <= AUTO_NAME_MAX ? flat : `${flat.slice(0, AUTO_NAME_MAX)}…`
}

/**
 * 判断已存下来的 name 是不是旧版自动截断的产物。
 * 旧版只截 16 个字，后面带省略号；提示词本身更长时，
 * 这条 name 就只是 plan 的前缀 —— 这种应该按新长度重新生成。
 */
function isStaleAutoName(name, plan) {
  if (!name.endsWith('…')) return false
  const head = name.slice(0, -1)
  const flat = String(plan ?? '').replace(/[\s\u3000]+/g, ' ').trim()
  return flat.length > name.length && flat.startsWith(head)
}

/**
 * 列表用的精简条目：正文只留前 240 字（够画标题与预览），备注只留长度标记。
 * 名称、状态、时间戳这些「驱动界面」的字段全部保留，所以列表行为与全量读取一致。
 */
const LITE_PLAN_MAX = 240

function toLiteItem(item) {
  const plan = str(item.plan)
  const source = str(item.sourcePrompt)
  const lite = {
    ...item,
    plan: plan.length <= LITE_PLAN_MAX ? plan : `${plan.slice(0, LITE_PLAN_MAX)}…`,
    planLen: plan.length,
    noteLen: str(item.note).length,
    note: '',
    // 原始提示词可能很长，列表轮询只带长度标记，展开时再按需取全文（同 note 的做法）。
    sourcePromptLen: source.length,
    sourcePrompt: '',
  }
  // 父节点（id=272）：children 每条也要走同一个投影，否则列表轮询会把子任务的整段
  // note / sourcePrompt 一起搬进来 —— 那正是这次要省掉的开销。
  if (hasChildren(item)) lite.children = item.children.map(toLiteItem)
  return lite
}

/** 把 plan.json 的任意历史形状（单个对象 / 数组 / 带 items 的包装）读成数组。 */
function toList(parsed) {
  if (Array.isArray(parsed)) return parsed
  if (parsed !== null && typeof parsed === 'object') {
    if (Array.isArray(parsed.items)) return parsed.items
    if (typeof parsed.plan === 'string' || Number.isInteger(parsed.id)) return [parsed]
  }
  return []
}
async function readPlan(cwd) {
  const path = planPathOf(cwd)
  if (!(await exists(path))) return { path, exists: false, items: [] }
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return { path, exists: false, items: [] }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { path, exists: true, items: [], broken: true }
  }
  return { path, exists: true, items: normalizeList(toList(parsed)) }
}

/**
 * 把磁盘上的列表读成两级结构（id=272）：先逐条归一，再按 decomposeKey 折叠。
 *
 * 折叠是**读时**做的（而不是让用户手工迁移）：旧 plan.json 里同一批拆解产物是平铺的，
 * 一读就变成「父 + children」，写盘时也只写这个新形状 —— 于是第一次点开面板就完成了迁移。
 * 只有 ≥2 条的拆解批会被折叠（单条没有「批」可言，硬造父只是多一层空壳）。
 */
function normalizeList(list) {
  const normalized = (Array.isArray(list) ? list : []).map(normalizeNode)
  return foldSplit(normalized).sort(byOrder)
}

/**
 * 严格读（id=254）：把 `readPlan` 混成一坨的三种退化拆开。
 *
 * `readPlan` 对「文件不存在 / 读不出来 / 不是合法 JSON」一律返回 `items: []`，
 * 于是调用方拿到空数组当基底再写回，**一次坏文件就能把全量数据覆盖成一条**（id=253 实测复现）。
 * 写路径不能再用它，必须能分清「真的是空的」和「读不懂」。
 *
 * 返回 `status`：
 * - `ok`：正常，`items` 已归一 + 按 order 排序；
 * - `missing`：文件还不存在（首次使用，允许当成空列表继续写）；
 * - `unreadable`：文件在，但读不出来（权限 / IO / 目录被占用）；
 * - `broken`：读出来了，但不是合法 JSON。
 *
 * `raw` 一并回传：损坏留档与修复（id=255）要用原文，重新读一次既慢又可能读到别人写到一半的内容。
 */
async function readPlanStrict(cwd) {
  const path = planPathOf(cwd)
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') {
      return { path, status: 'missing', items: [], raw: '' }
    }
    return { path, status: 'unreadable', items: [], raw: '', error }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { path, status: 'broken', items: [], raw, error }
  }
  return { path, status: 'ok', items: normalizeList(toList(parsed)), raw }
}

/**
 * 同一个 plan.json 的读-改-写串行化（id=189 暴露的并发缺陷）。
 *
 * 症状：8 个并发 `update` 里稳定有 2~3 个报
 * `ENOENT: rename 'plan.json.tmp-<pid>-<ts>' -> 'plan.json'`。
 * 根因是 tmp 名只用了 `pid` + `Date.now()`：同进程同一毫秒的两次写会**算出同一个
 * tmp 路径**，先完成的那个把它 rename 走了，后一个的 rename 就扑空。
 *
 * 两处一起修：
 * 1. tmp 名加一个进程内自增序号（`uniqueTmp`），任何两次写都不会撞路径；
 * 2. 读-改-写整段加锁（`withPlanLock`）—— 光有唯一 tmp 只能保证文件不被写坏，
 *    挡不住「A 读到 10 条、B 也读到 10 条，A 写回 10 条、B 写回 10 条」，后者会把
 *    前者的改动整个覆盖掉（lost update）。
 *
 * 锁按路径排队（`Map<path, Promise>`），不同项目目录互不阻塞。
 * 用法：调用方把 `readPlan → 改 → writePlan` 整段包进 `withPlanLock(cwd, async () => …)`。
 * `writePlan` 自己**不再加锁**，否则在锁内调用会自己等自己。
 */
const planLocks = new Map()

/** 进程内自增序号：与 pid、时间戳一起，保证 tmp 路径唯一。 */
let tmpSeq = 0

function withPlanLock(cwd, fn) {
  const key = planPathOf(cwd)
  const prev = planLocks.get(key) ?? Promise.resolve()
  // `.then(fn, fn)`：前一个任务失败也必须放行后一个，否则一次写失败会把这条路径永久堵死。
  const run = prev.then(fn, fn)
  // 队列里存的是一个「永不 reject」的尾巴：既不产生 unhandled rejection，
  // 也让下一个任务不必关心前一个的成败。
  const tail = run.then(
    () => undefined,
    () => undefined,
  )
  planLocks.set(key, tail)
  void tail.then(() => {
    // 队列排空就把键删掉，别让 Map 随项目数无限增长；只删自己这一环，避免误删后来者。
    if (planLocks.get(key) === tail) planLocks.delete(key)
  })
  return run
}

async function writePlan(cwd, items) {
  const path = planPathOf(cwd)
  await mkdir(dirname(path), { recursive: true })
  // 落盘前统一按 order 重排，并把 order 重编号成 0,1,2… 保证文件与界面顺序一致。
  // children（id=272）原样保留：父的 order 决定它在列表里的位置，子任务内部按数组顺序，
  // 不给子任务重编 order —— 它们不参与拖拽，重编只会让「父整体移动」变得不可预测。
  const list = (Array.isArray(items) ? items : [])
    .map(normalizeNode)
    .sort(byOrder)
    .map((item, index) => ({ ...item, order: index }))
  const body = `${JSON.stringify(list, null, 2)}\n`
  tmpSeq += 1
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${tmpSeq}`
  await writeFile(tmp, body, 'utf8')
  await rename(tmp, path)
  // 记账脚本与计划放在一起：模型只跑它，不再把整份 plan.json 读进上下文。
  await ensureQueueCli(cwd)
  return { path, items: list }
}
/**
 * 唯一的写入口（id=254）：读 → 改 → 写整段在一个临界区里跑完。
 *
 * 为什么要有它：withPlanLock 早就在了，但锁是「调用方自己记得加」的约定 ——
 * 九个 handler 各写一遍 readPlan + writePlan，只要将来有人漏写一次锁，
 * 丢更新的窗口就又开了一个。把三件事收进一个函数，锁的边界就只有这一处定义。
 *
 * mutator 收到 { items, status, raw, path }，返回：
 * - 数组 → 写成这份（写盘前照例按 order 重排 + 重编号）；
 * - null / undefined → 不写盘，直接回 { skipped: true }。
 *   用于「幂等命中」「本来就不用改」这类分支，省掉一次无意义的重写。
 *
 * 损坏防御（id=255 的接口）：status 不是 ok/missing 时默认抛错，
 * 绝不拿空数组当基底去覆盖 —— 这是 id=253 实测到的「坏一次就全丢」的直接堵法。
 * 真要写（例如修复流程主动重建），调用方显式传 { allowBroken: true }。
 */
/**
 * 默认修复钩子（id=255）：归档原文 → 逐级抢救 → 用 writePlan 写回。
 *
 * 为什么做成可替换的钩子而不是直接调：宿主装配时要顺带 `ctx.logger.warn` 记一笔，
 * 也方便单测里换成「必定失败」的桩来验「救不回来就别写」。默认实现不碰 ctx，
 * 所以没装配也能工作。
 */
// path 是 `<cwd>/.plan/plan.json`，writePlan 收的是 cwd —— 上两层，别再拼一次 .plan。
let repairHook = async (current) => repairPlanFile(current.path, current.raw, (items) => writePlan(dirname(dirname(current.path)), items))

/**
 * 最近一次自动修复的结果，供 `read` 回显给界面（用户要知道「刚才少了三条」）。
 *
 * 按项目分开存：这是一个进程级模块，同时开着几个项目时，
 * A 项目修好一次不能弹到 B 项目的面板上。
 */
const repairNotices = new Map()

function setRepairHook(hook) {
  repairHook = typeof hook === 'function' ? hook : null
}

function takeLastRepair(cwd) {
  const key = planPathOf(cwd)
  const out = repairNotices.get(key) ?? null
  repairNotices.delete(key)
  return out
}

async function mutatePlan(cwd, mutator, options) {
  const allowBroken = options !== null && typeof options === 'object' && options.allowBroken === true
  return withPlanLock(cwd, async () => {
    let current = await readPlanStrict(cwd)
    // 坏文件先抢救（id=255）：归档原文 → 按对象捞回 → 写回，再让 mutator 在救回的数据上继续。
    // 顺序很关键：先归档再覆盖，否则唯一的证据就没了。
    // 修复失败仍然抛 plan-broken —— 拒绝写入是最后一道防线，不能被「尽力修复」绕过。
    if (current.status === 'broken' && allowBroken !== true && repairHook !== null) {
      const report = await repairHook(current)
      if (report.repaired === true) {
        current = await readPlanStrict(cwd)
        repairNotices.set(planPathOf(cwd), report)
      }
    }
    if (current.status !== 'ok' && current.status !== 'missing' && allowBroken !== true) {
      const error = new Error(
        'plan.json 无法解析（' + (current.status === 'broken' ? '不是合法 JSON' : '读取失败') + '），已拒绝写入以免覆盖数据',
      )
      error.code = current.status === 'broken' ? 'plan-broken' : 'plan-unreadable'
      throw error
    }
    const next = await mutator(current)
    if (next === null || next === undefined) return { skipped: true, path: current.path, items: current.items }
    const written = await writePlan(cwd, next)
    return { skipped: false, path: written.path, items: written.items }
  })
}

export {
  normalizeItem,
  normalizeNode,
  normalizeList,
  autoName,
  toLiteItem,
  readPlan,
  readPlanStrict,
  writePlan,
  mutatePlan,
  setRepairHook,
  takeLastRepair,
  withPlanLock,
}
