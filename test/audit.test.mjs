// test/audit.test.mjs — taste_check action=audit（图标规范巡检）的发布前功能测试。
//
// 覆盖：universal 的 emoji 判据（含注释/字符串的误报面，作为「判据可疑点」记录）、
// echo 的 E1/E2/E0、colibri 的 C0/C1/C2/C3、preset 的 auto 回落与显式覆盖、
// maxFiles/maxFindings 上限与 truncated 口径、跳过目录、空目录/缺 root 边界、
// 输出结构自洽与文本渲染。
//
// 回归锚点（2026-11-07 已修复，本文件转为真断言，防止回退）：
//   1) root 传单文件时必须真的扫该文件；
//   2) >2MB 文件改读前 2MB 继续扫，filesScanned 与真实扫描一致。
// 残留缺陷（仍用 test(..., { todo }) 记录，不改 lib/、不放宽断言）：
//   单文件 root 的 finding.file 为 ""（应回退到 basename）。
//
// 路径说明：audit 的 findings.file 用平台分隔符（Windows 为 `\`），taste 用 `/`。
// 本文件统一用 posix() 归一后再断言，避免把「分隔符风格」误判成 bug。
import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { call, rejects, tempDir, writeTree } from "./helpers.mjs";
import { audit, detectPreset } from "../lib/audit.js";

const posix = (path) => String(path).split(/[\\/]+/).join("/");
const byRule = (value, rule) => value.findings.filter((finding) => finding.rule === rule);

test("universal：emoji 当图标报 error，file/line 指向真实位置", async (t) => {
	const dir = writeTree(tempDir(t, "universal-hit"), {
		"src/app.js": "// 第一行\n// 第二行\nconst label = '🟢 运行中';\n",
		"index.html": "<p>干净页面</p>\n"
	});
	const { value } = await call("taste_check", { action: "audit", root: dir });
	assert.equal(value.preset, "universal", "无项目标记时应回落到 universal");
	assert.equal(value.findings.length, 1, "只有一个 emoji");
	const finding = value.findings[0];
	assert.equal(finding.severity, "error", "emoji 当图标必须是 error");
	assert.equal(finding.rule, "U1", "universal 的规则号是 U1");
	assert.equal(posix(finding.file), "src/app.js", "file 应为相对 root 的路径");
	assert.equal(finding.line, 3, "line 应指向 emoji 所在行");
	assert.equal(value.counts.error, 1, "counts 与 findings 口径一致");
});

test("universal 反例：无 emoji 工程 0 findings、counts 全零、文本显式报 no findings", async (t) => {
	const dir = writeTree(tempDir(t, "universal-clean"), { "src/a.js": "const ok = 1;\n", "b.html": "<p>干净</p>\n" });
	const { value, text } = await call("taste_check", { action: "audit", root: dir });
	assert.deepEqual(value.findings, [], "无 emoji 不应有 finding");
	assert.deepEqual(value.counts, { error: 0, warn: 0, info: 0 }, "counts 三个维度都应归零");
	assert.ok(text.includes("no findings"), "干净报告要显式说 no findings，不能沉默");
});

test("universal 判据可疑点：注释与字符串文案里的 emoji 同样报 error", async (t) => {
	// 判据是「代码/模板文件中的 emoji 全部报 error」，不区分图标位与文案：
	// 真实项目里 `// 🟢 表示成功` 这种状态注释会被误报，属于对真实项目不友好的口径。
	const dir = writeTree(tempDir(t, "universal-text"), {
		"a.js": "// 🟢 状态说明（不是图标位）\nconst label = '🟢 运行中';\n"
	});
	const { value } = await call("taste_check", { action: "audit", root: dir });
	assert.equal(value.findings.length, 2, "注释与字符串各算一次（规则不做语义区分）");
	assert.deepEqual(value.findings.map((finding) => finding.line), [1, 2], "两处行号都要准");
	assert.ok(value.findings.every((finding) => finding.severity === "error"), "文案 emoji 也被判 error（误报面）");
});

test("preset：auto 无法识别回落 universal；显式 preset 覆盖自动识别；detectPreset 判据", async (t) => {
	const plain = writeTree(tempDir(t, "preset-plain"), { "src/a.js": "const a = 1;\n" });
	assert.equal((await call("taste_check", { action: "audit", root: plain })).value.preset, "universal", "auto 失败应回落 universal");

	const echo = writeTree(tempDir(t, "preset-echo"), {
		"STYLE_GUIDE.md": "# 图标规范\n",
		"frontend/src/App.vue": "<template><b>🟢</b></template>\n"
	});
	assert.equal(detectPreset(echo), "echo", "STYLE_GUIDE.md 是 echo 标记");
	assert.equal((await call("taste_check", { action: "audit", root: echo })).value.preset, "echo", "auto 应识别成 echo");

	const colibri = writeTree(tempDir(t, "preset-colibri"), {
		"js/ui.js": "const ICONS = {\n  home: '<path d=\"M3 3h18v18H3z\"/>'\n};\n",
		"index.html": '<span data-morph="home"></span>\n'
	});
	assert.equal(detectPreset(colibri), "colibri", "js/ui.js 是 colibri 标记");
	assert.equal((await call("taste_check", { action: "audit", root: colibri })).value.preset, "colibri");

	const overridden = (await call("taste_check", { action: "audit", root: echo, preset: "universal" })).value;
	assert.equal(overridden.preset, "universal", "显式 preset 应覆盖 auto 识别");
});

test("echo：E1 emoji 违例 + E2 静态 MorphIcon；两态三元绑定不误报", async (t) => {
	const dir = writeTree(tempDir(t, "echo-rules"), {
		"frontend/STYLE_GUIDE.md": "# 图标规范 §3\n",
		"frontend/src/App.vue":
			"<template>\n  <button>🟢 运行</button>\n  <MorphIcon :icon=\"'play'\" />\n" +
			"  <MorphIcon :icon=\"open ? 'play' : 'pause'\" />\n</template>\n"
	});
	const { value } = await call("taste_check", { action: "audit", root: dir });
	const e1 = byRule(value, "E1");
	const e2 = byRule(value, "E2");
	assert.equal(e1.length, 1, "emoji 应报 E1");
	assert.equal(e1[0].severity, "error", "E1 是 error");
	assert.equal(e1[0].line, 2, "E1 行号应指向 emoji 所在行");
	assert.equal(e2.length, 1, "只有静态绑定报 E2，两态三元不报");
	assert.equal(e2[0].line, 3, "E2 行号应指向标签行");
});

test("echo：没有 src/ 文件时给 E0 warn（可行动提示，不是静默通过）", async (t) => {
	const dir = writeTree(tempDir(t, "echo-empty"), { "STYLE_GUIDE.md": "# 规范\n" });
	const { value } = await call("taste_check", { action: "audit", root: dir, preset: "echo" });
	assert.equal(value.findings.length, 1, "必须给出 E0 提示而不是静默通过");
	assert.equal(value.findings[0].rule, "E0");
	assert.equal(value.findings[0].severity, "warn");
});

test("colibri：C1 字典自检 + C2 四种引用形态核对 + C3 动态引用 info", async (t) => {
	const dir = writeTree(tempDir(t, "colibri-rules"), {
		"js/ui.js":
			"const ICONS = {\n  home: '<path d=\"M3 3h18v18H3z\"/>',\n" +
			"  broken: '<g><path d=\"M0 0h1\"/></g>',\n  empty: ''\n};\n",
		"index.html": '<div>\n  <span data-morph="home"></span>\n  <span data-morph="ghost"></span>\n</div>\n',
		"js/app.js":
			"morphTo(document.querySelector('#x'), 'ghost2');\nmorphTo(el, dynamicName);\n" +
			"UI.svg('home');\nUI.svg('absent');\nUI.morphIcon('nope');\n"
	});
	const { value } = await call("taste_check", { action: "audit", root: dir });
	assert.equal(value.dictSize, 3, "ICONS 应解析出 3 条");
	const c1 = byRule(value, "C1");
	assert.equal(c1.length, 2, "g 标签与空条目各一条 C1");
	assert.ok(c1.every((finding) => finding.severity === "error" && posix(finding.file) === "js/ui.js"), "C1 指向字典文件且是 error");
	const c2 = byRule(value, "C2").map((finding) => `${posix(finding.file)}:${finding.line}`).sort();
	assert.deepEqual(c2, ["index.html:3", "js/app.js:1", "js/app.js:4", "js/app.js:5"], "data-morph/morphTo/UI.svg/UI.morphIcon 四种形态都不能漏");
	const c3 = byRule(value, "C3");
	assert.equal(c3.length, 1, "变量传名报 C3");
	assert.equal(c3[0].severity, "info", "C3 是 info（静态核对不可达）");
	assert.equal(value.counts.error + value.counts.warn + value.counts.info, value.findings.length, "counts 与 findings 自洽");
});

test("colibri：合规项目 0 findings；缺 js/ui.js 时 C0 error 且 filesScanned 为 0", async (t) => {
	const ok = writeTree(tempDir(t, "colibri-ok"), {
		"js/ui.js": "const ICONS = {\n  home: '<path d=\"M3 3h18v18H3z\"/>',\n  play: '<circle cx=\"12\" cy=\"12\" r=\"9\"/>'\n};\n",
		"index.html": '<span data-morph="home"></span><span data-morph="play"></span>\n',
		"js/app.js": "morphTo(el, 'play');\n"
	});
	const good = (await call("taste_check", { action: "audit", root: ok })).value;
	assert.deepEqual(good.findings, [], "合规项目应 0 findings");
	assert.deepEqual(good.counts, { error: 0, warn: 0, info: 0 }, "合规项目 counts 全零");

	const missing = (await call("taste_check", { action: "audit", root: tempDir(t, "colibri-c0"), preset: "colibri" })).value;
	assert.equal(missing.filesScanned, 0);
	assert.equal(missing.findings.length, 1, "缺 js/ui.js 必须报 C0");
	assert.equal(missing.findings[0].rule, "C0");
	assert.equal(posix(missing.findings[0].file), "js/ui.js", "C0 指向缺失的稳定路径");
});

test("上限：maxFiles 截断文件数，maxFindings 截断 findings 且 truncated 口径自洽", async (t) => {
	const dir = tempDir(t, "limit");
	for (let i = 0; i < 6; i += 1) writeTree(dir, { [`f${i}.js`]: "const a = '🟢🟢';\n" });
	const cappedFiles = await audit(dir, "universal", { maxFiles: 4 });
	assert.equal(cappedFiles.filesScanned, 4, "filesScanned 不得超过 maxFiles");

	const cappedFindings = await audit(dir, "universal", { maxFindings: 3 });
	assert.equal(cappedFindings.findings.length, 3, "findings 必须截到上限");
	assert.equal(cappedFindings.truncated, true, "超上限必须标 truncated");

	const full = await audit(dir, "universal", { maxFindings: 60 });
	assert.equal(full.truncated, false, "未超上限时 truncated 为 false");
});

test("跳过：node_modules / vendor / dist / build / .git 不计入", async (t) => {
	const dir = writeTree(tempDir(t, "audit-skip"), {
		"node_modules/pkg/a.js": "const a = '🟢';\n",
		"vendor/lib.js": "const b = '🔴';\n",
		"dist/bundle.js": "const c = '🟡';\n",
		"build/out.js": "const d = '🟠';\n",
		".git/x.html": "<b>🔵</b>\n",
		"src/app.js": "const ok = 1;\n"
	});
	const { value } = await call("taste_check", { action: "audit", root: dir });
	assert.equal(value.filesScanned, 1, "只应扫到 src/app.js");
	assert.deepEqual(value.findings, [], "依赖/构建目录里的 emoji 不得计入");
	assert.equal(value.emojiTotal, 0, "emojiTotal 也不得虚报");
});

test("边界：空目录不崩、counts 全零；root 不存在报错清晰且带绝对路径", async (t) => {
	const empty = (await call("taste_check", { action: "audit", root: tempDir(t, "audit-empty") })).value;
	assert.equal(empty.filesScanned, 0, "空目录扫到 0 个文件");
	assert.deepEqual(empty.findings, [], "空目录不崩也不该有 finding");
	assert.deepEqual(empty.counts, { error: 0, warn: 0, info: 0 });

	const missing = join(tempDir(t, "audit-missing"), "nope");
	const error = await rejects(() => call("taste_check", { action: "audit", root: missing }), /root 不存在/, "root 不存在");
	assert.ok(error.message.includes(missing), "错误消息应带上解析后的绝对路径（可行动）");
});

test("输出结构：severity 合法、counts 与 findings 自洽、文本逐条渲染", async (t) => {
	const dir = writeTree(tempDir(t, "audit-output"), {
		"STYLE_GUIDE.md": "# 规范\n",
		"frontend/src/App.vue": "<template>\n  <button>🟢 运行</button>\n  <MorphIcon :icon=\"'play'\" />\n</template>\n"
	});
	const { value, text } = await call("taste_check", { action: "audit", root: dir });
	assert.ok(value.findings.length > 0, "该样本应同时有 E1/E2");
	for (const finding of value.findings) {
		assert.ok(["error", "warn", "info"].includes(finding.severity), `非法 severity: ${finding.severity}`);
		assert.ok(Number.isInteger(finding.line) && finding.line >= 0, "finding.line 必须是 ≥0 的整数");
	}
	assert.equal(value.counts.error + value.counts.warn + value.counts.info, value.findings.length, "counts 总和必须等于 findings 数");
	assert.equal(typeof value.truncated, "boolean", "truncated 必须是布尔");
	assert.ok(text.includes(`[audit:${value.preset}]`) && text.includes(`${value.filesScanned} file(s)`), "文本头应报 preset 与文件数");
	assert.match(text, /- \[(error|warn|info)\] [A-Z]\d+ /, "文本应逐条渲染 severity/rule/file:line");
});

/* ---------------------------- 单文件 / 大文件 ---------------------------- */

// taste_check 的 root 参数描述是「File or directory」：单文件 root 必须真的扫。
test("单文件 root：真的扫描该文件并给出 file/line", async (t) => {
	const dir = writeTree(tempDir(t, "audit-file-root"), { "page.html": "<b>🟢 运行中</b>\n" });
	const { value } = await call("taste_check", { action: "audit", root: join(dir, "page.html") });
	assert.equal(value.filesScanned, 1, "单文件 root 应扫 1 个文件");
	assert.equal(value.findings.length, 1, "文件里的 emoji 必须被报出来");
	assert.equal(value.findings[0].rule, "U1");
	assert.equal(value.findings[0].severity, "error");
	assert.equal(value.findings[0].line, 1, "行号应指向 emoji 所在行");
});

// PER_FILE_CAP：>2MB 文件改为「读前 2MB 继续扫」，前缀里的 emoji 必须报，
// 且 filesScanned 与实际扫描一致（不再出现「计数了却没扫」）。
test("PER_FILE_CAP：>2MB 文件读前 2MB 继续扫，filesScanned 与真实扫描一致", async (t) => {
	const dir = tempDir(t, "audit-big");
	writeFileSync(join(dir, "huge.js"), `const emoji = '🟢';\n${"x".repeat(2 * 1024 * 1024 + 16)}\nconst tail = '🔴';\n`);
	writeFileSync(join(dir, "small.js"), "const ok = 1;\n");
	const { value } = await call("taste_check", { action: "audit", root: dir });
	assert.equal(value.filesScanned, 2, "超过 2MB 的文件仍算「已扫描」，不能虚报也不能跳过");
	assert.equal(value.emojiTotal, 1, "只扫前 2MB：前缀 emoji 命中，尾部 emoji 不计入");
	assert.equal(value.findings[0].line, 1, "前缀命中行号应准确");
});

/* -------------------------------- 残留缺陷 -------------------------------- */

test("测试/样本目录不参与巡检（fixture 里的 emoji 不得误报）", async (t) => {
	const dir = tempDir(t, "audit-skip-tests");
	writeTree(dir, {
		"src/page.vue": "<template><div>ok</div></template>\n",
		"test/a.mjs": 'const s = "🟢 fixture 里的样本 emoji";\n',
		"tests/b.mjs": 'const s = "🔴 另一个样本";\n',
		"fixtures/c.js": 'const s = "⚠ 样本";\n'
	});
	const { value } = await call("taste_check", { action: "audit", root: dir });
	assert.equal(value.filesScanned, 1, `只应扫到 src/page.vue，实际 ${value.filesScanned} 个文件`);
	assert.equal(value.counts.error, 0, `测试/样本目录不应被计为违规：${JSON.stringify(value.findings)}`);
});

test("单文件 root 的 finding.file 回退到文件名", async (t) => {
	const dir = writeTree(tempDir(t, "audit-file-rel"), { "page.html": "<b>🟢 运行中</b>\n" });
	const { value } = await call("taste_check", { action: "audit", root: join(dir, "page.html") });
	assert.equal(value.findings.length, 1);
	assert.equal(value.findings[0].file, "page.html", "单文件 root 的 finding.file 应是文件名，不能是空串或绝对路径");
});
