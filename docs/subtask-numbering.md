# 子任务编号（2-A / 2-B）的现状核查

> 任务 5-A 的调研记录，作为 5-B/5-C/5-D 的改动依据。
> 所有位置都写成 `文件:行号`，行号是写本文时的快照；引用的代码片段以仓库真实内容为准。
> 5-B 已落地：宿主在读投影里补了 `code` 字段（见文末「5-B 落地」），本文的调研结论不变。

## 一句话结论

**每条子任务对象上已经带了编号字段 `id`，形如 `12-A`，不需要再推导。**

- 数据侧：子任务 `id` 由宿主统一分配成 `"<父id>-<后缀>"`，父 id 是正整数，后缀是 `A..Z, AA..`；
- 渲染侧：**顶层条目**在标题左侧画 `#12`（`50-item.js:288`），**子任务行完全不画编号**
  —— 那个 `#id` 节点在 id=322 被删掉了，只剩 `data-id` 属性；
- 因此 5-B 的「让子任务行显示 2-A」是**纯渲染改动**：拿 `child.id` 直接画即可，
  不需要新的数据字段，也不需要「组序号 + 组内序号」的推导。

## 一、数据侧：编号字段确实存在

### 1.1 规则定义

- `lib/host/ids.js:19` `childSuffix(index)` —— 0→A、25→Z、26→AA（Excel 列名算法）；
- `lib/host/ids.js:41` `childIdOf(parentId, index)` —— 返回 `` `${parentId}-${childSuffix(index)}` ``；
- `lib/host/ids.js:46` `isChildId(id)` —— 正则 `/^\d+-[A-Z]+$/`，判断是不是子任务编号；
- `lib/host/ids.js:51` `parentIdOfChild(id)` —— 反解出一级 id；
- `lib/host/ids.js:59` `idKey(id)` —— 统一比较用（数字与字符串一视同仁）。

文件头注释（`ids.js:1-17`）已经把三个约定写死了：一级仍是正整数、子任务是字符串、
比较一律走 `idKey()`。

### 1.2 编号在哪些地方被**写入**

| 位置 | 场景 |
| --- | --- |
| `lib/host/children.js:101` + `:126` | 读盘时把平铺的老拆解批次**折叠**成父 + children，父 id 取 `nextId`（现有最大 id + 1），children 用 `childIdOf(nextId, index)` |
| `lib/host/decompose-batch.js:70` | 新拆解批次落盘，`id: childIdOf(parentId, index)` |
| `lib/host/store.js:119` | `normalizeNode` 读盘兜底：children 若是老式全局数字 id，读出来就补成 `childIdOf(base.id, i)` |
| `lib/host/renumber.js:100` | 旧数据一次性归一（`idsVersion=2`）时重排成 `父id-A/B/C` |

四处都走同一个 `childIdOf`，所以**盘上的子任务编号形状是唯一的**。

### 1.3 编号在哪些地方被**读出 / 校验**

| 位置 | 用途 |
| --- | --- |
| `lib/host/renumber.js:26` `nodeMatches` | 校验 children 是否严格等于 `childIdOf(id, index)`（形状 + 顺序） |
| `lib/host/renumber.js:38` `hasDefects` | 正则 `^<own>-[A-Z]+$`（`:51` 处组装）检查每个 child id，重复也算缺陷 |
| `lib/host/renumber.js:113` `startIdAfter` | 从归档里算安全起始号，`parentIdOfChild` 也参与 |
| `lib/host/queue-cli.js:100` `idNumber` / `:106` `suffixNumber` | 队列排序：一级按 id 数字，同组 children 按后缀 A<B<AA |
| `lib/host/api.js:17` 起（多处） | `idKey()` 比较，避免 `Number("2-A")` → NaN |

### 1.4 数据下发到面板时的形状

- `lib/host/store.js:154` `toLiteItem` —— 列表轮询的投影，**`id` 原样保留**；
  `:169` 对 children 递归走同一个投影，所以子任务的 `id` 在 lite 列表里也是完整的。
- `lib/host/api.js:426` `detail` 路由 —— 返回 `children: hasChildren(target) ? target.children : null`，
  展开批次时拿到的是**全量** children（含 `id`）。
- 结论：`50-item.js` 里 `KidsList` 的 `child.id` 一定可用，两种数据来源（lite / detail）都有。

## 二、渲染侧：编号现在画在哪、没画在哪

### 2.1 顶层条目（四个组都走这条路）

`src/client/50-item.js:288`

```js
h('span', { className: 'plt-id' }, `#${item.id}`),
```

- 位置：`plt-head` 里、`.plt-caret` 之后、`.plt-name` 之前；
- 样式：`src/client/20-css/15-detail.js:8` `.plt-id`（`flex:0 0 auto`，窄标签，给标题让宽度）；
  hover 提亮在 `20-css/13-item.js:39`；浅色态在 `20-css/30-light.js:208`。
- 一级条目显示 `#12`；**如果这条本身是没折叠的拆解产物**，显示的就是 `#12`（见 2.3 的反例）。

### 2.2 子任务行（`KidsList`）—— 编号节点已被删除

`src/client/50-item.js:30` 的子任务行只有这些节点：

- 对勾 `.plt-kid-check`（`:37-39`，未做的行用 `.is-off` 占位，保证标题起点对齐）；
- 标题 `.plt-kid-name`（`:41`）；
- 耗时 `.plt-dur`（`:45`，仅在待审核/已审核组）；
- 类型图标 `.plt-tag.type`（`:48`）；
- 执行中转圈（`:54`）；
- 「通过」按钮 `.plt-copy-btn.plt-kid-pass`（`:59`，仅待审核组且未审）。

**没有 `.plt-id` 节点。** 依据是 `20-css/19-kids.js:41-43` 的注释：

> id=322：children 行不再显示 `#id`，这两条规则（`.plt-kid-h .plt-id` / `.plt-kid-done .plt-id`）
> 一起删掉 …… 删掉后标题左侧的缩进不变：对勾仍是 12px + 6px gap，只是不再有编号列。

行上仍保留身份：`50-item.js:30` 的 `'data-id': String(child.id)`（批量请求与验证脚本靠它定位）。

### 2.3 会破坏「2-A 一定存在」的两个边界（5-B 必须处理）

1. **只拆出一条时不折叠。** `lib/host/children.js:95` `if (group.length < 2) { out.push(item); continue }`
   —— 单条拆解产物留在顶层，`id` 是普通整数（如 `7`），不是 `7-A`，也没有 children。
   这类条目走的是 2.1 的顶层渲染，显示 `#7`。
2. **拆解失败 / 手工新建的条目**没有 `decomposeKey`，更不会有子任务 id。

> 推论：编号要「按父子关系展示」时，判据应该是**这条有没有 children**（`isParent`），
> 而不是「id 里有没有 `-`」。反过来，子任务行拿到的 `child.id` 一定是 `x-A` 形状。

## 三、可推导性核查（题面问的第二件事）

**不需要推导，但如果将来某处拿不到 `child.id`，有两种可用的等价来源：**

| 来源 | 位置 | 说明 |
| --- | --- | --- |
| 父 id + 组内下标 | `childIdOf(parent.id, index)`（逻辑在 `lib/host/ids.js:41`） | 与宿主写入时完全同一套算法；但**客户端目前没有这个函数**（见 3.1） |
| 后缀反解 | `suffixNumber(id)` 思路（`lib/host/queue-cli.js:106`） | A→0、AA→26，可从 `child.id` 取回组内序号 |

### 3.1 客户端没有 id 解析工具（关键事实）

`src/client/` 全目录 **没有** `childSuffix` / `childIdOf` / `isChildId` / `parentIdOfChild` 的任何副本
（grep 零命中）。`30-runtime.js` 只导出 `fmtTime` / `fmtDur` / `fmtDate` / `statusOf` / `typePrefix` 等格式化函数。

所以若 5-C/5-D 需要「父 id」或「组内序号」，有两条路：

- **推荐**：直接用 `child.id` 字符串（已经就是 `2-A`），一个字都不用算；
- 若要单独展示「A/B/C」或做「第 2/3 条」这类文案，需要在 `30-runtime.js` 补一个小函数
  （切 `-` 取两段），**不要**在 `50-item.js` 里就地 split —— 否则同一个规则会有两份实现。

## 四、改动落点清单（供 5-B/5-C/5-D 直接照做）

### 4.1 渲染点

| 文件:行 | 现状 | 备注 |
| --- | --- | --- |
| `src/client/50-item.js:288` | 顶层 `#${item.id}` | 已成，无需改；确认子任务不会走到这里 |
| `src/client/50-item.js:30-46` | 子任务行的节点序列 | **5-B 的主落点**：在对勾之后、标题之前插编号节点 |
| `src/client/20-css/19-kids.js:44` | `.plt-kid-name` 的样式 | 加编号后标题左移，需同步 `.plt-kid-name` 的起点或给编号固定宽度 |
| `src/client/20-css/19-kids.js:41-43` | 说明「不再显示 #id」的注释 | 改动后要**改掉这段注释**，否则与代码矛盾 |
| `src/client/20-css/30-light.js:227` | `.plt-kid-h .plt-id{color:#5f6672}` | **孤儿规则**：`.plt-id` 在子任务行已经没有宿主。加回编号节点后它会立刻生效（深色主题缺对应规则，需补对称的一条） |
| `src/client/50-item.js:37-39` | 对勾槽位（未做行 `visibility:hidden` 占位） | 新编号列同理：**所有行都要占位**，否则有/无编号的行标题起点会差一截 |

### 4.2 数据点

| 文件:行 | 现状 | 是否需要改 |
| --- | --- | --- |
| `lib/host/ids.js:41` `childIdOf` | 唯一分配算法 | 不改 |
| `lib/host/children.js:126` / `decompose-batch.js:70` / `store.js:119` / `renumber.js:100` | 四处写入 | 不改（已统一） |
| `lib/host/store.js:154` `toLiteItem` | `id` 透传、children 递归 | 不改 |
| `lib/host/api.js:426` `detail` | 返回全量 children | 不改 |
| `lib/host/children.js:95` | 单条批次不折叠 | **决策点**：若不折叠，这类条目永远没有 `x-A` |

> 结论：**数据层不需要新增字段**。若要「组序号 + 组内序号」的展示，全部可从现有 `id` 得出。

## 五、不能碰的东西（回归风险）

1. **`id` 是身份，不是展示。** 命令行按它记账（`lib/host/queue-cli.js:260` 注释）、
   `api.js` 的 update / remove / detail 都按它找条目。改编号格式会打断模型侧的记账链路。
2. **`reorder` 只认顶层数字 id**：`lib/host/api.js:679` `ids.map(Number).filter(...)`
   —— 子任务的 `"2-A"` 会被 `Number()` 成 NaN 过滤掉。所以子任务行不能参与拖拽，
   组内顺序由后缀固定（`queue-cli.js:106` 的 `suffixNumber` 比较）。
3. **`hasDefects` 的正则是形状硬约束**：`renumber.js:38`（正则组装在 `:51`）的 `^<own>-[A-Z]+$`。
   若把编号改成 `2-A.` 或加空格，下一次读盘就会被判定为缺陷并重排。
4. **lite 投影会抹掉长字段**，但 `id` 不在其中；不要为「显示编号」额外加一个字段到 lite 里。

## 六、给下一条的可执行建议（不含实现）

1. 子任务行加编号：在 `50-item.js` 的 `KidsList` 里，用 `child.id` 渲染
   （直接显示 `2-A` 或 `#2-A`，与顶层 `#12` 的风格统一），样式复用 `.plt-id`，
   宽度按最长可能（`12-AA`）留固定值，避免行与行之间标题起点抖动。
2. 若还要显示「这一组共 N 条 / 第 i 条」：`kids.length` 已有，序号用 `child.id` 的后缀或数组下标均可，
   但**只在一处实现**（建议 `30-runtime.js` 加 `kidSuffixOf(id)`）。
3. 收尾时同步三处文字：`19-kids.js:41` 的注释、`30-light.js:227` 的孤儿规则、
   以及 `.plt-kid-name` 的左边距。

## 七、5-B 落地（数据侧已就位）

调研的结论是「不需要新增字段」，**落地时也确实没有新增持久化字段** —— 只加了一个
**读投影里的派生字段**：

| 位置 | 改动 |
| --- | --- |
| `lib/host/ids.js` `codeOf(id)` | 新增：把 id 归一成可展示文本。`12`→`"12"`、`"12-A"`→`"12-A"`、其余→`""`（不猜，交给调用方回退） |
| `lib/host/store.js:166` `toLiteItem` | 新增 `code: codeOf(item.id)`；children 递归走同一个投影，所以子任务也带 |
| `lib/host/api.js` `detail` | children 也逐条补 `code` —— 展开批次时 `KidsList` 优先用这份全量数据，不带就会「列表里有编号、展开后没了」 |

三个刻意的取舍：

1. **不写进 plan.json。** `id` 是唯一真值，`code` 只是它的文本形式。存盘会得到两份真值，
   而 `renumber.js` 改 id 之后 code 不跟着改就漂了。读的时候派生 → 永远同源。
2. **不加进 `normalizeItem` 白名单。** 那会把它变成持久字段，第 1 条就破了。
3. **放在 lite 投影里。** 面板的列表轮询只吃 `toLiteItem`（`api.js:343`），
   这是渲染真正会读到的那份数据；`detail` 路由原本返回原始 children，
   现在也在那一层逐条补 `code`，两条数据来源口径一致。

实测（两个临时脚本，均已删除）：

```
父 code = "2"
子 code 列表 = ["2-A","2-B","2-C","2-AA"]
普通条目 code = "7"
非法 id 的 code = ""
children 顺序未变 = true

detail.children code = ["2-A","2-B"]      ← 展开详情这条链路也带
lite 父 code = "1" / 子 = ["1-A","1-B"]   ← 走真读盘 + 归一后的实际值
plan.json 里没有 code 字段 = true         ← 确认没被持久化
```

**分组顺序没有被动过**：`toLiteItem` 只做字段投影，不改数组顺序；
`foldSplit` / `byOrder` / `order` 全部未触碰。

下一步（5-C/5-D）直接用 `item.code` / `child.code` 渲染即可，不需要前端再解析 id。

## 八、5-C 落地（渲染侧已就位）

子任务行头部新增编号胶囊，节点在 `src/client/50-item.js` 的 `KidsList` 里
（对勾之后、`.plt-kid-name` 之前）：

```js
const codeText = String(child.code ?? '')
...
codeText !== ''
  ? h('span', { className: 'plt-kid-code', 'data-tip': `编号 ${codeText}` }, codeText)
  : null
```

三个要点：

1. **所有状态都画。** 这一层没有 `groupKey` / `status.key` 条件 —— 编号是身份不是状态，
   待执行、待审核、已审核、执行中、失败、已中断全都渲染同一个节点。
   （对照：行内「通过」按钮只给待审核，耗时只给待审核/已审核。）
2. **空值不渲染，也不留槽。** `codeText === ''` 时返回 `null`，DOM 里没有元素，
   flex 里也不占宽度 —— 题面明确要求「不留占位空隙」，所以这里刻意**不用**
   对勾那种 `visibility:hidden` 占位法（那是为了行间对齐，编号列没有这个需求：
   没有编号的条目本来就不在一批里）。
3. **不拼 `#`。** 顶层条目是 `#12` 的裸文本，子任务是 `2-A` 的胶囊。
   两种记号并存是刻意的：`#` 表示「顶层序号」，`2-A` 本身就是完整的层级读法。

样式（`src/client/20-css/19-kids.js`）：

| 规则 | 说明 |
| --- | --- |
| `.plt-kid-code` | `flex:0 0 auto`（不参与标题伸缩）+ `tabular-nums`（同批数字列对齐）；accent 半透明胶囊 |
| `.plt-kid-done .plt-kid-code` | 已做行跟着整卡沉下去，但**不隐藏** —— 回看历史更需要编号定位 |
| `@container (max-width:320px)` | 窄侧栏字号 -1px、内距 -1px：它恒占宽度，标题被压短时先让它 |

浅色态（`src/client/20-css/30-light.js`）：文字 `#17559c`、已完成 `#5f6672`，
底色/描边把 accent 的 alpha 提上去但不换色相。

**顺手清掉了 5-A 记的那个孤儿规则**：原来的
`body:not([data-ds-dark-theme]) .plt-kid-h .plt-id{color:#5f6672}` 已删除 ——
新节点叫 `.plt-kid-code`，不复用 `.plt-id`（那套是顶层裸文本的字号/透明度，
套到胶囊上会打架）。深色/浅色因此是对称的两条，不再有「只有浅色有条规则」的隐患。

**注释同步**：`19-kids.js` 里 id=322 那段「children 行不再显示 #id」已改写为
「id=361 把它加回来了一半」，`50-item.js` 同一处注释同理。留着旧注释比没有注释更糟。

纯客户端改动，`Ctrl+F5` 即生效，不需要重启宿主。

## 九、5-D 落地（对齐与收缩）

这一条只动样式，**没有新增节点**，但改了两处容易踩的排版细节。

### 9.1 基线对齐：`center` → `baseline`，非文字子项单独钉回 `center`

`.plt-kid-h` 原来是 `align-items:center`。编号胶囊是 11px / 16px 行高，标题是
13px，两者字号行高都不同，居中对齐会让字脚差 1~2px，一列扫下来编号像浮在标题左边。
改成 `baseline` 后 `2-A` 与标题首字踩在同一条线上。

但基线对齐只对**文字**成立，对勾方框、类型图标胶囊、「通过」按钮、裸 svg（转圈）
参与基线会被按「最后一行文字的基线」摆位置，整体上浮。所以补了一条：

```css
.plt-kid-h > .plt-kid-check,.plt-kid-h > .plt-tag,
.plt-kid-h > .plt-copy-btn,.plt-kid-h > svg{align-self:center}
```

顺带显式写了 `flex-wrap:nowrap`（flex 的默认值）—— 这一行的规矩是
「标题可以让位，标签不许掉行」，写出来是防止后来的人改成 `wrap`。

### 9.2 省略号必须挪到内层（否则基线会被破坏）

这一条是实现时发现的坑：**带 `overflow:hidden` 的 flex 项没有文字基线**，
会退化成「按底边对齐」。原来 `.plt-kid-name` 自己带
`overflow:hidden;text-overflow:ellipsis`，一旦外层改成 `baseline`，
编号胶囊就会被拉到标题的底边 —— 正好是题面要避免的那种错位。

改法是拆两层：

| 层 | 职责 |
| --- | --- |
| `.plt-kid-name`（外层，flex 项） | `flex:1 1 auto; min-width:0`，**不带 overflow** → 保住真基线 |
| `.plt-kid-name-text`（内层 span） | `display:block` + `nowrap` + `overflow:hidden` + `text-overflow:ellipsis` → 负责截断 |

`min-width:0` 两层都要？外层必须有（flex 子项默认 `min-width:auto` = 内容宽度，
不给就缩不进去）；内层是块级元素撑满外层，不需要。

### 9.3 收缩优先级

| 元素 | flex | 行为 |
| --- | --- | --- |
| 对勾 | `0 0 auto` | 固定 12px（未做项 `visibility:hidden` 占位，保对齐） |
| 编号胶囊 | `0 0 auto` + `white-space:nowrap` | **一像素不让**，永远完整可读 |
| 标题 | `1 1 auto` + `min-width:0` | 独自吃掉全部压缩，以省略号收尾 |
| 耗时 / 类型 / 通过 | `0 0 auto` | 不让位 |

结论：窄侧栏里看到的是「`2-A` 完整 + 标题变短」，不会是「标签被压成 `2…`」，
也不会出现标签掉到第二行。窄到 320px 以下时编号自己也收一档（字号 -1px、内距 -1px），
把宽度让回标题。

### 9.4 验证方式与它的边界

本机没有浏览器（playwright / puppeteer / jsdom 都没有），所以做的是**规则自检**：
从构建产物 `lib/client.js` 里解析出层叠后生效的声明块，断言 12 条关键属性成对存在
（基线对齐 × 非文字子项钉回 center、编号不让位 × 标题可压缩、
外层无 overflow × 内层有截断三件套……）。12 项全通过。

这**不能**替代真机肉眼验收：像素级的基线是否真的齐、`2-A` 在极窄容器里是否完整，
仍需在面板里拖窄侧栏看一眼。文档在这里留个记号。
