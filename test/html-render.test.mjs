/**
 * test/html-render.test.mjs — HTML → PNG（可选依赖本机浏览器）。
 *
 * 这条能力的价值：很多软件的 UI 本身就是 web 版，不能渲染 HTML 就等于看不到
 * 自己的输出。实测：参照稿静态体检全绿之后，一渲染就看出头像权重、行高、
 * 字号全线偏大——这些静态规则抓不到。
 *
 * 没有浏览器的机器上自动 skip（而不是失败）：这是可选能力，不装也能用其他 4 个工具。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { call, tempDir } from "./helpers.mjs";
import { findBrowser, missingBrowserError, renderHtml } from "../lib/render-html.js";

const browser = findBrowser();
const skip = browser === null ? "本机没装 Chromium 系浏览器（可选能力）" : false;

const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{margin:0;font:400 14px/1.5 "Microsoft YaHei",sans-serif;background:#F6F7F9}
  .box{width:200px;height:80px;margin:20px;background:#FB7299;border-radius:8px}
</style></head><body><div class="box"></div><p>中英混排 test 123</p></body></html>`;

test("html 渲染：探测不到浏览器时必须报错并给下一步（不静默假渲染）", () => {
	const err = missingBrowserError();
	assert.match(err.message, /Edge|Chrome|Chromium/);
	assert.match(err.message, /browserPath/);
	assert.match(err.message, /action=render/);
	const scratch = mkdtempSync(join(tmpdir(), "dsh-no-browser-"));
	assert.throws(
		() => renderHtml({ html: PAGE, out: join(scratch, "x.png"), browserPath: join(scratch, "nope.exe") }),
		// 指定一个必然不存在的浏览器路径 → 必须抛错
		/没有找到可用于渲染 HTML 的浏览器/
	);
});

test("html 渲染：内联 HTML → PNG，尺寸与像素比正确", { skip }, async (t) => {
	const dir = tempDir(t, "html-inline");
	const out = resolve(dir, "page.png");
	const r = renderHtml({ html: PAGE, out, width: 400, height: 200, scale: 1 });
	assert.ok(existsSync(out), "应产出 PNG");
	assert.ok(r.bytes > 500, `PNG 太小（${r.bytes} B）`);
	assert.equal(r.scale, 1);
	assert.equal(r.width, 400);
	// 1× → 400×200；2× → 800×400
	const r2 = renderHtml({ html: PAGE, out: resolve(dir, "page2x.png"), width: 400, height: 200, scale: 2 });
	assert.ok(r2.bytes > r.bytes, "2× 的字节数应明显更大");
});

test("html 渲染：fullPage 真的截到底（不是默认 750×485 窗口）", { skip }, async (t) => {
	const dir = tempDir(t, "html-full");
	const tall = `<!doctype html><html><head><meta charset="utf-8"><style>
		body{margin:0} .blk{height:400px} .a{background:#123} .b{background:#456} .c{background:#789}
	</style></head><body><div class="blk a"></div><div class="blk b"></div><div class="blk c"></div></body></html>`;
	const out = resolve(dir, "tall.png");
	const r = renderHtml({ html: tall, out, width: 320, fullPage: true, scale: 1 });

	// 曾经的缺陷：只传 --screenshot（不带 --window-size）→ 浏览器用默认窗口截，
	// 报 320×800 但实际 750×485；所以必须两位维度都按**实测像素**断言。
	assert.equal(r.measured, true, "fullPage 应先量出内容高");
	assert.equal(r.pixelWidth, 320, `宽应是请求宽，实测 ${r.pixelWidth}`);
	assert.ok(r.pixelHeight >= 1200, `三块 400px 内容应截到 ≥1200px，实测 ${r.pixelHeight}`);
	assert.notEqual(r.pixelHeight, 485, "不能是浏览器默认窗口高（说明 fullPage 没生效）");
	assert.equal(r.height, Math.round(r.pixelHeight / r.scale), "回报的 height 必须与实测像素一致");

	// 非 fullPage：按传入视口截，不能变成整页
	const v = renderHtml({ html: tall, out: resolve(dir, "view.png"), width: 320, height: 200 });
	assert.equal(v.pixelHeight, 200, `视口截图应是 200，实测 ${v.pixelHeight}`);
});

test("html 渲染：穿过 design_render 工具也能跑，且输出无 undefined", { skip }, async (t) => {
	const dir = tempDir(t, "html-tool");
	const htmlPath = resolve(dir, "page.html");
	const { writeFileSync } = await import("node:fs");
	writeFileSync(htmlPath, PAGE, "utf8");
	const { value } = await call("design_render", { action: "html", html: htmlPath, out: resolve(dir, "r.png"), width: 400, height: 200 });
	assert.equal(value.action, "html");
	assert.ok(value.bytes > 0);
	assert.ok(typeof value.browser === "string" && value.browser.length > 0, "应回报用了哪个浏览器");
	const text = JSON.stringify(value);
	assert.equal(/undefined|"NaN"/.test(text), false, "输出不得带 undefined/NaN");
});
