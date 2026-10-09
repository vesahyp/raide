/**
 * The game screen: the canvas, the loop, the HUD and the cards. The sim
 * lives in a ref and survives a turn of the phone; the HUD reads it a few
 * times a second; the cards open on the sim's events (a build, a choice of
 * routes, a year end, the result) and on taps: a line, a train, a site.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Cargo, EngineId, Good, Line, Load, ScenarioDef, SimState, Site, Train, WagonType } from '../game/types';
import { createState, siteById, siteAt, goodsOnMap, stationAt } from '../game/state';
import { DT, freeSide, canExtend, step, buyTrain, undo, closeYearEnd, trainPrice, note, price, plan, build, addWagon, removeWagon, setEngine, setFullLoad, sellTrain, fillOf, storeCap, eatsPerMonth, growthOutlook, goalProgress, lineOf, buyers, moveTrain, buyCrew, canMove, tripTimes, gradeFactor, borrow, repay, loanCeiling, netWorth, liftLine, liftValue, lineYear, farePay, visited, townEats, fareTargets, wantsPeople, lineTrackUpkeep, runningCostYear, runPerTile, trainSpot, buyPlatform, platformPrice, buySiding, buyCrane, craneSite, sidingAt, defaultConsist, consistCycle, stopSite, stopGood, stopS, wagonRoutes, wagonWaste, wasteWagons, WAGON_BACK } from '../game/sim';
import { Orders } from './Orders';
import { HOUSES_PER_SIZE } from '../render/town';
import { WAGON_GOODS, CRANE_GOODS, CRANE_PRICE, CREW_PRICE, SIDING_PRICE, SIDING_LEN, ENGINES, ENGINE_LEN, GOOD_NAME, LOAN_RATE, LOAN_STEP, MAKES, MONTHS, YEAR_SECONDS, TOWN_MAX, TOWN_STORE_CAP, RAW_RATE, RESALE, TAKES, WAGON_LEN, WAGON_NAME, WAGON_PRICE, WAGONS_MAX, wagonFor } from '../game/content/economy';
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
import { townLacks } from '../game/advice';
import { advice, adviceKey, type Advice } from '../game/advice';
import { tipText, lineName, readGoalTowns, GoalTowns, untilText, type GoalTown } from './tips';
import { GoodIcon, NONE_OF, WagonStrip, WagonPicker, CarryText } from './Wagons';

/** how much faster the clock runs while the fast button is on */
const FAST = 3;

type Card =
  | { kind: 'line'; lineId: number }
  | { kind: 'train'; trainId: number }
  | { kind: 'site'; siteId: string }
  | { kind: 'choice'; options: Route[]; sx: number; sy: number; /** the lines the new stop could lengthen, each with the routes that do */ extend?: { lineId: number; options: Route[]; trainIds: number[] }[] }
  | { kind: 'yearEnd' }
  | { kind: 'result' }
  | { kind: 'pause' }
  | { kind: 'money' }
  | { kind: 'goal' }
  | null;

interface Hud {
  year: number;
  month: number;
  cash: number;
  goal: number;
  goalText: string;
  /** the towns the goal rides on, for the chip */
  towns: GoalTown[];
  /** the contracts taken, for the second line of the goal area */
  contracts: { id: number; site: string; good: Good; got: number; count: number; deadline: number }[];
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
  // the fast clock: a year in 30 s instead of 90, for the stretches where nothing needs the thumb
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
  // pick mode for a passing siding, from the line card: the line whose stretch glows
  const [sidingPick, setSidingPick] = useState<{ lineId: number } | null>(null);
  const placeSidingRef = useRef<(lineId: number, cell: number | null) => void>(() => {});
  const endSidingRef = useRef<(placed: boolean, lineId?: number) => void>(() => {});
  const inputRef = useRef<Input | null>(null);
  const cardRef = useRef<Card>(null);
  cardRef.current = card;
  // the year end opens the ledger only when the player is not in the middle of something
  const [ledgerWaits, setLedgerWaits] = useState(false);
  const ledgerWaitsRef = useRef(false);
  ledgerWaitsRef.current = ledgerWaits;
  const busyRef = useRef({ lay: false, siding: false });
  busyRef.current = { lay: lay !== null, siding: sidingPick !== null };
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
    const w = window as unknown as { __sim?: SimState; __input?: Input; __renderer?: Renderer2D; __pace?: number; __plan?: (a: number, b: number, ext?: number) => unknown; __act?: Record<string, unknown> };
    w.__sim = s;
    w.__renderer = renderer;
    w.__pace = speed;
    w.__plan = (a, b, ext?: number) => {
      const line = ext === undefined ? null : s.lines.find((l) => l.id === ext) ?? null;
      return line ? plan(s, a, b, freeSide(s, line, a)).filter((r) => canExtend(s, r, line.id)) : plan(s, a, b);
    };
    // the player's moves, for the scripts that set a scene up
    w.__act = { plan: (a: number, b: number) => plan(s, a, b), build: (r: Route, ext?: number) => build(s, r, ext), buyTrain: (l: number, wg: WagonType | WagonType[], e: EngineId, n?: number) => buyTrain(s, l, wg, e, n), moveTrain: (t: number, l: number) => moveTrain(s, t, l), price: (e: EngineId, n: number) => trainPrice(e, n), ceiling: () => loanCeiling(s), buySiding: (l: number, cell?: number) => buySiding(s, l, cell), buyCrane: (st: number) => buyCrane(s, st), spotFree: (lineId: number, n: number) => { const l = s.lines.find((o) => o.id === lineId); const sp = l ? trainSpot(s, l, n) : null; return !!sp && !sp.parked; } };
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
        onChoice: (options, sx, sy, extend) => setCard({ kind: 'choice', options, sx, sy, extend: extend ? extend.map((e) => ({ lineId: e.line.id, options: e.options, trainIds: e.trains.map((x) => x.id) })) : undefined }),
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
        onSiding: (lineId, cell) => placeSidingRef.current(lineId, cell),
        onSidingEnd: () => endSidingRef.current(false),
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
    // twice a second: the advice, the tip held on screen for 8 s, and the marker on the map
    const refreshTip = (now: number) => {
      const held = tipRef.current;
      const list = tipOff.current === s.year || s.result || s.yearEnd ? [] : advice(s);
      let next = held;
      if (held.adv && list.some((a) => adviceKey(a) === held.key)) next = held;
      else if (held.adv) next = { adv: null, key: '', at: held.at };
      if (!next.adv && list.length && now - next.at >= 8000) next = { adv: list[0], key: adviceKey(list[0]), at: now };
      if (next !== held) {
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
      if (!pausedRef.current && !s.yearEnd && !s.result && !(window as unknown as { __freeze?: boolean }).__freeze) {
        acc += real * speed * (fastRef.current ? FAST : 1);
        let n = 0;
        while (acc >= DT && n < 30 * FAST) {
          if (bot && !(holdLedger > 0 && s.yearEnd && s.history.length >= holdLedger)) bot.act(s);
          step(s);
          acc -= DT;
          n++;
        }
      }
      // the sim's own stops open their cards
      if (s.result && cardRef.current?.kind !== 'result') {
        saveStars(scenario.id, s.result.stars);
        track('scenario_end', { scenario: scenario.id, won: s.result.won, year: s.result.year, cash: s.result.cash, worth: s.result.worth, stars: s.result.stars, reason: s.result.reason });
        setCard({ kind: 'result' });
      } else if (s.yearEnd && !s.result && cardRef.current?.kind !== 'yearEnd') {
        // a held drag, a pick mode and any card the player opened come first: the ledger waits until they are done
        const kind = cardRef.current?.kind;
        const busy = !!input.drag || busyRef.current.lay || busyRef.current.siding || (kind !== undefined && kind !== 'result');
        if (bot && !(holdLedger > 0 && s.history.length >= holdLedger)) bot.act(s);
        else if (busy) setLedgerWaits((x) => (x ? x : true));
        else setCard({ kind: 'yearEnd' });
      }
      if (ledgerWaitsRef.current && (!s.yearEnd || cardRef.current?.kind === 'yearEnd')) setLedgerWaits(false);
      for (const name of s.sounds) play(name);
      s.sounds.length = 0;
      if (!s.lastBuild) setCancel((c) => (c ? null : c));
      const c = cardRef.current;
      input.update(real);
      renderer.draw(real * speed, input.drag, hint, c?.kind === 'choice' ? (c.extend ? [...c.extend.flatMap((e) => e.options), ...c.options] : c.options) : null);
      if (frame % 30 === 0) refreshTip(now);
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

  // the passing siding's pick mode: the line's green stretch, a tap or the best place buys it
  const beginSidingPick = (lineId: number) => {
    setCard(null);
    setSidingPick({ lineId });
    rendRef.current?.beginSidingPick(lineId);
    if (inputRef.current) inputRef.current.siding = { lineId };
  };
  endSidingRef.current = (placed, lineId) => {
    rendRef.current?.endPick(placed);
    if (inputRef.current) inputRef.current.siding = null;
    setSidingPick(null);
    if (lineId !== undefined) setCard({ kind: 'line', lineId });
  };
  const placeSiding = (lineId: number, cell: number | null) => {
    if (buySiding(s, lineId, cell ?? undefined)) {
      track('siding', { scenario: scenario.id });
      endSidingRef.current(true, lineId);
    }
  };
  placeSidingRef.current = placeSiding;
  const endSidingPick = (placed: boolean) => endSidingRef.current(placed, sidingPick?.lineId);

  const goal = scenario.goal;
  const close = () => setCard(null);
  const line = card?.kind === 'line' ? s.lines.find((l) => l.id === card.lineId) ?? null : null;
  const train = card?.kind === 'train' ? s.trains.find((t) => t.id === card.trainId) ?? null : null;
  const site = card?.kind === 'site' ? s.sites.find((x) => x.id === card.siteId) ?? null : null;

  return (
    <div className={`game${ledgerWaits ? ' ledger-waits' : ''}`}>
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
        <button className="hud-goal" data-act="goal" aria-label={tr('Tavoite', 'Goal')} onClick={() => setCard({ kind: 'goal' })}>
          {goal.kind === 'towns' ? (
            <>
              <GoalTowns s={s} towns={hud.towns} size={goal.size} />
              <span className="bar">
                <i style={{ width: `${Math.min(100, 100 * hud.goal)}%` }} />
              </span>
            </>
          ) : (
            <div className="goal-row">
              <span className="label">{tr('Laudat', 'Boards')}</span>
              <span className="num">{hud.goalText}</span>
              <span className="bar">
                <i style={{ width: `${Math.min(100, 100 * hud.goal)}%` }} />
              </span>
              <span className="until">{tr('ennen', 'before')} {goal.beforeYear}</span>
            </div>
          )}
        </button>
        <button className={`hud-cash num${hud.cash < 0 ? ' red' : ''}`} data-act="money" aria-label={tr('Raha', 'Money')} onClick={() => setCard({ kind: 'money' })}>
          {num(hud.cash)}
        </button>
        <button className="round pause" aria-label={tr('Tauko', 'Pause')} onClick={() => setCard({ kind: 'pause' })}>
          <svg viewBox="0 0 24 24" className="glyph"><rect x="6" y="5" width="4" height="14" fill="currentColor" /><rect x="14" y="5" width="4" height="14" fill="currentColor" /></svg>
        </button>
        <div className="hud-sub">
        {tip && (
          <div className="hud-tip" data-sec="tip" data-tip={tip.kind} data-lengthen={lineSiteIds(s, tip.lengthen)}>
            <button
              className="tip-text"
              data-act="tip"
              onClick={() => {
                rendRef.current?.panToSite(tip.site);
                setCard({ kind: 'site', siteId: tip.site });
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
        {hud.contracts.length > 0 && (
          <div className="hud-contracts" data-sec="hud-contracts">
            {hud.contracts.map((c) => (
              <span key={c.id} className="ct" data-contract={c.id}>
                <GoodIcon good={c.good} />
                <span className="who">{tt(siteById(s, c.site).name)}</span>
                <b>{c.got}/{c.count}</b>
                <small>{c.deadline}</small>
              </span>
            ))}
          </div>
        )}
        </div>
      </div>
      {ledgerWaits && (
        <div className={`yearend-pill${lay || sidingPick ? ' low' : ''}`} data-ui data-sec="yearend-pill">
          {tr('Vuosi päättyi: tilinpäätös, kun olet valmis', 'Year ended: ledger when you are done')}
        </div>
      )}
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
      {sidingPick && (
        <div className="pick-banner" data-ui data-sec="siding-banner">
          <span>{tr('Napauta vihreää osaa', 'Tap the green part')}</span>
          <button className="btn" data-act="siding-best" onClick={() => placeSiding(sidingPick.lineId, null)}>
            {tr('Paras paikka', 'Best place')}
          </button>
          <button className="btn" data-act="siding-cancel" onClick={() => endSidingPick(false)}>
            {tr('Peru', 'Cancel')}
          </button>
        </div>
      )}
      {card === null && !paused && (
        <div className="zoom" data-ui>
          <button className={`round fast${fast ? ' on' : ''}`} aria-label={fast ? tr('Normaali nopeus', 'Normal speed') : tr('Nopeammin', 'Faster')} aria-pressed={fast} data-act="fast" onClick={() => setFast((f) => !f)}>
            <svg viewBox="0 0 24 24" className="glyph"><path d="M4 6 L11 12 L4 18 Z M12 6 L19 12 L12 18 Z" fill="currentColor" /></svg>
          </button>
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
          extend={card.extend ? card.extend.map((e) => ({ line: s.lines.find((l) => l.id === e.lineId)!, options: e.options, trains: e.trainIds.map((id) => s.trains.find((x) => x.id === id)).filter((x): x is Train => !!x) })) : undefined}
          onPick={(r, extendId) => {
            if (r.cost > s.cash) {
              note(s, r.cells[r.cells.length - 1], tr('Ei rahaa', 'No cash'));
              return;
            }
            const l = build(s, r, extendId);
            if (l) {
              track('build', { scenario: scenario.id, cost: r.cost, bridge: r.bridge.length, cutting: r.cutting.length, mode: r.mode, extend: extendId !== undefined });
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
          onBuy={(wagons, engine) => {
            const t = buyTrain(s, line.id, wagons, engine);
            if (t) {
              track('train', { scenario: scenario.id, wagons: wagons.join(), engine, count: wagons.length });
              setCancel(null);
              setCard(null);
            }
          }}
          onTrain={(t) => setCard({ kind: 'train', trainId: t.id })}
          onSiding={() => beginSidingPick(line.id)}
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
        />
      )}
      {card?.kind === 'yearEnd' && s.yearEnd && (
        <YearEndCard
          s={s}
          onChoose={(take) => {
            track('year_end', { scenario: scenario.id, year: s.yearEnd?.year ?? 0, profit: s.yearEnd?.profit ?? 0, contract: s.offer ? (take ? 'taken' : 'skipped') : 'none' });
            closeYearEnd(s, take);
            setCard(null);
          }}
        />
      )}
      {card?.kind === 'result' && s.result && <ResultCard s={s} onAgain={onAgain} onQuit={onQuit} />}
      {card?.kind === 'money' && <MoneyCard s={s} onClose={close} />}
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
  const goal = s.scenario.goal;
  const towns = s.sites.filter((x) => x.kind === 'town');
  const goalText = goal.kind === 'deliver' ? `${s.goalCount}/${goal.count}` : `${Math.min(goal.count, towns.filter((x) => x.size >= goal.size).length)}/${goal.count}`;
  return { year: s.year, month: s.month, cash: Math.floor(s.cash), goal: goalProgress(s), goalText, towns: readGoalTowns(s), contracts: s.contracts.map((c) => ({ id: c.id, site: c.site, good: c.good, got: c.got, count: c.count, deadline: c.deadline })) };
}

/** the site whose station stands at a cell */
function siteOfCell(s: SimState, cell: number): Site {
  return siteById(s, s.stations.find((x) => x.cell === cell)!.siteId);
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

/** the site ids of a line's stops in order, comma separated, for the scripts; undefined when there is no such line */
function lineSiteIds(s: SimState, lineId: number | undefined): string | undefined {
  const line = lineId === undefined ? undefined : s.lines.find((l) => l.id === lineId);
  return line ? line.stops.map((_, i) => stopSite(s, line, i).id).join(',') : undefined;
}

/**
 * The lift of a drag. Two routes to the same place: the cheap one and the short one, with what each
 * costs and runs. When the drag starts at the end of a line that has room for a stop, the card also
 * asks whether the new stop lengthens that line or starts a new one, and each way shows its own route.
 */
function ChoiceCard({ s, options, extend, onPick, onClose }: { s: SimState; options: Route[]; extend?: { line: Line; options: Route[]; trains: Train[] }[]; onPick: (r: Route, extendId?: number) => void; onClose: () => void }) {
  const name = (r: Route) => (r.bridge.length ? tr('Silta', 'Bridge') : r.cutting.length ? tr('Leikkaus', 'Cutting') : r.mode === 'cheap' ? tr('Kierto', 'Around') : tr('Suora', 'Direct'));
  const target = siteAt(s, options[0].cells[options[0].cells.length - 1]);
  const groups: { key: string; label: string | null; routes: Route[]; from: number; extendId?: number; trains?: Train[] }[] = [];
  if (extend) {
    // a new line comes first and is the plain way; lengthening is a deliberate second choice and says which trains it sends on
    groups.push({ key: 'new', label: tr('Uusi rata', 'New line'), routes: options, from: 0 });
    let from = options.length;
    for (const e of extend) {
      groups.push({ key: `extend-${e.line.id}`, label: tr(`Jatka rataa ${lineName(s, e.line)} → ${tt(target!.name)}`, `Lengthen ${lineName(s, e.line)} to ${tt(target!.name)}`), routes: e.options, from, extendId: e.line.id, trains: e.trains });
      from += e.options.length;
    }
  } else groups.push({ key: 'way', label: null, routes: options, from: 0 });
  return (
    <div className="card sheet choice-card" data-ui>
      <CardHead title={extend ? tt(target!.name) : tr('Kumpaa kautta?', 'Which way?')} onClose={onClose} />
      {groups.map((g) => (
        <div key={g.key} className="grp" data-group={g.key}>
          {g.label && <div className="buy-label">{g.label}</div>}
          {g.trains && (
            <p className="small" data-sec="run-on">
              {tr(`Nämä junat ajavat jatkossa ${tt(target!.name)} asti: `, `These trains will now run on to ${tt(target!.name)}: `)}
              {g.trains.map((x) => `${tt(ENGINES[x.engine].name)} (${[...new Set(x.wagons.map((w) => tt(WAGON_NAME[w])))].join(', ')})`).join('; ')}
            </p>
          )}
          <div className="routes">
            {g.routes.map((r, k) => {
              const earth = earthWord(r);
              const i = g.from + k;
              return (
                <button key={r.mode} className="btn route" data-route={r.mode} data-group-route={g.key} disabled={r.cost > s.cash} style={{ borderColor: OPTION_COLOUR[i] }} onClick={() => onPick(r, g.extendId)}>
                  <span className="swatch" style={{ background: OPTION_COLOUR[i] }} />
                  <span className="name">{g.label && g.routes.length === 1 ? tr('Rakenna', 'Build') : name(r)}</span>
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
        </div>
      ))}
      <p className="small">
        {extend
          ? tr('Jatkettu rata on yksi rata: juna ajaa päästä päähän ja pysähtyy välissä purkamaan ja lastaamaan.', 'A lengthened line is one line: the train runs end to end and stops in the middle to unload and load.')
          : tr('Lyhyt rata tekee enemmän matkoja vuodessa. Jyrkässä nousussa kevyt veturi ryömii.', 'A short line makes more trips a year. On a steep climb the light engine crawls.')}
      </p>
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

/** the goods a consist carries on a line, each once, with the pay of one load now and the stops it runs between */
function consistPays(s: SimState, line: Line, wagons: WagonType[]): { good: Cargo; from: Site; to: Site; pays: number }[] {
  const out: { good: Cargo; from: Site; to: Site; pays: number }[] = [];
  for (const w of new Set(wagons))
    for (const r of wagonRoutes(s, line, w)) {
      if (out.some((o) => o.good === r.good)) continue;
      const to = stopSite(s, line, r.to);
      const dist = Math.abs(stopS(line, r.to) - stopS(line, r.from));
      out.push({ good: r.good, from: stopSite(s, line, r.from), to, pays: r.good === 'pax' || r.good === 'mail' ? farePay(r.good, dist, 0) : price(s, r.good, to.id, dist) });
    }
  return out;
}

/** the stops of a line in order with arrows, each with the good that moves there */
function StopsRow({ s, line }: { s: SimState; line: Line }) {
  return (
    <div className="stops-row" data-sec="stops">
      {line.stops.map((_, i) => {
        const good = stopGood(s, line, i);
        return (
          <span key={i} className="stop" data-stop={i}>
            {i > 0 && <b className="arrow">→</b>}
            {tt(stopSite(s, line, i).name)}
            {good && <GoodIcon good={good} />}
          </span>
        );
      })}
    </div>
  );
}

/** a signed money figure for the cards: + or the true minus */
const signed = (n: number): string => {
  const r = Math.round(n);
  return `${r >= 0 ? '+' : '−'}${num(Math.abs(r))}`;
};

/** the money card: cash, the loan against its ceiling, net worth, and the two buttons */
/** the goal in full: each town, its size, its growth meter and what it lacks right now, and the year limit */
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
          return (
            <div key={x.id} className={`goal-town${chosen.has(x.id) ? ' on' : ''}${done ? ' done' : ''}`} data-goal-card-town={x.id}>
              <div className="gtn">
                <b>{tt(x.name)}</b>
                <span className="num">{done ? '✓' : `${x.size}→${goal.size}`}</span>
              </div>
              <div className="gm" aria-label={tr('Kasvumittari', 'Growth meter')}>
                <i style={{ width: `${Math.round(100 * (x.size >= TOWN_MAX ? 1 : x.growth))}%` }} />
              </div>
              <div className="gl">
                {x.size >= TOWN_MAX || done ? (
                  <small>{tr('Valmis', 'Done')}</small>
                ) : lacks.length ? (
                  <>
                    <small>{tr('Puuttuu', 'Lacks')}</small>
                    {lacks.map((g) => (
                      <span key={g} className="lack">
                        <GoodIcon good={g} />
                        {tr(NONE_OF[g][0], NONE_OF[g][1])}
                      </span>
                    ))}
                  </>
                ) : (
                  <small>{tr('Kaikkea on, kasvaa', 'Has what it needs, growing')}</small>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function MoneyCard({ s, onClose }: { s: SimState; onClose: () => void }) {
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
      </div>
      <p className="small">{tr('Kassa voi painua miinukselle vain ajokuluista. Kaksi vuodenvaihdetta peräkkäin miinuksella ja laina täynnä on konkurssi.', 'Cash can dip below zero only through running costs. Two year ends in a row below zero with the loan full is bankruptcy.')}</p>
    </div>
  );
}

/** why a train that adds nothing adds nothing, in a line */
function limitText(limit: 'free' | 'block' | 'platform' | 'parked', at: string): string {
  if (limit === 'parked' || limit === 'platform') return tr(`+0 matkaa: osta toinen laituri asemalle ${at}`, `+0 trips: buy a second platform at ${at}`);
  if (limit === 'block') return tr('Rataosuudella ajaa vain yksi juna kerrallaan: junat jonottavat.', 'Only one train runs a stretch at a time: trains queue.');
  return '';
}

/**
 * The line card: the line's stops in order, its trains, what it earned and cost this year and its net,
 * lifting it when no train runs on it, and the buy card: the engine (each with its price, upkeep and the
 * trips a year it makes), the consist built wagon by wagon (tap a type to add one, tap a wagon in the
 * strip to take it off), what each type carries on this line, what one more train adds to the line, its
 * running cost and the price.
 */
function LineCard({ s, line, onBuy, onTrain, onSiding, onLift, onClose }: { s: SimState; line: Line; onBuy: (w: WagonType[], e: EngineId) => void; onTrain: (t: Train) => void; onSiding: () => void; onLift: () => void; onClose: () => void }) {
  const [consist, setConsist] = useState<WagonType[]>(() => defaultConsist(s, line));
  const count = consist.length;
  // the faster engine on this line is the one that makes more trips a year
  const [engine, setEngineId] = useState<EngineId>(() => [...s.scenario.engines].sort((x, y) => lineYear(s, line, { engine: y, wagons: consist }).trips - lineYear(s, line, { engine: x, wagons: consist }).trips)[0]);
  const cost = trainPrice(engine, count);
  const trains = s.trains.filter((t) => t.lineId === line.id);
  const spot = trainSpot(s, line, count);
  const can = !!spot && cost <= s.cash && count > 0;
  const pays = consistPays(s, line, consist);
  // what the line does now, and with this train on it
  const now = lineYear(s, line);
  const withIt = lineYear(s, line, { engine, wagons: consist });
  const added = withIt.trips - now.trips;
  const mine = withIt.each[withIt.each.length - 1];
  const runs = runningCostYear(line, engine, count, mine);
  // the line's money this year so far
  const earned = line.earnedYear;
  const trackCost = lineTrackUpkeep(s, line) * s.yearFrac;
  const net = earned - line.runYear - trackCost;
  const wastes = consist.filter((w) => wagonWaste(s, line, w)).length;
  const lift = trains.length === 0;
  return (
    <div className="card sheet buy-card" data-ui>
      <CardHead
        title={[0, line.stops.length - 1].map((k, i) => (
          <span key={k}>
            {i > 0 && <span className="arrow"> ⇄ </span>}
            {tt(stopSite(s, line, k).name)}
          </span>
        ))}
        onClose={onClose}
      />
      <div className="buy-scroll" data-sec="buy-scroll">
        <div className="line-biz" data-sec="line-biz">
          {line.stops.length > 2 && <StopsRow s={s} line={line} />}
          <div className="money-row" data-sec="line-money">
            <div>
              <small>{tr('Tuotto', 'Earned')}</small>
              <b className="num gold">{num(earned)}</b>
            </div>
            <div>
              <small>{tr('Kulut', 'Costs')}</small>
              <b className="num">{num(line.runYear + trackCost)}</b>
              <small className="sub">
                {tr('ajo', 'run')} {num(line.runYear)} · {tr('rata', 'track')} {num(trackCost)}
              </small>
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
                    {tt(ENGINES[t.engine].name)} · {t.cargo}/{t.nWagons}{' '}
                    {[...new Set(t.loads.filter((l): l is Load => !!l).map((l) => tt(GOOD_NAME[l.good])))].join(', ')}
                    {t.parked ? ` · ${tr('sivuraiteella', 'on a siding')}` : t.queued ? ` · ${tr('jonossa', 'queued')}` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
          {lift ? (
            <button className="btn act lift" data-act="lift" onClick={onLift}>
              <span>{tr('Nosta rata', 'Lift the line')}</span>
              <small>
                {tr('puolet hinnasta takaisin', 'half the price back')} +{num(liftValue(s, line))}
              </small>
            </button>
          ) : (
            <p className="note" data-sec="lift-note">{tr('Nosta rata: ensin on myytävä sen junat', 'Lift the line: sell its trains first')}</p>
          )}
          {line.stops.length === 2 && <SidingRow s={s} line={line} engine={engine} wagons={consist} onBuy={onSiding} />}
        </div>
        <h3 className="buy-title">{tr('Osta juna', 'Buy a train')}</h3>
        <div className="buy-label">{tr('Veturi', 'Engine')}</div>
        <div className="wagons engines">
          {s.scenario.engines.map((e) => (
            <button key={e} className={`wagon engine${engine === e ? ' on' : ''}`} data-engine={e} onClick={() => setEngineId(e)}>
              <span className={`pic eng${e === 'jyry' ? ' strong' : ''}`} />
              <span className="ename">
                <b>{tt(ENGINES[e].name)}</b> <span className="num gold">{ENGINES[e].price}</span>
              </span>
              <small>{tr('ylläpito', 'upkeep')} {ENGINES[e].upkeep}/{tr('v', 'yr')}</small>
              <small>{tr('ajo', 'run')} {runPerTile(e, count).toFixed(2)}/{tr('ruutu', 'tile')}</small>
              <b className="trips-line">{perYear(lineYear(s, line, { engine: e, wagons: consist }).each.slice(-1)[0])} {tr('matkaa', 'trips')}</b>
            </button>
          ))}
        </div>
        <div className="buy-label">
          {tr('Vaunut', 'Wagons')} <span className="num">{count}/{WAGONS_MAX}</span>
        </div>
        <div className="consist-build" data-sec="consist">
          <WagonStrip s={s} line={line} engine={engine} max={WAGONS_MAX} wagons={consist} onTap={(i) => setConsist(consist.filter((_, k) => k !== i))} label={(i) => tr(`Poista vaunu ${i + 1}`, `Remove wagon ${i + 1}`)} />
          <small className="hint">{count === 0 ? tr('Napauta + alta vaunun lisäämiseksi', 'Tap + below to add a wagon') : tr('Napauta vaunua poistaaksesi sen', 'Tap a wagon to take it off')}</small>
        </div>
        <WagonPicker s={s} line={line} full={count >= WAGONS_MAX} strict price={WAGON_PRICE} onAdd={(w) => setConsist([...consist, w])} />
        <p className="small" data-sec="pays">
          {pays.length
            ? pays.map((p, i) => (
                <span key={p.good}>
                  {i > 0 ? ' · ' : ''}
                  <GoodIcon good={p.good} /> {tr('kuorma maksaa nyt', 'a load pays now')} <b className="gold">{p.pays}</b> {tr('kohteessa', 'at')} {tt(p.to.name)}
                </span>
              ))
            : tr('Tämän junan vaunut eivät kuljeta mitään tällä radalla.', 'This train carries nothing on this line.')}
          {wastes > 0 && pays.length > 0 && <span className="red"> · {wastes} {wastes === 1 ? tr('turha vaunu', 'wagon carries nothing') : tr('turhaa vaunua', 'wagons carry nothing')}</span>}
        </p>
        <div className="facts" data-sec="adds">
          <div className="fact" data-sec="adds-trips">
            <span className="fl">{tr('Tämä juna', 'This train')}</span>
            <span className="num">
              <b className={added < 0.3 ? 'red' : 'gold'}>{added >= 0.05 ? '+' : ''}{added.toFixed(1)}</b> {tr('matkaa/v', 'trips/yr')} <small>({now.trips.toFixed(1)} → {withIt.trips.toFixed(1)})</small> · <b data-sec="adds-cost">{num(runs)}</b> <small>{tr('ajokulut/v', 'running/yr')}</small>
            </span>
            {withIt.limit !== 'free' && <small className="why">{limitText(withIt.limit, tt(siteOfCell(s, withIt.at).name))}</small>}
          </div>
        </div>
      </div>
      <div className="buy-foot" data-sec="buy-foot">
        <button className="btn primary wide" disabled={!can} onClick={() => onBuy(consist, engine)} data-track="card-buy-train" data-act="buy">
          <span>{!spot ? tr('Ei tilaa laiturilla', 'No room at the station') : `${tr('Osta juna', 'Buy train')}  ${cost}`}</span>
          {!!spot && <small data-sec="buy-trips">{added >= 0.05 ? '+' : ''}{added.toFixed(1)} {tr('matkaa/v', 'trips/yr')}</small>}
        </button>
      </div>
    </div>
  );
}

/**
 * The passing siding on the line card: what it is, the trips a year with it and without, and Buy,
 * which puts the line in pick mode. With one train on the line the numbers are for a second one.
 */
function SidingRow({ s, line, engine, wagons, onBuy }: { s: SimState; line: Line; engine: EngineId; wagons: WagonType[]; onBuy: () => void }) {
  const fits = useMemo(() => !!sidingAt(s, line), [s, line, s.track]);
  const active = s.trains.filter((t) => t.lineId === line.id && !t.parked).length;
  const extra = active < 2 ? { engine, wagons } : undefined;
  const without = lineYear(s, line, extra).trips;
  const withIt = lineYear(s, line, extra, true).trips;
  const f1 = (n: number): string => n.toFixed(1);
  const name = tr('Ohitusraide', 'Passing siding');
  if (line.siding)
    return (
      <p className="note" data-sec="siding">
        {name}: <b className="bought">{tr('ostettu', 'bought')}</b> · <b className="num">{f1(lineYear(s, line).trips)}</b> {tr('matkaa/v', 'trips/yr')}
      </p>
    );
  // what cannot be done now is a line of text with its reason, not a button
  if (!fits) return <p className="note" data-sec="siding">{name}: {tr(`tarvitsee suoran osuuden, ${Math.ceil(SIDING_LEN)} ruutua`, `needs a straight stretch of ${Math.ceil(SIDING_LEN)} tiles`)}</p>;
  if (s.cash < SIDING_PRICE) return <p className="note" data-sec="siding">{name}: {tr(`maksaa ${SIDING_PRICE}, kassassa ei ole tarpeeksi`, `costs ${SIDING_PRICE}, not enough cash`)}</p>;
  return (
    <div className="siding-buy" data-sec="siding">
      <span>
        {name}: {active < 2 ? tr('kahdella junalla ', 'with two trains ') : ''}
        <b className="num gold">{f1(withIt)}</b> {tr('matkaa/v', 'trips/yr')} <small>({tr('nyt', 'now')} {f1(without)})</small>
      </span>
      <button className="btn act" data-act="siding" onClick={onBuy}>
        <span>{tr('Osta', 'Buy')}</span>
        <small>{SIDING_PRICE}</small>
      </button>
    </div>
  );
}

/** seconds as "21 s" */
const secs = (n: number): string => `${Math.round(n)} s`;

/**
 * The train card: the consist with each wagon's load now and what it carries on this line (a wagon
 * that carries nothing is marked), the trip time full and empty, what it earned this year and last,
 * the speed each engine keeps on the line's worst grade, and its moves: a wagon of any type added or
 * taken off, an engine, the full-load switch, another line, sell.
 */
function TrainCard({ s, train: t, onClose, onSold }: { s: SimState; train: Train; onClose: () => void; onSold: () => void }) {
  const line = lineOf(s, t);
  const [moving, setMoving] = useState(false);
  const other = s.scenario.engines.find((e) => e !== t.engine);
  const swapCost = other ? ENGINES[other].price - Math.round(ENGINES[t.engine].price * RESALE) : 0;
  const resale = Math.round((ENGINES[t.engine].price + t.nWagons * WAGON_PRICE) * RESALE);
  const tt2 = tripTimes(s, line, t.engine, t.nWagons);
  const stands = consistCycle(s, line, t.engine, t.wagons, t.skip).stands.reduce((a, x) => a + x, 0);
  const net = t.earnedYear - t.runYear - ENGINES[t.engine].upkeep * s.yearFrac;
  const waste = wasteWagons(s, t);
  // the lines that share a station with this one
  const mine = new Set(line.stops);
  const lines = s.lines.filter((l) => l.id !== line.id && l.stops.some((x) => mine.has(x)));
  const goodsAboard = [...new Set(t.loads.filter((l): l is Load => !!l).map((l) => l.good))];
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
      <Orders s={s} train={t} line={line} />
      <div className="facts" data-sec="facts">
        <div className="fact">
          <span className="fl">{tr('Kuorma', 'Load')}</span>
          <b className="num">{t.cargo}/{t.nWagons}</b>
          <span className="bar">
            <i style={{ width: `${(100 * t.cargo) / t.nWagons}%` }} />
          </span>
          {goodsAboard.map((g) => (
            <GoodIcon key={g} good={g} />
          ))}
        </div>
        <div className="wagon-rows" data-sec="wagons">
          {t.wagons.map((w, i) => {
            const load = t.loads[i];
            const isWaste = waste.includes(i);
            return (
              <div key={i} className={`wagon-row${isWaste ? ' waste' : ''}`} data-wagon-row={i} data-type={w}>
                <span className={`pic ${w}`} />
                <span className="what">
                  <b>{tt(WAGON_NAME[w])}</b>
                  <span className="now">
                    {load ? (
                      <>
                        <GoodIcon good={load.good} /> {tt(GOOD_NAME[load.good])}
                      </>
                    ) : (
                      <small>{tr('tyhjä', 'empty')}</small>
                    )}
                  </span>
                  <CarryText s={s} line={line} type={w} skip={t.skip} />
                </span>
                {isWaste && <b className="mark" data-sec="waste">!</b>}
                <button className="btn act small-act" data-act="drop-wagon" data-wagon-at={i} disabled={t.nWagons <= 1} onClick={() => removeWagon(s, t.id, i)}>
                  <span>{tr('Poista', 'Remove')}</span>
                  <small>+{WAGON_BACK}</small>
                </button>
              </div>
            );
          })}
        </div>
        <div className="fact" data-sec="trip">
          <span className="fl">{tr('Matka-aika', 'Trip time')}</span>
          <span className="num">
            → {tr('tyhjä', 'empty')} {secs(tt2.empty[0])} · {tr('täysi', 'full')} {secs(tt2.full[0])}
            <br />← {tr('tyhjä', 'empty')} {secs(tt2.empty[1])} · {tr('täysi', 'full')} {secs(tt2.full[1])}
            <small>
              <br />
              {tr('Asemilla', 'Standing')} {secs(stands)} {tr('kierroksella', 'a round')}
            </small>
          </span>
        </div>
        <div className="fact" data-sec="earned">
          <span className="fl">{tr('Tuotto', 'Earned')}</span>
          <span className="num">
            <b className="gold">{num(t.earnedYear)}</b> {tr('tänä vuonna', 'this year')} · <b className="gold">{num(t.earnedLast)}</b> {tr('viime vuonna', 'last year')}
          </span>
        </div>
        <div className="fact" data-sec="costs">
          <span className="fl">{tr('Kulut', 'Costs')}</span>
          <span className="num">
            <b>{num(t.runYear + ENGINES[t.engine].upkeep * s.yearFrac)}</b> {tr('tänä vuonna', 'this year')} <small>{tr('ajo', 'running')} {num(t.runYear)} · {tr('ylläpito', 'upkeep')} {num(ENGINES[t.engine].upkeep * s.yearFrac)}</small>
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
      <div className="buy-label">
        {tr('Lisää vaunu', 'Add a wagon')} <span className="num">{t.nWagons}/{WAGONS_MAX}</span>
      </div>
      <WagonPicker s={s} line={line} full={t.nWagons >= WAGONS_MAX || s.cash < WAGON_PRICE} price={WAGON_PRICE} onAdd={(w) => addWagon(s, t.id, w)} />
      <div className="acts">
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
            const suits = t.wagons.some((w) => !wagonWaste(s, l, w));
            return (
              <div key={l.id} className="move-row">
                <button className="btn act" data-move={l.id} disabled={!ok} onClick={() => moveTrain(s, t.id, l.id)}>
                  <span>{lineName(s, l).replace(/–/g, ' ⇄ ')}</span>
                  <small>{ok ? (suits ? tr('siirrä tähän', 'move here') : tr('vaunut eivät sovi', 'wagons do not suit')) : tr('Lähetä, kun se on tämän radan asemalla', 'Send it when it stands at a station of that line')}</small>
                </button>
              </div>
            );
          })}
        </div>
      )}
      <p className="small">
        {tt(ENGINES[t.engine].blurb)}. {tr('Ylläpito', 'Upkeep')} {ENGINES[t.engine].upkeep}/{tr('v', 'yr')}.
        {t.parked ? ` ${tr('Odottaa sivuraiteella, kunnes linjalla on tilaa.', 'Waits on a siding until the line has room.')}` : ''}
        {t.queued ? ` ${tr('Odottaa linjalla laituria.', 'Waits on the line for a platform.')}` : ''}
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
  if (makes && site.stock >= site.rawCap - 0.01 && !s.trains.some((t) => lines.some((l) => l.id === t.lineId) && t.wagons.some((w) => WAGON_GOODS[w].includes(makes))))
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
 * The travellers and the post at a town's station: for each other town with a station the travellers
 * and the mail waiting to go there, and how many travellers arrived this month. From size 2 on a town
 * wants travellers to arrive before it grows, and the card says whether they do.
 */
function FolkRows({ s, site }: { s: SimState; site: Site }) {
  const targets = fareTargets(s, site);
  const wants = wantsPeople(s, site);
  const seen = visited(s, site);
  const ago = Math.round((s.time - site.lastArrival) / (YEAR_SECONDS / MONTHS));
  return (
    <div className="srow" data-sec="folk">
      <span className="sl">{tr('Matkat', 'Travel')}</span>
      <div className="sc">
        {targets.map((o) => (
          <div key={o.id} className="gline folk-row" data-dest={o.id}>
            <b className="dest">{tt(o.name)}</b>
            <GoodIcon good="pax" />
            <b data-pax>{Math.floor((site.pax[o.id] ?? 0) + 1e-9)}</b>
            <GoodIcon good="mail" />
            <b data-mail>{Math.floor((site.mail[o.id] ?? 0) + 1e-9)}</b>
          </div>
        ))}
        {!targets.length && <small>{tr('Ei toista kaupunkia, jossa on asema', 'No other town with a station')}</small>}
        <small data-sec="arrived" className={wants && !seen ? 'red' : ''}>
          {tr(`matkustajia: ${site.arrived} saapui tässä kuussa`, `travellers: ${site.arrived} arrived this month`)}
          {wants && site.arrived === 0 && (Number.isFinite(site.lastArrival) ? ` · ${tr(`viimeksi ${ago} kk sitten`, `last ${ago} months ago`)}` : ` · ${tr('ei vielä yhtään', 'none yet')}`)}
        </small>
        {wants && <small>{tr('Kaupunki haluaa matkustajia kasvaakseen.', 'The town wants travellers to grow.')}</small>}
      </div>
    </div>
  );
}

/**
 * A town's store and growth: per good the store of its cap with a bar, the price now and how much
 * the town eats a month; the growth meter with the months to the next size at this supply, or the
 * good that is missing; the size and what the next size gives.
 */
function TownRows({ s, site, takes, railed }: { s: SimState; site: Site; takes: Good[]; railed: boolean }) {
  const cap = storeCap(site);
  const eats = eatsPerMonth(site);
  const out = growthOutlook(s, site);
  const maxed = site.size >= TOWN_MAX;
  const nextEats = townEats(site.size + 1);
  const f2 = (x: number): string => String(+x.toFixed(2));
  const next = NEXT_GIVES[site.size + 1];
  const none = (g: Good) => tr(`ei ${NONE_OF[g][0]}`, `no ${NONE_OF[g][1]}`);
  let growText: string;
  if (maxed) growText = tr('Suurin koko', 'Fully grown');
  else if (!railed) growText = tr('Ei rataa: ei kasva', 'No railway: not growing');
  else if (out.missing) growText = `${none(out.missing)}: ${tr('ei kasva', 'not growing')}`;
  else if (out.lacksPeople) growText = `${tr('ei matkustajia', 'no travellers')}: ${tr('ei kasva', 'not growing')}`;
  else if (out.runsOut) growText = tr(`Kasvaa noin ${out.months} kk:ssa, jos ${NONE_OF[out.runsOut.good][0]} riittää (varasto loppuu ${Math.floor(out.runsOut.months)} kk:ssa)`, `Grows in about ${out.months} months if the ${NONE_OF[out.runsOut.good][1]} lasts (the store runs out in ${Math.floor(out.runsOut.months)})`);
  else growText = tr(`Kasvaa noin ${out.months} kk:ssa tällä tarjonnalla`, `Grows in about ${out.months} months at this supply`);
  return (
    <>
      <div className="srow" data-sec="wants">
        <span className="sl">{tr('Varasto', 'Store')}</span>
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
              <small className={railed && site.store[g] <= 0.001 ? 'red' : ''}>
                {tr(`syö ${f2(eats)} kuormaa kuussa`, `eats ${f2(eats)} loads a month`)}
                {railed && site.store[g] <= 0.001 ? ` · ${tr('tyhjä', 'empty')}` : ''}
              </small>
            </div>
          ))}
        </div>
      </div>
      {railed && <FolkRows s={s} site={site} />}
      <div className="srow" data-sec="growth">
        <span className="sl">{tr('Kasvu', 'Growth')}</span>
        <div className="sc">
          {!maxed && (
            <div className="gline">
              <span className="bar grow">
                <i style={{ width: `${100 * site.growth}%` }} />
              </span>
              <small>{Math.round(100 * site.growth)} %</small>
            </div>
          )}
          <small className={!maxed && railed && (out.missing || out.lacksPeople) ? 'red' : ''}>{growText}</small>
          <small>
            {tr('Koko', 'Size')} {site.size}
            {!maxed && ` ${tr('→', 'to')} ${site.size + 1}: ${tr(`${HOUSES_PER_SIZE} taloa lisää${next ? ` ja ${next[0]}` : ''}, syö ${f2(nextEats)} kuormaa kuussa, varastoon mahtuu ${TOWN_STORE_CAP * (site.size + 1)}`, `${HOUSES_PER_SIZE} more houses${next ? ` and ${next[1]}` : ''}, eats ${f2(nextEats)} loads a month, the store holds ${TOWN_STORE_CAP * (site.size + 1)}`)}`}
          </small>
        </div>
      </div>
    </>
  );
}

/** the goods the crane lifts at a site: what it makes and takes among timber, boards and grain */
function craneGoods(site: Site): Good[] {
  return [...TAKES[site.kind], MAKES[site.kind]].filter((g, i, a): g is Good => !!g && CRANE_GOODS.includes(g) && a.indexOf(g) === i);
}

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
      {station && craneSite(s, station.id) && (
        <div className="srow" data-sec="crane">
          <span className="sl">{tr('Nosturi', 'Crane')}</span>
          <div className="crew-row">
            <span>
              {tr(`Nosturi: ${craneGoods(site).map((g) => tt(GOOD_NAME[g])).join(' ja ')} lastautuvat ja purkautuvat kaksi kertaa nopeammin`, `Crane: ${craneGoods(site).map((g) => tt(GOOD_NAME[g])).join(' and ')} load and unload twice as fast`)}
              {!station.crew && !station.crane && <small className="red"> · {tr('vaatii lastausväen', 'needs the loading crew')}</small>}
            </span>
            {station.crane ? (
              <b className="bought">{tr('Ostettu', 'Bought')}</b>
            ) : (
              <button className="btn act" data-act="crane" disabled={!station.crew || s.cash < CRANE_PRICE} onClick={() => buyCrane(s, station.id)}>
                <span>{tr('Osta', 'Buy')}</span>
                <small>{CRANE_PRICE}</small>
              </button>
            )}
          </div>
        </div>
      )}
      {station && (
        <div className="srow" data-sec="platforms">
          <span className="sl">{tr('Laituri', 'Platform')}</span>
          <div className="crew-row">
            <span>{station.platforms === 1 ? tr('Toinen laituri: kaksi junaa voi seistä tässä', 'Second platform: two trains can stand here') : station.platforms === 2 ? tr('Kolmas laituri: kolme junaa voi seistä tässä', 'Third platform: three trains can stand here') : tr('Kolme laituria', 'Three platforms')} ({tr('on', 'owned')} {station.platforms})</span>
            {platformPrice(s, station.id) === null ? (
              <b className="bought">{tr('Eniten', 'Most')}</b>
            ) : (
              <button className="btn act" data-act="platform" disabled={s.cash < platformPrice(s, station.id)!} onClick={() => buyPlatform(s, station.id)}>
                <span>{tr('Osta', 'Buy')}</span>
                <small>{platformPrice(s, station.id)}</small>
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
  const towns = s.sites.filter((x) => x.kind === 'town' && x.size < goal.size).sort((a, b) => Number(served(b)) - Number(served(a)) || b.size - a.size || b.growth - a.growth);
  const done = s.sites.filter((x) => x.kind === 'town' && x.size >= goal.size).length;
  const town = towns[0];
  if (!town) return '';
  const name = tt(town.name);
  // a town no train had reached, then one short of a good, then one short of travellers, then one that was only slow
  if (!served(town)) return tr(`${name} ei saanut rataa.`, `${name} never got a railway.`);
  const lacks = townLacks(s, town);
  if (lacks.length) return tr(`${name} tarvitsi ${lacks.map((g) => tr(NONE_OF[g][0], NONE_OF[g][1])).join(' ja ')}.`, `${name} needed ${lacks.map((g) => NONE_OF[g][1]).join(' and ')}.`);
  if (wantsPeople(s, town) && !visited(s, town)) return tr(`${name} tarvitsi matkustajia.`, `${name} needed travellers.`);
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
        <symbol id="g-pax" viewBox="0 0 24 24">
          <circle cx="12" cy="7" r="4.2" fill="#e8c39a" stroke="#3b2a1c" strokeWidth="1.2" />
          <path d="M7.7 6.2 Q12 1 16.3 6.2 Z" fill="#4a3624" />
          <path d="M4 22 Q4 12.2 12 12.2 Q20 12.2 20 22 Z" fill="#3f7a8a" stroke="#1d3a44" strokeWidth="1.2" />
        </symbol>
        <symbol id="g-mail" viewBox="0 0 24 24">
          <rect x="2.5" y="5.5" width="19" height="13" rx="1.5" fill="#f2ead2" stroke="#6e5a30" strokeWidth="1.2" />
          <path d="M3 6.5 L12 13.5 L21 6.5" fill="none" stroke="#6e5a30" strokeWidth="1.4" />
          <circle cx="18" cy="16" r="3.4" fill="#e8b93a" stroke="#6e5a30" strokeWidth="1" />
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
