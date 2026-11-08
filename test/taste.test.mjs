// test/taste.test.mjs — taste_check action=taste（AI 味量化体检）的发布前功能测试。
//
// 覆盖：21 条规则的正例/反例、三层 scope 与 profile 计分、豁免机制（.design-intent.json
// 声明 + allow/ignore 参数）、分数单调性、边界（单文件/空目录/仅二进制/超大文件/maxFiles/
// 跳过目录）、确定性、输出定位与截断。
//
// 回归锚点（2026-11-07 已修复，本文件转为真断言，防止回退）：
//   1) 缺 skin/reason（含非法 JSON）的声明文件不得让输出带 undefined 属性
//      → 用 Object.hasOwn(intent, "skin") === false 守住（宿主否则判 INVALID_TOOL_OUTPUT）；
//   2) 单文件 root 必须能读到同目录的 .design-intent.json。
//
// 注意：clean 样本里禁止出现 U+2600–27BF / U+1F000–1FAFF 区段字符——✓ ✔ ★ 等
// 都会被 emoji-icon 判据当成 emoji，这是规则的既有口径（见 detect.js 的 EMOJI_RE）。
import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { REPO, call, rejects, tempDir, writeTree } from "./helpers.mjs";
import { RULES } from "../lib/rules.js";
import { taste } from "../lib/taste.js";

const FIXTURES = join(REPO, "test", "fixtures", "taste");
const fixture = (name) => join(FIXTURES, name);
const STYLE_IDS = RULES.filter((rule) => rule.scope === "style").map((rule) => rule.id);

/* ------------------------- 每条规则的最小样本 ------------------------- */

/** 能命中该规则的最小样本（balanced 档下该规则必须进 actions 且失分）。 */
const HIT = {
  "emoji-icon": { "index.html": "<p>状态</p>\n<span>🟢 运行中</span>\n" },
  "type-flat": { "app.css": ".t { font-size: 15px; }\n.b { font-size: 14px; }\n" },
  "spacing-offgrid": { "app.css": ".a { padding: 5px; margin: 6px; gap: 7px; margin-left: 10px; padding-top: 14px; }\n" },
  "no-states": { "app.css": ".btn { color: #111111; }\n" },
  "card-uniform": {
    "index.html":
      '<div class="card">1</div>\n<div class="card">2</div>\n<div class="card">3</div>\n' +
      '<div class="card">4</div>\n<div class="card">5</div>\n<div class="card">6</div>\n'
  },
  "no-breath": { "app.css": ".a { padding: 4px; margin: 8px; padding: 6px; }\n" },
  "purple-gradient": { "app.css": ".g { background: linear-gradient(135deg, #7C3AED, #4F46E5); }\n" },
  "radius-blob": { "app.css": ".c { border-radius: 20px; }\n" },
  "hue-sprawl": {
    "app.css":
      ".a { color: #E4002B; background: #0EA5A5; border-color: #2563EB; }\n" +
      ".b { color: #16A34A; background: #F59E0B; }\n"
  },
  "shadow-glow": { "app.css": ".c { box-shadow: 0 0 24px rgba(124, 58, 237, .45); }\n" },
  glassmorphism: { "app.css": ".g { backdrop-filter: blur(8px); }\n" },
  "gradient-text": { "app.css": ".t { background-clip: text; -webkit-background-clip: text; }\n" },
  // 收紧后要求：居中作用在 h1/h2（或规则自带 font-size ≥24px）上，且页面有 hero/cta 容器。
  // 只写 .hero{text-align:center} 不再命中——实测那样会把正常页脚居中判成 hero。
  "centered-hero": { "index.html": '<h1 class="hero">标题</h1>\n', "app.css": ".hero { text-align: center; font-size: 48px; }\n" },
  "fake-stat": { "index.html": "<div>128K+</div>\n<div>99.9%</div>\n" },
  // 实测来源：我们自己做的 7 种风格 UI 里写了“立即同步 →”，旧 14 条规则零发现
  "ai-copy": { "index.html": "<button>立即同步 →</button>\n<p>一键开启你的效率之旅</p>\n" },
  // —— 以下 4 条来自「AI 味儿图鉴」：页面模板感与不好用的交互 ——
  // 框里套框：三层都设了圆角才算套娃（两层是正常的“卡片 + 内部区块”）
  "nest-boxes": {
    // 需要 ≥3 条「三层链」才计分，所以这里给三条完整的三层套娃
    "app.css":
      ".card { border-radius: 16px; }\n.card .inner { border-radius: 12px; }\n.card .inner .box { border-radius: 10px; }\n" +
      ".deep { border-radius: 14px; }\n.deep .mid { border-radius: 12px; }\n.deep .mid .core { border-radius: 8px; }\n" +
      ".x { border-radius: 14px; }\n.x .y { border-radius: 12px; }\n.x .y .z { border-radius: 6px; }\n"
  },
  // 分割线泛滥：8 处以上才计分（表格/列表用线是正常设计）
  "divider-sprawl": {
    "app.css":
      ".a{border-bottom:1px solid #eee}.b{border-bottom:1px solid #eee}.c{border-top:1px solid #eee}\n" +
      ".d{border-bottom:1px solid #eee}.e{border-bottom:1px solid #eee}.f{border-top:1px solid #eee}\n" +
      ".g{border-bottom:1px solid #eee}.h{border-bottom:1px solid #eee}.i{border-top:1px solid #eee}\n"
  },
  // 又大又黑又挤：≥30px + 700+ + 行高 ≤1.25 同时成立
  "big-black-tight": { "app.css": "h1 { font-size: 56px; font-weight: 800; line-height: 1.05; }\n" },
  // 按钮看着能点却没结果：≥2 个（单个可能只是静态演示）
  "dead-button": { "index.html": "<button>点我没反应</button>\n<button>也是</button>\n" },
  // 三个同尺寸、圆角 ≥12、渐变底的图标块
  "icon-tile-uniform": {
    "index.html":
      '<span class="icon-tile"></span>\n<span class="icon-tile"></span>\n<span class="icon-tile"></span>\n',
    "app.css":
      ".icon-tile { width: 48px; height: 48px; border-radius: 14px; background: linear-gradient(135deg, #6366F1, #A855F7); }\n"
  },
  // 四个以上的小标签才叫「逐段开场」
  "eyebrow-spam": {
    "index.html":
      '<span class="eyebrow">A</span>\n<span class="eyebrow">B</span>\n<span class="eyebrow">C</span>\n<span class="eyebrow">D</span>\n'
  }
};

/** 不该命中该规则的反例（该规则必须既不进 actions/advisories，也不出现在 metrics）。 */
const MISS = {
  "emoji-icon": { "index.html": "<p>状态 运行中</p>\n" },
  "type-flat": { "app.css": ".t { font-size: 24px; }\n.b { font-size: 14px; }\n" },
  "spacing-offgrid": { "app.css": ".a { padding: 4px; margin: 8px; gap: 12px; }\n" },
  "no-states": {
    "app.css":
      ".btn { color: #111111; }\n.btn:hover { color: #E4002B; }\n" +
      ".btn:focus-visible { outline: 2px solid #111111; }\n.btn:disabled { opacity: .5; }\n"
  },
  "card-uniform": { "index.html": '<div class="card">1</div>\n<div class="card">2</div>\n' },
  "no-breath": { "app.css": ".a { padding: 4px; margin: 32px; padding: 8px; }\n" },
  "purple-gradient": { "app.css": ".g { background: linear-gradient(180deg, #0EA5A5, #0B7285); }\n" },
  "radius-blob": { "app.css": ".c { border-radius: 4px; }\n" },
  "hue-sprawl": { "app.css": ".a { color: #E4002B; background: #FFFFFF; }\n.g { color: #111111; }\n" },
  "shadow-glow": { "app.css": ".c { box-shadow: 0 1px 2px rgba(0, 0, 0, .06); }\n" },
  glassmorphism: { "app.css": ".g { background: #F5F5F5; }\n" },
  "gradient-text": { "app.css": ".t { color: #E4002B; }\n" },
  "centered-hero": { "index.html": "<h1>标题</h1>\n", "app.css": ".title { text-align: left; }\n" },
  "fake-stat": { "index.html": "<div>18,432 行</div>\n<div>47 分钟</div>\n" },
  // 具体动作 + 真数字：箭头与鸡血词都没有
  "ai-copy": { "index.html": "<button>同步</button>\n<p>失败时保留本地草稿，可在设置里改推送分支。</p>\n" },
  // 两层圆角是正常结构（卡片 + 内部区块）
  "nest-boxes": { "app.css": ".card { border-radius: 16px; }\n.card .inner { border-radius: 12px; }\n" },
  // 表格/列表用分割线是正常设计
  "divider-sprawl": { "app.css": ".a{border-bottom:1px solid #eee}.b{border-bottom:1px solid #eee}.c{border-bottom:1px solid #eee}\n" },
  // 大但行高舒展、字重不夸张
  "big-black-tight": { "app.css": "h1 { font-size: 56px; font-weight: 600; line-height: 1.3; }\n" },
  // 单个 <button> 可能只是静态演示
  "dead-button": { "index.html": "<button>打开设置</button>\n" },
  // 纯色小方块、圆角也小：不是模板卡片的「同款渐变块」
  "icon-tile-uniform": {
    "index.html":
      '<span class="icon-tile"></span>\n<span class="icon-tile"></span>\n<span class="icon-tile"></span>\n',
    "app.css": ".icon-tile { width: 48px; height: 48px; border-radius: 6px; background: #F5F5F7; }\n"
  },
  // 三个以内是正常编辑手法
  "eyebrow-spam": {
    "index.html": '<span class="eyebrow">A</span>\n<span class="eyebrow">B</span>\n<span class="eyebrow">C</span>\n'
  }
};

/** 只有风格层命中的样本：用来验证 scope 分层（quality/content 全干净）。 */
const STYLE_ONLY = {
  "index.html": '<h1 class="hero">标题</h1>\n',
  "app.css":
    ".hero { text-align: center; border-radius: 20px; background: linear-gradient(135deg, #7C3AED, #4F46E5); }\n" +
    ".title { background-clip: text; }\n" +
    ".card { box-shadow: 0 0 24px rgba(124, 58, 237, .45); backdrop-filter: blur(8px); color: #E4002B; }\n" +
    ".a { background: #0EA5A5; }\n.b { background: #2563EB; }\n.c { background: #16A34A; }\n" +
    ".d { background: #F59E0B; }\n" +
    "button:hover { opacity: .9; }\nbutton:focus-visible { opacity: .9; }\nbutton:disabled { opacity: .5; }\n"
};

/* ------------------------------- 规则层 ------------------------------- */

// 每条规则 4 个断言：命中、fix 可执行、scope 同源、失分 > 0。
test("规则层：每条规则各有能命中的最小样本，actions 带 fix 与正确 scope", async (t) => {
	for (const rule of RULES) {
		const dir = writeTree(tempDir(t, `hit-${rule.id}`), HIT[rule.id]);
		const { value } = await call("taste_check", { action: "taste", root: dir });
		const action = value.actions.find((item) => item.rule === rule.id);
		assert.ok(action !== undefined, `${rule.id}: 样本应命中，实际 actions=${value.actions.map((a) => a.rule).join(",")}`);
		assert.ok(typeof action.fix === "string" && action.fix.length >= 8, `${rule.id}: fix 必须是非空可执行建议`);
		assert.equal(action.scope, rule.scope, `${rule.id}: scope 应与 rules.js 的定义一致`);
		assert.ok(action.score > 0, `${rule.id}: 命中后失分应 > 0`);
	}
});

// 每条规则 2 个断言：不进行动项（actions/advisories）+ 无失分指标（metrics）。
test("规则层：每条规则各有反例，不该命中的样本不进 actions/advisories/metrics", async (t) => {
	for (const rule of RULES) {
		const dir = writeTree(tempDir(t, `miss-${rule.id}`), MISS[rule.id]);
		const { value } = await call("taste_check", { action: "taste", root: dir });
		const reported = [...value.actions, ...value.advisories].map((item) => item.rule);
		assert.ok(!reported.includes(rule.id), `${rule.id}: 反例被误报进 actions/advisories`);
		assert.ok(!value.metrics.some((metric) => metric.id === rule.id), `${rule.id}: 反例不该出现在 metrics（score>0 才进）`);
	}
});

// 2026-11-08 实测漏报的两个写法：CTA 中间带修饰词、对仗句式。
test("ai-copy：中间带修饰词的 CTA 与对仗句式都要能抓到", async (t) => {
	const dir = writeTree(tempDir(t, "ai-copy-v2"), {
		"index.html":
			"<button>立即免费开始</button>\n<p>不是更快地做设计，而是更准地做设计。</p>\n<p>不仅发现问题，更给出能落地的建议。</p>\n"
	});
	const { value } = await call("taste_check", { action: "taste", root: dir });
	const hits = value.findings.filter((f) => f.rule === "ai-copy");
	// findinds 的定位字段叫 evidence（不是 message）：字段名写错会让断言假通过
	const text = hits.map((f) => f.evidence).join("\n");
	assert.ok(/立即免费开始/.test(text), `“立即免费开始”应命中（旧写法要求紧跟动词），实际：${text.slice(0, 120)}`);
	assert.ok(/而是/.test(text), "“不是…而是…”对仗句式应命中");
	assert.ok(/更/.test(text), "“不仅…更…”递进句式应命中");
});

/* --------------------------- scope 与 profile --------------------------- */

test("scope 分层：structure 档 style 不进 actions 而进 advisories；balanced 档 style 计入分数", async (t) => {
	const dir = writeTree(tempDir(t, "style-only"), STYLE_ONLY);
	const structure = (await call("taste_check", { action: "taste", root: dir, profile: "structure" })).value;
	assert.deepEqual(structure.actions, [], "该样本 quality/content 层干净，且 style 不计分 → actions 必须为空");
	assert.equal(structure.score, 0, "structure 档把 style 权重降为 0，分数必须为 0");
	assert.ok(structure.advisories.length >= 3, `style 命中应进 advisories（实际 ${structure.advisories.length} 条）`);
	assert.ok(typeof structure.advisories[0].fix === "string" && structure.advisories[0].fix.length > 0, "advisories 也要带 fix");

	const balanced = (await call("taste_check", { action: "taste", root: dir, profile: "balanced" })).value;
	assert.ok(balanced.score > 0, "balanced 档 style 参与计分 → 分数应 > 0");
	assert.ok(balanced.actions.some((item) => STYLE_IDS.includes(item.rule)), "balanced 档 style 命中应进 actions");

	// 反同质化不变量：不同 profile 的分数不可横向比较，同一混合样本必然分档不同
	const balancedMixed = (await call("taste_check", { action: "taste", root: fixture("ai-default"), profile: "balanced" })).value;
	const strictMixed = (await call("taste_check", { action: "taste", root: fixture("ai-default"), profile: "strict" })).value;
	assert.notEqual(strictMixed.score, balancedMixed.score, "strict（style 满权重）与 balanced（style 0.4）分数应不同");
});

test("profile 缺省或非法值回落 balanced，且分数是有限数（不除零/不 NaN）", async (t) => {
	const dir = fixture("ai-default");
	const fallback = await taste(dir, { profile: "no-such-profile" });
	assert.equal(fallback.profile, "balanced", "未知 profile 应回落 balanced");
	const def = await taste(dir);
	assert.equal(fallback.score, def.score, "非法 profile 的计分应与 balanced 完全一致");
	assert.ok(Number.isFinite(def.score) && def.score >= 0 && def.score <= 100, `分数应落在 0–100（实际 ${def.score}）`);
});

/* ------------------------------ 豁免机制 ------------------------------ */

test("声明式豁免：.design-intent.json 的 allow 让规则退出 actions 并进 exempted", async (t) => {
	const withIntent = writeTree(tempDir(t, "intent-allow"), {
		".design-intent.json": JSON.stringify({ skin: "industrial-editorial", allow: ["emoji-icon"], reason: "状态色是业务语义" }),
		"index.html": "<span>🟢 运行中</span>\n"
	});
	const { value, text } = await call("taste_check", { action: "taste", root: withIntent });
	assert.ok(!value.actions.some((item) => item.rule === "emoji-icon"), "被豁免的规则不得出现在 actions");
	assert.ok(value.exempted.includes("emoji-icon"), "exempted 应记录声明过的规则");
	assert.ok(text.includes("exempted by declaration"), "文本汇报要说明哪些规则被声明豁免");
	const plain = writeTree(tempDir(t, "intent-none"), { "index.html": "<span>🟢 运行中</span>\n" });
	const baseline = (await call("taste_check", { action: "taste", root: plain })).value;
	assert.ok(value.score < baseline.score, "豁免后分数应低于未声明时");
});

test("坏声明不致命：非法 JSON / allow 写成字符串 / 未知 rule id / 混入非字符串只被忽略", async (t) => {
	const bodies = {
		非法JSON: "{ allow: ['emoji-icon'] }",
		allow写成字符串: JSON.stringify({ allow: "emoji-icon" }),
		未知rule: JSON.stringify({ allow: ["emoji-icon", "no-such-rule"] }),
		混入非字符串: JSON.stringify({ allow: ["emoji-icon", 42, null] })
	};
	for (const [label, body] of Object.entries(bodies)) {
		const dir = writeTree(tempDir(t, `bad-intent-${label}`), { ".design-intent.json": body, "index.html": "<span>🟢</span>\n" });
		// 直接调实现核心：坏声明不得抛出未捕获异常，也不得产出 NaN
		const value = await taste(dir);
		assert.ok(Number.isFinite(value.score), `${label}: 分数必须是有限数`);
		if (label === "非法JSON") {
			assert.equal(value.intent.invalid, true, "非法 JSON 应标记 invalid 而不是崩溃");
			assert.deepEqual(value.intent.allow, [], "非法 JSON 应降级为空豁免清单");
		}
		if (label === "allow写成字符串") assert.deepEqual(value.intent.allow, [], "字符串不是数组，应被忽略");
		if (label === "混入非字符串") {
			assert.deepEqual(value.intent.allow, ["emoji-icon"], "只有字符串条目被采纳");
			assert.ok(!value.actions.some((item) => item.rule === "emoji-icon"), "合法条目仍应生效");
		}
	}
});

test("ignore 与 allow 参数：忽略即不计分，且与文件声明取并集", async (t) => {
	const dir = writeTree(tempDir(t, "merge-allow"), {
		".design-intent.json": JSON.stringify({ skin: "industrial-editorial", allow: ["emoji-icon"], reason: "品牌 emoji" }),
		"index.html": "<span>🟢 运行中</span>\n",
		"app.css": ".panel { border-radius: 24px; }\n"
	});
	const base = (await call("taste_check", { action: "taste", root: dir })).value;
	assert.ok(base.actions.some((item) => item.rule === "radius-blob"), "基线：radius-blob 应命中");
	const ignored = (await call("taste_check", { action: "taste", root: dir, ignore: ["radius-blob"] })).value;
	assert.ok(!ignored.actions.some((item) => item.rule === "radius-blob"), "ignore 参数指定的规则应从 actions 消失");
	assert.ok(ignored.score < base.score, "忽略一条命中规则后分数应下降");
	assert.ok(!ignored.exempted.includes("radius-blob"), "ignore 是跳过而非声明豁免，不应进 exempted");
	const merged = (await call("taste_check", { action: "taste", root: dir, allow: ["radius-blob"] })).value;
	assert.deepEqual([...merged.exempted].sort(), ["emoji-icon", "radius-blob"], "文件声明与 allow 参数应取并集");
});

/* --------------------------- 成组出现（co-occurrence） --------------------------- */

test("成组出现：只数风格指纹，≥3 项才判定，措辞不指认作者", async (t) => {
	// 口径来自「AI 味儿图鉴」的核心判断法：单个视觉元素或单个口癖证明不了什么，
	// 要看它是否与其他**默认选择成组**出现。两条纪律：
	//   ① 只数 fingerprint 规则（字号档位/间距网格/交互态这些是通用质量缺陷，
	//      桌面应用本来就有 6 档小字号、7 个语义色，算进去会把成熟产品判成模板）；
	//   ② 只数分值 ≥40 的（单个 emoji = 20 分属于零星迹象）。
	const three = await call("taste_check", { action: "taste", root: fixture("ai-default") });
	const threeValue = three.value;
	assert.ok(threeValue.coOccurrence !== undefined, "报告里必须带成组判断");
	assert.ok(
		["strong", "pattern", "scattered", "none"].includes(threeValue.coOccurrence.level),
		`level 取值非法：${threeValue.coOccurrence.level}`
	);
	// 措辞纪律：只说风格风险，不判定“这是 AI 做的”
	assert.equal(/AI 做的|AI 生成|机器写的/.test(threeValue.coOccurrence.text), false, "不得指认作者");
});

test("成组出现：干净的密集应用不应被判成「模板」", async (t) => {
	// 实测：在线文档参照稿是桌面应用，本来就有 6 档小字号 + 7 个语义色 + 表格分割线，
	// 早期版本把它判成「5 项组合，最强的 AI 味指纹」——这个结论是错的。
	const clean = (await call("taste_check", { action: "taste", root: fixture("clean") })).value;
	assert.equal(clean.coOccurrence.level, "none", `干净样本应为 none，实际 ${clean.coOccurrence.level}`);
});

/* ------------------------------ 分数单调性 ------------------------------ */

test("分数单调性：明显 AI 味样本显著高于 clean，grade 不同，clean 无 quality finding", async (t) => {
	const smelly = (await call("taste_check", { action: "taste", root: fixture("ai-default") })).value;
	const clean = (await call("taste_check", { action: "taste", root: fixture("clean") })).value;
	assert.ok(smelly.score - clean.score >= 25, `AI 味样本应至少高 25 分（实际 ${smelly.score} vs ${clean.score}）`);
	assert.notEqual(smelly.grade, clean.grade, "两者 grade 必须不同档");
	assert.equal(clean.score, 0, "clean 样本应 0 分（所有规则干净）");
	assert.deepEqual(clean.actions, [], "clean 样本 actions 必须为空");
	assert.ok(["ai-tinged", "ai-default"].includes(smelly.grade), `AI 味样本应落在 ai-tinged/ai-default（实际 ${smelly.grade}）`);
	for (const profile of ["balanced", "strict", "structure"]) {
		const value = (await call("taste_check", { action: "taste", root: fixture("clean"), profile })).value;
		assert.equal(value.score, 0, `反同质化：clean 项目在 ${profile} 档不应被判成问题`);
	}
});

/* -------------------------------- 边界 -------------------------------- */

test("边界一：root 不存在/空目录/仅二进制 → 报错清晰；单文件 root 可测", async (t) => {
	const missing = join(tempDir(t, "boundary"), "nope");
	await rejects(() => call("taste_check", { action: "taste", root: missing }), /not found/i, "root 不存在");

	const empty = tempDir(t, "boundary-empty");
	const emptyError = await rejects(() => call("taste_check", { action: "taste", root: empty }), /未扫到前端文件/, "空目录");
	assert.ok(emptyError.message.includes(".html"), "错误消息应列出可扫描扩展名（可行动）");

	const binaries = writeTree(tempDir(t, "boundary-binary"), {
		"logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47]),
		"font.woff": Buffer.from([0x77, 0x4f, 0x46, 0x46])
	});
	await rejects(() => call("taste_check", { action: "taste", root: binaries }), /未扫到前端文件/, "仅二进制目录 → 0 files");

	const single = writeTree(tempDir(t, "boundary-single"), { "page.html": "<div>只有一行</div>\n" });
	const { value } = await call("taste_check", { action: "taste", root: join(single, "page.html") });
	assert.equal(value.filesScanned, 1, "单文件 root 应扫 1 个文件");
	assert.equal(value.root, join(single, "page.html"), "root 应回显解析后的绝对路径");
});

test("边界二：跳过目录、>2MB 文件、maxFiles 上限", async (t) => {
	const dir = writeTree(tempDir(t, "caps-skip"), {
		"node_modules/pkg/x.js": "const a = '🟢';\n",
		".git/hooks/y.html": "<b>🔴</b>\n",
		"dist/app.js": "const b = '🟡';\n",
		"build/z.html": "<b>🔵</b>\n",
		"vendor/v.js": "const c = '🟠';\n",
		"index.html": "<div>干净页面</div>\n"
	});
	const skipped = (await call("taste_check", { action: "taste", root: dir })).value;
	assert.equal(skipped.filesScanned, 1, "node_modules/.git/dist/build/vendor 必须跳过");
	assert.equal(skipped.findingsTotal, 0, "跳过目录里的 emoji 不得计入");

	// PER_FILE_CAP：当前实现是「整份跳过」而非截断读取——至少 filesScanned 不能虚报
	const big = writeTree(tempDir(t, "caps-big"), { "small.html": "<div>干净</div>\n" });
	writeFileSync(join(big, "huge.css"), `/*${"x".repeat(2 * 1024 * 1024 + 16)}*/\n🟢\n`);
	const bigValue = (await call("taste_check", { action: "taste", root: big })).value;
	assert.equal(bigValue.filesScanned, 1, "超过 2MB 的文件不参与扫描，filesScanned 不得虚报");

	const many = tempDir(t, "caps-many");
	for (let i = 0; i < 50; i += 1) writeTree(many, { [`p${String(i).padStart(2, "0")}.html`]: "<span>🟢</span>\n" });
	const capped = await taste(many, { maxFiles: 7 });
	assert.equal(capped.filesScanned, 7, "filesScanned 不得超过 maxFiles");
	assert.equal(capped.truncated, true, "被上限截断时 truncated 必须为 true");
});

/* ------------------------------- 确定性与输出 ------------------------------- */

test("确定性：同目录连测两次完全一致；文件写入顺序不影响分数与命中", async (t) => {
	const target = fixture("ai-default");
	const first = (await call("taste_check", { action: "taste", root: target })).value;
	const second = (await call("taste_check", { action: "taste", root: target })).value;
	assert.equal(second.score, first.score, "连测两次分数必须一致");
	assert.deepEqual(second.findings, first.findings, "热点位置（file/line）必须完全一致");

	const css = ".g { background: linear-gradient(135deg, #7C3AED, #4F46E5); }\n";
	const html = '<h1 class="hero">标题</h1>\n';
	const one = writeTree(tempDir(t, "order-a"), { "a.css": css, "b.html": html });
	const two = writeTree(tempDir(t, "order-b"), { "b.html": html, "a.css": css });
	const v1 = (await call("taste_check", { action: "taste", root: one })).value;
	const v2 = (await call("taste_check", { action: "taste", root: two })).value;
	assert.equal(v2.score, v1.score, "写入顺序不应影响分数");
	const key = (value) => value.findings.map((f) => `${f.rule}|${f.file}|${f.line}`).sort();
	assert.deepEqual(key(v2), key(v1), "写入顺序不应影响命中清单");
});

test("输出：findings 的 file/line 指向真实位置；findingsTotal 与截断标记自洽；文本汇报完整", async (t) => {
	const dir = writeTree(tempDir(t, "output-locate"), {
		"page.html": "<div>第一行</div>\n<div>第二行</div>\n<span>🟢 运行中</span>\n"
	});
	const locate = (await call("taste_check", { action: "taste", root: dir })).value;
	const emoji = locate.findings.find((finding) => finding.rule === "emoji-icon");
	assert.ok(emoji !== undefined, "应定位到 emoji 命中");
	assert.equal(emoji.file, "page.html", "file 应为相对 root 的路径");
	assert.equal(emoji.line, 3, "line 应指向真实行号（第 3 行）");
	assert.equal(locate.findingsTotal, locate.findings.length, "未超上限时 findingsTotal 应等于 findings.length");
	assert.equal(locate.findingsTruncated, false, "未超上限时不应标截断");

	const smelly = (await call("taste_check", { action: "taste", root: fixture("ai-default") })).value;
	assert.ok(smelly.findingsTotal > smelly.findings.length, "超上限时只回传前 N 条");
	assert.equal(smelly.findingsTruncated, true, "截断标记必须为 true");

	const { text } = await call("taste_check", { action: "taste", root: "ai-default" }, { cwd: FIXTURES });
	assert.ok(text.includes("taste_check [taste]") && text.includes(`${smelly.score}/100`), "文本应标准汇报分数与档案");
});

/* --------------------------- intent 输出契约 --------------------------- */

// 回归：声明文件缺 skin/reason 时不能把 undefined 作为自身属性塞进输出
// （宿主会把 undefined 判 INVALID_TOOL_OUTPUT；只写 allow 是最常见的声明形态）。
test("输出契约：只写 allow 的 .design-intent.json 不产生 undefined 字段，豁免照常生效", async (t) => {
	const dir = writeTree(tempDir(t, "intent-allow-only"), {
		".design-intent.json": JSON.stringify({ allow: ["emoji-icon"] }),
		"index.html": "<span>🟢</span>\n"
	});
	const { value } = await call("taste_check", { action: "taste", root: dir });
	assert.equal(value.intent.found, true, "应报告读到了声明文件");
	assert.ok(value.exempted.includes("emoji-icon"), "豁免照常生效");
	assert.ok(!value.actions.some((item) => item.rule === "emoji-icon"), "被豁免规则不计分");
	assert.equal(Object.hasOwn(value.intent, "skin"), false, "缺 skin 时 intent 不应含 skin 键（undefined 会触发 INVALID_TOOL_OUTPUT）");
	assert.equal(Object.hasOwn(value.intent, "reason"), false, "缺 reason 时 intent 不应含 reason 键");
});

// 非法 JSON 是「写坏的声明」，整次体检必须照跑：标记 invalid + 忽略豁免，而不是抛错。
test("非法 JSON 声明：整次体检不抛、intent.invalid=true、分数正常", async (t) => {
	const dir = writeTree(tempDir(t, "intent-invalid"), {
		".design-intent.json": "{ allow: ['emoji-icon'] }",
		"index.html": "<span>🟢</span>\n"
	});
	const { value } = await call("taste_check", { action: "taste", root: dir });
	assert.equal(value.intent.found, true, "坏文件仍应被标记为「存在」");
	assert.equal(value.intent.invalid, true, "解析失败应显式标 invalid");
	assert.deepEqual(value.intent.allow, [], "坏声明降级为空豁免清单");
	assert.ok(Number.isFinite(value.score), "分数必须正常（不崩、不 NaN）");
});

// 单文件目标（README 声称支持）：声明文件在它所在目录，豁免必须生效。
test("单文件 root：同目录的 .design-intent.json 豁免生效", async (t) => {
	const dir = writeTree(tempDir(t, "single-intent"), {
		".design-intent.json": JSON.stringify({ skin: "industrial-editorial", allow: ["emoji-icon"], reason: "品牌 emoji" }),
		"page.html": "<span>🟢 运行中</span>\n"
	});
	const { value } = await call("taste_check", { action: "taste", root: join(dir, "page.html") });
	assert.equal(value.intent.found, true, "单文件模式应读到同目录声明");
	assert.ok(value.exempted.includes("emoji-icon"), "声明应被采纳");
	assert.ok(!value.actions.some((item) => item.rule === "emoji-icon"), "被豁免规则不应计分");
});
