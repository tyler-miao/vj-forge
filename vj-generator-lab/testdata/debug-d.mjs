import fs from "node:fs";
import { traceContours } from "../src/trace-contours.js";
const index = JSON.parse(fs.readFileSync("index.json","utf8"));
const c = index.find(x=>x.name==="case02");
const buf = fs.readFileSync(c.name + ".bin");
const alpha = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
const res = traceContours(alpha, c.width, c.height);
const norm = 1/Math.max(res.bbox.inkH,1);
const P = res.groups[0].outer.map(p=>({x:p.x*norm,y:p.y*norm}));
const n=P.length;
console.log("group0 outer 归一化坐标（前 18 个）：");
for(let i=0;i<n;i++){
  const a=P[(i-1+n)%n],b=P[i],cc=P[(i+1)%n];
  const dx=cc.x-a.x, dy=cc.y-a.y;
  const len=Math.hypot(dx,dy)||1e-9;
  const d=Math.abs((b.x-a.x)*dy-(b.y-a.y)*dx)/len;
  const seg=Math.hypot(cc.x-b.x,cc.y-b.y);
  console.log(`  #${String(i).padStart(2)}  (${b.x.toFixed(4)}, ${b.y.toFixed(4)})  到下一点 ${seg.toFixed(5)}  偏离弦 ${d.toFixed(6)}`);
}
