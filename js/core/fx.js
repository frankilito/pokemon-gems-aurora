// 特效库：粒子系统 + 精灵球 + 捕捉/进化/战斗特效
import * as THREE from 'three';
import { G, addUpdate } from '../core/engine.js';
import { clamp, lerp, TAU, easeOut } from '../core/math.js';

// ---------- 通用粒子 ----------
const MAXP = 2600;
export class FXManager {
  constructor(scene) {
    this.parts = [];
    const geo = new THREE.BufferGeometry();
    this.posArr = new Float32Array(MAXP * 3);
    this.colArr = new Float32Array(MAXP * 3);
    this.sizeArr = new Float32Array(MAXP);
    geo.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colArr, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizeArr, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {},
      vertexShader: `
        attribute float size; attribute vec3 color; varying vec3 vC;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * (240.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        varying vec3 vC;
        void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.12, d);
          gl_FragColor = vec4(vC, a); }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.tweens = new Set();
    addUpdate(dt => this.update(dt));
  }

  spawn(o) {
    if (this.parts.length >= MAXP) this.parts.shift();
    this.parts.push({
      x: o.x, y: o.y, z: o.z,
      vx: o.vx ?? 0, vy: o.vy ?? 0, vz: o.vz ?? 0,
      life: o.life ?? 1, age: 0,
      size: o.size ?? .1, endSize: o.endSize ?? o.size ?? .1,
      r: o.r ?? 1, g: o.g ?? 1, b: o.b ?? 1,
      grav: o.grav ?? 0, drag: o.drag ?? 0,
      swirl: o.swirl ?? 0, cx: o.cx, cy: o.cy, cz: o.cz,
    });
  }
  burst(pos, n, opt = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, e = (Math.random() - .3) * Math.PI;
      const sp = (opt.speed ?? 3) * (0.4 + Math.random() * .8);
      const c = opt.colors ? opt.colors[Math.random() * opt.colors.length | 0] : [1, .9, .4];
      this.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + (opt.up ?? 1.5), vz: Math.sin(a) * Math.cos(e) * sp,
        life: (opt.life ?? .9) * (0.6 + Math.random() * .7),
        size: (opt.size ?? .14) * (0.7 + Math.random() * .6), endSize: .01,
        r: c[0], g: c[1], b: c[2],
        grav: opt.grav ?? -4, drag: opt.drag ?? 1.5,
      });
    }
  }
  tween(fn) { const t = { fn, age: 0 }; this.tweens.add(t); return t; }

  update(dt) {
    const P = this.parts;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.age += dt;
      if (p.age >= p.life) { P.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr; p.vy *= dr; p.vz *= dr;
      if (p.swirl) {
        const dx = p.x - p.cx, dz = p.z - p.cz;
        p.vx += -dz * p.swirl * dt; p.vz += dx * p.swirl * dt;
        p.vx += -dx * p.swirl * .6 * dt; p.vz += -dz * p.swirl * .6 * dt;
        p.vy += (p.cy - p.y) * p.swirl * .5 * dt;
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
    for (let i = 0; i < MAXP; i++) {
      if (i < P.length) {
        const p = P[i], k = 1 - p.age / p.life;
        this.posArr[i * 3] = p.x; this.posArr[i * 3 + 1] = p.y; this.posArr[i * 3 + 2] = p.z;
        this.colArr[i * 3] = p.r * k; this.colArr[i * 3 + 1] = p.g * k; this.colArr[i * 3 + 2] = p.b * k;
        this.sizeArr[i] = lerp(p.endSize, p.size, k);
      } else this.sizeArr[i] = 0;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.geometry.attributes.size.needsUpdate = true;

    for (const t of [...this.tweens]) {
      t.age += dt;
      if (t.fn(t.age, dt) === false) this.tweens.delete(t);
    }
  }
}

// ---------- 精灵球 ----------
const BALL_COLORS = {
  'poke-ball': ['#e8404f', '#f5f6fa'], 'great-ball': ['#3d7de0', '#f5f6fa'],
  'ultra-ball': ['#2b2b33', '#ffd76a'], 'heavy-ball': ['#5a6474', '#c9d2e0'],
};
export function buildBall(kind = 'poke-ball', r = .12) {
  const [top, bottom] = BALL_COLORS[kind] || BALL_COLORS['poke-ball'];
  const g = new THREE.Group();
  const up = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 10, 0, TAU, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: top, roughness: .35, metalness: .1 }));
  const dn = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 10, 0, TAU, Math.PI / 2, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: bottom, roughness: .4 }));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.005, r * 1.005, r * .16, 20),
    new THREE.MeshStandardMaterial({ color: '#22242e', roughness: .5 }));
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(r * .3, r * .3, r * .18, 12),
    new THREE.MeshStandardMaterial({ color: '#f2f4f8', roughness: .3 }));
  btn.rotation.x = Math.PI / 2;
  btn.position.z = r * .95;
  g.add(up, dn, band, btn);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ---------- 高级特效 ----------
export const FX = {
  mgr: null,
  init(scene) { this.mgr = new FXManager(scene); },

  // 捕捉红光吸入
  captureBeam(fromBall, actor, done) {
    const m = this.mgr;
    const start = actor.pos.clone().add(new THREE.Vector3(0, actor.scaleH * .5, 0));
    const dur = .55;
    m.tween((age, dt) => {
      const t = clamp(age / dur, 0, 1);
      // 红光粒子流向球
      for (let i = 0; i < 6; i++) {
        const k = Math.random();
        m.spawn({
          x: lerp(start.x, fromBall.x, k), y: lerp(start.y, fromBall.y, k), z: lerp(start.z, fromBall.z, k),
          vx: 0, vy: 0, vz: 0, life: .18, size: .16, r: 1, g: .25, b: .3,
        });
      }
      // 模型缩入
      const s = 1 - easeOut(t);
      actor.group.scale.setScalar(Math.max(.001, s));
      if (t >= 1) { done?.(); return false; }
    });
  },
  // 放出白光
  releaseFlash(pos, actor) {
    const m = this.mgr;
    m.burst(pos, 26, { colors: [[1, 1, 1], [.7, .9, 1]], speed: 2.4, size: .18, life: .5, grav: 0 });
    if (actor) {
      actor.group.scale.setScalar(.001);
      m.tween(age => {
        const t = clamp(age / .4, 0, 1);
        actor.group.scale.setScalar(easeOut(t));
        return t < 1 ? undefined : false;
      });
    }
  },
  // 捕获成功星星
  catchStars(pos) {
    this.mgr.burst(pos, 22, { colors: [[1, .95, .4], [1, .8, .2], [1, 1, .8]], speed: 2.6, up: 2.4, size: .2, life: 1.1, grav: -3 });
    const m = this.mgr;
    // 环形冲击
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * TAU;
      m.spawn({ x: pos.x, y: pos.y + .1, z: pos.z, vx: Math.cos(a) * 3.2, vy: .4, vz: Math.sin(a) * 3.2, life: .5, size: .12, r: 1, g: .9, b: .5, drag: 2 });
    }
  },
  // 挣脱爆开
  breakOut(pos) {
    this.mgr.burst(pos, 30, { colors: [[1, 1, 1], [1, .6, .5]], speed: 4, size: .16, life: .55, grav: -2 });
  },
  // 命中火花
  hitSpark(pos, eff = 1) {
    const colors = eff > 1.5 ? [[1, .5, .2], [1, .8, .3]] : eff < .9 ? [[.6, .6, .7]] : [[1, .9, .5], [1, .7, .4]];
    this.mgr.burst(pos, eff > 1.5 ? 30 : 16, { colors, speed: 3.4, size: .17, life: .5, grav: -3 });
  },
  // 升级光柱
  levelUp(actor) {
    const m = this.mgr, pos = actor.pos;
    m.tween((age, dt) => {
      const t = age / .9;
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * TAU, r = .5 + Math.random() * .4;
        m.spawn({
          x: pos.x + Math.cos(a) * r, y: pos.y + .1, z: pos.z + Math.sin(a) * r,
          vx: 0, vy: 2.6 + Math.random(), vz: 0, life: .8, size: .13, r: .6, g: 1, b: .7, drag: .5,
        });
      }
      return t < 1 ? undefined : false;
    });
  },
  // 进化白光仪式
  evolution(actor, onPeak, onEnd) {
    const m = this.mgr;
    const pos = actor.pos.clone().add(new THREE.Vector3(0, actor.scaleH * .5, 0));
    // 白化材质
    const whites = [];
    actor.group.traverse(o => {
      if (o.isMesh && o.material) {
        whites.push([o, o.material]);
      }
    });
    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    let peaked = false;
    m.tween((age, dt) => {
      const t = age / 3.4;
      // 螺旋粒子
      for (let i = 0; i < 8; i++) {
        const a = age * 5 + i;
        const r = 1.1 - (age % .9) * .9;
        m.spawn({
          x: pos.x + Math.cos(a) * r, y: pos.y + ((age * .8 + i * .1) % 1.4) - .6, z: pos.z + Math.sin(a) * r,
          vx: 0, vy: .5, vz: 0, life: .4, size: .15, r: 1, g: 1, b: 1,
          swirl: 3, cx: pos.x, cy: pos.y, cz: pos.z,
        });
      }
      // 脉冲缩放
      const pulse = 1 + Math.sin(age * (4 + t * 10)) * .08 * (1 - t * .5);
      actor.inner.scale.setScalar(pulse);
      if (t > .25 && whites.length && whites[0][0].material !== whiteMat) {
        for (const [o] of whites) o.material = whiteMat;
      }
      if (t >= .78 && !peaked) {
        peaked = true;
        onPeak?.();  // 此刻换模型
        m.burst(pos, 60, { colors: [[1, 1, 1], [.8, .95, 1], [1, .95, .6]], speed: 5, size: .22, life: 1.2, grav: -1 });
      }
      if (t >= 1) {
        for (const [o, orig] of whites) if (o.material === whiteMat) o.material = orig;
        actor.inner.scale.setScalar(1);
        onEnd?.();
        return false;
      }
    });
  },
  // 落草窸窣
  grassPoof(pos) {
    this.mgr.burst(pos, 6, { colors: [[.5, .9, .4]], speed: 1.2, size: .1, life: .5, grav: -1 });
  },
  splash(pos) {
    this.mgr.burst(pos, 8, { colors: [[.6, .8, 1]], speed: 1.6, up: 2, size: .12, life: .5, grav: -6 });
  },
  // 传送门/治疗光环
  healRing(pos) {
    const m = this.mgr;
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * TAU;
      m.spawn({ x: pos.x + Math.cos(a) * .8, y: pos.y + .05, z: pos.z + Math.sin(a) * .8, vx: 0, vy: 1.6, vz: 0, life: 1, size: .13, r: 1, g: .6, b: .8, drag: .4 });
    }
  },
};
