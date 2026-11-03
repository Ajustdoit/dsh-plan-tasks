/**
 * 图片灯箱（id=UpcIC7-IMG）：**当前窗口**的浮窗预览。
 *
 * 用途：条目卡片上的附件缩略图、以及输入框里待发送的图片，点一下在当前窗口浮起看大图。
 *
 * ── 为什么不用「在面板里渲染一个 fixed 层」────────────────
 * 插件挂在**侧边栏**里，而 `.plt-root` 带 `container-type:size`（那是为了让输入框
 * 按面板高度伸缩，见 01-base.css 的说明）。按 CSS Containment 规范，
 * 建立了 containment 的元素会成为 `position:fixed` 后代的 **containing block** ——
 * 也就是说，写在面板里的 fixed 浮层**不会**相对视口定位，
 * 而是相对侧边栏那一小块。表现就是：图片放大后仍挤在窄条里，
 * 看起来像「跳到了旁边一个单独的地方」。
 *
 * 同理 `absolute + inset:0` 更糟 —— 直接就是侧栏大小。
 *
 * ── 解法：把节点挂到 document.body ────────────────
 * 客户端片段只能 `require('react')`，没有 ReactDOM，所以不能用
 * `createPortal`。这里退一步：用 `document.createElement` 自建节点挂到 body，
 * React 那个 handler 只负责在 state 变化时命令这棵 DOM 更新。
 *
 * 代价是这部分不再「声明式」，好处是**彻底摆脱面板的 containment 与层叠上下文**，
 * 浮层真正覆盖整个窗口。对一个只有一个浮层的场景，这个交换是划算的。
 */

/** 灯箱状态：`{ name, cwd }` 或 null。 */
let lightboxState = null
const lightboxListeners = new Set()
/** 挂在 body 上的根节点（惰性创建，复用同一个）。 */
let lightboxEl = null
/** 当前渲染用的 React 与 URL 函数，由 attach 时记下。 */
let lightboxUrlOf = null

/** 订阅灯箱状态（供面板根组件使用）。 */
function subscribeLightbox(fn) {
  lightboxListeners.add(fn)
  return () => lightboxListeners.delete(fn)
}

/** body 上的挂载点。 */
function lightboxHost() {
  if (typeof document === 'undefined') return null
  if (lightboxEl === null || lightboxEl.isConnected !== true) {
    lightboxEl = document.createElement('div')
    // 自身不占位：内部那个 .plt-lightbox 才是 fixed 的全屏层。
    lightboxEl.className = 'plt-lightbox-host'
    document.body.appendChild(lightboxEl)
  }
  return lightboxEl
}

/** 把当前状态画到 body 那个节点上。 */
function paintLightbox() {
  const host = lightboxHost()
  if (host === null) return
  const src = lightboxState === null ? '' : lightboxUrlOf(lightboxState.name, lightboxState.cwd)
  if (lightboxState === null || src === '') {
    host.replaceChildren()
    return
  }
  // 直接拼 DOM，不走 React —— 这是唯一被允许的方式（没有 ReactDOM）。
  const mask = document.createElement('div')
  mask.className = 'plt-lightbox'
  mask.setAttribute('role', 'dialog')
  mask.setAttribute('aria-modal', 'true')
  mask.setAttribute('aria-label', '查看图片')
  // 点遮罩关闭；点图片本身不关（否则想细看时一动就没了）。
  mask.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeLightbox()
  })

  const body = document.createElement('div')
  body.className = 'plt-lightbox-body'

  const img = document.createElement('img')
  img.className = 'plt-lightbox-img'
  img.src = src
  img.alt = '附件图片'
  img.draggable = false
  // 图片加载失败时给一句人话，而不是留一个破图图标。
  img.addEventListener('error', () => {
    img.alt = '图片加载失败（可能已被删除）'
    img.classList.add('is-broken')
  })

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'plt-lightbox-close'
  close.setAttribute('aria-label', '关闭')
  close.setAttribute('data-tip', '关闭（Esc）')
  close.textContent = '\u00d7'
  close.addEventListener('click', () => closeLightbox())

  body.appendChild(img)
  body.appendChild(close)
  mask.appendChild(body)
  host.replaceChildren(mask)
}

function emitLightbox() {
  paintLightbox()
  for (const fn of lightboxListeners) fn(lightboxState)
}

/**
 * 打开灯箱。
 * @param name 图片文件名（`Ab3xK9-1.png`）
 * @param cwd 项目根（拼 URL 用）
 */
function openLightbox(name, cwd) {
  const text = String(name ?? '').trim()
  if (text === '') return
  lightboxState = { name: text, cwd: typeof cwd === 'string' ? cwd : '' }
  emitLightbox()
}

/** 关闭灯箱（幂等；空状态不重复通知）。 */
function closeLightbox() {
  if (lightboxState === null) return
  lightboxState = null
  emitLightbox()
}

/**
 * 由面板根组件调用一次：记住 React 与 URL 函数，并在卸载时清掉 body 上的节点。
 *
 * 返回清理函数 —— 面板被关掉时必须把浮层一起带走，
 * 否则它会留在 body 上，用户得刷新页面才消失。
 */
function attachLightbox(urlOf) {
  lightboxUrlOf = urlOf
  // 有残留状态就重画一次（比如热更新后）。
  if (lightboxState !== null) paintLightbox()
  return () => {
    if (lightboxEl !== null) {
      lightboxEl.remove()
      lightboxEl = null
    }
    lightboxState = null
  }
}
