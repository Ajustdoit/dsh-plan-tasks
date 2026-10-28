/**
 * 死代码扫描：找出 src/client 里「定义了但没人引用」的函数/组件，以及宿主侧未被任何模块 import 的导出。
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

async function listFragments(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...(await listFragments(join(dir, entry.name))))
    else if (entry.name.endsWith('.js')) out.push(join(dir, entry.name))
  }
  return out.sort()
}

const files = await listFragments('src/client')
const client = await readFile('lib/client.js', 'utf8')
let dead = 0
for (const file of files) {
  const text = await readFile(file, 'utf8')
  for (const match of text.matchAll(/^ {4}(?:async )?function ([A-Za-z_$][\w$]*)/gm)) {
    const name = match[1]
    const hits = client.split(name).length - 1
    // 出现一次 = 只有定义本身，没有调用点。
    if (hits <= 1) {
      console.log(`UNUSED client fn ${name} (${file})`)
      dead += 1
    }
  }
}

const hostDir = 'lib/host'
const hostFiles = await listFragments(hostDir)
const hostSources = new Map()
for (const file of [...hostFiles, 'lib/index.js']) hostSources.set(file, await readFile(file, 'utf8'))
for (const file of hostFiles) {
  const text = hostSources.get(file)
  for (const match of text.matchAll(/^export (?:async )?(?:function|const|class) ([A-Za-z_$][\w$]*)/gm)) {
    const name = match[1]
    let refs = 0
    for (const [other, source] of hostSources) {
      if (other === file) continue
      refs += source.split(name).length - 1
    }
    if (refs === 0) {
      console.log(`UNUSED host export ${name} (${file})`)
      dead += 1
    }
  }
}
console.log(dead === 0 ? 'no dead code found' : `${dead} candidate(s)`)
