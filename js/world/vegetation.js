// 植被与散布物：摇曳草地(实例化) / 树木 / 岩石 / 花丛 / 远景山脉
import * as THREE from 'three';
import { G, addUpdate } from '../core/engine.js';
import { getHeight, getPlaceHeight, getBiome, getSlope, WORLD } from './terrain.js';
import { hash2, mulberry32, clamp, Noise2D } from '../core/math.js';

const toon = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: .92, metalness: 0, ...opts });

// ============ 摇曳草 ============
export class GrassField {
  constructor(scene) {
    this.MAX = 22000;
    this.radius = 62;
    const blade = new THREE.PlaneGeometry(.1, 1, 1, 3);
    blade.translate(0, .5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = blade.index; geo.attributes.position = blade.attributes.position; geo.attributes.uv = blade.attributes.uv;
    const offs = new Float32Array(this.MAX * 3), scl = new Float32Array(this.MAX), rot = new Float32Array(this.MAX), ph = new Float32Array(this.MAX), col = new Float32Array(this.MAX * 3);
    geo.setAttribute('iOff', new THREE.InstancedBufferAttribute(offs, 3));
    geo.setAttribute('iScale', new THREE.InstancedBufferAttribute(scl, 1));
    geo.setAttribute('iRot', new THREE.InstancedBufferAttribute(rot, 1));
    geo.setAttribute('iPhase', new THREE.InstancedBufferAttribute(ph, 1));
    geo.setAttribute('iCol', new THREE.InstancedBufferAttribute(col, 3));
    this.attrs = { offs, scl, rot, ph, col };
    this.geo = geo;

    this.uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uPlayer: { value: new THREE.Vector3() },
        uSunI: { value: 1 },
      },
    ]);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, side: THREE.DoubleSide, fog: true,
      vertexShader: `
        #include <fog_pars_vertex>
        attribute vec3 iOff; attribute float iScale; attribute float iRot; attribute float iPhase; attribute vec3 iCol;
        uniform float uTime; uniform vec3 uPlayer;
        varying vec3 vCol; varying float vTip;
        void main(){
          vTip = uv.y;
          float c = cos(iRot), s = sin(iRot);
          vec3 p = position;
          p.x *= (1.0 - uv.y * 0.72);   // 叶尖收窄
          p.xz = mat2(c,-s,s,c) * p.xz;
          p *= iScale;
          float bendT = vTip * vTip;
          float sway = sin(uTime*2.1 + iPhase + iOff.x*0.15) * 0.14 + sin(uTime*3.7 + iPhase*2.0)*0.05;
          p.x += sway * bendT * iScale;
          vec3 wp = p + iOff;
          // 玩家推开
          vec2 toP = wp.xz - uPlayer.xz;
          float pd = length(toP);
          if (pd < 1.6 && pd > 0.001) {
            wp.xz += normalize(toP) * (1.6 - pd) * 0.55 * bendT;
            wp.y -= (1.6-pd) * 0.25 * bendT;
          }
          vCol = iCol;
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        #include <fog_pars_fragment>
        varying vec3 vCol; varying float vTip; uniform float uSunI;
        void main(){
          vec3 col = vCol * (0.55 + vTip*0.55) * uSunI;
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.lastGen = new THREE.Vector2(1e9, 1e9);
    addUpdate(() => this.update());
  }
  update() {
    this.uniforms.uTime.value = G.time;
    if (G.player) this.uniforms.uPlayer.value.copy(G.player.pos);
    if (G.sky) this.uniforms.uSunI.value = clamp(.35 + G.sky.sun.intensity * .4 + G.sky.uniforms.uNight.value * .08, .18, 1.25);
    const p = G.player ? G.player.pos : G.camera.position;
    if (this.lastGen.distanceTo(new THREE.Vector2(p.x, p.z)) > 14) this.generate(p.x, p.z);
  }
  generate(px, pz) {
    this.lastGen.set(px, pz);
    const { offs, scl, rot, ph, col } = this.attrs;
    const R = this.radius;
    let n = 0;
    const cA = new THREE.Color(), cB = new THREE.Color('#d8f591');
    const step = .8;
    for (let gx = Math.floor((px - R) / step); gx * step < px + R && n < this.MAX; gx++) {
      for (let gz = Math.floor((pz - R) / step); gz * step < pz + R && n < this.MAX; gz++) {
        const h1 = hash2(gx, gz), h2 = hash2(gx, gz, 99), h3 = hash2(gx, gz, 7);
        const x = gx * step + (h1 - .5) * step * 1.6, z = gz * step + (h2 - .5) * step * 1.6;
        const dx = x - px, dz = z - pz;
        if (dx * dx + dz * dz > R * R) continue;
        const b = getBiome(x, z);
        let density, base;
        if (b === 'grass') { density = .78; base = '#6ec552'; }
        else if (b === 'forest') { density = .6; base = '#4da653'; }
        else if (b === 'town') { density = .3; base = '#79cd58'; }
        else if (b === 'lake') { density = .42; base = '#7fc766'; }
        else if (b === 'ruins') { density = .3; base = '#a4b578'; }
        else if (b === 'snow' || b === 'temple') { density = .1; base = '#cfe0d8'; }
        else continue;
        if (h3 > density) continue;
        const h = getHeight(x, z);
        if (h < .4 || getSlope(x, z) > .75) continue;
        offs[n * 3] = x; offs[n * 3 + 1] = h - .04; offs[n * 3 + 2] = z;
        scl[n] = .3 + h1 * .38;
        rot[n] = h2 * Math.PI * 2;
        ph[n] = h3 * 10;
        cA.set(base).offsetHSL((h1 - .5) * .05, 0, (h2 - .5) * .1).lerp(cB, h3 * .3);
        col[n * 3] = cA.r; col[n * 3 + 1] = cA.g; col[n * 3 + 2] = cA.b;
        n++;
      }
    }
    this.geo.instanceCount = n;
    for (const k in this.attrs) { }
    this.geo.attributes.iOff.needsUpdate = true;
    this.geo.attributes.iScale.needsUpdate = true;
    this.geo.attributes.iRot.needsUpdate = true;
    this.geo.attributes.iPhase.needsUpdate = true;
    this.geo.attributes.iCol.needsUpdate = true;
  }
}

// ============ 树木/岩石/花丛 散布 ============
export class Scatter {
  constructor(scene, world) {
    this.world = world;
    const rnd = mulberry32(4242);
    const KEYS = ['leafA', 'leafB', 'leafC', 'pineA', 'pineB', 'icePine', 'palm', 'rock', 'rockDark', 'rockSnow', 'flowerA', 'flowerB', 'mushroom', 'deadTree', 'berry'];
    const items = {};
    for (const k of KEYS) items[k] = [];

    const tmp = new THREE.Object3D();
    const place = (arr, x, y, z, s, ry, tilt = 0) => {
      tmp.position.set(x, y, z); tmp.scale.setScalar(s);
      tmp.rotation.set(tilt, ry, 0);
      tmp.updateMatrix();
      arr.push(tmp.matrix.clone());
    };
    const leafPick = () => items[['leafA', 'leafB', 'leafC'][rnd() * 3 | 0]];
    const pinePick = () => items[rnd() < .5 ? 'pineA' : 'pineB'];
    const flowerPick = () => items[rnd() < .5 ? 'flowerA' : 'flowerB'];

    const R = WORLD.radius + 30;
    for (let i = 0; i < 30000; i++) {
      const x = (rnd() * 2 - 1) * R, z = (rnd() * 2 - 1) * R;
      const b = getBiome(x, z);
      const h = getPlaceHeight(x, z);
      if (h < 2.2) continue;
      const slope = getSlope(x, z);
      const r1 = rnd(), r2 = rnd(), ry = rnd() * Math.PI * 2;
      const inTown = Math.hypot(x - WORLD.town.x, z - WORLD.town.z) < WORLD.town.r * .82;
      if (inTown) {
        if (r1 < .05 && slope < .4) { const sc = .8 + r2 * .4; place(leafPick(), x, h - .06, z, sc, ry); this.world.addCollider(x, z, 1.5 * sc); }
        else if (r1 < .3) place(flowerPick(), x, h, z, .55 + r2 * .4, ry);
        continue;
      }
      if (b === 'forest') {
        if (r1 < .52 && slope < .6) {
          const sc = .85 + r2 * .75;
          place(leafPick(), x, h - .08, z, sc, ry);
          this.world.addCollider(x, z, 1.6 * sc);
        } else if (r1 < .58) place(items.mushroom, x, h, z, .8 + r2, ry);
        else if (r1 < .78) place(flowerPick(), x, h, z, .5 + r2 * .5, ry);
        else if (r1 < .84) place(items.berry, x, h, z, .9 + r2 * .5, ry);
      } else if (b === 'grass') {
        if (r1 < .05 && slope < .5) {
          const sc = .75 + r2 * .6;
          place(leafPick(), x, h - .08, z, sc, ry);
          this.world.addCollider(x, z, 1.5 * sc);
        }
        else if (r1 < .07 && slope < .5) { const sc = .8 + r2 * .5; place(pinePick(), x, h - .05, z, sc, ry); this.world.addCollider(x, z, 1.2 * sc); }
        else if (r1 < .12) place(items.rock, x, h, z, .4 + r2 * 1.1, ry);
        else if (r1 < .34) place(flowerPick(), x, h, z, .5 + r2 * .45, ry);
        else if (r1 < .4) place(items.berry, x, h, z, .8 + r2 * .6, ry);
      } else if (b === 'snow' || b === 'temple') {
        if (r1 < .32 && slope < .55 && h < 112) {
          const sc = .8 + r2 * .9;
          place(items.icePine, x, h - .05, z, sc, ry);
          this.world.addCollider(x, z, 1.2 * sc);
        } else if (r1 < .52) place(items.rockSnow, x, h, z, .5 + r2 * 1.6, ry);
      } else if (b === 'volcano') {
        if (r1 < .32) place(items.rockDark, x, h, z, .5 + r2 * 1.8, ry);
        else if (r1 < .44) { place(items.deadTree, x, h - .05, z, .8 + r2, ry); this.world.addCollider(x, z, .5); }
      } else if (b === 'cave') {
        if (r1 < .42) place(items.rockDark, x, h, z, .6 + r2 * 2.1, ry);
        else if (r1 < .66) place(items.mushroom, x, h, z, 1.1 + r2 * 1.7, ry);
      } else if (b === 'beach') {
        if (r1 < .07 && slope < .4) {
          const sc = .85 + r2 * .5;
          place(items.palm, x, h - .06, z, sc, ry, (rnd() - .5) * .2);
          this.world.addCollider(x, z, .8 * sc);
        } else if (r1 < .13) place(items.rock, x, h, z, .35 + r2 * .8, ry);
      } else if (b === 'lake') {
        if (r1 < .22 && h > 1.2) place(flowerPick(), x, h, z, .55 + r2 * .5, ry);
        else if (r1 < .3 && slope < .5 && h > 1.5) {
          const sc = .75 + r2 * .55;
          place(leafPick(), x, h - .08, z, sc, ry);
          this.world.addCollider(x, z, 1.5 * sc);
        } else if (r1 < .36) place(items.berry, x, h, z, .8 + r2 * .5, ry);
      } else if (b === 'ruins') {
        if (r1 < .12) place(items.rock, x, h, z, .4 + r2 * .9, ry);
        else if (r1 < .3) place(flowerPick(), x, h, z, .5 + r2 * .5, ry);
      }
    }

    // ---- 几何原型(有机高模) ----
    const geos = {
      leafA: leafTreeGeo(11), leafB: leafTreeGeo(47), leafC: leafTreeGeo(83),
      pineA: pineGeo(21), pineB: pineGeo(55),
      icePine: icePineGeo(31),
      palm: palmGeo(15),
      rock: rockGeo(6), rockDark: rockGeo(61, '#3f3742', '#68596a'), rockSnow: rockGeo(77, '#9aa6b8', '#f2f7fd'),
      flowerA: flowerGeo(0), flowerB: flowerGeo(1),
      mushroom: mushroomGeo(8),
      deadTree: deadTreeGeo(9),
      berry: berryBushGeo(10),
    };
    const stdMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .88, metalness: 0 });
    const dsMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85, metalness: 0, side: THREE.DoubleSide });
    this.group = new THREE.Group();
    for (const key of KEYS) {
      const list = items[key];
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geos[key], key === 'palm' ? dsMat : stdMat, list.length);
      im.name = 'scatter_' + key;
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = !['flowerA', 'flowerB', 'mushroom'].includes(key);
      im.receiveShadow = true;
      im.instanceMatrix.needsUpdate = true;
      this.group.add(im);
    }
    scene.add(this.group);
  }
}

// ---- 有机几何构建器(噪声置换高模) ----
const _vn = new Noise2D(20260712);
function displace(geo, amp = .28, freq = 1.6, seed = 0) {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const n = _vn.get(v.x * freq + seed, v.z * freq + v.y * .7 + seed * 1.3)
            + .5 * _vn.get(v.y * freq * 2.3 + seed, (v.x + v.z) * freq * 1.7);
    const len = v.length() || 1;
    v.multiplyScalar(1 + (n / len) * amp);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}
function tintGrad(geo, cBottom, cTop, jitter = .06, seed = 1) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const bb = new THREE.Box3().setFromBufferAttribute(pos);
  const a = new THREE.Color(cBottom), b = new THREE.Color(cTop), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - bb.min.y) / Math.max(.001, bb.max.y - bb.min.y);
    c.copy(a).lerp(b, t);
    const j = (hash2(i, seed) - .5) * jitter * 2;
    col[i * 3] = c.r + j; col[i * 3 + 1] = c.g + j; col[i * 3 + 2] = c.b + j;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
function blob(r, x, y, z, seed, cA = '#3f8a46', cB = '#7ed072', amp = .3) {
  const g = new THREE.IcosahedronGeometry(r, 2);
  displace(g, r * amp, 1.5 / r, seed);
  g.scale(1, .88, 1);
  tintGrad(g, cA, cB, .05, seed);
  g.translate(x, y, z);
  return g;
}
function trunkGeo(h = 2.8, r0 = .34, r1 = .2, bend = .25, seed = 3, color = '#7a5940') {
  const g = new THREE.CylinderGeometry(r1, r0, h, 9, 5);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), t = Math.min(1, Math.max(0, (y + h / 2) / h));
    pos.setX(i, pos.getX(i) + Math.pow(t, 1.6) * bend + _vn.get(pos.getX(i) * 3 + seed, y * 2) * .05);
    pos.setZ(i, pos.getZ(i) + _vn.get(y * 2.2 + seed, pos.getZ(i) * 3) * .05);
  }
  g.computeVertexNormals();
  tintGrad(g, '#5d4030', color, .05, seed);
  g.translate(0, h / 2, 0);
  return g;
}
function leafTreeGeo(seed = 1) {
  const parts = [trunkGeo(2.9, .36, .19, .3, seed)];
  // 枝
  const br = new THREE.CylinderGeometry(.07, .13, 1.5, 6);
  br.rotateZ(.85); br.translate(.75, 2.65, .1);
  tintGrad(br, '#5d4030', '#7a5940', .04, seed);
  parts.push(br);
  // 冠层: 多球有机组合
  parts.push(blob(1.75, 0, 4.15, 0, seed, '#357a40', '#82d46e'));
  parts.push(blob(1.15, 1.35, 3.55, .35, seed + 9, '#3c8a48', '#8fdc78'));
  parts.push(blob(1.05, -1.2, 3.7, -.3, seed + 17, '#2f7038', '#74c866'));
  parts.push(blob(.9, .25, 5.25, -.55, seed + 31, '#3c8a48', '#96e080'));
  // 果实点缀
  for (let i = 0; i < 4; i++) {
    const f = new THREE.SphereGeometry(.09, 8, 6);
    const a = hash2(i, seed) * TAU2, rr = 1.15 + hash2(i, seed + 5) * .7;
    f.translate(Math.cos(a) * rr, 3.4 + hash2(i, seed + 8) * 1.4, Math.sin(a) * rr);
    tintGrad(f, '#e8485c', '#ff7a6a', 0, i);
    parts.push(f);
  }
  return mergeGeos(parts);
}
function pineGeo(seed = 2) {
  const parts = [trunkGeo(2.4, .3, .16, .1, seed, '#6a4634')];
  const layers = [[2.1, 2.5, 1.75], [3.3, 2.1, 1.4], [4.4, 1.7, 1.05], [5.35, 1.3, .7]];
  for (let li = 0; li < layers.length; li++) {
    const [y, h, r] = layers[li];
    const c = new THREE.ConeGeometry(r, h, 10, 3);
    const pos = c.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vy = pos.getY(i);
      const rim = 1 - Math.abs(vy) / (h / 2);
      pos.setY(i, vy + _vn.get(pos.getX(i) * 2.4 + seed + li, pos.getZ(i) * 2.4) * .3 * rim - rim * .18);
    }
    c.computeVertexNormals();
    tintGrad(c, '#2a6b3d', '#5fae62', .05, seed + li);
    c.translate(0, y, 0);
    parts.push(c);
  }
  return mergeGeos(parts);
}
function icePineGeo(seed = 4) {
  const g = pineGeo(seed);
  // 雪染: 顶部与上表面偏白
  const pos = g.attributes.position, col = g.attributes.color, norm = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const up = Math.max(0, norm.getY(i));
    const t = Math.min(1, up * .85 + Math.max(0, pos.getY(i) - 3.4) * .18);
    col.setXYZ(i,
      col.getX(i) * (1 - t) + .93 * t,
      col.getY(i) * (1 - t) + .96 * t,
      col.getZ(i) * (1 - t) + 1 * t);
  }
  return g;
}
function palmGeo(seed = 5) {
  const parts = [trunkGeo(4.6, .3, .17, .85, seed, '#9a7a54')];
  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.PlaneGeometry(3.4, .75, 7, 1);
    const pos = leaf.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v);
      const t = Math.min(1, Math.max(0, (x + 1.7) / 3.4));
      pos.setY(v, pos.getY(v) * (1 - t * .55) - Math.pow(t, 1.9) * 1.25);
      pos.setZ(v, Math.sin(t * Math.PI) * .12);
    }
    leaf.computeVertexNormals();
    tintGrad(leaf, '#2f7a3c', '#63c25e', .05, seed + i);
    leaf.translate(1.55, 0, 0);
    leaf.rotateY((i / 7) * TAU2 + hash2(i, seed) * .4);
    leaf.translate(.85 * .85, 4.55, 0);
    parts.push(leaf);
  }
  // 椰子
  for (let i = 0; i < 3; i++) {
    const c = new THREE.SphereGeometry(.16, 8, 6);
    const a = (i / 3) * TAU2;
    c.translate(.85 + Math.cos(a) * .3, 4.3, Math.sin(a) * .3);
    tintGrad(c, '#5d4a32', '#7a6244', 0, i);
    parts.push(c);
  }
  return mergeGeos(parts);
}
function rockGeo(seed = 6, cA = '#7d8494', cB = '#b8bfcc') {
  const g = new THREE.IcosahedronGeometry(1, 2);
  displace(g, .34, 1.4, seed);
  g.scale(1.15, .78, .95);
  tintGrad(g, cA, cB, .05, seed);
  return g;
}
function flowerGeo(seed = 7) {
  const parts = [];
  const stem = new THREE.CylinderGeometry(.02, .03, .5, 5);
  tintGrad(stem, '#3f8a46', '#6bb85e', 0, seed);
  stem.translate(0, .25, 0);
  parts.push(stem);
  const colors = [['#ff8fb8', '#ffd3e4'], ['#ffd76a', '#fff2c0'], ['#9fc0ff', '#e0ecff']][seed % 3];
  for (let i = 0; i < 5; i++) {
    const p = new THREE.SphereGeometry(.13, 7, 5);
    p.scale(1, .35, .72);
    const a = (i / 5) * TAU2;
    p.translate(Math.cos(a) * .16, .52, Math.sin(a) * .16);
    p.rotateY(-a);
    tintGrad(p, colors[0], colors[1], .03, seed + i);
    parts.push(p);
  }
  const core = new THREE.SphereGeometry(.07, 8, 6);
  core.translate(0, .54, 0);
  tintGrad(core, '#e8a020', '#ffd048', 0, seed);
  parts.push(core);
  return mergeGeos(parts);
}
function mushroomGeo(seed = 8) {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const sc = 1 - i * .3;
    const ox = (hash2(i, seed) - .5) * .5, oz = (hash2(i, seed + 3) - .5) * .5;
    const stemH = .5 * sc;
    const stem = new THREE.CylinderGeometry(.08 * sc, .12 * sc, stemH, 7);
    tintGrad(stem, '#cfc4e8', '#f0eaff', .03, seed + i);
    stem.translate(ox, stemH / 2, oz);
    parts.push(stem);
    const cap = new THREE.SphereGeometry(.3 * sc, 10, 7, 0, TAU2, 0, Math.PI / 2);
    displace(cap, .04, 6, seed + i);
    cap.scale(1, .75, 1);
    tintGrad(cap, '#7a5fd0', '#b89af0', .04, seed + i);
    cap.translate(ox, stemH, oz);
    parts.push(cap);
  }
  return mergeGeos(parts);
}
function deadTreeGeo(seed = 9) {
  const parts = [trunkGeo(2.8, .26, .1, .35, seed, '#4a3a34')];
  const b1 = new THREE.CylinderGeometry(.05, .1, 1.6, 6);
  b1.rotateZ(.8); b1.translate(.6, 2.3, 0);
  tintGrad(b1, '#3f322c', '#55443c', 0, seed);
  parts.push(b1);
  const b2 = new THREE.CylinderGeometry(.04, .08, 1.3, 6);
  b2.rotateZ(-.9); b2.rotateY(.7); b2.translate(-.5, 1.9, .2);
  tintGrad(b2, '#3f322c', '#55443c', 0, seed);
  parts.push(b2);
  return mergeGeos(parts);
}
function berryBushGeo(seed = 10) {
  const parts = [blob(.6, 0, .5, 0, seed, '#2f7a3c', '#5fb45c', .35)];
  for (let i = 0; i < 6; i++) {
    const b = new THREE.SphereGeometry(.09, 8, 6);
    const a = hash2(i, seed) * TAU2;
    b.translate(Math.cos(a) * .45, .45 + hash2(i, seed + 4) * .35, Math.sin(a) * .45);
    tintGrad(b, '#d83a5e', '#ff6b8a', 0, i);
    parts.push(b);
  }
  return mergeGeos(parts);
}
const TAU2 = Math.PI * 2;
function mergeGeos(geos) {
  // 简易合并(同材质, 兼容非索引几何)
  let total = 0, itotal = 0;
  for (const g of geos) {
    total += g.attributes.position.count;
    itotal += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(total * 3), norm = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  const col = new Float32Array(total * 3).fill(1);
  const idx = new Uint32Array(itotal);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    norm.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.attributes.color) col.set(g.attributes.color.array, vo * 3);
    const n = g.attributes.position.count;
    if (g.index) {
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
      io += gi.length;
    } else {
      for (let i = 0; i < n; i++) idx[io + i] = i + vo;
      io += n;
    }
    vo += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// ============ 远景山脉 ============
export class DistantScenery {
  constructor(scene) {
    const rnd = mulberry32(888);
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: '#7d93b8', roughness: 1, flatShading: true });
    const matFar = new THREE.MeshStandardMaterial({ color: '#93a9c8', roughness: 1, flatShading: true });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rnd() * .3;
      const r = 2100 + rnd() * 500;
      const h = 260 + rnd() * 340;
      const geo = new THREE.ConeGeometry(220 + rnd() * 260, h, 5 + (rnd() * 3 | 0));
      const m = new THREE.Mesh(geo, r > 2400 ? matFar : mat);
      m.position.set(Math.cos(a) * r, h * .32 - 40, Math.sin(a) * r);
      m.rotation.y = rnd() * Math.PI;
      group.add(m);
    }
    scene.add(group);
  }
}
