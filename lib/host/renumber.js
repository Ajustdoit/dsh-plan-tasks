/**
 * 旧数据的编号归一（id=326）。
 *
 * 背景：id=325 把编号规则改成「一级数字 + children 的 `父id-后缀`」。新数据天然合规，
 * 但磁盘上还躺着老格式：顶层 id 带洞、children 全是全局数字、甚至两批撞号。
 *
 * 规范形状：顶层从 startId 起连续编号，children 是 `父id-A/B/C`。
 * 迁移**只做一次**（完成后在 settings.json 里记 idsVersion=2），之后只修真缺陷：
 * 重复 id / 非正整数 / 落在归档号段里 / children 形状不对。
 * 为什么不一直重排：用户每删一条一级任务就会留一个洞，若每次都顺延编号，
 * 「编号是身份」就不成立了 —— 用户刚记住的 #12 下一次刷新变成 #11。
 *
 * 三条硬约束：
 * 1. **可重复执行**：已经合规时返回原数组（引用相同），调用方据此不写盘；
 * 2. **结果稳定**：同一份输入永远同样结果，不看时间、不随机；
 * 3. **不与归档撞号**：起始 id 由调用方给（= 归档里最大的数字 id + 1）。
 *
 * 只动 id，不动 order / 状态 / 正文。
 */
import { childIdOf, isTopId, parentIdOfChild, parentIdValue } from './ids.js'

/** 编号规则已迁移到第 2 版（层级式）。 */
const IDS_VERSION = 2

/** 这条条目在给定 id 下是否是规范形状（含 children）。 */
function nodeMatches(item, id) {
  if (item === null || typeof item !== 'object') return false
  if (parentIdValue(item.id) !== id) return false
  const kids = Array.isArray(item.children) ? item.children : []
  if (kids.length === 0) return true
  return kids.every((kid, index) => kid?.id === childIdOf(id, index))
}

/** 检查一条（供测试与排查用）：给定它应得的 id，返回是否还需要改。 */
const nodeNeedsRenumber = (item, startId) => !nodeMatches(item, Number.isInteger(startId) && startId > 0 ? startId : 1)

/**
 * 编号里「任何时候出现都必须修」的毛病。
 *
 * id=385：撞号判据从「小于归档起始号」改成「**真的**和归档里的某条 id 相同」。
 *
 * 原来写的是 `if (own < base) return true`，而 base = 归档最大号 + 1。
 * 这条在「归档里出现了比 plan 中某些条目更大的号」时就误判 —— 而这**恰恰是正常流转**：
 *
 *   1. plan 里有 31、32、33；
 *   2. 33 审完被归档（notes.json 里出现 33）→ 下一轮 base = 34；
 *   3. 于是 `31 < 34`、`32 < 34` 全被判成缺陷 → 整份 plan 被重排成 34、35。
 *
 * 用户看到的就是「一删（或一归档）任务，队列 id 整体回填」，而模型还在按旧 id 回填
 * 执行结果 —— 于是找不到对应条目。这正是本条要修的问题。
 *
 * 真正的危险只有「plan 里某条 id 与归档里某条 id **完全相同**」：
 * 那才会让 findAnywhere 先命中 plan、取错条目。只比大小是过度的。
 *
 * @param {Array} list 顶层条目
 * @param {number} base 起始号（迁移时用于判「是否连续」，不参与撞号判定）
 * @param {Set<string>} [archivedIds] 归档里已占用的 id 文本（父与子都算）
 */
function hasDefects(list, base, archivedIds) {
  const seen = new Set()
  const taken = archivedIds instanceof Set ? archivedIds : null
  for (const item of list) {
    const own = parentIdValue(item?.id)
    // id=77-B：`own === null` 不再等于「有缺陷」。
    // 新格式的 id 是 6 位随机串，`parentIdValue` 对它必然返回 null ——
    // 若沿用「null 即缺陷」，每次读盘都会判缺陷 → 触发 renumber →
    // 把随机 id 整份改写成 1,2,3…（等于把 77-B 的改动原地撤销）。
    // 所以这里改用 isTopId：合法的一级 id（数字或 6 位串）都放行。
    if (!isTopId(item?.id)) return true
    const key = String(item.id)
    if (seen.has(key)) return true
    seen.add(key)
    // 与归档里某条**同号**才算缺陷（不是「比它小」）。
    if (taken !== null && taken.has(key)) return true
    const kids = Array.isArray(item.children) ? item.children : []
    if (kids.length === 0) continue
    const kidSeen = new Set()
    // 子任务形状：`<父id>-<后缀>`，父段取**文本**（随机 id 也能直接拼）。
    const parentText = own !== null ? String(own) : String(item.id)
    const shape = new RegExp('^' + parentText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-[A-Z]+$')
    for (const kid of kids) {
      const text = String(kid?.id ?? '')
      if (!shape.test(text)) return true
      if (kidSeen.has(text)) return true
      // 子任务 id 同样可能与归档里的子任务撞号（"12-A"）。
      if (taken !== null && taken.has(text)) return true
      kidSeen.add(text)
    }
  }
  return false
}

/** 编号是否从 base 起逐位连续（迁移时的目标形状）。 */
function isSequential(list, base) {
  return list.every((item, index) => nodeMatches(item, base + index))
}

/**
 * 整份列表是否还需要归一。
 *
 * @param {Array} items 顶层条目
 * @param {number} startId 起始 id（归档最大号 + 1）。**迁移时**用于判「号是否连续」；
 *   迁移之后不再参与撞号判定（id=385）。
 * @param {boolean} [sequential] true 表示这是**旧数据**：连「号有洞」也算不规范，
 *   一律按现有顺序重排一次。迁移完成后再读不带这个开关，就只剩真缺陷要修。
 * @param {Set<string>} [archivedIds] 归档里已占用的 id；只有**同号**才算缺陷。
 */
function needsRenumber(items, startId, sequential, archivedIds) {
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) return false
  const base = Number.isInteger(startId) && startId > 0 ? startId : 1
  if (hasDefects(list, base, archivedIds)) return true
  // id=77-B：`sequential` 只对**纯数字 id 的旧数据**有意义（它判的是「号是否从 base 起连续」）。
  // 列表里只要有一个随机 id，「连续」这个概念就不适用 —— 否则每次读旧数据的路径
  // 都会判「不连续 → 需要重排」，把随机 id 全改成 1,2,3…。
  if (sequential !== true) return false
  const hasRandomId = list.some((item) => typeof item?.id === 'string' && !/^\d+$/.test(item.id))
  if (hasRandomId) return false
  return !isSequential(list, base)
}

/**
 * 收集归档里已占用的全部 id（父与子都算）。
 *
 * id=385：撞号判据需要「具体哪些 id 被占了」，而不是「从几号开始」——
 * 后者会把「归档里有大号、plan 里有小号」这种正常情形当成冲突。
 */
function archivedIdSet(archivedNotes) {
  const set = new Set()
  for (const note of Array.isArray(archivedNotes) ? archivedNotes : []) {
    if (note === null || typeof note !== 'object') continue
    set.add(String(note.id))
    for (const kid of Array.isArray(note.children) ? note.children : []) {
      if (kid !== null && typeof kid === 'object') set.add(String(kid.id))
    }
  }
  return set
}

/**
 * 按当前顺序重排（迁移那一次用；之后只剩真缺陷时也走这里）。
 *
 * id=77-B：**只处理数字 id 的旧数据，绝不动随机 id。**
 * 本函数产出的 id 是 `base + index`（连续数字），这对随机 id 是降级 ——
 * 一旦对含随机 id 的列表调用，等于把 77-B 的成果整份撤销。
 * 所以入口处先判断：列表里只要出现一个随机 id，就原样返回、不重排。
 *
 * （`needsRenumber` 那边已经用 `isTopId` 放行随机 id，正常情况下不会走到这里；
 *   这里是第二道闸，防止有人直接调用 renumber。）
 *
 * @returns {{items: Array, changes: Array<{from: any, to: any}>}}
 *   `items` 与原数组引用相同 = 本来就合规，调用方据此跳过写盘。
 */
function renumber(items, startId, sequential, archivedIds) {
  const list = Array.isArray(items) ? items : []
  const base = Number.isInteger(startId) && startId > 0 ? startId : 1
  // 含随机 id → 这是新格式数据，不参与「连续数字」重排。
  if (list.some((item) => typeof item?.id === 'string' && !/^\d+$/.test(item.id))) {
    return { items: list, changes: [] }
  }
  if (!needsRenumber(list, base, sequential === true, archivedIds)) return { items: list, changes: [] }
  const changes = []
  const out = list.map((item, index) => {
    const id = base + index
    if (item?.id !== id) changes.push({ from: item?.id, to: id })
    const kids = Array.isArray(item?.children) ? item.children : []
    if (kids.length === 0) return { ...item, id }
    const children = kids.map((kid, kidIndex) => {
      const next = childIdOf(id, kidIndex)
      if (kid?.id !== next) changes.push({ from: kid?.id, to: next })
      return { ...kid, id: next }
    })
    return { ...item, id, children }
  })
  return { items: out, changes }
}

/**
 * 从归档里那批条目算一个安全的起始 id（归档里最大编号 + 1）。
 * 归档条目也可能带 children（整批审完的父），它们的 `12-C` 也算进去。
 */
function startIdAfter(archivedNotes) {
  let max = 0
  for (const note of Array.isArray(archivedNotes) ? archivedNotes : []) {
    const own = parentIdValue(note?.id) ?? parentIdOfChild(note?.id)
    if (own !== null && own > max) max = own
    for (const kid of Array.isArray(note?.children) ? note.children : []) {
      const k = parentIdValue(kid?.id) ?? parentIdOfChild(kid?.id)
      if (k !== null && k > max) max = k
    }
  }
  return max + 1
}

export { IDS_VERSION, nodeMatches, nodeNeedsRenumber, needsRenumber, renumber, startIdAfter, archivedIdSet }
