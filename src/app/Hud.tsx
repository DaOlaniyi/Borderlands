import { useEffect, useState } from 'react'

/** Collapsible panel state, remembered between sessions. */
function useOpen(key: string): [boolean, () => void] {
  const [open, set] = useState(() => { try { return localStorage.getItem('bl-' + key) !== '0' } catch { return true } })
  return [open, () => set(o => { const n = !o; try { localStorage.setItem('bl-' + key, n ? '1' : '0') } catch { /* private mode */ } return n })]
}
import { BARGE, BOAT, CARGO, GUNSHIP, MEAT, OUTPOST, SETTLE, YARD, TOWN_LEVEL, FACTION_COLORS, HARVEST, HARVEST_MODES, LOT, POP, TOWER, UNIT, UNIT_TYPES, ZUMWALT, ZUM_FOCUS, type BoatKind, type HarvestMode, type ZumFocus } from '../game/config'
import type { HudSnapshot } from '../game/Game'
import { ART_V } from '../game/artVersion'
import type { Relation } from '../game/types'
import { assetUrl, buildingUrl, emblemUrl, shipUrl, tintStyle, unitIcons } from './ui'

export type HudActions = {
  toggleBlock: () => void
  join: () => void
  breakSquad: () => void
  setProduce: (t: (typeof UNIT_TYPES)[number], on: boolean) => void
  placeTower: () => void
  placeLot: () => void
  placeBoat: (kind: BoatKind) => void
  placeSettlement: () => void
  placeOutpost: () => void
  placeYard: () => void
  strike: () => void
  clearStrikes: () => void
  adjustWant: (kind: 'lumber' | 'gold' | 'meat', delta: number) => void
  beginRoute: () => void
  cancelRoute: () => void
  clearRoute: () => void
  upgradeTown: (id: number) => void
  unloadCargo: (kind: 'lumber' | 'gold' | 'meat', amount: number) => void
  abandonSettlement: (id: number) => void
  unloadBoat: () => void
  setZumFocus: (f: ZumFocus) => void
  breakAlliance: (k: number) => void
  toggleBlocColor: (k: number) => void
  focusKingdom: (k: number) => void
  toggleRange: () => void
  leaveTower: () => void
  toggleTownProduce: (id: number) => void
  toggleTownRaze: (id: number) => void
  cancelBuild: (id: number) => void
  alliance: (k: number) => void
  rename: (name: string) => void
  setSpeed: (n: number) => void
  setHarvest: (m: HarvestMode) => void
  exit: () => void
  openSaves: () => void
  openRamp: () => void
  openDebug: () => void
}

const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
const house = (color: number) => buildingUrl(color, 'House1')
const icon = (n: string) => assetUrl(`UI Elements/UI Elements/Icons/${n}.png`)
const goldIcon = `${import.meta.env.BASE_URL}assets/icons/gold.png?v=${ART_V}` // tight-cropped by scripts/make-icons.py
const meatIcon = `${import.meta.env.BASE_URL}assets/icons/meat.png?v=${ART_V}`
const propUrl = (n: string) => `${import.meta.env.BASE_URL}assets/props/${n}.png?v=${ART_V}`
const BOAT_LABEL: Record<BoatKind, string> = { boat: 'Infantry boat', zumwalt: 'Zumwalt', cargo: 'Cargo boat', gunship: 'Gunship', barge: 'Barge' }
const REL_LABEL: Record<Relation, string> = { allied: 'Allied', neutral: 'Neutral', conflict: 'In Conflict', war: 'At War', total: 'Total War' }

function KingdomName({ hud, rename }: { hud: HudSnapshot; rename: (n: string) => void }) {
  const [edit, setEdit] = useState(false)
  const [text, setText] = useState(hud.kingdomName)
  useEffect(() => { if (!edit) setText(hud.kingdomName) }, [hud.kingdomName, edit])
  const commit = () => { setEdit(false); rename(text) }
  if (edit) return <input className="rename" autoFocus value={text} maxLength={24} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEdit(false) }} />
  return <b className="kname" title="Click to rename your kingdom" onClick={() => setEdit(true)}>{hud.title} of {hud.kingdomName} ✎</b>
}

type KRow = HudSnapshot['kingdoms'][number]
const sum = (g: KRow[], f: 'towns' | 'units' | 'tiles' | 'lumber' | 'power') => g.reduce((n, k) => n + k[f], 0)

function KingdomRow({ k, actions, inBloc }: { k: KRow; actions: HudActions; inBloc?: boolean }) {
  const a = k.agitation
  return (
    <div className={'k' + (k.alive ? '' : ' dead') + (inBloc ? ' inbloc' : '') + (k.focused ? ' focused' : '')}>
      <i style={{ background: FACTION_COLORS[k.color] }} />
      <img className="emb" src={emblemUrl(k.emblem, k.color, 24)} alt="" />
      <div className="kn" title="Click to show this nation's wars (red), conflicts (yellow) and alliances (green) on the map" onClick={() => actions.focusKingdom(k.id)}>
        <b>{k.isPlayer ? `${k.name} (you)` : k.name}{k.ready && <img className="alert" src={icon('Icon_05')} title="On alert: massing troops and building towers" alt="alert" />}</b>
        <small>{k.temperament && <em className={'temper ' + k.temperament} title="Temperament: how readily this nation starts wars">{k.temperament} · </em>}{k.title} · Lv {k.level} · {k.towns} towns · {k.units} units</small>
        <small className="tiles">{k.tiles.toLocaleString()} tiles</small>
        {a !== null && <div className="agit" title={`Agitation ${a}%`}><u className={a >= 40 ? 'hot' : a >= 35 ? 'warm' : ''} style={{ width: `${Math.min(100, a)}%` }} /></div>}
      </div>
      {!k.isPlayer && <span className={'rel ' + k.relation}>{REL_LABEL[k.relation]}</span>}
      {!k.isPlayer && k.relation === 'neutral' && k.alive && <button className="mini" disabled={!!k.allyBlocked} title={k.allyBlocked ?? 'Propose an alliance (unlikely early on)'} onClick={() => actions.alliance(k.id)}>Ally</button>}
      {!k.isPlayer && k.relation === 'allied' && <button className="mini brk" title="Break the alliance" onClick={() => actions.breakAlliance(k.id)}>Break</button>}
    </div>
  )
}

export function Hud({ hud, perf, actions, brush }: { hud: HudSnapshot; perf: string | null; actions: HudActions; brush: boolean }) {
  const [kingdomsOpen, toggleKingdoms] = useOpen('kingdoms'), [tabsOpen, toggleTabs] = useOpen('tabs'), [shopOpen, toggleShop] = useOpen('shop')
  const me = hud.kingdoms[0]
  const groups = (() => {
    const seen = new Set<number>(), out: KRow[][] = []
    for (const k of hud.kingdoms) {
      if (seen.has(k.id)) continue
      const members = [k]; seen.add(k.id)
      for (let i = 0; i < members.length; i++) for (const al of members[i].allies) if (!seen.has(al) && hud.kingdoms[al]) { seen.add(al); members.push(hud.kingdoms[al]) }
      out.push(members)
    }
    return out
  })()
  const sel = hud.units
  const lead = sel[0]
  return (
    <div className="hud">
      <div className="topleft">
        <div className="panel hud-top">
          <img className="crest" src={house(me.color)} style={tintStyle(me.color)} alt="" />
          <div><KingdomName hud={hud} rename={actions.rename} /><small>Level {hud.level} · {fmtTime(hud.time)} · seed {hud.seed}</small></div>
          <span className="stat" title="Towns"><img src={house(me.color)} style={tintStyle(me.color)} alt="" />{hud.towns}</span>
          <span className="stat" title={`Lumber (${hud.region === 'Home' ? 'home region' : 'this settlement'}: click a settlement or your home land to switch)`}><img src={icon('Icon_02')} alt="" />{hud.lumber}</span>
          <span className="stat goldstat" title="Gold (this region)"><img src={goldIcon} alt="" />{hud.gold}</span>
          <span className="stat" title={`Meat (this region). A settlement eats ${MEAT.eat} per ${MEAT.eatPeriod / 60} min and holds ${MEAT.store}.`}><img src={meatIcon} alt="" />{hud.meat}</span>
          <span className="stat regiontag" title="Stockpile region shown">{hud.region}</span>
          <button className={'harvest ' + hud.harvest} title={`Pawn tree extraction: ${HARVEST[hud.harvest].label}${isFinite(HARVEST[hud.harvest].cap) ? ` (stops above ${HARVEST[hud.harvest].cap} lumber)` : ' (until no trees remain)'} — click to cycle`} onClick={() => actions.setHarvest(HARVEST_MODES[(HARVEST_MODES.indexOf(hud.harvest) + 1) % HARVEST_MODES.length])}>{HARVEST[hud.harvest].label}</button>
          <span className="stat" title="Power (1 per town per second)"><img src={icon('Icon_08')} alt="" />{hud.power}</span>
          <span className={'stat' + (hud.pop > hud.cap ? ' bad' : '')} title="Units / capacity (3 per town, 5 per barracks; archers in towers do not count)"><img src={icon('Icon_05')} alt="" />{hud.pop}/{hud.cap}</span>
        </div>
        <div className="produce">
          {UNIT_TYPES.map(t => (
            <button key={t} className={'prod' + (hud.produce[t] ? ' on' : '')} title={`${UNIT[t].label}: ${hud.produce[t] ? 'producing' : 'off'} — ${UNIT[t].cost} power, one every ${POP.spawnInterval}s`} onClick={() => actions.setProduce(t, !hud.produce[t])}>
              {unitIcons[t] ? <img src={unitIcons[t]} alt={UNIT[t].label} /> : <b className="fallback">{UNIT[t].label[0]}</b>}
              <strong>{UNIT[t].label}</strong><span>{UNIT[t].cost}</span>
            </button>
          ))}
        </div>
      </div>

      {hud.warnings.length > 0 && (
        <div className="warnings">
          {hud.warnings.map(w => (
            <div key={w.name} className={'warning' + (w.immediate ? ' now' : '')}>
              <b>⚠ Your troops are violating {w.name}'s border</b>
              <span>{w.immediate ? 'Too close to a town — a conflict is starting now! Pull back.' : `A conflict will begin in ${w.secs}s unless they withdraw.`}</span>
            </div>
          ))}
        </div>
      )}
      {hud.spills.length > 0 && <div className="spills">{hud.spills.slice(-3).map((t, i) => <div key={i} className="spill">{t}</div>)}</div>}
      {brush && <div className="brushnote">Brush: paint over units to select them · press C again to finish, then draw their route</div>}
      <div className="events">{hud.events.map((e, i) => <div key={i} className="toast">{e}</div>)}</div>

      <div className="rightcol">
      <div className="panel hud-right">
        <div className="panelhead"><b>Kingdoms</b><button className="min" title={kingdomsOpen ? 'Minimise' : 'Expand'} onClick={toggleKingdoms}>{kingdomsOpen ? '–' : '+'}</button></div>
        {kingdomsOpen && <div className="klist">{groups.map(g => g.length === 1 ? <KingdomRow key={g[0].id} k={g[0]} actions={actions} /> : (
          <div key={g.map(m => m.id).join('-')} className="bloc">
            <div className="blochead">
              <button className={'eye' + (g.every(m => m.merged) ? ' on' : '')} title="Show the whole alliance's territory in the colour of its strongest nation" onClick={() => actions.toggleBlocColor(g[0].id)}><svg viewBox="0 0 24 24" width="18" height="18"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg></button>
              <b>{g.map(m => m.name.toUpperCase()).join(' and ')}</b>
              <small>Allied bloc · {sum(g, 'towns')} towns · {sum(g, 'units')} units · {sum(g, 'tiles').toLocaleString()} tiles</small>
              <small className="pool"><img src={icon('Icon_02')} alt="" />{sum(g, 'lumber')} <img src={icon('Icon_08')} alt="" />{sum(g, 'power')} <i>pooled</i></small>
            </div>
            {g.map(m => <KingdomRow key={m.id} k={m} actions={actions} inBloc />)}
          </div>
        ))}</div>}
        <div className="speed">{[1, 2, 4].map(n => <button key={n} className={hud.speed === n ? 'on' : ''} onClick={() => actions.setSpeed(n)}>{n}×</button>)}<button title="Save the match, or load another (autosaves every 4 minutes)" onClick={actions.openSaves}>Save / Load</button><button title="Live analytics for every nation (Tab)" onClick={actions.openDebug}>War Room</button><button onClick={actions.exit}>Menu</button></div>
      </div>
      <div className="wars">
        {hud.conflicts.length > 0 && <div className="warshead"><b>Conflicts &amp; wars ({hud.conflicts.length})</b><button className="min" title={tabsOpen ? 'Minimise' : 'Expand'} onClick={toggleTabs}>{tabsOpen ? '–' : '+'}</button></div>}
        {tabsOpen && hud.conflicts.map(c => c.kind === 'player' ? (
          <div key={'p' + c.id} className={'war ' + c.relation}>
            <b>{c.name} {c.relation === 'total' ? 'Total War' : c.relation === 'war' ? 'War' : 'Conflict'}</b>
            <span><em>LOSSES</em> {c.losses}</span><span><em>KILLS</em> {c.kills}</span>
          </div>
        ) : (
          <div key={`a${c.a}-${c.b}`} className={'war ai ' + c.relation}>
            <b>{c.aName} vs {c.bName}</b>
            <span><em>{c.aName}</em> lost {c.aLost}</span><span><em>{c.bName}</em> lost {c.bLost}</span>
          </div>
        ))}
      </div>

      </div>

      <div className="panel shop">
        <div className="panelhead"><b>Shop</b><button className="min" title={shopOpen ? 'Minimise' : 'Expand'} onClick={toggleShop}>{shopOpen ? '–' : '+'}</button></div>
        {shopOpen && <>
        <button className={'shopitem' + (hud.placing === 'tower' ? ' on' : '')} disabled={hud.lumber < TOWER.cost && hud.placing !== 'tower'} onClick={actions.placeTower} title={`Tower: ${TOWER.cost} lumber, built by a pawn in ${TOWER.buildTime}s, belongs to the nearest town. An archer inside shoots twice as far and up to 2× as hard.`}>
          <img src={buildingUrl(me.color, 'Tower')} style={tintStyle(me.color)} alt="" /><span>{hud.placing === 'tower' ? 'Click land…' : 'Tower'}</span><em><img src={icon('Icon_02')} alt="" />{TOWER.cost}</em>
        </button>
        <button className={'shopitem' + (hud.placing === 'lot' ? ' on' : '')} disabled={hud.lumber < LOT.cost && hud.placing !== 'lot'} onClick={actions.placeLot} title={`Lot: ${LOT.cost} lumber, a mini town (+1 troop capacity) tied to the nearest town. One per town.`}>
          <img src={buildingUrl(me.color, 'House3')} style={tintStyle(me.color)} alt="" /><span>{hud.placing === 'lot' ? 'Click land…' : 'Lot (+1 unit)'}</span><em><img src={icon('Icon_02')} alt="" />{LOT.cost}</em>
        </button>
        <button className={'shopitem' + (hud.placing === 'yard' ? ' on' : '')} onClick={actions.placeYard} title={`Shipyard: free, one per landmass you hold a town on, plus one more for every four towns there. Build it on your coast beside a town; the white line along the shore (about 10 tiles) is where ships may be laid down. Each town (house) expands its capacity: one gunboat per town, two more or one Zumwalt per level 2 town (the yard hosts at most ${YARD.zumwaltsPerYard} Zumwalts). Infantry and cargo boats are not limited. Now: ${hud.navy.used}/${hud.navy.points} naval points, ${hud.navy.zum}/${hud.navy.zumCap} Zumwalts.`}>
          <img src={propUrl('yard')} style={{ imageRendering: 'pixelated' }} alt="" /><span>{hud.placing === 'yard' ? 'Click coast…' : hud.navy.yards ? `Shipyard ✓ (${hud.navy.yards})` : 'Shipyard'}</span>
        </button>
        <button className={'shopitem' + (hud.placing === 'boat' ? ' on' : '')} disabled={hud.lumber < BOAT.cost && hud.placing !== 'boat'} onClick={() => actions.placeBoat('boat')} title={`Infantry boat: ${BOAT.cost} lumber, built by a pawn in the water beside your coast. Carries ${BOAT.cap} units (they leave your troop count while aboard). Half a warrior's HP, no weapons.`}>
          <img className="shipicon" src={shipUrl('boat', me.color, 'right')} alt="" /><span>{hud.placing === 'boat' ? 'Click water…' : 'Boat'}</span><em><img src={icon('Icon_02')} alt="" />{BOAT.cost}</em>
        </button>
        <button className={'shopitem' + (hud.placing === 'barge' ? ' on' : '')} disabled={hud.lumber < BARGE.cost && hud.placing !== 'barge'} onClick={() => actions.placeBoat('barge')} title={`Barge: ${BARGE.cost} lumber, the landing craft. Carries ${BARGE.cap} units. It moors in ${BARGE.dockTime} s and nothing stops it: fire does not interrupt the mooring and enemy troops on the beach cannot keep it off; on touching down it throws every enemy within ${BARGE.shoveTiles} tiles back. Land units do only ${Math.round(BARGE.landDamage * 100)}% damage to it, ships full damage. Press F when docked to lower the ramp (units walk off, and can board).`}>
          <img className="shipicon" src={shipUrl('barge', me.color, 'right')} alt="" /><span>{hud.placing === 'barge' ? 'Click water…' : 'Barge'}</span><em><img src={icon('Icon_02')} alt="" />{BARGE.cost}</em>
        </button>
        <button className={'shopitem' + (hud.placing === 'zumwalt' ? ' on' : '')} disabled={hud.lumber < ZUMWALT.cost && hud.placing !== 'zumwalt'} onClick={() => actions.placeBoat('zumwalt')} title={`Zumwalt: ${ZUMWALT.cost} lumber. Cannons reach ${ZUMWALT.rangeTiles} tiles (bursts of two, 2.5× a warrior's damage up close, 10% at maximum range). Carries ${ZUMWALT.cap}. Fragile: an archer's HP.`}>
          <img className="shipicon" src={shipUrl('zumwalt', me.color, 'right')} alt="" /><span>{hud.placing === 'zumwalt' ? 'Click water…' : 'Zumwalt'}</span><em><img src={icon('Icon_02')} alt="" />{ZUMWALT.cost}</em>
        </button>
        <button className={'shopitem' + (hud.placing === 'cargo' ? ' on' : '')} disabled={hud.lumber < CARGO.cost && hud.placing !== 'cargo'} onClick={() => actions.placeBoat('cargo')} title={`Cargo boat: ${CARGO.cost} lumber. Carries up to ${CARGO.cap.lumber} lumber, ${CARGO.cap.gold} gold and ${CARGO.cap.meat} meat between regions. Sunk by two Zumwalt volleys; its cargo floats until someone scoops it up.`}>
          <img className="shipicon" src={shipUrl('cargo', me.color, 'right')} alt="" /><span>{hud.placing === 'cargo' ? 'Click water…' : 'Cargo boat'}</span><em><img src={icon('Icon_02')} alt="" />{CARGO.cost}</em>
        </button>
        <button className={'shopitem' + (hud.placing === 'gunship' ? ' on' : '')} disabled={hud.lumber < GUNSHIP.cost && hud.placing !== 'gunship'} onClick={() => actions.placeBoat('gunship')} title={`Gunship: ${GUNSHIP.cost} lumber. A pirate vessel: ${GUNSHIP.rangeTiles}-tile guns against ships only, 10% slower than a cargo boat. Scoops floating cargo but cannot load at ports.`}>
          <img className="shipicon" src={shipUrl('gunship', me.color, 'right')} alt="" /><span>{hud.placing === 'gunship' ? 'Click water…' : 'Gunship'}</span><em><img src={icon('Icon_02')} alt="" />{GUNSHIP.cost}</em>
        </button>
        <button className={'shopitem' + (hud.placing === 'outpost' ? ' on' : '')} disabled={hud.power < OUTPOST.cost && hud.placing !== 'outpost'} onClick={actions.placeOutpost} title={`Outpost: ${OUTPOST.cost} power, instant, 1 hp. A stake that gives your troops a supplied buffer around it (half-strength territory, combat only: pawns cannot use it) so an army can follow a trail into new land without being cut off. Any enemy land unit destroys it with one strike; archer towers cannot shoot it. Plant it within a few tiles of your own ground.`}>
          <svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true"><rect x="12" y="2" width="3" height="36" fill="#6b4a2b" /><path d="M15 3 L28 9 L15 15 Z" fill={FACTION_COLORS[me.color]} stroke="#1a1f26" strokeWidth="1.5" /></svg><span>{hud.placing === 'outpost' ? 'Click land…' : 'Outpost'}</span><em><img src={icon('Icon_08')} alt="" />{OUTPOST.cost}</em>
        </button>
        <button className={'shopitem' + (hud.placing === 'settlement' ? ' on' : '')} onClick={actions.placeSettlement} title={`Settlement: ${SETTLE.cost} lumber from your home stock. Plant it on or beside your territory on a landmass you do not hold yet: land troops from an infantry boat and moor a cargo boat there first. It needs a troop beside it and ${MEAT.eat} meat per ${MEAT.eatPeriod / 60} minutes, or it collapses in ${SETTLE.decaySeconds / 60} minutes. It can never be captured, only destroyed.`}>
          <img src={propUrl('pillar')} style={{ imageRendering: 'pixelated' }} alt="" /><span>{hud.placing === 'settlement' ? 'Click land…' : 'Settlement'}</span><em><img src={icon('Icon_02')} alt="" />{SETTLE.cost}</em>
        </button>
        </>}
      </div>

      {hud.boat && (
        <div className="panel hud-sel">
          <div className="selinfo">
            <b>{hud.boat.mine ? '' : `${hud.boat.owner}'s `}{BOAT_LABEL[hud.boat.kind]}{hud.boat.count > 1 ? ` ×${hud.boat.count}` : ''}</b>
            <span>{hud.boat.docked ? 'Docked — friendly territory around it' : hud.boat.blocked ? 'Landing blocked — enemy troops hold the beach' : hud.boat.docking >= 0 ? (hud.boat.kind === 'barge' ? `Docking… ${Math.ceil((1 - hud.boat.docking) * BARGE.dockTime)} s (nothing stops it)` : `Docking… ${Math.ceil((1 - hud.boat.docking) * 5)} s (fire interrupts it)`) : 'At sea'}{hud.boat.kind === 'barge' && hud.boat.docked ? (hud.boat.open ? ' · ramp DOWN' : ' · ramp up') : ''}{hud.boat.kind === 'zumwalt' && hud.boat.docked ? ' · cannons offline' : ''}</span>
            <div className="hpbar"><i style={{ width: `${Math.max(0, (hud.boat.hp / hud.boat.maxHp) * 100)}%` }} /></div>
            <span>HP {hud.boat.hp} / {hud.boat.maxHp}{hud.boat.cap > 0 ? ` · Aboard ${hud.boat.cargo}/${hud.boat.cap}${hud.boat.cargo >= hud.boat.cap ? ' (FULL)' : ''}` : ''}</span>
            {!hud.boat.mine && hud.boat.kind === 'cargo' && <span>Hold: {Math.round(hud.boat.load.lumber)} lumber · {Math.round(hud.boat.load.gold)} gold · {Math.round(hud.boat.load.meat)} meat</span>}
            {hud.boat.names.length > 0 && <small>{hud.boat.names.slice(0, 6).join(', ')}{hud.boat.names.length > 6 ? '…' : ''}</small>}
            {hud.boat.mine && <small>Drag from the ship to sail it · end the route beside land to dock · {hud.boat.kind === 'barge' ? 'press F to lower the ramp, then drag troops aboard' : 'drag troops onto a docked ship to board'}</small>}
          </div>
          {hud.boat.mine && <div className="selbtns">
            {hud.boat.kind === 'barge'
              ? <button className={'tsbtn small' + (hud.boat.open ? ' on' : '')} disabled={!hud.boat.docked} title={hud.boat.docked ? 'Lower the ramp: everyone aboard walks off (and troops can board). Press again to raise it. Hotkey F' : 'The barge must be docked at a shore'} onClick={actions.openRamp}>{hud.boat.open ? 'Raise ramp (F)' : 'Open ramp (F)'}</button>
              : <button className="tsbtn small" disabled={!hud.boat.docked || hud.boat.cargo === 0} title={hud.boat.docked ? 'Land every unit aboard' : 'The ship must be docked at a coast'} onClick={actions.unloadBoat}>Unload</button>}
          </div>}
        </div>
      )}
      {hud.boat && hud.boat.mine && hud.boat.kind === 'cargo' && (
        <div className="panel hud-sel cargomenu">
          <div className="selinfo">
            <b>Cargo hold{hud.boat.pct >= 0 ? ` · ${hud.boat.pct}% loaded` : ''}</b>
            {(['lumber', 'gold', 'meat'] as const).map(k => (
              <div key={k} className="cargorow">
                <img src={k === 'lumber' ? icon('Icon_02') : k === 'gold' ? goldIcon : meatIcon} alt="" /><span>{k}</span>
                <button className="tsbtn small" onClick={() => actions.adjustWant(k, -(k === 'lumber' ? 20 : k === 'gold' ? 2 : 5))}>−</button>
                <em>{Math.round(hud.boat!.load[k])} / {Math.round(hud.boat!.want[k])}</em>
                <button className="tsbtn small" onClick={() => actions.adjustWant(k, k === 'lumber' ? 20 : k === 'gold' ? 2 : 5)}>+</button>
                <button className="tsbtn small" disabled={!hud.boat!.docked || hud.boat!.load[k] - hud.boat!.unload[k] < 0.5} title={`Pawns put ${k === 'lumber' ? 20 : k === 'gold' ? 2 : 5} ${k} ashore (only that much)`} onClick={() => actions.unloadCargo(k, k === 'lumber' ? 20 : k === 'gold' ? 2 : 5)}>Unload{hud.boat!.unload[k] > 0 ? ` (${Math.round(hud.boat!.unload[k])})` : ''}</button>
              </div>
            ))}
            <small>Moor beside a town or settlement: its pawns load up to the first number and unload down to it. Load / want shown per resource.</small>
            {hud.boat.trade && <small>Trade route: {hud.boat.trade.a} → {hud.boat.trade.b} ({hud.boat.trade.leg}); repeats until cleared.</small>}
            {hud.boat.picking && <small><b>Pick the {hud.boat.picking === 'a' ? 'loading' : 'unloading'} town or settlement on the map…</b></small>}
          </div>
          <div className="selbtns">
            <button className={'tsbtn small' + (hud.boat.picking ? ' on' : '')} title="Set a standing route: load the amounts above at one port, deliver them to the other, repeat" onClick={hud.boat.picking ? actions.cancelRoute : actions.beginRoute}>{hud.boat.picking ? 'Cancel' : 'Set route'}</button>
            {hud.boat.trade && <button className="tsbtn small red" onClick={actions.clearRoute}>Clear route</button>}
          </div>
        </div>
      )}
      {hud.boat && hud.boat.mine && hud.boat.armed && (
        <div className="zumfocus" title="Place a target X: red when in range, grey when out of range. A new target takes 4 s to lock on (Zumwalts).">
          <button className={'tsbtn small' + (hud.boat.striking ? ' on' : '')} onClick={actions.strike}>{hud.boat.striking ? 'Click a target…' : 'Strike'}</button>
          {hud.boat.hasStrike && <button className="tsbtn small red" onClick={actions.clearStrikes}>Clear target</button>}
        </div>
      )}
      {hud.boat && hud.boat.mine && hud.boat.zumwalts > 0 && (
        <div className="zumfocus" title="What the selected Zumwalt(s) shoot at first">
          <span>Target</span>
          {ZUM_FOCUS.map(f => <button key={f} className={'tsbtn small' + (hud.boat!.focus === f ? ' on' : '')} onClick={() => actions.setZumFocus(f)}>{f === 'ships' ? 'Ships' : f === 'buildings' ? 'Buildings' : 'Troops'}</button>)}
        </div>
      )}

      {lead && (
        <div className="panel hud-sel">
          {sel.length === 1 ? (
            <div className="selinfo">
              <b>{lead.name}{lead.count > 1 ? ` · Squad ×${lead.count}` : ''}</b>
              <span>{UNIT[lead.type].label}{lead.inTower ? ' · in tower' : ''} · {lead.mode === 'block' ? 'Blocking' : lead.state}</span>
              <div className="hpbar"><i style={{ width: `${Math.max(0, (lead.hp / lead.maxHp) * 100)}%` }} /></div>
              <span>HP {lead.hp} / {lead.maxHp}{lead.healing && <b className="plus" title="Near a town: healing 2.5× faster"> ✚</b>}</span>
              {lead.count > 1 && <small>{lead.members.join(', ')}</small>}
              {lead.cutOff && <span className="warn">Cut off — taking attrition</span>}
              {lead.overcap && <span className="warn">Over population cap — taking damage</span>}
            </div>
          ) : (
            <div className="selinfo"><b>{sel.length} groups selected</b><small>{sel.map(u => u.name).slice(0, 5).join(', ')}{sel.length > 5 ? '…' : ''}</small></div>
          )}
          <div className="selbtns">
            {hud.canRange && <button className={'tsbtn small ring' + (hud.showRange ? ' on' : '')} title="Show strike range" onClick={actions.toggleRange}><span className="ringicon" /></button>}
            {lead.inTower && <button className="tsbtn small" onClick={actions.leaveTower}>Leave tower</button>}
            {hud.canBlock && <button className={'tsbtn small' + (hud.allBlocking ? ' on' : '')} onClick={actions.toggleBlock}>{hud.allBlocking ? 'Stop blocking' : 'Block'}</button>}
            {hud.join && <button className="tsbtn small" disabled={!hud.join.enabled} title={hud.join.reason ?? ''} onClick={actions.join}>{hud.join.label}</button>}
            {hud.hasSquad && <button className="tsbtn small red" onClick={actions.breakSquad}>Break</button>}
          </div>
        </div>
      )}
      {hud.town && (
        <div className="panel hud-sel">
          <div className="selinfo">
            <b>{hud.town.mine ? 'Your' : `${hud.town.owner}'s`} {hud.town.kind === 'barracks' ? 'barracks' : hud.town.kind === 'settlement' ? 'settlement' : 'town'} · level {hud.town.level}</b>
            <div className="hpbar"><i style={{ width: `${Math.max(0, (hud.town.hp / hud.town.maxHp) * 100)}%` }} /></div>
            <span>HP {hud.town.hp} / {hud.town.maxHp}</span>
            {hud.town.store && <span title={hud.town.shared ? 'Towns on one island share a stockpile' : "This settlement's own stockpile"}>{hud.town.shared ? 'Island stockpile' : 'Stock'}: {Math.floor(hud.town.store.lumber)} lumber · {Math.floor(hud.town.store.gold)} gold · {hud.town.store.meat.toFixed(1)}/{hud.town.meatCap} meat</span>}
            {hud.town.kind === 'settlement' && hud.town.store && <>
              <span>Troops here {hud.town.troops} (needs 1) · holds {hud.town.cap} units</span>
              {hud.town.decay > 0 && hud.town.decay < SETTLE.decaySeconds && <span className="warn">Collapsing in {hud.town.decay}s — bring meat (cargo boat) and keep a troop beside it</span>}
              {hud.town.level < 2 && <small>Level 1: a small territory, no archer towers, no harvesting. Level 2: crates, towers, 3 pawns. Level 3: 5 pawns, 10 units and ships can be built beside it.</small>}
              {hud.town.mine && <button className="tsbtn small red" title="Give the settlement up: the first unit of any kingdom to reach it claims it" onClick={() => actions.abandonSettlement(hud.town!.id)}>Abandon</button>}
            </>}
            {!hud.town.mine && hud.town.kind !== 'settlement' && <small>CAPTURE: take it intact when it is undefended · RAZE: destroy it to deny the enemy. Click the town again to switch.</small>}
            {!hud.town.mine && hud.town.kind === 'settlement' && <small>Troops standing on an undefended settlement take it over, stores and all. A Zumwalt can destroy it (it resists ship fire by half).</small>}
            {hud.town.mine && <small>Turn production off to stop new troops spawning here.</small>}
          </div>
          <div className="selbtns">
            {hud.town.mine && hud.town.upgrade && <button className="tsbtn small" disabled={!!hud.town.upgrade.error} title={hud.town.upgrade.error ?? hud.town.upgrade.label} onClick={() => actions.upgradeTown(hud.town!.id)}>{hud.town.upgrade.label}</button>}
            {hud.town.mine
              ? <button className={'tsbtn small' + (hud.town.produce ? ' on' : '')} onClick={() => actions.toggleTownProduce(hud.town!.id)}>{hud.town.produce ? 'Producing troops' : 'Production off'}</button>
              : hud.town.kind === 'settlement' ? null : <button className={'tsbtn small' + (hud.town.raze ? ' red' : ' on')} onClick={() => actions.toggleTownRaze(hud.town!.id)}>{hud.town.raze ? 'Objective: RAZE' : 'Objective: CAPTURE'}</button>}
          </div>
        </div>
      )}
      {hud.structure && (
        <div className="panel hud-sel">
          <div className="selinfo"><b>{hud.structure.kind === 'tower' ? 'Tower' : 'Lot'} under construction</b><div className="hpbar"><i style={{ width: `${Math.round(hud.structure.progress * 100)}%` }} /></div><span>{Math.round(hud.structure.progress * 100)}% built</span></div>
          <div className="selbtns"><button className="tsbtn small red" title={`Refunds ${hud.structure.refund} lumber`} onClick={() => actions.cancelBuild(hud.structure!.id)}>Cancel build (+{hud.structure.refund})</button></div>
        </div>
      )}
      {hud.pawn && (
        <div className="panel hud-sel">
          <div className="selinfo"><b>Pawn</b><span>{hud.pawn.state}</span>{hud.pawn.carry > 0 && <span>Carrying {hud.pawn.carry}</span>}{hud.pawn.progress > 0 && <span>Chopping {Math.round(hud.pawn.progress * 100)}%</span>}<small>Click a tree, gold stone, ripe sheep or docked cargo boat to send the pawn (it drops what it was doing at once)</small></div>
        </div>
      )}
      <div className="hint help">Drag a unit to draw a route · shift-click or C-brush to select several · S stops movement · drag empty ground to pan · scroll to zoom · B toggles block</div>
      {hud.status === 'defeat' && (
        <div className="menu over"><div className="panel menu-card"><h1>Defeated</h1><p className="sub">Your last town and your last unit are gone.</p><button className="tsbtn big" onClick={actions.exit}>New match</button></div></div>
      )}
      {!hud.towns && hud.status === 'playing' && <div className="toast banner">You have no towns — recapture one to restore supply, power and territory</div>}
      {perf && <pre className="perf">{perf}</pre>}
    </div>
  )
}
