import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DECOMPOSE_HARD_CAP, DECOMPOSE_MIN, DECOMPOSE_SOFT_MAX, REVIEWED_LIMITS, TASK_TYPES } from './constants.js'
import {
  DECOMPOSE_SYSTEM,
  completeOnce,
  dedupeKeyOf,
  normalizeDecomposed,
  parseDecomposeJson,
  pruneHallucinatedPaths,
  resolveCwd,
  routeOf,
} from './decompose.js'
import { composeItem } from './item.js'
import { byOrder, exists, planPathOf } from './paths.js'
import { LAUNCHER_SOURCE, listeningPort, probeHost } from './restart.js'
import { pruneLegacySkill, registerVirtualSkill } from './skill.js'
import { projectSnapshot } from './snapshot.js'
import { readSettings, writeSettings } from './settings.js'
import { trimReviewed } from './trim.js'
import { autoName, normalizeItem, readPlan, toLiteItem, withPlanLock, writePlan } from './store.js'
import { isRunning, str } from './values.js'

/**
 * 所有「读—改—写」型处理函数的统一入口（id=189）。
 *
 * 两件事一次做完：
 * - 解析出项目根 `cwd`；
 * - 把它整段放进 `withPlanLock(cwd, …)`，同一个 plan.json 上的并发请求排队执行。
 *
 * 不加锁时的实际故障：两个并发 `update` 都读到 10 条，各自改一条再写回，
 * 后写的那个会把先写的那条改动整个抹掉（lost update）。侧边栏的批量审核、
 * 拖拽排序、自动刷新叠在一起时很容易撞上。
 */
const locked = async (ctx, sessionId, cwdHint, fn) => {
  const cwd = await resolveCwd(ctx, sessionId, cwdHint)
  return withPlanLock(cwd, () => fn(cwd))
}

const API = {
  /**
   * 读取项目计划状态。
   *
   * `lite: true` 时把每条计划的 `note` 换成 `noteLen` 长度标记：备注是历史执行结果，
   * 已审核条目基本不再变，却占了整份 plan.json 约七成体积。列表（尤其是每 5 秒一次的
   * 自动刷新）只需要「谁在跑 / 谁待审核 / 改没改」，不需要正文，展开某一条时再用 `detail` 取。
   */
  async read({ ctx, sessionId, cwd: cwdHint, lite }) {
    const cwd = await resolveCwd(ctx, sessionId, cwdHint)
    // 每次读都顺手清一次旧副本：幂等、开销只有两次 stat，
    // 面板打开/自动刷新时都会走到这里，用户升级插件后无需任何额外操作。
    const pruned = await pruneLegacySkill(ctx, cwd)
    const plan = await readPlan(cwd)
    // 设置随列表一起下发（id=187）：面板不必为下拉单独发一次请求，
    // 也就不会出现「列表已经刷新了、上限还是旧的」这种错位。settings.json 只有几十字节。
    const { settings } = await readSettings(cwd)
    return {
      cwd,
      planPath: plan.path,
      // 本轮清掉的旧技能副本（绝对路径），仅供排查，界面不展示。
      prunedSkills: pruned,
      planExists: plan.exists === true,
      broken: plan.broken === true,
      taskTypes: TASK_TYPES,
      settings,
      // 档位常量只存宿主一份（constants.js）：客户端的下拉选项由这里下发，
      // 免得两边各抄一个数组，将来加一档就分家。
      reviewedLimits: REVIEWED_LIMITS,
      items: lite === true ? plan.items.map(toLiteItem) : plan.items,
    }
  },

  /**
   * 读写面板设置（id=187）。不传 `patch` 就是读，传了就是「合并写回 + 回读」。
   *
   * `reviewedLimit` 只接受 REVIEWED_LIMITS 里的枚举值；非法值不报错，按技能里说的
   * 「回退为 0（无限）」处理，界面上看到的就是回退后的真实值，不会和文件不一致。
   * 一起回 `reviewedLimits` 是为了让下拉的档位由宿主决定，客户端不必再抄一份常量。
   *
   * 写了 reviewedLimit 就顺手裁一次（id=189）：把上限从 5000 调到 100，
   * 用户预期是「立刻只剩 100 条」，而不是等下一条审核通过才生效。
   * 返回值里的 `trimmed` 是这次真删掉的 id，`trimmedCount` 是数量，供界面提示。
   */
  async settings({ ctx, sessionId, cwd: cwdHint, patch }) {
    const cwd = await resolveCwd(ctx, sessionId, cwdHint)
    if (patch === undefined || patch === null) {
      const { path, settings, broken } = await readSettings(cwd)
      return { path, settings, broken, reviewedLimits: REVIEWED_LIMITS, trimmed: [], trimmedCount: 0 }
    }
    const { path, settings } = await writeSettings(cwd, patch)
    // 改设置 + 裁剪 + 落盘整段排队，否则刚裁完就被并发写把旧条目写回来。
    const trimmed = await withPlanLock(cwd, async () => {
      if (!(settings.reviewedLimit > 0)) return []
      const current = await readPlan(cwd)
      const cut = trimReviewed(current.items, settings.reviewedLimit)
      if (cut.removedCount === 0) return []
      await writePlan(cwd, cut.items)
      return cut.removed
    })
    return { path, settings, broken: false, reviewedLimits: REVIEWED_LIMITS, trimmed, trimmedCount: trimmed.length }
  },

  /** 单条计划的正文与备注（展开时按需取，避免列表轮询搬全量历史）。 */
  async detail({ ctx, sessionId, cwd: cwdHint, id }) {
    const cwd = await resolveCwd(ctx, sessionId, cwdHint)
    const current = await readPlan(cwd)
    const target = current.items.find((item) => item.id === Number(id))
    if (target === undefined) throw new Error(`计划 ${id} 不存在`)
    const sourcePrompt = str(target.sourcePrompt)
    return {
      id: target.id,
      plan: target.plan,
      note: target.note,
      hasNote: target.note !== '',
      sourcePrompt,
      hasSourcePrompt: sourcePrompt !== '',
    }
  },

  /** 首次使用时初始化 `.plan/plan.json`（技能是虚拟注册，不落盘）。 */
  async init({ ctx, sessionId, cwd: cwdHint }) {
    const cwd = await resolveCwd(ctx, sessionId, cwdHint)
    const created = []
    const planPath = planPathOf(cwd)
    await withPlanLock(cwd, async () => {
      if (await exists(planPath)) return
      await writePlan(cwd, [])
      created.push(planPath)
    })
    // 技能改成虚拟注册后（见 `registerVirtualSkill`）不再落盘：写下去下一毫秒就会被
    // `pruneLegacySkill` 删掉，纯属自找矛盾。init 现在只负责建 .plan/plan.json。
    return { cwd, created, ...await API.read({ ctx, sessionId, cwd }) }
  },

  /** 追加一条计划。`draft: true` 时作为草稿落盘。 */
  async append({ ctx, sessionId, cwd: cwdHint, plan, mode, taskType, name, draft }) {
    if (String(plan ?? '').trim() === '') throw new Error('计划内容不能为空')
    return locked(ctx, sessionId, cwdHint, async (cwd) => {
      const current = await readPlan(cwd)
      const item = composeItem(current.items, plan, mode, taskType, name, draft)
      const written = await writePlan(cwd, [...current.items, item])
      return { cwd, item, items: written.items }
    })
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
    // 原文与裁剪版分开留：`text` 去掉首尾空白，用来判空、算幂等键、拼提示词；
    // `rawPrompt` 原样保留用户敲进去的每一个字符（首尾空行、缩进一律不动），
    // 落进 `sourcePrompt` 的是它 —— 回看历史要的是「当初到底写了什么」，
    // 不是一份被我们悄悄整过形的版本。
    const rawPrompt = typeof question === 'string' ? question : ''
    const text = rawPrompt.trim()
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
    const built = normalized.tasks.map((task) =>
      // 第 8 个参数把「这次拆解用的原始提示词全文」一起写进每一条，
      // 以后回看拆解产物能知道它当初是根据什么需求拆出来的。
      // 传 `rawPrompt` 而不是 `text`：存的是用户原文，不做裁剪与重写。
      composeItem(current.items, task.plan, mode, task.taskType, `[拆] ${task.name}`, asDraft, key, rawPrompt),
    )
    // 写盘前必须重新取一次真实列表：上一次 readPlan 到现在隔了一次模型调用（几秒到几十秒），
    // 期间用户完全可能在面板里提交了新计划。拿旧 base 拼绝对会把这期间的改动覆盖掉（id=189）。
    // 顺带在锁内重查一次幂等键：两个并发的同一需求，只有一个能落盘。
    const written = await withPlanLock(cwd, async () => {
      const fresh = await readPlan(cwd)
      if (fresh.items.some((item) => item.decomposeKey === key)) {
        return { duplicate: true, items: fresh.items, created: [] }
      }
      // 台账里的 id 要基于最新列表重编号（composeItem 只看到旧 base，id 会撞车）。
      const maxId = fresh.items.reduce((max, item) => (item.id > max ? item.id : max), 0)
      const maxOrder = fresh.items.reduce((max, item) => (Number.isFinite(item.order) && item.order > max ? item.order : max), -1)
      const items = built.map((item, index) => ({ ...item, id: maxId + 1 + index, order: maxOrder + 1 + index }))
      const result = await writePlan(cwd, [...fresh.items, ...items])
      return { duplicate: false, items: result.items, created: result.items.filter((item) => item.decomposeKey === key) }
    })
    if (written.duplicate) {
      return { cwd, items: written.items, created: [], duplicate: true, note: '这份需求已经拆解过了' }
    }
    return {
      cwd,
      items: written.items,
      created: written.created,
      duplicate: false,
      cut: normalized.cut,
      missingPaths: missing,
      shortOfMin: normalized.shortOfMin,
      route,
    }
  },

  /** 批量追加（拆解模式的备用入口 / 外部脚本用）：一次写入 N 条，`draft` 决定落点。 */
  async appendMany({ ctx, sessionId, cwd: cwdHint, items: incoming, draft }) {
    return locked(ctx, sessionId, cwdHint, async (cwd) => {
      const current = await readPlan(cwd)
      const list = Array.isArray(incoming) ? incoming : []
      const built = list
        .filter((raw) => raw !== null && typeof raw === 'object' && String(raw.plan ?? '').trim() !== '')
        .map((raw) => composeItem(current.items, raw.plan, raw.mode, raw.taskType, raw.name, draft === true ? true : raw.draft === true, undefined, raw.sourcePrompt))
      if (built.length === 0) throw new Error('没有可追加的计划')
      const maxId = current.items.reduce((max, item) => (item.id > max ? item.id : max), 0)
      const maxOrder = current.items.reduce((max, item) => (Number.isFinite(item.order) && item.order > max ? item.order : max), -1)
      const items = built.map((item, index) => ({ ...item, id: maxId + 1 + index, order: maxOrder + 1 + index }))
      const written = await writePlan(cwd, [...current.items, ...items])
      return { cwd, created: items.length, items: written.items }
    })
  },

  /** 按前端拖拽后的 id 顺序重排（`ids` 为完整或部分 id 列表，未列出的保持相对顺序跟在后面）。 */
  async reorder({ ctx, sessionId, cwd: cwdHint, ids }) {
    return locked(ctx, sessionId, cwdHint, async (cwd) => {
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
    })
  },

  /** 修改一条计划的部分字段。 */
  async update({ ctx, sessionId, cwd: cwdHint, id, patch }) {
    return locked(ctx, sessionId, cwdHint, async (cwd) => {
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
      // 刚把一条审核通过 → 已审核可能超了上限，就地裁一次（id=189）。
      // 放在这里而不是只放 settings 接口：上限是「保持」的约束，不是「点一下」的动作，
      // 只在改设置时裁，之后新审核通过的条目又会一路堆上去。
      const wasReviewed = target.review === true && target.execute === true
      const nowReviewed = next.review === true && next.execute === true
      let trimmed = []
      let list = items
      if (nowReviewed && !wasReviewed) {
        const { settings } = await readSettings(cwd)
        const cut = trimReviewed(items, settings.reviewedLimit)
        trimmed = cut.removed
        list = cut.items
      }
      const written = await writePlan(cwd, list)
      return {
        cwd,
        item: written.items.find((item) => item.id === target.id),
        items: written.items,
        trimmed,
        trimmedCount: trimmed.length,
      }
    })
  },

  /** 删除一条计划。正在执行（已写 startedAt 但还没完成）的条目不允许删。 */
  async remove({ ctx, sessionId, cwd: cwdHint, id }) {
    return locked(ctx, sessionId, cwdHint, async (cwd) => {
      const current = await readPlan(cwd)
      const target = current.items.find((item) => item.id === Number(id))
      if (isRunning(target)) {
        const error = new Error(`计划 ${id} 正在执行中，不能删除`)
        error.code = 'running'
        throw error
      }
      const items = current.items.filter((item) => item.id !== Number(id))
      const written = await writePlan(cwd, items)
      return { cwd, items: written.items }
    })
  },

  /**
   * 批量删除（「已审核」组底部的「全部删除」）。
   * 正在执行中的条目一律跳过（返回 skipped），其余按 id 一次性删掉、只写一次文件。
   */
  async removeMany({ ctx, sessionId, cwd: cwdHint, ids }) {
    return locked(ctx, sessionId, cwdHint, async (cwd) => {
      const current = await readPlan(cwd)
      const wanted = new Set((Array.isArray(ids) ? ids : []).map((id) => Number(id)).filter((id) => Number.isFinite(id)))
      if (wanted.size === 0) return { cwd, removed: [], skipped: [], items: current.items }
      const removed = []
      const skipped = []
      const items = current.items.filter((item) => {
        if (!wanted.has(item.id)) return true
        if (isRunning(item)) {
          skipped.push(item.id)
          return true
        }
        removed.push(item.id)
        return false
      })
      if (removed.length === 0) return { cwd, removed, skipped, items: current.items }
      const written = await writePlan(cwd, items)
      return { cwd, removed, skipped, items: written.items }
    })
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

}

export { API }
