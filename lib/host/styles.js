/**
 * `/plan-tasks/styles.css` —— 把插件样式作为**真正的 CSS 资源**提供给页面。
 *
 * 为什么要有这条路由（id=79-C）：
 *   早先样式以字符串形式内联在客户端包里，由 `apply()` 在运行时
 *   `document.createElement('style')` 注入。那样有两个问题：
 *     1. 运行时动态生成 `<style>` 节点，样式无法被浏览器的 CSSOM 之外的
 *        工具（模板检查、CSP 严格模式、样式覆盖率分析）看到；
 *     2. 样式与逻辑混在一个单文件工厂函数里，改一行颜色要重建整个客户端包。
 *
 *   现在改为：样式由**宿主**以静态资源提供，页面通过 `<link rel="stylesheet">` 加载。
 *   运行时不再创建任何 `<style>` 节点，`apply()` 里那段注入代码已删除。
 *
 * 内容从哪来：
 *   直接读 `assets/plan-tasks.css`（构建产物，由 `build.mjs` 从 `src/styles/*.css` 生成）。
 *   每次请求都重读 —— 开发时改 CSS 只要刷新页面即可看到，不必重启 `dsh web`；
 *   文件很小（约 140KB），读盘成本可以忽略，而「改样式要重启」的摩擦是实打实的。
 *
 * 安全：
 *   - 只响应 `GET` / `HEAD`，其它方法 405；
 *   - 只提供这一个固定文件，**不接受任何路径参数**，没有目录穿越面；
 *   - 响应头固定 `text/css; charset=utf-8`，并加 `nosniff` 防止被当别的类型解析。
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 样式文件相对包根的路径（与 package.json 的 exports["./styles.css"] 一致）。 */
const STYLES_REL = join('assets', 'plan-tasks.css')

/** 路由路径。客户端与 index 注入都用它，改这里就够。 */
const STYLES_PATH = '/plan-tasks/styles.css'

/** 包根目录：本文件在 lib/host/ 下，往上两级。 */
const PACKAGE_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

const STYLES_FILE = join(PACKAGE_ROOT, STYLES_REL)

/** 读不到时返回 null（而不是抛错）—— 让路由回 404，不污染日志。 */
async function readStyles() {
  try {
    return await readFile(STYLES_FILE, 'utf8')
  } catch {
    return null
  }
}

/**
 * 造 `(req, res) => Promise<void>` 处理器。
 * @returns 处理器；挂到 `ctx.webServer.register({ kind: 'exact', path: STYLES_PATH, handler })`
 */
function createStylesHandler() {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' })
      res.end('method not allowed')
      return
    }
    const css = await readStyles()
    if (css === null) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('styles not built')
      return
    }
    const body = Buffer.from(css, 'utf8')
    res.writeHead(200, {
      'content-type': 'text/css; charset=utf-8',
      'content-length': String(body.byteLength),
      'x-content-type-options': 'nosniff',
      // 不缓存：开发期改样式刷新即生效；生产环境这几十 KB 的重复请求也无所谓，
      // 而「改了 CSS 却看到旧样式」是更难排查的问题。
      'cache-control': 'no-cache',
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    res.end(body)
  }
}

/**
 * 往 index.html 注入 `<link rel="stylesheet">`。
 *
 * 用 `webserver/index-inject` 的 `html` 行（`placement: 'head'`）——
 * 这是平台提供的正规注入通道，注入的是**静态标记**，不是运行时脚本，
 * 所以页面加载完就能用，也不会产生 `<style>` 节点。
 *
 * @param ctx - 宿主上下文
 * @returns effect 的 dispose 函数由调用方持有
 */
function registerIndexInjection(ctx) {
  return ctx.effect(
    () => {
      const push = (table) => {
        table.push({
          kind: 'html',
          placement: 'head',
          html: `<link rel="stylesheet" href="${STYLES_PATH}">`,
        })
      }
      ctx.on('webserver/index-inject', push)
      return () => {
        ctx.off?.('webserver/index-inject', push)
      }
    },
    'dsh-plan-tasks: styles link',
  )
}

export { STYLES_PATH, STYLES_REL, STYLES_FILE, createStylesHandler, registerIndexInjection }
