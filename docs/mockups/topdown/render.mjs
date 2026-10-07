// Renders the top-down look test in docs/mockups/topdown/scene.html on an emulated iPhone 15,
// portrait and landscape: `make topdown`. One PNG per screen and orientation into png/, and a
// sheet per orientation with all four.
import { chromium, devices } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'png');
mkdirSync(out, { recursive: true });
const SCREENS = (process.env.SCREEN || 'map,route,station,overview').split(',');
const ORIENTS = process.env.ORIENT ? [process.env.ORIENT] : ['portrait', 'landscape'];

const browser = await chromium.launch();
let failed = false;
for (const orient of ORIENTS) {
  const ctx = await browser.newContext({ ...devices[orient === 'landscape' ? 'iPhone 15 landscape' : 'iPhone 15'], deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const [i, screen] of SCREENS.entries()) {
    await page.goto(`file://${join(here, 'scene.html')}?screen=${screen}&orient=${orient}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 }).catch(() => {});
    const file = join(out, `${String(i + 1).padStart(2, '0')}-${screen}-${orient}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
  if (errors.length) { console.error(errors.join('\n')); failed = true; }
  await ctx.close();
}
// one sheet per orientation, the four screens side by side, for sending to a phone
if (SCREENS.length === 4) for (const orient of ORIENTS) {
  const page = await browser.newPage({ viewport: orient === 'portrait' ? { width: 1660, height: 900 } : { width: 1760, height: 860 }, deviceScaleFactor: 1 });
  const imgs = SCREENS.map((sc, i) => `<img src="data:image/png;base64,${readFileSync(join(out, `${String(i + 1).padStart(2, '0')}-${sc}-${orient}.png`)).toString('base64')}">`).join('');
  const grid = orient === 'portrait' ? 'grid-template-columns:repeat(4,1fr)' : 'grid-template-columns:repeat(2,1fr)';
  await page.setContent(`<body style="margin:0;background:#1b2a1e;display:grid;${grid};gap:14px;padding:14px">${imgs}<style>img{width:100%;border-radius:18px;display:block}</style></body>`);
  await page.waitForLoadState('load');
  await page.screenshot({ path: join(out, `sheet-${orient}.png`), fullPage: true });
  console.log(join(out, `sheet-${orient}.png`));
  await page.close();
}
await browser.close();
if (failed) process.exit(1);
