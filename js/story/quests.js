// 任务与剧情：主线(极光宝石)/支线/道馆/商店/NPC对话
import * as THREE from 'three';
import { G, on, emit } from '../core/engine.js';
import { NPC } from './npc.js';
import { Pokemon } from '../mon/pokemon.js';
import { Battle, runEvolution } from '../battle/battle.js';
import { ITEMS } from '../core/state.js';
import { WORLD, getHeight } from '../world/world.js';
import { FX } from '../core/fx.js';
import { Input } from '../core/input.js';
import { MonActor } from '../mon/monActor.js';
import { makeWild } from '../mon/pokemon.js';

const T = WORLD.town;

export class QuestManager {
  constructor() {
    this.npcs = [];
    this.buildNPCs();
    this.bindEvents();
    on('key', k => { if (k === 'KeyE' && G.state === 'roam') this.tryInteract(); });
    let acc = 0;
    G.updaters.add(dt => {
      acc += dt;
      G.save.playTime += dt;
      for (const n of this.npcs) {
        const d = Math.hypot(n.model.root.position.x - G.player.pos.x, n.model.root.position.z - G.player.pos.z);
        if (d < 70) n.update(dt);
      }
      G.world.landmarks?.update(dt);
    });
  }

  q(id) { return G.save.quests[id] ?? 0; }
  setQ(id, v) { G.save.quests[id] = v; emit('questChange'); }

  // ---------- NPC 定义 ----------
  buildNPCs() {
    const defs = [
      {
        id: 'prof', name: '青柏博士', x: T.x + 18, z: T.z - 17, yaw: Math.PI,
        pal: { jacket: '#f2f5fa', jacketLt: '#dce4f0', hair: '#7a8494', noCap: true, noBag: true, pants: '#3a4152' },
        dialog: () => this.profDialog(),
      },
      {
        id: 'nurse', name: '护士小乔', x: T.x - 2, z: T.z + 15.5, yaw: Math.PI,
        pal: { jacket: '#ffd9e2', cap: '#fff', hair: '#e88aa0', noBag: true },
        dialog: async () => {
          await G.ui.dialog.say('护士小乔', ['欢迎来到宝可梦中心！', '我来帮你的宝可梦恢复健康吧。……好了！']);
          G.save.healAll();
          FX.healRing(G.player.pos);
          G.audio?.sfx?.('heal');
          emit('toast', { text: '队伍已完全恢复！' });
        },
      },
      {
        id: 'shop', name: '店主阿满', x: T.x - 16, z: T.z - 8.5, yaw: Math.PI,
        pal: { jacket: '#4f9fd8', hair: '#3a3f4d', noCap: true, noBag: true },
        dialog: () => this.shopDialog(),
      },
      {
        id: 'elder', name: '石叟爷爷', x: T.x + 6, z: T.z + 4, wander: true, wanderR: 8,
        pal: { jacket: '#8a927e', hair: '#d8dde2', noCap: true, noBag: true, pants: '#5a5244' },
        dialog: async () => {
          const st = this.q('s_catch5');
          const uniq = G.save.dexCaught.size;
          if (st === 0) {
            await G.ui.dialog.say('石叟爷爷', ['年轻人，极光大陆的精灵各有各的脾气哟。', '胆小的会逃，凶暴的会扑过来。蹲下慢慢靠近(慢走)，从背后丢球更容易成功。', '去吧，捕到 5 种不同的宝可梦再来见我！']);
            this.setQ('s_catch5', 1);
          } else if (st === 1 && uniq >= 5) {
            await G.ui.dialog.say('石叟爷爷', ['哦哦！已经 5 种了？有天赋！', '这些超级球给你，拿去用吧。']);
            G.save.addItem('great-ball', 5);
            emit('toast', { text: '获得 超级球 ×5' });
            this.setQ('s_catch5', 2);
          } else if (st === 1) {
            await G.ui.dialog.say('石叟爷爷', [`还差 ${5 - uniq} 种。草原的波波、小拉达最好抓咯。`]);
          } else {
            await G.ui.dialog.say('石叟爷爷', ['雨天水边容易遇到稀客，雷雨天……遗迹那边似乎有雷之翼的影子。']);
          }
        },
      },
      {
        id: 'girl', name: '露露', x: T.x - 8, z: T.z + 6, wander: true, wanderR: 10,
        pal: { jacket: '#ffe27d', hair: '#c26a3a', noCap: true, noBag: true, pants: '#e8556a' },
        dialog: async () => {
          const st = this.q('s_pika');
          const has = G.save.party.some(p => p.id === 25) || G.save.box.some(p => p.id === 25);
          if (st === 0) {
            await G.ui.dialog.say('露露', ['呜呜……我好想亲眼看看皮卡丘！', '听说草原上有电气鼠出没，哥哥你能带一只来给我看看吗？']);
            this.setQ('s_pika', 1);
          } else if (st === 1 && has) {
            await G.ui.dialog.say('露露', ['哇！！是皮卡丘！脸颊圆圆的！！', '谢谢哥哥！这块石头送给你，是爸爸捡到的！']);
            G.save.addItem('thunder-stone', 1);
            emit('toast', { text: '获得 雷之石 ×1' });
            this.setQ('s_pika', 2);
          } else if (st === 1) {
            await G.ui.dialog.say('露露', ['皮卡丘在晨风草原有时会出现……黄色的、会噼里啪啦的那个！']);
          } else {
            await G.ui.dialog.say('露露', ['皮卡丘~⚡ 噼里啪啦~']);
          }
        },
      },
      {
        id: 'fisher', name: '渔夫巨浪', x: WORLD.lake.x + 130, z: WORLD.lake.z + 90, yaw: -1.5,
        pal: { jacket: '#3a6a8a', cap: '#2b4a5f', hair: '#4a3a2a' },
        dialog: async () => {
          const st = this.q('s_karp');
          const has = G.save.party.some(p => p.id === 129) || G.save.box.some(p => p.id === 129);
          if (st === 0) {
            await G.ui.dialog.say('渔夫巨浪', ['镜湖的鲤鱼王是我此生挚爱！可我总也抓不到……', '帮我抓一只鲤鱼王，我把家传的水之石送你！']);
            this.setQ('s_karp', 1);
          } else if (st === 1 && has) {
            await G.ui.dialog.say('渔夫巨浪', ['这扑腾劲儿！正宗的鲤鱼王！', '说好的水之石，拿去！总有一天它会翻腾出龙卷风的！']);
            G.save.addItem('water-stone', 1);
            emit('toast', { text: '获得 水之石 ×1' });
            this.setQ('s_karp', 2);
          } else if (st === 1) {
            await G.ui.dialog.say('渔夫巨浪', ['鲤鱼王就在湖里扑腾，红色的，看到没！用球砸它！']);
          } else {
            await G.ui.dialog.say('渔夫巨浪', ['湖心偶尔有拉普拉斯浮上来……那可是传说中的温柔巨兽。']);
          }
        },
      },
      {
        id: 'astro', name: '星野博士', x: WORLD.ruins.x + 18, z: WORLD.ruins.z + 30,
        pal: { jacket: '#4a3a7a', jacketLt: '#8a7ad8', hair: '#2a2a3a', noCap: true },
        dialog: async () => {
          const st = this.q('s_ghost');
          const hasGhost = [...G.save.party, ...G.save.box].some(p => p.species.types.includes('ghost'));
          if (st === 0) {
            await G.ui.dialog.say('星野博士', ['这些星陨石柱在夜里会共鸣，引来幽灵系宝可梦。', '我需要研究样本——夜晚在这里捕一只幽灵系宝可梦来，我用月之石和你交换。']);
            this.setQ('s_ghost', 1);
          } else if (st === 1 && hasGhost) {
            await G.ui.dialog.say('星野博士', ['幽灵系的波动……太完美了！', '月之石归你了。对了，雷雨夜祭坛上空似乎有金色的巨鸟盘旋……']);
            G.save.addItem('moon-stone', 1);
            emit('toast', { text: '获得 月之石 ×1' });
            this.setQ('s_ghost', 2);
          } else if (st === 1) {
            await G.ui.dialog.say('星野博士', ['幽灵系夜里才会现身。鬼斯就在这遗迹附近游荡。']);
          } else {
            await G.ui.dialog.say('星野博士', ['祭坛的宝石与极光神殿同源……远古人究竟在封印什么呢。']);
          }
        },
      },
      // 道馆馆主
      {
        id: 'gym_rock', name: '馆主磐岩', x: WORLD.ruins.x - 60, z: WORLD.ruins.z + 67, yaw: Math.PI,
        pal: { jacket: '#8a7a5a', cap: '#c2ab6e', pants: '#4a4032' },
        dialog: () => this.gymDialog('rock', '磐岩', [[74, 12], [95, 14]], 1600,
          ['想要磐石徽章？让我看看你的意志是否坚硬如岩！', '记住：岩石会碎，但意志不会。'],
          ['我的岩壁……被你击穿了！', '这枚「磐石徽章」是你的了。北方雪山的宝石异变，和遗迹的祭坛脱不了关系……']),
      },
      {
        id: 'gym_water', name: '馆主澜心', x: WORLD.lake.x + 120, z: WORLD.lake.z + 67, yaw: Math.PI,
        pal: { jacket: '#4f8fff', jacketLt: '#bfe3ff', hair: '#3a6a9a', noCap: true },
        dialog: () => this.gymDialog('water', '澜心', [[54, 18], [61, 20], [130, 22]], 2600,
          ['镜湖之水，可映人心。敢在浪涛中起舞吗？', '上吧！让水流冲刷出你的真心！'],
          ['多么清澈的胜利……「碧波徽章」属于你。', '湖底最近泛起奇怪的极光……神殿的水晶似乎在苏醒。']),
      },
      {
        id: 'gym_fire', name: '馆主炎督', x: WORLD.volcano.x - 40, z: WORLD.volcano.z + 157, yaw: Math.PI,
        pal: { jacket: '#d3543c', cap: '#ff8a54', pants: '#5f2a1f' },
        dialog: () => this.gymDialog('fire', '炎督', [[58, 26], [78, 28], [126, 30]], 4200,
          ['熔心火山的烈焰即是我的斗志！', '燃起来吧——用你全部的热量！'],
          ['好烈的火焰！你赢得了「熔心徽章」！', '三枚徽章集齐之时，带上祭坛的极光碎片去雪山之巅——神殿会回应你。']),
      },
      // 路人训练家
      {
        id: 't_bug', name: '捕虫少年阿绿', x: WORLD.forest.x - 120, z: WORLD.forest.z + 130,
        pal: { jacket: '#9dc134', cap: '#f6f8ff' },
        dialog: () => this.routeTrainer('t_bug', '捕虫少年阿绿', [[10, 8], [13, 8]], 300,
          '我的虫宝可梦最强了！要比一场吗？', '呜哇，输了……给你零花钱。'),
      },
      {
        id: 't_short', name: '短裤小子健太', x: T.x + 40, z: T.z - 120,
        pal: { jacket: '#7dc4ff', pants: '#3a5f8a' },
        dialog: () => this.routeTrainer('t_short', '短裤小子健太', [[19, 10], [16, 10]], 400,
          '短裤真凉快！对战也是说来就来！', '好强！这是约定的奖金！'),
      },
      {
        id: 't_hiker', name: '登山男岩五', x: WORLD.volcano.x - 80, z: WORLD.volcano.z + 220,
        pal: { jacket: '#8a6a4a', cap: '#5f4a32' },
        dialog: () => this.routeTrainer('t_hiker', '登山男岩五', [[74, 20], [95, 22]], 900,
          '山就在那里！对战也在这里！哈哈哈！', '败了！不过山还在，明天继续爬！'),
      },
    ];
    for (const d of defs) this.npcs.push(new NPC(d));
  }

  nearestNPC(maxD = 3.2) {
    let best = null, bd = maxD;
    for (const n of this.npcs) {
      const d = Math.hypot(n.model.root.position.x - G.player.pos.x, n.model.root.position.z - G.player.pos.z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  tryInteract() {
    const npc = this.nearestNPC();
    if (npc) { npc.dialog(); return; }
    // 地标交互
    for (const poi of G.world.landmarks?.interactables ?? []) {
      const d = Math.hypot(poi.x - G.player.pos.x, poi.z - G.player.pos.z);
      if (d < poi.r + 1.2) { this.poiInteract(poi); return; }
    }
  }

  async poiInteract(poi) {
    if (poi.type === 'heal') {
      await G.ui.dialog.say('宝可梦中心', ['治疗装置启动……好了！你的宝可梦恢复了健康。']);
      G.save.healAll(); FX.healRing(G.player.pos); G.audio?.sfx?.('heal');
    } else if (poi.type === 'altar') {
      await this.altarEvent();
    } else if (poi.type === 'temple') {
      await this.templeEvent();
    } else if (poi.type === 'lab') {
      await this.profDialog();
    } else if (poi.type === 'shop') {
      await this.shopDialog();
    } else if (poi.type === 'gym') {
      // 走近道馆建筑也可指路
      emit('toast', { text: '馆主就在道馆前，走近后按 E 挑战' });
    }
  }

  // ---------- 剧情: 博士/御三家 ----------
  async profDialog() {
    const D = G.ui.dialog;
    if (!G.save.starterId) {
      await D.say('青柏博士', [
        `欢迎来到极光大陆，${G.save.name}！我是研究宝可梦生态的青柏。`,
        '最近，神殿的极光宝石发生了异变，野生宝可梦躁动不安……我需要一位有潜力的搭档帮我调查。',
        '首先——挑选你的初始伙伴吧！',
      ]);
      const idx = await D.choice('青柏博士', '选择你的伙伴：', [
        '🌱 妙蛙种子 (草/毒 · 沉稳可靠)',
        '🔥 小火龙 (火 · 热血冲锋)',
        '💧 杰尼龟 (水 · 灵活坚韧)',
      ]);
      const id = [1, 4, 7][idx];
      const starter = new Pokemon(id, 5);
      starter.metAt = '曦光镇';
      G.save.starterId = id;
      G.save.addMon(starter, true);
      G.save.addItem('poke-ball', 10);
      G.save.addItem('potion', 3);
      G.audio?.cry?.(id);
      emit('toast', { text: `${starter.species.zh} 成为了你的伙伴！`, icon: id });
      FX.catchStars(G.player.pos.clone().add(new THREE.Vector3(0, 1, 0)));
      await D.say('青柏博士', [
        `${starter.species.zh}，以后就拜托你照顾${G.save.name}啦！`,
        '这些精灵球也拿上。按住【右键】瞄准，【左键】投掷就能捕捉野生宝可梦——蹲低慢行、从背后偷袭会更容易成功！',
        '先去草原试试身手，捕捉一只宝可梦回来。',
      ]);
      this.setQ('m_tutorial', 1);
      emit('questChange');
    } else if (this.q('m_tutorial') === 1) {
      if (G.save.dexCaught.size >= 2 || G.save.party.length >= 2) {
        await D.say('青柏博士', [
          '干得漂亮！你天生就是训练家的料。',
          '接下来，去挑战大陆上的三座道馆吧。馆主们世代守护着极光宝石的传说。',
          '对了——这只「风驰铃铛」给你！摇响它就能召唤我的风速犬，骑上它驰骋大陆吧！(按 G 召唤/收回)',
        ]);
        G.flags.mountUnlocked = true;
        emit('toast', { text: '获得 风驰铃铛！按 G 召唤坐骑' });
        this.setQ('m_tutorial', 2);
      } else {
        await D.say('青柏博士', ['去草原捕一只宝可梦吧！按住右键瞄准，左键丢球。']);
      }
    } else {
      const b = G.save.badges.length;
      if (b < 3) await D.say('青柏博士', [`已经拿到 ${b} 枚徽章了吗？继续加油！道馆的位置都标在地图(M)上了。`]);
      else if (!G.save.bag['gem-shard']) await D.say('青柏博士', ['三枚徽章都齐了！快去星陨遗迹的祭坛看看——古代的封印恐怕撑不住了。']);
      else await D.say('青柏博士', ['带着极光碎片去雪山之巅的神殿……极光大陆的命运就拜托你了！']);
    }
  }

  // ---------- 商店 ----------
  async shopDialog() {
    const D = G.ui.dialog;
    const stock = [
      'poke-ball', 'great-ball', ...(G.save.badges.length >= 2 ? ['ultra-ball'] : []), 'heavy-ball',
      'potion', 'super-potion', ...(G.save.badges.length >= 2 ? ['hyper-potion'] : []),
      'razz-berry', 'antidote', 'paralyze-heal', 'awakening', 'revive',
      ...(G.save.badges.length >= 1 ? ['fire-stone', 'water-stone', 'thunder-stone', 'leaf-stone'] : []),
      ...(G.save.badges.length >= 2 ? ['moon-stone', 'linking-cord'] : []),
    ];
    while (true) {
      const opts = stock.map(id => `${ITEMS[id].zh} — ${ITEMS[id].price}元 (持有${G.save.count(id)})`);
      opts.push('💰 离开');
      const i = await D.choice('店主阿满', `欢迎光临！要买点什么？(持有 ${G.save.money} 元)`, opts);
      if (i >= stock.length || i < 0) break;
      const id = stock[i], it = ITEMS[id];
      if (G.save.money < it.price) { await D.say('店主阿满', ['哎呀，钱不够呢……']); continue; }
      G.save.money -= it.price;
      G.save.addItem(id, 1);
      G.audio?.sfx?.('buy');
      emit('toast', { text: `购入 ${it.zh} ×1` });
    }
  }

  // ---------- 道馆 ----------
  async gymDialog(key, name, team, money, introLines, winLines) {
    const D = G.ui.dialog;
    if (G.save.badges.includes(key)) {
      await D.say(`馆主${name}`, [winLines[1] ?? '期待你更强的样子！']);
      return;
    }
    if (!G.save.anyAlive) { await D.say(`馆主${name}`, ['先治好你的宝可梦再来挑战吧。']); return; }
    await D.say(`馆主${name}`, introLines);
    const c = await D.choice(`馆主${name}`, '接受道馆挑战吗？', ['⚔️ 挑战！', '再准备一下']);
    if (c !== 0) return;
    const mons = team.map(([id, lv]) => new Pokemon(id, lv));
    const battle = new Battle({ trainer: { name: `馆主${name}`, mons, money, badge: key } });
    G.battle = battle;
    const result = await new Promise(res => {
      const off = on('battleEnd', outcome => { G.events.get('battleEnd').delete(off); res(outcome); });
      battle.start();
    });
    if (result === 'win') {
      G.save.badges.push(key);
      G.audio?.sfx?.('badge');
      emit('toast', { text: `获得徽章！(${G.save.badges.length}/3)` });
      await D.say(`馆主${name}`, winLines);
      if (key === 'water') {
        G.flags.waterMount = true;
        await D.say(`馆主${name}`, ['这只「碧波铃铛」送你——骑乘时踏入深水，拉普拉斯会驮着你渡湖。']);
        emit('toast', { text: '获得 碧波铃铛！骑乘可下水了' });
      }
      emit('questChange');
    }
  }

  // ---------- 路人训练家 ----------
  async routeTrainer(id, name, team, money, intro, loseLine) {
    const D = G.ui.dialog;
    if (this.q(id) === 2) { await D.say(name, ['今天天气真好啊~']); return; }
    if (!G.save.anyAlive) { await D.say(name, ['你的宝可梦看起来没法战斗了。']); return; }
    await D.say(name, [intro]);
    const mons = team.map(([mid, lv]) => new Pokemon(mid, lv));
    const battle = new Battle({ trainer: { name, mons, money } });
    G.battle = battle;
    const result = await new Promise(res => {
      const off = on('battleEnd', outcome => { G.events.get('battleEnd').delete(off); res(outcome); });
      battle.start();
    });
    if (result === 'win') { await D.say(name, [loseLine]); this.setQ(id, 2); }
  }

  // ---------- 祭坛事件 ----------
  async altarEvent() {
    const D = G.ui.dialog;
    if (this.q('m_ruins') >= 2) { await D.say('星陨祭坛', ['祭坛安静地闪着微光。']); return; }
    if (G.save.badges.length < 1) {
      await D.say('星陨祭坛', ['石头上刻着古文字：「唯持徽章者，可触星之心。」', '(至少需要 1 枚道馆徽章)']);
      return;
    }
    await D.say('星陨祭坛', ['触碰祭坛的瞬间，紫色的光芒炸裂开来——', '一只远古的守卫苏醒了！']);
    const guard = makeWild(64, 22);   // 勇基拉守卫
    const actor = new MonActor(guard, { behavior: 'static' });
    const p = G.player.pos.clone().add(new THREE.Vector3(Math.sin(G.player.yaw) * 6, 0, Math.cos(G.player.yaw) * 6));
    p.y = getHeight(p.x, p.z);
    actor.pos.copy(p);
    G.scene.add(actor.group);
    G.spawner.actors.add(actor);
    FX.releaseFlash(p, actor);
    const battle = new Battle({ wildActor: actor });
    G.battle = battle;
    const result = await new Promise(res => {
      const off = on('battleEnd', outcome => { G.events.get('battleEnd').delete(off); res(outcome); });
      battle.start();
    });
    if (result === 'win' || result === 'caught') {
      G.save.addItem('gem-shard', 1);
      this.setQ('m_ruins', 2);
      G.audio?.sfx?.('quest');
      await D.say('星陨祭坛', ['守卫消散后，祭坛中央浮出一枚晶莹的「极光碎片」！', '(集齐 3 枚徽章后，带它前往雪山之巅的极光神殿)']);
      emit('toast', { text: '获得 极光碎片！' });
    } else {
      await D.say('星陨祭坛', ['守卫沉回石中……再试一次吧。']);
    }
  }

  // ---------- 神殿终章 ----------
  async templeEvent() {
    const D = G.ui.dialog;
    if (G.flags.ending) {
      await D.say('极光神殿', ['水晶平稳地呼吸着，极光在天幕上静静流淌。', '(后日谈：传说中的鸟儿们仍在大陆各处等待强者……)']);
      return;
    }
    if (G.save.badges.length < 3 || !G.save.bag['gem-shard']) {
      await D.say('极光神殿', ['巨大的水晶纹丝不动。', '(需要 3 枚道馆徽章与极光碎片才能唤醒神殿)']);
      return;
    }
    await D.say('极光神殿', [
      '极光碎片飞向水晶，两者共鸣出耀眼的光带——',
      '一道低沉的意识直接注入你的脑海：「又是……人类……」',
      '空间扭曲，传说的宝可梦——超梦，现身了！！',
    ]);
    const mewtwo = makeWild(150, 70, Math.random() < 1 / 20);
    const actor = new MonActor(mewtwo, { behavior: 'static' });
    const p = G.player.pos.clone().add(new THREE.Vector3(Math.sin(G.player.yaw) * 7, 0, Math.cos(G.player.yaw) * 7));
    p.y = getHeight(p.x, p.z) + .5;
    actor.pos.copy(p);
    G.scene.add(actor.group);
    G.spawner.actors.add(actor);
    FX.releaseFlash(p, actor);
    G.cam?.kick(1);
    const battle = new Battle({ wildActor: actor });
    G.battle = battle;
    const result = await new Promise(res => {
      const off = on('battleEnd', outcome => { G.events.get('battleEnd').delete(off); res(outcome); });
      battle.start();
    });
    if (result === 'caught' || result === 'win') {
      G.flags.ending = true;
      G.save.useItem('gem-shard');
      await D.say('极光神殿', [
        result === 'caught' ? '超梦安静地进入了精灵球——它选择了信任你。' : '超梦收起了敌意，化作流光没入水晶深处。',
        '极光宝石的躁动平息了。大陆的天空重新流淌起七彩的光带。',
        `${G.save.name}——极光大陆的新任守护者，诞生了！🎉`,
        '(主线完结！你可以继续收集图鉴、寻找传说三鸟、挑战闪光个体，或与好友联机交换对战。)',
      ]);
      G.audio?.bgm?.('victory');
      emit('toast', { text: '🏆 主线完结：极光守护者！' });
    } else {
      await D.say('极光神殿', ['超梦的身影消失在光波深处……它还在等待配得上的对手。']);
    }
  }

  bindEvents() {
    on('captured', () => emit('questChange'));
    on('shinySpawn', a => {
      emit('toast', { text: `✨ 附近出现了闪光的 ${a.mon.species.zh}！` });
      G.audio?.sfx?.('shiny');
    });
  }

  // ---------- 菜单任务列表 ----------
  list() {
    const b = G.save.badges.length;
    const main = [
      { name: '新的搭档', desc: '去曦光镇研究所找青柏博士，领取初始宝可梦。', done: !!G.save.starterId, active: !G.save.starterId },
      { name: '第一次捕捉', desc: '捕捉一只野生宝可梦，向博士报告。', done: this.q('m_tutorial') >= 2, active: this.q('m_tutorial') === 1 },
      { name: '三馆巡礼', desc: `击败磐岩(岩)、澜心(水)、炎督(火)三位馆主。(${b}/3)`, done: b >= 3, active: this.q('m_tutorial') >= 2 && b < 3 },
      { name: '星陨之谜', desc: '调查星陨遗迹中央的祭坛。', done: this.q('m_ruins') >= 2, active: b >= 1 && this.q('m_ruins') < 2 },
      { name: '极光神殿', desc: '集齐3枚徽章与极光碎片，登上雪山之巅唤醒神殿。', done: !!G.flags.ending, active: b >= 3 && this.q('m_ruins') >= 2 && !G.flags.ending },
    ];
    const side = [
      { name: '捕捉入门 (石叟爷爷)', desc: '捕捉5种不同的宝可梦。', done: this.q('s_catch5') >= 2, active: this.q('s_catch5') === 1 },
      { name: '想见皮卡丘 (露露)', desc: '带一只皮卡丘给露露看看。', done: this.q('s_pika') >= 2, active: this.q('s_pika') === 1 },
      { name: '挚爱鲤鱼王 (渔夫)', desc: '为渔夫巨浪捕一只鲤鱼王。', done: this.q('s_karp') >= 2, active: this.q('s_karp') === 1 },
      { name: '夜之波动 (星野博士)', desc: '夜晚捕捉一只幽灵系宝可梦。', done: this.q('s_ghost') >= 2, active: this.q('s_ghost') === 1 },
    ];
    return [...main, ...side];
  }

  activeMarker() {
    if (!G.save.starterId || this.q('m_tutorial') === 1) return { x: T.x + 18, z: T.z - 17 };
    const b = G.save.badges;
    if (this.q('m_tutorial') >= 2 && b.length < 3) {
      if (!b.includes('rock')) return { x: WORLD.ruins.x - 60, z: WORLD.ruins.z + 67 };
      if (!b.includes('water')) return { x: WORLD.lake.x + 120, z: WORLD.lake.z + 67 };
      return { x: WORLD.volcano.x - 40, z: WORLD.volcano.z + 157 };
    }
    if (this.q('m_ruins') < 2) return { x: WORLD.ruins.x, z: WORLD.ruins.z };
    if (!G.flags.ending) return { x: WORLD.temple.x, z: WORLD.temple.z };
    return null;
  }
}
