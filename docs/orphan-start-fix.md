# 修复「跑完了但没回填」被误判成中断（id=ImWOun）

## 一、问题

用户反馈：在另一个项目跑「仅回答」类任务，模型**实际已经完成**，
但没回填 `.json`，界面显示「任务中断」。

## 二、根因：`lib/host/orphan.js`

派发时会写 `startedAt`。`recoverOrphanStarts` 定期扫一遍，
把「派发了但从没跑起来」的条目落成 `interrupted: true`，判据是：

```
没完成 + startedAt 可解析 + time === 0 + note === '' + 超过宽限（30 分钟）
```

**问题在中间两条**：它们用「**有没有产出**」推断「**有没有跑起来**」。

但这是两件事。模型真的跑完了、只是没调 `q.mjs done` 回填 ——
`time` 仍是 0、`note` 仍是空 → 被当成「从没跑起来」→ 误标中断。

### 为什么「仅回答」特别容易中招

| 类型 | 产出物 | 是否容易误判 |
| --- | --- | --- |
| 修改 | 改文件（有动作提醒模型回填） | 中 |
| 目标 | 达成结果 | 中 |
| **仅回答** | **对话里的回答文本** | **高** |

「仅回答」既不改文件、也不产生 note / time ——
对这条判据来说它**永远是「没产出」**。用一个恒为真的条件去判定，必然是误判。

### 原注释里还有个自相矛盾

```
条件 4：startedAt 已经超过 GRACE_MS（默认 30 分钟）
        —— 足够覆盖最长的单条任务
       （本仓实测最长 40 分钟的那条是 348-A …）
```

**40 > 30。** 那个 30 分钟根本不够覆盖最长任务。
348-A 没被误伤只是因为它恰好有 `time > 0`，不是因为宽限期够。

## 三、整改（两处）

### 1. 宽限期 30 → 120 分钟

```js
const ORPHAN_GRACE_MS = 120 * 60 * 1000   // 原 30 分钟
```

取「已知最长任务（40 分钟）× 3」留足余量。

dispatch 的宽限本来是给「turn 空转」兜底的 —— 空转是**秒级**现象。
真正需要长时间等待的是**正常运行中的任务**。把这两件事混在一个计时器里，
就只能取更长的那一侧。

### 2. 「仅回答」不参与本判据

```js
if (str(item.taskType) === '仅回答') return false
```

它天然没有产出物，用「产出」判它必然误判。这里选择**不判**：

- 漏判的代价 = 条目多显示一会儿「执行中」，用户点一下继续即可
- 误判的代价 = 用户以为模型没干活，**实际已经答完了**

后者严重得多。

## 四、被误标了怎么办（恢复方法）

`done` 命令**不拒绝** `interrupted` 的条目（只拒绝「不存在」和「草稿」），
所以直接回填即可：

```bash
node .plan/q.mjs done --id <任务id> --note "仅回答已完成，此前未回填"
```

实测结果：

```
执行前: execute=false, interrupted=true, note=""
执行后: execute=true,  interrupted=false, note="仅回答已完成"
```

而且这些条目**仍在可执行队列里**（`isActionable` 不排除 `interrupted`），
从来没被吞掉，数据不会丢。

界面上也有 `继续` 按钮：它优先捞出 `interrupted === true && execute !== true`
的条目并恢复派发（`60-tab.js:998`）。

## 五、验证（31 条断言）

| 场景 | 结果 |
| --- | --- |
| **仅回答 + 40 分钟 + 无回填（用户的情况）** | **不再判定** ✓ |
| 仅回答 + 1000 分钟 | 仍不判定 ✓ |
| 修改 + 40 分钟 | 不判定（宽限已延长）✓ |
| 修改 + 130 分钟 | **仍回收**（能力没坏）✓ |
| 边界 119/120 分钟 | 不触发 ✓ |
| 边界 121 分钟 | 触发 ✓ |
| 有 time / 有 note | 一律不动 ✓ |
| 已完成/草稿/失败/已中断 | 一律跳过 ✓ |
| 拆解批次里仅回答子任务 | 豁免，只回收修改类 ✓ |
| 显式传 graceMs | 仍生效（测试可用性）✓ |

## 六、改动范围

| 文件 | 改动 |
| --- | --- |
| `lib/host/orphan.js` | 常量 30→120；新增仅回答豁免；更新注释 |
| `lib/host/api.js` | 同步更新调用处注释 |

**没有改判据的核心结构**（仍然是「没完成 + 有 startedAt + 没产出 + 超宽限」），
只调了参数和加了一个豁免分支 —— 改动面小，风险低。

## 七、还没做的（值得考虑）

1. **用「session turn 是否结束」替代「有没有产出」** —— 这才是真正的信号。
   需要 dispatch 时记录 turn 标识，结束时回写，改动面较大。
2. **仅回答的豁免是「一刀切」** —— 如果某条仅回答真的空转了，现在永远不回收。
   折中方案：仅回答用更长的宽限（比如 6 小时）而不是完全不判。
3. **`ORPHAN_GRACE_MS` 是硬编码常量**，没有配置入口。任务普遍变长时还会撞到上限。

这三条都超出了本次「整改误判」的范围，先记录。

---

# 三项优化落地（turn 信号 / 仅回答长宽限 / 可配置宽限）

第七节列的三个遗留问题，全部实现。

## 一、用 turn 结束替代「有没有产出」（最重要的那条）

### 问题本质

原判据把**两个不同信号**混成一个：

| 信号 | 含义 | 可靠性 |
| --- | --- | --- |
| 有 `time > 0` 或有 `note` | **间接**推断「跑过」 | 会漏 —— 仅回答天然没有 |
| turn 真的结束了 | **直接**观测「跑过」 | 可靠 |

「跑完了但没调 `q.mjs done`」在第一个信号看来和「从没跑起来」完全一样。

### 实现

真正的信号只有客户端有：`sessions.list` 的 `running` 由 true 翻成 false。

**宿主侧** —— 新增 `markTurnEnd`（`api.js`）：

```js
async markTurnEnd({ ctx, sessionId, cwd: cwdHint, id }) {
  // 找到条目 → 写 turnEndedAt（幂等：已有就不重写）
  // 找不到 id 不报错（turn 结束时条目可能已被删/归档）
}
```

路由器是 `Object.hasOwn(API, method)` 自动转发，所以新方法无需注册即生效。

**客户端侧** —— 在 `60-tab.js` 加一个 effect：

```js
const prevRunningRef = React.useRef(false)
React.useEffect(() => {
  const wasRunning = prevRunningRef.current
  prevRunningRef.current = agentRunning === true
  if (!(wasRunning && agentRunning !== true)) return   // 只认 true→false
  if (typeof sessionId !== 'string' || sessionId === '') return
  const startedButOpen = (items ?? []).filter(...)     // 已开始、未完成、还没报过
  for (const id of startedButOpen) {
    call('markTurnEnd', { ...payload, id }).catch(() => null)
  }
}, [agentRunning, items, sessionId])
```

**判据侧**（`orphan.js`）—— 最强证据优先：

```js
if (str(item.turnEndedAt) !== '') return false   // turn 结束过 → 绝对不是孤儿
if (normalizeTime(item.time) > 0) return false   // 次强：有产出
if (str(item.note) !== '') return false
return now - started > graceFor(item, graceMs)   // 兜底：按宽限
```

### 三个实现细节

1. **为什么记时间戳而不是布尔** —— 时间戳还能回答「什么时候结束的」，
   将来做耗时统计用得上；布尔不可逆地丢掉这个信息。
2. **为什么遍历多条而不是猜一条** —— 正常只有一条，但并发/残留时可能多条；
   宿主端幂等，多报无害。
3. **为什么失败静默** —— 这只是给宿主补个判据字段，不是主操作。
   报不上去最坏退回老判据，不会更糟。

### 踩到的坑：TDZ

第一版把 effect 写在 `agentRunning` 的 effect 旁边（约 372 行），
但 `items` 定义在第 460 行 —— `const` 的**暂时性死区**会让运行时抛错。

`node --check` 通过、`npm test` 通过，**只有真实执行才暴露**。
已把整段移到 `items` 之后（462 行），并加了一条「定义顺序」断言。

> 这个项目里 `src/client/*.js` 是**同一作用域**拼接的，没有模块边界 ——
> 「变量定义在后面」不会在语法检查时报错，只会运行时炸。

## 二、仅回答改用 6 小时宽限（不再一刀切豁免）

原来直接 `return false`（完全不判）。但那样**真空转的仅回答条目永远不回收** ——
一个坑换成另一个坑。

改成两档宽限：

| 类型 | 默认宽限 |
| --- | --- |
| 修改 / 目标 | 120 分钟 |
| 仅回答 | **360 分钟（6 小时）** |

效果：正常仅回答（几分钟答完）绝不会误判；真空转了 6 小时后照样能收回去。

## 三、宽限改为可配置

新增两个设置项（`.plan/settings.json`）：

```json
{
  "orphanGraceMin": 120,
  "orphanGraceAnswerMin": 360
}
```

范围 1 ~ 10080 分钟（7 天），非法值退回默认**不抛错**（与 `todoThreshold` 同口径）。

`graceFor()` 支持三种形态：

| 传参 | 行为 |
| --- | --- |
| `{ normal, answer }` | 两档分别命中（新） |
| 数字 | 对所有人生效（老调用方 / 测试） |
| 不传 | 用默认 120 / 360 |

## 四、验证

### 单元（32 条）

| 组 | 覆盖 |
| --- | --- |
| 常量默认值 | 120 / 360 / 上限 10080 |
| `graceFor` 两档 | 修改→120、仅回答→360、配置对象、老数字形态 |
| 核心场景 | 仅回答 40 分钟不判、5 小时不判 |
| **真空转可回收** | 仅回答 7 小时 → 判孤儿（不再永久卡住）|
| 边界 | 359/360/361、119/120/121 |
| settings | 合法值、越界夹取、字符串/null 回退 |
| 端到端配置 | normal=5min 时 6 分钟触发、4 分钟不触发 |
| 原有保护 | execute/draft/failed/interrupted/time/note 一律跳过 |

### 客户端真实执行（9 条）

把 effect 抠出来用**假 React + 假 call** 实际跑：

| 场景 | 结果 |
| --- | --- |
| `true → false` 翻转 | 只上报应报的那条（已完成/无 startedAt/已报过的都过滤掉）|
| 首次挂载 | 不误报 |
| 无 sessionId | 不报 |
| 空 items / null / 异常值 | 不崩溃、不误报 |

`--check` 和 grep 都过不了这一关 —— 必须真跑。

### 端到端（真实读写盘）

```
markTurnEnd → marked=true, turnEndedAt 落盘 ✓
孤儿判据（8 小时前 + 仅回答）→ false ✓ 不再误判
幂等重调 → marked=false ✓
不存在的 id → 不报错 ✓
```

**第一次端到端是失败的**：`marked=false`，字段没落盘。
原因是我用了 `id:"T1"` 当测试数据 —— 而 `readPlan` 的迁移逻辑会把它换成随机 id，
于是 `findNode("T1")` 返回 null。换成合法 id 后通过。

> 测试数据也必须符合 id 规则，否则测的是「迁移」而不是「被测逻辑」。

## 五、改动清单

| 文件 | 改动 |
| --- | --- |
| `lib/host/orphan.js` | `graceFor()` 两档；`turnEndedAt` 作为最强证据 |
| `lib/host/constants.js` | 4 个新常量 + 导出 |
| `lib/host/settings.js` | `normalizeOrphanGrace` + 两个新键 |
| `lib/host/api.js` | 新增 `markTurnEnd`；调用处传两档宽限 |
| `lib/host/store.js` | 归一 `turnEndedAt` 字段 |
| `lib/host/migrate.js` | 白名单加 `turnEndedAt`（否则迁移会丢字段）|
| `src/client/60-tab.js` | turn 结束上报 effect |
| `lib/client.js` | 重新构建（297263 字节）|

## 六、部署

- 宿主改动（`lib/host/*`）：**重启 `dsh web`**
- 客户端改动（`60-tab.js` → `lib/client.js`）：**`Ctrl+F5`**

## 七、仍然存在的边界

1. **老数据没有 `turnEndedAt`** —— 判据自动回退到「有产出 / 宽限」两档，
   不会因为加字段而改变历史行为。
2. **`running` 抖动** —— 若会话 running 短暂 false 后又 true，
   会误写一次 `turnEndedAt`。后果是「本该判孤儿的不判了」，
   属于**偏保守**的错，可接受。
3. **多标签页** —— 每个标签页都订阅 `sessions.list`，会重复上报；
   宿主幂等已挡住。
