/**
 * 「待审核」的通过动作（id=300 建，id=391 移除自动机制）。
 *
 * **id=391：自动通过已整体移除**（题面：取消待审核的自动审核机制、移除代码和下拉选项）。
 * 原来本模块还提供 `pickAutoReview`（挑出超阈值的最旧若干条），配合
 * `api.read` 里每 5 秒一次的扫描，把待审核悄悄压到阈值以下。这套机制已删除：
 * 审核变成 100% 人工动作，待审核队列有多少条就显示多少条，不再自动消失。
 *
 * 保留下来的 `approveItem` 不是「自动审核」的一部分 —— 它是**手动**通过的写回形态：
 * 面板上的「通过」按钮、以及「全部通过」批量操作都走它。所以这个模块与它的名字
 * (`auto-review`) 现在略有出入，但重命名要动 import 与文件路径，收益不抵风险，
 * 改注释说清楚即可。
 *
 * 原来那三个口径只剩两条仍然成立（都关于 `approveItem`）：
 * 1. **跟面板的「待审核」组同一套判定** —— 一条父算一条，通过时把它的 children
 *    全部标成已审。否则手动通过只改父的容器标记，children 还挂着「未审核」，
 *    下一次读盘又会把它判回待审核，来回抖。
 * 2. `noteTimeOf` 等时间口径仍在 trim.js 里供其它地方使用，本模块不再需要它。
 *
 * 顺带清掉的死代码（id=391）：`isUnreviewedBatch` 与 `parentIdValue` 的 import。
 * 前者唯一的消费者就是 `pickAutoReview`，两者一起删掉后它彻底没有引用了。
 * 不删会怎样：`unused-decls` 会报出来，但更麻烦的是它会留下「待审核判定逻辑」
 * 的第二份实现 —— 面板侧（30-runtime.js 的 statusOf）才是唯一真源，
 * 留着这份迟早有人照着改，两处口径分家。
 */

/**
 * 把挑中的条目标记成「已审核」。
 *
 * 拆解批次：children 全部 review=true（父自己的 review 只是容器标记，也一并落上，
 * 免得面板与归档口径不一致）；普通条目：自己 review=true，并把完成时刻补上
 * —— 归档淘汰要用 finishedAt，缺了就退到 startedAt/createdAt，排序会偏。
 *
 * id=372：children 逐项**先挡脏数据再展开**。
 *
 * 这里原来直接 `{ ...kid, ... }`，而 `{ ...null }` 得到 `{}`、随后读 `kid.finishedAt`
 * 就抛 `Cannot read properties of null`。一条脏数据（手改 plan.json、旧版本写坏的
 * 数组）能让**整批通过**整个失败 —— 而这正是本任务要求「不抛错、能正常落库」的场景。
 *
 * 现在两件事：
 * 1. 不是对象的项原样留着（不制造空洞、也不猜它该变成什么），只跳过标记；
 * 2. 是对象的项照常标 review + finishedAt。
 *
 * 为什么不直接把 null 过滤掉：这个函数的返回值会被 `replaceNode` 整体写回
 * plan.json，删元素等于悄悄改变这一批的条数。脏数据该由读盘归一（store 的
 * `normalizeNode`）或修复流程处理，不该在一次「通过」里被动蒸发。
 */
function approveItem(item, now) {
  const stamp = typeof now === 'string' && now !== '' ? now : new Date().toISOString()
  if (item === null || typeof item !== 'object') return item
  const kids = Array.isArray(item.children) ? item.children : []
  if (kids.length > 0) {
    return {
      ...item,
      review: true,
      children: kids.map((kid) => {
        // 脏项（null / 字符串）：原样保留，只跳过标记。见上面第 1 条。
        if (kid === null || typeof kid !== 'object') return kid
        return { ...kid, review: true, finishedAt: kid.finishedAt || stamp }
      }),
    }
  }
  return { ...item, review: true, finishedAt: item.finishedAt || stamp }
}

export { approveItem }
