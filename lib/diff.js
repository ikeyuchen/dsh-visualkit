/**
 * diff.js — 两张图的像素差异：整体差距 + 分区差距 + 热力图。
 *
 * **为什么值得做成工具**：视觉工作最难的不是“改”，而是“改完到底好了没有”。
 * 靠眼睛看只能判断“像不像”，没法回答“这次改动是提升还是回退”。
 * 实测动机：视频站动态页参照实现迭代时，每一轮都要手写一段 node 脚本算差异——
 * 同一个需求写第三遍，就该进工具了。
 *
 * 输出三件东西：
 *   1. 均像素差（0-255）—— 一个数字，能横比多轮迭代；
 *   2. 分区差—— 告诉你差异集中在哪，而不是只能看整图；
 *   3. 热力图 PNG—— 哪里差一眼看到，不用猜。
 */
import { readFileSync } from "node:fs";

import { decodePng } from "./layouts/png.js";
import { renderSvg } from "./render.js";

export async function imageDiff({ base, compare, out, cols, rows, amplify, align }) {

	const a = decodePng(readFileSync(base));
	const b = decodePng(readFileSync(compare));
	if (a.width !== b.width || a.height !== b.height) {
		throw new Error(
			`两张图尺寸不同：${a.width}×${a.height} vs ${b.width}×${b.height}。\n` +
				"比对前先统一尺寸（可用 design_render action=render 的 width，或 composite 把图层放到同尺寸画布）。"
		);
	}

	const W = a.width;
	const H = a.height;
	const NCOL = Number.isFinite(cols) ? Math.min(12, Math.max(1, Math.round(cols))) : 4;
	const NROW = Number.isFinite(rows) ? Math.min(12, Math.max(1, Math.round(rows))) : 1;
	const gain = Number.isFinite(amplify) ? Math.min(4, Math.max(1, amplify)) : 2.0;

	const at = (img, x, y) => {
		const i = (y * img.width + x) * img.channels;
		return [img.data[i], img.data[i + 1], img.data[i + 2]];
	};

	const bS = b;
	const SAMPLE = 2; // 每 2px 采样：2400×1400 的图也只要 ~84 万次，快且足够
	let sum = 0;
	let n = 0;
	let max = 0;
	let changed = 0;
	const cells = Array.from({ length: NCOL * NROW }, () => ({ s: 0, c: 0 }));
	const rects = [];

	for (let y = 0; y < H; y += SAMPLE) {
		for (let x = 0; x < W; x += SAMPLE) {
			const p = at(a, x, y);
			const q = at(b, x, y);
			const d = (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2])) / 3;
			sum += d;
			n += 1;
			if (d > max) max = d;
			if (d > 24) changed += 1;
			const ci = Math.min(NCOL - 1, Math.floor((x / W) * NCOL));
			const ri = Math.min(NROW - 1, Math.floor((y / H) * NROW));
			const cell = cells[ri * NCOL + ci];
			cell.s += d;
			cell.c += 1;
			if (d > 24) {
				const g = Math.min(255, Math.round(d * gain * 1.6));
				rects.push(`<rect x="${x}" y="${y}" width="${SAMPLE}" height="${SAMPLE}" fill="rgb(${g},${Math.round(g * 0.24)},0)" opacity="0.85"/>`);
			}
		}
	}

	// 只保留一位小数：注意不要写成 round1(x)/10——除号会重新引入浮点噪声
	// （实测输出过 13.719999999999999%，把百分比直接四舍五入才干净）
	const round1 = (v) => Math.round(v * 10) / 10;
	const pct = (v) => Math.round(v * 10) / 10;
	const regions = cells.map((cell, i) => ({
		row: Math.floor(i / NCOL),
		col: i % NCOL,
		meanDelta: cell.c === 0 ? 0 : round1(cell.s / cell.c),
		share: cell.c === 0 ? 0 : pct(((cell.s / cell.c) / 255) * 100)
	}));

	const result = {
		width: W,
		height: H,
		meanDelta: round1(sum / n),
		meanPct: pct(((sum / n) / 255) * 100),
		maxDelta: round1(max),
		changedPct: pct((changed / n) * 100),
		cols: NCOL,
		rows: NROW,
		regions
	};

		/* 偏移搜索：重影的元凶往往是“整体平移了几像素”，而不是“哪里排错了”。
	 * 实测：参照稿行距已经对齐到 48 vs 48，但热力图满是重影——文字每行出现两次。
	 * 这不是排错了，是整块内容比原图高/低了几像素。不把这个相位报出来，
	 * “差 13.6%”这个数字就只会让人到处乱改。 */
	if (align === true) {
		const STEP = 8;
		const sampleAt = (img, x, y) => {
			const i = (y * img.width + x) * img.channels;
			return [img.data[i], img.data[i + 1], img.data[i + 2]];
		};
		const cost = (dx, dy) => {
			let acc = 0;
			let cnt = 0;
			for (let y = 0; y < H; y += STEP) {
				const sy = y + dy;
				if (sy < 0 || sy >= H) continue;
				for (let x = 0; x < W; x += STEP) {
					const sx = x + dx;
					if (sx < 0 || sx >= W) continue;
					const p1 = sampleAt(a, x, y);
					const p2 = sampleAt(bS, sx, sy);
					acc += (Math.abs(p1[0] - p2[0]) + Math.abs(p1[1] - p2[1]) + Math.abs(p1[2] - p2[2])) / 3;
					cnt += 1;
				}
			}
			return cnt === 0 ? Infinity : acc / cnt;
		};
		let best = { dx: 0, dy: 0, delta: cost(0, 0) };
		for (let dy = -12; dy <= 12; dy += 2) {
			for (let dx = -6; dx <= 6; dx += 2) {
				if (dx === 0 && dy === 0) continue;
				const d = cost(dx, dy);
				if (d < best.delta) best = { dx, dy, delta: d };
			}
		}
		result.align = {
			bestDx: best.dx,
			bestDy: best.dy,
			deltaAtBest: round1(best.delta),
			deltaAtZero: round1(cost(0, 0)),
			// 提升幅度：越大说明“错位”越是主因
			gainPct: round1(((cost(0, 0) - best.delta) / Math.max(1, cost(0, 0))) * 100)
		};
	}

// 热力图（保留原图轮廓作底，叠差异块）——只有给了 out 才写，没给就只返回数字
	if (typeof out === "string" && out.trim() !== "") {
		const b64 = readFileSync(base).toString("base64");
		const svg =
			`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
			`<image href="data:image/png;base64,${b64}" width="${W}" height="${H}" opacity="0.28"/>` +
			`<rect width="${W}" height="${H}" fill="#05070A" opacity="0.55"/>` +
			rects.join("") +
			`</svg>`;
		const written = await renderSvg({ svg, png: out, width: W });
		result.heatmap = written.path;
		result.heatmapBytes = written.bytes;
	}
	return result;
}
