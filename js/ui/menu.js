// 总菜单：队伍/背包/图鉴/地图/任务/系统
import { G, on, emit } from '../core/engine.js';
import { Input } from '../core/input.js';
import { spritePath, artPath, cryPath } from '../core/assets.js';
import { ITEMS } from '../core/state.js';
import { Settings } from '../core/settings.js';
import { TYPE_ZH, AILMENT_ZH, STAT_ZH } from '../mon/types.js';
import { moveData, speciesOf } from '../mon/pokemon.js';
import { WORLD, ZONE_NAMES, getBiome, getHeight } from '../world/world.js';
import { runEvolution } from '../battle/battle.js';

const TABS = [['party', '队伍'], ['bag', '背包'], ['dex', '图鉴'], ['map', '地图'], ['quest', '任务'], ['sys', '系统']];

export class Menu {
  constructor() {
    this.root = document.getElementById('menu');
    this.open = false;
    this.tab = 'party';
    this.sel = 0;
    on('key', k => {
      if ((k === 'KeyM' || k === 'Escape') && (G.state === 'roam' || G.state === 'menu')) {
        this.toggle();
      }
    });
  }

  toggle(force) {
    const want = force ?? !this.open;
    if (want === this.open) return;
    this.open = want;
    if (want) {
      G.state = 'menu';
      G.player?.freeze(true);
      Input.unlock();
      this.render();
      this.root.style.display = 'block';
      this.root.style.pointerEvents = 'all';
    } else {
      this.root.style.display = 'none';
      this.root.innerHTML = '';
      G.state = 'roam';
      G.player?.freeze(false);
    }
  }

  render() {
    this.root.innerHTML = `
      <div class="menu-wrap">
        <div class="menu-side panel">
          <div class="menu-logo">宝可梦<em>宝石</em></div>
          ${TABS.map(([id, zh]) => `<button class="menu-tab ${this.tab === id ? 'sel' : ''}" data-t="${id}">${zh}</button>`).join('')}
          <div class="menu-money">💰 ${G.save.money.toLocaleString()}</div>
          <div class="menu-badges">${['rock', 'water', 'fire'].map(b => `<span class="badge ${G.save.badges.includes(b) ? 'got' : ''}">${{ rock: '🪨', water: '💧', fire: '🔥' }[b]}</span>`).join('')}</div>
        </div>
        <div class="menu-body panel" id="menuBody"></div>
      </div>`;
    this.root.querySelectorAll('.menu-tab').forEach(b => b.onclick = () => { this.tab = b.dataset.t; this.sel = 0; this.render(); });
    this.renderBody();
  }

  renderBody() {
    const body = document.getElementById('menuBody');
    const fn = { party: this.renderParty, bag: this.renderBag, dex: this.renderDex, map: this.renderMap, quest: this.renderQuest, sys: this.renderSys }[this.tab];
    fn.call(this, body);
  }

  // ---------- 队伍 ----------
  renderParty(body) {
    const party = G.save.party;
    if (!party.length) { body.innerHTML = '<div class="menu-empty">还没有宝可梦。去找博士领取伙伴吧！</div>'; return; }
    const p = party[Math.min(this.sel, party.length - 1)];
    body.innerHTML = `
      <div class="pt-list">${party.map((m, i) => `
        <div class="pt-row ${i === this.sel ? 'sel' : ''} ${m.fainted ? 'faint' : ''}" data-i="${i}">
          <img src="${spritePath(m.id)}">
          <div class="pt-inf">
            <b>${m.name}${m.shiny ? ' ✨' : ''}</b>
            <div class="hpbar ${m.hpRatio <= .25 ? 'low' : m.hpRatio <= .55 ? 'mid' : ''}"><i style="width:${m.hpRatio * 100}%"></i></div>
            <small>Lv.${m.level} · ${m.hp}/${m.maxHp}${m.status ? ' · ' + AILMENT_ZH[m.status] : ''}</small>
          </div>
          <div class="pt-ops">
            ${i > 0 ? `<button class="mini" data-op="up" data-i="${i}">↑</button>` : ''}
          </div>
        </div>`).join('')}
      </div>
      <div class="pt-detail" id="ptDetail">${this.monDetail(p)}</div>`;
    body.querySelectorAll('.pt-row').forEach(r => r.onclick = e => {
      if (e.target.dataset.op) return;
      this.sel = +r.dataset.i; this.renderBody();
    });
    body.querySelectorAll('[data-op=up]').forEach(b => b.onclick = () => {
      const i = +b.dataset.i;
      [party[i - 1], party[i]] = [party[i], party[i - 1]];
      this.sel = i - 1; this.renderBody();
    });
    this.bindDetail(body, p);
  }

  monDetail(p) {
    const sp = p.species;
    const stats = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
    const statMax = 160;
    const evo = sp.evo?.filter(e => e.method === 'item');
    return `
      <div class="pd-head">
        <img class="pd-art" src="${artPath(p.id)}">
        <div>
          <div class="pd-name">${p.name} <small>${sp.zh !== p.name ? sp.zh : ''} No.${String(p.id).padStart(3, '0')}</small></div>
          <div>${p.types.map(t => `<span class="chip t-${t}">${TYPE_ZH[t]}</span>`).join(' ')}</div>
          <div class="pd-sub">${sp.genus} · ${p.nature[0]}性格 · ${p.metAt ? '遇见于' + p.metAt : ''}</div>
          <div class="pd-sub">经验 ${p.exp} · 升级还需 ${p.expToNext()}</div>
        </div>
      </div>
      <div class="pd-stats">${stats.map(s => {
        const v = p.stat(s);
        return `<div class="pd-stat"><span>${STAT_ZH[s]}</span>
          <div class="pd-bar"><i style="width:${Math.min(100, v / statMax * 100)}%"></i></div><b>${v}</b></div>`;
      }).join('')}</div>
      <div class="pd-ivs">个体值: ${stats.map(s => `${STAT_ZH[s]}${p.ivs[s]}`).join(' / ')}</div>
      <div class="pd-moves">${p.moves.map(m => {
        const md = moveData(m.m);
        return `<div class="pd-move"><span class="chip t-${md.type}">${TYPE_ZH[md.type]}</span><b>${md.zh}</b><small>PP ${m.pp}/${m.maxPp}</small></div>`;
      }).join('')}</div>
      <div class="pd-ops">
        <button class="btn" data-act="cry">🔊 叫声</button>
        ${evo?.length ? evo.map(e => G.save.count(e.item) > 0 ? `<button class="btn gold" data-act="evo" data-item="${e.item}" data-to="${e.to}">使用${ITEMS[e.item]?.zh}进化</button>` : '').join('') : ''}
        ${G.save.party.length > 1 ? `<button class="btn warn" data-act="box">存入盒子</button>` : ''}
      </div>`;
  }

  bindDetail(body, p) {
    body.querySelector('[data-act=cry]')?.addEventListener('click', () => G.audio?.cry?.(p.id));
    body.querySelector('[data-act=box]')?.addEventListener('click', () => {
      const i = G.save.party.indexOf(p);
      G.save.party.splice(i, 1);
      G.save.box.push(p);
      emit('toast', { text: `${p.name} 被送入盒子` });
      this.sel = 0; this.renderBody();
    });
    body.querySelectorAll('[data-act=evo]').forEach(b => b.onclick = async () => {
      const item = b.dataset.item, to = +b.dataset.to;
      if (!G.save.useItem(item)) return;
      this.toggle(false);
      await runEvolution(p, to);
    });
  }

  // ---------- 背包 ----------
  renderBag(body) {
    const entries = Object.entries(G.save.bag);
    body.innerHTML = `
      <div class="bag-grid">${entries.length ? entries.map(([id, n]) => {
        const it = ITEMS[id];
        if (!it) return '';
        return `<div class="bag-item" data-id="${id}">
          <div class="bag-ico">${{ ball: '⚪', heal: '🧪', revive: '💫', cure: '💊', berry: '🍓', evo: '💎', key: '🔑' }[it.type] ?? '📦'}</div>
          <b>${it.zh}</b><small>×${n}</small>
        </div>`;
      }).join('') : '<div class="menu-empty">背包空空如也</div>'}</div>
      <div class="bag-detail" id="bagDetail">点击道具查看</div>`;
    body.querySelectorAll('.bag-item').forEach(el => el.onclick = () => {
      const id = el.dataset.id, it = ITEMS[id];
      const det = document.getElementById('bagDetail');
      const usable = ['heal', 'revive', 'cure'].includes(it.type) && G.save.party.length;
      det.innerHTML = `<b>${it.zh}</b><p>${it.desc}</p>
        ${usable ? `<div class="bag-use">${G.save.party.map((p, i) => `<button class="btn" data-i="${i}">${p.name} ${p.hp}/${p.maxHp}</button>`).join('')}</div>` : ''}`;
      det.querySelectorAll('[data-i]').forEach(b => b.onclick = () => {
        const p = G.save.party[+b.dataset.i];
        if (it.type === 'heal') {
          if (p.fainted) { emit('toast', { text: '濒死的宝可梦需要活力碎片' }); return; }
          if (!G.save.useItem(id)) return;
          p.hp = Math.min(p.maxHp, p.hp + it.heal);
          if (it.cure) p.status = null;
        } else if (it.type === 'revive') {
          if (!p.fainted) { emit('toast', { text: 'TA还很有精神！' }); return; }
          if (!G.save.useItem(id)) return;
          p.hp = Math.floor(p.maxHp / 2);
        } else if (it.type === 'cure') {
          if (p.status !== it.cures) { emit('toast', { text: '没有效果' }); return; }
          if (!G.save.useItem(id)) return;
          p.status = null;
        }
        G.audio?.sfx?.('heal');
        this.renderBody();
      });
    });
  }

  // ---------- 图鉴 ----------
  renderDex(body) {
    const caught = G.save.dexCaught, seen = G.save.dexSeen;
    body.innerHTML = `
      <div class="dex-head">关都图鉴 · 捕获 <b>${caught.size}</b> / 发现 ${seen.size} / 151</div>
      <div class="dex-grid">${G.dex.species.map(sp => {
        const c = caught.has(sp.id), s = seen.has(sp.id);
        return `<div class="dex-cell ${c ? 'caught' : s ? 'seen' : ''}" data-id="${sp.id}">
          ${s || c ? `<img src="${spritePath(sp.id)}" loading="lazy">` : `<span class="q">?</span>`}
          <small>${String(sp.id).padStart(3, '0')}</small>
        </div>`;
      }).join('')}</div>
      <div class="dex-detail" id="dexDetail"></div>`;
    body.querySelectorAll('.dex-cell').forEach(el => el.onclick = () => {
      const id = +el.dataset.id;
      const sp = speciesOf(id);
      const c = caught.has(id), s = seen.has(id);
      const det = document.getElementById('dexDetail');
      if (!c && !s) { det.innerHTML = '<div class="menu-empty">尚未发现这只宝可梦</div>'; return; }
      det.innerHTML = `
        <div class="dexd">
          <img class="dexd-art ${c ? '' : 'sil'}" src="${artPath(id)}">
          <div class="dexd-inf">
            <div class="pd-name">No.${String(id).padStart(3, '0')} ${sp.zh} ${c ? '' : '<small>(未捕获)</small>'}</div>
            <div>${sp.types.map(t => `<span class="chip t-${t}">${TYPE_ZH[t]}</span>`).join(' ')}</div>
            <div class="pd-sub">${sp.genus} · 身高${(sp.height / 10).toFixed(1)}m · 体重${(sp.weight / 10).toFixed(1)}kg</div>
            <p class="dexd-txt">${c ? sp.dex : '捕获后可查看图鉴描述。'}</p>
            <button class="btn" data-cry="${id}">🔊 叫声</button>
          </div>
        </div>`;
      det.querySelector('[data-cry]').onclick = () => G.audio?.cry?.(id);
    });
  }

  // ---------- 地图 ----------
  renderMap(body) {
    body.innerHTML = `<canvas id="bigMap" width="520" height="520"></canvas>
      <div class="map-legend">
        ${Object.entries(ZONE_NAMES).filter(([k]) => !['sea'].includes(k)).map(([k, v]) => `<span class="ml"><i class="ml-${k}"></i>${v}</span>`).join('')}
      </div>`;
    const ctx = document.getElementById('bigMap').getContext('2d');
    const N = 520;
    const colors = { sea: '#2b6cb0', beach: '#eed9a4', grass: '#7ecb5c', forest: '#4d9e52', town: '#8fd468', lake: '#4f9fd8', snow: '#eef4fb', volcano: '#6e4a45', cave: '#5d5a6e', ruins: '#cfc7a8', temple: '#dfe9f5' };
    const img = ctx.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const wx = (x / N - .5) * WORLD.size * 1.1, wz = (y / N - .5) * WORLD.size * 1.1;
      const b = getBiome(wx, wz);
      const h = getHeight(wx, wz);
      let c = colors[b] ?? '#7ecb5c';
      if (b !== 'sea' && h < 0) c = colors.sea;
      const v = parseInt(c.slice(1), 16);
      const i = (y * N + x) * 4;
      const shade = b === 'sea' ? 1 : .88 + Math.min(h, 90) / 300;
      img.data[i] = (v >> 16) * shade; img.data[i + 1] = ((v >> 8) & 255) * shade; img.data[i + 2] = (v & 255) * shade; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // 地标
    const mark = (x, z, label, icon) => {
      const mx = (x / (WORLD.size * 1.1) + .5) * N, my = (z / (WORLD.size * 1.1) + .5) * N;
      ctx.font = '15px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(icon, mx, my);
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 2.4;
      ctx.strokeText(label, mx, my + 14); ctx.fillText(label, mx, my + 14);
    };
    mark(WORLD.town.x, WORLD.town.z, '曦光镇', '🏘️');
    mark(WORLD.lake.x, WORLD.lake.z, '镜湖', '💧');
    mark(WORLD.volcano.x, WORLD.volcano.z, '熔心火山', '🌋');
    mark(WORLD.mountain.x, WORLD.mountain.z - 60, '霜峰', '🏔️');
    mark(WORLD.ruins.x, WORLD.ruins.z, '星陨遗迹', '🏛️');
    mark(WORLD.cave.x, WORLD.cave.z, '回声洞窟', '🕳️');
    mark(WORLD.temple.x, WORLD.temple.z, '极光神殿', '✨');
    const q = G.quests?.activeMarker?.();
    if (q) mark(q.x, q.z, '目标', '⭐');
    // 玩家
    const P = G.player.pos;
    mark(P.x, P.z, '', '📍');
  }

  // ---------- 任务 ----------
  renderQuest(body) {
    const qs = G.quests?.list?.() ?? [];
    body.innerHTML = qs.length ? `<div class="q-list">${qs.map(q => `
      <div class="q-item ${q.done ? 'done' : q.active ? 'active' : ''}">
        <div class="q-status">${q.done ? '✅' : q.active ? '⭐' : '◻️'}</div>
        <div><b>${q.name}</b><p>${q.desc}</p></div>
      </div>`).join('')}</div>` : '<div class="menu-empty">暂无任务</div>';
  }

  // ---------- 系统 ----------
  renderSys(body) {
    const S = G.settings ?? {};
    const pct = v => Math.round((v ?? 0) * 100);
    body.innerHTML = `
      <div class="sys-grid">
        <button class="btn big" id="sysSave">💾 保存进度</button>
        <button class="btn big" id="sysExport">📤 导出存档</button>
        <button class="btn big" id="sysImport">📥 导入存档</button>
        <button class="btn big" id="sysNet">🌐 联机大厅</button>
        <div class="sys-row">昼夜速度
          <select id="sysDay"><option value="1320">标准(22分钟/天)</option><option value="600">快(10分钟)</option><option value="120">极快(2分钟)</option><option value="0">暂停时间</option></select>
        </div>
        <div class="sys-row">总音量 <input type="range" id="setMaster" min="0" max="100" value="${pct(S.master ?? .9)}"></div>
        <div class="sys-row">音乐 <input type="range" id="setBgm" min="0" max="100" value="${pct(S.bgm ?? .45)}"></div>
        <div class="sys-row">音效 <input type="range" id="setSfx" min="0" max="100" value="${pct(S.sfx ?? .7)}"></div>
        <div class="sys-row">精灵叫声 <input type="range" id="setCry" min="0" max="100" value="${pct(S.cry ?? 1)}"></div>
        <div class="sys-row">镜头灵敏度 <input type="range" id="setSens" min="30" max="200" value="${Math.round((S.sens ?? 1) * 100)}"></div>
        <div class="sys-row">减少镜头晃动 <input type="checkbox" id="setMotion" ${S.reduceMotion ? 'checked' : ''}></div>
        <div class="sys-row">界面字体
          <select id="setFont">
            <option value="1" ${(S.fontScale ?? 1) === 1 ? 'selected' : ''}>标准</option>
            <option value="1.15" ${S.fontScale === 1.15 ? 'selected' : ''}>大</option>
            <option value="1.3" ${S.fontScale === 1.3 ? 'selected' : ''}>特大</option>
          </select>
        </div>
        <div class="sys-row">玩家: ${G.save.name} · 游玩 ${Math.floor(G.save.playTime / 60)} 分钟 · 徽章 ${G.save.badges.length}</div>
      </div>`;
    const bind = (id, key, div = 100) => {
      body.querySelector(id).oninput = e => Settings.set(key, +e.target.value / div);
    };
    bind('#setMaster', 'master'); bind('#setBgm', 'bgm'); bind('#setSfx', 'sfx');
    bind('#setCry', 'cry'); bind('#setSens', 'sens');
    body.querySelector('#setMotion').onchange = e => Settings.set('reduceMotion', e.target.checked);
    body.querySelector('#setFont').onchange = e => Settings.set('fontScale', +e.target.value);
    body.querySelector('#sysSave').onclick = () => { G.save.save(); emit('toast', { text: '✅ 已保存' }); };
    body.querySelector('#sysExport').onclick = () => {
      const data = JSON.stringify(G.save.save());
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      a.download = 'pokemon-gems-save.json';
      a.click();
    };
    body.querySelector('#sysImport').onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.json';
      inp.onchange = async () => {
        const text = await inp.files[0].text();
        localStorage.setItem('gem_save_0', text);
        location.reload();
      };
      inp.click();
    };
    body.querySelector('#sysNet').onclick = () => { this.toggle(false); G.net?.openLobby(); };
    body.querySelector('#sysDay').onchange = e => {
      const v = +e.target.value;
      if (v === 0) G.sky.paused = true;
      else { G.sky.paused = false; G.sky.dayLength = v; }
    };
  }
}
