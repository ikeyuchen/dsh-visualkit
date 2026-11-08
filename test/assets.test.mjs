// test/assets.test.mjs — design_render action=asset（内置素材库）发布前功能测试。
//
// 覆盖：manifest 全库 221 项完整性 / find 检索与稳定性 / inline 剥壳与改色 /
// save 落盘一致性 / 目录穿越安全 / 边界与错误路径 / 全库连续 inline 性能。
// 已知缺陷用 { todo: "BUG: ..." } 记录，不修改 lib/、也不为变绿放宽断言。
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { CAN_RENDER, REPO, call, inkBox, rejects, renderTo, tempDir } from "./helpers.mjs";
import { asset, find, innerOf } from "../lib/assets.js";

const ASSETS_DIR = join(REPO, "data", "assets");
const MANIFEST = JSON.parse(readFileSync(join(ASSETS_DIR, "manifest.json"), "utf8"));
const ITEMS = MANIFEST.items;
const SVG_ITEMS = ITEMS.filter((item) => item.file.endsWith(".svg"));
const PNG_ITEMS = ITEMS.filter((item) => item.file.endsWith(".png"));
const byFile = new Map(ITEMS.map((item) => [item.file, item]));
const byCat = (category) => ITEMS.filter((item) => item.category === category);
const sourceOf = (item) => readFileSync(join(ASSETS_DIR, item.file), "utf8");
const relOf = (rel) => rel.split("\\").join("/");
const absOf = (rel) => join(ASSETS_DIR, relOf(rel));
// package.json 的内容特征串：安全用例用它证明「素材库外的文件内容没被读出来」
const PKG_MARK = '"name": "dsh-visualkit"';
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const skipRender = !CAN_RENDER && "本平台无 resvg 原生绑定（CI ubuntu 作业跳过渲染类用例）";

/* ----------------------------- manifest 全库 ----------------------------- */

test("manifest：221 项逐项文件存在、字段完整、路径不越界、无重复", () => {
	assert.equal(ITEMS.length, 221, "素材库应为 221 项");
	assert.equal(MANIFEST.count, ITEMS.length, "manifest.count 应与 items 数量一致");
	const seen = new Set();
	for (const item of ITEMS) {
		assert.ok(typeof item.file === "string" && item.file.trim() !== "", `file 不能为空：${JSON.stringify(item)}`);
		assert.ok(typeof item.name === "string" && item.name.trim() !== "", `${item.file}: name 不能为空`);
		assert.ok(typeof item.category === "string" && item.category.trim() !== "", `${item.file}: category 不能为空`);
		assert.ok(typeof item.license === "string" && item.license.trim() !== "", `${item.file}: license 不能为空`);
		assert.ok(!item.file.includes("..") && !item.file.startsWith("/") && !/^[A-Za-z]:/.test(item.file), `${item.file}: file 必须是素材库内相对路径`);
		const full = join(ASSETS_DIR, item.file);
		assert.ok(existsSync(full), `${item.file}: manifest 声明了但文件不存在`);
		assert.ok(statSync(full).size > 0, `${item.file}: 空文件`);
		assert.ok(!seen.has(item.file), `${item.file}: file 在 manifest 中重复`);
		seen.add(item.file);
	}
	assert.equal(SVG_ITEMS.length + PNG_ITEMS.length, ITEMS.length, "素材库应只含 svg / png 两类文件");
});

test("全库 svg/png：结构可被浏览器解析的最低保障（根元素、闭合、viewBox、PNG 签名）", () => {
	assert.ok(SVG_ITEMS.length >= 150, `SVG 素材应 ≥150 个，实际 ${SVG_ITEMS.length}`);
	for (const item of SVG_ITEMS) {
		const raw = sourceOf(item);
		assert.ok(raw.includes("<svg"), `${item.file}: 不是 SVG（缺 <svg 根元素）`);
		assert.match(raw, /<\/svg>\s*$/, `${item.file}: SVG 未以 </svg> 闭合`);
		assert.match(raw, /viewBox\s*=\s*"/, `${item.file}: 缺 viewBox（inline 会退回伪造的 0 0 24 24）`);
	}
	assert.equal(PNG_ITEMS.length, 48, "PNG 素材应为 48 个（角色部件/纹理）");
	for (const item of PNG_ITEMS) {
		const head = readFileSync(join(ASSETS_DIR, item.file)).subarray(0, 8);
		assert.deepEqual(head, PNG_SIG, `${item.file}: PNG 签名不匹配`);
	}
});

test("全库完整性抽样：12 个 SVG 能被 resvg 真实渲染出墨迹", { skip: skipRender }, async (t) => {
	const dir = tempDir(t, "asset-render");
	const picks = [
		byCat("品牌图标")[0],
		byCat("品牌图标")[3],
		byCat("图标")[0],
		byCat("图标")[20],
		byCat("图标")[60],
		byCat("图标")[80],
		byCat("图案")[0],
		byCat("图案")[7],
		byCat("贴纸")[0],
		byCat("贴纸")[12],
		byCat("插画")[0],
		byCat("插画")[41]
	];
	assert.ok(picks.length >= 10, "抽样数应 ≥10");
	for (const item of picks) {
		const out = await renderTo(dir, `${item.file.replace(/[\\/]/g, "_")}.png`, absOf(item.file), 96);
		assert.equal(out.width, 96, `${item.file}: 渲染宽度应为 96`);
		assert.ok(out.height > 0, `${item.file}: 渲染高度必须为正`);
		assert.notEqual(inkBox(out.img), null, `${item.file}: 渲染结果全透明（说明 SVG 实际不可渲染）`);
	}
});

/* -------------------------------- find -------------------------------- */

test("find：中文关键词 / 英文 / 分类词均命中，且命中项确实包含关键词", async () => {
	const cases = [
		["品牌", 12],
		["纹理", 3],
		["插画", 42],
		["贴纸", 26],
		["角色", 45],
		["图案", 12],
		["openpeeps", 42],
		["lucide", 10],
		["peep", 42],
		["qq", 2],
		["bell", 2],
		["checker", 1]
	];
	for (const [keyword, expected] of cases) {
		const { value } = await call("design_render", { action: "asset", mode: "find", keyword, limit: 500 });
		assert.equal(value.total, expected, `关键词「${keyword}」的 total 不符`);
		assert.equal(value.items.length, expected, `关键词「${keyword}」的 items 数不符`);
		for (const item of value.items) {
			const haystack = [item.name, item.category, item.desc, item.file].map((field) => String(field).toLowerCase());
			assert.ok(haystack.some((field) => field.includes(keyword.toLowerCase())), `「${keyword}」命中项 ${item.file} 的字段里找不到关键词`);
			assert.ok(existsSync(join(ASSETS_DIR, item.file)), `「${keyword}」返回了不存在的文件 ${item.file}`);
		}
	}
});

test("find：空关键词返回全部（total=221），limit 生效且结果有序", async () => {
	const dflt = await call("design_render", { action: "asset", mode: "find" });
	assert.equal(dflt.value.total, 221, "空关键词 total 应为全库 221 项");
	assert.equal(dflt.value.items.length, 12, "未给 limit 时应使用配置默认 findLimit=12");
	assert.deepEqual(dflt.value.items.map((item) => item.file), ITEMS.slice(0, 12).map((item) => item.file), "空关键词应按 manifest 顺序返回前 12 项");

	const all = await call("design_render", { action: "asset", mode: "find", limit: 500 });
	assert.equal(all.value.items.length, 221, "limit 超过总数时应返回全部 221 项");
	assert.equal(all.value.total, 221, "limit 不应改变 total");

	const one = await call("design_render", { action: "asset", mode: "find", limit: 1 });
	assert.equal(one.value.items.length, 1, "limit=1 应只返回 1 项");
	assert.equal(one.value.total, 221, "limit 不应改变 total");
});

test("find：无结果时 total=0 且工具文本给出换词提示", async () => {
	const { value, text } = await call("design_render", { action: "asset", mode: "find", keyword: "行业根本不存在xyz" });
	assert.equal(value.total, 0, "无结果关键字的 total 应为 0");
	assert.deepEqual(value.items, [], "无结果时 items 应为空数组");
	assert.ok(text.includes("换更宽的关键词"), "无结果时应提示换更宽的关键词");
	assert.ok(text.includes("品牌图标"), "提示里应列出可用的分类词");
});

test("find：同一关键词两次检索结果完全一致（排序稳定）", async () => {
	const first = await call("design_render", { action: "asset", mode: "find", keyword: "peep", limit: 500 });
	const second = await call("design_render", { action: "asset", mode: "find", keyword: "peep", limit: 500 });
	assert.deepEqual(first.value.items.map((item) => item.file), second.value.items.map((item) => item.file), "两次检索顺序不一致");
	assert.equal(first.value.total, second.value.total, "两次检索 total 不一致");
});

test("find：中文同义词能命中（模式/纹样/花纹→图案，底纹→纹理，标志/logo→品牌图标）", async () => {
	const cases = [
		["模式", "图案", 12],
		["纹样", "图案", 12],
		["花纹", "图案", 12],
		["底纹", "纹理", 3],
		["标志", "品牌图标", 12],
		["logo", "品牌图标", 12],
		["avatar", "角色部件", 45],
		["插图", "插画", 42]
	];
	for (const [keyword, category, expected] of cases) {
		const { value } = await call("design_render", { action: "asset", mode: "find", keyword, limit: 500 });
		assert.equal(value.total, expected, `同义词「${keyword}」应命中 ${expected} 项（${category}）`);
		for (const item of value.items) assert.equal(item.category, category, `同义词「${keyword}」命中项 ${item.file} 的类别应为 ${category}`);
	}
});

/* ------------------------------- inline ------------------------------- */

test("inline：剥掉 <svg> 外壳、去掉 title/desc、viewBox 与源文件一致", async (t) => {
	const dir = tempDir(t, "asset-inline");
	const samples = ["icons/brands/qq.svg", "icons/brands/x.svg", "icons/lucide/bell.svg", "patterns/checker.svg", "stickers/twemoji/1f389.svg"];
	for (const rel of samples) {
		const item = byFile.get(rel);
		const raw = sourceOf(item);
		const expectedViewBox = raw.match(/viewBox\s*=\s*"([^"]*)"/i)[1];
		const { value, text } = await call("design_render", { action: "asset", mode: "inline", rel }, { cwd: dir });
		assert.equal(value.viewBox, expectedViewBox, `${rel}: viewBox 应与源文件一致`);
		assert.ok(!value.inner.includes("<svg"), `${rel}: inner 不应包含 <svg 外壳`);
		assert.ok(!value.inner.includes("</svg>"), `${rel}: inner 不应包含 </svg>`);
		assert.ok(!/<(title|desc)\b/i.test(value.inner), `${rel}: inner 应去掉 title/desc（避免重复可达性标签）`);
		assert.equal(value.inner, innerOf(raw).inner, `${rel}: inner 应与源文件剥壳结果逐字符一致`);
		assert.equal(value.name, item.name, `${rel}: 应回带 manifest 的 name`);
		assert.equal(value.license, item.license, `${rel}: 应回带 manifest 的 license`);
		assert.equal(value.truncated, false, `${rel}: 小文件不应标记截断`);
		assert.equal(value.note, undefined, `${rel}: 未截断时不应有截断note`);
		assert.ok(text.includes("asset inline:"), `${rel}: 工具文本应汇报 inline 结果`);
	}
});

test("inline：currentColor 类素材改色（currentColor 全部替换为目标色）", async () => {
	const rel = "icons/lucide/bell.svg";
	const raw = sourceOf(byFile.get(rel));
	assert.ok(raw.includes("currentColor"), "样例素材本身应使用 currentColor（否则用例失效）");
	const value = await asset({ mode: "inline", rel, color: "#E4002B" });
	assert.equal(value.inner.includes("currentColor"), false, "改色后不应残留 currentColor");
	assert.ok(value.inner.includes("#E4002B"), "改色后应包含目标色 #E4002B");
});

test("inline：自身无 fill/stroke 的品牌图标改色要下推到每个图形元素", async () => {
	for (const rel of ["icons/brands/qq.svg", "icons/brands/bilibili.svg"]) {
		const raw = sourceOf(byFile.get(rel));
		assert.ok(!/<(path|circle|rect|ellipse|polygon|polyline)\b[^>]*\bfill\s*=/i.test(raw), `${rel}: 样例本身应无 fill（否则用例失效）`);
		const value = await asset({ mode: "inline", rel, color: "#FF6B35" });
		const shapes = value.inner.match(/<(path|circle|rect|ellipse|polygon|polyline)\b[^>]*>/gi) ?? [];
		assert.ok(shapes.length > 0, `${rel}: 应至少有一个图形元素`);
		for (const shape of shapes) assert.match(shape, /fill="#FF6B35"/, `${rel}: 图形元素漏改色 → ${shape.slice(0, 80)}`);
	}
});

test("inline：color 为空串/纯空白时保持原样（不报错、不改色）", async () => {
	const raw = sourceOf(byFile.get("icons/lucide/bell.svg"));
	for (const color of ["", "   "]) {
		const value = await asset({ mode: "inline", rel: "icons/lucide/bell.svg", color });
		assert.equal(value.inner, innerOf(raw).inner, `color=${JSON.stringify(color)} 时 inner 应保持原样`);
		assert.ok(value.inner.includes("currentColor"), `color=${JSON.stringify(color)} 时不应替换 currentColor`);
	}
});

test("inline：大文件（>20000 字符）截断契约：长度 / 原文前缀 / note / bytes 自洽", async () => {
	const rel = "illustrations/openpeeps/peep-39.svg";
	const raw = sourceOf(byFile.get(rel));
	const fullInner = innerOf(raw).inner;
	assert.ok(fullInner.length > 20000, `样例必须超过 20000 字符阈值（实际 ${fullInner.length}）`);
	const { value, text } = await call("design_render", { action: "asset", mode: "inline", rel });
	assert.equal(value.truncated, true, "超阈值必须标记 truncated=true");
	assert.ok(value.inner.length <= 20000, `截断后 inner 应 ≤20000 字符，实际 ${value.inner.length}`);
	assert.ok(fullInner.startsWith(value.inner), "截断内容必须是原文前缀（不得拼接/篡改）");
	assert.ok(/\/?>$/.test(value.inner.trimEnd()), `必须在标签边界截断（以 /> 或 > 收尾）：实际结尾 ${JSON.stringify(value.inner.slice(-30))}`);
	assert.match(value.note ?? "", /20000/, "note 应说明截断阈值");
	assert.match(value.note ?? "", /mode=save/, "note 应指向 mode=save 取完整文件");
	assert.equal(value.bytes, Buffer.byteLength(raw, "utf8"), "bytes 应是完整文件字节数（供判断真实体积）");
	assert.ok(value.bytes > value.inner.length, "bytes（完整文件）应大于截断后的字符数");
	assert.ok(text.includes("(truncated)"), "工具文本应带 (truncated) 标记");
	assert.ok(text.includes("mode=save"), "工具文本应带 note 的完整文件取法");
});

test("inline 大文件：所有超阈值 SVG 都在完整标签边界截断（长度 / 前缀 / 收尾）", async () => {
	const failures = [];
	const big = [];
	for (const item of SVG_ITEMS) {
		const fullInner = innerOf(sourceOf(item)).inner;
		if (fullInner.length <= 20000) continue;
		big.push(item.file);
		const value = await asset({ mode: "inline", rel: item.file });
		if (value.inner.length > 20000) failures.push(`${item.file}: 超 20000 字符（${value.inner.length}）`);
		else if (!fullInner.startsWith(value.inner)) failures.push(`${item.file}: 不是原文前缀`);
		else if (!/\/?>$/.test(value.inner.trimEnd())) failures.push(`${item.file}: 未在标签边界收尾 → ${JSON.stringify(value.inner.slice(-30))}`);
		else if (value.truncated !== true) failures.push(`${item.file}: 未标记 truncated`);
	}
	assert.ok(big.length >= 40, `超阈值 SVG 应有 ≥40 个，实际 ${big.length}`);
	assert.deepEqual(failures, [], `标签边界截断违约：${failures.slice(0, 3).join(" | ")}`);
});

/* --------------------------------- save -------------------------------- */

test("save：落到会话目录、内容与 inline 改色一致、bytes 等于实际文件大小", async (t) => {
	const dir = tempDir(t, "asset-save");
	const rel = "icons/brands/qq.svg";
	const { value, text } = await call("design_render", { action: "asset", mode: "save", rel, color: "#E4002B", saveTo: "out/deep/qq.svg" }, { cwd: dir });
	const expected = join(dir, "out", "deep", "qq.svg");
	assert.equal(value.mode, "save", "mode 回填");
	assert.equal(value.path, expected, "saveTo 应相对会话目录解析并回填绝对路径");
	assert.ok(existsSync(expected), "文件应真实落盘（含多级目录自动创建）");
	assert.equal(value.bytes, statSync(expected).size, "返回 bytes 应等于文件实际大小");
	const saved = readFileSync(expected, "utf8");
	assert.equal(Buffer.byteLength(saved, "utf8"), value.bytes, "bytes 应与 UTF-8 字节数一致");
	assert.ok(saved.includes("#E4002B"), "落盘内容应已改色");
	const inline = await asset({ mode: "inline", rel, color: "#E4002B" });
	assert.equal(innerOf(saved).inner, inline.inner, "save 内容与 inline 改色结果应一致");
	assert.equal(innerOf(saved).viewBox, inline.viewBox, "save 内容的 viewBox 应与 inline 一致");
	assert.ok(text.includes("asset saved:"), "工具文本应汇报保存结果");

	// 不给 color：保持原色，color 回填 null 且不提示改色
	const plain = await call("design_render", { action: "asset", mode: "save", rel, saveTo: "out/plain.svg" }, { cwd: dir });
	assert.equal(plain.value.color, null, "未给 color 时 color 应为 null");
	assert.ok(!plain.text.includes("改色"), "未给 color 时不应提示改色");
});

/* ------------------------------ 安全（真测） ------------------------------ */

test("安全：rel 目录穿越/绝对路径/URL 编码变体全部拒绝，且不泄漏素材库外文件", async (t) => {
	const dir = tempDir(t, "asset-security");
	assert.ok(readFileSync(join(REPO, "package.json"), "utf8").includes(PKG_MARK), "特征串应存在于 package.json（否则用例失效）");
	const attacks = [
		"../../../package.json",
		"../../package.json",
		"/etc/passwd",
		"C:/Windows/win.ini",
		"..\\..\\x.svg",
		"%2e%2e%2f%2e%2e%2fpackage.json",
		"..%2f..%2fpackage.json",
		"icons/../../../../package.json",
		"..\\..\\dsh-visualkit\\package.json"
	];
	for (const rel of attacks) {
		const error = await rejects(
			() => call("design_render", { action: "asset", mode: "inline", rel }, { cwd: dir }),
			/路径越界|素材不存在|rel is required/,
			`穿越攻击 ${JSON.stringify(rel)}`
		);
		assert.ok(!String(error?.message ?? "").includes(PKG_MARK), `${JSON.stringify(rel)}: 错误信息泄漏了 package.json 内容`);
	}
	// save 同样先校验 rel，穿越时不得写出文件
	await rejects(
		() => call("design_render", { action: "asset", mode: "save", rel: "../../../package.json", saveTo: "leak.svg" }, { cwd: dir }),
		/路径越界|素材不存在/,
		"save 穿越"
	);
	assert.ok(!existsSync(join(dir, "leak.svg")), "穿越的 save 不应落盘任何文件");
});

/* ------------------------------- 边界 -------------------------------- */

test("边界：mode 非法 / rel 是目录 / rel 缺失 / saveTo 缺失都要明确报错", async (t) => {
	const dir = tempDir(t, "asset-boundary");
	await rejects(() => call("design_render", { action: "asset", mode: "nope", rel: "icons/brands/qq.svg" }, { cwd: dir }), /invalid arguments|unknown mode/, "非法 mode");
	await rejects(() => call("design_render", { action: "asset", mode: "inline" }, { cwd: dir }), /invalid arguments|rel is required/, "inline 缺 rel");
	await rejects(() => call("design_render", { action: "asset", mode: "inline", rel: "icons" }, { cwd: dir }), /是一个目录|EISDIR|素材不存在/, "rel 指向目录");
	await rejects(() => call("design_render", { action: "asset", mode: "inline", rel: "   " }, { cwd: dir }), /rel is required/, "rel 只有空白");
	await rejects(() => call("design_render", { action: "asset", mode: "save", rel: "icons/brands/qq.svg" }, { cwd: dir }), /saveTo/, "save 缺 saveTo");
	await rejects(() => call("design_render", { action: "asset", mode: "save", rel: "icons/brands/qq.svg", saveTo: "" }, { cwd: dir }), /saveTo/, "saveTo 为空串");
});

test("边界：find 的 keyword 传非字符串不崩（工具层明确拒绝，lib 层兜底）", async () => {
	for (const keyword of [123, ["a", "b"], {}]) {
		await rejects(() => call("design_render", { action: "asset", mode: "find", keyword }), /invalid arguments|keyword|must be a string/, `keyword=${JSON.stringify(keyword)}`);
	}
	// lib 层用 String() 兜底，不抛异常
	const numeric = await find(123, 10);
	assert.equal(numeric.total, 0, "数字 keyword 兜底后应返回 0 结果而不是崩溃");
	const arrayed = await find(["qq"], 10);
	assert.ok(arrayed.total > 0, "数组 keyword 兜底为字符串后应能命中");
	const empty = await find(undefined, 5);
	assert.equal(empty.total, 221, "undefined keyword 应等价空关键词返回全部");
	assert.equal(empty.items.length, 5, "limit 生效");
});

/* ------------------------------ 稳定性/性能 ------------------------------ */

test("稳定性：173 项 SVG 连续 inline 全部成功、48 项非 SVG 明确拒绝、总耗时 <20s", async () => {
	const started = Date.now();
	const svgFailures = [];
	const badAccept = [];
	let svgOk = 0;
	let rejected = 0;
	for (const item of ITEMS) {
		if (item.file.endsWith(".svg")) {
			let value;
			try {
				value = await asset({ mode: "inline", rel: item.file });
			} catch (error) {
				svgFailures.push(`${item.file}: 抛错 ${error?.message ?? error}`);
				continue;
			}
			svgOk += 1;
			if (value.mode !== "inline") svgFailures.push(`${item.file}: mode 回填错误`);
			if (typeof value.truncated !== "boolean") svgFailures.push(`${item.file}: truncated 不是布尔值`);
			if (value.inner.includes("<svg")) svgFailures.push(`${item.file}: inner 残留 <svg 外壳`);
			if (value.inner.trim() === "") svgFailures.push(`${item.file}: inner 为空`);
			if (value.inner.length > 20000) svgFailures.push(`${item.file}: inner 超 20000 字符（${value.inner.length}）`);
		} else {
			try {
				await asset({ mode: "inline", rel: item.file });
				badAccept.push(item.file);
			} catch (error) {
				if (/不是 SVG/.test(String(error?.message ?? ""))) rejected += 1;
				else svgFailures.push(`${item.file}: 非 SVG 拒绝信息不对 → ${error?.message}`);
			}
		}
	}
	assert.deepEqual(svgFailures, [], `SVG inline 出现异常：${svgFailures.slice(0, 5).join(" | ")}`);
	assert.deepEqual(badAccept, [], "非 SVG（png）素材不应被 inline 接受");
	assert.equal(svgOk, 173, "SVG 成功数应为 173");
	assert.equal(rejected, 48, "非 SVG 拒绝数应为 48");
	const elapsed = Date.now() - started;
	assert.ok(elapsed < 20000, `221 项 inline 耗时 ${elapsed}ms，超过 20s 上限`);
});

/* ------------------------------- 安全/边界回归 ------------------------------- */

test("color 白名单：注入串必须报错，合法颜色与空值正常工作", async (t) => {
	const dir = tempDir(t, "asset-color");
	const injection = 'red"/><script>alert(1)</script>';
	await rejects(() => call("design_render", { action: "asset", mode: "inline", rel: "icons/lucide/bell.svg", color: injection }, { cwd: dir }), /color 含不允许的字符/, "inline 应拒绝注入颜色");
	await rejects(() => call("design_render", { action: "asset", mode: "save", rel: "icons/lucide/bell.svg", color: injection, saveTo: "evil.svg" }, { cwd: dir }), /color 含不允许的字符/, "save 应拒绝注入颜色");
	assert.ok(!existsSync(join(dir, "evil.svg")), "非法 color 不应落盘任何文件");
	for (const color of ["#FF6B35", "#abc", "rgb(1,2,3)", "var(--c-accent)"]) {
		const value = await asset({ mode: "inline", rel: "icons/lucide/bell.svg", color });
		assert.ok(value.inner.includes(color), `合法颜色 ${color} 应被写入 inner`);
		assert.ok(!value.inner.includes("<script"), `合法颜色 ${color} 不应产生任何标签`);
	}
});

test("inline/save 拒绝非 SVG 素材（48 个 png 不再返回二进制乱码）", async (t) => {
	const dir = tempDir(t, "asset-nonsvg");
	for (const rel of ["textures/grain-dark.png", "parts/↓投影.png"]) {
		for (const mode of ["inline", "save"]) {
			await rejects(
				() => call("design_render", { action: "asset", mode, rel, saveTo: "x.svg" }, { cwd: dir }),
				/不是 SVG.*位图/,
				`${mode} 应拒绝非 SVG：${rel}`
			);
		}
	}
	assert.ok(!existsSync(join(dir, "x.svg")), "非 SVG 不应被落盘");
});
