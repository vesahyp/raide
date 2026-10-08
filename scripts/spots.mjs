// The spots check: the bot plays Harju at ?speed=4 on an emulated iPhone, and the script takes the
// views where a drawing error shows: the hill, the junction at Koskensaha, the bridge, the ridge, the
// whole map and a close up at Kuusikko, in portrait and landscape, into shots/spots/. It also
// checks that no two standing trains share a platform track and no two trains' vehicles overlap, that every running train sits on its rails (a vehicle further than 0.45 tile from the
// line's centre line is an error) and that the mean draw time per frame at play zoom, from
// ?fps=1, is at most 12 ms. Run `make spots` (builds first), then look at the pictures.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

const OUT = 'shots/spots';
const MAX_FRAME_MS = 12;
// an engine on the tightest curve sits on its chord, about 0.3 tile inside the rails
const MAX_OFF_TILES = 0.45;
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
    const ctx = await browser.newContext({ ...devices[orient === 'portrait' ? 'iPhone 15' : 'iPhone 15 landscape'], hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${orient}: ${e}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${orient}: ${m.text()}`));
    await page.goto(`http://localhost:${port}/raide/?lang=en&bot=1&speed=4&fps=1`);
    await page.locator('[data-scenario="harju"]').tap();
    await page.waitForFunction(() => window.__sim, null, { timeout: 10000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/start-${orient}.png` });
    // the frame time at play zoom: the renderer reports the mean of 120 frames
    const fps = await page.waitForFunction(() => window.__fps, null, { timeout: 30000 }).then((h) => h.jsonValue());
    console.log(orient, 'frame time at play zoom', JSON.stringify(fps));
    // drawMs is the time spent drawing a frame; frameMs is the gap between frames, which headless
    // Chromium holds near 22 ms whatever the draw costs, so the limit applies to drawMs
    if (fps.drawMs > MAX_FRAME_MS) errors.push(`${orient}: mean draw time ${fps.drawMs} ms is over ${MAX_FRAME_MS} ms`);
    // no train stands on another: every 100 ms no two standing trains share a platform track, and no two vehicles of
    // different trains lie closer than 0.6 tile (the tracks of a station are 0.8 apart, a wagon is 1.4 long)
    await page.evaluate(() => {
      window.__clash = { shared: 0, near: 0, sample: null, seen: 0 };
      setInterval(() => {
        const s = window.__sim; const r = window.__renderer;
        const keys = new Set();
        for (const t of s.trains) if (t.state === 'stop' && t.at !== null) { const k = `${t.at}:${t.slot}`; if (keys.has(k)) window.__clash.shared++; keys.add(k); }
        const veh = s.trains.flatMap((t) => r.vehicles(t).map((v) => ({ t: t.id, x: v.wx, y: v.wy })));
        for (let i = 0; i < veh.length; i++) for (let j = i + 1; j < veh.length; j++) if (veh[i].t !== veh[j].t && Math.hypot(veh[i].x - veh[j].x, veh[i].y - veh[j].y) < 0.6) { window.__clash.near++; window.__clash.sample = [veh[i], veh[j]]; }
        window.__clash.seen += s.trains.length;
      }, 100);
    });
    await page.waitForTimeout(25000);
    const clash = await page.evaluate(() => window.__clash);
    console.log(orient, 'platform check', JSON.stringify(clash));
    if (clash.shared) errors.push(`${orient}: ${clash.shared} samples with two standing trains on one platform track`);
    if (clash.near) errors.push(`${orient}: ${clash.near} samples with two trains' vehicles closer than 0.6 tile ${JSON.stringify(clash.sample)}`);
    await page.evaluate(() => document.querySelectorAll('.round.close').forEach((b) => b.click()));
    // a view: zoom steps, wait for the zoom to settle, centre on a tile, wait for the pan, shoot,
    // then check that each running train sits on its rails
    const go = async (name, x, y, steps) => {
      await page.evaluate((steps) => { const r = window.__renderer; r.follow(null); for (const st of steps) { if (st > 1 || st === 0) r.zoomTo = st || r.wholeScale(); else r.zoomStep(st); } }, steps);
      await page.waitForFunction(() => window.__renderer.zoomTo === null, null, { timeout: 10000 });
      await page.evaluate(([x, y]) => { const r = window.__renderer; const p = r.project(x, y); r.pan(innerWidth / 2 - p.x, innerHeight / 2 - p.y); }, [x, y]);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/${name}-${orient}.png` });
      // every vehicle, running or standing, sits within 0.45 tile of its line's centre line or of a
      // platform track of a station at either end of the line
      const bad = await page.evaluate((maxOff) => {
        const s = window.__sim; const r = window.__renderer;
        if (r.cam.s < 20) return [];
        const out = [];
        for (const t of s.trains) {
          const l = s.lines.find((o) => o.id === t.lineId);
          const pts = l.path.map((c) => [(c % s.w) + 0.5, Math.floor(c / s.w) + 0.5]);
          const aprons = [l.path[0], l.path[l.path.length - 1]].map((c) => r.aprons.find((a) => a.cell === c)).filter(Boolean);
          for (const v of r.vehicles(t)) {
            let best = Infinity;
            for (let k = 1; k < pts.length; k++) {
              const [ax, ay] = pts[k - 1]; const [bx, by] = pts[k];
              const dx = bx - ax; const dy = by - ay;
              const u = Math.max(0, Math.min(1, ((v.wx - ax) * dx + (v.wy - ay) * dy) / (dx * dx + dy * dy || 1)));
              best = Math.min(best, Math.hypot(ax + dx * u - v.wx, ay + dy * u - v.wy));
            }
            for (const a of aprons) if (Math.abs(v.wx - a.x - 0.5) < 8) for (let k = 0; k < a.k; k++) best = Math.min(best, Math.abs(v.wy - (a.y + 0.5 + r.platformY(a, k, v.wx))));
            if (best > maxOff) out.push(`train ${t.id} vehicle ${v.i} is ${best.toFixed(2)} tiles off its rails ` + JSON.stringify({ state: t.state, at: t.at, slot: t.slot, slotFrom: t.slotFrom, dir: t.dir, s: t.s, wx: v.wx, wy: v.wy, line: l.stops, apr: aprons.map((a) => [a.x, a.y, a.k]) }));
          }
        }
        return out;
      }, MAX_OFF_TILES);
      for (const b of bad) errors.push(`${orient} ${name}: ${b}`);
      if (bad.length) await page.screenshot({ path: `${OUT}/FAIL-${name}-${orient}.png` });
    };
    await go('hill', 54, 35, [1]);
    await go('junction', 36, 34, []);
    await go('station-close', 36.5, 33.6, [1]);
    await go('bridge', 46, 34, [-1]);
    await go('ridge', 92, 38, []);
    await go('whole', 60, 45, [-1, -1, -1]);
    // the sky (a step above 1 is a scale in px a tile, 0 is the whole map): route zoom has the first faint clouds, play zoom none, the whole map the most; a pick
    // (the same fade as a held drag) halves them so routes and targets read
    await go('clouds-route', 60, 45, [12]);
    await go('clouds-play', 36, 34, [23]);
    await go('clouds-whole', 60, 45, [0]);
    await page.evaluate(() => { const r = window.__renderer; r.laying = { from: window.__sim.stations[0].cell, reverse: false }; });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/clouds-drag-${orient}.png` });
    await page.evaluate(() => { window.__renderer.laying = null; });
    await go('close', 15, 29, [1, 1, 1, 1]);
    console.log(orient, await page.evaluate(() => JSON.stringify({ lines: window.__sim.lines.length, trains: window.__sim.trains.length, year: window.__sim.year })));
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`${OUT}/`);
