/**
 * 死代码扫描：找出「声明了但从来没被引用」的顶层函数与常量。
 *
 * 为什么需要它：客户端半边是把 src/client/*.js 片段直接拼成一个 IIFE 的，
 * 拼接后所有顶层名字共享同一个作用域，删掉一个片段里的函数不会报错、
 * 只是留下一个没人调用的壳。拆完文件后必须机器扫一遍，避免人工看漏。
 *
 * 用法：node scripts/unused-decls.mjs [--client|--host]
 * 退出码：0 = 干净；1 = 有可疑项（打印清单）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const MODE = process.argv.includes('--host') ? 'host' : 'client'

const DIR = MODE === 'host' ? join(ROOT, 'lib', 'host') : join(ROOT, 'src', 'client')
const EXTRA = MODE === 'host' ? [join(ROOT, 'lib', 'index.js')] : [join(ROOT, 'build.mjs')]

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.js'))
  .sort()
  .map((f) => join(DIR, f))
const texts = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]))
for (const f of EXTRA) texts.set(f, readFileSync(f, 'utf8'))

const corpus = [...texts.values()].join('\n')

/** 收集每个文件顶层的 function / const 声明。 */
function declarations() {
  const found = new Map()
  for (const [file, text] of texts) {
    if (!files.includes(file)) continue
    const fn = /^\s{0,4}(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm
    const cst = /^\s{0,4}const\s+([A-Za-z0-9_$]+)\s*=/gm
    for (const [re, kind] of [[fn, 'fn'], [cst, 'const']]) {
      let m
      while ((m = re.exec(text)) !== null) {
        if (!found.has(m[1])) found.set(m[1], { file, kind })
      }
    }
  }
  return found
}

/** 统计某个名字在全量语料里出现的次数（含声明本身）。 */
function occurrences(name) {
  const re = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`, 'g')
  return (corpus.match(re) ?? []).length
}

const suspects = []
for (const [name, info] of declarations()) {
  // 出现 1 次 = 只有声明本身；导出列表里的重复出现会算第 2 次，所以宿主侧
  // 额外把「只在 export { } 里出现过一次」的情况也抓出来。
  if (occurrences(name) <= 1) suspects.push({ name, ...info, hits: 1 })
}

if (suspects.length === 0) {
  console.log(`${MODE}: 没有无人引用的顶层声明`)
  process.exit(0)
}

console.log(`${MODE}: ${suspects.length} 个可疑声明（出现次数 ≤ 1）`)
for (const s of suspects) console.log(`  ${s.name}  ${s.file}`)
process.exit(1)
