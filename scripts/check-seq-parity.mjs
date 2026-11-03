/**
 * 一致性测试：`lib/host/order.js` 与 `src/client/15-seq.js` 的
 * `sequenceOf` / `sequenceMapOf` 必须**逐字相同**（id=fzTvER-A）。
 *
 * 为什么需要：客户端片段无法 import 宿主模块，只能各存一份实现。
 * 靠注释提醒「记得两边一起改」是不可靠的 —— 注释不会失败，测试会。
 *
 * 检查两个层面：
 *   1. **源码层**：剥掉注释与空白后，两边函数体必须逐字相同
 *   2. **行为层**：对同一批输入，两边输出必须完全一致
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const HOST_FILE = join(ROOT, 'lib', 'host', 'order.js')
const CLIENT_FILE = join(ROOT, 'src', 'client', '15-seq.js')

let bad = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`)
  if (!ok) bad += 1
}

/** 去掉注释与行尾空白，只留代码骨架。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/**
 * 从源码里抠出某个具名函数的定义（花括号配平）。
 * 找不到返回 null —— 由调用方报错，不要静默通过。
 */
function extractFunction(src, name) {
  const marker = `function ${name}(`
  const at = src.indexOf(marker)
  if (at < 0) return null
  const open = src.indexOf('{', at)
  if (open < 0) return null
  let depth = 1
  let i = open + 1
  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') depth -= 1
    i += 1
  }
  if (depth !== 0) return null
  return src.slice(at, i)
}

console.log('=== 1. 源码一致性 ===')
{
  const hostSrc = readFileSync(HOST_FILE, 'utf8')
  const clientSrc = readFileSync(CLIENT_FILE, 'utf8')

  for (const name of ['sequenceOf', 'sequenceMapOf']) {
    const hostFn = extractFunction(hostSrc, name)
    const clientFn = extractFunction(clientSrc, name)

    if (hostFn === null) {
      check(`${name} 存在于宿主`, false, '未找到定义')
      continue
    }
    if (clientFn === null) {
      check(`${name} 存在于客户端`, false, '未找到定义')
      continue
    }
    check(`${name} 两边都有`, true)

    const hostBody = stripComments(hostFn).join('\n')
    const clientBody = stripComments(clientFn).join('\n')
    const same = hostBody === clientBody
    check(`${name} 源码逐字一致`, same, same ? '' : '\n  宿主: ' + hostBody.replace(/\n/g, ' ') + '\n  客户端: ' + clientBody.replace(/\n/g, ' '))
  }
}

console.log('\n=== 2. 行为一致性 ===')
{
  const host = await import(`file://${HOST_FILE.replace(/\\/g, '/')}`)
  // 客户端片段是纯函数定义（没有 window 依赖），可以直接用 Function 求值
  const clientSrc = readFileSync(CLIENT_FILE, 'utf8')
  const client = new Function(`${clientSrc}\nreturn { sequenceOf, sequenceMapOf }`)()

  const cases = [
    { label: '普通三条', items: [{ id: 'a', order: 1000 }, { id: 'b', order: 2000 }, { id: 'c', order: 3000 }] },
    { label: '无 order', items: [{ id: 'x' }, { id: 'y' }, { id: 'z' }] },
    { label: '相同 order', items: [{ id: 'p', order: 5000 }, { id: 'q', order: 5000 }] },
    { label: '混入 null', items: [{ id: 'a' }, null, { id: 'b' }, undefined] },
    { label: '空数组', items: [] },
    { label: '非数组 null', items: null },
    { label: '子任务', items: [{ id: 'p1-A', order: 0 }, { id: 'p1-B', order: 1 }] },
    { label: '1000 步长', items: Array.from({ length: 5 }, (_, i) => ({ id: `i${i}`, order: (i + 1) * 1000 })) },
  ]

  for (const { label, items } of cases) {
    const hSeq = JSON.stringify(host.sequenceOf(items))
    const cSeq = JSON.stringify(client.sequenceOf(items))
    check(`${label} → sequenceOf 一致`, hSeq === cSeq, hSeq === cSeq ? '' : `${hSeq} vs ${cSeq}`)

    const hMap = JSON.stringify([...host.sequenceMapOf(items)])
    const cMap = JSON.stringify([...client.sequenceMapOf(items)])
    check(`${label} → sequenceMapOf 一致`, hMap === cMap)
  }
}

console.log('\n=== 3. 不写回（两边都不许改入参）===')
{
  const host = await import(`file://${HOST_FILE.replace(/\\/g, '/')}`)
  const clientSrc = readFileSync(CLIENT_FILE, 'utf8')
  const client = new Function(`${clientSrc}\nreturn { sequenceOf }`)()

  for (const [who, fn] of [['宿主', host.sequenceOf], ['客户端', client.sequenceOf]]) {
    const items = [{ id: 'a', order: 1000 }, { id: 'b', order: 2000 }]
    const before = JSON.stringify(items)
    fn(items)
    check(`${who} 不修改入参`, before === JSON.stringify(items))
  }
}

console.log(bad === 0 ? '\nOK 全部通过' : `\nFAIL ${bad} 项不满足`)
process.exit(bad === 0 ? 0 : 1)
