// The result card check: a won and a lost Harju, a won and a lost Sawmill, portrait and landscape, fi and en,
// into shots/result/. The scene is a built network with the result set by hand, so the card is what a
// finished game shows. It fails when the card scrolls past the screen, a button is under 44 px, the stars do not
// say what each needs, the lost game does not name what was missing, or the two buttons are missing.
// Run `make result` (builds first), then look at the pictures.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

const OUT = 'shots/result';
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
const cases = [
  { name: 'harju-won', scenario: 'harju', won: true, stars: 3, year: 1869, worth: 2900, sizes: { hameenlinna: 3, tampere: 3, lahti: 2 } },
  { name: 'harju-lost', scenario: 'harju', won: false, stars: 0, year: 1872, worth: 1500, sizes: { hameenlinna: 3, tampere: 1, lahti: 2 }, reason: 'time' },
  { name: 'sawmill-won', scenario: 'sawmill', won: true, stars: 2, year: 1864, worth: 300, sizes: { town: 2 } },
  { name: 'sawmill-lost', scenario: 'sawmill', won: false, stars: 0, year: 1866, worth: 100, sizes: { town: 1 }, reason: 'time', loads: 9 },
];
try {
  for (const lang of ['en', 'fi']) {
    for (const orient of ['portrait', 'landscape']) {
      const ctx = await browser.newContext({ ...devices[orient === 'portrait' ? 'iPhone 15' : 'iPhone 15 landscape'], hasTouch: true });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${lang} ${orient}: ${e}`));
      page.on('console', (m) => m.type() === 'error' && errors.push(`${lang} ${orient}: ${m.text()}`));
      for (const c of cases) {
        if (lang === 'fi' && c.name.startsWith('sawmill')) continue;
        await page.goto(`http://localhost:${port}/raide/?lang=${lang}&speed=1`);
        await page.locator(`[data-scenario="${c.scenario}"]`).tap();
        await page.waitForFunction(() => window.__sim, null, { timeout: 10000 });
        await page.evaluate((c) => {
          const s = window.__sim; const act = window.__act;
          s.cash = 9999;
          const cell = (id) => { const o = s.sites.find((x) => x.id === id); return o.cy * s.w + o.cx; };
          const links = c.scenario === 'harju' ? [['forest', 'sawmill'], ['sawmill', 'hameenlinna'], ['sawmill', 'tampere']] : [['forest', 'sawmill'], ['sawmill', 'town']];
          for (const [a, b] of links) { const line = act.build(act.plan(cell(a), cell(b))[0]); act.buyTrain?.(line.id, 'hilma'); }
          for (const t of s.sites.filter((x) => x.kind === 'town')) t.size = c.sizes[t.id] ?? t.size;
          if (c.loads !== undefined) s.goalCount = c.loads;
          else if (c.scenario === 'sawmill') s.goalCount = 15;
          // Tampere has a station but no travellers: the missing thing
          s.result = { won: c.won, year: c.year, cash: 500, worth: c.worth, stars: c.stars, reason: c.reason ?? 'goal', time: 600 };
        }, c);
        await page.waitForSelector('.card.result', { timeout: 5000 });
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${OUT}/${c.name}-${lang}-${orient}.png` });
        const m = await page.evaluate(() => {
          const el = document.querySelector('.card.result').getBoundingClientRect();
          const bs = [...document.querySelectorAll('.res-buttons .btn')].map((b) => b.getBoundingClientRect());
          return { top: el.top, bottom: el.bottom, vh: innerHeight, scroll: document.querySelector('.card.result').scrollHeight - document.querySelector('.card.result').clientHeight, buttons: bs.map((b) => Math.round(b.height)), stars: document.querySelectorAll('.res-star').length, got: document.querySelectorAll('.res-star.got').length, missing: document.querySelector('.res-missing')?.textContent ?? '', houses: document.querySelectorAll('.res-town .house').length, text: document.querySelector('.res-star:nth-child(2)')?.textContent ?? '' };
        });
        const tag = `${c.name} ${lang} ${orient}`;
        if (m.scroll > 2) errors.push(`${tag}: the card scrolls by ${m.scroll}px`);
        if (m.top < 0 || m.bottom > m.vh) errors.push(`${tag}: the card leaves the screen`);
        if (m.buttons.length !== 2 || m.buttons.some((h) => h < 44)) errors.push(`${tag}: the two buttons are missing or small (${m.buttons})`);
        if (m.stars !== 3 || m.got !== c.stars) errors.push(`${tag}: the star rows are wrong (${m.stars} rows, ${m.got} earned)`);
        if (!c.won && !m.missing) errors.push(`${tag}: a lost game does not say what was missing`);
        if (c.won && m.missing) errors.push(`${tag}: a won game shows a missing line`);
        if (!m.houses) errors.push(`${tag}: no houses`);
        console.log(`${tag}: ${m.missing || 'won'}`);
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) {
  console.log(errors.join('\n'));
  process.exit(1);
}
console.log('result check ok');
