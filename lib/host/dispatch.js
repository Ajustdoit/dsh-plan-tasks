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
 * 组内进度（id=367）：**整个模块唯一的剩余条数算法**。
 *
 * 为什么单独立一个函数：id=366 修过一次「把本条自己算进去」，当时的算法是就地
 * 写在 `buildPrompt` 的模板字符串旁边的。这种「算法长在文案里」的写法有两个问题：
 * 1. 以后再加一处「还剩几条」的文案，很容易顺手把 `groupRemaining`（含本条）
 *    又用一遍 —— 同一个错会以同样的方式复现；
 * 2. 想在一处改口径（比如改成「按未执行数」），得先全文搜索哪几处是自己算的。
 *
 * 现在所有需要「还剩几条」的地方都只认这个函数，口径只有一份。
 *
 * 口径：`after = 组内总条数 − 当前条目在本组的序号（序号从 1 起）`
 * 即**只数当前条目之后、还没轮到的条数**，不含本条。
 * 用位置而不是「还剩几条没执行」，是因为后者会随兄弟任务的完成情况变化，
 * 而「我后面还有几条」是纯粹的队列位置，不依赖此刻谁已经做完了。
 *
 * @param {{groupSize?: number, index?: number}} step
 * @returns {{position: number, size: number, after: number}}
 *   `position` 从 1 起；`after` 是**本条之后**的条数，满足 `position + after === size`
 */
function groupProgress(step) {
  const rawSize = step?.groupSize
  const size = Number.isInteger(rawSize) && rawSize > 0 ? rawSize : 1
  const rawIndex = step?.index
  // 两个数都夹进合法区间：脏数据（index 越界）不该拼出「第 6/1 条」或「还剩 -1 条」。
  // 位置夹到 [0, size-1]，剩余自然就落在 [0, size-1]，于是
  //「position + after === size」这条不变量恒成立。
  const index = Number.isInteger(rawIndex) && rawIndex >= 0 ? Math.min(rawIndex, size - 1) : 0
  return { position: index + 1, size, after: size - (index + 1) }
}

/**
 * 剩余条数的措辞（id=367）：**唯一**把数字转成中文的地方。
 *
 * 剩余为 0 时不再输出「还剩 0 条」—— 那句话读起来像「这里还有 0 个东西」，
 * 是个空的计数；而真实语义是「这条就是本组的最后一条」，是一个**位置结论**。
 * 措辞换成结论，模型与用户都能立刻知道「做完这条这一组就齐了」。
 *
 * @param {number} after 本条之后的条数（已经不含本条）
 * @param {'group'|'queue'} scope 组内进度 / 整条队列
 * @returns {string} 可直接嵌进提示词的短语
 */
function remainingPhrase(after, scope) {
  const n = Number.isInteger(after) && after > 0 ? after : 0
  if (n === 0) return scope === 'group' ? '本组最后一条' : '队列里最后一条'
  return scope === 'group' ? `这一组还剩 ${n} 条` : `队列里还剩 ${n} 条`
}

/** 整条队列里「本条之后还剩几条」（`remainingCount` 是含本条的，这里减掉自己）。 */
function queueProgress(remaining) {
  const total = Number.isInteger(remaining) && remaining > 0 ? remaining : 0
  return { after: Math.max(0, total - 1) }
}

/**
 * 生成投给会话的那条提示词。
 *
 * 刻意**不**让模型自己去找下一条：正文里直接给出 id 与正文，模型只做这一条。
 * 组信息也写进去，是为了让模型知道「这是某一批拆解任务里的第几条」——
 * 它就不会在同一轮里顺手把兄弟任务也做了（那会跳过一次回答）。
 *
 * id=366：「这一组还剩 N 条」原来直接用了 `step.groupRemaining`，而那个字段的
 * 定义是**含本条**的未执行条数（queue-cli 里写着「含本条」）。于是 3 条的组
 * 第一条会说「还剩 3 条」—— 模型读到的是「连着我在内还有 3 条没做」，
 * 但正文紧接着又写「只做这一条」，两句话自相矛盾；用户看到的则是把当前这条
 * 又数了一遍，读起来像进度算错了。
 *
 * id=367：算法与措辞都收进 `groupProgress()` / `remainingPhrase()`，
 * 本函数只负责把它们拼进句子，自己**不再算任何数字**。
 * 3 条的组验算：
 *   第 1 条 → 第 1/3 条，这一组还剩 2 条
 *   第 2 条 → 第 2/3 条，这一组还剩 1 条
 *   第 3 条 → 第 3/3 条，本组最后一条
 */
function buildPrompt(step, remaining) {
  const task = promptTask(step)
  const lines = []
  if (step.parentId !== null && step.parentId !== undefined) {
    const { position, size, after } = groupProgress(step)
    lines.push(`继续做计划 ${task.id}（拆分组 ${step.parentId} 的第 ${position}/${size} 条，${remainingPhrase(after, 'group')}）。`)
  } else {
    // 与组内同一套口径：`remainingCount` 数的是「连本条在内的可做条数」，
    // 所以「本条之后还剩几条」要减掉自己 —— 否则队列那条分支等于又把自身算了一遍。
    lines.push(`继续做计划 ${task.id}（${remainingPhrase(queueProgress(remaining).after, 'queue')}）。`)
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

export { buildPrompt, nextStep, promptTask, remainingCount, groupProgress, remainingPhrase, queueProgress }
