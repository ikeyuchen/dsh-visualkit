// test/layout-image.test.mjs — layout_check action=image（渲染后 PNG 的构图几何体检）。
//
// 为什么用 renderSvg 现造图：image 模式的输入就是「真渲染出来的 PNG」，手搓 PNG 会绕过 resvg 的
// 真实透明通道/暗边行为，测不出检测器真实表现。每个用例都带 { skip: !CAN_RENDER }：
// resvg 原生绑定只有 win32-x64，CI 的 ubuntu 作业只跑非渲染用例。
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CAN_RENDER, assertLossless, call, pngOf, px, rejects, tempDir, writeTree } from "./helpers.mjs";
import { renderSvg } from "../lib/render.js";
import { auditImage } from "../lib/layouts/image.js";

const skip = !CAN_RENDER && "本平台无 resvg 原生绑定（CI ubuntu 作业只跑非渲染用例）";

const SVG = (inner, w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${inner}</svg>`;
const RECT = (x, y, w, h, fill = "#111111") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
const WHITE = (w, h) => RECT(0, 0, w, h, "#FFFFFF");

/* --------------------------- fixture 图谱 ---------------------------
 * 每个样本对应一条（或几条）规则的「命中/反例」，注释写明意图，改样本前先改注释。
 *   good        8% 边距 / 左右对称 / 覆盖率 ~39%：干净基线，只应有 P7
 *   bad         贴边 1px（P1 error×3）+ 覆盖率 86.8%（P3）+ 左半实心/右半收窄（P4 视觉重量左重 29%）
 *   stair       5 条错位横条：块起点 5 个互不相同 → P5 info「没有对齐关系」
 *   alignWarn   左上 3 条左对齐 + 右下 3 条右对齐 → P5 warn「对齐方式混乱」
 *   asym        上 5% / 下 45%：边距比 9x → P2
 *   p1warn      左/上 3%（其余 5%）：P1 warn（不是 error），覆盖率 84.6% 刚好不触发 P3
 *   transparent 透明底 + 细线 I 形：验证 alpha mask 分支；覆盖率 3.6%（稀疏文字/线稿类：
 *               不报 P3 过空，也不做 P2/P4/P5 构图判定，避免把正常文字排版当失衡）
 *   blank       纯白空白图：覆盖率 0 → P3 且 message 提示纯白/纯透明底
 *   small       240×240：P6 warn
 */
const FS = {
	good: SVG(
		WHITE(1000, 1000) + RECT(80, 80, 840, 140) + RECT(80, 340, 240, 220) + RECT(380, 340, 240, 220) + RECT(680, 340, 240, 220) + RECT(80, 780, 840, 140),
		1000,
		1000
	),
	bad: SVG(WHITE(1000, 1000) + RECT(1, 1, 499, 999) + RECT(500, 1, 370, 999), 1000, 1000),
	stair: SVG(
		WHITE(600, 600) + RECT(40, 50, 200, 60) + RECT(120, 150, 200, 60) + RECT(200, 250, 200, 60) + RECT(280, 350, 200, 60) + RECT(360, 450, 200, 60),
		600,
		600
	),
	alignWarn: SVG(
		WHITE(800, 800) + RECT(60, 60, 200, 60) + RECT(60, 160, 200, 60) + RECT(60, 260, 200, 60) + RECT(540, 400, 200, 60) + RECT(540, 500, 200, 60) + RECT(540, 600, 200, 60),
		800,
		800
	),
	asym: SVG(WHITE(900, 900) + RECT(45, 45, 810, 450), 900, 900),
	p1warn: SVG(WHITE(1000, 1000) + RECT(30, 30, 920, 920), 1000, 1000),
	transparent: SVG(RECT(30, 30, 540, 5) + RECT(30, 265, 540, 5) + RECT(298, 30, 5, 240), 600, 300),
	blank: SVG(WHITE(500, 500), 500, 500),
	small: SVG(WHITE(240, 240) + RECT(20, 20, 200, 200), 240, 240)
};

/** 渲染到用例专属临时目录（工具层用例需要真实文件路径）。 */
async function renderCase(t, name) {
	const dir = tempDir(t, `layout-image-${name}`);
	const file = join(dir, `${name}.png`);
	await renderSvg({ svg: FS[name], png: file });
	return { dir, file, buffer: readFileSync(file) };
}

/** 直调用例：同一 fixture 只渲染一次，缓存 buffer（纯函数检测器不需要文件）。 */
const bufferCache = new Map();
async function pngBuffer(name) {
	if (!bufferCache.has(name)) {
		const dir = mkdtempSync(join(tmpdir(), "dsh-visualkit-layout-image-"));
		try {
			const file = join(dir, `${name}.png`);
			await renderSvg({ svg: FS[name], png: file });
			bufferCache.set(name, readFileSync(file));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
	return bufferCache.get(name);
}

const audit = async (name) => auditImage(await pngBuffer(name), { name: `${name}.png` });
const rulesOf = (report) => report.findings.map((f) => f.rule);
const byRule = (report, rule) => report.findings.filter((f) => f.rule === rule);

/* ------------------------------- 基线 ------------------------------- */

test("image: 好布局（8% 边距/左右平衡/40% 覆盖）→ 无 error、score ≤20、指标正确", { skip }, async () => {
	const report = await audit("good");
	assert.equal(report.mode, "image", "mode 必须是 image");
	assert.equal(report.target, "good.png", "target 应是文件名");
	assert.equal(report.counts.error, 0, "好布局不应有 error");
	assert.equal(report.counts.warn, 0, "好布局不应有 warn");
	assert.deepEqual([...new Set(report.findings.map((f) => f.severity))], ["info"], "好布局只应剩 info（P7 能力边界）");
	assert.ok(report.score <= 20, `好布局分数应 ≤20，实测 ${report.score}`);
	assert.deepEqual(report.metrics.canvas, [1000, 1000], "画布尺寸应从 PNG 读出");
	assert.deepEqual(report.metrics.contentBox, { x: 80, y: 80, w: 840, h: 840 }, "内容包围盒应贴住设计坐标");
	for (const side of ["left", "top", "right", "bottom"]) {
		assert.ok(Math.abs(report.metrics.marginsPct[side] - 8) <= 0.5, `${side} 边距应 ≈8%，实测 ${report.metrics.marginsPct[side]}`);
	}
	assert.ok(Math.abs(report.metrics.coveragePct - 39.4) <= 2, `覆盖率应 ≈39%，实测 ${report.metrics.coveragePct}`);
	assert.ok(Math.abs(report.metrics.balance.lr) < 0.05, `左右应大致平衡，实测 ${report.metrics.balance.lr}`);
});

/* ------------------------------- P1 ------------------------------- */

test("image: P1 贴边分级 —— 1px 报 error，3% 报 warn，8% 是反例", { skip }, async () => {
	const bad = await audit("bad");
	const badP1 = byRule(bad, "P1");
	assert.ok(badP1.length >= 2, "贴边 1px 应逐边报 P1（每条边修法不同）");
	assert.ok(badP1.every((f) => f.severity === "error"), "1px 贴边必须是 error");
	assert.deepEqual(badP1.map((f) => f.where).sort(), ["margin:bottom", "margin:left", "margin:top"], "左/上/下三条边都要点到");
	assert.match(badP1[0].message, /贴边|出血/, "error 文案要说明贴边/出血风险");
	assert.ok(badP1.every((f) => f.fix.length > 0), "每条 P1 都要给可行动修法");

	const warn = await audit("p1warn");
	const warnP1 = byRule(warn, "P1");
	assert.equal(warnP1.length, 2, "3% 的左边与上边应各报一条");
	assert.ok(warnP1.every((f) => f.severity === "warn"), "2–4% 之间应是 warn 而不是 error");
	assert.equal(warn.counts.error, 0, "3% 不该升级成 error");
	assert.match(warnP1[0].message, /留白不足/, "warn 文案要说明留白不足");

	const good = await audit("good");
	assert.equal(byRule(good, "P1").length, 0, "8% 边距是反例，不许报 P1");
});

/* --------------------------- 坏布局总分 --------------------------- */

test("image: 坏布局（贴边+拥挤+左重）→ score ≥50 且同时命中 P1/P3/P4", { skip }, async () => {
	const report = await audit("bad");
	assert.ok(report.score >= 50, `坏布局分数应 ≥50，实测 ${report.score}`);
	assert.equal(report.counts.error, 3, "三个贴边边距应是 3 条 error");
	const rules = new Set(rulesOf(report));
	for (const rule of ["P1", "P3", "P4"]) assert.ok(rules.has(rule), `坏布局必须命中 ${rule}`);
	const p3 = byRule(report, "P3")[0];
	assert.equal(p3.severity, "warn");
	assert.match(p3.message, /覆盖率|过满/, "拥挤要说明覆盖率过高");
	assert.ok(report.metrics.coveragePct > 85, `拥挤样本覆盖率应 >85%，实测 ${report.metrics.coveragePct}`);
	const p4 = byRule(report, "P4")[0];
	assert.equal(p4.severity, "warn");
	assert.match(p4.where, /side:左/, "左重应指出偏左");
	assert.match(p4.message, /视觉失衡/, "P4 文案要说清是哪边重");
	assert.match(p4.message, /左/);
});

test("image: 好/坏样本分差明显（健康样本与事故样本不能同分）", { skip }, async () => {
	const [good, bad] = await Promise.all([audit("good"), audit("bad")]);
	assert.ok(bad.score - good.score >= 40, `分差应 ≥40，实测 ${good.score} → ${bad.score}`);
	assert.notEqual(good.grade, bad.grade, `分级应不同，实测 ${good.grade} vs ${bad.grade}`);
});

/* ------------------------------- P2 ------------------------------- */

test("image: P2 边距严重不对称（上下 9 倍）命中，四边同档是反例", { skip }, async () => {
	const report = await audit("asym");
	const p2 = byRule(report, "P2");
	assert.equal(p2.length, 1, "P2 只报一次");
	assert.equal(p2[0].severity, "warn");
	assert.match(p2[0].message, /不对称/);
	assert.ok(report.metrics.marginsPct.bottom >= 40, `下边距 45% 应被量到，实测 ${report.metrics.marginsPct.bottom}`);
	assert.ok(report.metrics.marginsPct.top <= 6, `上边距 5% 应被量到，实测 ${report.metrics.marginsPct.top}`);
	const good = await audit("good");
	assert.equal(byRule(good, "P2").length, 0, "8% 四边是反例");
});

/* ------------------------------- P3 ------------------------------- */

test("image: P3 密度异常 —— 拥挤与过空都报，过空文案提示纯白/纯透明底误判", { skip }, async () => {
	const bad = await audit("bad");
	const crowded = byRule(bad, "P3")[0];
	assert.equal(crowded.severity, "warn");
	assert.match(crowded.message, /过满/, ">85% 覆盖率应说「过满」");

	// 稀疏版面（3.6% 的细线文字类）不再报「过空」：文字型海报天然只有 2–5% 墨迹覆盖率，
	// 该报的是接近空白（<1.5%）。用 blank（0%）验证过空文案，用 transparent 验证反例。
	const blank = await audit("blank");
	const empty = byRule(blank, "P3")[0];
	assert.ok(empty !== undefined, "0% 覆盖率应报 P3（接近空白）");
	assert.match(empty.message, /过空/);
	assert.match(empty.message, /纯白/, "过空文案必须提示纯白底的可能");
	assert.match(empty.message, /纯透明底/, "过空文案必须提示纯透明底的可能");
	const transparent = await audit("transparent");
	assert.equal(byRule(transparent, "P3").length, 0, "3.6% 的稀疏文字/线稿类版面不应报过空");
	assert.equal(transparent.metrics.coveragePct >= 3, true, "覆盖率指标仍应如实报");

	const good = await audit("good");
	assert.equal(byRule(good, "P3").length, 0, "39% 覆盖率是反例");
});

/* --------------------------- 满血版面 --------------------------- */

test("image: 满血版面（应用窗口截图）不报贴边，并标 fullBleed", { skip }, async (t) => {
	// 实测教训（Flow-Pilot）：7 张真实应用截图全部被判 62/100 bad，唯一原因就是 P1 贴边。
	// 应用窗口铺满窗口是设计本身，不是缺陷。
	const dir = tempDir(t, "fullbleed");
	// 注意：颜色对比度必须够（背景 #FFFFFF / 顶栏近黑 / 卡片阴影灰）。
	// 若卡片与底只差 ~20 个单位，会被当成“背景”，反而测不到满血——那是 fixture 的问题。
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500">
		<rect width="800" height="500" fill="#FFFFFF"/>
		<rect x="0" y="0" width="800" height="48" fill="#0F172A"/>
		<rect x="0" y="48" width="180" height="452" fill="#D8D8D8"/>
		<rect x="200" y="80" width="560" height="120" fill="#C9C9C9"/>
		<rect x="200" y="220" width="560" height="240" fill="#C9C9C9"/>
	</svg>`;
	const file = join(dir, "window.png");
	await renderSvg({ svg, png: file });
	const report = auditImage(readFileSync(file), { name: "window.png" });
	assert.equal(report.metrics.fullBleed, true, "四边都贴边应识别为满血版面");
	assert.deepEqual(report.metrics.skippedRules, ["P1", "P2"], "应声明跳过了 P1/P2");
	assert.deepEqual(byRule(report, "P1"), [], "满血版面不应报贴边");
	assert.deepEqual(byRule(report, "P2"), [], "满血版面不应报边距不对称");
});

test("image: 有真实留白的作品仍正常报贴边（满血判定的反例）", { skip }, async (t) => {
	const dir = tempDir(t, "not-fullbleed");
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500">
		<rect width="800" height="500" fill="#FFFFFF"/>
		<rect x="4" y="40" width="300" height="200" fill="#0F172A"/>
	</svg>`;
	const file = join(dir, "poster.png");
	await renderSvg({ svg, png: file });
	const report = auditImage(readFileSync(file), { name: "poster.png" });
	assert.equal(report.metrics.fullBleed, undefined, "只有一边贴边不算满血版面");
	assert.ok(byRule(report, "P1").some((f) => f.severity === "error"), "左边 0.5% 仍应报 P1 error");
});

/* ------------------------------- P5 ------------------------------- */

test("image: P5 对齐 —— 5 条错位横条报 info「没有对齐关系」", { skip }, async () => {
	const report = await audit("stair");
	const p5 = byRule(report, "P5");
	assert.equal(p5.length, 1, "P5 只报一次");
	assert.equal(p5[0].severity, "info");
	assert.match(p5[0].message, /对齐/);
	assert.match(p5[0].where, /blocks:5/, "5 个互不相同的块起点");
	assert.equal(report.metrics.segments.rows, 5, "5 条横带应被行投影数出来");
	const good = await audit("good");
	assert.equal(byRule(good, "P5").length, 0, "满宽行命中 left/right/center 多种对齐，不算对齐证据（反例）");
});

test("image: P5 对齐 —— 左对齐+右对齐同时大量存在报 warn（各只有 1 条不算）", { skip }, async () => {
	const report = await audit("alignWarn");
	const p5 = byRule(report, "P5");
	assert.equal(p5.length, 1, "P5 warn 只报一次");
	assert.equal(p5[0].severity, "warn");
	assert.match(p5[0].where, /align:left\+right/);
	assert.match(p5[0].message, /左对齐/);
	assert.match(p5[0].message, /右对齐/);
	const stair = await audit("stair");
	assert.ok(
		byRule(stair, "P5").every((f) => f.severity === "info"),
		"每种对齐方式只有 1 条时不算「大量存在」，不许升级成 warn"
	);
});

/* ------------------------------- P6 ------------------------------- */

test("image: P6 分辨率分级 —— 短边 <300 warn、300–800 info、≥800 不报", { skip }, async () => {
	const small = await audit("small");
	const p6 = byRule(small, "P6");
	assert.equal(p6.length, 1, "P6 只报一次");
	assert.equal(p6[0].severity, "warn");
	assert.match(p6[0].message, /偏小/);
	assert.match(p6[0].where, /240x240/);
	const mid = await audit("stair");
	const info = byRule(mid, "P6")[0];
	assert.equal(info.severity, "info", "600px 短边应是 info");
	assert.match(info.message, /一般/);
	const good = await audit("good");
	assert.equal(byRule(good, "P6").length, 0, "1000px 是反例");
});

/* ------------------------------- P7 ------------------------------- */

test("image: P7 固定 info，文案声明无 OCR 的能力边界", { skip }, async () => {
	for (const name of ["good", "bad", "blank"]) {
		const report = await audit(name);
		const p7 = byRule(report, "P7");
		assert.equal(p7.length, 1, `${name}: P7 必须固定出现一次`);
		assert.equal(p7[0].severity, "info", `${name}: P7 只能是 info`);
		assert.equal(
			p7[0].message,
			"本模式不做文字/对比度检测（无 OCR），排版文字问题请用 action=ui / action=svg",
			`${name}: P7 文案要保持约定`
		);
		assert.ok(p7[0].fix.length > 0, `${name}: P7 必须给可行动修法`);
	}
});

/* --------------------------- 透明底 / 空白 --------------------------- */

test("image: 透明底用 alpha mask（细线也能量到，而不是被当空白）", { skip }, async (t) => {
	const { file, buffer } = await renderCase(t, "transparent");
	const img = pngOf(file);
	assert.equal(img.channels, 4, "透明底应保留 alpha 通道");
	assert.equal(px(img, 0, 0).a, 0, "角落应是全透明（纯 RGB 背景差法在这里会得到空 mask）");
	const report = auditImage(buffer, { name: "transparent.png" });
	assert.equal(report.metrics.background, "transparent", "应走 alpha mask 分支");
	assert.deepEqual(report.metrics.contentBox, { x: 30, y: 30, w: 540, h: 240 }, "alpha mask 包围盒应贴住细线");
	assert.ok(report.metrics.contentPixels > 6000, `细线内容像素应被数到，实测 ${report.metrics.contentPixels}`);
	assert.ok(Math.abs(report.metrics.marginsPct.left - 5) < 0.5, `左边距应 ≈5%，实测 ${report.metrics.marginsPct.left}`);
	assert.ok(Math.abs(report.metrics.marginsPct.top - 10) < 0.5, `上边距应 ≈10%，实测 ${report.metrics.marginsPct.top}`);
});

test("image: 纯白空白图 → 覆盖率 0、P3 提示纯白/纯透明底，且不误报贴边", { skip }, async () => {
	const report = await audit("blank");
	assert.equal(report.metrics.contentPixels, 0, "纯白图应完全没有内容像素");
	assert.equal(report.metrics.coveragePct, 0);
	assert.deepEqual(report.metrics.contentBox, { x: 0, y: 0, w: 0, h: 0 }, "无内容时包围盒归零");
	assert.deepEqual(report.metrics.segments, { cols: 0, rows: 0 });
	assert.equal(report.metrics.background, "#ffffff", "不透明纯白底应估出背景色");
	const p3 = byRule(report, "P3")[0];
	assert.match(p3.message, /纯白/, "过空文案必须提示纯白底的可能");
	assert.match(p3.message, /纯透明底/, "过空文案必须提示纯透明底的可能");
	assert.equal(byRule(report, "P1").length, 0, "没有内容时不许拿 margin=0 报贴边（假阳性）");
	assert.equal(byRule(report, "P2").length, 0, "无内容时不许报边距不对称");
	assert.equal(byRule(report, "P4").length, 0, "无内容时不许报视觉失衡");
	assert.equal(report.counts.error, 0);
});

/* ------------------------------ 错误路径 ------------------------------ */

test("image: 错误路径 —— 非图片字节/缺文件/坏文件都被拒且错误可行动", { skip }, async (t) => {
	// 底层解码器仍然只认 PNG（JPEG/WebP 在工具层转码后才会进来）
	assert.throws(() => auditImage(Buffer.from("not a png at all")), /PNG/, "非 PNG buffer 必须在解码处抛错");
	assert.throws(() => auditImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])), /PNG/, "JPEG 字节到解码层仍不是 PNG");
	const dir = tempDir(t, "layout-image-errors");
	writeTree(dir, { "broken.png": "definitely not a png", "notes.txt": "hello" });
	// JPEG/WebP 现在能直接收（转码能力与 taste_check 共用），所以不再报“只支持 PNG”
	await rejects(() => call("layout_check", { action: "image", input: "notes.txt" }, { cwd: dir }), /PNG\/JPEG\/WebP/, "非图片扩展名要引导到支持的格式");
	await rejects(() => call("layout_check", { action: "image", input: "missing.png" }, { cwd: dir }), /读不到/, "缺文件要报可行动错误");
	await rejects(() => call("layout_check", { action: "image", input: "broken.png" }, { cwd: dir }), /PNG/, "坏 PNG 不应静默通过");
});

/* ------------------------------ 工具层 ------------------------------ */

test("image: 工具层 —— 字段齐全、render 文本带 layout_check [image]、与直调一致", { skip }, async (t) => {
	const { dir, file } = await renderCase(t, "good");
	const res = await call("layout_check", { action: "image", input: "good.png" }, { cwd: dir });
	const value = res.value;
	assert.equal(value.mode, "image");
	assert.equal(value.target, "good.png", "target 应是 basename（相对路径按会话目录解析）");
	assert.equal(typeof value.score, "number", "score 应是 number");
	assert.ok(["clean", "good", "messy", "bad"].includes(value.grade), `grade 不合法：${value.grade}`);
	assert.deepEqual(Object.keys(value.counts).sort(), ["error", "info", "warn"], "counts 三项齐全");
	assert.equal(typeof value.counts.warn, "number");
	assert.ok(Array.isArray(value.findings) && value.findings.length >= 1, "至少要有 P7 一条");
	for (const f of value.findings) {
		assert.ok(["error", "warn", "info"].includes(f.severity), `severity 不合法：${f.severity}`);
		assert.equal(typeof f.rule, "string");
		assert.equal(typeof f.message, "string");
		assert.equal(typeof f.fix, "string");
	}
	assert.ok(res.text.includes("layout_check [image]"), `render 文本应带 mode 前缀：${res.text}`);
	assert.ok(res.text.includes(`${value.score}/100`), "render 文本应含分数");
	assert.ok(res.text.includes("good.png"), "render 文本应含目标名");
	assert.deepEqual(value, auditImage(readFileSync(file), { name: "good.png" }), "工具层结果必须与直调完全一致");
	assertLossless(value, "layout_check image 输出");
});

test("image: 工具层 —— 坏/透明/空白样本走通，且结论与直调一致", { skip }, async (t) => {
	const dir = tempDir(t, "layout-image-toolset");
	const expectations = {
		bad: (v) => ["P1", "P3", "P4"].every((rule) => v.findings.some((f) => f.rule === rule)),
		transparent: (v) => v.metrics.background === "transparent" && !v.findings.some((f) => f.rule === "P3"),
		blank: (v) => v.metrics.contentPixels === 0 && v.findings.some((f) => f.rule === "P3")
	};
	for (const [name, check] of Object.entries(expectations)) {
		const file = join(dir, `${name}.png`);
		await renderSvg({ svg: FS[name], png: file });
		const res = await call("layout_check", { action: "image", input: `${name}.png` }, { cwd: dir });
		assert.equal(res.value.mode, "image", `${name}: mode`);
		assert.equal(res.value.target, `${name}.png`, `${name}: target`);
		assert.ok(res.text.startsWith("layout_check [image]"), `${name}: render 文本前缀`);
		assert.ok(check(res.value), `${name}: 结论不符合预期`);
		assert.deepEqual(res.value, auditImage(readFileSync(file), { name: `${name}.png` }), `${name}: 工具层与直调应一致`);
	}
});

/* --------------------------- 确定性 / metrics --------------------------- */

test("image: 确定性 —— 同 buffer 连跑结果完全一致；metrics 完整且 JSON 无损", { skip }, async () => {
	const buffer = await pngBuffer("good");
	const a = auditImage(buffer, { name: "good.png" });
	const b = auditImage(Buffer.from(buffer), { name: "good.png" });
	assert.deepEqual(a, b, "同输入必须同输出（检测器无随机/无时间依赖）");
	assert.deepEqual(await audit("bad"), await audit("bad"), "坏样本也要确定");
	assertLossless(a, "image 报告");

	const m = a.metrics;
	assert.deepEqual(m.canvas, [1000, 1000]);
	assert.deepEqual(Object.keys(m.contentBox).sort(), ["h", "w", "x", "y"]);
	assert.deepEqual(Object.keys(m.marginsPct).sort(), ["bottom", "left", "right", "top"]);
	assert.equal(typeof m.coveragePct, "number");
	assert.ok(Number.isInteger(m.contentPixels), "contentPixels 应是整数");
	assert.equal(m.contentPixels, 393600, "好样本内容像素应可复现");
	assert.deepEqual(Object.keys(m.balance).sort(), ["lr", "tb"]);
	assert.deepEqual(Object.keys(m.segments).sort(), ["cols", "rows"]);
	assert.ok(Number.isInteger(m.segments.cols) && Number.isInteger(m.segments.rows), "segments 计数应是整数");
	assert.ok(m.segments.cols >= 1 && m.segments.rows >= 1, "好样本至少 1 列带 / 1 行带");
	assert.equal(m.background, "#ffffff");
	assert.equal(typeof m.weightBalance.lr, "number");
	const twoDecimals = (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-9;
	assert.ok(twoDecimals(m.coveragePct), "coveragePct 应 ≤2 位小数");
	for (const v of [...Object.values(m.marginsPct), m.balance.lr, m.balance.tb, m.weightBalance.lr, m.weightBalance.tb]) {
		assert.ok(twoDecimals(v), `数值 ${v} 应 ≤2 位小数`);
	}
});
