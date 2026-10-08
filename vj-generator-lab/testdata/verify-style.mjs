/**
 * 字形几何变形的定量验证。
 *
 * 判据不是"看着像"，而是 Steiner 公式：小量外扩 d 时，面积增量应约等于 P·d
 * （P 为周长）。这能一次性验证法线方向、斜接长度、绕向归一化是否全对 ——
 * 符号搞反的话面积会变小，立刻暴露。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { traceContours } from '../src/trace-contours.js';
import {
  stylizeGroups, materialArea, totalPerimeter, hasNaN, ringArea
} from '../src/stylize-contours.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const index = JSON.parse(fs.readFileSync(path.join(HERE, 'index.json'), 'utf8'));

const STYLE = { dilate: 0, spike: 0, shear: 0, arch: 0 };
let failures = 0;
const fail = (msg) => { console.log('   ✗ ' + msg); failures++; };

console.log('case   text     A0       P       外扩0.02 实测ΔA   预期P·d    比值   内缩ΔA   尖刺ΔA');
console.log('------------------------------------------------------------------------------------------');

for (const c of index) {
  const buf = fs.readFileSync(path.join(HERE, c.name + '.bin'));
  const alpha = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const res = traceContours(alpha, c.width, c.height);
  const norm = 1 / Math.max(res.bbox.inkH, 1);
  const base = res.groups.map(g => ({
    outer: g.outer.map(p => ({ x: p.x * norm, y: p.y * norm })),
    holes: g.holes.map(h => h.map(p => ({ x: p.x * norm, y: p.y * norm })))
  }));

  const A0 = materialArea(base);
  const P = totalPerimeter(base);
  const d = 0.02;

  const out = stylizeGroups(base, { ...STYLE, dilate: d });
  const inn = stylizeGroups(base, { ...STYLE, dilate: -d });
  const spk = stylizeGroups(base, { ...STYLE, spike: 1.0 });

  const Aout = materialArea(out), Ain = materialArea(inn), Aspk = materialArea(spk);
  const dOut = Aout - A0, dIn = Ain - A0, dSpk = Aspk - A0;
  const expect = P * d;
  const ratio = dOut / expect;

  console.log(
    `${c.name}  ${c.text.padEnd(7)} ${A0.toFixed(3)}  ${P.toFixed(2)}  ` +
    `${dOut >= 0 ? '+' : ''}${dOut.toFixed(4)}      ${expect.toFixed(4)}   ${ratio.toFixed(2)}  ` +
    `${dIn >= 0 ? '+' : ''}${dIn.toFixed(4)}  ${dSpk >= 0 ? '+' : ''}${dSpk.toFixed(4)}`
  );

  // 1) 外扩必须让材质变大，且量级符合 P·d（允许 0.5~2 倍，因为尖角斜接会多算）
  if (dOut <= 0) fail(`${c.text}: 外扩后面积没变大（法线方向反了？）`);
  if (ratio < 0.5 || ratio > 2.0) fail(`${c.text}: 外扩面积增量 ${ratio.toFixed(2)}×P·d，超出合理范围`);

  // 2) 内缩必须让材质变小
  if (dIn >= 0) fail(`${c.text}: 内缩后面积没变小`);

  // 3) 尖角延伸只能让面积增加
  if (dSpk < 0) fail(`${c.text}: 尖角延伸让面积变小了`);

  // 4) 不能出现非法坐标
  if (hasNaN(out) || hasNaN(inn) || hasNaN(spk)) fail(`${c.text}: 变形后出现 NaN/Infinity`);

  // 5) 顶点数必须守恒（变形不能增删点）
  for (const grp of [out, inn, spk]) {
    if (grp.length !== base.length) fail(`${c.text}: 轮廓条数变了`);
    for (let i = 0; i < grp.length; i++) {
      if (grp[i].outer.length !== base[i].outer.length) fail(`${c.text}: 外轮廓顶点数变了`);
      if (grp[i].holes.length !== base[i].holes.length) fail(`${c.text}: 洞数变了`);
    }
  }

  // 6) 绕向必须保持（后续依赖它，破坏了会导致渲染内外翻转）
  for (let i = 0; i < out.length; i++) {
    if (Math.sign(ringArea(out[i].outer)) !== Math.sign(ringArea(base[i].outer)))
      fail(`${c.text}: 外轮廓绕向被改变`);
    for (let j = 0; j < out[i].holes.length; j++) {
      if (Math.sign(ringArea(out[i].holes[j])) !== Math.sign(ringArea(base[i].holes[j])))
        fail(`${c.text}: 洞的绕向被改变`);
    }
  }

  // 7) 斜切面积守恒（变换的行列式为 1）
  const shr = stylizeGroups(base, { ...STYLE, shear: 0.25 });
  const dShr = Math.abs(materialArea(shr) - A0) / A0;
  if (dShr > 0.02) fail(`${c.text}: 斜切改变了 ${(dShr * 100).toFixed(1)}% 面积，应该基本守恒`);
}

/* ---------- 附加变形：圆角 / 毛边 / 透视 ---------- */
console.log('\n附加变形（用例：回 —— 直角多，最容易看出圆角）');

function loadBase(name) {
  const c = index.find(x => x.name === name);
  const buf = fs.readFileSync(path.join(HERE, c.name + '.bin'));
  const alpha = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const res = traceContours(alpha, c.width, c.height);
  const norm = 1 / Math.max(res.bbox.inkH, 1);
  return res.groups.map(g => ({
    outer: g.outer.map(p => ({ x: p.x * norm, y: p.y * norm })),
    holes: g.holes.map(p => p.map(q => ({ x: q.x * norm, y: q.y * norm })))
  }));
}

const R = loadBase('case02');
const A0R = materialArea(R);
const pts0 = R.reduce((s, g) => s + g.outer.length + g.holes.reduce((t, h) => t + h.length, 0), 0);

// 圆角：顶点变多、周长变短、不出非法值
// 注意不能拿"面积变小"当判据 —— 圆角同时切掉外轮廓的角和洞的角，
// 前者让材质变小、后者让材质变大，两者几乎抵消。周长变短才是恒成立的不变量。
const rounded = stylizeGroups(R, { ...STYLE, round: 0.03 });
const ptsRound = rounded.reduce((s, g) => s + g.outer.length + g.holes.reduce((t, h) => t + h.length, 0), 0);
const per0 = totalPerimeter(R), perR = totalPerimeter(rounded);
console.log(`  圆角 0.03 : 顶点 ${pts0} → ${ptsRound}，周长 ${per0.toFixed(4)} → ${perR.toFixed(4)}`);
if (hasNaN(rounded)) fail('圆角产生了 NaN');
if (ptsRound <= pts0) fail('圆角没有增加顶点数');
if (!(perR < per0)) fail('圆角后周长没有变短（切角必然让边界变短）');
if (JSON.stringify(rounded) === JSON.stringify(R)) fail('圆角没有实际改变几何');

// 毛边：同种子必须完全一致（录视频要可复现），不同种子必须不同
const roughA = stylizeGroups(R, { ...STYLE, rough: 0.006, seed: 42 });
const roughB = stylizeGroups(R, { ...STYLE, rough: 0.006, seed: 42 });
const roughC = stylizeGroups(R, { ...STYLE, rough: 0.006, seed: 43 });
const same = JSON.stringify(roughA) === JSON.stringify(roughB);
const diff = JSON.stringify(roughA) !== JSON.stringify(roughC);
console.log(`  毛边      : 同种子一致=${same}  换种子不同=${diff}`);
if (!same) fail('毛边不可复现：同样的种子给出了不同结果');
if (!diff) fail('毛边对种子不敏感');
if (hasNaN(roughA)) fail('毛边产生了 NaN');

// 透视：k>0 时上半部分应比下半部分宽
const persp = stylizeGroups(R, { ...STYLE, persp: 0.35 });
function widthWhere(groups, pred) {
  let mn = Infinity, mx = -Infinity;
  for (const g of groups) for (const ring of [g.outer, ...g.holes]) for (const p of ring) {
    if (pred(p.y)) { if (p.x < mn) mn = p.x; if (p.x > mx) mx = p.x; }
  }
  return mx - mn;
}
const wTop = widthWhere(persp, y => y > 0.25);
const wBot = widthWhere(persp, y => y < -0.25);
console.log(`  透视 0.35 : 上部宽 ${wTop.toFixed(3)}  下部宽 ${wBot.toFixed(3)}`);
if (!(wTop > wBot * 1.1)) fail('透视没做出上宽下窄');
if (hasNaN(persp)) fail('透视产生了 NaN');

/* ---------- 装饰排布 ---------- */
console.log('\n装饰排布（模块：edge-adornments）');
const { profileFromPoints, layoutAdornments, PATTERNS } = await import('../src/edge-adornments.js');
const flatPts = [];
for (const g of R) for (const ring of [g.outer, ...g.holes]) for (const p of ring) flatPts.push(p);
const prof = profileFromPoints(flatPts, 40);

for (const pat of Object.keys(PATTERNS)) {
  const a = layoutAdornments({ profile: prof, sides: 'both', pattern: pat, base: 0.34, seed: 7 });
  const b = layoutAdornments({ profile: prof, sides: 'both', pattern: pat, base: 0.34, seed: 7 });
  const lens = a.map(x => x.len);
  const inRange = lens.every(l => l > 0 && l < 1.2);
  const deterministic = JSON.stringify(a) === JSON.stringify(b);
  const xInBounds = a.every(x => x.x >= prof.minX - prof.binW && x.x <= prof.maxX + prof.binW);
  console.log(`  ${pat.padEnd(7)} 根数 ${String(a.length).padStart(3)}  长度 ${Math.min(...lens).toFixed(3)}~${Math.max(...lens).toFixed(3)}  可复现=${deterministic}  范围内=${inRange && xInBounds}`);
  if (!deterministic) fail(`${pat}: 排布不可复现`);
  if (!inRange) fail(`${pat}: 长度超出合理范围`);
  if (!xInBounds) fail(`${pat}: 位置跑到字形范围外`);
  if (a.some(x => !Number.isFinite(x.x) || !Number.isFinite(x.y) || !Number.isFinite(x.len))) fail(`${pat}: 出现非法值`);
}

const onlyTop = layoutAdornments({ profile: prof, sides: 'top', pattern: 'fan', base: 0.34, seed: 7 });
const both = layoutAdornments({ profile: prof, sides: 'both', pattern: 'fan', base: 0.34, seed: 7 });
console.log(`  单边 vs 双边 : top=${onlyTop.length}  both=${both.length}`);
if (!(both.length > onlyTop.length)) fail('双边排布的根数没有多于单边');
if (onlyTop.some(x => Math.abs(x.angleZ) > 1e-9)) fail('sides=top 时出现了非朝上的装饰');

/* ---------- 整圈排布：生长方向必须背离质心 ---------- */
console.log('\n整圈排布（沿外轮廓等弧长，朝外法线生长）');
const { outlinePlacements } = await import('../src/edge-adornments.js');

// 先拿理想逆时针正方形单独验证法线，避免被真实轮廓的复杂度掩盖
const sq = [{x:-1,y:-1},{x:1,y:-1},{x:1,y:1},{x:-1,y:1}];
const sqPl = outlinePlacements(sq, { spacing: 0.4, base: 0.3, pattern: 'fan', seed: 3 });
let outward = 0;
for (const p of sqPl) {
  const gx = Math.cos(p.angleZ + Math.PI/2), gy = Math.sin(p.angleZ + Math.PI/2);  // 几何体 +Y 转到世界后的生长方向
  const rl = Math.hypot(p.x, p.y) || 1;                                            // 质心在原点
  if ((p.x/rl)*gx + (p.y/rl)*gy > 0.2) outward++;
}
console.log(`  正方形  : 根数 ${sqPl.length}，生长方向背离质心的 ${outward} / ${sqPl.length}`);
if (outward !== sqPl.length) fail('整圈排布的法线算错了（有装饰朝字形内部生长）');

const ringPl  = outlinePlacements(R[0].outer, { spacing: 0.13, base: 0.34, pattern: 'wave', seed: 11 });
const ringPl2 = outlinePlacements(R[0].outer, { spacing: 0.13, base: 0.34, pattern: 'wave', seed: 11 });
const lens2 = ringPl.map(x => x.len);
console.log(`  真实轮廓: 根数 ${ringPl.length}  长度 ${Math.min(...lens2).toFixed(3)}~${Math.max(...lens2).toFixed(3)}  可复现=${JSON.stringify(ringPl) === JSON.stringify(ringPl2)}`);
if (!(ringPl.length > 0)) fail('整圈排布没有产出任何装饰');
if (JSON.stringify(ringPl) !== JSON.stringify(ringPl2)) fail('整圈排布不可复现');
if (ringPl.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.angleZ))) fail('整圈排布出现非法值');
if (lens2.some(l => !(l > 0 && l < 1.2))) fail('整圈排布长度超出合理范围');

let cx2 = 0, cy2 = 0;
for (const p of R[0].outer) { cx2 += p.x; cy2 += p.y; }
cx2 /= R[0].outer.length; cy2 /= R[0].outer.length;
let out2 = 0;
for (const p of ringPl) {
  const gx = Math.cos(p.angleZ + Math.PI/2), gy = Math.sin(p.angleZ + Math.PI/2);
  const rl = Math.hypot(p.x - cx2, p.y - cy2) || 1;
  if (((p.x-cx2)/rl)*gx + ((p.y-cy2)/rl)*gy > 0) out2++;
}
console.log(`  真实轮廓: 背离质心 ${out2} / ${ringPl.length}`);
if (out2 < ringPl.length * 0.9) fail('真实轮廓上有相当一部分装饰朝内生长');

/* ---------- 缠绕路径 ---------- */
console.log('\n缠绕路径（模块：edge-adornments.strandPath）');
const { strandPath } = await import('../src/edge-adornments.js');

const sqRing = [{x:-1,y:-1},{x:1,y:-1},{x:1,y:1},{x:-1,y:1}];
for (const turns of [3, 8, 17]) {
  const path = strandPath(sqRing, { turns, amp: 0.05, depth: 0.08, samples: turns * 40 });
  const zs = path.map(p => p.z);
  const zMax = Math.max(...zs.map(Math.abs));
  // 闭合性：最后一点与第一点应当几乎重合（turns 取整才会这样）
  const a = path[0], b = path[path.length - 1];
  const wrapGap = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  // 每个点都应落在轮廓附近的一圈里（离轮廓不超过 amp + 一点点）
  let maxDev = 0;
  for (const p of path) {
    const d = Math.max(Math.abs(p.x), Math.abs(p.y));   // 正方形边界到原点用切比雪夫距离
    maxDev = Math.max(maxDev, Math.abs(d - 1));
  }
  console.log(`  圈数 ${String(turns).padStart(2)} : 点数 ${String(path.length).padStart(3)}  Z 振幅 ${zMax.toFixed(3)}  首尾间距 ${wrapGap.toFixed(4)}  最大偏离轮廓 ${maxDev.toFixed(3)}`);
  if (!(zMax > 0.05 && zMax <= 0.081)) fail(`缠绕 turns=${turns}: Z 振幅异常`);
  if (wrapGap > 0.12) fail(`缠绕 turns=${turns}: 首尾没接上（间距 ${wrapGap.toFixed(3)}）`);
  if (maxDev > 0.06) fail(`缠绕 turns=${turns}: 偏离轮廓过多`);
  if (path.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z))) fail(`缠绕 turns=${turns}: 出现非法值`);
}
const sp1 = strandPath(R[0].outer, { turns: 9, amp: 0.03, depth: 0.06 });
const sp2 = strandPath(R[0].outer, { turns: 9, amp: 0.03, depth: 0.06 });
console.log(`  真实轮廓: 点数 ${sp1.length}  可复现=${JSON.stringify(sp1) === JSON.stringify(sp2)}`);
if (JSON.stringify(sp1) !== JSON.stringify(sp2)) fail('缠绕路径不可复现');
if (strandPath([{x:0,y:0},{x:1,y:1}], { turns: 5 }) !== null) fail('缠绕：点数不足时应返回 null');

console.log('------------------------------------------------------------------------------------------');
if (failures === 0) {
  console.log('全部通过：法线方向、斜接、绕向、面积守恒、圆角、毛边、透视、装饰排布、整圈法线、缠绕闭合');
} else {
  console.log(`${failures} 项未通过`);
  process.exit(1);
}
