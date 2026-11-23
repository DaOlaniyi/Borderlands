import type { Game } from '../game/Game'
import { FACTION_COLORS, SHIP_NAME, UNIT, UNIT_TYPES } from '../game/config'
import { emblemUrl } from './ui'

/**
 * What clicking a nation's tag on the map shows: its army by unit type, its ships and its towns, and a button to start the match over as that nation, from the
 * exact position it started in (the same world, the same rivals: only who you are changes).
 */
export function KingdomCard({ game, k, onClose, onPlayAs }: { game: Game; k: number; onClose: () => void; onPlayAs: (k: number) => void }) {
  const c = game.kingdomCard(k)
  if (!c) return null
  const ships = Object.entries(c.ships).filter(([, n]) => (n ?? 0) > 0)
  return (
    <div className="panel kcard" role="dialog" aria-label={`${c.name}`}>
      <div className="kcard-head">
        <img src={emblemUrl(c.emblem, c.color, 28)} alt="" />
        <div><b>{c.title} of {c.name}</b><small>{c.isPlayer ? 'You' : c.alive ? 'Rival kingdom' : 'Eliminated'}</small></div>
        <i style={{ background: FACTION_COLORS[c.color] }} />
        <button className="mini" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="kcard-army"><b>Army: {c.units}</b><span>of {c.cap} allowed</span></div>
      <ul>
        {UNIT_TYPES.map(t => <li key={t}><span>{UNIT[t].label}s</span><b>{c.army[t]}</b></li>)}
      </ul>
      <div className="kcard-row"><span>Towns</span><b>{c.towns}{c.settlements > 0 ? ` + ${c.settlements} settlement${c.settlements === 1 ? '' : 's'}` : ''}</b></div>
      <div className="kcard-row"><span>Ships</span><b>{ships.length ? ships.map(([kind, n]) => `${n} ${SHIP_NAME[kind as keyof typeof SHIP_NAME]}`).join(' · ') : 'none'}</b></div>
      {!c.isPlayer && <button className="tsbtn" onClick={() => onPlayAs(k)} title="Start this match over with the same world, but as this kingdom, from its exact starting position">Play as {c.name}</button>}
    </div>
  )
}
