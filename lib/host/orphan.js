/* A（宿主侧）：把「被派发过、但从没真正跑起来」的条目落成已中断。
 *
 * 为什么需要：api.js 的 dispatch 发出提示词后就写 startedAt（id=343），
 * 但那一轮如果没跑起来（turn 空转 / 立刻结束 / 客户端没订阅到 running），
 * 就没有任何代码把它改回来 —— execute 仍是 false、startedAt 还在，
 * 于是 isRunning 永远为真：既显示「执行中」，又删不掉（删除拿 isRunning 当闸门）。
 *
 * ── id=ImWOun：修正「跑完了但没回填」被误判成中断 ──────────────────────
 *
 * 原判据用「**有没有产出**」推断「**有没有跑起来**」：
 *     没完成 + startedAt 可解析 + time===0 + note==='' + 超过 30 分钟 → 判中断
 *
 * 但这两件事不是一回事。真实翻车场景：
 *   · 模型**真的跑完了**，只是没调 `q.mjs done` 回填 →
 *     time 仍为 0、note 仍为空 → 被当成「派发了但从没跑起来」→ 误标 interrupted。
 *   · 「仅回答」类型尤其容易中招：它的产出是**对话里的回答文本**，
 *     既不改文件、也不产生 note，天然没有「产出物」可当证据。
 *   · 原注释还自称「30 分钟足够覆盖最长的单条任务」，紧接着又写
 *     「本仓实测最长 40 分钟」—— **40 > 30，这个前提本身自相矛盾**。
 *     348-A 没被误伤只是因为它有 time > 0，不是因为宽限期够。
 *
 * 本次整改（三处）：
 *
 *   1. **宽限期 30 → 120 分钟**。改成「明确大于已知最长任务」而不是等于。
 *      dispatch 的宽限是给「turn 空转」兜底的，空转是秒级现象，
 *      真正需要长时间等待的是**正常运行中的任务**——把这两件事混在一个计时器里，
 *      就只能取更长的那一侧。
 *
 *   2. **「仅回答」用更长宽限**（默认 6 小时，普通任务 2 小时）。
 *      它没有文件产出、没有 note，用「产出」当判据对它天然不公平。
 *      最早的做法是**直接豁免**，但那会让真空转的仅回答条目永远不被回收 ——
 *      一个坑换另一个坑。现在改成「判得晚很多」而不是「不判」。
 *      两档宽限都可配置（settings.json 的 orphanGraceMin / orphanGraceAnswerMin）。
 *
 *   3. **给出显式的自愈路径**（见下面 recoverOrphanStarts 的注释）：
 *      即便真的误判了，`done` 不接受 interrupted 作为拒绝理由，
 *      用户回填一句就恢复正常；`继续` 按钮也会优先捞出 interrupted 的条目。
 *
 * 纯函数：时间由调用方传入，函数自己不读时钟。
 */

import { normalizeTime } from './timing.js'
import { str } from './values.js'

/**
 * 多久没产出就算「这个 startedAt 是孤儿」。
 *
 * id=ImWOun：30 → 120 分钟。已知最长单条任务是 40 分钟，原来取 30 是**小于**它的，
 * 只因为那条恰好有 time > 0 才没被误伤。取 120 = 已知最长 × 3，留足余量。
 */
const ORPHAN_GRACE_MS = 120 * 60 * 1000
/** 「仅回答」的默认宽限：6 小时（id=ImWOun 后续优化）。 */
const ORPHAN_GRACE_ANSWER_MS = 360 * 60 * 1000

/**
 * 取一条适用的宽限（毫秒）。
 *
 * 第三个参数有两种形态，都支持：
 *   · 数字            → 普通任务的宽限（老调用方 / 测试用）
 *   · { normal, answer } → 两档分别给（新调用方，从 settings 读）
 *
 * 为什么要分两档：「仅回答」天然没有产出物（回答在对话里，不产生 note / time），
 * 用「有没有产出」判它必然误判。原来一度直接豁免它，但那会让**真空转的**
 * 仅回答条目永远不被回收 —— 一个坑换成另一个坑。给它长得多的宽限更合适：
 * 正常情况几分钟就答完，6 小时足够；真空转了 6 小时后照样能收回去。
 */
function graceFor(item, graceMs) {
  const isAnswer = str(item?.taskType) === '仅回答'
  if (typeof graceMs === 'number' && Number.isFinite(graceMs) && graceMs >= 0) {
    // 老形态：一个数字对所有人生效（测试常用短宽限）
    return graceMs
  }
  const normal = Number.isFinite(graceMs?.normal) && graceMs.normal >= 0 ? graceMs.normal : ORPHAN_GRACE_MS
  const answer = Number.isFinite(graceMs?.answer) && graceMs.answer >= 0 ? graceMs.answer : ORPHAN_GRACE_ANSWER_MS
  return isAnswer ? answer : normal
}

/**
 * 判断一条是否「派发过但从未跑起来」的孤儿。
 * @param {object} item 已归一的条目
 * @param {number} now 当前时刻（毫秒）
 * @param {number|object} graceMs 宽限（数字，或 { normal, answer }）
 */
function isOrphanStart(item, now, graceMs) {
  if (item === null || typeof item !== 'object') return false
  if (item.execute === true) return false
  if (item.draft === true || item.failed === true || item.interrupted === true) return false
  const started = Date.parse(str(item.startedAt))
  if (!Number.isFinite(started)) return false
  // id=ImWOun 后续优化：**最强证据** —— turn 真的结束过。
  //
  // 客户端在 `agentRunning` 由 true 翻成 false 时调 `markTurnEnd` 写这个字段。
  // 有它就说明「这一轮确实跑起来了」，哪怕模型忘了调 q.mjs done
  //（于是 time / note 仍是空的）也不算孤儿。
  //
  // 这是把判据从「有没有产出」换成「turn 有没有结束」的落点：
  // 产出是间接证据（会漏，比如仅回答），turn 结束是直接证据。
  if (str(item.turnEndedAt) !== '') return false
  // 次强证据：有产出（耗时或备注）说明真跑过。
  if (normalizeTime(item.time) > 0) return false
  if (str(item.note) !== '') return false
  // 兜底：既没 turn 结束标记、也没产出 —— 按宽限判。
  // 「仅回答」用更长的一档（详见 graceFor）：它天然没有产出物，
  // 但直接豁免会让真空转的条目永远不回收。
  return now - started > graceFor(item, graceMs)
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

export { ORPHAN_GRACE_ANSWER_MS, ORPHAN_GRACE_MS, graceFor, isOrphanStart, recoverOrphanStarts }
