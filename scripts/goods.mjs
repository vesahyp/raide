// The goods check: what each site makes and wants, read from the map, on Harju in portrait and
// landscape, into shots/goods/. Piles at close zoom early and after 25 s of the bot playing, the
// piles of each site empty, half and full, the route zoom and the whole map with every label, the
// Koskensaha card opened by a touch on its label, and pick mode after "Lay track from here".
// It fails when two site tags overlap at route zoom, when an empty yard draws the same piles as a
// full one, or when a card or the pick banner is missing. Run `make goods` (builds first), then
// look at the pictures.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:net';

const OUT = 'shots/goods';
const freePort = () => new Promise((resolve) => { const srv = createServer(); srv.listen(0, () => { const p = srv.address().port; srv.close(() => resolve(p)); }); });
const port = await freePort();
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; ; i++) {
  const up = await fetch(`http://localhost:${port}/raide/`).then((r) => r.ok, () => false);
  if (up) break;
  if (i > 60) throw new Error('no preview server');
  await new Promise((r) => setTimeout(r, 500));
}
mkdirSync(`${OUT}/piles`, { recursive: true });
const browser = await chromium.launch();
const errors = [];
const base = `http://localhost:${port}/raide/?lang=en`;
try {
  for (const orient of ['portrait', 'landscape']) {
    const ctx = await browser.newContext({ ...devices[orient === 'portrait' ? 'iPhone 15' : 'iPhone 15 landscape'], hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${orient}: ${e}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${orient}: ${m.text()}`));
    const shot = (name) => page.screenshot({ path: `${OUT}/${name}-${orient}.png` });
    const open = async (query) => {
      await page.goto(`${base}${query}`);
      await page.locator('[data-scenario="harju"]').tap();
      await page.waitForFunction(() => window.__sim, null, { timeout: 10000 });
    };
    // the camera on a tile point at a zoom, nothing followed
    const view = async (x, y, scale) => {
      await page.evaluate(([x, y, scale]) => { const r = window.__renderer; r.follow(null); r.setScale(scale); r.cam.x = x; r.cam.y = y; r.clampCam?.(); }, [x, y, scale]);
      await page.waitForTimeout(500);
    };
    const site = (id) => page.evaluate((id) => { const o = window.__sim.sites.find((x) => x.id === id); return { x: o.cx + 0.5, y: o.cy + 0.5 }; }, id);
    // the visible site tags: any two that overlap by more than 2 px are an error
    const overlaps = () => page.evaluate(() => {
      const boxes = [...document.querySelectorAll('.site-tag')].filter((e) => e.style.display !== 'none').map((e) => ({ k: e.dataset.key, r: e.getBoundingClientRect() }));
      const out = [];
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i].r; const b = boxes[j].r;
          if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) out.push(`${boxes[i].k} and ${boxes[j].k}`);
        }
      return out;
    });

    // 1. piles from the stock: the bot plays, Koskensaha at close zoom early and after 25 s
    await open('&bot=1&speed=4');
    const ks = await site('sawmill');
    await view(ks.x, ks.y - 2.5, 36);
    await shot('yard-early');
    await page.waitForFunction(() => window.__sim.time >= 25, null, { timeout: 60000 });
    await view(ks.x, ks.y - 2.5, 36);
    await shot('yard-late');
    console.log(orient, 'Koskensaha after 25 s', await page.evaluate(() => { const o = window.__sim.sites.find((x) => x.id === 'sawmill'); return JSON.stringify({ time: Math.round(window.__sim.time), boards: +o.stock.toFixed(1), timberIn: +o.taken.timber.toFixed(1) }); }));

    // 2. route zoom: every site centred in turn, no two tags overlapping
    for (const id of ['forest', 'sawmill', 'hameenlinna', 'farm', 'mill', 'tampere']) {
      const p = await site(id);
      await view(p.x, p.y - 3, 15);
      const bad = await overlaps();
      for (const b of bad) errors.push(`${orient} route zoom at ${id}: tags ${b} overlap`);
    }
    const mid = { x: (ks.x + 14.5) / 2, y: ks.y - 2 };
    await view(mid.x, mid.y, 15);
    await shot('route-zoom');

    // 3. the whole map: badges with the made good, a count on raw sites and the wants dots
    await page.evaluate(() => { const r = window.__renderer; r.follow(null); for (let i = 0; i < 4; i++) r.zoomStep(-1); });
    await page.waitForFunction(() => window.__renderer.zoomTo === null, null, { timeout: 10000 });
    await page.waitForTimeout(600);
    await shot('whole-map');
    const dots = await page.evaluate(() => [...document.querySelectorAll('.badge')].filter((e) => e.style.display !== 'none').map((e) => `${e.querySelector('.nm')?.textContent}:${e.querySelectorAll('.wd .gi').length}:${e.querySelector('.n')?.textContent ?? '-'}`));
    console.log(orient, 'badges (name:wants dots:count)', dots.join(' '));
    if (!dots.length) errors.push(`${orient}: no badges on the whole map`);

    // 4. the Koskensaha card, opened by a touch on its label
    await view(ks.x, ks.y - 3, 23);
    const tag = await page.locator('.site-tag[data-key="site:sawmill"]').boundingBox();
    await page.touchscreen.tap(tag.x + tag.width / 2, tag.y + tag.height / 2);
    await page.waitForTimeout(500);
    if (!(await page.locator('.site-card').count())) errors.push(`${orient}: a tap on the Koskensaha label did not open its card`);
    for (const sec of ['has', 'wants', 'buyers']) if (!(await page.locator(`.site-card [data-sec="${sec}"]`).count())) errors.push(`${orient}: the card has no ${sec} section`);
    await shot('site-card');

    // 5. pick mode: "Lay track from here" closes the card and marks the targets
    await page.locator('.site-card [data-act="lay"]').tap();
    await page.waitForTimeout(500);
    if (!(await page.locator('.pick-banner').count())) errors.push(`${orient}: no pick banner after Lay track from here`);
    if (await page.locator('.site-card').count()) errors.push(`${orient}: the card stayed open in pick mode`);
    await view(ks.x + 6, ks.y + 8, 9.5);
    await shot('pick-mode');
    // a tap on the empty ground leaves pick mode
    await page.touchscreen.tap(20, 300);
    await page.waitForTimeout(300);
    if (await page.locator('.pick-banner').count()) errors.push(`${orient}: a tap on the ground did not end pick mode`);
    await ctx.close();
  }

  // 6. the piles of each site empty, half and full, from injected stock, on a quiet map
  const ctx = await browser.newContext({ ...devices['iPhone 15'], hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`piles: ${e}`));
  await page.goto(`${base}&speed=1`);
  await page.locator('[data-scenario="harju"]').tap();
  await page.waitForFunction(() => window.__sim, null, { timeout: 10000 });
  const states = { empty: { stock: 0, timber: 0, grain: 0, boards: 0, flour: 0 }, half: { stock: 3, timber: 5, grain: 5, boards: 5, flour: 5 }, full: { stock: 6, timber: 10, grain: 10, boards: 10, flour: 10 } };
  const hashes = {};
  for (const id of ['forest', 'sawmill', 'farm', 'mill', 'hameenlinna']) {
    for (const [name, v] of Object.entries(states)) {
      await page.evaluate(([id, v]) => {
        const s = window.__sim; const o = s.sites.find((x) => x.id === id); const r = window.__renderer;
        o.stock = v.stock; o.taken.timber = v.timber; o.taken.grain = v.grain; o.taken.boards = v.boards; o.taken.flour = v.flour;
        r.follow(null); r.setScale(36); r.cam.x = o.cx + 0.5; r.cam.y = o.cy - 2; r.clampCam?.();
      }, [id, v]);
      await page.waitForTimeout(450);
      const buf = await page.screenshot({ path: `${OUT}/piles/${id}-${name}.png` });
      hashes[`${id}-${name}`] = buf.length;
    }
    // each step must differ from the last: empty, half and full are three different pictures
    // the three pictures side by side in one sheet, the way to read the step from empty to full
    const sheet = await ctx.newPage();
    await sheet.setViewportSize({ width: 1200, height: 860 });
    const img = (n) => `<img src="${id}-${n}.png" style="width:393px;height:852px;margin:0 3px">`;
    writeFileSync(`${OUT}/piles/${id}.html`, `<body style="margin:0;background:#222">${['empty', 'half', 'full'].map(img).join('')}</body>`);
    await sheet.goto(`file://${resolve(OUT)}/piles/${id}.html`);
    await sheet.waitForTimeout(300);
    await sheet.screenshot({ path: `${OUT}/piles-${id}.png` });
    await sheet.close();
    const [a, b, c] = ['empty', 'half', 'full'].map((n) => hashes[`${id}-${n}`]);
    if (a === b || b === c) errors.push(`piles at ${id}: empty, half and full are not three different pictures (${a}, ${b}, ${c} bytes)`);
  }
  await ctx.close();
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`${OUT}/`);
