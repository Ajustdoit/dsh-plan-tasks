// 检查宿主模块的相对引用：是否都能解析、是否循环、是否都带 .js 后缀。
// 用法：node scripts/check-imports.mjs
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = join(ROOT, 'lib')

/** 递归收集 lib 下所有 .js（排除构建产物 client.js，它不是 ESM）。 */
async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else if (entry.name.endsWith('.js') && !(dir === LIB && entry.name === 'client.js')) out.push(full)
  }
  return out
}

/** 抽出 import/export ... from '...' 里的说明符。 */
function specifiersOf(text) {
  const out = []
  const re = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g
  for (const match of text.matchAll(re)) out.push(match[1])
  return out
}

const files = await walk(LIB)
const graph = new Map()
const problems = []

for (const file of files) {
  const text = await readFile(file, 'utf8')
  const deps = []
  for (const spec of specifiersOf(text)) {
    if (spec.startsWith('node:') || spec.startsWith('@deepseek-ai/')) continue
    if (!spec.startsWith('.')) {
      problems.push(`${relative(ROOT, file)}: 裸模块说明符 "${spec}" —— 宿主模块只能 import node: 内置、@deepseek-ai/* 或相对路径`)
      continue
    }
    if (!spec.endsWith('.js')) {
      problems.push(`${relative(ROOT, file)}: "${spec}" 缺少 .js 后缀（ESM 必须写全）`)
    }
    const target = resolve(dirname(file), spec)
    if (!files.includes(target)) {
      problems.push(`${relative(ROOT, file)}: "${spec}" 解析不到文件`)
      continue
    }
    deps.push(target)
  }
  graph.set(file, deps)
}

// 深搜找环（宿主模块不该有环：拆分的意义就是把依赖拆成单向的层）。
const state = new Map()
const stack = []
function visit(node) {
  const phase = state.get(node)
  if (phase === 'done') return
  if (phase === 'visiting') {
    const start = stack.indexOf(node)
    problems.push(`循环依赖：${[...stack.slice(start), node].map((f) => relative(ROOT, f)).join(' → ')}`)
    return
  }
  state.set(node, 'visiting')
  stack.push(node)
  for (const dep of graph.get(node) ?? []) visit(dep)
  stack.pop()
  state.set(node, 'done')
}
for (const file of files) visit(file)

const edges = [...graph.values()].reduce((sum, deps) => sum + deps.length, 0)
if (problems.length > 0) {
  console.error(`FAIL  宿主模块引用检查：${problems.length} 个问题`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log(`PASS  ${files.length} 个宿主模块，${edges} 条内部依赖，无环、无缺后缀、无裸模块`)
