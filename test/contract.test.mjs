// test/contract.test.mjs — 跨工具的「产品契约」：注册 / 参数 / 输出 / 配置 / 数据 / 独立性。
//
// 这个文件回答的不是「某个函数对不对」，而是：
//   - 模型看到的工具表是否稳定且不臃肿（常驻 token 是每请求成本）
//   - 每个 action 的输出是否能被宿主无损序列化（历史 INVALID_TOOL_OUTPUT）
//   - 错了是否给人话（模型靠错误消息自纠）
//   - 发布包里该有的数据是否真的在，且没有退回外部依赖
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	ARTIFACTS,
	CAN_RENDER,
	call,
	rejects,
	saveArtifact,
	tempDir,
	TOOL_NAMES,
	toolRegistry,
	writeTree
} from "./helpers.mjs";

const { apply, Config } = await import("../lib/index.js");
const repo = ARTIFACTS.replace(/[\\/]\.test-out.*$/, "");

/** lib/ 递归文件列表（layouts/ 这类子目录也要在守卫范围内）。 */
const libFiles = (() => {
	const out = [];
	const walk = (dir, prefix = "") => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
			if (entry.isDirectory()) walk(join(dir, entry.name), rel);
			else if (entry.name.endsWith(".js")) out.push(rel);
		}
	};
	walk(join(repo, "lib"));
	return out;
})();

/* ------------------------------ 1. 注册契约 ------------------------------ */

test("注册：恰好 8 个工具，名称与顺序稳定", async () => {
	const { defs } = await toolRegistry();
	assert.deepEqual([...defs.keys()], TOOL_NAMES, "工具名或注册顺序变了 = 模型契约破坏");
	for (const name of TOOL_NAMES) {
		const def = defs.get(name);
		assert.ok(def.description.length >= 40, `${name}: 描述太短，模型不知道用它做什么`);
		assert.ok(def.description.length <= 220, `${name}: 描述超过 220 字符（常驻 token 预算）`);
		assert.equal(def.parameters.type, "object", `${name}: 参数必须是 object`);
		assert.ok(def.output?.render, `${name}: 缺 render（模型只看得到 render 输出）`);
		assert.equal(def.timeoutMs >= 30000 && def.timeoutMs <= 180000, true, `${name}: timeoutMs 不合理`);
	}
});

test("参数契约：每个参数都有类型与说明，枚举非空，required 正确", async () => {
	const { defs } = await toolRegistry();
	for (const [name, def] of defs) {
		const props = def.parameters.properties ?? {};
		assert.ok(Object.keys(props).length >= 3, `${name}: 参数过少（至少 action + 1 个输入）`);
		for (const [key, prop] of Object.entries(props)) {
			assert.ok(typeof prop.type === "string", `${name}.${key}: 缺 type`);
			assert.ok(typeof prop.description === "string" && prop.description.length > 0, `${name}.${key}: 缺说明`);
			assert.ok(prop.description.length <= 80, `${name}.${key}: 说明超 80 字符`);
			if (prop.enum !== undefined) assert.ok(prop.enum.length >= 2, `${name}.${key}: 枚举至少 2 项`);
		}
		const required = def.parameters.required ?? [];
		assert.ok(required.every((key) => props[key] !== undefined), `${name}: required 里有未声明的参数`);
	}
	// 关键必填项：action 是分派器，root/skin 是各自工具的唯一输入
	assert.deepEqual(defs.get("icon").parameters.required, ["action"]);
	assert.deepEqual(defs.get("taste_check").parameters.required, ["action", "root"]);
	assert.deepEqual(defs.get("design_style").parameters.required, ["skin"]);
	assert.deepEqual(defs.get("design_render").parameters.required, ["action"]);
});

test("toolsetProfile：按档位只注册需要的工具，提示段跟着变", async () => {
	const minimal = await toolRegistry({ config: { toolsetProfile: "minimal" } });
	assert.deepEqual([...minimal.defs.keys()], ["icon", "design_render"], "minimal 只装生成+渲染两个");

	// 再紧凑的档位也必须能跑核心循环——否则“省 token”就是省的可用性
	const found = await minimal.defs.get("icon").execute({ action: "find", query: "菜单" }, {});
	assert.ok(found.results.length > 0, "minimal 档位仍应能搜图标");

	const standard = await toolRegistry({ config: { toolsetProfile: "standard" } });
	assert.deepEqual([...standard.defs.keys()], ["icon", "taste_check", "layout_check", "design_render", "html_edit", "css_edit"], "standard 加体检 + 两个改写入口");

	const all = await toolRegistry({ config: { toolsetProfile: "all" } });
	assert.equal(all.defs.size, 8, "all 装全部");

	// 提示段只能提到当前 scope 看得到的工具（否则会指向不存在的东西）
	for (const reg of [minimal, standard, all]) {
		const text = reg.section.text({ scope: {} });
		for (const name of reg.defs.keys()) assert.ok(text.includes(name), `提示段应提到已注册的 ${name}`);
	}
	assert.equal(minimal.section.text({ scope: {} }).includes("layout_check"), false, "minimal 档位提示段不应提 layout_check");
});

test("toolsetProfile：非法值响亮报错，不静默回落", async () => {
	await assert.rejects(
		() => toolRegistry({ config: { toolsetProfile: "tiny" } }),
		/toolsetProfile must be one of/,
		"未知档位必须报错（静默回落会让用户以为工具坏了）"
	);
});

test("常驻预算：默认档 ≤ 3600，全量档 ≤ 4200（每请求都算钱）", async () => {
	// 两个档位分开算：正常会话付的是 standard（默认值），all 是显式开启的加量。
	// 之前只量 all，所以“把工具降档”不能让预算测试变绿——预算要盯**默认开销**。
	const standardBudget = await toolRegistry({ config: { toolsetProfile: "standard" } });
	const allBudget = await toolRegistry({ config: { toolsetProfile: "all" } });
	const budgetOf = ({ defs, section }) => {
		const nestedDescChars = (prop) => {
			const props = prop?.items?.properties;
			if (!props) return 0;
			return Object.values(props).reduce((sum, p) => sum + (p.description ?? "").length, 0);
		};
		let chars = 0;
		for (const def of defs.values()) {
			chars += def.description.length;
			for (const prop of Object.values(def.parameters.properties ?? {})) {
				chars += (prop.description ?? "").length;
				chars += nestedDescChars(prop);
			}
		}
		return chars + section.text({ scope: {} }).length;
	};
	const standardChars = budgetOf(standardBudget);
	const allChars = budgetOf(allBudget);
	assert.ok(standardChars <= 3600, `默认档常驻字符 ${standardChars} 超过 3600（最常付的那份）`);
	assert.ok(allChars <= 4200, `全量档常驻字符 ${allChars} 超过 4200`);
	assert.ok(standardChars >= 1000, `默认档常驻字符 ${standardChars} 过少：工具说明可能丢了关键信息`);
});
test("提示段：覆盖全部工具名、可被 scope 隐藏、无过时命名", async () => {
	const { section } = await toolRegistry();
	const text = section.text({ scope: {} });
	for (const name of TOOL_NAMES) assert.ok(text.includes(name), `提示段没提到 ${name}`);
	for (const anchor of ["1.6", "4px", ".design-intent.json"]) {
		assert.ok(text.includes(anchor), `提示段缺质量底线「${anchor}」：模型会又开始堆 emoji 和 12px 字`);
	}
	assert.equal(section.text({ scope: { hideIcon: true } }), "", "icon 不可见时提示段应为空");
	for (const stale of ["ui_taste", "ui_audit", "design_krita", "design_shot", "design_psd", "design_ping"]) {
		assert.ok(!text.includes(stale), `提示段还在提已删除的工具 ${stale}`);
	}
});

/* ------------------------------ 2. Config ------------------------------ */

test("Config：默认值稳定，非法值拒收", async () => {
	const config = Config({});
	assert.equal(config.findLimit, 12);
	assert.equal(config.maxAuditFiles, 4000);
	assert.equal(config.maxFindings, 60);
	assert.equal(config.previewDir, "");
	assert.deepEqual(config.iconPacks, ["tabler"]);
	assert.throws(() => Config({ findLimit: 0 }), /1|greater|min/i, "findLimit 下限应为 1");
	assert.throws(() => Config({ findLimit: "abc" }), undefined, "findLimit 非数字应收敛拒绝");
	assert.throws(() => Config({ maxAuditFiles: -1 }), undefined, "maxAuditFiles 负数应拒绝");
});

test("Config 生效：findLimit 同时改默认行为与工具描述", async () => {
	const { value } = await call("icon", { action: "find", query: "arrow" }, { config: { findLimit: 3 } });
	assert.ok(value.results.length <= 3, `findLimit=3 时应≤ 3 条，实测 ${value.results.length}`);
	const { defs } = await toolRegistry({ config: { findLimit: 3 } });
	assert.ok(defs.get("icon").parameters.properties.limit.description.includes("3"), "描述里的默认值应随配置变化");
	// 非法图标包只能被静默跳过，不能让整个插件注册失败
	const fallback = await toolRegistry({ config: { iconPacks: ["no-such-pack"] } });
	assert.deepEqual([...fallback.defs.keys()], TOOL_NAMES);
});

/* --------------------------- 3. 数据完整性 --------------------------- */

test("数据：图标库 / tabler 包 / 素材清单 / vendor 都在且自洽", async () => {
	const lucide = JSON.parse(readFileSync(join(repo, "data", "lucide-icons.json"), "utf8"));
	const icons = Object.values(lucide.icons);
	assert.equal(icons.length, 2029, "lucide 图标数变了：同步 selftest 数字与 README");
	for (const icon of icons) {
		assert.ok(Array.isArray(icon.node) && icon.node.length > 0, "图标缺 node（应为 [tag, attrs] 元组数组）");
		assert.ok(Array.isArray(icon.tags) && icon.tags.length > 0, "图标缺官方 tags");
		assert.ok(Array.isArray(icon.categories) && icon.categories.length > 0, "图标缺分类");
	}
	const tabler = JSON.parse(readFileSync(join(repo, "data", "packs", "tabler.icons.json"), "utf8"));
	assert.equal(Object.keys(tabler.icons).length, 6302, "tabler 图标数变了");
	const manifest = JSON.parse(readFileSync(join(repo, "data", "assets", "manifest.json"), "utf8"));
	assert.equal(manifest.items.length, 221, "素材数变了：同步 README 与 check-pack");
	const missing = manifest.items.filter((item) => !existsSync(join(repo, "data", "assets", item.file)));
	assert.deepEqual(missing.map((m) => m.file), [], "manifest 引用了不存在的素材文件");
	const noLicense = manifest.items.filter((item) => !item.license || !item.category);
	assert.deepEqual(noLicense.map((m) => m.file), [], "素材缺 license/category（合规要求）");
	for (const file of ["vendor/morphicons.iife.js", "vendor/morphicons-adapters.iife.js", "vendor/resvg/index.js", "vendor/resvg/js-binding.js"]) {
		assert.ok(existsSync(join(repo, file)), `缺 ${file}`);
	}
	assert.ok(readdirSync(join(repo, "vendor", "resvg")).some((f) => f.endsWith(".node")), "resvg 原生绑定缺失");
});

test("包元数据：零运行时依赖 / peer 范围 / files 覆盖运行时文件", async () => {
	const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
	assert.deepEqual(pkg.dependencies ?? {}, {}, "不允许出现运行时依赖（resvg 必须 vendored）");
	assert.ok(pkg.peerDependencies["@deepseek-ai/dsh-tools"].includes("0.2"), "dsh-tools peer 范围缺失");
	assert.equal(pkg.dsh?.manifestVersion, 1);
	assert.deepEqual(pkg.os, ["win32"], "vendored 绑定只有 win32-x64，os 必须如实声明");
	assert.deepEqual(pkg.cpu, ["x64"]);
	for (const entry of ["lib/", "data/", "vendor/", "locale/*.json", "cordis.patch.yml"]) {
		assert.ok(pkg.files.includes(entry), `files 缺 ${entry}：发布后会装不上`);
	}
	assert.ok(!pkg.files.some((f) => f.startsWith("test/") || f.startsWith("scripts/")), "测试/脚本不应进发布包");
	assert.equal(pkg.publishConfig.access, "public");
	for (const field of ["name", "version", "description", "license", "repository", "homepage", "bugs"]) {
		assert.ok(pkg[field] !== undefined, `package.json 缺 ${field}`);
	}
	assert.equal(pkg.engines.node, ">=22.19.0", "engines.node 变了：确认 node:test 用法仍兼容");
});

// 版本号三处一致：发布时漂移是最容易漏又最难看的一类
// （package.json 改了、lock 没跟上；或 CHANGELOG 忘了落段落）。
test("版本：package.json / lock / CHANGELOG 三处一致，且是 x.y.z", async () => {
	const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
	const lock = JSON.parse(readFileSync(join(repo, "package-lock.json"), "utf8"));
	assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "版本号必须是 x.y.z");
	assert.equal(lock.version, pkg.version, "package-lock 顶层版本应与 package.json 一致");
	assert.equal(lock.packages?.[""]?.version, pkg.version, "lock 内包版本应与 package.json 一致");
	const changelog = readFileSync(join(repo, "CHANGELOG.md"), "utf8");
	assert.ok(changelog.includes(`## [${pkg.version}]`), `CHANGELOG 缺 ## [${pkg.version}] 段落`);
});

test("locale：中英文案成对，标题稳定", async () => {
	const zh = JSON.parse(readFileSync(join(repo, "locale", "zh.json"), "utf8"));
	const en = JSON.parse(readFileSync(join(repo, "locale", "en.json"), "utf8"));
	assert.equal(zh.meta.title, "视觉设计工具箱");
	assert.equal(en.meta.title, "Visual Design Toolkit");
	assert.ok(zh.meta.description.length > 40 && en.meta.description.length > 40);
	// 口径已从「零外部进程」改为「核心自包含，HTML→PNG 可选浏览器」（见 docs/ARCHITECTURE.md）。
	// 介绍必须把这条边界说清楚，不能笼统声称完全零依赖。
	assert.match(zh.meta.description, /离线|自包含/, "介绍应说明核心能力离线自包含");
	assert.match(zh.meta.description, /浏览器/, "介绍必须写明 HTML→PNG 需要本机浏览器");
	assert.match(en.meta.description, /offline/i, "英文介绍同样要说清楚边界");
});

/* --------------------------- 4. 独立性守卫 --------------------------- */

/** 剥掉注释再扫：注释里「不依赖 Python」是说明，不是依赖。 */
function stripComments(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split("\n")
		.filter((line) => !line.trim().startsWith("//"))
		.join("\n");
}

test("独立性：外部程序只允许「不装也能用」的可选能力，且必须显式声明", async () => {
	// 口径演变（有意为之，记录原因）：
	//   早期：lib/ 里一律不允许 child_process —— 因为当时的渲染完全靠 vendored resvg，
	//   加外部进程只会让插件在别人机器上碎掉。
	//   现在：**HTML → PNG 必须用真实浏览器引擎**。自写布局引擎去“验证”用户界面布局，
	//   等于用可能错的尺子量东西——渲染得对也可能与真实浏览器不一致，结论不可信。
	//   所以规则改成：
	//     ① 只有白名单文件可以碰子进程（目前只有 render-html.js）；
	//     ② 子进程只能用于“调用本机浏览器”，不得引入 Python / Krita / Playwright / PSD；
	//     ③ 找不到浏览器时必须显式报错（下面单独验），不得静默假渲染。
	const ALLOWED_SPAWN = new Set(["render-html.js"]);
	const forbidden = [
		{ pattern: /python|py\s+-3/i, why: "Python" },
		{ pattern: /\bkrita\b/i, why: "Krita" },
		{ pattern: /\bplaywright\b/i, why: "Playwright" },
		{ pattern: /psd_tools|\bpsd\.js\b/i, why: "PSD" },
		{ pattern: /(?:[A-Za-z]:[\\/]{1,2}(?:AI|Users)[\\/])/, why: "本机绝对路径" }
	];
	const spawnish = [
		{ pattern: /\bchild_process\b/, why: "child_process" },
		{ pattern: /\bspawnSync?\s*\(/, why: "spawn" }
	];
	const violations = [];
	for (const file of libFiles) {
		const text = stripComments(readFileSync(join(repo, "lib", file), "utf8"));
		for (const rule of forbidden) if (rule.pattern.test(text)) violations.push(`${file} → ${rule.why}`);
		if (!ALLOWED_SPAWN.has(file)) {
			for (const rule of spawnish) if (rule.pattern.test(text)) violations.push(`${file} → ${rule.why}（白名单外）`);
		}
	}
	assert.deepEqual(violations, [], "独立性被破坏：只允许 render-html.js 调浏览器，不得引入其他外部程序");

	// ② 白名单文件必须存在，否则白名单就是空头支票
	assert.ok(libFiles.includes("render-html.js"), "render-html.js 应当存在（HTML 渲染能力）");

	// ③ 找不到浏览器时必须抛错且解释下一步，不得返回一个假结果
	const { findBrowser, missingBrowserError, renderHtml } = await import("../lib/render-html.js");
	const missing = missingBrowserError();
	assert.match(missing.message, /Edge|Chrome|Chromium/, "错误文案应指出需要哪种浏览器");
	assert.match(missing.message, /browserPath|action=render/, "错误文案应给出可执行下一步");
	// 指定一个必然不存在的路径 → 必须抛，而不是静默成功
	assert.throws(
		() => renderHtml({ html: "<p>x</p>", out: join(tmpdir(), "never.png"), browserPath: join(tmpdir(), "no-such-browser.exe") }),
		/没有找到可用于渲染 HTML 的浏览器/
	);
	void findBrowser;
});

test("独立性：无过时命名残留（合并前的旧工具名）", async () => {
	const stale = /\b(ui_taste|ui_audit|design_krita|design_shot|design_psd|design_ping|design_asset|design_composite|design_cover)\b/;
	const hits = [];
	for (const file of libFiles) {
		if (stale.test(stripComments(readFileSync(join(repo, "lib", file), "utf8")))) hits.push(file);
	}
	for (const file of ["cordis.patch.yml", "locale/zh.json", "locale/en.json"]) {
		if (stale.test(readFileSync(join(repo, file), "utf8"))) hits.push(file);
	}
	assert.deepEqual(hits, [], `还有旧工具名残留：${hits.join(", ")}`);
});

test("工具层：name/inject 契约与 apply 幂等", async () => {
	const mod = await import("../lib/index.js");
	assert.equal(mod.name, "tool-visualkit");
	assert.deepEqual(mod.inject, ["tools", "systemPrompt"]);
	const first = await toolRegistry({ config: { findLimit: 5 } });
	const second = await toolRegistry({ config: { findLimit: 5 } });
	assert.equal(first.defs.size, second.defs.size, "同配置重复 apply 不应改变工具表");
	apply(first.ctx, Config({ findLimit: 5 })); // 同一 ctx 上二次 apply 只应覆盖注册
	assert.equal(first.defs.size, TOOL_NAMES.length);
});

/* --------------------------- 5. 全动作输出契约 --------------------------- */

test("全动作：execute→render 无爆错，输出无损且文本无 undefined/NaN", async (t) => {
	const dir = tempDir(t, "contract-actions");
	writeTree(dir, {
		"ui/index.html": '<html><body><button>ok</button></body></html>',
		"ui/app.css": "button{font-size:14px}\n",
		"icon.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M4 4h16"/></svg>'
	});
	const calls = [
		["icon", { action: "find", query: "menu" }],
		["icon", { action: "find", query: "垃圾" }],
		["icon", { action: "emit", name: "menu", target: "colibri" }],
		["icon", { action: "emit", name: "menu", target: "raw", outPath: "out/menu.svg" }],
		["morph", { action: "check", icons: ["menu", "x"] }],
		["morph", { action: "check", file: "icon.svg" }],
		["morph", { action: "preview", from: "menu", to: "x", outPath: "out/preview.html" }],
		["taste_check", { action: "taste", root: "ui" }],
		["taste_check", { action: "audit", root: "ui" }],
		["layout_check", { action: "ui", root: "ui" }],
		["layout_check", { action: "svg", input: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><text x="40" y="80" font-size="32">Title</text></svg>' }],
		["design_style", { skin: "industrial-editorial" }],
		["design_style", { skin: "brutalist", skeleton: "dashboard", format: "json" }],
		["design_style", { skin: "swiss-minimal", skeleton: "landing", format: "tailwind" }],
		["design_render", { action: "asset", mode: "find", keyword: "纹理" }],
		["design_render", { action: "asset", mode: "inline", rel: "icons/brands/qq.svg", color: "#FF6B35" }]
	];
	if (CAN_RENDER) {
		calls.push(["design_render", { action: "render", svg: "icon.svg", png: "out/icon.png" }]);
		calls.push(["design_render", { action: "composite", under: "out/icon.png", over: "icon.svg", out: "out/merged.png" }]);
		calls.push(["layout_check", { action: "image", input: "out/icon.png" }]);
	}
	const texts = [];
	for (const [name, args] of calls) {
		const { value, text } = await call(name, args, { cwd: dir });
		assert.ok(text.trim().length > 0, `${name} ${JSON.stringify(args)}: render 文本为空`);
		assert.ok(!/undefined|NaN|\[object Object\]/.test(text), `${name}: 文本里出现 undefined/NaN/[object Object]`);
		assert.ok(!JSON.stringify(value).includes("null,null"), `${name}: 输出里出现可疑 null 序列`);
		texts.push(`${name}: ${text.split("\n")[0]}`);
	}
	assert.equal(texts.length, calls.length);
	saveArtifact("contract-first-lines.txt", texts.join("\n"));
});

/* ------------------------------ 6. 错误路径 ------------------------------ */

test("错误路径：每个工具的缺参/未知枚举都是「人话」错误", async (t) => {
	const dir = tempDir(t, "contract-errors");
	writeTree(dir, { "a.svg": '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1"/></svg>' });
	const cases = [
		["icon", { action: "find" }, /query/],
		["icon", { action: "find", query: "   " }, /query/],
		["icon", { action: "emit", name: "menu" }, /target/],
		["icon", { action: "emit", name: "no-such-icon-zzz", target: "raw" }, /no-such-icon-zzz|未知|not found|unknown/i],
		["morph", { action: "check" }, /icons \/ file|one of/],
		["morph", { action: "check", icons: ["menu"], file: "a.svg" }, /mutually exclusive/],
		["morph", { action: "check", icons: ["menu", "x", "play"] }, /1–2|1-2/],
		["morph", { action: "check", file: "missing.svg" }, /not found|ENOENT/i],
		["taste_check", { action: "taste" }, /root/],
		["taste_check", { action: "taste", root: join(dir, "nope") }, /not found|不存在/i],
		["design_style", { skin: "no-such-skin" }, /skin/],
		["design_style", { skin: "swiss-minimal", skeleton: "no-such-skeleton" }, /skeleton/],
		["design_style", { skin: "swiss-minimal", format: "scss" }, /format/],
		["design_render", { action: "render", svg: "a.svg" }, /png/],
		["design_render", { action: "asset", mode: "inline" }, /rel/],
		["design_render", { action: "asset", mode: "save", rel: "icons/brands/qq.svg" }, /saveTo/],
		["design_render", { action: "bogus" }, /action/]
	];
	for (const [name, args, pattern] of cases) {
		await rejects(() => call(name, args, { cwd: dir }), pattern, `${name} ${JSON.stringify(args)}`);
	}
	// morph 的缺文件错误应指明路径，而不是裸 ENOENT
	const error = await rejects(() => call("morph", { action: "check", file: "missing.svg" }, { cwd: dir }), /missing\.svg/);
	assert.ok(error.message.length < 200, "错误消息应简短");
});

/* ------------------------------ 7. 确定性 ------------------------------ */

test("确定性：同输入两次结果完全一致（不靠时间/随机/遍历顺序）", async (t) => {
	const dir = tempDir(t, "contract-determinism");
	writeTree(dir, {
		"a.html": '<div style="background:linear-gradient(135deg,#667eea,#764ba2)">🚀 12K</div>',
		"b.css": ".x{font-size:12px;margin:5px}\n"
	});
	const pairs = [
		() => call("icon", { action: "find", query: "arrow" }),
		() => call("design_style", { skin: "studio-grid", skeleton: "editor" }),
		() => call("taste_check", { action: "taste", root: dir }),
		() => call("taste_check", { action: "audit", root: dir }),
		() => call("design_render", { action: "asset", mode: "find", keyword: "图标" })
	];
	for (const run of pairs) {
		const a = await run();
		const b = await run();
		assert.deepEqual(a.value, b.value, "连续两次调用结果不同 = 不可复现");
		assert.equal(a.text, b.text, "连续两次 render 文本不同");
	}
});

/* --------------------------- 8. 路径解析 --------------------------- */

test("路径：相对路径一律按会话目录解析，不按进程 cwd", async (t) => {
	const dir = tempDir(t, "contract-paths");
	writeTree(dir, { "ui/a.html": "<p>ok</p>", "icon.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M2 2h20"/></svg>' });
	const icon = await call("icon", { action: "emit", name: "menu", target: "raw", outPath: "gen/menu.svg" }, { cwd: dir });
	assert.equal(icon.value.writtenTo, join(dir, "gen", "menu.svg"), "icon outPath 应落到会话目录");
	assert.equal(readFileSync(join(dir, "gen", "menu.svg"), "utf8"), icon.value.code);
	const prev = await call("morph", { action: "preview", from: "menu", to: "x", outPath: "gen/p.html" }, { cwd: dir });
	assert.ok(existsSync(join(dir, "gen", "p.html")), "morph outPath 应落到会话目录");
	const taste = await call("taste_check", { action: "taste", root: "." }, { cwd: dir });
	assert.ok(taste.value.filesScanned >= 1, "root=. 应解析到会话目录");
	assert.ok(prev.value.path.endsWith("p.html"));
});

/* --------------------------- 9. 并发声明 --------------------------- */

test("并发标记：只读 action 才声明安全（否则并行会话会踩文件）", async () => {
	const { defs } = await toolRegistry();
	// 注意：defineTool 会先做参数校验，参数非法时一律返回 false —— 所以必须传 schema 合法的参数
	const safe = (name, args) => defs.get(name).isConcurrencySafe(args);
	assert.equal(safe("icon", { action: "find", query: "menu" }), true);
	assert.equal(safe("icon", { action: "emit", name: "menu", target: "raw" }), false, "emit 会写文件，不能声明并发安全");
	assert.equal(safe("morph", { action: "check", icons: ["menu"] }), true);
	assert.equal(safe("morph", { action: "preview", from: "menu", to: "x" }), false, "preview 会写 HTML");
	assert.equal(safe("taste_check", { action: "taste", root: "." }), true);
	assert.equal(safe("design_style", { skin: "swiss-minimal" }), true);
	assert.equal(safe("design_render", { action: "render", svg: "<svg/>" }), true, "渲染写不同路径，可并发");
});
