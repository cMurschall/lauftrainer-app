/// <reference types="vite/client" />

declare const __BUILD_TIME__: string

interface ImportMetaEnv {
  /** Public URL to germany.pmtiles on R2 (or empty for route-only maps). */
  readonly VITE_MAP_PMTILES_URL?: string
}
