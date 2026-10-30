/* A（宿主侧）：把「被派发过、但从没真正跑起来」的条目落成已中断。
 *
 * 为什么需要：api.js 的 dispatch 发出提示词后就写 startedAt（id=343），
 * 但那一轮如果没跑起来（turn 空转 / 立刻结束 / 客户端没订阅到 running），
 * 就没有任何代码把它改回来 —— execute 仍是 false、startedAt 还在，
 * 于是 isRunning 永远为真：既显示「执行中」，又删不掉（删除拿 isRunning 当闸门）。
 *
 * 判据刻意保守，四个条件同时满足才回收：
 *   1. 没完成、不是草稿 / 失败 / 已中断；
 *   2. 有可解析的 startedAt；
 *   3. 耗时仍为 0 且没有 note —— 说明这一轮根本没产出任何东西；
 *   4. startedAt 已经过去超过 GRACE_MS（默认 30 分钟）—— 足够覆盖最长的单条任务
 *      （本仓实测最长 40 分钟的那条是 348-A，而它是正常跑完的，有 time > 0，
 *      条件 3 就不满足，不会被误伤）。
 *
 * 纯函数：时间由调用方传入，函数自己不读时钟。
 */

import { normalizeTime } from './timing.js'
import { str } from './values.js'

/** 多久没产出就算「这个 startedAt 是孤儿」。30 分钟。 */
const ORPHAN_GRACE_MS = 30 * 60 * 1000

/**
 * 判断一条是否「派发过但从未跑起来」的孤儿。
 * @param {object} item 已归一的条目
 * @param {number} now 当前时刻（毫秒）
 * @param {number} graceMs 宽限
 */
function isOrphanStart(item, now, graceMs) {
  if (item === null || typeof item !== 'object') return false
  if (item.execute === true) return false
  if (item.draft === true || item.failed === true || item.interrupted === true) return false
  const started = Date.parse(str(item.startedAt))
  if (!Number.isFinite(started)) return false
  // 有产出（耗时或备注）就说明真跑过，不能动它。
  if (normalizeTime(item.time) > 0) return false
  if (str(item.note) !== '') return false
  const limit = Number.isFinite(graceMs) && graceMs >= 0 ? graceMs : ORPHAN_GRACE_MS
  return now - started > limit
}

/**
 * 扫一遍条目，把孤儿 startedAt 落成 `interrupted: true`（startedAt 保留，续做仍能接上）。
 *
 * 返回 `{ items, recovered }`：`recovered` 是被回收的 id 数组；没东西要改时
 * `items` 原样返回**同一个引用**，调用方据此决定要不要写盘。
 */
function recoverOrphanStarts(items, now, graceMs) {
  const list = Array.isArray(items) ? items : []
  const at = Number.isFinite(now) ? now : Date.now()
  const recovered = []
  let dirty = false
  const next = list.map((item) => {
    if (item === null || typeof item !== 'object') return item
    const kids = Array.isArray(item.children) ? item.children : []
    let kidsDirty = false
    const nextKids = kids.length === 0 ? kids : kids.map((kid) => {
      if (!isOrphanStart(kid, at, graceMs)) return kid
      kidsDirty = true
      recovered.push(kid.id)
      // 只补 interrupted，startedAt / note / execute 一律不动：
      // 将来「继续」还能按续做接上，而不是重跑。
      return { ...kid, interrupted: true }
    })
    let self = item
    if (isOrphanStart(item, at, graceMs)) {
      recovered.push(item.id)
      self = { ...item, interrupted: true }
    }
    if (kidsDirty) {
      dirty = true
      return { ...self, children: nextKids }
    }
    if (self !== item) {
      dirty = true
      return self
    }
    return item
  })
  return { items: dirty ? next : items, recovered }
}

export { ORPHAN_GRACE_MS, isOrphanStart, recoverOrphanStarts }
