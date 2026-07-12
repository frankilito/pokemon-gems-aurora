// 贴图化建筑套件：民居/道馆 —— 石基/灰泥墙/木梁柱/瓦片人字顶/框窗/烟囱
import * as THREE from 'three';

const TL = new THREE.TextureLoader();
const _texCache = new Map();
function tex(path, srgb = false) {
  if (_texCache.has(path)) return _texCache.get(path);
  const t = TL.load(path);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  _texCache.set(path, t);
  return t;
}
// 几何 UV 缩放(共享纹理实例, 不同平铺密度)
function uvScale(geo, sx, sy = sx) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  return geo;
}
// 灰泥墙面(程序化, 可平铺)
let _plasterC = null, _plasterN = null;
function plasterTex(normal = false) {
  const key = normal ? '_pN' : '_pC';
  if (normal && _plasterN) return _plasterN;
  if (!normal && _plasterC) return _plasterC;
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const h = new Float32Array(S * S);
  for (let f = 1; f <= 3; f++) {
    const n = 6 * f, cell = S / n, amp = 1 / (f * f * .9);
    const g = [];
    for (let i = 0; i < n * n; i++) g.push(Math.random());
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const gx = x / cell, gy = y / cell;
      const x0 = Math.floor(gx) % n, y0 = Math.floor(gy) % n, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
      const fx = gx % 1, fy = gy % 1, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      h[y * S + x] += ((g[y0 * n + x0] * (1 - sx) + g[y0 * n + x1] * sx) * (1 - sy)
        + (g[y1 * n + x0] * (1 - sx) + g[y1 * n + x1] * sx) * sy) * amp;
    }
  }
  for (let i = 0; i < S * S; i++) {
    const v = h[i] / 1.6;
    if (!normal) {
      const b = 228 + v * 24;
      img.data[i * 4] = b; img.data[i * 4 + 1] = b - 2; img.data[i * 4 + 2] = b - 6; img.data[i * 4 + 3] = 255;
    } else {
      const x = i % S, y = (i / S) | 0;
      const dx = h[y * S + (x + 1) % S] - v * 1.6, dy = h[((y + 1) % S) * S + x] - v * 1.6;
      img.data[i * 4] = Math.max(0, Math.min(255, 128 - dx * 400));
      img.data[i * 4 + 1] = Math.max(0, Math.min(255, 128 - dy * 400));
      img.data[i * 4 + 2] = 240; img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (!normal) { t.colorSpace = THREE.SRGBColorSpace; _plasterC = t; } else _plasterN = t;
  return t;
}

// ---- 材质库(懒加载单例) ----
let MATS = null;
export function buildingMats() {
  if (MATS) return MATS;
  const roofC = tex('assets/textures/roof/color.jpg', true), roofN = tex('assets/textures/roof/normal.jpg');
  const plankC = tex('assets/textures/planks/color.jpg', true), plankN = tex('assets/textures/planks/normal.jpg');
  const paveC = tex('assets/textures/paving/color.jpg', true), paveN = tex('assets/textures/paving/normal.jpg');
  MATS = {
    wall: (tint = '#f5ead8') => new THREE.MeshStandardMaterial({
      color: tint, map: plasterTex(), normalMap: plasterTex(true), normalScale: new THREE.Vector2(.7, .7), roughness: .92,
    }),
    roof: (tint = '#ffffff') => new THREE.MeshStandardMaterial({
      color: tint, map: roofC, normalMap: roofN, normalScale: new THREE.Vector2(.9, .9), roughness: .82,
    }),
    wood: (tint = '#b58a5f') => new THREE.MeshStandardMaterial({
      color: tint, map: plankC, normalMap: plankN, roughness: .85,
    }),
    stone: (tint = '#ffffff') => new THREE.MeshStandardMaterial({
      color: tint, map: paveC, normalMap: paveN, roughness: .95,
    }),
    glass: (day = '#cfe8ff') => new THREE.MeshStandardMaterial({
      color: day, emissive: '#ffd98a', emissiveIntensity: 0, roughness: .25, metalness: .1,
    }),
  };
  return MATS;
}
// 夜晚窗户点灯(由 sky 每帧驱动)
export const GLASS_POOL = [];

// ---- 民居 ----
// opts: {w,d,hgt, wall,roof, chimney, sign:{color,emissive}, logoBall}
export function makeHouse(opts = {}) {
  const { w = 4, d = 4.5, hgt = 2.6, wall = '#f5ead8', roof = '#c85a48', chimney = Math.random() < .5 } = opts;
  const Mts = buildingMats();
  const g = new THREE.Group();

  // 石基
  const base = new THREE.Mesh(uvScale(new THREE.BoxGeometry(w + .5, .5, d + .5), 2.2, .5), Mts.stone());
  base.position.y = .22;
  g.add(base);
  // 墙体
  const body = new THREE.Mesh(uvScale(new THREE.BoxGeometry(w, hgt, d), 1.6, .9), Mts.wall(wall));
  body.position.y = hgt / 2 + .4;
  g.add(body);
  // 木质角柱 + 顶梁
  const woodM = Mts.wood();
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const post = new THREE.Mesh(uvScale(new THREE.BoxGeometry(.22, hgt, .22), .3, 1.4), woodM);
    post.position.set(sx * (w / 2 - .06), hgt / 2 + .4, sz * (d / 2 - .06));
    g.add(post);
  }
  const beam = new THREE.Mesh(uvScale(new THREE.BoxGeometry(w + .18, .26, d + .18), 2, .3), woodM);
  beam.position.y = hgt + .32;
  g.add(beam);

  // 人字瓦顶(两坡 + 山墙 + 屋脊)
  const pitch = .72, ov = .55;                      // 坡度/挑檐
  const roofH = (w / 2 + ov) * pitch;
  const slopeLen = Math.hypot(w / 2 + ov, roofH);
  const roofM = Mts.roof(roof);
  for (const s of [-1, 1]) {
    const slab = new THREE.Mesh(uvScale(new THREE.BoxGeometry(slopeLen, .12, d + ov * 2), Math.max(1, slopeLen * .8), Math.max(1, d * .7)), roofM);
    slab.position.set(s * (w / 4 + ov / 2), hgt + .45 + roofH / 2, 0);
    slab.rotation.z = -s * Math.atan2(roofH, w / 2 + ov);
    g.add(slab);
  }
  // 屋脊
  const ridge = new THREE.Mesh(uvScale(new THREE.BoxGeometry(.3, .18, d + ov * 2 + .1), .4, 2), woodM);
  ridge.position.y = hgt + .45 + roofH;
  g.add(ridge);
  // 山墙(三角)
  const tri = new THREE.Shape();
  tri.moveTo(-w / 2, 0); tri.lineTo(w / 2, 0); tri.lineTo(0, roofH); tri.closePath();
  const gableGeo = new THREE.ExtrudeGeometry(tri, { depth: .12, bevelEnabled: false });
  uvScale(gableGeo, .4, .4);
  for (const s of [-1, 1]) {
    const gable = new THREE.Mesh(gableGeo, Mts.wall(wall));
    gable.position.set(0, hgt + .42, s * (d / 2) - .06);
    g.add(gable);
  }
  // 烟囱
  if (chimney) {
    const ch = new THREE.Mesh(uvScale(new THREE.BoxGeometry(.55, 1.6, .55), .8, 1.2), Mts.stone('#d8d2c8'));
    ch.position.set(w * .28, hgt + roofH + .7, -d * .2);
    g.add(ch);
  }
  // 门(带框+台阶)
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.14, 1.72, .16), woodM);
  doorFrame.position.set(0, 1.26, d / 2 + .05);
  const door = new THREE.Mesh(uvScale(new THREE.BoxGeometry(.92, 1.52, .1), .8, 1.2), Mts.wood('#8a5f3f'));
  door.position.set(0, 1.16, d / 2 + .1);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(.05, 8, 6), new THREE.MeshStandardMaterial({ color: '#e8c860', metalness: .7, roughness: .3 }));
  knob.position.set(.32, 1.16, d / 2 + .17);
  const step = new THREE.Mesh(uvScale(new THREE.BoxGeometry(1.4, .22, .8), 1, .4), Mts.stone());
  step.position.set(0, .11, d / 2 + .5);
  g.add(doorFrame, door, knob, step);
  // 框窗×2(前) + 侧窗
  const mkWin = (x, z, ry = 0) => {
    const win = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(.96, .86, .14), woodM);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(.78, .68, .06), Mts.glass());
    glass.position.z = .03;
    GLASS_POOL.push(glass.material);
    const bar1 = new THREE.Mesh(new THREE.BoxGeometry(.05, .7, .08), woodM); bar1.position.z = .05;
    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(.8, .05, .08), woodM); bar2.position.z = .05;
    const sill = new THREE.Mesh(new THREE.BoxGeometry(1.06, .1, .24), woodM); sill.position.y = -.48;
    win.add(frame, glass, bar1, bar2, sill);
    win.position.set(x, 1.72, z);
    win.rotation.y = ry;
    return win;
  };
  g.add(mkWin(-w / 4 - .18, d / 2 + .04), mkWin(w / 4 + .18, d / 2 + .04));
  g.add(mkWin(0, -d / 2 - .04, Math.PI));
  const winL = mkWin(0, 0, Math.PI / 2); winL.position.set(-w / 2 - .04, 1.72, 0); g.add(winL);

  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// ---- 道馆(八角殿) ----
export function makeGym(color = '#c2ab6e') {
  const Mts = buildingMats();
  const g = new THREE.Group();
  const base = new THREE.Mesh(uvScale(new THREE.CylinderGeometry(5.6, 6.1, 1, 8), 4, .5), Mts.stone());
  base.position.y = .5;
  const hall = new THREE.Mesh(uvScale(new THREE.CylinderGeometry(4.2, 4.8, 3.4, 8), 3, 1.6), Mts.wall('#f2f0ea'));
  hall.position.y = 2.7;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(4.35, 4.35, .34, 8), new THREE.MeshStandardMaterial({ color, roughness: .6, emissive: color, emissiveIntensity: .12 }));
  band.position.y = 3.9;
  const roof = new THREE.Mesh(uvScale(new THREE.ConeGeometry(5.4, 2.6, 8), 5, 1.6), Mts.roof(color));
  roof.position.y = 5.7;
  const finial = new THREE.Mesh(new THREE.OctahedronGeometry(.45), new THREE.MeshStandardMaterial({ color: '#fff', emissive: color, emissiveIntensity: .8, metalness: .4, roughness: .3 }));
  finial.position.y = 7.3;
  // 门廊
  const gateFrame = new THREE.Mesh(uvScale(new THREE.BoxGeometry(2.8, 2.9, .6), 1.2, 1.2), Mts.wood('#9a7a54'));
  gateFrame.position.set(0, 1.9, 4.55);
  const gate = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.3, .5), new THREE.MeshStandardMaterial({ color, roughness: .5, emissive: color, emissiveIntensity: .25 }));
  gate.position.set(0, 1.65, 4.72);
  for (const s of [-1, 1]) {
    const pil = new THREE.Mesh(uvScale(new THREE.CylinderGeometry(.22, .26, 2.9, 8), .5, 1.4), Mts.stone());
    pil.position.set(s * 1.9, 1.9, 4.7);
    g.add(pil);
  }
  g.add(base, hall, band, roof, finial, gateFrame, gate);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
