// HUD：时钟天气/队伍条/小地图/区域横幅/体力环/捕球指示/交互提示
import * as THREE from 'three';
import { G, on, addUpdate } from '../core/engine.js';
import { getBiome, getHeight, WORLD, ZONE_NAMES } from '../world/world.js';
import { spritePath } from '../core/assets.js';
import { ITEMS } from '../core/state.js';
import { clamp } from '../core/math.js';

const WEATHER_ICON = { clear: '☀️', cloudy: '⛅', rain: '🌧️', storm: '⛈️' };
const WEATHER_ZH = { clear: '晴朗', cloudy: '多云', rain: '降雨', storm: '雷雨' };

export class HUD {
  constructor() {
    this.root = document.getElementById('hud');
    this.root.innerHTML = `
      <div class="hud-tl">
        <div class="hud-clock panel"><span class="icon" id="hudWIcon">☀️</span>
          <div><div class="t" id="hudTime">10:00</div><div class="w" id="hudWeather">晴朗 · 晨风草原</div></div>
        </div>
        <div class="hud-quest panel" id="hudQuest" style="display:none"></div>
      </div>
      <div class="hud-party" id="hudParty"></div>
      <div class="hud-minimap panel"><canvas id="mmCanvas" width="168" height="168"></canvas><div class="mm-label" id="mmLabel">曦光镇</div></div>
      <div class="hud-prompts" id="hudPrompts"></div>
      <div class="hud-zone" id="hudZone"><div class="z-name"></div><div class="z-line"></div></div>
      <svg class="hud-stamina" id="hudStam" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(0,0,0,.4)" stroke-width="9"/>
        <circle id="stamArc" cx="50" cy="50" r="40" fill="none" stroke="#7dffb0" stroke-width="9"
          stroke-linecap="round" stroke-dasharray="251" stroke-dashoffset="0" transform="rotate(-90 50 50)"/>
      </svg>`;
    this.mm = document.getElementById('mmCanvas').getContext('2d');
    this.buildMapBase();
    this.zoneT = 0;
    this.lastPartyKey = '';
    on('zone', z => this.showZone(z));
    addUpdate(dt => this.update(dt));
    this.frame = 0;
  }

  buildMapBase() {
    // 低清群系底图
    const N = 168;
    const off = this.mapBase = document.createElement('canvas');
    off.width = off.height = N;
    const ctx = off.getContext('2d');
    const colors = {
      sea: '#2b6cb0', beach: '#eed9a4', grass: '#7ecb5c', forest: '#4d9e52', town: '#8fd468',
      lake: '#4f9fd8', snow: '#eef4fb', volcano: '#6e4a45', cave: '#5d5a6e', ruins: '#cfc7a8', temple: '#dfe9f5',
    };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const wx = (x / N - .5) * WORLD.size * 1.15, wz = (y / N - .5) * WORLD.size * 1.15;
      const b = getBiome(wx, wz);
      const h = getHeight(wx, wz);
      let c = colors[b] ?? '#7ecb5c';
      if (b !== 'sea' && h < 0) c = colors.sea;
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }
    // 河流蒙暗
    ctx.globalAlpha = .25;
    ctx.fillStyle = '#000';
    ctx.globalAlpha = 1;
  }

  worldToMap(x, z, N = 168) {
    return [(x / (WORLD.size * 1.15) + .5) * N, (z / (WORLD.size * 1.15) + .5) * N];
  }

  update(dt) {
    if (!G.player || (G.state === 'title')) { this.root.style.display = 'none'; return; }
    this.root.style.display = 'block';
    this.frame++;

    // 时钟
    if (this.frame % 10 === 0) {
      const t = G.sky.time;
      const hh = String(t | 0).padStart(2, '0'), mm = String((t % 1) * 60 | 0).padStart(2, '0');
      document.getElementById('hudTime').textContent = `${hh}:${mm}`;
      document.getElementById('hudWIcon').textContent = G.sky.isNight ? '🌙' : (WEATHER_ICON[G.weather.type] ?? '☀️');
      document.getElementById('hudWeather').textContent = `${WEATHER_ZH[G.weather.type] ?? ''} · ${ZONE_NAMES[G.player.biome] ?? ''}`;
      document.getElementById('mmLabel').textContent = ZONE_NAMES[G.player.biome] ?? '';
    }

    // 队伍
    if (this.frame % 12 === 0) this.renderParty();

    // 小地图
    if (this.frame % 3 === 0) this.renderMinimap();

    // 体力环
    const st = G.player.stamina;
    const el = document.getElementById('hudStam');
    const show = st < .999 && (G.state === 'roam');
    el.classList.toggle('show', show);
    if (show) {
      document.getElementById('stamArc').style.strokeDashoffset = String(251 * (1 - st));
      document.getElementById('stamArc').style.stroke = st < .25 ? '#ff6b7d' : '#7dffb0';
    }

    // 交互提示
    if (this.frame % 8 === 0) this.renderPrompts();
  }

  renderParty() {
    const box = document.getElementById('hudParty');
    const key = G.save.party.map(p => `${p.uid}:${p.hp}:${p.level}`).join('|') + (G.battle ? 'B' : '');
    if (key === this.lastPartyKey) return;
    this.lastPartyKey = key;
    if (G.battle) { box.style.display = 'none'; return; }
    box.style.display = 'flex';
    box.innerHTML = G.save.party.map((p, i) => {
      const pct = Math.round(p.hpRatio * 100);
      const cls = pct <= 25 ? 'low' : pct <= 55 ? 'mid' : '';
      return `<div class="hud-mon ${i === 0 ? 'active' : ''} ${p.fainted ? 'fainted' : ''}">
        <img src="${spritePath(p.id)}" alt="">
        <div class="inf">
          <div class="nm"><span>${p.name}</span><span class="lv">Lv.${p.level}</span></div>
          <div class="hpbar ${cls}"><i style="width:${pct}%"></i></div>
        </div>
      </div>`;
    }).join('');
  }

  renderMinimap() {
    const ctx = this.mm, N = 168;
    ctx.drawImage(this.mapBase, 0, 0);
    const P = G.player.pos;
    // 任务标记
    const q = G.quests?.activeMarker?.();
    if (q) {
      const [qx, qy] = this.worldToMap(q.x, q.z);
      ctx.fillStyle = '#ffd76a';
      ctx.beginPath(); ctx.arc(qx, qy, 4 + Math.sin(G.time * 5) * 1.2, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.stroke();
    }
    // 附近精灵(闪光高亮)
    for (const a of G.spawner?.all() ?? []) {
      const d = Math.hypot(a.pos.x - P.x, a.pos.z - P.z);
      if (d > 90) continue;
      const [mx, my] = this.worldToMap(a.pos.x, a.pos.z);
      ctx.fillStyle = a.mon.shiny ? '#ffe27d' : 'rgba(255,255,255,.75)';
      ctx.beginPath(); ctx.arc(mx, my, a.mon.shiny ? 2.6 : 1.6, 0, 7); ctx.fill();
    }
    // 玩家箭头
    const [px, py] = this.worldToMap(P.x, P.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.PI - G.player.yaw);
    ctx.fillStyle = '#4ea6ff';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4.4, 5); ctx.lineTo(0, 2.4); ctx.lineTo(-4.4, 5); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  renderPrompts() {
    const box = document.getElementById('hudPrompts');
    const list = [];
    const P = G.player;
    if (G.state === 'roam') {
      if (P.aiming) {
        const k = G.capture?.ballKind;
        list.push(`<div class="hud-prompt"><b>${k ? ITEMS[k].zh : '无球'}</b><span class="kbd">R</span>切换 <span class="kbd">左键</span>投掷</div>`);
        if (G.save.count('razz-berry') > 0) list.push(`<div class="hud-prompt">按住<span class="kbd">B</span>投树果</div>`);
      } else {
        const near = G.spawner?.nearest(10);
        if (near) list.push(`<div class="hud-prompt"><span class="kbd">右键</span>瞄准 <span class="kbd">F</span>对战</div>`);
        const npc = G.quests?.nearestNPC?.(3.2);
        if (npc) list.push(`<div class="hud-prompt"><span class="kbd">E</span> 交谈 · ${npc.name}</div>`);
        if (P.state === 'swim') list.push(`<div class="hud-prompt">体力游泳中…注意别游太远</div>`);
      }
      list.push(`<div class="hud-prompt dim"><span class="kbd">M</span>菜单</div>`);
    }
    box.innerHTML = list.join('');
  }

  showZone(name) {
    const el = document.getElementById('hudZone');
    el.querySelector('.z-name').textContent = name;
    el.classList.add('show');
    clearTimeout(this._zt);
    this._zt = setTimeout(() => el.classList.remove('show'), 2600);
  }
}
