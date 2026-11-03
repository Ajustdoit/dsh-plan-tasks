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
      // id=89-D：`delivered` 由上层透传 —— 子任务的「执行中」也要按派发记录判定。
      // id=fzTvER-C：`parentSeq` / `parentId` 也一并透传 —— 子任务行要显示成
      // `1 # QSX45D -A`（序号与父相同 + 父 id + 空格 + 后缀），不再各自从 1 编号。
      const { kids, groupKey, delivered, parentSeq, parentId } = props
      // 父 id 的文本形态，用于和后缀拼接。
      const parentIdText = String(parentId ?? '').trim()
      return h(
        'div',
        { className: 'plt-kids-list' },
        kids.map((child) => {
          const status = statusOf(child, false, delivered)
          const durText = fmtDur(child.time)
          const note = String(child.note ?? '')
          // id=360/361：子任务编号（形如 `PddZRy-A`）由宿主在读投影里派生好（store.js 的
          // toLiteItem 与 api.js 的 detail 各给一份，见 docs/subtask-numbering.md），
          // 这里只负责画，不再从 id 里切字符串 —— 同一个规则只留一份实现。
          //
          // id=86-B：原来这里写着「为什么不拼 `#`」——那时候编号是 `2-A` 这种纯序号形状，
          // 跟顶层的 `#12` 是两种记号，混着读别扭。id 改成随机 6 位后，
          // 子任务编号变成 `PddZRy-A`，与顶层 `#PddZRy` 是同一种身份形状，
          // 统一加 `#` 反而是消歧而不是制造歧义。该决定已由用户确认。
          //
          // 空值处理（题面要求）：编号文本为空时**整个节点不渲染**，
          // 也不留一个固定宽度的空槽 —— 手工新建的条目没有父子关系，
          // 给它留编号位就等于凭空多出一段缩进，标题会比别的行短一截还找不到原因。
          //
          // id=86-B：`code` 缺失时回退到 `child.id`。
          // `code` 由宿主在 lite 投影里派生（store.js 的 toLiteItem），正常一定有；
          // 但若调用方拿了未投影的 children（没传 lite:true），就会变成「子任务没有编号」——
          // 那是**身份丢失**，比显示一个 id 更糟。回退到 id 至少还能对上号；
          // 两者都空才真的不渲染。
          // 这里绝不能直接模板化 null/undefined，否则会渲染出 `#undefined`。
          const rawCode = String(child.code ?? '').trim()
          const codeText = rawCode !== '' ? rawCode : String(child.id ?? '').trim()
          // id=fzTvER-C：把完整子 id 拆成「父 id + 后缀」，供新格式使用。
          //
          // 子 id 形如 `QSX45D-A`（父 6 位随机 + `-` + 后缀）。
          // 后缀可能是 A / Z / AA（见 ids.js 的 childSuffix：0→A、25→Z、26→AA），
          // 所以只切**第一个** `-` 之后的全部，不能只取一个字母。
          //
          // 拆不出来（没有 `-`，或前半段与 parentId 不一致）就退回原样显示，
          // 不做任何猜测 —— 猜错会把别的节点的后缀挂到这一行上。
          const suffix = (() => {
            const at = codeText.indexOf('-')
            if (at <= 0 || at === codeText.length - 1) return ''
            const head = codeText.slice(0, at)
            // 前半段必须就是父 id，否则说明这条不是这一批的孩子（历史数据 / 数据异常）。
            if (parentIdText !== '' && head !== parentIdText) return ''
            return codeText.slice(at + 1)
          })()
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
              //
              // id=86-B：**改为与顶层一致，也带 `#` 前缀**。
              //
              // 原先这里刻意不带 `#`，理由是「父已用组带子任务，`2-A` 连读就是第2组A条，
              // 再加 `#` 成了两种记号混排」。该理由在 id 改为随机 6 位后不再成立：
              // 子任务编号现在是 `PddZRy-A` 这种，它和顶层的 `#PddZRy` 是同一种身份形状，
              // 用户的诉求是「列表里所有编号统一成 #xxx」。混排问题反而因为统一前缀而消失。
              // id=fzTvER-C：新格式 `1 # QSX45D -A` ——
              //   序号与**父条目相同**（子任务不各自从 1 编号），
              //   后面是父 id + 空格 + 子任务的后缀。
              //
              // 为什么序号跟父一样：子任务是这一批的组成部分，不是独立排位。
              // 若各自从 1 编号，展开一组后会出现「1 号父下面挂着 1、2、3 号子任务」，
              // 两套编号在同一屏里打架，用户没法用「3 号」指代任何东西。
              //
              // 后缀拆不出来时（suffix === ''）退回原来的 `#codeText`，
              // 保证身份永远可见 —— 格式可以退化，身份不能丢。
              codeText !== ''
                ? h(
                    'span',
                    {
                      className: 'plt-kid-code',
                      // 复制不了也点不了，只是视觉定位；读屏念一遍编号同样是有效信息。
                      'data-tip': `编号 #${codeText}`,
                    },
                    Number.isFinite(parentSeq) && parentSeq > 0
                      ? h(
                          'span',
                          { className: 'plt-kid-id' },
                          h('span', { className: 'plt-seq' }, String(parentSeq)),
                          ' ',
                          h('span', { className: 'plt-id-hash' }, '#'),
                          ' ',
                          parentIdText !== '' ? parentIdText : codeText,
                          suffix !== '' ? h('span', { className: 'plt-kid-suffix' }, ` -${suffix}`) : null,
                        )
                      : `#${codeText}`,
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
              // id=383：子任务这一行的耗时原本就有，但显示条件里少了一种情况 ——
              // 它是 `durText !== ''`（无耗时就整个节点不渲染）。待审核组里每条子任务
              // 都跑过了，所以正常情况都有数字；可一旦 time 缺失/为 0
              //（老数据、手工改过的 plan.json、或执行没来得及回填），
              // 那一行就比同组别的行**少一截**，看起来像渲染坏了而不是「这一条没有耗时」。
              // 现在待审核/已审核两组统一给兜底「—」：
              //   · 有数字 → 照旧显示（3分钟47秒）
              //   · 没数字 → 显示 —，占位与字号都和数字一致，纵向扫视时这一列是齐的
              // 与单任务那一行用同一套兜底（见上方 item 的 durText 处），
              // 所以「拆解的子任务」和「单任务」在待审核里长得一样。
              (groupKey === 'unreviewed' || groupKey === 'reviewed')
                ? h(
                    'span',
                    {
                      className: `plt-dur${durText === '' ? ' is-empty' : ''}`,
                      'data-tip': durText === '' ? '这条任务没有记录耗时' : `这条任务耗时 ${durText}`,
                    },
                    durText === '' ? '—' : durText,
                  )
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
      // id=405：草稿模式移除后，onPromote / onDemote / canDemote / editable 四个 prop
      // 一并从解构里删掉 —— 它们只服务草稿组（转进 / 转出 / 就地编辑），组没了就没对象。
      const { item, seq, open, detail, onToggle, onPatch, onRemove, onFetchDetail, busy, dragging, dropTarget, dropped, onDragStart, onDragOver, onDrop, onDragEnd, dragEnabled, selectable, selected, onSelect, showExecute, showReview, groupKey, impliedRunning, canPin, onPinTop, onApproveBatch, delivered } = props
      // id=273：父节点（带 children 的拆解批次）只当容器 —— 它没有正文、不参与执行，
      // 标题行就只显示原始提示词标题（name 本身就是从 sourcePrompt 压出来的），
      // 展开后交给下面的子任务列表，父自己的「计划 / 备注」一块都不渲染。
      const kids = Array.isArray(item.children) ? item.children : []
      const isParent = kids.length > 0
      const groupCount = isParent
        ? kids.filter((c) => statusOf(c, false, delivered).key === 'todo' || statusOf(c, false, delivered).key === 'running').length
        : 0
      const status = statusOf(item, impliedRunning === true, delivered)
      const time = fmtTime(item.time)
      // id=178：标题行的紧凑耗时（毫秒走 fmtDur）。空串代表缺失/0/非法，整节点不渲染。
      //
      // id=383：**批次的耗时改从子任务汇总**。
      //   父节点自己是容器，从不执行，所以 `item.time` 恒为 0（落盘里确实是 0）。
      //   原来这里只读父自己的 time，于是「单任务有待耗时、拆解批次没有」——
      //   待审核组里两条并排、一条有数字一条光秃秃，用户看到的就是「拆解任务没显示耗时」。
      //   真正的耗时在每个 child 上（每个子任务跑完各记各的），汇总才是这一批的答案。
      //
      //   取 sum 而不是 max/last：一个批次的总开销就是各段之和，
      //   而 max 会把「三条各 2 分钟」说成 2 分钟，跟用户排队等待的实际感受不符。
      //   没有 time 的子任务按 0 计；全为 0 时 fmtDur 仍返回空串，整节点缺席
      //   （与单任务「缺失/0 就不画」的口径一致）。
      const batchMillis = kids.reduce((sum, c) => sum + (Number(c?.time) > 0 ? Number(c.time) : 0), 0)
      const durText = fmtDur(isParent ? batchMillis : item.time)
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
      // 「复制提示词」只给待执行及之后的真实任务卡（没有出处的不给）；
      // 没有原始提示词的条目（手工提交的）直接不渲染按钮，而不是给一个点了没反应的空壳。
      const canCopyPrompt = groupKey !== 'draft' && sourceLen > 0
      const [copied, setCopied] = React.useState('')
      // 「原始提示词」的展开状态。
      //
      // 默认值（id=375 起，id=387 扩到待审核）：
      //   · 待执行里的**拆解批次**  → 展开（id=375）
      //   · 待审核里的**所有条目**  → 展开（id=387，本步）
      //   · 其余一律折叠
      //
      // 为什么待审核也要放开（题面：「待审核里面的原始提示词 需要自动展开」）：
      //  待审核是**核对**的地方 —— 要判断「模型交的这份活对不对」，必须能对照
      //  当初的要求。原来这段原文默认折着，等于让人先点开再评审，
      //  而这恰恰是审核动作里最该摆在眼前的依据。
      //  与待执行不同，这里不区分是不是拆解批次：审核时单任务同样需要原文对照，
      //  题面说的也是「里面的」而不是「拆解任务的」。
      //
      // 为什么敢默认铺开：`.plt-source` 自带 `max-height:200px; overflow:auto`，
      //  再长的需求也封顶 200px 并在内部滚动，不会把卡片撑成一条。
      //
      // 仍然不放开的两档：
      //  · 已审核：那时已经定稿，用户多半是回看结果，铺开原文只会盖住执行结果；
      //  · 待执行里的单任务：没有子任务列表，展开区只剩这段原文，
      //    而标题已经压自同一段提示词，默认展开只是把卡片撑成两倍高（id=375 定的）。
      //
      // 状态仍是本地 useState、仍可手动收起/展开（按钮一字未改）。
      // 只在初次挂载时取这个默认值：条目换组时是整棵子树重新挂载
      //（各组是独立容器），所以会按新组重新取默认，不会把旧状态带过去。
      const [sourceOpen, setSourceOpen] = React.useState(
        (groupKey === 'todo' && isParent === true) || groupKey === 'unreviewed',
      )
      // id=405：草稿就地编辑整套（editing / draftText / saveState / 自动保存定时器 /
      // 卸载补写逻辑）随草稿模式一并删除 —— 草稿组已不存在，没有可编辑的对象。
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
        //
        // id=86-C：**id 只出现一次，且必须是当前任务的真实 id**。
        // 这里用一个局部变量把取值收敛掉，避免三件事：
        //   1. 模板里直接写 `item.id` —— id 缺失时会复制出「任务id:undefined」，
        //      粘到会话里既没用又会误导模型（它可能真去按 undefined 找任务）；
        //   2. 将来有人在别处再拼一次前缀，变成「任务任务id:80」那种重复；
        //   3. 复制到历史数字 id（80）与随机 id（a1b2c3）时出现两种格式。
        // 前缀固定为 `任务id:`，候值是任务当前的 id（历史数字原样、随机 6 位原样）。
        let payloadText = ''
        if (kind === 'id') {
          const currentId = String(item.id ?? '').trim()
          // 取不到 id 就不复制 —— 复制一个「任务id:」空壳比不复制更糟。
          if (currentId === '') return
          payloadText = `任务id:${currentId}`
        } else if (kind === 'prompt') {
          payloadText = source
        } else {
          payloadText = String(full ?? '')
        }
        const ok = await copyText(payloadText)
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
          className: `plt-item${isParent ? ' plt-parent' : ''}${open ? ' open' : ''}${running ? ' running' : ''}${dragging ? ' dragging' : ''}${dropTarget ? ' drop-target' : ''}${dropped === true ? ' plt-dropped' : ''}${props.sublime === true ? ' plt-sublime' : ''}`,
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
          //
          // id=fzTvER-B：显示成 `1 # QSX45D` ——
          //   · 前面是**该页签内的位置**（1 起），由上层传下来的 `seq`；
          //   · 后面是**原始 id**，一字不改。
          //
          // 为什么两者都要：序号回答「排到第几个」，id 回答「是哪一条」。
          // id 仍是点击、复制、派发的唯一依据 —— 这里只是多显示一个序号，
          // 展示层不动任何数据的 id（`item.id` 原样用于 key / 事件 / 复制）。
          //
          // `seq` 取不到（0 / 非数字）时只显示 `# id`：
          // 硬编一个「1」会让所有查不到的条目都显示成第 1 条，比不显示更误导。
          //
          // 拆成两个 span 而不是拼成一个字符串：序号要弱化（浅色、小一号），
          // 混在一个文本节点里就没法单独上色了。
          Number.isFinite(seq) && seq > 0
            ? h(
                'span',
                { className: 'plt-id' },
                // 格式固定为 `1 # QSX45D`（题面要求：序号 + 空格 + # + 空格 + 原 id）。
                // 三个 span 之间必须显式写出空格字符串 —— 相邻的行内元素在 HTML 里
                // 不会自动插入空白，不加就会渲染成 `1#QSX45D`。
                h('span', { className: 'plt-seq' }, String(seq)),
                ' ',
                h('span', { className: 'plt-id-hash' }, '#'),
                ' ',
                String(item.id),
              )
            : h('span', { className: 'plt-id' }, `# ${item.id}`),
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
          (groupKey === 'unreviewed' || groupKey === 'reviewed')
            ? h(
                'span',
                {
                  className: `plt-dur${durText === '' ? ' is-empty' : ''}`,
                  'data-tip': durText === '' ? '这条任务没有记录耗时' : `这条任务耗时 ${durText}`,
                },
                durText === '' ? '—' : durText,
              )
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
          //
          // id=399：**但槽位不该在没有后续内容时也占位**（题面：待审核通过按钮右侧有间距，
          // 想靠右一点、与其它组保持一致的右边距）。
          //
          // 间距的来源就在这个槽位：它恒定 20px，而待审核组（id=368）与已审核组（id=358）
          // 都**不再画状态徽标**，头部最后一颗控件之后就没有东西了 ——
          // 于是那 20px 成了一段纯空白，加上 .plt-head 的 gap，
          // 通过按钮看起来比别的组往里缩了一截。
          //
          // 修法：只有当这一行**后面还有东西要画**时才保留槽位。
          // 「后面还有东西」的判定与下面状态徽标那段完全同源：
          //   · running                → 画转圈徽标
          //   · 待执行/待审核/已审核   → 不画（id=407 起待执行也不画了）
          //   · 其余（失败/已中断）    → 画文字徽标
          // 这样槽位的存在与否跟「右边到底有没有东西」严格一致，
          // 不会出现「留了位置却空着」或「没留位置结果把徽标挤出去」。
          //
          // 注意：id=320 原本要求「同一组内部一律留槽」，那是因为当时三组都要画徽标。
          // id=407 之后待执行也不画了，于是整个待执行组都不收这个槽 —— 组内仍然对齐，
          // 与待审核/已审核同一口径。
          //
          // id=402：**整块从复制组之后搬到它之前**（题面：置顶放在 id 按钮前）。
          //
          // 位置变化：原来顺序是 [复制ID][复制内容][置顶槽]，现在变成
          // [置顶槽][复制ID][复制内容]。置顶是"把这条往前挪"的动作，
          // 放在复制之前更符合"先安排位置、再取内容"的读序。
          //
          // 注意**没有**破坏上面 id=319 那条约束：置顶仍然排在状态徽标之前。
          // 整块只是从复制组后方移到前方，与徽标的前后关系一字未动。
          // 也没动复制组自身的渲染条件（三组白名单）。
          // id=gR3lBM：**置顶槽位只在真的能放出置顶按钮时渲染**。
          //
          // 原来条件是「执行中 / 失败 / 已中断都画槽」，但槽里那颗按钮的条件是
          // `pinTop = canPin && running !== true`：
          //   · 执行中的行 —— running 为真 → 永远拿不到按钮；
          //   · 拆分父（有 decomposeKey，canPin 恒假）→ 也永远拿不到。
          // 于是这些行渲染出一个**空槽**，DOM 位置正好夹在「N 条」徽标与
          // 「复制 ID」按钮之间（439 行 vs 498 行），表现为
          // **20px 槽宽 + 两侧各 8px gap = 36px 的纯空白** —— 用户报的就是这段。
          //
          // 修法：条件收敛成 `pinTop === true`。
          // 这样「有槽必有按钮、没按钮就没槽」，不会再有「留了位置却空着」。
          //
          // 代价（已与用户确认接受）：执行中 / 失败 / 已中断这几行的状态徽标会
          // 比之前靠左 28px。这不影响跨行对齐 —— 徽标是行尾最后一个元素，
          // 每行都紧贴自己的行尾，右边界仍然一致；只是不再被一段空槽人为推开。
          //
          // 待执行组不受影响：那里 pinTop 与 drawPin 一致（有按钮时才画），
          // 原本就有按钮的行照旧。
          pinTop === true
            ? h(
                'span',
                { className: 'plt-pin-slot' },
                h(
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
                ),
              )
            : null,
          // id=382：头部这颗「通过」**已移除**，改到待审核卡片的底部操作区，
          // 与「删除」并排成一对图标（[✓ 通过] [🗑 删除]）。
          //
          // 为什么不两处都留：一张卡上出现两颗「通过」（头部一颗胶囊、底部一颗图标），
          // 用户会犹豫该点哪个 —— 它们其实是同一个动作。这一点与 id=354/368 把「通过」
          // 搬去头部时的取舍相同，只是方向反过来了：当时是为了「不展开也能点」，
          // 现在的要求是「与垃圾桶图标同区对齐」，两者都要，只能选一处。
          //
          // 选底部操作区之后的一个代价（如实记录）：待审核卡在**收起状态**下不再有
          // 通过入口，要先展开卡片才看得到这一排。这是题面明确指定的位置，不是疏忽；
          // 若以后想找回「收起也能逐条过」的手感，正确做法是在头部加图标
          // （与这里同尺寸），而不是把文字胶囊再加回来。
          // id=389：待审核卡片的「复制 ID / 复制内容」搬到**头部**（题面要求）。
          // id=393：待执行组的同样搬到头部（题面：待执行里面 复制id 和内容 也放在头部）。
          //
          // 为什么放头部：这两个复制动作是「把这条的正文取走」—— 复制完就去别处用，
          // 不需要先展开正文。放在展开区里，每条都要点开才够得着，与 id=382 把「通过」
          // 搬到底部操作区是同一类取舍：高频动作不该藏在展开态后面。
          //
          // 覆盖范围现在只有这两组：待审核（id=389）+ 待执行（id=393）。
          // 已审核保持原样 —— 题面两次都只点了具体的组名，不顺手扩大。
          //
          // 形态用头部复制按钮那套文字胶囊样式：
          // 头部不能塞图标 —— 与垃圾桶并排时两个图标容易点错，
          // 而复制是无害动作、删除是破坏性的，形状上就该分得开。
          //
          // 「复制内容」在几个组里的差异：
          //   · 拆解批次（isParent）→ **原始提示词**。父自己没有正文（plan 恒为空），
          //     对它来说「内容」就是这批任务当初的需求原文。
          //   · 普通条目 → 自己的计划正文。
          // 两种情况都可能需要 detail 取全文，doCopy 已按 kind 分别处理。
          //
          // id=396：已审核也纳入（题面：已审核里面也将复制id和内容放在头，
          // 展开里面移除这两个按钮）。三组齐全了：待执行 / 待审核 / 已审核。
          // （id=405：草稿组已删除，原来关于「草稿不纳入」的说明随之作废。）
          //
          // 已审核的「复制内容」为什么也是批次取提示词：
          // 已审核里既有单任务也有整批（整批审完会连父带 children 一起归档），
          // 而归档的父同样没有正文 —— 判定沿用同一个 isParent，无需另立规则。
          groupKey === 'unreviewed' || groupKey === 'todo' || groupKey === 'reviewed'
            ? h(
                'div',
                { className: 'plt-head-copies' },
                // 复制 ID：所有条目都有（id 是身份）。
                h(
                  'button',
                  {
                    className: `plt-btn plt-head-copy${copied === 'id' ? ' done' : ''}`,
                    type: 'button',
                    title: `复制这条计划的 ID（${item.id}）`,
                    'aria-label': '复制 ID',
                    'data-tip': `复制这条计划的 ID（${item.id}）`,
                    onClick: (e) => {
                      e.stopPropagation()
                      void doCopy('id')
                    },
                  },
                  copied === 'id' ? '已复制' : 'ID',
                ),
                (isParent === true ? sourceLen > 0 : canCopyPlan === true)
                  ? h(
                      'button',
                      {
                        className: `plt-btn plt-head-copy${copied === (isParent === true ? 'prompt' : 'plan') ? ' done' : ''}`,
                        type: 'button',
                        disabled: isParent === true && sourceLen === 0,
                        title: isParent === true ? '复制这一批的原始提示词' : '复制这条计划的完整内容',
                        'aria-label': isParent === true ? '复制原始提示词' : '复制内容',
                        'data-tip': isParent === true
                          ? `复制这一批的原始提示词（${sourceLen} 字）`
                          : '复制这条计划的完整内容',
                        onClick: (e) => {
                          e.stopPropagation()
                          void doCopy(isParent === true ? 'prompt' : 'plan')
                        },
                      },
                      copied === (isParent === true ? 'prompt' : 'plan') ? '已复制' : '内容',
                    )
                  : null,
              )
            : null,
          // id=390：待审核的「通过」搬到**头部**（题面：通过放在头部，不再放在展开里面）。
          //
          // 位置在复制组之后、置顶槽 / 状态徽标之前 —— 这样右侧状态那一列仍然对齐
          //（id=320 的「槽位恒定」约定不为它让路）。
          //
          // 为什么放头部：审核是逐条扫读的动作。通过按钮藏在展开区里，意味着
          // 每审一条都要先展开、找到按钮、再收起 —— 而「这条做完了没有」看标题
          // 就够了，根本不需要读正文。搬到头部之后，待审核组在**收起状态下**
          // 就是一张可以逐条点过的清单。
          //
          // 形态：图标按钮（CheckIcon），与旁边的复制胶囊同高 26px，
          // 但用 .plt-pass-icon 的实色描边强调「这是推进状态的动作」，
          // 与复制那种中性动作在颜色上分开。
          //
          // 两类条目共用同一位置，用 isParent 分派动作（与 id=354/368 完全一致）：
          //   批次 → onApproveBatch（一次改完整批）
          //   普通 → onPatch({ review: true })
          // running 时两颗都不画：执行中还没有结果可审。
          ((isParent === true && status.key === 'unreviewed') || (isParent !== true && showReview === true && running !== true))
            ? h(
                'button',
                {
                  className: 'plt-btn plt-icon-btn plt-pass-icon plt-head-pass-btn',
                  type: 'button',
                  disabled: busy === true || (isParent !== true && item.review === true),
                  title: isParent === true ? '通过：把这一批标成已审核' : '通过：标记为已通过',
                  'aria-label': isParent === true ? '整批通过' : '通过',
                  'data-tip': isParent === true
                    ? `整批通过：把这一批 ${kids.length} 条子任务一起标成已审核`
                    : '人工审核这一条的执行结果：标记为已通过',
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
                h(CheckIcon, { size: 13 }),
              )
            : null,
          /**
           * 状态徽标（id=352-D）。
           *
           * 执行中不再显示「执行中」三个字，只留一个转圈：这一列是竖着扫的，
           * 三个字占的宽度随字号变，而图标是一个定宽方块 —— 一列里只有它一个「词」，
           * 眼睛会被反复拉过去。转圈本身已经把「在跑」说清楚了。
           *
           * 尺寸（见 .plt-tag.running / .plt-tag.plt-run-only）：外框固定 26×20，与文字徽标
           * 的行高 20px 对齐，所以整列右边界不会因为这一条从文字变成图标而移动。
           * 其余状态（待执行/待审核/失败/中断）一个字都没改。
           * id=407：待执行现在也不画标记了（原先是空心圆点），所以只剩失败/中断那两档还画文字徽标。
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
           *
           * id=401：**待执行这一档从文字改成一个空心圆点**（题面：待执行组里
           * 显示一个文字不好看，换一种展示方式）。
           *
           * 为什么不是像待审核/已审核那样直接不画：
           * 待执行组里**不只有 todo**。执行中的显示转圈、失败的显示「失败」、
           * 中断的显示「已中断」—— 所以这一列是有内容的，不能整体留空。
           * 而「正常待执行」是组内主体，占绝大多少行；每行挂一个「待执行」
           * 等于把组名重复 N 遍，还都是同一个词，扫视时这一列毫无信息量。
           *
           * 空心圆点的语义：一个还没被勾掉的待办。它与执行中的转圈形成一组对照
           *（空圈 = 还没开始 / 转圈 = 正在跑），比文字更轻，也更容易在一列里
           * 一眼扫出「哪些还没动」。
           *
           * 尺寸仍是固定的 20×20 外壳（与文字徽标行高一致），所以这一列右边界
           * 不会因为某行从点变成字而移动 —— 与 id=352-D 给转圈定的规矩同源。
           * 点本身 7px + 1.5px 描边，颜色取 caption 而非组色：
           * 它是「尚未开始」的状态标记，不是组身份，用中性色才不会跟
           * 组头的彩虹 accent 打架。
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
            // id=407：待执行**不再画状态标记**（题面：这条设计方式不要了）。
            // 原来是 20px 的透明胶囊里放一颗 7px 空心圆点 —— 单独看还行，
            // 但它与「执行中」的转圈、其它状态的字徽标挤在同一列，
            // 而待执行组本身已经有组色（绿）标识身份，再挂一个灰圆点属于重复表达。
            // 现在三组统一：组名说明状态时不画徽标（待审核/已审核同理）。
            : status.key === 'todo' || status.key === 'reviewed' || status.key === 'unreviewed'
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
          // id=405：头部这颗「转为草稿」按钮随草稿模式删除。
          // 它的唯一去向是草稿组，草稿组已不存在。
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
                // id=89-D：子任务的「执行中」也按派发记录判定，与父同一份数据。
                delivered,
                // id=fzTvER-C：父的序号与父 id —— 子任务行要显示成
                // `1 # QSX45D -A`：**序号与父条目相同**，不各自从 1 开始。
                //
                // 这两个值父组件本来就有（`seq` 是渲染时传进来的，`item.id` 就在手边），
                // 直接传下去即可，不需要去 children.js 里补字段，也不用客户端二次推算：
                // 子任务在同一批里共享父的位置，这是「位置」的语义，不是「身份」的语义。
                parentSeq: seq,
                parentId: item.id,
              }),
              // 原始提示词仍留在最下面：这一批当初是根据哪句话拆出来的。
              // 默认展开的组：待执行（id=375，批次）与待审核（id=387，全部）——
              // 默认值统一在 Item 顶部的 sourceOpen 算，这里不重复判断，
              // 否则「默认值」与「渲染条件」会变成两处口径。
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
              // id=395：批次这一档的 .plt-meta（子任务数 / 创建时间）**保留独立一行**。
              //
              // 题面说的是「计划那一排右侧」—— 而批次卡片**没有**「计划」那一排：
              // 父自己的正文恒为空，展开区的第一块直接就是子任务列表 + 原始提示词
              //（见上方 plt-body-parent 的注释）。没有可并入的行，硬塞就会变成
              // 在子任务列表中间插一行读数，比原来更乱。
              // 所以这里的取舍是：单任务合进「计划」排（题面明确要求），
              // 批次维持原样。等批次有了自己的标题行再说，不为对齐而制造新的一行。
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
                  // id=382：待审核这一档的两颗按钮改成**图标**，且并排放在同一排里：
                  //   [✓ 通过] [🗑 删除整批]
                  // 两者共用 .plt-icon-btn 的尺寸与热区、共用同一套 hover/disabled 规则，
                  // 只有颜色不同（通过走主色、删除走删除色），右对齐与间距由 .plt-actions 保证。
                  //
                  // 为什么这一档要改：待审核是唯一「两个动作都高频」的分组 ——
                  // 一条看完要么通过、要么删掉重写。原来是「头部通过 + 底部删除整批」，
                  // 一个在上一行、一个在下一行，且一个是胶囊一个是文字，扫视时对不齐。
                  // 收进同一排之后，一行就是一次决策。
                  //
                  // id=386：待审核**不再提供删除入口**（题面：将删除功能去除）。
                  //   这一档只保留「通过」——审核的唯一动作就是把这条标成已通过。
                  //   想删的话，正确路径是先在别处处理它再删，
                  //   而不是在「正在评审」的这一步顺手把证据删掉。
                  //   一并说明：删掉图标之后，这一档**不能**再落到下面那个
                  //   「文字删除」的兜底分支（否则只是把图标换回文字，等于没删）——
                  //   所以兜底条件里也加上了 groupKey === 'unreviewed'。
                  // id=390：这一档的「通过」也已搬到**头部**（见上方 plt-head-pass-btn）。
                  // 展开区因此**什么都不画** —— 待审核卡片的操作全部收在头部，
                  // 展开只是用来看正文，不再承载动作。
                  // 仍然保留 groupKey === 'unreviewed' 分支（返回 null）而不是删掉它：
                  // 让下面那个 `: running || ...` 的兜底条件无需再改一次，
                  // 也让「待审核这一档由谁处理」在代码里仍然一目了然。
                  groupKey === 'unreviewed'
                    ? null
                    : running || groupKey === 'reviewed' || groupKey === 'todo'
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
                  // 「计划」标题右侧：复制内容、复制 ID。
                  h(
                    'span',
                    { className: 'plt-copy' },
                    // id=405：草稿就地编辑入口已随草稿模式删除。
                    // id=389/393/396：待审核、待执行、已审核这三组的复制按钮都已搬到**头部**
                    //（见上方 plt-head-copies）。
                    // 这里跳过它们，避免同一张卡上出现两个复制入口 ——
                    // 这两个动作在逐条扫读时是高频的，放头部就够得着，
                    // 展开区这一排因此只剩「提示词」那类补充复制。
                    // （id=405：草稿组已删除。）
                    //
                    // 三处条件必须与头部那个 `groupKey === 'unreviewed' || groupKey === 'todo'
                    // || groupKey === 'reviewed'` 保持一致 —— 否则会出现「头部有、展开区也有」
                    //（重复）或「两边都没有」（入口消失）。改一处就要改三处，
                    // 这是这段唯一的维护要点。
                    (groupKey === 'unreviewed' || groupKey === 'todo' || groupKey === 'reviewed' ? null : canCopyId === true)
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
                    (groupKey === 'unreviewed' || groupKey === 'todo' || groupKey === 'reviewed' ? null : canCopyPlan === true)
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
                    // id=382：「通过」现在在**底部操作区**，与「删除」并排成一对图标
                    //（见这一排上方 plt-actions 那段）。这里（展开区的复制按钮排）
                    // 本来就没有它 —— 第 368 号曾把它搬去头部，第 382 号又搬到下面；
                    // 两次都只留一个入口，理由一致：同一屏出现两个「通过」会让人犹豫。
                    // 展开区的这一排保留复制类按钮（ID / 内容 / 提示词），它们仍然需要在
                    // 读到正文之后才用得上。
                  ),
                  // id=395：创建 / 开始 / 耗时这些「时间戳」从原来**独占一行**的
                  // .plt-meta 搬到「计划」这一排的**右侧**（题面要求）。
                  //
                  // 为什么合进来：那行元信息本来就只有三四个短片段，
                  // 独占一行等于在「计划」标题和正文之间插了一条几乎空着的横带 ——
                  // 一行只为了放「创建：2026/10/30」。而「计划」标题右侧现在
                  // 只有复制类按钮（高频动作都已搬到头部，见 id=389/393/394），
                  // 那一侧本来就有富余空间，正好收进来。
                  //
                  // 位置放在 .plt-copy **之后**：复制按钮是操作，时间戳是说明性的读数，
                  // 读数该在操作更外侧（贴着行尾），这样整行读起来是
                  // 「计划 [复制…] [创建…]」，操作集中、说明收口。
                  // 形态用 .plt-sec-meta（见 15-detail.js）：更小的字号 + 更淡的颜色，
                  // 明确它是「附注」而不是和标题同级的第二个标题。
                  // 它在 .plt-sec-h 内部 → 与标题、复制按钮同一行（flex + align-items:center），
                  // 不会因为换行把这一排撑成两行（.plt-sec-h 本身不换行）。
                  h(
                    'span',
                    { className: 'plt-sec-meta' },
                    item.mode ? h('span', null, `模式：${item.mode}`) : null,
                    h('span', null, `创建：${fmtDate(item.createdAt) || '—'}`),
                    item.startedAt ? h('span', null, `开始：${fmtDate(item.startedAt)}`) : null,
                    time ? h('span', null, `耗时：${time}`) : null,
                  ),
                ),
                // id=405：草稿就地编辑框（textarea + 任务类型切换 + 保存状态 + 取消）
                // 随草稿模式一并删除 —— 它只在 editable（草稿组）时渲染。
                // 现在正文一律只读展示，与其它组一致。
                h('div', { className: 'plt-plan' }, planText || '（空）'),
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
              // id=375：上面这段理由现在**只适用于单任务的待执行档**。
              // id=387：待审核里的（含单任务）也默认展开了 —— 审核要对照原始需求，
              // 那段原文正是判断依据，藏在折叠里等于让人先点开再评审。
              // 现在两档默认展开、两档默认折叠：
              //   展开 = 待执行里的批次（id=375）｜ 待审核里的全部（id=387）
              //   折叠 = 已审核里的全部 ｜ 待执行里的单任务
              // 这里（单任务渲染路径）在待审核组里因此是**展开**的：
              // 两条路径共用同一个 sourceOpen，默认值在 Item 顶部统一算，
              // 本处不做第二次判断 —— 否则「默认值」与「渲染条件」会变成两处口径。
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
                // 「删除」统一收进右侧的 .plt-actions。
                h(
                  'div',
                  { className: 'plt-actions' },
                  // id=405：原来这里有一颗「转为待执行」（仅草稿组）。
                  // 草稿模式整体移除后它没有对象了 —— 不存在「在草稿里等人捞出来」的条目。
                  // id=376：「转为草稿」曾搬到头部，
                  // 这里不再重复画一颗。id=405 起那颗也随草稿模式删除了。
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
                  // 执行中的条目整排操作都不给：删除直接隐藏，不留灰按钮。
                  // 待执行栏的删除已经在头部（id=374），这里不再重复放文字按钮 ——
                  // 一栏只留一个删除入口，免得用户犹豫该点哪个。
                  // id=359：已审核那一档的删除也在头部（plt-head-del）。
                  // 于是头部有删除图标的两档（待执行 / 已审核）底部都不再画；
                  // 待审核档的头部没有删除图标，底部这颗必须留着，
                  // 否则这两个入口就真的丢了。
                  // id=382：待审核（非批次）这一档的两颗按钮也改成图标，并排在同一排：
                  //   [✓ 通过] [🗑 删除]
                  // 与父批次那条路径保持完全一样的形态 —— 一张卡上是批次还是单条，
                  // 用户不该看出两种排法。
                  //
                  // id=390：这一档的「通过」也已搬到**头部**（见上方 plt-head-pass-btn）。
                  // 展开区因此什么都不画 —— 待审核卡片的操作全部收在头部。
                  // 条件与头部那颗一致（isParent !== true 时看 showReview 与 running）。
                  // 行为一字未改：仍是 onPatch({ review: true })。
                  // id=386：删除按钮已去掉（题面「将删除功能去除」）。
                  // 保留这个分支（返回 null）而不是删掉它：让下面那个兜底条件无需再改，
                  // 也让「待审核这一档由谁处理」在代码里仍然一目了然。
                  groupKey === 'unreviewed'
                    ? null
                    : running === true || groupKey === 'todo' || groupKey === 'reviewed'
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
