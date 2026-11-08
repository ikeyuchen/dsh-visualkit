# 交互层：`design_style format=motion`

视觉层回答"长什么样"，交互层回答"碰它的时候发生什么"。两份产物读同一份 token：`format=css` 给静态规格，`format=motion` 给状态与过渡。

```
design_style skin=swiss-minimal tokens="dur=90;press=scale(.9)" format=motion
```

## 8 个原语

**产物是原语 + 变量，不是预设动效包**：动效风格的差别只在取值——Material 涟漪 = 波纹原语 + 原点跟随指针 + 200ms；苹果回弹 = 同一个 `press` 换弹簧曲线、时长更短；粗野硬切 = 同一个过渡把 `dur` 归零；杂志淡入 = 入场原语 + 更大的 `reveal` 位移 + 更慢的 `t-slow`。挂哪个原语、挂给哪个元素、什么时序由使用者决定，里面没有任何一条"某某风格"的规则。

选择器一律走属性钩子 `[data-motion~="…"]`，**不占用使用者的 class 命名空间**（否则别人自己的 `.press` / `.lift` 会被无声覆盖）。可以一次挂多个：

```html
<button data-motion="press lift focus ripple">提交</button>
<ul data-motion="stagger"><li style="--i:0">…</li><li style="--i:1">…</li></ul>
<p data-motion="reveal">滚动到才出现</p>
```

| 原语 | 作用 | 关键实现 |
|---|---|---|
| `press` | 按压反馈 | `:active` → `transform: var(--press)` |
| `lift` | 悬停抬升 | `:hover` → `var(--lift)`；`:active` 归零（抬起来又被按下去才自然） |
| `focus` | 键盘焦点环 | `:focus-visible` + `outline`（不占布局）。不用 `:focus`，否则鼠标点击也弹环 |
| `ripple` | 波纹 | `clip-path: circle()` 自 `--mx/--my` 扩张，不依赖元素尺寸；无 JS 时落在中心 |
| `enter` | 单元素入场 | `artkit-enter` 关键帧（位移 `--reveal` + 淡入） |
| `stagger` | 列表错峰 | 容器挂，子元素读 `--i` 序号 × `--stagger` |
| `reveal` | 滚动显现 | 初始 `opacity:0`，加 `.is-in` 才播 |
| `shimmer` | 骨架屏扫光 | 背景层渐变扫过，不动文字 |

## 变量（改这一块就够）

| 变量 | 默认 | 说明 |
|---|---|---|
| `--dur` | `160ms` | 基准时长。写 `dur=90` 自动补 `ms` |
| `--ease` | `cubic-bezier(.4,0,.2,1)` | 缓动曲线，任意 CSS 时序函数 |
| `--t-fast` / `--t-base` / `--t-slow` | `calc(--dur × .6 / 1 / 1.6)` | 由基准推出的三档，避免满文件硬编码；时长不在原语之内，所有原语共用 |
| `--press` / `--lift` | `scale(.96)` / `translateY(-2px)` | 按压变换 / 悬停位移 |
| `--focus-ring` / `--focus-offset` | `2px solid var(--c-accent, currentColor)` / 外扩 `2px` | 焦点环。用 `outline` 而非 `box-shadow`，否则会被 `overflow:hidden` 裁掉 |
| `--ripple` | `currentColor` | 波纹色 |
| `--stagger` | `40ms` | 错峰步长（`stagger=25` 自动补 `ms`） |
| `--reveal` | `12px` | 入场位移距离 |
| `--shimmer` | `rgb(255 255 255 / .28)` | 扫光高光色 |

## 两段需要 JS 的钩子

CSS 拿不到指针坐标，也拿不到元素可见性：

```js
// 波纹原点：从按下的位置扩散，而不是永远从中心
el.onpointerdown = (e) => { const r = el.getBoundingClientRect(); el.style.setProperty("--mx", `${e.clientX - r.left}px`); el.style.setProperty("--my", `${e.clientY - r.top}px`); };
// 滚动显现：进入视口才加 .is-in
new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add("is-in")), { threshold: 0.15 }).observe(el);
```

`ripple` 的 `:active` 分支在松手时会中断动画；要"按完整一帧再消失"，改用 JS 加 `.is-rippling` 类（产物里已备好该分支）。

## 无障碍兜底：`prefers-reduced-motion`

产物末尾无条件带这段，不是可选项：

```css
@media (prefers-reduced-motion: reduce) {
  [data-motion], [data-motion]::after, [data-motion] > * { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
  [data-motion~="reveal"] { opacity: 1; }   /* 否则内容永久不可见 */
  [data-motion~="shimmer"] { animation: none; }
}
```

`reveal` 那条最容易漏：原语默认 `opacity: 0`，兜底不补回来，前庭敏感用户看到的是空白页。

## 边界

能做：状态反馈、入场/显现、错峰、骨架屏、焦点可达；时序与幅度全可调；与 `format=css` 共用一份 token。不做：手势（拖拽/长按/滑块，属组件行为）、视差、物理引擎、复杂编排（需要完整动画库）、页面转场（依赖路由框架）。要做这类就引动画库，本插件不重复造。无障碍兜底不可关闭。
