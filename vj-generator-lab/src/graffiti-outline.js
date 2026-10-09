/**
 * 街头外轮廓（Hip-Hop / Graffiti outline）。
 *
 * 这个模块不做"往字旁边摆装饰物"这件事。它只回答一个问题：
 * **把字体自己的外部轮廓重新画一遍，画成 90s 涂鸦 / 街头品牌 logo 的样子。**
 *
 * 产出全部是贴在轮廓上的二维图形，没有任何独立漂浮的立体件：
 *
 *   stroke   不规则粗描边 —— 沿外轮廓的"笔画段"，宽度低频抖动、两端收笔、段间留缺口
 *   shadow   Offset / Shadow 外轮廓 —— 同一套形状整体外扩 + 右下偏移，压在更后面一层
 *   drip     滴漆 —— 只从下侧轮廓垂下，连续收细
 *   arrow    箭头 —— 扁平燕尾箭头，底边贴在轮廓上
 *   splat    喷漆飞溅 —— 不规则小斑点，紧贴轮廓外侧
 *   tag      涂鸦线 —— 一条贴着字底的甩尾 + 若干从轮廓挑出去的飞白
 *   spike    夸张尖角 —— 只在少数凸角沿角平分线捅出去的长三角
 *   hatch    手绘划线 —— 压在轮廓上的短斜线
 *
 * 三条硬约束写在代码里，而不是写在注释里：
 *   1. **有预算**：每种元素的个数由调用方给，模块内部还有全局限额与最小间距，
 *      任何情况下都不会变成"绕一圈的装饰"。
 *   2. **有留白**：粗描边按覆盖率切段，段与段之间必须留缺口；缺口位置由种子决定。
 *   3. **可复现**：所有随机只来自传入的 mulberry32，同参数同种子逐位一致，
 *      否则录两遍视频得到两条不一样的循环。
 *
 * 纯函数，不依赖 DOM 和 three，可在 Node 里定量验证。
 */
import { mulberry32 } from './edge-adornments.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

/** 单个元素的全局限额 —— 再怎么调参数也不会越界 */
export const BUDGET = {
  drips: 5, arrows: 3, splats: 8, tags: 4, spikes: 4, hatches: 3
};

/** 任意元素之间的最小间距（字高 = 1 的单位）。这是"留白"的下限保障。 */
export const MIN_GAP = {
  drips: 0.40, arrows: 0.55, splats: 0.16, tags: 0.30, spikes: 0.45, hatches: 0.28
};

/** 环的带符号面积（y 轴向上，>0 = 逆时针） */
export function signedArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** 外轮廓统一成逆时针 —— 只有这样 (dy, −dx) 才恒为背离材质的外法线 */
function orient(ring) {
  return signedArea(ring) < 0 ? ring.slice().reverse() : ring;
}

/**
 * 沿环取点：位置 + **平滑过渡的外法线**。
 *
 * 法线必须在相邻两条边之间按 smoothstep 混合。直接用当前边的法线，
 * 在直角处会从 (0,−1) 突跳到 (−1,0)，描边在角点被甩出去一道毛刺 ——
 * 和缠绕模块踩过的是同一个坑。
 */
function makeSampler(ring) {
  const n = ring.length;
  const cum = new Float64Array(n + 1);
  const ex = new Float64Array(n), ey = new Float64Array(n);
  const nx = new Float64Array(n), ny = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;
    const L = Math.hypot(dx, dy) || 1e-9;
    ex[i] = dx / L; ey[i] = dy / L;
    nx[i] = ey[i]; ny[i] = -ex[i];          // 逆时针环的外法线
    cum[i + 1] = cum[i] + L;
  }
  const total = cum[n];
  return {
    total, n, ring,
    at(s) {
      s = ((s % total) + total) % total;
      let i = 0;
      while (i < n - 1 && cum[i + 1] < s) i++;
      const seg = Math.max(cum[i + 1] - cum[i], 1e-9);
      const t = clamp((s - cum[i]) / seg, 0, 1);
      const a = ring[i], b = ring[(i + 1) % n];
      const j = (i + 1) % n;
      const w = t * t * (3 - 2 * t);
      let mx = nx[i] * (1 - w) + nx[j] * w;
      let my = ny[i] * (1 - w) + ny[j] * w;
      const ml = Math.hypot(mx, my);
      if (ml > 1e-6) { mx /= ml; my /= ml; } else { mx = nx[i]; my = ny[i]; }
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        nx: mx, ny: my,
        tx: -my, ty: mx                      // 切线（外法线逆时针转 90°）
      };
    }
  };
}

/**
 * 把一条中心线扫成带状：两侧各按 leftFn / rightFn 沿**法向**外扩。
 *
 * 刻意不走"多边形 + earcut"那条路。粗描边沿着字形走一圈，
 * 在窄缝处两侧必然互相穿过去 —— 那是 Minkowski 意义下**正确**的行为
 * （窄缝就该被描边填满），只是它会让多边形自交、三角化出鬼影。
 * 条带是逐段两个三角形，永远合法，重叠部分同色同法线，看不出接缝。
 *
 * @param {Array<{x,y}>} pts 中心线
 * @param {(i:number,p:object)=>number} leftFn  左侧外扩量
 * @param {(i:number,p:object)=>number} rightFn 右侧外扩量
 * @returns {number[]} 交错的 [l0x,l0y,r0x,r0y, l1x,l1y,r1x,r1y, ...]
 */
function ribbon(pts, leftFn, rightFn, closed = false) {
  const m = pts.length;
  if (m < 2) return [];
  const out = [];
  for (let i = 0; i < m; i++) {
    const p = pts[i];
    const a = closed ? pts[(i - 1 + m) % m] : pts[Math.max(0, i - 1)];
    const b = closed ? pts[(i + 1) % m] : pts[Math.min(m - 1, i + 1)];
    let tx = b.x - a.x, ty = b.y - a.y;
    const tl = Math.hypot(tx, ty);
    if (tl > 1e-9) { tx /= tl; ty /= tl; } else { tx = 1; ty = 0; }
    const px = ty, py = -tx;                // 法向
    const l = leftFn(i, p), r = rightFn(i, p);
    out.push(p.x + px * l, p.y + py * l, p.x - px * r, p.y - py * r);
  }
  return out;
}

/** 贪心挑选：同批候选之间必须拉开指定距离，且完全由种子决定 */
function pick(cands, count, minDist, rng) {
  if (!cands.length || count <= 0) return [];
  const idx = cands.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const chosen = [];
  for (const i of idx) {
    if (chosen.length >= count) break;
    const c = cands[i];
    let ok = true;
    for (const p of chosen) {
      if (Math.hypot(p.x - c.x, p.y - c.y) < minDist) { ok = false; break; }
    }
    if (ok) chosen.push(c);
  }
  return chosen;
}

/* ============================ 粗描边 ============================ */

/**
 * 不规则粗描边：沿外轮廓切出若干笔画段，段内宽度连续抖动，段间留缺口。
 *
 * @param {Array<{x,y}>} ring  逆时针外轮廓
 * @param {{width,coverage,gaps,jitter,seed}} o
 * @returns {{strips:number[][], width:number}} 笔画段的条带 + 实际最宽处
 */
export function strokeSegments(ring, o = {}) {
  const S = makeSampler(orient(ring));
  const L = S.total;
  if (!(L > 1e-4)) return { strips: [], width: 0 };

  const base = Math.max(0.002, o.width ?? 0.06);
  const coverage = clamp(o.coverage ?? 0.8, 0.15, 1);
  const gapCount = Math.max(0, Math.round(o.gaps ?? 3));
  const jitter = clamp(o.jitter ?? 0.5, 0, 1);
  const overlap = o.overlap ?? 0.03;
  const rng = mulberry32((o.seed ?? 1337) >>> 0);

  // 周期噪声：整数频率的正弦叠加，保证沿环走一圈首尾无缝
  const F = [3, 7, 13], PH = [rng() * TAU, rng() * TAU, rng() * TAU];
  const WF = [0.52, 0.31, 0.17];
  const jitPH = rng() * TAU;

  // 局部外扩（手绘"重按"的那几下）
  const boostN = clamp(Math.round(coverage < 0.9 ? 2 : 1) + Math.floor(rng() * 2), 1, 3);
  const boosts = [];
  for (let k = 0; k < boostN; k++) {
    boosts.push({ c: rng() * L, hw: L * (0.045 + rng() * 0.035), m: 1.30 + rng() * 0.40 });
  }

  // 宽度整体夹在 [0.72, 1.45] × 名义粗细。
  // 不夹的话，低频起伏 × 局部外扩 × 手绘抖动三个因子叠起来能冲到 2.6 倍 ——
  // 名义 0.06 变成 0.29，占掉字高的三成，字直接糊成一坨。
  // 夹太松又会把描边切成一粒粒的碎块，边缘看着"毛"。
  // 0.72~1.45 是"手按下去的宽窄变化"，够不齐，但拼起来还是一条整线。
  const W_LO = 0.72, W_HI = 1.45;
  const widthAt = (s) => {
    const u = s / L;
    let x = 0;
    for (let k = 0; k < 3; k++) x += WF[k] * Math.sin(F[k] * TAU * u + PH[k]);
    let f = 1 + 0.34 * x;
    for (const b of boosts) {
      let d = Math.abs(((s - b.c) % L + L * 1.5) % L - L * 0.5);   // 环上距离
      if (d < b.hw) f *= 1 + (b.m - 1) * Math.pow(Math.sin((1 - d / b.hw) * Math.PI * 0.5), 1.4);
    }
    f *= 1 + jitter * 0.22 * Math.sin(29 * TAU * u + jitPH);
    return base * clamp(f, W_LO, W_HI);
  };

  /* ---- 缺口（留白）：用二值掩膜切，避免环回边界的各种边角情况 ---- */
  const NB = Math.max(240, Math.min(2400, Math.round(L / 0.008)));
  const cov = new Uint8Array(NB).fill(1);
  const totalGap = (1 - coverage) * L;
  if (gapCount > 0 && totalGap > 1e-6) {
    const wts = [];
    let sum = 0;
    for (let k = 0; k < gapCount; k++) { const w = 0.6 + rng() * 0.9; wts.push(w); sum += w; }
    for (let k = 0; k < gapCount; k++) {
      const glen = (totalGap * wts[k]) / sum;
      const center = ((k + 0.5) / gapCount + ((rng() - 0.5) * 0.55) / gapCount) * L;
      const nbin = Math.max(2, Math.round((glen / L) * NB));
      const i0 = Math.round(((center - glen / 2) / L) * NB);      // 弧长 → bin，注意先减完再除 L
      for (let j = 0; j < nbin; j++) cov[(((i0 + j) % NB) + NB) % NB] = 0;
    }
  }

  // 线性扫一遍；首尾两段若首尾相接，说明缺口压在了 i=0 上，要把它们并成一段环回区间
  const runs = [];
  let start = -1;
  for (let i = 0; i < NB; i++) {
    if (cov[i] && start < 0) start = i;
    else if (!cov[i] && start >= 0) { runs.push([start, i]); start = -1; }
  }
  if (start >= 0) {
    if (runs.length && runs[0][0] === 0) runs[0] = [start, NB + runs[0][1]];
    else runs.push([start, NB]);
  }
  if (!runs.length && start < 0 && cov[0] !== 0) runs.push([0, NB]);

  /* ---- 逐段采样成条带 ---- */
  const strips = [];
  let peak = 0;
  const step = 0.012;
  for (const [i0, i1] of runs) {
    const s0 = (i0 / NB) * L, s1 = (i1 / NB) * L;
    if (s1 - s0 < 0.025) continue;
    const cnt = Math.max(3, Math.ceil((s1 - s0) / step));
    // 收头要短：拖太长的话缺口两端是一根针，几百根针连起来就是一圈毛边
    const taperLen = Math.min(L * 0.010, (s1 - s0) * 0.18);
    const pts = [];
    const W = [], O = [];
    for (let k = 0; k <= cnt; k++) {
      const s = s0 + ((s1 - s0) * k) / cnt;
      const tp = Math.min(smooth((s - s0) / taperLen), smooth((s1 - s) / taperLen));
      const p = S.at(s);
      // 手绘抖动：沿切线轻微游走，笔画就不像机器描的
      const wob = jitter * 0.006 * Math.sin((17 * TAU * s) / L + PH[2]);
      pts.push({ x: p.x + p.tx * wob, y: p.y + p.ty * wob });
      const w = widthAt(s) * tp;
      if (w > peak) peak = w;
      W.push(w);
      O.push(overlap * tp);
    }
    const pairs = ribbon(
      pts,
      (i) => W[i] + O[i],     // 外侧
      (i) => O[i]             // 内侧（压到字底下，读起来才是"描"而不是"贴"）
    );
    if (pairs.length) strips.push(pairs);
  }
  return { strips, width: peak };
}

/* ============================ 滴漆 ============================ */

/** 从下侧轮廓垂下来的漆滴：连续收细、末端收成尖，不挂任何独立珠子 */
function dripStrip(root, o, rng) {
  const len = o.len * (0.65 + rng() * 0.75);
  const sway = (rng() - 0.5) * 0.45 * len;
  const w0 = o.width * (0.7 + 0.6 * rng());
  const M = 16;
  const pts = [];
  for (let k = 0; k <= M; k++) {
    const t = k / M;
    pts.push({
      x: root.x + Math.sin(t * Math.PI * 1.25) * sway,
      y: root.y + 0.04 - t * len,       // 起点抬高一截，藏进字底，读起来是"从字上流下来的"
      t
    });
  }
  const half = (i, p) => {
    const t = p.t;
    const bulge = 1 + 0.45 * Math.exp(-Math.pow((t - 0.14) / 0.16, 2));
    return w0 * Math.pow(Math.max(0, 1 - t), 0.55) * bulge;
  };
  return ribbon(pts, half, half);
}

function dripsOf(rings, o, rng) {
  const cands = [];
  for (const S of rings) {
    for (let s = 0; s < S.total; s += 0.03) {
      const p = S.at(s);
      if (p.ny < -0.5) cands.push(p);         // 只从下侧流
    }
  }
  return pick(cands, Math.min(BUDGET.drips, o.count | 0), MIN_GAP.drips, rng)
    .map((r) => dripStrip(r, o, rng));
}

/* ============================ 箭头 ============================ */

function arrowShape(p, len, rng) {
  const flip = rng() < 0.5 ? -1 : 1;
  // 贴着轮廓向外、同时顺着走向甩出去一点 —— 比正朝外更像涂鸦里那种速度箭头
  let dx = p.nx * 0.62 + p.tx * 0.78 * flip;
  let dy = p.ny * 0.62 + p.ty * 0.78 * flip;
  const dl = Math.hypot(dx, dy) || 1;
  dx /= dl; dy /= dl;
  const hw = len * 0.34;
  const local = [
    [0, -hw * 0.30], [0.50, -hw * 0.30], [0.50, -hw], [1, 0],
    [0.50, hw], [0.50, hw * 0.30], [0, hw * 0.30]
  ];
  const cos = dx, sin = dy;
  return local.map(([u, v]) => ({
    x: p.x + (u * len * cos - v * sin),
    y: p.y + (u * len * sin + v * cos)
  }));
}

function arrowsOf(rings, o, rng) {
  const cands = [];
  for (const S of rings) for (let s = 0; s < S.total; s += 0.05) cands.push(S.at(s));
  return pick(cands, Math.min(BUDGET.arrows, o.count | 0), MIN_GAP.arrows, rng)
    .map((p) => arrowShape(p, o.len * (0.75 + rng() * 0.6), rng));
}

/* ============================ 喷漆飞溅 ============================ */

function splatShape(p, r, rng) {
  const n = 9 + Math.floor(rng() * 4);
  const F = [2, 3, 5];
  const PH = [rng() * TAU, rng() * TAU, rng() * TAU];
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    let k = 1 + 0.42 * Math.sin(F[0] * a + PH[0]) + 0.26 * Math.sin(F[1] * a + PH[1])
              + 0.16 * Math.sin(F[2] * a + PH[2]);
    k = clamp(k, 0.35, 1.7);
    pts.push({ x: p.x + Math.cos(a) * r * k, y: p.y + Math.sin(a) * r * k });
  }
  return pts;
}

function splatsOf(rings, o, rng) {
  const cands = [];
  for (const S of rings) {
    for (let s = 0; s < S.total; s += 0.03) {
      const p = S.at(s);
      const d = 0.03 + rng() * 0.055;
      cands.push({ x: p.x + p.nx * d, y: p.y + p.ny * d });
    }
  }
  const n = Math.min(BUDGET.splats, o.count | 0);
  const out = [];
  for (const c of pick(cands, n, MIN_GAP.splats, rng)) {
    const r = o.size * (0.7 + rng() * 0.8);
    out.push(splatShape(c, r, rng));
    if (rng() < 0.40) {                       // 一颗主点甩出去的卫星小点
      const a = rng() * TAU, d = r * (1.7 + rng() * 1.1);
      const sat = { x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d };
      out.push(splatShape(sat, r * (0.24 + rng() * 0.22), rng));
    }
  }
  return out;
}

/* ============================ 涂鸦线 ============================ */

/** 贴着字底的一条甩尾：两端收笔，中段压在字身上（所以一定是"附着"的） */
function swashStrip(bbox, o, rng) {
  const W = bbox.maxx - bbox.minx;
  if (!(W > 0.05)) return null;
  const x0 = bbox.minx - 0.03 * W;
  const x1 = bbox.maxx + 0.05 * W;
  const y0 = bbox.miny + 0.03;
  const rise = o.width * (0.8 + rng() * 1.4);
  const M = 40;
  const pts = [];
  for (let k = 0; k <= M; k++) {
    const t = k / M;
    pts.push({ x: x0 + (x1 - x0) * t, y: y0 - Math.sin(t * Math.PI) * rise - t * rise * 0.5, t });
  }
  const hw = (i, p) => o.width * Math.pow(Math.sin(Math.PI * p.t), 0.45) * (0.75 + 0.5 * p.t);
  return ribbon(pts, hw, hw);
}

/** 从轮廓上挑出去的一笔飞白 */
function flickStrip(p, o, rng) {
  const flip = rng() < 0.5 ? -1 : 1;
  const len = o.len * (0.7 + rng() * 0.7);
  let dx = p.nx * 0.72 + p.tx * 0.69 * flip;
  let dy = p.ny * 0.72 + p.ty * 0.69 * flip;
  const dl = Math.hypot(dx, dy) || 1;
  dx /= dl; dy /= dl;
  const curve = (rng() - 0.5) * 1.5;
  const M = 12;
  const pts = [];
  for (let k = 0; k <= M; k++) {
    const t = k / M;
    const bend = curve * t * t * len * 0.5;
    pts.push({
      x: p.x + dx * len * t - dy * bend + p.tx * 0.02,
      y: p.y + dy * len * t + dx * bend + p.ty * 0.02,
      t
    });
  }
  const hw = (i, pt) => o.width * Math.pow(Math.max(0, 1 - pt.t), 0.75) * (1 + 0.3 * Math.sin(pt.t * Math.PI));
  return ribbon(pts, hw, hw);
}

function tagsOf(rings, bbox, o, rng) {
  const n = Math.min(BUDGET.tags, o.count | 0);
  if (n <= 0) return [];
  const out = [];
  if (o.swash !== false) {
    const s = swashStrip(bbox, o, rng);
    if (s) out.push(s);
  }
  const need = n - out.length;
  if (need > 0) {
    const cands = [];
    for (const S of rings) for (let s = 0; s < S.total; s += 0.04) cands.push(S.at(s));
    for (const p of pick(cands, need, MIN_GAP.tags, rng)) out.push(flickStrip(p, o, rng));
  }
  return out;
}

/* ============================ 夸张尖角 ============================ */

/** 只在凸角上捅出去的长三角，长度各不相同 —— 是字形轮廓的延伸，不是摆在旁边的尖刺 */
function spikeShapes(rings, o, rng) {
  const corners = [];
  for (const S of rings) {
    const ring = S.ring, n = ring.length;
    for (let i = 0; i < n; i++) {
      const p0 = ring[(i - 1 + n) % n], p1 = ring[i], p2 = ring[(i + 1) % n];
      const e1x = p1.x - p0.x, e1y = p1.y - p0.y;
      const e2x = p2.x - p1.x, e2y = p2.y - p1.y;
      const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
      const cross = (e1x / l1) * (e2y / l2) - (e1y / l1) * (e2x / l2);
      const dot = (e1x / l1) * (e2x / l2) + (e1y / l1) * (e2y / l2);
      const turn = Math.atan2(cross, dot);
      if (!(turn > Math.PI / 4)) continue;      // 只要转过 45° 的凸角
      // 外向角平分线 = 两条邻边外法线之和
      const n1 = { x: e1y / l1, y: -e1x / l1 };
      const n2 = { x: e2y / l2, y: -e2x / l2 };
      let bx = n1.x + n2.x, by = n1.y + n2.y;
      const bl = Math.hypot(bx, by);
      if (bl < 1e-6) { bx = n1.x; by = n1.y; } else { bx /= bl; by /= bl; }
      corners.push({ x: p1.x, y: p1.y, bx, by, ex: e2x / l2, ey: e2y / l2, ax: -e1x / l1, ay: -e1y / l1 });
    }
  }
  return pick(corners, Math.min(BUDGET.spikes, o.count | 0), MIN_GAP.spikes, rng)
    .map((c) => {
      const len = o.len * (0.6 + rng() * 0.85);
      const bw = 0.030 + rng() * 0.045;
      const lean = (rng() - 0.5) * 0.55;      // 尖角略歪，不要齐刷刷一个方向
      const ax = c.x + (c.bx + c.ex * lean) * len;
      const ay = c.y + (c.by + c.ey * lean) * len;
      return [
        { x: c.x + c.ax * bw * 0.5, y: c.y + c.ay * bw * 0.5 },
        { x: ax, y: ay },
        { x: c.x + c.ex * bw, y: c.y + c.ey * bw }
      ];
    });
}

/* ============================ 手绘划线 ============================ */

function hatchStrip(p, o, rng) {
  const ang = Math.atan2(p.ty, p.tx) + (rng() < 0.5 ? 1 : -1) * (Math.PI * (0.28 + rng() * 0.22));
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const len = o.len * (0.7 + rng() * 0.7);
  const cx = p.x + p.nx * 0.045, cy = p.y + p.ny * 0.045;   // 起笔压在描边里，不会飘出去
  const M = 8;
  const pts = [];
  for (let k = 0; k <= M; k++) {
    const t = k / M;
    pts.push({ x: cx + dx * len * (t - 0.5), y: cy + dy * len * (t - 0.5), t });
  }
  const hw = (i, q) => o.width * Math.pow(Math.sin(Math.PI * q.t), 0.5);
  return ribbon(pts, hw, hw);
}

function hatchesOf(rings, o, rng) {
  const cands = [];
  for (const S of rings) for (let s = 0; s < S.total; s += 0.04) cands.push(S.at(s));
  return pick(cands, Math.min(BUDGET.hatches, o.count | 0), MIN_GAP.hatches, rng)
    .map((p) => hatchStrip(p, o, rng));
}

/* ============================ 总装 ============================ */

function bboxOf(rings) {
  const b = { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity };
  for (const S of rings) for (const p of S.ring) {
    if (p.x < b.minx) b.minx = p.x;
    if (p.x > b.maxx) b.maxx = p.x;
    if (p.y < b.miny) b.miny = p.y;
    if (p.y > b.maxy) b.maxy = p.y;
  }
  return Number.isFinite(b.minx) ? b : { minx: -0.5, miny: -0.5, maxx: 0.5, maxy: 0.5 };
}

/**
 * 生成整套街头外轮廓。
 *
 * @param {Array<Array<{x,y}>>} outlines 全部逆时针外轮廓（字形归一化空间，字高=1）
 * @param {object} o 见页面里的 OUTLINE_STYLES 默认值
 * @returns {{strips:number[][], stripRoles:string[], shapes:number[][][],
 *           shapeRoles:string[], stats:object}}
 *   strips      —— 条带（粗描边/滴漆/涂鸦线/划线），内部是 [lx,ly,rx,ry,...] 交错
 *   shapes      —— 简单多边形（箭头/飞溅/尖角），由调用方三角化
 *   stripRoles / shapeRoles —— 与上面两个数组一一对应，测试靠它逐类断言预算
 */
export function planGraffiti(outlines, o = {}) {
  const rng = mulberry32((o.seed ?? 20261008) >>> 0);
  const rings = (outlines || [])
    .filter((r) => r && r.length >= 3)
    .map(orient)
    .map(makeSampler)
    .filter((S) => S.total > 1e-4);

  const strips = [], stripRoles = [];
  const shapes = [], shapeRoles = [];
  let strokePeak = 0;

  const pushStrips = (list, role) => { for (const s of list) { if (s && s.length) { strips.push(s); stripRoles.push(role); } } };
  const pushShapes = (list, role) => { for (const s of list) { if (s && s.length) { shapes.push(s); shapeRoles.push(role); } } };

  for (const S of rings) {
    const r = strokeSegments(S.ring, {
      width: o.width, coverage: o.coverage, gaps: o.gaps,
      jitter: o.jitter, overlap: o.overlap, seed: (o.seed ?? 1337) ^ (strips.length * 7919)
    });
    pushStrips(r.strips, 'stroke');
    if (r.width > strokePeak) strokePeak = r.width;
  }

  pushStrips(dripsOf(rings, { count: o.drips, len: o.dripLen, width: o.dripWidth }, rng), 'drip');
  pushShapes(arrowsOf(rings, { count: o.arrows, len: o.arrowLen }, rng), 'arrow');
  pushShapes(splatsOf(rings, { count: o.splats, size: o.splatSize }, rng), 'splat');
  pushStrips(tagsOf(rings, bboxOf(rings),
    { count: o.tags, width: o.tagWidth, len: o.tagLen, swash: o.swash }, rng), 'tag');
  pushShapes(spikeShapes(rings, { count: o.spikes, len: o.spikeLen }, rng), 'spike');
  pushStrips(hatchesOf(rings, { count: o.hatches, width: o.hatchWidth, len: o.hatchLen }, rng), 'hatch');

  const roles = {};
  for (const r of stripRoles) roles[r] = (roles[r] || 0) + 1;
  for (const r of shapeRoles) roles[r] = (roles[r] || 0) + 1;

  return {
    strips, stripRoles, shapes, shapeRoles,
    stats: {
      rings: rings.length,
      strips: strips.length,
      shapes: shapes.length,
      strokeWidth: strokePeak,
      roles
    }
  };
}

/**
 * 条带 → 三角形顶点。逐段两个三角形，永远合法，
 * 窄缝处两侧条带重叠也只是同色叠同色。
 * @param {number[]} pairs [lx,ly,rx,ry,...]
 * @returns {Float32Array} 二维三角形坐标，每 6 个数一个三角形
 */
export function stripToTriangles(pairs) {
  const m = pairs.length / 4;
  if (m < 2) return new Float32Array(0);
  const out = new Float32Array((m - 1) * 12);
  let w = 0;
  for (let i = 0; i < m - 1; i++) {
    const a = i * 4, b = (i + 1) * 4;
    const aLx = pairs[a], aLy = pairs[a + 1], aRx = pairs[a + 2], aRy = pairs[a + 3];
    const bLx = pairs[b], bLy = pairs[b + 1], bRx = pairs[b + 2], bRy = pairs[b + 3];
    out[w++] = aLx; out[w++] = aLy; out[w++] = aRx; out[w++] = aRy; out[w++] = bRx; out[w++] = bRy;
    out[w++] = aLx; out[w++] = aLy; out[w++] = bLx; out[w++] = bLy; out[w++] = bRx; out[w++] = bRy;
  }
  return out;
}
