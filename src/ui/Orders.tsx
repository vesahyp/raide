/**
 * A train's orders: the stations of its line in order as a vertical strip, a dot each like a route
 * map. A middle station is one big button that switches between "stops" (a filled dot, the name in
 * bold) and "passes through" (a hollow dot, the name struck and faint, a small arrow past it); the
 * ends say "turns here" and cannot be tapped. Under a stopping station, what this train unloads and
 * loads there.
 */
import type { Line, SimState, Train } from '../game/types';
import { setStop, skips, stopSite, stopWork } from '../game/sim';
import { tr, t as tt } from '../i18n';
import { GoodIcon } from './Wagons';

export function Orders({ s, train: t, line }: { s: SimState; train: Train; line: Line }) {
  const last = line.stops.length - 1;
  // a line of two stops has no middle station to pass: nothing to order
  if (last < 2) return null;
  return (
    <div className="orders" data-sec="orders">
      <div className="buy-label">{tr('Pysähdykset', 'Orders')}</div>
      <ol className="ord-strip">
        {line.stops.map((id, i) => {
          const end = i === 0 || i === last;
          const passes = skips(line, t.skip, i);
          const work = stopWork(s, line, t.wagons, t.skip, i);
          const state = end ? 'turns' : passes ? 'passes' : 'stops';
          const name = tt(stopSite(s, line, i).name);
          const body = (
            <>
              <span className="ord-rail" aria-hidden="true">
                <i className="ord-dot" />
              </span>
              <span className="ord-body">
                <b className="ord-name">{name}</b>
                <small className="ord-state">
                  {end ? tr('kääntyy tässä', 'turns here') : passes ? tr('ohittaa', 'passes through') : tr('pysähtyy', 'stops')}
                  {passes && <span className="ord-arrow"> ↓</span>}
                </small>
                {!passes && (
                  <small className="ord-work">
                    {work.unloads.length > 0 && (
                      <span className="ord-w" data-work="unload">
                        {tr('purkaa', 'unloads')} {work.unloads.map((g) => <GoodIcon key={g} good={g} />)}
                      </span>
                    )}
                    {work.loads.length > 0 && (
                      <span className="ord-w" data-work="load">
                        {tr('lastaa', 'loads')} {work.loads.map((g) => <GoodIcon key={g} good={g} />)}
                      </span>
                    )}
                    {work.unloads.length === 0 && work.loads.length === 0 && <span className="ord-w">{tr('ei siirrettävää', 'nothing to move')}</span>}
                  </small>
                )}
              </span>
            </>
          );
          return (
            <li key={id} className={`ord ${state}`} data-order={i} data-state={state}>
              {end ? (
                <div className="ord-row">{body}</div>
              ) : (
                <button className="ord-row ord-hit" data-order-station={id} aria-pressed={!passes} onClick={() => setStop(s, t.id, id, passes)}>
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      <p className="small ord-hint">{tr('Napauta asemaa. Muutos alkaa, kun juna seuraavan kerran lähtee.', 'Tap a station. The change applies when the train next sets out.')}</p>
    </div>
  );
}
