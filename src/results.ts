/**
 * The best stars a player has won on each scenario, kept in the browser so the start screen can
 * show them. The game writes it when a result comes up; no storage means no stars, never an error.
 */
const key = (id: string) => `raide.stars.${id}`;

export function bestStars(id: string): number {
  try {
    return Math.max(0, Math.min(3, Number(localStorage.getItem(key(id))) || 0));
  } catch {
    return 0;
  }
}

export function saveStars(id: string, stars: number): void {
  if (stars <= bestStars(id)) return;
  try {
    localStorage.setItem(key(id), String(stars));
  } catch {
    /* no storage */
  }
}
