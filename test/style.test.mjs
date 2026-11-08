// test/style.test.mjs — design_style 发布前功能测试。
//
// 主战场是 8 skins × 6 skeletons × 3 formats = 144 组合的全矩阵，
// 外加「反同质化」不变量（4 级字号阶梯的 ≥1.6× 跳变 / 字号签名去重 / accent 唯一 /
// bans 三层齐全 / steps 两两不同）与两个维度的正交性（换骨架不改 token、换皮肤不改结构）。
//
// 已知缺陷用 { todo: "BUG: ..." } 记录，**不修改 lib/、也不为了变绿而放宽断言**。
import assert from "node:assert/strict";
import { test } from "node:test";

import { BANS, SKELETONS, SKINS, SPACE, renderStyle } from "../lib/style.js";
import { RULE_BY_ID } from "../lib/rules.js";
import { call, rejects } from "./helpers.mjs";

const FORMATS = ["css", "json", "tailwind"];
const BAD_TOKENS = ["undefined", "NaN", "[object Object]", "{{", "${"];
const SKELETON_BY_ID = new Map(SKELETONS.map((skeleton) => [skeleton.id, skeleton]));
const px = (value) => Number.parseInt(String(value), 10);
const norm = (value) => String(value).trim().toLowerCase();
/** 装载 tailwind 输出：必须是完整 config（module.exports），返回 theme.extend。 */
function loadTailwindExtend(code) {
	const loaded = new Function("module", `${code}\n;return module.exports;`)({ exports: {} });
	if (loaded?.theme?.extend === undefined) throw new Error("tailwind 输出缺少 theme.extend（不是完整的 tailwind.config.js）");
	return loaded.theme.extend;
}

/* ------------------------------ 全矩阵 ------------------------------ */

function assertMatrixEntry(value, skin, skeleton, format) {
	const where = `${skin.id} × ${skeleton.id} × ${format}`;
	assert.equal(value.skin, skin.id, `${where}: skin 回填错误`);
	assert.equal(value.skeleton, skeleton.id, `${where}: skeleton 回填错误`);
	assert.equal(value.label, `${skin.label} × ${skeleton.label}`, `${where}: label 应为「皮肤 × 骨架」`);
	assert.equal(typeof value.code, "string", `${where}: code 必须是 string`);
	assert.ok(value.code.trim().length > 80, `${where}: code 不应为空（实际 ${value.code.length} 字符）`);
	assert.deepEqual(value.steps, skeleton.steps, `${where}: steps 应来自骨架且逐条一致`);
	assert.equal(value.bans.length, BANS.length, `${where}: bans 数量应与 BANS 一致`);
	assert.deepEqual(value.exempt, skin.exempt, `${where}: exempt 应来自皮肤`);
	for (const token of BAD_TOKENS) assert.ok(!value.code.includes(token), `${where}: code 出现可疑 token「${token}」`);
}

test("全矩阵：8×6×3=144 次 renderStyle 均不抛错、字段回填正确、无坏 token", () => {
	let calls = 0;
	for (const skin of SKINS) {
		for (const skeleton of SKELETONS) {
			for (const format of FORMATS) {
				assertMatrixEntry(renderStyle({ skin: skin.id, skeleton: skeleton.id, format }), skin, skeleton, format);
				calls += 1;
			}
		}
	}
	assert.equal(calls, SKINS.length * SKELETONS.length * FORMATS.length, "组合数必须是 144");
});

/* -------------------------------- css -------------------------------- */

test("css：花括号配平、自定义属性成对、关键 token 与间距齐全", () => {
	let combos = 0;
	for (const skin of SKINS) {
		for (const skeleton of SKELETONS) {
			const { code } = renderStyle({ skin: skin.id, skeleton: skeleton.id, format: "css" });
			const where = `${skin.id} × ${skeleton.id}`;
			combos += 1;
			assert.equal((code.match(/{/g) ?? []).length, (code.match(/}/g) ?? []).length, `${where}: 花括号不配平`);
			assert.match(code, /^:root \{/, `${where}: css 应以 :root { 开头`);
			assert.ok(code.trimEnd().endsWith("}"), `${where}: css 应闭合`);
			// 每个自定义属性声明都必须以分号结束、值非空（防止换行截断/漏分号）
			const props = code.split("\n").filter((line) => line.trim().startsWith("--"));
			assert.ok(props.length >= 20, `${where}: 自定义属性只有 ${props.length} 条，疑似缺失 token`);
			for (const line of props) assert.match(line.trim(), /^--[\w-]+:\s*\S.*;$/, `${where}: 自定义属性缺分号/值 → ${line.trim()}`);
			assert.ok(code.includes(`--c-accent: ${skin.color.accent};`), `${where}: 缺 --c-accent 或与皮肤不符`);
			assert.ok(code.includes(`--text-display: ${skin.typeScale.display};`), `${where}: 缺 --text-display`);
			for (const [key, value] of Object.entries(SPACE)) {
				assert.ok(code.includes(`--space-${key}: ${value};`), `${where}: 缺间距 token --space-${key}`);
			}
		}
	}
	assert.equal(combos, SKINS.length * SKELETONS.length, "css 组合数应为 48");
});

test("间距体系：6 档以上、全部落在 4px 网格、正数", () => {
	const values = Object.values(SPACE);
	assert.ok(values.length >= 6, `间距至少 6 档，实际 ${values.length}`);
	for (const value of values) {
		const n = px(value);
		assert.ok(Number.isInteger(n) && n > 0, `间距「${value}」必须是正整数 px`);
		assert.equal(n % 4, 0, `间距「${value}」不在 4px 网格上`);
	}
});

/* -------------------------------- json ------------------------------- */

test("json：必须能被 JSON.parse，且解析结果与皮肤/骨架数据一致", () => {
	let combos = 0;
	for (const skin of SKINS) {
		for (const skeleton of SKELETONS) {
			const { code } = renderStyle({ skin: skin.id, skeleton: skeleton.id, format: "json" });
			const where = `${skin.id} × ${skeleton.id}`;
			combos += 1;
			let parsed;
			try {
				parsed = JSON.parse(code);
			} catch (error) {
				assert.fail(`${where}: 模型会直接把 code 贴进项目，json 必须可解析（${error.message}）`);
			}
			assert.equal(parsed.skin.id, skin.id, `${where}: json.skin.id`);
			assert.equal(parsed.skeleton.id, skeleton.id, `${where}: json.skeleton.id`);
			assert.deepEqual(parsed.color, skin.color, `${where}: json.color 应与皮肤一致`);
			assert.deepEqual(parsed.type, skin.typeScale, `${where}: json.type 应与皮肤一致`);
			assert.deepEqual(parsed.space, SPACE, `${where}: json.space 应与全局间距一致`);
			assert.deepEqual(parsed.exempt, skin.exempt, `${where}: json.exempt 应与皮肤一致`);
			assert.deepEqual(JSON.parse(JSON.stringify(parsed)), parsed, `${where}: json 应能无损往返`);
		}
	}
	assert.equal(combos, SKINS.length * SKELETONS.length, "json 组合数应为 48");
});

/* ------------------------------ tailwind ----------------------------- */

test("tailwind：完整 config 可独立解析/装载（8×6 全矩阵），且主题值与皮肤一致", () => {
	let combos = 0;
	for (const skin of SKINS) {
		for (const skeleton of SKELETONS) {
			const { code } = renderStyle({ skin: skin.id, skeleton: skeleton.id, format: "tailwind" });
			const where = `${skin.id} × ${skeleton.id}`;
			combos += 1;
			let theme;
			try {
				assert.doesNotThrow(() => new Function(code), `${where}: tailwind 输出应能独立通过语法解析`);
				theme = loadTailwindExtend(code);
			} catch (error) {
				assert.fail(`${where}: tailwind 输出无法解析为 theme.extend（${error.message}）`);
			}
			assert.equal(theme.colors.accent, skin.color.accent, `${where}: colors.accent`);
			assert.equal(theme.fontSize.display, skin.typeScale.display, `${where}: fontSize.display`);
			assert.equal(theme.borderRadius.sm, skin.radius["1"], `${where}: borderRadius.sm`);
			assert.equal(theme.boxShadow["1"], skin.shadow, `${where}: boxShadow.1`);
			assert.ok(Array.isArray(theme.fontFamily.sans), `${where}: fontFamily.sans 应为数组`);
		}
	}
	assert.equal(combos, SKINS.length * SKELETONS.length, "tailwind 组合数应为 48");
});

test("tailwind：输出是完整可粘贴的 tailwind.config.js（可被 require 装载）", () => {
	for (const skin of SKINS) {
		const { code } = renderStyle({ skin: skin.id, format: "tailwind" });
		assert.doesNotThrow(() => new Function(code), `${skin.id}: 输出应能独立通过语法解析（node --check 等价）`);
		assert.match(code, /module\.exports\s*=/, `${skin.id}: 应包含 module.exports 包裹，而不是裸 extend 片段`);
		const loaded = new Function("module", `${code}\n;return module.exports;`)({ exports: {} });
		assert.equal(loaded.theme.extend.fontSize.display, skin.typeScale.display, `${skin.id}: require 后 theme.extend 值应正确`);
		assert.equal(loaded.theme.extend.colors.accent, skin.color.accent, `${skin.id}: require 后 accent 应正确`);
	}
});

/* --------------------------- 反同质化不变量 --------------------------- */

test("反同质化：每个皮肤 4 级字号阶梯至少有一次 ≥1.6× 跳变且严格递增", () => {
	for (const skin of SKINS) {
		const levels = ["micro", "body", "head", "display"].map((key) => px(skin.typeScale[key]));
		assert.deepEqual(Object.keys(skin.typeScale).sort(), ["body", "display", "head", "micro"], `${skin.id}: 字号必须正好 4 档`);
		for (let i = 1; i < levels.length; i += 1) assert.ok(levels[i] > levels[i - 1], `${skin.id}: 字号阶梯应严格递增（${levels.join("/")}）`);
		const maxJump = Math.max(...levels.slice(1).map((value, i) => value / levels[i]));
		assert.ok(maxJump >= 1.6, `${skin.id}: 最大字号跳变 ${maxJump.toFixed(3)}× < 1.6×（阶梯 ${levels.join("/")}）`);
	}
});

test("反同质化：typeScale 签名去重 ≥5、accent 归一化后互不相同、色板不全同", () => {
	const signatures = new Set(SKINS.map((skin) => Object.values(skin.typeScale).join("/")));
	assert.ok(signatures.size >= 5, `8 个皮肤只有 ${signatures.size} 套字号签名，低于 5 会重新制造单一审美`);
	const accents = SKINS.map((skin) => norm(skin.color.accent));
	assert.equal(new Set(accents).size, SKINS.length, `accent 色必须两两不同，重复：${accents.join(" ")}`);
	for (let i = 0; i < SKINS.length; i += 1) {
		for (let j = i + 1; j < SKINS.length; j += 1) {
			assert.notDeepEqual(SKINS[i].color, SKINS[j].color, `${SKINS[i].id} 与 ${SKINS[j].id} 色板完全相同`);
		}
	}
});

test("反同质化：每个骨架 ≥4 条步骤且两两不同；跨皮肤默认结构不全同", () => {
	const firstSteps = new Set();
	for (const skeleton of SKELETONS) {
		assert.ok(skeleton.steps.length >= 4, `${skeleton.id}: 步骤应 ≥4 条，实际 ${skeleton.steps.length}`);
		assert.equal(new Set(skeleton.steps).size, skeleton.steps.length, `${skeleton.id}: steps 有重复条目`);
		for (const step of skeleton.steps) assert.ok(step.trim().length >= 6, `${skeleton.id}: 存在空/过短步骤「${step}」`);
		firstSteps.add(skeleton.steps[0]);
	}
	assert.equal(firstSteps.size, SKELETONS.length, "不同骨架的首条步骤文案不应雷同");
	for (let i = 0; i < SKELETONS.length; i += 1) {
		for (let j = i + 1; j < SKELETONS.length; j += 1) {
			assert.notDeepEqual(SKELETONS[i].steps, SKELETONS[j].steps, `${SKELETONS[i].id} 与 ${SKELETONS[j].id} 结构步骤雷同`);
		}
	}
	// 默认骨架决定了各皮肤默认输出结构：签名应恰好对应所用的骨架集合（正交性的体现，而不是全同）
	const defaultSignatures = new Set(SKINS.map((skin) => renderStyle({ skin: skin.id }).steps.join("\n")));
	const usedSkeletons = new Set(SKINS.map((skin) => skin.defaultSkeleton));
	assert.ok(defaultSignatures.size > 1, "8 个皮肤的默认结构全部相同");
	assert.equal(defaultSignatures.size, usedSkeletons.size, "默认结构签名数应与实际用到的骨架数一致");
});

test("反同质化：bans 三层齐全、scope 合法、每条 text 非空且不重复", () => {
	const scopes = new Set(BANS.map((ban) => ban.scope));
	assert.deepEqual([...scopes].sort(), ["content", "quality", "style"], "bans 必须覆盖 quality / style / content 三层");
	const texts = new Set();
	for (const ban of BANS) {
		assert.ok(typeof ban.text === "string" && ban.text.trim() !== "", `ban.text 不能为空（${JSON.stringify(ban)}）`);
		assert.ok(!texts.has(ban.text), `ban.text 重复：${ban.text}`);
		texts.add(ban.text);
		assert.match(String(ban.id ?? ""), /^[a-z][a-z0-9-]+$/, `ban 必须带合法 id：${JSON.stringify(ban)}`);
		assert.ok(RULE_BY_ID.has(ban.id), `ban id「${ban.id}」必须与 rules.js 规则 id 同源（否则 exemptions 无法对齐）`);
	}
	assert.deepEqual(
		BANS.map((ban) => ban.id).sort(),
		[...RULE_BY_ID.keys()].sort(),
		"bans 的 id 集合应与 rules.js 完全一致（两套清单不能漂移）"
	);
	const quality = BANS.filter((ban) => ban.scope === "quality").map((ban) => ban.text).join("\n");
	assert.match(quality, /1\.6/, "quality 层应包含 ≥1.6× 字号阶梯这条底线");
	assert.match(quality, /4px/, "quality 层应包含 4px 网格这条底线");
});

/* ------------------------------ 正交混搭 ------------------------------ */

test("混搭正交性：换骨架只改结构、换皮肤只改 token", () => {
	const pivot = SKINS[0];
	const colorSigs = new Set();
	const stepSigs = new Set();
	for (const skeleton of SKELETONS) {
		const value = renderStyle({ skin: pivot.id, skeleton: skeleton.id, format: "json" });
		const parsed = JSON.parse(value.code);
		colorSigs.add(JSON.stringify(parsed.color));
		stepSigs.add(value.steps.join("\n"));
		assert.deepEqual(parsed.font, pivot.font, `${pivot.id}: 换骨架不应改动字体栈`);
	}
	assert.equal(colorSigs.size, 1, "同一皮肤换 6 个骨架，颜色 token 必须完全不变");
	assert.equal(stepSigs.size, SKELETONS.length, "换骨架必须改变结构步骤");
	// 固定骨架换皮肤：结构不变、色板必须变
	const fixed = SKELETON_BY_ID.get("landing");
	const skinColorSigs = new Set();
	const stepCounts = new Set();
	for (const skin of SKINS) {
		const value = renderStyle({ skin: skin.id, skeleton: fixed.id, format: "json" });
		skinColorSigs.add(JSON.stringify(JSON.parse(value.code).color));
		stepCounts.add(value.steps.length);
		assert.deepEqual(value.steps, fixed.steps, `${skin.id}: 换皮肤不应改动结构步骤`);
	}
	assert.equal(stepCounts.size, 1, "固定骨架时各皮肤 steps 条数应一致");
	assert.equal(skinColorSigs.size, SKINS.length, "换皮肤必须改变颜色 token");
});

/* -------------------------------- exempt ------------------------------- */

test("exempt：有豁免的皮肤，其规则 id 必须真实存在于规则表（防拼写错误）", () => {
	const withExempt = SKINS.filter((skin) => skin.exempt.length > 0);
	assert.ok(withExempt.length >= 1, "至少应有一个声明了有意偏离的皮肤");
	for (const skin of withExempt) {
		for (const id of skin.exempt) {
			assert.ok(RULE_BY_ID.has(id), `${skin.id}: exempt「${id}」不是任何真实规则 id，豁免永远不会生效`);
		}
	}
});

test("tokens 覆盖：封闭枚举不再是天花板，任意风格都能用一组 token 表达", () => {
	// 动机：拿设计风格分类站（24 个风格）对账，发现 8 个内置 skin 只能表达 8 个直接 +
	// 7 个部分，剩下 9 个（扁平 / Y2K / Art Deco / 有机自然 / Material / 拟物 …）无路可走——
	// 因为 skin 是**封闭枚举**。而插件的定位是「给框架不给目录」：风格应该被描述出来。
	const flat = renderStyle({ skin: "swiss-minimal", skeleton: "landing", format: "css", tokens: "shadow=none;radius=0;accent=#3B5BDB" });
	assert.match(flat.skin, /\+tokens$/, "用了 tokens 应在 skin 名上标出来");
	assert.match(flat.code, /--shadow-1:\s*none/);
	assert.match(flat.code, /--radius-2:\s*0px/, "radius=0 应归一化成 0px");
	assert.match(flat.code, /--c-accent:\s*#3B5BDB/);

	// 尺寸类 token 写不写单位都得对（实测裸数字会输出 `--radius-2: 18` 这种无效值）
	const y2k = renderStyle({ skin: "brutalist", skeleton: "landing", format: "css", tokens: "radius=18;border=2" });
	assert.match(y2k.code, /--radius-2:\s*18px/);
	assert.match(y2k.code, /--line:\s*2px solid/);
	// radius 要派生出另两档，否则其余档位还是原 skin 的值，混着用会跳
	assert.match(y2k.code, /--radius-1:/);
	assert.match(y2k.code, /--radius-3:/);

	// 颜色/字体维度都要能改（Art Deco：零圆角 + 金 + 衬线）
	const deco = renderStyle({ skin: "quiet-luxe", skeleton: "landing", format: "json", tokens: 'ground=#0E0B08;accent=#C9A227;font="Georgia",serif' });
	const parsed = JSON.parse(deco.code);
	assert.equal(parsed.color.paper, "#0E0B08");
	assert.equal(parsed.color.accent, "#C9A227");
	assert.match(String(parsed.font.body), /Georgia/);

	// 不传 tokens 时必须完全等于原 skin（不能因合并引入副作用）
	const plain = renderStyle({ skin: "swiss-minimal", skeleton: "landing", format: "css" });
	assert.equal(plain.skin, "swiss-minimal", "没传 tokens 时 skin 名不应带 +tokens");

	// 未知 token 要报错并列出可用键，不能默默忽略
	assert.throws(() => renderStyle({ skin: "swiss-minimal", tokens: "nonsense=1" }), /unknown token/);
});

test("机制层 token：图案/形状/有机圆角/双线/字距/动效/栅格都能下发", () => {
	// 把市面上的风格拆开看，绝大多数只是少数几种**实现手段**的组合：
	// 渐变填充、图案层、任意形状、描边、双线、动效档位、栅格配方。
	// 这些手段是通用的（项目规范各不相同，但手段相同），所以补手段而不是补风格。
	const css = renderStyle({
		skin: "brutalist", skeleton: "landing", format: "css",
		tokens:
			"pattern=radial-gradient(#141414 1.5px,transparent 1.6px);" +
			"clip=polygon(0 0,100% 0,88% 100%,0 100%);" +
			"organic=42% 58% 55% 45% / 48% 42% 58% 52%;" +
			"double=0 0 0 1px #6B5832,0 0 0 4px #0B0906,0 0 0 5px #C9A227;" +
			"tracking=.14em;dur=180ms;ease=cubic-bezier(.2,.7,.3,1);grid=repeat(4,1fr)"
	});
	assert.match(css.code, /--pattern:\s*radial-gradient/);
	assert.match(css.code, /--clip:\s*polygon/);
	assert.match(css.code, /--radius-organic:\s*42% 58%/);
	assert.match(css.code, /--double-line:\s*0 0 0 1px/);
	assert.match(css.code, /--tracking:\s*\.14em/);
	assert.match(css.code, /--dur:\s*180ms/);
	assert.match(css.code, /--grid:\s*repeat\(4,1fr\)/);

	// 渐变作为填充值（Y2K / 拟物 / 苹果官网都在用）必须能过——它走的是普通颜色 token
	const grad = renderStyle({ skin: "brutalist", skeleton: "landing", format: "css", tokens: "ground=linear-gradient(160deg,#1A1240,#5B3FD8)" });
	assert.match(grad.code, /--c-paper:\s*linear-gradient\(160deg/);

	// json 格式也必須带机制钩子：否则按 token 生成 HTML 的构建脚本拿不到值，机制等于白加
	const json = JSON.parse(renderStyle({ skin: "brutalist", skeleton: "landing", format: "json", tokens: "clip=polygon(0 0,100% 0,0 100%)" }).code);
	assert.equal(json.mech.clip, "polygon(0 0,100% 0,0 100%)");

	// 未知 token 的报错要同时列出填充键与机制键（自文档化，不在 schema 里堆 20 个键名）
	assert.throws(() => renderStyle({ skin: "swiss-minimal", tokens: "nope=1" }), /机制：/);
});

test("exempt：规则 id 必须能在 design_style 输出的 bans 里映射到具体条目", () => {
	for (const skin of SKINS.filter((entry) => entry.exempt.length > 0)) {
		const value = renderStyle({ skin: skin.id });
		for (const id of value.exempt) {
			const ban = value.bans.find((entry) => entry.id === id);
			assert.ok(ban !== undefined, `${skin.id}: bans 里应存在 id=${id} 的条目（否则豁免无法解释）`);
			assert.equal(ban.scope, "style", `${skin.id}: exempt 规则 ${id} 应属于可豁免的 style 层`);
			assert.ok(ban.text.length > 0, `${skin.id}: ban ${id} 应有文案`);
		}
	}
});

/* ------------------------- 缺省值与错误路径 ------------------------- */

test("缺省值：skeleton 回落到皮肤默认骨架、format 默认 css、name 旧参数仍可用", () => {
	for (const skin of SKINS) {
		const value = renderStyle({ skin: skin.id });
		const skeleton = SKELETON_BY_ID.get(skin.defaultSkeleton);
		assert.equal(value.skeleton, skin.defaultSkeleton, `${skin.id}: 缺省 skeleton 应为 ${skin.defaultSkeleton}`);
		assert.equal(value.label, `${skin.label} × ${skeleton.label}`, `${skin.id}: 缺省 label`);
		assert.match(value.code, /^:root \{/, `${skin.id}: 缺省 format 应为 css`);
	}
	assert.equal(renderStyle({ name: "swiss-minimal" }).skin, "swiss-minimal", "name 旧参数名应继续可用");
});

test("错误路径：未知 skin / skeleton / format 必须清晰报错，不得静默产出空 code", async () => {
	// 工具层：宿主 schema 的 enum 先行拦截
	await rejects(() => call("design_style", { skin: "not-a-skin" }), /invalid arguments|unknown skin/, "工具层未知 skin");
	await rejects(() => call("design_style", { skin: "swiss-minimal", skeleton: "not-a-skeleton" }), /invalid arguments|unknown skeleton/, "工具层未知 skeleton");
	await rejects(() => call("design_style", { skin: "swiss-minimal", format: "sass" }), /invalid arguments|unknown format/, "工具层非法 format");
	await rejects(() => call("design_style", {}), /invalid arguments|skin/, "工具层缺 skin");
	// lib 层：直接调用时错误信息必须可行动（含可用值清单）
	await rejects(() => renderStyle({ skin: "not-a-skin" }), /unknown skin .*可用/, "lib 层未知 skin");
	await rejects(() => renderStyle({}), /需要 skin/, "lib 层缺 skin");
	await rejects(() => renderStyle({ skin: "swiss-minimal", skeleton: "not-a-skeleton" }), /unknown skeleton .*可用/, "lib 层未知 skeleton");
	await rejects(() => renderStyle({ skin: "swiss-minimal", format: "yaml" }), /unknown format .*可用/, "lib 层非法 format");
});

/* --------------------------- 交互层（motion） --------------------------- */

const MOTION_VARS = [
	"--dur", "--ease", "--t-fast", "--t-base", "--t-slow",
	"--press", "--lift", "--focus-ring", "--ripple", "--stagger", "--reveal", "--shimmer"
];
const MOTION_PRIMITIVES = ["press", "lift", "focus", "ripple", "enter", "stagger", "reveal", "shimmer"];

test("motion：8 皮肤都产出完整交互原语，花括号配平、变量齐全、无坏 token", () => {
	for (const skin of SKINS) {
		const where = `${skin.id} × motion`;
		const { code } = renderStyle({ skin: skin.id, format: "motion" });
		for (const name of MOTION_VARS) assert.ok(code.includes(`${name}:`), `${where}: 缺变量 ${name}`);
		for (const name of MOTION_PRIMITIVES) assert.ok(code.includes(`[data-motion~="${name}"]`), `${where}: 缺原语 ${name}`);
		for (const frame of ["artkit-enter", "artkit-ripple", "artkit-shimmer"]) {
			assert.ok(code.includes(`@keyframes ${frame}`), `${where}: 缺关键帧 ${frame}`);
		}
		assert.equal((code.match(/\{/g) ?? []).length, (code.match(/\}/g) ?? []).length, `${where}: 花括号不配平`);
		for (const token of BAD_TOKENS) assert.ok(!code.includes(token), `${where}: 出现可疑 token「${token}」`);
	}
});

test("motion：只挂属性钩子、焦点环只走 :focus-visible（不占 class 命名空间、不误伤鼠标点击）", () => {
	for (const skin of SKINS) {
		const { code } = renderStyle({ skin: skin.id, format: "motion" });
		// 注释里会出现 `:focus` / `.5` 这类教学文本，断言必须只看真实规则
		const rules = code.replace(/\/\*[\s\S]*?\*\//g, "");
		assert.ok(!/^\s*\.[a-zA-Z]/m.test(rules), `${skin.id}: 不应出现 class 选择器（会与使用者的 .press/.lift 撞名）`);
		assert.ok(!/:focus(?!-visible)/.test(rules), `${skin.id}: 焦点环必须用 :focus-visible`);
		assert.ok(!/:hover:focus-visible/.test(rules), `${skin.id}: hover 与 focus 不应合并成一条（键盘用户悬停不到）`);
	}
});

test("motion：机制 token 驱动变量，时间类自动补 ms，两层产物读同一份 token", () => {
	const tokens = "dur=90;stagger=25;press=scale(.9);ease=linear";
	const motion = renderStyle({ skin: "swiss-minimal", format: "motion", tokens }).code;
	assert.ok(motion.includes("--dur: 90ms;"), "dur=90 应归一为 90ms（否则 calc 整条失效且不报错）");
	assert.ok(motion.includes("--stagger: 25ms;"), "stagger=25 应归一为 25ms");
	assert.ok(motion.includes("--press: scale(.9);"), "press 覆盖未生效");
	assert.ok(motion.includes("--ease: linear;"), "ease 覆盖未生效");

	const css = renderStyle({ skin: "swiss-minimal", format: "css", tokens: "dur=90;press=scale(.9)" }).code;
	assert.ok(css.includes("--dur: 90ms;"), "视觉层也应输出 --dur（两层对不上会各自跑一套时序）");
	assert.ok(css.includes("--press: scale(.9);"), "视觉层也应输出 --press");

	const json = JSON.parse(renderStyle({ skin: "swiss-minimal", format: "json", tokens: "dur=90;press=scale(.9)" }).code);
	assert.equal(json.mech.dur, "90ms", "json 缺 mech.dur，按 token 生成 HTML 的构建脚本拿不到时序");
	assert.equal(json.mech.press, "scale(.9)", "json 缺 mech.press");
});

test("motion：prefers-reduced-motion 兜底必须存在，且把 reveal 的 opacity 补回可见", () => {
	for (const skin of SKINS) {
		const { code } = renderStyle({ skin: skin.id, format: "motion" });
		const at = code.indexOf("@media (prefers-reduced-motion: reduce)");
		assert.ok(at >= 0, `${skin.id}: 缺 reduced-motion 兜底（无障碍底线，不是风格）`);
		const block = code.slice(at);
		assert.match(block, /transition-duration:\s*\.01ms\s*!important/, `${skin.id}: 兜底未压缩过渡`);
		assert.match(block, /animation-duration:\s*\.01ms\s*!important/, `${skin.id}: 兜底未压缩动画`);
		assert.match(
			block,
			/\[data-motion~="reveal"\]\s*\{\s*opacity:\s*1;/,
			`${skin.id}: reveal 初始 opacity:0，兜底必须补回 1，否则内容永久消失`
		);
	}
});

/* ------------------------------ 工具层 ------------------------------- */

test("工具层：format=motion 全链路可用（schema 放行 + 文本含 code）", async () => {
	const { value, text } = await call("design_style", { skin: "quiet-luxe", format: "motion" });
	assert.ok(value.code.includes("@media (prefers-reduced-motion: reduce)"), "工具层 motion 输出应含兜底");
	assert.ok(text.includes(value.code), "工具层文本应包含完整 code");
});

test("工具层：三组 ban 分组标题齐全、顺序正确、exempt 提示按需出现", async () => {
	const plain = await call("design_style", { skin: "industrial-editorial", skeleton: "landing" });
	const titles = ["quality floor（不可协商）", "style advice（可声明豁免）", "content:"];
	const indexes = titles.map((title) => plain.text.indexOf(title));
	for (let i = 0; i < titles.length; i += 1) assert.ok(indexes[i] >= 0, `工具文本缺少分组标题「${titles[i]}」`);
	assert.ok(indexes[0] < indexes[1] && indexes[1] < indexes[2], "三组 ban 应以 quality → style → content 顺序出现");
	assert.ok(plain.text.includes(plain.value.code), "工具文本应包含完整 code");
	assert.ok(plain.text.includes("结构配方："), "工具文本应包含结构配方标题");
	assert.ok(!plain.text.includes("本皮肤有意偏离"), "无 exempt 的皮肤不应出现豁免提示");
	const banLines = plain.text.split("\n").filter((line) => line.startsWith("- "));
	assert.equal(banLines.length, BANS.length, "三组 ban 的条目总数应与 BANS 一致");

	const brutal = await call("design_style", { skin: "brutalist", skeleton: "landing" });
	assert.ok(brutal.text.includes("本皮肤有意偏离：hue-sprawl"), "有 exempt 的皮肤应给出豁免提示");
});

test("工具层：call() 全链路（8 皮肤 × 3 格式）输出 schema 与无损校验通过", async () => {
	for (const skin of SKINS) {
		for (const format of FORMATS) {
			const { value, text } = await call("design_style", { skin: skin.id, format });
			assert.equal(value.skin, skin.id, `${skin.id}×${format}: 工具层 skin 回填`);
			assert.equal(value.skeleton, skin.defaultSkeleton, `${skin.id}×${format}: 工具层默认 skeleton`);
			assert.equal(typeof value.code, "string", `${skin.id}×${format}: code 类型`);
			assert.ok(text.includes(value.code), `${skin.id}×${format}: 文本未包含 code`);
		}
	}
});
