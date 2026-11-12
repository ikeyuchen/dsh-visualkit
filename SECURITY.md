# 安全策略

## 报告漏洞

不要开公开 issue，请用 GitHub 的私密渠道：仓库 → Security → Report a vulnerability（GitHub Security Advisories）。

报告里请写明：受影响的版本（`npm view dsh-visualkit version`）、复现步骤、影响范围。确认后在修复版本的
CHANGELOG 与 advisory 中说明。

## 支持范围

只维护 npm 上 `latest` 通道的最新版本。`beta` 通道用于验证，不承诺修复时限；0.x 期间不提供长期支持分支。

## 与安全相关的设计约束

- `package.json` 的 `dependencies` 必须为空。第三方能力以 vendored 形式放在 `vendor/`，版本与许可记录在 `THIRD_PARTY.md`。
- 除 `design_render action=html` 调用本机浏览器外，不启动外部进程；该约束由 `test/contract.test.mjs` 的独立性守卫断言。
- 渲染与体检全部在本地完成，不联网。
