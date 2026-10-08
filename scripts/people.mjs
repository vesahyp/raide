// The travellers check: the pictures of economy step 5, on Harju in portrait and landscape, into shots/people/.
//   platform     a town's platform close up: travellers waiting on it, the mail sacks at its east end, the person chip on the label
//   arrival      a coach train at a town unloading, with the pay float over the station
//   town-card    the town card: travellers and mail waiting per destination, how many arrived, what the town wants
//   buy-card     the buy card of the town-to-town line: a coach and a mail van in the consist, what they carry
//   ledger       the year-end card with the travellers and mail rows of the income bars
// It fails when the label has no person chip, the town card has no row per destination, the buy card cannot
// add a coach or a van or does not say what they carry, or the ledger lacks the two rows.
// Run `make people` (builds first), then look at the pictures.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

const OUT = 'shots/people';
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
    // the scene: the boards lines to both towns and the line between them, two towns of size 2 with people waiting
    await page.evaluate(() => {
      const s = window.__sim; const act = window.__act;
      s.cash = 9999;
      for (const t of s.sites.filter((x) => x.kind === 'town')) t.size = 2;
      const cell = (id) => { const o = s.sites.find((x) => x.id === id); return o.cy * s.w + o.cx; };
      for (const [a, b] of [['forest', 'sawmill'], ['sawmill', 'hameenlinna'], ['sawmill', 'tampere'], ['tampere', 'hameenlinna']]) act.build(act.plan(cell(a), cell(b)).find((r) => r.mode === 'short') ?? act.plan(cell(a), cell(b))[0]);
      const ham = s.sites.find((x) => x.id === 'hameenlinna'); const tam = s.sites.find((x) => x.id === 'tampere');
      ham.pax.tampere = 4; ham.mail.tampere = 3; tam.pax.hameenlinna = 3; tam.mail.hameenlinna = 2;
      ham.arrived = 2; ham.lastArrival = s.time;
    });
    const view = async (x, y, scale) => {
      await page.evaluate(([x, y, scale]) => { const r = window.__renderer; r.follow(null); r.setScale(scale); r.cam.x = x; r.cam.y = y; r.clampCam?.(); }, [x, y, scale]);
      await page.waitForTimeout(700);
    };
    const site = (id) => page.evaluate((id) => { const o = window.__sim.sites.find((x) => x.id === id); return { x: o.cx + 0.5, y: o.cy + 0.5 }; }, id);
    const closeCards = async () => { while (await page.locator('.round.close').count()) { await page.locator('.round.close').first().tap(); await page.waitForTimeout(250); } };

    // 1. Hämeenlinna's platform close up: people on it, sacks at its east end, the person chip on the label
    const hl = await site('hameenlinna');
    await view(hl.x + 0.5, hl.y - 1.6, 34);
    await shot('platform');
    const chip = await page.evaluate(() => { const c = document.querySelector('.site-tag .chip.folk b'); return c ? c.textContent : null; });
    if (chip === null) errors.push(`${orient}: a town with a station has no person chip on its label`);
    else if (Number(chip) < 1) errors.push(`${orient}: the person chip does not count the waiting travellers (${chip})`);
    // play zoom too: the crowd must still read from the usual distance
    await view(hl.x + 0.5, hl.y - 2.2, 22);
    await shot('platform-play');

    // 2. a coach train on the line between the two towns, unloading at Tampere with its pay float
    await page.evaluate(() => {
      const s = window.__sim; const act = window.__act;
      const line = s.lines.find((l) => l.stops.length === 2 && l.stops.every((id) => { const st = s.stations.find((x) => x.id === id); return st.siteId === 'tampere' || st.siteId === 'hameenlinna'; }));
      act.buyTrain(line.id, ['coach', 'coach', 'mailvan'], 'hilma');
    });
    await page.waitForFunction(() => { const t = window.__sim.trains.find((x) => x.wagons.includes('coach')); return t && t.state === 'stop' && t.dock === 'unload'; }, null, { timeout: 110000, polling: 40 }).catch(() => errors.push(`${orient}: the coach train never unloaded`));
    const tr = await page.evaluate(() => { const t = window.__sim.trains.find((x) => x.wagons.includes('coach')); const st = window.__sim.stations.find((x) => x.cell === t.at); return st ? st.siteId : null; });
    if (tr) {
      const c = await site(tr);
      await view(c.x, c.y - 0.4, 30);
    }
    await page.waitForFunction(() => window.__sim.floats.some((f) => f.kind === 'pay' && /^\+\d/.test(f.text)), null, { timeout: 20000, polling: 30 }).catch(() => errors.push(`${orient}: no pay float for the travellers`));
    await shot('arrival');

    // 3. the town card of Tampere: tap its label
    await page.evaluate(() => { window.__sim.trains.length = 0; const t = window.__sim.sites.find((x) => x.id === 'tampere'); t.pax.hameenlinna = 3; t.mail.hameenlinna = 2; t.arrived = 4; });
    const tp = await site('tampere');
    await view(tp.x + 0.5, tp.y - 2, 22);
    const box = await page.locator('.site-tag', { hasText: 'Tampere' }).first().boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    await page.evaluate(() => { const t = window.__sim.sites.find((x) => x.id === 'tampere'); t.arrived = 4; t.lastArrival = window.__sim.time; });
    await page.waitForTimeout(150);
    if (!(await page.locator('.site-card [data-sec="folk"] [data-dest="hameenlinna"]').count())) errors.push(`${orient}: the town card has no row for the travellers bound for Hämeenlinna`);
    const arrivedText = await page.locator('.site-card [data-sec="arrived"]').textContent().catch(() => '');
    if (!/4 arrived this month/.test(arrivedText ?? '')) errors.push(`${orient}: the town card does not say how many travellers arrived (${arrivedText})`);
    await page.evaluate(() => { const c = document.querySelector('.site-card'); const t = document.querySelector('[data-sec="folk"]'); if (c && t) c.scrollTop = Math.max(0, t.offsetTop - 80); });
    await page.waitForTimeout(300);
    await shot('town-card');
    await closeCards();

    // 4. the buy card of the line between the towns, a tap on its track
    const mid = await page.evaluate(() => {
      const s = window.__sim; const l = s.lines.find((o) => o.stops.length === 2 && o.stops.every((id) => { const st = s.stations.find((x) => x.id === id); return st.siteId === 'tampere' || st.siteId === 'hameenlinna'; }));
      const c = l.path[Math.floor(l.path.length / 2)];
      return { x: (c % s.w) + 0.5, y: Math.floor(c / s.w) + 0.5 };
    });
    await view(mid.x, mid.y - 2, 22);
    const p = await page.evaluate(([x, y]) => window.__renderer.project(x, y, 0), [mid.x, mid.y]);
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForTimeout(500);
    if (!(await page.locator('.buy-card').count())) errors.push(`${orient}: a tap on the line between the towns did not open its card`);
    else {
      const types = await page.locator('[data-sec="consist"] [data-consist]').evaluateAll((els) => els.map((e) => e.dataset.type));
      if (types.join() !== 'coach,coach,mailvan') errors.push(`${orient}: the buy card starts with ${types.join(' ')}, not two coaches and a mail van`);
      for (const w of ['coach', 'mailvan']) if (!(await page.locator(`.buy-card [data-add="${w}"]`).count())) errors.push(`${orient}: the buy card offers no ${w}`);
      const says = await page.locator('.buy-card [data-wagon="coach"] [data-carries="some"]').textContent().catch(() => '');
      if (!/travellers/.test(says ?? '') || !/↔/.test(says ?? '')) errors.push(`${orient}: the coach row does not say it carries travellers between the towns (${says})`);
      await page.evaluate(() => { const c = document.querySelector('.buy-scroll'); const t = document.querySelector('[data-sec="consist"]'); if (c && t) c.scrollTop = t.offsetTop - 30; });
      await page.waitForTimeout(300);
      await shot('buy-card');
    }
    await closeCards();

    // 5. the year-end ledger with travellers and mail income
    await page.evaluate(() => { const s = window.__sim; s.income.pax = 138; s.income.mail = 84; s.income.boards = 310; s.income.flour = 120; s.yearFrac = 0.99995; });
    await page.waitForSelector('.card.ledger', { timeout: 15000 }).catch(() => errors.push(`${orient}: the year-end card did not open`));
    await page.waitForTimeout(500);
    const rows = await page.locator('.chart.income g').count();
    if (rows < 6) errors.push(`${orient}: the income bars have ${rows} rows, not goods and travellers and mail`);
    await shot('ledger');
    console.log(orient, 'done');
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
console.log('people ok: shots/people/');
