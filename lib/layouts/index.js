/**
 * layouts/index.js — 排版体检三模式的门面。
 *   auditSource(root)           UI 源码（HTML/CSS/Vue/JSX）
 *   auditSvg(markup, {name})    成品 SVG 的文字几何
 *   auditImage(buffer, {name})  渲染后的 PNG 构图
 * 三者返回同一形状（common.js finalize），可同尺度比较与统一渲染。
 */
export { auditSource } from "./source.js";
export { auditSvg } from "./svg.js";
export { auditImage } from "./image.js";
