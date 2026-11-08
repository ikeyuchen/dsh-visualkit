# 架构

```
dsh-visualkit/
├── lib/
│   ├── index.js        插件入口：apply(ctx, config)，注册 8 个工具 + 系统提示段
│   ├── icondb.js       图标库：惰性加载、名称解析（kebab/Pascal/camel/别名）、检索打分
│   ├── svg.js          IconNode ⇄ SVG 序列化；parseIconNodes（项目契约移植）；checkIcon 双层体检
│   ├── emit.js         五种项目约定出码器
│   ├── preview.js      自包含动效预览页生成（含 spring 切换与服务端静帧）
│   ├── morphcore.js    Node 侧装载 vendored morphicons IIFE（可选能力，失败静默降级）
│   ├── audit.js        项目契约巡检（emoji / MorphIcon 误用 / ICONS 字典引用）
│   ├── rules.js        AI 味规则表（21 条：quality 7 / style 12 / content 2）：约束与检测共用同一份定义
│   ├── detect.js       21 条规则的量化判定（命中带 file:line，可回溯）
│   ├── taste.js        扫描 + 汇总分数 + 返工指令 + 声明豁免
│   ├── style.js        8 皮肤 × 6 骨架；token / 结构配方 / 分层禁用清单
│   ├── render.js       resvg 渲染与图层合成（vendor 引用，不调外部进程）
│   ├── assets.js       内置素材库检索 / 内联 / 改色（带目录穿越防护）
│   └── layouts/        排版体检：common 三模式共用 0–100 分；source / svg / image 三套判据；png 自带最小解码
├── data/                        lucide-icons.json（1.70.0 几何 + tags + 43 类目）· packs/tabler.icons.json（1.2.43）· assets/（221 项 + manifest.json 逐项许可）
├── vendor/                      morphicons 2.0.2（MIT）· resvg-js 2.6.2 JS 层 + win32-x64 绑定（MPL-2.0）
├── test/                        node:test，按领域分文件
│   ├── helpers.mjs              零依赖测试工具（mock ctx / 自解 PNG / 输出契约断言）
│   ├── contract.test.mjs        跨工具契约：注册 / 参数 / 无损 / 独立性 / 确定性 / 路径
│   ├── render.test.mjs          design_render 像素级校验（透明底、缩放、合成、CJK）
│   ├── icon.test.mjs / morph.test.mjs / assets.test.mjs      icon·icondb·emit / morph·morphcore·preview / 素材库（检索/内联/改色/安全）
│   ├── taste.test.mjs / audit.test.mjs                      taste（21 规则 × 3 profile × 豁免）/ audit（3 预设 + 单文件/大文件边界）
│   ├── style.test.mjs           design_style 48 组合 × 3 格式 + 反同质化不变量
│   ├── layout-{ui,svg,image}.test.mjs                      三套排版判据：字体系统/行高/行长/对齐 · 文字几何/安全区/重叠 · 边距/密度/平衡
│   └── pack.test.mjs            发布边界（npm pack → 解包 → 拆包副本跑一次）
└── .github/workflows/           CI（win32 + ubuntu 同套件）/ Release
```

工具落到哪一层：`icon find/emit` → `icondb` → `data/lucide-icons.json` + `packs/` → `emit.js`（5 种 target）；`morph check/preview` → `svg.checkIcon()`（契约层 + `morphcore` 引擎层）· `preview` 出自包含 HTML。

`layout_check` → `layouts/source`（HTML/CSS 声明）· `svg`（text 坐标）· `image`（png→图）；`taste_check` → `taste()` → `detect.runRules()` → 分数 + findings + advisories（`audit()` 走三个 preset）；`design_style` → `style.renderStyle()`；`design_render` → `render.js`（resvg）· `assets.js`（素材）。

## 三条不变量

**规则与检测同源**：`lib/rules.js` 一份定义供两处——`design_style` 的约束文案（`ban` 进模型上下文）、`taste_check taste` 的检测器（`detect.js` 按 `id` 查实现）。各写一份就会漂移，模型拿到的约束和验收标准打架。新增规则必须同时有 `scope` / `ban` / `fix`，并在 `DETECTORS` 里有实现。

**分层计分，不把审美当缺陷**：

| scope | 含义 | `balanced` 权重 | `structure` 权重 |
|---|---|---|---|
| `quality` | 跨风格都成立的底线（字号层级、4px 网格、交互态、留白分层） | 1.0 | 1.0 |
| `style` | 审美取向（紫渐变、大圆角、毛玻璃、渐变文字） | 0.4 | **0（降为 advisories）** |
| `content` | 内容真实度（假大数、占位文案） | 0.8 | 0.5 |

分数不可跨 profile 比较（分母不同）；`clean` 区间输出 "stop optimizing here"，防止分数变成 KPI 后把设计推向安全区（Goodhart）。

**零外部进程**：`lib/` 下不得出现 `child_process` / `spawn` / `python` / `krita` / `playwright`；`dependencies` 必须为空；resvg 必须在 `vendor/`。三条由 `test/contract.test.mjs` 的「独立性守卫」机械断言。

## 为什么 resvg 是 vendored 而不是 dependencies

把 `@resvg/resvg-js` 写进 `dependencies`，执行 `plugin_manager.install_bundle` 后 pnpm 接管该依赖，**把插件目录里的主包删掉、只剩平台二进制**，运行时 `Cannot find package '@resvg/resvg-js'`。`vendor/resvg/` 同时放 JS 层与 `.node` 绑定；`js-binding.js` 有「先找同目录 `.node`」的分支，因此不需要 node_modules 解析。代价是原生绑定固定 **win32-x64**（见 `package.json` 的 `os` / `cpu`）。

## 扩展点

| 想加什么 | 改哪里 | 注意 |
|---|---|---|
| 新图标集 | `tools/build-icon-data.mjs --pack <名> --iconify <icons.json>` | 需 24×24；fill 集自 morphicons 2.0 起可形变 |
| 新 AI 味规则 | `rules.js` 加条目 + `detect.js` 的 `DETECTORS` 加实现 | 必须给 `scope` / `ban` / `fix` |
| 新皮肤 / 骨架 | `style.js` 的 `SKINS` / `SKELETONS` | 皮肤必须自带 4 档字号且最大跳变 ≥1.6×（自测会校验） |
| 新素材 | 放进 `data/assets/` 并更新 `manifest.json` | 必须填 `license`；CC-BY 类要同步 `THIRD_PARTY.md` |
| 新出码 target | `emit.js` 的 `TARGETS` + emitter 函数 | 要过注入面白名单校验 |
