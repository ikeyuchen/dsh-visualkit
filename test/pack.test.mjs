// test/pack.test.mjs — 发布边界测试：**测的是 tarball，不是工作区**。
//
// 动机：工作区里的文件都在，不代表 `npm publish` 后它们还在。`files` 白名单漏一项，
// npm 照样发布成功，用户装完第一次调用才炸（历史上真出过：resvg 依赖被 pnpm 删掉）。
// 所以这里真的 `npm pack` → 解开 → 用拆包后的副本跑一次工具调用。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { gunzipSync } from "node:zlib";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));

/** 必需文件：任何一个丢了，装上去就会残废。 */
const REQUIRED = [
	"package.json",
	"lib/index.js",
	"lib/icondb.js",
	"lib/emit.js",
	"lib/svg.js",
	"lib/morphcore.js",
	"lib/preview.js",
	"lib/taste.js",
	"lib/audit.js",
	"lib/rules.js",
	"lib/detect.js",
	"lib/style.js",
	"lib/render.js",
	"lib/assets.js",
	"lib/layouts/index.js",
	"lib/layouts/common.js",
	"lib/layouts/png.js",
	"lib/layouts/source.js",
	"lib/layouts/svg.js",
	"lib/layouts/image.js",
	"data/lucide-icons.json",
	"data/packs/tabler.icons.json",
	"data/assets/manifest.json",
	"vendor/morphicons.iife.js",
	"vendor/morphicons-adapters.iife.js",
	"vendor/resvg/index.js",
	"vendor/resvg/js-binding.js",
	"vendor/resvg/package.json",
	"locale/zh.json",
	"locale/en.json",
	"cordis.patch.yml",
	"icon.svg",
	"README.md",
	"LICENSE",
	"THIRD_PARTY.md"
];

/** 不允许进包的东西（开发期文件 / 大体积产物）。 */
const FORBIDDEN_PREFIXES = ["test/", "docs/", ".github/", ".test-out/", ".git/"];
const FORBIDDEN_FILES = new Set(["selftest.mjs", "package-lock.json", ".gitignore", ".gitattributes", "AGENTS.md"]);

/** 跑 npm pack。Windows 上 npm 是 .cmd，必须过 shell；为了无 DeprecationWarning，shell 模式下传完整命令串。
 *  **必须剥掉 npm_config_dry_run**：`npm publish --dry-run` 会把它带进 prepublishOnly，
 *  子进程里的 `npm pack` 于是只报告不落盘，tar 打不开文件——发布前的 dry-run 验证会假失败。 */
function childEnv() {
	const env = { ...process.env };
	for (const key of Object.keys(env)) {
		if (key.toLowerCase() === "npm_config_dry_run") delete env[key];
	}
	return env;
}

function npmPackJson(dir) {
	const args = ["pack", "--json", "--pack-destination", dir];
	const options = { encoding: "utf8", cwd: REPO, maxBuffer: 32 * 1024 * 1024, env: childEnv() };
	if (process.platform === "win32") {
		const command = `npm ${args.map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(" ")}`;
		return execFileSync(command, { ...options, shell: true });
	}
	return execFileSync("npm", args, options);
}

/** 极简 tar 读取：只做两件事——列文件名、按路径解包。
 *
 *  不调系统 tar：GitHub 的 Windows runner 上 `tar` 读不了包内的中文文件名
 *  （`Archive entry has empty or unreadable filename`，data/assets/parts/*.png 全是中文名），
 *  而 ubuntu 的 GNU tar 与本地 tar 行为又不同。npm 的包是 ustar + pax 扩展头，自己解析最稳。 */
function readTarball(tgz) {
	const buf = gunzipSync(readFileSync(tgz));
	const entries = [];
	const str = (start, len) => {
		const slice = buf.subarray(start, start + len);
		const zero = slice.indexOf(0);
		return slice.subarray(0, zero === -1 ? slice.length : zero).toString("utf8");
	};
	let offset = 0;
	let pendingPath = null;
	while (offset + 512 <= buf.length) {
		if (buf.subarray(offset, offset + 512).every((byte) => byte === 0)) break;
		const name = str(offset, 100);
		const size = parseInt(str(offset + 124, 12).trim() || "0", 8) || 0;
		const type = String.fromCharCode(buf[offset + 156]) || "0";
		const prefix = str(offset + 345, 155);
		const dataStart = offset + 512;
		const data = buf.subarray(dataStart, dataStart + size);
		if (type === "x" || type === "g") {
			// pax 扩展头：长路径与 UTF-8 文件名在这里
			const match = data.toString("utf8").match(/(?:^|\n)\d+ path=([^\n]+)\n/);
			if (match) pendingPath = match[1];
		} else if (type === "L") {
			pendingPath = data.toString("utf8").replace(/\0+$/, "");
		} else if (type === "0" || type === "\0" || type === "7") {
			const full = pendingPath ?? (prefix ? `${prefix}/${name}` : name);
			pendingPath = null;
			if (!full.endsWith("/")) entries.push({ path: full.replace(/^package\//, ""), data });
		} else {
			pendingPath = null;
		}
		offset = dataStart + Math.ceil(size / 512) * 512;
	}
	return entries;
}

function listTarball(tgz) {
	return readTarball(tgz).map((entry) => entry.path);
}

function extractTarball(tgz, dest) {
	for (const entry of readTarball(tgz)) {
		const target = join(dest, entry.path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, entry.data);
	}
	return dest;
}

const PACK_DIR = join(REPO, ".test-out", "pack", String(process.pid));
// 整个文件共用一个打包目录：两个 test 都依赖它，所以清理放在文件级 after 而不是 test.after
rmSync(PACK_DIR, { recursive: true, force: true });
mkdirSync(PACK_DIR, { recursive: true });
after(() => {
	// 清理是尽力而为：Windows 上杀毒/索引器可能临时占用刚解包的目录，
	// 删不掉不应该把测试判失败（目录在 .test-out/，已 gitignore）
	try {
		rmSync(PACK_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	} catch {
		/* 留给下次运行开头的前置清理 */
	}
});

function packOnce() {
	const dir = PACK_DIR;
	const raw = npmPackJson(dir);
	// npm --json 在 stdout 输出纯 JSON（notice 走 stderr），直接整体解析，勿逐行过滤
	const json = JSON.parse(raw.slice(raw.indexOf("[")));
	const info = Array.isArray(json) ? json[0] : json;
	const tgz = join(dir, info.filename);
	// 解包一次，两个测试共用（避免重复解包）
	const extracted = join(dir, "x");
	mkdirSync(extracted, { recursive: true });
	extractTarball(tgz, extracted);
	return { dir, tgz, info, extracted };
}

// 只跑一次 pack，三个断言组共享（避免反复打包）
let packed = null;
test("npm pack：产物完整、无开发期文件泄漏、体积可控", { timeout: 180000 }, async () => {
	packed = packOnce();
	const files = listTarball(packed.tgz);
	const set = new Set(files);

	const missing = REQUIRED.filter((file) => !set.has(file));
	assert.deepEqual(missing, [], `发布包缺失：${missing.join(", ")}`);

	// 原生绑定必须在（npm 会忽略 .gitignore 里匹配的文件，但 files 白名单优先）
	assert.ok(
		files.some((file) => /^vendor\/resvg\/.*\.node$/.test(file)),
		"resvg 原生绑定没进包：Windows 用户装上就是 Cannot find native binding"
	);

	const leaked = files.filter((file) => FORBIDDEN_PREFIXES.some((prefix) => file.startsWith(prefix)) || FORBIDDEN_FILES.has(file));
	assert.deepEqual(leaked, [], `开发期文件漏进发布包：${leaked.join(", ")}`);

	const sizeMb = statSync(packed.tgz).size / 1024 / 1024;
	assert.ok(sizeMb < 24, `tarball ${sizeMb.toFixed(1)}MB 超过 24MB 上限`);
	assert.ok(files.length > 200, `包内文件只有 ${files.length} 个，数据可能没打进去`);

	// 包内 package.json 必须与工作区一致（版本号写错 = 发布事故）
	const packedPkg = JSON.parse(readFileSync(join(packed.extracted, "package.json"), "utf8"));
	assert.equal(packedPkg.version, pkg.version);
	assert.equal(packedPkg.name, pkg.name);
	assert.deepEqual(packedPkg.dependencies ?? {}, {}, "发布包不应有运行时依赖");
	// 发布前钩子必须存在，且**同时**包含静态检查与全套测试：
	// 只跑测试会漏版本号漂移/预算爆表；只跑静态检查会漏功能回归。
	const prepublish = packedPkg.scripts?.prepublishOnly ?? "";
	assert.ok(prepublish.includes("release:check"), `发布前钩子应先跑静态检查，实际：${prepublish}`);
	assert.ok(prepublish.includes("test"), `发布前钩子必须跑全套测试，实际：${prepublish}`);
	assert.equal(packedPkg.scripts?.postinstall ?? null, null, "不允许 postinstall：安装时要执行脚本的包不可接受");
});

test("拆包后的副本能独立工作（不靠工作区里的任何东西）", { timeout: 180000 }, async (t) => {
	assert.ok(packed !== null, "前一个 pack 测试未完成");
	// 解包位置在仓库内：node 的模块解析会一路上溯到 <repo>/node_modules 找到 peer 依赖，
	// 等价于宿主环境（peer 由宿主提供）；本包自己的 data/ 与 vendor/ 必须全部来自 tarball。
	const installed = packed.extracted;
	const root = packed.dir;

	const mod = await import(pathToFileURL(join(installed, "lib", "index.js")).href);
	const defs = new Map();
	let section = null;
	const ctx = {
		tools: { register: (def) => defs.set(def.name, def), get: (name) => defs.get(name) },
		systemPrompt: { section: (entry) => { section = entry; return () => {}; } },
		effect: (fn) => fn?.(),
		get: () => undefined,
		logger: { warn() {} }
	};
	// 默认配置（不传 toolsetProfile）→ standard 档，只装 4 个高频工具。
	// 这条同时验证「生产默认是精简的」——低频工具不默认占上下文。
	mod.apply(ctx, mod.Config({}));
	assert.deepEqual([...defs.keys()], ["icon", "taste_check", "layout_check", "design_render", "html_edit", "css_edit"], "默认档位应是 standard（6 工具）");
	assert.equal(section.text({ scope: {} }).includes("design_style"), false, "未注册的工具不应该出现在提示段里");
	assert.ok(section.text({ scope: {} }).includes("layout_check"), "已注册的工具应出现在提示段里");
	// 全量档位能拿到全部 7 个（含低频工具 html_edit）
	const allDefs = new Map();
	mod.apply(
		{ ...ctx, tools: { register: (def) => allDefs.set(def.name, def), get: (name) => allDefs.get(name) } },
		mod.Config({ toolsetProfile: "all" })
	);
	assert.equal(allDefs.size, 8, "all 档位应装全 8 个工具");
	for (const n of ["morph", "design_style", "html_edit", "css_edit"]) assert.ok(allDefs.has(n), `all 档位应含 ${n}`);

	// 纯数据类工具直接跑
	const found = await defs.get("icon").execute({ action: "find", query: "菜单" }, {});
	assert.ok(found.results.length > 0, "拆包后的图标库搜不到东西");
	assert.equal(found.results[0].name, "menu");
	// design_style 属 all 档，用 allDefs 取（默认档位里没有它）
	const style = await allDefs.get("design_style").execute({ skin: "industrial-editorial" }, {});
	assert.ok(style.code.includes("--c-accent"));
	const asset = await defs.get("design_render").execute({ action: "asset", mode: "find", keyword: "品牌" }, {});
	assert.ok(asset.items.length > 0, "拆包后的素材库检索为空");

	// 渲染：用拆包后的 vendored resvg，证明 .node 绑定跟着包走
	const png = join(root, "smoke.png");
	const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="#E4002B"/></svg>';
	try {
		const out = await defs.get("design_render").execute({ action: "render", svg, png }, {});
		assert.equal(out.width, 32);
		assert.ok(existsSync(png));
	} catch (error) {
		if (process.platform !== "win32") return; // 只带 win32-x64 绑定，其它平台允许失败
		throw error;
	}
	writeFileSync(join(root, "smoke.txt"), "ok");
});
