# 内置素材库（221 项，3.2 MB）

随包分发，本地离线，不依赖网络或外部程序；素材是真 SVG / 真 PNG 文件。许可、来源与署名统一记在 `THIRD_PARTY.md` 第三节与第四节。

## 调用：`design_render action=asset`

```
design_render action=asset mode=find   keyword="品牌" limit=10
design_render action=asset mode=inline rel="icons/lucide/star.svg"
design_render action=asset mode=save   rel="icons/tabler/flame.svg" color="#FF6B35" saveTo="flame.png"
```

| 参数 | 作用 |
|---|---|
| `mode=find` | 检索，返回 `file`、`category`、`license` 等字段 |
| `mode=inline` | 返回可嵌进外层 SVG / HTML 的内容，不含 `<svg>` 壳 |
| `mode=save` | 改色后落盘，需要 `saveTo` |

`inline` 与 `save` 只处理矢量素材（`.svg`），位图请直接按路径引用。
| `keyword` | 按 name / category / desc / file 四种子串匹配，并映射少量口语同义词 |
| `rel` | 相对素材目录的路径，必须是文件，不能是目录 |
| `color` | 改色，接受 `#hex`、`rgb()`、命名色；`currentColor` 图标跟随文字色 |
| `saveTo` | 落盘路径，仅用于 `mode=save` |
| `limit` | 检索返回条数上限，默认 12，由 `findLimit` 配置 |

分类词可直接传给 `keyword`：品牌图标、图标、插画、角色部件、图案、贴纸、纹理。
