// The slice 5 pictures, portrait and landscape, into shots/ledger/: the whole Harju map at the start
// with all nine sites, the year-end card after the bot's second year (both charts: income by good and net worth) and a tap on a
// bar and on a dot, a town at size 1, one house on its way up, at size 3 and at size 5, and a wants
// chip right after a delivery and at the floor. It fails when a chart is cut off by the card,
// when a tap on a bar or a dot shows no tip, when the chip does not show the price step, when the
// floor is not red, or when a chip's number is rewritten more than a few times a second at rest.
// Run `make ledger` (builds first), then look at the pictures.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

const OUT = 'shots/ledger';
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
const base = `http://localhost:${port}/raide/?lang=en`;
try {
  for (const orient of ['portrait', 'landscape']) {
    const ctx = await browser.newContext({ ...devices[orient === 'portrait' ? 'iPhone 15' : 'iPhone 15 landscape'], hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${orient}: ${e}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${orient}: ${m.text()}`));
    const shot = (name, clip) => page.screenshot({ path: `${OUT}/${name}-${orient}.png`, ...(clip ? { clip } : {}) });
    const open = async (query) => {
      await page.goto(`${base}${query}`);
      await page.locator('[data-scenario="harju"]').tap();
      await page.waitForFunction(() => window.__sim, null, { timeout: 10000 });
    };
    const view = async (x, y, scale, wait = 500) => {
      await page.evaluate(([x, y, scale]) => { const r = window.__renderer; r.follow(null); r.setScale(scale); r.cam.x = x; r.cam.y = y; r.clampCam?.(); }, [x, y, scale]);
      await page.waitForTimeout(wait);
    };
    const site = (id) => page.evaluate((id) => { const o = window.__sim.sites.find((x) => x.id === id); return { x: o.cx + 0.5, y: o.cy + 0.5 }; }, id);

    // 1. the whole map at the start: nine sites
    await open('');
    const n = await page.evaluate(() => window.__sim.sites.length);
    if (n !== 9) errors.push(`${orient}: Harju has ${n} sites, not 9`);
    await page.evaluate(() => { const r = window.__renderer; r.follow(null); for (let i = 0; i < 5; i++) r.zoomStep(-1); });
    await page.waitForFunction(() => window.__renderer.zoomTo === null, null, { timeout: 10000 });
    await page.waitForTimeout(600);
    await shot('map-start');
    const badges = await page.evaluate(() => [...document.querySelectorAll('.badge')].filter((e) => e.style.display !== 'none').length);
    if (badges !== 9) errors.push(`${orient}: ${badges} badges on the whole map, not 9`);

    // 2. a town at size 1, a house on its way up, size 3 and size 5 (Tampere, the sim driven by hand)
    const tp = await site('tampere');
    await view(tp.x, tp.y - 3.6, 26);
    await shot('town-size1');
    await page.evaluate(() => { window.__sim.sites.find((x) => x.id === 'tampere').size = 2; });
    await page.waitForTimeout(1500);
    await shot('town-rising');
    await page.waitForTimeout(4000);
    await shot('town-size2');
    await page.evaluate(() => { window.__sim.sites.find((x) => x.id === 'tampere').size = 3; });
    await page.waitForTimeout(6000);
    await shot('town-size3');
    const second = await page.evaluate(() => { const r = window.__renderer; return r.towns.get('tampere').shown + '/' + r.towns.get('tampere').items.length; });
    console.log(orient, 'Tampere buildings standing at size 3 (shown/all):', second);
    await page.evaluate(() => { window.__sim.sites.find((x) => x.id === 'tampere').size = 4; });
    await page.waitForTimeout(5000);
    await shot('town-size4');
    await page.evaluate(() => { window.__sim.sites.find((x) => x.id === 'tampere').size = 5; });
    await page.waitForTimeout(9000);
    await shot('town-size5');
    console.log(orient, 'Tampere buildings standing at size 5 (shown/all):', await page.evaluate(() => { const r = window.__renderer; return r.towns.get('tampere').shown + '/' + r.towns.get('tampere').items.length; }));

    // 3. a chip right after a delivery, and at the floor
    const hp = await site('hameenlinna');
    await view(hp.x, hp.y - 3.2, 26);
    await page.evaluate(() => { const o = window.__sim.sites.find((x) => x.id === 'hameenlinna'); o.taken.boards = 1; o.taken.flour = 1; });
    await page.waitForTimeout(2500);
    const text = (sel) => page.evaluate((sel) => document.querySelector(`.site-tag[data-key="site:hameenlinna"] ${sel}`)?.textContent ?? '', sel);
    // at rest the chip's number is written a few times a second at most
    await page.evaluate(() => {
      window.__writes = 0;
      const el = document.querySelector('.site-tag[data-key="site:hameenlinna"] .chip.wants b');
      new MutationObserver((m) => { window.__writes += m.length; }).observe(el, { childList: true, characterData: true, subtree: true });
    });
    await page.waitForTimeout(2000);
    const writes = await page.evaluate(() => window.__writes);
    if (writes > 6) errors.push(`${orient}: the chip number was written ${writes} times in 2 s at rest`);
    await page.evaluate(() => { const o = window.__sim.sites.find((x) => x.id === 'hameenlinna'); o.taken.boards += 1; });
    await page.waitForTimeout(200);
    const step = await text('.chip.wants b');
    console.log(orient, 'the boards chip right after a delivery:', step);
    if (!step.includes('→')) errors.push(`${orient}: no price step on the chip after a delivery ("${step}")`);
    const tag = await page.locator('.site-tag[data-key="site:hameenlinna"]').boundingBox();
    await shot('chip-delivery', { x: Math.max(0, tag.x - 12), y: Math.max(0, tag.y - 10), width: Math.min(300, tag.width + 24), height: tag.height + 20 });
    await page.waitForTimeout(2200);
    await page.evaluate(() => { const o = window.__sim.sites.find((x) => x.id === 'hameenlinna'); o.taken.boards = 16; });
    await page.waitForTimeout(600);
    const floor = await page.evaluate(() => document.querySelectorAll('.site-tag[data-key="site:hameenlinna"] .chip.wants.floor').length);
    if (floor < 1) errors.push(`${orient}: the chip at the floor is not marked`);
    await shot('chip-floor', { x: Math.max(0, tag.x - 12), y: Math.max(0, tag.y - 10), width: Math.min(300, tag.width + 24), height: tag.height + 20 });
    // deeper than the floor so the monthly recovery does not lift it out while the view zooms
    await page.evaluate(() => { const o = window.__sim.sites.find((x) => x.id === 'hameenlinna'); o.taken.boards = 16; const r = window.__renderer; r.follow(null); for (let i = 0; i < 5; i++) r.zoomStep(-1); });
    await page.waitForFunction(() => window.__renderer.zoomTo === null, null, { timeout: 10000 });
    await page.waitForTimeout(600);
    await shot('badge-floor');
    if (!(await page.evaluate(() => document.querySelectorAll('.badge .wg.floor').length))) errors.push(`${orient}: no red wants dot on the whole map at the floor`);

    // 4. the year-end card after the bot's second year
    await open('&bot=1&speed=4&ledger=2');
    await page.waitForSelector('.card.ledger', { timeout: 90000 });
    await page.waitForTimeout(500);
    await shot('year-end');
    const geo = await page.evaluate(() => {
      const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
      return { card: r('.card.ledger'), income: r('.chart.income'), worth: r('.chart.worth'), nums: r('.ledger-nums'), pick: r('.ledger-pick'), vh: innerHeight, vw: innerWidth,
        scroll: (() => { const t = document.querySelector('.ledger-table'); return t.scrollHeight - t.clientHeight; })(), cardScroll: (() => { const c = document.querySelector('.card.ledger'); return c.scrollHeight - c.clientHeight; })() };
    });
    console.log(orient, 'ledger geometry', JSON.stringify(geo));
    for (const k of ['income', 'worth']) {
      const g = geo[k];
      if (!g || g.top < geo.card.top - 1 || g.bottom > geo.card.bottom + 1 || g.bottom > geo.vh) errors.push(`${orient}: the ${k} chart is cut off by the card`);
      if (g && (g.right > geo.vw || g.left < 0)) errors.push(`${orient}: the ${k} chart is wider than the screen`);
    }
    if (geo.cardScroll > 1) errors.push(`${orient}: the card itself scrolls by ${geo.cardScroll} px`);
    if (geo.pick.bottom > geo.card.bottom + 1) errors.push(`${orient}: the choice is cut off`);
    // a tap on a bar and on a dot
    await page.locator('.chart.income g').nth(1).tap();
    await page.waitForTimeout(200);
    if (!(await page.locator('.chart.income text', { hasText: /: \d/ }).count())) errors.push(`${orient}: no tip after a tap on a bar`);
    await shot('year-end-tip-bar');
    await page.locator('.chart.worth g').nth(1).tap();
    await page.waitForTimeout(200);
    if (!(await page.locator('.chart.worth text', { hasText: /: -?\d/ }).count())) errors.push(`${orient}: no tip after a tap on a dot`);
    await shot('year-end-tip-dot');
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`${OUT}/`);
