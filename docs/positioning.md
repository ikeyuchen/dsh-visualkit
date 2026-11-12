# 定位：视觉设计工具箱

范围：插件定位、命名依据、场景组合、原语清单与能力边界。

## 命名依据

| 候选 | 词义覆盖 | 天然排除 | 用户会期待什么 |
|---|---|---|---|
| **美术**设计 | 造型、作图、物料制作 | 偏「手上功夫」与教学语境 | 一个画图工具 |
| **艺术**设计 | 最宽（延伸到观念、表演） | 强调创作与原创表达 | 一个产出创意的工具 |
| **视觉**设计 | 一切「看得见的设计产出」 | 非视觉门类（声音、叙事、流程） | 一个把视觉产出做完并验好的工具 |

- 「美术设计」会被当成画图工具。本包不生成图：图标是检索得到的资产，渲染只把已有内容落成像素。
- 「艺术设计」暗含观念与原创，与「风格由使用者组合」的立场不符。
- 「视觉设计」与能力边界逐项对齐，代价是最通用、品牌区分度最弱。
- 英文名 Visual Design Toolkit，包 id 固定 `dsh-visualkit`。发版后改名会断引用、破坏已安装用户。

## 命名轴：按「回答什么问题」取舍

场景（UI 界面、网页、平面、海报、排版）与输入介质（源码、矢量、位图）都是参数。工具名只回答它能替你回答什么问题。

`layout_check`、`design_style`、`design_render`、`icon`、`morph` 都已是问题导向。`taste_check` 不带 `ui_` 前缀：`ui_` 会把海报与图片排除在外，而「像不像 AI」对它们同样成立。`taste_check taste` 收源码，也收一张位图（PNG / JPEG / WebP）。同一个问题换输入介质，是入口多一种介质，不是多一个工具。每多一个工具都是每请求常驻 token。

新增能力的落位规则：

- 新问题 → 新工具（像不像 AI、排版对不对、用什么手段、出什么成品）。
- 新场景或新输入介质 → 现有工具的参数（位图、SVG、HTML）。
- 只服务单一场景的工具名 → 改名。

## 一份框架，多个场景

风格是同一个，落地的交付物不是。工具链按场景换组合，底层原语不变。

| 场景 | 工具组合 | 交付物 | 硬约束 |
|---|---|---|---|
| **UI 设计**（软件界面） | `design_style` → `icon` → `design_render html` → `layout_check ui` | token 表、组件骨架、界面截图 | 交互态齐全、字号梯级、信息密度 |
| **网页设计** | `design_style` → `design_render html`（`fullPage`） → `layout_check ui` | 页面截图、断点行为 | 首屏层级、渲染对比度、响应式不塌 |
| **平面设计**（封面、图形） | `design_render render`（多尺寸、ICO） → `asset` → `composite` | 成品位图、矢量 | 边距、密度、视觉重心 |
| **海报设计** | `icon emit`（`raw`） → `design_render render` → `layout_check svg` | 成品 SVG、PNG | 文字几何（层级、行距、边距、溢出）、缩放后仍可读 |
| **文本类排版** | `design_style` → `layout_check svg/ui` | 版式规格（字号、行高、行长、对齐） | 行长、行高与字距落在可读区间 |
| **交互与动效** | `design_style format=motion` → `morph` | 交互原语层 CSS、形变预览 | 状态反馈、`:focus-visible` 可达、`prefers-reduced-motion` 兜底 |
| **已有产出的体检** | `taste_check taste` → `layout_check` | AI 味分数、排版分数、返工清单 | 成熟产品的分数低于模板页 |

## 原语清单

风格在实现层面拆开只有这 8 类原语：

| 原语 | 表达式 | 载体 |
|---|---|---|
| 色彩 | 颜色 token，值可以是任意 CSS（含渐变） | `design_style` |
| 字体与字号 | 字号阶梯、字体栈、`tracking` 字距 | `design_style` |
| 圆角与边线 | `radius`、`border`、`double`（双线）、`organic`（有机圆角） | `design_style` |
| 形状与图案 | `clip`（`polygon()` 或任意 `clip-path`）、`pattern`（`repeating-*-gradient` 拼波点、斜纹、网格） | `design_style` |
| 栅格 | `grid`：等宽、不等宽、杂志穿插 | `design_style` |
| 动效 | `dur`、`ease`，以及 `enter`、`stagger`、`reveal`、`shimmer`、`ripple` 原语 | `design_style format=motion` |
| 交互态 | `press`、`lift`、`focus` 三态，`:focus-visible` 可达 | `design_style format=motion` |
| 素材 | 2029 lucide + 6302 tabler 图标、221 项内置素材 | `icon`、`design_render asset` |

原语只有这 8 类；组件行为、内容组织、品牌资产不属于原语，归项目规范，不由工具决定。

## 有意不做的事

| 不做 | 原因 |
|---|---|
| 风格目录 | 目录一旦存在就会被当成模板，换项目即失效 |
| 组件库成品代码 | 每个项目的组件约定不同，交付成品即负债；只给 token 与结构配方 |
| 项目管理、需求拆解 | 与插件职责无关 |
| 联网取图、云模型 | 全部本地离线 |

## 新增能力的判断

三个问题全部答「是」才加：①换项目、换场景后还有用吗（原语 vs 一次性）；②提供的是手段还是结果（成品风格不算手段）；③能不能被验收（`layout_check`、`taste_check` 量得出来，或有明确的通过标准）。
