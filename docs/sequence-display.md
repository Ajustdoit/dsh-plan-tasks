# 条目主行显示「序号 + # + id」（id=fzTvER-B）

## 一、需求

三个页签（已审核 / 待审核 / 待执行）的条目主行显示成：

```
1 # QSX45D
```

- 前面是**该页签内的位置**（1 起）
- 后面是**原始 id**，一字不改
- id 仍是点击、复制、派发的唯一依据

## 二、改动

### 1. 序号计算（`60-tab.js`）

在 `groups` 定义之后，为每组算一次序号 Map：

```js
const seqByGroup = new Map()
for (const group of groups) {
  seqByGroup.set(group.key, sequenceMapOf(group.list))
}
```

`renderItem` 里按 `groupKey` + 原始 `item.id` 查：

```js
const seqMap = seqByGroup.get(groupKey)
const seq = seqMap instanceof Map ? (seqMap.get(item.id) ?? 0) : 0
```

然后作为 prop 传给 `Item`。

**为什么按组算而不是全局算**：三个页签各自的列表长度不同，
用户看到的「第 2 条」是**该页签里的**第 2 条。全局编号会在每个页签里
出现跳号（1、3、7），反而更难读。

**为什么先算成 Map**：`sequenceOf` 按数组下标递增，而渲染时拿到的是单个 item。
用 Map 查是 O(1)，也避免在渲染循环里重复算整份列表。

### 2. 渲染（`50-item.js`）

```js
Number.isFinite(seq) && seq > 0
  ? h(
      'span',
      { className: 'plt-id' },
      h('span', { className: 'plt-seq' }, String(seq)),
      ' ',
      h('span', { className: 'plt-id-hash' }, '#'),
      ' ',
      String(item.id),
    )
  : h('span', { className: 'plt-id' }, `# ${item.id}`),
```

### 3. 样式（`02-content.css`）

```css
.plt-root .plt-seq{opacity:.62;font-weight:400}
.plt-root .plt-id-hash{opacity:.72}
```

序号与 `#` 都压淡一档 —— 视线先落在 id 上。序号是位置，id 是身份。

## 三、三个容易写错的地方

### 1. 空格必须显式写

相邻的行内元素在 HTML 里**不会自动插入空白**。三个 span 挨着写会渲染成：

```
1#QSX45D      ← 错
```

必须写成 `h(...), ' ', h(...), ' ', String(id)`。
这个错误是**实测发现的** —— 第一版漏了空格，`node --check` 和 `npm test` 全都通过。

### 2. 查 Map 必须用原始 id，不能先 `String()`

`sequenceMapOf` 用 `item.id` **本身**作 Map 键。
历史数据里 id 是数字（`12`），随机 id 是字符串（`aB3xK9`）—— 两者是不同的键。

```js
seqMap.get(item.id)      // ✓ 数字 id 能查到
seqMap.get(String(item.id))  // ✗ 数字 12 会变成 '12'，查不到
```

实测验证：`m.get(12) === 1`，但 `m.get('12') === undefined`。

### 3. `seq` 取不到时不要硬编数字

`seq` 为 0 / NaN / undefined 时只显示 `# id`。
硬编一个「1」会让所有查不到的条目都显示成第 1 条，比不显示更误导。

## 四、id 没有被改动（逐条验证）

| 用途 | 代码 | 状态 |
| --- | --- | --- |
| React key | `key: item.id` | 原样 |
| 事件 | `pinTop(item.id)` | 原样 |
| 拖拽 | `setData('text/plain', String(item.id))` | 原样 |
| 复制 ID | `String(item.id ?? '').trim()` | 原样 |
| 批量通过 | `onApproveBatch: (batchId) => void approveBatch(batchId)` | 原样 |

**没有任何地方写 `item.id = ...`** —— 展示层纯读。

## 五、验证（29 条）

### 真实执行渲染函数

不是 grep 字符串 —— 把渲染表达式抠出来，用**假的 `h()`** 执行，看它产出什么文本：

| seq | id | 渲染结果 |
| --- | --- | --- |
| 1 | `QSX45D` | `1 # QSX45D` ✓ |
| 2 | `aB3xK9` | `2 # aB3xK9` ✓ |
| 12 | `12MByl` | `12 # 12MByl` ✓ |
| 3 | `12`（数字）| `3 # 12` ✓ |

### seq 缺失

| seq | 结果 |
| --- | --- |
| 0 / undefined / null / NaN / -1 | `# QSX45D`（不出现序号）✓ |

### 三个页签各从 1 开始

```
reviewed    1 # QSX45D  |  2 # 12MByl  |  3 # Vrfpg7
unreviewed  1 # aaa111
todo        1 # bbb222  |  2 # ccc333
```

### id 唯一依据

6 条断言全部通过（key / 事件 / 拖拽 / 复制 / 批量），且确认没有 `item.id =` 赋值。

## 六、一个测试方法上的教训

写「提取表达式来执行」的截取器时，**朴素的括号配平会失败**：

```js
const seg = src.slice(at, matchBrace(src, at))   // ✗
```

因为 `Number.isFinite(seq)` 的 `)` 一闭合就 return 了，
只截到 `Number.isFinite(seq)`，执行结果是空串。

正确做法是按**三元表达式**的结构截：先找顶层 `?`，
再从 `?` 配平到顶层 `:`，最后配平到分支 B 结束。

> 这类"自己写的切片器"必须先打印出截取结果看一眼，再相信它的判断。

## 七、部署

- `src/client/*.js` + `src/styles/*.css` 都变了
- 需要 `node build.mjs`（已跑）+ **`Ctrl+F5`**

产物：9 片段 / 302181 字节；CSS 532 → 534 条规则。

## 八、遗留

`seq` 目前传给了顶层 `Item`，**子任务行（`KidsList`）没有序号**。
子任务已经用 `child.code`（形如 `PddZRy-A`）标身份，
是否也要加「1/2/3」的位置序号，留给后续判断。
