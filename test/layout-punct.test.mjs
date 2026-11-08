// test/layout-punct.test.mjs — 中文标点 / 排版规则（auditPunct，punct- 12 条）的发布前测试。
//
// 覆盖：
//   1. 契约：12 条规则 id、空/非法输入、纯字符串段兼容；
//   2. 干净中文零发现、纯英文零 error（英文语境只允许 info）；
//   3. 每条规则一组「该命中」+「不该命中」表驱动正反例（含豁免条款的反例）；
//   4. 一段中文同时含 5 种问题 → 正好命中对应 5 条规则；
//   5. 代码块不误报（责任在上游 source.js，本模块假设已剥离）；
//   6. finding 字段完整（fix / where / 片段 ≤24 字）、每规则单文件封顶 3 条、
//      确定性、10 万字 < 200ms。
//
// 为什么全是纯单测：auditPunct 是纯函数，不入文件系统、不读源码 —— 它吃的 segments
// 由 source.js 的 textSegments() 准备好，引号/字符串边界那层事在那边。
// 断言消息一律中文，失败时能直接看出是哪条标点规则、哪个反例破了。
import assert from "node:assert/strict";
import { test } from "node:test";

import { auditPunct, PUNCT_RULE_IDS } from "../lib/layouts/rules-punct.js";

/* ------------------------------ 小工具 ------------------------------ */

/** 单个文本段（默认一个「文件:行」位置，方便断言 where 透传）。 */
const seg = (text, where = "page.html:1") => [{ text, where }];
const rulesOf = (findings) => [...new Set(findings.map((f) => f.rule))].sort();
const hit = (findings, rule) => findings.filter((f) => f.rule === rule);
const has = (findings, rule) => hit(findings, rule).length > 0;

/**
 * 表驱动断言（每条规则一行）：
 *   rule / severity —— 该命中的规则与档位；
 *   bad —— 「该命中」样本，必须报出 rule，且档位对；
 *   good —— 「不该命中」反例，必须零发现（宁可漏报也不能误报）；
 *   onlyBad —— bad 样本只允许命中这一条规则（真实坏文本常同时命中多条，
 *              所以只有单一问题的样本才要求它）。
 */
function checkRows(rows) {
	for (const row of rows) {
		for (const text of row.bad) {
			const findings = auditPunct([{ text, where: `${row.rule}.html:1` }]);
			const own = hit(findings, row.rule);
			assert.ok(own.length > 0, `${row.rule}：样本「${text}」该命中却没报（实际 ${rulesOf(findings)}）`);
			assert.equal(own[0].severity, row.severity, `${row.rule}：severity 应为 ${row.severity}，实际 ${own[0].severity}`);
			if (row.onlyBad === true) {
				assert.deepEqual(rulesOf(findings), [row.rule], `${row.rule}：样本「${text}」不该连带触发其它规则（实际 ${rulesOf(findings)}）`);
			}
		}
		for (const text of row.good) {
			const findings = auditPunct([{ text, where: `good-${row.rule}.html:1` }]);
			assert.deepEqual(findings, [], `${row.rule}：反例「${text}」不该报，实际 ${rulesOf(findings)}`);
		}
	}
}

/* ------------------------------ 1. 契约 ------------------------------ */

test("契约：auditPunct 同步返回数组，12 条 punct- 规则，空/非法输入不抛错", () => {
	assert.equal(typeof auditPunct, "function", "auditPunct 必须是函数");
	assert.equal(PUNCT_RULE_IDS.length, 12, "规则集必须是 12 条");
	assert.equal(new Set(PUNCT_RULE_IDS).size, 12, "规则 id 不得重复");
	for (const id of PUNCT_RULE_IDS) assert.match(id, /^punct-[a-z-]+$/, `规则 id 必须 punct- 前缀：${id}`);
	assert.deepEqual(auditPunct([]), [], "空数组 → 无发现");
	assert.deepEqual(auditPunct(undefined), [], "缺参 → 无发现（不抛错）");
	assert.deepEqual(auditPunct(null), [], "null → 无发现");
	assert.deepEqual(auditPunct([{ text: "", where: "a.html:1" }]), [], "空文本段跳过");
	assert.deepEqual(auditPunct([null, 42, {}]), [], "非文本项跳过");
	assert.equal(auditPunct(["你好,世界。"]).length, 1, "纯字符串数组也接（当 where 为空）");
});

/* ------------------------------ 2. 干净中文 ------------------------------ */

/** 干净样本：全角标点、弯引号、括号紧贴、破折号无空格、省略号两个、中英混排有空格。 */
const CLEAN =
	"这是一段干净的中文文本。全角标点齐全，引号用“弯引号”，括号（紧贴内容）也没有多余空格；破折号——这样用；省略号……只用两个。React 与 Vue 之间留了空格，第 3 章也留了空格。";

test("干净中文文本：零 findings（十二条规则都不该误报）", () => {
	const findings = auditPunct(seg(CLEAN));
	assert.deepEqual(findings, [], `干净样本不该有任何发现（实际 ${JSON.stringify(findings.map((f) => `${f.rule}:${f.message}`))}）`);
	// 同内容拆成多段（模拟逐行提取）：段边界不应制造新问题（如括号/引号被切开）
	const paragraphs = CLEAN.split(/[。；]/)
		.filter((part) => part !== "")
		.map((part, index) => ({ text: part, where: `doc.html:${index + 1}` }));
	assert.ok(paragraphs.length >= 4, "拆分样本应有多个段");
	assert.deepEqual(auditPunct(paragraphs), [], "分段后的同内容也必须干净");
});

/* ------------------------------ 3. 纯英文 ------------------------------ */

/** 纯英文样本：直引号 + 撇号 + em dash + 千分位（英文用法全部正当）。 */
const ENGLISH = 'A clean English paragraph: "quoted terms", it\'s fine, an em dash — like this, and 3,000 words.';

test("纯英文文本（hasCJK:false）：零 error，直引号只给 info", () => {
	const findings = auditPunct(seg(ENGLISH), { hasCJK: false });
	assert.equal(
		findings.filter((f) => f.severity === "error").length,
		0,
		`英文语境不得出现 error（实际 ${JSON.stringify(findings.map((f) => `${f.rule}:${f.severity}`))}）`
	);
	for (const entry of findings) {
		assert.equal(entry.severity, "info", `英文语境只给 info：${entry.rule}=${entry.severity}`);
		assert.equal(entry.rule, "punct-straight-quote", `英文语境多报了不该管的规则：${entry.rule}`);
	}
	assert.ok(has(findings, "punct-straight-quote"), "英文文本里的直引号应给 info 提示");
	assert.ok(!has(findings, "punct-fullwidth-latin"), "英文语境下全角标点规则静默");
	assert.ok(!has(findings, "punct-halfwidth-cjk"), "英文语境下半角标点规则静默");
	assert.ok(!has(findings, "punct-paren-space"), "英文语境下括号内侧空格规则静默");
	assert.ok(!has(findings, "punct-quote-nesting"), "英文语境下引号嵌套规则静默");
});

/* ------------------------------ 4. 表驱动 A：引号与连字符 ------------------------------ */

test("规则表驱动 A：直引号、连写连字符（含撇号 / CSS 变量反例）", () => {
	checkRows([
		{
			rule: "punct-straight-quote",
			severity: "error",
			onlyBad: true,
			bad: ['他说"这个方案不行"。'],
			// 弯引号 / 英文撇号 it's / 英制英寸 5" 都不该报
			good: ["他说“这个方案不行”。", "别写 don't 这种缩写。", '屏幕宽 5" 的机型。']
		},
		{
			rule: "punct-double-hyphen",
			severity: "warn",
			onlyBad: true,
			bad: ["这个问题--很重要。"],
			// 中文双破折号 / CSS 自定义属性 var(--gap) 都不该报
			good: ["这个问题——很重要。", "样式里 var(--gap) 变量别直接写值。"]
		}
	]);
});

/* ------------------------------ 5. 表驱动 B：半角点与省略号 ------------------------------ */

test("规则表驱动 B：三个半角点、省略号连写过多（含版本号反例）", () => {
	checkRows([
		{
			rule: "punct-three-dots",
			severity: "warn",
			onlyBad: true,
			bad: ["等等...还有别的。"],
			good: ["等等……还有别的。", "版本 1.2.3 的说明。"]
		},
		{
			rule: "punct-ellipsis-count",
			severity: "info",
			onlyBad: true,
			bad: ["等等………然后呢。"],
			// 两个 …… 是规范写法，单个 … 也正常
			good: ["等等……然后呢。", "等等…然后呢。"]
		}
	]);
});

/* ------------------------------ 6. 表驱动 C：半角 / 全角混用 ------------------------------ */

test("规则表驱动 C：半角标点跟汉字、全角标点夹英文（含小数 / 中文逗号反例）", () => {
	checkRows([
		{
			rule: "punct-halfwidth-cjk",
			severity: "error",
			onlyBad: true,
			bad: ["你好,世界。"],
			// 全角逗号 / 小数点 3.14 / 千分位 1,000 都不该报
			good: ["你好，世界。", "圆周率是 3.14，人口 1,000 人。"]
		},
		{
			rule: "punct-fullwidth-latin",
			severity: "warn",
			onlyBad: true,
			bad: ["Hello，world 这句里全角逗号是错的。"],
			// 汉字右侧的全角逗号是合法中文标点；英文用半角逗号也不该报
			good: ["这样写，React 更好用。", "React, Vue 都好用。"]
		}
	]);
});

/* ------------------------------ 7. 表驱动 D：空格类 ------------------------------ */

test("规则表驱动 D：标点前空格、括号内侧空格、破折号两侧空格（含英文惯例反例）", () => {
	checkRows([
		{
			rule: "punct-space-before-cjk-punct",
			severity: "warn",
			onlyBad: true,
			bad: ["你好 ，世界。"],
			// 标点后加空格不在本规则范围（不硬报）
			good: ["你好，世界。", "你好， 世界。"]
		},
		{
			rule: "punct-paren-space",
			severity: "warn",
			onlyBad: true,
			bad: ["他说（ 好的）然后走了。"],
			good: ["他说（好的）然后走了。"]
		},
		{
			// 只有右括号侧有空格：同时会命中 space-before-cjk-punct，所以不要求 onlyBad
			rule: "punct-paren-space",
			severity: "warn",
			bad: ["他说（好的 ）然后走了。"],
			good: []
		},
		{
			rule: "punct-dash-spacing",
			severity: "warn",
			onlyBad: true,
			bad: ["他走了 —— 也许是吧。", "他走了—— 也许是吧。"],
			// 紧贴文字的破折号 / 英文 a — b 的写法都不该报
			good: ["他走了——也许是吧。", "请用 a — b 这种英文写法。"]
		}
	]);
});

/* ------------------------------ 8. 表驱动 E：重复与嵌套 ------------------------------ */

test("规则表驱动 E：重复标点、双引号嵌套（含 ！？ 强调反例）", () => {
	checkRows([
		{
			rule: "punct-repeated-punct",
			severity: "warn",
			onlyBad: true,
			bad: ["太棒了！！真的。", "我明白了，。"],
			// ？！ 是中文里常见的强调手法，不按重复标点报
			good: ["太棒了！真的。", "什么？！这不可能。"]
		},
		{
			rule: "punct-quote-nesting",
			severity: "warn",
			onlyBad: true,
			bad: ["他说：“他问“走吧”，我说好。”"],
			// 外层 “ ” + 内层 ‘ ’ 是规范嵌套
			good: ["他说：“他问‘走吧’，我说好。”"]
		}
	]);
});

/* ------------------------------ 9. 表驱动 F：混排空格 + 英文语境降级 ------------------------------ */

test("规则表驱动 F：汉字与拉丁紧贴 ≥3 处才报（info）；英文语境下全角规则静默", () => {
	checkRows([
		{
			rule: "punct-cjk-latin-space",
			severity: "info",
			onlyBad: true,
			bad: ["使用React和Vue以及Svelte开发页面。"],
			// 留了空格、或只紧贴 2 处（不到 3 处）都不报
			good: ["使用 React 开发页面。", "用React开发。"]
		}
	]);
	// TODO(重复)：本条与 layout_check S8（source.js mixedSpacingHits）重叠，若去重会删掉它，
	// 所以这里的期望写成「有这条就验行为」，不把条数写死。
	const mixed = auditPunct(seg("使用React和Vue以及Svelte开发页面。"));
	assert.match(
		mixed.find((entry) => entry.rule === "punct-cjk-latin-space").message,
		/紧贴共 \d+ 处/,
		"混排提示要说清共几处"
	);
	// 英文语境：同样的「夹在英文里的全角逗号」按契约静默（中文规则在英文语境无意义）
	assert.deepEqual(auditPunct(seg("Hello，world", "en.html:1"), { hasCJK: false }), [], "英文语境不报全角标点混用");
	assert.ok(has(auditPunct(seg("Hello，world", "zh.html:1")), "punct-fullwidth-latin"), "中英语境下同一文本要报 warn");
});

/* ------------------------------ 10. 一段中文 5 种问题 ------------------------------ */

/** 一段话里同时握了 5 种标点问题（直引号 / 半角逗号 / 重复标点 / 括号空格 / 三连点）。 */
const FIVE_ISSUES = '他说"你好,世界"，太棒了！！（ 备注）...';

test("一段中文同时含 5 种问题：正好命中对应的 5 条规则", () => {
	const findings = auditPunct(seg(FIVE_ISSUES, "article.html:1"));
	assert.deepEqual(
		rulesOf(findings),
		["punct-halfwidth-cjk", "punct-paren-space", "punct-repeated-punct", "punct-straight-quote", "punct-three-dots"],
		`对应的 5 条规则应全部命中且不多报（实际 ${rulesOf(findings)}）`
	);
	assert.equal(findings.length, 6, `直引号成对出现算 2 条、其余各 1 条，共 6 条（实际 ${findings.length}）`);
	for (const entry of findings) {
		assert.equal(entry.where, "article.html:1", `${entry.rule} 必须透传段位置`);
		assert.ok(entry.message.includes("「"), `${entry.rule} 的 message 要带实际片段`);
		assert.ok(entry.fix.length >= 10, `${entry.rule} 的 fix 要说清改法`);
	}
	assert.ok(!has(findings, "punct-space-before-cjk-punct"), "样本里没有「汉字 + 空格 + 全角标点」，不该多报");
	assert.ok(!has(findings, "punct-fullwidth-latin"), "样本里的全角逗号左侧不是拉丁字符，不该报");
});

/* ------------------------------ 11. 代码块不误报 ------------------------------ */

// 责任边界：source.js 的 textSegments() 已经把 <code>/<pre>/HTML 标签/注释/字符串字面量剥掉，
// 代码里的 " ' ... -- 不会作为文本段传进来。本模块看不到代码边界，所以不在这一层判代码 ——
// 下面的两组输入就是在验证「上游剥干净 = 零误报」，以及剥离责任必须留在上游。
test("代码块不会被误报：上游已剥离时零发现（剥离责任在 source.js）", () => {
	const stripped = [
		{ text: "点击按钮即可运行脚本。", where: "index.html:12" },
		{ text: "输出结果会写进构建目录。", where: "index.html:13" }
	];
	assert.deepEqual(auditPunct(stripped), [], "上游剥干净的正文不该有任何发现");
	// 反证：如果上游没剥（把代码行当文案传进来），本模块会照报 —— 这正是必须在上游剥的理由
	const leaked = auditPunct([{ text: 'console.log("a"...);', where: "index.html:14" }]);
	assert.ok(leaked.length > 0, "代码行漏进来时本模块不会静默");
	assert.ok(has(leaked, "punct-three-dots"), "漏进来的 ... 会命中 punct-three-dots");
});

/* ------------------------------ 12. finding 字段完整 ------------------------------ */

test("每条 finding 都带非空 fix 与 where，message 里的片段 ≤24 字", () => {
	const messy = '第一处"直引号，第二处（ 空格 ）以及...和！！还有 -- 末尾。';
	const findings = auditPunct([{ text: messy, where: "messy.html:7" }]);
	assert.ok(findings.length >= 4, `坏样本应有足够多的发现（实际 ${findings.length} 条）`);
	for (const entry of findings) {
		assert.ok(["error", "warn", "info"].includes(entry.severity), `未知 severity：${entry.severity}`);
		assert.match(entry.rule, /^punct-/, `rule 必须 punct- 前缀：${entry.rule}`);
		assert.equal(typeof entry.message, "string", `${entry.rule} 的 message 必须是字符串`);
		assert.ok(entry.message.length > 0, `${entry.rule} 的 message 不能为空`);
		assert.equal(typeof entry.fix, "string", `${entry.rule} 的 fix 必须是字符串`);
		assert.ok(entry.fix.trim().length >= 8, `${entry.rule} 的 fix 必须说清改法（实际「${entry.fix}」）`);
		assert.equal(entry.where, "messy.html:7", `${entry.rule} 必须带 where`);
		const snippet = /（片段「([\s\S]*?)」）/.exec(entry.message);
		assert.ok(snippet !== null, `${entry.rule} 的 message 必须带「片段」：${entry.message}`);
		assert.ok(snippet[1].length > 0, `${entry.rule} 的片段不能为空`);
		assert.ok(snippet[1].length <= 24, `${entry.rule} 的片段应 ≤24 字，实际 ${snippet[1].length} 字`);
		assert.ok(snippet[1].includes("\n") === false, `${entry.rule} 的片段不能带换行`);
	}
});

/* ------------------------------ 13. 单文件封顶 ------------------------------ */

test("每条规则单文件最多 3 条（按出现顺序），不同文件各自封顶", () => {
	const sameFile = [1, 2, 3, 4, 5].map((n) => ({ text: `第${n}处说"好。`, where: `doc.html:${n}` }));
	const quotes = hit(auditPunct(sameFile), "punct-straight-quote");
	assert.equal(quotes.length, 3, `同一文件 5 处违规只报前 3 条（实际 ${quotes.length}）`);
	assert.deepEqual(quotes.map((entry) => entry.where), ["doc.html:1", "doc.html:2", "doc.html:3"], "要按出现顺序取前 3 条");
	const twoFiles = [
		{ text: 'A 文件说"好。', where: "a.html:1" },
		{ text: 'B 文件说"好。', where: "b.html:1" }
	];
	const spread = hit(auditPunct(twoFiles), "punct-straight-quote");
	assert.equal(spread.length, 2, `封顶是按文件的，两个文件各 1 条（实际 ${spread.length}）`);
	assert.deepEqual(spread.map((entry) => entry.where).sort(), ["a.html:1", "b.html:1"], "两个文件的 where 都要在");
});

/* ------------------------------ 14. 确定性 ------------------------------ */

test("确定性：同输入两次 deepEqual，且不修改入参", () => {
	const segments = [
		{ text: '他说"你好,世界"...', where: "a.html:3" },
		{ text: "他走了 —— 也许是吧！！", where: "b.html:9" },
		{ text: "使用React和Vue以及Svelte开发。", where: "c.html:1" }
	];
	const frozen = JSON.stringify(segments);
	const first = auditPunct(segments);
	const second = auditPunct(segments);
	assert.ok(first.length >= 4, `样本应有多个发现（实际 ${first.length}）`);
	assert.deepEqual(second, first, "同输入两次结果必须完全一致");
	assert.equal(JSON.stringify(segments), frozen, "不得修改入参");
});

/* ------------------------------ 15. 性能 ------------------------------ */

test("性能：10 万字中文文本 < 200ms（且仍按规则封顶）", () => {
	const block = "这是一段用于压力测试的中文样式文本，包含“弯引号”、（括号）——破折号与……省略号，使用React框架但确实留了空格。\n";
	const text = block.repeat(2200);
	assert.ok(text.length > 100000, `样本应超过 10 万字（实际 ${text.length}）`);
	const started = performance.now();
	const findings = auditPunct([{ text, where: "big.html:1" }]);
	const elapsed = performance.now() - started;
	assert.ok(elapsed < 200, `10 万字体检应 < 200ms（实测 ${elapsed.toFixed(1)}ms）`);
	assert.ok(findings.length <= PUNCT_RULE_IDS.length * 3, `封顶生效：最多 ${PUNCT_RULE_IDS.length * 3} 条（实际 ${findings.length}）`);
	for (const entry of findings) assert.equal(entry.where, "big.html:1", `${entry.rule} 的 where 不能丢`);
});
