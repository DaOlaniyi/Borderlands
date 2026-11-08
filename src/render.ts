import { FACTIONS, GAME_CONFIG, Simulation, type Town } from './sim'

export type Camera = { x: number; y: number; zoom: number }
export const TILE = 22
const TERRAIN_NAMES = ['Water','Meadow','Forest','Mountains','River']

export class Renderer {
  private terrainCanvas = document.createElement('canvas')
  constructor(private sim: Simulation) { this.buildTerrain() }

  private buildTerrain() {
    const c=this.terrainCanvas;c.width=this.sim.w*TILE;c.height=this.sim.h*TILE;const x=c.getContext('2d')!
    const rnd=(i:number)=>((i*9301+49297)%233280)/233280
    for(let y=0;y<this.sim.h;y++)for(let xx=0;xx<this.sim.w;xx++){
      const i=y*this.sim.w+xx,t=this.sim.terrain[i],px=xx*TILE,py=y*TILE
      const base=t===0?'#0c5269':t===1?(rnd(i)>.5?'#a8a464':'#b4ae6c'):t===2?'#778953':t===3?'#837b6d':'#3b85a1'
      x.fillStyle=base;x.fillRect(px,py,TILE,TILE)
      if(t===0||t===4){x.strokeStyle='rgba(178,225,226,.1)';x.beginPath();x.moveTo(px,py+7+rnd(i)*5);x.lineTo(px+TILE,py+7+rnd(i)*5);x.stroke()}
      if(t===2){x.fillStyle='#315a3c';for(let k=0;k<3;k++){const ox=4+k*6,oy=7+(k%2)*5;x.beginPath();x.moveTo(px+ox,py+oy+7);x.lineTo(px+ox+4,py+oy-2);x.lineTo(px+ox+8,py+oy+7);x.fill()}}
      if(t===3){x.fillStyle='#514b48';x.beginPath();x.moveTo(px+2,py+18);x.lineTo(px+11,py+3);x.lineTo(px+20,py+18);x.fill();x.fillStyle='#c0b8a4';x.beginPath();x.moveTo(px+8,py+8);x.lineTo(px+11,py+3);x.lineTo(px+14,py+8);x.fill()}
      x.strokeStyle='rgba(30,43,34,.12)';x.strokeRect(px+.5,py+.5,TILE,TILE)
    }
  }

  screenToWorld(sx:number,sy:number,cam:Camera){return{x:(sx/ cam.zoom+cam.x)/TILE,y:(sy/cam.zoom+cam.y)/TILE}}

  draw(ctx:CanvasRenderingContext2D,width:number,height:number,cam:Camera,hover:{x:number,y:number}|null){
    ctx.clearRect(0,0,width,height);ctx.save();ctx.scale(cam.zoom,cam.zoom);ctx.translate(-cam.x,-cam.y)
    ctx.drawImage(this.terrainCanvas,0,0)
    this.drawTerritory(ctx)
    this.drawLandmarks(ctx)
    this.drawBubbleField(ctx)
    this.drawPaths(ctx)
    this.drawTowns(ctx)
    this.drawSquads(ctx)
    if(hover&&this.sim.isPassable(hover.x,hover.y)){ctx.strokeStyle='#f7e4a8';ctx.lineWidth=2/cam.zoom;ctx.strokeRect(hover.x*TILE+1,hover.y*TILE+1,TILE-2,TILE-2)}
    ctx.restore()
  }

  private drawTerritory(x:CanvasRenderingContext2D){
    for(let y=0;y<this.sim.h;y++)for(let xx=0;xx<this.sim.w;xx++){const i=y*this.sim.w+xx,f=this.sim.controller[i];if(!f)continue;x.globalAlpha=this.sim.occupation[i]?.24:.48;x.fillStyle=FACTIONS[f].color;x.fillRect(xx*TILE, y*TILE,TILE,TILE);const rival=this.sim.runnerUp[i],mix=this.sim.contest[i];if(rival&&mix>.08){x.globalAlpha=mix*.22;x.fillStyle=FACTIONS[rival].color;x.fillRect(xx*TILE, y*TILE,TILE,TILE)}}x.globalAlpha=1
    x.lineWidth=2.3;x.lineCap='round';x.lineJoin='round'
    for(let y=0;y<this.sim.h;y++)for(let xx=0;xx<this.sim.w;xx++){const i=y*this.sim.w+xx,f=this.sim.controller[i];if(!f)continue;x.strokeStyle=FACTIONS[f].dark;x.beginPath();if(xx===0||this.sim.controller[i-1]!==f){x.moveTo(xx*TILE,y*TILE);x.lineTo(xx*TILE,(y+1)*TILE)}if(y===0||this.sim.controller[i-this.sim.w]!==f){x.moveTo(xx*TILE,y*TILE);x.lineTo((xx+1)*TILE,y*TILE)}if(xx===this.sim.w-1||this.sim.controller[i+1]!==f){x.moveTo((xx+1)*TILE,y*TILE);x.lineTo((xx+1)*TILE,(y+1)*TILE)}if(y===this.sim.h-1||this.sim.controller[i+this.sim.w]!==f){x.moveTo(xx*TILE,(y+1)*TILE);x.lineTo((xx+1)*TILE,(y+1)*TILE)}x.stroke()}
  }

  private drawBubbleField(x:CanvasRenderingContext2D){
    const squadBubbles=this.sim.bubbles.filter(b=>b.kind==='squad')
    for(const b of squadBubbles){const px=b.x*TILE,py=b.y*TILE,r=b.radius*TILE,g=x.createRadialGradient(px,py,2,px,py,r);g.addColorStop(0,`${FACTIONS[b.faction].color}24`);g.addColorStop(.7,`${FACTIONS[b.faction].color}12`);g.addColorStop(1,`${FACTIONS[b.faction].color}00`);x.fillStyle=g;x.beginPath();x.arc(px,py,r,0,Math.PI*2);x.fill();if(b.joined){x.strokeStyle=`${FACTIONS[b.faction].color}78`;x.lineWidth=1.5;x.setLineDash([5,5]);x.beginPath();x.arc(px,py,r*.82,0,Math.PI*2);x.stroke();x.setLineDash([])}}
    for(let a=0;a<squadBubbles.length;a++)for(let b=a+1;b<squadBubbles.length;b++){const A=squadBubbles[a],B=squadBubbles[b],d=Math.hypot(A.x-B.x,A.y-B.y);if(A.faction===B.faction&&d<GAME_CONFIG.bubbleJoinDistance){x.strokeStyle=`${FACTIONS[A.faction].color}70`;x.lineWidth=5;x.beginPath();x.moveTo(A.x*TILE,A.y*TILE);x.quadraticCurveTo((A.x+B.x)*TILE/2,(A.y+B.y)*TILE/2-5,B.x*TILE,B.y*TILE);x.stroke()}}
  }

  private drawLandmarks(x:CanvasRenderingContext2D){
    // Decorative farms, workshop, bridges and alternate-route signposts.
    for(const [tx,ty] of [[22,24],[25,29],[52,21],[61,33]]){x.fillStyle='#d3b94c';x.fillRect(tx*TILE,ty*TILE,TILE*1.4,TILE*.7);x.strokeStyle='#81661f';for(let k=0;k<4;k++){x.beginPath();x.moveTo(tx*TILE+k*7,ty*TILE);x.lineTo(tx*TILE+k*7+9,ty*TILE+15);x.stroke()}}
    x.fillStyle='#ddc79a';for(const y of [24,40]){const rx=41+Math.round(Math.sin(y*.24)*2);x.fillRect(rx*TILE-3,y*TILE+5,TILE+6,12);x.strokeStyle='#5d4832';x.strokeRect(rx*TILE-3,y*TILE+5,TILE+6,12)}
  }

  private drawPaths(x:CanvasRenderingContext2D){for(const s of this.sim.squads)if(s.selected&&s.path.length){x.strokeStyle=s.routeDraft?'#72f0cf':'#fff0a6';x.lineWidth=s.routeDraft?4:3;x.setLineDash(s.routeDraft?[]:[7,5]);x.beginPath();x.moveTo(s.x*TILE,s.y*TILE);for(let k=s.routeDraft?1:s.pathStep;k<s.path.length;k++){const i=s.path[k],px=(i%this.sim.w+.5)*TILE,py=(Math.floor(i/this.sim.w)+.5)*TILE;x.lineTo(px,py)}x.stroke();x.setLineDash([])}}

  private drawTowns(x:CanvasRenderingContext2D){for(const t of this.sim.towns){const px=(t.x+.5)*TILE,py=(t.y+.5)*TILE,f=FACTIONS[t.faction]
    x.fillStyle='#ead8ac';x.strokeStyle='#392d29';x.lineWidth=2;x.fillRect(px-10,py-5,20,15);x.strokeRect(px-10,py-5,20,15);x.fillStyle='#71362c';x.beginPath();x.moveTo(px-13,py-5);x.lineTo(px,py-15);x.lineTo(px+13,py-5);x.fill();x.stroke()
    x.strokeStyle='#2c2522';x.beginPath();x.moveTo(px,py-15);x.lineTo(px,py-42);x.stroke();x.fillStyle=f.color;x.beginPath();x.moveTo(px,py-40);x.quadraticCurveTo(px+15,py-47,px+27,py-38);x.quadraticCurveTo(px+15,py-31,px,py-36);x.closePath();x.fill();x.stroke()
    x.fillStyle='rgba(10,17,22,.86)';x.font='bold 10px ui-sans-serif';x.textAlign='center';const tw=x.measureText(t.name.toUpperCase()).width+12;x.fillRect(px-tw/2,py+14,tw,16);x.fillStyle='#fff5d7';x.fillText(t.name.toUpperCase(),px,py+26)
    if(t.capture>0)this.drawCapture(x,t,px,py)
  }}

  private drawCapture(x:CanvasRenderingContext2D,t:Town,px:number,py:number){const p=Math.min(1,t.capture/GAME_CONFIG.captureDuration);x.fillStyle='rgba(9,15,19,.9)';x.fillRect(px-27,py-57,54,7);x.fillStyle=FACTIONS[t.captureBy].color;x.fillRect(px-26,py-56,52*p,5);x.fillStyle='#fff';x.font='bold 9px ui-sans-serif';x.fillText(`${Math.ceil(GAME_CONFIG.captureDuration-t.capture)}s`,px,py-61)}

  private drawSquads(x:CanvasRenderingContext2D){for(const s of this.sim.squads)if(!s.dead){const px=s.x*TILE,py=s.y*TILE,f=FACTIONS[s.faction]
    if(s.selected){x.strokeStyle='#fff3a9';x.lineWidth=3;x.beginPath();x.arc(px,py,16,0,Math.PI*2);x.stroke()}
    x.fillStyle=f.dark;x.strokeStyle='#f8e9bd';x.lineWidth=1.5;x.fillRect(px-9,py-9,18,18);x.strokeRect(px-9,py-9,18,18);x.beginPath();x.moveTo(px-6,py-6);x.lineTo(px+6,py+6);x.moveTo(px+6,py-6);x.lineTo(px-6,py+6);x.stroke()
    x.fillStyle='#5b1d19';x.fillRect(px-10,py+11,20,3);x.fillStyle='#75cf7a';x.fillRect(px-10,py+11,20*s.hp/100,3)
    if(s.cutOff){x.fillStyle='#ffcf67';x.font='bold 9px ui-sans-serif';x.textAlign='center';x.fillText('CUT OFF',px,py-15)}
    if(s.merged>1){x.fillStyle='#9ef4dc';x.font='bold 8px ui-sans-serif';x.textAlign='center';x.fillText(`LINK ×${s.merged}`,px,py+24)}
  }}
}

export { TERRAIN_NAMES }
