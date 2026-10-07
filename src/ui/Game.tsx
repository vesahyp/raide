/**
 * The game screen: the canvas, the loop, the HUD and the cards. The sim
 * lives in a ref and survives a turn of the phone; the HUD reads it a few
 * times a second; the cards open on the sim's events (a build, a choice of
 * routes, a year end, the result) and on taps: a line, a train, a site.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EngineId, Good, Line, ScenarioDef, SimState, Site, Train, WagonType } from '../game/types';
import { createState, siteById, goodsOnMap, stationAt } from '../game/state';
import { DT, step, buyTrain, undo, closeYearEnd, trainPrice, note, price, plan, build, addWagon, setEngine, setFullLoad, sellTrain, demand, goalProgress, lineOf, buyers, moveTrain, buyCrew, dwellAt, canMove, lineTrips, tripTimes, gradeFactor, defaultWagons } from '../game/sim';
import { CREW_PRICE, ENGINES, ENGINE_LEN, GOOD_NAME, GROW_NEED, MAKES, MONTHS, RAW_CAP, STOP_SECONDS, RAW_RATE, RESALE, TAKES, WAGON_GOODS, WAGON_LEN, WAGON_NAME, WAGON_PRICE, WAGONS_MAX, wagonFor } from '../game/content/economy';
import { idx, type Route } from '../game/grid';
import { earthWord, gradeText, GRADE_COL, perYear, routeKm, tripsByEngine } from './routeinfo';
import { Renderer2D, OPTION_COLOUR } from '../render/render2d';
import { drawEngine, drawWagon } from '../render/draw2d';
import { Input } from '../input/input';
import { Bot } from '../../tools/bot';
import { tr, t as tt, num } from '../i18n';
import { play, unlock, isMuted, setMuted } from '../audio';
import { track } from '../track';
import { saveStars } from '../results';
import { YearEndCard } from './Ledger';

type Card =
  | { kind: 'line'; lineId: number }
  | { kind: 'train'; trainId: number }
  | { kind: 'site'; siteId: string }
  | { kind: 'choice'; options: Route[]; sx: number; sy: number }
  | { kind: 'yearEnd' }
  | { kind: 'result' }
  | { kind: 'pause' }
  | null;

interface Hud {
  year: number;
  month: number;
  cash: number;
  goal: number;
  goalText: string;
}

export function Game({ scenario, onQuit, onAgain }: { scenario: ScenarioDef; onQuit: () => void; onAgain: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const rendRef = useRef<Renderer2D | null>(null);
  const simRef = useRef<SimState | null>(null);
  if (!simRef.current) simRef.current = createState(scenario);
  const s = simRef.current;
  const [hud, setHud] = useState<Hud>(() => readHud(s));
  const [card, setCard] = useState<Card>(null);
  const [cancel, setCancel] = useState<{ x: number; y: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMutedState] = useState(isMuted());
  const [, bump] = useState(0);
  // pick mode, from the site card's "lay track from here": the site the track starts at or ends at
  const [lay, setLay] = useState<{ siteId: string } | null>(null);
  const inputRef = useRef<Input | null>(null);
  const cardRef = useRef<Card>(null);
  cardRef.current = card;
  const pausedRef = useRef(false);
  pausedRef.current = paused || (card !== null && card.kind !== 'line' && card.kind !== 'train' && card.kind !== 'site');

  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new Renderer2D(canvas, overlayRef.current!, s);
    rendRef.current = renderer;
    const params = new URLSearchParams(location.search);
    const speed = Math.max(0.25, Number(params.get('speed') ?? 1));
    const bot = params.get('bot') === '1' ? Bot.for(s) : null;
    // ?ledger=2 with the bot: the year-end card opens at the second year end instead of the bot closing it (the pictures)
    const holdLedger = Number(params.get('ledger') ?? 0);
    const w = window as unknown as { __sim?: SimState; __input?: Input; __renderer?: Renderer2D; __pace?: number; __plan?: (a: number, b: number) => unknown; __act?: Record<string, unknown> };
    w.__sim = s;
    w.__renderer = renderer;
    w.__pace = speed;
    w.__plan = (a, b) => plan(s, a, b);
    // the player's moves, for the scripts that set a scene up
    w.__act = { plan: (a: number, b: number) => plan(s, a, b), build: (r: Route) => build(s, r), buyTrain: (l: number, wg: WagonType, e: EngineId, n?: number) => buyTrain(s, l, wg, e, n), moveTrain: (t: number, l: number) => moveTrain(s, t, l) };
    const input = new Input(
      canvas,
      s,
      renderer,
      {
        onBuild: (line, sx, sy) => {
          track('build', { scenario: scenario.id, cost: s.lastBuild?.cost ?? 0, bridge: s.lastBuild ? s.lastBuild.cells.filter((c) => s.water[c]).length : 0 });
          setCancel({ x: sx, y: sy });
          setCard({ kind: 'line', lineId: line.id });
        },
        onChoice: (options, sx, sy) => setCard({ kind: 'choice', options, sx, sy }),
        onLine: (line) => setCard({ kind: 'line', lineId: line.id }),
        onTrain: (train) => {
          renderer.follow(train);
          setCard({ kind: 'train', trainId: train.id });
        },
        onSite: (site) => setCard({ kind: 'site', siteId: site.id }),
        onGround: () => {
          renderer.follow(null);
          setCard((c) => (c && (c.kind === 'line' || c.kind === 'train' || c.kind === 'site') ? null : c));
        },
        onNote: (cell) => note(s, cell, tr('Ei rahaa', 'No cash')),
        onAny: () => unlock(),
        onLayEnd: (kept) => {
          renderer.endPick(kept);
          setLay(null);
        },
      },
    );
    inputRef.current = input;
    w.__input = input;
    track('scenario_start', { scenario: scenario.id });
    const start = siteById(s, scenario.startStation);
    const first = s.sites.find((x) => x.id !== scenario.startStation && TAKES[x.kind].includes(MAKES[start.kind]!)) ?? s.sites[1];
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
          if (bot && !(holdLedger > 0 && s.yearEnd && s.history.length >= holdLedger)) bot.act(s);
          step(s);
          acc -= DT;
          n++;
        }
      }
      // the sim's own stops open their cards
      if (s.result && cardRef.current?.kind !== 'result') {
        saveStars(scenario.id, s.result.stars);
        track('scenario_end', { scenario: scenario.id, won: s.result.won, year: s.result.year, cash: s.result.cash, stars: s.result.stars });
        setCard({ kind: 'result' });
      } else if (s.yearEnd && !s.result && cardRef.current?.kind !== 'yearEnd') {
        if (bot && !(holdLedger > 0 && s.history.length >= holdLedger)) bot.act(s);
        else setCard({ kind: 'yearEnd' });
      }
      for (const name of s.sounds) play(name);
      s.sounds.length = 0;
      if (!s.lastBuild) setCancel((c) => (c ? null : c));
      const c = cardRef.current;
      input.update(real);
      renderer.draw(real * speed, input.drag, hint, c?.kind === 'choice' ? c.options : null);
      if (++frame % 6 === 0) {
        setHud(readHud(s));
        // the open card's numbers follow the sim
        if (c && (c.kind === 'line' || c.kind === 'train' || c.kind === 'site')) bump((x) => x + 1);
      }
    };
    raf = requestAnimationFrame(tick);
    const onVis = () => {
      if (document.visibilityState !== 'visible') setPaused(true);
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

  // the map and the fingers follow the pick mode; a card that opens ends it
  useEffect(() => {
    const site = lay ? siteById(s, lay.siteId) : null;
    const cell = site ? idx(s, site.cx, site.cy) : null;
    const reverse = cell !== null && !stationAt(s, cell);
    if (rendRef.current) {
      rendRef.current.laying = cell === null ? null : { from: cell, reverse };
      if (cell !== null && !rendRef.current.picking) rendRef.current.beginPick();
    }
    if (inputRef.current) inputRef.current.laying = cell === null ? null : { cell, reverse };
  }, [lay, s]);
  useEffect(() => {
    if (card && lay) {
      rendRef.current?.endPick(true);
      setLay(null);
    }
  }, [card, lay]);

  const goal = scenario.goal;
  const close = () => setCard(null);
  const line = card?.kind === 'line' ? s.lines.find((l) => l.id === card.lineId) ?? null : null;
  const train = card?.kind === 'train' ? s.trains.find((t) => t.id === card.trainId) ?? null : null;
  const site = card?.kind === 'site' ? s.sites.find((x) => x.id === card.siteId) ?? null : null;

  return (
    <div className="game">
      <canvas ref={canvasRef} />
      <div className="map-overlay" ref={overlayRef} />
      <GoodIcons />
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
          <span className="label">{goal.kind === 'deliver' ? tr('Laudat', 'Boards') : tr(`Koko ${goal.size}`, `Size ${goal.size}`)}</span>
          <span className="num">{hud.goalText}</span>
          <span className="bar">
            <i style={{ width: `${Math.min(100, 100 * hud.goal)}%` }} />
          </span>
          <span className="until">{tr('ennen', 'before')} {goal.beforeYear}</span>
        </div>
        <div className={`hud-cash num${hud.cash < 0 ? ' red' : ''}`}>{num(hud.cash)}</div>
        <button className="round pause" aria-label={tr('Tauko', 'Pause')} onClick={() => setCard({ kind: 'pause' })}>
          <svg viewBox="0 0 24 24" className="glyph"><rect x="6" y="5" width="4" height="14" fill="currentColor" /><rect x="14" y="5" width="4" height="14" fill="currentColor" /></svg>
        </button>
      </div>
      {lay && (
        <div className="pick-banner" data-ui>
          <span>{stationAt(s, idx(s, siteById(s, lay.siteId).cx, siteById(s, lay.siteId).cy)) ? tr('Napauta, minne rata menee', 'Tap where the track goes') : tr('Napauta asema, josta rata alkaa', 'Tap the station the track starts from')}</span>
          <button
            className="btn"
            data-act="pick-cancel"
            onClick={() => {
              rendRef.current?.endPick(false);
              setLay(null);
            }}
          >
            {tr('Peru', 'Cancel')}
          </button>
        </div>
      )}
      {card === null && !paused && (
        <div className="zoom" data-ui>
          <button className="round" aria-label={tr('Lähemmäs', 'Zoom in')} data-zoom="in" onClick={() => rendRef.current?.zoomStep(1)}>
            +
          </button>
          <button className="round" aria-label={tr('Kauemmas', 'Zoom out')} data-zoom="out" onClick={() => rendRef.current?.zoomStep(-1)}>
            −
          </button>
        </div>
      )}
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
      {card?.kind === 'choice' && (
        <ChoiceCard
          s={s}
          options={card.options}
          onPick={(r) => {
            if (r.cost > s.cash) {
              note(s, r.cells[r.cells.length - 1], tr('Ei rahaa', 'No cash'));
              return;
            }
            const l = build(s, r);
            if (l) {
              track('build', { scenario: scenario.id, cost: r.cost, bridge: r.bridge.length, cutting: r.cutting.length, mode: r.mode });
              setCancel({ x: card.sx, y: card.sy });
              setCard({ kind: 'line', lineId: l.id });
            }
          }}
          onClose={close}
        />
      )}
      {line && (
        <LineCard
          key={line.id}
          s={s}
          line={line}
          onBuy={(wagons, engine, count) => {
            const t = buyTrain(s, line.id, wagons, engine, count);
            if (t) {
              track('train', { scenario: scenario.id, wagons, engine, count });
              setCancel(null);
              setCard(null);
            }
          }}
          onTrain={(t) => setCard({ kind: 'train', trainId: t.id })}
          onClose={close}
        />
      )}
      {train && <TrainCard key={train.id} s={s} train={train} onClose={close} onSold={close} />}
      {site && (
        <SiteCard
          s={s}
          site={site}
          onClose={close}
          onLay={() => {
            setCard(null);
            setLay({ siteId: site.id });
          }}
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
  const goal = s.scenario.goal;
  const towns = s.sites.filter((x) => x.kind === 'town');
  const goalText = goal.kind === 'deliver' ? `${s.goalCount}/${goal.count}` : `${Math.min(goal.count, towns.filter((x) => x.size >= goal.size).length)}/${goal.count}`;
  return { year: s.year, month: s.month, cash: Math.floor(s.cash), goal: goalProgress(s), goalText };
}

function stopSites(s: SimState, line: Line): [Site, Site] {
  const a = s.stations.find((x) => x.id === line.stops[0])!;
  const b = s.stations.find((x) => x.id === line.stops[1])!;
  return [siteById(s, a.siteId), siteById(s, b.siteId)];
}

function CardHead({ title, onClose }: { title: React.ReactNode; onClose: () => void }) {
  return (
    <div className="card-head">
      <h2>{title}</h2>
      <button className="round close" aria-label={tr('Sulje', 'Close')} onClick={onClose}>
        ×
      </button>
    </div>
  );
}

/** Two routes to the same place: the cheap one and the short one, with what each costs and runs. */
function ChoiceCard({ s, options, onPick, onClose }: { s: SimState; options: Route[]; onPick: (r: Route) => void; onClose: () => void }) {
  const [a, b] = options;
  const name = (r: Route) => (r.bridge.length ? tr('Silta', 'Bridge') : r.cutting.length ? tr('Leikkaus', 'Cutting') : r.mode === 'cheap' ? tr('Kierto', 'Around') : tr('Suora', 'Direct'));
  return (
    <div className="card sheet choice-card" data-ui>
      <CardHead title={tr('Kumpaa kautta?', 'Which way?')} onClose={onClose} />
      <div className="routes">
        {[a, b].map((r, i) => {
          const earth = earthWord(r);
          return (
            <button key={r.mode} className="btn route" data-route={r.mode} disabled={r.cost > s.cash} style={{ borderColor: OPTION_COLOUR[i] }} onClick={() => onPick(r)}>
              <span className="swatch" style={{ background: OPTION_COLOUR[i] }} />
              <span className="name">{name(r)}</span>
              <span className="cost num">{r.cost}</span>
              <small>
                {routeKm(r)} km · <b style={{ color: GRADE_COL(r.worst) }}>{r.worst < 1 ? '' : '▲ '}{gradeText(r)}</b>
                {earth ? ` · ${earth.text}` : ''}
              </small>
              {tripsByEngine(s, r).map((x) => (
                <small key={x.engine} className="trips">
                  <i className={`pic eng${x.engine === 'jyry' ? ' strong' : ''}`} />
                  {tt(ENGINES[x.engine].name).replace(/^(Little |Pikku-)/, '')} {perYear(x.trips)}
                </small>
              ))}
            </button>
          );
        })}
      </div>
      <p className="small">{tr('Lyhyt rata tekee enemmän matkoja vuodessa. Jyrkässä nousussa kevyt veturi ryömii.', 'A short line makes more trips a year. On a steep climb the light engine crawls.')}</p>
    </div>
  );
}

/** a consist drawn small with the map's own sprites: engine at the right, wagons behind it, each with its load */
function Consist({ engine, wagons, n, cargo, good }: { engine: EngineId; wagons: WagonType; n: number; cargo: number; good: Good | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const S = 20;
  const w = Math.ceil((ENGINE_LEN + n * WAGON_LEN + n * 0.08) * S) + 4;
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = w * dpr;
    cv.height = Math.ceil(S * 0.9) * dpr;
    const c = cv.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, S);
    c.lineJoin = 'round';
    // the wagons from the left, the engine last, as the train stands when it has pulled in
    let x = 2;
    for (let i = n - 1; i >= 0; i--) {
      c.save();
      c.translate(x + (WAGON_LEN * S) / 2, (S * 0.9) / 2);
      drawWagon(c, WAGON_LEN * S, S, wagons, good, i < cargo ? 1 : 0);
      c.restore();
      x += (WAGON_LEN + 0.08) * S;
    }
    c.save();
    c.translate(x + (ENGINE_LEN * S) / 2, (S * 0.9) / 2);
    drawEngine(c, ENGINE_LEN * S, S, engine);
    c.restore();
  }, [engine, wagons, n, cargo, good, w]);
  return <canvas ref={ref} className="consist" style={{ width: w, height: Math.ceil(S * 0.9) }} />;
}

/** the wagon types that carry what the line's two ends make or take */
function wagonKinds(s: SimState, line: Line): WagonType[] {
  const [a, b] = stopSites(s, line);
  const goods = new Set<Good>([MAKES[a.kind], MAKES[b.kind], ...TAKES[a.kind], ...TAKES[b.kind]].filter((g): g is Good => !!g));
  const all = Object.keys(WAGON_GOODS) as WagonType[];
  const useful = all.filter((w) => WAGON_GOODS[w].some((g) => goods.has(g)));
  return useful.length ? useful : all;
}

/** the goods a wagon type carries on this line, for its icons */
function lineGoods(s: SimState, line: Line, w: WagonType): Good[] {
  const [a, b] = stopSites(s, line);
  const goods = new Set<Good>([MAKES[a.kind], MAKES[b.kind], ...TAKES[a.kind], ...TAKES[b.kind]].filter((g): g is Good => !!g));
  const own = WAGON_GOODS[w].filter((g) => goods.has(g));
  return own.length ? own : WAGON_GOODS[w];
}

/**
 * The buy card: the engine (each with its price, upkeep and the trips a year it makes on this
 * line), the wagon type with the goods it carries, the number of wagons, the total and Buy.
 */
function LineCard({ s, line, onBuy, onTrain, onClose }: { s: SimState; line: Line; onBuy: (w: WagonType, e: EngineId, n: number) => void; onTrain: (t: Train) => void; onClose: () => void }) {
  const [siteA, siteB] = stopSites(s, line);
  const kinds = wagonKinds(s, line);
  const startGood = MAKES[siteA.kind];
  const [wagons, setWagons] = useState<WagonType>(() => (startGood && kinds.includes(wagonFor(startGood)) ? wagonFor(startGood) : kinds[0]));
  const [count, setCount] = useState(() => defaultWagons(s));
  // the faster engine on this line is the one that makes more trips a year
  const [engine, setEngineId] = useState<EngineId>(() => [...s.scenario.engines].sort((x, y) => lineTrips(s, line, y, defaultWagons(s)) - lineTrips(s, line, x, defaultWagons(s)))[0]);
  const cost = trainPrice(engine, count);
  const trains = s.trains.filter((t) => t.lineId === line.id);
  const full = s.trains.length >= s.scenario.trainsMax;
  const can = !full && cost <= s.cash;
  const good = [MAKES[siteA.kind], MAKES[siteB.kind]].find((g): g is Good => !!g && WAGON_GOODS[wagons].includes(g)) ?? WAGON_GOODS[wagons][0];
  const dest = TAKES[siteA.kind].includes(good) ? siteA : TAKES[siteB.kind].includes(good) ? siteB : null;
  const pays = dest ? price(s, good, dest.id, line.dist[line.dist.length - 1]) : 0;
  return (
    <div className="card sheet buy-card" data-ui>
      <CardHead
        title={
          <>
            {tt(siteA.name)} <span className="arrow">⇄</span> {tt(siteB.name)}
          </>
        }
        onClose={onClose}
      />
      {trains.length > 0 && (
        <div className="train-rows">
          {trains.map((t) => (
            <button key={t.id} className="train-row" data-train={t.id} onClick={() => onTrain(t)}>
              <span className={`pic eng${t.engine === 'jyry' ? ' strong' : ''}`} />
              {Array.from({ length: t.nWagons }, (_, i) => (
                <span key={i} className={`pic ${t.wagons}`} />
              ))}
              <span className="row-text">
                {tt(ENGINES[t.engine].name)} · {t.cargo}/{t.nWagons} {t.good ? tt(GOOD_NAME[t.good]) : ''}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="buy-label">{tr('Veturi', 'Engine')}</div>
      <div className="wagons engines">
        {s.scenario.engines.map((e) => (
          <button key={e} className={`wagon${engine === e ? ' on' : ''}`} data-engine={e} onClick={() => setEngineId(e)}>
            <span className={`pic eng${e === 'jyry' ? ' strong' : ''}`} />
            <span>
              {tt(ENGINES[e].name)} <span className="num gold">{ENGINES[e].price}</span>
            </span>
            <small>
              {tr('ylläpito', 'upkeep')} {ENGINES[e].upkeep}/{tr('v', 'yr')}
            </small>
            <small className="trips-line">{perYear(lineTrips(s, line, e, count))} {tr('matkaa', 'trips')}</small>
          </button>
        ))}
      </div>
      <div className="buy-label">{tr('Vaunut', 'Wagons')}</div>
      <div className="wagons">
        {kinds.map((k) => (
          <button key={k} className={`wagon${wagons === k ? ' on' : ''}`} data-wagon={k} onClick={() => setWagons(k)}>
            <span className={`pic ${k}`} />
            <span>{tt(WAGON_NAME[k])}</span>
            <span className="goods">
              {lineGoods(s, line, k).map((g) => (
                <GoodIcon key={g} good={g} />
              ))}
            </span>
          </button>
        ))}
      </div>
      <div className="stepper">
        <button className="round" data-act="fewer" aria-label={tr('Vähemmän vaunuja', 'Fewer wagons')} disabled={count <= 1} onClick={() => setCount(count - 1)}>
          −
        </button>
        <span className="count num">
          {count} <small>{count === 1 ? tr('vaunu', 'wagon') : tr('vaunua', 'wagons')} · +{WAGON_PRICE} {tr('kpl', 'each')}</small>
        </span>
        <button className="round" data-act="more" aria-label={tr('Lisää vaunuja', 'More wagons')} disabled={count >= WAGONS_MAX} onClick={() => setCount(count + 1)}>
          +
        </button>
      </div>
      <p className="small">{dest ? `${tr('Kuorma maksaa nyt', 'A load pays now')} ${pays} ${tr('kohteessa', 'at')} ${tt(dest.name)}.` : tr('Kumpikaan pää ei ota tämän vaunun tavaraa.', 'Neither end takes what this wagon carries.')}</p>
      <button className="btn primary wide" disabled={!can} onClick={() => onBuy(wagons, engine, count)} data-track="card-buy-train" data-act="buy">
        {full ? `${s.scenario.trainsMax} ${tr('junaa on täynnä', 'trains is the limit')}` : `${tr('Osta juna', 'Buy train')}  ${cost}`}
      </button>
    </div>
  );
}

/** seconds as "21 s" */
const secs = (n: number): string => `${Math.round(n)} s`;

/**
 * The train card: the consist, the load, the trip time full and empty, what it earned this year
 * and last, the speed each engine keeps on the line's worst grade, and its moves: a wagon, an
 * engine, the full-load switch, another line, sell.
 */
function TrainCard({ s, train: t, onClose, onSold }: { s: SimState; train: Train; onClose: () => void; onSold: () => void }) {
  const line = lineOf(s, t);
  const [siteA, siteB] = stopSites(s, line);
  const [moving, setMoving] = useState(false);
  const other = s.scenario.engines.find((e) => e !== t.engine);
  const swapCost = other ? ENGINES[other].price - Math.round(ENGINES[t.engine].price * RESALE) : 0;
  const resale = Math.round((ENGINES[t.engine].price + t.nWagons * WAGON_PRICE) * RESALE);
  const tt2 = tripTimes(s, line, t.engine, t.nWagons);
  // the lines that share a station with this one
  const mine = new Set(line.stops);
  const lines = s.lines.filter((l) => l.id !== line.id && l.stops.some((x) => mine.has(x)));
  const names = (l: Line) => {
    const [a, b] = stopSites(s, l);
    return `${tt(a.name)} ⇄ ${tt(b.name)}`;
  };
  const makesFor = (l: Line): Good[] => {
    const [a, b] = stopSites(s, l);
    return [MAKES[a.kind], MAKES[b.kind]].filter((g): g is Good => !!g && WAGON_GOODS[t.wagons].includes(g));
  };
  return (
    <div className="card sheet train-card" data-ui>
      <CardHead
        title={
          <>
            {tt(ENGINES[t.engine].name)} <small className="line-name">{tt(siteA.name)} ⇄ {tt(siteB.name)}</small>
          </>
        }
        onClose={onClose}
      />
      <div className="consist-row">
        <Consist engine={t.engine} wagons={t.wagons} n={t.nWagons} cargo={t.cargo} good={t.good} />
      </div>
      <div className="facts" data-sec="facts">
        <div className="fact">
          <span className="fl">{tr('Kuorma', 'Load')}</span>
          <b className="num">{t.cargo}/{t.nWagons}</b>
          <span className="bar">
            <i style={{ width: `${(100 * t.cargo) / t.nWagons}%` }} />
          </span>
          {t.good && <GoodIcon good={t.good} />}
        </div>
        <div className="fact" data-sec="trip">
          <span className="fl">{tr('Matka-aika', 'Trip time')}</span>
          <span className="num">
            → {tr('tyhjä', 'empty')} {secs(tt2.empty[0])} · {tr('täysi', 'full')} {secs(tt2.full[0])}
            <br />← {tr('tyhjä', 'empty')} {secs(tt2.empty[1])} · {tr('täysi', 'full')} {secs(tt2.full[1])}
            <small>
              <br />
              {tr('Asemalla', 'Standing')} {secs(t.nWagons * (dwellAt(s, line.path[0]) + dwellAt(s, line.path[line.path.length - 1])) + 2 * STOP_SECONDS)} {tr('kierroksella', 'a round')}
            </small>
          </span>
        </div>
        <div className="fact" data-sec="earned">
          <span className="fl">{tr('Tuotto', 'Earned')}</span>
          <span className="num">
            <b className="gold">{num(t.earnedYear)}</b> {tr('tänä vuonna', 'this year')} · <b className="gold">{num(t.earnedLast)}</b> {tr('viime vuonna', 'last year')}
          </span>
        </div>
        <div className="fact" data-sec="grade">
          <span className="fl">{tr('Nousu', 'Grade')} {line.worst < 1 ? tr('tasainen', 'flat') : `▲ ${line.worst.toFixed(0)} %`}</span>
          <span className="num">
            {s.scenario.engines
              .map((e) => `${tt(ENGINES[e].name)} ${Math.round(100 * gradeFactor(e, line.worst, t.nWagons))} %`)
              .join(', ')}
          </span>
        </div>
      </div>
      <div className="acts">
        <button className="btn act" data-act="wagon" disabled={t.nWagons >= WAGONS_MAX || s.cash < WAGON_PRICE} onClick={() => addWagon(s, t.id)}>
          <span>{tr('Vaunu lisää', 'Add a wagon')}</span>
          <small>{t.nWagons >= WAGONS_MAX ? tr('täysi', 'full') : WAGON_PRICE}</small>
        </button>
        {other && (
          <button className="btn act" data-act={`engine-${other}`} disabled={s.cash < swapCost} onClick={() => setEngine(s, t.id, other)}>
            <span>{tr('Vaihda', 'Swap to')} {tt(ENGINES[other].name)}</span>
            <small>{swapCost}</small>
          </button>
        )}
        <button className={`btn act${t.fullLoad ? ' on' : ''}`} data-act="fullload" onClick={() => setFullLoad(s, t.id, !t.fullLoad)}>
          <span>{tr('Odota täysi kuorma', 'Wait for a full load')}</span>
          <small>{t.fullLoad ? tr('päällä', 'on') : tr('pois', 'off')}</small>
        </button>
        <button className={`btn act${moving ? ' on' : ''}`} data-act="move" disabled={lines.length === 0} onClick={() => setMoving(!moving)}>
          <span>{tr('Siirrä toiselle radalle', 'Move to another line')}</span>
          <small>{lines.length === 0 ? tr('ei muita ratoja', 'no other line here') : lines.length}</small>
        </button>
      </div>
      {moving && (
        <div className="move-list" data-sec="move">
          {lines.map((l) => {
            const ok = canMove(s, t.id, l.id);
            const suits = makesFor(l).length > 0 || stopSites(s, l).some((x) => WAGON_GOODS[t.wagons].some((g) => TAKES[x.kind].includes(g)));
            return (
              <div key={l.id} className="move-row">
                <button className="btn act" data-move={l.id} disabled={!ok} onClick={() => moveTrain(s, t.id, l.id)}>
                  <span>{names(l)}</span>
                  <small>{ok ? (suits ? tr('siirrä tähän', 'move here') : tr('vaunut eivät sovi', 'wagons do not suit')) : tr('Lähetä, kun se on tämän radan asemalla', 'Send it when it stands at a station of that line')}</small>
                </button>
              </div>
            );
          })}
        </div>
      )}
      <p className="small">
        {tt(ENGINES[t.engine].blurb)}. {tr('Ylläpito', 'Upkeep')} {ENGINES[t.engine].upkeep}/{tr('v', 'yr')}.
      </p>
      <button
        className="btn act danger wide-act"
        data-act="sell"
        onClick={() => {
          sellTrain(s, t.id);
          onSold();
        }}
      >
        <span>{tr('Myy', 'Sell')}</span>
        <small>+{resale}</small>
      </button>
    </div>
  );
}

const KIND_NAME: Record<string, [string, string]> = { forest: ['metsä', 'forest'], sawmill: ['saha', 'sawmill'], farm: ['maatila', 'farm'], mill: ['mylly', 'mill'], town: ['kaupunki', 'town'] };
/** the producer of a good named the way the sentence wants it: Finnish "from", English "a" */
const FROM_KIND: Record<string, [string, string]> = { forest: ['metsästä', 'a forest'], farm: ['maatilalta', 'a farm'] };
const NO_GOOD: Record<string, string> = { timber: 'tukkeja', grain: 'viljaa' };

/** one line on why a site does nothing right now, or null when it is not stuck */
function stuckText(s: SimState, site: Site): string | null {
  const station = s.stations.find((x) => x.siteId === site.id);
  if (!station) return tr('Ei vielä rautatiellä', 'Not on the railway yet');
  const makes = MAKES[site.kind];
  const lines = s.lines.filter((l) => l.stops.includes(station.id));
  const input = TAKES[site.kind][0];
  if (makes && input) {
    const fed = lines.some((l) => {
      const other = s.stations.find((x) => x.id === (l.stops[0] === station.id ? l.stops[1] : l.stops[0]));
      return other && MAKES[siteById(s, other.siteId).kind] === input;
    });
    if (!fed) {
      const from = s.sites.find((o) => MAKES[o.kind] === input);
      const k = from ? FROM_KIND[from.kind] : null;
      return `${tr(`Ei ${NO_GOOD[input] ?? ''} tule`, `No ${tt(GOOD_NAME[input])} comes in`)}: ${k ? tr(`ei rataa ${k[0]}`, `no line from ${k[1]}`) : tr('ei rataa', 'no line')}`;
    }
  }
  if (makes && site.stock >= RAW_CAP - 0.01 && !s.trains.some((t) => lines.some((l) => l.id === t.lineId) && WAGON_GOODS[t.wagons].includes(makes)))
    return tr('Täynnä: mikään juna ei hae', 'Full: no train picks it up');
  return null;
}

/** a small rail mark: a line joins the two stations */
const LinkMark = () => (
  <svg className="link" viewBox="0 0 24 24" role="img" aria-label={tr('rata on', 'line exists')}>
    <g stroke="currentColor" strokeLinecap="round">
      <path d="M8.5 3 V21 M15.5 3 V21" strokeWidth="2.4" />
      <path d="M5.5 6.5 H18.5 M5.5 11 H18.5 M5.5 15.5 H18.5 M5.5 20 H18.5" strokeWidth="2" />
    </g>
  </svg>
);

const GoodIcon = ({ good }: { good: Good }) => (
  <svg className="gi" aria-label={tt(GOOD_NAME[good])}>
    <use href={`#g-${good}`} />
  </svg>
);

/**
 * The site card: what it has, what it wants and pays now, why it is stuck, who buys its output, and
 * a button that starts the track from here (or joins the site to the railway when it has no station).
 */
function SiteCard({ s, site, onClose, onLay }: { s: SimState; site: Site; onClose: () => void; onLay: () => void }) {
  const makes = MAKES[site.kind];
  const takes = TAKES[site.kind].filter((g) => goodsOnMap(s).includes(g));
  const cell = idx(s, site.cx, site.cy);
  const station = stationAt(s, cell);
  const hasStation = !!station;
  // a site with no station can be joined when some station reaches it; worked out when the stations change, not each frame
  const reachable = useMemo(() => hasStation || s.stations.some((st) => plan(s, st.cell, cell).length > 0), [s, cell, hasStation, s.stations.length]);
  const stuck = stuckText(s, site);
  const list = buyers(s, site);
  const raw = !!RAW_RATE[site.kind];
  return (
    <div className="card sheet site-card" data-ui>
      <CardHead
        title={
          <>
            {tt(site.name)} <small className="line-name">{tr(...KIND_NAME[site.kind])}{site.kind === 'town' ? ` ${tr('koko', 'size')} ${site.size}` : ''}</small>
          </>
        }
        onClose={onClose}
      />
      {makes && (
        <div className="srow" data-sec="has">
          <span className="sl">{tr('Tarjolla', 'Has')}</span>
          <div className="gline">
            <GoodIcon good={makes} />
            <b>{Math.floor(site.stock)}</b>
            {raw && <span className="of">/{RAW_CAP}</span>}
            <span className="bar">
              <i style={{ width: `${Math.min(100, (100 * site.stock) / RAW_CAP)}%` }} />
            </span>
            {site.rate > 0 && <small>{site.rate.toFixed(1)}/{tr('kk', 'mo')}</small>}
          </div>
        </div>
      )}
      {takes.length > 0 && (
        <div className="srow" data-sec="wants">
          <span className="sl">{tr('Haluaa', 'Wants')}</span>
          <div className="sc">
            {takes.map((g) => (
              <div key={g} className="gline">
                <GoodIcon good={g} />
                <b className="gold">{price(s, g, site.id, 0)}</b>
                <span className={`bar${demand(site.taken[g]) < 0.55 ? ' low' : ''}`}>
                  <i style={{ width: `${100 * demand(site.taken[g])}%` }} />
                </span>
                {site.kind === 'town' && <small>{tr('kasvuun', 'to grow')} {Math.min(GROW_NEED, Math.floor(site.fed[g]))}/{GROW_NEED}</small>}
              </div>
            ))}
          </div>
        </div>
      )}
      {stuck && <p className="stuck">{stuck}</p>}
      {station && (
        <div className="srow" data-sec="crew">
          <span className="sl">{tr('Väki', 'Crew')}</span>
          <div className="crew-row">
            <span>{tr('Lastausväki: vaunut lastautuvat kolmanneksen nopeammin', 'Loading crew: wagons load a third faster')}</span>
            {station.crew ? (
              <b className="bought">{tr('Ostettu', 'Bought')}</b>
            ) : (
              <button className="btn act" data-act="crew" disabled={s.cash < CREW_PRICE} onClick={() => buyCrew(s, station.id)}>
                <span>{tr('Osta', 'Buy')}</span>
                <small>{CREW_PRICE}</small>
              </button>
            )}
          </div>
        </div>
      )}
      {list.length > 0 && (
        <div className="srow" data-sec="buyers">
          <span className="sl">{tr('Ostajat', 'Buyers')}</span>
          <div className="sc">
            {list.map((b) => (
              <div key={b.site.id} className="gline buyer" data-buyer={b.site.id}>
                <GoodIcon good={b.good} />
                <span className="bn">{tt(b.site.name)}</span>
                <b className="gold">{b.price}</b>
                <small>{b.km.toFixed(1)} km</small>
                {b.linked && <LinkMark />}
              </div>
            ))}
          </div>
        </div>
      )}
      <button className="btn primary wide lay" data-act="lay" disabled={!reachable} onClick={onLay}>
        {hasStation ? tr('Vedä rata täältä', 'Lay track from here') : tr('Liitä rautatiehen', 'Join to the railway')}
      </button>
    </div>
  );
}

function ResultCard({ s, onAgain, onQuit }: { s: SimState; onAgain: () => void; onQuit: () => void }) {
  const r = s.result!;
  const years = r.year - s.scenario.startYear + (r.won ? 1 : 0);
  const goal = s.scenario.goal;
  const what =
    goal.kind === 'deliver'
      ? r.won
        ? `${num(s.goalCount)} ${tr('lautakuormaa vuoteen', 'loads of boards by')} ${r.year}`
        : `${num(s.goalCount)}/${goal.count} ${tr('lautakuormaa', 'loads of boards')}`
      : s.sites.filter((x) => x.kind === 'town').map((x) => `${tt(x.name)} ${tr('koko', 'size')} ${x.size}`).join(', ');
  return (
    <div className="card result overlay" data-ui>
      <h2>{r.won ? tr('Tavoite täyttyi', 'Goal reached') : tr('Aika loppui', 'Out of time')}</h2>
      <div className="stars">{'★'.repeat(r.stars)}{'☆'.repeat(3 - r.stars)}</div>
      <p>
        {what}, {tr('kassa', 'cash')} {num(r.cash)}, {years} {years === 1 ? tr('vuosi', 'year') : tr('vuotta', 'years')}
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

/** the goods glyphs the chips use, as SVG symbols once in the page */
function GoodIcons() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <symbol id="g-timber" viewBox="0 0 24 24">
          <rect x="2" y="6" width="18" height="5" rx="2.5" fill="#8a5a2b" /><circle cx="20" cy="8.5" r="2.5" fill="#d9b27a" /><circle cx="20" cy="8.5" r="1" fill="#8a5a2b" />
          <rect x="4" y="13" width="18" height="5" rx="2.5" fill="#9a6633" /><circle cx="4" cy="15.5" r="2.5" fill="#d9b27a" /><circle cx="4" cy="15.5" r="1" fill="#9a6633" />
        </symbol>
        <symbol id="g-boards" viewBox="0 0 24 24">
          <rect x="2" y="5" width="20" height="4" rx="1" fill="#e8d2a0" stroke="#8a6a3a" strokeWidth="1" />
          <rect x="2" y="10" width="20" height="4" rx="1" fill="#e2c892" stroke="#8a6a3a" strokeWidth="1" />
          <rect x="2" y="15" width="20" height="4" rx="1" fill="#e8d2a0" stroke="#8a6a3a" strokeWidth="1" />
        </symbol>
        <symbol id="g-grain" viewBox="0 0 24 24">
          <path d="M12 22 V9" stroke="#b08a2a" strokeWidth="2" fill="none" />
          <g fill="#e9c547" stroke="#a7811f" strokeWidth="0.8">
            <ellipse cx="12" cy="5" rx="2.4" ry="3.2" /><ellipse cx="8.5" cy="9" rx="2.4" ry="3.2" transform="rotate(-35 8.5 9)" /><ellipse cx="15.5" cy="9" rx="2.4" ry="3.2" transform="rotate(35 15.5 9)" />
            <ellipse cx="8.5" cy="14" rx="2.4" ry="3.2" transform="rotate(-35 8.5 14)" /><ellipse cx="15.5" cy="14" rx="2.4" ry="3.2" transform="rotate(35 15.5 14)" />
          </g>
        </symbol>
        <symbol id="g-flour" viewBox="0 0 24 24">
          <path d="M6 9 Q5 21 12 21 Q19 21 18 9 Z" fill="#f4f0e4" stroke="#8a8070" strokeWidth="1" />
          <path d="M7 9 L17 9 L15 5 L9 5 Z" fill="#e3dcc8" stroke="#8a8070" strokeWidth="1" />
          <path d="M8 8 L16 8" stroke="#b5382c" strokeWidth="2" />
        </symbol>
      </defs>
    </svg>
  );
}

export { wagonFor };
