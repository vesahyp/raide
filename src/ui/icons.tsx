/**
 * The cargo icons, as SVG symbols defined once in the page (CargoIcons) and used by id from the
 * cards and the map's HTML overlay alike.
 */
import type { Cargo } from '../game/types';

/** an icon as HTML, for the map overlay */
export function cargoIcon(c: Cargo): string {
  return `<svg class="gi"><use href="#g-${c}"/></svg>`;
}

/** an icon as a React element */
export function Icon({ c, size }: { c: Cargo; size?: number }) {
  return (
    <svg className="gi" style={size ? { width: size, height: size } : undefined}>
      <use href={`#g-${c}`} />
    </svg>
  );
}

export function CargoIcons() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <symbol id="g-pax" viewBox="0 0 24 24">
          <circle cx="12" cy="6" r="3.6" fill="#f0c9a0" stroke="#4a2f24" strokeWidth="1.2" />
          <path d="M5 22 V15 Q5 10.5 12 10.5 Q19 10.5 19 15 V22 Z" fill="#3f6b4f" stroke="#1d2a20" strokeWidth="1.2" />
          <path d="M8 4 H16 L15 2.5 H9 Z" fill="#2a2420" />
        </symbol>
        <symbol id="g-mail" viewBox="0 0 24 24">
          <rect x="2.5" y="5.5" width="19" height="13" rx="1.5" fill="#f4ecd8" stroke="#6a5a3a" strokeWidth="1.2" />
          <path d="M3 6.5 L12 13 L21 6.5" fill="none" stroke="#6a5a3a" strokeWidth="1.4" />
          <circle cx="12" cy="13" r="2.2" fill="#b0392b" />
        </symbol>
        <symbol id="g-logs" viewBox="0 0 24 24">
          <rect x="2" y="6" width="18" height="5" rx="2.5" fill="#8a5a2b" />
          <circle cx="20" cy="8.5" r="2.5" fill="#d9b27a" />
          <circle cx="20" cy="8.5" r="1" fill="#8a5a2b" />
          <rect x="4" y="13" width="18" height="5" rx="2.5" fill="#9a6633" />
          <circle cx="4" cy="15.5" r="2.5" fill="#d9b27a" />
          <circle cx="4" cy="15.5" r="1" fill="#9a6633" />
        </symbol>
        <symbol id="g-lumber" viewBox="0 0 24 24">
          <rect x="2" y="5" width="20" height="4" rx="1" fill="#e8d2a0" stroke="#8a6a3a" strokeWidth="1" />
          <rect x="2" y="10" width="20" height="4" rx="1" fill="#e2c892" stroke="#8a6a3a" strokeWidth="1" />
          <rect x="2" y="15" width="20" height="4" rx="1" fill="#e8d2a0" stroke="#8a6a3a" strokeWidth="1" />
        </symbol>
        <symbol id="g-paper" viewBox="0 0 24 24">
          <ellipse cx="7" cy="12" rx="4" ry="7" fill="#f6f3ea" stroke="#7a7466" strokeWidth="1.2" />
          <ellipse cx="7" cy="12" rx="1.4" ry="2.4" fill="#c9c2b0" />
          <path d="M7 5 H19 Q22 12 19 19 H7" fill="#ece7da" stroke="#7a7466" strokeWidth="1.2" />
        </symbol>
        <symbol id="g-grain" viewBox="0 0 24 24">
          <path d="M12 22 V9" stroke="#b08a2a" strokeWidth="2" fill="none" />
          <g fill="#e9c547" stroke="#a7811f" strokeWidth="0.8">
            <ellipse cx="12" cy="5" rx="2.4" ry="3.2" />
            <ellipse cx="8.5" cy="9" rx="2.4" ry="3.2" transform="rotate(-35 8.5 9)" />
            <ellipse cx="15.5" cy="9" rx="2.4" ry="3.2" transform="rotate(35 15.5 9)" />
            <ellipse cx="8.5" cy="14" rx="2.4" ry="3.2" transform="rotate(-35 8.5 14)" />
            <ellipse cx="15.5" cy="14" rx="2.4" ry="3.2" transform="rotate(35 15.5 14)" />
          </g>
        </symbol>
        <symbol id="g-food" viewBox="0 0 24 24">
          <path d="M6 9 Q5 21 12 21 Q19 21 18 9 Z" fill="#e8dcc0" stroke="#8a8070" strokeWidth="1" />
          <path d="M7 9 L17 9 L15 5 L9 5 Z" fill="#d9ccae" stroke="#8a8070" strokeWidth="1" />
          <path d="M8 8 L16 8" stroke="#3a6fa0" strokeWidth="2" />
        </symbol>
      </defs>
    </svg>
  );
}
