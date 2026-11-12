# 排版规则：`layout_check`

范围：三套模式（`ui` / `svg` / `image`）的规则集与阈值、应用外壳分档、声明豁免，以及从截图反推版式的 `profile` 与真实渲染对比度。AI 味评分见[AI 味](ai-look.md)。

三类输入、同一把尺（0–100，越低越好；error 15 / warn 6 / info 2 扣分，与 `taste_check taste` 同口径）：

| 模式 | 输入 | 自动检测 | 不覆盖 |
|---|---|---|---|
| `ui` | HTML/CSS/Vue/JSX 源码 | 字号梯级与最小字号、行高比例、行长、字体家族数量、对齐、字距、中英混排空格 | 真实渲染后的换行与断句 |
| `svg` | 成品 SVG（海报/卡片/banner/信息图） | 文字层级、行距、安全区与贴边、溢出画布、文字重叠、对齐关系、最小字号（含 viewBox 缩放换算） | 字体回退后的真实字形宽度（用字符宽度模型估算） |
| `image` | 渲染后的 PNG（JPEG / WebP 需本机浏览器转码） | 内容边距与出血、密度、左右上下视觉平衡、对齐线索、分辨率 | 文字内容与对比度（无 OCR） |

`svg` 模式不需要 OCR：SVG 里本来就有 `text` 的坐标与字号，直接量真实几何；`image` 模式补「只有图没有源」的场景。三者产物结构一致（score/grade/counts/findings/metrics），可直接当门禁（如 `score < 35` 才允许交付）。

## 规则集

| 模式 | 规则 |
|---|---|
| `ui` | `S0`（无样本或无解析到 font-size，info）、`S1`–`S14` 字号梯级/最小字号（字号×字重）/行高/行长/字体数/对齐/字距/混排/标题层级/混排基线/阴影层级/响应式断点/组件状态矩阵/负外边距 · `punct-*` 12 条中文标点 · `contrast-*` 对比度 · `structure-heading-*` 标题跳级 · `structure-touch-*` 触摸目标 |
| `svg` | `G1`–`G9` 安全区/层级/行距/行长/溢出/重叠/对齐/最小字号/留白 · `contrast-*` · `structure-baseline-*` 基线网格 |
| `image` | `P1`–`P9` 贴边/边距对称/密度/平衡/对齐/分辨率/无 OCR 声明/卡片栅格一致性/列表行高一致性 |

## 应用外壳分档

桌面与 Web 应用的「工具栏 + 栏位」界面与文档、落地页对排版的要求不同，同一套尺子量会误报。检测到应用外壳后自动分档：

| 规则 | 文档页 | 应用外壳 |
|---|---|---|
| `S1` 字号梯级 | 最大/正文 < 1.6 → error | 降为 info（梯级偏平，仅作参考） |
| `S9` 标题层级 | h3/正文 < 1.25 → error | 降为 info（组件标题不靠字号分层级） |
| `S4` 行长 | 算 `max-width` 与根宽 | 根选择器只认 `max-width` |
| `structure-heading-first` | 文档 + 非外壳 + ≥3 个标题才判 | 不判 |

外壳判据（两条同时成立）：① 根元素满高（`height:100%` / `100vh`）或 `overflow:hidden`；② 存在 `display:flex/grid` 的布局容器。分档效果：某在线文档产品参照稿 56 → 24；Flow-Pilot（Electron 应用）66 → 27。

## 重点规则的阈值

| 规则 | 判据 / 阈值 |
|---|---|
| `S14` 负外边距 | `margin` 取负即报：用于把两块内容硬拉近会破坏间距层级 |
| `S13` 组件状态矩阵 | 有 `hover` 没 `focus` → warn（WCAG 2.4.7 AA）；组件间状态覆盖差 ≥2 → info；`active`/`disabled` 缺失不单独判 |
| `S12` 响应式断点 | 同方向差 ≤3px → warn；`max-width: X` 与 `min-width: X` 并存 → warn；两方向各 ≥2 档 → info；767 配 768 的标准互补对不报 |
| `S11` 阴影层级 | 光源方向不一致 → error；>4 档 → warn；相邻档位倍数 <1.3 → warn |
| `S10` 混排字号基线 | 阈值 1.8×；22px 大字标 + 16px 标签居中不报；典型场景如 5.42 GiB（72px 数字 + 20px 单位） |
| `S2` 字号 × 字重 | 有效字号 = 字号 × 字重系数（400→1.0 / 500→1.1 / 600+→1.2）；有效 <11 报 error、<13 报 warn |

`punct-*` 的分类参考 [typography-audit](https://github.com/mblode/agent-skills) 的 78 条规则；对比度（WCAG 2 + APCA）与基线网格来自 [typography-skills](https://github.com/thomasguillot/typography-skills)；标题顺序与触摸目标来自 [layout-lint-mcp](https://github.com/LOsioChico/layout-lint-mcp)；覆盖度必须声明来自 [breaklint](https://github.com/godarg/breaklint)。业界常见做法是用 Playwright 量计算样式，本工具零外部进程：源码项解析声明，产物项读 SVG 真实坐标，文字宽度靠 95 字 advance 表（与 HarfBuzz 差 0.02%）。

## 覆盖度与声明豁免

报告带 `rulesRun`（实际跑了几条规则）与 `measured`（测了什么）。`score` 为 clean 但 `rulesRun: 0` 意味着什么都没测。

与 `taste_check taste` 同一套语义，一个项目只需一份 `.design-intent.json`，有意偏离时写声明而不是跳过规则：

```json
{ "allow": ["S9", "structure-heading-first"], "reason": "h5/h6 未做组件映射，有意收敛到正文大小" }
```

`allow` 里的规则不计分、不进 `findings`，而是进 `metrics.exempted` 与报告的 `intent` 段。`ui` 从扫描根目录读，`svg` 从 `.svg` 文件所在目录读。

**两个体检工具的分工**：`taste_check` 管审美、风格、文案；`layout_check` 管排版。两边都提到字号，结论口径一致（都是「最大字号 / 正文」比 1.6），且 `taste_check` 的对应项把更细的 `file:line` 明细指向 `layout_check`。

## 渲染对比度：`ui` + `render=true`

静态解析 CSS 遇到 `rgba()`、CSS 变量、渐变背景时算不出真实对比度，只能跳过。`layout_check action=ui root=page.html render=true width=760 height=420` 在真实像素上量。

原理：同一页面渲两遍（A 正常；B 用 `*{color:transparent!important}` 把文字染透明，布局不变）→ A/B 差异大的像素是文字墨迹 → 连通域分组，域内最墨像素给文字色，同位置 B 渲染给真实背景 → 按文字色去重逐种配色报对比度。三条实现约束：不能取最小对比度像素（必然落在抗锯齿边缘）、不能按颜色聚类（边缘中间调自成一簇）、必须关 LCD 子像素渲染（彩边）。

渐变底加半透明白卡上的输出形如：

```text
[error] contrast-effective 实际渲染对比度不足：2.52:1 —— 文字 rgb(138,143,168)
        压在真实背景 rgb(75,58,185) 上（42px 墨迹）
```

同一页面上白字 9.42:1、深灰字 5.79:1 正确不报，与静态计算一致。

## 从截图反推版式：`image` 的 `profile`

| 字段 | 含义 |
|---|---|
| `palette` | 主色板 top 6 + 面积占比 |
| `columns` | 栏位与卡片的水平范围（自动排除版心间隙） |
| `rowPitch` | 行节奏，附样本数 |
| `cards` / `cardGrid` | 卡片矩形与栅格：每张卡片的 (x,y,w,h)、列起点、列间距、行间距 |
| `vEdges` | 栏位垂直分界线（x 坐标），办公与客户端界面靠它分栏最稳 |
| `list` | 列表和表格行距及一致性：`pitch`、`count`、`uniformPct`、`outliers` |

两种布局各用一套判据，坏的那个自动不显示：大底色加规整栏位看 `columns` + `vEdges`；卡片栅格或渐变背景看 `cards` + `cardGrid`；表格与列表密集看 `list`。卡片阈值必须相对页面底色算：`#F6F7F9` 三通道都 ≥246，固定 246 会把整页底当卡片、连通成 2072×1414。
