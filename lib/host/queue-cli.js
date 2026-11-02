/**
 * 计划记账命令。插件会把本文件原样抄到项目的 `.plan/q.mjs`。
 *
 * 本文件不能 import 其它宿主模块：抄出去之后旁边没有 queue.js。
 * 模型在项目根执行 `node .plan/q.mjs <status|start|done|fail>`。
 * `done` / `fail` / `start` 只回 `{ ok, id, remaining }`，不带回下一条正文。
 * `status` 仍带 `next`（含 plan），留给用户在对话里只说「开始干活」、消息里没有任务正文的情况。
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

/**
 * 展示 / 执行顺序：先按 order 升序，再按 id **字符串**兜底。
 *
 * id=77-C：原来兜底写的是 `a.id - b.id`。id 变成 6 位随机串之后（77-B），
 * `'aB3xK9' - 'Xy12Zz'` 是 NaN，而 NaN 参与的比较不满足反对称性 ——
 * 排序结果会变成「未定义」（不同浏览器/不同数据可能给出不同顺序）。
 * 改成字符串比较，顺序才是确定的。
 *
 * 同时把「缺失 order 时拿 id 当 order 用」的旧兜底去掉：那会让
 * `a.id` 与数字 order 直接相减，同样是 NaN 来源。缺失一律读作 0。
 */
function byOrder(a, b) {
  const oa = Number.isFinite(a?.order) ? Number(a.order) : 0
  const ob = Number.isFinite(b?.order) ? Number(b.order) : 0
  if (oa !== ob) return oa - ob
  const ia = String(a?.id ?? '')
  const ib = String(b?.id ?? '')
  if (ia === ib) return 0
  return ia < ib ? -1 : 1
}

/**
 * 还能接着做的条目：未完成、不是草稿、也没有失败。
 *
 * id=272：`children` 折叠之后，父节点不是可执行任务（`plan` 为空），真正的活都在
 * children 里。这里把父展开成子：模型拿到的仍是「一条能直接做的计划」，
 * id 也是子任务的 id —— 它回填 done --id 时写的就是那一条，不需要理解层级。
 * 父自己的状态（execute / draft / failed）优先：父被搁置（草稿）时整批都不出队。
 */
function isActionable(item) {
  if (item === null || typeof item !== 'object') return false
  if (item.draft === true || item.failed === true) return false
  if (item.execute === true) return false
  // 正文为空 = 没有可做的事（id=344）。拆解批次的父节点就是这种形状：plan 留空、
  // 原文在 sourcePrompt 里、真正的活在 children 里。它的 children 全做完之后，
  // 父会留在 plan.json 里（归档要整批审完才走），此时若还把它当可执行任务，
  // 队列会永远卡在这条空壳上 —— 面板显示「待执行」，点开始却没有任何内容可做。
  // 老数据里 plan 字段可能整个缺失：那种情况不算空，避免把真任务判死。
  if (typeof item.plan === 'string' && item.plan.trim() === '') return false
  return true
}

/** 把列表摊平成「可执行叶子」：父节点换成它的 children（父自身不参与）。 */
function actionableLeaves(items) {
  const out = []
  for (const item of Array.isArray(items) ? items : []) {
    const children = Array.isArray(item?.children) ? item.children : []
    if (children.length === 0) {
      // 普通条目（没有 children 的叶子）也要过一遍可执行判定：
      // 漏掉这一句的话，一条已经 done 的普通计划会永远留在队首，
      // 每次 go 都选中它、每次 start 都报「已经完成」，队列彻底卡死（id=299 踩到）。
      if (isActionable(item)) out.push(item)
      continue
    }
    // 父被标成草稿 / 失败 / 已完成时整批一起听它的：children 的状态由父统一裁决，
    // 否则会出现「父在草稿组、子任务却排进了执行队列」这种自相矛盾的队列。
    if (item.draft === true || item.failed === true || item.execute === true) continue
    for (const child of children) {
      if (isActionable({ ...child, draft: false, failed: child.failed === true })) out.push(child)
    }
  }
  return out
}

/**
 * 队列比较器（id=340，id=77-D 修订）：**先 order，再 id 字符串，最后 children 后缀**。
 *
 * 只用 `byOrder`（order → id 相减）在子任务上会失效：`"10-C" - "10-A"` 是 NaN，
 * 比较函数返回 NaN 时排序结果依赖实现（实际就是「保持原顺序」）。而 `order` 在
 * 拆分组里通常都是同一个值（整批一起插进来），于是子任务出队顺序就变成了「数组原序」，
 * 与「children 按 A/B/C 遍历」的约定不一致。这里显式补上后缀比较。
 *
 * ── id=77-D 的两处修订 ────────────────────────────────────────────────────
 *
 * 1. **中间那层从「一级 id 数字」改成「id 字符串」。**
 *    77-B 之后 id 是 6 位随机串，`idNumber()` 对它返回 `MAX_SAFE_INTEGER` ——
 *    所有随机 id 在这一层**全部并列**，等于这一层比较完全失效，
 *    只剩最后的 suffixNumber 在起作用。而两条**独立**任务（都没有后缀，
 *    `suffixNumber` 都返回同一个兜底值）order 又恰好相同时，它们的先后
 *    就退回「数组原序」—— 那正是题面要避免的「列队漂移」。
 *    换成字符串比较后，同 order 的两条有确定的、与数组位置无关的先后。
 *
 * 2. **order 缺失时不再拿 id 数字当 order 用。**
 *    那是 NaN 的另一来源（`idNumber` 对随机 id 是 MAX_SAFE_INTEGER，
 *    于是「缺失 order」的任务永远排最后 —— 但它在数组里可能本来就在前面）。
 *    现在缺失一律读作 0，与 `order.js` 的 `orderOf` 同一口径。
 *
 * 关于「取 order 最小的待执行」：由调用方 `readyTasks` 排序后取首条实现
 * （`nextTask` = `readyTasks(items)[0]`）。**执行完只改状态，不移动、不重排数组** ——
 * 见 `applyQueueCommand` 里 done/fail 的分支：它们只改 `execute` / `review` /
 * `failed` 字段，不碰 order，也不动数组位置。
 */
function byQueueOrder(a, b) {
  const oa = Number.isFinite(a?.order) ? Number(a.order) : 0
  const ob = Number.isFinite(b?.order) ? Number(b.order) : 0
  if (oa !== ob) return oa - ob

  // 同一 order：先比后缀（同一组内的 A/B/C/AA 顺序）。
  const sa = suffixNumber(a?.id)
  const sb = suffixNumber(b?.id)
  if (sa !== sb) return sa - sb

  // 后缀也相同（独立任务，或都是组内第一条）：用 id 字符串保证确定性。
  const ia = String(a?.id ?? '')
  const ib = String(b?.id ?? '')
  if (ia === ib) return 0
  return ia < ib ? -1 : 1
}

function actionable(items) {
  return actionableLeaves(items).sort(byQueueOrder)
}

/** 一条顶层条目的「代表叶子」：有 children 取第一条子任务，否则取自己。 */
function firstLeafOf(item) {
  const kids = Array.isArray(item?.children) ? item.children : []
  return kids.length > 0 ? kids[0] : item
}

/**
 * 一级 id 的数字部分（子任务 id 是 "12-B"，取 12）；非法时退到很大，排在最后。
 *
 * id=77-B：新 id 是 6 位随机串（`aB3xK9`），`Number()` 得到 NaN，这里会退到
 * `MAX_SAFE_INTEGER` —— 也就是**所有随机 id 并列**。
 *
 * 这是可接受的，因为：
 * 1. 调用处的排序器**优先用 `order` 字段**（`Number.isFinite(a?.order)`），
 *    只有 order 缺失时才退到这里；
 * 2. order 缺失本身就是「数据不完整」的兜底场景，此时没有确定的先后可言。
 * 所以不改成字符串比较 —— 那会让 `12` 与 `aB3xK9` 混排时产生更莫名其妙的结果。
 */
function idNumber(id) {
  const head = Number(String(id ?? '').split('-')[0])
  return Number.isFinite(head) ? head : Number.MAX_SAFE_INTEGER
}

/** children 的后缀序号（A=0、B=1、AA=26）；非法时退到很大。 */
function suffixNumber(id) {
  const text = String(id ?? '')
  const at = text.indexOf('-')
  if (at < 0) return Number.MAX_SAFE_INTEGER
  const suffix = text.slice(at + 1)
  if (!/^[A-Z]+$/.test(suffix)) return Number.MAX_SAFE_INTEGER
  let n = 0
  for (const ch of suffix) n = n * 26 + (ch.codePointAt(0) - 64)
  return n - 1
}

/**
 * 取第一个未执行的任务（id=340）。
 *
 * 遍历顺序：一级任务按 `order`（缺 `order` 时按 id 数字），同一组 children 按
 * A/B/C 后缀（`12-A` 在 `12-B` 之前，`12-AA` 在 `12-B` 之后）。
 *
 * 为什么一级用 `order` 而不是裸 id：`order` 才是面板上看到的顺序，也是「置顶」的实现
 * （置顶 = 把这条的 order 挪到最前，见 `60-tab.js` 的 `pinTop`）。若这里按 id 取，
 * 用户点了置顶却去做别的条目 —— 而且会和 `actionable(items)[0]` 给出**不同的 next**，
 * 于是「面板显示的下一条」和「命令行真做的下一条」分裂。
 * 两者在正常数据上完全等价：order 是 0..n 连续时，按 order 排就是按 id 排。
 * `order` 缺失或非法时 `byOrder` 自动退到 `a.id - b.id`，仍然是指定的 id 顺序。
 *
 * 因此本函数与 `actionable(items)[0]` **必然选中同一条**（差别只在它额外返回了
 * 「属于哪个拆分组、还剩几条」）。纯同步、无 I/O、不改入参 —— 可直接单测。
 *
 * @param {Array} items 顶层条目（父 + children 或普通条目）
 * @returns {null | {
 *   task: object,                 // 任务节点本身（children 里的那一项，或顶层条目）
 *   parentId: number|null,        // 所属父的 id；不在拆分组里时为 null
 *   groupSize: number,            // 所在拆分组一共几条（普通条目为 1）
 *   groupRemaining: number,       // 这一组里还没执行的条数（**含本条**）—— 不是「本条之后还剩几条」，
 *                                 //   那个数请用 groupSize - (index + 1)，见 dispatch.js 的 buildPrompt（id=366）
 *   groupRemainingAfter: number,  // 本条做完之后这一组还剩几条（= 未执行数 - 1，不是「本条之后的位置数」）
 *   index: number                 // 在组内的位置（普通条目为 0）
 * }}
 */
/**
 * 就绪任务列表（id=346）。
 *
 * 这是「当前该做哪些」的**唯一**判定入口：输入只是一份计划数组（纯数据），
 * 输出按队列顺序排好的全部候选，每条带上它在结构里的位置。
 * 排序、父/子展开、依赖（父搁置则整批不出队）全部是确定性逻辑 —— 不看模型、
 * 不看时间、不随机，同样的输入永远同样的输出。
 *
 * 规则（与面板分组、命令行 next 完全同源）：
 * 1. 一级任务按**叶子 order**（有 children 取第一条子任务的 order）排，再按一级 id；
 * 2. 同一组的 children 按后缀 A/B/C 排（`12-A` < `12-B` < `12-AA`）；
 * 3. 草稿 / 失败 / 已完成都不出队；父被标成草稿 / 失败 / 已完成时整批不出队；
 * 4. 一级 id 相同（脏数据）时靠后缀稳定排序，不会因为数组原序而抖。
 *
 * @param {Array} items 顶层条目
 * @returns {Array<{task: object, parentId: number|null, groupSize: number,
 *   groupRemaining: number, groupRemainingAfter: number, index: number}>}
 */
function readyTasks(items) {
  const list = Array.isArray(items) ? items : []
  // 脏数据（数组里混着 null / 字符串 / 嵌套数组）不该让选任务抛异常：
  // 先把不是「带 id 的对象」的项滤掉，再排序（byQueueOrder 会读 .order）。
  const tops = list
    .filter((item) => item !== null && typeof item === 'object' && !Array.isArray(item))
    .sort((a, b) => byQueueOrder(firstLeafOf(a), firstLeafOf(b)))
  const out = []
  for (const item of tops) {
    const children = Array.isArray(item.children) ? item.children : []
    if (children.length === 0) {
      if (isActionable(item)) {
        out.push({ task: item, parentId: null, groupSize: 1, groupRemaining: 1, groupRemainingAfter: 0, index: 0 })
      }
      continue
    }
    // 父被标成草稿 / 失败 / 已完成时整批一起听它的（与 actionableLeaves 同口径）。
    if (item.draft === true || item.failed === true || item.execute === true) continue
    const kids = children
      .filter((kid) => kid !== null && typeof kid === 'object' && !Array.isArray(kid))
      .sort((a, b) => suffixNumber(a?.id) - suffixNumber(b?.id))
    const open = kids.filter((kid) => isActionable({ ...kid, draft: false, failed: kid.failed === true }))
    if (open.length === 0) continue
    // 组内每一条都进列表（而不是只给第一条）：这是「就绪任务列表」，
    // 调用方要投整组、要显示「组里还有几条」时不必再算一遍。
    for (const kid of open) {
      out.push({
        task: kid,
        parentId: item.id,
        groupSize: kids.length,
        groupRemaining: open.length,
        groupRemainingAfter: Math.max(0, open.length - 1),
        index: kids.indexOf(kid),
      })
    }
  }
  return out
}

/** 取第一条就绪任务（没有就返回 null）。`nextTask` 与 `readyTasks` 永远同源。 */
function nextTask(items) {
  return readyTasks(items)[0] ?? null
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

/** done / fail 的回执：不要带下一条的 plan。那段正文会留在会话里，和下一次派发重复。 */
function ack(items, id) {
  return { ok: true, id, remaining: actionable(items).length }
}

function snapshot(items) {
  const list = actionable(items)
  return {
    ok: true,
    remaining: list.length,
    next: list.length > 0 ? slim(list[0]) : null,
    // id=340：与 next 同一条，但带上「属于哪个拆分组、还剩几条」。
    // 直接复用 nextTask 的返回值里那几个定位字段，避免队列与派发两处各算一遍。
    group: groupOfNext(items),
  }
}

/** 只取 nextTask 里的分组信息（没有可做任务时返回 null）。 */
function groupOfNext(items) {
  const found = nextTask(items)
  if (found === null) return null
  return {
    id: found.task?.id,
    parentId: found.parentId,
    size: found.groupSize,
    remaining: found.groupRemaining,
    remainingAfter: found.groupRemainingAfter,
    index: found.index,
  }
}

/**
 * 按 id 找一条**叶子**（id=272）：父节点只当容器，命令行永远指向真正的子任务。
 *
 * 返回的仍是同一个对象引用（children 数组里的那一项），所以后面的原地改字段
 * （startedAt / note / execute）会自然写回父的 children —— 不需要额外的替换逻辑。
 */
function findItem(items, id) {
  // id=325：子任务 id 是 "<一级id>-A" 字符串，一级仍是数字 —— 统一按字符串比。
  const key = String(id)
  const same = (x) => x !== null && typeof x === 'object' && String(x.id) === key
  for (const item of Array.isArray(items) ? items : []) {
    if (same(item)) return item
    const children = Array.isArray(item?.children) ? item.children : []
    const hit = children.find(same)
    if (hit !== undefined) return hit
  }
  return undefined
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
  if (id === null || id === undefined || id === '' || (typeof id === 'number' && !(Number.isInteger(id) && id > 0))) {
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
    return { items, output: ack(items, target.id) }
  }
  if (command === 'done') {
    const started = Date.parse(typeof target.startedAt === 'string' ? target.startedAt : '')
    target.execute = true
    target.failed = false
    target.interrupted = false
    target.note = text
    target.time = Number.isFinite(started) ? Math.max(0, Date.now() - started) : 0
    return { items, output: ack(items, target.id) }
  }
  if (command === 'fail') {
    target.execute = false
    target.failed = true
    target.interrupted = false
    target.startedAt = ''
    target.note = text
    // id=77-D：**不再把 order 改到队尾**。
    //
    // 原先是 `target.order = maxOrder + 1000`（77-C 时加的），效果是「失败的条目
    // 挪到最后」。但那与「执行完只修改状态、不移动、不重排」直接矛盾：
    //   · 用户看到的队列位置会因为他看不见的一次失败而整体改变；
    //   · 连败几次之后 order 被推得很远，即使把 failed 清掉它也回不到原位；
    //   · 而且这让「顺序只由 order 决定」变成「顺序还会被运行结果改写」。
    // 失败条目本来就不会再出队（isActionable 会挡掉 failed），
    // 留在原位不影响调度，位置也更符合直觉。
    return { items, output: ack(items, target.id) }
  }
  return { items: null, output: { ok: false, error: '用法: node .plan/q.mjs <go|status|start|done|fail> [--id N] [--note 文本]' } }
}

function parseArgs(argv) {
  const command = argv[2]
  let id = null
  let note = ''
  for (let i = 3; i < argv.length; i += 1) {
    if (argv[i] === '--id') {
      // 数字 id（一级）与 "1-A"（子任务）都要原样保留，不能一律 Number()。
      {
        const raw = argv[i + 1]
        const asNumber = Number(raw)
        id = raw !== '' && Number.isInteger(asNumber) ? asNumber : String(raw)
      }
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

export { applyQueueCommand, snapshot, isActionable, nextTask, readyTasks, actionable, parseArgs }
