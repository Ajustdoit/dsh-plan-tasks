# 执行中徽标：转圈居中 + 去掉外边框（id=UpcIC7）

## 一、问题

hover「任务正在执行」时，转圈与外边框没有居中；希望不要外边框。指的就是
执行中的状态徽标：

```jsx
h('span', { className: 'plt-tag running plt-run-only', … }, h(SpinnerIcon, { size: 13 }))
```

## 二、根因（两个，都在同一条规则上）

改前只有这一行：

```css
.plt-tag.plt-run-only{width:26px;height:20px;padding:0;justify-content:center;box-sizing:border-box}
```

### 根因 1：`justify-content` 完全无效

`.plt-tag` **基类没有 `display:flex`**：

```css
.plt-tag{flex:0 0 auto;font-size:14px;padding:0 7px;border-radius:999px;
          line-height:20px;border:1px solid transparent;white-space:nowrap}
```

它是行内 `span`，靠 `line-height` 撑高 —— 文字徽标够用。

但 `justify-content` 对**非 flex 容器无效**。所以那个「水平居中」从未生效，
图标实际是按**行内基线**排的，垂直方向被 `line-height:20px` 的基线余量顶偏
——看起来就是没居中。

**而且没有任何垂直居中的手段**（没有 `align-items`，也没有 flex）。

### 根因 2：边框来自基类

```css
border:1px solid transparent
```

文字徽标需要它：透明边框占位，悬停时才显出轮廓，避免整块跳动。

但这颗徽标只有一个转圈、没有文字，透明边框只会让 13px 的图标在
`24×18` 的内容区里再少 2px，视觉上更偏。

## 三、修复

```css
.plt-tag.plt-run-only{
  display:inline-flex;      /* ← 让 justify/align 真正生效 */
  align-items:center;       /* ← 垂直居中 */
  justify-content:center;   /* 水平居中 */
  width:26px;
  height:20px;
  padding:0;
  border:0;                 /* ← 去掉外边框 */
  box-sizing:border-box;
  line-height:1;            /* ← 行高不再影响垂直居中 */
  vertical-align:middle;    /* ← 行内排版时与相邻文字对齐 */
}
```

## 四、改后几何

| 项 | 值 |
| --- | --- |
| 外框 | `26 × 20` |
| border | **0** |
| padding | 0 |
| 内容区 | `26 × 20`（等于外框）|
| 图标 | `13 × 13` |
| 左右余量 | **6.5px** |
| 上下余量 | **3.5px** |

余量数值不同（26 宽 vs 20 高），但 `justify-content:center` 与
`align-items:center` 会各自在对应方向居中 —— **不再需要等宽高**。

## 五、没有影响文字徽标

| 选择器 | 状态 |
| --- | --- |
| `.plt-tag`（基类）| **仍无 display**，靠 `line-height` 撑高 ✅ |
| `.plt-tag` 的 `border:1px solid transparent` | **保留**（悬停占位）✅ |
| `.plt-tag.type` | 仍是 `inline-flex` ✅ |

改动**只作用于 `.plt-tag.plt-run-only`** 这一个选择器。

## 六、验证（22 条）

不是 grep 规则文本 —— 按 **CSS 层叠**解析最终生效值，再算几何。

### 层叠后的最终声明

```
display: inline-flex
align-items: center
justify-content: center
border: 0
width: 26px
height: 20px
padding: 0
box-sizing: border-box
line-height: 1
vertical-align: middle
```

### 居中三要素

```
display=inline-flex, align=center, justify=center  → 真正居中 ✅
```

### 改前对照

| | 改前 | 改后 |
| --- | --- | --- |
| `display` | 无（行内 span）| `inline-flex` |
| `justify-content` | 设了但**无效** | 有效 |
| `align-items` | 无 | `center` |
| `border` | `1px solid transparent` | `0` |

### 产物同步

构建产物 `assets/plan-tasks.css` 里的规则与源码**逐字一致**。

## 七、一个值得记下的 CSS 陷阱

`justify-content` / `align-items` 这些属性**只在 flex / grid 容器里有效**。

写在别的 `display` 上不会报错、不会警告、样式表照样通过所有检查 ——
**只是静默不生效**。

这个 bug 之所以能存活到现在：

- `node --check` 只看 JS，不看 CSS
- `dead-css` 只查「类有没有被用到」
- `build.mjs --check` 只比对产物与源码是否一致

**没有任何一个检查会问「这条声明在这个上下文里生效吗」。**

> 写样式时若加了 justify/align 却没效果，第一件事是确认父容器是不是 flex。

## 八、部署

- 只改 CSS（`src/styles/02-content.css`）
- 需要 `node build.mjs`（已跑）+ **`Ctrl+F5`**

CSS：536 条规则（数量未变，只是重写了一条）。
