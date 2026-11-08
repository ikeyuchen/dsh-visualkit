/**
 * rules.js — 「AI 味」规则表：约束（design_style 的禁用清单）与检测（ui_taste 的指标）
 * 共用同一份定义。
 *
 * 为什么同源：设计的核心矛盾是「规则改了但检测没改」——两边各写一份必然漂移，
 * 模型拿到的约束和验收标准就会打架。这里每条规则只有一处定义。
 *
 * ── scope 分层（2026-11-07 第二次修订）──────────────────────────
 * 上一版把「通用质量」和「风格偏好」混成一层，风格规则占 41% 权重，导致约束本身
 * 变成新的众数（四个预设只因强调色/字体不同才区分开）。现按证据分三层：
 *
 *   quality  跨任何风格都成立的底线（字号要有层级、间距有节奏、交互态完整、
 *            留白有分层、图标是真 SVG）。打破它不是"风格选择"，是缺陷。
 *   style    仅代表一种审美取向（禁紫渐变 / 小圆角 / 禁毛玻璃 / 禁渐变文字 /
 *            居中式首屏）。品牌或题材有理由时**应当允许越界**，故可降权、可声明豁免。
 *   content  内容真实度（假大数 / 占位文案）。
 *
 * profile 决定各层的计分系数，见 PROFILES——同一次检测在不同 profile 下
 * 得到不同分数，但检测事实（hits / fix）完全一致。
 */

const RULES = [
	{
		id: "emoji-icon",
		// 参与「成组出现」判定：这一项属于风格默认选择，不是通用质量缺陷
		fingerprint: true,
		label: "emoji 当图标",
		scope: "quality",
		weight: 14,
		ban: "不要用 emoji 做图标，用 icon (action=find|emit) 取真 SVG",
		fix: "把 emoji 换成 SVG 图标：icon (action=find) 选型 → icon (action=emit, target=raw) 出码"
	},
	{
		id: "type-flat",
		label: "字号塌缩（有档位无跳变）",
		scope: "quality",
		weight: 12,
		ban: "字号最多 4 档，且标题/正文之间必须有 ≥1.6× 跳变",
		// 与 layout_check S1 同源判断：这里不重复实现，只把更细的查看入口写出来，
		// 否则两个工具各报一次同一个问题，用户会困惑该听哪个。
		fix: "把字号收敛到 4 档，并让最大档至少是正文的 1.6 倍（如正文 14 → 标题 24/28）；逐档明细与 file:line 用 layout_check action=ui（S1）查看"
	},
	{
		id: "spacing-offgrid",
		label: "间距不在 4px 网格",
		scope: "quality",
		weight: 8,
		ban: "间距落在 4px 网格（4/8/12/16/24/32；2px 仅用于对齐微调）",
		fix: "把间距对齐到 4px 网格：4/8/12/16/24/32，删掉 5/6/7/10/14 这类手调值（2px 微调可保留）"
	},
	{
		id: "no-states",
		label: "交互态缺失",
		scope: "quality",
		weight: 6,
		ban: "可点的元素必须有 hover / focus-visible / disabled 三态",
		fix: "给按钮/链接/表格行补 :hover、:focus-visible、:disabled；键盘可达是底线"
	},
	{
		id: "card-uniform",
		// 参与「成组出现」判定：这一项属于风格默认选择，不是通用质量缺陷
		fingerprint: true,
		label: "同构三件套卡片",
		scope: "quality",
		weight: 4,
		ban: "不要整页都是 icon+标题+描述的同构卡片网格",
		fix: "让卡片承载不同信息量：主卡放结论，次卡放数据，边栏放记录；不要一律三件套"
	},
	{
		id: "no-breath",
		label: "留白无分层",
		scope: "quality",
		weight: 4,
		ban: "页面级的留白要明显大于控件内部留白（至少 3:1）",
		fix: "拉开两种 padding：页面级 32–48px，控件内部 6–10px；现在两者挤在同一量级"
	},
	{
		id: "purple-gradient",
		// 参与「成组出现」判定：这一项属于风格默认选择，不是通用质量缺陷
		fingerprint: true,
		label: "紫/蓝紫渐变",
		scope: "style",
		weight: 12,
		ban: "默认避免紫/indigo/violet 渐变（AI 最强指纹）；品牌主色确需时在 .design-intent.json 声明豁免",
		fix: "渐变改成同色相或干脆去掉：单一强调色 + 中性底色；需要层次就用明度差，不要换色相"
	},
	{
		id: "radius-blob",
		// 参与「成组出现」判定：这一项属于风格默认选择，不是通用质量缺陷
		fingerprint: true,
		label: "大圆角滥用",
		scope: "style",
		weight: 10,
		ban: "数据密集型界面圆角 ≤8px，不要全站 rounded-xl/2xl（消费类产品可放宽）",
		fix: "圆角降到 ≤8px（数据密集型界面 2–4px）；不要给所有容器同一个大圆角"
	},
	{
		id: "hue-sprawl",
		// 参与「成组出现」判定：这一项属于风格默认选择，不是通用质量缺陷
		fingerprint: true,
		label: "色相家族过多",
		scope: "style",
		weight: 8,
		ban: "强调色只允许 1 个家族，语义色（成功/警告/危险）不与强调色混用",
		fix: "把色相收到 1 个强调家族 + 1 套语义色；其余用中性灰阶拉开层次"
	},
	{
		id: "shadow-glow",
		// 参与「成组出现」判定：这一项属于风格默认选择，不是通用质量缺陷
		fingerprint: true,
		label: "发光/软阴影",
		scope: "style",
		weight: 8,
		ban: "默认不要发光阴影和彩色投影，最多 1 层中性投影",
		fix: "去掉 0 0 Npx 发光与彩色投影；需要浮起就用 1 层中性阴影或直接靠描边/底色区分"
	},
	{
		id: "glassmorphism",
		// 参与「成组出现」判定：这一项属于风格默认选择，不是通用质量缺陷
		fingerprint: true,
		label: "毛玻璃/半透明白",
		scope: "style",
		weight: 8,
		ban: "默认不要毛玻璃（backdrop-filter）和大面积半透明白",
		fix: "去掉 backdrop-filter；面板用实色 + 1px 描边，需要层次用底色明度差"
	},
	{
		id: "gradient-text",
		// 参与「成组出现」判定：这一项属于风格默认选择，不是通用质量缺陷
		fingerprint: true,
		label: "渐变文字",
		scope: "style",
		weight: 7,
		ban: "不要渐变文字（background-clip:text）",
		fix: "标题用实色 + 字重/字号制造层级；渐变文字在深色背景上对比度还会不达标"
	},
	{
		id: "centered-hero",
		// 参与「成组出现」判定：这一项属于风格默认选择，不是通用质量缺陷
		fingerprint: true,
		label: "居中 hero + CTA",
		scope: "style",
		weight: 3,
		ban: "产品界面默认不要「居中大标题 + 副标题 + 按钮」的营销首屏（官网落地页可以）",
		fix: "改成信息型首屏：一个真实结论句 + 关键指标 + 元数据（谁/何时/范围），而不是营销口号"
	},
	{
		id: "fake-stat",
		// 参与「成组出现」判定：这一项属于风格默认选择，不是通用质量缺陷
		fingerprint: true,
		label: "假大数/占位文案",
		scope: "content",
		weight: 6,
		ban: "不要 128K+/99.9% 这类不可算的假大数，也不要 Lorem/敬请期待",
		fix: "换成真能算的数字（18,432 行 / 47 分钟）或明确标注为示例数据，不要用 K+/99.9% 充场面"
	},
	{
		id: "nest-boxes",
		// 参与「成组出现」判定：这一项属于风格默认选择，不是通用质量缺陷
		fingerprint: true,
		label: "容器过度嵌套（框里再套框）",
		scope: "style",
		weight: 12,
		ban: "卡片里不要再画一层带圆角的框：靠间距和底色区分层级，不要靠套娃",
		fix: "把内层那圈 border-radius + 边框去掉，用 padding 与背景色差表达层级；确实要分组时用一条细分隔或留白，而不是再套一个框"
	},
	{
		id: "divider-sprawl",
		// 参与「成组出现」判定：这一项属于风格默认选择，不是通用质量缺陷
		fingerprint: true,
		label: "分割线泛滥",
		scope: "style",
		weight: 10,
		ban: "不要每个区块之间都画一条线：先用间距分组，线只在间距做不到时用",
		fix: "删掉多数 border-top/bottom 与 <hr>，把区块间距调到 24/32px 让留白完成分组；只保留真正的分组边界（如两张不同性质的表之间）"
	},
	{
		id: "big-black-tight",
		// 参与「成组出现」判定：这一项属于风格默认选择，不是通用质量缺陷
		fingerprint: true,
		label: "标题又大又黑又挤（≥30px / 700+ / 行高 ≤1.25）",
		scope: "style",
		weight: 14,
		ban: "标题不要靠「更大更黑」硬撑层次：字号降下来、行高放开、用留白与字距做气口",
		fix: "标题字号收到正文的 1.6–2×（正文 16 → 标题 28–32 已足够），font-weight 降到 600，line-height 提到 1.2–1.3"
	},
	{
		id: "dead-button",
		label: "按钮看着能点却没有结果",
		scope: "quality",
		weight: 16,
		ban: "按钮必须有行为：submit、点击绑定、或明确的 data-action；摆着不响的按钮比没有按钮更伤",
		fix: "给按钮接上真实行为（提交/跳转/打开面板），暂时做不到就渲染成 disabled 或去掉——先确认是不是挂在外层事件委托上，避免误判"
	},
	{
		id: "ai-copy",
		// 参与「成组出现」判定：这一项属于风格默认选择，不是通用质量缺陷
		fingerprint: true,
		label: "AI 套路文案",
		scope: "content",
		weight: 8,
		ban: "CTA 不要用 → 箭头、“立即/一键/轻松/极致/解锁/赋能/助力”、“XX之旅”，也不要用无缝/闭环/抓手这类黑话",
		// 实测来源：自己做的 7 种风格 UI 里给按钮写了“立即同步 →”，
		// 而当时的规则一条都没抓到——工具在提倡反 AI 味，却查不出自己身上的 AI 味。
		fix: "写成具体动作：把“立即同步 →”改成“同步”/“推送到远端”；删掉箭头与咏叹调形容词，动词+宾语就够"
	},
	{
		id: "icon-tile-uniform",
		// 参与「成组出现」判定：这一项属于风格默认选择，不是通用质量缺陷
		fingerprint: true,
		label: "图标色块一律",
		scope: "style",
		weight: 7,
		ban: "不要给每个卡片的图标都套同尺寸同色的圆角块（渐变方块尤甚）——这是模板卡片的长相",
		// 实测来源（2026-11-08）：写一个当代 AI 首页样本，最显眼的 AI 感就是
		// 三个特性卡里各一个 48px 同款渐变圆角块，而 19 条规则一条都没抓到。
		fix: "选一种：图标直接放在留白里靠对齐建立秩序 / 只给主卡一个色块 / 色块随语义换色（成功·警示·中性）"
	},
	{
		id: "eyebrow-spam",
		// 参与「成组出现」判定：这一项属于风格默认选择，不是通用质量缺陷
		fingerprint: true,
		label: "小标签逐段开场",
		scope: "style",
		weight: 5,
		ban: "不要每个区块都拿一个小号大字距标签（eyebrow/kicker）当开场，四段以上尤其明显",
		// 保留 0–1 个是正常编辑手法（用来说明栏目归属），四段以上就是模板句式。
		fix: "只留 1 个说明栏目归属，其余靠标题自身的层级与留白分段；小标签不宜承担分段责任"
	}
];

/** 规则 id → 规则对象（ui_taste 的 ignore 参数与报告渲染共用）。 */
const RULE_BY_ID = new Map(RULES.map((rule) => [rule.id, rule]));

const TOTAL_WEIGHT = RULES.reduce((sum, rule) => sum + rule.weight, 0);

/**
 * 检测档位：同一次检测，不同 profile 下各层的计分系数不同。
 *
 *   strict    全规则满权重——适合"确认这就是 AI 默认产物"的诊断场景。
 *   balanced  默认。风格层降到 0.4：品牌/题材有理由的风格选择不应被判死刑，
 *             但仍然能被看见。这是在"反同质化"与"仍能发现塌缩"之间的折中。
 *   structure 只查质量与内容（风格权重 0）——给已有明确视觉方向的团队用，
 *             避免这套规则反过来把他们的品牌风格判成问题。
 */
const PROFILES = {
	strict: { label: "全规则", quality: 1, style: 1, content: 1 },
	balanced: { label: "默认（风格层降权）", quality: 1, style: 0.4, content: 0.8 },
	structure: { label: "只查结构", quality: 1, style: 0, content: 0.5 }
};

/**
 * 分数分级（balanced 口径）。
 * 阈值按实测校准：模型无约束输出 75、第三方 AI 插件 UI 54、受约束手写 2-5。
 *
 * **口径纪律**：分数是诊断工具，不是 KPI。只在 ai-tinged / ai-default 区间
 * 提示返工；clean 区间（≤15）不再"优化"——继续压分会把设计往安全区推，反而
 * 制造同质化（Goodhart）。报告里会显式说明这一点。
 */
function gradeOf(score) {
	if (score <= 15) return "clean";
	if (score <= 30) return "acceptable";
	if (score <= 50) return "ai-tinged";
	return "ai-default";
}

export { PROFILES, RULES, RULE_BY_ID, TOTAL_WEIGHT, gradeOf };
