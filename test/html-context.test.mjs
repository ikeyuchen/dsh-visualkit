// test/html-context.test.mjs — HTML 上下文分类与安全改写（html_edit 的底层）。
//
// 这条能力的由来是两次真实翻车（2026-11-08，给 Colibri / 旧版 0.5.4 做机械改造时）：
//   ① emoji 在属性值里被换成 `<svg>` → 整段标记当文本显示在页面上；
//   ② 属性值的结束引号被换成全角 → 属性撑破，后半页错位。
// 所以这里的断言全部围绕「位置」：能不能改、改了会不会翻车。
import assert from "node:assert/strict";
import { test } from "node:test";

import { KIND, kindAt, locate, locateClass, rewriteByContext, scanHtml } from "../lib/html-context.js";

const SRC =
	'<div title="搜索 🔍 内容" data-a="a > b" data-c=\'x>y\'>正文 🔍 一段</div>' +
	'<script>const x = "🔍";</script>' +
	'<style>.a::before{content:"🔍"}</style>' +
	'<!-- 🔍 注释 -->' +
	'<input placeholder="找点东西">';

test("分类：同一个字符出现在属性/文本/脚本/样式/注释里，各自归类正确", () => {
	const { counts, total } = locate(SRC, "🔍");
	assert.equal(total, 5);
	assert.equal(counts["attrValue:title"], 1, `属性值应单独归类，实际 ${JSON.stringify(counts)}`);
	assert.equal(counts.text, 1);
	assert.equal(counts.script, 1);
	assert.equal(counts.style, 1);
	assert.equal(counts.comment, 1);
});

test("分类：属性值里的 > 不能把标签截断（data-a=\"a > b\"）", () => {
	const segments = scanHtml(SRC);
	const idx = SRC.indexOf("正文 🔍");
	assert.equal(kindAt(segments, idx).kind, KIND.TEXT, "`>` 在属性里时，后面的正文仍应被认成文本节点");
	const title = SRC.indexOf("搜索");
	assert.equal(kindAt(segments, title).kind, KIND.ATTR_VALUE);
	assert.equal(kindAt(segments, title).attr, "title", "命中要能说出是哪个属性");
});

test("改写：scope=text 只动文本节点，属性/脚本/样式/注释一处都不碰", () => {
	const r = rewriteByContext({ source: SRC, find: "🔍", replace: "<svg/>", scope: "text" });
	assert.equal(r.changes.length, 1);
	assert.equal(r.changes[0].kind, KIND.TEXT);
	assert.equal(r.refused.length, 4);
	assert.ok(r.output.includes("正文 <svg/> 一段"), "文本节点里应真的写入标记");
	assert.ok(r.output.includes('title="搜索 🔍 内容"'), "属性值必须原样保留");
	assert.ok(r.output.includes('data-a="a > b"'), "含 > 的属性值必须原样保留");
});

test("改写：往属性里注入标记会被拒绝（那一定会被当文本显示）", () => {
	const r = rewriteByContext({ source: SRC, find: "🔍", replace: "<svg/>", scope: "text+attr" });
	const attrRefusal = r.refused.find((x) => x.kind === KIND.ATTR_VALUE);
	assert.ok(attrRefusal !== undefined, "属性值里放含 <> 的内容必须被拒绝");
	assert.match(attrRefusal.reason, /文本显示/);
	// 换成不带标记的内容则允许
	const ok = rewriteByContext({ source: SRC, find: "🔍", replace: "★", scope: "text+attr" });
	assert.equal(ok.changes.filter((c) => c.kind === KIND.ATTR_VALUE).length, 1);
	assert.ok(ok.output.includes('title="搜索 ★ 内容"'));
});

test("改写：scope=all 仍不碰注释（注释不渲染，改了没意义还会污染 diff）", () => {
	const r = rewriteByContext({ source: SRC, find: "🔍", replace: "★", scope: "all" });
	assert.equal(r.refused.filter((x) => x.kind === KIND.COMMENT).length, 1);
	assert.ok(r.output.includes("<!-- 🔍 注释 -->"));
});

test("改写：多次命中不会互相污染偏移（从后往前替换）", () => {
	const src = "<p>🔍🔍🔍</p>";
	const r = rewriteByContext({ source: src, find: "🔍", replace: "★" });
	assert.equal(r.changes.length, 3);
	assert.equal(r.output, "<p>★★★</p>");
});

test("批量 pairs：一次过改多个词，且各自受上下文约束", () => {
	const src = '<p>甲 乙</p><span title="甲 乙"></span><script>var a="甲";</script>';
	const r = rewriteByContext({
		source: src,
		pairs: [
			{ find: "甲", replace: "<i>A</i>" },
			{ find: "乙", replace: "B" }
		],
		scope: "text"
	});
	assert.equal(r.changes.length, 2, "文本节点里两个词都应被改");
	assert.ok(r.output.includes("<p><i>A</i> B</p>"));
	assert.ok(r.output.includes('title="甲 乙"'), "属性值不动");
	assert.ok(r.output.includes('var a="甲"'), "脚本不动");
});

test("批量 pairs：长串优先，不会把 abc 里的 ab 先换掉", () => {
	const r = rewriteByContext({ source: "<p>abc ab</p>", pairs: [{ find: "ab", replace: "X" }, { find: "abc", replace: "Y" }] });
	assert.equal(r.output, "<p>Y X</p>");
});

test("映射为空≠删除：strict 下拒绝并报出 unmapped，不静默抹掉", () => {
	// 实测教训（现代化改造 v1）：映射表漏了几个 emoji，脚本把“查不到图标”当成空串，
	// 结果那几行图标被默默删掉，渲染图里只剩文字——不报错、不提示。
	const src = "<p>甲 乙</p>";
	const r = rewriteByContext({ source: src, pairs: [{ find: "甲", replace: "A" }, { find: "乙", replace: "" }] });
	assert.equal(r.output, "<p>A 乙</p>", "映射为空的项必须原样保留");
	assert.equal(r.changes.length, 1);
	assert.equal(r.unmapped.includes("乙"), true, "要能报出哪一项没配映射");
	assert.match(r.refused[0].reason, /映射为空/);
});

test("显式删除：replace=null 才真删；strict=false 时旧行为保留", () => {
	const del = rewriteByContext({ source: "<p>甲 乙</p>", pairs: [{ find: "甲", replace: null }] });
	assert.equal(del.output, "<p> 乙</p>");
	assert.equal(del.changes[0].to, "", "删除也是一次改动");
	assert.equal(del.unmapped.length, 0, "显式删除不算未映射");

	const loose = rewriteByContext({ source: "<p>甲 乙</p>", pairs: [{ find: "乙", replace: "" }], strict: false });
	assert.equal(loose.output, "<p>甲 </p>", "strict=false 时才允许空串当删除");
});

test("整类扫描：按字符×上下文分组，并标出“换了也没用”的那些", () => {
	const src = '<p>🔍 搜索</p><span title="🔍"></span><script>var a="🔥";</script><!-- ⭐ -->';
	const r = locateClass(src, "emoji");
	assert.equal(r.total, 4, `应扫到 4 处，实际 ${r.total}`);
	const byChar = new Map(r.chars.map((c) => [c.char, c]));
	assert.equal(byChar.get("🔍").counts.text, 1, "文本节点里的 emoji 可换标记");
	assert.equal(byChar.get("🔍").counts["attrValue:title"], 1);
	assert.deepEqual(r.unconvertible.map((c) => c.char).sort(), ["⭐", "🔥"].sort(), "只出现在脚本/注释里的应被标出");
});

test("整类扫描：直引号能分出手写正文与属性值；未知类别响亮报错", () => {
	const src = '<p>他说"好"</p><i title="x"></i>';
	const r = locateClass(src, "straight-quote");
	const quote = r.chars.find((c) => c.char === '"');
	assert.equal(quote.counts.text, 2, "中文行文里的两个直引号应在文本节点");
	assert.throws(() => locateClass(src, "nope"), /未知的 class/);
});

test("确定性：同一输入两次结果完全一致；replace 函数式替换也支持", () => {
	const a = rewriteByContext({ source: SRC, find: "🔍", replace: "★", scope: "all" });
	const b = rewriteByContext({ source: SRC, find: "🔍", replace: "★", scope: "all" });
	assert.equal(a.output, b.output);
	const fn = rewriteByContext({ source: "<p>ab</p>", find: /a|b/g, replace: (m) => m.toUpperCase() });
	assert.equal(fn.output, "<p>AB</p>");
});

test("边界：没有命中、空 find、自闭合标签、未闭合标签都不抛错", () => {
	assert.equal(rewriteByContext({ source: SRC, find: "不存在的词", replace: "x" }).changes.length, 0);
	assert.throws(() => rewriteByContext({ source: SRC, find: "", replace: "x" }), /需要 find/);
	assert.equal(rewriteByContext({ source: "<img alt=\"🔍\"/>", find: "🔍", replace: "<svg/>" }).refused.length, 1);
	assert.doesNotThrow(() => scanHtml("<div><p>未闭合"));
});
