import { roundCorners, simplifyRing, ringPerimeter, ringArea } from "../src/stylize-contours.js";

// 理想正方形（逆时针）
const sq = [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
console.log("正方形原始  周长", ringPerimeter(sq).toFixed(4), " 面积", ringArea(sq).toFixed(4));
for (const r of [0.05, 0.1, 0.2]) {
  const out = roundCorners(sq, r);
  console.log(`  圆角 ${r}: 点数 ${out.length}  周长 ${ringPerimeter(out).toFixed(4)}  面积 ${ringArea(out).toFixed(4)}  理论周长 ${(4-4*(2-Math.PI/2)*r).toFixed(4)}  理论面积 ${(1-4*(1-Math.PI/4)*r*r).toFixed(4)}`);
}

// 密点正方形：每条边上插 9 个点，模拟描出来的密集轮廓
const dense = [];
for (let e=0;e<4;e++){
  const a = sq[e], b = sq[(e+1)%4];
  for (let i=0;i<10;i++){ const t=i/10; dense.push({x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t}); }
}
console.log("\n密点正方形  点数", dense.length, " 周长", ringPerimeter(dense).toFixed(4));
for (const tol of [0.001, 0.006]) {
  const s = simplifyRing(dense, tol);
  console.log(`  simplifyRing tol=${tol}: 点数 ${dense.length} → ${s.length}  周长 ${ringPerimeter(s).toFixed(4)}`);
}
const dr = roundCorners(dense, 0.2);
console.log("  密点圆角 0.2: 点数", dr.length, " 周长", ringPerimeter(dr).toFixed(4), "（应该接近", (4-4*(2-Math.PI/2)*0.2).toFixed(4), "）");
