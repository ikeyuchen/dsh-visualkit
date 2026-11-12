// test/icon.test.mjs — icon 工具（find / emit）与底层 emit / icondb / svg 契约。
//
// 主链路一律走 helpers.call（execute → output.render，已内置输出 schema 与无损 JSON 校验）。
// 只有两处必须下探到 lib 层：
//   · 2029 个 lucide 图标逐个 checkIcon(...).parsed === true（保留原有的全量守卫）；
//   · 几何抽样直接 emit(name, "raw")，用 resvg 真渲染判「合法 SVG」
//     （CAN_RENDER 为 false 的 CI 只保留字符串格式断言）。
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { CAN_RENDER, REPO, call, inkBox, opaqueRatio, pngOf, rejects, tempDir } from "./helpers.mjs";
import { emit, STYLES as STYLES_LIST, TARGETS } from "../lib/emit.js";
import { renderSvg as renderToPng } from "../lib/render.js";

/** 把一段 SVG 代码落成 PNG（像素断言的跳板）。 */
async function renderFile(code, file, width) {
	return renderToPng({ svg: code, png: file, width });
}
import { checkIcon } from "../lib/svg.js";
import { meta } from "../lib/icondb.js";

const DATA = JSON.parse(readFileSync(new URL("../data/lucide-icons.json", import.meta.url), "utf8"));
const TARGET_LIST = ["colibri", "echo", "dsh-plugin", "whale", "raw"];
// 与 helpers.CAN_RENDER 同一份 vendored resvg；直接 new Resvg 渲染（不经 render.js 的字体初始化）
const { Resvg } = CAN_RENDER ? createRequire(join(REPO, "package.json"))(join(REPO, "vendor", "resvg", "index.js")) : {};

/* -------------------------------- find -------------------------------- */

test("find: 中文词 / 英文词 / 类别词 / 别名 / PascalCase 输入都能命中", async () => {
	const zh = await call("icon", { action: "find", query: "菜单" });
	assert.equal(zh.value.results[0]?.name, "menu", "中文「菜单」应命中 menu");
	assert.match(zh.text, /^icon library: \d+ match\(es\)/, "文本应汇报命中条数");

	const en = await call("icon", { action: "find", query: "settings" });
	assert.equal(en.value.results[0]?.name, "settings", "英文 settings 应命中同名图标");

	const category = await call("icon", { action: "find", query: "weather" });
	assert.ok(
		category.value.results.some((r) => ["sun", "cloud", "cloud-sun", "snowflake"].includes(r.name)),
		"类目词 weather 应命中天气类图标"
	);
	const arrows = await call("icon", { action: "find", query: "arrows" });
	assert.ok(arrows.value.results.some((r) => r.name.startsWith("arrow")), "类目词 arrows 应命中箭头图标");

	const alias = await call("icon", { action: "find", query: "alarm-check" });
	assert.equal(alias.value.results[0]?.name, "alarm-clock-check", "别名 alarm-check 应命主名");
	assert.ok(alias.value.results[0]?.aliases.includes("alarm-check"), "结果里应回显命中的别名");

	const pascal = await call("icon", { action: "find", query: "Settings" });
	assert.equal(pascal.value.results[0]?.name, "settings", "单 PascalCase 词应等价于小写检索");
});

test("find: limit 边界（1 / 超大 / 非整数 / 缺省 / 0）", async () => {
	const one = await call("icon", { action: "find", query: "arrow", limit: 1 });
	assert.equal(one.value.count, 1, "limit=1 只返回 1 条");
	const big = await call("icon", { action: "find", query: "arrow", limit: 1000 });
	assert.equal(big.value.count, 50, "超大 limit 应钳到上限 50");
	const frac = await call("icon", { action: "find", query: "arrow", limit: 2.5 });
	assert.equal(frac.value.count, 2, "非整数 limit 按整数截断且不抛");
	const dflt = await call("icon", { action: "find", query: "arrow" });
	assert.equal(dflt.value.count, 12, "未给 limit 应走 Config.findLimit=12");
	const zero = await call("icon", { action: "find", query: "arrow", limit: 0 });
	assert.equal(zero.value.count, 1, "limit=0 应钳到下限 1");
});

test("find: 空 query 报错；无结果返回 count=0 且不抛", async () => {
	await rejects(() => call("icon", { action: "find", query: "" }), /requires query/, "空 query");
	await rejects(() => call("icon", { action: "find", query: "   " }), /requires query/, "纯空白 query");
	await rejects(() => call("icon", { action: "find" }), /requires query/, "缺 query 参数");
	const none = await call("icon", { action: "find", query: "zzzqqqxxx" });
	assert.equal(none.value.count, 0, "无结果时 count 应为 0");
	assert.deepEqual(none.value.results, [], "无结果时 results 应为空数组");
	assert.match(none.text, /try broader/, "无结果文本应给出下一步建议");
});

test("find: camelCase / PascalCase 归一化后等价于 kebab 检索", async () => {
	const camel = await call("icon", { action: "find", query: "chevronDown" });
	assert.equal(camel.value.results[0]?.name, "chevron-down", "camelCase 应命 chevron-down");
	assert.ok(camel.value.count > 0);
	const pascal = await call("icon", { action: "find", query: "ChevronDown" });
	assert.equal(pascal.value.results[0]?.name, "chevron-down", "多词 PascalCase 应命 chevron-down");
});

/* ---------------------------- icondb / svg ---------------------------- */

test("全量扫描: 2029 个 lucide 图标逐个 checkIcon(...).parsed === true", async () => {
	assert.equal(meta().iconCount, 2029, "图标库总量应锁定 2029（数据漂移会让本用例失败）");
	assert.equal(Object.keys(DATA.icons).length, 2029, "JSON 条目数应与 meta 一致");
	const notParsed = [];
	let countMismatch = 0;
	for (const [name, entry] of Object.entries(DATA.icons)) {
		const check = checkIcon(entry.node);
		if (!check.parsed) notParsed.push(name);
		if (check.nodeCount !== entry.node.length) countMismatch += 1;
	}
	assert.deepEqual(notParsed, [], `这些图标无法通过契约层解析：${notParsed.slice(0, 5).join(", ")}`);
	assert.equal(countMismatch, 0, "checkIcon.nodeCount 应等于图标节点数");
});

test("抽样: 40+ 图标覆盖 path/circle/rect/line/polyline/polygon，raw 出码合法", async () => {
	const byTag = new Map();
	for (const [name, entry] of Object.entries(DATA.icons)) {
		for (const [tag] of entry.node) {
			if (!byTag.has(tag)) byTag.set(tag, []);
			byTag.get(tag).push(name);
		}
	}
	const tags = ["path", "circle", "rect", "line", "polyline", "polygon"];
	const sample = new Set();
	for (const tag of tags) for (const name of (byTag.get(tag) ?? []).slice(0, 16)) sample.add(name);
	assert.ok(sample.size >= 40, `抽样应 ≥40 个真实图标（实得 ${sample.size}）`);
	const missing = tags.filter((tag) => ![...sample].some((name) => DATA.icons[name].node.some(([g]) => g === tag)));
	assert.deepEqual(missing, [], `抽样必须覆盖这些几何 primitive：${missing.join(", ")}`);

	const badSyntax = [];
	const renderFail = [];
	let rendered = 0;
	for (const name of sample) {
		const code = emit(name, "raw").code;
		if (!code.startsWith("<svg") || !code.includes('viewBox="0 0 24 24"') || !code.endsWith("</svg>")) badSyntax.push(name);
		if (CAN_RENDER) {
			try {
				// 图标是纯几何，关掉系统字体扫描（否则每次构造 Resvg 要背 ~250ms 字体加载）
				const img = new Resvg(code, { font: { loadSystemFonts: false } }).render();
				if (img.width === 24 && img.height === 24) rendered += 1;
				else renderFail.push(`${name}: ${img.width}x${img.height}`);
			} catch (error) {
				renderFail.push(`${name}: ${error.message}`);
			}
		}
	}
	assert.deepEqual(badSyntax, [], `raw 必须是完整独立 <svg>：${badSyntax.join(", ")}`);
	if (CAN_RENDER) {
		assert.deepEqual(renderFail, [], `resvg 渲染失败：${renderFail.join("；")}`);
		assert.equal(rendered, sample.size, "每个抽样图标都应渲染成 24×24");
	}
});

/* -------------------------------- emit -------------------------------- */

test("emit: 5 个 target × 6 图标都不出现 undefined / NaN / [object Object]", async () => {
	assert.deepEqual(TARGETS, TARGET_LIST, "emit target 列表应锁定为 5 种");
	const names = ["menu", "x", "play", "download", "settings", "heart"];
	const bad = [];
	const renderFail = [];
	for (const target of TARGET_LIST) {
		for (const name of names) {
			const { value } = await call("icon", { action: "emit", name, target });
			const code = String(value.code ?? "");
			if (value.target !== target) bad.push(`${target}:${name}: target 回显错误`);
			if (value.icon?.name !== name) bad.push(`${target}:${name}: icon.name 错误`);
			if (code.trim() === "" || /undefined|NaN|\[object Object\]/.test(code)) bad.push(`${target}:${name}: 代码含占位符垃圾`);
			// 可独立交付的 SVG 产物（raw / dsh-plugin）用 resvg 真渲染判合法
			if (CAN_RENDER && (target === "raw" || target === "dsh-plugin")) {
				try {
					new Resvg(code, { font: { loadSystemFonts: false } }).render();
				} catch (error) {
					renderFail.push(`${target}:${name}: ${error.message}`);
				}
			}
		}
	}
	assert.deepEqual(bad, [], `emit 产物不合法：${bad.slice(0, 5).join("；")}`);
	if (CAN_RENDER) assert.deepEqual(renderFail, [], `raw/dsh-plugin 产物应可被 resvg 渲染：${renderFail.join("；")}`);
});

test("emit: raw / echo 格式与 size / strokeWidth / color / partner / spring 生效", async () => {
	const raw = (await call("icon", { action: "emit", name: "menu", target: "raw" })).value;
	assert.ok(raw.code.startsWith("<svg"), "raw 应以 <svg 开头");
	assert.match(raw.code, /viewBox="0 0 24 24"/, "raw 必须带 24 网格 viewBox");
	for (const size of [16, 20, 24, 32]) {
		const { value } = await call("icon", { action: "emit", name: "menu", target: "raw", size });
		assert.match(value.code, new RegExp(`width="${size}" height="${size}"`), `size=${size} 应真的写进 width/height`);
	}
	const styled = (await call("icon", { action: "emit", name: "menu", target: "raw", size: 20, strokeWidth: 1.5, color: "oklch(0.6 0.2 20)" })).value;
	assert.match(styled.code, /stroke-width="1\.5"/, "strokeWidth 应写进 stroke-width");
	assert.match(styled.code, /stroke="oklch\(0\.6 0\.2 20\)"/, "color 应写进 stroke");
	const echo = (await call("icon", { action: "emit", name: "play", target: "echo", partner: "pause", spring: "smooth" })).value;
	assert.match(echo.code, /import \{ Play, Pause \} from "lucide"/, "echo 应同时 import 两个图标");
	assert.match(echo.code, /<MorphIcon :icon="state \? Pause : Play" spring="smooth" \/>/, "echo 的 partner/spring 应生效");
	const echoDefault = (await call("icon", { action: "emit", name: "play", target: "echo", partner: "pause" })).value;
	assert.match(echoDefault.code, /spring="snappy"/, "echo 未给 spring 应回落 snappy");
	const whale = (await call("icon", { action: "emit", name: "menu", target: "whale" })).value;
	assert.match(whale.code, /width="16" height="16"/, "whale 缺省尺寸应为 16");
	assert.ok(whale.code.startsWith("el.innerHTML = '"), "whale 应是单行 JS 字符串");
});

test("emit: outPath 按会话目录落盘，内容与返回 code 一致", async (t) => {
	const dir = tempDir(t, "emit-outpath");
	const { value, text } = await call("icon", { action: "emit", name: "menu", target: "raw", outPath: "icons/menu.svg" }, { cwd: dir });
	const file = join(dir, "icons", "menu.svg");
	assert.ok(existsSync(file), "相对 outPath 应落在会话目录（并自动建父目录）");
	assert.equal(readFileSync(file, "utf8"), value.code, "落盘内容必须与返回 code 逐字节一致");
	assert.equal(value.writtenTo, file, "writtenTo 应是会话目录下的绝对路径");
	assert.match(text, /written:/, "文本应汇报落盘位置");
	const abs = join(dir, "abs.svg");
	const { value: absValue } = await call("icon", { action: "emit", name: "x", target: "raw", outPath: abs });
	assert.equal(absValue.writtenTo, abs, "绝对 outPath 应原样使用");
	assert.equal(readFileSync(abs, "utf8"), absValue.code, "绝对路径落盘内容也应一致");
});

test("emit: 错误路径（未知图标 / 非法 target / 注入）清晰可行动", async () => {
	await rejects(() => call("icon", { action: "emit", name: "no-such-icon-xyz", target: "raw" }), /unknown lucide icon "no-such-icon-xyz"/, "未知图标名应带名字报错");
	await rejects(() => call("icon", { action: "emit", name: "menu", target: "bogus" }), /"target" must be one of|unknown emit target/, "非法 target 应报错");
	await rejects(() => call("icon", { action: "emit", name: "menu", target: "raw", color: 'red"/><script>' }), /color/, "color 注入必须被拒");
	await rejects(() => call("icon", { action: "emit", name: "menu", target: "raw", color: "red;background:url(x)" }), /color/, "color 白名单应拒绝分号");
	await rejects(() => call("icon", { action: "emit", name: "menu", target: "raw", size: Number.NaN }), /finite JSON number/, "NaN size 应被参数校验拦住");
	await rejects(() => call("icon", { action: "emit", name: "menu", target: "raw", strokeWidth: Number.NaN }), /finite JSON number/, "NaN strokeWidth 应被参数校验拦住");
	await rejects(() => emit("menu", "raw", { className: 'a" onload="x' }), /className/, "className 注入必须被拒（底层白名单）");
	await rejects(() => emit("menu", "raw", { keyName: "bad key" }), /keyName/, "keyName 必须是合法 JS 标识符");
});

/* ---------------------------- 边界与确定性 ---------------------------- */

test("emit: size / strokeWidth 非法值报错，合法边界产出可渲染 SVG", async () => {
	// 非法值必须响亮失败（size 域 4–4096、strokeWidth 域 0–64）
	await rejects(() => call("icon", { action: "emit", name: "menu", target: "raw", size: 0 }), /size/, "size=0");
	await rejects(() => call("icon", { action: "emit", name: "menu", target: "raw", size: -1 }), /size/, "size=-1");
	await rejects(() => call("icon", { action: "emit", name: "menu", target: "raw", size: 5000 }), /size/, "size 超上限");
	await rejects(() => call("icon", { action: "emit", name: "menu", target: "raw", strokeWidth: -1 }), /strokeWidth/, "strokeWidth=-1");
	await rejects(() => call("icon", { action: "emit", name: "menu", target: "raw", strokeWidth: 65 }), /strokeWidth/, "strokeWidth 超上限");
	// 合法边界：4 / 4096、0 / 64 必须产出格式正确（且 resvg 可渲染）的 SVG
	const low = (await call("icon", { action: "emit", name: "menu", target: "raw", size: 4, strokeWidth: 0 })).value;
	assert.match(low.code, /width="4" height="4"/, "size=4 应写入 width/height");
	assert.match(low.code, /stroke-width="0"/, "strokeWidth=0 是合法取值（无描边）");
	const high = (await call("icon", { action: "emit", name: "menu", target: "raw", size: 4096, strokeWidth: 64 })).value;
	assert.match(high.code, /width="4096" height="4096"/, "size=4096 应写入 width/height");
	assert.match(high.code, /stroke-width="64"/, "strokeWidth=64 应写入 stroke-width");
	if (CAN_RENDER) {
		const render = (code) => new Resvg(code, { font: { loadSystemFonts: false } }).render();
		assert.doesNotThrow(() => render(low.code), "size=4 + strokeWidth=0 应是可渲染 SVG");
		const thick = (await call("icon", { action: "emit", name: "menu", target: "raw", strokeWidth: 64 })).value;
		assert.doesNotThrow(() => render(thick.code), "strokeWidth=64 应是可渲染 SVG");
	}
});
test("风格意图检索：填充/实心 → -filled 变体（tabler 有 1088 个）", async () => {
	for (const query of ["填充", "实心", "filled"]) {
		const { value } = await call("icon", { action: "find", query, limit: 5 });
		assert.ok(value.results.length > 0, `${query}: 应能检索到填充图标（旧实现 0 命中）`);
		assert.ok(
			value.results.filter((r) => r.name.endsWith("-filled")).length >= 3,
			`${query}: 前 5 条应主要是 -filled 变体，实际 ${value.results.map((r) => r.name).join(",")}`
		);
	}
	const heart = await call("icon", { action: "find", query: "填充的心形", limit: 3 });
	assert.ok(heart.value.results.some((r) => r.name === "heart-filled"), `「填充的心形」应命中 heart-filled，实际 ${heart.value.results.map((r) => r.name).join(",")}`);
});

test("风格意图检索：线性/描边 不应把 -filled 放在前面", async () => {
	const { value } = await call("icon", { action: "find", query: "线性 首页", limit: 3 });
	assert.ok(value.results.length > 0, "线性检索应有结果");
	assert.equal(value.results[0].name.endsWith("-filled"), false, `线性意图下首条不应是填充版：${value.results[0].name}`);
	assert.ok(value.results[0].name.includes("home"), `首页 → home 类图标，实际 ${value.results[0].name}`);
});

test("品牌意图检索：微信/品牌 能命中 tabler brand-*（411 个品牌图标）", async () => {
	const wechat = await call("icon", { action: "find", query: "微信", limit: 3 });
	assert.ok(wechat.value.results.some((r) => r.name === "brand-wechat"), `微信应命中 brand-wechat，实际 ${wechat.value.results.map((r) => r.name).join(",")}`);
	const brand = await call("icon", { action: "find", query: "品牌", limit: 5 });
	assert.ok(brand.value.results.length > 0, "「品牌」应能检索");
	assert.ok(brand.value.results.every((r) => r.name.startsWith("brand-")), `品牌意图应返回 brand-*：${brand.value.results.map((r) => r.name).join(",")}`);
	const github = await call("icon", { action: "find", query: "github", limit: 3 });
	assert.equal(github.value.results[0]?.name, "brand-github", "github 首条应是 brand-github");
});

test("echo 出码：tabler 图标必须 import 自 @tabler/icons-vue（旧实现硬编码 lucide）", async () => {
	const { value } = await call("icon", { action: "emit", name: "heart-filled", target: "echo" });
	assert.match(value.code, /from "@tabler\/icons-vue"/, `应 import 自 @tabler/icons-vue，实际：${value.code.split("\n")[0]}`);
	assert.equal(/from "lucide"/.test(value.code), false, "tabler 图标不能 import 自 lucide（lucide 没有这些导出）");
	assert.ok(value.notes.some((n) => n.includes("@tabler/icons-vue")), "notes 应提示依赖来源");
	// 跨图标集的两态：必须两行 import + 提示几何基准差异
	const pair = await call("icon", { action: "emit", name: "heart-filled", target: "echo", partner: "heart" });
	assert.match(pair.value.code, /from "@tabler\/icons-vue"/, "填充版 import 自 tabler");
	assert.match(pair.value.code, /from "lucide"/, "伙伴 import 自 lucide");
	assert.ok(pair.value.notes.some((n) => n.includes("不同图标集")), "跨图标集两态应有风险提示");
});

test("style=solid：自动换填充版，输出 fill 而不是 stroke", async () => {
	const { value } = await call("icon", { action: "emit", name: "home", target: "raw", style: "solid", color: "#E4002B" });
	assert.equal(value.style, "solid");
	assert.ok(value.icon.name.endsWith("-filled"), `solid 应用填充版，实际 ${value.icon.name}`);
	assert.match(value.code, /fill="currentColor"/, "solid 应用 fill 渲染");
	assert.equal(/stroke-width="2"/.test(value.code), false, "solid 不应再叠加描边管线");
	assert.ok(value.notes.some((n) => n.includes("填充版")), "notes 应说明换用了填充版");
});

test("style=duotone：双层（填充 20% + 线稿），colibri 的 inner 不能用 <g>", async () => {
	const raw = await call("icon", { action: "emit", name: "heart", target: "raw", style: "duotone", color: "#E4002B" });
	assert.equal(raw.value.style, "duotone");
	assert.match(raw.value.code, /fill-opacity="0\.2"/, "duotone 应有 20% 透明度的填充层");
	assert.equal((raw.value.code.match(/<g /g) ?? []).length, 2, "duotone 应是两个图层");
	assert.match(raw.value.code, /stroke="#E4002B"/, "线稿层用主色描边");
	// colibri 的 inner 会被 parseIconNodes 解析：不能带 <g>，只能把属性下推到元素
	const colibri = await call("icon", { action: "emit", name: "heart", target: "colibri", style: "duotone" });
	assert.equal(colibri.value.code.includes("<g"), false, "colibri inner 不得含 <g>（parseIconNodes 不认分组）");
	assert.match(colibri.value.code, /fill-opacity="0\.2"/, "填充层属性应下推到元素");
	// 填充图标反向：给 heart-filled 也能得到 duotone（自动找线性双胞胎）
	const rev = await call("icon", { action: "emit", name: "heart-filled", target: "raw", style: "duotone" });
	assert.equal(rev.value.style, "duotone");
	assert.equal(rev.value.icon.name, "heart", "反向 duotone 应以线性版为主图标");
});

test("style=sharp：尖角端点（butt/miter），echo 上会提示不生效", async () => {
	const { value } = await call("icon", { action: "emit", name: "menu", target: "raw", style: "sharp" });
	assert.match(value.code, /stroke-linecap="butt"/);
	assert.match(value.code, /stroke-linejoin="miter"/);
	const echo = await call("icon", { action: "emit", name: "menu", target: "echo", style: "sharp" });
	assert.ok(echo.value.notes.some((n) => n.includes("sharp") && n.includes("不生效")), "echo 不支持 sharp，应明说而不是默默无效");
});

test("style 非法值报错；echo solid 的 import 源随图标包切换", async () => {
	await rejects(() => call("icon", { action: "emit", name: "menu", target: "raw", style: "glow" }), /style/, "未知 style");
	const solid = await call("icon", { action: "emit", name: "home", target: "echo", style: "solid" });
	assert.match(solid.value.code, /from "@tabler\/icons-vue"/, "solid home 是 tabler 填充版，import 源应为 @tabler/icons-vue");
});

test("风格出码都能被 resvg 渲染（不是语法上对、画不出来）", { skip: !CAN_RENDER }, async () => {
	const { createRequire } = await import("node:module");
	const { Resvg } = createRequire(import.meta.url)("../vendor/resvg/index.js");
	for (const style of ["outline", "solid", "duotone", "sharp"]) {
		const { value } = await call("icon", { action: "emit", name: "heart", target: "raw", style, color: "#E4002B" });
		assert.doesNotThrow(() => new Resvg(value.code).render(), `style=${style} 应可渲染`);
	}
});

test("find 结果标注可选版本（filled/duotone），帮助做 active 态", async () => {
	const { value, text } = await call("icon", { action: "find", query: "home", limit: 3 });
	const home = value.results.find((r) => r.name === "home");
	assert.ok(home !== undefined, "应找到 home");
	assert.deepEqual(home.variants, ["filled", "duotone"], `home 应有填充/双色版，实际 ${JSON.stringify(home.variants)}`);
	assert.ok(text.includes("可选 filled/duotone 版"), "物料文本应提示可选版本");
	const filled = await call("icon", { action: "find", query: "heart-filled", limit: 3 });
	assert.ok(filled.value.results[0].variants.includes("outline"), "填充版应反向标注 linear 版");
});

test("确定性: 同一 emit 调用两次 code 逐字节一致", async () => {
	const args = { action: "emit", name: "heart", target: "raw", size: 20, strokeWidth: 1.75, color: "#E4002B" };
	const a = await call("icon", args);
	const b = await call("icon", args);
	assert.equal(a.value.code, b.value.code, "同一输入两次 code 必须一致");
	assert.deepEqual(a.value, b.value, "同一输入两次完整返回值应一致");
	assert.equal(JSON.stringify(emit("heart", "raw", { size: 20 })), JSON.stringify(emit("heart", "raw", { size: 20 })), "底层 emit 也应确定性");
});

/* ------------------------- 九种视觉风格（像素级） ------------------------- */

test("style 枚举：九种风格各自产出不同结构，且都能被 resvg 渲染", { skip: !CAN_RENDER }, async () => {
	const { createRequire } = await import("node:module");
	const { Resvg } = createRequire(import.meta.url)("../vendor/resvg/index.js");
	const seen = new Map();
	for (const style of STYLES_LIST) {
		const { value } = await call("icon", { action: "emit", name: "heart", target: "raw", style, color: "#E4002B" });
		assert.equal(value.style, style, `${style}: 应回填 style`);
		assert.doesNotThrow(() => new Resvg(value.code).render(), `style=${style} 应可渲染`);
		seen.set(style, value.code);
	}
	assert.equal(seen.size, 9, "应有九种风格");
	// 容器型必须带底色块；渐变型必须带 linearGradient
	assert.match(seen.get("badge"), /<rect[^>]*fill="#E4002B"/, "badge 应有圆角底色块");
	assert.match(seen.get("knockout"), /<circle[^>]*fill="#E4002B"/, "knockout 应有正圆底色");
	assert.match(seen.get("gradient"), /<linearGradient/, "gradient 应有渐变定义");
	assert.match(seen.get("duotone"), /fill-opacity/, "duotone 应有半透明填充层");
	// 非容器的纯字形风格之间，字形代码应有差异（hairline/bold/outline 靠 stroke-width 区分）
	assert.notEqual(seen.get("hairline").length, 0);
	assert.match(seen.get("hairline"), /stroke-width="1"/, "hairline 应是 1px");
	assert.match(seen.get("bold"), /stroke-width="2.8"/, "bold 应是 2.8px");
});

test("strokeWidth 必须真的改变渲染（不是只改了字符串属性）", { skip: !CAN_RENDER }, async (t) => {
	const dir = tempDir(t, "icon-stroke-pixel");
	const inkOf = async (name, strokeWidth) => {
		const { value } = await call("icon", { action: "emit", name, target: "raw", strokeWidth, color: "#000000" });
		const file = join(dir, `${name.replace(":", "_")}-${strokeWidth}.png`);
		await renderFile(value.code, file);
		const img = pngOf(file);
		let ink = 0;
		for (let i = 0; i < img.data.length; i += img.channels) if ((img.channels === 4 ? img.data[i + 3] : 255) > 40) ink += 1;
		return ink;
	};
	// tabler 的 path 自带 stroke-width，会覆盖根层设置——这条测的就是「别被覆盖」
	for (const name of ["menu", "tabler:search", "tabler:home"]) {
		const thin = await inkOf(name, 1);
		const thick = await inkOf(name, 4);
		assert.ok(thick / thin > 2, `${name}: 4px 描边墨迹应显著多于 1px（实测 ${thin} → ${thick}，比值 ${(thick / thin).toFixed(2)}）`);
	}
});

test("sharp 必须在直线字形上真的产生差异（butt 端点比 round 短）", { skip: !CAN_RENDER }, async (t) => {
	const dir = tempDir(t, "icon-sharp-pixel");
	const inkOf = async (name, style) => {
		const { value } = await call("icon", { action: "emit", name, target: "raw", style, color: "#000000" });
		const file = join(dir, `${name.replace(":", "_")}-${style}.png`);
		await renderFile(value.code, file);
		const img = pngOf(file);
		let ink = 0;
		for (let i = 0; i < img.data.length; i += img.channels) if ((img.channels === 4 ? img.data[i + 3] : 255) > 40) ink += 1;
		return ink;
	};
	for (const name of ["menu", "x", "tabler:plus"]) {
		const round = await inkOf(name, "outline");
		const butt = await inkOf(name, "sharp");
		assert.ok(butt < round, `${name}: butt 端点墨迹应少于 round（实测 ${round} → ${butt}）`);
	}
});

test("容器型风格：底色用 color，字形反白且缩进安全区", { skip: !CAN_RENDER }, async (t) => {
	const dir = tempDir(t, "icon-chip");
	for (const style of ["badge", "knockout"]) {
		const { value } = await call("icon", { action: "emit", name: "home", target: "raw", style, color: "#0F172A", color2: "#FFE066" });
		assert.match(value.code, /fill="#0F172A"/, `${style}: color 作底色`);
		// 字形色可能落在 fill（填充字形）或 stroke（描边字形）上
		assert.match(value.code, new RegExp(`(fill|stroke)="#FFE066"`), `${style}: color2 作字形色`);
		// container 现在回填「容器形状」（rounded/circle），而不是预设名——
		// 因为 squircle 这类形状没有对应的 style 预设，回填形状名才能覆盖全组合。
		assert.equal(value.container, style === "badge" ? "rounded" : "circle", `${style}: 应回填容器形状`);
		const file = join(dir, `${style}.png`);
		await renderFile(value.code, file, 96);
		const img = pngOf(file);
		// 容器型应是「大面积实心」：不透明像素占比远高于线性图标（后者一般 <30%）。
		// 不能用四角像素判：圆角/圆形本身就让角落透明。
		const ratio = opaqueRatio(img, 200);
		assert.ok(ratio > 0.5, `${style}: 应是实心容器（不透明占比 ${(ratio * 100).toFixed(1)}%，应 >50%）`);
		const box = inkBox(img);
		assert.deepEqual([box.x, box.y], [0, 0], `${style}: 容器应铺满 24 网格`);
	}
});

test("渐变风格：非 hex 颜色回退实色而非产出坏渐变", async () => {
	const hex = await call("icon", { action: "emit", name: "heart", target: "raw", style: "gradient", color: "#E4002B" });
	assert.match(hex.value.code, /<linearGradient/);
	const named = await call("icon", { action: "emit", name: "heart", target: "raw", style: "gradient", color: "red" });
	assert.equal(/<linearGradient/.test(named.value.code), false, "命名色算不出末色，应回退实色描边");
	assert.match(named.value.code, /stroke="red"/, "回退后仍应用用户给的颜色");
});

test("容器/渐变风格在 colibri 与 echo 上必须明说退化（不能默默无效）", async () => {
	for (const style of ["badge", "knockout", "gradient"]) {
		const colibri = await call("icon", { action: "emit", name: "home", target: "colibri", style });
		assert.ok(
			colibri.value.notes.some((n) => n.includes("不可表达") || n.includes("退化")),
			`colibri ${style}: 应提示不可表达`
		);
		assert.equal(colibri.value.code.includes("<rect"), false, `colibri ${style}: 字典 inner 不能含容器`);
		const echo = await call("icon", { action: "emit", name: "home", target: "echo", style });
		assert.ok(echo.value.notes.some((n) => n.includes("退化为 outline")), `echo ${style}: 应提示退化`);
	}
});

/* --------------------- 容器型字形的清晰度（用户反馈：中间图像发糊） --------------------- */

test("容器型：填充字形只能填不能描（又填又描会让字形糊掉）", async () => {
	// home-filled 的 path 自带 fill="currentColor"：外层若再给 stroke，外圈会多糊一层。
	// 实测修复前 24px 下字形糊成色块，修复后房顶/门/齿轮齿都能看清。
	for (const style of ["badge", "knockout"]) {
		const { value } = await call("icon", { action: "emit", name: "home", target: "raw", style, color: "#E4002B", color2: "#FFFFFF" });
		const glyph = value.code.slice(value.code.indexOf("<g transform=\"translate("));
		assert.match(glyph, /fill="#FFFFFF" stroke="none"/, `${style}: 填充字形应是 fill 且 stroke="none"`);
	}
	// 描边字形（无填充双胞胎）反过来：必须有描边、不能填充
	const strokeGlyph = await call("icon", { action: "emit", name: "image", target: "raw", style: "badge", color: "#E4002B", color2: "#FFFFFF" });
	assert.match(strokeGlyph.value.code, /fill="none" stroke="#FFFFFF"/, "描边字形应是 fill=none + stroke");
});

test("容器型：描边宽度必须按 scale 反向补偿（否则 24px 下不到 1 像素）", async () => {
	const { value } = await call("icon", { action: "emit", name: "image", target: "raw", style: "badge", color: "#E4002B" });
	const widths = [...value.code.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]));
	assert.ok(widths.length > 0, "描边字形应有 stroke-width");
	// 视觉上要 1.8 单位，字形缩放 0.52 → 内部描边应约 3.46
	assert.ok(widths.every((w) => w > 2.5), `补偿后描边应 >2.5（实测 ${widths.join(",")}），不补偿就只有 1.8 左右`);
});

test("容器型：字形真的画出实心像素，而不是一片半透明糊", { skip: !CAN_RENDER }, async (t) => {
	const dir = tempDir(t, "icon-chip-clarity");
	for (const style of ["badge", "knockout"]) {
		const { value } = await call("icon", { action: "emit", name: "home", target: "raw", style, color: "#E4002B", color2: "#FFFFFF" });
		const file = join(dir, `${style}-48.png`);
		await renderFile(value.code, file, 48);
		const img = pngOf(file);
		let pure = 0;
		let blend = 0;
		for (let i = 0; i < img.data.length; i += img.channels) {
			if ((img.channels === 4 ? img.data[i + 3] : 255) < 200) continue;
			const r = img.data[i];
			const g = img.data[i + 1];
			const b = img.data[i + 2];
			if (r > 250 && g > 250 && b > 250) pure += 1;
			else if (g >= 20) blend += 1; // 既不是纯白也不是纯红 = 中间过渡色
		}
		// 修复前 pure≈0（全是过渡色块）；修复后 pure 200+
		assert.ok(pure > 120, `${style}: 字形应有 ${">120"} 个纯白像素（实测 ${pure}）——太少说明糊成过渡色`);
		assert.ok(blend / (pure + blend) < 0.35, `${style}: 过渡色像素占比应 <35%（实测 ${((blend / (pure + blend)) * 100).toFixed(1)}%）`);
	}
});
