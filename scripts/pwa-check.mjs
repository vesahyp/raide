// Checks that the game installs well: the manifest, every icon at its size,
// the iOS icon, the theme colour, the service worker, and that the title
// screen still opens with the network off. `make pwa-check` against the live
// site, `make pwa-check URL=http://localhost:4173/raide/` against a preview.
import { chromium } from 'playwright';

const url = process.argv[2] || 'https://vesahyp.github.io/raide/';
let failed = false;
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed = true;
};

const browser = await chromium.launch();
const context = await browser.newContext({ serviceWorkers: 'allow' });
const page = await context.newPage();
await page.goto(url, { waitUntil: 'load' });

// the manifest
const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
check(!!manifestHref, `index links a manifest (${manifestHref})`);
const manifestUrl = new URL(manifestHref, page.url()).href;
const mr = await page.request.get(manifestUrl);
check(mr.ok(), `the manifest loads (${mr.status()})`);
const m = await mr.json();
check(m.short_name === 'Raide', `short_name is Raide (${m.short_name})`);
check(m.name === 'Raide', `name is Raide (${m.name})`);
check(['standalone', 'fullscreen'].includes(m.display), `display is an app (${m.display})`);
check(/^#[0-9a-f]{6}$/i.test(m.theme_color) && /^#[0-9a-f]{6}$/i.test(m.background_color), `theme and background colours set (${m.theme_color}, ${m.background_color})`);
check(m.start_url && m.scope, `start_url and scope set (${m.start_url}, ${m.scope})`);
const meta = await page.locator('meta[name="theme-color"]').getAttribute('content');
check(meta === m.theme_color, `the page's theme-color matches the manifest (${meta})`);

// every icon: it loads, it is a PNG or SVG, and the pixels match the declared size
const sizeOf = async (src) =>
  page.evaluate(
    (src) =>
      new Promise((res) => {
        const i = new Image();
        i.onload = () => res([i.naturalWidth, i.naturalHeight]);
        i.onerror = () => res(null);
        i.src = src;
      }),
    src,
  );
const want = new Map();
for (const icon of m.icons || []) {
  const src = new URL(icon.src, manifestUrl).href;
  const r = await page.request.get(src);
  const ct = r.headers()['content-type'] || '';
  const okType = icon.type === 'image/svg+xml' ? ct.includes('svg') : ct.includes('png');
  const px = await sizeOf(src);
  const [w, h] = icon.sizes === 'any' ? [1, 1] : icon.sizes.split('x').map(Number);
  const okSize = icon.sizes === 'any' ? !!px : px && px[0] === w && px[1] === h;
  check(r.ok() && okType && okSize, `icon ${icon.src} ${icon.sizes} ${icon.purpose} loads as ${ct.split(';')[0]}${px ? ` ${px[0]}x${px[1]}` : ''}`);
  for (const p of (icon.purpose || 'any').split(' ')) want.set(`${p}:${icon.sizes}`, true);
}
check(want.has('any:192x192') && want.has('any:512x512'), 'icons include 192 and 512 for any');
check(want.has('maskable:192x192') && want.has('maskable:512x512'), 'icons include 192 and 512 maskable');
const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
const applePx = apple ? await sizeOf(new URL(apple, page.url()).href) : null;
check(applePx && applePx[0] === 180 && applePx[1] === 180, `apple-touch-icon is 180x180 (${apple}${applePx ? ` ${applePx[0]}x${applePx[1]}` : ''})`);
const fav = await page.locator('link[rel="icon"][type="image/png"]').getAttribute('href');
const favPx = fav ? await sizeOf(new URL(fav, page.url()).href) : null;
check(favPx && favPx[0] === 32, `a PNG favicon is 32x32 (${fav})`);

// the service worker: registered, active, and its cache filled
const sw = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return { supported: false };
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 15000))]);
  if (!reg) return { supported: true, ready: false };
  for (let i = 0; i < 50; i++) {
    const keys = await caches.keys();
    const hit = keys.find((k) => k.startsWith('raide-'));
    if (hit) {
      const c = await caches.open(hit);
      const n = (await c.keys()).length;
      if (n > 5) return { supported: true, ready: true, cache: hit, files: n };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { supported: true, ready: true, cache: null, files: 0 };
});
check(sw.ready && sw.files > 5, `the service worker is active and has cached the build (${sw.cache}, ${sw.files} files)`);

// offline: the title screen still opens
await context.setOffline(true);
let offlineOk = false;
try {
  await page.reload({ waitUntil: 'load', timeout: 15000 });
  await page.waitForSelector('button', { timeout: 10000 });
  offlineOk = (await page.locator('text=/SORA/i').count()) > 0 || (await page.locator('button').count()) > 0;
} catch {
  offlineOk = false;
}
check(offlineOk, 'the game opens with the network off');
await context.setOffline(false);

await browser.close();
console.log('');
console.log(failed ? 'pwa-check failed' : 'pwa-check ok');
process.exitCode = failed ? 1 : 0;
