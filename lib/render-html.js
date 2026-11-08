/**
 * render-html.js — HTML → PNG（调用本机已安装的浏览器无头模式）。
 *
 * **为什么必须有**：很多桌面软件的内部 UI 本身就是 web 版；不能渲染 HTML 就等于
 * “看不到自己的输出”，排版/间距/密度的问题根本无法发现。实测：参照稿在静态体检
 * 拿到 clean 之后，一渲染就看出头像权重、行高、字号全线偏大。
 *
 * **对“零外部进程”承诺的取舍**：核心渲染（SVG）依旧完全自包含（vendored resvg）；
 * 只有 HTML 这一项需要本机浏览器。这是有意为之：
 *   - 自己写 HTML/CSS 布局引擎去“验证”用户界面的布局，等于用可能错的尺子量东西，
 *     结论不可信；真实浏览器的引擎才是唯一可信的参照；
 *   - 探测不到浏览器时**明确报错并给方案**，绝不静默回退成“看起来对”的假渲染。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** 常见安装位置（Windows 优先，macOS/Linux 也列上）。按可靠性排序。 */
const CANDIDATES = [
	// Windows
	"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
	"C:/Program Files/Microsoft/Edge/Application/msedge.exe",
	"C:/Program Files/Google/Chrome/Application/chrome.exe",
	"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
	// macOS
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
	// Linux
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
	"/usr/bin/microsoft-edge"
];

/**
 * 找一个可用的 Chromium 系浏览器。
 * @param {string} [explicit] 配置里明确指定的路径（优先级最高）
 * @returns {{path: string, source: "config"|"detected"}|null}
 */
export function findBrowser(explicit) {
	if (typeof explicit === "string" && explicit.trim() !== "") {
		const p = resolve(explicit.trim());
		return existsSync(p) ? { path: p, source: "config" } : null;
	}
	for (const candidate of CANDIDATES) {
		if (existsSync(candidate)) return { path: candidate, source: "detected" };
	}
	return null;
}

/** 探测不到时的错误文案：给可执行的下一步，而不是只说“没找到”。 */
export function missingBrowserError() {
	return new Error(
		"没有找到可用于渲染 HTML 的浏览器。\n" +
			"HTML 渲染需要本机已安装 Chromium 系浏览器（Edge / Chrome / Chromium）。\n" +
			"可选做法：1) 安装 Edge 或 Chrome；2) 在插件配置里指定 browserPath 指向浏览器可执行文件；" +
			"3) 改用 action=render 处理 SVG（完全离线，不依赖浏览器）。"
	);
}

/**
 * 量出页面真实内容高（CSS px）。
 *
 * 为什么不用 `--screenshot` 自己“整页”：Chromium 无头模式的所有截图都只覆盖视口
 * （`--screenshot` 不传 `--window-size` 时用默认窗口），拿不到内容高就必须先算出来。
 * 这里在副本里插一段脚本，让**页面自己**把 scrollHeight 写进 title，用 `--dump-dom`
 * 读回来——全程不依赖 CDP，也不依赖页面配合。
 *
 * 副本里同时插 `<base href>`：副本在临时目录，不补 base 的话相对路径的 CSS/图片全部
 * 404，量到的是裸文本高度（会偏小得离谱）。
 */
function measureHeight({ browser, pageUrl, html, baseUrl, width, timeoutMs }) {
	const dir = mkdtempSync(join(tmpdir(), "dsh-measure-"));
	const profileDir = mkdtempSync(join(tmpdir(), "dsh-chrome-"));
	const file = join(dir, "measure.html");
	const inject =
		`<base href="${baseUrl}"><script>addEventListener("load",()=>{` +
		`const d=document.documentElement;` +
		`document.title="H:"+Math.max(d.scrollHeight,d.getBoundingClientRect().height)});</script>`;
	// 插在 <head> 后面（base 必须先于其它相对 URL 出现）；没有 head 就塞到 <html> 后
	let copy = String(html);
	const headAt = copy.search(/<head[^>]*>/i);
	if (headAt === -1) copy = inject + copy;
	else {
		const end = headAt + copy.slice(headAt).indexOf(">") + 1;
		copy = copy.slice(0, end) + inject + copy.slice(end);
	}
	writeFileSync(file, copy, "utf8");

	try {
		const run = spawnSync(
			browser.path,
			[
				"--headless=new",
				"--disable-gpu",
				"--hide-scrollbars",
				"--no-first-run",
				"--no-default-browser-check",
				"--disable-extensions",
				"--disable-lcd-text",
				`--window-size=${width},800`,
				"--virtual-time-budget=3000",
				"--dump-dom",
				`--user-data-dir=${profileDir}`,
				pathToFileURL(file).href
			],
			{ windowsHide: true, timeout: timeoutMs, encoding: "utf8" }
		);
		const hit = /H:(\d+)/.exec(String(run.stdout ?? ""));
		if (hit === null) {
			throw new Error(
				"整页截图需要先量内容高，但页面没有回报高度（--dump-dom 输出里没有 H: 标记，页面可能报了 JS 错）。\n" +
					`改成给明确 height 的视口截图，或手动跑：\n  "${browser.path}" --headless=new --dump-dom "${pageUrl}"`
			);
		}
		// 卡上限：防止某层 height:100vh 把“整页”拉成几万像素而截不出来
		return Math.min(30_000, Math.max(1, Number.parseInt(hit[1], 10)));
	} finally {
		for (const d of [dir, profileDir]) rmSync(d, { recursive: true, force: true });
	}
}

/** 读 PNG 的 IHDR 取真实像素尺寸；解析失败返回 0（不因回报失败而连渲染一起报错）。 */
function pngSize(file) {
	try {
		const buf = readFileSync(file);
		const sig = buf.subarray(0, 8).toString("hex");
		if (sig !== "89504e470d0a1a0a") return { width: 0, height: 0 };
		return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
	} catch {
		return { width: 0, height: 0 };
	}
}

/**
 * 把 HTML 渲染成 PNG。
 * @param {object} opts
 * @param {string} opts.html  HTML 文件路径，或内联 HTML 标记
 * @param {string} opts.out   输出 .png 绝对路径
 * @param {number} [opts.width]  视口宽（默认 1280）
 * @param {number} [opts.height] 视口高（默认 800）；传 "full" 语义用整页截图
 * @param {number} [opts.scale]  设备像素比（默认 1；2 = 两倍图）
 * @param {boolean} [opts.fullPage] 整页截图（两趟：先量出内容高，再按该高截图）
 * @param {string} [opts.browserPath] 浏览器可执行文件
 * @param {number} [opts.timeoutMs] 超时（默认 45s）
 */
export function renderHtml(opts) {
	const browser = findBrowser(opts.browserPath);
	if (browser === null) throw missingBrowserError();

	const width = Number.isFinite(opts.width) ? Math.max(1, Math.round(opts.width)) : 1280;
	const height = Number.isFinite(opts.height) ? Math.max(1, Math.round(opts.height)) : 800;
	const scale = Number.isFinite(opts.scale) ? Math.min(4, Math.max(0.5, opts.scale)) : 1;
	const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 45_000;

	// 内联 HTML 先落到临时文件（浏览器只接受 URL/路径）
	let pageUrl;
	let tempDir = null;
	const raw = String(opts.html ?? "");
	const looksLikePath = /[\\/]|\.html?$/i.test(raw) && !/[<>]/.test(raw);
	if (looksLikePath && existsSync(resolve(raw))) {
		pageUrl = pathToFileURL(resolve(raw)).href;
	} else {
		tempDir = mkdtempSync(join(tmpdir(), "dsh-html-"));
		const file = join(tempDir, "page.html");
		writeFileSync(file, raw, "utf8");
		pageUrl = pathToFileURL(file).href;
	}

	// 输出路径必须**绝对化**：浏览器以临时目录为 cwd 启动，相对路径会落到别处
	// （实测报“Failed to write file ... 系统找不到指定的路径”）。
	const outAbs = resolve(opts.out);
	const profileDir = mkdtempSync(join(tmpdir(), "dsh-chrome-"));

	// 整页截图必须**两趟**。
	//
	// 曾经直接写成 `--screenshot`（不带 --window-size）就当成整页——实际上浏览器会按
	// 自己的默认窗口（实测 750×485）截，既不是整页也不是调用方传的宽高，
	// 但返回值里又把 width/height 原样回填，于是“报 1100×1500、实际 750×485”，
	// 看上去成功、图却是残的（靠人眼看图才发现）。
	//
	// 正确做法：先用 `--dump-dom` 让页面自己把 scrollHeight 写进 title，读出真实内容高，
	// 再用 `--window-size=W,内容高` 截第二趟。测高副本里插 `<base>`，保证相对路径的
	// CSS/图片仍按原目录解析（否则测高页面是裸文本，高度全错）。
	let shotHeight = height;
	let measured = false;
	if (opts.fullPage === true) {
		shotHeight = measureHeight({
			browser, pageUrl, width, timeoutMs,
			html: looksLikePath && existsSync(resolve(raw)) ? readFileSync(resolve(raw), "utf8") : raw,
			baseUrl: new URL(".", pageUrl).href
		});
		measured = true;
	}

	const args = [
		"--headless=new",
		"--disable-gpu",
		"--hide-scrollbars",
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-extensions",
		// 关掉 LCD 子像素渲染：否则文字边缘会出现橙/蓝彩色条纹，
		// 按像素量对比度时会把它们当成“低对比文字”（实测报出 1.97:1 的假结果）。
		// 灰度抗锯齿下边缘像素与文字同色，量出来的才是真正的对比度。
		"--disable-lcd-text",
		`--force-device-scale-factor=${scale}`,
		`--window-size=${width},${shotHeight}`,
		"--virtual-time-budget=3000",
		`--screenshot=${outAbs}`,
		`--user-data-dir=${profileDir}`,
		pageUrl
	];

	try {
		const run = spawnSync(browser.path, args, {
			windowsHide: true,
			timeout: timeoutMs,
			encoding: "utf8",
			cwd: tempDir ?? undefined
		});
		// Chromium 系即使成功也常往 stderr 写噪音（如 QQBrowser 导入器），不能用 stderr 判成败
		if (!existsSync(outAbs)) {
			const stderr = String(run.stderr ?? "").trim().split("\n").slice(-4).join("\n");
			throw new Error(
				`HTML 渲染未产出文件（浏览器退出码 ${run.status ?? "null"}）。\n` +
					`可能的下一步：1) 确认路径可写；2) 加大 timeoutMs；3) 手动跑一次：\n` +
					`  "${browser.path}" ${args.join(" ")}\n` +
					(stderr === "" ? "" : `浏览器输出：\n${stderr}`)
			);
		}
		// 回报**实测**尺寸而不是请求尺寸：读 PNG 的 IHDR，报假数字比报错更坏
		const actual = pngSize(outAbs);
		return {
			path: outAbs,
			bytes: statSync(outAbs).size,
			width: actual.width === 0 ? width : Math.round(actual.width / scale),
			height: actual.height === 0 ? shotHeight : Math.round(actual.height / scale),
			pixelWidth: actual.width,
			pixelHeight: actual.height,
			scale,
			fullPage: opts.fullPage === true,
			measured,
			browser: browser.path,
			browserSource: browser.source
		};
	} finally {
		for (const dir of [tempDir, profileDir]) {
			if (dir !== null) rmSync(dir, { recursive: true, force: true });
		}
	}
}

