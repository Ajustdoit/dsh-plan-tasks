import { readFile, rmdir, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { PLAN_DIR, PLAN_FILE, SKILL_NAME } from './constants.js'
import { SKILL_FLAT_REL, exists, skillPathOf } from './paths.js'

/**
 * 把 `---` 包起来的 YAML frontmatter 与正文拆开。
 *
 * 技能正文只有一份（`skillMarkdown`），落盘要带 frontmatter、虚拟注册要拆成 meta + body，
 * 所以统一在这里切，避免两处各写一份文案后逐渐漂移。
 */
function splitSkillFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (match === null) return { meta: {}, body: text }
  const meta = {}
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at <= 0) continue
    const key = line.slice(0, at).trim()
    const value = line.slice(at + 1).trim()
    if (key !== '') meta[key] = value
  }
  return { meta, body: text.slice(match[0].length) }
}

/**
 * 虚拟技能注册：把同一份技能正文挂到平台的 `ctx.skills` 注册表上，**不落盘**。
 *
 * 为什么不写文件：`@deepseek-ai/dsh-skill-filesystem` 只扫描 `项目/.dsh/skills`、
 * `项目/.agents/skills` 和用户目录，插件没有写用户项目目录的权限也不该写。
 * 直接注册成 runtime 技能后，只建了 `.plan/plan.json` 的项目也能被模型看到该技能，
 * 且内容永远跟着插件版本走（不会因为项目里那份旧拷贝落后而失效）。
 *
 * `ctx.skills` 是内核服务（dsh-base 里常驻），但仍用软注入：万一某个极简 profile
 * 没挂 skills，插件其余功能不该因此启动失败。
 */
function registerVirtualSkill(ctx) {
  // 极简宿主（以及单元测试里的假 ctx）可能没有 cordis 的 inject，直接跳过。
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['skills'], (scope) => {
    try {
      const registry = scope.skills
      if (registry === undefined || typeof registry.register !== 'function') return
      const { meta, body } = splitSkillFrontmatter(skillMarkdown())
      const name = typeof meta.name === 'string' && meta.name !== '' ? meta.name : SKILL_NAME
      // 幂等：重复注册同名技能时上层会打一行 warning 并返回空 disposer，不会抛异常；
      // 这里再包一层 try/catch，保证技能注册失败绝不拖垮面板的其它功能。
      registry.register({
        name,
        description: typeof meta.description === 'string' ? meta.description : `${name} 计划任务执行器`,
        ...(typeof meta.whenToUse === 'string' && meta.whenToUse !== '' ? { whenToUse: meta.whenToUse } : {}),
        source: 'runtime',
        content: body,
      })
    } catch (error) {
      ctx.logger?.warn?.(`dsh-plan-tasks: 注册技能失败（不影响面板）：${error instanceof Error ? error.message : String(error)}`)
    }
  })
}

/** 技能正文：模型读到 SKILL.md 后按其中的流程推进 plan.json。 */
function skillMarkdown(cwd) {
  const rel = `${PLAN_DIR}/${PLAN_FILE}`
  return `---
name: plan-tasks
description: 当用户说「开始干活」时，从项目根目录 ${rel} 取出所有 execute 为 false 且不是草稿的计划，按 order 字段（即侧边栏里拖拽后的顺序）逐条执行它们，每执行完一条就回填 note、把 execute 改为 true 并重新读取文件，直到没有未完成的计划为止。
whenToUse: 用户说「开始干活」「继续干活」「执行计划」「下一条计划」等，或需要查看项目计划进度时。
---

# 计划任务执行器

项目计划文件：\`${rel}\`（JSON 数组，数组顺序即执行顺序，由 \`order\` 字段决定）。

> 本技能由 dsh-plan-tasks 插件通过平台技能系统（\`ctx.skills.register\`，runtime 层）注册，
> **不依赖项目里的 \`.dsh/skills\` 目录**，也不需要任何「同步技能」操作。项目里若还留着旧副本，
> 插件在读计划时会自动清掉带同名 frontmatter 的那份，不要手写它。

## 数据字段

| 字段 | 含义 |
| --- | --- |
| \`id\` | 自增编号 |
| \`order\` | 排序位置（用户在侧边栏拖拽决定；0 在最上） |
| \`name\` | 很短的计划名，用于手风琴标题 |
| \`plan\` | 计划全文（要执行的提示词 / 需求描述） |
| \`mode\` | 提交时选择的模式 |
| \`taskType\` | \`仅回答\` / \`目标\` / \`修改\` |
| \`execute\` | 是否已执行完（true 表示完成） |
| \`review\` | 人工审核是否通过（true 表示已打勾） |
| \`draft\` | 是否草稿（true 表示只存着备用，**不要执行**） |
| \`time\` | 耗时（毫秒） |
| \`note\` | 执行结果回填 |
| \`createdAt\` / \`startedAt\` | ISO 时间戳 |

## 执行流程

用户说「开始干活」时，**严格一条一条串行推进**，直到文件里再没有任何 \`execute\` 为 \`false\` 且 \`draft\` 不为 \`true\` 的记录为止。

> ⚠️ **草稿（\`draft: true\`）永远跳过**：那是用户在侧边栏「草稿模式」里存下来的备忘，
> 不是待办。不要执行它、不要改它的任何字段、也不要因为它的存在而停下。

> ⚠️ **绝对不要"先读几条再一起开工"**。每次只从文件里取**一条**来做，做完写回、重新读文件、再取下一条。
> 同时开始好几条会让侧边栏的「待执行 / 进行中」状态错乱（历史事故：模型预读了 3 条，于是一次改了 3 个文件，
> 界面上只看到 1 条变"进行中"）。

1. 读取 \`${rel}\`。把 JSON 解析成数组（若单个对象则当成只含一条）。
2. **循环**下面步骤，一轮只做一条：

   **a. 挑选（只挑一条）**：按**数组顺序**（也就是 \`order\` 升序，等于用户在侧边栏里拖拽排好的顺序）取**第一条** \`execute\` 为 \`false\` 且 \`draft\` 不为 \`true\` 的记录。
   **不要**按 \`id\` 大小挑 —— \`id\` 只是编号，执行顺序以数组/order 为准。
   **不要**顺手把后面几条也一起看/一起规划。一条都没有 → 跳出循环，进入第 3 步。

   **b. 开工（先改状态，再干活）**：**第一件事**是把这**唯一一条**记录的 \`startedAt\` 写成当前时间（ISO 字符串）
   并立刻写回文件 —— 侧边栏据此显示「进行中」。**在动任何代码/文件之前先写这一步**，
   不要等做完才补，也不要等到"想清楚怎么做"之后才写，否则界面上一直看不到「正在执行」。
   写回后再按 \`taskType\` 决定执行方式：
   - \`仅回答\`：只把 \`plan\` 当成一个问题来回答，**不要**修改任何文件。
   - \`目标\`：以 \`plan\` 为**目标**推进（可能需要多步工具调用），达成目标即可，不要做计划之外的额外改动。
   - \`修改\`：\`plan\` 要求的是**改代码/改文件**，直接动手改。

   **c. 回填（先写回，再看下一条）**：把结果摘要（做了什么、改了哪些文件、遇到的问题）写进该记录的 \`note\`，
   把 \`execute\` 改为 \`true\`，把 \`time\` 写成 \`Date.now() - Date.parse(startedAt)\`（拿不到就用 0），
   把整个数组原样写回 \`${rel}\`。**写回成功后这一条才算结束**，界面上的「进行中」会随即变成「待审核」。

   **d. 重新读取**：回填后**必须重新从磁盘读取** \`${rel}\`（不要复用内存里的旧数组，
   文件可能已被侧边栏或人工改动），再回到 a 取下一条。

3. 循环结束后，汇总回复用户：这一轮一共完成了几条、分别是哪几条（id + 名称 + 一句话结果），
   并提示「请在侧边栏任务列表里逐条打勾审核」。

## 约束

- **不要做完一条就停**。只要 \`${rel}\` 里还有 \`execute\` 为 \`false\` 且 \`draft\` 不为 \`true\` 的记录，就继续做下一条，
  中途不要征求用户同意、不要问「要不要继续」。
- **草稿不执行**：\`draft\` 为 \`true\` 的条目一律跳过（含拆解模式产出的 \`[拆]\` 条目），只在用户手动
  「转待执行」之后才轮到它。不要自作主张替用户把草稿转正。
- 一轮只做一条：不要一次挑好几条并行做，顺序按数组里的 \`order\`（界面从上到下）。
- 某一条执行失败（报错做不下去）时：把失败原因写进它的 \`note\`，\`execute\` **保持** \`false\`，
  然后**跳过它继续做后面剩下的**；全部结束时把失败的条目单独列出来说明。
- 回写文件时必须保留数组里的其它记录，不要丢字段、不要改其它记录的 \`id\`，也不要顺手把 \`draft\` 清掉。
- 保持 JSON 合法（UTF-8，逗号/引号正确）。
- 如果中途发现计划内容有明显矛盾/危险（比如要删库），停下来说明原因，不要硬做。
`
}
/**
 * 清理旧版本写盘留下的技能副本。
 *
 * 换成虚拟技能之后（见 `registerVirtualSkill`），项目里那份 `.dsh/skills/plan-tasks/SKILL.md`
 * 不但没用，还会**盖住**虚拟技能：`dsh-skill` 里项目层 rank 是 100/200、runtime 是 250
 * （`@deepseek-ai/dsh-skill/lib/index.js:21`、`dsh-skill-filesystem/lib/index.js:20-24`），
 * 同名时排前面的是项目那份，于是插件升级后模型读到的还是项目里的旧文案。
 *
 * 判定「这是我们的旧副本」不靠路径猜，而是看文件自己：路径是那两个固定位置之一，
 * **并且** frontmatter 里的 `name` 就是 `plan-tasks`。用户自己写的别的技能不会被碰到。
 * 删掉文件后若目录空了就顺手把空目录也去掉（非空则留着，里面可能是用户的技能）。
 *
 * 容错：不存在 → 静默跳过；读/删失败 → 只 warn，绝不影响插件启动与其它功能。
 */
async function pruneLegacySkill(ctx, cwd) {
  const targets = [skillPathOf(cwd), join(cwd, SKILL_FLAT_REL)]
  const removed = []
  for (const target of targets) {
    if (!(await exists(target))) continue
    let text
    try {
      text = await readFile(target, 'utf8')
    } catch {
      continue
    }
    const { meta } = splitSkillFrontmatter(text)
    if (meta.name !== SKILL_NAME) continue // 不是我们的技能，一个字节都不动
    try {
      await unlink(target)
      removed.push(target)
    } catch (error) {
      ctx.logger?.warn?.(`dsh-plan-tasks: 清理旧技能副本失败（不影响使用）：${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    try {
      await rmdir(dirname(target))
    } catch {
      /* 目录非空（用户还放了别的技能）或已经不存在，都无所谓 */
    }
  }
  return removed
}
export { registerVirtualSkill, pruneLegacySkill }
