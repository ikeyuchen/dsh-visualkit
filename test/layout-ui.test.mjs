// test/layout-ui.test.mjs — layout_check action=ui（UI 源码排版体检）的发布前功能测试。
//
// 覆盖：S1–S9 每条规则的命中与「不该命中」反例、干净/坏样本的分档、单文件 root、
// 空目录与跳过目录、确定性与输出字段、错误路径。一半以上用例走工具层
// （call("layout_check", {action:"ui", root})），其余直接 import auditSource 做单测。
//
// 设计基准（2026-11-07 实测）：
//   干净样本 score=0（4 档字号 16/26/40/64、行高 1.6、max-width 640、2 个字体栈、
//   无 justify/长段落居中/大字距/无空格混排）；AI 默认样本 score=100（12px 正文、
//   行高 1.2、10 档字号、justify、长段落居中、letter-spacing 2px、中英混排无空格）。
//   断言消息一律中文，失败时能直接看出是哪条排版底线破了。
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";

import { call, rejects, tempDir, writeTree } from "./helpers.mjs";
import { auditSource } from "../lib/layouts/source.js";

/* ------------------------------- 参考样本 ------------------------------- */

/** 干净样本：4 档字号（≈1.6× 跳变）、正文行高 1.6、栏宽 640px、2 个字体栈。 */
const CLEAN = {
	"app.css": [
		":root { --fs-body: 16px; }",
		'body { font-size: 16px; line-height: 1.6; max-width: 640px; font-family: "Noto Sans SC", "PingFang SC", sans-serif; }',
		"p { font-size: 16px; line-height: 1.6; }",
		"h1 { font-size: 64px; }",
		"h2 { font-size: 40px; }",
		"h3 { font-size: 26px; }",
		"h4 { font-size: 26px; }",
		'code { font-family: ui-monospace, "SFMono-Regular", monospace; }'
	].join("\n"),
	"index.html": [
		'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="app.css"></head>',
		"<body>",
		"<h1>排版体检</h1>",
		"<h2>字号梯级</h2>",
		'<p class="lead">使用 React 框架搭建的页面，中文与英文之间保留空格。</p>',
		"<p>行高 1.6 适合中文阅读，正文栏宽控制在 40 字左右。</p>",
		"</body></html>"
	].join("\n")
};

const LONG_CJK =
	"这是一段很长的中文段落，用来演示居中对齐时中文长文本会被拉成一条很难阅读的横线，编辑排版里通常应该左对齐而不是居中，因为中文没有词间空格，居中会让每一行的起点不一致。";
const JUSTIFY_CJK =
	"这是一段两端对齐的中文段落，中英文混排时会出现很大的空隙，比如使用React框架和TypeScript类型系统，看起来会非常不专业。";

/** AI 默认产物样本：12px 正文 + 行高 1.2 + 10 档字号 + justify + 长段落居中 + 字距 2px + 混排无空格。 */
const BAD = {
	"app.css": [
		"body { font-size: 12px; line-height: 1.2; max-width: 960px; font-family: Inter, sans-serif; }",
		"p { font-size: 12px; }",
		".card { font-size: 12px; }",
		"h1 { font-size: 13px; }",
		"h2 { font-size: 14px; }",
		"h3 { font-size: 15px; }",
		"h4 { font-size: 16px; }",
		"h5 { font-size: 17px; }",
		"h6 { font-size: 18px; }",
		".small { font-size: 9px; }",
		".micro { font-size: 10px; }",
		".note { font-size: 11px; }",
		".mono { font-family: ui-monospace, monospace; }",
		".serif { font-family: Georgia, serif; }",
		'.display { font-family: "Playfair Display", serif; }',
		".intro { text-align: center; }",
		".justified { text-align: justify; }"
	].join("\n"),
	"index.html": [
		'<html lang="zh-CN"><body>',
		"<h1>AI 默认产物</h1>",
		`<p class="intro">${LONG_CJK}</p>`,
		`<p class="justified">${JUSTIFY_CJK}</p>`,
		'<p style="letter-spacing:2px">字距被拉宽的中文正文，使用Vue框架开发组件。</p>',
		"</body></html>"
	].join("\n")
};

/* ------------------------------- 小工具 ------------------------------- */

const at = (t, files, label = "layout-ui") => writeTree(tempDir(t, label), files);
const rules = (report, rule) => report.findings.filter((entry) => entry.rule === rule);
const hit = (report, rule, severity) => rules(report, rule).some((entry) => severity === undefined || entry.severity === severity);
const UI_CALL = { action: "ui" };

/* --------------------------- 1. 干净样本（工具层） --------------------------- */

test("干净样本：score ≤12 且无 error，metrics 自洽", async (t) => {
	const { value, text } = await call("layout_check", { ...UI_CALL, root: at(t, CLEAN) });
	assert.equal(value.mode, "ui", "mode 必须是 ui");
	assert.ok(Number.isFinite(value.score), "score 必须是数字");
	assert.ok(value.score <= 12, `干净样本分数应 ≤12（实测 ${value.score}）`);
	assert.equal(value.counts.error, 0, "干净样本不应有 error");
	assert.equal(value.grade, "clean", "干净样本应落在 clean 档");
	assert.equal(value.findings.length, 0, `干净样本不应有发现项，实测：${JSON.stringify(value.findings)}`);
	assert.ok(text.includes("layout_check [ui]"), "render 文本应包含 layout_check [ui]");
	assert.ok(text.includes(`${value.score}/100`), "render 文本应包含分数");
	// metrics 必需字段
	const metrics = value.metrics;
	for (const key of ["filesScanned", "fontSizes", "bodySize", "scaleRatio", "familyCount", "lineHeightRatios", "violations"]) {
		assert.equal(Object.hasOwn(metrics, key), true, `metrics 缺 ${key}`);
	}
	assert.equal(metrics.filesScanned, 2, "应扫到 2 个文件");
	assert.deepEqual(metrics.fontSizes, [16, 26, 40, 64], "字号档位应为 16/26/40/64");
	assert.equal(metrics.bodySize, 16, "正文应为 16px");
	assert.equal(metrics.scaleRatio, 4, "最大/正文应为 4×");
	assert.equal(metrics.familyCount, 2, "字体家族应为 2 个（正文 + 等宽）");
	assert.deepEqual(metrics.lineHeightRatios, [1.6], "行高比例应为 1.6");
	assert.equal(metrics.violations, 0, "violations 应等于 findings 数（0）");
	assert.ok(metrics.fontSizes.every((size) => typeof size === "number"), "fontSizes 元素必须是数字");
});

/* --------------------------- 2. 坏样本（工具层） --------------------------- */

test("AI 默认样本：score ≥60，且含 S1/S3 的 error", async (t) => {
	const { value, text } = await call("layout_check", { ...UI_CALL, root: at(t, BAD) });
	assert.ok(value.score >= 60, `坏样本分数应 ≥60（实测 ${value.score}）`);
	assert.equal(value.grade, "bad", "坏样本应落在 bad 档");
	assert.ok(value.counts.error >= 3, `坏样本至少 3 个 error（实测 ${value.counts.error}）`);
	assert.ok(hit(value, "S1", "error"), "坏样本应命中 S1 error（字号梯级断裂）");
	assert.ok(hit(value, "S3", "error"), "坏样本应命中 S3 error（行高过紧）");
	assert.ok(hit(value, "S2", "error"), "坏样本应命中 S2 error（9px 太小）");
	assert.ok(hit(value, "S9", "error"), "坏样本应命中 S9 error（标题层级不足）");
	// 每条 finding 都必须具备可执行的四要素
	for (const entry of value.findings) {
		assert.equal(typeof entry.severity, "string", "finding.severity 应为字符串");
		assert.equal(typeof entry.rule, "string", "finding.rule 应为字符串");
		assert.ok(entry.message.length > 0, "finding.message 不能为空");
		assert.ok(entry.fix.length > 0, "finding.fix 不能为空（模型靠它返工）");
	}
	assert.equal(value.metrics.violations, value.findings.length, "violations 应等于 findings 数");
	assert.equal(value.metrics.bodySize, 12, "坏样本正文应为 12px");
	assert.ok(value.metrics.scaleRatio < 1.6, `坏样本字号梯级应 <1.6（实测 ${value.metrics.scaleRatio}）`);
	assert.ok(value.metrics.familyCount > 3, "坏样本字体家族 >3");
	assert.ok(text.includes("layout_check [ui]"), "render 文本应包含 layout_check [ui]");
	assert.ok(text.includes("中英混排没空格") || text.includes("行长失控"), "render 文本应展示具体问题，而不是只有分数");
});

/* ------------------------------ 3. S1 字号梯级（工具层） ------------------------------ */

test("S1：<1.6 跳变报 error、>6 档报 warn、1.6× 不误报", async (t) => {
	const flat = await call("layout_check", { ...UI_CALL, root: at(t, { "a.css": ".a{font-size:16px;line-height:1.6}.b{font-size:20px}" }, "s1-flat") });
	assert.ok(hit(flat.value, "S1", "error"), "16px/20px = 1.25× 应命中 S1 error");
	assert.match(flat.value.findings.find((entry) => entry.rule === "S1").message, /梯级断裂/, "S1 错误消息应说明梯级断裂");

	const tiers = [16, 17, 18, 19, 20, 21, 22].map((size, index) => `.s${index}{font-size:${size}px;line-height:1.6}`).join("\n");
	const many = await call("layout_check", { ...UI_CALL, root: at(t, { "a.css": tiers }, "s1-tiers") });
	assert.ok(hit(many.value, "S1", "warn"), "7 档字号应命中 S1 warn（档位过多）");
	assert.equal(many.value.metrics.fontSizes.length, 7, "应统计出 7 档字号");

	const good = await call("layout_check", { ...UI_CALL, root: at(t, { "a.css": ".a{font-size:16px;line-height:1.6}.b{font-size:26px}" }, "s1-good") });
	assert.equal(hit(good.value, "S1"), false, "26/16 = 1.625× ≥1.6 不应命中 S1");
});

/* ------------------------------ 4. S2 最小字号（单测） ------------------------------ */

test("S2：判定用「字号 × 字重」，不是只看字号", async (t) => {
	// 实测（本机 resvg）：12px/400 只有 5.5% 实心笔画（94.5% 半透明灰），
	// 12px/600 是 29.3%——所以“12px”单独不能说明清晰度。
	const AUDIT = (css, name) => auditSource(at(t, { "a.css": css }, name));

	// 有效 <11 → error
	const tiny = await AUDIT(".a{font-size:9px;line-height:1.6}.b{font-size:16px;line-height:1.6}", "s2-9");
	assert.ok(hit(tiny, "S2", "error"), "9px/400（有效 9）应命中 error");
	assert.match(rules(tiny, "S2")[0].message, /9px\/400/, "消息应指出字号与字重");

	// 10.5px/400 → 有效 10.5 < 11 → error（旧规则只报 warn）
	const ten = await AUDIT(".a{font-size:10.5px;line-height:1.6}.b{font-size:18px;line-height:1.6}", "s2-10");
	assert.ok(hit(ten, "S2", "error"), "10.5px/400（有效 10.5）应命中 error");

	// 12px/400 → 有效 12，在 11–13 区间 → warn：旧规则直接放过，这是修掉的真漏报
	const twelve400 = await AUDIT(".a{font-size:12px;line-height:1.6}.b{font-size:20px;line-height:1.6}", "s2-12-400");
	assert.ok(hit(twelve400, "S2", "warn"), "12px/400 应命中 warn（有效仅 12，笔画大量半透明）");

	// 12px/600 → 有效 14.4 → 无发现：同样字号加粗就够清了
	const twelve600 = await AUDIT(".a{font-size:12px;font-weight:600;line-height:1.6}.b{font-size:20px;line-height:1.6}", "s2-12-600");
	assert.equal(hit(twelve600, "S2"), false, "12px/600（有效 14.4）不应命中");

	// 小字加粗：10.5px/700 → 有效 12.6 → warn 而非 error
	const tinyBold = await AUDIT(".a{font-size:10.5px;font-weight:700;line-height:1.6}.b{font-size:18px;line-height:1.6}", "s2-105-700");
	assert.equal(hit(tinyBold, "S2", "error"), false, "10.5px/700（有效 12.6）不应再是 error");
	assert.ok(hit(tinyBold, "S2", "warn"), "但还是 warn");

	// 14px/400 → 有效 14 → 无发现
	const ok = await AUDIT(".a{font-size:14px;line-height:1.6}.b{font-size:22px;line-height:1.6}", "s2-14");
	assert.equal(hit(ok, "S2"), false, "14px/400 是正文底线，不应命中");

	// bold 关键字也要能解析成 700
	const boldKeyword = await AUDIT(".a{font-size:11px;font-weight:bold;line-height:1.6}.b{font-size:18px;line-height:1.6}", "s2-bold");
	assert.equal(hit(boldKeyword, "S2"), false, "11px/bold（有效 13.2）不应命中");
});

/* --------------------- S10 混排字号基线（单测） --------------------- */

test("S10：flex + align-items:center 装字号悬殊的两段文字 → 基线丢失", async (t) => {
	// 场景：仪表板的「5.42 GiB」——数字 72px、单位 20px。最常见的错不是字号，
	// 而是容器写成 align-items:center：浏览器会把小字垂直居中，而不是坐在同一基线上。
	const AUDIT = (css, name) => auditSource(at(t, { "a.css": css + "\nbody{font-size:14px;line-height:1.6}" }, name));

	const bad = await AUDIT(".kpi{display:flex;align-items:center;gap:6px}.kpi .num{font-size:72px;font-weight:700}.kpi .unit{font-size:20px}", "s10-bad");
	const hit = rules(bad, "S10");
	assert.equal(hit.length, 1, "应命中 S10");
	assert.match(hit[0].message, /72px/);
	assert.match(hit[0].message, /20px/);
	assert.match(hit[0].message, /3\.6×/, "应报出倍率");
	assert.equal(hit[0].severity, "warn");

	// 正确写法：align-items: baseline
	assert.equal(rules(await AUDIT(".kpi{display:flex;align-items:baseline}.kpi .num{font-size:72px}.kpi .unit{font-size:20px}", "s10-ok"), "S10").length, 0, "baseline 不应报");

	// 小字自己声明了 vertical-align: baseline 也算处理过，不报
	assert.equal(
		rules(await AUDIT(".kpi{display:flex;align-items:center}.kpi .num{font-size:72px}.kpi .unit{font-size:20px;vertical-align:baseline}", "s10-self"), "S10").length,
		0,
		"小字已声明 baseline 不应报"
	);

	// 倍率不足 1.8（22px 字标 + 16px 标签 = 1.375×）：居中摆放是正常的，报它就是噪音
	assert.equal(
		rules(await AUDIT(".top{display:flex;align-items:center}.top .logo{font-size:22px}.top .tab{font-size:16px}", "s10-small"), "S10").length,
		0,
		"倍率 <1.8 不应报"
	);

	// 不是 flex：行内默认就是基线对齐，不报
	assert.equal(rules(await AUDIT(".kpi .num{font-size:72px}.kpi .unit{font-size:20px}", "s10-no-flex"), "S10").length, 0, "非 flex 不应报");
});

/* --------------------- S11 阴影层级（单测） --------------------- */

test("S11：光源方向不一致 error；档位过多/太近 warn；健康高程体系不报", async (t) => {
	// 阴影是「专业感 / AI 感」的分水岭，且有两条**完全客观**的可判缺陷：
	//   ① 光源方向不一致（有的往下投、有的往上投）——物理上不成立；
	//   ② 档位过多 / 相邻档位太近（肉眼分不出，等于白写一档）。
	const AUDIT = (css, name) => auditSource(at(t, { "a.css": css + "\nbody{font-size:14px;line-height:1.6}" }, name));

	// 健康：4 档，全部向下，档位之间有明确倍数
	assert.equal(
		rules(
			await AUDIT(
				".a{box-shadow:0 1px 2px rgba(0,0,0,.08)}.b{box-shadow:0 4px 12px rgba(0,0,0,.10)}.c{box-shadow:0 12px 32px rgba(0,0,0,.12)}.d{box-shadow:0 24px 64px rgba(0,0,0,.14)}",
				"s11-good"
			),
			"S11"
		).length,
		0,
		"健康的高程体系不应报"
	);

	// 光源不一致 → error
	const dirBad = await AUDIT(".a{box-shadow:0 2px 8px rgba(0,0,0,.1)}.b{box-shadow:0 -2px 8px rgba(0,0,0,.1)}", "s11-dir");
	const dirHit = rules(dirBad, "S11");
	assert.equal(dirHit.length, 1);
	assert.equal(dirHit[0].severity, "error");
	assert.match(dirHit[0].message, /光源方向不一致/);
	assert.match(dirHit[0].fix, /inset/, "应提示用 inset 做内凹而不是反向 dy");

	// 档位过多 → warn
	const manyHit = rules(
		await AUDIT(
			".a{box-shadow:0 1px 2px rgba(0,0,0,.1)}.b{box-shadow:0 2px 6px rgba(0,0,0,.1)}.c{box-shadow:0 3px 10px rgba(0,0,0,.1)}.d{box-shadow:0 4px 24px rgba(0,0,0,.1)}.e{box-shadow:0 5px 48px rgba(0,0,0,.1)}.f{box-shadow:0 6px 96px rgba(0,0,0,.1)}",
			"s11-many"
		),
		"S11"
	);
	assert.ok(manyHit.some((f) => /档位过多/.test(f.message)), "6 档应报档位过多");

	// 相邻档位太近 → warn
	const closeHit = rules(await AUDIT(".a{box-shadow:0 2px 8px rgba(0,0,0,.1)}.b{box-shadow:0 2px 9px rgba(0,0,0,.1)}", "s11-close"), "S11");
	assert.ok(closeHit.some((f) => /太近/.test(f.message)), "8/9px 应报档位太近");

	// 多层堆叠但同向、档位分明 → 不报（这是常见且正确的写法）
	assert.equal(
		rules(
			await AUDIT(
				".a{box-shadow:0 1px 3px rgba(0,0,0,.12),0 8px 24px rgba(0,0,0,.08)}.b{box-shadow:0 2px 6px rgba(0,0,0,.1),0 16px 48px rgba(0,0,0,.1)}",
				"s11-stack"
			),
			"S11"
		).length,
		0,
		"多层同向不应报"
	);

	// inset 的反向 dy 不算光源冲突（内凹本来就跟外投影反方向）
	assert.equal(
		rules(await AUDIT(".a{box-shadow:0 2px 8px rgba(0,0,0,.1)}.b{box-shadow:inset 0 -2px 8px rgba(0,0,0,.1)}", "s11-inset"), "S11").length,
		0,
		"inset 反向不应报光源冲突"
	);
});

/* --------------------- S12 响应式断点（单测） --------------------- */

test("S12：同方向近似断点、max/min 同值重叠要报；互补对与单方向体系不报", async (t) => {
	// 断点最容易出的两类问题都能静态算出来：
	//   ① 同方向两个断点差 1–3px（几乎必然是笔误）；
	//   ② max-width: X 与 min-width: X 同时存在（恰好 X 处两套规则同时生效）。
	// **刻意不报**：max-width: 767 配 min-width: 768 是标准互补对，报它就是噪音。
	const AUDIT = (css, name) => auditSource(at(t, { "a.css": css + "\nbody{font-size:14px;line-height:1.6}" }, name));

	// 规范互补对：不应出 warn/error
	const pair = await AUDIT("@media (max-width: 767px){.a{font-size:13px}}@media (min-width: 768px){.a{font-size:15px}}", "s12-pair");
	assert.equal(hit(pair, "S12", "warn"), false, "互补对不应报 warn");
	assert.equal(hit(pair, "S12", "error"), false, "互补对不应报 error");

	// 同方向近似 767/768 → warn
	const near = await AUDIT("@media (max-width: 767px){.a{font-size:13px}}@media (max-width: 768px){.b{font-size:13px}}", "s12-near");
	const nearWarn = rules(near, "S12").filter((f) => f.severity === "warn");
	assert.equal(nearWarn.length, 1, "应报一条 warn");
	assert.match(nearWarn[0].message, /767\/768px/, "应指出具体数值");
	assert.match(nearWarn[0].message, /近似但不相等/);

	// max/min 同值重叠 → warn
	const overlap = await AUDIT("@media (max-width: 768px){.a{font-size:13px}}@media (min-width: 768px){.b{font-size:15px}}", "s12-overlap");
	const overlapWarn = rules(overlap, "S12").filter((f) => f.severity === "warn");
	assert.equal(overlapWarn.length, 1);
	assert.match(overlapWarn[0].message, /重叠/);
	assert.match(overlapWarn[0].fix, /767px/, "应给出错开 1px 的正确写法");

	// 健康 mobile-first 单一方向：完全无发现
	assert.equal(rules(await AUDIT("@media (min-width: 640px){.a{font-size:13px}}@media (min-width: 1024px){.a{font-size:15px}}", "s12-healthy"), "S12").length, 0, "单方向体系不应报");

	// em 单位也要折算成 px 参与比对（1em = 16px）：40em=640、40.1em=641.6，相差 1.6px → 应报近似
	const em = await AUDIT("@media (max-width: 40em){.a{font-size:13px}}@media (max-width: 40.1em){.b{font-size:13px}}", "s12-em");
	assert.ok(
		rules(em, "S12").some((f) => /640\/641\.6px/.test(f.message)),
		`em 应折算成 px 后参与比对（期望 640/641.6px），实际 ${JSON.stringify(rules(em, "S12").map((f) => f.message))}`
	);
	// 差距足句大时（40em vs 41em = 640/656）不应报近似
	const emFar = await AUDIT("@media (max-width: 40em){.a{font-size:13px}}@media (max-width: 41em){.b{font-size:13px}}", "s12-em-far");
	assert.equal(hit(emFar, "S12", "warn"), false, "640/656 相差 16px 不应报近似");
});

/* --------------------- S13 组件状态矩阵（单测） --------------------- */

test("S13：有 hover 没 focus 要报；补了 focus 不报；矩阵与覆盖不均只给 info", async (t) => {
	// 现有 `taste_check` 的 no-states 只能回答「页面上有没有交互态」，
	// 回答不了「四个组件里有两个缺 disabled」这种逐组件的问题。
	// 硬判据只一条：有 hover 却没 focus —— 键盘用户看不到焦点（WCAG 2.4.7 AA）。
	const AUDIT = (css, name) => auditSource(at(t, { "a.css": css + "\nbody{font-size:14px;line-height:1.6}" }, name));

	// 有 hover 无 focus → warn
	const noFocus = await AUDIT(".btn{color:#111}.btn:hover{color:#000}.card{color:#111}.card:hover{color:#000}", "s13-nofocus");
	const warn = rules(noFocus, "S13").filter((f) => f.severity === "warn");
	assert.equal(warn.length, 1, "应报一条 warn");
	assert.match(warn[0].message, /\.btn/);
	assert.match(warn[0].message, /\.card/);
	assert.match(warn[0].message, /2\.4\.7/, "应引 WCAG 条款");

	// 补了 focus-visible（用 outline，现实中最常见的写法）→ 不再 warn
	const fixed = await AUDIT(".btn:hover{color:#000}.btn:focus-visible{outline:2px solid #00f}.card:hover{color:#000}.card:focus{outline:2px solid #00f}", "s13-fixed");
	assert.equal(hit(fixed, "S13", "warn"), false, "补了 focus 就不应报");

	// 逗号分组选择器必须按个算：这是极常见写法，整串当一个选择器会误判为“没有 focus”
	const grouped = await AUDIT(".fw:hover{color:#000}.act:hover{color:#000}.fw:focus-visible,.act:focus-visible{outline:2px solid #00f}", "s13-grouped");
	assert.equal(hit(grouped, "S13", "warn"), false, `分组选择器里的 focus 应生效，实际 ${JSON.stringify(rules(grouped, "S13").map((f) => `${f.severity}:${f.message.slice(0, 40)}`))}`);

	// [disabled] 属性写法也算禁用态；:not(...) 要剥掉，不能把同一组件拆成两行
	const attr = await AUDIT(".btn:hover{color:#000}.btn:focus-visible{outline:1px solid}.btn[disabled]{opacity:.5}.tab:hover{color:#000}.tab:focus:not(:focus-visible){outline:0}", "s13-attr");
	const matrix = rules(attr, "S13").find((f) => /状态矩阵/.test(f.message));
	assert.ok(matrix !== undefined, "应有矩阵总览");
	assert.match(matrix.message, /\.btn ✓✓·✓/, "[disabled] 应被认成禁用态");
	assert.equal(/\.tab:not\(\)/.test(matrix.message), false, "函数式伪类应当被剥掉，不能产生假组件");

	// 数据属性钩子（本插件 format=motion 产出的 [data-motion~="lift"]）不是组件：
	// hover 与 focus 是两条独立可选项，按 base 归组必然假报。
	const hooks = await AUDIT(
		'[data-motion~="lift"]:hover{transform:translateY(-2px)}[data-motion~="press"]:active{transform:scale(.96)}[data-motion~="focus"]:focus-visible{outline:2px solid}',
		"s13-hooks"
	);
	assert.equal(hit(hooks, "S13", "warn"), false, "[data-motion] 钩子不应被当成缺 focus 的组件");
	// 反例：其它 data-* 选择器在真实项目里就是组件（shadcn 的 [data-slot]），不能跟着豁免
	const slots = await AUDIT('[data-slot="trigger"]:hover{color:#000}', "s13-slot");
	assert.ok(rules(slots, "S13").some((f) => f.severity === "warn"), "[data-slot] 这类选择器仍应参与矩阵");
	assert.equal(rules(hooks, "S13").some((f) => /data-motion/.test(f.message)), false, "矩阵里不应出现属性钩子");

	// 覆盖不均：最多 4 个状态 vs 最少 2 个 → info
	const uneven = await AUDIT(
		".btn:hover{color:#000}.btn:focus-visible{outline:1px solid}.btn:active{color:#333}.btn:disabled{opacity:.5}.tab:hover{color:#000}.tab:focus-visible{outline:1px solid}",
		"s13-uneven"
	);
	assert.ok(rules(uneven, "S13").some((f) => f.severity === "info" && /覆盖不均/.test(f.message)), "应报覆盖不均");
});

/* --------------------- 应用外壳分档（S1/S9/S4/heading-first） --------------------- */

test("应用外壳：紧字号梯级与压扁的组件标题降为 info，不判 error", async (t) => {
	// 桌面/Web 应用的「工具栏 + 栏位」界面没有 hero 标题，11–16px 紧梯级是常态。
	// 之前拿文档的 1.6× 梯级去量应用界面，把完全正确的设计判成 error。
	// 判据两条同时成立才算外壳：根元素满高（height:100% / overflow:hidden）+ 存在 flex/grid 布局。
	const SHELL = "html,body{margin:0;height:100%;overflow:hidden}";
	const APP = `${SHELL}\n.app{display:flex;height:100%}\n.side{width:245px}\n.nav{font-size:13px;line-height:1.5}\n.rail{font-size:11px}\n.t{font-size:16px}`;
	const DOC = `body{margin:0;font-size:16px;line-height:1.7}\np{font-size:16px}\nh2{font-size:17px}`;

	const appReport = await auditSource(at(t, { "a.css": APP }, "shell-app"));
	const appS1 = rules(appReport, "S1");
	const flat = appS1.find((f) => /梯级/.test(f.message));
	assert.ok(flat !== undefined, "应仍然报出梯级偏平（但作为参考）");
	assert.equal(flat.severity, "info", `应用外壳的梯级偏平应为 info，实际 ${flat.severity}`);
	assert.match(flat.message, /应用外壳/);

	// 文档页（无满高 + 无 flex 布局）：同样梯级的断裂仍为 error
	const docReport = await auditSource(at(t, { "b.css": DOC }, "shell-doc"));
	const docS1 = rules(docReport, "S1").find((f) => /梯级/.test(f.message));
	assert.ok(docS1 !== undefined, "文档页梯级断裂应报");
	assert.equal(docS1.severity, "error", `文档页应为 error，实际 ${docS1.severity}`);
});

test("S4：根选择器上的 width（视口宽）不算正文栏宽，只认 max-width", async (t) => {
	// 实测：参照稿写了 body{width:1366px;font-size:13px}，被算成「1366/13≈105 字/行」。
	// 根元素上的 width 是视口，不是阅读栏；只当作者明确写 max-width 时才判。
	const viewport = await auditSource(at(t, { "a.css": "html,body{margin:0;width:1366px;font-size:13px;line-height:1.5}" }, "s4-viewport"));
	assert.equal(hit(viewport, "S4", "warn"), false, "body 的 width 不应被当成正文栏宽");

	// 真正的正文栏：max-width 640px + 16px → 40 字，正常
	const good = await auditSource(at(t, { "b.css": "body{margin:0;font-size:16px;line-height:1.7}\n.prose{max-width:640px;font-size:16px;line-height:1.7}" }, "s4-good"));
	assert.equal(hit(good, "S4", "warn"), false, "40 字/行不应报");

	// 真过宽：max-width 1100px + 16px ≈ 68 字 → 报
	const wide = await auditSource(at(t, { "c.css": "body{margin:0;font-size:16px;line-height:1.7}\n.prose{max-width:1100px;font-size:16px;line-height:1.7}" }, "s4-wide"));
	assert.ok(hit(wide, "S4", "warn"), "1100px/16px ≈ 68 字应报行长失控");
});

test("heading-first：只有 ≥3 个标题的真文档才判，应用外壳与只有两个标题的页面不报", async (t) => {
	const mk = (body, css) => auditSource(at(t, { "a.html": `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>` }, "hf"));
	// 文档：h2 开头的完整大纲 → 应报
	const realDoc = await mk("<h2>甲</h2><h2>乙</h2><h2>丙</h2>", "body{font-size:16px;line-height:1.7}");
	assert.ok(hit(realDoc, "structure-heading-first"), "真文档以 h2 开头应报");

	// 只有 2 个标题：谈不上大纲 → 不报
	const two = await mk("<h3>工具箱</h3><h4>企业版</h4>", "body{font-size:16px;line-height:1.7}");
	assert.equal(hit(two, "structure-heading-first"), false, "只有 2 个标题不应报");

	// 应用外壳：h3/h4 是组件标题不是大纲 → 不报
	const shell = await mk(
		"<div class=\"app\"><h4>私</h4></div><h3>乙</h3><h3>丙</h3>",
		"html,body{margin:0;height:100%;overflow:hidden}\n.app{display:flex}"
	);
	assert.equal(hit(shell, "structure-heading-first"), false, "应用外壳不应报 heading-first");
});

/* --------------------- S14 负外边距（单测） --------------------- */

test("S14：负外边距要报（挤扁块间距的典型手法）；正常 margin / auto 不报", async (t) => {
	// 来自真实缺陷：参照实现在线文档时用 `.table{margin-top:-12px}` 把表格硬拉上去，
	// 像素差好看了，但「最近」的下划线直接贴到了「名称」上。静态检查原本全绿。
	const AUDIT = (css, name) => auditSource(at(t, { "a.css": css + "\nbody{font-size:13px;line-height:1.5}" }, name));

	const bad = await AUDIT(".table{margin-top:-12px;padding:0 18px}", "s14-bad");
	const hit14 = rules(bad, "S14").filter((f) => f.severity === "warn");
	assert.equal(hit14.length, 1, "负 margin-top 应报一条 warn");
	assert.match(hit14[0].message, /margin-top: -12px/);
	assert.match(hit14[0].fix, /padding|gap/, "应给出替代手法");
	assert.match(hit14[0].fix, /transform/, "应提示重叠层用 transform 而不是负 margin");

	// 正常间距 / margin:auto 居中 / 0 值 → 不报
	assert.equal(rules(await AUDIT(".t{margin-top:12px}", "s14-ok"), "S14").length, 0, "正常正间距不应报");
	assert.equal(rules(await AUDIT(".t{margin:0 auto}", "s14-auto"), "S14").length, 0, "margin:auto 不应报");
	assert.equal(rules(await AUDIT(".t{margin:0}", "s14-zero"), "S14").length, 0, "零值不应报");

	// 多值里的负数、em 单位的负数都要能识别
	const multi = await AUDIT(".av{margin:0 -8px 0 0}", "s14-multi");
	assert.ok(rules(multi, "S14").length === 1, "多值里的负数应报");
	const em = await AUDIT(".a{margin-top:-1.5em}", "s14-em");
	assert.ok(rules(em, "S14").length === 1, "em 单位的负值应报");
});

/* ------------------------------ 5. S3 行高（单测） ------------------------------ */

test("S3：1.2 error / 1.4 warn / 2.4 warn / 1.6 干净 / 缺行高给 info", async (t) => {
	const tight = await auditSource(at(t, { "a.css": ".a{font-size:16px;line-height:1.2}" }, "s3-tight"));
	assert.ok(hit(tight, "S3", "error"), "行高 1.2 应命中 S3 error");
	assert.match(rules(tight, "S3")[0].message, /1\.2/, "S3 消息应引用实际比例");

	const loose = await auditSource(at(t, { "a.css": ".a{font-size:16px;line-height:1.4}" }, "s3-warn"));
	assert.ok(hit(loose, "S3", "warn"), "行高 1.4 应命中 S3 warn");

	const airy = await auditSource(at(t, { "a.css": ".a{font-size:16px;line-height:2.4}" }, "s3-airy"));
	assert.ok(hit(airy, "S3", "warn"), "行高 2.4 应命中 S3 warn（过松）");

	const good = await auditSource(at(t, { "a.css": ".a{font-size:16px;line-height:1.6}" }, "s3-good"));
	assert.equal(rules(good, "S3").length, 0, "行高 1.6 不应有任何 S3 发现项");

	const missing = await auditSource(at(t, { "a.css": ".a{font-size:16px}" }, "s3-missing"));
	assert.ok(hit(missing, "S3", "info"), "声明了字号却没行高，应给 S3 info（依赖浏览器默认）");
	assert.match(rules(missing, "S3")[0].message, /默认/, "info 消息应说明是浏览器默认行高");

	// CSS-in-JS / React 内联样式对象（同一行多属性）也要能解析出字号与行高
	const jsx = await auditSource(at(t, { "app.jsx": "export const s = { fontSize: 16, lineHeight: 1.2 };\n" }, "s3-jsx"));
	assert.ok(hit(jsx, "S3", "error"), "JS 对象 { fontSize: 16, lineHeight: 1.2 } 应被解析并命中 S3 error");
});

/* ------------------------------ 6. S4 行长（单测） ------------------------------ */

test("S4：中文超 48 字/英文超 90 字符报 warn，640px 合适，窄栏提示 info", async (t) => {
	const cjkWide = await auditSource(
		at(t, { "a.css": ".wrap{max-width:960px;font-size:12px;line-height:1.6}", "index.html": `<p>${LONG_CJK}</p>` }, "s4-cjk-wide")
	);
	assert.ok(hit(cjkWide, "S4", "warn"), "960px / 12px = 80 字/行应命中 S4 warn");
	assert.match(rules(cjkWide, "S4")[0].message, /80/, "S4 消息应给出估算字数");

	const cjkOk = await auditSource(
		at(t, { "a.css": ".wrap{max-width:640px;font-size:16px;line-height:1.6}", "index.html": `<p>${LONG_CJK}</p>` }, "s4-cjk-ok")
	);
	assert.equal(hit(cjkOk, "S4", "warn"), false, "640px / 16px = 40 字 ≤42 不应误报超长");

	const latinWide = await auditSource(
		at(t, { "a.css": ".wrap{max-width:1400px;font-size:14px;line-height:1.6}", "index.html": "<p>English only content, no CJK here at all.</p>" }, "s4-latin-wide")
	);
	assert.ok(hit(latinWide, "S4", "warn"), "英文 1400px / 14px ≈ 182 字符应命中 S4 warn");

	const short = await auditSource(
		at(t, { "a.css": ".wrap{max-width:260px;font-size:24px;line-height:1.6}", "index.html": `<p>${LONG_CJK}</p>` }, "s4-short")
	);
	assert.ok(hit(short, "S4", "info"), "260px / 24px ≈ 10.8 字/行（<12）应给 info");

	// 反例边界：窄 width（按钮/图标容器）不算正文栏，不应报「过短」
	const button = await auditSource(
		at(t, { "a.css": ".btn{width:160px;font-size:12px;line-height:1.6}", "index.html": `<p>${LONG_CJK}</p>` }, "s4-button")
	);
	assert.equal(hit(button, "S4"), false, "width 160px < 240px 阈值，不应按正文行长判定");
});

/* ------------------------------ 7. S5 字体家族（单测） ------------------------------ */

test("S5：>3 个字体栈 warn，系统栈算 1 个，重复栈去重", async (t) => {
	const many = await auditSource(
		at(
			t,
			{
				"a.css": [
					".a{font-family:Arial,sans-serif}",
					".b{font-family:Georgia,serif}",
					".c{font-family:'Playfair Display',serif}",
					".d{font-family:ui-monospace,monospace}"
				].join("\n")
			},
			"s5-many"
		)
	);
	assert.ok(hit(many, "S5", "warn"), "4 个字体栈应命中 S5 warn");
	assert.equal(many.metrics.familyCount, 4, "familyCount 应为 4");

	const two = await auditSource(
		at(t, { "a.css": 'body{font-family:"Noto Sans SC",sans-serif}.mono{font-family:ui-monospace,monospace}' }, "s5-two")
	);
	assert.equal(hit(two, "S5"), false, "2 个字体栈不应命中 S5");

	const system = await auditSource(
		at(
			t,
			{ "a.css": 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.x{font-family:"Noto Sans SC",sans-serif}' },
			"s5-system"
		)
	);
	assert.equal(hit(system, "S5"), false, "OS 默认字体栈算 1 个，加上 Noto 共 2 个不应报");

	const duplicates = await auditSource(
		at(
			t,
			{ "a.css": '.a{font-family:"Inter",sans-serif}.b{font-family:"Inter",sans-serif}.c{font-family:"Inter",sans-serif}' },
			"s5-dupe"
		)
	);
	assert.equal(duplicates.metrics.familyCount, 1, "相同字体栈应去重为 1");
	assert.equal(hit(duplicates, "S5"), false, "去重后只有 1 个字体栈，不应报");
});

/* ------------------------------ 8. S6 对齐（工具层） ------------------------------ */

test("S6：justify+中文 / 长段落居中报 warn，英文 justify 与短文本居中不误报", async (t) => {
	const justify = await call(
		"layout_check",
		{
			...UI_CALL,
			root: at(t, { "a.css": ".j{text-align:justify}", "index.html": "<p>中文段落内容，两段对齐在中文里会撑出空隙。</p>" }, "s6-justify")
		}
	);
	assert.ok(hit(justify.value, "S6", "warn"), "中文项目用 justify 应命中 S6 warn");
	assert.match(rules(justify.value, "S6")[0].message, /justify/, "S6 消息应点名 justify");

	const latin = await call(
		"layout_check",
		{
			...UI_CALL,
			root: at(t, { "a.css": ".j{text-align:justify}", "index.html": "<p>English only paragraph, justify is fine here.</p>" }, "s6-latin")
		}
	);
	assert.equal(hit(latin.value, "S6"), false, "纯英文文件用 justify 不应命中 S6");

	const shortCenter = await call(
		"layout_check",
		{
			...UI_CALL,
			root: at(t, { "a.css": ".c{text-align:center}", "index.html": '<p class="c">短标题</p>' }, "s6-short-center")
		}
	);
	assert.equal(hit(shortCenter.value, "S6"), false, "短文本居中不应命中 S6");

	const longCenter = await call(
		"layout_check",
		{
			...UI_CALL,
			root: at(t, { "a.css": ".intro{text-align:center}", "index.html": `<p class="intro">${LONG_CJK}</p>` }, "s6-long-center")
		}
	);
	assert.ok(hit(longCenter.value, "S6", "warn"), ">40 字中文长段落居中应命中 S6 warn");
	assert.match(rules(longCenter.value, "S6")[0].message, /长段落居中/, "S6 消息应说明是长段落居中");
});

/* ------------------------------ 9. S7 字距（单测） ------------------------------ */

test("S7：中文语境大字距 warn，英文文件与 0.02em 不误报", async (t) => {
	const px = await auditSource(at(t, { "index.html": '<p style="letter-spacing:2px">中文字距被拉宽的正文。</p>' }, "s7-px"));
	assert.ok(hit(px, "S7", "warn"), "中文 + letter-spacing 2px 应命中 S7 warn");
	assert.match(rules(px, "S7")[0].message, /2px/, "S7 消息应给出字距值");

	// S7 要求「同一文件出现中文」，所以大字距与中文文案要写在同一个 HTML 文件里
	const em = await auditSource(at(t, { "index.html": '<p style="letter-spacing:0.1em">中文字距被拉宽的正文。</p>' }, "s7-em"));
	assert.ok(hit(em, "S7", "warn"), "0.1em > 0.05em 应命中 S7");

	const subtle = await auditSource(at(t, { "index.html": '<p style="letter-spacing:0.02em">中文字距略有呼吸感的正文。</p>' }, "s7-subtle"));
	assert.equal(hit(subtle, "S7"), false, "0.02em 属于可接受的呼吸感，不应命中 S7");

	const latin = await auditSource(at(t, { "index.html": '<p style="letter-spacing:2px">English only text.</p>' }, "s7-latin"));
	assert.equal(hit(latin, "S7"), false, "文件内无中文时字距不按 S7 判");
});

/* ------------------------------ 10. S8 混排空格（单测） ------------------------------ */

test("S8：中英紧贴 ≥3 次给 info，加空格/纯数字紧贴不误报", async (t) => {
	const mixed = await auditSource(at(t, { "index.html": "<p>使用React框架和TypeScript类型系统开发。</p>" }, "s8-mixed"));
	assert.ok(hit(mixed, "S8", "info"), "使用React框架和TypeScript… 应命中 S8 info");
	assert.match(rules(mixed, "S8")[0].message, /4 处/, "S8 消息应统计命中次数（本例 4 处）");

	const spaced = await auditSource(at(t, { "index.html": "<p>使用 React 框架和 TypeScript 类型系统开发。</p>" }, "s8-spaced"));
	assert.equal(hit(spaced, "S8"), false, "中英之间已有空格，不应命中 S8");

	const digits = await auditSource(at(t, { "index.html": "<p>2026年11月共3章，第2节。</p>" }, "s8-digits"));
	assert.equal(hit(digits, "S8"), false, "纯数字紧贴中文（2026年/第3章）是正常写法，不应命中 S8");
});

/* ------------------------------ 11. S9 标题层级（工具层） ------------------------------ */

test("S9：标题/正文 <1.25 与层级倒挂报 error，合理递减不误报", async (t) => {
	const weak = await call(
		"layout_check",
		{ ...UI_CALL, root: at(t, { "a.css": "body{font-size:12px;line-height:1.6}h1{font-size:14px}" }, "s9-weak") }
	);
	assert.ok(hit(weak.value, "S9", "error"), "h1 14px 相对正文太小，应命中 S9 error");
	assert.match(rules(weak.value, "S9")[0].message, /标题层级不足/, "S9 消息应说明层级不足");

	const inverted = await call(
		"layout_check",
		{ ...UI_CALL, root: at(t, { "a.css": "body{font-size:12px;line-height:1.6}h1{font-size:16px}h2{font-size:24px}" }, "s9-inverted") }
	);
	assert.ok(hit(inverted.value, "S9", "error"), "h1 比 h2 小应命中 S9 error");
	assert.ok(
		rules(inverted.value, "S9").some((entry) => /倒挂/.test(entry.message)),
		"应有一条 S9 消息明确说「层级倒挂」"
	);

	const good = await call(
		"layout_check",
		{ ...UI_CALL, root: at(t, { "a.css": "body{font-size:16px;line-height:1.6}h1{font-size:40px}h2{font-size:26px}h3{font-size:20px}" }, "s9-good") }
	);
	assert.equal(hit(good.value, "S9"), false, "h1 40 / h2 26 / h3 20 逐级递减，不应命中 S9");
});

/* ------------------------------ 12. 单文件 root（工具层） ------------------------------ */

test("单文件 root：只扫一个文件，内联 <style> 里的字号也能统计", async (t) => {
	const dir = tempDir(t, "layout-single");
	const page = join(dir, "page.html");
	writeTree(dir, {
		"page.html": [
			'<html lang="zh-CN"><head><style>',
			'body{font-size:16px;line-height:1.6;font-family:"Noto Sans SC",sans-serif}',
			"h1{font-size:40px}",
			"h2{font-size:26px}",
			"</style></head><body><h1>标题</h1><p>正文内容。</p></body></html>"
		].join("\n")
	});
	const { value } = await call("layout_check", { ...UI_CALL, root: page });
	assert.equal(value.mode, "ui");
	assert.equal(value.metrics.filesScanned, 1, "单文件 root 只能算 1 个文件");
	assert.deepEqual(value.metrics.fontSizes, [16, 26, 40], "应从内联 <style> 里解析出 3 档字号");
	assert.equal(value.metrics.bodySize, 16, "正文应为 16px");
	assert.ok(value.target.endsWith("page.html"), `target 应指向单文件（实测 ${value.target}）`);
	assert.equal(value.counts.error, 0, "该单文件样本应无 error");
});

/* ------------------------------ 13. 空目录与跳过目录（工具层） ------------------------------ */

test("空目录：0 文件 + S0 明确说明（不能当 0 分干净）；依赖/测试目录被跳过", async (t) => {
	const empty = await call("layout_check", { ...UI_CALL, root: tempDir(t, "layout-empty") });
	assert.equal(empty.value.metrics.filesScanned, 0, "空目录应扫到 0 个文件");
	assert.equal(empty.value.grade, "clean", "空目录的分数只来自 info，仍是 clean 档");
	assert.ok(empty.value.score <= 6, `空目录不应伪装成高分问题（实测 ${empty.value.score}），只应有一条 info 权重`);
	const zero = empty.value.findings.filter((entry) => entry.rule === "S0");
	assert.equal(zero.length, 1, "空目录应给出 1 条 S0 说明性 finding");
	assert.equal(zero[0].severity, "info", "S0 应是 info（不投错分）");
	assert.match(zero[0].message, /未扫到|没有样本/, "S0 消息应明确说没有样本");
	assert.deepEqual(empty.value.metrics.fontSizes, [], "无样本时 fontSizes 应为空数组");
	assert.equal(empty.value.metrics.bodySize, 0, "无样本时 bodySize 为 0（哨兵值，注释见源码）");

	const mixed = await call(
		"layout_check",
		{
			...UI_CALL,
			root: at(
				t,
				{
					"node_modules/pkg/bad.css": "body{font-size:9px}",
					"dist/bad.css": "body{font-size:9px}",
					"test/bad.css": "body{font-size:9px}",
					".hidden/bad.css": "body{font-size:9px}",
					"src/app.css": "body{font-size:16px;line-height:1.6}",
					"src/index.html": "<p>正文内容。</p>"
				},
				"layout-skip"
			)
		}
	);
	assert.equal(mixed.value.metrics.filesScanned, 2, "node_modules/dist/test/.hidden 必须跳过，只扫 src 的 2 个文件");
	assert.equal(hit(mixed.value, "S2"), false, "跳过目录里的 9px 不得计入 S2");
});

/* ------------------------------ 14. 确定性与输出（工具层） ------------------------------ */

test("确定性：同输入两次 deepEqual；render 文本与 findings 字段完整", async (t) => {
	const dir = at(t, BAD, "layout-determinism");
	const first = await call("layout_check", { ...UI_CALL, root: dir });
	const second = await call("layout_check", { ...UI_CALL, root: dir });
	assert.deepEqual(second.value, first.value, "同输入两次调用结果必须完全一致");
	assert.equal(second.text, first.text, "render 文本也必须完全一致");
	assert.ok(first.value.findings.length > 0, "坏样本应有 findings（否则下面的字段检查没意义）");
	for (const entry of first.value.findings) {
		assert.ok(["error", "warn", "info"].includes(entry.severity), `未知 severity：${entry.severity}`);
		assert.equal(typeof entry.where, "string", `finding ${entry.rule} 应有 where 定位`);
	}
	assert.ok(first.text.includes("layout_check [ui]"), "render 首行应标明 layout_check [ui]");
	assert.ok(first.text.includes("finding(s)"), "render 应汇总 finding 数量");
	assert.ok(first.text.includes("→"), "render 应包含「修法」箭头，而不是只报问题");
	assert.ok(!/undefined|NaN/.test(first.text), "render 文本不得出现 undefined/NaN");
	assert.equal(first.value.metrics.violations, first.value.findings.length, "violations 与 findings 数应一致");
	for (const key of ["filesScanned", "fontSizes", "bodySize", "scaleRatio", "familyCount", "lineHeightRatios", "violations"]) {
		assert.equal(Object.hasOwn(first.value.metrics, key), true, `metrics 缺 ${key}`);
	}
});

/* ------------------------------ 15. 错误路径 ------------------------------ */

test("错误路径：root 不存在/为空都抛人话错误（中英文按层）", async (t) => {
	const dir = tempDir(t, "layout-errors");
	const missing = join(dir, "nope");
	await rejects(() => auditSource(missing), /不存在|路径/, "auditSource 单测层：缺路径应抛中文错误");
	await rejects(() => call("layout_check", { ...UI_CALL, root: missing }), /not found|不存在/i, "工具层：缺路径应抛可读错误");
	await rejects(() => call("layout_check", { action: "ui" }), /root/, "工具层：action=ui 缺 root 应报错");
	await rejects(() => call("layout_check", { ...UI_CALL, root: "   " }), /root/, "工具层：root 全空白应报错");
});
