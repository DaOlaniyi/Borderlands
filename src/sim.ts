export const GAME_CONFIG = {
  width: 80,
  height: 52,
  townClaimRadius: 10,
  squadInfluenceRadius: 4.6,
  detachedInfluenceRadius: 1.8,
  movementSpeed: 3.15,
  captureDuration: 5,
  tickRate: 20,
  unitRadius: 0.48,
  combatDps: 12,
  cutOffAttritionDps: 0.7,
  bubbleJoinDistance: 4.25,
  bubbleAttraction: 0.18,
  routeSampleDistance: 1.15,
} as const

export type Terrain = 0 | 1 | 2 | 3 | 4 // water, plain, forest, mountain, river
export type Faction = { id: number; name: string; short: string; color: string; dark: string; flag: string; player?: boolean }
export type Town = { id: number; name: string; x: number; y: number; faction: number; captureBy: number; capture: number }
export type Squad = {
  id: number; faction: number; x: number; y: number; hp: number; path: number[]; pathStep: number;
  selected: boolean; supplied: boolean; cutOff: boolean; vx: number; vy: number; routeDraft: boolean;
  merged: number; aiTarget?: number; dead?: boolean
}
export type InfluenceBubble = { x:number; y:number; faction:number; radius:number; power:number; kind:'town'|'squad'; squadId?:number; joined:boolean }

export const FACTIONS: Faction[] = [
  { id: 0, name: 'Neutral', short: '—', color: '#9f9b7b', dark: '#5d604f', flag: '◇' },
  { id: 1, name: 'Tidewatch', short: 'TW', color: '#20c5bd', dark: '#087972', flag: '⚓', player: true },
  { id: 2, name: 'Amber Clan', short: 'AC', color: '#e8a11b', dark: '#995f08', flag: '♜' },
  { id: 3, name: 'Red March', short: 'RM', color: '#dc4b40', dark: '#8d241d', flag: '◆' },
  { id: 4, name: 'Plum League', short: 'PL', color: '#b54b8a', dark: '#6e2453', flag: '♛' },
]

const TOWN_NAMES = ['Tideford', 'Greymere', 'Westwatch', 'Sunreach', 'Redwater', 'Plumhold', 'Oakrest', 'Kon Gate']
const key = (x: number, y: number, w: number) => y * w + x
const xy = (i: number, w: number) => [i % w, Math.floor(i / w)] as const

export class Simulation {
  readonly w = GAME_CONFIG.width
  readonly h = GAME_CONFIG.height
  terrain = new Uint8Array(this.w * this.h)
  claimTown = new Int16Array(this.w * this.h).fill(-1)
  claimFaction = new Uint8Array(this.w * this.h)
  controller = new Uint8Array(this.w * this.h)
  occupation = new Uint8Array(this.w * this.h)
  runnerUp = new Uint8Array(this.w * this.h)
  contest = new Float32Array(this.w * this.h)
  suppliedTiles = new Uint8Array(this.w * this.h)
  bubbles: InfluenceBubble[] = []
  towns: Town[] = []
  squads: Squad[] = []
  time = 0
  power = 0
  day = 1
  selectedId = -1
  territoryDirty = true
  event = 'The frontier is quiet.'
  private aiClock = 0

  constructor(playerTowns = 1) {
    this.generateTerrain()
    this.spawn(playerTowns)
    this.recomputeClaims()
    this.recomputeControl()
  }

  isPassable(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false
    const t = this.terrain[key(x, y, this.w)]
    return t === 1 || t === 2 || (t === 4 && (y === 24 || y === 40))
  }

  private generateTerrain() {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const nx = (x - 39.5) / 38, ny = (y - 25.5) / 24
      const wobble = Math.sin(x * .34) * .045 + Math.sin(y * .51) * .035
      this.terrain[key(x, y, this.w)] = nx * nx + ny * ny < 1 + wobble ? 1 : 0
    }
    // Forest belts.
    for (const [cx, cy, rx, ry] of [[18,12,8,4],[25,38,7,4],[50,11,9,4],[62,38,8,5],[39,44,6,3]])
      for (let y = cy-ry; y <= cy+ry; y++) for (let x = cx-rx; x <= cx+rx; x++)
        if (this.inside(x,y) && this.terrain[key(x,y,this.w)] === 1 && ((x*7+y*11)%5)<3) this.terrain[key(x,y,this.w)] = 2
    // Mountain wall makes pathfinding and the alternate southern route visible.
    for (let x = 29; x <= 49; x++) {
      const y = 16 + Math.round(Math.sin(x * .7) * 2)
      for (let oy = -1; oy <= 1; oy++) if (this.inside(x,y+oy)) this.terrain[key(x,y+oy,this.w)] = 3
    }
    for (let x = 10; x < 21; x++) if (this.inside(x,31 + (x%3))) this.terrain[key(x,31+(x%3),this.w)] = 3
    // River divides the central front. Only two designated crossings are passable.
    for (let y = 5; y <= 45; y++) {
      const x = 41 + Math.round(Math.sin(y * .24) * 2)
      this.terrain[key(x,y,this.w)] = 4
      if (y !== 24 && y !== 40 && this.inside(x+1,y) && y%4===0) this.terrain[key(x+1,y,this.w)] = 4
    }
  }

  private inside(x:number,y:number) { return x>=0&&y>=0&&x<this.w&&y<this.h }

  private spawn(playerTowns: number) {
    const playerSpots = [[14,25],[21,20],[20,31],[28,26]]
    const aiSpots = [[54,25],[64,14],[65,37]]
    for (let i=0;i<playerTowns;i++) this.towns.push({id:this.towns.length,name:TOWN_NAMES[i],x:playerSpots[i][0],y:playerSpots[i][1],faction:1,captureBy:0,capture:0})
    aiSpots.forEach((p,i)=>this.towns.push({id:this.towns.length,name:TOWN_NAMES[i+3],x:p[0],y:p[1],faction:i+2,captureBy:0,capture:0}))
    // Exactly three starting player squads, irrespective of town count.
    ;[[15,25],[13,24],[14,27]].forEach((p,i)=>this.squads.push(this.makeSquad(1,p[0],p[1],i)))
    // One AI patrol per faction; the closest town (Sunreach) is deliberately undefended.
    this.squads.push(this.makeSquad(2,66,13,100))
    this.squads.push(this.makeSquad(3,61,39,101))
    this.squads.push(this.makeSquad(4,69,36,102))
  }

  private makeSquad(faction:number,x:number,y:number,id:number): Squad {
    return {id,faction,x,y,hp:100,path:[],pathStep:0,selected:false,supplied:true,cutOff:false,vx:0,vy:0,routeDraft:false,merged:1}
  }

  recomputeClaims() {
    this.claimTown.fill(-1); this.claimFaction.fill(0)
    const best = new Int16Array(this.w*this.h); best.fill(32767)
    // Per-town BFS means barriers and water matter; stable town ID resolves ties.
    for (const town of this.towns) {
      const qx = new Int16Array(this.w*this.h), qy = new Int16Array(this.w*this.h), qd = new Int16Array(this.w*this.h)
      const seen = new Uint8Array(this.w*this.h); let head=0,tail=0
      qx[tail]=town.x; qy[tail]=town.y; qd[tail++]=0; seen[key(town.x,town.y,this.w)]=1
      while(head<tail){ const x=qx[head],y=qy[head],d=qd[head++] ; const i=key(x,y,this.w)
        if(d<best[i] || (d===best[i] && town.id<this.claimTown[i])) {best[i]=d;this.claimTown[i]=town.id;this.claimFaction[i]=town.faction}
        if(d>=GAME_CONFIG.townClaimRadius) continue
        for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy,ni=key(nx,ny,this.w);if(this.isPassable(nx,ny)&&!seen[ni]){seen[ni]=1;qx[tail]=nx;qy[tail]=ny;qd[tail++]=d+1}}
      }
    }
    this.territoryDirty = true
  }

  recomputeControl() {
    const previous=this.controller.slice();this.controller.fill(0);this.occupation.fill(0);this.runnerUp.fill(0);this.contest.fill(0)
    const nearestTownDist = (s: Squad) => {
      let d=999; for(const t of this.towns) if(t.faction===s.faction) d=Math.min(d,Math.hypot(s.x-t.x,s.y-t.y)); return d
    }
    const bubbles:InfluenceBubble[]=this.towns.map(t=>({x:t.x+.5,y:t.y+.5,faction:t.faction,radius:GAME_CONFIG.townClaimRadius+1,power:3.2,kind:'town',joined:false}))
    for(const s of this.squads)if(!s.dead){s.merged=1;const townDist=nearestTownDist(s);const radius=Math.max(GAME_CONFIG.detachedInfluenceRadius,GAME_CONFIG.squadInfluenceRadius-townDist*.075)
      bubbles.push({x:s.x,y:s.y,faction:s.faction,radius,power:12.5+s.hp*.009,kind:'squad',squadId:s.id,joined:false})}
    // Same-side sources behave like soft metaballs. Their virtual centers pull together and
    // overlapping fields add, making connected regions wider than isolated bubbles.
    for(let a=0;a<bubbles.length;a++)for(let b=a+1;b<bubbles.length;b++){const A=bubbles[a],B=bubbles[b];if(A.faction!==B.faction)continue;const dx=B.x-A.x,dy=B.y-A.y,d=Math.hypot(dx,dy)||.001;const reach=(A.radius+B.radius)*.72;if(d<reach){A.joined=B.joined=true;const pull=GAME_CONFIG.bubbleAttraction*(1-d/reach);if(A.kind==='squad'){A.x+=dx/d*pull;A.y+=dy/d*pull}if(B.kind==='squad'){B.x-=dx/d*pull;B.y-=dy/d*pull}
        const sa=A.squadId===undefined?null:this.squads.find(s=>s.id===A.squadId),sb=B.squadId===undefined?null:this.squads.find(s=>s.id===B.squadId)
        if(sa?.cutOff&&sb?.cutOff&&d<GAME_CONFIG.bubbleJoinDistance){A.radius+=.8;B.radius+=.8;A.power+=1.15;B.power+=1.15;sa.merged++;sb.merged++}
      }}
    this.bubbles=bubbles
    for(let y=0;y<this.h;y++)for(let x=0;x<this.w;x++){const i=key(x,y,this.w);if(!this.isPassable(x,y))continue;const scores=[0,0,0,0,0]
      if(this.claimFaction[i])scores[this.claimFaction[i]]=1.05
      for(const b of bubbles){const d=Math.hypot(x+.5-b.x,y+.5-b.y);if(d>=b.radius)continue;const q=1-d/b.radius;scores[b.faction]+=b.power*q*q}
      if(previous[i])scores[previous[i]]+=.08
      let best=0,second=0;for(let f=1;f<scores.length;f++){if(scores[f]>scores[best]){second=best;best=f}else if(scores[f]>scores[second])second=f}
      if(scores[best]>.16){this.controller[i]=best;this.runnerUp[i]=second;const gap=scores[best]-scores[second];this.contest[i]=second?Math.max(0,Math.min(1,1-gap/.85)):0;this.occupation[i]=this.claimFaction[i]===best?0:1}
    }
    this.recomputeSupply()
  }

  private recomputeSupply() {
    this.suppliedTiles.fill(0)
    for(const f of FACTIONS.slice(1)){
      const q=new Int32Array(this.w*this.h);let head=0,tail=0
      for(const t of this.towns)if(t.faction===f.id){const i=key(t.x,t.y,this.w);if(this.controller[i]===f.id&&!this.suppliedTiles[i]){this.suppliedTiles[i]=f.id;q[tail++]=i}}
      while(head<tail){const i=q[head++],[x,y]=xy(i,this.w);for(const [dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(!this.inside(nx,ny))continue;const ni=key(nx,ny,this.w);if(this.controller[ni]===f.id&&!this.suppliedTiles[ni]){this.suppliedTiles[ni]=f.id;q[tail++]=ni}}}
    }
    for(const s of this.squads) if(!s.dead){const i=key(Math.max(0,Math.min(this.w-1,Math.floor(s.x))),Math.max(0,Math.min(this.h-1,Math.floor(s.y))),this.w);s.supplied=this.suppliedTiles[i]===s.faction;s.cutOff=!s.supplied}
    let power=0;for(let i=0;i<this.controller.length;i++)if(this.suppliedTiles[i]===1)power+=this.occupation[i]?0.5:1;this.power=Math.round(power)
  }

  selectAt(x:number,y:number) {
    let best: Squad|undefined, d=.9
    for(const s of this.squads)if(s.faction===1&&!s.dead){const nd=Math.hypot(s.x-x,s.y-y);if(nd<d){best=s;d=nd}}
    this.squads.forEach(s=>s.selected=false);this.selectedId=best?.id??-1;if(best)best.selected=true
    return best
  }

  issueMove(x:number,y:number) {
    const s=this.squads.find(v=>v.id===this.selectedId&&!v.dead);if(!s)return false
    const tx=Math.floor(x),ty=Math.floor(y);const path=this.findPath(Math.floor(s.x),Math.floor(s.y),tx,ty)
    if(path.length){s.routeDraft=false;s.path=path;s.pathStep=1;this.event=`${FACTIONS[s.faction].short} squad moving ${path.length-1} tiles.`;return true}return false
  }

  beginDrawRoute(x:number,y:number){
    const s=this.squads.find(v=>v.id===this.selectedId&&!v.dead);if(!s)return false
    const start=key(Math.floor(s.x),Math.floor(s.y),this.w);s.path=[start];s.pathStep=0;s.routeDraft=true
    this.extendDrawRoute(x,y);this.event='Drawing a maneuver route…';return true
  }

  extendDrawRoute(x:number,y:number){
    const s=this.squads.find(v=>v.id===this.selectedId&&!v.dead&&v.routeDraft);if(!s)return false
    const tx=Math.floor(x),ty=Math.floor(y);if(!this.isPassable(tx,ty))return false
    const last=s.path[s.path.length-1],[lx,ly]=xy(last,this.w);if(Math.hypot(tx-lx,ty-ly)<GAME_CONFIG.routeSampleDistance)return false
    const segment=this.findPath(lx,ly,tx,ty);if(segment.length<2)return false
    for(const tile of segment.slice(1))if(tile!==s.path[s.path.length-1])s.path.push(tile)
    return true
  }

  commitDrawRoute(x:number,y:number){
    const s=this.squads.find(v=>v.id===this.selectedId&&!v.dead&&v.routeDraft);if(!s)return false
    this.extendDrawRoute(x,y);s.routeDraft=false
    if(s.path.length>1){s.pathStep=1;this.event=`${FACTIONS[s.faction].short} squad following a drawn route.`;return true}
    s.path=[];s.pathStep=0;return false
  }

  findPath(sx:number,sy:number,tx:number,ty:number) {
    if(!this.isPassable(tx,ty))return []
    const n=this.w*this.h, start=key(sx,sy,this.w),goal=key(tx,ty,this.w)
    const came=new Int32Array(n);came.fill(-1);const g=new Float32Array(n);g.fill(Infinity);g[start]=0
    const open=[start];const inOpen=new Uint8Array(n);inOpen[start]=1
    while(open.length){let bi=0,bf=Infinity;for(let j=0;j<open.length;j++){const [x,y]=xy(open[j],this.w);const f=g[open[j]]+Math.abs(x-tx)+Math.abs(y-ty);if(f<bf){bf=f;bi=j}}
      const cur=open.splice(bi,1)[0];inOpen[cur]=0;if(cur===goal)break;const[x,y]=xy(cur,this.w)
      for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(!this.isPassable(nx,ny))continue;const ni=key(nx,ny,this.w);const cost=this.terrain[ni]===2?1.5:1;const ng=g[cur]+cost;if(ng<g[ni]){came[ni]=cur;g[ni]=ng;if(!inOpen[ni]){open.push(ni);inOpen[ni]=1}}}
    }
    if(came[goal]<0&&goal!==start)return[];const path:number[]=[];for(let cur=goal;cur>=0;cur=came[cur]){path.push(cur);if(cur===start)break}return path.reverse()
  }

  update(dt:number) {
    this.time+=dt;this.day=1+Math.floor(this.time/8);this.aiClock+=dt
    if(this.aiClock>2.5){this.aiClock=0;this.updateAI()}
    let moved=false
    for(const s of this.squads)if(!s.dead&&!s.routeDraft&&s.pathStep<s.path.length){const[tx,ty]=xy(s.path[s.pathStep],this.w);const gx=tx+.5,gy=ty+.5,dx=gx-s.x,dy=gy-s.y,d=Math.hypot(dx,dy);const speed=GAME_CONFIG.movementSpeed*(s.cutOff?.88:1)
      if(d<=speed*dt){s.x=gx;s.y=gy;s.pathStep++;if(s.pathStep>=s.path.length){s.path=[];s.pathStep=0;s.vx*=.3;s.vy*=.3}}
      else{const wobble=Math.sin(this.time*3.4+s.id*1.73)*.24,desiredX=dx/d*speed-dy/d*wobble,desiredY=dy/d*speed+dx/d*wobble,turn=Math.min(1,dt*5);s.vx+=(desiredX-s.vx)*turn;s.vy+=(desiredY-s.vy)*turn;let nx=s.x+s.vx*dt,ny=s.y+s.vy*dt;if(!this.isPassable(Math.floor(nx),Math.floor(ny))){nx=s.x+dx/d*speed*dt;ny=s.y+dy/d*speed*dt}s.x=nx;s.y=ny}moved=true}
    this.resolveCollisionsAndCombat(dt)
    this.applyCutOffAttrition(dt)
    this.updateCaptures(dt)
    if(moved||this.territoryDirty){this.recomputeControl();this.territoryDirty=false}
  }

  private applyCutOffAttrition(dt:number){for(const s of this.squads)if(!s.dead&&s.cutOff){s.hp-=GAME_CONFIG.cutOffAttritionDps*dt;if(s.hp<=0){s.dead=true;s.selected=false;this.event=`A ${FACTIONS[s.faction].short} squad was lost out of supply.`;this.territoryDirty=true}}}

  private resolveCollisionsAndCombat(dt:number){
    for(let a=0;a<this.squads.length;a++)for(let b=a+1;b<this.squads.length;b++){const A=this.squads[a],B=this.squads[b];if(A.dead||B.dead)continue;let dx=B.x-A.x,dy=B.y-A.y,d=Math.hypot(dx,dy)||.001;const min=GAME_CONFIG.unitRadius*2;if(d<min){const push=(min-d)/2;dx/=d;dy/=d;A.x-=dx*push;A.y-=dy*push;B.x+=dx*push;B.y+=dy*push;if(A.faction!==B.faction){A.hp-=GAME_CONFIG.combatDps*dt;B.hp-=GAME_CONFIG.combatDps*dt;this.event='Border skirmish underway.'}}}
    for(const s of this.squads)if(s.hp<=0&&!s.dead){s.dead=true;s.selected=false;if(this.selectedId===s.id)this.selectedId=-1;this.territoryDirty=true}
  }

  private updateCaptures(dt:number){
    for(const t of this.towns){const occupiers=this.squads.filter(s=>!s.dead&&s.faction!==t.faction&&Math.hypot(s.x-(t.x+.5),s.y-(t.y+.5))<.85)
      if(!occupiers.length){t.capture=Math.max(0,t.capture-dt*1.5);t.captureBy=0;continue}
      const by=occupiers[0].faction;const opposed=this.squads.some(s=>!s.dead&&s.faction===t.faction&&Math.hypot(s.x-(t.x+.5),s.y-(t.y+.5))<2.3)||occupiers.some(s=>s.faction!==by)
      if(opposed){t.captureBy=by;t.capture=Math.max(0,t.capture-dt*.5);continue}
      if(t.captureBy!==by){t.captureBy=by;t.capture=0}t.capture+=dt
      if(t.capture>=GAME_CONFIG.captureDuration){const old=t.faction;t.faction=by;t.capture=0;t.captureBy=0;this.event=`${FACTIONS[by].name} captured ${t.name} from ${FACTIONS[old].name}.`;this.recomputeClaims()}
    }
  }

  private updateAI(){
    for(const s of this.squads)if(s.faction>1&&!s.dead&&s.path.length===0){const own=this.towns.filter(t=>t.faction===s.faction);if(!own.length)continue;const home=own[s.id%own.length];const angle=((this.time*.13+s.id)*2.1)%(Math.PI*2);let tx=Math.round(home.x+Math.cos(angle)*6),ty=Math.round(home.y+Math.sin(angle)*6)
      // AI 2 occasionally pushes west, but never defends the deliberately exposed town.
      if(s.faction===2&&Math.sin(this.time*.15)>0.5){tx=48;ty=24}
      const p=this.findPath(Math.floor(s.x),Math.floor(s.y),tx,ty);if(p.length){s.path=p;s.pathStep=1}}
  }

  inspect(x:number,y:number){if(!this.inside(x,y))return null;const i=key(x,y,this.w),town=this.claimTown[i]>=0?this.towns[this.claimTown[i]]:null;return{x,y,terrain:this.terrain[i],claim:town?`${town.name} · ${FACTIONS[town.faction].name}`:'Unclaimed',controller:FACTIONS[this.controller[i]].name,supplied:this.suppliedTiles[i]?`Yes · ${FACTIONS[this.suppliedTiles[i]].short}`:'No',temporary:!!this.occupation[i]}}
}

