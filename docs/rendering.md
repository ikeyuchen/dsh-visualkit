# 渲染与截图：`design_render`

范围：图层合成、软件图标流程、两图差异、HTML 截图，以及这些能力各自的依赖。SVG→PNG 的基础用法见 README 的「快速上手」。

## 图层合成：`action=composite`

由九个维度组合：

| 维度 | 取值 | 作用 |
|---|---|---|
| `anchor` | 9 个方位（`top-left` … `bottom-right`） | 图层放哪里（默认 `center`） |
| `padding` | px | 四边内缩（app 图标安全区） |
| `fit` | `contain` / `cover` / `fill` / `none` | 缩放策略（`fill` 会拉伸，不等比） |
| `scale` | 0.05–8 | 在 `fit` 之后再加一层倍率 |
| `blend` | `normal`/`multiply`/`screen`/`overlay`/`darken`/`lighten`/`difference` | 混合模式 |
| `rotate` | 角度 | 绕图层中心旋转 |
| `canvas` | `[宽, 高]` | 显式画布尺寸 |
| `under` | 路径或纯色 `#RRGGBB` | 底可以是颜色，不用先做一张底图 |
| `opacity` | 0–1 | 图层透明度 |

例：`design_render action=composite under=#F5F5F0 canvas=[512,512] over=icon.png anchor=center padding=48 out=app.png ico=true sizes=[256,128,64]`。

产出会回填 `anchor` / `fit` / `padding` / `rotate` / `blend` / `opacity` 与图层实际几何（`layer.{x,y,width,height}`），能确认参数真的生效。

**软件图标**：`composite` 三步出一个 1024 圆角图标——`under` 传内联 SVG（圆角矩形 `rx` ≈ 22% 边长加渐变或纯色）；`over` 传 `icon emit target=raw` 的 SVG；`scale` 取 0.5–0.6；`out` 定 `app-1024.png`。多尺寸与 Windows 图标一次出全套：`sizes=[1024,512,192,180,32] ico=true`。

产出 `<名字>-<尺寸>.png`（从合成 SVG 重渲染，不是缩 PNG）与 `<名字>.ico`（16/32/48/64/128/256 六帧内嵌 PNG，Windows 10/11 原生支持）。没有 .icns、Android adaptive 分层、PWA maskable 校验，需要请自行转。

## 两图差异：`action=diff`

`base=orig.png compare=mine.png out=heat.png slices=7 align=true`：返回均像素差、分区差、热力图 PNG。`align=true` 额外做偏移搜索，区分「排错了」与「整块平移了几像素」。

## HTML → PNG：`action=html`

`html=page.html out=shot.png width=1280 height=764 pageScale=2 fullPage=true`。很多桌面应用的界面本身是 web 版，不能渲染 HTML 就看不到自己的输出。

`fullPage` 分两趟：先 `--dump-dom` 让页面把 `scrollHeight` 写进 title 读回内容高，再用 `--window-size=W,内容高` 截第二趟。返回值带 `pixelWidth` / `pixelHeight`，直接从 PNG 的 IHDR 读实测像素。

静态解析 CSS 算不出真实对比度时的补救（`layout_check action=ui render=true`）见[排版规则](layout-rules.md)。

## 依赖

| 能力 | 依赖 |
|---|---|
| SVG → PNG、图层合成、素材库 | 完全自包含（vendored resvg，零外部进程） |
| HTML → PNG | 本机 Chromium 系浏览器（Edge / Chrome / Chromium），自动探测 |
| JPEG / WebP 图片输入（`taste_check taste`、`layout_check image`） | 同上：先由浏览器转成同尺寸 PNG，再走内置解码器 |

不写自研布局引擎：浏览器引擎才是唯一可信的参照。探测不到时明确报错并给出下一步（装浏览器 / 配 `browserPath` / 改用 `action=render`），不静默回退。没有浏览器的机器上，其余工具一切正常。
