import { TASK_TYPES, modeForTaskType } from './constants.js'
import { autoName, normalizeItem } from './store.js'
import { pick, str } from './values.js'
import { collectIds, createTaskId } from './taskid.js'
import { nextOrder } from './order.js'

/**
 * 组装一条新计划（新条目追加到顺序末尾）。
 *
 * id=405：原来的 `draft` 参数已删 —— 草稿模式整体移除后，没有任何入口会创建草稿，
 * 该参数永远传入 undefined，写入的 draft 也就恒为 false。
 * 保留它只会让调用方以为「还能传 draft 创建草稿」。
 */
function composeItem(items, planText, mode, taskType, name, decomposeKey, sourcePrompt) {
  // id=77-B：id 改为 makeId() 随机分配（6 位 0-9A-Za-z），不再「取最大 id 加 1」。
  // 旧写法隐含「id 是可比较的数字」这个假设，换成随机串后 `item.id > max` 恒为 false，
  // maxId 永远是 0，所有新条目都会拿到同一个 id —— 所以这不只是换实现，是换前提。
  // 去重交给 allocateId（撞号重试，上限 64 次）。
  const text = String(planText ?? '')
  const type = TASK_TYPES.includes(taskType) ? taskType : '修改'
  return normalizeItem({
    id: createTaskId({ existing: collectIds(items) }),
    // id=77-C：步长 1000，留出插入间隙（见 order.js 的说明）。
    order: nextOrder(items),
    name: str(name).trim() !== '' ? name.trim() : autoName(text),
    plan: text,
    // 执行模式（id=218）：调用方显式给了就用它，没给就按任务类型推。
    // 这一行是「任务创建时把模式写进任务自身」的落点 —— 以前这里只有 `str(mode)`，
    // 而客户端从来没给过非空值，于是每条新计划的 mode 永远是空串。
    mode: str(mode) !== '' ? str(mode) : modeForTaskType(type),
    taskType: type,
    execute: false,
    review: false,
    time: 0,
    note: '',
    createdAt: new Date().toISOString(),
    ...pick('decomposeKey', decomposeKey),
    ...pick('sourcePrompt', sourcePrompt),
  })
}

export { composeItem }
