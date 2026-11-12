/**
 * render.js — design_render 的实现：SVG→PNG 与图层合成，只用 resvg，不调外部进程。
 *
 * resvg 不走 dependencies：直接 import vendor/resvg 的 JS 层，不经过 node_modules
 * 解析，也不依赖系统软件（原因见 docs/ARCHITECTURE.md）。
 *
 * 合成（composite）不求人：resvg 支持 `<image href="data:image/png;base64,…">`，
 * 因此「PNG 底 + SVG/PNG 层」可以拼成一个合成 SVG 再一次性渲染——不需要 sharp
 * 或任何像素库，也就不用为了叠两层图去背 20MB 的原生依赖。
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname } from "node:path";
import { createRequire } from "node:module";
import { cssBlurToSigma, parseShadows } from "./shadow.js";

// resvg 是 **vendored** 的（vendor/resvg/），不是 npm 依赖。
//
// 为何不走 dependencies（2026-11-07 实测）：官方 install_bundle 会跑 pnpm，
// 它会把这类型 link 包声明的 dependencies 接管——实测直接把插件目录里的
// `@resvg/resvg-js` 主包删了，只剩平台二进制，导致 `Cannot find package`。
// vendored 后插件自带全部东西，装包/重组合都不会再动它。
//
// 用 createRequire 而非 ESM named import：vendor 里是 CJS，且 js-binding 的
// 导出是动态赋值（`module.exports.Resvg = Resvg`），cjs-module-lexer 不保证能识别。
//
// **必须延迟加载**：vendored 只带 win32-x64 绑定，在 linux / macOS 上 require 会直接抛
// "Failed to load native binding"。顶层 require 会让整个插件在这些平台「一 import 就崩」，
// 连累 CI 的 ubuntu 作业与渲染之外的纯 JS 能力（图标 / 体检 / 风格 / 素材）。所以第一次
// 真正渲染时才加载，并把平台信息写进错误消息。
const require = createRequire(import.meta.url);
let ResvgClass = null;
function resvgClass() {
	if (ResvgClass === null) {
		try {
			ResvgClass = require("../vendor/resvg/index.js").Resvg;
		} catch (error) {
			throw new Error(
				`SVG 渲染需要 vendored resvg 的 win32-x64 原生绑定（当前 ${process.platform}/${process.arch}）：${error?.message ?? error}`
			);
		}
	}
	return ResvgClass;
}

/** PNG 尺寸从 IHDR 读取（不解析渲染器返回，避免上游字段变更导致 undefined）。 */
function pngSize(buf) {
	if (buf.length < 24 || buf.toString("ascii", 12, 16) !== "IHDR") {
		throw new Error("not a PNG (or truncated header)");
	}
	return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** 自动判断输入是 SVG 标记、SVG 文件还是位图文件。 */
async function loadInput(input, label) {
	const raw = String(input ?? "").trim();
	if (raw === "") throw new Error(`${label} is empty`);
	if (raw.includes("<")) return { kind: "markup", svg: raw };
	if (!existsSync(raw)) throw new Error(`${label} not found: ${raw}`);
	const ext = extname(raw).toLowerCase();
	if (ext === ".svg") return { kind: "svgFile", path: raw, svg: await readFile(raw, "utf8") };
	if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp") {
		return { kind: "raster", path: raw, buf: await readFile(raw) };
	}
	throw new Error(`${label}: unsupported file type "${ext}"（支持 .svg / .png / .jpg / .webp）`);
}

const RESVG_OPTS = {
	// 系统字体：中文界面大量用雅黑，显式列出比依赖 fallback 稳
	font: { loadSystemFonts: true, defaultFontFamily: "Microsoft YaHei" },
	background: "rgba(0,0,0,0)"
};

/** 宽度上限：防模型传 100000 直接撑爆内存（实测 100000×30000 的 PNG 已 13MB）。 */
const MAX_WIDTH = 20000;

/** 校验 width：undefined = 用固有尺寸；否则必须是有界正整数。 */
function normalizeWidth(width) {
	if (width === undefined || width === null) return undefined;
	const n = typeof width === "number" ? width : Number.NaN;
	if (!Number.isFinite(n) || n <= 0 || n > MAX_WIDTH) {
		throw new Error(`width 必须是 1–${MAX_WIDTH} 的数字（收到 ${JSON.stringify(width)}）；不传则用 SVG 固有尺寸`);
	}
	return Math.round(n);
}

/** 输出必须是 .png：PNG 字节写到 .jpg 会让下游误判格式。 */
function assertPngPath(file, label) {
	if (typeof file !== "string" || file.trim() === "") throw new Error(`${label} is required`);
	if (!file.toLowerCase().endsWith(".png")) throw new Error(`${label} 必须以 .png 结尾（收到 "${file}"）：本工具只输出 PNG`);
}

/** 渲染一个 SVG 输入到 PNG buffer。width 给定时按宽度等比缩放。 */
function renderToPng(svg, width) {
	const opts = { ...RESVG_OPTS };
	const fit = normalizeWidth(width);
	if (fit !== undefined) opts.fitTo = { mode: "width", value: fit };
	const image = new (resvgClass())(svg, opts).render();
	return { buf: image.asPng(), width: image.width, height: image.height };
}

async function ensureDir(file) {
	await mkdir(dirname(file), { recursive: true });
}

/**
 * action=render：SVG（标记或文件）→ PNG。
 * @returns {{path:string,width:number,height:number,bytes:number}}
 */
async function renderSvg({ svg, png, width, sizes, ico }) {
	assertPngPath(png, "png output path");
	const input = await loadInput(svg, "svg");
	if (input.kind === "raster") throw new Error("action=render 需要 SVG 输入；位图请用 action=composite");
	const { buf, width: w, height: h } = renderToPng(input.svg, width);
	await ensureDir(png);
	await writeFile(png, buf);
	const derived = await writeDerived(input.svg, png, sizes, ico);
	return { path: png, width: w, height: h, bytes: buf.length, ...derived };
}

/** anchor 枚举 → 在可用区域内的相对位置（0=左/上，0.5=中，1=右/下）。 */
const ANCHORS = {
	"top-left": [0, 0],
	top: [0.5, 0],
	"top-right": [1, 0],
	left: [0, 0.5],
	center: [0.5, 0.5],
	right: [1, 0.5],
	"bottom-left": [0, 1],
	bottom: [0.5, 1],
	"bottom-right": [1, 1]
};

/** fit 枚举 → 缩放策略。 */
const FITS = ["contain", "cover", "fill", "none"];

/**
 * blend 枚举（与 CSS mix-blend-mode 同名）。
 * 实测（2026-11-07）resvg 真的支持它：红底 + 绿层 multiply 像素为 [0,0,0]，
 * 不 blend 时是 [0,255,0]——不是“不报错但无效”。
 */
const BLENDS = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "difference"];

/** 颜色字面量（与 emit 的 COLOR_RE 同口径，只用于判断 under 是不是纯色）。 */
const COLOR_LITERAL_RE = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]+)$/i;

/** canvas 参数：[w, h]。也接受 [w]（只定宽，高度取底图等比）。 */
function normalizeCanvas(canvas) {
	if (canvas === undefined || canvas === null) return undefined;
	if (!Array.isArray(canvas) || canvas.length === 0 || canvas.length > 2) {
		throw new Error(`canvas 必须是 [宽, 高]（收到 ${JSON.stringify(canvas)}）`);
	}
	const out = canvas.map((v) => {
		if (typeof v !== "number" || !Number.isFinite(v) || v < 1 || v > MAX_WIDTH) {
			throw new Error(`canvas 的每项必须是 1–${MAX_WIDTH} 的数字（收到 ${JSON.stringify(v)}）`);
		}
		return Math.round(v);
	});
	return out;
}

/**
 * action=composite：把 over 图层叠到 under 底图上，输出 PNG。
 *
 * 实现：under 尺寸决定画布；两侧都归一成 PNG data URI 后嵌入一个合成 SVG，由 resvg 一次画完。
 *
 * **已从「只有 opacity/scale 两个旋钮」改成正交维度**（2026-11-07）：
 *   位置  anchor(9 种) + padding(px)
 *   尺寸  fit(contain/cover/fill/none) + scale(倍率)
 *   外观  opacity + blend(mix-blend-mode)
 *   变换  rotate(任意角度)
 *   画布  canvas([w,h]) + bg(纯色底)
 * 早期实现把图层强行铺满画布，导致 24×24 图标叠到 400×120 上被拉变形；
 * 后来固定为「居中 contain 不放大」，但那就变成了模板——现在能任意放置与缩放。
 */
async function composite({ under, over, out, opacity, scale, anchor, fit, padding, blend, bg, shadow, canvas, rotate, sizes, ico }) {
	for (const [key, value] of [["under", under], ["over", over], ["out", out]]) {
		if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} is required`);
	}
	assertPngPath(out, "out output path");
	let alpha = 1;
	if (opacity !== undefined && opacity !== null) {
		if (typeof opacity !== "number" || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
			throw new Error(`opacity 必须是 0–1 的数字（收到 ${JSON.stringify(opacity)}）`);
		}
		alpha = opacity;
	}
	// scale：图层相对「充满画布」的倍率（0.05–8）。不给 = 旧行为（contain，不放大）；
	// 给了才允许放大——做 app 图标/logo 放置时，24 小图标必须能放大到画布比例。
	let userScale;
	if (scale !== undefined && scale !== null) {
		if (typeof scale !== "number" || !Number.isFinite(scale) || scale < 0.05 || scale > 8) {
			throw new Error(`scale 必须是 0.05–8 的数字（收到 ${JSON.stringify(scale)}）`);
		}
		userScale = scale;
	}
	// —— 新增维度校验 ——
	const anchorKey = anchor === undefined || anchor === null ? "center" : String(anchor);
	if (ANCHORS[anchorKey] === undefined) {
		throw new Error(`anchor 必须是 ${Object.keys(ANCHORS).join(" / ")}（收到 ${JSON.stringify(anchor)}）`);
	}
	const fitMode = fit === undefined || fit === null ? "contain" : String(fit);
	if (!FITS.includes(fitMode)) throw new Error(`fit 必须是 ${FITS.join(" / ")}（收到 ${JSON.stringify(fit)}）`);
	const blendMode = blend === undefined || blend === null ? "normal" : String(blend);
	if (!BLENDS.includes(blendMode)) throw new Error(`blend 必须是 ${BLENDS.join(" / ")}（收到 ${JSON.stringify(blend)}）`);
	let pad = 0;
	if (padding !== undefined && padding !== null) {
		if (typeof padding !== "number" || !Number.isFinite(padding) || padding < 0 || padding > MAX_WIDTH) {
			throw new Error(`padding 必须是 ≥ 0 的数字（收到 ${JSON.stringify(padding)}）`);
		}
		pad = Math.round(padding);
	}
	let deg = 0;
	if (rotate !== undefined && rotate !== null) {
		if (typeof rotate !== "number" || !Number.isFinite(rotate)) {
			throw new Error(`rotate 必须是数字（角度，收到 ${JSON.stringify(rotate)}）`);
		}
		deg = rotate % 360;
	}
	const canvasSize = normalizeCanvas(canvas);

	// under 可以是**纯色**（不用先做一个 SVG 底图），但需要 canvas 定尺寸
	const underIsColor = typeof under === "string" && !under.includes("<") && !existsSync(under) && COLOR_LITERAL_RE.test(under.trim());
	const base = underIsColor ? null : await loadInput(under, "under");
	const layer = await loadInput(over, "over");

	// 底图：SVG 用它自己的固有尺寸；位图只收 PNG（resvg 能解码，但本模块靠 IHDR 量尺寸）
	let baseBuf = null;
	let baseW = 0;
	let baseH = 0;
	if (base !== null) {
		if (base.kind === "raster") {
			assertPngRaster(base, "under");
			baseBuf = base.buf;
		} else {
			baseBuf = renderToPng(base.svg).buf;
		}
		const size = pngSize(baseBuf);
		baseW = size.width;
		baseH = size.height;
	}
	// 画布尺寸：canvas 显式给定时以它为准；只给 width 时高度跟底图等比
	const canvasW = canvasSize !== undefined ? canvasSize[0] : baseW;
	const canvasH =
		canvasSize !== undefined ? (canvasSize[1] ?? Math.round((canvasSize[0] * baseH) / Math.max(1, baseW))) : baseH;
	if (canvasW <= 0 || canvasH <= 0) {
		throw new Error("算不出画布尺寸：under 是纯色时必须给 canvas=[宽, 高]");
	}

	// 图层：先拿到固有尺寸，再按 contain 缩放（绝不放大），最后居中放置
	let layerBuf;
	let naturalW;
	let naturalH;
	if (layer.kind === "raster") {
		assertPngRaster(layer, "over");
		layerBuf = layer.buf;
		({ width: naturalW, height: naturalH } = pngSize(layerBuf));
	} else {
		const intrinsic = renderToPng(layer.svg);
		naturalW = intrinsic.width;
		naturalH = intrinsic.height;
		layerBuf = intrinsic.buf;
	}
	// 可用区域 = 画布减去 padding；padding 就是把图层推进安全区（app 图标常用）
	const boxX = pad;
	const boxY = pad;
	const boxW = Math.max(1, canvasW - pad * 2);
	const boxH = Math.max(1, canvasH - pad * 2);

	const contain = Math.min(boxW / naturalW, boxH / naturalH);
	const cover = Math.max(boxW / naturalW, boxH / naturalH);
	let layerW;
	let layerH;
	if (fitMode === "fill") {
		// fill：拉伸到可用区域（不保宽高比）——背景图/纹理层用
		layerW = Math.max(1, Math.round(boxW));
		layerH = Math.max(1, Math.round(boxH));
	} else if (fitMode === "none") {
		// none：保持固有尺寸（可配合 scale 手动调）
		layerW = Math.max(1, Math.round(naturalW * (userScale ?? 1)));
		layerH = Math.max(1, Math.round(naturalH * (userScale ?? 1)));
	} else if (fitMode === "cover") {
		layerW = Math.max(1, Math.round(naturalW * cover * (userScale ?? 1)));
		layerH = Math.max(1, Math.round(naturalH * cover * (userScale ?? 1)));
	} else {
		// contain（默认）：不放大，除非显式给了 scale
		const factor = userScale === undefined ? Math.min(1, contain) : contain * userScale;
		layerW = Math.max(1, Math.round(naturalW * factor));
		layerH = Math.max(1, Math.round(naturalH * factor));
	}
	if (layerW !== naturalW || layerH !== naturalH) {
		// SVG 图层按目标宽度重渲染（位图缩放交给 resvg 的 image 采样）
		if (layer.kind !== "raster" && fitMode !== "fill") layerBuf = renderToPng(layer.svg, layerW).buf;
	}
	// 在可用区域内按 anchor 摆放（cover 时图层可能比区域大，居中裁掉）
	const [ax, ay] = ANCHORS[anchorKey];
	const offsetX = Math.round(boxX + (boxW - layerW) * ax);
	const offsetY = Math.round(boxY + (boxH - layerH) * ay);

	// 变换：绕图层中心旋转（rotate 不改变放置点，只改朝向）
	const cx = offsetX + layerW / 2;
	const cy = offsetY + layerH / 2;
	const transform = deg === 0 ? "" : ` transform="rotate(${deg} ${cx} ${cy})"`;
	const blendStyle = blendMode === "normal" ? "" : ` style="mix-blend-mode:${blendMode}"`;

	// 底色：under 是纯色时直接画 rect（不用先做一张底图）
	const baseLayer =
		baseBuf === null
			? `<rect x="0" y="0" width="${canvasW}" height="${canvasH}" fill="${under.trim()}"/>`
			: `<image href="data:image/png;base64,${baseBuf.toString("base64")}" x="0" y="0" width="${canvasW}" height="${canvasH}"/>`;
	const bgLayer =
		baseBuf === null && typeof bg === "string" && bg.trim() !== ""
			? "" // under 已是纯色，bg 无意义
			: typeof bg === "string" && bg.trim() !== ""
				? `<rect x="0" y="0" width="${canvasW}" height="${canvasH}" fill="${bg.trim()}"/>`
				: "";

	/* ---------------------------- 阴影图元 ---------------------------- */
	// 图层可能是一张位图：用 feGaussianBlur(SourceAlpha) + feFlood + feComposite
	// 把图层的 alpha 染成阴影色并模糊——这样任意图层都能加任意颜色的投影。
	// （resvg 的 feDropShadow 无效，实测；这条链路是验证过可用的替代）
	const { list: shadowList } = parseShadows(shadow);
	const shadowDefs = [];
	const shadowLayers = [];
	shadowList.filter((s) => !s.inset).forEach((sh, i) => {
		const id = `ak-lsh-${i}`;
		shadowDefs.push(
			`<filter id="${id}" x="-120%" y="-120%" width="340%" height="340%">` +
				`<feGaussianBlur in="SourceAlpha" stdDeviation="${cssBlurToSigma(sh.blur ?? 0)}" result="b"/>` +
				`<feFlood flood-color="${sh.color}"/>` +
				`<feComposite in2="b" operator="in"/>` +
				`</filter>`
		);
		shadowLayers.push(
			`<image href="data:image/png;base64,${layerBuf.toString("base64")}" x="${offsetX + (sh.dx ?? 0)}" y="${offsetY + (sh.dy ?? 0)}" width="${layerW}" height="${layerH}" filter="url(#${id})"/>`
		);
	});
	const shadowDefsBlock = shadowDefs.length === 0 ? "" : `<defs>${shadowDefs.join("")}</defs>`;

	const clip = fitMode === "cover" ? `<clipPath id="ak-c"><rect x="0" y="0" width="${canvasW}" height="${canvasH}"/></clipPath>` : "";
	const clipAttr = fitMode === "cover" ? ` clip-path="url(#ak-c)"` : "";
	// SVG <image> 默认 preserveAspectRatio="xMidYMid meet"——**会保持宽高比**，
	// 即使给了不等比例的 width/height 也不拉伸。所以 fit=fill 必须显式 none，
	// 否则「拉满」是假的（实测：传入 200×200 实际只画出 200×100）。
	const stretchAttr = fitMode === "fill" ? ` preserveAspectRatio="none"` : "";
	const composed =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">` +
		(clip === "" ? "" : `<defs>${clip}</defs>`) +
		shadowDefsBlock +
		baseLayer +
		bgLayer +
		// 阴影块放在图层之下、背景之上
		shadowLayers.join("") +
		`<image${stretchAttr}${clipAttr} href="data:image/png;base64,${layerBuf.toString("base64")}" x="${offsetX}" y="${offsetY}" width="${layerW}" height="${layerH}"` +
		(alpha < 1 ? ` opacity="${alpha}"` : "") +
		transform +
		blendStyle +
		`/></svg>`;
	const { buf } = renderToPng(composed);
	await ensureDir(out);
	await writeFile(out, buf);
	// 多尺寸/ico 直接从合成 SVG 重渲染（比缩 PNG 质量好）；app 图标一次出全套
	const derived = await writeDerived(composed, out, sizes, ico);
	// 把实际生效的维度回填：调用方要能确认「我传的 anchor 真的生效了」，
	// 而不是像旧版那样传了未暴露的参数被静默忽略。
	return {
		path: out,
		width: canvasW,
		height: canvasH,
		bytes: buf.length,
		anchor: anchorKey,
		fit: fitMode,
		...(pad > 0 ? { padding: pad } : {}),
		...(deg !== 0 ? { rotate: deg } : {}),
		...(blendMode !== "normal" ? { blend: blendMode } : {}),
		...(alpha < 1 ? { opacity: alpha } : {}),
		layer: { width: layerW, height: layerH, x: offsetX, y: offsetY },
		...derived
	};
}

/** composite 的位图只收 PNG：本模块用 IHDR 量尺寸，JPEG/WebP 量不到。 */
function assertPngRaster(input, label) {
	if (!input.path.toLowerCase().endsWith(".png")) {
		throw new Error(`${label}: composite 的位图只支持 .png（收到 ${extname(input.path)}）；先用图像工具转成 PNG`);
	}
}

/** ICO 内嵌帧的尺寸集（Windows 图标标准 6 档）。 */
const ICO_SIZES = [16, 32, 48, 64, 128, 256];

/** sizes 校验：数组、每项整数 8–4096、去重、最多 12 个。 */
function normalizeSizes(sizes) {
	if (sizes === undefined || sizes === null) return [];
	if (!Array.isArray(sizes)) throw new Error(`sizes 必须是数字数组（收到 ${JSON.stringify(sizes)}）`);
	const out = [];
	for (const raw of sizes) {
		if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 8 || raw > 4096) {
			throw new Error(`sizes 里的尺寸必须是 8–4096 的数字（收到 ${JSON.stringify(raw)}）`);
		}
		const n = Math.round(raw);
		if (!out.includes(n)) out.push(n);
	}
	if (out.length > 12) throw new Error(`sizes 最多 12 个尺寸（收到 ${out.length} 个）`);
	return out;
}

/** 多尺寸输出命名：app-1024.png 的变体是 app-1024-512.png？不——档位名即尺寸：app-512.png。 */
function withSizeSuffix(file, size) {
	const ext = extname(file);
	const stem = ext === "" ? file : file.slice(0, file.length - ext.length);
	return `${stem}-${size}${ext === "" ? ".png" : ext}`;
}

function icoPathOf(png) {
	const ext = extname(png);
	return `${ext === "" ? png : png.slice(0, png.length - ext.length)}.ico`;
}

/**
 * PNG 帧 → ICO 容器（不引入图像库）：ICONDIR + ICONDIRENTRY[] + PNG 数据。
 * Vista 以后的 .ico 允许直接嵌 PNG（Windows 10/11 原生支持），不需要 BMP 格式。
 */
function pngIco(frames) {
	const count = frames.length;
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0); // reserved
	header.writeUInt16LE(1, 2); // type = icon
	header.writeUInt16LE(count, 4);
	const entries = Buffer.alloc(16 * count);
	let offset = 6 + 16 * count;
	frames.forEach((frame, i) => {
		const e = i * 16;
		entries.writeUInt8(frame.width >= 256 ? 0 : frame.width, e);
		entries.writeUInt8(frame.height >= 256 ? 0 : frame.height, e + 1);
		entries.writeUInt8(0, e + 2); // colorCount
		entries.writeUInt8(0, e + 3); // reserved
		entries.writeUInt16LE(1, e + 4); // planes
		entries.writeUInt16LE(32, e + 6); // bitCount
		entries.writeUInt32LE(frame.buf.length, e + 8);
		entries.writeUInt32LE(offset, e + 12);
		offset += frame.buf.length;
	});
	return Buffer.concat([header, entries, ...frames.map((f) => f.buf)]);
}

/** 写多尺寸变体 + 可选 .ico，返回附加字段（无变体时返回空对象）。 */
async function writeDerived(svg, png, sizes, ico) {
	const extras = {};
	const list = normalizeSizes(sizes);
	if (list.length > 0) {
		const variants = [];
		for (const size of list) {
			const { buf, width, height } = renderToPng(svg, size);
			const file = withSizeSuffix(png, size);
			await ensureDir(file);
			await writeFile(file, buf);
			variants.push({ path: file, width, height, bytes: buf.length });
		}
		extras.variants = variants;
	}
	if (ico === true) {
		const frames = ICO_SIZES.map((size) => {
			const { buf, width, height } = renderToPng(svg, size);
			return { buf, width, height };
		});
		const file = icoPathOf(png);
		await ensureDir(file);
		await writeFile(file, pngIco(frames));
		extras.ico = file;
	}
	return extras;
}

/** 供工具层读产物尺寸（失败返回 null，不抛——报告里不该因为量不到尺寸就失败）。 */
function sizeOf(file) {
	try {
		return pngSize(readFileSync(file));
	} catch {
		return null;
	}
}

export { composite, pngSize, renderSvg, sizeOf };
