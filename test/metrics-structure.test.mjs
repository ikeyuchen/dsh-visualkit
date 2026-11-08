/**
 * test/metrics-text.test.mjs — 字符宽度表 + 结构规则。
 *
 * 为什么单独开文件：这两块是「把业界做法搬进来」的新增能力，与原有 S/G/P 规则无耦合。
 * 重点验两件事：（1）宽度表真的比旧扁平模型准（用真实渲染像素对照）；
 * （2）新规则在该命中时命中、样本不足/在容差内时不误报。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CAN_RENDER, call, tempDir, writeTree } from "./helpers.mjs";
import { WIDTH_TABLE_SIZE, charWidth, countWideChars, measureText, measureTextPx } from "../lib/layouts/metrics-text.js";
import { auditBaselineGrid, auditHeadingOrder, auditTouchTargets } from "../lib/layouts/rules-structure.js";
import { auditSvg } from "../lib/layouts/svg.js";
import { renderSvg, } from "../lib/render.js";
import { decodePng } from "../lib/layouts/png.js";

/* ------------------------------ 宽度表 ------------------------------ */

test("宽度表：95 个 ASCII 宽度值，区间合理", async () => {
	assert.equal(WIDTH_TABLE_SIZE, 95, "ASCII 32–126 共 95 个字符");
	// 空格最窄、@ 最宽（mono 字体不适用但 YaHei 是这样）
	assert.ok(charWidth(" ") < 0.35, `空格应很窄，实测 ${charWidth(" ")}`);
	assert.ok(charWidth("@") > 0.9, `@ 应很宽，实测 ${charWidth("@")}`);
	// 全角恒为 1em —— 这是字体约定，不是估算
	// 注意：半角 ":" 走 ASCII 表（0.241），全角 "："（U+FF1A）才是 1em
	for (const ch of ["中", "文", "龘", "，", "。", "、", "：", "；", "阿"]) {
		assert.equal(charWidth(ch), 1, `全角字符「${ch}」advance 应为 1em`);
	}
	assert.ok(charWidth(":") < 0.3, `半角冒号应走 ASCII 表（实测 ${charWidth(":")}）`);
	// 零宽字符不推进行宽
	assert.equal(charWidth("\u200b"), 0, "零宽空格不应占宽度");
});

test("宽度表：measureText 是纯加法且处理怪输入", async () => {
	assert.equal(measureText(""), 0);
	assert.equal(measureText("中文"), 2);
	assert.equal(measureTextPx("中文", 20), 40);
	// 非法输入不能崩
	for (const weird of [null, undefined, 123, {}, []]) assert.equal(typeof measureText(weird), "number", `measureText(${JSON.stringify(weird)}) 应返回数字`);
	assert.equal(measureTextPx("中文", 0), 0, "字号 0 应返回 0");
	assert.equal(measureTextPx("中文", NaN), 0);
	// 加法性
	assert.ok(Math.abs(measureText("ab") - (measureText("a") + measureText("b"))) < 1e-9);
});

test("宽度表：全角字符计数（G4 一行 45 字用）", async () => {
	assert.equal(countWideChars("Hello 世界 123"), 2);
	assert.equal(countWideChars("全是中文"), 4);
	assert.equal(countWideChars("pure ascii"), 0);
	assert.equal(countWideChars(""), 0);
});

test("宽度表：比旧的扁平模型准一个量级（真实渲染像素对照）", { skip: !CAN_RENDER }, async (t) => {
	const dir = tempDir(t, "metrics-accuracy");
	const cases = [
		{ label: "中英混排", text: "设计 Design System", size: 24 },
		{ label: "纯英文", text: "The quick brown fox jumps over the lazy dog", size: 18 }
	];
	for (const c of cases) {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300"><text x="40" y="120" font-size="${c.size}" font-family="Microsoft YaHei">${c.text}</text></svg>`;
		const file = join(dir, `${c.label}.png`);
		await renderSvg({ svg, png: file, width: 900 });
		const img = decodePng(readFileSync(file));
		let minX = Infinity;
		let maxX = -1;
		for (let y = 0; y < img.height; y += 1) {
			for (let x = 0; x < img.width; x += 1) {
				const i = (y * img.width + x) * img.channels;
				if ((img.channels === 4 ? img.data[i + 3] : 255) > 40) {
					if (x < minX) minX = x;
					if (x > maxX) maxX = x;
				}
			}
		}
		const actual = maxX - minX + 1;
		const estimate = measureTextPx(c.text, c.size);
		const err = Math.abs(estimate - actual) / actual;
		// 旧的扁平 0.55 模型在这两个例子上分别是 4.4% / 10.0%
		assert.ok(err < 0.02, `${c.label}: 查表误差应 <2%（实测 ${(err * 100).toFixed(1)}%，估算 ${estimate.toFixed(1)} vs 实际 ${actual}）`);
		// 再确认旧模型确实更差（防未来有人把表改回扁平）
		const flat = [...c.text].reduce((s, ch) => s + ((ch.codePointAt(0) >= 0x4e00 && ch.codePointAt(0) <= 0x9fff) ? 1 : 0.55), 0) * c.size;
		assert.ok(Math.abs(flat - actual) / actual > err, `${c.label}: 扁平模型应该比查表差（扁平 ${(Math.abs(flat - actual) / actual * 100).toFixed(1)}%）`);
	}
});

test("宽度表：svg 模式的 G4 行长判定用上了真实宽度", async () => {
	// 英文长句在 900 宽画布上占 43% —— 不应命中 G4（>85%）
	const wide = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300"><text x="40" y="120" font-size="18" font-family="Microsoft YaHei">The quick brown fox jumps over the lazy dog</text></svg>`;
	const r1 = auditSvg(wide, { name: "a" });
	assert.equal(r1.findings.some((f) => f.rule === "G4"), false, "43% 宽度不应命中 G4");
	// 故意拉长到超 85%
	const long = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300"><text x="20" y="120" font-size="18" font-family="Microsoft YaHei">${"The quick brown fox jumps over the lazy dog ".repeat(3)}</text></svg>`;
	const r2 = auditSvg(long, { name: "b" });
	assert.equal(r2.findings.some((f) => f.rule === "G4"), true, "超长行应命中 G4");
});

/* ---------------------------- 标题层级 ---------------------------- */

test("结构：标题跳级 error，正常递进与回退不报", async () => {
	const skip = auditHeadingOrder([{ level: 1, where: "a" }, { level: 3, where: "b" }]);
	assert.equal(skip.length, 1);
	assert.equal(skip[0].rule, "structure-heading-skip");
	assert.equal(skip[0].severity, "error");
	assert.match(skip[0].message, /h1.*h3/);
	assert.match(skip[0].fix, /h2/, "fix 应指出缺 h2");
	// 正常递进
	assert.equal(auditHeadingOrder([{ level: 1, where: "a" }, { level: 2, where: "b" }, { level: 3, where: "c" }]).length, 0);
	// 回退任意级正常
	assert.equal(auditHeadingOrder([{ level: 1, where: "a" }, { level: 3, where: "b" }, { level: 1, where: "c" }]).filter((f) => f.rule === "structure-heading-skip").length, 1, "h1→h3 算跳级，但 h3→h1 回退不算");
	// 边界
	assert.deepEqual(auditHeadingOrder([]), []);
	assert.deepEqual(auditHeadingOrder(null), []);
	assert.deepEqual(auditHeadingOrder([{ level: 9, where: "bad" }]), [], "非法 level 应被过滤");
});

test("结构：首标题非 h1 / 多个 h1 各报一条 warn", async () => {
	const first = auditHeadingOrder([{ level: 2, where: "a" }, { level: 3, where: "b" }]);
	assert.ok(first.some((f) => f.rule === "structure-heading-first"));
	const dup = auditHeadingOrder([{ level: 1, where: "a" }, { level: 1, where: "b" }]);
	const d = dup.find((f) => f.rule === "structure-heading-duplicate-h1");
	assert.ok(d !== undefined);
	assert.match(d.message, /2 个 h1/);
});

/* ---------------------------- 触摸目标 ---------------------------- */

test("结构：触摸目标三档（<24 error / 24–43 warn / ≥44 干净）", async () => {
	const small = auditTouchTargets([{ width: 100, height: 20, label: "按钮", where: "a" }]);
	assert.equal(small.length, 1);
	assert.equal(small[0].rule, "structure-touch-too-small");
	assert.equal(small[0].severity, "error");
	assert.match(small[0].message, /20px/, "应指出短边实际值");

	const mid = auditTouchTargets([{ width: 100, height: 30, label: "链接", where: "b" }]);
	assert.equal(mid[0].rule, "structure-touch-below-recommended");
	assert.equal(mid[0].severity, "warn");

	assert.deepEqual(auditTouchTargets([{ width: 48, height: 48, where: "c" }]), [], "48×48 应干净");
	// 宽 200 高 20 依然算小 —— 取短边
	assert.equal(auditTouchTargets([{ width: 200, height: 20, where: "d" }])[0].rule, "structure-touch-too-small");
	// 非法尺寸过滤
	assert.deepEqual(auditTouchTargets([{ width: 0, height: 20, where: "e" }]), []);
	assert.deepEqual(auditTouchTargets(null), []);
});

/* ---------------------------- 基线网格 ---------------------------- */

test("结构：基线网格只在真失控时报（样本不足/容差内不报）", async () => {
	const ok = (ys) => auditBaselineGrid(ys.map((y, i) => ({ y, where: `L${i}` })));
	assert.deepEqual(ok([32, 48, 64, 80, 96]), [], "全对齐 8 倍数应干净");
	const bad = ok([35, 51, 67, 83]);
	assert.equal(bad.length >= 1, true);
	assert.equal(bad[0].rule, "structure-baseline-offgrid");
	assert.match(bad[0].fix, /8/, "fix 应说明对齐到 8 的倍数");
	// 偏离 1px 在容差内
	assert.deepEqual(ok([31, 47, 63, 79]), [], "偏差 1px 容差内不报");
	// 只有 3 行不判
	assert.deepEqual(ok([35, 51, 67]), [], "少于 4 行不判网格");
	assert.deepEqual(auditBaselineGrid([]), []);
	// 自定义网格
	assert.deepEqual(auditBaselineGrid([{ y: 40, where: "a" }, { y: 80, where: "b" }, { y: 120, where: "c" }, { y: 160, where: "d" }], { grid: 40 }), []);
});

test("结构：三个规则的输出都可 JSON 无损往返（无 undefined）", async () => {
	const all = [
		...auditHeadingOrder([{ level: 2, where: "a" }, { level: 5, where: "b" }, { level: 5, where: "c" }]),
		...auditTouchTargets([{ width: 10, height: 10, where: "d" }, { width: 30, height: 30, where: "e" }]),
		...auditBaselineGrid([{ y: 3, where: "f" }, { y: 11, where: "g" }, { y: 19, where: "h" }, { y: 27, where: "i" }])
	];
	assert.ok(all.length > 0, "应至少产生一些发现");
	for (const f of all) {
		assert.equal(typeof f.rule, "string");
		assert.equal(typeof f.message, "string");
		assert.equal(typeof f.fix, "string");
		assert.ok(["error", "warn", "info"].includes(f.severity));
		assert.equal(JSON.stringify(f).includes("undefined"), false, `${f.rule}: 不得含 undefined`);
	}
	assert.deepEqual(JSON.parse(JSON.stringify(all)), all);
});
