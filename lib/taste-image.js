/**
 * taste-image.js — 位图的「AI 味」体检。
 *
 * 源码层的 `taste` 只能看写了什么；但用户手里常是**一张图**：
 * 别人发的参考、模型直接出的设计稿、截屏。没有这个能力，「像不像 AI 做的」
 * 就永远只能靠人眼——而人手边最缺的正是判断力。
 *
 * 设计纪律与源码层完全一致：
 *   - 只数**可量的像素事实**，不做「这是 AI 画的」这种归因；
 *   - 只在**成组出现**时提示模板感（单项对称/单项渐变都是正常设计）；
 *   - 宁可漏报：阈值按真实产品校过，成熟界面应当接近 0。
 *
 * PNG 由自带解码器处理；JPEG/WebP 先用本机浏览器转成同尺寸 PNG（见 image-normalize.js），
 * 浏览器不可用时明确报错并给方案，不静默降级。
 */
import { basename } from "node:path";

import { readAsPng } from "./image-normalize.js";

import { decodePng } from "./layouts/png.js";
import { cardGridOf } from "./layouts/image.js";
import { PROFILES, gradeOf } from "./rules.js";

/** 位图层的三条判据（与源码层规则同构：id/scope/weight/fingerprint/fix）。 */
const IMG_RULES = [
	{
		id: "img-indigo-hue",
		fingerprint: true,
		label: "紫蓝相主导",
		scope: "style",
		weight: 12,
		noteLabel: "紫/蓝紫是 AI 出图最强的像素指纹",
		fix: "换成同色相家族或直接去色相：用明度差做层次，别用蓝紫渐变撑高级感"
	},
	{
		id: "img-ramp",
		fingerprint: true,
		label: "大面积平滑渐变",
		scope: "style",
		weight: 8,
		noteLabel: "整片背景是平滑渐变的区域占比",
		fix: "渐变收进单个元素（按钮/卡片），背景用纯色；整片渐变会让画面没有层次落点"
	},
	// 【曾经做过、实测后删掉的一条】中轴对称（居中版式）。
	// 三种量法都被数据否掉：
	//   ① 逐像素比镜像：所有图都 86–91%——纯色背景本来就镜像重合；
	//   ② 只比边缘像素：真实产品全部跌到 0，AI 样本也是 0（字形不镜像）；
	//   ③ 版面占位 / 色彩质量左右平衡：AI 0.982–0.989，而视频站 0.951、安全软件 0.956——
	//      差距只有 0.03，且真实落地页本来就会居中。阈值定哪儿都是择脆的。
	// 对称是**设计选择**，不是 AI 指纹；宁可少一条判据，也不报不可靠的。
];

/**
 * ④ 同构卡片网格 —— **只量，不判**。
 *
 * 复用 layout_check image 已校准的连通域卡片检测（近白面 + 包围盒），
 * 但**不计分**：实测“同一行 3 个等宽卡片”在真实产品里也是常规布局，
 * 我们自己做的苹果风界面（3 个数据卡）就会被判 0.8。分不开就不报。
 *
 * 所以这里只把事实交出去（几张、最多一行几个、是否等宽），
 * 由模型结合色相/渐变等计分判据自行判断。真要判分，需要先有
 * 十人以上的真实产品截图样本来定阈值。
 */
function cardSummary(grid) {
	const cards = grid.cards ?? [];
	if (cards.length === 0) return { count: 0, maxPerRow: 0, equalWidth: false };
	const rows = [];
	for (const card of cards) {
		const row = rows.find((r) => Math.abs(r.y - card.y) <= 8);
		if (row === undefined) rows.push({ y: card.y, cards: [card] });
		else row.cards.push(card);
	}
	const best = rows.sort((a, b) => b.cards.length - a.cards.length)[0];
	const widths = best.cards.map((c) => c.w);
	const ratio = Math.min(...widths) === 0 ? 99 : Math.max(...widths) / Math.min(...widths);
	return { count: cards.length, maxPerRow: best.cards.length, equalWidth: ratio <= 1.15 };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** RGB → HSV（h 0–360，s/v 0–1）。灰色返回 h = -1。 */
function hsv(r, g, b) {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	if (d === 0) return { h: -1, s: 0, v: max / 255 };
	let h;
	if (max === r) h = ((g - b) / d) % 6;
	else if (max === g) h = (b - r) / d + 2;
	else h = (r - g) / d + 4;
	h *= 60;
	if (h < 0) h += 360;
	return { h, s: d / max, v: max / 255 };
}

/** 按面积自适应采样步长：大图不逐像素，避免几千万次循环。 */
function sampleStep(w, h, target = 180) {
	return Math.max(1, Math.floor(Math.sqrt((w * h) / (target * target))));
}

/**
 * ① 紫蓝相主导：只看**有颜色**的像素里，落在 245–300° 的比例。
 * 灰色（s≈0）不参与——一页黑白界面不该因为「没有色彩」被判错方向。
 */
function indigoShare(img, step) {
	let colored = 0;
	let indigo = 0;
	for (let y = 0; y < img.height; y += step) {
		for (let x = 0; x < img.width; x += step) {
			const i = (y * img.width + x) * img.channels;
			if (img.channels === 4 && img.data[i + 3] < 128) continue;
			const { h, s, v } = hsv(img.data[i], img.data[i + 1], img.data[i + 2]);
			if (s < 0.35 || v < 0.15) continue;
			colored += 1;
			// 238–300°：从“深蓝略偏紫”到底紫。实测一个典型 AI 海报的主背景就在 240°
			// （低饱和深蓝紫），旧区间从 245 起把它整张图判成“没有紫蓝”；
			// 下界不再降：210–235° 是真实产品最常用的蓝（某在线文档产品 216°、视频站 195°）。
			if (h >= 238 && h <= 300) indigo += 1;
		}
	}
	return { share: colored === 0 ? 0 : indigo / colored, colored };
}

/**
 * ② 大面积平滑渐变：把图切成 3×3 区域，每个区域看**一维线性渐变**的指纹。
 *
 * 关键：必须同时看两个方向。只看一个方向时，**照片**（安全软件首页的 banner）
 * 每个区域的列均色也是平滑变化的，实测四个区域全部被当成渐变（误报）。
 * 真正的线性渐变有一个方向在平滑变化、正交方向几乎不变（等色带）；
 * 照片两个方向都在变。所以判据是「单方向平滑 + 正交方向平坦」。
 */
function rampRegions(img, step) {
	const R = 3;
	let hit = 0;
	const detail = [];
	// 沿某一轴取 N 个截面的均色
	const means = (x0, x1, y0, y1, axis) => {
		const span = axis === "x" ? x1 - x0 : y1 - y0;
		const n = Math.max(4, Math.min(24, Math.floor(span / Math.max(step, 1))));
		const out = [];
		for (let k = 0; k < n; k += 1) {
			const c = Math.floor((axis === "x" ? x0 : y0) + (span * (k + 0.5)) / n);
			let sr = 0;
			let sg = 0;
			let sb = 0;
			let cnt = 0;
			for (let t = axis === "x" ? y0 : x0; t < (axis === "x" ? y1 : x1); t += step) {
				const px = axis === "x" ? c : t;
				const py = axis === "x" ? t : c;
				const i = (py * img.width + px) * img.channels;
				if (img.channels === 4 && img.data[i + 3] < 128) continue;
				sr += img.data[i];
				sg += img.data[i + 1];
				sb += img.data[i + 2];
				cnt += 1;
			}
			if (cnt > 0) out.push([sr / cnt, sg / cnt, sb / cnt]);
		}
		return out;
	};
	// 一维签名：跳变次数 / 真正在动的步数 / 累计色差
	const signature = (list) => {
		if (list.length < 4) return { big: 99, moving: 0, total: 0 };
		let big = 0;
		let moving = 0;
		for (let k = 1; k < list.length; k += 1) {
			const d =
				(Math.abs(list[k][0] - list[k - 1][0]) + Math.abs(list[k][1] - list[k - 1][1]) + Math.abs(list[k][2] - list[k - 1][2])) / 3;
			if (d > 8) big += 1;
			else if (d >= 0.4) moving += 1;
		}
		const total =
			(Math.abs(list[list.length - 1][0] - list[0][0]) +
				Math.abs(list[list.length - 1][1] - list[0][1]) +
				Math.abs(list[list.length - 1][2] - list[0][2])) /
			3;
		return { big, moving, total };
	};
	// 渐变方向存活条件：没有跳变（≤1）、确实在动（≥2 步）、累计色差够（≥14）
	const smooth = (sig) => sig.big <= 1 && sig.moving >= 2 && sig.total >= 14;

	for (let ry = 0; ry < R; ry += 1) {
		for (let rx = 0; rx < R; rx += 1) {
			const x0 = Math.floor((img.width * rx) / R);
			const x1 = Math.floor((img.width * (rx + 1)) / R);
			const y0 = Math.floor((img.height * ry) / R);
			const y1 = Math.floor((img.height * (ry + 1)) / R);
			const sx = signature(means(x0, x1, y0, y1, "x"));
			const sy = signature(means(x0, x1, y0, y1, "y"));
			// 横向渐变：x 方向平滑变化 + y 方向几乎不变（等色带）
			const horizontal = smooth(sx) && sy.total < 10;
			// 纵向渐变：y 方向平滑变化 + x 方向几乎不变
			const vertical = smooth(sy) && sx.total < 10;
			if (horizontal || vertical) hit += 1;
			detail.push(`${rx},${ry}:x=${Math.round(sx.total)}/${sx.big} y=${Math.round(sy.total)}/${sy.big}`);
		}
	}
	return { hit, detail };
}


/**
 * 位图 AI 味体检。
 * @param {string} target 图片路径（PNG 直读；JPEG / WebP 经浏览器转码）
 * @param {{profile?:string, allow?:string[]}} [opts]
 */
export async function tasteImage(target, opts = {}) {
	// PNG 直读；JPEG / WebP 由 readAsPng 内部转码（与 layout_check image 共用同一入口）。
	const buf = await readAsPng(target, { browserPath: opts.browserPath });
	const img = decodePng(buf);
	const step = sampleStep(img.width, img.height);

	const indigo = indigoShare(img, step);
	const grid = cardSummary(cardGridOf(buf));
	const ramp = rampRegions(img, step);

	// 各判据打分：只在「有足够证据」时才给分
	const indigoScore =
		indigo.colored / Math.max(1, Math.ceil((img.width / step) * (img.height / step))) < 0.03
			? 0
			: indigo.share >= 0.6
				? 1
				: indigo.share >= 0.4
					? 0.6
					: indigo.share >= 0.25
						? 0.3
						: 0;
	const rampScore = ramp.hit >= 5 ? 1 : ramp.hit >= 3 ? 0.7 : ramp.hit >= 2 ? 0.4 : 0;

	const raw = {
		"img-indigo-hue": {
			score: indigoScore,
			note: `有色像素里紫蓝相占 ${Math.round(indigo.share * 100)}%（有色 ${indigo.colored} 个采样点）`
		},
		"img-ramp": { score: rampScore, note: `9 个区域里 ${ramp.hit} 个是平滑渐变` },
	};

	const profileName = PROFILES[opts.profile] === undefined ? "balanced" : opts.profile;
	const factors = PROFILES[profileName];
	const allow = new Set(opts.allow ?? []);

	let weighted = 0;
	let weightSum = 0;
	const metrics = [];
	const actions = [];
	const advisories = [];
	for (const rule of IMG_RULES) {
		const r = raw[rule.id];
		const factor = factors[rule.scope] ?? 1;
		const counted = factor > 0 && allow.has(rule.id) === false;
		if (counted) {
			weighted += r.score * rule.weight * factor;
			weightSum += rule.weight * factor;
		}
		const score = Math.round(r.score * 100);
		metrics.push({
			id: rule.id,
			label: rule.label,
			scope: rule.scope,
			weight: rule.weight,
			counted,
			fingerprint: rule.fingerprint === true,
			score,
			note: r.note
		});
		if (score > 0) {
			const entry = { rule: rule.id, label: rule.label, scope: rule.scope, score, note: r.note, fix: rule.fix };
			if (counted) actions.push(entry);
			else advisories.push(entry);
		}
	}
	const score = weightSum === 0 ? 0 : Math.round((weighted / weightSum) * 100);
	const counted = metrics.filter((m) => m.score > 0 && m.counted);
	const distinctHits = counted.filter((m) => m.fingerprint === true && m.score >= 40).length;
	// 位图只有 2 条判据，不能照搬源码层的 3/5 档：这里 2 条全中就已是“成组”。
	const coOccurrence =
		distinctHits >= 2
			? { level: "pattern", text: "两套视觉默认同时出现（色相 + 渐变）——像素层能拿到的最强组合" }
			: distinctHits === 0
				? { level: "none", text: "" }
				: { level: "scattered", text: `只命中 ${distinctHits} 项（零星），不足以说明风格——先确认是否刻意选择` };

	return {
		kind: "image",
		// 能力边界必须随结果一起交出去：否则“0 分”很容易被误读成“不是 AI 做的”
		scopeNote:
			"位图层只能量两类像素事实：紫蓝色相占比、整片线性渐变。它**量不了**字号体系、间距网格、" +
			"图标成套性、文案套路、交互态——这五项才是 AI 界面与成熟项目的真实差距，0 分不代表这些没问题。",
		// 量不了的维度必须显式列出来，否则模型会把“0 分”当“没问题”归档。
		// 实测（2026-11-08，Flow-Pilot 截图）：像素层 0 分，同一份源码在源码层被报
		// 字号塔缩（1.00×）、间距 38% 不在 4px 网格且出现 13.6/22.4 非整数像素、AI 文案 30 处。
		blindSpots: [
			"字号体系（多少档、最大/正文比）",
			"间距是否在 4px 网格",
			"图标是否同一套（线宽/光学尺寸）",
			"文案套路与口癖",
			"交互态覆盖（hover/focus/disabled）"
		],
		score,
		grade: gradeOf(score),
		profile: profileName,
		profileLabel: PROFILES[profileName].label,
		root: target,
		image: { file: basename(target), width: img.width, height: img.height, sampleStep: step },
		// 原始量值：校准时靠它看阈值定得对不对（模型也靠它解释为什么没报）
		raw: {
			indigoShare: Math.round(indigo.share * 1000) / 1000,
			indigoColored: indigo.colored,
			rampRegions: ramp.hit,
			cardGrid: grid,
		},
		filesScanned: 1,
		truncated: false,
		coOccurrence,
		metrics: metrics.filter((m) => m.score > 0),
		findings: [],
		findingsTotal: 0,
		findingsTruncated: false,
		actions,
		advisories,
		exempted: [...allow]
	};
}
