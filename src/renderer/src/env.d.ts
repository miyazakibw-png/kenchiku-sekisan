/// <reference types="vite/client" />

import type { SekisanApi } from "../../preload";

declare global {
  /** package.json の version（ビルド時に埋め込む） */
  const __APP_VERSION__: string;
  interface Window {
    sekisan: SekisanApi;
  }
}

export {};
