    function PlanTasksTab(props) {
      const scope = props.scope ?? {}
      const ctx = props.ctx
      const sessionId = scope.sessionId ?? ''
      const cwd = scope.cwd ?? ''
      // 页签是否真的在前台可见。better-sidebar 的语义是「当前页签且右侧栏展开」，
      // 不可见时继续轮询纯属白烧流量与渲染。
      const visible = props.visible !== false
      // id=384：payload 必须**稳定引用**，否则「干完一条不派下一条」。
      //
      // 这是一个隐蔽的连锁反应，三步：
      //   1. 这里原来是 `const payload = { sessionId, cwd }` —— 每次渲染都新建一个对象；
      //   2. dispatchNext 的依赖数组里有 payload，于是它每次渲染都是新函数；
      //   3. 派发 effect 的依赖里有 dispatchNext，于是**每次渲染都会重跑 effect**：
      //      重跑 → cleanup 执行 → `if (!started) clearTimeout(timer)` → 定时器被取消。
      //      而面板在执行期间本来就在不停重渲染（轮询 sync、agentRunning、notice 计时器），
      //      DISPATCH_SETTLE_MS（1.2s）几乎总会被下一次渲染打断。
      //      结果就是：计时器永远走不到点，dispatchNext 永远不被调用 ——
      //      用户看到的现象正是「干完一个任务后没有自动下发下一个」。
      //
      // 用 useMemo 固定：sessionId / cwd 不变时，payload 是同一个对象引用，
      // dispatchNext 与 effect 也就不再抖动。
      //
      // 注意：**不能**只把 dispatchNext 的依赖改成 [] 来「解决」——
      // 那样它会永久捕获首次渲染的 payload，切会话后会把任务派进旧会话。
      // 这里修的是源头（引用不稳定），不是把症状盖住。
      const payload = React.useMemo(() => ({ sessionId, cwd }), [sessionId, cwd])
      // 输入框文本等面板状态按项目根目录隔离存放，刷新 / 重新挂载都不丢。
      const storeKey = `dsh-plan-tasks:${cwd || 'default'}`

      // id=405：这个函数原来叫 readDraft —— 名字里的「Draft」指的是「输入框草稿」，
      // 与草稿模式无关。但草稿模式删除后，这个名字会让人误以为它读的是草稿开关状态。
      // 改成 readSaved：它读的就是「面板上次保存的状态」，与草稿没有任何关系。
      const readSaved = () => {
        try {
          const raw = window.localStorage.getItem(storeKey)
          if (raw === null) return null
          const parsed = JSON.parse(raw)
          return parsed !== null && typeof parsed === 'object' ? parsed : null
        } catch {
          return null
        }
      }
      const saved = readSaved()

      const [state, setState] = React.useState({ loading: true, error: '', data: null })
      // 统一悬浮提示（id=249）：气泡挂在面板根上做事件委托，这里只提供根节点。
      // 250 会把各处原生 title 换成 data-tip，届时不用再动这一行。
      const rootRef = React.useRef(null)
      useTipLayer(rootRef)
      const [openId, setOpenId] = React.useState(saved?.openId ?? null)
      const [busy, setBusy] = React.useState(false)
      const [showInit, setShowInit] = React.useState(false)
      // id=405：**草稿模式整体移除**（题面：找出草稿模式的所有 UI 承载并删除，
      // 保证界面不再出现任何草稿相关元素）。
      // 原来这里有一个 draftMode 开关，点亮后「发送」把内容推进「草稿」组。
      // 现在没有草稿这个概念了：提交一律进待执行，不再有第二个落点。
      // 深入模式：点亮后「发送」会把输入框里的任务包装成一段要求「重写并做深」的提示词。
      const [deepMode, setDeepMode] = React.useState(saved?.deepMode === true)
      // 拆解模式：点亮后「发送」不直接落一条，而是交给宿主按项目情况拆成多条（落进待执行）。
      const [splitMode, setSplitMode] = React.useState(saved?.splitMode === true)
      // 拆解是异步 LLM 调用，比 append 慢得多，单独做「正在拆解…」的进度提示。
      const [splitting, setSplitting] = React.useState(false)
      // id=wZIKdd：顶栏的「自动确认」开关已按用户要求整体删除。
      // 它原本是个**空壳功能** —— settings.json 里存了 autoConfirm，
      // 但没有任何业务代码读它来执行自动审核（approveBatch 只看 backupBeforeTrim）。
      // 所以删除是干净的：不留行为空洞，也不影响任何既有流程。
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
      // id=397：刚落下的那一条（播一记回弹确认「放好了」）。
      // 用 state 而不是直接改 DOM —— 与旁边两个拖拽状态同一套数据流，
      // 渲染层只管把类名拼上去（见 Item 的 className）。
      // 定时器要留住引用：连续快速拖两次时，后一次必须清掉前一次的 timer，
      // 否则第一次的回弹会在第二次拖拽途中被强行结束（或更糟：把状态清空）。
      const [droppedId, setDroppedId] = React.useState(null)
      const droppedTimerRef = React.useRef(null)
      // 「待审核」组里批量勾选的 id 集合。
      const [picked, setPicked] = React.useState(() => new Set())
      // 「已审核」组里批量勾选的 id 集合（用于批量删除）。
      const [pickedDone, setPickedDone] = React.useState(() => new Set())
      // id=405：草稿组的批量勾选状态随草稿组一并删除。
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
          if (typeof parsed === 'string') {
            // id=405：历史值可能是 'draft'（草稿组曾是可展开的一组）。草稿组已删，
            // 直接返回 'draft' 不会崩，但会让「没有任何组匹配 isOpen」——
            // 表现为刷新后所有组都收起了，用户会以为折叠状态没保存。
            // 归一成 null（明确的「全部收起」）更诚实，也与 id=356 的语义一致。
            return parsed === 'draft' ? null : parsed
          }
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
      // id=384：「这一轮回答结束、但还没派发下一条」的待处理边沿。
      //
      // 为什么需要它（这是「干完一条不派下一条」的第二道保险）：
      // 派发靠 setTimeout 在 running 由 true→false 后等 1.2s 再动作，
      // 而这个 effect 的 cleanup 会取消未到点的定时器。只要结算期内面板重渲染一次
      // 且依赖随之变化，定时器就没了，边沿被白白消费掉 —— 之后再没有任何东西会补派。
      // 固定的引用（payload 用 useMemo）解决了绝大部分情况，但 effect 仍可能因
      // 其它原因重跑；有这面旗之后，「边沿还没人处理」这件事本身是可见的，
      // 下一次 effect 跑起来（无论因为什么）都能把它捡回来。
      const pendingEdgeRef = React.useRef(false)
      // 当前挂着的派发定时器（id=384）。用来避免「每次重渲染都重新挂一个」——
      // 那会把结算期无限推后，症状与「定时器被取消」相同（永远不派）。
      const dispatchTimerRef = React.useRef(null)
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

      // 输入框草稿 / 展开项 / 自动刷新开关 / 深入模式 / 拆解模式，任何一项变化都落一次本地存储。
      // id=405：写入是「白名单式」的（显式列出字段，不是整体展开旧对象），
      // 所以老用户 localStorage 里残留的 draftMode 字段会在下一次写入时自然消失，
      // 不需要专门写一段清理代码。
      React.useEffect(() => {
        try {
          window.localStorage.setItem(storeKey, JSON.stringify({ ...form, openId, auto, deepMode, splitMode }))
        } catch {
          /* 隐私模式下写不进去就算了 */
        }
      }, [storeKey, form, openId, auto, deepMode, splitMode])

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
      // （待执行 → 待审核 → 已审核，或者退回）就在新分组里播一遍浮起动画。
      // 用数据指纹做 useMemo 依赖：自动刷新拿回一模一样的数据时不会重播。
      const groupOfItem = (it) => {
        // id=405：草稿组已移除，不再有 'draft' 这一档。
        if (it.execute === true) return it.review === true ? 'reviewed' : 'unreviewed'
        return 'todo'
      }
      const liveItems = state.data?.items ?? []
      // id=89-D：派发记录（由宿主 read 下发）。「执行中」靠它与条目 id 关联判定。
      // 每次轮询都重算 —— 派发记录一变（这轮投完了 / 下一条被投），
      // 状态立刻就跟着变，不会出现「本次没有派发、界面却显示执行中」的错位。
      // 拿不到时是 undefined，statusOf 会自动退化到只信 startedAt（向后兼容）。
      const delivered = state.data?.delivered
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

      // —— turn 结束上报（id=ImWOun 后续优化）——
      //
      // 为什么要做：宿主的「孤儿回收」原本靠「有没有产出（time / note）」推断
      // 「这一轮有没有跑起来」。于是「模型跑完了、只是没调 q.mjs done」会被误判成
      // 中断 —— 而这是**两个完全不同的信号**被混成了一个。
      //
      // 真正的信号「turn 是否结束」只有客户端有：`sessions.list` 的 running
      // 由 true 翻成 false 就是那一刻。这里在翻转时把它上报给宿主，
      // 宿主写 `turnEndedAt`，孤儿判据优先看这个字段。
      //
      // 为什么用 ref 记上一次而不是直接在 effect 里比：
      // `agentRunning` 是 state，effect 每次变化都会重跑，但我们只关心
      // **true → false** 这一个方向（false → true 是「开始了」，不是结束）。
      const prevRunningRef = React.useRef(false)
      React.useEffect(() => {
        const wasRunning = prevRunningRef.current
        prevRunningRef.current = agentRunning === true
        // 只处理「刚刚结束」这一跳；其余情况（包括首次挂载）一律不动作。
        if (!(wasRunning && agentRunning !== true)) return
        if (typeof sessionId !== 'string' || sessionId === '') return
        // 把所有「已经开始但没完成」的条目都报一遍 —— 正常情况下只有一条，
        // 但并发 / 上一次残留时可能是多条，逐条报比猜一条更稳。
        // 宿主端对同一条是幂等的（已有 turnEndedAt 就不重写）。
        const startedButOpen = (items ?? [])
          .filter(
            (it) =>
              it !== null
              && typeof it === 'object'
              && it.execute !== true
              && it.failed !== true
              && typeof it.startedAt === 'string'
              && it.startedAt !== ''
              && (typeof it.turnEndedAt !== 'string' || it.turnEndedAt === ''),
          )
          .map((it) => it.id)
        for (const id of startedButOpen) {
          // 失败不打扰用户：这只是给宿主补一个判据字段，不是主操作。
          // 报不上去最坏是退回「按产出 + 宽限」的老判据，不会更糟。
          call('markTurnEnd', { ...payload, id }).catch(() => null)
        }
      }, [agentRunning, items, sessionId])

      // 状态兜底：模型已经开始干活，但还没把 startedAt 写进 plan.json 的那几秒，
      // 把「待执行」里排在最前面的那条先按「执行中」展示，避免「AI 在跑，列表全写待执行」。
      // 模型一旦回填 startedAt，这里会自动让位给真实状态。
      const impliedRunningId = (() => {
        if (agentRunning !== true) return null
        const first = items.find(
          (it) => it.execute !== true && it.failed !== true && (typeof it.startedAt !== 'string' || it.startedAt === ''),
        )
        return first === undefined ? null : first.id
      })()

      // 「正在执行几条」的唯一口径：和列表里那些显示成「执行中」标签的条目逐条对齐。
      // 之前这里只数「有 startedAt 的待执行」，而界面上还会把排在最前面的那条
      // 还没写 startedAt 的待执行也显示成「执行中」（impliedRunning），
      // 于是会话在跑、模型还没回填的那几秒，上方写 0 条、下面却有一条「执行中」。
      // 现在统一交给 statusOf，两边不可能再对不上。
      // id=233：statusOf 把 interrupted 排在 running 之前，所以被中断的条目不会再被数进来。
      const runningCount = items.filter((it) => statusOf(it, impliedRunningId === it.id, delivered).key === 'running').length

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
      const pendingCount = items.filter((it) => it.execute !== true).length
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
        // 最终提示词统一由 composePrompt 拼（id=262）：仅回答前缀独占一行、
        // 深入模式先包模板再叠前缀，且自带幂等与 CRLF 归一。以前这段在 append 里手拼，
        // split() 那边另有一套，两处规则迟早走散。
        // id=405：draft 选项已随草稿模式移除，这里不再传它。
        const text = composePrompt({
          text: form.plan,
          taskType: form.taskType,
          deep: deepMode,
        })
        const data = await run(() =>
          // mode 由宿主按 taskType 推（客户端没有模式下拉，form.mode 恒为空串）；
          // 显式传 taskType 就够了，这里保留 mode 字段是为了将来加真下拉时不必改协议。
          call('append', { ...payload, plan: text, mode: form.mode, taskType: form.taskType }),
        )
        if (data !== undefined) {
          // 提交后停留在当前视图：只清空输入框并就地给一条提示，
          // 不展开新计划、不滚动列表、不切换选中项（否则会“跳走”）。
          setForm({ plan: '', mode: form.mode, taskType: form.taskType, expanded: false })
          // id=388：**不再自动展开待执行组**（题面：发送消息时不再自动展开）。
          //
          // 原来这里是 `setOpenGroup(draftMode ? 'draft' : 'todo')`，想让刚提交的
          // 计划立刻可见。但代价是：用户如果正看着「待审核」或「已审核」，
          // 一发消息就被拽回待执行组 —— 分组折叠状态是**用户自己设的视角**，
          // 不该被一次提交改掉。而「刚写进去的那条在哪」其实已经由
          // 下面那句 notice 说明了，不依赖展开。
          // 提交即刷新，并把倒计时拨回起点。
          await sync()
          setTick(AUTO_INTERVAL)
          // 提交后不再自动开工：开工由用户在「待执行」下方的「开始干活」按钮手动触发。
          // id=405：草稿模式移除后，「已存入草稿」这条分支不会再有。
          setNotice(
            deepMode
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
       * id=405：草稿开关已删除，拆解产物一律进待执行。
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
        // id=405：草稿模式移除后，拆解**固定落在待执行**，不再有第二个落点。
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
            // id=405：草稿落点已移除，拆解产物一律进待执行。
            // id=223：这条会带「建议砍掉 / 模型提到了不存在的文件」等附加信息，实测能到 79 字，
            // 默认 3.8 秒读不完，单独给更长时长。上面的「已拆解过了」是短答复，仍走默认。
            // id=262：深入模式下补一句，否则用户看不出这个开关到底做了什么。
            setNotice(
              `已拆解 ${count} 条到待执行${deepMode ? '（深入）' : ''}${tips.length > 0 ? ` · ${tips.join(' · ')}` : ''}`,
              NOTICE_LONG_MS,
            )
          }
          setForm({ plan: '', mode: form.mode, taskType: form.taskType, expanded: false })
          // id=388：同样不再自动展开（原因见 submit 那段注释）。
          // 拆解会一次落 N 条到待执行，但「落了几条」notice 里已经写了
          //（`已拆解 N 条到待执行…`），不需要再靠切分组来表达。
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
          (it) => it.interrupted === true && it.execute !== true,
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
            // 被「停后」拦下时要说一句，否则用户只看到任务停了、没有任何解释。
            // 其他情况（换会话 / 暂停 / 又跑起来）本来就有各自的提示或天然可见的状态，不重复。
            if (pauseAfterDoneRef.current === true) {
              // id=6Gs9v1-C：文案跟着按钮一起改（「停后」/「继续」），
              // 否则提示里说「完成后暂停」、按钮上写着「停后」，用户要自己猜是不是同一个东西。
              setNotice('已完成，按「停后」停在空闲；点「继续」可恢复派发', NOTICE_LONG_MS)
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
          pendingEdgeRef.current = false
          return undefined
        }
        if (pausedByUserRef.current === true) return undefined
        // id=384：两种进入方式——
        //   · 正常边沿：上一帧在跑、这一帧停了；
        //   · 补派：上一帧就已经停了，但那次边沿的定时器被 cleanup 取消了
        //     （pendingEdgeRef 仍是 true）。这是「干完一条不派下一条」的修复核心：
        //     即使定时器没走到点，这件事仍然记着，下一次 effect 会重新挂上。
        const isEdge = was === true
        const isResume = was !== true && pendingEdgeRef.current === true
        if (!isEdge && !isResume) return undefined
        // 已经有定时器在跑就别重复挂：否则每次重渲染都把计时器推后 1.2s，
        // 结算期永远走不完（这和「定时器被取消」是同一类症状，只是换了成因）。
        if (dispatchTimerRef.current !== null) return undefined
        // 这一轮已经派过（dispatchedRef）：running 会抖，别连派；
        // 队首已派发但还没 done（reason inflight）：不跳到后面的条目，短重试等回填；
        // 队列空了：dispatch 自己会返回 empty（这些判定都在 dispatchNext 里）。
        const epoch = dispatchEpochRef.current
        pendingEdgeRef.current = true
        let started = false
        const timer = window.setTimeout(() => {
          started = true
          dispatchTimerRef.current = null
          pendingEdgeRef.current = false
          void dispatchNext(undefined, epoch)
        }, DISPATCH_SETTLE_MS)
        dispatchTimerRef.current = timer
        return () => {
          // 请求已经发出就别清：prompt 会把 running 拉回 true，cleanup 若把结果扔掉，
          // 下一条其实发出去了，面板却没有任何「已派发」提示。
          if (!started) {
            window.clearTimeout(timer)
            if (dispatchTimerRef.current === timer) dispatchTimerRef.current = null
            // 注意：这里**不清** pendingEdgeRef —— 正是为了让下一轮 effect 能补派。
          }
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
          // id=405：原来这里先排除草稿项；草稿组移除后不必再判。
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
          // id=405：草稿段已删（草稿组不存在，没有要排在待执行之前的条目）。
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
        const todo = (state.data?.items ?? []).filter((it) => it.execute !== true)
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
        const todo = (state.data?.items ?? []).filter((it) => it.execute !== true)
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
          return it !== undefined && statusOf(it, impliedRunningId === it.id, delivered).key === 'running'
        })
        order.splice(runningIndex >= 0 ? runningIndex + 1 : 0, 0, id)
        await commitOrder(order)
      }


      // 本地打补丁：只就地更新这一条，不重排、不滚动、不改变展开项。
      const patch = async (id, value) => {
        // id=380：**删掉了「审核通过后自动展开下一条待审核」**。
        //
        // 原来这里先算出 nextUnreviewed（审核完这一条就离开待审核组，于是把它后面
        // 那条设为展开），落盘后再 setOpenId(nextUnreviewed) + setOpenGroup('unreviewed')。
        //
        // 为什么要删：审核是一个**逐条扫读**的动作，用户的眼睛停在自己刚点的那一行。
        // 自动展开下一条会同时做三件用户没要求的事 —— 把下一张卡撑开、把刚审的那张
        // 收起来、列表整体位移一段。连续点几条时每点一次画面就重排一次，
        // 很容易点错行；而且「我正在看的那条突然缩起来了」比「要多点一下」更烦人。
        // 题面也是这个意思：只删自动展开，别的一律不动。
        //
        // 删掉之后保留的行为（逐条确认过，都没动）：
        //   · 数据流转 —— call('update') 与乐观合并（setState 那一段）原样；
        //   · 列表刷新 —— 用户的通过/取消都照旧生效（合并后重渲染）；
        //   · 通知 —— `已审核通过 #id` 等提示一字未改；
        //   · 展开项**失效时的清理** —— 见下面 remainingUnreviewed 那段：
        //     审完这一条后待审核空了，仍会把正展开的那条摘掉（它已经不在组里了，
        //     留着展开一个看不见的条目没有意义）。这不是「自动展开」，是清理，
        //     与题面要删的不是同一件事。
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
          // id=380：只保留「摘掉失效的展开项」这一半，自动展开那一支已删除。
          // setOpenGroup('unreviewed') 也一并没了 —— 它原本只是为「展开下一条」
          // 服务（保证新展开项所在的分组是打开着的）；既然不再展开，就没有
          // 「顺手把分组展开」的理由了，否则点一下通过还会把收起的待审核组拽开。
          if (reviewed && remainingUnreviewed === 0) {
            setOpenId(null)
          }
          if (!silent) {
            setNotice(
              reviewed
                ? `已审核通过 #${id}`
                : value.review === false
                  ? `已取消审核 #${id}`
                  // id=405：这里原来是「已保存草稿 #<id>」—— 它对应的是「就地编辑草稿正文」
                  // 那条路径（value.plan 是字符串）。草稿编辑框已删除，不再有这种调用，
                  // 但分支留着会误导（读起来像「还能存草稿」）。改成中性的「已更新正文」。
                  : typeof value.plan === 'string'
                    ? `已更新正文 #${id}`
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
          // id=405：这里原来还要从 pickedDraft 里剪掉这个 id。
          // pickedDraft 已随草稿组删除，剩下这一句会在删除任何计划时抛 ReferenceError
          // （61-F 全目录复查时发现 —— 前面的测试只看语法与引用计数，抓不到运行时未定义）。
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

      /** 批量删除「已审核」组里勾选的条目。正在执行的会被宿主跳过。 */
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
          // id=405：setPickedDraft(new Set()) 同理已删（草稿组不存在）。

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
       * id=391：「待审核自动通过条数」下拉与它的 change 一起删除了
       *（题面：取消待审核的自动审核机制，移除代码和下拉选项）。
       *
       * 原来这里有 `changeAutoReviewLimit`，写回 `autoReviewLimit` 后宿主会立刻
       * 补一轮自动通过。现在审核是 100% 人工动作 —— 待审核有多少条就显示多少条，
       * 不会因为超过某个阈值而悄悄少掉几条。
       *
       * 删掉它顺带解决一个老问题：那个下拉是待审核组头里唯一的 `<select>`，
       * 组头本来就只有一行高，它的 26px 高度一直在给标题施压。
       */

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
        // id=405：草稿组的勾选剪枝随草稿组删除（setPickedDraft 已不存在）。
      }, [state.data])

      return h(
        'div',
        // id=71-D：原来这里还带 style: { position: 'relative' } ——
        // 而 .plt-root 的 CSS 规则里本来就有 position:relative（10-topbar.js），
        // 内联那份是纯冗余。删掉后定位行为不变。
        { className: 'plt-root', ref: rootRef },
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
                  ? h(SpinnerIcon, { size: 15 })
                  : h(PauseIcon, { size: 15 })
                : sending
                  ? h(SpinnerIcon, { size: 15 })
                  : h(PlayIcon, { size: 15 }),
              // id=88-B：文案单独包一层并带类名，窄屏（≤300px）时整段收起、只留图标。
              // 类名按当前身份二选一，方便样式分别定位，也方便调试时看出此刻是谁。
              h('span', { className: showPause ? 'plt-pause-sub' : 'plt-start-sub' }, showPause
                ? pausingNow ? '暂停中' : '暂停'
                : sending ? '发送中…' : pausedIdle ? '继续' : '开始'),
            )
          })(),
        // id=377：「停后」开关 —— 顶栏、紧跟「暂停」按钮之后。
        //
        // id=6Gs9v1-A：从待执行组头搬到这里。原先放组头是因为「最右端已被条数
        // 统计占着，插一个宽度会变的开关会打散那条对齐线」；搬到顶栏后这个顾虑
        // 不再存在，顶栏本来就是一行动作按钮。
        //
        // 显隐：**只在有任务正在执行时渲染**，判据是
        // `agentRunning === true || pausing === true` —— 与相邻那颗「暂停」按钮
        // 的 showPause 表达式完全一致，所以两者永远同进同出。
        //（注意：不能用组头那个 `isRunning`，它活在 groups.map 的闭包里，顶栏读不到；
        //  也不能用 `showPause`，它定义在下面那个 IIFE 内部。这两次都是踩过的坑。）
        //
        // 文案（id=6Gs9v1-C）：关闭态「停后」，开启态「继续」——
        // **都是 2 字**，与「开始」「暂停」「继续」「刷新」「自动」同一节奏。
        // 之前是「完成后暂停」(5 字) /「继续执行」(4 字)，一行里混着 2 字和 5 字，
        // 视觉上像「一排按钮旁边挂了个标签」。
        // 短文案省下的字由下面的 title 补回来。
        //
        // title（题面要求逐字）：解释这个开关到底做什么。
        // 同时也用 data-tip —— 这个插件的气泡提示统一走 40-tip.js，
        // 只有 title 的话悬停要等浏览器那个 ~1s 的延迟。
        //
        // ⚠ 判据用 showPause，**不是 isRunning**。
        // 搬家时这一行原本照抄了组头的 `isRunning`，但那是分组遍历里的局部变量
        //（定义在下面 `const isRunning = group.list.some(...)`，属于组头那个闭包），
        // 顶栏作用域根本看不到它 —— 直接渲染就抛 `isRunning is not defined`，
        // 整个插件白屏。这是搬家时**只搬了代码、没搬依赖**的典型事故。
        //
        // 顶栏里与「正在跑」等价的是 showPause（agentRunning || pausing），
        // ⚠ 判据必须是**顶栏作用域里真能读到的东西**。
        //
        // 搬家时这一行原本照抄了组头的 `isRunning`，但那是分组遍历里的局部变量
        //（`const isRunning = group.list.some(...)`，活在组头那个闭包里），
        // 顶栏看不到它 —— 一渲染就抛 `isRunning is not defined`，整个插件白屏。
        //
        // 也不能用 `showPause`：它定义在下面那个 IIFE 的**内部**，出了 `})()` 就没了。
        //（我第二次改正是这么写的，同样是 out-of-scope，只是报错点换了个地方。）
        //
        // 顶栏这里能直接读的组件级 state 只有 agentRunning / pausing。
        // 判据取 `agentRunning === true || pausing === true` —— 与 IIFE 里 showPause
        // 的表达式**完全一致**，所以「暂停按钮显示着」与「开关出现」永远同进同出。
        (agentRunning === true || pausing === true)
          ? h(
              'button',
              {
                // id=6Gs9v1-B：**直接复用 .plt-btn** —— 与相邻的「开始/暂停」同一套
                // 高度 / 圆角 / 字号 / 内边距 / 换行规则，不再自己定一份尺寸。
                // .plt-auto-pause 只保留它独有的部分（开关配色、圆点、on 态），
                // 尺寸与形状一律交给 .plt-btn，两边永远不会走散。
                className: `plt-btn plt-auto-pause${pauseAfterDone ? ' on' : ''}`,
                type: 'button',
                // 组头整行是展开/收起的热区，开关必须自己吃掉点击。
                // id=379：走统一写入口 —— 它同步写 ref（派发回调读的是 ref），
                // 并在拨回「继续执行」时立刻恢复派发。
                onClick: (e) => {
                  e.stopPropagation()
                  togglePauseAfterDone()
                },
                // id=6Gs9v1-C：**文案统一改成两字**，与同组按钮同节奏。
                //
                // 原先是「完成后暂停」（5 字）/「继续执行」（4 字），而旁边的
                // 「开始」「暂停」「继续」「刷新」「自动」全是 2 字 —— 一行里
                // 混着 2 字和 5 字，视觉上是「一排按钮 + 一个标签」，不像同类控件。
                //
                // 新文案：关 =「停后」（停止后续）、开 =「继续」。
                // 两者都 2 字，与「暂停」等长；含义靠下面这条 title 兜住。
                // 「停后」单独看略省略，所以 title 必须写清「停的是什么」——
                // 这也是题面要求「同步更新 title / aria-label」的原因：
                // 短文案省下的字，要在说明里补回来。
                title: '开启后：当前任务执行完就停下，不再自动派发下一条（「继续」可恢复）',
                'data-tip': '开启后：当前任务执行完就停下，不再自动派发下一条（「继续」可恢复）',
                // aria-label 用完整语义，读屏用户没有视觉上下文，
                // 不跟着按钮表面那两个字走。
                'aria-label': '完成后停止后续任务',
                // 读屏要的是「当前是开还是关」，不能只靠文案变化
                //（「停后 / 继续」两种文案都不是 on/off 本身）。
                'aria-pressed': pauseAfterDone === true,
              },
              // 小圆点承担开关状态：与顶栏那颗「自动刷新」（.plt-auto .plt-dot）
              // 同一套视觉语言 —— 亮起 = 开，灰点 = 关。不新造一个 toggle 皮肤。
              h('span', { className: 'plt-dot', 'aria-hidden': 'true' }),
              h('span', { className: 'plt-auto-pause-txt' }, pauseAfterDone ? '继续' : '停后'),
            )
          : null,
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
                      /**
                       * 列表排序口径（id=77-C）：**只由 order 决定**。
                       *
                       * order 升序；order 相同时按 id 的**字符串**比较兜底。
                       *
                       * 为什么不用 `a.id - b.id` / `Number(id.split('-')[0])`：
                       * 77-B 之后 id 是 6 位随机串，两种写法都会得到 NaN，
                       * 而 NaN 参与的比较不满足反对称性 —— 排序结果「未定义」。
                       *
                       * 为什么删掉原来的时间戳排序：
                       * 已审核组原来按 finishedAt 降序（最近完成的在上）、待审核组按
                       * startedAt 升序（先完成的在上），都写了不少注释解释「为什么要
                       * 按时间而不按来源顺序」。但那是「用时间模拟一个顺序」——
                       * 而顺序本来就应该由 order 这个字段唯一决定，否则同一份数据
                       * 在不同时间点刷新会排出不同结果。
                       * 现在统一按 order：用户拖成什么样，就是什么样。
                       */
                      const byTaskOrder = (a, b) => {
                        const oa = Number.isFinite(a?.order) ? Number(a.order) : 0
                        const ob = Number.isFinite(b?.order) ? Number(b.order) : 0
                        if (oa !== ob) return oa - ob
                        const ia = String(a?.id ?? '')
                        const ib = String(b?.id ?? '')
                        if (ia === ib) return 0
                        return ia < ib ? -1 : 1
                      }
                      // id=6-A：**已审核组恢复「审核时间倒序」**（最新审核的在最上）。
                      //
                      // 这条要求与 id=338 同一个诉求 —— 338 当初就实现了它，
                      // 后来 id=77-C 把三组排序统一成 `byTaskOrder`（order 升序），
                      // 顺带把这段删了。现在按本条恢复，但**只对已审核组生效**，
                      // 另外两组保持 byTaskOrder（用户拖拽的顺序不受影响）。
                      //
                      // 为什么已审核组要特殊：它的顺序对用户没有操作意义
                      //（已审核条目不可拖拽，drag: false），用户翻它是想找「刚审的」，
                      // 而 order 是提交时分配的，跟审核先后无关 —— 按 order 排会让
                      // 刚审完的一条沉到中间。
                      //
                      // 时间口径（沿用 338 的设计）：
                      //   finishedAt ──> createdAt ──> id 字符串
                      // finishedAt 是「审核通过那一刻」的权威字段（见 archive.js:37）。
                      // 拆解批次取 children 里**最晚**的完成时间 —— 整批审完才算这条完成。
                      const reviewedTimeOf = (it) => {
                        const pick = (x) => {
                          const f = Date.parse(String(x?.finishedAt ?? ''))
                          if (Number.isFinite(f)) return f
                          const c = Date.parse(String(x?.createdAt ?? ''))
                          return Number.isFinite(c) ? c : null
                        }
                        const kids = Array.isArray(it?.children) ? it.children : []
                        // 拆解批次：取最晚完成的那个子任务
                        if (kids.length > 0) {
                          const times = kids.map(pick).filter((x) => x !== null)
                          if (times.length > 0) return Math.max(...times)
                        }
                        return pick(it)
                      }
                      /** 已审核组：审核时间倒序；都没有时间时退回 id 倒序。 */
                      const byReviewedDesc = (a, b) => {
                        const ta = reviewedTimeOf(a)
                        const tb = reviewedTimeOf(b)
                        // 有时间的一律排在没时间的之前（没时间的沉底，不占顶部）
                        if (ta !== null && tb !== null && ta !== tb) return tb - ta
                        if (ta !== null && tb === null) return -1
                        if (ta === null && tb !== null) return 1
                        // 都无时间（或同一毫秒）：id 倒序兜底，保证顺序稳定
                        const ia = String(a?.id ?? '')
                        const ib = String(b?.id ?? '')
                        if (ia === ib) return 0
                        return ia > ib ? -1 : 1
                      }
                      const doneReviewed = items
                        .filter((it) => {
                          const batch = batchOf(it)
                          if (batch !== null) return batch.allReviewed
                          return it.execute === true && it.review === true
                        })
                        // id=6-A：排序作用在 **filter 之后的完整数据集** 上。
                        // 本组件没有分页/截断（全项目搜不到 slice/limit 分页），
                        // 所以「先排全量再渲染」天然成立，不存在「只排当前页」的问题。
                        .sort(byReviewedDesc)
                      // 待审核组同样按 byTaskOrder（order 升序 + id 字符串兜底）。
                      //
                      // id=77-C 删掉了这里的 pendingTimeOf / pendingRank：
                      // 那套按 startedAt → createdAt 排序是为了解决 id=403 报的
                      // 「待审核继承了归档的倒序、后完成的反而在上面」——
                      // 但那是**用时间模拟一个顺序**。现在顺序由 order 唯一决定，
                      // 「先完成的在上」变成「用户拖成什么样就是什么样」，
                      // 同一份数据在任何时间点刷新都排出同样结果。
                      //
                      // 已审核组同理（原 reviewedTimeOf 按 finishedAt 降序）。
                      // 两个组现在共用同一个比较器，不再一个倒序一个正序 ——
                      // 那种"方向差异"本身就是用时间当排序依据的副作用。
                      const donePending = items.filter((it) => {
                        const batch = batchOf(it)
                        if (batch !== null) return batch.allDone && batch.allReviewed !== true
                        return it.execute === true && it.review !== true
                      // 正序：时间早的在前；同一时刻用 id 递增兜底，保证顺序稳定
                      //（不稳定排序会让两条同时间戳的条目在每次轮询时互换位置）。
                      }).sort(byTaskOrder)
                      // id=405：草稿组已移除，待执行组不再需要排除草稿条目。
                      const todoList = items.filter((it) => {
                        const batch = batchOf(it)
                        if (batch !== null) return batch.allDone !== true
                        return it.execute !== true
                      })
                      // id=381：这里原来每个组还带一个 `defaultOpen` 字段
                      //（reviewed/unreviewed: false，todo/draft: true），但**全项目没有任何地方读它** ——
                      // 是个死字段。
                      //
                      // 为什么要删掉而不是留着：它长得就像「默认展开某个组」的初始化写法，
                      // 而实际生效的默认值只有一处 —— openGroup 的 useState 初值（见组件顶部）。
                      // 两处并存时，后来的人改完 `defaultOpen` 发现没反应，才会去翻真正的初值；
                      // 更糟的是照着它的语义去「修」，把 `unreviewed: true` 改成 true 期待
                      // 首个待审核项自动展开 —— 于是又造出本条要清掉的那种行为。
                      // 展开态只有一个来源：openGroup（组）与 openId（条目），
                      // 两者的初值都必须是 null（无默认展开项）。
                      const groups = [
                        { key: 'reviewed', title: '已审核', list: doneReviewed, drag: false, alwaysShow: false, emptyText: '还没有审核通过的计划' },
                        { key: 'unreviewed', title: '待审核', list: donePending, drag: false, alwaysShow: true, emptyText: '暂无待审核内容' },
                        { key: 'todo', title: '待执行', list: todoList, drag: true, alwaysShow: true, emptyText: '待执行里没有计划，在下面的输入框写一条。' },
                        // id=405：草稿组已移除（题面：界面不再出现任何草稿相关元素）。
                      ]
                      // id=fzTvER-B：每个组的「序号」——在**已排好序的列表**上算一次，
                      // 渲染时按 id 查。序号是展示用的位置（1 起），与 id 无关。
                      //
                      // 为什么按组算而不是全局算：三个页签各自的列表长度不同，
                      // 用户看到的「第 2 条」是该页签里的第 2 条。全局编号会在
                      // 每个页签里出现跳号（1、3、7），反而更难读。
                      //
                      // 为什么先算成 Map 再传下去：`sequenceOf` 按数组下标递增，
                      // 而渲染时拿到的是单个 item —— 用 Map 查是 O(1)，
                      // 也避免在渲染循环里重复算整份列表。
                      const seqByGroup = new Map()
                      for (const group of groups) {
                        seqByGroup.set(group.key, sequenceMapOf(group.list))
                      }
                      const renderItem = (item, dragEnabled, groupKey) => {
                        // 「待审核」「已审核」两组支持勾选：分别用于批量审核、批量删除。
                        // id=405：草稿组移除后，「批量转待执行」这个用途也不存在了。
                        // 正在执行的条目任何组都不参与勾选。
                        const selectable =
                          (groupKey === 'unreviewed' || groupKey === 'reviewed') &&
                          statusOf(item, false, delivered).key !== 'running'
                        const pickedSet = groupKey === 'reviewed' ? pickedDone : picked
                        const setPickedSet = groupKey === 'reviewed' ? setPickedDone : setPicked
                        // id=fzTvER-B：这一条在所属页签里的位置（1 起）。
                        // 查不到时退回 0 —— 由 Item 决定不渲染序号，
                        // 而不是在这里硬编一个可能错的数字。
                        //
                        // 注意用**原始 id 值**查：`sequenceMapOf` 用的就是 `item.id` 本身，
                        // 数字 id（历史数据）与字符串 id（随机 6 位）各自作为 Map 键，
                        // 这里若先 `String()` 一遍反而查不到历史数字 id。
                        const seqMap = seqByGroup.get(groupKey)
                        const seq = seqMap instanceof Map ? (seqMap.get(item.id) ?? 0) : 0
                        return h(Item, {
                          key: item.id,
                          item,
                          // id=fzTvER-B：展示用序号（1 起，所属页签内）。0 表示查不到。
                          seq,
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
                          // id=89-D：派发记录透传给行组件 —— 「执行中」要靠它与 id 关联判定。
                          delivered,
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
                          // id=405：草稿模式整体移除后，这里原本的两组 prop 一并删掉：
                          //   · onPromote（草稿组专属「转为待执行」）
                          //   · canDemote / onDemote（待执行里的「转为草稿」）
                          // 它们的来源/目的地都是草稿组，草稿没了就不存在可转的组。
                          // 同时删掉 `editable: groupKey === 'draft'` —— 它只对草稿组为 true，
                          // 而草稿组已不存在，留着是一个永远为 false 的死 prop。
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
                          // id=397：刚落下的那一条（播回弹确认）。
                          dropped: droppedId === item.id,
                          onDragStart: () => {
                            setDragId(item.id)
                            setDropId(null)
                            // 新一次拖拽开始：把上一次的回弹状态与它的 timer 都清掉，
                            // 否则上一记回弹会在这里被打断（观感是「刚放下又抖一下」）。
                            if (droppedTimerRef.current !== null) {
                              window.clearTimeout(droppedTimerRef.current)
                              droppedTimerRef.current = null
                            }
                            setDroppedId(null)
                          },
                          onDragOver: () => {
                            if (dragId !== null && dragId !== item.id) setDropId(item.id)
                          },
                          onDrop: () => {
                            // 松手的这一条要播「已落下」回弹（id=397）。
                            // 注意顺序：先记 droppedId 再清 dragId/dropId ——
                            // 三个 state 在同一次事件里批量更新，React 会合成一次渲染，
                            // 所以不存在「先渲染出没有 droppedId 的中间态」的问题。
                            const landed = item.id
                            void moveTo(dragId, item.id)
                            setDragId(null)
                            setDropId(null)
                            if (droppedTimerRef.current !== null) window.clearTimeout(droppedTimerRef.current)
                            setDroppedId(landed)
                            // 320ms 与 CSS 里 plt-dropped 的时长对齐（略多 20ms 余量，
                            // 保证动画先播完再摘类，避免它被截断在半途）。
                            droppedTimerRef.current = window.setTimeout(() => {
                              droppedTimerRef.current = null
                              setDroppedId(null)
                            }, 340)
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
                          const isRunning = group.list.some((it) => statusOf(it, impliedRunningId === it.id, delivered).key === 'running')
                          const pendingIds = group.key === 'unreviewed' ? group.list.map((item) => item.id) : []
                          const allPicked = pendingIds.length > 0 && pendingIds.every((id) => picked.has(id))
                          // 「已审核」组同样支持勾选，用于批量删除。
                          const doneIds = group.key === 'reviewed' ? group.list.map((item) => item.id) : []
                          const allPickedDone = doneIds.length > 0 && doneIds.every((id) => pickedDone.has(id))
                          // （id=405：草稿组的勾选与批量操作已随草稿模式删除。）
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
                              // id=391：「待审核超过 N 条自动通过最旧一条」的下拉已删除
                              //（题面：取消自动审核机制 + 移除下拉选项）。
                              // 待审核组头现在只剩「条数统计」，不再有阈值控件。
                              // 组头因此回归到「名字 + 统计」这一种形状，与其它三组一致 ——
                              // 原来只有待审核组头有一个 <select>，那一行的高度和留白都
                              // 跟别的组对不上，收敛后整列终于齐了。
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
                                    // id=405：草稿组底部那排操作（全选 / 全部删除 / 转待执行）
                                    // 随草稿组一并删除 —— 三个动作的对象都是草稿条目。
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
                              // id=5-D：原文是「叠加开关，可与其他任务类型同时生效」——
                              // 说对了能同时开，但没说清叠加**只改文本深度、不改条数**。
                              // 与深入开关那条 tip 保持同一口径，避免两个按钮各说各话。
                              'aria-label': '拆解模式（可与深入模式同时开启；深入只影响每条写多深，不影响拆成几条）',
                              // id=363：气泡里带上「这一拆会用哪个模型」。拆解是唯一真调模型的动作，
                              // 而模型的选择以前完全不可见 —— 用户只能靠「拆出来才知道」。
                              // 目录还没回来（modelState.selection 为 null）时这句不出现，
                              // 不写「未知模型」那种更吓人的占位。
                              'data-tip': (() => {
                                const who = modelState.selection === null
                                  ? ''
                                  : `（模型 ${modelState.selection.model}）`
                                return splitMode
                                  ? `拆解模式已开启：发送时按项目情况自动拆成多条，落在「待执行」${who}（点击关闭）`
                                  : `开启拆解模式：发送时按项目情况把这段话拆成几条待执行任务${who}`
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
                  // 深入开关（发送键左侧的圆形按钮）：默认不选中；
                  // 点亮后「发送」会把输入框里的任务改写为「要求做深」的提示词。
                  // id=262：草稿模式下深入本来就不生效（草稿只存原话），以前按钮照样能点、
                  // tip 照样承诺「会改写」，用户点了却发现什么都没变。现在直接置灰并说明原因。
                  h(
                    'button',
                    {
                      type: 'button',
                      className: `plt-deep-toggle${deepMode ? ' on' : ''}`,
                      disabled: busy,
                      'aria-pressed': deepMode ? 'true' : 'false',
                      // id=405：原来这里还会因为「草稿模式」置灰 —— 草稿只存原话、深入会改写，
                      // 两者互斥。草稿模式移除后这条互斥消失，深入开关只剩 busy 一个禁用条件。
                      // id=5-D：两个开关同时点亮时，用户最容易误以为「叠加会让拆出来的条数变多」。
                      // 实测（见 docs/toggle-combo-result.md）：条数只由 DECOMPOSE_MIN/SOFT_MAX 决定，
                      // deep 完全不参与；叠加的唯一效果是「每条写得更深」。这句必须说清，
                      // 否则用户点完两个开关、发现还是那几条，会以为开关坏了。
                      'data-tip': deepMode
                          ? splitMode
                            ? '深入模式已开启：拆解时要求把每一条子任务都做深；拆成几条不受它影响（点击关闭）'
                            : '深入模式已开启：发送时会改写提示词，要求把任务做深（点击关闭）'
                          : splitMode
                            ? '开启深入模式：拆解时要求把每一条子任务都做深；拆成几条不受它影响'
                            : '开启深入模式：发送时自动把任务改写成「做深而不是做大」的提示词',
                      // 读屏拿不到上面的长句，这里把叠加语义也带上
                      'aria-label': deepMode ? '深入模式（已开启）' : '深入模式',
                      onClick: () => setDeepMode(!deepMode),
                    },
                    h(DeepIcon, { size: 15 }),
                  ),
                  // id=405：草稿开关按钮（plt-draft-toggle）已删除 ——
                  // 它是草稿模式的唯一入口，草稿组不存在后这个开关没有落点。
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'plt-send',
                      disabled: busy || splitting,
                      // id=405：草稿模式移除后，发送键的文案回到单一含义 ——
                      // 拆解模式说「拆解成多条」，否则说「提交」。
                      'data-tip': splitting
                        ? '正在拆解，请稍候…'
                        : splitMode
                          ? '拆解成多条，落在待执行（Shift+Enter）'
                          : '提交（Shift+Enter）',
                      'aria-label': splitMode ? '拆解成待执行' : '提交计划',
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
                  h('span', { className: 'plt-split-hint' }, '产物将落在待执行组'),
                ),
              ),
            )
          : null,
      )
    }
