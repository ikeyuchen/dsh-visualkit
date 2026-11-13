# dsh-visualkit

[![npm](https://img.shields.io/npm/v/dsh-visualkit)](https://www.npmjs.com/package/dsh-visualkit) [![platform](https://img.shields.io/badge/platform-Windows%20x64-lightgrey)](#安装) [![license](https://img.shields.io/npm/l/dsh-visualkit)](https://github.com/ikeyuchen/dsh-visualkit/blob/main/LICENSE)

**视觉设计工具箱**：给 AI 生成的界面与图形一套可执行的工艺——取真图标、定风格规格、量审美、本地出图。

## 它做什么

- **取真资产**：`icon` 检索 8331 个图标并出码，`design_render asset` 取 221 项内置素材，替代模型编造
- **定规格**：`design_style` 给 token、结构配方与交互原语；`html_edit` / `css_edit` 做上下文安全的改写
- **量审美**：`taste_check` 打 AI 味 0–100 分并给返工指令；`layout_check` 量排版与构图
- **出成品**：`design_render` 本地渲染与合成（SVG / HTML→PNG、多尺寸、ICO），`morph` 做形变体检与预览

全部本地离线，不依赖 Python、Krita、Playwright 或外部工作区。

`dsh-visualkit` — Art toolkit for AI-generated UIs and graphics: icon sourcing, SVG morphing, AI-look scoring, style specs, local rendering.

## 安装

**方式一：DSH 内安装（推荐）**

1. 打开 DSH →「插件」→「添加插件」
2. 输入包名 `dsh-visualkit`，安装源保持「npm 官方源」
3. 点「安装」，装好后重启 DSH 生效

**方式二：命令行（同样走 npm）**

```bash
dsh plugin --profile <profile> add dsh-visualkit
```

`--profile` 必填，值为目标 profile 名（例如 `desktop`）；不传会直接报错。测试版用 `@beta`：`dsh plugin --profile <profile> add dsh-visualkit@beta`，切回正式版用 `@latest`。

**方式三：源码**（开发或未发布版本）

```bash
git clone https://github.com/ikeyuchen/dsh-visualkit.git
dsh plugin --profile <profile> add ./dsh-visualkit
```

源码方式安装的是本地 link，切换或卸载前先在插件页卸载，不要直接对 link 安装执行 `dsh plugin remove`（见 `AGENTS.md`）。

运行环境：Windows x64；Node 版本见 `.nvmrc`，其余要求见 `package.json` 的 `engines` / `os` / `cpu`。改本地代码后触发一次 profile 重组合即可，不必重装。

可选依赖：`design_render action=html` 与 JPEG / WebP 图片输入需要本机 Chromium 系浏览器（自动探测）；其余能力完全自包含。

**验证安装**：重启后在对话里说「用 icon 找一个搜索图标」，看到工具调用并返回图标名即成功。

## 快速上手

四步走完一条最小链路。参数名与取值都已按实现核对，可直接照抄。

### 1. 取一个图标

```text
icon find query="搜索" limit=5          → 返回图标名、别名与可选变体（如 filled/duotone）
icon emit name="search" target="raw"    → 返回可直接粘贴的 SVG 标记
```

`target` 取 `raw` 时输出裸 SVG；`colibri` / `echo` / `dsh-plugin` / `whale` 是四个项目的出码约定。9 种视觉预设与逐项参数见[图标出码](https://github.com/ikeyuchen/dsh-visualkit/blob/main/docs/icon-emit.md)。

### 2. 定一套风格规格

```text
design_style skin="swiss-minimal" format="css"
```

得到 `:root` 下的 token、骨架步骤与禁用清单，粘进页面的 `<style>` 即生效。`format` 可选 `css` / `json` / `tailwind` / `motion`；token 覆盖与机制层见[风格参考](https://github.com/ikeyuchen/dsh-visualkit/blob/main/docs/style-reference.md)。

### 3. 出一张图

```text
design_render action="render" svg="icon.svg" png="icon.png" width=256
```

把上一步的 SVG 存成 `icon.svg`（也可直接传 `svg="<svg…>"` 内联标记）。产出 PNG 透明底保留；`sizes=[256,128,64] ico=true` 可一次出多尺寸与 `.ico`。图层合成、HTML 截图与差异比对见[渲染与截图](https://github.com/ikeyuchen/dsh-visualkit/blob/main/docs/rendering.md)。

### 4. 验收改完的结果

```text
taste_check action="taste" root="src/"       → AI 味 0–100 分 + 逐条 fix
layout_check action="ui" root="src/"         → 排版 0–100 分 + 规则编号
```

分数越低越好：`clean` 区间停止优化，`ai-default` / `messy` 按 `fix` 改完再跑一次。规则的判据与阈值见[AI 味](https://github.com/ikeyuchen/dsh-visualkit/blob/main/docs/ai-look.md)、[排版规则](https://github.com/ikeyuchen/dsh-visualkit/blob/main/docs/layout-rules.md)。完整改造案例见[工作流](https://github.com/ikeyuchen/dsh-visualkit/blob/main/docs/workflow.md)。

## 八个工具

| 工具 | action | 作用 |
|---|---|---|
| `icon` | `find` / `emit` | 检索 lucide 2029（官方 tags + 43 类目）与 tabler 6302，支持中英同义词；按项目约定出码，`style` 有 9 种预设 |
| `morph` | `check` / `preview` | 形变兼容双层体检（项目契约 + morphicons 引擎）；生成自包含动效预览页 |
| `taste_check` | `taste` / `audit` | `taste`：AI 味 0–100 分与返工指令，21 项指标分 quality/style/content 三层；输入为源码目录、单文件、一张位图，或一个截图目录（批量：分数分布 + 跨图一致性 + 离群图）。`audit`：图标规范巡检（emoji / MorphIcon 误用 / ICONS 字典） |
| `layout_check` | `ui` / `svg` / `image` | 排版体检 0–100 分，越低越好。`ui` 扫 HTML/CSS 的字体系统、行高、行长、对齐；`svg` 量成品文字几何；`image` 量渲染图构图（传目录则批量：均分、离群、跨图栅格一致性） |
| `design_style` | `format=css` / `json` / `tailwind` / `motion` | 8 皮肤 × 6 骨架 = 48 组合：token + 结构配方 + 分层禁用清单；`motion` 出交互原语层 |
| `html_edit` | `scan` / `rewrite` | 上下文感知的 HTML 改写：先判定命中位于文本节点、属性、脚本还是注释，再决定改不改 |
| `css_edit` | `scan` / `snap` / `scale` / `leading` / `radius` | 机械收敛：间距对 4px 网格、字号归阶梯、行高归一、圆角收敛；默认只出清单不写盘 |
| `design_render` | `render` / `composite` / `asset` / `html` / `diff` | `render`：SVG→PNG（透明底、多尺寸、ICO）；`composite`：图层合成；`asset`：221 项内置素材检索 / 内联 / 改色；`html`：HTML→PNG；`diff`：两图差异与热力图（两侧传目录则按同名图批量配对） |

`css_edit` 的四个收敛动作分别保留什么：

| action | 收敛什么 | 保留不动 |
|---|---|---|
| `snap` | `margin/padding/gap` → 4px 网格 | 0.5/1/2px（描边与微调）、负值只调幅度不改方向、裸 `0` |
| `scale` | `font-size` → 给定阶梯 | 平局取大的那档（往小缩会让中文变糊） |
| `leading` | `line-height` → `1.5 / 1.6 / 1.8` | 标题级一律不动、`<1.2` / `>2.2` / `px` / `var` |
| `radius` | `border-radius` → `2 / 4 / 8 / 12` | `50%`、`0`、`≥100px`（胶囊）、单角属性、多值简写 |

默认 dry-run，`write=true` 才落盘；注释与字符串里的数字不动，`var()/calc()/%/em/rem/auto` 不碰。规则选型与实测数据见 [css-normalization](https://github.com/ikeyuchen/dsh-visualkit/blob/main/docs/css-normalization.md)。

`scan` 报越网格间距时直接给就近两侧目标（`10px×2→8/12`），不用自己算；组件里的 Tailwind 任意值字号（`text-[11.5px]`）单独报一行，`action=scale` 会连同 CSS 的 `font-size` 一起收敛，`*.test.*` / `*.spec.*` 不动。`root` 指到只有组件的目录也能扫（不会再报「没有可处理的 CSS/HTML 文件」），而 `snap` / `leading` / `radius` 这类纯 CSS 动作会明确说明只处理 CSS/HTML。

`layout_check action=ui` 的 `S1` 命中时附带可直接粘贴的修复模板（5 档 `:root` token + 一条 `css_edit` 命令 + 需就近归并的档位），每条 finding 还给出「修完这条 24→18」的分数预期：

```css
:root {
  --fs-xs: 10.75px;
  --fs-sm: 12.25px;
  --fs-base: 13.5px;
  --fs-md: 17.5px;
  --fs-xl: 20.25px;
}
```

套用顺序：写 token → `css_edit action=scale scale="10.75,12.25,13.5,17.5,20.25" write=true` → 重跑 `layout_check action=ui` 看分数变化。

批量审查：真实一轮 UI 审查拍出来的是一组截图，不是一张。三个入口都接受目录（最多 24 张，按文件名排序），把「逐张看」换成「先看分布与离群，再看单张」：

```
# 一组截图：分数分布 + 跨图一致性（背景 / 列栅格）+ 离群图
taste_check action="taste" root="shots/"

# 一组截图：构图均分 + 离群 + 跨图栅格一致性
layout_check action="image" input="shots/"

# 改前 / 改后两个目录：按同名文件配对（before/home.png ↔ after/home.png）
design_render action="diff" base="before/" compare="after/"
```

读不了的图只跳过并点名，不中断整批；批量仍是位图口径，字号体系 / 间距网格 / 图标成套性要看源码。

## 按需加载：`toolsetProfile`

低频工具默认不进上下文，默认 `standard` 装 6 个高频工具：

| 档位 | 工具 | 常驻 |
|---|---|---|
| `minimal` | icon, design_render | **2393 字符 ≈ 600 token** |
| `standard`（默认） | + taste_check, layout_check, html_edit, css_edit | **3585 字符 ≈ 896 token** |
| `all` | + morph, design_style | 4140 字符 ≈ 1035 token |

非法档位值报错，不静默回落；提示段只列当前 scope 真看得到的工具。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `toolsetProfile` | `"standard"` | 工具档位：`minimal` / `standard` / `all` |
| `previewDir` | `""` | morph preview 默认输出目录（空 = 系统临时目录） |
| `findLimit` | `12` | icon find / asset find 默认条数 |
| `maxAuditFiles` | `4000` | taste_check audit 扫描上限 |
| `maxFindings` | `60` | taste_check audit 返回上限 |
| `iconPacks` | `["tabler"]` | 装载的可选图标包（lucide 始终内置） |
| `browserPath` | `""` | `action=html` 用的浏览器路径（空 = 自动探测） |

## 数据与许可

| 数据 | 内容 | 许可 |
|---|---|---|
| `data/lucide-icons.json` | lucide：2029 图标 + 289 别名 + 官方 tags + 43 类目（0.9 MB） | ISC |
| `data/packs/tabler.icons.json` | tabler：6302 图标（2.0 MB） | MIT |
| `data/assets/` | 221 项素材（3.2 MB） | 逐项见 `manifest.json` |
| `vendor/morphicons*.iife.js` | morphicons 形变引擎（100 KB） | MIT |
| `vendor/resvg/` | resvg-js JS 层 + win32-x64 原生绑定（4.4 MB） | MPL-2.0 |

版本号、逐项许可与署名要求见 [THIRD_PARTY.md](https://github.com/ikeyuchen/dsh-visualkit/blob/main/THIRD_PARTY.md)；素材库用法见[素材库说明](https://github.com/ikeyuchen/dsh-visualkit/blob/main/data/assets/README.md)。

## 测试

```powershell
npm test               # 全套功能测试（node:test），约 28 秒
npm run test:spec      # 同上，spec 风格逐条列出
npm run test:coverage  # 同上，量 lib/ 覆盖率并校验阈值（行 94 / 分支 86 / 函数 93，需全量用例）
npm run test:pack      # 只跑发布边界（真 npm pack → 解包 → 用拆包副本跑一遍）
```

CI 在 windows 与 ubuntu 都跑整套；非 win32 平台渲染用例自动 skip。测试分层与文件映射见[架构文档](https://github.com/ikeyuchen/dsh-visualkit/blob/main/docs/ARCHITECTURE.md)。

## 边界

- **不做像素级图像处理**：没有裁剪、滤镜、调色。需要这类能力用 `dsh-imagekit`（造新图）；`dsh-visualkit` 管「让图和界面好看」。
- **不联网**：除 `action=html` 调用本机浏览器外，所有产物都在本地生成，预览页是自包含 HTML（用户自己开）。
- **合成只做叠加**：`composite` 是「底图 + 上层」两层 alpha 叠加，不做多图层排序；位图图层只收 PNG，不做转码。
- **`taste_check audit` 的 emoji 规则按字符扫描**：注释、文案、状态标记里的 emoji 也会报；测试与样本目录默认跳过。
- **`morph check` 把非 24 网格当阻塞项**（`ok:false`）：引擎层能 re-grid，但项目管线要求 24 网格数据。
- **`layout_check` 的 svg 模式不量 `<g transform>` 内的文字**（计入 `unmeasured` 并提示）；image 模式无 OCR。
- **字体靠系统**：resvg 用系统字体，中文默认 `Microsoft YaHei`；换机器字体缺失会回退，不保证字形一致。
- **原生绑定是 win32-x64**：换平台需要重新 vendor `vendor/resvg/` 里对应的 `.node` 文件。

## 包信息

| 项 | 值 |
|---|---|
| 包名 / 仓库 | `dsh-visualkit` |
| 最新版本 | 见顶部 npm 徽章，或 `npm view dsh-visualkit version` |
| 许可 | MIT |
| 运行时依赖 | 无（resvg 已 vendored） |
| 可选依赖 | 本机 Chromium 系浏览器：HTML→PNG，以及 JPEG / WebP 图片输入（需转码） |

## 进阶文档

| 文档 | 内容 |
|---|---|
| [工作流](https://github.com/ikeyuchen/dsh-visualkit/blob/main/docs/workflow.md) | 体检 → 核实 → 机械改 → 人决定 → 复验的完整案例 |
| [图标出码](https://github.com/ikeyuchen/dsh-visualkit/blob/main/docs/icon-emit.md) | 9 种预设、正交维度、文字与渐变、`shapes`、阴影与虚线 |
| [风格参考](https://github.com/ikeyuchen/dsh-visualkit/blob/main/docs/style-reference.md) | `design_style` 的 token 键、机制层与输出变量 |
| [交互层](https://github.com/ikeyuchen/dsh-visualkit/blob/main/docs/interaction-layer.md) | `format=motion` 的 8 个原语、变量表、JS 钩子与无障碍兜底 |
| [AI 味](https://github.com/ikeyuchen/dsh-visualkit/blob/main/docs/ai-look.md) | 21 项指标、位图层判据、分数口径 |
| [排版规则](https://github.com/ikeyuchen/dsh-visualkit/blob/main/docs/layout-rules.md) | 三套模式的规则集、应用外壳分档、阈值与豁免 |
| [渲染与截图](https://github.com/ikeyuchen/dsh-visualkit/blob/main/docs/rendering.md) | 图层合成、软件图标、差异比对、HTML→PNG |
| [定位](https://github.com/ikeyuchen/dsh-visualkit/blob/main/docs/positioning.md) | 命名依据、场景矩阵、原语清单、能力边界 |
| [架构](https://github.com/ikeyuchen/dsh-visualkit/blob/main/docs/ARCHITECTURE.md) | 目录与模块职责、三条不变量 |
| [发布流程](https://github.com/ikeyuchen/dsh-visualkit/blob/main/docs/RELEASING.md) | 版本策略、发布通道、回滚 |

## 许可证

[MIT](https://github.com/ikeyuchen/dsh-visualkit/blob/main/LICENSE)

包内第三方资产（图标数据、内置素材、vendored 引擎）的许可与署名逐项见 [THIRD_PARTY.md](https://github.com/ikeyuchen/dsh-visualkit/blob/main/THIRD_PARTY.md)。
