/**
 * html-context.js — 判断「某个位置在 HTML 里是什么」。
 *
 * 为什么需要它：机械替换（emoji→SVG、直引号→弯引号、术语替换）最容易翻车的地方
 * 不是替换规则，而是**替换发生在哪**：
 *   · 文本节点里可以放 `<svg>`，浏览器会渲染它；
 *   · 属性值里放 `<svg>`，浏览器会把它当**文本**显示出来（实测：搜索框右侧溢出
 *     一段 `<svg class="ico" …>` 原始标记）；
 *   · 把属性值的**结束引号**换掉（`placeholder="…"` → `placeholder="…“`），
 *     属性会被撑破，后面半页内容全部错位；
 *   · `<script>` / `<style>` / `<!-- -->` 里根本不该动。
 * 所以先把位置分类，再决定怎么改。
 *
 * 只做一件事：扫描成「带 kind 的区段」，不解释标签语义、不做 DOM 树。
 * 无依赖、可在任何 HTML 片段上跑（含 Vue/Svelte 模板；`{{ }}` 归到文本节点，
 * 由调用方决定要不要进一步排除）。
 */

/** 哨兵：pair 命中但映射为空（区别于“显式删除”的 null）。 */
const UNMAPPED = Symbol("unmapped");

/** 区段种类。 */
export const KIND = {
	TEXT: "text",
	TAG: "tag",
	ATTR_NAME: "attrName",
	ATTR_VALUE: "attrValue",
	SCRIPT: "script",
	STYLE: "style",
	COMMENT: "comment",
	DOCTYPE: "doctype",
	RAW: "raw"
};

/**
 * 把源码切成区段。
 * @param {string} source
 * @returns {{kind:string, start:number, end:number, attr?:string, quote?:string}[]}
 */
export function scanHtml(source) {
	const s = String(source);
	const out = [];
	let i = 0;
	const push = (kind, start, end, extra) => {
		if (end > start) out.push({ kind, start, end, ...(extra ?? {}) });
	};

	while (i < s.length) {
		const lt = s.indexOf("<", i);
		if (lt === -1) {
			push(KIND.TEXT, i, s.length);
			break;
		}
		if (lt > i) push(KIND.TEXT, i, lt);

		// 注释 / doctype / CDATA
		if (s.startsWith("<!--", lt)) {
			const close = s.indexOf("-->", lt + 4);
			const end = close === -1 ? s.length : close + 3;
			push(KIND.COMMENT, lt, end);
			i = end;
			continue;
		}
		if (s.startsWith("<!", lt) || s.startsWith("<?", lt)) {
			const close = s.indexOf(">", lt);
			const end = close === -1 ? s.length : close + 1;
			push(KIND.DOCTYPE, lt, end);
			i = end;
			continue;
		}

		// script / style：整段吃掉（里面的 < > 不当标签）
		const rawTag = /^<(script|style|textarea|pre)\b/i.exec(s.slice(lt, lt + 12));
		if (rawTag !== null) {
			const tagName = rawTag[1].toLowerCase();
			const openEnd = s.indexOf(">", lt);
			if (openEnd === -1) {
				push(KIND.RAW, lt, s.length);
				break;
			}
			const closeRe = new RegExp(`</${tagName}\\s*>`, "i");
			const rest = s.slice(openEnd + 1);
			const m = closeRe.exec(rest);
			const end = m === null ? s.length : openEnd + 1 + m.index + m[0].length;
			// 开标签本身仍然要解析属性（`<script src="…">`）
			parseTag(s, lt, openEnd + 1, out, push);
			push(tagName === "script" ? KIND.SCRIPT : KIND.STYLE, openEnd + 1, end - (m === null ? 0 : m[0].length));
			if (m !== null) parseTag(s, end - m[0].length, end, out, push);
			i = end;
			continue;
		}

		// 普通标签（含自闭合）：属性值里的 `>` 不能截断，必须尊重引号
		const tagEnd = findTagEnd(s, lt);
		parseTag(s, lt, tagEnd, out, push);
		i = tagEnd;
	}
	return out;
}

/** 找标签的结束位置：跳过引号内的 `>`。 */
function findTagEnd(s, from) {
	let quote = null;
	for (let i = from + 1; i < s.length; i += 1) {
		const ch = s[i];
		if (quote !== null) {
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (ch === ">") return i + 1;
	}
	return s.length;
}

/** 解析一个标签区间，产出 TAG / ATTR_NAME / ATTR_VALUE 区段。 */
function parseTag(s, start, end, out, push) {
	push(KIND.TAG, start, end);
	const inner = s.slice(start, end);
	// 属性：name、name=value、name="value"、name='value'（引号内的内容单独成段）
	const re = /([:@\w-]+)(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))?/g;
	// 跳过标签名本身
	const nameEnd = /^<\/?[a-zA-Z][\w:-]*/.exec(inner);
	const from = nameEnd === null ? 0 : nameEnd[0].length;
	re.lastIndex = from;
	let m;
	while ((m = re.exec(inner)) !== null) {
		const valuePart = m[3] ?? m[4] ?? m[5];
		if (valuePart === undefined) continue;
		const valueOffset = m.index + m[1].length + m[2].length + (m[3] !== undefined || m[4] !== undefined ? 1 : 0);
		push(KIND.ATTR_VALUE, start + valueOffset, start + valueOffset + valuePart.length, { attr: m[1] });
	}
}

/**
 * 查某个偏移属于哪个区段（线性足够：区段数在千级、单次改写也只查命中的几处）。
 * @param {{kind:string,start:number,end:number,attr?:string}[]} segments
 * @param {number} index
 */
export function kindAt(segments, index) {
	// 要取**最具体**的那一段：标签区间（TAG）包住了属性值区间（ATTR_VALUE），
	// 先碰到 TAG 就返回会把 `title="搜索 🔍 内容"` 里的 emoji 误判成“标签结构”，
	// 于是本该“改不得”的属性值被当成整体拒绝，或被错误地归到 text。
	let best = null;
	for (const seg of segments) {
		if (index < seg.start || index >= seg.end) continue;
		if (best === null || seg.end - seg.start < best.end - best.start) best = seg;
	}
	return best ?? { kind: KIND.TEXT, start: index, end: index + 1 };
}

/**
 * 按上下文约束做字面量替换。
 *
 * @param {object} opts
 * @param {string} opts.source 原文
 * @param {string|RegExp} opts.find 要替换的内容（字符串按字面量处理）
 * @param {string|((m:string)=>string)} opts.replace 替换内容
 * @param {"text"|"text+attr"|"all"} [opts.scope] 允许改动的上下文，默认 text
 * @param {boolean} [opts.allowMarkupInAttr] 允许把含 `<` 的内容写进属性（默认拒绝）
 * @returns {{output:string, changes:{kind:string,attr?:string,index:number,from:string,to:string}[], refused:{kind:string,attr?:string,index:number,reason:string}[]}}
 */
export function rewriteByContext(opts) {
	const source = String(opts.source ?? "");
	const scope = opts.scope ?? "text";
	// 两种用法：单条 find/replace，或批量 pairs[{find,replace}]。
	// 批量**一次性匹配**（合成一个正则），不是逐条跑——逐条跑时前一条插入的内容
	// 会被后一条再匹配到，也更容易把偏移搞乱。
	const pairs = Array.isArray(opts.pairs) && opts.pairs.length > 0 ? opts.pairs : null;
	if (pairs === null && (opts.find === undefined || opts.find === "")) throw new Error("rewriteByContext 需要 find 或 pairs");
	// strict（默认开）：**映射为空**不等于“删掉”。
	// 实测教训（2026-11-08，现代化改造 v1）：映射表里漏了几个 emoji，脚本把“查不到图标”
	// 当成空串传进来，结果那几行图标被默默删掉，渲染出来只剩文字——不报错、不提示，最难查。
	// 所以空映射默认**拒绝**；确实要删就显式写 `replace: null`（工具层写作 `原文=>(del)`）。
	const strict = opts.strict !== false;
	const segments = scanHtml(source);
	const changes = [];
	const refused = [];
	const unmapped = [];

	const allowed = (kind) => {
		if (scope === "all") return kind !== KIND.COMMENT;
		if (kind === KIND.TEXT) return true;
		if (kind === KIND.ATTR_VALUE) return scope === "text+attr";
		return false; // script / style / comment / tag / doctype
	};

	let re;
	let lookup = null;
	if (pairs === null) {
		const find = opts.find;
		re = find instanceof RegExp ? new RegExp(find.source, find.flags.includes("g") ? find.flags : `${find.flags}g`) : new RegExp(escapeRegExp(find), "g");
	} else {
		// 长字符串优先，避免 "ab" 抢在 "abc" 前面
		const sorted = [...pairs].filter((p) => typeof p.find === "string" && p.find !== "").sort((a, b) => b.find.length - a.find.length);
		lookup = new Map();
		for (const pair of sorted) {
			const empty = pair.replace === "" || pair.replace === undefined;
			if (empty && strict) {
				// 不放进 lookup：命中时会被当成“没配映射”拒绝，而不是静默删除
				unmapped.push(pair.find);
				lookup.set(pair.find, UNMAPPED);
				continue;
			}
			lookup.set(pair.find, pair.replace === undefined ? null : pair.replace);
		}
		re = new RegExp(sorted.map((p) => escapeRegExp(p.find)).join("|"), "g");
	}

	let output = source;
	// 从后往前替换，避免偏移漂移
	const hits = [];
	for (const m of source.matchAll(re)) hits.push({ index: m.index ?? 0, text: m[0] });
	for (let k = hits.length - 1; k >= 0; k -= 1) {
		const hit = hits[k];
		const seg = kindAt(segments, hit.index);
		const raw = lookup === null ? opts.replace : lookup.get(hit.text);
		if (raw === UNMAPPED) {
			refused.push({ kind: seg.kind, attr: seg.attr, index: hit.index, reason: `「${hit.text}」映射为空——这是有意删除就写 \`${hit.text}=>(del)\`，否则补上要换成的图标/文本`, from: hit.text });
			continue;
		}
		const next = typeof raw === "function" ? raw(hit.text) : String(raw ?? "");
		if (!allowed(seg.kind)) {
			refused.push({ kind: seg.kind, attr: seg.attr, index: hit.index, reason: reasonOf(seg.kind, scope) });
			continue;
		}
		// 属性值里注入标记 = 一定会被当文本显示出来
		if (seg.kind === KIND.ATTR_VALUE && /[<>]/.test(next) && opts.allowMarkupInAttr !== true) {
			refused.push({ kind: seg.kind, attr: seg.attr, index: hit.index, reason: "替换内容含 < 或 >，写进属性会被当成文本显示" });
			continue;
		}
		output = output.slice(0, hit.index) + next + output.slice(hit.index + hit.text.length);
		changes.push({ kind: seg.kind, attr: seg.attr, index: hit.index, from: hit.text, to: next });
	}
	changes.reverse();
	refused.reverse();
	return { output, changes, refused, unmapped };
}

function reasonOf(kind, scope) {
	if (kind === KIND.COMMENT) return "注释里不渲染，不需要改";
	if (kind === KIND.SCRIPT || kind === KIND.STYLE) return "脚本/样式里是代码，不是文案";
	if (kind === KIND.ATTR_VALUE) return `scope=${scope} 不含属性值`;
	if (kind === KIND.TAG) return "标签结构，不按文案替换";
	return `scope=${scope} 不含 ${kind}`;
}

function escapeRegExp(text) {
	return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 字符类：“这个文件里有哪些 emoji / 直引号 / 全角标点”这类问题，
 * 不该靠人一个个试。`probe` 只能查已知字符串，`class` 先扫描分类。
 */
export const CLASSES = {
	// emoji：与 taste_check 同口径（主平面 emoji + 符号块，⚠⭐ 也算）
	emoji: /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}]/gu,
	// 直引号：中文行文里该用弯引号的那种
	"straight-quote": /["']/g,
	// 全角（中文）标点：检查中英混排该用半角/该不该加空格时用
	"cjk-punct": /[，。、；：！？（）【】「」『』《》〈〉…—]/g
};

/**
 * 按字符类扫描，并按「字符 × 上下文」分组。
 *
 * 为什么要分组：同一个 emoji 在文本节点里可以换成 `<svg>`；在属性/脚本里换成标记
 * 就会被当文本显示——所以“有多少个”不如“哪些能改”有用。
 */
export function locateClass(source, className) {
	const re = CLASSES[className];
	if (re === undefined) throw new Error(`未知的 class "${className}"（可用：${Object.keys(CLASSES).join(", ")}）`);
	const segments = scanHtml(source);
	const byChar = new Map();
	for (const m of source.matchAll(new RegExp(re.source, re.flags))) {
		const ch = m[0];
		const seg = kindAt(segments, m.index ?? 0);
		const entry = byChar.get(ch) ?? { char: ch, total: 0, counts: {} };
		const key = seg.attr === undefined ? seg.kind : `${seg.kind}:${seg.attr}`;
		entry.total += 1;
		entry.counts[key] = (entry.counts[key] ?? 0) + 1;
		byChar.set(ch, entry);
	}
	const chars = [...byChar.values()].sort((a, b) => b.total - a.total);
	const total = chars.reduce((sum, c) => sum + c.total, 0);
	// 只出现在属性/脚本/注释里的字符：换成标记没用，只能拿掉或保留
	const unconvertible = chars.filter((c) => c.counts.text === undefined);
	return { className, total, chars, unconvertible };
}

/** 汇总：按上下文统计出现次数（scan 用）。 */
export function locate(source, probe) {
	const segments = scanHtml(source);
	const found = [];
	if (typeof probe === "string" && probe !== "") {
		let from = 0;
		for (;;) {
			const index = source.indexOf(probe, from);
			if (index === -1) break;
			const seg = kindAt(segments, index);
			found.push({ index, kind: seg.kind, attr: seg.attr, line: source.slice(0, index).split("\n").length });
			from = index + probe.length;
		}
	}
	const counts = {};
	for (const item of found) {
		const key = item.attr === undefined ? item.kind : `${item.kind}:${item.attr}`;
		counts[key] = (counts[key] ?? 0) + 1;
	}
	return { found, counts, total: found.length };
}
