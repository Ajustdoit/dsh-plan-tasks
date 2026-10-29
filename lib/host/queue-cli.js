/**
 * 计划记账命令。插件会把本文件原样抄到项目的 `.plan/q.mjs`。
 *
 * 本文件不能 import 其它宿主模块：抄出去之后旁边没有 queue.js。
 * 模型在项目根执行 `node .plan/q.mjs <status|start|done|fail>`，
 * 标准输出只有一行 JSON：`{ ok, remaining, next }`。
 * next 只带下一条要做的字段，不含已完成备注和 sourcePrompt。
 */
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

function toList(parsed) {
  if (Array.isArray(parsed)) return parsed
  if (parsed !== null && typeof parsed === 'object') {
    if (Array.isArray(parsed.items)) return parsed.items
    if (typeof parsed.plan === 'string' || Number.isInteger(parsed.id)) return [parsed]
  }
  return []
}

function byOrder(a, b) {
  const oa = Number.isFinite(a.order) ? a.order : a.id
  const ob = Number.isFinite(b.order) ? b.order : b.id
  return oa === ob ? a.id - b.id : oa - ob
}

/** 还能接着做的条目：未完成、不是草稿、也没有失败。 */
function isActionable(item) {
  return item !== null
    && typeof item === 'object'
    && item.execute !== true
    && item.draft !== true
    && item.failed !== true
}

function actionable(items) {
  return items.filter(isActionable).sort(byOrder)
}

/** 给模型看的下一条：不要带历史备注和原始提示词。续做时才附上这一条自己的 note。 */
function slim(item) {
  const startedAt = typeof item.startedAt === 'string' ? item.startedAt : ''
  const out = {
    id: item.id,
    order: item.order,
    name: typeof item.name === 'string' ? item.name : '',
    plan: typeof item.plan === 'string' ? item.plan : '',
    mode: typeof item.mode === 'string' ? item.mode : '',
    taskType: typeof item.taskType === 'string' ? item.taskType : '',
    startedAt,
    resume: startedAt !== '',
  }
  if (startedAt !== '' && typeof item.note === 'string' && item.note !== '') out.note = item.note
  return out
}

function snapshot(items) {
  const list = actionable(items)
  return {
    ok: true,
    remaining: list.length,
    next: list.length > 0 ? slim(list[0]) : null,
  }
}

function findItem(items, id) {
  return items.find((item) => item !== null && typeof item === 'object' && item.id === id)
}

/**
 * 改内存里的数组。返回 `{ items, output }`。
 * `items === null` 表示这次不用写盘（status，或出错）。
 */
function applyQueueCommand(items, command, id, note) {
  if (command === 'status') return { items: null, output: snapshot(items) }
  // go = 选出下一条并开工，一次调用完成。status 再 start 会多一轮模型请求。
  if (command === 'go') {
    const next = actionable(items)[0]
    if (next === undefined) return { items: null, output: snapshot(items) }
    return applyQueueCommand(items, 'start', next.id, '')
  }
  if (!Number.isInteger(id) || id <= 0) {
    return { items: null, output: { ok: false, error: '缺少合法的 --id' } }
  }
  const target = findItem(items, id)
  if (target === undefined) {
    return { items: null, output: { ok: false, error: `计划 ${id} 不存在` } }
  }
  if (target.draft === true) {
    return { items: null, output: { ok: false, error: `计划 ${id} 是草稿，不能执行` } }
  }
  const text = typeof note === 'string' ? note : ''
  if (command === 'start') {
    if (target.execute === true) {
      return { items: null, output: { ok: false, error: `计划 ${id} 已经完成` } }
    }
    const startedAt = typeof target.startedAt === 'string' && target.startedAt !== ''
      ? target.startedAt
      : new Date().toISOString()
    target.startedAt = startedAt
    target.failed = false
    target.interrupted = false
    return { items, output: snapshot(items) }
  }
  if (command === 'done') {
    const started = Date.parse(typeof target.startedAt === 'string' ? target.startedAt : '')
    target.execute = true
    target.failed = false
    target.interrupted = false
    target.note = text
    target.time = Number.isFinite(started) ? Math.max(0, Date.now() - started) : 0
    return { items, output: snapshot(items) }
  }
  if (command === 'fail') {
    const maxOrder = items.reduce((max, item) => {
      const order = item !== null && typeof item === 'object' && Number.isFinite(item.order) ? item.order : 0
      return order > max ? order : max
    }, 0)
    target.execute = false
    target.failed = true
    target.interrupted = false
    target.startedAt = ''
    target.note = text
    target.order = maxOrder + 1
    return { items, output: snapshot(items) }
  }
  return { items: null, output: { ok: false, error: '用法: node .plan/q.mjs <go|status|start|done|fail> [--id N] [--note 文本]' } }
}

function parseArgs(argv) {
  const command = argv[2]
  let id = null
  let note = ''
  for (let i = 3; i < argv.length; i += 1) {
    if (argv[i] === '--id') {
      id = Number(argv[i + 1])
      i += 1
    } else if (argv[i] === '--note') {
      note = argv.slice(i + 1).join(' ')
      break
    }
  }
  return { command, id, note }
}

function isDirectRun() {
  const entry = process.argv[1]
  if (typeof entry !== 'string' || entry === '') return false
  return import.meta.url === pathToFileURL(resolve(entry)).href
}

async function main() {
  const { command, id, note } = parseArgs(process.argv)
  const planPath = join(dirname(fileURLToPath(import.meta.url)), 'plan.json')
  let raw
  try {
    raw = await readFile(planPath, 'utf8')
  } catch (error) {
    const missing = error !== null && typeof error === 'object' && error.code === 'ENOENT'
    const output = { ok: false, error: missing ? '还没有 .plan/plan.json' : '读取 plan.json 失败' }
    process.stdout.write(`${JSON.stringify(output)}\n`)
    process.exitCode = 1
    return
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, error: 'plan.json 不是合法 JSON' })}\n`)
    process.exitCode = 1
    return
  }
  const items = toList(parsed)
  const result = applyQueueCommand(items, command, id, note)
  if (result.output.ok !== true) process.exitCode = 1
  if (result.items !== null) {
    const body = `${JSON.stringify(result.items, null, 2)}\n`
    const tmp = `${planPath}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tmp, body, 'utf8')
    await rename(tmp, planPath)
  }
  process.stdout.write(`${JSON.stringify(result.output)}\n`)
}

if (isDirectRun()) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`)
    process.exitCode = 1
  })
}

export { applyQueueCommand, snapshot, isActionable, parseArgs }
