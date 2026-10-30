# 执行循环与任务链路

> 任务 id=339（父批次 id=344）的梳理文档，已按 340/341 的落地更新。
> 所有位置都以仓库里真实存在的文件为准，写成 `文件:行号`；行号是写本文时的快照。

## 一句话结论

**插件里没有「执行循环」这段代码，但「下一条做什么」现在由代码决定。**

- 取哪一条：`lib/host/queue-cli.js` 的 `nextTask()`（纯函数，可单测）；
- 什么时候做下一条：**这一轮回答结束之后**，客户端在一个 turn 结束（running `true → false`）时
  调 `api.dispatch`，宿主把下一条任务写成一条新的用户消息投给会话。

所以「做完 → 回答 → 再做下一条」的顺序是**代码保证**的，不再靠模型自己读完技能再决定。
技能正文（`lib/host/skill.js` 的 `skillMarkdown()`）只描述「这一条怎么做」，不再描述循环。

## 链路（现状）

```
用户点「开始」
  │
  ├─ 客户端 startWork()
  │     ├─ call('dispatch', { dryRun, force }) 拿到与自动派发相同的正文
  │     ├─ 先试浏览器侧 kickoffViaClient 把这段正文发进会话
  │     └─ 发出去则 call('dispatch', { force, ack }) 只记账；否则由宿主 dispatch 代发
  │
  ├─ 宿主   api.js:819   API.kickoff({ ctx, sessionId, text })
  │     └─ ctx.get('sessionController').prompt(request, signal)
  │        request = { requestId, sessionId, mode:'queue', content:[{type:'text',text}] }
  │        → 左侧对话里出现一条用户消息，和用户自己敲「开始干活」等价
  │
  ├─ 模型侧：读 plan-tasks 技能（虚拟注册，见 skill.js:37 registerVirtualSkill）
  │     └─ 正文 = skillMarkdown()（skill.js:62）：只讲「怎么把这一条做对」
  │        一次只做一条（skill.js:81），循环由宿主推进
  │
  ├─ 每条命令都是一次 shell 调用：
  │     node .plan/q.mjs <status|done|fail> --id <id> --note "…"
  │     .plan/q.mjs 是 host/queue-cli.js 的副本（模板由 queue.js:15 template() 提供）
  │
  ├─ 一轮回答结束 → 客户端派发（60-tab.js:833 起的 dispatch effect）
  │     └─ call('dispatch') → api.js:851 API.dispatch()
  │           ├─ nextStep(items)      = queue-cli.js:137 nextTask()
  │           ├─ buildPrompt(step, n) 生成「继续做计划 N…」的正文
  │           └─ sessionController.prompt(...) 投给同一个会话
  │        队列空了 → 返回 dispatched=false（不发消息，只在面板提示「本轮执行结束」）
  │
  ├─ 宿主读盘  api.js:246 API.read()
  │     ensureQueueCli → pruneLegacySkill → takeLastRepair → readSettings
  │     → autoApproveOverflow(settings.autoReviewLimit)   api.js:264
  │     → migrateReviewedToArchive(settings.noteLimit)   api.js:265
  │     → renumberPlanIds(settings.idsVersion)   api.js:268
  │     → mergedItems = [...归档反转, ...plan.items]   api.js:288
  │     → lite 时逐条 toLiteItem                          store.js:146
  │
  └─ 客户端每 5 秒 sync() 一次（60-tab.js:381 的自动刷新 effect）
        状态由 30-runtime.js:205 statusOf() 现算，不落盘
```

## 取任务：`lib/host/queue-cli.js`

| 位置 | 作用 |
| --- | --- |
| `queue-cli.js:36` `isActionable(item)` | 草稿 / 失败 / 已完成都不出队 |
| `queue-cli.js:44` `actionableLeaves(items)` | 摊平成「可执行叶子」：普通条目过 `isActionable`，父节点换 children（父自身不参与） |
| `queue-cli.js:73` `byQueueOrder(a, b)` | 队列比较器：order → 一级 id → children 后缀（`"12-C" - "12-A"` 是 NaN，必须显式比后缀） |
| `queue-cli.js:83` `actionable(items)` | `actionableLeaves` + `byQueueOrder`，取第 0 条就是 `next` |
| `queue-cli.js:137` `nextTask(items)` | **id=340**：返回第一个未执行的任务，外加 `{parentId, groupSize, groupRemaining, groupRemainingAfter, index}` |
| `queue-cli.js` `ack(items, id)` | `done` / `fail` / `start` 只输出 `{ ok, id, remaining }`，不把下一条 `plan` 留进会话 |
| `queue-cli.js:245` `applyQueueCommand(items, cmd, id, note)` | 纯函数：`start`/`done`/`fail` 改字段并返回新数组 |
| `queue-cli.js:328` `main()` | 读 `.plan/plan.json` → apply → 原子写回（`tmp` + `rename`）→ 打印一行 JSON |

关键性质：**这一段是纯同步、可单测的**（`verify-272.mjs` E 组、`verify-340.mjs` 全篇直接 import 调用），
不依赖模型也不依赖 harness。

## 发 harness：三个入口

| 位置 | 方向 | 说明 |
| --- | --- | --- |
| `api.js:819` `kickoff` | 宿主 → 会话 | 手动开工：塞一条「开始干活」 |
| `api.js:851` `dispatch` | 宿主 → 会话 | **id=341**：塞一条「继续做计划 N…」（带 id 与正文）；`dryRun` 只算不发 |
| `api.js:933` `cancel` | 宿主 → 会话 | 暂停：`cancel({ sessionId })`，只停当前 turn，不动 plan.json |

harness 侧**没有**「任务队列 / 批量投递」这类接口被插件用到。`request.mode` 固定写 `'queue'`
（`api.js:832`），那只是投递方式标记，不是任务队列本身 —— 342 想「把一组 children 整体交给队列」，
必须在插件侧自己记投递游标。

## 回写状态

- **正常路径**：模型跑 `q.mjs done/fail` → `queue-cli.js` 直接改 `plan.json`（不经宿主 API）。
- **人工路径**：面板按钮 → `api.js:661` `API.update`（单条 patch）、`remove` / `reorder` / 审核。
- 面板不维护状态副本：分组与徽标全部由 `30-runtime.js:205 statusOf()` 现算，所以「模型改了盘、
  面板 5 秒后跟上」是唯一同步机制（`60-tab.js:370` 那段「维护须知」写明了这一点）。

## 现状的问题（与已解决项）

1. ~~**循环在模型脑子里，不在代码里。**~~ **已解决（340/341）**：取任务变成 `nextTask()`，
   推进变成 `dispatch`。模型拿到的是明确的 id 与正文。
2. ~~**一轮只能做一条，且做完直接做下一条，中间没有「先回答」。**~~ **已解决（341）**：
   派发挂在 turn 结束之后，任务之间必定有一次回答。
3. **拆分组没有显式投递游标。** 现在一次只投一条（`groupRemaining` 只用于提示），
   组内顺序由 `byQueueOrder` 的后缀比较保证。342 要补「整组按顺序投 + 本地游标」。
4. ~~**派发 effect 和对账 effect 共用 `wasRunningRef`。**~~ **已修**：对账写在前面，
   同一次提交里先把旗子写成 false，派发再也看不到 true→false，于是「做完不派下一条」。
   派发改用 `wasDispatchRunningRef`。对账进行中改为等到 `reconcilingRef` 落下再发，不再直接丢掉边沿。
   队首已在 `delivered` 且还没 `execute` 时 `dispatch` 返回 `reason:'inflight'`，不跳到后面的条目。
5. **`.plan/q.mjs` 是副本。** `queue.js:23 ensureQueueCli` 每次 `read` 都会把模板覆盖写一遍，
   所以任何「改 q.mjs 的行为」都必须改 `lib/host/queue-cli.js`，不能改 `.plan/q.mjs`。

## 改造落点（供 342/343 参考）

| 任务 | 落点 |
| --- | --- |
| 342 组按队列投递 | 复用 `nextTask()` 的 `parentId` / `index` / `groupRemaining`，在 `settings.json` 或 `.plan/dispatch.json` 记 `cursor`；harness 无队列接口，因此是「按顺序逐条投递 + 本地游标」 |
| 343 边界收口 | 已投递记在 `.plan/dispatch.json`；队首未完成返回 `reason:'inflight'`（不跳条）；「无可取任务 → 清运行态」由 `dispatch` 返回 `reason:'empty'` 处理 |

## 参考

- 技能正文：`dsh-plan-tasks/lib/host/skill.js:62 skillMarkdown()`
- 队列实现：`dsh-plan-tasks/lib/host/queue-cli.js`
- 派发实现：`dsh-plan-tasks/lib/host/dispatch.js`
- 会话投递：`dsh-plan-tasks/lib/host/api.js:819 kickoff` / `api.js:851 dispatch` / `api.js:933 cancel`
- 面板循环入口：`dsh-plan-tasks/src/client/60-tab.js:656 startWork()`；自动刷新 `60-tab.js:381`；
  派发 effect `60-tab.js:833`
- 状态现算：`dsh-plan-tasks/src/client/30-runtime.js:205 statusOf()`

---

## 补记：模型路由不再依赖「先跑过一次任务」（id=363）

这一条修的是「首次打开的项目里，拆解必然失败」——一个**报错信息完全指错方向**的坑。

### 症状与真因

新建会话里点「拆解」，宿主报 `no-route`：

> 拿不到当前会话的模型路由，无法拆解

而面板明明配好了默认模型。真因在 `decompose.js` 的 `routeOf()`：

```js
const header = ctx.get('sessions')?.get?.(sessionId)?.requestHeader?.()
const config = header?.config   // ← 全新会话里 header 是 undefined
```

`Session#requestHeader()` 折的是会话日志里的 `request/header` 事件
（`dsh-session` 的 `Session` 类）。**会话一次请求都还没发过时，日志里没有这个事件，
它返回 `undefined`**。于是路由拿不到 → 拆解失败。

用户唯一的绕法是「先随便发一条消息，再回来拆解」——这就是那条隐式依赖。

### 修法：把「取路由」从单点改成解析链

新增 `lib/host/model-route.js`，按优先级逐级回退，每级都先跟可用模型目录对一遍
（避免拿到一个已下架、必然失败的组合）：

| 顺序 | 来源 | 说明 |
| --- | --- | --- |
| 1 | `session.requestHeader().config` | 用户在当前会话里真实选的；有就一票通过，**不过目录校验** |
| 2 | `settings.json` 的 `modelProvider` / `modelModel` | 上一轮写回的显式选择 |
| 3 | `agentDefaultModel.currentSelection()` | 题面的「配置中的默认项」（profile 的 cordis.patch.yml 里那个） |
| 4 | `llm.listProviders()` + `listModels()` 的第一项 | 题面的「缺省取列表第一项」 |

第 1 步之所以不过目录：目录可能还没加载完、或某个 provider 暂时探测失败，
而「用户此刻选的就是它」这件事不需要目录背书。

### 前置到初始化

- 宿主新增 `models` 路由：返回 `{ providers, selection, source, saved }`；
- 宿主新增 `selectModel` 路由：把选中的一对写进 `settings.json`（只写这两个键，合并写，其余设置原样保留）；
- 客户端在**组件挂载时**（`useEffect`，依赖 `sessionId`/`cwd`）立刻调 `models`，
  若 `saved` 为空就调 `selectModel` 落一次默认。

`selection` 与 `saved` 刻意分成两个字段：合并的话「自动选中的默认项」
会被当成用户的选择，默认兜底就再也不会触发。

这个 effect 刻意**不挂进 `run()`**（那个忙碌壳子会把整块面板置成 busy，首屏闪一下很难看），
也**吞掉所有失败**：目录读不出来时，增删改 / 审核 / 执行全都还能用。

### 缓存

目录按 ctx 缓存在 WeakMap 里，TTL 60 秒（`constants.js` 的 `MODEL_TTL_MS`），
并在 `llm/adapters-updated` 事件上作废。理由：面板每 5 秒读一轮盘，
而 `llm.listModels()` 对某些 adapter 是真的去问端点 —— 5 秒问一次既浪费又会拖住 read。

### 验证

`scripts/tmp-model-route.mjs`（临时，已删）用假 ctx 覆盖了 9 个场景，全部通过：

1. 全新会话 + 有默认模型 → 用默认（**这就是修复前必然失败的那个场景**）
2. 全新会话 + 无默认 → 取目录第一项
3. 请求头优先于默认模型
4. 存过但模型已下架 → 跳过，回落目录第一项
5. `readCatalog` 首次 `selection` 有值而 `saved` 为 null
6. 写回后 `saved` 有值
7. 目录全空且什么都没配 → `undefined`（不编造路由，让模型侧报错）
8. `saveRoute` 只动两个键，`autoReviewLimit`/`todoThreshold`/`backupBeforeTrim` 原样保留
9. 单个 provider 探测抛错不影响其他 provider

## 补记：拆解入口的模型校验不再拦首次使用（id=364）

上一条（6-A）把路由解析链铺好了，这一条补的是**入口那一侧的判定**。

### 三条要修的行为

| 原来的错 | 现在的做法 |
| --- | --- |
| `modelState.selection` 为空就弹「没有选择模型」并阻断 | 空 != 没配。先等 + 重试，再按优先级挑一个 |
| 拿本地快照当结论 | 本地没有就**自己问一次宿主**（`call('models')`），最多 3 次 |
| 只告诉用户「不行」，没有下一步 | 提示里给出「重新加载」按钮，并区分「没配」与「读不出来」 |

### 校验顺序（`60-tab.js` 的 `ensureModel`）

1. 手里快照有 `selection` → 直接用，**一次请求都不发**；
2. 没有 → 循环最多 `MODEL_READY_ATTEMPTS` 次（3 次，间隔 `MODEL_READY_GAP_MS` 500ms）：
   - 拿到 `selection` → 记进状态，必要时落盘，返回；
   - 拿到 `providers` 但 `selection` 为空 → **立刻停**，重试也变不出模型来；
   - 请求抛错 → 继续下一次。

优先级（已有选择 > 默认模型 > 列表首个）由宿主侧 `model-route.js` 的解析链保证，
客户端只是消费 `snapshot.selection` —— 两边不各写一套。

### 两个刻意的手艺

**校验放在 `setSplitting(true)` 之前。** 模型都还没定就不要先挂遮罩，
否则「确实没有模型」时用户先看到转圈、再看到失败，白等一场。

**重试次数 × 间隔的注释写在一起**，标明「第一次立即发，之后才睡」——
第一次立即发是刻意的：它很可能正好接上初始化那次还在飞里的请求。

### 引导条

`.plt-guide` 是新增的样式（琥珀，不是红）：没有模型不等于用坏了，
红色会让人以为自己操作错了。文案按 `providers.length` 分两种成因：

- 0 → 「这个部署还没有配置任何 provider」
- >0 → 「provider 已配置但探测失败，检查 key / 端点」

右侧是可点的「重新加载」，走 `reloadModels()`：重试成功就顺手落盘并收起提示，
仍然失败保留提示。

### 验证

`scripts/tmp-ensure-model.mjs`（临时，已删）把 `ensureModel` 的判定照抄成独立函数，
用假宿主覆盖 9 条断言，全部通过 —— 关键是这两条：

```
ok   列表未就绪 → 重试后拿到，不拦        calls=3
ok   目录真空   → 返回 null 且只问了一次   calls=models
```

第一条例钉住「时序不拦」，第二条例钉住「真空不空转」。

## 补记：模型选择的持久化与失效回退（id=365）

6-A/6-B 已经把它做成「选得出、用得着」，这一条补的是**存得住、回得来、坏了能自愈**。

### 存储位置与分层

| 层 | 位置 | 语义 |
| --- | --- | --- |
| 插件配置 | `.plan/settings.json` 的 `modelProvider` / `modelModel` | 跟着项目走，切项目互不干扰，重启仍在 |
| 会话态 | `session.requestHeader().config` | 当前会话真实选的，**优先级最高，但不落盘** |

两者刻意不合并：请求头是会话级的（用户可能临时换一个），
持久化是项目级的（下次打开还要用）。测试里专门钉了这条 ——
请求头优先，且**不会被写回磁盘**。

### 修掉的真缺陷：失效值永不愈合

原来 `readCatalog` 把磁盘上的值原样回传，于是：

```
落盘 = wb retired-model
selection = {"provider":"wb","model":"good"}   ← 回退正确
saved     = {"provider":"wb","model":"retired-model"}   ← 但仍是失效值
再读一次后落盘 = wb retired-model （永不愈合）
```

`selection` 会正确地跳过失效候选回落到可用项，**功能上没坏** —— 但这恰恰把问题藏住了：
`saved` 非 null 让客户端认为「用户已有显式选择」，于是从不回写，
那个早就下架的模型名在 settings.json 里一躺就是几个月。

修法是把「什么算存过」这个判断改对：

```js
const alive = stored !== undefined && hasRoute(providers, stored) ? stored : null
```

失效 → `saved: null` → 客户端已有的那条愈合路径（`saved === null` 就落一次默认）
自动接管，磁盘被覆盖成可用值。**不需要为「自愈」新写一段逻辑**，
只是原来那个判断是错的。

`stale: true` 单独带出来供界面提示：静默替换会让人以为自己的选择被吞了，
所以客户端会说一句「上次选的模型已失效，已改用 X」。

### 回归验证

`scripts/tmp-persist.mjs`（临时，已删）覆盖 5 组共 12 条断言，全部通过：

| 场景 | 结果 |
| --- | --- |
| 首次初始化项目 → 零任务 → 直接取模型 | ✅ 拿到 `good-model` |
| 重启（新 ctx、缓存清空）保持上次选择 | ✅ 仍是 `second-model` |
| 选择失效（下架）→ 回退默认 + 磁盘愈合 | ✅ `stale:true`，磁盘变 `good-model` |
| 切换项目 → 两项目各记住自己 | ✅ A=`second-model`，B=`good-model`，互不覆盖 |
| 请求头优先于持久化值 | ✅ `source:session`，且不写回磁盘 |

「重启」在测试里用**新建 ctx** 模拟 —— 目录缓存是挂在 ctx 上的 WeakMap，
新 ctx 即缓存全空，等价于插件重载后的冷启动。

## 补记：「这一组还剩 N 条」的口径修正（id=366）

### 问题

`buildPrompt` 原来直接拼 `step.groupRemaining`，而 queue-cli 里这个字段的定义是
**含本条**的未执行条数。于是 3 条的组第 1 条会说：

```
继续做计划 7-A（拆分组 7 的第 1/3 条，这一组还剩 3 条）。
```

模型读到「连着我在内还有 3 条没做」，紧接着正文又说「只做这一条」——两句话自相矛盾；
用户则看到当前这条被数了两遍。

### 修法

不再用 `groupRemaining`，改成**按位置现算**：

```
N = groupSize − (index + 1)
```

验算（3 条的组）：

| 条目 | index | 计算 | 显示 |
| --- | --- | --- | --- |
| 第 1 条 | 0 | 3 − 1 | 还剩 **2** 条 |
| 第 2 条 | 1 | 3 − 2 | 还剩 **1** 条 |
| 第 3 条 | 2 | 3 − 3 | 还剩 **0** 条 |

「第 2/3 条，这一组还剩 1 条」自洽：2 + 1 = 3。

### 为什么用位置而不是「还剩几条没执行」

`groupRemaining` 会随兄弟任务的执行状态变化（做完一条少一），同一句话在第 1 条和
第 2 条上算出来的口径并不相同。而「我后面还有几条」是纯粹的队列位置，不依赖此刻谁做完了。
两者在正常顺序执行时数值一致，但位置口径不会因为某条被跳过而给出更小的数。

### 顺带夹住了两个数

`size` / `index` 都夹进合法区间：脏数据（index 越界）不会再拼出「第 6/1 条」或
「还剩 -1 条」。位置夹到 `[0, size-1]`，剩余按夹过之后的位置算，
于是**「位置 + 剩余 = 总数」恒成立**——这条不变量也写进了测试断言。

### 验证

`scripts/tmp-remaining.mjs`（临时，已删）13 条断言全过，覆盖：

- 核心算例：3 条组 → `2 / 1 / 0`，且每条都验证 `位置 + 剩余 = 总数`
- 其他组大小：1 条 → `[0]`、2 条 → `[1,0]`、5 条 → `[4,3,2,1,0]`
- 不随执行状态变：第 3 条无论前两条做没做都显示 0
- 非拆分组不受影响（仍走「队列里还剩 N 条」）
- 脏数据不出负数、不出现越界位置

`groupRemaining` / `groupRemainingAfter` 的语义注释也补了一句，指向这个新口径，
免得下次又有人拿它们当「本条之后还剩几条」用。

## 补记：剩余条数收成一份算法 + 0 的措辞（id=367）

7-A 修好了数值，这一条修**结构**：把算法从文案里拔出来，并补上 0 的措辞。

### 为什么要抽函数

7-A 的算法是就地写在 `buildPrompt` 的模板字符串旁边的。这种「算法长在文案里」
的写法有两个问题：

1. 以后再加一处「还剩几条」的文案，很容易顺手把 `groupRemaining`（含本条）又用一遍 ——
   同一个错会以同样的方式复现；
2. 想在一处改口径，得先全文搜索哪几处是自己算的。

现在 `lib/host/dispatch.js` 里三个函数各管一件事，导出的都是纯函数：

| 函数 | 职责 |
| --- | --- |
| `groupProgress(step)` | **唯一的算法**。返回 `{ position, size, after }`，不含本条 |
| `remainingPhrase(after, scope)` | **唯一的措辞**。把数字转成中文短语，0 走特殊措辞 |
| `queueProgress(remaining)` | 队列分支的口径（`remainingCount` 是含本条的，减掉自己） |

`buildPrompt` 里**一个数字都不再算**，只负责把它们拼进句子。

### 0 的措辞

| after | 组内 | 队列 |
| --- | --- | --- |
| 0 | **本组最后一条** | **队列里最后一条** |
| >0 | 这一组还剩 N 条 | 队列里还剩 N 条 |

「还剩 0 条」读起来像「这里还有 0 个东西」——一个空的计数。而真实语义是
「这条就是最后一条」，是个**位置结论**。换成结论后，模型和用户都能立刻知道
「做完这条这一组就齐了」。

### 顺带修掉队列分支的同一类错

非拆分组那条分支原来是 `队列里还剩 ${remaining} 条`，而 `remainingCount()`
数的是**连本条在内**的可做条数 —— 和组内那个 bug 完全同源，只是当时没注意到。
现在走 `queueProgress()` 减掉自己，5 条时说「还剩 4 条」。

这一处是这次抽取才暴露出来的：把口径收进函数之后，两条分支并排看，
「一个减了、一个没减」的不一致立刻显形。

### 验证

`scripts/tmp-shared-progress.mjs`（临时，已删）17 条断言全过：

- `groupProgress` 的口径与脏数据夹取（越界、缺字段）
- **不变量 `position + after === size`，1/2/3/5/12 条组逐条扫一遍**
- 措辞四种组合 + 负数/非整数一律当 0
- 端到端 3 条组三条首行逐字比对
- 队列分支：5 → 4、1 → 最后一条、0 → 最后一条

3 条组的实际输出：

```
继续做计划 7-A（拆分组 7 的第 1/3 条，这一组还剩 2 条）。
继续做计划 7-B（拆分组 7 的第 2/3 条，这一组还剩 1 条）。
继续做计划 7-C（拆分组 7 的第 3/3 条，本组最后一条）。
```

## 补记：普通条目的「通过」也搬到头部（id=368）

### 三处改动

1. **普通条目（无拆分的）在待审核时，头部出现「通过」**
   原来它藏在展开区的复制按钮那一排，要先展开卡片才能点到。审核这件事
   根本不需要读正文 —— 放在头部之后，待审核组在**收起状态**下就是一张
   可逐条点过的清单，不用展开、不用滚动。

2. **去掉头部的「待审核」徽标**
   与 id=358 去掉「已审核」同一个理由：进组条件就把状态说完了。待在
   「待审核」组里，每条必然待审核，右端再挂一个「待审核」= 把组名重复 N 遍，
   还是整列里较长的词。省下的宽度给标题。

3. **展开区不再画第二颗「通过」**
   同一屏两个「通过」（一个收起可见、一个展开才出现）会让人犹豫点哪个 ——
   而它们其实是同一个动作。展开区保留复制类按钮（ID / 内容 / 提示词），
   那些确实要读完正文才用得上。

### 一个位置，两种动作

批次与普通条目共用同一个头部位置和同一套样式，用 `isParent` 分派：

| 类型 | 回调 | 效果 |
| --- | --- | --- |
| 批次（有 children） | `onApproveBatch(item.id)` | 一次改完整批 |
| 普通条目 | `onPatch({ review: true })` | 与原来展开区那颗**完全同一条通道**，连「自动展开下一条 / 清空后折叠分组」都原样保留 |

`running` 时两颗都不画 —— 执行中还没有结果可审。

### 顺手清掉两条死规则

`.plt-tag.unreviewed` 的深色/浅色规则已无宿主（徽标不再渲染），手动删除。

**这里有个扫描器盲区值得记一笔**：`scripts/dead-css.mjs` 只按 `.plt-*` 前缀
收集类名，`.plt-tag.unreviewed` 会被记成 `plt-tag`，所以**它不会报这条是死的**。
也就是说「npm test 全绿」不能证明这类复合选择器没死 —— 删节点时必须手动核对
对应的 `.plt-tag.<状态>` 规则，不能等脚本提示。

### 验证

`scripts/tmp-head-pass.mjs`（临时，已删）12 条源码结构断言全过，包括：

- 头部条件确实同时包含批次与普通条目两个分支
- 展开区不再有「通过」（`'通过'` 文案总数从 4 降到 3：头部 + 子任务行内）
- 深浅两套 `.plt-tag.unreviewed` 都已删除，而 `.plt-tag.todo` / `.draft` 仍在
- 子任务行内那颗 `plt-kid-pass` 没被误伤

没有浏览器（playwright/puppeteer/jsdom 都不可用），所以这是**结构断言**而非像素验证：
条件写没写对、死规则清没清干净能钉住；「点下去是不是真的通过」仍需真机点一次。

## 补记：子任务名字号上调一档（id=369）

### 改动

`.plt-kid-name` 的 `font-size` 13px → **14px**。字重、颜色、换行与截断逻辑一个字没动。

### 为什么不能只改这一行

改完发现两个连带问题，都出在「层级」上：

1. **宽屏**：父行标题是 14px，子任务名调到 14px 之后两层一样大 —— 而
   `19-kids.js` 开头第 1 条设计意图写的就是「父行标题比子任务大一档」。
   层级消失，批次看起来就不像容器了。
2. **窄侧栏**：`@container (max-width:320px)` 里父行标题本来会收到 13.5px。
   如果我按 1 的思路把父行抬到 15px 却没有同步窄屏档，窄屏下父 13.5 / 子 14，
   **层级会反过来** —— 子任务比自己的批次标题还大。

所以三处一起调，相对差恒定保持 1px：

| 宽度 | 父行标题 | 子任务名 |
| --- | --- | --- |
| 宽屏 | 15px | 14px |
| ≤320px | 14px | 13px |

窄屏那条 `@container` 里新增了 `.plt-kid-name{font-size:13px}`，
这是本次唯一「为了保住原设计」而加的规则，不是顺手改的。

### 溢出与截断不受影响

- 外层 `.plt-kid-name` 仍是 `flex:1 1 auto; min-width:0`，压缩全部由它承担；
- 截断仍在内层 `.plt-kid-name-text`（`nowrap + hidden + ellipsis`），与字号无关；
- 外层**故意不带** `overflow:hidden`（id=362 定下的：带 overflow 的 flex 项没有
  文字基线，baseline 对齐会退化成按底边对齐，编号胶囊会被拉到标题底边）。

字号放大一档只让行盒长 1~2px：原来 13px 标题的行盒约 18px、与编号胶囊
（16px 行高 + 2px 描边）齐平；现在 14px 约 19.6px，标题成为行高的决定项。
不会溢出容器。

### 验证

`scripts/tmp-kid-font.mjs`（临时，已删）11 条断言全过，重点是这两条梯度检查：

```
ok   宽屏：父 15 > 子 14
ok   窄屏：父 14 > 子 13，层级不翻
```

以及「字重/颜色/可压缩性/外层无 overflow/内层截断三件套/已做行覆盖/编号胶囊独立一档」
逐条确认没被牵动。仍然没有浏览器，所以这是产物级 CSS 断言，不是像素验收。

## 补记：子任务卡三块的间距改用 flex gap（id=370）

### 改动

`.plt-kid` 从普通块容器改成 `display:flex; flex-direction:column; gap:5px`，
同时把 `.plt-kid-plan` / `.plt-kid-note` 身上的 `margin-top:3px` 删掉。

### 为什么用 gap 而不是把 margin 调大

用 margin 时，「有没有下一块」决定了间距 —— 最后一块永远多留一段空气。
而 gap 只画在**相邻两块之间**：备注为空时那个节点根本不渲染（渲染处是
`note !== '' ? <div> : (noteLen > 0 ? <加载中> : null)`，空备注走 null 分支），
DOM 里没有元素，gap 自然无从生效。

所以「备注为空不残留空白」是**结构保证**，不是靠再补一条 `:last-child` 抵消出来的。
这一点刻意写进了验证：确认没有新增 `:last-child** 补丁。

### 只动块间距，不动块内部

逐项确认保留：

| 项 | 值 |
| --- | --- |
| `.plt-kid-plan` 行高 | 1.6 |
| `.plt-kid-note` 行高 | 1.55 |
| 换行 | `white-space:pre-wrap` + `word-break:break-word`（两块都在） |
| 字号 | plan 13px / note 12px（8-A 的成果没被牵动） |
| 卡片内边距 | `padding:7px 9px` |
| `position:relative` | 保留 —— `::before` 的连接线小横钩靠它定位 |

最后一项容易漏：`.plt-kid` 上加 `display:flex` 时，如果顺手把 `position:relative`
挤掉，那条从组内连接线指过来的 `::before` 横钩就会锚到别的包含块上。

### gap 取 5px

原来是各 3px 的 margin，视觉上偏挤（两段正文几乎贴在一起）。5px 比 3px 松一档，
又不至于让卡片变高太多 —— 子任务列表本来就是一屏要塞十几条的地方。

### 验证

`scripts/tmp-kid-gap.mjs`（临时，已删）16 条断言全过：容器三件套（flex/column/gap）、
两块 margin 已删、行高与换行逐项未变、字号未变、备注空分支落 null、无 `:last-child` 补丁。

中途有一条断言先 FAIL 了，查出来是**我写的正则在跟自己较劲**（`\}\)\s*,\s*$` 这种
跨行匹配在多行三元链上不稳），换成对渲染链三个关键片段的存在性检查后通过。
代码本身没问题，是测试写法的问题。

## 补记：删掉子任务行内的「单个通过」（id=371）

### 删了什么

| 项 | 位置 |
| --- | --- |
| 按钮节点 + `onClick`（`onPatch(child.id, { review: true })`） | `50-item.js` 的 `KidsList` |
| `KidsList` 的两个 prop：`onPatch` / `busy` | 解构处 + 调用处各一处 |
| 样式规则 `.plt-kid-pass{flex:0 0 auto}` | `19-kids.js` |

删除理由：整批通过（父行头部那颗，id=354）已经是这条链路上的入口。同一个
「标成已审核」动作留两个入口（整批 / 逐条），用户要自己判断该点哪个，
而两条路落盘后的形态完全一样（都走 `approveItem`）。

`groupKey` 刻意保留 —— 耗时节点的显示条件还要用它（待审核/已审核才画）。
`onPatch` 在 `Item` 自身仍被多处使用（编辑草稿、任务类型切换），没被误伤。

### 踩到的一个扫描器细节（值得记）

`.plt-kid-pass` 的规则删掉后，`dead-css.mjs` 仍然报它「没人用」。

原因不在脚本 bug，而在**我留在注释里的文字**：`dead-css.mjs` 是按
`/\.(plt-[a-z0-9-]+)/` 在整份文件里收集「定义了哪些类」的，**不区分注释**。
我在注释里写了「`.plt-kid-pass` 已删除」，那个带前导点的名字被当成了一次**定义**，
于是它照样被判为「有人定义、没人用」。

反方向也一样危险：在 JS 文件里裸写类名会被当成一次**引用**，
让一条本该报死的规则看起来「有人在用」——那才是真正会漏掉死规则的方向。

结论写进了代码注释：**注释里描述即可，别写出类名**。

### 验证

`scripts/tmp-kid-pass-removal.mjs`（临时，已删）16 条断言全过：

- 按钮节点、`onPatch(child.id` 都没了
- `KidsList` 解构只剩 `{ kids, groupKey }`，调用处也不再传那两个 prop
- CSS 规则没了，且**整份文件任何位置都不再出现该名字**（含注释）
- 父行「整批通过」、普通条目头部「通过」（id=368）、`onApproveBatch` 都还在
- 子任务行剩余六个节点（对勾 / 编号 / 标题 / 耗时 / 内容 / 备注）逐一确认仍在

`npm test`：34 个宿主模块、**122 个 CSS 类无死规则**（比上一版少 1，即被删的那个）。

## 补记：单条通过清理 + 整批通过的健壮性（id=372）

### 一、单条通过的残留清理

9-A 删掉按钮之后，走查「它写入过什么」：

| 项 | 结论 |
| --- | --- |
| 向主进程的消息 | `onPatch(child.id, { review: true })` → `call('update', { patch })`。**通道保留** —— 普通条目头部那颗「通过」（id=368）还在用它，拆掉会连带废掉那条路径 |
| 本地状态 | `patch()` 里的 `nextUnreviewed`（审核后自动展开下一条）+ `remainingUnreviewed` 清展开项。**保留**，同上：头部那颗仍会触发 |
| 缓存 | 无。「单个通过」从来不写 localStorage / 不建独立缓存，全部状态从下次 `read` 推导 |
| prop 传递 | `KidsList` 的 `onPatch` / `busy` 已在 9-A 随按钮一起移除，调用处不再传 |

所以**没有需要再清的残留** —— 9-A 已经把「只被那颗按钮使用的东西」清干净了，
剩下的都是别的入口在共用的。这一点值得确认，否则容易顺手把还在用的通道删掉。

### 二、整批通过的健壮性：修掉两个真崩溃

用临时脚本跑了 7 个场景，**当场炸了 2 个**：

**崩溃 1 — `approveItem` 遇到 `null` 子任务**

```js
children: kids.map((kid) => ({ ...kid, review: true, finishedAt: kid.finishedAt || stamp }))
```

`{ ...null }` 得到 `{}`，随后读 `kid.finishedAt` 抛 `Cannot read properties of null`。
一条脏数据（手改 plan.json / 旧版本写坏的数组）能让**整批通过整个失败**。

修法：逐项先挡，不是对象的**原样保留**（不偷偷删元素 —— 删了等于悄悄改变这一批的条数，
脏数据该由读盘归一处理，不该在一次「通过」里被动蒸发）。

**崩溃 2 — `isUnreviewedBatch` 遇到 `null` 子任务**

```js
kids.every((kid) => kid.execute === true)   // kid 为 null 就抛
```

这个更严重：它跑在 `read` 路由的自动通过扫描里，也就是**每 5 秒一次的轮询**。
一条脏数据能让整个面板读不出数据 —— 症状是「列表一直转圈」，
而原因在一个根本不该触发的地方。

修法：先滤掉脏项再判（语义上也对：脏项不是「待审核的任务」，无从审核）。

### 三、客户端同源加固

`60-tab.js` 的 `approveBatch` 里三处读 `one.review` / `one.id` 的地方同样会炸，
一并加了对象判断：`pendingCount` 的 pool、清勾选集合、判断展开项是否失效。

### 四、验证（12 条断言，全过）

临时脚本走**真 API**（`API.approveBatch` + 真 plan.json 落盘），覆盖：

| 场景 | 结果 |
| --- | --- |
| 部分子任务已通过 | ✅ approvedCount=3，原 finishedAt 未被覆盖 |
| 全部已通过（含父标记） | ✅ 幂等 no-op，不抛 |
| 子任务全审过、父标记缺失 | ✅ 只补父一条 |
| 状态字段缺失 | ✅ review + finishedAt 都补上 |
| children 含 null | ✅ 不抛，且 null 项未被悄悄删除 |
| 无 children 的普通条目 | ✅ 退化成单条通过 |

**两次 FAIL 都是测试假设错了，不是代码错了**，值得记下来避免误判：

1. 断言「子任务全部 review」时读的是 `plan.json` —— 但整批审完会按既有归档规则
   搬去 `notes.json`，`plan.json` 里当然是空的。改成一处在两处都找。
2. 断言「全部已通过 → 幂等」时，测试数据里父的 `review` 还是 false ——
   宿主把父也算 pending 之一（容器标记），所以 `approvedCount=1` 是在补父，
   那是正确行为。把父也标上之后才是真的幂等。

## 补记：主任务「通过」按钮提升视觉权重（id=373）

### 定位

题面说的「主任务通过按钮」有两个入口，共用同一个类 `.plt-head-pass`：

- 拆解批次头部那颗「整批通过」（id=354）
- 普通条目头部那颗「通过」（id=368）

两者之前**完全复用** `.plt-copy-btn` 的样式 —— 透明底 + 细描边胶囊 + 12px 字。

### 问题

`通过` 是这条链路上唯一推进状态的动作（审核完 → 归档），
而它旁边那排「ID / 内容 / 提示词」只是把文字挪走、不改任何数据。
共用同一套外观意味着用户扫一行时分不出「哪颗会改变状态」。

### 改法：加法，不是减法

| 项 | 原来（copy-btn） | 现在（head-pass） |
| --- | --- | --- |
| 底色 | 透明 | `--dsw-alias-bg-accent` 主色实心 |
| 文字 | accent 半透明 | `#fff` |
| 字号 | 12px | 13px |
| 内边距 | 3px 9px | 5px 13px |
| 字重 | 500 | 600 |
| 圆角 | 999px（胶囊） | 8px |

圆角从胶囊改 8px 是刻意的：实心块用 999px 会读成「标签」，8px 才读成按钮。

**次要按钮一条规则都没动。** 层级差是靠把主按钮提上来得到的，不是把次要按钮压暗 ——
后者会让整块区域变灰，读起来更累。

### 三态

- **hover** —— 叠一层 `inset 0 0 0 99px rgba(255,255,255,.12)` 高光 + 外发光，
  而不是换一个色相。这样深浅两套主题不必各写一条「更亮的蓝」。
- **active** —— 下沉 1px + 内阴影。
- **disabled** —— `.45` 且清掉位移与发光（禁用时不该有任何互动暗示）。

### 一个必须处理的层叠陷阱

浅色主题里 `body:not([data-ds-dark-theme]) .plt-copy-btn:hover{color: label-primary}`
的特异度是 **(0,3,0)**，高于 `.plt-head-pass:hover` 的 **(0,2,0)**。

不覆盖的话，白底主题下 hover 会把文字刷成深蓝（`#141a22`）压在深蓝实心底上 ——
**几乎看不见**。所以 `30-light.js` 里按同样特异度补了一组
（基础 / hover / active / disabled / disabled:hover 五个状态一起钉白）。

底面仍用 `--dsw-alias-bg-accent`：浅色主题里它已是 `#2f6fd0`（白字对比 5.9:1），
不需要另设更深的蓝，也就不会和「发送」键分家。

### 验证

`scripts/tmp-primary-btn.mjs`（临时，已删）19 条断言全过，包括：

- 主色底 / 白字 / 透明描边
- 四项尺寸确实比 copy-btn 大一档（逐项比对数值，不是"看着差不多"）
- hover / active / disabled 三态各自的特征声明存在
- 窄屏只收字号内距、**不动背景色**（主按钮在任何宽度下都还是主按钮）
- **反证**：`.plt-copy-btn` 仍是透明底 + 999px 胶囊（没被误改）

`assets/` 目录只有一张 `icon-180.png`，与按钮样式无关，本次未涉及。

## 补记：待执行的删除收进头部垃圾桶（id=374）

### 改动

`50-item.js` 的头部删除图标（`.plt-head-del`）原来只在 `groupKey === 'reviewed'`
时渲染，现在同时覆盖待执行：

```js
(groupKey === 'reviewed' || (groupKey === 'todo' && running !== true))
```

同时移除底部两处重复入口：

| 位置 | 原来 | 现在 |
| --- | --- | --- |
| 待执行单任务（底部排） | `plt-icon-btn plt-trash` 垃圾桶 | 移除（改在头部） |
| 待执行批次（底部「删除整批」文字按钮） | 保留 | 移除（改在头部） |

### 「拆分与单任务一视同仁」意味着什么

这两类在数据里形状不同（一个父带 `children`、一个是普通条目），但在界面上
都是待执行列表里的一行。改完之后：

- **位置统一**：都在头部右端，不因「是不是批次」而变；
- **形态统一**：都是垃圾桶图标，不是「一个图标 + 一个文字按钮」；
- **行为统一**：都走 `onRemove`（→ `remove(id)` → `call('remove')`），
  删父连带整批由宿主侧保证，没有第二套逻辑。

### 措辞按类型分开

图标没有文字，读屏和悬停全靠 `title` / `aria-label` / `data-tip`，
所以这三个属性**按类型换句子**而不是统一一句：

- 批次 →「删除整批（含全部子任务）」—— 必须说清会连带子任务
- 普通条目 →「删除这条计划」

### 保留了什么

待审核 / 草稿两档的底部删除**必须留着** —— 它们的头部没有删除图标，
一起删掉这两个入口就真的丢了。这一点写进了注释，免得下次有人「顺手统一」。
`.plt-icon-btn` / `.plt-trash` 两个类也保留：头部那颗仍在用，
`dead-css.mjs` 因此仍报它们有用（122 个类无死规则）。

### 一个布局细节

`.plt-head` 是 `align-items:center`，所以头部现在是「标题（flex:1）→ 通过按钮 →
垃圾桶」三者居中排列。垃圾桶 26px 高、通过按钮 30px 高，各自居中后视觉中线对齐，
**不需要**为了齐平去改高度 —— 改了会推翻 id=359 定下的「与底部那排 26px 同尺寸」
的取舍。这条写进了 `15-detail.js` 的注释。

### 验证

`scripts/tmp-todo-delete.mjs`（临时，已删）17 条断言全过，关键几条：

- 头部条件确实同时含 `reviewed` 与 `todo`
- 全文件只剩**一颗** `TrashIcon` 用于删除（底部两颗都没了）
- 待审核 / 草稿**不在**底部排除名单里（入口保留）
- 仍走 `onRemove` + `stopPropagation`，**没有**引入 confirm/弹层（这个插件的删除本来就没有二次确认）
- 两种措辞都在，`aria-label` 按类型分派

## 补记：待执行里拆分批次的「原始提示词」默认展开（id=375）

### 改动

```js
// 原来
const [sourceOpen, setSourceOpen] = React.useState(false)
// 现在
const [sourceOpen, setSourceOpen] = React.useState(groupKey === 'todo' && isParent === true)
```

一处改动，两条 `plt-source` 渲染路径共用这个状态。

### 为什么是 `&&` 而不是把条件放宽

题面说的是「拆分的任务」，所以只放开**两个条件同时成立**的情形：

| 组 | 单任务 | 拆解批次 |
| --- | --- | --- |
| 待执行 | 折叠 | **展开** |
| 待审核 / 已审核 | 折叠 | 折叠 |

- 待执行是「接下来要干什么」的清单。批次卡展开后先是子任务列表、再是这段原文 ——
  用户在这里最需要回头确认「当初是怎么要求的」，好判断拆得对不对。
- 待审核 / 已审核不放开：那时活已经干完了，默认铺开一整段需求会盖住真正的执行结果。
- 单任务不放开：它们没有子任务列表，展开区里就只剩这段原文，而标题已经压自同一段
  提示词，信息是重复的 —— 默认展开只是把卡片撑成两倍高。

### 顺手修掉一个由本次改动**暴露**的 bug

默认折叠时，用户点开原文那一刻 `detail` 基本已经回来了，所以从没暴露过：
**lite 列表里 `sourcePrompt` 是被抹成空串的，只留 `sourcePromptLen`**。

改成默认展开之后，这一格会在**首屏**就渲染 —— 此时 `sourceText` 还是 `''`，
于是渲染出的是一个有虚线边框（`border:1px dashed`）、有内边距（`padding:8px 10px`）、
有背景色，却**一个字都没有**的空框。

修法：两处都改成 `sourceText !== '' ? sourceText : '（加载中…）'`，
措辞与备注加载中保持一致，不新造视觉。

这个 bug 是「改默认值」这个动作本身带来的 —— 同一段代码在折叠态下永远正确，
在展开态下才第一次被执行到。**改默认状态时要把那条路径当成新代码看一遍。**

### 状态作用域确认

`sourceOpen` 是 `Item` 内的局部 `useState`，卡片按 `item.id` 做 key。
条目换组（todo → unreviewed）时是整棵子树重新挂载（各组是独立容器），
所以会按**新组**重新取默认值，不会把旧的展开状态带过去 —— 这正是需要的语义。

### 验证

`scripts/tmp-source-default.mjs`（临时，已删）13 条断言全过：

- 初始值是两个条件的 `&&`（含一条反证：不是 `||`，否则单任务或别组会被误放开）
- `isParent` 声明位置（偏移 5845）确实早于 `sourceOpen`（8694），无 TDZ
- 两处 `plt-source` 都有加载态兜底，且没有任何一处还在渲染裸 `sourceText`
- 手动切换按钮、`aria-expanded`、两处调用点都完好
- 没有顺手把条目的 `open`（整卡展开）也改成默认 true —— 那是另一件事

## 补记：待执行的「转为草稿」搬进头部（id=376）

### 改动三处

| # | 位置 | 内容 |
| --- | --- | --- |
| 1 | `50-item.js` 头部 | 新增 `.plt-head-demote`（文字胶囊），排在垃圾桶**左边** |
| 2 | `50-item.js` 底部操作排 | 移除原来的「转为草稿」文字按钮 |
| 3 | `60-tab.js` `canDemote` | 去掉 `!item.children?.length` 这条排除 |

第 3 条是题面「拆分与单任务一视同仁」的硬前提：原来批次**根本不能**转草稿，
只把按钮搬到头部而不放开限制，批次卡的头部就永远少这一颗，
两种卡的位置又不一致了 —— 等于把「一视同仁」做成半截。

### 放开批次为什么是安全的

- `moveToGroup` 打的是 `{ draft: true }`；
- `statusOf` 对父节点是**草稿优先**：`if (item.draft === true) return { key: 'draft' }`
  排在「整批做完 = 待审核」之前。所以整批标成草稿后不会被那条规则洗回待审核；
- 子任务自身不带 `draft`（它们是父的一部分），不存在「父进草稿、子还在待执行」的错位。

已用真 API 落盘验证：父 `draft:true` 写进去，子任务不受牵连。

### 顺序：草稿在左、删除在右

```
标题（flex:1） … 通过（30px）  转为草稿  垃圾桶（26px）
```

这是刻意的：转草稿是「还能撤回的安排」，删除是「不可恢复」。
破坏性更强的那个永远在最右端 —— 手滑滑到底撞到的是删除，
所以更该让它离别的控件远一点、也给人更长的移动距离反悔。

### 为什么文字能进头部、删除却必须用图标

头部有标题在抢宽度，两个中文不算小。但：

- 它只在**待执行组**出现（别的组不渲染），不是每张卡都有；
- `.plt-head-demote` 给了 `flex:0 0 auto` + 窄屏收一档，
  最坏情况是标题先截断 —— 而 `.plt-name` 是 `flex:1 1 auto`，本来就该让位；
- 反过来，把「转草稿」也做成图标会与垃圾桶混淆：两个都是图标时，
  在高频操作里更容易点错那个**不可恢复**的。

### 样式：复用而不是新建视觉

`.plt-head-demote` 沿用底部那颗描边胶囊的观感（透明底 + accent 描边 + 999px 圆角），
只补头部特有的：`flex:0 0 auto`、`align-self:center`、与图标按钮同高 26px、
以及与垃圾桶之间的 2px 间距。

旧的 `.plt-demote` 两条共用规则（在 `16-bulk.js`）随之删除 —— 它已无宿主，
`dead-css.mjs` 会报。只保留 `.plt-promote`（草稿组底部那颗「转为待执行」仍用它）。

### 验证

`scripts/tmp-demote-head.mjs`（临时，已删）14 条断言全过：

- 头部有这颗、走 `onDemote`、仍 `stopPropagation`
- 底部那颗已移除、旧样式类已删（`dead-css` 122 个类无死规则）
- `canDemote` 不再含 `children`，但仍限 `todo` 组、仍排除执行中
- **顺序断言**：`demote@23130 < del@23869`（删除恒在最右端）
- **真落盘**：批次 `draft:true` 写入成功，子任务不被牵连

### 又一次踩到同一个坑

CSS 注释里写了带点的类名（`.plt-demote`），`dead-css.mjs` 立刻把它算成
「有人定义、没人用」。这是**本次会话第四次**同类问题 —— 规则已记在
`16-bulk.js` 的注释里：**描述即可，别写出类名**。

## 补记：「完成后暂停」开关 UI（id=377，仅结构与文案）

### 一个必须先澄清的用词

题面说的「干活中分组」在代码里**不是一个分组**——它是待执行组底部那排按钮
在模型运行时的状态文案：

```js
h('span', null, starting ? '发送中…' : working ? '干活中' : `▶ ${开始干活}`)
```

所以「干活中」= **待执行组有任务正在执行**。开关因此挂在 `group.key === 'todo'`
的组头上，而不是新增一个分组。

### 落地的结构

```
[折叠箭头] [组名：待执行] [● 完成后暂停] [正在执行] …… [012]
                                    ↑ 仅 isRunning 时渲染
```

位置在组名**右侧**，这是刻意的：最右端已被条数统计占着（id=337 刻意压在所有
控件之后，让四组的数字竖着对齐），往那里插一个宽度会变的开关会把那条对齐线打散。
放在组名右侧读起来是一句话：「待执行 · 完成后暂停」。

> 这一处我向用户确认过：题面写「头部左侧」，字面看该在组名左边，
> 但那会把组名往右推、四组组名起点不再对齐。用户选择了「组名之后」。

### 文案两态

| 状态 | 文案 |
| --- | --- |
| 关 | 完成后暂停 |
| 开 | 继续执行 |

开启后说的不再是「要不要暂停」而是「接下来会怎样」——开关已经拨过去了，
再重复一遍动作没有信息量。

### title（逐字按题面）

> 开启后当前任务执行完不再自动派发下一个任务，关闭则继续自动派发

同时给了 `data-tip`：这个插件的气泡统一走 `40-tip.js`，只写 `title` 的话
悬停要等浏览器那个约 1 秒的延迟。

### 显隐

判据用 `isRunning` —— 与组容器上的 `data-running`、以及收起态那句「正在执行」
**同一个口径**。不另算一套，否则会出现「组头说在跑、开关却不出现」的矛盾。
无执行中任务时整块返回 `null`。

### 可访问性

- `aria-pressed` 反映真实开关态 —— 不能只靠文案变化，
  因为「完成后暂停 / 继续执行」两种文案都不是 on/off 本身；
- `aria-label: '完成后暂停'`（名称固定，不随态变）；
- 圆点 `aria-hidden`（纯装饰）。

### 状态来源是占位（本步边界）

```js
const [pauseAfterDone, setPauseAfterDone] = React.useState(false)
// TODO(id=377 后续)：接上真正的派发拦截
```

真正的拦截点在「回答结束 → 派下一条」那段（现由 `dispatchedRef` + running 边沿驱动），
改它属于另一件事。本步先把控件、文案、显隐、可访问性落稳，后续接上时不用再动结构。

**已断言没有越界**：`dispatchedRef` 的派发条件一行没改，`pauseAfterDone` 也
没有出现在派发 effect 里。

### 样式：借用而不是新造

复用顶栏「自动刷新」那颗开关的视觉语言（小圆点 + 胶囊描边），
不新造 toggle 皮肤 —— 同一个侧栏里出现两种开关长相，用户还得先分辨它们是不是一回事。

两处组头特有的调整：不写 `min-width`（顶栏那个 62px 是为了换字不跳，
组头更挤，两种文案只差 1 个字）；`flex:0 0 auto` + `nowrap`（组头高度固定 38px，
绝不能被压成两行）。窄屏 360px 断点与 `.plt-group-run` 同档，只留圆点。

### 验证

`scripts/tmp-pause-toggle.mjs`（临时，已删）23 条断言全过，含：

- 两个占位态、两态文案、`title` 与 `data-tip` 逐字一致
- 显隐条件 `todo && isRunning`，且用的是与 `data-running` 同源的那个 `isRunning`
- `aria-pressed` / `aria-label` / 圆点 `aria-hidden` / `stopPropagation`（不吃到折叠）
- 位置断言：`name@79083 < pause@80459 < run@82377`（组名之后、正在执行之前）
- 样式类、`.on` 态、360 断点、浅色覆盖都在
- **反证两条**：没改 `dispatchedRef`、`pauseAfterDone` 没进派发 effect

## 补记：「完成后暂停」的空闲复位（id=378）

### 改动

把 14-A 的占位开关接成真状态（双向绑定 + 空闲复位）：

| 项 | 行为 |
| --- | --- |
| 点击 | `setPauseAfterDone((v) => v !== true)` —— 立即切换，不等网络 |
| 文案 | 同一次渲染里跟着变（「完成后暂停」⇄「继续执行」） |
| 空闲复位 | 无执行中任务时复位为 `false`（默认＝继续自动派发） |
| 显隐 | 仍只看 `todo && isRunning`，与执行状态同步 |

### 复位方向为什么是 false

`pauseAfterDone` 的语义是「**这一轮**跑完之后先别派下一条」，是针对当前这一轮的
临时决定，不是长期偏好。任务跑完、界面回到空闲，那次决定的对象已经不存在了。

留着 `true` 的话，下次开工会在用户毫无察觉的情况下直接停在第一条之后 ——
症状是「点了开始，只跑了一条就不动了」，而且极难联想到是上一次那个开关没复位。

默认值才是安全落点：**漏派可以点一下补上，而「以为会继续却停了」会让人以为程序坏了。**

### 这一步最容易写错的地方：把「瞬时为空」当成「真空闲」

会话的 `running` 会在**工具调用之间**短暂变 `false`。这不是猜测 ——
代码里 id=341 就为此专门用 `dispatchedRef` 挡住「同一个空档里连派几条」。

如果一看到空闲就复位，一条要跑十几步工具的任务会在第二个工具调用处被悄悄清掉：
用户明明开着「完成后暂停」，它却在半路自己关了。

所以加了**稳定宽限**：

```js
const PAUSE_RESET_IDLE_MS = 2500   // 比 DISPATCH_SETTLE_MS(1200) 再长一档
```

- 判据用 `setTimeout`，宽限内又忙起来就在 cleanup 里 `clearTimeout` 取消；
- 取值比派发空档更长：既然派发自己都要等 1.2s 才敢判定「这一轮真结束了」，
  复位这个更不可逆的动作（用户可能已经忘了自己开过）就该等得更确定；
- 代价是真结束后开关多挂 2.5 秒，那期间它显示的仍是「继续执行」，不影响正确性。

两个守卫也在：

- **首帧守卫**（`wasBusy === null`）：页面刚加载本来就没人跑，无事可复位；
- **边沿守卫**（`wasBusy !== true`）：只在「忙 → 闲」的边沿起定时器，
  空闲期间每次 sync 不会反复写 state（否则以后给它加个副作用就会空闲时反复触发）。

### 不因重渲染丢失

`pauseAfterDone` 声明在面板组件顶部（与 `state` / `openId` / `busy` 同一层），
不在任何渲染闭包里，所以 sync 触发的重渲染不会重置它。
也没有写进 localStorage —— 它是执行期内的临时决定，刷新后按默认（继续派发）走才对。

### 验证

`scripts/tmp-pause-reset.mjs`（临时，已删）12 条断言全过，核心是**把 effect 的判定
抽成等价状态机**跑了 5 组时序：

| 时序 | 期望 | 结果 |
| --- | --- | --- |
| 跑完后真空闲 | 复位 1 次 | ✅ |
| 工具调用间空档 300ms 后恢复 | **不复位** | ✅ |
| 空档超过 2500ms | 复位 1 次 | ✅ |
| 首帧就空闲 | 不动作 | ✅ |
| 全程空闲 | 不动用户设置 | ✅ |

外加源码断言：`setTimeout(..., PAUSE_RESET_IDLE_MS)`、cleanup 里的 `clearTimeout`、
两个守卫、点击即切换、没写 localStorage。

这是**逻辑等价验证**，不是 React 真跑 —— 「React 真的会按这个顺序触发 effect」
仍需真机确认。

## 补记：把「完成后暂停」接进派发链路（id=379）

### 前置结论：派发由谁驱动

**只有客户端。** 宿主的 `api.js` 里 `dispatch` 是一个纯被调用的路由方法，
没有任何 `setInterval` / 调度循环会自己派发。

所以题面里「若由后端/脚本侧驱动，则写入持久化字段」这一分支**不适用** ——
没有第二处判定，就不存在「两侧不一致」的风险。这一点用断言锁住了
（`宿主侧没有自动派发循环`），避免以后有人加了后台循环却忘了同步这个标记。

### 三个改动

**1. 闸门加进派发前置判定**

```js
const still = () =>
  (epoch === undefined || dispatchEpochRef.current === epoch)
  && pausedByUserRef.current !== true
  && agentRunningRef.current !== true
  && pauseAfterDoneRef.current !== true   // ← 新增
```

被拦下时**给一句提示**（`已完成，按「完成后暂停」停在空闲；拨回「继续执行」可继续派发`），
否则用户只看到任务停了、没有任何解释。

**2. 把派发逻辑抽成 `dispatchNext`**

原来是内联在 effect 定时器里的匿名 async。恢复派发要走同一条路径，
复制一份的话两处会各自演化（一边补了 inflight 重试、一边忘了）——
而它们做的事完全一样。

**3. 拨回「继续执行」时立即恢复**

题面两个条件都判了：`idleNow`（无执行中）+ `hasTodo`（仍有待执行）。
有任务在跑时不动作 —— 它跑完后那个 running 边沿会自然派下一条，
现在多发一次反而会插队。

### 最关键的一个坑：闭包里的旧值

派发 effect 的依赖只有 `[agentRunning, sessionId, cwd]`。用户在**第一轮跑到一半**时
拨开关，effect 不会重跑（依赖没变），它手里捕获的还是旧的 `pauseAfterDone` ——
表现就是「拨了没用，下一条照样派出去」。

所以用 `pauseAfterDoneRef`：同步写入，定时器回调里读到的永远是最新值。
state 仍保留（渲染要它触发重渲染），两者**同源写入**。

三个写入点都同步了 ref，包括容易漏的那个：**空闲复位**
（若只 `setPauseAfterDone(false)` 而 ref 停在 true，闸门就永远关着，队列再也不动）。

### 一个承重的时序不等式

```
PAUSE_RESET_IDLE_MS (2500)  >  DISPATCH_SETTLE_MS (1200)
```

任务结束那一刻，派发 effect 先等 1.2s 再读闸门；若复位定时器更早到点
（2.5s 那个），闸门读到的就已经是被清掉的 `false` —— 开关形同虚设，
而且症状极隐蔽：用户看到的是「开关自己关了」。

已写成常量旁的注释 + 断言锁住这个不等式，改任一数值而破坏它会被拦下。

### 验证

两个临时脚本（已删）共 25 条断言全过：

- 闸门确实在 `still()` 里，且读的是 **ref** 不是 state（反证也做了）
- `dispatch` 请求全程只发一次（没有第二套实现），调用点两个（边沿 + 恢复）
- 拨回的两个条件都在、都满足才恢复、恢复前放开 `dispatchedRef`
- 三个 ref 写入点齐全，没有「只 setState 不写 ref」的地方
- 声明顺序无 TDZ（`dispatchNext` → `toggle`，`items`/`runningCount` 都在前）
- 等价状态机四组闸门时序判定正确
- 承重不等式 `2500 > 1200` 成立

### 过程中修掉的两个自己挖的坑

1. **TDZ**：`togglePauseAfterDone` 一开始写在第 170 行，却要用 `items`（399）、
   `runningCount`（418）、`dispatchNext`（1123）—— 全在后面。整个函数挪到
   `dispatchNext` 之后。
2. **`batchOf` 不可见**：它定义在渲染闭包里的 JSX 段（1813 行），
   `toggle` 那层根本看不到。改成就地按同一口径重算，并在注释里写明
   「两处口径一旦分叉，症状是『拨回继续执行但什么都没发生』」。
