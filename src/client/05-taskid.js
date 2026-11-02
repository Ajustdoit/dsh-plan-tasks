
    /**
     * 任务 id 的生成与校验（id=77-A）—— **客户端内联版**。
     *
     * 这份实现与 `lib/host/taskid.js` 的**函数体逐字相同**，由
     * `scripts/check-taskid-parity.mjs` 守着（不一致就让 npm test 失败）。
     *
     * 为什么不能直接 import：
     * 客户端半边是一个工厂函数体，片段共享同一作用域且**禁止 import/export**
     * （build.mjs 会直接把带 import 的片段拦下来）。所以只能内联。
     *
     * 为什么不干脆只在客户端写一份、Node 那边抄：
     * 那会得到两份会各自漂移的实现 —— 而 id 的字符集/长度一旦两边不一致，
     * 前端认为合法的 id 后端会拒绝（或反过来），表现为「新建的任务打不开」。
     * 所以选了「一份权威实现 + 一份内联副本 + 自动比对」。
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
     * @public —— 本步（77-A）只要求模块导出这个函数，实际调用在 77-B 接上。
     * 标记 @public 让 `unused-decls.mjs` 跳过「暂未引用」告警，
     * 而不是去写一个假装在用它的占位调用。
     */
    function isTaskId(value) {
      return typeof value === 'string' && new RegExp(`^[0-9A-Za-z]{${TASK_ID_LENGTH}}$`).test(value)
    }
