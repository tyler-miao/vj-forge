/**
 * 边缘装饰：沿字形轮廓批量排布"长出来的东西"。
 *
 * 两个排布模式：
 *   · 上下边缘（按 x 分列取最高/最低点）—— 快，但换什么形状都还是"头顶一排刺"
 *   · 整圈（沿外轮廓等弧长采样，朝外法线生长）—— 这是关键，
 *     装饰长满整个剪影，观感上和"头顶一排"是完全不同的东西
 *
 * 本模块只算**实例变换**（位置/长度/朝向/粗细），不碰 three ——
 * 几何体由页面按形态构建。这样排布逻辑可以在 Node 里定量验证。
 */

/** 可复现的伪随机数发生器。同一个种子必须给出同一份排布，否则录两遍视频不一样。 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 从点集里量出每列的最高点和最低点，得到上下轮廓。
 * @param {Array<{x:number,y:number}>} pts
 * @param {number} bins 分几列
 */
export function profileFromPoints(pts, bins) {
  let minX = Infinity, maxX = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  if (!Number.isFinite(minX) || maxX <= minX) return null;
  const binW = (maxX - minX) / bins;
  const topY = new Array(bins).fill(-Infinity);
  const botY = new Array(bins).fill(Infinity);
  for (const p of pts) {
    let b = Math.floor((p.x - minX) / binW);
    if (b < 0) b = 0;
    if (b >= bins) b = bins - 1;
    if (p.y > topY[b]) topY[b] = p.y;
    if (p.y < botY[b]) botY[b] = p.y;
  }
  return { minX, maxX, binW, bins, topY, botY };
}

/** 排布模式：决定一根根装饰的长度怎么随位置变化 */
export const PATTERNS = {
  fan:    { label: '扇形弧', f: (t) => 0.50 + 0.50 * Math.sin(Math.PI * t) },
  zigzag: { label: '锯齿',   f: (t, i) => (i % 2) ? 1.00 : 0.46 },
  ramp:   { label: '递增',   f: (t) => 0.22 + 0.78 * t },
  wave:   { label: '波浪',   f: (t) => 0.34 + 0.66 * Math.abs(Math.sin(t * Math.PI * 3)) },
  pulse:  { label: '脉冲',   f: (t, i) => (i % 5 === 0) ? 1.00 : 0.30 },
  random: { label: '乱序',   f: null }   // 用 rng 生成
};

function shapeOf(pattern, t, i, rng) {
  const fn = (PATTERNS[pattern] || PATTERNS.fan).f;
  return fn ? fn(t, i) : (0.32 + 0.68 * rng());
}

/** 实例统一带 angleZ（绕 Z 的朝向）。不再用 up 布尔 —— 整圈模式需要任意角度。 */
function makeInstance(x, y, len, angleZ, rng, tilt) {
  return {
    x, y, len, angleZ,
    spin: rng() * Math.PI * 2,
    thick: 0.80 + 0.40 * rng(),
    tilt: tilt || 0
  };
}

/**
 * 上下边缘排布。
 *   profile / sides('top'|'bottom'|'both') / pattern / base / jitter / lean / seed
 * @returns {Array<{x,y,len,angleZ,spin,thick,tilt}>}
 */
export function layoutAdornments(o) {
  const { profile, sides = 'both', pattern = 'fan', base = 0.34, jitter = 0.35, lean = 0, seed = 1337 } = o;
  if (!profile) return [];
  const rng = mulberry32(seed);
  const { minX, binW, bins, topY, botY } = profile;
  const out = [];

  for (let b = 0; b < bins; b++) {
    const t = (b + 0.5) / bins;
    const len = Math.max(0.02, base * shapeOf(pattern, t, b, rng) * (1 + (rng() * 2 - 1) * jitter));
    const x = minX + (b + 0.5) * binW;
    const tilt = lean * (t - 0.5) * 2;

    if ((sides === 'top' || sides === 'both') && Number.isFinite(topY[b])) {
      out.push(makeInstance(x, topY[b] + len * 0.5, len, 0, rng, tilt));
    }
    if ((sides === 'bottom' || sides === 'both') && Number.isFinite(botY[b])) {
      out.push(makeInstance(x, botY[b] - len * 0.5, len, Math.PI, rng, -tilt));
    }
  }
  return out;
}

/**
 * 整圈排布：沿外轮廓等弧长采样，朝外法线生长。
 *
 * 前提：传入的环必须是**逆时针**（外轮廓）。经过 stylizeRing 的环都满足，
 * 所以外法线就是 (dy, −dx)。
 *
 * @param {Array<{x:number,y:number}>} ring 逆时针的外轮廓
 * @returns {Array<{x,y,len,angleZ,spin,thick,tilt}>}
 */
export function outlinePlacements(ring, o) {
  const { spacing = 0.13, pattern = 'fan', base = 0.34, jitter = 0.35, seed = 1337 } = o;
  const n = ring ? ring.length : 0;
  if (n < 3) return [];

  const cum = [0];
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    cum.push(cum[i] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cum[n];
  if (!(total > 1e-6)) return [];
  const count = Math.max(6, Math.round(total / Math.max(spacing, 1e-3)));

  const rng = mulberry32(seed);
  const out = [];
  for (let k = 0; k < count; k++) {
    const s = ((k + 0.5) / count) * total;
    let i = 0;
    while (i < n - 1 && cum[i + 1] < s) i++;
    const a = ring[i], b = ring[(i + 1) % n];
    const seg = Math.max(cum[i + 1] - cum[i], 1e-9);
    const t = Math.min(1, Math.max(0, (s - cum[i]) / seg));
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    const ex = (b.x - a.x) / seg, ey = (b.y - a.y) / seg;
    const nx = ey, ny = -ex;                       // 逆时针环的外法线

    const u = (k + 0.5) / count;
    const len = Math.max(0.02, base * shapeOf(pattern, u, k, rng) * (1 + (rng() * 2 - 1) * jitter));
    // 把几何体自身的 +Y（生长轴）转到外法线方向
    const angleZ = Math.atan2(ny, nx) - Math.PI / 2;
    out.push(makeInstance(px + nx * len * 0.5, py + ny * len * 0.5, len, angleZ, rng, 0));
  }
  return out;
}

/** 把任意几何体归一化到「高度 1、上下居中」，好让实例的 scale.y 直接等于长度 */
export function normalizeUnitHeight(geometry) {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const h = Math.max(bb.max.y - bb.min.y, 1e-6);
  geometry.translate(0, -(bb.max.y + bb.min.y) / 2, 0);
  geometry.scale(1, 1 / h, 1);
  geometry.computeVertexNormals();
  return geometry;
}
