/**
 * Every number the balance is made of. Starting values from docs/design.md,
 * tuned by the bot (tools/balance.ts). Money has no unit on screen.
 */
import type { Good, SiteKind, WagonType } from '../types';

/** sim seconds in a year at normal speed; the year-end card is the natural stop */
export const YEAR_SECONDS = 90;
export const MONTHS = 12;

/** what a delivery pays before demand and distance */
export const BASE_PRICE: Record<Good, number> = { timber: 8, boards: 18 };

/** demand falls towards this as a site fills with recent deliveries */
export const DEMAND_FLOOR = 0.4;
/** recent deliveries that take demand to the floor */
export const DEMAND_FILL = 10;
/** the distance factor runs from 1 at zero to DIST_BONUS at DIST_CAP cells, capped */
export const DIST_BONUS = 1.5;
export const DIST_CAP = 40;

/** what each site makes and takes */
export const MAKES: Record<SiteKind, Good | null> = { forest: 'timber', sawmill: 'boards', town: null };
export const TAKES: Record<SiteKind, Good | null> = { forest: null, sawmill: 'timber', town: 'boards' };

/** a raw site's loads per month, its cap, and the extra rate a served site reaches */
export const FOREST_RATE = 0.6;
export const FOREST_CAP = 6;
export const FOREST_START = 3;
/** a served raw site's rate climbs to this times the base, and falls back when pickups stop */
export const SERVED_RATE = 1.6;
/** months without a pickup before the rate starts to fall */
export const SERVED_MEMORY = 2;

/** the town's consumption per month and what its demand decays with */
export const TOWN_EATS = 1.5;

/** what a wagon carries */
export const WAGON_GOOD: Record<WagonType, Good> = { flat: 'timber', box: 'boards' };
export const GOOD_WAGON: Record<Good, WagonType> = { timber: 'flat', boards: 'box' };

/** the one engine of 1862: a light wood burner */
export const ENGINE = { price: 50, upkeep: 15, speed: 1.4, name: { fi: 'Pikku-Hilma', en: 'Little Hilma' } };
export const WAGON_PRICE = 10;
export const WAGONS_DEFAULT = 2;
export const WAGONS_MAX = 4;
export const TRAINS_MAX = 3;
/** seconds a train stands at a station */
export const STOP_SECONDS = 2;
/** lengths in cells, for the renderer and the station slots */
export const ENGINE_LEN = 1.1;
export const WAGON_LEN = 0.9;

/** the year-end choices, once each */
export const PERK_SPEED = 1.25;
export const PERK_FOREST = 1.5;

/** seconds the Cancel button stays under the thumb after a build */
export const UNDO_SECONDS = 1.5;

/** stars by cash at the end: the thresholds for two and three */
export const STARS = [150, 320];
