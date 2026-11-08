/**
 * icondb.js — 内置 lucide 图标数据库：惰性加载 + 名称解析 + 关键词检索。
 *
 * data/lucide-icons.json 由 tools/build-icon-data.mjs 生成（源：lucide@1.70.0，ISC；
 * 另含 lucide-static tags 与 lucide.dev 43 类目）。首次工具调用时一次性载入
 * （约 0.91 MB），进程内缓存。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "lucide-icons.json");
const PACKS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "packs");

// codereview #486：检索结果条数上限（search 的 Math.min 上界）——具名常量便于统一调整。
const MAX_RESULTS = 50;

// codereview #485：名字并列比较抽出为单层三元的助手——原先是排序器里的嵌套三元
//（项目规范禁止）；刻意不用 localeCompare（其 collation 会改变代码单元序，
// 现有结果顺序是对外可观测行为，必须逐字节保持）。
function cmpName(x, y) {
	return x < y ? -1 : x > y ? 1 : 0;
}

let db = null;
let aliasIndex = null; // alias(kebab) → 主名(kebab)
let categoryIndex = null; // category → [主名]，用于「arrows/files 类目词」检索预过滤
let tagDf = null; // tag → 出现图标数，用于给常见 tag 降权（tags 共享词汇噪声大）
// 审查修复 #283：lucide 名→条目 Map 在 load() 一次构建并缓存——原先
// normalizeName/getIcon 每次调用都 new Map(Object.entries(...)) 重建 ~1600 条
let lucideEntryByName = null;

/** 可选数据包（v0.3.0）：name → { raw, entryByName, aliasIndex }；PACK_ORDER 记注册序。 */
const packs = new Map();
const PACK_ORDER = [];

function load() {
	if (db !== null) return db;
	// codereview #484：包文件缺失/JSON 损坏不再裸抛 ENOENT/SyntaxError——附上路径，
	// 调用方能直接定位是哪个数据文件坏了（apply 的 iconPacks 循环按原样 catch 跳过）。
	let raw;
	try {
		raw = JSON.parse(readFileSync(DATA_PATH, "utf8"));
	} catch (error) {
		throw new Error(`uilab 图标数据库不可读：${DATA_PATH}（${error?.message ?? error}）`);
	}
	db = raw;
	aliasIndex = new Map();
	lucideEntryByName = new Map(Object.entries(raw.icons));
	categoryIndex = new Map();
	tagDf = new Map();
	for (const [name, entry] of lucideEntryByName) {
		for (const alias of entry.aliases ?? []) {
			if (!aliasIndex.has(alias)) aliasIndex.set(alias, name);
		}
		for (const category of entry.categories ?? []) {
			if (!categoryIndex.has(category)) categoryIndex.set(category, []);
			categoryIndex.get(category).push(name);
		}
		for (const tag of entry.tags ?? []) tagDf.set(tag, (tagDf.get(tag) ?? 0) + 1);
	}
	return db;
}

/** 注册可选图标包（data/packs/<name>.icons.json，tools/build-icon-data.mjs --pack 生成）。
 * 幂等；opts.dataDir 可覆盖包目录（自测用）。 */
function registerPack(packName, opts = {}) {
	const dir = opts.dataDir ?? PACKS_DIR;
	const existing = packs.get(packName);
	if (existing !== undefined) {
		// codereview #484：同名包从不同目录重复注册时不再静默返回旧缓存——那会让
		// 调用方拿到与请求目录不符的数据（自测场景尤甚）；同一来源仍幂等早退。
		if (existing.dir !== dir) {
			throw new Error(`icon pack "${packName}" 已从 ${existing.dir} 注册，本次请求的是 ${dir}——同源重复注册才幂等`);
		}
		return existing;
	}
	const file = join(dir, `${packName}.icons.json`);
	let raw;
	try {
		raw = JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(`icon pack 文件不可读：${file}（${error?.message ?? error}）`);
	}
	if (raw.pack !== packName) throw new Error(`pack name mismatch: file declares "${raw.pack}", requested "${packName}"`);
	const entryByName = new Map(Object.entries(raw.icons ?? {}));
	const packAlias = new Map();
	for (const [name, entry] of entryByName) {
		for (const a of entry.aliases ?? []) {
			if (!packAlias.has(a)) packAlias.set(a, name);
		}
	}
	const rec = { raw, dir, entryByName, aliasIndex: packAlias };
	packs.set(packName, rec);
	PACK_ORDER.push(packName);
	return rec;
}

/** kebab → PascalCase（a-arrow-down → AArrowDown） */
function kebabToPascal(kebab) {
	return String(kebab).split("-").map((p) => (p === "" ? p : p[0].toUpperCase() + p.slice(1))).join("");
}

/** kebab → camelCase（chevron-down → chevronDown，Colibri ICONS 命名约定） */
function kebabToCamel(kebab) {
	const p = kebabToPascal(kebab);
	return p === "" ? p : p[0].toLowerCase() + p.slice(1);
}

/** 在单个「名→条目」源内解析任意大小写形态；返回主名或 undefined。 */
function resolveIn(entryByName, sourceAlias, input) {
	const raw = String(input ?? "").trim();
	if (raw === "") return undefined;
	const candidates = [raw, raw.toLowerCase()];
	const kebabed = raw.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2").toLowerCase();
	if (!candidates.includes(kebabed)) candidates.push(kebabed);
	for (const c of candidates) {
		if (entryByName.has(c)) return c;
		if (sourceAlias.has(c)) return sourceAlias.get(c);
	}
	return undefined;
}

/** 任意大小写形态 → kebab 主名（lucide 库）；解析失败返回 undefined。 */
function normalizeName(input) {
	load();
	return resolveIn(lucideEntryByName, aliasIndex, input);
}

/** 取图标完整条目；支持 kebab / Pascal / camel / 别名，及 "pack:name" 显式语法；
 * 无显式包名时 lucide 优先，其次按注册顺序查 packs。 */
function getIcon(input) {
	load();
	const raw0 = String(input ?? "").trim();
	if (raw0 === "") return undefined;
	if (raw0.includes(":")) {
		const idx = raw0.indexOf(":");
		const rec = packs.get(raw0.slice(0, idx));
		if (rec !== undefined) {
			const name = resolveIn(rec.entryByName, rec.aliasIndex, raw0.slice(idx + 1));
			if (name !== undefined) return buildEntry(raw0.slice(0, idx), name, rec.entryByName.get(name));
		}
	}
	const lucideName = resolveIn(lucideEntryByName, aliasIndex, raw0);
	if (lucideName !== undefined) return buildEntry("lucide", lucideName, lucideEntryByName.get(lucideName));
	for (const pn of PACK_ORDER) {
		const rec = packs.get(pn);
		const name = resolveIn(rec.entryByName, rec.aliasIndex, raw0);
		if (name !== undefined) return buildEntry(pn, name, rec.entryByName.get(name));
	}
	return undefined;
}

function buildEntry(pack, name, entry) {
	return {
		name,
		pack,
		pascal: entry.pascal,
		camel: kebabToCamel(name),
		aliases: [...(entry.aliases ?? [])],
		node: entry.node,
		...(entry.tags !== undefined ? { tags: [...entry.tags] } : {}),
		...(entry.categories !== undefined ? { categories: [...entry.categories] } : {})
	};
}

/** 图标总数与数据源信息（含已注册 packs）。 */
function meta() {
	load();
	return {
		version: db.source.version,
		license: db.source.license,
		iconCount: db.iconCount,
		aliasCount: aliasIndex.size,
		tagged: db.tagCount ?? 0,
		categories: db.categoryCount ?? 0,
		packs: PACK_ORDER.map((name) => ({ name, iconCount: packs.get(name)?.raw?.iconCount ?? 0 }))
	};
}

/** 单图标形状摘要，如 "2×path + 1×circle"。 */
function shapeSummary(node) {
	const counts = new Map();
	for (const [tag] of node) counts.set(tag, (counts.get(tag) ?? 0) + 1);
	return [...counts.entries()].map(([tag, n]) => `${n}×${tag}`).join(" + ");
}

// codereview #487：原先悬在 SYNONYMS 之上的一段「关键词检索：精确 > 前缀 > 包含 >
// 分词子集」JSDoc 描述的是已被取代的旧排序阶梯，且与 search() 处的最新文档重复、
// 位置又误导读者以为它属于同义词表——已删除（现行行为以 search() 的文档为准）。
/**
 * 中英同义词表（v0.3.0）：查询词 → lucide 检索 token 扩展。
 * 背景：lucide 官方 tags 元数据不随 npm 分发（见 docs/方案对标评估），
 * 自建高频 UI 词汇的中英/同义映射补齐语义检索。命中的 token 以扩展集
 * 参与覆盖率计分（中文词借此命中英文名；英文同义词借此互相打通）。
 */
const SYNONYMS = {
	// 中文 → lucide 英文 token
	加载: ["loader", "spinner", "loading"], 加载中: ["loader", "loader-circle"],
	完成: ["check", "done", "success"], 成功: ["check", "circle-check"], 失败: ["x", "circle-x"],
	关闭: ["x", "close"], 菜单: ["menu"], 汉堡: ["menu"],
	搜索: ["search"], 放大镜: ["search"], 设置: ["settings"], 齿轮: ["settings", "cog"],
	删除: ["trash", "delete"], 垃圾桶: ["trash"], 编辑: ["edit", "pencil"], 铅笔: ["pencil", "edit"],
	下载: ["download"], 上传: ["upload"], 播放: ["play"], 暂停: ["pause"],
	主题: ["sun", "moon"], 太阳: ["sun"], 月亮: ["moon"],
	用户: ["user"], 个人: ["user"], 人物: ["users", "user"],
	通知: ["bell"], 铃: ["bell"], 提醒: ["bell", "alarm"],
	添加: ["plus"], 新增: ["plus"], 复制: ["copy"], 克隆: ["copy"],
	刷新: ["refresh", "refresh-cw"], 同步: ["refresh-cw"], 返回: ["arrow-left"],
	首页: ["home"], 主页: ["home"], 时间: ["clock"], 时钟: ["clock"], 日历: ["calendar"],
	// 形状/符号：中文几乎总是带量词或形状一起说（"心形图标""加号按钮"），不映射就 0 命中
	心形: ["heart"], 星形: ["star"], 圆形: ["circle"], 方形: ["square"], 三角: ["triangle"],
	加号: ["plus"], 减号: ["minus"], 叉号: ["x"], 对勾: ["check"], 箭头: ["arrow"], 圆点: ["dot"],
	猫: ["cat"], 狗: ["dog"], 心: ["heart"], 收藏: ["heart", "star", "bookmark"], 点赞: ["thumbs-up", "heart"],
	分享: ["share"], 锁: ["lock"], 锁定: ["lock"], 安全: ["shield", "lock"], 盾: ["shield"],
	眼睛: ["eye"], 可见: ["eye"], 邮件: ["mail", "email"], 电话: ["phone"],
	相机: ["camera"], 拍照: ["camera"], 图片: ["image"], 照片: ["image"],
	文件: ["file"], 文档: ["file-text", "file"], 文件夹: ["folder"], 目录: ["folder"],
	链接: ["link"], 警告: ["triangle-alert"], 警示: ["triangle-alert"],
	信息: ["info"], 帮助: ["circle-help"], 问号: ["circle-help"],
	星: ["star"], 评分: ["star"], 举报: ["flag"], 旗帜: ["flag"],
	// 英文同义（库内无同名图标或语义分叉的场景）
	spinner: ["loader", "loader-circle"], done: ["check"], success: ["check", "circle-check"],
	close: ["x"], dismiss: ["x"], hamburger: ["menu"], magnifier: ["search"],
	gear: ["settings"], cog: ["settings"], remove: ["trash"], reload: ["refresh-cw"],
	sync: ["refresh-cw"], favorite: ["heart", "star"], like: ["thumbs-up", "heart"],
	notification: ["bell"], add: ["plus"], clone: ["copy"], photo: ["image"], picture: ["image"],
	document: ["file-text", "file"], alert: ["triangle-alert"], question: ["circle-help"],
	rating: ["star"], report: ["flag"], people: ["users"], person: ["user"],
	// 2026-11-07 扩充：tags 是英文的，中文查询靠这层打通（常用 UI 名词/动作）
	垃圾: ["trash"], 垃圾桶: ["trash"], 箭头: ["arrow-right"], 房子: ["house"],
	住宅: ["house"], 建筑: ["building"], 导航: ["navigation"], 定位: ["map-pin"],
	地图: ["map"], 购物车: ["shopping-cart"], 钱包: ["wallet"], 银行卡: ["credit-card"],
	礼物: ["gift"], 钥匙: ["key"], 奖杯: ["trophy"], 咖啡: ["coffee"],
	汽车: ["car"], 飞机: ["plane"], 火车: ["train-front"], 地球: ["globe"],
	云: ["cloud"], 水滴: ["droplet"], 火焰: ["flame"], 闪电: ["zap"],
	火箭: ["rocket"], 大脑: ["brain"], 书: ["book"], 保存: ["save"],
	打印: ["printer"], 扫描: ["scan"], 二维码: ["qr-code"], 网格: ["grid-3x3"],
	列表: ["list"], 表格: ["table"], 图表: ["chart-line"], 趋势: ["trending-up"],
	数据库: ["database"], 服务器: ["server"], 网络: ["wifi"], 蓝牙: ["bluetooth"],
	电池: ["battery"], 充电: ["battery-charging"], 电源: ["power"], 扳手: ["wrench"],
	锤子: ["hammer"], 音量: ["volume-2"], 静音: ["volume-x"], 快进: ["skip-forward"],
	快退: ["skip-back"], 消息: ["message-square"], 聊天: ["messages-square"], 视频: ["video"],
	音乐: ["music"], 麦克风: ["mic"], 耳机: ["headphones"], 摄像头: ["camera"]
};

/** 查询 token 集合 → 含同义词扩展的 Map<token, 权重>：原词权重 1，
 * 同义词按列表顺序递减（0.5 / 0.33 / 0.25）——「删除→trash,delete」时
 * trash 比 delete 更能代表查询意图。 */
/**
 * 风格意图：「实心 / 填充 / filled」要 -filled 变体，「线性 / 描边 / outline」要描边版。
 * tabler 有 1088 个 -filled 图标，但名字只认英文 Filled——不映射就 0 命中，
 * 模型会得出「库里没有填充图标」的错误结论。
 */
const STYLE_INTENT = [
	{ style: "filled", re: /实心|填充|实底|填色|\b(?:filled|solid)\b/ },
	{ style: "outline", re: /线性|线框|描边|轮廓|\boutline\b/ }
];

/** 常见中文品牌名 → tabler brand-* 英文名（tabler 有 411 个品牌图标，名字只认英文）。 */
const BRAND_ALIAS = {
	微信: "wechat", 淘宝: "taobao", 支付宝: "alipay", 抖音: "tiktok", 微博: "weibo", 知乎: "zhihu",
	哔哩哔哩: "bilibili", 钉钉: "dingtalk", 飞书: "lark", 美团: "meituan", 京东: "jd", 百度: "baidu",
	网易: "netease", 小红书: "xiaohongshu", 谷歌: "google", 苹果: "apple", 微软: "microsoft", 亚马逊: "amazon"
};
const BRAND_INTENT = /品牌|标志|商标|\bbrand\b|\blogo\b/;

function expandTokens(tokens) {
	const weights = new Map();
	for (const t of tokens) {
		if (!weights.has(t)) weights.set(t, 1);
		(SYNONYMS[t] ?? []).forEach((syn, i) => {
			const w = 1 / (i + 2);
			if (!weights.has(syn) || weights.get(syn) < w) weights.set(syn, w);
		});
	}
	return weights;
}

/** 单字符 token（如 x）按词边界匹配，避免 axe/box 这类包含 x 的子串混入。 */
function nameHasToken(name, token) {
	if (token.length > 1) return name.includes(token);
	return name === token || name.startsWith(`${token}-`) || name.endsWith(`-${token}`);
}
function nameStartsWithToken(name, token) {
	return token.length > 1 ? name.startsWith(token) : name.startsWith(`${token}-`);
}

/**
 * 关键词检索：精确 > 前缀 > 包含 > 全 token 命中 > 官方 tags > 类目 > 多数命中（宽松回退）；
 * 别名同阶梯但降半级；tags/categories 来自 lucide-static tags.json 与 lucide.dev 43 类目。
 * 多词/同义词堆叠（如 "loader loading spinner circle"）走宽松回退按命中数排序，避免 0 命中。
 */
function search(query, limit = 12) {
	load();
	// camelCase/PascalCase 先拆成 kebab 再小写：emit/getIcon 都接受 chevronDown，
	// 但 search 原先只 toLowerCase → 同一个名字在 find 里搜不到（工具内部不一致）。
	const raw = String(query ?? "")
		.trim()
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.toLowerCase();
	if (raw === "") return [];
	// 风格/品牌意图：先识别（在发布前测过："实心"、"填充"、"线性"、"微信" 全部 0 命中）
	const wantStyle = STYLE_INTENT.find((rule) => rule.re.test(raw))?.style;
	const wantBrand = BRAND_INTENT.test(raw);
	let normalized = raw;
	for (const [zh, en] of Object.entries(BRAND_ALIAS)) if (normalized.includes(zh)) normalized = normalized.split(zh).join(` ${en} `);
	// 风格词只当意图、不进内容匹配：否则 "线性 首页" 会先命中 text-outline（名字里带 outline）
	normalized = normalized
		.replace(/实心|填充|实底|填色|\bfilled\b|\bsolid\b/g, " ")
		.replace(/线性|线框|描边|轮廓|\boutline\b/g, " ");
	if (wantBrand) normalized = normalized.replace(/品牌|标志|商标|\bbrand\b|\blogo\b/g, " ");
	// 中文助词/泛称："填充的心形" 去掉「的」才剩「心形」可查同义词表（中文无空格分词）
	normalized = normalized.replace(/的|图标|按钮|一个|个/g, " ");
	normalized = normalized.replace(/\s+/g, " ").trim();
	// 只给意图词（如"填充""品牌"）：补一个能命中一批结果的默认 token
	if (normalized === "") normalized = wantBrand ? "brand" : wantStyle === "filled" ? "filled" : "";
	if (normalized === "") return [];
	const q = normalized.replace(/[\s_]+/g, "-").replace(/-+/g, "-");
	const tokens = q.split("-").filter(Boolean);
	const expanded = expandTokens(tokens); // 同义词扩展（v0.3.0）
	const activeCategories = tokens.filter((t) => categoryIndex.has(t));
	const packRank = new Map([["lucide", 0]]);
	PACK_ORDER.forEach((n, i) => packRank.set(n, i + 1));
	const sources = [
		{ pack: "lucide", entries: lucideEntryByName.entries(), srcAlias: aliasIndex },
		...PACK_ORDER.map((n) => {
			const rec = packs.get(n);
			return { pack: n, entries: rec.entryByName.entries(), srcAlias: rec.aliasIndex };
		})
	];
	const scored = [];
	for (const { pack, entries, srcAlias } of sources) {
		for (const [name, entry] of entries) {
			let score = Infinity;
			if (name === q) score = 0;
			else if (nameStartsWithToken(name, q)) score = 1;
			else if (nameHasToken(name, q)) score = 2;
			else if (tokens.length > 1 && tokens.every((t) => nameHasToken(name, t))) score = 3;
			if (score === Infinity) {
				// 命名子串命中（含同义词）与官方 tags 命中：tags 按出现频次降权——
				// lucide 的 tags 共享词汇（remove/delete/clear）极大，不降权会把
				// 语义无关的图标一起顶上来。
				let nameHit = 0;
				for (const [t, w] of expanded) if (nameHasToken(name, t)) nameHit += w;
				let tagHit = 0;
				if (entry.tags !== undefined) {
					for (const [t, w] of expanded) {
						if (entry.tags.includes(t)) tagHit += w / Math.log2(2 + (tagDf.get(t) ?? 1));
					}
				}
				if (nameHit > 0 || tagHit > 0) {
					// 名字命中（含同义词）优先于 tag 命中：同词义的 tag 只能作为无
					// 名字命中时的补充（否则共享 tag 会把「收藏→file-heart」顶到 heart 前）
					score = nameHit > 0 ? 3.2 - Math.min(1.8, nameHit * 0.8) : 3.9 - Math.min(1.5, tagHit * 1.2);
				}
			}
			// 审查修复 #284：移除 score === Infinity 门控——原门控使循环内 Math.min
			// 恒为直接赋值（死逻辑），且「名字仅包含命中(2)而别名精确命中」时排名
			// 无法按 JSDoc 契约（别名同阶梯降半级 = 1.5）提升；别名命中始终参与比较
			for (const alias of entry.aliases ?? []) {
				if (alias === q) score = Math.min(score, 1.5);
				else if (alias.startsWith(q)) score = Math.min(score, 2.5);
				else if (alias.includes(q)) score = Math.min(score, 3.5);
			}
			// 43 类目：查询词本身就是类目名（如 arrows / files / design）时整类提升
			if (score > 3 && activeCategories.length > 0 && entry.categories !== undefined) {
				if (entry.categories.some((c) => activeCategories.includes(c))) score = Math.min(score, 3.0);
			}
			if (score !== Infinity) {
				// 风格意图排序：要填充就 -filled 优先，要线性就把 -filled 压下去（只调排名，不改结果集）
				if (wantStyle === "filled" && name.endsWith("-filled")) score = Math.max(0, score - 1.6);
				if (wantStyle === "outline" && name.endsWith("-filled")) score += 1.6;
				// 品牌意图：brand-* 优先，其它图标降权
				if (wantBrand) score += name.startsWith("brand-") ? -0.7 : 0.9;
				scored.push({ score, len: name.length, name, pack, entry });
			}
		}
	}
	scored.sort(
		(a, b) => a.score - b.score || a.len - b.len || cmpName(a.name, b.name) || (packRank.get(a.pack) ?? 99) - (packRank.get(b.pack) ?? 99)
	);
	const hasName = (pack, name) => (pack === "lucide" ? lucideEntryByName.has(name) : (packs.get(pack)?.entryByName.has(name) ?? false));
	return scored.slice(0, Math.max(1, Math.min(limit, MAX_RESULTS))).map(({ name, pack, entry }) => {
		// 可选版本提示：有 −filled 双胞胎 → solid 可直接用；两级都有 → duotone 可合成
		const outlined = !name.endsWith("-filled");
		const twinName = outlined ? `${name}-filled` : name.slice(0, -"-filled".length);
		const hasTwin = twinName !== "" && twinName !== name && hasName(pack, twinName);
		return {
			name,
			pack,
			variants: hasTwin ? (outlined ? ["filled", "duotone"] : ["outline", "duotone"]) : [],
			pascal: entry.pascal,
			camel: kebabToCamel(name),
			aliases: [...(entry.aliases ?? [])],
			nodeCount: entry.node.length,
			shapes: shapeSummary(entry.node)
		};
	});
}

export { getIcon, kebabToCamel, kebabToPascal, meta, normalizeName, registerPack, search, shapeSummary };
