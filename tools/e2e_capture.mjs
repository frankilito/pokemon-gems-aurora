// E2E: 阿尔宙斯式即时捕捉全流程
// 真实驱动: 指针锁定 → 右键瞄准(镜头对准野怪) → 左键投球 → 弹道命中 → 摇晃判定 → 入队/图鉴/存档
// 捕获率非100%(满HP波波≈44%), 最多重试8球, 全失败概率<1%
// 用法: node tools/e2e_capture.mjs
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
  await sleep(1200);

  const before = await page.evaluate(`({
    party: __G.save.party.length, box: __G.save.box.length,
    dex: __G.save.dexCaught.size, balls: __G.save.count('poke-ball'),
  })`);
  check(before.balls >= 10, `初始精灵球充足 (${before.balls})`);

  // 指针锁定(真实用户手势)
  await page.mouse.click(800, 450);
  await sleep(400);
  const locked = await page.evaluate(`document.pointerLockElement !== null`);
  check(locked, '指针锁定成功');

  // 瞄准辅助: 把镜头精确对准目标(投掷/弹道/判定全部真实)
  const aimAt = () => page.evaluate(`(() => {
    const P = __G.player;
    const BAD = new Set(['flee', 'chase', 'battle', 'captured']);
    let best = null, bd = 1e9;
    for (const a of __G.spawner.all()) {
      if (BAD.has(a.state) || a.isLegend) continue;
      const d = Math.hypot(a.pos.x - P.pos.x, a.pos.z - P.pos.z);
      if (d < bd) { bd = d; best = a; }
    }
    if (!best) return null;
    if (bd > 20) { // 传送到目标附近(测试辅助)
      const dx = P.pos.x - best.pos.x, dz = P.pos.z - best.pos.z;
      const k = 9 / Math.max(1, bd);
      P.pos.set(best.pos.x + dx * k, __dbg.probe(best.pos.x + dx * k, best.pos.z + dz * k).h, best.pos.z + dz * k);
    }
    const eye = { x: P.pos.x, y: P.pos.y + 1.45, z: P.pos.z };
    const m = { x: best.pos.x, y: best.pos.y + best.scaleH * .5, z: best.pos.z };
    const t = { x: m.x - eye.x, y: m.y - eye.y, z: m.z - eye.z };
    const L = Math.hypot(t.x, t.y, t.z); t.x /= L; t.y /= L; t.z /= L;
    __G.cam.yaw = Math.atan2(-t.x, -t.z);
    __G.cam.pitch = Math.max(-.5, Math.min(1.1, Math.asin(-t.y)));
    return { zh: best.mon.species.zh, id: best.mon.id, lv: best.mon.level, dist: +L.toFixed(1), state: best.state };
  })()`);

  let target = await aimAt();
  check(!!target, `锁定目标 ${target?.zh} Lv.${target?.lv} (${target?.dist}m, ${target?.state})`);
  await sleep(500); // 镜头收敛

  // 投球循环
  let captured = false, throws = 0;
  for (let i = 0; i < 8 && !captured; i++) {
    target = await aimAt();
    if (!target) { await sleep(800); continue; }
    await sleep(350);
    await page.mouse.down({ button: 'right' });          // 瞄准
    await sleep(250);
    const aiming = await page.evaluate('__G.player.aiming');
    if (!aiming) { await page.mouse.up({ button: 'right' }); continue; }
    await aimAt();                                        // 目标可能移动, 再校准
    await sleep(150);
    await page.mouse.down({ button: 'left' });            // 投掷
    await page.mouse.up({ button: 'left' });
    throws++;
    await page.mouse.up({ button: 'right' });
    // 等待结果: 捕获动画+摇晃约4~6秒
    for (let w = 0; w < 30; w++) {
      await sleep(300);
      const st = await page.evaluate(`({
        n: __G.save.party.length + __G.save.box.length, busy: __G.capture.busy,
      })`);
      if (st.n > before.party + before.box) { captured = true; break; }
      if (!st.busy && w > 6) break; // 挣脱/扔空, 下一球
    }
    console.log(`  第${throws}球 → ${captured ? '✅ 捕获!' : '未捕获(挣脱/未中)'}`);
  }
  check(captured, `${throws}球内捕获成功`);

  const after = await page.evaluate(`(() => {
    const all = [...__G.save.party, ...__G.save.box];
    const mon = all[all.length - 1];
    return {
      party: __G.save.party.length, box: __G.save.box.length,
      dex: __G.save.dexCaught.size, dexHas: __G.save.dexCaught.has(mon.id),
      mon: { id: mon.id, zh: mon.species.zh, lv: mon.level, ball: mon.ballId, metAt: mon.metAt },
      balls: __G.save.count('poke-ball'),
    };
  })()`);
  check(after.party + after.box === before.party + before.box + 1, `入队/入盒 (队${after.party}+盒${after.box})`);
  check(after.dexHas, `图鉴收录 #${after.mon.id} ${after.mon.zh}`);
  check(after.mon.ball === 'poke-ball' && !!after.mon.metAt, `球种与捕捉地记录 (${after.mon.ball} @ ${after.mon.metAt})`);
  check(after.balls === before.balls - throws, `球库存扣减 ${before.balls}→${after.balls} (投${throws})`);

  // 存档包含新精灵
  const saved = await page.evaluate(`(() => {
    __G.save.save();
    const d = JSON.parse(localStorage.getItem('gem_save_0'));
    return d.party.length + d.box.length;
  })()`);
  check(saved === after.party + after.box, `存档包含新精灵 (${saved}只)`);
  await page.evaluate('localStorage.clear()');

  await page.screenshot({ path: '/tmp/gem_e2e_capture.png' });
  console.log('shot → /tmp/gem_e2e_capture.png');
  console.log(fail === 0 ? 'E2E DONE all pass' : `E2E DONE ${fail} failures`);
  process.exitCode = fail === 0 ? 0 : 1;
} finally {
  await browser.close();
}
