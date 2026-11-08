// test/morph.test.mjs — morph 工具（check / preview）与底层 svg / preview / morphcore 契约。
//
// 重点是「接线前先修复」这个产品承诺：不可形变的 SVG 必须能被体检出来，
// 而且预览页必须自包含、确定性、能落盘到会话目录。
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call, rejects, tempDir, writeTree } from "./helpers.mjs";
import { adaptersWarmup } from "../lib/morphcore.js";
import { checkIcon } from "../lib/svg.js";

// 等引擎层就绪：checkIcon 的 engine 判定才是真实行为（未就绪时该字段缺省）
await adaptersWarmup;

const SVG = (inner, viewBox = "0 0 24 24") =>
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="2">${inner}</svg>`;
const OK_PATH = SVG('<path d="M4 4h16"/>');
const OK_CIRCLE = SVG('<circle cx="12" cy="12" r="9"/>');
const G_WRAPPED = SVG('<g><path d="M4 4h16"/></g>');
const TRANSFORMED = SVG('<path d="M4 4h16" transform="scale(2)"/>');
const NESTED_MULTI_VB = SVG('<svg viewBox="0 0 10 10"><path d="M1 1h8"/></svg>');
const OFF_GRID = SVG('<rect x="4" y="4" width="40" height="40"/>', "0 0 48 48");

/* -------------------------------- check -------------------------------- */

test("check: 1 个与 2 个合法图标都判为可形变", async () => {
	const one = await call("morph", { action: "check", icons: ["menu"] });
	assert.equal(one.value.ok, true, "单个合法图标应 ok:true");
	assert.equal(one.value.checked.length, 1, "应回显 1 个图标的结果");
	const item = one.value.checked[0];
	assert.equal(item.name, "menu", "名字应解析为 kebab 主名");
	assert.equal(item.parsed, true, "合法图标应 parsed:true");
	assert.match(item.shapes, /path/, "shapes 应描述几何构成");
	assert.match(one.text, /\[OK\] compatible/, "文本应给出兼容结论（纯文本标记，不用 emoji）");

	const two = await call("morph", { action: "check", icons: ["menu", "x"] });
	assert.equal(two.value.ok, true, "两个合法图标应 ok:true");
	assert.match(two.value.pairNote, /均可形变/, "成对体检应说明节点数差异不影响");
	assert.match(two.text, /两个图标均可形变/);
	if (two.value.checked[0].engine !== undefined) assert.equal(two.value.checked[0].engine.accepted, true, "引擎层应接受 lucide 图标");
});

test("check: file 输入按会话目录解析（相对路径 + cwd）", async (t) => {
	const dir = tempDir(t, "morph-file");
	writeTree(dir, { "svg/ok.svg": OK_PATH, "svg/g.svg": G_WRAPPED });
	const ok = await call("morph", { action: "check", file: "svg/ok.svg" }, { cwd: dir });
	assert.equal(ok.value.ok, true, "合法 SVG 文件应 ok:true");
	assert.equal(ok.value.checked[0].name, "svg/ok.svg", "name 应回显传入的相对路径");
	assert.equal(ok.value.checked[0].parsed, true);
	const bad = await call("morph", { action: "check", file: "svg/g.svg" }, { cwd: dir });
	assert.equal(bad.value.ok, false, "含 <g> 的文件应 ok:false");
	assert.equal(bad.value.checked[0].parsed, false);
	assert.ok(bad.value.checked[0].issues.some((s) => s.includes("<g>")), "issue 应点明 <g> 分组问题");
});

test("check: icons / file 互斥与数量校验", async () => {
	await rejects(() => call("morph", { action: "check" }), /pass one of icons \/ file/, "缺输入");
	await rejects(() => call("morph", { action: "check", icons: [] }), /pass one of icons \/ file/, "空数组");
	await rejects(() => call("morph", { action: "check", icons: ["menu", "x", "play"] }), /1–2/, "超过 2 个");
	await rejects(() => call("morph", { action: "check", icons: ["menu"], file: "a.svg" }), /mutually exclusive/, "同时给 icons/file");
	const unknown = await call("morph", { action: "check", icons: ["no-such-icon-xyz"] });
	assert.equal(unknown.value.ok, false, "未知名字应判不可形变而不是抛");
	assert.equal(unknown.value.checked[0].parsed, false);
	assert.match(unknown.value.checked[0].issues[0], /unknown lucide icon name "no-such-icon-xyz"/, "issue 应带名字");
});

test("check: 残缺 / <g> / transform / 多 viewBox 的 SVG 给 parsed:false 与可行动 issue", async (t) => {
	const dir = tempDir(t, "morph-bad-svg");
	writeTree(dir, { "broken.svg": "<svg", "g.svg": G_WRAPPED, "transform.svg": TRANSFORMED, "nested.svg": NESTED_MULTI_VB });
	const cases = [
		["broken.svg", /未识别元素|empty/],
		["g.svg", /<g>/],
		["transform.svg", /transform/],
		["nested.svg", /<svg>/]
	];
	const texts = [];
	for (const [file, pattern] of cases) {
		const { value, text } = await call("morph", { action: "check", file }, { cwd: dir });
		const item = value.checked[0];
		assert.equal(item.parsed, false, `${file} 不应被解析成可形变节点`);
		assert.equal(value.ok, false, `${file} 应判 ok:false`);
		assert.ok(item.issues.length > 0 && item.issues.every((s) => typeof s === "string" && s.length > 5), `${file} 的 issues 应可行动`);
		assert.match(item.issues.join("；"), pattern, `${file} 的 issue 应点明原因`);
		texts.push(text);
	}
	assert.ok(texts.every((text) => text.includes("[FAIL] incompatible")), "体检文本应统一给出 [FAIL] incompatible（纯文本标记，不用 emoji）");
});

test("check: 不可形变输入必须 ok:false（g / transform / 多 viewBox）", async () => {
	for (const svg of [G_WRAPPED, TRANSFORMED, NESTED_MULTI_VB]) {
		const check = checkIcon(svg);
		assert.equal(check.ok, false, `不可形变输入应 ok:false（${JSON.stringify(check.issues)}）`);
		assert.equal(check.parsed, false, "不可形变输入不应被解析成节点");
		assert.ok(check.issues.length > 0, "不可形变输入必须给出 issue");
	}
});

/* -------------------------------- preview ------------------------------- */

test("preview: 名字对名字 → HTML 落盘、大小合理、返回元信息", async (t) => {
	const dir = tempDir(t, "morph-preview");
	const { value, text } = await call("morph", { action: "preview", from: "menu", to: "x", outPath: "preview/menu-x.html" }, { cwd: dir });
	const file = join(dir, "preview", "menu-x.html");
	assert.equal(value.path, file, "相对 outPath 应落在会话目录");
	assert.ok(existsSync(file), "HTML 必须真的落盘");
	assert.deepEqual([value.from.name, value.to.name], ["menu", "x"]);
	assert.equal(value.file, "menu-x.html", "file 应是 basename");
	const bytes = readFileSync(file).length;
	assert.equal(value.sizeBytes, bytes, "sizeBytes 应等于实际字节数");
	assert.ok(bytes > 60_000 && bytes < 500_000, `自包含页面应在合理大小区间（实测 ${bytes} 字节）`);
	assert.match(text, /morph \(preview\)/);
});

test("preview: 自包含（无外链 / 无本地绝对路径）且含版本与标题", async (t) => {
	const dir = tempDir(t, "morph-selfcontained");
	const { value } = await call("morph", { action: "preview", from: "menu", to: "x", outPath: "a.html" }, { cwd: dir });
	const html = readFileSync(join(dir, "a.html"), "utf8");
	// 外链判定：只禁止会发起网络/文件请求的引用，不禁止 vendor 版权注释里的 morphicons.com 文字
	assert.doesNotMatch(html, /<script[^>]+\bsrc=/i, "不得外链脚本");
	assert.doesNotMatch(html, /<link\b/i, "不得外链样式");
	assert.doesNotMatch(html, /\bsrc\s*=\s*["']https?:/i, "不得引用网络资源");
	assert.doesNotMatch(html, /\bhref\s*=\s*["']https?:/i, "不得引用网络链接");
	assert.doesNotMatch(html, /url\(\s*["']?https?:/i, "CSS 不得 url() 外链");
	assert.doesNotMatch(html, /file:\/\//i, "不得引用 file:// 本地文件");
	assert.doesNotMatch(html, /(?<![A-Za-z])[A-Za-z]:[\\/]/, "不得出现本地绝对路径");
	assert.match(html, /morphicons v2\.0\.2/, "应含 vendored morphicons 版本串");
	assert.match(html, /<title>[^<]*menu ⇄ x<\/title>/, "标题应含两个图标名");
	assert.match(html, /<h1>[^<]*menu ⇄ x/, "h1 应含两个图标名");
	// 字面 https:// 豁免：vendor 版权注释里的归属链接不是资源引用
	const urls = html.match(/https?:\/\/[^\s"'<>）)]+/g) ?? [];
	assert.deepEqual(urls, ["https://www.morphicons.com/"], "除 vendor 版权归属链接外，不得出现任何 http(s) URL");
	assert.ok(value.sizeBytes > 0, "sizeBytes 应大于 0");
});

test("preview: SVG 标记对标记 / 混合输入可用；非法 SVG 与未知名字报错清晰", async (t) => {
	const dir = tempDir(t, "morph-preview-svg");
	const fromMarkup = SVG('<path d="M4 12h16"/>');
	const mm = await call("morph", { action: "preview", from: fromMarkup, to: OK_CIRCLE, outPath: "mm.html" }, { cwd: dir });
	assert.deepEqual([mm.value.from.name, mm.value.to.name], ["custom-svg", "custom-svg"], "标记输入应命名为 custom-svg");
	const mmHtml = readFileSync(join(dir, "mm.html"), "utf8");
	assert.match(mmHtml, /<title>[^<]*custom-svg[^<]*⇄[^<]*custom-svg/, "标记输入的标题也应含两端名字");
	assert.ok(mmHtml.includes('d="M4 12h16"'), "端点几何应原样内嵌（不得因解析丢形状）");

	const mixed = await call("morph", { action: "preview", from: "menu", to: OK_CIRCLE, outPath: "mixed.html" }, { cwd: dir });
	assert.deepEqual([mixed.value.from.name, mixed.value.to.name], ["menu", "custom-svg"], "混合输入两端命名应各自正确");

	await rejects(() => call("morph", { action: "preview", from: "no-such-icon-xyz", to: "menu" }), /unknown lucide icon/, "未知名字应报错带名字");
	await rejects(() => call("morph", { action: "preview", from: G_WRAPPED, to: "menu" }), /未通过 morph 兼容体检/, "不可形变 SVG 应在接线前拒绝");
	await rejects(() => call("morph", { action: "preview", from: "menu" }), /requires from and to/, "缺 to 参数应报错");
});

test("preview: 同一输入两次产出字节一致（确定性）", async (t) => {
	const dir = tempDir(t, "morph-deterministic");
	const base = { action: "preview", from: "play", to: "pause", spring: "bouncy" };
	const a = await call("morph", { ...base, outPath: "a.html" }, { cwd: dir });
	const b = await call("morph", { ...base, outPath: "b.html" }, { cwd: dir });
	assert.equal(a.value.sizeBytes, b.value.sizeBytes, "两次 sizeBytes 应一致");
	assert.equal(readFileSync(join(dir, "a.html"), "utf8"), readFileSync(join(dir, "b.html"), "utf8"), "两次产物应逐字节一致");
});

test("preview: spring 三种 preset 生效；非法 spring 被拒", async (t) => {
	const dir = tempDir(t, "morph-spring");
	for (const spring of ["snappy", "smooth", "bouncy"]) {
		const { value } = await call("morph", { action: "preview", from: "menu", to: "x", spring, outPath: `${spring}.html` }, { cwd: dir });
		assert.equal(value.spring, spring, `${spring} 应原样回显`);
		const html = readFileSync(join(dir, `${spring}.html`), "utf8");
		assert.match(html, new RegExp(`spring=${spring} ·`), `${spring} 应写进页面元信息`);
	}
	await rejects(() => call("morph", { action: "preview", from: "menu", to: "x", spring: "weird" }), /"spring" must be one of/, "非法 spring 应被 schema 挡住");
});

test("preview: ≥10 对真实 lucide 图标全部可生成（不崩）", async (t) => {
	const dir = tempDir(t, "morph-pairs");
	const pairs = [
		["menu", "x"],
		["play", "pause"],
		["sun", "moon"],
		["plus", "minus"],
		["chevron-down", "chevron-up"],
		["arrow-left", "arrow-right"],
		["lock", "unlock"],
		["eye", "eye-off"],
		["volume-2", "volume-x"],
		["heart", "star"],
		["bell", "bell-off"],
		["user", "users"]
	];
	const failures = [];
	for (const [from, to] of pairs) {
		try {
			const { value } = await call("morph", { action: "preview", from, to, outPath: `${from}-${to}.html` }, { cwd: dir });
			if (!(value.sizeBytes > 60_000)) failures.push(`${from}⇄${to}: size ${value.sizeBytes}`);
		} catch (error) {
			failures.push(`${from}⇄${to}: ${error.message}`);
		}
	}
	assert.ok(pairs.length >= 10, "抽样对数应 ≥10");
	assert.deepEqual(failures, [], `预览生成失败：${failures.join("；")}`);
});

/* ------------------------- 产品承诺与参数接线 ------------------------- */

test("check: 非 24 网格应判 ok:false（接线前先修复），preview 自动归一化", async (t) => {
	const dir = tempDir(t, "morph-offgrid");
	writeTree(dir, { "grid48.svg": OFF_GRID });
	const { value } = await call("morph", { action: "check", file: "grid48.svg" }, { cwd: dir });
	const item = value.checked[0];
	assert.equal(item.ok, false, `非 24 网格应判不可接线（实际 ok=${item.ok}）`);
	assert.ok(item.issues.some((s) => s.includes("24")), `issues 应说明 24 网格要求：${JSON.stringify(item.issues)}`);

	await call("morph", { action: "preview", from: OFF_GRID, to: "menu", outPath: "grid.html" }, { cwd: dir });
	const html = readFileSync(join(dir, "grid.html"), "utf8");
	// 48 网格的 rect 若原样进来会被 24 viewBox 裁切；归一化后应变成 24 网格的 path
	assert.equal(html.includes("<rect"), false, "preview 应把非 24 网格归一化（不应原样嵌入 40 单位几何）");
});

test("check: 标准 24 网格不得谎报「已 re-grid」", async () => {
	const { value } = await call("morph", { action: "check", icons: ["menu", "x"] });
	for (const item of value.checked) {
		assert.equal(item.engine?.accepted, true, "标准图标引擎应接受");
		assert.equal(item.engine?.regridded, undefined, `标准 24 网格图标不应报 re-grid（实际 ${JSON.stringify(item.engine)}）`);
	}
});

test("preview: file 输入组合（.svg 路径）", async (t) => {
	const dir = tempDir(t, "morph-preview-file");
	writeTree(dir, { "a.svg": OK_PATH, "b.svg": OK_CIRCLE });
	const { value } = await call("morph", { action: "preview", from: "a.svg", to: "b.svg", outPath: "file.html" }, { cwd: dir });
	assert.equal(value.from.name, "a.svg", ".svg 路径应被当作文件解析（实际抛 unknown lucide icon）");
});

test("preview: size 参数应写入舞台尺寸", async (t) => {
	const dir = tempDir(t, "morph-size");
	await call("morph", { action: "preview", from: "menu", to: "x", size: 44, outPath: "s.html" }, { cwd: dir });
	const html = readFileSync(join(dir, "s.html"), "utf8");
	assert.match(html, /<svg id="stage"[^>]*width="44" height="44"/, "size=44 应写入舞台 width/height（实际仍是 120）");
});
