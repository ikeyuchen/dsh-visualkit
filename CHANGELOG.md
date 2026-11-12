# Changelog

记录用户可见的变更；格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.0.3] — 2026-11-13

### Added

- beta 发布通道：`dsh plugin --profile <profile> add dsh-visualkit@beta` 安装测试版，不影响 `latest`。
- 覆盖率门禁：`npm run test:coverage`（行 85 / 分支 80 / 函数 90），CI 的 ubuntu 作业执行；新增 `test/image-normalize.test.mjs` 覆盖 JPEG / WebP 尺寸解析与输入归一化。
- 仓库协作文件：`SECURITY.md`（漏洞报告渠道）、`CONTRIBUTING.md`（贡献流程）、`tools/assets/requirements.txt`（建库脚本依赖）。

### Fixed

- CI 的渲染产物上传从未生效：`.test-out` 是隐藏目录，`upload-artifact` 需要显式 `include-hidden-files: true`；同时把 `if-no-files-found` 改为 `error`，产物缺失立即失败。
- 图标数据的 `tagCount` / `categoryCount` 改为真实值（4575 个 tag、43 个类目），`meta()` 字段名同步为 `tagCount` / `categoryCount`。
- 旧插件名残留：错误消息、日志前缀与预览临时目录统一为 `dsh-visualkit`；`vendor/resvg/package.json` 的包名改为 `dsh-visualkit-resvg-vendored`。
- 移除 4 个未登记的遗留素材文件（`data/assets/stickers/twemoji_*.svg`，与已登记素材重名）。
- 提示段里的工具列表改按本步实际准入的工具集生成：被宿主工具限制挡掉的工具不再写进提示文字。

### Changed

- CI：同一 ref 的新推送取消旧 run；作业加超时（15 / 5 分钟）；action 固定到 commit SHA；静态发布检查只在 ubuntu 跑；性能预算在共享 runner 上放宽 3 倍。
- 发布：改在 windows 上执行（ubuntu 会跳过渲染用例），去掉重复的测试步骤，手动触发只接受 tag。
- Node 版本由 `.nvmrc` 固定为 22，CI 与本地共用。
- 文档校正：安装命令补 `--profile`，配置表补 `toolsetProfile` 与 `browserPath`，`layout_check` 规则集补 `S0`，体积与耗时数字按实测更新；素材许可表合并到 `THIRD_PARTY.md`，CSS action 表与交互层示例合并到 `README.md`，各文档按职责单点归属。
- peer 依赖 `@deepseek-ai/schemastery` 放宽到 `^3.18.4`。
- 测试基线对齐 DSH 0.2.2：devDependency `@deepseek-ai/dsh-tools` 由 `0.2.1-rc.5` 升到 `0.2.2-rc.2`，peer 链随之解析到 `@deepseek-ai/cordis` 4.1.0；`defineTool` 契约两版一致，包内代码无需改动。

## [0.0.2] — 2026-11-09

安装文档与工程流程修正，功能与契约不变。

### Changed

- 安装说明改为三种方式：DSH 插件页按包名安装（推荐）、命令行、源码；命令行必须带 `--profile`。
- README 不写死版本号，运行时要求指向 `package.json` 的 `engines`。

### Fixed

- CI：测试脚本改显式 glob；ubuntu 作业用 `npm ci --force`；包测试自带 tar 解析；渲染类用例只在 win32 跑。
- `release.yml` 改用 `npm ci --force`，推送 tag 自动发布并附带 provenance。

## [0.0.1] — 2026-11-08

首个公开发布版本。八个工具同用一套原语，可落成 UI 界面、网页、平面图、海报与文本版式。

### Added

- `icon`：检索 lucide（2029 图标 / 289 别名 / 43 类目）与 tabler（6302 图标），支持中英文同义词与别名解析；`emit` 出 5 种 target（`colibri` / `echo` / `dsh-plugin` / `whale` / `raw`）与 9 种 style 预设。
- `morph`：形变兼容双层体检（项目契约 + morphicons 2.0.2 引擎），附自包含动效预览页。
- `taste_check`：`taste` 给 AI 味 0–100 分与返工指令（21 条规则 / 三档 profile / `.design-intent.json` 豁免）；`audit` 巡检 emoji 图标、MorphIcon 误用与 ICONS 字典。
- `layout_check`：`ui` 走 `S0`–`S14`，`svg` 走 `G1`–`G9`，`image` 走 `P1`–`P9`，三者同为 0–100 分。
- `design_style`：8 皮肤 × 6 骨架 = 48 组合，输出 `css` / `json` / `tailwind`；`format=motion` 给 8 个交互原语。
- `design_render`：`render` / `composite` 出图与图层合成，`html` / `diff` 做页面截图与差异比对，`asset` 检索 221 项内置素材。
- `html_edit`：`scan` 判定命中落在文本 / 属性 / 脚本 / 注释的位置，`rewrite` 按 `scope=text|text+attr|all` 限定范围。
- `css_edit`：`scan` / `snap` / `scale` / `leading` / `radius`，默认 dry-run，`write=true` 才落盘。
- 运行：零运行时依赖；resvg-js 2.6.2（MPL-2.0）与 morphicons 2.0.2（MIT）vendored 到 `vendor/`；常驻预算默认档 3600 / 全量档 4200 字符；平台 win32-x64；许可 MIT，版本要求见 `package.json` 的 `engines`，第三方许可见 `THIRD_PARTY.md`。
