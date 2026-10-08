// The economy step 3 pictures, on Harju in portrait and landscape, into shots/upgrades/: the passing
// siding in pick mode (the stretch glows, the best place dashed) and bought, two trains passing at it
// (play zoom); the crane at Kuusikko loading, its arm toward the wagon (close zoom); the site card with
// the crew, crane and platform rows; the year-end card with a contract offer; and the taken contract's
// chip on the town's label and in the HUD. It fails when a card is missing a part, two trains meet on
// the main track, or a contract's chip is missing. Run `make upgrades` (builds first), then look.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

const OUT = 'shots/upgrades';
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
const LANG = process.env.LANG_PICK || 'en';
// a quarter pace, so a crane's swing from one wagon to the next can be caught
const base = `http://localhost:${port}/raide/?lang=${LANG}&speed=0.25`;
try {
  for (const orient of ['portrait', 'landscape']) {
    const ctx = await browser.newContext({ ...devices[orient === 'portrait' ? 'iPhone 15' : 'iPhone 15 landscape'], hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${orient}: ${e}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${orient}: ${m.text()}`));
    const shot = (name) => page.screenshot({ path: `${OUT}/${name}-${orient}.png` });
    await page.goto(base);
    await page.locator('[data-scenario="harju"]').tap();
    await page.waitForFunction(() => window.__sim, null, { timeout: 10000 });
    await page.evaluate(() => {
      const s = window.__sim; const act = window.__act;
      s.cash = 9999;
      const cell = (id) => { const o = s.sites.find((x) => x.id === id); return o.cy * s.w + o.cx; };
      for (const [a, b] of [['forest', 'sawmill'], ['sawmill', 'hameenlinna']]) act.build(act.plan(cell(a), cell(b))[0]);
      for (const st of s.stations) st.platforms = 2;
    });
    const view = async (x, y, scale) => {
      await page.evaluate(([x, y, scale]) => { const r = window.__renderer; r.follow(null); r.setScale(scale); r.cam.x = x; r.cam.y = y; r.clampCam?.(); }, [x, y, scale]);
      await page.waitForTimeout(600);
    };
    const site = (id) => page.evaluate((id) => { const o = window.__sim.sites.find((x) => x.id === id); return { x: o.cx + 0.5, y: o.cy + 0.5 }; }, id);

    // 1. the siding: the line card's row, pick mode with the glowing stretch, then bought
    const mid = await page.evaluate(() => {
      const s = window.__sim; const l = s.lines[1]; const c = l.path[Math.floor(l.path.length / 2)];
      return { x: (c % s.w) + 0.5, y: Math.floor(c / s.w) + 0.5 };
    });
    await view(mid.x, mid.y - 1, 23);
    let p = await page.evaluate(([x, y]) => window.__renderer.project(x, y, 0), [mid.x, mid.y]);
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForTimeout(500);
    if (!(await page.locator('.buy-card [data-sec="siding"] [data-act="siding"]').count())) errors.push(`${orient}: the line card has no siding Buy`);
    await shot('line-card-siding');
    await page.locator('.buy-card [data-act="siding"]').tap();
    await page.waitForTimeout(1500);
    if (!(await page.locator('[data-sec="siding-banner"]').count())) errors.push(`${orient}: pick mode has no banner`);
    await shot('siding-pick');
    // a tap on the glowing stretch, a little off the best place
    const spot = await page.evaluate(() => {
      const s = window.__sim; const l = s.lines[1];
      const k = Math.floor(l.path.length * 0.5);
      const c = l.path[k + 2];
      return { x: (c % s.w) + 0.5, y: Math.floor(c / s.w) + 0.5 };
    });
    p = await page.evaluate(([x, y]) => window.__renderer.project(x, y, 0), [spot.x, spot.y]);
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForTimeout(600);
    if (!(await page.evaluate(() => !!window.__sim.lines[1].siding))) errors.push(`${orient}: a tap on the glowing stretch did not place the siding`);
    await shot('siding-bought');
    await page.locator('.buy-card .round.close').tap().catch(() => {});
    // two trains at opposite ends, run until they pass at the loop
    await page.evaluate(() => {
      const s = window.__sim; const act = window.__act; const l = s.lines[1];
      act.buyTrain(l.id, 'box', 'hilma', 3);
      act.buyTrain(l.id, 'box', 'hilma', 3);
      for (const f of s.sites.filter((x) => x.kind === 'sawmill')) { f.stock = 6; }
    });
    const sid = await page.evaluate(() => { const s = window.__sim; const l = s.lines[1]; const sd = l.siding; const d = (sd.s0 + sd.s1) / 2; let k = 1; while (k < l.path.length - 1 && l.dist[k] < d) k++; const c = l.path[k]; return { x: (c % s.w) + 0.5, y: Math.floor(c / s.w) + 0.5 }; });
    await view(sid.x, sid.y, 23);
    let met = false;
    let bad = 0;
    for (let i = 0; i < 1500 && !met; i++) {
      await page.waitForTimeout(40);
      const st = await page.evaluate(() => {
        const s = window.__sim; const l = s.lines[1];
        const [a, b] = s.trains;
        if (!a || !b) return null;
        // main-track pieces must never meet; the pass: one in the loop (held or moving), the other on the main track in the loop's stretch
        const piece = (t) => { const h = (t.nWagons * 1.48 + 2.2) / 2; return [t.s - h, t.s + h]; };
        const inLoop = s.trains.find((t) => t.loop === 2);
        const other = s.trains.find((t) => t.loop === 1 && t.state === 'run');
        const pa = piece(a), pb = piece(b);
        const meet = a.loop !== 2 && b.loop !== 2 && a.state === 'run' && b.state === 'run' && Math.min(pa[1], pb[1]) - Math.max(pa[0], pb[0]) > 0.05;
        const passing = !!inLoop && !!other && other.s > l.siding.s0 + 2 && other.s < l.siding.s1 - 2;
        return { meet, passing };
      });
      if (st?.meet) bad++;
      if (st?.passing) met = true;
    }
    if (bad) errors.push(`${orient}: two trains met on the main track (${bad} frames)`);
    if (!met) errors.push(`${orient}: no train passed another at the siding`);
    await view(sid.x, sid.y, 23);
    await shot('siding-pass');
    // the siding at close zoom too
    await view(sid.x, sid.y, 36);
    await shot('siding-pass-close');
    await page.evaluate(() => { window.__sim.trains.length = 0; });

    // 2. the crane at Kuusikko: the site card rows, then a train loading under the boom
    const fo = await site('forest');
    await view(fo.x, fo.y - 3, 23);
    const tag = await page.locator('.site-tag[data-key="site:forest"]').boundingBox();
    await page.touchscreen.tap(tag.x + tag.width / 2, tag.y + tag.height / 2);
    await page.waitForTimeout(500);
    for (const sec of ['crew', 'crane', 'platforms']) if (!(await page.locator(`.site-card [data-sec="${sec}"]`).count())) errors.push(`${orient}: the site card has no ${sec} row`);
    if (!(await page.locator('.site-card [data-sec="crane"] [data-act="crane"][disabled]').count())) errors.push(`${orient}: the crane button is not disabled without the crew`);
    await shot('site-card-no-crew');
    await page.locator('.site-card [data-act="crew"]').tap();
    await page.waitForTimeout(300);
    await page.locator('.site-card [data-act="crane"]').tap();
    await page.waitForTimeout(500);
    if (!(await page.evaluate(() => window.__sim.stations[0].crane))) errors.push(`${orient}: the crane button did not buy the crane`);
    await shot('site-card-crane');
    await page.locator('.site-card .round.close').tap();
    // the idle station's light pillar would stand over the crane: no marks for these pictures
    await page.evaluate(() => { window.__renderer.markOf = () => ({ kind: 'plain', cost: 0 }); });
    await page.waitForFunction(() => window.__sim.floats.length === 0, null, { timeout: 60000 });
    const fo2 = await site('forest');
    await view(fo2.x + 0.5, fo2.y - 0.9, 56);
    // the train is bought with the sim held, so the camera is there before the first load
    await page.evaluate(() => { window.__freeze = true; });
    await page.evaluate(() => {
      const s = window.__sim; const act = window.__act;
      act.buyTrain(s.lines[0].id, 'flat', 'hilma', 3);
      const f = s.sites.find((x) => x.id === 'forest'); f.stock = 6; f.rate = 0;
    });
    await page.evaluate(() => { window.__freeze = false; });
    await page.waitForFunction(() => { const t = window.__sim.trains[0]; return t && t.dock === 'load' && t.cargo === 1 && t.work < 0.12; }, null, { timeout: 60000, polling: 10 }).catch(() => errors.push(`${orient}: no loading moment at Kuusikko`));
    await page.evaluate(() => { window.__freeze = true; });
    await page.waitForTimeout(300);
    await shot('crane-loading');
    await page.evaluate(() => { window.__freeze = false; });
    await page.waitForFunction(() => { const t = window.__sim.trains[0]; return t && t.dock === 'load' && t.cargo === 2 && t.work < 0.12; }, null, { timeout: 60000, polling: 10 }).catch(() => {});
    await page.evaluate(() => { window.__freeze = true; });
    await page.waitForTimeout(300);
    await shot('crane-loading-2');
    await page.evaluate(() => { window.__freeze = false; });
    await page.evaluate(() => { window.__sim.trains.length = 0; });

    // 3. the year end with a contract offer, taken, and its chip on the town's label and in the HUD
    await page.evaluate(() => { const s = window.__sim; s.yearFrac = 0.9995; });
    await page.waitForSelector('.card.ledger', { timeout: 15000 });
    if (!(await page.locator('.card.ledger [data-sec="offer"]').count())) errors.push(`${orient}: the year-end card has no contract offer`);
    const offer = await page.evaluate(() => window.__sim.offer);
    await shot('year-end-offer');
    await page.locator('.card.ledger [data-act="take"]').tap();
    await page.waitForTimeout(500);
    if (!(await page.evaluate(() => window.__sim.contracts.length === 1))) errors.push(`${orient}: Take did not hold the contract`);
    const target = await site(offer.site);
    await view(target.x, target.y - 3, 23);
    if (!(await page.locator(`.site-tag[data-key="site:${offer.site}"] .chip.contract`).count())) errors.push(`${orient}: the target's label has no contract chip`);
    if (!(await page.locator('.hud-contracts .ct').count())) errors.push(`${orient}: the HUD has no contract line`);
    await shot('contract-chip');
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`${OUT}/`);
