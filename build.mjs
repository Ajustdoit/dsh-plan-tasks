/**
 * 构建脚本（node，无依赖）。做两件事：
 *
 * 一、拼客户端产物 `lib/client.js`
 *   它不是 ESM，而是 `window.__ModuleLoader__.load()` 的工厂函数体。浏览器侧模块系统
 *   （`@deepseek-ai/dsh-client-modules`）只认平台 seed 词与 `require.async(...)`，
 *   普通 `import` 会直接语法错误。所以源码按片段放在 `src/client/` 里
 *   （同一函数作用域、不写 import/export），由本脚本按文件名字典序拼成单文件。
 *
 * 二、把 `src/styles/*.css` 打包成 `assets/plan-tasks.css`
 *   （id=79-C 起）样式有了正式的 CSS 源文件，不再以字符串形式藏在 JS 里。
 *   `assets/` 那份是**产物**：由 `lib/host/styles.js` 的路由读它、页面的
 *   `<link rel="stylesheet">` 请求它。运行时不再创建任何 `<style>` 节点。
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
// 样式的**权威源**（三段式，文件名字典序即层叠顺序）。
const STYLES_DIR = join(ROOT, 'src', 'styles')
// 样式的**产物**：宿主路由提供它，页面 <link> 请求它。
const ASSETS_FILE = join(ROOT, 'assets', 'plan-tasks.css')

/** 骨架文件清单与层叠顺序。03 必须最后（浅色覆盖靠后写者胜）。 */
const STYLE_FILES = ['01-base.css', '02-content.css', '03-theme.css']

const STYLE_LABEL = {
  '01-base.css': '基础与外壳（变量、面板、顶栏、遮罩、tooltip、输入区）',
  '02-content.css': '条目与内容（条目、分组、详情、子任务、批量区、胶囊）',
  '03-theme.css': '主题覆盖 · 浅色（必须最后）',
}

const BANNER = `// 本文件由 build.mjs 从 src/client/*.js 生成，请勿直接修改。
// 改逻辑请改 src/client/ 下的片段，然后 node build.mjs。
// 改样式请改 src/styles/*.css，然后 node build.mjs。
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
    if (!entry.isDirectory()) continue
    const inner = (await readdir(join(SRC_DIR, entry.name))).filter((name) => name.endsWith('.js'))
    for (const name of inner.sort()) names.push(`${entry.name}/${name}`)
  }
  if (names.length === 0) throw new Error(`build: ${SRC_DIR} 里没有任何 .js 片段`)
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

/** 数一段 CSS 里有几条规则（按行首选择器/at-rule 计，剥注释后）。 */
function countRules(css) {
  const naked = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return (naked.match(/(^|\n)\s*[.@#a-zA-Z][^{}\n]*\{/g) ?? []).length
}

/**
 * 读取 src/styles/*.css。
 *
 * 返回 { files, sheets: [{ name, body, rules }], ruleCount }。
 * `files` 是实际存在的文件（按字典序）；缺文件由 `checkStyleSkeleton` 报错。
 */
async function loadStyleSheet() {
  let entries
  try {
    entries = await readdir(STYLES_DIR, { withFileTypes: true })
  } catch {
    return { files: [], sheets: [], ruleCount: 0 }
  }
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.css'))
    .map((e) => e.name)
    .sort()

  const sheets = []
  let ruleCount = 0
  for (const name of files) {
    const text = (await readFile(join(STYLES_DIR, name), 'utf8')).replace(/\r\n/g, '\n').trim()
    const rules = countRules(text)
    ruleCount += rules
    sheets.push({ name, body: text, rules })
  }
  return { files, sheets, ruleCount }
}

/**
 * 生成 `assets/plan-tasks.css`。
 *
 * 这份文件是**产物**：宿主路由（lib/host/styles.js）读它并作为
 * `text/css` 返回；页面的 `<link rel="stylesheet">` 就是请求它。
 * 想改样式请改 `src/styles/*.css`，不要动这里。
 */
function renderAssets(sheet) {
  const BAR = '─'.repeat(60)
  const header = [
    '/* ============================================================',
    ' * DSH「任务列表」插件样式（@chengfa/dsh-plan-tasks）',
    ' * ============================================================',
    ' *',
    ' * 本文件由 build.mjs 从 src/styles/ 下的三个源文件生成，**不要手改**。',
    ' * 改样式请改 src/styles/*.css，然后运行「node build.mjs」。',
    ' *',
    ' * 加载方式（id=79-C 起）：',
    ' *   宿主以 /plan-tasks/styles.css 提供本文件（见 lib/host/styles.js），',
    ' *   并在 index.html 里注入 <link rel="stylesheet">。',
    ' *   运行时不再创建任何 style 节点。',
    ' *',
    ' * 层叠顺序（不可调换）：',
    ' *   01-base → 02-content → 03-theme。',
    ' *   03 的浅色规则大量依赖「同特异度、后写者胜」压过前两段的深色默认值，',
    ' *   顺序由文件名字典序固化，不要改成破坏字典序的名字。',
    ' *',
    ' * 类名前缀约定：',
    ' *   .plt-*        插件自有组件与布局类',
    ' *   --plt-*       CSS 自定义属性（只挂在 .plt-root 作用域内，不上 :root）',
    ' *   .is-* / .open / .running / .failed / .interrupted / .dragging',
    ' *                 .drop-target / .locked / .active / .done / .is-empty',
    ' *                 等状态修饰符 —— 一律叠加在 .plt-* 元素上使用，',
    ' *                 从不单独出现，因此不会命中宿主页面里同名元素。',
    ' */',
    '',
  ].join('\n')

  const parts = sheet.sheets.map(({ name, body, rules }) => {
    const label = STYLE_LABEL[name] ?? name
    return `/* ${BAR}\n * ${label}\n * 源文件：src/styles/${name}（${rules} 条规则）\n * ${BAR} */\n${body}\n`
  })

  const footer = [
    '',
    '/* ============================================================',
    ' * 分段索引（便于对照源码）',
    ' * ============================================================',
    ...sheet.sheets.map(
      ({ name, rules }, i) =>
        ` *  ${String(i + 1).padStart(2, '0')}. ${(STYLE_LABEL[name] ?? name).padEnd(40)} ${String(rules).padStart(4)} 条 ← src/styles/${name}`,
    ),
    ' *',
    ` * 合计 ${sheet.ruleCount} 条规则 / ${sheet.sheets.length} 个模块。`,
    ' * ============================================================ */',
    '',
  ].join('\n')

  return `${header}\n${parts.join('\n')}${footer}`
}

/** 骨架完整性：三个文件都在、无多余、且字典序正确（03 必须最后）。 */
function checkStyleSkeleton(sheet) {
  const missing = STYLE_FILES.filter((n) => !sheet.files.includes(n))
  const extra = sheet.files.filter((n) => !STYLE_FILES.includes(n))
  const present = STYLE_FILES.filter((n) => sheet.files.includes(n))
  const orderOk = JSON.stringify(sheet.files) === JSON.stringify(present)
  return { ok: missing.length === 0 && extra.length === 0 && orderOk, missing, extra, orderOk }
}

const checkOnly = process.argv.includes('--check')
const { names, output } = await build()

let previous = null
try {
  previous = await readFile(OUT_FILE, 'utf8')
} catch {
  /* 首次构建：没有旧产物 */
}

const sheet = await loadStyleSheet()
const skeleton = checkStyleSkeleton(sheet)
const assets = renderAssets(sheet)

let previousAssets = null
try {
  previousAssets = await readFile(ASSETS_FILE, 'utf8')
} catch {
  /* 首次 */
}

function reportSkeleton() {
  if (!skeleton.ok) {
    console.error(
      `build: src/styles/ 骨架不完整（缺 ${skeleton.missing.join(',') || '无'}；多 ${skeleton.extra.join(',') || '无'}；顺序 ${skeleton.orderOk ? '对' : '错'}）`,
    )
    process.exit(1)
  }
  console.log(`build: src/styles/ ${sheet.files.length} 个文件，${sheet.ruleCount} 条规则`)
}

if (checkOnly) {
  if (previous !== output) {
    console.error('build: lib/client.js 与 src/client/ 不同步，请先跑「node build.mjs」')
    process.exit(1)
  }
  if (previousAssets !== assets) {
    console.error('build: assets/plan-tasks.css 与 src/styles/ 不同步，请先跑「node build.mjs」')
    process.exit(1)
  }
  console.log(`build: 产物与 ${names.length} 个片段一致`)
  reportSkeleton()
  console.log('build: assets/plan-tasks.css 与 src/styles/ 一致')
} else {
  let changed = false
  if (previous !== output) {
    await writeFile(OUT_FILE, output, 'utf8')
    console.log(`build: 已生成 lib/client.js（${names.length} 个片段，${Buffer.byteLength(output)} 字节）`)
    changed = true
  }
  if (previousAssets !== assets) {
    await writeFile(ASSETS_FILE, assets, 'utf8')
    console.log(`build: 已生成 assets/plan-tasks.css（${sheet.files.length} 个模块，${sheet.ruleCount} 条规则）`)
    changed = true
  }
  if (!changed) console.log(`build: 无变化（${names.length} 个片段）`)
  reportSkeleton()
}
