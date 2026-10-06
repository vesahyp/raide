// Renders the three.js scene in docs/mockups/3d/scene.html on an emulated iPhone 15, portrait and
// landscape, for each camera take: `make scene3d`. Serves the repo root over http so the page can
// import three from node_modules (module scripts do not load over file://). Headless Chromium draws
// WebGL in software unless told otherwise; the GPU flags are sora's (scripts/gpu.mjs there).
import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const out = join(here, 'png');
mkdirSync(out, { recursive: true });
const TAKES = (process.env.TAKE ? [process.env.TAKE] : ['iso', 'close']);
const ORIENTS = process.env.ORIENT ? [process.env.ORIENT] : ['portrait', 'landscape'];
const GPU = { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = createServer((req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!path.startsWith(root) || !existsSync(path) || statSync(path).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
  createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch(GPU);
let failed = false;
for (const orient of ORIENTS) {
  const ctx = await browser.newContext({ ...devices[orient === 'landscape' ? 'iPhone 15 landscape' : 'iPhone 15'], hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  for (const take of TAKES) {
    await page.goto(`http://localhost:${port}/docs/mockups/3d/scene.html?take=${take}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
    const file = join(out, `${take}-${orient}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
  if (errors.length) { console.error(errors.join('\n')); failed = true; }
  await ctx.close();
}
await browser.close();
server.close();
if (failed) process.exit(1);
