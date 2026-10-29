import { readdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * plan.json 的损坏检测与修复（id=255）。
 *
 * 为什么值得专门写一个模块：这份文件是所有状态的唯一真源（任务、备注、耗时、审核）。
 * 它一旦坏掉，界面上表现为「计划全没了」，而用户手上没有任何东西可以恢复 ——
 * id=254 已经把「坏文件被空数组覆盖」这条最致命的路堵住，但那只保证**不再恶化**。
 * 这一条补的是「怎么把它救回来」。
 *
 * 修复分两层：
 * - **结构层**：能解析但形状不对（顶层是字符串/数字/`{}` 之类）→ 按历史形状兜底成列表；
 * - **文本层**：根本解析不了（写到一半断电、手工编辑漏了括号、粘进了注释）→ 逐级抢救：
 *   去 BOM → 去尾逗号 → 去注释 → **按对象逐个捞**（半截 JSON 里前面那些完整对象通常是好的）。
 *
 * 救回来的内容先写一份归档（`.plan/plan.json.broken-<ts>`）再覆盖原文件 ——
 * 顺序不能反：先覆盖就没得回头了。
 *
 * 依赖方向：本模块**不 import store**（store 要 import 它）。所以这里不做归一化，
 * 落盘时 `writePlan` 自己会 `normalizeItem` + 按 order 重排，职责不重叠。
 */

/** 最多保留几份损坏归档。多到十几份只在磁盘上堆垃圾，真要看也只看得上最近几次。 */
const BROKEN_KEEP = 3

/** 去掉 UTF-8 BOM：某些编辑器保存时会写进去，`JSON.parse` 直接报 Unexpected token。 */
function stripBom(raw) {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
}

/** 去尾逗号：`[{...},]` / `{"a":1,}` —— 手工编辑最常见的语法错。 */
function stripTrailingCommas(text) {
  return text.replace(/,\s*([}\]])/g, '$1')
}

/** 去注释：`// …` 与 `/* … *\/`。JSON 本身不允许，但人写配置时很爱加。 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * 从半截 JSON 里逐个捞出完整的顶层对象。
 *
 * 场景：写盘写到一半进程被杀、或者编辑时后面一半被删了。此时整份不是合法 JSON，
 * 但前 N 条是完整且合法的 —— 把它们捞出来，用户丢的是「最后没写完的那一两条」，
 * 而不是全部。
 *
 * 扫描时同时跟踪字符串状态与转义，否则正文里的 `{`、`}`、`"` 会把层级算错。
 */
function salvageObjects(text) {
  const items = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString === true) {
      if (escaped === true) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      if (depth === 0) start = i
      depth += 1
      continue
    }
    if (ch === '}') {
      depth -= 1
      if (depth === 0 && start >= 0) {
        const chunk = text.slice(start, i + 1)
        try {
          const parsed = JSON.parse(chunk)
          // 必须是「像一条计划」的对象：`{}` 这种空壳不能算捞回了一条 ——
          // 否则一段乱七八糟的文本里只要出现一对空花括号，就会被当成「修复成功」，
          // 反而把真正的坏文件覆盖成一条空计划。
          if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed) !== true) {
            if (typeof parsed.plan === 'string' || Number.isInteger(parsed.id)) items.push(parsed)
          }
        } catch {
          // 这一段自己也不完整，跳过；后面还有可能捞到好的。
        }
        start = -1
      }
      if (depth < 0) depth = 0
    }
  }
  return items
}

/** 把任意解析结果按历史形状摊成数组（与 store.js 的 toList 同口径，但会报告形状）。 */
function shapeOf(parsed) {
  if (Array.isArray(parsed)) return { shape: 'array', items: parsed, valid: true }
  if (parsed !== null && typeof parsed === 'object') {
    if (Array.isArray(parsed.items)) return { shape: 'wrapped', items: parsed.items, valid: true }
    if (typeof parsed.plan === 'string' || Number.isInteger(parsed.id)) return { shape: 'single', items: [parsed], valid: true }
    return { shape: 'empty-object', items: [], valid: false }
  }
  return { shape: typeof parsed, items: [], valid: false }
}

/**
 * 纯函数：拿原文，返回「能救出什么」。
 *
 * 不碰磁盘，方便单测与在只读场景里先探一下。
 * 返回 `{ ok, items, method }`：`method` 说明是哪一级救回来的，写进日志与 note 里，
 * 排查「为什么用户的计划少了三条」时要靠它。
 */
function salvagePlan(raw) {
  const text0 = typeof raw === 'string' ? raw : ''
  if (text0.trim() === '') return { ok: true, items: [], method: 'empty', valid: true }

  const attempts = [
    ['direct', text0],
    ['bom', stripBom(text0)],
    ['trailing-comma', stripTrailingCommas(stripBom(text0))],
    ['comments', stripComments(stripTrailingCommas(stripBom(text0)))],
  ]
  for (const [method, text] of attempts) {
    try {
      const parsed = JSON.parse(text)
      const report = shapeOf(parsed)
      const label = report.valid === true ? method : `${method}+shape-fallback`
      return { ok: true, items: report.items, method: label, valid: report.valid === true, fromShape: report.shape }
    } catch {
      // 下一级
    }
  }

  const scooped = salvageObjects(stripComments(stripTrailingCommas(stripBom(text0))))
  if (scooped.length > 0) return { ok: true, items: scooped, method: 'scoop', valid: false }
  return { ok: false, items: [], method: 'none', valid: false }
}

/** 归档路径：`.plan/plan.json.broken-<时间戳>`（与备份文件 `.plan/planBack.json` 分开放）。 */
function brokenPathOf(path, stamp) {
  return `${path}.broken-${stamp}`
}

/** 时间戳用「可排序、无非法字符」的形状，便于在目录里一眼看出先后。 */
function stampOf(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '')
}

/** 只留最近 BROKEN_KEEP 份损坏归档，避免每坏一次就多一个永不清理的文件。 */
async function pruneBroken(path) {
  const dir = dirname(path)
  const prefix = `${path.split(/[\\/]/).pop()}.broken-`
  let names
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  const mine = names.filter((name) => name.startsWith(prefix)).sort()
  const extra = mine.slice(0, Math.max(0, mine.length - BROKEN_KEEP))
  for (const name of extra) {
    try {
      await unlink(join(dir, name))
    } catch {
      // 删不掉就算了，不因为清理失败影响修复。
    }
  }
}

/**
 * 修复入口：检测 → 归档 → 写回。
 *
 * `write` 由调用方注入（store.js 的 writePlan），避免这里再 import 一次 store 形成环。
 * 返回 `{ repaired, method, count, archived, note }`：`repaired:false` 表示救不回来，
 * 调用方应当拒绝继续写（id=254 的 `plan-broken`）。
 */
async function repairPlanFile(path, raw, write, options) {
  const report = salvagePlan(raw)
  if (report.ok !== true) {
    return { repaired: false, method: report.method, count: 0, archived: null, note: '内容无法解析，也没有可捞出的完整条目' }
  }

  // 不在这里归一/排序：writePlan 落盘前本来就会做（normalizeItem + 按 order 重排），
  // 在这里再做一遍只会多一层依赖（store → repair → item → store 成环）。
  const items = report.items
  const verbose = options !== null && typeof options === 'object' && options.verbose === true

  let archived = null
  // 只有「原文非空」才值得归档：空文件或 `[]` 没什么可留的。
  if (String(raw ?? '').trim() !== '') {
    const stamp = stampOf(new Date())
    const target = brokenPathOf(path, stamp)
    try {
      await writeFile(target, raw, 'utf8')
      archived = target
      await pruneBroken(path)
    } catch {
      // 归档失败时**不覆盖**原文件：宁可继续报 broken，也不能把唯一的证据写掉。
      return { repaired: false, method: report.method, count: 0, archived: null, note: '损坏内容无法归档，已中止修复以免丢数据' }
    }
  }

  await write(items)
  const how =
    report.method === 'scoop'
      ? '按对象逐个捞回'
      : report.method === 'direct' || report.method === 'empty'
        ? '结构兜底'
        : `语法修补（${report.method}）`
  return {
    repaired: true,
    method: report.method,
    count: items.length,
    archived,
    note: `${how}，救回 ${items.length} 条${verbose === true ? `（原形状 ${report.fromShape ?? '未知'}）` : ''}`,
  }
}

export {
  salvagePlan,
  repairPlanFile,
  shapeOf,
  stripBom,
  stripTrailingCommas,
  stripComments,
  salvageObjects,
  brokenPathOf,
  stampOf,
  BROKEN_KEEP,
}
