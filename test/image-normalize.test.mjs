/**
 * test/image-normalize.test.mjs — JPEG / WebP 尺寸解析与输入归一化的入口判定。
 *
 * 为什么单独开文件：这一步是位图体检的前置（`taste_check` 与 `layout_check image` 的解码器只认
 * PNG），但它只做**容器头解析**，不需要浏览器、不需要真实图片——用合成出来的最小头部字节就能
 * 把每个分支钉住。转码本身（`normalizeImage`）依赖本机浏览器，由需要渲染的用例覆盖。
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { imageSize, needsNormalize, readAsPng } from "../lib/image-normalize.js";
import { tempDir } from "./helpers.mjs";

/* ------------------------------ 夹具构造 ------------------------------ */

/** 最小 PNG：签名 + IHDR（长度 13、类型 IHDR、宽高各 4 字节）。 */
function pngHeader(width, height) {
	const buf = Buffer.alloc(24);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
	buf.writeUInt32BE(13, 8);
	buf.write("IHDR", 12, "ascii");
	buf.writeUInt32BE(width, 16);
	buf.writeUInt32BE(height, 20);
	return buf;
}

/** 最小 JPEG：SOI + DQT（跳过段）+ SOF0（带宽高）+ 结束填充。 */
function jpegHeader(width, height, { filler = false, segmentLength = 0x0011 } = {}) {
	const parts = [Buffer.from([0xff, 0xd8])];
	if (filler) parts.push(Buffer.from([0x00, 0x11, 0x22]));
	const dqt = Buffer.from([0xff, 0xdb, 0x00, 0x04, 0x00, 0x00]);
	parts.push(dqt);
	const sof = Buffer.alloc(2 + 2 + 2 + 1 + 2 + 2 + 1);
	sof[0] = 0xff;
	sof[1] = 0xc0;
	sof.writeUInt16BE(segmentLength, 2);
	sof[4] = 8;
	sof.writeUInt16BE(height, 5);
	sof.writeUInt16BE(width, 7);
	sof[9] = 1;
	parts.push(sof);
	parts.push(Buffer.from([0xff, 0xd9]));
	return Buffer.concat(parts);
}

/** RIFF 容器骨架：RIFF + 尺寸 + WEBP + 指定的 chunk 类型。 */
function riff(chunk, payload, total = 40) {
	const buf = Buffer.alloc(total);
	buf.write("RIFF", 0, "ascii");
	buf.writeUInt32LE(total - 8, 4);
	buf.write("WEBP", 8, "ascii");
	buf.write(chunk, 12, "ascii");
	payload?.copy(buf, 20);
	return buf;
}

/* ------------------------------ 尺寸解析 ------------------------------ */

test("imageSize：PNG 读 IHDR", () => {
	assert.deepEqual(imageSize(pngHeader(320, 200)), { format: "png", width: 320, height: 200 });
});

test("imageSize：PNG 头不完整时返回 null", () => {
	assert.equal(imageSize(pngHeader(320, 200).subarray(0, 20)), null);
});

test("imageSize：JPEG 扫 SOFn 取宽高", () => {
	assert.deepEqual(imageSize(jpegHeader(640, 480)), { format: "jpeg", width: 640, height: 480 });
});

test("imageSize：JPEG 关键段前有非标记字节时逐字节跳过", () => {
	assert.deepEqual(imageSize(jpegHeader(120, 90, { filler: true })), { format: "jpeg", width: 120, height: 90 });
});

test("imageSize：JPEG 段长非法（<2）时返回 null", () => {
	const buf = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
	assert.equal(imageSize(buf), null);
});

test("imageSize：JPEG 找不到 SOF 时返回 null", () => {
	const buf = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xda, 0x00, 0x08]), Buffer.alloc(8)]);
	assert.equal(imageSize(buf), null);
});

test("imageSize：WebP VP8（有损）按 14 位宽高解析", () => {
	const buf = riff("VP8 ", null);
	buf.writeUInt16LE(0x0280, 26);
	buf.writeUInt16LE(0x01e0, 28);
	assert.deepEqual(imageSize(buf), { format: "webp", width: 640, height: 480 });
});

test("imageSize：WebP VP8L（无损）按位域解析", () => {
	const buf = riff("VP8L", null);
	const bits = (319 & 0x3fff) | ((199 & 0x3fff) << 14);
	buf.writeUInt32LE(bits, 21);
	assert.deepEqual(imageSize(buf), { format: "webp", width: 320, height: 200 });
});

test("imageSize：WebP VP8X（扩展）按 24 位宽高解析", () => {
	const buf = riff("VP8X", null);
	buf[24] = 0x3f;
	buf[25] = 0x01;
	buf[26] = 0x00;
	buf[27] = 0xc7;
	buf[28] = 0x00;
	buf[29] = 0x00;
	assert.deepEqual(imageSize(buf), { format: "webp", width: 320, height: 200 });
});

test("imageSize：RIFF 但 chunk 未知时返回 null", () => {
	assert.equal(imageSize(riff("ALPH", null)), null);
});

test("imageSize：不足 30 字节或非 RIFF 时返回 null", () => {
	assert.equal(imageSize(Buffer.from("RIFF0000WEBP")), null);
	assert.equal(imageSize(Buffer.from("not an image at all, just text")), null);
});

/* ------------------------------ 扩展名判定 ------------------------------ */

test("needsNormalize：只有 JPEG / WebP 需要转码", () => {
	assert.equal(needsNormalize("a.jpg"), true);
	assert.equal(needsNormalize("a.JPEG"), true);
	assert.equal(needsNormalize("a.webp"), true);
	assert.equal(needsNormalize("a.png"), false);
	assert.equal(needsNormalize("a.svg"), false);
});

/* ------------------------------ 读入入口 ------------------------------ */

test("readAsPng：PNG 原样返回，不触发转码", async (t) => {
	const dir = tempDir(t, "normalize-png");
	const file = join(dir, "shot.png");
	writeFileSync(file, pngHeader(64, 48));
	assert.deepEqual(await readAsPng(file), readFileSync(file));
});

test("readAsPng：识别不了内容时报错并指出路径", async (t) => {
	const dir = tempDir(t, "normalize-bad");
	const file = join(dir, "shot.jpg");
	writeFileSync(file, "definitely not a jpeg");
	await assert.rejects(() => readAsPng(file), /不是可识别的 PNG\/JPEG\/WebP/);
});
