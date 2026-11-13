/**
 * dsh-visualkit — 视觉设计工具箱（Visual Design Toolkit，独立插件）。
 *
 * 定位：给**工具和框架**，不给风格目录。同一套原语（配色/字体/形状/图案/栅格/动效/交互态）
 * 可以落到任意视觉场景——UI 设计、网页、平面、海报、文本排版——风格由使用者组合出来。
 * 名字选“视觉”的理由：所有工具都只作用于可见、可量的视觉量，不处理创意构思、
 * 叙事、声音或交互流程逻辑（见 docs/positioning.md）。
 *
 * 8 个网关工具：
 *   icon            action=find|emit              图标检索 / 按项目约定出码
 *   morph           action=check|preview          形变兼容体检 / 动效预览
 *   taste_check     action=taste|audit            AI 味量化体检 / 图标规范巡检
 *   layout_check    action=ui|svg|image           排版与构图体检
 *   design_style    format=css|json|tailwind|motion  风格 token + 结构配方 / 交互原语层
 *   design_render   action=render|composite|asset|html|diff  SVG→PNG / 合成 / 素材 / HTML 截图 / 差异
 *   html_edit       action=scan|rewrite           上下文感知的 HTML 改写
 *   css_edit        action=scan|snap|scale|leading|radius  机械收敛（默认不写盘）
 *
 * **独立性**：零运行时依赖，resvg 以 vendored 形式放在 vendor/（见 THIRD_PARTY.md）。
 * 除 design_render action=html 调用本机浏览器外不启动外部进程，不需要 Python、
 * Krita 或 PSD 工具链。
 *
 * @module dsh-visualkit
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";

import { defineTool } from "@deepseek-ai/dsh-tools";
import Schema from "@deepseek-ai/schemastery";

import { getIcon, meta as iconDbMeta, registerPack, search as searchIcons } from "./icondb.js";
import { STYLES, TARGETS, emit as emitIcon } from "./emit.js";
import { checkIcon } from "./svg.js";
import { SPRINGS, writePreview, resolveIconInput } from "./preview.js";
import { audit } from "./audit.js";
import { auditImage, auditSource, auditSvg } from "./layouts/index.js";
import { WEIGHTS } from "./layouts/common.js";
import { taste } from "./taste.js";
import { SKELETONS, SKINS, renderStyle } from "./style.js";
import { composite, sizeOf } from "./render.js";
import { locate, locateClass, rewriteByContext } from "./html-context.js";
import { readAsPng } from "./image-normalize.js";
import { batchSummary, imagesInDir } from "./image-batch.js";
import { inspectCss, inspectRadius, mapFontSizes, mapTailwindFontSizes, normalizeLeading, normalizeRadius, snapSpacing } from "./css-rewrite.js";
import { TEST_FILE_RE, isSkippableDir } from "./skip.js";
import { renderSvg } from "./render.js";
import { asset } from "./assets.js";
import { renderHtml } from "./render-html.js";
import { measureRenderedContrast } from "./contrast-render.js";
import { imageDiff } from "./diff.js";

/** Cordis 插件名（loader 诊断用）。 */
const name = "tool-visualkit";
/** 依赖的宿主服务：工具注册器与系统提示组装。 */
const inject = ["tools", "systemPrompt"];

/**
 * 官方配置契约：导出 Standard Schema（Schemastery）的 Config。
 * 只保留运行期用得到的 7 项：输出目录、检索条数、扫描与返回上限、图标包、
 * 浏览器路径、工具档位。引擎路径与各类超时随外部调度一起取消。
 */
const Config = Schema.object({
	previewDir: Schema.string().default("").description("morph preview 默认输出目录（空 = 系统临时目录 /dsh-visualkit）"),
	findLimit: Schema.number().default(12).min(1).description("icon find / asset find 默认返回条数"),
	maxAuditFiles: Schema.number().default(4000).min(1).description("taste_check audit 扫描文件数上限"),
	maxFindings: Schema.number().default(60).min(1).description("taste_check audit 返回条数上限"),
	iconPacks: Schema.array(Schema.string()).default(["tabler"]).description("装载的图标包（默认 tabler；simple-icons 需手动指定）"),
	// HTML 渲染需要本机浏览器；留空则自动探测 Edge / Chrome / Chromium。
	browserPath: Schema.string().default("").description("action=html 用的浏览器路径（留空自动探测）"),
	// 按需加载：低频工具不默认进上下文。默认 standard 只装 4 个高频工具，
	// 把 morph / design_style 留给需要时显式开启（实测低频：整轮项目开发里
	// design_style 真实使用 0 次、morph 只做几次体检）。
	toolsetProfile: Schema.string().default("standard").description("minimal（生成+渲染）/ standard（+体检）/ all（+形变+风格 token）")
});

/** 工具名 → 最低档位。内容与 prompt 里的顺序一致。 */
const TOOL_TIER = {
	icon: "minimal",
	design_render: "minimal",
	layout_check: "standard",
	taste_check: "standard",
	html_edit: "standard",
	css_edit: "standard",
	morph: "all",
	design_style: "all"
};
const PROFILE_ORDER = ["minimal", "standard", "all"];
/** 当前档位是否应注册该工具。未知工具名按 minimal（永远装）。 */
function shouldRegister(profile, toolName) {
	const need = TOOL_TIER[toolName] ?? "minimal";
	const at = PROFILE_ORDER.indexOf(profile);
	const needAt = PROFILE_ORDER.indexOf(need);
	return at >= needAt;
}

/** 去掉 undefined 键：工具返回值必须能 JSON 无损往返（宿主会校验）。 */
const plain = (value) => JSON.parse(JSON.stringify(value));

/**
 * `css_edit` 一个样式文件都没收上来时的报错。
 *
 * 实测（Flow-Pilot，2026-11-10）：`action=scale root=.../src/components`（只有 .tsx）
 * 只回一句「没有可处理的 CSS/HTML 文件」，模型于是原地重试同一个调用。这里向上找
 * 最多 3 层，把样式文件到底在哪、有没有 :root 令牌写进错误里，让下一次调用有落点。
 */
function describeEmptyRoot(dir) {
	const styleRe = /\.(?:css|scss|less)$/i;
	const componentRe = /\.(?:tsx?|jsx?|vue|svelte)$/i;
	let probe = dir;
	for (let hop = 0; hop < 3 && typeof probe === "string" && probe !== ""; hop += 1) {
		const styleFiles = [];
		const componentFiles = [];
		let hasRoot = false;
		const scan = (current, depth) => {
			for (const entry of readdirSync(current, { withFileTypes: true })) {
				if (entry.name.startsWith(".")) continue;
				const full = join(current, entry.name);
				if (entry.isDirectory()) {
					if (depth < 2 && isSkippableDir(entry.name) === false) scan(full, depth + 1);
					continue;
				}
				if (styleRe.test(entry.name)) {
					styleFiles.push(full);
					if (hasRoot === false && readFileSync(full, "utf8").includes(":root")) hasRoot = true;
				} else if (componentRe.test(entry.name)) componentFiles.push(full);
			}
		};
		try {
			scan(probe, 0);
		} catch {
			// 目录不可读就继续往上找，报错本身不能因此变成另一个错
		}
		if (styleFiles.length > 0) {
			const shown = styleFiles.slice(0, 3).map((f) => basename(f)).join("、");
			return (
				`没有可处理的 CSS/HTML 文件：${dir}（该目录只有 ${componentFiles.length} 个组件文件）—— ` +
				`样式在 ${dirname(styleFiles[0])}${hasRoot ? "（含 :root 令牌）" : ""}：${shown}` +
				`${styleFiles.length > 3 ? ` 等 ${styleFiles.length} 个` : ""}；把 root 指到该目录重试`
			);
		}
		if (componentFiles.length === 0) break;
		probe = dirname(probe);
	}
	return `没有可处理的 CSS/HTML 文件：${dir}（只收 .css / .html（含内联 <style>）；若样式写在组件内联 style 或工具类里，请把 root 指到含 CSS 或 <style> 的目录/文件）`;
}

const SPRING_ENUM = [...SPRINGS];

/**
 * 提示段：合并原两条（UI 规范 + 平面设计分工），只留「工具分工 + 质量底线 + 风格可协商」。
 * 图标版本、包清单、出码 target、渲染引擎细节都在工具定义里，不重复。
 */
// 提示段只放**工具描述里没有**的东西：
//   ① 工具清单——只列名字（每个工具的能力在它自己的 description 里，不重复）；
//   ② 质量底线——任何风格都不能碎的硬约束；
//   ③ 反同质化立场——风格是选择，有意偏离写声明而不是不调工具。
/** 提示段后缀：与工具清单无关的恒定内容。 */
const SYSTEM_SECTION_TAIL =
	"Quality floor (non-negotiable): no emoji icons, ≥1.6× title/body type jump, 4px grid, full interaction states. Style is a choice — deliberate exceptions go in .design-intent.json, not into the tool call.";

/** 注册全部工具与系统提示。 */
function apply(ctx, config) {
	const iconPacks = Array.isArray(config.iconPacks) ? config.iconPacks : [];
	/** 官方 seam：相对路径先落会话当前目录（exec.agent），缺失才回退 cwd。 */
	async function sessionCwd(exec) {
		try {
			const wd = ctx?.get?.("workingDirectory");
			if (wd !== null && wd !== undefined && exec?.agent) {
				if (typeof wd.ensure === "function") return await wd.ensure(exec.agent, exec.signal);
				if (typeof wd.get === "function" && exec.agent.session) return wd.get(exec.agent.session);
			}
		} catch (error) {
			try {
				ctx?.logger?.warn?.(`[artkit] workingDirectory 读取失败，回退默认目录：${String(error?.message ?? error)}`);
			} catch {
				/* logger 不可用 */
			}
		}
		return undefined;
	}
	/**
	 * 相对路径 → 绝对路径（工具参数统一走会话目录）；**不碰内联标记**。
	 * 2026-11-07 实测 bug：svg 参数可以传 `<svg …>` 内联字符串，早期实现
	 * 会把它当相对路径 join，结果路径里带 `<` → resvg 报 “unknown token at 1:1”。
	 */
	async function resolveArg(value, exec) {
		if (typeof value !== "string" || value.trim() === "") return value;
		if (value.includes("<")) return value;
		if (isAbsolute(value)) return value;
		const cwd = await sessionCwd(exec);
		return join(cwd ?? process.cwd(), value);
	}

	for (const packName of iconPacks) {
		try {
			registerPack(packName);
		} catch {
			// 配置的包不存在：静默跳过（meta().packs 反映实际装载结果）
		}
	}
	const dbMeta = iconDbMeta();

	// 档位解析：非法值直接报错，不静默回落（静默回落会让用户以为 morpht/design_style 坏了）
	const profile = String(config?.toolsetProfile ?? "standard");
	if (!PROFILE_ORDER.includes(profile)) {
		throw new Error(`toolsetProfile must be one of ${PROFILE_ORDER.join(", ")} (got ${JSON.stringify(profile)})`);
	}

	// 提示段只列**当前 scope 真的看得到**的工具：档位降级或宿主侧工具限制后，
	// 这段文字自动跟着变，不会指向不存在的工具。
	// 0.2.2 起装配上下文带 toolSet（本步准入），工具声明也按它生成；提示段跟它取同一来源
	// 才不会出现「文字里有、模型调用不了」。旧宿主没有该字段，退回按 scope 查注册表。
	const sectionDisposer = ctx.systemPrompt.section({
		name: "tool:artkit",
		order: 2050,
		text: ({ scope, toolSet }) => {
			const admitted = typeof toolSet?.view === "function" ? toolSet.view(scope) : undefined;
			// 空 Map 只可能来自已释放或 scope 不匹配的工具集（上游此时返回空），
			// 不能据此把提示段清空；非空才视为本步的权威名单。
			const byToolSet = admitted instanceof Map && admitted.size > 0 ? admitted : undefined;
			const visible = Object.keys(TOOL_TIER).filter((n) =>
				byToolSet === undefined ? ctx.tools.get(n, scope) !== undefined : byToolSet.has(n)
			);
			if (visible.length === 0) return "";
			return `Art toolkit: ${visible.join(", ")}. ${SYSTEM_SECTION_TAIL}`;
		}
	});
	ctx.effect(() => sectionDisposer);

	/* ---------------------------- icon ---------------------------- */
	async function runIconFind(args) {
		const results = searchIcons(args.query, args.limit ?? config.findLimit);
		return { query: args.query, count: results.length, results };
	}
	async function runIconEmit(args, exec) {
		const out = emitIcon(args.name, args.target, {
			partner: args.partner,
							style: args.style,
							spring: args.spring,
							size: args.size,
							strokeWidth: args.strokeWidth,
							color: args.color,
							color2: args.color2,
							// 正交维度：覆盖 style 预设（传了就以参数为准）
							paint: args.paint,
							caps: args.caps,
							join: args.join,
							container: args.container,
							radius: args.radius,
							inset: args.inset,
							gradient: args.gradient,
							gradientAngle: args.gradientAngle,
							stops: args.stops,
							duoOpacity: args.duoOpacity,
							shadow: args.shadow,
							dash: args.dash,
							fillRule: args.fillRule,
							shapes: args.shapes,
							text: args.text,
							textSize: args.textSize,
							path: args.path
		});
		let writtenTo;
		if (args.outPath !== undefined && args.outPath.trim() !== "") {
			const target = await resolveArg(args.outPath, exec);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, out.code, "utf8");
			writtenTo = target;
		}
		// filename: dsh-plugin 的 icon.svg / raw 的建议文件名——不传 outPath 时模型靠它落盘。
		// 之前这里把 emit 内部的 filename 丢了，模型只能从 notes 文字里猜。
		return {
			target: out.target,
			// 总是回填「实际生效的样式」：solid/duotone/badge 可能会换用填充版字形，
			// 模型需要知道它拿到的到底是哪一种。
			...(out.style !== undefined ? { style: out.style } : {}),
			...(out.container !== undefined ? { container: out.container } : {}),
			icon: out.icon,
			code: out.code,
			...(out.filename !== null && out.filename !== undefined ? { filename: out.filename } : {}),
			...(writtenTo !== undefined ? { writtenTo } : {}),
			notes: out.notes
		};
	}
	ctx.tools.register(
		defineTool({
			name: "icon",
			// 版本号不进常驻描述（模型不需要知道 1.70.0）；图标总数保留，它能帮模型判断该搜还是该手写
			description: `Icon toolbox (${dbMeta.iconCount} lucide${dbMeta.packs.length > 0 ? ` + ${dbMeta.packs.map((p) => p.iconCount).join(" + ")} ${dbMeta.packs.map((p) => p.name).join("/")}` : ""}): zh/en search, or emit code.`,
			parameters: {
				action: { type: "string", enum: ["find", "emit"], description: "find | emit.", required: true },
				query: { type: "string", description: "zh/en keywords; aliases match." },
				limit: { type: "number", description: `find: max results (default ${config.findLimit}).` },
				name: { type: "string", description: "icon name; not needed when path/text given." },
				path: { type: "string", description: "draw your own: raw SVG path d= data (24 grid)." },
				text: { type: "string", description: "glyph text (1-4 chars); replaces the glyph." },
				textSize: { type: "number", description: "text size in 24-grid units." },
				target: { type: "string", enum: TARGETS, description: "output convention." },
				style: { type: "string", enum: STYLES, description: "preset start; params below override it." },
				paint: { type: "string", enum: ["stroke", "fill", "both"], description: "both = fill + stroke." },
				caps: { type: "string", enum: ["round", "butt", "square"], description: "join follows automatically." },
				join: { type: "string", enum: ["round", "miter", "bevel"], description: "default follows caps." },
				container: { type: "string", enum: ["none", "rounded", "circle", "squircle"], description: "chip behind glyph; none removes preset." },
				radius: { type: "number", description: "chip corner 0-12." },
				inset: { type: "number", description: "glyph padding 0-0.45." },
				gradient: { type: "string", enum: ["none", "linear", "radial"], description: "gradient type." },
				gradientAngle: { type: "number", description: "angle 0-360." },
				stops: { type: "array", items: { type: "string" }, description: "gradient stops: color or color@0-1; overrides color2." },
				duoOpacity: { type: "number", description: "base layer opacity 0-1." },
				shadow: { type: "string", description: "CSS box-shadow; comma = multi; inset ok." },
				dash: { type: "array", items: { type: "number" }, description: "stroke-dasharray, e.g. [4,2]." },
				fillRule: { type: "string", enum: ["nonzero", "evenodd"], description: "evenodd = multi-subpath holes (rings)." },
				shapes: {
					type: "array",
					description: "extra layers on top of the glyph.",
					items: {
						type: "object",
						additionalProperties: false,
						properties: {
							name: { type: "string", description: "icon name; or use path." },
							path: { type: "string", description: "raw SVG path d= data." },
							scale: { type: "number", description: "0.02-4." },
							dx: { type: "number", description: "offset x, grid units." },
							dy: { type: "number", description: "offset y (negative = up)." },
							rotate: { type: "number", description: "degrees about own center." },
							color: { type: "string", description: "own color." },
							stops: { type: "array", items: { type: "string" }, description: "own gradient: color or color@0-1." },
							gradient: { type: "string", enum: ["linear", "radial"], description: "own gradient type." },
							angle: { type: "number", description: "own gradient angle." },
							fillRule: { type: "string", enum: ["nonzero", "evenodd"], description: "own fill-rule." },
							weight: { type: "number", description: "own stroke width 0.1-12." },
							subtract: { type: "boolean", description: "true = punch a hole." }
						}
					}
				},
				partner: { type: "string", description: "echo partner icon." },
				spring: { type: "string", enum: SPRING_ENUM, description: "echo spring preset." },
				size: { type: "number", description: "24 svg / 16 whale." },
				strokeWidth: { type: "number", description: "weight 0-64." },
				color: { type: "string", description: "any color; both = fill color." },
				color2: { type: "string", description: "gradient end, or glyph color." },
				outPath: { type: "string", description: "also write the file here." }
			},
			output: {
				schema: { type: "object", additionalProperties: true },
				render: (args, value) =>
					args.action === "find"
						? [
								{
									type: "text",
									text:
										`icon library: ${value.results.length} match(es) for "${value.query}"` +
										(value.results.length === 0 ? " — try broader or split keywords." : "") +
										"\n" +
										value.results
														.map(
															(r) =>
																`- ${r.pack === "lucide" ? "" : `[${r.pack}] `}${r.name} (Pascal ${r.pascal}${r.aliases.length > 0 ? `; aliases: ${r.aliases.join(", ")}` : ""}) — ${r.shapes}` +
																(r.variants?.length > 0 ? ` · 可选 ${r.variants.join("/")} 版` : "")
															)
														
											.join("\n")
								}
							]
						: [
								{
									type: "text",
									text:
										`icon (emit) [${value.target}${value.style !== undefined ? `:${value.style}` : ""}] ${value.icon.name} (${value.icon.nodeCount} nodes)` +
										(value.writtenTo !== undefined
											? ` → written: ${value.writtenTo}`
											: value.filename !== undefined
												? ` — 建议文件名：${value.filename}`
												: "") +
										`\n\n${value.code}\n` +
										(value.notes.length > 0 ? `\n${value.notes.map((n) => `· ${n}`).join("\n")}` : "")
								}
							]
			},
			isConcurrencySafe: (args) => args?.action === "find",
			// 索图很快，但 emit 要读 JSON + 写文件；给个显式上限，别让宿主用默认值
			timeoutMs: 30000,
			async execute(args, exec) {
				if (args.action === "find") {
					if (typeof args.query !== "string" || args.query.trim() === "") throw new Error("action=find requires query");
					return runIconFind(args);
				}
				if (args.action === "emit") {
					// name 与 text 至少有一样：文字标不需要 name（文字会取代字形）
					const hasName = typeof args.name === "string" && args.name.trim() !== "";
					const hasText = typeof args.text === "string" && args.text.trim() !== "";
					const hasPath = typeof args.path === "string" && args.path.trim() !== "";
					if (!hasName && !hasText && !hasPath) throw new Error("action=emit requires name, text or path");
					if (typeof args.target !== "string") throw new Error("action=emit requires target");
					return runIconEmit(args, exec);
				}
				throw new Error(`unknown action: ${args.action}`);
			}
		})
	);

	/* ---------------------------- morph ---------------------------- */
	async function runMorphCheck(args, exec) {
		const given = [args.icons, args.file].filter((v) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0));
		if (given.length === 0) throw new Error("pass one of icons / file");
		if (given.length > 1) throw new Error("icons / file are mutually exclusive");
		let inputs = [];
		if (args.icons !== undefined) {
			if (args.icons.length === 0 || args.icons.length > 2) throw new Error("icons must contain 1–2 names");
			inputs = args.icons.map((n) => ({ kind: "name", value: n }));
		} else {
			const target = await resolveArg(args.file, exec);
			const { readFileSync, existsSync } = await import("node:fs");
			// 先探存在：裸 ENOENT 只给系统错误码，模型不知道是「路径错了」还是「相对目录没对」
			if (!existsSync(target)) throw new Error(`file not found: ${args.file}（解析为 ${target}；相对路径按会话目录解析）`);
			inputs = [{ kind: "file", value: readFileSync(target, "utf8"), source: args.file }];
		}
		const checked = inputs.map(({ kind, value, source }) => {
			const check = checkIcon(value, { nameLookup: kind === "name" });
			const fallbackName = source ?? (kind === "svg" ? "svg-input" : String(value ?? "input"));
			const item = {
				name: check.name ?? fallbackName,
				parsed: check.parsed,
				ok: check.ok,
				nodeCount: check.nodeCount,
				shapes: check.shapes,
				issues: check.issues,
				warnings: check.warnings
			};
			if (check.engine !== undefined) item.engine = check.engine;
			return item;
		});
		let pairNote;
		if (checked.length === 2) {
			pairNote = checked.every((c) => c.parsed)
				? "两个图标均可形变；节点数不同不影响（morphicons 弧长重采样自动对齐）"
				: "存在不可形变的图标，接线前先修复";
		}
		return { ok: checked.every((c) => c.parsed && c.ok), checked, ...(pairNote !== undefined ? { pairNote } : {}) };
	}
	async function runMorphPreview(args, exec) {
	// 相对 .svg 路径按会话目录解析（与 action=check 的 file 保持一致）
	const cwd = await sessionCwd(exec);
	const from = await resolveIconInput(args.from, { cwd });
	const to = await resolveIconInput(args.to, { cwd });
	const outPath = await resolveArg(args.outPath, exec);
	const result = await writePreview({ from, to, spring: args.spring, outPath, previewDir: config.previewDir, cwd: undefined, size: args.size });
	return { ...result, from: { name: from.name }, to: { name: to.name } };
	}
		if (shouldRegister(profile, "morph")) {
	ctx.tools.register(
			defineTool({
				name: "morph",
				description: "Icon morph: verify morphability (seven primitives, flat 24×24) or preview a two-state animation.",
				parameters: {
					action: { type: "string", enum: ["check", "preview"], description: "check | preview.", required: true },
					icons: { type: "array", items: { type: "string" }, description: "1–2 icon names." },
					file: { type: "string", description: ".svg path." },
					from: { type: "string", description: "start: name / .svg / markup." },
					to: { type: "string", description: "target: name / .svg / markup." },
					spring: { type: "string", enum: SPRING_ENUM, description: "preset, default snappy." },
					outPath: { type: "string", description: ".html path (default previewDir)." },
					size: { type: "number", description: "stage px 40–800, default 120." }
				},
				output: {
					schema: { type: "object", additionalProperties: true },
					render: (args, value) =>
						args.action === "check"
							? [
									{
										type: "text",
										text:
											`morph (check): ${value.ok ? "[OK] compatible" : "[FAIL] incompatible"}\n` +
											value.checked
												.map((c) => {
													const label = c.name ?? c.source ?? "icon";
													const state = c.parsed ? `${c.shapes ?? `${c.nodeCount} nodes`}` : "unparsed";
													const engine =
														c.engine === undefined
															? ""
															: c.engine.accepted
																? ` | engine ok${c.engine.regridded ? "（viewBox 已自动 re-grid）" : ""}`
																													: ` | engine fail ${c.engine.reason ?? "rejected"}`;
													const issues = [...(c.issues ?? []), ...(c.warnings ?? [])].map((s) => ` — ${s}`).join("");
													return `- ${label}: ${state}${engine}${issues}`;
												})
												.join("\n") +
											(value.pairNote !== undefined ? `\n${value.pairNote}` : "")
									}
								]
							: [
									{
										type: "text",
										text:
											`morph (preview): ${value.from.name} ⇄ ${value.to.name} (spring ${value.spring}) → ${value.path} (${Math.round(value.sizeBytes / 1024)} KB)\n` +
											`自包含离线页：浏览器打开即用（按钮=弹簧动画，拖动条=受控形变）。把路径发给用户即可。`
									}
								]
				},
				timeoutMs: 60000,
				isConcurrencySafe: (args) => args?.action === "check",
				async execute(args, exec) {
					if (args.action === "check") return runMorphCheck(args, exec);
					if (args.action === "preview") {
						if (typeof args.from !== "string" || typeof args.to !== "string") throw new Error("action=preview requires from and to");
						return runMorphPreview(args, exec);
					}
					throw new Error(`unknown action: ${args.action}`);
				}
			})
		);
	}

	/* --------------------------- taste_check -------------------------- */
	// taste（AI 味体检）与 audit（图标规范巡检）合并：两者都是「扫源码判质量」，
	// 只是判据不同（审美诊断 vs 项目契约）。合并后少一个常驻工具定义。
		if (shouldRegister(profile, "taste_check")) {
	ctx.tools.register(
			defineTool({
				name: "taste_check",
				description:
					"AI-look lint for source, a PNG, or a dir of shots. taste = score 0-100 (lower better) + fixes; audit = icon rules (emoji, MorphIcon, ICONS).",
				parameters: {
					action: { type: "string", enum: ["taste", "audit"], description: "taste | audit.", required: true },
					root: { type: "string", description: "Code file, dir, or .png image; abs or session-relative.", required: true },
					profile: { type: "string", enum: ["balanced", "strict", "structure"], description: "taste: strictness preset." },
					allow: { type: "array", items: { type: "string" }, description: "deliberately used rule ids." },
					ignore: { type: "array", items: { type: "string" }, description: "rule ids to skip entirely." },
					preset: { type: "string", enum: ["echo", "colibri", "universal", "auto"], description: "audit rule preset." }
				},
				output: {
					schema: { type: "object", additionalProperties: true },
							render: (args, value) => {
								// 一批截图：单张图的问题是「像不像 AI」，一批图的问题是「哪张没跟上、
								// 是不是同一套视觉」——后者只能靠对比回答，也是审查类会话的真实形态。
								if (value.kind === "images") {
									const c = value.consistency;
									const outlierBits = value.outliers.map((o) => `${o.name} ${o.score}/100（${o.delta > 0 ? "+" : ""}${o.delta}${o.top !== undefined && o.top !== "none" ? ` · ${o.top}` : ""}）`);
									return [
										{
											type: "text",
											text:
												`taste_check [taste:images] ${value.count} 张 — 均分 ${value.avg}/100${value.min.score === value.max.score ? `（每张都 ${value.min.score}）` : `（最好 ${value.min.name} ${value.min.score} · 最差 ${value.max.name} ${value.max.score}）`}` +
												(value.truncated === true ? `（共 ${value.total} 张，只算了前 ${value.count}）` : "") +
												`\n  跨图一致性：背景 ${c.backgrounds.map((b) => `${b.color}×${b.count}`).join(" / ")} · 列栅格 ${c.columns.map((x) => `${x.cols}列×${x.count}`).join(" / ")} · 同源 ${c.sameOriginPct}%` +
												(outlierBits.length === 0 ? "\n  离群：无（分数都在均分 ±15 内）" : `\n  离群：${outlierBits.join(" · ")}`) +
												`\n  → ${c.sameOriginPct >= 80 ? "这批视觉是同一套，按离群图逐个看即可" : "同源度偏低：先统一背景/列栅格，再谈单页细节；局部截图（弹窗/面板）与整页截图混在一批里也会拉低它"}` +
												`\n  边界：${value.scopeNote}` +
												(value.unreadable === undefined
													? ""
													: `\n  跳过 ${value.unreadable.length} 张读不了的图：${value.unreadable.slice(0, 3).map((u) => `${u.name}（${u.reason}）`).join(" · ")}`)
										}
									];
								}
								if (args.action === "audit") {
							return [
								{
									type: "text",
									text:
										`taste_check [audit:${value.preset}] ${value.root}: ${value.filesScanned} file(s) — ${value.counts.error ?? 0} error / ${value.counts.warn ?? 0} warn / ${value.counts.info ?? 0} info` +
										(value.emojiTotal !== undefined ? `（共 ${value.emojiTotal} 个 emoji）` : "") +
										(value.truncated ? " (truncated)" : "") +
										"\n" +
										(value.findings.length === 0
											? "no findings"
											: value.findings.map((f) => `- [${f.severity}] ${f.rule} ${f.file}:${f.line} ${f.message}`).join("\n"))
								}
							];
						}
						const fixLines = value.actions.map((a) => `- [${a.score}] ${a.label} (${a.scope}) — ${a.note}\n    → ${a.fix}`).join("\n");
						const spotLines = value.findings
							.slice(0, 8)
							.map((f) => `    ${f.file}:${f.line} ${f.evidence}`)
							.join("\n");
						const advisoryLines = value.advisories.map((a) => `- ${a.label} — ${a.note}\n    → ${a.fix}`).join("\n");
						const verdict =
							value.actions.length === 0
								? "quality floor met" +
									(value.grade === "clean" && value.score > 0
										? " — clean range: stop optimizing here. Further score chasing pushes designs toward sameness."
										: "")
								: fixLines + (value.coOccurrence?.text ? `\n  ↳ ${value.coOccurrence.text}` : "");
						return [
							{
								type: "text",
								text:
									(value.kind === "image"
										? `taste_check [taste:image] ${value.score}/100 (${value.grade}) — ${value.image.file} ${value.image.width}×${value.image.height}\n`
										: `taste_check [taste] ${value.score}/100 (${value.grade}, profile=${value.profile}) — ${value.filesScanned} file(s), ${value.findingsTotal} finding(s)${value.findingsTruncated ? " (truncated)" : ""}\n`) +
									verdict +
									(spotLines === "" ? "" : `\n  hotspots:\n${spotLines}`) +
									(advisoryLines === "" ? "" : `\n  style advisories (not scored — your call):\n${advisoryLines}`) +
									(value.exempted.length === 0 ? "" : `\n  exempted by declaration: ${value.exempted.join(", ")}`) +
									(value.scopeNote === undefined ? "" : `\n  scope: ${value.scopeNote}`) +
									(Array.isArray(value.blindSpots) && value.blindSpots.length > 0
										? `\n  blind spots（要查这些请给源码）: ${value.blindSpots.join(" / ")}`
										: "")
							}
						];
					}
				},
				isConcurrencySafe: () => true,
				timeoutMs: 120000,
				async execute(args, exec) {
					const target = await resolveArg(args.root, exec);
					if (args.action === "audit") {
						return audit(target, args.preset ?? "auto", { maxFiles: config.maxAuditFiles, maxFindings: config.maxFindings });
					}
					if (args.action === "taste") {
						return taste(target, { ignore: args.ignore, allow: args.allow, profile: args.profile });
					}
					throw new Error(`unknown action: ${args.action}`);
				}
			})
		);
	}

	/* -------------------------- layout_check ------------------------ */
	// 排版体检三条路径：ui（HTML/CSS 字体系统）/ svg（成品 SVG 的真实文字几何）/
	// image（渲染后 PNG 的构图几何）。共享 0–100 分与统一报告结构（lib/layouts/common.js）。
	const LAYOUT_ACTIONS = ["ui", "svg", "image"];
	async function runLayoutCheck(args, exec) {
		const { existsSync, readFileSync } = await import("node:fs");
		if (args.action === "ui") {
			if (typeof args.root !== "string" || args.root.trim() === "") throw new Error("action=ui 需要 root（HTML/CSS 文件或目录）");
			const target = await resolveArg(args.root, exec);
			if (!existsSync(target)) throw new Error(`path not found: ${target}`);
			const report = await auditSource(target);
			if (args.render !== true) return report;
			// render=true：静态解析算不准的（rgba / CSS 变量 / 渐变底）改用**真实渲染像素**量。
			// 找不到 HTML 入口就如实说做不到，不假装算过。
			const entry = (() => {
				if (statSync(target).isFile()) return target.endsWith(".html") ? target : null;
				const names = readdirSync(target).filter((f) => f.endsWith(".html"));
				if (names.includes("index.html")) return join(target, "index.html");
				return names.length > 0 ? join(target, names[0]) : null;
			})();
			if (entry === null) {
				report.metrics.renderedContrast = { rendered: false, reason: "没有找到 .html 入口（render 只对 HTML 页面有效）" };
				return report;
			}
			const scratch = mkdtempSync(join(tmpdir(), "dsh-contrast-"));
			try {
				const measured = measureRenderedContrast({ htmlPath: entry, outDir: scratch, width: args.width, height: args.height, browserPath: config?.browserPath });
				report.metrics.renderedContrast = measured.rendered ? { rendered: true, samples: measured.samples, bands: measured.bands, worst: measured.worst === null ? null : Math.round(measured.worst.ratio * 100) / 100 } : { rendered: false, reason: measured.reason };
				if (measured.rendered && measured.worst !== null) {
					// 逐种文字配色报：同一种字在不同位置背景不同（渐变），要给出最差那处
					const failing = measured.pairs.filter((p) => p.ratio < 4.5);
					for (const pair of failing) {
						const hard = pair.ratio < 3;
						report.findings.push({
							severity: hard ? "error" : "warn",
							rule: "contrast-effective",
							where: `render:${pair.x},${pair.y}`,
							message:
								`实际渲染对比度不足：${pair.ratio}:1（<4.5 WCAG AA）—— 文字 ${pair.fg} 压在真实背景 ${pair.bg} 上` +
								`（${pair.pixels}px 墨迹）。渐变/半透明/图片底都算在内，静态解析算不出这一项`,
							fix: "提高前景与背景的亮度差：加深文字色、给文字下方垫一层实色、或收窄背景渐变跨度——WCAG AA 要求正文 ≥4.5:1、大字号 ≥3:1"
						});
						report.counts[hard ? "error" : "warn"] += 1;
					}
				}
				return report;
			} finally {
				rmSync(scratch, { recursive: true, force: true });
			}
		}
		const input = typeof args.input === "string" ? args.input.trim() : "";
		if (input === "") throw new Error(`action=${args.action} 需要 input（SVG 标记 / .svg 路径 / .png 路径）`);
		if (args.action === "svg") {
			// 内联标记没有目录，读不到 .design-intent.json；文件模式从它所在目录读。
			if (input.includes("<")) return auditSvg(input, { name: "inline-svg" });
			const file = await resolveArg(input, exec);
			if (!existsSync(file)) throw new Error(`SVG 文件读不到：${input}（解析为 ${file}；相对路径按会话目录）`);
			return auditSvg(readFileSync(file, "utf8"), { name: basename(file), intentDir: dirname(file) });
		}
		// image：PNG / JPEG / WebP（SVG 先用 design_render action=render 渲染）
		const file = await resolveArg(input, exec);
		if (!existsSync(file)) throw new Error(`图片文件读不到：${input}（解析为 ${file}；相对路径按会话目录）`);
		// 目录 = 一批截图：逐图体检 + 跨图几何一致性（哪张构图离群、是否同一套栅格）。
		// 审查一轮界面从来不是一张图；单图只能给分数，量不出「第 7 张和第 2 张不一样」。
		if (statSync(file).isDirectory()) {
			const listing = await imagesInDir(file);
			if (listing === null) throw new Error(`目录里没有 PNG/JPEG/WebP：${file}`);
			const entries = [];
			const unreadable = [];
			for (const one of listing.images) {
				// 单张坏图不拖垮整批：记下来点名，其余照常体检。
				try {
					const audit = auditImage(await readAsPng(one), { name: basename(one) });
					entries.push({
						name: basename(one),
						score: audit.score,
						grade: audit.grade,
						size: `${audit.metrics.canvas[0]}×${audit.metrics.canvas[1]}`,
						background: audit.metrics.background,
						cols: audit.metrics.segments.cols,
						margins: audit.metrics.marginsPct,
						// 这张图最严重的一条规则：离群图要能指到具体毛病，而不是只说「它离群」
						top: audit.findings.find((f) => f.severity === "error")?.rule ?? audit.findings[0]?.rule ?? "none"
					});
				} catch (error) {
					unreadable.push({ name: basename(one), reason: error instanceof Error ? error.message : String(error) });
				}
			}
			if (entries.length === 0) {
				throw new Error(`目录里的图都读不出来：${file}（${unreadable[0]?.reason ?? "未知原因"}）`);
			}
			return {
				mode: "image-batch",
				target: basename(file),
				...batchSummary(entries, { truncated: listing.truncated, total: listing.total }),
				...(unreadable.length === 0 ? {} : { unreadable })
			};
		}
		if (/\.(?:jpe?g|webp|png)$/i.test(file) === false) {
			throw new Error("action=image 支持 PNG/JPEG/WebP：SVG 先用 design_render action=render 渲染成 PNG，再体检");
		}
		// JPEG/WebP 先转成同尺寸 PNG（与 taste_check 共用 readAsPng，避免两边行为分叉）
		return auditImage(await readAsPng(file), { name: basename(file) });
	}
		if (shouldRegister(profile, "layout_check")) {
	ctx.tools.register(
			defineTool({
				name: "layout_check",
					description:
						"Layout/typography audit 0-100 (lower better). ui = HTML/CSS type system; svg = text geometry; image = screenshot geometry.",
				parameters: {
					action: { type: "string", enum: LAYOUT_ACTIONS, description: "ui | svg | image.", required: true },
					root: { type: "string", description: "ui: file or directory." },
				render: { type: "boolean", description: "ui: also measure real rendered text contrast." },
				width: { type: "number", description: "render: viewport width px." },
				height: { type: "number", description: "render: viewport height px." },
					input: { type: "string", description: "svg/image: path, dir (batch), or markup." }
				},
				output: {
					schema: {
						type: "object",
						additionalProperties: true,
						properties: {
							mode: { type: "string" },
							target: { type: "string" },
							score: { type: "number" },
							grade: { type: "string" },
							counts: { type: "object", additionalProperties: true },
							metrics: { type: "object", additionalProperties: true },
							findings: { type: "array", items: { type: "object", additionalProperties: true } }
						}
					},
						render: (_args, value) => {
						// 批量：先给「这批图整体怎么样」，再给「哪张不一样」。
						// 单图报告里最费劲的判断（这条算不算问题）在批量里变成机械对比，
						// 所以这里只交事实：分数分布、跨图差异、离群名单。
						if (value.mode === "image-batch") {
							const c = value.consistency;
							const driftBits = c.drift
								.slice(0, 6)
								.map((d) => `${d.name}${d.background !== undefined ? ` 背景 ${d.background}` : ""}${d.cols !== undefined ? ` 列 ${d.cols}` : ""}`);
							const outlierBits = value.outliers.map((o) => `${o.name} ${o.score}/100（${o.delta > 0 ? "+" : ""}${o.delta} vs 均分${o.top !== undefined && o.top !== "none" ? ` · ${o.top}` : ""}）`);
							return [
								{
									type: "text",
									text:
										`layout_check [image] ${value.count} 张 — 均分 ${value.avg}/100${value.min.score === value.max.score ? `（每张都 ${value.min.score}）` : `（最低 ${value.min.name} ${value.min.score} · 最高 ${value.max.name} ${value.max.score}）`}` +
										(value.truncated === true ? `（共 ${value.total} 张，只算了前 ${value.count}）` : "") +
										`\n  跨图一致性：背景 ${c.backgrounds.map((b) => `${b.color}×${b.count}`).join(" / ")} · 列栅格 ${c.columns.map((x) => `${x.cols}列×${x.count}`).join(" / ")} · 同源 ${c.sameOriginPct}%` +
										(c.sizes.length > 1 ? ` · 尺寸 ${c.sizes.length} 档（视口/局部截图天然不同，仅参考）` : "") +
										(driftBits.length === 0 ? "" : `\n  不一致：${driftBits.join(" · ")}`) +
										(outlierBits.length === 0 ? "\n  离群：无（分数都在均分 ±15 内）" : `\n  离群：${outlierBits.join(" · ")}`) +
										(value.unreadable === undefined
											? ""
											: `\n  跳过 ${value.unreadable.length} 张读不了的图：${value.unreadable.slice(0, 3).map((u) => `${u.name}（${u.reason}）`).join(" · ")}`) +
										"\n  → 先看离群图与「不一致」那几张：是这一页没跟上，还是本来就该不同；要逐图细节就把 input 指到单张图"
								}
							];
						}
						// metrics 里既有数字/数组也有对象（marginsPct/contentBox）：对象必须显式序列化，
						// 否则模板字符串会把它们变成 "[object Object]"（输出无损断言会直接挂）。
						const formatMetric = (v) =>
							Array.isArray(v) ? v.join("/") : v !== null && typeof v === "object" ? JSON.stringify(v) : String(v);
						const metricBits = Object.entries(value.metrics ?? {})
							.slice(0, 8)
							.map(([k, v]) => `${k}=${formatMetric(v)}`)
							.join(" · ");
						const items = value.findings
							.slice(0, 10)
							.map((f) => {
								// 每条都给「改完能到几分」：实测模型会连跑 4 次体检却不动手，
								// 因为它无法判断哪条值得改、改完有什么变化。权重是确定量，直接算给它。
								const weight = WEIGHTS[f.severity] ?? 2;
								const after = Math.max(0, value.score - weight);
								const head = `- [${f.severity}] ${f.rule}${f.where !== undefined ? ` @${f.where}` : ""} ${f.message}\n    → ${f.fix}（修完这条 ${value.score}→${after}）`;
								// 有可执行模板时把代码块打出来：粘贴即可，不必再从建议里推断 token。
								if (f.patch === undefined || f.patch === null) return head;
								const css = String(f.patch.css)
									.split("\n")
									.map((line) => `      ${line}`)
									.join("\n");
								return `${head}\n    修复模板（可直接粘贴）：\n\`\`\`css\n${css}\n    \`\`\`\n    套用：${f.patch.apply}`;
							})
							.join("\n");
						// 版式剖面单独成段：它排在 metrics 的第 12 项，会被上面的 slice(0,8) 截掉，
						// 而且整块 JSON.stringify 出来没法读。这是参照改造时最先要看的东西。
						const profileText = (() => {
							const p = value.metrics?.profile;
							if (p === undefined || p === null) return "";
							const bits = [];
							if (Array.isArray(p.palette) && p.palette.length > 0) {
								bits.push(`主色 ${p.palette.slice(0, 4).map((c) => `${c.hex} ${c.share}%`).join(" ")}`);
							}
							// 单一列带覆盖整图 = 检测失败（常见的成因：渐变背景），当噪音吞掉。
							// 此时卡片那行才是有效信号，两个字段互为替代。
							const cols = Array.isArray(p.columns) ? p.columns : [];
							const colsUseful = !(cols.length === 1 && cols[0].left <= 2 && cols[0].width >= value.metrics?.canvas?.[0] * 0.9);
							if (Array.isArray(p.vEdges) && p.vEdges.length > 0) {
								// 垂直分界线比色带可靠：办公/客户端界面几乎全白，色带分不开栏位，
								// 但栏位之间一定有贯穿全高的分界线。
								bits.push(`栏位分界 x=${p.vEdges.slice(0, 10).join("/")}`);
							}
							if (cols.length > 0 && colsUseful) {
								bits.push(`列带 ${cols.map((c) => `${c.left}~${c.right}`).join(" | ")}`);
							}
							const g = p.cardGrid;
							if (g !== undefined && g !== null && g.count > 0) {
								bits.push(
									`卡片 ${g.count} 张` +
										(g.colStarts.length > 0 ? `（列起点 ${g.colStarts.slice(0, 8).join("/")}` : "（") +
										(g.colGap !== null ? `，列间 ${g.colGap}px` : "") +
										(g.rowGap !== null ? `，行间 ${g.rowGap}px` : "") +
										"）"
								);
							}
							if (p.list !== null && p.list !== undefined) {
								bits.push(`行距 ${p.list.pitch}px（${p.list.count} 行，一致 ${p.list.uniformPct}%${p.list.outlierCount > 0 ? `，${p.list.outlierCount} 行异常` : ""}）`);
							} else if (p.rowPitch !== null && p.rowPitch !== undefined) {
								bits.push(`行节奏 ${p.rowPitch}px`);
							}
							return bits.length === 0 ? "" : `\n  版式剖面：${bits.join(" · ")}`;
						})();
						return [
							{
								type: "text",
								text:
									`layout_check [${value.mode}] ${value.target}: ${value.score}/100 (${value.grade}) — ${value.findings.length} finding(s) (${value.counts.error} error / ${value.counts.warn} warn / ${value.counts.info} info)\n` +
									(metricBits === "" ? "" : `  ${metricBits}\n`) +
									profileText +
									(profileText === "" ? "" : "\n") +
									(items === "" ? "✅ no layout issues" : items) +
									(value.findings.length > 10 ? `\n…还有 ${value.findings.length - 10} 条（只显示前 10）` : "")
							}
						];
					}
				},
				isConcurrencySafe: () => true,
				timeoutMs: 120000,
				async execute(args, exec) {
					return runLayoutCheck(args, exec);
				}
			})
		);
	}

	/* -------------------------- design_style ------------------------ */
		if (shouldRegister(profile, "design_style")) {
	ctx.tools.register(
			defineTool({
				name: "design_style",
				description: "Style tokens (skin) + skeleton recipe + ban list (8×6); format=motion gives interaction primitives.",
				parameters: {
					skin: { type: "string", enum: SKINS.map((s) => s.id), description: "visual language (base).", required: true },
					// 说明保持短：完整键表在 README，用错 key 时抛错也会列全（自文档化），
					// 不必把 20 个键名塞进每请求常驻的 schema 里。
					tokens: { type: "string", description: "k=v;k=v: fill/radius/border/shadow/font + mech(pattern/clip/dur/press…)" },
					skeleton: { type: "string", enum: SKELETONS.map((s) => s.id), description: "info structure; mixes with any skin." },
					format: { type: "string", enum: ["css", "json", "tailwind", "motion"], description: "default css; motion = 交互原语层" }
				},
				output: {
					schema: {
						type: "object",
						additionalProperties: true,
						properties: {
							skin: { type: "string" },
							skeleton: { type: "string" },
							label: { type: "string" },
							useWhen: { type: "string" },
							tone: { type: "string" },
							density: { type: "string" },
							code: { type: "string" },
							steps: { type: "array", items: { type: "string" } },
							bans: { type: "array", items: { type: "object", additionalProperties: true } },
							exempt: { type: "array", items: { type: "string" } }
						}
					},
					render: (_args, value) => {
						const groups = { quality: [], style: [], content: [] };
						for (const ban of value.bans) groups[ban.scope]?.push(ban.text);
						const banLines =
							`quality floor（不可协商）:\n${groups.quality.map((t) => `- ${t}`).join("\n")}\n\n` +
							`style advice（可声明豁免）:\n${groups.style.map((t) => `- ${t}`).join("\n")}\n\n` +
							`content:\n${groups.content.map((t) => `- ${t}`).join("\n")}`;
						return [
							{
								type: "text",
								text:
									`design_style [${value.skin} × ${value.skeleton}] ${value.label} (${value.density}) — ${value.tone}\n` +
									`适用：${value.useWhen}\n\n${value.code}\n\n` +
									`结构配方：\n${value.steps.map((line, i) => `${i + 1}. ${line}`).join("\n")}\n\n` +
									banLines +
									(value.exempt.length === 0 ? "" : `\n\n本皮肤有意偏离：${value.exempt.join(", ")}——写进 .design-intent.json 的 allow 即可不被计分`)
							}
						];
					}
				},
				isConcurrencySafe: () => true,
				timeoutMs: 30000,
				async execute(args) {
					return renderStyle({ skin: args.skin, skeleton: args.skeleton, format: args.format ?? "css", tokens: args.tokens });
				}
			})
		);
	}

	/* ------------------------- design_render ------------------------ */
	ctx.tools.register(
		defineTool({
			name: "design_render",
			description:
				"Render SVG (offline resvg), HTML→PNG (needs Edge/Chrome), layer composite, asset library.",
			parameters: {
				action: { type: "string", enum: ["render", "composite", "asset", "html", "diff"], description: "render | composite | asset | html | diff.", required: true },
				base: { type: "string", description: "diff: reference image or dir." },
				compare: { type: "string", description: "diff: image or dir to compare." },
				slices: { type: "number", description: "diff: column slices for region report (default 4)." },
				align: { type: "boolean", description: "diff: also search best dx/dy shift (ghosting)." },
				html: { type: "string", description: "h: HTML path or inline markup." },
				height: { type: "number", description: "h: viewport height px (default 800)." },
				fullPage: { type: "boolean", description: "h: capture full page height." },
				pageScale: { type: "number", description: "h: device pixel ratio 0.5-4." },
				svg: { type: "string", description: "r: SVG path or markup." },
				png: { type: "string", description: "r: output .png path." },
				width: { type: "number", description: "r: output width px." },
				under: { type: "string", description: "c: base png/svg, or #color (needs canvas)." },
				over: { type: "string", description: "c: overlay png/svg." },
				out: { type: "string", description: "c: output .png path." },
				anchor: { type: "string", enum: ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"], description: "c: layer position, default center." },
				fit: { type: "string", enum: ["contain", "cover", "fill", "none"], description: "c: layer scaling, default contain." },
				padding: { type: "number", description: "c: inset all edges px." },
				rotate: { type: "number", description: "c: rotate about center deg." },
				blend: { type: "string", enum: ["normal", "multiply", "screen", "overlay", "darken", "lighten", "difference"], description: "c: mix-blend-mode." },
				bg: { type: "string", description: "c: flat color behind layer." },
				shadow: { type: "string", description: "c: CSS box-shadow for layer." },
				canvas: { type: "array", items: { type: "number" }, description: "c: [w,h]; needed when under is #color." },
				opacity: { type: "number", description: "c: layer opacity 0-1." },
				scale: { type: "number", description: "c: multiplier 0.05-8." },
				sizes: { type: "array", items: { type: "number" }, description: "r/c: also write these widths." },
				ico: { type: "boolean", description: "r/c: also write .ico (6 frames)." },
				mode: { type: "string", enum: ["find", "inline", "save"], description: "a: find | inline | save." },
				keyword: { type: "string", description: "a: keyword." },
				rel: { type: "string", description: "a: library-relative path." },
				color: { type: "string", description: "a: recolor, e.g. #FF6B35." },
				saveTo: { type: "string", description: "a: save output path." },
				limit: { type: "number", description: "a: max results." }
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: true,
					properties: {
						action: { type: "string" },
						path: { type: "string" },
						width: { type: "number" },
						height: { type: "number" },
						bytes: { type: "number" },
						mode: { type: "string" },
						total: { type: "number" },
						items: { type: "array", items: { type: "object", additionalProperties: true } },
						rel: { type: "string" },
						viewBox: { type: "string" },
						inner: { type: "string" }
					}
				},
					render: (_args, value) => {
					if (value.action === "diff-batch") {
						const ok = value.pairs.filter((p) => p.error === undefined);
						const failed = value.pairs.filter((p) => p.error !== undefined);
						const sorted = [...ok].sort((a, b) => b.meanDelta - a.meanDelta);
						const avg = Math.round((ok.reduce((s, p) => s + p.meanDelta, 0) / Math.max(1, ok.length)) * 10) / 10;
						const rows = sorted
							.slice(0, 12)
							.map((p) => `  ${p.name} 均差 ${p.meanDelta}（${p.meanPct}%）· 最大 ${p.maxDelta} · 变化区 ${p.changedPct}%`);
						return [
							{
								type: "text",
								text:
									`diff: ${value.count} 对（按文件名配对）· 平均均差 ${avg}/255` +
									(sorted.length === 0 ? "" : ` · 变化最大 ${sorted[0].name} ${sorted[0].meanDelta}`) +
									(rows.length === 0 ? "" : `\n${rows.join("\n")}`) +
									(failed.length === 0
										? ""
										: `\n  比不了（尺寸不同等）：${failed
												.slice(0, 3)
												.map((p) => `${p.name}（${p.error.split("\n")[0]}）`)
												.join(" · ")}`) +
									(value.total > value.count ? `\n  （共 ${value.total} 对，只比了前 ${value.count}）` : "") +
									"\n  → 差异大的几张是这一轮真改到的页；差异为 0 的页说明没被改动影响（或没截到），别当成「改好了」"
							}
						];
					}
					if (value.action === "diff") {
						const worst = [...value.regions].sort((a, b) => b.meanDelta - a.meanDelta).slice(0, 3);
						return [
							{
								type: "text",
								text:
									`diff: 均差 ${value.meanDelta}/255（${value.meanPct}%）· 最大 ${value.maxDelta} · 变化区 ${value.changedPct}%\n` +
									`分区（${value.cols}×${value.rows}）均差：` +
									value.regions.map((r) => `${r.col + 1},${r.row + 1}=${r.meanDelta}`).join(" ") +
									`\n最差三区：` +
									worst.map((r) => `第${r.col + 1}列${r.row + 1}行=${r.meanDelta}`).join(" · ") +
									(value.align === undefined
										? ""
										: `\n偏移搜索：最佳平移 dx=${value.align.bestDx} dy=${value.align.bestDy}px → 均差 ${value.align.deltaAtZero} → ${value.align.deltaAtBest}` +
											`（改善 ${value.align.gainPct}%）` +
											(value.align.gainPct > 15 ? "——重影主因是整体错位，先对齐起始位置再改细节" : "——错位不是主因，差异来自结构/内容")) +
									(value.heatmap === undefined ? "" : `\n热力图：${value.heatmap}`)
							}
						];
					}
					if (value.action === "html") {
						const kb = Math.round(value.bytes / 1024);
						return [
							{
								type: "text",
								text:
									`html: ${value.path} (${value.width}×${value.height}` +
									(value.fullPage === true ? "，整页" : "") +
									`, ${kb} KB, ${value.scale}× 像素比) — 浏览器引擎渲染：${value.browser}`
							}
						];
					}
					if (value.action === "render" || value.action === "composite") {
						const kb = Math.round(value.bytes / 1024);
						const extras =
							(value.variants !== undefined ? ` · +${value.variants.length} 个尺寸：${value.variants.map((v) => v.width).join("/")}` : "") +
							(value.ico !== undefined ? " · +.ico" : "");
						return [
							{
								type: "text",
								text:
									`${value.action}: ${value.path} (${value.width}×${value.height}, ${kb} KB)` +
									(value.action === "composite" ? "" : " — 透明底 RGBA 已保留") +
									extras
							}
						];
					}
					if (value.mode === "find") {
						return [
							{
								type: "text",
								text:
									`asset: ${value.total} match(es) for "${value.keyword}"\n` +
									(value.items.length === 0
										? "（换更宽的关键词，或用 asset 分类词：品牌图标 / 图标 / 插画 / 角色部件 / 图案 / 贴纸 / 纹理）"
										: value.items.map((i) => `- ${i.file}  [${i.category}] ${i.name} — ${i.license}`).join("\n"))
							}
						];
					}
					if (value.mode === "inline") {
						return [
							{
								type: "text",
								text:
									`asset inline: ${value.rel}${value.name !== undefined ? ` (${value.name})` : ""} viewBox=${value.viewBox}` +
									(value.truncated ? " (truncated)" : "") +
									`\n\n${value.inner}` +
									(value.note !== undefined ? `\n\n· ${value.note}` : "")
							}
						];
					}
					return [{ type: "text", text: `asset saved: ${value.path} (${Math.round(value.bytes / 1024)} KB)${value.color !== null ? ` · 改色 ${value.color}` : ""}` }];
				}
			},
			isConcurrencySafe: () => true,
			timeoutMs: 120000,
			async execute(args, exec) {
				if (args.action === "render") {
					const svg = await resolveArg(args.svg, exec);
					const png = await resolveArg(args.png, exec);
					const out = await renderSvg({ svg, png, width: args.width, sizes: args.sizes, ico: args.ico });
					return { action: "render", ...out };
				}
				if (args.action === "diff") {
					const baseArg = await resolveArg(args.base, exec);
					const compareArg = await resolveArg(args.compare, exec);
					// 目录 = 一批前后对比：按同名文件配对（before/home.png ↔ after/home.png）。
					// 真实工作流就是「改前拍一组、改后拍一组」；逐对手跑会逼模型自己先写配对脚本。
					const isDirPath = (p) => existsSync(p) && statSync(p).isDirectory();
					if (isDirPath(baseArg) && isDirPath(compareArg)) {
						const namesOf = (dir) => readdirSync(dir).filter((f) => /\.(?:png|jpe?g|webp)$/i.test(f)).sort();
						const other = new Set(namesOf(compareArg));
						const shared = namesOf(baseArg).filter((f) => other.has(f));
						if (shared.length === 0) {
							throw new Error(`两侧目录没有同名图片：${baseArg} ↔ ${compareArg}（按文件名配对，如 before/home.png 对 after/home.png）`);
						}
						const pairs = [];
						for (const one of shared.slice(0, 24)) {
							// 尺寸不同（改版前后视口变了）不该中断整批：这一对单独报原因，其余照比。
							try {
								const r = await imageDiff({ base: join(baseArg, one), compare: join(compareArg, one), cols: args.slices, rows: args.rows, align: args.align });
								pairs.push({ name: one, meanDelta: r.meanDelta, meanPct: r.meanPct, maxDelta: r.maxDelta, changedPct: r.changedPct });
							} catch (error) {
								pairs.push({ name: one, error: error instanceof Error ? error.message : String(error) });
							}
						}
						return { action: "diff-batch", count: pairs.length, total: shared.length, pairs };
					}
					// 两张图差异：视觉改动完到底好了没有，靠眼睛只能判断“像不像”，
					// 回答不了“这一轮是提升还是回退”。给一个能横比多轮的数字。
					return {
						action: "diff",
						...(await imageDiff({
							base: baseArg,
							compare: compareArg,
							out: await resolveArg(args.out, exec),
							cols: args.slices,
							rows: args.rows,
							align: args.align
						}))
					};
				}
				if (args.action === "html") {
					// HTML → PNG：需要本机 Chromium 系浏览器。为什么不能自己做：
					// 自写布局引擎去“验证”用户界面的布局，等于用可能错的尺子量东西；
					// 真实浏览器引擎才是可信参照。探测不到时明确报错，不静默假渲染。
					const htmlArg = await resolveArg(args.html, exec);
					const pageOut = await resolveArg(args.out ?? args.png, exec);
					const page = renderHtml({
						html: htmlArg,
						out: pageOut,
						width: args.width,
						height: args.height,
						scale: args.pageScale,
						fullPage: args.fullPage,
						browserPath: config?.browserPath
					});
					return { action: "html", ...page };
				}
				if (args.action === "composite") {
					// under 可能是纯色（不带路径分隔与扩展名）——纯色不 resolveArg，否则会被拼成路径
					const underRaw = typeof args.under === "string" ? args.under.trim() : args.under;
					const underIsColor = typeof underRaw === "string" && /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|[a-z]+$)/i.test(underRaw);
					const out = await composite({
						under: underIsColor ? underRaw : await resolveArg(args.under, exec),
						over: await resolveArg(args.over, exec),
						out: await resolveArg(args.out, exec),
						anchor: args.anchor,
						fit: args.fit,
						padding: args.padding,
						rotate: args.rotate,
						blend: args.blend,
						bg: args.bg,
						shadow: args.shadow,
						canvas: args.canvas,
						opacity: args.opacity,
						scale: args.scale,
						sizes: args.sizes,
						ico: args.ico
					});
					return { action: "composite", ...out };
				}
				if (args.action === "asset") {
					const mode = args.mode ?? "find";
					const result = await asset({
						mode,
						keyword: args.keyword,
						rel: args.rel,
						color: args.color,
						saveTo: await resolveArg(args.saveTo, exec),
						limit: args.limit ?? config.findLimit
					});
					const size = mode === "save" ? sizeOf(result.path) : null;
					return { action: "asset", ...result, ...(size !== null ? { width: size.width, height: size.height } : {}) };
				}
				throw new Error(`unknown action: ${args.action}`);
			}
		})
	);


	/* --------------------------- html_edit -------------------------- */
	// 为什么单独一个工具：它回答的是「这段文本在 HTML 的哪个位置」——位置决定了能不能改、
	// 改了会不会翻车。实测过的两种翻车：
	//   ① 把 emoji 换成 `<svg>` 时它在属性值里 → 标记被当文本显示在页面上；
	//   ② 把属性值的结束引号换成 `“` → 属性撑破，后半页错位。
	// 这类活如果只给正则，每个调用方都要重新踩一遍；所以把“上下文分类”做成能力。
	if (shouldRegister(profile, "html_edit")) {
		ctx.tools.register(
			defineTool({
				name: "html_edit",
				description: "Context-aware HTML rewrite: classify text/attr/script/comment first; markup never leaks into attributes.",
				parameters: {
					action: {
						type: "string",
						enum: ["scan", "rewrite"],
						description: "scan = 定位文本出现在哪；rewrite = 按上下文安全替换。",
						required: true
					},
					html: { type: "string", description: "HTML 文件路径或内联标记。", required: true },
					probe: { type: "string", description: "scan: 要定位的文本（如一个 emoji）。" },
					kind: {
						type: "string",
						enum: ["emoji", "straight-quote", "cjk-punct"],
						description: "scan: 整类扫描（列清单+上下文），比 probe 更适合批量替换前摸底。"
					},
					find: { type: "string", description: "rewrite: 原文（字面量）。" },
					replace: { type: "string", description: "rewrite: 替换内容；含 <> 时只允许进文本节点。" },
					pairs: { type: "string", description: "rewrite 批量: 每行 `原文=>替换`，一次过改几十个 (如 emoji 映射表)。" },
					scope: { type: "string", enum: ["text", "text+attr", "all"], description: "rewrite: 允许改动的上下文，默认 text。" },
					out: { type: "string", description: "rewrite: 写回路径；省略则只回报。" }
				},
				output: {
					schema: { type: "object", additionalProperties: true },
					render: (args, value) => {
						if (value.action === "scan" && value.kind !== undefined) {
							// 整类扫描：给“能直接换的”和“换了也没用的”两类，直接支撑接下来的批量 rewrite
							const list = (value.chars ?? []).map((c) => `${c.char}×${c.total}`).join(" ");
							const dead = value.unconvertible ?? [];
							return [
								{
									type: "text",
									text:
										`html_edit [scan:${value.kind}] ${value.target}: ${value.total} 处、${(value.chars ?? []).length} 种 —— ${list}\n` +
										(dead.length === 0
											? "  全部出现在文本节点，可直接换标记"
											: `  ${dead.length} 种只出现在属性/脚本/注释里（换了也没用）：${dead.join(" ")}`) +
										`\n  下一步：把要改的写成 pairs（每行 \`原文=>替换\`），缺映射会当场报出来`
								}
							];
						}
						if (value.action === "scan") {
							const groups = Object.entries(value.counts ?? {}).map(([k, n]) => `${k}×${n}`).join("、") || "无";
							const spots = (value.found ?? []).slice(0, 6).map((f) => `    ${f.line}行 ${f.kind}${f.attr === undefined ? "" : `(${f.attr})`}`).join("\n");
							return [
								{
									type: "text",
									text:
										`html_edit [scan] ${value.target}: 「${value.probe}」共 ${value.total} 处 —— ${groups}\n` +
										`  可安全插入标记的只有 text 那部分；attr 里放标记一定会被当文本显示` +
										(spots === "" ? "" : `\n${spots}`)
								}
							];
						}
						const changed = value.changes.length;
						const refused = value.refused ?? [];
						const byKind = {};
						for (const c of value.changes) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
						const detail = refused.slice(0, 5).map((r) => `    ${r.kind}${r.attr === undefined ? "" : `(${r.attr})`}：${r.reason}`).join("\n");
						return [
							{
								type: "text",
								text:
									`html_edit [rewrite] ${value.target}: 改 ${changed} 处（${Object.entries(byKind).map(([k, n]) => `${k}×${n}`).join("、") || "—"}），拒绝 ${refused.length} 处` +
									(value.out === undefined ? "（未写盘）" : ` → ${value.out}`) +
									(refused.length === 0 ? "" : `\n  被拒绝（这些位置改了会翻车）：\n${detail}`) +
									(value.unmapped.length === 0
										? ""
										: `\n  ⚠ 映射为空（未改动）：${value.unmapped.slice(0, 8).join(" ")}——要删除请写 \`原文=>(del)\``)
							}
						];
					}
				},
				isConcurrencySafe: () => true,
				timeoutMs: 30000,
				async execute(args) {
					const raw = String(args.html ?? "");
					const looksLikePath = /[\\/]|\.html?$/i.test(raw) && !/[<>]/.test(raw);
					const source = looksLikePath ? await (await import("node:fs/promises")).readFile(raw, "utf8") : raw;
					const target = looksLikePath ? raw : "(inline)";
					if (args.action === "scan") {
						const probe = String(args.probe ?? "");
						const kind = String(args.kind ?? "");
						if (probe === "" && kind === "") throw new Error("action=scan 需要 probe 或 kind");
						if (probe === "") {
							const result = locateClass(source, kind);
							return plain({
								action: "scan",
								target,
								kind,
								total: result.total,
								chars: result.chars,
								unconvertible: result.unconvertible.map((c) => c.char)
							});
						}
						const { found, counts, total } = locate(source, probe);
						return plain({ action: "scan", target, probe, total, counts, found: found.slice(0, 40) });
					}
					const find = String(args.find ?? "");
					const pairsRaw = String(args.pairs ?? "");
					const pairs = pairsRaw
						.split(/\r?\n/)
						.map((line) => line.trim())
						.filter((line) => line !== "" && line.includes("=>"))
						.map((line) => {
							const at = line.indexOf("=>");
							const target = line.slice(at + 2).trim();
							// `原文=>(del)` = 显式删除；`原文=>`（空）= 映射缺失，默认会被拒绝
							return { find: line.slice(0, at).trim(), replace: target === "(del)" ? null : target };
						});
					if (find === "" && pairs.length === 0) throw new Error("action=rewrite 需要 find 或 pairs");
					const result = rewriteByContext({
						source,
						...(pairs.length > 0 ? { pairs } : { find, replace: String(args.replace ?? "") }),
						scope: args.scope ?? "text"
					});
					let out;
					if (typeof args.out === "string" && args.out !== "") {
						await mkdir(dirname(args.out), { recursive: true });
						await writeFile(args.out, result.output, "utf8");
						out = args.out;
					}
					return plain({
						action: "rewrite",
						target,
						...(out === undefined ? {} : { out }),
						changes: result.changes,
						refused: result.refused,
						unmapped: result.unmapped,
						bytes: Buffer.byteLength(result.output, "utf8")
					});
				}
			})
		);
	}



	/* --------------------------- css_edit --------------------------- */
	// 它回答的是「这些手调数值能不能收敛到一套规范」——和 html_edit（定位+安全替换）
	// 是不同问题：一个管**位置**，一个管**取值**。存在理由很实在：这一路做真实项目时，
	// “间距对齐 4px 网格”这件事我手写了三次同样逻辑的脚本。
	//
	// 安全默认：**不写盘**。机械改写必须先看改动清单再确认——
	// `write=true` 才落盘。
	if (shouldRegister(profile, "css_edit")) {
		ctx.tools.register(
			defineTool({
				name: "css_edit",
				description: "CSS normalization: snap spacing/fonts/leading/radius. Dry-run default.",
				parameters: {
					action: { type: "string", enum: ["scan", "snap", "scale", "leading", "radius"], description: "scan/snap 间距/scale 字号/leading 行高/radius 圆角", required: true },
					root: { type: "string", description: "CSS / HTML 文件或目录。", required: true },
					grid: { type: "number", description: "snap: 网格 px（默认 4）。" },
					scale: { type: "string", description: "scale: 目标阶梯，如 12,14,16,20" },
					write: { type: "boolean", description: "写回文件（默认只看清单）" }
				},
				output: {
					schema: { type: "object", additionalProperties: true },
					render: (_args, value) => {
						if (value.action === "scan") {
							// 每个越网格值都给出**就近两侧**的目标（10px → 8/12），
							// 否则模型拿到「不在网格：10px×2」还要自己算，实测就直接跳过不动手。
							const grid = Number.isFinite(value.grid) && value.grid > 0 ? value.grid : 4;
							const targetOf = (px) => {
								const lo = Math.floor(px / grid) * grid;
								const hi = lo + grid;
								return px % grid === 0 ? `${px}` : `${lo}/${hi}`;
							};
							const off = value.offGrid.slice(0, 8).map((v) => `${v.px}px×${v.count}→${targetOf(v.px)}`).join(" ") || "无";
							const sizes = value.fontSizes.map((s) => s.px).join(" / ") || "无";
							// 圆角那行给的是**该不该改**，不是“能改多少”——令牌化项目改散落 px 等于白忙
							const radius = value.radius;
							const radiusLine =
								radius === undefined || radius.total === 0
									? "  圆角：没有声明"
									: radius.tokenizedRatio >= 0.5
										? `  圆角：已令牌化 ${Math.round(radius.tokenizedRatio * 100)}%（${radius.tokenized}/${radius.total} 用 var()）—— 要改就改 :root 的 --radius-* 值，不是改散落 px`
										: `  圆角：**未令牌化**（只有 ${radius.tokenized}/${radius.total} 用 var()）—— 散落值 ${radius.loosePx.slice(0, 8).map((v) => `${v.px}px×${v.count}`).join(" ") || "无"}，可跑 action=radius 收敛`;
							// 组件里的 Tailwind 字号单独报一行：CSS 里只有 3 档但体检说 8 档时，
							// 这一行就是解释，也指出 action=scale 能一起收敛。
							const tailwind =
								Array.isArray(value.tailwindFontSizes) && value.tailwindFontSizes.length > 0
									? `  组件 text-[…px]：${value.tailwindFontSizes.length} 档（扫了 ${value.componentFiles ?? 0} 个组件：${value.tailwindFontSizes
											.slice(0, 8)
											.map((s) => `${s.px}px×${s.count}`)
											.join(" ")}${value.tailwindFontSizes.length > 8 ? " …" : ""}）—— action=scale 会一并收敛\n`
									: "";
							return [
								{
									type: "text",
									text:
										`css_edit [scan] ${value.files} 个文件 —— 间距 ${value.spacingTotal} 处，不在 ${value.grid}px 网格的 ${value.offGridCount} 处（${Math.round((value.offGridCount / Math.max(1, value.spacingTotal)) * 100)}%）\n` +
										`  不在网格：${off}\n  字号 ${value.fontSizes.length} 档：${sizes}\n` +
										tailwind +
										radiusLine
								}
							];
						}
						// 0 改动时给一句可执行提示，否则模型只会原地重跑同一个调用。
						const zeroHint =
							value.totalChanges === 0 && value.action === "scale"
								? `\n  没有找到可收敛的字号（扫了 ${value.componentFiles ?? 0} 个组件）：若样式在组件内联 style 或非 Tailwind 方案里，请把 root 指到含 .css 的目录`
								: "";
						const lines = value.perFile
							.slice(0, 8)
							.map((f) => `    ${f.file}: ${f.changes} 处（${f.sample.slice(0, 3).join("；")}）`)
							.join("\n");
						return [
							{
								type: "text",
								text:
									`css_edit [${value.action}] ${value.files} 个文件，可改 ${value.totalChanges} 处，跳过 ${value.skipped} 处（var/calc/百分比/无法判定）` +
									(value.written ? " — 已写回" : " — 未写盘（确认后加 write=true）") +
									(value.totalChanges === 0 ? zeroHint : `\n${lines}`)
								}
						];
					}
				},
				isConcurrencySafe: () => true,
				timeoutMs: 60000,
				async execute(args, exec) {
					const input = await resolveArg(String(args.root ?? ""), exec);
					if (!existsSync(input)) throw new Error(`css_edit 的 root 不存在：${input}`);
					// 收集文件：单文件直接用，目录收 .css/.html（含内联 <style>）。
					// 组件文件（.tsx/.jsx/.vue/.svelte）单独收：Tailwind 任意值字号
					// （text-[11.5px]）只能在那里，action=scale 会一并收敛。
					const filesToScan = [];
					const componentFiles = [];
					const isStyleFile = (name) => /\.(?:css|html?)$/i.test(name);
					// 测试文件是样本数据，改它等于篡改 fixture（与体检的跳过口径保持一致）。
					const isComponentFile = (name) =>
						/\.(?:tsx?|jsx?|vue|svelte)$/i.test(name) && !TEST_FILE_RE.test(name) && !/\.d\.ts$/i.test(name);
					if (statSync(input).isFile()) {
						if (isComponentFile(input)) componentFiles.push(input);
						else filesToScan.push(input);
					} else {
						const walk = (dir) => {
							for (const entry of readdirSync(dir, { withFileTypes: true })) {
								if (entry.name.startsWith(".")) continue;
								const full = join(dir, entry.name);
								if (entry.isDirectory()) {
									if (isSkippableDir(entry.name) === false) walk(full);
									continue;
								}
								if (isStyleFile(entry.name)) filesToScan.push(full);
								else if (isComponentFile(entry.name)) componentFiles.push(full);
							}
						};
						walk(input);
					}
					if (filesToScan.length === 0 && componentFiles.length === 0) throw new Error(describeEmptyRoot(input));

					if (args.action === "scan") {
						const merged = { grid: Number.isFinite(args.grid) ? args.grid : 4, spacingTotal: 0, offGridCount: 0, offGrid: [], fontSizes: [] };
						const sizes = new Map();
						const offMap = new Map();
						for (const file of filesToScan) {
							const info = inspectCss(readFileSync(file, "utf8"), { grid: merged.grid });
							merged.spacingTotal += info.spacingTotal;
							merged.offGridCount += info.offGridCount;
							for (const v of info.offGrid) offMap.set(v.px, (offMap.get(v.px) ?? 0) + v.count);
							for (const s of info.fontSizes) sizes.set(s.px, (sizes.get(s.px) ?? 0) + s.count);
						}
						merged.offGrid = [...offMap.entries()].map(([px, count]) => ({ px, count, onGrid: false })).sort((a, b) => b.count - a.count);
						merged.fontSizes = [...sizes.entries()].sort((a, b) => a[0] - b[0]).map(([px, count]) => ({ px, count }));

						// 组件里的 Tailwind 任意值字号：CSS 里看不到，但 layout_check 会数进档位。
						// 单独列出来，否则「CSS 只有 3 档、体检说 8 档」看起来像测错了。
						const tailMap = new Map();
						for (const file of componentFiles) {
							for (const m of readFileSync(file, "utf8").matchAll(/text-\[(\d*\.?\d+)px\]/g)) {
								const px = Number(m[1]);
								tailMap.set(px, (tailMap.get(px) ?? 0) + 1);
							}
						}
						merged.componentFiles = componentFiles.length;
						merged.tailwindFontSizes = [...tailMap.entries()].sort((a, b) => a[0] - b[0]).map(([px, count]) => ({ px, count }));

						// 圆角：跨文件汇总（令牌化率要按整个项目算，单文件看不出）
						const radius = { total: 0, tokenized: 0, preserved: 0, other: 0, values: new Map() };
						for (const file of filesToScan) {
							const info = inspectRadius(readFileSync(file, "utf8"));
							radius.total += info.total;
							radius.tokenized += info.tokenized;
							radius.preserved += info.preserved;
							radius.other += info.other;
							for (const n of info.px) radius.values.set(n, (radius.values.get(n) ?? 0) + 1);
						}
						merged.radius = {
							total: radius.total,
							tokenized: radius.tokenized,
							// 令牌化率：≥0.5 就该去改 --radius-* 值，而不是改散落 px
							tokenizedRatio: radius.total === 0 ? 0 : Math.round((radius.tokenized / radius.total) * 100) / 100,
							loosePx: [...radius.values.entries()].sort((a, b) => b[1] - a[1]).map(([px, count]) => ({ px, count }))
						};
						return plain({ action: "scan", files: filesToScan.length, ...merged });
					}

					const scale = String(args.scale ?? "").split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
					if (args.action === "scale" && scale.length < 2) throw new Error("action=scale 需要 scale，至少两档（如 12,14,16,20,28）");
					if (args.action !== "scale" && filesToScan.length === 0) {
						throw new Error(
							`action=${args.action} 只处理 CSS/HTML，root 下没有这些文件（组件里的 Tailwind 字号请用 action=scale）：${input}`
						);
					}
					const perFile = [];
					let totalChanges = 0;
					let skipped = 0;
					for (const file of filesToScan) {
						const source = readFileSync(file, "utf8");
						const result =
							args.action === "snap"
								? snapSpacing(source, { grid: args.grid })
								: args.action === "leading"
									? normalizeLeading(source)
									: args.action === "radius"
										? normalizeRadius(source)
										: mapFontSizes(source, { scale });
						totalChanges += result.changes.length;
						skipped += result.skipped;
						if (result.changes.length === 0) continue;
						perFile.push({
							file: basename(file),
							changes: result.changes.length,
							sample: result.changes.slice(0, 4).map((c) => `${c.prop} ${c.from} → ${c.to}`)
						});
						if (args.write === true) await writeFile(file, result.output, "utf8");
					}
					// 组件里的 Tailwind 任意值字号：只有 action=scale 会动（其他动作是纯 CSS 变换）。
					if (args.action === "scale") {
						for (const file of componentFiles) {
							const result = mapTailwindFontSizes(readFileSync(file, "utf8"), { scale });
							totalChanges += result.changes.length;
							if (result.changes.length === 0) continue;
							perFile.push({
								file: basename(file),
								changes: result.changes.length,
								sample: result.changes.slice(0, 4).map((c) => `text-[${c.from}] → text-[${c.to}]`)
							});
							if (args.write === true) await writeFile(file, result.output, "utf8");
						}
					}
					return plain({
						action: args.action,
						files: filesToScan.length + (args.action === "scale" ? componentFiles.length : 0),
						componentFiles: componentFiles.length,
						totalChanges,
						skipped,
						written: args.write === true,
						perFile
					});
				}
			})
		);
	}

}

export { Config, apply, inject, name };
