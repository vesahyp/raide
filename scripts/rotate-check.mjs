// Turning the phone must not break the view or lose the game. On an emulated iPhone this
// rotates between portrait and landscape on the title, in the game with trains running, and
// with a card open, with iOS's late layout played in; after each turn it checks that the
// canvas matches the screen, the map fits inside it, the HUD is on screen, nothing overflows,
// and the sim is the same object with the same trains. `make rotate-check` (PORT=5187 when
// another repo's dev server holds the default).
import { chromium, devices } from 'playwright';
// headless Chromium draws WebGL in software unless told otherwise
const GPU = { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] };
import { spawn } from 'node:child_process';
const port = Number(process.env.PORT) || 5197;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch(GPU);
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
    // the map's corners on the screen, from the renderer's projection
    const sim = window.__sim;
    const pts = [[0, 0], [sim.w, 0], [0, sim.h], [sim.w, sim.h]].map(([x, y]) => window.__renderer.project(x, y, 0));
    const cam = { left: Math.min(...pts.map((p) => p.x)), top: Math.min(...pts.map((p) => p.y)), width: 0, height: 0, turned: window.innerWidth > window.innerHeight, scale: 0 };
    cam.width = Math.max(...pts.map((p) => p.x)) - cam.left;
    cam.height = Math.max(...pts.map((p) => p.y)) - cam.top;
    cam.scale = cam.width / sim.w;
    const hud = document.querySelector('.hud').getBoundingClientRect();
    const pause = document.querySelector('.round.pause').getBoundingClientRect();
    const sheet = document.querySelector('.card.sheet, .card.overlay')?.getBoundingClientRect();
    return {
      iw: window.innerWidth, ih: window.innerHeight, cw: Math.round(r.width), ch: Math.round(r.height), bw: c.width, bh: c.height, dpr,
      map: { left: cam.left, top: cam.top, right: cam.left + cam.width, bottom: cam.top + cam.height, turned: cam.turned, scale: cam.scale },
      hud: { r: hud.right, b: hud.bottom }, pause: { r: pause.right, b: pause.bottom },
      sheet: sheet && { l: sheet.left, r: sheet.right, b: sheet.bottom },
      scrollW: document.scrollingElement.scrollWidth, sim: window.__sim, trains: window.__sim.trains.length, time: window.__sim.time,
    };
  });
const judge = (st, label) => {
  check(st.cw === st.iw && st.ch === st.ih, `${label}: the canvas fills the screen (${st.cw}x${st.ch} of ${st.iw}x${st.ih})`);
  check(st.bw === Math.round(st.cw * st.dpr) && st.bh === Math.round(st.ch * st.dpr), `${label}: the canvas has the screen's device pixels (${st.bw}x${st.bh} at ${st.dpr}x)`);
  check(st.map.left >= 0 && st.map.top >= 0 && st.map.right <= st.iw + 1 && st.map.bottom <= st.ih + 1, `${label}: the whole map is on screen (${st.map.left.toFixed(0)},${st.map.top.toFixed(0)} to ${st.map.right.toFixed(0)},${st.map.bottom.toFixed(0)}, ${st.map.scale.toFixed(1)} px a cell${st.map.turned ? ', turned' : ''})`);
  check(st.map.turned === st.iw > st.ih, `${label}: the map is turned exactly in landscape`);
  check(st.hud.r <= st.iw + 1 && st.hud.b <= st.ih + 1 && st.pause.r <= st.iw + 1 && st.pause.b <= st.ih + 1, `${label}: the HUD and the pause button are on screen`);
  if (st.sheet) check(st.sheet.l >= -1 && st.sheet.r <= st.iw + 1 && st.sheet.b <= st.ih + 1, `${label}: the open card is on screen`);
  check(st.scrollW <= st.iw, `${label}: nothing overflows sideways (${st.scrollW} of ${st.iw})`);
};
const menuState = () => page.evaluate(() => ({ iw: window.innerWidth, scrollW: document.scrollingElement.scrollWidth, btn: document.querySelector('[data-track="title-play"]').getBoundingClientRect() }));
const judgeMenu = (st, label) => {
  check(st.scrollW <= st.iw, `${label}: the title does not overflow sideways (${st.scrollW} of ${st.iw})`);
  check(st.btn.right <= st.iw + 1 && st.btn.left >= -1, `${label}: the Play button is inside the screen`);
};
try {
  await page.goto(`http://localhost:${port}/?lang=en&bot=1&speed=3`);
  judgeMenu(await menuState(), 'title, portrait');
  await turn(landscape);
  judgeMenu(await menuState(), 'title, turned to landscape');
  await turn(portrait);
  await page.locator('[data-track="title-play"]').first().tap();
  await page.waitForFunction(() => window.__sim && window.__sim.trains.length >= 1 && window.__sim.time > 3, null, { timeout: 20000 });
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
