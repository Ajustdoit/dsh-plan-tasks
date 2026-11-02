/**
 * 任务 id 实现的一致性校验（id=77-A）。
 *
 * 为什么会存在两份实现：客户端的片段不能 import/export（build.mjs 会拦），
 * 所以 `lib/host/taskid.js` 的那套函数在 `src/client/05-taskid.js` 里有一份**内联副本**。
 *
 * 两份实现一旦漂移，症状是「前端认为合法的 id 后端拒绝」这类难查的问题
 * （字符集差一个字、长度差一位都会这样）。靠人记得同步是不可靠的，
 * 所以这里做**函数体逐字比对**，不一致就退出码 1，让 npm test 失败。
 *
 * 用法：node scripts/check-taskid-parity.mjs
 * 退出码：0 = 一致；1 = 不一致（打印差异）
 */
import { readFileSync } from 'node:fs'

const HOST_FILE = 'lib/host/taskid.js'
const CLIENT_FILE = 'src/client/05-taskid.js'

/** 要比对的函数/常量名 */
const NAMES = ['TASK_ID_ALPHABET', 'TASK_ID_LENGTH', 'defaultRandom', 'makeId', 'isTaskId']

/** 剥注释（保留换行，便于定位），并规整缩进 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, (m) => ' '.repeat(m.length))
}

/**
 * 从一个函数/常量声明的起始行开始，截取它的完整文本（按花括号配平）。
 * 常量（`const X = '...'`）则截到行尾。
 */
function extract(src, name) {
  const clean = stripComments(src)
  // 匹配 `function name(` 或 `const name =`
  const re = new RegExp(`(?:^|\\n)(\\s*)(?:function\\s+${name}\\s*\\(|const\\s+${name}\\s*=)`)
  const m = re.exec(clean)
  if (!m) return null
  const start = m.index + (m[0].startsWith('\n') ? 1 : 0)

  // 常量：到分号或行尾
  if (new RegExp(`const\\s+${name}\\s*=`).test(m[0])) {
    const lineEnd = clean.indexOf('\n', start)
    return clean.slice(start, lineEnd < 0 ? undefined : lineEnd).trim()
  }

  // 函数：按花括号配平
  let i = clean.indexOf('{', start)
  if (i < 0) return null
  let depth = 0
  let end = i
  for (; end < clean.length; end += 1) {
    if (clean[end] === '{') depth += 1
    else if (clean[end] === '}') {
      depth -= 1
      if (depth === 0) { end += 1; break }
    }
  }
  return clean.slice(start, end).trim()
}

/** 归一：去掉所有空白，只比语义字符 */
const norm = (s) => s.replace(/\s+/g, '')

const host = readFileSync(HOST_FILE, 'utf8')
const client = readFileSync(CLIENT_FILE, 'utf8')

let bad = 0
for (const name of NAMES) {
  const h = extract(host, name)
  const c = extract(client, name)

  if (h === null) {
    console.error(`✗ ${name}: 在 ${HOST_FILE} 里找不到`)
    bad += 1
    continue
  }
  if (c === null) {
    console.error(`✗ ${name}: 在 ${CLIENT_FILE} 里找不到`)
    bad += 1
    continue
  }
  if (norm(h) !== norm(c)) {
    console.error(`✗ ${name}: 两份实现不一致`)
    console.error(`    host  : ${norm(h).slice(0, 160)}`)
    console.error(`    client: ${norm(c).slice(0, 160)}`)
    bad += 1
    continue
  }
  console.log(`ok   ${name}`)
}

if (bad > 0) {
  console.error(`\n${bad} 个声明不一致 —— 请同步 ${HOST_FILE} 与 ${CLIENT_FILE}`)
  process.exit(1)
}
console.log(`\ntaskid: ${NAMES.length} 个声明在两端逐字一致`)
