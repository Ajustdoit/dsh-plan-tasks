/**
 * 模型路由与可用模型目录（id=363）。
 *
 * 背景：拆解是插件里唯一真调模型的地方，它要一对 `{ provider, model }`。
 * 原来这对值只有一个来源 —— `decompose.js` 的 `routeOf()` 读
 * `session.requestHeader().config`。而 `requestHeader()` 折的是会话日志里的
 * `request/header` 事件（见 dsh-session 的 `Session#requestHeader`），
 * **会话一次请求都还没发过时它是 `undefined`**。
 *
 * 于是「第一次用拆解」在新建的会话里必然失败（`no-route`），而且失败得很费解：
 * 面板上明明配好了默认模型，界面却说拿不到路由。用户唯一的绕法是
 * 「随便先发一条消息，再回来拆解」——这就是那条隐式依赖。
 *
 * 这个模块把「拿路由」从一次调用前才现问，改成一条有兜底的解析链：
 *   1. 会话请求头（用户在当前会话里真实选的那个）——最权威；
 *   2. 面板设置里存过的选择（上一轮写回的）；
 *   3. 宿主配置的默认模型 `agentDefaultModel.currentSelection()`；
 *   4. 可用模型目录的第一项（`llm.listProviders()` + `listModels()`）。
 *
 * 第 3 步是题面说的「配置中的默认项」，第 4 步是「缺省取列表第一项」。
 * 只要任意一步拿到，decompose 在**全新会话的第一次调用**就能成功。
 *
 * 目录本身会被缓存：`read` 每 5 秒跑一轮，而 `listModels()` 可能真的去问端点。
 * 缓存按 ctx 做（WeakMap），并在 `llm/adapters-updated` 时作废 ——
 * 用户改了 key、连上新 provider 之后不该还看到旧的空目录。
 */
import { MODEL_TTL_MS } from './constants.js'
import { readSettings, writeSettings } from './settings.js'
import { str } from './values.js'

/** 每个 ctx 一份的目录缓存。 */
const caches = new WeakMap()

function cacheOf(ctx) {
  let hit = caches.get(ctx)
  if (hit !== undefined) return hit
  hit = { at: 0, providers: null }
  caches.set(ctx, hit)
  // 模型拓扑变化（换 key / 连上 provider / 改设置）时立刻作废。
  // 事件总线不可用时这一句静默失败，退化成纯 TTL —— 不影响正确性，只是慢一拍。
  try {
    ctx?.on?.('llm/adapters-updated', () => {
      hit.at = 0
      hit.providers = null
    })
  } catch {
    /* 没有事件总线：只靠 TTL */
  }
  return hit
}

/** 一对 provider/model 是否完整。 */
function isRoute(value) {
  return value !== null && value !== undefined && str(value.provider) !== '' && str(value.model) !== ''
}

/** 把任意形状收成 `{provider, model}`；不全时返回 undefined。 */
function asRoute(raw) {
  const route = { provider: str(raw?.provider), model: str(raw?.model) }
  return isRoute(route) ? route : undefined
}

/**
 * 枚举可用模型（provider 分组）。
 *
 * 失败一律吞成空数组：目录是「锦上添花」，它读不出来时不该让整份计划读挂 ——
 * 面板还有拆解以外的所有功能可用。单个 provider 挂了也不影响其他 provider。
 */
async function listProviders(ctx) {
  const llm = ctx?.get?.('llm')
  if (llm === undefined || typeof llm.listProviders !== 'function') return []
  let providers
  try {
    providers = llm.listProviders()
  } catch {
    return []
  }
  if (!Array.isArray(providers)) return []
  const out = []
  for (const provider of providers) {
    const id = str(provider?.id)
    if (id === '') continue
    let models = []
    if (typeof llm.listModels === 'function') {
      try {
        const listed = await llm.listModels(id)
        if (Array.isArray(listed)) {
          models = listed
            .filter((one) => str(one?.id) !== '')
            .map((one) => ({ id: str(one.id), name: str(one.name) !== '' ? str(one.name) : str(one.id) }))
        }
      } catch {
        /* 这个 provider 问不出来：留空分组，其他 provider 继续 */
      }
    }
    out.push({ id, name: str(provider?.name) !== '' ? str(provider.name) : id, models })
  }
  return out
}

/** 目录里的第一项（题面的「缺省取列表第一项」）。 */
function firstOf(providers) {
  for (const provider of providers) {
    if (Array.isArray(provider.models) && provider.models.length > 0) {
      return { provider: provider.id, model: provider.models[0].id }
    }
  }
  return undefined
}

/** 目录里是否真有这一对（存过的选择可能已经失效：模型下架、provider 换 key）。 */
function hasRoute(providers, route) {
  if (!isRoute(route)) return false
  const group = providers.find((one) => one.id === route.provider)
  return group !== undefined && group.models.some((model) => model.id === route.model)
}

/** 会话请求头里的路由（用户在当前会话里真正选的那个）。 */
function headerRouteOf(ctx, sessionId) {
  try {
    const header = ctx?.get?.('sessions')?.get?.(sessionId)?.requestHeader?.()
    return asRoute(header?.config)
  } catch {
    return undefined
  }
}

/** 宿主配置里的默认模型。 */
function defaultRouteOf(ctx) {
  try {
    const service = ctx?.get?.('agentDefaultModel')
    const picked = typeof service?.currentSelection === 'function' ? service.currentSelection() : undefined
    return asRoute(picked)
  } catch {
    return undefined
  }
}

/** 面板设置里存过的选择（上一轮写回的那一份）。 */
async function savedRouteOf(cwd) {
  if (str(cwd) === '') return undefined
  try {
    const { settings } = await readSettings(cwd)
    return asRoute({ provider: settings?.modelProvider, model: settings?.modelModel })
  } catch {
    return undefined
  }
}

/**
 * 解析链的同步部分：请求头 → 存过的选择 → 宿主默认 → 目录第一项。
 *
 * 前三步都要先跟目录对一遍 —— 存了一个已经下架的模型时直接跳过，
 * 而不是拿到一个必然失败的组合。
 */
function pickFrom(ctx, sessionId, providers, saved) {
  const candidates = [
    ['session', headerRouteOf(ctx, sessionId)],
    ['saved', saved],
    ['default', defaultRouteOf(ctx)],
  ]
  for (const [source, route] of candidates) {
    if (hasRoute(providers, route)) return { route, source }
  }
  const first = firstOf(providers)
  if (first !== undefined) return { route: first, source: 'catalog' }
  // 目录整个是空的（还没配任何 provider）：退回不校验的候选，
  // 至少让 decompose 有机会报一个「模型侧」的错，而不是「拿不到路由」。
  for (const [source, route] of candidates) {
    if (isRoute(route)) return { route, source }
  }
  return { route: undefined, source: 'none' }
}

/** 项目根：从会话拿，拿不到就空串（savedRouteOf 会因此返回 undefined）。 */
function cwdOf(ctx, sessionId, cwdHint) {
  if (str(cwdHint) !== '') return str(cwdHint)
  try {
    const session = ctx?.get?.('sessions')?.get?.(sessionId)
    const cwd = str(session?.header?.cwd)
    return cwd
  } catch {
    return ''
  }
}

/** 读一次可用模型目录（带缓存）。 */
async function catalogOf(ctx) {
  const cache = cacheOf(ctx)
  const now = Date.now()
  if (cache.providers !== null && now - cache.at < MODEL_TTL_MS) return cache.providers
  const providers = await listProviders(ctx)
  cache.providers = providers
  cache.at = now
  return providers
}

/**
 * 解析一条可用于模型调用的路由（id=363 的核心）。
 *
 * @param {object} ctx 插件上下文
 * @param {string} sessionId 当前会话
 * @param {string} [cwdHint] 项目根（已知时省一次会话查询）
 * @returns {Promise<{provider:string, model:string}|undefined>}
 */
async function resolveRoute(ctx, sessionId, cwdHint) {
  // 请求头优先且**不过目录**：它是「当前会话选了什么」最直接的答案，
  // 即便目录还没加载完（或某个 provider 暂时问不出来）也该直接用它。
  const header = headerRouteOf(ctx, sessionId)
  if (header !== undefined) return header
  const providers = await catalogOf(ctx)
  const saved = await savedRouteOf(cwdOf(ctx, sessionId, cwdHint))
  return pickFrom(ctx, sessionId, providers, saved).route
}

/**
 * 给界面用的完整快照：目录 + 生效路由 + 用户显式存下的选择。
 *
 * `selection` 与 `saved` 刻意分开：界面靠后者判断「要不要替用户选一个默认的」。
 * 合并成一个的话，「自动选中的默认项」会被当成用户的选择，默认兜底就再也不触发了。
 *
 * id=365：`saved` 只在**仍然有效**时才算数。
 *
 * 这里原来把磁盘上的值原样回传，于是「上次选过、这次下架了」的条目会永远赖着：
 * - `selection` 会正确地回落到目录里的可用项（`pickFrom` 会跳过失效的候选），
 *   所以功能上没问题 —— 但这恰恰把问题藏住了；
 * - 而 `saved` 非 null 会让客户端认为「用户已经有显式选择」，于是**从不回写**，
 *   失效值在 settings.json 里一躺就是几个月。用户下次换了 provider 再回来，
 *   面板显示的仍是那个早就没了的模型名。
 *
 * 现在失效值一律按 null 返回 —— 这正好复用客户端已有的那条愈合路径：
 * `saved === null` → 落一次默认 → 磁盘被覆盖成可用值。不需要为「愈合」新写一段逻辑，
 * 只是把「什么算存过」这个判断改对了。
 *
 * `stale` 单独带出来（true 表示磁盘上有值但已失效），供界面提示或排查用 ——
 * 不能因为「按 null 处理」就让这件事在日志里彻底消失。
 */
async function readCatalog(ctx, sessionId, cwdHint) {
  const providers = await catalogOf(ctx)
  const cwd = cwdOf(ctx, sessionId, cwdHint)
  const stored = await savedRouteOf(cwd)
  // 「存过且仍然可用」才算 saved；存过但已失效 → null（并标记 stale）。
  const alive = stored !== undefined && hasRoute(providers, stored) ? stored : null
  const picked = pickFrom(ctx, sessionId, providers, alive ?? undefined)
  return {
    providers,
    selection: picked.route ?? null,
    source: picked.source,
    saved: alive,
    stale: stored !== undefined && alive === null,
  }
}

/**
 * 写回选中的模型（id=363）。
 *
 * 只写 `settings.json` 的两个字段，不动其他设置 —— 这个文件里还有
 * 自动通过阈值、待办阈值、备份开关，任何一项被这条路径覆盖都是事故。
 */
async function saveRoute(cwd, route) {
  if (!isRoute(route)) return null
  const { settings } = await writeSettings(cwd, {
    modelProvider: str(route.provider),
    modelModel: str(route.model),
  })
  return { provider: str(settings.modelProvider), model: str(settings.modelModel) }
}

export { resolveRoute, readCatalog, saveRoute }
