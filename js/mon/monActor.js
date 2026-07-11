// 精灵世界演员：GLB模型 + 动画匹配 + 程序化兜底 + 野外AI
import * as THREE from 'three';
import { G, emit } from '../core/engine.js';
import { loadMonProto, cloneMon, applyShinyTint } from '../core/assets.js';
import { getHeight, getBiome } from '../world/world.js';
import { clamp, lerp, damp, dampAngle, TAU } from '../core/math.js';

// 飞行悬浮类(常见者)
const FLOATERS = new Set([6, 12, 15, 16, 17, 18, 21, 22, 41, 42, 49, 64, 65, 92, 93, 94, 100, 101, 109, 110, 124, 137, 144, 145, 146, 149, 150, 151, 39, 92]);
const WATER_ONLY = new Set([72, 73, 86, 87, 90, 91, 98, 99, 116, 117, 118, 119, 120, 121, 129, 130, 131, 134, 138, 139, 140, 141]);
export const isFloater = id => FLOATERS.has(id);
export const isWaterOnly = id => WATER_ONLY.has(id);

// 蛇形滑行者
const SERPENTS = new Set([23, 24, 95, 147, 148, 149]);

// ---- 程序化步态动画(无骨骼动画模型的通用方案) ----
class ProcAnim {
  constructor(actor) {
    this.a = actor;
    const id = actor.mon.id;
    const h = actor.scaleH;
    if (SERPENTS.has(id)) this.gait = 'slither';
    else if (actor.hover) this.gait = 'hover';
    else if (actor.aquatic) this.gait = 'swim';
    else if (h < .62) this.gait = 'hop';
    else if (h < 1.7) this.gait = 'trot';
    else this.gait = 'lumber';
    this.phase = Math.random() * TAU;
    this.lookT = 2 + Math.random() * 4;
    this.lookYaw = 0;
    this.fx = { lunge: 0, hit: 0, faint: 0, spawn: 0 };
  }
  trigger(kind) { this.fx[kind] = .0001; }
  update(dt, speed) {
    const A = this.a, inner = A.inner, fx = this.fx;
    const moving = speed > .15;
    const h = A.scaleH;
    this.phase += dt * (this.gait === 'hop' ? 9 : this.gait === 'lumber' ? 4.2 : 6.5) * clamp(speed / 1.6 + .2, .2, 2.2);
    const p = this.phase;
    let py = 0, rx = 0, rz = 0, ry = 0, sy = 1, sxz = 1;

    // 呼吸(常驻)
    const breath = Math.sin(G.time * 2.2 + this.phase) * .018;
    sy += breath; sxz -= breath * .5;

    if (moving) {
      switch (this.gait) {
        case 'hop': {
          const hop = Math.abs(Math.sin(p));
          py = hop * .16 * h;
          const land = 1 - Math.abs(Math.sin(p));
          sy -= land * .12; sxz += land * .08;
          rx = Math.cos(p) * .1;
          break;
        }
        case 'trot':
          py = Math.abs(Math.sin(p)) * .05 * h;
          rx = Math.sin(p * 2) * .045;
          rz = Math.sin(p) * .06;
          break;
        case 'lumber':
          py = Math.abs(Math.sin(p * .5)) * .04 * h;
          rz = Math.sin(p * .5) * .075;
          rx = Math.sin(p) * .03;
          break;
        case 'slither':
          ry = Math.sin(p) * .3;
          rz = Math.sin(p) * .06;
          break;
        case 'swim':
          ry = Math.sin(p * .8) * .18;
          rz = Math.sin(p * .8 + 1) * .1;
          break;
        case 'hover':
          rx = .12; rz = Math.sin(p * .6) * .08;
          break;
      }
    } else {
      // 待机张望
      this.lookT -= dt;
      if (this.lookT <= 0) { this.lookT = 2.5 + Math.random() * 4; this.lookYaw = (Math.random() - .5) * .9; }
      if (this.gait === 'hop' && Math.random() < dt * .25) this.fx.spawn = .0001; // 原地小跳
    }
    ry += this.lookYaw * (moving ? 0 : 1);
    this.lookYaw *= Math.exp(-dt * .8);

    // 攻击突进
    if (fx.lunge > 0) {
      fx.lunge = Math.min(1, fx.lunge + dt * 3.2);
      const t = fx.lunge;
      const arc = Math.sin(t * Math.PI);
      inner.position.z = arc * .8 * h;
      sy += arc * .12; sxz += arc * .06;
      if (t >= 1) fx.lunge = 0;
    } else if (fx.hit <= 0) inner.position.z = 0;
    // 受击
    if (fx.hit > 0) {
      fx.hit = Math.min(1, fx.hit + dt * 3.5);
      const t = fx.hit;
      const k = Math.sin(t * Math.PI);
      inner.position.z = -k * .3 * h;
      rz += Math.sin(t * 40) * .1 * (1 - t);
      if (t >= 1) fx.hit = 0;
    }
    // 倒下
    if (fx.faint > 0) {
      fx.faint = Math.min(1, fx.faint + dt * 1.4);
      const t = fx.faint;
      rz = -1.5 * easeOutT(t);
      py -= .12 * t * h;
    }
    // 原地小跳
    if (fx.spawn > 0) {
      fx.spawn = Math.min(1, fx.spawn + dt * 4);
      py += Math.sin(fx.spawn * Math.PI) * .1 * h;
      if (fx.spawn >= 1) fx.spawn = 0;
    }

    inner.position.y = py;
    inner.rotation.set(rx, ry, rz);
    inner.scale.set(sxz, sy, sxz);
  }
}
const easeOutT = t => 1 - Math.pow(1 - t, 3);

export class MonActor {
  constructor(pokemon, opts = {}) {
    this.mon = pokemon;               // Pokemon 数据实例
    this.group = new THREE.Group();   // 世界节点(位置/朝向)
    this.inner = new THREE.Group();   // 模型容器(程序化动画作用于此)
    this.group.add(this.inner);
    this.pos = this.group.position;
    this.yaw = Math.random() * TAU;
    this.loaded = false;
    this.mixer = null;
    this.actions = {};
    this.curAction = null;
    this.hover = isFloater(pokemon.id) ? .6 + Math.random() * .5 : 0;
    this.aquatic = isWaterOnly(pokemon.id);
    this.dead = false;
    this.scaleH = 1;
    this.flashT = 0;
    this.mats = [];
    // AI
    this.state = opts.behavior === 'static' ? 'guard' : 'idle'; // idle wander flee chase battle guard
    this.temperament = opts.temperament ?? temperamentOf(pokemon.id);
    this.anchor = opts.anchor ?? null;   // 群落锚点
    this.home = new THREE.Vector3();
    this.stateT = Math.random() * 3;
    this.speed = 0;
    this.wishDir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.noticed = false;

    this.load();
  }

  async load() {
    const proto = await loadMonProto(this.mon.id, this.mon.shiny);
    if (!proto || this.dead) { this.placeholder(); return; }
    const inst = cloneMon(proto);
    if (proto.fallbackTint) applyShinyTint(inst);
    // 中心对齐(水平) + 底部贴地
    const box = new THREE.Box3().setFromObject(inst);
    inst.position.x = -(box.min.x + box.max.x) / 2;
    inst.position.z = -(box.min.z + box.max.z) / 2;
    inst.position.y = -box.min.y;
    this.inner.add(inst);
    this.model = inst;
    this.scaleH = proto.targetH;
    // 动画
    if (proto.clips.length) {
      this.mixer = new THREE.AnimationMixer(inst);
      for (const role of ['idle', 'walk', 'run', 'attack', 'hit', 'faint', 'fly', 'sleep', 'jump']) {
        const clip = proto.roles[role];
        if (clip) this.actions[role] = this.mixer.clipAction(clip);
      }
      this.play('idle', 0);
    }
    this.loaded = true;
    this.proc = new ProcAnim(this);
    // 材质收集(受击闪红)
    this.mats = [];
    inst.traverse(o => { if (o.isMesh && o.material) { o.material = o.material.clone(); this.mats.push(o.material); } });
    if (this.mon.shiny) this.addSparkles();
  }

  placeholder() {
    // 模型缺失兜底: 发光球
    const m = new THREE.Mesh(new THREE.SphereGeometry(.4, 12, 10), new THREE.MeshStandardMaterial({ color: '#c8b6ff', emissive: '#6a4a9a', emissiveIntensity: .5 }));
    m.position.y = .4;
    this.inner.add(m);
    this.loaded = true;
  }

  addSparkles() {
    const geo = new THREE.BufferGeometry();
    const N = 14;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * TAU, r = .5 + Math.random() * this.scaleH * .7;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.random() * this.scaleH; pos[i * 3 + 2] = Math.sin(a) * r;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sparkles = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xfff2a8, size: .12, transparent: true, opacity: .95 }));
    this.group.add(this.sparkles);
  }

  play(role, fade = .25) {
    if (!this.mixer) return;
    let a = this.actions[role]
      || (role === 'run' && this.actions.walk) || (role === 'walk' && this.actions.run)
      || (role === 'fly' && (this.actions.idle)) || this.actions.idle;
    if (!a || a === this.curAction) return;
    a.reset();
    if (role === 'faint') { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; }
    else a.setLoop(THREE.LoopRepeat);
    a.fadeIn(fade).play();
    if (this.curAction) this.curAction.fadeOut(fade);
    this.curAction = a;
    this._role = role;
  }

  faceTo(target, rate, dt) {
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
    if (dx * dx + dz * dz < .01) return;
    this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), rate, dt);
  }

  // ---- 每帧 ----
  update(dt) {
    if (this.dead) return;
    this.mixer?.update(dt);
    this.stateT -= dt;

    if (this.state !== 'battle' && this.state !== 'captured') this.updateAI(dt);

    // 位移
    if (this.speed > .01) {
      this.pos.x += this.wishDir.x * this.speed * dt;
      this.pos.z += this.wishDir.z * this.speed * dt;
      G.world.resolve(this.pos, .5);
    }
    // 贴地/悬浮/水面
    const gh = getHeight(this.pos.x, this.pos.z);
    let targetY;
    if (this.aquatic) {
      targetY = Math.min(gh, -.3) + Math.sin(G.time * 1.7 + this.yaw) * .12;
      if (gh > 0) targetY = gh; // 搁浅安全
    } else {
      targetY = gh + this.hover + (this.hover ? Math.sin(G.time * 2.2 + this.yaw * 3) * .18 : 0);
    }
    this.pos.y = damp(this.pos.y, targetY, 10, dt);
    this.group.rotation.y = this.yaw;

    // 程序化动画(无剪辑时全权, 有剪辑时仅特效层)
    if (this.proc) {
      if (!this.mixer) this.proc.update(dt, this.speed);
      else {
        // 有骨骼动画: 仅保留 lunge/hit/faint 位移特效
        const fx = this.proc.fx;
        if (fx.lunge > 0 || fx.hit > 0 || fx.faint > 0) this.proc.update(dt, 0);
      }
    }
    // 受击红闪
    if (this.flashT > 0) {
      this.flashT -= dt * 3;
      const k = Math.max(0, this.flashT);
      for (const m of this.mats) if (m.emissive) m.emissive.setRGB(k, k * .15, k * .15);
    }
    // 闪光粒子
    if (this.sparkles) {
      this.sparkles.rotation.y += dt * .8;
      this.sparkles.material.opacity = .6 + Math.sin(G.time * 5) * .35;
    }
  }

  updateAI(dt) {
    const P = G.player;
    const pd = P ? Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z) : 999;

    switch (this.state) {
      case 'idle':
        this.speed = damp(this.speed, 0, 8, dt);
        if (this._role !== 'idle') this.play('idle');
        if (this.stateT <= 0) {
          this.state = 'wander'; this.stateT = 1.5 + Math.random() * 3.5;
          const a = this.anchor;
          if (a && this.pos.distanceTo(a) > 14) { // 回归群落
            this.wishDir.set(a.x - this.pos.x, 0, a.z - this.pos.z).normalize();
          } else {
            const ang = Math.random() * TAU;
            this.wishDir.set(Math.sin(ang), 0, Math.cos(ang));
          }
        }
        break;
      case 'wander': {
        const spd = 1.1 + this.scaleH * .35;
        this.speed = damp(this.speed, spd, 6, dt);
        this.yaw = dampAngle(this.yaw, Math.atan2(this.wishDir.x, this.wishDir.z), 6, dt);
        if (this._role !== 'walk') this.play('walk');
        // 避免走进深水/出生态
        const nx = this.pos.x + this.wishDir.x * 3, nz = this.pos.z + this.wishDir.z * 3;
        if (!this.aquatic && getHeight(nx, nz) < .3) this.stateT = 0;
        if (this.aquatic && getHeight(nx, nz) > -.4) this.stateT = 0;
        if (this.stateT <= 0) { this.state = 'idle'; this.stateT = 1 + Math.random() * 4; }
        break;
      }
      case 'flee': {
        if (!P || pd > 26) { this.state = 'idle'; this.stateT = 2; break; }
        this.wishDir.set(this.pos.x - P.pos.x, 0, this.pos.z - P.pos.z).normalize();
        this.yaw = dampAngle(this.yaw, Math.atan2(this.wishDir.x, this.wishDir.z), 10, dt);
        this.speed = damp(this.speed, 4.5 + this.scaleH, 8, dt);
        if (this._role !== 'run') this.play('run');
        break;
      }
      case 'chase': {
        if (!P || pd > 22 || G.state !== 'roam') { this.state = 'idle'; this.stateT = 2; break; }
        this.wishDir.set(P.pos.x - this.pos.x, 0, P.pos.z - this.pos.z).normalize();
        this.yaw = dampAngle(this.yaw, Math.atan2(this.wishDir.x, this.wishDir.z), 8, dt);
        this.speed = damp(this.speed, 3.6 + this.scaleH * .6, 7, dt);
        if (this._role !== 'run') this.play('run');
        if (pd < 1.6 + this.scaleH * .5) {
          this.speed = 0;
          emit('wildAttack', this);   // 触发遭遇战
          this.state = 'battle';
        }
        break;
      }
      case 'guard': // 静态传说
        this.speed = 0;
        if (P && pd < 14) this.faceTo(P.pos, 4, dt);
        break;
    }

    // 感知玩家
    if (P && this.state !== 'flee' && this.state !== 'chase' && this.state !== 'guard' && G.state === 'roam') {
      const sneak = P.state === 'walk' || P.speed < 4.6;
      const range = sneak ? 5.5 : 10;
      if (pd < range) {
        if (!this.noticed) {
          this.noticed = true;
          emit('monNotice', this);
        }
        if (this.temperament === 'skittish') this.state = 'flee';
        else if (this.temperament === 'aggressive') this.state = 'chase';
        else if (pd < 2.2) this.state = 'flee';
      } else if (pd > 14) this.noticed = false;
    }
  }

  // 战斗/捕获姿态控制
  battleIdle() { this.play('idle'); this.speed = 0; }
  attackAnim() {
    if (this.actions.attack) {
      const a = this.actions.attack;
      a.reset().setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false;
      a.fadeIn(.1).play();
      setTimeout(() => { a.fadeOut(.3); this.actions.idle?.reset().fadeIn(.3).play(); }, Math.min(1400, (a.getClip().duration * 1000) || 800));
    } else this.proc?.trigger('lunge');
  }
  hitAnim() {
    this.flashT = 1;
    if (this.actions.hit) {
      const a = this.actions.hit;
      a.reset().setLoop(THREE.LoopOnce, 1);
      a.fadeIn(.08).play();
      setTimeout(() => { a.fadeOut(.25); this.actions.idle?.reset().fadeIn(.25).play(); }, 600);
    } else this.proc?.trigger('hit');
  }
  faintAnim() {
    if (this.actions.faint) this.play('faint', .15);
    else this.proc?.trigger('faint');
  }

  dispose(scene) {
    this.dead = true;
    scene.remove(this.group);
    this.group.traverse(o => { if (o.isMesh) { o.geometry?.dispose?.(); } });
  }
}

function temperamentOf(id) {
  const sp = G.dex.species[id - 1];
  const aggressive = new Set([23, 24, 27, 28, 41, 42, 56, 57, 66, 67, 68, 74, 75, 76, 95, 104, 105, 111, 112, 123, 126, 127, 130, 141, 142, 149, 150, 33, 34, 58, 59]);
  const skittish = new Set([10, 13, 16, 19, 21, 25, 29, 32, 37, 39, 43, 46, 48, 50, 52, 54, 60, 63, 69, 79, 83, 84, 86, 90, 96, 98, 100, 102, 109, 114, 116, 118, 120, 122, 124, 129, 132, 133, 137, 147]);
  if (aggressive.has(id)) return 'aggressive';
  if (skittish.has(id)) return 'skittish';
  if (sp?.legendary) return 'aggressive';
  return 'neutral';
}
