// 联机：PeerJS 房间码 / 精灵交换 / 好友对战(主机权威)
import * as THREE from 'three';
import { G, on, emit } from '../core/engine.js';
import { Pokemon, moveData } from '../mon/pokemon.js';
import { Fighter, calcDamage, EFF_TEXT, aiPick } from '../battle/calc.js';
import { MonActor } from '../mon/monActor.js';
import { FX } from '../core/fx.js';
import { getHeight } from '../world/world.js';
import { spritePath } from '../core/assets.js';
import { TYPE_ZH } from '../mon/types.js';
import { Input } from '../core/input.js';
import { clamp } from '../core/math.js';

const PREFIX = 'gems-aurora-';
const code5 = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.random() * 32 | 0]).join('');

export class Net {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.root = document.getElementById('net');
    this.myOffer = null;
    this.theirOffer = null;
    this.pvp = null;
  }

  openLobby() {
    if (G.state === 'battle') return;
    G.state = 'menu';
    G.player?.freeze(true);
    Input.unlock();
    this.renderLobby('');
  }

  renderLobby(status) {
    this.root.style.pointerEvents = 'all';
    this.root.innerHTML = `
      <div class="net-wrap panel">
        <div class="net-title">🌐 联机大厅</div>
        <div class="net-status">${status || (this.conn ? `✅ 已连接 · 房间 ${this.roomCode}` : '创建房间或输入好友的房间码')}</div>
        ${!this.conn ? `
          <div class="net-row">
            <button class="btn big" id="netCreate">🏠 创建房间</button>
          </div>
          <div class="net-row">
            <input id="netCode" maxlength="5" placeholder="房间码" style="text-transform:uppercase">
            <button class="btn" id="netJoin">加入</button>
          </div>` : `
          <div class="net-row">
            <button class="btn big" id="netTrade">🔄 交换宝可梦</button>
            <button class="btn big" id="netPvp">⚔️ 好友对战</button>
          </div>
          <div class="net-row"><button class="btn warn" id="netLeave">断开连接</button></div>`}
        <div class="net-row"><button class="btn" id="netClose">返回游戏</button></div>
      </div>`;
    const $ = id => this.root.querySelector(id);
    $('#netClose').onclick = () => this.closeLobby();
    $('#netCreate')?.addEventListener('click', () => this.host());
    $('#netJoin')?.addEventListener('click', () => {
      const code = $('#netCode').value.toUpperCase().trim();
      if (code.length === 5) this.join(code);
    });
    $('#netTrade')?.addEventListener('click', () => this.openTrade());
    $('#netPvp')?.addEventListener('click', () => { this.send({ t: 'pvp:invite' }); this.renderLobby('已发送对战邀请，等待对方接受…'); });
    $('#netLeave')?.addEventListener('click', () => { this.conn?.close(); this.conn = null; this.renderLobby('已断开'); });
  }

  closeLobby() {
    this.root.innerHTML = '';
    this.root.style.pointerEvents = 'none';
    if (G.state === 'menu') { G.state = 'roam'; G.player?.freeze(false); }
  }

  ensurePeer(id) {
    return new Promise((res, rej) => {
      if (this.peer && !this.peer.destroyed) { res(this.peer); return; }
      const peer = new Peer(id, { debug: 0 });
      peer.on('open', () => { this.peer = peer; res(peer); });
      peer.on('error', e => { this.renderLobby('❌ 连接出错: ' + e.type); rej(e); });
      peer.on('connection', conn => this.bindConn(conn));
    });
  }

  async host() {
    this.roomCode = code5();
    this.renderLobby('创建中…');
    try {
      await this.ensurePeer(PREFIX + this.roomCode);
      this.isHost = true;
      this.renderLobby(`房间码: <b class="net-code">${this.roomCode}</b> — 等待好友加入…`);
    } catch (e) {}
  }

  async join(code) {
    this.renderLobby('加入中…');
    try {
      await this.ensurePeer(PREFIX + code5());   // 自己用随机id
      const conn = this.peer.connect(PREFIX + code, { reliable: true });
      this.roomCode = code;
      this.isHost = false;
      conn.on('open', () => this.bindConn(conn));
      conn.on('error', () => this.renderLobby('❌ 无法连接该房间'));
      setTimeout(() => { if (!this.conn) this.renderLobby('❌ 连接超时，检查房间码'); }, 8000);
    } catch (e) {}
  }

  bindConn(conn) {
    if (this.conn) { conn.close(); return; }
    this.conn = conn;
    conn.on('data', d => this.onData(d));
    conn.on('close', () => {
      this.conn = null;
      emit('toast', { text: '联机连接已断开' });
      if (this.pvp) this.pvp.abort('对方断开了连接');
      if (this.root.innerHTML) this.renderLobby('对方已断开');
    });
    emit('toast', { text: '🌐 好友已连接！' });
    if (this.root.innerHTML) this.renderLobby('');
    this.send({ t: 'hello', name: G.save.name });
  }

  send(obj) { try { this.conn?.send(JSON.stringify(obj)); } catch (e) {} }

  onData(raw) {
    let d; try { d = JSON.parse(raw); } catch (e) { return; }
    switch (d.t) {
      case 'hello': this.peerName = d.name; break;
      case 'trade:open': if (!this.tradeOpen) this.openTrade(true); break;
      case 'trade:offer': this.theirOffer = d.mon; this.renderTrade(); break;
      case 'trade:confirm': this.theirConfirm = true; this.checkTradeDone(); this.renderTrade(); break;
      case 'trade:cancel': this.resetTrade(); this.renderTrade('对方取消了交换'); break;
      case 'trade:close': this.tradeOpen = false; this.renderLobby('对方关闭了交换'); break;
      case 'pvp:invite': this.onPvpInvite(); break;
      case 'pvp:accept': this.startPvp(true); break;
      case 'pvp:team': this.pvp?.onTeam(d.team); break;
      case 'pvp:choice': this.pvp?.onRemoteChoice(d); break;
      case 'pvp:events': this.pvp?.onEvents(d.events); break;
      case 'pvp:quit': this.pvp?.abort('对方退出了对战'); break;
    }
  }

  // ---------- 交换 ----------
  openTrade(passive = false) {
    this.tradeOpen = true;
    this.resetTrade();
    if (!passive) this.send({ t: 'trade:open' });
    this.renderTrade();
  }
  resetTrade() { this.myOffer = null; this.theirOffer = null; this.myConfirm = false; this.theirConfirm = false; }

  renderTrade(status = '') {
    if (!this.tradeOpen) return;
    const mineList = G.save.party.map((p, i) =>
      `<div class="tr-mon ${this.myOffer?.uid === p.uid ? 'sel' : ''}" data-i="${i}">
        <img src="${spritePath(p.id)}"><b>${p.name}</b><small>Lv.${p.level}</small>
      </div>`).join('');
    const their = this.theirOffer;
    this.root.innerHTML = `
      <div class="net-wrap panel wide">
        <div class="net-title">🔄 交换宝可梦 ${status ? `<small>${status}</small>` : ''}</div>
        <div class="tr-cols">
          <div class="tr-col">
            <div class="tr-head">我的队伍 (点击选择)</div>
            <div class="tr-list">${mineList}</div>
            <div class="tr-offer">送出: ${this.myOffer ? `<b>${this.myOffer.nickname || nameOf(this.myOffer.id)}</b> Lv.${this.myOffer.level} ${this.myConfirm ? '✅' : ''}` : '—'}</div>
          </div>
          <div class="tr-col">
            <div class="tr-head">对方送出</div>
            <div class="tr-their">${their ? `<img src="${spritePath(their.id)}"><b>${their.nickname || nameOf(their.id)}</b> Lv.${their.level} ${this.theirConfirm ? '✅' : ''}` : '等待对方选择…'}</div>
          </div>
        </div>
        <div class="net-row">
          <button class="btn big gold" id="trConfirm" ${(!this.myOffer || !this.theirOffer || this.myConfirm) ? 'disabled' : ''}>✅ 确认交换</button>
          <button class="btn" id="trCancel">取消选择</button>
          <button class="btn warn" id="trClose">关闭</button>
        </div>
      </div>`;
    this.root.style.pointerEvents = 'all';
    this.root.querySelectorAll('.tr-mon').forEach(el => el.onclick = () => {
      if (this.myConfirm) return;
      if (G.save.party.length <= 1) { emit('toast', { text: '不能交换最后一只宝可梦！' }); return; }
      const p = G.save.party[+el.dataset.i];
      this.myOffer = p.serialize();
      this.send({ t: 'trade:offer', mon: this.myOffer });
      this.renderTrade();
    });
    this.root.querySelector('#trConfirm')?.addEventListener('click', () => {
      this.myConfirm = true;
      this.send({ t: 'trade:confirm' });
      this.checkTradeDone();
      this.renderTrade();
    });
    this.root.querySelector('#trCancel')?.addEventListener('click', () => {
      this.resetTrade();
      this.send({ t: 'trade:cancel' });
      this.renderTrade();
    });
    this.root.querySelector('#trClose')?.addEventListener('click', () => {
      this.tradeOpen = false;
      this.send({ t: 'trade:close' });
      this.renderLobby('');
    });
  }

  checkTradeDone() {
    if (!this.myConfirm || !this.theirConfirm || !this.myOffer || !this.theirOffer) return;
    // 执行交换
    const idx = G.save.party.findIndex(p => p.uid === this.myOffer.uid);
    if (idx >= 0) G.save.party.splice(idx, 1);
    const incoming = Pokemon.from(this.theirOffer);
    G.save.addMon(incoming);
    G.audio?.sfx?.('catch');
    G.audio?.cry?.(incoming.id);
    emit('toast', { text: `交换成功！获得了 ${incoming.name}！`, icon: incoming.id });
    FX.catchStars(G.player.pos.clone().add(new THREE.Vector3(0, 1.2, 0)));
    this.tradeOpen = false;
    this.resetTrade();
    this.renderLobby('✅ 交换完成！');
  }

  // ---------- PvP ----------
  async onPvpInvite() {
    const ok = await G.ui.dialog.choice(this.peerName ?? '好友', '对方发来了对战邀请！', ['⚔️ 接受', '拒绝']);
    if (ok === 0) { this.send({ t: 'pvp:accept' }); this.startPvp(false); }
  }
  startPvp(iAmHost) {
    this.closeLobby();
    this.pvp = new PvPBattle(this, iAmHost ?? this.isHost);
    this.pvp.start();
  }
}
const nameOf = id => G.dex.species[id - 1]?.zh ?? '?';

// ---------- 好友对战(主机权威) ----------
class PvPBattle {
  constructor(net, isHost) {
    this.net = net;
    this.isHost = isHost;
    this.ui = G.ui.battle;
    this.over = false;
  }
  async start() {
    G.state = 'battle';
    G.player.freeze(true);
    this.myTeam = G.save.party.filter(p => !p.fainted).map(p => Pokemon.from({ ...p.serialize(), hp: p.maxHp, status: null }));
    this.myTeam.forEach(p => p.heal());
    if (!this.myTeam.length) { this.abort('没有可战斗的宝可梦'); return; }
    this.net.send({ t: 'pvp:team', team: this.myTeam.map(p => p.serialize()) });
    this.ui.show(this);
    await this.ui.msg('等待对方队伍数据…');
  }
  onTeam(team) {
    this.theirTeam = team.map(Pokemon.from);
    this.myIdx = 0; this.theirIdx = 0;
    this.myMon = this.myTeam[0];
    this.enemyMon = this.theirTeam[0];
    this.setupActors();
    this.ui.updateBars();
    this.turnLoop();
  }
  setupActors() {
    this.myActor?.dispose(G.scene);
    this.enemyActor?.dispose(G.scene);
    const P = G.player.pos;
    const dir = new THREE.Vector3(Math.sin(G.player.yaw), 0, Math.cos(G.player.yaw));
    const mid = P.clone().addScaledVector(dir, 6);
    const mk = (mon, off) => {
      const a = new MonActor(mon, { behavior: 'static' });
      const p = mid.clone().addScaledVector(dir, off);
      p.y = getHeight(p.x, p.z);
      a.pos.copy(p);
      G.scene.add(a.group);
      return a;
    };
    this.myActor = mk(this.myMon, -3.2);
    this.enemyActor = mk(this.enemyMon, 3.2);
    this.myActor.yaw = Math.atan2(dir.x, dir.z);
    this.enemyActor.yaw = this.myActor.yaw + Math.PI;
    FX.releaseFlash(this.myActor.pos, this.myActor);
    FX.releaseFlash(this.enemyActor.pos, this.enemyActor);
    if (!this.camFn) {
      this.camFn = dt => {
        const a = this.myActor.pos, b = this.enemyActor.pos;
        const m = a.clone().add(b).multiplyScalar(.5);
        const side = new THREE.Vector3(b.z - a.z, 0, -(b.x - a.x)).normalize();
        const t = m.clone().addScaledVector(side, 7).add(new THREE.Vector3(0, 1.8, 0));
        G.camera.position.lerp(t, .06);
        G.camera.lookAt(m.clone().add(new THREE.Vector3(0, .8, 0)));
      };
      G.updaters.add(this.camFn);
    }
  }

  async turnLoop() {
    while (!this.over) {
      const choice = await this.pvpMenu();
      if (this.over) return;
      this.myChoice = choice;
      this.net.send({ t: 'pvp:choice', choice });
      await this.ui.msg('等待对方出招…');
      await new Promise(res => { this._choiceWait = res; if (this.remoteChoice) res(); });
      if (this.over) return;
      const theirs = this.remoteChoice; this.remoteChoice = null;
      if (this.isHost) {
        const events = this.resolve(this.myChoice, theirs);
        this.net.send({ t: 'pvp:events', events: this.mirror(events) });
        await this.playEvents(events);
      } else {
        await new Promise(res => { this._eventsWait = res; if (this.pendingEvents) res(); });
        const ev = this.pendingEvents; this.pendingEvents = null;
        await this.playEvents(ev);
      }
    }
  }
  onRemoteChoice(d) { this.remoteChoice = d.choice; this._choiceWait?.(); this._choiceWait = null; }
  onEvents(events) { this.pendingEvents = events; this._eventsWait?.(); this._eventsWait = null; }

  pvpMenu() {
    return new Promise(res => {
      const cmds = document.getElementById('btCmds');
      if (!cmds) return res({ type: 'forfeit' });
      this.ui.root.style.pointerEvents = 'all';
      const render = () => {
        cmds.innerHTML = this.myMon.moves.map((m, i) => {
          const md = moveData(m.m);
          return `<button class="bt-cmd mv ${m.pp <= 0 ? 'dis' : ''}" data-i="${i}">
            <span class="chip t-${md.type}">${TYPE_ZH[md.type]}</span><b>${md.zh}</b><small>PP ${m.pp}/${m.maxPp}</small></button>`;
        }).join('') + `<button class="bt-cmd back" data-a="ff">🏳️ 认输</button>`;
        cmds.querySelectorAll('button').forEach(b => b.onclick = () => {
          if (b.dataset.a === 'ff') { this.ui.root.style.pointerEvents = 'none'; this.net.send({ t: 'pvp:quit' }); this.finish('认输了…对战结束'); res({ type: 'forfeit' }); return; }
          const i = +b.dataset.i;
          if (this.myMon.moves[i].pp <= 0) return;
          this.ui.root.style.pointerEvents = 'none';
          res({ type: 'move', idx: i });
        });
      };
      render();
    });
  }

  // 主机侧解算 → 事件序列(host视角: A=host)
  resolve(hostChoice, guestChoice) {
    const events = [];
    const A = new Fighter(this.myMon), B = new Fighter(this.enemyMon);
    const doMove = (atk, def, mon, defMon, idx, side) => {
      const me = mon.moves[idx];
      if (!me || me.pp <= 0) return;
      me.pp--;
      const mv = moveData(me.m);
      events.push({ ev: 'msg', text: `${mon.name} 使用了 ${mv.zh}！` });
      events.push({ ev: 'anim', side, kind: 'attack', type: mv.type, cls: mv.class });
      const res = calcDamage(atk, def, me.m, 'none');
      if (res.miss) { events.push({ ev: 'msg', text: '没有命中！' }); return; }
      if (mv.class !== 'status') {
        defMon.hp = Math.max(0, defMon.hp - res.dmg);
        events.push({ ev: 'dmg', side: side === 'A' ? 'B' : 'A', dmg: res.dmg, eff: res.eff, crit: res.crit });
        if (res.crit) events.push({ ev: 'msg', text: '会心一击！' });
        const et = EFF_TEXT(res.eff);
        if (et) events.push({ ev: 'msg', text: et });
      }
      if (defMon.fainted) events.push({ ev: 'faint', side: side === 'A' ? 'B' : 'A' });
    };
    const aSpe = A.eff('spe'), bSpe = B.eff('spe');
    const hostFirst = aSpe > bSpe || (aSpe === bSpe && Math.random() < .5);
    const seq = hostFirst
      ? [['A', hostChoice], ['B', guestChoice]]
      : [['B', guestChoice], ['A', hostChoice]];
    for (const [side, ch] of seq) {
      if (ch?.type !== 'move') continue;
      const atkMon = side === 'A' ? this.myMon : this.enemyMon;
      const defMon = side === 'A' ? this.enemyMon : this.myMon;
      if (atkMon.fainted || defMon.fainted) continue;
      doMove(side === 'A' ? A : B, side === 'A' ? B : A, atkMon, defMon, ch.idx, side);
    }
    return events;
  }
  // 翻转视角发给客机
  mirror(events) {
    return events.map(e => e.side ? { ...e, side: e.side === 'A' ? 'B' : 'A' } : e);
  }

  async playEvents(events) {
    for (const e of events) {
      if (this.over) return;
      if (e.ev === 'msg') await this.ui.msg(e.text);
      else if (e.ev === 'anim') {
        const actor = e.side === 'A' ? this.myActor : this.enemyActor;
        actor?.attackAnim();
        G.audio?.sfx?.('attack');
        await new Promise(r => setTimeout(r, 420));
      } else if (e.ev === 'dmg') {
        const mon = e.side === 'A' ? this.myMon : this.enemyMon;
        const actor = e.side === 'A' ? this.myActor : this.enemyActor;
        if (!this.isHost) mon.hp = Math.max(0, mon.hp - e.dmg);   // 客机同步血量
        actor?.hitAnim();
        FX.hitSpark(actor.pos.clone().add(new THREE.Vector3(0, actor.scaleH * .5, 0)), e.eff);
        G.audio?.sfx?.(e.eff >= 2 ? 'hitSuper' : 'hit');
        this.ui.updateBars();
      } else if (e.ev === 'faint') {
        const mine = e.side === 'A';
        const mon = mine ? this.myMon : this.enemyMon;
        const actor = mine ? this.myActor : this.enemyActor;
        if (!this.isHost) mon.hp = 0;
        actor?.faintAnim();
        G.audio?.sfx?.('faint');
        await this.ui.msg(`${mon.name} 倒下了！`);
        // 换人/胜负
        const team = mine ? this.myTeam : this.theirTeam;
        const next = team.find(p => !p.fainted);
        if (!next) {
          await this.finish(mine ? '你输掉了对战…再接再厉！' : '🏆 你赢得了好友对战！');
          return;
        }
        if (mine) { this.myIdx = team.indexOf(next); this.myMon = next; }
        else { this.theirIdx = team.indexOf(next); this.enemyMon = next; }
        this.setupActors();
        await this.ui.msg(`${mine ? '你' : '对方'}派出了 ${next.name}！`);
        this.ui.updateBars();
      }
    }
  }

  async finish(text) {
    if (this.over) return;
    this.over = true;
    await this.ui.msg(text);
    this.cleanup();
  }
  abort(text) {
    if (this.over) { this.cleanup(); return; }
    this.over = true;
    emit('toast', { text });
    this.cleanup();
  }
  cleanup() {
    this._choiceWait?.(); this._eventsWait?.();
    this.ui.hide();
    this.myActor?.dispose(G.scene);
    this.enemyActor?.dispose(G.scene);
    if (this.camFn) { G.updaters.delete(this.camFn); this.camFn = null; }
    G.state = 'roam';
    G.player.freeze(false);
    G.audio?.bgm?.('field');
    this.net.pvp = null;
  }
}
