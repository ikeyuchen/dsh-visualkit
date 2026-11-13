/**
 * taste.js — ui_taste 工具的实现：扫描前端产物 → 量化「AI 味」→ 给返工指令。
 *
 * 与 ui_audit 的分工：
 *   ui_audit  查「违反项目契约」（emoji 图标禁令、MorphIcon 误用、字典引用），
 *             是硬规则、有明确对错；
 *   ui_taste  查「像不像 AI 默认产物」，是审美诊断、带分数与改进方向。
 * 两者都扫源码，但一个报 error/warn/info，一个报 score + fix。
 *
 * 支持单文件（.html/.css）与目录（自动发现前端文件）。
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { PROFILES, RULES } from "./rules.js";
import { tasteImage } from "./taste-image.js";
import { auditImage } from "./layouts/image.js";
import { readAsPng } from "./image-normalize.js";
import { batchSummary, imagesInDir } from "./image-batch.js";
import { runRules } from "./detect.js";
import { isSkippableDir } from "./skip.js";

/** 项目内的设计意图声明文件名（与扫描同级目录）。 */
const INTENT_FILE = ".design-intent.json";

// 跳过列表与 layout_check 共用一份（lib/skip.js）——两处各写一份的话，
// 修了一边另一边就会漏（实测：taste 曾扫到 test/fixtures 把自己报成 12 条 AI 味）。
/**
 * 参与扫描的前端产物扩展名。
 * 含 .js/.mjs/.ts 是因为 CSS-in-JS 与「样式字符串内联在 JS 里」是主流写法
 * （styled-components / emotion / 插件把 CSS 拼成字符串注入）——不含它们会
 * 把这类项目整体漏掉。代价是纯逻辑文件也会被扫，但除 emoji 外的规则都基于
 * 具体样式声明，没有样式的文件不会命中。
 */
const TASTE_EXTS = [".html", ".htm", ".css", ".vue", ".svelte", ".jsx", ".tsx", ".astro", ".js", ".mjs", ".ts"];
const PER_FILE_CAP = 2 * 1024 * 1024;
/** 默认文件上限：taste 只做统计，不需要扫全仓库。 */
const DEFAULT_MAX_FILES = 600;
/** findings 上限：报告要能读完，热点位置比穷举更有用。 */
const DEFAULT_MAX_FINDINGS = 24;

async function readCapped(file) {
	try {
		const info = await stat(file);
		if (!info.isFile() || info.size > PER_FILE_CAP) return null;
		return await readFile(file, "utf8");
	} catch {
		return null;
	}
}

/** 目录/单文件 → [{path, rel, raw}]；跳过依赖与构建产物目录。 */
async function collect(target, maxFiles) {
	const abs = resolve(target);
	let info;
	try {
		info = await stat(abs);
	} catch {
		throw new Error(`path not found: ${abs}`);
	}
	const files = [];
	if (info.isFile()) {
		const raw = await readCapped(abs);
		if (raw !== null) files.push({ path: abs, rel: abs.split(sep).pop() ?? abs, raw });
		return { files, root: abs, truncated: false };
	}
	const root = abs;
	const queue = [root];
	if (!info.isDirectory()) throw new Error(`not a file or directory: ${abs}`);
	while (queue.length > 0 && files.length < maxFiles) {
		const dir = queue.shift();
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (files.length >= maxFiles) break;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!isSkippableDir(entry.name) && !entry.name.startsWith(".")) queue.push(full);
				continue;
			}
			if (!entry.isFile()) continue;
			if (!TASTE_EXTS.some((ext) => entry.name.endsWith(ext))) continue;
			if (entry.name.endsWith(".min.js") || entry.name.endsWith(".map")) continue;
			const raw = await readCapped(full);
			if (raw !== null) files.push({ path: full, rel: relative(root, full).split(sep).join("/"), raw });
		}
	}
	return { files, root, truncated: files.length >= maxFiles };
}

/**
 * 读取项目内的 .design-intent.json（设计意图声明）。
 * 格式：{ "skin": "playful-geometric", "allow": ["radius-blob"], "reason": "..." }
 * 解析失败不报错——一个坏的声明文件不该让整次体检失败，应当静默忽略并在返回里标明。
 */
async function readIntent(root) {
	const path = join(root, INTENT_FILE);
	let raw;
	try {
		raw = await readFile(path, "utf8");
	} catch {
		return { found: false };
	}
	try {
		const parsed = JSON.parse(raw);
		return {
			found: true,
			skin: typeof parsed?.skin === "string" ? parsed.skin : undefined,
			allow: Array.isArray(parsed?.allow) ? parsed.allow.filter((id) => typeof id === "string") : [],
			reason: typeof parsed?.reason === "string" ? parsed.reason : undefined
		};
	} catch {
		return { found: true, invalid: true, allow: [] };
	}
}

/**
 * 量化一次「AI 味」体检。
 * @param {string} target 目录或单文件（绝对路径优先；相对路径由调用方解析）
 * @param {{maxFiles?:number, maxFindings?:number, ignore?:string[], profile?:string, allow?:string[]}} [opts]
 */
async function taste(target, opts = {}) {
	// 位图入口：用户手里常常只有一张图（别人发的参考 / 模型直接出的稿 / 截屏），
	// 这种情况根本没有源码可扫。同一个问题（像不像 AI）、另一种输入，所以入口同一个。
	// 位图：PNG 直读；JPEG/WebP 由 taste-image 内部转码（需本机浏览器）。
	if (/\.(?:png|jpe?g|webp)$/i.test(String(target))) return await tasteImage(target, opts);
	// 目录里的截图：一批界面一起体检（分数分布 + 离群 + 跨图一致性）。
	// 只在「目录里没有前端源码、却有图」时才走批量——有源码的目录仍按源码扫，
	// 那是这个工具的原有语义，不因为目录里多存了几张截图就改判。
	const batch = await tasteImageBatch(target, opts);
	if (batch !== null) return batch;
	const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
	const maxFindings = opts.maxFindings ?? DEFAULT_MAX_FINDINGS;
	const { files, root, truncated } = await collect(target, maxFiles);
	if (files.length === 0) {
		throw new Error(`未扫到前端文件（${TASTE_EXTS.join(" / ")}）：${root}`);
	}
	// 豁免来源两处：命令行 allow 参数 + 项目内 .design-intent.json 的 allow。
	// 两者取并集——声明是「这个偏离是有意的」，不是「不检测」。
	// 单文件目标：声明文件在它所在目录（旧实现把文件路径当目录 join，单文件模式永远读不到）
	const intentRoot = files.length === 1 && files[0].path === root ? dirname(root) : root;
	const intent = await readIntent(intentRoot);
	const explicitAllow = Array.isArray(opts.allow) ? opts.allow : [];
	const declared = [...new Set([...(intent.allow ?? []), ...explicitAllow])];
	const ignore = [...new Set([...(opts.ignore ?? []), ...declared])];
	const result = runRules(files, { ignore, profile: opts.profile });
	const profileName = result.profile;
	const findings = result.findings.slice(0, maxFindings);
	const byRule = new Map();
	for (const finding of findings) {
		if (!byRule.has(finding.rule)) byRule.set(finding.rule, []);
		byRule.get(finding.rule).push(finding);
	}
	const counted = result.metrics.filter((metric) => metric.score > 0 && metric.counted);
	// **成组出现**才是指纹：单个视觉元素或单个口癖不能证明什么，
	// 但 3 项以上默认选择同时出现，用户就会认定「这是 AI 做的」。
	// （口径来自「AI 味儿图鉴」的核心判断法：数特征组合，而不是数单项严重度。）
	// 只数**风格默认项**（fingerprint）。字号档位、间距网格、交互态覆盖这些是
	// 通用质量缺陷——桌面应用本来就有 6 档小字号、语义色有 7 个，把它们算进
	// 「AI 味组合」会把真实的成熟产品判成模板（实测在线文档参照稿就是这样）。
	// 只数「够分量的」指纹：单个 emoji（20 分）、5 个卡片里 3 种（35 分）这种
	// 属于零星迹象，把它们凑进“3 项组合”会把正常界面也判成模板。
	const distinctHits = counted.filter((metric) => metric.fingerprint === true && metric.score >= 40).length;
	// 措辞只说「风格风险」，不判定作者——单项风格元素证明不了什么，
	// 这一点与「AI 味儿图鉴」的口径一致。
	const coOccurrence =
		distinctHits >= 5
			? { level: "strong", text: `${distinctHits} 组风格默认同时出现——页面会明显显得模板化，建议优先改这一组` }
			: distinctHits >= 3
				? { level: "pattern", text: `${distinctHits} 组风格默认同时出现——单看每项都不致命，组合起来会显得像套模板` }
				: distinctHits === 0
					? { level: "none", text: "" }
					: { level: "scattered", text: `只命中 ${distinctHits} 项（零星），不足以说明风格——先确认是不是刻意选择` };
	return {
		score: result.score,
		grade: result.grade,
		profile: profileName,
		profileLabel: PROFILES[profileName].label,
		root,
		filesScanned: files.length,
		truncated,
		// 只返回「正在失分」的规则，干净的规则不进模型上下文
		coOccurrence,
		metrics: result.metrics.filter((metric) => metric.score > 0),
		findings,
		findingsTotal: result.findings.length,
		findingsTruncated: result.findings.length > maxFindings,
		// 返工清单：只包含「当前档位下计分」的规则；风格层被降为 0 权重的进 advisories
		actions: counted.map((metric) => {
			const rule = RULES.find((item) => item.id === metric.id);
			return {
				rule: metric.id,
				label: metric.label,
				scope: metric.scope,
				score: metric.score,
				weight: metric.weight,
				note: metric.note,
				fix: rule.fix,
				count: byRule.get(metric.id)?.length ?? 0
			};
		}),
		// 风格取向提示：不计分，供有判断力的人/模型自行取舍
		advisories: [...new Set(result.metrics.filter((m) => m.score > 0 && !m.counted).map((m) => m.id))].map((id) => {
			const metric = result.metrics.find((m) => m.id === id);
			const rule = RULES.find((item) => item.id === id);
			return { rule: id, label: metric.label, score: metric.score, note: metric.note, fix: rule.fix };
		}),
		// 不能把 undefined 作为自身属性放进去：宿主会把 undefined 当 INVALID_TOOL_OUTPUT，
		// 而缺 skin/reason（含 JSON 写坏）是很常见的声明形态。
		intent: intent.found
			? {
					found: true,
					invalid: intent.invalid === true,
					...(intent.skin !== undefined ? { skin: intent.skin } : {}),
					allow: declared,
					...(intent.reason !== undefined ? { reason: intent.reason } : {})
				}
			: { found: false, allow: declared },
		exempted: declared
	};
}

/**
 * 目录里是一批截图（且没有前端源码）时：逐图打分 + 跨图一致性。
 *
 * 这一步要回答单张图回答不了的两个问题：**哪张离群**、**是不是同一套视觉**。
 * 逐张 read_image 用眼睛看是审查类会话的真实做法，但人眼记不住第 7 张与第 2 张
 * 的边距/背景差——机械对比正是工具该做的部分。
 *
 * @param {string} target 目录
 * @param {{profile?:string, allow?:string[], browserPath?:string}} [opts]
 * @returns {Promise<null | object>} 不是「纯截图目录」时返回 null（交回源码扫描）
 */
async function tasteImageBatch(target, opts = {}) {
	const listing = await imagesInDir(target);
	if (listing === null) return null;
	let names;
	try {
		names = await readdir(target);
	} catch {
		return null;
	}
	// 有源码就按源码扫：那是这个工具的主语义，不能因为目录里存了截图就改判。
	if (names.some((name) => TASTE_EXTS.some((ext) => name.endsWith(ext)))) return null;

	const entries = [];
	const unreadable = [];
	for (const file of listing.images) {
		// 一张坏图不应该让整批失败：记录下来继续，报告里点名哪张没读出来。
		try {
			const scored = await tasteImage(file, opts);
			// 几何量不是 AI 味判据，但它是「跨页是否同一套视觉」的证据：背景/列栅格/边距。
			const geom = auditImage(await readAsPng(file, { browserPath: opts.browserPath }), { name: basename(file) });
			entries.push({
				name: basename(file),
				score: scored.score,
				grade: scored.grade,
				size: `${scored.image.width}×${scored.image.height}`,
				background: geom.metrics.background,
				cols: geom.metrics.segments.cols,
					// 最严重的一条判据：离群图要能指到「差在哪个维度」，而不是只说「它离群」
				top: scored.metrics.filter((m) => m.score > 0).sort((x, y) => y.score - x.score)[0]?.id ?? "none"
			});
		} catch (error) {
			unreadable.push({ name: basename(file), reason: error instanceof Error ? error.message : String(error) });
		}
	}
	// 一张都读不出来：说明这不是截图目录（可能是伪装成 .png 的文件）。
	// 交回源码扫描，让「未扫到前端文件」这条既有报错说明情况，而不是在这里造新口径。
	if (entries.length === 0) return null;
	return {
		kind: "images",
		root: target,
		...batchSummary(entries, { dir: target, truncated: listing.truncated, total: listing.total }),
		...(unreadable.length === 0 ? {} : { unreadable }),
		// 批量口径的能力边界：位图仍量不了字号/间距网格/图标成套性，
		// 跨图一致性只覆盖「能直接从像素量到」的三项（尺寸/背景/列栅格）。
		scopeNote: "批量仍是位图口径：只量像素事实与构图几何，字号体系/间距网格/图标成套性要看源码（taste_check 传源码目录）",
		blindSpots: ["字号体系", "间距网格", "图标成套性", "文案套路", "交互态覆盖"]
	};
}

export { DEFAULT_MAX_FILES, DEFAULT_MAX_FINDINGS, TASTE_EXTS, taste };
export { tasteImage };
