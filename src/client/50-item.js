    function Item(props) {
      const { item, open, detail, onToggle, onPatch, onRemove, onFetchDetail, busy, dragging, dropTarget, onDragStart, onDragOver, onDrop, onDragEnd, dragEnabled, selectable, selected, onSelect, showExecute, showReview, groupKey, impliedRunning, canPin, onPinTop, onPromote, onDemote, canDemote, editable } = props
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
      const canCopyPlan = true
      const canCopyId = true
      // 「复制提示词」只给待执行及之后的真实任务卡（草稿还没有出处，不给）；
      // 没有原始提示词的条目（手工提交的）直接不渲染按钮，而不是给一个点了没反应的空壳。
      const canCopyPrompt = groupKey !== 'draft' && (item.sourcePromptLen ?? 0) > 0
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
        let source = loaded !== null && typeof loaded.sourcePrompt === 'string' ? loaded.sourcePrompt : ''
        if (source === '' && (item.sourcePromptLen ?? 0) > 0) {
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
          className: `plt-item${open ? ' open' : ''}${running ? ' running' : ''}${dragging ? ' dragging' : ''}${dropTarget ? ' drop-target' : ''}${props.sublime === true ? ' plt-sublime' : ''}`,
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
                  title: '按住拖拽可调整顺序（执行顺序也跟着变）',
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
                  title: selected === true ? '取消选择这一条' : '选中这一条，稍后批量处理',
                  onChange: (e) => onSelect(e.target.checked),
                }),
              )
            : null,
          h('span', { className: 'plt-caret' }, h(CaretIcon, { size: 13 })),
          // 编号单独占一个窄标签，标题就能把剩下的宽度全用上。
          h('span', { className: 'plt-id' }, `#${item.id}`),
          h('span', { className: 'plt-name', title: `#${item.id} ${item.name}\n\n${planText}` }, item.name),
          // id=178/179：待审核的每一项在标题右侧挂耗时，扫一眼就知道这条跑了多久，
          // 不用展开。必须是 .plt-name 的**兄弟**节点——塞进标题里会跟着一起被
          // ellipsis 截掉，还会污染 title 的全文悬浮。
          // id=183：已审核组同样挂耗时。两边走的是**同一个** fmtDur、同一个 .plt-dur
          // 节点、同一份样式，只是组白名单多一项——不复制第二份格式化实现，
          // 这样「6分钟28秒」在两处永远长得一样。空串（缺失/0/非法）时整节点缺席。
          (groupKey === 'unreviewed' || groupKey === 'reviewed') && durText !== ''
            ? h('span', { className: 'plt-dur', title: `这条任务耗时 ${durText}` }, durText)
            : null,
          // 类型只用图标表示（和输入栏的胶囊图标一致）：「修改」是默认类型，不显示。
          // 放在状态标签左侧，先看到「这是什么类型的活」，再看到「进行到哪一步」。
          item.taskType === '仅回答' || item.taskType === '目标'
            ? h('span', { className: `plt-tag type plt-type-${item.taskType}`, title: `任务类型：${item.taskType}` }, h(ModeIcon, { kind: item.taskType, size: 13 }))
            : null,
          h(
            'span',
            { className: `plt-tag ${status.key}`, title: status.key === 'running' ? '任务正在执行中' : undefined },
            status.key === 'running' ? h(SpinnerIcon, { size: 12 }) : null,
            h('span', null, status.label),
          ),
          // 置顶：只有「待执行」组给，正在执行的那条不给（它本来就在最上面）。
          pinTop === true
            ? h(
                'button',
                {
                  className: 'plt-pin',
                  title: '置顶：排到待执行的第一位（执行中那条之后）',
                  onClick: (e) => {
                    e.stopPropagation()
                    onPinTop()
                  },
                },
                h(PinTopIcon, { size: 12 }),
              )
            : null,
        ),
        open
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
                            title: editing ? '收起编辑框' : '直接编辑这条草稿的内容',
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
                            title: `复制这条计划的 ID（${item.id}）`,
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
                            title: '复制这条计划的完整内容',
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
                            title: `复制这条任务的原始提示词（${item.sourcePromptLen} 字）`,
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
                            title: '人工审核这一条的执行结果：标记为已通过',
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
                                title: `任务类型：${type}`,
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
                            title: '放弃这次修改，还原成进入编辑时的内容',
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
              (loaded !== null && typeof loaded.sourcePrompt === 'string' && loaded.sourcePrompt !== '')
                ? h(
                    'div',
                    { className: 'plt-sec' },
                    h(
                      'button',
                      {
                        className: `plt-sec-toggle${sourceOpen ? ' open' : ''}`,
                        type: 'button',
                        'aria-expanded': sourceOpen === true,
                        title: sourceOpen ? '收起原始提示词' : `展开原始提示词（${item.sourcePromptLen ?? loaded.sourcePrompt.length} 字）`,
                        onClick: (e) => {
                          e.stopPropagation()
                          setSourceOpen((v) => v !== true)
                        },
                      },
                      h(
                        'span',
                        { className: 'plt-sec-h' },
                        '原始提示词',
                        h('span', { className: 'plt-sec-hint' }, `${item.sourcePromptLen ?? loaded.sourcePrompt.length} 字`),
                      ),
                      h('span', { className: 'plt-sec-caret' }, h(CaretIcon, { size: 12 })),
                    ),
                    sourceOpen ? h('div', { className: 'plt-source' }, loaded.sourcePrompt) : null,
                  )
                : (loaded === null && (item.sourcePromptLen ?? 0) > 0)
                  ? h('div', { className: 'plt-sec' }, h('div', { className: 'plt-sec-h' }, '原始提示词'), h('div', { className: 'plt-source' }, '（原始提示词加载中…）'))
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
                      { className: 'plt-check locked', title: '「已执行」由模型在执行完成后自动回填，不能手动修改' },
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
                          title: '转为待执行：退出草稿，排进执行队列',
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
                          title: '转为草稿：退出执行队列，存进草稿组',
                          onClick: (e) => {
                            e.stopPropagation()
                            onDemote()
                          },
                        },
                        '转为草稿',
                      )
                    : null,
                  // 执行中的条目整排操作都不给：转草稿/删除直接隐藏，不留灰按钮。
                  running
                    ? null
                    : h(
                        'button',
                        {
                          className: 'plt-btn plt-del',
                          disabled: busy,
                          title: '删除这条计划',
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
