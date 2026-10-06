/** The clavesa tracker, when index.html loaded it. Never lets analytics break the game. */
export type Track = (event: string, data?: Record<string, string | number | boolean>) => void;
export const track: Track = (event, data) => {
  const w = window as unknown as { __clvtracker?: { track: Track } };
  try {
    w.__clvtracker?.track(event, data);
  } catch {
    /* nothing */
  }
};
