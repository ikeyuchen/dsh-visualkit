/**
 * detect.js — 「AI 味」检测实现：21 条规则的量化判定。
 *
 * 设计要点：
 * 1. **行号可回溯**：所有匹配都跑在文件原文上（CSS 就嵌在原文里），
 *    命中直接映射 file:line，报告能指到具体位置，不是只给一个分数。
 * 2. **阈值按实测校准**（docs/AI感来源分析与工具箱改造方案-2026-11-07.md）：
 *    典型 AI 输出 72 分、受约束手写 9 分——阈值据此标定，不是拍脑袋。
 * 3. **每条规则独立打分**：0 = 干净，1 = 满分失分。没有命中就没有分数，
 *    避免「没写 CSS 就当 0 分」这类虚假干净。
 */
import { PROFILES, RULES, gradeOf } from "./rules.js";

/** pictographic emoji（与 audit.js 同一区段口径，禁用不是「检测文案」而是「检测图标位」）。 */
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

/** 紫/靛/蓝紫家族的色相区间（HSL 度数）。 */
const PURPLE_HUES = [[245, 295]];

/** 常见中性色（不参与色相统计）。 */
const NEUTRAL_NAMES = new Set(["transparent", "currentcolor", "inherit", "none", "initial", "unset"]);

function lineOf(text, index) {
	let line = 1;
	for (let i = 0; i < index && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1;
	return line;
}

function hit(file, index, evidence) {
	return { file: file.rel, line: lineOf(file.raw, index), evidence: String(evidence).slice(0, 160) };
}

/** #rgb / #rrggbb / rgb() / rgba() → {h,s,l}；无法解析返回 null。 */
function toHsl(raw) {
	const value = String(raw).trim().toLowerCase();
	if (NEUTRAL_NAMES.has(value)) return null;
	let r;
	let g;
	let b;
	if (value.startsWith("#")) {
		let hex = value.slice(1);
		if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
		if (hex.length !== 6) return null;
		r = parseInt(hex.slice(0, 2), 16) / 255;
		g = parseInt(hex.slice(2, 4), 16) / 255;
		b = parseInt(hex.slice(4, 6), 16) / 255;
		if ([r, g, b].some((n) => !Number.isFinite(n))) return null;
	} else {
		const nums = value.match(/[\d.]+/g);
		if (nums === null || nums.length < 3) return null;
		r = Number(nums[0]) / 255;
		g = Number(nums[1]) / 255;
		b = Number(nums[2]) / 255;
	}
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	const d = max - min;
	if (d === 0) return { h: 0, s: 0, l };
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h;
	if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
	else if (max === g) h = ((b - r) / d + 2) / 6;
	else h = ((r - g) / d + 4) / 6;
	return { h: h * 360, s, l };
}

function inHueRanges(hue, ranges) {
	return ranges.some(([lo, hi]) => hue >= lo && hue <= hi);
}

/** 收集文本里所有颜色字面量（含 var() 默认值之外的直接色值）。 */
function colorLiterals(text) {
	const out = [];
	const re = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
	let m;
	while ((m = re.exec(text)) !== null) out.push({ raw: m[0], index: m.index });
	return out;
}

/** 解析 CSS 数值声明，返回 [{value, index, prop}]。 */
function numericDecls(text, props) {
	const out = [];
	const re = new RegExp(`(?:^|[;{\\s])(${props.join("|")})\\s*:\\s*([0-9.]+)(px|rem|em)?`, "g");
	let m;
	while ((m = re.exec(text)) !== null) {
		const unit = m[3] ?? "";
		const value = Number(m[2]) * (unit === "rem" || unit === "em" ? 16 : 1);
		if (Number.isFinite(value)) out.push({ prop: m[1], value, index: m.index });
	}
	return out;
}

// ─────────────────────────── 15 条规则 ───────────────────────────

/**
 * AI 套路文案：箭头 CTA、鸡血动词、黑话。
 *
 * 为什么需要：工具一直在提倡“反 AI 味”，但当时的规则里没有一条查文案。
 * 实测（2026-11-07）：自己做的 7 种风格 UI 里按钮写着“立即同步 →”，
 * 整张表跑下来零发现——工具在提倡规范，却看不见自己身上的问题。
 *
 * 只收高置信度信号（宁可漏报不误报）：
 *   → / ➜ / ↦ 出现在文本里（箭头当 CTA 后缀是典型 AI 病，也是排版噪音）
 *   立即/一键/轻松/极致/无缝/解锁/赋能/助力/闭环/抓手/颗粒度
 *   “XX之旅”、“开启你的…” 这类开场白
 */
const AI_COPY_PATTERNS = [
	{ re: /[→➜↦›]/u, why: "箭头当 CTA 后缀" },
	// 中间允许 0–4 字修饰：“立即免费开始”是最高频的 CTA，旧写法要求“立即”紧跟动词，
	// 实测漏掉了这个写法（2026-11-08，AI 首页样本里出现两次，ai-copy 零命中）。
	{ re: /(立即|一键)[^\n，。,;；]{0,4}(开始|体验|使用|同步|创建|生成|上手|解锁|开启|订阅)/u, why: "鸡血动词搭配" },
	// 对仗句式：AI 文案的隐形指纹。单个出现可能是文风，2 次以上成规则。
	{ re: /不是[^\n，。！？]{2,14}[，,]\s*而是/u, why: "“不是…而是…”对仗句式" },
	{ re: /不仅[^\n，。！？]{2,14}[，,]\s*(更|还|也)/u, why: "“不仅…更…”递进句式" },
	{ re: /不只是[^\n，。！？]{2,12}[，,]\s*(更|而是)/u, why: "“不只是…更是…”递进句式" },
	{ re: /(轻松|极致|无缝|丝滑)(搞定|实现|体验|上手|完成)/u, why: "形容词堆砌" },
	{ re: /(赋能|助力|闭环|抓手|颗粒度|组合拳|护城河)/u, why: "互联网黑话" },
	{ re: /(开启|开始)你的.{0,8}(之旅|新篇章|新可能)/u, why: "开场白套路" }
];

function detectAiCopy(files) {
	const hits = [];
	for (const file of files) {
		// 只看会被渲染的文案：仍是 textSegments 的老口径，但还要排除注释与代码
		const body = stripCommentsForScan(file.raw);
		for (const { re, why } of AI_COPY_PATTERNS) {
			for (const m of body.matchAll(new RegExp(re.source, "gu"))) {
				if (hits.length >= 30) break;
				const start = Math.max(0, (m.index ?? 0) - 12);
				const snippet = body.slice(start, (m.index ?? 0) + m[0].length + 12).replace(/\s+/g, " ").trim();
				hits.push(hit(file, m.index ?? 0, `${why}：“${m[0]}” · …${snippet}…`));
			}
		}
	}
	return { score: Math.min(1, hits.length / 4), hits, note: `AI 套路文案 ${hits.length} 处` };
}

/**
 * 去掉注释（// 与 /* *\/），保留长度以维持行号。
 * 目的：注释里的 emoji 是**说明文字**，不是图标位。
 * 实测（2026-11-07，dsh-visualkit 自查）：lib/detect.js 的注释里举了 `🚀 128K+`
 * 作为「假大数带图标」的例子，结果被自己的 emoji 规则命中——纯自检测误报。
 */
function stripCommentsForScan(text) {
	return text
		// HTML 注释也要剔：`<!-- ⚠️ 模式切换器已移除 -->` 是说明文字，不是界面图标。
		// 实测（2026-11-08，Colibri）：50 个 ⚠ + 7 个 👤 全在注释里，却被算成
		// “emoji 当图标 40 个”（权重 14 的头号指纹），直接把 AI 味分抬到 54。
		// 真正在非注释区的 emoji 只有 11 个，且大多是 ✓ ✗ 这类字符。
		.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "))
		.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
		.replace(/(^|[^:])\/\/[^\n]*/g, (m, head) => head + " ".repeat(m.length - head.length));
}

function detectEmojiIcon(files) {
	const hits = [];
	for (const file of files) {
		// 只看代码/文案本体，不看注释
		const body = stripCommentsForScan(file.raw);
		for (const m of body.matchAll(new RegExp(EMOJI_RE.source, "gu"))) {
			if (hits.length >= 40) break;
			hits.push(hit(file, m.index ?? 0, `emoji "${m[0]}"`));
		}
	}
	return { score: Math.min(1, hits.length / 5), hits, note: `emoji ${hits.length} 个` };
}

function detectPurpleGradient(files) {
	const hits = [];
	for (const file of files) {
		for (const m of file.raw.matchAll(/(?:linear|radial|conic)-gradient\(([^)]*)\)/gi)) {
			const stops = colorLiterals(m[1]);
			const purple = stops.find((stop) => {
				const hsl = toHsl(stop.raw);
				return hsl !== null && hsl.s > 0.2 && inHueRanges(hsl.h, PURPLE_HUES);
			});
			if (purple !== undefined) hits.push(hit(file, m.index ?? 0, m[0]));
		}
		// Tailwind 的 indigo/violet/purple 家族类名同样是这个指纹
		for (const m of file.raw.matchAll(/\b(?:from|to|via|bg|text|border)-(?:indigo|violet|purple|fuchsia)-\d{2,3}\b/g)) {
			hits.push(hit(file, m.index ?? 0, m[0]));
		}
	}
	return { score: Math.min(1, hits.length / 2), hits: hits.slice(0, 20), note: `紫/蓝紫渐变 ${hits.length} 处` };
}

function detectTypeFlat(files) {
	const sizes = [];
	const hits = [];
	for (const file of files) {
		for (const decl of numericDecls(file.raw, ["font-size"])) {
			sizes.push(decl.value);
			hits.push(hit(file, decl.index, `font-size:${decl.value}px`));
		}
		// `font` 简写（`font: 14px/1.6 …`）也要算：只用简写写字号的项目不少，
		// 不解析就会得到「未发现字号声明（跳过）」，与 layout_check 口径不一致。
		for (const m of file.raw.matchAll(/(?:^|[;{\s])font\s*:\s*(\d*\.?\d+)(px|rem|em)/g)) {
			const value = Number(m[1]) * (m[2] === "rem" || m[2] === "em" ? 16 : 1);
			if (Number.isFinite(value) && !sizes.includes(value)) {
				sizes.push(value);
				hits.push(hit(file, m.index ?? 0, `font:${value}px`));
			}
		}
	}
	const uniq = [...new Set(sizes)].sort((a, b) => a - b);
	if (uniq.length === 0) return { score: 0, hits: [], note: "未发现字号声明（跳过）" };
	const ratios = uniq.slice(1).map((value, i) => value / uniq[i]);
	// 层级看的是「最大字号 vs 正文」，**不是相邻两档**。
	// 旧口径（相邻最大比值）有一个系统性错误：一个设计良好的 4 档梯级
	// （比如 12/14/18/24，总梯级 2.0×）相邻步长只有 1.17/1.29/1.33，
	// 必然被判成「无层级」——把好设计报成坏设计。
	// 实测（2026-11-07，dsh-visualkit 自查）：自建的 4 档 24/14=1.71× 被报「1.33× 无层级」。
	// 现与 layout_check S1 统一口径：max / 正文（众数；平票靠 16）。
	const counts = new Map();
	for (const value of sizes) counts.set(value, (counts.get(value) ?? 0) + 1);
	const byKey = [...counts.entries()].sort((a, b) => b[1] - a[1] || Math.abs(a[0] - 16) - Math.abs(b[0] - 16) || a[0] - b[0]);
	const bodySize = byKey[0]?.[0] ?? uniq[0];
	const maxJump = bodySize > 0 ? uniq[uniq.length - 1] / bodySize : 1;
	const tiny = ratios.filter((r) => r > 1 && r < 1.18).length;
	// 没跳变是致命的（0.7），档位过多/碎阶是次要问题（0.3）：
	// 有 1.87× 跳变的页面即使多两档标记字号，层级仍然读得出来。
	const flat = maxJump < 1.6 ? 1 : 0;
	const tooMany = Math.max(0, uniq.length - 5) / 5;
	const noise = Math.max(tooMany, tiny / 6);
	const score = Math.min(1, flat * 0.7 + noise * 0.3);
	return {
		// 字号问题在「整体分布」而非某一根声明，返回空 hits 避免把正"font-size:14px"误列为问题点
		score,
		hits: [],
		note: `字号 ${uniq.length} 档 [${uniq.join(",")}]，正文 ${bodySize}px，最大/正文 ${maxJump.toFixed(2)}×${flat ? "（无层级）" : "（层级成立）"}`
	};
}

function detectRadiusBlob(files) {
	const values = [];
	const hits = [];
	for (const file of files) {
		for (const m of file.raw.matchAll(/border-radius\s*:\s*([^;}]+)/g)) {
			const nums = [...m[1].matchAll(/([0-9.]+)(px|rem)/g)].map((x) => Number(x[1]) * (x[2] === "rem" ? 16 : 1));
			if (nums.length === 0) continue;
			const max = Math.max(...nums);
			values.push(max);
			if (max >= 12) hits.push(hit(file, m.index ?? 0, m[0]));
		}
	}
	if (values.length === 0) return { score: 0, hits: [], note: "未发现圆角（跳过）" };
	const bigRatio = values.filter((v) => v >= 12).length / values.length;
	return {
		score: bigRatio > 0.6 ? Math.min(1, bigRatio) : 0,
		hits: hits.slice(0, 8),
		note: `圆角 ${values.length} 处，≥12px 占 ${Math.round(bigRatio * 100)}%`
	};
}

function detectHueSprawl(files) {
	const buckets = new Map();
	const hits = [];
	for (const file of files) {
		for (const literal of colorLiterals(file.raw)) {
			const hsl = toHsl(literal.raw);
			if (hsl === null || hsl.s < 0.25 || hsl.l < 0.08 || hsl.l > 0.95) continue;
			const bucket = Math.round(hsl.h / 30) * 30;
			if (!buckets.has(bucket)) buckets.set(bucket, hit(file, literal.index, literal.raw));
		}
	}
	const families = buckets.size;
	hits.push(...[...buckets.values()].slice(0, 10));
	// ≤4 家族算正常：1 强调色 + 成/警/危三语义色本身就是四类；
	// >4 说明又额外引入了无关色相，才是「调色盘失控」。
	const score = families <= 4 ? 0 : Math.min(1, (families - 4) / 3);
	return { score, hits, note: `彩色色相家族 ${families} 个（≤4 正常：1 强调 + 3 语义）` };
}

function detectSpacingOffGrid(files) {
	const values = [];
	const hits = [];
	for (const file of files) {
		for (const decl of numericDecls(file.raw, ["margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "gap", "row-gap", "column-gap"])) {
			values.push(decl.value);
			// 2px 是 4px 网格的「半格」，图标与文字对齐、1px 描边补偿都用它——
			// 算离网会让报告被合法的微调值淹没（实测占误报一半）。
			if (decl.value > 0 && decl.value % 4 !== 0 && decl.value !== 2) hits.push(hit(file, decl.index, `${decl.prop}:${decl.value}px`));
		}
	}
	if (values.length === 0) return { score: 0, hits: [], note: "未发现间距声明（跳过）" };
	const off = values.filter((v) => v > 0 && v % 4 !== 0 && v !== 2).length;
	// 按比例而非绝对数：7/32 只是局部手调，13/22 才是系统性偏离网格
	return {
		score: Math.min(1, off / Math.max(4, values.length * 0.6)),
		hits: hits.slice(0, 8),
		note: `间距 ${values.length} 处，${off} 处不在 4px 网格（${Math.round((off / values.length) * 100)}%）`
	};
}

function detectShadowGlow(files) {
	const hits = [];
	for (const file of files) {
		for (const m of file.raw.matchAll(/box-shadow\s*:\s*([^;}]+)/g)) {
			const value = m[1];
			// 无偏移的 0 0 Npx 是发光；彩色投影是第二个指纹
			const glow = /\b0\s+0\s+[1-9]\d*px/.test(value);
			const colored = colorLiterals(value).some((literal) => {
				const hsl = toHsl(literal.raw);
				return hsl !== null && hsl.s > 0.3;
			});
			if (glow || colored) hits.push(hit(file, m.index ?? 0, `box-shadow:${value.trim()}`));
		}
	}
	return { score: Math.min(1, hits.length / 4), hits: hits.slice(0, 8), note: `发光/彩色投影 ${hits.length} 处` };
}

function detectGlassmorphism(files) {
	const hits = [];
	for (const file of files) {
		for (const m of file.raw.matchAll(/backdrop-filter\s*:\s*[^;}]*blur/gi)) hits.push(hit(file, m.index ?? 0, m[0]));
		for (const m of file.raw.matchAll(/\bbackdrop-blur(?:-\w+)?\b/g)) hits.push(hit(file, m.index ?? 0, m[0]));
	}
	return { score: Math.min(1, hits.length / 3), hits: hits.slice(0, 8), note: `毛玻璃 ${hits.length} 处` };
}

function detectGradientText(files) {
	const hits = [];
	for (const file of files) {
		for (const m of file.raw.matchAll(/-webkit-background-clip\s*:\s*text|background-clip\s*:\s*text|\bbg-clip-text\b/gi)) {
			hits.push(hit(file, m.index ?? 0, m[0]));
		}
	}
	return { score: Math.min(1, hits.length / 2), hits: hits.slice(0, 6), note: `渐变文字 ${hits.length} 处` };
}

function detectNoStates(files) {
	const covered = new Set();
	for (const file of files) {
		for (const state of ["hover", "focus", "active", "disabled"]) {
			// 伪类 :state 或 HTML 的 disabled 属性都算“考虑过该状态”
			const pseudo = new RegExp(`:${state}(?:-[a-z]+)?\\b`);
			const attr = state === "disabled" ? /\bdisabled\b/.test(file.raw) : false;
			if (pseudo.test(file.raw) || attr) covered.add(state);
		}
	}
	const count = covered.size;
	// 2 个及以上视为够用（纯静态页只有 hover 也合理），0-1 个才是问题
	return {
		score: count >= 3 ? 0 : count >= 2 ? 0.2 : 0.7,
		hits: [],
		note: `交互态覆盖 ${count}/4（${[...covered].join(",") || "无"}）`
	};
}

function detectFakeStat(files) {
	const hits = [];
	// 真实场景里大数前面常带图标/前缀（`🚀 128K+`、`· 99.9%`），
	// 所以允许数字前有 ≤12 个非标签字符，否则这类最典型的假大数反而漏报。
	for (const file of files) {
		for (const m of file.raw.matchAll(/>\s*[^<]{0,12}(\d{2,}(?:[.,]\d+)?\s*[KkMm]\+|\d{3,}%|99\.9%)\s*</g)) {
			hits.push(hit(file, m.index ?? 0, m[0].replace(/^>\s*/, "").trim()));
		}
		for (const m of file.raw.matchAll(/\b(lorem ipsum|coming soon|敬请期待|待补充)\b/gi)) hits.push(hit(file, m.index ?? 0, m[0]));
	}
	return { score: Math.min(1, hits.length / 3), hits: hits.slice(0, 8), note: `假大数/占位 ${hits.length} 处` };
}

function detectCardUniform(files) {
	const classes = [];
	for (const file of files) {
		for (const m of file.raw.matchAll(/class="([^"]*\b(?:card|tile|item|panel)\b[^"]*)"/gi)) {
			classes.push({ cls: m[1], file, index: m.index ?? 0 });
		}
	}
	if (classes.length < 3) return { score: 0, hits: [], note: `卡片 ${classes.length} 个（≤2 不算网格）` };
	// 同构判据：出现 ≥6 次且类名种类 ≤2 种
	const kinds = new Set(classes.map((c) => c.cls.replace(/\s+/g, " ").trim())).size;
	const uniform = classes.length >= 6 && kinds <= 2;
	return {
		score: uniform ? 0.8 : kinds <= 3 ? 0.35 : 0,
		hits: classes.slice(0, 6).map((c) => hit(c.file, c.index, c.cls)),
		note: `卡片 ${classes.length} 个 / ${kinds} 种${uniform ? "（同构网格）" : ""}`
	};
}

function detectNoBreath(files) {
	const values = [];
	for (const file of files) {
		for (const decl of numericDecls(file.raw, ["padding", "margin"])) values.push(decl.value);
	}
	if (values.length < 3) return { score: 0, hits: [], note: "padding/margin 太少（跳过）" };
	const max = Math.max(...values);
	const bigCount = values.filter((v) => v >= 20).length;
	const smallCount = values.filter((v) => v <= 10).length;
	// 好：页面级大留白（≥20）与控件级小留白（≤10）同时存在
	const layered = bigCount > 0 && smallCount > 0;
	return {
		score: layered ? 0 : max < 20 ? 0.8 : 0.4,
		hits: [],
		note: `留白 ${values.length} 处（大 ${bigCount} / 小 ${smallCount}）${layered ? "，分层明确" : "，缺分层"}`
	};
}

function detectCenteredHero(files) {
	const hits = [];
	let centeredHeading = false;
	let hasCta = false;
	for (const file of files) {
		// 居中必须是**标题级**的：h1/h2，或同一规则里 font-size ≥ 24px。
		// 原来只要页面上出现 text-align:center 就算（页脚、按钮文案都算），
		// 实测把安全软件、邮箱这类正常界面判成“居中 hero”。而且两项是「与」不是「或」——
		// 光有 cta 类名或光有居中都不构成这个指纹。
		for (const m of file.raw.matchAll(/([^{}]{1,80})\{([^}]{0,400})\}/g)) {
			const sel = m[1].trim();
			const body = m[2];
			if (sel === "" || sel.startsWith("@")) continue;
			if (!/text-align\s*:\s*center/i.test(body)) continue;
			const size = /font-size\s*:\s*(\d+(?:\.\d+)?)px/i.exec(body);
			const isHeading = /\bh[12]\b/i.test(sel) || (size !== null && Number(size[1]) >= 24);
			if (!isHeading) continue;
			centeredHeading = true;
			hits.push(hit(file, m.index ?? 0, `${sel} { text-align:center }`));
			break;
		}
		if (/\bclass="[^"]*\b(?:hero|cta|banner)\b/i.test(file.raw)) hasCta = true;
	}
	return {
		score: centeredHeading && hasCta ? 0.7 : 0,
		hits: hits.slice(0, 3),
		note: `标题级居中${centeredHeading ? "有" : "无"} / hero·CTA 容器${hasCta ? "有" : "无"}`
	};
}

function detectNestBoxes(files) {
	const hits = [];
	for (const file of files) {
		if (!/\.(css|html|vue|svelte|astro)$/i.test(file.path ?? "")) continue;
		const boxed = new Set();
		for (const m of file.raw.matchAll(/([^{}]{1,80})\{[^}]*border-radius\s*:/g)) {
			const sel = m[1].trim().replace(/\s+/g, " ");
			if (sel !== "" && !sel.startsWith("@")) boxed.add(sel);
		}
		const isChild = (inner, outer) => inner !== outer && (inner.startsWith(outer + " ") || inner.startsWith(outer + ">"));
		for (const outer of boxed) {
			for (const mid of boxed) {
				if (!isChild(mid, outer)) continue;
				// 只认「三层以上」：框 ▸ 框 ▸ 框。两层是正常的“卡片 + 内部区块”，
				// 算两层会把「卡片里放一个搜索框」这种正常结构判成套娃（实测误报）。
				const third = [...boxed].find((deep) => isChild(deep, mid));
				if (third === undefined) continue;
				hits.push(hit(file, file.raw.indexOf(third), `${outer} ▸ ${mid} ▸ ${third}`));
			}
		}
	}
	const score = hits.length < 3 ? 0 : Math.min(1, hits.length / 6);
	return { score, hits: hits.slice(0, 10), note: `框里套框 ${hits.length} 处` };
}

function detectDividerSprawl(files) {
	const hits = [];
	for (const file of files) {
		if (!/\.(css|html|vue|svelte|astro)$/i.test(file.path ?? "")) continue;
		for (const m of file.raw.matchAll(/border-(?:top|bottom)\s*:\s*1px/gi)) hits.push(hit(file, m.index ?? 0, m[0]));
		for (const m of file.raw.matchAll(/<hr\b/gi)) hits.push(hit(file, m.index ?? 0, "<hr>"));
	}
	// 表格/列表天然要用分割线（实测：邮件列表 7 条、文件表 4 条都是正常设计），
	// 所以 <8 处一律不计分；真正“泛滥”的是每个区块之间都画一条。
	const score = hits.length < 8 ? 0 : Math.min(1, hits.length / 16);
	return { score, hits: hits.slice(0, 12), note: `分割线 ${hits.length} 处` };
}

function detectBigBlackTight(files) {
	const hits = [];
	for (const file of files) {
		if (!/\.(css|html|vue|svelte|astro)$/i.test(file.path ?? "")) continue;
		for (const m of file.raw.matchAll(/([^{}]{1,80})\{([^}]{0,600})\}/g)) {
			const sel = m[1].trim();
			if (sel === "" || sel.startsWith("@")) continue;
			const body = m[2];
			const size = /font-size\s*:\s*(\d+(?:\.\d+)?)px/i.exec(body);
			const weight = /font-weight\s*:\s*(\d{3}|bold)/i.exec(body);
			const lh = /line-height\s*:\s*(\d+(?:\.\d+)?)(?!px)/i.exec(body);
			if (size === null || weight === null || lh === null) continue;
			const px = Number(size[1]);
			const w = weight[1].toLowerCase() === "bold" ? 700 : Number(weight[1]);
			const ratio = Number(lh[1]);
			if (px >= 30 && w >= 700 && ratio <= 1.25) hits.push(hit(file, m.index ?? 0, `${sel} ${px}px / ${w} / lh ${ratio}`));
		}
	}
	return { score: Math.min(1, hits.length / 2), hits: hits.slice(0, 10), note: `又大又黑又挤 ${hits.length} 处` };
}

function detectDeadButton(files) {
	// 【按 id/class 在 JS 里绑定】是最常见的写法（Electron/原生页尤其如此）：
	// `document.getElementById('searchBtn').addEventListener('click', …)`。
	// 只看标签上有没有 data-action/onclick 会把这些全判成“死按钮”——
	// 实测（2026-11-08，Colibri）：报 47 个，实际上每一个都在 js/*.js 里绑了监听。
	// 所以先把「JS 真的绑过的 id / class」收集起来，命中就不算死。
	const boundIds = new Set();
	const boundClasses = new Set();
	for (const file of files) {
		const text = stripCommentsForScan(file.raw);
		for (const m of text.matchAll(/getElementById\(\s*["']([\w-]+)["']/g)) boundIds.add(m[1]);
		for (const m of text.matchAll(/querySelector(?:All)?\(\s*["'`]([^"'`]*)["'`]/g)) {
			for (const id of m[1].matchAll(/#([\w-]+)/g)) boundIds.add(id[1]);
			for (const cls of m[1].matchAll(/\.([\w-]+)/g)) boundClasses.add(cls[1]);
		}
	}
	const isBound = (attrs) => {
		const id = /\bid\s*=\s*["']([\w-]+)["']/i.exec(attrs);
		if (id !== null && boundIds.has(id[1])) return true;
		const cls = /\bclass\s*=\s*["']([^"']*)["']/i.exec(attrs);
		if (cls !== null && cls[1].split(/\s+/).some((c) => c !== "" && boundClasses.has(c))) return true;
		return false;
	};
	const hits = [];
	for (const file of files) {
		if (!/\.(html|vue|svelte|astro|jsx|tsx)$/i.test(file.path ?? "")) continue;
		const body = stripCommentsForScan(file.raw);
		for (const m of body.matchAll(/<button\b([^>]*)>/gi)) {
			const attrs = m[1];
			if (/\btype\s*=\s*["']?submit/i.test(attrs)) continue;
			if (/\bon(?:click|mousedown|pointerdown)\s*=/i.test(attrs)) continue;
			if (/@click|v-on:click|onClick/i.test(attrs)) continue;
			if (/\bdata-(?:action|href|to)\b/i.test(attrs)) continue;
			if (/\bdisabled\b/i.test(attrs)) continue;
			if (isBound(attrs)) continue;
			hits.push(hit(file, m.index ?? 0, `<button${attrs.slice(0, 40)}>`));
		}
	}
	// 单个死按钮可能只是静态演示页；**两个以上**才说明「控件摆出来了、行为没接」是系统性的。
	// （实测：干净样本里恰好有一个 <button>，按 >=1 计分会把整份干净样判成 5 分。）
	const score = hits.length < 2 ? 0 : Math.min(1, hits.length / 3);
	return { score, hits: hits.slice(0, 10), note: `无行为的按钮 ${hits.length} 个` };
}

/**
 * 图标色块一律：每个卡片都套一个同尺寸、同圆角、同背景的图标块。
 *
 * 实测来源（2026-11-08）：写一个当代 AI 首页样本（三特性卡 + 四段小标签 + 对仗文案），
 * 最显眼的 AI 感就是三个 48px 同款渐变圆角块——而当时 19 条规则一条都没抓到，
 * 总分只有 45，和真实产品参照稿（11–24）没拉开到应有的距离。
 *
 * 判据（三项必须同时成立）：
 *   ① HTML 里同类图标块 ≥ 3 个；
 *   ② CSS 里该类的宽高落在 32–64px 且圆角 ≥ 12px（尺寸统一才叫“一律”）；
 *   ③ 背景是渐变。
 * 只满足 ①②（背景是纯色块）给 35：仍然是模板卡片长相，但纯色块在真实产品里也常见，
 * 不足以单独定性。
 * —— 宁可不报，不报错的：三项取交集，才不会把工具栏方块按钮、头像沦为目标。
 */
function detectIconTileUniform(files) {
	const TILE_TOKEN = /(?:^|[-_\s])(?:icon|ico|feature|card)[-_]?(?:tile|box|wrap|badge|circle|square|bubble)(?:$|[-_\s])|(?:^|[-_\s])(?:tile|badge)[-_]?(?:icon|ico)(?:$|[-_\s])/i;
	// ① 用法计数（只看 class 属性，不看注释）
	const usage = [];
	for (const file of files) {
		const body = stripCommentsForScan(file.raw);
		for (const m of body.matchAll(/class="([^"]*)"/gi)) {
			for (const token of m[1].split(/\s+/)) {
				if (token !== "" && TILE_TOKEN.test(token)) usage.push({ token, file, index: (m.index ?? 0) + 6 });
			}
		}
	}
	if (usage.length < 3) return { score: 0, hits: [], note: `图标块 ${usage.length} 个（≤2 不算一律）` };
	// ② 尺寸/圆角/背景：找这些类名的 CSS 规则
	const px = (v) => {
		const m = /(-?\d+(?:\.\d+)?)px/.exec(String(v));
		return m === null ? null : Number.parseFloat(m[1]);
	};
	let sized = 0;
	let gradient = 0;
	for (const file of files) {
		if (/\.(?:css|scss|less|jsx?|tsx?|vue|svelte)$/i.test(file.path ?? file.rel ?? "") === false && /\.html?$/i.test(file.path ?? file.rel ?? "") === false) continue;
		for (const rule of file.raw.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
			// 选择器里的 `.` 必须当分隔符：`.icon-tile` 直接跑正则得不到词边界（`.` 不在 [-_\s] 里），
			// 实测因此把整条规则漏掉，检测器静默永不出手。
			if (TILE_TOKEN.test(rule[1].replace(/\./g, " ")) === false) continue;
			const decls = rule[2];
			const w = /(?:^|[;\s])(?:width|inline-size)\s*:\s*([^;]+)/.exec(decls);
			const h = /(?:^|[;\s])(?:height|block-size)\s*:\s*([^;]+)/.exec(decls);
			const r = /(?:^|[;\s])border-radius\s*:\s*([^;]+)/.exec(decls);
			const wv = w === null ? null : px(w[1]);
			const hv = h === null ? null : px(h[1]);
			const rv = r === null ? null : px(r[1]);
			if (wv === null || hv === null || wv < 32 || wv > 64 || Math.abs(wv - hv) > 2) continue;
			if (rv === null || rv < 12) continue;
			sized += 1;
			if (/(?:linear|radial|conic)-gradient\(/i.test(decls)) gradient += 1;
		}
	}
	const score = gradient > 0 ? 0.8 : sized > 0 ? 0.35 : 0;
	return {
		score,
		hits: score === 0 ? [] : usage.slice(0, 6).map((u) => hit(u.file, u.index, `${u.token}（${gradient > 0 ? "同款渐变块" : "同尺寸块"}）`)),
		note: `图标块 ${usage.length} 个 / 尺寸统一 ${sized} 组${gradient > 0 ? "（含渐变）" : ""}`
	};
}

/**
 * 小标签逐段开场：每个区块都用一个小号大字距标签（eyebrow/kicker）开场。
 *
 * 保留 0–1 个是**正常的编辑手法**（说明栏目归属），不算 AI 味；
 * 四段以上、段段都来一个，才是模板句式。阈值定在 4，就是给正常版面留余地。
 *
 * 已知局限（有意接受）：靠类名识别，若项目用 `.label`/`.tag` 这类通用名会漏报。
 * 宁可漏报：按字号+字距反推需要 DOM，而静态扫描看不到渲染后的样式归属。
 */
const EYEBROW_TOKEN = /(?:^|[-_\s])(?:eyebrow|kicker|overline|suptitle|pretitle|section[-_]?label|label[-_]?caps)(?:$|[-_\s])/i;

function detectEyebrowSpam(files) {
	const hits = [];
	for (const file of files) {
		const body = stripCommentsForScan(file.raw);
		for (const m of body.matchAll(/class="([^"]*)"/gi)) {
			for (const token of m[1].split(/\s+/)) {
				if (token !== "" && EYEBROW_TOKEN.test(token)) hits.push(hit(file, (m.index ?? 0) + 6, token));
			}
		}
	}
	// 0–3 个：正常编辑手法，不报
	const score = hits.length < 4 ? 0 : Math.min(1, (hits.length - 2) / 4);
	return { score, hits: score === 0 ? [] : hits.slice(0, 6), note: `小标签 ${hits.length} 个` };
}

const DETECTORS = {
	"emoji-icon": detectEmojiIcon,
	"purple-gradient": detectPurpleGradient,
	"type-flat": detectTypeFlat,
	"radius-blob": detectRadiusBlob,
	"hue-sprawl": detectHueSprawl,
	"spacing-offgrid": detectSpacingOffGrid,
	"shadow-glow": detectShadowGlow,
	glassmorphism: detectGlassmorphism,
	"gradient-text": detectGradientText,
	"no-states": detectNoStates,
	"fake-stat": detectFakeStat,
	"ai-copy": detectAiCopy,
	"card-uniform": detectCardUniform,
	"no-breath": detectNoBreath,
	"centered-hero": detectCenteredHero,
	"nest-boxes": detectNestBoxes,
	"divider-sprawl": detectDividerSprawl,
	"big-black-tight": detectBigBlackTight,
	"dead-button": detectDeadButton,
	"icon-tile-uniform": detectIconTileUniform,
	"eyebrow-spam": detectEyebrowSpam
};

/**
 * 跑全部规则：返回总分 + 每条规则的得分与命中位置。
 *
 * 分层计分（见 rules.js 的 scope / PROFILES）：
 *   counted    该规则在当前 profile 下参与计分 → 命中走 findings（要改）
 *   not counted 风格层在当前 profile 被降为 0 权重 → 命中走 advisories（提示不改）
 * 这样「structure」档下品牌风格不会被判成缺陷，但它仍然被看见。
 *
 * @param {{path:string, rel:string, raw:string}[]} files
 * @param {{ignore?:string[], profile?:string}} opts
 * @returns {{score:number, grade:string, profile:string, metrics:object[], findings:object[], advisories:object[]}}
 */
function runRules(files, opts = {}) {
	const profileName = PROFILES[opts.profile] === undefined ? "balanced" : opts.profile;
	const factors = PROFILES[profileName];
	const ignore = new Set(opts.ignore ?? []);
	const metrics = [];
	const findings = [];
	const advisories = [];
	let weighted = 0;
	let weightSum = 0;
	for (const rule of RULES) {
		if (ignore.has(rule.id)) continue;
		const result = DETECTORS[rule.id](files);
		const factor = factors[rule.scope] ?? 1;
		const counted = factor > 0;
		metrics.push({
			id: rule.id,
			label: rule.label,
			scope: rule.scope,
			weight: rule.weight,
			counted,
			fingerprint: rule.fingerprint === true,
			score: Math.round(result.score * 100),
			note: result.note
		});
		if (counted) {
			weighted += result.score * rule.weight * factor;
			weightSum += rule.weight * factor;
		}
		if (result.score > 0) {
			const target = counted ? findings : advisories;
			for (const h of result.hits) {
				target.push({ rule: rule.id, label: rule.label, scope: rule.scope, fix: rule.fix, ...h });
			}
			// 统计型规则（字号/交互态/留白）没有具体位置，但也要能在 advisories 里被看到
			if (result.hits.length === 0 && !counted) {
				advisories.push({ rule: rule.id, label: rule.label, scope: rule.scope, fix: rule.fix, note: result.note });
			}
		}
	}
	metrics.sort((a, b) => b.score * b.weight * (b.counted ? 1 : 0) - a.score * a.weight * (a.counted ? 1 : 0));
	const score = weightSum === 0 ? 0 : Math.round((weighted / weightSum) * 100);
	return { score, grade: gradeOf(score), profile: profileName, metrics, findings, advisories };
}

export { runRules, toHsl, lineOf };
