# vj-generator-lab

VJ 生成器的引擎源码与测试台。**这里的东西都进了版本控制**；
浏览器里跑的原型因为要由预览服务提供，放在临时目录，所以在这里也存一份快照。

## 目录

```
src/                        引擎源码（纯函数优先，能在 Node 里测）
  trace-contours.js         字形描轮廓：画布位图 → 矢量轮廓
  stylize-contours.js       字形变形：加粗/尖角/圆角/毛边/斜切/拱形/透视
  edge-adornments.js        边缘装饰排布：上下边缘 + 整圈（外法线生长）

testdata/                   测试台
  make_masks.py             用 Pillow 造测试掩膜（含中文字形）
  verify.mjs                描轮廓验证：矢量重栅格化 vs 原掩膜，IoU ≥ 0.99
  verify-style.mjs          变形与装饰验证：面积/周长/绕向/法线方向
  verify-adorn-forms.mjs    边缘装饰形态验证：14 形态几何有效、两两可区分、尖锥未动
  debug*.mjs                排查用的临时脚本，保留以备复现

fonts/                      开源街头字体
  probe_fonts.py            探测 Google Fonts 仓库里有哪些可用字体
  fetch-fonts.mjs           下载（jsDelivr 主、raw.githubusercontent 备）
  fonts.json                24 款字体的清单：协议、体积、来源

prototype/                  浏览器原型快照（最新一版）
```

## 怎么跑测试

```bash
cd vj-generator-lab
npm install                # 一次性：装 three（0.160.0，验证形态用）

cd testdata
node verify.mjs             # 描轮廓：8 个用例，IoU 全部 ≥ 0.997
node verify-style.mjs       # 变形 + 装饰：Steiner 面积公式、整圈法线方向
node verify-adorn-forms.mjs # 边缘装饰：14 形态几何有效、两两可区分、尖锥逐字未动
```

三套都是**定量**的，不是"看着还行"：

- 描轮廓：把矢量轮廓重新栅格化（4× 超采样覆盖率）和原掩膜比 IoU
- 加粗：小量外扩 d 的面积增量应约等于 `P·d`（P 为周长）；实测比值 0.98–1.01，
  法线方向搞反的话比值会变成负数
- 圆角：判据是**周长必变短**，不能是面积（圆角同时切外轮廓和洞的角，面积几乎抵消）
- 整圈装饰：生长方向必须背离质心（理想正方形 20/20 通过）

## 怎么跑原型

原型由 brainstorm 预览服务提供（`.superpowers/brainstorm/vj-generator/content/`）。
预览服务只支持扁平路径，所以上面的 `src/*.js` 会复制一份到那里 —— 改动后要同步：

```powershell
Copy-Item src\*.js <content>\ -Force
```

正式产品不再需要这个复制步骤（会有正常的前端工程结构），那属于实施计划的范围。

## 字体授权

`fonts/` 里的 24 款全部来自 Google Fonts，协议为 **SIL Open Font License 1.1**
或 **Apache License 2.0**。用于渲染 logo、海报、演出视频等成品**不受限制**，
只有"单独转售字体文件"和"改造字体后不沿用 OFL"这两件事被禁止。
字体二进制不入库（23MB），用 `fetch-fonts.mjs` 可重新下载。
