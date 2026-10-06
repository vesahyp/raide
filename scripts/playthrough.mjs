// The scenario played on a phone by a thumb that is not the bot: on an emulated iPhone, in
// portrait and then in landscape, every input a real touch (CDP touch events, the ones a
// finger makes), a video of each run. The hand in tools/hand.ts decides what to do and how a
// thumb moves; this script finds the stations on the screen through the game's camera, turns
// the hand's drag into touch events, taps the cards' buttons, and keeps the tally.
//
// `make playthrough` (ORIENT=portrait or landscape for one; SPEED=0.5 on a loaded machine;
// PORT= to pin the preview port). Needs `make shots-setup`. Writes shots/playthrough/: a .webm
// per run, the result sheet, frame sheets (a frame a second, six by six), summary.md and
// summary.json. Exits non-zero when the slice is not fun by its rules: a run not won, the first
// paid delivery later than 90 s, a page error.
import { chromium, devices } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const freePort = () => new Promise((resolve) => { const srv = createServer(); srv.listen(0, () => { const p = srv.address().port; srv.close(() => resolve(p)); }); });
const port = Number(process.env.PORT) || (await freePort());
const SPEED = Number(process.env.SPEED || 1);
const ORIENTS = process.env.ORIENT ? [process.env.ORIENT] : ['portrait', 'landscape'];
const OUT = 'shots/playthrough';

// a production build, served still: the dev server reloads the game when a file is saved
execFileSync('npx', ['vite', 'build', '--logLevel', 'error'], { stdio: 'inherit' });
execFileSync('npx', ['vite', 'build', '--ssr', 'tools/hand.ts', '--outDir', '.hand-check', '--logLevel', 'error'], { stdio: 'inherit' });
const HAND_JS = readFileSync('.hand-check/hand.js', 'utf8').replace(/export\s*\{[^}]*\};?/g, '') + '\nwindow.__Hand = Hand; window.__PLAN = PLAN;';

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) rmSync(join(OUT, f), { recursive: true, force: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; ; i++) {
  const up = await fetch(`http://localhost:${port}/raide/`).then((r) => r.ok, () => false);
  if (up) break;
  if (i > 120) throw new Error(`no preview server on port ${port} after 60 s`);
  await new Promise((r) => setTimeout(r, 500));
}
const browser = await chromium.launch();
let failed = false;
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed = true;
};
const summary = [];

/** the game as the thumb sees it: the sim's numbers and where the sites are on the glass */
const look = (page) =>
  page.evaluate(() => {
    const s = window.__sim;
    const r = window.__renderer;
    if (!s || !r) return null;
    const m = r.cam.m;
    const toS = (x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
    const sites = {};
    for (const site of s.sites) sites[site.id] = toS(site.cx + 0.5, site.cy + 0.5);
    const card = document.querySelector('.card.result') ? 'result' : document.querySelector('.card.ledger') ? 'yearEnd' : document.querySelector('.card.sheet') ? 'train' : 'none';
    // what the next line would cost, through the sim's own plan, the way the cost shows on the line
    const plan = window.__plan;
    const cell = (id) => { const o = s.sites.find((x) => x.id === id); return o.cy * s.w + o.cx; };
    const PLAN = window.__PLAN;
    const nextLine = PLAN.lines[s.lines.length];
    const route = nextLine && plan ? plan(cell(nextLine[0]), cell(nextLine[1])) : null;
    // the middle cell of a line, on the glass, to tap it
    const lineMid = s.lines.map((l) => { const c = l.path[Math.floor(l.path.length / 2)]; return toS((c % s.w) + 0.5, Math.floor(c / s.w) + 0.5); });
    return {
      cash: s.cash, lines: s.lines.length, trains: s.trains.length, yearEnd: !!s.yearEnd, result: s.result, card, sites, lineMid,
      nextLineCost: route ? route.cost + 70 : null, trainCost: 70, time: s.time, year: s.year, goal: s.goalCount, firstPayAt: s.firstPayAt,
    };
  });

async function run(orient) {
  const phone = devices[orient === 'landscape' ? 'iPhone 15 landscape' : 'iPhone 15'];
  const context = await browser.newContext({ ...phone, hasTouch: true, recordVideo: { dir: join(OUT, 'tmp'), size: phone.viewport } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const name = `sawmill-${orient}`;
  const cdp = await context.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const tap = async (x, y) => {
    await touch('touchStart', [{ x, y, id: 1 }]);
    await page.waitForTimeout(60);
    await touch('touchEnd', []);
  };
  const tapButton = async (locator) => {
    const b = await locator.boundingBox();
    if (!b) throw new Error('button not on screen');
    await tap(b.x + b.width / 2, b.y + b.height / 2);
  };
  const stats = { drags: 0, buys: 0, choices: 0, taps: 0, error: null, won: false, year: 0, cash: 0, stars: 0, firstPayAt: null, seconds: 0 };
  const t0 = Date.now();
  try {
    await page.goto(`http://localhost:${port}/raide/?lang=en${SPEED !== 1 ? `&speed=${SPEED}` : ''}`);
    await page.addScriptTag({ content: HAND_JS });
    await page.evaluate(() => { window.__hand = new window.__Hand(0.6); });
    await page.waitForTimeout(800);
    await tapButton(page.locator('[data-track="title-play"]').first());
    await page.waitForFunction(() => window.__sim && window.__renderer, null, { timeout: 10000 });
    await page.waitForTimeout(600);
    let lastKind = '';
    for (let i = 0; i < 2000; i++) {
      const v = await look(page);
      if (!v) throw new Error('the game is gone');
      const act = await page.evaluate((view) => window.__hand.next(view), v);
      if (act.kind !== lastKind) lastKind = act.kind;
      if (act.kind === 'done') break;
      if (act.kind === 'wait') {
        await page.waitForTimeout(250);
        continue;
      }
      // the reaction: the thumb sees, then moves
      await page.waitForTimeout(Math.round(1000 * (await page.evaluate(() => window.__hand.reaction))));
      if (act.kind === 'drag') {
        const a = v.sites[act.from];
        const b = v.sites[act.to];
        const pts = await page.evaluate(({ a, b }) => window.__hand.path(a, b), { a, b });
        await touch('touchStart', [{ x: a.x, y: a.y, id: 1 }]);
        let at = 0;
        for (const p of pts) {
          await page.waitForTimeout(Math.max(0, p.at - at));
          at = p.at;
          await touch('touchMove', [{ x: p.x, y: p.y, id: 1 }]);
        }
        await page.waitForTimeout(150);
        await touch('touchEnd', []);
        stats.drags++;
        await page.waitForTimeout(300);
        const after = await look(page);
        if (after.lines > v.lines) {
          await page.evaluate(() => { window.__hand.built++; });
        } else {
          stats.error = `drag ${act.from} -> ${act.to} built nothing`;
          break;
        }
      } else if (act.kind === 'buy') {
        // the card after a build, or a tap on the line to open it
        if (v.card !== 'train') {
          const idx = v.lines - 1;
          await tap(v.lineMid[idx].x, v.lineMid[idx].y);
          stats.taps++;
          await page.locator('.card.sheet').waitFor({ timeout: 3000 });
          await page.waitForTimeout(250);
        }
        const want = page.locator(`.wagon`).filter({ hasText: act.wagons === 'flat' ? /Flat/ : /Box/ });
        const on = await want.evaluate((el) => el.classList.contains('on'));
        if (!on) {
          await tapButton(want);
          await page.waitForTimeout(200);
        }
        await tapButton(page.locator('[data-track="card-buy-train"]'));
        stats.buys++;
        await page.waitForTimeout(300);
        const after = await look(page);
        if (after.trains > v.trains) await page.evaluate(() => { window.__hand.bought++; });
        else {
          stats.error = `buy on ${act.onLine.join('-')} bought nothing`;
          break;
        }
      } else if (act.kind === 'choose') {
        await page.locator('.card.ledger').waitFor({ timeout: 5000 });
        await page.waitForTimeout(700);
        await tapButton(page.locator('.btn.choice:not([disabled])').first());
        stats.choices++;
        await page.waitForTimeout(400);
      }
    }
    await page.locator('.card.result').waitFor({ timeout: 10000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(OUT, `${name}-result.png`) });
    const v = await look(page);
    Object.assign(stats, { won: v.result.won, year: v.result.year, cash: v.result.cash, stars: v.result.stars, firstPayAt: v.firstPayAt, simSeconds: v.time });
  } catch (e) {
    stats.error = stats.error ?? String(e).split('\n')[0];
    await page.screenshot({ path: join(OUT, `${name}-error.png`) }).catch(() => undefined);
  }
  stats.seconds = (Date.now() - t0) / 1000;
  stats.errors = errors;
  const video = page.video();
  await context.close();
  renameSync(await video.path(), join(OUT, `${name}.webm`));
  return { name, orient, ...stats, video: `${name}.webm` };
}

try {
  for (const o of ORIENTS) {
    const r = await run(o);
    summary.push(r);
    console.log(`${r.name}: ${r.error ? `ERROR ${r.error}` : `${r.won ? 'won' : 'lost'} ${r.year} cash ${r.cash} stars ${r.stars} first pay ${r.firstPayAt?.toFixed(0)} s`} drags ${r.drags} buys ${r.buys} choices ${r.choices} in ${r.seconds.toFixed(0)} s real, ${r.simSeconds?.toFixed(0) ?? '-'} s sim`);
  }
} finally {
  await browser.close();
  server.kill();
}
rmSync(join(OUT, 'tmp'), { recursive: true, force: true });

// frame sheets: a frame a second of each video, six by six, to read a run at a glance
const cache = join(homedir(), 'Library/Caches/ms-playwright');
const ffmpegDir = existsSync(cache) && readdirSync(cache).find((d) => d.startsWith('ffmpeg-'));
const ffmpeg = ffmpegDir && join(cache, ffmpegDir, 'ffmpeg-mac');
if (ffmpeg && existsSync(ffmpeg)) {
  mkdirSync(join(OUT, 'sheets'), { recursive: true });
  const sheets = await chromium.launch();
  for (const r of summary) {
    const frames = join(OUT, 'tmp-frames');
    rmSync(frames, { recursive: true, force: true });
    mkdirSync(frames, { recursive: true });
    try {
      const size = r.orient === 'landscape' ? '426x197' : '197x426';
      execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', join(OUT, r.video), '-r', '0.5', '-s', size, join(frames, '%03d.png')]);
      const files = readdirSync(frames).sort();
      const [fw, fh] = size.split('x').map(Number);
      const page = await sheets.newPage();
      for (let k = 0; k * 36 < files.length; k++) {
        const batch = files.slice(k * 36, k * 36 + 36).map((f) => `data:image/png;base64,${readFileSync(join(frames, f)).toString('base64')}`);
        await page.setContent(`<body style="margin:0;background:#111"><div style="display:grid;grid-template-columns:repeat(6,${fw}px);gap:1px;width:${6 * (fw + 1)}px">${batch.map((src, i) => `<div style="position:relative"><img src="${src}" style="display:block"><span style="position:absolute;left:4px;top:2px;color:#ffd870;font:bold 14px monospace;text-shadow:0 0 3px #000">${(k * 36 + i) * 2}s</span></div>`).join('')}</div></body>`);
        await page.setViewportSize({ width: 6 * (fw + 1), height: Math.ceil(batch.length / 6) * (fh + 1) });
        await page.screenshot({ path: join(OUT, 'sheets', `${r.name}-${k + 1}.png`), fullPage: true });
      }
      await page.close();
    } catch (e) {
      console.log(`no sheet for ${r.name}: ${String(e).split('\n')[0]}`);
    }
    rmSync(frames, { recursive: true, force: true });
  }
  await sheets.close();
}

writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(OUT, 'summary.md'), `| run | result | year | cash | stars | first pay | drags | buys | choices | real s |\n|---|---|---|---|---|---|---|---|---|---|\n${summary.map((r) => `| ${r.name} | ${r.error ? `error: ${r.error}` : r.won ? 'won' : 'lost'} | ${r.year} | ${r.cash} | ${r.stars} | ${r.firstPayAt?.toFixed(0) ?? ''} s | ${r.drags} | ${r.buys} | ${r.choices} | ${r.seconds.toFixed(0)} |`).join('\n')}\n`);

// the rules of a fun slice
check(summary.every((r) => !r.error && r.won), 'the thumb wins the sawmill scenario in both orientations');
check(summary.every((r) => !r.errors?.length), `no page errors (${summary.flatMap((r) => r.errors ?? []).slice(0, 3).join('; ') || 'none'})`);
check(summary.every((r) => r.firstPayAt !== null && r.firstPayAt < 90), `the first paid delivery lands inside 90 s (${summary.map((r) => r.firstPayAt?.toFixed(0) ?? '-').join(' ')})`);
check(summary.every((r) => r.drags === 2 && r.buys === 3), `two drags and three trains do the whole scenario (${summary.map((r) => `${r.drags}/${r.buys}`).join(' ')})`);
console.log(failed ? 'playthrough failed' : 'playthrough ok');
process.exitCode = failed ? 1 : 0;
