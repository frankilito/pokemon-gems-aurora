// 战斗界面：指令面板 / HP条 / 打字机消息 / 换人与学招弹窗
import { G, on } from '../core/engine.js';
import { moveData } from '../mon/pokemon.js';
import { TYPE_ZH, AILMENT_ZH } from '../mon/types.js';
import { ITEMS } from '../core/state.js';
import { spritePath } from '../core/assets.js';

export class BattleUI {
  constructor() {
    this.root = document.getElementById('battle');
    this.battle = null;
    this._advance = null;
    addEventListener('keydown', e => {
      if ((e.code === 'Space' || e.code === 'Enter') && this._advance) { this._advance(); }
    });
  }

  show(battle) {
    this.battle = battle;
    this.root.innerHTML = `
      <div class="bt-info bt-enemy panel" id="btEnemy"></div>
      <div class="bt-info bt-mine panel" id="btMine"></div>
      <div class="bt-bottom">
        <div class="bt-msg panel" id="btMsg"><span id="btMsgText"></span><span class="bt-next" id="btNext">▼</span></div>
        <div class="bt-cmds panel" id="btCmds"></div>
      </div>
      <div class="bt-modal" id="btModal"></div>
    `;
    this.root.style.display = 'block';
    this.root.style.pointerEvents = 'none';
    this.updateBars();
  }
  hide() {
    this.root.style.display = 'none';
    this.root.innerHTML = '';
    this.battle = null;
  }

  infoCard(mon, mine) {
    const hpPct = Math.round(mon.hpRatio * 100);
    const hpCls = hpPct <= 25 ? 'low' : hpPct <= 55 ? 'mid' : '';
    const st = mon.status ? `<span class="bt-status st-${mon.status}">${AILMENT_ZH[mon.status]}</span>` : '';
    const types = mon.types.map(t => `<span class="chip t-${t}">${TYPE_ZH[t]}</span>`).join('');
    return `
      <div class="bt-row1">
        <img class="bt-spr" src="${spritePath(mon.id, mine)}" alt="">
        <div class="bt-nm">
          <div class="n">${mon.name} ${mon.shiny ? '✨' : ''} ${st}</div>
          <div class="t">${types}<span class="lv">Lv.${mon.level}</span></div>
        </div>
      </div>
      <div class="hpbar ${hpCls}"><i style="width:${hpPct}%"></i></div>
      <div class="bt-hpnum">${mine ? `${mon.hp} / ${mon.maxHp}` : ''}</div>
      ${mine ? `<div class="xpbar"><i style="width:${Math.round(mon.expProgress() * 100)}%"></i></div>` : ''}
    `;
  }

  updateBars() {
    const b = this.battle; if (!b) return;
    const e = document.getElementById('btEnemy'), m = document.getElementById('btMine');
    if (e) e.innerHTML = this.infoCard(b.enemyMon, false);
    if (m && b.myMon) m.innerHTML = this.infoCard(b.myMon, true);
  }

  msg(text) {
    return new Promise(res => {
      const el = document.getElementById('btMsgText');
      const next = document.getElementById('btNext');
      if (!el) return res();
      next.style.opacity = 0;
      el.textContent = '';
      let i = 0;
      const iv = setInterval(() => {
        el.textContent = text.slice(0, ++i);
        if (i >= text.length) { clearInterval(iv); next.style.opacity = 1; }
      }, 16);
      let done = false;
      const finish = () => {
        if (done) return; done = true;
        clearInterval(iv); el.textContent = text;
        this._advance = null;
        clearTimeout(tm);
        res();
      };
      this._advance = finish;
      const tm = setTimeout(finish, 900 + text.length * 34);
      document.getElementById('btMsg').onclick = finish;
    });
  }

  mainMenu() {
    return new Promise(res => {
      const b = this.battle;
      const cmds = document.getElementById('btCmds');
      this.root.style.pointerEvents = 'all';
      const render = () => {
        cmds.innerHTML = `
          <button class="bt-cmd main" data-a="fight">⚔️ 战斗</button>
          <button class="bt-cmd" data-a="bag">🎒 背包</button>
          <button class="bt-cmd" data-a="mon">🔄 宝可梦</button>
          <button class="bt-cmd" data-a="run">🏃 逃跑</button>`;
        cmds.querySelectorAll('button').forEach(btn => btn.onclick = () => {
          const a = btn.dataset.a;
          if (a === 'fight') showMoves();
          else if (a === 'bag') showBag();
          else if (a === 'mon') showParty(false);
          else if (a === 'run') { this.root.style.pointerEvents = 'none'; res({ type: 'run' }); }
        });
      };
      const showMoves = () => {
        const mv = b.myMon.moves;
        cmds.innerHTML = mv.map((m, i) => {
          const md = moveData(m.m);
          return `<button class="bt-cmd mv ${m.pp <= 0 ? 'dis' : ''}" data-i="${i}">
            <span class="chip t-${md.type}">${TYPE_ZH[md.type]}</span>
            <b>${md.zh}</b>
            <small>${md.power ? md.power + '威力' : '变化'} · PP ${m.pp}/${m.maxPp}</small>
          </button>`;
        }).join('') + `<button class="bt-cmd back" data-i="-1">↩ 返回</button>`;
        cmds.querySelectorAll('button').forEach(btn => btn.onclick = () => {
          const i = +btn.dataset.i;
          if (i < 0) return render();
          if (b.myMon.moves[i].pp <= 0) return;
          this.root.style.pointerEvents = 'none';
          res({ type: 'move', move: b.myMon.moves[i] });
        });
      };
      const showBag = () => {
        const usable = Object.entries(G.save.bag).filter(([id]) => ITEMS[id] && ['ball', 'heal', 'revive', 'cure'].includes(ITEMS[id].type));
        cmds.innerHTML = (usable.length ? usable.map(([id, n]) =>
          `<button class="bt-cmd item" data-id="${id}"><b>${ITEMS[id].zh}</b><small>×${n}</small></button>`).join('') : '<div class="bt-empty">没有可用道具</div>')
          + `<button class="bt-cmd back">↩ 返回</button>`;
        cmds.querySelectorAll('button').forEach(btn => btn.onclick = () => {
          if (btn.classList.contains('back')) return render();
          const id = btn.dataset.id;
          const it = ITEMS[id];
          if (it.type === 'heal' || it.type === 'revive' || it.type === 'cure') {
            showParty(true, idx => { this.root.style.pointerEvents = 'none'; res({ type: 'item', item: id, target: idx }); });
          } else {
            this.root.style.pointerEvents = 'none';
            res({ type: 'item', item: id });
          }
        });
      };
      const showParty = (forItem, cb) => {
        cmds.innerHTML = G.save.party.map((p, i) =>
          `<button class="bt-cmd mon ${p.fainted && !forItem ? 'dis' : ''} ${p === b.myMon ? 'cur' : ''}" data-i="${i}">
            <img src="${spritePath(p.id)}"><b>${p.name}</b><small>Lv.${p.level} · ${p.hp}/${p.maxHp}</small>
          </button>`).join('') + `<button class="bt-cmd back" data-i="-1">↩ 返回</button>`;
        cmds.querySelectorAll('button').forEach(btn => btn.onclick = () => {
          const i = +btn.dataset.i;
          if (i < 0) return render();
          const p = G.save.party[i];
          if (forItem) { cb(i); return; }
          if (p.fainted || p === b.myMon) return;
          this.root.style.pointerEvents = 'none';
          res({ type: 'switch', idx: i });
        });
      };
      render();
    });
  }

  pickReplace() {
    return new Promise(res => {
      this.root.style.pointerEvents = 'all';
      const cmds = document.getElementById('btCmds');
      cmds.innerHTML = `<div class="bt-empty">选择下一只宝可梦</div>` + G.save.party.map((p, i) =>
        `<button class="bt-cmd mon ${p.fainted ? 'dis' : ''}" data-i="${i}">
          <img src="${spritePath(p.id)}"><b>${p.name}</b><small>Lv.${p.level} · ${p.hp}/${p.maxHp}</small>
        </button>`).join('');
      cmds.querySelectorAll('button').forEach(btn => btn.onclick = () => {
        const i = +btn.dataset.i;
        const p = G.save.party[i];
        if (!p || p.fainted) return;
        this.root.style.pointerEvents = 'none';
        res(i);
      });
    });
  }

  learnMovePrompt(mon, newMove) {
    return new Promise(res => {
      this.root.style.pointerEvents = 'all';
      const modal = document.getElementById('btModal');
      const md = moveData(newMove);
      modal.innerHTML = `
        <div class="bt-learn panel">
          <div class="bt-learn-title">${mon.name} 想学会 <span class="chip t-${md.type}">${TYPE_ZH[md.type]}</span> <b>${md.zh}</b></div>
          <div class="bt-learn-sub">但已经学会了4个招式，要忘记哪个？</div>
          ${mon.moves.map((m, i) => {
            const o = moveData(m.m);
            return `<button class="bt-cmd mv" data-i="${i}"><span class="chip t-${o.type}">${TYPE_ZH[o.type]}</span><b>${o.zh}</b><small>${o.power ? o.power + '威力' : '变化'}</small></button>`;
          }).join('')}
          <button class="bt-cmd back" data-i="-1">放弃学习 ${md.zh}</button>
        </div>`;
      modal.style.display = 'flex';
      modal.querySelectorAll('button').forEach(btn => btn.onclick = () => {
        modal.style.display = 'none'; modal.innerHTML = '';
        res(+btn.dataset.i);
      });
    });
  }
}
