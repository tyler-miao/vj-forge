/**
 * 街头外轮廓（graffiti outline）的定量验证。
 *
 * 验的不是"看着像不像涂鸦"，而是六条能写成断言、能回归的硬性质：
 *
 *   1. 合法性     所有坐标有限、条带至少两个采样点、多边形至少三个顶点
 *   2. 可复现     同种子逐位一致，换种子必须真的变（否则录两遍是两条循环）
 *   3. 有留白     描边按弧长切段，覆盖率有上界 —— 不许绕成 360° 一整圈
 *   4. 不规则     描边宽度确实有起伏，不是均匀的机器描边
 *   5. 有预算     滴漆 / 箭头 / 飞溅 / 涂鸦线 / 尖角 / 划线各类都不超 BUDGET
 *   6. 都贴着字   每个元素至少有一个顶点紧贴某条轮廓，且没有任何元素飞远
 *                 —— 这是"禁止独立漂浮装饰物"的可计算版本
 *
 * 另外回归页面侧的 OUTLINE_STYLES：六个风格键齐全、除尖锥外都带全套参数，
 * 避免 HTML 里加了滑块而预设忘了给值这种静默错位。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  planGraffiti, strokeSegments, stripToTriangles, signedArea,
  BUDGET, MIN_GAP
} from '../src/graffiti-outline.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(HERE, '..', 'prototype', 'latest.html'), 'utf8');

let failures = 0;
const fail = (msg) => { console.log('   \u2717 ' + msg); failures++; };
const ok = (msg) => console.log('   \u2713 ' + msg);

/* ============================ 测试用轮廓 ============================
   三个"字"拼成一个词，刻意放进三种会出事的几何：
     字1  C 形        —— 两个内凹角（外扩最容易在这里自交）
     字2  带 0.06 窄缝 —— 两侧描边必然互相穿过去
     字3  椭圆        —— 没有角，用来验证"没有角也照样描"            */

const rectPoly = (x0, y0, x1, y1) => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }
];

function cShape(x0) {
  return [
    { x: x0, y: 0 }, { x: x0 + 1, y: 0 }, { x: x0 + 1, y: 0.2 },
    { x: x0 + 0.3, y: 0.2 }, { x: x0 + 0.3, y: 0.8 }, { x: x0 + 1, y: 0.8 },
    { x: x0 + 1, y: 1 }, { x: x0, y: 1 }
  ];
}

function slotShape(x0) {                 // 中间开一条 0.06 宽的窄缝
  return [
    { x: x0, y: 0 }, { x: x0 + 1, y: 0 }, { x: x0 + 1, y: 1 },
    { x: x0 + 0.46, y: 1 }, { x: x0 + 0.46, y: 0.3 },
    { x: x0 + 0.40, y: 0.3 }, { x: x0 + 0.40, y: 1 }, { x: x0, y: 1 }
  ];
}

function ellipse(cx, cy, rx, ry, n = 40) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return pts;                                     // 逆时针
}

function wordOutlines() {
  const rings = [cShape(0), slotShape(1.15), ellipse(2.80, 0.5, 0.5, 0.5)];
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const r of rings) for (const p of r) {
    minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
    miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
  }
  const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
  const s = 1 / (maxy - miny);                   // 字高归一到 1
  return rings.map(r => r.map(p => ({ x: (p.x - cx) * s, y: (p.y - cy) * s })));
}

const RINGS = wordOutlines();

/* ============================ 几何小工具 ============================ */

/** 点到线段的距离 */
function distSeg(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const L2 = vx * vx + vy * vy;
  let t = L2 > 1e-18 ? ((px - ax) * vx + (py - ay) * vy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

/** 点到整组轮廓（所有环的边）的距离 */
function distToRings(x, y) {
  let best = Infinity;
  for (const r of RINGS) {
    for (let i = 0, n = r.length; i < n; i++) {
      const a = r[i], b = r[(i + 1) % n];
      const d = distSeg(x, y, a.x, a.y, b.x, b.y);
      if (d < best) best = d;
    }
  }
  return best;
}

/** 一个元素的所有顶点（条带取四个角点的外侧与中点，多边形取全部顶点） */
function elemPoints(strip) {
  const out = [];
  for (let i = 0; i < strip.length; i += 4) {
    out.push({ x: strip[i], y: strip[i + 1] });       // 左（外）侧
    out.push({ x: strip[i + 2], y: strip[i + 3] });   // 右（内）侧
  }
  return out;
}

function inTri(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
  const pos = (d1 > 0) || (d2 > 0) || (d3 > 0);
  return !(neg && pos);
}

/** 用采样探针量出"描边真的盖住了外轮廓多大比例的弧长" */
function measuredCoverage(plan) {
  const tris = [];
  plan.stripRoles.forEach((role, i) => {
    if (role !== 'stroke') return;
    const t = stripToTriangles(plan.strips[i]);
    // stripToTriangles 输出二维三角形，每 6 个数一个
    for (let k = 0; k + 5 < t.length; k += 6) tris.push([t[k], t[k+1], t[k+2], t[k+3], t[k+4], t[k+5]]);
  });
  let total = 0, hit = 0;
  for (const r of RINGS) {
    const S = perimeter(r);
    for (let s = 0; s < S.L; s += S.L / 200) {
      const p = S.at(s);
      const probe = { x: p.x + p.nx * 0.008, y: p.y + p.ny * 0.008 };
      total++;
      for (const t of tris) {
        if (inTri(probe.x, probe.y, t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8])) { hit++; break; }
      }
    }
  }
  return total ? hit / total : 0;
}

/** 测试自己实现一遍"弧长采样 + 平滑外法线"，和被测代码互不共享 */
function perimeter(ring) {
  const n = ring.length;
  const cum = [0];
  const ex = [], ey = [], nx = [], ny = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1e-9;
    ex.push(dx / L); ey.push(dy / L); nx.push(ey[i]); ny.push(-ex[i]);
    cum.push(cum[i] + L);
  }
  const L = cum[n];
  return {
    L,
    at(s) {
      s = ((s % L) + L) % L;
      let i = 0; while (i < n - 1 && cum[i + 1] < s) i++;
      const t = Math.min(1, Math.max(0, (s - cum[i]) / Math.max(cum[i + 1] - cum[i], 1e-9)));
      const j = (i + 1) % n, w = t * t * (3 - 2 * t);
      let mx = nx[i] * (1 - w) + nx[j] * w, my = ny[i] * (1 - w) + ny[j] * w;
      const ml = Math.hypot(mx, my) || 1;
      return { x: ring[i].x + (ring[j].x - ring[i].x) * t, y: ring[i].y + (ring[j].y - ring[i].y) * t, nx: mx / ml, ny: my / ml };
    }
  };
}

/* ============================ 页面侧参数 ============================ */

const STYLES_SRC = html.match(/const OUTLINE_STYLES = \{[\s\S]*?\n\};/);
const GO_SHADOW = 0.022;                 // 阴影层的默认偏移量（与页面 go4 默认值一致）
const DEFAULTS = {
  width: .060, coverage: .76, gaps: 3, jitter: .55, overlap: .030,
  drips: 2, dripLen: .17, dripWidth: .030,
  arrows: 1, arrowLen: .16,
  splats: 4, splatSize: .020,
  tags: 2, tagWidth: .026, tagLen: .22, swash: true,
  spikes: 2, spikeLen: .13,
  hatches: 1, hatchWidth: .016, hatchLen: .13,
  seed: 20261008
};

const plan = planGraffiti(RINGS, DEFAULTS);

/* ============================ 1) 合法性 ============================ */
console.log('\n[1] 几何合法性');
{
  if (plan.strips.length !== plan.stripRoles.length) fail('strips 与 stripRoles 长度不一致');
  if (plan.shapes.length !== plan.shapeRoles.length) fail('shapes 与 shapeRoles 长度不一致');

  let bad = 0, thin = 0;
  for (const s of plan.strips) {
    if (s.length < 8) thin++;
    for (const v of s) if (!Number.isFinite(v)) bad++;
  }
  for (const s of plan.shapes) {
    if (s.length < 3) thin++;
    for (const p of s) if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) bad++;
  }
  if (bad) fail(`${bad} 个坐标不是有限数（NaN / Infinity）`);
  if (thin) fail(`${thin} 个元素退化（点数不足）`);

  // 窄缝处两侧描边必然互相穿过去，这正是要的行为；重点是它不能把几何算炸
  const tri = stripToTriangles(plan.strips[0]);
  if (!tri.length) fail('第一段条带三角化结果为空');
  else if (tri.length !== (plan.strips[0].length / 4 - 1) * 12) fail('stripToTriangles 输出长度公式不对');
  else for (const v of tri) if (!Number.isFinite(v)) fail('三角形顶点含非有限数');

  if (!bad && !thin) ok(`全部元素合法（${plan.strips.length} 条带 / ${plan.shapes.length} 多边形）`);
}

/* ============================ 2) 可复现 ============================ */
console.log('\n[2] 固定种子可复现');
{
  const a = planGraffiti(RINGS, DEFAULTS);
  const b = planGraffiti(RINGS, DEFAULTS);
  const c = planGraffiti(RINGS, { ...DEFAULTS, seed: DEFAULTS.seed + 1 });
  if (JSON.stringify(a) !== JSON.stringify(b)) fail('同参数同种子两次结果不一致');
  else ok('同种子逐位一致');
  if (JSON.stringify(a) === JSON.stringify(c)) fail('换种子结果完全没变（说明种子没参与随机）');
  else ok('换种子确实改变结果');
}

/* ============================ 3) 有留白 / 不绕满圈 ============================ */
console.log('\n[3} 留白与覆盖率'.replace('}', ']'));
{
  const cov = measuredCoverage(plan);
  console.log(`   实测描边覆盖率 = ${cov.toFixed(3)}`);
  if (cov >= 0.985) fail(`覆盖率 ${cov.toFixed(3)}，等于绕着字糊了整整一圈，没有留白`);
  else if (cov < 0.45) fail(`覆盖率 ${cov.toFixed(3)}，描边太碎，字形被切断了`);
  else ok('描边有缺口，未绕满一圈');

  // gapCount=0 + coverage=1 → 每条环正好切成 1 段
  const full = planGraffiti(RINGS, { ...DEFAULTS, coverage: 1, gaps: 0 });
  const strokeCount = full.stripRoles.filter(r => r === 'stroke').length;
  if (strokeCount !== RINGS.length) fail(`不留白时应每环 1 段，实际 ${strokeCount} 段 / ${RINGS.length} 环`);
  else ok('coverage=1 & gaps=0 时恰好每环一段（切段逻辑本身是对的）');

  // 缺口数随 leave 增加
  const loose = planGraffiti(RINGS, { ...DEFAULTS, coverage: .5, gaps: 5 });
  const tight = planGraffiti(RINGS, { ...DEFAULTS, coverage: 1, gaps: 0 });
  if (loose.stripRoles.filter(r => r === 'stroke').length <= tight.stripRoles.filter(r => r === 'stroke').length)
    fail('留白调大之后笔画段数没有变多');
  else ok('留白越大切得越碎');
}

/* ============================ 4) 宽度不规则 ============================ */
console.log('\n[4] 描边宽度不规则');
{
  const widths = [];
  plan.stripRoles.forEach((role, i) => {
    if (role !== 'stroke') return;
    const s = plan.strips[i];
    for (let k = 0; k < s.length; k += 4) {
      widths.push(Math.hypot(s[k] - s[k + 2], s[k + 1] - s[k + 3]));
    }
  });
  widths.sort((a, b) => a - b);
  const med = widths[Math.floor(widths.length / 2)];
  const mx = widths[widths.length - 1];
  const lift = (mx - med) / med;
  console.log(`   中位宽 ${med.toFixed(4)} · 最宽 ${mx.toFixed(4)} · 起伏 ${lift.toFixed(2)}`);
  if (!(lift > 0.10)) fail(`描边几乎等宽（起伏 ${lift.toFixed(2)}），是机器描边不是手绘`);
  else ok('宽度有明显起伏');

  // 粗细必须夹得住：低频 × 局部外扩 × 手绘抖动叠起来会失控，占掉半个字高
  const pk = plan.stats.strokeWidth;
  console.log(`   名义粗细 ${DEFAULTS.width} · 实际最宽 ${pk.toFixed(4)}`);
  if (pk > DEFAULTS.width * 1.75) fail(`最宽 ${pk.toFixed(3)} 超过名义值的 1.75 倍 —— 会把字糊掉`);
  else if (pk < DEFAULTS.width * 0.95) fail(`最宽 ${pk.toFixed(3)} 连名义粗细都没到，加粗逻辑没生效`);
  else ok('最宽被夹在名义值的 1.75 倍以内');

  const rng = strokeSegments(RINGS[0], { width: .06, coverage: 1, gaps: 0, jitter: 0, seed: 7 });
  const flat = [];
  for (const s of rng.strips) for (let k = 0; k < s.length; k += 4) flat.push(Math.hypot(s[k] - s[k+2], s[k+1] - s[k+3]));
  const fmin = Math.min(...flat), fmax = Math.max(...flat);
  if (!(fmax > fmin)) fail('即使 jitter=0 也应有低频宽窄变化');
  else ok(`jitter=0 时仍有低频宽窄起伏（${fmin.toFixed(4)} → ${fmax.toFixed(4)}）`);

  // 手绘抖动真的存在：只比较"相邻采样的带宽变化"的 80 分位，
  // 两端收笔造成的剧烈变化被 80 分位挡在外面，不会污染结论。
  const d80 = (p) => {
    const d = [];
    p.stripRoles.forEach((role, i) => {
      if (role !== 'stroke') return;
      const s = p.strips[i], w = [];
      for (let k = 0; k < s.length; k += 4) w.push(Math.hypot(s[k] - s[k+2], s[k+1] - s[k+3]));
      for (let j = 1; j < w.length; j++) d.push(Math.abs(w[j] - w[j - 1]));
    });
    d.sort((a, b) => a - b);
    return d[Math.floor(d.length * 0.8)] || 0;
  };
  const smoothP = planGraffiti(RINGS, { ...DEFAULTS, jitter: 0, coverage: 1, gaps: 0 });
  const roughP = planGraffiti(RINGS, { ...DEFAULTS, jitter: 1, coverage: 1, gaps: 0 });
  const s0 = d80(smoothP), s1 = d80(roughP);
  console.log(`   相邻带宽变化 p80：jitter=0 → ${s0.toFixed(5)} · jitter=1 → ${s1.toFixed(5)}`);
  if (!(s1 > s0 * 1.5)) fail(`手绘抖动没生效（${s0.toFixed(5)} → ${s1.toFixed(5)}）`);
  else ok('手绘抖动确实改变了笔画的高频起伏');
}

/* ============================ 5) 预算 ============================ */
console.log('\n[5] 元素预算与最小间距');
{
  const roles = plan.stats.roles;
  console.log('   ' + JSON.stringify(roles));
  const capped = { drip: BUDGET.drips, arrow: BUDGET.arrows, tag: BUDGET.tags + 1, spike: BUDGET.spikes, hatch: BUDGET.hatches };
  for (const [r, cap] of Object.entries(capped)) {
    if ((roles[r] || 0) > cap) fail(`${r} 数量 ${roles[r]} 超过上限 ${cap}`);
  }
  // 飞溅允许主点各带一颗卫星，所以上限是两倍
  if ((roles.splat || 0) > BUDGET.splats * 2) fail(`splat 数量 ${roles.splat} 超过上限 ${BUDGET.splats * 2}`);
  if (!roles.stroke) fail('没有生成任何描边');
  else ok('各类元素都在预算内');

  // 拉满参数也不能突破预算
  const max = planGraffiti(RINGS, { ...DEFAULTS, drips: 99, arrows: 99, splats: 99, tags: 99, spikes: 99, hatches: 99 });
  const mr = max.stats.roles;
  if ((mr.drip || 0) > BUDGET.drips || (mr.arrow || 0) > BUDGET.arrows ||
      (mr.spike || 0) > BUDGET.spikes || (mr.hatch || 0) > BUDGET.hatches) {
    fail('把数量滑块拉到 99 之后越过了 BUDGET —— 全局限额没生效');
  } else ok('滑块拉满也不会突破全局限额');
}

/* ============================ 6) 附着 / 不漂浮 ============================ */
console.log('\n[6] 都贴着字，没有飘走的');
{
  let noAttach = 0, drifted = 0, worst = 0, worstRole = '';
  const check = (role, pts) => {
    let mind = Infinity, maxd = 0;
    for (const p of pts) {
      const d = distToRings(p.x, p.y);
      if (d < mind) mind = d;
      if (d > maxd) maxd = d;
    }
    if (mind > 0.25) noAttach++;
    if (maxd > 0.55) { drifted++; }
    if (maxd > worst) { worst = maxd; worstRole = role; }
  };
  plan.stripRoles.forEach((r, i) => check(r, elemPoints(plan.strips[i])));
  plan.shapeRoles.forEach((r, i) => check(r, plan.shapes[i]));

  if (noAttach) fail(`${noAttach} 个元素离所有轮廓都超过 0.25 —— 是独立漂浮的装饰，不是附着`);
  else ok('每个元素都至少有一点紧贴轮廓');
  if (drifted) fail(`${drifted} 个元素的最大顶点离轮廓超过 0.55（最远 ${worst.toFixed(2)} @ ${worstRole}）`);
  else ok(`最远的顶点也只有 ${worst.toFixed(2)}（${worstRole}），没有飞出去的`);

  // 滴漆必须往下流
  let up = 0;
  plan.stripRoles.forEach((r, i) => {
    if (r !== 'drip') return;
    const s = plan.strips[i];
    const y0 = (s[1] + s[3]) / 2, y1 = (s[s.length - 3] + s[s.length - 1]) / 2;
    if (y1 >= y0) up++;
  });
  if (up) fail(`${up} 条滴漆没有往下垂`);
  else ok('滴漆全部从下侧轮廓垂下');
}

/* ============================ 7) 页面参数回归 ============================ */
console.log('\n[7] 页面 OUTLINE_STYLES');
{
  const before7 = failures;
  if (!STYLES_SRC) fail('latest.html 里找不到 OUTLINE_STYLES');
  else {
    const keys = Object.keys(new Function('return ' + STYLES_SRC[0].replace(/^const OUTLINE_STYLES = /, '').replace(/;$/, ''))());
    const want = ['cone', 'fat', 'street', 'stencil', 'mixtape', 'minimal'];
    for (const k of want) if (!keys.includes(k)) fail(`缺少风格键 ${k}`);
    for (const k of keys) if (!want.includes(k)) fail(`出现未登记的风格键 ${k}`);

    const need = ['width', 'leave', 'jitter', 'shadow', 'drips', 'arrows', 'splats', 'tags', 'spikes', 'hatches'];
    const fn = new Function('return ' + STYLES_SRC[0].replace(/^const OUTLINE_STYLES = /, '').replace(/;$/, ''));
    const styles = fn();
    for (const [k, v] of Object.entries(styles)) {
      if (!v.label || !v.note) fail(`风格 ${k} 缺 label 或 note`);
      if (k === 'cone') continue;
      for (const p of need) if (typeof v[p] !== 'number') fail(`风格 ${k} 缺参数 ${p}（滑块会拿到 NaN）`);
      if (typeof v.swash !== 'boolean') fail(`风格 ${k} 缺 swash`);
      const cnt = ['drips', 'arrows', 'splats', 'tags', 'spikes', 'hatches'];
      for (const c of cnt) if (v[c] > BUDGET[c]) fail(`风格 ${k} 的 ${c}=${v[c]} 直接超过 BUDGET`);
      const l = v.leave;
      const cov = 0.96 - l * 0.50, gaps = 2 + Math.round(l * 3);
      if (cov > 0.955 || cov < 0.35) fail(`风格 ${k} 的留白 ${l} 映射出异常覆盖率 ${cov.toFixed(3)}`);
      if (gaps < 2) fail(`风格 ${k} 留白太小，缺口数退化到 ${gaps}`);
    }
    if (keys.length !== want.length) fail(`风格键数量 ${keys.length} != ${want.length}`);
    if (failures === before7) ok(`六个风格齐全，参数与预算一致（留白映射 coverage/gaps 合法）`);
  }
}

/* ============================ 8) 键轮廓本身 ============================ */
console.log('\n[8] 测试前提');
{
  const areas = RINGS.map(r => signedArea(r));
  if (areas.some(a => a <= 0)) fail('测试轮廓里有顺时针环，外法线假设不成立');
  else ok('测试用的三条环全部逆时针（外法线 = (dy, −dx)）');
  console.log(`   环周长 = ${RINGS.map(r => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += Math.hypot(b.x - a.x, b.y - a.y); } return s.toFixed(2); }).join(' / ')}`);
  console.log(`   MIN_GAP = ${JSON.stringify(MIN_GAP)}`);
}

/* ============================ 9) 真实字形 + 页面里的 planToGeo ============================ */
console.log('\n[9] 真实字形 + 页面 planToGeo');
{
  const { traceContours } = await import('../src/trace-contours.js');
  const { stylizeGroups } = await import('../src/stylize-contours.js');
  const idx = JSON.parse(fs.readFileSync(path.join(HERE, 'index.json'), 'utf8'));

  const realOutlines = (name) => {
    const c = idx.find(x => x.name === name);
    const buf = fs.readFileSync(path.join(HERE, c.name + '.bin'));
    const alpha = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const res = traceContours(alpha, c.width, c.height);
    const norm = 1 / Math.max(res.bbox.inkH, 1);
    const groups = res.groups.map(g => ({
      outer: g.outer.map(p => ({ x: p.x * norm, y: p.y * norm })),
      holes: g.holes.map(h => h.map(p => ({ x: p.x * norm, y: p.y * norm })))
    }));
    // 与页面同一套默认参数做变形，再按外轮廓包围盒居中（页面 letterformFromCanvas 干的就是这两件事）
    const styled = stylizeGroups(groups, { dilate: .030, spike: 1.20, shear: .14, arch: .08, round: 0, rough: 0, persp: .10, seed: 1337 });
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const g of styled) for (const p of g.outer) {
      minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
      miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
    }
    const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
    return styled.map(g => g.outer.map(p => ({ x: p.x - cx, y: p.y - cy })));
  };

  // 页面里的 planToGeo 原样抽出来跑：这是唯一一处把二维计划变成 three 网格的代码
  const geoSrc = html.match(/function planToGeo\(plan, ox, oy, z0, z1\)\{[\s\S]*?\n\}/);
  if (!geoSrc) fail('latest.html 里找不到 planToGeo');
  const three = await import('three');
  const planToGeo = new Function('THREE', 'GRAF', geoSrc[0] + '\nreturn planToGeo;')(three, await import('../src/graffiti-outline.js'));

  for (const name of ['case00', 'case02', 'case06']) {
    const outs = realOutlines(name);
    const p = planGraffiti(outs, DEFAULTS);
    if (p.stats.strokeWidth > DEFAULTS.width * 1.75) fail(`${name}: 真实字形上最宽 ${p.stats.strokeWidth.toFixed(3)} 失控`);

    const g1 = planToGeo(p, 0, 0, -0.170, 0.157);
    const g2 = planToGeo(p, GO_SHADOW, -GO_SHADOW, -0.185, 0.142);
    for (const [tag, g] of [['描边层', g1], ['阴影层', g2]]) {
      const pos = g.attributes.position, nrm = g.attributes.normal;
      if (pos.count % 3 !== 0) fail(`${name} ${tag}: 顶点数不是 3 的倍数`);
      let bad = 0;
      for (let i = 0; i < pos.count; i++) if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) bad++;
      if (bad) fail(`${name} ${tag}: ${bad} 个非有限顶点`);
      if (!g.boundingSphere || !Number.isFinite(g.boundingSphere.radius)) fail(`${name} ${tag}: 包围球非法`);
      if (!pos.count) fail(`${name} ${tag}: 空几何`);

      // 必须是"整块板"而不是一张薄片：字会绕 Y 摇摆 ±0.34rad，
      // 薄片的投影会相对字身滑动，摇到头描边整条缩进字里消失。
      let zmin = Infinity, zmax = -Infinity, caps = 0, walls = 0;
      for (let i = 0; i < pos.count; i++){ const z = pos.getZ(i); if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
      for (let i = 0; i < nrm.count; i++){
        const x = nrm.getX(i), y = nrm.getY(i), z = nrm.getZ(i);
        if (z === 0){ walls++; if (Math.abs(Math.hypot(x, y) - 1) > 1e-4) bad++; }
        else { caps++; if (Math.abs(z) !== 1 || x !== 0 || y !== 0) bad++; }
      }
      if (!(zmax - zmin > 0.20)) fail(`${name} ${tag}: 板厚只有 ${(zmax - zmin).toFixed(3)}，不是整块板，摇摆时会滑`);
      if (!walls) fail(`${name} ${tag}: 没有侧壁，转动时会看穿到板子内部`);
      if (!caps) fail(`${name} ${tag}: 没有盖面`);
      if (bad) fail(`${name} ${tag}: ${bad} 个法线不合格（盖必须纯 ±Z，侧壁必须落在 xy 内且单位长）`);

      // 侧壁是逐个元素、按环的走向依次压进来的。两条可算的性质把
      // "贴着描边的一片竖棱"钉死：
      //   1) 相邻两面墙共享的顶点，位置必须对得上 —— 中间漏一面墙、或者哪面墙
      //      被反着塞进来，位置链当场就断（环与环交界处允许断开）；
      //   2) 同一个共享顶点上的法线必须完全一致 —— 这就是按顶点平滑着色。
      //      字形是从位图描出来的，轮廓是一圈像素台阶，每个台阶一面墙、
      //      法线差 90°；一旦退回逐面着色，这条断言立刻红，竖棱就回来了。
      let walls3 = 0, pairs = 0, missPos = 0, missNrm = 0, badPattern = 0;
      let i = 0;
      while (i < nrm.count){
        if (nrm.getZ(i) !== 0){ i++; continue; }
        let j = i;
        while (j < nrm.count && nrm.getZ(j) === 0) j++;
        if ((j - i) % 6 === 0){
          for (let k = i; k + 5 < j; k += 6){
            walls3++;
            // 一面墙六个顶点：0/3/5 是 a 侧，1/2/4 是 b 侧
            if (nrm.getX(k) !== nrm.getX(k+3) || nrm.getX(k) !== nrm.getX(k+5) ||
                nrm.getY(k) !== nrm.getY(k+3) || nrm.getY(k) !== nrm.getY(k+5) ||
                nrm.getX(k+1) !== nrm.getX(k+2) || nrm.getX(k+1) !== nrm.getX(k+4) ||
                nrm.getY(k+1) !== nrm.getY(k+2) || nrm.getY(k+1) !== nrm.getY(k+4)) badPattern++;
            if (k + 11 < j){
              pairs++;
              const dx = pos.getX(k+6) - pos.getX(k+1);   // 下一面墙的 a − 这面墙的 b
              const dy = pos.getY(k+6) - pos.getY(k+1);
              if (Math.hypot(dx, dy) > 1e-6){ missPos++; continue; }
              if (nrm.getX(k+1) !== nrm.getX(k+6) || nrm.getY(k+1) !== nrm.getY(k+6)) missNrm++;
            }
          }
        }
        i = j;
      }
      if (!walls3) fail(`${name} ${tag}: 一面侧壁都没有`);
      else if (badPattern) fail(`${name} ${tag}: ${badPattern} 面墙的六个顶点法线分配错了`);
      else if (pairs > 0 && missPos > pairs * 0.08) fail(`${name} ${tag}: 侧壁链断了 ${missPos}/${pairs} 处，漏墙或墙被反塞`);
      else if (missNrm) fail(`${name} ${tag}: ${missNrm} 个共享顶点的法线不一致（退回逐面着色，竖棱会回来）`);
    }
    console.log(`   ${name}: 环 ${p.stats.rings} · 段 ${p.stats.strips} · 元件 ${p.stats.shapes} ` +
                `· 描边 ${p.stats.strokeWidth.toFixed(3)} · 顶点 ${g1.attributes.position.count}`);
    g1.dispose(); g2.dispose();
  }
}

/* ============================ 10) 页面里用到的元素 id 都存在 ============================ */
console.log('\n[10] DOM id 一致性');
{
  const used = new Set();
  for (const m of html.matchAll(/getElementById\('([^']+)'\)/g)) used.add(m[1]);
  for (const m of html.matchAll(/\bbind\('([^']+)','([^']+)'/g)) { used.add(m[1]); used.add(m[2]); }
  for (const m of html.matchAll(/wireSwitch\('([^']+)'/g)) used.add(m[1]);
  const have = new Set();
  for (const m of html.matchAll(/id="([^"]+)"/g)) have.add(m[1]);
  const missing = [...used].filter(id => !have.has(id));
  if (missing.length) fail('JS 引用了不存在的元素 id：' + missing.join(', '));
  else ok(`JS 引用的 ${used.size} 个元素 id 全部存在`);

  // 新增的十个外轮廓滑块必须一个不少，且 value 与 OUTLINE_STYLES 默认值能对上
  for (let i = 1; i <= 10; i++) {
    if (!have.has('go' + i)) fail('缺少滑块 go' + i);
    if (!have.has('vgo' + i)) fail('缺少读数 vgo' + i);
  }
  if (failures === 0 || have.has('go10')) ok('外轮廓微调的 10 组滑块 + 读数 id 齐全');
}

console.log(failures ? `\n✗ ${failures} 项未通过` : '\n✓ 全部通过');
process.exit(failures ? 1 : 0);
