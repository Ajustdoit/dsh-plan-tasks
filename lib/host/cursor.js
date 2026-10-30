import { actionable } from './queue-cli.js'

/**
 * 投递游标（id=342 / id=343）。
 *
 * 为什么需要它：harness 侧**没有**任务队列接口（见 docs/execution-loop.md），
 * 「把一组拆解任务整体交给队列」这件事只能在插件侧自己做 —— 按 A/B/C 顺序一条一条投，
 * 并在本地记住「这一组投到哪了、投过哪几条」。
 *
 * 它解决三个具体问题：
 * 1. **不跨组跳任务**：一组还没做完时，即使面板上别的一级任务 order 更靠前，
 *    也要先把这一组的兄弟投完（`lockGroupId`）。
 * 2. **不跳过没做完的队首**：`delivered` 记的是「已经投进会话」的 id。
 *    队首还在队列里（没 `execute`）说明它还没做完 —— 这时返回 inflight，
 *    不改投它后面那条。以前「跳过已投递、去投下一条未投的」会在 done 没落盘时把队列甩到后面。
 * 3. **可解释**：`.plan/dispatch.json` 里能直接看出「投到哪、投了几条」，
 *    排查「为什么下一条是它」不用猜。
 *
 * 文件很小（一个组 id + 一个 id 数组），跟着 plan.json 一起被清理也无所谓：
 * 丢了最坏就是重投一次，`start` 对已 `startedAt` 的条目是幂等的。
 */

/** 游标文件的形状。字段缺失一律按「没有游标」处理，绝不让坏数据挡住派发。 */
const EMPTY = { groupId: null, delivered: [], updatedAt: '' }

/** 最多记多少条「投过」的 id：够覆盖一个拆分组即可，超出的从最旧开始丢。 */
const DELIVERED_MAX = 200

function normalized(raw) {
  const base = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const groupId = Number.isInteger(base.groupId) && base.groupId > 0 ? base.groupId : null
  const delivered = Array.isArray(base.delivered)
    ? base.delivered.filter((id) => typeof id === 'string' || Number.isInteger(id)).slice(-DELIVERED_MAX)
    : []
  return { groupId, delivered, updatedAt: typeof base.updatedAt === 'string' ? base.updatedAt : '' }
}

/** 这一组里还有没有没做完的子任务（组锁的释放条件）。 */
function groupOpen(items, groupId) {
  if (!Number.isInteger(groupId) || groupId <= 0) return []
  const list = Array.isArray(items) ? items : []
  const parent = list.find((item) => item !== null && typeof item === 'object' && item.id === groupId)
  if (parent === undefined) return []
  const kids = Array.isArray(parent.children) ? parent.children : []
  if (kids.length === 0) return []
  // 父被搁置时整组都不该再投（与 queue-cli 的 actionableLeaves 同口径）。
  if (parent.draft === true || parent.failed === true || parent.execute === true) return []
  return kids.filter((kid) => kid !== null && typeof kid === 'object'
    && kid.execute !== true && kid.draft !== true && kid.failed !== true)
}

/**
 * 应用游标：决定「这次该派哪一条」。
 *
 * 两条规则叠在一起，顺序不能反：
 * 1. **组锁**：游标里锁着一组、这组还有没做完的 → 候选只从这组里取（按后缀 A/B/C 排），
 *    不跨组 —— 这是「组内全部完成后再推进到下一个一级任务」的落点。
 * 2. **队首未完成就停**：候选的第一条就是该派的那条。它已经在 `delivered` 里
 *    （上一轮投过、磁盘上还没 `execute`）时返回 `reason:'inflight'`，不改挑后面的。
 *    做完的条目不在候选里，所以下一条自然变成新的队首。
 *
 * 候选的基准顺序来自 queue-cli 的 `actionable`（order → 一级 id → 后缀），
 * 与 `.plan/q.mjs` 给出的 next 完全一致 —— 面板派发的和命令行报的必须是同一条。
 *
 * @param {null|{task: object, parentId: number|null, index: number}} _step 正常顺序的下一条（保留参数，便于对照）
 * @param {Array} items 顶层条目
 * @param {object} rawCursor 磁盘上的游标
 */
function applyCursor(_step, items, rawCursor) {
  const cursor = normalized(rawCursor)
  const queue = actionable(items)
  if (queue.length === 0) {
    return { step: null, reason: 'empty', taskId: null, cursor: { ...cursor, groupId: null }, changed: cursor.groupId !== null }
  }

  const delivered = new Set(cursor.delivered.map(String))
  const lockedId = cursor.groupId
  const stillOpen = groupOpen(items, lockedId)

  // 候选范围：组锁生效时只在组内，否则用整条队列。
  let pool = queue
  let scopeParent = null
  if (stillOpen.length > 0) {
    const openIds = new Set(stillOpen.map((kid) => String(kid.id)))
    const inGroup = queue.filter((one) => openIds.has(String(one?.id)))
    if (inGroup.length > 0) {
      pool = inGroup
      scopeParent = lockedId
    } else {
      // 组里还有没做完的、但队列算出来它们不可做（比如刚被标失败并重排队）：
      // 退回整条队列，让正常顺序接管 —— 卡在组里比跨组更糟。
      pool = queue
    }
  }

  const head = pool[0]
  // 队首已经投进会话、却还没做完：停在这里。挑后面「还没投过」的会把没回填的那条甩掉。
  if (delivered.has(String(head?.id))) {
    // head 留给手动「继续」：自动派发看到 inflight 就停，force 时把这一条再发一遍。
    return {
      step: null,
      head: toStep(head, items, scopeParent),
      reason: 'inflight',
      taskId: head?.id ?? null,
      cursor,
      changed: false,
    }
  }
  const pick = head
  const resolved = toStep(pick, items, scopeParent)
  const nextGroup = resolved.parentId ?? null
  const changed = cursor.groupId !== nextGroup
  return { step: resolved, reason: 'ok', taskId: resolved?.task?.id ?? null, cursor: { ...cursor, groupId: nextGroup }, changed }
}

/** 把「一条任务」补成 step 形状（分组信息按它在父下的位置现算）。 */
function toStep(task, items, parentHint) {
  if (task === null || typeof task !== 'object') return null
  const list = Array.isArray(items) ? items : []
  // 先按 parentHint 找，再全表找 —— pick 可能来自任意一层。
  const parent = Number.isInteger(parentHint)
    ? list.find((item) => item?.id === parentHint)
    : list.find((item) => Array.isArray(item?.children) && item.children.some((kid) => String(kid?.id) === String(task.id)))
  const kids = Array.isArray(parent?.children) ? parent.children.filter((kid) => kid !== null && typeof kid === 'object') : []
  if (kids.length === 0) {
    return { task, parentId: null, groupSize: 1, groupRemaining: 1, groupRemainingAfter: 0, index: 0 }
  }
  const open = kids.filter((kid) => kid.execute !== true && kid.draft !== true && kid.failed !== true)
  return {
    task,
    parentId: parent.id,
    groupSize: kids.length,
    groupRemaining: Math.max(1, open.length),
    groupRemainingAfter: Math.max(0, open.length - 1),
    index: kids.indexOf(task),
  }
}

/** 记一条「已投递」。返回新游标（不可变写法，调用方决定要不要落盘）。 */
function markDelivered(rawCursor, taskId, now) {
  const cursor = normalized(rawCursor)
  const id = typeof taskId === 'string' || Number.isInteger(taskId) ? taskId : null
  if (id === null) return cursor
  const key = String(id)
  if (cursor.delivered.map(String).includes(key)) return cursor
  const delivered = [...cursor.delivered, id].slice(-DELIVERED_MAX)
  const stamp = typeof now === 'string' && now !== '' ? now : new Date().toISOString()
  return { ...cursor, delivered, updatedAt: stamp }
}

/** 这一条是不是「投过但还没开跑」（用于提示「已投递、等它开始」）。 */
function isDelivered(rawCursor, taskId) {
  const cursor = normalized(rawCursor)
  const key = String(taskId ?? '')
  if (key === '') return false
  return cursor.delivered.map(String).includes(key)
}

export { DELIVERED_MAX, EMPTY, applyCursor, groupOpen, isDelivered, markDelivered, normalized }
