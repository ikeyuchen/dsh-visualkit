/*!
 * morphicons v2.0.2 — SVG 图标形变动画库（https://www.morphicons.com/）
 * License: MIT © Guillermo (guillermolg.com)
 * 本文件是 vendored 产物（非手写，不参与 check/repolint 扫描）：
 *   npm install --no-save morphicons@2.0.2 esbuild
 *   npx esbuild node_modules/morphicons/dist/dom.js --bundle --format=iife --global-name=MorphIcons --outfile=vendor/morphicons.iife.js
 * 构建日期：2026-11-07（morphicons 2.0.2，与上游 v2.0.2 tag 一致）
 */
var MorphIcons = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
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
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // node_modules/morphicons/dist/normalize-CYnN3Npw.js
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
    const num2 = () => {
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
    const nx = () => num2() + (rel ? cx : 0);
    const ny = () => num2() + (rel ? cy : 0);
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
          const rx = num2();
          const ry = num2();
          const rot = num2();
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
  function fmt(v) {
    return String(Math.round(v * 100) / 100);
  }
  function serialize(subs, closed) {
    let d = "";
    for (let k = 0; k < subs.length; k++) {
      const o = subs[k];
      const n = o.length / 2;
      d += `M${fmt(o[0])} ${fmt(o[1])}`;
      for (let i = 1; i < n; i++) d += `L${fmt(o[2 * i])} ${fmt(o[2 * i + 1])}`;
      if (closed?.[k]) d += "Z";
    }
    return d;
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
  var COMMANDS, KAPPA, TAU;
  var init_normalize_CYnN3Npw = __esm({
    "node_modules/morphicons/dist/normalize-CYnN3Npw.js"() {
      COMMANDS = "MmLlHhVvCcSsQqTtAaZz";
      KAPPA = 4 / 3 * Math.tan(Math.PI / 8);
      TAU = 2 * Math.PI;
    }
  });

  // node_modules/morphicons/dist/resample-CXlaZ5ZQ.js
  function centroid(p) {
    const n = p.length / 2;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < n; i++) {
      cx += p[2 * i];
      cy += p[2 * i + 1];
    }
    return [cx / n, cy / n];
  }
  function polyLen(p) {
    const n = p.length / 2;
    let L = 0;
    for (let i = 1; i < n; i++) L += Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]);
    return L;
  }
  function reversePts(p) {
    const n = p.length / 2;
    const out = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) {
      out[2 * i] = p[2 * (n - 1 - i)];
      out[2 * i + 1] = p[2 * (n - 1 - i) + 1];
    }
    return out;
  }
  function rotatePts(p, off) {
    const n = p.length / 2;
    const out = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) {
      const j = (i + off) % n;
      out[2 * i] = p[2 * j];
      out[2 * i + 1] = p[2 * j + 1];
    }
    return out;
  }
  function procrustes(a, b, ca, cb) {
    const n = a.length / 2;
    let sxx = 0;
    let sxy = 0;
    let syx = 0;
    let syy = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < n; i++) {
      const ax = a[2 * i] - ca[0];
      const ay = a[2 * i + 1] - ca[1];
      const bx = b[2 * i] - cb[0];
      const by = b[2 * i + 1] - cb[1];
      sxx += ax * bx;
      syy += ay * by;
      sxy += ax * by;
      syx += ay * bx;
      na += ax * ax + ay * ay;
      nb += bx * bx + by * by;
    }
    const theta = Math.atan2(sxy - syx, sxx + syy);
    const num2 = Math.cos(theta) * (sxx + syy) + Math.sin(theta) * (sxy - syx);
    let sigma = na > 1e-12 ? num2 / na : 1;
    if (!(sigma > 1e-6)) sigma = 1e-6;
    const res2 = Math.max(0, sigma * sigma * na - 2 * sigma * num2 + nb);
    const res = nb > 1e-12 ? Math.sqrt(res2 / nb) : 0;
    return {
      theta,
      sigma,
      res
    };
  }
  function alignPair(aPts, bPts, aClosed = false, bClosed = false, allowReverse = true, lambda = LAMBDA) {
    const ca = centroid(aPts);
    const cb = centroid(bPts);
    const varyA = aClosed && !bClosed;
    const base = varyA ? aPts : bPts;
    const offs = aClosed || bClosed ? base.length / 2 : 1;
    let bestScore = Number.POSITIVE_INFINITY;
    let best = base;
    let sim = {
      theta: 0,
      sigma: 1,
      res: 0
    };
    for (let dir = 0; dir < (allowReverse ? 2 : 1); dir++) {
      const walk = dir ? reversePts(base) : base;
      for (let off = 0; off < offs; off++) {
        const cand = off ? rotatePts(walk, off) : walk;
        const s = varyA ? procrustes(cand, bPts, ca, cb) : procrustes(aPts, cand, ca, cb);
        const score = s.res + lambda * Math.abs(s.theta) / Math.PI;
        if (score < bestScore) {
          bestScore = score;
          best = cand;
          sim = s;
        }
      }
    }
    return varyA ? {
      ca,
      cb,
      a: best,
      b: bPts,
      ...sim
    } : {
      ca,
      cb,
      a: aPts,
      b: best,
      ...sim
    };
  }
  function costMatrix(A, B) {
    const cbs = B.map(centroid);
    const lbs = B.map(polyLen);
    return A.map((a) => {
      const ca = centroid(a);
      const la = polyLen(a);
      return cbs.map((cb, j) => Math.hypot(ca[0] - cb[0], ca[1] - cb[1]) + LEN_WEIGHT * Math.abs(la - lbs[j]));
    });
  }
  function bestPermutation(C) {
    const n = C.length;
    if (n > PERM_MAX) {
      const pairs = [];
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) pairs.push([
        C[i][j],
        i,
        j
      ]);
      pairs.sort((x, y) => x[0] - y[0]);
      const out = new Array(n).fill(-1);
      const used = new Array(n).fill(false);
      for (const [, i, j] of pairs) if (out[i] < 0 && !used[j]) {
        out[i] = j;
        used[j] = true;
      }
      return out;
    }
    const idx = Array.from({ length: n }, (_, i) => i);
    let best = idx.slice();
    let bc = Number.POSITIVE_INFINITY;
    const perm = (arr, k, acc) => {
      if (acc >= bc) return;
      if (k === n) {
        bc = acc;
        best = arr.slice();
        return;
      }
      for (let i = k; i < n; i++) {
        [arr[k], arr[i]] = [arr[i], arr[k]];
        perm(arr, k + 1, acc + C[k][arr[k]]);
        [arr[k], arr[i]] = [arr[i], arr[k]];
      }
    };
    perm(idx, 0, 0);
    return best;
  }
  function bestSurjection(C) {
    const B = C.length;
    const S = C[0].length;
    if (S ** B > 1e5) {
      const f2 = C.map((row) => {
        let m = 0;
        for (let j = 1; j < row.length; j++) if (row[j] < row[m]) m = j;
        return m;
      });
      const mult2 = new Array(S).fill(0);
      for (const s of f2) mult2[s]++;
      for (let s = 0; s < S; s++) {
        if (mult2[s] > 0) continue;
        let bi = -1;
        let bc2 = Number.POSITIVE_INFINITY;
        for (let i = 0; i < B; i++) {
          if (mult2[f2[i]] < 2) continue;
          const extra = C[i][s] - C[i][f2[i]];
          if (extra < bc2) {
            bc2 = extra;
            bi = i;
          }
        }
        mult2[f2[bi]]--;
        f2[bi] = s;
        mult2[s]++;
      }
      return f2;
    }
    let best = null;
    let bc = Number.POSITIVE_INFINITY;
    const f = new Array(B);
    const mult = new Array(S).fill(0);
    const rec = (i, acc, covered) => {
      if (acc >= bc || S - covered > B - i) return;
      if (i === B) {
        bc = acc;
        best = f.slice();
        return;
      }
      for (let s = 0; s < S; s++) {
        f[i] = s;
        mult[s]++;
        rec(i + 1, acc + C[i][s], covered + (mult[s] === 1 ? 1 : 0));
        mult[s]--;
      }
    };
    rec(0, 0, 0);
    if (!best) throw new Error("morphicons: no valid surjection (B < S)");
    return best;
  }
  function applyGlobal(items, n) {
    const T = items.length * n;
    const ga = new Float64Array(2 * T);
    const gb = new Float64Array(2 * T);
    items.forEach((it, k) => {
      ga.set(it.a, 2 * n * k);
      gb.set(it.bO, 2 * n * k);
    });
    const gca = centroid(ga);
    const g = procrustes(ga, gb, gca, centroid(gb));
    if (g.res >= GLOBAL_EPS) return;
    const cos = Math.cos(-g.theta);
    const sin = Math.sin(-g.theta);
    const rc = Math.cos(g.theta);
    const rs = Math.sin(g.theta);
    for (const it of items) {
      let e2 = 0;
      let nb = 0;
      for (let i = 0; i < n; i++) {
        const bx = it.bO[2 * i] - it.cb[0];
        const by = it.bO[2 * i + 1] - it.cb[1];
        it.bT[2 * i] = (bx * cos - by * sin) / g.sigma;
        it.bT[2 * i + 1] = (bx * sin + by * cos) / g.sigma;
        const ex = g.sigma * (rc * it.aC[2 * i] - rs * it.aC[2 * i + 1]) - bx;
        const ey = g.sigma * (rs * it.aC[2 * i] + rc * it.aC[2 * i + 1]) - by;
        e2 += ex * ex + ey * ey;
        nb += bx * bx + by * by;
      }
      it.theta = g.theta;
      it.lnSigma = Math.log(g.sigma);
      it.res = nb > 1e-12 ? Math.sqrt(e2 / nb) : 0;
      const s1 = Math.exp(it.lnSigma);
      const c1 = Math.cos(it.theta) * s1;
      const n1 = Math.sin(it.theta) * s1;
      const ox = it.ca[0] - gca[0];
      const oy = it.ca[1] - gca[1];
      const rx = ox * c1 - oy * n1 - ox;
      const ry = ox * n1 + oy * c1 - oy;
      it.block = {
        off: [ox, oy],
        drift: [it.cb[0] - it.ca[0] - rx, it.cb[1] - it.ca[1] - ry]
      };
    }
  }
  function pairUp(A, B) {
    const p = A.length;
    const q = B.length;
    const pairs = [];
    if (p === q) {
      const perm = bestPermutation(costMatrix(A, B));
      for (let i = 0; i < p; i++) pairs.push([i, perm[i]]);
    } else if (p < q) {
      const f = bestSurjection(costMatrix(B, A));
      for (let j = 0; j < q; j++) pairs.push([f[j], j]);
    } else {
      const f = bestSurjection(costMatrix(A, B));
      for (let i = 0; i < p; i++) pairs.push([i, f[i]]);
    }
    return pairs;
  }
  function makeItem(aPts, bPts, aClosed, bClosed, allowReverse, lambda) {
    const n = aPts.length / 2;
    const al = alignPair(aPts, bPts, aClosed, bClosed, allowReverse, lambda);
    const a = al.a;
    const aC = new Float64Array(2 * n);
    const bT = new Float64Array(2 * n);
    const bO = new Float64Array(2 * n);
    const cos = Math.cos(-al.theta);
    const sin = Math.sin(-al.theta);
    for (let i = 0; i < n; i++) {
      aC[2 * i] = a[2 * i] - al.ca[0];
      aC[2 * i + 1] = a[2 * i + 1] - al.ca[1];
      const bx = al.b[2 * i] - al.cb[0];
      const by = al.b[2 * i + 1] - al.cb[1];
      bT[2 * i] = (bx * cos - by * sin) / al.sigma;
      bT[2 * i + 1] = (bx * sin + by * cos) / al.sigma;
      bO[2 * i] = al.b[2 * i];
      bO[2 * i + 1] = al.b[2 * i + 1];
    }
    return {
      a,
      aC,
      bT,
      bO,
      ca: al.ca,
      cb: al.cb,
      theta: al.theta,
      lnSigma: Math.log(al.sigma),
      res: al.res,
      closed: aClosed && bClosed,
      block: null
    };
  }
  function buildPlan(srcSubs, dstSubs) {
    const p = srcSubs.length;
    const q = dstSubs.length;
    if (p === 0 || q === 0) throw new Error("morphicons: icon has no subpaths");
    const A = srcSubs.map((s) => s.pts);
    const B = dstSubs.map((s) => s.pts);
    const items = pairUp(A, B).map(([si, di]) => makeItem(A[si], B[di], srcSubs[si].closed, dstSubs[di].closed, true));
    if (items.length > 1) applyGlobal(items, A[0].length / 2);
    return {
      items,
      n: A[0].length / 2
    };
  }
  function speed(p, k, t) {
    const i = 6 * k;
    const u = 1 - t;
    const c0 = 3 * u * u;
    const c1 = 6 * u * t;
    const c2 = 3 * t * t;
    const dx = c0 * (p[i + 2] - p[i]) + c1 * (p[i + 4] - p[i + 2]) + c2 * (p[i + 6] - p[i + 4]);
    const dy = c0 * (p[i + 3] - p[i + 1]) + c1 * (p[i + 5] - p[i + 3]) + c2 * (p[i + 7] - p[i + 5]);
    return Math.hypot(dx, dy);
  }
  function segLen(p, k, t1 = 1) {
    const half = t1 / 2;
    let s = 0;
    for (let j = 0; j < 4; j++) s += GW[j] * (speed(p, k, half + half * GX[j]) + speed(p, k, half - half * GX[j]));
    return s * half;
  }
  function point(p, k, t, out, o) {
    const i = 6 * k;
    const u = 1 - t;
    const b0 = u * u * u;
    const b1 = 3 * u * u * t;
    const b2 = 3 * u * t * t;
    const b3 = t * t * t;
    out[o] = b0 * p[i] + b1 * p[i + 2] + b2 * p[i + 4] + b3 * p[i + 6];
    out[o + 1] = b0 * p[i + 1] + b1 * p[i + 3] + b2 * p[i + 5] + b3 * p[i + 7];
  }
  function tangent(p, k, atEnd) {
    const i = 6 * k;
    const b = atEnd ? i + 6 : i;
    const s = atEnd ? -1 : 1;
    for (const j of atEnd ? [
      4,
      2,
      0
    ] : [
      2,
      4,
      6
    ]) {
      const dx = s * (p[i + j] - p[b]);
      const dy = s * (p[i + j + 1] - p[b + 1]);
      if (dx * dx + dy * dy > 1e-18) return [dx, dy];
    }
    return null;
  }
  function detectCorners(path, threshold = CORNER_THRESHOLD) {
    const p = path.pts;
    const m = (p.length / 2 - 1) / 3;
    const active = [];
    for (let k = 0; k < m; k++) if (segLen(p, k) > 1e-9) active.push(k);
    if (active.length === 0) return [];
    const corners = /* @__PURE__ */ new Set();
    const test = (a, b) => {
      const u = tangent(p, a, true);
      const v = tangent(p, b, false);
      if (!u || !v) return;
      if (Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1])) > threshold) corners.add(b);
    };
    for (let j = 0; j + 1 < active.length; j++) test(active[j], active[j + 1]);
    if (path.closed && active.length > 1) test(active[active.length - 1], active[0]);
    return [...corners].sort((a, b) => a - b);
  }
  function invert(p, k, s, ls) {
    if (s <= 0) return 0;
    if (s >= ls) return 1;
    let lo = 0;
    let hi = 1;
    let t = s / ls;
    for (let it = 0; it < 12; it++) {
      const f = segLen(p, k, t) - s;
      if (Math.abs(f) < 1e-10 * ls + 1e-14) break;
      if (f > 0) hi = t;
      else lo = t;
      const sp = speed(p, k, t);
      let nt = sp > 1e-12 ? t - f / sp : (lo + hi) / 2;
      if (!(nt > lo && nt < hi)) nt = (lo + hi) / 2;
      t = nt;
    }
    return t;
  }
  function resamplePath(path, N = 64, cornerThreshold = CORNER_THRESHOLD) {
    const p = path.pts;
    const m = (p.length / 2 - 1) / 3;
    const out = new Float64Array(2 * N);
    const fill = () => {
      for (let i = 0; i < N; i++) {
        out[2 * i] = p[0];
        out[2 * i + 1] = p[1];
      }
      return out;
    };
    if (m < 1) return fill();
    const lens = new Array(m);
    let L = 0;
    for (let k = 0; k < m; k++) {
      lens[k] = segLen(p, k);
      L += lens[k];
    }
    if (L < 1e-12) return fill();
    const cs = detectCorners(path, cornerThreshold);
    const anchors = path.closed ? cs.length > 0 ? cs : [0] : [.../* @__PURE__ */ new Set([
      0,
      ...cs,
      m
    ])].sort((a, b) => a - b);
    const runs = [];
    if (path.closed) for (let j = 0; j < anchors.length; j++) {
      const a = anchors[j];
      const b = j + 1 < anchors.length ? anchors[j + 1] : anchors[0] + m;
      runs.push([a, b]);
    }
    else for (let j = 0; j + 1 < anchors.length; j++) runs.push([anchors[j], anchors[j + 1]]);
    const rl = runs.map(([a, b]) => {
      let s = 0;
      for (let k = a; k < b; k++) s += lens[k % m];
      return s;
    });
    const intervals = path.closed ? N : N - 1;
    if (runs.length > intervals) throw new Error(`morphicons: N=${N} too small (${runs.length} runs)`);
    const total = rl.reduce((a, b) => a + b, 0) || 1;
    const ideal = rl.map((l) => intervals * l / total);
    const counts = ideal.map((q) => Math.max(1, Math.floor(q)));
    let R = intervals - counts.reduce((a, b) => a + b, 0);
    if (R > 0) {
      const order = ideal.map((q, idx) => [Math.round((q - Math.floor(q)) * 1e9), idx]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      for (let j = 0; j < R; j++) counts[order[j % counts.length][1]]++;
    }
    while (R < 0) {
      let bi = 0;
      for (let idx = 1; idx < counts.length; idx++) if (counts[idx] > counts[bi]) bi = idx;
      if (counts[bi] <= 1) break;
      counts[bi]--;
      R++;
    }
    let w = 0;
    for (let r = 0; r < runs.length; r++) {
      const [k0, k1] = runs[r];
      const cnt = counts[r];
      const Lr = rl[r];
      const vi = 6 * (k0 % m);
      out[2 * w] = p[vi];
      out[2 * w + 1] = p[vi + 1];
      w++;
      let seg = k0;
      let acc = 0;
      for (let j = 1; j < cnt; j++) {
        const target = Lr * j / cnt;
        while (seg < k1 - 1 && acc + lens[seg % m] < target) {
          acc += lens[seg % m];
          seg++;
        }
        const k = seg % m;
        const ls = lens[k];
        point(p, k, ls > 1e-12 ? invert(p, k, target - acc, ls) : 0, out, 2 * w);
        w++;
      }
    }
    if (!path.closed) {
      const vi = 6 * m;
      out[2 * w] = p[vi];
      out[2 * w + 1] = p[vi + 1];
    }
    return out;
  }
  function resampleIcon(input, N = 64) {
    return iconToCubics(input).map((path) => ({
      pts: resamplePath(path, N),
      closed: path.closed
    }));
  }
  var LEN_WEIGHT, LAMBDA, GLOBAL_EPS, PERM_MAX, CORNER_THRESHOLD, GX, GW;
  var init_resample_CXlaZ5ZQ = __esm({
    "node_modules/morphicons/dist/resample-CXlaZ5ZQ.js"() {
      init_normalize_CYnN3Npw();
      LEN_WEIGHT = 0.35;
      LAMBDA = 0.05;
      GLOBAL_EPS = 5e-3;
      PERM_MAX = 8;
      CORNER_THRESHOLD = Math.PI / 8;
      GX = [
        0.18343464249564978,
        0.525532409916329,
        0.7966664774136267,
        0.9602898564975363
      ];
      GW = [
        0.362683783378362,
        0.31370664587788727,
        0.22238103445337448,
        0.10122853629037626
      ];
    }
  });

  // node_modules/morphicons/dist/region-BjECuWZR.js
  function paintOf(icon) {
    if (typeof icon === "string") return "stroke";
    for (const [, a] of icon) if (painted(a.fill)) return "fill";
    return "stroke";
  }
  function solid(icon) {
    return typeof icon === "string" || paintOf(icon) === "stroke" ? icon : icon.filter(([, a]) => !translucent(a));
  }
  function isRegion(icon) {
    return typeof icon !== "string" && icon.length === 1 && "data-region" in icon[0][1];
  }
  function inside(px, py, p) {
    const n = p.length / 2;
    let c = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = p[2 * i + 1];
      const yj = p[2 * j + 1];
      if (yi > py !== yj > py && px < (p[2 * j] - p[2 * i]) * (py - yi) / (yj - yi) + p[2 * i]) c = !c;
    }
    return c;
  }
  function distSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = px - ax - t * dx;
    const ey = py - ay - t * dy;
    return Math.sqrt(ex * ex + ey * ey);
  }
  function signedArea(p) {
    const n = p.length / 2;
    let a = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) a += p[2 * j] * p[2 * i + 1] - p[2 * i] * p[2 * j + 1];
    return a / 2;
  }
  var REGION_ATTR, painted, translucent;
  var init_region_BjECuWZR = __esm({
    "node_modules/morphicons/dist/region-BjECuWZR.js"() {
      REGION_ATTR = "data-region";
      painted = (v) => v !== void 0 && String(v).trim().toLowerCase() !== "none";
      translucent = (a) => Number.parseFloat(String(a.opacity)) < 0.5 || Number.parseFloat(String(a["fill-opacity"])) < 0.5;
    }
  });

  // node_modules/morphicons/dist/region.js
  var region_exports = {};
  __export(region_exports, {
    buildRegionPlan: () => buildRegionPlan,
    isRegion: () => isRegion,
    paintOf: () => paintOf,
    regionContours: () => regionContours,
    regionOf: () => regionOf,
    regionPlan: () => regionPlan,
    regionPlanFrom: () => regionPlanFrom,
    resampleRegion: () => resampleRegion,
    toRegion: () => toRegion
  });
  function coarse(path, s) {
    const n = s.length / 2;
    let j = 0;
    for (let v = 0; v < path.length; v += 6) for (let k = 0; ; k++) {
      if (k === n) return true;
      const a = (j + k) % n;
      const b = (a + 1) % n;
      if (distSeg(path[v], path[v + 1], s[2 * a], s[2 * a + 1], s[2 * b], s[2 * b + 1]) <= FINE) {
        j = a;
        break;
      }
    }
    return false;
  }
  function resampleRegion(icon, N) {
    const paths = iconToCubics(icon);
    const at = (n) => paths.map((path) => {
      let pts;
      for (const th of REGION_THRESHOLDS) try {
        pts = resamplePath({
          pts: path.pts,
          closed: true
        }, n, th);
        break;
      } catch {
      }
      const s2 = pts;
      return {
        pts: s2,
        closed: true,
        hole: signedArea(s2) < 0
      };
    });
    const s = at(N ?? 64);
    return N || !paths.some((p, k) => coarse(p.pts, s[k].pts)) ? s : at(128);
  }
  function folds(a, b) {
    const L = a.length;
    const p = new Float64Array(L);
    for (let i = 0; i < L; i++) p[i] = (a[i] + b[i]) / 2;
    for (let i = 0; i < L; i += 2) {
      const ax = p[i];
      const ay = p[i + 1];
      const ux = p[(i + 2) % L] - ax;
      const uy = p[(i + 3) % L] - ay;
      for (let j = i + 4; j < L - (i ? 0 : 2); j += 2) {
        const cx = p[j];
        const cy = p[j + 1];
        const vx = p[(j + 2) % L] - cx;
        const vy = p[(j + 3) % L] - cy;
        if ((ux * (cy - ay) - uy * (cx - ax)) * (ux * (cy + vy - ay) - uy * (cx + vx - ax)) >= 0) continue;
        if ((vx * (ay - cy) - vy * (ax - cx)) * (vx * (ay + uy - cy) - vy * (ax + ux - cx)) < 0) return true;
      }
    }
    return false;
  }
  function outerItem(a, b) {
    const n = a.length / 2;
    const k = n > 64 ? 2 : 1;
    const half = (p, o) => k > 1 ? p.filter((_, i) => (i >> 1) % 2 === o) : p;
    const as = half(a, 0);
    const ca = centroid(as);
    const bs = [half(b, 0), half(b, 1)];
    const cbs = bs.map(centroid);
    const offs = [];
    for (let off = 0; off < n; off++) {
      const j = off % k;
      const s = procrustes(as, rotatePts(bs[j], (off - j) / k), ca, cbs[j]);
      offs.push([off, s.res + REGION_LAMBDA * Math.abs(s.theta) / Math.PI]);
    }
    offs.sort((x, y) => x[1] - y[1]);
    let best;
    for (const [off, score] of offs.slice(0, FOLD_TRIES)) {
      if (score > offs[0][1] + FOLD_SLACK) break;
      const it = makeItem(a, rotatePts(b, off), false, false, false, REGION_LAMBDA);
      it.closed = true;
      best ?? (best = it);
      if (!folds(half(it.aC, 0), half(it.bT, 0))) return it;
    }
    return best;
  }
  function parentOf(hole, subs) {
    const n = hole.length / 2;
    let best = -1;
    let bestArea = Infinity;
    subs.forEach((s, k) => {
      if (s.hole) return;
      let votes = 0;
      for (const v of [
        0,
        Math.floor(n / 3),
        Math.floor(2 * n / 3)
      ]) if (inside(hole[2 * v], hole[2 * v + 1], s.pts)) votes++;
      if (votes < 2) return;
      const ar = Math.abs(signedArea(s.pts));
      if (ar < bestArea) {
        bestArea = ar;
        best = k;
      }
    });
    return best;
  }
  function assign(C, skip, one, cover) {
    const L = C.length;
    const S = one.length;
    const f = new Array(L).fill(-1);
    const mult = new Array(S).fill(0);
    if ((S + 1) ** L > 1e5) {
      const pairs = [];
      for (let i = 0; i < L; i++) for (let j = 0; j < S; j++) if (C[i][j] < Infinity) pairs.push([
        C[i][j],
        i,
        j
      ]);
      pairs.sort((x, y) => x[0] - y[0]);
      for (const [, i, j] of pairs) if (f[i] < 0 && !mult[j]) {
        f[i] = j;
        mult[j] = 1;
      }
      for (let i = 0; i < L; i++) {
        if (f[i] >= 0) continue;
        for (let j = 0; j < S; j++) if (!one[j] && (f[i] < 0 || C[i][j] < C[i][f[i]])) f[i] = j;
      }
      return f;
    }
    let best = f.slice();
    let bc = Infinity;
    const rec = (i, acc, covered) => {
      if (acc >= bc || cover && S - covered > L - i) return;
      if (i === L) {
        bc = acc;
        best = f.slice();
        return;
      }
      for (let j = 0; j < S; j++) {
        if (one[j] && mult[j] || !(C[i][j] < Infinity)) continue;
        f[i] = j;
        mult[j]++;
        rec(i + 1, acc + C[i][j], covered + (mult[j] === 1 ? 1 : 0));
        mult[j]--;
      }
      f[i] = -1;
      rec(i + 1, acc + skip[i], covered);
    };
    rec(0, 0, 0);
    return best;
  }
  function carry(x, y, from, to, theta, s) {
    const c = Math.cos(theta) * s;
    const n = Math.sin(theta) * s;
    const dx = x - from[0];
    const dy = y - from[1];
    return [to[0] + dx * c - dy * n, to[1] + dx * n + dy * c];
  }
  function dots(c, n) {
    const d = new Float64Array(2 * n);
    for (let i = 0; i < 2 * n; i += 2) {
      d[i] = c[0];
      d[i + 1] = c[1];
    }
    return d;
  }
  function inFrame(a, b, f, hole, half) {
    const n = a.length / 2;
    const s = Math.exp(f.lnSigma);
    const aC = new Float64Array(2 * n);
    const bt = new Float64Array(2 * n);
    let nb = 0;
    for (let i = 0; i < 2 * n; i += 2) {
      aC[i] = a[i] - f.ca[0];
      aC[i + 1] = a[i + 1] - f.ca[1];
      [bt[i], bt[i + 1]] = carry(b[i], b[i + 1], f.cb, [0, 0], -f.theta, 1 / s);
      nb += (b[i] - f.cb[0]) ** 2 + (b[i + 1] - f.cb[1]) ** 2;
    }
    let off = 0;
    let be = Infinity;
    for (let o = 0; o < n && be > 0; o++) {
      let e = 0;
      for (let i = 0; i < n && e < be; i++) {
        const j = (i + o) % n;
        e += (aC[2 * i] - bt[2 * j]) ** 2 + (aC[2 * i + 1] - bt[2 * j + 1]) ** 2;
      }
      if (e < be) {
        be = e;
        off = o;
      }
    }
    return {
      a,
      aC,
      bT: rotatePts(bt, off),
      bO: rotatePts(b, off),
      ca: f.ca,
      cb: f.cb,
      theta: f.theta,
      lnSigma: f.lnSigma,
      res: nb > 1e-12 ? Math.sqrt(s * s * be / nb) : 0,
      closed: true,
      hole,
      half,
      block: f.block
    };
  }
  function vanishingHole(pts, outer, grow) {
    const s = Math.exp(outer.lnSigma);
    let [x, y] = centroid(pts);
    const { aC, bT } = outer;
    const near = grow ? outer.bO : outer.a;
    let w = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < aC.length; i += 2) {
      const k = 1 / ((near[i] - x) ** 2 + (near[i + 1] - y) ** 2 + 1e-9);
      w += k;
      dx += k * (bT[i] - aC[i]);
      dy += k * (bT[i + 1] - aC[i + 1]);
    }
    w = (grow ? -0.5 : 0.5) / w;
    if (grow) [x, y] = carry(x, y, outer.cb, outer.ca, -outer.theta, 1 / s);
    x += w * dx;
    y += w * dy;
    const dot = dots(grow ? [x, y] : carry(x, y, outer.ca, outer.cb, outer.theta, s), pts.length / 2);
    return grow ? inFrame(dot, pts, outer, true, 1) : inFrame(pts, dot, outer, true, 0);
  }
  function strays(h, o, holes) {
    let k = 0;
    for (const t of [
      0.25,
      0.5,
      0.75
    ]) {
      if (!(weight(h, t) % 1)) continue;
      const [H, O, ...G] = [
        h,
        o,
        ...holes.filter((g) => g !== h)
      ].map((it) => it.aC.map((v, i) => v + weight(it, t) * (it.bT[i] - v)));
      for (let i = 0; i < H.length; i += 2) if (!inside(H[i], H[i + 1], O) || G.some((p) => inside(H[i], H[i + 1], p))) k++;
    }
    return k;
  }
  function vanishingPiece(outer, holes, grow) {
    const c = centroid(outer);
    const f = {
      ca: c,
      cb: c,
      theta: 0,
      lnSigma: 0,
      block: null
    };
    const dot = dots(c, outer.length / 2);
    return [outer, ...holes].map((p, k) => grow ? inFrame(dot, p, f, k > 0) : inFrame(p, dot, f, k > 0));
  }
  function bbox(p) {
    const b = [
      p[0],
      p[1],
      p[0],
      p[1]
    ];
    for (let i = 2; i < p.length; i += 2) {
      b[0] = Math.min(b[0], p[i]);
      b[1] = Math.min(b[1], p[i + 1]);
      b[2] = Math.max(b[2], p[i]);
      b[3] = Math.max(b[3], p[i + 1]);
    }
    return b;
  }
  function holeCosts(HA, HB, outer) {
    const s = Math.exp(outer.lnSigma);
    const C = costMatrix(HA, HB);
    const inA = HB.map((h) => {
      const q = new Float64Array(h.length);
      for (let i = 0; i < h.length; i += 2) [q[i], q[i + 1]] = carry(h[i], h[i + 1], outer.cb, outer.ca, -outer.theta, 1 / s);
      return bbox(q);
    });
    HA.forEach((h, i) => {
      const a = bbox(h);
      inA.forEach((b, j) => {
        const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
        const v = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
        const inter = w > 0 && v > 0 ? w * v : 0;
        const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
        if (!(inter >= HOLE_IOU * union)) C[i][j] = Infinity;
      });
    });
    return C;
  }
  function piecesOf(subs) {
    const idx = [];
    subs.forEach((s, k) => {
      if (!s.hole) idx.push(k);
    });
    const holes = idx.map(() => []);
    subs.forEach((s) => {
      if (!s.hole) return;
      let k = idx.indexOf(parentOf(s.pts, subs));
      if (k < 0) {
        const [hx, hy] = centroid(s.pts);
        let bd = Infinity;
        idx.forEach((o, m) => {
          const [ox, oy] = centroid(subs[o].pts);
          const d = Math.hypot(ox - hx, oy - hy);
          if (d < bd) {
            bd = d;
            k = m;
          }
        });
      }
      holes[k].push(s.pts);
    });
    return {
      outers: idx.map((k) => subs[k].pts),
      holes
    };
  }
  function doubled(p) {
    const m = p.length;
    const q = new Float64Array(2 * m);
    for (let i = 0; i < m; i += 2) {
      const j = (i + 2) % m;
      q[2 * i] = p[i];
      q[2 * i + 1] = p[i + 1];
      q[2 * i + 2] = (p[i] + p[j]) / 2;
      q[2 * i + 3] = (p[i + 1] + p[j + 1]) / 2;
    }
    return q;
  }
  function buildRegionPlan(srcSubs, dstSubs) {
    const n = Math.max(srcSubs[0].pts.length, dstSubs[0].pts.length) / 2;
    const fit = (s) => s[0].pts.length / 2 < n ? s.map((c) => ({
      ...c,
      pts: doubled(c.pts)
    })) : s;
    const A = piecesOf(fit(srcSubs));
    const B = piecesOf(fit(dstSubs));
    if (A.outers.length === 0 || B.outers.length === 0) throw new Error("morphicons: region has no outer contour");
    let pairs;
    const p = A.outers.length;
    const q = B.outers.length;
    const [large, small] = p < q ? [B, A] : [A, B];
    if (p === q || small.holes.every((h) => h.length === 0)) pairs = pairUp(A.outers, B.outers);
    else pairs = assign(costMatrix(large.outers, small.outers), large.outers.map((o) => SKIP + vanishCost(o)), small.holes.map((h) => h.length > 0), true).map((s, l) => p < q ? [s, l] : [l, s]);
    const items = [];
    let partial = false;
    for (const [i, j] of pairs) {
      if (i < 0 || j < 0) {
        partial = true;
        items.push(...i < 0 ? vanishingPiece(B.outers[j], B.holes[j], true) : vanishingPiece(A.outers[i], A.holes[i], false));
        continue;
      }
      const it = outerItem(A.outers[i], B.outers[j]);
      it.hole = false;
      items.push(it);
      const HA = A.holes[i];
      const HB = B.holes[j];
      const f = assign(holeCosts(HA, HB, it), HA.map(() => SKIP), HB.map(() => true), false);
      const holes = HA.map((h, k) => f[k] < 0 ? vanishingHole(h, it, false) : inFrame(h, HB[f[k]], it, true));
      HB.forEach((h, k) => {
        if (!f.includes(k)) holes.push(vanishingHole(h, it, true));
      });
      for (let k = 0; k < holes.length; k++) {
        const h = holes[k];
        if (h.half !== void 0) {
          partial = true;
          continue;
        }
        const c = strays(h, it, holes);
        if (!c) continue;
        holes.splice(k, 1, vanishingHole(h.a, it, false), vanishingHole(h.bO, it, true));
        if (strays(holes[k], it, holes) + strays(holes[k + 1], it, holes) >= c) holes.splice(k, 2, h);
      }
      items.push(...holes);
    }
    if (items.length > 1 && !partial) applyGlobal(items, n);
    return {
      items,
      n
    };
  }
  function flatten(input, tol) {
    const lines = [];
    const closed = [];
    for (const { pts, closed: c } of iconToCubics(input)) {
      const out = [pts[0], pts[1]];
      for (let i = 0; i + 7 < pts.length; i += 6) {
        const x0 = pts[i];
        const y0 = pts[i + 1];
        const x1 = pts[i + 2];
        const y1 = pts[i + 3];
        const x2 = pts[i + 4];
        const y2 = pts[i + 5];
        const x3 = pts[i + 6];
        const y3 = pts[i + 7];
        const dd = Math.max(Math.hypot(x0 - 2 * x1 + x2, y0 - 2 * y1 + y2), Math.hypot(x1 - 2 * x2 + x3, y1 - 2 * y2 + y3));
        const k = Math.min(128, Math.max(1, Math.ceil(Math.sqrt(6 * dd / (8 * tol)))));
        for (let s = 1; s <= k; s++) {
          const t = s / k;
          const u = 1 - t;
          out.push(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
        }
      }
      lines.push(Float64Array.from(out));
      closed.push(c);
    }
    return {
      lines,
      closed
    };
  }
  function partsOf(input, width, tol) {
    if (typeof input === "string") return [{
      ...flatten(input, tol),
      half: width / 2,
      fill: 0
    }];
    const fillIcon = paintOf(input) === "fill";
    const parts = [];
    for (const el of input) {
      const a = el[1];
      if (translucent(a)) continue;
      const strokeOn = fillIcon ? painted2(a.stroke) : a.stroke === void 0 || painted2(a.stroke);
      const fillOn = fillIcon && (painted2(a.fill) || a.fill === void 0 && !strokeOn);
      if (!strokeOn && !fillOn) continue;
      parts.push({
        ...flatten([el], tol),
        half: strokeOn ? num(a["stroke-width"], width) / 2 : 0,
        fill: fillOn ? String(a["fill-rule"] ?? "").trim() === "evenodd" ? 2 : 1 : 0
      });
    }
    return parts;
  }
  function eachNear(g, ax, ay, bx, by, r, fn) {
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - g.x0) / g.h));
    const i1 = Math.min(g.nx - 1, Math.ceil((Math.max(ax, bx) + r - g.x0) / g.h));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by) - r - g.y0) / g.h));
    const j1 = Math.min(g.ny - 1, Math.ceil((Math.max(ay, by) + r - g.y0) / g.h));
    for (let j = j0; j <= j1; j++) {
      const y = g.y0 + j * g.h;
      for (let i = i0; i <= i1; i++) fn(j * g.nx + i, g.x0 + i * g.h, y);
    }
  }
  function eachSeg(p, close, fn) {
    const n = p.length / 2;
    if (n === 1) fn(p[0], p[1], p[0], p[1]);
    for (let i = 0; i + 1 < n; i++) fn(p[2 * i], p[2 * i + 1], p[2 * i + 2], p[2 * i + 3]);
    if (close && n > 2) fn(p[2 * n - 2], p[2 * n - 1], p[0], p[1]);
  }
  function field(parts, g) {
    const F = new Float32Array(g.nx * g.ny).fill(BIG);
    const band = 2 * g.h;
    let D = null;
    for (const part of parts) {
      if (part.half > 0) {
        const r = part.half + band;
        part.lines.forEach((p, li) => {
          eachSeg(p, part.closed[li], (ax, ay, bx, by) => eachNear(g, ax, ay, bx, by, r, (k, x, y) => {
            const d = distSeg(x, y, ax, ay, bx, by) - part.half;
            if (d < F[k]) F[k] = d;
          }));
        });
      }
      if (part.fill) {
        D ?? (D = new Float32Array(g.nx * g.ny));
        const Dm = D;
        Dm.fill(BIG);
        for (const p of part.lines) eachSeg(p, true, (ax, ay, bx, by) => eachNear(g, ax, ay, bx, by, band, (k, x, y) => {
          const d = distSeg(x, y, ax, ay, bx, by);
          if (d < Dm[k]) Dm[k] = d;
        }));
        const xs = [];
        const ws = [];
        for (let j = 0; j < g.ny; j++) {
          const y = g.y0 + j * g.h;
          const cross = [];
          for (const p of part.lines) eachSeg(p, true, (ax, ay, bx, by) => {
            if (ay <= y !== by <= y) cross.push([ax + (y - ay) * (bx - ax) / (by - ay), by > ay ? 1 : -1]);
          });
          cross.sort((u, v) => u[0] - v[0]);
          xs.length = 0;
          ws.length = 0;
          for (const [x, w] of cross) {
            xs.push(x);
            ws.push(w);
          }
          let c = 0;
          let wind = 0;
          for (let i = 0; i < g.nx; i++) {
            const x = g.x0 + i * g.h;
            while (c < xs.length && xs[c] < x) wind += ws[c++];
            const isIn = part.fill === 1 ? wind !== 0 : (wind & 1) === 1;
            const k = j * g.nx + i;
            const v = isIn ? -Dm[k] : Dm[k];
            if (v < F[k]) F[k] = v;
          }
        }
      }
    }
    return F;
  }
  function trace(F, g) {
    const { nx, ny, h, x0, y0 } = g;
    const pt = /* @__PURE__ */ new Map();
    const crossing = (key) => {
      if (pt.has(key)) return key;
      const node = key >> 1;
      const i = node % nx;
      const j = (node - i) / nx;
      const other = key & 1 ? node + nx : node + 1;
      const fa = F[node];
      const t = Math.min(Math.max(fa / (fa - F[other]), 1e-5), 0.99999);
      pt.set(key, key & 1 ? [x0 + i * h, y0 + (j + t) * h] : [x0 + (i + t) * h, y0 + j * h]);
      return key;
    };
    const adj = /* @__PURE__ */ new Map();
    const link = (a, b) => {
      const ka = crossing(a);
      const kb = crossing(b);
      const la = adj.get(ka);
      if (la) la.push(kb);
      else adj.set(ka, [kb]);
      const lb = adj.get(kb);
      if (lb) lb.push(ka);
      else adj.set(kb, [ka]);
    };
    for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = a + nx;
      const ia = F[a] < 0;
      const ib = F[b] < 0;
      const ic = F[c] < 0;
      const id = F[d] < 0;
      const top = 2 * a;
      const right = 2 * b + 1;
      const bottom = 2 * d;
      const left = 2 * a + 1;
      const edges = [];
      if (ia !== ib) edges.push(top);
      if (ib !== ic) edges.push(right);
      if (id !== ic) edges.push(bottom);
      if (ia !== id) edges.push(left);
      if (edges.length === 2) link(edges[0], edges[1]);
      else if (edges.length === 4) {
        if ((F[a] + F[b] + F[c] + F[d]) / 4 < 0 === ia) {
          link(top, right);
          link(bottom, left);
        } else {
          link(left, top);
          link(right, bottom);
        }
      }
    }
    const loops = [];
    const seen = /* @__PURE__ */ new Set();
    for (const start of adj.keys()) {
      if (seen.has(start)) continue;
      const ring = [];
      let prev = -1;
      let cur = start;
      while (!seen.has(cur)) {
        seen.add(cur);
        const p = pt.get(cur);
        ring.push(p[0], p[1]);
        const nb = adj.get(cur);
        const next = nb[0] !== prev ? nb[0] : nb[1];
        prev = cur;
        cur = next;
      }
      if (ring.length >= 6) loops.push(Float64Array.from(ring));
    }
    return loops;
  }
  function rdp(p, i0, i1, tol, keep) {
    const n = p.length / 2;
    const ax = p[2 * (i0 % n)];
    const ay = p[2 * (i0 % n) + 1];
    const bx = p[2 * (i1 % n)];
    const by = p[2 * (i1 % n) + 1];
    let worst = -1;
    let wd = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const d = distSeg(p[2 * (i % n)], p[2 * (i % n) + 1], ax, ay, bx, by);
      if (d > wd) {
        wd = d;
        worst = i;
      }
    }
    if (worst < 0) return;
    keep[worst % n] = 1;
    rdp(p, i0, worst, tol, keep);
    rdp(p, worst, i1, tol, keep);
  }
  function simplify(p, tol) {
    const n = p.length / 2;
    if (n < 4) return p;
    let far = 0;
    let fd = -1;
    for (let i = 1; i < n; i++) {
      const d = Math.hypot(p[2 * i] - p[0], p[2 * i + 1] - p[1]);
      if (d > fd) {
        fd = d;
        far = i;
      }
    }
    const keep = new Uint8Array(n);
    keep[0] = 1;
    keep[far] = 1;
    rdp(p, 0, far, tol, keep);
    rdp(p, far, n, tol, keep);
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(p[2 * i], p[2 * i + 1]);
    return Float64Array.from(out);
  }
  function recoverCorners(p, h) {
    const n = p.length / 2;
    if (n < 4) return p;
    const len = (k) => {
      const a = k % n;
      const b = (k + 1) % n;
      return Math.hypot(p[2 * b] - p[2 * a], p[2 * b + 1] - p[2 * a + 1]);
    };
    const long = [];
    for (let k = 0; k < n; k++) if (len(k) >= 2.5 * h) long.push(k);
    if (long.length < 2) return p;
    const drop = new Uint8Array(n);
    const moved = /* @__PURE__ */ new Map();
    for (let q = 0; q < long.length; q++) {
      const k1 = long[q];
      const k2 = long[(q + 1) % long.length];
      const gap = (k2 - k1 - 1 + n) % n;
      if (gap < 1 || gap > 3) continue;
      let gl = 0;
      for (let s = 1; s <= gap; s++) gl += len(k1 + s);
      if (gl > 3 * h) continue;
      const a0 = k1 % n;
      const a1 = (k1 + 1) % n;
      const b0 = k2 % n;
      const b1 = (k2 + 1) % n;
      const d1x = p[2 * a1] - p[2 * a0];
      const d1y = p[2 * a1 + 1] - p[2 * a0 + 1];
      const d2x = p[2 * b1] - p[2 * b0];
      const d2y = p[2 * b1 + 1] - p[2 * b0 + 1];
      const cr = d1x * d2y - d1y * d2x;
      if (Math.abs(Math.atan2(cr, d1x * d2x + d1y * d2y)) < Math.PI / 12) continue;
      const t = ((p[2 * b0] - p[2 * a0]) * d2y - (p[2 * b0 + 1] - p[2 * a0 + 1]) * d2x) / cr;
      const X = [p[2 * a0] + t * d1x, p[2 * a0 + 1] + t * d1y];
      const mx = (p[2 * a1] + p[2 * b0]) / 2;
      const my = (p[2 * a1 + 1] + p[2 * b0 + 1]) / 2;
      if (Math.hypot(X[0] - mx, X[1] - my) > 2 * h) continue;
      moved.set(a1, X);
      for (let s = 2; s <= gap + 1; s++) drop[(k1 + s) % n] = 1;
    }
    if (moved.size === 0) return p;
    const out = [];
    for (let i = 0; i < n; i++) {
      if (drop[i]) continue;
      const m = moved.get(i);
      if (m) out.push(m[0], m[1]);
      else out.push(p[2 * i], p[2 * i + 1]);
    }
    return Float64Array.from(out);
  }
  function regionContours(input, options) {
    const h = options?.cell ?? 0.125;
    const parts = partsOf(input, options?.strokeWidth ?? 2, 4e-3);
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let pad = 0;
    for (const part of parts) {
      pad = Math.max(pad, part.half);
      for (const p of part.lines) for (let i = 0; i < p.length; i += 2) {
        minX = Math.min(minX, p[i]);
        maxX = Math.max(maxX, p[i]);
        minY = Math.min(minY, p[i + 1]);
        maxY = Math.max(maxY, p[i + 1]);
      }
    }
    if (!(maxX >= minX)) return [];
    pad += 3 * h;
    const g = {
      x0: minX - pad,
      y0: minY - pad,
      h,
      nx: Math.ceil((maxX - minX + 2 * pad) / h) + 1,
      ny: Math.ceil((maxY - minY + 2 * pad) / h) + 1
    };
    const loops = trace(field(parts, g), g).filter((l) => Math.abs(signedArea(l)) > 0.01);
    return loops.map((l) => {
      let depth = 0;
      for (const o of loops) if (o !== l && inside(l[0], l[1], o)) depth++;
      const hole = depth % 2 === 1;
      return recoverCorners(simplify(signedArea(l) > 0 === !hole ? l : reversePts(l), h * 0.08), h);
    });
  }
  function toRegion(input, options) {
    if (isRegion(input)) return input;
    let d = "";
    for (const p of regionContours(input, options)) {
      d += `M${fmt2(p[0])} ${fmt2(p[1])}`;
      for (let i = 2; i < p.length; i += 2) d += `L${fmt2(p[i])} ${fmt2(p[i + 1])}`;
      d += "Z";
    }
    if (!d) throw new Error("morphicons: icon has no visible surface");
    return [["path", {
      d,
      fill: "currentColor",
      stroke: "none",
      "fill-rule": "nonzero",
      [REGION_ATTR]: "1"
    }]];
  }
  function regionOf(icon, strokeWidth) {
    if (isRegion(icon)) return icon;
    const width = paintOf(icon) === "fill" && !icon.some(([, a]) => painted2(a.stroke) && a["stroke-width"] === void 0) ? 0 : strokeWidth;
    let byWidth = typeof icon === "string" ? void 0 : forms.get(icon);
    let r = byWidth?.get(width);
    if (r) return r;
    const key = `${width}|${typeof icon === "string" ? icon : JSON.stringify(icon)}`;
    r = byContent.get(key);
    if (r) byContent.delete(key);
    else r = toRegion(icon, { strokeWidth });
    byContent.set(key, r);
    if (byContent.size > 64) byContent.delete(byContent.keys().next().value);
    if (typeof icon !== "string") {
      if (!byWidth) {
        byWidth = /* @__PURE__ */ new Map();
        forms.set(icon, byWidth);
      }
      byWidth.set(width, r);
    }
    return r;
  }
  function sampledOf(region) {
    let s = samples.get(region);
    if (!s) {
      s = resampleRegion(region);
      samples.set(region, s);
    }
    return s;
  }
  function regionPlan(src, dst, strokeWidth) {
    const a = regionOf(src, strokeWidth);
    const b = regionOf(dst, strokeWidth);
    let inner = plans.get(a);
    if (!inner) {
      inner = /* @__PURE__ */ new WeakMap();
      plans.set(a, inner);
    }
    let p = inner.get(b);
    if (!p) {
      p = buildRegionPlan(sampledOf(a), sampledOf(b));
      inner.set(b, p);
    }
    return p;
  }
  function regionPlanFrom(shape, dst, strokeWidth) {
    return buildRegionPlan(typeof shape === "string" ? resampleRegion(regionOf(shape, strokeWidth)) : shape, sampledOf(regionOf(dst, strokeWidth)));
  }
  var REGION_THRESHOLDS, FINE, REGION_LAMBDA, FOLD_SLACK, FOLD_TRIES, SKIP, weight, vanishCost, HOLE_IOU, BIG, painted2, num, fmt2, forms, byContent, samples, plans;
  var init_region = __esm({
    "node_modules/morphicons/dist/region.js"() {
      init_normalize_CYnN3Npw();
      init_resample_CXlaZ5ZQ();
      init_region_BjECuWZR();
      REGION_THRESHOLDS = [
        Math.PI / 4,
        Math.PI / 3,
        Math.PI / 2,
        Math.PI
      ];
      FINE = 0.3;
      REGION_LAMBDA = 0.3;
      FOLD_SLACK = 0.1;
      FOLD_TRIES = 16;
      SKIP = 1e6;
      weight = (it, t) => Math.min(1, Math.max(0, 2 * t - (it.half ?? t)));
      vanishCost = (pts) => costMatrix([pts], [dots(centroid(pts), pts.length / 2)])[0][0];
      HOLE_IOU = 0.25;
      BIG = 1e9;
      painted2 = (v) => v !== void 0 && String(v).trim().toLowerCase() !== "none";
      num = (v, fallback) => {
        const x = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
        return Number.isFinite(x) ? x : fallback;
      };
      fmt2 = (v) => String(Math.round(v * 1e3) / 1e3);
      forms = /* @__PURE__ */ new WeakMap();
      byContent = /* @__PURE__ */ new Map();
      samples = /* @__PURE__ */ new WeakMap();
      plans = /* @__PURE__ */ new WeakMap();
      globalThis[/* @__PURE__ */ Symbol.for("morphicons.region")] = {
        regionOf,
        regionPlan,
        regionPlanFrom
      };
    }
  });

  // node_modules/morphicons/dist/dom.js
  var dom_exports = {};
  __export(dom_exports, {
    canonicalD: () => canonicalD,
    createMorph: () => createMorph,
    preloadRegion: () => preloadRegion,
    restAttrs: () => restAttrs,
    setRegionLoader: () => setRegionLoader
  });

  // node_modules/morphicons/dist/spring-B_P92nf6.js
  function allocOutputs(plan) {
    return plan.items.map(() => new Float64Array(2 * plan.n));
  }
  function interpPolar(plan, t, out) {
    for (let k = 0; k < plan.items.length; k++) {
      const it = plan.items[k];
      const o = out[k];
      const n = plan.n;
      const s = Math.exp(it.lnSigma * t);
      const ang = it.theta * t;
      const cos = Math.cos(ang) * s;
      const sin = Math.sin(ang) * s;
      let cx;
      let cy;
      if (it.block) {
        const [ox, oy] = it.block.off;
        const [dx, dy] = it.block.drift;
        cx = it.ca[0] + dx * t + (ox * cos - oy * sin - ox);
        cy = it.ca[1] + dy * t + (ox * sin + oy * cos - oy);
      } else {
        cx = it.ca[0] + (it.cb[0] - it.ca[0]) * t;
        cy = it.ca[1] + (it.cb[1] - it.ca[1]) * t;
      }
      const m = it.half === void 0 ? t : Math.min(1, Math.max(0, 2 * t - it.half));
      for (let i = 0; i < n; i++) {
        const px = it.aC[2 * i] + (it.bT[2 * i] - it.aC[2 * i]) * m;
        const py = it.aC[2 * i + 1] + (it.bT[2 * i + 1] - it.aC[2 * i + 1]) * m;
        o[2 * i] = cx + px * cos - py * sin;
        o[2 * i + 1] = cy + px * sin + py * cos;
      }
    }
  }
  var Spring = class {
    constructor() {
      __publicField(this, "x", 1);
      __publicField(this, "v", 0);
      __publicField(this, "k", 250);
      __publicField(this, "c", 24);
    }
    config(k, c) {
      this.k = k;
      this.c = c;
    }
    /** Starts (or restarts mid-flight) preserving velocity. */
    start() {
      this.x = 0;
      if (this.v > 14) this.v = 14;
      if (this.v < -14) this.v = -14;
    }
    /** Advances dt seconds. Returns true on settle (|1−x| < 0.001 ∧ |v| < 0.02). */
    step(dt) {
      const steps = Math.max(1, Math.min(16, Math.ceil(dt / (1 / 240))));
      const s = dt / steps;
      for (let i = 0; i < steps; i++) {
        const a = this.k * (1 - this.x) - this.c * this.v;
        this.v += a * s;
        this.x += this.v * s;
      }
      return Math.abs(1 - this.x) < 1e-3 && Math.abs(this.v) < 0.02;
    }
  };
  var SPRING_PRESETS = {
    /** ζ = 1.00 — critically damped, no overshoot. */
    smooth: {
      k: 170,
      c: 26
    },
    /** ζ = 0.73 — fast, subtle overshoot. */
    snappy: {
      k: 420,
      c: 30
    },
    /** ζ = 0.40 — playful. */
    bouncy: {
      k: 300,
      c: 14
    }
  };

  // node_modules/morphicons/dist/dom.js
  init_normalize_CYnN3Npw();
  init_resample_CXlaZ5ZQ();
  init_region_BjECuWZR();
  var tickers = /* @__PURE__ */ new Set();
  var rafId = 0;
  var last = -1;
  function loop(ts) {
    const dt = last < 0 ? 0 : Math.min(Math.max((ts - last) / 1e3, 0), 0.1);
    last = ts;
    for (const tick of [...tickers]) tick(dt);
    if (tickers.size > 0) rafId = requestAnimationFrame(loop);
    else {
      rafId = 0;
      last = -1;
    }
  }
  function addTicker(tick) {
    tickers.add(tick);
    if (rafId === 0) {
      last = -1;
      rafId = requestAnimationFrame(loop);
    }
  }
  function removeTicker(tick) {
    tickers.delete(tick);
    if (tickers.size === 0 && rafId !== 0) {
      cancelAnimationFrame(rafId);
      rafId = 0;
      last = -1;
    }
  }
  var samples2 = /* @__PURE__ */ new WeakMap();
  var canon = /* @__PURE__ */ new WeakMap();
  var plans2 = /* @__PURE__ */ new WeakMap();
  function cubicsOf(icon) {
    if (typeof icon === "string" || paintOf(icon) === "stroke") return iconToCubics(icon);
    return solid(icon).flatMap((el) => {
      const ps = iconToCubics([el]);
      const odd = String(el[1]["fill-rule"]).trim() === "evenodd";
      let sum = 0;
      for (const p of ps) sum += signedArea(p.pts);
      for (const p of ps) {
        let flip = sum < 0;
        if (odd) {
          let pos = true;
          for (const o of ps) if (o !== p && inside(p.pts[0], p.pts[1], o.pts)) pos = !pos;
          flip = signedArea(p.pts) > 0 !== pos;
        }
        if (flip) p.pts = reversePts(p.pts);
      }
      return ps;
    });
  }
  function sampledOf2(icon) {
    if (typeof icon === "string") return resampleIcon(icon);
    let s = samples2.get(icon);
    if (!s) {
      s = cubicsOf(icon).map((p) => ({
        pts: resamplePath(p, 64),
        closed: p.closed
      }));
      samples2.set(icon, s);
    }
    return s;
  }
  function canonicalD(icon) {
    if (typeof icon === "string") return icon;
    let d = canon.get(icon);
    if (!d) {
      d = cubicsToPathD(cubicsOf(icon));
      canon.set(icon, d);
    }
    return d;
  }
  function planBetween(src, dst) {
    if (typeof src === "string" || typeof dst === "string") return buildPlan(sampledOf2(src), sampledOf2(dst));
    let inner = plans2.get(src);
    if (!inner) {
      inner = /* @__PURE__ */ new WeakMap();
      plans2.set(src, inner);
    }
    let p = inner.get(dst);
    if (!p) {
      p = buildPlan(sampledOf2(src), sampledOf2(dst));
      inner.set(dst, p);
    }
    return p;
  }
  var regionMod = null;
  var regionLoading = null;
  var regionSince = 0;
  var regionFailed = false;
  var regionUrl;
  var regionGen = 0;
  var regionLoader = () => Promise.resolve().then(() => (init_region(), region_exports));
  function setRegionLoader(loader) {
    regionLoader = loader;
    regionGen++;
    regionLoading = null;
    regionMod = null;
    regionFailed = false;
    regionUrl = void 0;
  }
  var reload = (url) => new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.type = "module";
    s.onload = s.onerror = () => {
      s.remove();
      const m = globalThis[/* @__PURE__ */ Symbol.for("morphicons.region")];
      m ? ok(m) : ko(new Error(url));
    };
    s.src = `${url}#${Date.now()}`;
    document.head.append(s);
  });
  var fromSource = () => {
    const spec = /import\(\s*["'`]([^"'`]+)/.exec(String(regionLoader))?.[1];
    const here = /\w+:\/\/[^\s)]+?(?=:\d+:\d+)/.exec(String((/* @__PURE__ */ new Error()).stack))?.[0];
    try {
      return spec && new URL(spec, here).href;
    } catch {
    }
  };
  function preloadRegion() {
    if (regionMod) return Promise.resolve(regionMod);
    if (!regionLoading) {
      regionSince = Date.now();
      const url = regionUrl;
      const gen = regionGen;
      regionLoading = regionLoader().catch((e) => url ? reload(url) : Promise.reject(e)).then((m) => {
        if (gen === regionGen) regionMod = m;
        return m;
      }, (e) => {
        if (gen !== regionGen) throw e;
        regionLoading = null;
        regionFailed = true;
        regionUrl ?? (regionUrl = /dynamically imported module:?\s*(\S+)/i.exec(String(e?.message))?.[1] ?? fromSource());
        throw e;
      });
    }
    return regionLoading;
  }
  var quietPreload = () => new Promise((ok, ko) => {
    if (typeof navigator === "undefined" ? false : navigator.connection?.saveData) return;
    const go = () => {
      regionFailed ? ko() : preloadRegion().then(ok, ko);
    };
    typeof requestIdleCallback === "function" ? requestIdleCallback(go, { timeout: 2e3 }) : setTimeout(go, 200);
  });
  var REGION_WAIT_MS = 100;
  var paintAttrs = (p) => p === "stroke" ? {
    fill: "none",
    stroke: "inherit"
  } : {
    fill: "currentColor",
    stroke: p === "fill" ? "none" : "inherit",
    "fill-rule": "nonzero"
  };
  var looks = /* @__PURE__ */ new WeakMap();
  var paintedEls = /* @__PURE__ */ new WeakSet();
  function restLook(icon) {
    if (typeof icon === "string" || paintOf(icon) === "stroke") return "stroke";
    let look = looks.get(icon);
    if (look) return look;
    let filled = 0;
    let enclosed = -1;
    look = "fill";
    for (const el of solid(icon)) {
      const s = painted(el[1].stroke);
      const f = painted(el[1].fill) || el[1].fill === void 0 && !s;
      if (s) look = "both";
      let a = 0;
      for (const p of iconToCubics([el])) a += Math.abs(signedArea(p.pts));
      if (f) filled += a;
      else if (s) enclosed = Math.max(enclosed, 0) + a;
    }
    if (enclosed > 1.5 * filled) look = "stroke";
    looks.set(icon, look);
    return look;
  }
  function restAttrs(icon) {
    if (icon === void 0 || paintOf(icon) === "stroke") return void 0;
    return paintAttrs(restLook(icon));
  }
  function popPlan(from, to) {
    const n = 64;
    const item = ({ pts, closed }, half) => {
      if (pts.length > 128) pts = pts.filter((_, i) => i % 4 < 2);
      const c = centroid(pts);
      const p = pts.map((v, i) => v - c[i & 1]);
      const z = /* @__PURE__ */ new Float64Array(128);
      return {
        aC: half ? z : p,
        bT: half ? p : z,
        ca: c,
        cb: c,
        theta: 0,
        lnSigma: 0,
        closed,
        half,
        block: null
      };
    };
    return {
      n,
      items: [...from.map((s) => item(s, 0)), ...to.map((s) => item(s, 1))]
    };
  }
  function resolveSpring(s) {
    if (typeof s === "string") return SPRING_PRESETS[s];
    const d = SPRING_PRESETS.snappy;
    return {
      k: s?.stiffness ?? d.k,
      c: s?.damping ?? d.c
    };
  }
  function createMorph(el, icon, options) {
    const spring = new Spring();
    let reducedMotion = options?.reducedMotion ?? "never";
    let strokeWidth = options?.strokeWidth ?? 2;
    let target = icon;
    let rest = true;
    let plan = null;
    let out = null;
    let closed = null;
    let t = 1;
    let flying = false;
    let dead = false;
    let regionFlight = false;
    let drawn = false;
    let pending = null;
    let paint = "stroke";
    let known = !paintedEls.has(el);
    let split = 0;
    let popFrom = "stroke";
    let popBase = null;
    const paintAs = (p) => {
      if (p === paint && known) return;
      for (const [k, v] of Object.entries(paintAttrs(p))) el.setAttribute(k, v);
      paint = p;
      known = true;
      paintedEls.add(el);
    };
    const paintRest = (ic) => {
      const r = regionMod && paintOf(ic) === "fill" ? regionMod.regionOf(ic, strokeWidth) : ic;
      el.setAttribute("d", canonicalD(r));
      paintAs(restLook(r));
    };
    const upgrade = (load) => {
      const icon2 = target;
      load.then(() => {
        if (!dead && rest && target === icon2 && pending === null) paintRest(icon2);
      }, () => {
      });
    };
    paintRest(icon);
    if (paintOf(icon) === "fill" && !regionMod) upgrade(quietPreload());
    const shown = (tt) => !split ? [0, plan?.items.length ?? 0] : tt < 0.5 ? [0, split] : [split, plan?.items.length ?? 0];
    const render = (tt) => {
      const p = plan;
      const o = out;
      const cl = closed;
      if (!p || !o || !cl) return;
      t = tt;
      interpPolar(p, tt, o);
      drawn = true;
      const [lo, hi] = shown(tt);
      if (split) paintAs(tt < 0.5 ? popFrom : restLook(target));
      el.setAttribute("d", serialize(o.slice(lo, hi), cl.slice(lo, hi)));
    };
    const stop = () => {
      if (!flying) return;
      flying = false;
      removeTicker(tick);
    };
    const tick = (dt) => {
      const settled = spring.step(dt);
      render(spring.x);
      if (settled) {
        stop();
        settle();
      }
    };
    const settle = () => {
      rest = true;
      plan = null;
      out = null;
      closed = null;
      t = 1;
      spring.x = 1;
      spring.v = 0;
      regionFlight = false;
      split = 0;
      paintRest(target);
      if (paintOf(target) === "fill" && !regionMod && (regionLoading || !regionFailed)) upgrade(preloadRegion());
    };
    const snapshot = () => {
      const p = plan;
      const o = out;
      if (rest || !p || !o) return sampledOf2(target);
      const [lo, hi] = shown(t);
      return o.slice(lo, hi).map((buf, k) => ({
        pts: Float64Array.from(buf),
        closed: p.items[lo + k].closed,
        hole: p.items[lo + k].hole
      }));
    };
    const needsRegion = (icon2) => !rest && regionFlight || paintOf(icon2) === "fill" || paintOf(target) === "fill";
    const retarget = (icon2, pop) => {
      if (!rest && plan && out && !drawn) {
        t = 0;
        interpPolar(plan, 0, out);
      }
      if (pop || !rest && split) {
        const from = snapshot();
        popBase = rest ? target : null;
        popFrom = paint;
        plan = popPlan(from, sampledOf2(icon2));
        split = from.length;
        regionFlight = false;
      } else if (needsRegion(icon2)) {
        const mod = regionMod;
        plan = rest || !out ? mod.regionPlan(target, icon2, strokeWidth) : mod.regionPlanFrom(regionFlight ? snapshot() : serialize(out, closed ?? void 0), icon2, strokeWidth);
        regionFlight = true;
        split = 0;
        paintAs("fill");
      } else {
        plan = rest ? planBetween(target, icon2) : buildPlan(snapshot(), sampledOf2(icon2));
        regionFlight = false;
      }
      out = allocOutputs(plan);
      drawn = false;
      closed = plan.items.map((it) => it.closed);
      target = icon2;
      rest = false;
    };
    const whenRegion = (icon2, run, fallback) => {
      if (regionMod || !rest && split || !needsRegion(icon2)) return false;
      const req = {};
      pending = req;
      const give = () => {
        if (dead || pending !== req) return;
        pending = null;
        fallback();
      };
      const load = preloadRegion();
      if (Date.now() - regionSince > REGION_WAIT_MS) {
        give();
        return true;
      }
      const timer = setTimeout(give, REGION_WAIT_MS - (Date.now() - regionSince));
      load.then(() => {
        clearTimeout(timer);
        if (dead || pending !== req) return;
        pending = null;
        run();
      }, () => {
        clearTimeout(timer);
        give();
      });
      return true;
    };
    const setNow = (icon2) => {
      stop();
      pending = null;
      target = icon2;
      settle();
    };
    const motionOff = () => {
      if (reducedMotion === "always") return true;
      if (reducedMotion !== "user") return false;
      if (typeof matchMedia === "undefined") return false;
      return matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    };
    const seek = (icon2, tt, pop = false) => {
      if (dead) return;
      if (!pop && whenRegion(icon2, () => seek(icon2, tt), () => seek(icon2, tt, true))) return;
      pending = null;
      let reuse = !rest && plan !== null && icon2 === target;
      if (reuse && split && regionMod && popBase !== null) {
        target = popBase;
        rest = true;
        reuse = false;
      }
      stop();
      spring.v = 0;
      if (!reuse) retarget(icon2, pop);
      render(tt);
    };
    const fly = (icon2, sp, pop) => {
      if (dead) return;
      if (icon2 === target && (rest || flying)) {
        pending = null;
        return;
      }
      if (motionOff()) {
        setNow(icon2);
        return;
      }
      if (!pop && whenRegion(icon2, () => fly(icon2, sp, false), () => fly(icon2, sp, true))) return;
      pending = null;
      const { k, c } = resolveSpring(sp);
      spring.config(k, c);
      retarget(icon2, pop);
      spring.start();
      if (!flying) {
        flying = true;
        addTicker(tick);
      }
    };
    return {
      morphTo: (icon2, sp) => fly(icon2, sp, false),
      set(icon2) {
        if (dead) return;
        setNow(icon2);
      },
      seek,
      get progress() {
        return rest ? 1 : t;
      },
      set progress(v) {
        if (!dead) seek(target, v);
      },
      get reducedMotion() {
        return reducedMotion;
      },
      set reducedMotion(v) {
        reducedMotion = v;
      },
      get strokeWidth() {
        return strokeWidth;
      },
      set strokeWidth(v) {
        strokeWidth = v;
      },
      destroy() {
        stop();
        dead = true;
        pending = null;
        plan = null;
        out = null;
        closed = null;
      }
    };
  }
  return __toCommonJS(dom_exports);
})();
