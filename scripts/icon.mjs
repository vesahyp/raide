// Renders public/icon.svg to every PNG a home screen or a tab needs. `make icon`.
// The PNGs are the same scene at each size: the launcher icons (192, 512, also
// listed as maskable, the scene keeps its car inside the safe zone), the iOS
// home screen icon (180) and a favicon for browsers that do not take SVG (32).
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
const svg = await readFile('public/icon.svg', 'utf8');
const b = await chromium.launch();
const p = await b.newPage();
const out = [
  [512, 'public/icon-512.png'],
  [192, 'public/icon-192.png'],
  [180, 'public/apple-touch-icon.png'],
  [32, 'public/favicon-32.png'],
];
for (const [size, path] of out) {
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(`<body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  await p.locator('svg').screenshot({ path, omitBackground: true });
}
await b.close();
console.log(`icons rendered: ${out.map(([s]) => s).join(', ')}`);
