# 贡献指南

## 环境

- Node 22：版本以 `.nvmrc` 为准，CI 也读这个文件。
- Windows x64：`vendor/resvg` 只带 win32-x64 原生绑定，其他平台上渲染用例会自动跳过。

## 流程

1. 从 `main` 开分支，一次改动只做一件事。
2. 改完跑：

   ```powershell
   npm test
   npm run test:coverage   # CI 的覆盖率门禁（行 85 / 分支 80 / 函数 90）
   npm run release:check
   npm run selfcheck       # 有本机语料时，盯误报回归
   ```

   动了 `lib/` 再连跑一次 `npm test` 确认没有不确定性；动了 `data/` 或 `vendor/` 时同步 `THIRD_PARTY.md`。覆盖率门禁在 CI 的 ubuntu 作业执行，本地不通过会挡住 PR。
3. 提交信息按 `<type>(<scope>): <subject>`，细则见 `AGENTS.md`。
4. 开 PR 时按 `.github/PULL_REQUEST_TEMPLATE.md` 填写，贴出实际命令与输出摘要。

## 约束

`AGENTS.md` 的硬约束对人和 AI 代理同样有效：零运行时依赖、`lib/` 不引入外部进程、新增数据文件三处同步、
规则表与检测器同源。改判据前先读 `docs/ARCHITECTURE.md` 的三条不变量。

## 发布

只有维护者能发布，流程见 `docs/RELEASING.md`。
