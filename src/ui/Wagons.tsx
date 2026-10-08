/**
 * The consist on the cards: a good's icon, what a wagon type carries on a line in words, the strip
 * of a train's wagons (tap one to take it off) and the row of wagon types (tap one to add it). The
 * buy card and the train card share them, so a wagon reads the same in both.
 */
import type { Cargo, Line, Load, SimState, WagonType } from '../game/types';
import { stopSite, wagonRoutes } from '../game/sim';
import { GOOD_NAME, WAGON_FARE, WAGON_NAME } from '../game/content/economy';
import { tr, t as tt } from '../i18n';

export const GoodIcon = ({ good }: { good: Cargo }) => (
  <svg className="gi" aria-label={tt(GOOD_NAME[good])}>
    <use href={`#g-${good}`} />
  </svg>
);

/** a good in the sentence "carries timber": Finnish partitive, English lower case */
export const NONE_OF: Record<Cargo, [string, string]> = { timber: ['tukkeja', 'timber'], boards: ['lautoja', 'boards'], grain: ['viljaa', 'grain'], flour: ['jauhoja', 'flour'], pax: ['matkustajia', 'travellers'], mail: ['postia', 'mail'] };

export const WAGON_ORDER: WagonType[] = ['flat', 'box', 'hopper', 'coach', 'mailvan'];

/** what a wagon type carries on the line: one entry per good, with the stop it loads at and the one that takes it; empty when it is a waste */
export function carries(s: SimState, line: Line, type: WagonType): { good: Cargo; from: string; to: string }[] {
  return wagonRoutes(s, line, type).map((r) => ({ good: r.good, from: tt(stopSite(s, line, r.from).name), to: tt(stopSite(s, line, r.to).name) }));
}

/** "carries timber Kuusikko → Koskensaha", "carries travellers Hämeenlinna ↔ Tampere", or "carries nothing on this line" in red */
export function CarryText({ s, line, type }: { s: SimState; line: Line; type: WagonType }) {
  const list = carries(s, line, type);
  if (!list.length) return <small className="red nothing" data-carries="nothing">{tr('ei kuljeta mitään täällä', 'carries nothing here')}</small>;
  return (
    <small className="carry" data-carries="some">
      {list.map((c) => (
        <span key={c.good}>
          {tr('kuljettaa', 'carries')} {tr(NONE_OF[c.good][0], NONE_OF[c.good][1])} {c.from} {WAGON_FARE[type] ? '↔' : '→'} {c.to}
        </span>
      ))}
    </small>
  );
}

/**
 * The train as a strip of slots of one height: the engine first, then WAGONS_MAX wagon slots, a filled
 * one a button that takes the wagon off, an empty one a dashed outline. A wagon with nothing to carry
 * on the line has a red edge and a mark. With `loads` each wagon shows its load's icon.
 */
export function WagonStrip({ s, line, wagons, loads, onTap, label, engine, max }: { s: SimState; line: Line; wagons: WagonType[]; loads?: (Load | null)[]; onTap?: (i: number) => void; label: (i: number) => string; engine?: string; max?: number }) {
  return (
    <div className="strip" data-sec="strip">
      {engine && (
        <span className="wchip engine-slot" data-slot="engine">
          <span className={`pic eng${engine === 'jyry' ? ' strong' : ''}`} />
        </span>
      )}
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
      {max !== undefined && Array.from({ length: Math.max(0, max - wagons.length) }, (_, i) => <span key={`e${i}`} className="wchip empty" data-slot="empty" />)}
    </div>
  );
}

/**
 * The wagon types as rows to add from: the picture, the name and what it carries on this line, and
 * on the right a round + with the price under it. With `strict` (the buy sheet) a type that carries
 * nothing here is dimmed, shows no price and cannot be added; the train card may still add it.
 */
export function WagonPicker({ s, line, full, onAdd, price, strict }: { s: SimState; line: Line; full: boolean; onAdd: (w: WagonType) => void; price?: number; strict?: boolean }) {
  return (
    <div className="picker" data-sec="picker">
      {WAGON_ORDER.map((w) => {
        const waste = !carries(s, line, w).length;
        const off = full || (strict && waste);
        return (
          <div key={w} className={`wagon row${strict && waste ? ' dim' : ''}`} data-wagon={w}>
            <span className={`pic ${w}`} />
            <span className="who">
              <span>{tt(WAGON_NAME[w])}</span>
              <CarryText s={s} line={line} type={w} />
            </span>
            <span className="addcol">
              <button className="plus-btn" data-add={w} disabled={off} aria-label={`${tr('Lisää', 'Add')} ${tt(WAGON_NAME[w])}`} onClick={() => onAdd(w)}>+</button>
              {price !== undefined && !(strict && waste) && <small className="num">{price}</small>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
