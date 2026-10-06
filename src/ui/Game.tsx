/**
 * The game screen: the canvas, the loop, the HUD and the cards. The sim
 * lives in a ref and survives a turn of the phone; the HUD reads it a few
 * times a second; the cards open on the sim's events (a build, a year end,
 * the result) and on taps.
 */
import { useEffect, useRef, useState } from 'react';
import type { Line, ScenarioDef, SimState, WagonType, YearEndChoice } from '../game/types';
import { createState } from '../game/state';
import { DT, step, buyTrain, undo, closeYearEnd, trainPrice, note, price } from '../game/sim';
import { ENGINE, TRAINS_MAX, WAGON_GOOD, MONTHS } from '../game/content/economy';
import { idx } from '../game/grid';
import { Renderer } from '../render/renderer';
import { Input } from '../input/input';
import { Bot } from '../../tools/bot';
import { tr, t as tt, num } from '../i18n';
import { play, unlock, isMuted, setMuted } from '../audio';
import { track } from '../track';

type Card = { kind: 'train'; lineId: number } | { kind: 'yearEnd' } | { kind: 'result' } | { kind: 'pause' } | null;

interface Hud {
  year: number;
  month: number;
  frac: number;
  cash: number;
  goal: number;
  trains: number;
}

export function Game({ scenario, onQuit, onAgain }: { scenario: ScenarioDef; onQuit: () => void; onAgain: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<SimState | null>(null);
  if (!simRef.current) simRef.current = createState(scenario);
  const s = simRef.current;
  const [hud, setHud] = useState<Hud>(() => readHud(s));
  const [card, setCard] = useState<Card>(null);
  const [cancel, setCancel] = useState<{ x: number; y: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMutedState] = useState(isMuted());
  const cardRef = useRef<Card>(null);
  cardRef.current = card;
  const pausedRef = useRef(false);
  pausedRef.current = paused || card !== null;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new Renderer(canvas, s);
    const params = new URLSearchParams(location.search);
    const speed = Math.max(0.25, Number(params.get('speed') ?? 1));
    const bot = params.get('bot') === '1' ? new Bot() : null;
    const w = window as unknown as { __sim?: SimState; __input?: Input; __renderer?: Renderer; __pace?: number };
    w.__sim = s;
    w.__renderer = renderer;
    w.__pace = speed;
    const input = new Input(
      canvas,
      s,
      () => renderer.cam,
      {
        onBuild: (line, sx, sy) => {
          track('build', { scenario: scenario.id, cost: s.lastBuild?.cost ?? 0, bridge: s.lastBuild ? s.lastBuild.cells.filter((c) => s.water[c]).length : 0 });
          setCancel({ x: sx, y: sy });
          setCard({ kind: 'train', lineId: line.id });
        },
        onLine: (line) => setCard({ kind: 'train', lineId: line.id }),
        onNote: (cell, what) => note(s, cell, what === 'cash' ? tr('Ei rahaa', 'No cash') : tr('Vedä asemalta', 'Drag from a station')),
        onAny: () => unlock(),
      },
    );
    w.__input = input;
    track('scenario_start', { scenario: scenario.id });
    const start = s.sites.find((x) => x.id === scenario.startStation)!;
    const first = s.sites.find((x) => x.id !== scenario.startStation)!;
    const hint = { from: idx(s, start.cx, start.cy), to: idx(s, first.cx, first.cy) };
    let last = performance.now();
    let acc = 0;
    let frame = 0;
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const real = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!pausedRef.current && !s.yearEnd && !s.result) {
        acc += real * speed;
        let n = 0;
        while (acc >= DT && n < 30) {
          if (bot) bot.act(s);
          step(s);
          acc -= DT;
          n++;
        }
      }
      // the sim's own stops open their cards
      if (s.result && cardRef.current?.kind !== 'result') {
        track('scenario_end', { scenario: scenario.id, won: s.result.won, year: s.result.year, cash: s.result.cash, stars: s.result.stars });
        setCard({ kind: 'result' });
      } else if (s.yearEnd && !s.result && cardRef.current?.kind !== 'yearEnd') {
        if (bot) {
          bot.act(s);
        } else setCard({ kind: 'yearEnd' });
      }
      for (const name of s.sounds) play(name);
      s.sounds.length = 0;
      if (!s.lastBuild) setCancel((c) => (c ? null : c));
      renderer.draw(real * speed, input.drag, hint);
      if (++frame % 6 === 0) setHud(readHud(s));
    };
    raf = requestAnimationFrame(tick);
    const onVis = () => {
      if (document.visibilityState !== 'visible') setPaused(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      input.dispose();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [s, scenario]);

  const goal = scenario.goal;
  const line = card?.kind === 'train' ? s.lines.find((l) => l.id === card.lineId) ?? null : null;

  return (
    <div className="game">
      <canvas ref={canvasRef} />
      <div className="hud" data-ui>
        <div className="hud-year">
          <span className="num">{hud.year}</span>
          <span className="months">
            {Array.from({ length: MONTHS }, (_, i) => (
              <i key={i} className={i < hud.month ? 'on' : i === hud.month ? 'now' : ''} />
            ))}
          </span>
        </div>
        <div className="hud-goal" title={tr('Tavoite', 'Goal')}>
          <span className="label">{tr('Laudat', 'Boards')}</span>
          <span className="num">
            {hud.goal}/{goal.count}
          </span>
          <span className="bar">
            <i style={{ width: `${Math.min(100, (100 * hud.goal) / goal.count)}%` }} />
          </span>
          <span className="until">{tr('ennen', 'before')} {goal.beforeYear}</span>
        </div>
        <div className={`hud-cash num${hud.cash < 0 ? ' red' : ''}`}>{num(hud.cash)}</div>
        <button className="round pause" aria-label={tr('Tauko', 'Pause')} onClick={() => setCard({ kind: 'pause' })}>
          <svg viewBox="0 0 24 24" className="glyph"><rect x="6" y="5" width="4" height="14" fill="currentColor" /><rect x="14" y="5" width="4" height="14" fill="currentColor" /></svg>
        </button>
      </div>
      {cancel && s.lastBuild && (
        <button
          className="btn cancel"
          style={{ left: Math.min(window.innerWidth - 70, Math.max(70, cancel.x)), top: Math.max(100, cancel.y - 70) }}
          onClick={() => {
            if (undo(s)) {
              setCancel(null);
              setCard(null);
            }
          }}
        >
          {tr('Peru', 'Cancel')}
        </button>
      )}
      {line && (
        <TrainCard
          s={s}
          line={line}
          onBuy={(wagons) => {
            const t = buyTrain(s, line.id, wagons);
            if (t) {
              track('train', { scenario: scenario.id, wagons });
              setCancel(null);
              setCard(null);
            }
          }}
          onClose={() => setCard(null)}
        />
      )}
      {card?.kind === 'yearEnd' && s.yearEnd && (
        <YearEndCard
          s={s}
          onChoose={(c) => {
            track('year_end', { scenario: scenario.id, year: s.yearEnd?.year ?? 0, profit: s.yearEnd?.profit ?? 0, choice: c });
            closeYearEnd(s, c);
            setCard(null);
          }}
        />
      )}
      {card?.kind === 'result' && s.result && <ResultCard s={s} onAgain={onAgain} onQuit={onQuit} />}
      {card?.kind === 'pause' && (
        <div className="card overlay">
          <h2>{tr('Tauko', 'Paused')}</h2>
          <button className="btn primary wide" onClick={() => { setPaused(false); setCard(null); }}>
            {tr('Jatka', 'Resume')}
          </button>
          <button
            className="btn wide"
            onClick={() => {
              setMuted(!muted);
              setMutedState(!muted);
            }}
          >
            {muted ? tr('Äänet päälle', 'Sound on') : tr('Äänet pois', 'Sound off')}
          </button>
          <button className="btn wide danger" onClick={onQuit}>
            {tr('Lopeta', 'Quit')}
          </button>
        </div>
      )}
      {paused && card === null && (
        <div className="card overlay">
          <h2>{tr('Tauko', 'Paused')}</h2>
          <button className="btn primary wide" onClick={() => setPaused(false)}>
            {tr('Jatka', 'Resume')}
          </button>
        </div>
      )}
    </div>
  );
}

function readHud(s: SimState): Hud {
  return { year: s.year, month: s.month, frac: s.yearFrac, cash: s.cash, goal: s.goalCount, trains: s.trains.length };
}

/** The train card: the line, the trains on it, a wagon choice and Buy. */
function TrainCard({ s, line, onBuy, onClose }: { s: SimState; line: Line; onBuy: (w: WagonType) => void; onClose: () => void }) {
  const a = s.stations.find((x) => x.id === line.stops[0])!;
  const b = s.stations.find((x) => x.id === line.stops[1])!;
  const siteA = s.sites.find((x) => x.id === a.siteId)!;
  const siteB = s.sites.find((x) => x.id === b.siteId)!;
  // the sensible wagon: what the line's ends make
  const sensible: WagonType = siteA.kind === 'forest' || siteB.kind === 'forest' ? 'flat' : 'box';
  const [wagons, setWagons] = useState<WagonType>(sensible);
  const cost = trainPrice();
  const trains = s.trains.filter((t) => t.lineId === line.id);
  const full = s.trains.length >= TRAINS_MAX;
  const can = !full && cost <= s.cash;
  const good = WAGON_GOOD[wagons];
  const dest = good === 'timber' ? (siteA.kind === 'sawmill' ? siteA : siteB) : siteA.kind === 'town' ? siteA : siteB;
  const pays = price(s, good, dest.id, line.dist[line.dist.length - 1]);
  return (
    <div className="card sheet" data-ui>
      <div className="card-head">
        <h2>
          {tt(siteA.name)} <span className="arrow">⇄</span> {tt(siteB.name)}
        </h2>
        <button className="round close" aria-label={tr('Sulje', 'Close')} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="wagons">
        <button className={`wagon${wagons === 'flat' ? ' on' : ''}`} onClick={() => setWagons('flat')}>
          <span className="pic flat" />
          <span>{tr('Lavavaunut', 'Flat wagons')}</span>
          <small>{tr('tukit', 'timber')}</small>
        </button>
        <button className={`wagon${wagons === 'box' ? ' on' : ''}`} onClick={() => setWagons('box')}>
          <span className="pic box" />
          <span>{tr('Umpivaunut', 'Box wagons')}</span>
          <small>{tr('laudat', 'boards')}</small>
        </button>
      </div>
      <p className="small">
        {tt(ENGINE.name)} + 2 {tr('vaunua', 'wagons')}. {tr('Kuorma maksaa nyt', 'A load pays now')} {pays} {tr('kohteessa', 'at')} {tt(dest.name)}.
        {trains.length > 0 && ` ${trains.length} ${tr('junaa linjalla', 'on the line')}.`}
      </p>
      <button className="btn primary wide" disabled={!can} onClick={() => onBuy(wagons)} data-track="card-buy-train">
        {full ? tr('Kolme junaa on täynnä', 'Three trains is the limit') : `${tr('Osta juna', 'Buy train')}  ${cost}`}
      </button>
    </div>
  );
}

/** The year-end ledger: the numbers and the one choice. */
function YearEndCard({ s, onChoose }: { s: SimState; onChoose: (c: YearEndChoice) => void }) {
  const y = s.yearEnd!;
  const choices: { id: YearEndChoice; fi: string; en: string; sub: [string, string] }[] = [
    { id: 'wagon', fi: 'Vaunu lisää', en: 'An extra wagon', sub: ['jokaiseen junaan', 'on every train'] },
    { id: 'speed', fi: 'Nopeammat veturit', en: 'Faster engines', sub: ['neljänneksen', 'a quarter faster'] },
    { id: 'forest', fi: 'Tuottoisa metsä', en: 'A richer forest', sub: ['puolet enemmän tukkia', 'half again the timber'] },
  ];
  return (
    <div className="card ledger overlay" data-ui>
      <h2>{y.year}</h2>
      <table>
        <tbody>
          <tr>
            <td>{tr('Tukit', 'Timber')}</td>
            <td className="num">{num(y.income.timber)}</td>
          </tr>
          <tr>
            <td>{tr('Laudat', 'Boards')}</td>
            <td className="num">{num(y.income.boards)}</td>
          </tr>
          <tr>
            <td>{tr('Veturien ylläpito', 'Engine upkeep')}</td>
            <td className="num">-{num(y.upkeep)}</td>
          </tr>
          <tr className="total">
            <td>{tr('Voitto', 'Profit')}</td>
            <td className="num">{num(y.profit)}</td>
          </tr>
          <tr>
            <td>{tr('Kassa', 'Cash')}</td>
            <td className="num">{num(y.cash)}</td>
          </tr>
        </tbody>
      </table>
      <p className="small">{tr('Valitse yksi', 'Pick one')}</p>
      <div className="choices">
        {choices.map((c) => (
          <button key={c.id} className="btn choice" disabled={s.perks.includes(c.id)} onClick={() => onChoose(c.id)}>
            <span>{tr(c.fi, c.en)}</span>
            <small>{s.perks.includes(c.id) ? tr('otettu', 'taken') : tr(c.sub[0], c.sub[1])}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function ResultCard({ s, onAgain, onQuit }: { s: SimState; onAgain: () => void; onQuit: () => void }) {
  const r = s.result!;
  const years = r.year - s.scenario.startYear + (r.won ? 1 : 0);
  return (
    <div className="card result overlay" data-ui>
      <h2>{r.won ? tr('Tavoite täyttyi', 'Goal reached') : tr('Aika loppui', 'Out of time')}</h2>
      <div className="stars">{'★'.repeat(r.stars)}{'☆'.repeat(3 - r.stars)}</div>
      <p>
        {r.won ? `${num(s.goalCount)} ${tr('lautakuormaa', 'loads of boards')} ${tr('vuoteen', 'by')} ${r.year} ${tr('mennessä', '')}`.trim() : `${num(s.goalCount)}/${s.scenario.goal.count} ${tr('lautakuormaa', 'loads of boards')}`}
        {', '}
        {tr('kassa', 'cash')} {num(r.cash)}, {years} {years === 1 ? tr('vuosi', 'year') : tr('vuotta', 'years')}
      </p>
      <button className="btn primary wide" onClick={onAgain} data-track="result-again">
        {tr('Pelaa uudelleen', 'Play again')}
      </button>
      <button className="btn wide" onClick={onQuit}>
        {tr('Alkuun', 'Title')}
      </button>
    </div>
  );
}

