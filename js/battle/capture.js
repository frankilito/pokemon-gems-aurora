// 捕捉系统：瞄准/投球/吸入/摇晃判定(官方公式)/背刺与树果加成
import * as THREE from 'three';
import { G, addUpdate, emit, on } from '../core/engine.js';
import { Input } from '../core/input.js';
import { buildBall, FX } from '../core/fx.js';
import { getHeight } from '../world/world.js';
import { ITEMS } from '../core/state.js';
import { clamp, TAU } from '../core/math.js';

const BALL_KINDS = ['poke-ball', 'great-ball', 'ultra-ball', 'heavy-ball'];

// 捕获率纯函数 (Gen3/4 公式 + 背刺/树果/传说修正)
// bonus: {behind, eating, legendMod=.65, pow=.75} — 战斗内捕捉传入更宽松的调参
// 返回 {a: 修正捕获值(1..255), p: 成功概率(0..1]}
export function captureOdds(mon, ballKind, bonus = {}) {
  const M = mon.maxHp, H = Math.max(1, mon.hp);
  const rate = mon.catchRate;
  const ballB = (ITEMS[ballKind]?.rate ?? 1) * (bonus.behind ? (ITEMS[ballKind]?.sneak ?? 1.35) : 1) * (bonus.eating ? 1.7 : 1);
  const statusB = mon.status === 'sleep' || mon.status === 'freeze' ? 2 : mon.status ? 1.5 : 1;
  let a = ((3 * M - 2 * H) / (3 * M)) * rate * ballB * statusB;
  if (mon.species.legendary) a *= (bonus.legendMod ?? .65);
  a = clamp(a, 1, 255);
  const powK = bonus.pow ?? .75; // 幂<1 平滑体验
  return { a, p: a >= 255 ? 1 : Math.pow(a / 255, powK) };
}

export class CaptureSystem {
  constructor(scene) {
    this.scene = scene;
    this.projectiles = new Set();
    this.ballIdx = 0;
    this.busy = false;          // 捕捉动画中
    this.reticleEl = document.getElementById('reticle');
    this.berryTarget = null;
    addUpdate(dt => this.update(dt));
    on('key', k => {
      if (G.state !== 'roam' || this.busy) return;
      if (k === 'KeyR') this.cycleBall();
    });
    on('mousedown', btn => {
      if (G.state !== 'roam' || this.busy || !Input.locked) return;
      if (btn === 0 && G.player.aiming) this.throwCurrent();
    });
  }

  get ballKind() {
    // 跳过没有库存的球
    for (let i = 0; i < 4; i++) {
      const k = BALL_KINDS[(this.ballIdx + i) % 4];
      if (G.save.count(k) > 0) { this.ballIdx = (this.ballIdx + i) % 4; return k; }
    }
    return null;
  }
  cycleBall() {
    this.ballIdx = (this.ballIdx + 1) % 4;
    const k = this.ballKind;
    emit('ballChange', k);
  }

  update(dt) {
    const P = G.player;
    if (!P) return;
    // 瞄准状态
    const wantAim = Input.mouse.rDown && G.state === 'roam' && !this.busy && !P.mount;
    if (wantAim !== P.aiming) {
      P.aiming = wantAim;
      this.reticleEl.classList.toggle('show', wantAim);
      if (wantAim) this.updateReticleLabel();
    }
    if (P.aiming) {
      // 锁定提示: 准星指向的精灵
      const target = this.aimTarget();
      this.reticleEl.querySelector('.ret-dot')?.classList.toggle('lock', !!target);
    }

    // 投掷物
    for (const pr of [...this.projectiles]) {
      pr.vel.y -= 18 * dt;
      pr.mesh.position.addScaledVector(pr.vel, dt);
      pr.mesh.rotation.x += dt * 14; pr.mesh.rotation.z += dt * 6;
      pr.life -= dt;
      const p = pr.mesh.position;
      // 命中精灵
      const all = G.spawner?.all() ?? [];
      let hit = null;
      for (const a of all) {
        if (a.state === 'battle' || a.state === 'captured') continue;
        const r = Math.max(.55, a.scaleH * .55);
        if (p.distanceToSquared(a.pos.clone().add(new THREE.Vector3(0, a.scaleH * .45, 0))) < r * r) { hit = a; break; }
      }
      if (hit && pr.kind !== 'berry') { this.onBallHit(pr, hit); continue; }
      if (hit && pr.kind === 'berry') { /* 树果穿过精灵不触发 */ }
      // 落地
      const gh = getHeight(p.x, p.z);
      if (p.y <= gh + .1 || pr.life <= 0) {
        if (pr.kind === 'berry') this.onBerryLand(pr);
        else { FX.grassPoof(p); this.removeProj(pr); emit('toast', { text: '球扔空了…' }); }
      }
    }

    // 树果引诱行为
    if (this.berryTarget) {
      const { actor, pos, t } = this.berryTarget;
      if (actor.dead) this.berryTarget = null;
      else {
        const d = Math.hypot(actor.pos.x - pos.x, actor.pos.z - pos.z);
        if (d > 1.2) {
          actor.state = 'wander';
          actor.wishDir.set(pos.x - actor.pos.x, 0, pos.z - actor.pos.z).normalize();
          actor.speed = 2;
          actor.stateT = 2;
        } else {
          actor.state = 'idle'; actor.stateT = 5; actor.speed = 0;
          actor.eating = true;
          if (Math.random() < dt * 2) FX.grassPoof(actor.pos.clone().add(new THREE.Vector3(0, .3, 0)));
        }
        this.berryTarget.t -= dt;
        if (this.berryTarget.t <= 0) { actor.eating = false; this.berryTarget = null; }
      }
    }
  }

  aimDir() {
    const cam = G.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    return dir;
  }
  aimTarget(maxD = 26) {
    const origin = G.camera.position.clone();
    const dir = this.aimDir();
    let best = null, bestScore = .92;
    for (const a of G.spawner?.all() ?? []) {
      const to = a.pos.clone().add(new THREE.Vector3(0, a.scaleH * .5, 0)).sub(origin);
      const d = to.length();
      if (d > maxD) continue;
      const dot = to.normalize().dot(dir);
      if (dot > bestScore) { bestScore = dot; best = a; }
    }
    return best;
  }

  throwCurrent() {
    const kind = this.ballKind;
    const hasBerry = G.save.count('razz-berry') > 0;
    const useBerry = Input.down('KeyB') && hasBerry;
    if (!kind && !useBerry) { emit('toast', { text: '没有精灵球了！去商店买一些吧' }); return; }
    const itemId = useBerry ? 'razz-berry' : kind;
    if (!G.save.useItem(itemId)) return;
    emit('bagChange');

    // 投掷动作 + 生成投掷物
    G.player.startThrow(() => {
      const start = G.player.pos.clone().add(new THREE.Vector3(0, 1.45, 0));
      const dir = this.aimDir();
      start.addScaledVector(dir, .5);
      // 锁定目标 → 轻微制导初速
      const target = this.aimTarget();
      let vel;
      if (target) {
        const to = target.pos.clone().add(new THREE.Vector3(0, target.scaleH * .5, 0)).sub(start);
        const d = to.length();
        const flightT = clamp(d / 16, .25, 1.1);
        vel = to.multiplyScalar(1 / flightT);
        vel.y += 9 * flightT; // 补偿重力(18/2*t)
      } else {
        vel = dir.clone().multiplyScalar(17);
        vel.y += 3.2;
      }
      let mesh;
      if (useBerry) {
        mesh = new THREE.Mesh(new THREE.SphereGeometry(.11, 10, 8), new THREE.MeshStandardMaterial({ color: '#e85c7a', roughness: .6 }));
        mesh.castShadow = true;
      } else mesh = buildBall(kind, .13);
      mesh.position.copy(start);
      this.scene.add(mesh);
      this.projectiles.add({ mesh, vel, life: 3, kind: useBerry ? 'berry' : kind });
      emit('sfx', 'throw');
    });
  }

  removeProj(pr) { this.scene.remove(pr.mesh); this.projectiles.delete(pr); }

  onBerryLand(pr) {
    const p = pr.mesh.position.clone();
    p.y = getHeight(p.x, p.z);
    // 留在地上
    pr.mesh.position.y = p.y + .1;
    this.projectiles.delete(pr);
    const berryMesh = pr.mesh;
    setTimeout(() => this.scene.remove(berryMesh), 8000);
    // 吸引最近
    let best = null, bd = 20;
    for (const a of G.spawner?.all() ?? []) {
      const d = Math.hypot(a.pos.x - p.x, a.pos.z - p.z);
      if (d < bd) { bd = d; best = a; }
    }
    if (best && best.state !== 'battle') this.berryTarget = { actor: best, pos: p, t: 7 };
    emit('sfx', 'berry');
  }

  // ---- 球命中野生精灵 ----
  onBallHit(pr, actor) {
    const ballKind = pr.kind;
    const hitPos = pr.mesh.position.clone();
    this.removeProj(pr);
    if (this.busy) return;
    this.busy = true;
    G.state = 'capture';
    G.player.freeze(true);
    G.player.aiming = false;
    this.reticleEl.classList.remove('show');
    actor.state = 'captured';
    actor.speed = 0;

    // 从后方命中且未察觉 → 背刺加成
    const behind = !actor.noticed;
    const eating = !!actor.eating;
    emit('sfx', 'ballHit');
    G.cam?.kick(.25);

    // 球停在精灵上方
    const ball = buildBall(ballKind, .14);
    ball.position.copy(hitPos);
    this.scene.add(ball);
    const restPos = actor.pos.clone().add(new THREE.Vector3(0, .16, 0));

    // 吸入
    FX.captureBeam(hitPos, actor, () => {
      // 球落地
      FX.mgr.tween((age) => {
        const t = clamp(age / .45, 0, 1);
        ball.position.lerpVectors(hitPos, restPos, t);
        ball.position.y += Math.sin(t * Math.PI) * .5;
        if (t >= 1) { this.shakePhase(ball, actor, ballKind, { behind, eating }); return false; }
      });
    });
  }

  shakePhase(ball, actor, ballKind, bonus) {
    const mon = actor.mon;
    const { a, p } = captureOdds(mon, ballKind, bonus);
    const catchIt = a >= 255 || Math.random() < p;
    const shakes = catchIt ? 3 : (a > 150 ? 2 : a > 60 ? 1 : Math.random() < .5 ? 1 : 0);

    let count = 0;
    const doShake = () => {
      if (count < shakes || (catchIt && count < 3)) {
        count++;
        emit('sfx', 'shake');
        FX.mgr.tween(age => {
          const t = clamp(age / .5, 0, 1);
          ball.rotation.z = Math.sin(t * Math.PI * 2) * .55 * (1 - t * .3);
          if (t >= 1) { setTimeout(doShake, 420); return false; }
        });
      } else if (catchIt) {
        // ★ 捕获成功
        emit('sfx', 'catch');
        FX.catchStars(ball.position);
        G.audio?.cry?.(mon.id);
        setTimeout(() => {
          this.scene.remove(ball);
          G.spawner.remove(actor);
          if (actor.isLegend) G.flags['legendGone_' + actor.isLegend] = true;
          mon.ballId = ballKind;
          mon.metAt = G.player.zone || '极光大陆';
          G.save.addMon(mon);
          emit('captured', mon);
          emit('quest:capture', mon);
          this.endCapture();
        }, 700);
      } else {
        // 挣脱
        emit('sfx', 'breakout');
        FX.breakOut(ball.position);
        this.scene.remove(ball);
        FX.releaseFlash(actor.pos.clone().add(new THREE.Vector3(0, .4, 0)), actor);
        actor.state = actor.temperament === 'aggressive' ? 'chase' : 'flee';
        actor.noticed = true;
        emit('toast', { text: `${mon.species.zh} 挣脱了！` });
        this.endCapture();
      }
    };
    setTimeout(doShake, 380);
  }

  endCapture() {
    this.busy = false;
    if (G.state === 'capture') G.state = 'roam';
    G.player.freeze(false);
  }
}
