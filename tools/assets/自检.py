# -*- coding: utf-8 -*-
"""素材库全链路自检：recolor / body / find / SVG 组装 / resvg 渲染。"""

import os
import subprocess
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
from 素材 import recolor, body, find  # noqa: E402

REPO = os.path.dirname(os.path.dirname(_HERE))  # 仓库根目录
LIB = os.path.join(REPO, "data", "assets")      # 素材库根目录

# 可选：SVG→PNG 渲染器（外部 Node 脚本，两个参数：in.svg out.png）。
# 不配置也能自检：跳过 resvg 渲染那一步，其余断言照跑。
RENDER = os.environ.get("VISUALKIT_RENDER_SCRIPT") or ""

# 1) 改色
svg_test = recolor(os.path.join(LIB, "icons", "tabler", "flame.svg"),
                   "#FF6F3C")
assert "#FF6F3C" in svg_test and "currentColor" not in svg_test
# 2) 内联
inner = body(os.path.join(LIB, "icons", "tabler", "rocket.svg"), "#4DE8FF")
assert "<path" in inner
# 3) 检索
assert len(find("品牌")) >= 10 and len(find("贴纸")) >= 20
# 4) 组装一张快照（两枚改色图标 + 一枚品牌 + 一枚图案平铺）
full = ('<svg xmlns="http://www.w3.org/2000/svg" width="460" height="150">'
        '<rect width="460" height="150" fill="#14141A"/>'
        '<defs><pattern id="p" width="20" height="20" '
        'patternUnits="userSpaceOnUse">%s</pattern></defs>'
        '<rect width="460" height="150" fill="url(#p)" opacity="0.15"/>'
        '<g transform="translate(30 30) scale(2.5)" fill="none" '
        'stroke="#FF6F3C" stroke-width="2">%s</g>'
        '<g transform="translate(150 30) scale(2.5)" fill="none" '
        'stroke="#4DE8FF" stroke-width="2">%s</g>'
        '<g transform="translate(280 30) scale(3.5)" fill="#fff">%s</g>'
        '</svg>') % (body(os.path.join(LIB, "patterns", "dots.svg"),
                          "#4DE8FF").replace('fill="#4DE8FF"', 'fill="#4DE8FF"'),
                     body(os.path.join(LIB, "icons", "tabler", "flame.svg")),
                     body(os.path.join(LIB, "icons", "tabler", "rocket.svg")),
                     body(os.path.join(LIB, "icons", "brands", "bilibili.svg")))
out_svg = os.path.join(LIB, "_thumbs", "_smoke.svg")
os.makedirs(os.path.dirname(out_svg), exist_ok=True)
with open(out_svg, "w", encoding="utf-8") as fh:
    fh.write(full)
png = None
if RENDER:
    png = out_svg.replace(".svg", ".png")
    subprocess.run(["node", RENDER, out_svg, png], check=True,
                   capture_output=True)
os.remove(out_svg)
print("manifest 条目:", len(find("")))
print("全链路自检通过：recolor / body / find / 图案平铺"
      + (" / resvg 渲染 -> %s" % png if png
         else "（未配置 VISUALKIT_RENDER_SCRIPT，跳过 resvg 渲染）"))
