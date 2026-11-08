/**
 * layouts/rules-structure.js — 结构类排版规则（不依赖字体的那些）。
 *
 * 三条规则来自业界实践（2026-11-07 调研）：
 *   heading  标题跳级 h1→h3：layout-lint-mcp 的 audit_typography 有这一项；
 *            文档层级跳跃会让屏幕阅读器与读者都丢失位置感，且直接暴露「没规划结构」。
 *   touch    触摸目标：WCAG 2.2 AA（2.5.8）要求 24×24 CSS px；Apple HIG 44×44；
 *            Material 48×48。三者递进，所以分三档。
 *   baseline 垂直节奏：typography-skills 的 baseline check 把每行文字对照基准网格；
 *            我们用「行 y 对 grid 取模」，比逐字对齐宽松，只抓明显失控。
 *
 * 全部是纯函数：不读文件、不联网、确定性输出。
 */
import { finding } from "./common.js";

/** 每条规则最多报几条：报告要能读完，热点比穷举有用。 */
const PER_RULE_CAP = 3;

function cap(severity, items) {
	return items.slice(0, PER_RULE_CAP).map((item) => finding({ severity, ...item }));
}

/* ------------------------------ 标题层级 ------------------------------ */

/**
 * 标题跳级。只在「相邻两个标题」之间判：跳 >1 级 = error；回退任意级正常
 * （h3 回到 h1 是开新章节，很常见）。
 * @param {Array<{level:number, where:string}>} headings 按文档顺序
 */
export function auditHeadingOrder(headings) {
	const list = Array.isArray(headings) ? headings.filter((h) => Number.isFinite(h?.level) && h.level >= 1 && h.level <= 6) : [];
	if (list.length === 0) return [];
	const out = [];

	// 跳级：h1 → h3 缺 h2
	const skips = [];
	for (let i = 1; i < list.length; i += 1) {
		const prev = list[i - 1];
		const cur = list[i];
		if (cur.level > prev.level + 1) {
			skips.push({
				rule: "structure-heading-skip",
				where: cur.where,
				message: `标题跳级：h${prev.level} 之后直接是 h${cur.level}，中间缺 ${Array.from({ length: cur.level - prev.level - 1 }, (_, k) => `h${prev.level + k + 1}`).join("、")}`,
				fix: `把 h${cur.level} 改成 h${prev.level + 1}，或在中间补 ${Array.from({ length: cur.level - prev.level - 1 }, (_, k) => `h${prev.level + k + 1}`).join("、")} 小标题（层级不能跳，否则大纲与屏幕阅读器都断链）`
			});
		}
	}
	out.push(...cap("error", skips));

	// 首个标题不是 h1
	if (list[0].level !== 1) {
		out.push(
			finding({
				severity: "warn",
				rule: "structure-heading-first",
				where: list[0].where,
				message: `第一个标题是 h${list[0].level} 而不是 h1：页面缺主标题`,
				fix: "把页面主标题改成 h1（每页只有一个），它下面的小节从 h2 开始"
			})
		);
	}

	// 多个 h1
	const h1s = list.filter((h) => h.level === 1);
	if (h1s.length > 1) {
		out.push(
			finding({
				severity: "warn",
				rule: "structure-heading-duplicate-h1",
				where: h1s[1].where,
				message: `出现 ${h1s.length} 个 h1：主标题不唯一`,
				fix: "保留一个 h1 作页面主标题，其余降为 h2（多 h1 会让大纲变平、SEO 与读屏都变差）"
			})
		);
	}

	return out;
}

/* ------------------------------ 触摸目标 ------------------------------ */

/** WCAG 2.2 AA 下限、Apple HIG、Material 推荐值。 */
export const TOUCH_MIN = 24;
export const TOUCH_RECOMMENDED = 44;

/**
 * 触摸目标尺寸。取短边判：宽 200 高 20 的按钮依然点不中。
 * @param {Array<{width:number, height:number, label?:string, where:string}>} targets
 */
export function auditTouchTargets(targets) {
	const list = Array.isArray(targets)
		? targets.filter((t) => Number.isFinite(t?.width) && Number.isFinite(t?.height) && t.width > 0 && t.height > 0)
		: [];
	if (list.length === 0) return [];

	const tooSmall = [];
	const belowRec = [];
	for (const t of list) {
		const short = Math.min(t.width, t.height);
		const name = typeof t.label === "string" && t.label !== "" ? t.label : "交互元素";
		if (short < TOUCH_MIN) {
			tooSmall.push({
				rule: "structure-touch-too-small",
				where: t.where,
				message: `${name} 触摸目标 ${t.width}×${t.height}px，短边 ${short}px < WCAG 2.2 AA 的 ${TOUCH_MIN}px`,
				fix: `把可点区域提到至少 ${TOUCH_MIN}×${TOUCH_MIN}px（推荐 ${TOUCH_RECOMMENDED}×${TOUCH_RECOMMENDED}px）；视觉可以小，用 padding 或伪元素扩大点击区`
			});
		} else if (short < TOUCH_RECOMMENDED) {
			belowRec.push({
				rule: "structure-touch-below-recommended",
				where: t.where,
				message: `${name} 触摸目标 ${t.width}×${t.height}px，短边 ${short}px 刚过 AA 下限但低于 ${TOUCH_RECOMMENDED}px 推荐值`,
				fix: `移动端（Apple HIG）建议 ${TOUCH_RECOMMENDED}×${TOUCH_RECOMMENDED}px；桌面端可忽略这条 warn`
			});
		}
	}

	return [...cap("error", tooSmall), ...cap("warn", belowRec)];
}

/* ------------------------------ 基线网格 ------------------------------ */

/** 默认网格：8px（4px 是更细的间距网格，文字行节奏通常按 8）。 */
export const DEFAULT_BASELINE_GRID = 8;
/** 少于此数量的行不判网格（小样本波动大，极易误报）。 */
export const BASELINE_MIN_LINES = 4;
/** 偏离网格的行占比超过它才报。 */
export const BASELINE_OFFGRID_RATIO = 0.3;
/** 取模偏差容差（px）。 */
const GRID_TOLERANCE = 1;

/**
 * 基线网格。只看行 y，不碰行距（行距是 G3 的事）。
 * @param {Array<{y:number, height?:number, where:string}>} lines
 * @param {{grid?:number}} [options]
 */
export function auditBaselineGrid(lines, options = {}) {
	const grid = Number.isFinite(options.grid) && options.grid > 0 ? options.grid : DEFAULT_BASELINE_GRID;
	const list = Array.isArray(lines) ? lines.filter((l) => Number.isFinite(l?.y)) : [];
	if (list.length < BASELINE_MIN_LINES) return [];

	const offGrid = list.filter((l) => {
		const rem = ((l.y % grid) + grid) % grid;
		return Math.min(rem, grid - rem) > GRID_TOLERANCE;
	});
	const out = [];
	if (offGrid.length / list.length > BASELINE_OFFGRID_RATIO) {
		const worst = offGrid[0];
		const nearest = Math.round(worst.y / grid) * grid;
		out.push(
			finding({
				severity: "warn",
				rule: "structure-baseline-offgrid",
				where: worst.where,
				message: `${offGrid.length}/${list.length} 行文字的基线不在 ${grid}px 网格上（>${Math.round(BASELINE_OFFGRID_RATIO * 100)}%）：垂直节奏失控`,
				fix: `把行的 y 对齐到 ${grid} 的倍数（最近值 ${nearest}）；先固定行高与段间距为 ${grid} 的倍数，再定位`
			})
		);
	}

	// 间距种类过多 → 垂直节奏不统一（info，不扣分重点）
	const gaps = [];
	for (let i = 1; i < list.length; i += 1) {
		const delta = Math.round(list[i].y - list[i - 1].y);
		if (delta > 0) gaps.push(delta);
	}
	const distinct = [...new Set(gaps)];
	if (distinct.length >= 3) {
		out.push(
			finding({
				severity: "info",
				rule: "structure-baseline-inconsistent",
				where: "整版",
				message: `行间距出现 ${distinct.length} 种不同值（${distinct.slice(0, 6).join("/")}）：垂直节奏不统一`,
				fix: `行距收敛到 1–2 个值（正文一个、标题一个），并且都是 ${grid} 的倍数`
			})
		);
	}

	return out;
}
