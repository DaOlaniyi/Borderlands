import type { NewGameParams } from './NewGameScreen'

export type SeedEntry = { seed: string; color: number; towns?: number; lumber?: number; kingdoms?: number; at: string }
const KEY = 'bl-seed-history'
const MAX = 200

export function loadHistory(): SeedEntry[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}

/** Remember a match that was started (newest first). Starting the same seed again adds another dated entry, so every play is listed. */
export function recordSeed(p: NewGameParams) {
  const entry: SeedEntry = { seed: p.seed, color: p.color, towns: p.playerTowns, lumber: p.lumber, kingdoms: p.kingdoms, at: new Date().toISOString() }
  try { localStorage.setItem(KEY, JSON.stringify([entry, ...loadHistory()].slice(0, MAX))) } catch { /* private mode: history is simply not kept */ }
}

export const toParams = (e: SeedEntry): NewGameParams => ({ seed: e.seed, color: e.color, playerTowns: e.towns, lumber: e.lumber, kingdoms: e.kingdoms })
export const fmtWhen = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? iso : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
