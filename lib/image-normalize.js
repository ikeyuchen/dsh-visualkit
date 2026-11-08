/**
 * image-normalize.js — 把 JPEG / WebP 转成 PNG，好让位图体检能用。
 *
 * 为什么需要：`taste_check` 与 `layout_check image` 的解码器只认 PNG（自己写的、零依赖）。
 * 但用户手里的图**大多不是 PNG**——截图工具导出 jpg、手机拍照是 jpg、网页另存是 webp，
 * 每次都被一句“只支持 PNG”挡回去，等于这项能力在真实场景里经常用不上。
 *
 * 为什么不上完整解码器：JPEG 要 huffman + IDCT，WebP 要 VP8，两者都远超“一本正经写个小东西”
 * 的量级，且必然引入精度风险。这里只做**尺寸解析 + 交给本机浏览器转码**——
 * 浏览器本来就是我们已声明的可选依赖（HTML→PNG），复用它比自己写解码器更可靠。
 * 解析尺寸是为了**按原尺寸**截图，不让浏览器缩放（缩放会改变构图比例，直接影响体检结论）。
 */

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG：直接读 IHDR。 */
function pngSize(buf) {
	if (buf.length < 24 || buf.subarray(0, 8).equals(PNG_SIG) === false) return null;
	return { format: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** JPEG：扫 SOFn 段拿宽高（不解码像素）。 */
function jpegSize(buf) {
	if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
	let i = 2;
	// 需要读到 i+8（宽度低字节）才够，所以是 `<=` 不是 `<`：
	// 写成 `i + 9 < len` 会让**末尾刚好结束的合法 JPEG** 被漏掉（合成夹具当场拦下）。
	while (i + 9 <= buf.length) {
		if (buf[i] !== 0xff) {
			i += 1;
			continue;
		}
		const marker = buf[i + 1];
		// SOF0/1/2/3/5/6/7/9/10/11/13/14/15（排除 4/8/12 等非 SOF）
		const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
		if (isSof) return { format: "jpeg", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
		const len = buf.readUInt16BE(i + 2);
		if (len < 2) return null;
		i += 2 + len;
	}
	return null;
}

/** WebP：RIFF 容器，按 VP8 / VP8L / VP8X 三种块取尺寸。 */
function webpSize(buf) {
	if (buf.length < 30 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
	const chunk = buf.toString("ascii", 12, 16);
	if (chunk === "VP8 ") {
		// 关键帧头：0x9d 0x01 0x2a 后面是 w/h（各 14 位）
		return { format: "webp", width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
	}
	if (chunk === "VP8L") {
		const bits = buf.readUInt32LE(21);
		return { format: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
	}
	if (chunk === "VP8X") {
		const width = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1;
		const height = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1;
		return { format: "webp", width, height };
	}
	return null;
}

/**
 * 识别格式并取尺寸。
 * @param {Buffer} buf
 * @returns {{format:"png"|"jpeg"|"webp", width:number, height:number}|null}
 */
export function imageSize(buf) {
	return pngSize(buf) ?? jpegSize(buf) ?? webpSize(buf);
}

/** 这个扩展名需不需要转码（PNG 不用）。 */
export function needsNormalize(file) {
	return /\.(?:jpe?g|webp)$/i.test(String(file));
}

/**
 * 读成 PNG 字节：PNG 直读，JPEG/WebP 先转码（临时文件用完即删）。
 *
 * 位图层（taste_check）与构图层（layout_check image）共用一个入口：
 * 两边各自写一份的话，就会出现“AI 味体检能吃 jpg，构图体检还只说只支持 PNG”这种分叉。
 *
 * @param {string} file 源图绝对路径
 * @param {{browserPath?:string}} [opts]
 * @returns {Promise<Buffer>}
 */
export async function readAsPng(file, opts = {}) {
	const { readFileSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	// **按内容判定，不按扩展名**：把 png 存成 .jpg 是常见操作（截图工具、批量重命名），
	// 按扩展名分支会让它去转码，而转码函数看到真身是 png 又直接返回原路径，
	// 两头一错开就读了一个不存在的临时文件（合成夹具当场拦下）。
	const buf = readFileSync(file);
	const size = imageSize(buf);
	if (size === null) throw new Error(`${file} 不是可识别的 PNG/JPEG/WebP（读不到尺寸）`);
	if (size.format === "png") return buf;
	const temp = join(tmpdir(), `visualkit-img-${process.pid}-${Date.now()}.png`);
	try {
		await normalizeImage({ file, out: temp, browserPath: opts.browserPath });
		return readFileSync(temp);
	} finally {
		rmSync(temp, { force: true });
	}
}

/**
 * 用本机浏览器把任意图片转成同尺寸 PNG（不缩放）。
 *
 * @param {object} opts
 * @param {string} opts.file 源图绝对路径
 * @param {string} opts.out 输出 PNG 绝对路径
 * @param {string} [opts.browserPath]
 * @returns {Promise<{path:string, width:number, height:number, format:string}>}
 */
export async function normalizeImage(opts) {
	const { readFileSync } = await import("node:fs");
	const { pathToFileURL } = await import("node:url");
	const { renderHtml } = await import("./render-html.js");

	const buf = readFileSync(opts.file);
	const size = imageSize(buf);
	if (size === null) {
		throw new Error(`${opts.file} 不是可识别的 PNG/JPEG/WebP（读不到尺寸）——请先另存为标准格式`);
	}
	if (size.format === "png") return { path: opts.file, width: size.width, height: size.height, format: "png" };

	// 页面只放一张图、零边距；窗口取原尺寸，避免任何缩放（缩放会改变构图比例）
	const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff}img{display:block;width:${size.width}px;height:${size.height}px}</style></head><body><img src="${pathToFileURL(opts.file).href}"></body></html>`;
	await renderHtml({
		html,
		out: opts.out,
		width: size.width,
		height: size.height,
		scale: 1,
		...(opts.browserPath === undefined ? {} : { browserPath: opts.browserPath })
	});
	return { path: opts.out, width: size.width, height: size.height, format: size.format };
}
