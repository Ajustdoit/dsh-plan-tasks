# 两个开关同时为真时的实际执行路径（id=5-B）

> 前置：`docs/toggle-chain.md`（5-A 的对应关系清单）。
> 本文只回答「同时为真时到底走哪条、谁决定什么」。

## 一、一句话结论

**`splitMode` 优先，命中即 return；`deepMode` 从不改变"走哪条"，
它只改变"那条路内部怎么做"。**

两个同时为真时 = **走拆解路径，且拆解按「深入」要求执行**。
没有互斥、没有覆盖、没有丢弃。

## 二、分支：`splitMode` 先命中并立即短路

`src/client/60-tab.js:757` 起，`append()` 函数体：

```js
const append = async () => {
  if (form.plan.trim() === '') { …; return }
  if (splitMode) {          // ← 765 行：先查拆解
    await split()
    return                  // ← 立即返回，下面全部不执行
  }
  const text = composePrompt({ …, deep: deepMode })   // 773 行：仅 splitMode=false 才到这
  call('append', …)                                    // 781 行
}
```

### 四种组合的实测

| splitMode | deepMode | 实际路径 | deep 的作用 |
| --- | --- | --- | --- |
| false | false | `append` | 无 |
| false | **true** | `append` | 改写**正文** |
| **true** | false | `split` | 无 |
| **true** | **true** | `split` | 进**提示词** |

**关键**：`splitMode === true` 时，`composePrompt` 与 `call('append')` 永远不会执行
（765 行的 `return` 挡住了）。所以两个开关同时为真时，
**不会出现「既 append 一条、又拆解 N 条」的双写**。

`60-tab.js:763-764` 的注释说明了历史：

> id=262 起不再「深入模式被短路」：两个开关可以同时点亮，
> 深入会作用到每一次拆解（见 split()），拆出来的每条子任务都按「做深」的要求写。

改前是「深入被拆解短路」（deep 被丢掉），改后是「deep 作为参数透传」。

## 三、prompt / 指令拼接：不覆盖，是追加

### 3.1 `append` 路径：deep 进**正文**

```
60-tab.js:773   composePrompt({ text, taskType, deep: deepMode })
   └─ 30-runtime.js:352   deep === true ? deepPrompt(body) : body.replace(/\r\n?/g, '\n')
        └─ 30-runtime.js:316   deepPrompt()
```

改写结果（实测）：

```
普通：修个 bug
深入：我想让这项任务做得更深入，而不是把规模做得更大。

     当前任务：
     修个 bug
```

**幂等**：正文已含 `DEEP_MARK` 时原样返回（`30-runtime.js:320`），
所以重复提交不会叠两层。

### 3.2 `split` 路径：deep 进**提示词模板**

```
60-tab.js:902   call('decompose', { …, deep: deepMode === true })
   └─ api.js:570   const deepMode = deep === true
        └─ api.js:601  拼进 user 提示词
```

拼装顺序（`api.js:596-616`）：

```
## 需求
X
                            ← deepMode=false 时这里是空串，被 .filter 掉
## 深入要求（强制）          ← deepMode=true 才有
用户打开了「深入模式」：他要的是把这件事做深，而不是把范围摊大。因此：
1. 每一条子任务的 plan 都要写清「怎么做才算做到位」，而不是只写「做什么」；
2. 单条宁可小而深，不要靠加条数来覆盖需求；不许因为「深入」就把范围拆得更碎…
3. plan 里要包含可验证的完成标准（改完看什么、跑到什么程度算过）；
4. 不确定的材料/文件不要臆造，写「先确认 X」而不是编一个路径。

## 条数要求                 ← 两种模式都有，且**数值完全相同**
拆成 1~8 条（硬上限 12 条）。

## 项目快照
S
```

是**追加一段**，不是替换任何已有段落。`## 需求` 与 `## 条数要求` 在两种模式下都存在。

### 3.3 两条路径的正文差异（容易漏）

| 路径 | 用户写的正文会被改吗 | 落到 plan 字段的是 |
| --- | --- | --- |
| `append` + deep | **会**（包模板） | 改写后的长文本 |
| `split` + deep | **不会** | 模型产出的子任务描述 |

所以「深入」在两条路径下的**落盘形态完全不同**：
前者是可见的模板文本，后者只体现在模型输出质量上。

## 四、生成参数：条数由代码常量定，与 deep 无关

`api.js:588-589`：

```js
const lo = Number.isInteger(min) && min > 0 ? Math.min(min, DECOMPOSE_HARD_CAP) : DECOMPOSE_MIN
const hi = Number.isInteger(max) && max >= lo ? Math.min(max, DECOMPOSE_HARD_CAP) : Math.max(lo, DECOMPOSE_SOFT_MAX)
```

- `DECOMPOSE_MIN = 1`、`DECOMPOSE_SOFT_MAX = 8`、`DECOMPOSE_HARD_CAP = 12`（`constants.js:83-85`）
- **前端从不传 `min` / `max`**（`60-tab.js` 里搜不到这两个字段）
- 所以每次拆解固定 `1~8` 条（硬上限 12）

**`deep` 完全不参与这个公式。** 想改条数只能改常量或加传参，开关做不到。

### 粒度：deep 只约束"单条内部"，不约束"拆几条"

`## 深入要求` 第 2 条明确写着：

> 单条宁可小而深，不要靠加条数来覆盖需求；不许因为「深入」就把范围拆得更碎

这与紧随其后的 `拆成 1~8 条` **是同向约束**，不冲突：
条数区间由代码定死，深入只影响**每条内部写多细**。

## 五、id 规则：与 deep 完全无关

`api.js:678` 的 `buildBatch` ctx：

```js
buildBatch(built, {
  parentId,          // createTaskId → 6 位随机
  order,
  createdAt,
  name,
  decomposeKey,
  sourcePrompt,
})
```

**ctx 里没有 `deep` 这个键**。所以：

| 项 | 由什么决定 |
| --- | --- |
| 父 id | `createTaskId()` 随机 6 位 |
| 子 id | `childIdOf(parentId, index)` → `父id-A/B/C` |
| 条数 | `lo`/`hi` → 模型产出 → `built` 数组长度 |
| `decomposeKey` | `dedupeKeyOf()`，**含 deep** |
| `sourcePrompt` | 用户原文，**含 deep 时也不改写** |

## 六、deep 真正影响的三处（都在拆解路径内）

| 位置 | 影响 | 后果 |
| --- | --- | --- |
| `api.js:573` | **去重键**：`text + '\0深入'` vs `text` | 同一句话「普通拆」与「深入拆」是两份不同产物，不会互相判重复 |
| `api.js:601` | **提示词**加「## 深入要求（强制）」4 条 | 影响模型产出质量 |
| `api.js:625` | **缓存键**含 `deep: deepMode` | 深入与非深入不会共用同一次模型结果 |

这三处缺一不可：

- 少了去重键 → 第二次（换了开关）提交会被当成重复，直接还回上次结果，用户以为开关没生效
- 少了缓存键 → 缓存会给出另一模式的旧结果
- 少了提示词 → 开关点了跟没点一样

`api.js:565-568` 的注释正是这个意思：

> 它必须参与幂等键 —— 同一句话「普通拆」和「深入拆」是两份不同的产物，
> 不区分的话第二次会被当成重复直接还回上一次的结果，用户会以为开关没生效。

## 七、完整决策链（两个都为真时）

```
[用户点击发送]
   │
   ├─ form.plan 为空？ → 报错返回
   │
   ├─ splitMode === true ────────────────► split()
   │     │                                   │
   │     │  deepMode 不参与分流               ├─ ensureModel() 无模型 → 提示并 return
   │     │                                   ├─ setSplitting(true)
   │     │                                   ├─ call('decompose', { deep: true })
   │     │                                   │     │
   │     │                                   │     ├─ deepMode = true
   │     │                                   │     ├─ key = sha1(cwd + text + "\0深入")  ← deep 影响
   │     │                                   │     ├─ 命中同 key → 直接返回旧结果（duplicate）
   │     │                                   │     ├─ 提示词加「## 深入要求」            ← deep 影响
   │     │                                   │     ├─ cacheKey 含 deep                   ← deep 影响
   │     │                                   │     ├─ lo=1, hi=8（与 deep 无关）
   │     │                                   │     └─ buildBatch：父 id 随机、子 = 父id-A/B（与 deep 无关）
   │     │                                   └─ 提示「已拆解 N 条到待执行（深入）」
   │     │
   └─ splitMode === false ───────────────► append()
         │
         └─ deepMode === true → composePrompt → deepPrompt() 改写正文
              └─ call('append', { plan: 已改写文本 })   ← 不传 deep 字段
```

## 八、结论要点（可直接引用）

1. **分支不互斥**：`splitMode` 先命中即 `return`，`append` 整段不执行；不存在双写。
2. **prompt 不覆盖**：拆解路径是**追加**一段「## 深入要求」，`## 需求` / `## 条数要求` 仍在。
3. **条数由常量定**：`DECOMPOSE_MIN=1`、`DECOMPOSE_SOFT_MAX=8`、`DECOMPOSE_HARD_CAP=12`，
   前端不传 `min`/`max`，**deep 不参与**。
4. **id 规则由 `createTaskId` + `childIdOf` 定**，`buildBatch` 的 ctx 里没有 `deep`。
5. **deep 的真实作用只有三处**：去重键、提示词、缓存键。
6. **落盘形态不同**：`append` 路径改正文（可见模板文本）；
   `split` 路径不改正文，深入只体现在模型产出里。

## 九、验证

23 条断言，覆盖：分支四种组合、去重键差异、条数公式、id 规则、
提示词拼接顺序、缓存键构成、深入段与条数段的语义关系。

其中条数与提示词部分用**复刻真实代码逻辑**的方式验证，
不是读代码后主观判断。
