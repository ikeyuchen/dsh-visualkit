# -*- coding: utf-8 -*-
"""素材库建库工具：图标扩容 / 图案纹理生成 / 登记造册。

用法（在仓库根执行；素材库是 data/assets/）：
    python tools/assets/建库.py icons      # 从 Tabler 离线包精选图标（缺的自动跳过）
    python tools/assets/建库.py patterns   # 程序化生成 CC0 图案（SVG）+ 纹理（PNG）
    python tools/assets/建库.py register   # 扫描全库 → manifest.json + 缩略图总览
    python tools/assets/建库.py thumbs     # 缩略图总览（配置 VISUALKIT_RENDER_SCRIPT 才会出 PNG）

图标源包不进仓（可重新生成）：先 `npm i @iconify-json/tabler`，把包里 `icons.json`
复制为 `tools/assets/packs/tabler-icons.json`，再跑 `icons`。
"""
import json
import os
import sys

import numpy as np

# 本脚本在 tools/assets/ 下；素材库固定是 <仓库根>/data/assets（发布包只带 data/）
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIB = os.path.join(REPO, "data", "assets")
# 图标源包（Iconify 原始格式，仅开发期使用，不进发布包）
PACKS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "packs")

# 可选：SVG→PNG 渲染器（外部 Node 脚本，两个参数：in.svg out.png）。
# 不配置也能建库：thumbs 只产出 SVG 总览，跳过 PNG 渲染。
RENDER = os.environ.get("VISUALKIT_RENDER_SCRIPT") or ""

TABLER_WANTED = [
    # 直播/媒体
    "video", "microphone", "broadcast", "live-view", "player-play",
    "device-gamepad-2", "headphones", "playlist", "movie",
    # 时间/日程
    "calendar-event", "calendar-week", "clock-hour-3", "alarm",
    # 互动/情绪
    "heart", "heart-filled", "star", "star-filled", "mood-smile",
    "mood-tongue", "thumb-up", "hand-wave",
    # 运营/强调
    "flame", "bolt", "rocket", "gift", "bell", "badge-ad", "ticket",
    "diamond", "crown", "sparkles", "tag", "coin", "currency-yen",
    # 社媒/平台
    "brand-discord", "brand-bilibili", "brand-youtube", "brand-twitch",
    "brand-weibo", "brand-qq", "brand-wechat",
]


def cmd_icons():
    pack_path = os.path.join(PACKS, "tabler-icons.json")
    with open(pack_path, encoding="utf-8") as fh:
        pack = json.load(fh)
    width = pack.get("width", 24)
    height = pack.get("height", 24)
    out_dir = os.path.join(LIB, "icons", "tabler")
    os.makedirs(out_dir, exist_ok=True)
    made, missed = 0, []
    for name in TABLER_WANTED:
        body = (pack.get("icons") or {}).get(name, {}).get("body")
        if not body:
            missed.append(name)
            continue
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" '
               'fill="none" stroke="currentColor" stroke-width="2" '
               'stroke-linecap="round" stroke-linejoin="round">%s</svg>'
               % (width, height, body))
        with open(os.path.join(out_dir, "%s.svg" % name), "w",
                  encoding="utf-8") as fh:
            fh.write(svg)
        made += 1
    print("tabler 提取 %d 个，缺失跳过 %d 个：%s"
          % (made, len(missed), ", ".join(missed) if missed else "无"))


PATTERNS = {
    # name: (tile_size, svg_body 用 currentColor，缩略图时可换色)
    "dots": ('<circle cx="10" cy="10" r="3" fill="currentColor"/>', 20),
    "grid": ('<path d="M20 0H0V20" fill="none" stroke="currentColor" '
             'stroke-width="1.5"/>', 20),
    "diagonal": ('<path d="M-2 12 L12 -2 M0 22 L22 0 M10 24 L24 10" fill="none" '
                 'stroke="currentColor" stroke-width="2"/>', 16),
    "zigzag": ('<path d="M0 16 L8 8 L16 16 L24 8" fill="none" '
               'stroke="currentColor" stroke-width="2"/>', 16),
    "scales": ('<path d="M0 20 A10 10 0 0 1 20 20 M10 10 A10 10 0 0 1 30 10" '
               'fill="none" stroke="currentColor" stroke-width="2"/>', 20),
    "waves": ('<path d="M0 10 Q5 5 10 10 T20 10" fill="none" '
              'stroke="currentColor" stroke-width="2"/>', 20),
    "crosshatch": ('<path d="M0 12 L12 0 M0 24 L24 0 M12 24 L24 12 M-6 6 L6 -6" '
                   'fill="none" stroke="currentColor" stroke-width="1.5"/>', 16),
    "plus": ('<path d="M8 3 V13 M3 8 H13" stroke="currentColor" '
             'stroke-width="2.5" stroke-linecap="round"/>', 16),
    "circles-overlap": ('<circle cx="8" cy="8" r="6" fill="none" '
                        'stroke="currentColor" stroke-width="1.5"/>'
                        '<circle cx="16" cy="16" r="6" fill="none" '
                        'stroke="currentColor" stroke-width="1.5"/>', 24),
    "triangles": ('<path d="M6 2 L11 10 L1 10 Z" fill="currentColor"/>', 12),
    "checker": ('<rect width="10" height="10" fill="currentColor"/>'
                '<rect x="10" y="10" width="10" height="10" '
                'fill="currentColor"/>', 20),
    "halftone": ('<circle cx="10" cy="10" r="6" fill="currentColor"/>'
                 '<circle cx="30" cy="10" r="4" fill="currentColor"/>'
                 '<circle cx="10" cy="30" r="4" fill="currentColor"/>'
                 '<circle cx="30" cy="30" r="2.5" fill="currentColor"/>', 40),
}


def cmd_patterns():
    out_dir = os.path.join(LIB, "patterns")
    os.makedirs(out_dir, exist_ok=True)
    for name, (body, tile) in PATTERNS.items():
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" '
               'height="%d" viewBox="0 0 %d %d">%s</svg>'
               % (tile, tile, tile, tile, body))
        with open(os.path.join(out_dir, "%s.svg" % name), "w",
                  encoding="utf-8") as fh:
            fh.write(svg)
    print("图案生成 %d 个（全 currentColor，可 recolor）" % len(PATTERNS))

    # 纹理：程序化噪点（自产 CC0）
    tex_dir = os.path.join(LIB, "textures")
    os.makedirs(tex_dir, exist_ok=True)
    from PIL import Image
    rng = np.random.default_rng(42)
    for name, base, strength in (("grain-light", 255, 10),
                                 ("grain-dark", 24, 12),
                                 ("grain-warm", (250, 240, 228), 9)):
        noise = rng.integers(-strength, strength + 1,
                             (512, 512, 1 if isinstance(base, int) else 3))
        arr = np.clip(np.asarray(
            Image.new("RGB", (512, 512), base if isinstance(base, tuple)
                      else (base,) * 3), dtype=np.int16) + noise, 0,
            255).astype(np.uint8)
        Image.fromarray(arr, "RGB").save(os.path.join(tex_dir,
                                                      "%s.png" % name))
    print("纹理生成 3 张（512×512 噪点）")


LICENSE_BY_DIR = {
    "icons/lucide": "ISC", "icons/tabler": "MIT", "icons/brands": "CC0",
    "icons/phosphor": "MIT", "illustrations/openpeeps": "CC0",
    "stickers/twemoji": "CC-BY-4.0", "stickers": "CC-BY-4.0 / CC-BY-SA-4.0",
    "stickers/openmoji": "CC-BY-SA-4.0", "patterns": "CC0(自产)",
    "textures": "CC0(自产)", "parts": "自有",
}
CATALOG = {
    "icons/lucide": ("图标", "线性图标（currentColor 可改色）"),
    "icons/tabler": ("图标", "Tabler 线性图标（currentColor 可改色）"),
    "icons/brands": ("品牌图标", "平台 logo（simple-icons，注明商标权属）"),
    "icons/phosphor": ("图标", "Phosphor duotone 图标（MIT，256 viewBox）"),
    "illustrations/openpeeps": ("插画", "Open Peeps 手绘人物（CC0，可改色/组合）"),
    "stickers/twemoji": ("贴纸", "Twemoji 表情"),
    "stickers/openmoji": ("贴纸", "OpenMoji 手绘风表情"),
    "patterns": ("图案", "可平铺图案（currentColor 可改色）"),
    "textures": ("纹理", "噪点底纹 PNG"),
    "parts": ("角色部件", "角色拆分件（透明底）"),
    "illustrations": ("插画", "待手动入库（unDraw 等）"),
}


def cmd_register():
    manifest = []
    for root, dirs, files in os.walk(LIB):
        rel = os.path.relpath(root, LIB).replace("\\", "/")
        if rel.startswith(("tools", "_thumbs")) or rel == ".":
            continue
        meta = CATALOG.get(rel)
        if not meta:
            continue
        cat, desc = meta
        lic = LICENSE_BY_DIR.get(rel, "待查")
        for fn in sorted(files):
            if not fn.lower().endswith((".svg", ".png")):
                continue
            manifest.append({
                "file": "%s/%s" % (rel, fn),
                "name": os.path.splitext(fn)[0],
                "category": cat, "desc": desc, "license": lic,
            })
    out = os.path.join(LIB, "manifest.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    by_cat = {}
    for m in manifest:
        by_cat[m["category"]] = by_cat.get(m["category"], 0) + 1
    print("manifest: %d 项 -> %s" % (len(manifest), out))
    for cat, n in sorted(by_cat.items(), key=lambda kv: -kv[1]):
        print("  %-6s %d" % (cat, n))


def cmd_thumbs():
    """缩略图总览：图标/图案/贴纸各一张 SVG 拼图（resvg 一次渲染），部件 PIL 拼图。"""
    import subprocess
    import sys as _sys
    import re
    TH = os.path.join(LIB, "_thumbs")
    os.makedirs(TH, exist_ok=True)
    render = RENDER

    def inner(p, color=None):
        with open(p, encoding="utf-8") as fh:
            s = fh.read()
        if color:
            s = s.replace("currentColor", color)
        # Open Peeps 的 SVG 以 XML 声明开头；先剥掉，否则 <svg> 根标签不会被剥。
        s = re.sub(r"^\s*<\?xml[^>]*\?>\s*", "", s)
        return re.sub(r"^<svg[^>]*>", "", s).replace("</svg>", "")

    def sheet_svg(cells, cols, cw, ch, path_out):
        rows = (len(cells) + cols - 1) // cols
        parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="%d" '
                 'height="%d">'
                 % (cols * cw, rows * ch),
                 '<rect width="%d" height="%d" fill="#fff"/>'
                 % (cols * cw, rows * ch)]
        for i, (label, body_svg, scale) in enumerate(cells):
            gx, gy = (i % cols) * cw, (i // cols) * ch
            s = scale
            parts.append('<g transform="translate(%d %d) scale(%.4f) '
                         'translate(0 0)" fill="#333">%s</g>'
                         % (gx + 14, gy + 16, s, body_svg))
            parts.append('<text x="%d" y="%d" font-family="Consolas" '
                         'font-size="11" fill="#888">%s</text>'
                         % (gx + 10, gy + ch - 10, label[:18]))
        parts.append("</svg>")
        with open(path_out, "w", encoding="utf-8") as fh:
            fh.write("".join(parts))
        if not render:
            print("thumbs: %s（未配置 VISUALKIT_RENDER_SCRIPT，跳过 PNG 渲染）"
                  % os.path.basename(path_out))
            return
        out_png = path_out.replace(".svg", ".png")
        subprocess.run(["node", render, path_out, out_png], check=True,
                       capture_output=True)
        print("thumbs:", os.path.basename(out_png))

    # 图标总览（lucide+tabler 24 单位 → 72px；brands 保持原比例 24→72）
    for sub, cols in (("lucide", 10), ("tabler", 10), ("brands", 6)):
        d = os.path.join(LIB, "icons", sub)
        if not os.path.isdir(d):
            continue
        files = sorted(f for f in os.listdir(d) if f.endswith(".svg"))
        cells = [(os.path.splitext(f)[0],
                  inner(os.path.join(d, f), "#333" if sub != "brands"
                        else None), 72 / 24.0) for f in files]
        sheet_svg(cells, cols, 96, 104,
                  os.path.join(TH, "icons_%s.svg" % sub))

    # Phosphor duotone 总览（256 viewBox → 72px；保留 opacity 双层）
    d = os.path.join(LIB, "icons", "phosphor")
    if os.path.isdir(d):
        files = sorted(f for f in os.listdir(d) if f.endswith(".svg"))
        cells = [(os.path.splitext(f)[0], inner(os.path.join(d, f), "#333"),
                  72 / 256.0) for f in files]
        sheet_svg(cells, 8, 96, 104, os.path.join(TH, "icons_phosphor.svg"))

    # 图案总览（currentColor → 紫，瓦片放大预览）
    d = os.path.join(LIB, "patterns")
    files = sorted(f for f in os.listdir(d) if f.endswith(".svg"))
    cells = [(os.path.splitext(f)[0], inner(os.path.join(d, f), "#7B5FC4"),
              140 / 40.0) for f in files]
    sheet_svg(cells, 6, 160, 168, os.path.join(TH, "patterns.svg"))

    # 贴纸总览（twemoji/openmoji 原色，内联缩放）。
    # 旧实现循环末尾无条件 break：openmoji 永远进不了总览。
    # 现在按目录去重——两个子目录都收；子目录缺失时回退根目录，
    # 且两个子目录都缺失时根目录只收一遍。
    cells = []
    seen_dirs = set()
    for sub in ("twemoji", "openmoji"):
        d = os.path.join(LIB, "stickers", sub)
        if not os.path.isdir(d):
            d = os.path.join(LIB, "stickers")
            if not os.path.isdir(d):
                continue
        if d in seen_dirs:
            continue
        seen_dirs.add(d)
        for f in sorted(x for x in os.listdir(d) if x.endswith(".svg")):
            cells.append((os.path.splitext(f)[0], inner(os.path.join(d, f)),
                          140 / 36.0))
    sheet_svg(cells, 8, 152, 162, os.path.join(TH, "stickers.svg"))

    # Open Peeps 插画总览（240×324 原始 viewBox → 约 140px 高）
    d = os.path.join(LIB, "illustrations", "openpeeps")
    if os.path.isdir(d):
        files = sorted(f for f in os.listdir(d) if f.endswith(".svg"))
        cells = [(os.path.splitext(f)[0], inner(os.path.join(d, f)),
                  140 / 324.0) for f in files]
        sheet_svg(cells, 6, 180, 200, os.path.join(TH, "illustrations_openpeeps.svg"))

    # 部件总览（PNG，PIL 拼图）
    from PIL import Image
    d = os.path.join(LIB, "parts")
    files = sorted(f for f in os.listdir(d) if f.endswith(".png"))
    cols = 8
    cell = 150
    rows = (len(files) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * cell), (245, 245, 245))
    for i, f in enumerate(files):
        im = Image.open(os.path.join(d, f)).convert("RGBA")
        im.thumbnail((cell - 24, cell - 34), Image.LANCZOS)
        bg = Image.new("RGBA", (cell, cell), (255, 255, 255, 255))
        bg.alpha_composite(im, ((cell - im.width) // 2, 8))
        sheet.paste(bg.convert("RGB"), ((i % cols) * cell, (i // cols) * cell))
    sheet.save(os.path.join(TH, "parts.png"))
    print("thumbs: parts.png")


if __name__ == "__main__":
    {"icons": cmd_icons, "patterns": cmd_patterns,
     "register": cmd_register, "thumbs": cmd_thumbs}[
        sys.argv[1] if len(sys.argv) > 1 else "register"]()
