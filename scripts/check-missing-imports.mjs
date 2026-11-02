/**
 * 检查「用了某个跨模块名字，但没有 import 它」（id=77-C 补）。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────────────────
 * 77-C 改 `store.js` 时把 `byOrder` 换成了 `sortByOrder`，但忘了加 import。
 * 结果：4 个静态检查全绿、`npm test` 通过，直到跑端到端脚本才炸出
 * `ReferenceError: sortByOrder is not defined`。
 *
 * 现有三个检查都不覆盖这种情况：
 * - `check-imports.mjs`：查「import 了但没用」+ 循环依赖；
 * - `unused-imports.mjs`：查多余 import；
 * - `unused-decls.mjs`：查没人用的声明。
 * 缺的正是「用了却没 import」—— 那需要知道「这个名字属于别的模块」。
 *
 * 本脚本：建全局导出索引 → 对每个文件扫标识符 → 若某名字由别的模块导出、
 * 却不在本文件 import 里，且作为**变量引用**出现过，就报错。
 *
 * 已知局限：靠启发式排除「对象键」与「函数参数」位置（两处实测误报来源），
 * 不是类型检查器。它是兜底网。
 *
 * 用法：node scripts/check-missing-imports.mjs
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const DIR = join(ROOT, 'lib', 'host')

const files = readdirSync(DIR).filter((f) => f.endsWith('.js')).sort()

/** 剥注释与字符串字面量 */
function stripNoise(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

/** 本文件 export 的名字 */
function exportsOf(src) {
  const out = new Set()
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim()
      if (!t) continue
      const name = t.includes(' as ') ? t.split(/\s+as\s+/).pop().trim() : t
      if (name) out.add(name)
    }
  }
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/g)) {
    out.add(m[1])
  }
  return out
}

/** 本文件 import 进本地的名字 */
function importedNames(src) {
  const local = new Set()
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'[^']+'/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim()
      if (!t) continue
      local.add(t.includes(' as ') ? t.split(/\s+as\s+/).pop().trim() : t)
    }
  }
  return local
}

/** 本文件自己声明/导出的名字 */
function ownNames(src, clean) {
  const own = exportsOf(src)
  for (const m of clean.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g)) own.add(m[1])
  for (const m of clean.matchAll(/(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z0-9_$]+)/g)) own.add(m[1])
  for (const m of clean.matchAll(/(?:^|\n)\s*class\s+([A-Za-z0-9_$]+)/g)) own.add(m[1])

  // 函数参数也算「本文件已声明」。
  // 不加这条会把 `function f(snapshot) { return String(snapshot) }` 里的 snapshot
  // 误报成「用了别的模块导出的同名标识符」——
  // 参数在函数体内当然会被引用，那是局部变量，不需要 import。
  for (const m of clean.matchAll(/function\s*[A-Za-z0-9_$]*\s*\(([^)]*)\)/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/[=:]/)[0].trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) own.add(name)
    }
  }
  // 箭头函数参数
  for (const m of clean.matchAll(/\(([^)]*)\)\s*=>/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/[=:]/)[0].trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) own.add(name)
    }
  }
  return own
}

/**
 * 该名字是否作为「变量引用」出现过。
 * 排除：对象键（`name:` 紧跟 { 或 , 之后）、函数参数（`function f(name)`）。
 */
function usedAsIdentifier(clean, name) {
  let from = 0
  for (;;) {
    const at = clean.indexOf(name, from)
    if (at < 0) return false
    from = at + name.length

    const prevChar = at > 0 ? clean[at - 1] : ''
    const nextChar = clean.slice(at + name.length, at + name.length + 1)
    if (/[\w$]/.test(prevChar)) continue
    if (/[\w$]/.test(nextChar)) continue
    if (prevChar === '.') continue

    const before = clean.slice(Math.max(0, at - 40), at)
    const after = clean.slice(at + name.length, at + name.length + 4)

    // 对象键：{ name: ... } 或 , name: ...
    if (/[{,]\s*$/.test(before) && /^\s*:(?!:)/.test(after)) continue

    // 函数参数：function f( ... name … )
    // 注意 `function f(` 里 `(` 也在行尾，所以正则要允许最后的 `(`。
    if (/[(,]\s*$/.test(before)) {
      const lineStart = clean.lastIndexOf('\n', at)
      const line = clean.slice(lineStart + 1, at)
      if (/function\s*[A-Za-z0-9_$]*\s*\(\s*$/.test(line)) continue
      if (/function\s*[A-Za-z0-9_$]*\s*$/.test(line)) continue
      if (/=>\s*$/.test(line)) continue
    }

    return true
  }
}

// ── 建索引 ──
const exportIndex = new Map()
const texts = new Map()
for (const f of files) {
  const src = readFileSync(join(DIR, f), 'utf8')
  texts.set(f, src)
  for (const name of exportsOf(src)) {
    if (!exportIndex.has(name)) exportIndex.set(name, new Set())
    exportIndex.get(name).add(f)
  }
}

const suspects = []
for (const f of files) {
  const src = texts.get(f)
  const clean = stripNoise(src)
  const local = importedNames(src)
  const own = ownNames(src, clean)

  for (const [name, owners] of exportIndex) {
    if (local.has(name) || own.has(name) || owners.has(f)) continue
    if (!usedAsIdentifier(clean, name)) continue
    suspects.push({ file: f, name, owners: [...owners].join(', ') })
  }
}

if (suspects.length === 0) {
  console.log(`missing-imports: ${files.length} 个宿主模块，无「用了却没 import」`)
  process.exit(0)
}

console.log(`missing-imports: ${suspects.length} 处可疑`)
for (const s of suspects) {
  console.log(`  ${s.file}: 用到 ${s.name}（由 ${s.owners} 导出）但没 import`)
}
process.exit(1)
