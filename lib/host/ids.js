/**
 * 任务编号规则（id=325）。
 *
 * 用户的诉求：编号要能看出层级。一级任务按出现顺序是 1、2、3…；它下面的 children
 * 不再抢全局的自增数字，而是「一级id-后缀」—— `1-A`、`1-B`、`27-AA`。
 * 这样：
 * 1. 一眼能看出这条子任务属于哪一批（`12-C` 就在 #12 下面）；
 * 2. 子任务增删不会让后面所有条目的号码整体前移（以前删一条就从 100 变成 99）；
 * 3. id 只在「一级任务内部」唯一，不再需要一张全局表。
 *
 * 三个约定：
 * - **一级 id 仍是正整数**（沿用历史：plan.json 里已经有一堆数字 id，命令行也按它记账）；
 * - **子任务 id 是字符串** `"<一级id>-<后缀>"`，后缀是 A..Z, AA, AB…（26 进制、无 0）；
 * - 比较一律走 `idKey()`（统一转字符串），别再写 `Number(a.id) === Number(b.id)`
 *   —— 字符串 id 会被 Number() 变成 NaN，两处都用 NaN 比较会「相等」，那是灾难。
 */

/** 后缀：0 → A、25 → Z、26 → AA、27 → AB …（Excel 列名的同一套算法）。 */
function childSuffix(index) {
  const n = Number.isInteger(index) && index >= 0 ? index : 0
  let rest = n + 1
  let out = ''
  while (rest > 0) {
    const r = (rest - 1) % 26
    out = String.fromCharCode(65 + r) + out
    rest = Math.floor((rest - 1) / 26)
  }
  return out
}

/** 后缀反解回序号：A → 0、Z → 25、AA → 26。认不出返回 -1。 */
function suffixIndex(suffix) {
  const text = String(suffix ?? '').toUpperCase()
  if (!/^[A-Z]+$/.test(text)) return -1
  let out = 0
  for (const ch of text) out = out * 26 + (ch.charCodeAt(0) - 64)
  return out - 1
}

/** 一级任务下的第 index 个子任务 id。 */
function childIdOf(parentId, index) {
  return `${String(parentId)}-${childSuffix(index)}`
}

/** 判断是不是「一级id-后缀」形式的子任务 id。 */
function isChildId(id) {
  return typeof id === 'string' && /^\d+-[A-Z]+$/.test(id)
}

/** 取子任务 id 的一级部分（**数字**）；不是子任务 id 时返回 null。 */
function parentIdOfChild(id) {
  if (!isChildId(id)) return null
  const [head] = String(id).split('-')
  const n = Number(head)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** 统一比较用的键：数字与字符串一视同仁。 */
function idKey(id) {
  return String(id ?? '')
}

/** 两条是不是同一条（兼容历史数字 id 与新的字符串 id）。 */
function sameId(a, b) {
  return idKey(a) === idKey(b)
}

/** 一级 id（正整数）→ 数字；认不出返回 null。 */
function parentIdValue(id) {
  const n = Number(id)
  return Number.isInteger(n) && n > 0 ? n : null
}

export { childSuffix, suffixIndex, childIdOf, isChildId, parentIdOfChild, idKey, sameId, parentIdValue }
