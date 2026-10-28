/**
 * `/plan-tasks/api/*` 路由装配。
 *
 * 单独成文件是为了让 `lib/index.js` 保持「纯装配入口」：它只 import 各功能模块、
 * 调初始化、把 apply 挂到内核上，不掺路由细节。这里只做分发与错误兜底，
 * 业务处理函数全部在 `./api.js` 的 `API` 表里。
 */
import { API } from './api.js'
import { readJsonBody, requestTrusted, writeError, writeJson, writeOk } from './http.js'

/** 路由前缀（客户端 lib/client.js 的 API_BASE 与之一致）。 */
const ROUTE_PATH = '/plan-tasks/api'

/** 造一个 `(req, res) => Promise<void>` 的处理器；`ctx` 由入口的 apply 传入。 */
function createHandler(ctx) {
  return async (req, res) => {
    if (!requestTrusted(req)) {
      writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      return
    }
    if (req.method !== 'POST') {
      writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
    const method = pathname.startsWith(`${ROUTE_PATH}/`) ? pathname.slice(ROUTE_PATH.length + 1) : ''
    if (method === '' || method.includes('/')) {
      writeJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown plan-tasks API method' } })
      return
    }
    const handler = Object.hasOwn(API, method) ? API[method] : undefined
    if (typeof handler !== 'function') {
      writeJson(res, 404, { ok: false, error: { code: 'not-found', message: `unknown plan-tasks API method "${method}"` } })
      return
    }
    try {
      const payload = await readJsonBody(req)
      const result = await handler({ ctx, ...payload })
      writeOk(res, result)
    } catch (error) {
      ctx.logger?.warn?.(`dsh-plan-tasks: ${method} failed: ${error instanceof Error ? error.message : String(error)}`)
      writeError(res, error)
    }
  }
}

export { ROUTE_PATH, createHandler }
