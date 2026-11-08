import { useEffect, useRef, useState } from 'react'
import { FACTIONS, GAME_CONFIG, Simulation } from './sim'
import { Camera, Renderer, TERRAIN_NAMES, TILE } from './render'

type Inspect = ReturnType<Simulation['inspect']>

export default function App(){
  const [screen,setScreen]=useState<'setup'|'game'>('setup')
  const [townCount,setTownCount]=useState(1)
  const [gameId,setGameId]=useState(0)
  const [hud,setHud]=useState({day:1,power:0,event:'',selected:'No squad selected',hp:0,cut:false,merged:1})
  const [inspect,setInspect]=useState<Inspect>(null)

  const begin=()=>{setGameId(v=>v+1);setScreen('game')}
  if(screen==='setup')return <NewGame count={townCount} setCount={setTownCount} begin={begin}/>
  return <Game key={gameId} townCount={townCount} onNew={()=>setScreen('setup')} hud={hud} setHud={setHud} inspect={inspect} setInspect={setInspect}/>
}

function NewGame({count,setCount,begin}:{count:number;setCount:(n:number)=>void;begin:()=>void}){
  return <main className="setup-shell">
    <div className="setup-map" aria-hidden="true"><div className="island-silhouette"/></div>
    <section className="setup-card">
      <p className="eyebrow">WORLD 01 · FIRST PLAYABLE</p>
      <h1><span>✦</span> BORDERLANDS <i>ONLINE</i></h1>
      <p className="lede">Command a handful of squads. Paint the frontier. Hold the flag.</p>
      <div className="divider"><span>NEW CAMPAIGN</span></div>
      <label className="town-choice">Starting villages <strong>{count}</strong></label>
      <div className="stepper">
        <button onClick={()=>setCount(Math.max(1,count-1))} aria-label="Fewer towns">−</button>
        {[1,2,3,4].map(n=><button key={n} className={n===count?'active':''} onClick={()=>setCount(n)}>{n}</button>)}
        <button onClick={()=>setCount(Math.min(4,count+1))} aria-label="More towns">+</button>
      </div>
      <div className="briefing">
        <div><span className="icon">⚑</span><b>{count} {count===1?'Village':'Villages'}</b><small>Claims expand from every settlement</small></div>
        <div><span className="counter-icon">×</span><b>3 Light Infantry</b><small>Squad count stays fixed</small></div>
        <div><span className="icon">♜</span><b>3 Rival Factions</b><small>One exposed town invites attack</small></div>
      </div>
      <button className="begin" onClick={begin}>BEGIN CAMPAIGN <span>→</span></button>
      <p className="tip">Tip: select a squad, then right-drag to draw its route</p>
    </section>
  </main>
}

function Game({townCount,onNew,hud,setHud,inspect,setInspect}:{townCount:number;onNew:()=>void;hud:any;setHud:(v:any)=>void;inspect:Inspect;setInspect:(v:Inspect)=>void}){
  const canvasRef=useRef<HTMLCanvasElement>(null)
  const simRef=useRef<Simulation|null>(null)
  const rendererRef=useRef<Renderer|null>(null)
  const camRef=useRef<Camera>({x:0,y:0,zoom:1})
  const drag=useRef({on:false,x:0,y:0,cx:0,cy:0,moved:false})
  const routeDraw=useRef(false)

  useEffect(()=>{
    const canvas=canvasRef.current!,sim=new Simulation(townCount),renderer=new Renderer(sim);simRef.current=sim;rendererRef.current=renderer
    let raf=0,last=performance.now(),hudClock=0,hover:{x:number,y:number}|null=null
    const resize=()=>{const r=canvas.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1);canvas.width=r.width*dpr;canvas.height=r.height*dpr;const fit=Math.min(r.width/(sim.w*TILE),r.height/(sim.h*TILE));camRef.current={x:0,y:0,zoom:fit};}
    resize();window.addEventListener('resize',resize)
    const loop=(now:number)=>{const dt=Math.min(.05,(now-last)/1000);last=now;sim.update(dt);const ctx=canvas.getContext('2d')!,dpr=Math.min(2,devicePixelRatio||1);ctx.setTransform(dpr,0,0,dpr,0,0);renderer.draw(ctx,canvas.width/dpr,canvas.height/dpr,camRef.current,hover);hudClock+=dt;if(hudClock>.2){hudClock=0;const s=sim.squads.find(q=>q.id===sim.selectedId);setHud({day:sim.day,power:sim.power,event:sim.event,selected:s?`Light Infantry · ${FACTIONS[s.faction].short}`:'No squad selected',hp:s?Math.max(0,Math.round(s.hp)):0,cut:!!s?.cutOff,merged:s?.merged??1})}raf=requestAnimationFrame(loop)}
    raf=requestAnimationFrame(loop)
    const world=(e:MouseEvent|WheelEvent)=>{const r=canvas.getBoundingClientRect();return renderer.screenToWorld(e.clientX-r.left,e.clientY-r.top,camRef.current)}
    const down=(e:MouseEvent)=>{if(e.button===2){e.preventDefault();const p=world(e);routeDraw.current=sim.beginDrawRoute(p.x,p.y);return}if(e.button===1||e.button===0&&e.shiftKey){e.preventDefault();drag.current={on:true,x:e.clientX,y:e.clientY,cx:camRef.current.x,cy:camRef.current.y,moved:false}}}
    const move=(e:MouseEvent)=>{const p=world(e);hover={x:Math.floor(p.x),y:Math.floor(p.y)};setInspect(sim.inspect(hover.x,hover.y));if(routeDraw.current&&(e.buttons&2))sim.extendDrawRoute(p.x,p.y);if(drag.current.on){const dx=e.clientX-drag.current.x,dy=e.clientY-drag.current.y;if(Math.hypot(dx,dy)>3)drag.current.moved=true;camRef.current.x=drag.current.cx-dx/camRef.current.zoom;camRef.current.y=drag.current.cy-dy/camRef.current.zoom}}
    const up=(e:MouseEvent)=>{if(e.button===2&&routeDraw.current){const p=world(e);sim.commitDrawRoute(p.x,p.y);routeDraw.current=false;return}if(drag.current.on){drag.current.on=false;return}if(e.button===0){const p=world(e);sim.selectAt(p.x,p.y)}}
    const context=(e:MouseEvent)=>{e.preventDefault()}
    const wheel=(e:WheelEvent)=>{e.preventDefault();const r=canvas.getBoundingClientRect(),sx=e.clientX-r.left,sy=e.clientY-r.top,old=camRef.current.zoom,nz=Math.max(.42,Math.min(2.5,old*Math.exp(-e.deltaY*.001)));const wx=sx/old+camRef.current.x,wy=sy/old+camRef.current.y;camRef.current.zoom=nz;camRef.current.x=wx-sx/nz;camRef.current.y=wy-sy/nz}
    canvas.addEventListener('mousedown',down);canvas.addEventListener('mousemove',move);canvas.addEventListener('mouseup',up);canvas.addEventListener('contextmenu',context);canvas.addEventListener('wheel',wheel,{passive:false})
    return()=>{cancelAnimationFrame(raf);window.removeEventListener('resize',resize);canvas.removeEventListener('mousedown',down);canvas.removeEventListener('mousemove',move);canvas.removeEventListener('mouseup',up);canvas.removeEventListener('contextmenu',context);canvas.removeEventListener('wheel',wheel)}
  },[townCount,setHud,setInspect])

  return <main className="game-shell">
    <header className="topbar"><div className="brand">✦ <strong>BORDERLANDS</strong> <i>ONLINE</i></div><div className="world">WORLD 01 <b><span/> LIVE</b></div><div className="stat">DAY <strong>{hud.day}</strong></div><div className="stat power">◆ <strong>{hud.power}</strong> POWER</div><button onClick={onNew}>NEW GAME</button></header>
    <canvas ref={canvasRef} aria-label="Borderlands strategy map"/>
    <aside className="activity"><h3>◉ FRONTIER REPORT</h3><p><span className="green">●</span> Three rival factions active</p><p>⚔ Squads contest local control</p><p>⚑ Sunreach is undefended</p><small>{hud.event}</small></aside>
    <section className="squad-card"><div className="unit-badge">×</div><div><small>SELECTED UNIT</small><strong>{hud.selected}</strong>{hud.selected!=='No squad selected'&&<span>{hud.hp} HP · {hud.cut?'CUT OFF — ATTRITION':'SUPPLIED'}{hud.merged>1?` · LINKED ×${hud.merged}`:''}</span>}</div></section>
    <section className="inspector"><h3>TILE INSPECTOR</h3>{inspect?<><b>{TERRAIN_NAMES[simRef.current?.terrain[inspect.y*GAME_CONFIG.width+inspect.x]??0]} · {inspect.x}, {inspect.y}</b><dl><dt>Claim</dt><dd>{inspect.claim}</dd><dt>Control</dt><dd>{inspect.controller}{inspect.temporary?' · temporary':''}</dd><dt>Supply</dt><dd>{inspect.supplied}</dd></dl></>:<p>Move over the map</p>}</section>
    <div className="controls"><b>LEFT</b> select <span>·</span> <b>RIGHT-DRAG</b> draw route <span>·</span> <b>SHIFT + DRAG</b> pan <span>·</span> <b>SCROLL</b> zoom</div>
  </main>
}

