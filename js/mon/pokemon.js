// 宝可梦实例：个体值/性格/能力计算/经验曲线/升级进化 — 全部采用官方公式
import { NATURES } from './types.js';
import { G } from '../core/engine.js';

export const speciesOf = id => G.dex.species[id - 1];
export const moveData = name => G.dex.moves[name];

// ---- 经验曲线 ----
export function expForLevel(growth, n) {
  if (n <= 1) return 0;
  switch (growth) {
    case 'fast': return Math.floor(4 * n * n * n / 5);
    case 'medium': return n * n * n;
    case 'medium-slow': return Math.floor(6 / 5 * n * n * n) - 15 * n * n + 100 * n - 140;
    case 'slow': return Math.floor(5 * n * n * n / 4);
    case 'slow-then-very-fast': // erratic
      if (n < 50) return Math.floor(n * n * n * (100 - n) / 50);
      if (n < 68) return Math.floor(n * n * n * (150 - n) / 100);
      if (n < 98) return Math.floor(n * n * n * Math.floor((1911 - 10 * n) / 3) / 500);
      return Math.floor(n * n * n * (160 - n) / 100);
    case 'fast-then-very-slow': // fluctuating
      if (n < 15) return Math.floor(n * n * n * (Math.floor((n + 1) / 3) + 24) / 50);
      if (n < 36) return Math.floor(n * n * n * (n + 14) / 50);
      return Math.floor(n * n * n * (Math.floor(n / 2) + 32) / 50);
    default: return n * n * n;
  }
}
export function levelForExp(growth, exp) {
  let lv = 1;
  while (lv < 100 && expForLevel(growth, lv + 1) <= exp) lv++;
  return lv;
}

// ---- 宝可梦实例 ----
let UID = 1;
export class Pokemon {
  constructor(id, level = 5, opts = {}) {
    const sp = speciesOf(id);
    if (!sp) { console.error('[Pokemon] 非法图鉴编号', id, new Error().stack); throw new Error('bad species id ' + id); }
    this.uid = opts.uid ?? (Date.now() % 1e7) * 100 + (UID++ % 100);
    this.id = id;
    this.level = level;
    this.shiny = opts.shiny ?? false;
    this.ivs = opts.ivs ?? {
      hp: rnd32(), atk: rnd32(), def: rnd32(), spa: rnd32(), spd: rnd32(), spe: rnd32(),
    };
    this.natureIdx = opts.natureIdx ?? (Math.random() * 25 | 0);
    this.exp = opts.exp ?? expForLevel(sp.growth, level);
    this.moves = opts.moves ?? this.defaultMoves();
    this.status = opts.status ?? null;      // paralysis burn poison freeze sleep
    this.nickname = opts.nickname ?? null;
    this.ballId = opts.ballId ?? 'poke';
    this.friendship = opts.friendship ?? 70;
    this.hp = opts.hp ?? this.maxHp;
    this.metAt = opts.metAt ?? null;
  }
  get species() { return speciesOf(this.id); }
  get name() { return this.nickname || this.species.zh; }
  get types() { return this.species.types; }
  get nature() { return NATURES[this.natureIdx]; }

  natureMod(stat) {
    const [, up, dn] = this.nature;
    if (stat === up) return 1.1;
    if (stat === dn) return .9;
    return 1;
  }
  stat(key) {
    const base = this.species.stats[key], iv = this.ivs[key], lv = this.level;
    if (key === 'hp') return Math.floor((2 * base + iv) * lv / 100) + lv + 10;
    return Math.floor((Math.floor((2 * base + iv) * lv / 100) + 5) * this.natureMod(key));
  }
  get maxHp() { return this.stat('hp'); }
  get fainted() { return this.hp <= 0; }
  get hpRatio() { return Math.max(0, this.hp / this.maxHp); }

  defaultMoves() {
    const sp = this.species;
    const learnable = sp.moves.filter(m => m.lv <= this.level && moveData(m.m));
    const last4 = learnable.slice(-4);
    // 不足4个则从低级补
    const list = last4.length ? last4 : sp.moves.slice(0, 1);
    return list.map(m => ({ m: m.m, pp: moveData(m.m)?.pp ?? 10, maxPp: moveData(m.m)?.pp ?? 10 }));
  }

  expToNext() {
    const g = this.species.growth;
    if (this.level >= 100) return 0;
    return expForLevel(g, this.level + 1) - this.exp;
  }
  expProgress() {
    const g = this.species.growth;
    const cur = expForLevel(g, this.level), nxt = expForLevel(g, this.level + 1);
    return this.level >= 100 ? 1 : (this.exp - cur) / (nxt - cur);
  }

  // 获得经验 → 返回事件列表 [{type:'level',lv}, {type:'move',move}, {type:'evolve',to}]
  gainExp(amount) {
    const events = [];
    if (this.level >= 100) return events;
    this.exp += amount;
    const g = this.species.growth;
    while (this.level < 100 && this.exp >= expForLevel(g, this.level + 1)) {
      const hpBefore = this.maxHp;
      this.level++;
      this.hp = Math.min(this.maxHp, this.hp + (this.maxHp - hpBefore));
      events.push({ type: 'level', lv: this.level });
      // 新招式
      for (const lm of this.species.moves) {
        if (lm.lv === this.level && moveData(lm.m) && !this.moves.some(x => x.m === lm.m)) {
          events.push({ type: 'move', move: lm.m });
        }
      }
      // 进化(等级类)
      const evo = this.species.evo?.find(e => e.method === 'level' && this.level >= e.lv);
      if (evo) events.push({ type: 'evolve', to: evo.to });
      const evoF = this.species.evo?.find(e => e.method === 'friendship' && this.level >= (e.lv ?? 20));
      if (evoF && this.friendship >= 140) events.push({ type: 'evolve', to: evoF.to });
    }
    return events;
  }

  learnMove(name, replaceIdx = -1) {
    const md = moveData(name); if (!md) return false;
    const entry = { m: name, pp: md.pp, maxPp: md.pp };
    if (this.moves.length < 4) { this.moves.push(entry); return true; }
    if (replaceIdx >= 0 && replaceIdx < 4) { this.moves[replaceIdx] = entry; return true; }
    return false;
  }

  evolveTo(id) {
    const ratio = this.hpRatio;
    this.id = id;
    this.hp = Math.max(1, Math.round(this.maxHp * ratio));
    // 进化后自动尝试学会当前等级的新招
  }

  // 捕获率检定用
  get catchRate() { return this.species.catch; }

  heal() { this.hp = this.maxHp; this.status = null; this.moves.forEach(m => m.pp = m.maxPp); }

  serialize() {
    return {
      uid: this.uid, id: this.id, level: this.level, shiny: this.shiny, ivs: this.ivs,
      natureIdx: this.natureIdx, exp: this.exp,
      moves: this.moves.map(m => ({ ...m })), status: this.status, nickname: this.nickname,
      ballId: this.ballId, friendship: this.friendship, hp: this.hp, metAt: this.metAt,
    };
  }
  static from(d) { return new Pokemon(d.id, d.level, d); }
}
const rnd32 = () => Math.random() * 32 | 0;

// 野生生成
export function makeWild(id, level, shiny = false) {
  return new Pokemon(id, level, { shiny });
}
// 捕获经验/击倒经验: 官方Gen5式简化
export function expYield(defeated, participants = 1) {
  const b = defeated.species.baseExp, L = defeated.level;
  return Math.max(1, Math.floor(b * L / 7 / participants));
}
