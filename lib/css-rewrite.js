/**
 * css-rewrite.js — 把散落的数值收敛到一套规范（机械、可验收）。
 *
 * 为什么需要：这一路做真实项目时，同一件事手写了三次——「把 margin/padding/gap 对齐到 4px 网格」、
 * 「把 11 档字号收敛到 5 档」。步骤固定、判据明确、结果可验证（渲染 diff 均差 1.2%），
 * 却每次都得重写一遍脚本。这类活应该是一种能力，而不是一段随手代码。
 *
 * 三条铁律（都不是风格取向，而是“改了必然错”的情况）：
 *   ① 注释与字符串里的数字不动（`content:"6px"` 不是尺寸声明）。
 *   ② var() / calc() / 百分比 / em / rem / auto / inherit 一律不碰——
 *      这些值的实际尺寸由上下文决定，静态改数字是瞎猜。
 *   ③ 0.5 / 1 / 2px 保留：描边与微调本来就不该被拉到 4 的倍数。
 * 另外：负数保留符号（负 margin 是刻意为之的重叠/对齐手段，只调幅度不改方向）。
 */

/** 把注释与字符串挖成等长空白，保证索引与原文对齐。 */
function maskNoise(source) {
	const s = String(source);
	return s
		.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
		.replace(/"(?:[^"\\\n]|\\.)*"/g, (m) => m.replace(/[^\n]/g, " "))
		.replace(/'(?:[^'\\\n]|\\.)*'/g, (m) => m.replace(/[^\n]/g, " "));
}

const SKIP_VALUE = /var\(|calc\(|%|\bem\b|\brem\b|\bvmin\b|\bvmax\b|\bauto\b|\binherit\b|\bunset\b|\binitial\b|!important/i;

/** 间距类属性（能被网格约束的）。 */
export const SPACING_PROPS = new Set([
	"margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
	"padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
	"gap", "row-gap", "column-gap"
]);

/**
 * 扫出所有声明（只扫 `prop: value` 形态，跳过选择器与 at-rule 条件）。
 * @returns {{prop:string, value:string, valueStart:number, valueEnd:number}[]}
 */
export function scanDecls(source) {
	const masked = maskNoise(source);
	const out = [];
	// 声明一定在 `{ ... }` 里；这里用“最后一个 { 或 ; 之后到 : 之间”的弱判据即可：
	// 选择器里的 `:`（伪类）不在 `{` 之后紧邻位置，会被下面的 `prev` 判断挡掉。
	const re = /([-a-zA-Z]+)\s*:\s*([^;{}]+)/g;
	let m;
	while ((m = re.exec(masked)) !== null) {
		const prop = m[1].toLowerCase();
		// 伪类/伪元素的选择器片段会被当成 prop（如 `hover`），用“位置前一个有意义字符”排除：
		const before = masked.slice(Math.max(0, m.index - 1), m.index);
		if (before !== "{" && before !== ";" && before !== "\n" && before !== " " && before !== "\t" && before !== "") {
			// 允许 `--x: 4px` 之类的自定义属性（prop 以 - 开头）
			if (prop.startsWith("-") === false) continue;
		}
		const value = m[2].trim();
		if (value === "") continue;
		const valueStart = m.index + m[0].indexOf(m[2]) + (m[2].length - m[2].trimStart().length);
		// 所属选择器在**声明之前**：先找这条声明的 `{`，再往前找上一个 `}` / `;`，两者之间就是选择器。
		// 有些规则只对“正文级”成立（行高就是典型）：判断建在选择器上比猜值可靠。
		const open = masked.lastIndexOf("{", m.index);
		let selector = "";
		if (open !== -1) {
			const prev = Math.max(masked.lastIndexOf("}", open), masked.lastIndexOf(";", open));
			selector = masked.slice(prev + 1, open).trim();
		}
		out.push({ prop, value, valueStart, valueEnd: valueStart + value.length, selector });
	}
	return out;
}

/** 值里每个 token 是否都是可判定的 px（或数字）——否则整条放弃。 */
function parsePxTokens(value) {
	if (SKIP_VALUE.test(value)) return null;
	const tokens = value.split(/\s+/).filter((t) => t !== "");
	const parsed = [];
	for (const t of tokens) {
		// 裸 `0` 是合法且最常见的写法（`margin: 0 auto` 反过来不行）——
		// 不认它会让 `margin:-6px 0 2px 12px` 整条被跳过（实测踩过）。
		const zero = /^0(?:\.0+)?$/.exec(t);
		if (zero !== null) {
			parsed.push({ raw: t, num: 0, bareZero: true });
			continue;
		}
		const m = /^(-?\d*\.?\d+)px$/.exec(t);
		if (m === null) return null;
		parsed.push({ raw: t, num: Number(m[1]) });
	}
	return parsed;
}

const snapOne = (num, grid) => {
	const abs = Math.abs(num);
	if (abs <= 2) return num; // 描边/微调保留
	const snapped = Math.max(grid, Math.round(abs / grid) * grid);
	return num < 0 ? -snapped : snapped;
};

/**
 * 间距对齐网格。
 * @param {string} source
 * @param {{grid?:number}} [opts]
 * @returns {{output:string, changes:{prop:string,from:string,to:string}[], skipped:number}}
 */
export function snapSpacing(source, opts = {}) {
	const grid = Number.isFinite(opts.grid) && opts.grid > 0 ? Math.max(1, Math.round(opts.grid)) : 4;
	const changes = [];
	let skipped = 0;
	let output = String(source);
	const decls = scanDecls(output).filter((d) => SPACING_PROPS.has(d.prop));
	// 从后往前改，避免偏移漂移
	for (let i = decls.length - 1; i >= 0; i -= 1) {
		const decl = decls[i];
		const tokens = parsePxTokens(decl.value);
		if (tokens === null) {
			skipped += 1;
			continue;
		}
		const next = tokens.map((t) => (t.bareZero === true ? t.raw : `${snapOne(t.num, grid)}px`)).join(" ");
		if (next === decl.value) continue;
		output = output.slice(0, decl.valueStart) + next + output.slice(decl.valueEnd);
		changes.push({ prop: decl.prop, from: decl.value, to: next });
	}
	changes.reverse();
	return { output, changes, skipped };
}

/**
 * 字号收敛到给定阶梯（就近归并）。
 * @param {string} source
 * @param {{scale:number[]}} opts
 * @returns {{output:string, changes:{from:string,to:string}[], skipped:number}}
 */
export function mapFontSizes(source, opts = {}) {
	const scale = (Array.isArray(opts.scale) ? opts.scale : []).map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
	if (scale.length < 2) throw new Error("scale 至少给两档（如 12,14,16,20,28）");
	// 平局时**取大的那档**：13px 到 12/14 距离相等，往小缩会让文字变糊（中文尤其），
	// 往大走最多损失一点密度。实测 Colibri：94 处里大半是 13px，平局取小会整体缩字号。
	const nearest = (n) => scale.reduce((best, s) => (Math.abs(s - n) <= Math.abs(best - n) ? s : best), scale[0]);
	const changes = [];
	let skipped = 0;
	let output = String(source);
	const decls = scanDecls(output).filter((d) => d.prop === "font-size");
	for (let i = decls.length - 1; i >= 0; i -= 1) {
		const decl = decls[i];
		if (SKIP_VALUE.test(decl.value)) {
			skipped += 1;
			continue;
		}
		const m = /^(\d*\.?\d+)px$/.exec(decl.value.trim());
		if (m === null) {
			skipped += 1;
			continue;
		}
		const target = nearest(Number(m[1]));
		if (`${target}px` === decl.value) continue;
		output = output.slice(0, decl.valueStart) + `${target}px` + output.slice(decl.valueEnd);
		changes.push({ prop: "font-size", from: decl.value, to: `${target}px` });
	}
	changes.reverse();
	return { output, changes, skipped };
}

/** 标题级选择器：与 layout_check 的 S3 用同一套判据——**改与不改要同理**。 */
const HEADING_SELECTOR = /(?:^|[\s,>+~])(?:h[1-6]|\.[\w-]*(?:title|heading|headline|display)[\w-]*)(?:$|[\s,.:#[>+~])/i;

/** 正文行高阶梯：从 4 个真实项目的 78 处声明里选出来的 */
export const LEADING_LADDER = [1.5, 1.6, 1.8];

/**
 * 行高归一（规则 B）。
 *
 * 为什么长这样——不是拍脑袋，是拿 4 个项目 78 处真实声明模拟三种规则后选的：
 *
 * | 规则 | 改动 | 归一后 S3 剩 |
 * |---|---|---|
 * | A 全部就近归并到 1.2/1.35/1.5/1.6/1.8 | 23% | **10 处（等于没改）** |
 * | **B 标题不动；正文死区抬到 1.5；≥1.5 就近归并** | 23% | **2 处** |
 * | C 同 B，但标题也归并到 1.1/1.2/1.3 | 36% | 2 处 |
 *
 * A 失败的原因很具体：**1.35–1.5 正是 S3 的告警区**，把值归到 1.35 等于把问题从
 * “没那么紧”变成“依然紧”。C 多改 56% 的声明却零收益。所以选 B。
 *
 * 保留下来的东西：<1.2（大字号紧凑排版是刻意为之）、>2.2（松散排版同理）、
 * px / var() / calc()（实际行高由字号与变量决定，不知道就不改）。
 *
 * @param {string} source
 * @param {{ladder?:number[]}} [opts]
 */
export function normalizeLeading(source, opts = {}) {
	const ladder = (Array.isArray(opts.ladder) ? opts.ladder : LEADING_LADDER)
		.map(Number)
		.filter((n) => Number.isFinite(n) && n >= 1.2 && n <= 2.2)
		.sort((a, b) => a - b);
	if (ladder.length === 0) throw new Error("行高阶梯至少给一档（1.2–2.2 之间）");
	// 比较要带容差：浮点下 |1.6-1.7| 与 |1.8-1.7| 差在 1e-16 量级，
	// 严格 `<=` 会让 1.7 判到 1.6（本意是平局取大）——合成夹具当场拦下。
	const nearest = (n) => ladder.reduce((best, s) => (Math.abs(s - n) <= Math.abs(best - n) + 1e-9 ? s : best), ladder[0]);

	const changes = [];
	let skipped = 0;
	let output = String(source);
	const decls = scanDecls(output).filter((d) => d.prop === "line-height");
	for (let i = decls.length - 1; i >= 0; i -= 1) {
		const decl = decls[i];
		const value = decl.value.trim();
		if (/^\d*\.?\d+$/.test(value) === false) {
			skipped += 1; // px / var / calc / normal：实际行高由上下文决定
			continue;
		}
		if (HEADING_SELECTOR.test(decl.selector ?? "")) {
			skipped += 1; // 标题紧凑行高是正确做法，S3 也不判它
			continue;
		}
		const current = Number(value);
		if (current < 1.2 || current > 2.2) {
			skipped += 1;
			continue;
		}
		// 死区 [1.2, 1.5) 抬到阶梯最小档；其余就近归并（平局取大）
		const target = current < 1.5 ? ladder[0] : nearest(current);
		const next = String(target);
		if (next === value) continue;
		output = output.slice(0, decl.valueStart) + next + output.slice(decl.valueEnd);
		changes.push({ prop: "line-height", from: value, to: next, selector: decl.selector ?? "" });
	}
	changes.reverse();
	return { output, changes, skipped };
}

/** 圆角属性（四角单写也要管，否则只改 border-radius 会漏一半）。 */
export const RADIUS_PROPS = new Set([
	"border-radius",
	"border-top-left-radius",
	"border-top-right-radius",
	"border-bottom-left-radius",
	"border-bottom-right-radius"
]);

/** 圆角阶梯：4 档，对齐 4px 网格（2px 给描边微调）。 */
export const RADIUS_LADDER = [2, 4, 8, 12];

/**
 * 圆角盘点：**先判断“该不该改”，再谈怎么改**。
 *
 * 四个真实项目的数据（2026-11-08）：
 *
 * | 项目 | 可改 px | 已是 var() | 保留(%/0/999) |
 * |---|---|---|---|
 * | Colibri | 9 | **119** | 16 |
 * | Echo | 0 | **34** | 0 |
 * | Flow-Pilot | 1 | **7** | 0 |
 * | 旧版 0.5.4 | **124** | 0 | 47 |
 *
 * 结论：**现代项目已经令牌化了，改散落 px 等于白忙**；只有手写时代的项目才真需要收敛。
 * 所以 tokenized 比例是“该不该做这件事”的门槛，而不是一个可选指标。
 */
export function inspectRadius(source) {
	const decls = scanDecls(source).filter((d) => RADIUS_PROPS.has(d.prop));
	const counts = { px: [], tokenized: 0, preserved: 0, other: 0 };
	for (const d of decls) {
		const v = d.value.trim();
		if (/var\(|calc\(/i.test(v)) {
			counts.tokenized += 1;
			continue;
		}
		// 保留：百分比（圆）、0、≥100px（胶囊）
		if (/%/.test(v) || /^0(?:\.0+)?$/.test(v) || /^(?:\d*\.?\d+)px$/.test(v) === false) {
			if (/%/.test(v) || /^0(?:\.0+)?$/.test(v)) counts.preserved += 1;
			else counts.other += 1;
			continue;
		}
		const n = Number.parseFloat(v);
		if (n >= 100) {
			counts.preserved += 1;
			continue;
		}
		counts.px.push(n);
	}
	const total = decls.length;
	return {
		total,
		px: counts.px,
		tokenized: counts.tokenized,
		preserved: counts.preserved,
		other: counts.other,
		// 令牌化率：≥0.5 就该去改 token 值，而不是改散落 px
		tokenizedRatio: total === 0 ? 0 : counts.tokenized / total
	};
}

/**
 * 圆角收敛（只在非令牌化项目上才有意义）。
 *
 * **门槛是故意的**：tokenizedRatio ≥ 0.5 时直接抛错。
 * 理由：把这些项目的 9/0/1 个散落 px 改掉，圆角外观几乎不会变（大头在 var 里），
 * 用户以为“统一了”其实没动——这种“看起来成功、实际无效”的改写比不改更坏。
 * 正确的做法是改 `:root` 里的 `--radius-*` 值。
 *
 * @param {string} source
 * @param {{ladder?:number[]}} [opts]
 */
export function normalizeRadius(source, opts = {}) {
	const info = inspectRadius(source);
	if (info.tokenizedRatio >= 0.5) {
		throw new Error(
			`圆角已令牌化 ${Math.round(info.tokenizedRatio * 100)}%（${info.tokenized}/${info.total} 处用 var()）：` +
				`逐条改散落 px 不会改变外观。应该改 :root 里的 --radius-* 值，或用 layout_check ui 的 radius-blob 看整体是否偏大。`
		);
	}
	const ladder = (Array.isArray(opts.ladder) ? opts.ladder : RADIUS_LADDER)
		.map(Number)
		.filter((n) => Number.isFinite(n) && n > 0)
		.sort((a, b) => a - b);
	if (ladder.length === 0) throw new Error("圆角阶梯至少给一档（如 2,4,8,12）");
	const nearest = (n) => ladder.reduce((best, s) => (Math.abs(s - n) <= Math.abs(best - n) + 1e-9 ? s : best), ladder[0]);

	const changes = [];
	let skipped = 0;
	let output = String(source);
	const decls = scanDecls(output).filter((d) => RADIUS_PROPS.has(d.prop));
	for (let i = decls.length - 1; i >= 0; i -= 1) {
		const decl = decls[i];
		const v = decl.value.trim();
		if (/var\(|calc\(/i.test(v) || /%/.test(v) || /^0(?:\.0+)?$/.test(v)) {
			skipped += 1; // 令牌 / 圆 / 无圆角，都不碰
			continue;
		}
		// 只处理纯 px 单值；多值简写与单角属性不动（单角常是刻意的不对称，简写拆开会丢语义）
		const m = /^(\d*\.?\d+)px$/.exec(v);
		if (m === null || decl.prop !== "border-radius") {
			skipped += 1;
			continue;
		}
		const current = Number(m[1]);
		if (current >= 100) {
			skipped += 1; // 胶囊
			continue;
		}
		const target = nearest(current);
		const next = `${target}px`;
		if (next === v) continue;
		output = output.slice(0, decl.valueStart) + next + output.slice(decl.valueEnd);
		changes.push({ prop: "border-radius", from: v, to: next, selector: decl.selector ?? "" });
	}
	changes.reverse();
	return { output, changes, skipped };
}

/** 只读盘点：间距值分布 + 字号档位（scan 用）。 */
export function inspectCss(source, opts = {}) {
	const grid = Number.isFinite(opts.grid) && opts.grid > 0 ? Math.round(opts.grid) : 4;
	const decls = scanDecls(source);
	const spacing = new Map();
	const sizes = new Map();
	for (const d of decls) {
		if (SPACING_PROPS.has(d.prop)) {
			const tokens = parsePxTokens(d.value);
			if (tokens === null) continue;
			for (const t of tokens) {
				const key = Math.abs(t.num);
				if (key <= 2) continue;
				const entry = spacing.get(key) ?? { px: key, count: 0, onGrid: key % grid === 0 };
				entry.count += 1;
				spacing.set(key, entry);
			}
		} else if (d.prop === "font-size") {
			const m = /^(\d*\.?\d+)px$/.exec(d.value.trim());
			if (m === null) continue;
			sizes.set(Number(m[1]), (sizes.get(Number(m[1])) ?? 0) + 1);
		}
	}
	const offGrid = [...spacing.values()].filter((v) => v.onGrid === false).sort((a, b) => b.count - a.count);
	const total = [...spacing.values()].reduce((sum, v) => sum + v.count, 0);
	return {
		grid,
		spacingTotal: total,
		offGridCount: offGrid.reduce((sum, v) => sum + v.count, 0),
		offGrid: offGrid.slice(0, 20),
		fontSizes: [...sizes.entries()].sort((a, b) => a[0] - b[0]).map(([px, count]) => ({ px, count }))
	};
}

/**
 * Tailwind 任意值字号：`text-[11.5px]` → 就近阶梯。
 *
 * 来由（Flow-Pilot 实测）：layout_check 在 TSX 里数出 8 档字号，但 css_edit 只收
 * .css/.html——真实项目的字号 226 处写在 `text-[11.5px]` 里，改不动，于是「诊断 →
 * 修复 → 复测」在这一步断掉（跑完 scale 后档位从 8 变 9，分数不动）。
 * 这里只替换方括号里的 px 数值，类名前缀、变体前缀（md:、hover:）、其他类名一律不碰。
 */
export function mapTailwindFontSizes(source, opts = {}) {
	const scale = (opts.scale ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
	if (scale.length < 2) throw new Error("mapTailwindFontSizes 需要至少两档 scale");
	const nearest = (n) => scale.reduce((best, s) => (Math.abs(s - n) <= Math.abs(best - n) ? s : best), scale[0]);
	const changes = [];
	const output = source.replace(/(text-\[)(\d*\.?\d+)px(\])/g, (all, head, num, tail) => {
		const value = Number(num);
		const target = nearest(value);
		if (Math.abs(target - value) < 0.01) return all;
		changes.push({ prop: "font-size", from: `${num}px`, to: `${target}px` });
		return `${head}${target}px${tail}`;
	});
	return { output, changes, skipped: 0 };
}

