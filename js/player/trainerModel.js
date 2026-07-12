// 训练家：程序化构建的卡通角色 + 关节姿态动画
import * as THREE from 'three';
import { lerp, dampAngle, clamp, TAU } from '../core/math.js';

const M = (c, opts = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: .88, metalness: 0, ...opts });

export class TrainerModel {
  constructor(pal = {}) {
    this.root = new THREE.Group();
    this.root.name = 'trainer';
    const J = this.j = {};   // 关节

    const skin = M(pal.skin ?? '#ffd9b8'), jacket = M(pal.jacket ?? '#3d7de0'), jacketLt = M(pal.jacketLt ?? '#f3f6ff'),
          pants = M(pal.pants ?? '#2b3350'), shoe = M(pal.shoe ?? '#e8eaf0'), shoeSole = M(pal.shoeSole ?? '#c23a4c'),
          hair = M(pal.hair ?? '#5a4238'), capC = M(pal.cap ?? '#e34b5f'), capW = M(pal.capW ?? '#f6f8ff'), bag = M(pal.bag ?? '#9a6a44');
    this.noCap = !!pal.noCap; this.noBag = !!pal.noBag;

    // ---- 根/髋 ----
    const hips = J.hips = new THREE.Group();
    hips.position.y = .62;
    this.root.add(hips);

    // ---- 躯干 ----
    const torso = J.torso = new THREE.Group();
    torso.position.y = .12;
    hips.add(torso);
    const chest = new THREE.Mesh(roundBox(.4, .46, .26, .07), jacket);
    chest.position.y = .25;
    torso.add(chest);
    const zipper = new THREE.Mesh(new THREE.BoxGeometry(.055, .4, .02), jacketLt);
    zipper.position.set(0, .24, .135);
    torso.add(zipper);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(.13, .15, .08, 10), jacketLt);
    collar.position.y = .5;
    torso.add(collar);
    // 背包
    if (!this.noBag) {
      const pack = new THREE.Mesh(roundBox(.3, .34, .16, .05), bag);
      pack.position.set(0, .24, -.2);
      torso.add(pack);
      const packFlap = new THREE.Mesh(roundBox(.24, .14, .04, .02), M('#7c5434'));
      packFlap.position.set(0, .33, -.29);
      torso.add(packFlap);
    }

    // ---- 头 ----
    const neck = J.neck = new THREE.Group();
    neck.position.y = .53;
    torso.add(neck);
    const head = new THREE.Group();
    head.position.y = .12;
    neck.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(.155, 20, 16), skin);
    skull.scale.set(1, 1.06, .96);
    head.add(skull);
    // 发
    const hairBack = new THREE.Mesh(new THREE.SphereGeometry(.165, 16, 12, 0, TAU, 0, Math.PI * .62), hair);
    hairBack.rotation.x = -.5;
    hairBack.position.set(0, .03, -.015);
    head.add(hairBack);
    // 帽
    if (!this.noCap) {
      const capDome = new THREE.Mesh(new THREE.SphereGeometry(.17, 18, 12, 0, TAU, 0, Math.PI * .5), capC);
      capDome.position.y = .055;
      capDome.scale.set(1, .8, 1);
      head.add(capDome);
      const capBrim = new THREE.Mesh(new THREE.CylinderGeometry(.16, .18, .028, 18, 1, false, -Math.PI * .42, Math.PI * .84), capW);
      capBrim.position.set(0, .06, .1);
      capBrim.rotation.x = .12;
      head.add(capBrim);
      const capBall = new THREE.Mesh(new THREE.SphereGeometry(.045, 10, 8), capW);
      capBall.position.set(0, .1, .148);
      capBall.scale.z = .4;
      head.add(capBall);
    } else {
      const hairTop = new THREE.Mesh(new THREE.SphereGeometry(.16, 16, 12, 0, TAU, 0, Math.PI * .55), M(pal.hair ?? '#5a4238'));
      hairTop.position.y = .04;
      head.add(hairTop);
    }
    // 眼
    const eyeG = new THREE.SphereGeometry(.022, 8, 8);
    const eyeM = M('#26262e');
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(eyeG, eyeM);
      e.position.set(.062 * s, -.005, .138);
      e.scale.set(1, 1.5, .5);
      head.add(e);
    }
    this.head = head;

    // ---- 手臂 ----
    for (const s of [-1, 1]) {
      const key = s < 0 ? 'L' : 'R';
      const shoulder = J['arm' + key] = new THREE.Group();
      shoulder.position.set(.24 * s, .44, 0);
      torso.add(shoulder);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(.058, .2, 6, 10), jacket);
      upper.position.y = -.12;
      shoulder.add(upper);
      const elbow = J['fore' + key] = new THREE.Group();
      elbow.position.y = -.25;
      shoulder.add(elbow);
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(.05, .18, 6, 10), jacketLt);
      fore.position.y = -.11;
      elbow.add(fore);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(.06, 10, 8), skin);
      hand.position.y = -.24;
      elbow.add(hand);
      J['hand' + key] = hand;
    }

    // ---- 腿 ----
    for (const s of [-1, 1]) {
      const key = s < 0 ? 'L' : 'R';
      const hip = J['leg' + key] = new THREE.Group();
      hip.position.set(.11 * s, 0, 0);
      hips.add(hip);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(.075, .22, 6, 10), pants);
      thigh.position.y = -.14;
      hip.add(thigh);
      const knee = J['shin' + key] = new THREE.Group();
      knee.position.y = -.3;
      hip.add(knee);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(.06, .2, 6, 10), pants);
      shin.position.y = -.12;
      knee.add(shin);
      const foot = new THREE.Mesh(roundBox(.11, .08, .22, .03), shoe);
      foot.position.set(0, -.28, .04);
      knee.add(foot);
      const sole = new THREE.Mesh(roundBox(.115, .03, .23, .012), shoeSole);
      sole.position.set(0, -.315, .04);
      knee.add(sole);
    }

    // 滑翔伞(隐藏)
    this.glider = buildGlider();
    this.glider.visible = false;
    this.root.add(this.glider);

    this.root.traverse(o => { if (o.isMesh) { o.castShadow = true; } });

    this.phase = 0;
    this.cur = {};   // 当前关节欧拉
    this.state = 'idle';
    this.speedFactor = 0;
  }

  // 每帧: state + 参数 → 目标姿态 → 平滑逼近
  update(dt, state, opt = {}) {
    this.state = state;
    const spd = opt.speed ?? 0;
    this.phase += dt * clamp(spd, 0, 14) * 1.35;
    const p = this.phase;
    const T = {};      // 目标姿态 {joint: [rx,ry,rz]}
    let hipsY = 0, rootTilt = 0;

    const sw = Math.sin(p), cw = Math.cos(p);
    switch (state) {
      case 'idle': {
        const b = Math.sin(opt.time * 1.9) * .03;
        T.torso = [.02 + b * .4, 0, 0];
        T.armL = [.06 + b, 0, .1]; T.armR = [.06 - b, 0, -.1];
        T.foreL = [-.15, 0, 0]; T.foreR = [-.15, 0, 0];
        T.legL = [-.02, 0, .02]; T.legR = [-.02, 0, -.02];
        T.shinL = [.04, 0, 0]; T.shinR = [.04, 0, 0];
        T.neck = [b * .5, Math.sin(opt.time * .53) * .12, 0];
        hipsY = b * .01;
        break;
      }
      case 'walk': case 'run': case 'sprint': {
        const k = state === 'walk' ? .55 : state === 'run' ? .85 : 1.1;
        T.torso = [.1 * k + Math.abs(cw) * .02, 0, sw * .04 * k];
        T.neck = [-.06 * k, 0, 0];
        T.armL = [sw * .8 * k, 0, .12]; T.armR = [-sw * .8 * k, 0, -.12];
        T.foreL = [-.3 - Math.max(0, -sw) * .5 * k, 0, 0]; T.foreR = [-.3 - Math.max(0, sw) * .5 * k, 0, 0];
        T.legL = [-sw * .95 * k, 0, 0]; T.legR = [sw * .95 * k, 0, 0];
        T.shinL = [Math.max(0, sw) * 1.15 * k + .08, 0, 0]; T.shinR = [Math.max(0, -sw) * 1.15 * k + .08, 0, 0];
        hipsY = Math.abs(cw) * .045 * k;
        break;
      }
      case 'jump': {
        T.torso = [.16, 0, 0];
        T.armL = [.5, 0, .55]; T.armR = [.5, 0, -.55];
        T.foreL = [-.7, 0, 0]; T.foreR = [-.7, 0, 0];
        T.legL = [-.45, 0, 0]; T.legR = [-.25, 0, 0];
        T.shinL = [.85, 0, 0]; T.shinR = [.5, 0, 0];
        break;
      }
      case 'fall': {
        T.torso = [-.06, 0, 0];
        T.armL = [.9, 0, .9]; T.armR = [.9, 0, -.9];
        T.foreL = [-.4, 0, 0]; T.foreR = [-.4, 0, 0];
        T.legL = [-.2, 0, .08]; T.legR = [.05, 0, -.08];
        T.shinL = [.4, 0, 0]; T.shinR = [.25, 0, 0];
        break;
      }
      case 'glide': {
        T.torso = [.5, 0, 0];
        T.armL = [2.6, 0, .35]; T.armR = [2.6, 0, -.35];
        T.foreL = [-.2, 0, 0]; T.foreR = [-.2, 0, 0];
        T.legL = [.25 + sw * .04, 0, .04]; T.legR = [.3 - sw * .04, 0, -.04];
        T.shinL = [.35, 0, 0]; T.shinR = [.3, 0, 0];
        T.neck = [-.35, 0, 0];
        break;
      }
      case 'climb': {
        const c = Math.sin(opt.climbPhase ?? 0);
        T.torso = [-.25, 0, 0];
        T.armL = [2.5 + c * .4, 0, .3]; T.armR = [2.5 - c * .4, 0, -.3];
        T.foreL = [-.5, 0, 0]; T.foreR = [-.5, 0, 0];
        T.legL = [-.7 - c * .3, 0, .15]; T.legR = [-.7 + c * .3, 0, -.15];
        T.shinL = [1 + c * .3, 0, 0]; T.shinR = [1 - c * .3, 0, 0];
        T.neck = [.5, 0, 0];
        break;
      }
      case 'swim': {
        const s2 = Math.sin(p * 1.6), c2 = Math.cos(p * 1.6);
        T.torso = [1.25, 0, 0];
        T.neck = [-.9, 0, 0];
        T.armL = [2.8 + s2 * .8, 0, .3]; T.armR = [2.8 - s2 * .8, 0, -.3];
        T.foreL = [-.3, 0, 0]; T.foreR = [-.3, 0, 0];
        T.legL = [1.35 + c2 * .35, 0, .05]; T.legR = [1.35 - c2 * .35, 0, -.05];
        T.shinL = [.3, 0, 0]; T.shinR = [.3, 0, 0];
        break;
      }
      case 'throw': {
        const t = clamp(opt.throwT ?? 0, 0, 1); // 0蓄力 → 1掷出
        if (t < .45) { // 蓄力
          const w = t / .45;
          T.torso = [.05, -.7 * w, 0];
          T.armR = [2.6 * w, 0, -.4 * w];
          T.foreR = [-.9 * w, 0, 0];
          T.armL = [.4 * w, 0, .3];
        } else { // 掷出
          const w = (t - .45) / .55;
          T.torso = [.18, lerp(-.7, .5, w), 0];
          T.armR = [lerp(2.6, .5, easeThrow(w)), 0, -.1];
          T.foreR = [lerp(-.9, -.1, w), 0, 0];
          T.armL = [.2, 0, .35];
        }
        T.legL = [-.15, 0, .04]; T.legR = [.2, 0, -.04];
        T.shinL = [.25, 0, 0]; T.shinR = [.12, 0, 0];
        break;
      }
      case 'ride': {
        T.torso = [.12, 0, 0];
        T.armL = [.55, 0, .25]; T.armR = [.55, 0, -.25];
        T.foreL = [-.75, 0, 0]; T.foreR = [-.75, 0, 0];
        T.legL = [-1.15, 0, .5]; T.legR = [-1.15, 0, -.5];
        T.shinL = [1.3, 0, 0]; T.shinR = [1.3, 0, 0];
        break;
      }
    }

    // 姿态混合
    const rate = state === 'throw' ? 22 : 13;
    for (const key in this.j) {
      const tgt = T[key] || [0, 0, 0];
      const j = this.j[key];
      j.rotation.x = dampAngle(j.rotation.x, tgt[0], rate, dt);
      j.rotation.y = dampAngle(j.rotation.y, tgt[1], rate, dt);
      j.rotation.z = dampAngle(j.rotation.z, tgt[2], rate, dt);
    }
    this.j.hips.position.y = lerp(this.j.hips.position.y, .62 + hipsY + (state === 'ride' ? .12 : 0), .3);
    this.glider.visible = state === 'glide';
    if (state === 'glide') this.glider.rotation.z = Math.sin(opt.time * 1.3) * .06;
  }
}

function easeThrow(t) { return 1 - Math.pow(1 - t, 3); }

function roundBox(w, h, d, r) {
  // 简化圆角盒: 用带斜面的 BoxGeometry 近似
  const g = new THREE.BoxGeometry(w, h, d, 2, 2, 2);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const inner = new THREE.Vector3(
      clamp(v.x, -w / 2 + r, w / 2 - r),
      clamp(v.y, -h / 2 + r, h / 2 - r),
      clamp(v.z, -d / 2 + r, d / 2 - r));
    const dir = v.clone().sub(inner);
    if (dir.length() > 0) { dir.setLength(r); v.copy(inner).add(dir); }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function buildGlider() {
  const g = new THREE.Group();
  // 伞翼: 弯曲布面
  const seg = 10;
  const geo = new THREE.PlaneGeometry(2.6, .9, seg, 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setY(i, pos.getY(i) * (1 - Math.abs(x) * .12));
    pos.setZ(i, -Math.pow(Math.abs(x) / 1.3, 1.7) * .65);
  }
  geo.computeVertexNormals();
  geo.rotateX(Math.PI / 2);
  const colors = [];
  const cA = new THREE.Color('#ff6b7d'), cB = new THREE.Color('#fff4f5');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const c = (Math.floor((x + 1.3) / 2.6 * seg) % 2 === 0) ? cA : cB;
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const wing = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: .8 }));
  wing.position.y = 2.45;
  g.add(wing);
  // 吊绳
  const strM = new THREE.LineBasicMaterial({ color: 0x444a58 });
  for (const s of [-1, 1]) {
    const pts = [new THREE.Vector3(.25 * s, 1.55, 0), new THREE.Vector3(.9 * s, 2.42, -.1)];
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), strM));
    const pts2 = [new THREE.Vector3(.25 * s, 1.55, 0), new THREE.Vector3(.35 * s, 2.48, -.2)];
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts2), strM));
  }
  return g;
}
