/**
 * 一次性迁移：把 `.plan/` 下的数据整理成当前结构（id=77-E）。
 *
 * ── 迁移做什么 ────────────────────────────────────────────────────────────
 * 1. **补 order**：缺 order 的条目按「当前展示顺序」补 1000 起步的递增 order；
 * 2. **补 id**：缺失或不是 6 位 `0-9A-Za-z` 的 id 用 `makeId()` 补齐；
 *    **已存在的合法 id 一律不改** —— 历史计划的标题里已经出现过
 *    「任务id:45」这类引用（用户在会话里贴过），改 id 会让那些引用变成死链；
 * 3. **统一字段顺序**为 `FIELD_ORDER` 的次序，2 空格缩进；
 * 4. **去掉重复键、空值、冗余字段**（空串、null、undefined、以及旧的别名键）。
 *
 * ── 为什么「补 id」要小心 ─────────────────────────────────────────────────
 * id 是**身份**，不是序号。用户可能：
 * - 在会话里引用过「任务id:45」；
 * - 在 notes / dispatch 里被引用（`delivered[]`、`groupId`）；
 * - 用 `.plan/q.mjs done --id 45` 记过账。
 *
 * 所以这里的规则是：**合法的就留着**（数字 id 也算合法历史格式），
 * 只有「没有 id」或「id 根本不是合法形状」时才补。补的 id 用 `makeId()`，
 * 与 77-B 的新建路径同一套。
 *
 * ── 为什么读路径也要兜底 ──────────────────────────────────────────────────
 * 迁移只能迁**我们看到的文件**。用户可能：
 * - 手工改 plan.json、写成旧格式；
 * - 从别处拷一份 plan.json 进来；
 * - 迁移脚本还没跑（新装、或文件被回滚）。
 *
 * 所以读取路径必须独立兜底：缺 order 时按数组下标临时代序、缺合法 id 时
 * **临时生成一个**（不落盘），下次保存时自然写回。这样老数据打开不报错、顺序不乱跳。
 */

import { ORDER_STEP } from './order.js'
import { collectIds, createTaskId, isTaskId } from './taskid.js'
import { isTopId } from './ids.js'

/**
 * 落盘时的字段顺序。
 *
 * 为什么要在意顺序：这个文件是**用户会打开看**的（也可能被脚本 diff）。
 * 字段顺序稳定，diff 才只显示真正变化的值；否则每次保存都整片变色。
 *
 * 分组是语义的：先身份、再内容、再状态、最后时间。
 */
const FIELD_ORDER = [
  'id',
  'order',
  'name',
  'plan',
  'mode',
  'taskType',
  'execute',
  'review',
  'draft',
  'failed',
  'interrupted',
  'time',
  'note',
  'startedAt',
  'finishedAt',
  // id=ImWOun 后续优化：turn 结束时刻（客户端回写）。
  // 漏掉它会让迁移把历史条目上的这个字段丢掉 ——
  // 它正是「这一轮确实跑过」的直接证据，丢了会让孤儿判定退回不可靠的产出推断。
  'turnEndedAt',
  // id=UpcIC7-IMG：附件图片文件名数组。漏掉它会让迁移把附件整批丢掉 ——
  // 图片文件还在磁盘上，但没有任何条目再引用它们，等于数据丢失。
  'img',
  'createdAt',
  'decomposeKey',
  'sourcePrompt',
  'children',
]

/** 旧版本遗留、现在不该再出现的键（读到时直接丢掉）。 */
const OBSOLETE_KEYS = new Set([
  // 曾经的「置顶」实现（已由 order 取代）
  'pinned',
  'pinTop',
  'pinnedAt',
  // 曾经用来排序的字段（已由 order 取代）
  'sortIndex',
  'seq',
  // 界面用的临时态，不该落盘
  'dragging',
  'hovered',
  'selected',
  'expanded',
])

/** 空值判定：空串、null、undefined 都算空；0 / false / 空数组不算。 */
function isEmptyValue(v) {
  if (v === null || v === undefined) return true
  if (typeof v === 'string' && v === '') return true
  return false
}

/**
 * 按 FIELD_ORDER 重排一个对象的键，并丢掉空值与废弃键。
 *
 * 未在 FIELD_ORDER 里出现的键：保留（放在末尾），但同样丢空值 ——
 * 因为第三方/未来版本可能加了字段，静默删掉会丢数据。
 */
function orderFields(obj, fieldOrder = FIELD_ORDER) {
  const out = {}
  const seen = new Set()
  for (const key of fieldOrder) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue
    seen.add(key)
    const value = obj[key]
    if (isEmptyValue(value)) continue
    out[key] = value
  }
  for (const key of Object.keys(obj)) {
    if (seen.has(key)) continue
    if (OBSOLETE_KEYS.has(key)) continue
    const value = obj[key]
    if (isEmptyValue(value)) continue
    out[key] = value
  }
  return out
}

/**
 * 读取路径的兜底：给一条原始数据补出「可用的 id 与 order」，不落盘。
 *
 * @param {object} raw 原始条目
 * @param {number} index 它在数组里的下标（缺 order 时用来临时代序）
 * @param {object} ctx
 * @param {Set<string>} ctx.taken 已占用的 id（会被就地补充新生成的）
 * @param {number} ctx.baseOrder 本批的起始 order（1000 起步）
 * @returns {{id: string|number, order: number, generatedId: boolean, inheritedOrder: boolean}}
 */
function readFallback(raw, index, ctx) {
  const item = raw !== null && typeof raw === 'object' ? raw : {}
  const taken = ctx?.taken instanceof Set ? ctx.taken : new Set()
  const baseOrder = Number.isFinite(ctx?.baseOrder) ? ctx.baseOrder : ORDER_STEP

  // ── id ──
  const rawId = item.id
  const hasUsableId = isTopId(rawId) || (typeof rawId === 'string' && isTaskId(rawId))
  let id
  let generatedId = false
  if (hasUsableId && !taken.has(String(rawId))) {
    id = rawId
  } else if (hasUsableId) {
    // 合法但与别人撞了 —— 这种情况很少，但撞了必须换，否则两条任务变一条。
    id = createTaskId({ existing: taken })
    generatedId = true
  } else {
    id = createTaskId({ existing: taken })
    generatedId = true
  }
  taken.add(String(id))

  // ── order ──
  // 缺失/非法时按数组下标临时代序：这样老数据（完全没有 order）读出来
  // 就是它原本的展示顺序，不会因为「全部读成 0」而挤成一团。
  const inheritedOrder = !Number.isFinite(Number(item.order))
  const order = inheritedOrder ? baseOrder + index * ORDER_STEP : Number(item.order)

  return { id, order, generatedId, inheritedOrder }
}

/**
 * 迁移一棵条目树（顶层 + children）。
 *
 * @param {Array} items 原始顶层条目
 * @param {object} [options]
 * @param {() => number} [options.random] 随机源（测试注入用）
 * @returns {{items: Array, changes: Array<{kind: string, detail: string}>}}
 */
function migrateItems(items, options = {}) {
  const list = Array.isArray(items) ? items : []
  const opt = options !== null && typeof options === 'object' ? options : {}
  const changes = []

  // 已占用的 id —— 但**不能包含正在处理的这一条自己**。
  //
  // 这里踩过两个坑：
  //
  // ① 最初写 `new Set(collectIds(list))` 把全部 id 预填进去，于是每条合法 id
  //    一查都「撞号」（撞的是自己），迁移把**所有 id 全换掉了** ——
  //    历史计划标题里「任务id:45」这类引用会当场变成死链。
  //
  // ② 改成「逐条把自己删掉」之后，重复 id 又不报了：
  //    两条都是 `dup111` 时，第一条删掉它、处理完放回；第二条又删掉它 ——
  //    于是两条都认为「没撞号」，原样留下一对相同 id。
  //
  // 现在的做法：先数每个 id 出现几次，处理第 i 条时把它自己**扣一次**
  // （不是删光）。若还有别的条目在用同一个 id，count 仍为正，照样判出撞号。
  const allIds = collectIds(list)
  const taken = new Set(allIds)
  const idCount = new Map()
  for (const key of allIds) idCount.set(key, (idCount.get(key) ?? 0) + 1)
  const releaseOnce = (key) => {
    const n = idCount.get(key) ?? 0
    if (n <= 1) { taken.delete(key); idCount.set(key, 0); return }
    idCount.set(key, n - 1)
  }

  const out = list.map((raw, index) => {
    const item = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}

    // 扣掉「自己这一次占用」，但仍保留「别的条目也用了同一个 id」的占用。
    const ownKey = item.id !== undefined && item.id !== null ? String(item.id) : null
    if (ownKey !== null) releaseOnce(ownKey)
    const fb = readFallback(item, index, { taken, baseOrder: ORDER_STEP })
    taken.add(String(fb.id))

    if (fb.generatedId) changes.push({ kind: 'id', detail: `第 ${index + 1} 条补 id → ${fb.id}` })
    if (fb.inheritedOrder) changes.push({ kind: 'order', detail: `第 ${index + 1} 条补 order → ${fb.order}` })

    // 先标准化一遍（store 的 normalizeNode 会补全默认值、清理旧键），再重排字段。
    const base = { ...item, id: fb.id, order: fb.order }

    const kidsRaw = Array.isArray(item.children) ? item.children : []
    if (kidsRaw.length > 0) {
      const parentKey = String(fb.id)
      base.children = kidsRaw.map((rawKid, kidIndex) => {
        const kid = rawKid !== null && typeof rawKid === 'object' && !Array.isArray(rawKid) ? rawKid : {}
        // 子任务 id 的形状是 `<父id>-<后缀>`。
        //
        // 判定必须**同时**满足两点，缺一不可：
        //   ① 形状对（父段字母数字、后缀大写字母）；
        //   ② **父段就等于当前父的 id**。
        //
        // 只判 ① 会漏掉一类真实数据：父 id 从 `1` 改成随机串 `twRXzh` 之后，
        // 子任务仍是 `1-A`（形状合法，但父段对不上）。于是界面里出现
        // 「父 twRXzh / 子 1-A」；更要命的是**不同组会撞出同一个子 id**
        // （`twRXzh` 的子 `1-A` 与父 `1` 的子 `1-A` 完全同名），
        // 而派发游标只按 id 字符串匹配，会把新组那条误判成"已投递"而卡住不动。
        //
        // 补上 ② 之后，子 id 永远跟着父走：父段不等于 parentKey 就按位置重算。
        const suffix = childSuffixOf(kidIndex)
        const expected = `${parentKey}-${suffix}`
        const shapeOk = typeof kid.id === 'string' && /^[0-9A-Za-z]+-[A-Z]+$/.test(kid.id)
        const parentMatches = shapeOk && kid.id.slice(0, kid.id.lastIndexOf('-')) === parentKey
        const kidId = parentMatches ? kid.id : expected
        if (kidId !== kid.id) changes.push({ kind: 'childId', detail: `${kid.id} → ${expected}` })
        // id=77-E：子任务也要走 orderFields —— 否则它的键序会保持原样
        // （实测出现过 `{"plan":"子一","id":"grp001-A"}` 这种 id 排在后面的形状）。
        const kidOrder = Number.isFinite(Number(kid.order)) ? Number(kid.order) : kidIndex
        return orderFields({ ...kid, id: kidId, order: kidOrder })
      })
    }

    return orderFields(base)
  })

  return { items: out, changes }
}

/** 0 → A、25 → Z、26 → AA …（与 ids.js 的 childSuffix 同一套，此处内联避免循环依赖顾虑）。 */
function childSuffixOf(index) {
  const n = Number.isInteger(index) && index >= 0 ? index : 0
  let rest = n + 1
  let out = ''
  while (rest > 0) {
    const r = (rest - 1) % 26
    out = String.fromCharCode(65 + r) + out
    rest = Math.floor((rest - 1) / 26)
  }
  return out
}

/** 把迁移结果序列化成落盘文本：2 空格缩进、末尾一个换行。 */
function renderPlan(items) {
  return `${JSON.stringify(items, null, 2)}\n`
}

export {
  FIELD_ORDER,
  OBSOLETE_KEYS,
  orderFields,
  readFallback,
  migrateItems,
  renderPlan,
  childSuffixOf,
}
