import { createHash } from 'node:crypto'
import { dirname, isAbsolute } from 'node:path'
import { TASK_TYPES } from './constants.js'
import { exists, inside } from './paths.js'
// `autoName` 是 id=219 顺手补上的：`normalizeDecomposed` 一直在用它给缺名字的子任务
// 生成短名，但文件顶部从来没导入过 —— 只要模型有一条子任务没给 name 就会
// `ReferenceError: autoName is not defined`。以前没暴露是因为拆解提示词强制要求
// 模型给 name，测试用例也都带了 name。
import { autoName } from './store.js'

const DECOMPOSE_SYSTEM = `你是一个任务拆解器。用户会把一段需求交给你，你要结合给到的项目快照，把它拆成若干条可以独立执行、彼此不重叠的子任务。

规则：
1. 只输出一个 JSON 对象，不要任何解释、不要 markdown 代码围栏。格式：
   {"tasks":[{"name":"不超过 24 字的短名","plan":"这条子任务要做什么，写全到别人能照着做","taskType":"修改|目标|仅回答"}],"cut":["题面里应该砍掉或不必要的部分"]}
2. tasks 条数控制在给定的区间内，宁可少而实，不要凑数；每条只做一件事。
3. 不要为了凑数追加「联合回归验证」。只有改动跨了多个互相调用的模块、分开验会漏掉组合问题时，才把验证放进最后一条；单点改动不要单列验证任务。
4. 严禁臆造文件名：plan 里提到的文件路径必须出现在项目快照的目录树里。不确定就不要写具体路径。
5. cut 里写你认为题面中该砍掉的部分（例如重复的、与项目无关的、性价比极低的），没有就给空数组。
6. taskType 只能是 修改（要改代码/文件）、目标（要达成某个结果）、仅回答（只回答不落地）。`

/** 从模型输出里抠出 JSON 对象（容忍 ```json 围栏和前后闲话）。 */
function parseDecomposeJson(text) {
  const raw = String(text ?? '')
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced !== null ? fenced[1] : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型没有返回 JSON')
  return JSON.parse(body.slice(start, end + 1))
}

/** 把解析结果整理成合法条数 + 合法字段的数组。
 *
 * `forcedTaskType`（id=219）：父任务在面板里选定了任务类型时，拆出来的**每一条**都
 * 强制用这个类型，不再听模型的。以前这里只把类型当「倾向」写进提示词，模型照样自己
 * 给，于是「选了目标去拆解」得到的子任务大概率全是 `修改`，用户以为模式没生效。
 * 传空串 / 非法值时退回老行为（逐条认模型给的，认不出就 `修改`）。
 */
function normalizeDecomposed(parsed, min, max, forcedTaskType) {
  const list = Array.isArray(parsed?.tasks) ? parsed.tasks : []
  const forced = TASK_TYPES.includes(forcedTaskType) ? forcedTaskType : ''
  const tasks = []
  for (const entry of list) {
    if (tasks.length >= max) break
    const item = entry !== null && typeof entry === 'object' ? entry : {}
    const plan = typeof item.plan === 'string' ? item.plan.trim() : ''
    if (plan === '') continue
    const name = typeof item.name === 'string' && item.name.trim() !== '' ? item.name.trim() : autoName(plan)
    const taskType = forced !== '' ? forced : TASK_TYPES.includes(item.taskType) ? item.taskType : '修改'
    tasks.push({ name: name.slice(0, 44), plan, taskType, inherited: forced !== '' })
  }
  if (tasks.length === 0) throw new Error('模型没有拆出任何任务')
  const cut = Array.isArray(parsed?.cut) ? parsed.cut.filter((x) => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : []
  return { tasks, cut, shortOfMin: tasks.length < min, inheritedTaskType: forced }
}

/**
 * 判断一个「像文件路径」的 token 是不是占位符 / 待生成的名字，而不是真实存在的路径。
 * 例：`plan-YYYYMMDD-HHmm.md`、`export-<date>.md`、`{name}.json`、`xxx.ts`。
 * 这类 token 不该进「模型提了不存在的文件」告警。
 */
function looksLikePlaceholder(path) {
  if (/[{}<>]/.test(path)) return true
  // 只认大写/数字组成的日期时间占位（Y{2,}、D{2,}、H{2,}），故意不认小写重复，
  // 否则 `.css` 里的 `ss`、`index.mjs` 之类会被误判。
  if (/Y{2,}|D{2,}|H{2,}/.test(path)) return true
  if (/(?:^|[/\\])x{2,}\.[A-Za-z0-9]+$/i.test(path)) return true
  return false
}

/** 在任务文本里找「新建文件」的意图，命中时不该把待创建路径当成臆造。 */
const CREATE_INTENT = /新增|新建|创建|写入|生成|导出成|生成文件|落盘|写到|放到/i

/** 收集文本里出现的「像文件路径」的 token，用来做禁臆造校验。 */
function referencedPaths(text) {
  const found = String(text ?? '').match(/[\w@.\-/\\]+\.(?:js|jsx|ts|tsx|mjs|cjs|json|md|css|scss|html|py|yml|yaml|toml|sh|svg)\b/g)
  if (found === null) return []
  return [...new Set(found.map((x) => x.replace(/^\.\//, '').split('\\').join('/')))]
}

/**
 * 校验并剔除指向不存在文件的路径（返回不存在的清单）。
 *
 * 只做「提示」不做「阻断」：拆解本来就可能包含「新建某个文件」的子任务，
 * 那种路径当前当然不存在。所以这里把三类噪声排掉：
 *  - 占位符格式的名字（见 {@link looksLikePlaceholder}）；
 *  - 通配符 / URL；
 *  - 任务正文带有「新建」意图、且该路径的父目录已存在（即就地新增一个文件）。
 */
async function pruneHallucinatedPaths(cwd, tasks) {
  const missing = []
  for (const task of tasks) {
    const text = `${task.name}\n${task.plan}`
    const creating = CREATE_INTENT.test(text)
    const paths = referencedPaths(text)
    for (const p of paths) {
      if (p.includes('://') || p.includes('*')) continue
      if (looksLikePlaceholder(p)) continue
      const full = inside(cwd, p)
      if (full === undefined) continue
      if (await exists(full)) continue
      // 有「新建」意图且落点目录已经存在 → 这是计划要创建的文件，不是臆造。
      if (creating && (await exists(dirname(full)))) continue
      missing.push(p)
    }
  }
  return [...new Set(missing)]
}

/**
 * 调一次 LLM，回来拼 text-delta。
 * 不 import `@deepseek-ai/dsh-llm`（插件自己的 node_modules 里没有这个包，
 * 链接安装时按真实路径解析会 MODULE_NOT_FOUND），只靠宿主注入的服务对象。
 */
async function completeOnce(ctx, route, system, user, signal) {
  const llm = ctx.get('llm')
  if (llm === undefined || typeof llm.stream !== 'function') {
    const error = new Error('宿主 LLM 服务不可用，无法拆解')
    error.code = 'no-llm'
    throw error
  }
  const stream = llm.stream({
    provider: route.provider,
    model: route.model,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    temperature: 0,
    signal,
  })
  let text = ''
  let finish
  for await (const chunk of stream) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
    else if (chunk?.type === 'finish') finish = chunk.reason
  }
  if (typeof finish === 'string' && finish !== 'stop' && text === '') {
    throw new Error(`模型没有产出内容（finish: ${finish}）`)
  }
  if (text.trim() === '') throw new Error('模型返回了空内容')
  return text
}

/** 从会话的请求头里拿 provider / model 路由。 */
function routeOf(ctx, sessionId) {
  try {
    const session = ctx.get('sessions')?.get?.(sessionId)
    const header = session?.requestHeader?.()
    const config = header?.config
    if (config !== null && config !== undefined && typeof config.provider === 'string' && config.provider !== '' && typeof config.model === 'string' && config.model !== '') {
      return { provider: config.provider, model: config.model }
    }
  } catch {
    /* 会话不存在或没有请求头 */
  }
  return undefined
}

/** 幂等键：客户端给就用客户端的，否则按 问题 + 项目根 算一个。 */
function dedupeKeyOf(dedupeKey, question, cwd) {
  if (typeof dedupeKey === 'string' && dedupeKey.trim() !== '') return dedupeKey.trim().slice(0, 120)
  return createHash('sha1').update(`${cwd}\u0000${String(question ?? '').trim()}`).digest('hex').slice(0, 24)
}

/**
 * 解析一次请求的项目根目录：优先宿主自己的会话 cwd（防止客户端伪造），
 * 拿不到再退回客户端提示，最后退回进程 cwd。
 */
async function resolveCwd(ctx, sessionId, cwdHint) {
  if (typeof sessionId === 'string' && sessionId !== '') {
    try {
      const sessions = ctx.get('sessions')
      const session = sessions?.get?.(sessionId)
      const cwd = session?.header?.cwd
      if (typeof cwd === 'string' && isAbsolute(cwd)) return cwd
    } catch {
      /* sessions 服务不可用，退回提示值 */
    }
  }
  if (typeof cwdHint === 'string' && isAbsolute(cwdHint)) return cwdHint
  return process.cwd()
}
export {
  DECOMPOSE_SYSTEM,
  parseDecomposeJson,
  normalizeDecomposed,
  pruneHallucinatedPaths,
  completeOnce,
  routeOf,
  dedupeKeyOf,
  resolveCwd,
}
