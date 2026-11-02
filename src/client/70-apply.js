    function apply(ctx) {
      // id=79-C：样式注入已从客户端移除。
      // 原先这里用 ctx.effect 在运行时动态创建一个 style 元素、把 CSS 字符串塞进去；
      // 现在样式由宿主以静态资源提供（/plan-tasks/styles.css），
      // 并在 index.html 里注入 <link rel="stylesheet">（见 lib/host/styles.js）。
      // 好处：运行时不再生成任何 <style> 节点，样式可被浏览器当普通 CSS 处理
      // （缓存、CSP、样式覆盖率分析都正常工作），也不必为改一行颜色重建客户端包。

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
