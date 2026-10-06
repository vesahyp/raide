import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { initLang } from './i18n';

initLang();

// Offline play: the build writes sw.js next to the bundle with the list of
// files to keep (vite.config.ts). Production only.
if (import.meta.env.PROD && import.meta.env.BASE_URL.startsWith('/') && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
