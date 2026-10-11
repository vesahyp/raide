/**
 * The game screen (ADR 0007): the canvas, the loop, the HUD, the tool bar and the cards. The sim
 * lives in a ref; the HUD reads it a few times a second; a card opens on a tap on the map or on a
 * tool, and covers at most half the screen so the map stays in view.
 *
 * Tools, from the bar at the bottom: Track (drag to lay), Station (drag to place), Train (tap the
 * stops, set the cars, pick the locomotive), Trains (the list) and Cargo (where a cargo is made and
 * taken). The cash in the HUD opens the money card with the bonds; the goal chip opens the goal.
 */
import { useEffect, useRef, useState } from 'react';
import type { Cargo, LocoId, ScenarioDef, SimState, Station, StationSize, Stop, Train } from '../game/types';
import { CARGOS } from '../game/types';
import { createState, stationById } from '../game/state';
import {
  DT, step, money, buildTrack, buildStation, stationBlock, removeStation, removeTrack, pieceAt, pieceRefund, buyTrain, setRoute, replaceLoco,
  sellTrain, issueBond, repayBond, canIssue, nextBondRate, debt, worth, creditLimit, interestYear, upkeepYear, ageOf, reliability, locoValue,
  locoUpkeep, locosOnSale, autoCars, suppliesAt, acceptsAt, quote, glutFactor, goalValue, legPath, runTime, covered, bookValue,
} from '../game/sim';
import { CARGO_NAME, CARS_MAX, CAR_EMPTY, CAR_FULL, CONVERTS, KIND_NAME, LOCOS, MONTHS, RAW, STATIONS, GROW_BASE, GROW_PER, BOND, YEAR_SECONDS } from '../game/content/economy';
import { crow, type Route } from '../game/grid';
import { Renderer2D, gradeColour } from '../render/render2d';
import { drawEngine, drawWagon } from '../render/draw2d';
import { Input, type Plan, type Tool } from '../input/input';
import { tr, t as tt } from '../i18n';
import { play, unlock, isMuted, setMuted } from '../audio';
import { track } from '../track';
import { saveStars } from '../results';
import { BUILD_NAME } from '../version';
import { CargoIcons, Icon } from './icons';
import { Chart } from './Chart';
import { Bot, PLANS } from '../game/bot';

/** the clock speeds: paused, normal, fast */
const SPEEDS = [0, 1, 4];

type Card =
  | { kind: 'plan'; plan: Plan; chosen: number }
  | { kind: 'piece'; cell: number }
  | { kind: 'spot'; cell: number; ok: boolean; size: StationSize }
  | { kind: 'station'; id: number }
  | { kind: 'site'; id: string }
  | { kind: 'train'; id: number }
  | { kind: 'route'; trainId: number | null; stops: Stop[]; loco: LocoId; step: 'stops' | 'loco' }
  | { kind: 'trains' }
  | { kind: 'money' }
  | { kind: 'goal' }
  | { kind: 'menu' }
  | { kind: 'cargo' }
  | null;

interface Hud {
  year: number;
  month: number;
  cash: number;
  goal: number;
  tier: number;
}

function readHud(s: SimState): Hud {
  return { year: s.year, month: s.month, cash: s.cash, goal: goalValue(s), tier: s.tier };
}

const cargoName = (c: Cargo) => tt(CARGO_NAME[c]);
const km = (tiles: number) => `${Math.round(tiles)} km`;
const pct = (x: number) => `${Math.round(x * 100)} %`;

export function Game({ scenario, onQuit, onAgain }: { scenario: ScenarioDef; onQuit: () => void; onAgain: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<SimState | null>(null);
  if (!simRef.current) simRef.current = createState(scenario);
  const s = simRef.current;
  const rendRef = useRef<Renderer2D | null>(null);
  const inputRef = useRef<Input | null>(null);
  const [hud, setHud] = useState<Hud>(() => readHud(s));
  const [card, setCard] = useState<Card>(null);
  const cardRef = useRef<Card>(null);
  cardRef.current = card;
  const [tool, setToolState] = useState<Tool>('browse');
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1);
  speedRef.current = speed;
  const [cargo, setCargo] = useState<Cargo | null>(null);
  const [toast, setToast] = useState<{ text: string; at: number } | null>(null);
  const [muted, setMutedState] = useState(isMuted());
  const [result, setResult] = useState(false);
  const [, bump] = useState(0);

  const setTool = (t: Tool) => {
    setToolState(t);
    inputRef.current?.setTool(t);
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new Renderer2D(canvas, overlayRef.current!, s);
    rendRef.current = renderer;
    const params = new URLSearchParams(location.search);
    const pace = Math.max(0.25, Number(params.get('speed') ?? 1));
    // ?bot=1: the careful plan plays, for the pictures; the human-like script never uses it
    const bot = params.get('bot') === '1' ? new Bot(PLANS[scenario.id].careful) : null;
    const w = window as unknown as { __sim?: SimState; __renderer?: Renderer2D; __input?: Input; __pace?: number };
    w.__sim = s;
    w.__renderer = renderer;
    w.__pace = pace;
    const input = new Input(canvas, s, renderer, {
      onTrain: (t) => setCard({ kind: 'train', id: t.id }),
      onStation: (st) => setCard({ kind: 'station', id: st.id }),
      onSite: (site) => setCard({ kind: 'site', id: site.id }),
      onTrack: (cell) => setCard({ kind: 'piece', cell }),
      onGround: () => setCard((c) => (c && (c.kind === 'station' || c.kind === 'site' || c.kind === 'train' || c.kind === 'piece') ? null : c)),
      onPlan: (plan) => setCard(plan ? { kind: 'plan', plan, chosen: 0 } : null),
      onStationSpot: (cell, ok) => setCard((c) => ({ kind: 'spot', cell, ok, size: c?.kind === 'spot' ? c.size : 0 })),
      onStop: (st) =>
        setCard((c) => {
          if (c?.kind !== 'route' || c.stops.length >= 4) return c;
          if (c.stops.length && c.stops[c.stops.length - 1].station === st.id) return c;
          const stops = [...c.stops, { station: st.id, cars: [], waitFull: false }];
          return { ...c, stops: withAutoCars(s, stops) };
        }),
      onAny: () => unlock(),
    });
    inputRef.current = input;
    w.__input = input;
    track('scenario_start', { scenario: scenario.id });
    let last = performance.now();
    let acc = 0;
    let frame = 0;
    let raf = 0;
    let newsSeen = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const real = Math.min(0.1, (now - last) / 1000);
      last = now;
      const sp = SPEEDS[speedRef.current];
      if (!s.result && sp > 0 && !(window as unknown as { __freeze?: boolean }).__freeze) {
        acc += real * pace * sp;
        let n = 0;
        while (acc >= DT && n < 600) {
          if (bot) bot.act(s);
          step(s);
          acc -= DT;
          n++;
        }
        if (n >= 600) acc = 0;
      }
      if (s.result && !resultShown) {
        resultShown = true;
        saveStars(scenario.id, s.result.tier);
        track('scenario_end', { scenario: scenario.id, won: s.result.won, tier: s.result.tier, reason: s.result.reason, year: s.result.year, worth: Math.round(s.result.worth), seconds: Math.round(s.result.time) });
        setResult(true);
      }
      for (const name of s.sounds) play(name);
      s.sounds.length = 0;
      if (s.news.length > newsSeen) {
        const n = s.news[s.news.length - 1];
        newsSeen = s.news.length;
        setToast({ text: tt(n.text), at: now });
      }
      input.update(real);
      // what the map shows on top: the card's plan, the drag, the catchment, the stops
      const c = cardRef.current;
      const v = renderer.view;
      v.plan = c?.kind === 'plan' ? { options: c.plan.options, chosen: c.chosen, via: c.plan.via, from: c.plan.from, to: c.plan.to } : null;
      v.drag = input.drag ? { ...input.drag } : null;
      v.catchment = input.spot ? { cell: input.spot.cell, size: c?.kind === 'spot' ? c.size : 0, ok: input.spot.ok } : c?.kind === 'spot' ? { cell: c.cell, size: c.size, ok: c.ok } : null;
      v.stops = c?.kind === 'route' ? c.stops.map((p) => p.station) : null;
      v.selected =
        c?.kind === 'station' ? { kind: 'station', id: c.id } : c?.kind === 'train' ? { kind: 'train', id: c.id } : c?.kind === 'site' ? { kind: 'site', id: c.id } : c?.kind === 'piece' ? { kind: 'track', cells: pieceAt(s, c.cell)?.cells ?? [] } : null;
      renderer.draw(real);
      if (++frame % 6 === 0) {
        setHud(readHud(s));
        bump((x) => x + 1);
      }
    };
    let resultShown = false;
    raf = requestAnimationFrame(tick);
    const onVis = () => {
      if (document.visibilityState !== 'visible') setSpeed(0);
    };
    document.addEventListener('visibilitychange', onVis);
    const onResize = () => renderer.resize();
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      input.dispose();
      renderer.dispose();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [s, scenario]);

  useEffect(() => {
    if (rendRef.current) rendRef.current.view.cargo = cargo;
  }, [cargo]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const close = () => {
    setCard(null);
    if (tool === 'route') setTool('browse');
  };

  const pickTool = (t: Tool) => {
    if (tool === t) {
      setTool('browse');
      setCard(null);
      return;
    }
    setTool(t);
    if (t === 'route') setCard({ kind: 'route', trainId: null, stops: [], loco: locosOnSale(s)[0], step: 'stops' });
    else setCard(null);
  };

  const goal = scenario.goal;
  const tiers = goal.tiers;
  const nextTier = tiers.find((n) => hud.goal < n) ?? tiers[2];
  const goalText = goal.kind === 'worth' ? money(hud.goal) : String(Math.floor(hud.goal));
  const nextText = goal.kind === 'worth' ? money(nextTier) : String(nextTier);
  const hint =
    tool === 'track'
      ? tr('Vedä sormella rata. Pidä sormi hetken paikallaan: mutka. Kaksi sormea liikuttaa karttaa.', 'Drag a finger to lay track. Rest it a moment for a bend. Two fingers move the map.')
      : tool === 'station'
        ? tr('Vedä neliö radan päälle: se näyttää mitä asema kerää.', 'Drag the square onto the track: it shows what the station gathers.')
        : tool === 'route' && card?.kind === 'route' && card.step === 'stops'
          ? tr('Napauta asemat järjestyksessä (2 tai enemmän).', 'Tap the stations in order (2 or more).')
          : null;

  return (
    <div className={`game tool-${tool}`}>
      <CargoIcons />
      <canvas ref={canvasRef} />
      <div className="map-overlay" ref={overlayRef} />
      <div className="hud" data-ui>
        <button className="hud-year" data-act="menu" onClick={() => setCard({ kind: 'menu' })}>
          <span className="num">{hud.year}</span>
          <span className="months">
            {Array.from({ length: MONTHS }, (_, i) => (
              <i key={i} className={i < hud.month ? 'on' : i === hud.month ? 'now' : ''} />
            ))}
          </span>
        </button>
        <button className={`hud-cash num${hud.cash < 0 ? ' red' : ''}`} data-act="money" onClick={() => setCard({ kind: 'money' })}>
          {money(hud.cash)}
        </button>
        <button className="hud-goal" data-act="goal" onClick={() => setCard({ kind: 'goal' })}>
          <span className={`medal t${hud.tier}`} />
          <span className="num">
            {goalText}
            <small>/{nextText}</small>
          </span>
          <small className="until">{goal.byYear}</small>
        </button>
        <div className="speeds">
          {SPEEDS.map((v, i) => (
            <button key={i} className={`spd${speed === i ? ' on' : ''}`} data-act={`speed-${i}`} aria-label={[tr('Tauko', 'Pause'), tr('Normaali', 'Normal'), tr('Nopea', 'Fast')][i]} onClick={() => setSpeed(i)}>
              {v === 0 ? (
                <svg viewBox="0 0 24 24" className="glyph"><rect x="6" y="5" width="4" height="14" fill="currentColor" /><rect x="14" y="5" width="4" height="14" fill="currentColor" /></svg>
              ) : v === 1 ? (
                <svg viewBox="0 0 24 24" className="glyph"><path d="M7 5 L18 12 L7 19 Z" fill="currentColor" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" className="glyph"><path d="M3 6 L11 12 L3 18 Z M12 6 L20 12 L12 18 Z" fill="currentColor" /></svg>
              )}
            </button>
          ))}
        </div>
      </div>
      {toast && <div className="toast" data-ui>{toast.text}</div>}
      {hint && !card?.kind?.startsWith('plan') && card?.kind !== 'spot' && <div className="hint" data-ui>{hint}</div>}
      {cargo && card?.kind !== 'cargo' && (
        <button className="cargo-chip" data-ui onClick={() => setCargo(null)}>
          <Icon c={cargo} /> {cargoName(cargo)} <b>×</b>
          <span className="legend">
            <i className="mk" /> {tr('tuotetaan', 'made')} <i className="tk" /> {tr('otetaan vastaan', 'taken')}
          </span>
        </button>
      )}
      <nav className="tools" data-ui>
        {(
          [
            ['track', tr('Rata', 'Track'), <path key="p" d="M8 2 V22 M16 2 V22 M5 5 H19 M5 10 H19 M5 15 H19 M5 20 H19" stroke="currentColor" strokeWidth="2.2" fill="none" />],
            ['station', tr('Asema', 'Station'), <path key="p" d="M3 11 L12 4 L21 11 M5 10 V20 H19 V10 M10 20 V14 H14 V20" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinejoin="round" />],
            ['route', tr('Juna', 'Train'), <path key="p" d="M4 16 V8 Q4 5 8 5 H14 V9 H18 Q20 9 20 12 V16 Z M7 19 a2 2 0 1 0 0.01 0 M16 19 a2 2 0 1 0 0.01 0" stroke="currentColor" strokeWidth="2" fill="none" />],
          ] as [Tool, string, React.ReactElement][]
        ).map(([id, label, glyph]) => (
          <button key={id} className={`tool${tool === id ? ' on' : ''}`} data-tool={id} onClick={() => pickTool(id)}>
            <svg viewBox="0 0 24 24">{glyph}</svg>
            <span>{label}</span>
          </button>
        ))}
        <button className={`tool${card?.kind === 'trains' ? ' on' : ''}`} data-tool="trains" onClick={() => (setTool('browse'), setCard({ kind: 'trains' }))}>
          <svg viewBox="0 0 24 24">
            <path d="M4 6 H20 M4 12 H20 M4 18 H20" stroke="currentColor" strokeWidth="2.4" />
          </svg>
          <span>{tr('Junat', 'Trains')}</span>
        </button>
        <button className={`tool${cargo || card?.kind === 'cargo' ? ' on' : ''}`} data-tool="cargo" onClick={() => (setTool('browse'), setCard({ kind: 'cargo' }))}>
          <svg viewBox="0 0 24 24">
            <rect x="4" y="7" width="16" height="12" rx="1.5" stroke="currentColor" strokeWidth="2.2" fill="none" />
            <path d="M4 11 H20 M10 7 V19" stroke="currentColor" strokeWidth="2" />
          </svg>
          <span>{tr('Lasti', 'Cargo')}</span>
        </button>
      </nav>
      {card && !result && (
        <div className="card sheet" data-card={card.kind} key={card.kind}>
          {card.kind === 'plan' && (
            <PlanCard
              s={s}
              card={card}
              onChoose={(k) => setCard({ ...card, chosen: k })}
              onBuild={() => {
                const r = card.plan.options[card.chosen];
                if (buildTrack(s, r)) {
                  track('build', { scenario: scenario.id, cost: r.cost, tiles: r.added.length, bridge: r.bridge.length, mode: r.mode });
                  setCard(null);
                }
              }}
              onBond={() => issueBond(s)}
              onClose={() => setCard(null)}
            />
          )}
          {card.kind === 'piece' && (
            <PieceCard
              s={s}
              cell={card.cell}
              onRemove={() => {
                if (removeTrack(s, card.cell)) setCard(null);
              }}
              onClose={() => setCard(null)}
            />
          )}
          {card.kind === 'spot' && (
            <SpotCard
              s={s}
              card={card}
              onSize={(size) => setCard({ ...card, size })}
              onBuild={() => {
                const st = buildStation(s, card.cell, card.size);
                if (st) {
                  track('station', { scenario: scenario.id, size: card.size });
                  setTool('browse');
                  setCard({ kind: 'station', id: st.id });
                }
              }}
              onBond={() => issueBond(s)}
              onClose={() => setCard(null)}
            />
          )}
          {card.kind === 'station' && stationById(s, card.id) && (
            <StationCard
              s={s}
              st={stationById(s, card.id)!}
              onTrain={(t) => setCard({ kind: 'train', id: t.id })}
              onBuy={() => {
                setTool('route');
                setCard({ kind: 'route', trainId: null, stops: withAutoCars(s, [{ station: card.id, cars: [], waitFull: false }]), loco: locosOnSale(s)[0], step: 'stops' });
              }}
              onRemove={() => {
                if (removeStation(s, card.id)) setCard(null);
              }}
              onClose={close}
            />
          )}
          {card.kind === 'site' && s.sites.find((o) => o.id === card.id) && <SiteCard s={s} id={card.id} onStation={(id) => setCard({ kind: 'station', id })} onClose={close} />}
          {card.kind === 'train' && s.trains.find((o) => o.id === card.id) && (
            <TrainCard
              s={s}
              t={s.trains.find((o) => o.id === card.id)!}
              onEdit={(t) => {
                setTool('route');
                setCard({ kind: 'route', trainId: t.id, stops: t.route.map((p) => ({ ...p, cars: [...p.cars] })), loco: t.loco, step: 'stops' });
              }}
              onClose={close}
            />
          )}
          {card.kind === 'route' && (
            <RouteCard
              s={s}
              card={card}
              onChange={(c) => setCard(c)}
              onDone={(t) => {
                setTool('browse');
                setCard(t ? { kind: 'train', id: t.id } : null);
              }}
              onClose={close}
            />
          )}
          {card.kind === 'trains' && <TrainsCard s={s} onTrain={(t) => setCard({ kind: 'train', id: t.id })} onClose={close} />}
          {card.kind === 'money' && <MoneyCard s={s} onClose={close} />}
          {card.kind === 'goal' && <GoalCard s={s} onClose={close} />}
          {card.kind === 'cargo' && (
            <CargoCard
              s={s}
              on={cargo}
              onPick={(c) => {
                setCargo(c);
                setCard(null);
              }}
              onClose={close}
            />
          )}
          {card.kind === 'menu' && (
            <MenuCard
              muted={muted}
              onMute={() => {
                setMuted(!muted);
                setMutedState(!muted);
              }}
              onQuit={onQuit}
              onAgain={onAgain}
              onClose={close}
            />
          )}
        </div>
      )}
      {result && s.result && <ResultCard s={s} onAgain={onAgain} onQuit={onQuit} />}
    </div>
  );
}

/** stops with the cars the route would want, kept where the player already set some */
function withAutoCars(s: SimState, stops: Stop[]): Stop[] {
  const sts = stops.map((p) => stationById(s, p.station)).filter((o): o is Station => !!o);
  if (sts.length < 2) return stops;
  const auto = autoCars(s, sts);
  return stops.map((p, k) => ({ ...p, cars: p.cars.length ? p.cars : auto[k] }));
}

function CardHead({ title, sub, onClose }: { title: React.ReactNode; sub?: React.ReactNode; onClose: () => void }) {
  return (
    <div className="card-head">
      <div>
        <h2>{title}</h2>
        {sub && <div className="sub">{sub}</div>}
      </div>
      <button className="round close" aria-label={tr('Sulje', 'Close')} data-act="close" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- track

function PlanCard({ s, card, onChoose, onBuild, onBond, onClose }: { s: SimState; card: { plan: Plan; chosen: number }; onChoose: (k: number) => void; onBuild: () => void; onBond: () => void; onClose: () => void }) {
  const r = card.plan.options[card.chosen];
  const short = r.cost > s.cash;
  const name = (x: Route) => (x.mode === 'cheap' ? tr('Halvin', 'Cheapest') : tr('Loivin', 'Level'));
  return (
    <>
      <CardHead title={tr('Uusi rata', 'New track')} sub={`${km(r.length)} · ${r.added.length} ${tr('uutta ruutua', 'new tiles')}`} onClose={onClose} />
      {card.plan.options.length > 1 && (
        <div className="seg">
          {card.plan.options.map((x, k) => (
            <button key={k} className={k === card.chosen ? 'on' : ''} data-act={`option-${x.mode}`} onClick={() => onChoose(k)}>
              <b>{name(x)}</b>
              <span>
                {money(x.cost)} · {x.worst} %
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="facts">
        <div>
          <small>{tr('Hinta', 'Cost')}</small>
          <b className={short ? 'red' : 'gold'}>{money(r.cost)}</b>
        </div>
        <div>
          <small>{tr('Jyrkin nousu', 'Steepest grade')}</small>
          <b style={{ color: gradeColour(r.worst) }}>{r.worst} %</b>
        </div>
        <div>
          <small>{tr('Siltoja', 'Bridge tiles')}</small>
          <b>{r.bridge.length}</b>
        </div>
        <div>
          <small>{tr('Leikkauksia', 'Cuttings')}</small>
          <b>{r.cutting.length + r.fill.length}</b>
        </div>
      </div>
      <p className="small">
        {r.worst >= 3
          ? tr('Jyrkkä nousu hidastaa raskaita junia. Loivempi reitti maksaa enemmän.', 'A steep grade slows heavy trains. A level route costs more.')
          : tr('Ylläpito maksaa joka vuosi jokaisesta ruudusta, silloista viisinkertaisesti.', 'Every tile costs upkeep each year, a bridge five times as much.')}
      </p>
      <div className="row">
        <button className="btn" data-act="cancel" onClick={onClose}>
          {tr('Peru', 'Cancel')}
        </button>
        {short && canIssue(s) ? (
          <button className="btn" data-act="bond" onClick={onBond}>
            {tr('Laina', 'Bond')} +{money(BOND)}
          </button>
        ) : null}
        <button className="btn primary" data-act="build" disabled={short} onClick={onBuild}>
          {tr('Rakenna', 'Build')}
        </button>
      </div>
    </>
  );
}

function PieceCard({ s, cell, onRemove, onClose }: { s: SimState; cell: number; onRemove: () => void; onClose: () => void }) {
  const piece = pieceAt(s, cell);
  if (!piece) return null;
  const back = pieceRefund(s, piece);
  const users = s.trains.filter((t) => t.path.some((c) => piece.cells.includes(c)));
  return (
    <>
      <CardHead title={tr('Rataosuus', 'Piece of track')} sub={`${piece.cells.length} ${tr('ruutua', 'tiles')}`} onClose={onClose} />
      <p className="small">
        {users.length
          ? tr(`${users.length} junaa ajaa tästä. Ilman rataa ne pysähtyvät.`, `${users.length} trains run here. Without it they stop.`)
          : tr('Mikään juna ei aja tästä nyt. Rata maksaa silti ylläpitoa.', 'No train runs here now. The track still costs upkeep.')}
      </p>
      <div className="row">
        <button className="btn" onClick={onClose}>
          {tr('Pidä', 'Keep')}
        </button>
        <button className="btn danger" data-act="remove" onClick={onRemove}>
          {tr('Pura', 'Remove')} +{money(back)}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- stations

function CargoRow({ items }: { items: { c: Cargo; text: string; cls?: string }[] }) {
  if (!items.length) return <span className="none">{tr('ei mitään', 'nothing')}</span>;
  return (
    <span className="cargo-row">
      {items.map((o) => (
        <span key={o.c} className={`cg ${o.cls ?? ''}`}>
          <Icon c={o.c} />
          <b>{o.text}</b>
        </span>
      ))}
    </span>
  );
}

function SpotCard({ s, card, onSize, onBuild, onBond, onClose }: { s: SimState; card: { cell: number; ok: boolean; size: StationSize }; onSize: (n: StationSize) => void; onBuild: () => void; onBond: () => void; onClose: () => void }) {
  const why = stationBlock(s, card.cell);
  const sup = suppliesAt(s, card.cell, card.size);
  const acc = acceptsAt(s, card.cell, card.size);
  const def = STATIONS[card.size];
  const short = def.price > s.cash;
  const reason = { notrack: tr('Asema tarvitsee radan.', 'A station needs track.'), bend: tr('Asema tarvitsee suoran radan, ei mutkaa eikä vaihdetta.', 'A station needs straight track, no bend or junction.'), bridge: tr('Ei sillalle.', 'Not on a bridge.'), near: tr('Liian lähellä toista asemaa.', 'Too near another station.') };
  return (
    <>
      <CardHead title={tr('Uusi asema', 'New station')} onClose={onClose} />
      <div className="seg">
        {([0, 1, 2] as StationSize[]).map((k) => (
          <button key={k} className={k === card.size ? 'on' : ''} data-act={`size-${k}`} onClick={() => onSize(k)}>
            <b>{tt(STATIONS[k].name)}</b>
            <span>
              {money(STATIONS[k].price)} · {2 * STATIONS[k].radius + 1}×{2 * STATIONS[k].radius + 1}
            </span>
          </button>
        ))}
      </div>
      <div className="lines">
        <div>
          <small>{tr('Kerää kuukaudessa', 'Gathers a month')}</small>
          <CargoRow items={(Object.keys(sup) as Cargo[]).filter((c) => (sup[c] ?? 0) > 0.01).map((c) => ({ c, text: (sup[c] ?? 0).toFixed(1) }))} />
        </div>
        <div>
          <small>{tr('Ottaa vastaan', 'Takes')}</small>
          <CargoRow items={acc.map((c) => ({ c, text: '' }))} />
        </div>
      </div>
      {why && <p className="warn">{reason[why]}</p>}
      <p className="small">
        {tr('Ylläpito', 'Upkeep')} {money(def.upkeep)} {tr('vuodessa', 'a year')}
      </p>
      <div className="row">
        <button className="btn" onClick={onClose}>
          {tr('Peru', 'Cancel')}
        </button>
        {short && canIssue(s) ? (
          <button className="btn" data-act="bond" onClick={onBond}>
            {tr('Laina', 'Bond')} +{money(BOND)}
          </button>
        ) : null}
        <button className="btn primary" data-act="build" disabled={!!why || short} onClick={onBuild}>
          {tr('Rakenna', 'Build')} {money(def.price)}
        </button>
      </div>
    </>
  );
}

function StationCard({ s, st, onTrain, onBuy, onRemove, onClose }: { s: SimState; st: Station; onTrain: (t: Train) => void; onBuy: () => void; onRemove: () => void; onClose: () => void }) {
  const sup = suppliesAt(s, st.cell, st.size);
  const acc = acceptsAt(s, st.cell, st.size);
  const trains = s.trains.filter((t) => t.route.some((p) => p.station === st.id));
  const waiting = CARGOS.filter((c) => (st.waiting[c] ?? 0) >= 0.5 || (sup[c] ?? 0) > 0.01);
  return (
    <>
      <CardHead title={st.name} sub={tt(STATIONS[st.size].name)} onClose={onClose} />
      <div className="lines">
        <div>
          <small>{tr('Odottaa · kuukaudessa', 'Waiting · a month')}</small>
          <CargoRow items={waiting.map((c) => ({ c, text: `${Math.floor(st.waiting[c] ?? 0)} · ${(sup[c] ?? 0).toFixed(1)}` }))} />
        </div>
        <div>
          <small>{tr('Ottaa vastaan · hinta nyt', 'Takes · price now')}</small>
          <CargoRow items={acc.map((c) => ({ c, text: pct(glutFactor(st, c)), cls: glutFactor(st, c) < 0.6 ? 'low' : '' }))} />
        </div>
      </div>
      {trains.length > 0 && (
        <div className="list">
          {trains.map((t) => (
            <button key={t.id} className="item" onClick={() => onTrain(t)}>
              <span>
                {tr('Juna', 'Train')} {t.name} · {tt(LOCOS[t.loco].name)}
              </span>
              <b className={t.earnedYear - t.costYear < 0 ? 'red' : 'gold'}>{money(t.earnedYear - t.costYear)}</b>
            </button>
          ))}
        </div>
      )}
      <div className="row">
        <button className="btn danger" data-act="remove-station" onClick={onRemove}>
          {tr('Pura', 'Remove')}
        </button>
        <button className="btn primary" data-act="buy-here" onClick={onBuy}>
          {tr('Juna täältä', 'Train from here')}
        </button>
      </div>
    </>
  );
}

function SiteCard({ s, id, onStation, onClose }: { s: SimState; id: string; onStation: (id: number) => void; onClose: () => void }) {
  const site = s.sites.find((o) => o.id === id)!;
  const raw = RAW[site.kind];
  const conv = CONVERTS[site.kind];
  const served = s.stations.filter((st) => covered(s, st.cell, st.size).some((o) => o.site === site));
  const need = GROW_BASE + GROW_PER * site.homes.length;
  return (
    <>
      <CardHead title={tt(site.name)} sub={tt(KIND_NAME[site.kind])} onClose={onClose} />
      <div className="lines">
        {raw && (
          <div>
            <small>{tr('Tuottaa kuukaudessa', 'Makes a month')}</small>
            <CargoRow items={[{ c: raw, text: site.rate.toFixed(1) }]} />
          </div>
        )}
        {conv && (
          <div>
            <small>{tr('Jalostaa', 'Turns')}</small>
            <span className="cargo-row">
              <span className="cg">
                <Icon c={conv.from} />
              </span>
              <span className="arrow">→</span>
              <span className="cg">
                <Icon c={conv.to} />
                <b>
                  {site.madeLast.toFixed(1)} {tr('viime kk', 'last month')}
                </b>
              </span>
            </span>
          </div>
        )}
        {site.kind === 'town' && (
          <>
            <div>
              <small>{tr('Taloja', 'Houses')}</small>
              <b className="big">{site.homes.length}</b>
            </div>
            <div>
              <small>{tr('Kasvu seuraavaan taloon', 'Growth to the next house')}</small>
              <span className="bar">
                <i style={{ width: `${Math.min(100, (site.growth / need) * 100)}%` }} />
              </span>
            </div>
            <div>
              <small>{tr('Haluaa', 'Wants')}</small>
              <CargoRow items={(['pax', 'mail', 'food', 'lumber', ...(site.homes.length >= 14 ? ['paper'] : [])] as Cargo[]).map((c) => ({ c, text: '' }))} />
            </div>
          </>
        )}
      </div>
      <p className="small">
        {site.kind === 'town'
          ? tr('Kaupunki kasvaa jokaisesta toimituksesta ja matkustajasta. Iso kaupunki ostaa myös paperia.', 'A town grows from every delivery and every passenger. A large town also buys paper.')
          : conv
            ? tr(`Tuo ${cargoName(conv.from)} asemalle tämän vierellä, niin ${cargoName(conv.to)} odottaa samalla asemalla.`, `Bring ${cargoName(conv.from)} to a station beside it, and ${cargoName(conv.to)} waits at that station.`)
            : tr('Rakenna asema niin, että sen neliö peittää rakennukset.', 'Build a station whose square covers the buildings.')}
      </p>
      {served.length > 0 && (
        <div className="list">
          {served.map((st) => (
            <button key={st.id} className="item" onClick={() => onStation(st.id)}>
              <span>{st.name}</span>
              <b>›</b>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- trains

function ConsistPic({ loco, cars }: { loco: LocoId; cars: Cargo[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const S = 18;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = 8 + (1.05 + cars.length * 0.77) * S * 1.1;
    c.width = w * dpr;
    c.height = 22 * dpr;
    c.style.width = `${w}px`;
    const x = c.getContext('2d')!;
    x.scale(dpr, dpr);
    let px = w - 4;
    x.save();
    x.translate(px - (1.05 * S) / 2, 11);
    drawEngine(x, 1.05 * S, S * 0.8, loco);
    x.restore();
    px -= 1.05 * S + 2;
    for (const g of cars) {
      x.save();
      x.translate(px - (0.72 * S) / 2, 11);
      drawWagon(x, 0.72 * S, S * 0.8, g, 1);
      x.restore();
      px -= 0.72 * S + 2;
    }
  }, [loco, cars.join()]);
  return <canvas ref={ref} className="consist" />;
}

function TrainCard({ s, t, onEdit, onClose }: { s: SimState; t: Train; onEdit: (t: Train) => void; onClose: () => void }) {
  const [replace, setReplace] = useState(false);
  const L = LOCOS[t.loco];
  const rel = reliability(s, t);
  const state = { run: tr('ajaa', 'running'), stop: t.waiting ? tr('odottaa täyttä kuormaa', 'waiting for a full load') : tr('asemalla', 'at a station'), broken: tr('rikki', 'broken down'), lost: tr('ei reittiä radalla', 'no way over the track') }[t.state];
  const value = locoValue(s, t);
  return (
    <>
      <CardHead
        title={
          <>
            {tr('Juna', 'Train')} {t.name} <small>{tt(L.name)}</small>
          </>
        }
        sub={<span className={t.state === 'broken' || t.state === 'lost' ? 'red' : ''}>{state}</span>}
        onClose={onClose}
      />
      <ConsistPic loco={t.loco} cars={t.cars.map((c) => c.cargo)} />
      <div className="facts">
        <div>
          <small>{tr('Tänä vuonna', 'This year')}</small>
          <b className={t.earnedYear - t.costYear < 0 ? 'red' : 'gold'}>{money(t.earnedYear - t.costYear)}</b>
        </div>
        <div>
          <small>{tr('Viime vuonna', 'Last year')}</small>
          <b className={t.earnedLast - t.costLast < 0 ? 'red' : ''}>{money(t.earnedLast - t.costLast)}</b>
        </div>
        <div>
          <small>{tr('Ikä', 'Age')}</small>
          <b>
            {ageOf(s, t).toFixed(1)} {tr('v', 'y')}
          </b>
        </div>
        <div>
          <small>{tr('Luotettavuus', 'Reliability')}</small>
          <b className={rel < 0.6 ? 'red' : ''}>{pct(rel)}</b>
        </div>
      </div>
      <div className="stops">
        {t.route.map((p, k) => (
          <div key={k} className={`stop${t.next === k ? ' next' : ''}`}>
            <em>{k + 1}</em>
            <span className="nm">{stationById(s, p.station)?.name ?? '?'}</span>
            <span className="cars">
              {p.cars.length ? p.cars.map((c, j) => <Icon key={j} c={c} />) : <span className="none">{tr('tyhjänä', 'empty')}</span>}
              {p.waitFull && <small>{tr('täysi', 'full')}</small>}
            </span>
          </div>
        ))}
      </div>
      <p className="small">
        {tr('Ylläpito', 'Upkeep')} {money(locoUpkeep(s, t))}/{tr('v', 'y')} · {tr('rikkoutunut', 'breakdowns')} {t.breakdowns}
      </p>
      {replace ? (
        <div className="locos">
          {locosOnSale(s).map((id) => (
            <button
              key={id}
              className="loco"
              data-act={`replace-${id}`}
              disabled={LOCOS[id].price - value > s.cash}
              onClick={() => {
                if (replaceLoco(s, t.id, id)) setReplace(false);
              }}
            >
              <b>{tt(LOCOS[id].name)}</b>
              <span>{money(LOCOS[id].price - value)}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="row">
          <button className="btn danger" data-act="sell" onClick={() => sellTrain(s, t.id) && onClose()}>
            {tr('Myy', 'Sell')} +{money(value)}
          </button>
          <button className="btn" data-act="replace" onClick={() => setReplace(true)}>
            {tr('Uusi veturi', 'New loco')}
          </button>
          <button className="btn primary" data-act="edit-route" onClick={() => onEdit(t)}>
            {tr('Reitti', 'Route')}
          </button>
        </div>
      )}
    </>
  );
}

/** a route's numbers for a locomotive: seconds a round, and what one round pays when the cars run full */
function routeEstimate(s: SimState, stops: Stop[], loco: LocoId): { round: number | null; pays: number; legs: (number | null)[] } {
  const sts = stops.map((p) => stationById(s, p.station));
  const legs: (number | null)[] = [];
  let round = 0;
  let pays = 0;
  for (let k = 0; k < stops.length; k++) {
    const a = sts[k];
    const b = sts[(k + 1) % stops.length];
    if (!a || !b) return { round: null, pays: 0, legs };
    const path = legPath(s, a, b);
    const weight = LOCOS[loco].weight + stops[k].cars.reduce((n, c) => n + (CAR_FULL[c] + CAR_EMPTY) / 2, 0);
    const sec = path ? runTime(s, path, path.map((c) => s.rail[c]), loco, weight) : null;
    legs.push(sec);
    if (sec === null) return { round: null, pays: 0, legs };
    round += sec + 1 + stops[k].cars.length * 0.7;
    // each car's load pays at the first later stop that takes its cargo
    for (const c of stops[k].cars)
      for (let j = 1; j < stops.length; j++) {
        const to = sts[(k + j) % stops.length]!;
        if (acceptsAt(s, to.cell, to.size).includes(c)) {
          if (crow(s, a.cell, to.cell) >= 1) pays += quote(s, c, a, to);
          break;
        }
      }
  }
  return { round, pays, legs };
}

function RouteCard({ s, card, onChange, onDone, onClose }: { s: SimState; card: Extract<Card, { kind: 'route' }>; onChange: (c: Card) => void; onDone: (t: Train | null) => void; onClose: () => void }) {
  const [adding, setAdding] = useState<number | null>(null);
  const stops = card.stops;
  const set = (stops2: Stop[]) => onChange({ ...card, stops: stops2 });
  const est = routeEstimate(s, stops, card.loco);
  const editing = card.trainId !== null ? s.trains.find((t) => t.id === card.trainId) : null;
  const L = LOCOS[card.loco];
  const perYear = est.round ? YEAR_SECONDS / est.round : 0;
  return (
    <>
      <CardHead title={editing ? `${tr('Juna', 'Train')} ${editing.name}: ${tr('reitti', 'route')}` : tr('Uusi juna', 'New train')} sub={stops.length < 2 ? tr('Napauta asemia kartalla', 'Tap stations on the map') : undefined} onClose={onClose} />
      <div className="stops edit">
        {stops.map((p, k) => (
          <div key={k} className="stop">
            <em>{k + 1}</em>
            <span className="nm">{stationById(s, p.station)?.name ?? '?'}</span>
            <span className="cars">
              {p.cars.map((c, j) => (
                <button key={j} className="car" data-act={`car-${k}-${j}`} aria-label={tr('Poista vaunu', 'Remove car')} onClick={() => set(stops.map((q, i) => (i === k ? { ...q, cars: q.cars.filter((_, x) => x !== j) } : q)))}>
                  <Icon c={c} />
                </button>
              ))}
              {p.cars.length < CARS_MAX && (
                <button className="car add" data-act={`add-car-${k}`} onClick={() => setAdding(adding === k ? null : k)}>
                  +
                </button>
              )}
            </span>
            <button className={`full${p.waitFull ? ' on' : ''}`} data-act={`full-${k}`} onClick={() => set(stops.map((q, i) => (i === k ? { ...q, waitFull: !q.waitFull } : q)))}>
              {tr('täysi', 'full')}
            </button>
            <button className="x" data-act={`drop-stop-${k}`} aria-label={tr('Poista pysäkki', 'Remove stop')} onClick={() => set(stops.filter((_, i) => i !== k))}>
              ×
            </button>
          </div>
        ))}
        {adding !== null && stops[adding] && (
          <div className="picker">
            {CARGOS.map((c) => (
              <button key={c} data-act={`pick-${c}`} onClick={() => set(stops.map((q, i) => (i === adding ? { ...q, cars: [...q.cars, c].slice(0, CARS_MAX) } : q)))}>
                <Icon c={c} />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="locos">
        {locosOnSale(s).map((id) => (
          <button key={id} className={`loco${card.loco === id ? ' on' : ''}`} data-act={`loco-${id}`} onClick={() => onChange({ ...card, loco: id })}>
            <b>{tt(LOCOS[id].name)}</b>
            <span>{money(LOCOS[id].price)}</span>
            <span className="stats">
              <i style={{ width: `${(LOCOS[id].speed / 5) * 100}%` }} title="speed" />
              <i className="pw" style={{ width: `${(LOCOS[id].power / 3.3) * 100}%` }} title="power" />
            </span>
          </button>
        ))}
      </div>
      <p className="small">
        {tt(L.blurb)}. {tr('Nopeus', 'Speed')} {L.speed} · {tr('veto', 'pull')} {L.power} · {tr('ylläpito', 'upkeep')} {money(L.upkeep)}/{tr('v', 'y')}
      </p>
      {stops.length >= 2 && (
        <div className="facts">
          <div>
            <small>{tr('Kierros', 'A round')}</small>
            <b className={est.round === null ? 'red' : ''}>{est.round === null ? tr('ei rataa', 'no track') : `${Math.round(est.round)} s`}</b>
          </div>
          <div>
            <small>{tr('Kierroksia vuodessa', 'Rounds a year')}</small>
            <b>{perYear.toFixed(1)}</b>
          </div>
          <div>
            <small>{tr('Täysi kierros tuo', 'A full round pays')}</small>
            <b className="gold">{money(est.pays)}</b>
          </div>
        </div>
      )}
      <div className="row">
        <button className="btn" onClick={onClose}>
          {tr('Peru', 'Cancel')}
        </button>
        {editing ? (
          <button className="btn primary" data-act="save-route" disabled={stops.length < 2} onClick={() => setRoute(s, editing.id, stops) && onDone(editing)}>
            {tr('Tallenna', 'Save')}
          </button>
        ) : (
          <button
            className="btn primary"
            data-act="buy"
            disabled={stops.length < 2 || L.price > s.cash || est.round === null}
            onClick={() => {
              const t = buyTrain(s, card.loco, stops);
              if (t) {
                track('train', { loco: card.loco, stops: stops.length, cars: stops.reduce((n, p) => n + p.cars.length, 0) });
                onDone(t);
              }
            }}
          >
            {tr('Osta', 'Buy')} {money(L.price)}
          </button>
        )}
      </div>
    </>
  );
}

function TrainsCard({ s, onTrain, onClose }: { s: SimState; onTrain: (t: Train) => void; onClose: () => void }) {
  return (
    <>
      <CardHead title={tr('Junat', 'Trains')} sub={`${s.trains.length}`} onClose={onClose} />
      {!s.trains.length && <p className="small">{tr('Ei junia vielä. Rakenna rata ja kaksi asemaa, sitten Juna.', 'No trains yet. Lay track and two stations, then Train.')}</p>}
      <div className="list">
        {s.trains.map((t) => (
          <button key={t.id} className="item" data-act={`train-${t.id}`} onClick={() => onTrain(t)}>
            <span>
              {t.state === 'broken' ? '⚠ ' : t.state === 'lost' ? '? ' : ''}
              {t.name} · {tt(LOCOS[t.loco].name)} · {t.route.map((p) => stationById(s, p.station)?.name ?? '?').join(' – ')}
            </span>
            <b className={t.earnedYear - t.costYear < 0 ? 'red' : 'gold'}>{money(t.earnedYear - t.costYear)}</b>
          </button>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- money, goal, cargo, menu, result

function MoneyCard({ s, onClose }: { s: SimState; onClose: () => void }) {
  const up = upkeepYear(s);
  const b = s.book;
  const profit = b.revenue - b.fuel - b.upkeep - b.repairs - b.interest;
  const years = [...s.history.map((y) => ({ year: y.year, profit: y.profit, worth: y.worth })), { year: s.year, profit, worth: worth(s) }];
  return (
    <>
      <CardHead title={tr('Talous', 'Finances')} sub={`${tr('Arvo', 'Worth')} ${money(worth(s))}`} onClose={onClose} />
      <Chart years={years} />
      <div className="facts">
        <div>
          <small>{tr('Kassa', 'Cash')}</small>
          <b className={s.cash < 0 ? 'red' : 'gold'}>{money(s.cash)}</b>
        </div>
        <div>
          <small>{tr('Velka', 'Debt')}</small>
          <b>{money(debt(s))}</b>
        </div>
        <div>
          <small>{tr('Luottoa jäljellä', 'Credit left')}</small>
          <b>{money(Math.max(0, creditLimit(s) - debt(s)))}</b>
        </div>
        <div>
          <small>{tr('Korko vuodessa', 'Interest a year')}</small>
          <b>{money(interestYear(s))}</b>
        </div>
      </div>
      <table className="book">
        <tbody>
          <tr>
            <td>{tr('Tulot tänä vuonna', 'Revenue this year')}</td>
            <td className="num gold">{money(b.revenue)}</td>
          </tr>
          <tr>
            <td>{tr('Polttoaine', 'Fuel')}</td>
            <td className="num">−{money(b.fuel)}</td>
          </tr>
          <tr>
            <td>
              {tr('Ylläpito', 'Upkeep')} <small>({tr('vuodessa', 'a year')}: {tr('rata', 'track')} {money(up.track)}, {tr('asemat', 'stations')} {money(up.stations)}, {tr('veturit', 'locos')} {money(up.locos)})</small>
            </td>
            <td className="num">−{money(b.upkeep)}</td>
          </tr>
          <tr>
            <td>{tr('Korjaukset', 'Repairs')}</td>
            <td className="num">−{money(b.repairs)}</td>
          </tr>
          <tr>
            <td>{tr('Korot', 'Interest')}</td>
            <td className="num">−{money(b.interest)}</td>
          </tr>
          <tr className="total">
            <td>{tr('Tulos', 'Profit')}</td>
            <td className={`num ${profit < 0 ? 'red' : 'gold'}`}>{money(profit)}</td>
          </tr>
        </tbody>
      </table>
      {s.red > 0 && <p className="warn">{tr(`Kassa miinuksella eikä luottoa: konkurssi ${3 - s.red} kuukauden päästä.`, `Cash below zero and no credit: bankrupt in ${3 - s.red} months.`)}</p>}
      <div className="row">
        <button className="btn" data-act="repay" disabled={!s.bonds.length || s.cash < BOND} onClick={() => repayBond(s)}>
          {tr('Maksa laina', 'Repay bond')} −{money(BOND)}
        </button>
        <button className="btn primary" data-act="issue" disabled={!canIssue(s)} onClick={() => issueBond(s)}>
          {tr('Ota laina', 'Issue bond')} +{money(BOND)} <small>{Math.round(nextBondRate(s) * 100)} %</small>
        </button>
      </div>
      <p className="small">{tr('Arvo = kassa − velka + puolet radan ja asemien hinnasta + veturien arvo.', 'Worth = cash − debt + half the price of track and stations + the locos’ value.')} ({money(bookValue(s))})</p>
    </>
  );
}

function goalLine(s: SimState): string {
  const g = s.scenario.goal;
  return g.kind === 'worth'
    ? tr(`Yhtiön arvo vuoden ${g.byYear} loppuun mennessä`, `Company worth by the end of ${g.byYear}`)
    : tr(`Kuljeta ${tt(CARGO_NAME[g.cargo])} vuoden ${g.byYear} loppuun mennessä`, `Haul ${tt(CARGO_NAME[g.cargo])} by the end of ${g.byYear}`);
}

function GoalCard({ s, onClose }: { s: SimState; onClose: () => void }) {
  const g = s.scenario.goal;
  const v = goalValue(s);
  const fmt = (n: number) => (g.kind === 'worth' ? money(n) : String(Math.floor(n)));
  const names = [tr('Pronssi', 'Bronze'), tr('Hopea', 'Silver'), tr('Kulta', 'Gold')];
  const left = g.byYear - s.year + 1 - s.yearFrac;
  return (
    <>
      <CardHead title={tt(s.scenario.name)} sub={goalLine(s)} onClose={onClose} />
      <div className="tiers">
        {g.tiers.map((n, k) => (
          <div key={k} className={`tier${v >= n ? ' done' : ''}`}>
            <span className={`medal t${k + 1}`} />
            <b>{names[k]}</b>
            <span>{fmt(n)}</span>
            <span className="bar">
              <i style={{ width: `${Math.min(100, (v / n) * 100)}%` }} />
            </span>
          </div>
        ))}
      </div>
      <p className="small">
        {tr('Nyt', 'Now')} <b>{fmt(v)}</b>. {tr('Aikaa', 'Time left')} {left.toFixed(1)} {tr('vuotta', 'years')}.{' '}
        {tr('Kulta päättää pelin heti. Ilman pronssia määräaikaan mennessä peli on hävitty, ja niin myös konkurssissa.', 'Gold ends the game at once. Without bronze by the deadline the game is lost, and so it is after a bankruptcy.')}
      </p>
    </>
  );
}

function CargoCard({ s, on, onPick, onClose }: { s: SimState; on: Cargo | null; onPick: (c: Cargo | null) => void; onClose: () => void }) {
  void s;
  return (
    <>
      <CardHead title={tr('Lasti kartalla', 'Cargo on the map')} sub={tr('Vihreä: tuotetaan. Sininen: otetaan vastaan.', 'Green: made here. Blue: taken here.')} onClose={onClose} />
      <div className="picker big">
        {CARGOS.map((c) => (
          <button key={c} className={on === c ? 'on' : ''} data-act={`cargo-${c}`} onClick={() => onPick(on === c ? null : c)}>
            <Icon c={c} />
            <span>{cargoName(c)}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function MenuCard({ muted, onMute, onQuit, onAgain, onClose }: { muted: boolean; onMute: () => void; onQuit: () => void; onAgain: () => void; onClose: () => void }) {
  return (
    <>
      <CardHead title="Raide" sub={BUILD_NAME} onClose={onClose} />
      <div className="col">
        <button className="btn wide" onClick={onMute}>
          {muted ? tr('Äänet päälle', 'Sound on') : tr('Äänet pois', 'Sound off')}
        </button>
        <button className="btn wide" onClick={onAgain}>
          {tr('Aloita alusta', 'Start again')}
        </button>
        <button className="btn wide danger" onClick={onQuit}>
          {tr('Lopeta', 'Quit')}
        </button>
      </div>
    </>
  );
}

function ResultCard({ s, onAgain, onQuit }: { s: SimState; onAgain: () => void; onQuit: () => void }) {
  const r = s.result!;
  const names = ['', tr('Pronssi', 'Bronze'), tr('Hopea', 'Silver'), tr('Kulta', 'Gold')];
  const why =
    r.reason === 'bankrupt'
      ? tr('Kassa oli miinuksella kolme kuukautta eikä luottoa ollut. Yhtiö meni konkurssiin.', 'The cash was below zero for three months with no credit left. The company went bankrupt.')
      : r.won
        ? tr(`Tavoite saavutettu: ${names[r.tier]}.`, `Goal reached: ${names[r.tier]}.`)
        : tr('Määräaika meni ohi ilman pronssia.', 'The deadline passed without bronze.');
  const years = s.history.map((y) => ({ year: y.year, profit: y.profit, worth: y.worth }));
  return (
    <div className="card overlay result" data-card="result">
      <h2>{r.won ? tr('Voitto', 'Won') : tr('Hävisit', 'Lost')}</h2>
      {r.won && <span className={`medal big t${r.tier}`} />}
      <p>{why}</p>
      <p className="small">
        {tr('Yhtiön arvo', 'Company worth')} <b>{money(r.worth)}</b> · {r.year}
      </p>
      {years.length > 0 && <Chart years={years} />}
      <button className="btn primary wide" data-act="again" onClick={onAgain}>
        {tr('Uudestaan', 'Play again')}
      </button>
      <button className="btn wide" onClick={onQuit}>
        {tr('Valikkoon', 'Menu')}
      </button>
    </div>
  );
}
