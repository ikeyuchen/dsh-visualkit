/**
 * morphcore.js — 在 Node 侧装载 vendored morphicons 核心（可选能力）。
 *
 * vendor/morphicons.iife.js 是 morphicons 2.0.2 的浏览器 IIFE（var MorphIcons = ...），没有 ESM
 * 导出；这里读取其源码、追加 default 导出后经 data: URL 动态 import。
 * 核心是纯计算（弹簧/重采样/canonical 序列化），加载期不触 DOM ——
 * createMorph 只需要一个带 setAttribute 的对象（本模块提供假元素），
 * 因此 canonicalD / 中间态 seek 在 Node 里可直接算。
 *
 * 任何一步失败都静默降级（返回 null），调用方按能力缺失处理，
 * 绝不让预览/体检工具因 vendor 问题而不可用。
 *
 * 信任边界（codereview #490）：下方 data: URL 动态 import 等价于执行读入的字符串
 * （eval 类模式），其安全性完全依赖「VENDOR_PATH / ADAPTERS_PATH 是模块相对的
 * 构建期固定产物」这一前提——路径与源码内容都不得受用户/插件输入影响，后续
 * 维护不得把这两个来源改成可注入的（若改为打包器分发，需同步补构建期
 * checksum 校验并重审 dirname(import.meta.url) 的解析）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VENDOR_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "vendor", "morphicons.iife.js");
const ADAPTERS_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "vendor", "morphicons-adapters.iife.js");

let api = undefined; // undefined=未尝试; null=不可用; object=可用
let adaptersApi = undefined; // 同上三态；adapters（svgToIcon/fitIcon），v0.3.0 起
// 审查修复 #285：装载中的 Promise（单飞缓存）——模块 import 即触发 adaptersWarmup，
// 工具在完成前再调用会重复 readFileSync 与动态 import（三态判断发生在任何
// await 之前，竞态窗口真实存在）；缓存进行中的 Promise 并在体内同步回写结果
let corePromise = null;
let adaptersPromise = null;

/** 后台预热 adapters（import 本模块即触发；工具执行时基本已就绪）。 */
const adaptersWarmup = (async () => {
	await loadAdapters();
})();

/** 假 <path> 元素：记录最后一次 setAttribute('d')，供离线采样中间态。 */
class FakePathEl {
	constructor() {
		this.lastD = "";
	}
	setAttribute(name, value) {
		if (name === "d") this.lastD = String(value);
	}
}

/**
 * codereview #489：装载 vendored IIFE 的公共步骤（读取 → 追加 default 导出 →
 * data: URL 动态 import → 形状校验）。loadMorphCore 与 loadAdapters 原先各自
 * 手写一遍，补丁串格式（尾换行、charset）这类细节只改一处就会悄然分叉。
 * 读取/导入/校验失败直接抛错，降级与三态缓存仍留在各自调用方。
 */
async function importVendedIife(path, globalName, validate) {
	const source = readFileSync(path, "utf8");
	const patched = `${source}\nexport default ${globalName};\n`;
	const mod = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(patched)}`);
	const value = mod.default;
	if (!validate(value)) throw new Error(`unexpected vendor shape: ${globalName}`);
	return value;
}

/** 单例装载；失败缓存（null），不反复重试 IO。 */
async function loadMorphCore() {
	if (api !== undefined) return api;
	if (corePromise === null) {
		corePromise = (async () => {
			try {
				const M = await importVendedIife(VENDOR_PATH, "MorphIcons", (v) => v !== undefined && typeof v.canonicalD === "function" && typeof v.createMorph === "function");
				api = {
					/** canonical path 字符串（morphicons 的静止态快照） */
					canonicalD: (node) => M.canonicalD(node),
					/** fill 图标形变前需要 region 可见表面数据（2.0 新增）；stroke 图标无事发生。 */
					preloadRegion: async () => {
						if (typeof M.preloadRegion === "function") await M.preloadRegion();
					},
					/** 离线采样：从 from 形变到 to，在进度 t 处的 path d 字符串（无弹簧、无 DOM） */
					sampleD(from, to, t) {
						const el = new FakePathEl();
						const inst = M.createMorph(el, from, { reducedMotion: "always" });
						try {
							inst.seek(to, Math.min(Math.max(t, 0), 1));
							// 审查修复 #286：删除「progress 兜底再 seek」死分支——vendor 的
							// createMorph 构造时即写入 canonical d、seek→render 同步执行，
							// lastD 为空只可能是渲染失败：按目标静止态返回对 t<1 是完全
							// 错误的中间态数据，宁可响亮失败也不静默降级给错值
							if (el.lastD === "") throw new Error("sampleD: seek 未产出中间态路径（vendor 行为变化？）");
							return el.lastD;
						} finally {
							inst.destroy?.();
						}
					}
				};
			} catch (error) {
				// 审查修复 #287：静默降级保留，但留一行可检索诊断——vendor 缺失/
				// 权限错误/形状不符时能从宿主日志区分「装载失败」与「预热未完成」
				console.warn(`[dsh-visualkit] morphicons core 不可用（按能力缺失降级）：${error?.message ?? error}`);
				api = null;
			}
			return api;
		})();
	}
	return corePromise;
}

/** 同法装载 adapters IIFE（svgToIcon + fitIcon，均无 DOM 依赖）。2.0 把 fitIcon
 * 移到核心导出（adapters 子路径只剩 svgToIcon/canvasTarget/maskTarget），构建 entry
 * 一并再导出 fitIcon，保持本模块「svgToIcon + fitIcon」的既有装载契约。 */
async function loadAdapters() {
	if (adaptersApi !== undefined) return adaptersApi;
	// 审查修复 #285：单飞缓存——adaptersWarmup 进行中的竞态调用原先会重复装载
	if (adaptersPromise === null) {
		adaptersPromise = (async () => {
			try {
				const A = await importVendedIife(ADAPTERS_PATH, "MorphIconsAdapters", (v) => typeof v?.svgToIcon === "function" && typeof v?.fitIcon === "function");
				adaptersApi = { svgToIcon: A.svgToIcon, fitIcon: A.fitIcon };
			} catch (error) {
				// 审查修复 #287：静默降级保留，但留一行可检索诊断（理由同 core 侧）
				console.warn(`[dsh-visualkit] morphicons adapters 不可用（引擎层判定降级为跳过）：${error?.message ?? error}`);
				adaptersApi = null;
			}
			return adaptersApi;
		})();
	}
	return adaptersPromise;
}

/** 同步取已缓存的 adapters；未就绪/不可用返回 undefined（调用方按能力缺失处理）。
 * codereview #488（取舍记录）：这里刻意把「预热中」与「确认不可用」坍缩为同一个
 * undefined——唯一需要区分二者的场景是「装载未完成 ≠ 能力缺失」，而那类调用方的
 * 正确姿势是先 `await adaptersWarmup` 再判定（模块预热即此写法；adaptersWarmup 在
 * 模块 import 时即触发，工具实际执行时早已 settle）。再导出 adaptersState() 之类
 * 三态探针在本仓库没有消费者，只会新增死 API；需要时以此为锚补导出。 */
function adaptersSync() {
	return adaptersApi === null ? undefined : adaptersApi;
}

export { adaptersSync, adaptersWarmup, loadAdapters, loadMorphCore };
