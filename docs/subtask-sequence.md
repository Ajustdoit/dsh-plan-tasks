# 子任务行显示「父序号 + 父 id + 后缀」（id=fzTvER-C）

## 一、需求

父条目展开后的子任务行显示成：

```
1 # QSX45D -A
```

- 序号**与父条目相同**（子任务不各自从 1 开始）
- 后面拼现有的子任务字母后缀（`A` / `B` / `AA`）
- 父 id 一字不改

## 二、为什么序号要跟父一样

子任务是**这一批的组成部分**，不是独立排位。

若各自从 1 编号，展开一组后会看到：

```
1 # QSX45D        ← 父
  1 # QSX45D-A    ← 子任务也说自己 1 号
  2 # QSX45D-B
  3 # QSX45D-C
```

两套编号在同一屏里打架，用户没法用「3 号」指代任何东西。

改成共用父序号后：

```
1 # QSX45D
  1 # QSX45D -A
  1 # QSX45D -B
  1 # QSX45D -C
```

「1 号任务，第 A 条」—— 位置与身份各自清楚。

## 三、实现

### 1. 父序号透传（`50-item.js`）

父组件把 `seq` 与 `item.id` 传给 `KidsList`：

```js
h(KidsList, {
  kids, groupKey, delivered,
  parentSeq: seq,      // 父的序号（渲染时传进来的）
  parentId: item.id,   // 父 id
})
```

**没有改 `children.js`。** 任务里说「必要时在折叠结果里把父序号一并带出」——
实际检查后发现不必要：父序号是**渲染期概念**，`foldSplit` 做的是数据折叠，
两者不在同一层。父组件本来就有 `seq` 和 `item.id`，直接往下传即可，
不需要客户端二次推算，也不需要让宿主数据层知道序号。

### 2. 后缀拆分

子 id 形如 `QSX45D-A`（父 6 位 + `-` + 后缀）。拆出后缀：

```js
const suffix = (() => {
  const at = codeText.indexOf('-')
  if (at <= 0 || at === codeText.length - 1) return ''
  const head = codeText.slice(0, at)
  // 前半段必须就是父 id，否则说明这条不是这一批的孩子
  if (parentIdText !== '' && head !== parentIdText) return ''
  return codeText.slice(at + 1)
})()
```

**为什么只用第一个 `-` 切**：后缀可能是 `A` / `Z` / `AA` / `AB`
（`ids.js` 的 `childSuffix`：0→A、25→Z、26→AA），
只取一个字母会把 `AA` 截成 `A`。

**为什么校验父段**：数据异常时（子任务挂在错误的父下），
硬拼会把别的节点的后缀挂到这一行上。不匹配就退回原格式。

### 3. 渲染

```js
Number.isFinite(parentSeq) && parentSeq > 0
  ? h('span', { className: 'plt-kid-id' },
      h('span', { className: 'plt-seq' }, String(parentSeq)),
      ' ',
      h('span', { className: 'plt-id-hash' }, '#'),
      ' ',
      parentIdText !== '' ? parentIdText : codeText,
      suffix !== '' ? h('span', { className: 'plt-kid-suffix' }, ` -${suffix}`) : null,
    )
  : `#${codeText}`
```

### 4. 样式

```css
.plt-root .plt-kid-suffix{opacity:1;font-weight:600}
.plt-root .plt-kid-id{opacity:.92}
```

后缀是这批内唯一的区分位，比父 id 稍亮一档 —— 扫一列时先认出「第几条子任务」。

## 四、三条退化路径

格式可以退化，**身份不能丢**：

| 情况 | 结果 |
| --- | --- |
| `parentSeq` 为 0 / NaN / undefined | 退回 `#QSX45D-A`（原格式）|
| 后缀拆不出来 | 显示 `1 # QSX45D`（不带 ` -`，不留空尾巴）|
| 父 id 与子前缀不匹配 | 后缀视为空，退回上一条 |

## 五、验证（26 条）

用**假 `h()`** 真实执行渲染表达式，不是 grep。

### 后缀拆分

| 子 id | 父 id | 后缀 |
| --- | --- | --- |
| `QSX45D-A` | `QSX45D` | `A` ✓ |
| `QSX45D-Z` | `QSX45D` | `Z` ✓ |
| `QSX45D-AA` | `QSX45D` | `AA` ✓（**不是 A**）|
| `QSX45D-AB` | `QSX45D` | `AB` ✓ |
| `OTHER1-A` | `QSX45D` | `''`（父段不匹配）✓ |

### 渲染结果

| seq | 子 id | 渲染 |
| --- | --- | --- |
| 1 | `QSX45D-A` | `1 # QSX45D -A` ✓ |
| 2 | `QSX45D-B` | `2 # QSX45D -B` ✓ |
| 1 | `QSX45D-AA` | `1 # QSX45D -AA` ✓ |
| 12 | `12MByl-C` | `12 # 12MByl -C` ✓ |

### 核心要求：子任务不各自从 1 开始

父 seq=2，三个子任务：

```
2 # QSX45D -A
2 # QSX45D -B
2 # QSX45D -C
```

**三条序号都是 2**，不是 1/2/3。✓

## 六、宽度检查

胶囊内容从 9 字符变成 13~14 字符：

| 格式 | 估算宽度（10px 字号，窄容器）|
| --- | --- |
| 旧 `#QSX45D-A` | ~64px |
| 新 `1 # QSX45D -A` | ~78px |
| 新 `1 # QSX45D -AA` | ~84px |

窄容器 320px 里，标题仍剩约 208px —— 够显示 3~4 个字加省略号。
`.plt-kid-code` 是 `flex:0 0 auto` + `nowrap`，不会把标题挤没。

## 七、部署

- `src/client/50-item.js` + `src/styles/02-content.css` 都变了
- 需要 `node build.mjs`（已跑）+ **`Ctrl+F5`**

产物：9 片段 / 305884 字节；CSS 534 → 536 条规则。

## 八、遗留

- 顶层条目的 `seq` 由 `60-tab.js` 按组算；子任务**共用父的那一个**，
  所以同一批里所有子任务序号相同。如果将来想让子任务内部也有
  「第 1/2/3 条」的位置感，需要另加一个维度（例如 `1.1 / 1.2`），
  那是另一套语义，不在本单范围。
- 拆解批次头部（父行）的 `#id` 仍是 `1 # QSX45D`，
  与子任务行的 `1 # QSX45D -A` 形成「同号 + 后缀」的呼应，这是刻意的。
