/**
 * test/icon-dimensions.test.mjs — 正交维度合成器（icon-render.js + renderComposed）。
 *
 * 为什么单独开文件：这是「从模板变工具」的核心——9 个预设不再互斥，
 * 视觉语言由 6 个正交维组合而成。这里逐维验「它真的改变了输出」，
 * 并验组合时不会互相覆盖或产生非法 SVG。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { call } from "./helpers.mjs";
import { CAP_TO_JOIN, CONTAINERS, DIMENSION_LIMITS, PRESETS, clampDim } from "../lib/icon-render.js";
import { renderComposed } from "../lib/svg.js";
import { getIcon } from "../lib/icondb.js";

/** 取出 emit 的 SVG。 */
async function svgOf(args) {
	const { value } = await call("icon", { action: "emit", name: "heart", target: "raw", ...args });
	return value.code;
}

/* ------------------------------ 维度表的自洽 ------------------------------ */

test("维度表：9 个预设都映射到同一组轴，不互斥", () => {
	assert.equal(Object.keys(PRESETS).length, 9);
	for (const [name, p] of Object.entries(PRESETS)) {
		assert.ok(["stroke", "fill"].includes(p.paint), `${name}: paint 必须合法`);
		// 纯填充预设（solid）不需要 weight；描边型预设必须有
		assert.equal(p.weight === undefined, p.paint === "fill", `${name}: 只有 fill 型预设可以不给 weight`);
		if (p.container !== undefined) assert.ok(CONTAINERS.includes(p.container), `${name}: container 必须在列表里`);
		if (p.gradient !== undefined) assert.ok(["linear", "radial"].includes(p.gradient), `${name}: gradient 必须合法`);
	}
	// 每个 caps 都有对应的 join
	assert.deepEqual(CAP_TO_JOIN.round, ["round", "round"]);
	assert.deepEqual(CAP_TO_JOIN.butt, ["butt", "miter"]);
	assert.deepEqual(CAP_TO_JOIN.square, ["square", "miter"]);
});

test("维度表：clampDim 夹紧越界值，非数字返回 undefined", () => {
	assert.equal(clampDim("radius", 99), DIMENSION_LIMITS.radius[1]);
	assert.equal(clampDim("radius", -5), 0);
	assert.equal(clampDim("inset", 0.9), 0.45);
	assert.equal(clampDim("gradientAngle", 400), 360);
	assert.equal(clampDim("weight", 3), 3);
	assert.equal(clampDim("radius", undefined), undefined);
	assert.equal(clampDim("radius", NaN), undefined);
	assert.equal(clampDim("radius", "8"), undefined, "字符串不猜，交给交易层校验");
});

/* ---------------------------- 逐维：真的生效 ---------------------------- */

test("维度 paint：stroke / fill / both 三者输出不同", async () => {
	const stroke = await svgOf({ style: "outline", paint: "stroke" });
	const both = await svgOf({ style: "outline", paint: "both" });
	assert.match(stroke, /fill="none"[^>]*stroke="currentColor"/, "stroke：fill=none + stroke");
	assert.match(both, /fill="currentColor"[^>]*stroke="currentColor"/, "both：fill 与 stroke 同时存在");
	assert.notEqual(stroke, both);
	// fill 需要填充孪生体（heart 在 tabler 有），应自动换到填充版
	const fill = await svgOf({ style: "outline", paint: "fill" });
	assert.match(fill, /fill="currentColor"/);
	assert.match(fill, /stroke="none"/, "fill：不能带描边");
});

test("维度 caps：自动配对 join，且真的改了属性", async () => {
	const round = await svgOf({ style: "outline", caps: "round" });
	const butt = await svgOf({ style: "outline", caps: "butt" });
	assert.match(round, /stroke-linecap="round"/);
	assert.match(butt, /stroke-linecap="butt"/);
	assert.match(butt, /stroke-linejoin="miter"/, "butt 应自动配 miter");
	// 显式 join 覆盖默认
	const bevel = await svgOf({ style: "outline", caps: "butt", join: "bevel" });
	assert.match(bevel, /stroke-linejoin="bevel"/);
});

test("维度 container：4 种形状都能出，且 none 能去掉预设容器", async () => {
	const rounded = await svgOf({ style: "outline", container: "rounded" });
	assert.match(rounded, /<rect[^>]*rx=/, "rounded 用 rect + rx");
	const circle = await svgOf({ style: "outline", container: "circle" });
	assert.match(circle, /<circle[^>]*r="12"/, "circle 用 circle");
	const squircle = await svgOf({ style: "outline", container: "squircle" });
	assert.match(squircle, /<path d="M [\d.]+ 0/, "squircle 用连续圆角 path");
	// 字形在容器里必须是反白，不能跟底同色
	for (const code of [rounded, circle, squircle]) {
		assert.match(code, /stroke="#FFFFFF"|fill="#FFFFFF"/, "容器内字形应反白");
	}
	// none 能把 badge 预设的容器主动去掉
	const removed = await svgOf({ style: "badge", container: "none" });
	assert.equal(/<rect[^>]*width="24"/.test(removed), false, "container=none 应删掉底色");
});

test("维度 radius / inset：连续可调，且被夹到合法区间", async () => {
	const sharp = await svgOf({ style: "outline", container: "rounded", radius: 0 });
	const round = await svgOf({ style: "outline", container: "rounded", radius: 12 });
	assert.match(sharp, /rx="0"/);
	assert.match(round, /rx="12"/);
	// 越界夹紧
	const overflow = await svgOf({ style: "outline", container: "rounded", radius: 999 });
	assert.match(overflow, /rx="12"/, "radius 应被夹到 12");
	// inset 越大字形越小 → scale 变小
	const tight = await svgOf({ style: "outline", container: "circle", inset: 0.05 });
	const loose = await svgOf({ style: "outline", container: "circle", inset: 0.4 });
	const scaleOf = (code) => Number((code.match(/scale\(([\d.]+)\)/) ?? [])[1]);
	assert.ok(scaleOf(tight) > scaleOf(loose), `inset 越大字形越小（${scaleOf(tight)} vs ${scaleOf(loose)}）`);
});

test("维度 gradient：linear 与 radial 不同，角度真的改了坐标", async () => {
	const linear = await svgOf({ style: "outline", gradient: "linear", gradientAngle: 0, color: "#FF6B35" });
	const radial = await svgOf({ style: "outline", gradient: "radial", color: "#FF6B35" });
	assert.match(linear, /<linearGradient/);
	assert.match(radial, /<radialGradient/);
	const a0 = await svgOf({ style: "outline", gradient: "linear", gradientAngle: 0, color: "#FF6B35" });
	const a90 = await svgOf({ style: "outline", gradient: "linear", gradientAngle: 90, color: "#FF6B35" });
	assert.notEqual(a0, a90, "角度不同应产出不同坐标");
	// 非 hex 算不出末色 → 回退实色，不产坏渐变
	const named = await svgOf({ style: "outline", gradient: "linear", color: "tomato" });
	assert.equal(/linearGradient/.test(named), false, "命名色应回退实色而不是产出坏渐变");
});

test("容器 + 渐变：渐变画在容器上，字形强制白（color2 不再兼任字形色）", async () => {
	// 实测 bug：color2 在「容器+渐变」场景下既是渐变末色又被当字形色，
	// 结果 iOS / Win11 / 拟物图标的字形跟容器同色系、几乎看不见。
	const code = await svgOf({
		style: "outline",
		container: "squircle",
		radius: 10,
		gradient: "linear",
		gradientAngle: 160,
		color: "#0A84FF",
		color2: "#5E5CE6"
	});
	// 渐变定义在容器底上（容器元素的 fill 是 url(#...)）
	assert.match(code, /<path[^>]*fill="url\(#ak-g-[\w]+\)"/, "容器底应用渐变");
	assert.match(code, /stop-color="#0A84FF"/, "渐变起色 = color");
	assert.match(code, /stop-color="#5E5CE6"/, "渐变末色 = color2");
	// 字形必须是白（不能是 color2 那个紫）
	const glyph = code.slice(code.indexOf("<g transform=\"translate("));
	assert.match(glyph, /(fill|stroke)="#FFFFFF"/, `字形应反白，实际片段：${glyph.slice(0, 120)}`);
	assert.equal(/stroke="#5E5CE6"/.test(code), false, "color2 不得再当字形色");
});

test("透明容器：只借缩放/留白，不画底色、也不换填充字形", async () => {
	// 用途：无容器风格想要字形 inset 时，用 rgba(0,0,0,0) 容器借它的 scale。
	// 实测 bug：透明容器会触发「换填充版字形」，把细线风格变成实心块。
	const code = await svgOf({ style: "outline", container: "rounded", radius: 0, inset: 0.1, strokeWidth: 1, color: "rgba(0,0,0,0)", color2: "#18181B" });
	assert.match(code, /fill="rgba\(0,0,0,0\)"/, "容器底应完全透明");
	assert.match(code, /scale\(0\.8\)/, "字形应被缩进（借容器的留白）");
	// 字形必须是「描边式」（fill=none + 有 stroke），而不是被换成填充版实心块。
	// 注意 stroke-width 会按缩放反向补偿（1 / 0.8 = 1.25），不能直接断言 1。
	assert.match(code, /<g fill="none" stroke="#18181B" stroke-width="[\d.]+"/, `细线字形应保留描边，实际：${code.slice(code.indexOf("<g transform"))}`);
	assert.equal(/<g fill="#18181B" stroke="none"/.test(code), false, "不应被换成填充版字形");
});

/* ----------------------------- 组合：真的能叠 ----------------------------- */

test("组合：容器 + both + 平头 + 径向渐变 可以同时成立", async () => {
	// 这就是旧架构做不到的：badge 不能同时是 gradient。
	const code = await svgOf({
		style: "outline",
		container: "squircle",
		radius: 9,
		inset: 0.16,
		paint: "both",
		caps: "butt",
		gradient: "radial",
		color: "#7C3AED"
	});
	assert.match(code, /<path d="M [\d.]+ 0/, "squircle 容器存在");
	assert.match(code, /radialGradient/, "径向渐变存在");
	assert.match(code, /stroke-linecap="butt"/, "平头线端存在");
	assert.match(code, /scale\(/, "字形被缩进容器");
	// 单次渲染只能有一个 <svg> 根
	assert.equal((code.match(/<svg/g) ?? []).length, 1);
});

test("组合：预设只是起点，任何一维都能被覆盖", async () => {
	// badge 预设 = rounded + inset .24 + weight 1.8；逐维覆盖后应改变
	const preset = await svgOf({ style: "badge" });
	const overridden = await svgOf({ style: "badge", container: "circle", inset: 0.05 });
	assert.match(preset, /<rect/);
	assert.match(overridden, /<circle/);
	assert.notEqual(preset, overridden);

	// 描边型图标上 strokeWidth 才真的改粗细（badge 用填充字形，描边不适用）
	const thin = await svgOf({ style: "outline", strokeWidth: 1 });
	const thick = await svgOf({ style: "outline", strokeWidth: 5 });
	assert.match(thin, /stroke-width="1"/);
	assert.match(thick, /stroke-width="5"/);
});

test("静默忽略已修：填充字形上给 strokeWidth 会明说「不生效」", async () => {
	// 实测旧行为：传了 strokeWidth 但填充字形根本不用它，输出与不传一模一样，
	// 而且没有任何提示——AI 会以为调了粗细。现在必须出 note。
	const { value } = await call("icon", { action: "emit", name: "heart", target: "raw", style: "badge", strokeWidth: 6 });
	assert.ok(
		value.notes.some((n) => /strokeWidth=6 不生效/.test(n)),
		`应提示 strokeWidth 未生效，实际 notes：${value.notes.join(" | ")}`
	);
});

/* ------------------------------- 健壮性 ------------------------------- */

test("健壮性：非法枚举值报错，不静默降级", async () => {
	for (const bad of [
		{ paint: "diagonal" },
		{ caps: "pointy" },
		{ container: "hexagon" },
		{ gradient: "conic" }
	]) {
		await assert.rejects(
			() => call("icon", { action: "emit", name: "heart", target: "raw", style: "outline", ...bad }),
			/must be one of|invalid/i,
			`${JSON.stringify(bad)} 应被拒绝`
		);
	}
});

test("健壮性：确定性（同输入两次字节相同）且不含 undefined/NaN", async () => {
	for (const args of [
		{ style: "outline" },
		{ style: "badge", container: "squircle", radius: 9 },
		{ style: "outline", paint: "both", gradient: "linear", gradientAngle: 30, color: "#0F766E" },
		{ style: "duotone" }
	]) {
		const a = await svgOf(args);
		const b = await svgOf(args);
		assert.equal(a, b, `${JSON.stringify(args)} 应确定`);
		assert.equal(/undefined|NaN|\[object Object\]/.test(a), false, `${JSON.stringify(args)}: 不得含垃圾占位符`);
	}
});

test("渐变 id 按内容唯一（同页多个图标不串色）", async () => {
	// 实测 bug：旧实现所有渐变都用 id="ak-g"，同一页面内联多个不同颜色的渐变图标时，
	// 它们都引用文档里第一个定义 → 蓝色图标渲染成粉红。
	const ids = [];
	for (const color of ["#0369A1", "#A16207", "#DB2777"]) {
		const code = await svgOf({ style: "outline", gradient: "linear", color });
		ids.push((code.match(/id="(ak-g-[\w]+)"/) ?? [])[1]);
	}
	assert.equal(ids.every((id) => typeof id === "string" && id !== ""), true, `每个渐变都应有 id，实际 ${ids.join(",")}`);
	assert.equal(new Set(ids).size, 3, `不同颜色应产出不同 id，实际 ${ids.join(",")}`);
	// 同颜色同角度 → 同 id（确定性）
	const a = await svgOf({ style: "outline", gradient: "linear", color: "#0369A1" });
	const b = await svgOf({ style: "outline", gradient: "linear", color: "#0369A1" });
	assert.equal(a, b, "同输入必须同字节");
});

test("renderComposed：纯函数，不传任何维度 = 最简线性图标", () => {
	const node = getIcon("heart").node;
	const svg = renderComposed({ node });
	assert.match(svg, /^<svg /);
	assert.match(svg, /stroke-width="2"/, "默认 weight 2");
	assert.match(svg, /stroke-linecap="round"/, "默认 caps round");
	assert.equal(/<rect|<circle|<linearGradient|<radialGradient/.test(svg), false, "默认不应有任何容器或渐变层");
	// 图层的顺序：容器底在字形之前（否则会被盖住）
	const withChip = renderComposed({ node, container: { kind: "circle" } });
	assert.ok(withChip.indexOf("<circle") < withChip.indexOf("<path"), "容器底必须在字形之前");
});
