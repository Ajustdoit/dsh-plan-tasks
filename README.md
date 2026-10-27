# dsh-plan-tasks

DSH 侧边栏「任务列表」插件。读取项目根目录 `.plan/plan.json`，用互斥手风琴展示计划、模式、执行状态、耗时与备注；可以在面板里新增/编辑/审核/排序计划，并配合项目级技能 `plan-tasks` 按计划逐条执行。

## 依赖

**必须先装 `dsh-better-sidebar`。** 页签是通过该插件的 `betterSidebar.registerTab` 注册的；没装侧边栏插件时，本插件能正常启动、不报错，但侧边栏里不会出现「任务列表」。

`package.json` 已声明：

```json
"peerDependencies": { "dsh-better-sidebar": ">=0.28.0" }
```

## 安装

不要用 `link:` 分发（它绑死本机绝对路径）。打成 tgz 再给对方：

```bash
cd dsh-plan-tasks
npm pack                       # 生成 dsh-plan-tasks-1.0.0.tgz
```

对方机器上：

```bash
dsh plugin --profile web add ./dsh-plan-tasks-1.0.0.tgz
```

装完**重启一次 `dsh web`**：`dsh.client` 的模块表是启动时扫描宿主 Loader 条目生成的，不重启页面拿不到 `plugins/??dsh-plan-tasks/client.js`。

## 安装后自查

1. `dsh plugin --profile web list`，或直接看 `D:\DeepSeekHarness\data\profiles\web\package.json`：
   - `dependencies` 里有 `dsh-plan-tasks`
   - `dsh.profile.bundles` 数组里也有 `dsh-plan-tasks`
   - `dsh-better-sidebar` 同样装着
2. 浏览器控制台搜红字：`client-modules: require("...") missed the module table`、`web boot: N entry did not activate`。
3. `POST http://127.0.0.1:8848/plan-tasks/api/read`：
   - 404 → 宿主半边没加载（bundles 里没有它，或没重启）
   - 200 → 宿主正常，问题在页签注册（回去查 better-sidebar）

## 项目内初始化

第一次打开面板会提示「初始化」：它会在项目根写入

```
.plan/plan.json
.dsh/skills/plan-tasks/SKILL.md
```

技能正文编译在宿主 `lib/index.js` 里（`skillMarkdown(cwd)`），所以包里没有 `.dsh/` 是正常的——技能是在目标项目里运行时生成的。**没点过初始化，项目里就没有这个技能。**

## 兼容性

`package.json` 里：

```json
"engines": { "node": ">=20", "dsh": "^0.2.1-rc.3" }
```

`engines.dsh` 由 `dsh-app-boot` 的兼容性门禁校验：版本落在范围外时插件被跳过并打一条 warning，不会让整个 harness 起不来。范围是 `^0.2.1-rc.3`，即允许 `0.2.x`（含后续 rc 与正式版），`0.3.0` 起视为不兼容。
