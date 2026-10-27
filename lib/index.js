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
import { mkdir, mkdtemp, readdir, readFile, rename, stat, writeFile, unlink } from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 计划数据目录（相对项目根）。 */
const PLAN_DIR = '.plan'
const PLAN_FILE = 'plan.json'
const SKILL_REL = join('.dsh', 'skills', 'plan-tasks', 'SKILL.md')

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
    // 拆解模式的幂等键：同一次拆解产生的 N 条共用同一个键，重复提交直接认领旧条目。
    ...typeof item.decomposeKey === 'string' && item.decomposeKey !== '' ? { decomposeKey: item.decomposeKey } : {},
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

/** 读文本文件；不存在或读不出来返回 undefined（用于区分「空文件」和「没有文件」）。 */
async function textOf(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
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
- **草稿不执行**：\`draft\` 为 \`true\` 的条目一律跳过（含拆解模式产出的 \`[拆]\` 条目），只在用户手动
  「转待执行」之后才轮到它。不要自作主张替用户把草稿转正。
- 一轮只做一条：不要一次挑好几条并行做，顺序按数组里的 \`order\`（界面从上到下）。
- 某一条执行失败（报错做不下去）时：把失败原因写进它的 \`note\`，\`execute\` **保持** \`false\`，
  然后**跳过它继续做后面剩下的**；全部结束时把失败的条目单独列出来说明。
- 回写文件时必须保留数组里的其它记录，不要丢字段、不要改其它记录的 \`id\`，也不要顺手把 \`draft\` 清掉。
- 保持 JSON 合法（UTF-8，逗号/引号正确）。
- 如果中途发现计划内容有明显矛盾/危险（比如要删库），停下来说明原因，不要硬做。
`
}

/* ------------------------------------------------------------------ *
 * 技能同步
 *
 * 插件把技能正文编译在包里（`skillMarkdown`），项目里那份 `.dsh/skills/plan-tasks/SKILL.md`
 * 只是它的一个拷贝。插件升级后项目里那份会落后，这里负责「新增写入、同名覆盖、
 * 内容一致跳过」，并在中途失败时把已改的文件还原，不留半写入状态。
 * ------------------------------------------------------------------ */

/** 插件包根目录（lib/ 的上一级），用来找随包分发的 skills/ 目录。 */
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 插件自带的技能清单：`{ rel, content }`。
 *
 * 两条来源合并：
 *  1. 代码里编译好的 `skillMarkdown()`（plan-tasks 本体，永远存在）；
 *  2. 包内 `skills/` 目录下的任意 `.md` 文件（未来加技能只要往那儿放文件，
 *     不需要改这里），按目录结构映射到项目的 `.dsh/skills/` 下，保留子目录。
 */
async function shippedSkills(cwd) {
  const list = [{ rel: SKILL_REL.split(sep).join('/'), content: skillMarkdown(cwd) }]
  const root = join(PKG_ROOT, 'skills')
  const walk = async (dir, depth) => {
    if (depth > 4) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
        continue
      }
      if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue
      const content = await textOf(full)
      if (content === undefined) continue
      // 包内 skills/ 的相对路径直接挂到 .dsh/skills/ 下面。
      const relUnderPkg = relative(root, full).split(sep).join('/')
      const rel = `${join('.dsh', 'skills').split(sep).join('/')}/${relUnderPkg}`
      if (list.some((item) => item.rel === rel)) continue
      list.push({ rel, content })
    }
  }
  await walk(root, 0)
  return list
}

/**
 * 把插件自带技能同步到项目的 `.dsh/skills/`。
 *
 * 规则：目标不存在 → 新增；存在但内容不同 → 覆盖；内容完全一致 → 跳过。
 * 写盘分两阶段：先全部写到同目录的临时文件（任何一步失败就清掉全部临时文件、原样退出），
 * 再逐个 rename 落地；rename 阶段若某个失败，已落地的按备份还原，保证「不留下半写入文件」。
 */
async function syncSkills(cwd) {
  const skills = await shippedSkills(cwd)

  const plan = []
  for (const skill of skills) {
    const rel = String(skill.rel)
    const target = inside(cwd, rel)
    if (target === undefined) throw new Error(`技能路径越出项目根目录：${rel}`)
    const body = String(skill.content)
    const current = await textOf(target)
    const action = current === undefined ? 'add' : current === body ? 'skip' : 'update'
    plan.push({ rel, target, body, action, previous: current })
  }

  const pending = plan.filter((item) => item.action !== 'skip')
  const stamp = `${process.pid}-${Date.now()}`
  const staged = []

  // 阶段一：全部写到临时文件。任何一步失败都不动目标文件。
  try {
    for (const item of pending) {
      await mkdir(dirname(item.target), { recursive: true })
      const tmp = `${item.target}.tmp-${stamp}`
      await writeFile(tmp, item.body, 'utf8')
      staged.push({ ...item, tmp })
    }
  } catch (error) {
    await Promise.all(staged.map((item) => unlink(item.tmp).catch(() => {})))
    throw new Error(`写入技能失败（未改动任何文件）：${error instanceof Error ? error.message : String(error)}`)
  }

  // 阶段二：逐个 rename 落地。中途失败则把已落地的还原成同步前的内容。
  const done = []
  try {
    for (const item of staged) {
      await rename(item.tmp, item.target)
      done.push(item)
    }
  } catch (error) {
    await Promise.all(staged.map((item) => unlink(item.tmp).catch(() => {})))
    // 还原：原来没有这个文件就删掉，原来有就写回旧内容。
    for (const item of done) {
      try {
        if (item.previous === undefined) await unlink(item.target)
        else await writeFile(item.target, item.previous, 'utf8')
      } catch {
        /* 还原失败也继续尝试后面的，尽量把现场恢复干净 */
      }
    }
    throw new Error(`落地技能失败（已还原）：${error instanceof Error ? error.message : String(error)}`)
  }

  const added = plan.filter((item) => item.action === 'add').length
  const updated = plan.filter((item) => item.action === 'update').length
  const skipped = plan.filter((item) => item.action === 'skip').length
  return {
    cwd,
    added,
    updated,
    skipped,
    total: plan.length,
    files: plan.map((item) => ({ rel: item.rel, action: item.action })),
  }
}

/* ------------------------------------------------------------------ *
 * 拆解模式：项目快照 + 一次性 LLM 调用
 *
 * 面板里的「发送」走 HTTP，不经过模型轮次，所以拆解只能由宿主自己做：
 * 收集一份截断过的项目上下文 → 调一次 LLM（temperature 0）→ 解析严格 JSON
 * → 校验（条数 / 禁臆造文件名 / 必有联合回归条目）→ 一次性写入（落点见 `draft`）。
 * ------------------------------------------------------------------ */

/** 读一个文本文件的前 n 个字符；不存在就返回空串。 */
async function headOf(cwd, name, max) {
  try {
    const text = await readFile(join(cwd, name), 'utf8')
    const flat = text.replace(/\r\n/g, '\n').trim()
    return flat.length <= max ? flat : `${flat.slice(0, max)}\n…（已截断）`
  } catch {
    return ''
  }
}

/** 目录树（只两层，跳过噪声目录），返回 `- path` 行。 */
async function treeOf(cwd) {
  const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.next', '.cache', 'coverage', '.turbo', '.venv', '__pycache__'])
  const lines = []
  const walk = async (dir, depth) => {
    if (lines.length >= SNAP_TREE_MAX || depth > 1) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
    for (const entry of entries) {
      if (lines.length >= SNAP_TREE_MAX) return
      if (SKIP.has(entry.name)) continue
      const full = join(dir, entry.name)
      const rel = relative(cwd, full).split(sep).join('/')
      lines.push(entry.isDirectory() ? `- ${rel}/` : `- ${rel}`)
      if (entry.isDirectory()) await walk(full, depth + 1)
    }
  }
  await walk(cwd, 0)
  return lines.join('\n')
}

/** 最近几条提交（取不到就空串）。 */
function gitLogOf(cwd) {
  return new Promise((done) => {
    execFile(
      'git',
      ['log', '-5', '--pretty=format:%s', '--no-color'],
      { cwd, timeout: 8000, windowsHide: true },
      (error, stdout) => {
        if (error !== null) {
          done('')
          return
        }
        const text = String(stdout).replace(/\r\n/g, '\n').trim()
        done(text.length <= SNAP_LOG_MAX ? text : text.slice(0, SNAP_LOG_MAX))
      },
    )
  })
}

/** 历史上已经做过的计划标题（帮助模型避开重复劳动）。 */
function historyOf(items) {
  const names = items
    .filter((item) => item.draft !== true)
    .slice(-30)
    .map((item) => `- #${item.id} ${item.name}`)
  const text = names.join('\n')
  return text.length <= SNAP_HISTORY_MAX ? text : `${text.slice(0, SNAP_HISTORY_MAX)}\n…（已截断）`
}

/** 汇总成一段有长度上限的项目快照。 */
async function projectSnapshot(cwd, items) {
  const [readme, agents, tree, log] = await Promise.all([
    headOf(cwd, 'README.md', SNAP_README_MAX),
    headOf(cwd, 'AGENTS.md', 1200),
    treeOf(cwd),
    gitLogOf(cwd),
  ])
  const sections = [
    ['目录树（最多两层）', tree],
    ['README.md', readme],
    ['AGENTS.md', agents],
    ['最近提交', log],
    ['历史计划标题', historyOf(items)],
  ]
    .filter(([, body]) => body !== '')
    .map(([title, body]) => `### ${title}\n${body}`)
  let out = sections.join('\n\n')
  if (out.length > SNAP_TOTAL_MAX) out = `${out.slice(0, SNAP_TOTAL_MAX)}\n…（快照已截断）`
  return out
}

const DECOMPOSE_SYSTEM = `你是一个任务拆解器。用户会把一段需求交给你，你要结合给到的项目快照，把它拆成若干条可以独立执行、彼此不重叠的子任务。

规则：
1. 只输出一个 JSON 对象，不要任何解释、不要 markdown 代码围栏。格式：
   {"tasks":[{"name":"不超过 24 字的短名","plan":"这条子任务要做什么，写全到别人能照着做","taskType":"修改|目标|仅回答"}],"cut":["题面里应该砍掉或不必要的部分"]}
2. tasks 条数控制在给定的区间内，宁可少而实，不要凑数；每条只做一件事。
3. 最后一条必须是「联合回归验证」：把所有改动串起来验证一遍。
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

/** 把解析结果整理成合法条数 + 合法字段的数组。 */
function normalizeDecomposed(parsed, min, max) {
  const list = Array.isArray(parsed?.tasks) ? parsed.tasks : []
  const tasks = []
  for (const entry of list) {
    if (tasks.length >= max) break
    const item = entry !== null && typeof entry === 'object' ? entry : {}
    const plan = typeof item.plan === 'string' ? item.plan.trim() : ''
    if (plan === '') continue
    const name = typeof item.name === 'string' && item.name.trim() !== '' ? item.name.trim() : autoName(plan)
    const taskType = TASK_TYPES.includes(item.taskType) ? item.taskType : '修改'
    tasks.push({ name: name.slice(0, 44), plan, taskType })
  }
  if (tasks.length === 0) throw new Error('模型没有拆出任何任务')
  const cut = Array.isArray(parsed?.cut) ? parsed.cut.filter((x) => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : []
  return { tasks, cut, shortOfMin: tasks.length < min }
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

/**
 * 重启用小助手：一个独立的 launcher 脚本，先等旧进程释放端口，
 * 再用「与当前进程完全相同的启动参数」重新拉起 dsh web。
 *
 * 为什么必须这样绕一圈：
 *  dsh web 的 node 进程自己就是服务宿主，`process.exit()` 之后端口立刻空出来，
 *  但没有任何东西会把它重新拉起来 —— 启动器脚本（dsh-start.ps1）跑完就直接退出，
 *  于是用户看到的现象就是「关了宿主机并没有重启」。宿主插件又没有 HMR
 *  （cordis-plugin-loader 的 exit() 是空实现），改宿主代码只能整进程重开。
 *  所以由被重启的进程在退出前先 spawn 一个游离的 launcher：它比父进程活得久，
 *  等端口空出来后自己把 dsh web 拉起来。
 */
const LAUNCHER_SOURCE = `import { spawn } from 'node:child_process'
import net from 'node:net'

const [portText, cwd, host, nodeExe, ...args] = process.argv.slice(2)
const port = Number(portText)

/** 端口上还有人在听吗（连一下就断，不发数据）。 */
function listening() {
  return new Promise((done) => {
    const socket = net.connect({ host, port })
    const finish = (value) => {
      socket.removeAllListeners()
      socket.destroy()
      done(value)
    }
    socket.setTimeout(1200, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

// 旧进程退出、端口释放都需要一点时间；最多等 30 秒，超时也照样尝试启动
// （万一旧进程卡在关闭 socket 上，宁可让新进程报端口占用，也别躺平不拉起）。
const deadline = Date.now() + 30000
while (Date.now() < deadline) {
  if (!(await listening())) break
  await new Promise((done) => setTimeout(done, 200))
}

const child = spawn(nodeExe, args, {
  cwd,
  env: process.env,
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
})
child.unref()
`

/** 选一个「端口探活」的 host：监听在具体地址上就用它，通配地址一律走回环。 */
function probeHost(ctx) {
  try {
    const host = ctx?.webServer?.host
    if (typeof host === 'string' && host !== '' && host !== '0.0.0.0' && host !== '::') return host
  } catch {
    /* 拿不到就用回环 */
  }
  return '127.0.0.1'
}

function listeningPort(ctx) {
  try {
    const port = ctx?.webServer?.port
    if (Number.isInteger(port) && port > 0) return port
  } catch {
    /* 拿不到就退回默认端口 */
  }
  return 8848
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
function composeItem(items, planText, mode, taskType, name, draft, decomposeKey) {
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
    ...typeof decomposeKey === 'string' && decomposeKey !== '' ? { decomposeKey } : {},
  })
}

/**
 * 项目里现有的技能清单（`.dsh/skills/` 下所有 `.md` 的相对路径，含子目录）。
 * 只用来在面板底部显示「技能已就绪 · N 个」，读不到就返回空数组。
 */
async function projectSkills(cwd) {
  const root = join(cwd, '.dsh', 'skills')
  const out = []
  const walk = async (dir, depth) => {
    if (depth > 4 || out.length >= 200) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
        continue
      }
      if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue
      out.push(relative(root, full).split(sep).join('/'))
    }
  }
  await walk(root, 0)
  return out
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
      // 项目里现有哪些技能（相对 .dsh/skills 的路径），底部那行据此显示「技能已就绪 · N 个」。
      skills: await projectSkills(cwd),
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

  /**
   * 拆解模式：把一段需求按项目实际情况拆成多条，一次性原子写入。
   *
   * 落到哪一组由 `draft` 决定（跟右侧「草稿」开关一致）：点亮草稿 → 全部进草稿组；
   * 没点亮 → 直接进待执行组排队。拆解产物一律带 `[拆] ` 名字前缀，转没转正都认得出。
   *
   * 幂等：同一份 `question`（或客户端指定的 `dedupeKey`）已经拆过一次就直接
   * 返回那次的结果，不会重复产生条目 —— 靠条目上的 `decomposeKey` 字段认领。
   * 原子性：先在内存里拼好整个数组、校验通过，cast 一次 `writePlan`；
   * 中途任何一步失败都不会碰磁盘。
   */
  async decompose({ ctx, sessionId, cwd: cwdHint, question, mode, taskType, min, max, dedupeKey, draft }) {
    const asDraft = draft === true
    const text = String(question ?? '').trim()
    if (text === '') throw new Error('要拆解的内容不能为空')
    const cwd = await resolveCwd(ctx, sessionId, cwdHint)
    const current = await readPlan(cwd)
    const key = dedupeKeyOf(dedupeKey, text, cwd)

    // 幂等：这次拆解已经落过盘 → 原样把旧结果还给前端，一个字节都不写。
    const prior = current.items.filter((item) => item.decomposeKey === key)
    if (prior.length > 0) {
      return { cwd, items: current.items, created: [], duplicate: true, note: '这份需求已经拆解过了' }
    }

    const route = routeOf(ctx, sessionId)
    if (route === undefined) {
      const error = new Error('拿不到当前会话的模型路由，无法拆解')
      error.code = 'no-route'
      throw error
    }
    const lo = Number.isInteger(min) && min > 0 ? Math.min(min, DECOMPOSE_HARD_CAP) : DECOMPOSE_MIN
    const hi = Number.isInteger(max) && max >= lo ? Math.min(max, DECOMPOSE_HARD_CAP) : Math.max(lo, DECOMPOSE_SOFT_MAX)

    const snapshot = await projectSnapshot(cwd, current.items)
    const taskTypeHint = TASK_TYPES.includes(taskType) ? taskType : ''
    const user = [
      `## 需求\n${text}`,
      taskTypeHint === '' ? '' : `## 用户倾向的任务类型\n${taskTypeHint}（除非明显不合适，否则沿用这个类型）`,
      `## 条数要求\n拆成 ${lo}~${hi} 条（硬上限 ${DECOMPOSE_HARD_CAP} 条）。`,
      `## 项目快照\n${snapshot}`,
    ]
      .filter((x) => x !== '')
      .join('\n\n')

    const raw = await completeOnce(ctx, route, DECOMPOSE_SYSTEM, user, new AbortController().signal)
    const parsed = parseDecomposeJson(raw)
    const normalized = normalizeDecomposed(parsed, lo, hi)
    const missing = await pruneHallucinatedPaths(cwd, normalized.tasks)

    // 一次性拼好整份数组，只写一次盘：任何一步抛错都不会留下半份结果。
    // `asDraft` 决定落点：右侧点了「草稿」→ 进草稿组；没点 → 直接进待执行排队等开工。
    const base = current.items
    const built = normalized.tasks.map((task) =>
      composeItem(base, task.plan, mode, task.taskType, `[拆] ${task.name}`, asDraft, key),
    )
    // composeItem 逐条追加时 id 会重复（它只看到 base），这里统一重编号。
    const maxId = base.reduce((max, item) => (item.id > max ? item.id : max), 0)
    const maxOrder = base.reduce((max, item) => (Number.isFinite(item.order) && item.order > max ? item.order : max), -1)
    const items = built.map((item, index) => ({ ...item, id: maxId + 1 + index, order: maxOrder + 1 + index }))
    const written = await writePlan(cwd, [...base, ...items])
    const created = written.items.filter((item) => item.decomposeKey === key)
    return {
      cwd,
      items: written.items,
      created,
      duplicate: false,
      cut: normalized.cut,
      missingPaths: missing,
      shortOfMin: normalized.shortOfMin,
      route,
    }
  },

  /** 批量追加（拆解模式的备用入口 / 外部脚本用）：一次写入 N 条，`draft` 决定落点。 */
  async appendMany({ ctx, sessionId, cwd: cwdHint, items: incoming, draft }) {
    const cwd = await resolveCwd(ctx, sessionId, cwdHint)
    const current = await readPlan(cwd)
    const list = Array.isArray(incoming) ? incoming : []
    const built = list
      .filter((raw) => raw !== null && typeof raw === 'object' && String(raw.plan ?? '').trim() !== '')
      .map((raw) => composeItem(current.items, raw.plan, raw.mode, raw.taskType, raw.name, draft === true ? true : raw.draft === true))
    if (built.length === 0) throw new Error('没有可追加的计划')
    const maxId = current.items.reduce((max, item) => (item.id > max ? item.id : max), 0)
    const maxOrder = current.items.reduce((max, item) => (Number.isFinite(item.order) && item.order > max ? item.order : max), -1)
    const items = built.map((item, index) => ({ ...item, id: maxId + 1 + index, order: maxOrder + 1 + index }))
    const written = await writePlan(cwd, [...current.items, ...items])
    return { cwd, created: items.length, items: written.items }
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

  /**
   * 真正重启 dsh web：先回包，再 spawn 一个游离的 launcher，最后自己退出。
   * 返回里的 `pid` 是被重启的旧进程，前端拿到这个响应后开始探活，等新进程上线再刷新页面。
   */
  async restart({ ctx }) {
    const port = listeningPort(ctx)
    const host = probeHost(ctx)
    const nodeExe = process.execPath
    const cwd = process.cwd()
    // argv[1] 是 dsh 的 bin.js，argv.slice(1) 原样搬给新进程，
    // 于是 --profile / --port / --no-open 这些参数一次性继承，不用在这里猜。
    const args = process.argv.slice(1)
    if (typeof nodeExe !== 'string' || nodeExe === '' || args.length === 0) {
      const error = new Error('无法确定当前 dsh 的启动命令，请手动重启')
      error.code = 'no-argv'
      throw error
    }
    const dir = await mkdtemp(join(tmpdir(), 'dsh-plan-restart-'))
    const script = join(dir, 'relaunch.mjs')
    await writeFile(script, LAUNCHER_SOURCE, 'utf8')
    // 等 HTTP 响应写完之后再启动 launcher 与退出，否则前端拿到的是网络错误而不是结果。
    setTimeout(() => {
      try {
        const child = spawn(nodeExe, [script, String(port), cwd, host, nodeExe, ...args], {
          cwd,
          env: process.env,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        })
        child.unref()
      } catch (error) {
        ctx.logger?.warn?.(`dsh-plan-tasks: 拉起重启助手失败: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      // 给 launcher 一点时间先挂上去，再放手让端口空出来。
      setTimeout(() => process.exit(0), 350)
    }, 250)
    return { restarting: true, pid: process.pid, port, host }
  },

  /** 把技能文件重新写一遍（技能内容随插件版本升级时用）。 */
  async resyncSkill({ ctx, sessionId, cwd: cwdHint }) {
    const cwd = await resolveCwd(ctx, sessionId, cwdHint)
    // 走统一的同步流程：插件里所有技能逐项比对，新增写入 / 同名覆盖 / 一致跳过。
    const result = await syncSkills(cwd)
    const primary = skillPathOf(cwd)
    return { ...result, skillPath: primary, skillExists: await exists(primary) }
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
