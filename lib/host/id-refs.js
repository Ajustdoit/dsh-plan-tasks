/**
 * 编号归一时的「引用同步」（id=348-B）。
 *
 * `renumber()` 只改条目**自己**的 id（一级数字 + children 的 `父id-后缀`）。
 * 但 id 是身份，项目里还有别的地方**引用**这些 id：
 *
 * 1. `.plan/dispatch.json` 的 `groupId`（锁在哪一组）与 `delivered[]`（投过哪几条）——
 *    这是我们自己写的运行时记账，重排后它们全部指向不存在的编号，成了孤儿引用；
 * 2. plan.json 内部：children 的 id 里嵌着父 id（`12-C`），父改号后子必须跟着改 ——
 *    这一条 `renumber()` 已经处理了；
 * 3. 未来可能出现的指向性字段（父级 id / 依赖列表）。
 *
 * 所以这里做两件事：
 * - **映射**：把 `renumber()` 产出的 `changes` 变成一张 `旧 → 新` 表；
 * - **重写引用**：只改**明确列为引用**的字段，绝不深度遍历任意文本 ——
 *   `plan` / `note` 是模型写的正文，里面出现 "12-A" 只是在讲编号，不是引用，
 *   改它会篡改任务内容（这是这类迁移最容易犯的错）。
 */

/** 把 `changes`（`[{from, to}]`）折成 `Map<旧id字符串, 新id>`。 */
function buildIdMap(changes) {
  const map = new Map()
  for (const change of Array.isArray(changes) ? changes : []) {
    if (change === null || typeof change !== 'object') continue
    const from = change.from
    const to = change.to
    if (from === undefined || from === null || to === undefined || to === null) continue
    const key = String(from)
    // 旧数据本来就可能有重复 id；此时映射天然有歧义，取第一条出现的位置
    // （重排后它们各自有了唯一编号，第二次跑就不会再撞）。
    if (!map.has(key)) map.set(key, to)
  }
  return map
}

/**
 * 按映射改写一个 id 值。映射里没有就原样返回 —— 指向归档条目、或本来就没动的编号，
 * 都不该被顺手改掉。
 *
 * 返回 `{ value, changed }`：`changed` 让调用方知道要不要写盘。
 */
function remapIdValue(id, map) {
  if (!(map instanceof Map) || map.size === 0) return { value: id, changed: false }
  const key = String(id ?? '')
  if (!map.has(key)) return { value: id, changed: false }
  return { value: map.get(key), changed: true }
}

/** 按映射改写一组 id（去重保留顺序）。 */
function remapIdList(list, map) {
  const out = []
  const seen = new Set()
  let changed = false
  for (const id of Array.isArray(list) ? list : []) {
    const one = remapIdValue(id, map)
    if (one.changed) changed = true
    const key = String(one.value ?? '')
    if (seen.has(key)) { changed = true; continue }
    seen.add(key)
    out.push(one.value)
  }
  return { value: out, changed }
}

/**
 * 重写一份「带 id 引用」的游标对象。
 *
 * 只碰 `groupId` 与 `delivered` 两个字段 —— 它们是 dispatch.json 的**全部**引用面。
 * `updatedAt` 不动：它记的是「上一次投递的时刻」，跟编号无关。
 */
function remapCursorRefs(cursor, map) {
  if (cursor === null || typeof cursor !== 'object') return { cursor, changed: false }
  let changed = false
  const group = remapIdValue(cursor.groupId, map)
  if (group.changed) changed = true
  const delivered = remapIdList(cursor.delivered, map)
  if (delivered.changed) changed = true
  if (!changed) return { cursor, changed: false }
  return { cursor: { ...cursor, groupId: group.value, delivered: delivered.value }, changed: true }
}

/**
 * 归一之后的体检：重复 id / children 形状不对 / 子任务的父部分与父对不上。
 *
 * 为什么要单独查一遍：`renumber()` 是「按位置重新发号」，正常输入下必然合规；
 * 但如果输入本身是脏的（同一批里两条 id 相同、children 里混着字符串），
 * 发号之后仍可能留下重复 —— 这类问题必须在写盘**之前**发现，否则写进去就是坏数据。
 *
 * @returns {Array<string>} 问题清单，空数组 = 没问题
 */
function validateRenumbered(items) {
  const problems = []
  const list = Array.isArray(items) ? items : []
  const seenTop = new Set()
  for (const item of list) {
    if (item === null || typeof item !== 'object') { problems.push('列表里混着非对象'); continue }
    if (!Number.isInteger(item.id) || item.id <= 0) problems.push(`一级 id 不是正整数：${String(item.id)}`)
    const key = String(item.id)
    if (seenTop.has(key)) problems.push(`一级 id 重复：${key}`)
    seenTop.add(key)
    const kids = Array.isArray(item.children) ? item.children : []
    const seenKid = new Set()
    for (const kid of kids) {
      if (kid === null || typeof kid !== 'object') { problems.push(`父 ${key} 的 children 里混着非对象`); continue }
      const text = String(kid.id ?? '')
      if (!/^\d+-[A-Z]+$/.test(text)) { problems.push(`子任务 id 形状不对：${text}`) ; continue }
      const head = text.split('-')[0]
      if (head !== key) problems.push(`子任务 ${text} 的父部分与父 ${key} 对不上`)
      if (seenKid.has(text)) problems.push(`子任务 id 重复：${text}`)
      seenKid.add(text)
    }
  }
  return problems
}

export { buildIdMap, remapCursorRefs, remapIdList, remapIdValue, validateRenumbered }
