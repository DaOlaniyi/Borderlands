import type { SaveParams } from '../game/SaveLoad'

/**
 * Saved matches live in IndexedDB (a save is a few MB of JSON, far past localStorage's limit), gzip-compressed where the browser can.
 * A small `meta` record per save feeds the list; the bulk sits in `data`. Saves can also be exported to / imported from a file.
 */
export type Cam = { x: number; y: number; zoom: number }
export type SaveMeta = {
  id: string; name: string; savedAt: string; auto: boolean
  params: SaveParams; cam?: Cam
  gameTime: number; kingdomName: string; towns: number; kingdoms: number; bytes: number
  recBytes?: number // the map-view recording stored beside the save (0 / missing: none)
  filmBytes?: number // the re-run film (keyframes + command log) stored beside the save
  reelBytes?: number // the position-recording film stored beside the save
}
const b64 = (u: Uint8Array) => { let t = ''; for (let i = 0; i < u.length; i += 0x8000) t += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(t) }
const unb64 = (s: string) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u }
export const AUTOSAVE_ID = 'autosave'

const DB = 'borderlands', META = 'meta', DATA = 'data', REC = 'rec', FILM = 'film'
let dbp: Promise<IDBDatabase> | null = null
const db = () => dbp ??= new Promise((res, rej) => {
  const open = indexedDB.open(DB, 3)
  open.onupgradeneeded = () => { const d = open.result; if (!d.objectStoreNames.contains(META)) d.createObjectStore(META, { keyPath: 'id' }); if (!d.objectStoreNames.contains(DATA)) d.createObjectStore(DATA); if (!d.objectStoreNames.contains(REC)) d.createObjectStore(REC); if (!d.objectStoreNames.contains(FILM)) d.createObjectStore(FILM) }
  open.onsuccess = () => { const d = open.result; d.onversionchange = () => { d.close(); dbp = null }; res(d) }
  open.onblocked = () => { dbp = null; rej(new Error('another Borderlands tab or window is holding the old save database open: close the other tabs, then reload this one')) }
  open.onerror = () => { dbp = null; rej(open.error) }
})
const done = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
const txDone = (tx: IDBTransaction) => new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error) })

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream))
  return new Uint8Array(await out.arrayBuffer())
}
export const gzip = async (text: string): Promise<Uint8Array> => {
  const raw = new TextEncoder().encode(text)
  return typeof CompressionStream === 'undefined' ? raw : pipe(raw, new CompressionStream('gzip'))
}
export const gunzip = async (bytes: Uint8Array): Promise<string> => {
  const packed = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b // (gzip magic: anything else was stored plain)
  return new TextDecoder().decode(packed ? await pipe(bytes, new DecompressionStream('gzip')) : bytes)
}

export async function listSaves(): Promise<SaveMeta[]> {
  const d = await db()
  const all = await done(d.transaction(META).objectStore(META).getAll()) as SaveMeta[]
  return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

export async function putSave(meta: Omit<SaveMeta, 'bytes' | 'recBytes' | 'filmBytes' | 'reelBytes'>, json: string, recording?: string, film?: Uint8Array, reel?: Uint8Array): Promise<SaveMeta> {
  const bytes = await gzip(json), rec = recording ? await gzip(recording) : null
  const full: SaveMeta = { ...meta, bytes: bytes.length, recBytes: rec?.length ?? 0, filmBytes: film?.length ?? 0, reelBytes: reel?.length ?? 0 }
  const d = await db(), tx = d.transaction([META, DATA, REC, FILM], 'readwrite')
  tx.objectStore(DATA).put(bytes, meta.id); tx.objectStore(META).put(full)
  if (rec) tx.objectStore(REC).put(rec, meta.id); else tx.objectStore(REC).delete(meta.id)
  if (film) tx.objectStore(FILM).put(film, meta.id); else tx.objectStore(FILM).delete(meta.id)
  if (reel) tx.objectStore(FILM).put(reel, meta.id + ':reel'); else tx.objectStore(FILM).delete(meta.id + ':reel')
  await txDone(tx)
  return full
}

export async function getSave(id: string): Promise<{ meta: SaveMeta; json: string; recording?: string; film?: Uint8Array; reel?: Uint8Array } | null> {
  const d = await db(), tx = d.transaction([META, DATA, REC, FILM])
  const [meta, data, rec, film, reel] = await Promise.all([done(tx.objectStore(META).get(id)) as Promise<SaveMeta | undefined>, done(tx.objectStore(DATA).get(id)) as Promise<Uint8Array | undefined>, done(tx.objectStore(REC).get(id)) as Promise<Uint8Array | undefined>, done(tx.objectStore(FILM).get(id)) as Promise<Uint8Array | undefined>, done(tx.objectStore(FILM).get(id + ':reel')) as Promise<Uint8Array | undefined>])
  return meta && data ? { meta, json: await gunzip(data), recording: rec ? await gunzip(rec) : undefined, film, reel } : null
}

/** Just a save's recording (for the replay page: no need to read the save itself). */
export async function getRecording(id: string): Promise<string | null> {
  const d = await db(), rec = await done(d.transaction(REC).objectStore(REC).get(id)) as Uint8Array | undefined
  return rec ? gunzip(rec) : null
}

/** Just a save's literal replay (keyframes and commands), for the replay page. */
export async function getFilm(id: string): Promise<Uint8Array | null> {
  const d = await db(), f = await done(d.transaction(FILM).objectStore(FILM).get(id)) as Uint8Array | undefined
  return f ?? null
}

/** Just a save's position-recording film. */
export async function getReel(id: string): Promise<Uint8Array | null> {
  const d = await db(), f = await done(d.transaction(FILM).objectStore(FILM).get(id + ':reel')) as Uint8Array | undefined
  return f ?? null
}

export async function deleteSave(id: string) {
  const d = await db(), tx = d.transaction([META, DATA, REC, FILM], 'readwrite')
  tx.objectStore(META).delete(id); tx.objectStore(DATA).delete(id); tx.objectStore(REC).delete(id); tx.objectStore(FILM).delete(id); tx.objectStore(FILM).delete(id + ':reel')
  await txDone(tx)
}

/** Everything the browser holds for saves and recordings, in bytes (compressed sizes as stored). */
export const totalBytes = (saves: SaveMeta[]) => saves.reduce((n, s) => n + s.bytes + (s.recBytes ?? 0) + (s.filmBytes ?? 0) + (s.reelBytes ?? 0), 0)

/** Download a save as a file (so it can be kept, moved to another browser, or shared). */
export async function exportSave(id: string) {
  const s = await getSave(id)
  if (!s) throw new Error('That save no longer exists')
  const bytes = await gzip(JSON.stringify({ format: 'borderlands-save', meta: s.meta, json: s.json, recording: s.recording, film: s.film ? b64(s.film) : undefined, reel: s.reel ? b64(s.reel) : undefined }))
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
  const a = document.createElement('a')
  a.href = url; a.download = `borderlands-${s.meta.params.seed}-${Math.floor(s.meta.gameTime / 60)}min.bsave`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export async function importSave(file: File): Promise<SaveMeta> {
  let parsed: { format?: string; meta?: SaveMeta; json?: string; recording?: string; film?: string; reel?: string }
  try { parsed = JSON.parse(await gunzip(new Uint8Array(await file.arrayBuffer()))) } catch { throw new Error('This file is not a Borderlands save') }
  if (parsed.format !== 'borderlands-save' || !parsed.meta || typeof parsed.json !== 'string') throw new Error('This file is not a Borderlands save')
  const id = `import-${Date.now().toString(36)}`
  return putSave({ ...parsed.meta, id, auto: false, name: `${parsed.meta.name} (imported)` }, parsed.json, parsed.recording, parsed.film ? unb64(parsed.film) : undefined, parsed.reel ? unb64(parsed.reel) : undefined)
}
