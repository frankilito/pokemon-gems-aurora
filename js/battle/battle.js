// 战斗引擎：原地遭遇制(阿尔宙斯式) 回合状态机
import * as THREE from 'three';
import { G, emit, addUpdate, removeUpdate } from '../core/engine.js';
import { MonActor } from '../mon/monActor.js';
import { Fighter, calcDamage, EFF_TEXT, aiPick, STAGE_MULT } from './calc.js';
import { moveData, expYield, Pokemon, speciesOf } from '../mon/pokemon.js';
import { FX, buildBall } from '../core/fx.js';
import { getHeight } from '../world/world.js';
import { ITEMS } from '../core/state.js';
import { AILMENT_ZH, TYPE_ZH } from '../mon/types.js';
import { clamp, lerp, damp, TAU } from '../core/math.js';

const TYPE_COLORS = {
  normal: 0x9aa2ad, fire: 0xff8a54, water: 0x4f8fff, electric: 0xf7c531, grass: 0x5fc95a,
  ice: 0x6cd3e0, fighting: 0xd3455b, poison: 0xb45bc8, ground: 0xd8a35c, flying: 0x94a8f2,
  psychic: 0xff6c9c, bug: 0x9dc134, rock: 0xc2ab6e, ghost: 0x7562a8, dragon: 0x7a5fe8,
  dark: 0x5e5366, steel: 0x8fa3b0, fairy: 0xf0a0c8,
};

export class Battle {
  constructor(opts) {
    this.opts = opts;
    this.wildActor = opts.wildActor ?? null;
    this.trainer = opts.trainer ?? null;
    this.ui = G.ui.battle;
    this.over = false;
    this.turn = 0;
    this.runAttempts = 0;
    this.pendingEvo = [];
    this.participants = new Set();
    this.camT = Math.random() * TAU;
  }

  async start() {
    G.state = 'battle';
    G.player.freeze(true);
    G.player.aiming = false;
    document.getElementById('reticle').classList.remove('show');

    // 敌方
    if (this.trainer) {
      this.enemyTeamIdx = 0;
      this.enemyMon = this.trainer.mons[0];
      this.enemyActor = new MonActor(this.enemyMon, { behavior: 'static' });
      const p = this.stagePos(1);
      this.enemyActor.pos.set(p.x, p.y, p.z);
      G.scene.add(this.enemyActor.group);
      FX.releaseFlash(this.enemyActor.pos.clone(), this.enemyActor);
    } else {
      this.enemyMon = this.wildActor.mon;
      this.enemyActor = this.wildActor;
      this.enemyActor.state = 'battle';
      this.enemyActor.speed = 0;
    }
    G.save.seen(this.enemyMon.id);
    G.audio?.cry?.(this.enemyMon.id);
    G.audio?.bgm?.('battle');

    this.weather = G.weather.battleWeather(G.player.biome);
    this.eFighter = new Fighter(this.enemyMon);

    // 我方
    this.myMon = G.save.lead;
    this.myActor = null;
    this.mFighter = new Fighter(this.myMon);

    // 战斗相机接管
    this.camUpdater = addUpdate(dt => this.updateCam(dt));

    this.ui.show(this);
    await this.ui.msg(this.trainer
      ? `${this.trainer.name} 发起了挑战！`
      : `野生的 ${this.enemyMon.name} 出现了！${this.enemyMon.shiny ? ' ✨闪光个体!' : ''}`);
    if (this.weather === 'rain') await this.ui.msg('雨下个不停…');
    if (this.weather === 'sun') await this.ui.msg('阳光变得强烈…');
    if (this.weather === 'snow') await this.ui.msg('雪花纷纷扬扬…');

    await this.sendOut(this.myMon, true);
    this.loop();
  }

  stagePos(side) { // side: -1 我方 +1 敌方
    const P = G.player.pos;
    const anchor = this.wildActor ? this.wildActor.pos : P.clone().add(new THREE.Vector3(Math.sin(G.player.yaw) * 10, 0, Math.cos(G.player.yaw) * 10));
    const dir = new THREE.Vector3(anchor.x - P.x, 0, anchor.z - P.z).normalize();
    const mid = new THREE.Vector3().addVectors(P, anchor).multiplyScalar(.5);
    const p = mid.clone().addScaledVector(dir, side * 3.6);
    p.y = getHeight(p.x, p.z);
    return p;
  }

  async sendOut(mon, first = false) {
    // 召回旧演员
    if (this.myActor) { this.myActor.dispose(G.scene); this.myActor = null; }
    this.myMon = mon;
    this.mFighter = new Fighter(mon);
    this.participants.add(mon);
    const p = this.stagePos(-1);
    this.myActor = new MonActor(mon, { behavior: 'static' });
    this.myActor.state = 'battle';
    this.myActor.pos.copy(p);
    G.scene.add(this.myActor.group);
    // 球抛物线
    const ballStart = G.player.pos.clone().add(new THREE.Vector3(0, 1.4, 0));
    const ball = buildBall(mon.ballId || 'poke-ball', .12);
    ball.position.copy(ballStart);
    G.scene.add(ball);
    G.player.model.update(0, 'throw', { throwT: .5 });
    await tweenP(t => {
      ball.position.lerpVectors(ballStart, p.clone().add(new THREE.Vector3(0, .6, 0)), t);
      ball.position.y += Math.sin(t * Math.PI) * 1.6;
      ball.rotation.x += .3;
    }, .5);
    G.scene.remove(ball);
    FX.releaseFlash(p.clone().add(new THREE.Vector3(0, .5, 0)), this.myActor);
    G.audio?.cry?.(mon.id);
    // 面向
    this.faceEach();
    await this.ui.msg(first ? `去吧，${mon.name}！` : `就决定是你了，${mon.name}！`);
    this.ui.updateBars();
  }

  faceEach() {
    if (!this.myActor || !this.enemyActor) return;
    const a = this.myActor.pos, b = this.enemyActor.pos;
    this.myActor.yaw = Math.atan2(b.x - a.x, b.z - a.z);
    this.enemyActor.yaw = Math.atan2(a.x - b.x, a.z - b.z);
    // 玩家站位侧后方
    const back = new THREE.Vector3(a.x - (b.x - a.x) * .45, 0, a.z - (b.z - a.z) * .45);
    back.y = getHeight(back.x, back.z);
    G.player.pos.copy(back);
    G.player.yaw = this.myActor.yaw;
  }

  updateCam(dt) {
    if (this.over) return;
    const a = this.myActor?.pos ?? G.player.pos, b = this.enemyActor.pos;
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(.5);
    this.camT += dt * .06;
    const d = a.distanceTo(b);
    const side = new THREE.Vector3(b.z - a.z, 0, -(b.x - a.x)).normalize();
    const R = clamp(d * .68, 4.2, 8.5);
    const wob = Math.sin(this.camT) * 1.2;
    const target = mid.clone().addScaledVector(side, R + wob).add(new THREE.Vector3(0, 1.55 + Math.sin(this.camT * .7) * .3, 0));
    const gh = getHeight(target.x, target.z) + .5;
    if (target.y < gh) target.y = gh;
    // 攻击推近
    if (this.camPunch > 0) {
      this.camPunch -= dt;
      const focus = this.camFocus ?? mid;
      target.lerp(focus.clone().add(new THREE.Vector3(side.x * 4, 2, side.z * 4)), .35);
    }
    G.camera.position.lerp(target, 1 - Math.exp(-4 * dt));
    const look = mid.clone().add(new THREE.Vector3(0, .45 + (this.myActor?.scaleH ?? 1) * .28, 0));
    G.camera.lookAt(look);
  }

  punchCam(pos) { this.camPunch = .8; this.camFocus = pos.clone(); }

  // ---------- 主循环 ----------
  async loop() {
    while (!this.over) {
      this.turn++;
      const choice = await this.ui.mainMenu();
      if (this.over) break;
      const eMove = aiPick(this.eFighter, this.mFighter, this.weather);

      if (choice.type === 'run') { if (await this.tryRun()) break; await this.execAction(this.eFighter, this.mFighter, eMove, this.enemyActor, this.myActor); }
      else if (choice.type === 'item') { await this.useItem(choice.item, choice.target); if (this.over) break; await this.execAction(this.eFighter, this.mFighter, eMove, this.enemyActor, this.myActor); }
      else if (choice.type === 'switch') { await this.sendOut(G.save.party[choice.idx]); await this.execAction(this.eFighter, this.mFighter, eMove, this.enemyActor, this.myActor); }
      else if (choice.type === 'move') {
        const mMv = choice.move;
        const mPrio = moveData(mMv.m)?.priority ?? 0, ePrio = eMove ? (moveData(eMove.m)?.priority ?? 0) : -9;
        const mSpe = this.mFighter.eff('spe'), eSpe = this.eFighter.eff('spe');
        const meFirst = mPrio > ePrio || (mPrio === ePrio && (mSpe > eSpe || (mSpe === eSpe && Math.random() < .5)));
        const seq = meFirst
          ? [[this.mFighter, this.eFighter, mMv, this.myActor, this.enemyActor], [this.eFighter, this.mFighter, eMove, this.enemyActor, this.myActor]]
          : [[this.eFighter, this.mFighter, eMove, this.enemyActor, this.myActor], [this.mFighter, this.eFighter, mMv, this.myActor, this.enemyActor]];
        for (const [A, D, mv, aA, dA] of seq) {
          if (this.over || A.mon.fainted) continue;
          await this.execAction(A, D, mv, aA, dA);
        }
      }
      if (this.over) break;
      await this.endOfTurn();
    }
  }

  // ---------- 行动 ----------
  async execAction(atk, def, moveEntry, atkActor, defActor) {
    if (this.over || !moveEntry) return;
    const ui = this.ui;
    const mon = atk.mon;

    // 麻痹/冰冻/睡眠判定
    if (mon.status === 'paralysis' && Math.random() < .25) { await ui.msg(`${mon.name} 麻痹了，无法行动！`); return; }
    if (mon.status === 'freeze') {
      if (Math.random() < .2) { mon.status = null; await ui.msg(`${mon.name} 解冻了！`); }
      else { await ui.msg(`${mon.name} 被冻住了，动弹不得！`); return; }
    }
    if (mon.status === 'sleep') {
      atk.sleepTurns--;
      if (atk.sleepTurns <= 0) { mon.status = null; await ui.msg(`${mon.name} 醒过来了！`); }
      else { await ui.msg(`${mon.name} 正在呼呼大睡…`); return; }
    }
    if (atk.flinched) { atk.flinched = false; await ui.msg(`${mon.name} 畏缩了，无法行动！`); return; }
    // 混乱
    if (atk.confusion > 0) {
      atk.confusion--;
      if (atk.confusion <= 0) await ui.msg(`${mon.name} 的混乱解除了！`);
      else {
        await ui.msg(`${mon.name} 混乱了！`);
        if (Math.random() < .33) {
          const dmg = Math.max(1, Math.floor((((2 * mon.level / 5 + 2) * 40 * atk.eff('atk') / Math.max(1, atk.eff('def'))) / 50 + 2) * (.85 + Math.random() * .15)));
          mon.hp = Math.max(0, mon.hp - dmg);
          await ui.msg('在混乱中攻击了自己！');
          atkActor?.hitAnim();
          ui.updateBars();
          if (mon.fainted) { await this.onFaint(atk, atkActor); return; }
          return;
        }
      }
    }

    moveEntry.pp = Math.max(0, moveEntry.pp - 1);
    const mv = moveData(moveEntry.m);
    await ui.msg(`${mon.name} 使用了 ${mv.zh}！`);

    // 演出
    atkActor?.attackAnim();
    this.punchCam(defActor?.pos ?? atkActor.pos);
    G.audio?.sfx?.('attack');
    if (mv.class === 'special' && atkActor && defActor) await this.projectileFX(atkActor, defActor, mv.type);
    else if (mv.class === 'physical' && atkActor && defActor) await this.lungeFX(atkActor, defActor);
    else await wait(.35);

    const res = calcDamage(atk, def, moveEntry.m, this.weather);
    if (res.miss) {
      await ui.msg(mv.class === 'status' ? '但是失败了！' : '没有命中！');
      return;
    }

    if (mv.class !== 'status') {
      def.mon.hp = Math.max(0, def.mon.hp - res.dmg);
      defActor?.hitAnim();
      FX.hitSpark(defActor ? defActor.pos.clone().add(new THREE.Vector3(0, defActor.scaleH * .5, 0)) : atkActor.pos, res.eff);
      G.cam?.kick(.3);
      G.audio?.sfx?.(res.eff >= 2 ? 'hitSuper' : res.eff <= .5 ? 'hitWeak' : 'hit');
      ui.updateBars();
      if (res.hits > 1) await ui.msg(`打了 ${res.hits} 次！`);
      if (res.crit) await ui.msg('会心一击！');
      const et = EFF_TEXT(res.eff);
      if (et) await ui.msg(et);
      // 吸血/反伤
      if (mv.drain > 0) {
        const heal = Math.max(1, Math.floor(res.dmg * mv.drain / 100));
        atk.mon.hp = Math.min(atk.mon.maxHp, atk.mon.hp + heal);
        await ui.msg(`${mon.name} 吸取了体力！`);
        ui.updateBars();
      } else if (mv.drain < 0) {
        const rec = Math.max(1, Math.floor(res.dmg * -mv.drain / 100));
        atk.mon.hp = Math.max(0, atk.mon.hp - rec);
        await ui.msg(`${mon.name} 受到了反作用伤害！`);
        ui.updateBars();
      }
      // 畏缩
      if (mv.flinch > 0 && Math.random() * 100 < mv.flinch) def.flinched = true;
    } else {
      // 变化技: 治疗
      if (mv.healing > 0) {
        const heal = Math.max(1, Math.floor(atk.mon.maxHp * mv.healing / 100));
        atk.mon.hp = Math.min(atk.mon.maxHp, atk.mon.hp + heal);
        FX.healRing(atkActor.pos);
        await ui.msg(`${mon.name} 恢复了体力！`);
        ui.updateBars();
      }
    }

    // 异常状态
    if (mv.ailment && mv.ailment !== 'none') {
      const chance = mv.ailmentChance || (mv.class === 'status' ? 100 : 0);
      if (chance > 0 && Math.random() * 100 < chance) await this.applyAilment(def, defActor, mv.ailment);
    }
    // 能力变化
    if (mv.statChanges.length) {
      const chance = mv.statChance || (mv.class === 'status' ? 100 : 0);
      if (chance > 0 && Math.random() * 100 < chance) {
        const targetSelf = mv.target === 'user' || mv.statChanges.every(sc => sc.chg > 0 && mv.class === 'status' && mv.target === 'user');
        for (const sc of mv.statChanges) {
          const who = (mv.target === 'user') ? atk : def;
          const key = { attack: 'atk', defense: 'def', 'special-attack': 'spa', 'special-defense': 'spd', speed: 'spe', accuracy: 'acc', evasion: 'eva' }[sc.stat] ?? 'atk';
          const before = who.stages[key];
          who.stages[key] = clamp(before + sc.chg, -6, 6);
          if (who.stages[key] !== before) {
            const dir = sc.chg > 0 ? (sc.chg >= 2 ? '大幅提升了' : '提升了') : (sc.chg <= -2 ? '大幅降低了' : '降低了');
            const label = { atk: '攻击', def: '防御', spa: '特攻', spd: '特防', spe: '速度', acc: '命中率', eva: '闪避率' }[key];
            await ui.msg(`${who.mon.name} 的${label}${dir}！`);
          } else await ui.msg(`${who.mon.name} 的能力无法再变化了！`);
        }
      }
    }

    if (def.mon.fainted) await this.onFaint(def, defActor);
    else if (atk.mon.fainted) await this.onFaint(atk, atkActor);
  }

  async applyAilment(f, actor, kind) {
    const mon = f.mon;
    if (kind === 'confusion') {
      if (f.confusion > 0) return;
      f.confusion = 2 + (Math.random() * 3 | 0);
      await this.ui.msg(`${mon.name} 混乱了！`);
      return;
    }
    if (mon.status) return;   // 已有主状态
    const t = mon.types;
    if (kind === 'paralysis' && t.includes('electric')) return;
    if (kind === 'burn' && t.includes('fire')) return;
    if (kind === 'poison' && (t.includes('poison') || t.includes('steel'))) return;
    if (kind === 'freeze' && t.includes('ice')) return;
    mon.status = kind;
    if (kind === 'sleep') f.sleepTurns = 2 + (Math.random() * 3 | 0);
    await this.ui.msg(`${mon.name} ${AILMENT_ZH[kind]}了！`);
    this.ui.updateBars();
  }

  async endOfTurn() {
    for (const [f, actor] of [[this.mFighter, this.myActor], [this.eFighter, this.enemyActor]]) {
      if (this.over) return;
      const mon = f.mon;
      if (mon.fainted) continue;
      if (mon.status === 'burn') {
        mon.hp = Math.max(0, mon.hp - Math.max(1, Math.floor(mon.maxHp / 16)));
        await this.ui.msg(`${mon.name} 受到烧伤的伤害！`);
        this.ui.updateBars();
      } else if (mon.status === 'poison') {
        mon.hp = Math.max(0, mon.hp - Math.max(1, Math.floor(mon.maxHp / 8)));
        await this.ui.msg(`${mon.name} 受到毒的伤害！`);
        this.ui.updateBars();
      }
      if (mon.fainted) await this.onFaint(f, actor);
    }
  }

  // ---------- 击倒 ----------
  async onFaint(f, actor) {
    const mon = f.mon;
    actor?.faintAnim();
    G.audio?.sfx?.('faint');
    await this.ui.msg(`${mon.name} 倒下了！`);
    await wait(.7);

    if (f === this.eFighter) {
      // 经验结算
      const gain = expYield(mon, 1);
      if (this.myMon && !this.myMon.fainted) {
        await this.grantExp(this.myMon, gain);
      }
      if (this.trainer && this.enemyTeamIdx < this.trainer.mons.length - 1) {
        // 训练家换下一只
        this.enemyActor.dispose(G.scene);
        this.enemyTeamIdx++;
        this.enemyMon = this.trainer.mons[this.enemyTeamIdx];
        this.eFighter = new Fighter(this.enemyMon);
        this.enemyActor = new MonActor(this.enemyMon, { behavior: 'static' });
        const p = this.stagePos(1);
        this.enemyActor.pos.copy(p);
        G.scene.add(this.enemyActor.group);
        FX.releaseFlash(p, this.enemyActor);
        G.save.seen(this.enemyMon.id);
        await this.ui.msg(`${this.trainer.name} 派出了 ${this.enemyMon.name}！`);
        this.ui.updateBars();
        this.faceEach();
      } else {
        await this.win();
      }
    } else {
      // 我方倒下
      const alive = G.save.party.filter(p => !p.fainted);
      if (!alive.length) { await this.lose(); return; }
      const idx = await this.ui.pickReplace();
      await this.sendOut(G.save.party[idx]);
    }
  }

  async grantExp(mon, amount) {
    await this.ui.msg(`${mon.name} 获得了 ${amount} 点经验值！`);
    const events = mon.gainExp(amount);
    this.ui.updateBars();
    for (const ev of events) {
      if (ev.type === 'level') {
        G.audio?.sfx?.('levelup');
        if (this.myActor) FX.levelUp(this.myActor);
        await this.ui.msg(`${mon.name} 升到了 Lv.${ev.lv}！`);
        this.ui.updateBars();
      } else if (ev.type === 'move') {
        await this.tryLearnMove(mon, ev.move);
      } else if (ev.type === 'evolve') {
        if (!this.pendingEvo.some(e => e.mon === mon)) this.pendingEvo.push({ mon, to: ev.to });
      }
    }
  }

  async tryLearnMove(mon, moveName) {
    const md = moveData(moveName);
    if (!md) return;
    if (mon.moves.length < 4) {
      mon.learnMove(moveName);
      await this.ui.msg(`${mon.name} 学会了 ${md.zh}！`);
      return;
    }
    const idx = await this.ui.learnMovePrompt(mon, moveName);
    if (idx >= 0) {
      const old = moveData(mon.moves[idx].m)?.zh;
      mon.learnMove(moveName, idx);
      await this.ui.msg(`${mon.name} 忘记了 ${old}，学会了 ${md.zh}！`);
    } else {
      await this.ui.msg(`${mon.name} 放弃了学习 ${md.zh}。`);
    }
  }

  // ---------- 道具 ----------
  async useItem(itemId, targetIdx = null) {
    const item = ITEMS[itemId];
    if (!item) return;
    if (item.type === 'ball') {
      if (this.trainer) { await this.ui.msg('不能对训练家的宝可梦扔球！'); return; }
      G.save.useItem(itemId); emit('bagChange');
      await this.throwBallInBattle(itemId);
      return;
    }
    const target = targetIdx != null ? G.save.party[targetIdx] : this.myMon;
    if (item.type === 'heal') {
      G.save.useItem(itemId); emit('bagChange');
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + item.heal);
      if (item.cure) target.status = null;
      FX.healRing(this.myActor.pos);
      await this.ui.msg(`${target.name} 恢复了 ${target.hp - before} 点HP！`);
      this.ui.updateBars();
    } else if (item.type === 'revive') {
      G.save.useItem(itemId); emit('bagChange');
      target.hp = Math.floor(target.maxHp / 2);
      await this.ui.msg(`${target.name} 恢复了活力！`);
      this.ui.updateBars();
    } else if (item.type === 'cure') {
      G.save.useItem(itemId); emit('bagChange');
      if (target.status === item.cures) { target.status = null; await this.ui.msg(`${target.name} 的状态恢复了！`); }
      else await this.ui.msg('似乎没有效果…');
      this.ui.updateBars();
    }
  }

  async throwBallInBattle(ballKind) {
    const mon = this.enemyMon;
    const from = G.player.pos.clone().add(new THREE.Vector3(0, 1.4, 0));
    const to = this.enemyActor.pos.clone().add(new THREE.Vector3(0, .5, 0));
    const ball = buildBall(ballKind, .13);
    ball.position.copy(from);
    G.scene.add(ball);
    await tweenP(t => {
      ball.position.lerpVectors(from, to, t);
      ball.position.y += Math.sin(t * Math.PI) * 2;
      ball.rotation.x += .35;
    }, .55);
    // 吸入
    await new Promise(res => FX.captureBeam(ball.position, this.enemyActor, res));
    const rest = this.enemyActor.pos.clone().add(new THREE.Vector3(0, .16, 0));
    await tweenP(t => {
      ball.position.lerpVectors(to, rest, t);
    }, .35);

    // 公式(战斗内: 用实际HP+状态)
    const M = mon.maxHp, H = Math.max(1, mon.hp);
    const rate = mon.catchRate;
    const ballB = ITEMS[ballKind]?.rate ?? 1;
    const statusB = mon.status === 'sleep' || mon.status === 'freeze' ? 2 : mon.status ? 1.5 : 1;
    let a = ((3 * M - 2 * H) / (3 * M)) * rate * ballB * statusB;
    if (mon.species.legendary) a *= .7;
    a = clamp(a, 1, 255);
    const catchIt = a >= 255 || Math.random() < Math.pow(a / 255, .68);
    const shakes = catchIt ? 3 : (a > 150 ? 2 : a > 60 ? 1 : 0);
    for (let i = 0; i < (catchIt ? 3 : shakes); i++) {
      G.audio?.sfx?.('shake');
      await tweenP(t => { ball.rotation.z = Math.sin(t * TAU) * .5; }, .5);
      await wait(.35);
    }
    if (catchIt) {
      G.audio?.sfx?.('catch');
      FX.catchStars(ball.position);
      await this.ui.msg(`太好了！${mon.species.zh} 被抓住了！`);
      mon.ballId = ballKind;
      mon.metAt = G.player.zone || '极光大陆';
      G.save.addMon(mon);
      emit('captured', mon);
      emit('quest:capture', mon);
      G.scene.remove(ball);
      // 结束
      if (this.myMon) await this.grantExp(this.myMon, Math.floor(expYield(mon) * .5));
      await this.finish('caught');
    } else {
      FX.breakOut(ball.position);
      G.scene.remove(ball);
      FX.releaseFlash(this.enemyActor.pos.clone().add(new THREE.Vector3(0, .4, 0)), this.enemyActor);
      await this.ui.msg(`可恶！${mon.species.zh} 挣脱了！`);
    }
  }

  async tryRun() {
    if (this.trainer) { await this.ui.msg('不能从训练家对战中逃走！'); return false; }
    this.runAttempts++;
    const A = this.mFighter.eff('spe'), B = Math.max(1, this.eFighter.eff('spe'));
    const F = (A * 32 / B + 30 * this.runAttempts) % 256;
    if (Math.random() * 256 < F) {
      await this.ui.msg('成功逃走了！');
      await this.finish('ran');
      return true;
    }
    await this.ui.msg('没能逃掉！');
    return false;
  }

  async win() {
    if (this.trainer) {
      G.audio?.bgm?.('victory');
      await this.ui.msg(`战胜了 ${this.trainer.name}！`);
      if (this.trainer.money) {
        G.save.money += this.trainer.money;
        await this.ui.msg(`获得了 ${this.trainer.money} 元奖金！`);
      }
      emit('trainerDefeated', this.trainer);
    }
    await this.finish('win');
  }
  async lose() {
    await this.ui.msg('眼前一黑…');
    await this.finish('lose');
    // 回城治疗
    G.save.healAll();
    const t = G.world ? { x: 0, z: 470 } : null;
    if (t) { G.player.pos.set(t.x + 4, getHeight(t.x + 4, t.z), t.z); }
    G.save.money = Math.max(0, G.save.money - 500);
    emit('toast', { text: '你被送回了曦光镇，损失了一些金钱…' });
  }

  async finish(outcome) {
    this.over = true;
    this.outcome = outcome;
    removeUpdate(this.camUpdater);
    this.ui.hide();
    // 清理演员
    if (this.myActor) { this.myActor.dispose(G.scene); }
    if (this.trainer && this.enemyActor) this.enemyActor.dispose(G.scene);
    if (!this.trainer && this.wildActor) {
      if (outcome === 'caught') { /* capture 流程已移除 */ }
      else if (outcome === 'win') {
        G.spawner.remove(this.wildActor);
        if (this.wildActor.isLegend) G.flags['legendGone_' + this.wildActor.isLegend] = true;
      } else {
        // 逃跑/失败: 野生恢复漫游
        this.wildActor.state = 'idle';
        this.wildActor.stateT = 3;
        this.wildActor.noticed = false;
      }
    }
    G.state = 'roam';
    G.player.freeze(false);
    G.audio?.bgm?.('field');
    G.battle = null;
    emit('battleEnd', outcome);
    // 进化仪式
    for (const evo of this.pendingEvo) await runEvolution(evo.mon, evo.to);
  }
}

// ---------- 进化仪式(野外) ----------
export async function runEvolution(mon, toId) {
  G.state = 'cine';
  G.player.freeze(true);
  const front = G.player.pos.clone().add(new THREE.Vector3(Math.sin(G.player.yaw) * 3.6, 0, Math.cos(G.player.yaw) * 3.6));
  G.world.resolve(front, 1.4);
  front.y = getHeight(front.x, front.z);
  const actor = new MonActor(mon, { behavior: 'static' });
  actor.pos.copy(front);
  actor.yaw = G.player.yaw + Math.PI;
  G.scene.add(actor.group);
  // 仪式运镜
  let camT = 0;
  const camFn = dt => {
    camT += dt;
    const focus = (evoSwap ?? actor);
    const c = focus.pos.clone().add(new THREE.Vector3(0, focus.scaleH * .55, 0));
    const a = G.player.yaw + Math.PI * .85 + camT * .12;
    const d = 3.6 + Math.sin(camT * .4) * .5;
    const pos = c.clone().add(new THREE.Vector3(Math.sin(a) * d, 1 + camT * .06, Math.cos(a) * d));
    const gh = getHeight(pos.x, pos.z) + .3;
    if (pos.y < gh) pos.y = gh;
    G.camera.position.lerp(pos, 1 - Math.exp(-3 * dt));
    G.camera.lookAt(c);
  };
  G.updaters.add(camFn);
  FX.releaseFlash(front.clone().add(new THREE.Vector3(0, .5, 0)), actor);
  G.audio?.bgm?.('evolution');
  await wait(1);
  emit('toast', { text: `咦？${mon.name} 的样子…！` });
  const oldName = mon.name;
  await new Promise(res => {
    FX.evolution(actor, () => {
      // 模型切换
      mon.evolveTo(toId);
      const na = new MonActor(mon, { behavior: 'static' });
      na.pos.copy(actor.pos); na.yaw = actor.yaw;
      actor.dispose(G.scene);
      G.scene.add(na.group);
      na.inner.scale.setScalar(1);
      evoSwap = na;
    }, res);
  });
  const newActor = evoSwap; evoSwap = null;
  G.save.dexCaught.add(toId); G.save.dexSeen.add(toId);
  G.audio?.cry?.(toId);
  G.audio?.sfx?.('evolved');
  emit('toast', { text: `恭喜！${oldName} 进化成了 ${speciesOf(toId).zh}！`, icon: toId });
  emit('quest:evolve', mon);
  await wait(2.2);
  G.updaters.delete(camFn);
  newActor?.dispose(G.scene);
  G.state = 'roam';
  G.player.freeze(false);
  G.audio?.bgm?.('field');
}
let evoSwap = null;

// ---------- 演出辅助 ----------
const wait = s => new Promise(r => setTimeout(r, s * 1000));
function tweenP(fn, dur) {
  return new Promise(res => {
    FX.mgr.tween(age => {
      const t = clamp(age / dur, 0, 1);
      fn(t);
      if (t >= 1) { res(); return false; }
    });
  });
}

Battle.prototype.projectileFX = async function (from, to, type) {
  const color = TYPE_COLORS[type] ?? 0xffffff;
  const orb = new THREE.Mesh(new THREE.SphereGeometry(.16, 10, 8),
    new THREE.MeshBasicMaterial({ color }));
  const a = from.pos.clone().add(new THREE.Vector3(0, from.scaleH * .6, 0));
  const b = to.pos.clone().add(new THREE.Vector3(0, to.scaleH * .5, 0));
  orb.position.copy(a);
  G.scene.add(orb);
  const c = new THREE.Color(color);
  await tweenP(t => {
    orb.position.lerpVectors(a, b, t);
    orb.position.y += Math.sin(t * Math.PI) * 1.2;
    FX.mgr.spawn({ x: orb.position.x, y: orb.position.y, z: orb.position.z, life: .3, size: .14, r: c.r, g: c.g, b: c.b });
  }, .4);
  G.scene.remove(orb);
};
Battle.prototype.lungeFX = async function (from, to) {
  const orig = from.pos.clone();
  const dir = to.pos.clone().sub(orig); dir.y = 0;
  const d = dir.length(); dir.normalize();
  const hit = orig.clone().addScaledVector(dir, Math.max(0, d - to.scaleH * .6 - .4));
  await tweenP(t => {
    const k = Math.sin(t * Math.PI);
    from.pos.lerpVectors(orig, hit, k);
  }, .45);
  from.pos.copy(orig);
};
