/**
 * Two languages: Finnish and English. Content carries both as a `Text`
 * made with `L(fi, en)`; UI strings use `tr(fi, en)` in place. Place names
 * stay Finnish in both: `L(name)` with one argument.
 *
 * The current language is module state with no DOM in it, so the sim can
 * call `t()` and stay headless. `initLang()` reads the browser and runs
 * once from main.tsx.
 */
export type Lang = 'fi' | 'en';

export interface Text {
  fi: string;
  en: string;
}

export const L = (fi: string, en: string = fi): Text => ({ fi, en });

let current: Lang = 'fi';

export function lang(): Lang {
  return current;
}

export function t(x: Text): string {
  return x[current];
}

export function tr(fi: string, en: string): string {
  return current === 'en' ? en : fi;
}

/** Numbers with the thousands separator of the current language. */
export function num(n: number): string {
  return Math.round(n).toLocaleString(current === 'en' ? 'en' : 'fi');
}

const KEY = 'raide.lang';

/** ?lang= first, then the saved choice, then the browser: Finnish for anyone who reads it, English for the rest. */
export function initLang(): void {
  const ok = (x: string | null): x is Lang => x === 'fi' || x === 'en';
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    /* no storage */
  }
  const asked = new URLSearchParams(location.search).get('lang');
  const finnish = (navigator.languages ?? [navigator.language]).some((x) => /^(fi|smi|se)\b/i.test(x));
  current = ok(asked) ? asked : ok(saved) ? saved : finnish ? 'fi' : 'en';
  document.documentElement.lang = current;
}

export function setLang(l: Lang): void {
  current = l;
  document.documentElement.lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* no storage */
  }
}
