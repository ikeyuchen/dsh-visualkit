# 风格参考：`design_style`

范围：`design_style` 的皮肤与骨架、token 覆盖、机制层输出变量，以及 `format=motion` 的定位。交互原语的变量表与 JS 钩子见[交互层](interaction-layer.md)。

## 皮肤 × 骨架

内置 8 种视觉语言 × 6 种结构配方。对照市面上的风格分类（例如[设计风格术语](https://vibe-hub.org/topics/design)的 24 个条目），8 个 skin 覆盖 8 个直接可用、7 个部分可用，9 个表达不了（扁平、Y2K、Art Deco、有机自然、Material、拟物、新拟态、Memphis、DTC 品牌站）。原因是 `skin` 为封闭枚举，补皮肤只会让清单越来越长；所以加的是描述能力：`tokens` 参数在内置 skin 之上覆盖视觉 token。

皮肤 id：`industrial-editorial`、`tactical-archive`、`retro-archive`、`studio-grid`、`swiss-minimal`、`brutalist`、`quiet-luxe`、`playful-geometric`。骨架 id：`archive-ops`、`narrative`、`dashboard`、`landing`、`document`、`editor`。

```text
design_style skin=swiss-minimal tokens="shadow=none;radius=0;accent=#3B5BDB"   # 扁平
design_style skin=brutalist     tokens="ground=#1A1240;accent=#FF4FB0;radius=18;border=2;shadow=0 0 28px rgba(255,79,176,.45)"  # Y2K
design_style skin=quiet-luxe    tokens='ground=#0E0B08;accent=#C9A227;radius=0;font="Georgia",serif;border=2'  # Art Deco
```

## 可覆盖的 token

`ground / surface / ink / inkSoft / muted / line / accent / ok / warn / danger`、`radius / border / shadow / density`、`font / mono`、`micro / body / head / display`。

尺寸类 token 自动补 `px`（`radius=18` 等价 `18px`），时间类自动补 `ms`（`dur=90` 等价 `90ms`）；`radius` 会派生另两档；未知 token 直接报错并列出可用键。

## 机制层

| 机制 | token | 用途 |
|---|---|---|
| 渐变填充 | `ground` / `surface` 直接写渐变值 | Y2K 金属、拟物、光球 |
| 图案层 | `pattern=repeating-linear-gradient(…)` / `radial-gradient(…)` | 波点、斜纹、网格、装饰纹样 |
| 任意形状 | `clip=polygon(…)` | 斜切角、六边形、箭头 |
| 有机圆角 | `organic=42% 58% 55% 45% / …` | 自然、手作感的 blob |
| 双线边框 | `double=0 0 0 1px c,0 0 0 4px bg,0 0 0 5px c` | Art Deco |
| 描边字 | `stroke=` | 粗野、终端 |
| 字距 / 流体字号 | `tracking=.14em`；`display=clamp(32px,6vw,72px)` | 紧排、杂志 |
| 动效档位 | `dur=180ms;ease=cubic-bezier(…)` | 全局过渡节奏 |
| 栅格配方 | `grid=repeat(4,1fr) / repeat(3,64px)` | Bento 不等宽、杂志图文穿插 |
| 交互态 | `format=motion` + `press/lift/focus/ripple/stagger/reveal/shimmer` | 按压、悬停、焦点、波纹、错峰入场、滚动显现 |

输出为 `--pattern` / `--clip` / `--radius-organic` / `--double-line` / `--text-stroke` / `--tracking` / `--dur` / `--ease` / `--grid` / `--press` / `--lift` / `--focus-ring` / `--ripple` / `--stagger` / `--reveal` / `--shimmer`，由使用方写到 CSS 里消费；`css` 与 `json` 两种格式都带这些钩子。

token 值里的双引号（`font="Microsoft YaHei"`）不能塞进 HTML 内联 `style="…"`：会提前截断属性，使后面所有变量失效，变量应落到 `<style>` 块里。

不覆盖：复杂组件行为（涟漪触发时机、拖拽态）与内容组织（Bento 里哪个格子放什么）。

## `format=motion`

产物是一份可选、按元素挂载的 CSS 原语，不是预设动效包：8 个原语独立，只挑需要的挂；选择器全走 `[data-motion~="…"]` 属性钩子，不占 class 命名空间；时长、缓动、幅度全读变量。产物无条件带 `prefers-reduced-motion` 兜底。

```html
<button data-motion="press lift focus ripple">提交</button>
<ul data-motion="stagger"><li style="--i:0">…</li><li style="--i:1">…</li></ul>
```

变量表、JS 钩子与边界见[交互层详解](interaction-layer.md)。
