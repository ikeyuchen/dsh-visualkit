/**
 * layouts/svg.js — layout_check action=svg：成品 SVG 的「真实文字几何」体检。
 *
 * 为什么不需要 OCR：SVG 的 <text> 自带 x/y/font-size/text-anchor，几何是**声明出来的**，
 * 直接量比截图检测更准。代价是宽度只能靠字符宽度模型估算（不解析字体度量表）：
 *   - 中文 / 全角字符：1.0 × fontSize
 *   - 拉丁字母 / 数字 / 空格：0.55 × fontSize
 * 多行 <text> 用 <tspan dy> 逐行累加基线。所有长度都在「用户单位」里算，
 * 只有需要「渲染后像素」的规则（G8 最小字号）才乘 scale：
 *   scale = width(px) / viewBoxWidth（没有 width 时 scale=1；没有 viewBox 时画布就是 width/height）。
 * 几何坐标会减掉 viewBox 的 min-x / min-y，所以边距百分比以**可见区域**为准。
 *
 * 规则 id G1–G9 与阈值是产品契约（见 README「排版检测」），改动等同于改契约；
 * G0-* 是解析层的信息项（默认字号 / transform 内文字 / 无文字），不参与质量判定。
 *
 * 已知误差（写在这里，避免后来者把误报当 bug 修）：
 *   1. 字体加粗、字距（letter-spacing）、字宽不同的字体族都不在宽度模型里 → 估算宽度可能偏小；
 *   2. `font-size` 的 em/rem 按父级 16 近似；`font-size` / x / y / dy 的百分比无法换算，按缺省处理；
 *   3. `<g transform>` 内的文字坐标系不可靠，一律计入 `unmeasured` 不参与几何判定（README 已声明）；
 *   4. 面积 ≥90% 画布的图形按「背景板」排除（不参与内容 bbox / G9），见 metrics.backgroundPlates；
 *      比 90% 略小的大色块仍会算内容，可能把 G9 推到「拥挤」；
 *   5. G6 按「行」比对且跳过同一文本块（同 x/字号/连续基线）内部的行：块内行贴行归 G3；
 *      不同块的文字若只是外接框相擦，仍可能判重叠（保守估计）；
 *   6. G3 的「同块」只看字号 + 锚点 x（契约口径），不同段落恰好在同一 x 且间距 ≤6× 字号时可能被连起来看。
 */
import { finalize, finding } from "./common.js";
import { countWideChars, measureTextPx } from "./metrics-text.js";
import { auditContrast, parseColor } from "./rules-contrast.js";
import { auditBaselineGrid } from "./rules-structure.js";
import { applyAllow, readIntent } from "./intent.js";

/* ============================== 阈值 / 常量 ============================== */

/** 浏览器默认字号：<text> 没写 font-size 时按它估算（并加 info 提示）。 */
const DEFAULT_FONT_SIZE = 16;
/** 估算文字 bbox 时，基线以上占字号的比例（近似 ascender），以下留 0.2 给 descender。 */
const ASCENT = 0.8;

/** G1 安全区：贴边 <3% 是 error、<5% 是 warn。 */
const SAFE_ERROR_PCT = 3;
const SAFE_WARN_PCT = 5;

/** G2 字号层级：唯一字号 <2 → error；最大/正文 <1.4 error、1.4–2 warn；档位 >6 warn。
 *  文字块 ≤2（单行 banner / 徽标）时层级不成立，上述 error/warn 统一降为 info。 */
const HIERARCHY_ERROR_RATIO = 1.4;
const HIERARCHY_WARN_RATIO = 2;
const MAX_FONT_STEPS = 6;

/** G3 行距：间距/字号 <1.15 error；1.15–1.3 warn；>2.4 warn。 */
const LEADING_TIGHT_ERROR = 1.15;
const LEADING_TIGHT_WARN = 1.3;
const LEADING_LOOSE_WARN = 2.4;
/** 同一「块」的最大相邻间距（×字号）：超过视为不同段落，防止页脚/页码被当成行距过大。 */
const LEADING_BLOCK_MAX_RATIO = 6;

/** G4 行长：估算宽度/画布宽 >0.85，或单行 CJK >45 字。 */
const LINE_WIDTH_WARN_RATIO = 0.85;
const CJK_PER_LINE_WARN = 45;

/** G6 文字重叠：交叠面积 / 较小面积 >0.15（只比不同文本块；块内行贴行归 G3）。 */
const OVERLAP_ERROR_RATIO = 0.15;

/** G7 对齐：容差 2px（渲染后像素），至少 4 行才判定。 */
const ALIGN_TOLERANCE_PX = 2;
const ALIGN_MIN_LINES = 4;

/** G8 最小字号（渲染后像素）：<8 error；<10 warn。 */
const FONT_PX_ERROR = 8;
const FONT_PX_WARN = 10;

/** G9 留白：内容包围盒/画布 >88% 拥挤；<5% 可能空版。 */
const COVERAGE_CROWDED_PCT = 88;
const COVERAGE_EMPTY_PCT = 5;

/**
 * 背景板：图形包围盒面积 ≥90% 画布、且本身只是色块/渐变底（纯 shape，内部不承载文字）。
 * 这类满版底色不参与安全区、内容 bbox 与 G9——否则真实海报一铺底色就必吃 G1/G9 误报。
 */
const BACKGROUND_PLATE_AREA_RATIO = 0.9;

/** 单条规则最多报几条：坏稿容易刷屏，多出来的同规则条目对模型没有新增信息。 */
const MAX_PER_RULE = 3;

/* ============================== 通用小工具 ============================== */

/** 两位小数并消除 -0（宿主会判 JSON 无损往返失败）。 */
function round2(value) {
	const rounded = Math.round(value * 100) / 100;
	return rounded === 0 ? 0 : rounded;
}

function clampText(value, max = 12) {
	const text = String(value ?? "");
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 元素可读标签，用于 where 字段（模型据此定位）。 */
function labelOf(index, sample) {
	const tail = typeof sample === "string" && sample !== "" ? `「${clampText(sample)}」` : "";
	return `文字#${index + 1}${tail}`;
}

/* ------------------------------ 字符宽度模型 ------------------------------ */

/**
 * 估算一段文字的宽度（用户单位）。
 * 走 metrics-text.js 的字符宽度表（ASCII 实测 advance + 全角 1em）：
 * 实测比旧的扁平 0.55 模型把纯英文误差从 10.0% 降到 0.4%，中英混排从 4.4% 降到 0.6%。
 */
function estimateWidth(text, fontSize) {
	return measureTextPx(text, fontSize);
}

/* ------------------------------ 解析：属性 / 长度 ------------------------------ */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(input) {
	return String(input).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
		if (body[0] === "#") {
			const hex = /^#x/i.test(body);
			const code = hex ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
		}
		const named = ENTITIES[body.toLowerCase()];
		return named === undefined ? whole : named;
	});
}

/** 解析标签属性串（属性名统一小写；值里的实体已解码）。 */
function parseAttrs(attrText) {
	const attrs = Object.create(null);
	if (typeof attrText !== "string" || attrText === "") return attrs;
	const attrRe = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
	let match;
	while ((match = attrRe.exec(attrText)) !== null) {
		const name = match[1].toLowerCase();
		const raw = match[2] ?? match[3] ?? match[4] ?? "";
		attrs[name] = decodeEntities(raw);
	}
	return attrs;
}

/** 属性或 style="..." 里的声明（SVG 两种写法都常见）。 */
function attrOrStyle(attrs, name) {
	const direct = attrs[name];
	if (typeof direct === "string" && direct.trim() !== "") return direct.trim();
	const style = attrs.style;
	if (typeof style === "string" && style !== "") {
		for (const part of style.split(";")) {
			const index = part.indexOf(":");
			if (index === -1) continue;
			if (part.slice(0, index).trim().toLowerCase() !== name) continue;
			const value = part.slice(index + 1).trim();
			if (value !== "") return value;
		}
	}
	return undefined;
}

/**
 * 坐标/长度解析：数字 + 单位 → 用户单位；百分比无法换算（返回 null）。
 * em/rem 按 16 近似（不解析字体继承链），documented limitation。
 */
function parseCoord(raw) {
	if (raw === undefined || raw === null) return null;
	const text = String(raw).trim();
	if (text === "") return null;
	const match = text.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z%]*)$/i);
	if (match === null) return null;
	const value = Number.parseFloat(match[1]);
	if (!Number.isFinite(value)) return null;
	const unit = match[2].toLowerCase();
	if (unit === "%") return null;
	if (unit === "pt") return (value * 4) / 3;
	if (unit === "em" || unit === "rem") return value * 16;
	if (unit === "pc") return value * 16;
	if (unit === "mm") return (value * 96) / 25.4;
	if (unit === "cm") return (value * 96) / 2.54;
	if (unit === "in") return value * 96;
	return value;
}

/** font-size：无法解析/非正数 → null（调用方回退默认 16 并记 info）。 */
function parseFontSize(raw) {
	const value = parseCoord(raw);
	return value !== null && value > 0 ? value : null;
}

function normalizeAnchor(raw) {
	const value = String(raw ?? "").trim().toLowerCase();
	if (value === "middle" || value === "center") return "middle";
	if (value === "end") return "end";
	return "start";
}

function parseViewBox(raw) {
	if (typeof raw !== "string") return null;
	const numbers = raw.trim().split(/[\s,]+/).map((part) => Number.parseFloat(part));
	if (numbers.length !== 4 || numbers.some((n) => !Number.isFinite(n))) return null;
	const [x, y, w, h] = numbers;
	return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** 文本内容清洗：去标签、解实体、合并空白。 */
function cleanText(raw) {
	return decodeEntities(String(raw))
		.replace(/<[^>]*>/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/* ------------------------------ 解析：画布 ------------------------------ */

/**
 * 画布 = viewBox 宽高（用户单位）；无 viewBox 时 = width/height（像素）。
 * 两者都缺 → 抛「SVG 缺画布尺寸」（工具层错误消息要可行动）。
 */
function parseCanvas(markup) {
	// 属性值里可能有 ">"（如 data-src="a>b"），所以不能简单用 [^>]* 截断根标签
	const open = /<svg\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/i.exec(markup);
	if (open === null) throw new Error("不是 SVG 标记：缺少 <svg> 根元素");
	const attrs = parseAttrs(open[1]);
	const viewBox = parseViewBox(attrs.viewbox);
	const widthPx = parseCoord(attrs.width);
	const heightPx = parseCoord(attrs.height);
	if (viewBox !== null) {
		const scale = widthPx !== null && widthPx > 0 ? widthPx / viewBox.w : 1;
		return { w: viewBox.w, h: viewBox.h, minX: viewBox.x, minY: viewBox.y, scale };
	}
	if (widthPx !== null && heightPx !== null && widthPx > 0 && heightPx > 0) {
		return { w: widthPx, h: heightPx, minX: 0, minY: 0, scale: 1 };
	}
	throw new Error("SVG 缺画布尺寸：<svg> 既没有可解析的 width/height，也没有 viewBox");
}

/* ------------------------------ 解析：文字 ------------------------------ */

/** 一行文字的 bbox：宽度按字符模型估算，高度取该行最大字号，anchor 决定水平锚点。 */
function lineBox(line) {
	const fontSize = line.segments.reduce((max, segment) => Math.max(max, segment.fs), 0);
	const width = line.segments.reduce((sum, segment) => sum + estimateWidth(segment.text, segment.fs), 0);
	const left = line.anchor === "middle" ? line.x - width / 2 : line.anchor === "end" ? line.x - width : line.x;
	return { x: left, y: line.y - ASCENT * fontSize, w: width, h: fontSize };
}

function unionBoxes(boxes) {
	const list = boxes.filter((box) => box !== null && box !== undefined);
	if (list.length === 0) return null;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const box of list) {
		minX = Math.min(minX, box.x);
		minY = Math.min(minY, box.y);
		maxX = Math.max(maxX, box.x + box.w);
		maxY = Math.max(maxY, box.y + box.h);
	}
	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * 解析一个 <text> 元素（含 <tspan> 多行）。
 * 行判定：tspan 带 dy / y → 新行（dy 逐行累加）；带 x 且当前行已有内容 → 也当新行（另起锚点）；
 * 否则是同一行的样式片段（例如 <tspan fill="red">）。返回 null 表示没有可测文字。
 */
function parseTextElement(attrs, inner) {
	const elementFsRaw = attrOrStyle(attrs, "font-size");
	const elementFs = parseFontSize(elementFsRaw);
	const baseFs = elementFs ?? DEFAULT_FONT_SIZE;
	const baseX = parseCoord(attrs.x) ?? 0;
	const baseY = parseCoord(attrs.y) ?? 0;
	const elementAnchorRaw = attrOrStyle(attrs, "text-anchor");
	const elementAnchor = normalizeAnchor(elementAnchorRaw);
	const elementAnchorExplicit = elementAnchorRaw !== undefined;
	const weight = attrOrStyle(attrs, "font-weight") ?? "normal";
	const fill = attrOrStyle(attrs, "fill") ?? "#000000";

	let usedDefault = false;
	/** @type {Array<{y:number,x:number,anchor:string,segments:Array<{text:string,fs:number}>}>} */
	const lines = [];
	let current = { y: baseY, x: baseX, anchor: elementAnchor, anchorExplicit: elementAnchorExplicit, segments: [] };
	let currentY = baseY;
	let currentX = baseX;
	let currentFs = baseFs;

	const flush = () => {
		if (current.segments.length === 0) return;
		lines.push({
			y: current.y,
			x: current.x,
			anchor: current.anchor,
			anchorExplicit: current.anchorExplicit,
			segments: current.segments.map((segment) => ({ ...segment }))
		});
		current = { y: current.y, x: current.x, anchor: current.anchor, anchorExplicit: current.anchorExplicit, segments: [] };
	};
	const pushSegment = (text, fontSize) => {
		if (text !== "") current.segments.push({ text, fs: fontSize });
	};

	const tspanRe = /<tspan\b((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>([\s\S]*?)<\/tspan>/gi;
	let cursor = 0;
	let match;
	while ((match = tspanRe.exec(inner)) !== null) {
		const plain = cleanText(inner.slice(cursor, match.index));
		if (elementFsRaw === undefined && plain !== "") usedDefault = true;
		pushSegment(plain, currentFs);
		cursor = match.index + match[0].length;
		const tspanAttrs = parseAttrs(match[1]);
		const tspanFsRaw = attrOrStyle(tspanAttrs, "font-size");
		const tspanFs = parseFontSize(tspanFsRaw);
		const tspanAnchorRaw = attrOrStyle(tspanAttrs, "text-anchor");
		const dy = parseCoord(tspanAttrs.dy);
		const ty = parseCoord(tspanAttrs.y);
		const tx = parseCoord(tspanAttrs.x);
		const nextFs = tspanFs ?? currentFs;
		if (elementFsRaw === undefined && tspanFsRaw === undefined) usedDefault = true;
		const startsNewLine = dy !== null || ty !== null || (tx !== null && current.segments.length > 0);
		if (startsNewLine) {
			flush();
			const nextY = ty !== null ? ty : currentY + (dy ?? 0);
			const nextX = tx !== null ? tx : currentX;
			current = {
				y: nextY,
				x: nextX,
				anchor: tspanAnchorRaw === undefined ? current.anchor : normalizeAnchor(tspanAnchorRaw),
				anchorExplicit: tspanAnchorRaw === undefined ? current.anchorExplicit : true,
				segments: []
			};
			currentY = nextY;
			currentX = nextX;
		} else {
			if (tx !== null) {
				current.x = tx;
				currentX = tx;
			}
			if (tspanAnchorRaw !== undefined) {
				current.anchor = normalizeAnchor(tspanAnchorRaw);
				current.anchorExplicit = true;
			}
		}
		currentFs = nextFs;
		pushSegment(cleanText(match[3]), currentFs);
	}
	const trailing = cleanText(inner.slice(cursor));
	if (elementFsRaw === undefined && trailing !== "") usedDefault = true;
	pushSegment(trailing, currentFs);
	flush();
	if (lines.length === 0) return null;

	for (const line of lines) {
		line.fs = line.segments.reduce((max, segment) => Math.max(max, segment.fs), 0);
		line.bbox = lineBox(line);
	}
	const sample = lines
		.map((line) => line.segments.map((segment) => segment.text).join(""))
		.join(" ")
		.trim();
	return { lines, bbox: unionBoxes(lines.map((line) => line.bbox)), anchor: elementAnchor, weight, fill, usedDefault, sample };
}

/* ------------------------------ 解析：图形 ------------------------------ */

/** 只取矩形/椭圆/线与多边形的几何，用来算「内容包围盒」（G9）。 */
function shapeBox(tag, attrs) {
	const coord = (name) => parseCoord(attrs[name]);
	switch (tag) {
		case "rect": {
			const x = coord("x") ?? 0;
			const y = coord("y") ?? 0;
			const w = coord("width");
			const h = coord("height");
			return w !== null && h !== null && w > 0 && h > 0 ? { x, y, w, h } : null;
		}
		case "circle": {
			const cx = coord("cx") ?? 0;
			const cy = coord("cy") ?? 0;
			const r = coord("r");
			return r !== null && r > 0 ? { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r } : null;
		}
		case "ellipse": {
			const cx = coord("cx") ?? 0;
			const cy = coord("cy") ?? 0;
			const rx = coord("rx");
			const ry = coord("ry");
			return rx !== null && ry !== null && rx > 0 && ry > 0 ? { x: cx - rx, y: cy - ry, w: 2 * rx, h: 2 * ry } : null;
		}
		case "line": {
			const x1 = coord("x1") ?? 0;
			const y1 = coord("y1") ?? 0;
			const x2 = coord("x2") ?? 0;
			const y2 = coord("y2") ?? 0;
			const w = Math.abs(x2 - x1);
			const h = Math.abs(y2 - y1);
			return w === 0 && h === 0 ? null : { x: Math.min(x1, x2), y: Math.min(y1, y2), w, h };
		}
		case "polygon":
		case "polyline": {
			const points = String(attrs.points ?? "")
				.trim()
				.split(/[\s,]+/)
				.map((part) => Number.parseFloat(part))
				.filter((n) => Number.isFinite(n));
			if (points.length < 4) return null;
			let minX = Infinity;
			let minY = Infinity;
			let maxX = -Infinity;
			let maxY = -Infinity;
			for (let i = 0; i + 1 < points.length; i += 2) {
				minX = Math.min(minX, points[i]);
				minY = Math.min(minY, points[i + 1]);
				maxX = Math.max(maxX, points[i]);
				maxY = Math.max(maxY, points[i + 1]);
			}
			return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
		}
		default:
			return null;
	}
}

/* ------------------------------ 解析：一遍扫描 ------------------------------ */

const SHAPE_TAGS = new Set(["rect", "circle", "ellipse", "line", "polygon", "polyline"]);
/** 不渲染的容器（内容不应参与几何判定；<defs> 里的图形不是版面内容）。 */
const NON_RENDERED_TAGS = new Set([
	"defs",
	"symbol",
	"clippath",
	"mask",
	"marker",
	"pattern",
	"lineargradient",
	"radialgradient",
	"filter",
	"style",
	"title",
	"desc",
	"metadata"
]);

function hasTransform(attrs) {
	const raw = attrs.transform;
	if (typeof raw === "string" && raw.trim() !== "") return true;
	const style = attrs.style;
	return typeof style === "string" && /(?:^|;)\s*transform\s*:/i.test(style);
}

/**
 * 一遍扫描标签：收集可测文字、图形包围盒、以及 transform 内无法测量的文字数。
 * 只维护一个标签栈负责「是否在 transform / 不渲染容器内」两个上下文。
 */
function scanElements(markup) {
	const tagRe = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
	const texts = [];
	const graphics = [];
	const stack = [];
	let unmeasured = 0;
	let rawTextCount = 0;
	let match;
	while ((match = tagRe.exec(markup)) !== null) {
		const closing = match[1] === "/";
		const tag = match[2].toLowerCase().split(":").pop();
		const attrText = match[3] ?? "";
		const selfClose = match[4] === "/" || /\/\s*$/.test(attrText);
		if (closing) {
			for (let i = stack.length - 1; i >= 0; i -= 1) {
				if (stack[i].tag === tag) {
					stack.length = i;
					break;
				}
			}
			continue;
		}
		const attrs = parseAttrs(attrText);
		const parent = stack.length > 0 ? stack[stack.length - 1] : { transformed: false, hidden: false };
		const transformed = parent.transformed || hasTransform(attrs);
		const hidden = parent.hidden || NON_RENDERED_TAGS.has(tag);
		if (tag === "text") {
			rawTextCount += 1;
			const start = tagRe.lastIndex;
			const close = /<\/text\s*>/i.exec(markup.slice(start));
			const innerEnd = close === null ? markup.length : start + close.index;
			const inner = markup.slice(start, innerEnd);
			if (close !== null) tagRe.lastIndex = innerEnd + close[0].length;
			if (selfClose || hidden) continue;
			if (transformed) {
				unmeasured += 1;
				continue;
			}
			const element = parseTextElement(attrs, inner);
			if (element !== null) texts.push(element);
			continue;
		}
		if (SHAPE_TAGS.has(tag)) {
			// 自闭合只说明没有子元素，图形本身照样是版面内容（<rect .../> 是最常见写法）
			if (!transformed && !hidden) {
				const box = shapeBox(tag, attrs);
				// 保留填充色：对比度检测要知道「文字叠在什么颜色上」
				if (box !== null) graphics.push({ ...box, fill: attrOrStyle(attrs, "fill") });
			}
			continue;
		}
		if (selfClose) continue;
		stack.push({ tag, transformed, hidden });
	}
	return { texts, graphics, unmeasured, rawTextCount };
}

/* ============================== 规则实现 ============================== */

/** 把行按「同字号 + 同锚点 x（容差 2px 渲染后像素）」聚成「块」，供 G3 判行距。 */
function groupLinesByBlock(lines, scale) {
	const tolerance = ALIGN_TOLERANCE_PX / scale;
	const groups = [];
	for (const line of lines) {
		const group = groups.find(
			(item) => Math.abs(item.fs - line.fs) <= 0.5 && Math.abs(item.x - line.x) <= tolerance
		);
		if (group === undefined) groups.push({ fs: line.fs, x: line.x, lines: [line] });
		else group.lines.push(line);
	}
	return groups;
}

/**
 * 把行切成「文本块」：同字号 + 同锚点 x 的一组行里，基线递增的相邻行属于同一块；
 * 同一基线（dy=0）起新块。G6 用它排除块内行与行的重叠（那属于行距问题，归 G3）。
 * @returns {Map<object, number>} 行对象 → 块 id
 */
function assignTextBlocks(lines, scale) {
	const blockIds = new Map();
	let nextBlock = 0;
	for (const group of groupLinesByBlock(lines, scale)) {
		const sorted = [...group.lines].sort((a, b) => a.y - b.y);
		let previousY = null;
		for (const line of sorted) {
			if (previousY === null || line.y <= previousY) nextBlock += 1;
			blockIds.set(line, nextBlock);
			previousY = line.y;
		}
	}
	return blockIds;
}

/** 一维值聚类：返回最大簇的行数（贪心相邻差 ≤tol，近似“行相近即同类”）。 */
function maxClusterSize(values, tolerance) {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	let best = 1;
	let run = 1;
	for (let i = 1; i < sorted.length; i += 1) {
		run = sorted[i] - sorted[i - 1] <= tolerance ? run + 1 : 1;
		if (run > best) best = run;
	}
	return best;
}

function intersectionArea(a, b) {
	const left = Math.max(a.x, b.x);
	const top = Math.max(a.y, b.y);
	const right = Math.min(a.x + a.w, b.x + b.w);
	const bottom = Math.min(a.y + a.h, b.y + b.h);
	if (right <= left || bottom <= top) return 0;
	return (right - left) * (bottom - top);
}

/* ============================== 主入口 ============================== */

/**
 * auditSvg — 对完整 SVG 标记做文字几何体检（纯函数：不读文件、不联网、确定性输出）。
 * @param {string} markup 完整 SVG 标记（工具层已读文件或内联字符串）
 * @param {{name?: string, intentDir?: string}} [options]
 *   name 只用于报告里的 target；intentDir 给定时从该目录读 .design-intent.json
 *   （文件模式的 .svg 用；内联标记没有目录，故不传）
 * @returns 统一报告（common.js finalize：mode/score/grade/counts/metrics/findings）
 */
export function auditSvg(markup, { name = "svg", intentDir } = {}) {
	const target = typeof name === "string" && name.trim() !== "" ? name : "svg";
	if (typeof markup !== "string" || markup.trim() === "") {
		throw new Error("SVG 标记为空：action=svg 需要完整 SVG 标记或 .svg 路径");
	}
	if (!/<svg\b/i.test(markup)) {
		throw new Error("不是 SVG 标记：缺少 <svg> 根元素（action=svg 只收 SVG 标记 / .svg 文件，图片请用 action=image）");
	}

	const canvas = parseCanvas(markup);
	const scan = scanElements(markup);
	const elements = scan.texts.map((element, index) => {
		element.index = index;
		for (const line of element.lines) line.elIndex = index;
		return element;
	});
	const lines = elements.flatMap((element) => element.lines);
	const measuredCount = elements.length;
	const { scale } = canvas;
	const canvasW = canvas.w;
	const canvasH = canvas.h;
	const canvasPxW = canvasW * scale;
	const canvasPxH = canvasH * scale;

	/* ------------------------------ metrics ------------------------------ */

	const fontSizes = [...new Set(lines.map((line) => round2(line.fs)))].sort((a, b) => a - b);

	// 正文 = 出现最多的字号（并列时取更小的那个：正文通常是小的）
	const fontCount = new Map();
	for (const line of lines) fontCount.set(line.fs, (fontCount.get(line.fs) ?? 0) + 1);
	let bodySize = 0;
	let bodyCount = 0;
	let maxSize = 0;
	for (const [fontSize, count] of fontCount) {
		if (fontSize > maxSize) maxSize = fontSize;
		if (count > bodyCount || (count === bodyCount && fontSize < bodySize)) {
			bodySize = fontSize;
			bodyCount = count;
		}
	}
	const hierarchyRatio = measuredCount > 0 && bodySize > 0 ? round2(maxSize / bodySize) : 0;

	const textBox = unionBoxes(lines.map((line) => line.bbox));
	/** 从 bbox 算四边距（%）；bbox 为空时返回 null（不能编造成 0——读者会以为内容顶到四边）。 */
	const marginsOf = (box) =>
		box === null
			? null
			: {
					left: round2(((box.x - canvas.minX) / canvasW) * 100),
					top: round2(((box.y - canvas.minY) / canvasH) * 100),
					right: round2(((canvas.minX + canvasW - (box.x + box.w)) / canvasW) * 100),
					bottom: round2(((canvas.minY + canvasH - (box.y + box.h)) / canvasH) * 100)
				};
	// G1 只量文字（图形贴边是另一种语言，不属于排版）；metrics 里报的则是**内容**边距。
	const textMargins = marginsOf(textBox);

	// 背景板识别：面积 ≥90% 画布的纯图形（满版 rect / 渐变底）视为背景，不进内容 bbox / G9。
	// 文字是独立元素，叠在背景上不算「图形内部承载文字」；G1 本来也只量文字 bbox。
	const canvasArea = canvasW * canvasH;
	const contentGraphics = [];
	let backgroundPlates = 0;
	for (const box of scan.graphics) {
		if ((box.w * box.h) / canvasArea >= BACKGROUND_PLATE_AREA_RATIO) backgroundPlates += 1;
		else contentGraphics.push(box);
	}
	const contentBox = unionBoxes([...lines.map((line) => line.bbox), ...contentGraphics]);
	const coveragePct =
		contentBox === null
			? 0
			: round2(((contentBox.w * contentBox.h) / (canvasW * canvasH)) * 100);
	// 对外报的边距是「内容」边距（文字 ∪ 非背景图形），与 G0-no-text 的提示一致。
	const margins = marginsOf(contentBox) ?? { left: 0, top: 0, right: 0, bottom: 0 };

	const minFontPx = measuredCount > 0 ? round2(Math.min(...lines.map((line) => line.fs)) * scale) : 0;

	/* ---------------------- 对比度：文字 fill vs 背景色 ---------------------- */
	// 背景候选：面积 ≥ 20% 画布、且 fill 可解析的图形（含满版底色）。
	// 只对「真的能确定背景」的文字做对比度：透明底 SVG 无法得知实际背景，宁可跳过不瞎报。
	const backgroundShapes = scan.graphics
		.filter((box) => (box.w * box.h) / canvasArea >= 0.2 && parseColor(box.fill) !== null)
		.sort((a, b) => b.w * b.h - a.w * a.h);
	const contrastPairs = [];
	// 同一组「前景色 + 背景色 + 字号 + 字重」只算一次，否则 10 行同样颜色的次要文字
	// 会报出 10 条一模一样的对比度 error，把真正的热点淹了。
	const contrastSeen = new Map();
	if (backgroundShapes.length > 0) {
		for (const element of elements) {
			const box = element.bbox;
			if (box === null || box === undefined) continue;
			const cx = box.x + box.w / 2;
			const cy = box.y + box.h / 2;
			// 取「包含该文字中心、且面积最小」的背景层：它才是文字实际压着的那一层
			const covering = backgroundShapes
				.filter((s) => cx >= s.x && cx <= s.x + s.w && cy >= s.y && cy <= s.y + s.h)
				.sort((a, b) => a.w * a.h - b.w * b.h)[0];
			if (covering === undefined) continue;
			const pair = {
				fg: String(element.fill ?? ""),
				bg: String(covering.fill ?? ""),
				fontSizePx: element.lines[0]?.fs !== undefined ? element.lines[0].fs * scale : DEFAULT_FONT_SIZE * scale,
				bold: /^(bold|[6-9]00)$/.test(String(element.weight).trim())
			};
			const key = `${pair.fg}|${pair.bg}|${Math.round(pair.fontSizePx)}|${pair.bold}`;
			const seen = contrastSeen.get(key);
			if (seen !== undefined) {
				seen.count += 1;
				continue;
			}
			contrastSeen.set(key, { count: 1, pair });
			contrastPairs.push({ ...pair, where: labelOf(element.index, element.sample) });
		}
	}

	const metrics = {
		canvas: [round2(canvasW), round2(canvasH)],
		textCount: measuredCount,
		fontSizes,
		hierarchyRatio,
		lines: lines.length,
		marginsPct: margins,
		coveragePct,
		unmeasured: scan.unmeasured,
		backgroundPlates,
		minFontPx,
		scale: round2(scale),
		// 边距到底是量文字还是量全部内容：没文字时 / 图形比文字外扩时不一样，
		// 明说一句，避免读者把「内容边距」当成「文字边距」。
		...(textMargins !== null ? { textMarginsPct: textMargins } : {}),
		...(contentBox === null ? { contentEmpty: true } : {}),
		// 覆盖度：哪些规则因为「量不到」而被跳过。breaklint 的做法——
		// 报告必须区分「检查了且通过」与「压根没检查」，否则 score 会骗人。
		...(contrastPairs.length > 0 ? { contrastChecked: contrastPairs.length } : {})
	};

	/* ------------------------------ findings ------------------------------ */

	const findings = [];
	const push = (item) => findings.push(item);

	// G0：解析层信息（默认字号 / transform 内文字 / 完全没有文字）
	const defaultedCount = elements.filter((element) => element.usedDefault).length;
	if (scan.unmeasured > 0) {
		push(
			finding({
				severity: "info",
				rule: "G0-transform-unmeasured",
				message: `${scan.unmeasured} 个 <text> 位于 transform 分组内，坐标系不可靠，未参与文字几何判定（unmeasured=${scan.unmeasured}）`,
				fix: "把 transform 展开成绝对坐标（或在导出时取消分组变换）后重新体检；否则这些文字的字号/边距/重叠都量不到",
				where: `${scan.unmeasured} 个 transform 内文字`
			})
		);
	}
	if (defaultedCount > 0) {
		push(
			finding({
				severity: "info",
				rule: "G0-default-font-size",
				message: `${defaultedCount} 个 <text> 没有写 font-size，按浏览器默认 ${DEFAULT_FONT_SIZE} 估算`,
				fix: `显式写 font-size（海报/卡片请写绝对 px 或用字号 token），否则不同导出工具会给出不同默认值`,
				where: labelOf(elements.find((element) => element.usedDefault)?.index ?? 0, elements.find((element) => element.usedDefault)?.sample ?? "")
			})
		);
	}
	if (scan.rawTextCount === 0) {
		push(
			finding({
				severity: "info",
				rule: "G0-no-text",
				message:
					`SVG 里没有 <text> 元素：文字层级/行距/对齐/最小字号都无从体检` +
					(scan.graphics.length > 0 ? `（${scan.graphics.length} 个图形仍计入内容包围盒与留白）` : "（画布完全空白）"),
				fix: "让文案保持为可编辑 <text>（不要转曲成 path），或改用 action=image 量渲染后的构图",
				where: "整张画布"
			})
		);
	}

	// G1 边界/安全区：所有文字 bbox 到四边的最小距离百分比
	if (textBox !== null && textMargins !== null) {
		const sides = [
			{ name: "左", value: textMargins.left },
			{ name: "上", value: textMargins.top },
			{ name: "右", value: textMargins.right },
			{ name: "下", value: textMargins.bottom }
		];
		const minMargin = Math.min(...sides.map((side) => side.value));
		const worstSides = sides
			.filter((side) => side.value < (minMargin < SAFE_ERROR_PCT ? SAFE_ERROR_PCT : SAFE_WARN_PCT))
			.sort((a, b) => a.value - b.value);
		const worstText = elements
			.map((element) => ({ element, box: element.bbox }))
			.sort((a, b) => marginOfBox(a.box, canvas) - marginOfBox(b.box, canvas))[0];
		const where = worstText === undefined ? undefined : labelOf(worstText.element.index, worstText.element.sample);
		const detail = worstSides.map((side) => `${side.name} ${side.value}%`).join("、");
		if (minMargin < SAFE_ERROR_PCT) {
			push(
				finding({
					severity: "error",
					rule: "G1",
					message: `文字贴边：${detail}（安全区要求 ≥${SAFE_ERROR_PCT}%，海报/印刷会裁切或缺呼吸感）`,
					fix: `四周留白至少 ${SAFE_WARN_PCT}%（海报建议 8%）：把最靠边的文字往内移，或缩小字号/缩短文案`,
					where
				})
			);
		} else if (minMargin < SAFE_WARN_PCT) {
			push(
				finding({
					severity: "warn",
					rule: "G1",
					message: `文字离画布边缘偏近：${detail}（建议 ≥${SAFE_WARN_PCT}%）`,
					fix: `把最近的文字内缩到 ${SAFE_WARN_PCT}% 以上的安全区，避免裁切风险`,
					where
				})
			);
		}
	}

	// G2 字号层级不足。文字块 ≤2 或只有一种字号时，版面多半是单行 banner / 徽标 / 按钮，
	// 「层级」这个概念不成立 → 降为 info（不硬扣 15 分）；真正该报的是「多行正文 + 无层级」。
	if (measuredCount > 0 && fontSizes.length > 0) {
		const fewTexts = measuredCount <= 2;
		const hierarchySeverity = (normal) => (fewTexts ? "info" : normal);
		if (fontSizes.length < 2) {
			push(
				finding({
					severity: hierarchySeverity("error"),
					rule: "G2",
					message: fewTexts
						? `单行/徽标类版面（${measuredCount} 个文字块，仅 1 种字号 ${fontSizes[0]}），无层级可评估`
						: `只有一种字号（${fontSizes[0]}）：没有标题/正文层级，读者抓不到重点`,
					fix: fewTexts
						? "单行/徽标类版面可以只有一档字号；一旦有正文段落，再补标题级字号（≥2×）"
						: "至少两档字号：标题 ≥2× 正文（推荐 2–3.2×），正文之外再加档弱化文案",
					where: labelOf(elements[0].index, elements[0].sample)
				})
			);
		} else if (hierarchyRatio < HIERARCHY_ERROR_RATIO) {
			push(
				finding({
					severity: hierarchySeverity("error"),
					rule: "G2",
					message: fewTexts
						? `单行/徽标类版面（${measuredCount} 个文字块），层级仅供参考：最大/正文 ${hierarchyRatio}×`
						: `层级几乎不可见：最大字号 ${maxSize} / 正文 ${bodySize} = ${hierarchyRatio}×（<${HIERARCHY_ERROR_RATIO}）`,
					fix: `拉开到 2× 以上（标题 ${round2(bodySize * 2)} 左右），把标题加粗或加大`,
					where: labelOf(elements[0].index, elements[0].sample)
				})
			);
		} else if (hierarchyRatio < HIERARCHY_WARN_RATIO) {
			push(
				finding({
					severity: hierarchySeverity("warn"),
					rule: "G2",
					message: fewTexts
						? `单行/徽标类版面（${measuredCount} 个文字块），层级仅供参考：最大/正文 ${hierarchyRatio}×`
						: `字号层级偏弱：最大/正文仅 ${hierarchyRatio}×（<${HIERARCHY_WARN_RATIO}×，标题不够突出）`,
					fix: `标题字号拉到正文的 2–3×（当前正文 ${bodySize}，标题 ${maxSize}）`,
					where: labelOf(elements[0].index, elements[0].sample)
				})
			);
		}
		if (fontSizes.length > MAX_FONT_STEPS) {
			push(
				finding({
					severity: "warn",
					rule: "G2",
					message: `字号档位过多（${fontSizes.length} 种，>${MAX_FONT_STEPS}）：像随手挑的字号，缺系统感`,
					fix: "收敛到 3–4 档（标题/副标题/正文/注释），把相近档位合并",
					where: `字号：${fontSizes.join(" / ")}`
				})
			);
		}
	}

	// G3 行距（同块相邻基线间距 / 字号）
	const leadingCandidates = [];
	for (const group of groupLinesByBlock(lines, scale)) {
		if (group.lines.length < 2) continue;
		const sorted = [...group.lines].sort((a, b) => a.y - b.y);
		const fontSize = group.fs;
		const ratios = [];
		for (let i = 1; i < sorted.length; i += 1) {
			const delta = sorted[i].y - sorted[i - 1].y;
			if (delta <= 0) continue; // 同一基线不是“行距”，交给 G6 重叠判
			const ratio = delta / fontSize;
			if (ratio > LEADING_BLOCK_MAX_RATIO) continue; // 超过 6× 字号视为不同段落（防页脚误报）
			ratios.push({ ratio, line: sorted[i], prev: sorted[i - 1] });
		}
		if (ratios.length === 0) continue;
		const tightest = ratios.reduce((min, item) => (item.ratio < min.ratio ? item : min), ratios[0]);
		const loosest = ratios.reduce((max, item) => (item.ratio > max.ratio ? item : max), ratios[0]);
		const where = labelOf(tightest.line.elIndex, elements[tightest.line.elIndex]?.sample ?? "");
		// 展示级大字号（≥40px）本来就该紧排：1080 海报上 92px 标题行距 1.17× 是正常排版，
		// 用正文的 1.15/1.3 阈值会把专业海报误判成行距问题。32px 级标题仍按正文阈值卡。
		const displayType = fontSize * scale >= 40;
		const tightError = displayType ? 0.95 : LEADING_TIGHT_ERROR;
		const tightWarn = displayType ? 1.05 : LEADING_TIGHT_WARN;
		if (tightest.ratio < tightError) {
			leadingCandidates.push({
				severity: "error",
				ratio: tightest.ratio,
				item: finding({
					severity: "error",
					rule: "G3",
					message: `行距过密：同一段相邻基线仅 ${round2(tightest.ratio)}×字号（<${tightError}，行贴行会串读）`,
					fix: `行距至少 ${tightError}×（正文推荐 1.4–1.6×，32px 以上标题 1.05–1.2×）：加大相邻文字的 y 或改回 line-height`,
					where
				})
			});
		} else if (tightest.ratio < tightWarn || loosest.ratio > LEADING_LOOSE_WARN) {
			const reason =
				loosest.ratio > LEADING_LOOSE_WARN
					? `行距过大：${round2(loosest.ratio)}×字号（>${LEADING_LOOSE_WARN}，段落被拆散）`
					: `行距偏紧：${round2(tightest.ratio)}×字号（建议 1.3–1.6×）`;
			leadingCandidates.push({
				severity: "warn",
				ratio: tightest.ratio,
				item: finding({
					severity: "warn",
					rule: "G3",
					message: reason,
					fix: "正文行距取 1.4–1.6×字号，标题可 1.1–1.2×；同一段内保持一致",
					where
				})
			});
		}
	}
	leadingCandidates
		.sort((a, b) => (a.severity === b.severity ? a.ratio - b.ratio : a.severity === "error" ? -1 : 1))
		.slice(0, MAX_PER_RULE)
		.forEach((candidate) => push(candidate.item));

	// G4 行长失控（估算宽度占比 / 单行 CJK 字数）
	if (lines.length > 0) {
		let widest = { ratio: 0, line: lines[0] };
		let longestCjk = { count: 0, line: lines[0] };
		for (const line of lines) {
			const ratio = line.bbox.w / canvasW;
			if (ratio > widest.ratio) widest = { ratio, line };
			const cjk = line.segments.reduce((sum, segment) => sum + countWideChars(segment.text), 0);
			if (cjk > longestCjk.count) longestCjk = { count: cjk, line };
		}
		if (widest.ratio > LINE_WIDTH_WARN_RATIO) {
			push(
				finding({
					severity: "warn",
					rule: "G4",
					message: `单行过长：估算宽度占画布 ${round2(widest.ratio * 100)}%（>${LINE_WIDTH_WARN_RATIO * 100}%，读起来容易串行）`,
					fix: "把长句断开成多行（每行 30–45 个汉字 / 60–75 个拉丁字符），或加大左右留白",
					where: labelOf(widest.line.elIndex, elements[widest.line.elIndex]?.sample ?? "")
				})
			);
		}
		if (longestCjk.count > CJK_PER_LINE_WARN) {
			push(
				finding({
					severity: "warn",
					rule: "G4",
					message: `单行 ${longestCjk.count} 个汉字（>${CJK_PER_LINE_WARN}）：超过舒适阅读行长`,
					fix: "中文正文每行 20–35 字最舒适；把这段拆成多行或缩小字号",
					where: labelOf(longestCjk.line.elIndex, elements[longestCjk.line.elIndex]?.sample ?? "")
				})
			);
		}
	}

	// G5 文字溢出画布（超过 1px 才算：亚像素是导出误差）
	if (lines.length > 0) {
		let worst = { over: 0, side: "", line: lines[0] };
		for (const line of lines) {
			const box = line.bbox;
			const leftPx = (box.x - canvas.minX) * scale;
			const topPx = (box.y - canvas.minY) * scale;
			const rightPx = (box.x + box.w - canvas.minX) * scale;
			const bottomPx = (box.y + box.h - canvas.minY) * scale;
			const overs = [
				{ over: -leftPx, side: "左" },
				{ over: -topPx, side: "上" },
				{ over: rightPx - canvasPxW, side: "右" },
				{ over: bottomPx - canvasPxH, side: "下" }
			].sort((a, b) => b.over - a.over);
			if (overs[0].over > worst.over) worst = { over: overs[0].over, side: overs[0].side, line };
		}
		if (worst.over > 1) {
			push(
				finding({
					severity: "error",
					rule: "G5",
					message: `文字溢出画布：${worst.side}侧超出 ${round2(worst.over)}px（导出/印刷会被裁掉）`,
					fix: "把这块文字往画布内移或缩小字号；长文案先断行再定位",
					where: labelOf(worst.line.elIndex, elements[worst.line.elIndex]?.sample ?? "")
				})
			);
		}
	}

	// G6 文字重叠：只比「不同文本块」的行。同 x 锚 + 同字号 + 连续基线的相邻行属于同一文本块，
	// 块内行贴行是行距问题（G3），不算「两个文本块重叠」。
	if (measuredCount >= 2) {
		const blockIds = assignTextBlocks(lines, scale);
		const worstByPair = new Map();
		for (let i = 0; i < lines.length; i += 1) {
			for (let j = i + 1; j < lines.length; j += 1) {
				const first = lines[i];
				const second = lines[j];
				if (first.elIndex === second.elIndex) continue; // 同一个 <text> 的 tspan 行不算重叠
				if (blockIds.get(first) === blockIds.get(second)) continue; // 同一文本块内部不算重叠
				const minArea = Math.min(first.bbox.w * first.bbox.h, second.bbox.w * second.bbox.h);
				if (minArea <= 0) continue;
				const ratio = intersectionArea(first.bbox, second.bbox) / minArea;
				if (ratio <= OVERLAP_ERROR_RATIO) continue;
				const low = Math.min(first.elIndex, second.elIndex);
				const high = Math.max(first.elIndex, second.elIndex);
				const key = `${low}-${high}`;
				const previous = worstByPair.get(key);
				if (previous === undefined || ratio > previous.ratio) worstByPair.set(key, { ratio, i: low, j: high });
			}
		}
		[...worstByPair.values()]
			.sort((a, b) => b.ratio - a.ratio)
			.slice(0, MAX_PER_RULE)
			.forEach((overlap) => {
				push(
					finding({
						severity: "error",
						rule: "G6",
						message: `文字重叠：${labelOf(overlap.i, elements[overlap.i].sample)} 与 ${labelOf(overlap.j, elements[overlap.j].sample)} 重叠 ${round2(overlap.ratio * 100)}%（>${OVERLAP_ERROR_RATIO * 100}%）`,
						fix: "移动其中一块的位置（或缩短文案）让二者留出间距；多行块先确认 dy 累加没有重叠",
						where: `${labelOf(overlap.i, elements[overlap.i].sample)} × ${labelOf(overlap.j, elements[overlap.j].sample)}`
					})
				);
			});
	}

	// G7 对齐关系：优先信 text-anchor（作者声明的对齐方式）；没有声明时按边界回退
	// （左边界全等 → 左；右边界全等 → 右；左边界不等但中心全等 → 居中）。
	// 这样「等宽左对齐段落」（左/中/右边界全相等）只会归入左对齐，不会误判成对齐打架。
	if (lines.length >= ALIGN_MIN_LINES) {
		const tolerance = ALIGN_TOLERANCE_PX / scale;
		const modeCounts = { left: 0, center: 0, right: 0 };
		// text-anchor 的值是 start/middle/end，对齐方式键是 left/center/right，这里做一次映射
		const anchorMode = { start: "left", middle: "center", end: "right" };
		const unanchored = [];
		for (const line of lines) {
			if (line.anchorExplicit) modeCounts[anchorMode[line.anchor] ?? "left"] += 1;
			else unanchored.push(line);
		}
		if (unanchored.length >= 2) {
			const total = unanchored.length;
			const leftMax = maxClusterSize(unanchored.map((line) => line.bbox.x), tolerance);
			const rightMax = maxClusterSize(unanchored.map((line) => line.bbox.x + line.bbox.w), tolerance);
			const centerMax = maxClusterSize(unanchored.map((line) => line.bbox.x + line.bbox.w / 2), tolerance);
			if (leftMax === total) modeCounts.left += total;
			else if (rightMax === total) modeCounts.right += total;
			else if (centerMax === total) modeCounts.center += total;
			// 都不满足 → 这些行没有共同对齐方式，不计入任何 mode（会落入下面的「没有对齐关系」）
		}
		const modeNames = { left: "左对齐", center: "居中", right: "右对齐" };
		const present = Object.entries(modeCounts)
			.map(([mode, count]) => ({ mode, name: modeNames[mode], count }))
			.filter((item) => item.count >= 2)
			.sort((a, b) => b.count - a.count);
		if (present.length === 0) {
			push(
				finding({
					severity: "warn",
					rule: "G7",
					message: `没有任何对齐关系：${lines.length} 行文字的左右边界与中心都各自为政，版面显乱`,
					fix: "让至少 2 行共享同一条左边界（或中心/右边界）；网格对齐之后再看留白",
					where: "整张画布"
				})
			);
		} else if (present.length >= 2) {
			push(
				finding({
					severity: "warn",
					rule: "G7",
					message: `对齐方式打架：${present.map((item) => `${item.name} ${item.count} 行`).join(" vs ")}，不同对齐方式都成规模`,
					fix: "选一个主对齐方式（海报多用左对齐/居中），另一组统一到同一条轴线",
					where: `对齐簇：${present.map((item) => `${item.name} ${item.count}`).join(" / ")}`
				})
			);
		}
	}

	// G8 最小字号（渲染后像素：字号 × viewBox 缩放）
	if (measuredCount > 0) {
		const smallest = Math.min(...lines.map((line) => line.fs));
		const minPx = smallest * scale;
		const where = labelOf(
			lines.find((line) => line.fs === smallest)?.elIndex ?? 0,
			elements[lines.find((line) => line.fs === smallest)?.elIndex ?? 0]?.sample ?? ""
		);
		if (minPx < FONT_PX_ERROR) {
			push(
				finding({
					severity: "error",
					rule: "G8",
					message: `最小字号渲染后只有 ${round2(minPx)}px（${round2(smallest)} × 缩放 ${round2(scale)}，<${FONT_PX_ERROR}px 不可读）`,
					fix: `把最小字号提到渲染后 ≥${FONT_PX_WARN}px；印刷品正文建议 ≥3mm（约 8.5pt）`,
					where
				})
			);
		} else if (minPx < FONT_PX_WARN) {
			push(
				finding({
					severity: "warn",
					rule: "G8",
					message: `最小字号渲染后 ${round2(minPx)}px（<${FONT_PX_WARN}px 偏小，实际尺寸下难读）`,
					fix: `把最小字号提到渲染后 ≥${FONT_PX_WARN}px，或缩小画布尺寸让文字相对变大`,
					where
				})
			);
		}
	}

	// G9 留白/密度：内容包围盒 / 画布面积
	if (contentBox !== null) {
		if (coveragePct > COVERAGE_CROWDED_PCT) {
			push(
				finding({
					severity: "warn",
					rule: "G9",
					message: `内容包围盒占画布 ${coveragePct}%（>${COVERAGE_CROWDED_PCT}%）：留白不足，版面拥挤`,
					fix: `留白至少 ${round2(100 - COVERAGE_CROWDED_PCT)}%（海报建议 30–40% 视觉留白）：缩小内容或加大画布`,
					where: "整张画布"
				})
			);
		} else if (coveragePct < COVERAGE_EMPTY_PCT) {
			push(
				finding({
					severity: "info",
					rule: "G9",
					message: `内容只占画布 ${coveragePct}%（<${COVERAGE_EMPTY_PCT}%）：可能空版，或内容没导出/被裁掉`,
					fix: "确认文字/图层都在画布内；若是有意的极简留白，可忽略这条 info",
					where: "整张画布"
				})
			);
		}
	}

	/* --------------------- 对比度（WCAG AA/AAA + APCA） --------------------- */
	// 行业实践：typography-skills 与 layout-lint-mcp 都做对比度。我们不需要测渲染像素——
	// SVG 的 text fill 与下面的形状 fill 都是声明的，能直接算。
	if (contrastPairs.length > 0) {
		// 级别映射：WCAG AA 是**Web 内容**的可访问性标准；SVG 成品往往是海报/印刷/大屏，
		// 同一套阈值不能当“error”。所以 svg 模式把 AA 的 error 降为 warn（仍然报，但不当伞）。
		// web 场景（action=ui）保持 error。
		for (const item of auditContrast(contrastPairs)) {
			findings.push(item.severity === "error" ? { ...item, severity: "warn" } : item);
		}
	}

	/* --------------------------- 基线网格 --------------------------- */
	// 只对「成段正文」判：海报/封面是稀疏的自由排版（6 行、间距 108~436），
	// 拿 8px 基线网格去量它必然误报。所以额外要求「行间距中位数 ≤ 2.5×字号」——
	// 行贴行才算成段（此时垂直节奏才有约束意义）。
	const sortedY = [...lines].map((l) => l.y).sort((a, b) => a - b);
	const gaps = [];
	for (let i = 1; i < sortedY.length; i += 1) if (sortedY[i] > sortedY[i - 1]) gaps.push(sortedY[i] - sortedY[i - 1]);
	const medianGap = gaps.length === 0 ? 0 : [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
	const medianFs = fontSizes.length === 0 ? 0 : fontSizes[Math.floor(fontSizes.length / 2)];
	const isParagraph = medianFs > 0 && medianGap > 0 && medianGap <= medianFs * 2.5;
	if (lines.length >= 4 && isParagraph) {
		findings.push(
			// 用 4px 网格而不是 8：正文 20px × 行高 1.4 = 28px 是合法节奏，但它不是 8 的倍数
			// （420%8=4）。拿 8 去量会把标准行高的段落判成「节奏失控」。
			// 4px 也是我们自己的质量底线口径（提示段里就是「4px grid」）。
			...auditBaselineGrid(
				lines.map((line) => ({ y: line.y, height: line.fs, where: labelOf(line.elIndex, elements[line.elIndex]?.sample ?? "") })),
				{ grid: 4 }
			)
		);
	}

	/* ------------------------- 覆盖度声明 ------------------------- */
	// 不把「量不到」包装成 clean：没文字时 score 会很漂亮但什么都没测。
	// 这里给一条 info，让报告能区分「过了」与「没测」。
	const measuredKinds = [];
	if (measuredCount > 0) measuredKinds.push("文字几何");
	if (contrastPairs.length > 0) measuredKinds.push(`对比度×${contrastPairs.length}`);
	if (scan.graphics.length > 0) measuredKinds.push(`图形×${scan.graphics.length}`);
	const rulesRun = [];
	if (measuredCount > 0) rulesRun.push("G1", "G2", "G4", "G5", "G8");
	if (lines.length >= 2) rulesRun.push("G3");
	if (measuredCount >= 2) rulesRun.push("G6");
	if (lines.length >= 4) rulesRun.push("G7", "structure-baseline");
	if (contentBox !== null) rulesRun.push("G9");
	if (contrastPairs.length > 0) rulesRun.push("contrast");
	/* --- 声明豁免：.design-intent.json ----------------------------------------- */
	const intent = readIntent(intentDir);
	const applied = applyAllow(findings, intent);
	const metricsWithCoverage = {
		...metrics,
		rulesRun: rulesRun.length,
		measured: measuredKinds,
		...(applied.exempted.length > 0 ? { exempted: applied.exempted } : {})
	};

	return finalize({
		mode: "svg",
		target,
		metrics: metricsWithCoverage,
		findings: applied.kept,
		// finalize 只透传 extras，不能写成兄弟键
		...(applied.exempted.length > 0
			? {
					extras: {
						intent: { allow: applied.exempted, ...(applied.exemptionReason !== undefined ? { reason: applied.exemptionReason } : {}) }
					}
				}
			: {})
	});
}

/** 文字 bbox 到画布四边的最小距离百分比（G1 定位用）。 */
function marginOfBox(box, canvas) {
	return Math.min(
		(box.x - canvas.minX) / canvas.w,
		(box.y - canvas.minY) / canvas.h,
		(canvas.minX + canvas.w - (box.x + box.w)) / canvas.w,
		(canvas.minY + canvas.h - (box.y + box.h)) / canvas.h
	);
}
