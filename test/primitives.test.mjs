/**
 * test/primitives.test.mjs — shadow / dash 图元。
 *
 * 这两个是**能力**不是风格：只要能给任意轮廓加阴影、给任意描边加虚线，
 * 高程体系/卡片/浮层/按奥/浮雕/双光源/技术图/草图全部由调用方自己组合。
 * 这里验的是「图元真的落地」，而不是某一种观感好不好看。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { CAN_RENDER, call, pngOf, rejects, tempDir } from "./helpers.mjs";
import { parseShadows, cssBlurToSigma } from "../lib/shadow.js";
import { normalizePathData, normalizeShape, SHAPE_LIMITS } from "../lib/svg.js";
import { parseGradientStops } from "../lib/icon-render.js";

const skip = !CAN_RENDER && "本平台无 resvg 原生绑定";

/** 带透明度的像素数（用于确认阴影真的画出来了）。 */
function semiTransparentPixels(file) {
	const img = pngOf(file);
	if (img.channels !== 4) return 0;
	let n = 0;
	for (let i = 3; i < img.data.length; i += 4) {
		const a = img.data[i];
		if (a > 4 && a < 250) n += 1;
	}
	return n;
}

async function emitSvg(args) {
	const { value } = await call("icon", { action: "emit", name: "settings", target: "raw", style: "outline", ...args });
	return value.code;
}

/* ------------------------------ 解析层 ------------------------------ */

test("parseShadows：CSS box-shadow 语法（单条 / 多条 / inset / 颜色带空格）", () => {
	const one = parseShadows("0 2px 8px rgba(0, 0, 0, 0.3)").list;
	assert.equal(one.length, 1);
	assert.deepEqual({ dx: one[0].dx, dy: one[0].dy, blur: one[0].blur, opacityLike: one[0].color }, { dx: 0, dy: 2, blur: 8, opacityLike: "rgba(0, 0, 0, 0.3)" }, "rgba 里的逗号不能被当成分隔符");

	const dual = parseShadows("6px 6px 12px #bebebe, -6px -6px 12px #ffffff").list;
	assert.equal(dual.length, 2, "逗号分隔的多阴影");
	assert.equal(dual[1].dx, -6, "第二条的偏移应为负");
	assert.equal(dual[1].color, "#ffffff");

	const inset = parseShadows("inset 0 3px 6px rgba(0,0,0,.4)").list;
	assert.equal(inset[0].inset, true, "inset 关键字应被识别");
	assert.equal(inset[0].dy, 3);

	// spread（第 4 个数）目前不支持，但要标出来
	assert.equal(parseShadows("0 2px 4px 6px #000").droppedSpread, true, "spread 应被标记为丢弃");
	assert.equal(parseShadows("0 2px 4px #000").droppedSpread, false);

	// 容错：空 / 非法 / 只有一个数字
	assert.deepEqual(parseShadows("").list, []);
	assert.deepEqual(parseShadows(undefined).list, []);
	assert.deepEqual(parseShadows("只给个 4px").list, []);
	// CSS blur ≈ 2σ
	assert.equal(cssBlurToSigma(8), 4);
});

/* ------------------------------ icon 图元 ------------------------------ */

test("icon dash：stroke-dasharray 真落到了描边字形上", async () => {
	const coded = await emitSvg({ dash: [4, 2] });
	assert.match(coded, /stroke-dasharray="4 2"/, "应输出 stroke-dasharray");
	const plain = await emitSvg({});
	assert.equal(/stroke-dasharray/.test(plain), false, "不传时不出现");
});

test("icon shadow：单/双/内阴影结构正确，且与 dash 可共存", async () => {
	const single = await emitSvg({ shadow: "0 3px 8px rgba(0,0,0,.35)" });
	assert.equal((single.match(/<filter /g) ?? []).length, 1, "单阴影 = 1 个 filter");
	assert.equal((single.match(/<g filter="url\(#ak-sh/g) ?? []).length, 1, "单阴影 = 1 个模糊副本");

	const dual = await emitSvg({ container: "squircle", radius: 8, color: "#E0E5EC", color2: "#5A6B85", shadow: "4px 4px 8px #A3B1C6, -4px -4px 8px #FFFFFF" });
	assert.equal((dual.match(/<filter /g) ?? []).length, 2, "双光源 = 2 个 filter");
	assert.match(dual, /translate\(4 4\)/, "正向偏移的副本在");
	assert.match(dual, /translate\(-4 -4\)/, "反向偏移的副本在");

	const inset = await emitSvg({ container: "rounded", radius: 6, color: "#D4D4D8", color2: "#3F3F46", shadow: "inset 0 3px 6px rgba(0,0,0,.4)" });
	assert.match(inset, /<clipPath id="ak-cl-/, "内阴影需要 clipPath 裁到轮廓内");
	assert.match(inset, /clip-path="url\(#ak-cl-/, "应真的应用裁剪");

	// 三个维度同时用
	const all = await emitSvg({ container: "squircle", radius: 8, color: "#E8E8ED", color2: "#52525B", strokeWidth: 1.4, dash: [3, 2], shadow: "3px 3px 7px #C2C2CB, -3px -3px 7px #FFFFFF" });
	assert.match(all, /stroke-dasharray/, "虚线仍在");
	assert.equal((all.match(/<filter /g) ?? []).length, 2, "双阴影仍在");
});

test("icon shadow：确定性（同输入同字节）且 filter id 按内容唯一", async () => {
	const a = await emitSvg({ shadow: "0 3px 8px rgba(0,0,0,.35)" });
	const b = await emitSvg({ shadow: "0 3px 8px rgba(0,0,0,.35)" });
	assert.equal(a, b, "同输入必须同字节");
	const c = await emitSvg({ shadow: "0 3px 12px rgba(0,0,0,.35)" });
	const idA = (a.match(/<filter id="([^"]+)"/) ?? [])[1];
	const idC = (c.match(/<filter id="([^"]+)"/) ?? [])[1];
	assert.notEqual(idA, idC, "blur 不同 → filter id 不同（否则同页多图标会串）");
});

test("icon shadow：真实渲染出半透明阴影像素（不是“不报错但无效”）", { skip }, async (t) => {
	const dir = tempDir(t, "shadow-render");
	for (const [label, args] of [
		["none", {}],
		["outer", { shadow: "0 6px 10px rgba(0,0,0,0.6)" }]
	]) {
		const code = await emitSvg({ size: 256, ...args });
		await call("design_render", { action: "render", svg: code, png: `${dir}/${label}.png`, width: 256 });
	}
	const none = semiTransparentPixels(`${dir}/none.png`);
	const outer = semiTransparentPixels(`${dir}/outer.png`);
	assert.ok(outer > none * 2, `有阴影时半透明像素应显著变多（none=${none} outer=${outer}）`);
});

/* --------------------------- 图标内文字 --------------------------- */

test("icon text：文字**取代**字形，不是叠在上面", async () => {
	const withGlyph = await call("icon", { action: "emit", name: "settings", target: "raw", style: "outline", container: "circle", color: "#111" });
	const withText = await call("icon", { action: "emit", name: "settings", target: "raw", style: "outline", container: "circle", color: "#111", text: "7z" });
	assert.match(withText.value.code, /<text[^>]*>7z<\/text>/, "应输出文字");
	// 有文字时不再画字形组（字形组特征是 <g fill=... stroke=...>）
	assert.equal(/<g fill="[^"]+" stroke="[^"]+"/.test(withText.value.code), false, "字形应被文字取代");
	assert.equal(/<g fill="[^"]+" stroke="[^"]+"/.test(withGlyph.value.code), true, "不能传文字时仍应画字形");
});

test("icon text：字号按字数自动适配，显式 textSize 优先", async () => {
	const sizeOf = (code) => Number((code.match(/font-size="([\d.]+)"/) ?? [])[1]);
	const one = await emitSvg({ text: "K", container: "circle", inset: 0.18 });
	const two = await emitSvg({ text: "AI", container: "circle", inset: 0.18 });
	const three = await emitSvg({ text: "PDF", container: "circle", inset: 0.18 });
	assert.ok(sizeOf(one) > sizeOf(two), `字越少字号应越大（${sizeOf(one)} vs ${sizeOf(two)}）`);
	assert.ok(sizeOf(two) > sizeOf(three), `字越多字号应越小（${sizeOf(two)} vs ${sizeOf(three)}）`);
	// 都在安全区内（不超过可用高度）
	for (const code of [one, two, three]) assert.ok(sizeOf(code) <= 24 * 0.92, "不应超出画布");
	// 显式指定优先
	const fixed = await emitSvg({ text: "AI", container: "circle", inset: 0.18, textSize: 8 });
	assert.equal(sizeOf(fixed), 8, "显式 textSize 应生效");
});

test("icon text：name 可省（文字标不需要图标名），两者都缺才报错", async () => {
	// 只给 text
	const onlyText = await call("icon", { action: "emit", target: "raw", text: "Z", container: "circle", color: "#111" });
	assert.match(onlyText.value.code, /<text[^>]*>Z<\/text>/);
	// 两者都缺 → 人话报错
	await rejects(
		() => call("icon", { action: "emit", target: "raw", container: "circle" }),
		/requires name, text or path/,
		"name / text / path 都缺时应报明确的错"
	);
});

test("icon text：中孔（shapes 减法）不得切进文字", { skip }, async (t) => {
	// 实测 bug：减法用 SVG <mask> 作用在整组合成结果上，"K 徽章开个装饰孔"
	// 会变成 "K 被咬掉右下内角"，看起来就像渲染错误。
	// 修正：文字画在 mask 之外（减法是「在卡片上挖洞」，不是「切割文字」）。
	const dir = tempDir(t, "text-mask");
	const base = { text: "K", container: "circle", inset: 0.18, color: "#2563EB" };
	const files = {};
	for (const [label, extra] of [
		["plain", {}],
		["holed", { shapes: [{ name: "circle", scale: 0.12, subtract: true }] }]
	]) {
		const code = await emitSvg({ ...base, ...extra });
		await call("design_render", { action: "render", svg: code, png: `${dir}/${label}.png`, width: 480 });
		files[label] = pngOf(`${dir}/${label}.png`);
	}
	// 数「纯白像素」= 文字笔画。文字未被切 → 两者几乎相等（允许抗锯齿 1% 误差）
	const whiteOf = (img) => {
		let n = 0;
		for (let i = 0; i < img.data.length; i += img.channels) {
			const r = img.data[i];
			const g = img.data[i + 1];
			const b = img.data[i + 2];
			const a = img.channels === 4 ? img.data[i + 3] : 255;
			if (a > 240 && r > 245 && g > 245 && b > 245) n += 1;
		}
		return n;
	};
	const plain = whiteOf(files.plain);
	const holed = whiteOf(files.holed);
	const delta = Math.abs(plain - holed) / Math.max(1, plain);
	assert.ok(plain > 1000, `样本太少无法判定（${plain}）`);
	assert.ok(delta < 0.01, `加中孔后文字笔画数应基本不变（${plain} vs ${holed}，相差 ${(delta * 100).toFixed(2)}%）`);
});

test("fill-rule：一条路径里的多子路径能挖出真孔（像素级）", { skip }, async (t) => {
	// 为什么必须验像素：nonzero / evenodd 在字符串层面完全看不出区别，
	// 只有真的渲染出来看中心是不是透明的，才能证明孔挖了。
	// 实测：外圆+内圆同向时 nonzero 中心 α=255（实心）、evenodd 中心 α=0（挖空）。
	const RING = "M12 2 a10 10 0 1 0 0.01 0 Z M12 7 a5 5 0 1 0 0.01 0 Z";
	const dir = tempDir(t, "fill-rule");
	const alphaAt = async (label, opts) => {
		const code = await emitSvg(opts);
		await call("design_render", { action: "render", svg: code, png: `${dir}/${label}.png`, width: 336 });
		const img = pngOf(`${dir}/${label}.png`);
		const s = img.width / 24;
		const px = (x, y) => {
			const i = (Math.round(y * s) * img.width + Math.round(x * s)) * img.channels;
			return img.channels === 4 ? img.data[i + 3] : 255;
		};
		return { center: px(12, 12), ring: px(12, 4), outside: px(1, 1) };
	};

	const solid = await alphaAt("nonzero", { path: RING, paint: "fill", color: "#E8620C" });
	assert.ok(solid.center > 200, `nonzero 应把孔填实，实际中心 α=${solid.center}`);

	const holed = await alphaAt("evenodd", { path: RING, paint: "fill", color: "#E8620C", fillRule: "evenodd" });
	assert.equal(holed.center, 0, `evenodd 应把孔挖空，实际中心 α=${holed.center}`);
	assert.ok(holed.ring > 200, "环体应仍是不透明的");
	assert.equal(holed.outside, 0, "外部应透明");

	// 每层独立 fill-rule：孔里应透出底层颜色
	const layered = await emitSvg({ name: "circle", paint: "fill", color: "#F1F5F9", color2: "#F1F5F9", shapes: [{ path: RING, fillRule: "evenodd", color: "#E01D5E", scale: 0.92 }] });
	assert.match(layered, /fill-rule="evenodd"/, "每层应带上自己的 fill-rule");
});

test("fill-rule：只接受 nonzero / evenodd，非法值整条丢弃", async () => {
	assert.equal(normalizeShape({ name: "circle", fillRule: "evenodd" }).fillRule, "evenodd");
	assert.equal(normalizeShape({ name: "circle", fillRule: "nonzero" }).fillRule, "nonzero");
	assert.equal(normalizeShape({ name: "circle" }).fillRule, null, "不传就是 null（走 SVG 默认）");
	assert.equal(normalizeShape({ name: "circle", fillRule: "winding" }), null, "非法值应拒");
	assert.equal(normalizeShape({ name: "circle", fillRule: 1 }), null);
	// 只有 fillRule 没有名字/路径的图层也不行
	assert.equal(normalizeShape({ fillRule: "evenodd" }), null);
});

test("icon path：自绘输出必须是无损 JSON（无 undefined/NaN）", async () => {
	// 实测 bug：自绘的合成图标对象没有 pascal/camel/pack，直接写进输出就变成
	// undefined 属性质，实机报 `invalid output: value is not lossless JSON`。
	const { value } = await call("icon", {
		action: "emit",
		target: "raw",
		paint: "fill",
		color: "#FBBF24",
		container: "rounded",
		inset: 0.05,
		path: "M2 20 L9 8 L13 14 L16 10 L22 20 Z",
		shapes: [{ path: "M2 17 C5 14 8 20 11 17", color: "#38BDF8", scale: 0.95 }]
	});
	const walk = (node, at) => {
		assert.notEqual(node, undefined, `${at} 不得是 undefined`);
		if (typeof node === "number") assert.ok(Number.isFinite(node), `${at} 不得是 NaN/Infinity`);
		if (node !== null && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, `${at}.${k}`);
	};
	walk(value, "value");
	assert.match(value.code, /^<svg /, "应产出合法 SVG");
	assert.equal(value.icon.name, "(custom path)");
});

test("icon path：自绘路径走白名单校验，与容器/渐变/遮罩/旋转可组合", async () => {
	const D = "M12 2 L22 12 L12 22 L2 12 Z";
	// 只给 path（不需要 name）
	const plain = await emitSvg({ path: D, paint: "fill", color: "#E8620C" });
	assert.match(plain, /<path d="M12 2 L22 12 L12 22 L2 12 Z"/, "自绘路径应原样写进 d=");
	// 与容器 + 渐变 + 阴影组合
	const composed = await emitSvg({ path: D, paint: "fill", container: "rounded", radius: 7, inset: 0.05, stops: ["#FFD848", "#FF3D57"], shadow: "0 3px 8px rgba(0,0,0,.4)" });
	for (const re of [/<linearGradient /, /<filter /, /<rect /]) assert.match(composed, re, `应包含 ${re}`);
	// 自绘作减法 + 旋转
	const hole = await emitSvg({ name: "circle", paint: "fill", shapes: [{ path: D, scale: 0.8, subtract: true, rotate: 45 }] });
	assert.match(hole, /<mask /, "自绘减法应生成 mask");
	assert.match(hole, /rotate\(45 12 12\)/, "自绘减法应可旋转");
	// 注入与非法数据
	assert.equal(normalizePathData('M0 0" /><script>'), null, "不得允许引号");
	assert.equal(normalizePathData("M0 0<foo"), null, "不得允许尖括号");
	assert.equal(normalizePathData("L1 1"), null, "必须以 M/m 开头");
	assert.equal(normalizePathData("M" + "1 ".repeat(3000)), null, "超长应拒");
});

test("icon text：文字内容做 XML 转义（不破坏 SVG 结构）", async () => {
	const risky = await emitSvg({ text: '<&"', container: "circle" });
	assert.match(risky, /^<svg /, "仍应是合法 SVG 开头");
	assert.match(risky, /&lt;&amp;&quot;/, "应被转义成实体");
	assert.equal(/<text[^>]*><&/.test(risky), false, "不得把原始尖括号写进文本节点");
});

/* ------------------------- 渐变多停靠点 ------------------------- */

test("parseGradientStops：color / color@offset 两种写法，未写偏移均匀分布", () => {
	assert.deepEqual(parseGradientStops(["#f00", "#0f0"]), [
		{ color: "#f00", offset: 0 },
		{ color: "#0f0", offset: 1 }
	]);
	assert.deepEqual(parseGradientStops(["#f00", "#ff0", "#0f0"]), [
		{ color: "#f00", offset: 0 },
		{ color: "#ff0", offset: 0.5 },
		{ color: "#0f0", offset: 1 }
	]);
	// 显式偏移保留（允许锐变：同位置两色）
	const sharp = parseGradientStops(["#111", "#111@0.5", "#eee@0.5", "#eee"]);
	assert.deepEqual(sharp.map((s) => s.offset), [0, 0.5, 0.5, 1], "同偏移两色是合法写法（锐变）");
	// 单色 = 两条同色停靠点
	assert.deepEqual(parseGradientStops(["#f00"]), [
		{ color: "#f00", offset: 0 },
		{ color: "#f00", offset: 1 }
	]);
});

test("parseGradientStops：容错与注入防护", () => {
	assert.equal(parseGradientStops([]), null);
	assert.equal(parseGradientStops(undefined), null);
	assert.equal(parseGradientStops(["#f00@5"]), null, "偏移越界应拒绝");
	assert.equal(parseGradientStops(["#f00@-1"]), null);
	assert.equal(parseGradientStops(["@0.5"]), null, "只有偏移没颜色");
	assert.equal(parseGradientStops([1, 2]), null, "非字符串");
	// 注入：引号/尖括号会把属性撑破
	assert.equal(parseGradientStops(['red"/><script>']), null, "不得允许引号");
	assert.equal(parseGradientStops(["red<foo"]), null, "不得允许尖括号");
});

test("icon stops：N 停靠点真的写进渐变，且 id 按全部停靠点唯一", async () => {
	const three = await emitSvg({ name: "circle", paint: "fill", container: "circle", gradient: "linear", stops: ["#FF0000", "#FFFF00@0.5", "#00FF00"] });
	assert.equal((three.match(/<stop /g) ?? []).length, 3, "应有 3 个 stop");
	assert.match(three, /stop-color="#FFFF00"/);

	// 同首末色、中间不同 → id 必须不同（否则同页会串）
	const a = await emitSvg({ name: "circle", paint: "fill", container: "circle", gradient: "linear", stops: ["#111111", "#FF0000@0.5", "#222222"] });
	const b = await emitSvg({ name: "circle", paint: "fill", container: "circle", gradient: "linear", stops: ["#111111", "#00FF00@0.5", "#222222"] });
	const idA = (a.match(/<linearGradient id="([^"]+)"/) ?? [])[1];
	const idB = (b.match(/<linearGradient id="([^"]+)"/) ?? [])[1];
	assert.notEqual(idA, idB, "中间色不同 → 渐变 id 必须不同");

	// 不传 stops 时保持旧的两色路径（向后兼容）
	const legacy = await emitSvg({ name: "circle", paint: "fill", container: "circle", gradient: "linear", color: "#FF6B35", color2: "#7B2FF7" });
	assert.equal((legacy.match(/<stop /g) ?? []).length, 2, "旧路径仍是 2 个 stop");
});

/* --------------------------- 多形状组合 --------------------------- */

test("normalizeShape：对象形式，缺省用默认值、越界拒绝", () => {
	const at = (name, extra = {}) => ({ name, path: null, scale: 1, dx: 0, dy: 0, rotate: 0, weight: null, color: null, stops: null, gradient: "linear", angle: 45, fillRule: null, subtract: false, ...extra });
	assert.deepEqual(normalizeShape({ name: "circle" }), at("circle"), "只给 name 也能用");
	assert.deepEqual(normalizeShape({ name: "star", scale: 0.6 }), at("star", { scale: 0.6 }));
	assert.deepEqual(normalizeShape({ name: "circle", subtract: true }), at("circle", { subtract: true }));
	assert.deepEqual(normalizeShape({ name: "tree", scale: 0.5, dx: 3, dy: -4 }), at("tree", { scale: 0.5, dx: 3, dy: -4 }), "负偏移直接用（不再需要 + 号）");
	assert.deepEqual(normalizeShape({ name: "star", color: "#FBBF24" }), at("star", { color: "#FBBF24" }));
	assert.deepEqual(normalizeShape({ name: "star", color: "rgba(255,255,255,0.8)" }), at("star", { color: "rgba(255,255,255,0.8)" }), "rgba 含括号逗号");
	assert.deepEqual(normalizeShape({ name: "tree", weight: 2.4 }), at("tree", { weight: 2.4 }));
	assert.deepEqual(normalizeShape({ name: "tree", rotate: 15 }), at("tree", { rotate: 15 }), "旋转是对象语法新解锁的");
	assert.deepEqual(normalizeShape({ name: "tree", rotate: -20 }), at("tree", { rotate: -20 }));

	// 存活性：name 缺失/非对象 → null
	assert.equal(normalizeShape({}), null);
	assert.equal(normalizeShape({ name: "" }), null);
	assert.equal(normalizeShape(null), null);
	assert.equal(normalizeShape("star@0.5"), null, "字符串语法已移除，必须返回 null");
	// 自绘图层：只给 path 也行（name 不再必填）
	assert.deepEqual(normalizeShape({ path: "M2 2 L22 2 L22 22 Z" }), at("", { path: "M2 2 L22 2 L22 22 Z" }));
	assert.deepEqual(normalizeShape({ name: "circle", path: "M0 0 L1 1" }), at("circle", { path: "M0 0 L1 1" }), "两者都写时 path 优先使用");
	assert.equal(normalizeShape({ path: "L1 1" }), null, "path 必须以 M/m 开头");
	assert.equal(normalizeShape({ path: "M0 0\" /><x" }), null, "path 不得含引号尖括号");
	assert.equal(normalizeShape({}), null, "name 与 path 都缺");
	// 每层独立渐变：给了 stops 就归一化成停靠点数组
	assert.deepEqual(
		normalizeShape({ name: "star", stops: ["#FFD848", "#FF3D57"] }).stops,
		[{ color: "#FFD848", offset: 0 }, { color: "#FF3D57", offset: 1 }],
		"stops 应被归一化"
	);
	assert.equal(normalizeShape({ name: "star", stops: ["#zz<q"] }), null, "非法 stops 整条丢弃");
	assert.equal(normalizeShape({ name: "star", gradient: "radial" }).gradient, "radial");
	assert.equal(normalizeShape({ name: "star" }).gradient, "linear", "默认线性");
	assert.equal(normalizeShape({ name: "star", angle: 999 }), null, "角度越界应拒");
	assert.equal(normalizeShape([1, 2]), null);

	// 越界：给了但非法 → 整条丢弃（不静默改成边界值）
	assert.equal(normalizeShape({ name: "star", scale: 0 }), null);
	assert.equal(normalizeShape({ name: "star", scale: 99 }), null);
	assert.equal(normalizeShape({ name: "star", dx: 999 }), null);
	assert.equal(normalizeShape({ name: "star", weight: 0 }), null);
	assert.equal(normalizeShape({ name: "star", weight: 99 }), null);
	assert.equal(normalizeShape({ name: "star", rotate: 999 }), null);
	assert.equal(normalizeShape({ name: "star", color: 'red"/><script>' }), null, "颜色不得含引号尖括号");
	// 区间常量自身要自洽
	assert.ok(SHAPE_LIMITS.scale[0] < SHAPE_LIMITS.scale[1]);
	assert.ok(SHAPE_LIMITS.weight[0] < SHAPE_LIMITS.weight[1]);
});

test("icon shapes：叠加形与减去形（环/中空）真的落地", async () => {
	// 减去 → 必须出现 mask（白底 + 黑形），并真的应用在内容上
	const donut = await emitSvg({ name: "circle", paint: "fill", color: "#E8620C", shapes: [{ name: "circle", scale: 0.55, subtract: true }] });
	assert.match(donut, /<mask id="ak-mk-/, "减去应生成 mask");
	assert.match(donut, /<g mask="url\(#ak-mk-/, "mask 应真的应用到内容");
	assert.match(donut, /scale\(0\.55\)/, "减去形应带上缩放");

	// 偏移：孔必须能离开中心，否则永远被字形盖住。
	// 注意：transform 是 translate(growth+dx, growth+dy) scale(s)，growth 负责把图形摆到中心，
	// 所以孔的真实中心 = translate + 12×scale，不是 translate 本身。
	const tag = await emitSvg({ text: "SALE", container: "rounded", inset: 0.16, color: "#E4002B", shapes: [{ name: "circle", scale: 0.16, dy: -9, subtract: true }] });
	const m = tag.match(/translate\(([\d.-]+) ([\d.-]+)\) scale\(0\.16\)/);
	assert.ok(m !== null, "偏移应写进 transform");
	const holeCy = Number(m[2]) + 12 * 0.16;
	assert.ok(Math.abs(holeCy - 3) < 0.01, `吊牌孔中心应落在 y=3（上移 9 单位），实际 ${holeCy.toFixed(2)}`);

	// 每个叠加形独立颜色：三层不同色都要真的进 SVG。
	// 注意：没有 container 时 color2 不参与，字形色就是 color（已实测）。
	const multi = await emitSvg({ name: "circle", paint: "fill", color: "#1D2A3A", shapes: [{ name: "star", scale: 0.34, dx: 6.5, dy: 6.5, color: "#FFD400" }, { name: "circle", scale: 0.3, dx: -6, dy: -6, color: "#FF3B30" }, { name: "dot", scale: 0.22, dx: 6.5, dy: -6.5, color: "#30D158" }, { name: "square", scale: 0.16 }] });
	for (const c of ["#FFD400", "#FF3B30", "#30D158"]) assert.ok(multi.includes(c), `缺少叠加形颜色 ${c}`);
	// 第四个没写颜色 → 必须回落到字形色 #1D2A3A
	assert.ok((multi.match(/#1D2A3A/g) ?? []).length >= 2, "未指定颜色的叠加形应沿用字形色");

	// 每层独立线宽：全局 1 种 → 逐层多种
	const graded = await emitSvg({ name: "square", paint: "stroke", strokeWidth: 1, shapes: [{ name: "sun", scale: 0.26, dx: -7, dy: -7, weight: 1.2 }, { name: "mountain", scale: 0.5, dy: 4, weight: 3.5 }, { name: "bird", scale: 0.2, dx: 7, dy: 7, weight: 0.8 }] });
	const widths = [...new Set([...graded.matchAll(/stroke-width="([^"]+)"/g)].map((m) => m[1]))].sort();
	assert.deepEqual(widths, ["0.8", "1", "1.2", "3.5"], `应出现 4 种线宽，实际 ${JSON.stringify(widths)}`);

	// paint=fill 时给 weight 必须真的打开描边，否则线宽无效（曾经的零效果坑）
	const filled = await emitSvg({ name: "circle", paint: "fill", color: "#333333", shapes: [{ name: "star", scale: 0.4, dx: 5, dy: 5, weight: 2 }] });
	assert.match(filled, /stroke-width="2"/, "fill 模式下 weight 应生效");
	assert.match(filled, /stroke="#333333"/, "应自动补上与该层同色的描边");

	// 每层独立渐变：每层一个自己的 gradient 定义，并用 objectBoundingBox（自动跟包围盒）
	const layered = await emitSvg({ name: "circle", paint: "fill", color: "#0F172A", shapes: [
		{ name: "star", scale: 0.35, dx: 5.5, dy: -5.5, stops: ["#FFD848", "#FF7A30@0.5", "#E01D5E"], angle: 0 },
		{ name: "heart", scale: 0.35, dx: -5.5, dy: 5.5, stops: ["#22D3EE", "#6366F1"], gradient: "radial" }
	] });
	assert.equal((layered.match(/<linearGradient id="ak-sg-/g) ?? []).length, 1, "应有 1 个每层线性渐变");
	assert.equal((layered.match(/<radialGradient id="ak-sg-/g) ?? []).length, 1, "应有 1 个每层径向渐变");
	assert.equal((layered.match(/fill="url\(#ak-sg-/g) ?? []).length, 2, "两层都应引用自己的渐变");
	assert.equal((layered.match(/<stop /g) ?? []).length, 5, "3+2 个停靠点");
	// 同停靠点不同角度 → id 必须不同（否则同页串色）
	const a = await emitSvg({ name: "circle", paint: "fill", shapes: [{ name: "star", stops: ["#111111", "#222222"], angle: 0 }] });
	const b = await emitSvg({ name: "circle", paint: "fill", shapes: [{ name: "star", stops: ["#111111", "#222222"], angle: 90 }] });
	const idA = (a.match(/<linearGradient id="(ak-sg-[^"]+)"/) ?? [])[1];
	const idB = (b.match(/<linearGradient id="(ak-sg-[^"]+)"/) ?? [])[1];
	assert.notEqual(idA, idB, "角度不同 → 每层渐变 id 必须不同");

	// 不写 weight 时保持旧行为（全图一个线宽）
	const uniform = await emitSvg({ name: "tree", paint: "stroke", strokeWidth: 2, shapes: [{ name: "sun", scale: 0.3, dx: 5, dy: 5 }] });
	assert.equal([...new Set([...uniform.matchAll(/stroke-width="([^"]+)"/g)].map((m) => m[1]))].length, 1, "不写 weight 应保持单一线宽");

	// 对照：不加偏移时孔在正中——正是“毫无意义”的那种情况
	const centred = await emitSvg({ name: "circle", paint: "fill", shapes: [{ name: "circle", scale: 0.16, subtract: true }] });
	const mc = centred.match(/translate\(([\d.-]+) ([\d.-]+)\) scale\(0\.16\)/);
	assert.ok(Math.abs(Number(mc[2]) + 12 * 0.16 - 12) < 0.01, "无偏移时应正好在 y=12");

	// 叠加 → 不生成 mask，且多出一个字形组
	const stacked = await emitSvg({ name: "circle", paint: "fill", color: "#2563EB", shapes: [{ name: "search", scale: 0.6 }] });
	assert.equal(/<mask /.test(stacked), false, "叠加不需要 mask");
	assert.equal((stacked.match(/<g fill="#2563EB"/g) ?? []).length, 2, "叠加后应有两个同画笔的字形组");

	// 同时叠加与减去
	const both = await emitSvg({ name: "circle", paint: "fill", shapes: [{ name: "circle", scale: 0.6, subtract: true }, { name: "search", scale: 0.42 }] });
	assert.match(both, /<mask /, "含减去项就要 mask");
	// SVG 里只有 path、没有图标名，所以按「缩放变换 + path 数量」验
	assert.match(both, /scale\(0\.6\)/, "减去项带自己的缩放");
	assert.match(both, /scale\(0\.42\)/, "叠加项带自己的缩放");
	const pathCount = (both.match(/<path /g) ?? []).length;
	assert.ok(pathCount >= 2, `叠加 + 减去共存时至少两个 path，实际 ${pathCount}`);
});

test("icon shapes：非法/不存在的名字静默跳过，不崩不产出垃圾", async () => {
	const bad = await emitSvg({ name: "circle", paint: "fill", shapes: [{ name: "no-such-icon-xyz" }] });
	assert.match(bad, /^<svg /, "仍应产出合法 SVG");
	assert.equal(/<mask /.test(bad), false, "没有有效项就不该生成 mask");
	assert.equal(/undefined|NaN|\[object Object\]/.test(bad), false, "不得含垃圾占位符");
});

/* --------------------------- composite 图元 --------------------------- */

test("composite shadow：用 feFlood+feComposite 把图层 alpha 染成阴影色", { skip }, async (t) => {
	const dir = tempDir(t, "composite-shadow");
	const BLOCK = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="#111111"/></svg>`;
	const args = {
		action: "composite",
		under: "#FFFFFF",
		canvas: [200, 200],
		over: BLOCK,
		anchor: "center",
		fit: "none",
		shadow: "0 8px 16px rgba(228,0,43,0.9)"
	};
	const plain = await call("design_render", { ...args, out: `${dir}/plain.png` });
	const shadowed = await call("design_render", { ...args, out: `${dir}/shadowed.png` });
	assert.ok(shadowed.value.bytes > 0);
	// 阴影区应有偏红的像素（feFlood 把 alpha 染成 #E4002B）
	const img = pngOf(`${dir}/shadowed.png`);
	let reddish = 0;
	for (let i = 0; i < img.data.length; i += img.channels) {
		const r = img.data[i];
		const g = img.data[i + 1];
		const b = img.data[i + 2];
		if (r > g + 25 && r > b + 25) reddish += 1;
	}
	assert.ok(reddish > 200, `阴影应被染成红色，实际红色像素 ${reddish}（plain 字节 ${plain.value.bytes}）`);
});
