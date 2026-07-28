/// <reference types="vite/client" />

import type { SekisanApi } from '../../preload'

declare global {
  interface Window {
    sekisan: SekisanApi
  }
}

export {}
