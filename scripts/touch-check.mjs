// The controls by real touches on an emulated phone: a drag from the forest station to the
// sawmill builds the line and opens the train card, Cancel under the thumb takes it back and
// refunds, the same drag again builds, Buy puts a train on the line, a tap on the track opens
// the card again, a drag from a site with no station builds nothing, and the pause menu opens
// and closes. `make touch-check` (PORT=5187 when another repo's dev server holds the default).
import { chromium, devices } from 'playwright';
// headless Chromium draws WebGL in software unless told otherwise
const GPU = { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] };
import { spawn } from 'node:child_process';

const port = Number(process.env.PORT) || 5197;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch(GPU);
const context = await browser.newContext({ ...devices['iPhone 15'], hasTouch: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
let failed = false;
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed = true;
};
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
const tap = async (x, y) => {
  await touch('touchStart', [{ x, y, id: 1 }]);
  await page.waitForTimeout(60);
  await touch('touchEnd', []);
};
const tapButton = async (locator) => {
  const b = await locator.boundingBox();
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
const where = () =>
  page.evaluate(() => {
    const s = window.__sim;
    const toS = (x, y) => window.__renderer.project(x, y, 2);
    const out = {};
    for (const site of s.sites) out[site.id] = toS(site.cx + 0.5, site.cy + 0.5);
    out.cash = s.cash;
    out.lines = s.lines.length;
    out.trains = s.trains.length;
    out.stations = s.stations.length;
    return out;
  });
try {
  await page.goto(`http://localhost:${port}/?lang=en`);
  await tapButton(page.locator('[data-track="title-play"]').first());
  await page.waitForFunction(() => window.__sim && window.__renderer, null, { timeout: 10000 });
  await page.waitForTimeout(400);
  let w = await where();
  const cash0 = w.cash;
  // a drag from a site with no station builds nothing
  await drag(w.sawmill, w.town);
  await page.waitForTimeout(200);
  w = await where();
  check(w.lines === 0 && w.cash === cash0, 'a drag from a site with no station builds nothing');
  // a drag that lifts in the forest between the sites builds nothing, though the track showed under the finger
  const between = { x: w.forest.x + 120, y: w.forest.y + 40 };
  await touch('touchStart', [{ x: w.forest.x, y: w.forest.y, id: 1 }]);
  for (let i = 1; i <= 8; i++) {
    await page.waitForTimeout(25);
    await touch('touchMove', [{ x: w.forest.x + ((between.x - w.forest.x) * i) / 8, y: w.forest.y + ((between.y - w.forest.y) * i) / 8, id: 1 }]);
  }
  const loose = await page.evaluate(() => window.__input.drag && window.__input.drag.route && { loose: window.__input.drag.loose, cells: window.__input.drag.route.cells.length });
  await touch('touchEnd', []);
  await page.waitForTimeout(200);
  w = await where();
  check(!!loose && loose.loose && loose.cells > 3 && w.lines === 0 && w.cash === cash0, `the track follows the finger and a lift off any site builds nothing (${JSON.stringify(loose)})`);
  // the first line, with the cost shown while the finger moves
  await touch('touchStart', [{ x: w.forest.x, y: w.forest.y, id: 1 }]);
  for (let i = 1; i <= 12; i++) {
    await page.waitForTimeout(25);
    await touch('touchMove', [{ x: w.forest.x + ((w.sawmill.x - w.forest.x) * i) / 12, y: w.forest.y + ((w.sawmill.y - w.forest.y) * i) / 12, id: 1 }]);
  }
  const live = await page.evaluate(() => window.__input.drag && window.__input.drag.route && { cost: window.__input.drag.route.cost, cells: window.__input.drag.route.cells.length, ok: window.__input.drag.ok });
  check(!!live && live.cost > 0 && live.ok, `the route and its cost follow the finger (${JSON.stringify(live)})`);
  await page.waitForTimeout(120);
  await touch('touchEnd', []);
  await page.waitForTimeout(250);
  w = await where();
  check(w.lines === 1 && w.stations === 2 && w.cash === cash0 - live.cost, `lifting the finger builds the line and the station (cash ${cash0} -> ${w.cash})`);
  check((await page.locator('.card.sheet').count()) === 1, 'the train card slides up after the build');
  // Cancel under the thumb
  const cancel = page.locator('.btn.cancel');
  check((await cancel.count()) === 1, 'a Cancel button is under the thumb');
  await tapButton(cancel);
  await page.waitForTimeout(200);
  w = await where();
  check(w.lines === 0 && w.stations === 1 && w.cash === cash0, `Cancel takes the build back and refunds (cash ${w.cash})`);
  check((await page.locator('.card.sheet').count()) === 0, 'Cancel closes the train card');
  // build again, buy the train
  await drag(w.forest, w.sawmill);
  await page.waitForTimeout(250);
  await page.locator('.card.sheet').waitFor({ timeout: 3000 });
  const flatOn = await page.locator('.wagon').first().evaluate((el) => el.classList.contains('on'));
  check(flatOn, 'the card offers flat wagons for a line from the forest');
  await tapButton(page.locator('[data-track="card-buy-train"]'));
  await page.waitForTimeout(250);
  w = await where();
  check(w.trains === 1, 'Buy puts a train on the line');
  check((await page.locator('.card.sheet').count()) === 0, 'the card closes after the buy');
  await page.waitForFunction(() => window.__sim.trains[0].state === 'run', null, { timeout: 5000 });
  check(true, 'the train leaves at once');
  // a tap on the track opens the card again
  const mid = await page.evaluate(() => {
    const s = window.__sim;
    const c = s.lines[0].path[3];
    return window.__renderer.project((c % s.w) + 0.5, Math.floor(c / s.w) + 0.5, 2);
  });
  await tap(mid.x, mid.y);
  await page.waitForTimeout(250);
  check((await page.locator('.card.sheet').count()) === 1, 'a tap on the track opens the line card');
  await tapButton(page.locator('.round.close'));
  await page.waitForTimeout(200);
  check((await page.locator('.card.sheet').count()) === 0, 'the close button closes it');
  // the pause menu
  await tapButton(page.locator('.round.pause'));
  await page.locator('.card.overlay').waitFor({ timeout: 2000 });
  const t1 = await page.evaluate(() => window.__sim.time);
  await page.waitForTimeout(400);
  const t2 = await page.evaluate(() => window.__sim.time);
  check(t1 === t2, 'the sim holds while the pause menu is open');
  await tapButton(page.getByRole('button', { name: 'Resume' }));
  await page.waitForTimeout(300);
  check((await page.locator('.card.overlay').count()) === 0, 'Resume closes the pause menu');
  await page.screenshot({ path: 'shots/touch-check.png' });
} catch (e) {
  check(false, String(e).split('\n')[0]);
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? 'touch-check failed' : 'touch-check ok');
process.exitCode = failed ? 1 : 0;
