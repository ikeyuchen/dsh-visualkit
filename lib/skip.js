/**
 * lib/skip.js — 「哪些目录/文件不参与体检」的**单一来源**。
 *
 * 为什么必须共用：之前 taste.js 与 layouts/source.js 各写了一份 SKIP_DIRS，
 * 修了一边另一边就漏。实测（2026-11-07，dsh-visualkit 自查）：
 * layout_check 已经跳过 test/ 了，但 taste 还在扫 test/fixtures/taste/ai-default/，
 * 把那个「故意做成 AI 味」的样本算进自己的分数 → 自己的仓库被报 12 条 AI 味。
 */

/** 不看即跳过的目录名（精确匹配）。 */
export const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	"vendor",
	"coverage",
	".next",
	".nuxt",
	"out",
	".output",
	"test",
	"tests",
	"__tests__",
	"fixtures",
	"spec",
	// 开发/构建脚本不是界面代码：实测（Colibri）scripts/check.js、repolint.js、
	// screenshot*.js 里的 ✓✗ 标记被算成“emoji 当图标”——那些是跑 CI 的脚本，
	// 根本不会渲染到界面上。
	"scripts",
	"script",
	"tools",
	"ci",
	// 临时/生成产物：实测（Colibri）tmp/viz/*.html 是脚本生成的报告
	"tmp",
	".tmp",
	".temp",
	"temp"
]);

/**
 * 目录是否应跳过：除精确名外，还要盖住 `test_audio`、`test-e2e`、`*-test` 这类命名。
 * 实测（Echo）：`test_audio/bug-repro/*.html` 里的断言文本被报成标点问题。
 */
export function isSkippableDir(name) {
	if (typeof name !== "string" || name === "") return false;
	if (SKIP_DIRS.has(name)) return true;
	const lower = name.toLowerCase();
	return lower.startsWith("test_") || lower.startsWith("test-") || lower.endsWith("_test") || lower.endsWith("-test");
}

/**
 * 测试文件本身：`foo.test.tsx` 里的字符串是**样本数据**（故意写错的文案、
 * markdown fixture），拿它当界面文案判标点/混排是纯误报。
 */
export const TEST_FILE_RE = /(?:^|[\\/])[^\\/]*\.(?:test|spec)\.[jt]sx?$/i;
