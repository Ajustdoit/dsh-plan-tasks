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
      // id=371：不再接 `onPatch` 与 `busy` —— 它们此前唯一的用途是给
      // 子任务行内那颗「单个通过」按钮（disabled + onClick）。按钮删掉之后
      // 这两个 prop 就没有读者了，留着是「传了但没人用」的假接口：
      // 后来的人会以为子任务行还能改点什么。
      // `groupKey` 保留：耗时节点的显示条件还要用它（待审核/已审核才画）。
      const { kids, groupKey } = props
      return h(
        'div',
        { className: 'plt-kids-list' },
        kids.map((child) => {
          const status = statusOf(child)
          const durText = fmtDur(child.time)
          const note = String(child.note ?? '')
          // id=360/361：子任务编号（"2-A"）由宿主在读投影里派生好（store.js 的
          // toLiteItem 与 api.js 的 detail 各给一份，见 docs/subtask-numbering.md），
          // 这里只负责画，不再从 id 里切字符串 —— 同一个规则只留一份实现。
          //
          // 为什么不拼 `#`：顶层条目画的是 `#12`（半子任务行老格式的残留），
          // 而拆解批次的父已经用「组」这个概念在带子任务了，`2-A` 连读就是「第 2 组 A 条」，
          // 再加个 `#` 反而变成了两种记号混排。5-A 调研里也是把 `2-A` 当完整编号文本记的。
          //
          // 空值处理（题面要求）：`code` 为空串时**整个节点不渲染**，
          // 也不留一个固定宽度的空槽 —— 手工新建的条目没有父子关系，
          // 给它留编号位就等于凭空多出一段缩进，标题会比别的行短一截还找不到原因。
          const codeText = String(child.code ?? '')
          // id=322 曾把 children 行的编号整个删掉，理由是「子任务不参与拖拽 / 批量，
          // 编号只在父行有意义」。id=361 把这个理由收回来一半：**身份还是要显示的**，
          // 只是形状不同（窄胶囊，不是顶层那枚裸 `#id`），而且位置从「标题之前的最左端」
          // 挪到了对勾之后 —— 编号是配角，不该抢占标题的起点。
          // `data-id` 一直都留着（批量请求与验证脚本靠它定位具体那一条）：
          // 去掉显示 ≠ 去掉身份，现在两者终于对上了。
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
              // 编号标签：在任务名称左侧、对勾之后（id=361）。
              // 所有状态（待执行 / 待审核 / 已审核 / 执行中 / 失败…）都渲染同一个节点，
              // 不做条件分支 —— 编号是身份，不是状态，状态一变编号就消失会让人对不上号。
              // `code` 为空串时返回 null，DOM 里连元素都没有（题面：不留占位空隙）。
              codeText !== ''
                ? h(
                    'span',
                    {
                      className: 'plt-kid-code',
                      // 复制不了也点不了，只是视觉定位；读屏念一遍编号同样是有效信息。
                      'data-tip': `编号 ${codeText}`,
                    },
                    codeText,
                  )
                : null,
              h(
                'span',
                { className: 'plt-kid-name', 'data-tip': `${child.name}\n\n${child.plan ?? ''}` },
                // id=362：省略号截断挪到内层 span 上，外层只当 flex 项。
                // 原因是一个浏览器/规范细节：flex 项一旦带 overflow:hidden，
                // 它的「基线」就不再取首行文字的基线，而是退回**底边**（inline-block
                // 那条规则被套用到了 flex 项上）。于是上一行的 align-items:baseline
                // 会把编号胶囊对齐到标题的底边 —— 看起来正是题面要避免的那种错位。
                // 拆成两层后：外层 overflow 保持 visible（有真基线），内层负责截断。
                h('span', { className: 'plt-kid-name-text' }, child.name),
              ),
              durText !== '' && (groupKey === 'unreviewed' || groupKey === 'reviewed')
                ? h('span', { className: 'plt-dur', 'data-tip': `这条任务耗时 ${durText}` }, durText)
                : null,
              child.taskType === '仅回答' || child.taskType === '目标'
                ? h('span', { className: `plt-tag type plt-type-${child.taskType}`, 'data-tip': `任务类型：${child.taskType}` }, h(ModeIcon, { kind: child.taskType, size: 12 }))
                : null,
              // id=274：状态徽标只挂在父级行上（父行显示整批的聚合状态），
              // 子任务行不再重复一遍 —— 否则一屏里同一句话要说 N+1 次。
              // 子任务自己的状态由行底色 / 左边框表达。
              status.key === 'running' ? h(SpinnerIcon, { size: 11 }) : null,
              // id=371：子任务行右侧那颗「单个通过」已删除。
              // 理由：整批通过（父行头部那颗）已经是这条链路上的唯一入口 ——
              // 同一份「标成已审核」的动作留两个入口（一个整批、一个逐条），
              // 用户要自己判断「我该点哪个」，而两条路落盘后的形态完全一样。
              // 删掉之后：子任务行只剩对勾 / 编号 / 标题 / 耗时 / 类型图标 / 执行中，
              // 审核动作统一收到父行头部，与 6- 那批把「通过」搬到头部的方向一致。
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
      const { item, open, detail, onToggle, onPatch, onRemove, onFetchDetail, busy, dragging, dropTarget, onDragStart, onDragOver, onDrop, onDragEnd, dragEnabled, selectable, selected, onSelect, showExecute, showReview, groupKey, impliedRunning, canPin, onPinTop, onApproveBatch, onPromote, onDemote, canDemote, editable } = props
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
      //   全量 read（首挂载 / 会话切换那几次）→ 直接给 sourcePrompt 全文，压根没有 sourcePromptLen。
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
      // 「原始提示词」的展开状态。
      //
      // 默认值（id=375）：待执行组里的**拆解批次**默认展开，其余一律默认折叠。
      //
      // 为什么只放开待执行里的批次：
      //  · 待执行是「接下来要干什么」的清单。批次卡展开后先是子任务列表、
      //    再是这段原始提示词 —— 用户在这里最需要回头确认「当初是怎么要求的」，
      //    好判断拆得对不对、要不要先改一版再执行。每次都要多点一下才能看到，
      //    等于把最该在眼前的东西藏起来。
      //  · 待审核 / 已审核不放开：那时活已经干完了，用户是来看结果的，
      //    默认铺开一整段需求会把卡片撑得很长，反而盖住真正的执行结果。
      //  · 单任务（无 children）不放开：它们没有子任务列表，展开区里就只剩这段原文，
      //    默认展开等于把卡片直接变成两倍高，而标题已经压自同一段提示词，
      //    信息是重复的。这条按题面「拆分的任务」的措辞，没有顺带扩大。
      //
      // 状态仍是本地 useState、仍可在卡片里手动收起/展开（按钮一字未改）。
      // 只在初次挂载时取这个默认值：条目换组时（todo → unreviewed）是整棵子树
      // 重新挂载（各组是独立容器），所以会按新组重新取默认，不会把旧状态带过去。
      const [sourceOpen, setSourceOpen] = React.useState(groupKey === 'todo' && isParent === true)
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
          // id=354：拆解批次的**整组通过**。父行头部（状态标签左侧）在整批进入
          // 「待审核」时给一颗「通过」；其余状态一颗都不画 —— 待执行还没结果可审、
          // 已审核已经审完、草稿/执行中都不该出现这颗按钮，所以这里只认 status.key。
          // 为什么放头部：一个批次展开后最长能铺十几条子任务，整批通过的操作要在
          // 不展开、不滚动的状态下就能点到，行内尾部得先滚到底才看得见。
          // 样式复用 .plt-copy-btn（与计划标题行那颗「通过」、子任务行内那颗同一套胶囊），
          // 不新造视觉；只用一个 .plt-head-pass 承担「不参与标题伸缩」。
          // 点击走统一入口 onApproveBatch(整批 id)：本组件不自己遍历子任务，
          // 也不提供单条通过的第二个入口（单条仍由子任务行内那颗按钮负责）。
          //
          // id=368：**没有拆分的普通条目**在待审核时也搬到头部来（原来它藏在展开区里）。
          // 理由与批次那条完全一样，只是「隐藏成本」更隐蔽：普通条目要看到「通过」
          // 得先展开卡片 —— 而审核这件事恰恰不需要读正文，一眼扫过列表就能判断
          // 「这条做完了没有」。放在头部之后，待审核组在收起状态下就是一张可逐条
          // 点过的清单，不用展开、不用滚动。
          // 两类条目共用同一个位置与同一套样式，用 isParent 分派动作：
          //   批次 → onApproveBatch（一次改完整批）
          //   普通 → onPatch({ review: true })（与原来展开区里那颗完全同一条通道，
          //          连「自动展开下一条 / 清空后折叠分组」那套行为都原样保留）
          // running 时两颗都不画：执行中还没有结果可审。
          (isParent === true && status.key === 'unreviewed') || (isParent !== true && showReview === true && running !== true)
            ? h(
                'button',
                {
                  className: 'plt-copy-btn plt-head-pass',
                  type: 'button',
                  disabled: busy === true || (isParent !== true && item.review === true),
                  'data-tip':
                    isParent === true
                      ? `整批通过：把这一批 ${kids.length} 条子任务一起标成已审核`
                      : '人工审核这一条的执行结果：标记为已通过',
                  'aria-label': isParent === true ? '整批通过' : '通过',
                  onClick: (e) => {
                    // 头部整行是展开/收起的热区，按钮必须自己吃掉点击。
                    e.stopPropagation()
                    if (isParent === true) {
                      if (typeof onApproveBatch === 'function') onApproveBatch(item.id)
                      return
                    }
                    onPatch({ review: true })
                  },
                },
                h('span', null, '通过'),
              )
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
           * 其余状态（待执行/待审核/草稿/失败/中断）一个字都没改。
           *
           * id=358：「已审核」这一档**不再画徽标**。已审核组里的每一条都必然是已审核
           *（进组条件就是 execute+review），右端再挂一个「已审核」等于把同一句话说 N 遍，
           * 而且它是整列里最长的一个词，把标题挤短最多。分组位置本身已经说明了状态，
           * 所以这条分支只留空 —— 不是隐藏（visibility），是真的不渲染节点。
           * 只影响这一档：其余状态照旧，`statusOf` 与分组判断一个字没动。
           *
           * id=368：**待审核这一档也去掉徽标**，理由与「已审核」同一个：
           * 进组条件就把状态说完了 —— 待在「待审核」组里，每条必然是待审核。
           * 右端再挂一个「待审核」= 把组名重复 N 遍，还是整列里较长的词。
           * 省下来的宽度给标题：待审核组是逐条扫读、逐条点「通过」的地方，
           * 标题截断得越少越好。
           * 于是 running 之外**只剩**需要「与所在组不同」的状态才画徽标
           *（待执行 / 草稿 / 失败 / 已中断），组内一致的两种（待审核 / 已审核）都不画。
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
            : status.key === 'reviewed' || status.key === 'unreviewed'
              ? null
              : h(
                  'span',
                  { className: `plt-tag ${status.key}` },
                  h('span', null, status.label),
                ),
          /**
           * 头部删除入口（id=359 建，id=374 扩到待执行）。
           *
           * id=359 时只有「已审核」有：那是回看历史的地方，底部那排要先展开卡片才看得见，
           * 而删除恰恰是最不需要先读正文的动作。
           *
           * id=374 把**待执行**也纳进来，且要求「拆分的和单任务一视同仁」：
           * 这两类在数据里形状不同（一个父带 children、一个是普通条目），
           * 但在界面上都是待执行列表里的一行 —— 一行一个垃圾桶，位置统一在头部右端。
           * 于是「删掉这条」这个动作不再依赖「这条是不是批次」，用户不必记两套位置。
           *
           * 为什么用图标：头部是标题行，右侧已经有耗时 / 类型 / 状态 / 通过按钮；
           * 再塞一个两字中文会跟标题抢宽度，而垃圾桶是这行里唯一的破坏性动作，
           * 图标 + 红描边既省地方也不容易误点错行。
           *
           * title / aria-label / data-tip 三者措辞**按类型换句子**：
           * 批次是「删除整批」（会连带子任务），普通条目是「删除这条计划」。
           * 图标没有文字，读屏与悬停全靠这几个属性，措辞必须说清后果。
           *
           * 执行中（running）不给：正在跑的条目删掉会打断模型，与底部那排的取舍一致。
           */
          /**
           * id=376：待执行的「转为草稿」也搬到头部，排在垃圾桶**左边**。
           *
           * 顺序是刻意的：转草稿是「还能撤回的安排」、删除是「不可恢复」，
           * 破坏性更强的那个永远在最右端 —— 手滑滑到底撞到的是删除，
           * 所以更该让它离别的控件远一点、也让人有更长的移动距离可以反悔。
           *
           * 为什么文字按钮能进头部（而删除必须用图标）：头部已经有标题在抢宽度，
           * 两个中文占的地方不小，但它只在待执行组出现（别的组不渲染），
           * 且 `.plt-head-demote` 里给了 `flex:0 0 auto` + 窄屏收一档，
           * 最坏情况是标题先截断（.plt-name 是 flex:1 1 auto，本来就该让位）。
           * 反过来，把「转草稿」做成图标会与垃圾桶混淆 —— 两个都是图标时，
           * 用户在高频操作里更容易点错那个不可恢复的。
           *
           * 批次与单任务**同一个位置、同一个形态**：题面要求的「一视同仁」。
           * 这需要同时放开 canDemote 里对批次的排除（见 60-tab.js 的注释）。
           *
           * 行为一字未动：仍是 onDemote（→ moveToGroup([item.id], true) → call('update')），
           * 与底部文字按钮同一条通道。
           */
          canDemote === true
            ? h(
                'button',
                {
                  className: 'plt-btn plt-head-demote',
                  type: 'button',
                  disabled: busy,
                  title: '转为草稿：退出执行队列，存进草稿组',
                  'aria-label': '转为草稿',
                  'data-tip': isParent === true ? '转为草稿：整批退出执行队列，存进草稿组' : '转为草稿：退出执行队列，存进草稿组',
                  onClick: (e) => {
                    // 头部整行是展开/收起的热区，按钮必须自己吃掉点击。
                    e.stopPropagation()
                    if (typeof onDemote === 'function') onDemote()
                  },
                },
                '转为草稿',
              )
            : null,
          (groupKey === 'reviewed' || (groupKey === 'todo' && running !== true))
            ? h(
                'button',
                {
                  className: 'plt-btn plt-icon-btn plt-trash plt-head-del',
                  type: 'button',
                  disabled: busy,
                  title: isParent === true ? '删除整批（含全部子任务）' : '删除这条计划',
                  'aria-label': isParent === true ? '删除整批' : '删除这条计划',
                  'data-tip': isParent === true ? '删除整批：父节点与它的全部子任务一起删掉' : '删除这条计划',
                  onClick: (e) => {
                    // 头部整行是展开/收起的热区，按钮必须自己吃掉点击。
                    e.stopPropagation()
                    if (typeof onRemove === 'function') onRemove()
                  },
                },
                h(TrashIcon, { size: 13 }),
              )
            : null,
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
                // id=371：只传 groupKey（耗时节点的显示条件要用它）。
                // busy / onPatch 已随「单个通过」按钮一起移除，理由见 KidsList 顶部。
                groupKey,
              }),
              // 原始提示词仍留在最下面：这一批当初是根据哪句话拆出来的。
              // id=375：待执行组的批次默认展开（默认值在 Item 顶部的 sourceOpen 算，
              // 这里不重复判断 —— 否则「默认值」与「渲染条件」会变成两处口径）。
              // 按钮行为不变：点一下仍可收起，收起后就只留这一行标题。
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
                    sourceOpen ? h('div', { className: 'plt-source' }, sourceText !== '' ? sourceText : '（加载中…）') : null,
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
                  // id=359：已审核组里整批删除已经在头部右侧了（plt-head-del），
                  // 这里不再重复画一颗 —— 两处都调 onRemove(item.id)（父连带整批），
                  // 是同一件事，留两个入口只会让人犹豫该点哪个。
                  // id=374：待执行（todo）的整批删除也搬到头部了，原因同上 ——
                  // 而且这一档还要求「拆分的与单任务一视同仁」，所以两者的删除
                  // 必须落在同一个位置（头部右端），不能再一个在头、一个在底。
                  // 只剩待审核 / 草稿两档仍把「删除整批」留在这里：
                  // 它们的头部没有删除图标，删掉这一颗就真的没入口了。
                  running || groupKey === 'reviewed' || groupKey === 'todo'
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
                    // id=368：「通过」已经从这一排搬到**头部**（见上面那颗 plt-head-pass）。
                    // 这里不再画第二颗 —— 同一屏出现两个「通过」，一个在收起时可见、
                    // 一个展开后才出现，用户会犹豫该点哪个，而它们其实是同一个动作。
                    // 展开区的这一排保留复制类按钮（ID / 内容 / 提示词），它们仍然需要在
                    // 读到正文之后才用得上。
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
              //
              // id=375 补一句：上面这段理由现在**只适用于单任务**。
              // 拆解批次的默认值改成了「待执行组里默认展开」（见 Item 顶部
              // sourceOpen 那段注释）。这里是单任务那条渲染路径 —— 单任务没有
              // 子任务列表，展开区里就只剩这段原文，标题又已经压自同一段提示词，
              // 默认展开只是把卡片撑成两倍高、信息还是重复的，所以保持折叠。
              // 两条路径共用一个 sourceOpen，但默认值按 isParent 分派，
              // 因此这里渲染出的仍然是折叠态（除非用户自己点开）。
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
                    // id=375：同父批次路径 —— 默认展开后首屏可能还没有全文，
                    // 渲染空框会是一块有边框有内边距的空白。单任务默认仍是折叠，
                    // 但用户点开那一刻 detail 也可能还没回来，所以同样要兜。
                    sourceOpen ? h('div', { className: 'plt-source' }, sourceText !== '' ? sourceText : '（加载中…）') : null,
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
                  // id=376：「转为草稿」已搬到头部（见上方那颗 plt-head-demote），
                  // 这里不再重复画一颗。搬运的理由与删除那颗一样 ——
                  // 待执行是逐条排队的清单，用户要先把不合意的几条退回去，
                  // 这不需要先展开卡片读正文；而且拆分的批次与单任务的
                  // 位置必须一致（题面要求），否则又变成两套记法。
                  // 与其他「已搬到头部」的按钮不同，这一颗不保留任何兜底：
                  // 它只在待执行组出现，而待执行组的头部一定画得出来
                  //（canDemote 与头部那颗用的是同一个条件）。
                  /**
                   * id=374：待执行的删除入口已从这一排**上移到头部右端**
                   *（见上方那颗 plt-head-del 的注释），这里不再重复画一颗。
                   *
                   * 原来这颗是 id=353 加在这里的：当时理由是「这一排已有两个文字按钮，
                   * 再加第三个会挤成两行」。那个理由仍然成立，只是结论要换个位置 ——
                   * 待执行的删除不该在展开区里等用户先展开卡片，而头部右端本来就是
                   * 已审核那一档删除的位置。两档统一过去，「删除这条」在待执行与已审核
                   * 里的位置就一致了，批次与单任务也一致（题面要求的「一视同仁」）。
                   *
                   * .plt-icon-btn / .plt-trash 这两个类没有废弃：头部那颗仍在用它们，
                   * 尺寸与删除色同源，只是挪了宿主节点。
                   */
                  // 执行中的条目整排操作都不给：转草稿/删除直接隐藏，不留灰按钮。
                  // 待执行栏的删除已经在头部（id=374），这里不再重复放文字按钮 ——
                  // 一栏只留一个删除入口，免得用户犹豫该点哪个。
                  // id=359：已审核那一档的删除也在头部（plt-head-del）。
                  // 于是头部有删除图标的两档（待执行 / 已审核）底部都不再画；
                  // 待审核 / 草稿两档的头部没有删除图标，底部这颗必须留着，
                  // 否则这两个入口就真的丢了。
                  running === true || groupKey === 'todo' || groupKey === 'reviewed'
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
