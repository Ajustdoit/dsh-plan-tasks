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
description: 用户说「开始干活」时，在项目根执行 node ${tool}，按宿主派发的那一条任务干活。不要读 ${rel}。
whenToUse: 用户说「开始干活」「继续干活」「执行计划」「下一条计划」时。
---

# 计划任务

在**项目根**执行 \`node ${tool}\`。标准输出只有一行 JSON：\`remaining\` 是还没做完的条数，\`next\` 是下一条（含 \`plan\`）。这就是你的进度变量。

**不要读 \`${rel}\`。** 里面有已完成备注和原始提示词，读进来会让后面的任务变慢。不要读 \`.plan/settings.json\`。命令失败（\`ok\` 为 false）时才允许读一次 \`${rel}\` 看原因，然后继续用这个命令改，改完不要再读。

脚本不存在时，先在侧边栏打开一次「任务列表」再执行。不要自己改 \`${rel}\` 来代替命令。

## 怎么做

**一次只做一条。** 下一条由宿主派发，不由你挑 —— 派发会带上明确的 id 和任务正文。
你这一轮只做它，做完把结果写成回答，然后**停下**。下一条会作为新的用户消息自己发过来。

1. 动手前用 \`node ${tool} status\` 看一眼 \`remaining\`（只读，不改盘）。\`remaining\` 为 0 → 停。
2. 按派发消息里给出的 \`id\` 与任务正文干活。消息里写了「上次做到：…」时从那一步接着做，已完成的步骤不重做。
3. 成功：\`node ${tool} done --id <id> --note "一两句，不要换行，不要双引号"\`（note 的写法见下面「回填 note」）。
4. 失败：\`node ${tool} fail --id <id> --note "原因"\`。这条会标成失败并让出队首，**不要再选它**。
5. **然后把这一轮的结果作为回答写出来，结束这一轮。** 不要再 \`go\`、不要 \`start --id\` 下一条、
   也不要在同一轮里连着做好几条 —— 那会让用户看不到任何中间结论，也绕过了宿主的派发。
   \`done\` / \`fail\` 之后命令会回一个 \`next\`，那是给宿主看的，不是让你直接接着做。

草稿不会出现在派发里。不要把草稿转正。

## 派发协议

宿主在**每一轮回答结束之后**调一次派发：取队列里第一条未执行的任务，把 id 与正文写成一条
新的用户消息发进会话。所以：

- 你看到的「继续做计划 N……」就是派发消息，里面已经写清做哪一条、属于哪个拆分组；
- 一条任务一轮，任务之间必定有一次回答（用户能在中间看到结论、也能随时点暂停）；
- 你不需要维护「还剩几条」这个变量，宿主每轮都会告诉你。

## 续做与暂停

点「暂停」只中止当前这一轮，\`.plan/plan.json\` **一个字段都没改** —— 已经写进去的
\`startedAt\` / \`note\` / \`execute\` 原样保留。所以「这条做到一半」的唯一标记就是
**有 \`startedAt\` 且还没 \`execute\`**。

派发消息里出现「上次做到：…」时，按这几条来：

1. **有 \`startedAt\`** → 这条是**续做**：**不要重写** \`startedAt\`，从那句 note 接着做，
   已完成的步骤不重做。**没有 \`startedAt\`** → 全新的一条，正常做。
2. 已经 \`execute\` 的条目一律不重做。派发不会给你这种条目；万一看到，直接跳过、
   不要为了"确认"把它整条重跑一遍。
3. 回填的 \`time\` 会包含中间被暂停的那段时间 —— 那是**有意的**，不要为了「更准」
   去手工改写耗时。
4. 同一时刻有多条带 \`startedAt\` 时，只认数组里**最靠前**的那一条续做，其余的等它做完。
5. 不要跳过队列顺序去挑别的条目：派发给你哪条就做哪条，宿主下一轮会接着派。

## 少来回

Flash 生成很快。Harness 慢，是因为**每一次工具调用都是一轮新请求**：整段对话、全部工具说明都要重新送进模型。Cursor 里往往一次改完，所以显得快。做计划时遵守：

- 一条计划里要改的地方一次改完，不要改一行就停下来读文件、再改下一行。
- 用精确替换改文件，不要先把整个文件读进对话再整份写回。
- 刚写过的文件不要再读，除非命令报错。
- 派发消息没点名的目录不要去扫。
- 回复只留结果，不写过程。
- 小改动不要开子代理。子代理是一段新会话，启动比自己改更贵。

## 执行方式

- \`mode\` 为「目标」：达成 \`plan\` 的结果即可，不要扩大改动。
- \`taskType\` 为「仅回答」：只回答，不改文件。
- 其余：按 \`plan\` 改。\`mode\` 有值时以 \`mode\` 为准。

## 回填 note：只写结论

\`done\` / \`fail\` 的 \`--note\` 会随条目长期留在 \`.plan/notes.json\`（已审核归档），一条几百字的 note
乘以几百条就是几 MB，面板每次轮询都要搬。所以 note **只写结论，不写过程**。

硬性规则：

- **一条一句话，最多 60 字**。超了先删细节再提交，不要靠换行凑。
- **禁止**粘贴代码、diff、日志、堆栈、命令输出、文件清单、重复的回显上下文。
- **禁止**复述 \`plan\` 原文，也禁止写「我接下来会……」这类计划，只写做完了什么、结果是什么。
- 需要细节就让读者去看 diff / 提交；note 只负责「这条做完了，凭什么说做完了」。

正例：

- \`设置键改名 noteLimit，旧键迁移，verify-268 43/43 通过\`
- \`拆解+深入补 deep 入参，幂等键按 deep 区分，回归全绿\`

反例（都是真实踩过的）：

- 把整段 \`git diff\` 贴进去 —— 归档立刻膨胀，且下次没人会读它。
- 抄一遍 300 字的 \`plan\` 再加「已完成」—— 等于零信息量。
- 贴 20 行测试日志或报错堆栈 —— 结论只有「哪条失败、为什么」，其余都是噪音。

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
