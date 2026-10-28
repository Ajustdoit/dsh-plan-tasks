import { TASK_TYPES } from './constants.js'
import { autoName, normalizeItem } from './store.js'
import { pick, str } from './values.js'

/** 组装一条新计划（新条目追加到顺序末尾）。`draft: true` 时落成草稿。 */
function composeItem(items, planText, mode, taskType, name, draft, decomposeKey, sourcePrompt) {
  const maxId = items.reduce((max, item) => (item.id > max ? item.id : max), 0)
  const maxOrder = items.reduce((max, item) => (Number.isFinite(item.order) && item.order > max ? item.order : max), -1)
  const text = String(planText ?? '')
  const type = TASK_TYPES.includes(taskType) ? taskType : '修改'
  return normalizeItem({
    id: maxId + 1,
    order: maxOrder + 1,
    name: str(name).trim() !== '' ? name.trim() : autoName(text),
    plan: text,
    mode: str(mode),
    taskType: type,
    execute: false,
    review: false,
    draft: draft === true,
    time: 0,
    note: '',
    createdAt: new Date().toISOString(),
    ...pick('decomposeKey', decomposeKey),
    ...pick('sourcePrompt', sourcePrompt),
  })
}

export { composeItem }
