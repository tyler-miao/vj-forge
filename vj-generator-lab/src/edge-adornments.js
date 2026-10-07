/**
 * 边缘装饰：沿字形轮廓在上下边缘批量排布"长出来的东西"。
 *
 * 为什么独立成模块：锥体是最默认的做法，但边缘长什么、怎么排，本身就是字形
 * 设计的一部分（獠牙、碎钻晶簇、刀刃、滴落、铆钉、长针……）。把它做成可切换的，
 * 字形才能真正变得独特。
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
  random: { label: '乱序',   f: null }   // 用 rng 生成
};

/**
 * 计算一份装饰排布。
 *
 * @param {object} o
 *   profile  由 profileFromPoints 得到
 *   sides    'top' | 'bottom' | 'both'
 *   pattern  PATTERNS 的键
 *   base     基准长度（物体单位，字高=1）
 *   jitter   长度随机扰动的比例
 *   lean     左右倾斜量（正的往外张）
 *   seed     随机种子 —— 同样的种子必须给同样的结果
 * @returns {Array<{x,y,len,up,spin,thick,tilt}>}
 */
export function layoutAdornments(o) {
  const { profile, sides = 'both', pattern = 'fan', base = 0.34, jitter = 0.35, lean = 0, seed = 1337 } = o;
  if (!profile) return [];
  const rng = mulberry32(seed);
  const { minX, binW, bins, topY, botY } = profile;
  const patternFn = (PATTERNS[pattern] || PATTERNS.fan).f;
  const out = [];

  for (let b = 0; b < bins; b++) {
    const t = (b + 0.5) / bins;
    const shape = patternFn ? patternFn(t, b) : (0.32 + 0.68 * rng());
    const len = Math.max(0.02, base * shape * (1 + (rng() * 2 - 1) * jitter));
    const x = minX + (b + 0.5) * binW;
    const tilt = lean * (t - 0.5) * 2;

    if ((sides === 'top' || sides === 'both') && Number.isFinite(topY[b])) {
      out.push({ x, y: topY[b] + len * 0.5, len, up: true, spin: rng() * Math.PI * 2, thick: 0.80 + 0.40 * rng(), tilt });
    }
    if ((sides === 'bottom' || sides === 'both') && Number.isFinite(botY[b])) {
      out.push({ x, y: botY[b] - len * 0.5, len, up: false, spin: rng() * Math.PI * 2, thick: 0.80 + 0.40 * rng(), tilt: -tilt });
    }
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
