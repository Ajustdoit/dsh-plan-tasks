/**
 * 一次性迁移脚本（id=77-E）：node scripts/migrate-plan.mjs [--dir <项目目录>] [--dry]
 *
 * 把 `<dir>/.plan/` 下的数据整理成当前结构：
 *   1. plan.json：补 order（1000 起步递增）、补 id（缺失/非法才补）、
 *      统一字段顺序、2 空格缩进、去重复键/空值/冗余字段；
 *   2. dispatch.json / settings.json / notes.json：检查引用任务的字段是否仍能对上，
 *      **只报告不擅自改写**（这几个文件的语义各不相同，猜错会丢数据）。
 *
 * 默认**不写盘**，加 `--write` 才落盘；先跑一次看报告是安全的。
 *
 * 用法：
 *   node scripts/migrate-plan.mjs --dir D:/path/to/project          # 只报告
 *   node scripts/migrate-plan.mjs --dir D:/path/to/project --write  # 实际写入
 */
import { readFile, writeFile, rename, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { migrateItems, renderPlan } from '../lib/host/migrate.js'
import { isTopId, parentKeyOfChild } from '../lib/host/ids.js'

/** 解析 `--key value` / `--flag` */
function parseArgs(argv) {
  const out = { dir: '', write: false }
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--write') out.write = true
    else if (a === '--dir') { out.dir = argv[i + 1] ?? ''; i += 1 }
    else if (a.startsWith('--dir=')) out.dir = a.slice(6)
  }
  return out
}

async function readJson(path) {
  try {
    const raw = await readFile(path, 'utf8')
    return { ok: true, value: JSON.parse(raw) }
  } catch (e) {
    return { ok: false, error: e.code === 'ENOENT' ? 'missing' : e.message }
  }
}

/** 把 plan.json 的任意历史形状读成数组（与 store.js 的 toList 同口径）。 */
function toList(parsed) {
  if (Array.isArray(parsed)) return parsed
  if (parsed !== null && typeof parsed === 'object') {
    if (Array.isArray(parsed.items)) return parsed.items
    // notes.json 的形状是 `{ ok, version, notes: [...] }` —— 不是数组，也不是 items。
    // 少了这条分支，40 条归档会被报成「0 条」（实测踩到）。
    if (Array.isArray(parsed.notes)) return parsed.notes
    if (typeof parsed.plan === 'string') return [parsed]
  }
  return []
}

async function main() {
  const args = parseArgs(process.argv)
  const cwd = resolve(args.dir !== '' ? args.dir : process.cwd())
  const planDir = join(cwd, '.plan')
  const planPath = join(planDir, 'plan.json')

  console.log(`目标目录: ${cwd}`)
  console.log(`plan.json: ${planPath}\n`)

  const read = await readJson(planPath)
  if (!read.ok) {
    console.log(`✗ 读不到 plan.json（${read.error}）—— 没有要迁移的数据`)
    process.exit(read.error === 'missing' ? 0 : 1)
  }

  const list = toList(read.value)
  console.log(`原始条目: ${list.length} 条`)

  // ── 统计迁移前的“病态” ──
  const noOrder = list.filter((x) => x === null || typeof x !== 'object' || !Number.isFinite(Number(x?.order))).length
  const noValidId = list.filter((x) => x === null || typeof x !== 'object' || !isTopId(x?.id)).length
  console.log(`  缺 order: ${noOrder} 条`)
  console.log(`  缺合法 id: ${noValidId} 条`)

  const { items, changes } = migrateItems(list)
  console.log(`\n迁移变更 ${changes.length} 项：`)
  for (const c of changes.slice(0, 40)) console.log(`  [${c.kind}] ${c.detail}`)
  if (changes.length > 40) console.log(`  … 另有 ${changes.length - 40} 项`)

  const body = renderPlan(items)

  // ── 校验：合法 id 一个都没被改 ──
  const beforeIds = new Map()
  for (const one of list) {
    if (one !== null && typeof one === 'object' && isTopId(one.id)) beforeIds.set(String(one.id), one)
  }
  const afterIds = new Set(items.map((x) => String(x.id)))
  const lost = [...beforeIds.keys()].filter((id) => !afterIds.has(id))
  if (lost.length > 0) {
    console.log(`\n✗ 有 ${lost.length} 个原本合法的 id 在迁移后消失了：${lost.slice(0, 5).join(',')}`)
    process.exit(1)
  }
  console.log(`\n✓ 原有 ${beforeIds.size} 个合法 id 全部保留（含历史数字 id）`)

  // ── 检查其它三个文件里的引用 ──
  console.log('\n其它文件的引用检查：')
  const allIds = new Set()
  for (const one of items) {
    allIds.add(String(one.id))
    for (const kid of Array.isArray(one.children) ? one.children : []) allIds.add(String(kid.id))
  }

  // dispatch.json：groupId（锁在哪一组）+ delivered[]（投过哪几条）
  {
    const d = await readJson(join(planDir, 'dispatch.json'))
    if (!d.ok) {
      console.log(`  dispatch.json: ${d.error === 'missing' ? '不存在（跳过）' : `读不出（${d.error}）`}`)
    } else {
      const cur = d.value !== null && typeof d.value === 'object' ? d.value : {}
      const gid = cur.groupId ?? null
      const delivered = Array.isArray(cur.delivered) ? cur.delivered : []
      const gidOk = gid === null || allIds.has(String(gid)) || isTopId(gid)
      const staleDelivered = delivered.filter((id) => !allIds.has(String(id)))
      console.log(`  dispatch.json: groupId=${gid === null ? 'null' : gid} ${gidOk ? '✓ 可对上' : '✗ 找不到对应任务'}`)
      console.log(`    delivered ${delivered.length} 条，其中 ${staleDelivered.length} 条已不存在` +
        (staleDelivered.length > 0 ? `（${staleDelivered.slice(0, 5).join(',')}）` : ''))
      console.log('    （不擅自改写：delivered 里过期的 id 只是「投过但已删」，清掉不影响安全，留着也无害）')
    }
  }

  // settings.json：只有阈值之类的配置，不该含任务 id
  {
    const s = await readJson(join(planDir, 'settings.json'))
    if (!s.ok) {
      console.log(`  settings.json: ${s.error === 'missing' ? '不存在（跳过）' : `读不出（${s.error}）`}`)
    } else {
      const keys = s.value !== null && typeof s.value === 'object' ? Object.keys(s.value) : []
      // 只挑**取值像任务 id** 的键 —— 光看键名会被 idsVersion 这类版本号骗到
      // （它的值是个数字，键名里又有 "id"，按名字匹配必然误报）。
      const idLike = keys.filter((k) => {
        if (!/id|task|group/i.test(k)) return false
        const v = s.value[k]
        const looksLikeId = (typeof v === 'number' && Number.isInteger(v) && v > 0)
          || (typeof v === 'string' && /^[0-9A-Za-z]{6}$/.test(v))
        // 排除明显是「版本/数量」的键
        if (/version|limit|count|size|threshold|max|min/i.test(k)) return false
        return looksLikeId
      })
      console.log(`  settings.json: ${keys.length} 个键（${keys.join(',')}）` +
        (idLike.length > 0 ? `，其中可能是任务引用：${idLike.join(',')}` : '，不含任务引用 ✓'))
    }
  }

  // notes.json：归档条目的 id 与 plan 不重叠（重叠就是撞号）
  {
    const n = await readJson(join(planDir, 'notes.json'))
    if (!n.ok) {
      console.log(`  notes.json: ${n.error === 'missing' ? '不存在（跳过）' : `读不出（${n.error}）`}`)
    } else {
      const notes = Array.isArray(n.value) ? n.value : toList(n.value)
      const noteIds = notes
        .filter((x) => x !== null && typeof x === 'object' && x.id !== undefined)
        .map((x) => String(x.id))
      const clash = noteIds.filter((id) => allIds.has(id))
      console.log(`  notes.json: ${notes.length} 条归档，${noteIds.length} 个 id`)
      console.log(`    与 plan.json 撞号: ${clash.length}` + (clash.length > 0 ? `（${clash.slice(0, 5).join(',')}）✗` : ' ✓'))
    }
  }

  // ── 写盘 ──
  if (!args.write) {
    console.log('\n（未加 --write，只在内存里演练了一遍。加 --write 才会真的改文件。）')
    return
  }

  // 先备份再写：迁移是会改用户数据的操作，留一份可回滚。
  const backup = `${planPath}.bak-${Date.now()}`
  await copyFile(planPath, backup)
  const tmp = `${planPath}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, body, 'utf8')
  await rename(tmp, planPath)
  console.log(`\n✓ 已写入 ${planPath}`)
  console.log(`  备份: ${backup}`)
  console.log(`  字节: ${Buffer.byteLength(body, 'utf8')}`)
}

main().catch((e) => {
  console.error('迁移失败:', e?.message ?? e)
  process.exit(1)
})
