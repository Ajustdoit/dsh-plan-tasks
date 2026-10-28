/**
 * 宿主侧的通用取值小工具。
 *
 * 为什么单独一个文件：`plan.json` 是用户手写 / 旧版本 / 别处脚本混着写出来的，
 * 每个字段都可能缺失或类型不对，所以「不是字符串就当空串」这个判断在
 * store / item / api 三处都要用。集中在这里，既避免三份实现慢慢走味，
 * 也让「哪些字段容忍脏数据」有个统一的出处。
 *
 * 本文件刻意不 import 任何其它模块：store.js 与 item.js 互相引用（item 用
 * store 的 normalizeItem），把工具放进来会造成循环依赖。
 */

/** 非字符串一律当空串（含 undefined / null / 数字 / 对象）。 */
function str(value) {
  return typeof value === 'string' ? value : ''
}

/**
 * 可选字段的展开：值不是非空字符串时返回空对象，可以直接 `...pick(...)` 展开。
 * 写这个是为了替代 `...(typeof x === 'string' && x !== '' ? { k: x } : {})` 那种
 * 一长串内联三元，顺手让「空值不落盘」的意图一眼可见。
 */
function pick(key, value) {
  return typeof value === 'string' && value !== '' ? { [key]: value } : {}
}

/**
 * 这条计划是否正在执行：还没完成（execute 不为 true）且已经开始（写过 startedAt）。
 * 删除、批量删除、置灰判断都靠它，口径必须只有一份。
 */
function isRunning(item) {
  return item !== null
    && typeof item === 'object'
    && item.execute !== true
    && str(item.startedAt) !== ''
}

export { str, pick, isRunning }
