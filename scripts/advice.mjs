// The advice check: the tip, the marker and the arc, and the goal chip and card, on Harju in
// portrait and landscape (iPhone 16), into shots/advice/. Three pictures each: the start with its
// first tip, a mill full of flour with no line out (marker, arc, tip), and the goal card. It fails
// when the tip is missing, the chip does not name its towns, a tap on the tip opens no card, the x
// does not hide the tip, or the marker is missing on the stuck mill. Run `make advice`.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

const OUT = 'shots/advice';
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
const lang = process.env.LANG_CODE || 'en';
try {
  for (const orient of ['portrait', 'landscape']) {
    const ctx = await browser.newContext({ ...devices[orient === 'portrait' ? 'iPhone 15' : 'iPhone 15 landscape'], hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${orient}: ${e}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${orient}: ${m.text()}`));
    const shot = (name) => page.screenshot({ path: `${OUT}/${name}-${orient}.png` });
    await page.goto(`http://localhost:${port}/raide/?lang=${lang}`);
    await page.locator('[data-scenario="harju"]').tap();
    await page.waitForFunction(() => window.__sim, null, { timeout: 10000 });

    // 1. the start: the first tip, the chip with its two towns, the marker over the start station
    await page.waitForSelector('.hud-tip', { timeout: 5000 }).catch(() => errors.push(`${orient}: no tip at the start`));
    await page.waitForTimeout(800);
    await shot('start');
    const chip = await page.locator('.hud-goal').innerText();
    const towns = await page.evaluate(() => window.__sim.sites.filter((x) => x.kind === 'town').map((x) => x.name.en));
    if (towns.filter((n) => chip.includes(n)).length < 2) errors.push(`${orient}: the goal chip does not name two towns (${JSON.stringify(chip)})`);
    if (!(await page.evaluate(() => { const m = document.querySelector('.advice-mark'); return !!m && m.style.display !== 'none'; }))) errors.push(`${orient}: no marker at the start`);

    // a tap on the tip pans there and opens the site's card
    await page.locator('[data-act="tip"]').tap();
    await page.waitForSelector('.site-card', { timeout: 3000 }).catch(() => errors.push(`${orient}: a tap on the tip opened no card`));
    await page.locator('.site-card .close').tap();

    // 2. a mill full of flour with no line out: the tip, the marker and the arc after the tip's 8 s hold
    await page.evaluate(() => {
      const a = window.__act;
      const s = window.__sim;
      const cell = (id) => { const o = s.sites.find((x) => x.id === id); return o.cy * s.w + o.cx; };
      a.build(a.plan(cell('forest'), cell('sawmill'))[0]);
      s.cash = 1400;
      s.sites.find((x) => x.id === 'mill').stock = 20;
    });
    await page.waitForFunction(() => document.querySelector('.hud-tip')?.dataset.tip === 'stuck', null, { timeout: 15000 }).catch(() => errors.push(`${orient}: the stuck mill did not become the tip`));
    await page.evaluate(() => {
      const r = window.__renderer;
      const s = window.__sim;
      const m = s.sites.find((x) => x.id === 'mill');
      const to = s.sites.find((x) => x.id === window.__renderer.advice?.to) ?? m;
      r.follow(null);
      r.setView((m.cx + to.cx) / 2 + 0.5, (m.cy + to.cy) / 2 + 0.5, window.innerWidth > window.innerHeight ? 11 : 9);
    });
    await page.waitForTimeout(900);
    await shot('stuck');
    if (!(await page.evaluate(() => window.__renderer.advice?.site === 'mill'))) errors.push(`${orient}: the marker is not on the mill`);

    // 3. the goal card
    await page.locator('[data-act="goal"]').tap();
    await page.waitForSelector('.goal-card', { timeout: 3000 }).catch(() => errors.push(`${orient}: the goal chip opened no card`));
    await page.waitForTimeout(300);
    await shot('goal');
    await page.locator('.goal-card .close').tap();

    // the x hides the tip for the year
    await page.locator('[data-act="tip-hide"]').tap();
    await page.waitForTimeout(300);
    if (await page.locator('.hud-tip').count()) errors.push(`${orient}: the x did not hide the tip`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) {
  console.log(errors.join('\n'));
  process.exit(1);
}
console.log('advice ok, pictures in shots/advice/');
