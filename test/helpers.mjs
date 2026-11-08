// test/helpers.mjs — 共用测试工具（零第三方依赖，只用 node 内置 + 本包 lib）。
//
// 设计原则：
//   1. 不依赖宿主进程：mock 一个最小 ctx 调 apply()，拿到真正的工具定义，
//      再走 execute → output.render，等价于真实工具调用链（缺的只有宿主侧的 schema 校验，
//      所以这里自带 assertMatchesSchema）。
//   2. PNG 自己解：resvg 是纯 JS 输出 RGBA，用 zlib.inflateSync + 反滤波 60 行就够，
//      比引 sharp/pngjs 更符合「零依赖发布包」的约束，也能真的校验像素。
//   3. 每个用例一个独立临时目录，t.after 自动清理；不写系统临时目录以外的地方。
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

export const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
export const TMP_ROOT = join(tmpdir(), "dsh-visualkit-test");
export const ARTIFACTS = join(REPO, ".test-out");

/* ------------------------------ 临时目录 ------------------------------ */

/** 建一个用例专属临时目录，测试结束自动递归删除。 */
export function tempDir(t, label = "case") {
	mkdirSync(TMP_ROOT, { recursive: true });
	const dir = mkdtempSync(join(TMP_ROOT, `${label.replace(/[^\w.-]+/g, "_")}-`));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

/** 按 {相对路径: 内容} 批量落文件。 */
export function writeTree(root, files) {
	for (const [rel, content] of Object.entries(files)) {
		const file = join(root, rel);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, content);
	}
	return root;
}

/** 把产物留在 .test-out/（gitignore）供人工看效果，测试结束后仍可打开。 */
export function saveArtifact(name, data) {
	mkdirSync(ARTIFACTS, { recursive: true });
	const file = join(ARTIFACTS, name);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, data);
	return file;
}

/* ------------------------------ 工具调用链 ------------------------------ */

const registries = new Map();

/**
 * apply() 一个 mock ctx，返回 { defs, section }。
 * @param {{cwd?: string}} [opts] cwd 给定时，工具里的相对路径会落到这个目录
 *   （模拟宿主的 workingDirectory 服务）。
 */
export async function toolRegistry(opts = {}) {
	const key = `${opts.cwd ? resolve(opts.cwd) : ""}|${JSON.stringify(opts.config ?? {})}`;
	if (registries.has(key)) return registries.get(key);
	const { apply, Config } = await import("../lib/index.js");
	// 契约/行为测试默认跑**全量工具集**（all），这样能覆盖所有工具而不必每个
	// 用例都传 toolsetProfile。档位分级本身由 contract.test.mjs 单独验。
	// 生产默认是 standard（只装 4 个高频工具）——那是常驻 token 的默认值，不是测试口径。
	const effectiveConfig = { toolsetProfile: "all", ...(opts.config ?? {}) };
	const defs = new Map();
	let section = null;
	const ctx = {
		tools: {
			register: (def) => {
				defs.set(def.name, def);
			},
			get: (name, scope) => (scope?.hideIcon ? undefined : defs.get(name))
		},
		systemPrompt: {
			section: (entry) => {
				section = entry;
				return () => {};
			}
		},
		effect: (fn) => {
			fn?.();
		},
		get: (name) => (name === "workingDirectory" && opts.cwd ? { ensure: async () => resolve(opts.cwd) } : undefined),
		logger: { warn() {} }
	};
	apply(ctx, Config(effectiveConfig));
	const registry = { defs, section, ctx, config: Config(effectiveConfig) };
	registries.set(key, registry);
	return registry;
}

export const TOOL_NAMES = ["icon", "morph", "taste_check", "layout_check", "design_style", "design_render", "html_edit", "css_edit"];

/**
 * 走完整调用链：execute(args, exec) → output.render(args, value)。
 * @returns {Promise<{value:any, blocks:any[], text:string, def:any}>}
 */
export async function call(name, args, opts = {}) {
	const { defs } = await toolRegistry({ cwd: opts.cwd, config: opts.config });
	const def = defs.get(name);
	if (def === undefined) throw new Error(`工具未注册：${name}`);
	const exec = opts.exec ?? { agent: opts.cwd ? { id: "test" } : undefined, signal: undefined };
	const value = await def.execute(args, exec);
	assertToolOutput(def, args, value, `${name}.execute()`);
	const blocks = def.output?.render ? def.output.render(args, value) : [];
	for (const block of blocks) {
		assert.equal(typeof block?.type, "string", `${name}: render block 缺少 type`);
		assert.equal(typeof block.text, "string", `${name}: render block 缺少 text`);
	}
	return { value, blocks, text: blocks.map((b) => b.text).join("\n"), def };
}

/** 断言 execute 抛错，并可用正则匹配消息。 */
export async function rejects(fn, pattern, label = "") {
	try {
		await fn();
	} catch (error) {
		if (pattern !== undefined) assert.match(String(error?.message ?? error), pattern, `${label}: 错误消息不匹配`);
		return error;
	}
	assert.fail(`${label || "调用"} 应该抛错但没有`);
}

/* --------------------------- 输出契约校验 --------------------------- */

/** 找出输出里所有值为 undefined 的路径（宿主会判 INVALID_TOOL_OUTPUT）。 */
export function undefinedPaths(value, prefix = "$") {
	const out = [];
	const walk = (node, path) => {
		if (node === undefined) {
			out.push(path);
			return;
		}
		if (node === null || typeof node !== "object") return;
		if (Array.isArray(node)) {
			node.forEach((child, i) => walk(child, `${path}[${i}]`));
			return;
		}
		for (const [key, child] of Object.entries(node)) walk(child, `${path}.${key}`);
	};
	walk(value, prefix);
	return out;
}

/**
 * 输出必须能无损 JSON 往返：不接受 undefined / NaN / Infinity / BigInt / 函数 / Symbol。
 * 这是历史 bug（INVALID_TOOL_OUTPUT）的机械守卫。
 */
export function assertLossless(value, label = "output") {
	const bad = undefinedPaths(value);
	assert.deepEqual(bad, [], `${label} 含 undefined：${bad.join(", ")}`);
	assert.deepEqual(JSON.parse(JSON.stringify(value)), value, `${label} 不能 JSON 无损往返`);
}

/** 按工具声明的 output.schema 校验类型（subset：type/items/properties/additionalProperties）。 */
export function assertMatchesSchema(value, schema, path = "$") {
	if (schema === undefined) return;
	const type = schema.type;
	if (type === "object") {
		assert.equal(typeof value, "object", `${path} 应为 object`);
		assert.ok(value !== null && !Array.isArray(value), `${path} 应为非数组 object`);
		if (schema.properties !== undefined) {
			for (const key of Object.keys(schema.properties)) {
				if (value[key] !== undefined) assertMatchesSchema(value[key], schema.properties[key], `${path}.${key}`);
			}
		}
		return;
	}
	if (type === "array") {
		assert.ok(Array.isArray(value), `${path} 应为 array`);
		if (schema.items !== undefined) value.forEach((item, i) => assertMatchesSchema(item, schema.items, `${path}[${i}]`));
		return;
	}
	if (type === "string") assert.equal(typeof value, "string", `${path} 应为 string`);
	else if (type === "number") assert.equal(typeof value, "number", `${path} 应为 number`);
	else if (type === "boolean") assert.equal(typeof value, "boolean", `${path} 应为 boolean`);
}

/** execute 输出 → 声明 schema 的类型校验 + 无损校验。 */
export function assertToolOutput(def, args, value, label) {
	assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${label} 应返回 object，实际 ${typeof value}`);
	assertLossless(value, label);
	assertMatchesSchema(value, def.output?.schema, `${label}(${args?.action ?? ""})`);
}

/* ------------------------------ PNG 解码 ------------------------------ */

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a, b, c) {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	if (pa <= pb && pa <= pc) return a;
	return pb <= pc ? b : c;
}

/** 解 PNG（8-bit、非隔行；支持 0/2/4/6 通道）→ {width,height,channels,data}。 */
export function decodePng(input) {
	const buf = Buffer.isBuffer(input) ? input : readFileSync(input);
	assert.ok(buf.subarray(0, 8).equals(PNG_SIG), "不是 PNG（签名不匹配）");
	let offset = 8;
	let ihdr = null;
	const idat = [];
	while (offset + 8 <= buf.length) {
		const len = buf.readUInt32BE(offset);
		const type = buf.toString("ascii", offset + 4, offset + 8);
		const data = buf.subarray(offset + 8, offset + 8 + len);
		if (type === "IHDR") ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colorType: data[9], interlace: data[12] };
		else if (type === "IDAT") idat.push(data);
		offset += 12 + len;
		if (type === "IEND") break;
	}
	assert.ok(ihdr !== null, "PNG 缺 IHDR");
	assert.equal(ihdr.depth, 8, "测试助手只支持 8-bit PNG");
	assert.equal(ihdr.interlace, 0, "测试助手不支持隔行 PNG");
	const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.colorType];
	assert.ok(channels !== undefined, `不支持的 colorType ${ihdr.colorType}`);
	const raw = inflateSync(Buffer.concat(idat));
	const stride = ihdr.width * channels;
	const out = Buffer.alloc(stride * ihdr.height);
	let pos = 0;
	for (let y = 0; y < ihdr.height; y += 1) {
		const filter = raw[pos++];
		const rowStart = y * stride;
		for (let x = 0; x < stride; x += 1) {
			const cur = raw[pos++];
			const left = x >= channels ? out[rowStart + x - channels] : 0;
			const up = y > 0 ? out[rowStart - stride + x] : 0;
			const upLeft = y > 0 && x >= channels ? out[rowStart - stride + x - channels] : 0;
			let val;
			if (filter === 0) val = cur;
			else if (filter === 1) val = cur + left;
			else if (filter === 2) val = cur + up;
			else if (filter === 3) val = cur + ((left + up) >> 1);
			else if (filter === 4) val = cur + paeth(left, up, upLeft);
			else throw new Error(`未知 PNG 行滤波 ${filter}`);
			out[rowStart + x] = val & 0xff;
		}
	}
	return { width: ihdr.width, height: ihdr.height, channels, data: out };
}

export function pngOf(file) {
	return decodePng(readFileSync(file));
}

/** 取像素 → {r,g,b,a}。 */
export function px(img, x, y) {
	assert.ok(x >= 0 && x < img.width && y >= 0 && y < img.height, `像素越界 ${x},${y} @ ${img.width}x${img.height}`);
	const i = (y * img.width + x) * img.channels;
	const d = img.data;
	if (img.channels === 4) return { r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] };
	if (img.channels === 3) return { r: d[i], g: d[i + 1], b: d[i + 2], a: 255 };
	if (img.channels === 2) return { r: d[i], g: d[i], b: d[i], a: d[i + 1] };
	return { r: d[i], g: d[i], b: d[i], a: d[i] };
}

/** alpha > threshold 的像素占比（透明底校验用）。 */
export function opaqueRatio(img, threshold = 8) {
	let hit = 0;
	if (img.channels < 4) return 1;
	for (let i = 3; i < img.data.length; i += img.channels) if (img.data[i] > threshold) hit += 1;
	return hit / (img.width * img.height);
}

/** 非透明像素的包围盒（看不见内容 = null；文字/图形落点校验用）。 */
export function inkBox(img, threshold = 8) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -1;
	let maxY = -1;
	const alphaIdx = img.channels === 4 ? 3 : img.channels === 2 ? 1 : -1;
	for (let y = 0; y < img.height; y += 1) {
		for (let x = 0; x < img.width; x += 1) {
			const i = (y * img.width + x) * img.channels;
			const alpha = alphaIdx === -1 ? 255 : img.data[i + alphaIdx];
			if (alpha <= threshold) continue;
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
		}
	}
	if (maxX < 0) return null;
	return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** 平均色（忽略透明像素）。 */
export function meanColor(img, box = { x: 0, y: 0, width: img.width, height: img.height }) {
	let r = 0;
	let g = 0;
	let b = 0;
	let n = 0;
	for (let y = box.y; y < box.y + box.height; y += 1) {
		for (let x = box.x; x < box.x + box.width; x += 1) {
			const p = px(img, x, y);
			if (p.a < 8) continue;
			r += p.r;
			g += p.g;
			b += p.b;
			n += 1;
		}
	}
	return n === 0 ? null : { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), n };
}

/* ------------------------------ 渲染能力 ------------------------------ */

/** 本平台能否真的渲染（vendored resvg 只有 win32-x64 绑定；CI 的 ubuntu 作业会跳过渲染类用例）。 */
const vendorRequire = createRequire(join(REPO, "package.json"));

export const CAN_RENDER = (() => {
	try {
		const { Resvg } = vendorRequire(join(REPO, "vendor", "resvg", "index.js"));
		const img = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#000"/></svg>').render();
		return img.width === 4;
	} catch {
		return false;
	}
})();

/** 渲染一个 SVG → {file, img, width, height, bytes}。 */
export async function renderTo(dir, name, svg, width) {
	const { renderSvg } = await import("../lib/render.js");
	const file = join(dir, name);
	const out = await renderSvg({ svg, png: file, width });
	return { ...out, file, img: pngOf(file) };
}

/* -------------------------- 测试环境自检 -------------------------- */

export function exists(file) {
	return existsSync(file);
}

export const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"';
