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

/**
 * 可展示的编号文本（id=360）。
 *
 * 规则只有一条：**编号就是 id 的文本形式**，不另设字段、不另算一遍。
 * 理由（5-A 调研的结论）：子任务的 id 早就是 `<父id>-<后缀>` 形状（`childIdOf`），
 * 一级任务则是正整数 —— 两者恰好就是用户要在界面上看到的「组序号-任务字母」。
 * 再存一个 `code` 字段只会得到两份真值：`renumber` 改 id 之后 code 不跟着改就漂了，
 * 而「哪个是展示用的」这种问题一旦出现，两边迟早会不一致。
 *
 * 所以这里只做**格式归一与校验**，供任何需要「把 id 当文字画出来」的地方调用：
 * - `12`      → `"12"`（一级任务，组序号本身）
 * - `"12-A"`  → `"12-A"`（子任务，组序号 + 任务字母）
 * - 其他形状  → `""`（让调用方自己决定回退，不猜）
 *
 * 注意「组序号」取的是**父 id**，不是「这一组在列表里排第几」。两者在正常数据上
 * 恰好同序（order 连续、id 连续），但删过条目之后就会分开 —— 而 `renumber.js:5-13`
 * 已经把「编号是身份，不因为删条目整体顺延」定成了硬约定，
 * 所以这里必须跟 id 走，否则用户刚记住的编号下一次刷新就变了。
 *
 * @param {number|string} id
 * @returns {string} 可直接渲染的编号文本；认不出时为空串
 */
function codeOf(id) {
  if (typeof id === 'number') return Number.isInteger(id) && id > 0 ? String(id) : ''
  const text = String(id ?? '')
  if (/^[1-9]\d*$/.test(text)) return text
  if (isChildId(text) && /^[1-9]\d*-[A-Z]+$/.test(text)) return text
  return ''
}

export { childSuffix, suffixIndex, childIdOf, isChildId, parentIdOfChild, idKey, sameId, parentIdValue, codeOf }
