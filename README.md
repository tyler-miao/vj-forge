# vj-forge

**浏览器里的实时 3D VJ 生成器** —— 输入歌手名字，输出镶钻 / 镀铬的立体字，可以全屏演出现场，也可以导出无缝循环视频。

全程程序化生成：没有素材文件、没有后端、没有账号，页面里所有几何体都是当场算出来的。

> 前端实际跑的那一版是 `vj-generator-lab/prototype/latest.html`，单文件。

## 能做什么

- **文字 → 立体字**：任意中英文，24 款开源街头字体（SIL OFL / Apache 2.0，免费商用）
- **16 套「气质」**一键调参（凶悍 / 街头涂鸦 / 赛博 / 液态融化 / 哥特尖塔 / 石刻 / 干净 …），另有加粗、尖角、圆角、毛边、斜切、拱形、透视 7 个字形滑块
- **10 种材质**：钻石满镶 / 液态铬 / 黄金 / 熔岩裂铁 / 冰晶 / 霓虹裂光 / 木刻 / 石刻 / 锈铁 / 青铜
- **6 种边缘装饰**：尖锥 · 粗描边 · 街头描边 · 模版涂鸦 · Mixtape · 极简，外加可选的「缠绕」线
- **8 种背景图案 × 5 套配色**，图案与配色正交、互不影响；也能传自己的图片当背景（缩放 + 自由平移）
- **构图可调**：字在画面里的位置单独可挪（不动相机），相机可环绕 / 平移 / 缩放，可开自动旋转
- **导出**：无缝循环视频（默认 8s / 30fps / 8Mbps），直接可喂给 VJ 软件或投屏

## 30 秒跑起来

需要 Node.js ≥ 18。

```bash
git clone https://github.com/tyler-miao/vj-forge.git
cd vj-forge/vj-generator-lab
npm install          # 只有 three@0.160 一个开发依赖，测试脚本要用
npm run serve        # → http://localhost:5390
```

浏览器打开 <http://localhost:5390/> 即可。换端口：`PORT=8080 npm run serve`

> **为什么不能直接双击 `prototype/latest.html`**：它里面的模块路径是写死的绝对路径
> （`/files/trace-contours.js` … `/files/fonts.json`），`file://` 协议下这些路径不存在，
> 模块加载会直接失败。`serve.mjs` 干的就是把 `src/` 和 `prototype/` 拍平成那一个 `/files/` 目录。

### 需要联网的只有两处

| 走 CDN 的 | 来源 | 说明 |
|---|---|---|
| `three@0.160.0` | unpkg.com | importmap |
| 24 款字体 | jsDelivr（`google/fonts`） | 按需拉取，`*.ttf` 约 3 MB **不入库** |

要提前把字体下到本地：

```bash
node fonts/fetch-fonts.mjs     # jsDelivr 主、raw.githubusercontent 备
```

## 目录结构

```
vj-forge/
├── vj-generator-lab/            引擎 + 原型 + 测试
│   ├── prototype/latest.html    单文件应用：UI、渲染、全部交互
│   ├── src/
│   │   ├── trace-contours.js        画布位图 → 矢量轮廓
│   │   ├── stylize-contours.js      字形变形（尖角/圆角/毛边/斜切/拱形/透视）
│   │   ├── edge-adornments.js       边缘装饰排布（上下边缘 + 整圈外法线生长）
│   │   └── graffiti-outline.js      Hip-Hop 外轮廓（笔画段/飞溅/滴漆/箭头/标签）
│   ├── testdata/                6 套定量验证 + 掩膜样本（case00–07）
│   ├── fonts/                   24 款字体的清单与下载脚本（字体文件不入库）
│   ├── serve.mjs                本地预览服务器
│   └── README.md                引擎层的详细说明（含每个判据的数学依据）
├── docs/superpowers/specs/      设计文档
└── README.md
```

`src/` 下四个文件都是**纯函数**（不碰 DOM），所以能直接丢进 Node 里跑测试。
页面只负责把 Canvas / 文本框 / 滑块的状态喂给它们，再把返回的几何体变成 `THREE.BufferGeometry`。

## 测试

```bash
npm test
```

六套全是**定量断言**，不是「看着还行」：

| 脚本 | 验的是什么 |
|---|---|
| `verify.mjs` | 矢量轮廓重新栅格化（8× 超采样）与原掩膜比 IoU，8 用例全部 ≥ 0.99；顺带做参数扫描 |
| `verify-style.mjs` | 变形与装饰：法线方向、斜切、绕向、面积守恒、圆角周长必变、毛边、透视、整圈法线、缠绕闭合 |
| `verify-adorn-forms.mjs` | 尖锥几何体检查 + 「旧装饰件已彻底退场」的回归断言（形态表 / 标签 / 专属工具函数都不许再出现） |
| `verify-graffiti.mjs` | 外轮廓：几何合法性、6 套风格参数与预算、整块立体板的侧壁链连续性与共享顶点法线一致、DOM id 一致性 |
| `scale-check.mjs` | 同一个字在不同缩放下世界尺寸 / 钻间距 / 倒角一致，不随字号漂移 |
| `defaults-check.mjs` | 模块**默认参数**跑出来就是测出的最优值，没有「隐式最优」藏在调用点 |

单独跑某一个：`node testdata/verify.mjs`

## 边缘装饰的设计约定

这是整个项目里最容易跑偏的地方，所以写死成规则：

- 装饰必须**附着在字的轮廓上** —— 不做漂浮在旁边的 3D 摆件
- **少而精**：不许 360° 满圈、不许规律重复、不许每个字母一样的元素，必须留白
- 明确排除：弹簧、电线、绳子、藤蔓、云朵、泡沫、珠子、花边、机械零件、大量重复圆环 / 尖刺、布料、塑料
- **尖锥是唯一原样保留的旧形态**，有逐字符断言盯着，改动会被 `verify-adorn-forms.mjs` 打回来

## 字体授权

`fonts/fonts.json` 里列的 24 款全部来自 [Google Fonts](https://github.com/google/fonts)，
协议为 **SIL Open Font License 1.1** 或 **Apache License 2.0**。

用它们渲染出的 logo、海报、演出视频等成品**不受任何限制**；
被禁止的只有「单独转售字体文件」和「改造字体后不沿用原协议」两件事。
字体二进制不入库，可用 `node fonts/fetch-fonts.mjs` 重新下载。

## 更多

- 引擎层细节、每个测试判据的数学推导：[`vj-generator-lab/README.md`](vj-generator-lab/README.md)
- 设计文档（为什么做成现在这个样子）：`docs/superpowers/specs/2026-10-07-vj-generator-design.md`
