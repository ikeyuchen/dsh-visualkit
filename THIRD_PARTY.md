# 第三方资产与许可

本包的**代码**以 MIT 发布（见 `LICENSE`）；包内分发的**资产**来自第三方项目，各自遵循原许可，逐项列出以便合规审计与署名。

## 一、运行时依赖（vendored）

| 组件 | 版本 | 许可 | 用途 | 位置 |
|---|---|---|---|---|
| [morphicons](https://github.com/guillermolg00/morphicons) | 2.0.2 | MIT © Guillermo | SVG 图标形变引擎 | `vendor/morphicons.iife.js`、`vendor/morphicons-adapters.iife.js` |
| [resvg-js](https://github.com/thx/resvg-js) | 2.6.2 | **MPL-2.0** | SVG → PNG 渲染（含 win32-x64 原生绑定） | `vendor/resvg/` |

> **resvg 是 MPL-2.0**：本包分发其未修改的构建产物并保留原 `LICENSE`（`vendor/resvg/LICENSE`）。MPL-2.0 是文件级 copyleft——修改 resvg 源文件才需公开那部分，与本包自身代码无关。自行重建绑定见 `vendor/resvg/package.json` 的 `name`/`description`。

## 二、图标数据

| 数据 | 版本 | 许可 | 位置 |
|---|---|---|---|
| [lucide](https://lucide.dev) | 1.70.0 | **ISC** | `data/lucide-icons.json`（2029 图标 + 289 别名 + 官方 tags + 43 类目） |
| [Tabler Icons](https://tabler.io/icons) | 1.2.43 / iconSet 3.50.0（via `@iconify-json/tabler`） | **MIT** | `data/packs/tabler.icons.json`（6302 图标） |

两个数据文件都是从上游 npm 包**提取的几何数据**（`[tag, attrs][]` 形式），由 `tools/build-icon-data.mjs` 生成；许可见各文件 `source` 字段。

## 三、素材库（221 项，`data/assets/`）

| 目录 | 内容 | 数量 | 来源 | 许可 |
|---|---|---:|---|---|
| `icons/lucide/` | 线性图标（currentColor） | 10 | Iconify `@iconify-json/lucide` | ISC |
| `icons/tabler/` | Tabler 线性图标 | 40 | Iconify `@iconify-json/tabler` | MIT |
| `icons/phosphor/` | Phosphor duotone 图标（256 viewBox） | 31 | [phosphor-icons/core](https://github.com/phosphor-icons/core) | MIT |
| `icons/brands/` | 平台品牌图标（B站/油管/TG/QQ/微信/抖音…） | 12 | [simple-icons](https://github.com/simple-icons/simple-icons) | CC0（**商标权属各平台**） |
| `stickers/twemoji/` | 表情贴纸 | 24 | [jdecked/twemoji 15.1](https://github.com/jdecked/twemoji) | **CC-BY-4.0** |
| `stickers/openmoji/` | 手绘风表情 | 2 | [hfg-gmuend/openmoji](https://github.com/hfg-gmuend/openmoji) | **CC-BY-SA-4.0** |
| `illustrations/openpeeps/` | 手绘人物插画（可改色/组合） | 42 | [openpeeps.com](https://www.openpeeps.com)（Pablo Stanley） | CC0 |
| `patterns/` | 可平铺图案（currentColor） | 12 | 程序化自产 | CC0 |
| `textures/` | 噪点底纹 PNG 512² | 3 | 程序化自产 | CC0 |
| `parts/` | 角色部件（透明底 PNG） | 45 | 自有素材拆分 | 自有 |

逐项许可见 `data/assets/manifest.json` 的 `license` 字段；目录用法见 `data/assets/README.md`。

## 四、需要署名的资产（CC-BY）

对外作品中**分发**下表内容时保留署名：

| 资产 | 署名要求 |
|---|---|
| Twemoji（24 项贴纸） | "Copyright 2020 Twitter, Inc and other contributors" — [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) |
| OpenMoji（2 项贴纸） | "OpenMoji — the open-source emoji and icon project" — [CC-BY-SA-4.0](https://creativecommons.org/licenses/by-sa/4.0/) |

> **CC-BY-SA 提示**：ShareAlike 要求**对该素材的改编作品**同样以 CC-BY-SA 发布。本包只把原文件打包分发（未改动），不触发传染；但基于这 2 个 OpenMoji 文件二次创作并对外发布，那件作品需要 CC-BY-SA。不确定时优先换用 `stickers/twemoji/` 或其他 CC0 素材。

## 五、商标与字体

`icons/brands/` 与 `data/packs/`（如有品牌图标）中的 Logo 商标权属各公司。本包以 CC0 分发其 SVG 几何数据（simple-icons 项目本身的许可），**不代表授权**在这些商标所有者的场合使用；仅建议用于"平台指示"（如登录按钮旁标注"用 GitHub 登录"）。商业使用请自行确认各平台品牌规范。

本包不内嵌任何字体文件。渲染时使用**系统字体**（`design_render` 默认 `Microsoft YaHei`），字体许可由使用者所在系统承担。
