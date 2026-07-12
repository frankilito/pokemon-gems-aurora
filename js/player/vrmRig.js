// VRM 人形骨骼程序化姿态驱动
// 思路：每个状态给出肢体的"指向向量"(角色空间)，用 setFromUnitVectors 求四元数，
// 逐骨平滑 slerp —— 无需烘焙动画剪辑，与游戏状态机直接对接。
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _qp = new THREE.Quaternion();
const _e = new THREE.Euler();
const QX = (a, out = new THREE.Quaternion()) => out.setFromAxisAngle(AXIS_X, a);
const AXIS_X = V(1, 0, 0), AXIS_Y = V(0, 1, 0), AXIS_Z = V(0, 0, 1);

// 归一化人形骨骼 rest 方向(VRM0 rotateVRM0 后角色面朝 -Z, 左手 -X)
const REST = {
  leftUpperArm: V(-1, 0, 0), leftLowerArm: V(-1, 0, 0),
  rightUpperArm: V(1, 0, 0), rightLowerArm: V(1, 0, 0),
  leftUpperLeg: V(0, -1, 0), leftLowerLeg: V(0, -1, 0),
  rightUpperLeg: V(0, -1, 0), rightLowerLeg: V(0, -1, 0),
};
// 人类直觉空间(x=角色左,+z=角色前) → VRM 空间(x,z 取反)
const _h = new THREE.Vector3();
const H2V = d => _h.set(-d.x, d.y, -d.z);

const BONES = ['hips', 'spine', 'chest', 'neck', 'head',
  'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'];

export class VRMRig {
  constructor(vrm) {
    this.vrm = vrm;
    this.b = {};
    for (const n of BONES) this.b[n] = vrm.humanoid.getNormalizedBoneNode(n);
    this.restHipsY = this.b.hips.position.y;
    this.phase = 0;
    this.state = 'idle';
    this.blinkT = 2 + Math.random() * 3;
    this.blinkV = 0;
    this.lookT = 3 + Math.random() * 3;
    this.lookYaw = 0; this.lookCur = 0;
    // 目标/当前 四元数缓存
    this.tgt = {}; this.cur = {};
    for (const n of BONES) { this.tgt[n] = new THREE.Quaternion(); this.cur[n] = new THREE.Quaternion(); }
    this.hipsYOff = 0; this.hipsYCur = 0;
  }

  // ---- 姿态原语(方向均以人类直觉空间书写: x=左, y=上, z=前) ----
  // 手臂链: 肩点方向 aU + 前臂方向 aL → upper/lower 四元数
  arm(side, aU, aL, spineQ) {
    const U = side + 'UpperArm', L = side + 'LowerArm';
    _qp.copy(spineQ).invert();
    _v.copy(H2V(aU)).applyQuaternion(_qp).normalize();
    this.tgt[U].setFromUnitVectors(REST[U], _v);
    // lower 在 upper 空间
    _qp.copy(spineQ).multiply(this.tgt[U]).invert();
    _v.copy(H2V(aL)).applyQuaternion(_qp).normalize();
    this.tgt[L].setFromUnitVectors(REST[L], _v);
    this.tgt[side + 'Hand'].identity();
  }
  // 腿链: 大腿方向 + 小腿方向; 脚保持贴地(补偿俯仰)
  leg(side, dU, dL, footFlat = 1) {
    const U = side + 'UpperLeg', L = side + 'LowerLeg';
    _v.copy(H2V(dU)).normalize();
    this.tgt[U].setFromUnitVectors(REST[U], _v);
    _qp.copy(this.tgt[U]).invert();
    const lv = H2V(dL);
    _v.copy(lv).applyQuaternion(_qp).normalize();
    this.tgt[L].setFromUnitVectors(REST[L], _v);
    const pitchL = Math.atan2(lv.z, -lv.y);
    QX(-pitchL * footFlat, this.tgt[side + 'Foot']);
  }
  spineChain(rx, ry, rz, neckRx = 0, neckRy = 0) {
    // 人类直觉: rx+=前倾, ry+=左转, rz+=左倾 → VRM(-Z 朝向): rx/rz 取反
    rx = -rx; rz = -rz; neckRx = -neckRx;
    this.tgt.spine.setFromEuler(_e.set(rx * .55, ry * .5, rz * .6));
    if (this.b.chest) this.tgt.chest.setFromEuler(_e.set(rx * .45, ry * .5, rz * .4));
    else this.tgt.spine.setFromEuler(_e.set(rx, ry, rz));
    this.tgt.neck.setFromEuler(_e.set(neckRx * .5, neckRy * .5, 0));
    this.tgt.head.setFromEuler(_e.set(neckRx * .5, neckRy * .5, rz * .3));
    // 返回躯干整体四元数(供手臂求解)
    return _q.copy(this.tgt.spine).multiply(this.tgt.chest);
  }
  hipsRot(rx, ry = 0, rz = 0) { this.tgt.hips.setFromEuler(_e.set(-rx, ry, -rz)); }

  // ---- 主更新 ----
  update(dt, state, opt = {}) {
    this.state = state;
    const spd = opt.speed ?? 0;
    this.phase += dt * Math.min(spd, 14) * 1.35;
    const p = this.phase, t = opt.time ?? 0;
    const sw = Math.sin(p), cw = Math.cos(p);
    let hipsY = 0, rate = 14;
    this.hipsRot(0);

    switch (state) {
      case 'idle': {
        const br = Math.sin(t * 1.9);
        // 偶发张望
        this.lookT -= dt;
        if (this.lookT <= 0) { this.lookT = 2.5 + Math.random() * 4; this.lookYaw = (Math.random() - .5) * 1.1; }
        this.lookCur += (this.lookYaw - this.lookCur) * Math.min(1, dt * 3);
        const sq = this.spineChain(.03 + br * .012, 0, 0, br * .02, this.lookCur);
        this.arm('left', V(.30, -1, -.02), V(.26, -1, .16), sq);
        this.arm('right', V(-.30, -1, -.02), V(-.26, -1, .16), sq);
        this.leg('left', V(.03, -1, .01), V(.02, -1, -.04));
        this.leg('right', V(-.03, -1, -.02), V(-.02, -1, -.06));
        hipsY = br * .006;
        rate = 7;
        break;
      }
      case 'walk': case 'run': case 'sprint': {
        const k = state === 'walk' ? .5 : state === 'run' ? .82 : 1.05;
        const sneak = state === 'walk' && opt.sneak;
        const lean = sneak ? .34 : state === 'walk' ? .05 : state === 'run' ? .14 : .24;
        const sq = this.spineChain(lean + Math.abs(cw) * .02 * k, -sw * .06 * k, sw * .03 * k, -lean * .55, 0);
        // 臂摆(与腿反相); 潜行时收臂
        const aswing = (sneak ? .3 : .62) * k;
        this.arm('left', V(.24, -1, -sw * aswing), V(.2, -1, -sw * aswing + .34 * k + Math.max(0, -sw) * .5 * k), sq);
        this.arm('right', V(-.24, -1, sw * aswing), V(-.2, -1, sw * aswing + .34 * k + Math.max(0, sw) * .5 * k), sq);
        // 腿摆 + 膝弯(后摆腿收膝); 潜行屈膝压低
        const lswing = .62 * k;
        const crouch = sneak ? .4 : 0;
        const kneeL = Math.max(0, -sw) * 1.05 * k + .06 + crouch, kneeR = Math.max(0, sw) * 1.05 * k + .06 + crouch;
        this.leg('left', V(.02, -1, sw * lswing + crouch * .5), V(.02, -1, sw * lswing - kneeL), .75);
        this.leg('right', V(-.02, -1, -sw * lswing + crouch * .5), V(-.02, -1, -sw * lswing - kneeR), .75);
        hipsY = Math.abs(cw) * .05 * k - crouch * .16;
        rate = 15;
        break;
      }
      case 'jump': {
        const sq = this.spineChain(.14, 0, 0, -.1, 0);
        this.arm('left', V(.7, -.45, -.3), V(.62, -.2, .5), sq);
        this.arm('right', V(-.7, -.45, -.3), V(-.62, -.2, .5), sq);
        this.leg('left', V(.04, -1, .5), V(.03, -1, -.55), 0);
        this.leg('right', V(-.04, -1, .18), V(-.03, -1, -.5), 0);
        break;
      }
      case 'fall': {
        const fl = Math.sin(t * 9) * .1;
        const sq = this.spineChain(-.08, 0, 0, .16, 0);
        this.arm('left', V(.92, .55 + fl, -.15), V(.7, .85, .1), sq);
        this.arm('right', V(-.92, .55 - fl, -.15), V(-.7, .85, .1), sq);
        this.leg('left', V(.06, -1, .28), V(.05, -1, -.3), 0);
        this.leg('right', V(-.08, -1, -.06), V(-.06, -1, -.4), 0);
        break;
      }
      case 'glide': {
        const sway = Math.sin(t * 1.3) * .05;
        this.hipsRot(.62, 0, sway * .4);
        const sq = this.spineChain(.28, 0, sway, -.62, 0);
        // 双手上举抓滑翔伞握把
        this.arm('left', V(.42, .88, .12), V(.14, .95, .06), sq);
        this.arm('right', V(-.42, .88, .12), V(-.14, .95, .06), sq);
        this.leg('left', V(.03, -1, -.22 - sway * .3), V(.02, -1, -.5), 0);
        this.leg('right', V(-.03, -1, -.28 + sway * .3), V(-.02, -1, -.52), 0);
        rate = 8;
        break;
      }
      case 'climb': {
        const c = Math.sin(opt.climbPhase ?? 0);
        this.hipsRot(-.14, 0, 0);
        const sq = this.spineChain(-.12, 0, 0, .55, 0);
        // 交替向上抓
        this.arm('left', V(.34, .92 + c * .12, .18), V(.12, .9, .3), sq);
        this.arm('right', V(-.34, .92 - c * .12, .18), V(-.12, .9, .3), sq);
        this.leg('left', V(.06, -1, .38 + c * .22), V(.05, -1, -.5), 0);
        this.leg('right', V(-.06, -1, .38 - c * .22), V(-.05, -1, -.5), 0);
        hipsY = Math.abs(c) * .02;
        rate = 10;
        break;
      }
      case 'swim': {
        const s2 = Math.sin(p * 1.35), c2 = Math.cos(p * 1.35);
        this.hipsRot(1.32, 0, s2 * .06);
        const sq = this.spineChain(.1, -s2 * .1, 0, -.95, 0);
        // 自由泳划水轮转
        const aL = V(Math.cos(p * 1.35) * .5 + .3, s2 * .95, c2 * .5 + .3);
        const aR = V(-(Math.cos(p * 1.35 + Math.PI) * .5 + .3), -s2 * .95, -c2 * .5 + .3);
        this.arm('left', aL, V(aL.x * .7, aL.y * .8, aL.z + .4), sq);
        this.arm('right', aR, V(aR.x * .7, aR.y * .8, aR.z + .4), sq);
        // 打腿
        this.leg('left', V(.03, -1, .1 + c2 * .16), V(.02, -1, -.14 + c2 * .1), 0);
        this.leg('right', V(-.03, -1, .1 - c2 * .16), V(-.02, -1, -.14 - c2 * .1), 0);
        rate = 11;
        break;
      }
      case 'throw': {
        const tt = Math.min(Math.max(opt.throwT ?? 0, 0), 1);
        rate = 26;
        if (tt < .45) { // 蓄力: 右臂后引, 躯干右拧
          const w = tt / .45;
          const sq = this.spineChain(.04, -.6 * w, 0, .1, .5 * w);
          this.arm('right', V(-.6, .5 * w, -.62 * w), V(-.4, .85 * w, -.5 * w), sq);
          this.arm('left', V(.55, -.5, .5 * w), V(.4, -.35, .75 * w), sq);
        } else { // 掷出: 鞭打向前
          const w = (tt - .45) / .55, e = 1 - Math.pow(1 - w, 3);
          const sq = this.spineChain(.16, THREE.MathUtils.lerp(-.6, .42, e), 0, .05, THREE.MathUtils.lerp(.5, -.2, e));
          this.arm('right', V(-.3, THREE.MathUtils.lerp(.5, -.15, e), THREE.MathUtils.lerp(-.62, .95, e)), V(-.2, THREE.MathUtils.lerp(.85, -.1, e), THREE.MathUtils.lerp(-.5, .98, e)), sq);
          this.arm('left', V(.55, -.72, .3), V(.42, -.62, .5), sq);
        }
        this.leg('left', V(.05, -1, .16), V(.04, -1, -.12));
        this.leg('right', V(-.05, -1, -.2), V(-.04, -1, -.3));
        break;
      }
      case 'ride': {
        const sq = this.spineChain(.1, 0, 0, -.08, 0);
        // 手向前下握缰
        this.arm('left', V(.4, -.62, .55), V(.22, -.3, .85), sq);
        this.arm('right', V(-.4, -.62, .55), V(-.22, -.3, .85), sq);
        // 腿外分屈膝夹坐骑
        this.leg('left', V(.52, -.78, .3), V(.3, -1, -.72), 0);
        this.leg('right', V(-.52, -.78, .3), V(-.3, -1, -.72), 0);
        hipsY = .1;
        rate = 9;
        break;
      }
      case 'sit': {
        const sq = this.spineChain(.06, 0, 0, .04, 0);
        this.arm('left', V(.32, -.9, .2), V(.2, -.6, .7), sq);
        this.arm('right', V(-.32, -.9, .2), V(-.2, -.6, .7), sq);
        this.leg('left', V(.08, -.25, .96), V(.06, -1, -.12), 0);
        this.leg('right', V(-.08, -.25, .96), V(-.06, -1, -.12), 0);
        hipsY = -.28;
        break;
      }
    }

    // ---- 平滑逼近 ----
    const a = 1 - Math.exp(-rate * dt);
    for (const n of BONES) {
      const bone = this.b[n];
      if (!bone) continue;
      this.cur[n].slerp(this.tgt[n], a);
      bone.quaternion.copy(this.cur[n]);
    }
    this.hipsYCur += (hipsY - this.hipsYCur) * a;
    this.b.hips.position.y = this.restHipsY + this.hipsYCur;

    // ---- 眨眼 ----
    const em = this.vrm.expressionManager;
    if (em) {
      this.blinkT -= dt;
      if (this.blinkT <= 0) { this.blinkT = 1.8 + Math.random() * 3.5; this.blinkV = 1; }
      if (this.blinkV > 0) {
        this.blinkV = Math.max(0, this.blinkV - dt * 7);
        em.setValue('blink', Math.sin((1 - this.blinkV) * Math.PI));
      }
    }

    this.vrm.update(dt);   // 归一化骨→原始骨 + 弹簧骨(头发/裙摆) + 表情
  }
}
