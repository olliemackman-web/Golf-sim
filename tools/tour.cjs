// Dev helper: load the game, run a setup script, then take several screenshots from scripted views.
// Usage: NODE_PATH=$(npm root -g) node tools/tour.cjs <url> <outPrefix> <scenario.json>
// scenario.json: { "setup": "js", "wait": ms, "shots": [{ "name": "a", "js": "js run before", "wait": ms }] }
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [url, prefix, scenFile] = process.argv.slice(2);
  const sc = JSON.parse(fs.readFileSync(scenFile, 'utf8'));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: sc.w || 1400, height: sc.h || 850 } });
  const logs = [];
  page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(sc.wait || 8000);
  if (sc.setup) {
    try { const r = await page.evaluate(sc.setup); if (r !== undefined) console.log('[setup]', JSON.stringify(r)); } catch (e) { console.log('[setup-error]', e.message); }
  }
  for (const s of sc.shots) {
    if (s.js) { try { const r = await page.evaluate(s.js); if (r !== undefined) console.log(`[${s.name}]`, JSON.stringify(r)); } catch (e) { console.log(`[${s.name}-error]`, e.message); } }
    await page.waitForTimeout(s.wait || 3000);
    await page.screenshot({ path: `${prefix}-${s.name}.png`, timeout: 120000 });
  }
  console.log(logs.slice(-40).join('\n'));
  await browser.close();
})();
