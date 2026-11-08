# 发布流程

## 版本策略（首次公开发布）

对外首发定为 **0.0.1**：工具名、参数、枚举值、**分数口径**都是模型与用户看到的契约，还会变。

| 变更 | 版本位 | 例子 |
|---|---|---|
| 修 bug、改文档、换数据版本 | **0.0.x**（patch） | `getElementById` 绑定的按钮不再被当成死按钮 |
| **任何模型可见契约变化** | **0.x.0**（minor） | 加/改名工具、加减参数、改枚举、**改规则阈值（分数会变）** |
| 契约稳定后 | 1.0.0 | — |

三条容易误判的：① **改阈值算契约变更**——用户会拿两个版本对比分数，口径一变就没法比（"最小字号 9px" 从 error 降为 warn 也走 0.x.0）② **加规则也算**——AI 味指标从 21 项变 22 项，分母变了、分数变了 ③ **只改描述文案不算**，但它占常驻 token，改完要跑 `npm run release:check` 确认没爆预算。

## 发布前检查

静态项已自动化（`prepublishOnly` 先跑 `npm run release:check`）：版本号三处一致（package.json / lock / CHANGELOG）· 无运行时依赖 · 除 `render-html.js` 外无外部进程 · 默认档 ≤3600 / 全量档 ≤4200 常驻预算 · 必需文件齐备 · `files` 白名单不含开发期文件 · 0.0.x 期间不得改契约（提醒）。

动态项必须另跑，脚本不代替：

```powershell
npm test           # 全套功能测试 + 发布边界（必需文件/无泄漏/体积/原生绑定/拆包后可运行）
npm run selfcheck   # 本机真实项目（.selfcheck.local.json，未配置则跳过）的误报回归，只拦"以前不报现在报"
npm run test:pack   # 真 npm pack → 解包 → 拆包副本跑一次
```

人工项（机器判不了）：新工具/新参数在 `README.md` 里有位置，`AGENTS.md` 的硬规则没与现状矛盾；有意变更的判据在 `docs/` 里记了**为什么**；在桌面端插件页 → 添加组合包 → target 指向本仓库所在目录装一次冒烟。首发另确认：npm 上 `dsh-visualkit` 未被占用（含 9 个标点/大小写变体和 GitHub 全站均为 0），发布后用 `npm view dsh-visualkit version dist.unpackedSize` 验证，并在一台干净机器上 `dsh plugin add dsh-visualkit` 冒烟。全过才打 tag。

## 发布

```powershell
# 1) 写 CHANGELOG：当前版本 + 日期，写清用户可见的新增 / 修复 / 变更
# 2) 把本地**未推送**的提交合成一个发布提交（一次推送只推一个提交，别刷屏）
git reset --soft origin/main
git add -A && git commit -m "chore(release): v0.0.1"
# 3) 打 tag 推送（CI 校验 tag 与 package.json 版本一致）
git tag v0.0.1
git push origin main --tags
```

本地提交保留历史；推 GitHub 前合并即可。**不改写已推送的历史**（不 force-push），GitHub 上原有的
推送记录不必清理。首次推送用单个初始提交，之后每次发布保持「一批改动 = 一个提交 + 一个 tag」，
细碎改动靠 CHANGELOG 说清。

`release.yml` 在 tag 推送后自动：`npm ci` → `npm test`（功能 + 打包内容；ubuntu 上渲染用例自 skip）→ 校验 `GITHUB_REF_NAME` 去掉 `v` 后等于 `package.json.version` → `npm publish --access public --provenance`。

一次性配置：仓库 Settings → Secrets and variables → Actions 添加 `NPM_TOKEN`（npm 网站 → Access Tokens → Granular，权限 `read-write`，仅限本包）。`--provenance` 要求 workflow 有 `id-token: write` 权限（已在 `release.yml` 声明），发布后 npm 页面显示 SLSA provenance 徽章。

## 回滚

npm 不允许删除已发布的版本（72 小时内可 unpublish，之后只能 deprecate）。线上问题应发新的 patch 版本，不要依赖撤回；确需标记废弃用 `npm deprecate dsh-visualkit@0.0.2 "contains a regression in design_render; use 0.0.1 or 0.0.3"`。

## 数据更新的特殊流程

改 `data/` 或 `vendor/` 时额外同步：

| 改了什么 | 必须同步 |
|---|---|
| 新增/升级图标集 | `THIRD_PARTY.md` 的版本与许可；`README.md` 的数据表；`test/contract.test.mjs` 的数量断言 |
| 新增素材 | `data/assets/manifest.json` 的 `license` 字段；CC-BY 类同步 `THIRD_PARTY.md` 的署名表 |
| 升级 vendored resvg | `vendor/resvg/` 全套（JS + `.node`）；`THIRD_PARTY.md` 版本；确认 `os`/`cpu` 仍匹配 |
| 升级 morphicons | 重新构建两个 IIFE（头部注释要写构建命令与版本）；跑 `morph` 全链路自测 |
