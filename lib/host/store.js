import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { TASK_TYPES } from './constants.js'
import { byOrder, exists, planPathOf } from './paths.js'
import { pick, str } from './values.js'

/** 单条计划补齐默认字段，并容忍用户手写的旧格式。 */
function normalizeItem(raw, index) {
  const item = raw !== null && typeof raw === 'object' ? raw : {}
  const id = Number.isInteger(item.id) && item.id > 0 ? item.id : index + 1
  const plan = str(item.plan)
  return {
    id,
    // 手工拖拽决定的展示 / 执行顺序；缺失时退回数组下标。
    order: Number.isFinite(item.order) ? Number(item.order) : index,
    name: str(item.name).trim() !== '' && !isStaleAutoName(item.name, plan)
      ? item.name
      : autoName(plan),
    plan,
    mode: str(item.mode),
    taskType: TASK_TYPES.includes(item.taskType) ? item.taskType : '目标',
    execute: item.execute === true,
    review: item.review === true,
    // 草稿：侧边栏「草稿模式」下发送的计划。不进执行队列，模型按技能跳过它。
    draft: item.draft === true,
    time: Number.isFinite(item.time) ? Number(item.time) : 0,
    note: str(item.note),
    createdAt: str(item.createdAt) !== '' ? item.createdAt : new Date().toISOString(),
    ...item.startedAt === undefined ? {} : { startedAt: item.startedAt },
    // 拆解模式的幂等键：同一次拆解产生的 N 条共用同一个键，重复提交直接认领旧条目。
    ...pick('decomposeKey', item.decomposeKey),
    // 这条计划是怎么来的：拆解模式里存本次拆解用的原始提示词全文；
    // 手工提交的条目为空串。旧数据没有这个字段，一律按空串兼容，不报错。
    sourcePrompt: str(item.sourcePrompt),
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
  return {
    ...item,
    plan: plan.length <= LITE_PLAN_MAX ? plan : `${plan.slice(0, LITE_PLAN_MAX)}…`,
    planLen: plan.length,
    noteLen: str(item.note).length,
    note: '',
    // 原始提示词可能很长，列表轮询只带长度标记，展开时再按需取全文（同 note 的做法）。
    sourcePromptLen: source.length,
    sourcePrompt: '',
  }
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
  return { path, exists: true, items: toList(parsed).map(normalizeItem).sort(byOrder) }
}

async function writePlan(cwd, items) {
  const path = planPathOf(cwd)
  await mkdir(dirname(path), { recursive: true })
  // 落盘前统一按 order 重排，并把 order 重编号成 0,1,2… 保证文件与界面顺序一致。
  const list = items
    .map(normalizeItem)
    .sort(byOrder)
    .map((item, index) => ({ ...item, order: index }))
  const body = `${JSON.stringify(list, null, 2)}\n`
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, body, 'utf8')
  await rename(tmp, path)
  return { path, items: list }
}
export {
  normalizeItem,
  autoName,
  toLiteItem,
  readPlan,
  writePlan,
}
