/**
 * 「拆解产物」从扁平列表折叠成「父 + children」（id=272）。
 *
 * 背景：拆解模式把一句话拆成 N 条，N 条各自带 `decomposeKey` 与 `sourcePrompt`
 * 平铺在 `plan.json` 里。于是列表里看不出「这几条是同一批拆出来的」，
 * 同一份原始提示词还被复制 N 份 —— 项目自己的 plan.json 里 290 条就有 50 多份重复原文。
 *
 * 现在改成两级结构：
 * - 一级对象（父）：身份是 `decomposeKey`，保留 `sourcePrompt`（原始提示词）与自己的 `note`
 *   （拆分批注），`plan` 留空 —— 父不是要执行的任务，只是这一批的容器；
 * - `children`：真正的子任务，字段与一级**同构**（id / name / plan / status / note / …），
 *   只是不再嵌套第三层。
 *
 * 三条硬约束：
 * 1. **旧格式自动归一**：读到的是扁平列表（同一 `decomposeKey` 的多条）就折叠成父子，
 *    不需要用户手工迁移；
 * 2. **往返不丢字段**：折叠只搬位置，不改字段值 —— 子任务原样进 children，父拿到原文；
 * 3. **父 id 稳定**：折叠时给父分配 `maxId + 1` 并**立刻落盘一次**，之后每次读都是同一个 id。
 *    不做持久化的话，每次读都会算出不同的父 id，面板与命令行的 id 就会漂移。
 */
import { childIdOf, idKey } from './ids.js'
import { str } from './values.js'

/** 这条条目是不是「有 children 的父」。空数组视为普通条目（写盘时不留空 children）。 */
function hasChildren(item) {
  return item !== null && typeof item === 'object' && Array.isArray(item.children) && item.children.length > 0
}

/** 叶子条目：有 children 就展开成 children，否则就是它自己。父容器本身不参与执行。 */
function leaves(items) {
  const out = []
  for (const item of Array.isArray(items) ? items : []) {
    if (hasChildren(item)) out.push(...item.children)
    else out.push(item)
  }
  return out
}

/** 这条是不是拆解产物（同一批的子条目）。 */
function isSplitItem(item) {
  return str(item?.decomposeKey) !== ''
}

/** 所有已用的 id（父与子都算），用于给新父分配不撞号的 id。 */
function maxIdOf(items) {
  let max = 0
  for (const item of Array.isArray(items) ? items : []) {
    if (Number.isFinite(item?.id) && item.id > max) max = item.id
    for (const child of Array.isArray(item?.children) ? item.children : []) {
      if (Number.isFinite(child?.id) && child.id > max) max = child.id
    }
  }
  return max
}

/** 父的标题：优先用原始提示词的首行，其次退到第一条子任务的名字去掉 `[拆] ` 前缀。 */
function parentName(group, sourcePrompt) {
  const fromPrompt = str(sourcePrompt).replace(/[\s\u3000]+/g, ' ').trim()
  if (fromPrompt !== '') return fromPrompt.length <= 44 ? fromPrompt : `${fromPrompt.slice(0, 44)}…`
  const first = str(group[0]?.name).replace(/^\[拆\]\s*/, '').trim()
  return first !== '' ? first : '拆解批次'
}

/**
 * 把扁平列表折叠成两级结构。
 *
 * - 有 `decomposeKey` 且同一批出现 2 条以上的：合成一个父 + children；
 * - 只有 1 条的：保持原样（拆解失败/只拆出一条，没有「批」可言，硬造父只会多一层空壳）；
 * - 已经在 children 里的、或没有 decomposeKey 的：原样保留。
 *
 * 返回新数组，不改入参。父的位置取这一批**第一次出现**的位置，视觉顺序不变。
 */
function foldSplit(items, options) {
  const list = Array.isArray(items) ? items : []
  const opt = options !== null && typeof options === 'object' ? options : {}
  let nextId = Number.isFinite(opt.startId) ? opt.startId : maxIdOf(list)
  const groups = new Map()
  for (const item of list) {
    if (!isSplitItem(item) || hasChildren(item)) continue
    const key = str(item.decomposeKey)
    const bucket = groups.get(key)
    if (bucket === undefined) groups.set(key, [item])
    else bucket.push(item)
  }

  const out = []
  const emitted = new Set()
  for (const item of list) {
    if (!isSplitItem(item) || hasChildren(item)) {
      out.push(item)
      continue
    }
    const key = str(item.decomposeKey)
    const group = groups.get(key) ?? [item]
    if (group.length < 2) {
      out.push(item)
      continue
    }
    if (emitted.has(key)) continue
    emitted.add(key)
    nextId += 1
    out.push({
      // 父 id 从现有最大 id 往后分配：不与任何子任务撞号，也不与别批的父撞号。
      id: nextId,
      // 父的 order 取这一批第一条的 order：位置不变，拖拽后父整体移动。
      order: Number.isFinite(group[0].order) ? group[0].order : out.length,
      name: parentName(group, group[0].sourcePrompt),
      // 父不是可执行任务：正文留空，原文在 sourcePrompt 里，批注写在自己的 note 上。
      plan: '',
      mode: '',
      taskType: group[0].taskType,
      draft: group[0].draft === true,
      execute: false,
      review: false,
      interrupted: false,
      failed: group[0].failed === true,
      time: 0,
      note: '',
      finishedAt: '',
      createdAt: str(group[0].createdAt),
      decomposeKey: key,
      sourcePrompt: str(group[0].sourcePrompt),
      // 子任务原样搬进来：字段一个不改，只是换了位置（其中 sourcePrompt 被提到父上，
      // 子任务不必再各存一份原文 —— 那正是这次要消掉的重复体积）。
      // id=325：子任务 id 跟着父走（"<父id>-A"），不再沿用它们各自的全局数字。
      children: group.map((child, index) => ({ ...child, id: childIdOf(nextId, index), sourcePrompt: '', decomposeKey: key })),
    })
  }
  return out
}

/**
 * 折叠后是否需要落盘（供读路径判断）。
 *
 * 只要出现「同一批 ≥2 条仍平铺在顶层」就说明还是旧格式。已经在父下、或只有单条的，
 * 都不算 —— 前者是一次无意义的写，后者本来就不该折叠。
 */
function needsFold(items) {
  const counts = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    if (!isSplitItem(item) || hasChildren(item)) continue
    const key = str(item.decomposeKey)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const n of counts.values()) if (n >= 2) return true
  return false
}

/**
 * 在两级结构里按 id 找一条，返回 `{ item, parent, index, isChild }`。
 * 找不到返回 null。父与子共用 id 空间（折叠时保证不撞号），所以先找父再找子。
 */
function findNode(items, id) {
  const target = idKey(id)
  const list = Array.isArray(items) ? items : []
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i]
    if (idKey(item?.id) === target) return { item, parent: null, index: i, isChild: false }
    if (!hasChildren(item)) continue
    for (let j = 0; j < item.children.length; j += 1) {
      if (idKey(item.children[j]?.id) === target) return { item: item.children[j], parent: item, index: j, isChild: true }
    }
  }
  return null
}

/**
 * 按 id 替换一条（父或子都行），返回新数组；找不到时原样返回。
 * 用不可变写法：调用方（mutatePlan 的 mutator）靠「换一份新数组」决定要不要写盘。
 */
function replaceNode(items, id, next) {
  const target = idKey(id)
  let hit = false
  const out = (Array.isArray(items) ? items : []).map((item) => {
    if (idKey(item?.id) === target) {
      hit = true
      return next
    }
    if (!hasChildren(item)) return item
    let childHit = false
    const children = item.children.map((child) => {
      if (idKey(child?.id) !== target) return child
      childHit = true
      return next
    })
    if (!childHit) return item
    hit = true
    return { ...item, children }
  })
  return hit ? out : items
}

/**
 * 按 id 删除一条（父或子）。删掉父下最后一条子任务时，父也一起删 ——
 * 留一个没有 children 的空壳父，面板上就是一条永远点不开的空行。
 */
function removeNode(items, id) {
  const target = idKey(id)
  const out = []
  for (const item of Array.isArray(items) ? items : []) {
    if (idKey(item?.id) === target) continue
    if (!hasChildren(item)) {
      out.push(item)
      continue
    }
    const children = item.children.filter((child) => idKey(child?.id) !== target)
    if (children.length === item.children.length) {
      out.push(item)
      continue
    }
    if (children.length === 0) continue
    out.push({ ...item, children })
  }
  return out
}

export { hasChildren, leaves, isSplitItem, maxIdOf, foldSplit, needsFold, findNode, replaceNode, removeNode }
