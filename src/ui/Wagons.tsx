/**
 * A good on the cards: its icon, and its name in the sentence "carries timber".
 */
import type { Cargo } from '../game/types';
import { GOOD_NAME } from '../game/content/economy';
import { t as tt } from '../i18n';

export const GoodIcon = ({ good }: { good: Cargo }) => (
  <svg className="gi" aria-label={tt(GOOD_NAME[good])}>
    <use href={`#g-${good}`} />
  </svg>
);

/** a good in the sentence "carries timber": Finnish partitive, English lower case */
export const NONE_OF: Record<Cargo, [string, string]> = { timber: ['tukkeja', 'timber'], boards: ['lautoja', 'boards'], grain: ['viljaa', 'grain'], flour: ['jauhoja', 'flour'] };
