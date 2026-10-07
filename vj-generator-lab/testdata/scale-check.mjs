import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { traceContours } from "../src/trace-contours.js";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const index = JSON.parse(fs.readFileSync(path.join(HERE,"index.json"),"utf8"));
const FIT_W = 5.9, FIT_H = 2.30, DENSITY = 15, DEPTH = 0.22, BEVEL = 0.022;
console.log("case   text     inkW'  inkH'  scale  世界宽 世界高 厚度  钻间距(世界)  倒角/笔画");
for (const c of index) {
  const b = fs.readFileSync(path.join(HERE, c.name + ".bin"));
  const a = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  const r = traceContours(a, c.width, c.height);
  const norm = 1 / Math.max(r.bbox.inkH, 1);
  const inkW = r.bbox.inkW * norm, inkH = r.bbox.inkH * norm;
  const scale = Math.min(FIT_W / inkW, FIT_H / inkH);
  const wW = inkW * scale, wH = inkH * scale;
  const stonePitch = wH / DENSITY;
  // 笔画宽度 ≈ 墨迹面积 / 周长，用包围盒粗估一下倒角是否安全
  console.log(`${c.name}  ${c.text.padEnd(7)} ${inkW.toFixed(2)}  ${inkH.toFixed(2)}  ${scale.toFixed(2)}  ${wW.toFixed(2)}  ${wH.toFixed(2)}  ${(DEPTH*scale).toFixed(2)}  ${stonePitch.toFixed(3)}       ${BEVEL.toFixed(3)}`);
}
