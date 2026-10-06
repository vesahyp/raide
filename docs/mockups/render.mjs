// Renders the static mockups in docs/mockups/mockups.html to PNG on an emulated iPhone 15,
// portrait and landscape: `make mockups`. One PNG per screen and orientation into
// docs/mockups/png/. The page is static HTML, SVG and one canvas; nothing from src/ is used.
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'png');
mkdirSync(out, { recursive: true });
const SCREENS = ['map', 'route', 'train', 'site', 'ledger', 'network'];
const ORIENTS = process.env.ORIENT ? [process.env.ORIENT] : ['portrait', 'landscape'];

const browser = await chromium.launch();
for (const orient of ORIENTS) {
  const ctx = await browser.newContext({ ...devices[orient === 'landscape' ? 'iPhone 15 landscape' : 'iPhone 15'], hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const [i, screen] of SCREENS.entries()) {
    await page.goto(`file://${join(here, 'mockups.html')}?screen=${screen}&orient=${orient}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
    const file = join(out, `${String(i + 1).padStart(2, '0')}-${screen}-${orient}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  await ctx.close();
}
await browser.close();
