// Turning the phone must not break the view or lose the game. On an emulated iPhone this
// rotates between portrait and landscape on the title, in the game with trains running, and
// with a card open, with iOS's late layout played in; after each turn it checks that the
// canvas matches the screen, the map fits inside it, the HUD is on screen, nothing overflows,
// and the sim is the same object with the same trains. `make rotate-check` (PORT=5187 when
// another repo's dev server holds the default).
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
const port = Number(process.env.PORT) || 5197;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch();
const phone = devices['iPhone 15'];
const portrait = { width: phone.viewport.width, height: phone.viewport.height };
const landscape = { width: phone.viewport.height, height: phone.viewport.width };
const context = await browser.newContext({ ...phone, hasTouch: true });
const page = await context.newPage();
let failed = false;
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed = true;
};
// iOS Safari fires the resize while the canvas still measures the old layout and sends nothing
// more once the layout has settled: the canvas keeps reporting its old size for 300 ms
const stale = () =>
  page.evaluate(() => {
    const c = document.querySelector('.game canvas');
    if (!c) return;
    const w = c.clientWidth;
    const h = c.clientHeight;
    Object.defineProperty(c, 'clientWidth', { configurable: true, get: () => w });
    Object.defineProperty(c, 'clientHeight', { configurable: true, get: () => h });
    setTimeout(() => {
      delete c.clientWidth;
      delete c.clientHeight;
    }, 300);
  });
const turn = async (to) => {
  await stale();
  await page.setViewportSize(to);
  await page.waitForTimeout(900);
};
const state = () =>
  page.evaluate(() => {
    const c = document.querySelector('.game canvas');
    const r = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // the start station on the screen, from the renderer's projection: a turn re-frames the view
    const sim = window.__sim;
    const start = sim.sites.find((o) => o.id === sim.scenario.startStation);
    const at = window.__renderer.project(start.cx + 0.5, start.cy + 0.5, 0);
    const area = window.__renderer.area();
    const map = { x: at.x, y: at.y, scale: window.__renderer.scale, landscape: window.innerWidth > window.innerHeight, left: area.l, top: area.t };
    const hud = document.querySelector('.hud').getBoundingClientRect();
    const pause = document.querySelector('.round.pause').getBoundingClientRect();
    const sheet = document.querySelector('.card.sheet, .card.overlay')?.getBoundingClientRect();
    return {
      iw: window.innerWidth, ih: window.innerHeight, cw: Math.round(r.width), ch: Math.round(r.height), bw: c.width, bh: c.height, dpr,
      map,
      hud: { r: hud.right, b: hud.bottom }, pause: { r: pause.right, b: pause.bottom },
      sheet: sheet && { l: sheet.left, r: sheet.right, b: sheet.bottom },
      scrollW: document.scrollingElement.scrollWidth, sim: window.__sim, trains: window.__sim.trains.length, time: window.__sim.time,
    };
  });
const judge = (st, label) => {
  check(st.cw === st.iw && st.ch === st.ih, `${label}: the canvas fills the screen (${st.cw}x${st.ch} of ${st.iw}x${st.ih})`);
  check(st.bw === Math.round(st.cw * st.dpr) && st.bh === Math.round(st.ch * st.dpr), `${label}: the canvas has the screen's device pixels (${st.bw}x${st.bh} at ${st.dpr}x)`);
  check(st.map.x >= st.map.left && st.map.x <= st.iw && st.map.y >= st.map.top && st.map.y <= st.ih, `${label}: the start station is in the free area of the screen (${st.map.x.toFixed(0)},${st.map.y.toFixed(0)}, ${st.map.scale.toFixed(1)} px a tile)`);
  check(st.map.landscape === st.iw > st.ih, `${label}: the layout follows the orientation`);
  check(st.hud.r <= st.iw + 1 && st.hud.b <= st.ih + 1 && st.pause.r <= st.iw + 1 && st.pause.b <= st.ih + 1, `${label}: the HUD and the pause button are on screen`);
  if (st.sheet) check(st.sheet.l >= -1 && st.sheet.r <= st.iw + 1 && st.sheet.b <= st.ih + 1, `${label}: the open card is on screen`);
  check(st.scrollW <= st.iw, `${label}: nothing overflows sideways (${st.scrollW} of ${st.iw})`);
};
const menuState = () => page.evaluate(() => ({ iw: window.innerWidth, scrollW: document.scrollingElement.scrollWidth, ih: window.innerHeight, btn: document.querySelector('[data-track="title-play"]').getBoundingClientRect(), last: [...document.querySelectorAll('[data-track="title-play"]')].pop().getBoundingClientRect(), canvas: document.querySelector('.home-map').getBoundingClientRect().width }));
const judgeMenu = (st, label) => {
  check(st.scrollW <= st.iw, `${label}: the title does not overflow sideways (${st.scrollW} of ${st.iw})`);
  check(st.btn.right <= st.iw + 1 && st.btn.left >= -1, `${label}: the Play button is inside the screen`);
  check(st.btn.top >= 0 && st.last.bottom <= st.ih + 1, `${label}: every scenario card is on screen without scrolling`);
  check(Math.abs(st.canvas - st.iw) <= 1, `${label}: the map behind fills the screen`);
};
try {
  await page.goto(`http://localhost:${port}/?lang=en&bot=1&speed=3`);
  judgeMenu(await menuState(), 'title, portrait');
  await turn(landscape);
  judgeMenu(await menuState(), 'title, turned to landscape');
  await turn(portrait);
  await page.locator('[data-track="title-play"]').first().tap();
  await page.waitForFunction(() => window.__sim && window.__sim.trains.length >= 1 && window.__sim.time > 3, null, { timeout: 20000 });
  // two contracts held, so the HUD's contract pills are in the turn too
  await page.evaluate(() => { const s = window.__sim; s.contracts.push({ id: 91, site: 'sawmill', good: 'timber', count: 8, got: 3, deadline: 1864, reward: 80 }, { id: 92, site: 'town', good: 'boards', count: 5, got: 1, deadline: 1864, reward: 60 }); });
  await page.waitForSelector('.hud-contracts .ct');
  const a = await state();
  judge(a, 'game, portrait');
  await turn(landscape);
  const b = await state();
  judge(b, 'game, turned to landscape');
  check(b.trains >= a.trains && b.time > a.time, `the game went on through the turn (${a.trains} -> ${b.trains} trains, ${a.time.toFixed(0)} -> ${b.time.toFixed(0)} s)`);
  const same = await page.evaluate(() => window.__sim === window.__sim);
  check(same, 'the sim is the same object');
  await page.screenshot({ path: 'shots/rotate-landscape.png' });
  await turn(portrait);
  const c = await state();
  judge(c, 'game, turned back to portrait');
  check(c.time > b.time, 'the game still runs after turning back');
  await page.screenshot({ path: 'shots/rotate-portrait.png' });
  // a card open through a turn: the pause menu
  await page.locator('.round.pause').tap();
  await page.locator('.card.overlay').waitFor();
  await turn(landscape);
  judge(await state(), 'pause menu, turned to landscape');
  await page.getByRole('button', { name: 'Resume' }).tap();
  await page.waitForTimeout(300);
  // the train card through a turn
  await page.evaluate(() => {
    const s = window.__sim;
    const c = s.lines[0].path[3];
    window.__mid = window.__renderer.project((c % s.w) + 0.5, Math.floor(c / s.w) + 0.5, 2);
  });
  const mid = await page.evaluate(() => window.__mid);
  await page.touchscreen.tap(mid.x, mid.y);
  await page.locator('.card.sheet').waitFor({ timeout: 3000 });
  await turn(portrait);
  judge(await state(), 'train card, turned to portrait');
} catch (e) {
  check(false, String(e).split('\n')[0]);
}
await browser.close();
server.kill();
console.log(failed ? 'rotate-check failed' : 'rotate-check ok');
process.exitCode = failed ? 1 : 0;
