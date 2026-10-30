/**
 * 「待审核」自动通过（id=300）。
 *
 * 用户要的是：待审核上面多一个条数设置，超过这个条数就自动把**最旧的一条**通过掉，
 * 于是队列不会无限长，用户也不必一条条点。档位与「需要保留的 note 条数」共用一组
 * （100/200/500/1000），默认 200。
 *
 * 三个刻意的口径：
 * 1. **跟面板的「待审核」组同一套判定** —— 面板把拆解批次当一个整体看（children 全做完
 *    且没全审完=这条父在待审核），这里也照此：一条父算一条，通过时把它的 children
 *    全部标成已审。否则自动通过只改父的容器标记，children 还挂着「未审核」，
 *    下一次读盘又会把它判回待审核，来回抖。
 * 2. **最旧的那条**用 `noteTimeOf`（与淘汰同源）：先 finishedAt、再 startedAt、
 *    再 createdAt、最后 id。两处用不同口径会出现「自动通过的总是最新那条」这种反向行为。
 * 3. **一次收敛到阈值**：超出多少条就补多少条（按从旧到新）。只补一条的话，
 *    积压 300 条时要刷新 100 次才降到 200，用户会以为没生效。
 *
 * 纯函数只回答「该通过哪些」，落盘与归档交给调用方（api.read），方便单测。
 */
import { parentIdValue } from './ids.js'
import { noteTimeOf } from './trim.js'

/** 一条顶层条目是不是「待审核」：拆解批次看 children，普通条目看自己的 execute/review。 */
function isUnreviewedBatch(item) {
  if (item === null || typeof item !== 'object') return false
  if (item.draft === true) return false
  const kids = Array.isArray(item.children) ? item.children : []
  // id=372：脏项（null / 字符串）先滤掉再判。
  // 原来直接 `.every(kid => kid.execute ...)`，数组里只要有一个 null 就抛
  // `Cannot read properties of null` —— 而这个函数跑在 `read` 路由的自动通过扫描里，
  // 也就是**每 5 秒一次的轮询**。一条脏数据能让整个面板读不出数据，
  // 症状是「列表一直转圈」，原因却在一个根本不该走到的地方。
  // 滤掉脏项在语义上也对：它们不是「待审核的任务」，无从审核。
  const live = kids.filter((kid) => kid !== null && typeof kid === 'object')
  if (live.length > 0) return live.every((kid) => kid.execute === true) && !live.every((kid) => kid.review === true)
  return item.execute === true && item.review !== true
}

/**
 * 待审核里最旧的若干条（只取超出的那几条）。
 *
 * @param {Array} items plan.json 的顶层条目（已归一）
 * @param {number} limit 自动通过的条数阈值；非正数 / 非整数表示不启用
 * @returns {Array} 需要自动通过的最旧条目（从旧到新）
 */
function pickAutoReview(items, limit) {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : 0
  const list = Array.isArray(items) ? items : []
  if (cap === 0) return []
  const pending = list.filter(isUnreviewedBatch)
  if (pending.length <= cap) return []
  const sorted = pending.slice().sort((a, b) => noteTimeOf(a) - noteTimeOf(b)
    || (parentIdValue(a.id) ?? 0) - (parentIdValue(b.id) ?? 0))
  return sorted.slice(0, pending.length - cap)
}

/**
 * 把挑中的条目标记成「已审核」。
 *
 * 拆解批次：children 全部 review=true（父自己的 review 只是容器标记，也一并落上，
 * 免得面板与归档口径不一致）；普通条目：自己 review=true，并把完成时刻补上
 * —— 归档淘汰要用 finishedAt，缺了就退到 startedAt/createdAt，排序会偏。
 *
 * id=372：children 逐项**先挡脏数据再展开**。
 *
 * 这里原来直接 `{ ...kid, ... }`，而 `{ ...null }` 得到 `{}`、随后读 `kid.finishedAt`
 * 就抛 `Cannot read properties of null`。一条脏数据（手改 plan.json、旧版本写坏的
 * 数组）能让**整批通过**整个失败 —— 而这正是本任务要求「不抛错、能正常落库」的场景。
 *
 * 现在两件事：
 * 1. 不是对象的项原样留着（不制造空洞、也不猜它该变成什么），只跳过标记；
 * 2. 是对象的项照常标 review + finishedAt。
 *
 * 为什么不直接把 null 过滤掉：这个函数的返回值会被 `replaceNode` 整体写回
 * plan.json，删元素等于悄悄改变这一批的条数。脏数据该由读盘归一（store 的
 * `normalizeNode`）或修复流程处理，不该在一次「通过」里被动蒸发。
 */
function approveItem(item, now) {
  const stamp = typeof now === 'string' && now !== '' ? now : new Date().toISOString()
  if (item === null || typeof item !== 'object') return item
  const kids = Array.isArray(item.children) ? item.children : []
  if (kids.length > 0) {
    return {
      ...item,
      review: true,
      children: kids.map((kid) => {
        // 脏项（null / 字符串）：原样保留，只跳过标记。见上面第 1 条。
        if (kid === null || typeof kid !== 'object') return kid
        return { ...kid, review: true, finishedAt: kid.finishedAt || stamp }
      }),
    }
  }
  return { ...item, review: true, finishedAt: item.finishedAt || stamp }
}

export { approveItem, isUnreviewedBatch, pickAutoReview }
