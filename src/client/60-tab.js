    function PlanTasksTab(props) {
      const scope = props.scope ?? {}
      const ctx = props.ctx
      const sessionId = scope.sessionId ?? ''
      const cwd = scope.cwd ?? ''
      // 页签是否真的在前台可见。better-sidebar 的语义是「当前页签且右侧栏展开」，
      // 不可见时继续轮询纯属白烧流量与渲染。
      const visible = props.visible !== false
      const payload = { sessionId, cwd }
      // 草稿按项目根目录隔离存放，刷新 / 重新挂载都不丢。
      const storeKey = `dsh-plan-tasks:${cwd || 'default'}`

      const readDraft = () => {
        try {
          const raw = window.localStorage.getItem(storeKey)
          if (raw === null) return null
          const parsed = JSON.parse(raw)
          return parsed !== null && typeof parsed === 'object' ? parsed : null
        } catch {
          return null
        }
      }
      const saved = readDraft()

      const [state, setState] = React.useState({ loading: true, error: '', data: null })
      // 统一悬浮提示（id=249）：气泡挂在面板根上做事件委托，这里只提供根节点。
      // 250 会把各处原生 title 换成 data-tip，届时不用再动这一行。
      const rootRef = React.useRef(null)
      useTipLayer(rootRef)
      const [openId, setOpenId] = React.useState(saved?.openId ?? null)
      const [busy, setBusy] = React.useState(false)
      const [showInit, setShowInit] = React.useState(false)
      // 草稿模式：点亮时「发送」把内容推进「草稿」组而不是「待执行」。
      const [draftMode, setDraftMode] = React.useState(saved?.draftMode === true)
      // 深入模式：点亮后「发送」会把输入框里的任务包装成一段要求「重写并做深」的提示词。
      const [deepMode, setDeepMode] = React.useState(saved?.deepMode === true)
      // 拆解模式：点亮后「发送」不直接落一条，而是交给宿主按项目情况拆成多条草稿。
      const [splitMode, setSplitMode] = React.useState(saved?.splitMode === true)
      // 拆解是异步 LLM 调用，比 append 慢得多，单独做「正在拆解…」的进度提示。
      const [splitting, setSplitting] = React.useState(false)
      const [form, setForm] = React.useState({
        plan: typeof saved?.plan === 'string' ? saved.plan : '',
        mode: typeof saved?.mode === 'string' ? saved.mode : '',
        taskType: typeof saved?.taskType === 'string' ? saved.taskType : '修改',
        expanded: saved?.expanded === true,
      })
      const [notice, setNoticeState] = React.useState('')
      // 每条提示自己带一个停留时长（id=223）：默认 NOTICE_MS，个别调用处（拆分完成）
      // 显式要更久。用 ref 存是因为时长不是渲染内容 —— 放进 state 会白白多触发一轮渲染，
      // 而 effect 只需在文案变化时读一下当前值。每次调用都重置成默认值，
      // 免得「长提示」之后接着来的短提示继承了上一条的时长。
      const noticeMsRef = React.useRef(NOTICE_MS)
      const setNotice = (text, ms) => {
        noticeMsRef.current = typeof ms === 'number' && ms > 0 ? ms : NOTICE_MS
        setNoticeState(text)
      }
      const [dragId, setDragId] = React.useState(null)
      const [dropId, setDropId] = React.useState(null)
      // 「待审核」组里批量勾选的 id 集合。
      const [picked, setPicked] = React.useState(() => new Set())
      // 「已审核」组里批量勾选的 id 集合（用于批量删除）。
      const [pickedDone, setPickedDone] = React.useState(() => new Set())
      // 「草稿」组里批量勾选的 id 集合（用于批量转待执行 / 批量删除）。
      const [pickedDraft, setPickedDraft] = React.useState(() => new Set())
      // 分组展开态：手风琴互斥，同一时刻只有一个组展开（null = 全部折叠）。
      // 也存 localStorage，刷新后保持。
      // id=356：`null` 必须原样读回来。以前这里 `JSON.parse('null')` 得到 null 后
      // 走到最后一行 `return 'todo'` —— 也就是「所有组都收起」这个合法状态，
      // 一刷新 / 切页签重挂载就被翻译成「展开待执行」。审核完最后一条后正好会写进
      // 这个状态，于是看起来就像「点通过之后自动跳到了待执行」。
      const [openGroup, setOpenGroupState] = React.useState(() => {
        try {
          const raw = window.localStorage.getItem(`dsh-plan-tasks:groups:${cwd || 'default'}`)
          if (raw === null) return 'todo'
          const parsed = JSON.parse(raw)
          // 兼容旧版存的对象格式（{todo:true,...}），迁移成单个 key。
          if (typeof parsed === 'string') return parsed
          // 「全部折叠」是一个真实的状态，不是「读不到」—— 直接返回 null，
          // 不要让它掉进下面的兜底分支。
          if (parsed === null) return null
          if (typeof parsed === 'object') {
            const first = ['todo', 'unreviewed', 'reviewed'].find((key) => parsed[key] === true)
            return first ?? null
          }
          return 'todo'
        } catch {
          return 'todo'
        }
      })
      const setOpenGroup = (next) => {
        setOpenGroupState(next)
        try {
          window.localStorage.setItem(`dsh-plan-tasks:groups:${cwd || 'default'}`, JSON.stringify(next))
        } catch {
          /* localStorage 不可用时忽略 */
        }
      }
      // 自动刷新：默认开启，每 AUTO_INTERVAL 秒静默重读一次 plan.json。
      const [auto, setAuto] = React.useState(saved?.auto !== false)
      const [tick, setTick] = React.useState(AUTO_INTERVAL)
      // 「开始干活」按钮的发送中状态（防连点）。
      const [starting, setStarting] = React.useState(false)
      // 暂停请求在飞（id=208）：挡住重复点击，也让按钮在请求期间进忙碌态。
      const [pausing, setPausing] = React.useState(false)
      // state 是快照：同一次渲染里连点两下，两份闭包都读到 pausing === false，
      // 于是会发两个 cancel。用 ref 做同步闸门，等重渲染救场已经太晚。
      const startingRef = React.useRef(false)
      const pausingRef = React.useRef(false)
      // id=234：模型响应中断的对账机制要用的三面旗子。
      // pausedByUserRef —— 这一轮是用户自己点暂停停的（暂停路径已经写过 interrupted，别再覆盖提示）；
      // wasRunningRef  —— 对账 effect 自己的上一帧 running。不能和派发共用：
      //   两个 effect 同一次提交里按声明顺序跑，谁先写谁就把 true→false 边沿吃掉。
      // wasDispatchRunningRef —— 派发 effect 自己的上一帧 running，只给「回答结束 → 派下一条」用。
      // reconcilingRef —— 对账请求在飞，别叠第二次。派发看到它是真的就等它落盘，不能因此丢掉边沿。
      // agentRunningRef —— 异步派发途中读「现在是不是又跑起来了」，闭包里的 agentRunning 是旧的。
      // dispatchEpochRef —— 换会话时加一，作废还在飞的派发，避免把上一个会话的下一条投进新会话。
      // id=352-E：初值必须是 null（**未知**），不能是 false。
      // 用 false 的话，页面刷新后第一次观测到的 running 已经是 false，
      // `was !== true` 直接 return —— 对账那次永远不跑，孤儿 startedAt 就再也救不回来。
      // 现在 null 表示「还没观测过」，第一次观测无条件对账一次。
      const pausedByUserRef = React.useRef(false)
      const wasRunningRef = React.useRef(null)
      const wasDispatchRunningRef = React.useRef(null)
      const reconcilingRef = React.useRef(false)
      const agentRunningRef = React.useRef(false)
      const dispatchEpochRef = React.useRef(0)
      // id=341：这一轮结束后是否已经派过下一条。会话 running 会抖（工具调用之间也算空闲），
      // 没有这个标记就会在同一个空档里连派几条。只在真正发出请求时置位；定时器被清掉或请求失败要放回来。
      const dispatchedRef = React.useRef(false)
      // id=379：「完成后暂停」当前值 —— 派发 effect 要用它做闸门。
      //
      // 为什么必须是 ref 而不是直接读 state：派发 effect 的依赖只有
      // [agentRunning, sessionId, cwd]，它在**闭包里捕获的是那一次渲染的** pauseAfterDone。
      // 用户在第一轮跑到一半时拨开关，effect 不会重跑（依赖没变），
      // 于是它手里的还是旧值 —— 表现就是「拨了没用，下一条照样派出去」。
      // 用 ref 存「当前值」，异步回调与定时器里读到的永远是最新那份。
      // state 仍保留：界面渲染要用它触发重渲染。两者同源写入，见下面的 effect。
      const pauseAfterDoneRef = React.useRef(false)
      // 已挂起（id=208）：只存内存，不写 plan.json。页面刷新后按「有未完成且无 turn 在跑」
      // 自然回落为「未开始」，不需要一个跨会话会失效的持久状态字段。
      const [paused, setPaused] = React.useState(false)
      // id=377：「完成后暂停」开关 —— **本步只做 UI 结构与文案，状态源是占位变量**。
      //
      // 语义（题面）：开启后当前任务执行完不再自动派发下一个任务；关闭则继续自动派发。
      //
      // 为什么先只做占位：真正的拦截点在派发链路里（「这一轮结束后要不要派下一条」），
      // 那里现在由 `dispatchedRef` + running 的边沿驱动，改动它属于另一件事；
      // 本步先把控件、文案、显隐条件与可访问性落下来，让后续接上时不用再动结构。
      //
      // 命名就用 pauseAfterDone：与题面「完成后暂停」一一对应，
      // 不叫 autoDispatch 的反面 —— 否定式的开关名最容易被读反。
      const [pauseAfterDone, setPauseAfterDone] = React.useState(false)
      // id=379：把 state 同步进 ref，供派发 effect 在异步回调里读最新值。
      // 放在这里（state 声明旁边）而不是 effect 里，是为了「写入点只有一个」——
      // 无论是点击切换、空闲复位、还是以后别处改它，都会经过同一个 setPauseAfterDone，
      // 所以只要每次渲染同步一次就不会有落后的那一份。
      // 注意：这只覆盖「渲染之后」的读取；点击那一刻到下一次渲染之间，
      // 派发回调若正好跑起来读到的还是旧值 —— 下面 togglePauseAfterDone 里
      // 会**同步**写一次 ref，把那个窗口也关掉。
      // （ref 声明在这一段之前，见前面 pauseAfterDoneRef。）
      // id=379：开关的唯一写入口。
      //
      // 为什么要一个函数而不是直接用 setPauseAfterDone：
      //   1. 必须**同步**写 ref。React 的 setState 要等下一次渲染才生效，
      //      而派发 effect 里的定时器回调可能在同一个事件循环之后立刻跑 ——
      //      那时 state 还是旧值，读 state 会漏判。ref 是同步的，写进去立刻可见。
      //   2. 拨回「继续执行」时，要**立刻**把被拦下的那一条派出去（题面要求），
      //      不能等下一次 running 边沿 —— 那个边沿可能永远不会再来（已经空闲了）。
      // 两个方向都走这里，「谁改了它」永远只有一处。
      // 实现放在 dispatchNext 之后（见下方）—— 它要读 items / runningCount / sync /
      // dispatchNext，全都声明在组件更下面，写在这里会 TDZ。

      // 上一次列表数据的指纹，用来跳过「内容没变」的重渲染。
      const lastSignatureRef = React.useRef('')
      // 展开中的条目的正文 / 备注：列表只拿 lite 数据，展开时才按需取全文。
      const [detail, setDetail] = React.useState(null)
      // 可用模型目录 + 当前生效的选择（id=363）。挂载时立刻拉一次，
      // 所以「初始化完成」就等于「已经有一个可用模型」，不必先跑一条任务。
      const [modelState, setModelState] = React.useState({ providers: [], selection: null })
      // 「确实没有可用模型」（id=364）：只在 ensureModel 判定目录真的空时才置位。
      // 与「模型列表还没就绪」区分开 —— 后者会被等待 + 重试消化掉，不该弹任何东西。
      const [modelMissing, setModelMissing] = React.useState(false)
      // 「正在重新加载模型列表」：用户点引导按钮时的忙碌态，避免连点。
      const [modelLoading, setModelLoading] = React.useState(false)

      // 输入框草稿 / 展开项 / 自动刷新开关 / 草稿模式 / 深入模式 / 拆解模式，任何一项变化都落一次本地存储。
      React.useEffect(() => {
        try {
          window.localStorage.setItem(storeKey, JSON.stringify({ ...form, openId, auto, draftMode, deepMode, splitMode }))
        } catch {
          /* 隐私模式下写不进去就算了 */
        }
      }, [storeKey, form, openId, auto, draftMode, deepMode, splitMode])

      const run = React.useCallback(
        async (fn) => {
          setBusy(true)
          setState((prev) => ({ ...prev, error: '' }))
          try {
            const data = await fn()
            setState({ loading: false, error: '', data })
            return data
          } catch (error) {
            setState((prev) => ({ ...prev, loading: false, error: error instanceof Error ? error.message : String(error) }))
            return undefined
          } finally {
            setBusy(false)
          }
        },
        [],
      )

      // 静默重读：不置 busy、不动 loading，避免自动刷新时按钮闪烁/输入被打断。
      // 自动刷新走 lite 模式：备注正文不进轮询载荷（历史备注占整份 json 七成体积），
      // 展开某一条时再单独取正文。指纹相同则整个跳过 setState。
      const sync = React.useCallback(async () => {
        try {
          const data = await call('read', { ...payload, lite: true })
          const signature = dataSignature(data)
          if (signature === lastSignatureRef.current) return
          lastSignatureRef.current = signature
          setState((prev) => ({ ...prev, loading: false, data }))
        } catch {
          /* 自动刷新失败时保持旧数据，不弹错 */
        }
      }, [sessionId, cwd])

      // —— 转组「升华」动画 ——
      // 记住上一次渲染时每条计划挂在哪个分组，任何一条换了分组
      // （草稿 → 待执行 → 待审核 → 已审核，或者退回）就在新分组里播一遍浮起动画。
      // 用数据指纹做 useMemo 依赖：自动刷新拿回一模一样的数据时不会重播。
      const groupOfItem = (it) => {
        if (it.draft === true) return 'draft'
        if (it.execute === true) return it.review === true ? 'reviewed' : 'unreviewed'
        return 'todo'
      }
      const liveItems = state.data?.items ?? []
      const groupSig = liveItems.map((it) => `${it.id}:${groupOfItem(it)}`).join('|')
      const prevGroupsRef = React.useRef({ sig: '', map: new Map() })
      const moved = React.useMemo(() => {
        const prev = prevGroupsRef.current
        const ids = new Set()
        const groups = new Set()
        if (prev.sig !== '') {
          for (const it of liveItems) {
            const before = prev.map.get(it.id)
            const now = groupOfItem(it)
            if (before !== undefined && before !== now) {
              ids.add(it.id)
              groups.add(now)
            }
          }
        }
        return { ids, groups }
      }, [groupSig])
      const sublimeIds = moved.ids
      // 目标分组可能正折叠着，条目根本不在 DOM 里，动画等于没播。
      // 这些组的组头会亮一下，保证「审核通过」这类操作有明确反馈。
      const movedGroups = moved.groups
      const movedGroupKey = [...movedGroups].sort().join('|')
      const [arriveGroups, setArriveGroups] = React.useState(() => new Set())
      React.useEffect(() => {
        if (movedGroups.size === 0) return undefined
        setArriveGroups(new Set(movedGroups))
        const timer = window.setTimeout(() => setArriveGroups(new Set()), 980)
        return () => window.clearTimeout(timer)
      }, [movedGroupKey])
      React.useEffect(() => {
        const map = new Map()
        for (const it of liveItems) map.set(it.id, groupOfItem(it))
        prevGroupsRef.current = { sig: groupSig, map }
      }, [groupSig])

      // 「模型是不是真的在跑」——直接读 Client 的 sessions 服务里当前会话的 running。
      // 只看 plan.json 的 startedAt 不够：开工那一小段模型还没回写 startedAt，
      // 或者模型在思考 / 写代码时文件一直没变，按钮都会误判成「没在干活」。
      const [agentRunning, setAgentRunning] = React.useState(false)
      agentRunningRef.current = agentRunning === true
      React.useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId === '') {
          setAgentRunning(false)
          return undefined
        }
        const readRunning = () => {
          try {
            const list = ctx?.get?.('sessions')?.list
            if (list === undefined || typeof list.getSnapshot !== 'function') return false
            return list.getSnapshot()?.byId?.[sessionId]?.running === true
          } catch {
            return false
          }
        }
        setAgentRunning(readRunning())
        let off = null
        try {
          const list = ctx?.get?.('sessions')?.list
          if (list !== undefined && typeof list.subscribe === 'function') {
            off = list.subscribe(() => setAgentRunning(readRunning()))
          }
        } catch {
          off = null
        }
        return () => {
          try {
            if (typeof off === 'function') off()
          } catch {
            /* 退订失败忽略 */
          }
        }
      }, [sessionId])

      // —— 可用模型列表：初始化阶段就拉一次（id=363）——
      //
      // 原来这对数据只在「真发一次拆解请求」时才被问起，而宿主那边的
      // 路由来自 `session.requestHeader()` —— 会话一次请求都还没发过时它是 undefined，
      // 于是全新会话的第一次拆解必然报 no-route。用户唯一的绕法就是
      // 「先随便发条消息，再回来拆解」，这正是题面要拆掉的那条隐式依赖。
      //
      // 现在提到挂载阶段：面板一出现就拉目录，拿不到显式选择时立刻落一次默认，
      // 并把这笔写回状态。这样「初始化完成」就等于「模型可用」。
      //
      // 几个刻意的选择：
      // 1. **不挂进 `run()`**：那个是写型操作的忙碌壳子，会把整块面板置成 busy，
      //    第一屏就闪一下按钮禁用很难看。这里静默做，失败也不弹错 ——
      //    模型目录读不出来时，其余所有功能（增删改、审核、执行）都还能用。
      // 2. **只落一次默认**：判据是 `saved`（用户/上一轮显式存下的选择），
      //    不是 `selection`（那个永远有值）。拿 selection 判断的话，
      //    「自动选中的默认项」会被当成用户的选择，默认兜底就再也不触发了。
      // 3. **不覆盖用户已选的**：`saved` 只要在目录里就一个字都不改。
      // 4. 依赖只有 sessionId / cwd：会话切了就重新解析一遍，因为请求头是按会话来的。
      React.useEffect(() => {
        let alive = true
        void (async () => {
          let snapshot
          try {
            snapshot = await call('models', payload)
          } catch {
            return /* 目录读不出来：静默跳过，不打扰用户 */
          }
          if (!alive || snapshot === null || snapshot === undefined) return
          setModelState({ providers: Array.isArray(snapshot.providers) ? snapshot.providers : [], selection: snapshot.selection ?? null })
          // id=365：上次选的模型已经不在目录里了（下架 / 换 provider）。
          // 宿主那边已经把失效值按 null 处理，下面这段回写就是愈合动作本身。
          // 这里额外说一句，是因为「我明明选过，怎么变了」必须有解释 ——
          // 静默替换成默认模型会让人以为自己的选择被吞了。
          if (snapshot.stale === true) {
            const to = snapshot.selection === null ? null : snapshot.selection.model
            setNotice(to === null ? '上次选的模型已失效，当前没有可用模型' : `上次选的模型已失效，已改用 ${to}`, NOTICE_LONG_MS)
          }
          // 已经有显式选择（且在目录里）就什么都不做 —— 用户的决定优先。
          if (snapshot.saved !== null && snapshot.saved !== undefined) return
          const fallback = snapshot.selection ?? null
          if (fallback === null) return
          try {
            const written = await call('selectModel', { ...payload, provider: fallback.provider, model: fallback.model })
            if (alive) setModelState((prev) => ({ ...prev, selection: written?.selection ?? fallback }))
          } catch {
            /* 写不回也不影响这一次的可用性：selection 已经在手里了 */
          }
        })()
        return () => {
          alive = false
        }
      }, [sessionId, cwd])

      /**
       * 「重新加载模型列表」（id=364）。
       *
       * 只在「确实没有可用模型」的提示里出现。用户的处境通常是「刚配好 key / 刚连上
       * provider，面板还没刷新」—— 那时正确的动作不是让他重开页面，而是就地重试。
       *
       * 重试成功就顺手把默认落盘并收起提示；仍然失败则保留提示，让用户接着排查
       * （提示文案里已经写明「没配」还是「读不出来」两种情况）。
       */
      const reloadModels = React.useCallback(async () => {
        if (modelLoading) return
        setModelLoading(true)
        try {
          const snapshot = await call('models', payload)
          const picked = snapshot?.selection ?? null
          setModelState({ providers: Array.isArray(snapshot?.providers) ? snapshot.providers : [], selection: picked })
          if (picked === null) return
          setModelMissing(false)
          if (snapshot.saved === null || snapshot.saved === undefined) {
            try {
              await call('selectModel', { ...payload, provider: picked.provider, model: picked.model })
            } catch {
              /* 写不回不影响可用性 */
            }
          }
          setNotice(`已加载模型 ${picked.model}`, NOTICE_LONG_MS)
        } catch {
          setNotice('模型列表仍然读不出来，检查一下 provider 配置', NOTICE_LONG_MS)
        } finally {
          setModelLoading(false)
        }
      }, [modelLoading, sessionId, cwd])

      const items = state.data?.items ?? []

      // 状态兜底：模型已经开始干活，但还没把 startedAt 写进 plan.json 的那几秒，
      // 把「待执行」里排在最前面的那条先按「执行中」展示，避免「AI 在跑，列表全写待执行」。
      // 模型一旦回填 startedAt，这里会自动让位给真实状态。
      const impliedRunningId = (() => {
        if (agentRunning !== true) return null
        const first = items.find(
          (it) => it.execute !== true && it.draft !== true && it.failed !== true && (typeof it.startedAt !== 'string' || it.startedAt === ''),
        )
        return first === undefined ? null : first.id
      })()

      // 「正在执行几条」的唯一口径：和列表里那些显示成「执行中」标签的条目逐条对齐。
      // 之前这里只数「有 startedAt 的待执行」，而界面上还会把排在最前面的那条
      // 还没写 startedAt 的待执行也显示成「执行中」（impliedRunning），
      // 于是会话在跑、模型还没回填的那几秒，上方写 0 条、下面却有一条「执行中」。
      // 现在统一交给 statusOf，两边不可能再对不上。
      // id=233：statusOf 把 interrupted 排在 running 之前，所以被中断的条目不会再被数进来。
      const runningCount = items.filter((it) => statusOf(it, impliedRunningId === it.id).key === 'running').length

      // id=378：「完成后暂停」在进入空闲（无执行中任务）时复位为默认「继续执行」。
      //
      // 为什么复位方向是 false：
      //   pauseAfterDone 的语义是「这一轮跑完之后先别派下一条」，是一个**针对当前这一轮**
      //   的临时决定，不是长期偏好 —— 任务跑完、界面回到空闲，那次决定的对象已经不存在了。
      //   留着 true 的话，下次开工会在用户毫无察觉的情况下停在第一条之后，
      //   症状是「点了开始，只跑了一条就不动了」，而且极难联想到是上一次那个开关没复位。
      //   所以默认值（继续自动派发）才是安全落点：漏派可以点一下补上，
      //   而「以为会继续却停了」会让人以为程序坏了。
      //
      // 判据用 runningCount 与 agentRunning —— 与「正在执行 N 条」那句、
      // 组头 data-running、以及开关自身的显隐条件同一个口径，不另算一套。
      //
      // 只在「从有到无」的**边沿**动作，且要求这段空闲稳定持续满 PAUSE_RESET_IDLE_MS：
      //   1. 边沿 —— 空闲期间每次 sync 都会重算，若不加边沿判断，会在空闲时反复写 state；
      //   2. 宽限 —— 会话的 running 在**工具调用之间**会短暂变 false（id=341 就为此
      //      专门用 dispatchedRef 挡连派）。一看到空闲就复位，一条跑十几步工具的任务
      //      会在第二个工具调用处被悄悄清掉：用户明明开着「完成后暂停」，它半路自己关了。
      //      这正是本步最容易写错的地方 —— 判据「看起来」是同一个 runningCount，
      //      但「瞬时为空」与「真的空闲」是两件事。
      //      所以起一个定时器，到点前又忙起来就取消（cleanup 里 clear）。
      //
      // 首次观测（wasBusy === null）不动作：页面刚加载时本来就没人跑，
      // pauseAfterDone 还是初值 false，没有需要复位的东西。
      const pauseIdleRef = React.useRef(null)
      React.useEffect(() => {
        const busyNow = agentRunning === true || runningCount > 0
        const wasBusy = pauseIdleRef.current
        pauseIdleRef.current = busyNow
        // 首帧：只记下这一帧，不动作（没人跑，也不该复位任何东西）。
        if (wasBusy === null) return undefined
        // 还在忙：把上一轮的定时器清掉（返回 undefined 会让 React 走 cleanup）。
        if (busyNow === true) return undefined
        // 从忙到闲：等宽限到点。期间又忙起来的话，本次 effect 的 cleanup 会取消它。
        // id=379：复位也走 ref —— 否则 state 变 false、ref 还停在 true，
        // 下一条永远派不出去（闸门读的是 ref）。
        if (wasBusy !== true) return undefined
        const timer = window.setTimeout(() => {
          pauseAfterDoneRef.current = false
          setPauseAfterDone(false)
        }, PAUSE_RESET_IDLE_MS)
        return () => window.clearTimeout(timer)
      }, [agentRunning, runningCount])

      // 当前「写着 startedAt 但还没完成」的条目 id：中断时要落盘成「已中断」的就是它们。
      // 放在这里而不是 pauseWork 里头算，是因为暂停的收尾阶段列表可能已被 sync 换过一轮。
      const startedIds = items
        .filter(
          (it) =>
            it.execute !== true
            && it.draft !== true
            && it.failed !== true
            && it.interrupted !== true
            && typeof it.startedAt === 'string'
            && it.startedAt !== '',
        )
        .map((it) => it.id)

      // 是否有任务正在执行（id=233 收紧口径）：只看「会话真的在跑」与「刚点下按钮那几秒」。
      // 原来还或上了 runningCount（= 有条目写着 startedAt），而 startedAt 在中断后是**故意保留**的
      // （续做的依据），于是被中断的条目会把 working 永久钉在 true —— 上方按钮一直显示
      // 「干活中」、开始/暂停全禁用，那正是用户报的 bug。startedAt 是「这条被做过」的痕迹，
      // 不是「此刻在跑」的证据；后者只有会话 running 能回答。
      const working = agentRunning || starting

      /**
       * id=235：渲染层兜底 —— 「发送中 / 暂停中」只描述「这一次点击的请求还在飞」，
       * 是纯内存态。一旦会话真的跑起来了，发送标记必须立刻让位：
       * 否则回包晚一点、或者回包干脆丢了，顶栏会一直停在「发送中…」，
       * 而上方的「干活中」又被 starting 顶着，模型明明在干活、界面上却像卡住。
       */
      React.useEffect(() => {
        if (agentRunning !== true || starting !== true) return undefined
        startingRef.current = false
        setStarting(false)
        return undefined
      }, [agentRunning, starting])

      /**
       * id=235：回包丢失的兜底 —— 一次点击的回包等太久就当它丢了，把内存标记放掉。
       * 「干活中」「发送中…」「暂停中」全部由这些标记驱动，任何一个漏放，
       * 界面上就会留下一句永远不该再出现的文案（这正是 id=235 要根治的残留）。
       * 有回包时 finally 会先把它清掉，这里的定时器到点只是空转。
       */
      React.useEffect(() => {
        if (starting !== true) return undefined
        const timer = window.setTimeout(() => {
          startingRef.current = false
          setStarting(false)
        }, ACTION_STALL_MS)
        return () => window.clearTimeout(timer)
      }, [starting])
      React.useEffect(() => {
        if (pausing !== true) return undefined
        const timer = window.setTimeout(() => {
          pausingRef.current = false
          setPausing(false)
        }, ACTION_STALL_MS)
        return () => window.clearTimeout(timer)
      }, [pausing])

      /**
       * id=235：换会话 / 换项目（等价于「连接重建」）时，把全部内存态清零。
       * 这些标记都不落盘，本来就不该跨会话继承；不清的话切过去会看到上一个会话
       * 残留的「发送中…」「暂停中」「继续」，而那个会话的条目一条都不在屏幕上。
       */
      React.useEffect(() => {
        startingRef.current = false
        pausingRef.current = false
        pausedByUserRef.current = false
        // 换会话 = 重新观测，回到「未知」。两面 running 边沿都要清，否则会把上一个会话的
        // true→false 当成这个会话的「回答结束」。
        wasRunningRef.current = null
        wasDispatchRunningRef.current = null
        reconcilingRef.current = false
        dispatchedRef.current = false
        dispatchEpochRef.current += 1
        setStarting(false)
        setPausing(false)
        setPaused(false)
      }, [sessionId, cwd])

      // id=209：只要有 turn 真的跑起来了，「已挂起」就该自动失效 —— 用户可能在左侧
      // 对话里直接接着聊，而不是点「继续」。不清的话按钮会一直停在「继续」上。
      // 放在 effect 里是因为它必须跟着 working 的变化走，且要等暂停请求收尾后再判。
      React.useEffect(() => {
        if (working === true && pausingRef.current !== true) {
          setPaused(false)
          // id=234：turn 又跑起来了（用户在左侧直接接着聊也算），主动暂停的事实已经不成立，
          // 不清的话下一轮真断了会被这里误当成「用户自己停的」而跳过对账。
          pausedByUserRef.current = false
        }
      }, [working])

      // 开始 / 暂停 这颗合成按钮的可用性（id=208，id=354 合并）：
      // 只由「有没有待办 / 是否在跑 / 有没有挂起」三个既存事实推导，
      // 不另存一份状态，否则四个来源迟早对不上。
      const pendingCount = items.filter((it) => it.execute !== true && it.draft !== true).length
      // 「已挂起」= 主动暂停过，且此刻确实没在跑。pause 请求刚发出、turn 还没停下时仍算执行中。
      const pausedIdle = paused === true && working !== true
      const canStart = busy !== true && starting !== true && working !== true && pendingCount > 0
      const canPause = busy !== true && pausing !== true && working === true

      // 自动刷新：按「截止时间」驱动，倒计时只是展示。
      // 旧实现用「倒计时归零」来触发刷新，setInterval 抖动时 left 会停在 1 不归零，
      // 于是界面卡在 1s、实际不再刷新（执行中把间隔压到 1s 时尤其明显）。
      // 现在每次 tick 直接比较 Date.now() 与 deadline，到点就刷新，与倒计时显示解耦。
      //
      // 【维护须知（id=283：这个功能不许顺手删）】
      // 面板自己不产生计划状态 —— 模型用 `.plan/q.mjs` 改 plan.json，宿主把结果写盘，
      // 页签要看见就必须有人去读。谁在读：
      //   1. 这里：auto 打开时每 5 秒静默 `sync()` 一次，是**唯一**的周期性读盘；
      //   2. 切回前台 / 窗口聚焦 / pageshow / 会话由空闲翻成执行中各补一次（下方三个 effect），
      //      但都只补**一次**，不是周期。
      // 所以删掉这段 = 模型干完活面板不动，用户只能重开页签。要改只能改间隔或
      // 触发方式，不能用「看起来没人用」为理由整段移除。
      // id=357：顶栏那颗手点「刷新」的按钮已经移除 —— 上一版这里还写着「用户手点刷新」，
      // 现在手动刷新的唯一手段就是下面这个 auto 开关（关掉后靠 2 里的几个时机补读）。
      // 关闭 auto 时定时器清掉、倒计时显示 0 —— 那是用户显式选择不自动读盘。
      React.useEffect(() => {
        if (!auto || !visible) {
          if (!auto) setTick(0)
          return undefined
        }
        const interval = runningCount > 0 || agentRunning ? AUTO_INTERVAL_RUNNING : AUTO_INTERVAL
        const intervalMs = interval * 1000
        let deadline = Date.now() + intervalMs
        setTick(interval)
        const timer = setInterval(() => {
          const now = Date.now()
          if (now >= deadline) {
            // 刷新后从当前时刻重新计时，避免定时器漂移累积成「连着补刷」。
            deadline = now + intervalMs
            setTick(interval)
            void sync()
            return
          }
          setTick(Math.max(1, Math.ceil((deadline - now) / 1000)))
        }, AUTO_TICK_MS)
        return () => clearInterval(timer)
      }, [auto, visible, sync, runningCount, agentRunning])

      // 会话从「空闲」翻成「执行中」（或反过来）时立刻补一次读取：
      // 开工/收工这两个瞬间最需要马上反映到列表状态上，等下一个 5 秒太迟。
      React.useEffect(() => {
        if (!auto) return undefined
        void sync()
        return undefined
      }, [auto, sync, agentRunning])

      // 页签从后台切回前台时立刻补一次：不可见期间定时器是停的，回来后要马上同步。
      React.useEffect(() => {
        if (!auto) return undefined
        if (visible) void sync()
        return undefined
      }, [auto, visible, sync])

      // 标签页切回前台 / 窗口重新聚焦时立刻补一次：
      // 后台标签的定时器会被浏览器节流，仅靠 setInterval 会看起来「不动了」。
      React.useEffect(() => {
        if (!auto) return undefined
        const kick = () => {
          if (document.visibilityState === 'hidden') return
          void sync()
        }
        document.addEventListener('visibilitychange', kick)
        window.addEventListener('focus', kick)
        window.addEventListener('pageshow', kick)
        return () => {
          document.removeEventListener('visibilitychange', kick)
          window.removeEventListener('focus', kick)
          window.removeEventListener('pageshow', kick)
        }
      }, [auto, sync])

      React.useEffect(() => {
        let alive = true
        ;(async () => {
          const data = await run(() => call('read', payload))
          if (!alive) return
          if (data !== undefined && data.planExists !== true) setShowInit(true)
        })()
        return () => {
          alive = false
        }
      }, [sessionId, cwd])

      // 展开某一条时按需取它的正文与备注（列表只拿 lite 数据）。
      const fetchDetail = React.useCallback(async (id) => {
        try {
          const value = await call('detail', { ...payload, id })
          if (value !== null && typeof value === 'object' && value.id === id) setDetail(value)
          return value
        } catch {
          return null
        }
      }, [sessionId, cwd])

      // 切换展开项：真正的取全文交给下面的 effect（openId 变化即触发）。
      const toggleItem = (id) => {
        setOpenId(openId === id ? null : id)
      }

      // 展开中的那条如果被别处改动（模型回写备注、自己被编辑），要重新取全文。
      // 判据是 lite 列表里它的长度/耗时指纹，指纹没变就不重复下载备注。
      // 必须带上「原始提示词」的长度：全量 read 的投影里它没有 sourcePromptLen、只有
      // sourcePrompt 全文，只算 planLen/noteLen 会让「首次由全量数据换 lite 数据」时
      // stamp 不变 → detail 永远不发 → 展开区的原文一直停在「加载中…」（id=194 抓到）。
      const openStamp = (() => {
        if (openId === null) return ''
        const it = (state.data?.items ?? []).find((x) => x.id === openId)
        if (it === undefined) return ''
        const srcLen = Number(it.sourcePromptLen ?? 0) || (typeof it.sourcePrompt === 'string' ? it.sourcePrompt.length : 0)
        // id=273：父节点的正文恒为空，只看它自己的指纹就永远不变 —— 子任务做完、
        // 审核通过都不会触发重新取详情，展开区就停在旧数据上。children 的子指纹一并算进去。
        const kids = Array.isArray(it.children)
          ? it.children.map((c) => `${c.id}:${c.execute === true ? 1 : 0}${c.review === true ? 1 : 0}:${c.noteLen ?? 0}:${c.time ?? 0}`).join(',')
          : ''
        return `${it.id}:${it.planLen ?? 0}:${it.noteLen ?? 0}:${it.time ?? 0}:${srcLen}:${kids}`
      })()
      React.useEffect(() => {
        if (openId === null) {
          setDetail(null)
          return undefined
        }
        void fetchDetail(openId)
        return undefined
      }, [openId, openStamp, fetchDetail])

      const doInit = async () => {
        const data = await run(() => call('init', payload))
        if (data !== undefined) {
          setShowInit(false)
          setNotice('已创建 .plan/plan.json；执行技能已内置，无需同步')
        }
      }

      const append = async () => {
        if (form.plan.trim() === '') {
          setState((prev) => ({ ...prev, error: '计划内容不能为空' }))
          return
        }
        // 拆解模式：不落一条，交给宿主按项目实际情况拆成 N 条。
        // id=262 起不再「深入模式被短路」：两个开关可以同时点亮，
        // 深入会作用到每一次拆解（见 split()），拆出来的每条子任务都按「做深」的要求写。
        if (splitMode) {
          await split()
          return
        }
        // 最终提示词统一由 composePrompt 拼（id=262）：草稿存原文、仅回答前缀独占一行、
        // 深入模式先包模板再叠前缀，且自带幂等与 CRLF 归一。以前这段在 append 里手拼，
        // split() 那边另有一套，两处规则迟早走散。
        const text = composePrompt({
          text: form.plan,
          taskType: form.taskType,
          deep: deepMode,
          draft: draftMode,
        })
        const data = await run(() =>
          // mode 由宿主按 taskType 推（客户端没有模式下拉，form.mode 恒为空串）；
          // 显式传 taskType 就够了，这里保留 mode 字段是为了将来加真下拉时不必改协议。
          call('append', { ...payload, plan: text, mode: form.mode, taskType: form.taskType, draft: draftMode }),
        )
        if (data !== undefined) {
          // 提交后停留在当前视图：只清空输入框并就地给一条提示，
          // 不展开新计划、不滚动列表、不切换选中项（否则会“跳走”）。
          setForm({ plan: '', mode: form.mode, taskType: form.taskType, expanded: false })
          // 提交后自动展开落点那一栏（草稿 or 待执行），让刚写进去的计划立刻可见。
          setOpenGroup(draftMode ? 'draft' : 'todo')
          // 提交即刷新，并把倒计时拨回起点。
          await sync()
          setTick(AUTO_INTERVAL)
          // 提交后不再自动开工：开工由用户在「待执行」下方的「开始干活」按钮手动触发。
          setNotice(
            draftMode
              ? `已存入草稿 #${data.item?.id ?? '?'}`
              : deepMode
                ? `已追加计划 #${data.item?.id ?? '?'}（深入模式，已改写提示词）`
                : `已追加计划 #${data.item?.id ?? '?'}`,
          )
        }
      }

      /**
       * 确保「现在能用某个模型」（id=364）。
       *
       * 拆解是唯一真调模型的入口，所以这道校验只挂在这里。它要解决的是三件事，
       * 而原来的实现（如果 `modelState.selection` 为空就直接拦）三件都做错：
       *
       * 1. **空值 ≠ 没配模型**。`modelState.selection` 只是「上一轮拉到的结果」，
       *    首次挂载的那一小段时间它必然是 null（请求还在飞）。直接拦会造成
       *    「第一次点拆解被拦、等两秒再点就好了」的时序坑。所以先**等**一次，
       *    再**重试**一次目录请求（`call('models')`），而不是拿一个还没就绪的
       *    本地快照当结论。
       * 2. **拿得到就不该拦**。按 已有选择 > 默认模型 > 列表首个 的优先级挑一个
       *    （宿主侧 `model-route.js` 的解析链已经就是这个顺序，这里只是消费它），
       *    挑到了就继续拆，不再弹「没有选择模型」。
       * 3. **真的一个都没有才提示，并且给可点的出路**。目录为空 / 全部 provider 都
       *    探测失败时，提示里要说清是「没配」还是「读不出来」，并给一个「重新加载
       *    模型列表」的按钮 —— 只告诉用户「不行」而没有下一步，是这个提示最糟的形态。
       *
       * @returns {Promise<{provider:string, model:string}|null>} 可用路由；null 表示确实没有
       */
      const ensureModel = React.useCallback(async () => {
        // 先看手里这份快照：初始化 effect 已经拉过一次，命中就不用再问。
        if (modelState.selection !== null && modelState.selection !== undefined) return modelState.selection
        // 快照是空的：可能是「还没就绪」，也可能是「真的没有」。
        // 给初始化那一次请求一点时间落地（它和本函数几乎同时发出），再自己问一次 ——
        // 这就是题面说的「等待或重试一次」。
        for (let attempt = 0; attempt < MODEL_READY_ATTEMPTS; attempt += 1) {
          if (attempt > 0) await new Promise((resolve) => window.setTimeout(resolve, MODEL_READY_GAP_MS))
          let snapshot
          try {
            snapshot = await call('models', payload)
          } catch {
            continue // 这一次读失败：还有下一次
          }
          const picked = snapshot?.selection ?? null
          if (picked !== null) {
            // 顺手把这个结果记进状态：后面的气泡提示与按钮文案都读它。
            setModelState({ providers: Array.isArray(snapshot.providers) ? snapshot.providers : [], selection: picked })
            // 首次拿到默认值时也落一次盘，下次打开直接命中（和初始化 effect 同一套判据）。
            if (snapshot.saved === null || snapshot.saved === undefined) {
              try {
                await call('selectModel', { ...payload, provider: picked.provider, model: picked.model })
              } catch {
                /* 写不回不影响这一次能不能拆 */
              }
            }
            return picked
          }
          // 目录读到了但是没有可用项：不用再重试，重试也不会变出模型来。
          if (Array.isArray(snapshot?.providers)) {
            setModelState({ providers: snapshot.providers, selection: null })
            return null
          }
        }
        return null
      }, [modelState.selection, sessionId, cwd])

      /**
       * 拆解模式提交：交给宿主收集项目快照 → 一次 LLM → 写成 N 条。
       * 落在哪一组看右侧「草稿」开关：点亮 → 草稿组；没点亮 → 直接进待执行。
       * 宿主会做幂等（同一句话重复提交不会产生重复条目）与原子写。
       */
      const split = async () => {
        if (splitting) return
        const text = form.plan.trim()
        if (text === '') {
          setState((prev) => ({ ...prev, error: '要拆解的内容不能为空' }))
          return
        }
        // 入口校验（id=364）：先确保有模型可用，再动手。
        // 注意顺序 —— 放在 `setSplitting(true)` **之前**：模型都还没定就不要先挂遮罩，
        // 否则「确实没有模型」时用户会先看到一个转圈、再看到一个失败，白等一场。
        const route = await ensureModel()
        if (route === null) {
          // 走到这里说明目录是真的空（或者全部 provider 都探测失败）。
          // 提示带上「重新加载」按钮 —— 有出路比说清楚更重要。
          setModelMissing(true)
          return
        }
        setModelMissing(false)
        // 拆解落点跟着「草稿」开关走，整段只取一次快照，避免异步期间开关被改。
        const toDraft = draftMode === true
        setSplitting(true)
        setState((prev) => ({ ...prev, error: '' }))
        setNotice(`正在按项目情况拆解…（模型 ${route.model}）`)
        try {
          const data = await call(
            'decompose',
            {
              ...payload,
              question: text,
              mode: form.mode,
              taskType: form.taskType,
              draft: toDraft,
              // id=262：深入开关以前在拆解分支里被完全丢掉，用户在面板上点亮了「深入」
              // 却看不出任何差别。现在把意图明确传给宿主，由拆解提示词要求每条子任务
              // 都按「做深而不是做大」来写。
              deep: deepMode === true,
            },
            // 拆解要跑一次模型，给足 3 分钟；超时也一定会抛出来 → finally 里摘掉遮罩。
            { timeoutMs: 180000 },
          )
          // 模型一回来就摘遮罩：后面的 sync() 还要等一轮读盘，不该让用户继续看着遮罩。
          setSplitting(false)
          if (data?.duplicate === true) {
            setNotice('这份需求已经拆解过了，没有重复产生条目')
          } else {
            const count = Array.isArray(data?.created) ? data.created.length : 0
            const cut = Array.isArray(data?.cut) ? data.cut : []
            const missing = Array.isArray(data?.missingPaths) ? data.missingPaths : []
            const tips = []
            if (cut.length > 0) tips.push(`建议砍掉：${cut.join('；')}`)
            if (missing.length > 0) tips.push(`模型提到了不存在的文件：${missing.join('、')}`)
            const where = toDraft ? '草稿' : '待执行'
            // id=223：这条会带「建议砍掉 / 模型提到了不存在的文件」等附加信息，实测能到 79 字，
            // 默认 3.8 秒读不完，单独给更长时长。上面的「已拆解过了」是短答复，仍走默认。
            // id=262：深入模式下补一句，否则用户看不出这个开关到底做了什么。
            setNotice(
              `已拆解 ${count} 条到${where}${deepMode ? '（深入）' : ''}${tips.length > 0 ? ` · ${tips.join(' · ')}` : ''}`,
              NOTICE_LONG_MS,
            )
          }
          setForm({ plan: '', mode: form.mode, taskType: form.taskType, expanded: false })
          setOpenGroup(toDraft ? 'draft' : 'todo')
          await sync()
          setTick(AUTO_INTERVAL)
        } catch (error) {
          setState((prev) => ({
            ...prev,
            error: `拆解失败：${error instanceof Error ? error.message : String(error)}`,
          }))
        } finally {
          setSplitting(false)
        }
      }

      /**
       * 把「正在跑但被打断了」的条目落盘成「已中断」（id=233）。
       *
       * 为什么必须写盘：`startedAt` 是「继续 = 续做而不是重跑」的唯一依据，所以中断时**不能**清空它；
       * 而 `statusOf` 原来只要有 `startedAt` 就判「执行中」，于是被中断的条目会永久显示
       * 「执行中」、上方按钮永久显示「干活中」。新增的 `interrupted` 标记就是为了在这种
       * 「startedAt 还在、但 turn 已经停了」的状态下给出正确标签 —— 它必须持久化，
       * 因为「已挂起」原本是纯内存态（`paused`），刷新页面就丢，刷新后又变回「执行中」。
       *
       * 只挑「有 startedAt 且未完成、未中断」的条目：还没写 startedAt 的那条（`impliedRunningId`）
       * 不标中断 —— 它本来就没有开工痕迹，标了反而会在真正开跑时一直挂着「已中断」。
       */
      const markInterrupted = async (ids, value = true) => {
        const list = [...new Set(ids)]
        if (list.length === 0) return 0
        let done = 0
        for (const id of list) {
          try {
            await call('update', { ...payload, id, patch: { interrupted: value } })
            done += 1
          } catch {
            // 单条写失败不牵连同批其他条目：这一条下次中断/刷新时还会被再判一次。
          }
        }
        // 乐观更新：把标记先落进本地列表，界面立刻从「执行中」跳到「已中断」，
        // 不必等下一轮 sync（自动刷新最快也要 3~5 秒）。
        if (done > 0) {
          setState((prev) => {
            if (prev.data === null) return prev
            return {
              ...prev,
              data: {
                ...prev.data,
                items: (prev.data.items ?? []).map((it) => (list.includes(it.id) ? { ...it, interrupted: value } : it)),
              },
            }
          })
        }
        return done
      }

      /** 手动开工：把队首任务的派发正文发进当前会话，和一轮结束后的自动派发是同一段话。
       * 这样模型不用先读技能、再跑 status 才知道做什么。
       * id=209 起兼任「继续」：队首若已派过还没 done，force 会把同一条再发一遍（带上次做到）。 */
      const startWork = async () => {
        // 按钮 disabled 只是第一层：这里再挡一次，避免「执行中连点」重复灌提示词。
        // working 为 false 但 paused 为 true 时放行 —— 那正是「继续」的入口。
        if (startingRef.current || starting || working) return
        const resume = paused === true
        startingRef.current = true
        setStarting(true)
        // 续做前先记下要摘掉「已中断」标记的那一条：`startedAt` 还在，摘掉标记后
        // 它会自动回到「执行中」—— 用户点的是「继续」，界面就该显示在跑。
        // 只摘**数组里最靠前**的那一条：技能规定多条带 startedAt 时只续做最靠前的那条，
        // 全部摘掉会让后面那些明明没在跑的条目也显示成「执行中」。
        const resumeOne = (items ?? []).find(
          (it) => it.interrupted === true && it.execute !== true && it.draft !== true,
        )
        const resumeIds = resumeOne === undefined ? [] : [resumeOne.id]
        setPaused(false)
        try {
          const preview = await call('dispatch', { ...payload, dryRun: true, force: true })
          if (preview === null || typeof preview !== 'object' || preview.dispatched !== true) {
            if (resume) setPaused(true)
            setNotice(preview?.reason === 'empty' ? '没有可执行的待办' : '没有可派发的任务', NOTICE_LONG_MS)
            return
          }
          const text = typeof preview.text === 'string' ? preview.text : ''
          let sent = false
          try {
            sent = await kickoffViaClient(ctx, sessionId, text)
          } catch (error) {
            sent = false
            if (error instanceof Error && error.message !== '') throw error
          }
          // 浏览器发出去之后只记账（ack），避免宿主再 prompt 一次变成两条用户消息。
          if (sent) await call('dispatch', { ...payload, force: true, ack: true })
          else await call('dispatch', { ...payload, force: true })
          setNotice(`${resume ? '继续' : '已派发'}：${preview.taskId}`, NOTICE_LONG_MS)
          // id=234：新一轮开跑了，主动暂停的标记要撤掉，否则下一轮中断不会被对账处理。
          pausedByUserRef.current = false
          // 发送成功了才摘标记：发不出去还留在「已中断」是对的，不能被这次点击洗掉。
          if (resumeIds.length > 0) await markInterrupted(resumeIds, false)
        } catch (error) {
          // 发送失败要把「已挂起」还回去，否则界面会显示「继续」但其实什么都没发出去。
          if (resume) setPaused(true)
          setState((prev) => ({
            ...prev,
            error: `派发失败：${error instanceof Error ? error.message : String(error)}`,
          }))
        } finally {
          startingRef.current = false
          setStarting(false)
        }
      }

      /**
       * 挂起当前执行（id=208）。
       *
       * 只中止当前 turn，plan.json 里已写进去的 startedAt / note / execute
       * 一个字段都不动，所以再点「开始」能接着做而不是从头来。
       * 优先走浏览器侧的 `session.cancel()`；那条路不可用（没有绑定、旧版本）才回落到宿主 cancel 路由。
       *
       * id=233：收尾阶段必须把「正写着 startedAt 的那几条」落盘成 `interrupted: true`。
       * 只设内存里的 `paused` 不够 —— 刷新页面就丢，条目又变回「执行中」，那正是用户报的病。
       */
      const pauseWork = async () => {
        // 与 canPause 对齐：忙、正在发暂停、或此刻根本没在跑，都不发第二个 cancel。
        if (pausingRef.current || pausing || starting || working !== true) return
        pausingRef.current = true
        setPausing(true)
        // 先拍一张快照：cancel 成功后列表可能已经被 sync 换过一轮，那时再算就晚了。
        const interruptedIds = startedIds
        // 中止是否真的被受理：只有受理了才把条目判成「已中断」。
        // 两条路都失败时 turn 还在跑，条目继续显示「执行中」才是对的。
        let accepted = false
        try {
          let stopped = false
          try {
            stopped = await stopViaClient(ctx, sessionId)
          } catch (error) {
            stopped = false
            if (error instanceof Error && error.message !== '') throw error
          }
          if (!stopped) await call('cancel', payload)
          accepted = true
          // id=234：这一轮是用户主动停的，别再让「模型响应中断」的对账去覆盖提示文案。
          pausedByUserRef.current = true
          setPaused(true)
          setNotice('已挂起当前执行，进度已保留')
        } catch (error) {
          setState((prev) => ({
            ...prev,
            error: `暂停失败：${error instanceof Error ? error.message : String(error)}`,
          }))
        } finally {
          // 放在 finally 里：无论走哪条路径、是否已经抛错，只要中止确实被受理，
          // 「执行中」这个显示就已经是错的，必须对齐成「已中断」。
          // 写盘失败只影响单条，markInterrupted 内部已经吞掉逐条异常。
          if (accepted) await markInterrupted(interruptedIds)
          pausingRef.current = false
          setPausing(false)
        }
      }

      /**
       * id=234：模型响应中断（断流 / 超时 / 请求报错）时的状态同步。
       *
       * 这类中断拿不到任何「原因」：客户端能观测到的唯一信号就是会话 running 从 true 翻成 false
       * —— 客户端和宿主都没有 turn 结束事件的订阅（id=231 已核实 `ctx.on(` 全库零命中）。
       * 所以这里做的是**翻下去之后的对账**：等 INTERRUPT_SETTLE_MS 让收尾写盘落定，再回读一次
       * plan.json；如果还有条目「写着 startedAt 却没完成」，说明这一轮没走到回填 execute 就被掐断了。
       *
       * 为什么不会误伤正常收工：模型收工前一定先写 execute=true，那时这些条目已经不在
       * 「未完成 + 有 startedAt」的集合里，对账结果是空的，什么都不会写。
       * 为什么以磁盘为准而不是内存 items：中断这段时间自动刷新可能一次都没成功过，
       * 内存里的列表可能还停在开工前。
       * 为什么跳过主动暂停：pauseWork 已经写过一遍 interrupted，再写一次只会在界面上
       * 用「执行已中断」盖掉「已挂起当前执行」这句更准确的提示。
       */
      React.useEffect(() => {
        const was = wasRunningRef.current
        wasRunningRef.current = agentRunning === true
        // id=352-E：两处放宽。
        //   1. 首次观测（was === null）也做一次对账 —— 页面刷新后就是这个时机，
        //      不然刷新一次孤儿就再也救不回来（旧逻辑要求 was === true）。
        //   2. 真正的中断跳变（was === true → 现在 false）照旧。
        // 正在跑的时候当然不做（agentRunning === true 直接退出）。
        const firstLook = was === null
        if (agentRunning === true) return undefined
        if (firstLook !== true && was !== true) return undefined
        if (pausedByUserRef.current === true || reconcilingRef.current === true) return undefined
        reconcilingRef.current = true
        let cancelled = false
        const timer = setTimeout(() => {
          void (async () => {
            try {
              const data = await call('read', { ...payload, lite: true })
              if (cancelled || data === null || typeof data !== 'object') return
              // id=352-E：加 2 分钟宽限。刚被派出去的那条此刻正好「有 startedAt、没产出」，
              // 立刻判成中断会把正常在跑的任务打成孤儿 —— 首次观测（刷新页面）时尤其容易。
              // 真孤儿在宿主侧 30 分钟就被 read 回收了，这里 2 分钟只是兜住「宿主那份没跑到」。
              const cutoff = Date.now() - ORPHAN_CLIENT_GRACE_MS
              const losers = (data.items ?? []).filter(
                (it) =>
                  it.execute !== true
                  && it.draft !== true
                  && it.interrupted !== true
                  && typeof it.startedAt === 'string'
                  && it.startedAt !== ''
                  && Number.isFinite(Date.parse(it.startedAt))
                  && Date.parse(it.startedAt) < cutoff,
              )
              if (losers.length === 0) return
              const done = await markInterrupted(losers.map((it) => it.id))
              // 首次观测（刷新页面）时静默修复：它不是「刚刚中断」，弹提示只会让用户困惑。
              if (done > 0 && firstLook !== true) setNotice(`执行已中断（${done} 条）`, NOTICE_LONG_MS)
            } catch {
              // 对账失败不弹错：下一次 running 翻下去还会再来一次，别用噪音打搅用户。
            } finally {
              if (!cancelled) reconcilingRef.current = false
            }
          })()
        }, INTERRUPT_SETTLE_MS)
        return () => {
          cancelled = true
          window.clearTimeout(timer)
          reconcilingRef.current = false
        }
      }, [agentRunning, sessionId, cwd])

      /**
       * id=341：一个 turn 结束（running: true → false）就派发下一条任务。
       *
       * 这就是需求里的「先回答、再触发下一任务」：模型的回答已经写完了（turn 结束），
       * 我们才把下一条作为新的用户消息发进去。谁来做下一条由宿主算（queue-cli 的 nextTask），
       * 不再让模型自己扫待办 —— 技能正文里那条「做完立刻 start 下一条」已经删掉。
       *
       * 边沿必须用 wasDispatchRunningRef，不能读 wasRunningRef。对账 effect 写在前面，
       * 同一次提交里会先把那面旗子写成 false，派发再读就永远看不到 true→false，
       * 表现就是「这条做完了，下一条再不发」。
       *
       * 几种不该派的情况：
       * - 用户主动暂停（pausedByUserRef）：他要的就是停下来看看；
       * - 会话又跑起来了（工具空档、或用户接着聊）：这不是一轮的结束；
       * - 这一轮已经派过（dispatchedRef）：running 会抖，别连派；
       * - 队首已派发但还没 done（reason inflight）：不跳到后面的条目，短重试等回填；
       * - 队列空了：dispatch 自己会返回 empty。
       *
       * 对账进行中不能直接 return。那样边沿被消费掉，对账结束（只改 ref）不会再进这个 effect。
       * 定时器里等到 reconcilingRef 落下再发。
       *
       * 失败只记一条提示，不弹错误弹窗：派发失败最多是「停在原地」，用户再点一次开始即可，
       * 不该盖掉屏幕上更重要的内容。
       */
      /**
       * id=379：派发下一条的**唯一实现**。原来是内联在 effect 定时器里的匿名 async，
       * 现在抽出来，因为「拨回继续执行时立即恢复派发」需要走同一条路径 ——
       * 复制一份出来的话，两处会各自演化（一边补了 inflight 重试、一边忘了），
       * 而它们做的事完全一样：让宿主算下一条、发进会话、把结果说给用户听。
       *
       * 入参只有一句用于提示的前缀，其余全部读当前闭包 / ref 的最新值。
       * 传 ref 而不是值：这个函数可能在 setTimeout 里跑，captured 的旧值会漏判。
       */
      const dispatchNext = React.useCallback(
        async (lead, epoch) => {
          // 换会话、用户暂停、或会话又跑起来：这次空档不算「回答结束」。
          // id=379：**加上「完成后暂停」闸门** —— 这是本步的核心。
          // 用 ref 读，不用 state：这里跑在 setTimeout 回调里，
          // 闭包里的 state 可能已经是几秒前的旧值（用户中途拨了开关）。
          const still = () =>
            (epoch === undefined || dispatchEpochRef.current === epoch)
            && pausedByUserRef.current !== true
            && agentRunningRef.current !== true
            && pauseAfterDoneRef.current !== true
          const deadline = Date.now() + DISPATCH_SETTLE_MS
          while (reconcilingRef.current === true && Date.now() < deadline) {
            if (!still()) return
            await new Promise((resolve) => window.setTimeout(resolve, 100))
          }
          if (!still()) {
            // 被「完成后暂停」拦下时要说一句，否则用户只看到任务停了、没有任何解释。
            // 其他情况（换会话 / 暂停 / 又跑起来）本来就有各自的提示或天然可见的状态，不重复。
            if (pauseAfterDoneRef.current === true) {
              setNotice('已完成，按「完成后暂停」停在空闲；拨回「继续执行」可继续派发', NOTICE_LONG_MS)
            }
            return
          }
          if (dispatchedRef.current === true) return
          dispatchedRef.current = true
          try {
            let data = null
            for (let attempt = 0; attempt <= DISPATCH_INFLIGHT_RETRIES; attempt += 1) {
              if (!still()) {
                dispatchedRef.current = false
                return
              }
              data = await call('dispatch', { ...payload })
              if (epoch !== undefined && dispatchEpochRef.current !== epoch) {
                dispatchedRef.current = false
                return
              }
              if (data === null || typeof data !== 'object') {
                dispatchedRef.current = false
                return
              }
              if (data.reason !== 'inflight') break
              if (attempt === DISPATCH_INFLIGHT_RETRIES) break
              await new Promise((resolve) => window.setTimeout(resolve, DISPATCH_INFLIGHT_GAP_MS))
            }
            if (data === null || typeof data !== 'object') {
              dispatchedRef.current = false
              return
            }
            if (data.dispatched !== true) {
              // 没发出去就要允许下一次 true→false 再派。卡在 true 上，队列会一直停。
              dispatchedRef.current = false
              if (data.reason === 'empty') {
                // id=343：正常收工。把这一轮留下的运行态一起收掉，否则顶栏会停在
                // 「干活中 / 继续」上，而队列其实已经空了 —— 用户只能靠刷新页面摆脱它。
                setPaused(false)
                pausedByUserRef.current = false
                setNotice(data.finished === true ? '待办已清空，本轮执行结束' : '本轮执行结束', NOTICE_LONG_MS)
                void sync()
              } else if (data.reason === 'inflight') {
                const id = data.taskId === null || data.taskId === undefined ? '' : String(data.taskId)
                setNotice(
                  id !== '' ? `上一条 ${id} 还没回填完成，暂不派发下一条` : '上一条还没回填完成，暂不派发下一条',
                  NOTICE_LONG_MS,
                )
                void sync()
              }
              return
            }
            // 用长提示：成功派发是这条链还在走的唯一可见信号，短提示容易被下一帧盖掉。
            setNotice(
              lead !== undefined && lead !== ''
                ? `${lead}：${data.taskId}`
                : data.redelivered === true ? `重新派发：${data.taskId}` : `已派发下一条：${data.taskId}`,
              NOTICE_LONG_MS,
            )
            // 派出去之后立刻读一次，让新条目的「执行中」状态尽快出现。
            void sync()
          } catch (error) {
            dispatchedRef.current = false
            setNotice(`派发下一条失败：${error instanceof Error ? error.message : String(error)}`, NOTICE_LONG_MS)
          }
        },
        // payload / sync / setPaused 都是每次渲染重建的稳定闭包（或 state setter），
        // 不列全也不会读到过期的关键量：判定全部走 ref。
        [payload, sync],
      )

      React.useEffect(() => {
        const was = wasDispatchRunningRef.current
        wasDispatchRunningRef.current = agentRunning === true
        if (agentRunning === true) {
          // 新一轮开跑：允许它结束后再派一次。
          dispatchedRef.current = false
          return undefined
        }
        if (was !== true) return undefined
        if (pausedByUserRef.current === true) return undefined
        const epoch = dispatchEpochRef.current
        let started = false
        const timer = window.setTimeout(() => {
          started = true
          void dispatchNext(undefined, epoch)
        }, DISPATCH_SETTLE_MS)
        return () => {
          // 请求已经发出就别清：prompt 会把 running 拉回 true，cleanup 若把结果扔掉，
          // 下一条其实发出去了，面板却没有任何「已派发」提示。
          if (!started) window.clearTimeout(timer)
        }
      }, [agentRunning, sessionId, cwd, dispatchNext])

      /**
       * id=379：「完成后暂停」开关的唯一写入口。放在 dispatchNext 之后定义 ——
       * 它要读 items / runningCount / sync / dispatchNext，全都声明在组件更上面或这一段之前。
       *
       * 为什么不直接用 setPauseAfterDone：
       *   1. 必须**同步**写 ref。setState 要等下一次渲染，而派发那边的定时器回调
       *      可能在同一个事件循环之后立刻跑 —— 那时 state 还是旧值，读 state 会漏判。
       *   2. 拨回「继续执行」时，要**立刻**把被拦下的那一条派出去（题面要求），
       *      不能等下一次 running 边沿 —— 那个边沿可能永远不会再来（已经空闲了）。
       */
      const togglePauseAfterDone = () => {
        const next = pauseAfterDone !== true
        pauseAfterDoneRef.current = next
        setPauseAfterDone(next)
        if (next === true) {
          // 拨到「暂停」：不中断当前任务，只是这一轮结束后不派下一条。
          setNotice('当前任务完成后将暂停，不再自动派发下一条', NOTICE_LONG_MS)
          return
        }
        // 拨回「继续执行」。题面条件：仍有待执行任务 + 当前无执行中任务 → 立即恢复派发。
        //
        // 「无执行中」用与别处同一套判据（agentRunning / starting / runningCount）。
        // 有任务在跑时**不动作**：它跑完后那个 running 边沿会自然派下一条，
        // 现在多发一次反而会插队。
        const idleNow = agentRunning !== true && starting !== true && runningCount === 0
        if (idleNow !== true) return
        // 「还有待执行」的判据必须与分组口径一致（todoList 那段），否则会出现
        // 「组里看得见一条，拨开关却说没活可派」。
        // 注意这里**不能**用渲染闭包里的 batchOf（它定义在下方 JSX 里，此处不可见），
        // 所以就地按同一个口径重算：批次看「是不是全做完了」，单条看 execute。
        // 两处口径一旦分叉，症状是「拨回继续执行但什么都没发生」——
        // 而 toggle 这边恰恰是唯一会被用户当成「开关坏了」的地方，宁可写得直白些。
        const hasTodo = items.some((it) => {
          if (it.draft === true) return false
          const kids = Array.isArray(it.children) ? it.children : []
          if (kids.length > 0) return kids.every((c) => c.execute === true) !== true
          return it.execute !== true
        })
        if (hasTodo !== true) return
        // 放开闸门，让 dispatchNext 的 `dispatchedRef === true` 早退不再拦住这一次。
        // 不自己拼 dispatch 请求：那条链路上的 inflight 重试、empty 收工、
        // 游标推进全在 dispatchNext 里，绕开它就是第二套实现。
        dispatchedRef.current = false
        // 等一个派发空档再发：与 running 边沿那条同速，避免刚拨开关就抢在
        // 状态落定之前把请求打出去。
        window.setTimeout(() => {
          void dispatchNext('用户已恢复自动派发')
        }, DISPATCH_SETTLE_MS)
      }

      /** 拖拽落位：只在「待执行」组内调整先后，随后整表重排并落盘。 */
      // 提交一整份「待执行组」的 id 顺序：Host 只认整表顺序，
      // 所以把待执行 → 待审核 → 已审核三段的 id 拼起来发过去，
      // order 重编号后各分组不会错位。界面先乐观更新，失败再回读。
      const commitOrder = async (order) => {
        const all = state.data?.items ?? []
        const ids = [
          ...order,
          ...all.filter((it) => it.draft === true).map((it) => it.id),
          ...all.filter((it) => it.execute === true && it.review !== true).map((it) => it.id),
          ...all.filter((it) => it.execute === true && it.review === true).map((it) => it.id),
        ]
        // 乐观更新，界面立刻跟手。
        setState((prev) => {
          if (prev.data === null) return prev
          const map = new Map((prev.data.items ?? []).map((it) => [it.id, it]))
          return { ...prev, data: { ...prev.data, items: ids.map((id) => map.get(id)).filter(Boolean) } }
        })
        try {
          await call('reorder', { ...payload, ids })
          setNotice('顺序已保存')
        } catch (error) {
          setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }))
          void sync()
        }
      }

      const moveTo = async (from, to) => {
        if (from === null || to === null || from === to) return
        const todo = (state.data?.items ?? []).filter((it) => it.execute !== true && it.draft !== true)
        const order = todo.map((it) => it.id)
        const fromIndex = order.indexOf(from)
        const toIndex = order.indexOf(to)
        if (fromIndex < 0 || toIndex < 0) return
        order.splice(fromIndex, 1)
        order.splice(toIndex, 0, from)
        await commitOrder(order)
      }

      // 置顶：把这一条挪到「执行中」那条的正下方，即待执行组的第一位。
      // 正在执行的那条永远留在最上面（它是当前正在跑的，不能被打断）。
      const pinTop = async (id) => {
        const todo = (state.data?.items ?? []).filter((it) => it.execute !== true && it.draft !== true)
        // id=244：拦截放在这里，而不是只靠按钮消失。
        // 置顶的唯一入口虽然是 `50-item.js` 的按钮，但按钮消失只是「看不见入口」，
        // 不是「没有入口」——卡片外层、以后可能加的右键菜单、键盘快捷键，
        // 任何能拿到 id 的路径最终都汇到这一个函数。判在这里才算真的禁掉。
        // 同时它是写 order 的唯一出口（下一站 commitOrder → 宿主 reorder），
        // 提前 return 就不会动排序权重，也不会发出任何请求。
        if (todo.some((it) => it.id === id && (it.decomposeKey ?? '') !== '')) return
        const order = todo.map((it) => it.id)
        const fromIndex = order.indexOf(id)
        if (fromIndex < 0) return
        order.splice(fromIndex, 1)
        const runningIndex = order.findIndex((x) => {
          const it = todo.find((t) => t.id === x)
          return it !== undefined && statusOf(it, impliedRunningId === it.id).key === 'running'
        })
        order.splice(runningIndex >= 0 ? runningIndex + 1 : 0, 0, id)
        await commitOrder(order)
      }

      // 草稿 ⇄ 待执行 的互转：draft 只是条目上的一个布尔标记，
      // 转换 = 改这个标记，再把这一条挪到目标组末尾（保持组内相对顺序稳定）。
      // 转成待执行时顺手清掉 startedAt / time，避免带着草稿时期的残留状态进队列。
      const moveToGroup = async (ids, draft) => {
        const list = [...new Set(ids)]
        if (list.length === 0) {
          setNotice(draft ? '先把要转草稿的项勾上' : '先把要转待执行的草稿勾上')
          return
        }
        setBusy(true)
        setState((prev) => ({ ...prev, error: '' }))
        try {
          for (const id of list) {
            // id=233：转组时顺手摘掉「已中断」标记 —— 换组意味着用户重新安排了这条，
            // 再挂着上一次中断的标记会误导（尤其转回待执行时，会一进门就显示「已中断」）。
            await call('update', {
              ...payload,
              id,
              patch: draft ? { draft: true, interrupted: false } : { draft: false, clearTime: true, interrupted: false },
            })
          }
          // 乐观地把标记先改进本地数据，让条目立刻跳组，避免等 sync 的那一下闪烁。
          setState((prev) => {
            if (prev.data === null) return prev
            const next = (prev.data.items ?? []).map((it) =>
              list.includes(it.id)
                ? { ...it, draft: draft, interrupted: false, ...(draft ? {} : { startedAt: '', time: 0 }) }
                : it,
            )
            return { ...prev, data: { ...prev.data, items: next } }
          })
          if (draft) setPickedDraft((prev) => new Set())
          setNotice(draft ? `已转为草稿 ${list.length} 条` : `已转待执行 ${list.length} 条`)
          // 转待执行后，用户多半接着要开工：把「待执行」组展开，让它看得见。
          if (!draft) setOpenGroup('todo')
          await sync()
        } catch (error) {
          setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }))
          await sync()
        } finally {
          setBusy(false)
        }
      }

      // 本地打补丁：只就地更新这一条，不重排、不滚动、不改变展开项。
      const patch = async (id, value) => {
        // 审核通过前先算出「下一个待审核项」：审核完这一条，它就离开待审核组，
        // 于是自动展开它后面那条，省得用户再点一次。
        let nextUnreviewed = null
        if (value.review === true) {
          const unreviewed = (state.data?.items ?? []).filter((it) => it.execute === true && it.review !== true)
          const index = unreviewed.findIndex((it) => it.id === id)
          if (index >= 0 && index + 1 < unreviewed.length) nextUnreviewed = unreviewed[index + 1].id
        }
        const silent = value.silent === true
        // silent 是本地开关，别传给宿主（宿主只认 plan/review/draft 这些真实字段）。
        const patchValue = { ...value }
        delete patchValue.silent
        try {
          const data = await call('update', { ...payload, id, patch: patchValue })
          if (data === undefined) return data
          // 用宿主回写的条目做乐观更新：这样 refreshName 之类的派生字段（新标题）
          // 也能立刻反映到界面上，而不是等下一次轮询。
          const merged = data.item !== null && data.item !== undefined ? data.item : patchValue
          setState((prev) => {
            if (prev.data === null) return prev
            const list = (prev.data.items ?? []).map((it) => (it.id === id ? { ...it, ...merged } : it))
            return { ...prev, data: { ...prev.data, items: list } }
          })
          const reviewed = value.review === true
          // 审核完这一条后「待审核」是否已经空了。
          // id=356：空了也**不折叠**这一组 —— 用户点的是「通过」，不是「切换页面」。
          // 折叠会让整个列表当场消失（看起来就像被踢到别的组去了），
          // 留在原位、由组自己的空态文案（「暂无待审核内容」）说明结果更清楚；
          // 什么时候收起来、什么时候点别的组，交给用户。
          const remainingUnreviewed = (state.data?.items ?? []).filter(
            (it) => it.execute === true && it.review !== true && it.id !== id,
          ).length
          if (reviewed && remainingUnreviewed === 0) {
            setOpenId(null)
          } else if (reviewed && nextUnreviewed !== null) {
            setOpenId(nextUnreviewed)
            // 展开下一条仍在「待审核」组内，属于原位推进；分组若被手工收起，顺手展开它。
            // 注意这里**只**展开 unreviewed，绝不碰 'todo'。
            setOpenGroup('unreviewed')
          }
          if (!silent) {
            setNotice(
              reviewed
                ? `已审核通过 #${id}`
                : value.review === false
                  ? `已取消审核 #${id}`
                  : typeof value.plan === 'string'
                    ? `已保存草稿 #${id}`
                    : `已更新 #${id}`,
            )
          }
          return data
        } catch (error) {
          setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }))
          return undefined
        }
      }

      // 删除后不要「跳转」：不能把 remove 的返回值直接塞进 state.data。
      // remove 只回 { cwd, items }，缺 planExists / taskTypes，塞进去会让整个面板
      // 瞬间变成「这个项目还没有任务进度」并弹初始化按钮（看起来像跳走了）。
      // 所以这里先删，再用 sync() 静默重读一次完整结构，视图原地更新。
      const remove = async (id) => {
        setBusy(true)
        setState((prev) => ({ ...prev, error: '' }))
        try {
          await call('remove', { ...payload, id })
          if (openId === id) setOpenId(null)
          setPicked((prev) => {
            if (!prev.has(id)) return prev
            const next = new Set(prev)
            next.delete(id)
            return next
          })
          setPickedDone((prev) => {
            if (!prev.has(id)) return prev
            const next = new Set(prev)
            next.delete(id)
            return next
          })
          setPickedDraft((prev) => {
            if (!prev.has(id)) return prev
            const next = new Set(prev)
            next.delete(id)
            return next
          })
          await sync()
          setNotice(`已删除计划 #${id}`)
        } catch (error) {
          setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }))
        } finally {
          setBusy(false)
        }
      }

      /**
       * 整批通过入口（id=354 建按钮，id=355 落实为批量操作）：
       * 拆解批次头部那颗「通过」只发一个 id 进来，**整批**的审核在这里一次做完。
       *
       * 为什么不是「对每条子任务循环发 update」（上一版的做法）：
       *   十条子任务 = 十次请求、十次抢锁、十次写盘；中途失败会留下「审了一半」
       *   的中间态，界面上父行会在「待审核 / 已审核」之间抖 N 次。
       * 现在只发一次 `approveBatch`：宿主在**同一把锁、同一次读写**里把父 + 全部
       * children 一起置为已审核（形态由 `approveItem` 生成，与逐条点通过完全一致），
       * 再按既有归档规则把整批搬进 notes.json。要么全成、要么一条都不动。
       *
       * 失败时不做乐观更新：磁盘没改动，界面就不该先跳到「已审核」。
       */
      const approveBatch = async (id) => {
        const parent = items.find((it) => String(it.id) === String(id))
        if (parent === undefined) return
        const kids = Array.isArray(parent.children) ? parent.children : []
        // 与宿主同一口径：父自己的 review 是容器标记，也要算进「还剩几条没审」。
        // 两边各算一套的话，极端情况下（子任务都审过、父没落标记）按钮会显示可点，
        // 而宿主其实无事可做 —— 所以判据只写这一种。
        //
        // id=372：`one.review` 前先挡脏数据。kids 里混进 null / 字符串时
        // （手改 plan.json、旧版本写坏的数组），`one.review` 会抛
        // `Cannot read properties of null` —— 用户点「通过」看到的是失败提示，
        // 而真正该做的是照常把能审的审掉。宿主侧 approveItem 也已同步加固。
        const pool = (kids.length > 0 ? [parent, ...kids] : [parent]).filter((one) => one !== null && typeof one === 'object')
        const pendingCount = pool.filter((one) => one.review !== true).length
        if (pendingCount === 0) {
          setNotice('这一批已经全部审核过了')
          return
        }
        setBusy(true)
        setState((prev) => ({ ...prev, error: '' }))
        try {
          const data = await call('approveBatch', { ...payload, id: parent.id })
          const approvedCount = Number(data?.approvedCount ?? 0)
          setPicked((prev) => {
            // 这一批里被审掉的子任务若还留在勾选集合里，一并清掉。
            if (prev.size === 0) return prev
            const next = new Set(prev)
            // id=372：同一个脏数据防护 —— 这里的 kids 可能含 null。
            for (const one of kids) {
              if (one !== null && typeof one === 'object') next.delete(one.id)
            }
            next.delete(parent.id)
            return next.size === prev.size ? prev : next
          })
          setNotice(`整批已通过 ${approvedCount > 0 ? approvedCount : pendingCount} 条`)
          // id=356：通过之后这一批离开「待审核」，但**不切换分组**。
          // 以前这里在整组清空时 setOpenGroup(null)（全部折叠），而这种「收起」状态
          // 在重挂载时会被读成默认的待执行组 —— 用户看到的就是「点通过后跳去待执行」。
          // 现在什么都不动：组留在原位，用空态文案说明「暂无待审核内容」。
          // 唯一的例外是展开项还指向这一批里的某条（它已经不在这组了）：只清展开项。
          setOpenId((prev) => {
            if (prev === null) return prev
            // id=372：同上，`one.id` 前挡脏数据。
            const gone = kids.some((one) => one !== null && typeof one === 'object' && String(one.id) === String(prev)) || String(prev) === String(parent.id)
            return gone ? null : prev
          })
          // 写回后必须重新读一次：分组、条数、以及头部那颗「通过」的可见性
          // （statusOf 已经算成 reviewed → 按钮不再渲染）都从磁盘这份数据推导，不另存状态。
          await sync()
        } catch (error) {
          setState((prev) => ({
            ...prev,
            error: `整批通过失败：${error instanceof Error ? error.message : String(error)}`,
          }))
          await sync()
        } finally {
          setBusy(false)
        }
      }

      /** 批量审核：把勾选的待审核项一次性全部通过。 */
      const approvePicked = async (ids) => {
        if (ids.length === 0) {
          setNotice('先勾选要审核的计划')
          return
        }
        setBusy(true)
        setState((prev) => ({ ...prev, error: '' }))
        let done = 0
        try {
          for (const id of ids) {
            await call('update', { ...payload, id, patch: { review: true } })
            done += 1
          }
          setPicked(new Set())
          setNotice(`已批量审核通过 ${done} 条`)
          // id=356：批量通过后**不折叠、不切换分组**（同单条通过的取舍）。
          // 只把展开项从「这一批已经离开的条目」上摘掉，其余状态一律不动。
          setOpenId((prev) => (prev !== null && ids.some((id) => String(id) === String(prev)) ? null : prev))
          await sync()
        } catch (error) {
          setState((prev) => ({
            ...prev,
            error: `已通过 ${done} 条，其余失败：${error instanceof Error ? error.message : String(error)}`,
          }))
          await sync()
        } finally {
          setBusy(false)
        }
      }

      /** 批量删除「已审核」/「草稿」组里勾选的条目。正在执行的会被宿主跳过。 */
      const removePickedDone = async (ids) => {
        if (ids.length === 0) {
          setNotice('先勾选要删除的计划')
          return
        }
        setBusy(true)
        setState((prev) => ({ ...prev, error: '' }))
        try {
          let removed = []
          let skipped = []
          try {
            const result = await call('removeMany', { ...payload, ids })
            removed = Array.isArray(result?.removed) ? result.removed : []
            skipped = Array.isArray(result?.skipped) ? result.skipped : []
          } catch (bulkError) {
            // 宿主还是旧版本、没有 removeMany 时，逐条删除兜底。
            for (const id of ids) {
              try {
                await call('remove', { ...payload, id })
                removed.push(id)
              } catch (oneError) {
                skipped.push(id)
                void bulkError
                void oneError
              }
            }
          }
          setPickedDone(new Set())
          setPickedDraft(new Set())
          if (openId !== null && removed.includes(openId)) setOpenId(null)
          if (skipped.length > 0) setNotice(`已删除 ${removed.length} 条，${skipped.length} 条执行中跳过`)
          else if (removed.length > 0) setNotice(`已删除 ${removed.length} 条`)
          else setNotice('没有可删除的计划')
          await sync()
        } catch (error) {
          setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }))
          await sync()
        } finally {
          setBusy(false)
        }
      }

      /**
       * 「待审核自动通过条数」下拉的 change（id=300）。
       *
       * 写回 → 宿主立刻按新阈值补一轮自动通过 + 归档 → 重读。
       * `autoApproved` 是这次真被通过掉的 id（宿主回传），有就报一句，
       * 免得用户看到待审核凭空少了几条却不知道为什么。
       */
      const changeAutoReviewLimit = async (value) => {
        const next = Number(value)
        await run(async () => {
          const saved = await call('settings', { ...payload, patch: { autoReviewLimit: next } })
          const passed = Array.isArray(saved?.autoApproved) ? saved.autoApproved.length : 0
          setNotice(
            passed > 0
              ? `待审核超过 ${next} 条后自动通过 · 本次自动通过 ${passed} 条`
              : `待审核自动通过：超过 ${next} 条时通过最旧的一条`,
          )
          return call('read', { ...payload, lite: true })
        })
      }

      React.useEffect(() => {
        if (notice === '') return undefined
        const timer = setTimeout(() => setNoticeState(''), noticeMsRef.current)
        return () => clearTimeout(timer)
      }, [notice])

      // 数据刷新后把已经不存在的 / 已审核的 id 从勾选集合里剔掉，避免「已选 N」虚高。
      React.useEffect(() => {
        const pending = new Set((state.data?.items ?? []).filter((it) => it.execute === true && it.review !== true).map((it) => it.id))
        setPicked((prev) => {
          const next = new Set([...prev].filter((id) => pending.has(id)))
          return next.size === prev.size ? prev : next
        })
        const reviewed = new Set((state.data?.items ?? []).filter((it) => it.execute === true && it.review === true).map((it) => it.id))
        setPickedDone((prev) => {
          const next = new Set([...prev].filter((id) => reviewed.has(id)))
          return next.size === prev.size ? prev : next
        })
        const drafting = new Set((state.data?.items ?? []).filter((it) => it.draft === true).map((it) => it.id))
        setPickedDraft((prev) => {
          const next = new Set([...prev].filter((id) => drafting.has(id)))
          return next.size === prev.size ? prev : next
        })
      }, [state.data])

      return h(
        'div',
        { className: 'plt-root', ref: rootRef, style: { position: 'relative' } },
        h(
          'div',
          // has-error（id=210）：让顶栏那颗「开始 / 暂停」跟着错误提示一起描红，操作失败时不用靠猜。
          { className: state.error === '' ? 'plt-top' : 'plt-top has-error' },
          h('span', { className: 'plt-title' }, `任务列表 · ${items.length}`),
          // 提交/审核的提示放在「自动刷新」左侧，不再占用下方空间。
          notice !== '' ? h('span', { className: 'plt-notice' }, notice) : null,
          h(
            'button',
            {
              className: `plt-btn plt-auto${auto ? ' on' : ''}`,
              'data-tip': auto ? `自动刷新已开启，${tick} 秒后重新读取 plan.json` : '自动刷新已关闭',
              onClick: () => setAuto((prev) => !prev),
            },
            h(
              'span',
              { className: 'plt-dot', 'aria-hidden': 'true' },
            ),
            h('span', null, auto ? `${tick}s` : '自动'),
          ),
          // 开始 / 暂停（id=207 渲染，id=208 接逻辑，id=354 合成一个按钮）：
          // 插在「自动刷新」与「刷新」之间，即口语需求说的「任务列表右边、倒计时左边」。
          // 原先并排两颗按钮、靠 disabled 让它们互斥，题面要求「显示一个就行」——
          // 现在同一个位置只渲染一颗，身份由「会话是不是真的在跑」决定：
          // 在跑 → 暂停；其余 → 开始 / 继续（开工指令在飞时显示「发送中…」）。
          // 这样「同一时刻只有一个可见动作」是结构上的事实，而不是靠两个 disabled 拼出来；
          // 图标、文案、onClick 都由同一个 showPause 决定，不可能出现文字与动作对不上。
          // 可用性仍然只由 canStart / canPause 推导（见上方 working 一带），不另存状态：
          //   未开始 → 开始可点；执行中 → 暂停可点；已挂起 → 文案变「继续」；
          //   全部完成（无待办）→ 开始禁用；busy（有请求在飞）→ 禁用。
          (() => {
            // showPause 只看「会话真的在跑」（agentRunning），不看 working：
            // working 还包含「开工指令刚发出、还没送到」的 starting 那几秒，
            // 那几秒画成「暂停」既不可点（pauseWork 会自己 return），
            // 又会让按钮在「开始」→「暂停」之间闪一下。这段时间继续留在「开始」上，
            // 文案换成「发送中…」并转圈，和列表底部那颗行内按钮的语义一致。
            // pausing 也算进来：点下暂停到 turn 真停下之间，按钮得继续显示「暂停中」，
            // 否则 `working` 还在、`agentRunning` 先翻下去的那一帧会闪回「开始」。
            const showPause = agentRunning === true || pausing === true
            const sending = showPause !== true && starting === true
            const pausingNow = showPause && pausing === true
            const enabled = showPause ? canPause === true : canStart === true
            const tip = showPause
              ? pausingNow
                ? '正在挂起当前执行，请稍候'
                : '挂起当前执行，已完成的进度会保留'
              : sending
                ? '正在把开工指令发进会话，稍候片刻'
                : pendingCount === 0
                  ? '没有待执行的计划'
                  : pausedIdle
                    ? '从挂起处继续队首这条计划，已完成的不会重做'
                    : `把队首任务发进会话（按钮「${KICKOFF_TEXT}」），模型不用再自己找下一条`
            return h(
              'button',
              {
                className: showPause
                  ? 'plt-btn plt-pause'
                  : `plt-btn plt-start${pausedIdle ? ' is-resume' : ''}`,
                // 给测试 / 排查一个稳定的定位点：同一颗按钮，多种身份。
                'data-act': showPause ? 'pause' : sending ? 'sending' : pausedIdle ? 'resume' : 'start',
                disabled: enabled !== true,
                'data-tip': tip,
                onClick: (e) => {
                  e.stopPropagation()
                  void (showPause ? pauseWork() : startWork())
                },
              },
              showPause
                ? pausingNow
                  ? h(SpinnerIcon, { size: 12 })
                  : h(PauseIcon, { size: 12 })
                : sending
                  ? h(SpinnerIcon, { size: 12 })
                  : h(PlayIcon, { size: 12 }),
              h('span', null, showPause
                ? pausingNow ? '暂停中' : '暂停'
                : sending ? '发送中…' : pausedIdle ? '继续' : '开始'),
            )
          })(),
        ),
        state.error !== '' ? h('div', { className: 'plt-err' }, state.error) : null,
        // 「确实没有可用模型」的引导条（id=364）。
        //
        // 只在这一种情况下出现：ensureModel 已经等过、重试过，目录仍然是空的。
        // 「列表还没就绪」不会走到这里 —— 那个被等待 + 重试消化掉了。
        //
        // 文案里刻意把两种成因分开说（没配 vs 读不出来），因为下一步动作不同：
        // 前者要去配 provider，后者多半是 key / 端点的问题。
        // 右侧给一个可点的「重新加载」—— 用户刚配好就回到面板是最常见的场景，
        // 让他重开页面是没必要的惩罚。
        modelMissing
          ? h(
              'div',
              { className: 'plt-guide', role: 'status' },
              h(
                'span',
                { className: 'plt-guide-txt' },
                modelState.providers.length === 0
                  ? '没有可用的模型：这个部署还没有配置任何 provider。配好之后点右侧重新加载。'
                  : '模型列表读不出来：provider 已配置但探测失败，检查 key / 端点后重新加载。',
              ),
              h(
                'button',
                {
                  className: 'plt-btn plt-guide-btn',
                  type: 'button',
                  disabled: modelLoading,
                  'data-tip': '重新拉一次可用模型列表',
                  onClick: () => void reloadModels(),
                },
                modelLoading ? '加载中…' : '重新加载',
              ),
            )
          : null,
        h(
          'div',
          { className: 'plt-list' },
          state.loading
            ? h('div', { className: 'plt-empty' }, '读取中…')
            : state.data === null
              ? h('div', { className: 'plt-empty' }, '读取失败')
              : state.data.planExists !== true
                ? h('div', { className: 'plt-empty' }, '这个项目还没有任务进度。', h('br'), h('button', { className: 'plt-btn', onClick: () => setShowInit(true) }, '初始化'))
                : items.length === 0
                  ? h('div', { className: 'plt-empty' }, '还没有计划。', h('br'), '在下面的输入框写下第一条，或直接在对话窗口说需求。')
                  : (() => {
                      // 组顺序（从上到下）：已审核最上 → 待审核 → 待执行最下。
                      // 越靠下越接近底部输入框，写完就能直接提交，符合「干完的往上沉」的阅读习惯。
                      // 只有待执行组可拖拽排序；「已审核」组内部按倒序展示（最近完成的在最上）。
                      // id=273：父节点（拆解批次）的状态由 children 决定 —— 它自己的
                      // execute / draft 只是容器标记，整批都做完之前不该沉到「已审核」，
                      // 所以分组看的是「这一批里还剩几条没做完」，与宿主队列口径一致。
                      const batchOf = (it) => {
                        const kids = Array.isArray(it.children) ? it.children : []
                        if (kids.length === 0) return null
                        return {
                          allDone: kids.every((c) => c.execute === true),
                          allReviewed: kids.every((c) => c.execute === true && c.review === true),
                        }
                      }
                      // id=338：已审核组固定「完成时间倒序」——最近审核通过的在最上。
                      // 以前是「上游怎么给就整个 reverse 一遍」：来源是
                      // [归档(新→旧), plan.json(按 order)]，reverse 之后两段各自反向，
                      // 刚通过的一条反而沉到下面去了。改成按 finishedAt 显式排序，
                      // 与来源顺序解耦；老条目缺 finishedAt 时退到 createdAt、再退到 id。
                      // 拆解批次用 children 里最晚的完成时间（整批审完的那一刻才算完成）。
                      const reviewedTimeOf = (it) => {
                        const kids = Array.isArray(it.children) ? it.children : []
                        const pool = kids.length > 0 ? kids : [it]
                        const times = pool.map((one) => {
                          const done = typeof one?.finishedAt === 'string' ? Date.parse(one.finishedAt) : NaN
                          if (Number.isFinite(done)) return done
                          const born = typeof one?.createdAt === 'string' ? Date.parse(one.createdAt) : NaN
                          return Number.isFinite(born) ? born : 0
                        })
                        return times.length === 0 ? 0 : Math.max(...times)
                      }
                      const reviewedRank = (it) => {
                        const head = Number(String(it?.id ?? '').split('-')[0])
                        return Number.isFinite(head) ? head : 0
                      }
                      const doneReviewed = items
                        .filter((it) => {
                          const batch = batchOf(it)
                          if (batch !== null) return batch.allReviewed && it.draft !== true
                          return it.execute === true && it.review === true && it.draft !== true
                        })
                        .sort((a, b) => reviewedTimeOf(b) - reviewedTimeOf(a) || reviewedRank(b) - reviewedRank(a))
                      const donePending = items.filter((it) => {
                        const batch = batchOf(it)
                        if (batch !== null) return batch.allDone && batch.allReviewed !== true && it.draft !== true
                        return it.execute === true && it.review !== true && it.draft !== true
                      })
                      // 草稿单独成组（绿色、最靠下、贴着输入框）；没有草稿时整组不显示。
                      const draftList = items.filter((it) => it.draft === true)
                      const todoList = items.filter((it) => {
                        if (it.draft === true) return false
                        const batch = batchOf(it)
                        if (batch !== null) return batch.allDone !== true
                        return it.execute !== true
                      })
                      const groups = [
                        { key: 'reviewed', title: '已审核', list: doneReviewed, defaultOpen: false, drag: false, alwaysShow: false, emptyText: '还没有审核通过的计划' },
                        { key: 'unreviewed', title: '待审核', list: donePending, defaultOpen: false, drag: false, alwaysShow: true, emptyText: '暂无待审核内容' },
                        { key: 'todo', title: '待执行', list: todoList, defaultOpen: true, drag: true, alwaysShow: true, emptyText: '待执行里没有计划，在下面的输入框写一条。' },
                        { key: 'draft', title: '草稿', list: draftList, defaultOpen: true, drag: false, alwaysShow: false, emptyText: '' },
                      ]
                      const renderItem = (item, dragEnabled, groupKey) => {
                        // 「待审核」「已审核」「草稿」三组支持勾选：分别用于批量审核、
                        // 批量删除、批量转待执行。正在执行的条目任何组都不参与勾选。
                        const selectable =
                          (groupKey === 'unreviewed' || groupKey === 'reviewed' || groupKey === 'draft') &&
                          statusOf(item).key !== 'running'
                        const pickedSet = groupKey === 'reviewed' ? pickedDone : groupKey === 'draft' ? pickedDraft : picked
                        const setPickedSet =
                          groupKey === 'reviewed' ? setPickedDone : groupKey === 'draft' ? setPickedDraft : setPicked
                        return h(Item, {
                          key: item.id,
                          item,
                          // 这一条刚换了分组：让它在新的栏里播一次「升华 / 蒸腾」动画。
                          sublime: sublimeIds.has(item.id),
                          open: openId === item.id,
                          // 展开时按需取回的单条全文（正文 + 备注）。
                          detail: openId === item.id ? detail : null,
                          busy,
                          dragEnabled,
                          selectable,
                          // 所属分组，决定「复制 ID / 复制内容」这类组内专属按钮是否出现。
                          groupKey,
                          // 置顶按钮只出现在待执行组，且拆分出来的子任务不给（id=243）。
                          // 判定依据只能是 `decomposeKey`：`[拆] ` 是宿主拼在 name 上的文案，
                          // 用户改个名就骗过去了，而 key 是落盘事实（宿主 `dedupeKeyOf` 生成）。
                          // 为什么不许置顶：拆解出来的是一组按顺序铺开的工作单元，把它们
                          // 挑一条顶到最前面，等于绕过拆解给出的执行顺序，用户看着也乱。
                          canPin: groupKey === 'todo' && (item.decomposeKey ?? '') === '',
                          onPinTop: () => void pinTop(item.id),
                          // id=354：拆解批次头部的「整批通过」统一入口。
                          // 只传 id，遍历 children 与收尾都在 approveBatch 里做 ——
                          // 按钮本身保持哑组件，不自己算「这一批还剩几条」。
                          onApproveBatch: (batchId) => void approveBatch(batchId),
                          // 草稿组专属：单条「转为待执行」+ 正文可直接编辑。
                          // 草稿组里的父节点给「转为待执行」：整批一起出草稿（宿主按 id 改父）。
                          onPromote: () => void moveToGroup([item.id], false),
                          // 待执行里还没开工的才允许退回草稿（执行中不给）。
                          // 父节点（拆解批次）不给「转为草稿」：它的草稿态是整批的落点，
                          // 单条父退回草稿要连带处理 children，宿主没有这个语义（id=273）。
                          // 待执行里还没开工的条目可以退回草稿（执行中不给）。
                          //
                          // id=376：**去掉「批次不给」这条限制**。原来这里还要求
                          // `!(item.children?.length > 0)` —— 也就是拆解批次不能转草稿。
                          // 题面要求「拆分的与单任务都转到头部」，而这颗按钮要挪到头部，
                          // 若继续排除批次，批次卡的头部就永远少一颗，两种卡的位置又不一致了。
                          //
                          // 放开是安全的：`moveToGroup` 打的是 `{ draft: true }`，
                          // 而 `statusOf` 对父节点是「草稿优先」—— 整批被标 draft 后，
                          // 即使子任务都做完了也判为草稿，不会被「整批做完 = 待审核」洗掉。
                          // 子任务自己不带 draft（它们是父的一部分），所以不存在
                          // 「父进了草稿、子还在待执行」的错位。
                          canDemote: groupKey === 'todo' && statusOf(item, impliedRunningId === item.id).key === 'todo',
                          onDemote: () => void moveToGroup([item.id], true),
                          editable: groupKey === 'draft',
                          // 会话在跑但这条还没写 startedAt：先按「执行中」显示。
                          impliedRunning: impliedRunningId === item.id,
                          // 三组都不再显示「已执行」只读勾选框：待执行还没跑，待审核/已审核必然已执行。
                          showExecute: false,
                          // 「审核通过」只在待审核组需要：已审核的都通过了，不再重复勾一次。
                          showReview: groupKey === 'unreviewed',
                          selected: pickedSet.has(item.id),
                          onSelect: (on) => {
                            setPickedSet((prev) => {
                              const next = new Set(prev)
                              if (on) next.add(item.id)
                              else next.delete(item.id)
                              return next
                            })
                          },
                          dragging: dragId === item.id,
                          dropTarget: dropId === item.id && dragId !== null && dragId !== item.id,
                          onDragStart: () => {
                            setDragId(item.id)
                            setDropId(null)
                          },
                          onDragOver: () => {
                            if (dragId !== null && dragId !== item.id) setDropId(item.id)
                          },
                          onDrop: () => {
                            void moveTo(dragId, item.id)
                            setDragId(null)
                            setDropId(null)
                          },
                          onDragEnd: () => {
                            setDragId(null)
                            setDropId(null)
                          },
                          onToggle: () => toggleItem(item.id),
                          onFetchDetail: fetchDetail,
                          // id=273：父节点展开后是子任务列表，每行一个「通过」——
                          // 子任务不在顶层 openId 体系里，patch 的 id 由行内自己给。
                          // 顶层卡片的调用仍然只传值（不传 id）。
                          // id=325：子任务 id 现在是 "100-A" 这种字符串，只判 typeof number
                          // 会把它当成 patch 对象，于是「通过」实际打到了父上（子任务没变）。
                          onPatch: (a, b) => (typeof a === 'number' || typeof a === 'string' ? patch(a, b) : patch(item.id, a)),
                          onRemove: () => remove(item.id),
                        })
                      }
                      return groups
                        .filter((group) => group.alwaysShow === true || group.list.length > 0)
                        .map((group) => {
                          const isOpen = openGroup === group.key
                          // id=238：这一组里有没有「正在执行」的条目 —— 唯一口径还是 statusOf，
                          // 与卡片上那个「执行中」标签逐条对齐（含 impliedRunning 那一条）。
                          // 必须挂在组容器上：收起时组内卡片整块不渲染，后代选择器无从判断（见 id=237 定位）。
                          // 刻意不含 starting：刚点下「开始」、模型还没接手的那几秒组里一条执行中的都没有。
                          const isRunning = group.list.some((it) => statusOf(it, impliedRunningId === it.id).key === 'running')
                          const pendingIds = group.key === 'unreviewed' ? group.list.map((item) => item.id) : []
                          const allPicked = pendingIds.length > 0 && pendingIds.every((id) => picked.has(id))
                          // 「已审核」组同样支持勾选，用于批量删除。
                          const doneIds = group.key === 'reviewed' ? group.list.map((item) => item.id) : []
                          const allPickedDone = doneIds.length > 0 && doneIds.every((id) => pickedDone.has(id))
                          // 「草稿」组也支持勾选：批量转待执行 / 批量删除。
                          const draftIds = group.key === 'draft' ? group.list.map((item) => item.id) : []
                          const allPickedDraft = draftIds.length > 0 && draftIds.every((id) => pickedDraft.has(id))
                          return h(
                            'div',
                            { key: group.key, className: `plt-group plt-group-${group.key}${isOpen ? ' open' : ''}${isRunning ? ' is-running' : ''}`, 'data-running': isRunning ? 'true' : 'false' },
                            h(
                              'div',
                              {
                                className: `plt-group-h${isOpen ? ' open' : ''}${isOpen ? '' : arriveGroups.has(group.key) ? ' plt-arrive' : ''}`,
                                onClick: () => setOpenGroup(isOpen ? null : group.key),
                                'aria-expanded': isOpen ? 'true' : 'false',
                              },
                              h('span', { className: 'plt-caret' }, h(CaretIcon, { size: 13 })),
                              h('span', { className: 'plt-group-name' }, group.title),
                              // id=377：「完成后暂停」开关 —— 组头**左侧**、紧跟组名之后。
                              //
                              // 为什么放在这个位置而不是最右端：最右端已经被条数统计占着
                              //（id=337 刻意压在所有控件之后，让各组的数字竖着对齐），
                              // 往那里插一个宽度会变的开关，等于把那条对齐线打散。
                              // 放在组名右侧，读起来是「干活中 · 完成后暂停」，一句话。
                              //
                              // 显隐（题面）：**只在「干活中」有任务正在执行时渲染**，
                              // 无执行中任务时整块不显示。判据用 isRunning（与组容器上
                              // 那个 data-running、以及收起态那句「正在执行」同一个口径），
                              // 不另算一套，否则会出现「组头说在跑、开关却不出现」的矛盾。
                              //
                              // 文案：关闭态「完成后暂停」，开启态「继续执行」。
                              // 开启后说的不再是「要不要暂停」而是「接下来会怎样」——
                              // 开关已经拨过去了，再重复一遍动作没有信息量。
                              //
                              // title（题面要求逐字）：解释这个开关到底做什么。
                              // 同时也用 data-tip —— 这个插件的气泡提示统一走 40-tip.js，
                              // 只有 title 的话悬停要等浏览器那个 ~1s 的延迟。
                              group.key === 'todo' && isRunning
                                ? h(
                                    'button',
                                    {
                                      className: `plt-auto-pause${pauseAfterDone ? ' on' : ''}`,
                                      type: 'button',
                                      // 组头整行是展开/收起的热区，开关必须自己吃掉点击。
                                      // id=379：走统一写入口 —— 它同步写 ref（派发回调读的是 ref），
                                      // 并在拨回「继续执行」时立刻恢复派发。
                                      onClick: (e) => {
                                        e.stopPropagation()
                                        togglePauseAfterDone()
                                      },
                                      title: '开启后当前任务执行完不再自动派发下一个任务，关闭则继续自动派发',
                                      'data-tip': '开启后当前任务执行完不再自动派发下一个任务，关闭则继续自动派发',
                                      'aria-label': '完成后暂停',
                                      // 读屏要的是「当前是开还是关」，不能只靠文案变化
                                      //（「完成后暂停 / 继续执行」两种文案都不是 on/off 本身）。
                                      'aria-pressed': pauseAfterDone === true,
                                    },
                                    // 小圆点承担开关状态：与顶栏那颗「自动刷新」（.plt-auto .plt-dot）
                                    // 同一套视觉语言 —— 亮起 = 开，灰点 = 关。不新造一个 toggle 皮肤。
                                    h('span', { className: 'plt-dot', 'aria-hidden': 'true' }),
                                    h('span', { className: 'plt-auto-pause-txt' }, pauseAfterDone ? '继续执行' : '完成后暂停'),
                                  )
                                : null,
                              // id=337：条数统计挪到组头最右端（所有控件之后），
                              // 读数固定补足三位（001 / 012 / 123）—— 组与组之间同一位置、
                              // 同一宽度，展开收起时右边界不会跟着数字位数来回跳。
                              // id=240：组收起、里面还有条目在跑时，给一句看得见的提示。
                              // 展开态不显示 —— 那时卡片自己的「执行中」标签就在眼前，再说一遍是噪音。
                              // 文字 + 转圈都放进去：侧栏很窄时 aria/title 是读屏与悬停的兜底。
                              isRunning && isOpen !== true
                                ? h(
                                    'span',
                                    { className: 'plt-group-run', 'data-tip': '这一组里还有任务正在执行', 'aria-label': '正在执行' },
                                    h(SpinnerIcon, { size: 11 }),
                                    h('span', { className: 'plt-group-run-txt' }, '正在执行'),
                                  )
                                : null,
                              // 「待审核超过 N 条自动通过最旧一条」的条数（id=300）。
                              // 档位由宿主下发的 noteLimits 决定。已审核不再按条数删除，所以这个下拉只出现在待审核。
                              group.key === 'unreviewed' && Array.isArray(state.data?.noteLimits)
                                ? h(
                                    'select',
                                    {
                                      className: 'plt-limit',
                                      value: String(state.data?.settings?.autoReviewLimit ?? 200),
                                      disabled: busy,
                                      'aria-label': '待审核自动通过的条数',
                                      'data-tip': '待审核超过这个条数时，自动通过最旧的一条，并搬进已审核。已审核会一直保留',
                                      onClick: (e) => e.stopPropagation(),
                                      onChange: (e) => void changeAutoReviewLimit(e.target.value),
                                    },
                                    state.data.noteLimits.map((n) =>
                                      h('option', { key: String(n), value: String(n) }, String(n)),
                                    ),
                                  )
                                : null,
                              // id=337：条数统计压在所有控件之后（最右端），补足三位。
                              // 放最后而不是紧跟组名：下拉 / 提示 / 备份开关的长短各不相同，
                              // 数字挂在组名后面时每一组的位置都不一样，扫视时对不齐。
                              h('span', { className: 'plt-group-count' }, padCount(group.list.length)),
                            ),
                            isOpen
                              ? group.list.length > 0
                                ? h(
                                    React.Fragment,
                                    null,
                                    h('div', { className: 'plt-group-body' }, group.list.map((item) => renderItem(item, group.drag, group.key))),
                                    // 「待审核」组底部固定一排操作：全选 + 全部通过。
                                    group.key === 'unreviewed'
                                      ? h(
                                          'div',
                                          { className: 'plt-bulk' },
                                          h(
                                            'label',
                                            { className: 'plt-check', 'data-tip': allPicked ? '取消全选' : '全选本组全部' },
                                            h('input', {
                                              type: 'checkbox',
                                              checked: allPicked,
                                              disabled: busy,
                                              onChange: (e) => {
                                                if (e.target.checked) {
                                                  setPicked(new Set(pendingIds))
                                                } else {
                                                  setPicked(new Set())
                                                }
                                              },
                                            }),
                                            h('span', null, '全选'),
                                          ),
                                          h('span', { className: 'plt-bulk-count' }, picked.size > 0 ? `已选 ${picked.size}` : ''),
                                          h(
                                            'button',
                                            {
                                              className: 'plt-btn plt-bulk-pass',
                                              disabled: busy || picked.size === 0,
                                              'data-tip': '把勾选的计划一次性审核通过',
                                              onClick: (e) => {
                                                e.stopPropagation()
                                                void approvePicked([...picked])
                                              },
                                            },
                                            '全部通过',
                                          ),
                                        )
                                      : null,
                                    // 「已审核」组底部固定一排操作：全选 + 全部删除。
                                    group.key === 'reviewed'
                                      ? h(
                                          'div',
                                          { className: 'plt-bulk plt-bulk-danger' },
                                          h(
                                            'label',
                                            { className: 'plt-check', 'data-tip': allPickedDone ? '取消全选' : '全选本组全部' },
                                            h('input', {
                                              type: 'checkbox',
                                              checked: allPickedDone,
                                              disabled: busy,
                                              onChange: (e) => {
                                                if (e.target.checked) {
                                                  setPickedDone(new Set(doneIds))
                                                } else {
                                                  setPickedDone(new Set())
                                                }
                                              },
                                            }),
                                            h('span', null, '全选'),
                                          ),
                                          h('span', { className: 'plt-bulk-count' }, pickedDone.size > 0 ? `已选 ${pickedDone.size}` : ''),
                                          h(
                                            'button',
                                            {
                                              className: 'plt-btn plt-bulk-del',
                                              disabled: busy || pickedDone.size === 0,
                                              'data-tip': '把勾选的已审核计划一次性删除',
                                              onClick: (e) => {
                                                e.stopPropagation()
                                                void removePickedDone([...pickedDone])
                                              },
                                            },
                                            '全部删除',
                                          ),
                                        )
                                      : null,
                                    // 「草稿」组底部一排操作：全选 + 全部删除 + 批量「转待执行」。
                                    group.key === 'draft'
                                      ? h(
                                          'div',
                                          { className: 'plt-bulk' },
                                          h(
                                            'label',
                                            { className: 'plt-check', 'data-tip': allPickedDraft ? '取消全选' : '全选本组全部' },
                                            h('input', {
                                              type: 'checkbox',
                                              checked: allPickedDraft,
                                              disabled: busy,
                                              onChange: (e) => {
                                                if (e.target.checked) setPickedDraft(new Set(draftIds))
                                                else setPickedDraft(new Set())
                                              },
                                            }),
                                            h('span', null, '全选'),
                                          ),
                                          h('span', { className: 'plt-bulk-count' }, pickedDraft.size > 0 ? `已选 ${pickedDraft.size}` : ''),
                                          h(
                                            'button',
                                            {
                                              className: 'plt-btn plt-bulk-del',
                                              disabled: busy || pickedDraft.size === 0,
                                              'data-tip': '把勾选的草稿一次性删除',
                                              onClick: (e) => {
                                                e.stopPropagation()
                                                void removePickedDone([...pickedDraft])
                                              },
                                            },
                                            '全部删除',
                                          ),
                                          h(
                                            'button',
                                            {
                                              className: 'plt-btn plt-bulk-promote',
                                              disabled: busy || pickedDraft.size === 0,
                                              'data-tip': '把勾选的草稿一次性转为待执行',
                                              onClick: (e) => {
                                                e.stopPropagation()
                                                void moveToGroup([...pickedDraft], false)
                                              },
                                            },
                                            '转待执行',
                                          ),
                                        )
                                      : null,
                                    // 「待执行」组底部固定一排操作：待执行存在时提供「开始干活」。
                                    // 点了才把提示词发进左侧会话，写完计划不再自动开工。
                                    // 只要模型在跑（会话 running / 某条已写 startedAt / 刚点下去），
                                    // 按钮就变成「干活中」+ 转圈图标，并且不可再点，避免重复投喂。
                                    group.key === 'todo' && group.list.length > 0
                                      ? h(
                                          'div',
                                          { className: 'plt-bulk plt-bulk-start' },
                                          h(
                                            'span',
                                            { className: 'plt-bulk-count' },
                                            runningCount > 0
                                              ? `正在执行 ${runningCount} 条…`
                                              : agentRunning
                                                ? '模型正在干活…'
                                                : `${group.list.length} 条待执行`,
                                          ),
                                          h(
                                            'button',
                                            {
                                              className: `plt-btn plt-bulk-go${working ? ' is-working' : ''}`,
                                              disabled: busy || working || starting,
                                              'data-tip':
                                                working
                                                  ? '模型正在干活，等它完成再开始下一条'
                                                  : '把队首任务发进左侧会话，和后面自动派发的是同一段正文',
                                              onClick: (e) => {
                                                e.stopPropagation()
                                                void startWork()
                                              },
                                            },
                                            working || starting ? h(SpinnerIcon, { size: 13 }) : null,
                                            h('span', null, starting ? '发送中…' : working ? '干活中' : `▶ ${KICKOFF_TEXT}`),
                                          ),
                                        )
                                      : null,
                                  )
                                : h(
                                    'div',
                                    { className: 'plt-group-empty' },
                                    h(EmptyIcon, { size: 22 }),
                                    h('span', null, group.emptyText ?? '暂无内容'),
                                  )
                              : null,
                          )
                        })
                    })(),
        ),
        state.data?.planExists === true
          ? h(
              'div',
              { className: 'plt-form-wrap' },
              h(
                'div',
                { className: 'plt-composer' },
                h('textarea', {
                  className: 'plt-input',
                  placeholder: '写下一条计划，按 Shift+Enter 追加（Ctrl/Cmd+Enter 也可以）…',
                  value: form.plan,
                  onChange: (e) => setForm({ ...form, plan: e.target.value }),
                  onKeyDown: (e) => {
                    // Shift+Enter 追加任务；Ctrl/Cmd+Enter 作为习惯动作也保留。
                    const submit = (e.shiftKey || e.metaKey || e.ctrlKey) && e.key === 'Enter'
                    if (submit) {
                      e.preventDefault()
                      void append()
                    }
                  },
                }),
                h(
                  'div',
                  { className: 'plt-bar' },
                  h(
                    'div',
                    { className: 'plt-chips' },
                    // 「仅回答」放最后面。
                    // 三个类型之间插一个「-」、拆解之前插一个「+」，用来说明「类型三选一」
                    // 与「拆解是叠加的第四项」这两层关系（id=145）。
                    // 连接符是 .plt-op 定高居中的纯文本，不参与点击、不占选位。
                    (() => {
                      const types = ['修改', '目标', '仅回答'].filter((type) =>
                        (state.data?.taskTypes ?? ['仅回答', '目标', '修改']).includes(type),
                      )
                      // 一个「段」= 可选连接符 + 一枚胶囊，段内不拆开。
                      // 这样换行时连接符永远跟着它右边的胶囊走，不会单独落在行首（id=145）。
                      const nodes = []
                      types.forEach((type, index) => {
                        const seg = []
                        if (index > 0) seg.push(h('span', { key: `op-${type}`, className: 'plt-op', 'aria-hidden': 'true' }, '-'))
                        seg.push(
                          h(
                            'button',
                            {
                              key: type,
                              type: 'button',
                              className: `plt-chip${form.taskType === type ? ' active' : ''}`,
                              disabled: busy,
                              'data-tip': `任务类型：${type}`,
                              onClick: () => setForm({ ...form, taskType: type }),
                            },
                            h('span', { className: 'plt-chip-ico' }, h(ModeIcon, { kind: type, size: 13 })),
                            h('span', { className: 'plt-chip-txt' }, type),
                          ),
                        )
                        nodes.push(h('span', { key: `seg-${type}`, className: 'plt-seg' }, seg))
                      })
                      // 拆解模式：紧贴在「仅回答」右侧，用一个「+」连起来，
                      // 表明它不是类型之一，而是叠加在已选类型上的开关。
                      nodes.push(
                        h(
                          'span',
                          { key: 'seg-split', className: 'plt-seg' },
                          h('span', { key: 'op-split', className: 'plt-op', 'aria-hidden': 'true' }, '+'),
                          h(
                            'button',
                            {
                              key: 'split',
                              type: 'button',
                              className: `plt-chip plt-chip-split${splitMode ? ' active' : ''}`,
                              disabled: busy || splitting,
                              'aria-pressed': splitMode ? 'true' : 'false',
                              'aria-label': '拆解模式（叠加开关，可与其他任务类型同时生效）',
                              // id=363：气泡里带上「这一拆会用哪个模型」。拆解是唯一真调模型的动作，
                              // 而模型的选择以前完全不可见 —— 用户只能靠「拆出来才知道」。
                              // 目录还没回来（modelState.selection 为 null）时这句不出现，
                              // 不写「未知模型」那种更吓人的占位。
                              'data-tip': (() => {
                                const who = modelState.selection === null
                                  ? ''
                                  : `（模型 ${modelState.selection.model}）`
                                return splitMode
                                  ? `拆解模式已开启：发送时按项目情况自动拆成多条，落在「${draftMode ? '草稿' : '待执行'}」${who}（点击关闭）`
                                  : `开启拆解模式：发送时按项目情况把这段话拆成几条${draftMode ? '草稿' : '待执行任务'}${who}`
                              })(),
                              onClick: () => setSplitMode(!splitMode),
                            },
                            h('span', { className: 'plt-chip-ico' }, h(SplitIcon, { size: 13 })),
                            h('span', { className: 'plt-chip-txt' }, '拆解'),
                          ),
                        ),
                      )
                      return nodes
                    })(),
                  ),
                  // 深入开关（在草稿开关左侧，同款圆形造型）：默认不选中；
                  // 点亮后「发送」会把输入框里的任务改写为「要求做深」的提示词。
                  // id=262：草稿模式下深入本来就不生效（草稿只存原话），以前按钮照样能点、
                  // tip 照样承诺「会改写」，用户点了却发现什么都没变。现在直接置灰并说明原因。
                  h(
                    'button',
                    {
                      type: 'button',
                      className: `plt-deep-toggle${deepMode ? ' on' : ''}`,
                      disabled: busy || draftMode,
                      'aria-pressed': deepMode ? 'true' : 'false',
                      'aria-disabled': draftMode ? 'true' : undefined,
                      'data-tip': draftMode
                        ? '草稿模式只存原话、不改写提示词，先关掉草稿才能用深入模式'
                        : deepMode
                          ? splitMode
                            ? '深入模式已开启：拆解时要求把每一条子任务都做深（点击关闭）'
                            : '深入模式已开启：发送时会改写提示词，要求把任务做深（点击关闭）'
                          : splitMode
                            ? '开启深入模式：拆解时要求把每一条子任务都做深'
                            : '开启深入模式：发送时自动把任务改写成「做深而不是做大」的提示词',
                      'aria-label': '深入模式',
                      onClick: () => setDeepMode(!deepMode),
                    },
                    h(DeepIcon, { size: 15 }),
                  ),
                  // 草稿开关（id=106：放在发送按钮左侧，发送键同款圆形造型）：
                  // 平时灰圈不点亮；点亮后「发送」不再进待执行，而是把这条推到「草稿」组。
                  h(
                    'button',
                    {
                      type: 'button',
                      className: `plt-draft-toggle${draftMode ? ' on' : ''}`,
                      disabled: busy,
                      'aria-pressed': draftMode ? 'true' : 'false',
                      'data-tip': draftMode
                        ? '草稿模式已开启：发送将存入「草稿」组（点击关闭）'
                        : '开启草稿模式：发送不再排入待执行，只存进「草稿」组',
                      'aria-label': '草稿模式',
                      onClick: () => setDraftMode(!draftMode),
                    },
                    h(DraftIcon, { size: 15 }),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'plt-send',
                      disabled: busy || splitting,
                      'data-tip': splitting
                        ? '正在拆解，请稍候…'
                        : splitMode
                          ? `拆解成多条，落在「${draftMode ? '草稿' : '待执行'}」（Shift+Enter）`
                          : draftMode
                            ? '存入草稿（Shift+Enter）'
                            : '提交（Shift+Enter）',
                      'aria-label': splitMode ? (draftMode ? '拆解成草稿' : '拆解成待执行') : draftMode ? '存入草稿' : '提交计划',
                      onClick: append,
                    },
                    splitting ? h(SpinnerIcon, { size: 15 }) : h(SendIcon, { size: 15 }),
                  ),
                ),
              ),
            )
          : null,
        h(
          'div',
          { className: 'plt-foot' },
          h(
            'span',
            { className: 'plt-foot-text', 'data-tip': state.data?.planPath ?? '.plan/plan.json' },
            state.data?.planPath ?? '.plan/plan.json',
            // 技能是插件内置的虚拟技能（`ctx.skills.register`），不落到项目目录，
            // 所以不再有「未创建 / 已就绪」之分，也不需要任何同步入口。
            ' · 技能内置',
          ),
        ),

        showInit ? h(InitDialog, { busy, onInit: doInit, onClose: () => setShowInit(false) }) : null,
        // 拆解遮罩：点发送那一刻就盖上来（splitting 在 await 之前就已置 true）。
        // pointer-events:none —— 只提示、不拦点击，侧边栏其它按钮照常可用。
        splitting
          ? h(
              'div',
              { className: 'plt-split-mask', 'aria-live': 'polite', 'aria-busy': 'true' },
              h(
                'div',
                { className: 'plt-split-card' },
                // id=213：卡片整体放大一档，转圈图标跟着从 15 抬到 18，免得看着头重脚轻。
                h(SpinnerIcon, { size: 18 }),
                h(
                  'span',
                  { className: 'plt-split-text' },
                  h('strong', null, '正在拆解…'),
                  h('span', { className: 'plt-split-hint' }, draftMode ? '产物将落在草稿组' : '产物将落在待执行组'),
                ),
              ),
            )
          : null,
      )
    }
