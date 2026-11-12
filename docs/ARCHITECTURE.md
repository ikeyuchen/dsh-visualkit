# 架构

范围：仓库结构、模块职责、三条不变量与扩展点。

```
dsh-visualkit/
├── lib/                          23 个 .js，按职责分八组（分组，非目录）
│   ├── 入口                      index.js：apply(ctx, config)，注册工具与系统提示段
│   ├── 图标                      icondb.js 加载与检索打分 · svg.js 序列化与 checkIcon · emit.js 5 种 target · icon-render.js 9 种 style 预设
│   ├── 形变                      morphcore.js 装载 morphicons IIFE · preview.js 自包含动效预览页
│   ├── 体检                      rules.js 规则表 · detect.js 判定 · taste.js 评分与返工指令 · taste-image.js 位图判据 · audit.js 图标巡检
│   ├── 风格                      style.js 8 皮肤 × 6 骨架 · shadow.js box-shadow 图元
│   ├── 渲染                      render.js resvg 渲染与合成 · render-html.js HTML → PNG · contrast-render.js 渲染对比度 · diff.js 图像差异 · assets.js 素材检索、内联与改色
│   ├── 改写                      html-context.js 命中位置分类 · css-rewrite.js 数值收敛
│   └── 共用                      skip.js 跳过目录 · image-normalize.js JPEG / WebP → PNG
├── lib/layouts/                  11 个文件：index.js 三模式门面 · source.js / svg.js / image.js 三模式 · common.js 评分 · intent.js 豁免 · metrics-text.js 字宽 · png.js 解码 · rules-contrast.js / rules-punct.js / rules-structure.js 规则库
├── data/                         lucide（2029 图标 · 289 别名 · 43 类目）· tabler 包（6302 图标）· assets 221 项（3.2 MB）
├── vendor/                       morphicons（MIT）· resvg-js（MPL-2.0，win32-x64 绑定）；版本见 THIRD_PARTY.md
├── tools/                        release-check.mjs · selfcheck.mjs · assets/ 建库脚本（Python，依赖见 assets/requirements.txt，不进发布包）
├── locale/                       zh.json · en.json
├── test/                         28 个 .test.mjs + helpers.mjs + fixtures/
│   ├── 契约与发布                contract.test.mjs · pack.test.mjs
│   ├── 图标                      icon.test.mjs · icon-dimensions.test.mjs
│   ├── 形变与动效                morph.test.mjs · primitives.test.mjs
│   ├── 审美                      taste.test.mjs · taste-image.test.mjs · taste-image-corpus.test.mjs · legacy-baseline.test.mjs · audit.test.mjs
│   ├── 排版体检                  layout-ui.test.mjs · layout-svg.test.mjs · layout-image.test.mjs · layout-integration.test.mjs · layout-contrast.test.mjs · layout-punct.test.mjs · metrics-structure.test.mjs
│   ├── 风格                      style.test.mjs
│   ├── 渲染                      render.test.mjs · html-render.test.mjs · composite-dimensions.test.mjs · contrast-render.test.mjs · diff-profile.test.mjs · image-normalize.test.mjs
│   ├── 改写                      html-context.test.mjs · css-rewrite.test.mjs
│   └── 素材                      assets.test.mjs
├── cordis.patch.yml              组合包补丁
├── icon.svg                      插件图标
├── .nvmrc                        Node 版本（CI 与本地共用）
├── SECURITY.md                   漏洞报告渠道
├── CONTRIBUTING.md               贡献流程
└── .github/                      workflows/（ci.yml · release.yml）· ISSUE_TEMPLATE/ · PULL_REQUEST_TEMPLATE.md · dependabot.yml
```

工具落到哪一层：`icon find/emit` → `icondb` → `data/lucide-icons.json` + `data/packs/` → `emit.js`；`morph check/preview` → `svg.checkIcon()` 与 `morphcore` → `preview.js`。`layout_check` → `layouts/`；`taste_check` → `taste.js` → `detect.js`，`audit` 走 `audit.js`；`design_style` → `style.js`；`design_render` → `render.js` / `render-html.js`，`asset` 走 `assets.js`。

工具的模型可见契约（名称、参数、枚举、默认值）只在 `lib/index.js` 的工具定义与 `Config` 里；AI 味规则与阈值只在 `lib/rules.js`。文档只能转述这些定义，核对方式见 `AGENTS.md` 的「事实源」。

## 测试分层

| 层 | 验什么 |
|---|---|
| 契约 | 8 工具注册/参数/必填/常驻 token 预算、输出无损、错误消息可行动、确定性、相对路径按会话目录、零依赖与无外部程序守卫、包元数据完整性 |
| 渲染 | 自解 PNG 看像素：透明底、缩放保比、中文真画得出、图层不被拉伸、opacity 混合数学；合成九维度；渲染对比度；HTML→PNG 尺寸；diff 与 image profile；JPEG / WebP 尺寸解析 |
| 图标/形变 | 2029 图标全量契约、9 种预设与正交维度、5 种出码约定、非法 size/strokeWidth、shadow/dash 图元、形变体检与预览页自包含 |
| 体检 | 21 条规则逐条命中与反例、三档 profile、声明豁免、位图判据、三套排版判据、字符宽度表与规则接线；语料类用例未配置本机语料时自动 skip |
| 改写 | 文本、属性、脚本、注释分类，`scope` 限定，4px 网格 / 字号 / 行高 / 圆角收敛与幂等 |
| 风格/素材 | 48 组合 × 3 格式、动效原语约束、去同质化不变量、tailwind 真能执行、素材全库 221 项、目录穿越与标签注入拦截 |
| 发布边界 | tarball 必需文件/无泄漏/体积、拆包后只用包内 data+vendor 跑一次工具调用 |

各层对应的文件见上面的测试树。

## 三条不变量

**规则与检测同源**：`lib/rules.js` 一份定义供两处使用，`design_style` 的约束文案取 `ban` 字段，`taste_check taste` 的检测器由 `detect.js` 按 `id` 查实现。新增规则必须同时提供 `scope` / `ban` / `fix`，并在 `detect.js` 的 `DETECTORS` 里实现，否则模型拿到的约束和验收标准会打架。

**分层计分，不把审美当缺陷**：

| scope | 含义 | `balanced` 权重 | `structure` 权重 |
|---|---|---|---|
| `quality` | 跨风格都成立的底线（字号层级、4px 网格、交互态、留白分层） | 1.0 | 1.0 |
| `style` | 审美取向（紫渐变、大圆角、毛玻璃、渐变文字） | 0.4 | **0（降为 advisories）** |
| `content` | 内容真实度（假大数、占位文案） | 0.8 | 0.5 |

分数不可跨 profile 比较，分母不同。`clean` 区间输出 `stop optimizing here`，避免分数被当成 KPI 后把设计推向安全区（Goodhart）。

**零外部进程**：`lib/` 下不得出现 `child_process` / `spawn` / `python` / `krita` / `playwright`，唯一例外是 `render-html.js` 调用本机浏览器；`dependencies` 必须为空；resvg 必须在 `vendor/`。由 `test/contract.test.mjs` 的独立性守卫断言。

## resvg 以 vendored 分发

把 `@resvg/resvg-js` 写进 `dependencies`，执行 `plugin_manager.install_bundle` 时 pnpm 会接管该依赖，把插件目录里的主包删掉、只剩平台二进制，运行时 `Cannot find package '@resvg/resvg-js'`。`vendor/resvg/` 同时放 JS 层与 `.node` 绑定，`js-binding.js` 优先找同目录 `.node`，不经过 `node_modules` 解析。代价是原生绑定固定 win32-x64，见 `package.json` 的 `os` / `cpu`。

## 扩展点

| 想加什么 | 改哪里 | 注意 |
|---|---|---|
| 新图标集 | `data/packs/` 放 `<名>.icons.json`，并在配置 `iconPacks` 里加该名字 | 需 24×24；fill 集可形变 |
| 新 AI 味规则 | `rules.js` 加条目 + `detect.js` 的 `DETECTORS` 加实现 | 必须给 `scope` / `ban` / `fix` |
| 新皮肤 / 骨架 | `style.js` 的 `SKINS` / `SKELETONS` | 皮肤必须自带 4 档字号且最大跳变 ≥1.6× |
| 新素材 | 放进 `data/assets/` 并更新 `manifest.json` | 必须填 `license`；CC-BY 类要同步 `THIRD_PARTY.md` 的署名表 |
| 新出码 target | `emit.js` 的 `TARGETS` + emitter 函数 | 要过注入面白名单校验 |
