declare const __ART_VERSION__: string | undefined
/** Cache-busting token for sprite URLs (set by vite.config.ts; falls back to the load time, e.g. under tests). */
export const ART_V: string = typeof __ART_VERSION__ !== 'undefined' ? __ART_VERSION__ : String(Date.now())
