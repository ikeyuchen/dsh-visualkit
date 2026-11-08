/**
 * layouts/rules-punct.js — 中文标点 / 排版规则（12 条，rule id 统一 `punct-` 前缀）。
 *
 * 为什么单独一个文件：layout_check 已有的 S1–S9 看的是「CSS 排版声明」、G1–G9 看的是
 * 图形几何，标点是「文案层」的事——判据全是字符串规则，跟源码结构无关。所以本模块
 * 只吃 source.js 已经剥好的文本段（textSegments()：HTML 去标签、JS 只取字符串字面量、
 * CSS 只取 content），不自己读文件、不知道 <code>/<pre>/注释/字符串边界在哪。
 *
 * 契约（Lead 侧接线）：
 *   auditPunct(segments, options = {}) → Finding[]
 *     segments: Array<{ text: string, where: string }>，where 形如 "src/a.html:42"；
 *               传纯字符串数组也兼容（当 { text, where: "" } 处理，此时 finding 无 where）。
 *     options:  { hasCJK?: boolean } —— 调用方对整份目标的 CJK 判定，缺省按 true 处理。
 *
 * 判据与阈值（总原则：宁可漏报，不要误报；每条豁免都写在下面）：
 *   punct-straight-quote  error  中文语境出现直引号 " 或 '。豁免：' 两侧都是英文字母时
 *        按撇号处理（it's / don't / rock'n'roll）；" 前一个字符是数字时按英制英寸
 *        （5" 屏幕）处理。英文语境（hasCJK === false）降为 info。
 *   punct-double-hyphen   warn   出现 `--`。豁免：-- 后紧跟字母/下划线（CSS 自定义属性
 *        --gap、var(--x)）不算；`<!--` / `-->` 注释定界符不算。
 *   punct-three-dots      warn   出现 3 个以上半角点（...）。不区分中英语境。
 *   punct-halfwidth-cjk   error  半角 , . ; : ? ! 与汉字直接相邻（你好,世界）。豁免：
 *        . 与 , 前一个字符是数字时是小数点/千分位（3.14、1,000）；. 紧邻另一个点时
 *        归 punct-three-dots，不重复报。
 *   punct-fullwidth-latin warn   全角句读（，。；：？！、）两侧都是 ASCII 字母/数字，
 *        即「夹在英文里」（Hello，world）。**只认两侧都 ASCII**：`这样写，React 更好`
 *        里的 `，` 左侧是汉字，是合法中文标点，不报——这是本规则最容易误报的地方。
 *   punct-space-before-cjk-punct warn 汉字 + 空格 + 全角收尾标点（你好 ，世界）。
 *   punct-repeated-punct  warn   同类标点连写（！！ ？？ ，。）或异类连写（，。）。
 *        豁免：！？ / ？！ ——中文里是常见强调手法，不报。
 *   punct-paren-space     warn   全角括号（）内侧有多余空格（（ 说明 ）。只认圆括号，
 *        【】《》暂不管（不同团队写法差异太大）。
 *   punct-quote-nesting   warn   双引号 “ ” 内部再出现双引号（应改内层单引号 ‘’）。
 *   punct-dash-spacing    warn   em dash（— / ——）与汉字之间夹空格。豁免：两侧都不是
 *        汉字的英文写法（a — b）不报——那是英文排版惯例。
 *   punct-cjk-latin-space info    同一文本段里汉字与拉丁字母紧贴 ≥3 处才报（1–2 处多半
 *        是 API 名 / 单位缩写的正常写法）。纯数字紧贴（2026年、第3章）不算，与 source.js
 *        的 mixedSpacingHits() 同口径。
 *        TODO(重复)：本条与 layout_check S8（source.js 的 mixedSpacingHits）判据重叠，
 *        若 Lead 决定去重，直接删掉本条即可，其余 11 条不受影响。
 *   punct-ellipsis-count  info    `…` 连写 3 个以上才报（中文规范就是两个 ……，1–2 个正常）。
 *
 * 通用约定：
 *   - 每条规则「同一文件」最多 3 条 finding，按出现顺序取前 3（文件键 = where 去掉末尾
 *     ":行号"，所以单文件调用就是每规则 3 条）。
 *   - message 一律带实际违规片段（≤24 字，换行/制表符换成空格，普通空格保留——空格类
 *     规则要靠它才能定位），格式为 `<说明>（片段「…」）`。
 *   - hasCJK === false 时：punct-halfwidth-cjk / punct-fullwidth-latin /
 *     punct-quote-nesting / punct-paren-space 不报（中文标点规则在英文语境无意义），
 *     punct-straight-quote 降为 info。
 *   - 纯函数：不改入参、不依赖时间/随机，同输入两次结果 deepEqual。
 */
import { finding } from "./common.js";

/* ------------------------------ 阈值与口径 ------------------------------ */

/** 每条规则「同一文件」最多留几条 finding：位置热点比穷举有用，score 也有 100 封顶。 */
const MAX_PER_RULE_PER_FILE = 3;
/** message 里违规片段的最大字数（含标点与空格）。 */
const SNIPPET_MAX = 24;
/** 汉字范围：与 source.js 的 CJK 口径一致，另加扩展 A（㐀-䶿）与兼容区（豈-﫿）。 */
const CJK_RANGE = "\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff";
const CJK_RE = new RegExp(`[${CJK_RANGE}]`);
/** 中文句读：只有这些参与「重复标点」，括号 / 引号 / 破折号各有专门规则。 */
const FW_SENTENCE = "，。；：？！、";
const FW_SENTENCE_CLASS = `[${FW_SENTENCE}]`;
/** 半角 → 全角（punct-halfwidth-cjk 的 fix 要逐字说清换哪个）。 */
const HALF_TO_FULL = { ",": "，", ".": "。", ";": "；", ":": "：", "?": "？", "!": "！" };
/** ！？ 连写在中文里是刻意的强调手法，按风格处理，不算「重复标点」。 */
const EMPHATIC_PAIRS = new Set(["！？", "？！"]);

/* ------------------------------ 预算好的正则 ------------------------------ */

/** `--` 连写（长度取实际连写数，`---` 也算一条）。 */
const RE_DOUBLE_HYPHEN = /-{2,}/g;
/** 三个以上半角点。 */
const RE_THREE_DOTS = /\.{3,}/g;
/** 半角标点与汉字直接相邻（两个方向都算）。 */
const RE_HALFWIDTH_CJK = new RegExp(`[${CJK_RANGE}][,.;:?!]|[,.;:?!][${CJK_RANGE}]`, "g");
/** 全角句读两侧都是 ASCII 字母/数字 = 夹在英文里。 */
const RE_FULLWIDTH_LATIN = new RegExp(`[A-Za-z0-9]${FW_SENTENCE_CLASS}[A-Za-z0-9]`, "g");
/** 汉字 + 空格 + 全角收尾标点。 */
const RE_SPACE_BEFORE_FW = new RegExp(`[${CJK_RANGE}][ \\t]+[，。；：？！、）】》”’]`, "g");
/** 汉字与拉丁字母紧贴（数字不算，见文件头）。 */
const RE_CJK_LATIN = new RegExp(`[${CJK_RANGE}][A-Za-z]|[A-Za-z][${CJK_RANGE}]`, "g");
/** 省略号连写 3 个以上。 */
const RE_ELLIPSIS_RUN = /…{3,}/g;
/** 汉字 + 空格 + em dash ／ em dash + 空格 + 汉字（破折号两侧多余空格）。 */
const RE_DASH_SPACE_AFTER_CJK = new RegExp(`[${CJK_RANGE}][ \\t]+—+`, "g");
const RE_SPACE_BEFORE_DASH_CJK = new RegExp(`—+[ \\t]+[${CJK_RANGE}]`, "g");
/** 全角左括号 / 右括号（括号内侧空格规则用）。 */
const RE_FW_OPEN = /（/g;
const RE_SPACE_FW_CLOSE = /[ \t]+）/g;

/* ------------------------------ 片段与匹配工具 ------------------------------ */

function hasCJK(text) {
	CJK_RE.lastIndex = 0;
	return CJK_RE.test(text);
}

/**
 * 取命中位置附近的片段（≤ SNIPPET_MAX 字）。
 * 只把换行 / 制表符换成空格，普通空格原样保留——`你好 ，世界` 这类规则要靠空格本身定位。
 */
function snippet(text, index, length) {
	const span = Math.max(1, Math.min(length, SNIPPET_MAX));
	const room = SNIPPET_MAX - span;
	const latest = Math.max(0, text.length - SNIPPET_MAX);
	const start = Math.max(0, Math.min(index - Math.floor(room / 2), latest));
	return text.slice(start, start + SNIPPET_MAX).replace(/[\r\n\t]/g, " ");
}

/** 避免 g 正则的 lastIndex 在多次调用之间串味（同输入必须同结果）。 */
function allMatches(text, re) {
	const out = [];
	re.lastIndex = 0;
	let match;
	while ((match = re.exec(text)) !== null) {
		out.push(match);
		if (match[0].length === 0) re.lastIndex += 1;
	}
	return out;
}

/** 命中项按出现顺序排好，重叠的只留先出现的那个（`——` 前后空格不该报两次）。 */
function orderedHits(hits) {
	const sorted = hits.slice().sort((a, b) => a.index - b.index);
	const kept = [];
	for (const hit of sorted) {
		const end = hit.index + Math.max(1, hit.length);
		const overlaps = kept.some((other) => hit.index < other.index + Math.max(1, other.length) && other.index < end);
		if (overlaps) continue;
		kept.push(hit);
	}
	return kept;
}

/** where = "src/a.html:42" → 文件键 "src/a.html"（每规则「单文件」封顶靠它）。 */
function fileKeyOf(where) {
	const cut = where.lastIndexOf(":");
	if (cut > 0 && /^\d+$/.test(where.slice(cut + 1))) return where.slice(0, cut);
	return where;
}

/* ------------------------------ 各规则的扫描器 ------------------------------ */
/* 每个扫描器返回 [{ index, length, label?, count? }]：index/length 用于取片段，
   label 是命中的具体字符（fix 里要指名道姓），count 是「同段共 N 处」的聚合数。 */

/** 中文语境的直引号；' 两侧是字母时按英文撇号放过，" 紧跟数字时按英寸放过。 */
function scanStraightQuotes(text, cjkMode) {
	if (cjkMode && !hasCJK(text)) return [];
	const hits = [];
	for (let i = 0; i < text.length; i += 1) {
		const char = text[i];
		if (char !== '"' && char !== "'") continue;
		const before = text[i - 1] ?? "";
		const after = text[i + 1] ?? "";
		if (char === "'" && /[A-Za-z]/.test(before) && /[A-Za-z]/.test(after)) continue;
		if (char === '"' && /[0-9]/.test(before)) continue;
		hits.push({ index: i, length: 1, label: char });
	}
	return hits;
}

function scanDoubleHyphen(text) {
	const hits = [];
	for (const match of allMatches(text, RE_DOUBLE_HYPHEN)) {
		const before = text[match.index - 1] ?? "";
		const after = text[match.index + match[0].length] ?? "";
		if (/[A-Za-z_]/.test(after)) continue;
		if (before === "!" || after === ">") continue;
		hits.push({ index: match.index, length: match[0].length, label: match[0] });
	}
	return hits;
}

function scanThreeDots(text) {
	return allMatches(text, RE_THREE_DOTS).map((match) => ({ index: match.index, length: match[0].length, label: match[0] }));
}

function scanHalfwidthCjk(text) {
	const hits = [];
	for (const match of allMatches(text, RE_HALFWIDTH_CJK)) {
		const first = text[match.index];
		const punctIndex = /[,.;:?!]/.test(first) ? match.index : match.index + 1;
		const punct = text[punctIndex];
		const before = text[punctIndex - 1] ?? "";
		if ((punct === "." || punct === ",") && /[0-9]/.test(before)) continue;
		if (punct === "." && (text[punctIndex - 1] === "." || text[punctIndex + 1] === ".")) continue;
		// 实测假误报：`做动画片.jpg` —— 这里的点属于**拉丁文件名/扩展名**，不是中文标点。
		// 判据：点后面紧跟 ≥2 个连续拉丁字母（jpg / com / txt），就当它是 token 的一部分。
		if (punct === "." && /^[A-Za-z]{2,}/.test(text.slice(punctIndex + 1, punctIndex + 8))) continue;
		hits.push({ index: punctIndex, length: 1, label: punct });
	}
	return hits;
}

function scanFullwidthLatin(text) {
	return allMatches(text, RE_FULLWIDTH_LATIN).map((match) => ({
		index: match.index + 1,
		length: 1,
		label: text[match.index + 1]
	}));
}

function scanSpaceBeforeCjkPunct(text) {
	return allMatches(text, RE_SPACE_BEFORE_FW).map((match) => ({
		index: match.index,
		length: match[0].length,
		label: match[0].slice(-1)
	}));
}

/** 句读连写：先取最长连写段，再看是否属于「！？」这种刻意强调。 */
function scanRepeatedPunct(text) {
	const hits = [];
	let i = 0;
	while (i < text.length) {
		if (!FW_SENTENCE.includes(text[i])) {
			i += 1;
			continue;
		}
		let end = i + 1;
		while (end < text.length && FW_SENTENCE.includes(text[end])) end += 1;
		const run = text.slice(i, end);
		if (run.length >= 2 && !(run.length === 2 && EMPHATIC_PAIRS.has(run))) {
			hits.push({ index: i, length: run.length, label: run });
		}
		i = end;
	}
	return hits;
}

/** 全角括号内侧空格：先按「成对」整段报一次，未闭合的再单独兜底。 */
function scanParenSpace(text) {
	const hits = [];
	for (const match of allMatches(text, RE_FW_OPEN)) {
		const open = match.index;
		// 只在 40 字内配对，避免把跨段落的不相关括号连成一片
		const near = text.slice(open + 1, open + 41);
		const closeAt = near.indexOf("）");
		if (closeAt !== -1) {
			const inner = near.slice(0, closeAt);
			if (/^[ \t]/.test(inner) || /[ \t]$/.test(inner)) hits.push({ index: open, length: closeAt + 2 });
			continue;
		}
		if (/^[ \t]/.test(near)) hits.push({ index: open, length: 2 });
	}
	// 只有右括号一侧有空格（左括号在上一个文本段里被切走）时兜底
	for (const match of allMatches(text, RE_SPACE_FW_CLOSE)) {
		hits.push({ index: match.index, length: match[0].length });
	}
	return hits;
}

/** 双引号嵌套：同一文本段内 “ 出现在未闭合的 “ 里就是层级错。 */
function scanQuoteNesting(text) {
	const hits = [];
	let depth = 0;
	for (let i = 0; i < text.length; i += 1) {
		const char = text[i];
		if (char === "“") {
			if (depth >= 1) hits.push({ index: i, length: 1 });
			depth += 1;
		} else if (char === "”" && depth > 0) {
			depth -= 1;
		}
	}
	return hits;
}

function scanDashSpacing(text) {
	const hits = [];
	for (const match of allMatches(text, RE_DASH_SPACE_AFTER_CJK)) hits.push({ index: match.index, length: match[0].length });
	for (const match of allMatches(text, RE_SPACE_BEFORE_DASH_CJK)) hits.push({ index: match.index, length: match[0].length });
	return hits;
}

/** 汉字与拉丁字母紧贴：同一段满 3 处才报（1–2 处多半是正常写法）。 */
function scanCjkLatinSpace(text) {
	const matches = allMatches(text, RE_CJK_LATIN);
	if (matches.length < 3) return [];
	return [{ index: matches[0].index, length: matches[0][0].length, count: matches.length }];
}

function scanEllipsisCount(text) {
	return allMatches(text, RE_ELLIPSIS_RUN).map((match) => ({ index: match.index, length: match[0].length, count: match[0].length }));
}

/* ------------------------------ 规则表 ------------------------------ */
/* 顺序即报告顺序；severityEnglish 表示英文语境下的降级档；cjkOnly 表示英文语境不报。 */
const RULES = [
	{
		rule: "punct-straight-quote",
		severity: "error",
		severityEnglish: "info",
		scan: (text, cjkMode) => scanStraightQuotes(text, cjkMode),
		describe: (hit, cjkMode) => {
			// 英文语境下直引号是正常写法，只是风格提示，措辞跟着语境走
			const where = cjkMode ? "中文语境" : "英文语境";
			return hit.label === '"'
				? {
						message: `${where}出现直双引号`,
						fix: '中文行文成对换成弯引号 “ 与 ”（他说"好" → 他说“好”）；英文正文用直引号可以不改'
				  }
				: {
						message: `${where}出现直单引号`,
						fix: "中文行文成对换成弯单引号 ‘ 与 ’（他说'好' → 他说‘好’）；英文撇号 it's 保持半角"
				  };
		}
	},
	{
		rule: "punct-double-hyphen",
		severity: "warn",
		scan: (text) => scanDoubleHyphen(text),
		describe: () => ({
			message: "出现连写的半角连字符 --",
			fix: "中文破折号用 ——（两个 em dash、不加空格）；英文范围用 –、断句用 —；不要用 -- 凑"
		})
	},
	{
		rule: "punct-three-dots",
		severity: "warn",
		scan: (text) => scanThreeDots(text),
		describe: () => ({
			message: "用半角点代替省略号",
			fix: "换成单字符省略号 …：中文行文连写两个就是 ……；\"...等\" → \"…等\""
		})
	},
	{
		rule: "punct-halfwidth-cjk",
		severity: "error",
		cjkOnly: true,
		scan: (text) => scanHalfwidthCjk(text),
		describe: (hit) => ({
			message: `中文语境用了半角标点 ${hit.label}`,
			fix: `换成全角：${hit.label} → ${HALF_TO_FULL[hit.label] ?? "（全角标点）"}；中文行文的标点一律全角（整句英文除外）`
		})
	},
	{
		rule: "punct-fullwidth-latin",
		severity: "warn",
		cjkOnly: true,
		scan: (text) => scanFullwidthLatin(text),
		describe: (hit) => ({
			message: `全角标点 ${hit.label} 夹在拉丁字母/数字之间`,
			fix: "英文语境改用半角标点（，→, 。→. ；→; ：→: ？！→?!）；若整句是中文，把标点留在汉字一侧"
		})
	},
	{
		rule: "punct-space-before-cjk-punct",
		severity: "warn",
		cjkOnly: true,
		scan: (text) => scanSpaceBeforeCjkPunct(text),
		describe: (hit) => ({
			message: `汉字与全角标点 ${hit.label} 之间有多余空格`,
			fix: "删掉空格：\"你好 ，世界\" → \"你好，世界\"；全角标点自带字面留白，不需要再加空格"
		})
	},
	{
		rule: "punct-repeated-punct",
		severity: "warn",
		scan: (text) => scanRepeatedPunct(text),
		describe: (hit) => ({
			message: `标点重复连用 ${hit.label}`,
			// 异类连写（，。）保留语气更重的后一个，同类连写（！！）保留一个即可
			fix: `收敛成一个：${hit.label} → ${hit.label.slice(-1)}；强调靠句式和措辞，不靠叠加标点`
		})
	},
	{
		rule: "punct-paren-space",
		severity: "warn",
		cjkOnly: true,
		scan: (text) => scanParenSpace(text),
		describe: () => ({
			message: "全角括号内侧有多余空格",
			fix: "删掉括号内侧空格：\"（ 说明 ）\" → \"（说明）\"；括号紧贴内容，外侧才按中英混排加空格"
		})
	},
	{
		rule: "punct-quote-nesting",
		severity: "warn",
		cjkOnly: true,
		scan: (text) => scanQuoteNesting(text),
		describe: () => ({
			message: "双引号里又开了双引号",
			fix: "外层用 “ ”，内层改用单引号 ‘ ’（他说：“他问‘走吧’”）；嵌套最多两层"
		})
	},
	{
		rule: "punct-dash-spacing",
		severity: "warn",
		cjkOnly: true,
		scan: (text) => scanDashSpacing(text),
		describe: () => ({
			message: "破折号与汉字之间有多余空格",
			fix: "中文破折号 —— 两侧紧贴文字：\"他走了 —— 算了\" → \"他走了——算了\""
		})
	},
	{
		rule: "punct-cjk-latin-space",
		severity: "info",
		scan: (text) => scanCjkLatinSpace(text),
		describe: (hit) => ({
			message: `汉字与拉丁字母紧贴共 ${hit.count} 处`,
			fix: `汉字与拉丁字母之间加一个半角空格（React框架 → React 框架），同段共 ${hit.count} 处；数字紧贴（2026年）不用改`
		})
	},
	{
		rule: "punct-ellipsis-count",
		severity: "info",
		scan: (text) => scanEllipsisCount(text),
		describe: (hit) => ({
			message: `省略号连写了 ${hit.count} 个`,
			fix: `中文省略号固定两个 … 即 ……（${hit.count} 个 → 2 个），多的删掉`
		})
	}
];

/** 12 条规则的 id（接线 / 文档生成用的只读清单，顺序固定）。 */
export const PUNCT_RULE_IDS = Object.freeze(RULES.map((entry) => entry.rule));

/* ------------------------------ 入口 ------------------------------ */

/** 入参归一：对象 { text, where } 与纯字符串都接，空文本/非法项直接跳过。 */
function normalizeSegments(segments) {
	if (!Array.isArray(segments)) return [];
	const list = [];
	for (const item of segments) {
		if (typeof item === "string") {
			if (item !== "") list.push({ text: item, where: "" });
			continue;
		}
		if (item === null || typeof item !== "object") continue;
		const text = typeof item.text === "string" ? item.text : "";
		if (text === "") continue;
		const where = typeof item.where === "string" ? item.where : "";
		list.push({ text, where });
	}
	return list;
}

function severityOf(rule, cjkMode) {
	if (!cjkMode && typeof rule.severityEnglish === "string") return rule.severityEnglish;
	return rule.severity;
}

/**
 * 中文标点 / 排版体检。
 * @param {Array<{text: string, where: string}>} segments 已由 source.js 剥掉代码/注释/标签的文本段
 * @param {{hasCJK?: boolean}} [options] hasCJK === false 表示整份目标没有中文（英文语境）
 * @returns {Array<{severity: "error"|"warn"|"info", rule: string, message: string, fix: string, where?: string}>}
 */
export function auditPunct(segments, options = {}) {
	const settings = options !== null && typeof options === "object" ? options : {};
	const cjkMode = settings.hasCJK !== false;
	const list = normalizeSegments(segments);
	const findings = [];
	for (const rule of RULES) {
		if (rule.cjkOnly === true && !cjkMode) continue;
		const usedPerFile = new Map();
		for (const segment of list) {
			const file = fileKeyOf(segment.where);
			if ((usedPerFile.get(file) ?? 0) >= MAX_PER_RULE_PER_FILE) continue;
			const hits = rule.scan(segment.text, cjkMode);
			if (!Array.isArray(hits) || hits.length === 0) continue;
			for (const hit of orderedHits(hits)) {
				const used = usedPerFile.get(file) ?? 0;
				if (used >= MAX_PER_RULE_PER_FILE) break;
				const { message, fix } = rule.describe(hit, cjkMode);
				findings.push(
					finding({
						severity: severityOf(rule, cjkMode),
						rule: rule.rule,
						message: `${message}（片段「${snippet(segment.text, hit.index, hit.length)}」）`,
						fix,
						...(segment.where === "" ? {} : { where: segment.where })
					})
				);
				usedPerFile.set(file, used + 1);
			}
		}
	}
	return findings;
}
