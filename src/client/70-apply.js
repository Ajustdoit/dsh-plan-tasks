    function apply(ctx) {
      // 样式注入（挂到文档头，ctx.effect 负责卸载）。
      ctx.effect(() => {
        const el = document.createElement('style')
        el.setAttribute('data-dsh-plan-tasks', '')
        el.textContent = CSS
        document.head.appendChild(el)
        return () => {
          if (el.parentNode !== null) el.parentNode.removeChild(el)
        }
      }, 'dsh-plan-tasks: styles')

      // betterSidebar 是可选依赖：软注入，未安装时静默跳过。
      ctx.inject(['betterSidebar'], (bsCtx) => {
        const bs = bsCtx.betterSidebar
        if (bs === undefined || typeof bs.registerTab !== 'function') return
        bsCtx.effect(
          () =>
            bs.registerTab({
              id: TAB_ID,
              title: '任务列表',
              description: '读取项目根目录 .plan/plan.json，按计划查看进度、耗时与执行结果',
              order: 40,
              single: true,
              icon: (size) => h(PlanIcon, { size }),
              component: (props) => h(PlanTasksTab, props),
            }),
          'dsh-plan-tasks: 任务列表 tab',
        )
      })
    }

    return {
      // 只声明内核必定提供的服务；betterSidebar 走 apply 内软注入。
      inject: ['slots'],
      apply,
    }
  },
})
