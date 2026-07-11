// 音频：WebAudio 程序化BGM + 合成SFX + 宝可梦真实叫声
import { G, on } from '../core/engine.js';
import { cryPath } from './assets.js';

const SCALE = [0, 2, 4, 7, 9];  // 大调五声
const N = (o, s) => 261.63 * Math.pow(2, o + s / 12);

const THEMES = {
  field: {
    tempo: 96, bars: 8,
    layers: [
      { wave: 'triangle', oct: 0, gain: .16, steps: [0, null, 4, null, 7, null, 4, null, 9, null, 7, null, 4, 2, 0, null] },
      { wave: 'sine', oct: -1, gain: .2, steps: [0, null, null, null, 5, null, null, null, 7, null, null, null, 4, null, null, null] },
      { wave: 'triangle', oct: 1, gain: .07, steps: [null, 12, null, 11, null, 9, null, 7, null, 9, null, 12, null, 14, null, 16], every: 2 },
    ],
    perc: [1, 0, .3, 0, 1, 0, .3, .3, 1, 0, .3, 0, 1, .3, .5, .3],
  },
  night: {
    tempo: 64, bars: 8,
    layers: [
      { wave: 'sine', oct: 0, gain: .13, steps: [9, null, null, 7, null, null, 4, null, null, 2, null, null, 4, null, null, null] },
      { wave: 'sine', oct: -1, gain: .16, steps: [2, null, null, null, null, null, null, null, 0, null, null, null, null, null, null, null] },
    ],
    perc: null,
  },
  battle: {
    tempo: 148, bars: 4,
    layers: [
      { wave: 'sawtooth', oct: -1, gain: .12, steps: [0, 0, 3, 0, 5, 0, 3, 0, 0, 0, 3, 0, 7, 5, 3, 2], minor: true },
      { wave: 'square', oct: 1, gain: .05, steps: [12, null, 10, 12, null, 15, null, 12, null, 10, null, 7, 10, null, 12, null], minor: true, every: 2 },
    ],
    perc: [1, 0, .4, 0, 1, .4, 0, .4, 1, 0, .4, 0, 1, .4, .6, .6],
  },
  victory: {
    tempo: 132, bars: 2, once: true,
    layers: [
      { wave: 'square', oct: 0, gain: .12, steps: [0, 4, 7, 12, null, 12, 12, null, 14, null, 16, null, null, null, null, null] },
      { wave: 'triangle', oct: -1, gain: .16, steps: [0, null, 0, null, 5, null, 7, null, 9, null, 12, null, null, null, null, null] },
    ],
    perc: [1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0],
  },
  evolution: {
    tempo: 110, bars: 4,
    layers: [
      { wave: 'sine', oct: 0, gain: .14, steps: [0, 4, 7, 4, 9, 7, 12, 9, 14, 12, 16, 14, 19, 16, 21, 19] },
      { wave: 'sine', oct: -1, gain: .12, steps: [0, null, null, null, 7, null, null, null, 9, null, null, null, 12, null, null, null] },
    ],
    perc: null,
  },
};

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.bgmVol = .45;
    this.sfxVol = .7;
    this.theme = null;
    this.nextBarT = 0;
    this.step = 0;
    this.cries = new Map();
    this.unlocked = false;
    addEventListener('pointerdown', () => this.unlock(), { once: false });
    addEventListener('keydown', () => this.unlock(), { once: false });
    on('sfx', k => this.sfx(k));
    on('step', b => this.footstep(b));
    on('splash', () => this.sfx('splashS'));
  }

  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain();
    this.master.gain.value = .9;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(ctx.destination);
    this.bgmGain = ctx.createGain(); this.bgmGain.gain.value = this.bgmVol; this.bgmGain.connect(this.master);
    this.sfxGain = ctx.createGain(); this.sfxGain.gain.value = this.sfxVol; this.sfxGain.connect(this.master);
    // 简易回声
    this.echo = ctx.createDelay(.6); this.echo.delayTime.value = .27;
    const eg = ctx.createGain(); eg.gain.value = .18;
    this.echo.connect(eg); eg.connect(this.bgmGain);
    // 调度器
    setInterval(() => this.schedule(), 80);
    if (!this.theme) this.bgm('field');
  }

  setBgmVol(v) { this.bgmVol = v; if (this.bgmGain) this.bgmGain.gain.value = v; }

  bgm(name) {
    if (this.theme === name) return;
    this.theme = name;
    this.step = 0;
    if (this.ctx) this.nextBarT = this.ctx.currentTime + .05;
    if (name === 'victory') this._afterOnce = 'field';
  }

  schedule() {
    if (!this.ctx || !this.theme || document.hidden) return;
    const th = THEMES[this.theme];
    if (!th) return;
    const ctx = this.ctx;
    const stepDur = 60 / th.tempo / 4;
    while (this.nextBarT < ctx.currentTime + .25) {
      const t = this.nextBarT;
      const s = this.step % 16;
      const bar = (this.step / 16 | 0) % th.bars;
      for (const L of th.layers) {
        if (L.every && bar % L.every !== 0) continue;
        let semi = L.steps[s];
        if (semi == null) continue;
        if (L.minor) semi = semi === 4 ? 3 : semi === 9 ? 8 : semi === 16 ? 15 : semi;
        // 小节变奏: 移调
        const shift = this.theme === 'field' ? [0, 0, -3, 0, 5, 5, 0, 0][bar] ?? 0 : this.theme === 'battle' ? [0, 0, 3, 5][bar] : 0;
        this.note(L.wave, N(L.oct, semi + shift), t, stepDur * (L.sustain ?? 1.8), L.gain);
      }
      if (th.perc) {
        const p = th.perc[s];
        if (p) this.percHit(t, p);
      }
      this.step++;
      if (th.once && this.step >= th.bars * 16) { this.theme = this._afterOnce ?? 'field'; this.step = 0; }
      this.nextBarT += stepDur;
    }
  }

  note(wave, freq, t, dur, gain, dest) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = wave; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + .012);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); g.connect(dest ?? this.bgmGain); g.connect(this.echo);
    o.start(t); o.stop(t + dur + .05);
  }

  percHit(t, vel) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, 1200, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.4);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 5000;
    const g = ctx.createGain(); g.gain.value = .1 * vel;
    src.connect(f); f.connect(g); g.connect(this.bgmGain);
    src.start(t);
  }

  // ---------- SFX ----------
  sfx(kind) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const blip = (f1, f2, dur, wave = 'square', vol = .2) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = wave;
      o.frequency.setValueAtTime(f1, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, f2), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(.001, t + dur);
      o.connect(g); g.connect(this.sfxGain);
      o.start(t); o.stop(t + dur + .02);
    };
    const noise = (dur, freq, vol = .25, type = 'bandpass') => {
      const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      const g = ctx.createGain(); g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(this.sfxGain);
      src.start(t);
    };
    const arp = (semis, gap = .07, wave = 'square', vol = .16, oct = 1) =>
      semis.forEach((s, i) => this.note(wave, N(oct, s), t + i * gap, .2, vol, this.sfxGain));

    switch (kind) {
      case 'throw': noise(.25, 2200, .18); break;
      case 'ballHit': blip(900, 300, .12, 'square', .25); break;
      case 'shake': blip(600, 480, .09, 'sine', .3); break;
      case 'catch': arp([0, 4, 7, 12], .09); break;
      case 'breakout': noise(.3, 900, .3); blip(400, 120, .25); break;
      case 'hit': blip(300, 90, .15, 'square', .3); noise(.12, 1200, .15); break;
      case 'hitSuper': blip(500, 60, .3, 'sawtooth', .35); noise(.3, 800, .3); break;
      case 'hitWeak': blip(220, 120, .1, 'sine', .2); break;
      case 'attack': noise(.16, 3000, .14); break;
      case 'faint': blip(320, 60, .5, 'triangle', .28); break;
      case 'levelup': arp([0, 4, 7, 12, 16], .06); break;
      case 'badge': arp([0, 7, 12, 16, 19, 24], .08, 'triangle', .2); break;
      case 'quest': arp([7, 12], .08, 'sine', .22); break;
      case 'heal': arp([12, 7, 12, 16], .07, 'sine', .14); break;
      case 'menu': blip(800, 1100, .06, 'square', .12); break;
      case 'buy': arp([12, 19], .06, 'square', .18); break;
      case 'jump': blip(300, 600, .14, 'sine', .18); break;
      case 'land': noise(.08, 500, .12, 'lowpass'); break;
      case 'glide': noise(.5, 1500, .1); break;
      case 'thunder': noise(1.6, 220, .5, 'lowpass'); setTimeout(() => noise(.8, 120, .4, 'lowpass'), 150); break;
      case 'shiny': arp([12, 16, 19, 24, 19, 24], .05, 'sine', .2, 2); break;
      case 'evolved': arp([0, 4, 7, 12, 16, 19, 24], .07, 'triangle', .2); break;
      case 'mount': arp([0, 7], .07, 'sine', .2); break;
      case 'dismount': blip(500, 250, .12, 'sine', .15); break;
      case 'berry': blip(700, 900, .08, 'sine', .15); break;
      case 'splashS': noise(.2, 1000, .1); break;
    }
  }
  thunder() { this.sfx('thunder'); }

  footstep(biome) {
    if (!this.ctx) return;
    const f = biome === 'snow' || biome === 'beach' ? 400 : biome === 'cave' || biome === 'volcano' || biome === 'ruins' ? 900 : 600;
    const ctx = this.ctx, t = ctx.currentTime;
    const buf = ctx.createBuffer(1, 900, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = f;
    const g = ctx.createGain(); g.gain.value = .12;
    src.connect(flt); flt.connect(g); g.connect(this.sfxGain);
    src.start(t);
  }

  cry(id, vol = .55) {
    try {
      let a = this.cries.get(id);
      if (!a) { a = new Audio(cryPath(id)); this.cries.set(id, a); }
      a.volume = vol;
      a.currentTime = 0;
      a.play().catch(() => {});
    } catch (e) {}
  }
}
