// 天空系统：昼夜循环 / 渐变天穹(内置星空+日月盘) / 云层 / 光照 / 雾
import * as THREE from 'three';
import { G, addUpdate } from '../core/engine.js';
import { clamp, lerp, smoothstep, TAU, mulberry32 } from '../core/math.js';

const PHASES = [ // t(小时), 天顶色, 地平色, 阳光色, 强度
  { t: 0,    top: '#070d24', hor: '#13204a', sun: '#8fb4ff', i: .06 },
  { t: 4.5,  top: '#070d24', hor: '#13204a', sun: '#8fb4ff', i: .06 },
  { t: 6,    top: '#4a5f9e', hor: '#ffb27d', sun: '#ffcf9e', i: .5 },
  { t: 7.5,  top: '#3f9bff', hor: '#cfe9ff', sun: '#fff4d6', i: 1 },
  { t: 16.5, top: '#3f9bff', hor: '#cfe9ff', sun: '#fff4d6', i: 1 },
  { t: 18.5, top: '#54549e', hor: '#ff9a5c', sun: '#ffb77d', i: .55 },
  { t: 20,   top: '#0a1233', hor: '#1d2b55', sun: '#8fb4ff', i: .08 },
  { t: 24,   top: '#070d24', hor: '#13204a', sun: '#8fb4ff', i: .06 },
];
const _a = new THREE.Color(), _b = new THREE.Color();

export class Sky {
  constructor(scene) {
    this.time = 9.5;                 // 游戏时刻(小时)
    this.dayLength = 60 * 22;        // 现实秒/游戏日
    this.cloudiness = .35;           // 天气驱动
    this.dimming = 0;                // 雨天变暗
    this.paused = false;

    // 天穹
    this.uniforms = {
      uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() },
      uNight: { value: 0 }, uTime: { value: 0 }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(2600, 32, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: this.uniforms,
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          uniform vec3 uTop, uHor, uSunColor; uniform vec3 uSunDir, uMoonDir; uniform float uNight, uTime;
          varying vec3 vDir;
          float hash(vec3 p){ p=fract(p*.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
          void main(){
            vec3 d = normalize(vDir);
            float h = clamp(d.y, -0.08, 1.0);
            vec3 col = mix(uHor, uTop, pow(smoothstep(-0.05, 0.55, h), 0.85));
            // 太阳
            float sd = dot(d, uSunDir);
            col += uSunColor * (smoothstep(0.9985, 0.99965, sd) * 1.4 + pow(clamp(sd,0.,1.), 90.0)*0.35*(1.0-uNight));
            // 月亮
            float md = dot(d, uMoonDir);
            float moon = smoothstep(0.9992, 0.99975, md);
            float crater = hash(floor(d*900.0))*0.25;
            col += vec3(0.92, 0.95, 1.0) * moon * (0.9 - crater) * uNight;
            col += vec3(0.6,0.7,1.0) * pow(clamp(md,0.,1.), 160.0) * 0.3 * uNight;
            // 星空
            if (uNight > 0.02 && d.y > 0.0) {
              vec3 cell = floor(d * 220.0);
              float s = hash(cell);
              if (s > 0.985) {
                float tw = 0.55 + 0.45 * sin(uTime * (2.0 + s * 6.0) + s * 40.0);
                col += vec3(0.9, 0.95, 1.0) * tw * uNight * smoothstep(0.985, 0.999, s) * smoothstep(0.0,0.25,d.y);
              }
            }
            gl_FragColor = vec4(col, 1.0);
          }`,
      })
    );
    dome.name = 'skydome';
    scene.add(dome);
    this.dome = dome;

    // 光照
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -95; sc.right = 95; sc.top = 95; sc.bottom = -95; sc.near = 10; sc.far = 480;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.35;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x8a9a6a, .75);
    scene.add(this.hemi);
    this.moonL = new THREE.DirectionalLight(0x7d96d8, 0);
    scene.add(this.moonL, this.moonL.target);

    // 雾
    scene.fog = new THREE.Fog(0xcfe9ff, 300, 1500);

    // 云
    this.buildClouds(scene);
    this.flash = 0; // 闪电
    addUpdate(dt => this.update(dt));
  }

  buildClouds(scene) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,.95)');
    g.addColorStop(.55, 'rgba(255,255,255,.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    const rnd = mulberry32(777);
    this.cloudGroup = new THREE.Group();
    this.cloudGroup.name = 'clouds';
    this.clouds = [];
    for (let i = 0; i < 54; i++) {
      const cluster = new THREE.Group();
      const n = 3 + (rnd() * 5 | 0);
      for (let j = 0; j < n; j++) {
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: .8, depthWrite: false, fog: false });
        const s = new THREE.Sprite(mat);
        const sc = 60 + rnd() * 90;
        s.scale.set(sc * (1.3 + rnd() * .8), sc * (.5 + rnd() * .3), 1);
        s.position.set((rnd() - .5) * 140, (rnd() - .5) * 26, (rnd() - .5) * 90);
        cluster.add(s);
      }
      cluster.position.set((rnd() - .5) * 3400, 210 + rnd() * 130, (rnd() - .5) * 3400);
      cluster.userData.speed = 3 + rnd() * 5;
      this.cloudGroup.add(cluster);
      this.clouds.push(cluster);
    }
    scene.add(this.cloudGroup);
  }

  get isNight() { return this.time < 5.5 || this.time > 19.2; }
  get phase() {
    const t = this.time;
    if (t >= 5 && t < 7.5) return 'dawn';
    if (t >= 7.5 && t < 17) return 'day';
    if (t >= 17 && t < 19.5) return 'dusk';
    return 'night';
  }

  skyColors(t) {
    let i = 0;
    while (i < PHASES.length - 2 && PHASES[i + 1].t <= t) i++;
    const a = PHASES[i], b = PHASES[i + 1];
    const f = clamp((t - a.t) / (b.t - a.t || 1), 0, 1);
    return {
      top: _a.set(a.top).lerp(_b.set(b.top), f).clone(),
      hor: _a.set(a.hor).lerp(_b.set(b.hor), f).clone(),
      sun: _a.set(a.sun).lerp(_b.set(b.sun), f).clone(),
      i: lerp(a.i, b.i, f),
    };
  }

  update(dt) {
    if (!this.paused) this.time = (this.time + dt * 24 / this.dayLength) % 24;
    const t = this.time;
    const ang = (t / 24) * TAU - Math.PI / 2;    // 6点日出 18点日落
    const sunDir = new THREE.Vector3(Math.cos(ang) * .82, Math.sin(ang), Math.sin(ang * .5) * .35 + .28).normalize();
    const moonDir = sunDir.clone().multiplyScalar(-1);
    const cs = this.skyColors(t);
    const night = smoothstep(.12, -.14, sunDir.y);
    const dim = 1 - this.dimming * .55;

    // 天穹
    this.uniforms.uTop.value.copy(cs.top).multiplyScalar(dim);
    this.uniforms.uHor.value.copy(cs.hor).multiplyScalar(dim);
    this.uniforms.uSunColor.value.copy(cs.sun);
    this.uniforms.uSunDir.value.copy(sunDir);
    this.uniforms.uMoonDir.value.copy(moonDir);
    this.uniforms.uNight.value = night;
    this.uniforms.uTime.value = G.time;

    // 光照跟随玩家
    const anchor = G.player ? G.player.pos : G.camera.position;
    const sunI = Math.max(0, sunDir.y) * cs.i;
    this.sun.intensity = (sunI * 2.6 + this.flash * 6) * dim;
    this.sun.color.copy(cs.sun);
    this.sun.position.copy(anchor).addScaledVector(sunDir, 240);
    this.sun.target.position.copy(anchor);
    this.moonL.intensity = night * .32;
    this.moonL.position.copy(anchor).addScaledVector(moonDir, 200);
    this.moonL.target.position.copy(anchor);
    this.hemi.intensity = lerp(.14, .8, Math.max(sunI, night * .12)) * dim;
    this.hemi.color.copy(cs.top).lerp(new THREE.Color('#ffffff'), .5);
    this.hemi.groundColor.set(night > .5 ? '#26314e' : '#8a9a6a');

    // 雾
    const fog = G.scene.fog;
    fog.color.copy(cs.hor).multiplyScalar(dim);
    fog.near = lerp(320, 90, this.dimming);
    fog.far = lerp(1550, 520, this.dimming);

    // 天穹/云 跟随
    this.dome.position.copy(anchor);
    const cloudOp = clamp(this.cloudiness, 0, 1);
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt * (1 + this.dimming);
      if (c.position.x - anchor.x > 1800) c.position.x -= 3600;
      if (c.position.x - anchor.x < -1800) c.position.x += 3600;
      const tint = clamp(sunI + night * .18 + .12, 0, 1) * dim;
      for (const s of c.children) {
        s.material.opacity = .18 + cloudOp * .68;
        s.material.color.setRGB(tint, tint, tint * 1.04);
      }
    }
    this.flash = Math.max(0, this.flash - dt * 4);
  }

  lightning() { this.flash = 1; }
  setTime(h) { this.time = ((h % 24) + 24) % 24; }
}
