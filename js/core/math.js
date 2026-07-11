// 数学与噪声工具
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const easeOut = t => 1 - Math.pow(1 - t, 3);
export const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const TAU = Math.PI * 2;
export const damp = (cur, target, l, dt) => lerp(cur, target, 1 - Math.exp(-l * dt));
export const angleLerp = (a, b, t) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU;
  return a + d * t;
};
export const dampAngle = (cur, target, l, dt) => angleLerp(cur, target, 1 - Math.exp(-l * dt));

// 可播种随机
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash2(x, y, seed = 1337) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ------- 2D Simplex Noise (自包含) -------
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
export class Noise2D {
  constructor(seed = 0) {
    const rnd = mulberry32(seed);
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  get(xin, yin) {
    const perm = this.perm;
    let n0 = 0, n1 = 0, n2 = 0;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let t0 = .5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) { t0 *= t0; const g = GRAD[perm[ii + perm[jj]] & 7]; n0 = t0 * t0 * (g[0] * x0 + g[1] * y0); }
    let t1 = .5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) { t1 *= t1; const g = GRAD[perm[ii + i1 + perm[jj + j1]] & 7]; n1 = t1 * t1 * (g[0] * x1 + g[1] * y1); }
    let t2 = .5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) { t2 *= t2; const g = GRAD[perm[ii + 1 + perm[jj + 1]] & 7]; n2 = t2 * t2 * (g[0] * x2 + g[1] * y2); }
    return 70 * (n0 + n1 + n2); // [-1,1]
  }
  fbm(x, y, oct = 4, lac = 2, gain = .5) {
    let amp = .5, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += amp * this.get(x * f, y * f); norm += amp;
      f *= lac; amp *= gain;
    }
    return sum / norm;
  }
  ridged(x, y, oct = 4) {
    let amp = .5, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += amp * (1 - Math.abs(this.get(x * f, y * f)));
      norm += amp; f *= 2; amp *= .5;
    }
    return sum / norm; // [0,1]
  }
}
