/**
 * The game screen: the canvas, the loop, the HUD and the cards. The sim
 * lives in a ref and survives a turn of the phone; the HUD reads it a few
 * times a second; the cards open on the sim's events (a build, a choice of
 * routes, a year end, the result) and on taps: a line, a train, a site.
 */
import { useEffect, useRef, useState } from 'react';
import type { EngineId, Good, Line, ScenarioDef, SimState, Site, Train, WagonType, YearEndChoice } from '../game/types';
import { GOODS } from '../game/types';
import { createState, siteById, goodsOnMap } from '../game/state';
import { DT, step, buyTrain, undo, closeYearEnd, trainPrice, note, price, plan, build, addWagon, setEngine, setFullLoad, sellTrain, demand, goalProgress, lineOf } from '../game/sim';
import { ENGINES, GOOD_NAME, GROW_NEED, MAKES, MONTHS, RESALE, TAKES, WAGON_GOODS, WAGON_NAME, WAGON_PRICE, WAGONS_MAX, wagonFor } from '../game/content/economy';
import { idx, type Route } from '../game/grid';
import { Renderer2D, OPTION_COLOUR } from '../render/render2d';
import { Input } from '../input/input';
import { Bot } from '../../tools/bot';
import { tr, t as tt, num } from '../i18n';
import { play, unlock, isMuted, setMuted } from '../audio';
import { track } from '../track';

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
  const simRef = useRef<SimState | null>(null);
  if (!simRef.current) simRef.current = createState(scenario);
  const s = simRef.current;
  const [hud, setHud] = useState<Hud>(() => readHud(s));
  const [card, setCard] = useState<Card>(null);
  const [cancel, setCancel] = useState<{ x: number; y: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMutedState] = useState(isMuted());
  const [, bump] = useState(0);
  const cardRef = useRef<Card>(null);
  cardRef.current = card;
  const pausedRef = useRef(false);
  pausedRef.current = paused || (card !== null && card.kind !== 'line' && card.kind !== 'train' && card.kind !== 'site');

  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new Renderer2D(canvas, overlayRef.current!, s);
    const params = new URLSearchParams(location.search);
    const speed = Math.max(0.25, Number(params.get('speed') ?? 1));
    const bot = params.get('bot') === '1' ? Bot.for(s) : null;
    const w = window as unknown as { __sim?: SimState; __input?: Input; __renderer?: Renderer2D; __pace?: number; __plan?: (a: number, b: number) => unknown };
    w.__sim = s;
    w.__renderer = renderer;
    w.__pace = speed;
    w.__plan = (a, b) => plan(s, a, b);
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
      },
    );
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
        if (bot) bot.act(s);
        else setCard({ kind: 'yearEnd' });
      }
      for (const name of s.sounds) play(name);
      s.sounds.length = 0;
      if (!s.lastBuild) setCancel((c) => (c ? null : c));
      const c = cardRef.current;
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
          <span className="label">{goal.kind === 'deliver' ? tr('Laudat', 'Boards') : tr('Koko 3', 'Size 3')}</span>
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
          s={s}
          line={line}
          onBuy={(wagons, engine) => {
            const t = buyTrain(s, line.id, wagons, engine);
            if (t) {
              track('train', { scenario: scenario.id, wagons, engine });
              setCancel(null);
              setCard(null);
            }
          }}
          onTrain={(t) => setCard({ kind: 'train', trainId: t.id })}
          onClose={close}
        />
      )}
      {train && <TrainCard s={s} train={train} onClose={close} onSold={close} />}
      {site && <SiteCard s={s} site={site} onClose={close} />}
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
  const goalText = goal.kind === 'deliver' ? `${s.goalCount}/${goal.count}` : `${towns.filter((x) => x.size >= goal.size).length}/${towns.length}`;
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
  const sub = (r: Route) => `${(r.length * 0.2).toFixed(1)} km, ${r.worst < 1 ? tr('tasainen', 'flat') : `${tr('nousu', 'climb')} ${r.worst.toFixed(0)} %`}${r.bridge.length ? `, ${tr('silta', 'bridge')}` : ''}${r.fill.length ? `, ${tr('penger', 'embankment')}` : ''}`;
  return (
    <div className="card sheet choice-card" data-ui>
      <CardHead title={tr('Kumpaa kautta?', 'Which way?')} onClose={onClose} />
      <div className="routes">
        {[a, b].map((r, i) => (
          <button key={r.mode} className="btn route" data-route={r.mode} disabled={r.cost > s.cash} style={{ borderColor: OPTION_COLOUR[i] }} onClick={() => onPick(r)}>
            <span className="swatch" style={{ background: OPTION_COLOUR[i] }} />
            <span className="name">{name(r)}</span>
            <span className="cost num">{r.cost}</span>
            <small>{sub(r)}</small>
          </button>
        ))}
      </div>
      <p className="small">{tr('Lyhyt rata tekee enemmän matkoja vuodessa. Jyrkässä nousussa kevyt veturi ryömii.', 'A short line makes more trips a year. On a steep climb the light engine crawls.')}</p>
    </div>
  );
}

/** The line card: the line, its trains, a wagon and an engine choice and Buy. */
function LineCard({ s, line, onBuy, onTrain, onClose }: { s: SimState; line: Line; onBuy: (w: WagonType, e: EngineId) => void; onTrain: (t: Train) => void; onClose: () => void }) {
  const [siteA, siteB] = stopSites(s, line);
  // the wagons that carry what the line's ends make; every kind when neither makes anything
  const made = [MAKES[siteA.kind], MAKES[siteB.kind]].filter((g): g is Good => !!g);
  const useful = (Object.keys(WAGON_GOODS) as WagonType[]).filter((w) => made.some((g) => WAGON_GOODS[w].includes(g)));
  const kinds = useful.length ? useful : (Object.keys(WAGON_GOODS) as WagonType[]);
  const [wagons, setWagons] = useState<WagonType>(kinds[0]);
  const [engine, setEngineId] = useState<EngineId>(s.scenario.engines[0]);
  const cost = trainPrice(engine);
  const trains = s.trains.filter((t) => t.lineId === line.id);
  const full = s.trains.length >= s.scenario.trainsMax;
  const can = !full && cost <= s.cash;
  const good = made.find((g) => WAGON_GOODS[wagons].includes(g)) ?? WAGON_GOODS[wagons][0];
  const dest = TAKES[siteA.kind].includes(good) ? siteA : TAKES[siteB.kind].includes(good) ? siteB : null;
  const pays = dest ? price(s, good, dest.id, line.dist[line.dist.length - 1]) : 0;
  return (
    <div className="card sheet" data-ui>
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
                {tt(ENGINES[t.engine].name)} · {t.cargo}/{t.nWagons} {t.good ? tr(GOOD_NAME[t.good].fi, GOOD_NAME[t.good].en) : ''}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="wagons">
        {kinds.map((k) => (
          <button key={k} className={`wagon${wagons === k ? ' on' : ''}`} data-wagon={k} onClick={() => setWagons(k)}>
            <span className={`pic ${k}`} />
            <span>{tt(WAGON_NAME[k])}</span>
            <small>{WAGON_GOODS[k].filter((g) => goodsOnMap(s).includes(g)).map((g) => tt(GOOD_NAME[g])).join(', ')}</small>
          </button>
        ))}
      </div>
      {s.scenario.engines.length > 1 && (
        <div className="wagons engines">
          {s.scenario.engines.map((e) => (
            <button key={e} className={`wagon${engine === e ? ' on' : ''}`} data-engine={e} onClick={() => setEngineId(e)}>
              <span className={`pic eng${e === 'jyry' ? ' strong' : ''}`} />
              <span>
                {tt(ENGINES[e].name)} <span className="num">{ENGINES[e].price}</span>
              </span>
              <small>{tt(ENGINES[e].blurb)}</small>
            </button>
          ))}
        </div>
      )}
      <p className="small">
        {dest ? `${tr('Kuorma maksaa nyt', 'A load pays now')} ${pays} ${tr('kohteessa', 'at')} ${tt(dest.name)}.` : tr('Kumpikaan pää ei ota tämän vaunun tavaraa.', 'Neither end takes what this wagon carries.')}
        {` ${tr('Ylläpito', 'Upkeep')} ${ENGINES[engine].upkeep}/${tr('v', 'yr')}.`}
      </p>
      <button className="btn primary wide" disabled={!can} onClick={() => onBuy(wagons, engine)} data-track="card-buy-train">
        {full ? `${s.scenario.trainsMax} ${tr('junaa on täynnä', 'trains is the limit')}` : `${tr('Osta juna', 'Buy train')}  ${cost}`}
      </button>
    </div>
  );
}

/** The train card: what it is, what it carries, a wagon more, the engine swap, the full-load switch, sell. */
function TrainCard({ s, train: t, onClose, onSold }: { s: SimState; train: Train; onClose: () => void; onSold: () => void }) {
  const line = lineOf(s, t);
  const [siteA, siteB] = stopSites(s, line);
  const other = s.scenario.engines.find((e) => e !== t.engine);
  const swapCost = other ? ENGINES[other].price - Math.round(ENGINES[t.engine].price * RESALE) : 0;
  const resale = Math.round((ENGINES[t.engine].price + t.nWagons * WAGON_PRICE) * RESALE);
  return (
    <div className="card sheet" data-ui>
      <CardHead
        title={
          <>
            {tt(ENGINES[t.engine].name)} <small className="line-name">{tt(siteA.name)} ⇄ {tt(siteB.name)}</small>
          </>
        }
        onClose={onClose}
      />
      <div className="train-rows">
        <div className="train-row still">
          <span className={`pic eng${t.engine === 'jyry' ? ' strong' : ''}`} />
          {Array.from({ length: t.nWagons }, (_, i) => (
            <span key={i} className={`pic ${t.wagons}${i < t.cargo ? ' loaded' : ''}`} />
          ))}
          <span className="row-text">
            {t.cargo}/{t.nWagons} {t.good ? tt(GOOD_NAME[t.good]) : tt(WAGON_NAME[t.wagons]).toLowerCase()} · {tr('tienannut', 'earned')} {num(t.earned)}
          </span>
        </div>
      </div>
      <p className="small">{tt(ENGINES[t.engine].blurb)}. {tr('Ylläpito', 'Upkeep')} {ENGINES[t.engine].upkeep}/{tr('v', 'yr')}.</p>
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
        <button
          className="btn act danger"
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
    </div>
  );
}

/** The site card: what it has, what it wants and pays now, how far a town is from growing. */
function SiteCard({ s, site, onClose }: { s: SimState; site: Site; onClose: () => void }) {
  const makes = MAKES[site.kind];
  const takes = TAKES[site.kind].filter((g) => goodsOnMap(s).includes(g));
  const kindName: Record<string, [string, string]> = { forest: ['metsä', 'forest'], sawmill: ['saha', 'sawmill'], farm: ['maatila', 'farm'], mill: ['mylly', 'mill'], town: ['kaupunki', 'town'] };
  return (
    <div className="card sheet" data-ui>
      <CardHead
        title={
          <>
            {tt(site.name)} <small className="line-name">{tr(...kindName[site.kind])}{site.kind === 'town' ? ` ${tr('koko', 'size')} ${site.size}` : ''}</small>
          </>
        }
        onClose={onClose}
      />
      {makes && (
        <p className="small">
          {tr('Tarjolla', 'Has')}: <b>{Math.floor(site.stock)}</b> {tt(GOOD_NAME[makes])}
          {site.rate > 0 && ` · ${site.rate.toFixed(1)}/${tr('kk', 'mo')}`}
        </p>
      )}
      {takes.map((g) => (
        <div key={g} className="want">
          <span className="want-name">{tt(GOOD_NAME[g])}</span>
          <span className="bar">
            <i style={{ width: `${100 * demand(site.taken[g])}%` }} />
          </span>
          <span className="num">{price(s, g, site.id, 0)}</span>
          {site.kind === 'town' && (
            <small>
              {tr('kasvuun', 'to grow')} {site.fed[g]}/{GROW_NEED}
            </small>
          )}
        </div>
      ))}
      <p className="small">
        {site.kind === 'town'
          ? tr('Hinta laskee kun kaupunki täyttyy ja nousee kuukausien mittaan. Kaupunki kasvaa, kun se saa vuodessa tarpeeksi kumpaakin.', 'The price falls as the town fills and climbs back over the months. The town grows when a year brings enough of each good.')
          : makes
            ? tr('Vedä asemalta tänne, niin juna hakee kuorman.', 'Drag from a station here and a train picks the load up.')
            : ''}
      </p>
    </div>
  );
}

/** The year-end ledger: the numbers, the towns that grew, and the one choice. */
function YearEndCard({ s, onChoose }: { s: SimState; onChoose: (c: YearEndChoice) => void }) {
  const y = s.yearEnd!;
  const goods = GOODS.filter((g) => goodsOnMap(s).includes(g));
  const choices: { id: YearEndChoice; fi: string; en: string; sub: [string, string] }[] = [
    { id: 'wagon', fi: 'Vaunu lisää', en: 'An extra wagon', sub: ['jokaiseen junaan', 'on every train'] },
    { id: 'speed', fi: 'Nopeammat veturit', en: 'Faster engines', sub: ['neljänneksen', 'a quarter faster'] },
    { id: 'forest', fi: 'Tuottoisa maa', en: 'Richer land', sub: ['puolet enemmän tukkia ja viljaa', 'half again the timber and grain'] },
  ];
  return (
    <div className="card ledger overlay" data-ui>
      <h2>{y.year}</h2>
      <div className="ledger-body">
        <table>
          <tbody>
            {goods.map((g) => (
              <tr key={g}>
                <td>{tt(GOOD_NAME[g])}</td>
                <td className="num">{num(y.income[g])}</td>
              </tr>
            ))}
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
        <div>
          {y.grew.length > 0 && (
            <p className="grew">
              {y.grew.map((id) => `${tt(siteById(s, id).name)} ${tr('kasvoi kokoon', 'grew to size')} ${siteById(s, id).size}`).join('. ')}.
            </p>
          )}
          {choices.every((c) => s.perks.includes(c.id)) ? (
            <button className="btn choice continue" onClick={() => onChoose('wagon')} data-track="year-continue">
              <span>{tr('Jatka', 'Continue')}</span>
              <small>{tr('kaikki valinnat on otettu', 'every choice is taken')}</small>
            </button>
          ) : (
            <>
              <p className="small">{tr('Valitse yksi', 'Pick one')}</p>
              <div className="choices">
                {choices.map((c) => (
                  <button key={c.id} className="btn choice" disabled={s.perks.includes(c.id)} onClick={() => onChoose(c.id)}>
                    <span>{tr(c.fi, c.en)}</span>
                    <small>{s.perks.includes(c.id) ? tr('otettu', 'taken') : tr(c.sub[0], c.sub[1])}</small>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
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
