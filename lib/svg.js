/**
 * svg.js — IconNode ⇄ SVG 标记的序列化/解析/体检。
 *
 * parseIconNodes 是 Colibri js/ui.js 同名函数的语义级移植（兼容性契约）：
 * morphicons 只认 path/line/circle/ellipse/rect/polyline/polygon 七种基本形，
 * 含 <g>/transform/未识别标签即不兼容。两边必须保持判定一致，
 * 否则「体检通过」到了项目里照样降级静态换图。
 */
import { getIcon, shapeSummary } from "./icondb.js";
import { parseGradientStops } from "./icon-render.js";
import { adaptersSync } from "./morphcore.js";

/** IconNode（[tag, attrs][]）→ 内联 SVG 字符串（Colibri ICONS 字典同格式）。
 * extraAttrs 会合并到每个元素上（覆盖同名属性）——colibri/echo 的 inner 嵌在外层 SVG 里，
 * 不能靠 `<g>` 分组表达 duotone 的填充层（parseIconNodes 不认 <g>），只能下推到元素属性。 */
function iconToInnerSvg(node, extraAttrs) {
	const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	const extra = extraAttrs ? Object.entries(extraAttrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join("") : "";
	return node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(" ")}${extra}/>`).join("");
}

/**
 * 根层要控制的画笔属性。包数据（尤其 tabler）把 stroke-width/linecap/linejoin
 * 写在了每个 path 上，会**覆盖**根 <svg>/<g> 的同名属性——实测 tabler:search 把
 * strokeWidth 从 1 改到 4，渲染像素一模一样（ratio 1.00），参数形同虚设。
 * 所以凡是由本模块控制这些属性时，先把元素上的同名属性剥掉。
 * 默认值与包数据一致（2 / round / round），所以剥掉不改变默认观感。
 */
const PAINT_KEYS = ["stroke-width", "stroke-linecap", "stroke-linejoin"];

function stripPaint(node) {
	return node.map(([tag, attrs]) => {
		const next = { ...attrs };
		for (const key of PAINT_KEYS) delete next[key];
		return [tag, next];
	});
}

/** IconNode → 完整 <svg> 标记（Colibri UI.svg 同构：24 视口 stroke 风格）。 */
function renderSvg(node, opts = {}) {
	const size = opts.size ?? 24;
	const strokeWidth = opts.strokeWidth ?? 2;
	const color = opts.color ?? "currentColor";
	const linecap = opts.linecap ?? "round";
	const linejoin = opts.linejoin ?? "round";
	const cls = opts.className ? ` class="${opts.className}"` : "";
	const inner = iconToInnerSvg(stripPaint(node));
	// fill 风格图标（品牌/实心包数据）：根壳不能再继承 stroke（会多圈描边），
	// 改用 color 属性让内部 fill="currentColor" 仍能随 color 参数变色。
	const fillDrawn = node.some(([, attrs]) => typeof attrs?.fill === "string" && attrs.fill !== "none");
	const paint = fillDrawn
		? `fill="none" stroke="none" color="${color}"`
		: `fill="none" stroke="${color}" color="${color}" stroke-width="${strokeWidth}" stroke-linecap="${linecap}" stroke-linejoin="${linejoin}"`;
	return (
		`<svg${cls} xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
		`${paint}>${inner}</svg>`
	);
}

/**
 * 多层渲染（duotone）：base 作低透明度填充层（副色），accent 作线稿层（主色）。
 * Phosphor 式 duotone = 实心形 20% 透明度 + 线性轮廓；tabler 有 1057 对 −filled/线性双胞胎，
 * 不需要额外装一个 duotone 数据集（省 1.5–2MB 包体积）。
 */
function renderSvgLayers({ base, accent, size = 24, strokeWidth = 2, color = "currentColor", secondaryOpacity = 0.2, linecap = "round", linejoin = "round", className }) {
	const cls = className ? ` class="${className}"` : "";
	const under = `<g fill="${color}" fill-opacity="${secondaryOpacity}" stroke="none">${iconToInnerSvg(stripPaint(base))}</g>`;
	const over = `<g fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="${linecap}" stroke-linejoin="${linejoin}">${iconToInnerSvg(stripPaint(accent))}</g>`;
	return (
		`<svg${cls} xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" color="${color}">` +
		`${under}${over}</svg>`
	);
}

/**
 * Colibri parseIconNodes 的移植（判定语义逐条对齐）：
 * 内联 SVG 字符串 → IconNode；不兼容（g/transform/未识别标签/空）返回 null。
 */
function parseIconNodes(inner) {
	const src = String(inner ?? "");
	if (!src || /<g[\s>]|transform=/.test(src)) return null;
	const tagRe = /<(path|line|circle|ellipse|rect|polyline|polygon)\b([^>]*?)\/>/g;
	if (/<[a-zA-Z/]/.test(src.replace(tagRe, ""))) return null; // 未识别标签残留（配对标签/text 等）
	const out = [];
	let m;
	while ((m = tagRe.exec(src))) {
		const attrs = {};
		const attrRe = /([a-zA-Z][\w-]*)="([^"]*)"/g;
		let a;
		while ((a = attrRe.exec(m[2]))) attrs[a[1]] = a[2];
		out.push([m[1], attrs]);
	}
	return out.length ? out : null;
}

/** 宽松取「图标内容」：接受内联串或完整 <svg> 标记（剥壳取 inner + viewBox）。 */
function extractInner(input) {
	const src = String(input ?? "").trim();
	if (src === "") return { inner: "", viewBox: undefined };
	const svgOpen = src.match(/<svg\b[^>]*>/i);
	if (svgOpen) {
		const close = src.toLowerCase().lastIndexOf("</svg>");
		const start = src.indexOf(svgOpen[0]) + svgOpen[0].length;
		const end = close === -1 ? src.length : close;
		const vb = svgOpen[0].match(/viewBox\s*=\s*"([^"]*)"/i);
		return { inner: src.slice(start, end).trim(), viewBox: vb ? vb[1] : undefined };
	}
	return { inner: src, viewBox: undefined };
}

/** 明确的绝对坐标几何属性（path 的 d 串不查——曲线控制点合法出界，且
 *  相对增量的负数不是坐标；v0.3.0 修复误报）。 */
const GEO_NUM_ATTRS = new Set(["x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height"]);

/** 属性级网格检查：只查明确的几何数值属性，命中一个即返回描述。 */
function offGridAttr(node) {
	for (const [tag, attrs] of node) {
		for (const [key, raw] of Object.entries(attrs)) {
			if (key === "points") {
				for (const num of String(raw).split(/[\s,]+/).map(Number)) {
					if (Number.isFinite(num) && (num > 26 || num < -2)) return `${tag}.points=${num}`;
				}
				continue;
			}
			if (!GEO_NUM_ATTRS.has(key)) continue;
			const v = Number(raw);
			if (Number.isFinite(v) && (v > 26 || v < -2)) return `${tag}.${key}=${v}`;
		}
	}
	return undefined;
}

/**
 * 形变兼容性体检（v0.3.0 双层判定）：
 *   契约层（ok/parsed）——parseIconNodes 移植，与 Colibri/Echo 运行时管线逐字对齐；
 *   引擎层（engine）——morphicons 2.x 官方 svgToIcon 权威判定（adapters 可用时），
 *   fill 标记按 region 可形变、transform 烘焙进几何、viewBox 自动 re-grid（fitIcon）。
 * 输入可为内联串 / 完整 svg 标记 / IconNode 数组 / lucide 图标名。
 */
function checkIcon(input, opts = {}) {
	const result = { ok: false, parsed: false, nodeCount: 0, shapes: "", issues: [], warnings: [] };
	let inner;
	let nodeInput = null;
	let sourceMarkup = null; // 引擎层判定用的原始标记（含或不含 <svg> 壳）
	let viewBox;

	if (Array.isArray(input)) {
		nodeInput = input;
		inner = iconToInnerSvg(input);
	} else if (typeof input === "string" && opts.nameLookup !== false && !input.includes("<")) {
		const icon = getIcon(input);
		if (icon === undefined) {
			result.issues.push(`unknown lucide icon name "${input}"`);
			return result;
		}
		result.name = icon.name;
		nodeInput = icon.node;
		inner = iconToInnerSvg(icon.node);
	} else {
		const extracted = extractInner(input);
		inner = extracted.inner;
		viewBox = extracted.viewBox;
		sourceMarkup = String(input);
		if (viewBox !== undefined && viewBox.replace(/\s+/g, "") !== "002424") {
			// 这是**阻塞项**而非提醒：项目管线（UI.svg / morphTo）按 24 网格取数，非 24 网格
			// 直接接线会裁切/错位。ok=true 会让模型以为「体检通过可以接了」，与产品承诺相反。
			result.issues.push(`viewBox "${viewBox}" 不是 0 0 24 24 —— 项目管线要求 24 网格：先归一化再接线（morph preview / design_render 会自动 re-grid，UI.svg / morphTo 不会）`);
		}
	}
	if (inner === "") {
		result.issues.push("empty icon content");
		return result;
	}

	// 契约层逐坑诊断（顺序即优先级）：g / transform / 未识别标签 / 空
	const src = inner;
	if (/<g[\s>]/i.test(src)) result.issues.push("含 <g> 分组 —— morphicons 只支持扁平结构");
	if (/transform\s*=/i.test(src)) result.issues.push("含 transform 属性 —— 形变引擎不认局部坐标系");
	const tagRe = /<(path|line|circle|ellipse|rect|polyline|polygon)\b[^>]*?\/>/gi;
	const residual = src.replace(tagRe, "");
	const unknown = residual.match(/<([a-zA-Z][\w:-]*)/);
	if (unknown) result.issues.push(`未识别元素 <${unknown[1]}>（配对标签/clipPath/mask/text 等均不兼容）`);
	if (/fill\s*=\s*"(?!none)[^"]*"/i.test(src)) result.warnings.push('含非 none 的 fill —— morphicons 2.x 可形变（fill 走 region），但 Colibri/Echo 的 UI.svg 仍是 stroke 渲染，接线前确认项目支持');
	if (/style\s*=/i.test(src)) result.warnings.push("含 style 内联样式 —— 建议转为独立属性");

	const node = nodeInput !== null && result.issues.length === 0 ? nodeInput : parseIconNodes(inner);
	if (node === null || node.length === 0) {
		if (result.issues.length === 0) result.issues.push("解析不出任何基本形节点");
		return withEngine(result, sourceMarkup, inner, viewBox);
	}
	result.parsed = true;
	result.nodeCount = node.length;
	result.shapes = shapeSummary(node);
	result.node = node;

	// 属性级网格检查（v0.3.0：只查明确几何属性，修掉 d 串相对增量的误报）。
	// 与 viewBox 同理：坐标超 24 就是接不进管线的数据，算 issue。
	const offGrid = offGridAttr(node);
	if (offGrid !== undefined) {
		result.issues.push(`几何属性超出 24×24 网格（${offGrid}）—— 先归一化到 24 网格再接线（path 曲线控制点出界不查，属合法）`);
	}
	result.ok = result.issues.length === 0;

	return withEngine(result, sourceMarkup, inner, viewBox);
}

/** 引擎层判定：svgToIcon 权威裁决（adapters 未就绪时静默跳过）。 */
function withEngine(result, sourceMarkup, inner, viewBox) {
	const adapters = adaptersSync();
	if (adapters === undefined) return result;
	const markup =
		sourceMarkup !== null && sourceMarkup.includes("<svg")
			? sourceMarkup
			: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox ?? "0 0 24 24"}" fill="none" stroke="currentColor" stroke-width="2">${inner}</svg>`;
	try {
		adapters.svgToIcon(markup); // 可能抛：引擎层拒绝本身就是判定结果
		// 只有源 viewBox 不是 24 网格时才报「已 re-grid」——否则标准 24 网格图标的体检
		// 文本也会写「viewBox 已自动 re-grid」，让人以为发生过转换（实测踩过）。
		// 注意不能用返回值类型判断：stroke 型图标本来就会返回规范化 path 串。
		const needsRegrid = viewBox !== undefined && viewBox.replace(/\s+/g, "") !== "002424";
		result.engine = needsRegrid ? { accepted: true, regridded: true } : { accepted: true };
	} catch (error) {
		result.engine = { accepted: false, reason: String(error?.message ?? error).replace(/^morphicons:\s*/, "") };
	}
	return result;
}

/** 稳定短哈希（内容 → 36 进制字符串）。用于让内联 SVG 的 defs id 不碰撞。
 * 不用随机数：同样的输入必须产出同样的字节（确定性是测试契约）。 */
function hash36(str) {
	let h = 2166136261;
	for (let i = 0; i < str.length; i += 1) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(36);
}

/** #rgb / #rrggbb → {r,g,b}；其它写法（命名色/rgb()）返回 null（渐变只接受 hex）。 */
function hexOf(value) {
	const text = String(value ?? "").trim();
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
	if (short !== null) return { r: parseInt(short[1] + short[1], 16), g: parseInt(short[2] + short[2], 16), b: parseInt(short[3] + short[3], 16) };
	const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(text);
	if (full !== null) return { r: parseInt(full[1], 16), g: parseInt(full[2], 16), b: parseInt(full[3], 16) };
	return null;
}

/** 亮度偏移：positive 向白，negative 向黑（0–1）。用于渐变末色，免手填两个色。 */
function shiftColor(hex, amount) {
	const c = hexOf(hex);
	if (c === null) return null;
	const mix = (v) => {
		const target = amount >= 0 ? 255 : 0;
		return Math.round(v + (target - v) * Math.abs(amount));
	};
	const hex2 = (v) => v.toString(16).padStart(2, "0");
	return `#${hex2(mix(c.r))}${hex2(mix(c.g))}${hex2(mix(c.b))}`.toUpperCase();
}

/**
 * 容器型图标：glyph 装进底色块里（badge = 圆角方，knockout = 正圆）。
 *
 * **清晰度两个坑（2026-11-07 实测，24px 下字形糊成一团）：**
 *   1. 填充字形被「又填又描」：包数据的 path 自带 fill="currentColor"，外层又给了
 *      stroke，于是字形外圈多糊一层。填充型只能填、不能描。
 *   2. 描边没按 scale 补偿：字形被 scale(0.42) 缩小后，stroke-width 跟着缩，
 *      24px 图标里的实际描边只有 0.92px（<1 像素必然发灰）。所以 strokeWidth 要 /s。
 * 另外 inset 从 0.29 收到 0.24：字形大 1.4 个单位，可读像素多一层。
 */
function renderSvgChip({ node, kind = "badge", size = 24, color = "currentColor", glyphColor = "#FFFFFF", inset = 0.24, strokeWidth = 1.8, radiusRatio = 0.3, linecap = "round", linejoin = "round", className }) {
	const cls = className ? ` class="${className}"` : "";
	const s = Math.round((1 - inset * 2) * 1000) / 1000;
	const offset = 12 - (24 * s) / 2;
	// 容器铺满 24 网格（图标场景里留 0.8 内缩会让它看起来像没对齐的贴纸）
	const chip =
		kind === "knockout"
			? `<circle cx="12" cy="12" r="12" fill="${color}"/>`
			: `<rect x="0" y="0" width="24" height="24" rx="${Math.round(24 * radiusRatio * 100) / 100}" fill="${color}"/>`;
	const stripped = stripPaint(node);
	const fillDrawn = node.some(([, attrs]) => typeof attrs?.fill === "string" && attrs.fill !== "none");
	// 填充字形：只填不描（描边会在字形外圈糊一层）；描边字形：描边宽度按 scale 反向补偿
	const paint = fillDrawn
		? `fill="${glyphColor}" stroke="none"`
		: `fill="none" stroke="${glyphColor}" stroke-width="${Math.round((strokeWidth / s) * 1000) / 1000}"`;
	// color= 让残留的 currentColor（如果有）也反白
	const glyph = `<g transform="translate(${offset} ${offset}) scale(${s})" color="${glyphColor}"><g ${paint} stroke-linecap="${linecap}" stroke-linejoin="${linejoin}">${iconToInnerSvg(stripped)}</g></g>`;
	return `<svg${cls} xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${chip}${glyph}</svg>`;
}

/**
 * 渐变描边图标：color 作起色，末色按亮度偏移自动导出（可传 color2 覆盖）。
 * 非 hex 颜色无法算末色 → 返回 null，调用方回退实色并提示。
 */
function renderSvgGradient({ node, size = 24, color = "currentColor", color2, strokeWidth = 2.2, linecap = "round", linejoin = "round", className }) {
	const end = color2 ?? shiftColor(color, -0.28);
	if (hexOf(color) === null || end === null || hexOf(end) === null) return null;
	const cls = className ? ` class="${className}"` : "";
	return (
		`<svg${cls} xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">` +
		`<defs><linearGradient id="ak-grad" x1="0" y1="0" x2="1" y2="1">` +
		`<stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs>` +
		`<g fill="none" stroke="url(#ak-grad)" stroke-width="${strokeWidth}" stroke-linecap="${linecap}" stroke-linejoin="${linejoin}">${iconToInnerSvg(stripPaint(node))}</g></svg>`
	);
}

/**
 * 正交维度合成器：把图标视觉语言拆成可任意组合的轴，而不是互斥的 style 枚举。
 *
 * 图层顺序（从下到上）：容器底 → 双色底图 → 字形（渐变或实色）
 * 任一轴不传 = 不启用；全部不传 = 纯线性图标。
 *
 * @param {object} o
 * @param {Array} o.node            字形（IconNode）
 * @param {"stroke"|"fill"|"both"} [o.paint="stroke"]  绘法（both = 填充+描边共存）
 * @param {number} [o.strokeWidth=2]
 * @param {"round"|"butt"|"square"} [o.caps="round"]    线端（自动配对 join）
 * @param {"round"|"miter"|"bevel"} [o.join]             显式转角（默认跟 caps）
 * @param {null|{kind:"rounded"|"circle"|"squircle", radius?:number, inset?:number, color?:string}} [o.container]
 * @param {null|{kind:"linear"|"radial", color:string, color2?:string, angle?:number}} [o.gradient]
 * @param {null|{node:Array, opacity?:number}} [o.duo]   双色底层（需填充孪生体）
 * @param {number} [o.size=24]
 * @param {string} [o.color="currentColor"]
 * @param {string} [o.glyphColor]  容器内字形颜色（默认自动取反）
 * @param {string} [o.className]
 * @returns {string|null} 渐变颜色不可解析时返回 null（需 hex）
 */
/**
 * 自绘路径校验：只接受 SVG path 指令 + 数字 + 空白/分隔符。
 *
 * 为什么必须做白名单而不是简单转义：path 数据会直接进 `d="..."` 属性，
 * 引号和尖括号能直接破出属性、注入标签。白名单比黑名单可靠。
 * 合法字符：命令字母 MmZzLlHhVvCcSsQqTtAa、数字、. , - + e E、空白。
 */
const PATH_RE = /^[MmZzLlHhVvCcSsQqTtAa\d\s,.+\-eE]*$/;

/** 归一化一条自绘路径；非法返回 null。空串、不以 M/m 开头都算非法。 */
export function normalizePathData(raw) {
	if (typeof raw !== "string") return null;
	const d = raw.trim();
	if (d === "" || !/^[Mm]/.test(d)) return null;
	if (!PATH_RE.test(d)) return null;
	// 字符数上限：防止一条参数把整个 SVG 撑爆（24 网格下 4000 字符已经极复杂）
	if (d.length > 4000) return null;
	return d;
}

/** 把一条 path 包成与库图标同构的 IconNode，这样现有能力（容器/阴影/渐变/遮罩/旋转）全部直接生效。 */
export const pathNode = (d) => [["path", { d }]];

/** 叠加/减形图层的合法区间（与字符串时代保持一致）。 */
export const SHAPE_LIMITS = { scale: [0.02, 4], offset: 48, weight: [0.1, 12], rotate: [-360, 360] };

/**
 * 归一化一个 shapes 条目（对象形式）。非法返回 null，调用方跳过该条。
 *
 *   语法：{ name, scale?, dx?, dy?, rotate?, color?, weight?, subtract? }
 *
 * **为什么从字符串改成对象**：字符串时代语法已经挤到
 * `tree@0.5+3,3:#22C55E!2.4` 四段，再加旋转就只能发明更多符号。
 * 对象形式字段自解释、加属性不用改语法，代价是 schema 贵一点。
 *
 * 字段存在的理由（每个都是踩出来的）：
 *   dx/dy     之前只能居中，而中心通常已被字形占住 → 中孔永远被盖住、毫无意义
 *   color     之前全部共用字形色 → 异色角标只能绕成「容器当底」
 *   weight    插画靠粗轮廓+细细节拉层次，全图一个线宽只能得图标
 *   rotate    场景组合里几乎一定需要（歪放的树、斜飞的鸟）
 *   subtract  减法只能是「在卡片上挖洞」，不应切割文字（文字画在 mask 之外）
 */
export function normalizeShape(raw) {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
	// name 与 path 二选一：给了 path 就不需要图标名（自绘图层）
	const path = normalizePathData(raw.path);
	const name = typeof raw.name === "string" ? raw.name.trim() : "";
	if (name === "" && path === null) return null;
	// 缺省 → 用 dflt；给了但非法 → 返回 INVALID（不能把 null 当非法，否则可选项永远被拒）
	const INVALID = Symbol("invalid");
	const num = (v, [lo, hi], dflt) => {
		if (v === undefined || v === null) return dflt;
		const n = Number(v);
		return Number.isFinite(n) && n >= lo && n <= hi ? n : INVALID;
	};
	const scale = num(raw.scale, SHAPE_LIMITS.scale, 1);
	const dx = num(raw.dx, [-SHAPE_LIMITS.offset, SHAPE_LIMITS.offset], 0);
	const dy = num(raw.dy, [-SHAPE_LIMITS.offset, SHAPE_LIMITS.offset], 0);
	const rotate = num(raw.rotate, SHAPE_LIMITS.rotate, 0);
	const weight = num(raw.weight, SHAPE_LIMITS.weight, null);
	if ([scale, dx, dy, rotate, weight].some((v) => v === INVALID)) return null;
	let color = null;
	if (typeof raw.color === "string" && raw.color.trim() !== "") {
		const c = raw.color.trim();
		// 只做注入安全校验，不强制 hex（rgba()/命名色都行）
		if (!/^[#a-zA-Z0-9(),.%\s/+-]+$/.test(c)) return null;
		color = c;
	}
	// 每层独立渐变：真实品牌美术几乎每层都有自己的渐变（Firefox 火焰 5 层全帯渐变）。
	// 给了 stops 就以渐变填充该层，不再用纯色。
	// fill-rule：evenodd 让「同一路径里的多个子路径」变成外套内挖的环/中孔，
	// 不用再靠 mask 做减法。默认 nonzero（同向子路径会填实）。
	let fillRule = null;
	if (raw.fillRule !== undefined && raw.fillRule !== null) {
		if (raw.fillRule !== "evenodd" && raw.fillRule !== "nonzero") return null;
		fillRule = raw.fillRule;
	}
	const stops = parseGradientStops(raw.stops);
	if (raw.stops !== undefined && raw.stops !== null && stops === null) return null;
	const gradient = raw.gradient === "radial" ? "radial" : "linear";
	const angle = num(raw.angle, [-360, 360], 45);
	if (angle === INVALID) return null;
	return { name, path, scale, dx, dy, rotate, weight, color, stops, gradient, angle, fillRule, subtract: raw.subtract === true };
}

function renderComposed(o = {}) {
	const size = o.size ?? 24;
	const color = o.color ?? "currentColor";
	const paint = o.paint ?? "stroke";
	const strokeWidth = o.strokeWidth ?? 2;
	const cap = o.caps ?? "round";
	const defaultJoin = { round: "round", butt: "miter", square: "miter" }[cap] ?? "round";
	const join = o.join ?? defaultJoin;
	const cls = o.className ? ` class="${o.className}"` : "";
	const container = o.container ?? null;
	const gradient = o.gradient ?? null;
	const duo = o.duo ?? null;

	// 渐变：颜色必须可算（hex）；算不出就返回 null，让调用方回退实色并提示
	let strokePaint = color;
	let gradDef = "";
	if (gradient !== null) {
		// 两条路径：
		//   ① 传了 stops（N 停靠点）→ 直接用，颜色不限 hex；
		//   ② 只传 color/color2（2 停靠点）→ 末色可自动推，但要求 hex。
		// 区分开是因为自动推末色需要 hex；传了 stops 则完全由调用方决定，不该示范区标准。
		const explicitStops = Array.isArray(gradient.stops) && gradient.stops.length >= 2 ? gradient.stops : null;
		let stops;
		if (explicitStops !== null) {
			stops = explicitStops;
		} else {
			const end = gradient.color2 ?? shiftColor(gradient.color ?? color, -0.28);
			const start = gradient.color ?? color;
			if (hexOf(start) === null || end === null || hexOf(end) === null) return null;
			stops = [{ color: start, offset: 0 }, { color: end, offset: 1 }];
		}
		const start = stops[0].color;
		const end = stops[stops.length - 1].color;
		// 渐变 id 必须按内容唯一：同一页面内联多个图标时，重复的 id 会让所有
		// 渐变引用同一个定义 → **串色**（实测：蓝色的图标渲染成粉红，因为它们
		// 都引用了文档里第一个 id="ak-g"）。用内容哈希而不是随机数，保持确定性。
		// id 要涵盖**所有**停靠点：只哈希首末色会让「同首末、中间不同」的两个多段渐变撞 id。
		const id = `ak-g-${hash36(`${stops.map((s) => `${s.color}@${s.offset}`).join(",")}|${gradient.kind ?? "linear"}|${gradient.angle ?? 45}`)}`;
		const a = ((gradient.angle ?? 45) * Math.PI) / 180;
		// 角度 → 单位向量（0° 向上，顺时针）
		const dx = Math.sin(a);
		const dy = -Math.cos(a);
		const stopMarkup = stops.map((s) => `<stop offset="${s.offset}" stop-color="${s.color}"/>`).join("");
		gradDef =
			gradient.kind === "radial"
				? `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.6">${stopMarkup}</radialGradient>`
				: `<linearGradient id="${id}" x1="${(0.5 - dx / 2).toFixed(3)}" y1="${(0.5 - dy / 2).toFixed(3)}" x2="${(0.5 + dx / 2).toFixed(3)}" y2="${(0.5 + dy / 2).toFixed(3)}">${stopMarkup}</linearGradient>`;
		strokePaint = `url(#${id})`;
	}

	// **渐变的作用对象**：
	//   无容器 → 渐变画在字形上（线稿渐变图标）
	//   有容器 → 渐变画在**容器底**上，字形用 glyphColor 反白
	// 后者才是现实里的主流（iOS app 图标、Win11 磁贴、拟物按钮都是「渐变底 + 白字」）。
	// 旧实现一律把渐变给字形，container+gradient 出来是「实色底 + 渐变字」——完全不对。
	const gradientOnContainer = container !== null && gradient !== null;
	const glyphColor =
		container === null ? strokePaint : (container.glyphColor ?? "#FFFFFF");

	// 填充型字形（包数据 path 自带 fill）：不能拿 stroke 去“描”它——
	// 外圈会多糊一层，24px 下直接糊成色块（2026-11-07 实测修过的 bug）。
	// 所以 paint=stroke 遇到填充型字形时自动按 fill 处理；要真的「又填又描」请显式传 both。
	const nodeFillDrawn = (o.node ?? []).some(([, attrs]) => typeof attrs?.fill === "string" && attrs.fill !== "none");
	const effectivePaint = nodeFillDrawn && paint === "stroke" ? "fill" : paint;

	// 字形画笔：stroke / fill / both 三选一；每个属性只出现一次
	const wantStroke = effectivePaint === "stroke" || effectivePaint === "both";
	const wantFill = effectivePaint === "fill" || effectivePaint === "both";
	// 虚线：stroke-dasharray 是通用图元（技术图/蓝图/草图/待定区域都用它），
	// 不是某种风格。数组数值按 24 网格单位。
	const dashArray = Array.isArray(o.dash) && o.dash.length > 0 ? o.dash.filter((v) => Number.isFinite(v) && v >= 0).join(" ") : "";
	// fill-rule：evenodd 是「一条路径里画环/中孔」的唯一办法（实现在 resvg 上验过：
	// 外圆+内圆同向时 nonzero 中心 255、evenodd 中心 0）。
	const fillRuleAttr = o.fillRule === "evenodd" || o.fillRule === "nonzero" ? [`fill-rule="${o.fillRule}"`, `clip-rule="${o.fillRule}"`] : [];
	const glyphAttrs = [
		wantFill ? `fill="${glyphColor}"` : `fill="none"`,
		wantStroke ? `stroke="${glyphColor}"` : `stroke="none"`,
		...(wantStroke ? [`stroke-width="${strokeWidth}"`, `stroke-linecap="${cap}"`, `stroke-linejoin="${join}"`] : []),
		...(wantStroke && dashArray !== "" ? [`stroke-dasharray="${dashArray}"`] : []),
		...fillRuleAttr,
		`color="${glyphColor}"`
	];

	const glyphInner = iconToInnerSvg(stripPaint(o.node ?? []));
	const layers = [];
	// 图标内文字（字母标）：存在时**取代字形**，而不是叠在上面。
	// 典型需求是「圆角方块里写 7z / AI / K」，本质上是用文字当图形。
	// 居中用 dominant-baseline="central"——实测 resvg 支持且准确（cy 11.93 vs 目标 12），
	// middle 会偏 0.9 单位，所以不用它。
	const hasText = o.text !== null && o.text !== undefined && typeof o.text.content === "string" && o.text.content !== "";
	// 阴影图元：先算好「外轮廓」能画成什么，后面复用它生成阴影副本。
	// 这是把深度效果做成**能力**而不是风格的关键：只要能给任意轮廓加阴影，
	// 高程、卡片、浮层、按奥、浮雕、双光源都是调用方自己拼出来的。
	const shadowList = Array.isArray(o.shadows) ? o.shadows : [];
	/** 用指定颜色画出「最外层轮廓」——容器存在时是容器，否则是字形。 */
	const silhouette = (fillColor) => {
		if (container === null) return `<g ${glyphAttrs.map((a) => (/^(fill|stroke|color)=/.test(a) ? a.replace(/="[^"]*"/, `="${fillColor}"`) : a)).join(" ")}>${glyphInner}</g>`;
		const inset = container.inset ?? 0.24;
		const s = Math.round((1 - inset * 2) * 1000) / 1000;
		if (container.kind === "circle") return `<circle cx="12" cy="12" r="12" fill="${fillColor}"/>`;
		if (container.kind === "squircle") {
			const r = Math.min(11.4, container.radius ?? 8);
			const k = r * 0.55;
			return `<path d="M ${r} 0 H ${24 - r} C ${24 - r + k} 0 ${24} ${r - k} ${24} ${r} V ${24 - r} C ${24} ${24 - r + k} ${24 - r + k} 24 ${24 - r} 24 H ${r} C ${r - k} 24 0 ${24 - r + k} 0 ${24 - r} V ${r} C 0 ${r - k} ${r - k} 0 ${r} 0 Z" fill="${fillColor}"/>`;
		}
		void s;
		const rr = Math.min(12, Math.max(0, container.radius ?? 7.2));
		return `<rect x="0" y="0" width="24" height="24" rx="${Math.round(rr * 100) / 100}" fill="${fillColor}"/>`;
	};

	// ① 容器底
	let glyphGroupAttrs = glyphAttrs;
	let wrappers = [];
	if (container !== null) {
		const inset = container.inset ?? 0.24;
		const s = Math.round((1 - inset * 2) * 1000) / 1000;
		const offset = 12 - (24 * s) / 2;
		// 容器填色：有渐变时用渐变（这才是 iOS/Win11 的典型样子），否则用 container.color / color
		const baseColor = gradientOnContainer ? strokePaint : (container.color ?? color);
		if (container.kind === "circle") {
			layers.push(`<circle cx="12" cy="12" r="12" fill="${baseColor}"/>`);
		} else if (container.kind === "squircle") {
			// 超椭圆：用 cubic bezier 近似 iOS 连续圆角（半径 = 边长的 45%）
			const r = Math.min(11.4, container.radius ?? 8);
			const k = r * 0.55;
			layers.push(
				`<path d="M ${r} 0 H ${24 - r} C ${24 - r + k} 0 ${24} ${r - k} ${24} ${r} V ${24 - r} C ${24} ${24 - r + k} ${24 - r + k} 24 ${24 - r} 24 H ${r} C ${r - k} 24 0 ${24 - r + k} 0 ${24 - r} V ${r} C 0 ${r - k} ${r - k} 0 ${r} 0 Z" fill="${baseColor}"/>`
			);
		} else {
			const r = Math.min(12, Math.max(0, container.radius ?? 7.2));
			layers.push(`<rect x="0" y="0" width="24" height="24" rx="${Math.round(r * 100) / 100}" fill="${baseColor}"/>`);
		}
		// 字形缩小后描边也跟着缩 → 必须反向补偿，否则 24px 下实际 <1px 必然发灰
		const comp = paint === "fill" ? strokeWidth : Math.round((strokeWidth / s) * 1000) / 1000;
		glyphGroupAttrs = glyphAttrs.map((a) => (/^stroke-width=/.test(a) ? `stroke-width="${comp}"` : a));
		wrappers = [`translate(${offset} ${offset})`, `scale(${s})`];
	}

	// ② 双色底图（fill 层，低透明度）。有容器时渐变已给容器，底图用实色。
	if (duo !== null && duo.node !== undefined) {
		const duoFill = gradientOnContainer ? color : strokePaint;
		layers.push(`<g fill="${duoFill}" fill-opacity="${duo.opacity ?? 0.2}" stroke="none">${iconToInnerSvg(stripPaint(duo.node))}</g>`);
	}

	// ③ 字形（或文字）
	// 文字单独拿出来放**最后**（在 mask 之外）：
	// 实测发现，中孔（shapes 减法）会把文字也一起挖掉 ——
	// 「K 徽章开个装饰孔」会变成「K 被咬掉一角」，看起来就像 bug。
	// 语义上减法应该是「在卡片/图形上挖洞」，不是「切割文字」，
	// 所以文字画在 mask 之外。要真的做镂刻字，用 shapes 先做模版再渲染成位图。
	let textLayer = "";
	if (hasText) {
		const raw = o.text.content.slice(0, 4);
		// 自动字号：在安全区内挤得下。比例字粗体平均 advance ≈ 0.62×字号。
		const avail = container === null ? 20 : 24 * (1 - (container.inset ?? 0.24) * 2);
		const auto = Math.min(avail / Math.max(1, raw.length) / 0.62, avail * 0.92);
		const fontSize = Number.isFinite(o.text.size) && o.text.size > 0 ? Math.min(o.text.size, 24) : Math.round(auto * 100) / 100;
		const esc = String(raw).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
		textLayer =
			`<text x="12" y="12" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" ` +
			`fill="${glyphColor}" text-anchor="middle" dominant-baseline="central">${esc}</text>`;
	} else {
		const glyph = `<g ${glyphGroupAttrs.join(" ")}>${glyphInner}</g>`;
		layers.push(wrappers.length === 0 ? glyph : `<g transform="${wrappers.join(" ")}">${glyph}</g>`);
	}

	/* ---------------------------- 阴影图元 ---------------------------- */
	// 每个阴影一个独立 filter（blur 不同），id 按内容哈希保持确定性。
	const shadowDefs = [];
	const outerLayers = [];
	const innerLayers = [];
	shadowList.forEach((sh, idx) => {
		const sigma = Math.max(0, (sh.blur ?? 0) / 2); // CSS blur ≈ 2σ
		const id = `ak-sh-${idx}-${hash36(`${sh.dx}|${sh.dy}|${sigma}|${sh.color}`)}`;
		shadowDefs.push(
			`<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${sigma}"/></filter>`
		);
		if (sh.inset) {
			// 内阴影：裁到轮廓内部，画一个向外偏移的厚描边并模糊，得到「从边缘向内渐暗」
			const clipId = `ak-cl-${id}`;
			shadowDefs.push(`<clipPath id="${clipId}">${silhouette("#000")}</clipPath>`);
			const w = Math.max(2, (sh.blur ?? 0) * 2);
			innerLayers.push(
				`<g clip-path="url(#${clipId})"><g filter="url(#${id})" transform="translate(${-(sh.dx ?? 0)} ${-(sh.dy ?? 0)})">` +
					`<rect x="${-w}" y="${-w}" width="${24 + w * 2}" height="${24 + w * 2}" fill="none" stroke="${sh.color}" stroke-width="${w}"/>` +
					`</g></g>`
			);
		} else {
			outerLayers.push(`<g filter="url(#${id})" transform="translate(${sh.dx ?? 0} ${sh.dy ?? 0})">${silhouette(sh.color)}</g>`);
		}
	});

	/* -------------------------- 多形状组合 -------------------------- */
	// 两层组合能力，用同一个参数表达：
	//   叠加（无前缀） → 另一个图形画在主字形之上，用同一套画笔
	//   减去（- 前缀） → 把该图形从**整个**合成结果里挖掉（环/中孔/镂刻）
	// 减去用 <mask>（白底 + 黑形）实现；这是 SVG 里最通用、且 resvg 完全支持的做法。
	const extraShapes = Array.isArray(o.shapes) ? o.shapes.filter((s) => s && Array.isArray(s.node)) : [];
	const additive = extraShapes.filter((s) => !s.subtract);
	const subtractive = extraShapes.filter((s) => s.subtract);
	// 变换顺序：缩放到中心 → 偏移 → 绕自身中心旋转。
	// 旋转必须在偏移之后、且绕图形自身中心（0,0 是 24 网格左上，形心在 12,12）。
	const shapeTransform = (s) => {
		const scale = s.scale ?? 1;
		const growth = (24 * (1 - scale)) / 2;
		const tx = growth + (s.dx ?? 0);
		const ty = growth + (s.dy ?? 0);
		const parts = [`translate(${tx} ${ty})`];
		if (scale !== 1) parts.push(`scale(${scale})`);
		const rot = s.rotate ?? 0;
		// 旋转中心：缩放后的坐标系里仍是 12,12；先平移到中心再转再平移回去
		if (rot !== 0) parts.push(`rotate(${rot} 12 12)`);
		return parts.join(" ");
	};
	// 每层独立渐变：用 objectBoundingBox 坐标，渐变自动适配该层自身的包围盒，
	// 不用管缩放/偏移——否则每层都要手算绝对坐标，没法用。
	const shapeGradDefs = [];
	const shapeGradientFill = (s) => {
		if (!Array.isArray(s.stops) || s.stops.length < 2) return null;
		const id = `ak-sg-${hash36(`${s.stops.map((x) => `${x.color}@${x.offset}`).join(",")}|${s.gradient ?? "linear"}|${s.angle ?? 45}`)}`;
		const stopMarkup = s.stops.map((x) => `<stop offset="${x.offset}" stop-color="${x.color}"/>`).join("");
		if (s.gradient === "radial") {
			shapeGradDefs.push(`<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5">${stopMarkup}</radialGradient>`);
		} else {
			const a = ((s.angle ?? 45) * Math.PI) / 180;
			const dx = Math.sin(a);
			const dy = -Math.cos(a);
			shapeGradDefs.push(
				`<linearGradient id="${id}" x1="${(0.5 - dx / 2).toFixed(3)}" y1="${(0.5 - dy / 2).toFixed(3)}" x2="${(0.5 + dx / 2).toFixed(3)}" y2="${(0.5 + dy / 2).toFixed(3)}">${stopMarkup}</linearGradient>`
			);
		}
		return `url(#${id})`;
	};
	// 每个叠加形可以有自己的颜色（fill）与线宽（weight），否则沿用字形值。
	// 指定了 weight 就强制该层描边——否则全局 paint=fill 时线宽会完全无效
	// （那又是“看起来能用、实际零效果”的坑）。
	const shapeAttrs = (s) => {
		// 渐变优先于纯色：给了 stops 就用渐变填该层
		const gradFill = shapeGradientFill(s);
		const sFill = gradFill ?? s.color ?? s.fill;
		const hasFill = typeof sFill === "string" && sFill !== "";
		const hasWeight = Number.isFinite(s.weight) && s.weight > 0;
		const hasRule = s.fillRule === "evenodd" || s.fillRule === "nonzero";
		if (!hasFill && !hasWeight && !hasRule) return glyphAttrs;
		// 解成键值对再改，比逐条 map 更不容易漏（之前就漏了 stroke-width 本身）
		const kv = new Map();
		for (const a of glyphAttrs) {
			const eq = a.indexOf("=");
			if (eq > 0) kv.set(a.slice(0, eq), a.slice(eq + 1).replace(/^"|"$/g, ""));
		}
		if (hasFill) {
			kv.set("fill", sFill);
			if (kv.has("stroke")) kv.set("stroke", sFill);
		}
		// 每层独立的 fill-rule：让该层自己就能画环/中孔
		if (s.fillRule === "evenodd" || s.fillRule === "nonzero") {
			kv.set("fill-rule", s.fillRule);
			kv.set("clip-rule", s.fillRule);
		}
		if (hasWeight) {
			// 全局没描边时先把描边打开，并把颜色对齐到该层颜色，否则线宽无处作用
			if (!kv.get("stroke") || kv.get("stroke") === "none") kv.set("stroke", hasFill ? sFill : kv.get("fill") ?? "currentColor");
			kv.set("stroke-width", String(s.weight));
			if (!kv.has("stroke-linecap")) kv.set("stroke-linecap", cap);
			if (!kv.has("stroke-linejoin")) kv.set("stroke-linejoin", join);
		}
		return [...kv.entries()].map(([k, v]) => `${k}="${v}"`);
	};
	// 自绘图层（给了 path）直接用它的 markup，不走库节点
	const innerOf = (s) => (typeof s.path === "string" ? iconToInnerSvg(pathNode(s.path)) : iconToInnerSvg(stripPaint(s.node)));
	const placeShape = (s) => {
		const inner = innerOf(s);
		const t = shapeTransform(s);
		const attrs = shapeAttrs(s).join(" ");
		return t === "translate(0 0)" ? `<g ${attrs}>${inner}</g>` : `<g transform="${t}"><g ${attrs}>${inner}</g></g>`;
	};
	const additiveMarkup = additive.map((s) => placeShape(s)).join("");
	let content = `${outerLayers.join("")}${layers.join("")}${additiveMarkup}${innerLayers.join("")}`;
	if (subtractive.length > 0) {
		// mask 默认 luminance：白 = 保留，黑 = 挖掉
		const holes = subtractive
			.map((s) => {
				const inner = innerOf(s);
				const body = `<g fill="#000000" stroke="#000000" stroke-width="0">${inner}</g>`;
				return `<g transform="${shapeTransform(s)}">${body}</g>`;
			})
			.join("");
		const maskId = `ak-mk-${hash36(subtractive.map((s) => `${s.path ?? s.node.length}${s.scale}${s.dx ?? 0},${s.dy ?? 0}${s.rotate ?? 0}`).join("|"))}`;
		const maskDef =
			`<mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">` +
			`<rect x="0" y="0" width="24" height="24" fill="#FFFFFF"/>${holes}</mask>`;
		content = `<g mask="url(#${maskId})">${content}</g>`;
		var maskDefs = maskDef;
	} else {
		var maskDefs = "";
	}

	const defsParts = [gradDef, ...shapeGradDefs, ...shadowDefs, maskDefs].filter((s) => s !== "").join("");
	const defs = defsParts === "" ? "" : `<defs>${defsParts}</defs>`;
	// 层序：外阴影（最下）→ 内容（含叠加形，可被 mask 挖空）→ 文字（不受减法影响）
	return `<svg${cls} xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${defs}${content}${textLayer}</svg>`;
}

export {
	checkIcon,
	extractInner,
	hexOf,
	iconToInnerSvg,
	parseIconNodes,
	renderComposed,
	renderSvg,
	renderSvgChip,
	renderSvgGradient,
	renderSvgLayers,
	shiftColor,
	stripPaint
};
