/**
 * 轮廓跟踪：把一张字形位图（画布渲染出来的 alpha）转成矢量轮廓。
 *
 * 为什么需要它：字体文件方案只能覆盖仓库里有的字体，且中文字体动辄十几 MB。
 * 从画布描轮廓则意味着"系统里装了什么字体就能用什么字体"——中文、英文、
 * 用户自己装的涂鸦字体都行，零下载、零授权问题、离线可用。
 *
 * 输出格式与 THREE.Shape 直接对应：{ outer: [...], holes: [[...], ...] }
 *
 * 纯函数，不依赖 DOM 和 three，因此可以在 Node 里跑定量验证。
 */

/* ---------- 一维盒式模糊（可分离，两趟近似高斯） ---------- */
function boxBlurH(src, dst, w, h, r) {
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      dst[row + x] = sum * norm;
      sum += src[row + Math.min(w - 1, Math.max(0, x + r + 1))]
           - src[row + Math.min(w - 1, Math.max(0, x - r))];
    }
  }
}
function boxBlurV(src, dst, w, h, r) {
  const norm = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum * norm;
      sum += src[Math.min(h - 1, Math.max(0, y + r + 1)) * w + x]
           - src[Math.min(h - 1, Math.max(0, y - r)) * w + x];
    }
  }
}

/* ---------- Douglas-Peucker 折线简化 ---------- */
function perpDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function simplify(points, tol) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    let maxD = -1, maxI = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = perpDist(points[i], points[i0], points[i1]);
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > tol && maxI > 0) {
      keep[maxI] = 1;
      stack.push([i0, maxI], [maxI, i1]);
    }
  }
  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/* ---------- 带符号面积（图像坐标系，y 向下） ---------- */
function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/* ---------- 射线法：点是否在多边形内 ---------- */
function pointInPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if ((yi > py) !== (yj > py)) {
      const xint = xi + (py - yi) / (yj - yi) * (xj - xi);
      if (px < xint) inside = !inside;
    }
  }
  return inside;
}

/**
 * @param {Uint8Array|Uint8ClampedArray} alpha  行优先的灰度/alpha 场，0..255
 * @param {number} width
 * @param {number} height
 * @param {object} [options]
 *   level     阈值（0..1），默认 0.5
 *   blur      预模糊半径（像素），默认 0。
 *             实测结论：喂抗锯齿画布时 blur=0 反而更准。画布自身的抗锯齿已经
 *             给了亚像素信息，再模糊只会把中文字形的尖角磨圆 ——
 *             实测 blur=1 会让汉字 IoU 从 0.999 掉到 0.96 附近。
 *             只有当输入是 1-bit 硬边掩膜时才需要开模糊。
 *   simplify  Douglas-Peucker 容差（像素），默认 0.15。
 *             这是绝对像素值，渲染分辨率变了要同比缩放。
 *             实测：0.15 -> IoU 0.9987 / 平均 245 点；0.5 -> 0.9897 / 113 点。
 *             点数是挤出三角化的成本源头，但这点量远不是瓶颈。
 *   minArea   丢弃面积小于此值的轮廓（像素²），默认 12
 *   invert    true 表示亮=背景、暗=字形
 * @returns {{groups:Array<{outer:Array<{x:number,y:number}>,holes:Array<Array<{x:number,y:number}>>}>,
 *            bbox:{x:number,y:number,w:number,h:number,cx:number,cy:number}|null,
 *            stats:{loops:number,holes:number,points:number}}}
 *   坐标已居中（中心为原点）且 y 轴向上翻转，便于直接喂给 three。
 */
export function traceContours(alpha, width, height, options = {}) {
  const level = (options.level ?? 0.5) * 255;
  const blurR = Math.max(0, Math.round(options.blur ?? 0));
  const tol = options.simplify ?? 0.15;
  const minArea = options.minArea ?? 12;
  const invert = !!options.invert;

  const at = (x, y) => {
    const v = alpha[y * width + x];
    return invert ? 255 - v : v;
  };

  /* --- 1. 找出墨迹包围盒，只处理这一小块，省掉大部分无用计算 --- */
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (at(x, y) > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return { groups: [], bbox: null, stats: { loops: 0, holes: 0, points: 0 } };
  }

  const pad = blurR * 3 + 3;
  const x0 = Math.max(0, minX - pad), y0 = Math.max(0, minY - pad);
  const x1 = Math.min(width - 1, maxX + pad), y1 = Math.min(height - 1, maxY + pad);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;

  /* --- 2. 取子场 + 模糊（模糊让插值出的等值线是平滑的亚像素曲线） --- */
  let field = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const drow = y * w;
    for (let x = 0; x < w; x++) field[drow + x] = at(x0 + x, y0 + y);
  }
  if (blurR > 0) {
    const tmp = new Float32Array(w * h);
    for (let p = 0; p < 2; p++) {
      boxBlurH(field, tmp, w, h, blurR);
      boxBlurV(tmp, field, w, h, blurR);
    }
  }

  /* --- 3. Marching squares ---
     关键设计：交叉点用「边的编号」标识，而不是坐标。
     同一条边被相邻两个格子共享，编号相同 => 精确匹配，
     不会因为浮点误差导致轮廓断开。 */
  const H_ID = (x, y) => 2 * (y * w + x);          // 水平边：(x,y)-(x+1,y)
  const V_ID = (x, y) => 2 * (y * w + x) + 1;      // 垂直边：(x,y)-(x,y+1)

  const ptOf = new Map();   // edgeId -> {x,y}（图像坐标，已加回 x0/y0）
  // 像素中心在 (x+0.5, y+0.5) —— 和画布/栅格化的约定一致。
  // 少加这 0.5 会让整条轮廓系统性偏移半个像素，细笔画的 IoU 会掉好几个百分点。
  const hPoint = (x, y) => {
    const id = H_ID(x, y);
    let p = ptOf.get(id);
    if (!p) {
      const a = field[y * w + x], b = field[y * w + x + 1];
      const t = Math.abs(b - a) < 1e-9 ? 0.5 : Math.max(0, Math.min(1, (level - a) / (b - a)));
      p = { x: x0 + x + 0.5 + t, y: y0 + y + 0.5 };
      ptOf.set(id, p);
    }
    return id;
  };
  const vPoint = (x, y) => {
    const id = V_ID(x, y);
    let p = ptOf.get(id);
    if (!p) {
      const a = field[y * w + x], b = field[(y + 1) * w + x];
      const t = Math.abs(b - a) < 1e-9 ? 0.5 : Math.max(0, Math.min(1, (level - a) / (b - a)));
      p = { x: x0 + x + 0.5, y: y0 + y + 0.5 + t };
      ptOf.set(id, p);
    }
    return id;
  };

  const segs = [];          // [idA, idB]
  const addSeg = (a, b) => { if (a !== b) segs.push([a, b]); };

  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const v0 = field[y * w + x];             // 左上
      const v1 = field[y * w + x + 1];         // 右上
      const v2 = field[(y + 1) * w + x + 1];   // 右下
      const v3 = field[(y + 1) * w + x];       // 左下
      let code = 0;
      if (v0 >= level) code |= 1;
      if (v1 >= level) code |= 2;
      if (v2 >= level) code |= 4;
      if (v3 >= level) code |= 8;
      if (code === 0 || code === 15) continue;

      const E0 = () => hPoint(x, y);           // 上边
      const E1 = () => vPoint(x + 1, y);       // 右边
      const E2 = () => hPoint(x, y + 1);       // 下边
      const E3 = () => vPoint(x, y);           // 左边

      switch (code) {
        case 1:  addSeg(E3(), E0()); break;
        case 2:  addSeg(E0(), E1()); break;
        case 3:  addSeg(E3(), E1()); break;
        case 4:  addSeg(E1(), E2()); break;
        case 6:  addSeg(E0(), E2()); break;
        case 7:  addSeg(E3(), E2()); break;
        case 8:  addSeg(E2(), E3()); break;
        case 9:  addSeg(E2(), E0()); break;
        case 11: addSeg(E2(), E1()); break;
        case 12: addSeg(E1(), E3()); break;
        case 13: addSeg(E1(), E0()); break;
        case 14: addSeg(E0(), E3()); break;
        case 5: {  // 对角歧义：看中心点决定两块是被连通还是各自成岛
          const c = (v0 + v1 + v2 + v3) * 0.25;
          if (c >= level) { addSeg(E0(), E1()); addSeg(E3(), E2()); }
          else            { addSeg(E3(), E0()); addSeg(E1(), E2()); }
          break;
        }
        case 10: {
          const c = (v0 + v1 + v2 + v3) * 0.25;
          if (c >= level) { addSeg(E3(), E0()); addSeg(E1(), E2()); }
          else            { addSeg(E0(), E1()); addSeg(E3(), E2()); }
          break;
        }
      }
    }
  }

  /* --- 4. 串成闭合环（按边编号做无向图游走，不依赖方向一致性） --- */
  const adj = new Map();
  for (let i = 0; i < segs.length; i++) {
    const [a, b] = segs[i];
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(i);
    adj.get(b).push(i);
  }
  const used = new Uint8Array(segs.length);
  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    const loop = [];
    let cur = i;
    let node = segs[i][0];
    while (cur >= 0 && !used[cur]) {
      used[cur] = 1;
      const [a, b] = segs[cur];
      loop.push(ptOf.get(node));
      node = (node === a) ? b : a;
      const links = adj.get(node) || [];
      let next = -1;
      for (const li of links) { if (!used[li]) { next = li; break; } }
      cur = next;
    }
    if (loop.length >= 4) loops.push(loop);
  }

  /* --- 5. 简化 + 剔除碎片 --- */
  const cleaned = [];
  for (const lp of loops) {
    const s = simplify(lp, tol);
    if (s.length < 3) continue;
    if (Math.abs(signedArea(s)) < minArea) continue;
    cleaned.push(s);
  }

  /* --- 6. 用嵌套深度判定外轮廓 / 洞 --- */
  // 轮廓互不相交，所以取环上任意一个顶点去测另一个环内外，结果是确定的。
  const info = cleaned.map((pts, idx) => ({
    idx, pts,
    area: Math.abs(signedArea(pts)),
    depth: 0,
    parent: -1
  }));
  for (const a of info) {
    const probe = a.pts[0];
    for (const b of info) {
      if (a === b) continue;
      if (pointInPoly(probe.x, probe.y, b.pts)) a.depth++;
    }
  }
  for (const a of info) {
    if (a.depth === 0) continue;
    let best = -1, bestArea = Infinity;
    const probe = a.pts[0];
    for (const b of info) {
      if (a === b) continue;
      if (b.area < bestArea && pointInPoly(probe.x, probe.y, b.pts)) { best = b.idx; bestArea = b.area; }
    }
    a.parent = best;
  }

  /* --- 7. 组装成 THREE.Shape 友好的结构，并居中 + 翻转 y --- */
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const mapPts = (pts) => pts.map(p => ({ x: p.x - cx, y: -(p.y - cy) }));

  const byIdx = new Map(info.map(o => [o.idx, o]));
  const groups = [];
  let holeCount = 0, pointCount = 0;

  for (const o of info) {
    if (o.depth !== 0) continue;
    const holes = info
      .filter(h => h.depth === 1 && h.parent === o.idx)
      .map(h => { holeCount++; return mapPts(h.pts); });
    // 更深的嵌套（洞中之岛）单独作为新的外轮廓输出 —— 回字这类字需要
    groups.push({ outer: mapPts(o.pts), holes });
    pointCount += groups[groups.length - 1].outer.length + holes.reduce((s, h) => s + h.length, 0);
  }
  // 洞中之岛：深度为偶数且不为 0 的环，自己再成一组（它内部还可能有洞）
  for (const o of info) {
    if (o.depth === 0 || o.depth % 2 !== 0) continue;
    const holes = info
      .filter(h => h.depth === o.depth + 1 && h.parent === o.idx)
      .map(h => { holeCount++; return mapPts(h.pts); });
    groups.push({ outer: mapPts(o.pts), holes });
    pointCount += groups[groups.length - 1].outer.length + holes.reduce((s, h) => s + h.length, 0);
  }

  return {
    groups,
    bbox: { x: x0, y: y0, w, h, cx, cy, inkW: maxX - minX + 1, inkH: maxY - minY + 1 },
    stats: { loops: info.length, holes: holeCount, points: pointCount }
  };
}
