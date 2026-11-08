/**
 * emit.js — 同一图标按各项目约定出码（icon action=emit 的实现核心）。
 *
 * 四种 target 全部对齐现有代码的真实约定：
 *   colibri    js/ui.js ICONS 字典一行条目（camelCase 键 + 内联串）
 *   echo       import { X } from "lucide" + <MorphIcon> 片段（STYLE_GUIDE §3）
 *   dsh-plugin 插件包 icon.svg（package.json "icon" 字段用）
 *   whale      JS 单引号字符串（innerHTML 直塞）
 *   raw        完整独立 <svg> 标记
 */
import { getIcon } from "./icondb.js";
import { checkIcon, iconToInnerSvg, renderComposed, renderSvg, renderSvgChip, renderSvgGradient, renderSvgLayers } from "./svg.js";
import { CAP_TO_JOIN, PRESETS, clampDim, parseGradientStops } from "./icon-render.js";
import { parseShadows } from "./shadow.js";
import { normalizePathData, normalizeShape, pathNode } from "./svg.js";

const TARGETS = ["colibri", "echo", "dsh-plugin", "whale", "raw"];

// 审查修复 #282：自由文本参数会拼进生成代码（keyName 进 JS 字典键位、
// color/className 进 SVG 属性且产物直塞 innerHTML）——白名单校验挡住
// 引号/尖括号/等号/反斜杠的注入面（含属性越界与字符串字面量损坏）
const KEY_NAME_RE = /^[A-Za-z_$][\w$]*$/; // JS 标识符（ICONS 键位）
const COLOR_RE = /^[\w#(),.%+\- ]+$/; // #hex / rgb() / 命名色 / oklch() 等颜色写法
const CLASS_RE = /^[\w\-.: ]+$/; // class 属性（含 BEM/Tailwind 常见字符）
const SPRINGS = ["snappy", "smooth", "bouncy"];
// 尺寸/描边取值域：先前直接拼进 SVG 属性，`size: 0/-5/NaN` 会产出 width="0"/"-5"/"NaN"
// 这种坏 SVG（渲染空白或直接报错），必须在出码前拦下。
const SIZE_MIN = 4;
const SIZE_MAX = 4096;
const STROKE_MAX = 64;

/**
 * codereview #481：三个走 renderSvg 的 target 原先各自手写同一套 size/strokeWidth/color
 * 默认值合并（仅 size 缺省不同：whale 16、其余 24），strokeWidth=2/currentColor 还与
 * renderSvg 内部默认重复、双方调整会漂移——统一在这里维护。未显式给的键不挂
 * （undefined 回退交给 renderSvg 内部的 ?? 处理）；className 仅 raw target 消费。
 */
function renderOpts(opts, defaultSize, withClassName = false) {
	const out = { size: opts.size ?? defaultSize };
	if (opts.strokeWidth !== undefined) out.strokeWidth = opts.strokeWidth;
	if (opts.color !== undefined) out.color = opts.color;
	if (withClassName && opts.className !== undefined) out.className = opts.className;
	return out;
}

/** 包数据里的 fill 风格图标（品牌/实心）：stroke 型 target 渲染会走样，出码时附提示。 */
function fillDrawn(node) {
	return node.some(([, attrs]) => typeof attrs?.fill === "string" && attrs.fill !== "none");
}
function fillNote(icon, target) {
	if (!fillDrawn(icon.node)) return null;
	return target === "raw" || target === "dsh-plugin"
		? `该图标为 fill 风格（来自 ${icon.pack} 包），已保留内部 fill 属性；如需纯 stroke 请换 lucide 图标`
		: `该图标为 fill 风格（来自 ${icon.pack} 包），${target} 走 stroke 渲染管线可能走样；品牌/实心图标建议改用 raw target`;
}

/**
 * 出码样式（九种视觉语言，前四种是字重/填充变体，后五种是不同设计语言）：
 *   outline   2px 线性（Feather/Lucide 基线，默认）
 *   hairline  1px 细线（高端编辑/奢侈品观感，小尺寸慎用）
 *   bold      2.8px 粗线（强识别，16px 仍清楚）
 *   sharp     butt/miter 尖角（Material sharp 方向）
 *   solid     填充版（tabler -filled，16px 下是最清楚的）
 *   duotone   填充 20% + 线稿（Phosphor duotone 观感）
 *   badge     圆角方块底色 + 反白图标（SaaS 功能入口）
 *   knockout  正圆底色 + 反白图标（app icon 语言）
 *   gradient  渐变描边（营销/展示位）
 */
const STYLES = ["outline", "hairline", "bold", "sharp", "solid", "duotone", "badge", "knockout", "gradient"];
/** 字体细线与粗线的固定字重（比让模型猜 1 还是 2.8 可靠）。 */
const WEIGHT_OF_STYLE = { hairline: 1, bold: 2.8, badge: 1.8, knockout: 1.8, gradient: 2.2 };

/** 同包内的填充版/线性版配对。tabler 有 1088 个 −filled，其中 1057 个有线性双胞胎；
 * lucide 没有 −filled。duotone 就靠这对双胞胎合成，不需要额外的 duotone 数据集。 */
function twinOf(icon, suffix, { crossPack = false } = {}) {
	// 按「主名 + 别名」找配对：lucide 的 home 是别名→house，而 tabler 里同名填充版叫 home-filled，
	// 只查主名会漏。solid 允许跨包（整个图标被替换，不会混搭）；duotone 必须同包（两层要叠在一起）。
	const bases = suffix ? [icon.name, ...(icon.aliases ?? [])] : [icon.name.replace(/-filled$/, "")];
	for (const base of bases) {
		const wanted = `${base}${suffix}`;
		if (wanted === "" || wanted === icon.name) continue;
		const same = getIcon(`${icon.pack}:${wanted}`);
		if (same !== undefined && same.pack === icon.pack) return same;
		if (crossPack) {
			const any = getIcon(wanted);
			if (any !== undefined) return any;
		}
	}
	return undefined;
}

/**
 * 把「样式意图」解成两层图标 + 端点设置。
 * @returns {{primary:object, secondary?:object, linecap:string, linejoin:string, style:string, notes:string[]}}
 */
/** 找 duotone 配对（线性 + 填充，必须同一包才能叠）：先同包，找不到再按名字/别名
 * 在其它包里找一对（如 lucide 的 heart 无填充版，但 tabler 的 heart/heart-filled 是完整一对）。 */
function duotonePair(icon) {
	const bases = [icon.name, ...(icon.aliases ?? [])];
	if (icon.name.endsWith("-filled")) {
		const outline = twinOf(icon, "");
		if (outline !== undefined) return { outline, filled: icon };
	}
	// 同包同名配对（最常见：tabler 的 heart + heart-filled）
	const sameFilled = twinOf(icon, "-filled");
	if (sameFilled !== undefined) return { outline: icon, filled: sameFilled };
	// 同包「别名」配对（名字不同但指同一概念）
	for (const base of bases) {
		if (base === icon.name) continue;
		const viaAlias = twinOf({ ...icon, name: base }, "-filled");
		if (viaAlias === undefined) continue;
		const aliasOutline = getIcon(`${icon.pack}:${base}`);
		return { outline: aliasOutline ?? icon, filled: viaAlias };
	}
	for (const base of bases) {
		const filled = getIcon(`${base}-filled`);
		if (filled === undefined) continue;
		const outline = twinOf(filled, "");
		if (outline !== undefined) return { outline, filled };
	}
	return undefined;
}

/**
 * 把「预设 + 显式维度覆盖」合成为一组轴。
 *
 * 设计要点：style 只是**默认起点的快捷命名**，下面每一个维度都可以单独覆盖——
 * 所以「圆角方容器 + both 绘法 + 平头线端 + 径向渐变 + 32° 角度」这种组合能表达，
 * 而不是只能在 9 个互斥配方里选一个。
 * 传入的维度值优先于预设；传入 none/null 可以主动关掉预设的某一维。
 */
function mergeAxes(style, opts = {}) {
	const preset = PRESETS[style] ?? PRESETS.outline;
	const axes = {
		paint: preset.paint ?? "stroke",
		weight: preset.weight,
		caps: preset.caps ?? "round",
		join: preset.caps === "butt" || preset.caps === "square" ? "miter" : "round",
		container:
			preset.container === undefined
				? null
				: { kind: preset.container, radius: preset.radius, inset: preset.inset },
		gradient: preset.gradient === undefined ? null : { kind: preset.gradient, angle: preset.gradientAngle ?? 45 },
		duo: preset.duo === undefined ? null : { opacity: preset.duo }
	};

	// —— 显式覆盖：逐维 ——
	if (opts.paint !== undefined) axes.paint = opts.paint;
	if (opts.caps !== undefined) {
		axes.caps = opts.caps;
		axes.join = CAP_TO_JOIN[opts.caps]?.[1] ?? axes.join;
	}
	if (opts.join !== undefined) axes.join = opts.join;

	// 容器：none 主动去掉；给了具体形状则新建/改写
	if (opts.container !== undefined) {
		if (opts.container === "none") axes.container = null;
		else axes.container = { ...(axes.container ?? {}), kind: opts.container };
	}
	if (axes.container !== null) {
		const r = clampDim("radius", opts.radius);
		const i = clampDim("inset", opts.inset);
		if (r !== undefined) axes.container.radius = r;
		if (i !== undefined) axes.container.inset = i;
	}

	// 渐变：none 主动去掉；给了类型则新建
	if (opts.gradient !== undefined) {
		if (opts.gradient === "none") axes.gradient = null;
		else axes.gradient = { ...(axes.gradient ?? {}), kind: opts.gradient };
	}
	if (axes.gradient !== null) {
		const ang = clampDim("gradientAngle", opts.gradientAngle);
		if (ang !== undefined) axes.gradient.angle = ang;
	}

	// 双色：duoOpacity > 0 就启用（即使预设不是 duotone）
	if (opts.duoOpacity !== undefined) {
		const o = clampDim("duo", opts.duoOpacity);
		if (o !== undefined) axes.duo = o > 0 ? { opacity: o } : null;
	}

	const w = clampDim("weight", opts.strokeWidth);
	if (w !== undefined) axes.weight = w;
	return axes;
}

/** 需要填充孪生体的场景：fill 绘法、容器型、双色底图。 */
function needsFillTwin(axes) {
	return axes.paint === "fill" || axes.paint === "both" || axes.container !== null || axes.duo !== null;
}

function resolveStyle(icon, style, opts = {}) {
	const axes = mergeAxes(style, opts);
	const notes = [];
	let primary = icon;
	let secondary;

	// 容器型：字形优先用填充版（容器内小尺寸下描边容易糊成一片）。
	// 但如果容器是**全透明**（借它的缩放/留白但不画底色），就不该换填充版：
	// 没底色衬托，换掉只会把细线风格变成实心块（实测：简约风格被改成黑齿轮）。
	const containerInvisible =
		axes.container !== null && /^(transparent|rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0?(\.0*)?\s*\))$/i.test(String(opts.color ?? ""));
	// 传了 dash 就是“我要描边虚线”，也不该换成填充字形（换了就没描边可虚线）。
	const wantsStroke = Array.isArray(opts.dash) && opts.dash.length > 0;
	// 自绘路径不进库内替换逻辑：用户自己画的形状，paint 直接生效就是对的，
	// 去库里找「填充版」既找不到（实测会抡错），也违背自绘的本意。
	const isCustom = icon.custom === true;
	if (!isCustom && axes.container !== null && !containerInvisible && !wantsStroke && !fillDrawn(icon.node)) {
		const glyph = twinOf(icon, "-filled", { crossPack: true });
		if (glyph !== undefined) {
			primary = glyph;
			notes.push(`容器型字形用填充版 ${glyph.name}（小尺寸更清）`);
		}
	}

	// 双色：需要线性 + 填充 一对（自绘路径没有配对，直接跳过）
	if (!isCustom && axes.duo !== null) {
		const pair = duotonePair(primary);
		if (pair === undefined) {
			throw new Error(`「${primary.name}」找不到线性+填充配对，不能做双色：用 icon action=find query="填充的${primary.name}" 选带 filled 的图标，或去掉 duoOpacity`);
		}
		primary = pair.outline;
		secondary = pair.filled;
	}

	// 纯填充（且无双色）：需要填充节点（自绘路径本身就是可填充形状，跳过）
	if (!isCustom && axes.paint === "fill" && axes.duo === null && !fillDrawn(primary.node)) {
		const filled = twinOf(primary, "-filled", { crossPack: true });
		if (filled === undefined) {
			throw new Error(`「${primary.name}」没有填充版：用 icon action=find query="填充的${primary.name}" 直接选 filled 图标，或改 paint=stroke`);
		}
		primary = filled;
		notes.push(`fill 绘法已改用填充版 ${filled.name}${filled.pack !== icon.pack ? `（来自 ${filled.pack} 包）` : ""}`);
	}

	// 兼容字段：colibri/echo 等 emitter 靠它们判断「本 target 能不能表达这个外观」
	// 容器 + 渐变时字形固定白（否则 color2 双重语义会让字形不可见）：说出口，
	// 不要让人以为 color2 还能控字形色。
	if (axes.container !== null && axes.gradient !== null) {
		notes.push("容器 + 渐变：渐变画在容器底上，字形固定白色（color2 只控渐变末色）——iOS/Win11 图标的典型做法");
	}
	// strokeWidth 对填充字形不生效（描填充字形只会在外圈糊一层）：明确说出来，
	// 不能像以前那样静默忽略——AI 会以为自己调了粗细而实际什么都没变。
	if (
		opts.strokeWidth !== undefined &&
		fillDrawn(primary.node) &&
		axes.paint === "stroke"
	) {
		notes.push(
			`该图标用填充字形，strokeWidth=${opts.strokeWidth} 不生效（描填充字形会在外圈糊一层）；要描边请换线性图标，或传 paint=both 显式两层`
		);
	}

	return {
		primary,
		secondary,
		style,
		axes,
		// wrap 保留「容器类型名」作为对外回填值（chip 形状：rounded/circle/squircle）
		...(axes.container !== null ? { wrap: { ...axes.container, kind: axes.container.kind } } : {}),
		...(axes.gradient !== null ? { gradient: true } : {}),
		notes
	};
}

/**
 * 按轴渲染完整 SVG（raw / dsh-plugin / whale 共用）。
 * 不再按 style 分派，而是把 spec.axes 交给 renderComposed 合成——
 * 这样任意维度组合（容器 + both + 径向渐变 + 平头）都能表达。
 */
function styledSvg(spec, opts, defaultSize, withClassName = false) {
	const ro = renderOpts(opts, defaultSize, withClassName);
	const a = spec.axes;
	const baseColor = spec.wrap !== undefined ? (opts.color ?? "#141414") : (opts.color ?? (spec.gradient ? "#E4002B" : "currentColor"));
	// 阴影是**图元**（偏移+模糊+颜色），不是风格：给任意轮廓加上它，
	// 高程体系/卡片/浮层/按奥/浮雕/双光源都能自己拼。
	const shadows = parseShadows(opts.shadow).list;
	const dash = Array.isArray(opts.dash) && opts.dash.length > 0 ? opts.dash : undefined;
	// 多形状组合（对象数组）：{ name, scale?, dx?, dy?, rotate?, color?, weight?, subtract? }
	// 这是通用图元：环/中空/徽章+图形/多层插画全靠它拼，不内置任何具体形状。
	const gradientStops = parseGradientStops(opts.stops);
	const shapes = (Array.isArray(opts.shapes) ? opts.shapes : [])
		.map((raw) => {
			const spec = normalizeShape(raw);
			if (spec === null) return null;
			// 自绘图层不需要查库
			if (typeof spec.path === "string") return { ...spec, node: pathNode(spec.path) };
			const entry = getIcon(spec.name);
			return entry === undefined ? null : { ...spec, node: entry.node };
		})
		.filter((s) => s !== null);
	const svg = renderComposed({
		node: spec.primary.node,
		paint: a.paint,
		strokeWidth: a.weight ?? (spec.wrap !== undefined ? 1.8 : 2),
		caps: a.caps,
		join: a.join,
		size: ro.size,
		color: baseColor,
		className: ro.className,
		...(shadows.length > 0 ? { shadows } : {}),
		...(dash !== undefined ? { dash } : {}),
		...(shapes.length > 0 ? { shapes } : {}),
		// 顶层 fill-rule：让自绘路径自己就能画环（多子路径 + evenodd）
		...(opts.fillRule === "evenodd" || opts.fillRule === "nonzero" ? { fillRule: opts.fillRule } : {}),
		// 图标内文字：给了就取代字形（字母标/字母徽章）
		...(typeof opts.text === "string" && opts.text.trim() !== ""
			? { text: { content: opts.text.trim(), ...(Number.isFinite(opts.textSize) && opts.textSize > 0 ? { size: opts.textSize } : {}) } }
			: {}),
		// **color2 的语义冲突（实测 bug）**：容器 + 渐变同时存在时，
		// color2 既是「渐变末色」又被拿去当字形色，结果字形跟容器同色系、几乎看不见
		// （iOS / Win11 / 拟物图标全中招）。现实里这两类图标的字形几乎总是白的，
		// 所以：有渐变时字形固定白（color2 专心控渐变）；没渐变时 color2 才是字形色。
		...(spec.wrap !== undefined
			? {
					container: {
						...spec.wrap,
						color: baseColor,
						glyphColor: spec.gradient === true ? "#FFFFFF" : (opts.color2 ?? "#FFFFFF")
					}
				}
			: {}),
		// 传了 stops 却没传 gradient → 默认当线性渐变。
		// 否则 stops 会被静默丢弃（实测：容器渲染成一片黑，而调用方以为自己给了渐变）——
		// “看起来能用的参数实际零效果”是最坑的一类。
		...((spec.gradient !== undefined && a.gradient !== null) || gradientStops !== null
			? {
					gradient: {
						kind: spec.gradient !== undefined && a.gradient !== null ? a.gradient.kind : "linear",
						angle: spec.gradient !== undefined && a.gradient !== null ? a.gradient.angle : (Number.isFinite(opts.gradientAngle) ? opts.gradientAngle : 45),
						...(gradientStops !== null ? { stops: gradientStops } : { color: opts.color ?? "#E4002B", ...(opts.color2 !== undefined ? { color2: opts.color2 } : {}) })
					}
				}
			: {}),
		...(spec.secondary !== undefined && a.duo !== null ? { duo: { node: spec.secondary.node, opacity: a.duo.opacity } } : {})
	});
	// 非 hex 颜色算不出末色：回退实色绘法，而不是默默产出坏渐变
	if (svg !== null) return svg;
	return (
			renderComposed({
			node: spec.primary.node,
			paint: a.paint,
			strokeWidth: a.weight ?? 2,
			caps: a.caps,
			join: a.join,
			size: ro.size,
			color: baseColor,
			className: ro.className,
			...(dash !== undefined ? { dash } : {}),
			...(spec.secondary !== undefined && a.duo !== null ? { duo: { node: spec.secondary.node, opacity: a.duo.opacity } } : {})
		}) ?? renderSvg(spec.primary.node, { ...ro, strokeWidth: a.weight ?? 2, linecap: a.caps, linejoin: a.join })
	);
}

function emitColibri(spec, opts) {
	const icon = spec.primary;
	const camel = opts.keyName ?? icon.camel;
	// 容器型/渐变型在 colibri 上不可表达：ICONS 字典的 inner 只有 currentColor 一色
	if (spec.wrap !== undefined || spec.gradient === true) {
		return {
			code: `${camel}: '${iconToInnerSvg(icon.node)}',`,
			filename: null,
			notes: [
				`${spec.style} 在 colibri 上不可表达（ICONS 字典的 inner 只能单色 currentColor），已退化为 outline`,
				`粘贴到项目 js/ui.js 的 ICONS 字典；渲染走 UI.svg('${camel}')`
			]
		};
	}
	// duotone 的填充层不能用 <g>（Colibri parseIconNodes 不认分组），下推到元素属性
	const inner = spec.secondary !== undefined
		? iconToInnerSvg(spec.secondary.node, { fill: "currentColor", "fill-opacity": "0.2", stroke: "none" }) + iconToInnerSvg(icon.node)
		: iconToInnerSvg(
				icon.node,
				spec.axes.caps === "round" ? undefined : { "stroke-linecap": spec.axes.caps, "stroke-linejoin": spec.axes.join }
			);
	const check = checkIcon(icon.node);
	const notes = [
		`粘贴到项目 js/ui.js 的 ICONS 字典；渲染走 UI.svg('${camel}')`,
		check.ok ? "已通过 morph 兼容体检，可直接用于 morphTo" : "注意：未通过 morph 兼容体检（见 morph action=check 结果）"
	];
	return { code: `${camel}: '${inner}',`, filename: null, notes };
}

/** echo 是 Vue 项目形态：不同图标集的 import 源不同。
 * 旧实现硬编码 lucide，给 tabler 图标（如 heart-filled）生成 `import … from "lucide"` 直接报错。 */
const ECHO_IMPORT_SOURCE = { lucide: "lucide", tabler: "@tabler/icons-vue" };

/** 按图标集分组生成 import 行（同名去重；跨包时输出多行）。 */
function echoImportLines(icons) {
	const bySource = new Map();
	for (const icon of icons) {
		const source = ECHO_IMPORT_SOURCE[icon.pack] ?? icon.pack;
		const names = bySource.get(source) ?? [];
		if (!names.includes(icon.pascal)) names.push(icon.pascal);
		bySource.set(source, names);
	}
	return [...bySource].map(([source, names]) => `import { ${names.join(", ")} } from "${source}";`);
}

function emitEcho(spec, opts) {
	const icon = spec.primary;
	const lines = [];
	const notes = ["组件来自 morphicons/vue；两态切换才用 MorphIcon，静态图标用 vicons（emoji 全面禁用）"];
	// MorphIcon 只能挂一个组件、且不暴露 linecap：双层/尖角/容器样式在 echo 上不可表达，退化为 outline
	if (spec.secondary !== undefined) notes.push("echo/MorphIcon 不支持双层 duotone，已退化为 outline；需要双色请用 target=raw/dsh-plugin");
	if (spec.wrap !== undefined) notes.push(`echo/MorphIcon 不支持 ${spec.style} 容器样式（底色需另一元素），已退化为 outline；需要容器请用 target=raw/dsh-plugin`);
	if (spec.gradient === true) notes.push("echo/MorphIcon 不支持渐变描边，已退化为 outline；需要渐变请用 target=raw");
	if (spec.axes.caps !== "round") notes.push(`${spec.style}（caps=${spec.axes.caps}）：echo/MorphIcon 不暴露 linecap/linejoin，在 echo 上不生效；需要非圆角线端请用 target=raw`);
	const usedIcons = [icon];
	if (icon.pack !== "lucide") {
		notes.push(`这是 ${icon.pack} 图标：import 源是 ${ECHO_IMPORT_SOURCE[icon.pack] ?? icon.pack}（Echo 项目约定只用 lucide，接线前确认依赖已装）`);
	}
	lines.push(echoImportLines(usedIcons).join("\n") + (icon.pack === "lucide" && !opts.partner ? " // 仅作数据源（STYLE_GUIDE §3：lucide 只为 morphicons 供数）" : ""));
	if (opts.partner) {
		const partner = getIcon(opts.partner);
		// 审查修复 #281：伙伴解析到同一主名（别名撞车，如 home/house 同指 house）
		// 会生成 import { House, House } 重复绑定（ES 语法错误）且两态切换无意义
		// ——退回单图标片段，并把降级原因写进 notes（原先只有代码内 HTML 注释，
		// 调用方无从得知两态片段未生成）
		if (partner !== undefined && partner.pascal !== icon.pascal) {
			usedIcons.push(partner);
			lines[0] = echoImportLines(usedIcons).join("\n");
			if (partner.pack !== "lucide") {
				notes.push(`伙伴图标也来自 ${partner.pack}：import 源 ${ECHO_IMPORT_SOURCE[partner.pack] ?? partner.pack}`);
			}
			if (partner.pack !== icon.pack) {
				notes.push(`两态图标来自不同图标集（${icon.pack} ↔ ${partner.pack}）：几何基准可能不同，接线前先 morph action=check 对比`);
			}
			lines.push(`<MorphIcon :icon="state ? ${partner.pascal} : ${icon.pascal}" spring="${opts.spring ?? "snappy"}" />`);
			lines.push(`<!-- 两态切换：${icon.name} ↔ ${partner.name}；snappy=状态反馈 / smooth=稳重过渡 -->`);
		} else {
			const reason = partner === undefined ? `"${opts.partner}" 不在 lucide 库中` : `"${opts.partner}" 与 ${icon.name} 解析为同一图标（${icon.pascal}），两态切换无意义`;
			lines.push(`<!-- 伙伴图标 ${reason}，仅生成单图标片段 -->`);
			lines.push(`<MorphIcon :icon="${icon.pascal}" />`);
			notes.push(`两态片段未生成：${reason}；如需两态请换一个不同的伙伴图标`);
		}
	} else {
		lines.push(`<MorphIcon :icon="${icon.pascal}" />`);
		lines.push(`<!-- 注意：静态功能图标不得用 MorphIcon 装载，走 n-icon + @vicons（三层分工） -->`);
	}
	return { code: lines.join("\n"), filename: null, notes };
}

function emitDshPlugin(spec, opts) {
	const color = opts.color ?? "currentColor";
	const svg = styledSvg(spec, opts, 24);
	return {
		code: svg,
		filename: "icon.svg",
		notes: [
			'保存为插件目录内的 icon.svg，并在 package.json 声明 "icon": "./icon.svg"',
			color === "currentColor" ? "currentColor 需内联渲染才生效；若作为独立图片引用请用 color 参数指定具体颜色" : null
		].filter(Boolean)
	};
}

function emitWhale(spec, opts) {
	const svg = styledSvg(spec, opts, 16);
	// 审查修复 #282：先转义反斜杠再转义单引号——原顺序下内容含 \ 时，
	// \' 会被解析成「转义后的引号」吞掉闭合引号，字符串字面量直接损坏
	const oneLine = "'" + svg.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
	return { code: `el.innerHTML = ${oneLine};`, filename: null, notes: ["单行 JS 字符串，直接塞 innerHTML；emoji 图标请全部替换为本方式"] };
}

function emitRaw(spec, opts) {
	const icon = spec.primary;
	const svg = styledSvg(spec, opts, 24, true);
	// codereview #482：outPath 以分隔符结尾（如 "icons/" 或 "./"）时 basename 为空串——
	// 原样返回 filename:'' 会误导调用方；回退为 <icon.name>.svg（与「落盘到该目录」的
	// 意图一致）。outPath 未给时维持 null（与原先一致，由调用方决定命名）。
	const basename = typeof opts.outPath === "string" ? opts.outPath.split(/[\\/]/).pop() : null;
	return {
		code: svg,
		filename: basename ? basename : (opts.outPath !== undefined ? `${icon.name}.svg` : null),
		notes: [
			fillDrawn(icon.node)
				? "fill 风格图标：内部 path 自带 fill，根壳用 color 属性承接 color 参数（不再叠加描边）"
				: "24×24 stroke 风格，fill=none + currentColor；如需填色风格自行调整属性"
		]
	};
}

/** 出码入口：输入 lucide 名（或已解析条目），返回 { target, code, filename, notes, icon }。 */
function emit(nameOrIcon, target, opts = {}) {
	if (!TARGETS.includes(target)) throw new Error(`unknown emit target "${target}"（可用：${TARGETS.join(", ")}）`);
	// 审查修复 #282：自由文本参数注入面校验（keyName/color/className 白名单，
	// 非法值响亮失败——与 unknown target 同一错误风格）
	if (opts.keyName !== undefined && !KEY_NAME_RE.test(opts.keyName)) {
		throw new Error(`keyName 必须是合法 JS 标识符（收到 "${opts.keyName}"）——它会被拼进 ICONS 字典键位`);
	}
	if (opts.color !== undefined && !COLOR_RE.test(opts.color)) {
		throw new Error(`color 含不允许的字符（收到 "${opts.color}"）——仅接受 #hex / rgb() / 命名色等颜色写法（白名单：字母数字与 # ( ) , . % + - 空格）`);
	}
	if (opts.className !== undefined && !CLASS_RE.test(opts.className)) {
		throw new Error(`className 含不允许的字符（收到 "${opts.className}"）——class 属性白名单：字母数字与 - _ . : 空格`);
	}
	if (opts.size !== undefined) {
		if (typeof opts.size !== "number" || !Number.isFinite(opts.size) || opts.size < SIZE_MIN || opts.size > SIZE_MAX) {
			throw new Error(`size 必须是 ${SIZE_MIN}–${SIZE_MAX} 的数字（收到 ${JSON.stringify(opts.size)}）——它会被拼进 svg 的宽高属性`);
		}
	}
	if (opts.strokeWidth !== undefined) {
		if (typeof opts.strokeWidth !== "number" || !Number.isFinite(opts.strokeWidth) || opts.strokeWidth < 0 || opts.strokeWidth > STROKE_MAX) {
			throw new Error(`strokeWidth 必须是 0–${STROKE_MAX} 的数字（收到 ${JSON.stringify(opts.strokeWidth)}）`);
		}
	}
	if (opts.spring !== undefined && !SPRINGS.includes(opts.spring)) {
		throw new Error(`unknown spring "${opts.spring}"（可用：${SPRINGS.join(", ")}）`);
	}
	if (opts.color2 !== undefined && !COLOR_RE.test(opts.color2)) {
		throw new Error(`color2 含不允许的字符（收到 "${opts.color2}"）——仅接受 #hex / rgb() / 命名色等颜色写法`);
	}
	// codereview #483：空值防护同时拦 undefined 与 null——原先只查 undefined，
	// null 条目会漏到 emitter 内部访问 icon.node 时抛裸 TypeError（无法定位）；
	// 非字符串入参为空值时也不再误报成 unknown lucide icon "null/undefined"。
	// 图标内文字场景下 name 可以不传：文字会取代字形，但内部仍需一个占位图标
	// （container / 阴影轮廓 / 元信息都依赖它）。用 circle 作占位，它不会被绘制。
	const hasText = typeof opts.text === "string" && opts.text.trim() !== "";
	// 自绘：给了 path 就直接用路径当字形，不需要图标名。
	// 包成与库图标同构的节点，所以容器/阴影/渐变/遮罩/虚线/旋转全部照旧生效。
	const customPath = normalizePathData(opts.path);
	const icon = customPath !== null ? { name: "(custom path)", node: pathNode(customPath), custom: true } : typeof nameOrIcon === "string" && nameOrIcon.trim() !== "" ? getIcon(nameOrIcon) : hasText ? getIcon("circle") : nameOrIcon;
	if (icon === undefined || icon === null) {
		throw new Error(
			typeof nameOrIcon === "string"
				? `unknown lucide icon "${nameOrIcon}"（lucide/tabler 是通用图标集，不含品牌 logo；品牌请用 design_render action=asset mode=find 检索内置素材库）`
				: "emit 需要图标名（string）或已解析条目（icon 对象），收到空值"
		);
	}
	const style = opts.style ?? "outline";
	if (!STYLES.includes(style)) throw new Error(`unknown style "${style}"（style 只是预设起点，可用：${STYLES.join(", ")}；要自定义请用 paint/caps/container/radius/inset/gradient/gradientAngle 这些维度参数）`);
	const spec = resolveStyle(icon, style, opts);
	const emitter = { colibri: emitColibri, echo: emitEcho, "dsh-plugin": emitDshPlugin, whale: emitWhale, raw: emitRaw }[target];
	const out = emitter(spec, opts);
	// 填色提醒只在 outline 有意义；solid/duotone 本来就是要填的
	const note = style === "outline" ? fillNote(spec.primary, target) : null;
	return {
		target,
		style,
		...(spec.wrap !== undefined ? { container: spec.wrap.kind } : {}),
		// 只写**真的有值**的字段：自绘路径没有 pascal/camel/pack，
		// 直接写 spec.primary.pascal 会得到 undefined 属性质，输出就不是无损 JSON 了
		// （实测实机报 invalid output: value is not lossless JSON）。
		icon: {
			name: spec.primary.name,
			...(spec.primary.pascal !== undefined ? { pascal: spec.primary.pascal } : {}),
			...(spec.primary.camel !== undefined ? { camel: spec.primary.camel } : {}),
			nodeCount: spec.primary.node.length,
			...(spec.primary.pack !== undefined && spec.primary.pack !== "lucide" ? { pack: spec.primary.pack } : {})
		},
		...out,
		notes: [...(note === null ? [] : [note]), ...spec.notes, ...(out.notes ?? [])]
	};
}

export { STYLES, TARGETS, emit };
