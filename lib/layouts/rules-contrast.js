/**
 * layouts/rules-contrast.js — 文字对比度检测（WCAG 2.x + APCA），layout_check 的对比度规则库。
 *
 * 为什么两套都要：
 *   WCAG 2.x 的 contrast ratio 是行业合规底线（AA 4.5:1 / AAA 7:1），但它只看亮度比，
 *   对深色底上的浅字、细体小字都过于宽容；APCA（WCAG 3 候选算法）按极性与字号加权，
 *   更贴近实际观感。两者互相补位：WCAG 管「合不合规」，APCA 管「好不好读」。
 *
 * 设计与边界（都是刻意的，改之前先看这里）：
 *   1. **不 import ../svg.js**：那边的 hexOf() 只认 #rgb/#rrggbb，且 import 会形成
 *      layouts → svg → layouts 的循环依赖。本模块自带完整解析器，只依赖 common.js 的 finding()。
 *   2. 解析不出来（currentColor / inherit / var(--x) / 空串…）**不报错也不瞎猜**，
 *      产出一条 info 说明「跳过」，让调用方知道这条没测。
 *   3. 前景半透明（alpha < 1）时按「前景叠在给定背景上」合成后再算比例（背景若无 alpha
 *      则先假定它在白色画布上）。半透明文字的真实对比度还取决于下面的东西，所以另外
 *      出一条 contrast-low-alpha 提醒这段固定会被高估。
 *   4. 建议色是确定性的：把前景朝黑或朝白按 1% 步长推，取第一个达标的，同输入同输出。
 *
 * `transparent` 视为「未指定前景色」→ 返回 null（和 currentColor 一样跳过）。
 */

import { finding } from "./common.js";

/* ------------------------------ 1. 颜色解析 ------------------------------ */

/** 常用命名色（CSS 常见子集，57 个；够覆盖 normal.css 手写场景，不做全量 148 色）。 */
const NAMED = {
	aliceblue: [240, 248, 255],
	aqua: [0, 255, 255],
	beige: [245, 245, 220],
	black: [0, 0, 0],
	blue: [0, 0, 255],
	brown: [165, 42, 42],
	burlywood: [222, 184, 135],
	cadetblue: [95, 158, 160],
	chocolate: [210, 105, 30],
	coral: [255, 127, 80],
	cornflowerblue: [100, 149, 237],
	crimson: [220, 20, 60],
	cyan: [0, 255, 255],
	darkblue: [0, 0, 139],
	darkgray: [169, 169, 169],
	darkgreen: [0, 100, 0],
	darkgrey: [169, 169, 169],
	darkorange: [255, 140, 0],
	darkslategray: [47, 79, 79],
	deepskyblue: [0, 191, 255],
	dimgray: [105, 105, 105],
	dimgrey: [105, 105, 105],
	dodgerblue: [30, 144, 255],
	firebrick: [178, 34, 34],
	forestgreen: [34, 139, 34],
	fuchsia: [255, 0, 255],
	gainsboro: [220, 220, 220],
	gold: [255, 215, 0],
	goldenrod: [218, 165, 32],
	gray: [128, 128, 128],
	green: [0, 128, 0],
	greenyellow: [173, 255, 47],
	grey: [128, 128, 128],
	hotpink: [255, 105, 180],
	indianred: [205, 92, 92],
	indigo: [75, 0, 130],
	ivory: [255, 255, 240],
	khaki: [240, 230, 140],
	lavender: [230, 230, 250],
	lightblue: [173, 216, 230],
	lightgray: [211, 211, 211],
	lightgreen: [144, 238, 144],
	lightgrey: [211, 211, 211],
	lightpink: [255, 182, 193],
	lightslategray: [119, 136, 153],
	lime: [0, 255, 0],
	limegreen: [50, 205, 50],
	magenta: [255, 0, 255],
	maroon: [128, 0, 0],
	mediumpurple: [147, 112, 219],
	midnightblue: [25, 25, 112],
	navy: [0, 0, 128],
	olive: [128, 128, 0],
	orange: [255, 165, 0],
	orangered: [255, 69, 0],
	orchid: [218, 112, 214],
	plum: [221, 160, 221],
	purple: [128, 0, 128],
	rebeccapurple: [102, 51, 153],
	red: [255, 0, 0],
	royalblue: [65, 105, 225],
	salmon: [250, 128, 114],
	seagreen: [46, 139, 87],
	sienna: [160, 82, 45],
	silver: [192, 192, 192],
	skyblue: [135, 206, 235],
	slateblue: [106, 90, 205],
	slategray: [112, 128, 144],
	springgreen: [0, 255, 127],
	steelblue: [70, 130, 180],
	tan: [210, 180, 140],
	teal: [0, 128, 128],
	tomato: [255, 99, 71],
	turquoise: [64, 224, 208],
	violet: [238, 130, 238],
	wheat: [245, 222, 179],
	white: [255, 255, 255],
	whitesmoke: [245, 245, 245],
	yellow: [255, 255, 0],
	yellowgreen: [154, 205, 50]
};

/** 命名色表（导出给测试与调用方做「是不是命名色」判定；不要在别处另抄一份）。 */
export const NAMED_COLORS = Object.keys(NAMED);

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

/** 0–255 通道值（数字或百分比）。 */
function channel(token) {
	const text = String(token).trim();
	const pct = /^([+-]?\d*\.?\d+)%$/.exec(text);
	if (pct !== null) return clamp((Number(pct[1]) / 100) * 255, 0, 255);
	const n = Number(text);
	return Number.isFinite(n) ? clamp(n, 0, 255) : null;
}

/** 0–1 alpha（数字或百分比）。 */
function alpha(token) {
	if (token === undefined || token === null) return 1;
	const text = String(token).trim();
	const pct = /^([+-]?\d*\.?\d+)%$/.exec(text);
	if (pct !== null) return clamp(Number(pct[1]) / 100, 0, 1);
	const n = Number(text);
	return Number.isFinite(n) ? clamp(n, 0, 1) : null;
}

/** 把 `rgb(...)` 内层拆成主参数 + 可选 alpha（支持逗号和 CSS4 空格/斜杠两种写法）。 */
function splitArgs(body) {
	const parts = body.split("/");
	const main = parts.shift().trim();
	const args = main === "" ? [] : main.split(/[\s,]+/).filter((s) => s !== "");
	const rest = parts.join("/").trim();
	return { args, alphaToken: rest === "" ? undefined : rest };
}

/** hsl 色相：无单位 = 角度，也支持 deg / turn / rad / grad。 */
function hue(token) {
	const text = String(token).trim().toLowerCase();
	const m = /^([+-]?\d*\.?\d+)(deg|turn|rad|grad)?$/.exec(text);
	if (m === null) return null;
	const n = Number(m[1]);
	const unit = m[2] ?? "deg";
	const deg = unit === "turn" ? n * 360 : unit === "rad" ? (n * 180) / Math.PI : unit === "grad" ? n * 0.9 : n;
	return Number.isFinite(deg) ? deg : null;
}

/** hsl → rgb（标准 CSS 算法，h 归一化后按 6 段线性插值）。 */
function hslToRgb(h, s, l) {
	const hueDeg = ((h % 360) + 360) % 360;
	const sat = clamp(s, 0, 1);
	const lit = clamp(l, 0, 1);
	const c = (1 - Math.abs(2 * lit - 1)) * sat;
	const hp = hueDeg / 60;
	const x = c * (1 - Math.abs((hp % 2) - 1));
	const m = lit - c / 2;
	const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.min(5, Math.floor(hp))];
	return { r: Math.round((seg[0] + m) * 255), g: Math.round((seg[1] + m) * 255), b: Math.round((seg[2] + m) * 255) };
}

/**
 * CSS 颜色值 → {r,g,b,a}；解析失败返回 null（调用方跳过，不报错）。
 * 支持 #rgb #rgba #rrggbb #rrggbbaa / rgb() rgba() / hsl() hsla() / 命名色。
 * @param {unknown} value
 * @returns {{r:number,g:number,b:number,a:number}|null}
 */
export function parseColor(value) {
	if (typeof value !== "string") return null;
	const text = value.trim().toLowerCase();
	if (text === "") return null;

	// #rgb / #rgba / #rrggbb / #rrggbbaa
	const hex = /^#([0-9a-f]+)$/.exec(text);
	if (hex !== null) {
		const d = hex[1];
		if (d.length === 3 || d.length === 4) {
			const ch = (i) => parseInt(d[i] + d[i], 16);
			const a = d.length === 4 ? ch(3) / 255 : 1;
			return { r: ch(0), g: ch(1), b: ch(2), a };
		}
		if (d.length === 6 || d.length === 8) {
			const ch = (i) => parseInt(d.slice(i * 2, i * 2 + 2), 16);
			const a = d.length === 8 ? ch(3) / 255 : 1;
			return { r: ch(0), g: ch(1), b: ch(2), a };
		}
		return null;
	}

	const fn = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(text);
	if (fn !== null) {
		// 两种合法写法要同时吃下：rgba(0,0,0,0.5)（逗号 4 参）与 rgb(0 0 0 / 50%)（斜杠）
		let { args, alphaToken } = splitArgs(fn[2]);
		if (args.length === 4 && alphaToken === undefined) {
			alphaToken = args[3];
			args = args.slice(0, 3);
		}
		if (args.length !== 3) return null;
		const a = alpha(alphaToken);
		if (a === null) return null;
		if (fn[1].startsWith("rgb")) {
			const [r, g, b] = args.map(channel);
			if (r === null || g === null || b === null) return null;
			return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a };
		}
		const h = hue(args[0]);
		if (h === null) return null;
		const pct = (token) => {
			const m = /^([+-]?\d*\.?\d+)%$/.exec(String(token).trim());
			return m === null ? null : Number(m[1]) / 100;
		};
		const s = pct(args[1]);
		const l = pct(args[2]);
		if (s === null || l === null) return null;
		return { ...hslToRgb(h, s, l), a };
	}

	const named = NAMED[text];
	if (named !== undefined) return { r: named[0], g: named[1], b: named[2], a: 1 };
	return null;
}

/** 内部：接受 {r,g,b} 对象或 CSS 字符串；解析不出来直接抛（调用前必须已校验）。 */
function asRgb(color, label) {
	if (color !== null && typeof color === "object" && Number.isFinite(color.r)) return color;
	const parsed = parseColor(color);
	if (parsed === null) throw new TypeError(`${label} 不是可解析的颜色：${String(color)}`);
	return parsed;
}

/** #RRGGBB（大写，忽略 alpha）。 */
function toHex({ r, g, b }) {
	const h = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0").toUpperCase();
	return `#${h(r)}${h(g)}${h(b)}`;
}

/** 前景叠在背景上（背景自身半透明时先假定它压在白纸上）。 */
function over(fg, bg) {
	const bgOpaque = bg.a < 1 ? blend(bg, { r: 255, g: 255, b: 255, a: 1 }) : bg;
	if (fg.a >= 1) return { r: fg.r, g: fg.g, b: fg.b, a: 1 };
	return blend(fg, bgOpaque);
}

function blend(fg, bg) {
	const a = fg.a;
	return {
		r: Math.round(fg.r * a + bg.r * (1 - a)),
		g: Math.round(fg.g * a + bg.g * (1 - a)),
		b: Math.round(fg.b * a + bg.b * (1 - a)),
		a: 1
	};
}

/* --------------------------- 2. WCAG 2.x 对比度 --------------------------- */

/** WCAG 2.x 相对亮度（sRGB 线性化后的 Rec.709 加权）。 */
export function relativeLuminance(rgb) {
	const c = asRgb(rgb, "rgb");
	const lin = (v) => {
		const s = clamp(v, 0, 255) / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG 2.x 对比度（1–21，1 = 同色）。参数可传 {r,g,b} 或 CSS 字符串。 */
export function contrastRatio(fg, bg) {
	const a = relativeLuminance(asRgb(fg, "fg"));
	const b = relativeLuminance(asRgb(bg, "bg"));
	const hi = Math.max(a, b);
	const lo = Math.min(a, b);
	return (hi + 0.05) / (lo + 0.05);
}

/* ------------------------------- 3. APCA ------------------------------- */

/**
 * APCA-W3 0.0.98G 参考实现的常量。
 * 来源：APCA/W3C 参考实现 sa98g.js（W3 0.0.98G-4g）。注意它的 Y 用**纯 2.4 幂**
 * 而不是 sRGB 的分段线性化，所以不能复用 relativeLuminance()。
 */
const APCA = {
	mainTRC: 2.4,
	Rco: 0.2126729,
	Gco: 0.7151522,
	Bco: 0.072175,
	normBG: 0.56,
	normTXT: 0.57,
	revTXT: 0.62,
	revBG: 0.65,
	blkThrs: 0.022,
	blkClmp: 1.414,
	scaleBoW: 1.14,
	scaleWoB: 1.14,
	loBoWoffset: 0.027,
	loWoBoffset: 0.027,
	deltaYmin: 0.0005,
	loClip: 0.1
};

/** APCA 专用亮度 Y（含近黑软钳制，避免极暗色被算成 0 导致比例爆掉）。 */
function apcaY(rgb) {
	const ch = (v) => Math.pow(clamp(v, 0, 255) / 255, APCA.mainTRC);
	let y = APCA.Rco * ch(rgb.r) + APCA.Gco * ch(rgb.g) + APCA.Bco * ch(rgb.b);
	if (y < APCA.blkThrs) y += Math.pow(APCA.blkThrs - y, APCA.blkClmp);
	return y;
}

/** 小字折价系数（近似，见 apcaLc 注释）。 */
const SMALL_TEXT_WEIGHT = 1.14;

/**
 * APCA 官方参考值（自测对照用，不是我算的结论）：APCA-W3 0.0.98G 公布的极值用例
 * 与查询表里的 #888 on #fff。容差 ±3（不同小版本在 loClip/offset 上有 0.1~1 的抖动）。
 */
export const APCA_OFFICIAL = {
	blackOnWhite: 106.04,
	whiteOnBlack: -107.88,
	gray888OnWhite: 63.1
};

function sizeWeight(fontSizePx, bold) {
	const size = Number(fontSizePx);
	const fs = Number.isFinite(size) && size > 0 ? size : 16;
	// 粗体按 1.25× 等效字号（APCA 的 SA98G 查表里 700 权重约等于大一档字号）
	const eff = bold ? fs * 1.25 : fs;
	return eff < 16 ? Math.pow(SMALL_TEXT_WEIGHT, (16 - eff) / 16) : 1;
}

/**
 * APCA Lc（-108..106；正 = 深色字浅色底，负 = 浅色字深色底，绝对值越大越易读）。
 *
 * **字号加权是近似**：APCA 官方不把字号算进 Lc，而是用 SA98G 查表给「该字号需要多少 Lc」
 * 的门槛。为了让本模块能「给定字号直接判一条色对」，这里把 <16px 的小字按
 * weight = 1.14^(（16-等效字号）/16) 折价（最多 14%），等效于小字更难达标的同一个效果。
 * 因此**核对官方 Lc 数值时请传 fontSizePx ≥ 16**（此时 weight 恰好为 1，输出与官方一致）。
 *
 * @param {{r:number,g:number,b:number}|string} fg
 * @param {{r:number,g:number,b:number}|string} bg
 * @param {number} [fontSizePx=16]
 * @param {boolean} [bold=false]
 * @returns {number}
 */
export function apcaLc(fg, bg, fontSizePx = 16, bold = false) {
	const yTxt = apcaY(asRgb(fg, "fg"));
	const yBg = apcaY(asRgb(bg, "bg"));
	let lc;
	if (Math.abs(yBg - yTxt) < APCA.deltaYmin) return 0;
	if (yBg > yTxt) {
		const sapc = (Math.pow(yBg, APCA.normBG) - Math.pow(yTxt, APCA.normTXT)) * APCA.scaleBoW;
		lc = sapc < APCA.loClip ? 0 : (sapc - APCA.loBoWoffset) * 100;
	} else {
		const sapc = (Math.pow(yBg, APCA.revBG) - Math.pow(yTxt, APCA.revTXT)) * APCA.scaleWoB;
		lc = sapc > -APCA.loClip ? 0 : (sapc + APCA.loWoBoffset) * 100;
	}
	const weight = sizeWeight(fontSizePx, bold);
	const value = weight === 1 ? lc : lc / weight;
	return Number(value.toFixed(2));
}

/* ------------------------------ 4. 阈值 ------------------------------ */

const AA_BODY = 4.5;
const AA_LARGE = 3;
const AAA_BODY = 7;
const AAA_LARGE = 4.5;
const APCA_BODY = 60;
const APCA_LARGE = 45;
const LOW_ALPHA = 0.85;

/**
 * 是否「大字」，按 WCAG 原文：非粗体 ≥ 24px（18pt），或粗体 ≥ 18.66px（14pt）。
 * 未加粗的 18.66px 只是 14pt 的**常规**大字门限的一半前提——WCAG 的 18.66px 一档
 * 是专门给粗体的：粗体笔画更重，在更小字号下仍然好认，所以阈值可以降；
 * 常规字重就必须到 24px 才放宽。（早先的规则表把这两个数字挂反了，2026-11-07 已按原文改回。）
 */
export function isLargeText(fontSizePx, bold = false) {
	const fs = Number(fontSizePx);
	if (!Number.isFinite(fs)) return false;
	return bold ? fs >= 18.66 : fs >= 24;
}

/* --------------------------- 5. 可执行修复建议 --------------------------- */

/**
 * 把前景朝黑（target=0）或白（target=255）按 1% 步长推，返回第一个达标的颜色。
 * 确定性：同输入必得同输出，不含随机。返回 {hex, value, reached}。
 */
function suggest(fg, bg, target, scorer) {
	const toWhite = scorer({ r: 255, g: 255, b: 255, a: 1 }) >= scorer({ r: 0, g: 0, b: 0, a: 1 });
	const goal = toWhite ? 255 : 0;
	for (let i = 1; i <= 100; i += 1) {
		const amount = i / 100;
		const cand = {
			r: Math.round(fg.r + (goal - fg.r) * amount),
			g: Math.round(fg.g + (goal - fg.g) * amount),
			b: Math.round(fg.b + (goal - fg.b) * amount),
			a: 1
		};
		const value = scorer(cand);
		if (value >= target) return { hex: toHex(cand), value, reached: true, lighter: toWhite };
	}
	const end = toWhite ? { r: 255, g: 255, b: 255, a: 1 } : { r: 0, g: 0, b: 0, a: 1 };
	return { hex: toHex(end), value: scorer(end), reached: false, lighter: toWhite };
}

/* ------------------------------ 6. 规则引擎 ------------------------------ */

const MAX_PER_RULE = 3;

const fmtRatio = (value) => `${value.toFixed(2)}:1`;
const fmtNum = (value) => Number(value.toFixed(2)).toString();

/** 「#RRGGBB（alpha 0.5）」这种人也能读的色值描述。 */
function describe(color) {
	const hex = toHex(color);
	return color.a < 1 ? `${hex}（alpha ${color.a.toFixed(2)}）` : hex;
}

/**
 * 批量审计文字对比度。
 * @param {Array<{fg:string, bg:string, fontSizePx:number, bold?:boolean, where?:string}>} pairs
 * @returns {Array<{severity:string, rule:string, message:string, fix:string, where?:string}>}
 *   按 contrastRatio 从低到高排（最糟的先出）；无法解析的 info 排在最后；
 *   每条 rule 最多 3 条。
 */
export function auditContrast(pairs) {
	const list = Array.isArray(pairs) ? pairs : [];
	const records = [];
	const where = (value) => (typeof value === "string" && value !== "" ? value : undefined);

	list.forEach((pair, index) => {
		if (pair === null || typeof pair !== "object") return;
		// 两个都不是字符串 = 不是一条对比度色对（调用方字段缺失/传错），静默跳过
		if (typeof pair.fg !== "string" && typeof pair.bg !== "string") return;
		const spot = where(pair.where);
		const fontSizePx = Number(pair.fontSizePx);
		const bold = Boolean(pair.bold);
		const fgRaw = typeof pair.fg === "string" ? pair.fg : "";
		const bgRaw = typeof pair.bg === "string" ? pair.bg : "";
		const fg = parseColor(fgRaw);
		const bg = parseColor(bgRaw);

		// 解析不出来：明确跳过（不猜、不报 error），但要让调用方知道这条没测
		if (fg === null || bg === null) {
			const bad = fg === null ? "前景色" : "背景色";
			const raw = fg === null ? fgRaw : bgRaw;
			records.push({
				rule: "contrast-invalid",
				sortKey: Number.POSITIVE_INFINITY,
				index,
				build: () =>
					finding({
						severity: "info",
						rule: "contrast-invalid",
						message: `${bad}「${raw === "" ? "(空)" : raw}」无法解析成具体颜色（可能是 currentColor / inherit / CSS 变量），这条对比度检查已跳过`,
						fix: `在 CSS 里把它落成具体颜色（或传入计算后的值）后再复查；动态色值无法离线判定，别硬猜`,
						...(spot !== undefined ? { where: spot } : {})
					})
			});
			return;
		}

		const paintedFg = over(fg, bg);
		const paintedBg = bg.a < 1 ? over(bg, { r: 255, g: 255, b: 255, a: 1 }) : bg;
		const ratio = contrastRatio(paintedFg, paintedBg);
		const large = isLargeText(fontSizePx, bold);
		const label = large ? "大字" : "正文";
		const fgText = describe(fg);
		const bgText = describe(bg);
		const alphaHint = fg.a < 1 ? `，合成后 ${toHex(paintedFg)}` : "";
		const aa = large ? AA_LARGE : AA_BODY;
		const aaa = large ? AAA_LARGE : AAA_BODY;

		if (ratio < aa) {
			records.push({
				rule: "contrast-wcag-aa",
				sortKey: ratio,
				index,
				build: () => {
					const plan = suggest(paintedFg, paintedBg, aa, (c) => contrastRatio(c, paintedBg));
					const moved = fg.a < 1 ? `把前景改成不透明的 ${plan.hex}` : `把前景${plan.lighter ? "提亮" : "加深"}到 ${plan.hex}`;
					const fix = plan.reached
						? `${moved}（ratio ${fmtRatio(plan.value)}，达到 ${aa}:1）`
						: `即使把前景换成 ${plan.hex} 也只有 ratio ${fmtRatio(plan.value)}，只改前景不够：同时调${plan.lighter ? "暗" : "亮"}背景 ${bgText} 或换更大字号才算达标`;
					return finding({
						severity: "error",
						rule: "contrast-wcag-aa",
						message: `${label}对比度 ${fmtRatio(ratio)}（${fgText} on ${bgText}${alphaHint}），低于 WCAG AA 的 ${aa}:1`,
						fix,
						...(spot !== undefined ? { where: spot } : {})
					});
				}
			});
		} else if (ratio < aaa) {
			records.push({
				rule: "contrast-wcag-aaa",
				sortKey: ratio,
				index,
				build: () => {
					const plan = suggest(paintedFg, paintedBg, aaa, (c) => contrastRatio(c, paintedBg));
					const moved = fg.a < 1 ? `把前景改成不透明的 ${plan.hex}` : `把前景${plan.lighter ? "提亮" : "加深"}到 ${plan.hex}`;
					const fix = plan.reached
						? `可选提升：${moved}（ratio ${fmtRatio(plan.value)}，达到 AAA ${aaa}:1）`
						: `只改前景到 ${plan.hex} 也只到 ratio ${fmtRatio(plan.value)}；要上 AAA ${aaa}:1 得同时动背景 ${bgText}`;
					return finding({
						severity: "info",
						rule: "contrast-wcag-aaa",
						message: `${label}对比度 ${fmtRatio(ratio)}（${fgText} on ${bgText}${alphaHint}），已过 AA ${aa}:1，未到 AAA ${aaa}:1 —— 长文正文建议往 AAA 提升`,
						fix,
						...(spot !== undefined ? { where: spot } : {})
					});
				}
			});
		}

		const lc = apcaLc(paintedFg, paintedBg, fontSizePx, bold);
		const apcaMin = large ? APCA_LARGE : APCA_BODY;
		if (Math.abs(lc) < apcaMin) {
			records.push({
				rule: "contrast-apca",
				sortKey: ratio,
				index,
				build: () => {
					const plan = suggest(paintedFg, paintedBg, apcaMin, (c) => Math.abs(apcaLc(c, paintedBg, fontSizePx, bold)));
					const moved = fg.a < 1 ? `把前景改成不透明的 ${plan.hex}` : `把前景${plan.lighter ? "提亮" : "加深"}到 ${plan.hex}`;
					const fix = plan.reached
						? `${moved}（Lc ${fmtNum(plan.value)}，达到 |Lc| ${apcaMin}）`
						: `前景推到 ${plan.hex} 也只到 Lc ${fmtNum(plan.value)}；需要动背景 ${bgText} 或加大字号/加粗`;
					return finding({
						severity: "warn",
						rule: "contrast-apca",
						message: `APCA Lc ${fmtNum(lc)}（${fgText} on ${bgText}${alphaHint}，${Number.isFinite(fontSizePx) && fontSizePx > 0 ? fmtNum(fontSizePx) : 16}px ${label}），绝对值低于 APCA 建议的 ${apcaMin}，实际观感偏弱`,
						fix,
						...(spot !== undefined ? { where: spot } : {})
					});
				}
			});
		}

		if (fg.a < LOW_ALPHA) {
			records.push({
				rule: "contrast-low-alpha",
				sortKey: ratio,
				index,
				build: () =>
					finding({
						severity: "warn",
						rule: "contrast-low-alpha",
						message: `前景 ${fgText} on ${bgText} 的 alpha 只有 ${fg.a.toFixed(2)}（< ${LOW_ALPHA}），半透明文字会透出下层，真实对比度低于按合成色算出的 ${fmtRatio(ratio)}`,
						fix: `改用不透明的 ${toHex(paintedFg)}（与当前合成色等效，ratio ${fmtRatio(ratio)}，可被准确测量）；确实要半透明时别把这段文字压在图片或渐变上`,
						...(spot !== undefined ? { where: spot } : {})
					})
			});
		}
	});

	const byRule = new Map();
	for (const record of records) {
		if (!byRule.has(record.rule)) byRule.set(record.rule, []);
		byRule.get(record.rule).push(record);
	}
	const kept = [];
	for (const group of byRule.values()) {
		group.sort((a, b) => a.sortKey - b.sortKey || a.index - b.index);
		kept.push(...group.slice(0, MAX_PER_RULE));
	}
	kept.sort((a, b) => a.sortKey - b.sortKey || a.index - b.index);
	return kept.map((record) => record.build());
}
