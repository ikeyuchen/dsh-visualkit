/**
 * style.js — design_style 的实现：风格约束的**正交两层**（骨架 × 皮肤）。
 *
 * ── 为什么拆层（2026-11-07 第二次修订）──────────────────────────
 * 上一版是 4 个"预设"，实测发现它们其实是「1 套骨架 + 1 套字号 + 3 种配色」：
 * 字号阶梯四个预设 100% 相同、语义色色相几乎一致、骨架都是五段式。
 * 等于换色号不换骨，约束反而制造了新的单一审美。
 *
 * 现在拆成两个正交维度：
 *   SKELETONS  信息结构（顶部条/首屏/指标/表格/收口 怎么排）——决定"页面是干什么的"
 *   SKINS      视觉皮肤（色相/字体/字号/圆角/阴影/密度）——决定"看起来像什么"
 * 6 × 8 = 48 种组合，且两者可独立扩展：加骨架不影响皮肤，加皮肤不影响骨架。
 *
 * 每个皮肤自带 typeScale（不再全局共用一套字号），且都必须守住
 * 「4 档 + 最大跳变 ≥1.6×」这条质量底线（test/style.test.mjs 对全部皮肤断言）。
 *
 * 皮肤可声明 exempt：该皮肤**有意**违反的风格规则（如 playful 的大圆角）。
 * 配合 ui_taste 的 .design-intent.json 豁免机制，让"有意的越界"变成数据而非口头理由。
 */

/** 皮肤：视觉语言。typeScale 四档，micro/body/head/display。 */
const SKINS = [
	{
		id: "industrial-editorial",
		label: "工业编辑",
		useWhen: "技术汇报、系统记录、数据看板、工程报告",
		tone: "纸感中性底 + 墨黑文字 + 信号黄只做结论标记",
		defaultSkeleton: "archive-ops",
		color: {
			paper: "#E8E8E2",
			surface: "#F1F1EB",
			ink: "#101110",
			inkSoft: "#3A3D39",
			muted: "#6B6D68",
			line: "#C9C9C1",
			accent: "#C8B400",
			ok: "#4A6B2A",
			warn: "#A8701C",
			danger: "#B4402B"
		},
		font: { body: '"Microsoft YaHei","Noto Sans SC",sans-serif', mono: '"Consolas","IBM Plex Mono",monospace' },
		typeScale: { micro: "11px", body: "14px", head: "24px", display: "34px" },
		radius: { "1": "2px", "2": "4px" },
		shadow: "0 1px 2px rgba(16,17,16,.06)",
		density: "紧凑",
		exempt: []
	},
	{
		id: "tactical-archive",
		label: "战术档案",
		useWhen: "安全/应急、项目冲刺、密级报告、行动简报",
		tone: "深色舞台 + 信号红/琥珀只做状态与警示",
		defaultSkeleton: "archive-ops",
		color: {
			paper: "#0B0D12",
			surface: "#171A20",
			ink: "#ECEDE9",
			inkSoft: "#B9BDBA",
			muted: "#7E8489",
			line: "#2C3138",
			accent: "#B7372E",
			ok: "#5F7F52",
			warn: "#C98A24",
			danger: "#D8453A"
		},
		font: { body: '"Microsoft YaHei","Noto Sans SC",sans-serif', mono: '"Consolas","IBM Plex Mono",monospace' },
		typeScale: { micro: "10px", body: "13px", head: "22px", display: "30px" },
		radius: { "1": "2px", "2": "3px" },
		shadow: "0 1px 0 rgba(255,255,255,.04)",
		density: "极紧凑",
		exempt: []
	},
	{
		id: "retro-archive",
		label: "复古档案",
		useWhen: "品牌/文化、年度复盘、收藏叙事、正式归档",
		tone: "深色舞台 + 旧纸衬线 + 铁锈红点缀",
		defaultSkeleton: "narrative",
		color: {
			paper: "#0B0A08",
			surface: "#141210",
			ink: "#E9DCCD",
			inkSoft: "#C4B4A2",
			muted: "#8C7B6B",
			line: "#3A322A",
			accent: "#B55829",
			ok: "#6E7A55",
			warn: "#B08A3E",
			danger: "#A93B2C"
		},
		font: { body: '"Georgia","SimSun",serif', mono: '"Consolas",monospace' },
		typeScale: { micro: "12px", body: "16px", head: "26px", display: "38px" },
		radius: { "1": "0px", "2": "0px" },
		shadow: "none",
		density: "舒展",
		exempt: []
	},
	{
		id: "studio-grid",
		label: "网格工作室",
		useWhen: "通用商业提案、客户报价、中性交付、需要易改的场合",
		tone: "纸白 + 墨黑 + 朱砂，细线网格，字重分层",
		defaultSkeleton: "document",
		color: {
			paper: "#FAFAF7",
			surface: "#F2F1EC",
			ink: "#14140F",
			inkSoft: "#3C3C35",
			muted: "#6E6E64",
			line: "#CFCEC5",
			accent: "#C0392B",
			ok: "#4F6B3A",
			warn: "#A8741C",
			danger: "#A93226"
		},
		font: { body: '"Microsoft YaHei","Noto Sans SC",sans-serif', mono: '"Consolas",monospace' },
		typeScale: { micro: "12px", body: "15px", head: "25px", display: "36px" },
		radius: { "1": "2px", "2": "4px" },
		shadow: "0 1px 3px rgba(20,20,15,.07)",
		density: "中等",
		exempt: []
	},
	{
		id: "swiss-minimal",
		label: "瑞士极简",
		useWhen: "严肃产品、机构站点、作品集、需要长时间耐看且不抢内容的界面",
		tone: "纯白底 + 墨黑字 + 极小面积瑞士红；靠字号、字距和网格说话，零装饰",
		defaultSkeleton: "landing",
		color: {
			paper: "#FFFFFF",
			surface: "#F4F4F4",
			ink: "#111111",
			inkSoft: "#3A3A3A",
			muted: "#767676",
			line: "#D8D8D8",
			accent: "#E4002B",
			ok: "#1D6B3A",
			warn: "#8A5A00",
			danger: "#C1121F"
		},
		font: { body: '"Helvetica Neue","Arial","Microsoft YaHei",sans-serif', mono: '"Consolas",monospace' },
		// 字距拉开、标题远大于正文：瑞士风格的核心是"层级靠尺度不靠装饰"
		typeScale: { micro: "11px", body: "15px", head: "28px", display: "44px" },
		radius: { "1": "0px", "2": "0px" },
		shadow: "none",
		density: "大留白",
		exempt: []
	},
	{
		id: "brutalist",
		label: "粗野主义",
		useWhen: "强表达的产品页、活动页、独立工具、要「不像模板」的场合",
		tone: "纯黑白 + 3px 硬边框 + 大色块 + 超大标题；刻意反精致",
		defaultSkeleton: "landing",
		color: {
			paper: "#FFFFFF",
			surface: "#F0F0F0",
			ink: "#000000",
			inkSoft: "#222222",
			muted: "#555555",
			line: "#000000",
			accent: "#FF3B00",
			ok: "#007A3D",
			warn: "#B36B00",
			danger: "#CC0000"
		},
		font: { body: '"Arial Black","Microsoft YaHei",sans-serif', mono: '"Consolas",monospace' },
		typeScale: { micro: "12px", body: "16px", head: "30px", display: "52px" },
		radius: { "1": "0px", "2": "0px" },
		shadow: "none",
		density: "紧凑",
		// 粗野主义刻意用高饱和撞色与硬边框，与「色相克制」规则天然冲突——这是有意的
		exempt: ["hue-sprawl"]
	},
	{
		id: "quiet-luxe",
		label: "静奢",
		useWhen: "高端品牌、酒店/地产/金融、需要「贵而不吵」的界面",
		tone: "暖白底 + 低饱和棕灰 + 细字重 + 极大留白；靠质感与留白建立层级",
		defaultSkeleton: "narrative",
		color: {
			paper: "#F7F5F2",
			surface: "#F1EEE9",
			ink: "#2A2A28",
			inkSoft: "#4A4A46",
			muted: "#8A8580",
			line: "#DDD8D1",
			accent: "#8C7A66",
			ok: "#5E7358",
			warn: "#9A7B3C",
			danger: "#8E3B33"
		},
		font: { body: '"Georgia","Songti SC","SimSun",serif', mono: '"Consolas",monospace' },
		typeScale: { micro: "10px", body: "14px", head: "23px", display: "34px" },
		radius: { "1": "0px", "2": "2px" },
		shadow: "none",
		density: "极大留白",
		exempt: []
	},
	{
		id: "playful-geometric",
		label: "几何趣味",
		useWhen: "消费类产品、儿童/教育、社区、需要亲和力的 C 端界面",
		tone: "暖白底 + 大圆角 + 几何色块；鲜艳但每屏只用 1–2 个强调色",
		defaultSkeleton: "landing",
		color: {
			paper: "#FFF8F0",
			surface: "#FFFFFF",
			ink: "#1F1A17",
			inkSoft: "#4A423C",
			muted: "#857A72",
			line: "#EADFD4",
			accent: "#FF6B35",
			ok: "#2C9E6A",
			warn: "#E0A100",
			danger: "#E03B3B"
		},
		font: { body: '"PingFang SC","Microsoft YaHei",sans-serif', mono: '"Consolas",monospace' },
		typeScale: { micro: "12px", body: "16px", head: "28px", display: "40px" },
		radius: { "1": "8px", "2": "16px" },
		shadow: "0 2px 8px rgba(31,26,23,.08)",
		density: "舒展",
		// C 端产品用大圆角是合理的，不是"AI 味"——声明豁免
		exempt: ["radius-blob"]
	}
];

/** 骨架：信息结构。与皮肤正交（任何皮肤都能套任何骨架）。 */
const SKELETONS = [
	{
		id: "archive-ops",
		label: "档案作业",
		useWhen: "日/周报、任务队列、运行状态、可归档的记录型界面",
		steps: [
			"顶部 rail（高 44px）：左品牌/系统名，右时间与运行编号——跨页恒定参照物",
			"首屏：左 8 列放一句真实结论 + 支撑事实；右 4 列放元数据戳（RUN / WINDOW / OWNER）",
			"指标行：4 列，细线分隔；数字用 tabular-nums，单位缩小一号；不做卡片",
			"主体：左 8 列真表格（长名字换行、编号独立行），右 4 列观察记录 + kv 列表",
			"收口 footer：左版本号，右页码，每页同一位置"
		]
	},
	{
		id: "narrative",
		label: "叙事长页",
		useWhen: "年度复盘、品牌故事、项目回顾、需要阅读节奏的内容页",
		steps: [
			"开场：大标题 + 一句摘要 + 时间范围，不放下拉菜单",
			"章节接力：每章一个编号（01/02/03）+ 小标题，编号用等宽——读者靠编号导航",
			"图文交替：左文右图 / 左图右文交替，避免所有图都居中对齐",
			"引文块：关键结论单独成块，细竖线 + 小一号字，与正文拉开距离",
			"结语：回到开场摘要，给一句收口判断 + 归档信息"
		]
	},
	{
		id: "dashboard",
		label: "仪表盘",
		useWhen: "实时监控、运营后台、数据产品的主界面",
		steps: [
			"左侧固定导航（宽 200–240px）+ 顶部筛选条，内容区只在框内滚动",
			"KPI 行：4–6 个关键数字，同尺寸同基线，超出每行的指标折到第二行而非缩小",
			"图表区：主图占 8 列、辅图占 4 列；图表必须有标题与单位，不留无标题空壳",
			"明细表：默认显示最近 N 行 + 总量提示，不假装能显示全部",
			"右下角固定操作区：刷新时间 + 手动重跑，不要飘浮工具栏"
		]
	},
	{
		id: "landing",
		label: "着陆页",
		useWhen: "产品介绍、活动页、下载页、需要转化但不靠营销口号的页面",
		steps: [
			"首屏：真实价值主张（说清「对谁、解决什么」）+ 一个可信的数字证据，不写「让 X 更懂 Y」",
			"特性分段：3–4 段，每段一个具体能力 + 截图/示意，不用 icon+标题+描述三件套",
			"社会证明：客户名/数据/引用，必须有出处，不允许编造 logo 墙",
			"价格或规格：真表格，写清包含什么、不包含什么",
			"收口 CTA：一个主按钮 + 一行说明「下一步会发生什么」，不做两个抢焦点的按钮"
		]
	},
	{
		id: "document",
		label: "文档型",
		useWhen: "规范手册、提案、合同附件、需要打印或归档的长文档",
		steps: [
			"标题区：文档类型 + 版本 + 日期 + 责任人，四行以内说清身份",
			"目录：章节 + 页码，超过 3 页必须有",
			"正文层级：只用两级标题（章 / 节），正文首行不缩进、段间留白",
			"边注：定义、出处、例外放右侧窄栏，不打断正文阅读线",
			"收口：签署/生效/附件清单块，明确文档状态（草案/生效/废止）"
		]
	},
	{
		id: "editor",
		label: "编辑器型",
		useWhen: "画布工具、设计器、代码编辑器、需要长期停留的操作界面",
		steps: [
			"顶部工具栏：高频操作在左，视图控制在右；图标必须带 tooltip 文本",
			"中央画布：占满剩余空间，四周留 24px 安全边距，不叠加装饰",
			"右侧属性面板：固定宽度 280–320px，分组折叠，按「选中对象」动态变化",
			"底部状态栏：坐标/缩放/保存状态，等宽字体，一眼可读",
			"空态与选中态必须都有明确视觉，不能只靠鼠标指针变化"
		]
	}
];

const SKIN_BY_ID = new Map(SKINS.map((skin) => [skin.id, skin]));
const SKELETON_BY_ID = new Map(SKELETONS.map((skeleton) => [skeleton.id, skeleton]));

/**
 * 全局禁令清单：按 scope 标注，让模型知道哪些是底线、哪些是风格取向。
 * 底线（quality）不该为风格让步；风格（style）允许在有理由时声明豁免。
 *
 * **每条必须带 id**，且 id 与 rules.js 的规则 id 同源：
 * 皮肤的 exempt（如 brutalist 的 ["hue-sprawl"]）要靠这个 id 映射到具体条目，
 * 否则模型看到「有意偏离 hue-sprawl」却在禁令清单里找不到它在说什么。
 */
const BANS = [
	{ id: "emoji-icon", scope: "quality", text: "emoji 当图标（→ icon action=find|emit 取真 SVG）" },
	{ id: "type-flat", scope: "quality", text: "字号碎阶：最多 4 档，最大档 ≥ 正文 ×1.6" },
	{ id: "spacing-offgrid", scope: "quality", text: "间距手调值（落 4px 网格，2px 仅用于微调）" },
	{ id: "no-states", scope: "quality", text: "可点元素缺 hover / focus-visible / disabled" },
	{ id: "card-uniform", scope: "quality", text: "整页 icon+标题+描述的同构卡片网格" },
	{ id: "no-breath", scope: "quality", text: "页面级与控件级留白同量级（应有 3:1 差）" },
	{ id: "purple-gradient", scope: "style", text: "紫/indigo/violet 渐变（品牌主色确需时声明豁免）" },
	{ id: "gradient-text", scope: "style", text: "渐变文字 background-clip:text" },
	{ id: "glassmorphism", scope: "style", text: "毛玻璃 backdrop-filter、大面积半透明白" },
	{ id: "shadow-glow", scope: "style", text: "发光阴影、彩色投影（最多 1 层中性投影）" },
	{ id: "radius-blob", scope: "style", text: "全站 rounded-xl/2xl（数据密集型 ≤8px；消费类可放宽）" },
	{ id: "hue-sprawl", scope: "style", text: "色相乱跑：同屏多个无关联高饱和色（一屏只留 1 个强调色）" },
	{ id: "centered-hero", scope: "style", text: "居中 hero + 口号 + CTA 的营销首屏（产品界面）" },
	{ id: "fake-stat", scope: "content", text: "128K+/99.9% 这类不可算的假大数、Lorem/敬请期待" },
	{ id: "nest-boxes", scope: "style", text: "框里再套框（三层以上圆角容器），层级靠套娃而不是间距" },
	{ id: "divider-sprawl", scope: "style", text: "分割线泛滥：每个区块之间都画一条线，靠线分区而不是靠留白" },
	{ id: "big-black-tight", scope: "style", text: "标题又大又黑又挤（≥30px + 700+ + 行高 ≤1.25），靠放大加粗硬撑层次" },
	{ id: "dead-button", scope: "quality", text: "按钮看着能点却没有结果（无 submit / 点击绑定 / data-action）" },
	{ id: "icon-tile-uniform", scope: "style", text: "每个卡片的图标都套同尺寸同色的圆角块（渐变方块尤甚）" },
	{ id: "eyebrow-spam", scope: "style", text: "每个区块都拿小号大字距标签当开场（四段以上）" },
	{ id: "ai-copy", scope: "content", text: "CTA 里的 → 箭头、“立即/一键/轻松/极致/解锁/赋能”与“XX之旅”开场白，以及无缝/闭环/抓手这类黑话" }
];

function cssOf(skin, skeleton) {
	const lines = [`:root {`];
	lines.push(`  /* ${skin.label} × ${skeleton.label} — ${skin.tone} */`);
	for (const [key, value] of Object.entries(skin.color)) lines.push(`  --c-${key}: ${value};`);
	for (const [key, value] of Object.entries(skin.font)) lines.push(`  --font-${key}: ${value};`);
	for (const [key, value] of Object.entries(skin.typeScale)) lines.push(`  --text-${key}: ${value};`);
	for (const [key, value] of Object.entries(SPACE)) lines.push(`  --space-${key}: ${value};`);
	for (const [key, value] of Object.entries(skin.radius)) lines.push(`  --radius-${key}: ${value};`);
	lines.push(`  --shadow-1: ${skin.shadow};`);
	lines.push(`  --line: ${skin.border ?? "1px"} solid var(--c-line);`);
	lines.push(`  --border-w: ${skin.border ?? "1px"};`);
	// 机制层变量：即使没有值也输出空声明，让使用方知道可以消费这些钩子
	for (const [key, varName] of Object.entries(MECH_KEYS)) {
		const value = skin.mech?.[key];
		if (value !== undefined) lines.push(`  ${varName}: ${value};`);
	}
	lines.push(`}`);
	return lines.join("\n");
}

function jsonOf(skin, skeleton) {
	return JSON.stringify(
		{
			skin: { id: skin.id, label: skin.label, useWhen: skin.useWhen, tone: skin.tone, density: skin.density },
			skeleton: { id: skeleton.id, label: skeleton.label, useWhen: skeleton.useWhen, steps: skeleton.steps },
			color: skin.color,
			font: skin.font,
			type: skin.typeScale,
			space: SPACE,
			radius: skin.radius,
			shadow: skin.shadow,
			// 机制层钩子：json 格式也要给出，否则消费方（例如按 token 生成 HTML 的构建脚本）
			// 拿不到 pattern/clip/organic 这些值，机制等于白加。
			...(skin.mech === undefined ? {} : { mech: skin.mech }),
			exempt: skin.exempt,
			bans: BANS
		},
		null,
		2
	);
}

function tailwindOf(skin, skeleton) {
	const colors = Object.entries(skin.color)
		.map(([key, value]) => `        "${key}": "${value}"`)
		.join(",\n");
	const fontList = (value) => value.split(",").map((f) => `"${f.trim().replace(/^"|"$/g, "")}"`).join(", ");
	// 输出**完整的 tailwind.config.js**，而不是 `extend: {…}` 片段：
	// 片段要么缺外层 module.exports/theme 包裹、要么把 extend 键本身也包含进去，
	// 模型直接粘进项目就是语法错。完整文件可以直接 `node --check` 验证（测试里有这条）。
	return [
		`// tailwind.config.js — 由 dsh-visualkit 生成（${skin.label} × ${skeleton.label}）`,
		"module.exports = {",
		"  theme: {",
		"    extend: {",
		"      colors: {",
		colors,
		"      },",
		`      borderRadius: { sm: "${skin.radius["1"]}", md: "${skin.radius["2"]}" },`,
		`      boxShadow: { "1": "${skin.shadow}" },`,
		"      fontSize: {",
		...Object.entries(skin.typeScale).map(([key, value]) => `        ${key}: "${value}",`),
		"      },",
		"      fontFamily: {",
		`        sans: [${fontList(skin.font.body)}],`,
		`        mono: [${fontList(skin.font.mono)}]`,
		"      }",
		"    }",
		"  }",
		"};",
		""
	].join("\n");
}

/* ---------------------------- 交互层（motion） ---------------------------- */

/**
 * 交互层兜底值：只在皮肤没给对应机制 token 时用。
 *
 * 全部是**中性**取值，不指向任何风格——时长、缓动、缩放幅度这些一旦带风格倾向，
 * 就又变成了「预设动效包」。挂哪个 `data-motion` 原语、给哪个元素挂，由使用者决定；
 * 这里只保证「挂了就有物理反馈，且反馈可调」。
 */
const MOTION_FALLBACK = {
	dur: "160ms",
	ease: "cubic-bezier(.4, 0, .2, 1)",
	press: "scale(.96)",
	lift: "translateY(-2px)",
	focus: "2px solid var(--c-accent, currentColor)",
	ripple: "currentColor",
	stagger: "40ms",
	reveal: "12px",
	shimmer: "rgb(255 255 255 / .28)"
};

/**
 * 交互层产出：一份**可选的、按元素挂载**的 CSS 原语，不产出任何具体动效风格。
 *
 * 为什么它是工具而不是模板：
 * - 每个原语（press/lift/focus/ripple/enter/stagger/reveal/shimmer）独立，可以只挑需要的；
 * - 全部读 `:root` 变量，一套产物换个项目只改变量；
 * - 选择器一律走 `[data-motion~="…"]` 属性钩子，不占用使用者的 class 命名空间；
 * - 风格差异（弹性/线性/缓入缓出、快慢、位移幅度）由变量的**取值**表达，不由我们预设几套。
 *
 * 唯一不可协商的是末尾的 `prefers-reduced-motion` 兜底：它是无障碍底线，不是风格。
 */
function motionOf(skin, skeleton) {
	const mech = skin.mech ?? {};
	const val = (key) => mech[key] ?? MOTION_FALLBACK[key];
	const lines = [
		`/* 交互层 — ${skin.label} × ${skeleton.label}（dsh-visualkit 生成）`,
		` * 原语层：给元素挂 data-motion="press lift focus" 才生效，挂哪些、挂给谁由你决定。`,
		` * 时长/缓动/幅度全走变量，换项目只改这一块 :root。 */`,
		`:root {`,
		`  /* 时长阶梯：一个基准推快慢两档，避免满文件硬编码 120/240/300ms */`,
		`  --dur: ${val("dur")};`,
		`  --ease: ${val("ease")};`,
		`  --t-fast: calc(var(--dur) * .6);`,
		`  --t-base: var(--dur);`,
		`  --t-slow: calc(var(--dur) * 1.6);`,
		`  /* 机制变量（皮肤/机制 token 覆盖过就用覆盖值） */`
	];
	for (const key of ["press", "lift", "focus", "ripple", "stagger", "reveal", "shimmer"]) {
		lines.push(`  ${MECH_KEYS[key]}: ${val(key)};`);
	}
	lines.push(`  --focus-offset: 2px;`);
	lines.push(`}`, ``);

	lines.push(
		`/* 1) 过渡只加在挂载元素上，不污染全站 */`,
		`[data-motion] {`,
		`  transition: transform var(--t-fast) var(--ease), opacity var(--t-fast) var(--ease),`,
		`    background-color var(--t-fast) var(--ease), color var(--t-fast) var(--ease),`,
		`    box-shadow var(--t-fast) var(--ease);`,
		`}`,
		``,
		`/* 2) 按压：:active 期间贴合，松手回弹（触屏 300ms 内也够快） */`,
		`[data-motion~="press"]:active { transform: var(--press); }`,
		``,
		`/* 3) 悬停抬升：只位移不做阴影，阴影量由使用者自己的 hover 规则给 */`,
		`[data-motion~="lift"]:hover { transform: var(--lift); }`,
		`[data-motion~="lift"]:active { transform: none; }`,
		``,
		`/* 4) 焦点环：:focus-visible 而非 :focus，鼠标点击不弹环；outline 不占布局 */`,
		`[data-motion~="focus"]:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset); }`,
		``,
		`/* 5) 波纹：原点取 --mx/--my（无 JS 时落在中心），clip-path 扩张不依赖元素尺寸 */`,
		`[data-motion~="ripple"] { position: relative; overflow: hidden; isolation: isolate; }`,
		`[data-motion~="ripple"]::after {`,
		`  content: ""; position: absolute; inset: 0; pointer-events: none;`,
		`  background: var(--ripple); opacity: 0;`,
		`  clip-path: circle(0% at var(--mx, 50%) var(--my, 50%));`,
		`}`,
		`[data-motion~="ripple"]:active::after,`,
		`[data-motion~="ripple"].is-rippling::after { animation: artkit-ripple var(--t-base) var(--ease) forwards; }`,
		`@keyframes artkit-ripple {`,
		`  from { opacity: .24; clip-path: circle(0% at var(--mx, 50%) var(--my, 50%)); }`,
		`  to   { opacity: 0;   clip-path: circle(140% at var(--mx, 50%) var(--my, 50%)); }`,
		`}`,
		``,
		`/* 6) 入场：单个元素用 enter，列表容器用 stagger（子元素读 --i 序号错峰） */`,
		`@keyframes artkit-enter {`,
		`  from { opacity: 0; transform: translate3d(0, var(--reveal), 0); }`,
		`  to   { opacity: 1; transform: none; }`,
		`}`,
		`[data-motion~="enter"] { animation: artkit-enter var(--t-slow) var(--ease) both; }`,
		`[data-motion~="stagger"] > * {`,
		`  animation: artkit-enter var(--t-slow) var(--ease) both;`,
		`  animation-delay: calc(var(--stagger) * var(--i, 0));`,
		`}`,
		``,
		`/* 7) 滚动显现：初始不可见，加 .is-in 才播（配合 IntersectionObserver） */`,
		`[data-motion~="reveal"] { opacity: 0; }`,
		`[data-motion~="reveal"].is-in { animation: artkit-enter var(--t-slow) var(--ease) both; }`,
		``,
		`/* 8) 骨架屏扫光：只画在元素自己的背景层上，不改文字 */`,
		`@keyframes artkit-shimmer { from { background-position: 140% 0; } to { background-position: -40% 0; } }`,
		`[data-motion~="shimmer"] {`,
		`  background-image: linear-gradient(100deg, transparent 20%, var(--shimmer) 50%, transparent 80%);`,
		`  background-size: 200% 100%;`,
		`  animation: artkit-shimmer calc(var(--t-slow) * 6) linear infinite;`,
		`}`,
		``,
		`/* 配套行为钩子（可选，各一行；CSS 表达不了指针原点/可见性）`,
		` * 波纹原点：el.onpointerdown = e => { const r = el.getBoundingClientRect();`,
		` *   el.style.setProperty('--mx', e.clientX - r.left + 'px');`,
		` *   el.style.setProperty('--my', e.clientY - r.top + 'px'); };`,
		` * 滚动显现：new IntersectionObserver(es => es.forEach(e => e.isIntersecting && e.target.classList.add('is-in')),`,
		` *   { threshold: .15 }).observe(el); */`,
		``,
		`/* 9) 无障碍兜底（底线，不是风格）：不能因为「动效好看」就把前庭敏感用户挡在门外 */`,
		`@media (prefers-reduced-motion: reduce) {`,
		`  [data-motion], [data-motion]::after, [data-motion] > * {`,
		`    animation-duration: .01ms !important;`,
		`    animation-iteration-count: 1 !important;`,
		`    transition-duration: .01ms !important;`,
		`  }`,
		`  /* reveal 默认 opacity:0，兜底必须补回可见，否则内容永久消失 */`,
		`  [data-motion~="reveal"] { opacity: 1; }`,
		`  [data-motion~="shimmer"] { animation: none; }`,
		`}`
	);
	return lines.join("\n");
}

/** 间距六档，全在 4px 网格（与皮肤无关，属于质量底线）。 */
const SPACE = { "1": "4px", "2": "8px", "3": "12px", "4": "16px", "6": "24px", "8": "32px", "12": "48px" };

/**
 * 渲染一次风格约束。
 * @param {{skin?:string, skeleton?:string, name?:string, format?:"css"|"json"|"tailwind"}} args
 *   name 是 skin 的旧参数名，保留兼容；给的 skeleton 缺省时取皮肤的 defaultSkeleton。
 */
/**
 * 解析自定义 token 覆盖：`ground=#0B0B0C;ink=#F5F5F4;accent=#C6F24E;radius=0;border=3`
 *
 * **为什么要有这个**：`skin` 是封闭枚举，只能表达我们内置的 8 种视觉语言。
 * 但插件的定位是「给框架不给目录」——风格应该能被描述，而不是被我们在源码里枚举。
 * 有了 token 覆盖，任何配色/圆角/字体/边框组合都能落到同一个骨架体系上：
 * 扁平、Y2K、Art Deco、有机自然这些没有内置 skin 的方向，也能用一组 token 表达出来。
 *
 * 用**字符串**而不是嵌套对象：嵌套 schema 的每个字段都是每请求常驻 token，
 * 而 key=value 串一个参数就能表达二十来个维度。
 */
// 机制层 token：不描述「什么风格」，只描述「用哪种实现手段」。
// 这层的存在理由：把市面上的风格拆开看，绝大多数只是少数几种原语的组合——
// 渐变填充、图案层、任意形状、描边、双线、动效档位、栅格配方。
// 这些原语是**通用的**，项目规范各不相同但手段相同，所以补原语而不是补风格。
const MECH_KEYS = {
	pattern: "--pattern",      // 图案层：repeating-*-gradient / radial-gradient 拼波点斜纹网格
	clip: "--clip",            // 任意形状：polygon() 斜切角、六边形、箭头
	organic: "--radius-organic", // 有机圆角：八角写法 30% 70% 60% 40% / 40% 30% 70% 60%
	double: "--double-line",   // 双线边框（Art Deco）：0 0 0 1px c, 0 0 0 3px bg, 0 0 0 4px c
	stroke: "--text-stroke",   // 描边字：
	tracking: "--tracking",    // 字距
	grid: "--grid",            // 栅格配方：bento / magazine / symmetric
	// —— 交互层（format=motion 消费；视觉层不读取，但它们同样是「手段」而非「风格」）——
	dur: "--dur",              // 动效基准时长（dur=160 自动补 ms）
	ease: "--ease",            // 缓动曲线
	press: "--press",          // 按压反馈：scale(.96) / translateY(1px) / 无
	lift: "--lift",            // 悬停位移：translateY(-2px)
	focus: "--focus-ring",     // 焦点环：2px solid <主色>，用 :focus-visible 触发
	ripple: "--ripple",        // 波纹色（currentColor 或半透明主色）
	stagger: "--stagger",      // 列表错峰步长（stagger=40 自动补 ms）
	reveal: "--reveal",        // 入场/滚动显现的位移距离
	shimmer: "--shimmer"       // 骨架屏扫光高光色
};

const TOKEN_KEYS = {
	ground: ["color", "paper"], surface: ["color", "surface"], ink: ["color", "ink"],
	inkSoft: ["color", "inkSoft"], muted: ["color", "muted"], line: ["color", "line"],
	accent: ["color", "accent"], ok: ["color", "ok"], warn: ["color", "warn"], danger: ["color", "danger"],
	font: ["font", "body"], mono: ["font", "mono"],
	micro: ["typeScale", "micro"], body: ["typeScale", "body"], head: ["typeScale", "head"], display: ["typeScale", "display"],
	radius: ["radius", "2"], shadow: ["shadow"], border: ["border"], density: ["density"]
};

function parseTokens(raw) {
	if (typeof raw !== "string" || raw.trim() === "") return null;
	const patch = { color: {}, font: {}, typeScale: {}, radius: {}, mech: {} };
	let touched = false;
	for (const piece of raw.split(";")) {
		const at = piece.indexOf("=");
		if (at === -1) continue;
		const key = piece.slice(0, at).trim();
		const value = piece.slice(at + 1).trim();
		if (value === "") continue;
		// 归一化必须在分流前算：机制 token（dur/stagger/radius…）走 mech 分支，
		// 若把归一化留在下面，`dur=90` 会原样写成 `--dur: 90`，calc 静默失效。
		// 尺寸类 token 自动补 px：写 radius=18 和 radius=18px 都当 18px，
		// 否则会输出 `--radius-2: 18` 这种在 CSS 里无效的值（实测踩过）。
		// 时间类同理补 ms。
		const needsUnit = key === "radius" || key === "border";
		const needsTime = key === "dur" || key === "stagger";
		const bare = /^\d+(\.\d+)?$/;
		const normalized = needsUnit && bare.test(value) ? `${value}px` : needsTime && bare.test(value) ? `${value}ms` : value;
		const path = TOKEN_KEYS[key];
		if (path === undefined) {
			if (MECH_KEYS[key] !== undefined) {
				touched = true;
				patch.mech[key] = normalized;
				continue;
			}
			throw new Error(
				`unknown token "${key}"（可用：${Object.keys(TOKEN_KEYS).join(", ")} | 机制：${Object.keys(MECH_KEYS).join(", ")}）`
			);
		}
		touched = true;
		if (path.length === 1) patch[path[0]] = normalized;
		else patch[path[0]][path[1]] = normalized;
	}
	if (!touched) return null;
	// radius 同时派生 radius.1 / radius.3，避免只改一档时其余档位还是原 skin 的值
	if (patch.radius["2"] !== undefined) {
		const base = patch.radius["2"];
		patch.radius["1"] = base === "0" ? "0" : `calc(${base} * 0.5)`;
		patch.radius["3"] = patch.radius["3"] ?? base;
	}
	return patch;
}

function renderStyle(args = {}) {
	const skinId = args.skin ?? args.name;
	if (skinId === undefined || skinId === "") {
		throw new Error(`需要 skin（可用：${SKINS.map((s) => s.id).join(", ")}）`);
	}
	const baseSkin = SKIN_BY_ID.get(skinId);
	if (baseSkin === undefined) {
		throw new Error(`unknown skin "${skinId}"（可用：${SKINS.map((s) => s.id).join(", ")}）`);
	}
	// token 覆盖：在内置 skin 的基础上改配色/圆角/字体/边框，不改结构
	const patch = parseTokens(args.tokens);
	const skin =
		patch === null
			? baseSkin
			: {
					...baseSkin,
					...(args.label === undefined ? {} : { label: String(args.label) }),
					color: { ...baseSkin.color, ...patch.color },
					font: { ...baseSkin.font, ...patch.font },
					typeScale: { ...baseSkin.typeScale, ...patch.typeScale },
					radius: { ...baseSkin.radius, ...patch.radius },
					...(patch.shadow === undefined ? {} : { shadow: patch.shadow }),
					...(patch.border === undefined ? {} : { border: patch.border }),
					...(patch.density === undefined ? {} : { density: patch.density }),
					...(Object.keys(patch.mech).length === 0 ? {} : { mech: patch.mech })
				};
	const skeletonId = args.skeleton ?? skin.defaultSkeleton;
	const skeleton = SKELETON_BY_ID.get(skeletonId);
	if (skeleton === undefined) {
		throw new Error(`unknown skeleton "${skeletonId}"（可用：${SKELETONS.map((s) => s.id).join(", ")}）`);
	}
	const format = args.format ?? "css";
	const renderer = { css: cssOf, json: jsonOf, tailwind: tailwindOf, motion: motionOf }[format];
	if (renderer === undefined) throw new Error(`unknown format "${format}"（可用：css, json, tailwind, motion）`);
	return {
		skin: patch === null ? skin.id : `${skin.id}+tokens`,
		skeleton: skeleton.id,
		label: `${skin.label} × ${skeleton.label}`,
		useWhen: `${skin.useWhen}；结构上适合：${skeleton.useWhen}`,
		tone: skin.tone,
		density: skin.density,
		code: renderer(skin, skeleton),
		steps: skeleton.steps,
		bans: BANS,
		exempt: skin.exempt
	};
}

export { BANS, SKELETONS, SKINS, SPACE, renderStyle };
