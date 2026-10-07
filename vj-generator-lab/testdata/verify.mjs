/**
 * 轮廓跟踪的定量验证。
 *
 * 两个关键点：
 * 1) 栅格化必须用超采样覆盖率，否则整像素扫描线和原图抗锯齿之间的
 *    半像素差会自己吃掉 2~3% 的 IoU，把"算法误差"和"度量误差"混在一起。
 * 2) 参数（blur / simplify）靠扫描选定，不靠手感。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { traceContours } from '../src/trace-contours.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const index = JSON.parse(fs.readFileSync(path.join(HERE, 'index.json'), 'utf8'));

/** 超采样覆盖率栅格化：垂直 sub 倍超采样，水平精确覆盖积分 */
function coverage(groups, W, H, cx, cy, sub = 4) {
  const cov = new Float32Array(W * H);
  const edges = [];
  for (const g of groups) {
    for (const ring of [g.outer, ...g.holes]) {
      for (let i = 0, n = ring.length; i < n; i++) {
        const p = ring[i], q = ring[(i + 1) % n];
        edges.push([p.x + cx, cy - p.y, q.x + cx, cy - q.y]);
      }
    }
  }
  const xs = [];
  for (let y = 0; y < H; y++) {
    for (let s = 0; s < sub; s++) {
      const sy = y + (s + 0.5) / sub;
      xs.length = 0;
      for (const [ax, ay, bx, by] of edges) {
        if ((ay > sy) !== (by > sy)) xs.push(ax + (sy - ay) / (by - ay) * (bx - ax));
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const xa = Math.max(0, xs[i]), xb = Math.min(W, xs[i + 1]);
        if (xb <= xa) continue;
        const p0 = Math.floor(xa), p1 = Math.ceil(xb) - 1;
        for (let x = p0; x <= p1; x++) {
          const ov = Math.min(xb, x + 1) - Math.max(xa, x);
          if (ov > 0) cov[y * W + x] += ov / sub;
        }
      }
    }
  }
  return cov;
}

function score(alpha, W, H, res) {
  const cov = coverage(res.groups, W, H, res.bbox.cx, res.bbox.cy, 4);
  let inter = 0, uni = 0, sae = 0;
  for (let i = 0; i < W * H; i++) {
    const a = alpha[i] >= 128 ? 1 : 0;
    const b = cov[i] >= 0.5 ? 1 : 0;
    if (a && b) inter++;
    if (a || b) uni++;
    sae += Math.abs(cov[i] - alpha[i] / 255);
  }
  return { iou: uni ? inter / uni : 0, mae: sae / (W * H) };
}

/* ---------- 1. 参数扫描 ---------- */
const grid = [];
for (const blur of [0, 0.6, 1.0]) for (const simplify of [0.15, 0.3, 0.5, 0.85]) grid.push({ blur, simplify });

console.log('参数扫描（各用例平均）');
console.log('blur  simplify   meanIoU   minIoU   meanPts   ms');
console.log('--------------------------------------------------------');
const results = [];
for (const opt of grid) {
  let sIoU = 0, minIoU = 1, sPts = 0, sMs = 0;
  for (const c of index) {
    const buf = fs.readFileSync(path.join(HERE, c.name + '.bin'));
    const alpha = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const t0 = performance.now();
    const res = traceContours(alpha, c.width, c.height, { ...opt, minArea: 12 });
    sMs += performance.now() - t0;
    if (!res.bbox) { minIoU = 0; continue; }
    const r = score(alpha, c.width, c.height, res);
    sIoU += r.iou; sPts += res.stats.points;
    if (r.iou < minIoU) minIoU = r.iou;
  }
  const n = index.length;
  results.push({ opt, meanIoU: sIoU / n, minIoU, pts: sPts / n, ms: sMs / n });
  console.log(
    `${String(opt.blur).padEnd(5)} ${String(opt.simplify).padEnd(9)} ` +
    `${(sIoU / n).toFixed(5)}   ${minIoU.toFixed(5)}   ${(sPts / n).toFixed(0).padStart(6)}   ${(sMs / n).toFixed(0)}`
  );
}

const best = results.reduce((a, b) => (b.meanIoU > a.meanIoU ? b : a));
console.log('\n最优参数:', JSON.stringify(best.opt), ' meanIoU=', best.meanIoU.toFixed(5));
console.log('\n逐用例（用最优参数）');
console.log('case   text      loops holes  pts    IoU       MAE       ms');
console.log('--------------------------------------------------------------');
let fails = 0;
for (const c of index) {
  const buf = fs.readFileSync(path.join(HERE, c.name + '.bin'));
  const alpha = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const t0 = performance.now();
  const res = traceContours(alpha, c.width, c.height, { ...best.opt, minArea: 12 });
  const ms = performance.now() - t0;
  const r = score(alpha, c.width, c.height, res);
  const ok = r.iou >= 0.99;
  if (!ok) fails++;
  console.log(
    `${c.name}  ${c.text.padEnd(8)}  ${String(res.stats.loops).padStart(4)} ` +
    `${String(res.stats.holes).padStart(5)} ${String(res.stats.points).padStart(6)}  ` +
    `${r.iou.toFixed(5)}  ${r.mae.toFixed(5)}  ${ms.toFixed(0)}${ok ? '' : '  <== FAIL'}`
  );
}
console.log('--------------------------------------------------------------');
console.log(fails === 0 ? '全部通过 (IoU >= 0.99)' : `${fails} 个用例未达 0.99`);
