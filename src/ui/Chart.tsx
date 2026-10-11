/**
 * The company year by year: profit as a bar per year (gold above zero, red below) and worth as a
 * line over them, each on its own scale, labelled at the ends. A tap on a year shows its numbers.
 */
import { useState } from 'react';
import { money } from '../game/sim';
import { tr } from '../i18n';

const W = 320;
const H = 120;
const PAD = { l: 6, r: 6, t: 14, b: 18 };

export function Chart({ years }: { years: { year: number; profit: number; worth: number }[] }) {
  const [pick, setPick] = useState<number | null>(null);
  if (!years.length) return null;
  const n = years.length;
  const cw = (W - PAD.l - PAD.r) / n;
  const pMax = Math.max(1, ...years.map((y) => Math.abs(y.profit)));
  const wMax = Math.max(1, ...years.map((y) => y.worth));
  const wMin = Math.min(0, ...years.map((y) => y.worth));
  const mid = PAD.t + (H - PAD.t - PAD.b) / 2;
  const half = (H - PAD.t - PAD.b) / 2;
  const wy = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - wMin) / (wMax - wMin || 1));
  const sel = pick !== null ? years[pick] : years[n - 1];
  return (
    <div className="chart-box">
      <div className="chart-key">
        <span>
          <i className="k-bar" /> {tr('Tulos', 'Profit')} <b className={sel.profit < 0 ? 'red' : 'gold'}>{money(sel.profit)}</b>
        </span>
        <span>
          <i className="k-line" /> {tr('Arvo', 'Worth')} <b>{money(sel.worth)}</b>
        </span>
        <span className="yr">{sel.year}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={tr('Tulos ja arvo vuosittain', 'Profit and worth by year')}>
        <line x1={PAD.l} x2={W - PAD.r} y1={mid} y2={mid} stroke="rgba(239,230,207,.35)" strokeWidth={1} />
        {years.map((y, i) => {
          const h = (Math.abs(y.profit) / pMax) * half;
          const x = PAD.l + i * cw + cw * 0.18;
          return (
            <g key={y.year} onClick={() => setPick(pick === i ? null : i)} style={{ cursor: 'pointer' }}>
              <rect x={PAD.l + i * cw} y={PAD.t} width={cw} height={H - PAD.t - PAD.b} fill={pick === i ? 'rgba(255,255,255,.08)' : 'transparent'} />
              <rect x={x} y={y.profit >= 0 ? mid - h : mid} width={cw * 0.64} height={Math.max(1, h)} rx={2} fill={y.profit >= 0 ? '#d8a63a' : '#d4452f'} />
              {(i === 0 || i === n - 1 || n <= 6) && (
                <text x={PAD.l + i * cw + cw / 2} y={H - 4} textAnchor="middle" fontSize={11} fill="rgba(239,230,207,.7)">
                  {String(y.year).slice(2)}
                </text>
              )}
            </g>
          );
        })}
        <polyline
          points={years.map((y, i) => `${PAD.l + i * cw + cw / 2},${wy(y.worth)}`).join(' ')}
          fill="none"
          stroke="#efe6cf"
          strokeWidth={2.5}
          strokeLinejoin="round"
          pointerEvents="none"
        />
        {years.map((y, i) => (
          <circle key={y.year} cx={PAD.l + i * cw + cw / 2} cy={wy(y.worth)} r={pick === i || (pick === null && i === n - 1) ? 4 : 2.5} fill="#efe6cf" pointerEvents="none" />
        ))}
      </svg>
    </div>
  );
}
