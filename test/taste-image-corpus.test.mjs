// test/taste-image-corpus.test.mjs — 用真实语料校验位图层判据（不是合成图）。
//
// 语料：用户提供的 20+ 张「真实产品界面」截图（PNG）。**不入库**（截图含产品信息，且体积大）。
// 路径来自本机未提交的配置（仓库根 .selfcheck.local.json，格式见 tools/selfcheck.mjs 文件头）
// 的 "imageCorpus" 键，或环境变量 VISUALKIT_IMAGE_CORPUS。目录不存在时整组跳过，
// 与 html-render 测试在无浏览器时跳过是同一套处理。
//
// 这组语料给出的定论（2026-11-08）：
//   · 26 张里只有 1 张是模板长相（紫蓝渐变营销页），其余 25 张得 0；
//   · 那 25 个 0 **不是“没问题”，是位图层看不见**：放大到 145% 能看到图标不成套、
//     字号没有层次、卡片文字被裁；拿同一批界面的源码跑源码层，直接报出
//     “字号塔缩 1.00×”“间距 38% 不在 4px 网格（含 13.6/22.4 非整数像素）”
//     “AI 套路文案 30 处”。所以本测试钉两件事：位图判据不许在它们身上乱报，
//     且必须把量不了的维度（blindSpots）随结果交出去。
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { tasteImage } from "../lib/taste-image.js";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

/** 本机语料配置（不入库）；格式见 tools/selfcheck.mjs 文件头。 */
function localConfig() {
	const file = join(REPO, ".selfcheck.local.json");
	if (existsSync(file) === false) return null;
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return null;
	}
}

const CORPUS = process.env.VISUALKIT_IMAGE_CORPUS || localConfig()?.imageCorpus || null;
const skip = CORPUS === null || existsSync(CORPUS) === false ? `本机没有真实语料目录（可选）` : false;

test("真实语料：AI 制作的合格产品界面不得被判成模板（25/26 应得 0）", { skip }, async () => {
	const files = readdirSync(CORPUS).filter((f) => /\.png$/i.test(f));
	assert.ok(files.length >= 20, `语料太少（${files.length} 张），结论不可靠`);
	const results = [];
	for (const f of files) results.push({ file: f, ...(await tasteImage(join(CORPUS, f))) });
	const flagged = results.filter((r) => r.score > 0);
	const zeros = results.filter((r) => r.score === 0);

	// 事实口径：这批样本里模板长相的是少数
	assert.ok(zeros.length >= results.length - 3, `得 0 的应占绝大多数，实际 ${zeros.length}/${results.length}`);
	for (const r of zeros) {
		assert.equal(r.grade, "clean", `${r.file}: 0 分应为 clean`);
		assert.equal(r.metrics.length, 0, `${r.file}: 0 分时不该有命中项`);
	}
	// 真正的模板样本（紫蓝渐变营销页）必须被抓到
	assert.ok(flagged.length >= 1, "这批里至少有 1 张典型模板页，不能被漏掉");
	for (const r of flagged) assert.ok(r.score >= 40, `${r.file}: 被判模板就该有分量，实际 ${r.score}`);
});

test("真实语料：卡片网格只量不判——它在合格界面上会命中，所以不能计分", { skip }, async () => {
	const files = readdirSync(CORPUS).filter((f) => /\.png$/i.test(f));
	const all = [];
	for (const f of files) all.push(await tasteImage(join(CORPUS, f)));
	const results = all.filter((r) => r.score === 0);
	const trios = results.filter((r) => r.raw.cardGrid.maxPerRow >= 3 && r.raw.cardGrid.equalWidth);
	// 这条断言不是“应该坏”，而是把“不能拿它计分”钉成回归测试：
	// 一旦有人把 cardGrid 接进计分，这些合格界面就会被误报。
	assert.ok(
		trios.length >= 3,
		`应有 ≥3 张合格界面含“同一行 3 个等宽卡片”（实测 6 张），实际 ${trios.length}——` +
			`若此数变小，说明 cardGrid 度量退化，而不是判据变好`
	);
	for (const r of results) assert.equal(r.metrics.some((m) => m.id.includes("card")), false, "cardGrid 不得进入计分项");
});

test("真实语料：位图结果必须自带 blindSpots，否则模型会把 0 分当“没问题”", { skip }, async () => {
	const files = readdirSync(CORPUS).filter((f) => /\.png$/i.test(f));
	const r = await tasteImage(join(CORPUS, files[0]));
	assert.equal(Array.isArray(r.blindSpots), true, "位图模式必须列出量不了的维度");
	assert.ok(r.blindSpots.length >= 4, `blindSpots 太少：${JSON.stringify(r.blindSpots)}`);
	assert.ok(r.scopeNote.includes("量不了"), "scopeNote 必须自说明量不了什么");
});
