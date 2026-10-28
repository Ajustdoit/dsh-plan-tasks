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
export { readJsonBody, writeJson, writeOk, writeError, requestTrusted }
