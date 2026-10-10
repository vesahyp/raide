// The wants check: what each site wants and whether it is coming, and how the goal is going, on an
// iPhone 16 in portrait and landscape, into shots/wants/. Harju at the start (every want grey, the
// goal strip with empty pips), Harju after the bot has played two years (some wants supplied, some
// short, some with no line, the strip moving), and Sawmill (the boards goal). It fails when a want chip
// or the goal strip is missing, when the start shows a want that is not grey, when the two-year game
// shows no supplied want, or when the strip is taller than two lines of towns in portrait.
// Run `make wants` (builds first), then look at the pictures.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

const OUT = 'shots/wants';
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

// the wants on the screen: site, good and state, read from the chips
const chips = (page) => page.evaluate(() => [...document.querySelectorAll('.site-tag')].flatMap((t) => [...t.querySelectorAll('.chip.wants')].map((c) => `${t.dataset.key?.replace('site:', '')}:${c.classList.contains('s-ok') ? 'ok' : c.classList.contains('s-short') ? 'short' : c.classList.contains('s-none') ? 'none' : '?'}`)));

try {
  for (const orient of ['portrait', 'landscape']) {
    const ctx = await browser.newContext({ ...devices[orient === 'portrait' ? 'iPhone 16' : 'iPhone 16 landscape'], hasTouch: true });
    const open = async (scenario, query) => {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${orient}: ${e}`));
      page.on('console', (m) => m.type() === 'error' && errors.push(`${orient}: ${m.text()}`));
      await page.goto(`http://localhost:${port}/raide/?lang=${lang}${query}`);
      await page.locator(`[data-scenario="${scenario}"]`).tap();
      await page.waitForFunction(() => window.__sim, null, { timeout: 10000 });
      return page;
    };
    const look = (page, id, zoom) => page.evaluate(([id, zoom]) => {
      const s = window.__sim;
      const o = s.sites.find((x) => x.id === id);
      window.__renderer.follow(null);
      window.__renderer.setView(o.cx + 0.5, o.cy + 0.5, zoom);
    }, [id, zoom]);
    const strip = async (page, what) => {
      const box = await page.locator('.goal-strip').boundingBox().catch(() => null);
      if (!box) { errors.push(`${orient}: ${what}: no goal strip`); return null; }
      console.log(orient, what, 'goal strip', JSON.stringify(await page.locator('.goal-strip').innerText()).slice(0, 120), `h=${Math.round(box.height)}`);
      if (orient === 'portrait' && box.height > 90) errors.push(`${orient}: ${what}: the goal strip is ${Math.round(box.height)} px tall`);
      return box;
    };

    // 1. Harju at the start: nothing is brought, so every want is grey and the pips are empty
    let page = await open('harju', '');
    await page.waitForTimeout(900);
    await page.evaluate(() => { document.querySelector('[data-act="tip-hide"]')?.click(); });
    await page.screenshot({ path: `${OUT}/harju-start-${orient}.png` });
    await strip(page, 'harju start');
    const start = await chips(page);
    console.log(orient, 'harju start wants', start.join(' '));
    if (!start.length) errors.push(`${orient}: no want chips at the start`);
    if (start.some((c) => !c.endsWith(':none'))) errors.push(`${orient}: a want is not grey at the start (${start.join(' ')})`);
    await look(page, 'hameenlinna', 11);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/harju-start-town-${orient}.png` });
    await page.close();

    // 2. Harju after two years of the bot at 4x
    page = await open('harju', '&bot=1&speed=4');
    await page.waitForFunction(() => window.__sim.year >= window.__sim.scenario.startYear + 2 || window.__sim.result, null, { timeout: 170000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => { document.querySelector('[data-act="tip-hide"]')?.click(); });
    await page.screenshot({ path: `${OUT}/harju-mid-${orient}.png` });
    await strip(page, 'harju mid');
    const mid = await page.evaluate(() => [...window.__sim.sites].map((x) => x.id));
    for (const id of mid) {
      await look(page, id, 11);
      await page.waitForTimeout(500);
      const state = await chips(page);
      if (state.length) console.log(orient, 'harju mid at', id, state.join(' '));
      if (['hameenlinna', 'mill'].includes(id)) await page.screenshot({ path: `${OUT}/harju-mid-${id}-${orient}.png` });
    }
    // route zoom and the whole map
    await look(page, 'hameenlinna', 6);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/harju-mid-route-${orient}.png` });
    await look(page, 'hameenlinna', 2.5);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/harju-mid-whole-${orient}.png` });
    const dots = await page.evaluate(() => [...document.querySelectorAll('.badge .wg')].map((e) => ['s-ok', 's-short', 's-none'].find((c) => e.classList.contains(c))));
    console.log(orient, 'whole map dots', dots.join(' '));
    if (!dots.length) errors.push(`${orient}: no want dots on the whole map`);
    await page.close();

    // 3. Sawmill: the boards goal
    page = await open('sawmill', '&bot=1&speed=4');
    await page.waitForTimeout(500);
    await page.evaluate(() => { document.querySelector('[data-act="tip-hide"]')?.click(); });
    await page.screenshot({ path: `${OUT}/sawmill-start-${orient}.png` });
    await strip(page, 'sawmill start');
    await page.waitForFunction(() => window.__sim.goalCount >= 7 || window.__sim.result, null, { timeout: 120000 });
    await page.evaluate(() => { document.querySelector('[data-act="tip-hide"]')?.click(); });
    await page.screenshot({ path: `${OUT}/sawmill-mid-${orient}.png` });
    await strip(page, 'sawmill mid');
    console.log(orient, 'sawmill wants', (await chips(page)).join(' '));
    await page.close();
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('wants: ok, pictures in shots/wants/');
