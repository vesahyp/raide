// The buy sheet check: the line card of Kuusikko-Koskensaha on iPhone 16, portrait and landscape, Finnish and English,
// with no trains and with a train on the line, into shots/buysheet/. It fails when
//   - the Buy footer overlaps the scroll area above it (the footer must cover nothing),
//   - the footer lacks the trips a year under the price,
//   - the line's own business is not above "Buy a train", or the siding row is a button-shaped thing that cannot be used,
//   - the train strip is not the engine slot plus four wagon slots of one height, empty ones dashed,
//   - a wagon type that carries nothing here is not dimmed, shows a price or has an enabled +,
//   - an engine card is wider than its box or its small lines wrap.
// Run `make buy-sheet` (builds first), then look at the pictures.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

const OUT = 'shots/buysheet';
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
  for (const lang of ['fi', 'en'])
    for (const orient of ['portrait', 'landscape']) {
      const tag = `${lang}-${orient}`;
      const ctx = await browser.newContext({ ...devices[orient === 'portrait' ? 'iPhone 16' : 'iPhone 16 landscape'], hasTouch: true });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${tag}: ${e}`));
      await page.goto(`http://localhost:${port}/raide/?lang=${lang}&speed=1`);
      await page.locator('[data-scenario="harju"]').tap();
      await page.waitForFunction(() => window.__sim, null, { timeout: 10000 });
      await page.evaluate(() => {
        const s = window.__sim; const act = window.__act;
        s.cash = 156;
        const cell = (id) => { const o = s.sites.find((x) => x.id === id); return o.cy * s.w + o.cx; };
        act.build(act.plan(cell('forest'), cell('sawmill'))[0]);
        s.cash = 156;
      });
      const open = async () => {
        for (const f of [0.5, 0.35, 0.65, 0.25]) {
          while (await page.locator('.round.close').count()) { await page.locator('.round.close').first().tap(); await page.waitForTimeout(250); }
          const mid = await page.evaluate((f) => { const l = window.__sim.lines[0]; const c = l.path[Math.floor(l.path.length * f)]; return { x: (c % window.__sim.w) + 0.5, y: Math.floor(c / window.__sim.w) + 0.5 }; }, f);
          await page.evaluate(([x, y]) => { const r = window.__renderer; r.follow(null); r.setScale(23); r.cam.x = x + (innerWidth > innerHeight ? 5 : 0); r.cam.y = y - 2; r.clampCam?.(); }, [mid.x, mid.y]);
          await page.waitForTimeout(500);
          const p = await page.evaluate(([x, y]) => window.__renderer.project(x, y, 0), [mid.x, mid.y]);
          await page.touchscreen.tap(p.x, p.y);
          await page.waitForTimeout(600);
          if (await page.locator('.buy-foot').count()) return;
        }
      };
      await open();
      if (!(await page.locator('.buy-card').count())) { errors.push(`${tag}: the line card did not open`); await ctx.close(); continue; }
      const check = async (state) => {
        const m = await page.evaluate(() => {
          const r = (q) => { const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, h: b.height }; };
          const card = r('.buy-card'); const scroll = r('.buy-scroll'); const foot = r('.buy-foot');
          const slots = [...document.querySelectorAll('.strip .wchip')].map((e) => ({ h: Math.round(e.getBoundingClientRect().height), dashed: e.classList.contains('empty'), eng: e.classList.contains('engine-slot') }));
          const eng = [...document.querySelectorAll('.wagon.engine')].map((e) => ({ over: e.scrollWidth > e.clientWidth + 1, lines: [...e.querySelectorAll('small')].map((s) => Math.round(s.getBoundingClientRect().height)) , name: Math.round(e.querySelector('.ename').getBoundingClientRect().height) }));
          const waste = [...document.querySelectorAll('.picker .wagon.row')].map((e) => ({ type: e.dataset.wagon, dim: e.classList.contains('dim'), price: !!e.querySelector('.addcol small'), off: e.querySelector('[data-add]').disabled, nothing: !!e.querySelector('[data-carries="nothing"]') }));
          const biz = r('.line-biz'); const title = r('.buy-title');
          const siding = document.querySelector('.line-biz [data-sec="siding"]');
          return { card, scroll, foot, slots, eng, waste, biz, title, sidingButton: !!siding?.querySelector('button'), sidingText: siding?.textContent ?? '', footTrips: document.querySelector('[data-sec="buy-trips"]')?.textContent ?? '', vh: innerHeight, vw: innerWidth, lift: !!document.querySelector('.line-biz [data-act="lift"]') };
        });
        const w = `${tag} ${state}`;
        if (m.foot.t < m.scroll.b - 1) errors.push(`${w}: the footer (${m.foot.t}) covers the scroll area (ends ${m.scroll.b})`);
        if (m.card.b > m.vh + 1 || m.card.r > m.vw + 1) errors.push(`${w}: the card runs off the screen`);
        if (!m.footTrips) errors.push(`${w}: no trips a year under the Buy price`);
        if (!(m.biz.b <= m.title.t + 1)) errors.push(`${w}: the line's business is not above "Buy a train"`);
        if (m.sidingButton && /ei|needs|not enough|tarvitsee/.test(m.sidingText)) errors.push(`${w}: the siding has a button and says it cannot be done (${m.sidingText})`);
        if (!m.sidingButton && !/ohitus|siding/i.test(m.sidingText)) errors.push(`${w}: no siding line`);
        if (m.slots.length !== 5 || !m.slots[0].eng || new Set(m.slots.map((x) => x.h)).size !== 1) errors.push(`${w}: the strip is not an engine slot and four wagon slots of one height (${JSON.stringify(m.slots)})`);
        if (!m.slots.some((x) => x.dashed)) errors.push(`${w}: no empty slot is dashed`);
        for (const x of m.waste) if (x.nothing && (!x.dim || x.price || !x.off)) errors.push(`${w}: ${x.type} carries nothing but is not dimmed, priceless and disabled (${JSON.stringify(x)})`);
        for (const e of m.eng) if (e.over || e.lines.some((h) => h > 18) || e.name > 22) errors.push(`${w}: an engine card wraps (${JSON.stringify(e)})`);
        return m;
      };
      await page.screenshot({ path: `${OUT}/${tag}-top.png` });
      if (!(await page.locator('.buy-foot').count())) { errors.push(`${tag}: no buy footer, the card is ${await page.evaluate(() => document.querySelector('.card')?.className)}`); await ctx.close(); continue; }
      await check('no trains');
      await page.evaluate(() => { const c = document.querySelector('.buy-scroll'); c.scrollTop = c.scrollHeight; });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${tag}-bottom.png` });
      await page.locator('.buy-scroll').evaluate((c) => (c.scrollTop = 0));
      // a flat wagon tapped off and a box one on, then buy: the card of a line with a train
      await page.locator('.picker [data-add="box"]').tap().catch(() => {});
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${tag}-added.png` });
      await check('a wagon added');
      await page.evaluate(() => { window.__sim.cash = 500; });
      await page.locator('[data-act="buy"]').tap();
      await page.waitForTimeout(500);
      await page.evaluate(() => { window.__sim.cash = 500; });
      await page.waitForTimeout(100);
      while (await page.locator('.round.close').count()) { await page.locator('.round.close').first().tap(); await page.waitForTimeout(250); }
      await open();
      await page.screenshot({ path: `${OUT}/${tag}-with-train.png` });
      if (!(await page.locator('.buy-foot').count())) { errors.push(`${tag}: the line card with a train did not open`); await ctx.close(); continue; }
      await check('with a train');
      console.log(tag, 'done');
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
console.log('buy-sheet ok: shots/buysheet/');
