/**
 * 附件图片的存取（id=UpcIC7-IMG）。
 *
 * 设计取舍：**存文件、不存 base64**。
 *
 * 为什么不把 base64 写进 plan.json（原本的想法）：
 *   · plan.json 每 5 秒被轮询读一次，条目还会全量下发给界面（lite 投影只截断
 *     plan/note/sourcePrompt 三个文本字段，不认图片）。一条 400KB 的 base64
 *     图片 × 50 条 = 20MB/次 → 约 234MB/分钟，浏览器会卡死。
 *   · 写盘要 JSON.stringify 整份数据，带几十 MB base64 时改一个 order 都要
 *     序列化几十 MB。
 *   · base64 比原字节大 1/3，而且无法被浏览器缓存。
 *
 * 存文件名后：条目里只有 `Ab3xK9-1.png` 这种 20 字节字符串，
 * 轮询、写盘、渲染都不受影响；图片由浏览器自己按需 GET 并缓存。
 *
 * 磁盘约定：
 *   <.plan>/images/<任务id>-<序号>.<ext>
 * 任务 id 与序号都由文件名承载，因此条目数组里只需要存文件名。
 */

import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { imagesDirOf, imagePathOf } from './paths.js'
import { str } from './values.js'

/** 支持的图片类型 → 扩展名。只认这几种：能确认是位图，且浏览器都能直接显示。 */
const MIME_EXT = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
])

/** 单张图片上限。20MB 与 DSH 宿主侧 `maxImageBytes` 的默认值一致。 */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
/** 一条计划最多几张。防止有人一次贴 50 张把模型请求撑爆。 */
const MAX_IMAGES_PER_ITEM = 9

/** 文件名白名单：只允许「字母数字-_.」并且以图片扩展名结尾。 */
const SAFE_NAME = /^[0-9A-Za-z][0-9A-Za-z._-]*\.(png|jpe?g|webp|gif)$/i

/**
 * 判断一个字符串是不是本模块认可的图片文件名。
 *
 * 用途有两个：渲染前过滤脏数据、以及在读图时防目录穿越。
 * 只做**形状**校验（不含路径分隔符），真正的物理校验在 `readImage` 里做。
 */
function isImageName(value) {
  const text = str(value)
  if (text === '') return false
  if (text.includes('/') || text.includes('\\') || text.includes('..')) return false
  return SAFE_NAME.test(text)
}

/** 把 mime 转成扩展名；不支持的返回空串。 */
function extOfMime(mime) {
  return MIME_EXT.get(str(mime).toLowerCase()) ?? ''
}

/** 由 data URL 或裸 base64 得到 Buffer。解析失败返回 null。 */
function decodeBase64(input) {
  const text = str(input).trim()
  if (text === '') return null
  // 允许传完整 data URL（`data:image/png;base64,xxxx`）
  const comma = text.indexOf(',')
  const body = text.startsWith('data:') && comma >= 0 ? text.slice(comma + 1) : text
  if (body === '') return null
  try {
    const buf = Buffer.from(body, 'base64')
    // Buffer.from 对非法 base64 是**静默忽略**非法字符的，
    // 所以必须回比一次长度，否则「随便一串文字」也会被当成一张图存下来。
    if (buf.byteLength === 0) return null
    return buf
  } catch {
    return null
  }
}

/**
 * 按文件头判断真实类型。
 *
 * 不能只信 `mime` 参数：浏览器给的可能是错的，恶意调用方更可以直接伪造。
 * 这里读魔数，与声明的 mime 不一致就拒绝。
 */
function sniffMime(buf) {
  if (buf.byteLength < 12) return ''
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif'
  // WEBP：RIFF....WEBP
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
    && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp'
  return ''
}

/** mime → 内容类型（读图时回给浏览器用）。 */
function mimeOfExt(name) {
  const low = str(name).toLowerCase()
  if (low.endsWith('.png')) return 'image/png'
  if (low.endsWith('.jpg') || low.endsWith('.jpeg')) return 'image/jpeg'
  if (low.endsWith('.webp')) return 'image/webp'
  if (low.endsWith('.gif')) return 'image/gif'
  return 'application/octet-stream'
}

/** 生成一个不会与已有文件重名的文件名。 */
async function uniqueName(cwd, taskId, ext) {
  const dir = imagesDirOf(cwd)
  let taken = new Set()
  try {
    taken = new Set(await readdir(dir))
  } catch {
    taken = new Set()
  }
  // 任务 id 可能含非法字符（历史数据），统一压成安全形状。
  const base = str(taskId).replace(/[^0-9A-Za-z_-]/g, '') || 'task'
  for (let i = 1; i <= 999; i += 1) {
    const name = `${base}-${i}.${ext}`
    if (!taken.has(name)) return name
  }
  // 极端情况：999 张之后用时间戳兜底，绝不覆盖已有文件。
  return `${base}-${Date.now().toString(36)}.${ext}`
}

/**
 * 保存一张图片。
 *
 * @param cwd 项目根
 * @param taskId 归属的任务 id（只用于文件名前缀）
 * @param input `{ data, mime }`，`data` 可以是 data URL 或裸 base64
 * @returns `{ ok: true, name }` 或 `{ ok: false, error }`
 */
async function saveImage(cwd, taskId, input) {
  const mime = str(input?.mime).toLowerCase()
  const ext = extOfMime(mime)
  if (ext === '') {
    return { ok: false, error: `不支持的图片类型：${mime === '' ? '(未提供)' : mime}` }
  }
  const buf = decodeBase64(input?.data)
  if (buf === null) return { ok: false, error: '图片数据不是合法的 base64' }
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    const mb = (MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0)
    return { ok: false, error: `图片超过 ${mb}MB 上限（实际 ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB）` }
  }
  // 魔数必须与声明的 mime 一致：防止把任意文件改名成 .png 混进来。
  const sniffed = sniffMime(buf)
  if (sniffed === '') return { ok: false, error: '无法识别的图片格式（文件头不匹配）' }
  if (sniffed !== mime) {
    return { ok: false, error: `声明的类型（${mime}）与实际文件（${sniffed}）不一致` }
  }
  const dir = imagesDirOf(cwd)
  await mkdir(dir, { recursive: true })
  const name = await uniqueName(cwd, taskId, ext)
  await writeFile(imagePathOf(cwd, name), buf)
  return { ok: true, name }
}

/**
 * 读一张图片。
 *
 * @returns `{ ok: true, buffer, mime }` 或 `{ ok: false, error }`
 */
async function readImage(cwd, name) {
  // 双重校验：形状 + 物理位置。只做前者不足以挡住精心构造的穿越串。
  if (!isImageName(name)) return { ok: false, error: '非法的图片名' }
  const full = imagePathOf(cwd, name)
  const dir = imagesDirOf(cwd)
  // 解析后的真实路径必须仍在 images 目录下。
  if (!resolve(full).startsWith(`${resolve(dir)}${process.platform === 'win32' ? '\\' : '/'}`)) {
    return { ok: false, error: '非法的图片路径' }
  }
  try {
    const info = await stat(full)
    if (!info.isFile()) return { ok: false, error: '不是文件' }
    if (info.size > MAX_IMAGE_BYTES) return { ok: false, error: '图片超过大小上限' }
    const buffer = await readFile(full)
    return { ok: true, buffer, mime: mimeOfExt(name) }
  } catch {
    return { ok: false, error: '图片不存在' }
  }
}

/** 删除一张图片（不存在也算成功 —— 删除是幂等的）。 */
async function removeImage(cwd, name) {
  if (!isImageName(name)) return false
  try {
    await unlink(imagePathOf(cwd, name))
    return true
  } catch {
    return false
  }
}

/**
 * 把任意输入归一成「合法的图片文件名数组」。
 *
 * 用在条目落盘前：丢掉非字符串、丢掉非法名、去重、限量。
 * 不做存在性检查 —— 那要读盘，而归一化应当是纯函数（store.js 每次读都会调）。
 */
function normalizeImages(value) {
  const list = Array.isArray(value) ? value : []
  const out = []
  const seen = new Set()
  for (const raw of list) {
    const name = str(raw).trim()
    if (!isImageName(name)) continue
    if (seen.has(name)) continue
    seen.add(name)
    out.push(name)
    if (out.length >= MAX_IMAGES_PER_ITEM) break
  }
  return out
}

/** 拼接图片的访问 URL（相对同源，前端直接用）。 */
function imageUrlOf(name) {
  return `/plan-tasks/images/${encodeURIComponent(str(name))}`
}

export {
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_ITEM,
  MIME_EXT,
  decodeBase64,
  extOfMime,
  imageUrlOf,
  isImageName,
  mimeOfExt,
  normalizeImages,
  readImage,
  removeImage,
  saveImage,
  sniffMime,
}
