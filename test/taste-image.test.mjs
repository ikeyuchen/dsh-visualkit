// test/taste-image.test.mjs — 位图 AI 味体检（taste_check action=taste 收 .png）的功能测试。
//
// 校验四件事：
//   ① 紫蓝渐变海报（像素级 AI 指纹）要被抓到；
//   ② 中性灰密集界面不能被判成 AI（真实产品在这条上必须干净）；
//   ③ JPEG/WebP 靠文件头认出尺寸并转码；认不出来时明确报错，不许硬猜；
//   ④ 工具层能收 .png，返回 kind=image，且确定性可复现。
//
// 夹具用 vendored resvg 现画（零浏览器、零外部进程），见 lib/render.js 的 renderSvg。
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

import { CAN_RENDER, call, rejects, tempDir } from "./helpers.mjs";
import { renderSvg } from "../lib/render.js";
import { tasteImage } from "../lib/taste-image.js";
import { imageSize } from "../lib/image-normalize.js";

const skip = !CAN_RENDER && "本平台无 resvg 原生绑定（CI ubuntu 作业只跑非渲染用例）";

/** 紫蓝纵向渐变 + 居中大白字：典型 AI 海报。 */
const INDIGO_POSTER = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2B1B78"/><stop offset="1" stop-color="#8B5CF6"/>
  </linearGradient></defs>
  <rect width="600" height="800" fill="url(#g)"/>
  <text x="300" y="380" text-anchor="middle" font-size="96" fill="#FFFFFF">光</text>
  <text x="300" y="450" text-anchor="middle" font-size="22" fill="#E9DEFB">副标题一行</text>
  <text x="300" y="492" text-anchor="middle" font-size="16" fill="#D8C9F7">再一行说明</text>
</svg>`;

/** 中性灰、左栏 + 数据行：真实产品的常见长相。 */
const NEUTRAL_APP = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
  <rect width="600" height="800" fill="#FFFFFF"/>
  <rect width="180" height="800" fill="#F2F2F5"/>
  ${Array.from({ length: 14 }, (_, i) => `<text x="16" y="${40 + i * 34}" font-size="13" fill="#3A3A40">菜单项 ${i + 1}</text>`).join("\n  ")}
  ${Array.from({ length: 18 }, (_, i) => `<text x="204" y="${44 + i * 40}" font-size="13" fill="#2B2B30">第 ${i + 1} 行数据 · 状态正常 · 更新时间 09:${String(i).padStart(2, "0")}</text>`).join("\n  ")}
  ${Array.from({ length: 18 }, () => `<line x1="196" y1="0" x2="196" y2="0" stroke="#E3E3E8"/>`).join("")}
</svg>`;

/** renderSvg 是异步的（写成同步会拿到不存在的文件） */
async function png(dir, name, svg) {
  const out = join(dir, name);
  await renderSvg({ svg, png: out, width: 600 });
  return out;
}

test("位图 AI 味：紫蓝渐变海报命中，中性灰密集界面不命中", { skip }, async (t) => {
  const dir = tempDir(t, "taste-img");
  const ai = await tasteImage(await png(dir, "ai.png", INDIGO_POSTER));
  const real = await tasteImage(await png(dir, "real.png", NEUTRAL_APP));

  assert.ok(ai.score >= 40, `紫蓝渐变海报应高分，实际 ${ai.score}`);
  assert.ok(
    ai.metrics.some((m) => m.id === "img-indigo-hue" && m.score > 0),
    `应命中 img-indigo-hue，实际 ${JSON.stringify(ai.metrics.map((m) => m.id))}`
  );
  assert.equal(ai.kind, "image");
  assert.ok(ai.actions.length > 0, "命中的判据应带可执行 fix");
  for (const a of ai.actions) assert.ok(typeof a.fix === "string" && a.fix.length > 8, `${a.rule}: fix 必须可执行`);

  assert.ok(real.score < 20, `中性灰界面不应被判成 AI，实际 ${real.score}`);
  assert.equal(real.metrics.length, 0, `中性灰界面不该有任何命中，实际 ${JSON.stringify(real.metrics)}`);
});

test("位图 AI 味：原始量值随结果回报（校准与解释都要靠它）", { skip }, async (t) => {
  const dir = tempDir(t, "taste-img-raw");
  const ai = await tasteImage(await png(dir, "ai.png", INDIGO_POSTER));
  assert.equal(typeof ai.raw.indigoShare, "number");
  assert.equal(typeof ai.raw.rampRegions, "number");
  assert.ok(ai.raw.indigoShare > 0.5, `紫蓝海报的紫蓝占比应很高，实际 ${ai.raw.indigoShare}`);
  assert.equal(ai.image.width, 600);
  assert.ok(ai.image.height >= 800, "高度应来自 PNG 的 IHDR");
});

test("位图 AI 味：同一张图两次结果完全一致（无随机、无采样漂移）", { skip }, async (t) => {
  const dir = tempDir(t, "taste-img-det");
  const file = await png(dir, "ai.png", INDIGO_POSTER);
  const a = await tasteImage(file);
  const b = await tasteImage(file);
  assert.equal(a.score, b.score);
  assert.deepEqual(a.raw, b.raw);
});

/** 中性灰 + 三个等宽白卡：看起来就像“三件套”，但没有任何 AI 像素指纹。 */
const TRIO_CARDS = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <rect width="600" height="400" fill="#F4F4F6"/>
  ${[0, 1, 2].map((i) => `<rect x="${24 + i * 190}" y="80" width="170" height="200" rx="10" fill="#FFFFFF"/>`).join("\n  ")}
  ${[0, 1, 2].map((i) => `<text x="${40 + i * 190}" y="130" font-size="13" fill="#33333A">场景 ${i + 1}</text>`).join("\n  ")}
</svg>`;

test("位图 AI 味：同构三卡片只量不判——中性灰的三卡片不得被当成 AI 味", { skip }, async (t) => {
	// 实测教训（2026-11-08）：用“同一行 3 个等宽卡片”做判据时，我们自己做的
	// 苹果风界面（3 个数据卡）当场被判 0.8。分不开就不报，只把事实交出去。
	const dir = tempDir(t, "taste-img-trio");
	const r = await tasteImage(await png(dir, "trio.png", TRIO_CARDS));
	assert.equal(r.score, 0, `中性灰三卡片不应得分，实际 ${r.score}`);
	assert.equal(r.raw.cardGrid.maxPerRow, 3, "应能量出三列");
	assert.equal(r.raw.cardGrid.equalWidth, true, "应能量出等宽");
});

test("图片格式：只靠文件头就能认出 JPEG / WebP / PNG 并拿到尺寸", { skip }, () => {
  // 造最小头部：省得为了测试去蹭本机图片
  // SOI + 空 APP0（长度字段只算自身 2 字节）+ SOF0(h=600 w=1000)
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0xe8]);
  assert.deepEqual(imageSize(jpeg), { format: "jpeg", width: 1000, height: 600 });

  const webp = Buffer.alloc(30);
  webp.write("RIFF", 0, "ascii"); webp.write("WEBP", 8, "ascii"); webp.write("VP8X", 12, "ascii");
  webp[24] = 0x3f; webp[25] = 0x03; webp[26] = 0x00; // w = 0x33f + 1 = 832
  webp[27] = 0x7f; webp[28] = 0x04; webp[29] = 0x00; // h = 0x47f + 1 = 1152
  assert.deepEqual(imageSize(webp), { format: "webp", width: 832, height: 1152 });

});

test("图片格式：既不是 PNG/JPEG/WebP 时报错清晰，不静默降级", { skip }, async (t) => {
  const dir = tempDir(t, "taste-img-bad");
  const bogus = join(dir, "x.jpg");
  writeFileSync(bogus, "not an image", "utf8");
  await rejects(() => tasteImage(bogus), /不是可识别的|读不到尺寸/, "损坏图片应明确报错");
});

test("图片格式：扩展名与内容不一致时，按内容处理而不是按扩展名拒绝", { skip }, async (t) => {
  const dir = tempDir(t, "img-mismatch");
  const ai = await png(dir, "ai.png", INDIGO_POSTER);
  const disguised = join(dir, "ai-as.jpg");
  writeFileSync(disguised, readFileSync(ai));
  const r = await tasteImage(disguised);
  assert.ok(r.score >= 40, `应按内容当 PNG 处理，实际 ${r.score}`);
});

test("工具层：taste_check 能直接收 .png，输出 kind=image 且无 undefined", { skip }, async (t) => {
  const dir = tempDir(t, "taste-img-tool");
  const file = await png(dir, "ai.png", INDIGO_POSTER);
  const { value, text } = await call("taste_check", { action: "taste", root: file });
  assert.equal(value.kind, "image");
  assert.equal(value.image.file, "ai.png");
  assert.ok(value.score >= 40);
  assert.ok(text.includes("taste:image"), `文本应标明是位图模式，实际：${text.slice(0, 80)}`);
  assert.equal(/undefined|"NaN"/.test(JSON.stringify(value)), false, "输出不得带 undefined/NaN");
});
