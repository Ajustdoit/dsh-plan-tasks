/**
 * dsh-plan-tasks — Host 半边入口
 *
 * 职责：
 *  1. 提供 `/plan-tasks/api/*` HTTP JSON 路由，供本插件的客户端页签读写
 *     项目根目录下的 `.plan/plan.json`。技能本身以虚拟技能注册到 `ctx.skills`，不落盘。
 *  2. 仅此而已 —— 对话窗口里发出的提示与 `.plan` 完全无关：插件不监听
 *     `session/event`，不会把左侧输入框里的内容追加进 plan.json。
 *     只有「任务列表」面板里自己提交的提示才会写入 `.plan`。
 *
 * 不依赖 dsh-better-sidebar：+ 菜单里的页签注册在 Client 半边完成，
 * 装没装侧边栏插件都不影响这里的文件能力。
 *
 * 本文件只做装配：各领域实现按功能拆在 `lib/host/` 下，依赖方向单向
 *   constants → paths → store → item / skill / snapshot / http / restart / decompose → api → router → index
 * 相对引用全部带 `.js` 后缀，无环（`node scripts/check-imports.mjs` 守着）。
 */
import { createHandler, ROUTE_PATH } from './host/router.js'
import { registerVirtualSkill } from './host/skill.js'
import { repairPlanFile } from './host/repair.js'
import { setRepairHook, writePlan } from './host/store.js'
import { dirname } from 'node:path'

export const inject = ['webServer']

export const name = 'dsh-plan-tasks'

export function apply(ctx) {
  // 技能走平台注册表（虚拟技能，不落盘）：必须在模型下一次取技能目录前完成，
  // 所以放在 apply 的最前面，而不是等第一个 HTTP 请求进来再懒注册。
  registerVirtualSkill(ctx)

  // plan.json 损坏时自动抢救（id=255）：归档原文 → 逐级修复 → 写回，并记一条 warn。
  // 装成钩子而不是写死在 store 里，是因为「记日志」需要 ctx，而 store 必须保持无 ctx 依赖。
  setRepairHook(async (current) => {
    const cwd = dirname(dirname(current.path))
    const report = await repairPlanFile(current.path, current.raw, (items) => writePlan(cwd, items))
    if (report.repaired === true) {
      ctx.logger.warn(
        `plan.json 已自动修复：${report.note}${report.archived === null ? '' : `，原文留档 ${report.archived}`}`,
      )
    } else {
      ctx.logger.error(`plan.json 损坏且无法修复：${report.note}`)
    }
    return report
  })

  // ---- HTTP JSON 路由 ----
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PATH, handler: createHandler(ctx) }),
    'dsh-plan-tasks: /plan-tasks/api routes',
  )
}
