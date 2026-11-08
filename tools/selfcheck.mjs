#!/usr/bin/env node
/**
 * selfcheck.mjs — 在本机的真实项目上跑一遍体检，和基线比对，专门盯**噪声回归**。
 *
 * 为什么需要它：单元测试用的是合成夹具，永远不会出现“注释里的 emoji”“Vue 插值留下的空格”
 * “getElementById 绑定”这类真实项目才有的形态。这一轮清掉的 60 多条假报，全是拿真实项目
 * 跑出来的；但那些项目不在仓库里，不能让 CI 替你盯着——所以放在本地脚本里：
 *
 *   npm run selfcheck            # 和基线比，有新增规则命中就非零退出
 *   npm run selfcheck -- --update  # 有意改了判据，刷新基线
 *   npm run selfcheck -- --verbose # 打印每个项目当前的全部命中
 *
 * 基线文件：.selfcheck-baseline.json（入库，键 = 下面的 id，不要改键）。
 * 语料目录不在时整项跳过——换台机器也能跑，只是没有可比的样本，脚本会明说。
 *
 * == 语料配置（不入库，路径属于本机环境）==
 * 优先读环境变量 VISUALKIT_SELFCHECK_CORPUS 指向的 JSON 文件，其次读仓库根的
 * .selfcheck.local.json（已 gitignore）。两者都没有时只剩 self（本插件）一项。
 * 格式（键 = CORPUS 里的 id；tasteRoot / layoutRoot 都是本机绝对路径）：
 *
 *   {
 *     "corpus": {
 *       "colibri":      { "tasteRoot": "/path/to/project",  "layoutRoot": "/path/to/project" },
 *       "echo":         { "tasteRoot": "/path/to/src",      "layoutRoot": "/path/to/src" },
 *       "flow-pilot":   { "tasteRoot": "/path/to/renderer", "layoutRoot": "/path/to/renderer" },
 *       "legacy-0.5.4": { "tasteRoot": "/path/to/page.html","layoutRoot": "/path/to/page.html" }
 *     },
 *     "legacyBaseline": { "dir": "/path/to/legacy-html",
 *                         "files": { "legacy-0.4": "本机实际文件名.html" } },
 *     "imageCorpus": "/path/to/screenshots"
 *   }
 *
 * 后两个键由 test/legacy-baseline.test.mjs 与 test/taste-image-corpus.test.mjs 复用
 * （它们也接受 VISUALKIT_LEGACY_CORPUS / VISUALKIT_IMAGE_CORPUS 覆盖目录）；
 * files 可省略，省略时按 "<键名>.html" 找文件。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { auditSource } from "../lib/layouts/source.js";
import { taste } from "../lib/taste.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(REPO, ".selfcheck-baseline.json");
const LOCAL_CONFIG = join(REPO, ".selfcheck.local.json");
const args = new Set(process.argv.slice(2));
const UPDATE = args.has("--update");
const VERBOSE = args.has("--verbose");

/** 读本机语料配置：优先 VISUALKIT_SELFCHECK_CORPUS 指向的 JSON，其次仓库根的
 *  .selfcheck.local.json（gitignored）。两处都没有就只剩 self 一项。格式见文件头。 */
function loadCorpusConfig() {
	const fromEnv = process.env.VISUALKIT_SELFCHECK_CORPUS;
	const file = fromEnv ? resolve(REPO, fromEnv) : LOCAL_CONFIG;
	if (existsSync(file) === false) return null;
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		console.error(`selfcheck：语料配置解析失败（${file}）：${error.message}`);
		return null;
	}
}
const LOCAL = loadCorpusConfig();

/** 语料：本机真实项目 + 旧版历史版本（后者是“排版体系未变”的稳定基线）。
 *  路径只来自本机配置——仓库与发布包里不出现任何本机绝对路径。
 *  id 与 .selfcheck-baseline.json 的键一一对应，改 id 就两边一起改。 */
const TARGETS = [
	{ id: "colibri", label: "corpus-a（单页应用）" },
	{ id: "echo", label: "corpus-b（Vue 3 前端）" },
	{ id: "flow-pilot", label: "corpus-c（React renderer）" },
	{ id: "self", label: "dsh-visualkit（本插件）", tasteRoot: join(REPO, "lib"), layoutRoot: REPO },
	{ id: "legacy-0.5.4", label: "legacy 0.5.4（单文件历史版本）" }
];
const CORPUS = TARGETS.map((target) => {
	const local = LOCAL?.corpus?.[target.id];
	return {
		...target,
		tasteRoot: target.tasteRoot ?? local?.tasteRoot,
		layoutRoot: target.layoutRoot ?? local?.layoutRoot
	};
}).filter((target) => typeof target.tasteRoot === "string" && typeof target.layoutRoot === "string");

/** 收集一个目标的「分数 + 每条规则命中次数」。 */
async function sample(target) {
	const t = await taste(target.tasteRoot, {});
	const l = await auditSource(target.layoutRoot);
	const rules = {};
	// 只有 error/warn 算“报警”；info 是参考（比如“有 3 处颜色解析不了，已跳过”）——
	// 它描述的是**覆盖面**而不是缺陷，拿它判回归会让每次新增文件都误报。
	const blocking = {};
	for (const f of l.findings) {
		rules[f.rule] = (rules[f.rule] ?? 0) + 1;
		if (f.severity === "error" || f.severity === "warn") blocking[f.rule] = (blocking[f.rule] ?? 0) + 1;
	}
	const tasteRules = {};
	for (const m of t.metrics) tasteRules[m.id] = m.score;
	return { taste: t.score, tasteGrade: t.grade, layout: l.score, rules, blocking, tasteRules };
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : null;
const next = {};
const problems = [];
const improvements = [];
const notes = [];
let skipped = TARGETS.length - CORPUS.length; // 未配置语料的项目直接不算
let checked = 0;

for (const target of CORPUS) {
	if (existsSync(target.tasteRoot) === false || existsSync(target.layoutRoot) === false) {
		skipped += 1;
		continue;
	}
	checked += 1;
	const now = await sample(target);
	next[target.id] = now;
	const before = baseline?.[target.id];
	if (before === undefined) continue;

	// ① 新增**告警**命中 = 最典型的噪声回归（以前不报的现在报了）。info 级只记一笔。
	const nowBlocking = now.blocking ?? {};
	const beforeBlocking = before.blocking ?? {};
	for (const [rule, count] of Object.entries(nowBlocking)) {
		if ((beforeBlocking[rule] ?? 0) === 0) problems.push(`${target.label}: 新出现 ${rule}×${count}（以前 0）`);
	}
	for (const [rule, count] of Object.entries(now.rules)) {
		if ((nowBlocking[rule] ?? 0) === 0 && (before.rules[rule] ?? 0) === 0) {
			notes.push(`${target.label}: 新增 info 级 ${rule}×${count}（不拦，看一眼即可）`);
		}
	}
	for (const [rule, score] of Object.entries(now.tasteRules)) {
		const prev = before.tasteRules[rule] ?? 0;
		if (prev === 0 && score > 0) problems.push(`${target.label}: AI 味新命中 ${rule}=${score}（以前 0）`);
	}
	// ② 规则消失 = 可能是改好了，也可能是判据被改坏了，都要人看一眼（不算失败）
	for (const [rule, count] of Object.entries(before.rules)) {
		if ((now.rules[rule] ?? 0) === 0) improvements.push(`${target.label}: ${rule} 从 ×${count} 降为 0`);
	}
	for (const [rule, score] of Object.entries(before.tasteRules)) {
		if ((now.tasteRules[rule] ?? 0) === 0) improvements.push(`${target.label}: ${rule} 从 ${score} 降为 0`);
	}
}

if (checked === 0) {
	console.log("selfcheck：本机没有可用语料（这些项目不在当前机器上），跳过。");
	console.log("  配置方式见 tools/selfcheck.mjs 文件头：.selfcheck.local.json 或 VISUALKIT_SELFCHECK_CORPUS。");
	process.exit(0);
}

if (UPDATE) {
	// 只把本次真正跑到的目标写回，其余键原样保留：语料缺失的机器上跑 --update
	// 不会把没跑到的项目从基线里抹掉。
	const merged = { ...(baseline ?? {}), ...next };
	writeFileSync(BASELINE, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
	console.log(`selfcheck：基线已刷新（${checked} 个目标）→ ${BASELINE}`);
	process.exit(0);
}

if (baseline === null) {
	console.log("selfcheck：还没有基线，先跑一次 `npm run selfcheck -- --update`。");
	process.exit(1);
}

console.log(`selfcheck：${checked} 个目标${skipped > 0 ? `（${skipped} 个未配置或目录缺失，跳过）` : ""}\n`);
for (const target of CORPUS) {
	const now = next[target.id];
	if (now === undefined) continue;
	const before = baseline[target.id];
	const delta = before === undefined ? "" : `（AI 味 ${before.taste} → ${now.taste}，排版 ${before.layout} → ${now.layout}）`;
	const hits = Object.entries(now.rules).map(([k, n]) => `${k}×${n}`).join(" ") || "无";
	console.log(`  ${target.label.padEnd(28)} ${String(now.taste).padStart(3)} / ${String(now.layout).padStart(3)} ${delta}`);
	if (VERBOSE) console.log(`      命中：${hits}`);
}

if (notes.length > 0) {
	console.log("\ninfo 级新增（不拦，看一眼即可）：");
	for (const line of notes) console.log(`  · ${line}`);
}

if (improvements.length > 0) {
	console.log("\n判据命中减少（确认是修好了，不是判据被改坏）：");
	for (const line of improvements) console.log(`  · ${line}`);
}

if (problems.length > 0) {
	console.log("\n⚠ 噪声回归：");
	for (const line of problems) console.log(`  · ${line}`);
	console.log("\n要么修判据，要么（确认是真问题后）`npm run selfcheck -- --update` 刷新基线。");
	process.exit(1);
}

console.log("\n✅ 无误报回归：没有出现以前不报、现在报的规则。");
