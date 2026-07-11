// 天气机：晴/多云/雨/雷雨 全局轮换 + 雪山局部降雪 + 粒子
import * as THREE from 'three';
import { G, addUpdate, emit } from '../core/engine.js';
import { mulberry32, clamp, lerp } from '../core/math.js';

export class Weather {
  constructor(scene) {
    this.type = 'clear';         // clear cloudy rain storm
    this.next = 6;               // 下次变化的游戏时刻累计
    this.rnd = mulberry32(Date.now ? 991177 : 1);
    this.intensity = 0;          // 雨强度渐变
    this.thunderT = 0;
    this.localSnow = 0;

    // 雨粒子
    const N = this.RN = 1300;
    const rainGeo = new THREE.BufferGeometry();
    const rp = new Float32Array(N * 6);
    this.rainSeeds = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      this.rainSeeds[i * 4] = Math.random() * 90 - 45;
      this.rainSeeds[i * 4 + 1] = Math.random() * 40;
      this.rainSeeds[i * 4 + 2] = Math.random() * 90 - 45;
      this.rainSeeds[i * 4 + 3] = .7 + Math.random() * .6;
    }
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xaaccee, transparent: true, opacity: .5, fog: false }));
    this.rain.visible = false;
    this.rain.frustumCulled = false;
    scene.add(this.rain);

    // 雪粒子
    const SN = this.SN = 900;
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SN * 3), 3));
    this.snowSeeds = new Float32Array(SN * 4);
    for (let i = 0; i < SN; i++) {
      this.snowSeeds[i * 4] = Math.random() * 70 - 35;
      this.snowSeeds[i * 4 + 1] = Math.random() * 30;
      this.snowSeeds[i * 4 + 2] = Math.random() * 70 - 35;
      this.snowSeeds[i * 4 + 3] = .4 + Math.random();
    }
    this.snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: .18, transparent: true, opacity: .85, fog: false }));
    this.snow.visible = false;
    this.snow.frustumCulled = false;
    scene.add(this.snow);

    addUpdate(dt => this.update(dt));
  }

  roll() {
    const r = this.rnd();
    const prev = this.type;
    this.type = r < .42 ? 'clear' : r < .68 ? 'cloudy' : r < .88 ? 'rain' : 'storm';
    if (this.type !== prev) emit('weather', this.type);
  }

  // 战斗用天气(考虑玩家所处群系)
  battleWeather(biome) {
    if (biome === 'snow' || biome === 'temple') return 'snow';
    if (biome === 'volcano') return 'sun';
    if (biome === 'cave') return 'none';
    if (this.type === 'rain' || this.type === 'storm') return 'rain';
    return 'none';
  }

  update(dt) {
    const sky = G.sky; if (!sky) return;
    // 轮换
    this.next -= dt * 24 / sky.dayLength;
    if (this.next <= 0) { this.next = 3.5 + this.rnd() * 5.5; this.roll(); }

    const wet = this.type === 'rain' ? .75 : this.type === 'storm' ? 1 : 0;
    this.intensity = lerp(this.intensity, wet, 1 - Math.exp(-dt * .8));
    sky.cloudiness = lerp(sky.cloudiness, this.type === 'clear' ? .3 : this.type === 'cloudy' ? .75 : 1, 1 - Math.exp(-dt * .6));
    sky.dimming = this.intensity * (this.type === 'storm' ? .72 : .5);

    // 雷
    if (this.type === 'storm') {
      this.thunderT -= dt;
      if (this.thunderT <= 0) {
        this.thunderT = 3 + this.rnd() * 9;
        sky.lightning();
        G.audio?.thunder?.();
      }
    }

    const cam = G.camera.position;
    // 雨
    const rainOn = this.intensity > .06;
    this.rain.visible = rainOn;
    if (rainOn) {
      const pos = this.rain.geometry.attributes.position.array;
      const t = G.time;
      for (let i = 0; i < this.RN; i++) {
        const sx = this.rainSeeds[i * 4], sy = this.rainSeeds[i * 4 + 1], sz = this.rainSeeds[i * 4 + 2], sp = this.rainSeeds[i * 4 + 3];
        const y = 40 - ((t * 38 * sp + sy) % 44);
        const x = cam.x + sx, z = cam.z + sz;
        pos[i * 6] = x; pos[i * 6 + 1] = cam.y + y; pos[i * 6 + 2] = z;
        pos[i * 6 + 3] = x - .1; pos[i * 6 + 4] = cam.y + y - 1.1 * sp; pos[i * 6 + 5] = z;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rain.material.opacity = .42 * this.intensity;
    }

    // 局部雪(雪山/神殿)
    const biome = G.player?.biome;
    const snowT = (biome === 'snow' || biome === 'temple') ? 1 : 0;
    this.localSnow = lerp(this.localSnow, snowT, 1 - Math.exp(-dt * 1.2));
    const snowOn = this.localSnow > .05;
    this.snow.visible = snowOn;
    if (snowOn) {
      const pos = this.snow.geometry.attributes.position.array;
      const t = G.time;
      for (let i = 0; i < this.SN; i++) {
        const sx = this.snowSeeds[i * 4], sy = this.snowSeeds[i * 4 + 1], sz = this.snowSeeds[i * 4 + 2], sp = this.snowSeeds[i * 4 + 3];
        const y = 30 - ((t * 2.4 * sp + sy) % 33);
        pos[i * 3] = cam.x + sx + Math.sin(t * .8 + i) * 2.2;
        pos[i * 3 + 1] = cam.y + y;
        pos[i * 3 + 2] = cam.z + sz + Math.cos(t * .6 + i * 1.7) * 2.2;
      }
      this.snow.geometry.attributes.position.needsUpdate = true;
      this.snow.material.opacity = .85 * this.localSnow;
    }
  }
}
