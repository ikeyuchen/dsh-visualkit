# Changelog

本文件记录所有值得注意的变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.0.2] — 2026-11-09

安装文档与工程流程修正，功能与契约不变（`0.0.x`）。

### Changed

- **安装说明重写**：改为「DSH 内按包名安装（推荐）/ 命令行 / 源码」三种方式，对齐同系列插件；顶部加 npm 版本、平台与许可徽章。
- **README 不再写死版本号**：版本以 npm 徽章与 `npm view dsh-visualkit version` 为准，运行时要求指向 `package.json` 的 `engines`，避免每次发版后说明过期。

### Fixed

- **CI 四处修正**：测试脚本改显式 glob（Node 22 不接受目录参数）；ubuntu 作业 `npm ci --force`（根包声明 `os: win32`）；包测试自带 tar 解析（GitHub Windows runner 读不了中文文件名）；渲染类用例只在 win32 跑（无 resvg 绑定、字体校准差异）。
- **发布工作流**：`release.yml` 同样改用 `npm ci --force`，推送 tag 即可自动发布并附带 provenance。

## [0.0.1] — 2026-11-08

首个公开发布版本。

八个工具串成一条工艺链：**取真资产 → 定规格 → 量审美 → 出成品**。同一套原语（配色 / 字体 / 形状 /
图案 / 栅格 / 动效 / 交互态）可以落成 UI 界面、网页、平面图、海报与纯文字版式；工具按「回答什么问题」
分工，场景与输入介质是参数，工具不按介质另起一套。

用法是一条五步链路：体检 → 核实真假 → 机械改 → 人决定 → 复验。`taste_check` 与 `layout_check` 先量出问题，
`icon` / `design_render` 取真资产替代模型编造的内容，`css_edit` / `html_edit` 做机械收敛，改完复测到 `clean`。
分数只在 `ai-tinged` / `ai-default` 提示返工，`clean` 区间建议停止压分（继续优化会把设计推向安全区）。

全部本地离线运行，不需要 Python、Krita、Playwright 或外部工作区。安装：在桌面插件页添加组合包、
把 `target` 填成本仓库根目录，npm 发布后也可用 `dsh plugin add dsh-visualkit`；装好后重启 DSH 生效。
运行环境为 Windows x64、Node ≥22.19、DSH ≥0.2.0-rc.2 <0.3.0；包许可 MIT，
第三方数据与授权逐项见 `THIRD_PARTY.md`。

使用说明与取舍分析在仓库 `docs/`：工作流五步见 `docs/workflow.md`，定位与场景矩阵见 `docs/positioning.md`，
交互层与 CSS 归一化分别见 `docs/interaction-layer.md`、`docs/css-normalization.md`。

### Added
- **`icon`**：检索 lucide 1.70.0（2029 图标 + 289 别名 + 官方 tags + 43 类目）与 tabler 1.2.43（6302 图标），
  支持中英同义词、别名解析、单字符词边界与中文品牌名映射，按五种项目约定出码（`colibri` / `echo` / `dsh-plugin` / `whale` / `raw`）。
- **`icon emit` 的 9 种视觉语言**：`outline` / `hairline` / `bold` / `sharp` / `solid` / `duotone` / `badge` / `knockout` / `gradient`，
  由 `paint` / `strokeWidth` / `caps` / `join` / `container` / `gradient` / `inset` 等正交参数逐项覆盖；`shapes` 每层可独立设渐变，`fill-rule=evenodd` 直接做镂空与环形。
- **`morph`**：形变兼容双层体检（项目契约 + morphicons 2.0.2 引擎：fill 走 region、transform 烘焙、viewBox 自动 re-grid），
  附自包含动效预览页（3 种弹簧预设 + 服务端烘焙 5 帧静帧）。
- **`taste_check taste`**：AI 味 0–100 分与逐条返工指令，21 项指标分 quality / style / content 三层，三档 profile
  （`balanced` / `strict` / `structure`），`.design-intent.json` 声明豁免；输入支持源码目录、单文件与 PNG，位图层走 `img-indigo-hue` / `img-ramp` 两条像素判据。
- **`taste_check audit`**：图标规范巡检（`universal` / `echo` / `colibri` / `auto`），查 emoji 图标、MorphIcon 误用与 ICONS 字典。
- **`layout_check ui`**：排版体检 0–100 分（越低越好），源码规则 `S1`–`S14` 覆盖字号阶梯、最小字号、行高、行长、字体家族、
  对齐、中英混排、中文标点、对比度（WCAG 2 AA/AAA + APCA）、标题跳级、触摸目标、阴影层级、断点一致性、组件状态矩阵与负外边距；`render=true` 在真实渲染像素上量文字对比度。
- **`layout_check svg`**：规则 `G1`–`G9`，直接量成品 SVG 的 `text` 坐标与字号（不需 OCR），
  查层级、行距、安全区、贴边、溢出、文字重叠与基线。
- **`layout_check image`**：规则 `P1`–`P9`，解码 PNG / JPEG / WebP，
  查内容边距、出血、密度、视觉平衡、对齐线索、卡片栅格与列表行高一致性；结果带 `rulesRun` / `measured`，
  能区分「量了且过了」与「什么都没量」。
- **`design_style`**：8 皮肤 × 6 骨架 = 48 组合，输出 `css` / `json` / `tailwind`；每个皮肤自带 4 档字号阶梯（最大跳变 ≥1.6×）
  与分层禁用清单，`tokens` 参数可覆盖颜色 / 圆角 / 边框 / 阴影 / 字体 / 字号档 / 密度与机制层 token（图案 / 任意形状 / 有机圆角 / 双线 / 描边字 / 字距 / 动效档 / 栅格）。
- **`design_style format=motion`**：8 个交互原语（`press` / `lift` / `focus` / `ripple` / `enter` / `stagger` / `reveal` / `shimmer`），
  只走 `[data-motion~="…"]` 属性钩子，产物无条件带 `prefers-reduced-motion` 兜底。
- **`html_edit`**：`scan` 判定命中落在文本节点 / 属性 / 脚本 / 样式 / 注释的哪一处，`rewrite` 按 `scope=text|text+attr|all` 限定范围；
  支持整类扫描（emoji / 直引号 / 中文标点）与「映射缺失」护栏，标记不会漏进属性。
- **`css_edit`**：`scan` / `snap` / `scale` / `leading` / `radius` 五个 action，分别盘点、对齐 4px 网格、归并字号阶梯、归一正文行高、收敛圆角；
  默认只出改动清单（`write=true` 才落盘），注释与字符串里的数字、`var()` / `calc()` / `%` 一律不碰。
- **`design_render render` / `composite`**：SVG→PNG（透明底、等比缩放、`sizes` 多档、六帧 ICO）；
  图层合成支持 `anchor` / `padding` / `fit` / `blend` / `rotate` / `scale` / `canvas`，`under` 可传纯色。
- **`design_render html` / `diff`**：HTML→PNG，自动探测本机 Edge / Chrome / Chromium，`pageScale` 与 `fullPage` 按真实内容高度截图；
  两图差异给出均像素差、分区差、热力图与偏移搜索。
- **`design_render asset`**：221 项内置素材（品牌 / 图标 / 插画 / 角色部件 / 图案 / 贴纸 / 纹理）的检索、内联与改色，
  带目录穿越防护。
- **插件图标**：版面画板标记——画板框 + 标题/副标/正文行 + 选中的图文卡片（日、山）+ 底部色板，玫瑰 / 品红 / 紫三组渐变加琥珀点缀；颜色按对比度校准，图形元素对白底、深底均 ≥ 3:1；对应 UI / 平面设计与排版、文本排版能力；`aria-label` 为「视觉设计工具箱」。
- **运行时健壮性**：vendored resvg 延迟加载——非 win32-x64 平台上其余工具照常可用，只有 SVG 渲染会报出明确的平台说明，而不是一 import 就崩。
- **发布与运行时**：两档常驻 token 预算 3600 / 4200 字符（默认档 / 全量档）；零运行时依赖，resvg-js 2.6.2 以 MPL-2.0
  vendored 到 `vendor/resvg/`（win32-x64 原生绑定），morphicons 2.0.2 走 vendored IIFE；测试用 `node:test` 覆盖契约、渲染、图标、形变、审美、体检、风格、素材与发布边界。
