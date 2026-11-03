import { DECOMPOSE_HARD_CAP, DECOMPOSE_MIN, DECOMPOSE_SOFT_MAX, TASK_TYPES } from './constants.js'
import {
  DECOMPOSE_SYSTEM,
  completeOnce,
  dedupeKeyOf,
  normalizeDecomposed,
  parseDecomposeJson,
  pruneHallucinatedPaths,
  resolveCwd,
} from './decompose.js'
import { readCatalog, resolveRoute, saveRoute } from './model-route.js'
import { archiveReviewed, readArchived, removeFromArchive, stampFinished } from './archive.js'
import { approveItem } from './auto-review.js'
import { keepNewestNotes, byNoteAge } from './trim.js'
import { writeNotes } from './notes.js'
import { findNode, removeNode, replaceNode, hasChildren } from './children.js'
import { codeOf, idKey } from './ids.js'
import { IDS_VERSION, archivedIdSet, needsRenumber, renumber, startIdAfter } from './renumber.js'
import { composeItem } from './item.js'
import { collectIds, createTaskId } from './taskid.js'
import { nextOrder, nextOrderAt, orderOf, reindexOrders } from './order.js'
import { backupPlan } from './backup.js'
import { byOrder, planPathOf } from './paths.js'
import { pruneLegacySkill, registerVirtualSkill } from './skill.js'
import { projectSnapshot } from './snapshot.js'
import { readSettings, writeSettings } from './settings.js'
import { ensureQueueCli } from './queue.js'
import { buildBatch } from './decompose-batch.js'
import { ModelCache, cacheKeyOf, cachedCall, fingerprintOf } from './model-cache.js'
import { isOrphanStart, recoverOrphanStarts } from './orphan.js'
import { buildPrompt, nextStep, remainingCount } from './dispatch.js'
import { applyCursor, forgetIds, isDelivered, markDelivered } from './cursor.js'
import { reconcileRunning, wasDispatched } from './running.js'
import { clearCursor, readCursor, writeCursor } from './dispatch-store.js'
import { autoName, mutatePlan, normalizeItem, readPlan, takeLastRepair, toLiteItem } from './store.js'
import { isRunning, str } from './values.js'

/**
 * 写型 handler 的统一外壳（id=254）。
 *
 * 只做一件事：解析项目根 `cwd`。**锁不在这里**——读、改、写三件事连同锁一起
 * 收在 store.js 的 `mutatePlan` 里，锁的边界只有那一处定义。
 *
 * 为什么不再在这里套一层锁（id=189 时的写法）：`mutatePlan` 自己会
 * `withPlanLock`，外面再包一次就是在同一把锁里等自己 —— 请求永久挂住。
 */
const direct = async (ctx, sessionId, cwdHint, fn) => {
  const cwd = await resolveCwd(ctx, sessionId, cwdHint)
  return fn(cwd)
}

/**
 * 读派发记录里的 `delivered[]`，任何失败都当成「没有记录」（id=89-C）。
 *
 * 为什么吞掉异常：这是**判定辅助数据**，不是主数据。dispatch.json 坏掉 / 不存在时，
 * 正确地做法是「当成没派发过」——宁可把一条显示成待执行（用户可以再点一次开始），
 * 也不要凭一个读不出来的文件假装它在跑。这与 dispatch-store.js 开头的克制一致。
 */
const readDeliveredQuiet = async (cwd) => {
  try {
    const { cursor } = await readCursor(cwd)
    return Array.isArray(cursor.delivered) ? cursor.delivered : []
  } catch {
    return []
  }
}

/**
 * 把一批 id 从派发游标里忘掉（id=89-B）。
 *
 * 删除任务后必须做，否则 `.plan/dispatch.json` 里会留着指向已删条目的编号：
 *   · `delivered[]` —— 「投过哪几条」，条目没了就是孤儿引用；
 *   · `groupId` —— 锁在哪一组，父被删后必须放锁，否则 `groupOpen` 一直找那个父。
 *
 * 三个刻意的选择：
 *   1. **失败不抛出** —— 删任务是主操作，游标只是记账。游标写坏了最坏是重投一次
 *      （`start` 对已有 `startedAt` 的条目是幂等的），不能让它把删除整件事回滚。
 *   2. **没有变化就不写盘** —— `forgetIds` 返回 `changed:false` 时直接返回，
 *      避免「删一条从没派发过的任务」也去动一次 dispatch.json。
 *   3. **游标文件不存在也当成正常** —— `readCursor` 已经做了这个兜底，这里不重复判断。
 */
const forgetDispatch = async (cwd, ids) => {
  try {
    const { cursor } = await readCursor(cwd)
    const { cursor: next, changed } = forgetIds(cursor, ids)
    if (!changed) return false
    await writeCursor(cwd, next)
    return true
  } catch {
    return false
  }
}

/**
 * 把 `patch` 应用到一条已归一的条目上，返回**未归一**的新对象（调用方再走 normalizeItem）。
 *
 * 从原来的 update 里原样搬出来的（id=269），因为现在有两条路要用它：
 * plan.json 里的条目、以及归档里的条目。派生规则（补耗时、清中断标记、按类型清 mode）
 * 必须只有一份，否则「同一条计划从不同入口改」会得到两种结果。
 */
const applyPatch = (target, patch) => {
  const next = { ...target }
  if (patch !== null && typeof patch === 'object') {
    for (const key of ['name', 'plan', 'mode', 'note', 'taskType', 'startedAt']) {
      if (patch[key] !== undefined) next[key] = patch[key]
    }
    // 任务类型改了、模式没显式给 → 让模式跟着类型走（id=218）。
    // 不清掉旧值的话，从「目标」切回「修改」会留着 mode:'目标'，条目照样按目标模式执行，
    // 用户会以为类型开关坏了。放在 normalizeItem 之前清，它再按新 taskType 推一次。
    if (patch.taskType !== undefined && patch.mode === undefined) next.mode = ''
    // id=405：草稿模式已移除，'draft' 不再接受外部改写（历史数据里若还带 draft，
    // 归一化时会原样保留，但没有任何 API 能再把它置真/置假）。
    for (const key of ['execute', 'review', 'interrupted', 'failed']) {
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
  // id=233：完成是终态，「已中断」只是中途的过渡标记 —— 回填完成时顺手清掉，
  // 否则一条已经审核通过的计划会带着 interrupted:true 留在文件里，
  // 下次若有人把它退回待执行，会立刻显示成「已中断」。
  if (next.execute === true && patch?.interrupted === undefined) next.interrupted = false
  // 完成视为重新开始：清掉失败标记，否则它会一直排在队列外。
  // （id=405 起不再有「把草稿转回待执行」这条路径。）
  if (next.execute === true) next.failed = false
  if (next.execute === false && patch?.clearTime === true) next.time = 0
  // 正文被改写后，标题要跟着重新生成（refreshName 由侧边栏在改 plan 时带上）。
  if (patch?.refreshName === true) next.name = autoName(next.plan)
  return next
}

/**
 * 在归档里覆盖同 id 的条目，然后按保留条数淘汰一次（id=269）。
 *
 * 只用于「条目本来就在归档里、改完仍是已审核」这条路：
 * 不能走 `archiveReviewed` —— 那个函数会把「传入列表里所有已审核条目」都当新归档，
 * 而这里的 items 来源不同，混进去会把 plan.json 的条目重复写进归档。
 *
 * 返回 `{notes, dropped, backupNeeded}`；归档读不懂时抛错（拒绝覆盖）。
 */
const replaceInArchive = async (cwd, item, noteLimit, backupWanted) => {
  const archived = await readArchived(cwd)
  if (archived.broken === true) {
    const error = new Error('notes.json 无法解析，已拒绝写入以免覆盖归档')
    error.code = 'notes-broken'
    throw error
  }
  const merged = archived.notes.map((note) => (idKey(note.id) === idKey(item.id) ? item : note))
  const stamped = stampFinishedIn(item, merged)
  const { kept, dropped } = keepNewestNotes(stamped, noteLimit)
  const droppedIds = dropped.map((note) => note.id)
  const existingIds = new Set(archived.notes.map((note) => idKey(note.id)))
  const backupNeeded = droppedIds.some((id) => existingIds.has(idKey(id)))
  if (backupNeeded && backupWanted === true) await backupPlan(cwd)
  const notes = kept.slice().sort(byNoteAge)
  await writeNotes(cwd, notes)
  return { notes, dropped: droppedIds, backupNeeded }
}

/** 给归档条目的新形态补 `finishedAt`（只在缺失且已完成时）。 */
const stampFinishedIn = (item, others) => {
  const stamped = stampFinished(item, new Date().toISOString())
  return others.map((note) => (idKey(note.id) === idKey(item.id) ? stamped : note))
}

/**
 * 这条节点（父或子）是不是这批拆解（id=272）。
 *
 * 幂等判定必须在两层都认：新格式把 `decomposeKey` 放在父上，旧格式（升级前的平铺数据）
 * 放在每条子任务上。只认一层，就会出现「同一句话又拆了一遍」或「升级后重复提交被判重」。
 */
const nodeHasKey = (item, key) => {
  if (item === null || typeof item !== 'object') return false
  if (str(item.decomposeKey) === key) return true
  return Array.isArray(item.children) && item.children.some((child) => str(child?.decomposeKey) === key)
}

/**
 * 在「plan.json + notes.json 归档」两处找一条（id=269）。
 *
 * 已审核条目搬去归档之后，凡是要按 id 找条目的地方（detail / update / remove）
 * 都必须先过这里，否则点开已审核条目会报「计划不存在」。
 */
const findAnywhere = async (cwd, id) => {
  const plan = await readPlan(cwd)
  // id=272：先按顶层找，再进 children 找 —— 展开一条子任务时也要能取到它的正文与备注。
  const hit = findNode(plan.items, id)?.item
  if (hit !== undefined) return hit
  const archived = await readArchived(cwd)
  return archived.notes.find((item) => idKey(item.id) === idKey(id))
}

/**
 * 读路径上的归档自愈（id=269）：plan.json 里若还留着已审核条目，搬进 notes.json。
 *
 * 为什么要包一层而不是让 read 直接改盘：read 是每 5 秒一次的轮询，
 * 绝大多数轮次里「没有可搬的」—— 那种情况必须一次 write 都不发。
 * `archiveReviewed` 在没有新条目时直接返回原列表（`notes: null`），这里据此判断。
 *
 * 失败不抛：归档搬不动（notes.json 坏了 / 磁盘只读）时，面板仍应能显示 plan.json
 * 里的部分。错误塞进返回值，由上层决定是否提示。
 */

/**
 * 旧编号一次性归一（id=326）。
 *
 * 只在真需要时写盘：`needsRenumber` 为 false 就直接返回原列表，一次 write 都不发 ——
 * read 是 5 秒一次的轮询，绝大多数轮次里编号早就合规了。
 *
 * 失败不抛：归一失败（磁盘只读 / 文件正被别人写）不该让面板读不出东西，
 * 下一轮轮询会再试一次。
 */
const renumberPlanIds = async (cwd, idsVersion) => {
  const current = await readPlan(cwd)
  const archived = await readArchived(cwd)
  const startId = startIdAfter(archived.notes)
  // id=385：撞号判据用「归档里实际占了哪些 id」，不再用「小于起始号」。
  // 后者会在「归档里有大号、plan 里有小号」时误判 —— 而那是最常见的正常流转
  //（一条审完归档后，归档最大号变大，plan 里其余条目的号就显得「偏小」），
  // 结果一删/一归档就把整份队列重排，模型按旧 id 回填就找不到条目了。
  const archivedIds = archivedIdSet(archived.notes)
  // 老数据（idsVersion < 2）：连「号有洞」也算不规范，按现有顺序整体重排一次。
  // 迁移之后（>= 2）：只剩真缺陷要修（重复 / 非正整数 / 与归档同号 / children 形状不对），
  // 删条目留下的洞**不再**触发顺延 —— 编号是身份，不能因为删了别的东西就变。
  const legacy = !(Number.isInteger(idsVersion) && idsVersion >= IDS_VERSION)
  if (!needsRenumber(current.items, startId, legacy, archivedIds)) {
    return { plan: current, changes: [], error: null, migrated: false }
  }
  let changes = []
  try {
    const written = await mutatePlan(cwd, ({ items }) => {
      const out = renumber(items, startId, legacy, archivedIds)
      if (out.changes.length === 0) return null
      changes = out.changes
      return out.items
    })
    return { plan: { ...current, items: written.items }, changes, error: null, migrated: changes.length > 0 }
  } catch (error) {
    return { plan: current, changes: [], error, migrated: false }
  }
}

const migrateReviewedToArchive = async (cwd, noteLimit) => {
  const current = await readPlan(cwd)
  let archived = []
  let dropped = []
  try {
    const out = await mutatePlan(cwd, async ({ items }) => {
      const result = await archiveReviewed(cwd, items, { noteLimit })
      if (result.archived.length === 0 && result.dropped.length === 0) return null
      archived = result.archived
      dropped = result.dropped
      return result.items
    })
    return { plan: { ...current, items: out.items }, archived, dropped }
  } catch (error) {
    return { plan: current, archived: [], dropped: [], error }
  }
}

/**
 * 拆解结果的缓存（id=350）。模块级单例：要跨请求活着，所以不能放在 handler 里。
 * 同一句话在 10 分钟内只问一次模型 —— 双击 / 删了重拆 / 两个页签同时点都命中同一份。
 */
const decomposeCache = new ModelCache()

/** 同一个 key 正在飞的时候，后来的请求等这一次的结果（不另开一次模型往返）。 */
const decomposeInFlight = new Map()

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
    // 面板一打开就把记账脚本放到 .plan/q.mjs，模型说「开始干活」时不用再读整份计划。
    await ensureQueueCli(cwd)
    // 每次读都顺手清一次旧副本：幂等、开销只有两次 stat，
    // 面板打开/自动刷新时都会走到这里，用户升级插件后无需任何额外操作。
    const pruned = await pruneLegacySkill(ctx, cwd)
    // 上一次写操作顺带做的自动修复结果（id=255）：只在发生的那一次回显，读完即清。
    // 界面据此提示「plan.json 损坏已修复，救回 N 条」，否则用户只会看到计划莫名其妙少了几条。
    const repair = takeLastRepair(cwd)
    // 设置随列表一起下发（id=187）：面板不必为下拉单独发一次请求，
    // 也就不会出现「列表已经刷新了、保留条数还是旧的」这种错位。settings.json 只有几十字节。
    const { settings } = await readSettings(cwd)
    // 读盘自愈（id=269）：升级后 plan.json 里还躺着升级前的已审核条目，第一次读就搬进
    // notes.json。只在真搬动了东西时写盘 —— 否则每次 5 秒轮询都会重写一次文件。
    // 这条路径放在 read 而不是等「下一次审核通过」，是因为用户不会再去点一百多条旧条目。
    // id=391：这里原本还会先跑一轮 `autoApproveOverflow`，把待审核超过阈值的
    // 那几条自动通过掉。该机制已整体移除（题面：取消自动审核）—— 审核只发生在
    // 用户点「通过」的时候，read 路径不再改动审核状态。
    const migrated = await migrateReviewedToArchive(cwd, settings.noteLimit)
    // id=326：归档搬完之后再归一编号 —— 此刻 plan.json 里只剩还在流转的条目，
    // 起始 id 可以直接接着归档的最大号，两边不会撞。
    const renumbered = await renumberPlanIds(cwd, settings.idsVersion)
    const plan = renumbered.plan
    // 迁移成功后立刻把版本记下来（id=326）：只写一次，之后每次读都走「只修真缺陷」。
    // 写在 settings.json 而不是 plan.json，是因为它描述的是「数据契约的版本」，
    // 和笔记 / 保留条数这些设置同一处，清理 plan.json 也不会把它弄丢。
    let idsVersion = settings.idsVersion
    if (renumbered.migrated && settings.idsVersion !== IDS_VERSION) {
      try {
        await writeSettings(cwd, { idsVersion: IDS_VERSION })
        idsVersion = IDS_VERSION
      } catch {
        // 写失败就保持原样：下一轮读会再试一次（重排是幂等的，不会把编号改乱）。
      }
    }
    // 回收「派发过但从未跑起来」的孤儿 startedAt（id=352-E）。
    // 不回收的话这些条目会永远被判成「执行中」，而且删不掉（isRunning 是删除闸门）。
    // 判据见 orphan.js：没产出（time=0 且无 note）且 startedAt 超过宽限。
    // id=ImWOun：宽限两档可配（settings.orphanGraceMin / orphanGraceAnswerMin）——
    // 原来硬编码 30 分钟比本仓实测最长任务（40 分钟）还短，必然误判。
    // 「仅回答」用更长的一档而不是豁免：它天然没有产出物，
    // 但直接不判会让真空转的条目永远不回收。
    // 只在真回收了东西时才写盘 —— 否则每次 5 秒轮询都会重写一次文件。
    const orphanScan = recoverOrphanStarts(plan.items, Date.now(), {
      normal: settings.orphanGraceMin * 60 * 1000,
      answer: settings.orphanGraceAnswerMin * 60 * 1000,
    })
    let liveItems = plan.items
    if (orphanScan.recovered.length > 0) {
      try {
        const written = await mutatePlan(cwd, ({ items: current }) => {
          const again = recoverOrphanStarts(current, Date.now())
          return again.recovered.length === 0 ? null : again.items
        })
        liveItems = written.items
      } catch {
        // 写失败就按内存里的结果展示：下一轮读会再试一次（回收是幂等的）。
        liveItems = orphanScan.items
      }
    }
    // 已审核条目住在 notes.json 里，但**面板看到的仍是完整列表**：
    // 归档拼在前面（最近的在前），plan.json 的条目按 order 跟在后面 ——
    // 「已审核在最上」的观感、拖拽排序、状态计数全都不变，只是数据来源分了两处。
    const archived = await readArchived(cwd)
    // 归档落盘是「从旧到新」，展示要「新的在前」，所以这里反转一次。
    // 顺序的方向只由这一行决定，存储层不掺和。
    // id=89-C：读派发游标，用「这一轮真的投过它吗」校对「执行中」。
    //
    // 不做的后果：`startedAt` 会被故意保留（id=233，为了「继续 = 续做」），
    // 于是任何曾经开工、后来没走完的条目都会永远显示「执行中」，
    // 用户看到「明明没在跑却一直转圈」，而且它还删不掉（isRunning 是删除闸门）。
    //
    // 判据：有 startedAt **且** 该 id 还在 `delivered[]` 里才算在跑。
    // 查不到就抹掉 startedAt（读投影上的，不写盘），让它回落成「待执行」。
    // 读游标失败（文件坏 / 不存在）时按「没有派发记录」处理 —— 与 dispatch-store
    // 的既有克制一致：宁可把一条显示成待执行，也不要凭残留字段假装它在跑。
    let cursorDelivered = await readDeliveredQuiet(cwd)
    const reconciled = reconcileRunning(liveItems, cursorDelivered)
    const mergedItems = [...archived.notes.slice().reverse(), ...reconciled.items]
    return {
      cwd,
      planPath: plan.path,
      notesPath: archived.path,
      notesBroken: archived.broken === true,
      // 本次自愈搬了几条 / 淘汰了几条，供排查与提示（界面暂不展示）。
      archivedNow: migrated.archived,
      droppedNow: migrated.dropped,
      // id=326：本轮重排了哪些编号（界面暂不展示，排查用）。
      renumbered: renumbered.changes,
      // 本轮回收的孤儿 startedAt（判成「已中断」的那几条），排查 / 提示用。
      recoveredOrphans: orphanScan.recovered,
      // id=89-C：本轮判定为「派发记录里查不到、已回落成待执行」的 id，排查用。
      staleRunning: reconciled.stale,
      // id=89-D：把派发记录一起下发，供客户端按 id 关联计算展示状态。
      //
      // 为什么要在界面上再算一次（服务端已经把 startedAt 抹掉了）：
      //   · 客户端拿到的是 `lite` 投影，5 秒轮询一次；服务端校对只在 read 的那一刻成立。
      //     两次轮询之间派发记录可能变（一轮跑完、下一条被投），界面要能立刻重算；
      //   · 更重要的是**可解释性**：界面自己持有「这一轮投过哪几条」，
      //     「为什么这条显示执行中」不用去猜服务端做了什么，两份数据摆在一起就能对上；
      //   · 题面要求「读取 dispatch.json 与 plan.json 后按 ID 关联计算」，
      //     这条数据就是那个"关联键"。
      //
      // 形态：id 字符串数组（与 cursor.delivered 同源，已做类型收敛）。
      // 数量不会大（DELIVERED_MAX = 200，够覆盖一个拆分组），跟着 lite 一起下发成本可忽略。
      delivered: cursorDelivered.map((x) => String(x)),
      // 本轮清掉的旧技能副本（绝对路径），仅供排查，界面不展示。
      prunedSkills: pruned,
      planExists: plan.exists === true,
      broken: plan.broken === true,
      repair,
      taskTypes: TASK_TYPES,
      settings: { ...settings, idsVersion },
      items: lite === true ? mergedItems.map(toLiteItem) : mergedItems,
    }
  },

  /**
   * 可用模型目录 + 当前生效的选择（id=363）。
   *
   * 为什么要一条独立路由：面板初始化的第一屏就要知道「用哪个模型」，
   * 而这件事原来只发生在 `decompose` 内部、且只在真发一次模型请求时才问 ——
   * 首次打开的会话里 `routeOf()` 必然拿不到东西。现在改成：
   * 面板一挂载就调这个方法，拿回目录并选出默认项，再回写设置。
   *
   * 回包里的三个字段刻意分开（见 model-route.js）：
   * - `providers` 目录本身（树：provider → models）；
   * - `selection` 最终生效的路由（永远尽量给一个）；
   * - `saved` 用户/上一轮**显式存下**的选择（没有就是 null）——
   *   客户端靠它判断「要不要替用户落一次默认」，不能拿 selection 代替。
   */
  async models({ ctx, sessionId, cwd: cwdHint }) {
    const cwd = await resolveCwd(ctx, sessionId, cwdHint)
    const snapshot = await readCatalog(ctx, sessionId, cwd)
    return { cwd, ...snapshot }
  },

  /**
   * 记住用户选中的模型（id=363）。
   *
   * 只写 settings.json 的两个键，其余设置原样保留（writeSettings 是合并写）。
   * 不校验这个模型是否真在目录里：目录可能是缓存 / 暂时问不出来，
   * 而用户刚点过的那个选择不该因为一次探测失败就被拒绝。
   */
  async selectModel({ ctx, sessionId, cwd: cwdHint, provider, model }) {
    const cwd = await resolveCwd(ctx, sessionId, cwdHint)
    const saved = await saveRoute(cwd, { provider, model })
    if (saved === null) throw new Error('provider 与 model 都是必填')
    return { cwd, selection: saved }
  },

  /**
   * 读写面板设置（id=187）。不传 `patch` 就是读，传了就是「合并写回 + 回读」。
   *
   * `noteLimit` 固定为 0：已审核只从 plan.json 搬进 notes.json，不再按条数删除。
   *
   * id=391：**「待审核自动通过」已整体移除**（含 `noteLimits` 档位下发与
   * `autoApproved` 回传）。审核现在是 100% 人工动作 —— 待审核队列有多少条就显示多少条，
   * 不会因为超过某个阈值而悄悄消失。
   *
   * `trimmed` 现在应一直是空的；留下字段是为了旧客户端还能读这个回包。
   */
  async settings({ ctx, sessionId, cwd: cwdHint, patch }) {
    const cwd = await resolveCwd(ctx, sessionId, cwdHint)
    if (patch === undefined || patch === null) {
      const { path, settings, broken } = await readSettings(cwd)
      return { path, settings, broken, trimmed: [], trimmedCount: 0 }
    }
    const { path, settings } = await writeSettings(cwd, patch)
    const backupWanted = settings.backupBeforeTrim === true
    let trimmed = []
    let backup = null
    // 第一步：归档 + 淘汰，一次做完。
    // `force: true` 是关键：即使 plan.json 里没有新条目要搬（正常情况，已审核早就不在那儿了），
    // 也要按**新档位**把归档淘汰一遍 —— 「把档位调小」本身就是一次淘汰动作。
    // 两件事必须同一个函数做完：淘汰顺序必须与归档顺序同源（见 archive.js）。
    // 搬不动的唯一原因是 notes.json 坏了：那种情况拒绝写（绝不拿空数组覆盖归档），
    // 但设置本身已经保存成功，不该因此整个请求失败。
    try {
      await mutatePlan(cwd, async ({ items }) => {
        const result = await archiveReviewed(cwd, items, {
          noteLimit: settings.noteLimit,
          backup: backupWanted,
          force: true,
        })
        if (result.archived.length === 0 && result.dropped.length === 0) return null
        trimmed = result.dropped
        if (result.backupNeeded && backupWanted) backup = await backupPlan(cwd)
        return result.items
      })
    } catch {
      // 归档搬不动时不要连设置都保存不了：设置已经写好了，
      // 这里吞掉，让下一次 update / 手动修复去处理归档。
    }
    return {
      path,
      settings,
      broken: false,
      trimmed,
      trimmedCount: trimmed.length,
      backup,
    }
  },

  /**
   * 单条计划的正文与备注（展开时按需取，避免列表轮询搬全量历史）。
   *
   * id=269 起已审核条目住在 notes.json 里，所以这里两处都找：先 plan.json，
   * 找不到再去归档。找不到才报「不存在」。
   * id=272：父节点自己不存正文（`plan` 为空），展开父节点时把 children 一起带回去 ——
   * 前端据此直接渲染子列表，不必为每条子任务各发一次 detail。
   */
  async detail({ ctx, sessionId, cwd: cwdHint, id }) {
    const cwd = await resolveCwd(ctx, sessionId, cwdHint)
    const target = await findAnywhere(cwd, id)
    if (target === undefined) throw new Error(`计划 ${id} 不存在`)
    const sourcePrompt = str(target.sourcePrompt)
    return {
      id: target.id,
      plan: target.plan,
      note: target.note,
      hasNote: target.note !== '',
      hasSourcePrompt: sourcePrompt !== '',
      sourcePrompt,
      // id=360：与列表投影（store.js 的 toLiteItem）同一口径，给每个子任务补上
      // 可展示编号。展开批次时 KidsList 优先用这份全量 children（正文没被截断），
      // 如果这里不带 code，「列表里有编号、展开后没有」就会随数据来源而闪变。
      // 只派生不落盘：`id` 仍是唯一真值。
      children: hasChildren(target)
        ? target.children.map((child) => ({ ...child, code: codeOf(child.id) }))
        : null,
    }
  },

  /** 首次使用时初始化 `.plan/plan.json`（技能是虚拟注册，不落盘）。 */
  async init({ ctx, sessionId, cwd: cwdHint }) {
    const cwd = await resolveCwd(ctx, sessionId, cwdHint)
    const created = []
    const planPath = planPathOf(cwd)
    // 统一写入口（id=254）：文件已存在就返回 null 表示「不必写」，不会重复落一次盘。
    await mutatePlan(cwd, ({ status }) => {
      if (status !== 'missing') return null
      created.push(planPath)
      return []
    })
    // 技能改成虚拟注册后（见 `registerVirtualSkill`）不再落盘：写下去下一毫秒就会被
    // `pruneLegacySkill` 删掉，纯属自找矛盾。init 现在只负责建 .plan/plan.json。
    return { cwd, created, ...await API.read({ ctx, sessionId, cwd }) }
  },

  /** 追加一条计划（id=405：原 `draft` 参数已删 —— 草稿模式移除后没有第二个落点）。 */
  async append({ ctx, sessionId, cwd: cwdHint, plan, mode, taskType, name }) {
    if (String(plan ?? '').trim() === '') throw new Error('计划内容不能为空')
    return direct(ctx, sessionId, cwdHint, async (cwd) => {
      let item = null
      // 与 appendMany 同因（id=269）：新 id 要避开归档里的 id，否则两处撞号。
      const archived = await readArchived(cwd)
      // id=77-B：改成收集归档里的全部 id 供去重（不再算「最大值」——随机 id 无大小）。
      const archivedIds = archived.notes.map((note) => note.id).filter((id) => id !== undefined && id !== null)
      const written = await mutatePlan(cwd, ({ items }) => {
        // id=77-B：id 由 makeId() 随机分配（6 位 0-9A-Za-z），不再「最大值加 1」。
        // 归档里的 id 也一并纳入去重集合 —— 归档条目将来可能被恢复回列表。
        item = { ...composeItem(items, plan, mode, taskType, name), id: createTaskId({ existing: [...collectIds(items), ...archivedIds] }) }
        return [...items, item]
      })
      return { cwd, item, items: [...archived.notes.slice().reverse(), ...written.items] }
    })
  },

  /**
   * 拆解模式：把一段需求按项目实际情况拆成多条，一次性原子写入。
   *
   * 落到哪一组（id=405：草稿开关已删，现在只有一处落点）：
   * 没点亮 → 直接进待执行组排队。拆解产物一律带 `[拆] ` 名字前缀，转没转正都认得出。
   *
   * 幂等：同一份 `question`（或客户端指定的 `dedupeKey`）已经拆过一次就直接
   * 返回那次的结果，不会重复产生条目 —— 靠条目上的 `decomposeKey` 字段认领。
   * 原子性：先在内存里拼好整个数组、校验通过，cast 一次 `writePlan`；
   * 中途任何一步失败都不会碰磁盘。
   */
  async decompose({ ctx, sessionId, cwd: cwdHint, question, mode, taskType, min, max, dedupeKey, deep }) {
    // id=405：原 `draft` / `asDraft` 已删 —— 拆解产物一律进待执行。
    // 原文与裁剪版分开留：`text` 去掉首尾空白，用来判空、算幂等键、拼提示词；
    // `rawPrompt` 原样保留用户敲进去的每一个字符（首尾空行、缩进一律不动），
    // 落进 `sourcePrompt` 的是它 —— 回看历史要的是「当初到底写了什么」，
    // 不是一份被我们悄悄整过形的版本。
    const rawPrompt = typeof question === 'string' ? question : ''
    const text = rawPrompt.trim()
    if (text === '') throw new Error('要拆解的内容不能为空')
    // id=262：深入模式以前在拆解分支里被整个丢掉。现在它是拆解的一个入参：
    // 打开后要求模型把每一条子任务都按「做深而不是做大」来写（见下面的 ## 深入要求）。
    // 它必须参与幂等键 —— 同一句话「普通拆」和「深入拆」是两份不同的产物，
    // 不区分的话第二次会被当成重复直接还回上一次的结果，用户会以为开关没生效。
    const deepMode = deep === true
    const cwd = await resolveCwd(ctx, sessionId, cwdHint)
    const current = await readPlan(cwd)
    const key = dedupeKeyOf(dedupeKey, deepMode ? `${text}\u0000深入` : text, cwd)

    // 幂等：这次拆解已经落过盘 → 原样把旧结果还给前端，一个字节都不写。
    // id=272：新格式的键在父上，旧格式在子任务上，两层都要认（见 nodeHasKey）。
    const prior = current.items.filter((item) => nodeHasKey(item, key))
    if (prior.length > 0) {
      return { cwd, items: current.items, created: [], parent: prior[0] ?? null, duplicate: true, note: '这份需求已经拆解过了' }
    }

    const route = await resolveRoute(ctx, sessionId, cwd)
    if (route === undefined) {
      const error = new Error('拿不到当前会话的模型路由，也无法从默认模型或可用模型列表推断出可用模型')
      error.code = 'no-route'
      throw error
    }
    const lo = Number.isInteger(min) && min > 0 ? Math.min(min, DECOMPOSE_HARD_CAP) : DECOMPOSE_MIN
    const hi = Number.isInteger(max) && max >= lo ? Math.min(max, DECOMPOSE_HARD_CAP) : Math.max(lo, DECOMPOSE_SOFT_MAX)

    const snapshot = await projectSnapshot(cwd, current.items)
    // 父任务选定的任务类型（id=219）：有值就**强制**套到每一条子任务上，
    // 不再只是「倾向」。用户选「目标」去拆解，期望的就是每条子任务都按目标模式执行。
    const forcedTaskType = TASK_TYPES.includes(taskType) ? taskType : ''
    const taskTypeHint = forcedTaskType
    const user = [
      `## 需求\n${text}`,
      taskTypeHint === ''
        ? ''
        : `## 任务类型（强制）\n这一批子任务的 taskType 一律填 \`${taskTypeHint}\`，不要自己改判。`,
      deepMode
        ? [
            '## 深入要求（强制）',
            '用户打开了「深入模式」：他要的是把这件事做深，而不是把范围摊大。因此：',
            '1. 每一条子任务的 plan 都要写清「怎么做才算做到位」，而不是只写「做什么」；',
            '2. 单条宁可小而深，不要靠加条数来覆盖需求；不许因为「深入」就把范围拆得更碎；',
            '3. plan 里要包含可验证的完成标准（改完看什么、跑到什么程度算过）；',
            '4. 不确定的材料/文件不要臆造，写「先确认 X」而不是编一个路径。',
          ].join('\n')
        : '',
      `## 条数要求\n拆成 ${lo}~${hi} 条（硬上限 ${DECOMPOSE_HARD_CAP} 条）。`,
      `## 项目快照\n${snapshot}`,
    ]
      .filter((x) => x !== '')
      .join('\n\n')

    // id=350：先看缓存 / 并发合并。key 里带上问题、模式、条数、项目根与快照指纹 ——
    // 任何一项不同都必须重新问模型（同一个问题在不同版本的项目里结果本就该不同）。
    const cacheKey = cacheKeyOf({
      question: text,
      mode,
      taskType: taskTypeHint,
      min: lo,
      max: hi,
      deep: deepMode,
      cwd,
      // 指纹用「剥掉 .plan/ 记账文件」之后的快照：拆解自己会改 .plan/ 下的文件，
      // 把它们算进 key 会让缓存永远不命中（见 fingerprintOf 的注释）。
      snapshotFingerprint: fingerprintOf(snapshot),
    })
    const raw = await cachedCall(
      decomposeCache,
      cacheKey,
      (signal) => completeOnce(ctx, route, DECOMPOSE_SYSTEM, user, signal),
      { inFlight: decomposeInFlight },
    )
    const modelText = typeof raw.value === 'string' ? raw.value : String(raw.value ?? '')
    // id=350：命中缓存 / 合并到别人那次请求，都不再产生一次模型往返。
    // 界面据此把「拆解中」的措辞换成「复用上次结果」，用户不用怀疑为什么这么快。
    const cacheHit = raw.cached === true
    const cacheMerged = raw.merged === true
    const parsed = parseDecomposeJson(modelText)
    // 即使模型没听话，normalizeDecomposed 也会把类型强压回父任务的选择。
    const normalized = normalizeDecomposed(parsed, lo, hi, forcedTaskType)
    const missing = await pruneHallucinatedPaths(cwd, normalized.tasks)

    // 一次性拼好整份数组，只写一次盘：任何一步抛错都不会留下半份结果。
    // id=405：原 `asDraft` 决定落点的分支已删 —— 草稿组不存在，产物一律进待执行。
    // id=272：拆解产物不再平铺成 N 条，而是「一个父 + children」。父的 plan 留空（不是可执行任务），
    // 原始提示词只存在父上 —— 以前同一份原文在每条子任务上各存一份，290 条的 plan.json
    // 里有 50 多份重复全文，这是 is=269 之后仍然最大的冗余来源。
    const built = normalized.tasks.map((task) =>
      composeItem(current.items, task.plan, mode, task.taskType, `[拆] ${task.name}`, key, ''),
    )
    // 写盘前必须重新取一次真实列表：上一次 readPlan 到现在隔了一次模型调用（几秒到几十秒），
    // 期间用户完全可能在面板里提交了新计划。拿旧 base 拼绝对会把这期间的改动覆盖掉（id=189）。
    // 顺带在锁内重查一次幂等键：两个并发的同一需求，只有一个能落盘。
    // 模型调用必须在锁外（几十秒会堵死整个面板），所以「锁外算、锁内重读再拼」的形状不变，
    // 只是拼装这一步收进统一写入口（id=254）。
    let duplicate = false
    // 新 id 要避开归档（id=269），否则会和已审核条目撞号。
    const archived = await readArchived(cwd)
    // id=77-B：改成收集归档里的全部 id 供去重（不再算「最大值」——随机 id 无大小）。
    const archivedIds = archived.notes.map((note) => note.id).filter((id) => id !== undefined && id !== null)
    const written = await mutatePlan(cwd, ({ items: fresh }) => {
      // 幂等键可能在父上（新格式），也可能在子任务上（旧格式）—— 两种都要认。
      if (fresh.some((item) => nodeHasKey(item, key))) {
        duplicate = true
        return null
      }
      // 台账里的 id 要基于最新列表（含父与子）重编号：composeItem 只看到旧 base，id 会撞车。
      // id=77-B：父 id 改为随机分配（不再「最大值 + 1」）。去重集合要含当前列表与归档。
      // id=77-C：order 统一由 order.js 算（步长 1000）。
      // id=325/347：父拿一个全新的 id，子任务 id 由它派生（"<父id>-A/B/C"）。
      // 拼装（id / order / children 归属 / 默认字段）全部交给 buildBatch —— 纯函数，
      // 同样的输入永远同样的输出，时间戳由这里传进去（函数自己不读时钟）。
      const parentId = createTaskId({ existing: [...collectIds(fresh), ...archivedIds] })
      const { parent } = buildBatch(built, {
        parentId,
        order: nextOrder(fresh),
        createdAt: new Date().toISOString(),
        // 父标题 = 原始提示词压缩成一行（与 autoName 同一口径），一眼能认出这批是哪句话拆的。
        name: autoName(rawPrompt),
        // id=405：父节点不再带 draft（buildBatch 默认 false）。
        decomposeKey: key,
        // 原文只存这一份：子任务不再各存一遍。
        sourcePrompt: rawPrompt,
      })
      return [...fresh, parent]
    })
    // 归档落盘是从旧到新，这里拼面板列表要「新的在前」，所以反转一次（与 read 同口径）。
    const merged = [...archived.notes.slice().reverse(), ...written.items]
    if (duplicate) {
      return { cwd, items: merged, created: [], duplicate: true, note: '这份需求已经拆解过了' }
    }
    // 新落的这一批（父 + children）按幂等键从最新列表里挑回来 ——
    // `mutatePlan` 只回传 `{ skipped, path, items }`，没有 `created` 字段（id=254 的坑）。
    // id=272：`created` 仍是「子任务」列表（前端只关心「拆成了几条」），
    // 客户端的 count / cut / missingPaths 全部沿用旧语义，不必跟着改。
    const parent = written.items.find((item) => nodeHasKey(item, key))
    const created = Array.isArray(parent?.children) ? parent.children : []
    return {
      cwd,
      items: merged,
      created,
      parent: parent ?? null,
      duplicate: false,
      cut: normalized.cut,
      missingPaths: missing,
      shortOfMin: normalized.shortOfMin,
      deep: deepMode,
      // id=350：这一次是命中缓存（true）还是合并到并发的那次请求（merged）。
      cached: cacheHit,
      merged: cacheMerged,
      route,
    }
  },

  /** 批量追加（外部脚本用）：一次写入 N 条，一律进待执行（id=405：原 `draft` 参数已删）。 */
  async appendMany({ ctx, sessionId, cwd: cwdHint, items: incoming }) {
    return direct(ctx, sessionId, cwdHint, async (cwd) => {
      let count = 0
      // 新条目的 id 要避开归档里的那些（id=269）：plan.json 里已经不含已审核条目，
      // 它的 maxId 因此可能比归档里的 id 小 —— 只看 plan.json 就会重号，
      // 重号后「按 id 找一条」会在两处撞车。
      const archived = await readArchived(cwd)
      // id=77-B：改成收集归档里的全部 id 供去重（不再算「最大值」——随机 id 无大小）。
      const archivedIds = archived.notes.map((note) => note.id).filter((id) => id !== undefined && id !== null)
      const written = await mutatePlan(cwd, ({ items: current }) => {
        const list = Array.isArray(incoming) ? incoming : []
        const built = list
          .filter((raw) => raw !== null && typeof raw === 'object' && String(raw.plan ?? '').trim() !== '')
          // id=405：不再从 `draft` 参数或条目自身读草稿位；每条都按普通计划落盘。
          .map((raw) => composeItem(current, raw.plan, raw.mode, raw.taskType, raw.name, undefined, raw.sourcePrompt))
        if (built.length === 0) throw new Error('没有可追加的计划')
        // id=77-B：每条都随机分配 id 并去重（含归档）。不再「最大值 + 1 + 序号」——
        // 那个写法靠 id 单调递增，随机串没有这个性质。
        const taken = [...collectIds(current), ...archivedIds]
        // id=77-C：同批条目之间也留 1000 的间隙（nextOrderAt）。
        const items = built.map((item, index) => {
          // id=5-B：统一入口内含批内去重，不再手工 push
          const id = createTaskId({ existing: taken })
          taken.push(id)
          return { ...item, id, order: nextOrderAt(current, index) }
        })
        count = items.length
        return [...current, ...items]
      })
      return { cwd, created: count, items: [...archived.notes.slice().reverse(), ...written.items] }
    })
  },

  /**
   * 按前端拖拽后的 id 顺序重排（`ids` 为完整或部分 id 列表，未列出的保持相对顺序跟在后面）。
   *
   * id=272：可拖拽的只有顶层条目（父 / 普通计划），子任务不参与排序 ——
   * 传进来的 id 若是子任务，它会被当作「未列出」落在最后，不会破坏父内部的顺序。
   */
  async reorder({ ctx, sessionId, cwd: cwdHint, ids }) {
    return direct(ctx, sessionId, cwdHint, async (cwd) => {
      const written = await mutatePlan(cwd, ({ items: current }) => {
        // id=77-B：这里原本是 `ids.map(Number)` —— 把 id 转成数字当 Map 的键。
        // 换成 6 位随机串后 Number('aB3xK9') 是 NaN，全部被 filter 掉，
        // 拖拽排序会彻底失效（所有条目都排到 MAX_SAFE_INTEGER，位置不变）。
        // 改用 idKey 统一成文本键，数字 id 与字符串 id 都一视同仁。
        const wanted = Array.isArray(ids) ? ids.filter((id) => id !== null && id !== undefined).map(idKey) : []
        const rank = new Map(wanted.map((id, index) => [id, index]))
        const items = [...current].sort((a, b) => {
          const ra = rank.has(idKey(a.id)) ? rank.get(idKey(a.id)) : Number.MAX_SAFE_INTEGER
          const rb = rank.has(idKey(b.id)) ? rank.get(idKey(b.id)) : Number.MAX_SAFE_INTEGER
          return ra === rb ? byOrder(a, b) : ra - rb
        })
        // 必须在这里就把 order 重写：writePlan 会按 order 再排一次，
        // 否则拖拽后的位置会被旧的 order 值覆盖回去（历史 bug）。
        // id=77-C：用 reindexOrders 而非 index —— 保留 1000 的间隙，
        // 这样下次插入不必重编号后面全部条目。
        return reindexOrders(items)
      })
      return { cwd, items: written.items }
    })
  },

  /**
   * 按 `[{id, order}]` 逐条重写 order（id=fzTvER-E）。
   *
   * ── 与 reorder 的区别 ────────────────────────────
   * | | `reorder` | `applyOrders`（本接口）|
   * | --- | --- | --- |
   * | 入参 | `ids[]`（顺序即 rank）| `[{id, order}]`（显式给定 order 值）|
   * | 做什么 | 按 rank **重排数组**，再用 `reindexOrders` 重编号 | **只改 order 字段**，数组顺序交给 writePlan |
   * | 谁决定 order 值 | 宿主（`(index+1)*ORDER_STEP`）| **调用方** |
   *
   * `reorder` 适合「拖一下就整表重排」；本接口适合「已经算好了每条该是
   * 多少 order」的场景（比如客户端按自己的规则算出新序，只想让宿主原样落盘）。
   *
   * ── 硬约束（题面）────────────────────────────
   * 1. **只改 order**：其余字段一律不动（用 `{...item, order}` 而不是 `normalizeItem`，
   *    后者会补默认值、可能改动别的字段）。
   * 2. **按 id 定位**：找不到的 id 直接跳过，不报错 —— 调用方可能拿了旧列表，
   *    其中有的条目已经被删掉；为一条不存在的条目让整批失败不划算。
   * 3. **id 不动**：改的是 order，id 原样保留。序号由 order 派生
   *    （见 `order.js` 的 `sequenceOf`），不写进条目。
   * 4. 写盘走 `mutatePlan`（与其余写操作同一条路径，含锁、坏文件修复、原子写）。
   *
   * @param orders `[{id, order}]`；order 非有限数字的项忽略
   */
  async applyOrders({ ctx, sessionId, cwd: cwdHint, orders }) {
    return direct(ctx, sessionId, cwdHint, async (cwd) => {
      // 先把入参规整成 Map：id → order。
      // 用 idKey 统一成文本键（数字 id 与随机字符串 id 一视同仁），
      // 与 reorder 里那处同口径 —— 直接拿 id 当 Map 键会让 `12` 与 `'12'` 对不上。
      const wanted = new Map()
      for (const row of Array.isArray(orders) ? orders : []) {
        if (row === null || typeof row !== 'object') continue
        if (row.id === null || row.id === undefined) continue
        const key = idKey(row.id)
        if (key === '') continue
        if (!Number.isFinite(row.order)) continue
        wanted.set(key, Number(row.order))
      }
      if (wanted.size === 0) {
        // 没有任何有效项：不写盘（避免一次无意义的 IO），原样返回现状。
        const current = await readPlan(cwd)
        return { cwd, items: current.items, updated: 0 }
      }
      let updated = 0
      const written = await mutatePlan(cwd, ({ items: current }) => {
        let dirty = false
        const next = current.map((item) => {
          if (item === null || typeof item !== 'object') return item
          const key = idKey(item.id)
          if (!wanted.has(key)) return item
          const order = wanted.get(key)
          // 值没变就不动它 —— 返回同一个引用，让 dirty 保持 false。
          if (orderOf(item.order) === order) return item
          dirty = true
          updated += 1
          // id=fzTvER-E：**只**铺 order。不要用 normalizeItem（它会补默认值、
          // 可能顺带改动别的字段），也不改 id。
          return { ...item, order }
        })
        // 没有任何变化就返回 null：mutatePlan 据此跳过写盘。
        return dirty ? next : null
      })
      return { cwd, items: written.items, updated }
    })
  },

  /**
   * 修改一条计划的部分字段。
   *
   * id=269 起条目可能住在两处（plan.json / notes.json 归档），所以这里分两条路：
   * - 在 plan.json：照旧改，改完如果变成「已审核」就顺手归档（保留条数同时生效）；
   * - 只在归档里：先按补丁算出新形态，**仍是已审核**就留在归档（同 id 覆盖）；
   *   被改回未审核（取消审核、转草稿、转待执行）则搬回 plan.json，并从归档摘掉。
   * 两种情况下的落盘顺序都是「先写 plan.json 再调归档」，这样中途失败最坏是
   * 短暂重复（read 会按 id 去重），而不是条目凭空消失。
   */
  async update({ ctx, sessionId, cwd: cwdHint, id, patch }) {
    return direct(ctx, sessionId, cwdHint, async (cwd) => {
      const { settings } = await readSettings(cwd)
      const backupWanted = settings.backupBeforeTrim === true
      let trimmed = []
      let backup = null
      let targetId = id

      // 先看它在不在 plan.json：不在就走归档那条路。
      // id=272：可能是一条子任务（住在某个父的 children 里），所以用 findNode 而不是 find。
      const snapshot = await readPlan(cwd)
      const inPlan = findNode(snapshot.items, id) !== null
      if (!inPlan) {
        const archived = await readArchived(cwd)
        const target = archived.notes.find((item) => idKey(item.id) === idKey(id))
        if (target === undefined) throw new Error(`计划 ${id} 不存在`)
        targetId = target.id
        const next = normalizeItem(applyPatch(target, patch))
        if (next.execute === true && next.review === true && next.draft !== true) {
          // 仍是已审核：留在归档，同 id 覆盖，再按档位淘汰一次。
          const out = await replaceInArchive(cwd, next, settings.noteLimit, backupWanted)
          trimmed = out.dropped
          if (out.backupNeeded && backupWanted) backup = await backupPlan(cwd)
          const current = await readPlan(cwd)
          return {
            cwd,
            item: next,
            items: [...out.notes, ...current.items],
            trimmed,
            trimmedCount: trimmed.length,
            backup,
          }
        }
        // 被改回未审核：搬回 plan.json（先写它），再从归档摘掉。
        const written = await mutatePlan(cwd, ({ items }) => {
          // id=77-B：原本「没有 id 就取最大值 + 1」。现在只有「原条目根本没有 id」才需要新分配，
          // 且必须避开当前列表（搬回来的那条原本不在列表里，理论上不撞，但仍按同一套规则走）。
          const keepId = next.id !== undefined && next.id !== null && idKey(next.id) !== ''
          // id=77-C：搬回来放末尾，同样用步长 1000。
          const moved = { ...next, id: keepId ? next.id : createTaskId({ existing: collectIds(items) }), order: nextOrder(items) }
          return [...items, moved]
        })
        await removeFromArchive(cwd, [id])
        const archived2 = await readArchived(cwd)
        return {
          cwd,
          item: written.items.find((item) => idKey(item.id) === idKey(targetId)) ?? next,
          items: [...archived2.notes.slice().reverse(), ...written.items],
          trimmed: [],
          trimmedCount: 0,
          backup: null,
        }
      }

      // 在 plan.json：原路径不变，末尾把「刚变成已审核」的条目归档。
      const written = await mutatePlan(cwd, async ({ items: current }) => {
        // id=272：父与子都可能是修改对象。`replaceNode` 按 id 换掉那一条（子任务就地替换
        // 在父的 children 里），父的标题 / 状态不跟着变 —— 父是容器，不该被子任务的状态改写。
        const found = findNode(current, id)
        if (found === null) throw new Error(`计划 ${id} 不存在`)
        targetId = found.item.id
        const next = normalizeItem(applyPatch(found.item, patch))
        const items = replaceNode(current, targetId, next)
        // 刚把一条审核通过 → 它该搬去归档了（同时按保留条数淘汰，id=189/269）。
        // 放在这里而不是只放 settings 接口：保留条数是「保持」的约束，不是「点一下」的动作。
        // id=272：只有**顶层**条目会单独归档。子任务审核通过时留在父的 children 里 ——
        // 把子任务拎进归档会让父变成残缺的空壳，而「整批做完再归档」是父自己的事
        // （父被审核通过时，它带着 children 一起进归档）。
        if (found.isChild) return items
        if (!(next.execute === true && next.review === true && next.draft !== true)) return items
        const result = await archiveReviewed(cwd, items, { noteLimit: settings.noteLimit, backup: backupWanted })
        if (result.archived.length === 0) return items
        trimmed = result.dropped
        if (result.backupNeeded && backupWanted) backup = await backupPlan(cwd)
        return result.items
      })
      const archivedAfter = await readArchived(cwd)
      return {
        cwd,
        item: findNode(written.items, targetId)?.item ?? archivedAfter.notes.find((item) => idKey(item.id) === idKey(targetId)),
        items: [...archivedAfter.notes.slice().reverse(), ...written.items],
        trimmed,
        trimmedCount: trimmed.length,
        backup,
      }
    })
  },

  /**
   * 删除一条计划。正在执行（已写 startedAt 但还没完成）的条目不允许删。
   *
   * id=269 起已审核条目住在归档里，所以两处都删：先删 plan.json（在有锁的那条路上），
   * 再删归档。归档里没有这条也不算错 —— 删除是幂等的。
   */
  async remove({ ctx, sessionId, cwd: cwdHint, id }) {
    return direct(ctx, sessionId, cwdHint, async (cwd) => {
      // id=89-B：被删的不止一个 id —— 删父会连带删掉整批 children，
      // 那些子任务的派发记录同样是孤儿，必须一起忘掉。
      // 在 mutatePlan 之外先记一份，因为锁内的 `items` 出不来。
      const doomed = []
      // id=89-C：删除闸门必须与「界面看到的状态」同源。
      // 否则会出现「界面已经显示待执行、点删除却报正在执行中」——
      // 这正是用户报的那类不一致。判据与 read 的 reconcileRunning 完全一致：
      // 有 startedAt **且** 该 id 还在 delivered[] 里才算真正在跑。
      const deliveredForGate = await readDeliveredQuiet(cwd)
      const written = await mutatePlan(cwd, ({ items }) => {
        // id=272：父与子都能删。删父连带删掉整批 children；删最后一条子任务时父一起消失
        // （留一个没有 children 的空壳，面板上就是一行点不开的空条目）。
        const found = findNode(items, id)
        // id=352-E：孤儿 startedAt（派发过但从没跑起来）不算「正在跑」——
        // 与 read 的回收判据同源，否则会出现「列表里已经不显示执行中、点删除还被拒」。
        // id=89-C：再加一条「派发记录里查不到也就不算在跑」。
        if (found !== null
          && isRunning(found.item)
          && !isOrphanStart(found.item, Date.now())
          && wasDispatched(deliveredForGate, found.item.id)) {
          const error = new Error(`计划 ${id} 正在执行中，不能删除`)
          error.code = 'running'
          throw error
        }
        if (found === null) return items
        // 收集真正会消失的 id：目标本身 + 它的子任务（删父时）。
        doomed.push(found.item.id)
        if (hasChildren(found.item)) {
          for (const kid of found.item.children) doomed.push(kid.id)
        }
        return removeNode(items, id)
      })
      const archived = await removeFromArchive(cwd, [id])
      // id=89-B：把这条（及其子任务）从派发游标里忘掉。
      //
      // 为什么要做（而不只是"反正随机 id 不复用、残留无害"）：
      //   · `delivered[]` 记的是「投过哪几条」，条目删了之后这些记录指向不存在的对象，
      //     下次读 dispatch.json 就看到一个孤儿编号 —— 题目要的是「不留残留状态」；
      //   · `groupId` 若锁在这条上（父被删），锁必须放掉，否则 groupOpen 一直找那个父。
      //
      // 删除是幂等的：游标文件不存在 / 本来就没记过它，`forgetIds` 返回 changed:false，
      // 这里不写盘（避免一次无意义的 IO）。失败也不该让删除本身失败 ——
      // 删任务是主操作，游标只是记账，用 catch 吞掉与 read 里的清理同款克制。
      await forgetDispatch(cwd, doomed.length > 0 ? doomed : [id])
      const current = await readArchived(cwd)
      void archived
      return { cwd, items: [...current.notes.slice().reverse(), ...written.items] }
    })
  },

  /**
   * 批量删除（「已审核」组底部的「全部删除」）。
   * 正在执行中的条目一律跳过（返回 skipped），其余按 id 一次性删掉、只写一次文件。
   *
   * id=269：已审核条目在归档里，所以两边一起删，`removed` 是两处的并集。
   * id=272：目标可能是子任务，用 findNode 判定「在不在 / 在不在跑」。
   */
  async removeMany({ ctx, sessionId, cwd: cwdHint, ids }) {
    return direct(ctx, sessionId, cwdHint, async (cwd) => {
      const removed = []
      const skipped = []
      // id=89-B：真正消失的 id（含被连带删掉的子任务），用于清理派发游标。
      const vanished = []
      // id=89-C：与单条删除同口径 —— 派发记录里查不到就不算在跑。
      const deliveredForGate = await readDeliveredQuiet(cwd)
      // id=325：子任务 id 是 "10-A"，不能 Number() 掉，否则批量删除会把它们全过滤掉。
      const wanted = new Set((Array.isArray(ids) ? ids : []).map((id) => idKey(id)).filter((id) => id !== ''))
      const written = await mutatePlan(cwd, ({ items: current }) => {
        if (wanted.size === 0) return null
        let items = current
        for (const id of wanted) {
          const found = findNode(items, id)
          if (found === null) continue
          // id=352-E：同 remove，孤儿 startedAt 不挡批量删除。
          // id=89-C：派发记录里查不到的也不挡。
          if (isRunning(found.item)
            && !isOrphanStart(found.item, Date.now())
            && wasDispatched(deliveredForGate, found.item.id)) {
            skipped.push(id)
            continue
          }
          // 删父会连带删掉 children —— 它们的游标记录也要一起清。
          vanished.push(found.item.id)
          if (hasChildren(found.item)) {
            for (const kid of found.item.children) vanished.push(kid.id)
          }
          items = removeNode(items, id)
          removed.push(id)
        }
        if (removed.length === 0) return null
        return items
      })
      // 归档那侧：跳过项不能删（与 plan.json 同口径）。
      const archiveWanted = [...wanted].filter((id) => !skipped.includes(id))
      const archiveRemoved = await removeFromArchive(cwd, archiveWanted)
      for (const id of archiveRemoved.removed) {
        if (!removed.includes(id)) removed.push(id)
      }
      // id=89-B：忘掉**真正消失**的 id（含被连带删掉的子任务）。
      // 被 skipped 的（正在执行）还活着，清它的游标记录会让下一轮重复投递。
      if (vanished.length > 0) await forgetDispatch(cwd, vanished)
      const archived = await readArchived(cwd)
      return { cwd, removed, skipped, items: [...archived.notes.slice().reverse(), ...written.items] }
    })
  },

  /**
   * 整批通过（id=355）：把一条拆解批次里的**全部**子任务一次置为已审核。
   *
   * 为什么要有这个路由，而不是让客户端对每条子任务各发一次 `update`：
   * - 客户端循环发 N 个请求，中间失败会留下「一半审过、一半没审」的中间态，
   *   而且父节点的容器标记要等最后一条成功才补，「待审核 → 已审核」的切换会抖 N 次；
   * - 每次 `update` 都要进一次 `mutatePlan` 的锁、读一次盘、写一次盘，一批十条就是十次。
   * 这里在**同一把锁、同一次读写**里改完整批，要么全成、要么一条都不动。
   *
   * 复用既有通道而不是新开一套状态源：
   * - 条目的审核形态仍由 `approveItem`（auto-review.js）生成 —— 它已经把「父 = 容器、
   *   children 逐条 review + finishedAt」这套口径写死了，这里只是一次性调用它；
   * - 写盘仍走 `mutatePlan`；
   * - 归档仍走 `archiveReviewed`（整批审完 = isReviewed，与自动通过同一条归档规则）。
   * 所以「整批通过」落盘后的形态与「逐条点通过」完全一致，不会有第三种状态。
   *
   * `id` 是父节点（批次）的 id。传进来的若是一条没有 children 的普通条目，
   * 就退化成「通过这一条」—— 与 `update { review: true }` 等价，不报错。
   */
  async approveBatch({ ctx, sessionId, cwd: cwdHint, id }) {
    return direct(ctx, sessionId, cwdHint, async (cwd) => {
      const { settings } = await readSettings(cwd)
      const backupWanted = settings.backupBeforeTrim === true
      let approved = []
      let trimmed = []
      let backup = null
      const written = await mutatePlan(cwd, async ({ items: current }) => {
        const found = findNode(current, id)
        if (found === null) {
          // 整批已经审完并搬进 notes.json 了：再点一次是幂等的 no-op，不该报错。
          // 只有「两处都没有」才是真的不存在。
          const archivedOnce = await readArchived(cwd)
          const hit = archivedOnce.notes.find((one) => idKey(one.id) === idKey(id))
          if (hit === undefined) throw new Error(`计划 ${id} 不存在`)
          approved = []
          return null
        }
        const parent = found.item
        const kids = Array.isArray(parent.children) ? parent.children : []
        // 父节点自己也算进来：它的 review 是容器标记，宿主归档判据会读它。
        const pool = kids.length > 0 ? [parent, ...kids] : [parent]
        // 已经审过的不再碰：repeat 调用要幂等，重写一遍只会多一次落盘。
        const pending = pool.filter((one) => one.review !== true)
        if (pending.length === 0) return null
        const now = new Date().toISOString()
        approved = pending.map((one) => one.id)
        // 整批的审核形态只由 approveItem 生成一次：父带 children 时它会把 children
        // 逐条 review:true 并补 finishedAt（已有的 finishedAt 原样保留，所以重复点
        // 不会把顺序搅乱）；没有 children 时返回的就是「这一条 review:true」。
        // 这里不另写一套循环 —— 「逐条点通过」与「整批通过」必须落成同一个形状。
        const items = replaceNode(current, parent.id, approveItem(parent, now))
        // 整批审完 → 该搬进归档了，与 update / 自动通过同一条规则（id=269/300）。
        const result = await archiveReviewed(cwd, items, { noteLimit: settings.noteLimit, backup: backupWanted })
        if (result.archived.length === 0) return items
        trimmed = result.dropped
        if (result.backupNeeded && backupWanted) backup = await backupPlan(cwd)
        return result.items
      })
      const archivedAfter = await readArchived(cwd)
      return {
        cwd,
        id,
        approved,
        approvedCount: approved.length,
        trimmed,
        trimmedCount: trimmed.length,
        backup,
        items: [...archivedAfter.notes.slice().reverse(), ...written.items],
      }
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
   * 派发下一条任务（id=341）。
   *
   * 调用时机固定：**一个 turn 结束后**。客户端在 agentRunning 从 true 翻成 false 时调这里，
   * 于是「做完 → 回答完 → 再做下一条」的顺序天然成立，不需要模型自己接着干。
   *
   * 为什么取任务是代码而不是模型：技能正文以前让模型 `go` → 干活 → `start --id`，
   * 每一步都要模型重新理解流程；现在由 `nextStep()`（纯函数，queue-cli 的 nextTask）
   * 决定是哪一条，模型只负责做。提示词里直接给出 id 与正文。
   *
   * 返回里刻意区分「没有可做的」和「发送失败」：前者是正常收工，后者要报给面板。
   */
  async dispatch({ ctx, sessionId, cwd: cwdHint, dryRun, force, ack }) {
    if (typeof sessionId !== 'string' || sessionId === '') throw new Error('缺少会话 id')
    const cwd = await resolveCwd(ctx, sessionId, cwdHint)
    const plan = await readPlan(cwd)
    // id=342：游标决定「这一组投到哪了」。一组 children 没做完时锁在组内，
    // 不因为别的一级任务 order 更靠前就跳过去 —— 那正是「跨组跳任务」。
    const stored = await readCursor(cwd)
    const applied = applyCursor(nextStep(plan.items), plan.items, stored.cursor)
    let step = applied.step
    if (step === null && applied.reason === 'inflight') {
      // 自动派发停在队首：它还没 done，不能改投后面的。
      // force 是用户点了「开始 / 继续」：同一条再发一遍，消息里带上次做到的 note。
      if (force !== true || applied.head === null || applied.head === undefined) {
        return {
          dispatched: false,
          reason: 'inflight',
          taskId: applied.taskId ?? null,
          text: '',
          remaining: remainingCount(plan.items),
          finished: false,
        }
      }
      step = applied.head
    }
    if (step === null) {
      // 队列空了：正常收工，不发任何提示词（发一条「没活了」只会污染对话）。
      // 顺手清一次游标：下一轮开工是全新的一批，不该继承上一轮「投过」的记录。
      await clearCursor(cwd).catch(() => null)
      // id=343：正常收工。客户端据此把「执行中 / 已挂起」这类运行态一起清掉，
      // 而不是留一个永远停在「干活中」的顶栏。
      return { dispatched: false, reason: 'empty', taskId: null, text: '', remaining: 0, finished: true }
    }
    const alreadyDelivered = isDelivered(stored.cursor, step.task?.id)
    const remaining = remainingCount(plan.items)
    const text = buildPrompt(step, remaining)
    const payload = {
      dispatched: true,
      reason: 'ok',
      // id=342：这一条之前投过没有（会话 running 抖动 / 页面刷新后重派时，界面据此说实话）。
      redelivered: alreadyDelivered,
      taskId: step.task?.id ?? null,
      parentId: step.parentId ?? null,
      index: step.index ?? 0,
      groupSize: step.groupSize ?? 1,
      groupRemaining: step.groupRemaining ?? 1,
      remaining,
      text,
    }
    // 浏览器已经把同一段正文发进会话时走 ack：只回写 startedAt 和游标，不再 prompt 一次。
    const record = async () => {
      let markedStarted = false
      try {
        await mutatePlan(cwd, ({ items }) => {
          const hit = findNode(items, step.task?.id)
          if (hit === null) return null
          if (typeof hit.item.startedAt === 'string' && hit.item.startedAt !== '') return null
          markedStarted = true
          return replaceNode(items, step.task?.id, {
            ...hit.item,
            startedAt: new Date().toISOString(),
            interrupted: false,
            failed: false,
          })
        })
      } catch {
        // 回写失败不影响这次派发：模型已经收到任务了，下一次 read 会自然纠正状态。
      }
      const next = markDelivered(applied.cursor, step.task?.id)
      await writeCursor(cwd, next).catch(() => null)
      return markedStarted
    }
    // dryRun：只算「该派谁、发什么」，不发请求 —— 客户端拿它做提示、单测拿它做断言。
    if (dryRun === true) return payload
    if (ack === true) {
      const markedStarted = await record()
      return { ...payload, markedStarted }
    }
    const controller = ctx.get('sessionController')
    if (controller === undefined || typeof controller.prompt !== 'function') {
      const error = new Error('会话控制器不可用，无法派发下一条')
      error.code = 'no-controller'
      throw error
    }
    const request = {
      requestId: `plan-dispatch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
    }
    await controller.prompt(request, new AbortController().signal)
    // id=343：派出去就把 startedAt 写上 —— 这是「任务开始」的回写。
    // 面板的「执行中」徽标、待执行/待审核的条数全看这个字段（30-runtime.js 的 statusOf），
    // 少了它，模型其实已经在干活、界面上却仍算「待执行」，两个栏目的统计对不上。
    // 已经有过 startedAt 的不覆盖：续做要保留最初那次开始时间（技能里也写明不许重写）。
    const markedStarted = await record()
    return { ...payload, markedStarted }
  },

  /**
   * 记录「这一轮 turn 真的结束了」（id=ImWOun 后续优化）。
   *
   * 为什么需要：`orphan.js` 原来靠「有没有产出（time / note）」推断
   * 「有没有跑起来」，于是「跑完了但没调 q.mjs done」会被误判成中断。
   * 真正的信号是 **turn 是否结束** —— 而这个信号只有客户端有：
   * `sessions.list.subscribe` 能在 `running` 由 true 翻成 false 时回调。
   *
   * 客户端在这个时刻调本方法，宿主把 `turnEndedAt` 写到对应条目上。
   * 之后 `isOrphanStart` 只要看到 `turnEndedAt` 就**认定它跑过**，
   * 不再用「没产出」当成「没跑起来」。
   *
   * 为什么记时间戳而不只记布尔：时间戳还能回答「什么时候结束的」，
   * 将来做「任务耗时统计」用得上；布尔则不可逆地丢掉了这个信息。
   *
   * 找不到 id 时**不报错**：turn 结束可能对应一条已经被删掉 / 归档的条目，
   * 那是正常情况，不该让客户端的回调炸掉。返回 `{ ok: true, marked: false }`。
   */
  async markTurnEnd({ ctx, sessionId, cwd: cwdHint, id }) {
    return direct(ctx, sessionId, cwdHint, async (cwd) => {
      if (id === undefined || id === null || id === '') return { cwd, marked: false }
      const stamp = new Date().toISOString()
      let marked = false
      await mutatePlan(cwd, ({ items }) => {
        const hit = findNode(items, id)
        if (hit === null) return null
        // 已经有了就不重复写（幂等）：turn 结束回调可能因重渲染触发多次。
        if (typeof hit.item.turnEndedAt === 'string' && hit.item.turnEndedAt !== '') return null
        marked = true
        return replaceNode(items, id, { ...hit.item, turnEndedAt: stamp })
      }).catch(() => null)
      return { cwd, marked, turnEndedAt: marked ? stamp : '' }
    })
  },

  /**
   * 中止当前会话正在跑的这一轮（id=208「暂停」的宿主兜底通路）。
   *
   * `sessionController.cancel({ sessionId })` 只停当前 turn，**不动** plan.json：
   * 已经写进去的 startedAt / note / execute 原样保留，所以再点「开始」能接着做。
   * 客户端优先走浏览器侧的 `session.cancel()`；那条路不可用时才回落到这里。
   */
  async cancel({ ctx, sessionId }) {
    if (typeof sessionId !== 'string' || sessionId === '') throw new Error('缺少会话 id')
    const controller = ctx.get('sessionController')
    if (controller === undefined || typeof controller.cancel !== 'function') {
      const error = new Error('会话控制器不可用，无法暂停')
      error.code = 'no-controller'
      throw error
    }
    const result = controller.cancel({ sessionId })
    // cancel 是同步的「已受理」回执，取消结果会异步落到会话快照上。
    if (result !== null && typeof result === 'object' && result.accepted === false) {
      const error = new Error('暂停未被受理')
      error.code = 'not-accepted'
      throw error
    }
    return { accepted: true }
  },
}

export { API }
