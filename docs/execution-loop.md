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
  ├─ 客户端 60-tab.js:656  startWork()
  │     ├─ 先试浏览器侧 kickoffViaClient(ctx, sessionId, text)       (60-tab.js:675)
  │     └─ 不可用则回落  call('kickoff', { text })
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
| `queue-cli.js:196` `snapshot(items)` | 输出 `{ remaining, next, group }`；`next` 里才带 `plan`（正文） |
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
4. **去重靠 `dispatchedRef`（内存）。** 页面刷新后这个标记会丢，可能对同一条再派一次；
   `start` 存在 `startedAt` 时已幂等，但「刚派出去还没开始跑」的窗口仍无持久记录。343 收口。
5. **`.plan/q.mjs` 是副本。** `queue.js:23 ensureQueueCli` 每次 `read` 都会把模板覆盖写一遍，
   所以任何「改 q.mjs 的行为」都必须改 `lib/host/queue-cli.js`，不能改 `.plan/q.mjs`。

## 改造落点（供 342/343 参考）

| 任务 | 落点 |
| --- | --- |
| 342 组按队列投递 | 复用 `nextTask()` 的 `parentId` / `index` / `groupRemaining`，在 `settings.json` 或 `.plan/dispatch.json` 记 `cursor`；harness 无队列接口，因此是「按顺序逐条投递 + 本地游标」 |
| 343 边界收口 | 已投递去重从内存搬到磁盘（用任务 id）；`api.cancel` 已有；「无可取任务 → 清运行态」由 `dispatch` 返回 `reason:'empty'` 处理 |

## 参考

- 技能正文：`dsh-plan-tasks/lib/host/skill.js:62 skillMarkdown()`
- 队列实现：`dsh-plan-tasks/lib/host/queue-cli.js`
- 派发实现：`dsh-plan-tasks/lib/host/dispatch.js`
- 会话投递：`dsh-plan-tasks/lib/host/api.js:819 kickoff` / `api.js:851 dispatch` / `api.js:933 cancel`
- 面板循环入口：`dsh-plan-tasks/src/client/60-tab.js:656 startWork()`；自动刷新 `60-tab.js:381`；
  派发 effect `60-tab.js:833`
- 状态现算：`dsh-plan-tasks/src/client/30-runtime.js:205 statusOf()`
