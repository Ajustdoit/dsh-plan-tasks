/**
 * 客户端拼接脚本（node，无依赖）。
 *
 * 为什么不是打包器：`lib/client.js` 不是 ESM，而是 `window.__ModuleLoader__.load()`
 * 的工厂函数体。浏览器侧模块系统（`@deepseek-ai/dsh-client-modules`）只认平台 seed
 * 词和 `require.async('./client.<name>.js')` 两种跨模块引用，普通 `import` 会直接
 * 语法错误。所以源码按片段放在 `src/client/` 里（同一函数作用域、不写 import/export），
 * 由本脚本按文件名顺序拼成一个 `lib/client.js`。
 *
 * 顺序即语义：`20-css-base.js` 必须排在 `21-css-light.js` 之前 —— 浅色规则大量依赖
 * 「同特异度、后写者胜」来覆盖深色默认值。文件名前缀把顺序固化下来，不靠人工记。
 *
 * 用法：node build.mjs            （构建）
 *       node build.mjs --check     （只校验产物是否与源同步，不写盘；npm test 用）
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const SRC_DIR = join(ROOT, 'src', 'client')
const OUT_FILE = join(ROOT, 'lib', 'client.js')

const BANNER = `// 本文件由 build.mjs 从 src/client/*.js 生成，请勿直接修改。
// 改样式或逻辑请改 src/client/ 下的片段，然后 node build.mjs。
`

/** 片段里出现顶层 import/export 会让浏览器直接语法错误，构建期就拦住。 */
const FORBIDDEN = /^\s*(?:import|export)\b/m

async function fragmentNames() {
  const entries = await readdir(SRC_DIR, { withFileTypes: true })
  const names = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isFile() && entry.name.endsWith('.js')) {
      names.push(entry.name)
      continue
    }
    // 子目录是一个「分组」（如 20-css/）：组内按文件名字典序，整组占据它自己的那一位。
    if (!entry.isDirectory()) continue
    const inner = (await readdir(join(SRC_DIR, entry.name))).filter((name) => name.endsWith('.js'))
    for (const name of inner.sort()) names.push(`${entry.name}/${name}`)
  }
  if (names.length === 0) throw new Error(`build: ${SRC_DIR} 里没有任何 .js 片段`)
  // 00 / 10 / 15 / 20（含 20-css/*）/ 30 / 50 / 60 / 70：字典序即执行顺序。
  return names
}

async function build() {
  const names = await fragmentNames()
  const parts = []
  for (const name of names) {
    const text = await readFile(join(SRC_DIR, name), 'utf8')
    if (FORBIDDEN.test(text)) {
      throw new Error(`build: src/client/${name} 里出现了 import/export —— 客户端片段共享同一函数作用域，不能当模块写`)
    }
    parts.push(text.endsWith('\n') ? text : `${text}\n`)
  }
  return { names, output: BANNER + parts.join('\n') }
}

const checkOnly = process.argv.includes('--check')
const { names, output } = await build()

let previous = null
try {
  previous = await readFile(OUT_FILE, 'utf8')
} catch {
  /* 首次构建：没有旧产物 */
}

if (checkOnly) {
  if (previous !== output) {
    console.error('build: lib/client.js 与 src/client/ 不同步，请先跑 `node build.mjs`')
    process.exit(1)
  }
  console.log(`build: 产物与 ${names.length} 个片段一致`)
} else if (previous === output) {
  console.log(`build: 无变化（${names.length} 个片段）`)
} else {
  await writeFile(OUT_FILE, output, 'utf8')
  console.log(`build: 已生成 lib/client.js（${names.length} 个片段，${Buffer.byteLength(output)} 字节）`)
}
