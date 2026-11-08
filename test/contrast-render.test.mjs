/**
 * test/contrast-render.test.mjs — 在真实渲染像素上量文字对比度。
 *
 * 解决的真正痛点：静态解析 CSS 遇到 rgba / CSS 变量 / 渐变背景时只能跳过
 * （contrast-invalid），而这三类恰好是现在最常用的写法。
 *
 * 做法：同页面渲两遍——正常 / 文字染成透明——差异处是文字墨迹，
 * 连通域里最墨的像素给出纯文字色，同一位置的透明版给出**真实背景**。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { tempDir } from "./helpers.mjs";
import { hideTextCss, injectCss, measureRenderedContrast, pixelContrast } from "../lib/contrast-render.js";
import { findBrowser } from "../lib/render-html.js";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const skip = findBrowser() === null ? "本机没装 Chromium 系浏览器（可选能力）" : false;

/* ---------------------------- 纯函数部分 ---------------------------- */

test("pixelContrast：与 WCAG 公式一致（黑白 21:1、同色 1:1）", () => {
	assert.equal(Math.round(pixelContrast([0, 0, 0], [255, 255, 255])), 21);
	assert.equal(Math.round(pixelContrast([255, 255, 255], [255, 255, 255])), 1);
	assert.equal(Math.round(pixelContrast([0, 0, 0], [0, 0, 0])), 1);
	// 对称性：前景/背景互换结果不变
	const a = pixelContrast([97, 102, 109], [255, 255, 255]);
	const b = pixelContrast([255, 255, 255], [97, 102, 109]);
	assert.equal(Math.round(a * 1000), Math.round(b * 1000));
	// 已知值：bilibili 那套 #61666D on #FFFFFF ≈ 5.79
	assert.ok(Math.abs(a - 5.79) < 0.05, `实际 ${a.toFixed(2)}`);
});

test("injectCss：插到 </head> 前；无 head 时插到最前，布局不变", () => {
	const withHead = injectCss("<html><head><title>t</title></head><body>x</body></html>", "A{}");
	assert.ok(withHead.indexOf("A{}") < withHead.indexOf("</head>"), "应插在 </head> 之前");
	assert.ok(withHead.includes("<title>t</title>"), "原有内容不能丢");
	const noHead = injectCss("<body>x</body>", "A{}");
	assert.ok(noHead.startsWith("<style"), "无 head 时应插到最前");
	// 隐藏文字的样式必须用 !important，否则会被页面自己的样式覆盖
	assert.match(hideTextCss(), /color:\s*transparent\s*!important/);
});

/* ---------------------------- 端到端部分 ---------------------------- */

test("渲染对比度：渐变底上的两种低对比文字各报一条，高对比不报", { skip }, async (t) => {
	const dir = tempDir(t, "contrast-render");
	const page = resolve(dir, "page.html");
	// 深色渐变底上放：白字（应当过）、浅灰字（应当不过）
	writeFileSync(
		page,
		`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{margin:0;font:400 16px/1.6 "Microsoft YaHei",sans-serif}
      .hero{background:linear-gradient(135deg,#1E3A8A,#7C3AED);padding:28px}
      .ok{color:#FFFFFF}
      .bad{color:#8A8FA8;margin-top:12px}
    </style></head><body>
    <div class="hero"><p class="ok">这行白字应该没问题</p><p class="bad">这行浅灰字压在深渐变上会不够</p></div>
    </body></html>`,
		"utf8"
	);

	const m = measureRenderedContrast({ htmlPath: page, outDir: dir, width: 720, height: 260 });
	assert.equal(m.rendered, true, `渲染应成功，实际 ${m.reason ?? ""}`);
	assert.ok(m.worst !== null, "应量到文字");
	assert.ok(m.worst.ratio < 4.5, `浅灰字应不足 4.5:1，实际 ${m.worst.ratio.toFixed(2)}`);
	// 灰字本色 #8A8FA8 = rgb(138,143,168)，应能对上（容差留给编码）
	assert.ok(Math.abs(m.worst.fg[0] - 138) <= 6 && Math.abs(m.worst.fg[1] - 143) <= 6, `前景应≈rgb(138,143,168)，实际 ${m.worst.fg.join(",")}`);
	// 按文字色去重后至少两种：白 + 灰
	assert.ok(m.bands >= 2, `应至少识别出两种文字色，实际 ${m.bands}`);
	// 白字那一种对比度应明显高于灰字
	const white = m.pairs.find((p) => /rgb\(2[0-9][0-9],2[0-9][0-9],2[0-9][0-9]\)/.test(p.fg));
	assert.ok(white !== undefined && white.ratio > 6, `白字对比度应 >6:1，实际 ${white === undefined ? "未识别" : white.ratio}`);
});

test("渲染对比度：找不到浏览器时如实返回 rendered:false，不编造数据", () => {
	const m = measureRenderedContrast({
		htmlPath: "__no_such_file__.html",
		outDir: "/tmp",
		width: 100,
		height: 100
	});
	assert.equal(m.rendered, false);
	assert.ok(typeof m.reason === "string" && m.reason.length > 0, "应说明为什么做不到");
	assert.equal(m.worst, null, "不得返回假数据");
});
