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
      const [notice, setNotice] = React.useState('')
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
      const [openGroup, setOpenGroupState] = React.useState(() => {
        try {
          const raw = window.localStorage.getItem(`dsh-plan-tasks:groups:${cwd || 'default'}`)
          if (raw === null) return 'todo'
          const parsed = JSON.parse(raw)
          // 兼容旧版存的对象格式（{todo:true,...}），迁移成单个 key。
          if (typeof parsed === 'string') return parsed
          if (parsed !== null && typeof parsed === 'object') {
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
      // 重启中：整个面板盖一层，等宿主把新进程拉起来后自动刷新页面。
      const [restarting, setRestarting] = React.useState(false)
      const [restartTip, setRestartTip] = React.useState('')
      // 上一次列表数据的指纹，用来跳过「内容没变」的重渲染。
      const lastSignatureRef = React.useRef('')
      // 展开中的条目的正文 / 备注：列表只拿 lite 数据，展开时才按需取全文。
      const [detail, setDetail] = React.useState(null)

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

      const refresh = React.useCallback(async () => {
        const data = await run(() => call('read', payload))
        return data
      }, [run, sessionId, cwd])

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

      const items = state.data?.items ?? []

      // 状态兜底：模型已经开始干活，但还没把 startedAt 写进 plan.json 的那几秒，
      // 把「待执行」里排在最前面的那条先按「执行中」展示，避免「AI 在跑，列表全写待执行」。
      // 模型一旦回填 startedAt，这里会自动让位给真实状态。
      const impliedRunningId = (() => {
        if (agentRunning !== true) return null
        const first = items.find(
          (it) => it.execute !== true && it.draft !== true && (typeof it.startedAt !== 'string' || it.startedAt === ''),
        )
        return first === undefined ? null : first.id
      })()

      // 「正在执行几条」的唯一口径：和列表里那些显示成「执行中」标签的条目逐条对齐。
      // 之前这里只数「有 startedAt 的待执行」，而界面上还会把排在最前面的那条
      // 还没写 startedAt 的待执行也显示成「执行中」（impliedRunning），
      // 于是会话在跑、模型还没回填的那几秒，上方写 0 条、下面却有一条「执行中」。
      // 现在统一交给 statusOf，两边不可能再对不上。
      const runningCount = items.filter((it) => statusOf(it, impliedRunningId === it.id).key === 'running').length

      // 是否有任务正在执行：会话 running（最权威）+ plan.json 的 startedAt + 刚点按钮那一小段。
      const working = agentRunning || runningCount > 0 || starting

      // 自动刷新：按「截止时间」驱动，倒计时只是展示。
      // 旧实现用「倒计时归零」来触发刷新，setInterval 抖动时 left 会停在 1 不归零，
      // 于是界面卡在 1s、实际不再刷新（执行中把间隔压到 1s 时尤其明显）。
      // 现在每次 tick 直接比较 Date.now() 与 deadline，到点就刷新，与倒计时显示解耦。
      // 有任务正在执行（execute 为 false 且已写 startedAt）时用更短的间隔，尽量跟模型进度同步。
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
      const openStamp = (() => {
        if (openId === null) return ''
        const it = (state.data?.items ?? []).find((x) => x.id === openId)
        return it === undefined ? '' : `${it.id}:${it.planLen ?? 0}:${it.noteLen ?? 0}:${it.time ?? 0}`
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
        // 拆解模式：不落一条，交给宿主按项目实际情况拆成 N 条草稿。
        // 与草稿模式天然一致（产物就是草稿），不与深入模式叠加（改写提示词是另一回事）。
        if (splitMode) {
          await split()
          return
        }
        // 按任务类型自动加前缀：仅回答 → 「仅回答：」，目标 → 「/目标 」，修改 → 不加。
        // 草稿不加前缀 —— 它不进执行队列，前缀只会污染存下来的原文。
        const prefix = draftMode ? '' : typePrefix(form.taskType)
        // 深入模式：先把原文包装成「做深」的提示词，再按任务类型加前缀。
        // 草稿不包装也不加前缀 —— 草稿存的是用户原话，等转正/再编辑时再决定。
        const raw = deepMode && !draftMode ? deepPrompt(form.plan) : form.plan
        const text = raw.trimStart().startsWith(prefix.trim()) || prefix === '' ? raw : `${prefix}${raw}`
        const data = await run(() =>
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
        // 拆解落点跟着「草稿」开关走，整段只取一次快照，避免异步期间开关被改。
        const toDraft = draftMode === true
        setSplitting(true)
        setState((prev) => ({ ...prev, error: '' }))
        setNotice('正在按项目情况拆解…')
        try {
          const data = await call(
            'decompose',
            {
              ...payload,
              question: text,
              mode: form.mode,
              taskType: form.taskType,
              draft: toDraft,
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
            setNotice(`已拆解 ${count} 条到${where}${tips.length > 0 ? ` · ${tips.join(' · ')}` : ''}`)
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
       * 真正重启 dsh web。
       * 宿主那边的 restart 会先回包、再 spawn 一个游离 launcher、然后自己退出；
       * 这里随后就不停探活，新进程一上线就刷新页面（cookie 由持久密钥签名，重启后仍有效）。
       */
      const doRestart = async () => {
        if (restarting) return
        setRestarting(true)
        setRestartTip('正在请求重启…')
        try {
          await call('restart', { ...payload })
        } catch (error) {
          // 连接在宿主退出瞬间被掐断是正常的：请求可能已经生效，继续探活。
          const message = error instanceof Error ? error.message : String(error)
          if (!/fetch|network|abort|terminated|socket/i.test(message)) {
            setRestarting(false)
            setState((prev) => ({ ...prev, error: `重启失败：${message}` }))
            return
          }
        }
        setRestartTip('服务正在重启，等待新进程上线…')
        const deadline = Date.now() + 90_000
        let tries = 0
        const tickOnce = async () => {
          if (Date.now() > deadline) {
            setRestarting(false)
            setState((prev) => ({ ...prev, error: '服务没有在 90 秒内重新上线，请手动重启 dsh web' }))
            return
          }
          tries += 1
          try {
            const res = await fetch(`${API_BASE}read`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
              body: JSON.stringify({ ...payload, lite: true }),
            })
            const body = await res.json()
            if (body?.ok === true) {
              setRestartTip('已就绪，正在刷新页面…')
              window.location.reload()
              return
            }
          } catch {
            /* 还没起来，继续等 */
          }
          window.setTimeout(tickOnce, 1000)
        }
        // 先等一下再开始探活，否则探到的还是正要退出的旧进程。
        window.setTimeout(tickOnce, 1500)
      }

      /** 手动开工：把「开始干活」真的发进当前会话（左侧对话里能看到），
       * 由模型按 plan-tasks 技能去取待执行计划。 */
      const startWork = async () => {
        if (starting) return
        setStarting(true)
        try {
          let sent = false
          try {
            sent = await kickoffViaClient(ctx, sessionId, KICKOFF_TEXT)
          } catch (error) {
            sent = false
            if (error instanceof Error && error.message !== '') throw error
          }
          if (!sent) await call('kickoff', { ...payload, text: KICKOFF_TEXT })
          setNotice(`已发送「${KICKOFF_TEXT}」`)
        } catch (error) {
          setState((prev) => ({
            ...prev,
            error: `发送「${KICKOFF_TEXT}」失败：${error instanceof Error ? error.message : String(error)}`,
          }))
        } finally {
          setStarting(false)
        }
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
            await call('update', { ...payload, id, patch: draft ? { draft: true } : { draft: false, clearTime: true } })
          }
          // 乐观地把标记先改进本地数据，让条目立刻跳组，避免等 sync 的那一下闪烁。
          setState((prev) => {
            if (prev.data === null) return prev
            const next = (prev.data.items ?? []).map((it) =>
              list.includes(it.id) ? { ...it, draft: draft, ...(draft ? {} : { startedAt: '', time: 0 }) } : it,
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
          // 审核完这一条后「待审核」是否已经空了：
          // 空了就把这一组自动折叠起来（不再赖在展开态占着整个面板）。
          const remainingUnreviewed = (state.data?.items ?? []).filter(
            (it) => it.execute === true && it.review !== true && it.id !== id,
          ).length
          if (reviewed && remainingUnreviewed === 0) {
            setOpenId(null)
            if (openGroup === 'unreviewed') setOpenGroup(null)
          } else if (reviewed && nextUnreviewed !== null) {
            setOpenId(nextUnreviewed)
            // 分组可能是折叠的，展开项在折叠组里看不见，顺手把它展开。
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
          // 批量通过后「待审核」清空了，就把这一组折叠起来，别占着整个面板。
          const remaining = (state.data?.items ?? []).filter(
            (it) => it.execute === true && it.review !== true && !ids.includes(it.id),
          ).length
          if (remaining === 0) {
            setOpenId(null)
            if (openGroup === 'unreviewed') setOpenGroup(null)
          }
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

      React.useEffect(() => {
        if (notice === '') return undefined
        const timer = setTimeout(() => setNotice(''), 2600)
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
        { className: 'plt-root', style: { position: 'relative' } },
        h(
          'div',
          { className: 'plt-top' },
          h('span', { className: 'plt-title' }, `任务列表 · ${items.length}`),
          // 提交/审核的提示放在「自动刷新」左侧，不再占用下方空间。
          notice !== '' ? h('span', { className: 'plt-notice' }, notice) : null,
          h(
            'button',
            {
              className: `plt-btn plt-auto${auto ? ' on' : ''}`,
              title: auto ? `自动刷新已开启，${tick} 秒后重新读取 plan.json` : '自动刷新已关闭',
              onClick: () => setAuto((prev) => !prev),
            },
            h(
              'span',
              { className: 'plt-dot', 'aria-hidden': 'true' },
            ),
            h('span', null, auto ? `${tick}s` : '自动'),
          ),
          h(
            'button',
            { className: 'plt-btn', disabled: busy, title: '立即重新读取 plan.json', onClick: refresh },
            '刷新',
          ),
          // 重启：改了宿主代码（lib/index.js）后必须整进程重开才生效，这里一键做完。
          h(
            'button',
            {
              className: 'plt-btn plt-restart',
              disabled: busy || restarting,
              title: '重启 dsh web（改过宿主代码后用），完成后页面会自动刷新',
              onClick: (e) => {
                e.stopPropagation()
                void doRestart()
              },
            },
            restarting ? h(SpinnerIcon, { size: 12 }) : null,
            h('span', null, restarting ? '重启中' : '重启'),
          ),
        ),
        state.error !== '' ? h('div', { className: 'plt-err' }, state.error) : null,
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
                      const doneReviewed = items.filter((it) => it.execute === true && it.review === true && it.draft !== true).slice().reverse()
                      const donePending = items.filter((it) => it.execute === true && it.review !== true && it.draft !== true)
                      // 草稿单独成组（绿色、最靠下、贴着输入框）；没有草稿时整组不显示。
                      const draftList = items.filter((it) => it.draft === true)
                      const todoList = items.filter((it) => it.execute !== true && it.draft !== true)
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
                          // 置顶按钮只出现在待执行组。
                          canPin: groupKey === 'todo',
                          onPinTop: () => void pinTop(item.id),
                          // 草稿组专属：单条「转为待执行」+ 正文可直接编辑。
                          onPromote: () => void moveToGroup([item.id], false),
                          // 待执行里还没开工的才允许退回草稿（执行中不给）。
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
                          onPatch: (value) => patch(item.id, value),
                          onRemove: () => remove(item.id),
                        })
                      }
                      return groups
                        .filter((group) => group.alwaysShow === true || group.list.length > 0)
                        .map((group) => {
                          const isOpen = openGroup === group.key
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
                            { key: group.key, className: `plt-group plt-group-${group.key}${isOpen ? ' open' : ''}` },
                            h(
                              'div',
                              {
                                className: `plt-group-h${isOpen ? ' open' : ''}${isOpen ? '' : arriveGroups.has(group.key) ? ' plt-arrive' : ''}`,
                                onClick: () => setOpenGroup(isOpen ? null : group.key),
                              },
                              h('span', { className: 'plt-caret' }, h(CaretIcon, { size: 13 })),
                              h('span', { className: 'plt-group-name' }, group.title),
                              h('span', { className: 'plt-group-count' }, String(group.list.length)),
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
                                            { className: 'plt-check', title: allPicked ? '取消全选' : '全选本组全部' },
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
                                              title: '把勾选的计划一次性审核通过',
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
                                            { className: 'plt-check', title: allPickedDone ? '取消全选' : '全选本组全部' },
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
                                              title: '把勾选的已审核计划一次性删除',
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
                                            { className: 'plt-check', title: allPickedDraft ? '取消全选' : '全选本组全部' },
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
                                              title: '把勾选的草稿一次性删除',
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
                                              title: '把勾选的草稿一次性转为待执行',
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
                                              title:
                                                working
                                                  ? '模型正在干活，等它完成再开始下一条'
                                                  : `向左侧会话发送「${KICKOFF_TEXT}」，开始执行待执行里的计划`,
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
                              title: `任务类型：${type}`,
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
                              title: splitMode
                                ? `拆解模式已开启：发送时按项目情况自动拆成多条，落在「${draftMode ? '草稿' : '待执行'}」（点击关闭）`
                                : `开启拆解模式：发送时按项目情况把这段话拆成几条${draftMode ? '草稿' : '待执行任务'}`,
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
                  h(
                    'button',
                    {
                      type: 'button',
                      className: `plt-deep-toggle${deepMode ? ' on' : ''}`,
                      disabled: busy,
                      'aria-pressed': deepMode ? 'true' : 'false',
                      title: deepMode
                        ? '深入模式已开启：发送时会改写提示词，要求把任务做深（点击关闭）'
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
                      title: draftMode
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
                      title: splitting
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
            { className: 'plt-foot-text', title: state.data?.planPath ?? '.plan/plan.json' },
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
                h(SpinnerIcon, { size: 15 }),
                h(
                  'span',
                  { className: 'plt-split-text' },
                  h('strong', null, '正在拆解…'),
                  h('span', { className: 'plt-split-hint' }, draftMode ? '产物将落在草稿组' : '产物将落在待执行组'),
                ),
              ),
            )
          : null,
        // 重启罩层：盖住整个面板，防止用户在重启过程中继续点按钮。
        restarting
          ? h(
              'div',
              { className: 'plt-mask' },
              h(
                'div',
                { className: 'plt-dialog', onClick: (e) => e.stopPropagation() },
                h('h3', null, '正在重启 dsh web'),
                h('p', null, restartTip, h('br'), h('span', { className: 'plt-restart-tip' }, '宿主代码改动需要整进程重开才生效，页面会在服务就绪后自动刷新。')),
              ),
            )
          : null,
      )
    }
