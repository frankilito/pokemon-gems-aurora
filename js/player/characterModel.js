// 高清 VRM 化身：VRoid 模型 + 程序化全状态骨骼驱动(vrmRig)
// 与 HumanModel/TrainerModel 同接口: root / ready / phase / update(dt, state, opt)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from 'three-vrm';
import { VRMRig } from './vrmRig.js';
import { TrainerModel, buildGlider } from './trainerModel.js';

THREE.Cache.enabled = true;   // 同文件多实例复用网络层
const loader = new GLTFLoader();
loader.register(p => new VRMLoaderPlugin(p));

export class CharacterModel {
  // opts: { vrm:'player_m', height, pal(兜底配色), lazy(延迟加载), noFallback }
  constructor(opts = {}) {
    this.opts = opts;
    this.root = new THREE.Group();
    this.root.name = 'vrmChar';
    this.ready = false;
    this.phase = 0;
    this.state = 'idle';
    this.dead = false;
    // 程序化兜底(加载期间/失败时可见)
    if (!opts.noFallback) {
      this.fallback = new TrainerModel(opts.pal ?? {});
      this.root.add(this.fallback.root);
    }
    this.glider = buildGlider();
    this.glider.visible = false;
    this.root.add(this.glider);
    if (!opts.lazy) this.load();
  }

  async load() {
    if (this._loading || this.ready || this.dead) return;
    this._loading = true;
    const file = `assets/models/chars/${this.opts.vrm ?? 'player_m'}.vrm`;
    try {
      const gltf = await loader.loadAsync(file);
      if (this.dead) return;
      const vrm = gltf.userData.vrm;
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.combineSkeletons?.(gltf.scene);
      VRMUtils.rotateVRM0(vrm);        // VRM0 统一为面朝 -Z
      vrm.scene.rotation.y = Math.PI;  // 游戏约定 yaw=0 面朝 +Z
      let meshCount = 0;
      vrm.scene.traverse(o => {
        if (o.isMesh || o.isSkinnedMesh) {
          o.castShadow = true;
          o.frustumCulled = false;     // 蒙皮网格包围球不可靠
          meshCount++;
          if (o.material?.map) o.material.map.anisotropy = 8;
        }
      });
      // 身高归一
      const box = new THREE.Box3().setFromObject(vrm.scene);
      const h = Math.max(.01, box.max.y - box.min.y);
      const scale = (this.opts.height ?? 1.62) / h;
      const holder = new THREE.Group();
      holder.scale.setScalar(scale);
      holder.add(vrm.scene);
      this.root.add(holder);
      this.vrm = vrm;
      this.rig = new VRMRig(vrm);
      if (this.fallback) { this.root.remove(this.fallback.root); this.fallback = null; }
      this.ready = true;
    } catch (e) {
      console.warn('[vrm] 加载失败, 使用程序化兜底', file, e.message);
    }
    this._loading = false;
  }

  // 表情快捷通道(捕捉成功/受击等演出用)
  emote(name, v = 1, holdMs = 1200) {
    const em = this.vrm?.expressionManager;
    if (!em) return;
    try {
      em.setValue(name, v);
      if (holdMs) setTimeout(() => { try { em.setValue(name, 0); } catch {} }, holdMs);
    } catch {}
  }

  update(dt, state, opt = {}) {
    this.state = state;
    if (this.rig) {
      this.rig.update(dt, state, opt);
      this.phase = this.rig.phase;
    } else if (this.fallback) {
      this.fallback.update(dt, state, opt);
      this.phase = this.fallback.phase;
    }
    this.glider.visible = state === 'glide';
    if (state === 'glide') this.glider.rotation.z = Math.sin((opt.time ?? 0) * 1.3) * .06;
  }

  dispose() {
    this.dead = true;
    if (this.vrm) {
      VRMUtils.deepDispose(this.vrm.scene);
      this.vrm = null; this.rig = null;
    }
    this.root.removeFromParent();
  }
}
