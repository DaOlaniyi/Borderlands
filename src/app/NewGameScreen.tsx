import { useState } from 'react'
import { FACTION_COLORS, FACTION_NAMES, START } from '../game/config'
import { TOTAL_KINGDOMS } from '../game/config'
import { MENU_ORDER, PALETTE } from '../game/Palette'
import { buildingUrl, emblemUrl } from './ui'
import type { Cam } from './saves'
import { SavesDialog } from './SavesDialog'
import { fmtWhen, loadHistory, toParams, type SeedEntry } from './seedHistory'

/** playerTowns undefined = "Auto": the generator picks a balanced size. `kingdoms` undefined = derived from the seed (10–15). */
export type NewGameParams = { seed: string; color: number; kingdoms?: number; playerTowns?: number; lumber?: number; save?: { json: string; cam?: Cam } }
const LUMBER_CHOICES = [30, 100, 300, 1000, 5000]

const randomSeed = () => Math.random().toString(36).slice(2, 8).toUpperCase()

export function NewGameScreen({ onStart, onLoad, ready }: { onStart: (p: NewGameParams) => void; onLoad: (id: string) => void; ready: boolean }) {
  const [loading, setLoading] = useState(false)
  const [towns, setTowns] = useState<number | undefined>(undefined)
  const [seed, setSeed] = useState(() => randomSeed())
  const [color, setColor] = useState(0)
  const [lumber, setLumber] = useState(30)
  const [history] = useState<SeedEntry[]>(() => loadHistory())
  const rivals = TOTAL_KINGDOMS - 1
  const recommended = MENU_ORDER.filter(i => PALETTE[i].recommended), others = MENU_ORDER.filter(i => !PALETTE[i].recommended)
  const swatch = (i: number) => (
    <button key={i} className={'sw' + (i === color ? ' on' : '')} title={FACTION_NAMES[i]} aria-label={FACTION_NAMES[i]} style={{ background: FACTION_COLORS[i] }} onClick={() => setColor(i)} />
  )
  return (
    <div className="menu">
      {loading && <SavesDialog onLoad={onLoad} onClose={() => setLoading(false)} />}
      <div className="panel menu-card">
        <h1>Borderlands</h1>
        <p className="sub">Push the frontline. Cut the corridor. Hold the pocket.</p>
        <div className="row banners">
          <span className="chip"><img src={buildingUrl(color, 'House1')} alt="" /><i style={{ background: FACTION_COLORS[color] }} />{FACTION_NAMES[color]}</span>
        </div>
        <div className="row colours">
          <span className="label">Colour</span>
          <div className="swatches">
            <div className="swrow" title="The five original Tiny Swords colours — the most distinct on the map"><small>Recommended</small>{recommended.map(swatch)}</div>
            <div className="swrow"><small>More</small>{others.map(swatch)}</div>
          </div>
        </div>
        <small className="hint2">You and {rivals} rival kingdoms (20 nations in all) share an archipelago. Each kingdom also flies its own emblem{' '}<img className="emb" src={emblemUrl(3, color, 22)} alt="" /></small>
        <div className="row"><span className="label">Your towns</span>
          <div className="seg">
            <button className={towns === undefined ? 'on' : ''} title="A balanced start picked by the generator" onClick={() => setTowns(undefined)}>Auto</button>
            {Array.from({ length: START.maxPlayerTowns }, (_, i) => i + 1).map(n => <button key={n} className={n === towns ? 'on' : ''} onClick={() => setTowns(n)}>{n}</button>)}
          </div>
        </div>
        <div className="row"><span className="label">Lumber</span>
          <div className="seg">{LUMBER_CHOICES.map(n => <button key={n} className={n === lumber ? 'on' : ''} title={n === 30 ? 'The normal start' : 'Start with extra lumber (for testing buildings)'} onClick={() => setLumber(n)}>{n}</button>)}</div>
        </div>
        <small className="hint2">You can start anywhere: on a great land mass, or a lone island. Conquer it, then build boats.</small>
        <div className="row"><span className="label">Seed</span>
          <input value={seed} onChange={e => setSeed(e.target.value)} spellCheck={false} />
          <button className="mini" title="New random seed" onClick={() => setSeed(randomSeed())}>⟳</button>
        </div>
        <button className="tsbtn big" disabled={!ready} onClick={() => onStart({ seed: seed.trim() || randomSeed(), color, playerTowns: towns, lumber })}>{ready ? 'Start match' : 'Loading art…'}</button>
        <button className="mini menu-load" disabled={!ready} title="Continue a saved match" onClick={() => setLoading(true)}>Load saved game…</button>
        {history.length > 0 && (
          <div className="seedhist" aria-label="Seeds you have played">
            <small className="hint2">Seed history ({history.length}): click to load a map, or replay it right away</small>
            {history.map((h, i) => (
              <div key={h.at + i} className="hrow">
                <i style={{ background: FACTION_COLORS[h.color] }} title={FACTION_NAMES[h.color]} />
                <b>{h.seed}</b>
                <span>{fmtWhen(h.at)}</span>
                <button className="mini" title="Load this seed and its settings into the form" onClick={() => { setSeed(h.seed); setColor(h.color); setTowns(h.towns); if (h.lumber) setLumber(h.lumber) }}>Use</button>
                <button className="mini" disabled={!ready} title="Start this exact map again" onClick={() => onStart(toParams(h))}>Replay</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
