/**
 * 字形几何变形：把描出来的轮廓加工成"定制的"字形。
 *
 * 为什么需要它：换系统字体永远只能换来换去都是那个味儿。真正让字形独特的是
 * 在轮廓上做几何变形 —— 加粗把细笔画救回来，尖角延伸把任何字体都变成带攻击性的
 * 定制字形，斜切和拱形改变整体气质。
 *
 * 纯函数，不依赖 DOM 和 three，可在 Node 里定量验证。
 */

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
export function stylizeRing(pts, o, isHole) {
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

  if (o.shear) for (const p of out) p.x += o.shear * p.y;   // 斜切：行列式=1，面积守恒

  if (o.arch) {
    let mn = Infinity, mx = -Infinity;
    for (const p of out) { if (p.x < mn) mn = p.x; if (p.x > mx) mx = p.x; }
    const cx = (mn + mx) / 2, hw = Math.max((mx - mn) / 2, 1e-6);
    for (const p of out) { const t = (p.x - cx) / hw; p.y += o.arch * (1 - t * t); }
  }
  return out;
}

/** 批量加工：{outer, holes[]} 的数组进，同结构出 */
export function stylizeGroups(groups, o) {
  return groups.map(g => ({
    outer: stylizeRing(g.outer, o, false),
    holes: g.holes.map(h => stylizeRing(h, o, true))
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
