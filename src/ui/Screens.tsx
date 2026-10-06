import type { ScenarioDef } from '../game/types';
import { SCENARIOS } from '../game/content/scenarios';
import { tr, t, lang, setLang } from '../i18n';
import { BUILD_NAME } from '../version';
import { useState } from 'react';

export function Title({ onPlay }: { onPlay: (sc: ScenarioDef) => void }) {
  const [, bump] = useState(0);
  return (
    <div className="screen title">
      <div className="title-art" aria-hidden>
        <svg viewBox="0 0 320 120" className="title-train">
          <rect x="0" y="92" width="320" height="4" fill="#2b2620" />
          {Array.from({ length: 16 }, (_, i) => (
            <rect key={i} x={i * 20 + 4} y="88" width="6" height="12" fill="#6b4f2e" />
          ))}
          <rect x="24" y="52" width="60" height="36" rx="4" fill="#8f3b2e" />
          <rect x="96" y="52" width="60" height="36" rx="4" fill="#8f3b2e" />
          <rect x="168" y="58" width="70" height="30" rx="3" fill="#7b5a3a" />
          <rect x="174" y="48" width="58" height="8" fill="#c69a62" />
          <rect x="250" y="40" width="60" height="48" rx="6" fill="#1f1d1a" />
          <rect x="296" y="24" width="10" height="20" fill="#1f1d1a" />
          <circle cx="282" cy="56" r="6" fill="#d8a63a" />
          <circle cx="262" cy="90" r="6" fill="#444" />
          <circle cx="298" cy="90" r="6" fill="#444" />
          <circle cx="300" cy="14" r="8" fill="rgba(240,240,235,0.8)" />
          <circle cx="288" cy="4" r="6" fill="rgba(240,240,235,0.6)" />
        </svg>
      </div>
      <h1>Raide</h1>
      <p className="tagline">{tr('Vedä rata. Osta juna. Kuljeta tukit.', 'Drag track. Buy a train. Haul the timber.')}</p>
      <div className="scenarios">
        {SCENARIOS.map((sc) => (
          <button key={sc.id} className="btn primary big scenario" onClick={() => onPlay(sc)} data-track="title-play" data-scenario={sc.id}>
            <span>{t(sc.name)}</span>
            <small>{t(sc.blurb)}</small>
          </button>
        ))}
      </div>
      <button
        className="btn lang"
        onClick={() => {
          setLang(lang() === 'fi' ? 'en' : 'fi');
          bump((x) => x + 1);
        }}
      >
        {lang() === 'fi' ? 'In English' : 'Suomeksi'}
      </button>
      <div className="build">{BUILD_NAME}</div>
    </div>
  );
}
