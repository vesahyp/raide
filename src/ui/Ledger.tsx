/**
 * The year-end ledger: a page of paper with two charts above the numbers. Income by good this
 * year as horizontal bars, net worth by year as one line, the towns that grew, then the table and the
 * one choice. The charts are inline SVG in a fixed box that scales with the card, so they read
 * the same in portrait and landscape; the numbers table is what scrolls when the card is short.
 * One measure in each chart, so one ink colour: the good is told by its icon and name.
 */
import { useState } from 'react';
import type { Good, SimState, YearEndChoice } from '../game/types';
import { GOODS } from '../game/types';
import { goodsOnMap, siteById } from '../game/state';
import { GOOD_NAME } from '../game/content/economy';
import { tr, t as tt, num } from '../i18n';

const BAR = '#2f4a35';
const INK = '#2a2418';
const W = 320;

interface Tip {
  x: number;
  y: number;
  text: string;
}

/** a small label with its value, kept inside the chart */
function TipBox({ tip, h }: { tip: Tip | null; h: number }) {
  if (!tip) return null;
  const w = tip.text.length * 6.4 + 12;
  const x = Math.max(2, Math.min(W - w - 2, tip.x - w / 2));
  const y = Math.max(2, Math.min(h - 20, tip.y - 24));
  return (
    <g pointerEvents="none">
      <rect x={x} y={y} width={w} height={20} rx={5} fill={INK} />
      <text x={x + w / 2} y={y + 14} textAnchor="middle" fontSize={12} fontWeight={700} fill="#f1e7cc">
        {tip.text}
      </text>
    </g>
  );
}

/** income by good this year: one bar a good from a zero baseline, the value at the bar's end */
function IncomeChart({ income, goods }: { income: Record<Good, number>; goods: Good[] }) {
  const [tip, setTip] = useState<{ good: Good; x: number; y: number } | null>(null);
  const row = 20;
  const gap = 2;
  const h = goods.length * row;
  const x0 = 76;
  const room = W - x0 - 40;
  const top = Math.max(1, ...goods.map((g) => income[g]));
  return (
    <svg className="chart income" viewBox={`0 0 ${W} ${h}`} role="img" aria-label={tr('Tulot tavaroittain tänä vuonna', 'Income by good this year')}>
      <line x1={x0} x2={x0} y1={0} y2={h} stroke={INK} strokeOpacity={0.35} strokeWidth={1} />
      {goods.map((g, i) => {
        const y = i * row;
        const w = Math.round((income[g] / top) * room);
        const r = Math.min(4, w);
        const bh = row - gap;
        return (
          <g key={g} onClick={() => setTip(tip?.good === g ? null : { good: g, x: x0 + w, y })} style={{ cursor: 'pointer' }}>
            <rect x={0} y={y} width={W} height={row} fill="transparent" />
            <svg x={0} y={y + 1} width={16} height={16} viewBox="0 0 24 24">
              <use href={`#g-${g}`} />
            </svg>
            <text x={22} y={y + 13} fontSize={12} fill={INK}>
              {tt(GOOD_NAME[g])}
            </text>
            {w > 0 && <path d={`M${x0},${y} h${w - r} a${r},${r} 0 0 1 ${r},${r} v${bh - 2 * r} a${r},${r} 0 0 1 -${r},${r} h-${w - r} z`} fill={BAR} />}
            <text x={x0 + w + 5} y={y + 13} fontSize={12} fontWeight={800} fill={INK}>
              {num(income[g])}
            </text>
          </g>
        );
      })}
      <TipBox tip={tip ? { x: tip.x, y: tip.y, text: `${tt(GOOD_NAME[tip.good])}: ${num(income[tip.good])}` } : null} h={h} />
    </svg>
  );
}

/** net worth at each year end, and what the game started with: one line, a dot for each year */
function WorthChart({ s }: { s: SimState }) {
  const [tip, setTip] = useState<number | null>(null);
  const pts = [{ label: tr('alku', 'start'), v: s.scenario.cash }, ...s.history.map((h) => ({ label: String(h.year), v: h.worth }))];
  const H = 104;
  const l = 18;
  const r = 20;
  const top = 20;
  const bottom = 20;
  const lo = Math.min(0, ...pts.map((p) => p.v));
  const hi = Math.max(1, ...pts.map((p) => p.v));
  const px = (i: number) => (pts.length === 1 ? W / 2 : l + (i / (pts.length - 1)) * (W - l - r));
  const py = (v: number) => top + ((hi - v) / (hi - lo)) * (H - top - bottom);
  const last = pts.length - 1;
  const lastX = px(last);
  return (
    <svg className="chart worth" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tr('Nettovarallisuus vuosittain', 'Net worth by year')}>
      <line x1={l - 8} x2={W - r + 8} y1={py(0)} y2={py(0)} stroke={INK} strokeOpacity={0.28} strokeWidth={1} />
      <polyline points={pts.map((p, i) => `${px(i).toFixed(1)},${py(p.v).toFixed(1)}`).join(' ')} fill="none" stroke={INK} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <g key={i} onClick={() => setTip(tip === i ? null : i)} style={{ cursor: 'pointer' }}>
          <circle cx={px(i)} cy={py(p.v)} r={14} fill="transparent" />
          <circle cx={px(i)} cy={py(p.v)} r={4} fill={INK} />
          <text x={px(i)} y={H - 5} textAnchor="middle" fontSize={10} fill={INK} fillOpacity={0.75}>
            {p.label}
          </text>
        </g>
      ))}
      <text x={lastX} y={py(pts[last].v) - 9} textAnchor={lastX > W - 40 ? 'end' : 'middle'} fontSize={12} fontWeight={800} fill={INK}>
        {num(pts[last].v)}
      </text>
      <TipBox tip={tip !== null ? { x: px(tip), y: py(pts[tip].v), text: `${pts[tip].label}: ${num(pts[tip].v)}` } : null} h={H} />
    </svg>
  );
}

function HouseIcon() {
  return (
    <svg className="house" viewBox="0 0 24 24" aria-hidden>
      <path d="M3 11 L12 3 L21 11 V21 H3 Z" fill="#b5382c" />
      <path d="M1 12 L12 2 L23 12" stroke="#4a2f24" strokeWidth="2.5" fill="none" />
    </svg>
  );
}

export function YearEndCard({ s, onChoose }: { s: SimState; onChoose: (c: YearEndChoice) => void }) {
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
        <div className="ledger-charts">
          <section>
            <h3>{tr('Tulot tavaroittain tänä vuonna', 'Income by good this year')}</h3>
            <IncomeChart income={y.income} goods={goods} />
          </section>
          <section>
            <h3>{tr('Nettovarallisuus vuosittain', 'Net worth by year')}</h3>
            <WorthChart s={s} />
          </section>
          {y.grew.length > 0 && (
            <section className="grew">
              <h3>{tr('Kasvaneet kaupungit', 'Towns that grew')}</h3>
              <p>
                {y.grew.map((id) => (
                  <span key={id} className="grown">
                    <HouseIcon />
                    {tt(siteById(s, id).name)} <b>{siteById(s, id).size}</b>
                  </span>
                ))}
              </p>
            </section>
          )}
        </div>
        <div className="ledger-nums">
          <div className="ledger-table">
            <table>
              <tbody>
                <tr>
                  <td>{tr('Ajokulut', 'Running')}</td>
                  <td className="num">-{num(y.running)}</td>
                </tr>
                <tr>
                  <td>{tr('Veturien ylläpito', 'Engine upkeep')}</td>
                  <td className="num">-{num(y.engine)}</td>
                </tr>
                <tr>
                  <td>{tr('Radan ylläpito', 'Track upkeep')}</td>
                  <td className="num">-{num(y.track)}</td>
                </tr>
                <tr>
                  <td>{tr('Korko', 'Interest')}</td>
                  <td className="num">-{num(y.interest)}</td>
                </tr>
                <tr className="total">
                  <td>{tr('Voitto', 'Profit')}</td>
                  <td className="num">{num(y.profit)}</td>
                </tr>
                <tr>
                  <td>{tr('Kassa', 'Cash')}</td>
                  <td className="num">{num(y.cash)}</td>
                </tr>
                <tr>
                  <td>{tr('Laina', 'Loan')}</td>
                  <td className="num">{num(y.loan)}</td>
                </tr>
                <tr className="total worth-row">
                  <td>{tr('Nettovarallisuus', 'Net worth')}</td>
                  <td className="num">{num(y.worth)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="ledger-pick">
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
    </div>
  );
}
