// test/layout-contrast.test.mjs — 文字对比度模块（rules-contrast.js）的发布前功能测试。
//
// 覆盖三块：
//   1. 颜色解析：hex 3/4/6/8 位、rgb()/rgba()（逗号与 CSS4 斜杠两种写法）、hsl()/hsla()、
//      命名色全表、以及 currentColor / inherit / var(--x) 这类动态值必须返回 null。
//   2. 两套度量：WCAG 2.x 的黑白极值 21:1、同色 1:1、#777 on #fff 的 4.48:1（差一点点不达标，
//      是圈里有名的边界值）；APCA 对照官方参考实现的极值 106.04 / -107.88（容差 ±3）。
//   3. 规则引擎：AA/AAA/APCA/low-alpha/invalid 五条规则的命中与反例，**建议色用本模块
//      自己的 contrastRatio 反算验证真的达标**，以及 3 条上限、按 ratio 升序、确定性、性能。
import assert from "node:assert/strict";
import { test } from "node:test";

import { assertLossless } from "./helpers.mjs";
import {
	APCA_OFFICIAL,
	auditContrast,
	apcaLc,
	contrastRatio,
	isLargeText,
	NAMED_COLORS,
	parseColor,
	relativeLuminance
} from "../lib/layouts/rules-contrast.js";

/* ------------------------------- 小工具 ------------------------------- */

/** fg/bg 都确定时，返回这条色对的 WCAG 比例（测试内自己算，不信被测代码的中间结果）。 */
const ratioOf = (fg, bg) => contrastRatio(fg, bg);

/** 从 fix 文案里抠出建议色（fix 约定只放一个 #RRGGBB）。 */
const hexIn = (text) => (text.match(/#[0-9A-F]{6}/) ?? [])[0];

/** 断言的正式发现项字段集合，防止 build 漏字段或多塞东西。 */
const FIELDS = new Set(["severity", "rule", "message", "fix", "where"]);

const near = (actual, expected, tolerance, label) =>
	assert.ok(Math.abs(actual - expected) <= tolerance, `${label}：期望 ${expected}±${tolerance}，实测 ${actual}`);

/* ---------------------------- 1. parseColor ---------------------------- */

test("parseColor：#rgb / #rrggbb", () => {
	assert.deepEqual(parseColor("#fff"), { r: 255, g: 255, b: 255, a: 1 });
	assert.deepEqual(parseColor("#000"), { r: 0, g: 0, b: 0, a: 1 });
	assert.deepEqual(parseColor("#8A8C86"), { r: 138, g: 140, b: 134, a: 1 });
	assert.deepEqual(parseColor("#abc"), { r: 170, g: 187, b: 204, a: 1 }, "3 位 hex 要按 nibble 复制展开");
	assert.deepEqual(parseColor("  #FFF  "), { r: 255, g: 255, b: 255, a: 1 }, "首尾空白与大小写都要容忍");
});

test("parseColor：#rgba / #rrggbbaa 的 alpha", () => {
	const four = parseColor("#1234");
	assert.deepEqual([four.r, four.g, four.b], [17, 34, 51]);
	near(four.a, 0x44 / 255, 1e-9, "#1234 的 alpha 应为 0x44/255");

	const eight = parseColor("#11223344");
	assert.deepEqual([eight.r, eight.g, eight.b], [17, 34, 51]);
	near(eight.a, 0x44 / 255, 1e-9, "#11223344 的 alpha 应为 0x44/255");

	near(parseColor("#ffffff80").a, 0x80 / 255, 1e-9, "#ffffff80 的 alpha 应为 0x80/255");
	assert.equal(parseColor("#00000000").a, 0, "全 0 alpha 要解析成 0 而不是 falsy 丢字段");
});

test("parseColor：rgb() / rgba() 三种写法（含百分比与超界钳制）", () => {
	assert.deepEqual(parseColor("rgb(255, 0, 0)"), { r: 255, g: 0, b: 0, a: 1 });
	assert.deepEqual(parseColor("rgb(255 0 0 / 50%)"), { r: 255, g: 0, b: 0, a: 0.5 }, "CSS4 空格+斜杠写法");
	assert.deepEqual(parseColor("rgba(0,0,0,0.5)"), { r: 0, g: 0, b: 0, a: 0.5 }, "传统逗号 4 参写法");
	assert.deepEqual(parseColor("rgb(10%, 20%, 30%)"), { r: 26, g: 51, b: 77, a: 1 }, "百分比通道 255×pct");
	assert.deepEqual(parseColor("rgb(300, -20, 128)"), { r: 255, g: 0, b: 128, a: 1 }, "超界通道必须钳制到 0–255");
	assert.deepEqual(parseColor("rgba(255,255,255,1)"), { r: 255, g: 255, b: 255, a: 1 });
});

test("parseColor：hsl() / hsla()", () => {
	assert.deepEqual(parseColor("hsl(0, 100%, 50%)"), { r: 255, g: 0, b: 0, a: 1 });
	assert.deepEqual(parseColor("hsl(210, 50%, 40%)"), { r: 51, g: 102, b: 153, a: 1 });
	assert.deepEqual(parseColor("hsl(0.5turn 100% 50%)"), { r: 0, g: 255, b: 255, a: 1 }, "turn 单位色相");
	assert.deepEqual(parseColor("hsl(120deg, 100%, 25%)"), { r: 0, g: 128, b: 0, a: 1 }, "deg 单位色相");
	assert.equal(parseColor("hsla(120, 100%, 25%, 0.5)").a, 0.5, "hsla 第 4 参是 alpha");
	assert.deepEqual(parseColor("hsl(240, 0%, 0%)"), { r: 0, g: 0, b: 0, a: 1 }, "零饱和零亮度必须落到纯黑");
});

test("parseColor：命名色至少 30 个且全部可解析", () => {
	assert.ok(NAMED_COLORS.length >= 30, `命名色只有 ${NAMED_COLORS.length} 个，少于约定的 30`);
	for (const name of NAMED_COLORS) {
		assert.notEqual(parseColor(name), null, `命名色 ${name} 解析失败`);
	}
	assert.deepEqual(parseColor("red"), { r: 255, g: 0, b: 0, a: 1 });
	assert.deepEqual(parseColor("RED"), { r: 255, g: 0, b: 0, a: 1 }, "命名色大小写不敏感");
	assert.deepEqual(parseColor("rebeccapurple"), { r: 102, g: 51, b: 153, a: 1 });
	assert.deepEqual(parseColor("gray"), parseColor("grey"), "gray / grey 必须同值");
});

test("parseColor：非法值一律 null（不抛错）", () => {
	for (const bad of [
		"currentColor",
		"inherit",
		"var(--text)",
		"transparent",
		"",
		"   ",
		"rgb(1,2)",
		"#12",
		"#12345",
		"nope",
		"hsl(0 100%)",
		"rgb(a, b, c)",
		"linear-gradient(#000, #fff)"
	]) {
		assert.equal(parseColor(bad), null, `「${bad}」应解析失败`);
	}
	assert.equal(parseColor(null), null, "null 入参");
	assert.equal(parseColor(undefined), null, "undefined 入参");
	assert.equal(parseColor(42), null, "数字入参");
	assert.equal(parseColor({ r: 1, g: 2, b: 3 }), null, "只接受字符串");
});

/* ----------------------- 2. WCAG 亮度与对比度 ----------------------- */

test("relativeLuminance：黑白极值与 #777 参考值", () => {
	near(relativeLuminance(parseColor("#fff")), 1, 1e-6, "白亮度");
	assert.equal(relativeLuminance(parseColor("#000")), 0, "黑亮度应为 0");
	near(relativeLuminance(parseColor("#777")), 0.1845, 0.001, "#777 相对亮度");
	assert.ok(
		relativeLuminance(parseColor("#333")) < relativeLuminance(parseColor("#777")),
		"亮度必须随色值单调上升"
	);
	assert.equal(typeof relativeLuminance("#fff"), "number", "也要接受 CSS 字符串");
});

test("contrastRatio：21 / 1 / 已知组合 / 对称", () => {
	near(contrastRatio("#000", "#fff"), 21, 1e-9, "黑白对比度应为 21");
	assert.equal(contrastRatio("#fff", "#000"), contrastRatio("#000", "#fff"), "对比度与顺序无关");
	assert.equal(contrastRatio("#8A8C86", "#8A8C86"), 1, "同色必须是 1");
	near(ratioOf("#777", "#fff"), 4.478, 0.001, "#777 on #fff 是 4.478（差一点不达 4.5 的著名边界）");
	near(ratioOf("#767676", "#fff"), 4.542, 0.001, "#767676 on #fff 刚好过 4.5");
	near(ratioOf("#8A8C86", "#F5F5F2"), 3.113, 0.001, "任务样例色对");
	assert.ok(contrastRatio("#000", "#fff") <= 21 + 1e-9, "上限 21");
});

/* ------------------------------- 3. APCA ------------------------------- */

test("apcaLc：APCA 官方参考值（极值 + 中灰，容差 ±3）与单调性", () => {
	// 来源：APCA-W3 0.0.98G 参考实现（W3 草案里的 SA98G 算法）公布的极值用例：
	//   纯黑文字 on 纯白背景 = +106.04，纯白文字 on 纯黑背景 = -107.88；
	//   查询表里 #888 on #fff ≈ 63.1。
	// 本实现按 0.0.98G 常量实现，实测完全一致；容差取 ±3 是因为不同小版本
	// （0.0.98G-4g 及后续修正）在 loClip/offset 上常有 0.1~1 的抖动。
	near(apcaLc("#000", "#fff", 16), APCA_OFFICIAL.blackOnWhite, 3, "黑 on 白");
	near(apcaLc("#fff", "#000", 16), APCA_OFFICIAL.whiteOnBlack, 3, "白 on 黑");
	assert.ok(apcaLc("#000", "#fff", 16) > 100, "白底黑字必须是正的且很大");
	assert.ok(apcaLc("#fff", "#000", 16) < -100, "黑底白字必须是负的且绝对值很大");
	assert.equal(apcaLc("#8A8C86", "#8A8C86", 16), 0, "同色 Lc 应为 0");
	near(apcaLc("#888", "#fff", 16), APCA_OFFICIAL.gray888OnWhite, 3, "#888 on 白");
	const seq = ["#000", "#555", "#888", "#ccc"].map((c) => apcaLc(c, "#fff", 16));
	for (let i = 1; i < seq.length; i += 1) {
		assert.ok(seq[i] < seq[i - 1], `前景越浅 Lc 必须越小：${seq.join(" > ")}`);
	}
});

test("apcaLc：字号/字重加权（近似）与 16px 无折价", () => {
	const base = apcaLc("#000", "#fff", 16);
	assert.equal(base, apcaLc("#000", "#fff", 24), "≥16px 不做字号折价，两档必须相等");
	const small = apcaLc("#000", "#fff", 12);
	assert.ok(Math.abs(small) < Math.abs(base), `12px 的可用对比度应低于 16px：${small} vs ${base}`);
	const smallBold = apcaLc("#000", "#fff", 12, true);
	assert.ok(Math.abs(smallBold) > Math.abs(small), "粗体按更大等效字号，折价应更少");
	assert.ok(Math.abs(smallBold) < Math.abs(base), "粗体也不该超过 16px 的基准");
	const dark = apcaLc("#fff", "#000", 12);
	assert.ok(Math.abs(dark) < Math.abs(apcaLc("#fff", "#000", 16)), "反色方向小字同样折价");
});

/* --------------------------- 4. auditContrast --------------------------- */

test("auditContrast：低对比命中 AA error，message 含色值/比例/阈值", () => {
	const findings = auditContrast([{ fg: "#8A8C86", bg: "#F5F5F2", fontSizePx: 16, where: "app.css:12 .muted" }]);
	const aa = findings.filter((f) => f.rule === "contrast-wcag-aa");
	assert.equal(aa.length, 1, "应命中一条 AA error");
	assert.equal(aa[0].severity, "error");
	assert.ok(aa[0].message.includes("#8A8C86"), "message 要有前景色值");
	assert.ok(aa[0].message.includes("#F5F5F2"), "message 要有背景色值");
	assert.ok(aa[0].message.includes("3.11:1"), "message 要有实测 ratio");
	assert.ok(aa[0].message.includes("4.5:1"), "message 要有阈值");
	assert.equal(aa[0].where, "app.css:12 .muted", "where 要原样带出");
	assert.equal(findings[0].rule, "contrast-wcag-aa", "最糟的先出");
	for (const f of findings) {
		assert.deepEqual(Object.keys(f).filter((k) => !FIELDS.has(k)), [], `发现项多了字段：${JSON.stringify(f)}`);
	}
});

test("auditContrast：fix 里的建议色反算真的达标，且方向正确", () => {
	const bg = "#F5F5F2";
	const aa = auditContrast([{ fg: "#8A8C86", bg, fontSizePx: 16 }]).find((f) => f.rule === "contrast-wcag-aa");
	const hex = hexIn(aa.fix);
	assert.ok(hex !== undefined, `fix 里应给出一个 #RRGGBB：${aa.fix}`);
	assert.notEqual(hex, "#8A8C86", "建议色不能等于原色");
	assert.ok(contrastRatio(hex, bg) >= 4.5, `建议色 ${hex} 反算 ${contrastRatio(hex, bg).toFixed(2)} 未达 4.5`);
	// 大字场景阈值放宽到 3:1，建议色只要 ≥3 即可（也能更浅）
	const large = auditContrast([{ fg: "#B9BBB4", bg, fontSizePx: 26 }]).find((f) => f.rule === "contrast-wcag-aa");
	const largeHex = hexIn(large.fix);
	assert.ok(contrastRatio(largeHex, bg) >= 3, `大字建议色 ${largeHex} 反算未达 3:1`);

	// 方向：深色底要提亮，浅色底要加深
	const onDark = auditContrast([{ fg: "#333333", bg: "#000000", fontSizePx: 16 }]).find((f) => f.rule === "contrast-wcag-aa");
	const lighter = hexIn(onDark.fix);
	assert.ok(
		relativeLuminance(parseColor(lighter)) > relativeLuminance(parseColor("#333333")),
		`黑底上的 #333 应该提亮，实测建议 ${lighter}`
	);
	assert.ok(contrastRatio(lighter, "#000000") >= 4.5, "提亮后要真的过 4.5");

	const onLight = auditContrast([{ fg: "#B0B0B0", bg: "#FFFFFF", fontSizePx: 16 }]).find((f) => f.rule === "contrast-wcag-aa");
	const darker = hexIn(onLight.fix);
	assert.ok(
		relativeLuminance(parseColor(darker)) < relativeLuminance(parseColor("#B0B0B0")),
		`白底上的浅灰应该加深，实测建议 ${darker}`
	);
	assert.ok(contrastRatio(darker, "#FFFFFF") >= 4.5, "加深后要真的过 4.5");
});

test("auditContrast：高对比度零发现", () => {
	assert.deepEqual(auditContrast([{ fg: "#000000", bg: "#FFFFFF", fontSizePx: 16 }]), [], "纯黑白不该有任何发现");
	assert.deepEqual(auditContrast([{ fg: "#FFFFFF", bg: "#000000", fontSizePx: 16 }]), [], "反色同样干净");
	assert.deepEqual(auditContrast([{ fg: "#111", bg: "#fff", fontSizePx: 16, bold: false }]), [], "#111 也够");
	assert.deepEqual(auditContrast([]), [], "空输入返回空数组");
	assert.deepEqual(auditContrast(undefined), [], "undefined 输入不爆");
});

test("auditContrast：半透明前景触发 low-alpha 并提醒实际更低", () => {
	const findings = auditContrast([{ fg: "rgba(0,0,0,0.5)", bg: "#FFFFFF", fontSizePx: 16 }]);
	const low = findings.filter((f) => f.rule === "contrast-low-alpha");
	assert.equal(low.length, 1, "alpha 0.5 必须命中 low-alpha");
	assert.equal(low[0].severity, "warn");
	assert.ok(low[0].message.includes("alpha 0.50"), "message 要写明 alpha 值");
	assert.ok(low[0].message.includes("半透明"), "message 要提醒半透明会让真实对比度更低");
	assert.ok(low[0].fix.includes("不透明"), "fix 要给出不透明等效色");
	// 合成后是 #808080 on 白，比例 3.95
	assert.ok(low[0].message.includes("3.95:1"), `合成色比例应写进 message：${low[0].message}`);
	// 0.85 是边界：0.86 不报，0.84 要报
	assert.equal(auditContrast([{ fg: "rgba(0,0,0,0.86)", bg: "#fff", fontSizePx: 16 }]).some((f) => f.rule === "contrast-low-alpha"), false);
	assert.equal(auditContrast([{ fg: "rgba(0,0,0,0.84)", bg: "#fff", fontSizePx: 16 }]).some((f) => f.rule === "contrast-low-alpha"), true);
});

test("auditContrast：currentColor 之类动态值跳过并说明，不瞎报", () => {
	const findings = auditContrast([{ fg: "currentColor", bg: "#FFFFFF", fontSizePx: 16, where: "x.css:3" }]);
	assert.equal(findings.length, 1, "只应有那一条 info");
	assert.equal(findings[0].rule, "contrast-invalid");
	assert.equal(findings[0].severity, "info");
	assert.ok(findings[0].message.includes("currentColor"), "message 要回显原值");
	assert.ok(findings[0].message.includes("跳过"), "message 要说明已跳过");
	assert.equal(findings[0].where, "x.css:3");
	assert.equal(findings.some((f) => f.severity === "error" || f.severity === "warn"), false, "跳过时不能报 error/warn");

	const bgBad = auditContrast([{ fg: "#333", bg: "var(--surface)", fontSizePx: 16 }]);
	assert.equal(bgBad.length, 1);
	assert.ok(bgBad[0].message.includes("背景色"), "背景解析失败要点明是背景色");
});

test("auditContrast：大字阈值放宽 + isLargeText 边界（WCAG 原文口径）", () => {
	// WCAG 原文：非粗体 ≥24px（18pt），或粗体 ≥18.66px（14pt）才算大字。
	assert.equal(isLargeText(24, false), true, "非粗 ≥24px 算大字");
	assert.equal(isLargeText(23.9, false), false, "非粗 <24px 仍算正文");
	assert.equal(isLargeText(18.66, true), true, "粗体 ≥18.66px 算大字");
	assert.equal(isLargeText(18.65, true), false, "粗体 <18.66px 仍算正文");
	assert.equal(isLargeText(undefined), false, "字号缺失按正文处理");

	// 3.11:1 的色对：正文报 error；24px 常规 / 18.67px 粗体都按大字放宽到 3:1
	const body = auditContrast([{ fg: "#8A8C86", bg: "#F5F5F2", fontSizePx: 16 }]);
	assert.ok(body.some((f) => f.rule === "contrast-wcag-aa" && f.severity === "error"), "正文 3.11:1 必须报 error");

	const large = auditContrast([{ fg: "#8A8C86", bg: "#F5F5F2", fontSizePx: 24 }]);
	assert.equal(large.some((f) => f.rule === "contrast-wcag-aa"), false, "24px 常规 3.11:1 已过大字 AA 3:1，不能再报 error");
	const aaa = large.filter((f) => f.rule === "contrast-wcag-aaa");
	assert.equal(aaa.length, 1, "大字应给一条 AAA 可选提升 info");
	assert.equal(aaa[0].severity, "info");
	assert.ok(aaa[0].message.includes("可选") || aaa[0].fix.includes("可选"), "AAA 一条要写成可选提升");

	const midBold = auditContrast([{ fg: "#8A8C86", bg: "#F5F5F2", fontSizePx: 18.67, bold: true }]);
	assert.equal(midBold.some((f) => f.rule === "contrast-wcag-aa"), false, "18.67px 粗体按大字放宽到 3:1");
	const midRegular = auditContrast([{ fg: "#8A8C86", bg: "#F5F5F2", fontSizePx: 20 }]);
	assert.equal(midRegular.some((f) => f.rule === "contrast-wcag-aa"), true, "20px 常规仍算正文（4.5:1）");
});

test("isLargeText：20px 粗体算大字、20px 常规不算", () => {
	assert.equal(isLargeText(20, true), true, "20px 粗体 ≥18.66px，算大字");
	assert.equal(isLargeText(20, false), false, "20px 常规 <24px，不算大字");
});

test("auditContrast：同一色对 #888 on #fff，20px 常规报 AA、20px 粗体因大字阈值不报", () => {
	// #888 on #FFFFFF ≈ 3.54:1：低于正文 4.5，但高于大字 3.0
	near(contrastRatio("#888", "#fff"), 3.545, 0.002, "#888 on 白");
	const regular = auditContrast([{ fg: "#888888", bg: "#FFFFFF", fontSizePx: 20 }]);
	const aaRegular = regular.filter((f) => f.rule === "contrast-wcag-aa");
	assert.equal(aaRegular.length, 1, "20px 常规 3.54:1 必须命中 AA error");
	assert.equal(aaRegular[0].severity, "error");
	assert.ok(aaRegular[0].message.includes("4.5:1"), "正文阈值应为 4.5:1");

	const bold = auditContrast([{ fg: "#888888", bg: "#FFFFFF", fontSizePx: 20, bold: true }]);
	const aaBold = bold.filter((f) => f.rule === "contrast-wcag-aa");
	assert.equal(aaBold.length, 0, "20px 粗体按大字 3:1 已达标，不该报 AA error");
	assert.ok(bold.some((f) => f.rule === "contrast-wcag-aaa"), "大字 3.54:1 未到 AAA 4.5，应给可选提升 info");
});

test("auditContrast：WCAG 达标但 APCA 偏弱时只出 warn", () => {
	// #777 on #000 = 4.69:1（过 AA），但 APCA Lc ≈ -30.6，远低于 |Lc| 60 —— 深色底的经典坑
	const findings = auditContrast([{ fg: "#777777", bg: "#000000", fontSizePx: 16 }]);
	assert.equal(findings.some((f) => f.rule === "contrast-wcag-aa"), false, "4.69:1 不该报 AA error");
	const apca = findings.filter((f) => f.rule === "contrast-apca");
	assert.equal(apca.length, 1, "应命中一条 APCA warn");
	assert.equal(apca[0].severity, "warn");
	assert.ok(apca[0].message.includes("APCA Lc"), "message 要含 Lc 数值");
	assert.ok(apca[0].message.includes("60"), "message 要含 |Lc| 阈值");
	const fixHex = hexIn(apca[0].fix);
	assert.ok(Math.abs(apcaLc(fixHex, "#000000", 16)) >= 60, `建议色 ${fixHex} 反算 |Lc| 未达 60`);
});

test("auditContrast：每条规则最多 3 条，且全局按 ratio 升序", () => {
	const pairs = Array.from({ length: 10 }, (_, i) => ({
		fg: `#${(0x60 + i * 10).toString(16).padStart(2, "0")}7A7A`,
		bg: "#F5F5F2",
		fontSizePx: 16,
		where: `row${i}`
	}));
	const findings = auditContrast(pairs);
	const counts = new Map();
	for (const f of findings) counts.set(f.rule, (counts.get(f.rule) ?? 0) + 1);
	for (const [rule, n] of counts) assert.ok(n <= 3, `${rule} 报了 ${n} 条，超过 3 条上限`);

	// 最糟的是 i=9（最浅），所以第一条 where 必须是 row9
	assert.equal(findings[0].where, "row9", `最糟的色对应排最前，实测 ${findings[0].where}`);
	// 同一规则内 where 序号必须递减（越浅越糟 → 越先出）
	for (const rule of counts.keys()) {
		const seq = findings.filter((f) => f.rule === rule).map((f) => Number(f.where.replace("row", "")));
		for (let i = 1; i < seq.length; i += 1) assert.ok(seq[i] < seq[i - 1], `${rule} 顺序不对：${seq.join(",")}`);
	}
	// 无法解析的排在最后
	const mixed = auditContrast([{ fg: "currentColor", bg: "#fff", fontSizePx: 16, where: "dyn" }, ...pairs]);
	assert.equal(mixed[mixed.length - 1].rule, "contrast-invalid", "无法测量的应排在能测的后面");
});

test("确定性与无损：同输入同输出，可 JSON 往返", () => {
	const pairs = [
		{ fg: "#8A8C86", bg: "#F5F5F2", fontSizePx: 16, where: "a" },
		{ fg: "#777777", bg: "#000000", fontSizePx: 16, where: "b" },
		{ fg: "rgba(0,0,0,0.5)", bg: "#fff", fontSizePx: 14, where: "c" },
		{ fg: "currentColor", bg: "#fff", fontSizePx: 16, where: "d" },
		{ fg: "#8A8C86", bg: "#F5F5F2", fontSizePx: 26, where: "e" }
	];
	const first = auditContrast(pairs);
	const second = auditContrast(pairs.map((p) => ({ ...p })));
	assert.deepEqual(second, first, "两次调用必须完全一致（建议色不能随机）");
	assertLossless(first, "auditContrast 输出");
	for (const f of first) {
		// contrast-invalid 是「测不了」，天然没有建议色；其余规则都必须给出具体 hex
		if (f.rule === "contrast-invalid") continue;
		assert.notEqual(hexIn(f.fix), undefined, `${f.rule} 的 fix 没给颜色：${f.fix}`);
	}
});

test("性能：1000 组颜色 < 100ms", () => {
	const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
	const pairs = Array.from({ length: 1000 }, (_, i) => ({
		fg: `#${hex2((i * 37) % 256)}${hex2((i * 91) % 256)}${hex2((i * 53) % 256)}`,
		bg: `#${hex2((i * 17 + 100) % 256)}${hex2((i * 61 + 140) % 256)}${hex2((i * 29 + 200) % 256)}`,
		fontSizePx: 12 + (i % 20),
		bold: i % 3 === 0,
		where: `case${i}`
	}));
	const t0 = performance.now();
	const findings = auditContrast(pairs);
	const ms = performance.now() - t0;
	assert.ok(ms < 100, `1000 组耗时 ${ms.toFixed(1)}ms，超过 100ms 预算`);
	assert.ok(findings.length <= 12, `发现项应被 4 条规则 × 3 条封顶，实测 ${findings.length}`);
	assertLossless(findings, "1000 组输出");
});
