// "Where can I buy a train?" by real touches on an iPhone 16: build a line, close the card without
// buying, then buy a train three ways in turn, each time from a line with no train: the brass
// button on the map, the "Lines here" button on the station's site card, and the tip. Each opens
// the line card at "Buy a train". Pictures go to shots/buy/ (portrait and landscape): the map with
// a pulsing button and one with trains, and the station card. `make buy-check` (PORT=5187 when
// another repo's dev server holds the default).
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const port = Number(process.env.PORT) || 5198;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
mkdirSync('shots/buy', { recursive: true });
const browser = await chromium.launch();
let failed = false;
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed = true;
};

async function run(name, device) {
  const context = await browser.newContext({ ...devices[device], hasTouch: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const tap = async (x, y) => {
    await touch('touchStart', [{ x, y, id: 1 }]);
    await page.waitForTimeout(60);
    await touch('touchEnd', []);
  };
  const tapButton = async (locator) => {
    await locator.waitFor({ timeout: 4000 });
    let b = await locator.boundingBox();
    for (let k = 0; k < 20; k++) {
      await page.waitForTimeout(50);
      const n = await locator.boundingBox();
      if (n && b && Math.abs(n.x - b.x) < 0.5 && Math.abs(n.y - b.y) < 0.5) break;
      b = n;
    }
    await tap(b.x + b.width / 2, b.y + b.height / 2);
  };
  const drag = async (a, b) => {
    await touch('touchStart', [{ x: a.x, y: a.y, id: 1 }]);
    for (let i = 1; i <= 12; i++) {
      await page.waitForTimeout(25);
      await touch('touchMove', [{ x: a.x + ((b.x - a.x) * i) / 12, y: a.y + ((b.y - a.y) * i) / 12, id: 1 }]);
    }
    await page.waitForTimeout(120);
    await touch('touchEnd', []);
  };
  const sites = () => page.evaluate(() => {
    const out = {};
    for (const site of window.__sim.sites) out[site.id] = window.__renderer.project(site.cx + 0.5, site.cy + 0.5, 2);
    return out;
  });
  const trains = () => page.evaluate(() => window.__sim.trains.length);
  // the line card is open and its list starts at the "Buy a train" heading
  const atBuy = async (what) => {
    await page.locator('[data-sec="buy-title"]').waitFor({ timeout: 4000 });
    await page.waitForTimeout(500);
    const top = await page.evaluate(() => {
      const box = document.querySelector('[data-sec="buy-scroll"]').getBoundingClientRect();
      const h = document.querySelector('[data-sec="buy-title"]').getBoundingClientRect();
      return { dy: h.top - box.top, room: document.querySelector('[data-sec="buy-scroll"]').scrollHeight > box.height + 2 };
    });
    check(top.dy < 120 && top.dy > -2, `${name}: ${what} opens the line card at Buy a train (heading ${Math.round(top.dy)} px from the top)`);
  };
  const buy = async (what) => {
    const before = await trains();
    await tapButton(page.locator('[data-track="card-buy-train"]'));
    await page.waitForTimeout(300);
    check((await trains()) === before + 1, `${name}: ${what} bought a train`);
  };
  const sellAll = async () => {
    await page.evaluate(() => { for (const t of [...window.__sim.trains]) window.__act.sellTrain(t.id); window.__sim.cash = 1000; });
    await page.waitForTimeout(300);
  };

  await page.goto(`http://localhost:${port}/?lang=en`);
  await tapButton(page.locator('[data-track="title-play"]').first());
  await page.waitForFunction(() => window.__sim && window.__renderer, null, { timeout: 10000 });
  await page.waitForTimeout(400);
  let w = await sites();
  await drag(w.forest, w.sawmill);
  await page.waitForTimeout(300);
  await page.locator('.card.sheet').waitFor({ timeout: 3000 });
  await tapButton(page.locator('.round.close'));
  await page.waitForTimeout(400);
  check((await trains()) === 0 && (await page.evaluate(() => window.__sim.lines.length)) === 1, `${name}: a line is built and the card closed with no train bought`);

  // 1. the button on the map
  const marks = page.locator('[data-buy-line]');
  const mark = page.locator('[data-buy-line] .bm');
  await mark.first().waitFor({ timeout: 3000 });
  const box = await mark.first().evaluate((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, pulse: el.parentElement.classList.contains('idle') }; });
  check(box.w >= 40 && box.h >= 40 && box.pulse, `${name}: the map button is ${Math.round(box.w)} px and pulses on a line with no train`);
  await page.screenshot({ path: `shots/buy/${name}-idle.png` });
  await tapButton(mark.first());
  await atBuy('the map button');
  await buy('the map button');
  await page.waitForTimeout(500);
  check(!(await marks.first().evaluate((el) => el.classList.contains('idle'))) && (await marks.first().locator('.n').textContent()) === '1', `${name}: with a train the button is calm and shows 1`);
  // a second line without a train, beside the first, so one picture has both
  await page.evaluate(() => {
    const a = window.__act;
    const s = window.__sim;
    s.cash = 1000;
    const st = s.stations[1];
    const town = s.sites.find((o) => o.kind === 'town');
    if (!st || !town) return;
    const r = a.plan(st.cell, town.cy * s.w + town.cx);
    if (r.length) a.build(r[0]);
  });
  await page.waitForTimeout(300);
  const lines = await page.evaluate(() => window.__sim.lines.length);
  if (lines > 1) {
    await page.screenshot({ path: `shots/buy/${name}-both.png` });
    check((await marks.count()) === 2, `${name}: each line has its own button`);
  }
  await page.screenshot({ path: `shots/buy/${name}-trains.png` });

  // 2. the station's site card
  await sellAll();
  w = await sites();
  await tap(w.forest.x, w.forest.y);
  await page.locator('[data-sec="lines-here"]').waitFor({ timeout: 3000 });
  const rows = await page.locator('[data-sec="lines-here"] .lh-row').count();
  check(rows === 1, `${name}: the site card lists the line under Lines here`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `shots/buy/${name}-station.png` });
  await tapButton(page.locator('[data-act="buy-line"]').first());
  await atBuy('the station card');
  await buy('the station card');

  // 3. the tip
  await sellAll();
  const tip = page.locator('[data-tip="idle-line"] [data-act="tip"]');
  await tip.waitFor({ timeout: 15000 });
  await page.screenshot({ path: `shots/buy/${name}-tip.png` });
  check(/has no train/.test(await tip.textContent()), `${name}: the tip says the line has no train`);
  await tapButton(tip);
  await atBuy('the tip');
  await buy('the tip');
  await context.close();
}

try {
  await run('portrait', 'iPhone 16');
  await run('landscape', 'iPhone 16 landscape');
} catch (e) {
  check(false, String(e).split('\n')[0]);
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? 'buy-check failed' : 'buy-check ok');
process.exitCode = failed ? 1 : 0;
