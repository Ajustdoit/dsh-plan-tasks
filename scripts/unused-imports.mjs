/**
 * 未使用 import 扫描：宿主模块里 import 进来但正文一次都没用的名字。
 *
 * 为什么不用 ESLint：这个仓库刻意零依赖（`npm pack` 只带 lib/src/scripts，
 * 装 eslint 就得进 devDependencies 并拉一堆间接依赖）。这里只需要一个
 * 正则能覆盖的窄场景，几十行足够，还能顺手在 `npm test` 里跑。
 *
 * 用法：node scripts/unused-imports.mjs
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = join(ROOT, 'lib')

/** 递归收集 lib 下的 ESM 源文件（client.js 是构建产物，不算）。 */
async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else if (entry.name.endsWith('.js') && !(dir === LIB && entry.name === 'client.js')) out.push(full)
  }
  return out.sort()
}

/** 把 import 语句（含多行花括号形式）从正文里剔除，避免「声明处自己算一次引用」。 */
function stripImports(text) {
  return text.replace(/^[ \t]*import\b[\s\S]*?from[ \t]*['"][^'"]+['"][ \t]*\r?\n/gm, '')
}

/** 收集文件里一条 import 语句声明的本地名字。 */
function importedNames(text) {
  const out = []
  const statement = /^[ \t]*import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm
  for (const match of text.matchAll(statement)) {
    const clause = match[1].trim()
    const source = match[2]
    const braces = clause.match(/\{([\s\S]*)\}/)
    if (braces) {
      for (const piece of braces[1].split(',')) {
        const name = piece.trim().split(/\s+as\s+/).pop()?.trim()
        if (name) out.push({ name, source })
      }
    }
    const head = clause.replace(/\{[\s\S]*\}/, '').replace(/,/g, ' ').trim()
    if (head && !head.startsWith('*')) out.push({ name: head.split(/\s+/)[0], source })
    if (head.startsWith('* as ')) out.push({ name: head.slice(5).trim(), source })
  }
  return out
}

let bad = 0
for (const file of await walk(LIB)) {
  const text = await readFile(file, 'utf8')
  const body = stripImports(text)
  for (const { name, source } of importedNames(text)) {
    if (name === 'default') continue
    const word = name.replace(/[$]/g, '[$]')
    // 前面不能是标识符字符，也不能是单个点（`obj.pick` 是属性访问，不算用到）。
    // 但 `...pick(...)` 是展开调用，那三个点要单独认作「用到了」。
    const plain = new RegExp(`(^|[^.\\w$])${word}\\b`).test(body)
    const spread = new RegExp(`\\.\\.\\.${word}\\b`).test(body)
    if (!plain && !spread) {
      console.log(`UNUSED IMPORT ${name} — ${file} (from ${source})`)
      bad += 1
    }
  }
}
console.log(bad === 0 ? 'no unused imports' : `${bad} unused import(s)`)
if (bad > 0) process.exit(1)
