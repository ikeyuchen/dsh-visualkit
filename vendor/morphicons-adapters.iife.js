/*!
 * morphicons adapters v2.0.2（svgToIcon + fitIcon）— vendored 产物（非手写）
 * License: MIT © Guillermo (guillermolg.com)
 * 构建（2026-11-07）：
 *   npm install morphicons@2.0.2 esbuild
 *   entry.mjs: export { svgToIcon, canvasTarget, maskTarget } from "morphicons/adapters"; export { fitIcon } from "morphicons";
 *   npx esbuild entry.mjs --bundle --format=iife --global-name=MorphIconsAdapters --outfile=vendor/morphicons-adapters.iife.js
 * 说明：2.0 把 fitIcon 移到核心导出，adapters 子路径只有 svgToIcon/canvasTarget/maskTarget；
 * 为保持 uilab 侧「adapters = svgToIcon + fitIcon」的既有装载契约，entry 里一并再导出 fitIcon。
 */
var MorphIconsAdapters = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // adapters-entry.mjs
  var adapters_entry_exports = {};
  __export(adapters_entry_exports, {
    canvasTarget: () => canvasTarget,
    fitIcon: () => fitIcon,
    maskTarget: () => maskTarget,
    svgToIcon: () => svgToIcon
  });

  // node_modules/morphicons/dist/normalize-CYnN3Npw.js
  var COMMANDS = "MmLlHhVvCcSsQqTtAaZz";
  function parsePath(d) {
    const subs = [];
    const n = d.length;
    let i = 0;
    let cx = 0;
    let cy = 0;
    let sx = 0;
    let sy = 0;
    let cur = null;
    let cmd = "";
    let px = 0;
    let py = 0;
    let prev = "";
    let started = false;
    const err = (msg) => {
      throw new Error(`morphicons: ${msg} at d[${i}]`);
    };
    const isDigit = (c) => c >= 48 && c <= 57;
    const skip = () => {
      while (i < n) {
        const c = d.charCodeAt(i);
        if (c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 44) i++;
        else break;
      }
    };
    const num = () => {
      skip();
      const start = i;
      if (i < n && (d[i] === "+" || d[i] === "-")) i++;
      let dig = false;
      while (i < n && isDigit(d.charCodeAt(i))) {
        i++;
        dig = true;
      }
      if (i < n && d[i] === ".") {
        i++;
        while (i < n && isDigit(d.charCodeAt(i))) {
          i++;
          dig = true;
        }
      }
      if (!dig) err("expected number");
      if (i < n && (d[i] === "e" || d[i] === "E")) {
        const save = i;
        i++;
        if (i < n && (d[i] === "+" || d[i] === "-")) i++;
        let ed = false;
        while (i < n && isDigit(d.charCodeAt(i))) {
          i++;
          ed = true;
        }
        if (!ed) i = save;
      }
      return Number(d.slice(start, i));
    };
    const flag = () => {
      skip();
      const c = d[i];
      if (c === "0" || c === "1") {
        i++;
        return c === "1" ? 1 : 0;
      }
      return err("expected arc flag (0|1)");
    };
    const open = () => {
      if (!started) err("path must start with M/m");
      if (!cur) {
        cur = {
          x0: cx,
          y0: cy,
          segs: [],
          closed: false
        };
        subs.push(cur);
      }
      return cur;
    };
    let rel = false;
    const nx = () => num() + (rel ? cx : 0);
    const ny = () => num() + (rel ? cy : 0);
    while (true) {
      skip();
      if (i >= n) break;
      const ch = d[i];
      if (COMMANDS.includes(ch)) {
        cmd = ch;
        i++;
      } else if (cmd === "") err("path must start with M/m");
      else if (cmd === "M") cmd = "L";
      else if (cmd === "m") cmd = "l";
      else if (cmd === "Z" || cmd === "z") err("stray data after Z");
      rel = cmd >= "a";
      switch (rel ? cmd.toUpperCase() : cmd) {
        case "M": {
          started = true;
          const x = nx();
          const y = ny();
          cx = x;
          cy = y;
          sx = x;
          sy = y;
          cur = {
            x0: x,
            y0: y,
            segs: [],
            closed: false
          };
          subs.push(cur);
          prev = "";
          break;
        }
        case "L": {
          const x = nx();
          const y = ny();
          open().segs.push([
            "L",
            x,
            y
          ]);
          cx = x;
          cy = y;
          prev = "";
          break;
        }
        case "H": {
          const x = nx();
          open().segs.push([
            "L",
            x,
            cy
          ]);
          cx = x;
          prev = "";
          break;
        }
        case "V": {
          const y = ny();
          open().segs.push([
            "L",
            cx,
            y
          ]);
          cy = y;
          prev = "";
          break;
        }
        case "C":
        case "S": {
          let x1;
          let y1;
          if (cmd === "C" || cmd === "c") {
            x1 = nx();
            y1 = ny();
          } else {
            x1 = prev === "C" ? 2 * cx - px : cx;
            y1 = prev === "C" ? 2 * cy - py : cy;
          }
          const x2 = nx();
          const y2 = ny();
          const x = nx();
          const y = ny();
          open().segs.push([
            "C",
            x1,
            y1,
            x2,
            y2,
            x,
            y
          ]);
          px = x2;
          py = y2;
          cx = x;
          cy = y;
          prev = "C";
          break;
        }
        case "Q":
        case "T": {
          let x1;
          let y1;
          if (cmd === "Q" || cmd === "q") {
            x1 = nx();
            y1 = ny();
          } else {
            x1 = prev === "Q" ? 2 * cx - px : cx;
            y1 = prev === "Q" ? 2 * cy - py : cy;
          }
          const x = nx();
          const y = ny();
          open().segs.push([
            "Q",
            x1,
            y1,
            x,
            y
          ]);
          px = x1;
          py = y1;
          cx = x;
          cy = y;
          prev = "Q";
          break;
        }
        case "A": {
          const rx = num();
          const ry = num();
          const rot = num();
          const large = flag();
          const sweep = flag();
          const x = nx();
          const y = ny();
          open().segs.push([
            "A",
            rx,
            ry,
            rot,
            large,
            sweep,
            x,
            y
          ]);
          cx = x;
          cy = y;
          prev = "";
          break;
        }
        case "Z":
          if (cur) {
            cur.closed = true;
            cur = null;
          }
          cx = sx;
          cy = sy;
          prev = "";
          break;
        default:
          err(`unsupported command "${cmd}"`);
      }
    }
    return subs.filter((s) => s.segs.length > 0);
  }
  function fmtCanon(v) {
    return String(Math.round(v * 1e4) / 1e4);
  }
  function cubicsToPathD(paths) {
    let d = "";
    for (const { pts, closed } of paths) {
      d += `M${fmtCanon(pts[0])} ${fmtCanon(pts[1])}`;
      for (let i = 2; i < pts.length; i += 6) d += `C${fmtCanon(pts[i])} ${fmtCanon(pts[i + 1])} ${fmtCanon(pts[i + 2])} ${fmtCanon(pts[i + 3])} ${fmtCanon(pts[i + 4])} ${fmtCanon(pts[i + 5])}`;
      if (closed) d += "Z";
    }
    return d;
  }
  var KAPPA = 4 / 3 * Math.tan(Math.PI / 8);
  var TAU = 2 * Math.PI;
  function builder(x0, y0) {
    const pts = [x0, y0];
    let cx = x0;
    let cy = y0;
    const cubic = (x1, y1, x2, y2, x, y) => {
      pts.push(x1, y1, x2, y2, x, y);
      cx = x;
      cy = y;
    };
    const line = (x, y) => {
      if (Math.abs(x - cx) < 1e-12 && Math.abs(y - cy) < 1e-12) return;
      cubic(cx + (x - cx) / 3, cy + (y - cy) / 3, cx + 2 * (x - cx) / 3, cy + 2 * (y - cy) / 3, x, y);
    };
    const quad = (x1, y1, x, y) => {
      cubic(cx + 2 / 3 * (x1 - cx), cy + 2 / 3 * (y1 - cy), x + 2 / 3 * (x1 - x), y + 2 / 3 * (y1 - y), x, y);
    };
    const arc = (rx0, ry0, rotDeg, large, sweep, x, y) => {
      const x1 = cx;
      const y1 = cy;
      if (Math.abs(x - x1) < 1e-12 && Math.abs(y - y1) < 1e-12) return;
      let rx = Math.abs(rx0);
      let ry = Math.abs(ry0);
      if (rx < 1e-12 || ry < 1e-12) {
        line(x, y);
        return;
      }
      const phi = rotDeg * Math.PI / 180;
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);
      const hx = (x1 - x) / 2;
      const hy = (y1 - y) / 2;
      const x1p = cosP * hx + sinP * hy;
      const y1p = -sinP * hx + cosP * hy;
      const lam = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
      if (lam > 1) {
        const s = Math.sqrt(lam);
        rx *= s;
        ry *= s;
      }
      const rx2 = rx * rx;
      const ry2 = ry * ry;
      const xp2 = x1p * x1p;
      const yp2 = y1p * y1p;
      let rad = (rx2 * ry2 - rx2 * yp2 - ry2 * xp2) / (rx2 * yp2 + ry2 * xp2);
      if (rad < 0) rad = 0;
      const co = (large === sweep ? -1 : 1) * Math.sqrt(rad);
      const cxp = co * rx * y1p / ry;
      const cyp = -co * ry * x1p / rx;
      const ccx = cosP * cxp - sinP * cyp + (x1 + x) / 2;
      const ccy = sinP * cxp + cosP * cyp + (y1 + y) / 2;
      const th1 = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx);
      let dth = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx) - th1;
      if (sweep === 0 && dth > 0) dth -= TAU;
      else if (sweep === 1 && dth < 0) dth += TAU;
      const slices = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9));
      const delta = dth / slices;
      const alpha = 4 / 3 * Math.tan(delta / 4);
      const ex = (t) => ccx + rx * Math.cos(t) * cosP - ry * Math.sin(t) * sinP;
      const ey = (t) => ccy + rx * Math.cos(t) * sinP + ry * Math.sin(t) * cosP;
      const dx = (t) => -rx * Math.sin(t) * cosP - ry * Math.cos(t) * sinP;
      const dy = (t) => -rx * Math.sin(t) * sinP + ry * Math.cos(t) * cosP;
      let t0 = th1;
      let p0x = x1;
      let p0y = y1;
      for (let s = 1; s <= slices; s++) {
        const t1 = th1 + delta * s;
        const p1x = s === slices ? x : ex(t1);
        const p1y = s === slices ? y : ey(t1);
        cubic(p0x + alpha * dx(t0), p0y + alpha * dy(t0), p1x - alpha * dx(t1), p1y - alpha * dy(t1), p1x, p1y);
        t0 = t1;
        p0x = p1x;
        p0y = p1y;
      }
    };
    const finish = (closed) => {
      if (closed) line(pts[0], pts[1]);
      if (pts.length < 8) return null;
      return {
        pts: Float64Array.from(pts),
        closed
      };
    };
    return [
      cubic,
      line,
      quad,
      arc,
      finish
    ];
  }
  function lowerSubpath(raw) {
    const [cubic, line, quad, arc, finish] = builder(raw.x0, raw.y0);
    for (const s of raw.segs) switch (s[0]) {
      case "L":
        line(s[1], s[2]);
        break;
      case "C":
        cubic(s[1], s[2], s[3], s[4], s[5], s[6]);
        break;
      case "Q":
        quad(s[1], s[2], s[3], s[4]);
        break;
      case "A":
        arc(s[1], s[2], s[3], s[4], s[5], s[6], s[7]);
    }
    return finish(raw.closed);
  }
  function attrNum(attrs, key, fallback = 0) {
    const v = attrs[key];
    if (v === void 0) return fallback;
    const x = typeof v === "number" ? v : Number(v);
    return Number.isFinite(x) ? x : fallback;
  }
  function parsePoints(v) {
    const s = String(v ?? "").trim();
    if (!s) return [];
    const nums = s.split(/[\s,]+/).map(Number);
    if (nums.some((x) => !Number.isFinite(x))) throw new Error(`morphicons: invalid points: "${s}"`);
    return nums;
  }
  function polyPath(nums, closed) {
    if (nums.length < 4) return null;
    const [, line, , , finish] = builder(nums[0], nums[1]);
    for (let i = 2; i + 1 < nums.length; i += 2) line(nums[i], nums[i + 1]);
    return finish(closed);
  }
  function ellipsePath(cx, cy, rx, ry) {
    if (rx < 1e-12 || ry < 1e-12) return null;
    const kx = KAPPA * rx;
    const ky = KAPPA * ry;
    const e = cx + rx;
    const w = cx - rx;
    const s = cy + ry;
    const n = cy - ry;
    const [cubic, , , , finish] = builder(e, cy);
    cubic(e, cy + ky, cx + kx, s, cx, s);
    cubic(cx - kx, s, w, cy + ky, w, cy);
    cubic(w, cy - ky, cx - kx, n, cx, n);
    cubic(cx + kx, n, e, cy - ky, e, cy);
    return finish(true);
  }
  function rectPath(attrs) {
    const x = attrNum(attrs, "x");
    const y = attrNum(attrs, "y");
    const w = attrNum(attrs, "width");
    const h = attrNum(attrs, "height");
    if (w < 1e-12 || h < 1e-12) return null;
    let rx = attrNum(attrs, "rx", NaN);
    let ry = attrNum(attrs, "ry", NaN);
    if (Number.isNaN(rx)) rx = Number.isNaN(ry) ? 0 : ry;
    if (Number.isNaN(ry)) ry = rx;
    rx = Math.min(Math.max(rx, 0), w / 2);
    ry = Math.min(Math.max(ry, 0), h / 2);
    if (rx < 1e-12 || ry < 1e-12) return polyPath([
      x,
      y,
      x + w,
      y,
      x + w,
      y + h,
      x,
      y + h
    ], true);
    const xa = x + rx;
    const xb = x + w - rx;
    const xr = x + w;
    const ya = y + ry;
    const yb = y + h - ry;
    const yd = y + h;
    const kx = KAPPA * rx;
    const ky = KAPPA * ry;
    const [cubic, line, , , finish] = builder(xa, y);
    line(xb, y);
    cubic(xb + kx, y, xr, ya - ky, xr, ya);
    line(xr, yb);
    cubic(xr, yb + ky, xb + kx, yd, xb, yd);
    line(xa, yd);
    cubic(xa - kx, yd, x, yb + ky, x, yb);
    line(x, ya);
    cubic(x, ya - ky, xa - kx, y, xa, y);
    return finish(true);
  }
  function iconToCubics(input) {
    const out = [];
    const push = (p) => {
      if (p) out.push(p);
    };
    if (typeof input === "string") {
      for (const s of parsePath(input)) push(lowerSubpath(s));
      return out;
    }
    for (const [tag, attrs] of input) switch (tag) {
      case "path":
        for (const s of parsePath(String(attrs.d ?? ""))) push(lowerSubpath(s));
        break;
      case "line": {
        const [, line, , , finish] = builder(attrNum(attrs, "x1"), attrNum(attrs, "y1"));
        line(attrNum(attrs, "x2"), attrNum(attrs, "y2"));
        push(finish(false));
        break;
      }
      case "circle": {
        const r = attrNum(attrs, "r");
        push(ellipsePath(attrNum(attrs, "cx"), attrNum(attrs, "cy"), r, r));
        break;
      }
      case "ellipse":
        push(ellipsePath(attrNum(attrs, "cx"), attrNum(attrs, "cy"), attrNum(attrs, "rx"), attrNum(attrs, "ry")));
        break;
      case "rect":
        push(rectPath(attrs));
        break;
      case "polyline":
        push(polyPath(parsePoints(attrs.points), false));
        break;
      case "polygon":
        push(polyPath(parsePoints(attrs.points), true));
        break;
      default:
        throw new Error(`morphicons: unsupported tag <${tag}>`);
    }
    return out;
  }
  function parseViewBox(vb) {
    const v = typeof vb === "number" ? [
      0,
      0,
      vb,
      vb
    ] : typeof vb === "string" ? vb.trim().split(/[\s,]+/).map(Number) : vb;
    const [minX, minY, w, h] = v;
    if (v.length !== 4 || !(w > 0) || !(h > 0) || !Number.isFinite(minX) || !Number.isFinite(minY)) throw new Error(`morphicons: invalid viewBox "${String(vb)}"`);
    return [
      minX,
      minY,
      w,
      h
    ];
  }
  function fitIcon(input, viewBox, grid = 24) {
    const [minX, minY, w, h] = parseViewBox(viewBox);
    const s = Math.min(grid / w, grid / h);
    const tx = (grid - w * s) / 2 - minX * s;
    const ty = (grid - h * s) / 2 - minY * s;
    const paths = iconToCubics(input);
    for (const { pts } of paths) for (let i = 0; i < pts.length; i += 2) {
      pts[i] = pts[i] * s + tx;
      pts[i + 1] = pts[i + 1] * s + ty;
    }
    return cubicsToPathD(paths);
  }

  // node_modules/morphicons/dist/adapters.js
  function canvasTarget(surface, opts = {}) {
    if (typeof Path2D === "undefined") throw new Error("morphicons: canvasTarget needs Path2D (browser or worker)");
    const ctx = "getContext" in surface ? surface.getContext("2d") : surface;
    if (!ctx) throw new Error("morphicons: canvasTarget needs a 2D context");
    const vb = (opts.viewBox ?? "0 0 24 24").trim().split(/[\s,]+/).map(Number);
    const [mx, my, vw, vh] = [
      vb[0] || 0,
      vb[1] || 0,
      vb[2] || 24,
      vb[3] || vb[2] || 24
    ];
    const stroke = opts.strokeWidth ?? 2;
    const clear = opts.clear !== false;
    let color = opts.color;
    let cssPending = color === void 0 && "style" in ctx.canvas;
    return { setAttribute(name, value) {
      if (name !== "d") return;
      if (cssPending) {
        cssPending = false;
        color = getComputedStyle?.(ctx.canvas).color || void 0;
      }
      const c = ctx.canvas;
      const s = Math.min(c.width / vw, c.height / vh);
      if (clear) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, c.width, c.height);
      }
      ctx.setTransform(s, 0, 0, s, (c.width - vw * s) / 2 - mx * s, (c.height - vh * s) / 2 - my * s);
      ctx.lineWidth = stroke;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (color !== void 0) ctx.strokeStyle = color;
      ctx.stroke(new Path2D(value));
      opts.onWrite?.();
    } };
  }
  var SVG_NS = "http://www.w3.org/2000/svg";
  var seq = 0;
  var host = null;
  function maskTarget(el, opts = {}) {
    if (typeof document === "undefined") throw new Error("morphicons: maskTarget needs a DOM (client-side only)");
    const doc = document;
    if (!host) {
      host = doc.createElementNS(SVG_NS, "svg");
      host.setAttribute("width", "0");
      host.setAttribute("height", "0");
      host.setAttribute("aria-hidden", "true");
      host.setAttribute("style", "position:absolute");
      doc.body.appendChild(host);
    }
    const vb = (opts.viewBox ?? "0 0 24 24").trim().split(/[\s,]+/).map(Number);
    const [mx, my, w, h] = [
      vb[0] || 0,
      vb[1] || 0,
      vb[2] || 24,
      vb[3] || vb[2] || 24
    ];
    const makeLayer = () => {
      const id = `morphicons-mask-${++seq}`;
      const mask = doc.createElementNS(SVG_NS, "mask");
      mask.setAttribute("id", id);
      mask.setAttribute("maskContentUnits", "objectBoundingBox");
      const g = doc.createElementNS(SVG_NS, "g");
      g.setAttribute("transform", `scale(${1 / w} ${1 / h}) translate(${-mx} ${-my})`);
      const path = doc.createElementNS(SVG_NS, "path");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "#fff");
      path.setAttribute("stroke-width", String(opts.strokeWidth ?? 2));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      g.appendChild(path);
      mask.appendChild(g);
      if (host) host.appendChild(mask);
      return {
        url: `url(#${id})`,
        mask,
        path
      };
    };
    const layers = [makeLayer(), makeLayer()];
    let front = 0;
    const s = el.style;
    s.maskImage = s.webkitMaskImage = layers[0].url;
    if (opts.paint !== false) s.backgroundColor = "currentColor";
    return {
      setAttribute(name, d) {
        if (name !== "d") return;
        front = 1 - front;
        const layer = layers[front];
        layer.path.setAttribute("d", d);
        s.maskImage = s.webkitMaskImage = layer.url;
      },
      dispose() {
        layers[0].mask.remove();
        layers[1].mask.remove();
      }
    };
  }
  var SVG_CONTAINER = /<(defs|mask|clipPath|symbol)\b[^>]*>[\s\S]*?<\/\1>/gi;
  var SVG_TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  var SVG_ATTR = /([\w:-]+)\s*=\s*"([^"]*)"|([\w:-]+)\s*=\s*'([^']*)'/g;
  var SVG_VIEWBOX = /<svg\b[^>]*\bviewBox\s*=\s*["']([^"']+)["']/i;
  var SVG_GEOMETRY = /* @__PURE__ */ new Set([
    "path",
    "line",
    "circle",
    "ellipse",
    "rect",
    "polyline",
    "polygon"
  ]);
  var SVG_GROUP = /* @__PURE__ */ new Set([
    "svg",
    "g",
    "a"
  ]);
  var SVG_SKIP = /* @__PURE__ */ new Set([
    "title",
    "desc",
    "defs",
    "mask",
    "clippath",
    "symbol"
  ]);
  var PAINT = [
    "fill",
    "stroke",
    "stroke-width",
    "fill-rule",
    "opacity",
    "fill-opacity",
    "visibility",
    "display"
  ];
  function readSvgAttrs(raw) {
    const attrs = {};
    SVG_ATTR.lastIndex = 0;
    let m;
    while ((m = SVG_ATTR.exec(raw)) !== null) {
      const name = m[1] ?? m[3];
      if (name) attrs[name] = m[2] ?? m[4] ?? "";
    }
    return attrs;
  }
  function paintOf(parent, attrs) {
    const out = { ...parent };
    for (const k of PAINT) if (attrs[k] !== void 0) out[k] = String(attrs[k]);
    for (const decl of String(attrs.style ?? "").split(";")) {
      const i = decl.indexOf(":");
      const k = decl.slice(0, i).trim().toLowerCase();
      if (i > 0 && PAINT.includes(k)) out[k] = decl.slice(i + 1).trim();
    }
    return out;
  }
  var mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ];
  function parseTransform(v) {
    const s = String(v ?? "").trim();
    if (!s) return null;
    let m = [
      1,
      0,
      0,
      1,
      0,
      0
    ];
    for (const [, fn, args] of s.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
      const a = args.trim().split(/[\s,]+/).map(Number);
      const rad = (a[0] ?? 0) * Math.PI / 180;
      let t;
      switch (fn) {
        case "matrix":
          t = [
            a[0],
            a[1],
            a[2],
            a[3],
            a[4],
            a[5]
          ];
          break;
        case "translate":
          t = [
            1,
            0,
            0,
            1,
            a[0],
            a[1] ?? 0
          ];
          break;
        case "scale":
          t = [
            a[0],
            0,
            0,
            a[1] ?? a[0],
            0,
            0
          ];
          break;
        case "rotate": {
          const c = Math.cos(rad);
          const n = Math.sin(rad);
          const [cx = 0, cy = 0] = [a[1], a[2]];
          t = [
            c,
            n,
            -n,
            c,
            cx - c * cx + n * cy,
            cy - n * cx - c * cy
          ];
          break;
        }
        case "skewX":
          t = [
            1,
            0,
            Math.tan(rad),
            1,
            0,
            0
          ];
          break;
        case "skewY":
          t = [
            1,
            Math.tan(rad),
            0,
            1,
            0,
            0
          ];
          break;
        default:
          throw new Error(`morphicons: unsupported transform "${fn}"`);
      }
      if (t.some((x) => !Number.isFinite(x))) throw new Error(`morphicons: invalid transform "${s}"`);
      m = mul(m, t);
    }
    return m;
  }
  function bake(tag, attrs, m) {
    const paths = iconToCubics([[tag, attrs]]);
    for (const { pts } of paths) for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i];
      const y = pts[i + 1];
      pts[i] = m[0] * x + m[2] * y + m[4];
      pts[i + 1] = m[1] * x + m[3] * y + m[5];
    }
    return cubicsToPathD(paths);
  }
  function stripComments(markup) {
    let out = markup;
    let prev;
    do {
      prev = out;
      out = out.replace(/<!--[\s\S]*?-->/g, "");
    } while (out !== prev);
    const open = out.indexOf("<!--");
    return open === -1 ? out : out.slice(0, open);
  }
  var painted = (v) => v !== void 0 && v.trim().toLowerCase() !== "none";
  function svgToIcon(markup) {
    if (markup.trimStart().charCodeAt(0) !== 60) throw new Error("morphicons: svgToIcon expects SVG markup \u2014 a d string or IconNode is already an IconInput");
    const clean = stripComments(markup);
    if (/<style\b/i.test(clean)) throw new Error("morphicons: unsupported SVG element <style>");
    const body = clean.replace(SVG_CONTAINER, "");
    const found = [];
    const stack = [{
      paint: {},
      m: null
    }];
    SVG_TAG.lastIndex = 0;
    let mt;
    while ((mt = SVG_TAG.exec(body)) !== null) {
      const tag = mt[2].toLowerCase();
      const top = stack[stack.length - 1];
      if (mt[1]) {
        if (SVG_GROUP.has(tag) && stack.length > 1) stack.pop();
        continue;
      }
      if (SVG_SKIP.has(tag)) continue;
      const attrs = readSvgAttrs(mt[3]);
      const own = parseTransform(attrs.transform);
      const m = own ? top.m ? mul(top.m, own) : own : top.m;
      const paint = paintOf(top.paint, attrs);
      if (top.paint.display === "none") paint.display = "none";
      if (SVG_GROUP.has(tag)) {
        if (!mt[4]) stack.push({
          paint,
          m
        });
        continue;
      }
      if (!SVG_GEOMETRY.has(tag)) throw new Error(`morphicons: unsupported SVG element <${tag}>`);
      if (paint.display === "none" || /^(hidden|collapse)$/.test(paint.visibility ?? "")) continue;
      found.push({
        tag,
        attrs,
        paint,
        m
      });
    }
    if (found.length === 0) throw new Error("morphicons: no morphable geometry in SVG");
    const fills = found.map(({ paint }) => paint.fill !== void 0 ? painted(paint.fill) : !painted(paint.stroke));
    const vb = SVG_VIEWBOX.exec(clean);
    if (!fills.some(Boolean)) {
      const node = found.map(({ tag, attrs, m }) => {
        if (!m) return [tag, attrs];
        const { transform: _, ...rest } = attrs;
        return ["path", {
          ...rest,
          d: bake(tag, attrs, m)
        }];
      });
      return vb ? fitIcon(node, vb[1]) : node;
    }
    let scale = 1;
    if (vb) {
      const [, , w, h] = vb[1].trim().split(/[\s,]+/).map(Number);
      scale = Math.min(24 / w, 24 / h);
    }
    return found.map(({ tag, attrs, paint, m }, i) => {
      const d = m ? bake(tag, attrs, m) : tag === "path" ? String(attrs.d ?? "") : bake(tag, attrs, [
        1,
        0,
        0,
        1,
        0,
        0
      ]);
      const out = {
        d: vb ? fitIcon(d, vb[1]) : d,
        fill: fills[i] ? "currentColor" : "none",
        stroke: painted(paint.stroke) ? "currentColor" : "none"
      };
      if (painted(paint.stroke)) out["stroke-width"] = String(Number.parseFloat(paint["stroke-width"] ?? "1") * scale);
      if (paint["fill-rule"]) out["fill-rule"] = paint["fill-rule"];
      if (paint.opacity) out.opacity = paint.opacity;
      if (paint["fill-opacity"]) out["fill-opacity"] = paint["fill-opacity"];
      return ["path", out];
    });
  }
  return __toCommonJS(adapters_entry_exports);
})();
