/**
 * 生成拆解用的项目快照（目录树 / 模块职责 / README / AGENTS / git log / 历史计划）。
 *
 * id=ImWOun 后续优化：原来只给模型「两层目录名」，于是它连 `lib/host/` 下
 * 有 38 个模块都不知道，拆解只能靠猜「该动哪个文件」。现在补两样东西：
 *   1. 目录树加深到 3 层并过滤 `.bak` / `.pre-*` 这类噪声；
 *   2. 新增「模块职责」清单 —— 从每个源文件的**文件头注释**里抠出一句话说明。
 * 两者互补：树回答「有哪些文件」，职责回答「每个文件管什么」。
 *
 * 快照是**锦上添花**的信息源：任何一段取不到都只返回空串，
 * 绝不让整个拆解因此失败（见 gitLogOf 的 try/catch）。
 */
import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import {
  SNAP_DUTY_LINE_MAX,
  SNAP_DUTY_MAX,
  SNAP_HISTORY_MAX,
  SNAP_LOG_MAX,
  SNAP_README_MAX,
  SNAP_TOTAL_MAX,
  SNAP_TREE_DEPTH,
  SNAP_TREE_MAX,
} from './constants.js'

/** 目录名黑名单：这些目录整个跳过。 */
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', '.next', '.cache',
  'coverage', '.turbo', '.venv', '__pycache__', '.idea', '.vscode',
])

/**
 * 文件名黑名单（id=ImWOun 后续优化）。
 *
 * 原来只跳过目录，不跳文件，于是 `.plan/` 下的备份把目录树占满了：
 *   - .plan/plan.json.bak-1793361457391
 *   - .plan/dispatch.json.pre-5d
 *   - .plan/plan.json.pre-e
 * 这些对「该动哪些文件」毫无帮助，却挤掉了真正有用的信息。
 */
const NOISE_FILE = /\.(bak|tmp|log|orig|rej|swp)$|\.bak[-. ]|\.pre[-. ][\w-]*$|\.tmp[-. ]|~$/i

/** 判断一个文件是否算噪声（备份 / 临时 / 编辑器产物）。 */
function isNoiseFile(name) {
  return NOISE_FILE.test(name)
}

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

/**
 * 目录树（id=ImWOun 后续优化：2 层 → SNAP_TREE_DEPTH 层，且过滤噪声文件）。
 *
 * 原来的两层只到「dsh-plan-tasks/lib/」就停了 —— 而真正要改的文件
 * 在 `lib/host/api.js` 这一级（第三层）。模型看不到文件名，
 * 就只能把「改配色」拆成「改一下样式」，说不出该动哪个文件。
 *
 * 深度提上去之后，配合 NOISE_FILE 过滤，同样 200 行能看到的信息量
 * 比原来 120 行高出好几倍。
 */
async function treeOf(cwd) {
  const lines = []
  const walk = async (dir, depth) => {
    if (lines.length >= SNAP_TREE_MAX || depth > SNAP_TREE_DEPTH) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
    for (const entry of entries) {
      if (lines.length >= SNAP_TREE_MAX) return
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
      } else if (isNoiseFile(entry.name)) {
        continue
      }
      const full = join(dir, entry.name)
      const rel = relative(cwd, full).split(sep).join('/')
      lines.push(entry.isDirectory() ? `- ${rel}/` : `- ${rel}`)
      if (entry.isDirectory()) await walk(full, depth + 1)
    }
  }
  await walk(cwd, 0)
  return lines.join('\n')
}

/**
 * 从源文件里抠出「这个文件是干什么的」（id=ImWOun 后续优化）。
 *
 * 为什么需要：光有目录树只能让模型知道**有哪些文件**，
 * 仍然不知道 `api.js` 和 `item.js` 分别负责什么。而拆解要回答的
 * 「这个需求该动哪几处」恰恰需要职责信息。
 *
 * 提取策略（按可靠性排序，取第一个命中的）：
 *   1. 文件开头的块注释 `/* ... *\/` 第一句（本仓的文件头写得很好，
 *      例如 orphan.js 开头就说明了「把派发过但从没跑起来的条目落成已中断」）
 *   2. 开头的 `//` 行注释第一句
 *   3. 开头的 `'use strict'` 之后的第一行注释
 *
 * 拿不到就返回空串 —— 不猜、不编。
 */
function dutyOf(text) {
  const src = String(text ?? '').replace(/\r\n/g, '\n')
  // 只在文件前 60 行里找，避免把正文里的注释当成文件说明。
  // id=ImWOun：40 → 60 —— api.js 前 40 行几乎全是 import，注释在第 40 行之后。
  const lines = src.split('\n').slice(0, 60)

  // 逐行扫：允许跳过「导入区」，找到的第一段注释就是文件职责。
  //
  // 为什么不再分「块注释 / 行注释」两套正则：
  // 本仓的文件头有两种写法 —— 有的 `/* */` 在最前，有的先 import 再写 `/** */`。
  // 原来块注释那条用的是 `^\s*\/\*`，只能匹配**文件开头**，
  // 于是「import 在前、块注释在后」的文件（cursor.js / item.js）全部提取失败。
  // 统一成「按行推进 + 跳过导入区」就都能覆盖。
  const isImportLine = (line) => /^\s*import\s/.test(line)
    || /^\s*export\s+.*\s+from\s+/.test(line)
    || /^\s*\}?\s*from\s+['"]/.test(line)      // 多行 import 的收尾
    || /^\s*['"]use strict['"];?\s*$/.test(line)
    || /^\s*export\s*\{/.test(line)             // 导出列表
  const isCodeLine = (line) => /^\s*(export\s+(default\s+)?)?(async\s+)?(function|const|let|var|class)\b/.test(line)
    || /^\s*(export\s+)/.test(line)

  // 两遍扫描（id=ImWOun）：
  // 第一遍只找**块注释**（`/** */` 是「文件说明」的通行写法），
  // 第二遍才退回**行注释**。
  //
  // 为什么不能一遍：单行 `// 某变量说明` 经常出现在文件头，
  // 一遍扫过去会把它当成文件职责。实测 `snapshot.js` 自己就中招 ——
  // 它提取到的是「目录名黑名单：这些目录整个跳过」（那是 SKIP_DIRS 的注释），
  // 而不是「生成拆解用的项目快照」。块注释优先能避开这类误取。
  const scan = (wantBlock) => {
    let k = 0
    while (k < lines.length) {
      const line = lines[k]
      if (line.trim() === '' || isImportLine(line)) { k += 1; continue }
      if (/^\s*\/\*/.test(line)) {
        if (!wantBlock) {
          // 跳过整段块注释，继续找行注释
          while (k < lines.length && !/\*\//.test(lines[k])) k += 1
          k += 1
          continue
        }
        const body = []
        let j = k
        while (j < lines.length) {
          const raw = lines[j]
          const cleaned = raw
            .replace(/^\s*\/\*+/, '')
            .replace(/\*\/\s*$/, '')
            .replace(/^\s*\*+\s?/, '')
            .trim()
          if (cleaned !== '') body.push(cleaned)
          if (/\*\//.test(raw)) break
          j += 1
        }
        if (body.length > 0) return firstSentence(body[0])
        k = j + 1
        continue
      }
      if (!wantBlock) {
        const m = line.match(/^\s*\/\/\s*(.+)$/)
        if (m !== null && m[1].trim() !== '') return firstSentence(m[1].trim())
      }
      // 碰到真正的可执行语句就停：之后的注释属于函数内部，不是文件说明
      if (isCodeLine(line)) break
      k += 1
    }
    return ''
  }
  const fromBlock = scan(true)
  if (fromBlock !== '') return fromBlock
  return scan(false)
}

/** 取一句话：碰到 `。` / `.` 后的空白就截断；再按长度硬截。 */
function firstSentence(text) {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean === '') return ''
  // 中文句号 / 英文句点 + 空格（避免把 `lib/host/api.js` 里的点切开）
  const cut = clean.search(/。|\.\s/)
  const one = cut > 0 ? clean.slice(0, cut) : clean
  return one.length <= SNAP_DUTY_LINE_MAX ? one : `${one.slice(0, SNAP_DUTY_LINE_MAX - 1)}…`
}

/**
 * 生成「模块职责」清单（id=ImWOun 后续优化）。
 *
 * 只扫源码文件（js/mjs/ts/jsx/tsx/py/go/rs/java/css），
 * 按目录深度浅的优先、同层按名字排序，最多 SNAP_DUTY_MAX 条。
 *
 * 为什么要限条数：一个 500 文件的项目全列出来会把快照撑爆，
 * 而前 60 个源文件通常已经覆盖了「核心模块」。
 */
async function dutiesOf(cwd) {
  const SRC = /\.(m?js|cjs|jsx|ts|tsx|py|go|rs|java|rb|css|scss)$/i
  const found = []
  const walk = async (dir, depth) => {
    if (found.length >= SNAP_DUTY_MAX || depth > SNAP_TREE_DEPTH) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
    const subdirs = []
    for (const entry of entries) {
      if (found.length >= SNAP_DUTY_MAX) return
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        subdirs.push(full)
        continue
      }
      if (isNoiseFile(entry.name)) continue
      if (!SRC.test(entry.name)) continue
      const rel = relative(cwd, full).split(sep).join('/')
      // 跳过数据/产物目录里的文件（它们不是「模块」）
      if (/(^|\/)(\.plan|docs|scripts|assets)\//.test(rel)) continue
      let text = ''
      try {
        // 只读前 4KB 就够判断文件职责
        const raw = await readFile(full, 'utf8')
        text = raw.slice(0, 4096)
      } catch {
        continue
      }
      const duty = dutyOf(text)
      const line = duty === '' ? `- ${rel}` : `- ${rel} — ${duty}`
      found.push(line)
    }
    for (const sub of subdirs) {
      if (found.length >= SNAP_DUTY_MAX) return
      await walk(sub, depth + 1)
    }
  }
  await walk(cwd, 0)
  return found.join('\n')
}

/**
 * 最近几条提交（取不到就空串）。
 *
 * id=ImWOun 后续优化：包 try/catch。
 *
 * 原来只有回调里的 `if (error !== null)` 兜底，但那只覆盖**进程跑起来之后**的失败。
 * 如果 spawn 本身就不允许（沙箱 / 受限环境 / git 不在 PATH），`execFile` 会
 * **同步抛出** EPERM，回调根本不会被调用 —— Promise 永远不 resolve，
 * 异常还会冒泡到 `Promise.all`，把**整个 projectSnapshot 打挂**，
 * 于是拆解直接失败。实测在受限沙箱里就是这个现象。
 *
 * 快照是「锦上添花」的信息源，缺一份 git log 不该让拆解挂掉。
 */
function gitLogOf(cwd) {
  return new Promise((done) => {
    try {
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
    } catch {
      // spawn 阶段就失败（EPERM / ENOENT）：当成「没有 git 历史」。
      done('')
    }
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
  // id=ImWOun 后续优化：并发多算一份「模块职责」。
  // 它和目录树是互补的：树回答「有哪些文件」，职责回答「每个文件管什么」。
  const [readme, agents, tree, duties, log] = await Promise.all([
    headOf(cwd, 'README.md', SNAP_README_MAX),
    headOf(cwd, 'AGENTS.md', 1200),
    treeOf(cwd),
    dutiesOf(cwd),
    gitLogOf(cwd),
  ])
  const sections = [
    // 职责清单排在目录树**之前**：模型第一眼最需要知道的是「哪块在管什么」，
    // 目录树是细节。顺序本身就是一种优先级表达。
    ['模块职责（文件 — 它负责什么）', duties],
    [`目录树（最多 ${SNAP_TREE_DEPTH} 层）`, tree],
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
export { dutyOf, dutiesOf, projectSnapshot }
