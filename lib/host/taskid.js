/**
 * 任务 id 的生成与校验（id=77-A）。
 *
 * 与 `ids.js` 的分工：那个模块管的是**既有** id 的形状（数字、`12-A` 这类子任务后缀）、
 * 比较与展示；本模块只管**新 id 的生成**与**格式校验**，两者互不依赖。
 *
 * ── 设计约束（题面明确要求的几条）─────────────────────────────────────────
 *
 * 1. **字符集 0-9A-Za-z**，长度恰好 6 位；
 * 2. **随机源可注入**：`makeId(random)` 接受一个返回 `[0,1)` 的函数，
 *    默认用 `crypto.getRandomValues` / `crypto.randomBytes`；
 * 3. **无副作用、不读写模块级可变状态、不依赖时间戳** ——
 *    同样输入（同样的随机序列）必须永远产出同样的结果，方便测试；
 * 4. **前端与 Node 脚本都能用**。
 *
 * ── 为什么第 4 条决定了本文件的形态 ─────────────────────────────────────
 * 插件的客户端半边是**一个工厂函数体**（`window.__ModuleLoader__.load({factory})`），
 * 片段之间共享同一函数作用域、**禁止 import/export**（`build.mjs` 会直接拦）。
 * 所以客户端不可能 `import` 本文件。
 *
 * 做法：本文件是**唯一实现**，客户端那边由 `src/client/05-taskid.js` 内联一份
 * **逐字相同的函数体**；`scripts/check-taskid-parity.mjs` 比对两者的函数体文本，
 * 不一致就让 `npm test` 失败。这样既不破坏客户端"无 import"的约束，
 * 又不会退化成两份会各自漂移的实现。
 *
 * ── 随机源怎么选 ─────────────────────────────────────────────────────────
 * 优先 `globalThis.crypto.getRandomValues`（浏览器与 Node 18+ 都有），
 * 退回 Node 的 `crypto.randomBytes`（老 Node 或特殊运行环境）。
 * 两者都不可用时**抛错**而不是退回 `Math.random`：
 * 任务 id 是持久化标识，撞号会导致两条任务变成同一条 ——
 * 宁可当场失败，也不要静默降级成一个可能撞号的弱随机。
 */

/** 字符集：小写字母 + 大写字母 + 数字。顺序固定，改动会让「同随机序列 → 同 id」失效。 */
const TASK_ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** 长度：恰好 6 位。 */
const TASK_ID_LENGTH = 6

/**
 * 默认随机源：返回 [0,1) 的浮点数。
 *
 * 用 `getRandomValues` 取 4 字节转成 [0,1)，而不是取 1 字节 —— 后者只有 256 档，
 * 映射到 62 个字符上分布会不均（`256 % 62 = 8`，前 8 个字符会多出约 3% 的概率）。
 * 4 字节有 2^32 档，偏差小到可以忽略。
 *
 * @returns {() => number} 无参函数，每次调用返回 [0,1)
 */
function defaultRandom() {
  const g = globalThis.crypto
  if (g !== undefined && typeof g.getRandomValues === 'function') {
    return () => {
      const buf = new Uint32Array(1)
      g.getRandomValues(buf)
      // 除以 2^32 得到 [0,1)
      return buf[0] / 4294967296
    }
  }
  // Node 的 crypto 模块（老版本没有 globalThis.crypto）
  try {
    // 动态引入会让本函数变成 async，破坏「同步生成」的契约，
    // 所以只在需要时尝试同步 require —— Node 的 CJS 环境里可用。
    const nodeCrypto = globalThis.require?.('node:crypto') ?? globalThis.require?.('crypto')
    if (nodeCrypto !== undefined && typeof nodeCrypto.randomBytes === 'function') {
      return () => nodeCrypto.randomBytes(4).readUInt32BE(0) / 4294967296
    }
  } catch {
    /* 落到下面的抛错 */
  }
  throw new Error('makeId: 找不到可用的加密随机源（crypto.getRandomValues 或 crypto.randomBytes）')
}

/**
 * 生成一个 6 位任务 id。
 *
 * @param {() => number} [random] 随机源，返回 [0,1)；默认用加密随机
 * @returns {string} 形如 `"aB3xK9"` 的 6 位字符串
 * @throws 随机源缺失，或注入的函数返回了非法值
 */
function makeId(random = defaultRandom()) {
  if (typeof random !== 'function') {
    throw new TypeError('makeId: random 必须是返回 [0,1) 的函数')
  }
  let out = ''
  for (let i = 0; i < TASK_ID_LENGTH; i += 1) {
    const r = random()
    if (typeof r !== 'number' || !Number.isFinite(r) || r < 0 || r >= 1) {
      throw new RangeError(`makeId: 随机源返回了非法值 ${String(r)}（要求 [0,1)）`)
    }
    // floor(r * 62) 落在 0..61；r < 1 保证不会越界
    out += TASK_ID_ALPHABET.charAt(Math.floor(r * TASK_ID_ALPHABET.length))
  }
  return out
}

/**
 * 校验一个值是否是可用的任务 id：**恰好 6 位、只含 0-9A-Za-z**。
 *
 * 刻意不接受数字 id（历史数据里的 `12`、`12-A`）—— 那是 `ids.js` 的
 * `isChildId` / `codeOf` 管的领域。本函数只回答「这能不能当新 id 用」。
 *
 * @param {unknown} value
 * @returns {boolean}
 *
 * @public —— 本步（77-A）只要求模块导出，实际调用在 77-B 接上。
 */
function isTaskId(value) {
  return typeof value === 'string' && new RegExp(`^[0-9A-Za-z]{${TASK_ID_LENGTH}}$`).test(value)
}

/**
 * 分配一个**当前列表里没用过**的 task id（id=77-B）。
 *
 * 生成后与现有 id 比对，撞了就重来，最多 `maxAttempts` 次。6 位 62 进制有
 * 620 亿种组合，正常情况一次就能成 —— 重试上限是防「随机源坏掉（比如恒返回 0）」
 * 导致死循环，而不是防真实碰撞。
 *
 * ⚠ 与旧逻辑的关键差别：旧代码是「取现有最大 id + 1」，**天然单调且必然唯一**，
 * 但它要求 id 是可比较的数字，于是 id 一旦换成随机串就彻底失效。
 * 新逻辑不依赖任何「id 有多大」的概念，只问「这个字符串在不在集合里」。
 *
 * @param {Iterable<unknown>} [existing] 已占用的 id（数字/字符串都接受，按文本比）
 * @param {object} [options]
 * @param {() => number} [options.random] 随机源，透传给 makeId
 * @param {number} [options.maxAttempts] 重试上限，默认 64
 * @returns {string} 6 位 id，且不在 existing 里
 * @throws 连续 maxAttempts 次都撞号（正常不会发生，说明随机源有问题）
 */
function allocateId(existing, options = {}) {
  const opt = options !== null && typeof options === 'object' ? options : {}
  const taken = new Set()
  for (const value of existing ?? []) {
    if (value === null || value === undefined) continue
    taken.add(String(value))
  }
  const maxAttempts = Number.isInteger(opt.maxAttempts) && opt.maxAttempts > 0 ? opt.maxAttempts : 64
  for (let i = 0; i < maxAttempts; i += 1) {
    const id = makeId(opt.random)
    if (!taken.has(id)) return id
  }
  throw new Error(`allocateId: 连续 ${maxAttempts} 次生成的 id 都与现有 id 重复，随机源可能有问题`)
}

/**
 * **统一的 id 分配入口**（id=5-B）。
 *
 * 为什么要多这一层：全仓有 10 处生成点，各自手动拼「已占用集合」。
 * 那种写法有两个隐患：
 *   ① 有人漏传某个集合（比如忘了 archivedIds）→ 生成出与归档撞号的 id；
 *   ② 同一批次里连生成多个时，后生成的看不到先生成的 → 批内撞号。
 *
 * 本函数把这两件事收进一处：**每分配一个，就把它记进 taken**，
 * 所以同一批次内天然不会互撞；调用方只需一次性把「外部已占用」传进来。
 *
 * @param {object} [options]
 * @param {string[]} [options.existing] 外部已占用的 id（当前列表 + 归档等）
 * @param {string[]} [options.reserved] 与 existing 同义，便于调用方表达"预留"
 * @param {number} [options.count] 一次要分配几个，默认 1
 * @returns {string[]} 分配出来的 id 数组（长度 = count）
 */
function createTaskIds(options = {}) {
  const opt = options !== null && typeof options === 'object' ? options : {}
  const count = Number.isInteger(opt.count) && opt.count > 0 ? opt.count : 1
  const taken = []
  for (const list of [opt.existing, opt.reserved]) {
    for (const value of list ?? []) {
      if (value === null || value === undefined) continue
      taken.push(String(value))
    }
  }
  const out = []
  for (let i = 0; i < count; i += 1) {
    const id = allocateId(taken, opt)
    out.push(id)
    taken.push(id)   // ★ 批内去重：后一个能看到前一个
  }
  return out
}

/**
 * 单个版：语义更直白的 `createTaskIds({...})[0]`。
 * 两套并存是因为大多数调用点只要一个 id，写成一次函数调用更好读。
 */
function createTaskId(options = {}) {
  return createTaskIds({ ...(options ?? {}), count: 1 })[0]
}

/**
 * 收集一棵任务树里所有已用的 id（父 + 子任务），扁平成一个数组。
 *
 * 供 `allocateId` 用。子任务 id 是 `<父id>-<后缀>`（见 ids.js 的 childIdOf），
 * 与父 id 不在同一个命名空间，但都塞进同一个 Set 里更省事 ——
 * 反正新分配的 6 位 id 不可能与 `xxx-A` 相等。
 *
 * @param {unknown[]} items
 * @returns {string[]}
 */
function collectIds(items) {  const out = []
  for (const item of Array.isArray(items) ? items : []) {
    if (item === null || typeof item !== 'object') continue
    if (item.id !== undefined && item.id !== null) out.push(String(item.id))
    for (const child of Array.isArray(item.children) ? item.children : []) {
      if (child !== null && typeof child === 'object' && child.id !== undefined && child.id !== null) {
        out.push(String(child.id))
      }
    }
  }
  return out
}

export {
  TASK_ID_ALPHABET,
  TASK_ID_LENGTH,
  makeId,
  isTaskId,
  defaultRandom,
  allocateId,
  // id=5-B：统一入口。新代码请用这两个，不要再直接调 allocateId。
  createTaskId,
  createTaskIds,
  collectIds,
}
