# 图片附件：粘贴上传 → 随任务发模型 → 三页签显示 → 单击放大

## 一、需求

1. 输入框里可以**粘贴图片**
2. `.plan` 里加 `img` 字段（数组）
3. 发送给模型时带上图片，让它先看图再做事
4. 粘贴的图片在输入框里**可以删除**
5. 待执行 / 待审核 / 已审核都有附件字段
6. 图片可**排序**，**单击放大**

## 二、最关键的决定：存文件，不存 base64

原想法是把 base64 直接写进 `plan.json` 的 `img` 数组。**这个方案会让插件不可用**，
实测数据如下：

| 问题 | 数据 |
| --- | --- |
| 体积 | 压缩后照片 base64 ≈ 400KB；每条 3 张 = 1.2MB；200 条 = **234MB** 的 plan.json |
| 轮询 | `read` **每 5 秒**一次。`lite` 投影只截断 `plan`/`note`/`sourcePrompt` 三个**文本**字段，`img` 数组会**全量下发**。50 条含图 = 20MB/次 ≈ **234MB/分钟** → 浏览器卡死 |
| 写盘 | `writePlan` 每次 `JSON.stringify` 整份数据；带几十 MB base64 时改一个 `order` 都要序列化几十 MB |
| 缓存 | base64 无法被浏览器缓存，每次渲染都要重新解析 |

**改成存文件名**：

```
<项目根>/.plan/images/Ab3xK9-1.png
条目里：  "img": ["Ab3xK9-1.png"]
```

`plan.json` 只多了约 20 字节；实测带一张图的 `plan.json` 仅 **421 字节**。

## 三、DSH 本体的图片能力（不用自己实现协议）

调研确认 DSH 原生支持图片，这是方案成立的前提：

| 包 | 作用 |
| --- | --- |
| `dsh-attachment` | 图片持久化存储，`admitPromptContent()` 把 prompt 里的图片换成持久引用 |
| `dsh-client-file-upload` | 浏览器上传链路 |
| `dsh-api-session-controller` | 定义 prompt 的图片内容块形状 |

`PromptContentPart` 的 image 分支（`dsh-api-session-controller/lib/types/types.d.ts`）：

```ts
{ type: 'image'; mediaType: ImageMediaType; data: string; name?: string }
```

`data` 就是 base64，宿主收到后**自己**提升成持久引用
（注释原文：*the Host promotes image bytes to durable references*）。

所以插件只要把 base64 放进去，不需要碰附件存储服务。

## 四、实现

### 1. 宿主：图片存储（`lib/host/images.js`，新增）

- `saveImage` —— 校验 + 落盘，返回文件名
- `readImage` —— 读取，含**路径穿越**防护
- `removeImage` —— 删除（幂等）
- `normalizeImages` —— 归一化（纯函数）

**三重校验**（缺一不可）：

| 校验 | 挡住的攻击 |
| --- | --- |
| mime 白名单（png/jpeg/webp/gif）| 传 `.exe`、`.svg`（可执行脚本）|
| **文件头魔数**必须与声明一致 | 把任意文件改名成 `.png` |
| 文件名白名单 + 物理路径校验 | `../plan.json` 之类的目录穿越 |

> 只信 mime 是不够的 —— 浏览器给的类型可能错，恶意调用方更能直接伪造。
> 实测：把 `hello world` 的 base64 声称为 `image/png`，被魔数校验拒绝。

### 2. 宿主：两条独立路由（`lib/host/image-route.js`，新增）

```
GET  /plan-tasks/images?name=<文件名>&cwd=<项目根>
POST /plan-tasks/images/upload
```

**为什么不能塞进 `/plan-tasks/api`**：

那条路由只收 `POST`，且 `requestTrusted` 最后一行要求
`x-requested-with: XMLHttpRequest`。而浏览器的 `<img src>` **不会带这个头**，
用它会 403、图片永远显示不出来，看起来还像「上传失败」。

因此 `http.js` 里新增了 `requestTrustedResource()` —— 与 `requestTrusted` 的
唯一差别是不要求那个头。其余检查（loopback Host、同源 Origin、
`sec-fetch-site` 非 cross-site）原样保留，放宽这一个头不削弱防护。

### 3. 宿主：条目字段

- `store.js` 的 `normalizeNode` 加 `img`（**有图才写这个键**，无附件条目保持老形状）
- `migrate.js` 白名单加 `'img'` —— 漏掉会让迁移把附件整批丢掉
- `api.js` 的 `append` 接受 `img`
- `api.js` 新增 `updateImages({ id, add, remove })` —— 增删附件，删除时**同时删磁盘文件**

### 4. 宿主：发给模型

`dispatch` 里读图并拼进 `content`：

```js
const request = { ..., content: [{ type: 'text', text }] }
const attached = await readImagesForPrompt(cwd, step.task?.img)
for (const part of attached) request.content.push(part)
```

- 图片排在**文字之后**：让模型先读到任务说明再看图
- 读不到的文件**静默跳过**：少一张图不该让整条任务发不出去
- 只有真正要发的那一次才读字节并转 base64

### 5. 客户端：粘贴与删除

`textarea` 上监听 `onPaste`，从 `clipboardData.items` 取图片文件：

- **只在真的有图片文件时才 `preventDefault`** —— 否则普通文本粘贴会被打断
- 截图粘贴走 `items`（`files` 可能是空的），两者都兼容
- 上传成功后拿到文件名放进 `pendingImages`

**`pendingImages` 刻意不进 localStorage**：图片已落盘但任务还没提交，
刷新后残留会变成没有任何条目引用的**孤儿文件**。

### 6. 客户端：显示与放大

- 卡片上渲染 `.plt-imgs`，无图时**整块不渲染**（不留空槽）
- 单击图片 → 灯箱（`45-lightbox.js`，新增）
- 灯箱：点遮罩关闭、按 `Esc` 关闭、点图片本身**不关**
- 缩略图点击要 `stopPropagation()` —— 否则会连带触发卡片展开

### 7. 样式

新增 12 条规则（CSS 536 → 555）：
`.plt-attach*`（输入框）、`.plt-imgs` / `.plt-img-thumb`（卡片）、`.plt-lightbox*`（灯箱）。

缩略图统一 `object-fit:cover` 裁成正方形 —— 不同比例的截图排在一起，
行高一致不参差。窄容器（≤320px）再降一档尺寸。

## 五、验证（105 条，全部真实执行）

### 宿主（39 条）

真读写磁盘、真调 API。

| 项 | 结果 |
| --- | --- |
| 保存并落盘 | ✅ 文件名 `Ab3xK9-1.png`，第二张自动递增 |
| 拒绝非白名单 mime | ✅ |
| 拒绝 **mime 与实际不符** | ✅ `声明的类型（image/jpeg）与实际文件（image/png）不一致` |
| 拒绝谎报类型（文本当图片）| ✅ `无法识别的图片格式` |
| **拒绝 5 种路径穿越** | ✅ `../plan.json`、`..\plan.json`、`.plan/plan.json`、`/etc/passwd`、`X1-1.png/../../x.png` |
| 超过 20MB 被拒 | ✅ 提示实际大小 |
| append 带图 → 落盘 | ✅ `img: ["tmp-1.png","tmp-2.png"]` |
| **无图时不写 img 键** | ✅ 保持老形状 |
| updateImages 增 | ✅ |
| 重复添加不重复 | ✅ |
| 删除 + **磁盘文件同时删掉** | ✅ |
| 归一化清掉脏数据 | ✅ 去重、丢穿越、丢非字符串、丢非图片扩展名、限 9 张 |

### 客户端（66 条）

抠出函数真实执行（假 `h()`、假 React 状态）。

| 项 | 结果 |
| --- | --- |
| `imageUrl` 拼装与编码 | ✅ `a&b=c.png` → `a%26b%3Dc.png` |
| 灯箱状态机（开/关/订阅/退订）| ✅ |
| 空关闭不重复通知 | ✅ |
| `renderLightbox` 输出结构 | ✅ 含 img、关闭按钮、`role=dialog` |
| **粘贴只在有图片时拦截** | ✅ |
| 上传类型白名单、计数、错误提示 | ✅ |
| **提交成功后清空待发送图片** | ✅ 失败时保留以便重试 |
| 卡片渲染、`stopPropagation` | ✅ |
| 灯箱渲染在根节点最外层 | ✅ |
| 产物中所有新标识符都有定义 | ✅ |

### 端到端

```
1. 上传 → draft-1.png
2. append → id= GoA7w4 img= ["draft-1.png"]
3. 落盘 → ["draft-1.png"]
4. dispatch 读图 → true image/png 70字节
5. 发给模型的块 → {"type":"image","mediaType":"image/png","data":"iVBORw0..."}
```

## 六、已知限制

1. **子任务没有附件入口** —— 图片只在输入框提交时产生，而子任务由拆解生成。
   父条目的 `KidsList` 是紧凑单行布局，塞缩略图会挤掉标题。
   将来若要给子任务加图，得单独设计那一行的布局。
2. **不支持 SVG** —— SVG 能内嵌脚本，用 `<img>` 显示时风险虽低，
   但白名单收紧更省事。目前只收 PNG / JPG / WebP / GIF。
3. **删除附件不回滚已发送的消息** —— 图片已经作为消息内容发出去，
   删的是「以后还带不带」。DSH 的附件存储是不可变的，这条符合它的语义。
4. **没有孤儿文件清理** —— 用户贴了图但没提交就刷新，`pendingImages` 会清空，
   磁盘上留下一个没人引用的文件。量很小，暂不处理；
   若要清理，可按「不被任何条目引用的文件」扫 `.plan/images/`。

## 七、部署

**宿主改了 6 个文件 + 新增 2 个 → 需重启 `dsh web`**。
客户端产物已重新构建（10 个片段）→ 再 `Ctrl+F5`。

`.plan/images/` 会在第一次上传时自动创建，不需要手动建目录。

---

# 修正：灯箱改为「当前窗口浮窗」（用户反馈）

## 一、反馈

> 点击缩略图看大图时，修改为当前窗口浮窗预览，不跳转到单独的地方。

我原先实现的是灯箱，但定位写成 `position:absolute; inset:0`，
实际观感就是「跑到了旁边一个单独的地方」。

## 二、真正的原因：`container-type` 造成的包含块

第一反应是「改成 `position:fixed` 就好」，但这里有个陷阱。

`.plt-root` 上有：

```css
.plt-root{position:relative;...;container-type:size;...}
```

`container-type:size` 是为了让输入框按面板高度伸缩（`cqh`），必须保留。

但按 **CSS Containment 规范**，建立了 containment 的元素会成为
`position:fixed` 后代的 **containing block（包含块）**。

后果：**写在面板里的 `fixed` 不会相对视口定位，而是相对 `.plt-root`**。

也就是说，只把 `absolute` 改成 `fixed` **解决不了问题** ——
浮层仍然只覆盖侧边栏那一小块。

## 三、解法：把节点挂到 `document.body`

绕开包含块只有一个办法：**让浮层不是 `.plt-root` 的后代**。

客户端片段只能 `require('react')`，**没有 ReactDOM**，所以用不了
`ReactDOM.createPortal`。改用原生 DOM：

```js
function lightboxHost() {
  if (lightboxEl === null || lightboxEl.isConnected !== true) {
    lightboxEl = document.createElement('div')
    lightboxEl.className = 'plt-lightbox-host'
    document.body.appendChild(lightboxEl)
  }
  return lightboxEl
}
```

DOM 结构变成：

```
body
├── …应用本身…
└── div.plt-lightbox-host   ← 我们挂的，width:0 不占布局
    └── div.plt-lightbox    ← position:fixed; inset:0 → 覆盖整个视口
        └── div.plt-lightbox-body
            ├── img.plt-lightbox-img
            └── button.plt-lightbox-close
```

代价是这部分不再声明式，好处是彻底摆脱面板的 containment 与层叠上下文。
**只有一个浮层的场景，这个交换是划算的。**

## 四、配套改动

| 项 | 改动 |
| --- | --- |
| `.plt-lightbox` | `absolute` → **`fixed`**，`z-index` 60 → **80** |
| `.plt-lightbox-body` | `max-width:92%` → **`92vw`**（百分比会跟着侧栏走）|
| `.plt-lightbox-img` | 同上，改 `92vw / 92vh` |
| `.plt-lightbox-host` | **新增**：`position:fixed; width:0; height:0` —— 不占布局 |
| `60-tab.js` | 不再渲染 `renderLightbox`，改为 `attachLightbox(imageUrl)` 登记 |

卸载时清理：`attachLightbox` 返回一个函数，把 body 上的节点移除 ——
面板关掉后浮层不能留着。

## 五、验证（38 条，用 DOM 桩真实执行）

| 项 | 结果 |
| --- | --- |
| **挂载点在 document.body 上** | ✅ |
| 遮罩 `position:fixed` + `inset:0` | ✅ |
| **不再用 `%` 尺寸**（会跟面板走）| ✅ |
| 点图片**不**关闭 | ✅ |
| 点遮罩关闭 | ✅ |
| 点关闭按钮关闭 | ✅ |
| **detach 后挂载点从 body 移除** | ✅ |
| `.plt-root` 仍保留 `container-type:size` | ✅（不能动，输入框靠它）|
| `60-tab.js` 里没有 `renderLightbox` | ✅ |

## 六、留给人的一条经验

> `position:fixed` 不一定相对视口 —— 祖先只要有 `transform`、`filter`、
> `perspective`、`contain`、`container-type` 中的任意一个，
> 它就成为包含块，`fixed` 会退化成相对那个祖先。

这个 bug 之所以难查：**CSS 完全合法，不报错，所有检查都通过**，
只是定位参照系错了。
