// test/render.test.mjs — design_render 的 render / composite 链路，**校验真实像素**。
//
// 为什么不用「字节数 > 500」这种断言：渲染器坏了也会吐字节。
// 这里解 PNG 看像素，才能证明「透明底真的透明」「说缩放到 600 就真的 600」「叠图没被拉伸」。
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { CAN_RENDER, call, inkBox, opaqueRatio, pngOf, px, rejects, saveArtifact, tempDir, writeTree } from "./helpers.mjs";
import { composite, pngSize, renderSvg, sizeOf } from "../lib/render.js";

const skip = !CAN_RENDER && "本平台无 resvg 原生绑定（CI ubuntu 作业只跑非渲染用例）";

const SVG = (inner, w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${inner}</svg>`;
const SOLID = (color, w, h) => SVG(`<rect width="${w}" height="${h}" fill="${color}"/>`, w, h);

/* ------------------------------- render ------------------------------- */

test("render: 透明底真透明 + 颜色正确", { skip }, async (t) => {
	const dir = tempDir(t, "render-alpha");
	const out = await renderSvg({ svg: SOLID("#E4002B", 40, 20), png: join(dir, "a.png") });
	assert.equal(out.width, 40);
	assert.equal(out.height, 20);
	assert.equal(out.bytes, readFileSync(out.path).length, "bytes 与实际文件长度一致");
	const img = pngOf(out.path);
	assert.equal(img.channels, 4, "必须是 RGBA（保留透明通道）");
	const inside = px(img, 20, 10);
	assert.deepEqual([inside.r, inside.g, inside.b, inside.a], [0xe4, 0x00, 0x2b, 255], "填充色不应被预乘/偏色");
	assert.ok(opaqueRatio(img) > 0.99, "矩形应铺满且不透明");
});

test("render: 空白区域 alpha=0（真透明底，不是白底）", { skip }, async (t) => {
	const dir = tempDir(t, "render-transparent");
	const out = await renderSvg({ svg: SVG('<rect x="10" y="5" width="20" height="10" fill="#000"/>', 40, 20), png: join(dir, "a.png") });
	const img = pngOf(out.path);
	assert.equal(px(img, 0, 0).a, 0, "左上角应在矩形外 → 全透明");
	assert.equal(px(img, 39, 19).a, 0, "右下角应在矩形外 → 全透明");
	assert.deepEqual(inkBox(img), { x: 10, y: 5, width: 20, height: 10 }, "墨迹包围盒应与矩形完全重合");
});

test("render: width 等比缩放（宽高比不变）", { skip }, async (t) => {
	const dir = tempDir(t, "render-scale");
	const out = await renderSvg({ svg: SOLID("#000", 300, 150), png: join(dir, "a.png"), width: 600 });
	assert.equal(out.width, 600);
	assert.equal(out.height, 300);
	assert.equal(pngSize(readFileSync(out.path)).height, 300);
	const small = await renderSvg({ svg: SOLID("#000", 300, 150), png: join(dir, "b.png"), width: 100 });
	assert.deepEqual([small.width, small.height], [100, 50]);
});

test("render: 中文/英文文字真的画出字（不是空白/tofu）", { skip }, async (t) => {
	const dir = tempDir(t, "render-cjk");
	const text = SVG(
		'<text x="8" y="40" font-family="Microsoft YaHei" font-size="32" fill="#000">中文标题 Aa</text>',
		260,
		60
	);
	const out = await renderSvg({ svg: text, png: join(dir, "cjk.png") });
	const img = pngOf(out.path);
	const box = inkBox(img);
	assert.ok(box !== null, "文字层应有墨迹（全透明说明字体没加载）");
	assert.ok(box.width > 120, `文字宽度应超过 120px（实测 ${box?.width}），tofu 方框会明显窄`);
	assert.ok(box.y >= 0 && box.y + box.height <= 60, "文字不应溢出画布");
	// 对比空白图：证明墨迹来自文字而不是背景
	const empty = await renderSvg({ svg: SVG("", 260, 60), png: join(dir, "empty.png") });
	assert.equal(inkBox(pngOf(empty.path)), null, "空 SVG 不应有墨迹");
	saveArtifact("render-cjk.png", readFileSync(out.path));
});

test("render: 内联 SVG 标记与 .svg 文件两条输入路径等价", { skip }, async (t) => {
	const dir = tempDir(t, "render-inputs");
	const svg = SOLID("#0A7", 24, 24);
	writeTree(dir, { "in.svg": svg });
	const fromMarkup = await renderSvg({ svg, png: join(dir, "markup.png") });
	const fromFile = await renderSvg({ svg: join(dir, "in.svg"), png: join(dir, "file.png") });
	assert.deepEqual([fromFile.width, fromFile.height], [fromMarkup.width, fromMarkup.height]);
	assert.deepEqual(inkBox(pngOf(fromMarkup.path)), inkBox(pngOf(fromFile.path)), "两条路径像素结果应一致");
	// 相对路径由工具层按会话目录解析（见 contract.test.mjs），这里只保证绝对路径可用
	assert.ok(existsSync(fromFile.path));
});

test("render: 错误输入必须报错，且错误信息可行动", { skip }, async (t) => {
	const dir = tempDir(t, "render-errors");
	await rejects(() => renderSvg({ svg: join(dir, "nope.svg"), png: join(dir, "o.png") }), /not found/, "缺文件");
	await rejects(() => renderSvg({ svg: "<svg", png: join(dir, "o.png") }), /parsing failed|root node/, "残缺标记");
	await rejects(() => renderSvg({ svg: "", png: join(dir, "o.png") }), /empty/, "空输入");
	await rejects(() => renderSvg({ svg: SOLID("#000", 4, 4), png: "" }), /required/, "缺输出路径");
	// 位图不是 render 的输入
	await renderSvg({ svg: SOLID("#000", 4, 4), png: join(dir, "base.png") });
	await rejects(() => renderSvg({ svg: join(dir, "base.png"), png: join(dir, "o2.png") }), /composite/, "位图输入应引导去 composite");
});

test("render: 输出路径后缀与 width 参数都要校验（防误写成 .jpg / 防超大图）", { skip }, async (t) => {
	const dir = tempDir(t, "render-args");
	await rejects(
		() => renderSvg({ svg: SOLID("#000", 4, 4), png: join(dir, "x.jpg") }),
		/\.png/i,
		"png 参数写 .jpg 应报错（否则 PNG 字节遁形为 jpg）"
	);
	await rejects(() => renderSvg({ svg: SOLID("#000", 4, 4), png: join(dir, "a.png"), width: 0 }), /width/, "width=0");
	await rejects(() => renderSvg({ svg: SOLID("#000", 4, 4), png: join(dir, "a.png"), width: -10 }), /width/, "width<0");
	await rejects(() => renderSvg({ svg: SOLID("#000", 4, 4), png: join(dir, "a.png"), width: 999999 }), /width/, "width 超上限");
});

/* ------------------------------ composite ----------------------------- */

test("composite: 不透明底 + 不透明层 → 层完全遮住底", { skip }, async (t) => {
	const dir = tempDir(t, "composite-solid");
	await renderSvg({ svg: SOLID("#000000", 20, 20), png: join(dir, "base.png") });
	await renderSvg({ svg: SOLID("#FF0000", 20, 20), png: join(dir, "over.png") });
	const merged = await composite({ under: join(dir, "base.png"), over: join(dir, "over.png"), out: join(dir, "out.png") });
	assert.deepEqual([merged.width, merged.height], [20, 20]);
	const img = pngOf(merged.path);
	const p = px(img, 10, 10);
	assert.deepEqual([p.r, p.g, p.b, p.a], [255, 0, 0, 255]);
});

test("composite: opacity 按 alpha 混合（0.5 白叠黑 = 128 灰）", { skip }, async (t) => {
	const dir = tempDir(t, "composite-opacity");
	await renderSvg({ svg: SOLID("#000000", 20, 20), png: join(dir, "base.png") });
	await renderSvg({ svg: SOLID("#FFFFFF", 20, 20), png: join(dir, "over.png") });
	const merged = await composite({ under: join(dir, "base.png"), over: join(dir, "over.png"), out: join(dir, "out.png"), opacity: 0.5 });
	const p = px(pngOf(merged.path), 10, 10);
	assert.ok(Math.abs(p.r - 128) <= 2, `期望 ~128 灰，实测 ${p.r}`);
	assert.equal(p.a, 255);
});

test("composite: 小图层不能被拉伸变形（保比例、居中）", { skip }, async (t) => {
	const dir = tempDir(t, "composite-aspect");
	// 透明底 40x40（底图不贡献墨迹，才能只看图层）
	await renderSvg({ svg: SVG("", 40, 40), png: join(dir, "base.png") });
	// 4x2 的红条：若被强行铺满 40x40，墨迹会是 40x40；正确行为是 4x2 居中
	await renderSvg({ svg: SOLID("#FF0000", 4, 2), png: join(dir, "over.png") });
	const merged = await composite({ under: join(dir, "base.png"), over: join(dir, "over.png"), out: join(dir, "out.png") });
	const img = pngOf(merged.path);
	const red = inkBox(img);
	assert.deepEqual(red, { x: 18, y: 19, width: 4, height: 2 }, `图层应保比例居中，实测 ${JSON.stringify(red)}`);
});

test("composite: SVG 图层按画布宽度渲染且不变形", { skip }, async (t) => {
	const dir = tempDir(t, "composite-svg-layer");
	await renderSvg({ svg: SVG("", 100, 50), png: join(dir, "base.png") });
	// 正方形图标叠到 100x50 的宽画布上：应保比例居中，而不是拉成 100x50
	const icon = SVG('<circle cx="12" cy="12" r="9" fill="#000"/>', 24, 24);
	const merged = await composite({ under: join(dir, "base.png"), over: icon, out: join(dir, "out.png") });
	const box = inkBox(pngOf(merged.path));
	assert.ok(box.width <= 100 && box.height <= 50, "墨迹不能超出画布");
	assert.ok(Math.abs(box.width - box.height) <= 2, `正方形应保持方形，实测 ${box.width}x${box.height}`);
});

test("composite: 透明底图保留；参数缺失/越界报错", { skip }, async (t) => {
	const dir = tempDir(t, "composite-misc");
	await renderSvg({ svg: SOLID("#FF0000", 20, 20), png: join(dir, "base.png") });
	await renderSvg({ svg: SVG('<rect width="6" height="6" fill="#000"/>', 20, 20), png: join(dir, "over.png") });
	const merged = await composite({ under: join(dir, "base.png"), over: join(dir, "over.png"), out: join(dir, "out.png") });
	const img = pngOf(merged.path);
	const seeThrough = px(img, 15, 15);
	assert.deepEqual([seeThrough.r, seeThrough.g, seeThrough.b, seeThrough.a], [255, 0, 0, 255], "图层透明处应透出底图颜色");
	await rejects(() => composite({ under: "", over: join(dir, "over.png"), out: join(dir, "o.png") }), /under/, "缺 under");
	await rejects(() => composite({ under: join(dir, "base.png"), over: join(dir, "over.png"), out: join(dir, "o.png"), opacity: 1.5 }), /opacity/, "opacity 越界");
});

test("pngSize / sizeOf: 从 IHDR 读尺寸，坏输入不谎报", { skip }, async (t) => {
	const dir = tempDir(t, "pngsize");
	await renderSvg({ svg: SOLID("#000", 7, 3), png: join(dir, "a.png") });
	assert.deepEqual(pngSize(readFileSync(join(dir, "a.png"))), { width: 7, height: 3 });
	assert.deepEqual(sizeOf(join(dir, "a.png")), { width: 7, height: 3 });
	assert.throws(() => pngSize(Buffer.from("not a png")), /PNG/);
	assert.equal(sizeOf(join(dir, "missing.png")), null, "量不到的尺寸返回 null，不抛");
});

/* --------------------------- design_render 工具层 --------------------------- */

test("composite: scale 把图层按画布比例放大（app 图标必需）", { skip }, async (t) => {
	const dir = tempDir(t, "composite-scale");
	// 400×400 透明画布 + 24×24 实心方块：scale=0.5 → 200×200 居中
	await renderSvg({ svg: SVG("", 400, 400), png: join(dir, "base.png") });
	await renderSvg({ svg: SOLID("#000000", 24, 24), png: join(dir, "icon.png") });
	const merged = await composite({ under: join(dir, "base.png"), over: join(dir, "icon.png"), out: join(dir, "out.png"), scale: 0.5 });
	const box = inkBox(pngOf(merged.path));
	assert.deepEqual(box, { x: 100, y: 100, width: 200, height: 200 }, `scale=0.5 应为 200×200 居中，实测 ${JSON.stringify(box)}`);
	// 默认（不给 scale）保持旧行为：不放大 → 24×24 居中
	const noScale = await composite({ under: join(dir, "base.png"), over: join(dir, "icon.png"), out: join(dir, "out2.png") });
	assert.deepEqual(inkBox(pngOf(noScale.path)), { x: 188, y: 188, width: 24, height: 24 }, "不给 scale 时不应放大");
	await rejects(() => composite({ under: join(dir, "base.png"), over: join(dir, "icon.png"), out: join(dir, "o.png"), scale: 0 }), /scale/, "scale=0 越界");
	await rejects(() => composite({ under: join(dir, "base.png"), over: join(dir, "icon.png"), out: join(dir, "o.png"), scale: 99 }), /scale/, "scale=99 越界");
});

test("render sizes：一次出多尺寸，文件名带档位，尺寸真实", { skip }, async (t) => {
	const dir = tempDir(t, "render-sizes");
	const out = await renderSvg({ svg: SOLID("#E4002B", 512, 512), png: join(dir, "app.png"), sizes: [512, 256, 128, 64, 32, 16] });
	assert.equal(out.variants.length, 6, "应写 6 个尺寸");
	assert.deepEqual(out.variants.map((v) => v.width), [512, 256, 128, 64, 32, 16]);
	for (const v of out.variants) {
		assert.equal(v.path, join(dir, `app-${v.width}.png`), `命名应是 app-${v.width}.png`);
		const img = pngOf(v.path);
		assert.deepEqual([img.width, img.height], [v.width, v.width], `文件实际尺寸应为 ${v.width}²`);
		assert.equal(v.bytes, statSync(v.path).size);
	}
	// 去重 + 边界值
	const dedupe = await renderSvg({ svg: SOLID("#000", 64, 64), png: join(dir, "d.png"), sizes: [32, 32, 16] });
	assert.deepEqual(dedupe.variants.map((v) => v.width), [32, 16], "重复尺寸应去重");
	await rejects(() => renderSvg({ svg: SOLID("#000", 64, 64), png: join(dir, "e.png"), sizes: [4] }), /sizes/, "8 以下应拒绝");
	await rejects(() => renderSvg({ svg: SOLID("#000", 64, 64), png: join(dir, "e.png"), sizes: "big" }), /sizes/, "非数组应拒绝");
});

test("render ico：容器结构合法，六帧内嵌 PNG 且逐帧尺寸正确", { skip }, async (t) => {
	const dir = tempDir(t, "render-ico");
	const out = await renderSvg({ svg: SOLID("#0F172A", 256, 256), png: join(dir, "favicon.png"), ico: true });
	assert.equal(out.ico, join(dir, "favicon.ico"));
	const buf = readFileSync(out.ico);
	assert.equal(buf.readUInt16LE(0), 0, "ICONDIR.reserved 应为 0");
	assert.equal(buf.readUInt16LE(2), 1, "ICONDIR.type 应为 1（icon）");
	assert.equal(buf.readUInt16LE(4), 6, "应内嵌 6 帧");
	const sizes = [];
	for (let i = 0; i < 6; i += 1) {
		const e = 6 + i * 16;
		const w = buf.readUInt8(e) || 256;
		const h = buf.readUInt8(e + 1) || 256;
		const len = buf.readUInt32LE(e + 8);
		const off = buf.readUInt32LE(e + 12);
		sizes.push(w);
		assert.equal(w, h, `第 ${i} 帧应正方形`);
		assert.equal(off + len <= buf.length, true, "帧数据不越界");
		const png = buf.subarray(off, off + 8);
		assert.deepEqual([...png], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `第 ${i} 帧应内嵌 PNG`);
		const frame = pngSize(buf.subarray(off));
		assert.equal(frame.width, w, `第 ${i} 帧 IHDR 宽度应与目录一致`);
	}
	assert.deepEqual(sizes, [16, 32, 48, 64, 128, 256], "帧档位应是 Windows 标准 6 档");
});

test("composite sizes/ico：app 图标一次出全套（含多尺寸重渲染）", { skip }, async (t) => {
	const dir = tempDir(t, "composite-batch");
	const merged = await composite({
		under: SVG('<rect width="256" height="256" rx="57" fill="#E4002B"/>', 256, 256),
		over: SVG('<circle cx="12" cy="12" r="8" fill="#fff"/>', 24, 24),
		out: join(dir, "app.png"),
		scale: 0.55,
		sizes: [256, 128, 64, 32],
		ico: true
	});
	assert.equal(merged.variants.length, 4);
	assert.deepEqual(merged.variants.map((v) => v.width), [256, 128, 64, 32]);
	assert.ok(existsSync(merged.ico), "应写出 .ico");
	// 不传 sizes/ico 时不应多写文件
	const plain = await composite({ under: SVG('<rect width="64" height="64" fill="#000"/>', 64, 64), over: SVG("", 64, 64), out: join(dir, "plain.png") });
	assert.equal(plain.variants, undefined, "未请求尺寸时不应返回 variants");
	assert.equal(plain.ico, undefined, "未请求 ico 时不应返回 ico");
});

test("design_render: 相对路径按会话目录解析（不是进程 cwd）", { skip }, async (t) => {
	const dir = tempDir(t, "tool-relative");
	writeTree(dir, { "art/logo.svg": SOLID("#123", 30, 10) });
	const { value, text } = await call("design_render", { action: "render", svg: "art/logo.svg", png: "out/logo.png" }, { cwd: dir });
	assert.equal(value.action, "render");
	assert.equal(value.width, 30);
	assert.ok(existsSync(join(dir, "out", "logo.png")), "输出应落在会话目录下");
	assert.ok(text.includes("render:"), "render 文本应汇报结果");
	// 内联标记不能被当成相对路径 join（历史 bug：resvg 报 unknown token at 1:1）
	const inline = await call("design_render", { action: "render", svg: SOLID("#333", 8, 8), png: "out/inline.png" }, { cwd: dir });
	assert.equal(inline.value.width, 8);
});
