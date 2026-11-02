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

/**
 * 判断是不是「父id-后缀」形式的子任务 id。
 *
 * id=77-B：父 id 从「正整数」变成了 6 位随机串（`aB3xK9`），所以这里**不能再假设
 * 父段一定是 `\d+`** —— 否则 `aB3xK9-A` 会被判成「不是子任务 id」，
 * 连带 `parentIdOfChild` 返回 null、`codeOf` 返回空串，界面上编号整片消失。
 *
 * 现在父段接受两种形状：
 * - `\d+`        —— 历史数据（`12-A`），必须继续认，否则旧 plan.json 全废；
 * - `[0-9A-Za-z]{6}` —— 新格式（`aB3xK9-A`）。
 *
 * 后缀仍是纯大写字母（A..Z, AA…），那是本文件自己的约定，没变。
 */
function isChildId(id) {
  return typeof id === 'string' && /^(?:\d+|[0-9A-Za-z]{6})-[A-Z]+$/.test(id)
}

/**
 * 取子任务 id 的父段（**原始文本**）；不是子任务 id 时返回 null。
 *
 * 与 `parentIdOfChild` 的区别：那个把父段转成数字（历史接口，新格式下会返回 null），
 * 这个返回文本，两种格式都能用。新代码应该优先用这个。
 */
function parentKeyOfChild(id) {
  if (!isChildId(id)) return null
  const text = String(id)
  return text.slice(0, text.lastIndexOf('-'))
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

/**
 * 一级 id → 数字；**认不出返回 null**。
 *
 * id=77-B：新 id 是 6 位随机串（`aB3xK9`），`Number()` 会得到 NaN，本函数返回 null。
 * 这是**有意的**：这个函数的语义就是「把它当数字用」（排序、算大小），
 * 随机 id 本来就不该参与数字运算。需要「取父段」请用 `parentKeyOfChild`，
 * 需要「判断是不是合法的一级 id」请用 `isTopId`。
 */
function parentIdValue(id) {
  const n = Number(id)
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * 判断是不是一个合法的一级 id（id=77-B 新增）。
 *
 * 两种历史形状都认：
 * - 正整数（`1`、`12`）—— 旧数据；
 * - 6 位 `0-9A-Za-z`（`aB3xK9`）—— 新数据。
 *
 * 注意「一级」= 不含后缀，所以 `12-A` 会返回 false（那是子任务）。
 */
function isTopId(id) {
  if (typeof id === 'number') return Number.isInteger(id) && id > 0
  if (typeof id !== 'string') return false
  if (/^[1-9]\d*$/.test(id)) return true
  return /^[0-9A-Za-z]{6}$/.test(id)
}

/**
 * 可展示的编号文本（id=360，id=77-B 扩展）。
 *
 * 规则只有一条：**编号就是 id 的文本形式**，不另设字段、不另算一遍。
 *
 * id=77-B 之前这里只认数字形状（`/^[1-9]\d*$/`、`/^[1-9]\d*-[A-Z]+$/`），
 * 换成随机 id 后 `aB3xK9` 与 `aB3xK9-A` 都会返回空串 —— 界面上编号整片空白。
 * 现在改用 `isTopId` / `isChildId` 判定，两种形状都接受：
 * - `12`       → `"12"`
 * - `"12-A"`   → `"12-A"`（历史）
 * - `"aB3xK9"` → `"aB3xK9"`（新）
 * - `"aB3xK9-A"` → `"aB3xK9-A"`（新子任务）
 * - 其他形状   → `""`（让调用方自己决定回退，不猜）
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
  if (isTopId(text)) return text
  if (isChildId(text)) return text
  return ''
}

export {
  childSuffix,
  suffixIndex,
  childIdOf,
  isChildId,
  parentKeyOfChild,
  parentIdOfChild,
  idKey,
  sameId,
  parentIdValue,
  isTopId,
  codeOf,
}
