/**
 * test/layout-integration.test.mjs — 新增规则接入 tool 层后的端到端行为。
 *
 * 本文件只测「接线对不对」：单规则模块自己有单测（layout-punct / layout-contrast /
 * metrics-structure），这里验三件事：
 *   1. 规则真的能从 layout_check 跑出来（不是模块写了但没接）
 *   2. 真实的误报已经修掉（JS 字符串不当文案 / 半透明背景不当纯色 / 页面容器不当按钮）
 *   3. 覆盖度字段（rulesRun / measured）能区分「测了且过了」与「根本没测」
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { call, tempDir, writeTree } from "./helpers.mjs";
import { auditSource } from "../lib/layouts/source.js";

const PAGE = (body, style = "") => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>body{font-size:16px;line-height:1.6;color:#333333;background:#FFFFFF}${style}</style>
</head><body>${body}</body></html>`;

/* -------------------------- 标点规则真的被接上了 -------------------------- */

test("接线：ui 模式能跑出 punct-* 发现（直引号 / 半角标点 / 三连点）", async (t) => {
	const dir = writeTree(tempDir(t, "wire-punct"), {
		"index.html": PAGE('<p class="a">他说"这个好",我同意...</p>', ".a{font-size:16px;line-height:1.6}")
	});
	const { value } = await call("layout_check", { action: "ui", root: dir });
	const rules = new Set(value.findings.map((f) => f.rule));
	assert.ok(rules.has("punct-straight-quote"), `应命中直引号，实际 ${[...rules].join(",")}`);
	assert.ok(rules.has("punct-halfwidth-cjk"), "应命中半角标点");
	assert.ok(rules.has("punct-three-dots"), "应命中三连点");
	for (const f of value.findings.filter((x) => x.rule.startsWith("punct-"))) {
		assert.ok(f.fix.length > 8, `${f.rule}: fix 应可执行`);
		assert.ok(f.where !== undefined && f.where !== "", `${f.rule}: 应有定位`);
	}
});

test("接线：JS 字符串不算界面文案（不会把插件自己的描述判成标点错）", async (t) => {
	// 关键回归：之前把 JS 里的字符串字面量当文案，导致扫自己的 lib/ 得到 100/100 bad
	const dir = writeTree(tempDir(t, "wire-js-not-copy"), {
		"tool.js": 'export const desc = "菜单: [找图标], 对勾: [勾选]. 使用 React 框架...";\n',
		"index.html": PAGE('<p class="a">正常的界面文案。</p>', ".a{font-size:16px;line-height:1.6}")
	});
	const r = await auditSource(dir);
	const punct = r.findings.filter((f) => f.rule.startsWith("punct-"));
	assert.deepEqual(punct.map((f) => f.rule), [], `JS 源码不应产生标点发现，实际 ${punct.map((f) => f.rule).join(",")}`);
});

test("接线：<code>/<pre> 里的标点被排除（业界公认的误报点）", async (t) => {
	const dir = writeTree(tempDir(t, "wire-code-block"), {
		"index.html": PAGE(
			'<pre><code>const s = "a--b"; // 他说"好"...</code></pre><p class="a">正文正常。</p>',
			".a{font-size:16px;line-height:1.6}"
		)
	});
	const r = await auditSource(dir);
	const bad = r.findings.filter((f) => /^(punct-straight-quote|punct-double-hyphen|punct-three-dots)$/.test(f.rule));
	assert.deepEqual(bad.map((f) => f.rule), [], "代码块里的引号 / -- / ... 是正确的，不应报");
});

/* -------------------------- 对比度规则真的被接上了 -------------------------- */

test("接线：ui 模式对比度——低对比报、高对比不报", async (t) => {
	const dir = writeTree(tempDir(t, "wire-contrast"), {
		"index.html": PAGE(
			'<p class="low">浅灰字</p><p class="ok">深色字</p>',
			".low{font-size:14px;line-height:1.6;color:#AAAAAA;background:#FFFFFF}.ok{font-size:14px;line-height:1.6;color:#222222;background:#FFFFFF}"
		)
	});
	const { value } = await call("layout_check", { action: "ui", root: dir });
	const contrast = value.findings.filter((f) => f.rule.startsWith("contrast-"));
	assert.ok(
		contrast.some((f) => f.rule === "contrast-wcag-aa"),
		`#AAAAAA on #FFFFFF 应命中 AA，实际 ${contrast.map((f) => f.rule).join(",")}`
	);
	assert.ok(value.metrics.measured.some((m) => m.includes("对比度")), `measured 应含对比度，实际 ${value.metrics.measured.join(",")}`);
	assert.equal(contrast.some((f) => f.message.includes("#222222")), false, "#222222 on #FFFFFF 不应被报");
});

test("接线：半透明背景不算对比度（否则会算出 1:1 假报）", async (t) => {
	const dir = writeTree(tempDir(t, "wire-alpha-bg"), {
		"index.html": PAGE(
			'<p class="glass">毛玻璃上的白字</p>',
			".glass{font-size:14px;line-height:1.6;color:#FFFFFF;background:rgba(255,255,255,0.18)}"
		)
	});
	const r = await auditSource(dir);
	assert.deepEqual(
		r.findings.filter((f) => f.rule === "contrast-wcag-aa").map((f) => f.message),
		[],
		"半透明背景不知道下层是什么，不能当成纯白报对比度"
	);
});

/* ------------------------ 结构与触摸目标真的被接上了 ------------------------ */

test("接线：标题跳级从 HTML 标记取文档顺序（不是 CSS 选择器）", async (t) => {
	const dir = writeTree(tempDir(t, "wire-heading"), {
		// CSS 只声明了 h1/h2，但 HTML 实际是 h1 → h3
		"index.html": PAGE(
			"<h1>标题</h1><h3>跳级小标题</h3>",
			"h1{font-size:40px;line-height:1.2}h2{font-size:24px;line-height:1.4}h3{font-size:18px;line-height:1.4}"
		)
	});
	const { value } = await call("layout_check", { action: "ui", root: dir });
	const skip = value.findings.find((f) => f.rule === "structure-heading-skip");
	assert.ok(skip !== undefined, `应命中标题跳级，实际 ${value.findings.map((f) => f.rule).join(",")}`);
	assert.match(skip.message, /h1.*h3/);
});

test("接线：触摸目标只判交互元素（普通容器不算按钮）", async (t) => {
	const dir = writeTree(tempDir(t, "wire-touch"), {
		"index.html": PAGE(
			'<button class="tiny">确定</button><div class="card">卡片</div>',
			".tiny{font-size:14px;line-height:1.6;width:100px;height:20px}.card{width:100px;height:20px}"
		)
	});
	const { value } = await call("layout_check", { action: "ui", root: dir });
	const touch = value.findings.filter((f) => f.rule === "structure-touch-too-small");
	assert.equal(touch.length, 1, `只应报 button，不报 div（实际 ${touch.length} 条）`);
	assert.match(touch[0].message, /100×20px/);
});

/* ------------------ Tailwind 字号（实测 Flow-Pilot 漏报的坑） ------------------ */

test("接线：Tailwind 任意值字号必须被读到（text-[11.5px] 这类）", async (t) => {
	// 实测教训：Flow-Pilot 100% 用 text-[Npx] 写字号，CSS 里只有 3 个值。
	// 不解析 Tailwind 会得出「1 档字号、无层级」的反向错误结论。
	// 按 Flow-Pilot 的真实分布复现：正文 12px 出现次数最多（众数），
	// 标题 19px 只用几次，中间还有 11/11.5/13.5/15.5 这些 0.5px 步进的档位。
	const dir = writeTree(tempDir(t, "wire-tailwind"), {
		"Page.tsx": `export const P = () => <div>
${'  <p className="text-[12px]">正文内容</p>\n'.repeat(8)}${'  <span className="text-[11px]">次要</span>\n'.repeat(3)}${'  <span className="text-[11.5px]">次要</span>\n'.repeat(2)}${'  <em className="text-[13.5px]">卡片标题</em>\n'.repeat(2)}  <span className="text-[15.5px]">小节</span>
  <span className="text-[14.5px]">次小节</span>
  <h1 className="text-[19px]">页面标题</h1>
</div>;\n`
	});
	const r = await auditSource(dir);
	assert.deepEqual(
		r.metrics.fontSizes,
		[11, 11.5, 12, 13.5, 14.5, 15.5, 19],
		`应读到 7 档 Tailwind 字号，实际 [${r.metrics.fontSizes.join(",")}]`
	);
	assert.equal(r.metrics.bodySize, 12, `众数应是 12px（出现 8 次），实际 ${r.metrics.bodySize}`);
	assert.equal(r.metrics.scaleRatio, 1.58, `19/12 = 1.58，实际 ${r.metrics.scaleRatio}`);
	assert.ok(r.findings.some((f) => f.rule === "S1"), "梯级 1.58× < 1.6 应命中 S1");
	assert.ok(
		r.findings.some((f) => f.rule === "S1" && /档位过多/.test(f.message)),
		`0.5px 步进的 7 档字号应同时报「档位过多」，实际 ${r.findings.filter((f) => f.rule === "S1").map((f) => f.message).join(" | ")}`
	);
});

test("接线：Tailwind 命名字号（text-sm / text-2xl）也能识别", async (t) => {
	const dir = writeTree(tempDir(t, "wire-tailwind-named"), {
		"Card.tsx": 'export const C = () => <div><h1 className="text-2xl">大标题</h1><p className="text-sm">正文</p></div>;\n'
	});
	const r = await auditSource(dir);
	assert.deepEqual(r.metrics.fontSizes, [14, 24], `text-sm=14 / text-2xl=24，实际 [${r.metrics.fontSizes.join(",")}]`);
});

test("接线：测试文件里的字号/文案不计入（fixture 不是产品代码）", async (t) => {
	const dir = writeTree(tempDir(t, "wire-test-file"), {
		"Page.test.tsx": 'export const P = () => <div className="text-[99px]">a"b,c...</div>;\n',
		"Page.tsx": 'export const P = () => <div className="text-[12px]">正常</div>;\n'
	});
	const r = await auditSource(dir);
	assert.equal(r.metrics.fontSizes.includes(99), false, `测试文件里的 99px 不应计入，实际 [${r.metrics.fontSizes.join(",")}]`);
	assert.deepEqual(r.findings.filter((f) => f.rule.startsWith("punct-")).map((f) => f.rule), [], "测试文件里的引号不应报标点");
});

/* ---------------- 声明豁免（.design-intent.json，与 taste_check 同语义） ---------------- */

test("intent：allow 里的规则不计分、进 exempted、保留 reason", async (t) => {
	// 实测动机（Flow-Pilot）：h5/h6 收敛到正文大小是有意取舍，写了理由就不该扣分。
	const dir = writeTree(tempDir(t, "intent-allow"), {
		"a.css": "body{font-size:12px;line-height:1.6}h5{font-size:13.5px}h6{font-size:13.5px}",
		".design-intent.json": JSON.stringify({ allow: ["S9"], reason: "h5/h6 未做组件映射" })
	});
	const r = await auditSource(dir);
	assert.deepEqual(r.metrics.exempted, ["S9"], `S9 应被豁免，实际 ${JSON.stringify(r.metrics.exempted)}`);
	assert.equal(r.findings.some((f) => f.rule === "S9"), false, "S9 不应出现在 findings");
	assert.ok(r.findings.some((f) => f.rule === "S1"), "未声明的 S1 仍应报");
	assert.equal(r.intent.allow[0], "S9");
	assert.equal(r.intent.reason, "h5/h6 未做组件映射", "reason 应透传，让豁免可追溯");
});

test("intent：没有声明文件时行为不变（不报错、无 exempted 字段）", async (t) => {
	const dir = writeTree(tempDir(t, "intent-none"), { "a.css": "body{font-size:12px;line-height:1.6}h5{font-size:13.5px}" });
	const r = await auditSource(dir);
	assert.equal(r.metrics.exempted, undefined, "无声明时不应有 exempted 字段");
	assert.equal(r.intent, undefined, "无声明时不应有 intent 段");
	assert.ok(r.findings.some((f) => f.rule === "S9"), "未声明时 S9 照常报");
});

test("intent：坏 JSON / 声明了不存在的规则都不会让体检失败", async (t) => {
	const broken = writeTree(tempDir(t, "intent-broken"), {
		"a.css": "body{font-size:12px;line-height:1.6}",
		".design-intent.json": "{ 这不是 JSON"
	});
	const r = await auditSource(broken);
	assert.equal(typeof r.score, "number", "坏声明不应让体检抛错");
	assert.equal(r.metrics.exempted, undefined, "坏声明等于没有豁免");

	const ghost = writeTree(tempDir(t, "intent-ghost"), {
		"a.css": "body{font-size:12px;line-height:1.6}",
		".design-intent.json": JSON.stringify({ allow: ["NO-SUCH-RULE"] })
	});
	const g = await auditSource(ghost);
	assert.equal(g.metrics.exempted, undefined, "声明了不存在的规则不算豁免（不应列出来）");
});

/* ------------------------------ 覆盖度 ------------------------------ */

test("覆盖度：区分「测了且过了」与「根本没测」", async (t) => {
	const empty = writeTree(tempDir(t, "wire-empty"), { "readme.md": "# 没有前端代码\n" });
	const e = await auditSource(empty);
	assert.equal(e.metrics.rulesRun, 0, "空目录 rulesRun 应为 0");
	assert.deepEqual(e.metrics.measured, [], "空目录 measured 应为空");
	assert.equal(e.findings.some((f) => f.rule === "S0"), true, "应有 S0 说明没样本");

	const ok = writeTree(tempDir(t, "wire-measured"), {
		"index.html": PAGE('<h1>标题</h1><p class="a">正文内容。</p>', "h1{font-size:40px;line-height:1.2}.a{font-size:16px;line-height:1.6}")
	});
	const o = await auditSource(ok);
	assert.ok(o.metrics.rulesRun > 0, "正常页面 rulesRun 应 > 0");
	assert.ok(o.metrics.measured.length > 0, "正常页面 measured 应非空");
});

test("覆盖度：svg 模式也报 rulesRun / measured，空图不伪装成干净", async () => {
	const { value } = await call("layout_check", {
		action: "svg",
		input: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"></svg>'
	});
	assert.equal(value.metrics.rulesRun, 0, "空图 rulesRun 应为 0");
	assert.equal(value.metrics.contentEmpty, true, "应标 contentEmpty");
	assert.ok(value.findings.some((f) => f.rule === "G0-no-text"), "应明说没有文字");
});
