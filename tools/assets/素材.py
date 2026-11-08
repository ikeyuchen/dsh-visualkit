# -*- coding: utf-8 -*-
r"""素材库助手：改色 / 检索（供各引擎的生成器 import）。

用法：
    from 素材 import recolor, find, load_svg
    svg = recolor("data/assets/icons/lucide/star.svg", "#FF6F3C")  # 相对仓库根
    hits = find("贴纸")          # 按分类/名称/描述模糊检索
"""

import json
import os

# 本脚本在 tools/assets/ 下；素材库固定是 <仓库根>/data/assets
_REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIB = os.path.join(_REPO, "data", "assets")
MANIFEST = os.path.join(LIB, "manifest.json")


def recolor(svg_path, hex_color, out_path=None):
    """currentColor 素材改色；返回 SVG 字符串（可选落盘）。"""
    with open(svg_path, encoding="utf-8") as fh:
        svg = fh.read().replace("currentColor", hex_color)
    if out_path:
        with open(out_path, "w", encoding="utf-8") as fh:
            fh.write(svg)
    return svg


def body(svg_path, hex_color=None):
    """取内联 path 内容（嵌进外层 SVG 时用——切记不能嵌套整个 <svg>）。"""
    import re
    with open(svg_path, encoding="utf-8") as fh:
        svg = fh.read()
    if hex_color:
        svg = svg.replace("currentColor", hex_color)
    # Open Peeps 等源文件以 XML 声明开头；不剥掉会把整份 <svg> 当 inline 片段返回。
    svg = re.sub(r"^\s*<\?xml[^>]*\?>\s*", "", svg)
    return re.sub(r"^<svg[^>]*>", "", svg).replace("</svg>", "")


def find(keyword):
    """按关键词检索素材，返回 manifest 条目列表。"""
    with open(MANIFEST, encoding="utf-8") as fh:
        items = json.load(fh)
    kw = keyword.lower()
    return [m for m in items
            if kw in m["file"].lower() or kw in m["category"]
            or kw in m["name"].lower() or kw in m["desc"].lower()]


def path(rel_file):
    """manifest 相对路径 → 绝对路径。"""
    return os.path.join(LIB, *rel_file.split("/"))


if __name__ == "__main__":
    for hit in find("贴纸")[:5]:
        print(hit["file"], hit["license"])
