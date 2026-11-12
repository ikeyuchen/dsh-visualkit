# 发布流程

范围：版本策略、发布通道、发布与回滚步骤，以及数据更新的同步项。

## 版本策略

| 变更 | 版本位 |
|---|---|
| 修 bug、改文档、换数据版本 | `0.0.x`（patch） |
| 模型可见契约变化：工具名、参数、枚举、规则阈值、分数口径 | `0.x.0`（minor） |
| 测试版 | `X.Y.Z-beta.N` 或 `X.Y.Z-rc.N` |
| 契约稳定后 | `1.0.0` |

当前处于 `0.0.x`：只接受不改变模型契约的改动，动契约升 `0.x.0`。改阈值算契约变更，用户会跨版本比较分数，口径变化后不可比。新增规则同样算，分母变化，分数随之变化。只改描述文案不算契约变更，但文案占常驻 token，改完要重跑发布检查确认预算。

## 发布通道

| 通道 | 版本号 | npm tag | git tag |
|---|---|---|---|
| 正式 | `X.Y.Z` | `latest` | `vX.Y.Z` |
| 测试 | `X.Y.Z-beta.N` 或 `X.Y.Z-rc.N` | `beta` | `vX.Y.Z-<预发布>` |

版本号带 `-` 自动发 `beta`，不带后缀才发 `latest`；测试版不覆盖 `latest`，否则正式用户会被升到未验证版本。

- 安装测试版（发布 `beta` 版本之后）：`dsh plugin --profile <profile> add dsh-visualkit@beta`；切回正式版用 `@latest`。
- 晋级：版本号去掉后缀，CHANGELOG 合并 beta 条目，打 `vX.Y.Z` 发布。
- 作废：`npm deprecate dsh-visualkit@X.Y.Z-beta.N "beta withdrawn; use @latest"`；清空通道用 `npm dist-tag rm dsh-visualkit beta`。

## 发布前检查

静态项与全套测试由 `prepublishOnly` 执行：`npm run release:check && npm test`。`release:check` 逐项判定：版本号三处一致（`package.json` / `package-lock.json` / `CHANGELOG.md`）· 无运行时依赖 · 递归扫描 `lib/`（除 `render-html.js`）无外部进程 · 默认档 ≤3600 / 全量档 ≤4200 常驻预算 · 必需文件齐备 · `files` 白名单不含开发期文件。

`release:check` 不覆盖的两项单独跑：

```powershell
npm run selfcheck   # 本机真实项目的误报回归，只在"以前不报、现在报"时失败
npm run test:pack   # 真 npm pack → 解包 → 拆包副本跑一次
```

覆盖率门禁（`npm run test:coverage`）只在 CI 的 windows 全量作业执行——ubuntu 作业跳过渲染与位图用例，覆盖率不代表全量，只跑 `npm test` 与 `release:check`；门禁不进入 `prepublishOnly`，发布作业本身在 windows 上跑 `release:check && npm test`，渲染用例不会跳过。

人工项：新工具与新参数在 `README.md` 里有位置；有意变更的判据在 `docs/` 里记了原因；按 `README.md` 任一方式安装并重启 DSH 冒烟，CLI 必须带 `--profile`，缺了直接报错。

## 发布

```powershell
# 1) 写 CHANGELOG：当前版本 + 日期
# 2) 合并本地未推送的提交
git reset --soft origin/main
git add -A && git commit -m "chore(release): vX.Y.Z"   # beta 写 vX.Y.Z-beta.N
# 3) 打 tag 推送，CI 校验 tag 与 package.json 版本一致
git tag vX.Y.Z                                          # beta 用 vX.Y.Z-beta.N
git push origin main --tags
```

`release.yml` 在 tag 推送后执行：`npm ci` → 校验 tag 与 `package.json` 版本一致 → `npm publish --access public --provenance --tag latest|beta`（版本号带 `-` 时自动选 `beta`）。测试与静态检查由 `prepublishOnly`（`release:check && npm test`）在发布时执行一次，不重复跑。作业跑在 windows-latest 上：ubuntu 会跳过渲染用例，而发布前必须真跑。手动触发（`workflow_dispatch`）只接受 tag，从分支发起会直接失败。

一次性配置：仓库 Settings → Secrets and variables → Actions 添加 `NPM_TOKEN`（npm 网站 → Access Tokens → Granular，权限 `read-write`，仅限本包）。`--provenance` 要求 workflow 有 `id-token: write` 权限，`release.yml` 已声明。

## 回滚

npm 不允许删除已发布的版本，72 小时内可 unpublish，之后只能 deprecate。线上问题应发新的 patch 版本，确需标记废弃用 `npm deprecate dsh-visualkit@X.Y.Z "…"`。

## 数据更新的特殊流程

改 `data/` 或 `vendor/` 时额外同步：

| 改了什么 | 必须同步 |
|---|---|
| 新增/升级图标集 | `THIRD_PARTY.md` 的版本与许可；`README.md` 的数据表；`test/contract.test.mjs` 的数量断言 |
| 新增素材 | `data/assets/manifest.json` 的 `license` 字段；CC-BY 类同步 `THIRD_PARTY.md` 的署名表 |
| 升级 vendored resvg | `vendor/resvg/` 全套（JS + `.node`）；`THIRD_PARTY.md` 版本；确认 `os` / `cpu` 仍匹配 |
| 升级 morphicons | 重新构建两个 IIFE，头部注释写构建命令与版本；跑 `morph` 全链路自测 |
