/**
 * test/diff-profile.test.mjs — 两个“改完到底好了没有”的工具能力：
 *   design_render action=diff（两图差异）
 *   layout_check action=image 的 profile（从截图反推版式）
 *
 * 二者都源于同一个真实痛点：做 UI 参照改造时，每次都要手写 node 脚本量原图、算差异。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { CAN_RENDER, call, rejects, tempDir } from "./helpers.mjs";
import { imageDiff } from "../lib/diff.js";
import { auditImage } from "../lib/layouts/image.js";
import { renderSvg } from "../lib/render.js";

const skip = !CAN_RENDER && "本平台无 resvg 原生绑定";

/** 造一张可控的测试图：左半边 #F00、右半边 #00F。 */
const halfRedBlue = (size) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
	`<rect width="${size / 2}" height="${size}" fill="#FF0000"/><rect x="${size / 2}" width="${size / 2}" height="${size}" fill="#0000FF"/></svg>`;

/* ------------------------------ diff ------------------------------ */

test("diff：同图 → 均差 0；半幅改色 → 均差与非零区都能量出来", { skip }, async (t) => {
	const dir = tempDir(t, "diff-basic");
	const a = resolve(dir, "a.png");
	const b = resolve(dir, "b.png");
	const c = resolve(dir, "c.png");
	await renderSvg({ svg: halfRedBlue(200), png: a, width: 200 });
	await renderSvg({ svg: halfRedBlue(200), png: b, width: 200 });
	// c：右半边改成绿
	await renderSvg({
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100" height="200" fill="#FF0000"/><rect x="100" width="100" height="200" fill="#00FF00"/></svg>`,
		png: c,
		width: 200
	});

	const same = await imageDiff({ base: a, compare: b });
	assert.equal(same.meanDelta, 0, "完全相同的图均差应为 0");
	assert.equal(same.changedPct, 0);

	const diff = await imageDiff({ base: a, compare: c, cols: 2, rows: 1 });
	assert.ok(diff.meanDelta > 60, `半幅改色均差应明显大于 0，实际 ${diff.meanDelta}`);
	assert.ok(diff.changedPct > 35 && diff.changedPct < 65, `变化区应约一半，实际 ${diff.changedPct}%`);
	// 只有右半边在变，左半边应该几乎为 0
	assert.ok(diff.regions[0].meanDelta < 3, `左半区应几乎不变，实际 ${diff.regions[0].meanDelta}`);
	assert.ok(diff.regions[1].meanDelta > 60, `右半区应明显变化，实际 ${diff.regions[1].meanDelta}`);
});

test("diff：尺寸不同 → 人话报错，不说“比对失败”", { skip }, async (t) => {
	const dir = tempDir(t, "diff-size");
	const small = resolve(dir, "s.png");
	const big = resolve(dir, "b.png");
	await renderSvg({ svg: halfRedBlue(100), png: small, width: 100 });
	await renderSvg({ svg: halfRedBlue(160), png: big, width: 160 });
	await assert.rejects(
		() => imageDiff({ base: small, compare: big }),
		/尺寸不同[\s\S]*统一尺寸/,
		"应指出尺寸不同，并给出怎么统一"
	);
});

test("diff：给 out 时写热力图；不给时只返回数字（不多写文件）", { skip }, async (t) => {
	const dir = tempDir(t, "diff-heat");
	const a = resolve(dir, "a.png");
	const b = resolve(dir, "b.png");
	await renderSvg({ svg: halfRedBlue(200), png: a, width: 200 });
	await renderSvg({
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100" height="200" fill="#FF0000"/><rect x="100" width="100" height="200" fill="#FFFF00"/></svg>`,
		png: b,
		width: 200
	});
	const noOut = await imageDiff({ base: a, compare: b });
	assert.equal(noOut.heatmap, undefined, "不给 out 就不写热力图");
	const withOut = await imageDiff({ base: a, compare: b, out: resolve(dir, "heat.png") });
	assert.ok(typeof withOut.heatmap === "string" && withOut.heatmap.length > 0);
	assert.ok(withOut.heatmapBytes > 0);
});

test("diff：穿过 design_render 工具跑，输出无 undefined/NaN", { skip }, async (t) => {
	const dir = tempDir(t, "diff-tool");
	const a = resolve(dir, "a.png");
	const b = resolve(dir, "b.png");
	await renderSvg({ svg: halfRedBlue(200), png: a, width: 200 });
	await renderSvg({ svg: halfRedBlue(200), png: b, width: 200 });
	const { value } = await call("design_render", { action: "diff", base: a, compare: b, slices: 4 });
	assert.equal(value.action, "diff");
	assert.equal(value.width, 200);
	const text = JSON.stringify(value);
	assert.equal(/undefined|"NaN"|"Infinity"/.test(text), false, "输出不得带 undefined/NaN/Infinity");
	// 一位小数：不许漏浮点噪声
	assert.equal(/\d\.\d{6,}/.test(text), false, `不得出现浮点噪声：${text.slice(0, 200)}`);
});

test("diff align：整体下平移后，能搜出位移并显著降低均差", { skip }, async (t) => {
	// 动机：热力图满屏“重影”时，分不清是“排错了”还是“整块平移了几像素”。
	// 这个搜索把这个相位报出来，避免往错方向改。
	const dir = tempDir(t, "diff-align");
	const a = resolve(dir, "a.png");
	const b = resolve(dir, "b.png");
	// 基准：一排黑色条；对比：同样的条整体下移 12px
	const bars = (dy) =>
		// 条要**细**（4px）：16px 高的条在 8px/12px 平移下都有重叠，
		// 会把“最相似位移”扯到 8 而不是 12（实测踩过）。
		Array.from({ length: 6 }, (_, i) => `<rect x="20" y="${20 + i * 40 + dy}" width="160" height="4" fill="#000000"/>`).join("");
	const page = (dy) =>
		`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#FFFFFF"/>${bars(dy)}</svg>`;
	await renderSvg({ svg: page(0), png: a, width: 200 });
	await renderSvg({ svg: page(12), png: b, width: 200 });

	const plain = await imageDiff({ base: a, compare: b });
	const aligned = await imageDiff({ base: a, compare: b, align: true });
	assert.ok(aligned.align !== undefined, "align=true 应产出偏移报告");
	// 符号约定：cost 比的是 a(x,y) vs b(x+dx, y+dy)。b 的条比 a 低 12px，
	// 所以要把 b 采样点往**上**移才能对上 → dy = -12。
	assert.ok(Math.abs(aligned.align.bestDy + 12) <= 2, `应搜出 dy≈-12，实际 ${aligned.align.bestDy}`);
	assert.ok(aligned.align.deltaAtBest < plain.meanDelta, "对齐后均差应下降");
	assert.ok(aligned.align.gainPct > 60, `纯位移场景改善应非常显著，实际 ${aligned.align.gainPct}%`);
	assert.ok(aligned.align.deltaAtBest < 3, `纯位移对齐后应几乎无损，实际 ${aligned.align.deltaAtBest}`);

	// 不给 align 就不该多算（保持默认输出稳定）
	assert.equal(plain.align, undefined, "默认不带 align 报告");
});

/* --------------------------- 版式剖面 profile --------------------------- */

test("profile：从截图量出主色板与列结构", { skip }, async (t) => {
	const dir = tempDir(t, "profile");
	const png = resolve(dir, "layout.png");
	// 模拟“灰底 + 两块白卡片”：1200 宽，左右白卡片 300px，中间灰间隙
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600">` +
		`<rect width="1200" height="600" fill="#F6F7F9"/>` +
		`<rect x="100" y="40" width="300" height="520" fill="#FFFFFF"/>` +
		`<rect x="600" y="40" width="500" height="520" fill="#FFFFFF"/>` +
		`</svg>`;
	await renderSvg({ svg, png, width: 1200 });
	const { metrics } = auditImage(readFileSync(png), { name: "probe" });
	const profile = metrics.profile;
	assert.ok(profile !== undefined, "应产出 profile");

	// 主色板：白与 #F6F7F9 应在前两位
	const hexes = profile.palette.map((c) => c.hex.toLowerCase());
	assert.ok(hexes.includes("#ffffff"), `主色应含白，实际 ${hexes.join(",")}`);
	assert.ok(hexes.some((h) => h === "#f6f7f9"), `主色应含页面灰，实际 ${hexes.join(",")}`);

	// 列结构：应识别出两块卡片（左 100–399、右 600–1099），而不含中间灰间隙
	assert.ok(profile.columns.length >= 2, `应至少识别两列，实际 ${JSON.stringify(profile.columns)}`);
	const left = profile.columns.find((c) => Math.abs(c.left - 100) <= 6);
	assert.ok(left !== undefined, `应识别出 x=100 开始的那一列，实际 ${JSON.stringify(profile.columns)}`);
	assert.ok(Math.abs(left.width - 300) <= 8, `该列宽应约 300，实际 ${left.width}`);
	// 中间灰间隙不应被当成“内容列”
	assert.equal(
		profile.columns.some((c) => c.left < 500 && c.right > 500 && c.width > 300),
		false,
		"两侧卡片不应被合成为一整列"
	);
});

test("profile：行节奏能在列表列里识别出固定间距", { skip }, async (t) => {
	const dir = tempDir(t, "profile-rows");
	const png = resolve(dir, "rows.png");
	// 200 宽的一列卡片，每行 20px 高、间距 40px
	const rows = Array.from({ length: 8 }, (_, i) => `<rect x="20" y="${20 + i * 40}" width="160" height="20" fill="#CCCCCC"/>`).join("");
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">` +
		`<rect width="400" height="400" fill="#F6F7F9"/>` +
		`<rect x="10" y="10" width="380" height="380" fill="#FFFFFF"/>${rows}</svg>`;
	await renderSvg({ svg, png, width: 400 });
	const { metrics } = auditImage(readFileSync(png), { name: "rows" });
	assert.ok(metrics.profile.rowPitch !== null, "应识别出行节奏");
	assert.ok(Math.abs(metrics.profile.rowPitch - 40) <= 3, `行节奏应约 40，实际 ${metrics.profile.rowPitch}`);
	assert.ok(metrics.profile.list !== null, "应产出 list 统计");
	assert.ok(metrics.profile.list.count >= 4, `样本数应足够，实际 ${metrics.profile.list?.count}`);
	assert.equal(metrics.profile.list.uniformPct, 100, `等距列表的一致性应为 100%，实际 ${metrics.profile.list.uniformPct}`);
});

test("profile 行节奏：窄竖条采样能识别表格行距（宽列带会失效）", { skip }, async (t) => {
	// 动机：拿一张表格密集的办公软件参考图（在线文档）试，原来按“整条列带”采样时
	// 行节奏直接返回 null——侧栏与内容区连成一条宽列，整行处处有内容，行间隙看不出来。
	// 改成 40px 窄竖条后立刻量到 85px 行距。
	const dir = tempDir(t, "profile-list");
	const png = resolve(dir, "table.png");
	// 12 行等距文字（行距 40px）
	const rows = Array.from({ length: 12 }, (_, i) => `<text x="40" y="${60 + i * 40}" font-size="14" fill="#333333">第 ${i + 1} 行项目名称</text>`).join("");
	await renderSvg({ svg: `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="620"><rect width="600" height="620" fill="#FFFFFF"/>${rows}</svg>`, png, width: 600 });

	const p = auditImage(readFileSync(png), { name: "table" }).metrics.profile;
	assert.ok(p.list !== null && p.list !== undefined, "应产出 list 统计");
	assert.ok(Math.abs(p.list.pitch - 40) <= 3, `行距应≈ 40，实际 ${p.list.pitch}`);
	assert.ok(p.list.count >= 6, `样本数应足够，实际 ${p.list.count}`);
	assert.equal(p.list.uniformPct, 100, `等距表格一致性应为 100%，实际 ${p.list.uniformPct}`);
});

test("P9：表格里一行被撑高要报；等距表格与卡片栅格不报", { skip }, async (t) => {
	// 表格里“某一行比其它行高”是办公类界面最典型也最难靠眼睛发现的缺陷。
	// 阈值 <93% 实测校准：在线文档 100% 不报、视频站动态 94.1% 不报、
	// 故意做歪的合成表 90% 报，分得很干净。
	const dir = tempDir(t, "p9-list");
	const even = resolve(dir, "even.png");
	const uneven = resolve(dir, "uneven.png");
	const page = (ys) =>
		`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="700"><rect width="600" height="700" fill="#FFFFFF"/>` +
		ys.map((y, i) => `<text x="40" y="${y}" font-size="14" fill="#333333">第 ${i + 1} 行项目名称</text>`).join("") +
		`</svg>`;
	const evenYs = Array.from({ length: 12 }, (_, i) => 60 + i * 40);
	const unevenYs = evenYs.map((y, i) => y + (i >= 8 ? 40 : 0)); // 第 9 行起多空一格
	await renderSvg({ svg: page(evenYs), png: even, width: 600 });
	await renderSvg({ svg: page(unevenYs), png: uneven, width: 600 });

	assert.equal(
		auditImage(readFileSync(even), { name: "even" }).findings.filter((f) => f.rule === "P9").length,
		0,
		"等距表格不应报 P9"
	);
	const bad = auditImage(readFileSync(uneven), { name: "uneven" }).findings.filter((f) => f.rule === "P9");
	assert.equal(bad.length, 1, `一个双倍高行应触发 P9，实际 ${bad.length}`);
	assert.match(bad[0].message, /行高不一致/);
	assert.match(bad[0].message, /一致性 \d+/);
	assert.match(bad[0].fix, /换行|省略号/, "应提示用省略号而不是换行撑高");
});

test("profile 卡片检测：渐变背景上也能数出卡片与栅格间距", { skip }, async (t) => {
	// 动机：拿一张渐变背景 + 柔和阴影的仪表板参考试，纯色带法直接退回“整图一列”——
	// 渐变让“与页面底色不同”这个判据处处不成立。卡片矩形检测补上这一类布局。
	const dir = tempDir(t, "profile-cards");
	const png = resolve(dir, "cards.png");
	// 渐变底 + 3 列 x 2 行 白卡片，卡宽 200、水平间距 24、垂直间距 24
	const card = (x, y) => `<rect x="${x}" y="${y}" width="200" height="120" rx="12" fill="#FFFFFF"/>`;
	const cells = [];
	for (let r = 0; r < 2; r += 1) for (let c = 0; c < 3; c += 1) cells.push(card(40 + c * 224, 40 + r * 144));
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="760" height="360">` +
		`<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
		`<stop offset="0" stop-color="#DDE5F2"/><stop offset="1" stop-color="#F2F5FA"/>` +
		`</linearGradient></defs>` +
		`<rect width="760" height="360" fill="url(#g)"/>${cells.join("")}</svg>`;
	await renderSvg({ svg, png, width: 760 });

	const grid = auditImage(readFileSync(png), { name: "cards" }).metrics.profile.cardGrid;
	assert.equal(grid.count, 6, `应数出 6 张卡片，实际 ${grid.count}`);
	assert.deepEqual(grid.colStarts, [40, 264, 488], `列起点应为 40/264/488，实际 ${JSON.stringify(grid.colStarts)}`);
	assert.equal(grid.colGap, 24, `列间距应为 24，实际 ${grid.colGap}`);
	assert.equal(grid.rowGap, 24, `行间距应为 24，实际 ${grid.rowGap}`);
});

test("profile 卡片检测：近白页面底色不能被当成卡片（防“整页一块”）", { skip }, async (t) => {
	// 实测坑：视频站页面底色 #F6F7F9 三通道都 ≥246，用固定阈值 246 会把整页底当卡片面，
	// 连通成一张 2072×1414 的巨块。阈值必须相对页面底色算。
	const dir = tempDir(t, "profile-bgnotcard");
	const png = resolve(dir, "lightbg.png");
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300">` +
		`<rect width="600" height="300" fill="#F6F7F9"/>` +
		`<rect x="40" y="40" width="200" height="120" fill="#FFFFFF"/>` +
		`<rect x="300" y="40" width="200" height="120" fill="#FFFFFF"/>` +
		`</svg>`;
	await renderSvg({ svg, png, width: 600 });
	const grid = auditImage(readFileSync(png), { name: "lightbg" }).metrics.profile.cardGrid;
	assert.equal(grid.count, 2, `应只认出 2 张卡片（不是整页），实际 ${grid.count}`);
	assert.equal(
		grid.colStarts.some((x) => x === 0),
		false,
		`页面底色不应被当成从 x=0 开始的卡片，实际列起点 ${JSON.stringify(grid.colStarts)}`
	);
});

test("P8：卡片栅格不齐要报出具体数字，齐了就不报", { skip }, async (t) => {
	// 卡片型 UI 最经典的一类缺陷：同行卡宽差几像素、列间距一处 24 一处 32。
	// 肉眼说不出哪里不对，但整页就是“飘”。既然能量出卡片矩形，就该把它量出来。
	const dir = tempDir(t, "p8-grid");
	const bad = resolve(dir, "bad.png");
	const good = resolve(dir, "good.png");
	const page = (cells) =>
		`<svg xmlns="http://www.w3.org/2000/svg" width="760" height="260">` +
		`<rect width="760" height="260" fill="#F6F7F9"/>${cells}</svg>`;

	// 不齐：上排三张卡 200/208/200，间距 24/32
	await renderSvg({
		svg: page(
			`<rect x="20" y="30" width="200" height="90" fill="#FFFFFF"/>` +
				`<rect x="244" y="30" width="208" height="90" fill="#FFFFFF"/>` +
				`<rect x="484" y="30" width="200" height="90" fill="#FFFFFF"/>` +
				`<rect x="20" y="150" width="200" height="90" fill="#FFFFFF"/>` +
				`<rect x="244" y="150" width="200" height="90" fill="#FFFFFF"/>` +
				`<rect x="468" y="150" width="200" height="90" fill="#FFFFFF"/>`
		),
		png: bad,
		width: 760
	});
	const badResult = auditImage(readFileSync(bad), { name: "bad" });
	const p8 = badResult.findings.filter((f) => f.rule === "P8");
	assert.equal(p8.length, 1, `不齐的栅格应命中 P8，实际 ${p8.length} 条`);
	assert.match(p8[0].message, /200\/208\/200/, "应报出具体卡宽");
	assert.match(p8[0].message, /24\/32/, "应报出具体列间距");

	// 齐：两行三列，卡宽 200、间距 24
	await renderSvg({
		svg: page(
			[0, 1, 2].flatMap((r) =>
				[0, 1, 2].map((c) => `<rect x="${20 + c * 224}" y="${30 + r * 120}" width="200" height="90" fill="#FFFFFF"/>`)
			).join("")
		),
		png: good,
		width: 760
	});
	assert.equal(
		auditImage(readFileSync(good), { name: "good" }).findings.filter((f) => f.rule === "P8").length,
		0,
		"对齐的栅格不应命中 P8"
	);
});

test("profile：纯透明底图不产出 profile（没有底色就没有版式可量）", { skip }, async (t) => {
	const dir = tempDir(t, "profile-alpha");
	const png = resolve(dir, "alpha.png");
	await renderSvg({
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="20" fill="#123456"/></svg>`,
		png,
		width: 64
	});
	const { metrics } = auditImage(readFileSync(png), { name: "alpha" });
	assert.equal(metrics.profile, undefined, "透明底不应产出 profile");
});

void writeFileSync;
void join;

/* ---------------------------- diff 批量 ----------------------------
 * 视觉迭代的真实形态是「改前拍一组、改后拍一组」，按文件名配对。
 * 逐对手跑会逼调用方先自己写配对脚本——那是已经重复过很多次的机械活。
 */

test("diff 批量：两组同名图按文件名配对，逐对均差 + 汇总", { skip }, async (t) => {
	const dir = tempDir(t, "diff-batch");
	const before = join(dir, "before");
	const after = join(dir, "after");
	mkdirSync(before);
	mkdirSync(after);

	const plain = halfRedBlue(200);
	const allRed = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#FF0000"/></svg>`;
	for (const name of ["same.png", "changed.png"]) {
		await renderSvg({ svg: plain, png: join(before, name), width: 200 });
	}
	await renderSvg({ svg: plain, png: join(after, "same.png"), width: 200 });
	await renderSvg({ svg: allRed, png: join(after, "changed.png"), width: 200 });

	const { value, text } = await call("design_render", { action: "diff", base: before, compare: after });
	assert.equal(value.action, "diff-batch");
	assert.equal(value.count, 2);
	const same = value.pairs.find((p) => p.name === "same.png");
	const changed = value.pairs.find((p) => p.name === "changed.png");
	assert.equal(same.meanDelta, 0, "没改的图均差应为 0");
	assert.ok(changed.meanDelta > 20, `改了半幅的图均差应明显大于 0，实际 ${changed.meanDelta}`);
	assert.match(text, /^diff: 2 对（按文件名配对）/);
	assert.match(text, /changed\.png 均差/);
});

test("diff 批量：尺寸不同的那一对只报原因，不拖垮整批；没有同名图时报错清晰", { skip }, async (t) => {
	const dir = tempDir(t, "diff-batch-mixed");
	const before = join(dir, "before");
	const after = join(dir, "after");
	mkdirSync(before);
	mkdirSync(after);
	await renderSvg({ svg: halfRedBlue(200), png: join(before, "ok.png"), width: 200 });
	await renderSvg({ svg: halfRedBlue(200), png: join(after, "ok.png"), width: 200 });
	await renderSvg({ svg: halfRedBlue(200), png: join(before, "size.png"), width: 200 });
	await renderSvg({ svg: halfRedBlue(100), png: join(after, "size.png"), width: 100 });

	const { value, text } = await call("design_render", { action: "diff", base: before, compare: after });
	assert.equal(value.count, 2);
	const size = value.pairs.find((p) => p.name === "size.png");
	assert.match(String(size.error), /尺寸不同/, "尺寸不同应记为这一对的错误");
	assert.match(text, /比不了（尺寸不同等）：size\.png/);

	const other = tempDir(t, "diff-batch-nopair");
	mkdirSync(join(other, "a"));
	mkdirSync(join(other, "b"));
	await renderSvg({ svg: halfRedBlue(100), png: join(other, "a", "x.png"), width: 100 });
	await renderSvg({ svg: halfRedBlue(100), png: join(other, "b", "y.png"), width: 100 });
	await rejects(
		() => call("design_render", { action: "diff", base: join(other, "a"), compare: join(other, "b") }),
		/两侧目录没有同名图片/,
		"无同名图"
	);
});
