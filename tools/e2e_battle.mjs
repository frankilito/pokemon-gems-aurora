// E2E: 真实驱动一场完整野生战斗（dev队伍 vs 草原野怪）
// 验证: 遭遇→战斗UI→选招→伤害→击倒/结束→回到漫游→经验结算
// 用法: node tools/e2e_battle.mjs
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://localhost:8944/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--window-size=1600,900', '--mute-audio', '--use-angle=metal'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
let fail = 0;
const check = (cond, msg) => { console.log(cond ? `E2E PASS ${msg}` : `E2E FAIL ${msg}`); if (!cond) fail++; };

try {
  await page.goto(BASE + '?shot&dev', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__game && window.__game.started', { timeout: 90000 });
  await page.waitForFunction('window.__G && __G.spawner && __G.spawner.all().length > 0', { timeout: 30000 });
  await sleep(1500);

  const info0 = await page.evaluate('__info()');
  check(info0.state === 'roam', `初始漫游状态 (${info0.state})`);
  check(info0.party?.length === 2, `dev队伍2只 (${info0.party})`);

  // 记录战前经验
  const expBefore = await page.evaluate('__G.save.party.map(p=>p.exp)');

  // 找最近的野怪开战
  const target = await page.evaluate(() => {
    const t = __G.spawner.nearest(120);
    if (!t) return null;
    const d = { zh: t.mon.species.zh, lv: t.mon.level, hp: t.mon.hp };
    window.__startWildBattle(t);
    return d;
  });
  check(!!target, `发起遭遇战 vs ${target?.zh} Lv.${target?.lv}`);
  await sleep(1200);
  check(await page.evaluate('__G.state'), '进入battle状态');
  check(await page.evaluate('!!__G.battle'), 'Battle实例存在');

  // 驱动循环：推进消息 → 战斗 → 选第一个可用招式
  let clicks = 0;
  for (let i = 0; i < 150; i++) {
    const alive = await page.evaluate('!!__G.battle');
    if (!alive) break;
    const acted = await page.evaluate(() => {
      const vis = el => el && el.offsetParent !== null;
      const mv = [...document.querySelectorAll('.bt-cmd.mv:not(.dis)')].find(vis);
      const fight = [...document.querySelectorAll('.bt-cmd')].find(b => b.dataset.a === 'fight' && vis(b));
      const anyBtn = [...document.querySelectorAll('.bt-cmd:not(.dis)')].find(vis);
      const msg = document.getElementById('btMsg');
      if (mv) { mv.click(); return 'move'; }
      if (fight) { fight.click(); return 'fight'; }
      if (vis(msg)) { msg.click(); return 'msg'; }
      if (anyBtn) { anyBtn.click(); return 'btn'; }
      return 'none';
    });
    if (acted !== 'none') clicks++;
    await sleep(450);
  }
  const ended = await page.evaluate('!__G.battle');
  check(ended, `战斗在${clicks}次交互内结束`);
  const stateAfter = await page.evaluate('__G.state');
  check(stateAfter === 'roam' || stateAfter === 'cine', `战后回到世界 (${stateAfter})`);

  const expAfter = await page.evaluate('__G.save.party.map(p=>p.exp)');
  const gained = expAfter.some((e, i) => e > expBefore[i]);
  const partyHp = await page.evaluate('__G.save.party.map(p=>[p.name,p.hp,p.maxHp].join("/"))');
  console.log('[exp]', expBefore, '→', expAfter, '| party:', partyHp);
  check(gained || partyHp.some(s => s.split('/')[1] === '0'), '获得经验(胜利)或我方濒死(失败)——战斗有真实结果');

  await page.screenshot({ path: '/tmp/gem_e2e_battle.png' });
  console.log('shot → /tmp/gem_e2e_battle.png');
  console.log(fail === 0 ? 'E2E DONE all pass' : `E2E DONE ${fail} failures`);
  process.exitCode = fail === 0 ? 0 : 1;
} finally {
  await browser.close();
}
