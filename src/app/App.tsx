import { useCallback, useEffect, useState } from 'react'
import { loadAssets, type Assets } from '../game/AssetLoader'
import { MAX_KINGDOMS, START } from '../game/config'
import { FACTION_NAMES } from '../game/config'
import { GameView } from './GameView'
import { NewGameScreen, type NewGameParams } from './NewGameScreen'
import { installUiTheme } from './ui'

export default function App() {
  const [assets, setAssets] = useState<Assets | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [params, setParams] = useState<NewGameParams | null>(() => {
    // ?seed=ABC&towns=3&color=Teal&kingdoms=12&lumber=2000 starts a reproducible match immediately (useful for sharing seeds and testing); the
    // kingdom count is normally derived from the seed (10–15)
    const q = new URLSearchParams(location.search), seed = q.get('seed')
    const towns = Number(q.get('towns')), lumber = Number(q.get('lumber')), kingdoms = Number(q.get('kingdoms')), color = FACTION_NAMES.findIndex(n => n.toLowerCase() === (q.get('color') ?? '').toLowerCase())
    return seed ? { seed, color: Math.max(0, color), kingdoms: kingdoms >= 2 ? Math.min(MAX_KINGDOMS, kingdoms) : undefined, lumber: lumber > 0 ? lumber : undefined, playerTowns: towns >= 1 ? Math.min(START.maxPlayerTowns, towns) : undefined } : null
  })
  useEffect(() => {
    loadAssets().then(async a => { await installUiTheme(a); setAssets(a) }).catch(e => setError(String(e)))
  }, [])
  const exit = useCallback(() => setParams(null), [])
  const start = useCallback((p: NewGameParams) => setParams(p), [])
  if (error) return <div className="menu"><div className="panel menu-card"><h1>Could not load art</h1><p className="sub">{error}</p></div></div>
  if (params && assets) return <GameView assets={assets} params={params} onExit={exit} />
  return <NewGameScreen ready={!!assets} onStart={start} />
}
