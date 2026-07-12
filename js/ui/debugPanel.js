// 性能与调试面板：F3 或 ?debug 开启
// 显示: FPS/帧耗时/drawcalls/三角形/地形块/草实例/精灵AI状态/内存/坐标群系天气
import { G, addUpdate } from '../core/engine.js';

export class DebugPanel {
  constructor() {
    const el = this.el = document.createElement('div');
    el.id = 'debugPanel';
    el.style.cssText = [
      'position:fixed', 'left:10px', 'top:96px', 'z-index:800',
      'background:rgba(8,12,18,.78)', 'color:#b8e0c8', 'border:1px solid rgba(120,200,160,.25)',
      'border-radius:8px', 'padding:8px 10px', 'min-width:210px',
      'font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace',
      'pointer-events:none', 'white-space:pre', 'display:none',
    ].join(';');
    document.body.appendChild(el);

    this.visible = G.debug.has('debug');
    if (this.visible) el.style.display = 'block';
    addEventListener('keydown', e => {
      if (e.code === 'F3') { e.preventDefault(); this.toggle(); }
    });

    this.acc = 0;
    this.frameMs = 0;
    this._t0 = 0;
    addUpdate(dt => {
      // 帧耗时采样(指数平滑)
      const now = performance.now();
      if (this._t0) this.frameMs = this.frameMs * .9 + (now - this._t0) * .1;
      this._t0 = now;
      if (!this.visible) return;
      this.acc += dt;
      if (this.acc < .25) return;
      this.acc = 0;
      this.render();
    });
  }

  toggle() {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  render() {
    const L = [];
    const info = G.renderer?.info;
    L.push(`FPS ${(G.fps ?? 0).toFixed(0)}  帧 ${this.frameMs.toFixed(1)}ms`);
    if (info) L.push(`draw ${info.render.calls}  三角 ${fmt(info.render.triangles)}  几何 ${info.memory.geometries}  纹理 ${info.memory.textures}`);

    // 地形/植被
    const terr = G.world?.terrain;
    if (terr?.chunks) {
      const vis = terr.chunks.filter(c => c.visible).length;
      L.push(`地形块 ${vis}/${terr.chunks.length}  草 ${fmt(G.world?.grass?.geo?.instanceCount ?? 0)}`);
    }

    // 精灵生态
    if (G.spawner) {
      const actors = [...G.spawner.actors];
      const states = {};
      let loaded = 0;
      for (const a of actors) {
        states[a.state] = (states[a.state] || 0) + 1;
        if (a.loaded) loaded++;
      }
      L.push(`精灵 ${actors.length} (模型${loaded})`);
      const sTxt = Object.entries(states).sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([k, v]) => `${k}:${v}`).join(' ');
      if (sTxt) L.push(`  ${sTxt}`);
    }

    // 世界状态
    if (G.player) {
      const p = G.player.pos;
      L.push(`pos ${p.x.toFixed(0)},${p.y.toFixed(1)},${p.z.toFixed(0)}  ${G.player.biome ?? ''}`);
    }
    L.push(`时刻 ${(G.sky?.time ?? 0).toFixed(1)}  天气 ${G.weather?.type ?? '-'}  state ${G.state}`);

    // 内存(Chrome)
    const mem = performance.memory;
    if (mem) L.push(`JS堆 ${(mem.usedJSHeapSize / 1048576).toFixed(0)}/${(mem.jsHeapSizeLimit / 1048576).toFixed(0)}MB`);

    L.push('─ F3 关闭');
    this.el.textContent = L.join('\n');
  }
}

const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
