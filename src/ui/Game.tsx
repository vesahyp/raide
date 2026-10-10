/**
 * The game screen: the canvas, the loop, the HUD and the cards. The sim
 * lives in a ref and survives a turn of the phone; the HUD reads it a few
 * times a second; the cards open on the sim's events (a build, a choice of
 * routes, a year end, the result) and on taps: a line, a train, a site.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EngineId, Good, Line, Load, PerkId, ScenarioDef, SimState, Site, Train, WagonType } from '../game/types';
import { createState, siteById, goodsOnMap, stationAt } from '../game/state';
import { DT, step, buyTrain, undo, trainPrice, nextTrainPrice, note, price, plan, build, addWagon, removeWagon, setEngine, sellTrain, fillOf, storeCap, growthOutlook, goalProgress, lineOf, buyers, tripTimes, gradeFactor, borrow, repay, loanCeiling, netWorth, liftLine, liftValue, lineYear, lineTrackUpkeep, runningCostMinute, runPerTile, stopSite, lineGood, lineWagon, growNeed, growFrac, takePick, wagonsMax, dwellAt, held, perk, expandPrice, expandSite, outputFactor, WAGON_BACK } from '../game/sim';
import { HOUSES_PER_SIZE } from '../render/town';
import { ENGINES, ENGINE_LEN, GOOD_NAME, LOAN_RATE, LOAN_STEP, MAKES, MONTHS, TOWN_MAX, RAW_RATE, RESALE, TAKES, WAGON_LEN, WAGON_NAME, WAGON_PRICE, WAGONS_DEFAULT, PERK_MAX, PERK_SPEED, PERK_OUTPUT, PERK_LOADING, PERK_TRACK, PERK_FAIR, VARIETY_BONUS, EXPAND_OUTPUT, EXPAND_PRICE, MONTHS as MONTHS_A_YEAR, YEAR_SECONDS, wagonFor } from '../game/content/economy';
import { idx, type Route } from '../game/grid';
import { earthWord, gradeText, GRADE_COL, perMin, routeKm, tripsByEngine } from './routeinfo';
import { Renderer2D, OPTION_COLOUR } from '../render/render2d';
import { drawEngine, drawWagon } from '../render/draw2d';
import { Input } from '../input/input';
import { Bot } from '../../tools/bot';
import { tr, t as tt, num } from '../i18n';
import { play, unlock, isMuted, setMuted } from '../audio';
import { track } from '../track';
import { saveStars } from '../results';
import { LedgerCard } from './Ledger';
import { townLacks } from '../game/advice';
import { advice, adviceKey, type Advice } from '../game/advice';
import { tipText, lineName, readGoalTowns, GoalStrip, untilText } from './tips';
import { GoodIcon, NONE_OF } from './Wagons';

/** how much faster the clock runs while the fast button is on */
const FAST = 3;

type Card =
  | { kind: 'line'; lineId: number; /** open scrolled to "Buy a train" */ buy?: boolean }
  | { kind: 'train'; trainId: number }
  | { kind: 'site'; siteId: string }
  | { kind: 'choice'; options: Route[]; sx: number; sy: number }
  | { kind: 'result' }
  | { kind: 'pause' }
  | { kind: 'money' }
  | { kind: 'ledger' }
  | { kind: 'goal' }
  | null;

interface Hud {
  year: number;
  month: number;
  cash: number;
  goal: number;
  /** the pick is on the table */
  pick: boolean;
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
  // the fast clock, for the stretches where nothing needs the thumb
  const [fast, setFast] = useState(false);
  const fastRef = useRef(false);
  fastRef.current = fast;
  // the tip under the HUD: held at least 8 s so it can be read, hidden for the year with the x
  const [tip, setTip] = useState<Advice | null>(null);
  const tipRef = useRef<{ adv: Advice | null; key: string; at: number }>({ adv: null, key: '', at: -1e9 });
  const tipOff = useRef<number | null>(null);
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
    const w = window as unknown as { __sim?: SimState; __input?: Input; __renderer?: Renderer2D; __pace?: number; __plan?: (a: number, b: number) => unknown; __act?: Record<string, unknown> };
    w.__sim = s;
    w.__renderer = renderer;
    w.__pace = speed;
    w.__plan = (a, b) => plan(s, a, b);
    // the player's moves, for the scripts that set a scene up
    w.__act = { plan: (a: number, b: number) => plan(s, a, b), build: (r: Route) => build(s, r), buyTrain: (l: number, e: EngineId, n?: number) => buyTrain(s, l, e, n), sellTrain: (t: number) => sellTrain(s, t), price: (e: EngineId, n: number) => trainPrice(e, n), ceiling: () => loanCeiling(s), takePick: (c: 0 | 1) => takePick(s, c) };
    renderer.onBuyLine = (lineId) => setCard({ kind: 'line', lineId, buy: true });
    const input = new Input(canvas, s, renderer, {
      onBuild: (line, sx, sy) => {
        track('build', { scenario: scenario.id, cost: s.lastBuild?.cost ?? 0, bridge: s.lastBuild ? s.lastBuild.cells.filter((c) => s.water[c]).length : 0 });
        setCancel({ x: sx, y: sy });
        setCard({ kind: 'line', lineId: line.id, buy: true });
      },
      onChoice: (options, sx, sy) => setCard({ kind: 'choice', options, sx, sy }),
      onLine: (line) => setCard({ kind: 'line', lineId: line.id }),
      onTrain: (train) => setCard({ kind: 'train', trainId: train.id }),
      onSite: (site) => setCard({ kind: 'site', siteId: site.id }),
      onGround: () => setCard((c) => (c && (c.kind === 'line' || c.kind === 'train' || c.kind === 'site') ? null : c)),
      onNote: (cell) => note(s, cell, tr('Ei rahaa', 'No cash')),
      onAny: () => unlock(),
      onLayEnd: (kept) => {
        renderer.endPick(kept);
        setLay(null);
      },
    });
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
    // twice a second: the advice, the tip held on screen for 8 s, and the marker on the map
    const refreshTip = (now: number) => {
      const was = tipRef.current;
      const list = tipOff.current === s.year || s.result || s.pick ? [] : advice(s);
      let next = was;
      if (was.adv && list.some((a) => adviceKey(a) === was.key)) next = was;
      else if (was.adv) next = { adv: null, key: '', at: was.at };
      if (!next.adv && list.length && now - next.at >= 8000) next = { adv: list[0], key: adviceKey(list[0]), at: now };
      if (next !== was) {
        tipRef.current = next;
        setTip(next.adv);
      }
      renderer.advice = next.adv;
    };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const real = Math.min(0.1, (now - last) / 1000);
      last = now;
      // window.__freeze holds the sim for the picture scripts, with the frame still drawn
      if (bot && s.pick) bot.act(s);
      if (!pausedRef.current && !held(s) && !(window as unknown as { __freeze?: boolean }).__freeze) {
        acc += real * speed * (fastRef.current ? FAST : 1);
        let n = 0;
        while (acc >= DT && n < 30 * FAST) {
          if (bot) bot.act(s);
          step(s);
          acc -= DT;
          n++;
          if (held(s)) break;
        }
      }
      if (held(s)) acc = 0;
      if (s.result && cardRef.current?.kind !== 'result') {
        saveStars(scenario.id, s.result.stars);
        track('scenario_end', { scenario: scenario.id, won: s.result.won, year: s.result.year, cash: s.result.cash, worth: s.result.worth, stars: s.result.stars, reason: s.result.reason, seconds: Math.round(s.result.time) });
        setCard({ kind: 'result' });
      }
      for (const name of s.sounds) play(name);
      s.sounds.length = 0;
      if (!s.lastBuild) setCancel((c) => (c ? null : c));
      const c = cardRef.current;
      input.update(real);
      renderer.draw(held(s) ? 0 : real * speed, input.drag, hint, c?.kind === 'choice' ? c.options : null);
      if (frame % 30 === 0) refreshTip(now);
      if (++frame % 6 === 0) {
        setHud(readHud(s));
        // the open card's numbers follow the sim
        if (c && (c.kind === 'line' || c.kind === 'train' || c.kind === 'site' || c.kind === 'goal')) bump((x) => x + 1);
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
      <div className={`hud${tip ? ' has-tip' : ''}`} data-ui>
        <div className="hud-year">
          <span className="num">{hud.year}</span>
          <span className="months">
            {Array.from({ length: MONTHS }, (_, i) => (
              <i key={i} className={i < hud.month ? 'on' : i === hud.month ? 'now' : ''} />
            ))}
          </span>
        </div>
        <span className="hud-until">{tr('ennen', 'before')} {goal.beforeYear}</span>
        <button className={`hud-cash num${hud.cash < 0 ? ' red' : ''}`} data-act="money" aria-label={tr('Raha', 'Money')} onClick={() => setCard({ kind: 'money' })}>
          {num(hud.cash)}
        </button>
        <button className="round pause" aria-label={tr('Tauko', 'Pause')} onClick={() => setCard({ kind: 'pause' })}>
          <svg viewBox="0 0 24 24" className="glyph"><rect x="6" y="5" width="4" height="14" fill="currentColor" /><rect x="14" y="5" width="4" height="14" fill="currentColor" /></svg>
        </button>
        <div className="hud-sub">
          <GoalStrip s={s} onOpen={() => setCard({ kind: 'goal' })} />
          {tip && (
            <div className="hud-tip" data-sec="tip" data-tip={tip.kind}>
              <button
                className="tip-text"
                data-act="tip"
                onClick={() => {
                  // a line with no train, or goods waiting on a line: the tip opens the line card at "Buy a train"
                  setCard((tip.kind === 'idle-line' || tip.kind === 'more') && tip.onLine !== undefined ? { kind: 'line', lineId: tip.onLine, buy: true } : { kind: 'site', siteId: tip.site });
                }}
              >
                <b>!</b>
                <span>{tipText(s, tip)}</span>
              </button>
              <button
                className="tip-x"
                data-act="tip-hide"
                aria-label={tr('Piilota vihjeet tämän vuoden ajaksi', 'Hide tips for the rest of the year')}
                onClick={() => {
                  tipOff.current = s.year;
                  tipRef.current = { adv: null, key: '', at: tipRef.current.at };
                  setTip(null);
                  if (rendRef.current) rendRef.current.advice = null;
                }}
              >
                ×
              </button>
            </div>
          )}
        </div>
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
      {card === null && !paused && !hud.pick && (
        <div className="zoom" data-ui>
          <button className={`round fast${fast ? ' on' : ''}`} aria-label={fast ? tr('Normaali nopeus', 'Normal speed') : tr('Nopeammin', 'Faster')} aria-pressed={fast} data-act="fast" onClick={() => setFast((f) => !f)}>
            <svg viewBox="0 0 24 24" className="glyph"><path d="M4 6 L11 12 L4 18 Z M12 6 L19 12 L12 18 Z" fill="currentColor" /></svg>
          </button>
        </div>
      )}
      {cancel && s.lastBuild && (
        <button
          className="btn cancel"
          data-act="undo"
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
              setCard({ kind: 'line', lineId: l.id, buy: true });
            }
          }}
          onClose={close}
        />
      )}
      {line && (
        <LineCard
          key={`${line.id}:${card?.kind === 'line' && card.buy ? 'buy' : ''}`}
          s={s}
          line={line}
          toBuy={card?.kind === 'line' && !!card.buy}
          onBuy={(n, engine) => {
            const t = buyTrain(s, line.id, engine, n);
            if (t) {
              track('train', { scenario: scenario.id, engine, count: n });
              setCancel(null);
              setCard(null);
            }
          }}
          onTrain={(t) => setCard({ kind: 'train', trainId: t.id })}
          onLift={() => {
            if (liftLine(s, line.id)) {
              track('lift', { scenario: scenario.id });
              setCancel(null);
              setCard(null);
            }
          }}
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
          onBuyLine={(lineId) => setCard({ kind: 'line', lineId, buy: true })}
        />
      )}
      {hud.pick && s.pick && !s.result && (
        <PickCard
          s={s}
          onPick={(c) => {
            track('pick', { scenario: scenario.id, n: s.pick?.n ?? 0, took: s.pick?.options[c] ?? '', left: s.pick?.options[1 - c] ?? '' });
            takePick(s, c);
            setHud(readHud(s));
          }}
        />
      )}
      {card?.kind === 'result' && s.result && <ResultCard s={s} onAgain={onAgain} onQuit={onQuit} />}
      {card?.kind === 'money' && <MoneyCard s={s} onClose={close} onLedger={() => setCard({ kind: 'ledger' })} />}
      {card?.kind === 'ledger' && s.lastYear && <LedgerCard s={s} onClose={close} />}
      {card?.kind === 'goal' && <GoalCard s={s} onClose={close} />}
      {card?.kind === 'pause' && (
        <div className="card overlay">
          <h2>{tr('Tauko', 'Paused')}</h2>
          <p className="small worth-line">
            {tr('Nettovarallisuus', 'Net worth')} <b className="num gold">{num(netWorth(s))}</b>
          </p>
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
  return { year: s.year, month: s.month, cash: Math.floor(s.cash), goal: goalProgress(s), pick: !!s.pick };
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

/**
 * The lift of a drag, when the two ways differ: the cheap one and the short one, which costs more and
 * runs faster, with what each costs and runs.
 */
function ChoiceCard({ s, options, onPick, onClose }: { s: SimState; options: Route[]; onPick: (r: Route) => void; onClose: () => void }) {
  const name = (r: Route) => (r.bridge.length ? tr('Silta', 'Bridge') : r.cutting.length ? tr('Leikkaus', 'Cutting') : r.mode === 'cheap' ? tr('Kierto', 'Around') : tr('Suora', 'Direct'));
  return (
    <div className="card sheet choice-card" data-ui>
      <CardHead title={tr('Kumpaa kautta?', 'Which way?')} onClose={onClose} />
      <div className="routes">
        {options.map((r, i) => {
          const earth = earthWord(r);
          return (
            <button key={r.mode} className="btn route" data-route={r.mode} disabled={r.cost > s.cash} style={{ borderColor: OPTION_COLOUR[i] }} onClick={() => onPick(r)}>
              <span className="swatch" style={{ background: OPTION_COLOUR[i] }} />
              <span className="name">{r.mode === 'cheap' ? tr('Halvin', 'Cheapest') : tr('Nopein', 'Fastest')}: {name(r)}</span>
              <span className="cost num">{r.cost}</span>
              <small>
                {routeKm(r)} km · <b style={{ color: GRADE_COL(r.worst) }}>{r.worst < 1 ? '' : '▲ '}{gradeText(r)}</b>
                {earth ? ` · ${earth.text}` : ''}
              </small>
              {tripsByEngine(s, r).map((x) => (
                <small key={x.engine} className="trips">
                  <i className={`pic eng${x.engine === 'jyry' ? ' strong' : ''}`} />
                  {tt(ENGINES[x.engine].name).replace(/^(Little |Pikku-)/, '')} {perMin(x.trips)}
                </small>
              ))}
            </button>
          );
        })}
      </div>
      <p className="small">{tr('Lyhyt rata tekee enemmän matkoja minuutissa. Jyrkässä nousussa kevyt veturi ryömii.', 'A short line makes more trips a minute. On a steep climb the light engine crawls.')}</p>
    </div>
  );
}

/** a consist drawn small with the map's own sprites: engine at the right, wagons behind it, each with its load */
function Consist({ engine, wagons, loads }: { engine: EngineId; wagons: WagonType[]; loads: (Load | null)[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const S = 20;
  const n = wagons.length;
  const w = Math.ceil((ENGINE_LEN + n * WAGON_LEN + n * 0.08) * S) + 4;
  const key = wagons.map((t, i) => `${t}${loads[i]?.good ?? '-'}`).join();
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
      drawWagon(c, WAGON_LEN * S, S, wagons[i], loads[i]?.good ?? null, loads[i] ? 1 : 0);
      c.restore();
      x += (WAGON_LEN + 0.08) * S;
    }
    c.save();
    c.translate(x + (ENGINE_LEN * S) / 2, (S * 0.9) / 2);
    drawEngine(c, ENGINE_LEN * S, S, engine);
    c.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, key, n, w]);
  return <canvas ref={ref} className="consist" style={{ width: w, height: Math.ceil(S * 0.9) }} />;
}

/** a signed money figure for the cards: + or the true minus */
const signed = (n: number): string => {
  const r = Math.round(n);
  return `${r >= 0 ? '+' : '−'}${num(Math.abs(r))}`;
};

/** the goal in full: each town, its size, its growth to the next size and what would speed it, and the year limit */
function GoalCard({ s, onClose }: { s: SimState; onClose: () => void }) {
  const goal = s.scenario.goal;
  const chosen = new Set(readGoalTowns(s).map((x) => x.id));
  const towns = s.sites.filter((x) => x.kind === 'town').sort((a, b) => Number(chosen.has(b.id)) - Number(chosen.has(a.id)));
  return (
    <div className="card sheet goal-card" data-ui data-sec="goal-card">
      <CardHead title={goal.kind === 'towns' ? tr(`${goal.count} kaupunkia kokoon ${goal.size}`, `${goal.count} towns to size ${goal.size}`) : tr(`${goal.count} lautakuormaa`, `${goal.count} loads of boards`)} onClose={onClose} />
      <p className="small goal-until">{untilText(goal.beforeYear, s.year, s.month)}</p>
      {goal.kind === 'deliver' ? (
        <div className="fact">
          <span className="fl">{tt(siteById(s, goal.site).name)}</span>
          <b className="num gold">{s.goalCount}/{goal.count}</b>
        </div>
      ) : (
        towns.map((x) => {
          const lacks = townLacks(s, x);
          const done = x.size >= goal.size;
          const out = growthOutlook(s, x);
          return (
            <div key={x.id} className={`goal-town${chosen.has(x.id) ? ' on' : ''}${done ? ' done' : ''}`} data-goal-card-town={x.id}>
              <div className="gtn">
                <b>{tt(x.name)}</b>
                <span className="num">{done ? '✓' : `${x.size}→${goal.size}`}</span>
              </div>
              <div className="gm" aria-label={tr('Kasvu', 'Growth')}>
                <i style={{ width: `${Math.round(100 * (x.size >= TOWN_MAX ? 1 : growFrac(x)))}%` }} />
              </div>
              <div className="gl">
                {x.size >= TOWN_MAX || done ? (
                  <small>{tr('Valmis', 'Done')}</small>
                ) : (
                  <>
                    <small>{tr(`${out.loads} kuormaa kokoon ${x.size + 1}`, `${out.loads} loads to size ${x.size + 1}`)}</small>
                    {lacks.map((g) => (
                      <span key={g} className="lack">
                        <GoodIcon good={g} />
                        {tr(`+${Math.round(VARIETY_BONUS * 100)} % ${NONE_OF[g][0]} kanssa`, `+${Math.round(VARIETY_BONUS * 100)} % with ${NONE_OF[g][1]}`)}
                      </span>
                    ))}
                  </>
                )}
              </div>
            </div>
          );
        })
      )}
      <p className="small">{tr('Jokainen kuorma kasvattaa kaupunkia. Kun kaupunki saa molempia tavaroita puolen minuutin sisällä, kuorma kasvattaa enemmän.', 'Every load grows the town. A load counts more when the town got both goods within half a minute.')}</p>
    </div>
  );
}

/** the money card: cash, the loan against its ceiling, net worth, the two buttons and the ledger */
function MoneyCard({ s, onClose, onLedger }: { s: SimState; onClose: () => void; onLedger: () => void }) {
  const ceiling = loanCeiling(s);
  const worth = netWorth(s);
  const running = s.upkeep + s.trackUp;
  return (
    <div className="card sheet money-card" data-ui>
      <CardHead title={tr('Raha', 'Money')} onClose={onClose} />
      <div className="facts" data-sec="money">
        <div className="fact">
          <span className="fl">{tr('Kassa', 'Cash')}</span>
          <b className={`num${s.cash < 0 ? ' red' : ' gold'}`}>{num(s.cash)}</b>
        </div>
        <div className="fact" data-sec="loan">
          <span className="fl">{tr('Laina', 'Loan')}</span>
          <b className="num">{num(s.loan)}</b>
          <small>
            {tr('enintään', 'of')} {num(ceiling)}
          </small>
        </div>
        <div className="fact">
          <span className="fl">{tr('Korko', 'Interest')}</span>
          <span className="num">
            <b>{num(s.loan * LOAN_RATE)}</b> {tr('vuodessa', 'a year')} <small>({Math.round(LOAN_RATE * 100)} %)</small>
          </span>
        </div>
        <div className="fact" data-sec="worth">
          <span className="fl">{tr('Nettovarallisuus', 'Net worth')}</span>
          <b className="num gold">{num(worth)}</b>
        </div>
        <div className="fact" data-sec="running">
          <span className="fl">{tr('Kulut tänä vuonna', 'Costs this year')}</span>
          <span className="num">
            <b>{num(running)}</b> <small>{tr('ajo ja ylläpito', 'running and upkeep')}</small>
          </span>
        </div>
      </div>
      <div className="acts">
        <button className="btn act" data-act="borrow" disabled={s.loan + LOAN_STEP > ceiling} onClick={() => borrow(s, LOAN_STEP)}>
          <span>{tr('Lainaa', 'Borrow')} {LOAN_STEP}</span>
          <small>{tr('korko vuoden lopussa', 'interest at the year end')}</small>
        </button>
        <button className="btn act" data-act="repay" disabled={s.loan <= 0 || s.cash < 1} onClick={() => repay(s, LOAN_STEP)}>
          <span>{tr('Maksa takaisin', 'Repay')} {Math.min(LOAN_STEP, Math.max(0, Math.round(s.loan)))}</span>
          <small>{tr('lainaa jää', 'left')} {num(Math.max(0, s.loan - LOAN_STEP))}</small>
        </button>
        {s.lastYear && (
          <button className="btn act" data-act="ledger" onClick={onLedger}>
            <span>{tr('Tilinpäätös', 'Ledger')} {s.lastYear.year}</span>
            <small>{tr('tulos', 'profit')} {num(s.lastYear.profit)}</small>
          </button>
        )}
      </div>
      <p className="small">{tr('Kaksi vuodenvaihdetta peräkkäin miinuksella ja laina täynnä on konkurssi.', 'Two year ends in a row below zero with the loan full is bankruptcy.')}</p>
    </div>
  );
}

/** what one upgrade does, as a title and one line, in the player's language */
function perkText(s: SimState, id: PerkId, cash: number): { title: string; line: string } {
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  switch (id) {
    case 'wagon':
      return { title: tr('Pidemmät junat', 'Longer trains'), line: tr('Jokainen juna saa ilmaisen vaunun.', 'Every train gets a free wagon.') };
    case 'speed':
      return { title: tr('Paremmat veturit', 'Better engines'), line: tr(`Kaikki junat ajavat ${pct(PERK_SPEED)} nopeammin.`, `Every train runs ${pct(PERK_SPEED)} faster.`) };
    case 'output':
      return { title: tr('Lisää hakkuita ja peltoa', 'More felling and fields'), line: tr(`Metsät ja tilat tuottavat ${pct(PERK_OUTPUT)} enemmän.`, `Forests and farms make ${pct(PERK_OUTPUT)} more.`) };
    case 'loading':
      return { title: tr('Lastausväki', 'Loading crews'), line: tr(`Lastaus ja purku ${pct(PERK_LOADING)} nopeampaa kaikilla asemilla.`, `Loading and unloading ${pct(PERK_LOADING)} faster at every station.`) };
    case 'track':
      return { title: tr('Ratamestari', 'Track foreman'), line: tr(`Uusi rata ja sillat ${pct(PERK_TRACK)} halvemmalla.`, `New track and bridges cost ${pct(PERK_TRACK)} less.`) };
    case 'train':
      return { title: tr('Ilmainen juna', 'A free train'), line: tr('Seuraava juna ei maksa mitään.', 'Your next train costs nothing.') };
    case 'cash':
      return { title: tr('Pankkilaina ilman korkoa', 'A grant'), line: tr(`${cash} kassaan nyt.`, `${cash} cash now.`) };
    case 'fair':
      return { title: tr('Markkinat', 'Market days'), line: tr(`Jokainen kuorma kasvattaa kaupunkia ${pct(PERK_FAIR)} enemmän.`, `Every load grows the towns ${pct(PERK_FAIR)} more.`) };
  }
  void s;
}

/** the pick: the game holds, two upgrades side by side, one tap takes one (ADR 0006) */
function PickCard({ s, onPick }: { s: SimState; onPick: (c: 0 | 1) => void }) {
  const p = s.pick!;
  return (
    <div className="card overlay pick-card" data-ui data-sec="pick" data-pick={p.n}>
      <h2>{tr('Valitse yksi', 'Pick one')}</h2>
      <div className="pick-options">
        {p.options.map((id, i) => {
          const t = perkText(s, id, p.cash);
          const n = perk(s, id);
          return (
            <button key={id} className="btn pick" data-act={`pick-${i}`} data-perk={id} onClick={() => onPick(i as 0 | 1)}>
              <span className={`perk-icon perk-${id}`} aria-hidden />
              <b>{t.title}</b>
              <small>{t.line}</small>
              {PERK_MAX[id] > 1 && PERK_MAX[id] < 9 && n > 0 && <small className="had">{tr(`otettu ${n}/${PERK_MAX[id]}`, `taken ${n}/${PERK_MAX[id]}`)}</small>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The line card: the line's stops, what it carries, its trains, what it earned and cost this year, lifting
 * it when no train runs on it, and the buy section: the engine (each with its price and the trips a minute
 * it makes here), the wagons, what one more train adds to the line and the price.
 */
function LineCard({ s, line, toBuy, onBuy, onTrain, onLift, onClose }: { s: SimState; line: Line; toBuy?: boolean; onBuy: (n: number, e: EngineId) => void; onTrain: (t: Train) => void; onLift: () => void; onClose: () => void }) {
  const [count, setCount] = useState(WAGONS_DEFAULT);
  // the faster engine on this line is the one that moves more loads
  const [engine, setEngineId] = useState<EngineId>(() => [...s.scenario.engines].sort((x, y) => lineYear(s, line, { engine: y, wagons: WAGONS_DEFAULT }).loads - lineYear(s, line, { engine: x, wagons: WAGONS_DEFAULT }).loads)[0]);
  const cost = nextTrainPrice(s, engine, count);
  const trains = s.trains.filter((t) => t.lineId === line.id);
  const can = cost <= s.cash;
  const g = lineGood(s, line);
  const pays = g ? price(s, g.good, stopSite(s, line, g.to).id, line.dist[line.dist.length - 1]) : 0;
  // what the line does now, and with this train on it
  const now = lineYear(s, line);
  const withIt = lineYear(s, line, { engine, wagons: count });
  const added = Math.max(0, withIt.loads - now.loads);
  const runs = runningCostMinute(line, engine, count, withIt.each[withIt.each.length - 1]);
  const earned = line.earnedYear;
  const trackCost = lineTrackUpkeep(s, line) * s.yearFrac;
  const net = earned - line.runYear - trackCost;
  const lift = trains.length === 0;
  const max = wagonsMax(s);
  const wagon = lineWagon(s, line);
  const scrollRef = useRef<HTMLDivElement>(null);
  const buyRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const box = scrollRef.current;
    const head = buyRef.current;
    if (toBuy && box && head) box.scrollTop += head.getBoundingClientRect().top - box.getBoundingClientRect().top - 4;
  }, []);
  return (
    <div className="card sheet buy-card" data-ui data-line-card={line.id}>
      <CardHead
        title={[0, 1].map((k, i) => (
          <span key={k}>
            {i > 0 && <span className="arrow"> ⇄ </span>}
            {tt(stopSite(s, line, k).name)}
          </span>
        ))}
        onClose={onClose}
      />
      <div className="buy-scroll" data-sec="buy-scroll" ref={scrollRef}>
        <div className="line-biz" data-sec="line-biz">
          {g && (
            <p className="small carry-line" data-sec="carries">
              <GoodIcon good={g.good} /> {tt(GOOD_NAME[g.good])} {tt(stopSite(s, line, g.from).name)} → {tt(stopSite(s, line, g.to).name)} · {tr('kuorma maksaa nyt', 'a load pays now')} <b className="gold">{pays}</b>
            </p>
          )}
          <div className="money-row" data-sec="line-money">
            <div>
              <small>{tr('Tuotto', 'Earned')}</small>
              <b className="num gold">{num(earned)}</b>
            </div>
            <div>
              <small>{tr('Kulut', 'Costs')}</small>
              <b className="num">{num(line.runYear + trackCost)}</b>
            </div>
            <div data-sec="line-net">
              <small>{tr('Tulos', 'Net')}</small>
              <b className={`num ${Math.round(net) < 0 ? 'red' : 'gold'}`}>{signed(net)}</b>
            </div>
          </div>
          {trains.length > 0 && (
            <div className="train-rows">
              {trains.map((t) => (
                <button key={t.id} className="train-row" data-train={t.id} onClick={() => onTrain(t)}>
                  <span className={`pic eng${t.engine === 'jyry' ? ' strong' : ''}`} />
                  {t.wagons.map((w, i) => (
                    <span key={i} className={`pic ${w}`} />
                  ))}
                  <span className="row-text">
                    {tt(ENGINES[t.engine].name)} · {t.cargo}/{t.nWagons} · {t.trips} {tr('matkaa', 'trips')}
                    {t.state === 'stop' && t.waited > 1 ? ` · ${tr('odottaa kuormaa', 'waiting for loads')}` : t.queued ? ` · ${tr('jonossa', 'queued')}` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
          {lift && (
            <button className="btn act lift" data-act="lift" onClick={onLift}>
              <span>{tr('Nosta rata', 'Lift the line')}</span>
              <small>
                {tr('puolet hinnasta takaisin', 'half the price back')} +{num(liftValue(s, line))}
              </small>
            </button>
          )}
        </div>
        <h3 className="buy-title" data-sec="buy-title" ref={buyRef}>{tr('Osta juna', 'Buy a train')}</h3>
        <div className="buy-label">{tr('Veturi', 'Engine')}</div>
        <div className="wagons engines">
          {s.scenario.engines.map((e) => (
            <button key={e} className={`wagon engine${engine === e ? ' on' : ''}`} data-engine={e} onClick={() => setEngineId(e)}>
              <span className={`pic eng${e === 'jyry' ? ' strong' : ''}`} />
              <span className="ename">
                <b>{tt(ENGINES[e].name)}</b> <span className="num gold">{s.perks.freeTrains > 0 ? 0 : ENGINES[e].price}</span>
              </span>
              <small>{tt(ENGINES[e].blurb)}</small>
              <b className="trips-line">{perMin(lineYear(s, line, { engine: e, wagons: count }).each.slice(-1)[0])} {tr('matkaa', 'trips')}</b>
            </button>
          ))}
        </div>
        <div className="buy-label">
          {tt(WAGON_NAME[wagon])} <span className="num">{count}/{max}</span>
        </div>
        <div className="wagon-count" data-sec="consist">
          <button className="round" data-act="wagons-less" aria-label={tr('Vähemmän vaunuja', 'Fewer wagons')} disabled={count <= 1} onClick={() => setCount(count - 1)}>−</button>
          <Consist engine={engine} wagons={Array<WagonType>(count).fill(wagon)} loads={Array(count).fill(null)} />
          <button className="round" data-act="wagons-more" aria-label={tr('Enemmän vaunuja', 'More wagons')} disabled={count >= max} onClick={() => setCount(count + 1)}>+</button>
        </div>
        <div className="facts" data-sec="adds">
          <div className="fact" data-sec="adds-trips">
            <span className="fl">{tr('Tämä juna', 'This train')}</span>
            <span className="num">
              <b className={added < 0.3 ? 'red' : 'gold'}>+{added.toFixed(1)}</b> {tr('kuormaa/min', 'loads/min')} <small>({now.loads.toFixed(1)} → {withIt.loads.toFixed(1)})</small> · <b data-sec="adds-cost">{num(runs)}</b> <small>{tr('kulut/min', 'costs/min')}</small>
            </span>
            {withIt.limit === 'platform' && <small className="why">{tr('Asemalla on jono: pidempi juna kuljettaa enemmän kuin uusi juna', 'The trains queue at the platform: longer trains carry more than another train')}</small>}
            {withIt.limit === 'supply' && g && <small className="why">{expandPrice(stopSite(s, line, g.from)) !== null ? tr(`${tt(stopSite(s, line, g.from).name)} ei tuota enempää: laajenna se sen kortista`, `${tt(stopSite(s, line, g.from).name)} makes no more: expand it from its card`) : tr(`${tt(stopSite(s, line, g.from).name)} ei tuota enempää: junat odottavat kuormaa`, `${tt(stopSite(s, line, g.from).name)} makes no more: the trains wait for loads`)}</small>}
          </div>
        </div>
      </div>
      <div className="buy-foot" data-sec="buy-foot">
        <button className="btn primary wide" disabled={!can} onClick={() => onBuy(count, engine)} data-track="card-buy-train" data-act="buy">
          <span>{tr('Osta juna', 'Buy train')}  {cost === 0 ? tr('ilmainen', 'free') : cost}</span>
          <small data-sec="buy-trips">+{added.toFixed(1)} {tr('kuormaa/min', 'loads/min')}</small>
        </button>
      </div>
    </div>
  );
}

/** a line's money this year so far: what it earned less the running cost and the track upkeep */
const lineNet = (s: SimState, line: Line): number => line.earnedYear - line.runYear - lineTrackUpkeep(s, line) * s.yearFrac;

/**
 * "Lines here" on a station's site card: each line through the station with its stops, its trains
 * and its net this year, and a button that opens the line card at "Buy a train".
 */
function LinesHere({ s, stationId, onBuy }: { s: SimState; stationId: number; onBuy: (lineId: number) => void }) {
  const lines = s.lines.filter((l) => l.stops.includes(stationId));
  if (!lines.length) return null;
  return (
    <div className="srow lines-here" data-sec="lines-here">
      <span className="sl">{tr('Linjat täällä', 'Lines here')}</span>
      <div className="sc">
        {lines.map((l) => {
          const n = s.trains.filter((t) => t.lineId === l.id).length;
          const net = lineNet(s, l);
          return (
            <div key={l.id} className="lh-row" data-line={l.id}>
              <div className="lh-text">
                <b>{lineName(s, l)}</b>
                <small>
                  {n === 0 ? <span className="red">{tr('ei junaa', 'no train')}</span> : `${n} ${n === 1 ? tr('juna', 'train') : tr('junaa', 'trains')}`} · {tr('tulos', 'net')} <span className={Math.round(net) < 0 ? 'red' : 'gold'}>{signed(net)}</span>
                </small>
              </div>
              <button className="btn act" data-act="buy-line" data-line={l.id} onClick={() => onBuy(l.id)}>
                <span>{tr('Osta juna', 'Buy a train')}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** seconds as "21 s" */
const secs = (n: number): string => `${Math.round(n)} s`;

/**
 * The train card: the consist with its loads, the trip time full and empty, the round trips made, what it
 * earned, the speed each engine keeps on the line's worst grade, and its moves: a wagon on or off, the
 * other engine, sell.
 */
function TrainCard({ s, train: t, onClose, onSold }: { s: SimState; train: Train; onClose: () => void; onSold: () => void }) {
  const line = lineOf(s, t);
  const other = s.scenario.engines.find((e) => e !== t.engine);
  const swapCost = other ? ENGINES[other].price - Math.round(ENGINES[t.engine].price * RESALE) : 0;
  const resale = Math.round((ENGINES[t.engine].price + t.nWagons * WAGON_PRICE) * RESALE);
  const tt2 = tripTimes(s, line, t.engine, t.nWagons);
  const net = t.earnedYear - t.runYear - ENGINES[t.engine].upkeep * s.yearFrac;
  const g = lineGood(s, line);
  const max = wagonsMax(s);
  return (
    <div className="card sheet train-card" data-ui data-train-id={t.id}>
      <CardHead
        title={
          <>
            {tt(ENGINES[t.engine].name)} <small className="line-name">{lineName(s, line).replace(/–/g, ' ⇄ ')}</small>
          </>
        }
        onClose={onClose}
      />
      <div className="consist-row">
        <Consist engine={t.engine} wagons={t.wagons} loads={t.loads} />
      </div>
      <div className="facts" data-sec="facts">
        <div className="fact">
          <span className="fl">{tr('Kuorma', 'Load')}</span>
          <b className="num">{t.cargo}/{t.nWagons}</b>
          <span className="bar">
            <i style={{ width: `${(100 * t.cargo) / t.nWagons}%` }} />
          </span>
          {g && <GoodIcon good={g.good} />}
          {t.state === 'stop' && t.waited > 1 && <small className="why">{tr('odottaa kuormaa', 'waiting for loads')}</small>}
        </div>
        <div className="fact" data-sec="trip">
          <span className="fl">{tr('Matka-aika', 'Trip time')}</span>
          <span className="num">
            {tr('täysi', 'full')} {secs(g ? tt2.full[g.from === 0 ? 0 : 1] : tt2.full[0])} · {tr('tyhjä takaisin', 'empty back')} {secs(g ? tt2.empty[g.from === 0 ? 1 : 0] : tt2.empty[1])}
            <small>
              <br />
              {t.trips} {tr('matkaa tehty', 'trips made')} · {tr('lastaus', 'loading')} {(dwellAt(s) * t.nWagons).toFixed(1)} s
            </small>
          </span>
        </div>
        <div className="fact" data-sec="earned">
          <span className="fl">{tr('Tuotto', 'Earned')}</span>
          <span className="num">
            <b className="gold">{num(t.earnedYear)}</b> {tr('tänä vuonna', 'this year')} · <b className="gold">{num(t.earned)}</b> {tr('yhteensä', 'in all')}
          </span>
        </div>
        <div className="fact" data-sec="net">
          <span className="fl">{tr('Tulos', 'Net')}</span>
          <b className={`num ${net < 0 ? 'red' : 'gold'}`}>{signed(net)}</b>
          <small>{tr('ajo', 'run')} {runPerTile(t.engine, t.nWagons).toFixed(2)}/{tr('ruutu', 'tile')}</small>
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
        <button className="btn act" data-act="add-wagon" disabled={t.nWagons >= max || s.cash < WAGON_PRICE} onClick={() => addWagon(s, t.id)}>
          <span>{tr('Lisää vaunu', 'Add a wagon')} {t.nWagons}/{max}</span>
          <small>{WAGON_PRICE}</small>
        </button>
        <button className="btn act" data-act="drop-wagon" disabled={t.nWagons <= 1} onClick={() => removeWagon(s, t.id, t.nWagons - 1)}>
          <span>{tr('Poista vaunu', 'Remove a wagon')}</span>
          <small>+{WAGON_BACK}</small>
        </button>
        {other && (
          <button className="btn act" data-act={`engine-${other}`} disabled={s.cash < swapCost} onClick={() => setEngine(s, t.id, other)}>
            <span>{tr('Vaihda', 'Swap to')} {tt(ENGINES[other].name)}</span>
            <small>{swapCost}</small>
          </button>
        )}
      </div>
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
    const fed = lines.some((l) => l.stops.some((id) => id !== station.id && MAKES[siteById(s, s.stations.find((x) => x.id === id)!.siteId).kind] === input));
    if (!fed) {
      const from = s.sites.find((o) => MAKES[o.kind] === input);
      const k = from ? FROM_KIND[from.kind] : null;
      return `${tr(`Ei ${NO_GOOD[input] ?? ''} tule`, `No ${tt(GOOD_NAME[input])} comes in`)}: ${k ? tr(`ei rataa ${k[0]}`, `no line from ${k[1]}`) : tr('ei rataa', 'no line')}`;
    }
  }
  if (makes && site.stock >= site.rawCap - 0.01 && !s.trains.some((t) => lines.some((l) => l.id === t.lineId && lineGood(s, l)?.good === makes)))
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

/** what a town gets with the next size besides more houses, by the size it reaches */
const NEXT_GIVES: Record<number, [string, string]> = { 2: ['kirkon', 'a church'], 3: ['toisen kadun', 'a second street'], 4: ['torin', 'a market square'], 5: ['kaupungintalon', 'a town hall'] };

/**
 * A town's goods and growth: per good the store with a bar and the price now; the growth to the next size
 * as a bar with the points, the loads that takes, and what speeds it; the size and what the next size gives.
 */
function TownRows({ s, site, takes, railed }: { s: SimState; site: Site; takes: Good[]; railed: boolean }) {
  const cap = storeCap(site);
  const out = growthOutlook(s, site);
  const maxed = site.size >= TOWN_MAX;
  const next = NEXT_GIVES[site.size + 1];
  let growText: string;
  if (maxed) growText = tr('Suurin koko', 'Fully grown');
  else if (!railed) growText = tr('Ei rataa: ei kasva', 'No railway: not growing');
  else if (out.perMinute <= 0) growText = tr('Mikään juna ei tuo tavaraa', 'No train brings goods');
  else growText = tr(`${out.loads} kuormaa kokoon ${site.size + 1}, nyt noin ${out.perMinute.toFixed(1)} kuormaa minuutissa`, `${out.loads} loads to size ${site.size + 1}, about ${out.perMinute.toFixed(1)} loads a minute now`);
  return (
    <>
      <div className="srow" data-sec="wants">
        <span className="sl">{tr('Haluaa', 'Wants')}</span>
        <div className="sc">
          {takes.map((g) => (
            <div key={g} className="store-row">
              <div className="gline">
                <GoodIcon good={g} />
                <b>{site.store[g].toFixed(1)}</b>
                <span className="of">/{cap}</span>
                <span className={`bar${fillOf(site, g) > 0.75 ? ' low' : ''}`}>
                  <i style={{ width: `${100 * fillOf(site, g)}%` }} />
                </span>
                <b className="gold">{price(s, g, site.id, 0)}</b>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="srow" data-sec="growth">
        <span className="sl">{tr('Kasvu', 'Growth')}</span>
        <div className="sc">
          {!maxed && (
            <div className="gline">
              <span className="bar grow">
                <i style={{ width: `${100 * growFrac(site)}%` }} />
              </span>
              <small>{Math.floor(site.growth)}/{growNeed(site)}</small>
            </div>
          )}
          <small className={!maxed && railed && out.perMinute <= 0 ? 'red' : ''}>{growText}</small>
          {!maxed && railed && out.missing && <small>{tr(`Kuorma kasvattaa ${Math.round(VARIETY_BONUS * 100)} % enemmän, kun myös ${NONE_OF[out.missing][0]} tulee`, `A load counts ${Math.round(VARIETY_BONUS * 100)} % more when ${NONE_OF[out.missing][1]} comes too`)}</small>}
          <small>
            {tr('Koko', 'Size')} {site.size}
            {!maxed && ` ${tr('→', 'to')} ${site.size + 1}: ${tr(`${HOUSES_PER_SIZE} taloa lisää${next ? ` ja ${next[0]}` : ''}`, `${HOUSES_PER_SIZE} more houses${next ? ` and ${next[1]}` : ''}`)}`}
          </small>
        </div>
      </div>
    </>
  );
}

/**
 * The site card: what it has, what it wants and pays now, why it is stuck, who buys its output, and
 * a button that starts the track from here (or joins the site to the railway when it has no station).
 */
function SiteCard({ s, site, onClose, onLay, onBuyLine }: { s: SimState; site: Site; onClose: () => void; onLay: () => void; onBuyLine: (lineId: number) => void }) {
  const makes = MAKES[site.kind];
  const takes = TAKES[site.kind].filter((g) => goodsOnMap(s).includes(g));
  const cell = idx(s, site.cx, site.cy);
  const station = stationAt(s, cell);
  const hasStation = !!station;
  // a site with no station can be joined when some station reaches it; worked out when the stations change, not each frame
  const reachable = useMemo(() => hasStation || s.stations.some((st) => plan(s, st.cell, cell).length > 0), [s, cell, hasStation, s.stations.length, s.lines.length]);
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
            {raw && <span className="of">/{site.rawCap}</span>}
            <span className="bar">
              <i style={{ width: `${Math.min(100, (100 * site.stock) / site.rawCap)}%` }} />
            </span>
            {site.rate > 0 && <small>{site.rate.toFixed(1)}/{tr('kk', 'mo')}</small>}
          </div>
        </div>
      )}
      {takes.length > 0 && site.kind !== 'town' && (
        <div className="srow" data-sec="wants">
          <span className="sl">{tr('Haluaa', 'Wants')}</span>
          <div className="sc">
            {takes.map((g) => (
              <div key={g} className="gline">
                <GoodIcon good={g} />
                <b className="gold">{price(s, g, site.id, 0)}</b>
                <span className={`bar${fillOf(site, g) > 0.75 ? ' low' : ''}`}>
                  <i style={{ width: `${100 * fillOf(site, g)}%` }} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {takes.length > 0 && site.kind === 'town' && <TownRows s={s} site={site} takes={takes} railed={hasStation} />}
      {stuck && <p className="stuck">{stuck}</p>}
      {station && <LinesHere s={s} stationId={station.id} onBuy={onBuyLine} />}
      {raw && (
        <div className="srow" data-sec="expand">
          <span className="sl">{tr('Laajennus', 'Expand')}</span>
          <div className="crew-row">
            <span>
              {tr(`+${Math.round(EXPAND_OUTPUT * 100)} % ${NONE_OF[makes!][0]}`, `+${Math.round(EXPAND_OUTPUT * 100)} % ${NONE_OF[makes!][1]}`)} · {tr('nyt', 'now')} {(site.rawRate * outputFactor(s, site) * MONTHS_A_YEAR * 60 / YEAR_SECONDS).toFixed(0)}/min · {site.level}/{EXPAND_PRICE.length}
            </span>
            {expandPrice(site) === null ? (
              <b className="bought">{tr('Täysi', 'Full')}</b>
            ) : (
              <button className="btn act" data-act="expand" disabled={s.cash < expandPrice(site)!} onClick={() => expandSite(s, site.id)}>
                <span>{tr('Laajenna', 'Expand')}</span>
                <small>{expandPrice(site)}</small>
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

/** the one thing a lost game was missing, in words: the town closest to the goal and what it lacked, or the loads short */
function missingText(s: SimState): string {
  const r = s.result!;
  const goal = s.scenario.goal;
  if (r.reason === 'bankrupt') return tr('Kassa oli miinuksella kahdesti peräkkäin ja laina täynnä.', 'Cash was below zero twice in a row with the loan full.');
  if (goal.kind === 'deliver') return tr(`Perille ehti ${s.goalCount} lautakuormaa ${goal.count}:stä.`, `${s.goalCount} of ${goal.count} loads of boards arrived.`);
  const served = (x: Site) => s.stations.some((st) => st.siteId === x.id);
  const towns = s.sites.filter((x) => x.kind === 'town' && x.size < goal.size).sort((a, b) => Number(served(b)) - Number(served(a)) || b.size - a.size || growFrac(b) - growFrac(a));
  const done = s.sites.filter((x) => x.kind === 'town' && x.size >= goal.size).length;
  const town = towns[0];
  if (!town) return '';
  const name = tt(town.name);
  // a town no train had reached, then one short of a good, then one short of travellers, then one that was only slow
  if (!served(town)) return tr(`${name} ei saanut rataa.`, `${name} never got a railway.`);
  const lacks = townLacks(s, town);
  if (lacks.length) return tr(`${name} kasvoi kokoon ${town.size}/${goal.size}. Se olisi kasvanut nopeammin, jos se olisi saanut myös ${lacks.map((g) => NONE_OF[g][0]).join(' ja ')}.`, `${name} reached size ${town.size} of ${goal.size}. It would have grown faster with ${lacks.map((g) => NONE_OF[g][1]).join(' and ')} too.`);
  return tr(`${name} kasvoi kokoon ${town.size}/${goal.size}.`, `${name} reached size ${town.size} of ${goal.size}${done ? `, ${done} of ${goal.count} towns made it` : ''}.`);
}

function House({ on }: { on: boolean }) {
  return (
    <svg className={`house${on ? ' on' : ''}`} viewBox="0 0 24 24" aria-hidden>
      <path d="M3 12.5 L12 4 L21 12.5 L21 21 L3 21 Z" />
      <rect x="10" y="14" width="4" height="7" />
    </svg>
  );
}

function ResultCard({ s, onAgain, onQuit }: { s: SimState; onAgain: () => void; onQuit: () => void }) {
  const r = s.result!;
  const goal = s.scenario.goal;
  const towns = s.sites.filter((x) => x.kind === 'town');
  const need = goal.kind === 'towns' ? goal.size : 0;
  const rows = [
    { n: 1, text: tr('Voitto', 'A win') },
    { n: 2, text: tr(`Voitto vuoteen ${s.scenario.stars[0]} mennessä`, `Win by ${s.scenario.stars[0]}`) },
    { n: 3, text: tr(`Voitto vuoteen ${s.scenario.stars[1]} mennessä`, `Win by ${s.scenario.stars[1]}`) },
  ];
  return (
    <div className="card result overlay" data-ui data-result={r.won ? 'won' : r.reason}>
      <h2>{r.won ? tr('Tavoite täyttyi', 'Goal reached') : r.reason === 'bankrupt' ? tr('Konkurssi', 'Bankrupt') : tr('Aika loppui', 'Out of time')}</h2>
      <div className="res-year" data-sec="year">{r.year}</div>
      <p className="small" data-sec="played">{tr(`Peliaika ${Math.floor(r.time / 60)} min ${Math.round(r.time % 60)} s`, `Played ${Math.floor(r.time / 60)} min ${Math.round(r.time % 60)} s`)}</p>
      <div className="res-cols">
        <div className="res-stars" data-sec="stars">
          {rows.map((o) => (
            <div key={o.n} className={`res-star${r.stars >= o.n ? ' got' : ''}`} data-star={o.n}>
              <span className="mark">{r.stars >= o.n ? '★' : '☆'}</span>
              <span>{o.text}</span>
            </div>
          ))}
          <p className="worth">
            {tr('Nettovarallisuus', 'Net worth')} <b>{num(r.worth)}</b>
          </p>
        </div>
        <div className="res-built" data-sec="built">
          <p className="built-head">{tr('Rakensit', 'You built')}</p>
          <p className="built-count">
            <b>{s.lines.length}</b> {s.lines.length === 1 ? tr('rata', 'line') : tr('rataa', 'lines')}, <b>{s.trains.length}</b> {s.trains.length === 1 ? tr('juna', 'train') : tr('junaa', 'trains')}
          </p>
          {towns.map((x) => (
            <div key={x.id} className={`res-town${need && x.size >= need ? ' done' : ''}`} data-town={x.id}>
              <span className="tn">{tt(x.name)}</span>
              <span className="houses" aria-label={`${x.size}`}>
                {Array.from({ length: x.size }, (_, i) => (
                  <House key={i} on={!need || x.size >= need} />
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
      {!r.won && <p className="res-missing" data-sec="missing">{missingText(s)}</p>}
      <div className="res-buttons">
        <button className="btn primary wide" onClick={onAgain} data-track="result-again">
          {tr('Pelaa uudelleen', 'Play again')}
        </button>
        <button className="btn wide" onClick={onQuit} data-track="result-choose">
          {tr('Valitse kenttä', 'Choose a scenario')}
        </button>
      </div>
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
