import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import {
  SNAP_HISTORY_MAX,
  SNAP_LOG_MAX,
  SNAP_README_MAX,
  SNAP_TOTAL_MAX,
  SNAP_TREE_MAX,
} from './constants.js'

/** 读一个文本文件的前 n 个字符；不存在就返回空串。 */
async function headOf(cwd, name, max) {
  try {
    const text = await readFile(join(cwd, name), 'utf8')
    const flat = text.replace(/\r\n/g, '\n').trim()
    return flat.length <= max ? flat : `${flat.slice(0, max)}\n…（已截断）`
  } catch {
    return ''
  }
}

/** 目录树（只两层，跳过噪声目录），返回 `- path` 行。 */
async function treeOf(cwd) {
  const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.next', '.cache', 'coverage', '.turbo', '.venv', '__pycache__'])
  const lines = []
  const walk = async (dir, depth) => {
    if (lines.length >= SNAP_TREE_MAX || depth > 1) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
    for (const entry of entries) {
      if (lines.length >= SNAP_TREE_MAX) return
      if (SKIP.has(entry.name)) continue
      const full = join(dir, entry.name)
      const rel = relative(cwd, full).split(sep).join('/')
      lines.push(entry.isDirectory() ? `- ${rel}/` : `- ${rel}`)
      if (entry.isDirectory()) await walk(full, depth + 1)
    }
  }
  await walk(cwd, 0)
  return lines.join('\n')
}

/** 最近几条提交（取不到就空串）。 */
function gitLogOf(cwd) {
  return new Promise((done) => {
    execFile(
      'git',
      ['log', '-5', '--pretty=format:%s', '--no-color'],
      { cwd, timeout: 8000, windowsHide: true },
      (error, stdout) => {
        if (error !== null) {
          done('')
          return
        }
        const text = String(stdout).replace(/\r\n/g, '\n').trim()
        done(text.length <= SNAP_LOG_MAX ? text : text.slice(0, SNAP_LOG_MAX))
      },
    )
  })
}

/** 历史上已经做过的计划标题（帮助模型避开重复劳动）。 */
function historyOf(items) {
  const names = items
    .filter((item) => item.draft !== true)
    .slice(-30)
    .map((item) => `- #${item.id} ${item.name}`)
  const text = names.join('\n')
  return text.length <= SNAP_HISTORY_MAX ? text : `${text.slice(0, SNAP_HISTORY_MAX)}\n…（已截断）`
}

/** 汇总成一段有长度上限的项目快照。 */
async function projectSnapshot(cwd, items) {
  const [readme, agents, tree, log] = await Promise.all([
    headOf(cwd, 'README.md', SNAP_README_MAX),
    headOf(cwd, 'AGENTS.md', 1200),
    treeOf(cwd),
    gitLogOf(cwd),
  ])
  const sections = [
    ['目录树（最多两层）', tree],
    ['README.md', readme],
    ['AGENTS.md', agents],
    ['最近提交', log],
    ['历史计划标题', historyOf(items)],
  ]
    .filter(([, body]) => body !== '')
    .map(([title, body]) => `### ${title}\n${body}`)
  let out = sections.join('\n\n')
  if (out.length > SNAP_TOTAL_MAX) out = `${out.slice(0, SNAP_TOTAL_MAX)}\n…（快照已截断）`
  return out
}
export { projectSnapshot }
