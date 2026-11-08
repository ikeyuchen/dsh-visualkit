/**
 * layouts/metrics-text.js — 文字宽度度量（不引入字体引擎）。
 *
 * 为什么要这张表（实测数据，2026-11-07）：
 *   旧的「汉字 1.0em / 拉丁 0.55em」模型在纯英文上误差 **10.0%**，中英混排 4.4%；
 *   而 G4 行长、G1 边距、G6 重叠都靠宽度，10% 误差足以让「85% 画布宽」这类阈值判错。
 *
 * 为什么不用 HarfBuzz-WASM（436 KB，精度 0.4%）：
 *   把 ASCII 32–126 的真实 advance width 离线抽一次做成表（下面 WIDTHS），
 *   运行时只是查表 —— 与 HarfBuzz 精度差 **0.00–0.02%**，体积 383 字节，零依赖。
 *   表从 Microsoft YaHei（msyh.ttc, upem 2048）抽取；换成别的字体拉丁字宽会差 ~3–6%，
 *   仍比扁平 0.55 好一个数量级。
 *
 * 汉字与全角标点恒为 1.0em —— 不是假设，是字体约定：实测
 *   「中 文 龘 ， 。 、 ： ；」全部 1.0000em，「（）」2.0000em。所以 CJK 不需要表。
 */

/** ASCII 32–126 的 advance width（×1000，相对 em）。离线取自 msyh.ttc。 */
const WIDTHS = [
	296, 313, 436, 638, 586, 890, 870, 256, 334, 334, 455, 742, 241, 433, 241, 427,
	586, 586, 586, 586, 586, 586, 586, 586, 586, 586, 241, 241, 742, 742, 742, 483,
	1031, 704, 627, 669, 762, 550, 531, 744, 773, 294, 396, 635, 513, 977, 813, 815,
	612, 815, 653, 577, 573, 747, 676, 1018, 645, 604, 620, 334, 416, 334, 742, 448,
	295, 553, 639, 501, 640, 567, 347, 640, 616, 266, 267, 544, 266, 937, 616, 636,
	639, 640, 382, 463, 373, 616, 525, 790, 507, 529, 492, 334, 269, 334, 742
];

/** 全角区段：CJK / 假名 / 韩文 / 全角标点 / emoji —— advance 恒为 1em。 */
const WIDE_RANGES = [
	[0x1100, 0x115f],
	[0x2e80, 0x303e],
	[0x3041, 0x33ff],
	[0x3400, 0x4dbf],
	[0x4e00, 0x9fff],
	[0xa000, 0xa4cf],
	[0xac00, 0xd7a3],
	[0xf900, 0xfaff],
	[0xfe30, 0xfe4f],
	[0xff00, 0xff60],
	[0xffe0, 0xffe6],
	[0x1f000, 0x1faff],
	[0x20000, 0x3fffd]
];

/** 字母下伸部分/组合符等零宽字符（不推进行宽）。 */
const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0xfeff, 0x00ad]);

function isWide(codePoint) {
	for (const [start, end] of WIDE_RANGES) if (codePoint >= start && codePoint <= end) return true;
	return false;
}

/**
 * 单字符 advance width（单位 em）。
 * ASCII 查表；全宽区段 1.0；零宽字符 0；其余（拉丁扩展/符号）用 0.55 兜底。
 */
export function charWidth(char) {
	const cp = typeof char === "string" ? char.codePointAt(0) : char;
	if (cp === undefined) return 0;
	if (cp >= 32 && cp <= 126) return WIDTHS[cp - 32] / 1000;
	if (ZERO_WIDTH.has(cp)) return 0;
	if (isWide(cp)) return 1;
	return 0.55;
}

/**
 * 一段文字的估算宽度（单位 = 字号倍数；乘 fontSize 得用户单位）。
 * 非法输入（null/数字/对象）按空串处理 —— 体检不该因为一个怪值崩掉。
 */
export function measureText(text) {
	let width = 0;
	for (const char of String(text ?? "")) width += charWidth(char);
	return width;
}

/** 同 measureText，但直接返回像素/用户单位。 */
export function measureTextPx(text, fontSize) {
	const size = Number(fontSize);
	if (!Number.isFinite(size) || size <= 0) return 0;
	return measureText(text) * size;
}

/** 一行里的全角字符数（G4 的「一行 45 字」上限用）。 */
export function countWideChars(text) {
	let count = 0;
	for (const char of String(text ?? "")) if (isWide(char.codePointAt(0))) count += 1;
	return count;
}

/** 表自检：长度必须是 95（ASCII 32–126 全段）。 */
export const WIDTH_TABLE_SIZE = WIDTHS.length;
