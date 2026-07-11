// 引擎核心：渲染器/场景/主循环/事件总线/全局上下文
import * as THREE from 'three';

export const G = {
  renderer: null, scene: null, camera: null,
  canvas: null,
  time: 0, dt: 0,
  world: null, sky: null, weather: null, player: null, spawner: null,
  battle: null, ui: {}, audio: null, save: null, quests: null, net: null,
  dex: null,           // 图鉴数据 (species/moves)
  state: 'boot',       // boot | title | roam | battle | dialog | menu | cine
  flags: {},           // 剧情旗标
  updaters: new Set(),
  events: new Map(),
  debug: new URLSearchParams(location.search),
};

export function on(ev, fn) { (G.events.get(ev) || G.events.set(ev, new Set()).get(ev)).add(fn); return fn; }
export function off(ev, fn) { G.events.get(ev)?.delete(fn); }
export function emit(ev, data) { G.events.get(ev)?.forEach(fn => fn(data)); }

export function initEngine() {
  const canvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, .1, 4000);
  camera.position.set(0, 30, 60);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  Object.assign(G, { renderer, scene, camera, canvas });

  const clock = new THREE.Clock();
  let acc = 0, frames = 0, fpsT = 0;
  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 1 / 20);
    G.dt = dt; G.time += dt;
    for (const fn of G.updaters) fn(dt);
    renderer.render(scene, camera);
    frames++; fpsT += dt;
    if (fpsT >= 2) { G.fps = frames / fpsT; frames = 0; fpsT = 0; }
  }
  loop();
  return G;
}

export function addUpdate(fn) { G.updaters.add(fn); return fn; }
export function removeUpdate(fn) { G.updaters.delete(fn); }
