/**
 * 模型调用的缓存与超时（id=350）。
 *
 * 盘点（id=345）之后，全插件只剩**一个**模型调用点：拆解。它的问题不是「调用多」，
 * 而是「同一句话会被重复调用」：
 * - 用户双击「拆解」；
 * - 拆完不满意，删掉再拆一次（同一句话）；
 * - 两个页签对着同一个项目同时点。
 *
 * 这个模块做三件事，全部与具体模型无关（纯逻辑 + 一个 Map）：
 * 1. **按输入缓存**：key = sha1(问题 + 模式 + 条数上下限 + 项目根 + 项目快照指纹)。
 *    同一 key 在 TTL 内直接命中，省掉一次几十秒的往返。
 * 2. **合并并发**：同一个 key 正在飞的时候，后来的请求**等**那一次的结果，不另开一次。
 * 3. **超时与降级**：超过 `timeoutMs` 就放弃这一次（AbortController），
 *    由调用方决定是报错还是走纯函数兜底 —— 本模块只负责「按时放弃」。
 *
 * 为什么不去缓存「按行拆」这类纯函数路径：它们本来就是毫秒级，缓存只会多一层状态。
 */

import { createHash } from 'node:crypto'

/** 默认缓存时间：10 分钟。拆解结果只在这段时间内复用 —— 更久之后项目可能已经变了。 */
const DEFAULT_TTL_MS = 10 * 60 * 1000

/** 默认超时：90 秒。拆解是唯一会卡住面板的操作，超时必须自己先放弃。 */
const DEFAULT_TIMEOUT_MS = 90 * 1000

/** 最多缓存多少份结果（防止长会话把内存吃光）。 */
const MAX_ENTRIES = 32

/**
 * 从项目快照里剥掉「我们自己的记账文件」，得到可以进缓存 key 的指纹。
 *
 * 为什么要剥：.plan/ 下的 plan.json / notes.json / settings.json / q.mjs / dispatch.json
 * 都是插件自己写的 —— 拆解本身就会改它们。把它们算进 key，等于每拆一次就让缓存失效一次，
 * 缓存永远不会命中（实测就是这样：第一次拆完多了个 q.mjs，第二次 key 就变了）。
 *
 * 保留的是项目本身的内容：目录树里的业务文件、README、AGENTS、最近提交、历史计划标题。
 * 这些变了，同一个问题的拆解结果确实应该重新生成。
 */
function fingerprintOf(snapshot) {
  return String(snapshot ?? '')
    .split(String.fromCharCode(10))
    .filter((line) => !/^-\s*\.plan(\/|$)/.test(line.trim()))
    .filter((line) => !line.includes('快照已截断'))
    .join(String.fromCharCode(10))
}

/** key 的构成：所有会影响拆解结果的输入，一个都不能少。 */
function cacheKeyOf({ question, mode, taskType, min, max, deep, cwd, snapshotFingerprint }) {
  const hash = createHash('sha1')
  hash.update(String(cwd ?? ''))
  hash.update('\u0000')
  hash.update(String(question ?? '').trim())
  hash.update('\u0000')
  hash.update(String(mode ?? ''))
  hash.update('\u0000')
  hash.update(String(taskType ?? ''))
  hash.update('\u0000')
  hash.update(`${min ?? ''}/${max ?? ''}`)
  hash.update('\u0000')
  hash.update(deep === true ? '1' : '0')
  hash.update('\u0000')
  // 项目快照的指纹：同一个问题在不同版本的项目里应该拆出不同结果。
  hash.update(String(snapshotFingerprint ?? ''))
  return hash.digest('hex').slice(0, 32)
}

/** 一个极简 TTL 缓存（不引入依赖；条目数有上限，超了丢最旧的）。 */
class ModelCache {
  constructor({ ttlMs = DEFAULT_TTL_MS, maxEntries = MAX_ENTRIES, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs
    this.maxEntries = maxEntries
    this.now = now
    /** @type {Map<string, {value: any, at: number}>} */
    this.entries = new Map()
  }

  get(key) {
    const hit = this.entries.get(key)
    if (hit === undefined) return undefined
    if (this.now() - hit.at > this.ttlMs) {
      this.entries.delete(key)
      return undefined
    }
    return hit.value
  }

  set(key, value) {
    this.entries.delete(key)
    this.entries.set(key, { value, at: this.now() })
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
    return value
  }

  /** 主动清掉（设置变更 / 项目文件变化时用）。 */
  clear() {
    this.entries.clear()
  }

  get size() {
    return this.entries.size
  }
}

/**
 * 带缓存 + 并发合并 + 超时的一次调用。
 *
 * @param {ModelCache} cache
 * @param {string} key
 * @param {(signal: AbortSignal) => Promise<any>} run 真正干活的函数（会拿到一个可中止的 signal）
 * @param {{timeoutMs?: number, inFlight?: Map<string, Promise<any>>}} opts
 *   `inFlight` 由调用方传入才能跨请求合并（默认每次调用自己新建一个，只合并本次）。
 */
async function cachedCall(cache, key, run, opts = {}) {
  const cached = cache.get(key)
  if (cached !== undefined) return { value: cached, cached: true, merged: false }

  const inFlight = opts.inFlight ?? new Map()
  const pending = inFlight.get(key)
  if (pending !== undefined) {
    // 同 key 正在飞：等它，不再发一次。失败也要把错误原样抛给后来的调用方。
    return { value: await pending, cached: false, merged: true }
  }

  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  let timer = null
  const task = (async () => {
    try {
      const value = await run(controller.signal)
      cache.set(key, value)
      return value
    } finally {
      inFlight.delete(key)
      if (timer !== null) clearTimeout(timer)
    }
  })()
  inFlight.set(key, task)
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`模型调用超时（${Math.round(timeoutMs / 1000)} 秒）`)
      error.code = 'timeout'
      try { controller.abort() } catch { /* 忽略 */ }
      reject(error)
    }, timeoutMs)
    // 刻意**不** unref：底层调用挂住时，事件循环里只剩这个定时器，
    // unref 掉的话进程会在超时触发前就退出（表现为顶层 await 永远不 settle）。
    void resolve
  })
  try {
    const value = await Promise.race([task, timeout])
    return { value, cached: false, merged: false }
  } catch (error) {
    // 超时时把 in-flight 清掉，否则后来者会一直等一个已经放弃的任务。
    inFlight.delete(key)
    throw error
  }
}

export {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TTL_MS,
  MAX_ENTRIES,
  ModelCache,
  cacheKeyOf,
  cachedCall,
  fingerprintOf,
}
