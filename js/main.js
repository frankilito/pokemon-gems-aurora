// 入口：引导 → 标题 → 极光大陆
import * as THREE from 'three';
import { G, initEngine, addUpdate, on, emit } from './core/engine.js';
import { Input } from './core/input.js';
import { loadManifest } from './core/assets.js';
import { Sky } from './world/sky.js';
import { World, WORLD, getHeight } from './world/world.js';
import { getBiome } from './world/terrain.js';
import { Weather } from './world/weather.js';
import { Landmarks } from './world/landmarks.js';
import { Player } from './player/player.js';
import { ThirdPersonCam } from './player/camera.js';
import { MountSystem } from './player/mount.js';
import { Spawner } from './mon/spawner.js';
import { FX } from './core/fx.js';
import { GameState } from './core/state.js';
import { CaptureSystem } from './battle/capture.js';
import { Pokemon } from './mon/pokemon.js';
import { Battle } from './battle/battle.js';
import { BattleUI } from './ui/battleUI.js';
import { HUD } from './ui/hud.js';
import { Dialog } from './ui/dialog.js';
import { Menu } from './ui/menu.js';
import { Title } from './ui/title.js';
import { QuestManager } from './story/quests.js';
import { AudioSys } from './core/audio.js';
import { Net } from './net/net.js';

window.__dbg = {};
const bootText = t => { const el = document.getElementById('bootText'); if (el) el.textContent = t; };
const bootFill = p => { const el = document.getElementById('bootFill'); if (el) el.style.width = (p * 100) + '%'; };

async function boot() {
  initEngine();
  Input.init();
  window.__game = { started: false };

  bootText('读取图鉴数据…'); bootFill(.08);
  try {
    G.dex = await (await fetch('assets/data/dex.json')).json();
  } catch (e) { console.warn('[boot] dex.json 缺失', e); G.dex = null; }
  await loadManifest();

  bootText('生成极光大陆…'); bootFill(.3);
  await raf();
  G.sky = new Sky(G.scene);
  G.world = new World(G.scene);
  bootFill(.55); bootText('铺设群落与地标…');
  await raf();
  G.world.landmarks = new Landmarks(G.scene, G.world);
  G.weather = new Weather(G.scene);
  FX.init(G.scene);
  G.audio = new AudioSys();

  bootFill(.8); bootText('唤醒精灵…');
  await raf();

  // UI
  G.ui.dialog = new Dialog();
  G.ui.battle = new BattleUI();
  G.ui.menu = new Menu();
  G.ui.hud = new HUD();
  G.net = new Net();

  setupToasts();
  setupDebug();

  bootFill(1);
  document.getElementById('boot').classList.add('hide');
  window.__game.started = true;
  console.log('[game] booted');

  const q = G.debug;
  if (q.has('spectate')) { startSpectator(); return; }
  if (q.has('dev') || q.has('skiptitle')) {
    startGame(GameState.hasSave() && !q.has('dev') ? GameState.load() : null);
    if (q.has('dev')) {
      G.save.party.push(new Pokemon(7, 14), new Pokemon(25, 12));
      G.save.starterId = 7;
      G.save.quests.m_tutorial = 2;
      G.flags.mountUnlocked = true; G.flags.waterMount = true;
      G.save.addItem('poke-ball', 30); G.save.addItem('great-ball', 10);
      G.save.addItem('razz-berry', 10); G.save.addItem('potion', 8);
      G.save.dexCaught.add(7); G.save.dexCaught.add(25);
    }
    return;
  }
  const title = new Title((save, openNet) => {
    startGame(save);
    if (openNet) setTimeout(() => G.net.openLobby(), 600);
  });
  title.show();
}
const raf = () => new Promise(r => requestAnimationFrame(r));

function startGame(save) {
  G.state = 'roam';
  const q = G.debug;
  G.save = save ?? new GameState();
  if (save?._resume) G.flags = { ...save._resume.flags };

  const spawnPos = save?._resume?.pos ?? { x: parseFloat(q.get('x') ?? T0.x), z: parseFloat(q.get('z') ?? T0.z) };
  G.player = new Player(G.scene, spawnPos);
  G.cam = new ThirdPersonCam();
  if (q.has('yaw')) G.cam.yaw = parseFloat(q.get('yaw'));
  if (save?._resume?.time != null) G.sky.setTime(save._resume.time);
  else if (q.has('t')) G.sky.setTime(parseFloat(q.get('t')));

  if (G.dex) {
    G.spawner = new Spawner(G.scene);
    G.capture = new CaptureSystem(G.scene);
    G.quests = new QuestManager();
    G.mount = new MountSystem();
  }

  document.getElementById('reticle').innerHTML = `<div class="ret-dot"><div class="c"></div></div>`;

  on('wildAttack', actor => startWildBattle(actor));
  on('key', k => {
    if (k === 'KeyF' && G.state === 'roam' && G.save.anyAlive && !G.player.mount) {
      const t = G.spawner?.nearest(14);
      if (t) startWildBattle(t);
    }
  });

  // BGM 随昼夜
  let bgmT = 0;
  addUpdate(dt => {
    bgmT += dt;
    if (bgmT > 2 && G.state === 'roam') {
      bgmT = 0;
      G.audio?.bgm?.(G.sky.isNight ? 'night' : 'field');
    }
  });
  // 自动存档
  setInterval(() => { if (G.state === 'roam' && G.save.starterId) { G.save.save(); } }, 60000);
  addEventListener('beforeunload', () => { if (G.save?.starterId) G.save.save(); });
  addUpdate(() => Input.flush());

  if (!G.save.starterId) {
    setTimeout(async () => {
      emit('toast', { text: '前往北边的研究所，找青柏博士领取伙伴！(小地图⭐)' });
    }, 1200);
  }
}
const T0 = { x: 6, z: 476 };

function startWildBattle(actor) {
  if (G.state !== 'roam' || G.battle) return;
  if (!G.save.anyAlive) {
    emit('toast', { text: '你没有可以战斗的宝可梦！' });
    return;
  }
  actor.state = 'battle'; actor.speed = 0;
  G.battle = new Battle({ wildActor: actor });
  G.battle.start();
}
window.__startWildBattle = startWildBattle;

function setupToasts() {
  on('toast', ({ text }) => {
    const box = document.getElementById('toast');
    const el = document.createElement('div');
    el.className = 'toast-item'; el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; setTimeout(() => el.remove(), 400); }, 3000);
  });
}

function setupDebug() {
  window.__G = G;
  window.__info = () => ({
    state: G.state, pos: G.player ? G.player.pos.toArray().map(v => +v.toFixed(1)) : null,
    pstate: G.player?.state, biome: G.player?.biome, stamina: +(G.player?.stamina ?? 0).toFixed(2),
    time: +G.sky.time.toFixed(1), weather: G.weather.type, fps: +(G.fps ?? 0).toFixed(0),
    party: G.save?.party.map(p => `${p.species.zh}${p.level}`), badges: G.save?.badges, money: G.save?.money,
  });
  window.__spawnInfo = () => G.spawner ? G.spawner.all().map(a => ({
    id: a.mon.id, zh: a.mon.species.zh, lv: a.mon.level, shiny: a.mon.shiny,
    pos: [+a.pos.x.toFixed(0), +a.pos.z.toFixed(0)], st: a.state, loaded: a.loaded,
  })) : [];
  window.__dbg.probe = (x, z) => ({ h: getHeight(x, z), biome: getBiome(x, z) });
}

function startSpectator() {
  G.state = 'roam';
  const q = G.debug;
  const pos = new THREE.Vector3(parseFloat(q.get('x') ?? 0), parseFloat(q.get('y') ?? 40), parseFloat(q.get('z') ?? 620));
  let yaw = parseFloat(q.get('yaw') ?? 0), pitch = parseFloat(q.get('pitch') ?? -0.12);
  if (q.has('t')) G.sky.setTime(parseFloat(q.get('t')));
  addUpdate(dt => {
    const sp = Input.down('ShiftLeft') ? 120 : 40;
    const [ax, az] = Input.axis();
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(dir.z, 0, -dir.x);
    pos.addScaledVector(dir, -az * sp * dt);
    pos.addScaledVector(right, -ax * sp * dt);
    if (Input.down('KeyQ')) pos.y -= sp * dt;
    if (Input.down('KeyE')) pos.y += sp * dt;
    yaw -= Input.mouse.dx * .0022;
    pitch = Math.max(-1.4, Math.min(1.4, pitch - Input.mouse.dy * .0022));
    const ground = getHeight(pos.x, pos.z) + 1.7;
    if (pos.y < ground) pos.y = ground;
    G.camera.position.copy(pos);
    G.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    Input.flush();
  });
}

boot();
