// Dev helper: screenshot a page with WebGL in headless Chromium.
// Usage: NODE_PATH=$(npm root -g) node tools/shot.cjs <url> <out.png> [waitMs] [width] [height] [evalJs]
const { chromium } = require('playwright');
(async () => {
  const [url, out, waitMs = '4000', w = '1400', h = '850', evalJs] = process.argv.slice(2);
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(+waitMs);
  if (evalJs) {
    try { const r = await page.evaluate(evalJs); if (r !== undefined) logs.push('[eval] ' + JSON.stringify(r)); }
    catch (e) { logs.push('[eval-error] ' + e.message); }
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: out, timeout: 120000 });
  console.log(logs.slice(-60).join('\n'));
  await browser.close();
})();
