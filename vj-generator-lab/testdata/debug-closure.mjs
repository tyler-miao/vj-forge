import fs from 'node:fs';
import * as THREE from 'three';
import { planGraffiti } from '../src/graffiti-outline.js';
import { traceContours } from '../src/trace-contours.js';
import { stylizeGroups } from '../src/stylize-contours.js';

const HTML = 'C:/Users/Colorful/Documents/deepseek-harness/default-workspace/vj-generator-lab/prototype/latest.html';
const html = fs.readFileSync(HTML, 'utf8');
const src = html.match(/function planToGeo\(plan, ox, oy, z0, z1\)\{[\s\S]*?\n\}/)[0];
const planToGeo = new Function('THREE', 'GRAF', src + '\nreturn planToGeo;')(THREE, await import('../src/graffiti-outline.js'));

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const idx = JSON.parse(fs.readFileSync(HERE + 'index.json', 'utf8'));
const c = idx.find(x => x.name === 'case00');
const buf = fs.readFileSync(HERE + 'case00.bin');
const alpha = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
const res = traceContours(alpha, c.width, c.height);
const norm = 1 / res.bbox.inkH;
const groups = res.groups.map(g => ({ outer: g.outer.map(p => ({ x: p.x * norm, y: p.y * norm })), holes: g.holes.map(h => h.map(p => ({ x: p.x * norm, y: p.y * norm }))) }));
const styled = stylizeGroups(groups, { dilate: .030, spike: 1.20, shear: .14, arch: .08, round: 0, rough: 0, persp: .10, seed: 1337 });
let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
for (const g of styled) for (const p of g.outer) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y); }
const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
const outs = styled.map(g => g.outer.map(p => ({ x: p.x - cx, y: p.y - cy })));

const plan = planGraffiti(outs, { width: .06, coverage: .785, gaps: 3, jitter: .55, overlap: .03, drips: 2, dripLen: .17, dripWidth: .03, arrows: 1, arrowLen: .16, splats: 4, splatSize: .02, tags: 2, tagWidth: .026, tagLen: .22, swash: true, spikes: 2, spikeLen: .13, hatches: 1, hatchWidth: .016, hatchLen: .13, seed: 20261008 });

function residual(g) {
  const pos = g.attributes.position, nrm = g.attributes.normal;
  let sx = 0, sy = 0, tot = 0, wallVerts = 0, runs = [];
  let i = 0;
  while (i < nrm.count) {
    if (nrm.getZ(i) !== 0) { i++; continue; }
    let j = i; while (j < nrm.count && nrm.getZ(j) === 0) j++;
    runs.push(j - i);
    for (let k = i; k + 5 < j; k += 6) {
      const dx = pos.getX(k + 1) - pos.getX(k), dy = pos.getY(k + 1) - pos.getY(k);
      const L = Math.hypot(dx, dy);
      sx += nrm.getX(k) * L; sy += nrm.getY(k) * L; tot += L;
    }
    wallVerts += j - i;
    i = j;
  }
  return { rem: Math.hypot(sx, sy) / (tot || 1), tot, runs };
}

let bad = 0;
plan.stripRoles.forEach((role, i) => {
  const g = planToGeo({ strips: [plan.strips[i]], shapes: [] }, 0, 0, -0.17, 0.157);
  const r = residual(g);
  if (r.rem > 1e-3) { bad++; console.log(`strip#${i} role=${role} rem=${r.rem.toFixed(4)} tot=${r.tot.toFixed(2)} runs=${JSON.stringify(r.runs)}`); }
  g.dispose();
});
plan.shapeRoles.forEach((role, i) => {
  const g = planToGeo({ strips: [], shapes: [plan.shapes[i]] }, 0, 0, -0.17, 0.157);
  const r = residual(g);
  if (r.rem > 1e-3) { bad++; console.log(`shape#${i} role=${role} rem=${r.rem.toFixed(4)} tot=${r.tot.toFixed(3)} runs=${JSON.stringify(r.runs)}`); }
  g.dispose();
});
console.log('bad elements =', bad, '/', (plan.stripRoles.length + plan.shapeRoles.length));
