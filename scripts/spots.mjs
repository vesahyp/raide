// The spots check: the bot plays Harju at ?speed=4 on an emulated iPhone, and the script takes the
// views where a drawing error shows: the hill, the junction at Koskensaha, the bridge, the ridge, the
// whole map and a close up at Kuusikko, in portrait and landscape, into shots/spots/. It also
// checks that every running train sits on its rails (a vehicle further than 0.45 tile from the
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
    await page.waitForTimeout(25000);
    await page.evaluate(() => document.querySelectorAll('.round.close').forEach((b) => b.click()));
    // a view: zoom steps, wait for the zoom to settle, centre on a tile, wait for the pan, shoot,
    // then check that each running train sits on its rails
    const go = async (name, x, y, steps) => {
      await page.evaluate((steps) => { const r = window.__renderer; r.follow(null); for (const st of steps) r.zoomStep(st); }, steps);
      await page.waitForFunction(() => window.__renderer.zoomTo === null, null, { timeout: 10000 });
      await page.evaluate(([x, y]) => { const r = window.__renderer; const p = r.project(x, y); r.pan(innerWidth / 2 - p.x, innerHeight / 2 - p.y); }, [x, y]);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/${name}-${orient}.png` });
      const bad = await page.evaluate((maxOff) => {
        const s = window.__sim; const r = window.__renderer; const S = r.cam.s;
        if (S < 20) return [];
        const out = [];
        for (const t of s.trains) {
          if (t.state !== 'run') continue;
          const l = s.lines.find((o) => o.id === t.lineId);
          const end = l.dist[l.dist.length - 1];
          const pts = l.path.map((c, k) => [r.sx((c % s.w) + 0.5), r.sy(Math.floor(c / s.w) + 0.5, l.rail[k] / 10)]);
          for (const v of r.vehicles(t)) {
            let best = Infinity;
            for (let k = 1; k < pts.length; k++) {
              const [ax, ay] = pts[k - 1]; const [bx, by] = pts[k];
              const dx = bx - ax; const dy = by - ay;
              const u = Math.max(0, Math.min(1, ((v.px - ax) * dx + (v.py - ay) * dy) / (dx * dx + dy * dy || 1)));
              best = Math.min(best, Math.hypot(ax + dx * u - v.px, ay + dy * u - v.py));
            }
            if (best / S > maxOff && t.s > 3 && t.s < end - 3) out.push(`train ${t.id} vehicle ${v.i} is ${(best / S).toFixed(2)} tiles off its track`);
          }
        }
        return out;
      }, MAX_OFF_TILES);
      for (const b of bad) errors.push(`${orient} ${name}: ${b}`);
    };
    await go('hill', 54, 35, [1]);
    await go('junction', 36, 34, []);
    await go('bridge', 46, 34, [-1]);
    await go('ridge', 92, 38, []);
    await go('whole', 60, 45, [-1, -1, -1]);
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
