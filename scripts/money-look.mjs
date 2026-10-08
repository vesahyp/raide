// The money pictures, portrait and landscape, into shots/money/: the money card with a loan, the line
// card with the line's earnings and its net, and the line card of an empty line with Lift the line.
// Run `make money-look` (builds first), then look at the pictures.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

const OUT = 'shots/money';
const freePort = () => new Promise((resolve) => { const srv = createServer(); srv.listen(0, () => { const p = srv.address().port; srv.close(() => resolve(p)); }); });
const port = await freePort();
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; ; i++) {
  if (await fetch(`http://localhost:${port}/raide/`).then((r) => r.ok, () => false)) break;
  if (i > 60) throw new Error('no preview server');
  await new Promise((r) => setTimeout(r, 500));
}
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const errors = [];
try {
  for (const orient of ['portrait', 'landscape']) {
    const ctx = await browser.newContext({ ...devices[orient === 'portrait' ? 'iPhone 15' : 'iPhone 15 landscape'], hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${orient}: ${e}`));
    await page.goto(`http://localhost:${port}/raide/?lang=en&speed=4`);
    await page.locator('[data-scenario="sawmill"]').tap();
    await page.waitForFunction(() => window.__sim);
    await page.evaluate(() => {
      const s = window.__sim; const act = window.__act;
      const cell = (id) => { const o = s.sites.find((x) => x.id === id); return o.cy * s.w + o.cx; };
      s.cash = 400;
      const line = act.build(act.plan(cell('forest'), cell('sawmill'))[0]);
      act.buyTrain(line.id, 'flat', 'hilma', 2);
    });
    await page.waitForTimeout(500);
    await page.locator('[data-act="money"]').tap();
    await page.locator('[data-act="borrow"]').tap();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/money-card-${orient}.png` });
    await page.locator('.money-card .round.close').tap();
    await page.waitForTimeout(18000);
    // the line card, opened by a touch on its track
    const p = await page.evaluate(() => { const s = window.__sim; const c = s.lines[0].path[8]; return window.__renderer.project((c % s.w) + 0.5, Math.floor(c / s.w) + 0.5, 2); });
    await page.touchscreen.tap(p.x, p.y);
    await page.locator('.buy-card').waitFor({ timeout: 4000 }).catch(() => errors.push(`${orient}: no line card`));
    await page.screenshot({ path: `${OUT}/line-card-${orient}.png` });
    if (!(await page.locator('[data-sec="line-net"]').count())) errors.push(`${orient}: the line card has no net`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`${OUT}/`);
