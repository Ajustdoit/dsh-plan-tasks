/**
 * 死样式扫描：找出 CSS 里定义了、但 JS 从来没挂到 DOM 上的 `.plt-*` 类。
 *
 * 为什么需要它：客户端样式是纯字符串，删掉一条错误的规则不会报错，
 * 只会在若干次重构后攒下一堆「看着像在用、其实早没人用」的死规则。
 * 这个脚本把「定义」与「引用」对一遍，再排除动态拼接（`plt-group-${key}`）
 * 这类无法静态确定的情况，剩下的就是真死规则。
 *
 * 用法：node scripts/dead-css.mjs
 * 退出码：0 = 干净；1 = 有死规则（打印清单与所在片段）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = 'src/client'
const CSS_DIR = '20-css'

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  )
}

const files = walk(ROOT).filter((f) => f.endsWith('.js'))
const isCss = (f) => f.split(/[\\/]/).includes(CSS_DIR)
const read = (list) => list.map((f) => readFileSync(f, 'utf8')).join('\n')
const cssFiles = files.filter(isCss)
const js = read(files.filter((f) => !isCss(f)))

/** 类名 → 第一次定义它的片段，便于直接跳到源头删。 */
const defined = new Map()
for (const file of cssFiles) {
  for (const m of readFileSync(file, 'utf8').matchAll(/\.(plt-[a-z0-9-]+)/g)) {
    if (!defined.has(m[1])) defined.set(m[1], relative(ROOT, file))
  }
}

/** JS 里静态写出的类名，以及模板字面量的动态前缀（`plt-group-${key}` → `plt-group-`）。 */
const used = new Set()
for (const m of js.matchAll(/(plt-[a-z0-9-]+)/g)) used.add(m[1])
const prefixes = [...used].filter((name) => name.endsWith('-'))

const dead = []
for (const name of defined.keys()) {
  if (used.has(name)) continue
  if (prefixes.some((prefix) => name.startsWith(prefix))) continue
  dead.push(name)
}

if (dead.length === 0) {
  console.log(`css: ${defined.size} 个类，无死规则`)
  process.exit(0)
}
console.log(`css: ${defined.size} 个类，${dead.length} 个没人用`)
for (const name of dead) console.log(`  ${name}  ${defined.get(name)}`)
process.exit(1)
