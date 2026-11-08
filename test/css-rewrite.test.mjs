// test/css-rewrite.test.mjs — CSS 机械收敛（css_edit 的底层）。
//
// 这条能力的来由很直白：做真实项目时，“间距对齐 4px 网格”这件事手写了三次同样逻辑。
// 断言全部围绕**不能碰的东西**：注释、字符串、var()/calc()/百分比/em、裸 0、负值方向。
import assert from "node:assert/strict";
import { test } from "node:test";

import { inspectCss, inspectRadius, mapFontSizes, normalizeLeading, normalizeRadius, scanDecls, snapSpacing } from "../lib/css-rewrite.js";

test("snap：间距对齐网格，多值/负值/裸 0 各自正确", () => {
	const css = ".a{margin:6px 13.6px;padding:10px;gap:22.4px}.b{margin:-6px 0 2px 12px}";
	const r = snapSpacing(css);
	const map = new Map(r.changes.map((c) => [c.from, c.to]));
	assert.equal(map.get("6px 13.6px"), "8px 12px");
	assert.equal(map.get("10px"), "12px");
	assert.equal(map.get("22.4px"), "24px");
	assert.equal(map.get("-6px 0 2px 12px"), "-8px 0 2px 12px", "负值只调幅度不改方向，裸 0 原样保留");
});

test("snap：注释、字符串、var/calc/百分比/auto 一处都不碰", () => {
	const css = '/* margin:5px */.a{margin:5px} .b{margin:var(--s)} .c{padding:calc(2px + 1px)} .d{gap:5%} .e{margin:1.5em} .f{margin:0 auto} .g::before{content:"margin:7px"}';
	const r = snapSpacing(css);
	assert.equal(r.changes.length, 1, `只应改 .a 那一处，实际 ${JSON.stringify(r.changes)}`);
	assert.ok(r.output.includes("/* margin:5px */"), "注释原样");
	assert.ok(r.output.includes('content:"margin:7px"'), "字符串原样");
	assert.ok(r.output.includes("margin:var(--s)") && r.output.includes("padding:calc(2px + 1px)"), "var/calc 原样");
	assert.ok(r.output.includes("margin:0 auto"), "auto 原样");
	assert.ok(r.skipped >= 5, `跳过的条数应能报出来，实际 ${r.skipped}`);
});

test("snap：0.5 / 1 / 2px 保留（描边与微调本来就不该拉齐）", () => {
	const r = snapSpacing(".a{margin:0.5px 1px 2px 9px}");
	assert.equal(r.changes[0].to, "0.5px 1px 2px 8px");
});

test("scale：字号就近归并，非 px / var 的跳过", () => {
	const css = ".a{font-size:10.5px}.b{font-size:13.6px}.c{font-size:var(--fs)}.d{font-size:1.2rem}.e{font-size:40px}";
	const r = mapFontSizes(css, { scale: [12, 14, 16, 20, 40] });
	const map = new Map(r.changes.map((c) => [c.from, c.to]));
	assert.equal(map.get("10.5px"), "12px");
	assert.equal(map.get("13.6px"), "14px");
	assert.equal(r.changes.length, 2, "var/rem 必须跳过");
	assert.equal(r.skipped, 2);
});

test("scale：平局取**大的**那档（往小缩会让中文变糊）", () => {
	const r = mapFontSizes(".a{font-size:13px}", { scale: [12, 14] });
	assert.equal(r.changes[0].to, "14px", "13px 到 12/14 等距，应选大的");
});

test("scale：阶梯不足两档时响亮报错", () => {
	assert.throws(() => mapFontSizes(".a{font-size:10px}", { scale: [14] }), /至少给两档/);
});

test("scanDecls：伪类选择器不会被当成声明（.a:hover 不是 prop）", () => {
	const decls = scanDecls(".a:hover{color:#111}.b{padding:4px}");
	const props = decls.map((d) => d.prop);
	assert.ok(props.includes("padding"), "真声明要在");
	assert.equal(props.includes("hover"), false, `hover 不应被当成声明，实际 ${JSON.stringify(props)}`);
});

test("inspectCss：能报出“不在网格的间距”与“字号档位”，且确定性", () => {
	const css = ".a{margin:6px;padding:8px}.b{font-size:10.5px}.c{font-size:13.6px}.d{font-size:10.5px}";
	const info = inspectCss(css);
	assert.equal(info.grid, 4);
	assert.equal(info.offGridCount, 1, "只有 6px 不在网格");
	assert.equal(info.offGrid[0].px, 6);
	assert.deepEqual(info.fontSizes.map((s) => s.px), [10.5, 13.6]);
	assert.deepEqual(inspectCss(css), info, "同输入必须同结果");
});

/* ---------------- 行高归一（规则 B，从 4 个项目的 78 处声明里选出来的） ---------------- */

// 为什么是这套规则：模拟三种方案后，B 只改 23% 的声明就把 S3 从 10 处降到 2 处；
// A（含 1.35 档）改同样多却仍是 10 处——因为 1.35–1.5 正是 S3 的告警区；
// C（标题也归并）多改 56% 的声明，收益为零。

test("leading：正文死区 1.2–1.5 抬到 1.5，≥1.5 就近归并 1.5/1.6/1.8（平局取大）", () => {
	const css = ".a{line-height:1.3}.b{line-height:1.4}.c{line-height:1.7}.d{line-height:1.55}.e{line-height:1.5}";
	const r = normalizeLeading(css);
	const map = new Map(r.changes.map((c) => [c.from, c.to]));
	assert.equal(map.get("1.3"), "1.5", "死区应抬到 1.5（S3 的告警区就是这里）");
	assert.equal(map.get("1.4"), "1.5");
	assert.equal(map.get("1.7"), "1.8", "1.7 到 1.6/1.8 等距，取大的");
	assert.equal(map.get("1.55"), "1.6");
	assert.equal(r.changes.some((c) => c.from === "1.5"), false, "1.5 已在阶梯上，不该动");
});

test("leading：标题级一律不动（S3 本来就不判它们，改与不改要同理）", () => {
	const css = "h1{line-height:1.1}h2{line-height:1.3}.hero-title{line-height:1.4}.body{line-height:1.3}";
	const r = normalizeLeading(css);
	assert.equal(r.changes.length, 1, `只应改 .body，实际 ${JSON.stringify(r.changes)}`);
	assert.equal(r.changes[0].from, "1.3");
});

test("leading：极紧凑（<1.2）与极松散（>2.2）保留，px/var/normal 跳过", () => {
	const css = ".a{line-height:1}.b{line-height:1.1}.c{line-height:2.5}.d{line-height:24px}.e{line-height:var(--lh)}.f{line-height:normal}";
	const r = normalizeLeading(css);
	assert.equal(r.changes.length, 0, `一处都不该改，实际 ${JSON.stringify(r.changes)}`);
	assert.ok(r.skipped >= 3, `px/var/normal 应计入 skipped，实际 ${r.skipped}`);
});

test("leading：注释里的声明不动；幂等", () => {
	const css = "/* line-height:1.3 */ .a{line-height:1.3}";
	const once = normalizeLeading(css);
	assert.equal(once.changes.length, 1);
	assert.ok(once.output.includes("/* line-height:1.3 */"), "注释原样");
	const twice = normalizeLeading(once.output);
	assert.equal(twice.changes.length, 0, "第二次应无改动");
});

/* ---------------- 圆角收敛（带令牌化门槛） ---------------- */

// 为什么有门槛：4 个真实项目里，Colibri/Echo/Flow-Pilot 的圆角 119/34/7 处都是 var()，
// 只有旧版 0.5.4 是 124 处散落 px。在前者上改 px 不会改变外观——
// “看起来成功、实际无效”的改写比不改更坏。

test("radius：非令牌化项目里按阶梯收敛，胶囊/圆/0 保留", () => {
	const css = ".a{border-radius:5px}.b{border-radius:6px}.c{border-radius:20px}.d{border-radius:999px}.e{border-radius:50%}.f{border-radius:0}";
	const r = normalizeRadius(css);
	const map = new Map(r.changes.map((c) => [c.from, c.to]));
	assert.equal(map.get("5px"), "4px", "5 到 4/8 中 4 更近");
	assert.equal(map.get("6px"), "8px", "6 到 4/8 等距，取大");
	assert.equal(map.get("20px"), "12px");
	assert.equal(r.changes.some((c) => c.from === "999px"), false, "胶囊不该被改小");
	assert.equal(r.changes.some((c) => c.from === "50%"), false, "圆形不该被改");
	assert.equal(r.changes.some((c) => c.from === "0"), false, "无圆角不该被改");
});

test("radius：令牌化项目直接拒绝，并告诉该改什么", () => {
	const css = ":root{--r:8px}.a{border-radius:var(--r)}.b{border-radius:var(--r)}.c{border-radius:var(--r)}.d{border-radius:5px}";
	const info = inspectRadius(css);
	assert.equal(info.tokenized, 3);
	assert.ok(info.tokenizedRatio >= 0.5, `令牌化率应≥0.5，实际 ${info.tokenizedRatio}`);
	assert.throws(() => normalizeRadius(css), /已令牌化.*--radius-\*/, "应拒绝并给出正确做法");
});

test("radius：单角属性与多值简写不动（单角常是刻意的不对称）", () => {
	const css = ".a{border-top-left-radius:5px}.b{border-radius:5px 5px 0 0}";
	const r = normalizeRadius(css);
	assert.equal(r.changes.length, 0, `都不该改，实际 ${JSON.stringify(r.changes)}`);
});

test("radius：幂等", () => {
	const once = normalizeRadius(".a{border-radius:5px}.b{border-radius:20px}");
	assert.equal(once.changes.length, 2);
	assert.equal(normalizeRadius(once.output).changes.length, 0, "第二次应无改动");
});

test("契约：四个动作的 changes 形状统一（都带 prop）", () => {
	// 实际踩过：radius 的 changes 没带 prop，工具输出把它显示成 font-size，
	// 用户以为在改字号。形状不统一就必然长出一个笼子。
	const cases = [
		["snap", snapSpacing(".a{margin:6px}")],
		["scale", mapFontSizes(".a{font-size:13px}", { scale: [12, 14] })],
		["leading", normalizeLeading(".a{line-height:1.3}")],
		["radius", normalizeRadius(".a{border-radius:5px}")]
	];
	for (const [name, result] of cases) {
		assert.ok(result.changes.length > 0, `${name}: 样本应产生改动`);
		for (const c of result.changes) {
			assert.equal(typeof c.prop, "string", `${name}: 每条改动必须带 prop`);
			assert.ok(c.prop !== "", `${name}: prop 不能为空`);
			assert.equal(typeof c.from, "string", `${name}: from 必须是字符串`);
			assert.equal(typeof c.to, "string", `${name}: to 必须是字符串`);
		}
	}
});

test("幂等：对齐过的样式再对齐一次不应再变", () => {
	const once = snapSpacing(".a{margin:6px 13.6px;padding:10px}").output;
	const twice = snapSpacing(once);
	assert.equal(twice.changes.length, 0, "第二次应无改动");
	assert.equal(twice.output, once);
});
