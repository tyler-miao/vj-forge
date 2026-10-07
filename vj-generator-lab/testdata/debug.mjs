import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { traceContours } from '../src/trace-contours.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const index = JSON.parse(fs.readFileSync(path.join(HERE, 'index.json'), 'utf8'));

for (const c of index.slice(0, 3)) {
  const buf = fs.readFileSync(path.join(HERE, c.name + '.bin'));
  const alpha = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const W = c.width, H = c.height;

  let nz = 0, minX = W, minY = H, maxX = -1, maxY = -1, maxVal = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = alpha[y * W + x];
    if (v > maxVal) maxVal = v;
    if (v > 8) {
      nz++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  console.log(`\n=== ${c.name} ${c.text} ===`);
  console.log(`bytes=${alpha.length} expected=${W * H} maxVal=${maxVal} inkPixels=${nz}`);
  console.log(`ink bbox = x[${minX},${maxX}] y[${minY},${maxY}]  -> ${maxX - minX + 1} x ${maxY - minY + 1}`);
  console.log(`index.json textW/H = ${c.textW} x ${c.textH}`);

  for (const opt of [{ blur: 0, simplify: 0, minArea: 0 }, { blur: 1, simplify: 0.85, minArea: 12 }]) {
    const r = traceContours(alpha, W, H, opt);
    const sizes = r.groups.map(g => g.outer.length);
    console.log(`  opts=${JSON.stringify(opt)} -> loops=${r.stats.loops} points=${r.stats.points} groups=${r.groups.length} outerSizes=[${sizes.join(',')}]`);
    if (r.bbox) console.log(`    bbox w=${r.bbox.w} h=${r.bbox.h} cx=${r.bbox.cx.toFixed(1)} cy=${r.bbox.cy.toFixed(1)}`);
  }
}
