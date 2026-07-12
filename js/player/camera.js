// 第三人称相机：跟随/环绕/瞄准肩视角/地形避障
import * as THREE from 'three';
import { G, addUpdate } from '../core/engine.js';
import { Input } from '../core/input.js';
import { getHeight } from '../world/world.js';
import { clamp, lerp, damp, dampAngle } from '../core/math.js';

export class ThirdPersonCam {
  constructor() {
    this.yaw = Math.PI;
    this.pitch = .24;
    this.dist = 5.6;
    this.wishDist = 5.6;
    this.aim = false;
    this.shake = 0;
    this.lookAt = new THREE.Vector3();
    this.cur = new THREE.Vector3(0, 20, 30);
    this.fovKick = 0;
    addUpdate(dt => this.update(dt));
  }

  update(dt) {
    const P = G.player;
    if (!P || G.state === 'battle' || G.state === 'cine') return;

    if (Input.locked && G.state === 'roam') {
      const sens = G.settings?.sens ?? 1;
      this.yaw -= Input.mouse.dx * .0021 * sens;
      this.pitch = clamp(this.pitch + Input.mouse.dy * .0019 * sens, -.55, 1.2);
      this.wishDist = clamp(this.wishDist + Input.mouse.wheel * .7, 2.6, 10);
    }

    this.aim = P.aiming;
    const wishD = this.aim ? 2.7 : this.wishDist;
    this.dist = damp(this.dist, wishD, 8, dt);

    // 目标点: 玩家胸口(瞄准时肩侧偏移)
    const side = this.aim ? .55 : 0;
    const target = P.pos.clone().add(new THREE.Vector3(
      Math.cos(this.yaw) * -side, P.state === 'swim' ? 1 : 1.35, Math.sin(this.yaw) * side));

    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch));
    let d = this.dist;
    // 地形遮挡: 沿视线采样
    for (let i = 1; i <= 8; i++) {
      const t = (i / 8) * d;
      const sp = target.clone().addScaledVector(dir, t);
      const gh = getHeight(sp.x, sp.z) + .35;
      if (sp.y < gh) { d = t - .3; break; }
    }
    d = Math.max(1.2, d);
    const wish = target.clone().addScaledVector(dir, d);
    // 平滑 + 震屏
    this.cur.x = damp(this.cur.x, wish.x, 16, dt);
    this.cur.y = damp(this.cur.y, wish.y, 16, dt);
    this.cur.z = damp(this.cur.z, wish.z, 16, dt);
    this.shake = Math.max(0, this.shake - dt * 3);
    const sh = this.shake * this.shake;
    G.camera.position.copy(this.cur).add(new THREE.Vector3(
      (Math.random() - .5) * sh * .5, (Math.random() - .5) * sh * .5, 0));
    this.lookAt.lerp(target, 1 - Math.exp(-18 * dt));
    G.camera.lookAt(this.lookAt);

    // 冲刺 FOV
    const motionK = G.settings?.reduceMotion ? .35 : 1;
    const wantKick = (P.state === 'sprint' ? 6 : (P.state === 'glide' ? 4 : 0)) * motionK;
    this.fovKick = damp(this.fovKick, wantKick, 5, dt);
    const fov = (this.aim ? 44 : 55) + this.fovKick;
    if (Math.abs(G.camera.fov - fov) > .1) { G.camera.fov = lerp(G.camera.fov, fov, .2); G.camera.updateProjectionMatrix(); }
  }

  kick(amount = .6) {
    if (G.settings?.reduceMotion) amount *= .25;
    this.shake = Math.min(1.2, this.shake + amount);
  }
}
