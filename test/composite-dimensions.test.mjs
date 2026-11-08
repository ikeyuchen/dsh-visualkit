/**
 * test/composite-dimensions.test.mjs — design_render composite 的正交维度。
 *
 * 为什么单独开：composite 从「只有 opacity/scale」改成了位置/尺寸/外观/变换/画布
 * 五个维度的组合。这里全部用**真实像素**验证——上一轮 strokeWidth 就是「不报错但无效」。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";

import { CAN_RENDER, call, pngOf, tempDir } from "./helpers.mjs";

const skip = !CAN_RENDER && "本平台无 resvg 原生绑定";
const SVG = (inner, w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${inner}</svg>`;

/** 纯色方块层：放到黑底上一眼能看出位置与大小。 */
const BLOCK = (w, h, color = "#E4002B") => SVG(`<rect width="${w}" height="${h}" fill="${color}"/>`, w, h);

/** 与底色不同的像素才算「内容」。composite 的输出通常不透明，不能用 alpha 判定。
 * 默认按黑底算——本文件里的测试画布几乎都是 #000000。 */
function inkOf(file, bg = BLACK) {
	const img = pngOf(file);
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < img.height; y += 1) {
		for (let x = 0; x < img.width; x += 1) {
			const i = (y * img.width + x) * img.channels;
			const d = Math.abs(img.data[i] - bg[0]) + Math.abs(img.data[i + 1] - bg[1]) + Math.abs(img.data[i + 2] - bg[2]);
			if (d <= 24) continue;
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
		}
	}
	if (maxX < 0) return null;
	return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** 取一个像素的 RGB。 */
function rgbAt(file, x, y) {
	const img = pngOf(file);
	const i = (y * img.width + x) * img.channels;
	return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];


async function composite(t, args, name) {
	const dir = tempDir(t, `composite-${name}`);
	const { value } = await call("design_render", { action: "composite", out: join(dir, "out.png"), ...args });
	return { value, file: value.path, dir };
}

/* ------------------------------ 位置：anchor ------------------------------ */

test("composite anchor：9 个锚点真的把层放到不同位置", { skip }, async (t) => {
	// 100×40 的层放进 200×200 画布：水平方向能区分左/中/右，垂直方向能区分上/中/下
	const cases = [
		["top-left", 0, 0],
		["top", 50, 0],
		["top-right", 100, 0],
		["left", 0, 80],
		["center", 50, 80],
		["right", 100, 80],
		["bottom-left", 0, 160],
		["bottom", 50, 160],
		["bottom-right", 100, 160]
	];
	for (const [anchor, ex, ey] of cases) {
		const { value, file } = await composite(
			t,
			{ under: "#000000", canvas: [200, 200], over: BLOCK(100, 40), anchor },
			`anchor-${anchor}`
		);
		const box = inkOf(file);
		assert.equal(box.x, ex, `${anchor}: x 应为 ${ex}（实际 ${box.x}）`);
		assert.equal(box.y, ey, `${anchor}: y 应为 ${ey}（实际 ${box.y}）`);
		assert.equal(value.anchor, anchor, `${anchor}: 应回填实际生效的 anchor`);
	}
});

test("composite padding：把层推进安全区（右/下边也不越界）", { skip }, async (t) => {
	const { value, file } = await composite(
		t,
		{ under: "#000000", canvas: [200, 200], over: BLOCK(100, 40), anchor: "bottom-right", padding: 20 },
		"padding"
	);
	const box = inkOf(file);
	assert.equal(box.x + box.w, 180, `右边缘应等于 200-20=180（实际 ${box.x + box.w}）`);
	assert.equal(box.y + box.h, 180, `下边缘应等于 180（实际 ${box.y + box.h}）`);
	assert.equal(value.padding, 20);
});

/* ------------------------------ 尺寸：fit ------------------------------ */

test("composite fit：contain 保比不放大，cover 溢出后裁切，fill 拉伸", { skip }, async (t) => {
	// 源 100×50，画布 200×200
	const contain = await composite(t, { under: "#000000", canvas: [200, 200], over: BLOCK(100, 50), fit: "contain" }, "fit-contain");
	const cBox = inkOf(contain.file, BLACK);
	assert.equal(cBox.w, 100, "contain 不放大：宽度应保持 100");
	assert.equal(cBox.h, 50, "contain 保宽高比：高度 50");

	const cover = await composite(t, { under: "#000000", canvas: [200, 200], over: BLOCK(100, 50), fit: "cover" }, "fit-cover");
	const vBox = inkOf(cover.file, BLACK);
	// cover：缩到 400×200 后裁切 → 画布被填满
	assert.equal(vBox.w, 200, "cover 应铺满宽度");
	assert.equal(vBox.h, 200, "cover 应铺满高度（溢出部分被裁）");

	const fill = await composite(t, { under: "#000000", canvas: [200, 200], over: BLOCK(100, 50), fit: "fill" }, "fit-fill");
	const fBox = inkOf(fill.file, BLACK);
	assert.equal(fBox.w, 200, "fill 应拉满宽");
	assert.equal(fBox.h, 200, "fill 应拉满高（不保宽高比）");

	const none = await composite(t, { under: "#000000", canvas: [200, 200], over: BLOCK(100, 50), fit: "none" }, "fit-none");
	assert.equal(inkOf(none.file, BLACK).w, 100, "none 保持固有尺寸");
});

/* ------------------------------ 外观：blend ------------------------------ */

test("composite blend：multiply 真的算色，不是「不报错但无效」", { skip }, async (t) => {
	// 白底 + 纯绿层：normal → 绿；multiply → 白×绿 = 绿（与 normal 同）；
	// 所以用「红底 + 绿层」：normal = 绿，multiply = 黑。
	const normal = await composite(
		t,
		{ under: "#FF0000", canvas: [100, 100], over: BLOCK(100, 100, "#00FF00"), fit: "fill", blend: "normal" },
		"blend-normal"
	);
	const multiply = await composite(
		t,
		{ under: "#FF0000", canvas: [100, 100], over: BLOCK(100, 100, "#00FF00"), fit: "fill", blend: "multiply" },
		"blend-multiply"
	);
	assert.deepEqual(rgbAt(join(normal.dir, "out.png"), 50, 50), [0, 255, 0], "normal：上层绿直接盖住");
	const m = rgbAt(join(multiply.dir, "out.png"), 50, 50);
	assert.ok(m[0] < 40 && m[1] < 40 && m[2] < 40, `multiply：红×绿 应为黑，实际 [${m.join(",")}]`);
	assert.equal(multiply.value.blend, "multiply");
});

/* ------------------------------ 变换：rotate ------------------------------ */

test("composite rotate：包围盒变宽（真的旋转了）", { skip }, async (t) => {
	const flat = await composite(
		t,
		{ under: "#000000", canvas: [200, 200], over: BLOCK(120, 20), fit: "none", anchor: "center" },
		"rot-0"
	);
	const tilted = await composite(
		t,
		{ under: "#000000", canvas: [200, 200], over: BLOCK(120, 20), fit: "none", anchor: "center", rotate: 45 },
		"rot-45"
	);
	const f = inkOf(flat.file, BLACK);
	const d = inkOf(tilted.file, BLACK);
	assert.equal(f.h, 20, "不旋转：高 20");
	assert.ok(d.h > 60, `旋转 45° 后包围盒应变高（实际 ${d.h}）`);
	assert.equal(tilted.value.rotate, 45);
});

/* ------------------------------ 画布：canvas / bg ------------------------------ */

test("composite canvas：显式画布尺寸 + bg 底色", { skip }, async (t) => {
	// under 是纯色时必须给 canvas，否则算不出尺寸
	await assert.rejects(
		() => call("design_render", { action: "composite", under: "#FFFFFF", over: BLOCK(50, 50), out: join(tempDir(t, "no-canvas"), "o.png") }),
		/must|canvas/i,
		"纯色底缺 canvas 应报错而不是猜尺寸"
	);

	const { value, file, dir } = await composite(
		t,
		{ under: "#FFFFFF", canvas: [300, 150], over: BLOCK(50, 50), anchor: "center" },
		"canvas-explicit"
	);
	assert.equal(value.width, 300);
	assert.equal(value.height, 150);
	assert.deepEqual(rgbAt(file, 0, 0), [255, 255, 255], "纯色底应真的是白");
	assert.deepEqual(rgbAt(join(dir, "out.png"), 150, 75), [228, 0, 43], "中心应是层的红");
});

/* ------------------------------ 回填与健壮性 ------------------------------ */

test("composite：回填实际生效的维度（能确认参数真生效）", { skip }, async (t) => {
	const { value } = await composite(
		t,
		{ under: "#000000", canvas: [200, 200], over: BLOCK(50, 50), anchor: "top-left", padding: 10, blend: "screen", opacity: 0.5, rotate: 30 },
		"echo"
	);
	assert.equal(value.anchor, "top-left");
	assert.equal(value.fit, "contain");
	assert.equal(value.padding, 10);
	assert.equal(value.blend, "screen");
	assert.equal(value.opacity, 0.5);
	assert.equal(value.rotate, 30);
	assert.ok(typeof value.layer?.x === "number" && typeof value.layer?.width === "number", "应回填层的实际几何");
});

test("composite：非法枚举拒绝，不静默降级", { skip }, async (t) => {
	const dir = tempDir(t, "composite-bad");
	for (const bad of [{ anchor: "middle" }, { fit: "squish" }, { blend: "glow" }]) {
		await assert.rejects(
			() => call("design_render", { action: "composite", under: "#000", canvas: [100, 100], over: BLOCK(10, 10), out: join(dir, "o.png"), ...bad }),
			/must be one of|invalid/i,
			`${JSON.stringify(bad)} 应被拒绝`
		);
	}
});
