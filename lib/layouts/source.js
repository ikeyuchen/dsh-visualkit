/**
 * layouts/source.js — layout_check action=ui：UI 源码的排版体检（规则 S1–S9）。
 *
 * 目标：在「看着还行」和「读起来累」之间给出可机械判定的差异，并附具体修法。
 * 输出契约见 ./common.js：这里只产出 finding + metrics，评分/分级交给 finalize。
 *
 * 扫描范围：单文件或目录；扩展名 .html/.htm/.css/.vue/.svelte/.jsx/.tsx/.astro/.js/.mjs/.ts。
 * 跳过 node_modules/.git/dist/build/vendor/coverage/test/tests/__tests__/fixtures/spec
 * 与所有点目录；每文件读上限 2MB；总文件上限 600。
 *
 * 判据与边界（为什么这样切）：
 *   - 只看「显式声明」：font-size / line-height / letter-spacing / text-align /
 *     max-width(width) / font-family。继承值不追踪（源码体检不是浏览器），
 *     所以 clean 样本里正文规则必须显式写 line-height，否则会按「未声明」提示。
 *   - 字号只解析 px / rem(×16) / em(按父级=正文近似) / pt / %；clamp()/calc()/vw 与
 *     CSS 变量以外的动态值一律跳过而不是猜（宁可漏报，不误报）。CSS 变量
 *     (--fs-body 之类) 做一层简单求值，这是现代 CSS 最常见的写法。JS 内联样式对象
 *     （fontSize: 16）按 px 处理。
 *   - 中文项目与英文项目的阈值不同（行长/字距/对齐都有中文特例），CJK 判定取
 *     「去注释后任一文件含中文字符」；单条规则再次要求「同一文件含中文」时才命中。
 *   - 正文（bodySize）= 出现次数最多的字号；并列时取最接近 16px 的（典型正文），
 *     再并列取较小值——保证同输入结果稳定、不依赖遍历顺序。
 *   - 每条规则最多保留 4 条 finding（位置热点比穷举有用，也避免报告被刷屏）；
 *     没解析到任何字号时给 info S0，空目录给 info S0，明确说明「没有样本」而不是
 *     假装 0 分干净。
 */
import { open, readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { finding, finalize } from "./common.js";
import { auditPunct } from "./rules-punct.js";
import { auditContrast, parseColor } from "./rules-contrast.js";
import { auditHeadingOrder, auditTouchTargets } from "./rules-structure.js";
import { applyAllow, readIntent } from "./intent.js";
import { isSkippableDir, TEST_FILE_RE } from "../skip.js";

/** 参与扫描的源码扩展名（含 JS 系是为了 CSS-in-JS / 内联样式字符串）。 */
const EXTS = [".html", ".htm", ".css", ".vue", ".svelte", ".jsx", ".tsx", ".astro", ".js", ".mjs", ".ts"];
/** 依赖 / 构建产物 / 测试样本目录不体检（fixture 里故意写的坏排版不算项目问题）。 */
// 目录/文件跳过规则统一在 lib/skip.js（与 taste_check taste 共用一份）。
const PER_FILE_CAP = 2 * 1024 * 1024;
const MAX_FILES = 600;
/**
 * 全局 findings 上限。
 * 每条规则已按文件封顶，但大项目文件多，总量仍会涨：实测 Echo（600 文件）
 * 返回 254 条，JSON 约 50 KB —— 每次调用都吃这么多上下文，而模型只看前 10 条。
 */
const MAX_FINDINGS = 60;
/** 每条规则最多报几条：热点定位比穷举有用，score 也会被 100 封顶。 */
const PER_RULE_CAP = 4;
/**
 * 行长候选的最小宽度：低于这个值多半是按钮 / 徽标 / 图标容器，不是正文栏，
 * 拿来算「每行多少字」会误报。240px @16px 约 15 字，已经是很窄的正文栏。
 */
const MIN_MEASURE_WIDTH = 240;
/**
 * 正文栏选择器特征（整数宽度 + 字号一起声明时豁免）：只有这类规则才当作「文本栏」看。
 * 页面容器（.sheet{max-width:1120px}）不带字号，不能拿正文尺寸去除——那是假误报。
 */
const MEASURE_SELECTOR_RE = /(?:^|[\s,>+~.])(?:p|article|blockquote|dd|li|section|main|header|footer|intro|lede|prose|content|body|copy|text|desc|summary|excerpt)(?:$|[\s,.:#\[.>+~])/i;
// TEST_FILE_RE 来自 lib/skip.js（与 taste_check taste 共用）。
const CJK_RE = /[\u4e00-\u9fa5]/;
const CJK_ALL_RE = /[\u4e00-\u9fa5]/g;
/** 本文件关心的声明；其余盒模型/颜色属性一律不解析。 */
const KNOWN_PROPS = new Set([
	"font-size",
	"line-height",
	"letter-spacing",
	"text-align",
	"max-width",
	"width",
	"font-family",
	"text-transform",
	// 对比度检测需要前景/背景色；height 用于触摸目标尺寸
	"color",
	"background-color",
	"background",
	"height",
	// font 简写：`font: 14px/1.6 system-ui` 写字的项目很多，只解 font-size 会漏
	"font",
	// 字重：S2 的最小字号判定需要「字号 × 字重」，光看字号会放过 12px/400 这种糊的组合
	"font-weight",
	// S10 混排字号基线：需要知道容器是不是 flex、交叉轴怎么对齐、行内怎么对齐
	"display",
	"align-items",
	"vertical-align",
	// S11 阴影层级：要读 box-shadow 才能看出档位与光源方向
	"box-shadow",
	// S13 组件状态矩阵：交互态的样式**几乎全靠这些属性**，不收它们会漏掉整条规则——
	// 实测：`.btn:focus-visible{outline:2px solid …}` 因 outline 不在表里而被整条丢弃，
	// 于是 S13 认为「这个组件没有 focus 态」，把写得完全正确的代码判成错。
	// S14 负外边距：要靠 margin 才能看出「用负值硬拉」这种补丁
	"margin",
	"margin-top",
	"margin-bottom",
	"margin-left",
	"margin-right",
	"outline",
	"outline-offset",
	"opacity",
	"transform",
	"filter",
	"cursor",
	"border"
]);

/* ------------------------------ 基础工具 ------------------------------ */

function extOf(file) {
	const index = file.lastIndexOf(".");
	return index === -1 ? "" : file.slice(index).toLowerCase();
}

/** 文件按语法类别走不同提取器：html（含模板）、css、js（CSS-in-JS / 字符串文案）。 */
function kindOf(file) {
	const ext = extOf(file);
	if (ext === ".css") return "css";
	if (ext === ".html" || ext === ".htm" || ext === ".vue" || ext === ".svelte" || ext === ".astro") return "html";
	return "js";
}

/** 数值保留 2 位小数；非有限值收敛成 0，保证输出可 JSON 无损往返。 */
function r2(value) {
	return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

/**
 * 每文件预计算行首下标（一次 O(n)），以后定位只需二分 O(log 行数)。
 * 不用「每个块都从头数换行」：一个大 CSS（2MB、上千条规则）会退化成 O(n×块数)，
 * 工具 timeout 会在体检大项目时被拖死。
 */
function buildLineStarts(text) {
	const starts = [0];
	for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1);
	return starts;
}

/** 下标 → 1 基行号（二分查已排序的行首下标）。 */
function lineAt(starts, index) {
	let low = 0;
	let high = starts.length - 1;
	while (low < high) {
		const middle = (low + high + 1) >> 1;
		if (starts[middle] <= index) low = middle;
		else high = middle - 1;
	}
	return low + 1;
}

/** 文件的行首下标缓存（同一文件只算一次）。 */
function lineStartsOf(file) {
	if (file.lineStarts === undefined) file.lineStarts = buildLineStarts(file.stripped);
	return file.lineStarts;
}

/** 注释替换成等长空白（保留换行）—— 下标/行号仍与原文对齐，注释里的示例文案不会误报。 */
function blankOut(match) {
	return match.replace(/[^\n]/g, " ");
}

function stripComments(text, kind) {
	let out = text.replace(/\/\*[\s\S]*?\*\//g, blankOut).replace(/<!--[\s\S]*?-->/g, blankOut);
	if (kind === "js") {
		// 只处理 JS 系的行注释；`http://` 这类带冒号的协议前缀不动。
		// CSS 的 // 不是注释，HTML 里 // 可能是协议相对 URL，都不能剥。
		out = out.replace(/(^|[^:\\])\/\/[^\n]*/g, (match, prefix) => prefix + " ".repeat(match.length - prefix.length));
	}
	return out;
}

function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 取众数。并列时的取舍顺序：
 *   1) 用户指定了 prefer（正文按 16px）→ 取更接近 prefer 的；
 *   2) tie = "larger" 时取较大值（标题档位），否则取较小值。
 * 显式排序保证同一输入永远得到同一结果。
 */
function modeOf(values, { prefer = 0, tie = "smaller" } = {}) {
	if (values.length === 0) return 0;
	const counts = new Map();
	for (const value of values) {
		const key = r2(value);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	let best = 0;
	let bestCount = -1;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const [value, count] of counts) {
		const distance = prefer > 0 ? Math.abs(value - prefer) : 0;
		const better =
			count > bestCount ||
			(count === bestCount && distance < bestDistance) ||
			(count === bestCount && distance === bestDistance && (tie === "larger" ? value > best : value < best));
		if (better) {
			best = value;
			bestCount = count;
			bestDistance = distance;
		}
	}
	return best;
}

function uniqueSorted(values) {
	return [...new Set(values.map(r2))].sort((a, b) => a - b);
}

function cjkCount(text) {
	const matches = text.match(CJK_ALL_RE);
	return matches === null ? 0 : matches.length;
}

/* ------------------------------ 文件采集 ------------------------------ */

/** 读文件（上限 2MB；超限只读前 2MB，仍计入 filesScanned，不虚报扫描数）。 */
async function readCapped(file) {
	let info;
	try {
		info = await stat(file);
	} catch {
		return null;
	}
	if (!info.isFile()) return null;
	if (info.size <= PER_FILE_CAP) {
		try {
			return await readFile(file, "utf8");
		} catch {
			return null;
		}
	}
	let handle;
	try {
		handle = await open(file, "r");
		const buf = Buffer.alloc(PER_FILE_CAP);
		const { bytesRead } = await handle.read(buf, 0, PER_FILE_CAP, 0);
		return buf.subarray(0, bytesRead).toString("utf8");
	} catch {
		return null;
	} finally {
		if (handle !== undefined) await handle.close();
	}
}

function makeFile(abs, rel, raw) {
	const kind = kindOf(abs);
	return { path: abs, rel, raw, stripped: stripComments(raw, kind), kind };
}

/**
 * root（单文件/目录）→ { files:[{path,rel,raw,stripped,kind}], root, truncated }。
 * 目录广度优先、每层按文件名排序：同输入的文件顺序稳定（确定性测试依赖这点）。
 * 路径不存在抛中文错误（工具层还有一层英文 not found 兜底，这里自己也要能说人话）。
 */
async function collect(root) {
	const abs = resolve(root);
	let info;
	try {
		info = await stat(abs);
	} catch {
		throw new Error(`路径不存在：${abs}（root 应为 HTML/CSS 文件或目录）`);
	}
	if (info.isFile()) {
		if (!EXTS.includes(extOf(abs))) return { files: [], root: abs, truncated: false };
		const raw = await readCapped(abs);
		const files = raw === null ? [] : [makeFile(abs, basename(abs), raw)];
		return { files, root: abs, truncated: false };
	}
	if (!info.isDirectory()) throw new Error(`不是文件或目录：${abs}`);
	const files = [];
	const queue = [abs];
	while (queue.length > 0 && files.length < MAX_FILES) {
		const dir = queue.shift();
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
		for (const entry of entries) {
			if (files.length >= MAX_FILES) break;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!isSkippableDir(entry.name) && !entry.name.startsWith(".")) queue.push(full);
				continue;
			}
			if (!entry.isFile()) continue;
			if (!EXTS.includes(extOf(entry.name))) continue;
			if (entry.name.endsWith(".min.js") || entry.name.endsWith(".map")) continue;
			const raw = await readCapped(full);
			if (raw === null) continue;
			files.push(makeFile(full, relative(abs, full).split(sep).join("/"), raw));
		}
	}
	return { files, root: abs, truncated: files.length >= MAX_FILES };
}

/* ------------------------------ CSS 解析 ------------------------------ */

/** 声明名归一：fontSize → font-size、maxWidth → max-width（JS 内联样式对象也用这套）。 */
function normalizeProp(name) {
	return name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`).toLowerCase();
}

/**
 * 从一段声明体里解析属性;值（同时兼容 CSS `a: b;` 与 JS 对象 `a: b,`）。
 * JS 对象同一行多个属性时，值截到下一个「名字:」之前；CSS 的 font-family 逗号栈
 * 不会命中这个模式（逗号后没有冒号），所以不会被截断。
 */
function parseDecls(body) {
	const out = [];
	// 值的结束条件：`;` / `}` / 换行，或「逗号 + 下一个属性名:」。最后一条是为了
	// 同时支持 JS 对象写法 `{ fontSize: 16, lineHeight: 1.2 }`（同一行多属性）
	// 而不会把 font-family 的逗号栈（「A, B, sans-serif」后面没有冒号）截断。
	const re = /(?:^|[;{}\n,])\s*([A-Za-z][A-Za-z0-9-]*)\s*:\s*([^;{}\n]+?)(?=;|}|\n|,\s*[A-Za-z][A-Za-z0-9-]*\s*:|$)/g;
	let match;
	while ((match = re.exec(body)) !== null) {
		const prop = normalizeProp(match[1]);
		if (!KNOWN_PROPS.has(prop)) continue;
		const value = match[2].trim();
		if (value === "") continue;
		out.push({ prop, value, index: match.index });
	}
	return out;
}

/**
 * 抽出所有「叶子」{} 块（CSS 规则 / JS 对象字面量）。
 * 有子块的外层（@media、函数体）不解析，避免把内部声明重复统计一遍。
 * 内联 style="..." 单独补一轮（它不在花括号里）。
 */
function parseRules(file) {
	const rules = [];
	const text = file.stripped;
	const lineStarts = lineStartsOf(file);
	const stack = [];
	const blocks = [];
	// 顶层选择器的起点 = 上一条规则结束处（不能写死 0：大 CSS 会退化成 O(n²) 切片）
	let topCursor = 0;
	for (let i = 0; i < text.length; i += 1) {
		const char = text[i];
		if (char === "{") {
			if (stack.length > 0) stack[stack.length - 1].hasChild = true;
			stack.push({ open: i, selectorStart: stack.length > 0 ? stack[stack.length - 1].open + 1 : topCursor, hasChild: false });
		} else if (char === "}") {
			const open = stack.pop();
			if (open === undefined) continue;
			if (stack.length === 0) topCursor = i + 1;
			const selector = text
				.slice(open.selectorStart, open.open)
				.split(/[;{}]/)
				.pop()
				.trim()
				.replace(/\s+/g, " ");
			blocks.push({ selector, body: text.slice(open.open + 1, i), bodyStart: open.open + 1, hasChild: open.hasChild });
		}
	}
	for (const block of blocks) {
		if (block.hasChild) continue;
		const decls = parseDecls(block.body);
		if (decls.length > 0) rules.push({ file, selector: block.selector, line: lineAt(lineStarts, block.bodyStart), decls });
	}
	const inlineRe = /style\s*=\s*["']([^"']*)["']/g;
	let inline;
	while ((inline = inlineRe.exec(text)) !== null) {
		const decls = parseDecls(inline[1]);
		if (decls.length > 0) rules.push({ file, selector: "inline", line: lineAt(lineStarts, inline.index), decls });
	}
	return rules;
}

/** 取某个属性的第一条声明（同规则内重复声明取首条；!important 不影响本体检）。 */
function firstDecl(rule, prop) {
	return rule.decls.find((decl) => decl.prop === prop);
}

/**
 * Tailwind 字号 → px。命名类按官方默认值；任意值直接取 (px/rem/em)。
 * 依据 Tailwind v3 默认 scale：xs .75rem / sm .875rem / base 1rem / lg 1.125rem /
 * xl 1.25rem / 2xl 1.5rem / 3xl 1.875rem / 4xl 2.25rem / 5xl 3rem（按 16px 根字号换算）。
 */
const TAILWIND_NAMED_SIZE = {
	xs: 12,
	sm: 14,
	base: 16,
	lg: 18,
	xl: 20,
	"2xl": 24,
	"3xl": 30,
	"4xl": 36,
	"5xl": 48
};

/**
 * 从 JS 系文件里抽 Tailwind 字号类，变成与 CSS 声明等价的合成规则。
 *
 * 为什么必须有（实测教训 2026-11-07，Flow-Pilot）：那个项目 100% 用
 * `text-[11px]` / `text-[13.5px]` / `text-[19px]` 写字号，CSS 里只有 3 个值。
 * 不解析 Tailwind 就会得出「字号只有 1 档、无层级」的**反向错误结论**；
 * 真实情况是 **10 档、带 0.5px 步进**——恰好是工具最该抓的东西。
 */
function tailwindSizeRules(file) {
	const out = [];
	const lineStarts = lineStartsOf(file);
	const push = (raw, index) => {
		out.push({
			file,
			selector: "tailwind",
			line: lineAt(lineStarts, index),
			decls: [{ prop: "font-size", value: raw, index }]
		});
	};
	for (const m of file.stripped.matchAll(/\btext-\[(\d+(?:\.\d+)?)(px|rem|em)\]/g)) {
		push(`${m[1]}${m[2]}`, m.index ?? 0);
	}
	for (const m of file.stripped.matchAll(/\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)\b/g)) {
		const px = TAILWIND_NAMED_SIZE[m[1]];
		if (px !== undefined) push(`${px}px`, m.index ?? 0);
	}
	return out;
}

/* ------------------------------ 数值解析 ------------------------------ */

/** 取声明的单位（用于把 em 延后到「正文已知」后再换算）。 */
function unitOf(raw) {
	const value = String(raw).trim().replace(/!important/gi, "").trim();
	const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|rem|em|pt|%)?$/.exec(value);
	return match === null ? "" : (match[2] ?? "");
}

/**
 * 字号值 → px。
 * 边界：px/rem(×16)/pt(×4/3)/%(相对 parent)；em 用 parent 近似（项目里 parent 取正文，
 * 没解析到正文时取 16）。var(--x) 支持一层查表；clamp()/calc()/vw 等动态值返回 null
 * （跳过而不是猜一个数，避免把响应式字号算成本地固定字号）。
 */
function parseSizeValue(raw, parentSize, varMap) {
	const value = String(raw).trim().replace(/!important/gi, "").trim();
	const reference = parentSize > 0 ? parentSize : 16;
	const varMatch = /^var\(\s*--([A-Za-z0-9_-]+)\s*(?:,\s*([^)]*))?\)$/.exec(value);
	if (varMatch !== null) {
		if (varMap !== undefined && varMap.has(varMatch[1])) return varMap.get(varMatch[1]);
		return parseSizeValue(varMatch[2] ?? "", reference, varMap);
	}
	const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|rem|em|pt|%)?$/.exec(value);
	if (match === null) return null;
	const number = Number(match[1]);
	if (!Number.isFinite(number) || number <= 0) return null;
	const unit = match[2] ?? "";
	if (unit === "px" || unit === "") return r2(number);
	if (unit === "rem") return r2(number * 16);
	if (unit === "em") return r2(number * reference);
	if (unit === "pt") return r2((number * 4) / 3);
	if (unit === "%") return r2((number / 100) * reference);
	return null;
}

/** 宽度值 → px（只认 px/rem/em；百分数/vw 无法折算确定像素，跳过）。 */
function parseWidth(raw, bodySize, varMap) {
	const value = String(raw).trim().replace(/!important/gi, "").trim();
	const reference = bodySize > 0 ? bodySize : 16;
	const varMatch = /^var\(\s*--([A-Za-z0-9_-]+)\s*(?:,\s*([^)]*))?\)$/.exec(value);
	if (varMatch !== null) {
		if (varMap !== undefined && varMap.has(varMatch[1])) return varMap.get(varMatch[1]);
		return parseWidth(varMatch[2] ?? "", bodySize, varMap);
	}
	const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|rem|em)?$/.exec(value);
	if (match === null) return null;
	const number = Number(match[1]);
	if (!Number.isFinite(number) || number <= 0) return null;
	const unit = match[2] ?? "px";
	if (unit === "px") return number;
	if (unit === "rem") return number * 16;
	if (unit === "em") return number * reference;
	return null;
}

/**
 * line-height → 与字号的比例。
 * 无单位数字本身就是倍数；em 相对元素自身字号（比例=数值）；px/pt/rem/% 折算。
 * normal/inherit 等关键字与离谱值（不在 0.5–6 倍内，多为误解析）返回 null。
 */
function resolveLineHeight(raw, fontSize, bodySize) {
	const value = String(raw).trim().replace(/!important/gi, "").trim();
	if (/^(normal|inherit|initial|unset|revert|revert-layer|auto)$/i.test(value)) return null;
	const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|rem|em|pt|%)?$/.exec(value);
	if (match === null) return null;
	const number = Number(match[1]);
	if (!Number.isFinite(number) || number < 0) return null;
	const unit = match[2] ?? "";
	const reference = fontSize > 0 ? fontSize : bodySize > 0 ? bodySize : 16;
	let ratio;
	if (unit === "" || unit === "em") ratio = number;
	else if (unit === "px") ratio = number / reference;
	else if (unit === "pt") ratio = ((number * 4) / 3) / reference;
	else if (unit === "rem") ratio = (number * 16) / reference;
	else if (unit === "%") ratio = number / 100;
	else return null;
	if (!(ratio > 0.5 && ratio < 6)) return null;
	return r2(ratio);
}

/**
 * font-family 栈归一。系统栈（-apple-system / BlinkMacSystemFont / 纯 system-ui+generic）
 * 算同一个「系统默认」——它们表达的是「用系统字体」，不是第 N 个设计字体。
 * 返回 null 表示 inherit/initial 这类非具体字体栈。
 */
function normalizeFamily(raw) {
	const value = String(raw).trim().replace(/!important/gi, "").trim();
	if (value === "" || /^(inherit|initial|unset|revert|revert-layer)$/i.test(value)) return null;
	const stack = value
		.split(",")
		.map((part) => part.trim().replace(/^["']|[\"']$/g, "").toLowerCase())
		.filter((part) => part !== "");
	if (stack.length === 0) return null;
	if (stack.some((part) => part === "-apple-system" || part === "blinkmacsystemfont")) return "system";
	const generic = new Set(["system-ui", "sans-serif", "serif", "monospace", "ui-sans-serif", "ui-serif", "ui-monospace", "cursive", "fantasy", "emoji", "math", "fangsong"]);
	if (stack[0] === "system-ui" && stack.slice(1).every((part) => generic.has(part))) return "system";
	return stack.join(",");
}

/**
 * letter-spacing 是否「拉宽到破坏中文」：>0.05em 或折合 >1px（正文语境由调用方判定）。
 * 负值（收紧）不算——中文正文里更常见的问题是加宽。
 */
function letterSpacingHit(raw, fontSize) {
	const value = String(raw).trim().replace(/!important/gi, "").trim();
	if (value === "" || /^(normal|inherit|initial|unset)$/i.test(value)) return null;
	const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|rem|em|pt)?$/.exec(value);
	if (match === null) return null;
	const number = Number(match[1]);
	if (!Number.isFinite(number) || number <= 0) return null;
	const unit = match[2] ?? "px";
	const reference = fontSize > 0 ? fontSize : 16;
	const px = unit === "px" ? number : unit === "rem" ? number * 16 : unit === "em" ? number * reference : (number * 4) / 3;
	if (unit === "em" && number > 0.05) return { px: r2(px) };
	if (px > 1) return { px: r2(px) };
	return null;
}

/* ------------------------------ 文案提取 ------------------------------ */

/**
 * 可见文案近似提取（用于混排空格 / 长段落判定）：
 *   html：去掉 style/script 后剥标签，按行切成文本段（属性里的英文名不算文案）；
 *   js：只取字符串字面量（不把标识符当文案）；
 *   css：只取 content:"..."。
 */
/**
 * 去掉标签，只留下**文本节点**（保留换行以维持行号）。
 *
 * 不能用 `/<[^>]*>/g`：属性值里带 `>`（`:class="a > b"`、`title="宽度 > 80"`）时，
 * 正则会提前在 `>` 处截断，把后面的属性文本漏成“文案”。
 * 实测（2026-11-08，Echo 项目）：`aria-label="合成引擎"`、`12" depth="3" class="ech`
 * 这类残片被当成中文文案里的直引号报了出来。
 */
function stripTagsKeepLines(src) {
	let out = "";
	let inTag = false;
	let quote = null;
	for (let i = 0; i < src.length; i += 1) {
		const ch = src[i];
		const nl = ch === "\n";
		if (inTag === false) {
			if (ch === "<") {
				inTag = true;
				quote = null;
			} else out += ch;
			continue;
		}
		// 标签本身**不产字符**，只保留它里的换行：浏览器渲染 `词</b>：` 就是 `词：`，
		// 若把标签换成空格，会凭空造出“汉字与全角标点之间有多余空格”的假报
		// （实测：Colibri 的 `<b>组合上下文</b>：` 一口气报了 3 条 punct-space-before-cjk-punct，
		//  全是剥标签时自己加的空格，原文没这个问题）。
		if (quote !== null) {
			if (ch === quote) quote = null;
			if (nl) out += "\n";
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (ch === ">") {
			inTag = false;
			continue;
		}
		if (nl) out += "\n";
	}
	return out;
}

function textSegments(file) {
	const segments = [];
	const text = file.stripped;
	if (file.kind === "html") {
		const plain = stripTagsKeepLines(
			text.replace(/<style[\s\S]*?<\/style>/gi, "\n").replace(/<script[\s\S]*?<\/script>/gi, "\n")
		);
		for (const part of plain.split(/\n/)) {
			// 连空格收成一个：上面把 `<script>`/`{{}}`/`<code>` 挖空时留下的是一长串空格，
			// 不收就会凭空造出“汉字与全角标点之间有多余空格”的假报
			// （实测 Echo：punct-paren-space×10 + punct-space-before-cjk-punct×5 全是这个）。
			// 浏览器本来就把连续空白折叠成一个，收空格与渲染一致。
			const segment = part.replace(/&[a-z#0-9]+;/gi, " ").replace(/[ \t]{2,}/g, " ").trim();
			if (segment !== "") segments.push(segment);
		}
	} else if (file.kind === "js") {
		const re = /["'`]([^"'`\n]{2,})["'`]/g;
		let match;
		while ((match = re.exec(text)) !== null) segments.push(match[1]);
	} else {
		const re = /content\s*:\s*["']([^"']*)["']/gi;
		let match;
		while ((match = re.exec(text)) !== null) segments.push(match[1]);
	}
	return segments;
}

/** 文本段提取结果缓存（S6 中心对齐检查会对同一文件查多次）。 */
function segmentsOf(file) {
	if (file.segments === undefined) file.segments = textSegments(file);
	return file.segments;
}

function hasLongCJK(file) {
	return segmentsOf(file).some((segment) => cjkCount(segment) > 40);
}

/** 选择器 → 可用于在模板里找元素的 token（class / id / 标签名）。 */
function selectorTokens(selector) {
	const tokens = [];
	for (const match of selector.matchAll(/\.([A-Za-z_-][A-Za-z0-9_-]*)/g)) tokens.push({ kind: "class", value: match[1] });
	for (const match of selector.matchAll(/#([A-Za-z_-][A-Za-z0-9_-]*)/g)) tokens.push({ kind: "id", value: match[1] });
	for (const match of selector.matchAll(/(?:^|[\s,>+~])([a-z][a-z0-9]*)/g)) tokens.push({ kind: "tag", value: match[1] });
	return tokens;
}

function markupHasToken(text, token) {
	const value = escapeRegExp(token.value);
	if (token.kind === "tag") return new RegExp(`<${value}[\\s>/]`, "i").test(text);
	const attribute = token.kind === "class" ? "(?:class|className)" : "id";
	return new RegExp(`${attribute}\\s*=\\s*["'{][^"'}\\n]*\\b${value}\\b`, "i").test(text);
}

/** text-align:center 规则命中的「长中文段落」文件（同文件或 class/id/标签链接到的模板）。 */
function centerTargets(rule, files) {
	// 控件里的居中不是错误：`<button style="text-align:center">` 是分段控件/按钮的标准写法。
	// 实测（Colibri 三档灵敏度切换器）：三条 `button` 规则被报成“长段落居中”——
	// 规则只看了“这个文件里有长文 + 这条规则居中”，没看**居中的是什么元素**。
	if (/(?:^|[\s,>+~])(?:button|input|select|textarea|label|summary)\b/i.test(rule.selector)) return [];
	if (/(?:^|[\s,>+~.])(?:btn|button|chip|pill|tag|badge|empty|loading|spinner|hint|tip|meta|label)(?:$|[\s,.:#[>+~])/i.test(rule.selector)) return [];
	// 真的该管的只有**正文容器**：不猜，只认白名单。
	// 之前用“这个文件里有 >40 个中文字符”当条件，于是 `.wb-funnel-step`（漏斗小卡）、
	// `.loading`（加载占位）、`.empty`（空状态）全被判成“长段落居中”——它们本来就是
	// 短标签居中，是正确写法。宁可不报，也不要为了让一条规则“看得见”而误伤常态。
	if (/(?:^|[\s,>+~.])(?:p|article|blockquote|figcaption|\w*(?:prose|paragraph|intro|lead|desc|description|copy|note|body)\w*)(?:$|[\s,.:#[>+~])/i.test(rule.selector) === false) return [];
	if (rule.file.kind === "html") return hasLongCJK(rule.file) ? [rule.file] : [];
	const tokens = selectorTokens(rule.selector);
	if (tokens.length === 0) return [];
	return files.filter((file) => (file.kind === "html" || file.kind === "js") && hasLongCJK(file) && tokens.some((token) => markupHasToken(file.stripped, token)));
}

/** 混排空格计数：汉字与拉丁字母/数字紧贴。纯数字紧贴（2026年、第3章）不算——
 * 中文排版规范只要求汉字与拉丁字母之间加空格，数字紧贴是正常写法，不加过滤会
 * 把每篇带年份/编号的中文页面都误报一遍。 */
function mixedSpacingHits(file) {
	const hits = [];
	const re = /[\u4e00-\u9fa5][A-Za-z0-9]|[A-Za-z0-9][\u4e00-\u9fa5]/g;
	for (const segment of segmentsOf(file)) {
		let match;
		re.lastIndex = 0;
		while ((match = re.exec(segment)) !== null) {
			const latin = match[0].match(/[A-Za-z0-9]/);
			if (latin === null || /[0-9]/.test(latin[0])) continue;
			hits.push({ text: match[0], segment });
		}
	}
	return hits;
}

/* ------------------------------ 发现项收集 ------------------------------ */

/** 同类去重 + 每规则封顶的收集器（保证报告短、可复现）。 */
function createReporter() {
	const items = [];
	const seen = new Set();
	const perRule = new Map();
	return {
		items,
		push(entry) {
			const count = perRule.get(entry.rule) ?? 0;
			if (count >= PER_RULE_CAP) return;
			// 去重不用带 where：同一句话被报两次（一次带行号一次不带）也是噪声。
			const key = `${entry.rule}|${entry.severity}|${entry.message}`;
			if (seen.has(key)) return;
			seen.add(key);
			perRule.set(entry.rule, count + 1);
			items.push(entry);
		}
	};
}

/** 规则位置：相对路径:行号（单文件 root 用文件名）。 */
function at(file, line) {
	return `${file.rel}:${line}`;
}

/**
 * 应用外壳（app shell）识别：桌面/Web 应用的「工具栏 + 栏位」界面，
 * 不是文档/落地页。两种形态对排版的要求不同，混用规则会误报：
 *   - S1「字号梯级 1.6×」：文档要有 hero 标题，应用界面就是 11–16px 紧梯级；
 *   - S9「标题层级」：组件用 h3/h4 是为了字号，不是为了文档大纲。
 *
 * 判据（两条同时成立才算，宁严不宽）：
 *   ① 根元素声明了满高（height:100% / 100vh / 100dvh）或 overflow:hidden；
 *   ② 存在 display:flex/grid 的布局容器（应用一定用栅格/弹性布局）。
 * 实测：在线文档参照稿命中；本插件预览页 / 视频站参照稿（整页滚动）不命中。
 */
function detectAppShell(rules) {
	let fullHeightRoot = false;
	let hasLayout = false;
	for (const rule of rules) {
		const sel = rule.selector.toLowerCase();
		const isRoot = /(^|[\s,])(html|body|#root|#app|:root)(\s|$|,)/.test(sel) || /^(html|body)$/.test(sel.trim());
		for (const prop of ["height", "overflow"]) {
			const decl = rule.decls.find((d) => d.prop === prop);
			if (decl === undefined) continue;
			const v = String(decl.value).trim().toLowerCase();
			if (isRoot && ((prop === "height" && /^(100%|100vh|100dvh|100svh)$/.test(v)) || (prop === "overflow" && v === "hidden"))) {
				fullHeightRoot = true;
			}
		}
		const display = rule.decls.find((d) => d.prop === "display");
		if (display !== undefined && /^(flex|inline-flex|grid|inline-grid)$/.test(String(display.value).trim().toLowerCase())) hasLayout = true;
	}
	return fullHeightRoot && hasLayout;
}

/* ------------------------------ 主流程 ------------------------------ */

/**
 * 扫 UI 源码做排版体检。
 * @param {string} root 绝对路径（单文件或目录）；相对路径由工具层解析
 * @returns {Promise<object>} finalize 报告（mode/target/score/grade/counts/metrics/findings）
 */
export async function auditSource(root) {
	if (typeof root !== "string" || root.trim() === "") throw new Error("auditSource 需要 root（HTML/CSS 文件或目录）");
	const { files, root: absolute, truncated } = await collect(root);
	const report = createReporter();
	const target = absolute;

	/* 空扫描：不能当成「0 分 = 排版没问题」。给一条 info 明确说「没有样本」，
	 * 分数只有 info 权重（2），grade 仍是 clean，但报告里有解释。 */
	if (files.length === 0) {
		report.push(
			finding({
				severity: "info",
				rule: "S0",
				message: `未扫到可体检的 UI 源码（支持 ${EXTS.join(" / ")}），没有样本可评估`, 
				fix: "确认 root 指向 HTML/CSS 源码目录；若只有构建产物，请指向前端源码或改用 action=svg / image",
				where: target
			})
		);
		return finalize({
			mode: "ui",
			target,
			metrics: {
				filesScanned: 0,
				fontSizes: [],
				bodySize: 0,
				scaleRatio: 0,
				familyCount: 0,
				lineHeightRatios: [],
				violations: report.items.length,
				truncated,
				hasCJK: false,
				// 空扫描：rulesRun=0 / measured=[] 是给调用方的信号——
				// 「clean 但什么都没测」必须能和「测了且过了」区分开。
				rulesRun: 0,
				measured: []
			},
			findings: report.items
		});
	}

	const hasCJK = files.some((file) => CJK_RE.test(file.stripped));
	const rules = [];
	for (const file of files) {
		rules.push(...parseRules(file));
		// JS 系文件额外抽 Tailwind 字号类（组件化项目的主字号通常只在这里）
		if (file.kind === "js" && !TEST_FILE_RE.test(file.path ?? "")) rules.push(...tailwindSizeRules(file));
	}

	/* --- CSS 变量简单求值（--fs-body: 16px 之类）--- */
	const varMap = new Map();
	for (const file of files) {
		const re = /--([A-Za-z0-9_-]+)\s*:\s*([^;}\n]+)/g;
		let match;
		while ((match = re.exec(file.stripped)) !== null) {
			const size = parseSizeValue(match[2], 16, varMap);
			if (size !== null) varMap.set(match[1], size);
		}
	}

	/* --- 字号：两遍解析（em 需要先知道正文近似值）--- */
	/**
 * `font` 简写取值：`font: 14px/1.6 system-ui` → { size: "14px", lineHeight: "1.6" }。
 * CSS 里 font 简写非常常见（尤其重置样式和各项目的 body），只解 font-size 会漏掉它们。
 * 实测（dsh-visualkit 自己的预览页）：`body{font:14px/1.6 …}` 没被读到，
 * 正文尺寸退回众数 12px（来自 .meta/.side/.hint）→ S4 把 640/12=53 字报成超长，假误报。
 */
/** 字重归一：bold/bolder→700、normal→400、数字直接取。提取不到返回 undefined。 */
function parseWeight(raw) {
	const text = String(raw ?? "").trim().toLowerCase();
	if (text === "") return undefined;
	if (text === "normal") return 400;
	if (text === "bold" || text === "bolder") return 700;
	if (text === "lighter") return 300;
	const n = Number(text);
	return Number.isFinite(n) && n > 0 && n <= 1000 ? n : undefined;
}

function parseFontShorthand(raw) {
	if (typeof raw !== "string" || raw.trim() === "") return null;
	// **字号必须带单位**，后面可跟 /行高。
	// 实测 bug：之前单位是可选的，于是 `font: 400 14px/1.5 Arial` 先匹配到字重
	// `400`（无单位）→ size 为 null → 整个简写被丢弃 → bodySize 退化成“众数 12px”，
	// 进而把 16/12 报成 S1 梯级断裂（假误报）。字重、行高都不带单位，字号一定带。
	const m = raw.match(/(?:^|\s)(\d*\.?\d+)(px|rem|em|pt|%)(?:\s*\/\s*(\d*\.?\d+)(px|rem|em|pt|%)?)?/i);
	if (m === null) return null;
	const size = `${m[1]}${m[2]}`;
	const lineHeight = m[3] === undefined ? null : `${m[3]}${m[4] ?? ""}`;
	return { size, lineHeight };
}

	const sizeEntries = [];
	for (const rule of rules) {
		const weight = parseWeight(firstDecl(rule, "font-weight")?.value);
		const decl = firstDecl(rule, "font-size");
		if (decl !== undefined) sizeEntries.push({ rule, raw: decl.value, size: null, weight });
		else {
			// 没有 font-size 时看 font 简写（也顺带补上行高）
			const shorthand = parseFontShorthand(firstDecl(rule, "font")?.value);
			if (shorthand !== null) {
				rule.decls.push({ prop: "font-size", value: shorthand.size, index: firstDecl(rule, "font")?.index ?? 0 });
				if (shorthand.lineHeight !== null && firstDecl(rule, "line-height") === undefined) {
					rule.decls.push({ prop: "line-height", value: shorthand.lineHeight, index: firstDecl(rule, "font")?.index ?? 0 });
				}
				sizeEntries.push({ rule, raw: shorthand.size, size: null, weight });
			}
		}
	}
	const provisionalSizes = [];
	for (const entry of sizeEntries) {
		if (unitOf(entry.raw) === "em") continue;
		const size = parseSizeValue(entry.raw, 16, varMap);
		if (size !== null) provisionalSizes.push(size);
	}
	const provisionalBody = modeOf(provisionalSizes, { prefer: 16 });
	for (const entry of sizeEntries) entry.size = parseSizeValue(entry.raw, provisionalBody || 16, varMap);
	for (const entry of sizeEntries) entry.rule.size = entry.size;
	const sizeRecords = sizeEntries.filter((entry) => entry.size !== null);
	const sizes = sizeRecords.map((entry) => entry.size);
	const fontSizes = uniqueSorted(sizes);
	// 正文 = 出现次数最多的字号；完全平票（每个字号出现次数相同）时才用 16px 作参考。
	// 曾试图改成「中位数/下三分位」——实测证明是多余的：Flow-Pilot 的 text-[12px]
	// 出现 98 次本身就是众数，无需平票规则；而中位数会把 [16,26] 这种干净两级
	// 梯级的正文错选成 26。保持「众数优先，平票靠 16」最简单也最稳。
	// 正文尺寸：**优先取 body / html / :root 上声明的 font-size**，其次才是众数。
	// 实测误报（dsh-visualkit 自己的预览页）：body 声明 14px，但 .meta/.side/.hint
	// 共 3 条 12px，众数就把 12 当成了正文 → S4 算出 640/12 = 53 字/行（假误报），
	// 而真实是 640/14 = 46 字（达标）。
	const PAGE_SIZE_RE = /(?:^|[\s,>+~])(?:body|html|:root)(?:$|[\s,.:#[>+~])/i;
	const pageSizeRecord = sizeRecords.find((entry) => PAGE_SIZE_RE.test(entry.rule.selector));
	const bodySize = pageSizeRecord !== undefined ? pageSizeRecord.size : modeOf(sizes, { prefer: 16 });
	const maxSize = sizes.length > 0 ? Math.max(...sizes) : 0;
	const scaleRatio = bodySize > 0 ? r2(maxSize / bodySize) : 0;
	// 应用外壳还是文档页？S1/S9/S4 与 heading-first 都要用它分档
	const appShell = detectAppShell(rules);
	const bodyRecord = sizeRecords.find((entry) => entry.size === bodySize) ?? sizeRecords[0];

	/* --- 行高 --- */
	for (const rule of rules) {
		const decl = firstDecl(rule, "line-height");
		if (decl !== undefined) rule.lineHeight = resolveLineHeight(decl.value, rule.size ?? 0, bodySize);
	}
	// 标题不参与行高判定：显示字的紧凑行高（1.1–1.3）是正确做法，而不是“正文太挤”。
	// 实测误报（dsh-visualkit 自己的预览页）：h1 1.25 / h2 1.3 被 S3 判成 error——
	// 那两条规则本就该这么写。正文行高只看非标题规则。
	const HEADING_SELECTOR_RE = /(?:^|[\s,>+~])(?:h[1-6]|\.[\w-]*(?:title|heading|headline|display)[\w-]*)(?:$|[\s,.:#[>+~])/i;
	const ratioRecords = rules
		.filter((rule) => typeof rule.lineHeight === "number" && rule.lineHeight > 0)
		.filter((rule) => !HEADING_SELECTOR_RE.test(rule.selector))
		.map((rule) => ({
			rule,
			ratio: rule.lineHeight,
			isBody:
				(rule.size !== undefined && rule.size !== null && bodySize > 0 && Math.abs(rule.size - bodySize) < 0.01) ||
				/(?:^|[\s,.])(?:body|html|:root)(?:$|[\s,.:#[\]]|\.)/.test(rule.selector)
		}));
	const bodyRatioRecords = ratioRecords.filter((record) => record.isBody);
	const ratioCandidates = bodyRatioRecords.length > 0 ? bodyRatioRecords : ratioRecords;
	const lineHeightRatios = uniqueSorted(ratioRecords.map((record) => record.ratio));

	/* --- 字体家族 --- */
	const families = new Set();
	for (const rule of rules) {
		const decl = firstDecl(rule, "font-family");
		if (decl === undefined) continue;
		const family = normalizeFamily(decl.value);
		if (family !== null) families.add(family);
	}
	const familyCount = families.size;

	/* --- S1 字号梯级 --- */
	if (sizeRecords.length === 0) {
		report.push(
			finding({
				severity: "info",
				rule: "S0",
				message: `${files.length} 个文件里没有解析到 font-size（px/rem/em），无法评估字号系统`,
				fix: "确认扫描的是样式源码（CSS / <style> / styled-components）；字体只写在设计稿里时请以代码声明为准",
				where: files[0]?.rel
			})
		);
	} else {
		// 应用外壳（工具栏 + 栏位）没有 hero 标题，11–16px 紧梯级是常态；
		// 文档/落地页才需要 1.6× 以上的标题梯度。按外壳与否分档，避免把正确设计判成错。
		if (scaleRatio > 0 && scaleRatio < 1.6) {
			report.push(
				finding({
					severity: appShell ? "info" : "error",
					rule: "S1",
					message: appShell
						? `字号梯级偏平：最大 ${maxSize}px / 正文 ${bodySize}px = ${scaleRatio}× —— 应用外壳通常如此（无 hero 标题），仅作参考`
						: `字号梯级断裂：最大 ${maxSize}px / 正文 ${bodySize}px = ${scaleRatio}×（<1.6）`,
					fix: appShell
						? "应用界面靠字重/颜色区分层级是正常的；若确实缺视觉层次，把主标题提到 1.5× 以上即可"
						: "建立 1.6 倍左右的字号梯级（如 16 / 25 / 40 / 64），正文与标题至少差 1.6 倍；避免 12px 正文 + 14px 标题的平铺方案",
					where: bodyRecord === undefined ? undefined : at(bodyRecord.rule.file, bodyRecord.rule.line)
				})
			);
		}
		if (fontSizes.length > 6) {
			report.push(
				finding({
					severity: "warn",
					rule: "S1",
					message: `字号档位过多：${fontSizes.length} 档（${fontSizes.join(" / ")}px）`,
					fix: "收敛到 4–6 档：正文 + 2~3 级标题 + 辅助文字；删掉 1px 级别的微调档位",
					where: sizeRecords[0] === undefined ? undefined : sizeRecords[0].rule.file.rel
				})
			);
		}
	}

	/* --- S2 最小字号（**字号 × 字重**）---
	 * 只看字号是错的。实测（2026-11-07，本机 resvg）：同样是中文正文，
	 *   12px/400 → 只有 5.5% 的笔画像素是实心的（94.5% 是半透明灰 = 糊）
	 *   12px/600 → 29.3%
	 * 字重 600 的 12px 比字重 400 的 20px 还清。旧规则把 12px 一律放行、只卡 11px，
	 * 于是“12px/400 糊成一片”从未被发现。
	 * 现改为「有效字号 = 字号 × 字重系数」：400→1.0、500→1.1、600+→1.2。
	 * 阈值：有效 <11 error（基本不可读）、<13 warn（辅文偏糊）。
	 */
	const WEIGHT_FACTOR = (weight) => (weight >= 600 ? 1.2 : weight >= 500 ? 1.1 : 1);
	if (sizeRecords.length > 0) {
		const effOf = (entry) => entry.size * WEIGHT_FACTOR(entry.weight ?? 400);
		const minRecord = sizeRecords.reduce((best, entry) => (effOf(entry) < effOf(best) ? entry : best), sizeRecords[0]);
		const eff = Math.round(effOf(minRecord) * 10) / 10;
		const effNote = `${minRecord.size}px/${minRecord.weight ?? 400}（有效 ${eff}px）`;
		if (eff < 11) {
			report.push(
				finding({
					severity: "error",
					rule: "S2",
					message: `最小字号过小：${effNote}，中文在 1x 屏上基本不可读`,
					fix: "正文用 14px/600 或 16px/400；要用 12px 就必须把字重提到 600（实测实心笔画 5.5% → 29.3%）",
					where: at(minRecord.rule.file, minRecord.rule.line)
				})
			);
		} else if (eff < 13) {
			// 11–13 有效 px：能读但偏糊。真正该拦的是「小字 + 常规字重」这个组合。
			report.push(
				finding({
					severity: "warn",
					rule: "S2",
					message: `最小字号偏糊：${effNote}——小字配常规字重时中文笔画会大量半透明`,
					fix: `把这个 ${minRecord.size}px 的字重提到 600（有效 ${Math.round(minRecord.size * 1.2 * 10) / 10}px，实测清晰度×5），或字号提到 14px`,
					where: at(minRecord.rule.file, minRecord.rule.line)
				})
			);
		}
	}

	/* --- S3 行高 --- */
	if (ratioCandidates.length > 0) {
		const reported = new Set();
		for (const record of ratioCandidates) {
			if (reported.has(record.ratio)) continue;
			let severity = null;
			if (record.ratio < 1.35) severity = "error";
			else if (record.ratio < 1.5) severity = "warn";
			else if (record.ratio > 2.2) severity = "warn";
			if (severity === null) continue;
			reported.add(record.ratio);
			report.push(
				finding({
					severity,
					rule: "S3",
					message:
						record.ratio < 1.5
							? `正文行高过紧：line-height / font-size = ${record.ratio}（建议 1.5–1.8，中文尤其需要）`
							: `正文行高过松：line-height / font-size = ${record.ratio}（>2.2 会散架）`,
					fix: "正文行高设 1.6（中文 1.6–1.8）；标题 1.2–1.35 即可，不要全站一个行高",
					where: at(record.rule.file, record.rule.line)
				})
			);
		}
	} else {
		// 文件里声明了字号却完全没有 line-height：浏览器默认行高（约 1.2）对中文偏紧，提示而非扣分
		const filesWithSize = new Set(sizeRecords.map((entry) => entry.rule.file.path));
		const filesWithLineHeight = new Set(ratioRecords.map((record) => record.rule.file.path));
		for (const file of files) {
			if (!filesWithSize.has(file.path) || filesWithLineHeight.has(file.path)) continue;
			report.push(
				finding({
					severity: "info",
					rule: "S3",
					message: "未声明行高，依赖浏览器默认（中文通常需要 1.5–1.8）",
					fix: "给正文规则显式写 line-height: 1.6；标题可用 1.2–1.35",
					where: file.rel
				})
			);
		}
	}

	/* --- S4 行长 --- */
	const measureRecords = [];
	for (const rule of rules) {
		const maxWidthDecl = firstDecl(rule, "max-width");
		const widthDecl = firstDecl(rule, "width");
		const decl = maxWidthDecl ?? widthDecl;
		if (decl === undefined) continue;
		const width = parseWidth(decl.value, bodySize, varMap);
		if (width === null || width < MIN_MEASURE_WIDTH) continue;
		// 只判「正文栏」：页面容器（.sheet/.page/.container 的 max-width:1120px）不是栏宽，
		// 拿 bodySize 硬除会把 1120px 算成 100 字/行。所以要么规则自带字号（作者自己声明了
		// 这层是文字），要么选择器看起来就是正文段落——否则跳过。
		const ownSize = rule.size !== undefined && rule.size !== null && rule.size > 0;
		// 根选择器上的 **width** 是视口宽度，不是正文栏宽——实测拿 body{width:1366px}
		// 除以 13px 报出「105 字/行」的假结果。根元素只认 max-width（那是作者明确在限宽）。
		// 逗号分组选择器要拆开判：`html,body{width:1366px}` 整串匹配不上根选择器
		// （S13 踩过同一个坑）。全部片段都是根选择器才算根。
		const selParts = rule.selector.split(",").map((x) => x.trim()).filter((x) => x !== "");
		const isRootSel = selParts.length > 0 && selParts.every((x) => /^(html|body|:root|#root|#app)$/i.test(x));
		if (isRootSel && maxWidthDecl === undefined) continue;
		if (!ownSize && !MEASURE_SELECTOR_RE.test(rule.selector)) continue;
		const fontSize = ownSize ? rule.size : bodySize;
		if (!(fontSize > 0)) continue;
		const chars = hasCJK ? r2(width / fontSize) : r2(width / (0.55 * fontSize));
		measureRecords.push({ rule, width, isMax: maxWidthDecl !== undefined, fontSize, chars });
	}
	if (measureRecords.length > 0) {
		// 中文可读行长 30–45 字；卡在 >48 才报（46em@14px 这类编辑型正文栏不算错）。
		const tooLong = measureRecords.filter((record) => (hasCJK ? record.chars > 48 : record.chars > 90));
		if (tooLong.length > 0) {
			const worst = tooLong.reduce((best, record) => (record.chars > best.chars ? record : best), tooLong[0]);
			report.push(
				finding({
					severity: "warn",
					rule: "S4",
					message: hasCJK
						? `行长失控：${worst.width}px / ${worst.fontSize}px ≈ ${worst.chars} 字/行（中文建议 ≤48）`
						: `行长失控：${worst.width}px / ${worst.fontSize}px ≈ ${worst.chars} 字符/行（英文建议 ≤90）`,
					fix: hasCJK
						? "正文栏宽收到 30–40 字（约 480–640px @16px）：max-width: 40em 或 640px"
						: "正文栏宽收到 60–75 字符：max-width: 65ch 左右（约 640–760px @16px）",
					where: at(worst.rule.file, worst.rule.line)
				})
			);
		}
		// 过短：只对 max-width 的正文栏判（width 多半是按钮/卡片，不算正文），且只提示
		const tooShort = measureRecords.filter((record) => record.isMax && record.chars < 12);
		if (hasCJK && tooShort.length > 0) {
			const worst = tooShort.reduce((best, record) => (record.chars < best.chars ? record : best), tooShort[0]);
			report.push(
				finding({
					severity: "info",
					rule: "S4",
					message: `行长过短：max-width ${worst.width}px / ${worst.fontSize}px ≈ ${worst.chars} 字/行（<12），中文频繁换行`,
					fix: "正文栏宽 30–40 字更易读；短栏改为卡片/侧栏，不要让正文挤在窄栏里",
					where: at(worst.rule.file, worst.rule.line)
				})
			);
		}
	}

	/* --- S5 字体家族过多 --- */
	if (familyCount > 3) {
		report.push(
			finding({
				severity: "warn",
				rule: "S5",
				message: `字体家族过多：去重后 ${familyCount} 个（系统栈算 1 个）`,
				fix: "收敛到 2 个：一个正文字体 + 一个等宽/展示字体；西文回退栈合并成同一套",
				where: files[0]?.rel
			})
		);
	}

	/* --- S6 对齐 --- */
	const alignRules = [];
	for (const rule of rules) {
		const decl = firstDecl(rule, "text-align");
		if (decl === undefined) continue;
		alignRules.push({ rule, value: decl.value.replace(/!important/gi, "").trim().toLowerCase() });
	}
	const justifyRules = alignRules.filter((entry) => entry.value === "justify");
	if (hasCJK) {
		for (const entry of justifyRules.slice(0, PER_RULE_CAP)) {
			report.push(
				finding({
					severity: "warn",
					rule: "S6",
					message: "中文段落用了 text-align: justify：中文没有词间空格，两端对齐会在标点/英文处撑出大空隙",
					fix: "中文正文用 text-align: left（或 start）；确需两端对齐时开启 text-justify: inter-ideograph 并只用于纯中文长文",
					where: at(entry.rule.file, entry.rule.line)
				})
			);
		}
	}
	const centerRules = alignRules.filter((entry) => entry.value === "center");
	for (const entry of centerRules) {
		const targets = centerTargets(entry.rule, files);
		if (targets.length === 0) continue;
		report.push(
			finding({
				severity: "warn",
				rule: "S6",
				message: `长段落居中：${targets[0].rel} 有超过 40 个中文字符的文本被 text-align:center（每行起点不一致，难读）`,
				fix: "长段落左对齐；居中只用于标题、引语、单行文案（≤40 字）",
				where: at(entry.rule.file, entry.rule.line)
			})
		);
	}

	/* --- S7 字距 --- */
	for (const rule of rules) {
		const decl = firstDecl(rule, "letter-spacing");
		if (decl === undefined) continue;
		const fontSize = rule.size ?? (bodySize > 0 ? bodySize : 16);
		// 只查中文正文语境：<12px 的微标签、uppercase、等宽字体上的 tracking 是编辑型设计
		// 的常规手段（.rail .brand{font-size:12px;letter-spacing:.16em;text-transform:uppercase}），
		// 不该按「字距破坏中文」算。
		if (!(fontSize >= 12)) continue;
		const transform = firstDecl(rule, "text-transform")?.value ?? "";
		if (/uppercase/i.test(transform)) continue;
		const familyDecl = firstDecl(rule, "font-family");
		const family = familyDecl === undefined ? "" : normalizeFamily(familyDecl.value) ?? "";
		if (/mono|consolas|courier/i.test(family)) continue;
		const hit = letterSpacingHit(decl.value, fontSize);
		if (hit === null) continue;
		if (!CJK_RE.test(rule.file.stripped)) continue;
		report.push(
			finding({
				severity: "warn",
				rule: "S7",
				message: `字距破坏中文：letter-spacing 约 ${hit.px}px（>1px / >0.05em）用在含中文的文件里`,
				fix: "中文正文不加大字距；确需呼吸感用 0.01–0.02em 或调行高，而不是拉开字间",
				where: at(rule.file, rule.line)
			})
		);
	}

	/* --- S8 中英混排空格 --- */
	let mixedTotal = 0;
	let mixedExample = null;
	let mixedWhere = null;
	for (const file of files) {
		if (TEST_FILE_RE.test(file.path ?? "")) continue; // 测试 fixture 不是界面文案
		const hits = mixedSpacingHits(file);
		if (hits.length === 0) continue;
		if (mixedExample === null) {
			mixedExample = hits[0].segment.slice(0, 48);
			mixedWhere = file.rel;
		}
		mixedTotal += hits.length;
	}
	if (mixedTotal >= 3) {
		report.push(
			finding({
				severity: "info",
				rule: "S8",
				message: `中英混排没空格：${mixedTotal} 处（如「${mixedExample}」）`,
				fix: "汉字与拉丁字母之间留一个空格（「使用 React 框架」）；纯数字紧贴中文（2026年）不在此列",
				where: mixedWhere
			})
		);
	}

	/* --- S9 标题层级 --- */
	const headingRecords = [];
	for (const rule of rules) {
		if (rule.size === undefined || rule.size === null) continue;
		const levels = new Set();
		for (const match of rule.selector.matchAll(/(?:^|[\s,>+~])(h[1-6])(?=$|[\s,>+~.:#[\]]|\.)/g)) levels.add(Number(match[1].slice(1)));
		for (const level of levels) headingRecords.push({ level, size: rule.size, rule });
	}
	for (const file of files) {
		const re = /<h([1-6])\b[^>]*?style\s*=\s*["']([^"']*)["']/g;
		let match;
		while ((match = re.exec(file.stripped)) !== null) {
			const decl = parseDecls(match[2]).find((entry) => entry.prop === "font-size");
			if (decl === undefined) continue;
			const size = parseSizeValue(decl.value, bodySize || 16, varMap);
			if (size !== null) headingRecords.push({ level: Number(match[1]), size, rule: { file, line: lineAt(lineStartsOf(file), match.index), selector: `h${match[1]}` } });
		}
	}
	if (headingRecords.length > 0 && bodySize > 0) {
		const headingSizes = new Map();
		const headingWheres = new Map();
		for (let level = 1; level <= 6; level += 1) {
			const records = headingRecords.filter((record) => record.level === level);
			if (records.length === 0) continue;
			const size = modeOf(records.map((record) => record.size), { tie: "larger" });
			headingSizes.set(level, size);
			headingWheres.set(level, records.find((record) => record.size === size) ?? records[0]);
		}
		for (const [level, size] of headingSizes) {
			const ratio = r2(size / bodySize);
			if (ratio >= 1.25) continue;
			const record = headingWheres.get(level);
			report.push(
				finding({
					// 应用外壳里 h3/h4 常被当作「组件小标题」用，字号贴近正文是正常的；
					// 文档页才需要 1.25× 以上的层级差。
					severity: appShell ? "info" : "error",
					rule: "S9",
					message: appShell
						? `组件小标题字号贴近正文：h${level} ${size}px / 正文 ${bodySize}px = ${ratio}× —— 应用外壳里 h3/h4 常作组件标题用，仅作参考`
						: `标题层级不足：h${level} ${size}px / 正文 ${bodySize}px = ${ratio}×（<1.25，标题和正文分不开）`,
					fix: appShell
						? "组件标题靠字重（600+）与颜色区分即可；若确实需要更强的层次，把它提到 1.4× 以上或加分隔线"
						: "h1 ≥ 2× 正文、h2 ≥ 1.5×、h3 ≥ 1.25×；正文 16px 时 h1 至少 32–40px",
					where: record === undefined ? undefined : at(record.rule.file, record.rule.line)
				})
			);
		}
		const known = [...headingSizes.entries()].sort((a, b) => a[0] - b[0]);
		for (let i = 0; i + 1 < known.length; i += 1) {
			const [shallowLevel, shallowSize] = known[i];
			const [deepLevel, deepSize] = known[i + 1];
			if (shallowSize >= deepSize) continue;
			report.push(
				finding({
					severity: "error",
					rule: "S9",
					message: `标题层级倒挂：h${shallowLevel} ${shallowSize}px 比 h${deepLevel} ${deepSize}px 还小`,
					fix: "字号随层级递减：h1 > h2 > h3 > h4…；层级靠字重/颜色区分而不是把 h1 做小",
					where: (() => {
						const record = headingWheres.get(shallowLevel);
						return record === undefined ? undefined : at(record.rule.file, record.rule.line);
					})()
				})
			);
		}
	}

	/* --- S10 混排字号基线 ------------------------------------------------------------
	 * 场景：仪表板里的「5.42 GiB」——数字 72px、单位 20px。这类排版最常见的错不是字号，
	 * 而是**基线丢了**：容器写成 `display:flex; align-items:center`，浏览器会把小字
	 * 垂直居中到大字旁边，而不是让两者坐在同一条基线上。肉眼看就是“单位飘在数字中间”。
	 *
	 * 为什么能静态判：CSS 里 `align-items: center` 与 `vertical-align: middle` 是明确的
	 * “居中而非基线”信号，且我们能从选择器的包含关系认出父子（`.kpi` → `.kpi .unit`）。
	 *
	 * 阈值 1.8×：低于这个倍数的混排（22px 字标 + 16px 标签 = 1.375×）居中摆放是正常的，
	 * 报它就是噪音。实测拿真实页面校准过。
	 */
	if (sizeRecords.length > 0) {
		const sizeOf = new Map();
		for (const record of sizeRecords) sizeOf.set(record.rule.selector.trim(), record);
		const isDescendant = (child, parent) =>
			child !== parent && new RegExp(`^${parent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[>+~]?\\s`).test(child);
		const reported = new Set();
		for (const rule of rules) {
			const display = firstDecl(rule, "display")?.value.trim().toLowerCase();
			const align = firstDecl(rule, "align-items")?.value.trim().toLowerCase();
			const isFlex = display === "flex" || display === "inline-flex";
			if (!isFlex || align !== "center") continue;
			const parentSel = rule.selector.trim();
			if (reported.has(parentSel)) continue;
			const members = [];
			const own = sizeOf.get(parentSel);
			if (own !== undefined) members.push({ size: own.size, record: own, sel: parentSel });
			for (const [sel, record] of sizeOf.entries()) {
				if (isDescendant(sel, parentSel)) members.push({ size: record.size, record, sel });
			}
			if (members.length < 2) continue;
			const sizes = members.map((m) => m.size);
			const maxSize = Math.max(...sizes);
			const minSize = Math.min(...sizes);
			if (minSize <= 0 || maxSize / minSize < 1.8) continue;
			reported.add(parentSel);
			const small = members.find((m) => m.size === minSize);
			// 小字要是自己声明了 vertical-align: baseline，那它已经处理过了，不报
			const sv = firstDecl(small.record.rule, "vertical-align")?.value.trim().toLowerCase();
			if (sv === "baseline") continue;
			report.push(
				finding({
					severity: "warn",
					rule: "S10",
					message:
						`混排字号基线丢失：${parentSel} 用 align-items:center 装 ${maxSize}px 与 ${minSize}px（${r2(maxSize / minSize)}×），` +
						`浏览器会垂直居中而不是基线对齐，小字会“飘”在大字中间`,
					fix: `把该容器改成 align-items: baseline（或给小字加 vertical-align: baseline）——数字与单位的底边必须坐在同一条线上；行内混排则用 vertical-align: baseline 而不是 middle`,
					where: at(rule.file, rule.line)
				})
			);
		}
	}

	/* --- S11 阴影层级 ----------------------------------------------------------------
	 * 为什么值得单独一条规则：阴影是「专业感 / AI 感」的分水岭，但它有两个**完全客观**
	 * 的可判缺陷，肉眼能感觉到、却说不出哪里不对：
	 *   ① 光源方向不一致：有的投影往下（光从上方）、有的往上（光从下方）——物理上不成立；
	 *   ② 档位过多 / 相邻档位太近：5 档阴影里有两档肉眼分不出来，等于白写，还增加维护成本。
	 * 这两条都不靠审美，靠几何与数值比对，所以适合做规则。
	 */
	{
		const shadows = [];
		for (const rule of rules) {
			const decl = firstDecl(rule, "box-shadow");
			if (decl === undefined) continue;
			const raw = String(decl.value).trim();
			if (raw === "" || /^(none|inherit|initial|unset)$/i.test(raw)) continue;
			// 顶层逗号切分（rgba(...) 里的逗号不能当分隔符）
			const parts = [];
			let depth = 0;
			let cur = "";
			for (const ch of raw) {
				if (ch === "(") depth += 1;
				else if (ch === ")") depth = Math.max(0, depth - 1);
				if (ch === "," && depth === 0) {
					parts.push(cur);
					cur = "";
					continue;
				}
				cur += ch;
			}
			if (cur.trim() !== "") parts.push(cur);
			const layers = [];
			for (const part of parts) {
				const inset = /\binset\b/i.test(part);
				const nums = (part.match(/-?\d*\.?\d+(?:px|rem|em)?/g) ?? [])
					.map((v) => (/rem$/.test(v) ? parseFloat(v) * 16 : /em$/.test(v) ? parseFloat(v) * (rule.size ?? 16) : parseFloat(v)))
					.filter((v) => Number.isFinite(v));
				if (nums.length < 2) continue;
				const alphaMatch = /rgba?\([^)]*?,\s*([\d.]+)\s*\)/.exec(part);
				layers.push({
					inset,
					dx: nums[0],
					dy: nums[1],
					blur: nums[2] ?? 0,
					alpha: alphaMatch === null ? 1 : Number(alphaMatch[1])
				});
			}
			if (layers.length === 0) continue;
			// 以「最大模糊半径」作为该声明的层级（感知上的高度）
			const outer = layers.filter((l) => !l.inset);
			if (outer.length === 0) continue;
			const dominant = outer.reduce((best, l) => (l.blur > best.blur ? l : best), outer[0]);
			shadows.push({ rule, level: Math.round(dominant.blur), dy: dominant.dy, layers: layers.length, alpha: dominant.alpha });
		}

		if (shadows.length >= 2) {
			// ① 光源方向：dy 的正负应一致（dy === 0 的居中光晕不参与判断）
			const dirs = new Set(shadows.filter((sh) => Math.abs(sh.dy) >= 1).map((sh) => Math.sign(sh.dy)));
			if (dirs.size > 1) {
				const down = shadows.filter((sh) => sh.dy >= 1)[0];
				const up = shadows.filter((sh) => sh.dy <= -1)[0];
				report.push(
					finding({
						severity: "error",
						rule: "S11",
						message:
							`光源方向不一致：有 ${down === undefined ? "?" : `${down.dy}px`} 向下投影，也有 ${up === undefined ? "?" : `${up.dy}px`} 向上投影——` +
							"同一页面只能有一个光源方向，否则高度关系是矛盾的",
						fix: "统一成一个光源方向（常规是光在上方 → 阴影全部 dy > 0）；要做「内凹/被压入」的观感就用 inset，不要靠反向的 dy",
						where: at(up.rule.file, up.rule.line)
					})
				);
			}

			// ② 档位数量与档位间距
			const levels = [...new Set(shadows.map((sh) => sh.level))].sort((a, b) => a - b);
			if (levels.length > 4) {
				report.push(
					finding({
						severity: "warn",
						rule: "S11",
						message: `阴影档位过多：${levels.length} 档（${levels.join("/")}px）——高程体系通常 3–4 档就够`,
						fix: `收敛成 3–4 档，例如 1/4/12/24px（对应卡片、悬浮层、弹窗、模态）；档位越多越难保持一致`,
						where: at(shadows[0].rule.file, shadows[0].rule.line)
					})
				);
			}
			const tooClose = [];
			for (let i = 1; i < levels.length; i += 1) {
				if (levels[i - 1] > 0 && levels[i] / levels[i - 1] < 1.3) tooClose.push(`${levels[i - 1]}/${levels[i]}`);
			}
			if (tooClose.length > 0) {
				report.push(
					finding({
						severity: "warn",
						rule: "S11",
						message: `相邻阴影档位太近：${tooClose.join("、")}px（倍数 <1.3）——肉眼分不出差别，等于白写一档`,
						fix: "档位之间至少差 1.5 倍（如 1 → 4 → 12 → 24），让每档在高程上都有明确语义",
						where: at(shadows[0].rule.file, shadows[0].rule.line)
					})
				);
			}
		}
	}

	/* --- S12 响应式断点一致性 ----------------------------------------------------------
	 * 断点最容易出的两类问题都是**可静态算出来的**：
	 *   ① 同类断点近似但不相等（两个 max-width 差 1–3px）——几乎必然是笔误；
	 *   ② max-width: X 与 min-width: X 同时存在——在恰好 X 处两套规则同时生效，
	 *      出现“哪个覆盖哪个”的不确定性（正确写法是 max-width: X-1 配 min-width: X）。
	 *
	 * **刻意不报**的情况：`max-width: 767px` + `min-width: 768px` 是标准的互补对，
	 * 数值相邻但方向相反，完全正确——按“近似值”去报会误伤大量规范项目（Bootstrap 系）。
	 * 所以近似检查只比「同方向」的断点。
	 */
	{
		const MEDIA_RE = /@media[^{]*/gi;
		const bpRe = /(min|max)-width\s*:\s*([\d.]+)\s*(px|em|rem)?/gi;
		const breakpoints = [];
		for (const file of files) {
			if (file.kind !== "css" && file.kind !== "html") continue;
			if (TEST_FILE_RE.test(file.path ?? "")) continue;
			const text = file.stripped;
			const toLine = (index) => text.slice(0, index).split("\n").length;
			for (const media of text.matchAll(MEDIA_RE)) {
				const condition = media[0];
				for (const bp of condition.matchAll(bpRe)) {
					const raw = Number(bp[2]);
					if (!Number.isFinite(raw) || raw <= 0) continue;
					const unit = (bp[3] ?? "px").toLowerCase();
					const px = unit === "px" ? raw : raw * 16; // em/rem 按 16px 折算（约定值）
					breakpoints.push({
						kind: bp[1].toLowerCase() === "min" ? "min" : "max",
						px: Math.round(px * 100) / 100,
						// at() 收的是**文件对象**（它读 file.rel），传路径字符串会输出 @undefined
						file,
						line: toLine(media.index ?? 0)
					});
				}
			}
		}

		if (breakpoints.length >= 2) {
			const vals = [...new Set(breakpoints.map((b) => b.px))].sort((a, b) => a - b);
			const at2 = (bp) => at(bp.file, bp.line);

			// ① 同方向断点近似但不相等 → 几乎必然是笔误
			const nearMisses = [];
			for (const kind of ["max", "min"]) {
				const sameKind = [...new Set(breakpoints.filter((b) => b.kind === kind).map((b) => b.px))].sort((a, b) => a - b);
				for (let i = 1; i < sameKind.length; i += 1) {
					const gap = sameKind[i] - sameKind[i - 1];
					if (gap > 0 && gap <= 3) nearMisses.push(`${kind}-width ${sameKind[i - 1]}/${sameKind[i]}px`);
				}
			}
			if (nearMisses.length > 0) {
				report.push(
					finding({
						severity: "warn",
						rule: "S12",
						message: `断点值近似但不相等：${nearMisses.join("、")}（同方向、差 ≤3px）——几乎必然是笔误，会让某一段宽度落在两套规则之间`,
						fix: "同一方向的断点值应统一到一份清单（如 640/768/1024/1280）；相近的两档合并成同一个值，或拉开到 ≥16px",
						where: at2(breakpoints[0])
					})
				);
			}

			// ② max-width X 与 min-width X 同时存在 → 在 X 处重叠
			const overlaps = [];
			const maxSet = new Set(breakpoints.filter((b) => b.kind === "max").map((b) => b.px));
			const minSet = new Set(breakpoints.filter((b) => b.kind === "min").map((b) => b.px));
			for (const v of vals) if (maxSet.has(v) && minSet.has(v)) overlaps.push(`${v}px`);
			if (overlaps.length > 0) {
				const sample = breakpoints.find((b) => b.kind === "min" && overlaps.includes(`${b.px}px`)) ?? breakpoints[0];
				report.push(
					finding({
						severity: "warn",
						rule: "S12",
						message: `断点重叠：${overlaps.join("、")} 上 max-width 与 min-width 同时命中——恰好这一像素宽度会应用两套规则，叠加结果取决于书写顺序`,
						fix: "互补的一对断点要错开 1px：`@media (max-width: 767px)` 配 `@media (min-width: 768px)`；或统一改用 mobile-first 的单一 min-width 体系",
						where: at2(sample)
					})
				);
			}

			// ③ 值过多 / 方向混用 → info（不是错，但值得知道）
			if (vals.length > 5) {
				report.push(
					finding({
						severity: "info",
						rule: "S12",
						message: `断点档位偏多：${vals.length} 档（${vals.join("/")}px）——响应式体系通常 3–5 档就够`,
						fix: "把断点收敛到 3–5 档并与设计系统对齐；档位越多，每档都要单独验证，维护成本指数上升",
						where: at2(breakpoints[0])
					})
				);
			}
			// 只有「两个方向都成体系（各 ≥2 档）」才算混用。
			// 一 max 一 min 的互补对是标准写法（Bootstrap 系），报它就是纯噪音。
			if (maxSet.size >= 2 && minSet.size >= 2) {
				report.push(
					finding({
						severity: "info",
						rule: "S12",
						message: `断点方向混用：${maxSet.size} 档 max-width + ${minSet.size} 档 min-width——两套方向各成体系，排查覆盖关系时要同时想两个方向`,
						fix: "统一到一种方向（推荐 mobile-first 的 min-width）；已有代码要混用时，至少保证同一组件内方向一致",
						where: at2(breakpoints[0])
					})
				);
			}
		}
	}

	/* --- S13 组件状态矩阵 --------------------------------------------------------------
	 * 现有 `taste_check` 的 no-states 只回答「页面上有没有交互态」，回答不了
	 * 「四个组件里有两个缺 disabled」这种**逐组件**的问题。
	 *
	 * 做成一�矩阵：行 = 组件（基选择器），列 = hover / focus / active / disabled。
	 * 判据只有一条硬的：**有 hover 却没有 focus 的组件一律报**——键盘用户完全看不到
	 * 焦点落在哪，这是 WCAG 2.4.7（Focus Visible, AA）。其余状态缺失只进矩阵总览，
	 * 因为按钮不一定需要 disabled、卡片不一定需要 active，逐条判会变成噪音。
	 */
	{
		const STATE_DEFS = [
			["hover", /:hover\b/g],
			["focus", /:focus(-visible|-within)?\b/g],
			["active", /:active\b/g],
			["disabled", /:disabled\b|\[disabled\]|\.is-disabled\b/g]
		];
		const matrix = new Map(); // base 选择器 -> { states:Set, file, line }
		// 逗号分组选择器必须拆开逐条算：`.fw:focus-visible,.rail-item:focus-visible,…{…}`
		// 是极常见写法，整串当一个选择器会算出个假 base `.fw,.rail-item,…`，
		// 于是这几个组件被误判成「没有 focus」（实测：本插件自己的参照稿当场被误报 4 个）。
		const splitSelectors = (selector) => {
			const out = [];
			let depth = 0;
			let cur = "";
			for (const ch of selector) {
				if (ch === "(") depth += 1;
				else if (ch === ")") depth = Math.max(0, depth - 1);
				if (ch === "," && depth === 0) {
					out.push(cur);
					cur = "";
					continue;
				}
				cur += ch;
			}
			if (cur.trim() !== "") out.push(cur);
			return out.map((x) => x.trim()).filter((x) => x !== "");
		};

		for (const rule of rules) {
			for (const sel of splitSelectors(rule.selector)) {
			const hit = STATE_DEFS.filter(([, re]) => {
				re.lastIndex = 0;
				return re.test(sel);
			});
			if (hit.length === 0) continue;
			// 【数据属性绑定的组合式钩子不是组件】
			// [data-motion~="lift"] 这类选择器来自本插件的交互原语层：
			// hover / focus 本来就是两条独立可选项（挂 "lift focus" 才都有），
			// 按 base 归组必然得出「有 hover 没 focus」——这个报必然成立、也无从修，
			// 只会教用户忽略 S13。真组件的 focus 缺失由用户的页面选择器报出。
			// 只豁免本插件自己的 `[data-motion…]`：其它 data-* 选择器在真实项目里常就是组件
			// （Radix/shadcn 的 [data-slot] / [data-state]），一律跳过会把真缺口盖掉。
			if (/\[data-motion\s*[~*^$|]?=/.test(sel)) continue;
			let base = sel;
			for (const [, re] of STATE_DEFS) {
				re.lastIndex = 0;
				base = base.replace(re, "");
			}
			// 函数式伪类也要剥掉：`.tab:focus:not(:focus-visible)` 不处理会得到假组件
			// `.tab:not()`，把同一个组件拆成两行（实测踩过）。
			base = base
				.replace(/:not\([^)]*\)/g, "")
				.replace(/:is\([^)]*\)/g, "")
				.replace(/:where\([^)]*\)/g, "")
				.replace(/\s+/g, " ")
				.trim();
			if (base === "") continue;
			const entry = matrix.get(base) ?? { states: new Set(), file: rule.file, line: rule.line };
			for (const [name] of hit) entry.states.add(name);
			if (matrix.has(base) === false) matrix.set(base, entry);
			else for (const [name] of hit) matrix.get(base).states.add(name);
			}
		}

		if (matrix.size > 0) {
			// ① 有 hover 却没有 focus —— 键盘焦点不可见（WCAG 2.4.7 AA）
			const noFocus = [];
			for (const [base, entry] of matrix.entries()) {
				if (entry.states.has("hover") && entry.states.has("focus") === false) noFocus.push(base);
			}
			if (noFocus.length > 0) {
				const first = matrix.get(noFocus[0]);
				report.push(
					finding({
						severity: "warn",
						rule: "S13",
						message:
							`组件有 hover 但无 focus：${noFocus.slice(0, 6).join("、")}${noFocus.length > 6 ? ` 等 ${noFocus.length} 个` : ""}` +
							`——鼠标有反馈、键盘没反馈，键盘用户看不到焦点落在哪（WCAG 2.4.7 Focus Visible, AA）`,
						fix: "给这些选择器补 `:focus-visible { outline: 2px solid <主色>; outline-offset: 2px }`；用 :focus-visible 而不是 :focus，避免鼠标点击时也弹焦点环",
						where: at(first.file, first.line)
					})
				);
			}

			// ② 矩阵总览：只有 ≥2 个组件时才给，单组件页面没必要
			if (matrix.size >= 2) {
				const order = ["hover", "focus", "active", "disabled"];
				const rows = [...matrix.entries()]
					.sort((a1, b1) => b1[1].states.size - a1[1].states.size)
					.slice(0, 8)
					.map(([base, entry]) => `${base} ${order.map((st) => (entry.states.has(st) ? "✓" : "·")).join("")}`);
				report.push(
					finding({
						severity: "info",
						rule: "S13",
						message: `组件状态矩阵（${matrix.size} 个组件，列序 hover/focus/active/disabled）：${rows.join(" | ")}`,
						fix: "对照矩阵看哪一列缺得多：focus 列缺 => 键盘不可用（必须补）；disabled 列缺 => 该组件可能不需要禁用态，属于正常",
						where: at([...matrix.values()][0].file, [...matrix.values()][0].line)
					})
				);

				// ③ 组件间覆盖不均：最多与最少相差 ≥2 个状态
				const counts = [...matrix.values()].map((e2) => e2.states.size);
				const maxN = Math.max(...counts);
				const minN = Math.min(...counts);
				if (maxN - minN >= 2) {
					const weakest = [...matrix.entries()].filter(([, e3]) => e3.states.size === minN).map(([b2]) => b2);
					report.push(
						finding({
							severity: "info",
							rule: "S13",
							message: `状态覆盖不均：最完整的组件有 ${maxN} 个状态，${weakest.slice(0, 5).join("、")} 只有 ${minN} 个——同类控件之间不一致会让用户对“能点/能按”的预期错乱`,
							fix: "同一种控件（按钮 / 输入 / 卡片）用同一套状态矩阵；确实不需要的状态（如卡片的 disabled）在 .design-intent.json 里声明，而不是默默少写",
							where: at([...matrix.values()][0].file, [...matrix.values()][0].line)
						})
					);
				}
			}
		}
	}

	/* --- S14 负外边距 ---------------------------------------------------------------
	 * 来自真实缺陷：做在线文档参照实现时为了让表格行对齐原图，我给 `.table` 加了
	 * `margin-top:-12px`。像素差确实好看了，但**「最近」的下划线直接贴到了「名称」上**，
	 * 两块内容糊成一片——静态体检全绿，只有人眼看得出来。
	 *
	 * 负外边距本身是合法 CSS，但用在「把两块内容硬拉开/拉近」时几乎总是补丁：
	 * 它会破坏间距层级（块间距 < 块内间距），而且换主题/换字号就崩。
	 * 所以这里报的是**提醒**而不是错误：确认是刻意为之（如居中微调、重叠头像）就声明豁免。
	 */
	{
		const negatives = [];
		for (const rule of rules) {
			for (const prop of ["margin", "margin-top", "margin-bottom", "margin-left", "margin-right"]) {
				const decl = firstDecl(rule, prop);
				if (decl === undefined) continue;
				const raw = String(decl.value).trim();
				// 只看单值负数的简单情形：`-12px`、`0 -8px`、`-1rem`
				const tokens = raw.split(/\s+/).filter((t) => t !== "");
				const negTokens = tokens.filter((t) => /^-\d*\.?\d+(px|rem|em|%)?$/.test(t) && Number.parseFloat(t) !== 0);
				if (negTokens.length === 0 && !/^-\d/.test(raw)) continue;
				negatives.push({ rule, prop, value: raw });
				break;
			}
		}
		if (negatives.length > 0) {
			const first = negatives[0];
			report.push(
				finding({
					severity: "warn",
					rule: "S14",
					message:
						`用了负外边距：${negatives.slice(0, 4).map((n) => `${n.rule.selector.trim()} { ${n.prop}: ${n.value} }`).join("；")}` +
						`${negatives.length > 4 ? ` 等 ${negatives.length} 处` : ""}——负 margin 会压掉块间距，典型症状是两块内容视觉上粘在一起`,
					fix: `先确认不是补丁：想调间距就用 padding / gap / 真实的间距变量；想做重叠层（如头像叠角标）用 transform: translateY() 或 grid 叠层——负 margin 会连带影响布局参与方，换字号就崩`,
					where: at(first.rule.file, first.rule.line)
				})
			);
		}
	}

	/* --- 标点与常见排版约定（punct-*，来自 typography-audit 的 12 条） ------------------- */
	// 只在「可见文案」上判：textSegments 已剥掉标签/脚本，但 <code>/<pre> 里的引号与 -- 不算错，
	// 所以这里再剔一次代码块（业界 gotcha：报代码块内的标点是典型误报）。
	const punctSegments = [];
	for (const file of files) {
		// 标点规则只能对「真的会被渲染的文案」生效：
		//   - JS/TS 里的字符串字面量是代码（工具描述、枚举、日志），不是界面文案；
		//     实测拿它判会把插件自己的描述文本判成「中文用了半角冒号」。
		//   - CSS 只取 content:"..."（那就是真文案）。
		// 所以只要 html 系（含 vue/svelte/astro）与 css 两类。
		if (file.kind !== "html" && file.kind !== "css") continue;
		if (TEST_FILE_RE.test(file.path ?? "")) continue; // 测试 fixture 不是界面文案
		// 再把 <code>/<pre>/<kbd>/<samp> 整段挖空（等长空白保留行号）：
		// 代码块里的直引号与 -- 是正确的，报它就是误报。
		// 注意：必须把 segments 缓存置 undefined。{...file} 会把之前 S8 算过的
			// 旧 segments 一并拷过来，导致下面的清洗完全不生效（实测踩过）。
		// 代码块/脚本/插值要从**文案串里拿掉**，不能换成空格：
		// `（{{ x }}）` 换成空格就变成了 `（ ）`，于是凭空多出一条“全角括号内侧有多余空格”
		// （实测 Echo：punct-paren-space×10 全是这么来的）。
		const blank = (m) => m.replace(/[^\n]/g, "");
		const cleaned =
			file.kind === "html"
				? {
						...file,
						segments: undefined,
						stripped: file.stripped
							.replace(/<(code|pre|kbd|samp)\b[^>]*>[\s\S]*?<\/\1>/gi, blank)
							// script 块是**代码**，不是界面文案：实测 55 个文件的 Vue 项目里，
							// `status === "queued" ? "排队中…"` 这类 JS 字符串字面量一口气报出 27 条
							// punct-straight-quote（共 38 条），把真的排版问题全冲掉了。
							.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, blank)
							// 插值表达式 {{ … }} 同理：里面是表达式与字面量，不是正文标点。
							.replace(/\{\{[\s\S]*?\}\}/g, blank)
					}
				: file;
		// 模板文件（vue/svelte）：插值被拿掉后，`{{ x }}` 前后的空格会留在汉字与标点之间，
		// 变成“汉字与全角标点之间有多余空格”的假报（实测 Echo：paren-space×9 + space-before×4）。
		// 含插值的段落单独标记，只对它关掉两条空格敏感规则，引号/破折号等照旧判。
		const templateTainted = /\{\{|\{%/.test(file.stripped);
		for (const segment of segmentsOf(cleaned)) {
			if (segment.trim() === "") continue;
			// 代码泄漏护栏：被渲染的正文不可能出现这些运算符。
			// 实测 Vue 项目里 `active?.status === "queued" ? "排队中…" : "处理中…"`
			// 会以整段（含引号）当成“文案”送到标点规则前，一口气报出 27 条假错误，
			// 把真的排版问题全淹了。这里做内容层面的兼底（上面还有 script/{{}} 清洗）。
			if (/(===|!==|\?\?|&&|\|\||=>|\?\.|\$\{|`|[?]\s*["'`]|["'`]\s*[?])/.test(segment)) continue;
			punctSegments.push({ text: segment, where: file.rel, template: templateTainted });
		}
	}
	if (punctSegments.length > 0) {
		// 模板段落不算“空格问题”：那两条规则的输入已经被插值移除污染过
		const SPACE_RULES = new Set(["punct-space-before-cjk-punct", "punct-paren-space"]);
		const plainSegs = punctSegments.filter((s) => s.template !== true);
		const tplSegs = punctSegments.filter((s) => s.template === true);
		report.items.push(...auditPunct(plainSegs, { hasCJK }));
		if (tplSegs.length > 0) {
			report.items.push(...auditPunct(tplSegs, { hasCJK }).filter((f) => SPACE_RULES.has(f.rule) === false));
		}
	}

	/* --- 对比度（WCAG AA/AAA + APCA） ---------------------------------------- */
	// 前景色取自规则的 color；背景取「最近的 background-color」——
	// 源码层无法算继承链，所以用「全文最常见的背景色」当默认底色（通常是 body），
	// 规则自己写了 background-color 就用它。算不出来就跳过（不猜）。
	// 页面底色只能从 **body / html / :root / #root** 的规则里取，不能取「全文最常见的背景色」。
	// 实测误报（dsh-visualkit 自身）：`.stage{color:#3b82f6}` 被配上了 `button.primary{background:#3b82f6}`
	// —— 因为它自己的背景色恰好是全文唯一的 background 声明，于是算出 1.00:1 的假报。
	const PAGE_BG_RE = /(?:^|[\s,>+~])(?:html|body|:root|#root|#app)(?:$|[\s,.:#[>+~])/i;
	let defaultBg;
	for (const rule of rules) {
		if (!PAGE_BG_RE.test(rule.selector)) continue;
		const decl = firstDecl(rule, "background-color") ?? firstDecl(rule, "background");
		if (decl === undefined) continue;
		defaultBg = decl.value.replace(/!important/gi, "").trim();
		break;
	}
	const contrastPairs = [];
	for (const rule of rules) {
		const colorDecl = firstDecl(rule, "color");
		if (colorDecl === undefined) continue;
		const ownBg = firstDecl(rule, "background-color") ?? firstDecl(rule, "background");
		const bg = ownBg === undefined ? defaultBg : ownBg.value;
		if (bg === undefined) continue;
		// 半透明背景算不出实际对比度（不知道下层是什么）：
		// 实测 rgba(255,255,255,.18) 会被当成纯白，跟白字算出 1:1 —— 纯误报。跳过。
		const bgColor = parseColor(bg);
		if (bgColor === null || (bgColor.a !== undefined && bgColor.a < 0.95)) continue;
		const bold = /^(bold|[6-9]00)$/.test((firstDecl(rule, "font-weight")?.value ?? "").trim()) || /font-weight\s*:\s*(bold|[6-9]00)/i.test(rule.declText ?? rule.selector);
		contrastPairs.push({
			fg: colorDecl.value,
			bg,
			fontSizePx: rule.size !== undefined && rule.size !== null && rule.size > 0 ? rule.size : bodySize > 0 ? bodySize : 16,
			bold,
			where: at(rule.file, rule.line)
		});
	}
	if (contrastPairs.length > 0) {
		const contrastFindings = auditContrast(contrastPairs);
		// CSS 变量是现代项目的常态，会把 contrast-invalid 刷成好几条 info。
		// 只留一条并说明「有多少条被跳过」，避免用小体积噪声把 score 抬高。
		const invalid = contrastFindings.filter((f) => f.rule === "contrast-invalid");
		const rest = contrastFindings.filter((f) => f.rule !== "contrast-invalid");
		report.items.push(...rest);
		if (invalid.length > 0) {
			report.items.push({
				...invalid[0],
				message: `${invalid.length} 处颜色无法解析（currentColor / inherit / CSS 变量 / transparent）：这些对比度检查已跳过`,
				fix: "要精确检查对比度：把这些颜色换成具体色值，或在 .design-intent.json 里记录实际色板后手工核对"
			});
		}
	}

	/* --- 标题顺序（h1→h3 跳级 / 首标题非 h1 / 多 h1） ----------------------- */
	// 按「文件 + 行号」排序当作文档顺序（CSS 源序近似 DOM 顺序，够用）。
	// 文档顺序必须从**实际标记**取，不能从 CSS 选择器取：
	// CSS 里只写了 h1..h6 并不代表页面就按顺序用。实测（2026-11-07，Flow-Pilot）：
	// React 项目只在 index.css 里定义了 h5/h6 的字号，就被判成「首标题是 h5」——纯误报。
	// 所以只扫真标记：html（含 vue/svelte/astro）与 js 系（JSX/TSX 里的 <h1>）。
	const headingSequence = [];
	for (const file of files) {
		if (file.kind !== "html" && file.kind !== "js") continue;
		if (TEST_FILE_RE.test(file.path ?? "")) continue;
		const lineStarts = lineStartsOf(file);
		for (const match of file.stripped.matchAll(/<h([1-6])[\s>/]/g)) {
			headingSequence.push({ level: Number(match[1]), rel: file.rel, line: lineAt(lineStarts, match.index ?? 0) });
		}
	}
	// **按文件分别评估**，不能跨文件合在一起：
	// 组件化 UI 里每个页面/组件各自用 h1/h2 是正常的（实测 Flow-Pilot：7 个页面各一个 h1，
	// 合起来就变成「5 个 h1」误报；每个页面从 h2 起也正常，因为外层 shell 才有 h1）。
	// 「首个标题是不是 h1」只在**真文档**（含 <html>/<body>）上判——组件里无法确定。
	const headingsByFile = new Map();
	for (const h of headingSequence) {
		if (!headingsByFile.has(h.rel)) headingsByFile.set(h.rel, []);
		headingsByFile.get(h.rel).push(h);
	}
	for (const [rel, list] of headingsByFile) {
		list.sort((a, b) => a.line - b.line);
		const source = files.find((f) => f.rel === rel);
		// 「首个标题必须是 h1」只在**真文档**上判，而且要**够得上文档大纲**：
		//   - 应用外壳（工具栏+栏位）里 h3/h4 是组件标题，不是大纲，判它就是误报；
		//   - 只有 1–2 个标题的页面谈不上大纲（实测在线文档参照稿就 2 个，被误报）。
		// 三个条件同时成立才判：文档标记 + 非应用外壳 + ≥3 个标题。
		const isDocument = source !== undefined && /<html\b|<body\b/i.test(source.stripped) && !appShell && list.length >= 3;
		const fileFindings = auditHeadingOrder(list.map((h) => ({ level: h.level, where: `${h.rel}:${h.line}` })));
		report.items.push(
			...fileFindings.filter((f) => (isDocument ? true : f.rule !== "structure-heading-first"))
		);
	}

	/* --- 触摸目标（WCAG 2.2 AA 24px / HIG 44px） ------------------------- */
	// 只有「同一规则里同时写了 width 与 height」且选择器像交互元素时才判，
	// 否则任意固定尺寸的容器都会被当成按钮。
	const INTERACTIVE_RE = /(?:^|[\s,>+~.#:])(button|a|input|select|textarea|label|summary)(?:$|[\s,.:#[>+~])/i;
	// 只看选择器名字不够：`.tiny{width:100px;height:20px}` 这个类到底是不是按钮，
	// 得看 HTML 里它长在哪个标签上。所以先把「交互标签上的 class / id」收集成白名单。
	const interactiveNames = new Set();
	for (const file of files) {
		if (file.kind !== "html") continue;
		for (const match of file.stripped.matchAll(/<(button|a|input|select|textarea|label|summary)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi)) {
			const attrs = match[2] ?? "";
			for (const attr of attrs.matchAll(/(?:class|id)\s*=\s*["']([^"']*)["']/gi)) {
				for (const name of attr[1].split(/\s+/)) if (name !== "") interactiveNames.add(name);
			}
		}
	}
	const isInteractiveRule = (selector) => {
		// 只看**最后一个复合选择器**：`.risk-filter-btn .dot` 里量的是 6px 的小圆点，
		// 不是按钮热区；拿整串去匹配会把装饰子元素当成控件（实测 Colibri 报了 3 条）。
		const last = selector.split(/[\s>+~]+/).filter((x) => x !== "").pop() ?? selector;
		if (/::?(?:before|after|marker|placeholder|thumb|track)\b/i.test(last)) return false;
		if (INTERACTIVE_RE.test(last)) return true;
		for (const token of last.matchAll(/[.#]([A-Za-z_-][\w-]*)/g)) if (interactiveNames.has(token[1])) return true;
		return false;
	};
	// 量的是**元素热区**，不是它里面的图标：`.tb-max svg { width:12px;height:12px }`
	// 说的是图标尺寸，按钮的热区由 padding 决定。实测（Colibri 标题栏）这条把
	// 三个 32×28 的按钮按 12×12 报成“触摸目标过小”——报错了对象。
	const ICON_CHILD_RE = /(?:^|[\s>+~])(?:svg|img|i|span|path|use|picture)\s*$/i;
	const touchTargets = [];
	for (const rule of rules) {
		if (ICON_CHILD_RE.test(rule.selector.trim())) continue;
		if (!isInteractiveRule(rule.selector)) continue;
		const w = parseWidth(firstDecl(rule, "width")?.value ?? "", bodySize, varMap);
		const h = parseWidth(firstDecl(rule, "height")?.value ?? "", bodySize, varMap);
		if (w === null || h === null) continue;
		touchTargets.push({ width: w, height: h, label: rule.selector.slice(0, 24), where: at(rule.file, rule.line) });
	}
	if (touchTargets.length > 0) report.items.push(...auditTouchTargets(touchTargets));

	/* --- 覆盖度：把「没测到」写清楚 ------------------------------------------------- */
	const measured = [];
	if (sizeRecords.length > 0) measured.push("字号与行高");
	if (measureRecords.length > 0) measured.push(`行长×${measureRecords.length}`);
	if (punctSegments.length > 0) measured.push(`文案段×${punctSegments.length}`);
	if (contrastPairs.length > 0) measured.push(`对比度×${contrastPairs.length}`);
	if (headingSequence.length > 0) measured.push(`标题×${headingSequence.length}`);
	if (touchTargets.length > 0) measured.push(`触摸目标×${touchTargets.length}`);
	const rulesRun = new Set();
	if (sizeRecords.length > 0) for (const r of ["S1", "S2", "S4", "S9"]) rulesRun.add(r);
	if (ratioRecords.length > 0 || sizeRecords.length > 0) rulesRun.add("S3");
	if (familyCount > 0) rulesRun.add("S5");
	if (alignRules.length > 0) rulesRun.add("S6");
	if (punctSegments.length > 0) rulesRun.add("punct");
	if (contrastPairs.length > 0) rulesRun.add("contrast");
	if (headingSequence.length > 0) rulesRun.add("structure-heading");
	if (touchTargets.length > 0) rulesRun.add("structure-touch");

	/* --- 声明豁免：.design-intent.json（与 taste_check taste 同一套语义） ------------------- */
	// 实测动机（Flow-Pilot）：h5/h6 被有意收敛到正文大小（CSS 里写了理由），
	// 体检只能看到「差 1.13×」并报 error。写了 allow 就不计分，但进 exempted 可追溯。
	const intent = readIntent(files.length === 1 && files[0].path === target ? dirname(target) : target);
	const applied = applyAllow(report.items, intent);
	// 全局封顶：先按 severity 排序再切，保证 error 不被 warn 挤掉
	const SEVERITY_RANK = { error: 0, warn: 1, info: 2 };
	const ranked = [...applied.kept].sort((a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3));
	const keptFindings = ranked.slice(0, MAX_FINDINGS);
	const findingsTruncated = ranked.length > MAX_FINDINGS;

	return finalize({
		mode: "ui",
		target,
		metrics: {
			filesScanned: files.length,
			fontSizes,
			bodySize,
			scaleRatio,
			familyCount,
			lineHeightRatios,
			violations: ranked.length,
			findingsTotal: ranked.length,
			...(findingsTruncated ? { findingsTruncated: true } : {}),
			truncated,
			hasCJK,
			rulesRun: rulesRun.size,
			measured,
			...(applied.exempted.length > 0 ? { exempted: applied.exempted } : {})
		},
		findings: keptFindings,
		// finalize 只透传 extras，不能写成兄弟键
		...(applied.exempted.length > 0
			? {
					extras: {
						intent: {
							allow: applied.exempted,
							...(applied.exemptionReason !== undefined ? { reason: applied.exemptionReason } : {})
						}
					}
				}
			: {})
	});
}
