/**
 * dsh-plan-tasks — Host 半边
 *
 * 职责：
 *  1. 提供 `/plan-tasks/api/*` HTTP JSON 路由，供本插件的客户端页签读写
 *     项目根目录下的 `.plan/plan.json` 与 `.dsh/skills/plan-tasks/SKILL.md`。
 *  2. 仅此而已 —— 对话窗口里发出的提示与 `.plan` 完全无关：插件不监听
 *     `session/event`，不会把左侧输入框里的内容追加进 plan.json。
 *     只有「任务列表」面板里自己提交的提示才会写入 `.plan`。
 *
 * 不依赖 dsh-better-sidebar：+ 菜单里的页签注册在 Client 半边完成，
 * 装没装侧边栏插件都不影响这里的文件能力。
 */
import { mkdir, readFile, rename, stat, writeFile, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'

/** 计划数据目录（相对项目根）。 */
const PLAN_DIR = '.plan'
const PLAN_FILE = 'plan.json'
const SKILL_REL = join('.dsh', 'skills', 'plan-tasks', 'SKILL.md')

const TASK_TYPES = ['仅回答', '目标', '修改']

/** 单条计划补齐默认字段，并容忍用户手写的旧格式。 */
function normalizeItem(raw, index) {
  const item = raw !== null && typeof raw === 'object' ? raw : {}
  const id = Number.isInteger(item.id) && item.id > 0 ? item.id : index + 1
  const plan = typeof item.plan === 'string' ? item.plan : ''
  return {
    id,
    // 手工拖拽决定的展示 / 执行顺序；缺失时退回数组下标。
    order: Number.isFinite(item.order) ? Number(item.order) : index,
    name: typeof item.name === 'string' && item.name.trim() !== '' && !isStaleAutoName(item.name, plan)
      ? item.name
      : autoName(plan),
    plan,
    mode: typeof item.mode === 'string' ? item.mode : '',
    taskType: TASK_TYPES.includes(item.taskType) ? item.taskType : '目标',
    execute: item.execute === true,
    review: item.review === true,
    // 草稿：侧边栏「草稿模式」下发送的计划。不进执行队列，模型按技能跳过它。
    draft: item.draft === true,
    time: Number.isFinite(item.time) ? Number(item.time) : 0,
    note: typeof item.note === 'string' ? item.note : '',
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
    ...item.startedAt === undefined ? {} : { startedAt: item.startedAt },
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
  const plan = typeof item.plan === 'string' ? item.plan : ''
  return {
    ...item,
    plan: plan.length <= LITE_PLAN_MAX ? plan : `${plan.slice(0, LITE_PLAN_MAX)}…`,
    planLen: plan.length,
    noteLen: (typeof item.note === 'string' ? item.note : '').length,
    note: '',
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

function planPathOf(cwd) {
  return join(cwd, PLAN_DIR, PLAN_FILE)
}
function skillPathOf(cwd) {
  return join(cwd, SKILL_REL)
}

/** 把请求路径夹在项目根之内，避免越界写。 */
function inside(cwd, target) {
  const root = resolve(cwd)
  const full = resolve(root, target)
  return full === root || full.startsWith(root.endsWith(sep) ? root : root + sep) ? full : undefined
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** 展示 / 执行顺序：先按 order，再按 id 兜底。 */
function byOrder(a, b) {
  const oa = Number.isFinite(a.order) ? a.order : a.id
  const ob = Number.isFinite(b.order) ? b.order : b.id
  return oa === ob ? a.id - b.id : oa - ob
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

/** 技能正文：模型读到 SKILL.md 后按其中的流程推进 plan.json。 */
function skillMarkdown(cwd) {
  const rel = `${PLAN_DIR}/${PLAN_FILE}`
  return `---
name: plan-tasks
description: 当用户说「开始干活」时，从项目根目录 ${rel} 取出所有 execute 为 false 且不是草稿的计划，按 order 字段（即侧边栏里拖拽后的顺序）逐条执行它们，每执行完一条就回填 note、把 execute 改为 true 并重新读取文件，直到没有未完成的计划为止。
whenToUse: 用户说「开始干活」「继续干活」「执行计划」「下一条计划」等，或需要查看项目计划进度时。
---

# 计划任务执行器

项目计划文件：\`${rel}\`（JSON 数组，数组顺序即执行顺序，由 \`order\` 字段决定）。

## 数据字段

| 字段 | 含义 |
| --- | --- |
| \`id\` | 自增编号 |
| \`order\` | 排序位置（用户在侧边栏拖拽决定；0 在最上） |
| \`name\` | 很短的计划名，用于手风琴标题 |
| \`plan\` | 计划全文（要执行的提示词 / 需求描述） |
| \`mode\` | 提交时选择的模式 |
| \`taskType\` | \`仅回答\` / \`目标\` / \`修改\` |
| \`execute\` | 是否已执行完（true 表示完成） |
| \`review\` | 人工审核是否通过（true 表示已打勾） |
| \`draft\` | 是否草稿（true 表示只存着备用，**不要执行**） |
| \`time\` | 耗时（毫秒） |
| \`note\` | 执行结果回填 |
| \`createdAt\` / \`startedAt\` | ISO 时间戳 |

## 执行流程

用户说「开始干活」时，**严格一条一条串行推进**，直到文件里再没有任何 \`execute\` 为 \`false\` 且 \`draft\` 不为 \`true\` 的记录为止。

> ⚠️ **草稿（\`draft: true\`）永远跳过**：那是用户在侧边栏「草稿模式」里存下来的备忘，
> 不是待办。不要执行它、不要改它的任何字段、也不要因为它的存在而停下。

> ⚠️ **绝对不要"先读几条再一起开工"**。每次只从文件里取**一条**来做，做完写回、重新读文件、再取下一条。
> 同时开始好几条会让侧边栏的「待执行 / 进行中」状态错乱（历史事故：模型预读了 3 条，于是一次改了 3 个文件，
> 界面上只看到 1 条变"进行中"）。

1. 读取 \`${rel}\`。把 JSON 解析成数组（若单个对象则当成只含一条）。
2. **循环**下面步骤，一轮只做一条：

   **a. 挑选（只挑一条）**：按**数组顺序**（也就是 \`order\` 升序，等于用户在侧边栏里拖拽排好的顺序）取**第一条** \`execute\` 为 \`false\` 且 \`draft\` 不为 \`true\` 的记录。
   **不要**按 \`id\` 大小挑 —— \`id\` 只是编号，执行顺序以数组/order 为准。
   **不要**顺手把后面几条也一起看/一起规划。一条都没有 → 跳出循环，进入第 3 步。

   **b. 开工（先改状态，再干活）**：**第一件事**是把这**唯一一条**记录的 \`startedAt\` 写成当前时间（ISO 字符串）
   并立刻写回文件 —— 侧边栏据此显示「进行中」。**在动任何代码/文件之前先写这一步**，
   不要等做完才补，也不要等到"想清楚怎么做"之后才写，否则界面上一直看不到「正在执行」。
   写回后再按 \`taskType\` 决定执行方式：
   - \`仅回答\`：只把 \`plan\` 当成一个问题来回答，**不要**修改任何文件。
   - \`目标\`：以 \`plan\` 为**目标**推进（可能需要多步工具调用），达成目标即可，不要做计划之外的额外改动。
   - \`修改\`：\`plan\` 要求的是**改代码/改文件**，直接动手改。

   **c. 回填（先写回，再看下一条）**：把结果摘要（做了什么、改了哪些文件、遇到的问题）写进该记录的 \`note\`，
   把 \`execute\` 改为 \`true\`，把 \`time\` 写成 \`Date.now() - Date.parse(startedAt)\`（拿不到就用 0），
   把整个数组原样写回 \`${rel}\`。**写回成功后这一条才算结束**，界面上的「进行中」会随即变成「待审核」。

   **d. 重新读取**：回填后**必须重新从磁盘读取** \`${rel}\`（不要复用内存里的旧数组，
   文件可能已被侧边栏或人工改动），再回到 a 取下一条。

3. 循环结束后，汇总回复用户：这一轮一共完成了几条、分别是哪几条（id + 名称 + 一句话结果），
   并提示「请在侧边栏任务列表里逐条打勾审核」。

## 约束

- **不要做完一条就停**。只要 \`${rel}\` 里还有 \`execute\` 为 \`false\` 且 \`draft\` 不为 \`true\` 的记录，就继续做下一条，
  中途不要征求用户同意、不要问「要不要继续」。
- 一轮只做一条：不要一次挑好几条并行做，顺序按数组里的 \`order\`（界面从上到下）。
- 某一条执行失败（报错做不下去）时：把失败原因写进它的 \`note\`，\`execute\` **保持** \`false\`，
  然后**跳过它继续做后面剩下的**；全部结束时把失败的条目单独列出来说明。
- 回写文件时必须保留数组里的其它记录，不要丢字段、不要改其它记录的 \`id\`。
- 保持 JSON 合法（UTF-8，逗号/引号正确）。
- 如果中途发现计划内容有明显矛盾/危险（比如要删库），停下来说明原因，不要硬做。
`
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

async function readJsonBody(req, limit = 4 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  return JSON.parse(text)
}

function writeJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

function writeOk(res, value) {
  writeJson(res, 200, { ok: true, value })
}

function writeError(res, error, status = 500) {
  const message = error instanceof Error ? error.message : String(error)
  const code = error instanceof Error && typeof error.code === 'string' ? error.code : 'error'
  writeJson(res, status, { ok: false, error: { code, message } })
}

/** 只允许本页同源请求：Host 头必须是 loopback / 受信域，且必须带 XHR 头。 */
function requestTrusted(req) {
  const host = String(req.headers.host ?? '')
  if (host === '') return false
  let hostname
  try {
    hostname = new URL(`http://${host}`).hostname
  } catch {
    return false
  }
  const loopback =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
  if (!loopback) {
    // 非 loopback（远程访问 / 反代）时只保留同源 Origin 校验。
    const origin = req.headers.origin
    if (origin === undefined) return false
    try {
      if (new URL(origin).host !== host) return false
    } catch {
      return false
    }
  }
  if (String(req.headers['sec-fetch-site'] ?? '') === 'cross-site') return false
  const origin = req.headers.origin
  if (origin !== undefined) {
    try {
      if (new URL(origin).hostname !== hostname) return false
    } catch {
      return false
    }
  }
  return String(req.headers['x-requested-with'] ?? '').trim() === 'XMLHttpRequest'
}

/** 组装一条新计划（新条目追加到顺序末尾）。`draft: true` 时落成草稿。 */
function composeItem(items, planText, mode, taskType, name, draft) {
  const maxId = items.reduce((max, item) => (item.id > max ? item.id : max), 0)
  const maxOrder = items.reduce((max, item) => (Number.isFinite(item.order) && item.order > max ? item.order : max), -1)
  const text = String(planText ?? '')
  const type = TASK_TYPES.includes(taskType) ? taskType : '修改'
  return normalizeItem({
    id: maxId + 1,
    order: maxOrder + 1,
    name: typeof name === 'string' && name.trim() !== '' ? name.trim() : autoName(text),
    plan: text,
    mode: typeof mode === 'string' ? mode : '',
    taskType: type,
    execute: false,
    review: false,
    draft: draft === true,
    time: 0,
    note: '',
    createdAt: new Date().toISOString(),
  })
}

const API = {
  /**
   * 读取项目计划状态（含是否存在技能文件）。
   *
   * `lite: true` 时把每条计划的 `note` 换成 `noteLen` 长度标记：备注是历史执行结果，
   * 已审核条目基本不再变，却占了整份 plan.json 约七成体积。列表（尤其是每 5 秒一次的
   * 自动刷新）只需要「谁在跑 / 谁待审核 / 改没改」，不需要正文，展开某一条时再用 `detail` 取。
   */
  async read({ ctx, sessionId, cwd: cwdHint, lite }) {
    const cwd = await resolveCwd(ctx, sessionId, cwdHint)
    const plan = await readPlan(cwd)
    const skillPath = skillPathOf(cwd)
    return {
      cwd,
      planPath: plan.path,
      planExists: plan.exists === true,
      broken: plan.broken === true,
      skillPath,
      skillExists: await exists(skillPath),
      taskTypes: TASK_TYPES,
      items: lite === true ? plan.items.map(toLiteItem) : plan.items,
    }
  },

  /** 单条计划的正文与备注（展开时按需取，避免列表轮询搬全量历史）。 */
  async detail({ ctx, sessionId, cwd: cwdHint, id }) {
    const cwd = await resolveCwd(ctx, sessionId, cwdHint)
    const current = await readPlan(cwd)
    const target = current.items.find((item) => item.id === Number(id))
    if (target === undefined) throw new Error(`计划 ${id} 不存在`)
    return { id: target.id, plan: target.plan, note: target.note, hasNote: target.note !== '' }
  },

  /** 首次使用时初始化 `.plan/plan.json` 与 `.dsh/skills/plan-tasks/SKILL.md`。 */
  async init({ ctx, sessionId, cwd: cwdHint }) {
    const cwd = await resolveCwd(ctx, sessionId, cwdHint)
    const created = []
    const planPath = planPathOf(cwd)
    if (!(await exists(planPath))) {
      await writePlan(cwd, [])
      created.push(planPath)
    }
    const skillPath = skillPathOf(cwd)
    if (!(await exists(skillPath))) {
      await mkdir(dirname(skillPath), { recursive: true })
      await writeFile(skillPath, skillMarkdown(cwd), 'utf8')
      created.push(skillPath)
    }
    return { cwd, created, ...await API.read({ ctx, sessionId, cwd }) }
  },

  /** 追加一条计划。`draft: true` 时作为草稿落盘。 */
  async append({ ctx, sessionId, cwd: cwdHint, plan, mode, taskType, name, draft }) {
    const cwd = await resolveCwd(ctx, sessionId, cwdHint)
    const current = await readPlan(cwd)
    if (String(plan ?? '').trim() === '') throw new Error('计划内容不能为空')
    const item = composeItem(current.items, plan, mode, taskType, name, draft)
    const written = await writePlan(cwd, [...current.items, item])
    return { cwd, item, items: written.items }
  },

  /** 按前端拖拽后的 id 顺序重排（`ids` 为完整或部分 id 列表，未列出的保持相对顺序跟在后面）。 */
  async reorder({ ctx, sessionId, cwd: cwdHint, ids }) {
    const cwd = await resolveCwd(ctx, sessionId, cwdHint)
    const current = await readPlan(cwd)
    const wanted = Array.isArray(ids) ? ids.map(Number).filter((n) => Number.isFinite(n)) : []
    const rank = new Map(wanted.map((id, index) => [id, index]))
    const items = [...current.items].sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER
      const rb = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER
      return ra === rb ? byOrder(a, b) : ra - rb
    })
    // 必须在这里就把 order 重写成新下标：writePlan 会按 order 再排一次，
    // 否则拖拽后的位置会被旧的 order 值覆盖回去（历史 bug）。
    const renumbered = items.map((item, index) => ({ ...item, order: index }))
    const written = await writePlan(cwd, renumbered)
    return { cwd, items: written.items }
  },

  /** 修改一条计划的部分字段。 */
  async update({ ctx, sessionId, cwd: cwdHint, id, patch }) {
    const cwd = await resolveCwd(ctx, sessionId, cwdHint)
    const current = await readPlan(cwd)
    const target = current.items.find((item) => item.id === Number(id))
    if (target === undefined) throw new Error(`计划 ${id} 不存在`)
    const next = { ...target }
    if (patch !== null && typeof patch === 'object') {
      for (const key of ['name', 'plan', 'mode', 'note', 'taskType', 'startedAt']) {
        if (patch[key] !== undefined) next[key] = patch[key]
      }
      for (const key of ['execute', 'review', 'draft']) {
        if (typeof patch[key] === 'boolean') next[key] = patch[key]
      }
      if (Number.isFinite(patch.time)) next.time = Number(patch.time)
      if (Number.isFinite(patch.order)) next.order = Number(patch.order)
    }
    // 勾选完成时若还没记过耗时，用 startedAt 补上。
    if (next.execute === true && !(next.time > 0) && typeof next.startedAt === 'string') {
      const started = Date.parse(next.startedAt)
      if (Number.isFinite(started)) next.time = Math.max(0, Date.now() - started)
    }
    if (next.execute === false && patch?.clearTime === true) next.time = 0
    // 草稿被就地编辑后，标题要跟着正文重新生成（refreshName 由侧边栏在改 plan 时带上）。
    if (patch?.refreshName === true) next.name = autoName(next.plan)
    const items = current.items.map((item) => (item.id === target.id ? normalizeItem(next) : item))
    const written = await writePlan(cwd, items)
    return { cwd, item: written.items.find((item) => item.id === target.id), items: written.items }
  },

  /** 删除一条计划。正在执行（已写 startedAt 但还没完成）的条目不允许删。 */
  async remove({ ctx, sessionId, cwd: cwdHint, id }) {
    const cwd = await resolveCwd(ctx, sessionId, cwdHint)
    const current = await readPlan(cwd)
    const target = current.items.find((item) => item.id === Number(id))
    if (target !== undefined && target.execute !== true && typeof target.startedAt === 'string' && target.startedAt !== '') {
      const error = new Error(`计划 ${id} 正在执行中，不能删除`)
      error.code = 'running'
      throw error
    }
    const items = current.items.filter((item) => item.id !== Number(id))
    const written = await writePlan(cwd, items)
    return { cwd, items: written.items }
  },

  /**
   * 批量删除（「已审核」组底部的「全部删除」）。
   * 正在执行中的条目一律跳过（返回 skipped），其余按 id 一次性删掉、只写一次文件。
   */
  async removeMany({ ctx, sessionId, cwd: cwdHint, ids }) {
    const cwd = await resolveCwd(ctx, sessionId, cwdHint)
    const current = await readPlan(cwd)
    const wanted = new Set((Array.isArray(ids) ? ids : []).map((id) => Number(id)).filter((id) => Number.isFinite(id)))
    if (wanted.size === 0) return { cwd, removed: [], skipped: [], items: current.items }
    const removed = []
    const skipped = []
    const items = current.items.filter((item) => {
      if (!wanted.has(item.id)) return true
      if (item.execute !== true && typeof item.startedAt === 'string' && item.startedAt !== '') {
        skipped.push(item.id)
        return true
      }
      removed.push(item.id)
      return false
    })
    if (removed.length === 0) return { cwd, removed, skipped, items: current.items }
    const written = await writePlan(cwd, items)
    return { cwd, removed, skipped, items: written.items }
  },

  /**
   * 往当前会话真正发一条「开始干活」提示词，让模型立刻开工。
   * 侧边栏提交任务后，若此前「待执行」里一条都没有，就自动调这个接口 ——
   * 于是左侧对话里会出现那条提示词，和用户自己敲「开始干活」完全等价。
   */
  async kickoff({ ctx, sessionId, text }) {
    if (typeof sessionId !== 'string' || sessionId === '') throw new Error('缺少会话 id')
    const controller = ctx.get('sessionController')
    if (controller === undefined || typeof controller.prompt !== 'function') {
      const error = new Error('会话控制器不可用，无法自动开工')
      error.code = 'no-controller'
      throw error
    }
    const body = typeof text === 'string' && text.trim() !== '' ? text : '开始干活'
    const request = {
      // requestId 由调用方铸造并写在被接受的那条用户消息上，必须唯一。
      requestId: `plan-kickoff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: body }],
    }
    await controller.prompt(request, new AbortController().signal)
    return { accepted: true, text: body }
  },

  /** 把技能文件重新写一遍（技能内容随插件版本升级时用）。 */
  async resyncSkill({ ctx, sessionId, cwd: cwdHint }) {
    const cwd = await resolveCwd(ctx, sessionId, cwdHint)
    const path = skillPathOf(cwd)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, skillMarkdown(cwd), 'utf8')
    return { cwd, skillPath: path }
  },
}

export const inject = ['webServer']

export const name = 'dsh-plan-tasks'

export function apply(ctx) {
  // ---- HTTP JSON 路由 ----
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/plan-tasks/api',
        handler: async (req, res) => {
          if (!requestTrusted(req)) {
            writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
            return
          }
          if (req.method !== 'POST') {
            writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
            return
          }
          const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
          const method = pathname.startsWith('/plan-tasks/api/') ? pathname.slice('/plan-tasks/api/'.length) : ''
          if (method === '' || method.includes('/')) {
            writeJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown plan-tasks API method' } })
            return
          }
          const handler = Object.hasOwn(API, method) ? API[method] : undefined
          if (typeof handler !== 'function') {
            writeJson(res, 404, { ok: false, error: { code: 'not-found', message: `unknown plan-tasks API method "${method}"` } })
            return
          }
          try {
            const payload = await readJsonBody(req)
            const result = await handler({ ctx, ...payload })
            writeOk(res, result)
          } catch (error) {
            ctx.logger?.warn?.(`dsh-plan-tasks: ${method} failed: ${error instanceof Error ? error.message : String(error)}`)
            writeError(res, error)
          }
        },
      }),
    'dsh-plan-tasks: /plan-tasks/api routes',
  )
}
