/**
 * Update notice. The build writes `version.json` next to the bundle with
 * the build id (vite.config.ts); the app fetches it on load, when the tab
 * comes back to the front, and every five minutes. A different id means a
 * newer build is on the server, and the banner offers a reload. This is
 * what lets a home-screen install pick up a new version without being
 * force-closed.
 */
import { useEffect, useState } from 'react';
import { versionName } from './versionName.js';

export const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';
export const BUILD_NAME = versionName(BUILD);

let available = false;
let newerName = '';
export function newerVersionName(): string {
  return newerName;
}
const listeners = new Set<() => void>();
function notify() {
  for (const l of listeners) l();
}

async function check(): Promise<void> {
  if (available) return;
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const j = (await r.json()) as { build?: string; name?: string };
    if (j.build && j.build !== BUILD) {
      newerName = j.name ?? versionName(j.build);
      available = true;
      notify();
    }
  } catch {
    /* offline: nothing to say */
  }
}

let started = false;
function start(): void {
  if (started) return;
  started = true;
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('update') === '1') {
    available = true;
    newerName = versionName('example');
    setTimeout(notify, 0);
  }
  void check();
  setInterval(() => void check(), 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
}

export function useUpdateAvailable(): boolean {
  const [v, setV] = useState(available);
  useEffect(() => {
    start();
    const l = () => setV(true);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return v;
}

export function reloadApp(): void {
  location.reload();
}
