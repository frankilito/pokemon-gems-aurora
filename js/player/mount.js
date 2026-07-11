// 骑乘：风速犬(陆) / 拉普拉斯(水) — G键召唤
import * as THREE from 'three';
import { G, on, emit } from '../core/engine.js';
import { Input } from '../core/input.js';
import { MonActor } from '../mon/monActor.js';
import { Pokemon } from '../mon/pokemon.js';
import { getHeight, getSlope } from '../world/world.js';
import { FX } from '../core/fx.js';
import { clamp, damp, dampAngle } from '../core/math.js';

const LAND_ID = 59, WATER_ID = 131;

export class MountSystem {
  constructor() {
    this.actor = null;         // 当前坐骑演员
    this.mode = null;          // 'land' | 'water'
    this.speed = 0;
    this.vy = 0;
    this.grounded = true;
    on('key', k => {
      if (k === 'KeyG' && G.state === 'roam' && G.flags.mountUnlocked) this.toggle();
    });
    G.updaters.add(dt => this.update(dt));
  }

  toggle() {
    if (this.actor) this.dismount();
    else this.summon();
  }

  summon(mode = 'land') {
    if (this.actor) return;
    const P = G.player;
    if (P.state === 'climb' || P.state === 'glide') return;
    this.mode = mode;
    const id = mode === 'water' ? WATER_ID : LAND_ID;
    this.actor = new MountActor(id);
    this.actor.pos.copy(P.pos);
    this.actor.yaw = P.yaw;
    G.scene.add(this.actor.group);
    FX.releaseFlash(P.pos.clone().add(new THREE.Vector3(0, .8, 0)), this.actor);
    G.audio?.cry?.(id);
    G.audio?.sfx?.('mount');
    P.mount = this;
    this.speed = 0;
    this.grounded = true;
  }

  dismount() {
    if (!this.actor) return;
    const P = G.player;
    FX.releaseFlash(this.actor.pos.clone().add(new THREE.Vector3(0, .8, 0)));
    this.actor.dispose(G.scene);
    this.actor = null;
    P.mount = null;
    P.pos.y = getHeight(P.pos.x, P.pos.z);
    if (P.pos.y < 0) { // 别把玩家丢水里
      P.pos.y = -0.42;
    }
    emit('sfx', 'dismount');
  }

  swapTo(mode) {
    const pos = this.actor.pos.clone(), yaw = this.actor.yaw, spd = this.speed;
    this.actor.dispose(G.scene);
    const id = mode === 'water' ? WATER_ID : LAND_ID;
    this.actor = new MountActor(id);
    this.actor.pos.copy(pos);
    this.actor.yaw = yaw;
    G.scene.add(this.actor.group);
    FX.splash?.(pos);
    FX.releaseFlash(pos.clone().add(new THREE.Vector3(0, .6, 0)), this.actor);
    this.mode = mode;
    this.speed = Math.min(spd, 8);
    G.audio?.cry?.(id);
  }

  update(dt) {
    if (!this.actor || !G.player) return;
    const P = G.player;
    if (G.state !== 'roam' || P.frozen) { this.actor.animate(dt, 0); return; }

    const camYaw = G.cam ? G.cam.yaw : P.yaw;
    const [ax, az] = Input.axis();
    const moving = ax !== 0 || az !== 0;
    const A = this.actor;

    // 地形水陆切换
    const gh = getHeight(A.pos.x, A.pos.z);
    const inWater = gh < -1.05;
    if (inWater && this.mode === 'land') {
      if (G.flags.waterMount) this.swapTo('water');
      else { // 不会游泳: 推回
        A.pos.x -= Math.sin(A.yaw) * 2 * dt * 10;
        A.pos.z -= Math.cos(A.yaw) * 2 * dt * 10;
        emit('toast', { text: '需要「碧波铃铛」才能下水(击败澜心)' });
      }
    } else if (!inWater && this.mode === 'water' && gh > -.4) {
      this.swapTo('land');
    }

    // 移动
    const top = this.mode === 'water' ? 9 : (Input.down('ShiftLeft') ? 14.5 : 11);
    if (moving) {
      const wishYaw = camYaw + Math.atan2(-ax, -az) + Math.PI;
      A.yaw = dampAngle(A.yaw, wishYaw, 6, dt);
      this.speed = damp(this.speed, top, 4.5, dt);
    } else this.speed = damp(this.speed, 0, 5, dt);

    const dir = new THREE.Vector3(Math.sin(A.yaw), 0, Math.cos(A.yaw));
    const nx = A.pos.x + dir.x * this.speed * dt, nz = A.pos.z + dir.z * this.speed * dt;
    const nh = getHeight(nx, nz);
    const slope = getSlope(A.pos.x, A.pos.z);
    if (this.mode === 'land' && slope > 1.2 && nh > A.pos.y + .5) {
      this.speed *= .6; // 陡坡减速
    } else { A.pos.x = nx; A.pos.z = nz; }
    G.world.resolve(A.pos, .8);

    // 跳跃(陆)
    if (this.mode === 'land') {
      if (Input.hit('Space') && this.grounded) { this.vy = 10.5; this.grounded = false; emit('sfx', 'jump'); }
      if (!this.grounded) {
        this.vy -= 26 * dt;
        A.pos.y += this.vy * dt;
        const g2 = getHeight(A.pos.x, A.pos.z);
        if (A.pos.y <= g2) { A.pos.y = g2; this.grounded = true; this.vy = 0; }
      } else {
        A.pos.y = damp(A.pos.y, getHeight(A.pos.x, A.pos.z), 20, dt);
      }
    } else {
      A.pos.y = damp(A.pos.y, -.35 + Math.sin(G.time * 1.6) * .1, 8, dt);
      if (this.speed > 2 && Math.random() < dt * 4) FX.splash(A.pos.clone().add(new THREE.Vector3(0, .1, 0)));
    }

    A.animate(dt, this.speed);

    // 玩家贴到坐骑背上
    const seatH = this.mode === 'water' ? A.scaleH * .78 : A.scaleH * .72;
    P.pos.set(A.pos.x, A.pos.y + seatH, A.pos.z);
    P.yaw = A.yaw;
  }
}

// 简化的坐骑演员(复用MonActor的加载/程序化动画)
class MountActor extends MonActor {
  constructor(id) {
    super(new Pokemon(id, 30), { behavior: 'static' });
    this.state = 'mounted';
  }
  update() {} // 由 MountSystem 驱动
  animate(dt, speed) {
    this.mixer?.update(dt);
    this.speed = speed;
    if (this.proc) this.proc.update(dt, speed);
    else if (this.mixer) {
      if (speed > .5 && this._role !== 'run') this.play('run');
      else if (speed <= .5 && this._role !== 'idle') this.play('idle');
    }
    this.group.rotation.y = this.yaw;
    this.group.position.copy(this.pos);
  }
}
