// The trains check: the pictures of slice 4, on Harju in portrait and landscape, into shots/trains/.
// A station with a train on its one platform and another waiting on its line before it (play zoom and close
// up), the buy card on the Kuusikko line, the train card of a running train, a train mid-dwell at
// Kuusikko (one wagon full, one loading, one empty) close up with its tag, a train leaving a
// terminus fully on the track, the site card with the loading crew row, and pick mode from
// Koskensaha zoomed to fit. It fails when a card is missing a part or a train stands off its rails.
// Run `make trains` (builds first), then look at the pictures.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

const OUT = 'shots/trains';
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
const base = `http://localhost:${port}/raide/?lang=en&speed=1`;
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
    // the scene: three lines from Koskensaha and Kuusikko, the cash to buy what the pictures need
    await page.evaluate(() => {
      const s = window.__sim; const act = window.__act;
      s.cash = 9999;
      const cell = (id) => { const o = s.sites.find((x) => x.id === id); return o.cy * s.w + o.cx; };
      for (const [a, b] of [['forest', 'sawmill'], ['sawmill', 'hameenlinna'], ['sawmill', 'tampere']]) act.build(act.plan(cell(a), cell(b))[0]);
    });
    const view = async (x, y, scale) => {
      await page.evaluate(([x, y, scale]) => { const r = window.__renderer; r.follow(null); r.setScale(scale); r.cam.x = x; r.cam.y = y; r.clampCam?.(); }, [x, y, scale]);
      await page.waitForTimeout(600);
    };
    const site = (id) => page.evaluate((id) => { const o = window.__sim.sites.find((x) => x.id === id); return { x: o.cx + 0.5, y: o.cy + 0.5 }; }, id);

    // 1. Koskensaha with one train on its platform and the Kuusikko train waiting on its line before the station, the real sim: the box train keeps the platform, the flat train runs in and stops clear of it
    await page.evaluate(() => {
      const s = window.__sim; const act = window.__act;
      const box = act.buyTrain(s.lines[1].id, 'box', 'hilma', 3);
      box.stopLeft = 1e9; box.fullLoad = true;
      act.buyTrain(s.lines[0].id, 'flat', 'hilma', 3);
    });
    await page.waitForFunction(() => window.__sim.trains.some((t) => t.queued), null, { timeout: 90000, polling: 100 }).catch(() => errors.push(`${orient}: no train waited for the platform`));
    await page.waitForTimeout(1500);
    // the queued train and the one on the platform: each fully on a track, and the queue is clear of the platform
    const queue = await page.evaluate(() => {
      const s = window.__sim; const r = window.__renderer;
      const q = s.trains.find((t) => t.queued); const p = s.trains.find((t) => t.state === 'stop' && t.at !== null);
      if (!q || !p) return null;
      const sc = s.sites.find((x) => x.id === 'sawmill');
      const dist = (t) => Math.min(...r.vehicles(t).map((v) => Math.hypot(v.wx - (sc.cx + 0.5), v.wy - (sc.cy + 0.5))));
      return { queued: q.id, platform: p.id, slot: p.slot, qDist: dist(q), pDist: Math.max(...r.vehicles(p).map((v) => Math.hypot(v.wx - (sc.cx + 0.5), v.wy - (sc.cy + 0.5)))) };
    });
    if (!queue) errors.push(`${orient}: the station scene has no queued train and train on a platform`);
    else if (queue.qDist < queue.pDist - 0.2) errors.push(`${orient}: the waiting train reaches into the platform (${JSON.stringify(queue)})`);
    else console.log(orient, 'queue', JSON.stringify(queue));
    const ks = await site('sawmill');
    await view(ks.x, ks.y + 0.6, 23);
    await shot('station-play');
    await view(ks.x, ks.y + 0.6, 36);
    await shot('station-close');
    // every standing vehicle is on a rail: within 0.45 tile of the line's centre line or of a platform track
    const off = await page.evaluate(() => {
      const s = window.__sim; const r = window.__renderer;
      const out = [];
      const aprons = r.aprons;
      for (const t of s.trains) {
        const l = s.lines.find((o) => o.id === t.lineId);
        const pts = l.path.map((c) => [(c % s.w) + 0.5, Math.floor(c / s.w) + 0.5]);
        for (const v of r.vehicles(t)) {
          let best = Infinity;
          for (let k = 1; k < pts.length; k++) {
            const [ax, ay] = pts[k - 1]; const [bx, by] = pts[k];
            const dx = bx - ax; const dy = by - ay;
            const u = Math.max(0, Math.min(1, ((v.wx - ax) * dx + (v.wy - ay) * dy) / (dx * dx + dy * dy || 1)));
            best = Math.min(best, Math.hypot(ax + dx * u - v.wx, ay + dy * u - v.wy));
          }
          // the platform tracks of the station it stands at: rows 0.8 apart south of the line's row
          const a = aprons.find((o) => o.cell === t.at);
          if (a) for (let k = 0; k < a.k; k++) best = Math.min(best, Math.abs(v.wy - (a.y + 0.5 + r.platformY(a, k, v.wx))));
          if (best > 0.45) out.push(`train ${t.id} vehicle ${v.i} is ${best.toFixed(2)} tiles off every rail`);
        }
      }
      return out;
    });
    for (const o of off) errors.push(`${orient} station: ${o}`);
    // no standing vehicle overlaps another
    const overlap = await page.evaluate(() => {
      const r = window.__renderer; const s = window.__sim;
      const vs = s.trains.flatMap((t) => r.vehicles(t));
      let n = 0;
      for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) if (Math.hypot(vs[i].wx - vs[j].wx, vs[i].wy - vs[j].wy) < 0.7) n++;
      return n;
    });
    if (overlap) errors.push(`${orient} station: ${overlap} pairs of vehicles overlap`);
    // let them go: the staged trains stay out of the way of the other pictures
    await page.evaluate(() => { const s = window.__sim; s.trains.length = 0; });

    // 2. the buy card on the Kuusikko line, opened by a touch on its track
    const mid = await page.evaluate(() => {
      const s = window.__sim; const l = s.lines[0]; const c = l.path[Math.floor(l.path.length / 2)];
      return { x: (c % s.w) + 0.5, y: Math.floor(c / s.w) + 0.5 };
    });
    await view(mid.x, mid.y - 2, 23);
    const p = await page.evaluate(([x, y]) => window.__renderer.project(x, y, 0), [mid.x, mid.y]);
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForTimeout(500);
    if (!(await page.locator('.buy-card').count())) errors.push(`${orient}: the line card did not open`);
    for (const sel of ['[data-engine="hilma"]', '[data-engine="jyry"]', '[data-wagon="flat"]', '[data-wagon="box"]', '[data-act="more"]', '[data-act="fewer"]', '[data-act="buy"]']) if (!(await page.locator(`.buy-card ${sel}`).count())) errors.push(`${orient}: the buy card has no ${sel}`);
    await shot('buy-card');
    await page.locator('.buy-card [data-act="more"]').tap();
    await page.locator('.buy-card [data-act="buy"]').tap();
    await page.waitForTimeout(400);
    if (await page.evaluate(() => window.__sim.trains.length) !== 1) errors.push(`${orient}: Buy did not buy a train`);
    if (await page.evaluate(() => window.__sim.trains[0].nWagons) !== 3) errors.push(`${orient}: the wagon count of the buy card was not used`);

    // 3. a train mid-dwell at Kuusikko, close up: one wagon full, one loading, one empty
    await page.evaluate(() => { const s = window.__sim; const f = s.sites.find((x) => x.id === 'forest'); f.stock = 6; f.rate = 0; });
    await page.waitForFunction(() => { const t = window.__sim.trains[0]; return t && t.dock === 'load' && t.cargo === 1 && t.work < 0.3; }, null, { timeout: 30000, polling: 20 }).catch(() => errors.push(`${orient}: no mid-dwell moment at Kuusikko`));
    const fo = await site('forest');
    const trainMid = () => page.evaluate(() => { const r = window.__renderer; const vs = r.vehicles(window.__sim.trains[0]); const v = vs[Math.floor(vs.length / 2)]; return { x: v.wx, y: v.wy }; });
    let tm = await trainMid();
    await view(tm.x, tm.y - 1.8, 40);
    await shot('loading');
    // 4. the same train leaving the terminus: wholly on the track
    await page.waitForFunction(() => { const t = window.__sim.trains[0]; return t.state === 'run'; }, null, { timeout: 30000, polling: 20 });
    await page.waitForTimeout(150);
    tm = await trainMid();
    await view(tm.x, tm.y - 0.6, 34);
    await shot('leaving');

    // 5. the train card of a running train
    await page.waitForTimeout(3000);
    const tp = await page.evaluate(() => { const r = window.__renderer; const t = window.__sim.trains[0]; r.follow(t); return t.id; });
    await page.waitForTimeout(1500);
    const vp = await page.evaluate((id) => { const r = window.__renderer; const v = r.vehicles(window.__sim.trains.find((t) => t.id === id))[0]; return { x: v.px, y: v.py }; }, tp);
    await page.touchscreen.tap(vp.x, vp.y);
    await page.waitForTimeout(500);
    if (!(await page.locator('.train-card').count())) errors.push(`${orient}: a tap on the train did not open its card`);
    for (const sel of ['[data-sec="facts"]', '[data-sec="trip"]', '[data-sec="earned"]', '[data-sec="grade"]', '[data-act="wagon"]', '[data-act="fullload"]', '[data-act="move"]', '[data-act="sell"]', '.consist']) if (!(await page.locator(`.train-card ${sel}`).count())) errors.push(`${orient}: the train card has no ${sel}`);
    await page.locator('.train-card [data-act="move"]').tap();
    await page.waitForTimeout(300);
    await shot('train-card');
    await page.locator('.train-card .round.close').tap();
    await page.waitForTimeout(300);

    // 6. the site card with the loading crew row
    await page.evaluate(() => window.__renderer.follow(null));
    await view(fo.x, fo.y - 3, 23);
    const tag = await page.locator('.site-tag[data-key="site:forest"]').boundingBox();
    await page.touchscreen.tap(tag.x + tag.width / 2, tag.y + tag.height / 2);
    await page.waitForTimeout(500);
    if (!(await page.locator('.site-card [data-sec="crew"]').count())) errors.push(`${orient}: the site card has no crew row`);
    await shot('site-card-crew');
    if (!(await page.locator('.site-card [data-sec="platforms"] [data-act="platform"]').count())) errors.push(`${orient}: the site card has no platform row`);
    await page.locator('.site-card [data-act="crew"]').tap();
    await page.waitForTimeout(500);
    if (!(await page.evaluate(() => window.__sim.stations[0].crew))) errors.push(`${orient}: the crew button did not buy the crew`);
    await shot('site-card-crew-bought');
    await page.locator('.site-card [data-act="platform"]').tap();
    await page.waitForTimeout(400);
    if ((await page.evaluate(() => window.__sim.stations[0].platforms)) !== 2) errors.push(`${orient}: the platform button did not buy a platform`);
    await shot('site-card-platform-bought');
    await page.locator('.site-card .round.close').tap();
    await view(fo.x, fo.y - 1, 36);
    await shot('crew-at-station');
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`${OUT}/`);
