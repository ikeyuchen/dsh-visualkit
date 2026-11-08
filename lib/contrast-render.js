/**
 * contrast-render.js — 在**真实渲染像素**上量文字对比度。
 *
 * 为什么需要它：静态解析 CSS 遇到 `rgba()`、CSS 变量、渐变背景时算不出真实对比度，
 * 只能诚实跳过（就是体检里的 contrast-invalid）。而这三类恰好是现在最常用的写法。
 *
 * 做法（不靠 OCR、不靠 DOM）：同一页面渲两遍——
 *   A：正常渲染  → 某个像素 = 文字色与背景色的混合结果
 *   B：把文字染成透明（`color: transparent`），布局不变 → 该像素 = **真实背景**
 * A 与 B 差异大的地方就是文字墨迹；把墨迹最深处（最接近纯文字色）和它背后的 B
 * 像素拿来算 WCAG 对比度。渐变、图片、半透明图层全部自动覆盖——因为量的是像素。
 *
 * 为什么不取纯前景色：文字有抗锯齿与字重差异，细字的“有效对比度”本来就低于
 * 声明值。直接量像素反而更接近人眼看到的。
 */
import { relativeLuminance } from "./layouts/rules-contrast.js";
import { decodePng } from "./layouts/png.js";
import { readFileSync, writeFileSync } from "node:fs";
import { renderHtml } from "./render-html.js";

/** 把页面里的文字全部染成透明（保留布局），用于取得“真实背景”。 */
export function hideTextCss() {
	return `*{color:transparent !important;text-shadow:none !important;caret-color:transparent !important;}`;
}

/** 把注入用的 <style> 插到 </head> 前；没有 head 就插到最前。 */
export function injectCss(html, css) {
	const tag = `<style data-dsh-inject>${css}</style>`;
	const at = html.toLowerCase().lastIndexOf("</head>");
	if (at !== -1) return html.slice(0, at) + tag + html.slice(at);
	return tag + html;
}

const srgb = (v) => {
	const c = v / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = (r, g, b) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);

/** WCAG 对比度（1–21），两端用像素实际值。 */
export function pixelContrast(a, b) {
	const la = lum(a[0], a[1], a[2]);
	const lb = lum(b[0], b[1], b[2]);
	const hi = Math.max(la, lb);
	const lo = Math.min(la, lb);
	return (hi + 0.05) / (lo + 0.05);
}

/**
 * 量一张页面的真实文字对比度。
 * @param {object} opts
 * @param {string} opts.htmlPath  HTML 文件路径
 * @param {string} opts.outDir    两遍渲染的临时输出目录
 * @param {number} [opts.width]   视口宽
 * @param {number} [opts.height]  视口高
 * @param {string} [opts.browserPath]
 * @returns {{worst:object, samples:number, pairs:object[], rendered:boolean, reason?:string}}
 */
export function measureRenderedContrast(opts) {
	const width = Number.isFinite(opts.width) ? opts.width : 1280;
	const height = Number.isFinite(opts.height) ? opts.height : 800;
	const plain = `${opts.outDir}/__contrast_plain.png`;
	const bare = `${opts.outDir}/__contrast_bare.png`;

	const barePath = `${opts.outDir}/__contrast_bare.html`;

	// 读文件与渲染都在 try 里：缺文件、没浏览器、路径不可写，都应该返回结构化的
	// rendered:false + reason，而不是把异常抛给调用方（那样上层就没法降级了）。
	try {
		const source = readFileSync(opts.htmlPath, "utf8");
		writeFileSync(barePath, injectCss(source, hideTextCss()), "utf8");
		renderHtml({ html: opts.htmlPath, out: plain, width, height, browserPath: opts.browserPath });
		renderHtml({ html: barePath, out: bare, width, height, browserPath: opts.browserPath });
	} catch (error) {
		return { rendered: false, reason: error.message, worst: null, samples: 0, pairs: [] };
	}

	const A = decodePng(readFileSync(plain));
	const B = decodePng(readFileSync(bare));
	const w = Math.min(A.width, B.width);
	const h = Math.min(A.height, B.height);
	const ch = A.channels;
	const chB = B.channels;
	const at = (img, c, x, y) => {
		const i = (y * img.width + x) * c;
		return [img.data[i], img.data[i + 1], img.data[i + 2]];
	};

	// 连通域分组：一个文字块就是一个连通域，里面**最墨的像素**才是它的本色。
	// 为什么不用「按颜色聚类」：抗锯齿边缘的颜色恰好是“背景到文字色”的中间调，
	// 会自成一个簇，被当成一种低对比文字报出来（实测误报 1.97:1 / 2.23:1）。
	// 连通域天然把边缘和本体绑在一起，取域内 max-delta 像素就拿到纯色。
	const W2 = w;
	const H2 = h;
	const inked = new Uint8Array(W2 * H2);
	const deltas = new Uint16Array(W2 * H2);
	let totalSamples = 0;
	for (let y = 0; y < H2; y += 1) {
		for (let x = 0; x < W2; x += 1) {
			const a = at(A, ch, x, y);
			const b = at(B, chB, x, y);
			const d = Math.round((Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3);
			if (d < 40) continue;
			inked[y * W2 + x] = 1;
			deltas[y * W2 + x] = d;
			totalSamples += 1;
		}
	}

	const labels = new Int32Array(W2 * H2).fill(-1);
	const parent = [];
	const find = (i) => {
		let r = i;
		while (parent[r] !== r) r = parent[r];
		while (parent[i] !== r) {
			const next = parent[i];
			parent[i] = r;
			i = next;
		}
		return r;
	};
	const union = (a1, b1) => {
		const ra = find(a1);
		const rb = find(b1);
		if (ra !== rb) parent[rb] = ra;
	};
	let next = 0;
	for (let y = 0; y < H2; y += 1) {
		for (let x = 0; x < W2; x += 1) {
			const idx = y * W2 + x;
			if (inked[idx] === 0) continue;
			const left = x > 0 ? labels[idx - 1] : -1;
			const up = y > 0 ? labels[idx - W2] : -1;
			if (left === -1 && up === -1) {
				labels[idx] = next;
				parent[next] = next;
				next += 1;
			} else if (left !== -1 && up !== -1) {
				labels[idx] = Math.min(left, up);
				union(left, up);
			} else {
				labels[idx] = left !== -1 ? left : up;
			}
		}
	}

	// 汇总每个连通域：像素数 + 最墨的那个像素（它的 fg/bg 就是该文字的纯色与真实背景）
	const comps = new Map();
	for (let y = 0; y < H2; y += 1) {
		for (let x = 0; x < W2; x += 1) {
			const idx = y * W2 + x;
			if (labels[idx] === -1) continue;
			const root = find(labels[idx]);
			const d = deltas[idx];
			const cur = comps.get(root);
			if (cur === undefined) {
				comps.set(root, { n: 1, best: d, x, y, fg: at(A, ch, x, y), bg: at(B, chB, x, y) });
			} else {
				cur.n += 1;
				if (d > cur.best) {
					cur.best = d;
					cur.x = x;
					cur.y = y;
					cur.fg = at(A, ch, x, y);
					cur.bg = at(B, chB, x, y);
				}
			}
		}
	}

	// 太小的连通域是网点/描边/图标碎片，不是正文
	const MIN_PIXELS = 30;
	const bands = [...comps.values()]
		.filter((c) => c.n >= MIN_PIXELS)
		.map((c) => ({
			ratio: pixelContrast(c.fg, c.bg),
			fg: c.fg,
			bg: c.bg,
			x: c.x,
			y: c.y,
			pixels: c.n
		}))
		.sort((p1, p2) => p1.ratio - p2.ratio);

	// 同一色文字会切成很多连通域（中文每个字都是独立的），按「前景色」去重：
	// 每种文字色只留最差的那一处，否则报告里会刷屏同一行字的六个字。
	const byColor = new Map();
	for (const bnd of bands) {
		const k = bnd.fg.map((v) => Math.round(v / 16)).join(",");
		const cur = byColor.get(k);
		if (cur === undefined || bnd.ratio < cur.ratio) byColor.set(k, bnd);
	}
	const distinct = [...byColor.values()].sort((p1, p2) => p1.ratio - p2.ratio);

	return {
		rendered: true,
		samples: totalSamples,
		bands: distinct.length,
		allRuns: bands.length,
		worst: distinct[0],
		// 按对比度从低到高给出前几套文字配色，便于一眼看出哪几种字最危险
		pairs: distinct.slice(0, 6).map((bnd) => ({
			ratio: Math.round(bnd.ratio * 100) / 100,
			fg: `rgb(${bnd.fg.join(",")})`,
			bg: `rgb(${bnd.bg.join(",")})`,
			pixels: bnd.pixels,
			x: bnd.x,
			y: bnd.y
		}))
	};
}

void relativeLuminance;
