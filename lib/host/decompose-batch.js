/**
 * 拆解产物的结构化（id=347）。
 *
 * 拆解这条路上**模型只负责想内容**（每一步做什么），其余全部由这里的纯函数决定：
 * - id：父拿一个正整数，children 是 `<父id>-A/B/C`（id=325 的规则）；
 * - children 归属：都挂在同一个父下，顺序 = 模型给的顺序；
 * - 结构合法性：正文非空、条数夹在上下限内、任务类型合法、名字不超长；
 * - 去重：同一个 `decomposeKey` 不会再拆一遍。
 *
 * 这些原来散在 `api.js` 的 `decompose` handler 里（和读盘、锁、LLM 调用搅在一起），
 * 只能靠「跑一次真拆解」来验。抽到这里之后：输入是纯数据，输出是纯数据，
 * 同样的输入永远同样的输出（时间戳由调用方传入，函数自己不读时钟）。
 */
import { childIdOf, isTopId } from './ids.js'
import { autoName } from './store.js'
import { TASK_TYPES } from './constants.js'
import { str } from './values.js'

/** 名字上限（与 store 的 AUTO_NAME_MAX 同量级；超了截断而不是丢条目）。 */
const NAME_MAX = 44

/**
 * 校验 + 规整一批「模型想出来的步骤」。
 *
 * 每条必须是 `{name?, plan, taskType?}`：
 * - 正文为空（或只有空白）的条目直接丢弃 —— 没有可做的事；
 * - 名字缺省时用 `autoName(plan)`；
 * - `taskType` 非法时落回 `修改`；父指定了 `forcedTaskType` 时一律用它（id=219）；
 * - 名字截到 44 字，正文不截（正文是模型写的执行说明，截断会把它变成半句话）。
 *
 * @param {Array} raw 模型给的（已解析成对象的）步骤数组
 * @param {{min?: number, max?: number, forcedTaskType?: string}} opts
 * @returns {Array<{name: string, plan: string, taskType: string}>}
 */
function normalizeSteps(raw, opts) {
  const list = Array.isArray(raw) ? raw : []
  const max = Number.isInteger(opts?.max) && opts.max > 0 ? opts.max : Number.MAX_SAFE_INTEGER
  const forced = TASK_TYPES.includes(opts?.forcedTaskType) ? opts.forcedTaskType : ''
  const out = []
  for (const entry of list) {
    if (out.length >= max) break
    const item = entry !== null && typeof entry === 'object' ? entry : {}
    const plan = str(item.plan).trim()
    if (plan === '') continue
    const name = str(item.name).trim() !== '' ? str(item.name).trim() : autoName(plan)
    const taskType = forced !== '' ? forced : TASK_TYPES.includes(item.taskType) ? item.taskType : '修改'
    out.push({ name: name.slice(0, NAME_MAX), plan, taskType })
  }
  return out
}

/**
 * 给一批步骤分配 id 与 children 归属，产出「可以直接拼进 plan.json 的父节点」。
 *
 * 纯函数：id / order / createdAt 都由入参给，函数自己不读时钟、不读磁盘。
 *
 * @param {Array} steps `normalizeSteps` 的产物
 * @param {{
 *   parentId: number, order: number, createdAt: string,
 *   name?: string, taskType?: string,
 *   decomposeKey?: string, sourcePrompt?: string
 * }} ctx
 * @returns {{children: Array, parent: object}}
 */
function buildBatch(steps, ctx) {
  const list = Array.isArray(steps) ? steps : []
  // id=QX5dyu-E：**这里原来只认整数父 id**：
  //     Number.isInteger(ctx?.parentId) && ctx.parentId > 0 ? ctx.parentId : 1
  // id=77-B 之后父 id 是 6 位随机串（`ZqsS7q`），`Number.isInteger('ZqsS7q')` 为 false，
  // 于是父 id 被**静默替换成 1**，子任务跟着变成 `1-A/1-B/1-C`。
  // 这是「待执行组 id 还是序号式」的最后一处来源：
  // 生成侧（createTaskId）明明给了随机串，在装配这一层被丢掉了。
  //
  // 现在两种形状都接受（与 ids.js 的 isTopId 同口径）：
  //   · 正整数        —— 历史数据 `12` / `12-A` 必须继续工作；
  //   · 6 位随机串    —— 新格式 `ZqsS7q`。
  // 非法值仍退回 1，但**不再悄悄吃掉合法的随机 id**。
  const rawParent = ctx?.parentId
  const validParent = typeof rawParent === 'number'
    ? Number.isInteger(rawParent) && rawParent > 0
    : typeof rawParent === 'string' && isTopId(rawParent)
  const parentId = validParent ? rawParent : 1
  const createdAt = str(ctx?.createdAt) !== '' ? ctx.createdAt : new Date(0).toISOString()
  const children = list.map((step, index) => ({
    id: childIdOf(parentId, index),
    order: (Number.isFinite(ctx?.order) ? ctx.order : 0) + index + 1,
    name: step.name,
    plan: step.plan,
    mode: '',
    taskType: step.taskType,
    execute: false,
    review: false,
    interrupted: false,
    failed: false,
    time: 0,
    note: '',
    finishedAt: '',
    createdAt,
    decomposeKey: str(ctx?.decomposeKey),
    // 原文只存在父上（id=272）：children 各存一份是纯冗余。
    sourcePrompt: '',
  }))
  const parent = {
    id: parentId,
    order: Number.isFinite(ctx?.order) ? ctx.order : 0,
    name: str(ctx?.name) !== '' ? str(ctx.name) : '拆解批次',
    plan: '',
    mode: '',
    taskType: children.length > 0 ? children[0].taskType : '修改',
    execute: false,
    review: false,
    interrupted: false,
    failed: false,
    time: 0,
    note: '',
    finishedAt: '',
    createdAt,
    decomposeKey: str(ctx?.decomposeKey),
    sourcePrompt: str(ctx?.sourcePrompt),
    children,
  }
  return { children, parent }
}

/**
 * 结构合法性检查（供调用方在拼装前断言；返回问题清单，空数组表示没问题）。
 * 只查「纯结构」，不查业务（业务规则在 normalizeSteps / buildBatch 里已经收口）。
 */
function validateBatch({ children, parent }) {
  const problems = []
  if (parent === null || typeof parent !== 'object') {
    problems.push('父节点缺失')
    return problems
  }
  // id=77-B：父 id 可以是正整数（历史）或 6 位随机串（新）。
  if (!isTopId(parent.id)) problems.push('父 id 既不是正整数也不是 6 位 id')
  if (!Array.isArray(children) || children.length === 0) problems.push('没有子任务')
  const seen = new Set()
  for (const kid of Array.isArray(children) ? children : []) {
    if (str(kid?.plan).trim() === '') problems.push(`子任务 ${kid?.id} 正文为空`)
    if (seen.has(String(kid?.id))) problems.push(`子任务 id 重复：${kid?.id}`)
    seen.add(String(kid?.id))
    if (str(kid?.decomposeKey) !== str(parent.decomposeKey)) problems.push(`子任务 ${kid?.id} 的 decomposeKey 与父不一致`)
    if (str(kid?.sourcePrompt) !== '') problems.push(`子任务 ${kid?.id} 不该存原文副本`)
  }
  if (str(parent.plan) !== '') problems.push('父节点不该有正文')
  return problems
}

export { NAME_MAX, buildBatch, normalizeSteps, validateBatch }
