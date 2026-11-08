/**
 * shadow.js — CSS box-shadow 语法的解析与「阴影图元」。
 *
 * 为什么必须是**图元**而不是风格：高程体系、卡片、浮层、按奥态、浮雕、
 * 玻璃底的柔和投影——全部只靠「偏移 + 模糊 + 颜色」三件事。
 * 拆成一个可组合的参数，用户想做什么深度就做什么深度；
 * 写成 `style: "neumorphic"` 就把用户锁在一种设计里了。
 *
 * 语法完全照 CSS box-shadow（模型对这套语法已经很熟）：
 *   "0 4px 12px rgba(0,0,0,0.25)"
 *   "8px 8px 16px #bebebe, -8px -8px 16px #ffffff"   ← 双光源（微拟物常用）
 *   "inset 0 2px 4px rgba(0,0,0,0.35)"              ← 内阴影（被压入）
 *
 * 实测约束（2026-11-07，resvg）：
 *   - `feDropShadow` **无效**（阴影区完全透明）→ 外层阴影用「模糊的偏移副本」实现；
 *   - `feMorphology`（spread）**无效** → 第 4 个数值目前忽略，并在 notes 里说明。
 */

/** 按顶层逗号切分（忽略 rgba(...) 里的逗号）。 */
function splitTopLevel(input) {
	const out = [];
	let depth = 0;
	let cur = "";
	for (const ch of input) {
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
	return out;
}

/** 单个阴影：`inset? dx dy blur? spread? color`。颜色 = 数值 token 之后的全部。 */
function parseOne(part) {
	const text = part.trim();
	if (text === "") return null;
	const inset = /^inset\b/i.test(text);
	const body = inset ? text.replace(/^inset\b/i, "").trim() : text;
	const tokens = body.split(/\s+/);
	const nums = [];
	let i = 0;
	while (i < tokens.length && nums.length < 4) {
		const m = /^(-?\d*\.?\d+)(px)?$/.exec(tokens[i]);
		if (m === null) break;
		nums.push(Number(m[1]));
		i += 1;
	}
	if (nums.length < 2) return null;
	const color = tokens.slice(i).join(" ").trim();
	return {
		inset,
		dx: nums[0],
		dy: nums[1],
		blur: nums[2] ?? 0,
		spread: nums[3] ?? 0,
		color: color === "" ? "rgba(0,0,0,0.25)" : color
	};
}

/**
 * 解析整串 box-shadow。非法片段跳过（不因一个写法错误就整次渲染失败）。
 * @returns {{list: object[], droppedSpread: boolean}}
 */
export function parseShadows(spec) {
	if (typeof spec !== "string" || spec.trim() === "") return { list: [], droppedSpread: false };
	const list = [];
	let droppedSpread = false;
	for (const part of splitTopLevel(spec)) {
		const one = parseOne(part);
		if (one === null) continue;
		if (one.spread !== 0) droppedSpread = true;
		list.push(one);
	}
	return { list, droppedSpread };
}

/** CSS 的 blur 半径 ≈ 2× Gaussian σ；内部统一用 σ。 */
export const cssBlurToSigma = (blur) => Math.max(0, blur / 2);
