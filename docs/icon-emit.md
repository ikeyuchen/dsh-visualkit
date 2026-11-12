# 图标出码：`icon emit`

范围：`icon emit` 的 9 种视觉预设、正交参数、文字与渐变、`shapes` 图层、阴影与虚线，以及出码 `target` 的差异。检索用 `icon find`，见 README 的「快速上手」。

## 9 种风格预设

| style | 视觉语言 | 适合 | 16px 可读性 |
|---|---|---|---|
| `outline`（默认） | 2px 线性，Feather/Lucide 基线 | 通用 UI | 可读 |
| `hairline` | 1px 细线 | 大尺寸、高档版面 | 不可读（太细） |
| `bold` | 2.8px 粗线 | 强调、图标按钮 | 可读 |
| `sharp` | butt/miter 尖角端点 | 直线型图标（加号、减号、乘号、对勾、箭头） | 可读 |
| `solid` | 填充版（tabler `-filled`） | 小尺寸最清楚、选中态 | 最佳 |
| `duotone` | 20% 填充 + 线稿 | 中层装饰、功能入口 | 勉强（双色淡） |
| `badge` | 圆角方块底色 + 反白字形 | SaaS 功能入口、设置项 | 可读 |
| `knockout` | 正圆底色 + 反白字形 | app icon 语言、头像位 | 最佳 |
| `gradient` | 渐变描边（`color` 起色，末色自动导） | 营销位、大尺寸展示 | 勉强 |

同一 heart 在 96px 画布上与 `outline` 的像素差异：`badge` 74% · `knockout` 61% · `solid`/`duotone` 43% · `hairline` 14% · `bold` 12% · `gradient` 6% · `sharp` 0%。`sharp` 只改线端与拐角，曲线封闭字形本就无可见端点，0% 是正确行为；直线型图标（menu/plus/x）有 7–11% 差异。

其他能力：`strokeWidth` 1–64 任意字重；tabler 的 411 个 `brand-*` 品牌 logo（含微信、淘宝、github，商标仅供平台指示用途，可用 `icon find "微信"`）；两态形变由 morphicons 承担。多色与渐变字形本体不支持，渐变只作用于描边，需要时用 `design_render` 叠图层。

`badge`/`knockout` 用 `color` 作底色、`color2` 作字形色；`colibri`/`echo` 两个项目约定表达不了容器与渐变，会明说退化而不是默默无效。`icon find` 会标注可选版本（如 `可选 filled/duotone 版`），做 hover/active 两态时直接取对应名字。尺寸 16–48px 都用同一套 24 网格数据矢量缩放。

## 出码 target

`target` 取 `colibri` / `echo` / `dsh-plugin` / `whale` / `raw`。前四个是特定项目的约定（组件写法、文件名、导出形式），`raw` 输出裸 SVG 标记，供自行粘贴。写出来的文件路径可用 `outPath` 指定。

## 正交维度：风格由参数拼出

| 维度 | 取值 | 作用 |
|---|---|---|
| `paint` | `stroke` / `fill` / `both` | 绘法（`both` = 填充 + 描边两层） |
| `strokeWidth` | 0–64 | 描边粗细 |
| `caps` | `round` / `butt` / `square` | 线端（`join` 自动配对） |
| `join` | `round` / `miter` / `bevel` | 显式转角 |
| `container` | `none` / `rounded` / `circle` / `squircle` | 字形装进底色（`none` 去掉预设容器） |
| `radius` | 0–12 | 容器圆角（squircle 时是曲率） |
| `inset` | 0–0.45 | 字形在容器里的留白 |
| `gradient` | `none` / `linear` / `radial` | 渐变类型 |
| `gradientAngle` | 0–360 | 渐变方向 |
| `duoOpacity` | 0–1 | 双色底层不透明度（需填充孪生体） |
| `color` / `color2` | 任意色值 | 主色 / 渐变末色或容器内字形色 |

`style` 的 9 个名字只是预设起点，真正的视觉语言由上述维度组合而成；传了维度参数就以它为准，覆盖预设。降级会说出口：填充字形上给 `strokeWidth` 会返回 note 明说「不生效」。渐变 id 按内容哈希唯一（`ak-g-<hash>`），同一页面内联多个渐变图标不串色。

## 文字、渐变与 `stops`

`text` 给了就取代字形：用文字当图形，`7z` 的方块、字母徽章 `K`、字母组合 `AI / PDF` 都是这一类；内容 1–4 字符，给了就可以不给 `name`。`textSize` 是 24 网格单位字号，不给则按字数自动适配安全区。自动字号按「可用宽度 ÷ 字数 ÷ 0.62」估算，所以 `K` 会比 `PDF` 大：14.13 / 11.61 / 9.29。居中用 `dominant-baseline="central"`：resvg 下 cy 落在 11.93（目标 12），`middle` 会偏到 11.13。文字可与阴影、渐变、中孔（`shapes`）叠加；内容做 XML 转义，不破坏 SVG 结构。

`stops` 数组每项为 `color` 或 `color@offset`（0–1，对齐 SVG 的 `offset`）：

```text
3 段          stops: ["#FF0000", "#FFFF00@0.5", "#00FF00"]
彩虹 6 色      stops: ["#FF0000","#FF9900","#FFFF00","#00CC00","#0066FF","#9900FF"]   ← 未写偏移自动均分
径向 4 段      gradient: radial, stops: ["#FFF","#FFD6A5@0.35","#FF6B6B@0.7","#4B1D3F"]
锐变分界       stops: ["#111","#111@0.5","#EEE@0.5","#EEE"]      ← 同偏移两色
```

不传 `stops` 时走 `color`/`color2` 两色路径，末色可自动推导；传了就以它为准，颜色不再限制 hex。没有 `spreadMethod`：渐变向量总铺满整个 24 网格盒子，一次循环覆盖全部；条纹用多停靠点加同偏移锐变更精确。

## 自绘、`shapes` 与深度图元

`path` 参数直接吃原始 SVG path 数据（24 网格坐标）：`icon emit path="M12 2 L22 12 L12 22 L2 12 Z" paint=fill color="#E8620C"`。`shapes` 的每一层也可以只给 `path`（此时不需要 `name`）：

```jsonc
shapes: [
  { path: "M2 20 L9 8 L13 14 L16 10 L22 20 Z", color: "#FBBF24" },   // 山
  { path: "M5.5 6 m-2.5 0 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0 Z", color: "#FDE68A" },  // 日
  { path: "M2 17 C5 14 8 20 11 17 C14 14 17 20 20 17", color: "#38BDF8", weight: 1.2 }   // 水
]
```

自绘路径会被包成与库图标同构的节点，容器、渐变、阴影、遮罩减法、旋转、逐层线宽全部照旧生效。一条路径画环或镂空：`d` 里写多个子路径，加 `fillRule: "evenodd"` 即为外套内挖，例如环 `path="M12 2 a10 10 0 1 0 .01 0 Z M12 7 a5 5 0 1 0 .01 0 Z" fillRule=evenodd`（三孔板、花窗同法）。resvg 下外圆加内圆同向时 `nonzero` 中心 α=255（实心）、`evenodd` 中心 α=0（挖空），已写成像素级测试。

**安全**：path 数据直接进 `d="..."`，引号或尖括号能破出属性注入标签，因此走白名单校验（只允许 `MmLlHhVvCcSsQqTtAa` + 数字 + `. , - + e E` + 空白），必须以 `M`/`m` 开头，上限 4000 字符。非法整条丢弃，不静默截断。

`shapes` 是对象数组，每个元素是一个独立图层：

| 字段 | 取值 | 作用 |
|---|---|---|
| `name` | 库内图标名（必填） | — |
| `scale` | 0.02–4，相对 24 网格中心 | 整体缩放 |
| `dx` / `dy` | 偏移（网格单位，y 向上为负） | 中孔靠它避开中心字形 |
| `rotate` | 绕自身中心旋转的度数 | 场景组合；菱形孔靠旋转方孔 45° 做出来 |
| `color` | 该层独立颜色（`rgba()` / 命名色均可） | 异色角标不必绕成「容器当底」 |
| `stops` | 该层独立渐变 | 品牌美术每层可各自带渐变 |
| `gradient` | `linear`（默认）/ `radial` | 径向做球体、光晕；线性做金属、渐变条 |
| `angle` | 该层渐变角度 0–360 | 渐变方向 |
| `weight` | 该层独立线宽 0.1–12 | 插画靠粗轮廓加细细节拉层次 |
| `subtract` | `true` = 从整个合成里挖掉（`<mask>`） | 环、吊牌孔、斜切角、镂空 |

未写的字段走默认值；写了但越界（如 `scale: 99`）整条丢弃，不静默夹到边界。`subtract` 不作用于文字，文字画在 mask 之外。每层渐变用 `objectBoundingBox` 坐标，自动适配该层包围盒。

深度与虚线只给图元，不提供「微拟物」「液态玻璃」这类风格名：

| 参数 | 适用 | 作用 |
|---|---|---|
| `shadow` | `icon emit` / `composite` | CSS box-shadow 语法：逗号分隔多阴影，`inset` 内阴影，颜色任意 |
| `dash` | `icon emit` | `stroke-dasharray`（数组，按 24 网格单位） |

双光源微拟物写 `4px 4px 8px #A3B1C6, -4px -4px 8px #FFFFFF`，内阴影写 `inset 0 3px 6px rgba(0,0,0,.4)`，高程体系写 `0 1px 2px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.2)`，技术图虚线写 `dash: [4, 2]`。

resvg 约束：`feDropShadow` 无效，外阴影改用模糊的偏移副本；`feMorphology`（spread）无效，`shadow` 的第 4 个数值忽略；位图图层用 `feGaussianBlur(SourceAlpha) + feFlood + feComposite` 把 alpha 染成阴影色。
