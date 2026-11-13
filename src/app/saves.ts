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
}
export const AUTOSAVE_ID = 'autosave'

const DB = 'borderlands', META = 'meta', DATA = 'data'
let dbp: Promise<IDBDatabase> | null = null
const db = () => dbp ??= new Promise((res, rej) => {
  const open = indexedDB.open(DB, 1)
  open.onupgradeneeded = () => { open.result.createObjectStore(META, { keyPath: 'id' }); open.result.createObjectStore(DATA) }
  open.onsuccess = () => res(open.result)
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

export async function putSave(meta: Omit<SaveMeta, 'bytes'>, json: string): Promise<SaveMeta> {
  const bytes = await gzip(json), full: SaveMeta = { ...meta, bytes: bytes.length }
  const d = await db(), tx = d.transaction([META, DATA], 'readwrite')
  tx.objectStore(DATA).put(bytes, meta.id); tx.objectStore(META).put(full)
  await txDone(tx)
  return full
}

export async function getSave(id: string): Promise<{ meta: SaveMeta; json: string } | null> {
  const d = await db(), tx = d.transaction([META, DATA])
  const [meta, data] = await Promise.all([done(tx.objectStore(META).get(id)) as Promise<SaveMeta | undefined>, done(tx.objectStore(DATA).get(id)) as Promise<Uint8Array | undefined>])
  return meta && data ? { meta, json: await gunzip(data) } : null
}

export async function deleteSave(id: string) {
  const d = await db(), tx = d.transaction([META, DATA], 'readwrite')
  tx.objectStore(META).delete(id); tx.objectStore(DATA).delete(id)
  await txDone(tx)
}

/** Download a save as a file (so it can be kept, moved to another browser, or shared). */
export async function exportSave(id: string) {
  const s = await getSave(id)
  if (!s) throw new Error('That save no longer exists')
  const bytes = await gzip(JSON.stringify({ format: 'borderlands-save', meta: s.meta, json: s.json }))
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
  const a = document.createElement('a')
  a.href = url; a.download = `borderlands-${s.meta.params.seed}-${Math.floor(s.meta.gameTime / 60)}min.bsave`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export async function importSave(file: File): Promise<SaveMeta> {
  let parsed: { format?: string; meta?: SaveMeta; json?: string }
  try { parsed = JSON.parse(await gunzip(new Uint8Array(await file.arrayBuffer()))) } catch { throw new Error('This file is not a Borderlands save') }
  if (parsed.format !== 'borderlands-save' || !parsed.meta || typeof parsed.json !== 'string') throw new Error('This file is not a Borderlands save')
  const id = `import-${Date.now().toString(36)}`
  return putSave({ ...parsed.meta, id, auto: false, name: `${parsed.meta.name} (imported)` }, parsed.json)
}
