# 变量继承链验证（id=2-B / 分组 2）

## 一、样本选择

| 角色 | 变量 | 控制台表现 |
| --- | --- | --- |
| 被报未定义 | `--plt-todo-fg` | DevTools 报 `is not defined` |
| 对照组 | `--plt-todo` | 未被报错 |

## 二、定义位置（真实行号）

| 变量 | 文件:行 | 作用域选择器 | 值 |
| --- | --- | --- | --- |
| `--plt-todo-fg` | `01-base.css:149` | `.plt-root` | `187,247,208` |
| `--plt-todo-fg` | `01-base.css:185` | `body:not([data-ds-dark-theme]) .plt-root` | `20,83,45` |
| `--plt-todo` | `01-base.css:148` | `.plt-root` | `46,160,67` |
| `--plt-todo` | `01-base.css:184` | `body:not([data-ds-dark-theme]) .plt-root` | `22,101,52` |

**关键事实：两个变量定义在同一块、相邻两行（148/149 与 184/185），作用域完全相同。**
静态上没有任何理由一个能用一个不能用。

## 三、继承链逐层（DevTools computed 等价）

DOM 层级从渲染代码还原：

```
html
  body[data-ds-dark-theme]              ← 深色档判定依据
    #root / 宿主容器
      div.plt-root                       ← ★ 变量在这里定义
        div.plt-list
          div.plt-group.plt-group-todo
            div.plt-group-h
              span.plt-group-name        ← 消费 var(--plt-todo-fg)
```

每层的自定义属性可见性（沿树向下继承，子不自动向上）：

| 层级 | `--plt-todo-fg` |
| --- | --- |
| `html` | 无 |
| `body` | 无 |
| `div.plt-root` | **有**（定义处） |
| `div.plt-list` | 继承到 ✓ |
| `div.plt-group-todo` | 继承到 ✓ |
| `div.plt-group-h` | 继承到 ✓ |
| `span.plt-group-name` | 继承到 ✓ ← 消费点 |

变量在 `.plt-root` 这一层**还有**，向下每一层都**没有消失**。

## 四、注入路径：三条隔离路径全部排除

| 检查项 | 结论 | 证据 |
| --- | --- | --- |
| 注入方式 | **全局 document 样式** | `lib/host/styles.js`：`kind:'html'` + `placement:'head'` |
| Shadow DOM | **无** | `src/client/*.js`、`lib/*.js` 中无 `attachShadow` / `shadowRoot` |
| iframe | **无** | 无 `createElement('iframe')` / `contentWindow` |
| `cordis.patch.yml` mount 容器 | **无** | 只有 `insert:` 注册插件，无容器 / 无样式作用域 |

注入产物是 `<link rel="stylesheet" href="/plan-tasks/styles.css">`，
落在 `document.head` —— 与 `.plt-root` 在同一个文档、同一条继承链。

## 五、服务端实际下发的内容（排除产物缺失）

直接抓取 `http://127.0.0.1:8848/plan-tasks/styles.css`：

```
大小 197492 字节
--plt-todo-fg:  2 处
--plt-todo:     2 处
.plt-root      18 处
```

被报"未定义"的变量，在服务端实际下发的 CSS 里**有 2 处定义**。

## 六、判定

| 情形 | 结论 |
| --- | --- |
| A. **根本没定义** | ✗ 不成立 —— 定义 2 处，且服务端确实下发了 |
| B. **定义了但没继承到消费点** | ✗ 静态链路不成立 —— 继承链完整，`.plt-root` 是消费点的祖先 |

**两种情形都不成立。**

两个样本变量同块相邻定义、消费点同在一个继承链上、无 Shadow/iframe 隔离、
服务端下发的 CSS 里也确实有定义 —— 静态链路上找不到任何能让
`--plt-todo-fg` 单独失效的原因。

### 因此唯一自洽的解释

报错来自**旧的已加载样式表**，而不是当前磁盘上的这份 CSS：

- 浏览器缓存了旧版本 `styles.css`；
- 或页面在某次中间状态加载后没有硬刷新；
- 或报错是更早一次加载留下的（DevTools Issues 会累积）。

## 七、下一步建议（2-C 起）

**不要**在 `.plt-root` 或 `:root` 上补 `--plt-todo-fg` —— 那条定义已经在了，
再补也只是重复声明，不会改变任何计算值。

要验证就做这一件事：**硬刷新（Ctrl+Shift+R）后再看 DevTools Issues**，
若报错消失即证明是缓存；若仍在，则说明页面加载的 CSS 与我们抓到的这份不是同一份，
届时再查 `<link>` 的 `href` 与实际加载内容。

## 八、本次分析的两处工具坑

1. **注释替换抹掉了换行** —— `m => ' '.repeat(m.length)` 会把多行注释压成一行，
   导致行号从 148 偏到 37。正确做法：`m => m.replace(/[^\n]/g, ' ')`。
2. **规则起始行 vs 声明行** —— 解析器记录 `{` 所在行（125），
   但变量实际在块内的 148 行。两者都对，报告时要说明口径。
