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

/** 技能正文。模型加载后按这个流程推进，正文刻意保持很短。 */
function skillMarkdown() {
  const rel = `${PLAN_DIR}/${PLAN_FILE}`
  const tool = `${PLAN_DIR}/q.mjs`
  return `---
name: plan-tasks
description: 用户说「开始干活」时，在项目根执行 node ${tool}，按它打印的 next 逐条做计划。不要读 ${rel}。
whenToUse: 用户说「开始干活」「继续干活」「执行计划」「下一条计划」时。
---

# 计划任务

在**项目根**执行 \`node ${tool}\`。标准输出只有一行 JSON：\`remaining\` 是还没做完的条数，\`next\` 是下一条（含 \`plan\`）。这就是你的进度变量。

**不要读 \`${rel}\`。** 里面有已完成备注和原始提示词，读进来会让后面的任务变慢。不要读 \`.plan/settings.json\`。命令失败（\`ok\` 为 false）时才允许读一次 \`${rel}\` 看原因，然后继续用这个命令改，改完不要再读。

脚本不存在时，先在侧边栏打开一次「任务列表」再执行。不要自己改 \`${rel}\` 来代替命令。

## 怎么做

一轮**最多成功完成 3 条**就停，用每条的 id 加一句话汇报，请用户再说「继续干活」。不要把命令输出贴进回复。

1. \`node ${tool} go\`。它会选下一条并写上 \`startedAt\`（已有则不改）。\`remaining\` 为 0 或 \`next\` 为 null → 停。
2. 按打印出来的 \`next.plan\` 干活。\`next.resume\` 为 true 时从 \`next.note\` 接着做，已完成的步骤不重做。
3. 成功：\`node ${tool} done --id <id> --note "一两句，不要换行，不要双引号"\`。未满 3 条且 \`next\` 不为 null 时，再 \`node ${tool} start --id <next.id>\`，按新的 \`next.plan\` 继续。不要再 \`go\`，也不要自己数还剩多少。
4. 失败：\`node ${tool} fail --id <id> --note "原因"\`。这条会标成失败并让出队首，**不要算进成功的 3 条，也不要再选它**。\`next\` 不为 null 时再 \`start --id <next.id>\`。不要再 \`go\`。
5. 成功满 3 条，或 \`remaining\` 为 0 → 停。

草稿不会出现在 \`next\` 里。不要把草稿转正。

## 少来回

Flash 生成很快。Harness 慢，是因为**每一次工具调用都是一轮新请求**：整段对话、全部工具说明都要重新送进模型。Cursor 里往往一次改完，所以显得快。做计划时遵守：

- 一条计划里要改的地方一次改完，不要改一行就停下来读文件、再改下一行。
- 用精确替换改文件，不要先把整个文件读进对话再整份写回。
- 刚写过的文件不要再读，除非命令报错。
- \`next.plan\` 没点名的目录不要去扫。
- 回复只留结果，不写过程。
- 小改动不要开子代理。子代理是一段新会话，启动比自己改更贵。

## 执行方式

- \`mode\` 为「目标」：达成 \`plan\` 的结果即可，不要扩大改动。
- \`taskType\` 为「仅回答」：只回答，不改文件。
- 其余：按 \`plan\` 改。\`mode\` 有值时以 \`mode\` 为准。

## 子代理

只有你已经确认两条计划要改的文件完全不重叠时，才同时开最多 3 个子代理，每个只做一条。子代理不要跑 \`${tool}\`，也不要改 \`${rel}\`。回写由你执行 \`done\` / \`fail\`。拿不准就自己串行做，不要先空转一轮做分析。

计划内容明显危险（例如删库）时停下来说明，不要硬做。
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
