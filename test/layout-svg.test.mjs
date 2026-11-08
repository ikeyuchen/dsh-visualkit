// test/layout-svg.test.mjs — layout_check action=svg（成品 SVG 文字几何体检）的发布前测试。
//
// 覆盖：
//   1. 三个 fixture 的端到端结论（好海报 / 坏海报 / 居中卡片）；
//   2. G1–G9 每条规则的「命中样本 + 反例」；
//   3. viewBox 缩放后字号换算成渲染像素（同一 SVG 只改 width）；
//   4. <g transform> 内文字只记 unmeasured、不参与几何；
//   5. 工具层两条输入路径（内联标记 / cwd 下的 .svg 文件）与 render 文本；
//   6. 确定性、输出无损 JSON、错误路径（缺画布尺寸 / 非 SVG / 空输入 / 文件不存在）。
//
// 为什么一半用例走工具层：svg.js 只是纯函数，真正的产品契约是 layout_check 的
// execute → output.schema → render 链路（宿主会判 INVALID_TOOL_OUTPUT），
// 所以关键样本都从 call("layout_check", { action: "svg" }) 拿结果。
import assert from "node:assert/strict";
import { test } from "node:test";

import { assertLossless, call, rejects, tempDir, writeTree } from "./helpers.mjs";
import { auditSvg } from "../lib/layouts/svg.js";

/* ------------------------------ 样本 ------------------------------ */

const CANVAS_ATTRS = 'width="800" height="1200" viewBox="0 0 800 1200"';
const svg = (inner, attrs = CANVAS_ATTRS) => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;

/** (a) 好海报：标题 64 / 正文 20（3.2×）、行距 1.4×、四周留白 8%、左对齐 4 行正文。 */
const GOOD_POSTER = svg(`
  <text x="64" y="180" font-size="64" font-weight="700" fill="#111111">设计的力量</text>
  <text x="64" y="420" font-size="20" fill="#333333">排版是信息的秩序</text>
  <text x="64" y="448" font-size="20" fill="#333333">留白给内容呼吸的空间</text>
  <text x="64" y="476" font-size="20" fill="#333333">层级决定阅读顺序</text>
  <text x="64" y="504" font-size="20" fill="#333333">字距与行距决定节奏感</text>
`);

/** (b) 坏海报：8 种字号、贴边 1%、行距 1.0×、文字重叠、溢出画布。 */
const BAD_POSTER = svg(`
  <text x="8" y="100" font-size="72">坏海报</text>
  <text x="8" y="220" font-size="56">八种字号</text>
  <text x="8" y="300" font-size="44">没有层级</text>
  <text x="8" y="360" font-size="36">贴边</text>
  <text x="8" y="420" font-size="32">行距太密第一行</text>
  <text x="8" y="452" font-size="32">行距太密第二行</text>
  <text x="400" y="700" font-size="40">重叠甲甲甲</text>
  <text x="400" y="700" font-size="40">重叠乙乙乙</text>
  <text x="760" y="900" font-size="28">严重溢出画布</text>
  <text x="8" y="1080" font-size="18">八种字号都有</text>
`);

/** (c) 居中卡片：标题 + 两行说明 + 按钮文案，全部 text-anchor=middle。 */
const CENTER_CARD = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <text x="300" y="100" font-size="32" text-anchor="middle" font-weight="700">早安，设计师</text>
  <text x="300" y="160" font-size="16" text-anchor="middle">今天也要做点好东西<tspan x="300" dy="24">留白是最好的排版</tspan></text>
  <text x="300" y="280" font-size="14" text-anchor="middle" fill="#E4002B">立即查看</text>
</svg>`;

const TOOL = "layout_check";
const runTool = (input, opts) => call(TOOL, { action: "svg", input }, opts);

/** 某条规则的全部 finding（按 id 精确匹配，G0-* 不会被 "G0" 误伤）。 */
const findingsOf = (report, rule) => report.findings.filter((item) => item.rule === rule);
const severitiesOf = (report, rule) => findingsOf(report, rule).map((item) => item.severity);

/* ------------------------------ 1. 端到端：好海报 ------------------------------ */

test("svg: 好海报 —— clean 档、无 error、metrics 齐全（工具层内联）", async () => {
	const { value, text } = await runTool(GOOD_POSTER);
	assert.equal(value.mode, "svg", "mode 应为 svg");
	assert.equal(value.target, "inline-svg", "内联标记的 target 应为 inline-svg");
	assert.equal(typeof value.score, "number", "score 应是数字");
	assert.ok(value.score <= 20, `好海报分数应 ≤20，实际 ${value.score}`);
	assert.equal(value.counts.error, 0, "好海报不应有 error");
	assert.equal(value.counts.warn, 0, "好海报不应有 warn");
	assert.deepEqual(value.findings, [], "好海报不应有任何 finding");
	assert.equal(value.grade, "clean", "0 分应判 clean");
	assert.deepEqual(value.metrics.canvas, [800, 1200], "canvas 应为 viewBox 宽高");
	assert.deepEqual(value.metrics.fontSizes, [20, 64], "字号应升序去重为 [20,64]");
	assert.equal(value.metrics.hierarchyRatio, 3.2, "64/20 的层级比应为 3.2");
	assert.equal(value.metrics.lines, 5, "标题 1 行 + 正文 4 行 = 5 行");
	assert.equal(value.metrics.textCount, 5, "共 5 个 <text>");
	assert.equal(value.metrics.marginsPct.left, 8, "左边距应为 8%");
	assert.equal(value.metrics.coveragePct, 12.64, "内容包围盒应占画布 12.64%");
	assert.equal(value.metrics.unmeasured, 0, "好海报没有 transform 内文字");
	assert.equal(value.metrics.backgroundPlates, 0, "好海报没有背景板（无图形）");
	assert.equal(value.metrics.minFontPx, 20, "最小字号渲染后 20px（scale=1）");
	assert.equal(value.metrics.scale, 1, "width=800/viewBox 800 → scale=1");
	assert.ok(text.includes("layout_check [svg]"), "render 文本应含 layout_check [svg]");
	assert.ok(text.includes("no layout issues"), "无 finding 时 render 应说明干净");
	assertLossless(value, "layout_check[svg] 输出");
});

/* ------------------------------ 2. 端到端：坏海报 ------------------------------ */

test("svg: 坏海报 —— ≥60 分且 G1/G3/G6 均为 error（工具层内联）", async () => {
	const { value, text } = await runTool(BAD_POSTER);
	assert.ok(value.score >= 60, `坏海报分数应 ≥60，实际 ${value.score}`);
	assert.equal(value.grade, "bad", "≥60 应判 bad");
	assert.ok(value.counts.error >= 3, `至少 3 个 error，实际 ${value.counts.error}`);
	for (const rule of ["G1", "G3", "G6"]) {
		assert.ok(severitiesOf(value, rule).includes("error"), `${rule} 应命中 error`);
	}
	assert.ok(severitiesOf(value, "G5").includes("error"), "G5 溢出画布应命中 error");
	assert.ok(severitiesOf(value, "G2").includes("warn"), "G2 字号档过多应命中 warn");
	assert.deepEqual(value.metrics.fontSizes, [18, 28, 32, 36, 40, 44, 56, 72], "坏海报应有 8 种字号");
	assert.ok(text.includes("layout_check [svg]"), "render 文本应含 layout_check [svg]");
	assert.ok(text.includes("error"), "render 文本应列出 error");
});

/* ------------------------------ 3. 好/坏分差 ------------------------------ */

test("svg: 好/坏样本分数差 ≥50，且坏样本规则集合覆盖 G1/G3/G5/G6", () => {
	const good = auditSvg(GOOD_POSTER, { name: "good" });
	const bad = auditSvg(BAD_POSTER, { name: "bad" });
	assert.ok(bad.score - good.score >= 50, `坏稿应比好稿重 ≥50 分（${bad.score} vs ${good.score}）`);
	// 好稿允许 ≤1 条 advisory（对比度 AAA 可选提升之类），但绝不能有 error/warn。
	// 新增的 contrast / structure 规则同样受这条约束。
	assert.equal(good.counts.error, 0, `好稿不应有 error（实际 ${good.findings.filter((f) => f.severity === "error").map((f) => f.rule).join(",")}）`);
	assert.equal(good.counts.warn, 0, `好稿不应有 warn（实际 ${good.findings.filter((f) => f.severity === "warn").map((f) => f.rule).join(",")}）`);
	assert.ok(good.findings.length <= 1, `好稿最多 1 条 info，实际 ${good.findings.length}`);
	assert.ok(bad.findings.length >= 4, `坏稿应有多条 finding，实际 ${bad.findings.length}`);
	assert.equal(good.grade, "clean", "好稿应 clean");
	const badRules = new Set(bad.findings.map((item) => item.rule));
	for (const rule of ["G1", "G3", "G5", "G6"]) assert.ok(badRules.has(rule), `坏稿应命中 ${rule}`);
	assert.ok(good.score < bad.score, "分数必须严格区分好稿与坏稿");
});

/* ------------------------------ 4. 居中卡片 ------------------------------ */

test("svg: 居中卡片 —— 对齐一致、无 error、层级 2×", () => {
	const report = auditSvg(CENTER_CARD, { name: "card" });
	assert.equal(report.counts.error, 0, "居中卡片不应有 error");
	assert.deepEqual(findingsOf(report, "G7"), [], "居中卡片不应被判对齐混乱");
	assert.deepEqual(report.metrics.fontSizes, [14, 16, 32], "字号应为 [14,16,32]");
	assert.equal(report.metrics.hierarchyRatio, 2, "32/16 = 2× 层级");
	assert.equal(report.metrics.textCount, 3, "标题 + 说明 + 按钮共 3 个 <text>");
	assert.equal(report.metrics.lines, 4, "说明用 tspan dy 拆成 2 行，共 4 行");
	assert.equal(report.metrics.marginsPct.left, 34, "卡片内容左边距 34%");
	assert.equal(report.score, 0, "干净卡片应为 0 分");
});

/* ------------------------------ 5. G1 安全区 ------------------------------ */

test("svg: G1 安全区 —— 2% error / 4% warn / 8% 干净", () => {
	const tight = auditSvg(svg('<text x="16" y="200" font-size="20">贴边字</text>'));
	assert.ok(severitiesOf(tight, "G1").includes("error"), "留白 2% 应判 G1 error");
	const near = auditSvg(svg('<text x="32" y="200" font-size="20">近边字</text>'));
	assert.ok(severitiesOf(near, "G1").includes("warn"), "留白 4% 应判 G1 warn");
	const safe = auditSvg(svg('<text x="64" y="200" font-size="20">安全区字</text>'));
	assert.deepEqual(findingsOf(safe, "G1"), [], "留白 8% 不应命中 G1");
	assert.ok(findingsOf(tight, "G1")[0].message.includes("安全区"), "G1 消息应说明安全区要求");
});

/* ------------------------------ 6. G2 字号层级 ------------------------------ */

test("svg: G2 字号层级 —— 单行 banner 降 info / 多行无层级 error / 1.5× warn / 7 档 warn", () => {
	// 单行/徽标类版面：不硬扣 15 分，只留 info（回归口径）
	const single = auditSvg(svg('<text x="100" y="200" font-size="24">只有一档</text>'));
	assert.ok(severitiesOf(single, "G2").includes("info"), "单行版面只有一档字号应降为 info");
	assert.deepEqual(findingsOf(single, "G2").map((item) => item.severity), ["info"], "单行版面 G2 不应再有 error");
	assert.equal(single.counts.error, 0, "单行 banner/徽标不应有 error");

	// 真正该报的是「多行正文 + 无层级」
	const flatBody = auditSvg(
		svg(
			'<text x="100" y="200" font-size="20">正文第一行</text>' +
				'<text x="100" y="228" font-size="20">正文第二行</text>' +
				'<text x="100" y="256" font-size="20">正文第三行</text>' +
				'<text x="100" y="284" font-size="20">正文第四行</text>'
		)
	);
	assert.ok(severitiesOf(flatBody, "G2").includes("error"), "多行正文只有一种字号应判 G2 error");
	assert.ok(findingsOf(flatBody, "G2")[0].message.includes("只有一种字号"), "多行无层级的 G2 应说明只有一种字号");

	const weak = auditSvg(
		svg(
			'<text x="100" y="200" font-size="30">标题</text>' +
				'<text x="100" y="300" font-size="20">正文一</text>' +
				'<text x="100" y="400" font-size="20">正文二</text>'
		)
	);
	assert.ok(severitiesOf(weak, "G2").includes("warn"), "1.5× 层级应判 G2 warn");
	assert.equal(weak.metrics.hierarchyRatio, 1.5, "30/20 的层级比应为 1.5");

	const many = auditSvg(
		svg(
			Array.from({ length: 7 }, (_, index) => `<text x="${120 + index * 90}" y="${220 + index * 120}" font-size="${20 + index * 6}">档${index}</text>`).join("")
		)
	);
	const manyFindings = findingsOf(many, "G2");
	assert.ok(manyFindings.some((item) => item.message.includes("档位过多")), "7 种字号应报档位过多");
	assert.ok(severitiesOf(many, "G2").includes("warn"), "档位过多应为 warn");

	const good = auditSvg(svg('<text x="64" y="200" font-size="64">标题</text><text x="64" y="320" font-size="20">正文</text>'));
	assert.deepEqual(findingsOf(good, "G2"), [], "3.2× 层级不应命中 G2");
});

/* ------------------------------ 7. G3 行距 ------------------------------ */

test("svg: G3 行距 —— 1.0× error / 1.2× warn / 3.0× warn / 1.4× 干净（工具层同验）", async () => {
	const dense = svg('<text x="100" y="200" font-size="20">上一行</text><text x="100" y="220" font-size="20">下一行</text>');
	assert.ok(severitiesOf(auditSvg(dense), "G3").includes("error"), "行距 1.0× 应判 G3 error");

	const tight = svg('<text x="100" y="200" font-size="20">上一行</text><text x="100" y="224" font-size="20">下一行</text>');
	assert.ok(severitiesOf(auditSvg(tight), "G3").includes("warn"), "行距 1.2× 应判 G3 warn");

	const loose = svg('<text x="100" y="200" font-size="20">上一行</text><text x="100" y="260" font-size="20">下一行</text>');
	assert.ok(severitiesOf(auditSvg(loose), "G3").includes("warn"), "行距 3.0× 应判 G3 warn");

	const normal = svg('<text x="100" y="200" font-size="20">上一行</text><text x="100" y="228" font-size="20">下一行</text>');
	assert.deepEqual(findingsOf(auditSvg(normal), "G3"), [], "行距 1.4× 不应命中 G3");

	const { value } = await runTool(dense);
	assert.ok(severitiesOf(value, "G3").includes("error"), "工具层也应报 G3 error");
});

/* ------------------------------ 8. G4 行长 ------------------------------ */

test("svg: G4 行长 —— 宽度占比 >85% 与单行 CJK >45 都报 warn", () => {
	const wide = auditSvg(svg(`<text x="40" y="200" font-size="40">${"排".repeat(18)}</text>`));
	const wideFindings = findingsOf(wide, "G4");
	assert.ok(wideFindings.some((item) => item.message.includes("单行过长")), "18 字 × 40 = 720/800 应报单行过长");
	assert.ok(severitiesOf(wide, "G4").includes("warn"), "行长超限应为 warn");

	const longCjk = auditSvg(svg(`<text x="100" y="200" font-size="12">${"字".repeat(50)}</text>`));
	assert.ok(
		findingsOf(longCjk, "G4").some((item) => item.message.includes("汉字")),
		"一行 50 个汉字应报 CJK 行长"
	);

	const short = auditSvg(svg('<text x="100" y="200" font-size="20">短句</text>'));
	assert.deepEqual(findingsOf(short, "G4"), [], "短句不应命中 G4");
});

/* ------------------------------ 9. G5 溢出 / G6 重叠 ------------------------------ */

test("svg: G5 溢出画布与 G6 文字重叠 —— error 命中且各有反例", () => {
	const overflow = auditSvg(svg('<text x="760" y="400" font-size="40">溢出字</text>'));
	assert.ok(severitiesOf(overflow, "G5").includes("error"), "文字越过右边 1px 以上应判 G5 error");
	assert.ok(findingsOf(overflow, "G5")[0].message.includes("溢出"), "G5 消息应说明溢出");
	const inside = auditSvg(svg('<text x="700" y="400" font-size="20">内</text>'));
	assert.deepEqual(findingsOf(inside, "G5"), [], "文字在画布内不应命中 G5");

	// 同一文本块内的行贴行归 G3；让两块错开 x 才是「不同文本块重叠」
	const overlap = auditSvg(svg('<text x="200" y="400" font-size="40">重叠甲</text><text x="240" y="400" font-size="40">重叠乙</text>'));
	assert.ok(severitiesOf(overlap, "G6").includes("error"), "两块文字大面积交叠应判 G6 error");
	const apart = auditSvg(svg('<text x="200" y="400" font-size="20">甲</text><text x="200" y="500" font-size="20">乙</text>'));
	assert.deepEqual(findingsOf(apart, "G6"), [], "分开的文字不应命中 G6");
});

/* ------------------------------ 10. G7 对齐 ------------------------------ */

test("svg: G7 对齐 —— 无对齐簇 warn / 两种对齐打架 warn / 单一左对齐干净", () => {
	const scattered = auditSvg(
		svg(
			'<text x="37" y="200" font-size="20">甲甲甲甲</text>' +
				'<text x="151" y="260" font-size="20">乙乙乙乙乙乙</text>' +
				'<text x="293" y="320" font-size="20">丙丙丙</text>' +
				'<text x="602" y="380" font-size="20">丁丁丁丁丁丁丁丁</text>'
		)
	);
	assert.ok(
		findingsOf(scattered, "G7").some((item) => item.message.includes("没有任何对齐关系")),
		"四行各自为政应报没有对齐关系"
	);

	const fighting = auditSvg(
		svg(
			'<text x="100" y="200" font-size="20">甲甲甲甲</text>' +
				'<text x="100" y="240" font-size="20">乙乙乙乙乙乙</text>' +
				'<text x="400" y="320" font-size="20" text-anchor="middle">丙丙丙丙丙</text>' +
				'<text x="400" y="360" font-size="20" text-anchor="middle">丁丁丁丁丁丁丁</text>'
		)
	);
	assert.ok(
		findingsOf(fighting, "G7").some((item) => item.message.includes("对齐方式打架")),
		"左对齐 2 行 + 居中 2 行应报对齐打架"
	);

	const leftOnly = auditSvg(
		svg(
			'<text x="100" y="200" font-size="20">甲甲甲甲</text>' +
				'<text x="100" y="240" font-size="20">乙乙乙乙乙乙</text>' +
				'<text x="100" y="280" font-size="20">丙丙丙丙丙丙丙丙</text>' +
				'<text x="100" y="320" font-size="20">丁丁丁丁丁丁丁丁丁丁</text>'
		)
	);
	assert.deepEqual(findingsOf(leftOnly, "G7"), [], "统一左对齐且行长不同不应命中 G7");

	// 回归：等宽左对齐段落（左/中/右边界全相等）不得被判成「对齐方式打架」
	const equalWidth = auditSvg(
		svg(
			'<text x="100" y="200" font-size="20">甲甲甲甲甲甲</text>' +
				'<text x="100" y="240" font-size="20">乙乙乙乙乙乙</text>' +
				'<text x="100" y="280" font-size="20">丙丙丙丙丙丙</text>' +
				'<text x="100" y="320" font-size="20">丁丁丁丁丁丁</text>'
		)
	);
	assert.deepEqual(findingsOf(equalWidth, "G7"), [], "等宽左对齐段落不应命中 G7（回归）");
});

/* ------------------------------ 11. G8 缩放换算 ------------------------------ */

test("svg: G8 最小字号按 viewBox 缩放换算成渲染像素（width 400/600/800）", () => {
	const sample = (width) =>
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" viewBox="0 0 800 1200"><text x="100" y="200" font-size="12">小字</text></svg>`;

	const full = auditSvg(sample(800));
	assert.equal(full.metrics.scale, 1, "width=800 → scale=1");
	assert.equal(full.metrics.minFontPx, 12, "12 × 1 = 12px");
	assert.deepEqual(findingsOf(full, "G8"), [], "12px 不应命中 G8");

	const medium = auditSvg(sample(600));
	assert.equal(medium.metrics.scale, 0.75, "width=600 → scale=0.75");
	assert.equal(medium.metrics.minFontPx, 9, "12 × 0.75 = 9px");
	assert.ok(severitiesOf(medium, "G8").includes("warn"), "9px 应判 G8 warn");

	const small = auditSvg(sample(400));
	assert.equal(small.metrics.scale, 0.5, "width=400 → scale=0.5");
	assert.equal(small.metrics.minFontPx, 6, "12 × 0.5 = 6px");
	assert.ok(severitiesOf(small, "G8").includes("error"), "6px 应判 G8 error");
	assert.ok(findingsOf(small, "G8")[0].message.includes("缩放"), "G8 消息应交代缩放换算");
});

/* ------------------------------ 12. transform 内文字 ------------------------------ */

test("svg: transform 内文字只记 unmeasured，不参与几何判定", async () => {
	const markup = `<svg xmlns="http://www.w3.org/2000/svg" ${CANVAS_ATTRS}>
  <g transform="translate(40,40)"><text x="0" y="40" font-size="32">变换里的标题</text></g>
  <text x="100" y="500" font-size="20">正常文字</text>
</svg>`;
	const report = auditSvg(markup, { name: "transform" });
	assert.equal(report.metrics.unmeasured, 1, "transform 内 1 个 text 应计入 unmeasured");
	assert.equal(report.metrics.textCount, 1, "只有 1 个 text 参与几何");
	assert.deepEqual(report.metrics.fontSizes, [20], "未测量的 32 号字不应进入字号统计");
	assert.ok(
		findingsOf(report, "G0-transform-unmeasured").length === 1,
		"unmeasured>0 应加一条 info 说明"
	);
	assert.equal(findingsOf(report, "G0-transform-unmeasured")[0].severity, "info", "该说明应为 info");
	assert.ok(findingsOf(report, "G0-transform-unmeasured")[0].message.includes("transform"), "说明应点明 transform");

	const selfTransform = auditSvg(svg('<text x="100" y="100" font-size="20" transform="rotate(10)">旋转字</text>'));
	assert.equal(selfTransform.metrics.unmeasured, 1, "text 自身 transform 也应计入 unmeasured");
	assert.equal(selfTransform.metrics.textCount, 0, "自身 transform 的文字不参与几何");

	const { value } = await runTool(markup);
	assert.equal(value.metrics.unmeasured, 1, "工具层也应暴露 unmeasured");
	assert.ok(value.findings.some((item) => item.rule === "G0-transform-unmeasured"), "工具层应带 info 说明");
});

/* ------------------------------ 13. 默认字号 / 文件路径 ------------------------------ */

test("svg: 缺 font-size 默认 16 并加 info；.svg 文件路径按 cwd 解析", async (t) => {
	const defaulted = auditSvg(svg('<text x="100" y="200">没写字号</text>'));
	assert.deepEqual(defaulted.metrics.fontSizes, [16], "缺省应按 16 估算");
	assert.equal(defaulted.metrics.minFontPx, 16, "minFontPx 也按 16");
	assert.ok(findingsOf(defaulted, "G0-default-font-size").length === 1, "缺省字号应加一条 info");
	assert.equal(findingsOf(defaulted, "G0-default-font-size")[0].severity, "info", "缺省字号说明应为 info");

	const dir = tempDir(t, "layout-svg-file");
	writeTree(dir, { "poster.svg": GOOD_POSTER });
	const { value, text } = await call(TOOL, { action: "svg", input: "poster.svg" }, { cwd: dir });
	assert.equal(value.target, "poster.svg", "文件输入 target 应为文件名");
	assert.equal(value.mode, "svg", "文件输入 mode 仍为 svg");
	const direct = auditSvg(GOOD_POSTER, { name: "poster.svg" });
	assert.equal(value.score, direct.score, "文件路径与内联标记应得到同一结论");
	assert.deepEqual(value.metrics.canvas, [800, 1200], "文件输入也应解析出画布");
	assert.ok(text.includes("layout_check [svg]"), "文件输入的 render 文本应含 layout_check [svg]");
});

/* ------------------------------ 14. 确定性与无损 ------------------------------ */

test("svg: 确定性输出 + 无损 JSON 往返（工具层重复调用一致）", async () => {
	const first = auditSvg(BAD_POSTER, { name: "bad" });
	const second = auditSvg(BAD_POSTER, { name: "bad" });
	assert.deepEqual(first, second, "同一输入的两次结果应完全一致");
	assert.equal(JSON.stringify(first), JSON.stringify(second), "序列化结果也应一致");
	assert.deepEqual(JSON.parse(JSON.stringify(first)), first, "输出必须能 JSON 无损往返");
	assertLossless(first, "auditSvg 输出");

	const toolA = await runTool(CENTER_CARD);
	const toolB = await runTool(CENTER_CARD);
	assert.deepEqual(toolA.value, toolB.value, "工具层重复调用结果应一致");
	assert.deepEqual(toolA.text, toolB.text, "render 文本也应稳定");
});

/* ------------------------------ 15. 错误路径 ------------------------------ */

test("svg: 错误路径 —— 缺画布尺寸 / 非 SVG / 空输入 / 文件不存在", async (t) => {
	await rejects(
		() => auditSvg('<svg xmlns="http://www.w3.org/2000/svg"><text x="1" y="1">无画布</text></svg>'),
		/缺画布尺寸/,
		"没有 width/viewBox 应抛缺画布尺寸"
	);
	await rejects(() => auditSvg("<div>这不是 SVG</div>"), /不是 SVG/, "非 SVG 标记应报错");
	await rejects(() => auditSvg(""), /为空/, "空字符串应报错");
	await rejects(() => auditSvg(null), /为空/, "非字符串应报错");

	await rejects(() => call(TOOL, { action: "svg", input: "<div>hi</div>" }), /不是 SVG/, "工具层非 SVG 也应报错");
	await rejects(() => call(TOOL, { action: "svg", input: "" }), /需要 input/, "工具层空输入应提示需要 input");

	const dir = tempDir(t, "layout-svg-missing");
	await rejects(
		() => call(TOOL, { action: "svg", input: "nope.svg" }, { cwd: dir }),
		/读不到/,
		"文件不存在应报读不到"
	);
});

/* ------------------------------ 16. G9 留白（工具层） ------------------------------ */

test("svg: G9 留白 —— 内容占满 88%+ 报 warn，内容 <5% 报 info（工具层）", async () => {
	// 两块内容图形拼满画布：单块都 <90%（不是背景板），union 覆盖 >88% → 拥挤
	const crowded = await runTool(
		svg(
			'<rect x="10" y="10" width="780" height="590" fill="#EEE"/>' +
				'<rect x="10" y="600" width="780" height="590" fill="#DDD"/>' +
				'<text x="100" y="200" font-size="40">满版内容</text>'
		)
	);
	assert.ok(severitiesOf(crowded.value, "G9").includes("warn"), "内容占 95% 应判 G9 warn（拥挤）");
	assert.ok(crowded.value.metrics.coveragePct > 88, "coveragePct 应 >88");

	const empty = await runTool(svg('<text x="390" y="600" font-size="12">点</text>'));
	assert.ok(severitiesOf(empty.value, "G9").includes("info"), "内容 <5% 应判 G9 info（可能空版）");
	assert.ok(empty.value.metrics.coveragePct < 5, "coveragePct 应 <5");

	// 回归：满版底色的真实海报不能因为背景板吃 G1/G9
	const poster = await runTool(
		svg(
			'<rect width="800" height="1200" fill="#F7F5F0"/>' +
				'<text x="64" y="180" font-size="64" font-weight="700">设计的力量</text>' +
				'<text x="64" y="420" font-size="20">排版是信息的秩序</text>' +
				'<text x="64" y="448" font-size="20">留白给内容呼吸的空间</text>' +
				'<text x="64" y="476" font-size="20">层级决定阅读顺序</text>' +
				'<text x="64" y="504" font-size="20">字距与行距决定节奏感</text>'
		)
	);
	assert.ok(poster.value.score <= 10, `满版底色海报应 ≤10 分，实际 ${poster.value.score}`);
	assert.deepEqual(findingsOf(poster.value, "G1"), [], "背景板不应触发 G1（回归）");
	assert.deepEqual(findingsOf(poster.value, "G9"), [], "背景板不应触发 G9（回归）");
	assert.equal(poster.value.metrics.backgroundPlates, 1, "满版底色应识别为 1 块背景板");
});

/* --------------------- 无文字 SVG 的边距必须量图形（不能编造 0） --------------------- */

test("svg: 没有文字时 marginsPct 必须量图形内容，不能编造 0（否则读起来像贴边）", async () => {
	const onlyShape = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect x="50" y="50" width="300" height="300" fill="#333"/></svg>`;
	const report = auditSvg(onlyShape, { name: "shape-only" });
	// 真实内容边距：50/400 = 12.5%
	assert.equal(report.metrics.marginsPct.left, 12.5, "左边距应量到图形（12.5%），不是 0");
	assert.equal(report.metrics.marginsPct.top, 12.5);
	assert.equal(report.metrics.contentEmpty, undefined, "有图形内容时不应标 contentEmpty");
	assert.equal(report.metrics.textMarginsPct, undefined, "没有文字时不报 textMarginsPct");
	// G0 的文案不能再说谎：图形确实计入了留白
	const g0 = report.findings.find((f) => f.rule === "G0-no-text");
	assert.ok(g0 !== undefined, "应有 G0-no-text 提示");
	assert.match(g0.message, /1 个图形仍计入/, `G0 文案应说明图形计入留白，实际：${g0.message}`);
	// 纯空白画布：没有内容 → 标 contentEmpty，且不撒谎说有图形
	const blank = auditSvg('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"></svg>', { name: "blank" });
	assert.equal(blank.metrics.contentEmpty, true, "空画布应标 contentEmpty");
	const blankG0 = blank.findings.find((f) => f.rule === "G0-no-text");
	assert.match(blankG0.message, /画布完全空白/, "空画布应明说空白");
});

test("svg: 有文字时报两套边距（内容边距 + 文字边距），两者可区分", async () => {
	// 文字在中间，图形比文字外扩到四边 → 内容边距 < 文字边距
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
		<rect x="20" y="20" width="360" height="360" fill="#eee"/>
		<text x="150" y="200" font-size="20">居中文字</text></svg>`;
	const report = auditSvg(svg, { name: "mixed" });
	assert.equal(report.metrics.marginsPct.left, 5, "内容边距应按图形算（20/400 = 5%）");
	assert.ok(report.metrics.textMarginsPct !== undefined, "有文字时应额外报 textMarginsPct");
	assert.ok(report.metrics.textMarginsPct.left > report.metrics.marginsPct.left, "文字边距应大于内容边距（文字更靠里）");
});
