/**
 * 附件图片的 HTTP 存取路由（id=UpcIC7-IMG）。
 *
 * 为什么单独一条路由而不是塞进 `/plan-tasks/api/*`：
 *   · 那条路由**只收 POST 且要求 XHR 头**（`requestTrusted`）。
 *     浏览器的 `<img src>` 不会带那个头，图片就永远 403。
 *   · 图片是 `GET` 语义的资源，天然该走独立路径。
 *
 * 安全模型（三条，缺一不可）：
 *   1. `requestTrusted` —— 仍要求同源 Host（复用 http.js 里那套）；
 *   2. 文件名白名单 + 物理路径校验（在 images.js 的 `readImage` 里）；
 *   3. `cwd` 由会话解析，**优先宿主自己的会话 cwd**，客户端提示只作兜底 ——
 *      与 api.js 的 `resolveCwd` 同一口径，不额外信任客户端。
 */

import { resolveCwd } from './decompose.js'
import { readImage, saveImage } from './images.js'
import { readJsonBody, requestTrusted, requestTrustedResource, writeJson } from './http.js'

/** 图片资源前缀（客户端 `imageUrlOf` 与之一致）。 */
const IMAGES_PATH = '/plan-tasks/images'

/** 读 query 里的 name。 */
function nameOfUrl(url) {
  try {
    return new URL(url ?? '/', 'http://dsh.internal').searchParams.get('name') ?? ''
  } catch {
    return ''
  }
}

/** 读 query 里的 cwd（仅作兜底提示）。 */
function cwdOfUrl(url) {
  try {
    return new URL(url ?? '/', 'http://dsh.internal').searchParams.get('cwd') ?? ''
  } catch {
    return ''
  }
}

/**
 * 图片 GET 处理器：`GET /plan-tasks/images?name=<文件名>&cwd=<项目根>`。
 *
 * 返回原始字节 + 正确的 content-type。允许浏览器缓存（图片内容不可变，
 * 文件名带自增序号不会复用），这样滚动列表时不会反复打请求。
 */
function createImagesHandler(ctx) {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' })
      res.end('method not allowed')
      return
    }
    if (!requestTrustedResource(req)) {
      writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      return
    }
    const name = nameOfUrl(req.url)
    if (name === '') {
      writeJson(res, 400, { ok: false, error: { code: 'bad-name', message: '缺少 name' } })
      return
    }
    // 图片请求没有会话 id，只能靠 cwd 兜底。
    const cwd = await resolveCwd(ctx, '', cwdOfUrl(req.url))
    const found = await readImage(cwd, name)
    if (found.ok !== true) {
      writeJson(res, 404, { ok: false, error: { code: 'not-found', message: found.error } })
      return
    }
    res.writeHead(200, {
      'content-type': found.mime,
      'content-length': String(found.buffer.byteLength),
      'x-content-type-options': 'nosniff',
      // 图片按内容寻址（文件名由序号生成、不复用），可以放心长缓存。
      'cache-control': 'private, max-age=31536000, immutable',
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    res.end(found.buffer)
  }
}

/**
 * 上传处理器：`POST /plan-tasks/images/upload`，body `{ sessionId, cwd, taskId, data, mime }`。
 *
 * 与 GET 分开一条路径：上传需要 body 与会话，GET 不需要。
 */
function createUploadHandler(ctx) {
  return async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'POST' })
      res.end('method not allowed')
      return
    }
    if (!requestTrusted(req)) {
      writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      return
    }
    try {
      const payload = await readJsonBody(req, 32 * 1024 * 1024)
      const cwd = await resolveCwd(ctx, payload?.sessionId, payload?.cwd)
      const saved = await saveImage(cwd, payload?.taskId, { data: payload?.data, mime: payload?.mime })
      if (saved.ok !== true) {
        writeJson(res, 400, { ok: false, error: { code: 'bad-image', message: saved.error } })
        return
      }
      writeJson(res, 200, { ok: true, value: { name: saved.name } })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      writeJson(res, 400, { ok: false, error: { code: 'upload-failed', message } })
    }
  }
}

export { IMAGES_PATH, createImagesHandler, createUploadHandler }
