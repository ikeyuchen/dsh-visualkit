# dsh-visualkit

[![npm](https://img.shields.io/npm/v/dsh-visualkit)](https://www.npmjs.com/package/dsh-visualkit) [![platform](https://img.shields.io/badge/platform-Windows%20x64-lightgrey)](#安装) [![license](https://img.shields.io/npm/l/dsh-visualkit)](LICENSE)

**视觉设计工具箱**：把「好看」变成可执行、可验收的东西。

> 模型不缺产能，缺美术判断：它做出的界面能跑但难看——字号没有层级、间距靠手调、图标用 emoji、配色是紫渐变。`dsh-visualkit` 提供一条工艺链：**取真资产 → 定规格 → 量审美 → 出成品**，全部本地离线，不依赖任何系统软件。

**先看怎么用**：[工作流：从「看着还行」到「可以验收」](https://github.com/ikeyuchen/dsh-visualkit/blob/main/docs/workflow.md)——五步链路（体检 → 核实真假 → 机械改 → 人决定 → 复验）。

**工具和框架，不是风格目录**：同一套原语（配色 / 字体 / 形状 / 图案 / 栅格 / 动效 / 交互态）可以落成 UI 界面、网页、平面图、海报或纯文字版式；「苹果风」在这五个场景里是同一个风格，区别只在取哪几个工具、交什么。→ [定位与场景矩阵](https://github.com/ikeyuchen/dsh-visualkit/blob/main/docs/positioning.md)

`dsh-visualkit` — Art toolkit for AI-generated UIs and graphics: icon sourcing, SVG morphing, AI-look scoring, style specs, local rendering.

| 项 | 值 |
|---|---|
| 包名 / 仓库 | `dsh-visualkit` |
| 最新版本 | 见顶部 npm 徽章，或 `npm view dsh-visualkit version` |
| 许可 | MIT |
| 外部依赖 | **无**（resvg 已 vendored，不需要 Python / Krita / Playwright / 外部工作区） |

## 八个工具

| 工具 | action | 作用 |
|---|---|---|
| `icon` | `find` / `emit` | 检索 lucide 2029（含官方 tags + 43 类目）+ tabler 6302，中英同义词；按项目约定出码（colibri / echo / dsh-plugin / whale / raw），`style` 有 9 种预设 |
| `morph` | `check` / `preview` | 形变兼容双层体检（项目契约 + morphicons 2.0.2 引擎）；自包含动效预览页 |
| `taste_check` | `taste` / `audit` | `taste`：AI 味 0–100 分 + 返工指令（**21 项指标**分 quality/style/content 三层，含**成组出现**判断），输入可以是源码目录/单文件，**也可以是一张 PNG**（位图层走像素判据）；`audit`：图标规范巡检（emoji 禁令 / MorphIcon 误用 / ICONS 字典） |
| `layout_check` | `ui` / `svg` / `image` | 排版体检（0–100 分，越低越好）：`ui` 扫 HTML/CSS 字体系统/行高/行长/对齐；`svg` 量成品 SVG 的真实文字几何（层级/行距/边距/重叠/溢出）；`image` 量渲染图的构图（边距/密度/平衡/对齐；PNG / JPEG / WebP 直读） |
| `design_style` | —（用 `format=css / json / tailwind / motion`） | 8 皮肤 × 6 骨架 = 48 组合：token + 结构配方 + 分层禁用清单；`motion` 出交互原语层 |
| `html_edit` | `scan` / `rewrite` | 上下文感知的 HTML 改写：先判定命中在**文本节点 / 属性 / 脚本 / 注释**的哪一处，再决定改不改——标记不会漏进属性里被当文本显示 |
| `css_edit` | `scan` / `snap` / `scale` / `leading` / `radius` | 机械收敛：间距对 4px 网格、字号归阶梯、行高归一、圆角收敛；**默认只出改动清单不写盘**，注释/字符串/var/calc/% 一律不碰 |
| `design_render` | `render` / `composite` / `asset` / `html` / `diff` | `render`：SVG→PNG（透明底、可缩放、多尺寸/ICO）；`composite`：图层合成（scale/多尺寸/ICO）；`asset`：221 项内置素材检索 / 内联 / 改色；`html`：HTML→PNG；`diff`：两图差异与热力图 |

## 安装

**方式一：DSH 内安装（推荐）**

1. 打开 DSH →「插件」→「添加插件」
2. 输入包名 `dsh-visualkit`，安装源保持「npm 官方源」
3. 点「安装」，装好后重启 DSH 生效

**方式二：命令行（同样走 npm）**

```bash
dsh plugin add dsh-visualkit
```

> 想试测试版：`dsh plugin add dsh-visualkit@beta`（npm 的 `beta` 通道，不影响正式版；随时用 `@latest` 切回）。

**方式三：源码**（开发或未发布版本）

```bash
git clone https://github.com/ikeyuchen/dsh-visualkit.git
dsh plugin --profile web add ./dsh-visualkit
```

运行环境：Windows x64、Node 与 DSH 版本要求见 `package.json` 的 `engines` / `os` / `cpu`。
改本地代码后只需触发一次 profile 重组合，不必重装。

### 按需加载：`toolsetProfile`

低频工具默认不进上下文，默认 `standard` 装 6 个高频工具：

| 档位 | 工具 | 常驻 |
|---|---|---|
| `minimal` | icon, design_render | **2398 字符 ≈ 600 token** |
| `standard`（默认） | + taste_check, layout_check, html_edit, css_edit | **3583 字符 ≈ 896 token** |
| `all` | + morph, design_style | 4138 字符 ≈ 1035 token |

分档依据是使用链路：整套项目开发里 `design_style` 调用 0 次、`morph` 只做几次体检，而 icon / design_render / layout_check / taste_check 一直在用。非法档位值响亮报错，不静默回落；提示段只列当前 scope 真看得到的工具，降档或宿主侧再做工具限制时不会指向不存在的东西。

## 它解决什么

模型的默认输出会塌缩到训练分布的众数：紫蓝渐变、`rounded-xl`、毛玻璃、`Inter`、12/13/14/15 碎字号、emoji 图标、三段式 hero。这条链把审美拆成三段：

1. **事前约束** —— `design_style` 给 token（1 个强调色家族 / 4 档字号且 ≥1.6× 跳变 / 4px 网格 / 圆角 ≤8 / ≤1 层中性阴影）+ 结构配方 + 禁用清单
2. **事中取真** —— `icon` 取真 SVG、`design_render asset` 取真素材，替代模型编造
3. **事后量化** —— `taste_check taste` 打 0–100 分并给**具体改法**，改完复测直到 `clean`；`layout_check` 把排版单独量化：源码看字体系统，成品看文字几何与构图（全自动、不需 OCR）

同一检测器、同一业务内容的分数：

| 样本 | 分数 | 等级 |
|---|---:|---|
| 模型无约束的典型输出 | 75 | ai-default |
| 按 `design_style` 规则重写 | 5 | clean |
| 第三方 AI 生成的插件 UI | 54 | ai-default |

**规则与检测同源**：`lib/rules.js` 一份定义同时供约束文案与检测器，避免约束改了检测没改、验收标准打架。**分数口径**：只在 `ai-tinged` / `ai-default` 提示返工；`clean` 区间输出「stop optimizing here」——继续压分只会把设计推向安全区（Goodhart）。分数不可跨 `profile` 比较。

## 风格：给框架，不给目录

`design_style` 内置 8 种视觉语言 × 6 种结构配方。对照市面上的风格分类（例如 [设计风格术语](https://vibe-hub.org/topics/design) 的 24 个条目），8 个 skin 覆盖 **8 个直接可用 + 7 个部分可用，还有 9 个表达不了**——扁平、Y2K、Art Deco、有机自然、Material、拟物、新拟态、Memphis、DTC 品牌站。根因是 `skin` 为封闭枚举，补皮肤只会让清单越来越长；所以加的是描述能力：`tokens` 参数在内置 skin 之上覆盖视觉 token。

```text
design_style skin=swiss-minimal tokens="shadow=none;radius=0;accent=#3B5BDB"   # 扁平
design_style skin=brutalist     tokens="ground=#1A1240;accent=#FF4FB0;radius=18;border=2;shadow=0 0 28px rgba(255,79,176,.45)"  # Y2K
design_style skin=quiet-luxe    tokens='ground=#0E0B08;accent=#C9A227;radius=0;font="Georgia",serif;border=2'  # Art Deco
```

可覆盖的键：`ground / surface / ink / inkSoft / muted / line / accent / ok / warn / danger`、`radius / border / shadow / density`、`font / mono`、`micro / body / head / display`。尺寸类 token 自动补 `px`（`radius=18` 等价 `18px`）、时间类自动补 `ms`（`dur=90` 等价 `90ms`）；`radius` 会派生另两档，避免只改主档导致档位混用；未知 token 直接报错并列出可用键。

### 机制层：补的是手段，不是风格

| 机制 | token | 用途 |
|---|---|---|
| 渐变填充 | `ground` / `surface` 直接写渐变值 | Y2K 金属、拟物、苹果官网、光球 |
| 图案层 | `pattern=repeating-linear-gradient(…)` / `radial-gradient(…)` | 波点、斜纹、网格、装饰纹样 |
| 任意形状 | `clip=polygon(…)` | 斜切角、六边形、箭头 |
| 有机圆角 | `organic=42% 58% 55% 45% / …` | 自然/手作感的 blob |
| 双线边框 | `double=0 0 0 1px c,0 0 0 4px bg,0 0 0 5px c` | Art Deco |
| 描边字 | `stroke=` | 粗野、终端 |
| 字距 / 流体字号 | `tracking=.14em`；`display=clamp(32px,6vw,72px)` | 苹果紧排、杂志 |
| 动效档位 | `dur=180ms;ease=cubic-bezier(…)` | 全局过渡节奏 |
| 栅格配方 | `grid=repeat(4,1fr) / repeat(3,64px)` | Bento 不等宽、杂志图文穿插 |
| 交互态 | `format=motion` + `press/lift/focus/ripple/stagger/reveal/shimmer` | 按压、悬停、焦点、波纹、错峰入场、滚动显现 |

输出为 `--pattern` / `--clip` / `--radius-organic` / `--double-line` / `--text-stroke` / `--tracking` / `--dur` / `--ease` / `--grid` / `--press` / `--lift` / `--focus-ring` / `--ripple` / `--stagger` / `--reveal` / `--shimmer`，由使用方写到 CSS 里消费；`css` 与 `json` 两种格式都带这些钩子。token 值里的双引号（`font="Microsoft YaHei"`）不能塞进 HTML 内联 `style="…"`：会提前截断属性，后面所有变量失效——变量应落到 `<style>` 块里（`#p0{…}`）。覆盖：配色、圆角、字体、边框、阴影、字号档、密度、语气，以及渐变 / 图案 / 形状 / 双线 / 字距 / 动效节奏 / 栅格比例。不覆盖：复杂组件行为（涟漪的触发时机、拖拽态）与内容组织（Bento 里哪个格子放什么）——机制层决定「用哪种手段」，不决定「长什么样」。

### 交互层：`format=motion`

产物是一份可选、按元素挂载的 CSS 原语，不是预设动效包：八个原语独立，只挑需要的挂；选择器全走 `[data-motion~="…"]` 属性钩子，不占 class 命名空间；时长/缓动/幅度全读变量，换项目只改 `:root`。

```html
<button data-motion="press lift focus ripple">提交</button>
<ul data-motion="stagger"><li style="--i:0">…</li><li style="--i:1">…</li></ul>
```

| 原语 | 作用 |
|---|---|
| `press` / `lift` | 按压贴合 / 悬停抬升（`:active` 归零） |
| `focus` | 只需 `:focus-visible`，鼠标点击不弹环 |
| `ripple` | 波纹，`clip-path` 自 `--mx/--my` 扩张，不依赖元素尺寸 |
| `enter` / `stagger` | 单元素入场 / 列表错峰（子元素读 `--i`） |
| `reveal` / `shimmer` | 滚动显现（`.is-in`）/ 骨架屏扫光 |

红线：产物无条件带 `prefers-reduced-motion` 兜底，且把 `reveal` 的 `opacity` 补回可见，否则前庭敏感用户看到的是空白页。这是无障碍底线，不可关闭。→ [交互层详解](https://github.com/ikeyuchen/dsh-visualkit/blob/main/docs/interaction-layer.md)

### CSS 层能机械到哪一步

判断线：**能机械化的只有「同一维度上的取值收敛」**；跨维度取舍（配色取向、层级策略、组件形态、阴影方向）工具只该报，不该改。完整取舍分析见 [css-normalization](https://github.com/ikeyuchen/dsh-visualkit/blob/main/docs/css-normalization.md)。

| action | 收敛什么 | 保留不动 |
|---|---|---|
| `snap` | `margin/padding/gap` → 4px 网格 | 0.5/1/2px（描边与微调）、负值只调幅度不改方向、裸 `0` |
| `scale` | `font-size` → 给定阶梯 | 平局取**大**的那档（往小缩会让中文变糊） |
| `leading` | `line-height` → `1.5 / 1.6 / 1.8` | 标题级一律不动（紧凑行高是正确做法）、`<1.2` / `>2.2` / `px` / `var` |
| `radius` | `border-radius` → `2 / 4 / 8 / 12` | `50%`（圆）/ `0` / `≥100px`（胶囊）/ 单角属性 / 多值简写 |

硬性约束：注释与字符串里的数字不动 · `var()/calc()/%/em/rem/auto` 不碰 · 幂等（归一过的再跑改动数为 0）· **默认 dry-run**，`write=true` 才落盘。校准口径：行高规则从 4 个项目的 **78 处**真实声明里选型，最终「标题不动 + 正文死区抬到 1.5 + ≥1.5 就近归并」让 S3 从 10 处降到 **2 处**；圆角在令牌化率 ≥50% 的项目上直接拒绝——三个现代项目的散落 px 只有 9 / 0 / 1 处，而 `var()` 有 119 / 34 / 7 处。完整数据见 [css-normalization](https://github.com/ikeyuchen/dsh-visualkit/blob/main/docs/css-normalization.md)。

## AI 味：成组出现才是指纹

风格识别口径参考 [AI 味儿图鉴](https://vibe-hub.org/anti-ai-flavor)：中文口癖 11 条、页面模板感 8 条、不好用的交互 6 条，每条给原例与改法。`taste_check taste` 的 21 项指标覆盖其中多数视觉项（紫渐变 / 居中大标题 / emoji 图标 / 圆角阴影 / 玻璃拟态 / 渐变文字 / 文案口癖），另补六条页面与交互项：

| 规则 | 判据 |
|---|---|
| `nest-boxes` 框里再套框 | 三层以上圆角容器链（两层是正常的卡片 + 内部区块） |
| `divider-sprawl` 分割线泛滥 | ≥8 处 1px border-top/bottom 或 `<hr>`（表格/列表用线是正常设计） |
| `big-black-tight` 又大又黑又挤 | 同一条规则里 ≥30px + 字重 ≥700 + 行高 ≤1.25 |
| `dead-button` 按钮没结果 | ≥2 个 `<button>` 无 submit / 点击绑定 / data-action |
| `icon-tile-uniform` 图标色块一律 | ≥3 个同类图标块，且 CSS 里宽高 32–64px、圆角 ≥12px、背景是渐变（三项取交集） |
| `eyebrow-spam` 小标签逐段开场 | ≥4 个 eyebrow/kicker 类小标签；0–1 个是正常编辑手法，不报 |

判断原则：单个词、视觉元素或交互问题不能证明作者；看它是否与其他默认选择**成组出现**。单看每条都不致命，命中三项以上，用户就会想「这是 AI 做的」。

### 位图层：手里只有一张图时也能判

`taste` 收 `.png` 时换一套像素层判据（自带解码器，零外部进程）：

| 判据 | 量什么 |
|---|---|
| `img-indigo-hue` 紫蓝相主导 | 有色像素里落在 238–300° 的比例（下界不降到 210–235：那是真实产品最常用的蓝） |
| `img-ramp` 大面积平滑渐变 | 3×3 区域里有多少是**一维线性渐变**（单方向平滑 + 正交方向等色带） |

另有一项只量不判（进 `raw.cardGrid`，不计分）：`count` / `maxPerRow` / `equalWidth`。26 张「AI 制作的 UI 界面」截图里只有 1 张是模板长相（紫蓝渐变营销页，52 分），其余 25 张得 0——0 不代表没问题，是像素层看不见字号、间距、图标成套性、文案套路与交互态。

两条像素判据只给事实、不判分：同构三卡片（25 张合格界面里有 6 张满足，计分就是 6/25 误报）；中轴对称（三种量法都不成立——逐像素镜像被纯色背景抬到 86–91%，只比边缘像素时谁都归零，左右平衡 AI 0.98 / 某视频站 0.95 / 某安全软件 0.96，差距 0.03）。合格产出上像素层分不出 AI 与人，所以结果固定带 `scope:` 与 `blind spots:` 两行：**0 分 ≠ 这张没问题，更 ≠ 这不是 AI 做的**。

三条纪律，每条都由误报校准：

| 纪律 | 为什么 |
|---|---|
| 只数**风格指纹**，不数通用质量缺陷 | 桌面应用本来就有 6 档小字号、7 个语义色；算进组合会把成熟产品判成模板（某在线文档产品的参照稿被判最强指纹，但它 24 分 acceptable，自相矛盾） |
| 只数**分值 ≥40** 的项 | 单个 emoji（20 分）属于零星迹象，凑进三项就是噪音 |
| 措辞只说**风格风险**，不指认作者 | 「像套模板」≠「这是 AI 做的」，后者不可证 |

刻意没做的三项：单字动作（收一下 / 提一层）要看词性；同一件事换名字要跨文件对齐；每处都加描述小字要 DOM 语义——都需要语义理解，规则做不准。

## 数据与许可

| 数据 | 内容 | 许可 |
|---|---|---|
| `data/lucide-icons.json` | lucide 1.70.0：2029 图标 + 289 别名 + 官方 tags + 43 类目（0.9 MB） | ISC |
| `data/packs/tabler.icons.json` | tabler 1.2.43 / iconSet 3.50：6302 图标（2.0 MB） | MIT |
| `data/assets/` | 221 项素材（品牌 12 / 图标 81 / 插画 42 / 角色部件 45 / 图案 12 / 贴纸 26 / 纹理 3，5.8 MB） | 逐项见 `manifest.json` |
| `vendor/morphicons*.iife.js` | morphicons 2.0.2（104 KB） | MIT |
| `vendor/resvg/` | resvg-js 2.6.2 JS 层 + win32-x64 原生绑定（4.4 MB） | MPL-2.0 |

simple-icons（3740 品牌）没有随包：它让体积从 11 MB 涨到 16 MB，而 `data/assets/icons/brands` 已覆盖 12 个常用品牌。

## 图标与图形

### 9 种风格预设

| style | 视觉语言 | 适合 | 16px 可读 |
|---|---|---|---|
| `outline`（默认） | 2px 线性，Feather/Lucide 基线 | 通用 UI | ✅ |
| `hairline` | 1px 细线，编辑/奢侈品观感 | 大尺寸、高档版面 | ❌ 太细 |
| `bold` | 2.8px 粗线 | 强调、图标按钮 | ✅ |
| `sharp` | butt/miter 尖角端点 | 直线型图标（+ − × ✓ 箭头） | ✅ |
| `solid` | 填充版（tabler `-filled`） | **小尺寸最清楚**、选中态 | ✅✅ |
| `duotone` | 20% 填充 + 线稿 | 中层装饰、功能入口 | ⚠️ 双色淡 |
| `badge` | 圆角方块底色 + 反白字形 | SaaS 功能入口、设置项 | ✅ |
| `knockout` | 正圆底色 + 反白字形 | app icon 语言、头像位 | ✅✅ |
| `gradient` | 渐变描边（`color` 起色，末色自动导） | 营销位、大尺寸展示 | ⚠️ |

**像素级差异**（同一 heart，96px 画布，与 `outline` 对比）：`badge` 74% · `knockout` 61% · `solid`/`duotone` 43% · `hairline` 14% · `bold` 12% · `gradient` 6% · **`sharp` 0%**。`sharp` 只改线端与拐角，曲线封闭字形（heart/bell）本就没有可见端点，0% 是正确行为；直线型图标（menu/plus/x）有 7–11% 差异。其他能力：`strokeWidth` 1–64 任意字重（tabler 数据里 path 自带 stroke-width 会覆盖根层，已剥离；`emit strokeWidth=1.5`）；tabler `brand-*` 411 个品牌 logo（含微信/淘宝/github，商标仅供平台指示用途；`icon find "微信"`）；两态形变（线性 ↔ 填充、菜单 ↔ 关闭）由 morphicons 2.0.2 承担（含 region 填充形变，`morph check/preview icons: [...]`）。多色/渐变字形本体不支持，渐变只能作用于描边，需要时用 `design_render` 叠图层。

`badge`/`knockout` 用 `color` 作底色、`color2` 作字形色；`colibri`/`echo` 两个项目约定表达不了容器与渐变，会**明说退化**而不是默默无效。`icon find` 会顺手标注可选版本（如 `可选 filled/duotone 版`），做 hover/active 两态时直接取对应名字。尺寸 16–48px 都用同一套 24 网格数据矢量缩放，16px 下仍可辨认。

### 正交维度：风格由参数拼出

| 维度 | 取值 | 作用 |
|---|---|---|
| `paint` | `stroke` / `fill` / `both` | 绘法（`both` = 填充 + 描边两层） |
| `strokeWidth` | 0–64 | 描边粗细 |
| `caps` | `round` / `butt` / `square` | 线端（`join` 自动配对） |
| `join` | `round` / `miter` / `bevel` | 显式转角 |
| `container` | `none` / `rounded` / `circle` / `squircle` | 字形装进底色（`none` 去掉预设容器） |
| `radius` | 0–12 | 容器圆角（squircle 时是曲率） |
| `inset` | 0–0.45 | 字形在容器里的留白 |
| `gradient` | `none` / `linear` / `radial` | 渐变类型 |
| `gradientAngle` | 0–360 | 渐变方向 |
| `duoOpacity` | 0–1 | 双色底层不透明度（需填充孪生体） |
| `color` / `color2` | 任意色值 | 主色 / 渐变末色或容器内字形色 |

`style` 的 9 个名字只是预设起点，真正的视觉语言由下列正交维度组合而成，任何维度参数传了就以它为准、覆盖预设。降级会说出口：填充字形上给 `strokeWidth` 会返回 note 明说「不生效」。渐变 id 按内容哈希唯一（`ak-g-<hash>`），同一页面内联多个渐变图标不串色。

### 文字、渐变与 `stops`

`text` 给了就**取代字形**（不是叠在上面）：用文字当图形，7-Zip 的「方块 + 7z」、字母徽章「K」、字母组合「AI / PDF」都是这一类；内容 1–4 字符，给了就可以不给 `name`。`textSize` 是 24 网格单位字号，不给则按字数自动适配安全区。

自动字号按「可用宽度 ÷ 字数 ÷ 0.62」估算，所以 `K` 会比 `PDF` 大：14.13 / 11.61 / 9.29。居中用 `dominant-baseline="central"`：resvg 下 cy 落在 11.93（目标 12），`middle` 会偏到 11.13。文字能与阴影 / 渐变 / 中孔（`shapes`）叠加；内容做 XML 转义，不破坏 SVG 结构。`stops` 数组，每项 `color` 或 `color@offset`（0–1，对齐 SVG 的 `offset`）：

```text
3 段          stops: ["#FF0000", "#FFFF00@0.5", "#00FF00"]
彩虹 6 色      stops: ["#FF0000","#FF9900","#FFFF00","#00CC00","#0066FF","#9900FF"]   ← 未写偏移自动均分
径向 4 段      gradient: radial, stops: ["#FFF","#FFD6A5@0.35","#FF6B6B@0.7","#4B1D3F"]
锐变分界       stops: ["#111","#111@0.5","#EEE@0.5","#EEE"]      ← 同偏移两色
```

不传 `stops` 时走 `color`/`color2` 两色路径（末色可自动推导），完全向后兼容；传了 `stops` 就以它为准，且颜色不再限制 hex（`rgba()`、命名色都行）。没有 `spreadMethod`：渐变向量总铺满整个 24 网格盒子，一次循环覆盖全部，pad/repeat/reflect 像素采样相同；条纹用多停靠点 + 同偏移锐变更精确。

### 自绘、`shapes` 与深度图元

`path` 参数直接吃原始 SVG path 数据（24 网格坐标）：`icon emit path="M12 2 L22 12 L12 22 L2 12 Z" paint=fill color="#E8620C"`。`shapes` 的每一层也可以只给 `path`（此时不需要 `name`）：

```jsonc
shapes: [
  { path: "M2 20 L9 8 L13 14 L16 10 L22 20 Z", color: "#FBBF24" },   // 山
  { path: "M5.5 6 m-2.5 0 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0 Z", color: "#FDE68A" },  // 日
  { path: "M2 17 C5 14 8 20 11 17 C14 14 17 20 20 17", color: "#38BDF8", weight: 1.2 }   // 水
]
```

自绘路径会被包成与库图标同构的节点，容器 / 渐变 / 阴影 / 遮罩减法 / 旋转 / 逐层线宽全部照旧生效。一条路径画环 / 镂空：`d` 里写多个子路径，加 `fillRule: "evenodd"` 就是「外套内挖」，例如环 `path="M12 2 a10 10 0 1 0 .01 0 Z M12 7 a5 5 0 1 0 .01 0 Z" fillRule=evenodd`（三孔板、花窗同法）。resvg 下外圆 + 内圆同向时 `nonzero` 中心 α=255（实心）、`evenodd` 中心 α=0（挖空），已写成像素级测试。

**安全**：path 数据直接进 `d="..."`，引号或尖括号能破出属性注入标签，所以走白名单校验（只允许 `MmLlHhVvCcSsQqTtAa` + 数字 + `. , - + e E` + 空白），必须以 `M`/`m` 开头，上限 4000 字符。非法整条丢弃，不静默截断。

`shapes` 是对象数组，每个元素是一个独立图层：

| 字段 | 取值 | 作用 |
|---|---|---|
| `name` | 库内图标名（必填） | — |
| `scale` | 0.02–4，相对 24 网格中心 | 整体缩放 |
| `dx` / `dy` | 偏移（网格单位，y 向上为负） | 中孔要靠它避开中心字形，否则永远被盖住 |
| `rotate` | 绕自身中心旋转的度数 | 场景组合（歪的树、斜飞的鸟）；菱形孔只能靠旋转方孔 45° 做出来 |
| `color` | 该层独立颜色（`rgba()` / 命名色均可） | 异色角标不必绕成「容器当底」 |
| `stops` | 该层独立渐变：`["#FFD848","#FF7A30@0.5","#E01D5E"]` | 品牌美术几乎每层都有自己的渐变（Firefox 火焰 5 层全带渐变） |
| `gradient` | `linear`（默认）/ `radial` | 径向做球体、光晕；线性做金属、渐变条 |
| `angle` | 该层渐变角度 0–360 | 渐变方向 |
| `weight` | 该层独立线宽 0.1–12 | 插画靠「粗轮廓 + 细细节」拉层次，全图一个线宽只能得图标 |
| `subtract` | `true` = 从整个合成里挖掉（`<mask>`） | 环 / 吊牌孔 / 斜切角 / 镂空 |

未写的字段走默认值；写了但越界（如 `scale: 99`）整条丢弃，不静默夹到边界。`subtract` 不作用于文字——文字画在 mask 之外。每层渐变用 `objectBoundingBox` 坐标，自动适配该层包围盒，不用手算绝对坐标。

深度与虚线只给图元，不提供「微拟物」「液态玻璃」这些风格名：

| 参数 | 适用 | 作用 |
|---|---|---|
| `shadow` | `icon emit` / `composite` | CSS box-shadow 语法：逗号 = 多阴影，`inset` = 内阴影，颜色任意 |
| `dash` | `icon emit` | `stroke-dasharray`（数组，按 24 网格单位） |

`shadow` 沿用 CSS 语法：模型对这套写法已经很熟，不用学新格式——双光源微拟物写 `4px 4px 8px #A3B1C6, -4px -4px 8px #FFFFFF`，内阴影写 `inset 0 3px 6px rgba(0,0,0,.4)`，高程体系写 `0 1px 2px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.2)`，技术图虚线写 `dash: [4, 2]`。

resvg 约束（写进代码注释）：`feDropShadow` 无效 → 外阴影改用「模糊的偏移副本」；`feMorphology`（spread）无效 → `shadow` 的第 4 个数值目前忽略；位图图层用 `feGaussianBlur(SourceAlpha) + feFlood + feComposite` 把 alpha 染成阴影色。

### 图层合成

`design_render action=composite` 由九个维度组合：

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

产出会回填 `anchor` / `fit` / `padding` / `rotate` / `blend` / `opacity` 与图层的实际几何（`layer.{x,y,width,height}`），能确认参数真的生效。

**软件图标（app icon）**：`composite` 三步出一个 1024 圆角图标：`under` 传内联 SVG（圆角矩形 `rx` ≈ 22% 边长 + 渐变/纯色）；`over` 传 `icon emit target=raw` 的 SVG；`scale` = 0.5–0.6（主流 app 图标的安全区内缩），`out` = `app-1024.png`。多尺寸与 Windows 图标一次出全套：`sizes=[1024,512,192,180,32] ico=true`。

产出 `<名字>-<尺寸>.png`（从合成 SVG 重渲染，不是缩 PNG）+ `<名字>.ico`（16/32/48/64/128/256 六帧内嵌 PNG，Windows 10/11 原生支持）。没有 .icns / Android adaptive 分层 / PWA maskable 校验，需要请自行转。

## 排版检测（layout_check）

三类输入、同一把尺（0–100，越低越好；error 15 / warn 6 / info 2 扣分，与 `taste_check taste` 同口径）：

| 模式 | 输入 | 自动检测 | 不覆盖 |
|---|---|---|---|
| `ui` | HTML/CSS/Vue/JSX 源码 | 字号梯级与最小字号、行高比例、行长（measure）、字体家族数量、对齐（justify/长段居中）、字距、中英混排空格 | 真实渲染后的换行与断句 |
| `svg` | 成品 SVG（海报/卡片/banner/信息图） | 文字层级、行距、安全区/贴边、溢出画布、文字重叠、对齐关系、最小字号（含 viewBox 缩放换算） | 字体回退后的真实字形宽度（用字符宽度模型估算） |
| `image` | 渲染后的 PNG | 内容边距/出血、密度、左右上下视觉平衡、对齐线索、分辨率 | 文字内容与对比度（无 OCR） |

`svg` 模式不需要 OCR——SVG 里本来就有 `text` 的坐标与字号，直接量真实几何；`image` 模式补「只有图没有源」的场景。三者产物结构一致（score/grade/counts/findings/metrics），可直接在流水线里当门禁（如 `score < 35` 才允许交付）。规则集（每条 finding 都带 `rule` + 定位 + 实测值 + `fix`）：

| 模式 | 规则 |
|---|---|
| `ui` | `S1`–`S14` 字号梯级/最小字号（字号×字重）/行高/行长/字体数/对齐/字距/混排/标题层级/混排基线/阴影层级/响应式断点/组件状态矩阵/**负外边距** · `punct-*` 12 条中文标点 · `contrast-*` 对比度 · `structure-heading-*` 标题跳级 · `structure-touch-*` 触摸目标 |
| `svg` | `G1`–`G9` 安全区/层级/行距/行长/溢出/重叠/对齐/最小字号/留白 · `contrast-*` · `structure-baseline-*` 基线网格 |
| `image` | `P1`–`P9` 贴边/边距对称/密度/平衡/对齐/分辨率/无 OCR 声明/卡片栅格一致性/列表行高一致性 |

**应用外壳分档（S1 / S9 / S4 / heading-first）**：桌面/Web 应用的「工具栏 + 栏位」界面与文档/落地页对排版的要求不同，同一套尺子量会误报。检测到应用外壳后自动分档：

| 规则 | 文档页 | 应用外壳 |
|---|---|---|
| `S1` 字号梯级 | 最大/正文 < 1.6 → **error** | 降为 info（梯级偏平，仅作参考） |
| `S9` 标题层级 | h3/正文 < 1.25 → **error** | 降为 info（组件标题不靠字号分层级） |
| `S4` 行长 | 算 `max-width` 与根宽 | 根选择器只认 `max-width`（`body{width:1366px}` 是视口不是阅读栏） |
| `structure-heading-first` | 文档 + 非外壳 + ≥3 个标题才判 | 不判 |

外壳判据（两条同时成立）：① 根元素满高（`height:100%` / `100vh`）或 `overflow:hidden`；② 存在 `display:flex/grid` 的布局容器。分档效果：某在线文档产品参照稿（无豁免）**56 → 24**；Flow-Pilot（Electron 应用）**66 → 27**。重点规则的阈值：

| 规则 | 判据 / 阈值 |
|---|---|
| `S14` 负外边距 | `margin` 取负即报：用于把两块内容硬拉近会破坏间距层级（块间距 < 块内间距），换主题/字号就崩 |
| `S13` 组件状态矩阵 | 有 `hover` 没 `focus` → warn（WCAG 2.4.7 AA）；组件间状态覆盖差 ≥2 → info；`active`/`disabled` 缺失不单独判 |
| `S12` 响应式断点 | 同方向差 ≤3px → warn；`max-width: X` 与 `min-width: X` 并存 → warn；两方向各 ≥2 档 → info；767 配 768 的标准互补对不报 |
| `S11` 阴影层级 | 光源方向不一致 → error；>4 档 → warn；相邻档位倍数 <1.3 → warn |
| `S10` 混排字号基线 | 阈值 1.8×；22px 大字标 + 16px 标签（1.375×）居中不报；典型场景如 5.42 GiB（72px 数字 + 20px 单位） |
| `S2` 字号 × 字重 | 有效字号 = 字号 × 字重系数（400→1.0 / 500→1.1 / 600+→1.2）；有效 <11 报 error、<13 报 warn。12px/400 仅 **5.5%** 笔画像素实心（94.5% 是半透明灰），12px/600 为 **29.3%** |

`punct-*` 的分类参考 [typography-audit](https://github.com/mblode/agent-skills) 的 78 条规则；对比度（WCAG 2 + APCA）与基线网格来自 [typography-skills](https://github.com/thomasguillot/typography-skills)；标题顺序与触摸目标来自 [layout-lint-mcp](https://github.com/LOsioChico/layout-lint-mcp)；「覆盖度必须声明」来自 [breaklint](https://github.com/godarg/breaklint)。业界主流靠 Playwright 量计算样式，本工具零外部进程：源码项解析声明，产物项读 SVG 真实坐标，文字宽度靠 95 字 advance 表（与 HarfBuzz 差 0.02%）。

**覆盖度**：报告里带 `rulesRun`（实际跑了几条规则）与 `measured`（测了什么）。`score` 为 clean 但 `rulesRun: 0` 意味着什么都没测，不要当成排版没问题。**声明豁免**：与 `taste_check taste` 同一套语义，一个项目只需一份 `.design-intent.json`；有意偏离规则时写下来，而不是跳过规则：

```json
{ "allow": ["S9", "structure-heading-first"], "reason": "h5/h6 未做组件映射，有意收敛到正文大小" }
```

`allow` 里的规则不计分、不进 `findings`，而是进 `metrics.exempted` 与报告的 `intent` 段（带 `reason`）。`ui` 从扫描根目录读，`svg` 从 `.svg` 文件所在目录读。**两个体检工具的分工**：`taste_check` 管审美/风格/文案（emoji 图标、渐变滥施、卡片同构、无交互态、AI 套路文案…21 条）；`layout_check` 管排版（字号梯级、行高、行长、标点、对比度、标题结构…）。两边都提到字号，但结论口径一致（都是「最大字号 / 正文」比 1.6），且 `taste_check` 的对应项会把更细的 `file:line` 明细指向 `layout_check`，不会给出两个互相矛盾的分数。

## 渲染与截图

**`design_render action=diff` — 两图差异**（`base=orig.png compare=mine.png out=heat.png slices=7 align=true`）：返回均像素差（可横比多轮）、分区差（差异在哪一栏）、热力图 PNG。`align=true` 额外做偏移搜索，区分「排错了」与「整块平移了几像素」：整块平移时最佳位移只改善 2.6%。**`layout_check action=image` 的 `profile` — 从截图反推版式**：

| 字段 | 含义 |
|---|---|
| `palette` | 主色板 top 6 + 面积占比 |
| `columns` | 栏位/卡片的水平范围（自动排除版心间隙） |
| `rowPitch` | 行节奏（列表类界面的行距），附样本数 |
| `cards` / `cardGrid` | **卡片矩形 + 栅格**：每张卡片的 (x,y,w,h)，列起点、列间距、行间距 |
| `vEdges` | **栏位垂直分界线**（x 坐标）：贯穿全高的边界，办公/客户端界面靠它分栏最稳 |
| `list` | **列表/表格行距 + 一致性**：`pitch` 行距、`count` 样本数、`uniformPct` 一致率、`outliers` 异常间距 |

两种布局各用一套判据（互为替代，坏的那个自动不显示）：大底色 + 规整栏位看 `columns` + `vEdges`（某视频站动态页：侧栏 / 动态流 / 右侧直播）；卡片栅格 / 渐变背景看 `cards` + `cardGrid`（某下载工具仪表板）；表格 / 列表密集看 `list`（某在线文档产品：行距 85px，10 行，一致 100%）。两个页面的量值：原图 `49~243 / 441~887 / 895~1082`，改版稿 `48~241 / 441~880 / 891~1080`——差 1~6px，行节奏 48 vs 48。卡片阈值必须相对页面底色算：`#F6F7F9` 三通道都 ≥246，固定 246 会把整页底当卡片、连通成 2072×1414。在线文档参考图 `vEdges x=91/457/1539/1552/2031` 对上图标栏｜二级侧栏｜主内容｜右侧工具面板四条边界；某下载工具卡片 8 张（列起点 314/584/854/1123，列间 24px，行间 24px），4 列 KPI + 双宽卡 + 通栏卡一次量清。

**真实渲染：对比度与 HTML → PNG**。静态解析 CSS 遇到 `rgba()`、CSS 变量、渐变背景时算不出真实对比度，只能跳过（`contrast-invalid`）；这三类恰好是现在最常用的写法。加 `render=true` 后在真实像素上量：`layout_check action=ui root=page.html render=true width=760 height=420`。

原理（不靠 OCR、不靠 DOM）：同一页面渲两遍（A 正常；B 用 `*{color:transparent!important}` 把文字染透明，布局不变）→ A/B 差异大的像素是文字墨迹 → 连通域分组，域内最墨像素给文字色，同位置 B 渲染给真实背景 → 按文字色去重逐种配色报对比度。三条实现约束：不能取最小对比度像素（必然落在抗锯齿边缘，假报 1.28:1）；不能按颜色聚类（边缘中间调自成一簇，假报 2.23:1）；必须关 LCD 子像素渲染（彩边假报 1.97:1）。渐变底 + 半透明白卡上的输出：

```
[error] contrast-effective 实际渲染对比度不足：2.52:1 —— 文字 rgb(138,143,168)
        压在真实背景 rgb(75,58,185) 上（42px 墨迹）
[error] contrast-effective 实际渲染对比度不足：2.99:1 —— 文字 rgb(180,184,200)
        压在真实背景 rgb(97,85,191) 上（61px 墨迹）
```

同一页面上白字 9.42:1、深灰字 5.79:1 正确不报，与静态计算一致。

`design_render action=html` 把 HTML/CSS 渲染成 PNG（`html=page.html out=shot.png width=1280 height=764 pageScale=2 fullPage=true`）。软件内部界面本身就是 web 版，不能渲染 HTML 就看不到自己的输出：静态体检全绿，渲染后才看得见头像视觉重量、侧栏行高、字号偏大。`fullPage` 分两趟：先 `--dump-dom` 让页面把 `scrollHeight` 写进 title 读回内容高，再用 `--window-size=W,内容高` 截第二趟。Chromium 无头模式始终只截视口，不传 `--window-size` 时用默认窗口（750×485）；返回值带 `pixelWidth` / `pixelHeight`，直接从 PNG 的 IHDR 读实测像素，不会出现「报 1100×1500、实际 750×485」。

| 能力 | 依赖 |
|---|---|
| SVG → PNG、图层合成、素材库 | **完全自包含**（vendored resvg，零外部进程） |
| HTML → PNG | 需要本机 Chromium 系浏览器（Edge / Chrome / Chromium），自动探测 |

不写自研布局引擎：浏览器引擎才是唯一可信的参照。探测不到时明确报错并给出下一步（装浏览器 / 配 `browserPath` / 改用 `action=render`），不静默回退。没有浏览器的机器上，其余工具一切正常。

## 测试

```powershell
npm test              # 全套功能测试（node:test），约 34 秒
npm run test:spec     # 同上，spec 风格逐条列出
npm run test:pack     # 只跑发布边界（真的 npm pack → 解包 → 用拆包副本跑一遍）
```

| 层 | 文件 | 验什么 |
|---|---|---|
| 契约 | `test/contract.test.mjs` | 8 工具注册/参数/必填/常驻 token 预算、输出无损（无 undefined/NaN）、错误消息可行动、确定性、相对路径按会话目录、并发声明、零依赖与无外部程序守卫、包元数据完整性 |
| 渲染 | `test/render.test.mjs` | 自己解 PNG 看像素：透明底真透明、缩放保比、中文真的画出字、图层不被拉伸、opacity 混合数学、输出后缀与 width 上限 |
| 图标/形变 | `test/icon.test.mjs`、`test/morph.test.mjs` | 2029 图标全量契约、5 种出码约定、非法 size/strokeWidth、形变体检与预览页自包含 |
| 体检 | `test/taste.test.mjs`、`test/audit.test.mjs` | 21 条规则逐条命中与反例、三档 profile、声明豁免、坏 JSON 不崩、单文件/大文件/扫描上限 |
| 风格/素材 | `test/style.test.mjs`、`test/assets.test.mjs` | 48 组合 × 3 格式、去同质化不变量、tailwind 真能执行、素材全库 221 项、目录穿越与标签注入拦截 |
| 发布边界 | `test/pack.test.mjs` | tarball 必需文件/无泄漏/体积、拆包后只用包内 data+vendor 跑一次工具调用 |

非 win32 平台渲染用例自动 skip（vendored resvg 只有 win32-x64 绑定），其余全部照跑；CI 在 windows 与 ubuntu 都跑整套。渲染产物落在 `.test-out/*.png`，Windows CI 会上传为 artifact 供人工看效果。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `previewDir` | `""` | morph preview 默认输出目录（空 = 系统临时目录） |
| `findLimit` | `12` | icon find / asset find 默认条数 |
| `maxAuditFiles` | `4000` | taste_check audit 扫描上限 |
| `maxFindings` | `60` | taste_check audit 返回上限 |
| `iconPacks` | `["tabler"]` | 装载的图标包（默认只 tabler，控制体积） |

## 边界

- **不做像素级图像处理**：没有裁剪、滤镜、调色。需要这类能力用 `dsh-imagekit`（造新图）；`dsh-visualkit` 管「让图和界面好看」。
- **不联网**：除 `action=html` 调用本机浏览器外，所有产物都在本地生成，预览页是自包含 HTML（用户自己开）。
- **合成只做叠加**：`composite` 是「底图 + 上层」两层 alpha 叠加，不做多图层排序。图层保宽高比、居中、不放大；位图图层只收 PNG（JPEG/WebP 量不到尺寸，请先转 PNG）。
- **`taste_check audit` 的 emoji 规则按字符扫描**：注释、文案、状态标记里的 emoji 也会报（规则语义是「源码里不出现 emoji 图标」，不做语法级区分）。测试/样本目录（`test/` `fixtures/` `spec/` 等）默认跳过。
- **`morph check` 把非 24 网格当阻塞项**（`ok:false`）：引擎层能 re-grid，但项目管线（`UI.svg` / `morphTo`）要求 24 网格数据。`morph preview` 与 `design_render` 会自动归一化。
- **`layout_check` 的 svg 模式不量 `<g transform>` 内的文字**（坐标系换算不可靠，计入 `unmeasured` 并提示）；image 模式无 OCR，不做文字可读性与颜色对比度判定。
- **字体靠系统**：resvg 用系统字体，中文默认 `Microsoft YaHei`；换机器字体缺失会回退，不保证字形一致。
- **原生绑定是 win32-x64**：换平台需要重新 vendor `vendor/resvg/` 里对应的 `.node` 文件。
