// 真人化身：ReadyPlayerMe 模型 + 动画库骨骼动画 + 程序化叠加(投掷/攀爬)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { G } from '../core/engine.js';
import { clamp, lerp, damp, dampAngle, TAU } from '../core/math.js';
import { buildGlider } from './trainerModel.js';

const loader = new GLTFLoader();
const cache = { avatars: new Map(), clips: new Map() };

const CLIP_FILES = {
  m: {
    idle: 'm_idle', idleVar1: 'm_idle_var1', idleVar2: 'm_idle_var2',
    walk: 'm_walk', run: 'm_jog', sprint: 'm_run',
    jump: 'm_jump', fall: 'm_fall', crouch: 'm_crouchwalk',
    talk1: 'm_talk1', talk2: 'm_talk2', dance: 'm_dance',
  },
  f: {
    idle: 'f_idle', idleVar1: 'f_idle_var1', idleVar2: 'f_idle_var1',
    walk: 'f_walk', run: 'f_jog', sprint: 'f_jog',
    jump: 'm_jump', fall: 'm_fall', crouch: 'm_crouchwalk',
    talk1: 'f_talk1', talk2: 'f_talk2', dance: 'f_dance',
  },
};

async function loadAvatar(gender) {
  if (!cache.avatars.has(gender)) {
    cache.avatars.set(gender, loader.loadAsync(`assets/models/human/avatar_${gender}.glb`).then(g => g.scene));
  }
  return cache.avatars.get(gender);
}
async function loadClip(file) {
  if (!cache.clips.has(file)) {
    cache.clips.set(file, loader.loadAsync(`assets/models/human/${file}.glb`)
      .then(g => g.animations[0] ?? null).catch(() => null));
  }
  return cache.clips.get(file);
}

export class HumanModel {
  constructor(opts = {}) {
    this.root = new THREE.Group();
    this.root.name = 'human';
    this.opts = opts;
    this.ready = false;
    this.state = 'idle';
    this.mixer = null;
    this.actions = {};
    this.cur = null;
    this.idleT = 5 + Math.random() * 8;
    this.glider = buildGlider();
    this.glider.visible = false;
    this.root.add(this.glider);
    this.bones = {};
    this.throwBlend = 0;
    this.load();
  }

  async load() {
    const gender = this.opts.gender ?? 'm';
    try {
      const proto = await loadAvatar(gender);
      const inst = SkeletonUtils.clone(proto);
      // 尺寸: RPM ≈1.8m → 1.68m 更贴近少年主角
      const scale = (this.opts.height ?? 1.68) / 1.8;
      inst.scale.setScalar(scale);
      inst.traverse(o => {
        if (o.isMesh || o.isSkinnedMesh) {
          o.castShadow = true;
          o.frustumCulled = false;
          if (this.opts.tint && o.material) {
            o.material = o.material.clone();
            o.material.color = new THREE.Color(this.opts.tint);
          }
          if (o.material?.map) o.material.map.anisotropy = 8;
        }
        if (o.isBone) this.bones[o.name] = o;
      });
      this.root.add(inst);
      this.inst = inst;
      this.mixer = new THREE.AnimationMixer(inst);
      const files = CLIP_FILES[gender];
      const entries = await Promise.all(Object.entries(files).map(async ([role, f]) => [role, await loadClip(f)]));
      for (const [role, clip] of entries) {
        if (!clip) continue;
        const a = this.mixer.clipAction(clip);
        a.setLoop(THREE.LoopRepeat);
        this.actions[role] = a;
      }
      // 单次动作
      for (const r of ['jump', 'idleVar1', 'idleVar2', 'talk1', 'talk2']) {
        if (this.actions[r]) { this.actions[r].setLoop(THREE.LoopOnce); this.actions[r].clampWhenFinished = false; }
      }
      this.play('idle', 0);
      this.ready = true;
    } catch (e) {
      console.error('[human] 加载失败', e);
    }
  }

  play(role, fade = .22, timeScale = 1) {
    const a = this.actions[role] ?? this.actions.idle;
    if (!a) return;
    if (a === this.cur) { a.timeScale = timeScale; return; }
    a.reset().fadeIn(fade).play();
    a.timeScale = timeScale;
    if (this.cur) this.cur.fadeOut(fade);
    this.cur = a;
    this._role = role;
  }

  update(dt, state, opt = {}) {
    this.state = state;
    if (!this.mixer) return;
    const spd = opt.speed ?? 0;

    switch (state) {
      case 'idle': {
        // 偶发变奏
        this.idleT -= dt;
        if (this._role !== 'idle' && this._role !== 'idleVar' && this._role !== 'talk') this.play('idle');
        if (this.idleT <= 0) {
          this.idleT = 7 + Math.random() * 9;
          const v = Math.random() < .5 ? 'idleVar1' : 'idleVar2';
          if (this.actions[v]) {
            this.play(v, .3);
            this._role = 'idleVar';
            const dur = (this.actions[v].getClip ? this.actions[v].getClip() : this.actions[v]._clip).duration;
            setTimeout(() => { if (this._role === 'idleVar') this.play('idle', .35); }, Math.max(400, (dur - .35) * 1000));
          }
        }
        break;
      }
      case 'walk': this.play(opt.sneak ? 'crouch' : 'walk', .22, clamp(spd / 4.2, .7, 1.3)); break;
      case 'run': this.play('run', .22, clamp(spd / 7.2, .75, 1.35)); break;
      case 'sprint': this.play('sprint', .18, clamp(spd / 10.5, .8, 1.3)); break;
      case 'jump': if (this._role !== 'jump') { this.play('jump', .12); } break;
      case 'fall': this.play('fall', .3); break;
      case 'glide': this.play('fall', .4, .55); break;
      case 'climb': this.play('crouch', .3, .8); break;
      case 'swim': this.play('fall', .35, .5); break;
      case 'ride': this.play('idle', .3); break;
      case 'throw': this.play('idle', .2); break;
      case 'talk': {
        if (this._role !== 'talk') {
          const t = Math.random() < .5 ? 'talk1' : 'talk2';
          if (this.actions[t]) {
            this.actions[t].setLoop(THREE.LoopRepeat);
            this.play(t, .3); this._role = 'talk';
          }
        }
        break;
      }
      case 'dance': this.play('dance', .3); break;
    }

    this.mixer.update(dt);

    // ---- 程序化叠加 ----
    // 投掷: 右臂后摆→前掷 (mixer 之后覆写)
    const wantThrow = state === 'throw' ? 1 : 0;
    this.throwBlend = damp(this.throwBlend, wantThrow, 14, dt);
    if (this.throwBlend > .01) {
      const t = clamp(opt.throwT ?? 0, 0, 1);
      const arm = this.bones.RightArm, fore = this.bones.RightForeArm;
      const spine = this.bones.Spine2 ?? this.bones.Spine1;
      if (arm && fore) {
        let armX, foreX, spineY;
        if (t < .45) { // 蓄力后摆
          const w = t / .45;
          armX = -2.4 * w; foreX = -.9 * w; spineY = -.55 * w;
        } else {      // 掷出
          const w = (t - .45) / .55;
          const e = 1 - Math.pow(1 - w, 3);
          armX = lerp(-2.4, .9, e); foreX = lerp(-.9, -.1, e); spineY = lerp(-.55, .35, e);
        }
        const b = this.throwBlend;
        arm.rotation.x += armX * b;
        fore.rotation.x += foreX * b;
        if (spine) spine.rotation.y += spineY * b;
      }
    }
    // 滑翔: 手臂上举抓伞带
    if (state === 'glide') {
      const L = this.bones.LeftArm, R = this.bones.RightArm;
      if (L) { L.rotation.x -= 2.2; L.rotation.z += .5; }
      if (R) { R.rotation.x -= 2.2; R.rotation.z -= .5; }
    }
    // 骑乘: 腿部张开贴坐
    if (state === 'ride') {
      for (const s of ['Left', 'Right']) {
        const up = this.bones[s + 'UpLeg'], lo = this.bones[s + 'Leg'];
        if (up) { up.rotation.x -= .9; up.rotation.z += (s === 'Left' ? .5 : -.5); }
        if (lo) lo.rotation.x += 1.15;
      }
    }
    // 游泳: 身体前倾
    if (state === 'swim') {
      if (this.inst) this.inst.rotation.x = damp(this.inst.rotation.x, 1.15, 8, dt);
    } else if (this.inst && Math.abs(this.inst.rotation.x) > .001) {
      this.inst.rotation.x = damp(this.inst.rotation.x, 0, 8, dt);
    }

    this.glider.visible = state === 'glide';
    if (state === 'glide') this.glider.rotation.z = Math.sin((opt.time ?? 0) * 1.3) * .06;
  }
}
