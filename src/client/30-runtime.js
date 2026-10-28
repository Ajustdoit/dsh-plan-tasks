
    /**
     * 直接在浏览器侧往当前会话发一条提示词（等价于用户自己敲）。
     * 走 Client 的 sessions 服务：beginSubmission 先登记本地回声（左侧对话立刻出现），
     * 再 prompt 真正发到 Host。这样不依赖 Host 是否已加载最新路由。
     * @returns true 表示已发出；false 表示这条路不可用，调用方可以回退到 Host 路由。
     */
    async function kickoffViaClient(ctx, sessionId, text) {
      if (typeof sessionId !== 'string' || sessionId === '') return false
      const sessions = ctx?.get?.('sessions')
      if (sessions === undefined || typeof sessions.binding !== 'function') return false
      // 优先借现成的绑定（侧边栏已经 retain 过当前会话）；没有就自己 retain 一次再放掉。
      let session = sessions.binding(sessionId)?.session
      let owned = null
      if (session === undefined && typeof sessions.retain === 'function') {
        try {
          owned = sessions.retain({ sessionId }, { source: 'controllerOperation' })
          session = owned?.binding?.session
        } catch {
          owned = null
        }
      }
      try {
        if (session === undefined || typeof session.prompt !== 'function') return false
        if (typeof session.beginSubmission !== 'function') return false
        const handle = session.beginSubmission({ mode: 'queue', text, attachments: [] })
        const result = await session.prompt([{ type: 'text', text }], 'queue', undefined, handle.requestId)
        if (result !== null && typeof result === 'object' && result.ok === false) {
          handle.abandon()
          const failure = result.error
          throw new Error(failure?.message ?? '发送失败')
        }
        return true
      } finally {
        if (owned !== null) {
          try {
            owned.release()
          } catch {
            /* 释放失败不影响发送结果 */
          }
        }
      }
    }

    /**
     * 调 Host 半边：同源 POST + x-requested-with。
     * options.timeoutMs 是超时预算（默认 120s）：到点 abort 并抛 code='timeout' 的错误，
     * 让调用方一定收到一个结局，不会因为请求悬着而把遮罩/转圈永远留在界面上。
     */
    async function call(method, payload, options) {
      const timeoutMs = typeof options?.timeoutMs === 'number' ? options.timeoutMs : 120000
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const timer = controller === null ? null : setTimeout(() => controller.abort(), timeoutMs)
      let response
      try {
        response = await fetch(API_BASE + method, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
          body: JSON.stringify(payload ?? {}),
          signal: controller === null ? undefined : controller.signal,
        })
      } catch (error) {
        // abort 在浏览器里报的是 AbortError；统一换成人能看懂的超时文案。
        if (error instanceof Error && (error.name === 'AbortError' || error.code === 20)) {
          const timeout = new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒没有返回）`)
          timeout.code = 'timeout'
          throw timeout
        }
        throw error
      } finally {
        if (timer !== null) clearTimeout(timer)
      }
      const parsed = await response.json().catch(() => null)
      if (parsed === null || parsed.ok !== true) {
        const message = parsed?.error?.message ?? `HTTP ${response.status}`
        const error = new Error(message)
        error.code = parsed?.error?.code ?? 'http'
        throw error
      }
      return parsed.value
    }

    /**
     * 列表数据的指纹：只取驱动界面的那些字段。
     * 自动刷新每 5 秒一次，绝大多数轮次里只有 1 条真的变了；指纹相同就跳过 setState，
     * 省掉 100 个条目全树的重新 diff。
     */
    function dataSignature(data) {
      if (data === null || typeof data !== 'object') return ''
      const items = Array.isArray(data.items) ? data.items : []
      const parts = items.map(
        (it) =>
          `${it.id}|${it.order}|${it.execute === true ? 1 : 0}|${it.review === true ? 1 : 0}|${it.draft === true ? 1 : 0}|${it.startedAt ?? ''}|${it.noteLen ?? ''}|${it.planLen ?? ''}|${it.time ?? 0}|${it.name ?? ''}`,
      )
      return `${data.planExists === true ? 1 : 0}|${data.broken === true ? 1 : 0}|s${data.settings?.reviewedLimit ?? ''}|${parts.join(';')}`
    }

    function fmtTime(ms) {
      const n = Number(ms)
      if (!Number.isFinite(n) || n <= 0) return ''
      if (n < 1000) return `${n}ms`
      const s = Math.round(n / 1000)
      if (s < 60) return `${s} 秒`
      const m = Math.floor(s / 60)
      const rs = s % 60
      if (m < 60) return rs === 0 ? `${m} 分` : `${m} 分 ${rs} 秒`
      const hh = Math.floor(m / 60)
      return `${hh} 时 ${m % 60} 分`
    }

    /* id=177：标题行的紧凑耗时文本。输入与 fmtTime 一样是**毫秒**——拆解批次里写的
       「秒数」是口径笔误：store 落盘的 time 就是毫秒（Date.now() - startedAt），
       按秒处理会放大 1000 倍。措辞用「X分钟Y秒」，与详情的 fmtTime 分工：
       详情给人细看，标题给人扫。缺失 / 0 / 非法一律返回空串，由调用方把整个节点
       隐藏（0 在 store 语义里就是「还没测出耗时」：默认值和 clearTime 都归 0）。
       正数但不足 1 秒显示「1秒」，免得给真跑过的任务挂个「0秒」。 */
    function fmtDur(ms) {
      const n = Number(ms)
      if (!Number.isFinite(n) || n <= 0) return ''
      const s = Math.max(1, Math.round(n / 1000))
      if (s < 60) return `${s}秒`
      const m = Math.floor(s / 60)
      const rs = s % 60
      if (m < 60) return rs === 0 ? `${m}分钟` : `${m}分钟${rs}秒`
      const hh = Math.floor(m / 60)
      const rm = m % 60
      return rm === 0 ? `${hh}小时` : `${hh}小时${rm}分钟`
    }

    function fmtDate(iso) {
      if (typeof iso !== 'string' || iso === '') return ''
      const t = Date.parse(iso)
      if (!Number.isFinite(t)) return ''
      const d = new Date(t)
      const pad = (v) => String(v).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    /**
     * 状态标签统一成三段：待执行 / 待审核 / 已审核。
     * 执行中的条目属于「待执行」组的中间态，标签换成「转圈图标 + 执行中」，
     * 让右侧一眼能区分「还没轮到」和「正在跑」（颜色与流光继续承担视觉强调）。
     * 执行完成后的两种审核态（待审核 / 已审核）直接由这里给出，不再叠第二个标签。
     */
    function statusOf(item, impliedRunning = false) {
      if (item.draft === true) return { key: 'draft', label: '草稿' }
      if (item.execute === true) {
        return item.review === true
          ? { key: 'reviewed', label: '已审核' }
          : { key: 'unreviewed', label: '待审核' }
      }
      if (typeof item.startedAt === 'string' && item.startedAt !== '') return { key: 'running', label: '执行中' }
      // 模型刚开始干活、还没来得及把 startedAt 写进 plan.json 的这一小段：
      // 会话已经是 running 了，就把排在最前面的那条待执行按「执行中」显示，
      // 否则界面上会出现「AI 明明在跑，待执行里每条都写着待执行」的错位。
      if (impliedRunning) return { key: 'running', label: '执行中' }
      return { key: 'todo', label: '待执行' }
    }

    /** 任务类型 → 提交时自动加在提示词前面的前缀。 */
    function typePrefix(type) {
      if (type === '仅回答') return '仅回答：'
      if (type === '目标') return '/目标 '
      return ''
    }

    /**
     * 深入模式：把用户随手写的一行任务改写成一段「要求做深、不许做大」的提示词。
     * 原文放在最上面（模型第一眼要看到用户到底要什么），后面追加四问 + 重写要求。
     * 换行用 \n 拼接，避免缩进把多行模板带歪。
     */
    function deepPrompt(task) {
      const body = String(task ?? '').trim()
      return [
        `当前任务：${body}`,
        '',
        '我想让这项任务做得更深入，而不是把规模做得更大。在重写任务之前，请先：',
        '1. 说明这个领域的顶尖专业人士在这里会做哪些我没有要求的事',
        '2. 指出他们会从哪些最原始的材料入手，而不是从已经替我加工整理过的信息入手',
        '3. 列出他们会使用的具体方法和工具',
        '4. 说明除了你或我之外，还有什么能够证明结果是正确的',
        '',
        '然后重写我的提示词，明确要求完成上述这些事。',
      ].join('\n')
    }

    function InitDialog(props) {
      return h(
        'div',
        { className: 'plt-mask', onClick: props.onClose },
        h(
          'div',
          { className: 'plt-dialog', onClick: (e) => e.stopPropagation() },
          h('h3', null, '初始化项目任务进度？'),
          h(
            'p',
            null,
            '当前项目还没有任务进度文件。要创建它吗？',
            h('br'),
            h('code', null, '.plan/plan.json'),
            ' —— 计划列表',
            h('br'),
            '执行技能「plan-tasks」是插件内置的，已经通过技能系统注册好，',
            '不往项目里写任何文件、点完就能用，也不需要额外同步。',
          ),
          h(
            'div',
            { className: 'plt-actions' },
            h('button', { className: 'plt-btn', onClick: props.onClose, disabled: props.busy }, '稍后'),
            h('button', { className: 'plt-btn primary', onClick: props.onInit, disabled: props.busy }, props.busy ? '初始化中…' : '初始化'),
          ),
        ),
      )
    }

    /** 复制文本到剪贴板：优先 clipboard API，非安全上下文/权限被拒时退回 execCommand。 */
    async function copyText(text) {
      const value = typeof text === 'string' ? text : String(text ?? '')
      try {
        if (navigator?.clipboard?.writeText !== undefined) {
          await navigator.clipboard.writeText(value)
          return true
        }
      } catch {
        /* 掉到下面的兜底 */
      }
      try {
        const area = document.createElement('textarea')
        area.value = value
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.top = '-1000px'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(area)
        return ok !== false
      } catch {
        return false
      }
    }
