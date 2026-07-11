// 世界门面：地形+水+植被+散布+碰撞查询
import * as THREE from 'three';
import { G, addUpdate } from '../core/engine.js';
import { Terrain, getHeight, getBiome, getNormal, getSlope, WORLD, ZONE_NAMES } from './terrain.js';
import { Water } from './water.js';
import { GrassField, Scatter, DistantScenery } from './vegetation.js';

export { getHeight, getBiome, getNormal, getSlope, WORLD, ZONE_NAMES };

export class World {
  constructor(scene) {
    this.colliders = new Map();     // 网格哈希 → [{x,z,r}]
    this.CELL = 24;
    this.terrain = new Terrain(scene);
    this.water = new Water(scene);
    this.grass = new GrassField(scene);
    this.scatter = new Scatter(scene, this);
    this.distant = new DistantScenery(scene);
    addUpdate(() => this.terrain.update());
  }

  key(cx, cz) { return cx + '|' + cz; }
  addCollider(x, z, r, data = null) {
    const cx = Math.floor(x / this.CELL), cz = Math.floor(z / this.CELL);
    const k = this.key(cx, cz);
    if (!this.colliders.has(k)) this.colliders.set(k, []);
    const c = { x, z, r, data };
    this.colliders.get(k).push(c);
    return c;
  }
  queryColliders(x, z, range = 4) {
    const cx = Math.floor(x / this.CELL), cz = Math.floor(z / this.CELL);
    const out = [];
    const span = Math.ceil(range / this.CELL) + 1;
    for (let dx = -span; dx <= span; dx++) for (let dz = -span; dz <= span; dz++) {
      const list = this.colliders.get(this.key(cx + dx, cz + dz));
      if (list) out.push(...list);
    }
    return out;
  }
  // 将 (x,z) 处半径 r 的圆推离碰撞体
  resolve(pos, r = .45) {
    const list = this.queryColliders(pos.x, pos.z, r + 3);
    for (const c of list) {
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const d2 = dx * dx + dz * dz, rr = r + c.r;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (rr - d) / d;
        pos.x += dx * push; pos.z += dz * push;
      }
    }
  }
  height(x, z) { return getHeight(x, z); }
  biome(x, z) { return getBiome(x, z); }
}
