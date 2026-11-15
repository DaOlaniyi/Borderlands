import { useCallback, useEffect, useRef, useState } from 'react'
import { FACTION_COLORS } from '../game/config'
import { deleteSave, exportSave, getFilm, getReel, getRecording, importSave, listSaves, totalBytes, type SaveMeta } from './saves'
import { unpackFilm, type Film } from '../game/Film'
import { unpackReel, type Reel } from '../game/Reel'
import { parseRecording } from '../game/SaveLoad'
import type { RecData } from '../game/Recorder'
import { ReplayView } from './ReplayView'
import { fmtWhen } from './seedHistory'

const fmtClock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
const fmtSize = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`)

/**
 * Save / load list. In a match (`onSave` given) it can write a new save or overwrite one; on the main menu it only loads.
 * Saves are stored in the browser (IndexedDB) and can be exported to a file and imported back.
 */
export function SavesDialog({ onSave, onLoad, onClose, defaultName }: { onSave?: (name: string, overwriteId?: string) => Promise<void>; onLoad: (id: string) => void; onClose: () => void; defaultName?: string }) {
  const [saves, setSaves] = useState<SaveMeta[] | null>(null)
  const [name, setName] = useState(defaultName ?? '')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const [replay, setReplay] = useState<{ title: string; data: RecData; film: Film | null; reel: Reel | null; endT: number } | null>(null)
  const refresh = useCallback(() => { listSaves().then(setSaves).catch(e => { setSaves([]); setMsg({ ok: false, text: `Saves are unavailable in this browser (${e?.message ?? e})` }) }) }, [])
  useEffect(refresh, [refresh])
  const run = async (what: () => Promise<string | void>) => {
    setBusy(true); setMsg(null)
    try { const text = await what(); if (text) setMsg({ ok: true, text }) } catch (e) { setMsg({ ok: false, text: String((e as Error)?.message ?? e) }) }
    setBusy(false); refresh()
  }
  return (
    <div className="menu over savesdlg" onKeyDown={e => e.stopPropagation()}>
      <div className="panel menu-card saves-card">
        <div className="panelhead"><h2>{onSave ? 'Save / Load' : 'Load game'}</h2><button className="min" title="Close" onClick={onClose}>×</button></div>
        {onSave && (
          <div className="row saverow">
            <input value={name} placeholder="Name this save…" maxLength={40} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !busy) void run(async () => { await onSave(name.trim() || defaultName || 'Save'); return 'Game saved' }) }} />
            <button className="tsbtn small" disabled={busy} onClick={() => run(async () => { await onSave(name.trim() || defaultName || 'Save'); setName(''); return 'Game saved' })}>Save new</button>
          </div>
        )}
        <div className="savelist">
          {saves === null && <small className="hint2">Loading…</small>}
          {saves?.length === 0 && <small className="hint2">No saved games yet{onSave ? ': name one above and press Save new.' : '.'}</small>}
          {saves?.map(s => (
            <div key={s.id} className="saverec">
              <i style={{ background: FACTION_COLORS[s.params.color] }} />
              <div className="saveinfo">
                <b>{s.name}{s.auto && <em> · autosave</em>}</b>
                <small>{s.kingdomName} · {s.towns} towns · {fmtClock(s.gameTime)} played · seed {s.params.seed}</small>
                <small className="savesize" title="What this slot takes in the browser's storage (compressed)"><b>{fmtSize(s.bytes + (s.recBytes ?? 0) + (s.filmBytes ?? 0) + (s.reelBytes ?? 0))}</b> · game {fmtSize(s.bytes)} + map recording {s.recBytes ? fmtSize(s.recBytes) : 'none'} + film {s.reelBytes ? fmtSize(s.reelBytes) : 'none'} + exact re-run {s.filmBytes ? fmtSize(s.filmBytes) : 'none'}</small>
                <small>{fmtWhen(s.savedAt)}</small>
              </div>
              <div className="saveact">
                <button className="mini" disabled={busy} onClick={() => onLoad(s.id)}>Load</button>
                <button className="mini" disabled={busy || !s.recBytes} title={s.recBytes ? 'Review this game as a timeline you can scrub through' : 'This save has no recording'} onClick={() => run(async () => { const r = await getRecording(s.id); if (!r) throw new Error('No recording stored with this save'); const fb = await getFilm(s.id); const film = fb ? unpackFilm(fb) : null; const rb = await getReel(s.id); const reel = rb ? await unpackReel(rb) : null; setReplay({ title: s.name, data: parseRecording(r), film, reel, endT: film?.endT ?? s.gameTime }) })}>Replay</button>
                {onSave && !s.auto && <button className="mini" disabled={busy} title="Replace this save with the current match" onClick={() => run(async () => { await onSave(s.name, s.id); return `Overwrote “${s.name}”` })}>Overwrite</button>}
                <button className="mini" disabled={busy} title="Download this save as a file" onClick={() => run(() => exportSave(s.id))}>Export</button>
                <button className="mini brk" disabled={busy} title="Delete this save" onClick={() => { if (window.confirm(`Delete “${s.name}”?`)) void run(() => deleteSave(s.id)) }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
        <div className="row">
          <input ref={file} type="file" accept=".bsave,application/octet-stream" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void run(async () => { const m = await importSave(f); return `Imported “${m.name}”` }) }} />
          <button className="mini" disabled={busy} onClick={() => file.current?.click()}>Import from file…</button>
          <button className="mini" onClick={onClose}>Close</button>
        </div>
        {saves && saves.length > 0 && <small className="hint2">All saves together: {fmtSize(totalBytes(saves))}</small>}
        {msg && <small className={'savemsg ' + (msg.ok ? 'ok' : 'bad')}>{msg.text}</small>}
      </div>
      {replay && <ReplayView data={replay.data} film={replay.film} reel={replay.reel} filmEndT={replay.endT} title={replay.title} onClose={() => setReplay(null)} />}
    </div>
  )
}
