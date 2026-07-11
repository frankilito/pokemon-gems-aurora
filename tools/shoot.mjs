// 用系统 Chrome 驱动游戏：定点截图 / eval / 自动测试
// 用法:
//   node tools/shoot.mjs shot out.png [extraQuery] [waitMs]
//   node tools/shoot.mjs eval out.png "JS代码" [waitMs] [extraQuery]
//   node tools/shoot.mjs test [extraQuery]
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://localhost:8944/';
const mode = process.argv[2] || 'shot';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--window-size=1600,900', '--hide-scrollbars', '--mute-audio', '--use-angle=metal'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('console', m => {
  const t = m.text();
  if (t.startsWith('TEST') || t.startsWith('[game]') || t.toLowerCase().includes('error') || t.toLowerCase().includes('warn')) console.log('[console]', t);
});
page.on('pageerror', e => console.log('[pageerror]', e.message));

async function waitLoaded(timeout = 90000) {
  await page.waitForFunction('window.__game && window.__game.started', { timeout });
  await new Promise(r => setTimeout(r, 600));
}

try {
  if (mode === 'shot') {
    const out = process.argv[3] || '/tmp/gem.png';
    const extra = process.argv[4] ? `&${process.argv[4]}` : '';
    const wait = parseInt(process.argv[5] || '1200', 10);
    await page.goto(BASE + '?shot' + extra, { waitUntil: 'domcontentloaded' });
    await waitLoaded();
    await new Promise(r => setTimeout(r, wait));
    await page.screenshot({ path: out });
    console.log('shot →', out);
  } else if (mode === 'eval') {
    const out = process.argv[3] || '/tmp/gem.png';
    const code = process.argv[4] || '';
    const wait = parseInt(process.argv[5] || '1200', 10);
    const extra = process.argv[6] ? `&${process.argv[6]}` : '';
    await page.goto(BASE + '?shot' + extra, { waitUntil: 'domcontentloaded' });
    await waitLoaded();
    const ret = await page.evaluate(code);
    if (ret !== undefined) console.log('[eval]', JSON.stringify(ret, null, 1)?.slice(0, 3000));
    await new Promise(r => setTimeout(r, wait));
    await page.screenshot({ path: out });
    console.log('shot →', out);
  } else if (mode === 'drive') {
    // node tools/shoot.mjs drive out.png "W:2000,Space:100,W+ShiftLeft:1500" [extraQuery]
    const out = process.argv[3] || '/tmp/gem_drive.png';
    const seq = (process.argv[4] || 'W:1000').split(',');
    const extra = process.argv[5] ? `&${process.argv[5]}` : '';
    await page.goto(BASE + '?shot' + extra, { waitUntil: 'domcontentloaded' });
    await waitLoaded();
    const keymap = { W: 'KeyW', A: 'KeyA', S: 'KeyS', D: 'KeyD', Space: 'Space', ShiftLeft: 'ShiftLeft', E: 'KeyE', Q: 'KeyQ' };
    for (const step of seq) {
      const [keys, ms] = step.split(':');
      const list = keys.split('+').map(k => keymap[k] || k);
      for (const k of list) await page.keyboard.down(k);
      await new Promise(r => setTimeout(r, parseInt(ms, 10)));
      for (const k of list) await page.keyboard.up(k);
    }
    await new Promise(r => setTimeout(r, 400));
    const info = await page.evaluate('window.__info ? window.__info() : null');
    if (info) console.log('[info]', JSON.stringify(info));
    await page.screenshot({ path: out });
    console.log('shot →', out);
  } else if (mode === 'test') {
    const extra = process.argv[3] ? `&${process.argv[3]}` : '';
    await page.goto(BASE + '?autotest' + extra, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__testDone === true, { timeout: 180000 }).catch(() => console.log('[warn] test timeout'));
    await page.screenshot({ path: '/tmp/gem_test.png' });
    console.log('shot → /tmp/gem_test.png');
  }
} finally {
  await browser.close();
}
