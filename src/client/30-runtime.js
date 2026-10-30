
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
     * 直接在浏览器侧中止当前会话正在跑的这一轮（id=208「暂停」）。
     * 与 kickoffViaClient 对称：优先用现成的 Session 绑定，没有就 retain 一次再放掉。
     *
     * `session.cancel()` 的语义是「停掉当前 turn，但保留待处理的收件箱」—— 正好是我们要的
     * 「挂起而不是清空」：plan.json 已经写进去的 startedAt / note / execute 一个字段都不会被动。
     *
     * @returns true 表示已请求中止；false 表示这条路不可用，调用方应回退到 Host 路由。
     */
    async function stopViaClient(ctx, sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return false
      const sessions = ctx?.get?.('sessions')
      if (sessions === undefined || typeof sessions.binding !== 'function') return false
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
        if (session === undefined || typeof session.cancel !== 'function') return false
        const result = await session.cancel()
        if (result !== null && typeof result === 'object' && result.ok === false) {
          const failure = result.error
          throw new Error(failure?.message ?? '中止失败')
        }
        return true
      } finally {
        if (owned !== null) {
          try {
            owned.release()
          } catch {
            /* 释放失败不影响中止结果 */
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
      // id=272：父节点下面挂着 children，子任务的状态变化也要让指纹变 ——
      // 否则「子任务被标记完成」这一步在面板上不会重渲染，要等下一次别的变动才显示。
      const one = (it) =>
        `${it.id}|${it.order}|${it.execute === true ? 1 : 0}|${it.review === true ? 1 : 0}|${it.draft === true ? 1 : 0}|${it.failed === true ? 1 : 0}|${it.startedAt ?? ''}|${it.noteLen ?? ''}|${it.planLen ?? ''}|${it.time ?? 0}|${it.name ?? ''}`
      const parts = items.map((it) => {
        if (!Array.isArray(it.children) || it.children.length === 0) return one(it)
        return `${one(it)}[${it.children.map(one).join(',')}]`
      })
      return `${data.planExists === true ? 1 : 0}|${data.broken === true ? 1 : 0}|s${data.settings?.noteLimit ?? ''}|${parts.join(';')}`
    }

    /**
     * id=348：耗时字段的唯一解析口。宿主侧 store.normalizeItem 用的是同一套规则
     * （缺失 / 非法 / 负数一律 0），这里必须对齐 —— 否则「盘上写的是 0、界面算成 NaN」
     * 就会出现「同一批条目有的显示耗时、有的空白」。
     */
    function toMillis(ms) {
      const n = Number(ms)
      return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
    }

    function fmtTime(ms) {
      const n = toMillis(ms)
      if (n <= 0) return ''
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
      const n = toMillis(ms)
      if (n <= 0) return ''
      const s = Math.max(1, Math.round(n / 1000))
      if (s < 60) return `${s}秒`
      const m = Math.floor(s / 60)
      const rs = s % 60
      if (m < 60) return rs === 0 ? `${m}分钟` : `${m}分钟${rs}秒`
      const hh = Math.floor(m / 60)
      const rm = m % 60
      return rm === 0 ? `${hh}小时` : `${hh}小时${rm}分钟`
    }

    /**
     * 裁剪之后追在提示后面的「已备份」尾巴（id=257）。
     *
     * 宿主只有在真备份成功时才回 `backup`，所以这里不做任何猜测：
     * 有就报一句，没有就当没这回事。提示文案统一由这一个函数生成，
     * 免得「改上限」和「审核通过」两条路写出两种说法。
     */
    function backupSuffix(data) {
      const backup = data?.backup
      if (backup === null || backup === undefined) return ''
      const name = typeof backup.path === 'string' && backup.path !== '' ? backup.path.split(/[\\/]/).pop() : ''
      return name === '' ? ' · 已备份完整 JSON' : ` · 已备份到 ${name}`
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
      // id=274：父节点（拆解批次）自己没有执行状态 —— 它的 execute / review 只是容器
      // 标记，真正在跑的是 children。所以父级的状态按子任务**聚合**：
      // 只要有一条在跑就是「执行中」，整批做完未审是「待审核」，整批审完是「已审核」，
      // 其余（还没轮到 / 有失败 / 有中断）才按待执行那一档的既有规则给。
      const kids = Array.isArray(item.children) ? item.children : []
      if (kids.length > 0) {
        // 草稿优先：整批被标成草稿时，即使子任务都做完了也还是草稿（不能因为
        // 下面那条「整批做完 = 待审核」把草稿洗成待审核）。
        if (item.draft === true) return { key: 'draft', label: '草稿' }
        // id=344：整批做完、但还有子任务没审 —— 这条父是「待审核」，不是「待执行」。
        // 队列侧已经不把它当可执行任务（正文为空），面板这一侧也必须同口径，
        // 否则会出现「点了开始，什么都没发生」的观感。
        // 注意要排除「全都审完了」：那是下面的 reviewed 分支，不能被这里抢走。
        if (item.review !== true
          && kids.every((kid) => kid?.execute === true)
          && !kids.every((kid) => kid?.review === true)) {
          return { key: 'unreviewed', label: '待审核' }
        }
        const states = kids.map((child) => statusOf(child))
        if (states.some((s) => s.key === 'running')) return { key: 'running', label: '执行中' }
        if (states.every((s) => s.key === 'reviewed')) return { key: 'reviewed', label: '已审核' }
        if (states.every((s) => s.key === 'reviewed' || s.key === 'unreviewed')) return { key: 'unreviewed', label: '待审核' }
        if (states.every((s) => s.key === 'failed')) return { key: 'failed', label: '失败' }
        if (states.some((s) => s.key === 'failed')) return { key: 'failed', label: '部分失败' }
        if (states.every((s) => s.key === 'interrupted')) return { key: 'interrupted', label: '已中断' }
        if (impliedRunning === true) return { key: 'running', label: '执行中' }
        return { key: 'todo', label: '待执行' }
      }
      if (item.draft === true) return { key: 'draft', label: '草稿' }
      if (item.execute === true) {
        return item.review === true
          ? { key: 'reviewed', label: '已审核' }
          : { key: 'unreviewed', label: '待审核' }
      }
      // id=233：「已中断」必须排在 running 之前。中断后 startedAt 是故意保留的
      // （它是「继续 = 续做而不是重跑」的依据），若仍按 startedAt 判 running，
      // 被中断的条目会一直显示「执行中」、上方按钮一直显示「干活中」——
      // 这正是用户报的那个 bug。落盘的 interrupted 才是这一档的真源，内存态不参与。
      // 失败的条目留在待执行组里，但不再显示成「执行中」，模型也不会再选它。
      if (item.failed === true) return { key: 'failed', label: '失败' }
      if (item.interrupted === true) return { key: 'interrupted', label: '已中断' }
      if (typeof item.startedAt === 'string' && item.startedAt !== '') return { key: 'running', label: '执行中' }
      // 模型刚开始干活、还没来得及把 startedAt 写进 plan.json 的这一小段：
      // 会话已经是 running 了，就把排在最前面的那条待执行按「执行中」显示，
      // 否则界面上会出现「AI 明明在跑，待执行里每条都写着待执行」的错位。
      if (impliedRunning) return { key: 'running', label: '执行中' }
      return { key: 'todo', label: '待执行' }
    }

    /**
     * 任务类型 → 提交时自动加在提示词前面的前缀。
     *
     * `目标` 以前也会拼一个 `/目标 `，id=217 定位时发现那是个雷：harness 的
     * slash 命令把「目标」注册成了 `/goal` 的中文别名（`dsh-client-ui-commands`
     * 的 `token.goal`），这段文字一旦被人粘进左侧输入框，整条任务就会被当成
     * `/goal` 的 objective 参数吞掉，根本到不了模型。真正的目标模式改由
     * `mode` 字段承载（宿主 `modeForTaskType`），前缀不再需要。
     */
    function typePrefix(type) {
      if (type === '仅回答') return '仅回答：'
      return ''
    }

    /**
     * 深入模板的识别句。正文里已经含这一句，就说明它已经包过一层（id=262 幂等）：
     * 用户把改好的提示词再粘回来、或者撤回了又重新发送，都不该再套第二层。
     * 它同时是「深入模式生效过」的落盘证据，比另存一个 boolean 更耐改。
     */
    const DEEP_MARK = '我想让这项任务做得更深入'

    /**
     * 多行原文包成 Markdown 引用块（id=262）。
     *
     * 之前原文直接拼在「当前任务：」后面，第二行以下顶格混进正文，模型读不出
     * 哪几行是用户原话、哪几行是我们加的模板。引用块是最省字、模型又最认的边界标记：
     * 每行一个 `> `，空行留一个裸 `>`，多段原文也不会被压成一段。
     */
    function quoteLines(text) {
      return String(text ?? '')
        .split('\n')
        .map((line) => (line.trim() === '' ? '>' : `> ${line}`))
        .join('\n')
    }

    /**
     * 深入模式：把用户随手写的一行任务改写成一段「要求做深、不许做大」的提示词。
     * 原文放在最上面（模型第一眼要看到用户到底要什么），后面追加四问 + 重写要求。
     *
     * id=262 的三处修正：
     * 1. 幂等：已含 {@link DEEP_MARK} 就原样返回，重复粘贴不会得到「当前任务：当前任务：…」；
     * 2. CRLF 归一：`\r\n` 先收成 `\n`，否则模板里会夹着孤立的 `\r`，模型侧常被读成空行；
     * 3. 原文包引用块，多行原文不再顶格混进模板正文。
     */
    function deepPrompt(task) {
      const body = String(task ?? '')
        .replace(/\r\n?/g, '\n')
        .trim()
      if (body.includes(DEEP_MARK)) return body
      return [
        '当前任务原文如下（引用块里是我的原话，可能有多行）：',
        body === '' ? '> （空）' : quoteLines(body),
        '',
        DEEP_MARK + '，而不是把规模做得更大。在重写任务之前，请先：',
        '1. 说明这个领域的顶尖专业人士在这里会做哪些我没有要求的事',
        '2. 指出他们会从哪些最原始的材料入手，而不是从已经替我加工整理过的信息入手',
        '3. 列出他们会使用的具体方法和工具',
        '4. 说明除了你或我之外，还有什么能够证明结果是正确的',
        '',
        '然后重写我的提示词，明确要求完成上述这些事。',
      ].join('\n')
    }

    /**
     * 提交时拼出最终写进 plan 的那段提示词（id=262）。
     *
     * 三种模式的优先级与叠加规则收在这一个函数里，别处不再各拼各的：
     * - 草稿：一律存用户原话（改写了就不是草稿了，转正/再编辑时再决定）；
     * - 仅回答：前缀单独占一行（`仅回答：\n<正文>`）——以前是 `仅回答：当前任务：…`
     *   直接贴在一起，两个标签连成一串谁也读不懂；
     * - 深入：先过 {@link deepPrompt}（自带幂等与 CRLF 归一），再叠前缀。
     *
     * 前缀先剥后加，保证「一条提示词里最多一个前缀」：用户自己写着「仅回答：」
     * 又选了仅回答类型时，不会变成两个。
     */
    function composePrompt(options) {
      const body = String(options?.text ?? '')
      if (options?.draft === true) return body.trim()
      const prefix = typePrefix(options?.taskType)
      const raw = options?.deep === true ? deepPrompt(body) : body.replace(/\r\n?/g, '\n')
      if (prefix === '') return raw
      const bare = raw.trimStart().startsWith(prefix) ? raw.trimStart().slice(prefix.length).trimStart() : raw.trimStart()
      return `${prefix}\n${bare}`
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
