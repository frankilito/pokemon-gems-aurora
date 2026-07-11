// 植被与散布物：摇曳草地(实例化) / 树木 / 岩石 / 花丛 / 远景山脉
import * as THREE from 'three';
import { G, addUpdate } from '../core/engine.js';
import { getHeight, getPlaceHeight, getBiome, getSlope, WORLD } from './terrain.js';
import { hash2, mulberry32, clamp } from '../core/math.js';

const toon = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: .92, metalness: 0, ...opts });

// ============ 摇曳草 ============
export class GrassField {
  constructor(scene) {
    this.MAX = 22000;
    this.radius = 58;
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
    const step = .88;
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
    const items = { leafTrunk: [], leafBlob: [], leafBlob2: [], pineTrunk: [], pineCone: [], palmTrunk: [], palmLeaf: [], rock: [], rockDark: [], rockSnow: [], flower: [], mushroom: [], deadTree: [], berry: [], icePine: [] };

    const tmp = new THREE.Object3D();
    const place = (arr, x, y, z, s, ry, tilt = 0) => {
      tmp.position.set(x, y, z); tmp.scale.setScalar(s);
      tmp.rotation.set(tilt, ry, 0);
      tmp.updateMatrix();
      arr.push(tmp.matrix.clone());
    };

    // 采样散布
    const R = WORLD.radius + 30;
    for (let i = 0; i < 26000; i++) {
      const x = (rnd() * 2 - 1) * R, z = (rnd() * 2 - 1) * R;
      const b = getBiome(x, z);
      const h = getPlaceHeight(x, z);
      if (h < 2.2) continue;
      const slope = getSlope(x, z);
      const r1 = rnd(), r2 = rnd(), ry = rnd() * Math.PI * 2;
      const inTown = Math.hypot(x - WORLD.town.x, z - WORLD.town.z) < WORLD.town.r * .82;
      if (inTown) continue;
      if (b === 'forest') {
        if (r1 < .5 && slope < .6) { // 阔叶树
          const s = 1 + r2 * 1.15;
          place(items.leafTrunk, x, h, z, s, ry);
          place(items.leafBlob, x, h, z, s, ry);
          if (rnd() < .6) place(items.leafBlob2, x, h, z, s, ry);
          this.world.addCollider(x, z, 1.1 * s);
        } else if (r1 < .58) place(items.mushroom, x, h, z, .7 + r2 * .8, ry);
        else if (r1 < .8) place(items.flower, x, h, z, .8 + r2, ry);
      } else if (b === 'grass') {
        if (r1 < .045 && slope < .5) {
          const s = .9 + r2 * .9;
          place(items.leafTrunk, x, h, z, s, ry); place(items.leafBlob, x, h, z, s, ry);
          this.world.addCollider(x, z, 1.1 * s);
        }
        else if (r1 < .1) place(items.rock, x, h, z, .5 + r2 * 1.4, ry);
        else if (r1 < .3) place(items.flower, x, h, z, .8 + r2 * .9, ry);
        else if (r1 < .36) place(items.berry, x, h, z, .9 + r2 * .6, ry);
      } else if (b === 'snow' || b === 'temple') {
        if (r1 < .3 && slope < .55 && h < 110) {
          const s = 1 + r2 * 1.3;
          place(items.icePine, x, h, z, s, ry);
          this.world.addCollider(x, z, .9 * s);
        } else if (r1 < .5) place(items.rockSnow, x, h, z, .6 + r2 * 1.8, ry);
      } else if (b === 'volcano') {
        if (r1 < .3) place(items.rockDark, x, h, z, .6 + r2 * 2, ry);
        else if (r1 < .42) { place(items.deadTree, x, h, z, .8 + r2, ry); this.world.addCollider(x, z, .6); }
      } else if (b === 'cave') {
        if (r1 < .4) place(items.rockDark, x, h, z, .7 + r2 * 2.4, ry);
        else if (r1 < .62) place(items.mushroom, x, h, z, 1 + r2 * 1.6, ry);
      } else if (b === 'beach') {
        if (r1 < .06 && slope < .4) {
          const s = 1 + r2 * .7;
          place(items.palmTrunk, x, h, z, s, ry, (rnd() - .5) * .3);
          place(items.palmLeaf, x, h, z, s, ry);
          this.world.addCollider(x, z, .8 * s);
        } else if (r1 < .12) place(items.rock, x, h, z, .4 + r2, ry);
      } else if (b === 'lake') {
        if (r1 < .2 && h > 1.2) place(items.flower, x, h, z, .9 + r2, ry);
        else if (r1 < .26 && slope < .5 && h > 1.5) {
          const s = .9 + r2 * .8;
          place(items.leafTrunk, x, h, z, s, ry); place(items.leafBlob, x, h, z, s, ry);
          this.world.addCollider(x, z, s);
        }
      } else if (b === 'ruins') {
        if (r1 < .1) place(items.rock, x, h, z, .5 + r2, ry);
      }
      if ((b === 'pine' || b === 'grass') && r1 > .992 && slope < .5) { // 零星松树
        const s = 1.1 + r2;
        place(items.pineTrunk, x, h, z, s, ry); place(items.pineCone, x, h, z, s, ry);
        this.world.addCollider(x, z, .9 * s);
      }
    }

    // ---- 几何原型 ----
    const geos = {
      leafTrunk: new THREE.CylinderGeometry(.22, .34, 2.6, 7).translate(0, 1.3, 0),
      leafBlob: mergeBlobs([[0, 3.6, 0, 1.9], [1.1, 3.1, .3, 1.2], [-1, 3.2, -.4, 1.25]]),
      leafBlob2: mergeBlobs([[.2, 4.6, .1, 1.15], [-.7, 4.2, .5, .9]]),
      pineTrunk: new THREE.CylinderGeometry(.18, .3, 2.2, 6).translate(0, 1.1, 0),
      pineCone: mergeCones([[0, 2.2, 2.1, 1.6], [0, 3.4, 1.7, 1.25], [0, 4.5, 1.25, .95]]),
      icePine: mergeCones([[0, 1.8, 2.3, 1.5], [0, 3.1, 1.8, 1.15], [0, 4.2, 1.3, .85]]),
      palmTrunk: new THREE.CylinderGeometry(.16, .3, 4.4, 6).translate(0, 2.2, 0),
      palmLeaf: palmLeaves(),
      rock: new THREE.IcosahedronGeometry(1, 1).scale(1, .72, .85),
      rockDark: new THREE.IcosahedronGeometry(1, 1).scale(1.1, .8, .9),
      rockSnow: new THREE.IcosahedronGeometry(1, 1).scale(1, .66, .9),
      flower: flowerGeo(),
      mushroom: mushroomGeo(),
      deadTree: deadTreeGeo(),
      berry: new THREE.IcosahedronGeometry(.5, 1).scale(1, .8, 1).translate(0, .4, 0),
    };
    const mats = {
      leafTrunk: toon('#8a6242'), leafBlob: toon('#58b459'), leafBlob2: toon('#6ecb67'),
      pineTrunk: toon('#7a5238'), pineCone: toon('#3e8a52'),
      icePine: toon('#7fb89a'),
      palmTrunk: toon('#a3805c'), palmLeaf: toon('#4fae5c', { side: THREE.DoubleSide }),
      rock: toon('#9aa1ad'), rockDark: toon('#4e4550'), rockSnow: toon('#e8f1fa'),
      flower: toon('#ff9fc0', { side: THREE.DoubleSide }), mushroom: toon('#b9a6e8', { emissive: '#4a2a8a', emissiveIntensity: .4 }),
      deadTree: toon('#4a3a38'), berry: toon('#e85c7a'),
    };
    this.group = new THREE.Group();
    for (const key in items) {
      const list = items[key];
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geos[key], mats[key], list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = key !== 'flower' && key !== 'mushroom';
      im.receiveShadow = false;
      im.instanceMatrix.needsUpdate = true;
      this.group.add(im);
    }
    scene.add(this.group);
  }
}

function mergeBlobs(list) {
  const geos = list.map(([x, y, z, s]) => new THREE.IcosahedronGeometry(s, 1).translate(x, y, z));
  return mergeGeos(geos);
}
function mergeCones(list) {
  const geos = list.map(([x, y, h, r]) => new THREE.ConeGeometry(r, h, 8).translate(x, y, 0));
  return mergeGeos(geos);
}
function palmLeaves() {
  const geos = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.PlaneGeometry(3.2, .8, 4, 1);
    const pos = g.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v);
      pos.setY(v, pos.getY(v) - Math.pow(Math.abs(x) / 1.6, 2) * .9);
    }
    g.translate(1.5, 4.35, 0);
    g.rotateY((i / 6) * Math.PI * 2);
    geos.push(g);
  }
  return mergeGeos(geos);
}
function flowerGeo() {
  const a = new THREE.PlaneGeometry(.55, .55).rotateX(-Math.PI / 2.6).translate(0, .42, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  return mergeGeos([a, b]);
}
function mushroomGeo() {
  return mergeGeos([
    new THREE.CylinderGeometry(.09, .13, .5, 6).translate(0, .25, 0),
    new THREE.SphereGeometry(.32, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, .5, 0),
  ]);
}
function deadTreeGeo() {
  return mergeGeos([
    new THREE.CylinderGeometry(.12, .22, 2.6, 5).translate(0, 1.3, 0),
    new THREE.CylinderGeometry(.06, .1, 1.4, 5).rotateZ(.7).translate(.5, 2.1, 0),
    new THREE.CylinderGeometry(.05, .09, 1.2, 5).rotateZ(-.8).translate(-.45, 1.7, .1),
  ]);
}
function mergeGeos(geos) {
  // 简易合并(同材质, 兼容非索引几何)
  let total = 0, itotal = 0;
  for (const g of geos) {
    total += g.attributes.position.count;
    itotal += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(total * 3), norm = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  const idx = new Uint32Array(itotal);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    norm.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
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
