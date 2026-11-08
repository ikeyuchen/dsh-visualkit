/**
 * layouts/image.js — layout_check action=image：渲染结果（UI 截图 / 海报 / banner / 社交卡片）的
 * 「构图几何」体检。没有 OCR，所以只量几何与密度，不判文字可读性（P7 会明确声明这条能力边界）。
 *
 * 判定链路（纯函数、确定性：同一 buffer 永远同一结果）：
 *   1. 解码 PNG（./png.js，零依赖；不在本文件重写解码）。
 *   2. 得到 content mask：
 *      - 有透明度（通道含 alpha，且存在 a<250 的像素）→ mask = a>16（透明底图；细线/描边也能抓到）；
 *      - 否则取四角像素估计背景色（每通道 ±6 容差聚类，取出现最多的一组），
 *        mask = 与背景色 RGB 欧氏距离 >24 的像素。
 *   3. 一次扫描得到：内容包围盒、四边 margin、覆盖率、左右/上下内容像素数与「视觉重量」。
 *   4. 行/列投影（连续 ≥2px 的内容区间 = run）→ 块结构：行带（水平内容带）与列带（垂直内容带）、
 *      行带内的列 run（= 块）与块起点，用于判断对齐。
 *   5. P1–P7 七条规则 → findings，交给 common.js finalize 统一算分（0–100，越低越好）。
 *
 * 阈值依据（为什么是这些数）：
 *   - 边距 <2%：1000px 画布只剩 20px，出血/裁切/圆角遮罩/屏幕边缘必然切到内容 → error；
 *     <4%：肉眼就能看出「贴边」，像没排完版 → warn。safe area 惯例 6–8%（印刷 3–5mm 在 1000px
 *     画布上也接近 6%），所以修复建议统一给 6–8%。
 *   - 边距比 >3 且最窄边 <8%：常见版式四边在 6–15% 一档，超过 3 倍就是「一边贴边、一边大留白」的
 *     失衡；另一类是同一条轴上一侧 >30%、对边 <5%（内容被挤到一侧、对侧几乎顶边）。
 *   - 覆盖率 >85%：几乎没留白，观感闷（海报最低可以到 70% 左右，但要有成组的呼吸区）；
 *     <6%：主体缺失，或背景估计失败 —— 纯白/纯透明底是最常见的误判来源，所以 message 直接提示这两种可能。
 *   - 左右/上下不平衡 >25%：人眼对重心偏移的容忍阈值接近 1/4。像素数和视觉重量（像素数×距中心距离）
 *     两条都算：只数像素会漏掉「大面积浅色块 vs 少而集中的重色块」。
 *   - 块起点 ≥5 个且没有两条重合（容差 2px）：各块各自为政、没有可依循的对齐线；≥2 种对齐方式
 *     各 ≥2 块：视线被迫左右跳。
 *   - 分辨率 <300px：位图放大 2× 就明显糊（文字和 1px 描边先死）；<800px：小屏够用，大屏/印刷会虚。
 *   - P7：固定 info，声明本模式的能力边界，避免使用者以为「图里的文字排版也体检过了」。
 *
 * 已知误报（写进报告提醒，不试图消除）：
 *   - 渐变底/照片背景：背景色只取四角，四角颜色不一致时一半画面会被当成内容 → 覆盖率偏高、
 *     P4/P5 可能误报；这类图要么先确认意图，要么改用 action=svg / action=ui。
 *   - 纯色大面积铺底 + 少量内容：会被判「过空」（message 里已提示可能是纯白/纯透明底）。
 */
import { decodePng, pixelAt } from "./png.js";
import { finalize, finding } from "./common.js";

/* ----------------------------- 阈值常量 ----------------------------- */

const ALPHA_CONTENT = 16; // 透明底：a>16 才算可见内容（更低的是渲染残留/阴影边缘）
const ALPHA_OPAQUE = 250; // 存在 a<250 的像素 = 这张图带透明度（不是纯不透明底）
const BG_TOLERANCE = 6; // 四角同色聚类：每通道 ±6 视为同一背景（吸 8-bit 抖动/极轻渐变）
const BG_DIST_SQ = 24 * 24; // 与背景色的欧氏距离 >24 才算内容（≈单通道 14，吃掉抗锯齿过渡带）
const MIN_RUN = 2; // 连续 ≥2px 才算「块」/内容段（1px 线是描边、分隔线、水印，不构成块结构）
const MARGIN_ERROR_PCT = 2;
const MARGIN_WARN_PCT = 4;
const ASYM_RATIO = 3;
const ASYM_MIN_PCT = 8; // 「最小边 <8%」才有资格算严重不对称
const ASYM_SINGLE_MAX_PCT = 30; // 单边 >30%
const ASYM_OPPOSITE_MIN_PCT = 5; // 且对边 <5%
const CROWDED_COVERAGE = 0.85;
/** 过空阈值：文字型海报/封面天然只有 2–5% 墨迹覆盖率（细字形），不能按图形占比要求。
 * 真正该报的是接近空白（<1.5%，大概率没渲染/纯占位）。 */
const EMPTY_COVERAGE = 0.015;
/** 低于这个覆盖率视为「稀疏文字类版面」：边距对称性/重心/对齐这些构图规则在没有体量块时
 * 没有参考价值（左对齐文字天然左重），跳过以免误判。 */
const SUBSTANTIAL_COVERAGE = 0.08;
/**
 * 满血版面（full-bleed）：内容四边都几乎碰到画布（每边 <2%）。
 * 这通常意味着「这不是一张作品，而是一个应用窗口的截图」：侧栏、顶栏、网格本来就该铺满窗口，
 * 贴边是正确设计而不是缺陷。
 *
 * 实测教训（2026-11-07，拿 Flow-Pilot 的真实截图验证）：7 张 1440×900 的应用截图
 * **全部**被判 62/100 bad，唯一原因就是 P1 贴边 error×3 —— 纯噪声。
 * 一个对真实截图全错的规则比没有规则更糟。
 */
const FULL_BLEED_MAX_PCT = 2;
const BALANCE_LIMIT = 0.25; // 左右/上下失衡阈值
const START_TOL_PX = 2; // 块起点去重容差
const START_CHAOS_MIN = 5; // ≥5 个互不相同且各出现 1 次 = 没有对齐关系
const ALIGN_MIN_BANDS = 2; // 一种对齐方式至少 2 个行带才算「大量存在」
const RES_WARN = 300;
const RES_INFO = 800;

const SIDE_CN = { left: "左", top: "上", right: "右", bottom: "下" };
const MODE_CN = { left: "左", center: "居中", right: "右" };

/** 四舍五入到 2 位小数；把 -0 归一成 0（否则 JSON 无损往返会翻车）。 */
function round2(value) {
	const r = Math.round(value * 100) / 100;
	return r === 0 ? 0 : r;
}

/**
 * 背景色估计：沿整个边框采样（而非只看四角），按「每通道 ±6」聚类取最大组均值。
 * 边框采样比四角稳：窗口截图顶部深色标题栏会让四角平票，进而选错背景。
 */
function estimateBackground(img) {
	const { width: w, height: h } = img;
	// 沿**整个边框**采样，不只四角：应用窗口顶部是深色标题栏时，
	// 两个角在深色、两个在浅色，四角聚类会平票并可能选中深色当背景，
	// 导致整个内容区被当成「内容」、边距全错（实测 Flow-Pilot 窗口截图）。
	const step = Math.max(1, Math.floor((w + h) / 128)); // 最多 ~256 个采样点
	const samples = [];
	for (let x = 0; x < w; x += step) {
		samples.push(pixelAt(img, x, 0), pixelAt(img, x, h - 1));
	}
	for (let y = 0; y < h; y += step) {
		samples.push(pixelAt(img, 0, y), pixelAt(img, w - 1, y));
	}
	const groups = [];
	for (const c of samples) {
		let group = groups.find(
			(g) =>
				Math.abs(g.rep.r - c.r) <= BG_TOLERANCE &&
				Math.abs(g.rep.g - c.g) <= BG_TOLERANCE &&
				Math.abs(g.rep.b - c.b) <= BG_TOLERANCE
		);
		if (group === undefined) {
			group = { rep: c, count: 0, sumR: 0, sumG: 0, sumB: 0 };
			groups.push(group);
		}
		group.count += 1;
		group.sumR += c.r;
		group.sumG += c.g;
		group.sumB += c.b;
	}
	let best = groups[0];
	for (const g of groups) if (g.count > best.count) best = g;
	return {
		r: Math.round(best.sumR / best.count),
		g: Math.round(best.sumG / best.count),
		b: Math.round(best.sumB / best.count)
	};
}

/** 一维投影（0/1 数组）→ 连续 1 的区间（长度 >= minLen），inclusive 起止。 */
function contentRuns(flags, minLen) {
	const out = [];
	let start = -1;
	for (let i = 0; i <= flags.length; i += 1) {
		const on = i < flags.length && flags[i] === 1;
		if (on && start === -1) start = i;
		else if (!on && start !== -1) {
			if (i - start >= minLen) out.push({ start, end: i - 1 });
			start = -1;
		}
	}
	return out;
}

/** 起点去重：排序后按 ±tol 聚簇（链式，够用且确定性）。 */
function clusterStarts(starts, tol) {
	const sorted = [...starts].sort((a, b) => a - b);
	const clusters = [];
	for (const s of sorted) {
		const last = clusters[clusters.length - 1];
		if (last !== undefined && s - last.rep <= tol) last.count += 1;
		else clusters.push({ rep: s, count: 1 });
	}
	return clusters;
}

function toHex(rgb) {
	return `#${[rgb.r, rgb.g, rgb.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * PNG buffer → 构图体检报告（mode=image）。纯函数、确定性。
 * @param {Buffer|Uint8Array} buffer PNG 字节（工具层已读文件）
 * @param {{name?: string}} [options]
 */
/**
 * 版式剖面：从截图反推「这页是怎么排的」。
 *
 * **为什么值得做成工具**：做 UI 参照改造的第一步永远是“量原图”——列边界在哪、
 * 行距多少、主色是什么。实测：做视频站动态页参照实现时，同一种色带扫描手写了三遍；
 * 同一个需求写第三遍，就该进工具。
 *
 * 纯像素统计，不靠 OCR、不靠模型：
 *   1. 主色板：量化到 16 级后取 top 6 + 面积占比；
 *   2. 垂直色带：逐列统计「与页面底色不同」的占比，跳变处即栏位/卡片的水平范围；
 *      ——适配“大底色 + 白卡片”这类客户端/后台界面；
 *   3. 行节奏：在内容最宽的那一栏竖向扫描，取内容→空白转换间距的中位数。
 */
/**
 * 卡片矩形检测：近白像素的连通域 → 包围盒。
 *
 * 为什么判据是「近白」而不是「与页面底色不同」：渐变背景下任何固定的底色都不成立
 * （实测下载工具仪表板的背景从 #dde5f2 渐变到 #f2f5fa，逐点比较必然失效）。
 * 而现代 UI 的卡片几乎总是近白，这个判据对渐变底、柔和阴影、深色主题反色都更稳。
 *
 * @returns {Array<{x:number,y:number,w:number,h:number,area:number}>} 按面积降序
 */
function detectCards(at, w, h, threshold = 250) {
	const NEAR_WHITE = threshold; // 三通道都 ≥ 这个值才算“卡片面”（调用方按页面底色算）
	const mask = new Uint8Array(w * h);
	for (let y = 0; y < h; y += 1) {
		const row = y * w;
		for (let x = 0; x < w; x += 1) {
			const p = at(x, y);
			if (p[0] >= NEAR_WHITE && p[1] >= NEAR_WHITE && p[2] >= NEAR_WHITE) mask[row + x] = 1;
		}
	}

	// 两遍连通域（4 邻域）：第一遍打临时标号，第二遍合并等价类
	const labels = new Int32Array(w * h).fill(-1);
	const parent = [];
	const find = (i) => {
		let r = i;
		while (parent[r] !== r) r = parent[r];
		while (parent[i] !== r) {
			const next = parent[i];
			parent[i] = r;
			i = next;
		}
		return r;
	};
	const union = (a, b) => {
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) parent[rb] = ra;
	};
	let next = 0;
	for (let y = 0; y < h; y += 1) {
		for (let x = 0; x < w; x += 1) {
			const idx = y * w + x;
			if (mask[idx] === 0) continue;
			const left = x > 0 ? labels[idx - 1] : -1;
			const up = y > 0 ? labels[idx - w] : -1;
			if (left === -1 && up === -1) {
				labels[idx] = next;
				parent[next] = next;
				next += 1;
			} else if (left !== -1 && up !== -1) {
				labels[idx] = Math.min(left, up);
				union(left, up);
			} else {
				labels[idx] = left !== -1 ? left : up;
			}
		}
	}

	const boxes = new Map();
	for (let y = 0; y < h; y += 1) {
		for (let x = 0; x < w; x += 1) {
			const idx = y * w + x;
			if (labels[idx] === -1) continue;
			const root = find(labels[idx]);
			const box = boxes.get(root);
			if (box === undefined) boxes.set(root, { x0: x, y0: y, x1: x, y1: y, n: 1 });
			else {
				if (x < box.x0) box.x0 = x;
				if (x > box.x1) box.x1 = x;
				if (y < box.y0) box.y0 = y;
				if (y > box.y1) box.y1 = y;
				box.n += 1;
			}
		}
	}

	// 过滤：太小的是文字/图标/高光，不是卡片
	const minW = Math.max(24, Math.round(w * 0.03));
	const minH = Math.max(16, Math.round(h * 0.015));
	const out = [];
	for (const box of boxes.values()) {
		const bw = box.x1 - box.x0 + 1;
		const bh = box.y1 - box.y0 + 1;
		if (bw < minW || bh < minH) continue;
		// 充填率太低说明是散碎白点连成的细长形，不是卡片
		if (box.n / (bw * bh) < 0.55) continue;
		out.push({ x: box.x0, y: box.y0, w: bw, h: bh, area: bw * bh });
	}
	return out.sort((a, b) => b.area - a.area);
}

function layoutProfile(img, bgHint) {
	const { width: w, height: h, data, channels } = img;

	// 页面底色 = **图像四边**出现最多的颜色。
	// 实测坑：直接用全图最长见的颜色（estimateBackground）会把“白卡片”（占 45%）当底，
	// 于是灰色版心间隙被当成内容，整张图变成一栏。而四边一定是页面底色，不会错。
	const edgeBuckets = new Map();
	const bump = (x, y) => {
		const i = (y * w + x) * channels;
		const r = data[i];
		const g = data[i + 1];
		const b = data[i + 2];
		const key = `${Math.round(r / 8)},${Math.round(g / 8)},${Math.round(b / 8)}`;
		const slot = edgeBuckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
		slot.n += 1;
		slot.r += r;
		slot.g += g;
		slot.b += b;
		edgeBuckets.set(key, slot);
	};
	// 用四角小块采样：顶部边线常被顶栏占满（全是白色），按边计票会把白卡片当底，
	// 进而把灰色版心间隙当成“内容”，列结构完全反过来（实测踩过）。四角更稳。
	const PATCH = Math.max(2, Math.round(Math.min(w, h) * 0.012));
	for (const [cx, cy] of [[0, 0], [w - PATCH, 0], [0, h - PATCH], [w - PATCH, h - PATCH]]) {
		for (let y = cy; y < cy + PATCH; y += 1) for (let x = cx; x < cx + PATCH; x += 1) bump(x, y);
	}
	const edgeTop = [...edgeBuckets.values()].sort((a, b) => b.n - a.n)[0];
	// 统一成 [r,g,b] 数组：near() 按下标比较，传对象会让比较全变 NaN → 整图都算“内容”，
	// 结果永远只有一列（实测踩过）。
	const bgArray = edgeTop === undefined ? [bgHint.r, bgHint.g, bgHint.b] : [Math.round(edgeTop.r / edgeTop.n), Math.round(edgeTop.g / edgeTop.n), Math.round(edgeTop.b / edgeTop.n)];
	const bg = { r: bgArray[0], g: bgArray[1], b: bgArray[2] };
	const bgRef = bgArray;

	const at = (x, y) => {
		const i = (y * w + x) * channels;
		return [data[i], data[i + 1], data[i + 2]];
	};
	const near = (p, q, tol) => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol && Math.abs(p[2] - q[2]) <= tol;

	/* 1) 主色板 */
	const buckets = new Map();
	let total = 0;
	for (let y = 0; y < h; y += 3) {
		for (let x = 0; x < w; x += 3) {
			const p = at(x, y);
			const key = `${Math.round(p[0] / 16)},${Math.round(p[1] / 16)},${Math.round(p[2] / 16)}`;
			const slot = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
			slot.n += 1;
			slot.r += p[0];
			slot.g += p[1];
			slot.b += p[2];
			buckets.set(key, slot);
			total += 1;
		}
	}
	const palette = [...buckets.values()]
		.sort((a, b) => b.n - a.n)
		.slice(0, 6)
		.map((s) => ({
			hex: toHex({ r: Math.round(s.r / s.n), g: Math.round(s.g / s.n), b: Math.round(s.b / s.n) }),
			share: round2((s.n / total) * 100)
		}));

	/* 2) 垂直色带（列结构） */
	const colFrac = new Array(w).fill(0);
	let rowsChecked = 0;
	for (let y = 0; y < h; y += 2) {
		rowsChecked += 1;
		for (let x = 0; x < w; x += 1) {
			if (!near(at(x, y), bgRef, 6)) colFrac[x] += 1;
		}
	}
	const colRatio = colFrac.map((v) => v / rowsChecked);
	const minCol = Math.max(24, Math.round(w * 0.02));
	const columns = [];
	let start = -1;
	for (let x = 0; x < w; x += 1) {
		const busy = colRatio[x] > 0.5;
		if (busy && start === -1) start = x;
		else if (!busy && start !== -1) {
			if (x - start >= minCol) columns.push([start, x - 1]);
			start = -1;
		}
	}
	if (start !== -1 && w - start >= minCol) columns.push([start, w - 1]);

	/* 2b) 垂直分界线：办公/客户端界面几乎全白，色带法分不开栏位（实测在线文档参考图：
	 * 色带只报出「90~1538 | 1551~2030」，左图标栏与二级侧栏都丢了）。
	 * 但栏位之间**一定有一条贯穿全高的分界线**——逐行比较相邻两列的颜色变化，
	 * 变化率高的 x 就是真实的栏位边界。这比“与页面底色不同”稳得多。 */
	const vEdges = [];
	{
		const ratios = new Float64Array(w);
		for (let x = 1; x < w; x += 1) {
			let changed = 0;
			let rows = 0;
			for (let y = 0; y < h; y += 3) {
				const a1 = at(x, y);
				const b1 = at(x - 1, y);
				const d = (Math.abs(a1[0] - b1[0]) + Math.abs(a1[1] - b1[1]) + Math.abs(a1[2] - b1[2])) / 3;
				if (d >= 2) changed += 1;
				rows += 1;
			}
			ratios[x] = rows === 0 ? 0 : changed / rows;
		}
		// 连续 ≥85% 变化的列聚成一条边；取其中最靠中间的值
		let run = null;
		for (let x = 1; x < w; x += 1) {
			if (ratios[x] >= 0.85) {
				if (run === null) run = { start: x, end: x };
				else run.end = x;
			} else if (run !== null) {
				vEdges.push(Math.round((run.start + run.end) / 2));
				run = null;
			}
		}
		if (run !== null) vEdges.push(Math.round((run.start + run.end) / 2));
		// 去掉图像边框（贴边那两条不是栏位边界），并把相距 ≤8px 的重复边合并
		const kept = vEdges.filter((x) => x >= 7 && x <= w - 8);
		vEdges.length = 0;
		for (const x of kept) {
			const last = vEdges[vEdges.length - 1];
			if (last !== undefined && x - last <= 10) continue;
			vEdges.push(x);
		}
	}

	/* 3) 列表/表格行节奏：用**窄竖条**采样，取节奏最稳的那一条
	 * 为什么不能用整条列带：表格型界面里侧栏与内容区往往连成一条宽列，
	 * 整行处处有内容 → 行间隙检测不出来（实测在线文档参考图：整列带法返回 null）。
	 * 窄竖条（~40px）只看一列文字，行与行之间的空白就显出来了。
	 * 顺带产出**行高一致性**：表格里某一行比其它行高/矮是典型缺陷。 */
	let pitch = null;
	let listStats = null;
	{
		const strips = [];
		// ① 各列带内取几条窄条
		for (const [left, right] of columns) {
			const bandW = right - left + 1;
			if (bandW < 60) continue;
			for (const frac of [0.15, 0.35, 0.55, 0.75]) {
				const sx = Math.round(left + bandW * frac);
				if (sx + 40 <= right) strips.push(sx);
			}
		}
		// ② 整幅均匀撒几条，兜住跨全宽的表
		for (let i = 1; i <= 10; i += 1) {
			const sx = Math.round((w * i) / 11);
			if (sx + 40 < w) strips.push(sx);
		}

		let best = null;
		for (const sx of strips) {
			const SW = 40;
			const buckets = new Map();
			for (let y = 0; y < h; y += 2) {
				for (let x = sx; x < sx + SW; x += 2) {
					const px = at(x, y);
					const k = `${px[0] >> 3},${px[1] >> 3},${px[2] >> 3}`;
					buckets.set(k, (buckets.get(k) ?? 0) + 1);
				}
			}
			const top = [...buckets.entries()].sort((a1, b1) => b1[1] - a1[1])[0];
			if (top === undefined) continue;
			const localBg = top[0].split(",").map((v) => Number(v) * 8);
			const starts = [];
			let blank = true;
			let runStart = 0;
			for (let y = 0; y < h; y += 1) {
				let has = false;
				for (let x = sx; x < sx + SW; x += 2) {
					const px = at(x, y);
					if (Math.abs(px[0] - localBg[0]) > 12 || Math.abs(px[1] - localBg[1]) > 12 || Math.abs(px[2] - localBg[2]) > 12) {
						has = true;
						break;
					}
				}
				if (has && blank) {
					blank = false;
					runStart = y;
				} else if (!has && !blank) {
					blank = true;
					if (y - runStart >= 4) starts.push(runStart);
				}
			}
			const gaps = [];
			for (let i = 1; i < starts.length; i += 1) {
				const g = starts[i] - starts[i - 1];
				if (g >= 12 && g <= h / 3) gaps.push(g);
			}
			if (gaps.length < 4) continue;
			const mean = gaps.reduce((a1, b1) => a1 + b1, 0) / gaps.length;
			const variance = gaps.reduce((a1, b1) => a1 + (b1 - mean) ** 2, 0) / gaps.length;
			const cv = Math.sqrt(variance) / mean;
			if (best === null || cv < best.cv) best = { cv, gaps, sx };
		}

		if (best !== null) {
			const sorted = [...best.gaps].sort((a1, b1) => a1 - b1);
			pitch = sorted[Math.floor(sorted.length / 2)];
			// 行高一致性：以中位数为基准，±15% 以内算“同一档”
			const within = best.gaps.filter((g) => g >= pitch * 0.85 && g <= pitch * 1.15);
			const outliers = best.gaps.filter((g) => g < pitch * 0.85 || g > pitch * 1.15);
			const uniformPct = Math.round((within.length / best.gaps.length) * 1000) / 10;
			listStats = {
				pitch,
				count: best.gaps.length,
				uniformPct,
				// 单行列表 vs 多行列表：邮件/聊天/卡片列表里每「行」含 2–3 行文字，
				// 行内行距会把间隙分布拉成双峰。这时「行高不一致」判据根本不成立
				// （实测邮箱界面：39 个间隙里 19 个偏离中位，51.3% —— 全是行内行距，
				// 却会被判成「19 行行高异常」）。低于 80% 一致就直接不做判断。
				singleLine: uniformPct >= 80,
				outliers: [...new Set(outliers)].sort((a1, b1) => a1 - b1).slice(0, 6),
				outlierCount: outliers.length,
				stripX: best.sx
			};
		}
	}

	/* 4) 卡片矩形：现代 UI 的基本单元是“卡片”，不是“色带”。
	 * 动机：拿一张渐变背景 + 柔和阴影的仪表板（下载工具）试，上面的列检测直接退回
	 * “整图一列”——因为渐变让 near(bg) 处处不成立。色带法只适合“大底色 + 规整栏位”，
	 * 一旦是卡片栅格就失效。
	 * 做法：近白像素 → 连通域 → 包围盒。卡片几乎总是近白（或至少比页面底色亮），
	 * 这个判据对渐变底、柔和阴影都稳。
	 * 阈值必须**相对页面底色**：视频站页面底色 #F6F7F9 三通道都 ≥246，固定 246 会把
	 * 整页底都当成“卡片面”，连通成一张 2072×1414 的巨块。 */
	const bgLum = 0.299 * bgRef[0] + 0.587 * bgRef[1] + 0.114 * bgRef[2];
	const surfaceThreshold = Math.min(254, Math.max(250, Math.round(bgLum) + 4));
	const cards = detectCards(at, w, h, surfaceThreshold);

	/* 5) 卡片栅格：x 起点聚类 = 列；y 起点聚类 = 行；间距按「同一行/同一列内相邻」算 */
	const cluster = (values, tol) => {
		const sorted = [...values].sort((a, b) => a - b);
		const out = [];
		for (const v of sorted) {
			const last = out[out.length - 1];
			if (last !== undefined && Math.abs(v - last) <= tol) continue;
			out.push(v);
		}
		return out;
	};
	const colStarts = cluster(cards.map((c) => c.x), 8);
	const rowStarts = cluster(cards.map((c) => c.y), 8);
	const horizontalGaps = () => {
		const out = [];
		for (const rowY of cluster(cards.map((c) => c.y), 8)) {
			const row = cards.filter((c) => Math.abs(c.y - rowY) <= 8).sort((a, b) => a.x - b.x);
			for (let i = 1; i < row.length; i += 1) {
				const gap = row[i].x - (row[i - 1].x + row[i - 1].w);
				if (gap >= 0 && gap <= w * 0.15) out.push(gap);
			}
		}
		return out.sort((a, b) => a - b);
	};
	const verticalGaps = () => {
		const out = [];
		for (const colX of cluster(cards.map((c) => c.x), 8)) {
			const col = cards.filter((c) => Math.abs(c.x - colX) <= 8).sort((a, b) => a.y - b.y);
			for (let i = 1; i < col.length; i += 1) {
				const gap = col[i].y - (col[i - 1].y + col[i - 1].h);
				if (gap >= 0 && gap <= h * 0.15) out.push(gap);
			}
		}
		return out.sort((a, b) => a - b);
	};
	const medianOf = (arr) => (arr.length === 0 ? null : arr[Math.floor(arr.length / 2)]);
	const hGaps = horizontalGaps();
	const vGaps = verticalGaps();

	return {
		palette,
		columns: columns.map(([a, b]) => ({ left: a, right: b, width: b - a + 1 })),
		rowPitch: pitch,
		list: listStats,
		vEdges,
		cards: cards.slice(0, 24),
		cardGrid: {
			count: cards.length,
			colStarts,
			rowStarts,
			colGap: medianOf(hGaps),
			rowGap: medianOf(vGaps),
			colGapSamples: hGaps.length,
			rowGapSamples: vGaps.length
		}
	};
}

/**
 * 卡片栅格剖面（对外暴露给 taste-image 复用）。
 *
 * 为什么直接复用而不是再写一个：卡片检测的坑（近白阈值必须相对页面底色、
 * 渐变底会让色带法整图变一列）都是 layout_check image 这边踩过并校准过的，
 * 在另一边重写一份等于重新踩一遍。
 */
export function cardGridOf(buffer) {
	const img = decodePng(buffer);
	const { cards, cardGrid } = layoutProfile(img);
	return { ...cardGrid, cards, width: img.width, height: img.height };
}

export function auditImage(buffer, { name = "image" } = {}) {
	const img = decodePng(buffer);
	const { width: w, height: h, channels, data } = img;
	if (w < 1 || h < 1) throw new Error(`PNG 尺寸非法：${w}x${h}`);
	const stride = w * channels;
	const alphaIdx = channels === 4 ? 3 : channels === 2 ? 1 : -1;

	/* ---------- 1. 透明度判定：决定用 alpha mask 还是背景色差 mask ---------- */
	let transparent = false;
	if (alphaIdx >= 0) {
		for (let i = alphaIdx; i < data.length; i += channels) {
			if (data[i] < ALPHA_OPAQUE) {
				transparent = true;
				break;
			}
		}
	}
	const bg = transparent ? null : estimateBackground(img);

	/* ---------- 2. 一次扫描：mask + 包围盒 + 四半区像素数/视觉重量 ---------- */
	const mask = new Uint8Array(w * h);
	const colHas = new Uint8Array(w);
	const rowHas = new Uint8Array(h);
	let count = 0;
	let minX = w;
	let minY = h;
	let maxX = -1;
	let maxY = -1;
	let leftN = 0;
	let rightN = 0;
	let topN = 0;
	let bottomN = 0;
	let leftW = 0;
	let rightW = 0;
	let topW = 0;
	let bottomW = 0;
	const cx = (w - 1) / 2;
	const cy = (h - 1) / 2;
	for (let y = 0; y < h; y += 1) {
		const rowBase = y * stride;
		for (let x = 0; x < w; x += 1) {
			const i = rowBase + x * channels;
			let content;
			if (transparent) {
				content = alphaIdx >= 0 ? data[i + alphaIdx] > ALPHA_CONTENT : true;
			} else {
				// channels=1/2 时 RGB 同值（灰度），channels>=3 时取前三个通道
				const r = data[i];
				const g = channels >= 3 ? data[i + 1] : r;
				const b = channels >= 3 ? data[i + 2] : r;
				const dr = r - bg.r;
				const dg = g - bg.g;
				const db = b - bg.b;
				content = dr * dr + dg * dg + db * db > BG_DIST_SQ;
			}
			if (!content) continue;
			mask[y * w + x] = 1;
			count += 1;
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
			colHas[x] = 1;
			rowHas[y] = 1;
			const dx = Math.abs(x - cx);
			const dy = Math.abs(y - cy);
			if (x < cx) {
				leftN += 1;
				leftW += dx;
			} else {
				rightN += 1;
				rightW += dx;
			}
			if (y < cy) {
				topN += 1;
				topW += dy;
			} else {
				bottomN += 1;
				bottomW += dy;
			}
		}
	}

	/* ---------- 3. 指标 ---------- */
	const box = count > 0 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : { x: 0, y: 0, w: 0, h: 0 };
	// 无内容时 margin 记 0（用 contentPixels===0 区分「没有内容」与「内容贴边」），规则另有 count>0 守卫
	const marginPx =
		count > 0
			? { left: minX, top: minY, right: w - 1 - maxX, bottom: h - 1 - maxY }
			: { left: 0, top: 0, right: 0, bottom: 0 };
	const marginsPct = {
		left: round2((marginPx.left / w) * 100),
		top: round2((marginPx.top / h) * 100),
		right: round2((marginPx.right / w) * 100),
		bottom: round2((marginPx.bottom / h) * 100)
	};
	const coverage = count / (w * h);
	const balance = {
		lr: count > 0 ? round2((rightN - leftN) / count) : 0, // 正 = 右侧重
		tb: count > 0 ? round2((bottomN - topN) / count) : 0 // 正 = 下侧重
	};
	const weightBalance = {
		lr: count > 0 ? round2(leftW + rightW > 0 ? (rightW - leftW) / (leftW + rightW) : 0) : 0,
		tb: count > 0 ? round2(topW + bottomW > 0 ? (bottomW - topW) / (topW + bottomW) : 0) : 0
	};
	const colSegs = contentRuns(colHas, MIN_RUN);
	const rowSegs = contentRuns(rowHas, MIN_RUN);
	const coveragePct = round2(coverage * 100);
	// 稀疏版面（纯文字/线稿）不做构图类判定，避免把正常的文字排版当成失衡
	const sparse = coverage < SUBSTANTIAL_COVERAGE;
	const findings = [];

	// 满血版面：四边都 <2% → 应用窗口截图 / 全屏布局，边距类规则不适用
	const fullBleed = count > 0 && [marginsPct.left, marginsPct.top, marginsPct.right, marginsPct.bottom].every((v) => v < FULL_BLEED_MAX_PCT);

	/* ---------- 4. 规则 ---------- */

	// P1 内容贴边/出血不足：逐边报（每条边的修法不同，合成一条反而不好改）。
	// 满血版面跳过：应用窗口铺满窗口是设计本身，不是缺陷。
	if (count > 0 && !fullBleed) {
		for (const side of ["left", "top", "right", "bottom"]) {
			const pct = marginsPct[side];
			if (pct >= MARGIN_WARN_PCT) continue;
			const isError = pct < MARGIN_ERROR_PCT;
			findings.push(
				finding({
					severity: isError ? "error" : "warn",
					rule: "P1",
					where: `margin:${side}`,
					message: isError
						? `${SIDE_CN[side]}边距只有 ${pct}%（<2%）：内容贴边/出血不足，裁切、圆角遮罩或屏幕边缘会切到内容`
						: `${SIDE_CN[side]}边距 ${pct}%（<4%）：留白不足，看起来像排版没收尾、内容顶到画布边缘`,
					fix: `把${SIDE_CN[side]}边距提到 6–8%（1000px 画布约 60–80px）；海报/截图都留安全边，别让内容顶边`
				})
			);
		}
	}

	// P2 边距严重不对称（满血版面边距都没意义，跳过）
	if (count > 0 && !sparse && !fullBleed) {
		const four = Object.values(marginsPct);
		const minPct = Math.min(...four);
		const maxPct = Math.max(...four);
		const ratio = minPct === 0 ? Infinity : maxPct / minPct;
		const ratioBad = ratio > ASYM_RATIO && minPct < ASYM_MIN_PCT;
		let edgeBad = false;
		for (const [side, opposite] of [
			["left", "right"],
			["right", "left"],
			["top", "bottom"],
			["bottom", "top"]
		]) {
			if (marginsPct[side] > ASYM_SINGLE_MAX_PCT && marginsPct[opposite] < ASYM_OPPOSITE_MIN_PCT) edgeBad = true;
		}
		if (ratioBad || edgeBad) {
			const ratioText = ratio === Infinity ? "∞" : `${round2(ratio)}x`;
			findings.push(
				finding({
					severity: "warn",
					rule: "P2",
					message:
						`边距严重不对称：左 ${marginsPct.left}% / 右 ${marginsPct.right}% / 上 ${marginsPct.top}% / 下 ${marginsPct.bottom}%` +
						`（${ratioBad ? `最大/最小 = ${ratioText}，最窄边 <${ASYM_MIN_PCT}%` : `单边 >${ASYM_SINGLE_MAX_PCT}% 且对边 <${ASYM_OPPOSITE_MIN_PCT}%`}）`,
					fix: `四条边距应落在同一量级（同一视觉栅格）：把最窄边加宽、或把最宽边收窄到 6–8% 那一档`
				})
			);
		}
	}

	// P3 密度异常（拥挤 / 过空）。
	// **满血版面（应用窗口截图）不做密度判定**：窗口本来就铺满整个画布，
	// 留白不存在是正常的。实测：安全软件、邮箱客户端两张界面截图都被报
	// 「覆盖率 99%，画面过满」——那是把「截图边界」当成了「设计留白」。
	if (!fullBleed && coverage > CROWDED_COVERAGE) {
		findings.push(
			finding({
				severity: "warn",
				rule: "P3",
				where: `coverage:${coveragePct}%`,
				message: `内容覆盖率 ${coveragePct}%（>85%）：画面过满、几乎没有留白，观感会闷（海报/截图也需要呼吸区）`,
				fix: `删掉次要元素或加大画布，把留白提到 15–40%；拥挤图先按「一屏一个主信息」砍内容`
			})
		);
	} else if (coverage < EMPTY_COVERAGE) {
		findings.push(
			finding({
				severity: "warn",
				rule: "P3",
				where: `coverage:${coveragePct}%`,
					message:
					`内容覆盖率仅 ${coveragePct}%（<${round2(EMPTY_COVERAGE * 100)}%）：画面几乎是空的；也可能整张图是纯白/纯透明底、内容根本没渲染出来` +
					`（先确认渲染链路，再判断是不是设计上过空）`,
				fix: `确认体检的是内容图而不是空白占位图；若确实过空，放大主体或加视觉锚点（标题/图形/色块）`
			})
		);
	}

	// P4 视觉失衡：像素数与视觉重量都算，任一轴超 25% 即报（稀疏版面不做构图判定）。
	if (count > 0 && !sparse) {
		const candidates = [
			{ axis: "lr", side: balance.lr > 0 ? "右" : "左", label: "左右内容像素差", abs: Math.abs(balance.lr) },
			{ axis: "tb", side: balance.tb > 0 ? "下" : "上", label: "上下内容像素差", abs: Math.abs(balance.tb) },
			{ axis: "wlr", side: weightBalance.lr > 0 ? "右" : "左", label: "左右视觉重量差", abs: Math.abs(weightBalance.lr) },
			{ axis: "wtb", side: weightBalance.tb > 0 ? "下" : "上", label: "上下视觉重量差", abs: Math.abs(weightBalance.tb) }
		];
		const worst = candidates.reduce((a, b) => (b.abs > a.abs ? b : a));
		if (worst.abs > BALANCE_LIMIT) {
			const detail =
				`左右像素差 ${Math.round(Math.abs(balance.lr) * 100)}% · 上下像素差 ${Math.round(Math.abs(balance.tb) * 100)}% · ` +
				`左右视觉重量差 ${Math.round(Math.abs(weightBalance.lr) * 100)}% · 上下视觉重量差 ${Math.round(Math.abs(weightBalance.tb) * 100)}%`;
			findings.push(
				finding({
					severity: "warn",
					rule: "P4",
					where: `side:${worst.side}`,
					message: `视觉失衡：重心偏${worst.side}（${worst.label} ${Math.round(worst.abs * 100)}% > ${BALANCE_LIMIT * 100}%）；${detail}`,
					fix:
						`把重心拉回画布中心：重的一侧减量/缩小，或在对侧补同量级内容；主体优先按居中或 1/3 黄金分割摆。` +
						// 静态上下文，不做「外壳检测」——试过用像素判侧栏，下载工具测不出、视频站测错位置，
						// 靠不住。宁可不猜，把判断依据交给调用方。
						`若本图是「侧边导航 + 内容区」的作业型界面，左右不对称通常是设计意图，确认后再决定是否改`
				})
			);
		}
	}

	// P5 对齐混乱：块结构来自行带内的列 run（块的左边界 = 块起点）
	if (count > 0 && rowSegs.length > 0 && !sparse) {
		const bands = [];
		for (const seg of rowSegs) {
			// 单次总成本 O(非空行数 × 宽) ≤ O(画布像素)，不会因为行带多而爆
			const bandCol = new Uint8Array(w);
			for (let y = seg.start; y <= seg.end; y += 1) {
				const base = y * w;
				for (let x = 0; x < w; x += 1) if (mask[base + x] === 1) bandCol[x] = 1;
			}
			const blocks = contentRuns(bandCol, MIN_RUN);
			if (blocks.length === 0) continue;
			bands.push({
				left: blocks[0].start,
				right: blocks[blocks.length - 1].end,
				center: (blocks[0].start + blocks[blocks.length - 1].end) / 2
			});
		}
		// P5a：块起点 ≥5 个且没有两条重合（最大簇只有 1）→ 找不到对齐关系
		const clusters = clusterStarts(
			bands.map((b) => b.left),
			START_TOL_PX
		);
		const maxCluster = clusters.reduce((m, c) => Math.max(m, c.count), 0);
		if (clusters.length >= START_CHAOS_MIN && maxCluster === 1) {
			findings.push(
				finding({
					severity: "info",
					rule: "P5",
					where: `blocks:${clusters.length}`,
					message: `块结构没有对齐关系：${clusters.length} 个块起点互不相同（容差 ${START_TOL_PX}px），没有两块共享同一条左边线`,
					fix: `把各块起点收敛到 1–2 条对齐线（首选统一左对齐栅格）；块多时用列栅格而不是各自定位`
				})
			);
		}
		// P5b：≥2 种对齐方式同时大量存在（各 ≥2 个行带）
		const tol = Math.max(START_TOL_PX, Math.round(Math.min(w, h) * 0.005));
		const modes = { left: 0, center: 0, right: 0 };
		const boxRight = box.x + box.w - 1;
		const boxCenter = box.x + (box.w - 1) / 2;
		for (const band of bands) {
			const hits = [];
			if (Math.abs(band.left - box.x) <= tol) hits.push("left");
			if (Math.abs(band.right - boxRight) <= tol) hits.push("right");
			if (Math.abs(band.center - boxCenter) <= tol) hits.push("center");
			// 命中 0 或 ≥2 种（例如满宽行）都不算对齐证据
			if (hits.length === 1) modes[hits[0]] += 1;
		}
		const bigModes = Object.entries(modes).filter(([, n]) => n >= ALIGN_MIN_BANDS);
		if (bigModes.length >= 2) {
			findings.push(
				finding({
					severity: "warn",
					rule: "P5",
					where: `align:${bigModes.map(([mode]) => mode).join("+")}`,
					message: `对齐方式混乱：${bigModes.map(([mode, n]) => `${MODE_CN[mode]}对齐 ${n} 个内容带`).join("、")} 同时存在，视线要左右跳`,
					fix: `整张图统一一种对齐（正文左对齐最稳），最多保留一种刻意的居中标题；别在同层混用左/右对齐`
				})
			);
		}
	}

	// P6 分辨率过低
	const minSide = Math.min(w, h);
	if (minSide < RES_WARN) {
		findings.push(
			finding({
				severity: "warn",
				rule: "P6",
				where: `canvas:${w}x${h}`,
				message: `分辨率 ${w}×${h} 偏小（短边 <${RES_WARN}px）：位图放大后文字/1px 描边会糊`,
				fix: `按最终展示尺寸的 1.5–2 倍导出（短边至少 ${RES_WARN}px，大屏建议 ≥1200px），用时再缩小`
			})
		);
	} else if (minSide < RES_INFO) {
		findings.push(
			finding({
				severity: "info",
				rule: "P6",
				where: `canvas:${w}x${h}`,
				message: `分辨率 ${w}×${h} 一般（短边 <${RES_INFO}px）：小屏够用，大屏/印刷会发虚`,
				fix: `需要大屏或印刷就再导一份短边 ≥1200px 的版本（矢量源另存，别靠放大位图）`
			})
		);
	}

	/* ---------- P8 卡片栅格一致性 ----------
	 * 既然能量出卡片矩形，就能查「栅格到底齐不齐」——这是卡片型 UI 最经典的一类缺陷：
	 * 同一行的卡片宽度差 3px、列间距一处 24 一处 32，肉眼说不出哪里不对，但整页就是“飘”。
	 * 实测（下载工具仪表板）：4 列 KPI 宽 246/246/245/246、间距 24/24，直接判齐。
	 * 只在真的检测到栅格时才判（至少 2 行或 2 列），避免把非卡片布局误判。 */
	const profile = transparent ? null : layoutProfile(img, bg);
	if (!transparent) {
		const cards = profile.cards;
		const tol = 4; // 抗锯齿与圆角会让 1–2px 抖动，4px 才是有意义的不齐
		if (cards.length >= 4) {
			// 按行分组：y 相近的算同一行
			const rowsOfCards = [];
			for (const card of [...cards].sort((a, b) => a.y - b.y)) {
				const row = rowsOfCards.find((r) => Math.abs(r.y - card.y) <= 8);
				if (row === undefined) rowsOfCards.push({ y: card.y, items: [card] });
				else row.items.push(card);
			}
			const issues = [];
			for (const row of rowsOfCards) {
				if (row.items.length < 2) continue;
				const sorted = [...row.items].sort((a, b) => a.x - b.x);
				const widths = sorted.map((c) => c.w);
				// 只判「真栅格」：同一行 ≥3 张、且最大/最小宽度比 ≤2.5。
				// 实测反例：在线文档参考图里主内容区（1081px）与右侧工具面板（478px）并排，
				// 它们是不同性质的面板，本来就该不等宽——不设这条会误报“栅格不齐 差 603px”。
				if (sorted.length < 3 || Math.max(...widths) / Math.max(1, Math.min(...widths)) > 2.5) continue;
				const gaps = [];
				for (let i = 1; i < sorted.length; i += 1) gaps.push(sorted[i].x - (sorted[i - 1].x + sorted[i - 1].w));
				if (Math.max(...widths) - Math.min(...widths) > tol) {
					issues.push(`y≈${Math.round(row.y)} 这行卡片宽 ${widths.join("/")} 差 ${Math.max(...widths) - Math.min(...widths)}px`);
				}
				if (gaps.length >= 2 && Math.max(...gaps) - Math.min(...gaps) > tol) {
					issues.push(`y≈${Math.round(row.y)} 这行列间距 ${gaps.join("/")} 不一致`);
				}
			}
			if (issues.length > 0) {
				findings.push(
					finding({
						severity: "warn",
						rule: "P8",
						message: `卡片栅格不齐：${issues.slice(0, 3).join("；")}`,
						fix: `同一行的卡片宽度与列间距应完全一致（用栅格系统或 flex:1 + 统一 gap，不要逐个手调宽度；差 >${tol}px 人眼就能看出“飘”）`
					})
				);
			}
		}
	}

	/* ---------- P9 列表/表格行高一致性 ----------
	 * 表格与列表是办公类界面最密集的部分，而「某一行比其它行高/矮」是这类界面
	 * 最典型、也最难靠眼睛发现的缺陷（尤其行数多的时候）。
	 * 判据来自 profile.list：以中位行距为基准，±15% 以内算同一档。
	 * 实测校准：在线文档参考表 10 行 100% 一致（不报）、视频站动态 17 行 94.1%（不报）、
	 * 故意做歪的合成表 10 行 90%（报，含一个双倍高行）。
	 * 阈值取 <93：92–95% 这一带在真实界面里常是“某一行文字换行了”，属可接受范围。
	 * 样本 <6 时行距本身没有统计意义，直接跳过。
	 */
	if (!transparent) {
		const listInfo = profile.list;
		if (listInfo !== null && listInfo !== undefined && listInfo.count >= 6 && listInfo.singleLine === true && listInfo.uniformPct < 93) {
			findings.push(
				finding({
					severity: "warn",
					rule: "P9",
					where: `list:${listInfo.count}行`,
					message:
						`列表行高不一致：${listInfo.count} 行里 ${listInfo.outlierCount} 行偏离中位 ${listInfo.pitch}px（一致性 ${listInfo.uniformPct}%）` +
						(listInfo.outliers.length === 0 ? "" : `，异常间距 ${listInfo.outliers.join("/")}px`),
					fix: `表格/列表的行高应该是同一档：给行设固定 height 或统一的 padding，文字超长用省略号而不是自动换行撑高——换行的那一行会把整张表的节奏打乱`
				})
			);
		}
	}

	/* 关于「区块间距挤压」为什么没做成规则（记录下来，避免重复尝试）：
	 * 真实缺陷：参照改造时用 `margin-top:-12px` 把表格硬拉上去，导致 tabs 下划线与表头贴死。
	 * 试过在像素上判「块间间距 < 块内间距的一半」，结果**全线误报**：
	 *   视频站 gap 1px/中位 7px、下载工具 gap 3px/中位 27px、连修好的版本也报——
	 *   因为像素层面**无法可靠区分「段落内的行距」与「区块之间的间距」**，
	 *   两者都是“文字行之间的空白”，要区分必须先做块分组，而块分组在密集界面里不可靠。
	 * 结论：这条改由 CSS 侧的 S14（负外边距）抓根因。宁可不报，也不要报错的。
	 * （同样的取舍记录也见「应用外壳检测」：两种像素判据都不可靠，最后改为静态提示。）
	 */

	// P7 能力边界（固定 info，文案固定）
	findings.push(
		finding({
			severity: "info",
			rule: "P7",
			message: "本模式不做文字/对比度检测（无 OCR），排版文字问题请用 action=ui / action=svg",
			fix: "文字可读性/字号/对比度：action=ui 看 HTML/CSS 源码，action=svg 看成品矢量文字几何"
		})
	);

	/* ---------- 5. 统一算分（common.js） ---------- */
	return finalize({
		mode: "image",
		target: name,
		metrics: {
			canvas: [w, h],
			contentBox: box,
			marginsPct,
			coveragePct,
			balance,
			segments: { cols: colSegs.length, rows: rowSegs.length },
			contentPixels: count,
			weightBalance,
			background: transparent ? "transparent" : toHex(bg),
			// 覆盖度声明：clean 但 rulesRun=0 时，调用方要能看出「什么都没测」，而不是「测了且过了」。
			rulesRun: 7 - (fullBleed ? 2 : 0) + ((profile?.cards?.length ?? 0) >= 4 ? 1 : 0) + ((profile?.list?.count ?? 0) >= 6 ? 1 : 0),
			measured: [
				"边距/出血",
				"密度",
				"视觉平衡",
				"对齐",
				"分辨率",
				...((profile?.cards?.length ?? 0) >= 4 ? [`卡片栅格×${profile.cards.length}`] : []),
				...((profile?.list?.count ?? 0) >= 6 ? [`列表行高×${profile.list.count}`] : [])
			],
			// 满血版面：边缘贴边是应用窗口的正常形态，P1/P2 已跳过。
			// 告诉调用方「为什么没报贴边」，避免以为检查漏了。
			...(fullBleed ? { fullBleed: true, skippedRules: ["P1", "P2"] } : {}),
			// 版式剖面：参照改造时用来“量原图”，不进评分、不产生 findings。
			...(profile ? { profile } : {})
		},
		findings
	});
}
