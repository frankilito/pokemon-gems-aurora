// 资源管线：GLB 加载/缓存/克隆、动画分类、身高归一化
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { clamp } from './math.js';
import { G } from './engine.js';

const gltfLoader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('vendor/three/examples/jsm/libs/draco/gltf/');
gltfLoader.setDRACOLoader(draco);

const monCache = new Map();   // key: "25" | "25s" → Promise<proto>
let manifest = { regular: [], shiny: [] };

export async function loadManifest() {
  try {
    manifest = await (await fetch('assets/data/models_manifest.json')).json();
  } catch (e) { console.warn('manifest missing', e); }
  return manifest;
}
export function hasShinyModel(id) { return manifest.shiny.includes(id); }
export function hasModel(id) { return manifest.regular.includes(id); }

// ---- 动画角色分类 ----
const ANIM_RULES = [
  ['idle',   /defaultwait|battlewait|\bwait\b|idle|stand|breath|loop_wait|^wait/i],
  ['walk',   /walk|move(?!nt)/i],
  ['run',    /run|dash|gallop/i],
  ['attack', /attack|atk|fight|waza|skill|shoot|shot|impac|tackle|hit_o|strike|beam|blast|punch|kick|bite|slash/i],
  ['hit',    /damage|hurt|hit(?!_o)|flinch/i],
  ['faint',  /\bko\b|die|death|down\b|faint|lose|defeat/i],
  ['jump',   /jump|hop/i],
  ['fly',    /fly|float|hover|glide/i],
  ['sleep',  /sleep|rest/i],
];
function classifyClips(clips) {
  const roles = {};
  for (const clip of clips) {
    const n = clip.name || '';
    for (const [role, re] of ANIM_RULES) {
      if (re.test(n) && !roles[role]) { roles[role] = clip; break; }
    }
  }
  // 兜底链
  if (!roles.idle) roles.idle = clips.find(c => /loop/i.test(c.name)) || clips[0];
  if (!roles.walk) roles.walk = roles.run || roles.idle;
  if (!roles.run) roles.run = roles.walk;
  if (!roles.attack) roles.attack = clips[1] || roles.idle;
  return roles;
}

// ---- 加载一只宝可梦模型原型 ----
export function loadMonProto(id, shiny = false) {
  const useShiny = shiny && hasShinyModel(id);
  const key = id + (useShiny ? 's' : '');
  if (monCache.has(key)) return monCache.get(key);
  const url = `assets/models/pokemon/${useShiny ? 'shiny' : 'regular'}/${id}.glb`;
  const p = gltfLoader.loadAsync(url).then(gltf => {
    const root = gltf.scene;
    // 计算包围盒 → 身高归一化
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const sp = G.dex?.species[id - 1];
    let targetH = sp ? clamp(sp.height * 0.1, 0.38, 5.2) : 1;
    // 小型且横宽的(如百变怪)以最大维度算
    const srcH = Math.max(size.y, 0.001);
    const scale = targetH / srcH;
    const center = box.getCenter(new THREE.Vector3());
    root.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = false;
        o.frustumCulled = true;
        if (o.material) {
          o.material.side = THREE.FrontSide;
          if (o.material.map) o.material.map.anisotropy = 4;
        }
      }
    });
    const roles = classifyClips(gltf.animations || []);
    return { root, clips: gltf.animations || [], roles, scale, center, size, srcH, targetH, shiny: useShiny, fallbackTint: shiny && !useShiny };
  }).catch(err => { console.warn('model fail', id, err); monCache.delete(key); return null; });
  monCache.set(key, p);
  return p;
}

// ---- 实例化(克隆) ----
export function cloneMon(proto) {
  const inst = SkeletonUtils.clone(proto.root);
  inst.scale.setScalar(proto.scale);
  return inst;
}

// 闪光兜底: 色相偏移材质
export function applyShinyTint(inst) {
  inst.traverse(o => {
    if (o.isMesh && o.material) {
      o.material = o.material.clone();
      o.material.color = new THREE.Color(1.15, 0.95, 1.3);
      if (o.material.emissive) o.material.emissive = new THREE.Color(0x221133);
    }
  });
}

export const artPath = id => `assets/art/${id}.png`;
export const spritePath = (id, back = false) => `assets/sprites/${id}${back ? '_back' : ''}.png`;
export const cryPath = id => `assets/cries/${id}.ogg`;

// 预热常用模型
export function warmup(ids) { for (const id of ids) loadMonProto(id); }
