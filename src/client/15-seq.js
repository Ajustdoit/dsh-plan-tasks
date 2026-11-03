/**
 * 序号派生（id=fzTvER-A）—— **与 `lib/host/order.js` 的 `sequenceOf` / `sequenceMapOf`
 * 保持逐字一致**。
 *
 * ── 为什么要复制一份 ──────────────────────────
 * 客户端片段只能 `require('react')`，无法 import 宿主的 `order.js`
 * （见 00-loader-head.js 的加载方式）。而任务要求「该函数作为唯一序号来源，
 * 供宿主接口与客户端渲染共用」——
 *
 * 在「不能跨端 import」的前提下，能做到的最接近的形式是：
 *   · 宿主那份是**权威实现**（`lib/host/order.js`）；
 *   · 这里这份是**镜像**，函数体逐字相同；
 *   · 用 `scripts/check-seq-parity.mjs` 做**一致性测试**：
 *     逐字比对两边的函数体，任何一边改了另一边没跟上就直接报错。
 *
 * 这比「两边各写一套、靠注释提醒」可靠：注释不会失败，测试会。
 *
 * ── 约定（与宿主那份完全相同）──────────────
 * 1. 不写回、不改 order；返回新数组
 * 2. order 缺失或相等时**保持入参顺序**（不二次排序）
 * 3. 跳过非对象元素，序号保持连续
 */

/** 派生序号：按入参顺序映射成 1 起序号。 */
function sequenceOf(items) {
  const out = []
  let seq = 0
  for (const item of Array.isArray(items) ? items : []) {
    if (item === null || typeof item !== 'object') continue
    seq += 1
    out.push({ id: item.id, seq })
  }
  return out
}

/** 便捷形态：直接返回「id → 序号」的 Map。 */
function sequenceMapOf(items) {
  const map = new Map()
  for (const { id, seq } of sequenceOf(items)) map.set(id, seq)
  return map
}
