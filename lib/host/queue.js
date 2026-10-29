/**
 * 把记账命令安装到项目的 `.plan/q.mjs`。
 *
 * 模型执行计划时跑这个脚本，标准输出只有 remaining 和下一条。
 * 这样不用把整份 plan.json（含历史 note、sourcePrompt）读进上下文。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLAN_DIR } from './constants.js'

const CLI_NAME = 'q.mjs'
let cached = null

async function template() {
  if (cached === null) {
    cached = await readFile(fileURLToPath(new URL('./queue-cli.js', import.meta.url)), 'utf8')
  }
  return cached
}

/** 内容一致就不动文件。读失败或写失败都不抛，避免面板刷新被记账脚本拖垮。 */
async function ensureQueueCli(cwd) {
  try {
    const body = await template()
    const dir = join(cwd, PLAN_DIR)
    const target = join(dir, CLI_NAME)
    try {
      if ((await readFile(target, 'utf8')) === body) return target
    } catch {
      /* 还没有脚本，下面会创建 */
    }
    await mkdir(dir, { recursive: true })
    await writeFile(target, body, 'utf8')
    return target
  } catch {
    return null
  }
}

export { ensureQueueCli }
