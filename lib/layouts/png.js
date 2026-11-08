/**
 * layouts/png.js — 最小 PNG 解码器（无依赖，lib 内部用）。
 *
 * 为什么要自己解：排版体检的 image 模式要看像素（内容包围盒/边距/重心/对齐），
 * 而 resvg 只输出不会回读。引 sharp/pngjs 会破坏「零运行时依赖」的发布包约束。
 * 只支持 resvg 实际产出的 8-bit 非隔行 PNG（colorType 0/2/4/6）——ours，不是通用库。
 */
import { inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a, b, c) {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	if (pa <= pb && pa <= pc) return a;
	return pb <= pc ? b : c;
}

/** PNG buffer → { width, height, channels, data }（data 为 RGBA/RGB 解码后的行优先字节）。 */
export function decodePng(input) {
	const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
	if (buf.length < 32 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("不是 PNG（签名不匹配）");
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
	if (ihdr === null) throw new Error("PNG 缺 IHDR");
	if (ihdr.depth !== 8) throw new Error(`只支持 8-bit PNG（收到 ${ihdr.depth}-bit）`);
	if (ihdr.interlace !== 0) throw new Error("不支持隔行 PNG");
	const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.colorType];
	if (channels === undefined) throw new Error(`不支持的 colorType ${ihdr.colorType}`);
	const raw = inflateSync(Buffer.concat(idat));
	const stride = ihdr.width * channels;
	const out = Buffer.alloc(stride * ihdr.height);
	let pos = 0;
	for (let y = 0; y < ihdr.height; y += 1) {
		const filter = raw[pos++];
		const row = y * stride;
		for (let x = 0; x < stride; x += 1) {
			const cur = raw[pos++];
			const left = x >= channels ? out[row + x - channels] : 0;
			const up = y > 0 ? out[row - stride + x] : 0;
			const upLeft = y > 0 && x >= channels ? out[row - stride + x - channels] : 0;
			let val;
			if (filter === 0) val = cur;
			else if (filter === 1) val = cur + left;
			else if (filter === 2) val = cur + up;
			else if (filter === 3) val = cur + ((left + up) >> 1);
			else if (filter === 4) val = cur + paeth(left, up, upLeft);
			else throw new Error(`未知 PNG 行滤波 ${filter}`);
			out[row + x] = val & 0xff;
		}
	}
	return { width: ihdr.width, height: ihdr.height, channels, data: out };
}

/** 取像素，统一返回 {r,g,b,a}。 */
export function pixelAt(img, x, y) {
	const i = (y * img.width + x) * img.channels;
	const d = img.data;
	if (img.channels === 4) return { r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] };
	if (img.channels === 3) return { r: d[i], g: d[i + 1], b: d[i + 2], a: 255 };
	if (img.channels === 2) return { r: d[i], g: d[i], b: d[i], a: d[i + 1] };
	return { r: d[i], g: d[i], b: d[i], a: d[i] };
}
