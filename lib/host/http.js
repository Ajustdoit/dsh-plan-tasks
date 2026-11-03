async function readJsonBody(req, limit = 4 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  return JSON.parse(text)
}

function writeJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

function writeOk(res, value) {
  writeJson(res, 200, { ok: true, value })
}

function writeError(res, error, status = 500) {
  const message = error instanceof Error ? error.message : String(error)
  const code = error instanceof Error && typeof error.code === 'string' ? error.code : 'error'
  writeJson(res, status, { ok: false, error: { code, message } })
}
/** 只允许本页同源请求：Host 头必须是 loopback / 受信域，且必须带 XHR 头。 */
function requestTrusted(req) {
  const host = String(req.headers.host ?? '')
  if (host === '') return false
  let hostname
  try {
    hostname = new URL(`http://${host}`).hostname
  } catch {
    return false
  }
  const loopback =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
  if (!loopback) {
    // 非 loopback（远程访问 / 反代）时只保留同源 Origin 校验。
    const origin = req.headers.origin
    if (origin === undefined) return false
    try {
      if (new URL(origin).host !== host) return false
    } catch {
      return false
    }
  }
  if (String(req.headers['sec-fetch-site'] ?? '') === 'cross-site') return false
  const origin = req.headers.origin
  if (origin !== undefined) {
    try {
      if (new URL(origin).hostname !== hostname) return false
    } catch {
      return false
    }
  }
  return String(req.headers['x-requested-with'] ?? '').trim() === 'XMLHttpRequest'
}

/**
 * 资源类请求（图片等）的信任判定（id=UpcIC7-IMG）。
 *
 * 与 `requestTrusted` 的唯一差别：**不要求 `x-requested-with` 头**。
 *
 * 为什么需要单独一个：浏览器加载 `<img src="…">` 时不会带 `XMLHttpRequest`
 * 这个头（那是 XHR / fetch 的自定义头）。用 requestTrusted 卡图片，
 * 结果就是图片永远 403 —— 界面一片空白，而且看起来像「上传失败」。
 *
 * 放宽这一个头**不会**削弱防护：其余检查原样保留 ——
 *   1. Host 必须是 loopback，或（非 loopback 时）Origin 与 Host 同源；
 *   2. `sec-fetch-site` 不能是 cross-site（挡住第三方站点直接嵌我们的图）；
 *   3. Origin 若存在，其 hostname 必须与 Host 一致。
 * 这三条已经挡住「别的站点借用户浏览器读本地文件」这条路；
 * 再加上文件名白名单与物理路径校验（images.js），越权读任意文件也不成立。
 */
function requestTrustedResource(req) {
  const host = String(req.headers.host ?? '')
  if (host === '') return false
  let hostname
  try {
    hostname = new URL(`http://${host}`).hostname
  } catch {
    return false
  }
  const loopback =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
  if (!loopback) {
    const origin = req.headers.origin
    if (origin === undefined) return false
    try {
      if (new URL(origin).host !== host) return false
    } catch {
      return false
    }
  }
  if (String(req.headers['sec-fetch-site'] ?? '') === 'cross-site') return false
  const origin = req.headers.origin
  if (origin !== undefined) {
    try {
      if (new URL(origin).hostname !== hostname) return false
    } catch {
      return false
    }
  }
  return true
}
export { readJsonBody, writeJson, writeOk, writeError, requestTrusted, requestTrustedResource }
