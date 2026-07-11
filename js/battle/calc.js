// 战斗数值：官方伤害公式/命中/暴击/能力等级/状态异常
import { typeMultiplier } from '../mon/types.js';
import { moveData } from '../mon/pokemon.js';

export const STAGE_MULT = s => s >= 0 ? (2 + s) / 2 : 2 / (2 - s);
export const ACC_MULT = s => s >= 0 ? (3 + s) / 3 : 3 / (3 - s);

// 战斗中单侧状态包装
export class Fighter {
  constructor(mon) {
    this.mon = mon;
    this.stages = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 };
    this.confusion = 0;          // 剩余回合
    this.sleepTurns = 0;
    this.flinched = false;
    this.protectedT = false;
    this.participated = new Set();
  }
  get name() { return this.mon.name; }
  eff(stat) {
    let v = this.mon.stat(stat) * STAGE_MULT(this.stages[stat] ?? 0);
    if (stat === 'spe' && this.mon.status === 'paralysis') v *= .5;
    if (stat === 'atk' && this.mon.status === 'burn') v *= .5;
    return Math.floor(v);
  }
}

// 伤害计算 → {dmg, crit, eff, miss}
export function calcDamage(atk, def, moveName, weather = 'none', rng = Math.random) {
  const mv = moveData(moveName);
  if (!mv) return { dmg: 0, crit: false, eff: 1, miss: true };

  // 命中
  if (mv.acc != null) {
    const acc = mv.acc / 100 * ACC_MULT(atk.stages.acc) / ACC_MULT(def.stages.eva);
    if (rng() > acc) return { dmg: 0, crit: false, eff: 1, miss: true, mv };
  }
  if (mv.class === 'status') return { dmg: 0, crit: false, eff: 1, miss: false, mv };

  const L = atk.mon.level;
  const phys = mv.class === 'physical';
  const A = atk.eff(phys ? 'atk' : 'spa');
  const D = def.eff(phys ? 'def' : 'spd');
  let P = mv.power ?? 50;

  // 天气
  let wMod = 1;
  if (weather === 'rain') { if (mv.type === 'water') wMod = 1.5; if (mv.type === 'fire') wMod = .5; }
  if (weather === 'sun') { if (mv.type === 'fire') wMod = 1.5; if (mv.type === 'water') wMod = .5; }

  // 暴击
  const critChance = [1 / 24, 1 / 8, 1 / 2, 1][Math.min(3, mv.critRate)] ?? 1 / 24;
  const crit = rng() < critChance;

  const stab = atk.mon.types.includes(mv.type) ? 1.5 : 1;
  const eff = typeMultiplier(mv.type, def.mon.types);
  const rand = .85 + rng() * .15;

  let dmg = (((2 * L / 5 + 2) * P * A / Math.max(1, D)) / 50 + 2);
  dmg *= stab * eff * (crit ? 1.5 : 1) * rand * wMod;
  // 多段
  let hits = 1;
  if (mv.hits[0] != null) {
    const min = mv.hits[0], max = mv.hits[1] ?? min;
    hits = min + Math.floor(rng() * (max - min + 1));
    dmg *= hits;
  }
  return { dmg: Math.max(1, Math.floor(dmg)), crit, eff, miss: false, mv, hits };
}

export const EFF_TEXT = eff =>
  eff === 0 ? '似乎没有效果…' : eff >= 2 ? '效果拔群！' : eff <= .5 ? '收效甚微…' : '';

// AI 选招
export function aiPick(atk, def, weather) {
  const usable = atk.mon.moves.filter(m => m.pp > 0);
  if (!usable.length) return null;
  let best = usable[0], bestScore = -1;
  for (const m of usable) {
    const mv = moveData(m.m);
    if (!mv) continue;
    let score = 0;
    if (mv.class === 'status') {
      const hasAil = !!def.mon.status;
      score = (mv.ailment !== 'none' && !hasAil) ? 42 : 18;
      if (mv.statChanges.length) score = 34;
      if (atk.mon.hpRatio > .85 && mv.healing > 0) score = 5;
      if (mv.healing > 0 && atk.mon.hpRatio < .4) score = 70;
    } else {
      const phys = mv.class === 'physical';
      const A = atk.eff(phys ? 'atk' : 'spa'), D = def.eff(phys ? 'def' : 'spd');
      const stab = atk.mon.types.includes(mv.type) ? 1.5 : 1;
      const eff = typeMultiplier(mv.type, def.mon.types);
      score = (mv.power ?? 50) * A / Math.max(1, D) * stab * eff * ((mv.acc ?? 100) / 100);
    }
    score *= .85 + Math.random() * .3;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}
