import fs from "node:fs"; import path from "node:path";
import { traceContours } from "../src/trace-contours.js";
import { simplifyRing } from "../src/stylize-contours.js";
const index = JSON.parse(fs.readFileSync("index.json","utf8"));
const c = index.find(x=>x.name==="case02");
const buf = fs.readFileSync(c.name + ".bin");
const alpha = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
const res = traceContours(alpha, c.width, c.height);
const norm = 1/Math.max(res.bbox.inkH,1);
let i=0;
for (const g of res.groups){
  for (const [kind, pts] of [["outer",g.outer], ...g.holes.map(h=>["hole",h])]){
    const P = pts.map(p=>({x:p.x*norm, y:p.y*norm}));
    const s6 = simplifyRing(P, 0.006);
    const s2 = simplifyRing(P, 0.02);
    // 看看相邻点的间距和转弯角
    const n=P.length; const turns=[];
    for(let k=0;k<n;k++){
      const p0=P[(k-1+n)%n],p1=P[k],p2=P[(k+1)%n];
      const a1x=p0.x-p1.x,a1y=p0.y-p1.y,a2x=p2.x-p1.x,a2y=p2.y-p1.y;
      const l1=Math.hypot(a1x,a1y)||1,l2=Math.hypot(a2x,a2y)||1;
      turns.push(Math.acos(Math.max(-1,Math.min(1,(a1x/l1)*(a2x/l2)+(a1y/l1)*(a2y/l2))))*180/Math.PI);
    }
    const seg=[];
    for(let k=0;k<n;k++){ const q=P[(k+1)%n]; seg.push(Math.hypot(q.x-P[k].x,q.y-P[k].y)); }
    console.log(`group${i} ${kind}: 点数 ${n}  边长 ${Math.min(...seg).toFixed(4)}~${Math.max(...seg).toFixed(4)}  转弯角 ${Math.min(...turns).toFixed(1)}°~${Math.max(...turns).toFixed(1)}°  → simplify(0.006)=${s6.length} simplify(0.02)=${s2.length}`);
  }
  i++;
}
