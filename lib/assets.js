/**
 * assets.js — design_render action=asset 的实现：内置素材库检索 / 内联 / 改色。
 *
 * 素材在插件包内（data/assets，5.8MB / 221 项，已去掉缩略图）。
 * 不依赖外部素材工作区的绝对路径——这是「独立插件」的关键一步。
 *
 * 安全：所有路径都经 resolve 后校验是否仍在素材目录内，挡目录穿越。
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "assets");
const MANIFEST = join(ASSETS_DIR, "manifest.json");

let cache = null;

async function loadManifest() {
	if (cache !== null) return cache;
	let raw;
	try {
		raw = await readFile(MANIFEST, "utf8");
	} catch (error) {
		throw new Error(`素材 manifest 不可读：${MANIFEST}（${error?.message ?? error}）`);
	}
	const parsed = JSON.parse(raw);
	cache = Array.isArray(parsed.items) ? parsed.items : [];
	return cache;
}

/** 关键词检索：name / category / desc / file 四处子串匹配，名字命中优先。 */
async function find(keyword, limit = 20) {
	const items = await loadManifest();
	const query = String(keyword ?? "").trim().toLowerCase();
	if (query === "") return { total: items.length, items: items.slice(0, limit) };
	// 中文检索词的口语同义词：用户说「模式」指图案、「底纹」指纹理，「模式」直搜 total:0
	// 会让人以为素材库里没有图案。只做小范围、无歧义的设计词汇映射。
	const SYNONYMS = {
		模式: ["图案"],
		纹样: ["图案"],
		花纹: ["图案"],
		底纹: ["纹理"],
		标志: ["品牌图标"],
		logo: ["品牌图标"],
		avatar: ["角色部件"],
		插图: ["插画"]
	};
	const variants = [...new Set([query, ...(SYNONYMS[query] ?? []).map((v) => String(v).toLowerCase())])];
	const scored = [];
	for (const item of items) {
		const name = String(item.name ?? "").toLowerCase();
		const category = String(item.category ?? "").toLowerCase();
		const desc = String(item.desc ?? "").toLowerCase();
		const file = String(item.file ?? "").toLowerCase();
		let score = Infinity;
		for (const q of variants) {
			let s = Infinity;
			if (name === q) s = 0;
			else if (name.startsWith(q)) s = 1;
			else if (name.includes(q)) s = 2;
			else if (category.includes(q)) s = 3;
			else if (desc.includes(q)) s = 4;
			else if (file.includes(q)) s = 5;
			if (s < score) score = s;
			if (score === 0) break;
		}
		if (score !== Infinity) scored.push({ score, item });
	}
	scored.sort((a, b) => a.score - b.score || String(a.item.name).localeCompare(String(b.item.name)));
	return { total: scored.length, items: scored.slice(0, limit).map((s) => s.item) };
}

/** 把素材库相对路径解析成绝对路径，越界即拒。 */
function resolveInside(rel) {
	const wanted = String(rel ?? "").trim();
	if (wanted === "") throw new Error("rel is required（素材库相对路径，如 icons/brands/github.svg）");
	const full = resolve(ASSETS_DIR, wanted);
	if (full !== ASSETS_DIR && !full.startsWith(ASSETS_DIR + sep)) {
		throw new Error(`路径越界：${wanted} 不在素材库内`);
	}
	if (!existsSync(full)) throw new Error(`素材不存在：${wanted}（用 action=asset mode=find 检索）`);
	return full;
}

/** inline/save 只对矢量素材有意义：位图（.png）读成 utf8 是乱码，
 * 还会伪造一个 viewBox 冒充 SVG（实测 48 个 png 素材都会中招）。 */
function resolveSvg(rel) {
	const file = resolveInside(rel);
	let isDir = false;
	try {
		isDir = statSync(file).isDirectory();
	} catch {
		isDir = false;
	}
	if (isDir) throw new Error(`${rel} 是一个目录：inline/save 需要具体文件路径（先 mode=find 检索）`);
	if (extname(file).toLowerCase() !== ".svg") {
		throw new Error(`${rel} 不是 SVG（${extname(file) || "无扩展名"}）：inline/save 只处理矢量素材；位图请直接引用素材库路径`);
	}
	return file;
}

/**
 * 改色：三层处理，覆盖素材库里实际存在的三种写法。
 *   1. currentColor → 直接替换（我们自己的图标都走这个）
 *   2. fill/stroke 具体色值 → 替换值，不动结构（不误伤 <path d> 里的坐标）
 *   3. 图形根本没有 fill/stroke（simple-icons 的 12 个品牌图就这么写，靠浏览器默认黑填充）
 *      → 必须把颜色下推到每个图形元素；只给根 <svg> 加 fill 会在 inline 剥壳后丢失
 */
const COLOR_RE = /^[\w#(),.%+\- ]+$/;

function recolor(svg, color) {
	if (color === undefined || color === null || String(color).trim() === "") return svg;
	const wanted = String(color).trim();
	// 颜色会被拼进 SVG 属性：不校验就只能任由 `red"/><script>` 注入新标签
	// （inline 结果会内联进页面，save 产物会被直接打开）。
	if (!COLOR_RE.test(wanted)) {
		throw new Error(`color 含不允许的字符（收到 "${wanted}"）——仅接受 #hex / rgb() / 命名色等颜色写法`);
	}
	let out = svg;
	if (out.includes("currentColor")) {
		out = out.split("currentColor").join(wanted);
	}
	out = out.replace(/(fill|stroke)\s*=\s*"([^"]*)"/gi, (whole, attr, value) => {
		const v = String(value).trim().toLowerCase();
		if (v === "none" || v === "transparent" || v === "" || v.startsWith("url(")) return whole;
		return `${attr}="${wanted}"`;
	});
	const SHAPE = /<(path|circle|rect|ellipse|polygon|polyline)\b((?:"[^"]*"|[^>"])*)>/g;
	const hasPaint = /<(path|circle|rect|ellipse|polygon|polyline)\b[^>]*\b(fill|stroke)\s*=/.test(out);
	if (!hasPaint) {
		out = out.replace(SHAPE, (whole, tag, attrs) => (/(^|\s)(fill|stroke)\s*=/.test(attrs) ? whole : `<${tag}${attrs} fill="${wanted}">`));
	}
	return out;
}

/** 剥掉 <svg> 外壳，取内部内容并计算 viewBox。
 * 同时去掉 <title>/<desc>：inline 的用途是嵌进外层 SVG，外层通常自带可达性标签，
 * 留着会在最终页面里出现重复标题。 */
function innerOf(svg) {
	const open = svg.match(/<svg\b[^>]*>/i);
	if (open === null) return { inner: svg.trim(), viewBox: undefined };
	const close = svg.toLowerCase().lastIndexOf("</svg>");
	const start = svg.indexOf(open[0]) + open[0].length;
	const end = close === -1 ? svg.length : close;
	const vb = open[0].match(/viewBox\s*=\s*"([^"]*)"/i);
	const inner = svg
		.slice(start, end)
		.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, "")
		.replace(/<desc\b[^>]*>[\s\S]*?<\/desc>/gi, "")
		.trim();
	return { inner, viewBox: vb ? vb[1] : undefined };
}

/**
 * action=asset：
 *   mode=find   检索（默认）
 *   mode=inline 返回内联内容（可改色），用于嵌进外层 SVG —— 不嵌 <svg> 壳
 *   mode=save   整篇改色后落盘，返回输出路径
 */
async function asset({ mode = "find", keyword, rel, color, saveTo, limit }) {
	if (mode === "find") {
		const result = await find(keyword, limit ?? 20);
		return { mode, keyword: keyword ?? "", total: result.total, items: result.items };
	}
	if (mode === "inline") {
		const file = resolveSvg(rel);
		const svg = recolor(await readFile(file, "utf8"), color);
		const { inner, viewBox } = innerOf(svg);
		const item = (await loadManifest()).find((entry) => entry.file === String(rel).split(sep).join("/"));
		// 内联内容直接进模型上下文：大图（如 openpeeps 插画 65KB）会吃掉上万 token。
		// 截断必须在元素边界切（lastIndexOf "/>"），否则返回半截标签根本不能用；
		// 同时 note 必须如实说「已截断」——旧实现只置 truncated 标记却返回全文，是谎报。
		const INLINE_LIMIT = 20000;
		let shown = inner;
		let truncated = false;
		if (inner.length > INLINE_LIMIT) {
			// 优先切在自闭合元素结束处（"/>"）；openpeeps 那种 `<path …></path>` 写法
			// 前两万字符里一个 "/>" 都没有，再退到任意标签结束的 ">" 上——总之不能切在
			// 属性值中间（否则返回半截 path 数据，note 声称“到元素边界”就是谎报）。
			const slash = inner.lastIndexOf("/>", INLINE_LIMIT - 2);
			let cutEnd = slash > 0 ? slash + 2 : -1;
			if (cutEnd < 0) {
				const gt = inner.lastIndexOf(">", INLINE_LIMIT - 1);
				cutEnd = gt > 0 ? gt + 1 : -1;
			}
			shown = cutEnd > 0 ? inner.slice(0, cutEnd) : inner.slice(0, INLINE_LIMIT);
			truncated = true;
		}
		return {
			mode,
			rel,
			...(item !== undefined ? { name: item.name, license: item.license, category: item.category } : {}),
			viewBox: viewBox ?? "0 0 24 24",
			inner: shown,
			truncated,
			bytes: Buffer.byteLength(svg, "utf8"),
			...(truncated
				? { note: `内联内容 ${inner.length} 字符超过 ${INLINE_LIMIT}，已截断到标签边界（可能是部分元素树，仅供预览）；需要完整文件请用 mode=save 落盘` }
				: {})
		};
	}
	if (mode === "save") {
		if (typeof saveTo !== "string" || saveTo.trim() === "") throw new Error("mode=save 需要 saveTo");
		const file = resolveSvg(rel);
		const svg = recolor(await readFile(file, "utf8"), color);
		await mkdir(dirname(saveTo), { recursive: true });
		await writeFile(saveTo, svg, "utf8");
		return { mode, rel, path: saveTo, bytes: Buffer.byteLength(svg, "utf8"), color: color ?? null };
	}
	throw new Error(`unknown mode "${mode}"（find / inline / save）`);
}

/** 素材库概况（供工具描述与自检用）。 */
async function summary() {
	const items = await loadManifest();
	const categories = new Map();
	for (const item of items) {
		const key = item.category ?? "未分类";
		categories.set(key, (categories.get(key) ?? 0) + 1);
	}
	return {
		count: items.length,
		categories: [...categories.entries()].map(([name, count]) => ({ name, count }))
	};
}

export { asset, find, innerOf, recolor, summary };
