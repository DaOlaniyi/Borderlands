// Copies the subset of the Tiny Swords pack used by the game into public/assets/ts.
// The original pack folder is only read, never modified.
import { cpSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'Art Assets - Tiny Swords/Tiny Swords (Free Pack)'
const DST = 'public/assets/ts'
const colors = ['Black', 'Blue', 'Purple', 'Red', 'Yellow']
const files = [
  ...['Tilemap_color1.png', 'Water Background color.png', 'Water Foam.png', 'Shadow.png'].map(f => `Terrain/Tileset/${f}`),
  ...[1, 2, 3, 4].flatMap(i => [`Terrain/Resources/Wood/Trees/Tree${i}.png`, `Terrain/Resources/Wood/Trees/Stump ${i}.png`, `Terrain/Decorations/Bushes/Bushe${i}.png`, `Terrain/Decorations/Rocks/Rock${i}.png`]),
  'Terrain/Resources/Wood/Wood Resource/Wood Resource.png',
  ...['Explosion_01', 'Explosion_02', 'Water Splash', 'Fire_01', 'Fire_02', 'Dust_01'].map(f => `Particle FX/${f}.png`),
]
for (const c of colors) {
  for (const b of ['House1', 'House3', 'Barracks', 'Tower']) files.push(`Buildings/${c} Buildings/${b}.png`)
  for (const a of ['Idle', 'Run', 'Shoot']) files.push(`Units/${c} Units/Archer/Archer_${a}.png`)
  files.push(`Units/${c} Units/Archer/Arrow.png`)
  for (const l of ['Idle', 'Run', 'Right_Defence', 'Right_Attack', 'Down_Attack', 'Up_Attack', 'DownRight_Attack', 'UpRight_Attack']) files.push(`Units/${c} Units/Lancer/Lancer_${l}.png`)
  for (const w of ['Idle', 'Run', 'Attack1', 'Attack2', 'Guard']) files.push(`Units/${c} Units/Warrior/Warrior_${w}.png`)
  for (const p of ['Idle', 'Run', 'Interact Axe', 'Interact Hammer', 'Idle Wood', 'Run Wood']) files.push(`Units/${c} Units/Pawn/Pawn_${p}.png`)
}
const dirs = ['UI Elements/UI Elements/Buttons', 'UI Elements/UI Elements/Icons', 'UI Elements/UI Elements/Papers', 'UI Elements/UI Elements/Bars', 'UI Elements/UI Elements/Banners']
let n = 0
for (const f of files) {
  const from = join(SRC, f)
  if (!existsSync(from)) { console.error('missing', from); process.exitCode = 1; continue }
  const to = join(DST, f); mkdirSync(join(to, '..'), { recursive: true }); cpSync(from, to); n++
}
for (const d of dirs) { mkdirSync(join(DST, d), { recursive: true }); cpSync(join(SRC, d), join(DST, d), { recursive: true }); n++ }
// ship sprites (public/assets/ships) are generated from references/ by: python3 scripts/make-ships.py
console.log(`synced ${n} entries to ${DST}`)
