// E2E: 存档→刷新页面→恢复进度
// 验证: localStorage存档 / 队伍与位置与时间恢复 / 图鉴与背包恢复
// 用法: node tools/e2e_save.mjs
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://localhost:8944/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--window-size=1280,720', '--mute-audio', '--use-angle=metal'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
let fail = 0;
const check = (cond, msg) => { console.log(cond ? `E2E PASS ${msg}` : `E2E FAIL ${msg}`); if (!cond) fail++; };
const waitBoot = () => page.waitForFunction('window.__game && window.__game.started', { timeout: 90000 });

try {
  // 第一次会话: dev开局 → 改状态 → 移动 → 存档
  await page.goto(BASE + '?shot&dev', { waitUntil: 'domcontentloaded' });
  await waitBoot();
  await sleep(800);
  const before = await page.evaluate(() => {
    __G.save.money = 7777;
    __G.save.addItem('moon-stone', 2);
    __G.save.dexCaught.add(133);
    __G.player.pos.x += 25; __G.player.pos.z -= 12;
    __G.sky.setTime(21.5);
    __G.save.save();
    return {
      pos: [__G.player.pos.x, __G.player.pos.z].map(v => +v.toFixed(1)),
      party: __G.save.party.map(p => [p.id, p.level, p.exp].join(':')),
      money: __G.save.money, moon: __G.save.count('moon-stone'),
      caught: [...__G.save.dexCaught].sort((a, b) => a - b),
    };
  });
  check(before.money === 7777, '写入测试状态并存档');

  // 刷新(同浏览器профile, localStorage保留) → skiptitle 直接读档
  await page.goto(BASE + '?shot&skiptitle', { waitUntil: 'domcontentloaded' });
  await waitBoot();
  await sleep(800);
  const after = await page.evaluate(() => ({
    pos: [__G.player.pos.x, __G.player.pos.z].map(v => +v.toFixed(1)),
    party: __G.save.party.map(p => [p.id, p.level, p.exp].join(':')),
    money: __G.save.money, moon: __G.save.count('moon-stone'),
    caught: [...__G.save.dexCaught].sort((a, b) => a - b),
    time: +__G.sky.time.toFixed(1),
  }));
  check(after.money === 7777, `金钱恢复 (${after.money})`);
  check(after.moon === 2, `背包恢复 月之石×${after.moon}`);
  check(JSON.stringify(after.party) === JSON.stringify(before.party), `队伍恢复 (${after.party})`);
  check(Math.abs(after.pos[0] - before.pos[0]) < 2 && Math.abs(after.pos[1] - before.pos[1]) < 2,
    `位置恢复 ${before.pos} → ${after.pos}`);
  check(after.caught.includes(133), `图鉴恢复 (${after.caught.length}项含133)`);
  check(Math.abs(after.time - 21.5) < .5, `时间恢复 (${after.time})`);

  // 清理测试痕迹（该profile是临时的，但保持干净习惯）
  await page.evaluate('localStorage.clear()');
  console.log(fail === 0 ? 'E2E DONE all pass' : `E2E DONE ${fail} failures`);
  process.exitCode = fail === 0 ? 0 : 1;
} finally {
  await browser.close();
}
