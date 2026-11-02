# 「深入模式」「拆解」开关链路清单（id=1-A）

> 本步只做定位，**不改任何代码**。

## 一、总览：两个开关完全不同

| | 深入模式 `deepMode` | 拆解 `splitMode` |
| --- | --- | --- |
| 存储位置 | `localStorage` | `localStorage` |
| localStorage 键 | `dsh-plan-tasks:<cwd>` | 同左（同一对象里的字段） |
| 默认值 | `false` | `false` |
| 写入方 | 前端 `setDeepMode` | 前端 `setSplitMode` |
| 是否进 `plan.json` | **否** | **否**（但产物带 `decomposeKey`） |
| 是否传给宿主 | 普通模式：不传（已拼进文本）<br>拆解模式：传 `deep: true` | 前端据此分流到 `decompose` |
| 落盘"证据" | 正文里的 `DEEP_MARK` 标记句 | 父条目上的 `decomposeKey` |

**关键结论：两个开关本身都不写入 `.plan/plan.json`。**
它们只是前端的 UI 状态，靠 `localStorage` 记忆；
对数据的影响全部通过「改写正文」或「写 decomposeKey」间接发生。

### 本插件在 localStorage 里的**两个**键（别混淆）

| 键 | 存什么 | 相关代码 |
| --- | --- | --- |
| `dsh-plan-tasks:<cwd>` | 输入框草稿 `form`、展开项 `openId`、自动刷新 `auto`、**`deepMode`**、**`splitMode`** | `60-tab.js:29 / 36 / 244` |
| `dsh-plan-tasks:groups:<cwd>` | 当前展开的是哪个分组（`openGroup`：`'todo'` / `'unreviewed'` / `'reviewed'` / `null`） | `60-tab.js:106 / 132` |

第二个键**与两个开关无关**，只是同一个插件的另一份 UI 记忆。
它的历史值是 `'draft'`（草稿组已删除），读取时会归一成 `null`（全部收起）——
`60-tab.js:111-114` 有注释说明为什么不能直接返回 `'draft'`。

## 二、深入模式 `deepMode`

### 2.1 定义与持久化

| 位置 | 内容 |
| --- | --- |
| `src/client/60-tab.js:59` | `const [deepMode, setDeepMode] = React.useState(saved?.deepMode === true)` |
| `src/client/60-tab.js:29` | `const storeKey = \`dsh-plan-tasks:${cwd \|\| 'default'}\`` |
| `src/client/60-tab.js:36` | 读取：`JSON.parse(localStorage.getItem(storeKey))` |
| `src/client/60-tab.js:244` | 写入：`JSON.stringify({ ...form, openId, auto, deepMode, splitMode })` |
| `src/client/60-tab.js:2434` | UI：`className: \`plt-deep-toggle${deepMode ? ' on' : ''}\`` |
| `src/client/60-tab.js:2436` | `aria-pressed: deepMode ? 'true' : 'false'` |

默认 `false`：`saved?.deepMode === true`，localStorage 里没有该字段时即 `false`。
写入是**白名单式**（显式列出 4 个字段），所以老用户残留的 `draftMode` 会在下次写入时自然消失。

### 2.2 消费方一：普通模式（前端改写正文）

```
60-tab.js:773   composePrompt({ text, taskType, deep: deepMode })
   └─ 30-runtime.js:352
        const raw = options?.deep === true ? deepPrompt(body) : body.replace(/\r\n?/g, '\n')
             └─ 30-runtime.js:316  deepPrompt()
                  └─ 包模板 + DEEP_MARK 幂等判断
```

| 位置 | 作用 |
| --- | --- |
| `30-runtime.js:291` | `const DEEP_MARK = '我想让这项任务做得更深入'` |
| `30-runtime.js:320` | 幂等：`if (body.includes(DEEP_MARK)) return body` |
| `30-runtime.js:325` | 拼模板：`DEEP_MARK + '，而不是把规模做得更大。…'` |
| `30-runtime.js:352` | `deep === true` 时走 `deepPrompt`，否则只做 CRLF 归一 |

**普通模式下 `deep` 不传给宿主**。宿主收到的 `plan` 文本已经被前端改写好了，
`append` 的入参里没有 `deep` 字段。

### 2.3 消费方二：拆解模式（传给宿主）

```
60-tab.js:902   call('decompose', { …, deep: deepMode === true })
   └─ api.js:557  decompose({ …, deep })
        ├─ api.js:570  const deepMode = deep === true
        ├─ api.js:573  dedupeKeyOf(dedupeKey, deepMode ? `${text}\u0000深入` : text, cwd)
        ├─ api.js:601  拼进模型提示词的「## 深入要求（强制）」段
        ├─ api.js:632  cacheKey 里带 deep（命中缓存需完全一致）
        └─ api.js:711  return { …, deep: deepMode }   ← 只回给前端，不落盘
```

| 位置 | 作用 |
| --- | --- |
| `api.js:570` | 归一为布尔 |
| `api.js:573` | **影响去重键**：深入与非深入视为不同需求（加 `\u0000深入` 后缀） |
| `api.js:601-608` | 拼进提示词：4 条硬要求（做深不做大 / 小而深 / 可验证完成标准 / 不臆造路径） |
| `api.js:632` | 进缓存键，避免「深入」与「普通」共用一次模型结果 |
| `api.js:711` | 回传前端（用于提示文案），**不写入条目** |

### 2.4 「深入」是否落盘？

**不落一个 boolean 字段**，而是把标记句写进正文。

| 检查 | 结果 |
| --- | --- |
| `plan.json` 条目是否有 `deep` 字段 | **无**（18 个字段里没有） |
| 真实数据 5 条是否含 `DEEP_MARK` | 0 条（最近都走拆解路径） |
| `DEEP_MARK` 是否有展示用途 | 无，只在 `deepPrompt` 内做幂等判断 |

`30-runtime.js:289` 的注释说明了设计意图：

> 它同时是「深入模式生效过」的落盘证据，比另存一个 boolean 更耐改。

### 2.5 界面提示

| 位置 | 文案 |
| --- | --- |
| `60-tab.js:801` | `已追加计划 #id（深入模式，已改写提示词）` |
| `60-tab.js:923` | `已拆解 N 条到待执行（深入）…` |

两处都读前端的 `deepMode`，不读数据。

## 三、拆解 `splitMode`

### 3.1 定义与持久化

| 位置 | 内容 |
| --- | --- |
| `src/client/60-tab.js:61` | `const [splitMode, setSplitMode] = React.useState(saved?.splitMode === true)` |
| `src/client/60-tab.js:244` | 与 `deepMode` 同一个 localStorage 对象 |
| `src/client/60-tab.js:2400` | UI：`className: \`plt-chip plt-chip-split${splitMode ? ' active' : ''}\`` |
| `src/client/60-tab.js:2416` | `onClick: () => setSplitMode(!splitMode)` |

默认 `false`，同样不落 `plan.json`。

### 3.2 分流：一个开关决定走哪条 API

```
60-tab.js:765   if (splitMode) { await split(); return }
60-tab.js:773   否则 composePrompt(...) → call('append', ...)   （普通模式）
```

| 分支 | API | 说明 |
| --- | --- | --- |
| `splitMode === true` | `decompose` | 不落一条，交给宿主拆成 N 条 |
| `splitMode === false` | `append` | 落一条，正文已由 `composePrompt` 处理 |

### 3.3 数据层面的落点：`decomposeKey`

拆解模式唯一写进 `plan.json` 的是父条目上的 `decomposeKey`：

| 位置 | 作用 |
| --- | --- |
| `api.js:573` | 算出 key（sha1 前 24 位，或客户端直接给） |
| `api.js:685` | `decomposeKey: key` 写进父条目（`buildBatch` 的 ctx） |
| `api.js:179-180` | 幂等判定：父上有 `key`，或任一 child 上有 `key` |
| `api.js:553` | 注释：返回那次的结果，靠 `decomposeKey` 认领 |

**消费方（界面）**：

| 位置 | 用途 |
| --- | --- |
| `60-tab.js:1423` | 有 `decomposeKey` 的条目 → 不允许 pin |
| `60-tab.js:2068` | `canPin: groupKey === 'todo' && (item.decomposeKey ?? '') === ''` |
| `50-item.js:426` | 拆分父（有 `decomposeKey`）→ 永远拿不到 pin |
| `60-tab.js:2064` | 注释：判定依据只能是 `decomposeKey`，`[拆] ` 前缀是宿主拼的，不可靠 |

真实数据里 `decomposeKey` 形如 `789a66ffa496d1686caa…`（sha1 截断）。

## 四、容易混淆的三组概念

| 概念 | 存哪 | 说明 |
| --- | --- | --- |
| `deepMode` / `splitMode` | localStorage | **UI 开关本身**，不进 plan.json |
| `[拆] ` 前缀 | 条目 `name` | 宿主拼的展示文本，**不能**用来越定拆解来源 |
| `decomposeKey` | 条目字段 | 拆解来源的**唯一可靠判据** |

### 一个对照案例

历史上 `5` 号任务（现已重编号为 `QX5dyu`）同时具备：
- `decomposeKey` 有值 → 确实是拆解产出
- 但 `plan.json` 里**没有任何 `deep` 字段** → 无法从数据判断当初是否开了深入

这正是「深入不落 boolean」的后果：**深入的效果只存在于正文文本里**，
如果正文被后续操作改写，就无法追溯。

## 五、完整链路图

### 深入模式

```
[UI 开关 plt-deep-toggle]
   │  setDeepMode
   ▼
[localStorage: dsh-plan-tasks:<cwd>.deepMode]   ← 默认 false，白名单写入
   │
   ├─ 普通模式 ──► composePrompt({ deep }) ──► deepPrompt() 改写正文
   │                                              └─ DEEP_MARK 幂等
   │              └─► call('append', { plan: 已改写文本 })   ← deep 不再传
   │
   └─ 拆解模式 ──► call('decompose', { deep: true })
                    ├─ dedupeKey 加 "深入" 后缀（影响幂等）
                    ├─ 提示词加「## 深入要求（强制）」4 条
                    ├─ cacheKey 带 deep（影响缓存命中）
                    └─ return { deep } 给前端（不落盘）
```

### 拆解开关

```
[UI 开关 plt-chip-split]
   │  setSplitMode
   ▼
[localStorage: dsh-plan-tasks:<cwd>.splitMode]  ← 默认 false
   │
   └─► if (splitMode) call('decompose', …)   ← 分流点：60-tab.js:765
          │
          ├─ dedupeKeyOf() ──► sha1(cwd + question)[:24]
          ├─ 幂等：父或 child 上有同 key → 返回"已拆解过"
          ├─ buildBatch() ──► 父 id 随机 + children
          └─ 写盘：父条目 .decomposeKey = key
                       │
                       ▼
              界面读 decomposeKey 判 pin 能力
              (60-tab.js:2068 / 50-item.js:426)
```

## 六、清单速查

| 开关 | 字段名 | 定义处 | 默认 | 写入方 | 读取方 |
| --- | --- | --- | --- | --- | --- |
| 深入模式 | `deepMode` | `60-tab.js:59` | `false` | `setDeepMode`（UI 点击） | `composePrompt` / `split()` / 提示文案 |
| 深入模式（宿主） | `deep` 参数 | `api.js:557` | 不传即 `false` | 前端 `call('decompose')` | `api.js:570` |
| 拆解 | `splitMode` | `60-tab.js:61` | `false` | `setSplitMode`（UI 点击） | 分流 `60-tab.js:765` |
| 拆解（数据） | `decomposeKey` | 条目字段 | 无 | `api.js:685` | `api.js:179`、`60-tab.js:2068` |

## 七、本步没有回答的问题（下一步可能会碰）

1. **深入的效果无法从数据侧追溯** —— 只能翻正文找 `DEEP_MARK`，而正文可被编辑。
2. **两个开关都没有"会话隔离"** —— localStorage 按 `cwd` 分，同项目多会话共享。
3. **`decomposeKey` 在归档后是否保留** —— 本步未查（属后续任务范围）。
