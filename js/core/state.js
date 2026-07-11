// 游戏进程状态：队伍/盒子/背包/图鉴/徽章/金钱 + 存档
import { G, emit } from './engine.js';
import { Pokemon } from '../mon/pokemon.js';

export const ITEMS = {
  'poke-ball':    { zh: '精灵球',   type: 'ball', rate: 1,   price: 200,  desc: '用于投向野生宝可梦进行捕捉的球。' },
  'great-ball':   { zh: '超级球',   type: 'ball', rate: 1.5, price: 600,  desc: '比精灵球性能更好，更容易捕捉。' },
  'ultra-ball':   { zh: '高级球',   type: 'ball', rate: 2,   price: 1200, desc: '性能极佳的高性能捕捉球。' },
  'heavy-ball':   { zh: '沉重球',   type: 'ball', rate: 1,   price: 800,  desc: '对未察觉的宝可梦效果拔群的古式球。', sneak: 1.8 },
  'potion':       { zh: '伤药',     type: 'heal', heal: 25,  price: 300,  desc: '恢复宝可梦25点HP。' },
  'super-potion': { zh: '好伤药',   type: 'heal', heal: 60,  price: 700,  desc: '恢复宝可梦60点HP。' },
  'hyper-potion': { zh: '厉害伤药', type: 'heal', heal: 120, price: 1500, desc: '恢复宝可梦120点HP。' },
  'full-heal':    { zh: '全满药',   type: 'heal', heal: 9999, cure: true, price: 2500, desc: '完全恢复HP并治愈异常状态。' },
  'revive':       { zh: '活力碎片', type: 'revive', price: 2000, desc: '让濒死的宝可梦恢复一半HP。' },
  'antidote':     { zh: '解毒药',   type: 'cure', cures: 'poison', price: 200, desc: '治愈中毒状态。' },
  'awakening':    { zh: '解眠药',   type: 'cure', cures: 'sleep', price: 200, desc: '治愈睡眠状态。' },
  'paralyze-heal':{ zh: '麻痹药',   type: 'cure', cures: 'paralysis', price: 300, desc: '治愈麻痹状态。' },
  'burn-heal':    { zh: '烧伤药',   type: 'cure', cures: 'burn', price: 300, desc: '治愈烧伤状态。' },
  'ice-heal':     { zh: '解冻药',   type: 'cure', cures: 'freeze', price: 300, desc: '治愈冰冻状态。' },
  'razz-berry':   { zh: '蔓莓果',   type: 'berry', price: 150, desc: '丢出后野生宝可梦会分心去吃，更容易捕捉。' },
  'fire-stone':   { zh: '火之石',   type: 'evo', price: 3000, desc: '让特定宝可梦进化的神奇石头，蕴含火之能量。' },
  'water-stone':  { zh: '水之石',   type: 'evo', price: 3000, desc: '让特定宝可梦进化的神奇石头，蕴含水之能量。' },
  'thunder-stone':{ zh: '雷之石',   type: 'evo', price: 3000, desc: '让特定宝可梦进化的神奇石头，蕴含雷之能量。' },
  'leaf-stone':   { zh: '叶之石',   type: 'evo', price: 3000, desc: '让特定宝可梦进化的神奇石头，蕴含草木之力。' },
  'moon-stone':   { zh: '月之石',   type: 'evo', price: 3000, desc: '月光凝成的神秘石头。' },
  'linking-cord': { zh: '连接绳',   type: 'evo', price: 5000, desc: '缠绕着神秘力量的绳子，能让通信进化的宝可梦进化。' },
  'gem-shard':    { zh: '极光碎片', type: 'key', price: 0, desc: '古代神殿的宝石碎片，隐隐散发极光。' },
};

export class GameState {
  constructor() {
    this.party = [];          // Pokemon[] ≤6
    this.box = [];            // Pokemon[]
    this.bag = { 'poke-ball': 10, 'potion': 3, 'razz-berry': 3 };
    this.money = 3000;
    this.badges = [];         // ['rock','water','fire']
    this.dexSeen = new Set();
    this.dexCaught = new Set();
    this.quests = {};         // id → {stage, done}
    this.playTime = 0;
    this.starterId = null;
    this.name = '小晶';
  }

  get lead() { return this.party.find(p => !p.fainted) || null; }
  get anyAlive() { return this.party.some(p => !p.fainted); }

  addMon(mon, silent = false) {
    this.dexCaught.add(mon.id); this.dexSeen.add(mon.id);
    if (this.party.length < 6) { this.party.push(mon); if (!silent) emit('toast', { text: `${mon.name} 加入了队伍！`, icon: mon.id }); return 'party'; }
    this.box.push(mon);
    if (!silent) emit('toast', { text: `${mon.name} 被传送到了盒子`, icon: mon.id });
    return 'box';
  }
  seen(id) { this.dexSeen.add(id); }
  addItem(id, n = 1) { this.bag[id] = (this.bag[id] || 0) + n; }
  useItem(id, n = 1) {
    if ((this.bag[id] || 0) < n) return false;
    this.bag[id] -= n;
    if (this.bag[id] <= 0) delete this.bag[id];
    return true;
  }
  count(id) { return this.bag[id] || 0; }
  healAll() { this.party.forEach(p => p.heal()); }

  save(slot = 0) {
    const data = {
      v: 2,
      party: this.party.map(p => p.serialize()),
      box: this.box.map(p => p.serialize()),
      bag: this.bag, money: this.money, badges: this.badges,
      dexSeen: [...this.dexSeen], dexCaught: [...this.dexCaught],
      quests: this.quests, playTime: this.playTime, starterId: this.starterId, name: this.name,
      flags: G.flags,
      pos: G.player ? { x: G.player.pos.x, z: G.player.pos.z } : null,
      time: G.sky?.time ?? 10,
      ts: Date.now(),
    };
    localStorage.setItem('gem_save_' + slot, JSON.stringify(data));
    return data;
  }
  static load(slot = 0) {
    const raw = localStorage.getItem('gem_save_' + slot);
    if (!raw) return null;
    try {
      const d = JSON.parse(raw);
      const gs = new GameState();
      gs.party = d.party.map(Pokemon.from);
      gs.box = (d.box || []).map(Pokemon.from);
      gs.bag = d.bag || {}; gs.money = d.money ?? 0; gs.badges = d.badges || [];
      gs.dexSeen = new Set(d.dexSeen); gs.dexCaught = new Set(d.dexCaught);
      gs.quests = d.quests || {}; gs.playTime = d.playTime || 0;
      gs.starterId = d.starterId; gs.name = d.name || '小晶';
      gs._resume = { pos: d.pos, time: d.time, flags: d.flags || {} };
      return gs;
    } catch (e) { console.warn('save corrupt', e); return null; }
  }
  static hasSave(slot = 0) { return !!localStorage.getItem('gem_save_' + slot); }
}
