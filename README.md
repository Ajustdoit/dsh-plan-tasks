# dsh-plan-tasks

[![license](https://img.shields.io/github/license/Ajustdoit/dsh-plan-tasks)](./LICENSE)
[![version](https://img.shields.io/github/package-json/v/Ajustdoit/dsh-plan-tasks)](./package.json)
[![dsh](https://img.shields.io/badge/dsh-0.2.x-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![requires](https://img.shields.io/badge/requires-dsh--better--sidebar-8b5cf6)](https://github.com/omdsh-dev/DSH-better-sidebar)

> 在 DSH 右侧栏给项目加一个「任务列表」页签：把想做的事写成计划排队，让 AI 按顺序一条条往下做，做完回填结果、你逐条打勾审核。

`dsh-plan-tasks` 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的侧边栏插件，依赖 [`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar)。它把「提需求 → 排队 → 执行 → 审核」这一整套流程收进一个 JSON 文件（项目根目录 `.plan/plan.json`），并且可以纯用鼠标操作，也可以丢给 AI 批量跑。

---

## 它解决什么问题

用 AI 干活时最难受的三件事：

1. **一次只能说一件事**，说多了它就漏、就混、就只做一半；
2. **需求说完就散了**，过两天想不起「上次那个改动到底做没做」；
3. **多步任务没有队列**，你得盯着它一条条催。

这个插件把计划变成**文件里的队列**：写在面板里 → 排队 → AI 自己按顺序取 → 做完写回备注 → 你打勾验收。你随时能关掉页面去干别的，回来进度还在。

## 功能

- **四组状态手风琴**：`草稿` → `待执行` → `待审核` → `已审核`，点标题展开详情（计划全文、模式、任务类型、创建/开始时间、耗时、备注）。
- **就地编辑**：草稿可直接改正文，停手 600ms 自动落盘，标题跟着正文重新生成；编辑区底部可随手切换任务类型。
- **拖拽排序**：在待执行组里拖动调整执行顺序，顺序即 `order` 字段，AI 严格按它取任务。
- **置顶 / 转为草稿 / 转为待执行 / 删除**：单条操作 + 多选批量操作。
- **审核工作流**：执行完进「待审核」，点「审核通过」进「已审核」，最后一条审核完自动折叠。
- **转组动画**：换组时那条会「升华 / 蒸腾」一下，执行中还有缓慢流光，一眼看出进度变化。
- **深浅双主题**：跟随 DSH 主题，不另起一套配色。
- **复制**：一键复制计划正文或 `任务id:N`（粘到别的会话里能直接对上号）。
- **自动刷新**：空闲 5s、执行中 3s，切回页面立刻补一次。
- **一条命令开始干活**：装好后项目里会出现 `plan-tasks` 技能，说一句「开始干活」，AI 就按队列顺序一条条执行。
- **拆解模式**：输入框右侧点亮「拆解」后提交，宿主会现读一份项目快照（目录树 / README / AGENTS.md / 最近提交 / 历史计划标题），调一次模型把这段话拆成 1~8 条（上限 12）子任务。**落在哪一组跟右侧「草稿」开关走**：点亮草稿 → 进草稿组等你过目；没点亮 → 直接进待执行队列排队。同一句话重复提交不会产出重复条目；模型若提到项目里不存在的文件，会在提示条里点出来。

### 拆解模式的取舍

- **默认 1~8 条，硬上限 12**。宁少勿多，硬上限是防止模型把一句话拆成二十条把列表塞爆。
- **落点听用户**：点着「草稿」就进草稿组（想先过目），没点就直接进待执行（想立刻开工）。不管落在哪，条目名都带 `[拆]` 前缀，一眼可辨。
- **验证任务不默认追加**：单点改动不再单独拆一条「联合回归验证」。只有改动跨了多个互相调用的模块时，拆解才会把验证放进最后一条。
- **禁止臆造文件名**：prompt 要求模型提到的路径必须出现在快照的目录树里；落盘前宿主还会再扫一遍，不存在的路径进 `missingPaths` 提示给用户（不阻断写入）。
- **会主动告诉你该砍什么**：模型会在 `cut` 里列出题面中它认为重复、无关或性价比极低的部分。
- 拆解模式与「草稿模式」的关系就是落点：点亮草稿 → 产物进草稿组；不点亮 → 进待执行；与「深入模式」不叠加。
- **原文照抄、默认折叠**：每条拆解产物都存下本次输入框里的原始提示词全文（`sourcePrompt`，首尾空白与缩进一个字符都不动，事后能一字不差复制走）。展开卡片时它默认收起，只显示「原始提示词 · N 字」一行，点开才铺开 —— 原文常常是一大段需求，默认铺开会把卡片撑得比计划本身还长。手工提交的条目没有这段，整节不渲染。

## 安装

> **前置条件**：必须先装 `dsh-better-sidebar`。页签是通过它的 `betterSidebar.registerTab` 注册的，缺它时本插件会正常启动、**不报任何错**，但侧边栏里不会出现「任务列表」。

```bash
# 1. 装依赖（来自 npm）
dsh plugin --profile web add dsh-better-sidebar

# 2. 装本插件（本包暂未发布到 npm，用 tgz 或 git 地址）
dsh plugin --profile web add ./dsh-plan-tasks-1.0.0.tgz
```

装完**重启一次 `dsh web`**：`dsh.client` 的模块表是启动时扫描 Loader 条目生成的，不重启页面拿不到 `plugins/??dsh-plan-tasks/client.js`。

自己打包分发：

```bash
cd dsh-plan-tasks
npm pack          # 生成 dsh-plan-tasks-1.0.0.tgz
```

## 快速开始

1. 重启后打开 DSH 右侧栏，点「任务列表」页签。
2. 第一次打开会提示**初始化**，它只往项目根写一个文件：
   ```
   .plan/plan.json      计划队列
   ```
   执行技能 `plan-tasks` 是插件通过平台技能系统（`ctx.skills.register`，runtime 层）注册的**虚拟技能**，
   正文编译在宿主 `lib/host/skill.js` 的 `skillMarkdown(cwd)` 里：**不落到项目目录、不需要任何「同步技能」操作、
   装了插件就等于装好了技能**。项目里若还留着旧版本写下的 `.dsh/skills/plan-tasks/SKILL.md`，
   插件在读取计划时会自动清掉（只删 frontmatter 里 `name: plan-tasks` 的那份，别人的技能一个字节都不动）——
   否则项目层（rank 100）会压住 runtime 层（rank 250）的虚拟技能。
3. 在底部输入框写下计划，选任务类型，回车提交。
4. 想让它开工时说「开始干活」，或在侧边栏里点行内按钮触发。

## 数据格式

`.plan/plan.json` 是一个数组，数组顺序 = 执行顺序（由 `order` 决定）：

```json
[
  {
    "id": 8,
    "order": 7,
    "name": "侧边栏任务列表",
    "plan": "在右侧栏加一个任务列表页签，读 .plan/plan.json ……",
    "mode": "默认",
    "taskType": "修改",
    "draft": false,
    "execute": false,
    "review": false,
    "time": 0,
    "note": "",
    "createdAt": "2026-10-27T03:21:51.032Z",
    "startedAt": ""
  }
]
```

| 字段 | 含义 |
| --- | --- |
| `id` | 自增编号 |
| `order` | 排序位置，侧边栏拖拽决定，`0` 在最上 |
| `name` | 短名，手风琴标题 |
| `plan` | 计划全文（要执行的提示词 / 需求） |
| `mode` | 提交时选择的模式 |
| `taskType` | `仅回答` / `目标` / `修改` |
| `draft` | 是否草稿（草稿不参与执行队列） |
| `execute` | 是否已执行完 |
| `review` | 人工审核是否通过 |
| `time` | 耗时（毫秒） |
| `note` | 执行结果回填 |
| `createdAt` / `startedAt` | ISO 时间戳 |
| `decomposeKey` | 拆解模式的幂等键：同一次拆解产生的多条共用一个键 |
| `sourcePrompt` | 拆解产物记下的原始提示词全文（原样保存，不裁剪）；手工提交的条目不带这个字段 |

### 三种任务类型

| 类型 | AI 要做什么 |
| --- | --- |
| `仅回答` | 只回答问题，**不改任何文件** |
| `目标` | 以计划为目标推进，可能需要多步工具调用，不做额外改动 |
| `修改` | 直接动手改代码 / 文件 |

## plan-tasks 技能

技能是插件内置的虚拟技能（runtime 层，不落盘），触发词是「开始干活」「继续干活」「执行计划」「下一条计划」。

它的执行纪律刻意写得很短，因为把整份 `plan.json` 反复读进上下文会让后面的任务越来越慢：

- **不要读 `plan.json`**。在项目根执行 `node .plan/q.mjs`。每条命令的输出里带有 `remaining`（还剩几条）和 `next`（下一条要做什么），不要为了计数再读文件。
- **一轮最多完成 3 条**就停下来汇报，再说「继续干活」接着做。同一段会话堆太长，后面每一步都更慢。
- **草稿跳过**。失败的条目标成 `failed`，排到队尾，下一条不会再选中它。
- **先 `start` 再干活**。这一步只改这一条的 `startedAt`，界面才会显示「执行中」。
- 子代理只在文件互不重叠时使用，最多 3 个，而且只有主代理能跑 `q.mjs`。

## 常见问题

### 装完侧边栏里没有「任务列表」

按这个顺序查，基本都在前两条：

**1）`dsh-better-sidebar` 没装上（最常见）**

profile 的 `pnpm-workspace.yaml` 里是 `autoInstallPeers: false`，所以 `peerDependencies` **只会打一条 WARN、不会自动装**：

```
[WARN] Issues with peer dependencies found
```

而插件客户端用软注入接 sidebar（`ctx.inject(['betterSidebar'], ...)`），服务不存在时 Cordis 直接跳过整段回调 —— 插件「加载成功」，页签注册代码一行都不执行，**没有页签、也没有任何报错**。

```bash
dsh plugin --profile web list          # 看有没有 dsh-better-sidebar
dsh plugin --profile web add dsh-better-sidebar
dsh --profile web --dump-config        # 应同时出现 better-sidebar 和 plan-tasks 两行
```

**2）`engines.dsh` 兼容门禁把插件静默禁用了**

`dsh-app-boot` 的 `preflight()` 会按 `engines.dsh` 校验 profile 插件，不满足时直接禁用该行，只在 **stderr** 打一行：

```
dsh: disabling profile plugin "plan-tasks": Plugin ... is incompatible ...
```

网页上看就是「装了没反应」。范围是 `^0.2.1-rc.3 || >=0.3.0-0`（覆盖 `0.2.1-rc.3` 起的所有版本，含 0.3 的预发布）。对一下 `dsh --version`，再把启动终端里的 stderr 翻出来。

**3）宿主半边没加载**

```bash
curl -X POST http://127.0.0.1:8848/plan-tasks/api/read \
  -H 'content-type: application/json' \
  -H 'x-requested-with: XMLHttpRequest' \
  -d '{"cwd":"<项目绝对路径>"}'
```

- 404 → 宿主半边没加载（`dsh.profile.bundles` 里没有它，或没重启）
- 403 → 缺 `x-requested-with: XMLHttpRequest`（这是防护，不是 bug）
- 200 → 宿主正常，问题在页签注册（回去查 better-sidebar）

### `GET /plugins/dsh-plan-tasks/client.js` 单独取是 404

正常现象。这个资源只能通过 `/plugins/??a,b,c&rev=...` 批量导入，不能单取。

### 更新了插件但界面没变

先 `Ctrl+F5` 硬刷新；改动涉及宿主（`lib/index.js` 或 `lib/host/` 下任一模块）时必须重启 `dsh web`（client bundle 会热更，host 路由不会）。面板右上角的「重启」按钮会先回包再拉起启动器，重启完页面自动刷新。

### 换机器 / 发给同事

不要用 `link:` 分发（绑死本机绝对路径）。`npm pack` 出 tgz 给对方，且**版本号要对得上**——装旧版本 tgz 会缺新功能。升级时先 `remove` 再 `add`，避免旧包残留。

## 兼容性

```json
"engines": { "node": ">=20", "dsh": "^0.2.1-rc.3 || >=0.3.0-0" }
```

`engines.dsh` 由兼容性门禁校验；版本落在范围外时插件被跳过并打一条 warning，不会让整个 harness 起不来。

范围里显式保留了 `>=0.3.0-0` 分支：本插件的对外接口面很窄（宿主侧只用 `node:fs`/`node:path` 和 webserver 路由注册，客户端只经 `ctx.slots` 与 `betterSidebar` 注册页签），没有理由假定 0.3 会破坏它。若不给这个分支，harness 一升到 0.3，所有用户都会遇到「装了没反应」式的静默禁用。

写成 `0.3.0-0` 而不是 `0.3.0` 是因为 node-semver 的规则：只有当范围内*某个*比较符与被测版本的 `major.minor.patch` 元组完全一致、且自身带预发布标签时，预发布版本才会被放行。写成 `>=0.3.0` 会连 `0.3.0-rc.1` 一起挡掉，用户得手工绕过 `ERESOLVE`。

实测该范围的判定（`semver.satisfies`）：

| 版本 | 结果 | | 版本 | 结果 |
| --- | --- | --- | --- | --- |
| `0.2.1-rc.2` | ❌ | | `0.3.0-rc.1` | ✅ |
| `0.2.1-rc.3` | ✅ | | `0.3.0` | ✅ |
| `0.2.1-rc.4` | ✅ | | `0.4.2` | ✅ |
| `0.2.5` | ✅ | | `1.0.0` | ✅ |

## 目录结构

```
dsh-plan-tasks/
├── package.json            # dsh.bundle.patch + dsh.client 声明
├── cordis.patch.yml        # 往 profile 里插一行 plan-tasks
├── icon.svg                # 页签图标（矢量，用于 UI）
├── build.mjs               # 客户端拼接脚本（node build.mjs）
├── assets/
│   └── icon-180.png        # 市场卡片位图（插件市场只收 GitHub 托管的 png/jpg/webp）
├── scripts/                # 零依赖自检脚本（都被 npm test 串起来）
│   ├── check-imports.mjs   #   宿主模块依赖图：无环、无缺后缀、无裸模块
│   ├── unused-imports.mjs  #   import 进来却没用的名字
│   ├── unused-decls.mjs    #   声明了却没人引用的顶层函数/常量
│   ├── dead-css.mjs        #   样式里定义了、JS 从没挂上去的 .plt-* 类
│   └── dead-code.mjs       #   客户端未调用函数 + 宿主未被 import 的导出
├── lib/
│   ├── index.js            # 宿主入口：只做装配（35 行）
│   ├── host/               # 宿主各模块
│   │   ├── constants.js    #   目录名、字段白名单、拆解数量上下限
│   │   ├── paths.js        #   项目根定位、.plan 路径、越界判断
│   │   ├── values.js       #   脏数据容错取值：str / pick / isRunning
│   │   ├── item.js         #   条目组装
│   │   ├── store.js        #   条目规范化、短名生成、lite 投影、plan.json 读写
│   │   ├── skill.js        #   虚拟技能注册 + 旧版技能副本清理
│   │   ├── snapshot.js     #   项目快照（目录树 / README / 提交 / 历史标题）
│   │   ├── decompose.js    #   拆解模式：prompt、解析、臆造路径检查
│   │   ├── restart.js      #   重启：先回包再拉起启动器
│   │   ├── api.js          #   /plan-tasks/api/* 各方法的实现
│   │   ├── router.js       #   请求分发、鉴权头校验、错误包装
│   │   └── http.js         #   JSON 请求体读取与响应写出
│   └── client.js           # 客户端产物（由 build.mjs 生成，勿手改）
├── src/client/             # 客户端源码：同一函数作用域的片段，按文件名拼接
│   ├── 00-loader-head.js   #   模块头、常量、图标底色
│   ├── 10-icons.js         #   内联 SVG 图标组件
│   ├── 15-css-decl.js      #   CSS_PARTS 声明
│   ├── 20-css/             #   样式分组（组内按文件名字典序，即层叠顺序）
│   │   ├── 10-topbar.js    #     顶栏与通用按钮
│   │   ├── 11-overlay.js   #     遮罩与行内提示
│   │   ├── 12-composer.js  #     输入区骨架
│   │   ├── 13-item.js      #     条目卡片
│   │   ├── 14-groups.js    #     分组配色与组头
│   │   ├── 15-detail.js    #     详情区
│   │   ├── 16-bulk.js      #     批量操作条
│   │   ├── 17-input.js     #     输入框
│   │   ├── 18-chips.js     #     模式胶囊与底栏
│   │   └── 30-light.js     #     浅色主题覆盖（必须最后）
│   ├── 25-css-join.js      #   CSS 文本拼合
│   ├── 30-runtime.js       #   API 调用、浏览器侧发提示词、复制
│   ├── 50-item.js          #   Item 卡片组件
│   ├── 60-tab.js           #   PlanTasksTab：状态、分组、手风琴
│   └── 70-apply.js         #   apply：注入样式、注册页签
├── LICENSE
└── README.md
```

改客户端逻辑或样式：改 `src/client/` 下的片段，然后 `node build.mjs`（或 `npm run build`）。
`npm test` 会校验 `lib/client.js` 与 `src/client/` 是否同步，避免提交半成品。

## 致谢

- 页签容器与注册 API 来自 [`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar)。
- 在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的插件体系上开发。
