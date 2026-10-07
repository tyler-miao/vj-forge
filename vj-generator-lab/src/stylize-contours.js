/**
 * 字形几何变形：把描出来的轮廓加工成"定制的"字形。
 *
 * 为什么需要它：换系统字体永远只能换来换去都是那个味儿。真正让字形独特的是
 * 在轮廓上做几何变形 —— 加粗把细笔画救回来，尖角延伸把任何字体都变成带攻击性的
 * 定制字形，斜切和拱形改变整体气质。
 *
 * 纯函数，不依赖 DOM 和 three，可在 Node 里定量验证。
 */
import { mulberry32 } from './edge-adornments.js';

/** 环的带符号面积（y 轴向上，>0 为逆时针） */
export function ringArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** 环的周长 */
export function ringPerimeter(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    s += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return s;
}

/**
 * 材质总面积 = 外轮廓面积和 − 洞面积和。
 * 加粗／尖角是否真的生效，就看这个数变没变大。
 */
export function materialArea(groups) {
  let a = 0;
  for (const g of groups) {
    a += Math.abs(ringArea(g.outer));
    for (const h of g.holes) a -= Math.abs(ringArea(h));
  }
  return a;
}

export function totalPerimeter(groups) {
  let s = 0;
  for (const g of groups) {
    s += ringPerimeter(g.outer);
    for (const h of g.holes) s += ringPerimeter(h);
  }
  return s;
}

/**
 * 加工一个闭合环。
 *
 * 关键前提：**先把绕向归一化**——外轮廓逆时针、洞顺时针。
 * 只有在这个前提下，(dy, −dx) 才恒为「背离材质」的方向：
 * 外轮廓朝外、洞朝洞内。沿它推就是让材质变厚。
 *
 * @param {Array<{x:number,y:number}>} pts 闭合环
 * @param {{dilate:number,spike:number,shear:number,arch:number}} o
 * @param {boolean} isHole 这个环是不是洞
 */
export function stylizeRing(pts, o, isHole, ringIndex = 0) {
  const n = pts.length;
  if (n < 3) return pts.map(p => ({ x: p.x, y: p.y }));

  const area = ringArea(pts);
  const ring = ((area > 0) === isHole) ? pts.slice().reverse() : pts;
  const m = ring.length;
  const out = new Array(m);

  for (let i = 0; i < m; i++) {
    const p0 = ring[(i - 1 + m) % m], p1 = ring[i], p2 = ring[(i + 1) % m];
    let e1x = p1.x - p0.x, e1y = p1.y - p0.y;
    let e2x = p2.x - p1.x, e2y = p2.y - p1.y;
    const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
    e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2;

    const n1x = e1y, n1y = -e1x;
    const n2x = e2y, n2y = -e2x;
    let bx = n1x + n2x, by = n1y + n2y;
    let bl = Math.hypot(bx, by);
    if (bl < 1e-6) { bx = n2x; by = n2y; bl = 1; }
    bx /= bl; by /= bl;

    // 斜接长度：1/cos(半角)。尖角处会趋向无穷，必须钳制，否则尖角会炸出去。
    const cosHalf = bx * n2x + by * n2y;
    const miter = Math.min(2.6, 1 / Math.max(cosHalf, 0.30));

    // 只有朝外的凸角才长尖刺。cross > 0 即凸角（与绕向归一化配套）：
    // 外轮廓的凸角、洞的凹角都会得到 0，正是想要的。
    let sharp = 0;
    if (e1x * e2y - e1y * e2x > 0) {
      const cosA = -(e1x * e2x + e1y * e2y);
      const ang = Math.acos(Math.max(-1, Math.min(1, cosA))); // 内角 0..π
      sharp = Math.max(0, Math.min(1, (Math.PI - ang) / Math.PI)); // 直线=0，直角≈0.5，锐角→1
    }

    const amt = o.dilate * miter + o.spike * sharp * 0.11;
    out[i] = { x: p1.x + bx * amt, y: p1.y + by * amt };
  }

  // 圆角 / 毛边 / 斜切 / 透视 / 拱形：都在法线加工之后做。
  // 注意顺序 —— 圆角放在尖角延伸之后，所以两个都开大时尖刺会被磨圆，
  // 这是可预期的交互，不是 bug。
  let ring2 = out;
  if (o.round > 0) ring2 = roundCorners(ring2, o.round);
  if (o.rough > 0) ring2 = roughen(ring2, o.rough, (o.seed ?? 1337) + ringIndex * 7919);
  if (o.shear) for (const p of ring2) p.x += o.shear * p.y;   // 斜切：行列式=1，面积守恒
  if (o.persp) ring2 = perspective(ring2, o.persp);

  if (o.arch) {
    let mn = Infinity, mx = -Infinity;
    for (const p of ring2) { if (p.x < mn) mn = p.x; if (p.x > mx) mx = p.x; }
    const cx = (mn + mx) / 2, hw = Math.max((mx - mn) / 2, 1e-6);
    for (const p of ring2) { const t = (p.x - cx) / hw; p.y += o.arch * (1 - t * t); }
  }
  return ring2;
}

/** 经典 Douglas-Peucker，作用在开折线上 */
function dp(points, tol) {
  const n = points.length;
  if (n < 3) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1; keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const a = points[i0], b = points[i1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1e-9;
    let maxD = -1, maxI = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const p = points[i];
      const d = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > tol && maxI > 0) { keep[maxI] = 1; stack.push([i0, maxI], [maxI, i1]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/**
 * 合并近共线的点，还原出真正的角。
 *
 * 不能用"局部一刀切"（逐点拿相邻两点的弦去量）：中文字形的角上往往有一段倒棱，
 * 倒棱上的点互相之间的偏离都很小，一刀切会把整圈都判为可删，结果要么崩掉要么
 * 退回原样。必须用全局的 Douglas-Peucker，按重要性保留点。
 *
 * 闭合环的 DP：先取离质心最远的点当锚点（凸形状上它一定落在角上），
 * 再取离它最远的点当第二个锚点，把环拆成两段开折线分别简化。
 */
export function simplifyRing(ring, tol) {
  const n = ring.length;
  if (n < 5 || !(tol > 0)) return ring;

  let cx = 0, cy = 0;
  for (const p of ring) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;

  let i0 = 0, best = -1;
  for (let i = 0; i < n; i++) {
    const d = (ring[i].x - cx) ** 2 + (ring[i].y - cy) ** 2;
    if (d > best) { best = d; i0 = i; }
  }
  let i1 = 0; best = -1;
  for (let i = 0; i < n; i++) {
    const d = (ring[i].x - ring[i0].x) ** 2 + (ring[i].y - ring[i0].y) ** 2;
    if (d > best) { best = d; i1 = i; }
  }
  if (i1 === i0) return ring;

  const seg1 = [], seg2 = [];
  for (let i = i0; ; i = (i + 1) % n) { seg1.push(ring[i]); if (i === i1) break; }
  for (let i = i1; ; i = (i + 1) % n) { seg2.push(ring[i]); if (i === i0) break; }

  const out = dp(seg1, tol).slice(0, -1).concat(dp(seg2, tol).slice(0, -1));
  return out.length >= 3 ? out : ring;
}

/**
 * 圆角：先把近共线的点并掉还原出真角，再用**圆弧**替换每个角。
 *
 * 注意不能用二次贝塞尔：以角点为控制点的贝塞尔弧长是 2.30r，比走直角（2r）还长，
 * 等于没切角。真圆弧的弧长是 1.57r，才真正把尖角削掉。
 * 圆心落在角的内侧、到两条边距离都是 r。
 */
export function roundCorners(ring, radius, segs = 5) {
  const n = ring.length;
  if (!(radius > 0) || n < 3) return ring;
  // 合并容差跟半径挂钩：圆角越大，越应该先把碎点并成真角
  const simplified = simplifyRing(ring, Math.min(radius * 0.35, 0.006));
  const m = simplified.length;
  if (m < 3) return ring;
  const out = [];
  for (let i = 0; i < m; i++) {
    const p0 = simplified[(i - 1 + m) % m], p1 = simplified[i], p2 = simplified[(i + 1) % m];
    let a1x = p0.x - p1.x, a1y = p0.y - p1.y;      // 角点 → 前一个点
    let a2x = p2.x - p1.x, a2y = p2.y - p1.y;      // 角点 → 后一个点
    const l1 = Math.hypot(a1x, a1y), l2 = Math.hypot(a2x, a2y);
    if (l1 < 1e-9 || l2 < 1e-9) { out.push({ x: p1.x, y: p1.y }); continue; }
    a1x /= l1; a1y /= l1; a2x /= l2; a2y /= l2;

    // 与 stylizeRing 同一套法线：e1 = p0→p1 = −a1，e2 = p1→p2 = a2
    const n1x = -a1y, n1y = a1x;
    const n2x = a2y, n2y = -a2x;
    let bx = n1x + n2x, by = n1y + n2y;
    const bl = Math.hypot(bx, by);
    if (bl < 1e-6) { out.push({ x: p1.x, y: p1.y }); continue; }
    bx /= bl; by /= bl;
    const cosHalf = bx * n2x + by * n2y;
    const miter = Math.min(2.6, 1 / Math.max(cosHalf, 0.30));

    // 转弯越小越不需要圆角，半径按转弯量缩一缩，避免把长直边磨出波浪
    const turn = Math.acos(Math.max(-1, Math.min(1, a1x * a2x + a1y * a2y)));
    const r = Math.min(radius, l1 * 0.5, l2 * 0.5) * Math.min(1, turn / (Math.PI / 6) + 0.15);
    if (!(r > 1e-9)) { out.push({ x: p1.x, y: p1.y }); continue; }

    const q1x = p1.x + a1x * r, q1y = p1.y + a1y * r;
    const q2x = p1.x + a2x * r, q2y = p1.y + a2y * r;

    // 凸角圆心在材质内侧（−b），凹角反过来；这样两种情况都是"削角"而不是"鼓出来"
    const convex = ((p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x)) > 0;
    const sgn = convex ? -1 : 1;
    const cx = p1.x + bx * r * miter * sgn;
    const cy = p1.y + by * r * miter * sgn;

    let ang1 = Math.atan2(q1y - cy, q1x - cx);
    let ang2 = Math.atan2(q2y - cy, q2x - cx);
    let da = ang2 - ang1;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    for (let s = 0; s < segs; s++) {          // 少取一个点，避免和下个顶点的起点重合
      const a = ang1 + da * (s / segs);
      out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
  }
  return dedupe(out);
}

/** 去掉挨得太近的重复点 —— 重复点会让 earcut 三角化出错 */
export function dedupe(ring, eps = 1e-6) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = out[out.length - 1];
    if (q && Math.hypot(p.x - q.x, p.y - q.y) < eps) continue;
    out.push(p);
  }
  while (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) < eps) out.pop(); else break;
  }
  return out;
}

/**
 * 毛边：沿法线按噪声推每个顶点，做出手凿／风蚀的质感。
 * 用固定种子，所以同样的参数永远得到同样的毛边（录视频必须可复现）。
 */
export function roughen(ring, amount, seed) {
  const n = ring.length;
  if (!(amount > 0) || n < 3) return ring;
  const rng = mulberry32(seed);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const p0 = ring[(i - 1 + n) % n], p1 = ring[i], p2 = ring[(i + 1) % n];
    let e1x = p1.x - p0.x, e1y = p1.y - p0.y;
    let e2x = p2.x - p1.x, e2y = p2.y - p1.y;
    const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
    e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2;
    let bx = e1y + e2y, by = -e1x - e2x;
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl; by /= bl;
    const d = (rng() * 2 - 1) * amount;
    out[i] = { x: p1.x + bx * d, y: p1.y + by * d };
  }
  return out;
}

/**
 * 透视：上宽下窄／上窄下宽的梯形变形，做出参考图那种"字在往里倒"的透视感。
 */
export function perspective(ring, k) {
  if (!k) return ring;
  return ring.map(p => ({ x: p.x * (1 + k * p.y), y: p.y }));
}

/** 批量加工：{outer, holes[]} 的数组进，同结构出 */
export function stylizeGroups(groups, o) {
  let ringIndex = 0;
  return groups.map(g => ({
    outer: stylizeRing(g.outer, o, false, ringIndex++),
    holes: g.holes.map(h => stylizeRing(h, o, true, ringIndex++))
  }));
}

/** 任一坐标非有限值即为坏结果 */
export function hasNaN(groups) {
  for (const g of groups) {
    for (const ring of [g.outer, ...g.holes]) {
      for (const p of ring) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return true;
      }
    }
  }
  return false;
}
