// 生成器：群系×昼夜×天气 出没表 / 群落 / 闪光 / 传说驻守
import * as THREE from 'three';
import { G, addUpdate, emit, on } from '../core/engine.js';
import { makeWild } from './pokemon.js';
import { MonActor, isWaterOnly } from './monActor.js';
import { getHeight, getBiome, WORLD } from '../world/world.js';
import { clamp, TAU } from '../core/math.js';

// d=白天 n=夜晚 r=雨天加成 herd=群落 rare权重低
// 每群系: [id, 权重, 最低lv, 最高lv, 标记]
export const TABLES = {
  grass: [
    [16, 30, 2, 7, 'd,herd'], [19, 30, 2, 7, 'herd'], [10, 18, 2, 5, 'd'], [13, 14, 2, 5, 'd'],
    [21, 16, 3, 8, ''], [29, 12, 4, 9, ''], [32, 12, 4, 9, ''], [43, 14, 4, 9, 'n'],
    [39, 8, 4, 9, 'n'], [56, 8, 5, 10, ''], [52, 8, 4, 9, 'n'], [83, 4, 6, 10, 'd'],
    [84, 8, 5, 10, 'herd'], [102, 6, 6, 11, ''], [108, 3, 7, 12, ''], [128, 5, 8, 14, 'd'],
    [133, 2.5, 6, 10, ''], [25, 3, 5, 10, ''], [143, .8, 16, 20, ''], [115, 1.5, 10, 15, ''],
    [137, .7, 10, 14, ''], [96, 7, 5, 10, 'n'],
  ],
  forest: [
    [10, 22, 3, 7, 'd'], [11, 10, 6, 10, 'd'], [13, 18, 3, 7, ''], [14, 8, 6, 10, ''],
    [16, 18, 3, 8, 'd,herd'], [17, 6, 9, 14, 'd'], [23, 12, 5, 11, ''], [25, 6, 6, 12, ''],
    [43, 16, 5, 11, 'n'], [44, 5, 12, 16, 'n'], [46, 12, 6, 12, ''], [48, 12, 6, 12, 'n'],
    [69, 14, 5, 11, ''], [70, 5, 12, 16, ''], [102, 8, 7, 12, ''], [114, 6, 9, 14, ''],
    [123, 2, 13, 18, ''], [127, 2, 13, 18, ''], [12, 3, 10, 14, 'd'], [15, 3, 10, 14, ''],
    [49, 8, 8, 13, 'n'],
  ],
  lake: [
    [54, 20, 6, 13, ''], [60, 22, 5, 12, 'r'], [61, 8, 13, 18, 'r'], [79, 16, 6, 13, ''],
    [98, 14, 6, 12, ''], [118, 16, 6, 13, ''], [129, 26, 3, 10, 'herd'], [116, 10, 7, 13, ''],
    [120, 8, 8, 14, 'n'], [55, 5, 14, 19, ''], [131, 1.2, 18, 24, ''], [148, .8, 20, 26, ''],
    [72, 10, 6, 12, ''],
  ],
  beach: [
    [72, 20, 5, 12, ''], [90, 16, 5, 12, ''], [98, 20, 5, 11, 'herd'], [116, 12, 6, 12, ''],
    [129, 22, 3, 9, 'herd'], [120, 8, 7, 13, 'n'], [54, 10, 6, 12, ''], [131, .8, 18, 24, ''],
    [86, 8, 8, 14, ''],
  ],
  snow: [
    [86, 18, 20, 27, ''], [87, 6, 26, 32, ''], [124, 10, 22, 30, ''], [91, 4, 24, 30, ''],
    [35, 10, 20, 26, 'n'], [42, 10, 21, 28, 'n'], [124, 6, 24, 30, ''], [147, 2, 24, 30, ''],
    [80, 5, 24, 30, ''], [28, 6, 22, 28, 'd'],
  ],
  volcano: [
    [58, 18, 18, 26, 'd'], [77, 18, 17, 25, ''], [126, 10, 22, 30, ''], [104, 12, 18, 25, ''],
    [74, 20, 16, 24, 'herd'], [75, 8, 24, 30, ''], [95, 5, 22, 29, ''], [136, 2, 24, 30, ''],
    [78, 6, 26, 32, ''], [105, 4, 26, 32, ''], [59, 3, 28, 34, ''],
  ],
  cave: [
    [41, 26, 14, 22, 'herd'], [42, 8, 22, 28, 'n'], [74, 20, 14, 22, ''], [50, 14, 14, 20, ''],
    [51, 5, 22, 27, ''], [66, 12, 15, 22, ''], [95, 6, 18, 26, ''], [104, 10, 15, 22, ''],
    [92, 14, 16, 24, 'n'], [93, 5, 24, 30, 'n'], [132, 4, 16, 24, ''], [67, 4, 24, 30, ''],
  ],
  ruins: [
    [63, 16, 12, 18, ''], [92, 14, 13, 20, 'n'], [96, 14, 12, 18, ''], [97, 5, 20, 26, 'n'],
    [122, 6, 15, 22, ''], [137, 4, 15, 22, ''], [64, 6, 20, 26, ''], [49, 10, 13, 19, 'n'],
    [20, 14, 12, 18, ''], [24, 8, 15, 22, ''],
  ],
  temple: [
    [147, 14, 32, 40, ''], [148, 5, 38, 44, ''], [35, 12, 30, 36, 'n'], [36, 3, 36, 42, 'n'],
    [124, 10, 32, 38, ''], [149, 1, 44, 50, ''],
  ],
  town: [[16, 10, 2, 4, 'd,herd'], [19, 10, 2, 4, ''], [52, 6, 3, 5, 'n']],
};
// 传说驻守 [id, x, z, lv, 条件flag]
export const LEGENDS = [
  [144, WORLD.mountain.x - 40, WORLD.mountain.z - 30, 50, 'articuno'],
  [146, WORLD.volcano.x + 8, WORLD.volcano.z + 40, 50, 'moltres'],
  [145, WORLD.ruins.x + 20, WORLD.ruins.z - 25, 50, 'zapdos'],   // 雷雨时出现
  [150, WORLD.cave.x, WORLD.cave.z, 70, 'mewtwo'],               // 全徽章后
];

const SHINY_ODDS = 1 / 96;

export class Spawner {
  constructor(scene) {
    this.scene = scene;
    this.actors = new Set();
    this.legendActors = new Map();
    this.tick = 0;
    this.target = 24;
    addUpdate(dt => this.update(dt));
  }

  update(dt) {
    if (!G.player || G.state === 'title') return;
    for (const a of this.actors) a.update(dt);
    for (const a of this.legendActors.values()) a.update(dt);

    this.tick -= dt;
    if (this.tick > 0) return;
    this.tick = .7;

    const P = G.player.pos;
    // 清理远处
    for (const a of [...this.actors]) {
      const d = Math.hypot(a.pos.x - P.x, a.pos.z - P.z);
      if (d > 100 || a.dead) { a.dispose(this.scene); this.actors.delete(a); }
    }
    // 补充(欠额越多补越快)
    if (G.state === 'roam') {
      const deficit = this.target - this.actors.size;
      for (let i = 0; i < Math.min(3, deficit); i++) this.trySpawn();
    }
    // 传说
    this.updateLegends();
  }

  trySpawn() {
    const P = G.player.pos;
    // 60% 偏向镜头前方(玩家能看见), 40% 全向
    let ang;
    if (G.cam && Math.random() < .6) {
      const w = G.cam.yaw + Math.PI;   // 玩家前方向(yaw空间: x=sin,z=cos)
      ang = Math.atan2(Math.cos(w), Math.sin(w)) + (Math.random() - .5) * 2.1;
    } else ang = Math.random() * TAU;
    const r = 14 + Math.random() * 42;
    const x = P.x + Math.cos(ang) * r, z = P.z + Math.sin(ang) * r;
    const biome = getBiome(x, z);
    const table = TABLES[biome];
    if (!table) return;
    const night = G.sky.isNight;
    const raining = G.weather.type === 'rain' || G.weather.type === 'storm';
    // 过滤+加权
    const pool = [];
    for (const e of table) {
      const [id, w, lo, hi, flags = ''] = e;
      if (!id || !w) continue;
      if (flags.includes('d') && night) continue;
      if (flags.includes('n') && !night) continue;
      let weight = w;
      if (flags.includes('r') && raining) weight *= 2.2;
      if (raining && G.dex.species[id - 1].types.includes('water')) weight *= 1.6;
      if (night && G.dex.species[id - 1].types.includes('ghost')) weight *= 1.5;
      pool.push([id, weight, lo, hi, flags]);
    }
    if (!pool.length) return;
    const total = pool.reduce((s, e) => s + e[1], 0);
    let roll = Math.random() * total;
    let pick = pool[0];
    for (const e of pool) { roll -= e[1]; if (roll <= 0) { pick = e; break; } }
    const [id, , lo, hi, flags] = pick;

    // 水生检查
    const h = getHeight(x, z);
    const wantWater = isWaterOnly(id);
    if (wantWater && h > -.6) return;
    if (!wantWater && h < .4) return;

    const herd = flags.includes('herd') ? 1 + (Math.random() * 3 | 0) : 1;
    const anchor = new THREE.Vector3(x, 0, z);
    for (let i = 0; i < herd; i++) {
      if (this.actors.size >= this.target + 4) break;
      const lv = lo + (Math.random() * (hi - lo + 1) | 0);
      const shiny = Math.random() < SHINY_ODDS;
      const mon = makeWild(id, lv, shiny);
      const ox = x + (Math.random() - .5) * 8 * (i > 0 ? 1 : 0), oz = z + (Math.random() - .5) * 8 * (i > 0 ? 1 : 0);
      const actor = new MonActor(mon, { anchor: herd > 1 ? anchor : null });
      actor.pos.set(ox, getHeight(ox, oz), oz);
      this.scene.add(actor.group);
      this.actors.add(actor);
      if (shiny) emit('shinySpawn', actor);
    }
  }

  updateLegends() {
    const P = G.player.pos;
    for (const [id, x, z, lv, flag] of LEGENDS) {
      const caught = G.flags['legendGone_' + flag];
      const active = this.legendActors.get(flag);
      const near = Math.hypot(x - P.x, z - P.z) < 120;
      let allowed = !caught && near;
      if (flag === 'zapdos') allowed = allowed && (G.weather.type === 'storm' || G.weather.type === 'rain');
      if (flag === 'mewtwo') allowed = allowed && (G.flags.badges ?? 0) >= 3;
      if (allowed && !active) {
        const mon = makeWild(id, lv, Math.random() < SHINY_ODDS);
        const a = new MonActor(mon, { behavior: 'static' });
        a.pos.set(x, getHeight(x, z), z);
        a.isLegend = flag;
        this.scene.add(a.group);
        this.legendActors.set(flag, a);
      } else if (!allowed && active) {
        active.dispose(this.scene);
        this.legendActors.delete(flag);
      }
    }
  }

  // 捕获/战斗后移除
  remove(actor) {
    actor.dispose(this.scene);
    this.actors.delete(actor);
    for (const [k, v] of this.legendActors) if (v === actor) this.legendActors.delete(k);
  }
  nearest(maxDist = 30) {
    const P = G.player.pos;
    let best = null, bd = maxDist;
    const all = [...this.actors, ...this.legendActors.values()];
    for (const a of all) {
      const d = Math.hypot(a.pos.x - P.x, a.pos.z - P.z);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
  all() { return [...this.actors, ...this.legendActors.values()]; }
}
