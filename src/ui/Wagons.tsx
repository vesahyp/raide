/**
 * The consist on the cards: a good's icon, what a wagon type carries on a line in words, the strip
 * of a train's wagons (tap one to take it off) and the row of wagon types (tap one to add it). The
 * buy card and the train card share them, so a wagon reads the same in both.
 */
import type { Good, Line, Load, SimState, WagonType } from '../game/types';
import { stopSite, wagonRoutes } from '../game/sim';
import { GOOD_NAME, WAGON_GOODS, WAGON_NAME } from '../game/content/economy';
import { tr, t as tt } from '../i18n';

export const GoodIcon = ({ good }: { good: Good }) => (
  <svg className="gi" aria-label={tt(GOOD_NAME[good])}>
    <use href={`#g-${good}`} />
  </svg>
);

/** a good in the sentence "carries timber": Finnish partitive, English lower case */
export const NONE_OF: Record<Good, [string, string]> = { timber: ['tukkeja', 'timber'], boards: ['lautoja', 'boards'], grain: ['viljaa', 'grain'], flour: ['jauhoja', 'flour'] };

export const WAGON_ORDER: WagonType[] = ['flat', 'box', 'hopper'];

/** what a wagon type carries on the line: one entry per good, with the stop it loads at and the one that takes it; empty when it is a waste */
export function carries(s: SimState, line: Line, type: WagonType): { good: Good; from: string; to: string }[] {
  return wagonRoutes(s, line, type).map((r) => ({ good: r.good, from: tt(stopSite(s, line, r.from).name), to: tt(stopSite(s, line, r.to).name) }));
}

/** "carries timber Kuusikko → Koskensaha", or "carries nothing on this line" in red */
export function CarryText({ s, line, type }: { s: SimState; line: Line; type: WagonType }) {
  const list = carries(s, line, type);
  if (!list.length) return <small className="red nothing" data-carries="nothing">{tr('ei kuljeta mitään tällä radalla', 'carries nothing on this line')}</small>;
  return (
    <small className="carry" data-carries="some">
      {list.map((c) => (
        <span key={c.good}>
          {tr('kuljettaa', 'carries')} {tr(NONE_OF[c.good][0], NONE_OF[c.good][1])} {c.from} → {c.to}
        </span>
      ))}
    </small>
  );
}

/**
 * The wagons of a consist as a strip of small wagons, front to back, each a button that takes the
 * wagon off. A wagon with nothing to carry on the line has a red edge and a mark. With `loads` each
 * wagon shows its load's icon.
 */
export function WagonStrip({ s, line, wagons, loads, onTap, label }: { s: SimState; line: Line; wagons: WagonType[]; loads?: (Load | null)[]; onTap?: (i: number) => void; label: (i: number) => string }) {
  return (
    <div className="strip" data-sec="strip">
      {wagons.map((w, i) => {
        const waste = !carries(s, line, w).length;
        return (
          <button key={i} className={`wchip${waste ? ' waste' : ''}`} data-consist={i} data-type={w} aria-label={label(i)} disabled={!onTap} onClick={() => onTap?.(i)}>
            <span className={`pic ${w}`} />
            {loads?.[i] ? <GoodIcon good={loads[i]!.good} /> : <i className="gi blank" />}
            {waste && <b className="mark">!</b>}
          </button>
        );
      })}
    </div>
  );
}

/** the three wagon types, each with the goods it can hold and what it carries on this line; a tap adds one */
export function WagonPicker({ s, line, full, onAdd, price }: { s: SimState; line: Line; full: boolean; onAdd: (w: WagonType) => void; price?: number }) {
  return (
    <div className="picker" data-sec="picker">
      {WAGON_ORDER.map((w) => (
        <button key={w} className="wagon row" data-wagon={w} data-add={w} disabled={full} onClick={() => onAdd(w)}>
          <span className={`pic ${w}`} />
          <span className="who">
            <span>{tt(WAGON_NAME[w])}</span>
            <span className="goods">
              {WAGON_GOODS[w].map((g) => (
                <GoodIcon key={g} good={g} />
              ))}
            </span>
          </span>
          <CarryText s={s} line={line} type={w} />
          {price !== undefined && <b className="num gold plus">+{price}</b>}
        </button>
      ))}
    </div>
  );
}
