/**
 * 任务派发（id=341）。
 *
 * 以前「下一条做什么」是模型自己决定的：技能正文让它 `q.mjs go` 拿 next、做完再
 * `start --id <next.id>` 自己接着干。两个毛病：
 * 1. 模型每轮都要重新读技能、重新判断该不该继续，提示词一长就会自己发明流程；
 * 2. 做完一条立刻接一条，用户看不到阶段结论（这一轮到底做成了什么）。
 *
 * 现在拆成两半：
 * - **谁来做下一条**：`nextTask()`（queue-cli.js，纯函数）—— 代码决定，不看模型心情；
 * - **什么时候做下一条**：这一轮回答结束之后（客户端在一个 turn 结束后调 `dispatch`），
 *   于是每条任务之间天然有一次「先回答」。
 *
 * 本模块只负责「把 step 变成一段能直接投给会话的提示词」，不发请求 ——
 * 发请求需要 ctx，那是 api.js 的事。
 */
import { nextTask } from './queue-cli.js'

/** 投影给会话的任务信息：只要模型干活用得上的字段。 */
function promptTask(step) {
  const task = step?.task ?? {}
  const out = {
    id: task.id,
    name: typeof task.name === 'string' ? task.name : '',
    plan: typeof task.plan === 'string' ? task.plan : '',
    taskType: typeof task.taskType === 'string' ? task.taskType : '',
    mode: typeof task.mode === 'string' ? task.mode : '',
    resume: typeof task.startedAt === 'string' && task.startedAt !== '',
  }
  if (out.resume && typeof task.note === 'string' && task.note !== '') out.note = task.note
  return out
}

/**
 * 生成投给会话的那条提示词。
 *
 * 刻意**不**让模型自己去找下一条：正文里直接给出 id 与正文，模型只做这一条。
 * 组信息也写进去，是为了让模型知道「这是某一批拆解任务里的第几条」——
 * 它就不会在同一轮里顺手把兄弟任务也做了（那会跳过一次回答）。
 */
function buildPrompt(step, remaining) {
  const task = promptTask(step)
  const lines = []
  if (step.parentId !== null && step.parentId !== undefined) {
    lines.push(`继续做计划 ${task.id}（拆分组 ${step.parentId} 的第 ${step.index + 1}/${step.groupSize} 条，这一组还剩 ${step.groupRemaining} 条）。`)
  } else {
    lines.push(`继续做计划 ${task.id}（队列里还剩 ${remaining} 条）。`)
  }
  lines.push('')
  lines.push(`任务正文：${task.plan}`)
  // mode / taskType 写在消息里，模型就不必再跑一次 status 才知道「只回答」还是「按目标改」。
  if (task.mode !== '') lines.push(`mode：${task.mode}`)
  if (task.taskType !== '') lines.push(`taskType：${task.taskType}`)
  if (task.resume && task.note !== undefined) lines.push(`上次做到：${task.note}`)
  lines.push('')
  lines.push('不要读 plan-tasks 技能，不要跑 q.mjs status，不要读 .plan/plan.json，不要开子代理。只做这一条。做完用 q.mjs done 或 fail 回填（note 一句结论，最多 60 字），把结果写成回答就停。不要自己找下一条。')
  return lines.join('\n')
}

/** 现在该派哪一条（没有可做的就返回 null）。 */
function nextStep(items) {
  return nextTask(items)
}

/** 还剩几条可做（用于提示语与「要不要再派」的判断）。 */
function remainingCount(items) {
  const list = Array.isArray(items) ? items : []
  let n = 0
  for (const item of list) {
    const kids = Array.isArray(item?.children) ? item.children : []
    if (kids.length === 0) {
      if (item && typeof item === 'object' && item.draft !== true && item.failed !== true && item.execute !== true) n += 1
      continue
    }
    if (item.draft === true || item.failed === true || item.execute === true) continue
    n += kids.filter((kid) => kid && kid.draft !== true && kid.failed !== true && kid.execute !== true).length
  }
  return n
}

export { buildPrompt, nextStep, promptTask, remainingCount }
