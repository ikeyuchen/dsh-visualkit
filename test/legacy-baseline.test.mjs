// test/legacy-baseline.test.mjs — 旧版源码作为「排版体系未变」的阴性基线。
//
// 语料：同一产品的 0.4 → 0.5.4 共 7 个历史版本（单文件 HTML）。**不入库**（是用户的产品源码）。
// 路径来自本机未提交的配置（仓库根 .selfcheck.local.json，格式见 tools/selfcheck.mjs 文件头）：
//
//   {
//     "legacyBaseline": {
//       "dir": "<语料目录>",
//       "files": { "legacy-0.4": "<本机实际文件名>.html" }
//     }
//   }
//
// 目录也可用环境变量 VISUALKIT_LEGACY_CORPUS 覆盖；files 可省略（省略时按 "<键名>.html" 找）。
// 目录不存在时整组跳过。
//
// 为什么值得当基线：这 7 个版本的 <style> 里 font-size 集合完全相同——功能在长、
// 排版体系没动。所以它们的分数应该**逐字稳定**。任何工具改动只要让这些数字跳动，
// 就说明改的是判据的稳定性（通常意味着引入了新的误报/漏报），而不是改进了判据。
//
// 基线数字来自 2026-11-08 实测，随判据有意变更时同步刷新（并在 CHANGELOG 写明原因）。
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { auditSource } from "../lib/layouts/source.js";
import { taste } from "../lib/taste.js";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

/** 本机语料配置（不入库）；格式见 tools/selfcheck.mjs 文件头。 */
function localConfig() {
  const file = join(REPO, ".selfcheck.local.json");
  if (existsSync(file) === false) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const local = localConfig()?.legacyBaseline ?? {};
const DIR = process.env.VISUALKIT_LEGACY_CORPUS || local.dir || null;
/** 中性键名 → 本机实际文件名；配置里没映射时按 "<键名>.html" 找。 */
const fileOf = (name) => join(DIR ?? "", local.files?.[name] ?? `${name}.html`);
const skip = DIR === null || existsSync(DIR) === false ? "本机没有旧版语料目录（可选）" : false;
const BASELINE = [
  { name: "legacy-0.4", taste: 27, layout: 29, fontSizes: 11, body: 14 },
  { name: "legacy-0.5", taste: 27, layout: 31, fontSizes: 11, body: 14 },
  { name: "legacy-0.5.1", taste: 27, layout: 31, fontSizes: 11, body: 14 },
  { name: "legacy-0.5.2", taste: 27, layout: 31, fontSizes: 11, body: 14 },
  { name: "legacy-0.5.3", taste: 27, layout: 31, fontSizes: 11, body: 14 },
  { name: "legacy-0.5.3_commented", taste: 27, layout: 31, fontSizes: 11, body: 14 },
  { name: "legacy-0.5.4", taste: 27, layout: 31, fontSizes: 11, body: 14 }
];

test("旧版基线：7 个版本的分数必须逐字稳定（排版体系没变，分数就不该动）", { skip }, async () => {
  for (const row of BASELINE) {
    const path = fileOf(row.name);
    if (existsSync(path) === false) continue;
    const t = await taste(path, {});
    const l = await auditSource(path);
    assert.equal(t.score, row.taste, `${row.name}: AI 味分变了（${row.taste} → ${t.score}）——先确认是改进了判据还是引入了新误报`);
    assert.equal(l.score, row.layout, `${row.name}: 排版分变了（${row.layout} → ${l.score}）`);
    assert.equal((l.metrics.fontSizes ?? []).length, row.fontSizes, `${row.name}: 字号档数变了`);
    assert.equal(l.metrics.bodySize, row.body, `${row.name}: 正文字号变了`);
  }
});

const LAST = fileOf("legacy-0.5.4");
const skipLast = skip === false && existsSync(LAST) === false ? "本机没有 0.5.4 语料文件（可选）" : skip;

test("旧版基线：emoji 命中必须是真命中（旧版界面确实拿 emoji 当图标）", { skip: skipLast }, async () => {
  // 与现版 colibri 形成对照：现版 40 个命中里 36 个在注释里（误报），
  // 旧版 31 个全在非注释区（真命中）。这条守住「剥注释」这一步没被改坏。
  const t = await taste(LAST, {});
  const emoji = t.metrics.find((m) => m.id === "emoji-icon");
  assert.ok(emoji !== undefined, "旧版界面拿 emoji 当图标，必须命中 emoji-icon");
  assert.ok(emoji.note.includes("emoji"), `note 应说明 emoji 数量：${emoji.note}`);
});
