# 内置素材库（221 项）

随包分发，纯本地离线，不依赖网络或外部程序。素材全是真资产（真 SVG / 真 PNG），不是模型生成的占位图。

## 目录与许可

| 目录 | 内容 | 数量 | 许可 |
|---|---|---:|---|
| `icons/lucide/` | 线性图标（currentColor） | 10 | ISC |
| `icons/tabler/` | Tabler 线性图标 | 40 | MIT |
| `icons/phosphor/` | Phosphor duotone 图标（256 viewBox） | 31 | MIT |
| `icons/brands/` | 平台品牌图标（B站/油管/TG/QQ/微信/抖音…） | 12 | CC0（商标权属各平台） |
| `stickers/twemoji/` | 表情贴纸 | 24 | CC-BY-4.0 |
| `stickers/openmoji/` | 手绘风表情 | 2 | CC-BY-SA-4.0 |
| `illustrations/openpeeps/` | 手绘人物插画（可改色/组合） | 42 | CC0 |
| `patterns/` | 可平铺图案（currentColor） | 12 | CC0 |
| `textures/` | 噪点底纹 PNG 512² | 3 | CC0 |
| `parts/` | 角色部件（透明底 PNG） | 45 | 自有 |

合计 221 项。来源与版本见 `THIRD_PARTY.md` 第三节。

## 调用：`design_render action=asset`

```
design_render action=asset mode=find   keyword="品牌" limit=10
design_render action=asset mode=inline rel="icons/lucide/star.svg"
design_render action=asset mode=save   rel="icons/tabler/flame.svg" color="#FF6B35" saveTo="flame.png"
```

- `find` 按 name / category / desc / file 四种子串匹配，并映射少量口语同义词；分类词可直接用：品牌图标 / 图标 / 插画 / 角色部件 / 图案 / 贴纸 / 纹理。每条返回 `file`、`category`、`license`
- `inline` 返回可直接嵌进 HTML/SVG 的标记；`currentColor` 图标会跟随文字色
- `save` 落盘，可同时改色（`color`）；`rel` 必须指向素材目录内的文件

## 许可

- 逐项许可读 `manifest.json` 的 `license` 字段，汇总表见 `THIRD_PARTY.md`
- `stickers/twemoji/`（24 项，CC-BY-4.0）与 `stickers/openmoji/`（2 项，CC-BY-SA-4.0）对外分发时需署名，署名文本见 `THIRD_PARTY.md` 第四节
- `icons/brands/` 是各平台商标，几何数据为 CC0，但不代表授权使用其商标，仅建议作平台指示
