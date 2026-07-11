// 18属性克制表 (Gen6+, 含妖精) attacker → defender 倍率
export const TYPE_CHART = {
  normal:   { rock: .5, ghost: 0, steel: .5 },
  fire:     { fire: .5, water: .5, grass: 2, ice: 2, bug: 2, rock: .5, dragon: .5, steel: 2 },
  water:    { fire: 2, water: .5, grass: .5, ground: 2, rock: 2, dragon: .5 },
  electric: { water: 2, electric: .5, grass: .5, ground: 0, flying: 2, dragon: .5 },
  grass:    { fire: .5, water: 2, grass: .5, poison: .5, ground: 2, flying: .5, bug: .5, rock: 2, dragon: .5, steel: .5 },
  ice:      { fire: .5, water: .5, grass: 2, ice: .5, ground: 2, flying: 2, dragon: 2, steel: .5 },
  fighting: { normal: 2, ice: 2, poison: .5, flying: .5, psychic: .5, bug: .5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: .5 },
  poison:   { grass: 2, poison: .5, ground: .5, rock: .5, ghost: .5, steel: 0, fairy: 2 },
  ground:   { fire: 2, electric: 2, grass: .5, poison: 2, flying: 0, bug: .5, rock: 2, steel: 2 },
  flying:   { electric: .5, grass: 2, fighting: 2, bug: 2, rock: .5, steel: .5 },
  psychic:  { fighting: 2, poison: 2, psychic: .5, dark: 0, steel: .5 },
  bug:      { fire: .5, grass: 2, fighting: .5, poison: .5, flying: .5, psychic: 2, ghost: .5, dark: 2, steel: .5, fairy: .5 },
  rock:     { fire: 2, ice: 2, fighting: .5, ground: .5, flying: 2, bug: 2, steel: .5 },
  ghost:    { normal: 0, psychic: 2, ghost: 2, dark: .5 },
  dragon:   { dragon: 2, steel: .5, fairy: 0 },
  dark:     { fighting: .5, psychic: 2, ghost: 2, dark: .5, fairy: .5 },
  steel:    { fire: .5, water: .5, electric: .5, ice: 2, rock: 2, steel: .5, fairy: 2 },
  fairy:    { fire: .5, fighting: 2, poison: .5, dragon: 2, dark: 2, steel: .5 },
};
export function typeMultiplier(moveType, defTypes) {
  let m = 1;
  for (const t of defTypes) m *= TYPE_CHART[moveType]?.[t] ?? 1;
  return m;
}
export const TYPE_ZH = {
  normal: '一般', fire: '火', water: '水', electric: '电', grass: '草', ice: '冰',
  fighting: '格斗', poison: '毒', ground: '地面', flying: '飞行', psychic: '超能力',
  bug: '虫', rock: '岩石', ghost: '幽灵', dragon: '龙', dark: '恶', steel: '钢', fairy: '妖精',
};
export const NATURES = [ // [名, +stat, -stat] null=平衡
  ['勤奋', null, null], ['怕寂寞', 'atk', 'def'], ['勇敢', 'atk', 'spe'], ['固执', 'atk', 'spa'], ['顽皮', 'atk', 'spd'],
  ['大胆', 'def', 'atk'], ['坦率', null, null], ['悠闲', 'def', 'spe'], ['淘气', 'def', 'spa'], ['乐天', 'def', 'spd'],
  ['胆小', 'spe', 'atk'], ['急躁', 'spe', 'def'], ['认真', null, null], ['爽朗', 'spe', 'spa'], ['天真', 'spe', 'spd'],
  ['内敛', 'spa', 'atk'], ['慢吞吞', 'spa', 'def'], ['冷静', 'spa', 'spe'], ['害羞', null, null], ['马虎', 'spa', 'spd'],
  ['沉着', 'spd', 'atk'], ['温和', 'spd', 'def'], ['自大', 'spd', 'spe'], ['慎重', 'spd', 'spa'], ['浮躁', null, null],
];
export const STAT_ZH = { hp: 'HP', atk: '攻击', def: '防御', spa: '特攻', spd: '特防', spe: '速度' };
export const AILMENT_ZH = { paralysis: '麻痹', burn: '烧伤', poison: '中毒', freeze: '冰冻', sleep: '睡眠', confusion: '混乱', none: '' };
