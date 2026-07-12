import puppeteer from 'puppeteer-core';
const states = process.argv[2] ? process.argv[2].split(',') : ['idle'];
const extra = process.argv[3] || '';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--window-size=700,760', '--mute-audio', '--use-angle=metal'],
  defaultViewport: { width: 700, height: 760 },
});
for (const st of states) {
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[pageerror]', st, e.message.slice(0,300)));
  page.on('console', m => { if (m.type()==='error'||m.type()==='warning') console.log('[c]', m.type(), m.text().slice(0,250)); });
  page.on('requestfailed', r => console.log('[reqfail]', r.url().slice(-40), r.failure()?.errorText));
  await page.goto(`http://localhost:8971/?state=${st}&${extra}`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction('window.__ready || window.__err', { timeout: 40000 });
    const err = await page.evaluate('window.__err');
    if (err) console.log('ERR', st, err.slice(0, 400));
    const stats = await page.evaluate('window.__stats');
    if (st === states[0]) console.log('STATS', JSON.stringify(stats));
    await new Promise(r => setTimeout(r, st==='idle'?2600:1400));
    await page.screenshot({ path: `/tmp/vrm_${st}.png` });
    console.log('ok', st);
  } catch (e) { console.log('TIMEOUT', st); await page.screenshot({ path: `/tmp/vrm_${st}.png` }); }
  await page.close();
}
await browser.close();
