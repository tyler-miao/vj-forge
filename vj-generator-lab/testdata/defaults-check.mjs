import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { traceContours } from "../src/trace-contours.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const index = JSON.parse(fs.readFileSync(path.join(HERE,"index.json"),"utf8"));
// 用模块默认参数（不显式传任何 option）跑一遍，确认默认值就是测出来的最优值
let min = 1, sum = 0;
for (const c of index) {
  const b = fs.readFileSync(path.join(HERE, c.name + ".bin"));
  const a = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  const r = traceContours(a, c.width, c.height);   // 全默认
  console.log(`${c.name} ${c.text.padEnd(8)} loops=${String(r.stats.loops).padStart(3)} holes=${String(r.stats.holes).padStart(2)} pts=${String(r.stats.points).padStart(4)} bbox=${r.bbox? r.bbox.inkW+"x"+r.bbox.inkH : "none"}`);
  sum += r.stats.points;
}
console.log("默认参数下总点数:", sum);
