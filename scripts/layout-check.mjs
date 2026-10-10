// Custom layouts by touch on an emulated iPhone 16 in portrait (ADR 0004): a drag from Kuusikko's
// station to an open tile leaves a track end, a drag from that end on to Koskensaha lays the trunk,
// a drag from the middle of the trunk to Korpela makes a junction, Koskensaha's card makes the line
// Kuusikko-Koskensaha over the track, a train is bought and the sim says it runs over the drawn
// track. Pictures of each step at play zoom into shots/layout/, the track end and the junction
// close up. `make layout-check` (builds first). It fails when a step does not do what it says.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

const OUT = 'shots/layout';
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
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) errors.push(what);
};
// the tile the trunk turns at in the open, and the trunk cell the branch is dragged from
const OPEN = [25, 31];
const MIDDLE = [23, 30];
try {
  const ctx = await browser.newContext({ ...devices['iPhone 16'], hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${e}`));
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
  const siteCell = (id) => page.evaluate((id) => { const o = window.__sim.sites.find((x) => x.id === id); return [o.cx, o.cy]; }, id);
  const at = (c) => page.evaluate(([x, y]) => window.__renderer.project(x + 0.5, y + 0.5, 0), c);
  const frame = async (cells, scale) => {
    await page.evaluate(([cells, scale]) => {
      const r = window.__renderer;
      const xs = cells.map((c) => c[0]);
      const ys = cells.map((c) => c[1]);
      r.follow(null);
      r.setScale(scale);
      r.cam.x = (Math.min(...xs) + Math.max(...xs)) / 2 + 0.5;
      r.cam.y = (Math.min(...ys) + Math.max(...ys)) / 2 + 0.5;
      r.clampCam?.();
    }, [cells, scale]);
    await page.waitForTimeout(700);
  };
  const drag = async (from, to) => {
    const a = await at(from);
    await touch('touchStart', [{ x: a.x, y: a.y, id: 1 }]);
    // a finger on laid track rests a moment before the drag starts from it
    await page.waitForTimeout(450);
    let p = a;
    for (let i = 0; i < 60; i++) {
      const b = await at(to);
      p = { x: p.x + (b.x - p.x) * 0.25, y: p.y + (b.y - p.y) * 0.25 };
      await touch('touchMove', [{ x: p.x, y: p.y, id: 1 }]);
      await page.waitForTimeout(40);
      if (Math.hypot(b.x - p.x, b.y - p.y) < 3) break;
    }
    await page.waitForTimeout(300);
    return () => touch('touchEnd', []);
  };
  // the lift builds nothing: the route waits on the map with Build and Cancel. `lift` takes the finger off and builds
  const lift = async (end, build = true) => {
    await end();
    await page.waitForTimeout(700);
    if (!build) return;
    await shot(`confirm-${Date.now() % 100000}`);
    await page.locator('[data-act="plan-build"]').tap();
    await page.waitForTimeout(700);
  };
  const state = () => page.evaluate(() => { const s = window.__sim; return { cash: s.cash, lines: s.lines.length, stations: s.stations.length, trains: s.trains.length, cells: s.track.reduce((n, v) => n + (v ? 1 : 0), 0) }; });
  const linksAt = (c) => page.evaluate(([x, y]) => { const s = window.__sim; const m = s.track[y * s.w + x]; let n = 0; for (let d = 0; d < 8; d++) if (m & (1 << d)) n++; return n; }, c);
  const closeCards = async () => { while (await page.locator('.round.close').count()) { await page.locator('.round.close').first().tap(); await page.waitForTimeout(250); } };

  await page.goto(`http://localhost:${port}/raide/?lang=en&speed=3`);
  await page.locator('[data-scenario="harju"]').tap();
  await page.waitForFunction(() => window.__sim, null, { timeout: 10000 });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { window.__sim.cash = 900; });
  await page.evaluate(() => setInterval(() => { document.querySelector('.card.ledger .btn.choice.continue, .card.ledger [data-act="skip"]')?.click(); }, 250));
  const forest = await siteCell('forest');
  const sawmill = await siteCell('sawmill');
  const korpela = await siteCell('korpela');

  // 1. Kuusikko to an open tile: a track end with a buffer stop
  await frame([forest, OPEN], 18);
  await shot('0-start');
  const s0 = await state();
  await lift(await drag(forest, OPEN));
  let s1 = await state();
  check(s1.lines === 0 && s1.stations === s0.stations && s1.cells > s0.cells && s1.cash < s0.cash, `1: a drag to an open tile lays track, no station and no line (cash ${s0.cash} -> ${s1.cash}, ${s1.cells - s0.cells} tiles)`);
  check((await linksAt(OPEN)) === 1, '1: the open tile is a track end with one link');
  await page.waitForTimeout(500);
  await shot('1-track-end');
  await frame([OPEN], 40);
  await shot('1b-track-end-close');
  await closeCards();

  // 2. from the track end on to Koskensaha
  await frame([OPEN, sawmill], 18);
  await lift(await drag(OPEN, sawmill));
  const s2 = await state();
  check(s2.lines === 0 && s2.stations === s1.stations + 1 && (await linksAt(OPEN)) === 2, `2: a drag from the track end to Koskensaha builds the station and the trunk, still no line (${s2.stations} stations)`);
  await shot('2-trunk');
  await closeCards();

  // 3. from the middle of the trunk to Korpela: a junction
  const trunk = await page.evaluate(([x, y]) => window.__sim.track[y * window.__sim.w + x] !== 0, MIDDLE);
  check(trunk, '3: the middle cell is laid track');
  await frame([MIDDLE, korpela, forest], 14);
  const before = await state();
  await lift(await drag(MIDDLE, korpela));
  const s3 = await state();
  const junction = await page.evaluate(() => { const s = window.__sim; for (let i = 0; i < s.track.length; i++) { let n = 0; for (let d = 0; d < 8; d++) if (s.track[i] & (1 << d)) n++; if (n >= 3) return [i % s.w, Math.floor(i / s.w)]; } return null; });
  check(!!junction && s3.cells > before.cells && s3.lines === 0, `3: a drag from the middle of the trunk makes a junction with three links (at ${junction})`);
  await shot('3-junction');
  await closeCards();
  if (junction) {
    await frame([junction], 40);
    await shot('3b-junction-close');
  }

  // 4. Koskensaha's card makes the line Kuusikko-Koskensaha, a train is bought
  await frame([forest, sawmill], 13);
  const p = await at(sawmill);
  await page.touchscreen.tap(p.x, p.y);
  await page.locator('.site-card').waitFor({ timeout: 3000 });
  await page.waitForTimeout(500);
  await shot('4-station-card');
  const button = page.locator('[data-act="new-line"][data-to="forest"]');
  check((await button.count()) === 1, '4: the station card lists Kuusikko under New line');
  await button.tap();
  await page.locator('[data-track="card-buy-train"]').waitFor({ timeout: 3000 });
  await page.waitForTimeout(500);
  await shot('5-line-card');
  const made = await page.evaluate(() => { const s = window.__sim; const l = s.lines[0]; return l && { n: s.lines.length, stops: l.stops.length, from: s.sites.find((o) => o.id === s.stations.find((st) => st.id === l.stops[0]).siteId).id, to: s.sites.find((o) => o.id === s.stations.find((st) => st.id === l.stops[1]).siteId).id, whole: l.path.every((c, k) => k === 0 || (() => { const a = l.path[k - 1]; const dx = (c % s.w) - (a % s.w); const dy = Math.floor(c / s.w) - Math.floor(a / s.w); const d = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]].findIndex(([x, y]) => x === dx && y === dy); return d >= 0 && (s.track[a] & (1 << d)) !== 0; })()) }; });
  check(!!made && made.n === 1 && made.stops === 2 && [made.from, made.to].sort().join() === 'forest,sawmill' && made.whole, `4: the line Kuusikko-Koskensaha runs over laid links (${JSON.stringify(made)})`);
  await page.locator('[data-track="card-buy-train"]').tap();
  await page.waitForTimeout(600);
  check((await state()).trains === 1, '4: a train is bought');

  // 5. the train runs over the drawn track: every position it takes is a cell of the line, and the line's cells carry track
  await page.evaluate(() => { const r = window.__renderer; r.setScale(14); r.follow(window.__sim.trains[0]); });
  const seen = new Set();
  let off = 0;
  let arrived = false;
  for (let k = 0; k < 400 && !arrived; k++) {
    await page.waitForTimeout(100);
    const r = await page.evaluate(() => {
      const s = window.__sim; const t = s.trains[0]; const l = s.lines[0];
      let j = 0; while (j < l.path.length - 1 && l.dist[j + 1] <= t.s) j++;
      return { cell: l.path[j], track: s.track[l.path[j]] !== 0, idx: t.idx, state: t.state, odo: t.odometer };
    });
    seen.add(r.cell);
    if (!r.track) off++;
    if (r.state === 'stop' && r.idx === 1) arrived = true;
    if (k === 6) await shot('6-train-on-the-trunk');
  }
  check(arrived && off === 0 && seen.size > 8, `5: the train ran from Kuusikko to Koskensaha over ${seen.size} cells of laid track, never off it (${off} frames off)`);
  await shot('7-train-at-koskensaha');

  // 6. the player shapes the route: a pause pins a waypoint, the lift builds nothing and shows Build and Cancel,
  // the ghost bends when dragged by its middle, Cancel spends nothing, Build spends the plate's cost
  await page.evaluate(() => { window.__sim.cash = 3000; window.__renderer.follow(null); window.__freeze = true; });
  await closeCards();
  const tampere = await siteCell('tampere');
  const WAY = [12, 52];
  await frame([[14, 21], [27, 72]], 11.5);
  const cashBefore = (await state()).cash;
  const plain = await page.evaluate(() => null);
  const a = await at(forest);
  await touch('touchStart', [{ x: a.x, y: a.y, id: 1 }]);
  const w = await at(WAY);
  const t2 = await at(tampere);
  const go = async (to, steps) => {
    const from = await page.evaluate(() => ({ x: window.__input.drag.sx, y: window.__input.drag.sy }));
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps, id: 1 }]);
      await page.waitForTimeout(30);
    }
  };
  await go(w, 14);
  await page.waitForTimeout(600);
  const pinned = await page.evaluate((c) => { const d = window.__input.drag; const s = window.__sim; return d && { via: d.via, hit: d.route && d.via.length > 0 && d.route.cells.includes(d.via[0]), cells: d.route && d.route.cells.length }; });
  check(!!pinned && pinned.via.length === 1 && pinned.hit, `6: a pause of 0.6 s pins a waypoint and the route runs through it (${JSON.stringify(pinned)})`);
  await shot('8-waypoint-dot');
  await go(t2, 14);
  await page.waitForTimeout(250);
  await touch('touchEnd', []);
  await page.waitForTimeout(700);
  const s6 = await state();
  const box = async (sel) => page.locator(sel).boundingBox();
  const bb = await box('[data-act="plan-build"]');
  const cb = await box('[data-act="plan-cancel"]');
  const vh = await page.evaluate(() => window.innerHeight);
  check(s6.cash === cashBefore && s6.lines === 1 && !!bb && !!cb, `6: the lift spends nothing and leaves Build and Cancel (cash ${cashBefore} -> ${s6.cash})`);
  check(bb.height >= 48 && cb.height >= 48 && bb.y > vh / 2 && cb.y > vh / 2, `6: both buttons are at least 48 px tall and in the lower half (${Math.round(bb.height)} and ${Math.round(cb.height)} px, at ${Math.round(bb.y)} of ${vh})`);
  const plate = await page.evaluate(() => ({ via: window.__input.plan.via.length, cost: window.__input.chosenRoute().cost, text: document.querySelector('.build-plan .num').textContent }));
  check(plate.via === 1 && String(plate.cost) === plate.text, `6: the plate shows the route's cost (${plate.text}) and the waypoint stays`);
  await shot('9-confirm-plate');
  // bend: drag a point of the ghost that shows above the card, away from the waypoint
  const grab = await page.evaluate(() => {
    const r = window.__renderer; const s = window.__sim; const cells = window.__input.chosenRoute().cells; const a = r.area();
    let best = null;
    for (let i = 4; i < cells.length - 4; i++) {
      const p = r.project((cells[i] % s.w) + 0.5, Math.floor(cells[i] / s.w) + 0.5, 0);
      if (p.y < 185 || p.y > 300) continue;
      if (window.__input.plan.via.some((c) => Math.abs((c % s.w) - (cells[i] % s.w)) + Math.abs(Math.floor(c / s.w) - Math.floor(cells[i] / s.w)) < 6)) continue;
      if (!best || Math.abs(p.x - 196) < Math.abs(best.x - 196)) best = { x: p.x, y: p.y, i };
    }
    return best;
  });
  check(!!grab, '6: a point of the ghost shows above the plate');
  if (grab) {
    await touch('touchStart', [{ x: grab.x, y: grab.y, id: 1 }]);
    for (let i = 1; i <= 10; i++) {
      await touch('touchMove', [{ x: grab.x + 9 * i, y: grab.y - 2 * i, id: 1 }]);
      await page.waitForTimeout(40);
    }
    await touch('touchEnd', []);
    await page.waitForTimeout(700);
    const bent = await page.evaluate(() => ({ via: window.__input.plan.via.length, cash: window.__sim.cash }));
    check(bent.via === 2 && bent.cash === cashBefore, `6: dragging the ghost adds a waypoint and spends nothing (${bent.via} waypoints)`);
    await shot('10-bent-ghost');
    // a tap on a waypoint dot takes it away
    const dot = await page.evaluate(() => { const r = window.__renderer; const s = window.__sim; const dots = window.__input.plan.via.map((c) => r.project((c % s.w) + 0.5, Math.floor(c / s.w) + 0.5, 0)); return dots.find((d) => d.y > 185 && d.y < 340) ?? dots[0]; });
    await page.touchscreen.tap(dot.x, dot.y);
    await page.waitForTimeout(500);
    check((await page.evaluate(() => window.__input.plan.via.length)) === 1, '6: a tap on a waypoint takes it away');
  }
  // a tap elsewhere on the map does not cancel
  await page.touchscreen.tap(30, 200);
  await page.waitForTimeout(300);
  check(await page.evaluate(() => !!window.__input.plan), '6: a tap on the map does not cancel the route');
  await page.locator('[data-act="plan-cancel"]').tap();
  await page.waitForTimeout(500);
  const sCancel = await state();
  check(sCancel.cash === cashBefore && sCancel.lines === 1 && (await page.evaluate(() => !window.__input.plan)), `6: Cancel spends nothing and clears the route (cash ${sCancel.cash})`);
  // the same drag with no pause: Build spends what the plate said
  await frame([[14, 21], [27, 72]], 11.5);
  await lift(await drag(forest, tampere), false);
  const quick = await page.evaluate(() => ({ via: window.__input.plan.via.length, text: document.querySelector('.build-plan .num').textContent }));
  await page.locator('[data-act="plan-build"]').tap();
  await page.waitForTimeout(600);
  const sBuilt = await state();
  check(quick.via === 0 && sBuilt.cash === cashBefore - Number(quick.text) && sBuilt.lines === 2, `6: a quick straight drag has no waypoint, and Build spends the plate's cost (${quick.text}: cash ${cashBefore} -> ${sBuilt.cash})`);
  check(errors.length === 0, `no page errors (${errors.join('; ')})`);
} catch (e) {
  errors.push(String(e).split('\n')[0]);
  console.log(`FAIL  ${errors[errors.length - 1]}`);
} finally {
  await browser.close();
  server.kill();
}
console.log(errors.length ? 'layout-check failed' : 'layout-check ok');
process.exitCode = errors.length ? 1 : 0;
