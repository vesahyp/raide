// The start screen, repeatable: portrait and landscape on an emulated iPhone, in Finnish and English,
// at two moments (the map behind has moved between them), into shots/home/. It also checks that the
// cards fit on the screen without scrolling and are at least 72 px tall, and that the backdrop's
// draw time is at most 12 ms. `make home` (builds first), then look at the pictures.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

const OUT = 'shots/home';
const MAX_FRAME_MS = 12;
const freePort = () => new Promise((resolve) => { const srv = createServer(); srv.listen(0, () => { const p = srv.address().port; srv.close(() => resolve(p)); }); });
const port = await freePort();
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; ; i++) {
  const up = await fetch(`http://localhost:${port}/raide/`).then((r) => r.ok, () => false);
  if (up) break;
  if (i > 60) throw new Error('no preview server');
  await new Promise((r) => setTimeout(r, 500));
}
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const errors = [];
try {
  for (const orient of ['portrait', 'landscape']) {
    for (const lang of ['fi', 'en']) {
      const ctx = await browser.newContext({ ...devices[orient === 'portrait' ? 'iPhone 15' : 'iPhone 15 landscape'], hasTouch: true });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${orient} ${lang}: ${e}`));
      page.on('console', (m) => m.type() === 'error' && errors.push(`${orient} ${lang}: ${m.text()}`));
      await page.goto(`http://localhost:${port}/raide/?lang=${lang}&fps=1`);
      await page.waitForSelector('[data-scenario]');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${OUT}/home-${orient}-${lang}-a.png` });
      const fit = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('[data-scenario]')].map((c) => c.getBoundingClientRect());
        return { ih: innerHeight, iw: innerWidth, sh: document.scrollingElement.scrollHeight, sw: document.scrollingElement.scrollWidth, minH: Math.min(...cards.map((r) => r.height)), minW: Math.min(...cards.map((r) => r.width)), bottom: Math.max(...cards.map((r) => r.bottom)), top: Math.min(...cards.map((r) => r.top)) };
      });
      if (fit.sh > fit.ih || fit.sw > fit.iw) errors.push(`${orient} ${lang}: the screen scrolls (${fit.sw}x${fit.sh} in ${fit.iw}x${fit.ih})`);
      if (fit.minH < 72 || fit.minW < 200) errors.push(`${orient} ${lang}: a card is ${Math.round(fit.minW)}x${Math.round(fit.minH)}`);
      if (fit.bottom > fit.ih || fit.top < 0) errors.push(`${orient} ${lang}: the cards leave the screen`);
      const fps = await page.waitForFunction(() => window.__fps, null, { timeout: 30000 }).then((h) => h.jsonValue());
      console.log(orient, lang, 'frame time', JSON.stringify(fps));
      if (fps.drawMs > MAX_FRAME_MS) errors.push(`${orient} ${lang}: mean draw time ${fps.drawMs} ms is over ${MAX_FRAME_MS} ms`);
      await page.waitForTimeout(12000);
      await page.screenshot({ path: `${OUT}/home-${orient}-${lang}-b.png` });
      // a tap on a card starts the game, and the backdrop is gone
      await page.locator('[data-scenario="harju"]').tap();
      await page.waitForFunction(() => window.__sim, null, { timeout: 10000 });
      if (await page.evaluate(() => !!window.__backdrop)) errors.push(`${orient} ${lang}: the backdrop still runs in the game`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('PASS  the start screen fits, the cards are thumb sized, the backdrop is cheap');
