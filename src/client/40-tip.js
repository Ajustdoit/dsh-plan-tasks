    /**
     * 统一悬浮提示的运行时（id=249：样式 + 最小组件逻辑）。
     *
     * 为什么样式之外还要在这里给几行 JS：气泡的类名一旦只出现在 CSS 里，
     * `scripts/dead-css.mjs` 会把它判成死规则（确实没人挂）。而 250 才逐个替换
     * `title:`，此刻还没有元素带 `data-tip`。所以这里把「谁负责画气泡」定下来：
     * 事件委托 + 单例节点 + 纯几何计算，250 只负责把 `title` 换成 `data-tip`。
     *
     * 三个刻意的选择：
     * 1. **事件委托挂在面板根上**，不给 40 个元素各挂 listener —— 卡片是每次
     *    render 重建的，逐个绑会把内存与解绑都搞复杂。
     * 2. **气泡是单例**（一个 div 复用）。连续快速 hover 只可能有一个气泡，
     *    从结构上就不可能出现「残留多个」。
     * 3. **几何计算是纯函数** `tipPlace()`：给定锚点矩形、面板矩形、气泡尺寸，
     *    返回方向与坐标。放成纯函数是为了 249 就能直接单测翻转逻辑，
     *    不用先把它塞进 DOM 里。
     */

    const TIP_SELECTOR = '[data-tip]'

    /** 贴着面板边缘时的最小留白（px）。 */
    const TIP_MARGIN = 6

    /**
     * 算气泡该放哪。坐标相对面板（面板是 fixed 后代的包含块，见 06-tooltip.js）。
     *
     * @param {{left:number,top:number,right:number,bottom:number,width:number,height:number}} anchor
     * @param {{width:number,height:number}} panel
     * @param {{width:number,height:number}} size
     * @param {{offset?:number, margin?:number}} [opts]
     * @returns {{side:'top'|'bottom'|'left'|'right', left:number, top:number}}
     */
    function tipPlace(anchor, panel, size, opts) {
      const offset = opts?.offset ?? 8
      const margin = opts?.margin ?? TIP_MARGIN
      const centerX = anchor.left + anchor.width / 2
      const centerY = anchor.top + anchor.height / 2
      // 水平方向上先按「居中」算，再夹进面板，免得贴着左右边时气泡一半在外。
      const clampX = (value) => Math.min(Math.max(value, margin), Math.max(margin, panel.width - size.width - margin))
      // 上方放不下就翻到下面；下面也放不下就挑空间大的那一侧（宁可压住一点也别飘出去）。
      const above = anchor.top - offset - size.height
      const below = anchor.bottom + offset
      if (above >= margin) {
        return { side: 'top', left: clampX(centerX - size.width / 2), top: above }
      }
      if (below + size.height <= panel.height - margin) {
        return { side: 'bottom', left: clampX(centerX - size.width / 2), top: below }
      }
      // 上下都挤：改成左右。左优先（侧栏左边就是宿主界面，气泡朝右更不容易被挡）。
      const leftOf = anchor.left - offset - size.width
      const rightOf = anchor.right + offset
      if (rightOf + size.width <= panel.width - margin) {
        return { side: 'right', left: rightOf, top: Math.min(Math.max(centerY - size.height / 2, margin), Math.max(margin, panel.height - size.height - margin)) }
      }
      if (leftOf >= margin) {
        return { side: 'left', left: leftOf, top: Math.min(Math.max(centerY - size.height / 2, margin), Math.max(margin, panel.height - size.height - margin)) }
      }
      return { side: 'top', left: clampX(centerX - size.width / 2), top: Math.max(margin, above) }
    }

    /**
     * 单例气泡节点：第一次用的时候建，之后一直复用。
     *
     * **必须挂在面板根里，不能挂 document.body**（id=252 联合回归抓到的真 bug）。
     * 两个后果，都只在真实页面上才显形：
     * 1. 颜色全在 `.plt-root` 上定义（05-tooltip-vars.js），挂 body 就出了变量作用域 ——
     *    `var(--plt-tip-bg)` 解析成空，气泡变成透明底黑字、0 圆角无边框。
     * 2. `tipPlace()` 给的坐标是「相对面板」的，而 body 下的 fixed 元素按视口定位 ——
     *    侧栏在窗口右侧时，气泡会整体偏出去一个侧栏偏移量。
     * 挂进面板根之后：变量在同一条链上，且 `.plt-root` 的 `container-type:size`
     * 让它成为 fixed 后代的包含块，坐标系正好对上。
     */
    function tipElement(panelEl) {
      const host = panelEl ?? document.body
      let el = document.querySelector('.plt-tip')
      if (el !== null) {
        // 面板换了（换会话/重挂载）就跟着搬过去，别留在上一块面板里。
        if (el.parentNode !== host) host.appendChild(el)
        return el
      }
      el = document.createElement('div')
      el.className = 'plt-tip plt-tip--top'
      el.setAttribute('role', 'tooltip')
      el.style.visibility = 'hidden'
      // 文字装在里层（id=251）：外层要留出 1px 边框与四支箭头的位置，
      // 高度夹紧只能作用在里层 —— 给外层加 overflow:hidden 会把箭头一并裁掉。
      const inner = document.createElement('div')
      inner.className = 'plt-tip-inner'
      el.appendChild(inner)
      host.appendChild(el)
      return el
    }

    /** 里层文字容器（外层只管边框、箭头与定位）。 */
    function tipInner(el) {
      const found = el.querySelector('.plt-tip-inner')
      if (found !== null) return found
      const inner = document.createElement('div')
      inner.className = 'plt-tip-inner'
      el.appendChild(inner)
      return inner
    }

    /**
     * 这个元素该不该弹提示（id=251）。
     *
     * 禁用态不弹：`disabled` 的表单控件在各浏览器上收不收鼠标事件并不一致
     * （Chrome 收、Firefox 不收），同一套交互在两处表现不同比「少一条说明」更糟。
     * 统一成「不弹」之后，禁用态要传达的信息交给 `aria-label` 与页面上的可见文案。
     */
    function tipBlocked(anchorEl) {
      if (anchorEl === null || anchorEl === undefined) return true
      if (typeof anchorEl.matches !== 'function') return false
      if (anchorEl.matches(':disabled') === true) return true
      if (anchorEl.getAttribute('aria-disabled') === 'true') return true
      // 冒泡上来的目标可能是禁用控件内部的 span/svg：往上再看一层宿主元素。
      const host = anchorEl.closest('[aria-disabled="true"]')
      return host !== null
    }

    /**
     * 把气泡挪到锚点旁边并显示。
     * 文案直接取 `data-tip`；空串等于没有，不弹。
     */
    function tipShow(anchorEl, panelEl, text) {
      const body = String(text ?? '').trim()
      if (body === '' || panelEl === null || anchorEl === null) return
      if (tipBlocked(anchorEl) === true) return
      const el = tipElement(panelEl)
      const inner = tipInner(el)
      inner.textContent = body
      // 先落上方向类再量尺寸：max-width 与换行都跟方向无关，但箭头位置有关，量之前得让类名生效。
      el.className = 'plt-tip plt-tip--top'
      el.style.visibility = 'hidden'
      el.style.left = '0px'
      el.style.top = '0px'
      const panel = panelEl.getBoundingClientRect()
      // 窄面板（侧栏被拖到 300px 以下）时，变量里的 320px 上限比面板还宽 ——
      // 那样气泡会横向探出面板。按面板实际宽度再夹一次（id=251）。
      const maxW = Math.max(120, panel.width - TIP_MARGIN * 2)
      el.style.maxWidth = `${Math.round(maxW)}px`
      // 极长文案（卡片名带整段计划正文）可能高过面板：夹住高度，否则气泡底边会探出去。
      // 被裁掉的部分仍完整留在数据源里（data-tip 与 aria-label），不是信息丢失。
      inner.style.maxHeight = `${Math.round(Math.max(48, panel.height - TIP_MARGIN * 2))}px`
      const anchor = anchorEl.getBoundingClientRect()
      const size = { width: el.offsetWidth, height: el.offsetHeight }
      // 面板里量出来的矩形是相对视口的，而气泡的包含块是面板 → 统一减掉面板原点（下方 tipPlace 的入参就用相对值）。
      const place = tipPlace(
        { left: anchor.left - panel.left, top: anchor.top - panel.top, right: anchor.right - panel.left, bottom: anchor.bottom - panel.top, width: anchor.width, height: anchor.height },
        { width: panel.width, height: panel.height },
        size,
      )
      el.className = `plt-tip plt-tip--${place.side}`
      el.style.left = `${Math.round(place.left)}px`
      el.style.top = `${Math.round(place.top)}px`
      el.style.visibility = ''
      // 下一帧再加 is-on，让 opacity 从 0 过渡过去；同一帧设会跳过过渡直接显示。
      el.dataset.on = 'pending'
      requestAnimationFrame(() => {
        if (el.dataset.on === 'pending') {
          el.dataset.on = 'yes'
          el.classList.add('is-on')
        }
      })
    }

    function tipHide() {
      const el = document.querySelector('.plt-tip')
      if (el === null) return
      el.classList.remove('is-on')
      el.dataset.on = 'no'
      el.style.visibility = 'hidden'
    }

    /** 从事件目标往上找最近的带 `data-tip` 的祖先（气泡本身不接事件，不会命中）。 */
    function tipAnchorOf(target, panelEl) {
      let node = target
      while (node !== null && node !== undefined && node !== panelEl) {
        if (typeof node.matches === 'function' && node.matches(TIP_SELECTOR)) return node
        node = node.parentElement
      }
      return null
    }

    /**
     * 在面板根上挂一套委托监听：移入/聚焦显示、移出/失焦/滚动收起（id=251 补齐）。
     *
     * 键盘用户靠 Tab 移动焦点，`pointerover` 永远不触发 —— 所以 `focusin` 也走同一条显示路径。
     * 收起侧对应 `focusout`（已经有），外加 `pointerdown`（点下去就别挡视线）、
     * `scroll`（capture：任何内层滚动容器滚了，气泡的位置就过时了）、窗口失焦。
     */
    function useTipLayer(rootRef) {
      React.useEffect(() => {
        const root = rootRef.current
        if (root === null || root === undefined) return undefined
        let current = null
        const reveal = (anchor) => {
          if (anchor === current) return
          current = anchor
          if (anchor === null) {
            tipHide()
            return
          }
          // 禁用元素不弹（tipBlocked 里判）：disabled 控件收不收鼠标事件各浏览器不一致，
          // 统一成不弹，避免同一套交互在两处表现不同。
          tipShow(anchor, root, anchor.getAttribute('data-tip'))
        }
        const onOver = (event) => reveal(tipAnchorOf(event.target, root))
        const onFocusIn = (event) => {
          // 只在键盘来的焦点上弹：鼠标点按钮也会触发 focusin，那时 pointerover 已经弹过了，
          // 这里再 show 一次会把刚隐藏的气泡又拉回来（点一下就闪一下）。
          if (event.target !== current) reveal(tipAnchorOf(event.target, root))
        }
        const onLeave = () => {
          current = null
          tipHide()
        }
        root.addEventListener('pointerover', onOver)
        root.addEventListener('focusin', onFocusIn)
        root.addEventListener('pointerdown', onLeave)
        root.addEventListener('focusout', onLeave)
        root.addEventListener('scroll', onLeave, true)
        window.addEventListener('blur', onLeave)
        return () => {
          root.removeEventListener('pointerover', onOver)
          root.removeEventListener('focusin', onFocusIn)
          root.removeEventListener('pointerdown', onLeave)
          root.removeEventListener('focusout', onLeave)
          root.removeEventListener('scroll', onLeave, true)
          window.removeEventListener('blur', onLeave)
          const el = document.querySelector('.plt-tip')
          if (el !== null && el.parentNode !== null) el.parentNode.removeChild(el)
        }
      }, [rootRef])
    }
