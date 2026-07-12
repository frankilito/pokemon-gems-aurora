// 地标建筑：曦光镇/道馆/遗迹石柱/极光神殿 (程序化+碰撞)
import * as THREE from 'three';
import { G } from '../core/engine.js';
import { getHeight, WORLD } from './terrain.js';
import { makeHouse, makeGym, GLASS_POOL } from './buildingKit.js';

const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: .9, ...o });

export class Landmarks {
  constructor(scene, world) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.world = world;
    this.interactables = [];   // {x,z,r,name,type,data}
    this.buildTown();
    this.buildGyms();
    this.buildRuins();
    this.buildTemple();
    this.buildCaveProps();
  }

  add(mesh, x, z, collR = 0, y = null) {
    mesh.position.set(x, y ?? getHeight(x, z), z);
    this.group.add(mesh);
    if (collR > 0) this.world.addCollider(x, z, collR);
    return mesh;
  }
  poi(x, z, r, name, type, data = {}) { this.interactables.push({ x, z, r, name, type, ...data }); }

  house(w = 4, d = 4.5, hgt = 2.6, wall = '#f5ead8', roof = '#e0705a') {
    return makeHouse({ w, d, hgt, wall, roof });
  }

  buildTown() {
    const T = WORLD.town;
    // 研究所(大)
    const lab = this.house(7, 5.5, 3.2, '#e8eef8', '#5a7ba6');
    const dish = new THREE.Mesh(new THREE.SphereGeometry(.9, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), M('#cfd8ea'));
    dish.rotation.z = .8; dish.position.set(1.8, 6.9, 0);
    lab.add(dish);
    this.add(lab, T.x + 18, T.z - 22, 4.6);
    this.poi(T.x + 18, T.z - 18.5, 3, '青柏研究所', 'lab');

    // 商店
    const shop = this.house(4.5, 4, 2.6, '#fdf3dd', '#4f9fd8');
    const sign = new THREE.Mesh(new THREE.BoxGeometry(2.4, .6, .12), M('#4f9fd8', { emissive: '#1f4f7d', emissiveIntensity: .5 }));
    sign.position.set(0, 2.62, 2.42);
    shop.add(sign);
    this.add(shop, T.x - 16, T.z - 12, 3.6);
    this.poi(T.x - 16, T.z - 9, 2.8, '友好商店', 'shop');

    // 宝可梦中心
    const pc = this.house(5, 4.5, 2.8, '#fff0f0', '#e8556a');
    const ball = new THREE.Mesh(new THREE.SphereGeometry(.5, 12, 10), M('#e8404f'));
    ball.position.set(0, 5.72, 0);
    pc.add(ball);
    this.add(pc, T.x - 2, T.z + 20, 4);
    this.poi(T.x - 2, T.z + 16.8, 2.8, '宝可梦中心', 'heal');

    // 民居×4
    const spots = [[T.x + 26, T.z + 10], [T.x - 30, T.z + 14], [T.x + 8, T.z - 38], [T.x - 34, T.z - 30]];
    for (const [x, z] of spots) this.add(this.house(3.8 + Math.random(), 4 + Math.random(), 2.4, ['#f5ead8', '#f2dfc8', '#e8f0dd'][Math.random() * 3 | 0]), x, z, 3.4);

    // 中央喷泉
    const fountain = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.5, .5, 14), M('#cfd4de'));
    base.position.y = .25;
    const pool = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, .3, 14), M('#57c8e8', { emissive: '#1f6fc4', emissiveIntensity: .3 }));
    pool.position.y = .5;
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(.3, .4, 1.4, 10), M('#cfd4de'));
    pillar.position.y = 1.2;
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(.5), M('#7dd8ff', { emissive: '#2a8ad8', emissiveIntensity: .8, metalness: .3, roughness: .2 }));
    gem.position.y = 2.2;
    fountain.add(base, pool, pillar, gem);
    fountain.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.add(fountain, T.x, T.z, 2.6);
    this.gemSpin = gem;

    // 路灯
    for (const [x, z] of [[T.x + 8, T.z + 8], [T.x - 8, T.z - 8], [T.x + 8, T.z - 8], [T.x - 8, T.z + 8]]) {
      const lamp = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.07, .09, 2.6, 8), M('#3a4152'));
      pole.position.y = 1.3;
      const head = new THREE.Mesh(new THREE.SphereGeometry(.22, 10, 8), M('#ffe8b0', { emissive: '#ffb84d', emissiveIntensity: 1.2 }));
      head.position.y = 2.7;
      lamp.add(pole, head);
      this.add(lamp, x, z, .3);
    }
  }

  gymBuilding(color, icon) {
    return makeGym(color);
  }

  buildGyms() {
    // 岩馆(遗迹旁) / 水馆(镜湖东岸) / 火馆(火山南麓)
    const defs = [
      ['rock', '#c2ab6e', WORLD.ruins.x - 60, WORLD.ruins.z + 60, '磐岩道馆'],
      ['water', '#4f8fff', WORLD.lake.x + 120, WORLD.lake.z + 60, '澜心道馆'],
      ['fire', '#ff8a54', WORLD.volcano.x - 40, WORLD.volcano.z + 150, '炎督道馆'],
    ];
    for (const [key, color, x, z, name] of defs) {
      this.add(this.gymBuilding(color), x, z, 5.6);
      this.poi(x, z + 6.5, 3.4, name, 'gym', { gym: key });
    }
  }

  buildRuins() {
    const R = WORLD.ruins;
    // 环形断柱阵
    const N = 9;
    this.ruinPillars = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const x = R.x + Math.cos(a) * 26, z = R.z + Math.sin(a) * 26;
      const broken = i % 3 === 0;
      const h = broken ? 2 + Math.random() * 1.5 : 5.5;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(.85, 1, h, 9), M('#d8d0b0', { roughness: .95 }));
      pillar.position.y = h / 2;
      const cap = !broken ? new THREE.Mesh(new THREE.BoxGeometry(2.2, .5, 2.2), M('#cfc7a8')) : null;
      const g = new THREE.Group();
      g.add(pillar);
      if (cap) { cap.position.y = h + .25; g.add(cap); }
      g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.add(g, x, z, 1.2);
      this.ruinPillars.push({ x, z, mesh: g });
    }
    // 中央祭坛
    const altar = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.8, .8, 10), M('#cfc7a8'));
    slab.position.y = .4;
    const stone = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), M('#9a8fd8', { emissive: '#4a3a9a', emissiveIntensity: .6 }));
    stone.position.y = 1.9;
    altar.add(slab, stone);
    altar.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.add(altar, R.x, R.z, 3.6);
    this.altarStone = stone;
    this.poi(R.x, R.z + 4.6, 3, '星陨祭坛', 'altar');
  }

  buildTemple() {
    const T = WORLD.temple;
    const g = new THREE.Group();
    // 阶梯平台
    for (let i = 0; i < 3; i++) {
      const s = 14 - i * 3.4;
      const step = new THREE.Mesh(new THREE.CylinderGeometry(s, s + 1, 1.1, 10), M('#e8eef8', { roughness: .8 }));
      step.position.y = i * 1.1 + .55;
      g.add(step);
    }
    // 极光柱环
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(.6, .7, 7, 8), M('#dfe9f5'));
      p.position.set(Math.cos(a) * 8, 6.8, Math.sin(a) * 8);
      g.add(p);
      const cap = new THREE.Mesh(new THREE.OctahedronGeometry(.8), M('#7dd8ff', { emissive: '#37e0b8', emissiveIntensity: .9 }));
      cap.position.set(Math.cos(a) * 8, 10.8, Math.sin(a) * 8);
      g.add(cap);
    }
    // 中央水晶
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.8, 0), new THREE.MeshStandardMaterial({
      color: '#b8f0ff', emissive: '#4ea6ff', emissiveIntensity: 1, transparent: true, opacity: .92, metalness: .2, roughness: .1,
    }));
    crystal.position.y = 6.4;
    g.add(crystal);
    this.templeCrystal = crystal;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.add(g, T.x, T.z, 0);
    this.world.addCollider(T.x, T.z, 3);
    this.poi(T.x, T.z + 12, 4, '极光神殿', 'temple');
  }

  buildCaveProps() {
    const C = WORLD.cave;
    // 洞口拱环 + 大水晶簇
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = C.x + Math.cos(a) * (C.r * .75), z = C.z + Math.sin(a) * (C.r * .75);
      const cr = new THREE.Mesh(new THREE.ConeGeometry(.5 + Math.random() * .5, 1.8 + Math.random() * 2, 5),
        M('#8a7ad8', { emissive: '#5a3aba', emissiveIntensity: .7, transparent: true, opacity: .9 }));
      cr.rotation.z = (Math.random() - .5) * .5;
      this.add(cr, x, z, .8, getHeight(x, z) + .8);
    }
  }

  update(dt) {
    // 夜晚窗户暖光
    const night = G.sky?.uniforms?.uNight?.value ?? 0;
    if (Math.abs(night - (this._lastNight ?? -1)) > .02) {
      this._lastNight = night;
      for (const m of GLASS_POOL) m.emissiveIntensity = night * 1.35;
    }
    if (this.gemSpin) { this.gemSpin.rotation.y += dt; this.gemSpin.position.y = 2.2 + Math.sin(G.time * 1.4) * .12; }
    if (this.altarStone) this.altarStone.rotation.y += dt * .5;
    if (this.templeCrystal) {
      this.templeCrystal.rotation.y += dt * .6;
      this.templeCrystal.material.emissiveIntensity = 1 + Math.sin(G.time * 2.4) * .4;
    }
  }
}
