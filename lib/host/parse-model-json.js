/**
 * 模型输出的确定性解析（id=349）。
 *
 * 拆解要求模型返回 `{"tasks":[{name,plan,taskType},…], "cut":[…]}`。现实里它会：
 * - 包一层 ```json 围栏；
 * - 前后加一句「好的，这是拆解结果：」；
 * - 用中文引号 / 单引号 / 尾逗号；
 * - 干脆返回一个裸数组 `[{...}]`；
 * - 字段名换成 `title` / `description` / `步骤`。
 *
 * 以前这一层只有一个「抠出第一个 { 到最后一个 } 再 JSON.parse」，parse 一失败整条拆解
 * 就报错、用户白等几十秒。现在按**确定性阶梯**重试：
 *   严格 parse → 去围栏 / 去闲话 → 修尾逗号与中文引号 → 裸数组包一层 → 逐行抠对象。
 * 每一级都是纯函数，永不联网、永不问模型。全部失败才抛，让调用方决定是重试还是报错。
 *
 * 返回永远是「形状确定的对象」：`{ tasks: [...], cut: [...] }`。
 */

/** 删除字符串外的尾逗号（`[1,2,]` → `[1,2]`）。逐字符扫描，不会破坏字符串里的 `,`。 */
function stripTrailingCommas(text) {
  let out = ''
  let inString = false
  let quote = ''
  let pendingComma = -1
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (ch === '\\') { i += 1; out += text[i] ?? ''; continue }
      if (ch === quote) inString = false
      continue
    }
    if (ch === '"' || ch === "'") { inString = true; quote = ch; out += ch; continue }
    if (ch === ',') { pendingComma = out.length; out += ch; continue }
    if ((ch === '}' || ch === ']') && pendingComma === out.length - 1) {
      // 把刚写进去的那个逗号删掉
      out = out.slice(0, pendingComma) + out.slice(pendingComma + 1)
    }
    pendingComma = -1
    out += ch
  }
  return out
}

/** 把「中文引号 / 单引号」换成 JSON 认得的标准双引号（只处理引号字符本身）。 */
function normalizeQuotes(text) {
  return text
    .replace(/[\u201c\u201d\u300c\u300d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
}

/** 尝试 JSON.parse，失败返回 undefined（不抛）。 */
function tryParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** 从一段可能掺着闲话的文本里，按括号配对抠出第一个完整 JSON 对象 / 数组。 */
function sliceJson(text) {
  const startObj = text.indexOf('{')
  const startArr = text.indexOf('[')
  let start = -1
  if (startObj < 0 && startArr < 0) return ''
  if (startObj < 0) start = startArr
  else if (startArr < 0) start = startObj
  else start = Math.min(startObj, startArr)
  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let quote = ''
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') { i += 1; continue }
      if (ch === quote) inString = false
      continue
    }
    if (ch === '"' || ch === "'") { inString = true; quote = ch; continue }
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  // 括号没闭合（模型被截断）：退回到「最后一个闭合符」的粗暴切法，能救多少算多少。
  const last = text.lastIndexOf(close)
  return last > start ? text.slice(start, last + 1) : text.slice(start)
}

/** 括号是否配平（字符串里的括号不算）。 */
function isBalanced(text) {
  let depth = 0
  let inString = false
  let quote = ''
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') { i += 1; continue }
      if (ch === quote) inString = false
      continue
    }
    if (ch === '"' || ch === "'") { inString = true; quote = ch; continue }
    if (ch === '{' || ch === '[') depth += 1
    else if (ch === '}' || ch === ']') depth -= 1
    if (depth < 0) return false
  }
  return depth === 0 && inString === false
}

/** 从围栏里取内容；没有围栏就原样返回。 */
function unwrapFence(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  return fenced !== null ? fenced[1] : text
}

/** 把任意解析结果整理成 `{ tasks, cut }`。裸数组 → tasks。 */
function shapeOf(parsed) {
  if (Array.isArray(parsed)) return { tasks: parsed, cut: [] }
  if (parsed !== null && typeof parsed === 'object') {
    const tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks
      : Array.isArray(parsed.steps)
        ? parsed.steps
        : Array.isArray(parsed.步骤)
          ? parsed.步骤
          : []
    const cut = Array.isArray(parsed.cut) ? parsed.cut : Array.isArray(parsed.跳过) ? parsed.跳过 : []
    return { tasks, cut }
  }
  return { tasks: [], cut: [] }
}

/**
 * 逐行抠对象（最后一级兜底）：模型把每条任务写成一个独立的 `{...}` 时，从文本里
 * 依次切出所有配平的 `{}` 再逐个 parse，能救回一部分。
 */
function scrapeObjects(text) {
  const out = []
  let i = 0
  while (i < text.length) {
    const start = text.indexOf('{', i)
    if (start < 0) break
    let depth = 0
    let inString = false
    let quote = ''
    let end = -1
    for (let k = start; k < text.length; k += 1) {
      const ch = text[k]
      if (inString) {
        if (ch === '\\') { k += 1; continue }
        if (ch === quote) inString = false
        continue
      }
      if (ch === '"' || ch === "'") { inString = true; quote = ch; continue }
      if (ch === '{') depth += 1
      else if (ch === '}') {
        depth -= 1
        if (depth === 0) { end = k; break }
      }
    }
    // 这个起点配不平（整段被截断）：跳过它，从**下一个** `{` 继续找。
    // 直接从 start + 1 找起即可 —— 多试几次最坏也只是把同一段文本再扫一遍，
    // 不会误判出条目（只有真能 parse 的对象才会被收下）。
    if (end < 0) {
      const next = text.indexOf('{', start + 1)
      if (next < 0) break
      i = next
      continue
    }
    const piece = tryParse(normalizeQuotes(stripTrailingCommas(text.slice(start, end + 1))))
    if (piece !== undefined && piece !== null && typeof piece === 'object' && !Array.isArray(piece)) out.push(piece)
    i = end + 1
  }
  return out
}

/** 字段名兜底：模型有时用 title / description / text / content 代替 name / plan。 */
function pickField(entry, names) {
  for (const key of names) {
    const value = entry?.[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return ''
}

/**
 * 把一条「可能是各种字段名」的条目映射成标准形状（id=349）。
 * 所有解析级别共用这一份映射 —— 只在小抄（scraped）那一级做，会让严格 JSON 里的
 * `title/description` 条目在后面被 normalizeSteps 当空正文丢掉。
 */
function mapEntry(entry) {
  if (entry === null || typeof entry !== 'object') return null
  const plan = pickField(entry, ['plan', 'description', 'text', 'content', '正文', '任务'])
  if (plan === '') return null
  return {
    name: pickField(entry, ['name', 'title', '标题']),
    plan,
    taskType: pickField(entry, ['taskType', 'type', '类型']),
  }
}

/** 映射整批条目；顺带丢掉彻底认不出的。 */
function mapEntries(tasks) {
  return (Array.isArray(tasks) ? tasks : []).map(mapEntry).filter((one) => one !== null)
}

/**
 * 解析模型输出，返回 `{ tasks, cut, level }`。
 *
 * `level` 说明是哪一级成功的（排查用）：`strict` / `fenced` / `repaired` / `scraped`。
 * 全部失败抛错 —— 调用方据此决定「重试一次」还是「把错误报给用户」。
 */
function parseModelJson(text) {
  const raw = String(text ?? '')
  if (raw.trim() === '') throw new Error('模型返回了空内容')

  // 1. 严格：整段就是 JSON
  const strict = tryParse(raw)
  if (strict !== undefined) {
    const shaped = shapeOf(strict)
    if (shaped.tasks.length > 0) return { ...shaped, tasks: mapEntries(shaped.tasks), cut: shaped.cut, level: 'strict' }
  }

  // 2. 去围栏 + 抠配平片段
  const inner = unwrapFence(raw)
  const sliced = sliceJson(inner)
  const lvl2 = tryParse(sliced)
  if (lvl2 !== undefined) {
    const shaped = shapeOf(lvl2)
    if (shaped.tasks.length > 0) return { ...shaped, tasks: mapEntries(shaped.tasks), cut: shaped.cut, level: 'fenced' }
  }

  // 3. 修引号 / 尾逗号 / 裸数组
  const repairedText = normalizeQuotes(stripTrailingCommas(sliced))
  const lvl3 = tryParse(repairedText)
  if (lvl3 !== undefined) {
    const shaped = shapeOf(lvl3)
    if (shaped.tasks.length > 0) return { ...shaped, tasks: mapEntries(shaped.tasks), cut: shaped.cut, level: 'repaired' }
  }

  // 3b. 裸数组再试一次（有的模型直接给 `[{...},{...}]` 而外层 slice 取成了对象）
  const arrStart = inner.indexOf('[')
  if (arrStart >= 0) {
    const arrText = sliceJson(inner.slice(arrStart))
    const arrayLike = tryParse(normalizeQuotes(stripTrailingCommas(arrText)))
    if (Array.isArray(arrayLike) && arrayLike.length > 0) {
      const mapped = mapEntries(arrayLike)
      if (mapped.length > 0) return { tasks: mapped, cut: [], level: 'repaired' }
    }
  }

  // 3c. 截断救援：外层括号没配平时，sliceJson 会切出一段不完整文本。
  //     这时直接用原文去「逐条抠对象」——半截的条目 parse 失败会被丢掉，
  //     完整的那些仍能救回来（模型答到一半被掐断是常见情况）。
  if (!isBalanced(sliced)) {
    const rescued = mapEntries(scrapeObjects(inner))
    if (rescued.length > 0) return { tasks: rescued, cut: [], level: 'scraped' }
  }

  // 4. 逐行抠对象
  const scraped = scrapeObjects(inner)
  if (scraped.length > 0) {
    const tasks = mapEntries(scraped)
    if (tasks.length > 0) return { tasks, cut: [], level: 'scraped' }
  }

  throw new Error('模型没有返回可解析的任务 JSON')
}

/** 兼容旧调用点：只要 `{tasks, cut}`。 */
function parseDecomposeJson(text) {
  const { tasks, cut } = parseModelJson(text)
  return { tasks, cut }
}

export { isBalanced, mapEntries, mapEntry, parseDecomposeJson, parseModelJson, scrapeObjects, sliceJson, stripTrailingCommas, normalizeQuotes }
