// 玩家控制器：移动/冲刺/跳跃/攀爬/滑翔/游泳/骑乘 + 体力
import * as THREE from 'three';
import { G, addUpdate, emit, on } from '../core/engine.js';
import { Input } from '../core/input.js';
import { HumanModel } from './humanModel.js';
import { getHeight, getSlope, getNormal, getBiome, WORLD, ZONE_NAMES } from '../world/world.js';
import { clamp, lerp, damp, dampAngle, TAU } from '../core/math.js';

const WALK = 4.3, RUN = 7.4, SPRINT = 11.2, SWIM = 3.6, CLIMB = 2.2;
const GRAV = 26, JUMP_V = 9.2;

export class Player {
  constructor(scene, spawn = { x: 6, z: 470 }) {
    this.model = new HumanModel({ gender: 'm', height: 1.68 });
    scene.add(this.model.root);
    this.pos = new THREE.Vector3(spawn.x, getHeight(spawn.x, spawn.z), spawn.z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;              // 面朝方向
    this.state = 'idle';             // idle walk run sprint jump fall glide climb swim throw ride
    this.grounded = true;
    this.stamina = 1; this.maxStamina = 1;
    this.climbPhase = 0;
    this.throwT = 0; this.throwCb = null;
    this.mount = null;               // 骑乘对象(MonActor)
    this.biome = 'town';
    this.zone = '';
    this.frozen = false;             // 对话/战斗时锁定
    this.aiming = false;
    this.speed = 0;
    addUpdate(dt => this.update(dt));
  }

  get eyePos() { return this.pos.clone().add(new THREE.Vector3(0, 1.5, 0)); }

  freeze(v = true) { this.frozen = v; if (v) { this.state = 'idle'; this.speed = 0; } }

  startThrow(cb) {
    if (this.state === 'glide' || this.state === 'swim') return false;
    this.state = 'throw'; this.throwT = 0; this.throwCb = cb; this.thrown = false;
    return true;
  }

  update(dt) {
    const I = Input;
    const camYaw = G.cam ? G.cam.yaw : this.yaw;

    if (this.frozen) {
      this.model.update(dt, 'idle', { time: G.time });
      this.model.root.position.copy(this.pos);
      this.model.root.rotation.y = this.yaw;
      return;
    }

    // ---- 骑乘由 mount 接管位移 ----
    if (this.mount) { this.updateRide(dt, camYaw); return; }

    const h = getHeight(this.pos.x, this.pos.z);
    const waterDepth = -h;                       // 水面0
    const inWater = waterDepth > 1.05 && this.pos.y < .8;

    // ---- 投掷姿态(上半身) 进行中仍可小幅移动 ----
    if (this.state === 'throw') {
      this.throwT += dt * 2.6;
      if (this.throwT >= .45 && !this.thrown) { this.thrown = true; this.throwCb?.(); }
      if (this.throwT >= 1) { this.state = 'idle'; this.throwCb = null; }
    }

    // ---- 攀爬检测 ----
    const slope = getSlope(this.pos.x, this.pos.z);
    const [ax, az] = I.axis();
    const moving = ax !== 0 || az !== 0;
    const wishYaw = camYaw + Math.atan2(-ax, -az) + Math.PI;

    if (this.state === 'climb') {
      this.updateClimb(dt, ax, az, camYaw, slope);
    } else if (this.state === 'glide') {
      this.updateGlide(dt, ax, az, camYaw);
    } else if (inWater) {
      this.updateSwim(dt, ax, az, camYaw, moving, wishYaw, h);
    } else {
      this.updateGround(dt, ax, az, camYaw, moving, wishYaw, h, slope);
    }

    // 体力恢复
    if (this.grounded && this.state !== 'climb' && this.state !== 'sprint') {
      this.stamina = clamp(this.stamina + dt * .22, 0, this.maxStamina);
    }

    // 群系/区域公告
    const b = getBiome(this.pos.x, this.pos.z);
    if (b !== this.biome) {
      this.biome = b;
      const zone = ZONE_NAMES[b];
      if (zone && zone !== this.zone) { this.zone = zone; emit('zone', zone); }
    }

    // 模型同步
    const st = this.state === 'throw' ? 'throw' : this.state;
    this.model.update(dt, st, {
      time: G.time, speed: this.speed,
      climbPhase: this.climbPhase, throwT: this.throwT,
      sneak: this.speed < 4.5 && this.speed > .6,
    });
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.yaw;
    // 攀爬时贴墙
    if (this.state === 'climb') {
      const n = getNormal(this.pos.x, this.pos.z);
      this.model.root.rotation.x = -n.z * .8;
    } else this.model.root.rotation.x = damp(this.model.root.rotation.x, 0, 10, dt);
  }

  updateGround(dt, ax, az, camYaw, moving, wishYaw, h, slope) {
    const sprint = I_down('ShiftLeft') && this.stamina > .02 && moving;
    let target = 0;
    if (moving) {
      this.yaw = dampAngle(this.yaw, wishYaw, 12, dt);
      target = sprint ? SPRINT : (I_down('AltLeft') ? WALK : RUN);
      if (sprint) this.stamina = clamp(this.stamina - dt * .13, 0, 1);
    }
    this.speed = damp(this.speed, target, 9, dt);
    const dir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    // 陡坡阻挡/滑落
    const nxt = { x: this.pos.x + dir.x * this.speed * dt, z: this.pos.z + dir.z * this.speed * dt };
    const nh = getHeight(nxt.x, nxt.z);
    const rise = nh - this.pos.y;
    const tooSteep = slope > 1.15 && rise > 0;

    if (!tooSteep || !this.grounded) {
      this.pos.x = nxt.x; this.pos.z = nxt.z;
    } else if (moving && this.grounded && this.stamina > .02) {
      // 顶墙 → 进入攀爬
      this.state = 'climb';
      return;
    }

    // 跳跃
    if (I_hit('Space') && this.grounded) {
      this.vel.y = JUMP_V;
      this.grounded = false;
      emit('sfx', 'jump');
    }

    // 重力
    if (!this.grounded) {
      this.vel.y -= GRAV * dt;
      this.pos.y += this.vel.y * dt;
      const gh = getHeight(this.pos.x, this.pos.z);
      if (this.pos.y <= gh) {
        this.pos.y = gh; this.grounded = true; this.vel.y = 0;
        emit('sfx', 'land');
      } else if (this.vel.y < -3 && I_hit('Space') && this.pos.y - gh > 5 && this.stamina > .05) {
        this.state = 'glide';
        emit('sfx', 'glide');
        return;
      }
    } else {
      const gh = getHeight(this.pos.x, this.pos.z);
      if (this.pos.y > gh + .4) { this.grounded = false; this.vel.y = 0; }
      else this.pos.y = damp(this.pos.y, gh, 22, dt);
    }

    G.world.resolve(this.pos, .42);

    // 状态
    if (this.state !== 'throw') {
      if (!this.grounded) this.state = this.vel.y > .5 ? 'jump' : 'fall';
      else if (this.speed > 8.6) this.state = 'sprint';
      else if (this.speed > 5) this.state = 'run';
      else if (this.speed > .6) this.state = 'walk';
      else this.state = 'idle';
    }
    if (this.grounded && this.speed > 1 && ((this.model.phase | 0) !== this._lastStep)) {
      this._lastStep = this.model.phase | 0;
      emit('step', this.biome);
    }
  }

  updateClimb(dt, ax, az, camYaw, slope) {
    // 脱离条件
    const n = getNormal(this.pos.x, this.pos.z);
    if (slope < .9) { this.state = 'idle'; this.grounded = true; return; }
    if (this.stamina <= 0) { this.state = 'fall'; this.grounded = false; this.vel.y = -1; return; }
    if (I_hit('Space')) { // 跳离墙
      this.state = 'fall'; this.grounded = false;
      this.vel.y = 5;
      this.pos.x += n.x * 1.2; this.pos.z += n.z * 1.2;
      return;
    }
    this.stamina = clamp(this.stamina - dt * (ax || az ? .1 : .045), 0, 1);
    // 沿坡面移动: W=向上
    const upDir = new THREE.Vector3(-n.x, 0, -n.z).normalize(); // 朝坡内
    const rightDir = new THREE.Vector3(-upDir.z, 0, upDir.x);
    const mv = new THREE.Vector3().addScaledVector(upDir, -az).addScaledVector(rightDir, ax * .8);
    if (mv.lengthSq() > 0) {
      mv.normalize().multiplyScalar(CLIMB * dt);
      this.pos.x += mv.x; this.pos.z += mv.z;
      this.climbPhase += dt * 6;
    }
    this.pos.y = getHeight(this.pos.x, this.pos.z) + .1;
    this.yaw = dampAngle(this.yaw, Math.atan2(upDir.x, upDir.z), 10, dt);
    this.speed = 0;
    // 登顶
    if (getSlope(this.pos.x, this.pos.z) < .8) { this.state = 'idle'; this.grounded = true; this.pos.y = getHeight(this.pos.x, this.pos.z); }
  }

  updateGlide(dt, ax, az, camYaw) {
    if (this.stamina <= 0 || I_hit('Space')) { this.state = 'fall'; return; }
    this.stamina = clamp(this.stamina - dt * .055, 0, 1);
    const wishYaw = (ax || az) ? camYaw + Math.atan2(-ax, -az) + Math.PI : this.yaw;
    this.yaw = dampAngle(this.yaw, wishYaw, 3.5, dt);
    this.speed = damp(this.speed, 9.5, 3, dt);
    const dir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.pos.addScaledVector(dir, this.speed * dt);
    this.vel.y = damp(this.vel.y, -2.1, 4, dt);
    this.pos.y += this.vel.y * dt;
    const gh = getHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= gh + .1) {
      this.pos.y = gh; this.grounded = true; this.vel.y = 0; this.state = 'idle';
      emit('sfx', 'land');
    }
    G.world.resolve(this.pos, .42);
  }

  updateSwim(dt, ax, az, camYaw, moving, wishYaw, h) {
    this.state = 'swim';
    this.grounded = false;
    if (moving) {
      this.yaw = dampAngle(this.yaw, wishYaw, 8, dt);
      this.speed = damp(this.speed, SWIM, 6, dt);
    } else this.speed = damp(this.speed, 0, 6, dt);
    const dir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.pos.addScaledVector(dir, this.speed * dt);
    this.pos.y = damp(this.pos.y, -.42, 10, dt);
    this.stamina = clamp(this.stamina - dt * .035, 0, 1);
    // 体力耗尽 → 推回岸边
    if (this.stamina <= 0) {
      const back = new THREE.Vector3(-dir.x, 0, -dir.z);
      this.pos.addScaledVector(back, 2 * dt);
    }
    const gh = getHeight(this.pos.x, this.pos.z);
    if (gh > -1.05) { // 上岸
      if (gh > -.2) { this.state = 'idle'; this.grounded = true; this.pos.y = gh; }
    }
    G.world.resolve(this.pos, .42);
    if (Math.random() < dt * 6) emit('splash', this.pos);
  }

  updateRide(dt, camYaw) {
    // 由 mount 的 update 移动; 这里只同步模型
    this.model.update(dt, 'ride', { time: G.time });
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.yaw;
  }
}

const I_down = k => Input.down(k);
const I_hit = k => Input.hit(k);
