/**
 * image-batch.js — 一批截图一起体检时的公共部分（目录发现 + 跨图一致性汇总）。
 *
 * **为什么需要批量**：真实的 UI 审查不是「一张图」，而是「一轮迭代的十几张截图」
 * （逐页、逐视口、改前改后成对）。单张只能给一个分数，回答不了两个关键问题：
 *   1. 这一批里哪张是离群（这一页没跟上，还是本来就该不一样）？
 *   2. 跨页是不是同一套视觉（尺寸/背景/列栅格/边距）？
 * 客户端记录里的真实做法是逐张 read_image 用眼睛看——人眼记不住第 7 张和第 2 张
 * 的边距差，这正是工具该接管的机械活。
 *
 * 批量语义只由「目录」表达（不新增参数）：常驻 token 预算只剩十几字符，
 * 而目录本来就是这个工具接受的输入形态。
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** 单张截图的批量上限：再多就不是「看一遍」而是「建索引」了。 */
export const MAX_BATCH = 24;

const IMAGE_EXT_RE = /\.(?:png|jpe?g|webp)$/i;

/**
 * 目录里的截图清单（按文件名排序，保证跨次运行结果一致）。
 * @param {string} dir
 * @returns {Promise<null | {dir:string, images:string[], truncated:boolean, total:number}>} 目录里没有截图时返回 null
 */
export async function imagesInDir(dir) {
	let names;
	try {
		names = await readdir(dir);
	} catch {
		return null;
	}
	const images = names.filter((f) => IMAGE_EXT_RE.test(f)).sort();
	if (images.length === 0) return null;
	return {
		dir,
		images: images.slice(0, MAX_BATCH).map((f) => join(dir, f)),
		truncated: images.length > MAX_BATCH,
		total: images.length
	};
}

/** 多数派：返回出现最多的值（并列时取排序最小者，保证确定性）。 */
function majority(values) {
	const counts = new Map();
	for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
	let best = null;
	let bestCount = -1;
	for (const [value, count] of [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
		if (count > bestCount) {
			best = value;
			bestCount = count;
		}
	}
	return { value: best, count: bestCount };
}

/**
 * 把逐图结果汇总成「分数分布 + 离群 + 跨图一致性」。
 *
 * @param {Array<{name:string, score:number, size:string, background:string, cols:number, margins?:object}>} entries
 * @param {{outlierDelta?:number, dir?:string, truncated?:boolean, total?:number}} [opts]
 */
export function batchSummary(entries, opts = {}) {
	const outlierDelta = Number.isFinite(opts.outlierDelta) ? opts.outlierDelta : 15;
	const count = entries.length;
	const avg = Math.round(entries.reduce((sum, e) => sum + e.score, 0) / Math.max(1, count));

	const sorted = [...entries].sort((a, b) => a.score - b.score);
	const best = sorted[0];
	const worst = sorted[sorted.length - 1];

	const outliers = entries
		.map((e) => ({ name: e.name, score: e.score, delta: e.score - avg, ...(e.top !== undefined ? { top: e.top } : {}) }))
		.filter((e) => Math.abs(e.delta) >= outlierDelta)
		.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

	// 跨图一致性：尺寸 / 背景 / 列栅格各自数档；同源度 = 三项都落在多数派的比例。
	const sizeCounts = new Map();
	const bgCounts = new Map();
	const colCounts = new Map();
	for (const e of entries) {
		sizeCounts.set(e.size, (sizeCounts.get(e.size) ?? 0) + 1);
		bgCounts.set(e.background, (bgCounts.get(e.background) ?? 0) + 1);
		colCounts.set(e.cols, (colCounts.get(e.cols) ?? 0) + 1);
	}
	const bgMajor = majority(entries.map((e) => e.background));
	const colMajor = majority(entries.map((e) => e.cols));
	// 同源度只看**背景 + 列栅格**：尺寸天然会因视口/局部截图而不同（同一套界面也会
	// 拍出 1440×900 与 432×1191），把它算进一致性只会制造噪声。
	const same = entries.filter((e) => e.background === bgMajor.value && e.cols === colMajor.value).length;

	const drift = entries
		.filter((e) => e.background !== bgMajor.value || e.cols !== colMajor.value)
		.map((e) => ({
			name: e.name,
			...(e.background !== bgMajor.value ? { background: e.background } : {}),
			...(e.cols !== colMajor.value ? { cols: e.cols } : {})
		}));

	return {
		count,
		...(opts.truncated === true ? { truncated: true, total: opts.total } : {}),
		avg,
		min: { name: best.name, score: best.score },
		max: { name: worst.name, score: worst.score },
		outliers,
		consistency: {
			sizes: [...sizeCounts.entries()]
				.sort((a, b) => b[1] - a[1])
				.map(([size, n]) => ({ size, count: n })),
			backgrounds: [...bgCounts.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 3)
				.map(([color, n]) => ({ color, count: n })),
			columns: [...colCounts.entries()]
				.sort((a, b) => b[1] - a[1])
				.map(([cols, n]) => ({ cols, count: n })),
			sameOriginPct: Math.round((same / Math.max(1, count)) * 100),
			drift
		}
	};
}
