/**
 * audit.js — ui_audit 的实现核心：按项目预设巡检图标规范。
 *
 * echo 预设（规则出处 frontend/STYLE_GUIDE.md §3）：
 *   E1 emoji 禁用：src 下 vue/js/ts/html 文本扫描 pictographic 区段，违例即报
 *   E2 静态图标误用 MorphIcon：<MorphIcon :icon=...> 绑定里没有条件表达式的报 review
 * colibri 预设（规则出处 界面设计规范 §12.5 + js/ui.js）：
 *   C1 ICONS 字典自检：每条 inner 必须能被 parseIconNodes 解析
 *   C2 引用核对：模板 data-morph="x" / JS morphTo(el,'x') / UI.svg('x') /
 *      UI.morphIcon('x') 的字面量引用必须存在于字典
 *   C3 动态引用（变量传名）报 info，提示人工核对
 */
import { open, readFile, readdir, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { parseIconNodes } from "./svg.js";

// 测试/样本目录不参与巡检：硬规则（"图标一律 SVG"）不能因为仓库里放了带 emoji 的
// fixture 就报错——实测把本包自己扫出 55 个 error，全是 test/ 里故意写的样本。
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "vendor", ".uilab-previews", "coverage", "test", "tests", "__tests__", "fixtures", "spec"]);
const PER_FILE_CAP = 2 * 1024 * 1024;
// 审查修复 #278：逐文件串行读盘 → 按批并发读取（各文件相互独立；批内逐文件
// 处理、截断与 break 语义不变——最多多读一小批文件，readCapped 无副作用）
const READ_CHUNK = 16;

/** pictographic emoji + 符号区段（含变体选择符），排除普通箭头/中文标点。
 * codereview #480：区域指示符区段 \u{1F1E6}-\u{1F1FF} 已被 \u{1F000}-\u{1FAFF}
 * 完全覆盖（1F1E6 ≥ 1F000 且 1F1FF ≤ 1FAFF），原并列写出是冗余残留，已删。 */
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

async function walk(root, { maxFiles = 4000, exts, subdirs }) {
	const out = [];
	// 单文件 root：taste_check 的参数描述是「File or directory」，旧实现直接 readdir
	// 一个文件 → ENOTDIR 被 catch 吞掉 → 返回 0 个文件（巡检静默失效）。
	try {
		const info = await stat(root);
		if (info.isFile()) {
			const okExt = exts.some((x) => root.endsWith(x)) && !root.endsWith(".min.js") && !root.endsWith(".map");
			return okExt ? [root] : [];
		}
	} catch {
		return out;
	}
	const queue = [];
	const roots = subdirs ? subdirs.map((d) => join(root, d)) : [root];
	for (const r of roots) if (existsSync(r)) queue.push(r);
	while (queue.length > 0 && out.length < maxFiles) {
		const dir = queue.shift();
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const e of entries) {
			const full = join(dir, e.name);
			if (e.isDirectory()) {
				if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) queue.push(full);
			} else if (e.isFile() && exts.some((x) => e.name.endsWith(x)) && !e.name.endsWith(".min.js") && !e.name.endsWith(".map")) {
				out.push(full);
				if (out.length >= maxFiles) break;
			}
		}
	}
	return out;
}

async function readCapped(file) {
	try {
		const s = await stat(file);
		if (!s.isFile()) return null;
		if (s.size <= PER_FILE_CAP) return await readFile(file, "utf8");
		// 超过上限的文件不能直接跳过：它仍会被算进 filesScanned，跳过等于“报了扫描数却没真扫”。
		// 读前 PER_FILE_CAP 字节继续扫（构建产物/压缩包常是大文件，前面的 emoji 同样违规）。
		const handle = await open(file, "r");
		try {
			const buf = Buffer.alloc(PER_FILE_CAP);
			const { bytesRead } = await handle.read(buf, 0, PER_FILE_CAP, 0);
			return buf.subarray(0, bytesRead).toString("utf8");
		} finally {
			await handle.close();
		}
	} catch {
		return null;
	}
}

function lineOf(text, index) {
	return text.slice(0, index).split("\n").length;
}

/** root 本身就是被扫文件时，relative(root, root) 是空串——报告里会变成 "U1 :1"。
 * 退回文件名，单文件巡检才能看出是哪个文件。 */
function relOf(root, file) {
	const rel = relative(root, file);
	return rel === "" ? basename(root) : rel;
}

async function auditEcho(root, limits) {
	const findings = [];
	// Echo 项目根可能是仓库根（frontend/ 子目录）或前端根（直接含 src/）
	const base = existsSync(join(root, "frontend")) ? join(root, "frontend") : root;
	const files = await walk(base, { maxFiles: limits.maxFiles, exts: [".vue", ".js", ".ts", ".html"], subdirs: ["src"] });
	if (files.length === 0) findings.push({ severity: "warn", rule: "E0", file: relative(root, base) || ".", line: 0, message: "src/ 下没有扫到 vue/js/ts/html 文件——确认 root 是否为 Echo 项目根目录（frontend 之下应含 src/）" });
	for (let i = 0; i < files.length; i += READ_CHUNK) {
		const batch = files.slice(i, i + READ_CHUNK);
		const texts = await Promise.all(batch.map((f) => readCapped(f)));
		for (let k = 0; k < batch.length; k += 1) {
			const text = texts[k];
			if (text === null) continue;
			const rel = relOf(root, batch[k]);
			// E1 emoji 禁用
			for (const m of text.matchAll(new RegExp(EMOJI_RE.source, "gu"))) {
				const idx = m.index ?? 0;
				findings.push({ severity: "error", rule: "E1", file: rel, line: lineOf(text, idx), message: `emoji "${m[0]}" —— STYLE_GUIDE §3 全面禁用（图标全部 SVG）` });
				if (findings.length > limits.maxFindings) break;
			}
			// E2 MorphIcon 静态装载（review 级：绑定是否两态由人判断）
			// 审查修复 #276：标签匹配跳过引号段（绑定表达式含 > 的箭头函数不再
			// 提前截断标签）；:icon 兼容单/双引号；两态判定收紧为成对三元（? … :）
			// ——可选链 a?.b、取反 !x 不再被当作两态条件而漏报
			for (const m of text.matchAll(/<MorphIcon\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gs)) {
				const tag = m[0].replace(/\s+/g, " ");
				const icon = tag.match(/:icon\s*=\s*(["'])((?:(?!\1)[\s\S])*)\1/);
				// 先剔除可选链 `?.` 与空值合并 `??`，再要求“? … :”成对出现：
				// 否则 :icon="props?.icon" 这类静态绑定会被错误当成两态（E2 误报）。
				const iconExpr = icon ? icon[2].replace(/\?\./g, "").replace(/\?\?/g, "") : "";
				if (icon && !/[^?]\?[^?:]*:/.test(iconExpr)) {
					findings.push({ severity: "warn", rule: "E2", file: rel, line: lineOf(text, m.index ?? 0), message: `<MorphIcon :icon="${icon[2]}"> 绑定无两态条件——静态图标不得用 MorphIcon 装载（走 n-icon + vicons）` });
				}
			}
		}
		if (findings.length > limits.maxFindings * 2) break;
	}
	return { preset: "echo", root, filesScanned: files.length, findings };
}

function extractColibriDict(uiJsPath) {
	// 审查修复 #277：readFileSync 兜底——existsSync 与读取之间的竞态、EACCES、
	// EMFILE 不再裸抛出 audit()（与 readCapped/walk 的防御口径一致，失败走 C0 路径）
	let text;
	try {
		text = readFileSync(uiJsPath, "utf8");
	} catch {
		return { dict: null };
	}
	const block = text.match(/const ICONS = \{([\s\S]*?)\n\s*\};/);
	if (block === null) return { dict: null };
	const dict = {};
	// 审查修复 #279：条目值兼容单/双引号（双引号条目原先被静默丢弃，其引用会
	// 成串误报 C2「不在字典」）；键锚定行首（允许缩进）——降低匹配到值内部
	// xxx:'yyy' 片段注入假条目的风险
	const re = /^[ \t]*(\w+)\s*:\s*(["'])((?:\\.|(?!\2)[^\\])*)\2/gm;
	for (const m of block[1].matchAll(re)) dict[m[1]] = m[3];
	return { dict };
}

async function auditColibri(root, limits) {
	const findings = [];
	const uiJsPath = join(root, "js", "ui.js");
	if (!existsSync(uiJsPath)) {
		return { preset: "colibri", root, filesScanned: 0, findings: [{ severity: "error", rule: "C0", file: "js/ui.js", line: 0, message: "js/ui.js 不存在——确认 root 是否为 Colibri 项目根目录" }] };
	}
	const { dict } = extractColibriDict(uiJsPath);
	if (dict === null) {
		return { preset: "colibri", root, filesScanned: 0, findings: [{ severity: "error", rule: "C0", file: "js/ui.js", line: 0, message: "ICONS 字典解析失败（读取失败或结构变化？）" }] };
	}
	// C1 字典自检
	for (const [name, inner] of Object.entries(dict)) {
		if (parseIconNodes(inner) === null) {
			findings.push({ severity: "error", rule: "C1", file: "js/ui.js", line: 0, message: `ICONS.${name} 无法解析为 morphicons IconNode（含 g/transform/未识别标签或为空）——该图标运行时会降级静态换图` });
		}
	}
	// C2/C3 引用核对：html 模板 + js（ui.js 本身只扫 morphTo 字面量以外的实现无关引用，跳过）
	const files = await walk(root, { maxFiles: limits.maxFiles, exts: [".html", ".js"] });
	let scanned = 0;
	for (let i = 0; i < files.length; i += READ_CHUNK) {
		const batch = files.slice(i, i + READ_CHUNK);
		const texts = await Promise.all(batch.map((f) => readCapped(f)));
		for (let k = 0; k < batch.length; k += 1) {
			const file = batch[k];
			const rel = relOf(root, file);
			if (rel === join("js", "ui.js")) continue;
			const text = texts[k];
			if (text === null) continue;
			scanned += 1;
			// 审查修复 #279：data-morph 兼容单/双引号属性；
			// 审查修复 #275：morphTo 首参允许一层嵌套括号（querySelector(...)
			// 形态原先整条静默漏检，C2/C3 两个模式同步修改）
			const patterns = [
				{ re: /data-morph=["'](\w+)["']/g, how: "data-morph" },
				{ re: /\bmorphTo\(\s*[^,()]*(?:\([^()]*\)[^,()]*)*,\s*['"](\w+)['"]/g, how: "morphTo" },
				{ re: /\bsvg\(\s*['"](\w+)['"]/g, how: "UI.svg" },
				{ re: /\bmorphIcon\(\s*['"](\w+)['"]/g, how: "UI.morphIcon" }
			];
			for (const { re, how } of patterns) {
				for (const m of text.matchAll(re)) {
					const name = m[1];
					if (name === "true" || name === "false") continue;
					// 不要用 `name in dict`：dict 是普通对象字面量，'constructor'/'toString'/'__proto__'
					// 这类原型键会误判为“图标存在”，把真实的悬空引用吞掉。
					if (!Object.prototype.hasOwnProperty.call(dict, name)) {
						findings.push({ severity: "error", rule: "C2", file: rel, line: lineOf(text, m.index ?? 0), message: `${how} 引用 "${name}" 不在 ICONS 字典——运行时图标为空（svg）或降级换图（morphTo）` });
					}
				}
			}
			// C3 动态引用提示
			// codereview #479：捕获组 [A-Za-z_$][\w$]* 只可能匹配标识符字符、永不含引号，
			// 原先的 /['"]/.test(m[1]) 守卫恒为 false（死代码，误导读者以为存在引号路径），已删。
			for (const m of text.matchAll(/\bmorphTo\(\s*[^,()]*(?:\([^()]*\)[^,()]*)*,\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
				findings.push({ severity: "info", rule: "C3", file: rel, line: lineOf(text, m.index ?? 0), message: `morphTo 第二参为变量 "${m[1]}"——静态核对不可达，请人工确认取值都在字典内` });
			}
		}
		if (findings.length > limits.maxFindings * 3) break;
	}
	return { preset: "colibri", root, filesScanned: scanned + 1, dictSize: Object.keys(dict).length, findings };
}

function detectPreset(root) {
	if (existsSync(join(root, "frontend", "STYLE_GUIDE.md")) || existsSync(join(root, "STYLE_GUIDE.md"))) return "echo";
	if (existsSync(join(root, "js", "ui.js"))) return "colibri";
	return undefined;
}

/**
 * universal 预设（2026-10-01 新增）：任意项目的 emoji 图标扫描。
 * 背景：AI 开发时习惯性用 emoji 做图标（owner 级禁令：图标一律 SVG）。
 * 规则 U1：代码/模板文件中的 emoji 全部报 error（与 echo 预设同严格度，
 * 扫描面更宽——不限 src/，覆盖首次开发项目的任意目录结构）。
 */
const UNIVERSAL_EXTS = [".vue", ".js", ".mjs", ".ts", ".html", ".htm", ".jsx", ".tsx", ".svelte"];

async function auditUniversal(root, limits) {
	const findings = [];
	const files = await walk(root, { maxFiles: limits.maxFiles, exts: UNIVERSAL_EXTS });
	let emojiTotal = 0;
	for (let i = 0; i < files.length; i += READ_CHUNK) {
		const batch = files.slice(i, i + READ_CHUNK);
		const texts = await Promise.all(batch.map((f) => readCapped(f)));
		for (let k = 0; k < batch.length; k += 1) {
			const text = texts[k];
			if (text === null) continue;
			const rel = relOf(root, batch[k]);
			for (const m of text.matchAll(new RegExp(EMOJI_RE.source, "gu"))) {
				emojiTotal += 1;
				if (findings.length < limits.maxFindings) {
					findings.push({
						severity: "error",
						rule: "U1",
						file: rel,
						line: lineOf(text, m.index ?? 0),
						message: `emoji "${m[0]}" —— 图标一律用 SVG（icon action=find 选型 + action=emit 出码），emoji 做图标全面禁止`
					});
				}
			}
		}
	}
	// 审查修复 #273：预截断使 findings 永不超上限——截断标记改按 emojiTotal 声明，
	// audit() 优先取 runner 给出的标记（否则 universal 分支 truncated 恒为 false）
	return { preset: "universal", root, filesScanned: files.length, emojiTotal, truncated: emojiTotal > limits.maxFindings, findings };
}

/**
 * 巡检入口。preset: 'echo' | 'colibri' | 'universal' | 'auto'（默认）。
 * auto 按标记文件判定 echo/colibri；判定不出（如首次开发的新项目）时
 * 自动落到 universal——emoji 禁令是全局规则，不依赖项目标记。
 */
async function audit(root, preset, limits = {}) {
	const abs = resolve(root);
	const lim = { maxFiles: limits.maxFiles ?? 4000, maxFindings: limits.maxFindings ?? 60 };
	if (!existsSync(abs)) throw new Error(`root 不存在：${abs}`);
	const chosen = preset === "auto" || preset === undefined ? (detectPreset(abs) ?? "universal") : preset;
	const runner = chosen === "echo" ? auditEcho : chosen === "colibri" ? auditColibri : auditUniversal;
	const result = await runner(abs, lim);
	// 审查修复 #274：先截断再统计——counts 与返回的 findings 口径一致
	//（echo/colibri 内部可积累到上限的 2~3 倍才中断，旧写法按未截断全量统计，
	// 会出现 counts.error=119 而返回 findings 只有 60 条的自相矛盾）
	const shown = result.findings.slice(0, lim.maxFindings);
	const counts = { error: 0, warn: 0, info: 0 };
	for (const f of shown) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
	return { ...result, counts, truncated: result.truncated ?? result.findings.length > lim.maxFindings, findings: shown };
}

export { audit, detectPreset };
