import { useEffect, useMemo, useReducer, useState, type ReactNode } from 'react'
import { BARGE, BOAT, CARGO, FACTION_COLORS, GUNSHIP, UNIT, UNIT_TYPES, ZUMWALT, type BoatKind, type UnitType } from '../game/config'
import { debugSnapshot, type KDebug } from '../game/DebugInfo'
import type { Game } from '../game/Game'
import { BOAT_KINDS, SPEND_CATS, type KStats, type SeriesKey, type SpendCat, type StatEvent } from '../game/Stats'
import { Bar, Legend, LineChart, StackBar, Tile, fmtClock, fmtN, type Series } from './Charts'
import { emblemUrl } from './ui'

type Tab = 'overview' | 'economy' | 'military' | 'navy' | 'ai' | 'timeline'
const TABS: [Tab, string][] = [['overview', 'Overview'], ['economy', 'Economy'], ['military', 'Military'], ['navy', 'Navy'], ['ai', 'AI & Diplomacy'], ['timeline', 'Timeline']]

const SHIP_LABEL: Record<BoatKind, string> = { boat: 'Infantry boat', barge: 'Barge', cargo: 'Cargo boat', gunship: 'Gunship', zumwalt: 'Zumwalt' }
const SHIP_COST: Record<BoatKind, number> = { boat: BOAT.cost, barge: BARGE.cost, cargo: CARGO.cost, gunship: GUNSHIP.cost, zumwalt: ZUMWALT.cost }
/** Eight categorical slots (light surface), in fixed order: a spending category or ship kind keeps its colour everywhere. */
const CAT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
const SPEND_COLOR = Object.fromEntries(SPEND_CATS.map((c, i) => [c, CAT[i]])) as Record<SpendCat, string>
const SPEND_LABEL: Record<SpendCat, string> = { tower: 'Towers', lot: 'Lots', boat: 'Troop ships (boats and barges)', cargo: 'Cargo boats', gunship: 'Gunships', zumwalt: 'Zumwalts', settlement: 'Settlements', upgrade: 'Upgrades' }
const SHIP_COLOR: Record<BoatKind, string> = { boat: CAT[0], barge: CAT[4], cargo: CAT[2], gunship: CAT[3], zumwalt: CAT[1] }
const UNIT_COLOR: Record<UnitType, string> = { warrior: CAT[0], archer: CAT[2], lancer: CAT[1], knight: CAT[3] }

const METRICS: { key: SeriesKey | 'income'; label: string; unit?: string }[] = [
  { key: 'lumber', label: 'Lumber stock' }, { key: 'income', label: 'Lumber income', unit: '/min' }, { key: 'gold', label: 'Gold' }, { key: 'meat', label: 'Meat' }, { key: 'power', label: 'Power' },
  { key: 'towns', label: 'Towns' }, { key: 'units', label: 'Units' }, { key: 'ships', label: 'Ships' }, { key: 'tiles', label: 'Territory (tiles)' },
]

const sum = (o: Record<string, number>) => Object.values(o).reduce((n, v) => n + v, 0)
const shipSum = (s: KStats, f: 'started' | 'built' | 'lost' | 'sunk' | 'siteLost') => BOAT_KINDS.reduce((n, k) => n + s.ships[k][f], 0)
const spentTotal = (s: KStats) => sum(s.spentLumber)

function Chip({ tone, children }: { tone: 'ok' | 'wait' | 'block' | 'info' | 'dim'; children: ReactNode }) { return <span className={'stchip ' + tone}>{children}</span> }
const statusChip = (d: KDebug['diagnosis']) => d.status === 'blocked' ? <Chip tone="block">⚠ Blocked</Chip> : d.status === 'building' ? <Chip tone="info">⚓ Building</Chip> : d.status === 'idle' ? <Chip tone="dim">Idle</Chip> : <Chip tone="dim">–</Chip>
const toneIcon = { ok: '✓', wait: '…', block: '⚠' }

export function DebugPanel({ game, onClose, paused, onPause }: { game: Game; onClose: () => void; paused: boolean; onPause: (p: boolean) => void }) {
  const [tab, setTab] = useState<Tab>(() => (import.meta.env.DEV && (new URLSearchParams(location.search).get('tab') as Tab)) || 'overview') // (dev aid: ?tab=navy)
  const [tick, bump] = useReducer((n: number) => n + 1, 0)
  const [sel, setSel] = useState<number | null>(null)
  useEffect(() => { const id = setInterval(bump, 250); return () => clearInterval(id) }, [])
  const snap = useMemo(() => debugSnapshot(game), [game, tick]) // eslint-disable-line react-hooks/exhaustive-deps -- recomputed on every 250 ms tick
  const st = game.stats
  const ks = snap.kingdoms
  const col = (id: number) => FACTION_COLORS[ks[id].color]
  const emb = (k: KDebug) => emblemUrl(k.emblem, k.color, 24)
  const Nation = ({ k }: { k: KDebug }) => <span className={'nation' + (k.alive ? '' : ' dead')}><i style={{ background: col(k.id) }} /><img src={emb(k)} alt="" />{k.isPlayer ? `${k.name} (you)` : k.name}</span>

  return (
    <div className="menu over dbg" onKeyDown={e => e.stopPropagation()}>
      <div className="panel dbg-card">
        <header className="dbg-head">
          <div><h2>War Room</h2><small>Live match review · {fmtClock(snap.time)} elapsed · {ks.filter(k => k.alive).length}/{ks.length} nations standing</small></div>
          <nav className="dbg-tabs" role="tablist">{TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}</nav>
          <div className="dbg-actions">
            <label className="pauseopt" title="Freeze the simulation while you read"><input type="checkbox" checked={paused} onChange={e => onPause(e.target.checked)} /> Pause game</label>
            <button className="tsbtn small" title="Forget the AI fleets' plans and cancel their routes (for a saved game whose ships are wedged)" onClick={() => game.unstickFleets()}>Unstick AI fleets</button>
            <button className="tsbtn small red" onClick={onClose}>Close (Tab)</button>
          </div>
        </header>
        <div className="dbg-body">
          {tab === 'overview' && <Overview snap={snap} game={game} sel={sel} setSel={setSel} Nation={Nation} />}
          {tab === 'economy' && <Economy snap={snap} game={game} Nation={Nation} />}
          {tab === 'military' && <Military snap={snap} game={game} Nation={Nation} />}
          {tab === 'navy' && <Navy snap={snap} game={game} Nation={Nation} />}
          {tab === 'ai' && <AIView snap={snap} game={game} Nation={Nation} />}
          {tab === 'timeline' && <Timeline snap={snap} events={st.events} />}
        </div>
      </div>
    </div>
  )
}

type NationC = (p: { k: KDebug }) => ReactNode
type Props = { snap: ReturnType<typeof debugSnapshot>; game: Game; Nation: NationC }

// ------------------------------------------------------------------ overview
type Col = { key: string; label: string; title?: string; get: (k: KDebug, s: KStats) => number; cell: (k: KDebug, s: KStats) => ReactNode }
const resCell = (home: number, total: number) => <>{fmtN(home)}{Math.round(total) !== Math.round(home) && <small className="sub2"> ({fmtN(total)})</small>}</>
const shipTotal = (k: KDebug) => BOAT_KINDS.reduce((n, b) => n + k.ships[b].afloat, 0)
const buildingTotal = (k: KDebug) => BOAT_KINDS.reduce((n, b) => n + k.ships[b].building, 0)
const COLS: Col[] = [
  { key: 'navy', label: 'Shipbuilding', title: 'Is the nation able to build ships? (see the Navy tab for the reasons)', get: k => ({ blocked: 0, idle: 1, building: 2, 'n/a': 3 })[k.diagnosis.status], cell: k => statusChip(k.diagnosis) },
  { key: 'towns', label: 'Towns', title: 'Towns (settlements in brackets)', get: k => k.towns, cell: k => <>{k.towns}{k.settlements > 0 && <small className="sub2"> (+{k.settlements})</small>}</> },
  { key: 'tiles', label: 'Land', title: 'Territory tiles', get: k => k.tiles, cell: k => fmtN(k.tiles) },
  { key: 'units', label: 'Units', title: 'Units / population cap', get: k => k.pop, cell: k => <span className={k.pop > k.cap ? 'bad' : ''}>{k.pop}<small className="sub2">/{k.cap}</small></span> },
  { key: 'lumber', label: 'Lumber', title: 'Home stockpile (all regions in brackets)', get: k => k.home.lumber, cell: k => resCell(k.home.lumber, k.total.lumber) },
  { key: 'income', label: 'Wood/min', title: 'Lumber delivered by pawns over the last minute', get: k => k.income.lumberPerMin, cell: k => <span className={k.income.lumberPerMin < 1 && k.alive ? 'bad' : ''}>{k.income.lumberPerMin.toFixed(1)}</span> },
  { key: 'trees', label: 'Trees', title: 'Standing trees inside its territory (stumps awaiting regrowth in brackets)', get: k => k.trees.standing, cell: k => <span className={k.trees.standing === 0 && k.alive ? 'bad' : ''}>{k.trees.standing}<small className="sub2"> ({k.trees.stumps})</small></span> },
  { key: 'gold', label: 'Gold', get: k => k.home.gold, cell: k => resCell(k.home.gold, k.total.gold) },
  { key: 'meat', label: 'Meat', get: k => k.home.meat, cell: k => resCell(k.home.meat, k.total.meat) },
  { key: 'power', label: 'Power', get: k => k.power, cell: k => fmtN(k.power) },
  { key: 'pawns', label: 'Pawns', title: 'Pawns (idle ones in brackets)', get: k => k.pawns.total, cell: k => <>{k.pawns.total}<small className="sub2"> ({k.pawns.byState.wander ?? 0} idle)</small></> },
  { key: 'ships', label: 'Ships', title: 'Ships afloat (+ under construction)', get: k => shipTotal(k), cell: k => <>{shipTotal(k)}{buildingTotal(k) > 0 && <small className="sub2"> (+{buildingTotal(k)})</small>}</> },
  { key: 'kills', label: 'Kills', get: (_k, s) => sum(s.killed), cell: (_k, s) => sum(s.killed) },
]

function Overview({ snap, game, sel, setSel, Nation }: Props & { sel: number | null; setSel: (n: number | null) => void }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'tiles', dir: -1 })
  const st = game.stats, ks = snap.kingdoms
  const col = COLS.find(c => c.key === sort.key) ?? COLS[0]
  const rows = [...ks].sort((a, b) => (a.alive === b.alive ? 0 : a.alive ? -1 : 1) || sort.dir * (col.get(b, st.k[b.id]) - col.get(a, st.k[a.id])) * -1)
  const alive = ks.filter(k => k.alive)
  const totalKills = ks.reduce((n, k) => n + sum(st.k[k.id].killed), 0)
  const shipsAfloat = ks.reduce((n, k) => n + shipTotal(k), 0)
  const blocked = ks.filter(k => k.diagnosis.status === 'blocked')
  const nextRegrow = game.stumps.reduce((m, id) => Math.min(m, (game.world.trees[id]?.regrowAt ?? Infinity) - game.time), Infinity)
  const best = (f: (k: KDebug) => number) => ks.reduce((b, k) => (f(k) > f(b) ? k : b), ks[0])
  const awards: [string, KDebug, string][] = [
    ['Most enemy units killed', best(k => sum(st.k[k.id].killed)), `${sum(st.k[best(k => sum(st.k[k.id].killed)).id].killed)} kills`],
    ['Most ships sunk', best(k => shipSum(st.k[k.id], 'sunk')), `${shipSum(st.k[best(k => shipSum(st.k[k.id], 'sunk')).id], 'sunk')} ships`],
    ['Largest fleet built', best(k => shipSum(st.k[k.id], 'built')), `${shipSum(st.k[best(k => shipSum(st.k[k.id], 'built')).id], 'built')} launched`],
    ['Biggest lumber gatherer', best(k => st.k[k.id].gathered.lumber), `${fmtN(st.k[best(k => st.k[k.id].gathered.lumber).id].gathered.lumber)} lumber`],
    ['Largest territory', best(k => k.tiles), `${fmtN(best(k => k.tiles).tiles)} tiles`],
    ['Most towns captured', best(k => st.k[k.id].townsCaptured), `${st.k[best(k => st.k[k.id].townsCaptured).id].townsCaptured} captured`],
    ['Heaviest losses', best(k => sum(st.k[k.id].lost)), `${sum(st.k[best(k => sum(st.k[k.id].lost)).id].lost)} units lost`],
  ]
  const detail = sel !== null ? ks[sel] : null
  return (
    <>
      <div className="tiles">
        <Tile label="Nations standing" value={`${alive.length}/${ks.length}`} sub={st.k.filter(s => s.diedAt !== null).length ? `${st.k.filter(s => s.diedAt !== null).length} eliminated` : 'none eliminated yet'} />
        <Tile label="Units fielded" value={fmtN(ks.reduce((n, k) => n + k.pop, 0))} sub={`${fmtN(totalKills)} killed so far`} />
        <Tile label="Ships afloat" value={shipsAfloat} sub={`${ks.reduce((n, k) => n + shipSum(st.k[k.id], 'lost'), 0)} lost, ${ks.reduce((n, k) => n + shipSum(st.k[k.id], 'built'), 0)} built`} />
        <Tile label="Forest" value={fmtN(snap.forest.standing)} sub={`${snap.forest.stumps} stumps · ${snap.forest.regrown} regrown${isFinite(nextRegrow) ? ` · next in ${fmtClock(Math.max(0, nextRegrow))}` : ''}`} />
        <Tile label="Shipbuilding blocked" value={blocked.length} tone={blocked.length ? 'bad' : 'good'} sub={blocked.length ? blocked.map(k => k.name).slice(0, 3).join(', ') + (blocked.length > 3 ? '…' : '') : 'every AI nation can build'} />
      </div>
      <div className="split">
        <section className="card grow">
          <h3>Nations <small>click a row for detail · click a heading to sort · bracketed numbers are totals across every island and settlement</small></h3>
          <div className="tablewrap">
            <table className="dtable">
              <thead><tr><th>Nation</th>{COLS.map(c => <th key={c.key} title={c.title} className={sort.key === c.key ? 'sorted' : ''} onClick={() => setSort(s => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : -1 }))}>{c.label}{sort.key === c.key ? (sort.dir === -1 ? ' ▾' : ' ▴') : ''}</th>)}</tr></thead>
              <tbody>{rows.map(k => (
                <tr key={k.id} className={(sel === k.id ? 'sel ' : '') + (k.alive ? '' : 'dead')} onClick={() => setSel(sel === k.id ? null : k.id)}>
                  <td><Nation k={k} />{!k.isPlayer && <small className={'temper ' + k.temperament}> {k.temperament}</small>}</td>
                  {COLS.map(c => <td key={c.key}>{c.cell(k, st.k[k.id])}</td>)}
                </tr>))}</tbody>
            </table>
          </div>
        </section>
        <aside className="card side">
          {detail ? <KingdomDetail k={detail} game={game} Nation={Nation} /> : (
            <>
              <h3>Highlights</h3>
              <ul className="awards">{awards.map(([label, k, v]) => parseFloat(v.replace(/[^0-9.]/g, '')) > 0 ? <li key={label}><small>{label}</small><Nation k={k} /><b>{v}</b></li> : <li key={label}><small>{label}</small><span className="dim">nobody yet</span><b /></li>)}</ul>
              <small className="hint2">Pick a nation in the table for its stockpiles, workers, shipyards and the AI's own reasoning.</small>
            </>
          )}
        </aside>
      </div>
    </>
  )
}

function KingdomDetail({ k, game, Nation }: { k: KDebug; game: Game; Nation: NationC }) {
  const s = game.stats.k[k.id]
  const states = Object.entries(k.pawns.byState).sort((a, b) => b[1] - a[1])
  return (
    <div className="detail">
      <h3><Nation k={k} /></h3>
      <small>{k.title} · level {k.level} · {k.isPlayer ? 'player' : `${k.temperament} · aggression ${(k.aggression * 100).toFixed(0)}%`} · harvest {k.harvest.toUpperCase()}{isFinite(k.harvestCap) ? ` (stops chopping above ${k.harvestCap})` : ''}</small>
      <h4>Stockpiles</h4>
      <table className="dtable mini2"><thead><tr><th>Region</th><th>Lumber</th><th>Gold</th><th>Meat</th></tr></thead>
        <tbody>{k.regions.map((r, i) => <tr key={i}><td>{r.label}</td><td>{Math.floor(r.lumber)}</td><td>{Math.floor(r.gold)}</td><td>{Math.floor(r.meat)}</td></tr>)}
          <tr className="total"><td>Total</td><td>{Math.floor(k.total.lumber)}</td><td>{Math.floor(k.total.gold)}</td><td>{Math.floor(k.total.meat)}</td></tr></tbody></table>
      <h4>Workers <small>{k.pawns.total} pawns</small></h4>
      <div className="kv">{states.length ? states.map(([name, n]) => <span key={name}>{name} <b>{n}</b></span>) : <span>none</span>}</div>
      <h4>Army <small>{k.pop}/{k.cap} · {k.garrisoned} in towers · {k.cutOff} cut off · {k.resting} resting</small></h4>
      <StackBar parts={UNIT_TYPES.map(t => ({ label: UNIT[t].label, value: k.units[t], color: UNIT_COLOR[t] }))} />
      <div className="kv">{UNIT_TYPES.map(t => <span key={t}><i style={{ background: UNIT_COLOR[t] }} /> {UNIT[t].label} <b>{k.units[t]}</b></span>)}</div>
      <h4>Shipyards <small>{k.navy.used}/{k.navy.points} naval points · {k.navy.zum}/{k.navy.zumCap} Zumwalts</small></h4>
      {k.yards.length ? <div className="kv">{k.yards.map(y => <span key={y.land} title={`${y.holdings} towns or settlements`}>{y.label}: <b className={y.have < y.quota ? 'bad' : ''}>{y.have}/{y.quota}</b></span>)}</div> : <small>No towns, so no shipyards.</small>}
      <h4>Shipbuilding {statusChip(k.diagnosis)}</h4>
      <ul className="reasons">{k.diagnosis.reasons.map((r, i) => <li key={i} className={r.tone}><span>{toneIcon[r.tone]}</span>{r.text}</li>)}</ul>
      <h4>Ledger</h4>
      <div className="kv"><span>gathered <b>{fmtN(s.gathered.lumber)}</b> wood</span><span>spent <b>{fmtN(spentTotal(s))}</b></span><span>from captures <b>{fmtN(s.lumberTaken)}</b></span><span>lost with towns <b>{fmtN(s.lumberLost)}</b></span></div>
    </div>
  )
}

// ------------------------------------------------------------------ chart helpers
function useShown(ks: KDebug[], valueOf: (k: KDebug) => number) {
  const [mode, setMode] = useState<'top' | 'all' | 'none' | 'custom'>('top')
  const [custom, setCustom] = useState<Set<number>>(new Set())
  const shown = useMemo(() => {
    if (mode === 'all') return new Set(ks.map(k => k.id))
    if (mode === 'none') return new Set<number>()
    if (mode === 'custom') return custom
    return new Set([...ks].sort((a, b) => valueOf(b) - valueOf(a)).slice(0, 6).map(k => k.id).concat(ks.filter(k => k.isPlayer).map(k => k.id)))
  }, [mode, custom, ks, valueOf])
  const toggle = (id: number) => { setCustom(new Set(shown.has(id) ? [...shown].filter(x => x !== id) : [...shown, id])); setMode('custom') }
  return { shown, toggle, preset: (p: 'top' | 'all' | 'none') => setMode(p) }
}

// ------------------------------------------------------------------ economy
function Economy({ snap, game, Nation }: Props) {
  const [metric, setMetric] = useState<(typeof METRICS)[number]['key']>('lumber')
  const [table, setTable] = useState(false)
  const S = game.stats.series, ks = snap.kingdoms, st = game.stats
  const seriesFor = (m: typeof metric, id: number): number[] => {
    if (m !== 'income') return S.v[m as SeriesKey][id]
    const g = S.v.gathered[id]
    return g.map((_, i) => { const j = Math.max(0, i - 3), dt = S.t[i] - S.t[j]; return dt > 0 ? ((g[i] - g[j]) / dt) * 60 : 0 })
  }
  const last = (k: KDebug) => seriesFor(metric, k.id).at(-1) ?? 0
  const { shown, toggle, preset } = useShown(ks, last)
  const def = METRICS.find(m => m.key === metric)!
  const series: Series[] = ks.filter(k => shown.has(k.id)).map(k => ({ id: k.id, name: k.name, color: FACTION_COLORS[k.color], v: seriesFor(metric, k.id) }))
  const legend = ks.map(k => ({ id: k.id, name: k.name, color: FACTION_COLORS[k.color], emblem: emblemUrl(k.emblem, k.color, 20) }))
  const maxSpent = Math.max(1, ...st.k.map(spentTotal))
  const rows = [...ks].sort((a, b) => spentTotal(st.k[b.id]) - spentTotal(st.k[a.id]))
  const totals = SPEND_CATS.map(c => ({ c, v: st.k.reduce((n, s) => n + s.spentLumber[c], 0) }))
  return (
    <>
      <section className="card">
        <h3>Trends <small>sampled every {S.step}s</small></h3>
        <div className="pills">{METRICS.map(m => <button key={m.key} className={metric === m.key ? 'on' : ''} onClick={() => setMetric(m.key)}>{m.label}</button>)}</div>
        <Legend items={legend} shown={shown} onToggle={toggle} onPreset={preset} />
        <LineChart t={S.t} series={series} unit={def.unit} />
        <button className="mini" onClick={() => setTable(t => !t)}>{table ? 'Hide' : 'Show'} data table</button>
        {table && (
          <div className="tablewrap short"><table className="dtable mini2"><thead><tr><th>Time</th>{series.map(s => <th key={s.id}>{s.name}</th>)}</tr></thead>
            <tbody>{S.t.map((t, i) => [t, i] as const).filter(([, i]) => i % Math.max(1, Math.ceil(S.t.length / 24)) === 0 || i === S.t.length - 1).reverse().map(([t, i]) => <tr key={i}><td>{fmtClock(t)}</td>{series.map(s => <td key={s.id}>{fmtN(s.v[i] ?? 0)}</td>)}</tr>)}</tbody></table></div>
        )}
      </section>
      <div className="split">
        <section className="card grow">
          <h3>Lumber ledger <small>where every nation's wood went</small></h3>
          <div className="legend static">{SPEND_CATS.map(c => <span key={c} className="chip2 on"><i style={{ background: SPEND_COLOR[c] }} />{SPEND_LABEL[c]} <b>{fmtN(totals.find(t => t.c === c)!.v)}</b></span>)}</div>
          <div className="tablewrap"><table className="dtable">
            <thead><tr><th>Nation</th><th>Gathered</th><th>Spent</th><th className="wide">Spending</th><th title="Wood that arrived with captured towns">Captured</th><th title="Wood that left with towns that fell">Lost</th><th title="Ship hulls destroyed while still under construction">Wasted hulls</th><th>Gold in/out</th></tr></thead>
            <tbody>{rows.map(k => { const s = st.k[k.id], wasted = BOAT_KINDS.reduce((n, b) => n + s.ships[b].siteLost * SHIP_COST[b], 0); return (
              <tr key={k.id} className={k.alive ? '' : 'dead'}><td><Nation k={k} /></td><td>{fmtN(s.gathered.lumber)}</td><td>{fmtN(spentTotal(s))}</td>
                <td className="wide"><StackBar total={maxSpent} parts={SPEND_CATS.map(c => ({ label: SPEND_LABEL[c], value: s.spentLumber[c], color: SPEND_COLOR[c] }))} /></td>
                <td>{fmtN(s.lumberTaken)}</td><td>{fmtN(s.lumberLost)}</td><td className={wasted > 0 ? 'bad' : ''}>{fmtN(wasted)}</td><td>{fmtN(s.gathered.gold)} / {fmtN(s.spentGold)}</td></tr>) })}</tbody>
          </table></div>
        </section>
        <aside className="card side">
          <h3>Forest</h3>
          <div className="kv big"><span>standing <b>{fmtN(snap.forest.standing)}</b></span><span>stumps <b>{snap.forest.stumps}</b></span><span>felled <b>{fmtN(snap.forest.felled)}</b></span><span>regrown <b>{fmtN(snap.forest.regrown)}</b></span></div>
          <small className="hint2">A felled tree grows back after 15–25 minutes (a different delay for each one), unless something has been built on the spot.</small>
          <h3>Trees by territory</h3>
          {[...ks].sort((a, b) => b.trees.standing - a.trees.standing).map(k => <div key={k.id} className="barrow"><Nation k={k} /><Bar value={k.trees.standing} max={Math.max(1, ...ks.map(q => q.trees.standing))} color={FACTION_COLORS[k.color]} label={`${k.trees.standing} · ${k.income.lumberPerMin.toFixed(1)}/min`} /></div>)}
        </aside>
      </div>
    </>
  )
}

// ------------------------------------------------------------------ military
function Military({ snap, game, Nation }: Props) {
  const st = game.stats, ks = snap.kingdoms
  const rows = [...ks].sort((a, b) => sum(st.k[b.id].killed) - sum(st.k[a.id].killed))
  const maxCell = Math.max(1, ...st.kills.flat())
  const cols = ks.filter(k => st.kills.some(r => r[k.id] > 0) || st.kills[k.id].some(v => v > 0))
  const kd = (s: KStats) => { const l = sum(s.lost); return l ? (sum(s.killed) / l).toFixed(2) : sum(s.killed) ? '∞' : '–' }
  const maxLost = Math.max(1, ...st.k.map(s => sum(s.lost)), ...st.k.map(s => sum(s.killed)))
  return (
    <>
      <section className="card">
        <h3>Casualties and production <small>squads count every member</small></h3>
        <div className="legend static">{UNIT_TYPES.map(t => <span key={t} className="chip2 on"><i style={{ background: UNIT_COLOR[t] }} />{UNIT[t].label}</span>)}</div>
        <div className="tablewrap"><table className="dtable">
          <thead><tr><th>Nation</th><th>Trained</th><th>Killed</th><th className="wide">Enemy units killed, by type</th><th>Lost</th><th className="wide">Own units lost, by type</th><th title="Killed ÷ lost">K/D</th><th title="Died to enemies / died to attrition, cut-off supply or over-cap">Lost to enemy / other</th></tr></thead>
          <tbody>{rows.map(k => { const s = st.k[k.id]; return (
            <tr key={k.id} className={k.alive ? '' : 'dead'}><td><Nation k={k} /></td><td title={UNIT_TYPES.map(t => `${UNIT[t].label} ${s.trained[t]}`).join(' · ')}>{sum(s.trained)}</td><td>{sum(s.killed)}</td>
              <td className="wide"><StackBar total={maxLost} parts={UNIT_TYPES.map(t => ({ label: UNIT[t].label, value: s.killed[t], color: UNIT_COLOR[t] }))} /></td>
              <td>{sum(s.lost)}</td><td className="wide"><StackBar total={maxLost} parts={UNIT_TYPES.map(t => ({ label: UNIT[t].label, value: s.lost[t], color: UNIT_COLOR[t] }))} /></td>
              <td>{kd(s)}</td><td>{s.lostToEnemy} / {s.lostToOther}</td></tr>) })}</tbody>
        </table></div>
      </section>
      <section className="card">
        <h3>Who killed whom <small>rows are the killers, columns the victims; units, squads counted by member</small></h3>
        {cols.length === 0 ? <small className="hint2">No kills yet.</small> : (
          <div className="tablewrap"><table className="heat">
            <thead><tr><th /><th className="vhead">Total</th>{cols.map(c => <th key={c.id} className="vhead" title={c.name}><i style={{ background: FACTION_COLORS[c.color] }} /><span>{c.name}</span></th>)}</tr></thead>
            <tbody>{ks.filter(k => st.kills[k.id].some(v => v > 0)).map(k => (
              <tr key={k.id}><th><Nation k={k} /></th><td className="tot">{st.kills[k.id].reduce((n, v) => n + v, 0)}</td>
                {cols.map(c => { const v = st.kills[k.id][c.id]; return <td key={c.id} title={`${k.name} killed ${v} of ${c.name}`} style={{ background: v ? `rgba(42,120,214,${(0.12 + 0.78 * Math.sqrt(v / maxCell)).toFixed(2)})` : undefined, color: v / maxCell > 0.45 ? '#fff' : undefined }}>{v || ''}</td> })}</tr>))}</tbody>
          </table></div>
        )}
      </section>
      <section className="card">
        <h3>Territory and structures</h3>
        <div className="tablewrap"><table className="dtable">
          <thead><tr><th>Nation</th><th>Towns captured</th><th>Towns lost</th><th>Razed by them</th><th>Settlements founded</th><th>Settlements lost</th><th>Towers built / lost</th><th>Lots built</th></tr></thead>
          <tbody>{ks.map(k => { const s = st.k[k.id]; return <tr key={k.id} className={k.alive ? '' : 'dead'}><td><Nation k={k} /></td><td>{s.townsCaptured}</td><td>{s.townsLost}</td><td>{s.townsRazed}</td><td>{s.settlementsFounded}</td><td>{s.settlementsLost}</td><td>{s.towersBuilt} / {s.towersLost}</td><td>{s.lotsBuilt}</td></tr> })}</tbody>
        </table></div>
      </section>
    </>
  )
}

// ------------------------------------------------------------------ navy
function Navy({ snap, game, Nation }: Props) {
  const st = game.stats, ks = snap.kingdoms
  const total = (f: 'started' | 'built' | 'lost' | 'sunk' | 'siteLost', kind: BoatKind) => st.k.reduce((n, s) => n + s.ships[kind][f], 0)
  const maxLost = Math.max(1, ...BOAT_KINDS.map(b => total('lost', b)), ...BOAT_KINDS.map(b => total('built', b)))
  const ai = ks.filter(k => !k.isPlayer && k.alive)
  const rank = { blocked: 0, building: 1, idle: 2, 'n/a': 3 }
  return (
    <>
      <section className="card">
        <h3>Why aren't they building ships? <small>hard facts (shipyards, wood, trees, caps, free spots) combined with what each AI said when it last decided</small></h3>
        <div className="diag">{[...ai].sort((a, b) => rank[a.diagnosis.status] - rank[b.diagnosis.status]).map(k => (
          <div key={k.id} className={'diagcard ' + k.diagnosis.status}>
            <header><Nation k={k} />{statusChip(k.diagnosis)}</header>
            <div className="kv"><span>wood <b>{Math.floor(k.home.lumber)}</b></span><span>income <b>{k.income.lumberPerMin.toFixed(1)}</b>/min</span><span>trees <b>{k.trees.standing}</b></span><span>naval pts <b>{k.navy.used}/{k.navy.points}</b></span><span>yards <b>{k.yards.reduce((n, y) => n + y.have, 0)}/{k.yards.reduce((n, y) => n + y.quota, 0)}</b></span></div>
            <ul className="reasons">{k.diagnosis.reasons.map((r, i) => <li key={i} className={r.tone}><span>{toneIcon[r.tone]}</span>{r.text}</li>)}</ul>
            <ul className="reasons dim">{Object.entries(k.notes).map(([key, n]) => <li key={key} className={n.tone}><span>{toneIcon[n.tone]}</span><b>{key}</b> {n.text} <small>({fmtClock(Math.max(0, snap.time - n.t))} ago)</small></li>)}</ul>
          </div>))}</div>
      </section>
      <div className="split">
        <section className="card grow">
          <h3>Fleets <small>afloat now · under construction in brackets</small></h3>
          <div className="legend static">{BOAT_KINDS.map(b => <span key={b} className="chip2 on"><i style={{ background: SHIP_COLOR[b] }} />{SHIP_LABEL[b]} ({SHIP_COST[b]} wood)</span>)}</div>
          <div className="tablewrap"><table className="dtable">
            <thead><tr><th>Nation</th>{BOAT_KINDS.map(b => <th key={b}>{SHIP_LABEL[b]}</th>)}<th title="Placement attempts that found no free spot">Placement fails</th></tr></thead>
            <tbody>{ks.map(k => { const s = st.k[k.id]; return (
              <tr key={k.id} className={k.alive ? '' : 'dead'}><td><Nation k={k} /></td>
                {BOAT_KINDS.map(b => <td key={b} title={`launched ${s.ships[b].built} · lost ${s.ships[b].lost} · sunk ${s.ships[b].sunk} enemy · hulls lost under construction ${s.ships[b].siteLost}`}>{k.ships[b].afloat}{k.ships[b].building > 0 && <small className="sub2"> (+{k.ships[b].building})</small>}<small className="sub2"> · built {s.ships[b].built}</small></td>)}
                <td className={BOAT_KINDS.some(b => s.placement[b].fails > 0) ? 'bad' : ''}>{BOAT_KINDS.reduce((n, b) => n + s.placement[b].fails, 0)} / {BOAT_KINDS.reduce((n, b) => n + s.placement[b].tries, 0)}</td></tr>) })}</tbody>
          </table></div>
        </section>
        <aside className="card side">
          <h3>Ships destroyed by type</h3>
          {BOAT_KINDS.map(b => <div key={b} className="barrow"><span>{SHIP_LABEL[b]}</span><Bar value={total('lost', b)} max={maxLost} color={SHIP_COLOR[b]} label={`${total('lost', b)} lost · ${total('built', b)} built`} /></div>)}
          <h3>Sunk by nation</h3>
          {[...ks].sort((a, b) => shipSum(st.k[b.id], 'sunk') - shipSum(st.k[a.id], 'sunk')).filter(k => shipSum(st.k[k.id], 'sunk') > 0 || shipSum(st.k[k.id], 'lost') > 0).map(k => <div key={k.id} className="barrow"><Nation k={k} /><StackBar total={Math.max(1, ...ks.map(q => shipSum(st.k[q.id], 'sunk')))} parts={BOAT_KINDS.map(b => ({ label: SHIP_LABEL[b], value: st.k[k.id].ships[b].sunk, color: SHIP_COLOR[b] }))} /><em>{shipSum(st.k[k.id], 'sunk')} sunk · {shipSum(st.k[k.id], 'lost')} lost</em></div>)}
          {BOAT_KINDS.reduce((n, b) => n + total('siteLost', b), 0) > 0 && <small className="hint2">Hulls destroyed while still being built: {BOAT_KINDS.map(b => `${total('siteLost', b)} ${SHIP_LABEL[b].toLowerCase()}`).join(', ')}.</small>}
        </aside>
      </div>
      <section className="card">
        <h3>Shipyards <small>one per landmass with a town, plus one per four towns on it</small></h3>
        <div className="tablewrap"><table className="dtable mini2"><thead><tr><th>Nation</th><th>Landmass</th><th>Towns</th><th>Yards</th></tr></thead>
          <tbody>{ks.flatMap(k => k.yards.map(y => <tr key={`${k.id}-${y.land}`}><td><Nation k={k} /></td><td>{y.label}</td><td>{y.holdings}</td><td className={y.have < y.quota ? 'bad' : ''}>{y.have} / {y.quota}</td></tr>))}</tbody></table></div>
      </section>
    </>
  )
}

// ------------------------------------------------------------------ AI & diplomacy
const REL_TXT = { allied: 'Allied', neutral: 'Neutral', conflict: 'Conflict', war: 'War', total: 'Total war' }
function AIView({ snap, game, Nation }: Props) {
  const ks = snap.kingdoms
  return (
    <section className="card">
      <h3>Live AI state <small>refreshes four times a second</small></h3>
      <div className="tablewrap"><table className="dtable aitable">
        <thead><tr><th>Nation</th><th>Temperament</th><th>Aggression</th><th>Agitation</th><th>Harvest</th><th>Doing</th><th>Relations</th></tr></thead>
        <tbody>{ks.filter(k => !k.isPlayer).map(k => (
          <tr key={k.id} className={k.alive ? '' : 'dead'}>
            <td><Nation k={k} /></td>
            <td><small className={'temper ' + k.temperament}>{k.temperament}</small>{k.ready && <Chip tone="block">on alert</Chip>}</td>
            <td><Bar value={k.aggression} max={1} color="#d9892b" label={`${(k.aggression * 100).toFixed(0)}%`} /></td>
            <td><Bar value={k.agitation} max={100} color={k.agitation >= 40 ? '#d9532a' : k.agitation >= 35 ? '#e0b43a' : '#5fbf55'} label={`${Math.round(k.agitation)}%`} /></td>
            <td>{k.harvest.toUpperCase()}</td>
            <td className="doing">
              {k.ai.warGoal && <div>⚔ {k.ai.warGoal}</div>}
              {k.ai.expedition && <div>⛵ {k.ai.expedition}</div>}
              {k.ai.colony && <div>🏝 {k.ai.colony}</div>}
              {k.ai.navalThreat && <div className="bad">⚠ Under naval attack</div>}
              {Object.entries(k.ai.shipPhases).length > 0 && <div className="dim">ships: {Object.entries(k.ai.shipPhases).map(([p, n]) => `${n}× ${p}`).join(', ')}</div>}
              {!k.ai.warGoal && !k.ai.expedition && !k.ai.colony && !k.ai.navalThreat && <span className="dim">–</span>}
            </td>
            <td className="rels">{k.relations.length ? k.relations.map(r => <span key={r.other} className={'rel ' + r.relation} title={`${REL_TXT[r.relation]} with ${ks[r.other].name}`}>{REL_TXT[r.relation]}: {ks[r.other].name}</span>) : <span className="dim">at peace with everyone</span>}</td>
          </tr>))}</tbody>
      </table></div>
      <h3>Active conflicts</h3>
      <ul className="reasons">
        {ks.flatMap(a => a.relations.filter(r => r.other > a.id && r.relation !== 'allied').map(r => ({ a, b: ks[r.other], r: r.relation }))).map(({ a, b, r }) => {
          const ka = game.stats.kills[a.id][b.id], kb = game.stats.kills[b.id][a.id]
          return <li key={`${a.id}-${b.id}`} className={r === 'conflict' ? 'wait' : 'block'}><span>⚔</span><Nation k={a} /> vs <Nation k={b} /> · {REL_TXT[r]} · kills {ka}–{kb}</li>
        })}
      </ul>
    </section>
  )
}

// ------------------------------------------------------------------ timeline
const EV_ICON: Record<StatEvent['kind'], string> = { ship: '⚓', town: '🏰', war: '⚔', build: '🔨', elim: '☠', diplo: '✉' }
function Timeline({ snap, events }: { snap: ReturnType<typeof debugSnapshot>; events: StatEvent[] }) {
  const [kinds, setKinds] = useState<Set<StatEvent['kind']>>(new Set(['ship', 'town', 'war', 'elim', 'diplo', 'build']))
  const [who, setWho] = useState(-1)
  const shown = events.filter(e => kinds.has(e.kind) && (who < 0 || e.k === who)).slice(-250).reverse()
  const ks = snap.kingdoms
  return (
    <section className="card">
      <h3>Event log <small>{events.length} events recorded · newest first</small></h3>
      <div className="pills">
        {(Object.keys(EV_ICON) as StatEvent['kind'][]).map(k => <button key={k} className={kinds.has(k) ? 'on' : ''} onClick={() => setKinds(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })}>{EV_ICON[k]} {k}</button>)}
        <select value={who} onChange={e => setWho(Number(e.target.value))}><option value={-1}>All nations</option>{ks.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</select>
      </div>
      <ul className="events2">{shown.map((e, i) => <li key={i}><time>{fmtClock(e.t)}</time><span>{EV_ICON[e.kind]}</span>{e.k >= 0 && ks[e.k] && <i style={{ background: FACTION_COLORS[ks[e.k].color] }} />}{e.text}</li>)}{!shown.length && <li className="dim">Nothing here yet.</li>}</ul>
    </section>
  )
}

