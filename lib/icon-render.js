/**
 * icon-render.js — 图标视觉语言的**正交维度合成器**。
 *
 * 为什么不靠 style 枚举（旧架构的局限）：
 *   9 个 style 是 9 条写死的配方，彼此互斥（badge 就不能同时是 gradient）。
 *   那是模板，不是工具——用户想要「圆角方容器 + 细描边 + 双色渐变字形 + 平头线端」时，
 *   没有任何一个 style 能表达。
 *
 * 现在把视觉语言拆成 6 个正交维，任意组合：
 *
 *   ① paint      stroke | fill | both      绘法（填充+描边可共存）
 *   ② weight     0–64                      描边粗细
 *   ③ caps       round | butt | square     线端（自动配对 join）
 *   ④ container  none | rounded | circle | squircle
 *                + radius 0–12            容器形状与圆角（连续可调）
 *                + inset 0–0.45           字形在容器里的留白
 *   ⑤ gradient   none | linear | radial
 *                + gradientAngle 0–360    渐变类型与方向
 *   ⑥ duo        none | 0–1                双色底层不透明度（需要填充孪生体）
 *
 * style 仍然保留，但退化为「一组维度值的快捷命名」（预设）。
 * 显式传入的维度参数会逐个覆盖预设——所以总是能调到底。
 */

/** 9 个预设 → 维度值。仅作为默认起点，任何一项都能被显式参数覆盖。 */
export const PRESETS = {
	outline: { paint: "stroke", weight: 2 },
	hairline: { paint: "stroke", weight: 1 },
	bold: { paint: "stroke", weight: 2.8 },
	sharp: { paint: "stroke", weight: 2, caps: "butt" },
	solid: { paint: "fill", needsTwin: true },
	duotone: { paint: "stroke", weight: 2, duo: 0.2, needsTwin: true },
	badge: { paint: "stroke", weight: 1.8, container: "rounded", radius: 7.2, inset: 0.24 },
	knockout: { paint: "stroke", weight: 1.8, container: "circle", inset: 0.24 },
	gradient: { paint: "stroke", weight: 2.2, gradient: "linear", gradientAngle: 45 }
};

/** caps → [linecap, linejoin]。平头线端配斜接转角才不会在转折处出小缺口。 */
export const CAP_TO_JOIN = {
	round: ["round", "round"],
	butt: ["butt", "miter"],
	square: ["square", "miter"]
};

/** 容器型：把字形装进底色里。none 返回 null。 */
export const CONTAINERS = ["none", "rounded", "circle", "squircle"];

export const DIMENSION_LIMITS = {
	weight: [0, 64],
	radius: [0, 12],
	inset: [0, 0.45],
	gradientAngle: [0, 360],
	duo: [0, 1]
};

/**
 * 解析渐变停靠点：`color` 或 `color@offset`（offset 为 0–1，对齐 SVG 的 offset）。
 *
 * 为什么必须是**可扩展的数组而不是内置几种渐变**：
 * 彩虹、多段金属、双色环、条纹…全都只是「停下来描多个颜色」；
 * 内置 `rainbow`/`metal` 这种名字就把用户锁死了。
 *
 * 未写 offset 的停靠点均匀分布（首尾固定 0 与 1）。
 * 颜色只做**注入安全校验**（不允许引号/尖括号），不强制 hex——
 * hex 只在「不传 stops、由 color2 自动推末色」时才必需。
 */
const COLOR_SAFE_RE = /^[#a-zA-Z0-9(),.%\s/+-]+$/;

export function parseGradientStops(spec, fallback = []) {
	if (!Array.isArray(spec) || spec.length === 0) return null;
	const parsed = [];
	for (const raw of spec) {
		if (typeof raw !== "string") return null;
		const text = raw.trim();
		if (text === "") return null;
		const at = text.lastIndexOf("@");
		let color = text;
		let offset = null;
		if (at !== -1) {
			const num = Number(text.slice(at + 1));
			if (!Number.isFinite(num) || num < 0 || num > 1) return null;
			offset = num;
			color = text.slice(0, at).trim();
		}
		if (color === "" || !COLOR_SAFE_RE.test(color)) return null;
		parsed.push({ color, offset });
	}
	if (parsed.length === 1) parsed.push({ color: parsed[0].color, offset: 1 });
	// 未写的 offset 按位置均匀分布；已写的保留（允许渐变锐变）
	const n = parsed.length;
	return parsed.map((stop, i) => ({
		color: stop.color,
		offset: stop.offset !== null ? stop.offset : i === 0 ? 0 : i === n - 1 ? 1 : Math.round((i / (n - 1)) * 1000) / 1000
	}));
}

// 曾经的 SPREADS（spreadMethod: repeat/reflect）已移除：
// 实测 resvg 里它**零效果**——我们的渐变向量总是铺满整个 24 网格盒子，
// 一次循环就覆盖全部，pad/repeat/reflect 的采样值完全相同。
// 条纹用「多停靠点 + 同偏移锐变」实现更精确（可控条纹数与位置）。

/** 把可能越界的数值夹到合法区间；非数字返回 undefined（让调用方回落到预设）。 */
export function clampDim(name, value) {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	const [lo, hi] = DIMENSION_LIMITS[name] ?? [-Infinity, Infinity];
	return Math.min(hi, Math.max(lo, value));
}
