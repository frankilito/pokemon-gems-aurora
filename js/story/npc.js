// NPC：村民/博士/馆主/路人训练家
import * as THREE from 'three';
import { G, addUpdate } from '../core/engine.js';
import { TrainerModel } from '../player/trainerModel.js';
import { getHeight, WORLD } from '../world/world.js';
import { dampAngle } from '../core/math.js';

export class NPC {
  constructor(def) {
    Object.assign(this, def);   // id name x z pal dialog trainer? wander?
    this.model = new TrainerModel(def.pal ?? {});
    this.model.root.position.set(def.x, getHeight(def.x, def.z), def.z);
    this.yaw = def.yaw ?? Math.random() * Math.PI * 2;
    this.home = new THREE.Vector3(def.x, 0, def.z);
    this.wanderT = 2 + Math.random() * 4;
    this.moveDir = null;
    G.scene.add(this.model.root);
    // 名牌
    const label = this.label = makeLabel(def.name);
    label.position.y = 2.05;
    this.model.root.add(label);
    G.world.addCollider(def.x, def.z, .5, this);
  }

  update(dt) {
    const P = G.player;
    const d = P ? Math.hypot(P.pos.x - this.model.root.position.x, P.pos.z - this.model.root.position.z) : 99;
    if (this.label) this.label.material.opacity = d > 15 ? Math.max(0, 1 - (d - 15) / 5) : d < 2.2 ? Math.max(.25, (d - .8) / 1.4) : 1;
    let state = 'idle', speed = 0;
    if (d < 4.5) {
      // 看向玩家
      const dx = P.pos.x - this.model.root.position.x, dz = P.pos.z - this.model.root.position.z;
      this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 6, dt);
      this.moveDir = null;
    } else if (this.wander) {
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        this.wanderT = 3 + Math.random() * 5;
        if (this.moveDir || Math.random() < .6) this.moveDir = null;
        else {
          const a = Math.random() * Math.PI * 2;
          this.moveDir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
        }
      }
      if (this.moveDir) {
        const p = this.model.root.position;
        const nx = p.x + this.moveDir.x * dt, nz = p.z + this.moveDir.z * dt;
        if (Math.hypot(nx - this.home.x, nz - this.home.z) < (this.wanderR ?? 10)) {
          p.x = nx; p.z = nz;
          p.y = getHeight(nx, nz);
          this.yaw = dampAngle(this.yaw, Math.atan2(this.moveDir.x, this.moveDir.z), 5, dt);
          state = 'walk'; speed = 1.2;
        } else this.moveDir = null;
      }
    }
    this.model.update(dt, state, { time: G.time + (this.x ?? 0), speed });
    this.model.root.rotation.y = this.yaw;
  }
}

function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 30px PingFang SC, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(10,14,25,.62)';
  const w = ctx.measureText(text).width + 30;
  roundRect(ctx, 128 - w / 2, 8, w, 46, 14);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(.95, .24, 1);
  return sp;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
