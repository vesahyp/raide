// Phone screenshots of the game, repeatable: the title, the map at the start, the bot playing
// at a few points, the year-end card, the result. `make shots-setup` once, then `make shots`.
// Starts its own dev server on port 5199. `node scripts/shots.mjs en` takes the English set
// into shots/en/; `ORIENT=landscape` turns the phone.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const port = 5199;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const lang = process.argv[2] === 'en' ? 'en' : 'fi';
const landscape = process.env.ORIENT === 'landscape';
const dir = `shots${lang === 'en' ? '/en' : ''}${landscape ? '/landscape' : ''}`;
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices[landscape ? 'iPhone 15 landscape' : 'iPhone 15'], hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = (name) => page.screenshot({ path: `${dir}/${name}.png` });
const at = async (sec, name) => {
  await page.waitForFunction((t) => window.__sim && (window.__sim.time >= t || window.__sim.result), sec, { timeout: 300000 });
  await shot(name);
};
try {
  await page.goto(`http://localhost:${port}/?bot=1&speed=4&lang=${lang}`);
  await shot('01-title');
  await page.locator('[data-track="title-play"]').first().tap();
  await page.waitForFunction(() => window.__sim, null, { timeout: 10000 });
  await shot('02-start');
  await at(8, '03-first-train');
  await at(60, '04-two-lines');
  await at(100, '05-three-trains');
  // the year-end card: the bot answers it, so stop the page and open it by hand
  await page.waitForFunction(() => window.__sim.year >= 1863, null, { timeout: 300000 });
  await shot('06-year-two');
  await page.waitForFunction(() => window.__sim.result, null, { timeout: 300000 });
  await page.waitForTimeout(400);
  await shot('07-result');
} catch (e) {
  console.error(e);
  await shot('error');
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) {
  console.error('page errors:', errors.join('\n'));
  process.exitCode = 1;
} else console.log(`shots in ${dir}/`);
