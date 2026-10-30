
    /**
     * 页签图标：蓝色清单 + 勾选。
     * 网格换成 16×16 并画满 1..15（原来 64 网格里只占 81%，14px 下看着比
     * 「任务管理」「文件」这些内置 codicon 小一圈），现在同样 size 下视觉尺寸对齐。
     *
     * 底色不用 --dsw-alias-brand-primary：alias 层会被主题包改写，装了
     * dsh-official-homepage-theme 之后它变成 #f3f8ff（近白），白底 + 白勾
     * 就糊成一坨白。改用 static 层 --dsw-static-deepseek-500（#4176e6）并写死
     * 兜底色，保证任何主题下都是明显的蓝底白字。
     */
    function PlanIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 14
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          role: 'img',
          'aria-label': '任务列表',
          style: {
            display: 'block',
            flex: '0 0 auto',
            color: ICON_BLUE,
          },
        },
        h('rect', {
          x: 1,
          y: 1,
          width: 14,
          height: 14,
          rx: 3.2,
          fill: 'currentColor',
        }),
        h('path', {
          d: 'M3.6 6l1.2 1.2 2.1-2.45',
          fill: 'none',
          stroke: '#fff',
          strokeWidth: 1.35,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M3.6 10.45l1.2 1.2 2.1-2.45',
          fill: 'none',
          stroke: '#fff',
          strokeWidth: 1.35,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          opacity: 0.72,
        }),
        h('path', {
          d: 'M8.4 5.6h4.1M8.4 10.05h4.1',
          fill: 'none',
          stroke: '#fff',
          strokeWidth: 1.35,
          strokeLinecap: 'round',
          opacity: 0.92,
        }),
      )
    }

    /** 发送按钮图标：向上的箭头（Cursor 风格发送键）。 */
    function SendIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 15
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          role: 'img',
          'aria-label': '提交',
          style: { display: 'block' },
        },
        h('path', {
          d: 'M12 19V5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2.4,
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M5.5 11.5L12 5l6.5 6.5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /** 草稿按钮图标：一页带折角的文档（草稿 = 存下来还没用的文稿）。 */
    function DraftIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 15
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          role: 'img',
          'aria-label': '草稿',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { display: 'block' },
        },
        h('path', { d: 'M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z' }),
        h('path', { d: 'M13 3v6h6' }),
        h('path', { d: 'M9 13h6M9 17h4' }),
      )
    }

    /** 深入按钮图标：三条横线（层层深入）+ 一条向下的箭头穿过它们。 */
    function DeepIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 15
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          role: 'img',
          'aria-label': '深入',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { display: 'block' },
        },
        h('path', { d: 'M4 7h16' }),
        h('path', { d: 'M6.5 12h11' }),
        h('path', { d: 'M9 17h6' }),
        h('path', { d: 'M12 4.5v7.5' }),
        h('path', { d: 'M9.6 9.6L12 12l2.4-2.4' }),
      )
    }

    /** 拆解按钮图标：一个方块向下分出三条支线，像把一件事拆成几条。 */
    function SplitIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 15
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          role: 'img',
          'aria-label': '拆解',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { display: 'block' },
        },
        h('path', { d: 'M12 3v4' }),
        h('path', { d: 'M12 7H5.5v3.2' }),
        h('path', { d: 'M12 7h6.5v3.2' }),
        h('path', { d: 'M12 7v3.2' }),
        h('rect', { x: '3', y: '10.2', width: '5', height: '4.2', rx: '1.2' }),
        h('rect', { x: '9.5', y: '10.2', width: '5', height: '4.2', rx: '1.2' }),
        h('rect', { x: '16', y: '10.2', width: '5', height: '4.2', rx: '1.2' }),
        h('path', { d: 'M5.5 14.4v2.4M12 14.4v2.4M18.5 14.4v2.4' }),
      )
    }

    /** 任务类型胶囊里的小图标：仅回答=对话气泡，目标=靶心，修改=铅笔。 */
    function ModeIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 12
      const kind = props?.kind ?? '目标'
      const common = {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.9,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        style: { display: 'block' },
      }
      if (kind === '仅回答') {
        // 对话气泡 + 里面的点
        return h(
          'svg',
          common,
          h('path', { d: 'M20 12.5a7.5 7.5 0 0 1-7.5 7.5H7l-3.5 2.2V12.5A7.5 7.5 0 0 1 11 5h1.5A7.5 7.5 0 0 1 20 12.5z' }),
          h('path', { d: 'M9 12h.01M12.5 12h.01M16 12h.01' }),
        )
      }
      if (kind === '修改') {
        // 铅笔
        return h(
          'svg',
          common,
          h('path', { d: 'M4 20h4.2L20.1 8.1a2.1 2.1 0 0 0 0-3L19 4a2.1 2.1 0 0 0-3 0L4.1 15.9 4 20z' }),
          h('path', { d: 'M14.5 5.5l4 4' }),
        )
      }
      // 目标：靶心
      return h(
        'svg',
        common,
        h('circle', { cx: 12, cy: 12, r: 8.2 }),
        h('circle', { cx: 12, cy: 12, r: 4.4 }),
        h('circle', { cx: 12, cy: 12, r: 1.1, fill: 'currentColor', stroke: 'none' }),
      )
    }

    /** 修改图标（铅笔，跟类型胶囊里的「修改」图标同款）。 */
    function EditIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 12
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.9,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          style: { display: 'block' },
        },
        h('path', { d: 'M4 20h4.2L20.1 8.1a2.1 2.1 0 0 0 0-3L19 4a2.1 2.1 0 0 0-3 0L4.1 15.9 4 20z' }),
        h('path', { d: 'M14.5 5.5l4 4' }),
      )
    }

    /** 空组里的占位图标：虚线条目框 + 中间一道横线，跟列表图形一个家族。 */
    function EmptyIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 22
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          style: { display: 'block' },
        },
        h('rect', { x: 3.2, y: 4.6, width: 17.6, height: 14.8, rx: 3, strokeDasharray: '3 2.6' }),
        h('path', { d: 'M8 10.5h8M8 14h5' }),
      )
    }

    /** 线段风格的展开箭头（不用实心三角形）。 */
    function CaretIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 12
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          style: { display: 'block' },
        },
        h('path', { d: 'M9 5.5 15.5 12 9 18.5' }),
      )
    }

    /** 复制图标：两张叠在一起的纸，和常见编辑器一致。 */
    function CopyIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 12
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          style: { display: 'block', flex: '0 0 auto' },
        },
        h('rect', { x: 9, y: 9, width: 12, height: 12, rx: 2.4 }),
        h('path', { d: 'M5.6 15H4.4A2.4 2.4 0 0 1 2 12.6V4.4A2.4 2.4 0 0 1 4.4 2h8.2A2.4 2.4 0 0 1 15 4.4v1.2' }),
      )
    }

    /**
     * 垃圾桶图标（id=353）：待执行条目操作区里的「删除这一条」。
     *
     * 线稿风格与 CopyIcon / PinTopIcon 一脉相承（viewBox 24、stroke 2、圆角端点），
     * 颜色走 currentColor —— 深色主题下不需要单独换色，浅色主题由 .plt-actions 的颜色决定。
     * 尺寸默认 13（与相邻按钮的文字行高 20px 视觉齐平），不参与基线对齐。
     */
    function TrashIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 13
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          style: { display: 'block', flex: '0 0 auto' },
        },
        // 桶盖：顶盖 + 提手
        h('path', { d: 'M4 6.5h16' }),
        h('path', { d: 'M9.5 6.5V4.6a1.1 1.1 0 0 1 1.1-1.1h2.8a1.1 1.1 0 0 1 1.1 1.1v1.9' }),
        // 桶身：上宽下窄的梯形
        h('path', { d: 'M6.2 6.5l1 13.1a1.6 1.6 0 0 0 1.6 1.4h6.4a1.6 1.6 0 0 0 1.6-1.4l1-13.1' }),
        // 两道竖纹
        h('path', { d: 'M10.2 10.4v7' }),
        h('path', { d: 'M13.8 10.4v7' }),
      )
    }

    /** 置顶图标：一根竖线 + 向上的箭头，表示「排到最前面」。 */
    function PinTopIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 12
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          style: { display: 'block', flex: '0 0 auto' },
        },
        h('path', { d: 'M12 19V6' }),
        h('path', { d: 'M6.5 11.5 12 6l5.5 5.5' }),
        h('path', { d: 'M5 3.4h14' }),
      )
    }

    /**
     * 执行中用的转圈图标：一段圆弧匀速旋转，比文字更直观。
     *
     * 只保留「一直转」这一种形态：顶栏那颗手点「刷新」的按钮连同它的
     * spinning / idle 状态类已经移除（id=357），而它是唯一需要「由外层决定何时转」
     * 的调用点。留着 `spin` 参数只会是一个没人传的开关，读代码的人还得猜它什么时候会被用上。
     */
    function SpinnerIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 12
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2.6,
          strokeLinecap: 'round',
          'aria-hidden': 'true',
          className: 'plt-spin',
          style: { display: 'block', flex: '0 0 auto' },
        },
        h('path', { d: 'M12 3.2a8.8 8.8 0 1 1-8.8 8.8', opacity: 0.95 }),
      )
    }

    /**
     * 「开始」按钮的实心三角（id=207）：顶栏里与文字并排，沿用 SpinnerIcon 的约定 ——
     * 尺寸默认 12、颜色走 currentColor、display:block 不参与基线对齐。
     * 与其余图标唯一的差别是实心（fill）而不是线稿，14px 字号下这个形状更认得出。
     */
    function PlayIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 12
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'currentColor',
          stroke: 'none',
          'aria-hidden': 'true',
          style: { display: 'block', flex: '0 0 auto' },
        },
        h('path', { d: 'M8.5 4.8v14.4L20 12z' }),
      )
    }

    /**
     * 「暂停」按钮的两条竖线（id=207）：与 PlayIcon 配成一对，线稿风格与其余图标一致。
     * strokeWidth 取 3.2 —— 12px 下两根细线用 2.6 会糊成一坨，这个值刚好能分辨出两条。
     */
    function PauseIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 12
      return h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 3.2,
          strokeLinecap: 'round',
          'aria-hidden': 'true',
          style: { display: 'block', flex: '0 0 auto' },
        },
        h('path', { d: 'M9 5v14' }),
        h('path', { d: 'M15 5v14' }),
      )
    }
