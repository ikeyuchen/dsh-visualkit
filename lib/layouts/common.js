/**
 * layouts/common.js — 排版体检（layout_check）的共用约定。
 *
 * 三个检测器（source / svg / image）只负责「产出发现项 + 指标」，评分与分级在这里统一：
 *   score 0–100，**越低越好**（0 = 无问题），与 taste_check taste 同口径；
 *   grade：clean <15 / good <35 / messy <60 / bad ≥60。
 * 这样三个模式的分可以比较（同分母），也能在报告里给同一套「修法优先」逻辑。
 */

/** 严重度 → 扣分权重。error 是「已经错了」，warn 是「不专业」，info 是「可优化」。 */
export const WEIGHTS = { error: 15, warn: 6, info: 2 };

export function gradeOf(score) {
	if (score < 15) return "clean";
	if (score < 35) return "good";
	if (score < 60) return "messy";
	return "bad";
}

/**
 * 生成一条发现项（所有字段都可直接进模型上下文）。
 * `patch` 是可选的**可执行修复模板**（目前只有 S1 字号梯级产出）：{css, apply}，
 * 渲染层会把它打印成可直接粘贴的代码块。没有可执行模板的发现项不带这个字段，
 * 以免模型看到空壳。
 * @param {{severity:"error"|"warn"|"info", rule:string, message:string, fix:string, where?:string, patch?:{css:string, apply:string}}} f
 */
export function finding({ severity, rule, message, fix, where, patch }) {
	if (!WEIGHTS[severity]) throw new Error(`未知 severity: ${severity}`);
	if (typeof rule !== "string" || rule === "") throw new Error("finding 缺 rule");
	if (typeof message !== "string" || message === "") throw new Error("finding 缺 message");
	if (typeof fix !== "string" || fix === "") throw new Error("finding 缺 fix");
	return {
		severity,
		rule,
		message,
		fix,
		...(where !== undefined ? { where } : {}),
		...(patch !== undefined ? { patch } : {})
	};
}

/** 所有发现项 → 统一报告（附带计数、分数、分级）。 */
export function finalize({ mode, target, metrics = {}, findings = [], extras = {} }) {
	const clean = findings.filter((f) => f !== undefined && f !== null);
	const score = Math.min(100, clean.reduce((sum, f) => sum + (WEIGHTS[f.severity] ?? 2), 0));
	const counts = { error: 0, warn: 0, info: 0 };
	for (const f of clean) counts[f.severity] += 1;
	return {
		mode,
		target,
		score,
		grade: gradeOf(score),
		counts,
		metrics,
		findings: clean.sort((a, b) => (WEIGHTS[b.severity] ?? 0) - (WEIGHTS[a.severity] ?? 0)),
		...extras
	};
}
