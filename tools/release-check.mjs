#!/usr/bin/env node
/**
 * release-check.mjs — 发布前静态检查（不改任何文件，只判定）。
 *
 * 为什么不用人记清单：这份清单里有 6 项是**机器能判的**，而人最容易漏的恰恰是它们
 * （版本号三处不一致、CHANGELOG 没写、常驻预算爆了、依赖被偷偷加上）。
 * 动态那部分（测试、真实语料回归、真打包）明确列成“必须另跑”，不在这里悄悄跳过。
 *
 *   npm run release:check      # 全过 exit 0；任一不过 exit 1
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(REPO, p), "utf8");
const fail = [];
const warn = [];
const pass = [];

const ok = (msg) => pass.push(msg);
const bad = (msg) => fail.push(msg);
const soft = (msg) => warn.push(msg);

/* 1) 版本号：package.json / package-lock.json / CHANGELOG 三处一致 */
const pkg = JSON.parse(read("package.json"));
const VERSION = pkg.version;
if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(VERSION) === false) bad(`package.json 版本号不是 x.y.z 或 x.y.z-<预发布>：${VERSION}`);
else ok(`版本号 ${VERSION}`);

const lock = JSON.parse(read("package-lock.json"));
const lockVersions = [lock.version, lock.packages?.[""]?.version];
if (lockVersions.every((v) => v === VERSION)) ok("package-lock.json 版本一致");
else bad(`package-lock.json 版本不一致（顶层 ${lockVersions[0]} / 包内 ${lockVersions[1]}）—— 跑 npm install 同步`);

const changelog = read("CHANGELOG.md");
if (changelog.includes(`## [${VERSION}]`)) ok(`CHANGELOG 有 [${VERSION}] 段落`);
else bad(`CHANGELOG.md 缺 ## [${VERSION}] —— 发布前把 Unreleased 的内容落到版本号下`);

/* 2) 版本策略：pre-1.0 期间契约变更必须是 0.x.0，不允许停在 0.0.x 里改契约 */
const [major, minor] = VERSION.split(".").map(Number);
if (major === 0 && minor === 0) {
	soft("当前处于 0.0.x：只允许“不改变模型契约”的修复；动工具名/参数/枚举/分数口径要升 0.x.0");
}

/* 3) 零运行时依赖（硬规矩：pnpm 会删 link 包主包，实测过） */
if (Object.keys(pkg.dependencies ?? {}).length === 0) ok("无运行时依赖");
else bad(`package.json 出现了 dependencies：${Object.keys(pkg.dependencies).join(", ")}——需要的能力应 vendored 到 vendor/`);

/* 4) 外部进程只用在该用的地方（render-html.js 允许调浏览器，其余不允许） */
const LIB_FILES = [
	"lib/index.js", "lib/taste.js", "lib/taste-image.js", "lib/detect.js", "lib/style.js",
	"lib/render.js", "lib/assets.js", "lib/emit.js", "lib/svg.js", "lib/morphcore.js",
	"lib/layouts/index.js", "lib/layouts/source.js", "lib/layouts/image.js", "lib/layouts/png.js",
	"lib/html-context.js", "lib/css-rewrite.js", "lib/image-normalize.js", "lib/contrast-render.js", "lib/diff.js"
];
// 必须先剥注释：header 里写着“不需要 Python / Krita / Playwright”是**声明**，不是依赖。
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const offenders = LIB_FILES.filter((f) => {
	if (existsSync(join(REPO, f)) === false) return false;
	return /child_process|\bspawn\w*\(|execSync|\bpython\b|playwright/i.test(stripComments(read(f)));
});
if (offenders.length === 0) ok("除 render-html.js 外无外部进程");
else bad(`这些文件引入了外部进程：${offenders.join(", ")}`);

/* 5) 常驻预算：默认档 ≤3600，全量档 ≤4200 */
const mod = await import("../lib/index.js");
const measure = (profile) => {
	const defs = new Map();
	let section = null;
	mod.apply(
		{
			tools: { register: (d) => defs.set(d.name, d), get: (n) => defs.get(n) },
			systemPrompt: { section: (s) => (section = s) },
			// apply() 末尾会 ctx.effect(...) 注册清理，桩里必须给上，否则一调就抛
			effect: () => () => {}
		},
		mod.Config({ toolsetProfile: profile })
	);
	// **数组项的嵌套属性说明也会发给模型**——漏算它会让这个检查比 cartract 测试宽松，
	// 两个尺子量出两个数（实测 3352 vs 3612），那这个检查就成了安慰剂。
	const nested = (prop) => {
		const props = prop?.items?.properties;
		return props === undefined ? 0 : Object.values(props).reduce((sum, p) => sum + (p.description ?? "").length, 0);
	};
	let chars = 0;
	for (const d of defs.values()) {
		chars += d.description.length;
		for (const p of Object.values(d.parameters.properties ?? {})) chars += (p.description ?? "").length + nested(p);
	}
	const text = typeof section?.text === "function" ? section.text({ scope: {} }) : "";
	return { chars: chars + (text?.length ?? 0), tools: defs.size, dispose: section?.dispose };
};
const standard = measure("standard");
const all = measure("all");
if (standard.chars <= 3600) ok(`默认档常驻 ${standard.chars}/3600（${standard.tools} 工具）`);
else bad(`默认档常驻 ${standard.chars} 超过 3600 —— 精简描述，别让每个请求都背说明`);
if (all.chars <= 4200) ok(`全量档常驻 ${all.chars}/4200（${all.tools} 工具）`);
else bad(`全量档常驻 ${all.chars} 超过 4200`);

/* 6) 包清单：必需文件在、开发期文件不在 */
const REQUIRED = ["lib/index.js", "lib/html-context.js", "lib/css-rewrite.js", "lib/image-normalize.js",
	"data/lucide-icons.json", "data/packs/tabler.icons.json", "vendor/resvg", "cordis.patch.yml", "icon.svg",
	"locale/zh.json", "locale/en.json", "README.md", "LICENSE", "CHANGELOG.md", "THIRD_PARTY.md"];
const missing = REQUIRED.filter((f) => existsSync(join(REPO, f)) === false);
if (missing.length === 0) ok("必需文件齐备");
else bad(`缺必需文件：${missing.join(", ")}`);
const filesField = pkg.files ?? [];
if (filesField.some((f) => f.startsWith("test") || f.startsWith("docs") || f.includes(".test-out"))) {
	bad("package.json 的 files 里混进了 test/ 或 docs/（开发期文件不该进包）");
} else ok("files 白名单不含开发期文件");

/* 输出 */
console.log("release-check");
for (const line of pass) console.log(`  ✓ ${line}`);
for (const line of warn) console.log(`  ⚠ ${line}`);
for (const line of fail) console.log(`  ✗ ${line}`);

console.log("\n还必须另跑（本脚本不代替）：");
console.log("  npm test               # 全套功能测试，含发布边界");
console.log("  npm run selfcheck      # 真实项目误报回归");
console.log("  npm run test:pack      # 真 npm pack → 解包 → 拆包副本跑一次");

if (fail.length > 0) {
	console.log(`\n${fail.length} 项不过，不能发。`);
	process.exit(1);
}
console.log("\n静态检查全过。");
