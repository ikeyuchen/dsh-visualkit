/**
 * preview.js — morph action=preview 的实现核心：生成自包含 HTML 动效预览页。
 *
 * 页面内嵌 vendored morphicons 2.0.2 IIFE 与两端
 * 图标的 IconNode 数据，离线可开：单文件、无外链、无构建。
 * 交互：点击切换（弹簧动画，snappy/smooth/bouncy 可选）+ 进度条拖动
 * （seek 受控模式）+ 端点参照图。若 Node 侧 morphcore 可用，还服务端烘焙
 * 一排中间态静帧（t=0…1），不点不动也能看形变过程。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadAdapters, loadMorphCore } from "./morphcore.js";
import { checkIcon, extractInner, iconToInnerSvg, parseIconNodes } from "./svg.js";
import { getIcon } from "./icondb.js";

const VENDOR_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "vendor", "morphicons.iife.js");
const SPRINGS = ["snappy", "smooth", "bouncy"];

/** fill 风格图标（包数据里的品牌/实心图标）：2.0 的 region 数据需先 preload，
 * 否则服务端烘焙的静帧会停留在起点形状（浏览器侧点击 morph 不受影响）。 */
function isFillDrawn(node) {
	return node.some(([, attrs]) => typeof attrs?.fill === "string" && attrs.fill !== "none");
}

function readVendor() {
	return readFileSync(VENDOR_PATH, "utf8");
}

/** JSON → 可内嵌 <script> 的字面量（防 </script> 提前闭合）。 */
function embedJson(value) {
	return JSON.stringify(value).replace(/<\//g, "<\\/");
}

function frameSvg(d, size, label) {
	return (
		`<div class="frame"><svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
		`stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>` +
		(label ? `<span>${label}</span>` : "") + `</div>`
	);
}

function sideSvg(inner, size, label) {
	return (
		`<div class="side"><svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
		`stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg><span>${label}</span></div>`
	);
}

/**
 * 生成预览页 HTML。
 * @param {object} p
 * @param {{name:string,node:object[]}} p.from 起始图标
 * @param {{name:string,node:object[]}} p.to 目标图标
 */
async function buildPreviewHtml({ from, to, spring = "snappy", size = 120 }) {
	const preset = SPRINGS.includes(spring) ? spring : "snappy";
	// 舞台尺寸：给边界（40–800），非法值回落 120；声明了就不能无效
	const stageSize = typeof size === "number" && Number.isFinite(size) && size >= 40 && size <= 800 ? Math.round(size) : 120;
	const vendor = readVendor();
	const core = await loadMorphCore();

	// 服务端烘焙中间态静帧（morphcore 不可用则整段省略）。
	// 这里只算 **帧内容**，不拼 <section>/<h2> —— 标记写在主模板里，
	// 否则源码顺序会变成「h2 在 h1 之前」：自测（layout_check ui）就报过
	// structure-heading-first，虽然浏览器里渲染顺序是对的，但源码层确实误导人。
	let framesHtml = "";
	if (core !== null) {
		if (isFillDrawn(from.node) || isFillDrawn(to.node)) {
			try {
				await core.preloadRegion?.();
			} catch {
				/* region 不可用：仍出静帧，但可能停在起点形状 */
			}
		}
		const marks = [0, 0.25, 0.5, 0.75, 1];
		const frames = marks.map((t) => frameSvg(core.sampleD(from.node, to.node, t), 44, t === 0 ? "t=0" : `t=${t}`));
		framesHtml = `<div class="frames">${frames.join("")}</div>`;
	}

	const title = `${from.name} ⇄ ${to.name}`;
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>morph 预览 · ${title}</title>
<style>
  :root { color-scheme: light dark; }
  /* 字阶 4 档：24 / 18 / 14 / 12（T 梯级 24/14 = 1.71×，过 1.6 线）。
     原稿是 18 / 13 / 12，被自测（layout_check ui S1/S9）判为「梯级跮断、
     h2 与正文分不开」——2px 的差在 100% 缩放下看不出来。 */
  body { font: 14px/1.6 system-ui, "Segoe UI", sans-serif; margin: 0; padding: 24px; max-width: 640px; margin-inline: auto; }
  h1 { font-size: 24px; line-height: 1.25; margin: 0 0 6px; }
  h2 { font-size: 18px; line-height: 1.3; opacity: .7; margin: 22px 0 8px; }
  .meta { opacity: .6; font-size: 12px; margin-bottom: 16px; }
  .stage-wrap { display: flex; align-items: center; gap: 28px; flex-wrap: wrap; }
  /* 用 #2563eb 而不是 #3b82f6：白字在 #3b82f6 上只有 3.68:1（低于 WCAG AA 4.5:1），
     #2563eb 是 5.17:1，过 AA。这是自测（layout_check ui）在我们的自己的代码里查出来的。 */
  .stage { color: #2563eb; }
  .side { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 12px; opacity: .75; }
  .controls { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-top: 16px; }
  button { font: inherit; padding: 6px 18px; border-radius: 8px; border: 1px solid currentColor; background: transparent; cursor: pointer; }
  button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
  input[type=range] { width: 240px; }
  fieldset { border: none; padding: 0; margin: 0; display: flex; gap: 8px; font-size: 14px; }
  .strip .frames { display: flex; gap: 14px; flex-wrap: wrap; }
  .frame { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 12px; opacity: .85; }
  .hint { margin-top: 18px; font-size: 12px; opacity: .55; }
</style>
</head>
<body>
<h1>morph 预览 · ${title}</h1>
<div class="meta">morphicons 2.0.2（vendored 上游）· spring=${preset} · 点击按钮看弹簧动画，拖动进度条看受控形变</div>

<div class="stage-wrap">
  ${sideSvg(iconToInnerSvg(from.node), 40, from.name)}
  <svg id="stage" class="stage" width="${stageSize}" height="${stageSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path/></svg>
  ${sideSvg(iconToInnerSvg(to.node), 40, to.name)}
</div>

<div class="controls">
  <button id="toggle" class="primary">morph → ${to.name}</button>
  <label>进度 <input id="scrub" type="range" min="0" max="1" step="0.001" value="0"></label>
  <fieldset id="springs">
    <label><input type="radio" name="spring" value="snappy" ${preset === "snappy" ? "checked" : ""}>snappy</label>
    <label><input type="radio" name="spring" value="smooth" ${preset === "smooth" ? "checked" : ""}>smooth</label>
    <label><input type="radio" name="spring" value="bouncy" ${preset === "bouncy" ? "checked" : ""}>bouncy</label>
  </fieldset>
</div>

${framesHtml === "" ? "" : `<section class="strip"><h2>中间态静帧（服务端烘焙）</h2>${framesHtml}</section>`}

<p class="hint">进度条对应 seek（受控模式，无弹簧）；按钮对应 morphTo（可中断弹簧，中途再点会从中间形重新规划）。reducedMotion 跟随系统设置。</p>

<script>
${vendor}
</script>
<script>
const FROM = ${embedJson(from.node)};
const TO = ${embedJson(to.node)};
const stageEl = document.querySelector('#stage path');
const inst = MorphIcons.createMorph(stageEl, FROM, { reducedMotion: 'user' });
let atFrom = true;
let spring = ${JSON.stringify(preset)};
const toggleBtn = document.querySelector('#toggle');
toggleBtn.addEventListener('click', () => {
  atFrom = !atFrom;
  inst.morphTo(atFrom ? FROM : TO, spring);
  toggleBtn.textContent = 'morph → ' + (atFrom ? ${JSON.stringify(to.name)} : ${JSON.stringify(from.name)});
});
document.querySelector('#scrub').addEventListener('input', (e) => {
  inst.seek(TO, Number(e.target.value)); // t=0 即 FROM、t=1 即 TO
});
document.querySelector('#springs').addEventListener('change', (e) => { spring = e.target.value; });
</script>
</body>
</html>
`;
}

/** 默认输出目录：config.previewDir → 系统临时目录下的 dsh-visualkit。 */
function defaultPreviewDir(configured) {
	if (configured && configured.trim() !== "") return configured;
	return join(tmpdir(), "dsh-visualkit");
}

/** 生成并落盘预览页；返回 { path, sizeBytes, spring }。 */
async function writePreview({ from, to, spring, outPath, previewDir, cwd, size }) {
	const html = await buildPreviewHtml({ from, to, spring, size });
	const target = outPath && outPath.trim() !== ""
		? (isAbsolute(outPath) ? outPath : join(cwd ?? process.cwd(), outPath))
		: join(defaultPreviewDir(previewDir), `morph-${from.name}-to-${to.name}.html`);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, html, "utf8");
	return { path: target, sizeBytes: Buffer.byteLength(html, "utf8"), file: basename(target), spring: SPRINGS.includes(spring) ? spring : "snappy" };
}

/** SVG 标记 → { name, node }；非 24 网格用 vendored 引擎 fitIcon 归一化。 */
async function fromMarkup(raw, name, checkOnRaw) {
	if (!checkOnRaw) return { name, node: [] };
	const { inner, viewBox } = extractInner(raw);
	let node = parseIconNodes(inner);
	if (node === null) {
		const check = checkIcon(raw);
		throw new Error(`输入 SVG 未通过 morph 兼容体检：${check.issues.join("；") || "解析不出基本形节点"}（详见 morph action=check）`);
	}
	// 非 24 网格：preview 的舞台是 24 viewBox，不归一化会直接裁切（实测 48 网格矩形被框外切掉）
	if (viewBox !== undefined && viewBox.replace(/\s+/g, "") !== "002424") {
		try {
			const adapters = await loadAdapters();
			const fitted = adapters.fitIcon(node, viewBox, 24);
			if (typeof fitted === "string" && fitted.length > 0) node = [["path", { d: fitted }]];
		} catch {
			/* 引擎不可用：保留原节点（check 会提示需归一化） */
		}
	}
	return { name, node };
}

/** 把「图标名 / .svg 文件路径 / 内联标记」解析为 { name, node }；SVG 输入必须先过 morph action=check。 */
async function resolveIconInput(input, { checkOnRaw = true, cwd } = {}) {
	const raw = String(input ?? "").trim();
	if (raw === "") throw new Error("empty icon input");
	if (!raw.includes("<")) {
		const icon = getIcon(raw);
		if (icon !== undefined) return { name: icon.name, node: icon.node };
		if (raw.toLowerCase().endsWith(".svg")) {
			const file = isAbsolute(raw) ? raw : join(cwd ?? process.cwd(), raw);
			let svg;
			try {
				svg = await readFile(file, "utf8");
			} catch {
				throw new Error(`.svg 文件读不到：${raw}（解析为 ${file}；相对路径按会话目录）`);
			}
			return fromMarkup(svg, basename(file), checkOnRaw);
		}
		throw new Error(`unknown lucide icon "${raw}"（可先用 icon action=find 检索；也可传 .svg 文件路径或直接粘贴 SVG 标记）`);
	}
	return fromMarkup(raw, "custom-svg", checkOnRaw);
}

export { SPRINGS, buildPreviewHtml, writePreview, resolveIconInput };
