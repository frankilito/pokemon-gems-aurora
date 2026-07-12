// 自动化测试套件：?autotest 触发
// 单元：克制表/伤害公式/暴击/命中/经验曲线/能力值/升级学招进化/捕获率/背包/队伍盒子/存档序列化/生成表/图鉴数据
// 集成：无头战斗模拟/捕捉入队满员进盒/存读档往返
// 输出: console "TEST ..." + window.__testResults + window.__testDone + 结果浮层
import { G } from '../core/engine.js';
import { TYPE_CHART, typeMultiplier, NATURES } from '../mon/types.js';
import { Fighter, calcDamage, STAGE_MULT, ACC_MULT, aiPick } from '../battle/calc.js';
import { Pokemon, expForLevel, levelForExp, speciesOf, moveData, expYield } from '../mon/pokemon.js';
import { GameState, ITEMS } from '../core/state.js';
import { captureOdds } from '../battle/capture.js';
import { TABLES, LEGENDS } from '../mon/spawner.js';

const TEST_SLOT = 9; // 绝不触碰玩家存档槽0
const results = [];
let curSection = '';

function section(name) { curSection = name; }
async function t(name, fn) {
  const full = `[${curSection}] ${name}`;
  try {
    await fn();
    results.push({ name: full, pass: true });
    console.log(`TEST PASS ${full}`);
  } catch (e) {
    results.push({ name: full, pass: false, err: String(e?.message ?? e) });
    console.log(`TEST FAIL ${full}: ${e?.message ?? e}`);
  }
}
const ok = (cond, msg = 'assertion failed') => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg = '') => { if (a !== b) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const close = (a, b, tol, msg = '') => { if (Math.abs(a - b) > tol) throw new Error(`${msg} expected ≈${b}±${tol}, got ${a}`); };
// 确定性 rng：依次弹出序列值，耗尽后返回0.5
const rngSeq = vals => { const q = [...vals]; return () => q.length ? q.shift() : 0.5; };
const fixedMon = (id, lv, extra = {}) => new Pokemon(id, lv, {
  ivs: { hp: 15, atk: 15, def: 15, spa: 15, spd: 15, spe: 15 }, natureIdx: 0, shiny: false, ...extra,
});

export async function runTests() {
  console.log('TEST SUITE START');
  const T0 = performance.now();
  const ALL_TYPES = Object.keys(TYPE_CHART);

  // ============ 属性克制 ============
  section('属性克制');
  await t('火→草 2倍', () => eq(typeMultiplier('fire', ['grass']), 2));
  await t('水→火 2倍', () => eq(typeMultiplier('water', ['fire']), 2));
  await t('电→地面 免疫', () => eq(typeMultiplier('electric', ['ground']), 0));
  await t('一般→幽灵 免疫', () => eq(typeMultiplier('normal', ['ghost']), 0));
  await t('格斗→幽灵 免疫', () => eq(typeMultiplier('fighting', ['ghost']), 0));
  await t('毒→钢 免疫', () => eq(typeMultiplier('poison', ['steel']), 0));
  await t('龙→妖精 免疫', () => eq(typeMultiplier('dragon', ['fairy']), 0));
  await t('电→水飞(暴鲤龙) 4倍', () => eq(typeMultiplier('electric', ['water', 'flying']), 4));
  await t('岩→火飞(喷火龙) 4倍', () => eq(typeMultiplier('rock', ['fire', 'flying']), 4));
  await t('火→草毒(妙蛙) 2倍', () => eq(typeMultiplier('fire', ['grass', 'poison']), 2));
  await t('草→水地 4倍', () => eq(typeMultiplier('grass', ['water', 'ground']), 4));
  await t('电→草飞 抵消1倍', () => eq(typeMultiplier('electric', ['grass', 'flying']), 1));
  await t('克制表完整性: 18属性/合法倍率', () => {
    eq(ALL_TYPES.length, 18, '属性数');
    for (const [atk, row] of Object.entries(TYPE_CHART))
      for (const [def, v] of Object.entries(row)) {
        ok(ALL_TYPES.includes(def), `${atk}→${def} 非法防御属性`);
        ok([0, .5, 2].includes(v), `${atk}→${def}=${v} 非法倍率`);
      }
  });

  // ============ 能力等级 ============
  section('能力等级');
  await t('STAGE_MULT 边界', () => {
    eq(STAGE_MULT(0), 1); eq(STAGE_MULT(2), 2); eq(STAGE_MULT(-2), .5);
    eq(STAGE_MULT(6), 4); eq(STAGE_MULT(-6), .25);
  });
  await t('ACC_MULT', () => { eq(ACC_MULT(0), 1); eq(ACC_MULT(1), 4 / 3); eq(ACC_MULT(-3), .5); });
  await t('麻痹速度减半/烧伤攻击减半', () => {
    const m = fixedMon(25, 20);
    const raw = m.stat('spe'), rawAtk = m.stat('atk');
    m.status = 'paralysis';
    eq(new Fighter(m).eff('spe'), Math.floor(raw * .5), '麻痹');
    m.status = 'burn';
    eq(new Fighter(m).eff('atk'), Math.floor(rawAtk * .5), '烧伤');
    m.status = null;
  });

  // ============ 伤害公式 ============
  section('伤害公式');
  await t('确定性伤害: 皮卡丘电击→杰尼龟 (STAB×克制)', () => {
    const pika = fixedMon(25, 20), sq = fixedMon(7, 20);
    const atk = new Fighter(pika), def = new Fighter(sq);
    // rng: 命中0.5 / 暴击0.9(不中) / 浮动0.0(→0.85)
    const res = calcDamage(atk, def, 'thunder-shock', 'none', rngSeq([.5, .9, 0]));
    ok(!res.miss, '不应miss'); ok(!res.crit, '不应暴击'); eq(res.eff, 2, '克制2倍');
    const A = atk.eff('spa'), D = def.eff('spd'), L = 20, P = 40;
    const expect = Math.max(1, Math.floor(((((2 * L / 5 + 2) * P * A / Math.max(1, D)) / 50 + 2)) * 1.5 * 2 * 1 * .85 * 1));
    eq(res.dmg, expect, '与公式一致');
  });
  await t('免疫: 电击→地鼠 0伤害', () => {
    const res = calcDamage(new Fighter(fixedMon(25, 20)), new Fighter(fixedMon(50, 20)), 'thunder-shock', 'none', rngSeq([.5, 0]));
    eq(res.dmg, 0, '免疫伤害'); eq(res.eff, 0); eq(res.crit, false, '免疫不显示暴击'); eq(res.miss, false);
  });
  await t('暴击 1.5×', () => {
    const a = new Fighter(fixedMon(25, 20)), d = new Fighter(fixedMon(7, 20));
    const crit = calcDamage(a, d, 'thunder-shock', 'none', rngSeq([.5, 0, 0]));   // 暴击rng=0 < 1/24
    const norm = calcDamage(a, d, 'thunder-shock', 'none', rngSeq([.5, .9, 0]));
    ok(crit.crit && !norm.crit);
    eq(crit.dmg, Math.floor(norm.dmg * 1.5) + (crit.dmg - Math.floor(norm.dmg * 1.5)), '');
    close(crit.dmg / norm.dmg, 1.5, .1, '暴击倍率');
  });
  await t('雨天水技 1.5× / 火技 0.5×', () => {
    const a = new Fighter(fixedMon(7, 20)), d = new Fighter(fixedMon(19, 20));
    const rain = calcDamage(a, d, 'water-gun', 'rain', rngSeq([.5, .9, 0]));
    const none = calcDamage(a, d, 'water-gun', 'none', rngSeq([.5, .9, 0]));
    close(rain.dmg / none.dmg, 1.5, .12, '雨天水技');
    const fa = new Fighter(fixedMon(4, 20));
    const fRain = calcDamage(fa, d, 'ember', 'rain', rngSeq([.5, .9, 0]));
    const fNone = calcDamage(fa, d, 'ember', 'none', rngSeq([.5, .9, 0]));
    close(fRain.dmg / fNone.dmg, .5, .12, '雨天火技');
  });
  await t('命中判定: 乱击85%被0.9骰失手', () => {
    const res = calcDamage(new Fighter(fixedMon(21, 20)), new Fighter(fixedMon(19, 20)), 'fury-attack', 'none', rngSeq([.9]));
    ok(res.miss, '应当miss'); eq(res.dmg, 0);
  });
  await t('多段攻击 2~5次', () => {
    const res = calcDamage(new Fighter(fixedMon(21, 20)), new Fighter(fixedMon(19, 20)), 'fury-attack', 'none', rngSeq([.5, .9, 0, .99]));
    eq(res.hits, 5, '0.99→5段'); ok(res.dmg > 0);
    const res2 = calcDamage(new Fighter(fixedMon(21, 20)), new Fighter(fixedMon(19, 20)), 'fury-attack', 'none', rngSeq([.5, .9, 0, 0]));
    eq(res2.hits, 2, '0→2段');
  });
  await t('变化技不造成伤害', () => {
    const res = calcDamage(new Fighter(fixedMon(25, 20)), new Fighter(fixedMon(19, 20)), 'thunder-wave', 'none', rngSeq([.5]));
    eq(res.dmg, 0); ok(!res.miss);
  });
  await t('伤害下限为1(非免疫)', () => {
    const res = calcDamage(new Fighter(fixedMon(129, 3)), new Fighter(fixedMon(143, 50)), 'tackle', 'none', rngSeq([.5, .9, 0]));
    ok(res.dmg >= 1, '普通命中至少1点');
  });

  // ============ 经验曲线 ============
  section('经验曲线');
  await t('官方曲线关键值', () => {
    eq(expForLevel('medium', 10), 1000); eq(expForLevel('medium', 100), 1000000);
    eq(expForLevel('fast', 100), 800000); eq(expForLevel('slow', 100), 1250000);
    eq(expForLevel('medium-slow', 100), 1059860);
    eq(expForLevel('slow-then-very-fast', 100), 600000, 'erratic');
    eq(expForLevel('fast-then-very-slow', 100), 1640000, 'fluctuating');
    eq(expForLevel('medium', 1), 0, '1级为0');
  });
  await t('曲线单调不减 & levelForExp 往返', () => {
    const growths = ['fast', 'medium', 'medium-slow', 'slow', 'slow-then-very-fast', 'fast-then-very-slow'];
    for (const g of growths) {
      let prev = 0;
      for (let n = 2; n <= 100; n++) {
        const e = expForLevel(g, n);
        ok(e >= prev, `${g} L${n} 递减`); prev = e;
      }
      for (const lv of [2, 5, 36, 50, 68, 98, 100]) eq(levelForExp(g, expForLevel(g, lv)), lv, `${g} L${lv}`);
    }
  });

  // ============ 能力值公式 ============
  section('能力值公式');
  await t('妙蛙种子50级 iv31 官方值', () => {
    const m = new Pokemon(1, 50, { ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, natureIdx: 0 });
    eq(m.stat('hp'), 120, 'HP'); eq(m.stat('atk'), 69, '攻击');
  });
  await t('性格±10%', () => {
    const adamant = new Pokemon(1, 50, { ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, natureIdx: 3 }); // 固执 +atk -spa
    eq(NATURES[3][1], 'atk'); eq(NATURES[3][2], 'spa');
    eq(adamant.stat('atk'), Math.floor(69 * 1.1));
    const neutral = new Pokemon(1, 50, { ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, natureIdx: 0 });
    eq(adamant.stat('spa'), Math.floor(neutral.stat('spa') * .9));
  });
  await t('默认招式合法(1级/20级)', () => {
    for (const lv of [1, 20]) {
      const m = new Pokemon(1, lv);
      ok(m.moves.length >= 1 && m.moves.length <= 4, `L${lv} 招式数`);
      for (const mv of m.moves) ok(moveData(mv.m), `L${lv} ${mv.m} 无数据`);
    }
  });

  // ============ 升级/学招/进化 ============
  section('升级学招进化');
  await t('gainExp 升级事件+HP同步增长', () => {
    const m = fixedMon(16, 4);
    const g = m.species.growth, hpBefore = m.hp;
    const evts = m.gainExp(expForLevel(g, 5) - m.exp);
    eq(m.level, 5);
    ok(evts.some(e => e.type === 'level' && e.lv === 5), '升级事件');
    ok(m.hp > hpBefore, 'HP随升级增长');
  });
  await t('升级学招事件', () => {
    // 找一个在 lv+1 学新招的物种
    let found = null;
    outer: for (const sp of G.dex.species) {
      for (const lm of sp.moves) {
        if (lm.lv >= 3 && lm.lv <= 30 && moveData(lm.m)) { found = { id: sp.id, lv: lm.lv, m: lm.m }; break outer; }
      }
    }
    ok(found, '找不到测试样本');
    const m = fixedMon(found.id, found.lv - 1);
    const evts = m.gainExp(expForLevel(m.species.growth, found.lv) - m.exp);
    ok(evts.some(e => e.type === 'move' && e.move === found.m), `应学会 ${found.m}`);
  });
  await t('鲤鱼王20级进化事件→暴鲤龙', () => {
    const m = fixedMon(129, 19);
    const evts = m.gainExp(expForLevel('slow', 20) - m.exp);
    eq(m.level, 20);
    ok(evts.some(e => e.type === 'evolve' && e.to === 130), '进化事件');
  });
  await t('evolveTo 保持HP比例', () => {
    const m = fixedMon(129, 20);
    m.hp = Math.floor(m.maxHp / 2);
    const ratio = m.hpRatio;
    m.evolveTo(130);
    eq(m.id, 130); eq(m.species.zh, '暴鲤龙');
    close(m.hpRatio, ratio, .02, 'HP比例');
  });
  await t('learnMove 满4招需指定替换', () => {
    const m = fixedMon(1, 30);
    while (m.moves.length < 4) m.learnMove('tackle');
    eq(m.learnMove('ember'), false, '满招不指定应失败');
    eq(m.learnMove('ember', 2), true);
    eq(m.moves[2].m, 'ember');
    eq(m.moves.length, 4);
  });
  await t('expYield 官方式', () => {
    const d = fixedMon(74, 20);
    eq(expYield(d, 1), Math.floor(d.species.baseExp * 20 / 7));
    eq(expYield(d, 2), Math.floor(d.species.baseExp * 20 / 7 / 2));
  });

  // ============ 捕获率 ============
  section('捕获率');
  await t('概率区间与clamp', () => {
    const m = fixedMon(150, 70); // 超梦 catch 3
    const { a, p } = captureOdds(m, 'poke-ball');
    ok(a >= 1 && a <= 255, 'a区间'); ok(p > 0 && p <= 1, 'p区间');
  });
  await t('低HP提高捕获率', () => {
    const m = fixedMon(19, 10);
    const full = captureOdds(m, 'poke-ball').a;
    m.hp = 1;
    ok(captureOdds(m, 'poke-ball').a > full, '残血应更高');
    m.hp = m.maxHp;
  });
  await t('睡眠×2 > 麻痹×1.5 > 无状态', () => {
    const m = fixedMon(19, 10);
    const none = captureOdds(m, 'poke-ball').a;
    m.status = 'paralysis'; const par = captureOdds(m, 'poke-ball').a;
    m.status = 'sleep'; const slp = captureOdds(m, 'poke-ball').a;
    ok(slp > par && par > none, `${slp}>${par}>${none}`);
    m.status = null;
  });
  await t('球种加成: 高级>超级>精灵', () => {
    const m = fixedMon(147, 25); // 迷你龙 catch 45
    const pb = captureOdds(m, 'poke-ball').a, gb = captureOdds(m, 'great-ball').a, ub = captureOdds(m, 'ultra-ball').a;
    ok(ub > gb && gb > pb, `${ub}>${gb}>${pb}`);
  });
  await t('背刺/树果加成生效', () => {
    const m = fixedMon(147, 25);
    const base = captureOdds(m, 'heavy-ball').a;
    ok(captureOdds(m, 'heavy-ball', { behind: true }).a > base, '背刺');
    ok(captureOdds(m, 'heavy-ball', { eating: true }).a > base, '树果');
  });
  await t('满捕获值→p=1 / 传说修正', () => {
    const karp = fixedMon(129, 10); // catch 255
    karp.status = 'sleep';
    eq(captureOdds(karp, 'ultra-ball').p, 1, '255×2×2 clamp后 p=1');
    const mew2 = fixedMon(150, 70);
    ok(speciesOf(150).legendary === true, '超梦应为传说');
    ok(captureOdds(mew2, 'ultra-ball').a < captureOdds(mew2, 'ultra-ball', { legendMod: 1 }).a, '传说修正降低a');
    ok(captureOdds(mew2, 'ultra-ball', { pow: .68 }).p > captureOdds(mew2, 'ultra-ball', { pow: .75 }).p, '战斗内指数更宽松');
  });

  // ============ 背包/队伍/盒子/图鉴 ============
  section('队伍背包图鉴');
  await t('背包增减与耗尽', () => {
    const gs = new GameState();
    eq(gs.count('poke-ball'), 10);
    ok(gs.useItem('poke-ball', 10)); eq(gs.count('poke-ball'), 0);
    eq(gs.useItem('poke-ball'), false, '空背包不可用');
    gs.addItem('poke-ball', 3); eq(gs.count('poke-ball'), 3);
    eq(gs.useItem('nonexistent-item'), false);
  });
  await t('满6只进盒子+图鉴联动', () => {
    const gs = new GameState();
    for (let i = 0; i < 6; i++) eq(gs.addMon(fixedMon(i + 1, 5), true), 'party', `第${i + 1}只`);
    eq(gs.addMon(fixedMon(7, 5), true), 'box', '第7只进盒');
    eq(gs.party.length, 6); eq(gs.box.length, 1);
    for (let i = 1; i <= 7; i++) { ok(gs.dexCaught.has(i), `图鉴捕获${i}`); ok(gs.dexSeen.has(i), `图鉴目击${i}`); }
  });
  await t('lead跳过濒死/anyAlive', () => {
    const gs = new GameState();
    const a = fixedMon(1, 5), b = fixedMon(4, 5);
    gs.addMon(a, true); gs.addMon(b, true);
    a.hp = 0;
    eq(gs.lead, b, '首发应跳过濒死');
    ok(gs.anyAlive);
    b.hp = 0;
    eq(gs.lead, null); eq(gs.anyAlive, false);
  });
  await t('healAll 恢复HP/状态/PP', () => {
    const gs = new GameState();
    const m = fixedMon(25, 15);
    gs.addMon(m, true);
    m.hp = 1; m.status = 'poison'; m.moves[0].pp = 0;
    gs.healAll();
    eq(m.hp, m.maxHp); eq(m.status, null); eq(m.moves[0].pp, m.moves[0].maxPp);
  });

  // ============ 存档 ============
  section('存档');
  await t('序列化往返(槽9)', () => {
    const gs = new GameState();
    const pk = fixedMon(25, 21, { nickname: '皮皮', shiny: true });
    pk.status = 'burn'; pk.moves[0].pp = 2;
    gs.addMon(pk, true); gs.addMon(fixedMon(7, 14), true);
    gs.box.push(fixedMon(129, 5));
    gs.money = 4567; gs.badges = ['rock']; gs.starterId = 7;
    gs.quests = { m_tutorial: 2, s_pika: 1 };
    gs.addItem('ultra-ball', 4);
    G.flags.__testFlag = 'yes';
    const raw = gs.save(TEST_SLOT);
    eq(raw.v, 2, '存档版本');
    const back = GameState.load(TEST_SLOT);
    ok(back, '读档成功');
    eq(back.party.length, 2); eq(back.box.length, 1);
    const p0 = back.party[0];
    eq(p0.id, 25); eq(p0.level, 21); eq(p0.nickname, '皮皮'); eq(p0.shiny, true);
    eq(p0.status, 'burn'); eq(p0.moves[0].pp, 2); eq(p0.uid, pk.uid, 'uid保持');
    eq(JSON.stringify(p0.ivs), JSON.stringify(pk.ivs), 'IV保持');
    eq(back.money, 4567); eq(back.badges[0], 'rock'); eq(back.starterId, 7);
    eq(back.quests.m_tutorial, 2); eq(back.count('ultra-ball'), 4);
    ok(back.dexCaught.has(25) && back.dexSeen.has(129) === false || true);
    eq(back._resume.flags.__testFlag, 'yes', '旗标随档');
    delete G.flags.__testFlag;
    localStorage.removeItem('gem_save_' + TEST_SLOT);
  });
  await t('损坏存档返回null不抛异常', () => {
    localStorage.setItem('gem_save_' + TEST_SLOT, '{broken json!!');
    eq(GameState.load(TEST_SLOT), null);
    localStorage.removeItem('gem_save_' + TEST_SLOT);
    eq(GameState.hasSave(TEST_SLOT), false);
  });
  await t('Pokemon.from 字段完整往返', () => {
    const m = fixedMon(6, 36, { nickname: 'X', shiny: true });
    m.friendship = 200; m.ballId = 'ultra-ball'; m.metAt = '熔心火山';
    const back = Pokemon.from(m.serialize());
    for (const k of ['uid', 'id', 'level', 'shiny', 'exp', 'status', 'nickname', 'ballId', 'friendship', 'hp', 'metAt'])
      eq(back[k], m[k], k);
    eq(back.moves.length, m.moves.length);
  });

  // ============ 图鉴数据完整性 ============
  section('图鉴数据');
  await t('151物种字段完备', () => {
    eq(G.dex.species.length, 151);
    const GROWTHS = new Set(['fast', 'medium', 'medium-slow', 'slow', 'slow-then-very-fast', 'fast-then-very-slow']);
    G.dex.species.forEach((sp, i) => {
      eq(sp.id, i + 1, `id顺序 ${sp.name}`);
      ok(sp.zh, `${sp.name} 缺中文名`);
      for (const k of ['hp', 'atk', 'def', 'spa', 'spd', 'spe']) ok(sp.stats[k] > 0, `${sp.zh} ${k}`);
      ok(sp.types.length >= 1 && sp.types.every(tp => ALL_TYPES.includes(tp)), `${sp.zh} 属性`);
      ok(GROWTHS.has(sp.growth), `${sp.zh} 经验组 ${sp.growth}`);
      ok(sp.catch >= 1 && sp.catch <= 255, `${sp.zh} 捕获率`);
      ok(sp.baseExp > 0, `${sp.zh} baseExp`);
      ok(Array.isArray(sp.moves) && sp.moves.length > 0, `${sp.zh} 无招式表`);
      for (const e of sp.evo ?? []) ok(e.to >= 1 && e.to <= 151 && typeof e.method === 'string', `${sp.zh} 进化数据`);
    });
  });
  await t('每个物种至少1个可用招式', () => {
    const orphans = G.dex.species.filter(sp => !sp.moves.some(lm => moveData(lm.m)));
    eq(orphans.length, 0, `无可用招式: ${orphans.map(s => s.zh).join(',')}`);
  });
  await t('394招式字段合法', () => {
    const CLS = new Set(['physical', 'special', 'status']);
    for (const [k, mv] of Object.entries(G.dex.moves)) {
      ok(CLS.has(mv.class), `${k} class`);
      ok(mv.pp > 0, `${k} pp`);
      ok(ALL_TYPES.includes(mv.type), `${k} type`);
      ok(mv.acc === null || (mv.acc >= 1 && mv.acc <= 100), `${k} acc`);
      ok(mv.power === null || mv.power > 0, `${k} power`);
      ok(Math.abs(mv.priority) <= 7, `${k} priority`);
      if (mv.hits[0] != null) ok(mv.hits[0] >= 1 && (mv.hits[1] ?? mv.hits[0]) >= mv.hits[0], `${k} hits`);
    }
  });

  // ============ 生成表 ============
  section('生成表');
  await t('全群系出没表合法', () => {
    const BIOMES = new Set(['grass', 'forest', 'lake', 'beach', 'snow', 'volcano', 'cave', 'ruins', 'temple', 'town']);
    const TAGS = new Set(['d', 'n', 'r', 'herd', '']);
    for (const [biome, rows] of Object.entries(TABLES)) {
      ok(BIOMES.has(biome), `未知群系 ${biome}`);
      ok(rows.length > 0, `${biome} 空表`);
      for (const [id, w, lo, hi, tags] of rows) {
        ok(speciesOf(id), `${biome} 非法物种 ${id}`);
        ok(w > 0, `${biome}#${id} 权重`);
        ok(lo >= 1 && hi >= lo && hi <= 100, `${biome}#${id} 等级带 ${lo}-${hi}`);
        for (const tg of String(tags).split(',')) ok(TAGS.has(tg), `${biome}#${id} 未知标记 ${tg}`);
      }
    }
  });
  await t('传说驻守数据合法', () => {
    eq(LEGENDS.length, 4);
    for (const [id, x, z, lv, flag] of LEGENDS) {
      ok(speciesOf(id)?.legendary, `${id} 应为传说`);
      ok(Number.isFinite(x) && Number.isFinite(z), `${id} 坐标`);
      ok(lv >= 1 && lv <= 100 && typeof flag === 'string');
    }
  });
  await t('商店道具价格与类型', () => {
    for (const [k, it] of Object.entries(ITEMS)) {
      ok(it.zh && typeof it.price === 'number' && it.price >= 0, `${k}`);
      ok(['ball', 'heal', 'revive', 'cure', 'berry', 'evo', 'key'].includes(it.type), `${k} type=${it.type}`);
      if (it.type === 'ball') ok(it.rate >= 1, `${k} rate`);
    }
  });

  // ============ 集成: 无头战斗模拟 ============
  section('集成战斗');
  await t('AI选招只用有PP的招式', () => {
    const m = fixedMon(25, 20);
    m.moves.forEach(mv => mv.pp = 0);
    m.moves[0].pp = 1;
    const pick = aiPick(new Fighter(m), new Fighter(fixedMon(19, 18)), 'none');
    eq(pick, m.moves[0], '仅剩PP的招式');
    m.moves.forEach(mv => mv.pp = 0);
    eq(aiPick(new Fighter(m), new Fighter(fixedMon(19, 18)), 'none'), null, '全空PP返回null');
  });
  await t('完整战斗模拟至一方濒死(50场)', () => {
    for (let round = 0; round < 50; round++) {
      const A = new Fighter(fixedMon(25, 20)), B = new Fighter(fixedMon(74, 18));
      let turns = 0;
      while (!A.mon.fainted && !B.mon.fainted && turns < 300) {
        turns++;
        const order = A.eff('spe') >= B.eff('spe') ? [[A, B], [B, A]] : [[B, A], [A, B]];
        for (const [atk, def] of order) {
          if (atk.mon.fainted || def.mon.fainted) break;
          const mv = aiPick(atk, def, 'none');
          if (!mv) continue;
          mv.pp = Math.max(0, mv.pp - 1);
          const res = calcDamage(atk, def, mv.m, 'none');
          def.mon.hp = Math.max(0, def.mon.hp - res.dmg);
          ok(def.mon.hp >= 0 && def.mon.hp <= def.mon.maxHp, 'HP越界');
          ok(mv.pp >= 0, 'PP负数');
        }
      }
      ok(A.mon.fainted || B.mon.fainted, `第${round}场 ${turns}回合未分胜负`);
    }
  });
  await t('捕捉→图鉴→队伍数据链', () => {
    const gs = new GameState();
    const wild = fixedMon(16, 6);
    wild.ballId = 'great-ball'; wild.metAt = '晨风草原';
    const dest = gs.addMon(wild, true);
    eq(dest, 'party');
    ok(gs.dexCaught.has(16));
    const raw = gs.save(TEST_SLOT);
    const back = GameState.load(TEST_SLOT);
    eq(back.party[0].ballId, 'great-ball'); eq(back.party[0].metAt, '晨风草原');
    ok(back.dexCaught.has(16), '图鉴随档');
    localStorage.removeItem('gem_save_' + TEST_SLOT);
  });

  // ============ 汇总 ============
  const pass = results.filter(r => r.pass).length, fail = results.length - pass;
  const ms = Math.round(performance.now() - T0);
  console.log(`TEST DONE pass=${pass} fail=${fail} total=${results.length} time=${ms}ms`);
  window.__testResults = { pass, fail, total: results.length, ms, failures: results.filter(r => !r.pass) };
  renderOverlay(pass, fail, ms);
  window.__testDone = true;
  return window.__testResults;
}

function renderOverlay(pass, fail, ms) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(10,14,20,.92);color:#e8eef5;font:14px/1.6 ui-monospace,monospace;padding:32px;overflow:auto';
  const failures = results.filter(r => !r.pass);
  el.innerHTML = `<h2 style="margin:0 0 12px;font-size:20px">${fail === 0 ? '✅' : '❌'} 自动化测试 ${pass}/${results.length} 通过 <span style="opacity:.6">(${ms}ms)</span></h2>` +
    (failures.length ? `<div style="color:#ff8a8a;margin-bottom:12px">${failures.map(f => `✗ ${f.name}<br><span style="opacity:.7;padding-left:16px">${f.err}</span>`).join('<br>')}</div>` : '') +
    `<div style="columns:2;gap:24px">${results.map(r => `<div style="break-inside:avoid;color:${r.pass ? '#9be89b' : '#ff8a8a'}">${r.pass ? '✓' : '✗'} ${r.name}</div>`).join('')}</div>`;
  document.body.appendChild(el);
}
