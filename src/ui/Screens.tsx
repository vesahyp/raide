import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScenarioDef, SimState } from '../game/types';
import { HARJU, SCENARIOS } from '../game/content/scenarios';
import { createState, siteById } from '../game/state';
import { DT, step, plan, build, buyTrain } from '../game/sim';
import { idx } from '../game/grid';
import { Renderer2D, mapPreview } from '../render/render2d';
import { tr, t, lang, setLang } from '../i18n';
import { bestStars } from '../results';
import { BUILD_NAME } from '../version';

/** a live Harju for the start screen: a few lines and six trains, so the map is running */
function backdropState(): SimState {
  const s = createState(HARJU);
  s.cash = 1e6;
  const line = (a: string, b: string, mode: 'cheap' | 'short') => {
    const from = siteById(s, a);
    const to = siteById(s, b);
    const options = plan(s, idx(s, from.cx, from.cy), idx(s, to.cx, to.cy));
    const r = options.find((o) => o.mode === mode) ?? options[0];
    return r ? build(s, r) : null;
  };
  const run = (l: ReturnType<typeof line>, engine: 'hilma' | 'jyry' = 'hilma') => l && buyTrain(s, l.id, engine, 3);
  run(line('forest', 'sawmill', 'cheap'));
  run(line('sawmill', 'hameenlinna', 'cheap'));
  run(line('farm', 'mill', 'cheap'), 'jyry');
  run(line('mill', 'hameenlinna', 'cheap'));
  run(line('mill', 'lahti', 'cheap'));
  s.nextPickAt = Infinity;
  for (let i = 0; i < 900; i++) step(s);
  return s;
}

/** the slow tour of the valley: tile points the camera goes between and back, and tiles a second */
const TOUR: [number, number][] = [[10, 12], [20, 28], [12, 42]];
const TOUR_SPEED = 2;
const TOUR_SCALE = 20;

/** The map behind the start screen: Harju drawn by the game's own renderer, panning, with no input. */
function Backdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const s = backdropState();
    const r = new Renderer2D(canvas, document.createElement('div'), s);
    r.backdrop = true;
    const legs = TOUR.slice(1).map((p, i) => Math.hypot(p[0] - TOUR[i][0], p[1] - TOUR[i][1]));
    const total = legs.reduce((a, b) => a + b, 0);
    // the camera on the tour at a distance from its start
    const at = (d: number): [number, number] => {
      for (let i = 0; i < legs.length; i++) {
        if (d <= legs[i] || i === legs.length - 1) {
          const k = Math.min(1, d / legs[i]);
          return [TOUR[i][0] + (TOUR[i + 1][0] - TOUR[i][0]) * k, TOUR[i][1] + (TOUR[i + 1][1] - TOUR[i][1]) * k];
        }
        d -= legs[i];
      }
      return TOUR[0];
    };
    const period = (2 * total) / TOUR_SPEED;
    let clock = 0;
    let last = performance.now();
    let acc = 0;
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const real = Math.min(0.1, (now - last) / 1000);
      last = now;
      clock += real;
      acc += real;
      for (let n = 0; acc >= DT && n < 8; n++, acc -= DT) {
        s.cash = 1e6;
        s.pick = null;
        s.nextPickAt = Infinity;
        s.result = null;
        step(s);
      }
      // a cosine ease at each end of the tour
      const p = at(total * (0.5 - 0.5 * Math.cos((2 * Math.PI * clock) / period)));
      r.setView(p[0], p[1], TOUR_SCALE);
      r.draw(real, null, null);
    };
    raf = requestAnimationFrame(tick);
    const onResize = () => r.resize();
    window.addEventListener('resize', onResize);
    const w = window as unknown as { __backdrop?: Renderer2D };
    w.__backdrop = r;
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      r.dispose();
      delete w.__backdrop;
    };
  }, []);
  return <canvas ref={ref} className="home-map" aria-hidden />;
}

/** a scenario's whole map on a small canvas, drawn once and kept */
const previews = new Map<string, HTMLCanvasElement>();
const PREVIEW_PX = 2;

function Preview({ sc }: { sc: ScenarioDef }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let c = previews.get(sc.id);
    if (!c) {
      c = mapPreview(sc, sc.w * PREVIEW_PX + 16, sc.h * PREVIEW_PX + 16);
      previews.set(sc.id, c);
    }
    box.current!.replaceChildren(c);
  }, [sc]);
  return <div className="card-map" ref={box} aria-hidden />;
}

export function Title({ onPlay }: { onPlay: (sc: ScenarioDef) => void }) {
  const [, bump] = useState(0);
  const stars = useMemo(() => Object.fromEntries(SCENARIOS.map((sc) => [sc.id, bestStars(sc.id)])), []);
  return (
    <div className="home title">
      <Backdrop />
      <div className="home-shade" />
      <div className="home-head">
        <h1>Raide</h1>
        <p className="tagline">{tr('Vedä rata. Osta juna. Kuljeta tukit.', 'Drag track. Buy a train. Haul the timber.')}</p>
      </div>
      <div className="home-cards">
        {SCENARIOS.map((sc) => (
          <button key={sc.id} className="home-card" onClick={() => onPlay(sc)} data-track="title-play" data-scenario={sc.id}>
            <Preview sc={sc} />
            <span className="card-text">
              <span className="card-name">
                {t(sc.name)}
                {stars[sc.id] > 0 && <span className="card-stars" aria-label={`${stars[sc.id]} / 3`}>{'★'.repeat(stars[sc.id])}{'☆'.repeat(3 - stars[sc.id])}</span>}
              </span>
              <small>{t(sc.blurb)}</small>
            </span>
          </button>
        ))}
      </div>
      <button
        className="home-lang"
        aria-label={lang() === 'fi' ? 'In English' : 'Suomeksi'}
        onClick={() => {
          setLang(lang() === 'fi' ? 'en' : 'fi');
          bump((x) => x + 1);
        }}
      >
        {lang() === 'fi' ? 'EN' : 'FI'}
      </button>
      <div className="build">{BUILD_NAME}</div>
    </div>
  );
}
