/**
 * layouts/intent.js — `.design-intent.json` 声明豁免（与 taste_check taste 同一套语义）。
 *
 * 为什么需要：实测（2026-11-07，Flow-Pilot）里 h5/h6 被收敛到正文大小，CSS 里写得
 * 很清楚「h5/h6 没有组件映射，收敛到正文大小，避免浏览器默认 0.83em 把字缩成脚注」——
 * 这是有意的取舍，但体检只能看到「h5 与正文只差 1.13×」并报 error。
 *
 * 声明格式（与 taste 完全一致，一个项目只需一份）：
 *   { "allow": ["S9", "structure-heading-first"], "reason": "h5/h6 未做组件映射" }
 * `allow` 里的规则不计分、不出现在 findings，而是进 `exempted` 并保留原因——
 * 让「有意偏离」可追溯，而不是把规则删掉。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const INTENT_FILE = ".design-intent.json";

function normalize(value) {
	return Array.isArray(value) ? value.filter((id) => typeof id === "string" && id !== "") : [];
}

/**
 * 读声明文件。不存在 / JSON 坏掉都不报错（一个坏声明不该让整次体检失败）。
 * @param {string|null|undefined} rootDir 扫描根目录（单文件时传它所在目录）
 */
export function readIntent(rootDir) {
	if (typeof rootDir !== "string" || rootDir === "") return { found: false, allow: [] };
	let raw;
	try {
		raw = readFileSync(join(rootDir, INTENT_FILE), "utf8");
	} catch {
		return { found: false, allow: [] };
	}
	try {
		const parsed = JSON.parse(raw);
		return {
			found: true,
			allow: normalize(parsed?.allow),
			...(typeof parsed?.skin === "string" ? { skin: parsed.skin } : {}),
			...(typeof parsed?.reason === "string" ? { reason: parsed.reason } : {})
		};
	} catch {
		return { found: true, invalid: true, allow: [] };
	}
}

/**
 * 按 allow 名单过滤 findings。
 * @returns {{kept: object[], exempted: string[], exemptionReason?: string}}
 */
export function applyAllow(findings, intent) {
	const allow = new Set(normalize(intent?.allow));
	if (allow.size === 0) return { kept: findings, exempted: [] };
	const hit = new Set();
	const kept = findings.filter((finding) => {
		if (!allow.has(finding.rule)) return true;
		hit.add(finding.rule);
		return false;
	});
	return {
		kept,
		// 只报真实命中过的（声明了一个不存在的规则不算豁免，就不列）
		exempted: [...hit].sort(),
		...(typeof intent?.reason === "string" ? { exemptionReason: intent.reason } : {})
	};
}
