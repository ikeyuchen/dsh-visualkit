# AGENTS.md — dsh-visualkit 开发指引

给在本仓库工作的 AI 代理（以及人）的操作约束。只写容易踩错的，不重复 README 已讲的功能。

## 命令

```powershell
npm test              # 全套功能测试（node:test，含独立性守卫与发布边界），改完必跑
npm run test:coverage # 同一套用例，量 lib/ 覆盖率并校验阈值（CI 的 ubuntu 作业跑这条）
npm run selfcheck     # 拿本机真实项目跑一遍，盯误报回归（语料不在则跳过）
npm run release:check # 发布前静态检查（版本三处一致/预算/依赖/必需文件），发版前必跑
npm run test:pack     # 只跑发布边界（真 npm pack → 解包 → 拆包副本跑一次），发版前必跑
npm pack --dry-run    # 看打包清单
```

Node 版本以 `.nvmrc` 为准（22），CI 从该文件读取，本地请对齐。

`test/` 按领域分文件（清单与归属见 `docs/ARCHITECTURE.md` 的测试树），新增能力扩对应文件，不要加第二个测试入口。

`selfcheck` 单独存在的原因：单测用合成夹具，长不出「注释里的 emoji」「Vue 插值留下的空格」「`getElementById` 绑定的按钮」这类真项目形态。它拿本机配置的真实项目（`.selfcheck.local.json`，未配置时只剩本插件）和 `.selfcheck-baseline.json` 比，只在「以前不报、现在报」时非零退出（分数变化只报告）。改判据后确认无新噪声，用 `npm run selfcheck -- --update` 刷新基线。

## 硬约束（违反会坏包或坏合规）

- **不要在 `lib/` 引入外部进程**：`child_process` / `spawn` / `python` / `krita` / `playwright` 出现即被独立性守卫判失败；唯一允许的是 `render-html.js` 调用本机浏览器。
- **不要给 `package.json` 加 `dependencies`**：官方 `install_bundle` 的 pnpm 会接管并可能删掉主包。需要第三方能力就 vendored 到 `vendor/` 并写进 `THIRD_PARTY.md`。
- **不要对 `link:` 安装直接跑 `dsh plugin add/remove`**：pnpm 会替换 junction，实测顺着链接删掉仓库文件（`.git` 元数据被删，靠远端 clone 恢复）。切换安装方式先手工删 junction 或先在插件页卸载，再按包名重装。
- **新增数据文件必须同时更新三处**：`package.json` 的 `files`、`test/pack.test.mjs` 的 `REQUIRED`、`THIRD_PARTY.md` 的来源表。漏掉任一项，发布出去的包会在用户机器上缺能力。
- **改 `rules.js` 必须同步 `detect.js`**：规则表与检测器是同一份定义的两面，只改一边会让 `design_style` 的约束与 `taste_check` 的验收标准打架。
- **皮肤必须自带字号阶梯**（4 档、最大跳变 ≥1.6×）：`SKINS` 里不要复用别人的 `typeScale` 对象，自测会遍历全部皮肤断言，并检查字号签名至少有 5 种不同。
- **CC-BY / CC-BY-SA 素材**：新增此类素材时同步 `THIRD_PARTY.md` 的署名表，否则构成许可违约。
- **`format=motion` 只加原语，不加预设动效包**：新原语必须能被变量驱动、只走 `[data-motion~="…"]` 属性钩子、保留 `prefers-reduced-motion` 兜底。三条由 `test/style.test.mjs` 的 motion 用例断言。
- **测试版走 beta 通道**：版本号带 `-beta.N`（或 `-rc.N`）、npm tag 用 `beta`（CI 按版本号自动选），不覆盖 `latest`；晋级与作废见 `docs/RELEASING.md`。

## 仓库结构决策

| 决策 | 原因 | 依据 |
|---|---|---|
| resvg 在 `vendor/` 不在 `dependencies` | pnpm 会删掉 link 包的主包 | `docs/ARCHITECTURE.md` |
| `os: ["win32"]` / `cpu: ["x64"]` | vendored `.node` 只有 win32-x64 | `vendor/resvg/*.node` |
| 工具名不带包名前缀（`icon` 而非 `artkit_icon`） | 工具名是模型可见的领域词，与包名解耦 | `docs/positioning.md` |
| `data/` 必须提交到 git | 图标与素材是核心资产，不是可再生产物 | `.gitignore` 有意不排除 |

## 事实源

文档、注释与工具说明只能转述下表的内容。文档与代码冲突时以运行时行为为准：先确认哪边错，再只改错的那一边，不允许两边各写一套。

| 内容 | 唯一来源 | 核对方式 |
|---|---|---|
| 工具名、参数、枚举、默认值 | `lib/index.js` 的工具定义 | 用 `test/contract.test.mjs` 的 `toolRegistry` 打印 `def.parameters` |
| 配置键与默认值 | `lib/index.js` 的 `Config` | 同上 |
| AI 味规则、阈值、分层权重 | `lib/rules.js`（判据实现在 `lib/detect.js`） | `node -e "import('./lib/rules.js').then(m=>console.log(m.RULES.length, m.PROFILES))"` |
| 排版规则编号与阈值 | `lib/layouts/` 下的 `source.js` / `svg.js` / `image.js` / `rules-*.js` | 直接读文件 |
| 数据版本与许可 | `THIRD_PARTY.md`；数据文件的 `source` 字段 | `node -e "console.log(require('./data/lucide-icons.json').source)"` |
| 版本号、运行环境、打包清单 | `package.json` 的 `version` / `engines` / `files` | `node -e "console.log(require('./package.json'))"` |
| 常驻预算、打包必需文件 | `npm run release:check` 的输出；`test/pack.test.mjs` 的 `REQUIRED` | 跑命令 |
| 测试通过数、覆盖率 | `npm test`、`npm run test:coverage` 的实际输出 | 跑命令 |

## 禁止项

- **禁止编造**：参数、枚举、默认值、错误消息、文件路径、脚本名、命令输出。写文档前用 `ls` / `grep` 核对路径；数字必须能由仓库内命令复现，不能复现的案例数据要写明「语料不入库」。
- **禁止改动无关结构**：不重排文件、不统一格式、不顺手重构、不删除看似冗余的断言或注释。一次提交只做一件事。
- **禁止为通过检查而放宽门禁**：不改阈值、不跳过测试、不删断言、不吞异常、不把 `skip` 加回来。
- **禁止把未实现的能力写进文档**，包括「即将支持」类表述。

## 交付与审核

改完必须给出可核对的交付说明，缺任一项视为未完成：

1. 改动文件清单，每个文件一句原因。
2. 实际执行的命令与结果（`npm test` / `npm run release:check` / `npm run test:coverage`），不接受「已测试」。
3. 文档改动额外说明核对来源：对照了哪个代码文件或命令；无法核实的数字显式标注。
4. PR 场景按 `.github/PULL_REQUEST_TEMPLATE.md` 填「验证方式」，不得留空。

## 文档

同一类内容只有一个出处，改的时候改那一份，其余只放链接。

| 内容 | 出处 |
|---|---|
| 安装、快速上手、工具总表、档位预算、配置键、边界 | `README.md` |
| 图标出码（9 种预设、正交维度、文字与渐变、`shapes`、阴影与虚线） | `docs/icon-emit.md` |
| 风格 token、机制层与 `format=motion` 定位 | `docs/style-reference.md` |
| AI 味 21 项指标、位图层判据、分数口径 | `docs/ai-look.md` |
| 排版规则、阈值、应用外壳分档、`profile`、渲染对比度 | `docs/layout-rules.md` |
| 渲染与截图（图层合成、软件图标、diff、HTML→PNG、依赖） | `docs/rendering.md` |
| `css_edit` 用法与保留规则 | `README.md`；选型测量见 `docs/css-normalization.md` |
| 目录与模块职责、三条不变量、vendored 理由 | `docs/ARCHITECTURE.md` |
| 定位、命名轴、场景矩阵、原语、不做清单 | `docs/positioning.md` |
| 五步链路案例 | `docs/workflow.md` |
| 动效原语细节（变量表、JS 钩子） | `docs/interaction-layer.md` |
| 版本策略、发布通道、发布与回滚、数据更新同步项 | `docs/RELEASING.md` |
| 版本变更 | `CHANGELOG.md` |
| 第三方版本、许可、署名 | `THIRD_PARTY.md` |
| 素材库用法 | `data/assets/README.md` |
| 安全报告渠道与支持范围 | `SECURITY.md` |
| 贡献流程 | `CONTRIBUTING.md` |

新增或改名文档时先登记本表；未登记的文档视为没有出处归属。

文档只写当前事实：不写过程叙事、不写已废方案、不预留「即将支持」。数字必须能由仓库内命令复现；不能复现的案例数据必须标注「语料不入库」。改能力时同步改文档。

## 提交与推送

**提交信息**：`<type>(<scope>): <subject>`。

- type ∈ feat / fix / refactor / docs / chore / test / perf；scope 用对应模块名（如 `icon` / `morph` / `taste` / `style` / `render` / `layout` / `html` / `css` / `assets` / `pack`），仓库级改动（文档、规范、配置、发布）省略 scope。
- subject 用中文写清做了什么，不写过程；一次提交只做一件事。
- 提交身份固定 `ikeyuchen <ikeyuchen@users.noreply.github.com>`（已写入 `git config --local`，换机器要重设）。

**本地小步提交，攒够再推**：本地按功能分开提交、保留历史，不要频繁推送；攒到一个功能或一次发布再推一次。

**推前合并本地未推送的提交**：`git reset --soft origin/main` 后重提，或 `git rebase -i origin/main`；已推送的历史不改写（不做 force-push），只合并尚未推送的部分。

**变更写进 CHANGELOG**：按版本列「新增 / 修复 / 变更」，写用户能感知到什么，而不是只写改了哪个文件。

## 改完的自检顺序

1. `npm test` —— 功能 + 打包边界（一次跑完）
2. 若动了 `lib/`：连跑两次 `npm test` 确认没有不确定性
3. 若动了工具签名：`test/contract.test.mjs` 的常驻预算会报数字；同步 README 的档位数字与 CHANGELOG 的破坏性说明
4. 若动了数据或许可：`THIRD_PARTY.md` 与 `README.md` 同步
