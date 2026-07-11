// 极光大陆：解析高度场 + 生态群系 + 分块地形网格(顶点色)
import * as THREE from 'three';
import { Noise2D, clamp, lerp, smoothstep, hash2 } from '../core/math.js';
import { G } from '../core/engine.js';

const SEED = 20260711;
const n1 = new Noise2D(SEED), n2 = new Noise2D(SEED + 7), n3 = new Noise2D(SEED + 21), n4 = new Noise2D(SEED + 40);

export const WORLD = {
  size: 1700,          // 大陆直径
  radius: 780,
  water: 0,            // 海平面
  town: { x: 0, z: 470, r: 115 },
  lake: { x: -400, z: 40, r: 165 },
  mountain: { x: 30, z: -520, r: 390 },
  volcano: { x: 442, z: -350, r: 175 },
  ruins: { x: 400, z: 395, r: 120 },
  forest: { x: 470, z: 110, r: 270 },
  cave: { x: -235, z: -395, r: 95 },
  temple: { x: 30, z: -650, r: 60 },
};

const dist = (x, z, cx, cz) => Math.hypot(x - cx, z - cz);

// ---- 河流: 镜湖 → 南海岸 贝塞尔采样 ----
const RIVER_PTS = (() => {
  const p0 = { x: -390, z: 150 }, p1 = { x: -300, z: 330 }, p2 = { x: -120, z: 430 }, p3 = { x: -150, z: 760 };
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40, it = 1 - t;
    pts.push({
      x: it*it*it*p0.x + 3*it*it*t*p1.x + 3*it*t*t*p2.x + t*t*t*p3.x,
      z: it*it*it*p0.z + 3*it*it*t*p1.z + 3*it*t*t*p2.z + t*t*t*p3.z,
    });
  }
  return pts;
})();
function riverDist(x, z) {
  let d = 1e9;
  for (const p of RIVER_PTS) { const dd = dist(x, z, p.x, p.z); if (dd < d) d = dd; }
  return d;
}

// ---- 高度场 ----
export function getHeight(x, z) {
  const W = WORLD;
  // 海岸: 带噪声摆动的径向衰减
  const wob = n1.fbm(x * .0016 + 9, z * .0016) * 46;
  const d = Math.hypot(x, z * 1.06) + wob;
  const land = smoothstep(W.radius + 40, W.radius - 130, d);   // 1 内陆 0 海
  if (land <= 0.001) return -16 + n1.get(x * .01, z * .01) * 2;

  // 内陆基准: 始终为正的起伏平原
  let h = 7 + (n1.fbm(x * .0075, z * .0075, 3) * .5 + .5) * 7
        + (n2.fbm(x * .0026, z * .0026, 3) * .5 + .5) * 15;

  // 雪山
  const md = dist(x, z, W.mountain.x, W.mountain.z) / W.mountain.r;
  const mm = smoothstep(1, .2, md);
  h += n2.ridged(x * .0026, z * .0026, 4) * 148 * Math.pow(mm, 1.5) + mm * 46;

  // 火山锥
  const vd = dist(x, z, W.volcano.x, W.volcano.z) / W.volcano.r;
  const cone = smoothstep(1, .13, vd) * 96;
  const crater = smoothstep(.3, .08, vd) * 40;
  h += cone - crater + (vd < 1 ? n1.get(x * .015, z * .015) * 2.5 : 0);

  // 镜湖洼地
  const ld = dist(x, z, W.lake.x, W.lake.z) / W.lake.r;
  h -= smoothstep(1.08, .4, ld) * (h + 8);

  // 河道
  const rd = riverDist(x, z);
  const carve = smoothstep(24, 5, rd);
  h = lerp(h, Math.min(h, -3), carve);

  // 回声洞窟: 深谷
  const cd = dist(x, z, W.cave.x, W.cave.z) / W.cave.r;
  h -= smoothstep(1, .32, cd) * clamp(h * .7, 0, 52);

  // 星陨遗迹高台
  const ud = dist(x, z, W.ruins.x, W.ruins.z) / W.ruins.r;
  h = lerp(h, 21 + n1.get(x * .02, z * .02) * 1.2, smoothstep(.95, .5, ud));

  // 曦光镇平地
  const td = dist(x, z, W.town.x, W.town.z) / W.town.r;
  h = lerp(h, 8 + n1.get(x * .03, z * .03) * .5, smoothstep(1, .5, td));

  // 神殿平台(雪山之巅北侧)
  const pd = dist(x, z, W.temple.x, W.temple.z) / W.temple.r;
  h = lerp(h, 126, smoothstep(1, .45, pd));

  // 海岸融合
  h = h * land - (1 - land) * 20;
  return h;
}

// 放置采样: 取邻域最低点, 避免与网格近似误差导致浮空
export function getPlaceHeight(x, z, r = 1.6) {
  let h = getHeight(x, z);
  h = Math.min(h, getHeight(x + r, z), getHeight(x - r, z), getHeight(x, z + r), getHeight(x, z - r));
  return h;
}

// ---- 群系 ----
// town grass forest lake snow volcano cave ruins beach sea
export function getBiome(x, z) {
  const W = WORLD;
  const h = getHeight(x, z);
  if (h < -3 && Math.hypot(x, z) > W.radius - 60) return 'sea';
  const td = dist(x, z, W.town.x, W.town.z) / W.town.r;
  if (td < 1) return 'town';
  const pd = dist(x, z, W.temple.x, W.temple.z) / W.temple.r;
  if (pd < 1) return 'temple';
  const cd = dist(x, z, W.cave.x, W.cave.z) / W.cave.r;
  if (cd < .95) return 'cave';
  const vd = dist(x, z, W.volcano.x, W.volcano.z) / W.volcano.r;
  if (vd < 1.12) return 'volcano';
  const md = dist(x, z, W.mountain.x, W.mountain.z) / W.mountain.r;
  if (h > 62 || (md < .8 && h > 40)) return 'snow';
  const ld = dist(x, z, W.lake.x, W.lake.z) / W.lake.r;
  if (ld < 1.18 || riverDist(x, z) < 22) return 'lake';
  const ud = dist(x, z, W.ruins.x, W.ruins.z) / W.ruins.r;
  if (ud < 1.05) return 'ruins';
  if (h < 4.2) return 'beach';
  const fd = dist(x, z, W.forest.x, W.forest.z) / W.forest.r;
  const moist = n3.fbm(x * .0035, z * .0035, 3);
  if (fd < 1 && moist > -.25) return 'forest';
  if (moist > .34 && x > -100) return 'forest';
  return 'grass';
}

export const ZONE_NAMES = {
  town: '曦光镇', grass: '晨风草原', forest: '翠影森林', lake: '镜湖水乡',
  snow: '霜峰雪山', volcano: '熔心火山', cave: '回声洞窟', ruins: '星陨遗迹',
  beach: '沙鸣海滩', sea: '外海', temple: '极光神殿',
};

// ---- 顶点配色 ----
const C = {
  grassA: new THREE.Color('#83cf5e'), grassB: new THREE.Color('#a9e37f'), grassC: new THREE.Color('#6dbd52'),
  forestA: new THREE.Color('#4d9e52'), forestB: new THREE.Color('#63b45f'),
  sand: new THREE.Color('#eed9a4'), sandWet: new THREE.Color('#d9bf8a'),
  rock: new THREE.Color('#9aa0ae'), rockDark: new THREE.Color('#7c8292'),
  snow: new THREE.Color('#f7fbff'), snowShade: new THREE.Color('#dbe8f7'),
  basalt: new THREE.Color('#54484e'), basaltHot: new THREE.Color('#6e4a45'),
  ruin: new THREE.Color('#cfc7a8'),
  town: new THREE.Color('#8fd468'), path: new THREE.Color('#d8c493'),
  seabed: new THREE.Color('#3f7fae'), caveRock: new THREE.Color('#5d5a6e'),
  templ: new THREE.Color('#dfe9f5'),
};
const _c = new THREE.Color();
export function getGroundColor(x, z, h, out = _c) {
  const b = getBiome(x, z);
  const t = hash2(Math.floor(x * .5), Math.floor(z * .5)) * .5 + n4.get(x * .05, z * .05) * .5;
  const slope = getSlope(x, z);
  switch (b) {
    case 'sea': out.copy(C.seabed).lerp(C.sand, smoothstep(-16, -2, h)); break;
    case 'beach': out.copy(C.sandWet).lerp(C.sand, smoothstep(0, 3.5, h)); break;
    case 'town': {
      const pathd = townPathDist(x, z);
      out.copy(C.town).lerp(C.grassB, t * .5);
      if (pathd < 3.4) out.copy(C.path);
      break;
    }
    case 'grass': out.copy(C.grassA).lerp(C.grassB, t).lerp(C.grassC, n4.get(x * .012, z * .012) * .5 + .25); break;
    case 'forest': out.copy(C.forestA).lerp(C.forestB, t); break;
    case 'lake': out.copy(C.sand).lerp(C.grassA, smoothstep(1.5, 5, h)); break;
    case 'snow': out.copy(C.snowShade).lerp(C.snow, smoothstep(.3, .7, t + (1 - slope))); break;
    case 'volcano': out.copy(C.basalt).lerp(C.basaltHot, t * .7); break;
    case 'cave': out.copy(C.caveRock).lerp(C.rockDark, t); break;
    case 'ruins': out.copy(C.ruin).lerp(C.grassB, t * .55); break;
    case 'temple': out.copy(C.templ).lerp(C.snow, t); break;
    default: out.copy(C.grassA);
  }
  // 陡坡露岩
  if (b !== 'volcano' && b !== 'cave' && b !== 'sea') {
    const rockT = smoothstep(.55, .8, slope);
    out.lerp(h > 55 ? C.rockDark : C.rock, rockT * .9);
  }
  // 雪线过渡
  if (h > 55 && b !== 'volcano' && b !== 'temple') out.lerp(C.snow, smoothstep(58, 74, h + n4.get(x * .03, z * .03) * 6) * (1 - smoothstep(.6, .85, slope)));
  return out;
}

function townPathDist(x, z) {
  // 镇内十字路 + 通往北方的主路
  const W = WORLD;
  const dx = Math.abs(x - W.town.x), dz = Math.abs(z - W.town.z);
  let d = Math.min(dx, dz);
  // 北向大道
  if (z < W.town.z && z > W.town.z - 200) d = Math.min(d, Math.abs(x - W.town.x));
  return d;
}

export function getSlope(x, z) {
  const e = 1.2;
  const hx = getHeight(x + e, z) - getHeight(x - e, z);
  const hz = getHeight(x, z + e) - getHeight(x, z - e);
  return clamp(Math.hypot(hx, hz) / (2 * e), 0, 2);
}
const _n = new THREE.Vector3();
export function getNormal(x, z, out = _n) {
  const e = 1.2;
  out.set(getHeight(x - e, z) - getHeight(x + e, z), 2 * e, getHeight(x, z - e) - getHeight(x, z + e)).normalize();
  return out;
}

// ---- 地形网格 ----
export class Terrain {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    this.chunks = [];
    this.build();
  }
  build() {
    const CH = 8;                 // 8x8 块
    const size = WORLD.size / CH; // 每块尺寸
    const SEG = 64;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .94, metalness: 0, flatShading: false });
    for (let cz = 0; cz < CH; cz++) for (let cx = 0; cx < CH; cx++) {
      const ox = (cx - CH / 2 + .5) * size, oz = (cz - CH / 2 + .5) * size;
      const geo = new THREE.PlaneGeometry(size, size, SEG, SEG);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) + ox, z = pos.getZ(i) + oz;
        const h = getHeight(x, z);
        pos.setY(i, h);
        const c = getGroundColor(x, z, h);
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(ox, 0, oz);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      this.group.add(mesh);
      this.chunks.push(mesh);
    }
  }
  // 视距裁剪
  update() {
    const cam = G.camera.position;
    for (const m of this.chunks) {
      const dx = m.position.x - cam.x, dz = m.position.z - cam.z;
      m.visible = (dx * dx + dz * dz) < 1500 * 1500;
    }
  }
}
