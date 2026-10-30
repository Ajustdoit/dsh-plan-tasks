    /**
     * 父节点展开后的子任务列表（id=273）。
     *
     * 拆解产物是一条父 + 若干 children：父只当这批的容器，展开后不再画父自己的
     * 「计划 / 备注」，而是把每条子任务按顺序铺开 —— 每行显示自己的标题、正文、状态。
     * 数据优先用 detail 取回的全量 children（列表轮询是 lite 投影：正文截断、备注只留长度），
     * 拿不到就退回列表里那份，至少结构不缺。
     *
     * 子任务不参与拖拽与勾选（宿主 reorder / 批量操作都只认顶层 id），这里也照此：
     * 只读展示 + 每行一个「通过」，一个父批次里就能逐条审完。
     */
    function KidsList(props) {
      const { kids, groupKey, busy, onPatch } = props
      return h(
        'div',
        { className: 'plt-kids-list' },
        kids.map((child) => {
          const status = statusOf(child)
          const durText = fmtDur(child.time)
          const note = String(child.note ?? '')
          // id=322：children 行不再显示 `#id` —— 编号只在父/顶层行有意义（子任务不参与
          // 拖拽、批量、复制提示词，命令行也只会指到父）。但 `data-id` 必须留着：
          // 批量请求与验证脚本靠它定位具体那一条，去掉显示≠去掉身份。
          // id=316：已执行（做完，不论审没审）的子任务要一眼看出来 —— 与未执行项区分，
          // 但不削弱未执行项的强调。用 `.plt-kid-done` 而不是复用 status.key：
          // 「待审核」「已审核」两种都算做完，而它们在状态机里是两个不同的 key。
          const doneKid = child.execute === true
          return h(
            'div',
            { key: child.id, className: `plt-kid ${status.key}${doneKid ? ' plt-kid-done' : ''}`, 'data-id': String(child.id), 'data-done': doneKid ? 'true' : 'false' },
            h(
              'div',
              { className: 'plt-kid-h' },
              // 前置对勾：做完的那一条显示 ✓。槽位对**所有**行都占 12px（id=322）——
              // 编号列删掉之后，如果只有做完的行多出这个图标，两种行的标题起点会差 18px，
              // 纵向扫下来就是锯齿。未做的行只把对勾藏起来（visibility），不占位就没有对齐。
              doneKid
                ? h('span', { className: 'plt-kid-check', 'aria-hidden': 'true' }, '✓')
                : h('span', { className: 'plt-kid-check is-off', 'aria-hidden': 'true' }),
              h(
                'span',
                { className: 'plt-kid-name', 'data-tip': `${child.name}\n\n${child.plan ?? ''}` },
                child.name,
              ),
              durText !== '' && (groupKey === 'unreviewed' || groupKey === 'reviewed')
                ? h('span', { className: 'plt-dur', 'data-tip': `这条任务耗时 ${durText}` }, durText)
                : null,
              child.taskType === '仅回答' || child.taskType === '目标'
                ? h('span', { className: `plt-tag type plt-type-${child.taskType}`, 'data-tip': `任务类型：${child.taskType}` }, h(ModeIcon, { kind: child.taskType, size: 12 }))
                : null,
              // id=274：状态徽标只挂在父级行上（父行显示整批的聚合状态），
              // 子任务行不再重复一遍 —— 否则一屏里同一句话要说 N+1 次。
              // 子任务自己的状态由行底色 / 左边框与「通过」按钮的可用性表达。
              status.key === 'running' ? h(SpinnerIcon, { size: 11 }) : null,
              groupKey === 'unreviewed' && status.key !== 'running' && child.review !== true
                ? h(
                    'button',
                    {
                      className: 'plt-copy-btn plt-kid-pass',
                      disabled: busy,
                      'data-tip': '人工审核这一条的执行结果：标记为已通过',
                      onClick: (e) => {
                        e.stopPropagation()
                        onPatch(child.id, { review: true })
                      },
                    },
                    h('span', null, '通过'),
                  )
                : null,
            ),
            h('div', { className: 'plt-kid-plan' }, String(child.plan ?? '') || '（空）'),
            note !== ''
              ? h('div', { className: 'plt-kid-note' }, h('span', { className: 'plt-kid-note-h' }, '备注'), note)
              : (Number(child.noteLen ?? 0) > 0
                  ? h('div', { className: 'plt-kid-note' }, h('span', { className: 'plt-kid-note-h' }, '备注'), '（加载中…）')
                  : null),
          )
        }),
      )
    }

    function Item(props) {
      const { item, open, detail, onToggle, onPatch, onRemove, onFetchDetail, busy, dragging, dropTarget, onDragStart, onDragOver, onDrop, onDragEnd, dragEnabled, selectable, selected, onSelect, showExecute, showReview, groupKey, impliedRunning, canPin, onPinTop, onPromote, onDemote, canDemote, editable } = props
      // id=273：父节点（带 children 的拆解批次）只当容器 —— 它没有正文、不参与执行，
      // 标题行就只显示原始提示词标题（name 本身就是从 sourcePrompt 压出来的），
      // 展开后交给下面的子任务列表，父自己的「计划 / 备注」一块都不渲染。
      const kids = Array.isArray(item.children) ? item.children : []
      const isParent = kids.length > 0
      const groupCount = isParent
        ? kids.filter((c) => statusOf(c).key === 'todo' || statusOf(c).key === 'running').length
        : 0
      const status = statusOf(item, impliedRunning === true)
      const time = fmtTime(item.time)
      // id=178：标题行的紧凑耗时（毫秒走 fmtDur）。空串代表缺失/0/非法，整节点不渲染。
      const durText = fmtDur(item.time)
      // 列表数据是 lite 的（正文截断、备注只留长度）；展开时用按需取回的全文覆盖。
      // 取不到就退回 lite 的截断正文，至少不会空白。
      const loaded = detail !== null && detail !== undefined && detail.id === item.id ? detail : null
      const planText = loaded === null ? item.plan : loaded.plan
      const noteText = loaded === null ? item.note : loaded.note
      // 正在执行（已开始、未完成）的条目不允许删除，避免打断模型的执行。
      const running = status.key === 'running'
      // 置顶按钮只在「待执行」组、且这一条不是正在执行的那条时出现
      // （执行中的条目本来就排在最上面，再置顶没有意义）。
      const pinTop = canPin === true && running !== true
      // 「复制内容」「复制 ID」三组都给：待执行组要先把写好的计划原文/编号取走别处用，
      // 待审核组要再喂给别的会话，已审核组要回看/复用历史计划。
      // 父节点没有自己的正文可复制（plan 恒为空），「内容」按钮给了只会复制出一串空串。
      const canCopyPlan = isParent !== true
      const canCopyId = true
      // 原始提示词的长度与正文：宿主有两种投影，必须两边都认。
      //   lite 列表（自动刷新 / 静默重读）→ 只给 sourcePromptLen，sourcePrompt 被抹成空串；
      //   全量 read（首挂载、手点「刷新」）→ 直接给 sourcePrompt 全文，压根没有 sourcePromptLen。
      // 早先这里只读 sourcePromptLen，于是首屏那一次渲染里「提示词」按钮整批消失、
      // 「提示词 → 通过」的顺序第一次画出来就是错的（id=194 联合回归抓到）。
      const sourceLen = Math.max(
        Number(item.sourcePromptLen ?? 0) || 0,
        typeof item.sourcePrompt === 'string' ? item.sourcePrompt.length : 0,
        loaded === null ? 0 : Number(loaded.sourcePromptLen ?? 0) || 0,
      )
      // 手上就已经有全文的情形（全量 read / detail 已回）：省掉一次 detail 请求。
      const sourceText =
        loaded !== null && typeof loaded.sourcePrompt === 'string' && loaded.sourcePrompt !== ''
          ? loaded.sourcePrompt
          : typeof item.sourcePrompt === 'string'
            ? item.sourcePrompt
            : ''
      // 「复制提示词」只给待执行及之后的真实任务卡（草稿还没有出处，不给）；
      // 没有原始提示词的条目（手工提交的）直接不渲染按钮，而不是给一个点了没反应的空壳。
      const canCopyPrompt = groupKey !== 'draft' && sourceLen > 0
      const [copied, setCopied] = React.useState('')
      // 「原始提示词」默认折叠：展开状态只活在这个卡片里，切走再回来重新收起。
      const [sourceOpen, setSourceOpen] = React.useState(false)
      // 草稿就地编辑：editing = 是否展开编辑框，draftText = 编辑中的文本。
      // 编辑即保存：停止输入片刻就自动落盘，所以没有「保存」按钮；「取消」= 还原成进来时的原文。
      const [editing, setEditing] = React.useState(false)
      const [draftText, setDraftText] = React.useState('')
      const [saveState, setSaveState] = React.useState('idle')
      // openedRef = 点「编辑」那一刻的原文（取消时还原到它，永不改动）；
      // savedRef = 最近一次成功落盘的文本（用来跳过无意义的重复写入）。
      const openedRef = React.useRef('')
      const savedRef = React.useRef('')
      const saveTimerRef = React.useRef(null)
      const pendingRef = React.useRef(null)
      // 立刻把当前草稿文本落盘（标题跟着正文重新生成）。
      const flushDraft = async (text) => {
        pendingRef.current = null
        if (typeof text !== 'string' || text.trim() === '' || text === savedRef.current) {
          setSaveState('idle')
          return
        }
        setSaveState('saving')
        const ok = await onPatch({ plan: text, refreshName: true, silent: true })
        if (ok === undefined) {
          setSaveState('error')
          return
        }
        savedRef.current = text
        setSaveState('saved')
      }
      // 输入时不停改 draftText，停手 600ms 后自动保存一次（避免每敲一个字就写盘）。
      const onEditChange = (value) => {
        setDraftText(value)
        setSaveState('pending')
        if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
        pendingRef.current = value
        saveTimerRef.current = window.setTimeout(() => {
          saveTimerRef.current = null
          void flushDraft(pendingRef.current)
        }, 600)
      }
      // 收起编辑框 / 组件卸载时，把没来得及保存的那一下补上。
      const stopEditing = async (revert) => {
        if (saveTimerRef.current !== null) {
          window.clearTimeout(saveTimerRef.current)
          saveTimerRef.current = null
        }
        const pending = pendingRef.current
        pendingRef.current = null
        if (revert === true) {
          // 取消 = 还原到「点编辑那一刻」的原文（中途自动保存过也照样回滚）。
          if (openedRef.current !== savedRef.current) {
            setSaveState('saving')
            const ok = await onPatch({ plan: openedRef.current, refreshName: true, silent: true })
            if (ok === undefined) {
              setSaveState('error')
              return
            }
            savedRef.current = openedRef.current
          }
          setDraftText(openedRef.current)
          setSaveState('idle')
          setEditing(false)
          return
        }
        if (pending !== null) await flushDraft(pending)
        setEditing(false)
      }
      // 组件卸载（收起分组 / 切页签）时补最后一次写入：丢定时器可以，丢用户的字不行。
      React.useEffect(
        () => () => {
          if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
          const pending = pendingRef.current
          pendingRef.current = null
          if (pending !== null && pending !== savedRef.current && pending.trim() !== '') {
            void onPatch({ plan: pending, refreshName: true, silent: true })
          }
        },
        [],
      )
      const doCopy = async (kind) => {
        // 复制要给完整原文：lite 数据里正文是截断的，展开时已取回全文就用全文，
        // 没取回则先补一次 detail 再复制（保证复制到的不是带省略号的半截）。
        // 复制提示词时不碰计划正文，省掉一次没必要的 detail 请求。
        let full = planText
        if (kind !== 'prompt' && (item.planLen ?? 0) > (typeof full === 'string' ? full.length : 0)) {
          const fetched = typeof onFetchDetail === 'function' ? await onFetchDetail(item.id) : null
          if (fetched !== null && fetched !== undefined && typeof fetched.plan === 'string') full = fetched.plan
        }
        // 原始提示词同理：lite 里只有长度，非要复制时补一次 detail 取全文。
        let source = sourceText
        if (source === '' && sourceLen > 0) {
          const fetched = typeof onFetchDetail === 'function' ? await onFetchDetail(item.id) : null
          if (fetched !== null && fetched !== undefined && typeof fetched.sourcePrompt === 'string') source = fetched.sourcePrompt
        }
        if (kind === 'prompt' && source === '') return
        // 复制 ID 时带上「任务id:」前缀：粘到别的会话里能直接看出这是任务编号，
        // 而不是一串裸数字（容易被误读成版本号 / 行号）。
        const ok = await copyText(kind === 'id' ? `任务id:${item.id}` : kind === 'prompt' ? source : String(full ?? ''))
        if (ok) {
          setCopied(kind)
          window.setTimeout(() => setCopied(''), 1200)
        }
      }
      // 条目内容一律只读：计划文本由侧边栏输入框写入，执行/审核状态由模型回填，
      // 所以列表里不再提供就地编辑入口（想改内容就删掉重写，或让模型改）。
      return h(
        'div',
        {
          className: `plt-item${isParent ? ' plt-parent' : ''}${open ? ' open' : ''}${running ? ' running' : ''}${dragging ? ' dragging' : ''}${dropTarget ? ' drop-target' : ''}${props.sublime === true ? ' plt-sublime' : ''}`,
          onDragOver: (e) => {
            if (dragEnabled !== true) return
            e.preventDefault()
            onDragOver()
          },
          onDrop: (e) => {
            if (dragEnabled !== true) return
            e.preventDefault()
            onDrop()
          },
        },
        h(
          'div',
          { className: 'plt-head', onClick: onToggle },
          dragEnabled === true
            ? h(
                'span',
                {
                  className: 'plt-grip',
                  'data-tip': '按住拖拽可调整顺序（执行顺序也跟着变）',
                  draggable: true,
                  onClick: (e) => e.stopPropagation(),
                  onDragStart: (e) => {
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', String(item.id))
                    onDragStart()
                  },
                  onDragEnd,
                },
                '⠿',
              )
            : h('span', { className: 'plt-grip plt-grip-off', 'aria-hidden': 'true' }),
          selectable === true
            ? h(
                'span',
                { className: 'plt-pick', onClick: (e) => e.stopPropagation() },
                h('input', {
                  type: 'checkbox',
                  checked: selected === true,
                  disabled: busy,
                  'data-tip': selected === true ? '取消选择这一条' : '选中这一条，稍后批量处理',
                  onChange: (e) => onSelect(e.target.checked),
                }),
              )
            : null,
          h('span', { className: 'plt-caret' }, h(CaretIcon, { size: 13 })),
          // 编号单独占一个窄标签，标题就能把剩下的宽度全用上。
          h('span', { className: 'plt-id' }, `#${item.id}`),
          h(
            'span',
            {
              className: 'plt-name',
              // id=352：原生 title 也带上全称 —— 除了自绘气泡，浏览器自带的悬停提示
              // 也该显示完整标题（有人习惯等系统 tooltip）。
              title: `#${item.id} ${item.name}`,
              'data-tip': isParent
                ? `#${item.id} ${item.name}\n\n拆解批次：${kids.length} 条子任务`
                : `#${item.id} ${item.name}\n\n${planText}`,
            },
            // id=352：待执行区的标题按字数截短（其余区保持全称），完整名字在 data-tip 里。
            groupKey === 'todo' ? clipName(item.name, TODO_NAME_MAX) : item.name,
          ),
          // 父节点：标题右侧的「N 条」徽标。拆解产物的归属关系就靠它一眼认出来。
          isParent === true
            ? h(
                'span',
                {
                  className: 'plt-kids',
                  'data-tip': `这一批拆成了 ${kids.length} 条子任务${groupCount > 0 ? `，其中 ${groupCount} 条还没做完` : ''}`,
                },
                `${kids.length} 条`,
              )
            : null,
          // id=178/179：待审核的每一项在标题右侧挂耗时，扫一眼就知道这条跑了多久，
          // 不用展开。必须是 .plt-name 的**兄弟**节点——塞进标题里会跟着一起被
          // ellipsis 截掉，还会污染悬浮提示的全文。
          // id=183：已审核组同样挂耗时。两边走的是**同一个** fmtDur、同一个 .plt-dur
          // 节点、同一份样式，只是组白名单多一项——不复制第二份格式化实现，
          // 这样「6分钟28秒」在两处永远长得一样。空串（缺失/0/非法）时整节点缺席。
          (groupKey === 'unreviewed' || groupKey === 'reviewed') && durText !== ''
            ? h('span', { className: 'plt-dur', 'data-tip': `这条任务耗时 ${durText}` }, durText)
            : null,
          // 类型只用图标表示（和输入栏的胶囊图标一致）：「修改」是默认类型，不显示。
          // 放在状态标签左侧，先看到「这是什么类型的活」，再看到「进行到哪一步」。
          item.taskType === '仅回答' || item.taskType === '目标'
            ? h('span', { className: `plt-tag type plt-type-${item.taskType}`, 'data-tip': `任务类型：${item.taskType}` }, h(ModeIcon, { kind: item.taskType, size: 13 }))
            : null,
          // 置顶（id=319 位置调整）：只有「待执行」组给，正在执行的那条不给（它本来就在最上面）。
          // 必须排在状态徽标**之前** —— 状态列要贴着行尾对齐（见 13-item.js 的
          // .plt-head 右对齐规则），按钮放在它后面会把徽标顶得长短不一。
          // id=320：没有按钮的行也要占同样的宽度，所以「是否有按钮」只决定画不画图标，
          // 槽位本身恒定存在（.plt-pin-slot 固定 20px）—— 否则拆分批次行（永远没有置顶按钮）
          // 的状态标签会比普通行右移 20px，纵向扫视时那一列是锯齿。
          h(
            'span',
            { className: 'plt-pin-slot' },
            pinTop === true
              ? h(
                  'button',
                  {
                    className: 'plt-pin',
                    'data-tip': '置顶：排到待执行的第一位（执行中那条之后）',
                    onClick: (e) => {
                      e.stopPropagation()
                      onPinTop()
                    },
                  },
                  h(PinTopIcon, { size: 12 }),
                )
              : null,
          ),
          /**
           * 状态徽标（id=352-D）。
           *
           * 执行中不再显示「执行中」三个字，只留一个转圈：这一列是竖着扫的，
           * 三个字占的宽度随字号变，而图标是一个定宽方块 —— 一列里只有它一个「词」，
           * 眼睛会被反复拉过去。转圈本身已经把「在跑」说清楚了。
           *
           * 尺寸（见 .plt-tag.running / .plt-run-dot）：外框固定 26×20，与文字徽标
           * 的行高 20px 对齐，所以整列右边界不会因为这一条从文字变成图标而移动。
           * 其余状态（待执行/待审核/已审核/草稿/失败/中断）一个字都没改。
           */
          status.key === 'running'
            ? h(
                'span',
                {
                  className: 'plt-tag running plt-run-only',
                  'data-tip': '任务正在执行中',
                  // 没有文字了，必须给可访问名，否则屏幕阅读器读到的是一个空 span。
                  'aria-label': '执行中',
                  role: 'status',
                },
                h(SpinnerIcon, { size: 13 }),
              )
            : h(
                'span',
                { className: `plt-tag ${status.key}` },
                h('span', null, status.label),
              ),
        ),
        open && isParent === true
          ? h(
              'div',
              { className: 'plt-body plt-body-parent' },
              // 父自己的「计划 / 备注」一块都不画：它没有正文，备注是拆分批注，
              // 摊在这儿只会把子任务列表往下挤。展开就是要看这一批到底拆成了什么。
              h(KidsList, {
                // detail 取回的全量 children 优先（正文没被 lite 截断），没有就用列表那份。
                kids: loaded !== null && Array.isArray(loaded.children) && loaded.children.length > 0 ? loaded.children : kids,
                groupKey,
                busy,
                onPatch,
              }),
              // 原始提示词仍留在最下面：这一批当初是根据哪句话拆出来的。
              (sourceText !== '' || (loaded === null && sourceLen > 0))
                ? h(
                    'div',
                    { className: 'plt-sec' },
                    h(
                      'button',
                      {
                        className: `plt-sec-toggle${sourceOpen ? ' open' : ''}`,
                        type: 'button',
                        'aria-expanded': sourceOpen === true,
                        'data-tip': sourceOpen ? '收起原始提示词' : `展开原始提示词（${sourceLen} 字）`,
                        onClick: (e) => {
                          e.stopPropagation()
                          setSourceOpen((v) => v !== true)
                        },
                      },
                      h(
                        'span',
                        { className: 'plt-sec-h' },
                        '原始提示词',
                        h('span', { className: 'plt-sec-hint' }, `${sourceLen} 字`),
                      ),
                      h('span', { className: 'plt-sec-caret' }, h(CaretIcon, { size: 12 })),
                    ),
                    sourceOpen ? h('div', { className: 'plt-source' }, sourceText) : null,
                  )
                : null,
              h(
                'div',
                { className: 'plt-meta' },
                h('span', null, `子任务：${kids.length} 条`),
                h('span', null, `创建：${fmtDate(item.createdAt) || '—'}`),
              ),
              h(
                'div',
                { className: 'plt-checks' },
                h(
                  'div',
                  { className: 'plt-actions' },
                  running
                    ? null
                    : h(
                        'button',
                        {
                          className: 'plt-btn plt-del',
                          disabled: busy,
                          'data-tip': '删除整批：父节点与它的全部子任务一起删掉',
                          onClick: onRemove,
                        },
                        '删除整批',
                      ),
                ),
              ),
            )
          : open
          ? h(
              'div',
              { className: 'plt-body' },
              h(
                'div',
                { className: 'plt-sec' },
                h(
                  'div',
                  { className: 'plt-sec-h' },
                  h('span', null, '计划'),
                  // 「计划」标题右侧：编辑（仅草稿）、复制内容、复制 ID。
                  h(
                    'span',
                    { className: 'plt-copy' },
                    editable === true
                      ? h(
                          'button',
                          {
                            className: `plt-copy-btn${editing ? ' done' : ''}`,
                            'data-tip': editing ? '收起编辑框' : '直接编辑这条草稿的内容',
                            onClick: (e) => {
                              e.stopPropagation()
                              if (editing) void stopEditing(false)
                              else {
                                const text = String(planText ?? '')
                                openedRef.current = text
                                savedRef.current = text
                                pendingRef.current = null
                                setDraftText(text)
                                setSaveState('idle')
                                setEditing(true)
                              }
                            },
                          },
                          h(EditIcon, { size: 12 }),
                          h('span', null, editing ? '收起' : '编辑'),
                        )
                      : null,
                    canCopyId === true
                      ? h(
                          'button',
                          {
                            className: `plt-copy-btn${copied === 'id' ? ' done' : ''}`,
                            'data-tip': `复制这条计划的 ID（${item.id}）`,
                            onClick: (e) => {
                              e.stopPropagation()
                              void doCopy('id')
                            },
                          },
                          h(CopyIcon, { size: 12 }),
                          h('span', null, copied === 'id' ? '已复制' : 'ID'),
                        )
                      : null,
                    canCopyPlan === true
                      ? h(
                          'button',
                          {
                            className: `plt-copy-btn${copied === 'plan' ? ' done' : ''}`,
                            'data-tip': '复制这条计划的完整内容',
                            onClick: (e) => {
                              e.stopPropagation()
                              void doCopy('plan')
                            },
                          },
                          h(CopyIcon, { size: 12 }),
                          h('span', null, copied === 'plan' ? '已复制' : '内容'),
                        )
                      : null,
                    // 复制原始提示词：拆解产物才有，点一下把这批任务当初的需求原文取走。
                    canCopyPrompt === true
                      ? h(
                          'button',
                          {
                            className: `plt-copy-btn${copied === 'prompt' ? ' done' : ''}`,
                            'data-tip': `复制这条任务的原始提示词（${item.sourcePromptLen} 字）`,
                            onClick: (e) => {
                              e.stopPropagation()
                              void doCopy('prompt')
                            },
                          },
                          h(CopyIcon, { size: 12 }),
                          h('span', null, copied === 'prompt' ? '已复制' : '提示词'),
                        )
                      : null,
                    // 「通过」＝原来的底部「审核通过」，按 id=192 的定位搬到这一排、改名、
                    // 换成与「提示词」完全相同的 .plt-copy-btn 黄底样式（不新增样式类）。
                    // 触发逻辑一字未动：仍是 onPatch({ review: true })，走 60-tab.js:624 的
                    // patch，自动展开下一条 / 清空后折叠分组那套行为原样保留。
                    // 条件也照搬：只有待审核组（showReview）且这条不在执行中才给——
                    // 执行中的条目还没有结果可审，已审核的则早已整排不再重复出现。
                    showReview === false || running
                      ? null
                      : h(
                          'button',
                          {
                            className: 'plt-copy-btn',
                            disabled: busy || item.review === true,
                            'data-tip': '人工审核这一条的执行结果：标记为已通过',
                            onClick: (e) => {
                              e.stopPropagation()
                              onPatch({ review: true })
                            },
                          },
                          h('span', null, '通过'),
                        ),
                  ),
                ),
                editable === true && editing
                  ? h(
                      'div',
                      { className: 'plt-edit-box', onClick: (e) => e.stopPropagation() },
                      h('textarea', {
                        className: 'plt-input plt-edit-input',
                        value: draftText,
                        rows: 6,
                        spellCheck: false,
                        placeholder: '草稿内容，随时可以再改（停手自动保存）',
                        onChange: (e) => onEditChange(e.target.value),
                      }),
                      h(
                        'div',
                        { className: 'plt-edit-actions' },
                        // 正文左侧：任务类型切换（修改 / 目标 / 仅回答），改完立即落盘。
                        h(
                          'div',
                          { className: 'plt-edit-types' },
                          ['修改', '目标', '仅回答'].map((type) =>
                            h(
                              'button',
                              {
                                key: type,
                                type: 'button',
                                className: `plt-chip plt-chip-sm${item.taskType === type ? ' active' : ''}`,
                                disabled: busy,
                                'data-tip': `任务类型：${type}`,
                                onClick: (e) => {
                                  e.stopPropagation()
                                  onPatch({ taskType: type })
                                },
                              },
                              h('span', { className: 'plt-chip-ico' }, h(ModeIcon, { kind: type, size: 12 })),
                              h('span', { className: 'plt-chip-txt' }, type),
                            ),
                          ),
                        ),
                        // 编辑即保存：这里只显示保存状态，没有「保存」按钮。
                        h(
                          'span',
                          { className: `plt-save-state ${saveState}`, 'aria-live': 'polite' },
                          saveState === 'pending' ? '待保存…' : saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '已自动保存' : saveState === 'error' ? '保存失败，再改一下重试' : '停手即自动保存',
                        ),
                        h(
                          'button',
                          {
                            className: 'plt-btn',
                            disabled: busy || saveState === 'saving',
                            'data-tip': '放弃这次修改，还原成进入编辑时的内容',
                            onClick: (e) => {
                              e.stopPropagation()
                              void stopEditing(true)
                            },
                          },
                          '取消',
                        ),
                      ),
                    )
                  : h('div', { className: 'plt-plan' }, planText || '（空）'),
              ),
              noteText
                ? h('div', { className: 'plt-sec' }, h('div', { className: 'plt-sec-h' }, '备注 / 执行结果'), h('div', { className: 'plt-note' }, noteText))
                : (item.noteLen ?? 0) > 0
                  ? h('div', { className: 'plt-sec' }, h('div', { className: 'plt-sec-h' }, '备注 / 执行结果'), h('div', { className: 'plt-note' }, '（备注加载中…）'))
                  : null,
              // 拆解产物才有的「原始提示词」：这条计划当初是根据哪段需求拆出来的。
              // 手工提交的条目 sourcePrompt 为空，整段不渲染，展开后不会多出一块空框。
              // 默认折叠：原文可能很长（整段需求），默认铺开会把卡片撑得很长，
              // 用户是来看「做完了没」的，不是来重读需求的 —— 想看得自己点开。
              (sourceText !== '' || (loaded === null && sourceLen > 0))
                ? h(
                    'div',
                    { className: 'plt-sec' },
                    h(
                      'button',
                      {
                        className: `plt-sec-toggle${sourceOpen ? ' open' : ''}`,
                        type: 'button',
                        'aria-expanded': sourceOpen === true,
                        'data-tip': sourceOpen ? '收起原始提示词' : `展开原始提示词（${sourceLen} 字）`,
                        onClick: (e) => {
                          e.stopPropagation()
                          setSourceOpen((v) => v !== true)
                        },
                      },
                      h(
                        'span',
                        { className: 'plt-sec-h' },
                        '原始提示词',
                        h('span', { className: 'plt-sec-hint' }, `${sourceLen} 字`),
                      ),
                      h('span', { className: 'plt-sec-caret' }, h(CaretIcon, { size: 12 })),
                    ),
                    sourceOpen ? h('div', { className: 'plt-source' }, sourceText) : null,
                  )
                : null,
              h(
                'div',
                { className: 'plt-meta' },
                item.mode ? h('span', null, `模式：${item.mode}`) : null,
                h('span', null, `创建：${fmtDate(item.createdAt) || '—'}`),
                item.startedAt ? h('span', null, `开始：${fmtDate(item.startedAt)}`) : null,
                time ? h('span', null, `耗时：${time}`) : null,
              ),
              h(
                'div',
                { className: 'plt-checks' },
                // 「已执行」是模型自动回填的只读状态，三组都不再重复展示。
                showExecute === false
                  ? null
                  : h(
                      'label',
                      { className: 'plt-check locked', 'data-tip': '「已执行」由模型在执行完成后自动回填，不能手动修改' },
                      h('input', {
                        type: 'checkbox',
                        checked: item.execute === true,
                        disabled: true,
                        readOnly: true,
                      }),
                      h('span', null, '已执行'),
                    ),
                // 「审核通过」已按 id=193 搬到「计划」标题行的「提示词」之后（改名「通过」、
                // 复用 .plt-copy-btn），这里不再重复放一个入口，免得一张卡上两个审核按钮。
                // 「转为待执行 / 转为草稿 / 删除」统一收进右侧的 .plt-actions，
                // 草稿组里「转为待执行」和「删除」因此挨在一起，不再被 margin-left:auto 拉开。
                h(
                  'div',
                  { className: 'plt-actions' },
                  // 草稿：给一个「转为待执行」，点一下才正式排队（草稿本身不参与执行）。
                  status.key === 'draft'
                    ? h(
                        'button',
                        {
                          className: 'plt-btn plt-promote',
                          disabled: busy,
                          'data-tip': '转为待执行：退出草稿，排进执行队列',
                          onClick: (e) => {
                            e.stopPropagation()
                            onPromote()
                          },
                        },
                        '转为待执行',
                      )
                    : null,
                  // 待执行里还没开工的条目可以退回草稿（执行中不给，见 canDemote）。
                  canDemote === true
                    ? h(
                        'button',
                        {
                          className: 'plt-btn plt-demote',
                          disabled: busy,
                          'data-tip': '转为草稿：退出执行队列，存进草稿组',
                          onClick: (e) => {
                            e.stopPropagation()
                            onDemote()
                          },
                        },
                        '转为草稿',
                      )
                    : null,
                  /**
                   * 待执行的条目在「转为草稿」之后多一个垃圾桶图标按钮（id=353）。
                   *
                   * 为什么用图标而不是再加一个「删除」文字按钮：这一排已经有两个文字按钮，
                   * 再加第三个在窄侧栏里会挤成两行。图标按钮宽度固定，永远不会换行。
                   *
                   * 样式要点（见 .plt-icon-btn）：36×26 的点击热区、与相邻按钮同高、
                   * gap 与 .plt-actions 一致，所以加进来不会把这一排顶到第二行。
                   *
                   * 点击走的就是现有删除通道（onRemove → remove），与文字「删除」按钮同一条路，
                   * 没有第二套逻辑 —— 两处行为不可能走散。
                   */
                  groupKey === 'todo' && running !== true
                    ? h(
                        'button',
                        {
                          className: 'plt-btn plt-icon-btn plt-trash',
                          type: 'button',
                          disabled: busy,
                          'data-tip': '删除这条待执行',
                          title: '删除这条待执行',
                          'aria-label': '删除这条待执行',
                          onClick: (e) => {
                            // 阻止冒泡：不然点按钮会连带把这一行展开/收起。
                            e.stopPropagation()
                            if (typeof onRemove === 'function') onRemove()
                          },
                        },
                        h(TrashIcon, { size: 13 }),
                      )
                    : null,
                  // 执行中的条目整排操作都不给：转草稿/删除直接隐藏，不留灰按钮。
                  // 待执行栏的删除已经收成上面的垃圾桶图标（id=353），这里不再重复放文字按钮 ——
                  // 一栏只留一个删除入口，免得用户犹豫该点哪个。
                  running === true || groupKey === 'todo'
                    ? null
                    : h(
                        'button',
                        {
                          className: 'plt-btn plt-del',
                          disabled: busy,
                          'data-tip': '删除这条计划',
                          onClick: onRemove,
                        },
                        '删除',
                      ),
                ),
              ),
            )
          : null,
      )
    }
