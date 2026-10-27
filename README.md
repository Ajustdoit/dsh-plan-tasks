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
2. 第一次打开会提示**初始化**，它会往项目根写入：
   ```
   .plan/plan.json                     计划队列
   .dsh/skills/plan-tasks/SKILL.md     执行技能
   ```
   技能正文编译在宿主 `lib/index.js` 的 `skillMarkdown(cwd)` 里，所以 **tgz 包里没有 `.dsh/` 是正常的** —— 技能是在目标项目里运行时生成的；没点过初始化，项目里就没有这个技能。
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

### 三种任务类型

| 类型 | AI 要做什么 |
| --- | --- |
| `仅回答` | 只回答问题，**不改任何文件** |
| `目标` | 以计划为目标推进，可能需要多步工具调用，不做额外改动 |
| `修改` | 直接动手改代码 / 文件 |

## plan-tasks 技能

初始化后 `.dsh/skills/plan-tasks/SKILL.md` 会被写入项目，触发词是「开始干活」「继续干活」「执行计划」「下一条计划」。

它的执行纪律刻意写得很死，因为踩过坑：

- **一轮只做一条**：不要先预读几条再一起开工（历史事故：模型预读 3 条后一次改了 3 个文件，界面上只看到 1 条变成「进行中」）。
- **先改状态再干活**：动任何代码之前先把 `startedAt` 写进文件，界面才会显示「执行中」。
- **做完立刻回填**：写 `note`、`execute: true`、`time`，写回成功这条才算结束。
- **回填后重新读盘**：不复用内存里的旧数组，文件可能已被侧边栏或人工改动。
- 失败就记 `note` 并保持 `execute: false`，跳过继续做后面的。

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

网页上看就是「装了没反应」。范围是 `^0.2.1-rc.3`（允许 `0.2.x`，`0.3.0` 起视为不兼容）。对一下 `dsh --version`，再把启动终端里的 stderr 翻出来。

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

先 `Ctrl+F5` 硬刷新；改动涉及宿主 `lib/index.js` 时必须重启 `dsh web`（client bundle 会热更，host 路由不会）。

### 换机器 / 发给同事

不要用 `link:` 分发（绑死本机绝对路径）。`npm pack` 出 tgz 给对方，且**版本号要对得上**——装旧版本 tgz 会缺新功能。升级时先 `remove` 再 `add`，避免旧包残留。

## 兼容性

```json
"engines": { "node": ">=20", "dsh": "^0.2.1-rc.3" }
```

`engines.dsh` 由兼容性门禁校验；版本落在范围外时插件被跳过并打一条 warning，不会让整个 harness 起不来。

## 目录结构

```
dsh-plan-tasks/
├── package.json            # dsh.bundle.patch + dsh.client 声明
├── cordis.patch.yml        # 往 profile 里插一行 plan-tasks
├── icon.svg                # 页签图标
├── lib/
│   ├── index.js            # 宿主半边：读写 plan.json、初始化、注册 /plan-tasks/api/*
│   └── client.js           # 客户端：侧边栏页签 UI、状态机、动画、样式
└── README.md
```

## 致谢

- 页签容器与注册 API 来自 [`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar)。
- 在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的插件体系上开发。
