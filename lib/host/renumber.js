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
import { childIdOf, parentIdOfChild, parentIdValue } from './ids.js'

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

/** 编号里「任何时候出现都必须修」的毛病。 */
function hasDefects(list, base) {
  const seen = new Set()
  for (const item of list) {
    const own = parentIdValue(item?.id)
    if (own === null) return true
    const key = String(item.id)
    if (seen.has(key)) return true
    seen.add(key)
    // 落在归档已用的号段里 → 会和 notes.json 撞号，findAnywhere 会取错条目。
    if (own < base) return true
    const kids = Array.isArray(item.children) ? item.children : []
    if (kids.length === 0) continue
    const kidSeen = new Set()
    const shape = new RegExp('^' + own + '-[A-Z]+$')
    for (const kid of kids) {
      const text = String(kid?.id ?? '')
      if (!shape.test(text)) return true
      if (kidSeen.has(text)) return true
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
 * @param {number} startId 起始 id（归档最大号 + 1）
 * @param {boolean} [sequential] true 表示这是**旧数据**：连「号有洞」也算不规范，
 *   一律按现有顺序重排一次。迁移完成后再读不带这个开关，就只剩真缺陷要修。
 */
function needsRenumber(items, startId, sequential) {
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) return false
  const base = Number.isInteger(startId) && startId > 0 ? startId : 1
  if (hasDefects(list, base)) return true
  return sequential === true ? !isSequential(list, base) : false
}

/**
 * 按当前顺序重排（迁移那一次用；之后只剩真缺陷时也走这里）。
 *
 * @returns {{items: Array, changes: Array<{from: any, to: any}>}}
 *   `items` 与原数组引用相同 = 本来就合规，调用方据此跳过写盘。
 */
function renumber(items, startId, sequential) {
  const list = Array.isArray(items) ? items : []
  const base = Number.isInteger(startId) && startId > 0 ? startId : 1
  if (!needsRenumber(list, base, sequential === true)) return { items: list, changes: [] }
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

export { IDS_VERSION, nodeMatches, nodeNeedsRenumber, needsRenumber, renumber, startIdAfter }
