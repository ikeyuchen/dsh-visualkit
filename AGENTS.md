# AGENTS.md — dsh-visualkit 开发指引

给在本仓库工作的 AI 代理（以及人）的操作约束。**只写容易踩错的**，不重复 README 已讲的功能。

## 命令

```powershell
npm test            # 全套功能测试（node:test，含独立性守卫与发布边界），改完必跑
npm run selfcheck   # 拿本机真实项目跑一遍，盯**误报回归**（语料不在则跳过）
npm run release:check # 发布前静态检查（版本三处一致/预算/依赖/必需文件），发版前必跑
npm run test:pack   # 只跑发布边界（真 npm pack → 解包 → 拆包副本跑一次），发版前必跑
npm pack --dry-run  # 看打包清单
```

`test/` 按领域分文件（contract / render / icon / morph / taste / audit / style / assets / pack），新增能力就扩对应文件，不要再加第二个测试入口（旧的 `selftest.mjs` 已废除）。

**`selfcheck` 为什么单独存在**：单测用合成夹具，长不出“注释里的 emoji”“Vue 插值留下的空格”“`getElementById` 绑定的按钮”这些真项目形态——这一轮清掉的 60 多条假报全是真项目跑出来的。它拿本机配置的真实项目（`.selfcheck.local.json`，未配置时只剩本插件）和 `.selfcheck-baseline.json` 比，**只在“以前不报、现在报”时非零退出**（分数变化只报告）。改判据后确认无新噪声，用 `npm run selfcheck -- --update` 刷新基线。

## 硬约束（违反会坏包或坏合规）

- **不要在 `lib/` 引入外部进程**：`child_process` / `spawn` / `python` / `krita` / `playwright` 出现即被自测的 independence guard 判失败。
- **不要给 `package.json` 加 `dependencies`**：官方 `install_bundle` 的 pnpm 会接管并可能删掉主包（实测过）。需要第三方能力就 vendored 到 `vendor/` 并写进 `THIRD_PARTY.md`。
- **不要对 `link:` 安装直接跑 `dsh plugin add/remove`**：pnpm 会替换 junction，实测顺着链接删掉仓库文件（`.git` 元数据被删，靠远端 clone 恢复）。切换安装方式先手工删 junction 或先在插件页卸载，再按包名重装。
- **新增数据文件必须同时更新三处**：`package.json` 的 `files`、`test/pack.test.mjs` 的 `REQUIRED`、`THIRD_PARTY.md` 的来源表。漏掉任一项，发布出去的包会在用户机器上缺能力（`test/pack.test.mjs` 是唯一会在 tarball 层面发现问题的测试）。
- **改 `rules.js` 必须同步 `detect.js`**：规则表与检测器是同一份定义的两面，只改一边会让 `design_style` 的约束与 `taste_check` 的验收标准打架。
- **皮肤必须自带字号阶梯**（4 档、最大跳变 ≥1.6×）：`SKINS` 里不要复用别人的 `typeScale` 对象，自测会遍历全部皮肤断言，并检查字号签名至少有 5 种不同（防趋同）。
- **CC-BY / CC-BY-SA 素材**：新增此类素材时同步 `THIRD_PARTY.md` 的署名表，否则构成许可违约。
- **`format=motion` 只加原语，不加预设动效包**：新原语必须 ①能被变量驱动 ②只走 `[data-motion~="…"]` 属性钩子（不占 class 命名空间）③保留 `prefers-reduced-motion` 兜底。三条都由 `test/style.test.mjs` 的 motion 用例断言。
- **测试版走 beta 通道**：版本号带 `-beta.N`（或 `-rc.N`）、npm tag 用 `beta`（CI 按版本号自动选），**不覆盖 `latest`**；晋级/作废流程见 `docs/RELEASING.md`。

## 容易忘的仓库结构决策

| 决策 | 原因 | 依据 |
|---|---|---|
| resvg 在 `vendor/` 不在 `dependencies` | pnpm 会删掉 link 包的主包 | 2026-11-07 实测，见 `docs/ARCHITECTURE.md` |
| `os: ["win32"]` / `cpu: ["x64"]` | vendored `.node` 只有 win32-x64 | `vendor/resvg/*.node` |
| 工具名不带包名前缀（`icon` 而非 `artkit_icon`） | 工具名是模型可见的领域词，与包名解耦 | 已定，勿改 |
| 中文显示名 = 视觉设计工具箱，包 id = `dsh-visualkit` | “视觉”与能力边界逐项对齐；包 id 是安装标识，别为改名断引用 | `docs/positioning.md` |
| `ui_check` 已改名 `taste_check` | 工具名按“回答什么问题”取，不按场景/输入介质（否则海报和图片被名字排除在外） | `docs/positioning.md` 命名轴 |
| `data/` 必须提交到 git | 图标与素材是核心资产，不是可再生产物 | `.gitignore` 有意不排除 |

## 提交与推送

**提交信息**：`<type>(<scope>): <subject>`。

- type ∈ feat / fix / refactor / docs / chore / test / perf；scope 用模块名（`icon` / `morph` / `ui-check` / `style` / `render` / `assets` / `pack`），**仓库级改动（文档、规范、配置、发布）省略 scope**（如 `docs: …`、`chore: …`）。
- subject 用中文写清做了什么，不写过程；一次提交只做一件事。
- 提交身份固定 `ikeyuchen <ikeyuchen@users.noreply.github.com>`（已写入 `git config --local`，换机器要重设）。

**本地小步提交，攒够再推**：本地按功能分开提交、保留历史；**不要频繁推送**（避免 GitHub 上堆一堆推送记录），
攒到一个功能或一次发布再推一次。

**推前合并本地未推送的提交**：`git reset --soft origin/main` 后重提，或 `git rebase -i origin/main`；
GitHub 上已有的推送记录保留，**不改写已推送的历史**（不做 force-push），只合并尚未推送的部分。

**变更写进 CHANGELOG**：按版本列「新增 / 修复 / 变更」，写用户能感知到什么，而不是只写改了哪个文件。

## 改完的自检顺序

1. `npm test` —— 功能 + 打包边界（一次跑完）
2. 若动了 `lib/`：连跑两次 `npm test` 确认没有不确定性（测试内有确定性断言，但外部时序不在其内）
3. 若动了工具签名：`test/contract.test.mjs` 的常驻预算会报数字；同步 README token 数字与 CHANGELOG 破坏性说明
4. 若动了数据/许可：`THIRD_PARTY.md` 与 `README.md` 的数据表同步
