/// <reference types="vite/client" />
declare const __BUILD__: string;

interface ImportMetaEnv {
  /** The tracking pixel. Empty in a clone or fork, so the tracker stays off. */
  readonly VITE_PIXEL_URL?: string;
}
