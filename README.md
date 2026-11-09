# Borderlands Online — Territory Prototype

A browser strategy prototype built around a tile-based territory system: units walk freely in continuous space, but ownership, supply and borders are evaluated on a logical 64 × 64 grid. React handles the menu and HUD; the world is drawn with Canvas 2D using the Tiny Swords art pack.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # vitest (195 tests)
npm run build        # tsc -b && vite build
```

The world is a **200 × 200 archipelago** shared by **10–15 kingdoms** (the count comes from the seed; the menu no longer asks): two or three great land masses about as big as the largest old 8-kingdom island, several medium and small islands, and scattered islets. You can start anywhere — on a great land mass, a medium island or a lone small one: conquer it, then build boats. (The old single-island generator `generateWorld` is kept for tests.)

Useful URL parameters: `?seed=ABC&color=teal&towns=3&lumber=2000` starts that exact match immediately (`kingdoms=12` overrides the seed-derived count; your starting towns 1–5); in dev builds `?cam=tileX,tileY,zoom` looks at a spot and `?demo=ships` drops ships beside your coast; `?debug=1` shows the performance overlay (also toggled with the backtick key) and exposes `window.__borderlands` for inspection.

Art is copied from `Art Assets - Tiny Swords/` into `public/assets/ts/` by `node scripts/sync-assets.mjs` (the original pack is only read, never modified).

## Controls

- Press a unit and drag in the same gesture to draw a route; release to commit. A click only selects. **Shift-click** adds units to the selection and every selected unit follows the route you draw. All friendly routes stay visible (the selection is highlighted) so you can coordinate.
- Press and drag empty land or water to pan. Scroll to zoom around the cursor (you can zoom far out over the open ocean).
- Selection bar (bottom): name, type, HP, **Block** (or `B`), **Create Squad / Merge** (needs 2+ selected units of one type, all at 100 % HP, 5 members max) and **Break**.
- Top left: your kingdom (click the name to rename it), Level, towns / lumber / Power / population, and three **production toggles** (warrior 40, archer 20, lancer 30 Power). Green = produce one every 10 s while there is room and Power; several greens are picked at random.
- Right: every kingdom with its relation to you (Allied / Neutral / In Conflict / At War) and an **Ally** button for neutral kingdoms with a clean history. Bottom right: **Shop** — Tower (30 lumber) and Lot (200 lumber, +1 troop capacity, one per town): click the item, then a free tile of your territory (shift keeps placing, `Esc` cancels). A dashed line links every tower/lot to the town it belongs to.
- Selecting an archer shows a dashed-circle button that toggles the strike-range ring of *that selected archer* (for an archer in a tower: one equal-radius circle around the tower's centre).
- **S** stops movement: it stops the selected units, even while you are still dragging a route (the order is cancelled and releasing the mouse does nothing). **C** toggles the selection brush: the cursor becomes a hollow circle, paint over units to select several, press C again, then draw one route for all of them. A route you give always outranks instincts (chasing, fleeing arrows); units only stop to fight enemies directly in their way.
- Trees fade to 25 % opacity while a unit is behind (or beside) their canopy, so units in forests stay visible.
- Archers: drag one onto a finished tower (anywhere on its sprite) to climb in; click the tower to select the archer inside, then press **Leave tower** or draw a route to send it out (it will not hop straight back in for a few seconds).
- The Kingdoms list, the conflict/war tabs and the Shop each have a **–/+** button to minimise them. **Click a nation** in the list to draw thin arrows on the map from it to everything it is at war with (red), in conflict with (yellow) or allied to (green); click again to clear. The **eye** on an alliance recolours the whole bloc in its strongest member's colour.
- The **NONE / LOW / MED / HIGH / UNLIMITED** button beside the lumber count sets pawn tree extraction: none = no cutting; low = very slow, stops above 99 lumber; med = normal, stops above 300; high = fast, stops above 500; unlimited = fast until no trees remain. Pawns you order to a tree ignore the cap.
- Right panel: each kingdom shows its territory size in tiles (counted once per territory recompute, not per frame) and, below the list, a tab per conflict/war — yours show LOSSES / KILLS, AI-versus-AI tabs show each side's losses.
- Select a pawn, then click a tree to send it there (it delivers any carried lumber first). Click a tower to select the archer inside; drag from it to send the archer out.

- **Towns**: click one of **your** towns to select it — the panel shows its health and a **Producing troops / Production off** toggle, so you decide where new units spawn (production only comes from towns that are on). Click an **enemy** town to select it; the panel shows its objective, **CAPTURE** (default: take it intact when it is undefended) or **RAZE** (your troops attack the town itself and destroy it completely, denying the enemy its land, supply and structures). Click an enemy town again, or the button, to switch; razed towns show a red RAZE badge. Towns have **3× the health of an archer tower** (8,100 HP) and mend slowly while no hostile unit is within 8 tiles.
- **Cancel construction**: click an unfinished tower, lot or ship — the panel shows its progress and a **Cancel build** button that refunds the lumber not yet spent.
- A selected, injured troop standing in the healing radius of its own town shows a **green plus** beside its health bar (it mends 2.5× faster there).
- **Ships** (Shop → Boat 50 lumber / Zumwalt 300 lumber): click the shop item, then click open water within ~2 tiles of your own shoreline; a pawn builds it from the shore. Select a ship and **drag from it** to draw a sailing route (ships go anywhere on the sea, territory does not matter). Finish the route beside a coast and the ship lies there for **5 seconds** (a ring fills) before it **moors**; fire from towers or troops resets the timer, and enemy troops standing near the landing spot hold the ship off (the ring turns red). **Every friendly ship's route stays drawn** whether or not it is selected. While docked, drag troops onto it to **board** (they leave your troop count while aboard); **Unload** lands everyone beside the dock. A Zumwalt shows three **Target** buttons at the bottom of the screen: **Ships** (default) / **Buildings** / **Troops**. **M** mutes the sound effects.

## Rules

- **Lumber stays with the town**: pawns deposit into the town they work for; when a town is captured its stock (and any load a pawn was carrying) passes to the captor, and a razed town's stock goes to the razers. Spending draws every town's stock down in proportion.

- **Agitation & diplomacy (AI only; you have no bar)** — every AI kingdom has a 0–100 % bar (thin bar in the kingdom list, plus a sword icon when on alert):
  - *Foreign wars* feed it slowly: ~5 min to reach 25 % for nearby nations (0.083 %/s) and 15 % for distant ones (0.05 %/s); total war counts double, conflicts half; it drains when nothing is going on. A kingdom under attack sits at ≥ 55 %.
  - *A fallen town* spikes every other AI kingdom at once: +25 % within ~12 tiles, shrinking to +10 % at 50+ tiles.
  - *Balance of power*: with ≥ 3 nations (alliance blocs count as one, and so do you), one nation holding more towns than all the rest combined sends everybody to 100 % at once; holding 40 %+ marks the island "tipped" and slowly agitates the rest.
  - *At 35 %+* a kingdom goes on **alert**: its troops mass at the border toward the trouble and it raises its tower cap from 3 to 5 and builds faster. *Above 40 %* it has a growing chance (up to ~2 %/s) to react: attack a smaller or comparable neighbour (never a bigger one) — shown at the bottom as `SPILLOVER : X DECLARES WAR ON Y` — or, if the island is tipping or no prey exists, propose an alliance against the strongest nation. The partner accepts if it is agitated, cooperative, or under attack, and the new bloc immediately declares war on that nation. Blocs have no size limit, do not bully smaller neighbours, auto-join each other's wars, and dissolve once the nation they formed against is destroyed. There are no alliances at the start of a match.
  - *Pacing*: AI kingdoms never start wars in the first 5 minutes, react less often (≤ 0.6 %/s at 100 %, 4 min cooldown), and the island tolerates only about one war per three AI kingdoms at a time; AI-versus-AI conflicts escalate to war slowly (5 deaths or 6 minutes). At most two AI pairs begin in conflict, and every AI conflict gets a tab immediately that becomes a war tab as it escalates.
  - *Allies* defend themselves first, then use spare troops (~40 %) to defend threatened allies, then pursue their own objectives. You cannot ally with an alliance if you are at war with one of its members. A nation with no towns and no troops leaves its alliance, and a two-nation alliance closes with it.
  - *Allies* are listed as one bloc (`A and B`, pooled resources shown), keep their own units and resources, can stand in each other's land without border warnings, cut-off damage or deforming each other's territory, and cannot control each other. Your **Ally** button works at any time but is unlikely early, likelier as the receiver gets agitated, and certain if it is under attack; **Break** dissolves an alliance.

Vegetation only sways when the camera is zoomed in (`SWAY_ZOOM = 0.75` in `config.ts` — zoom values grow as you move closer, so your “0.40 or less” would have swayed only when zoomed *out*; change the constant if you want a different threshold).

- **Colours and emblems**: **20 kingdom colours** (`src/game/palette.json`, the single source of truth). You pick yours in the menu; the five native Tiny Swords colours (Blue, Red, Yellow, Purple, Black) are listed first as *Recommended*, the other 15 (Green, Orange, Teal, Pink, White, Brown, Lime, Navy, Maroon, Sky, Forest, Magenta, Olive, Silver, Indigo) below. Non-native colours are made at run time from the Blue sprites: only pixels that differ between the five native families *and* lie in the blue hue band are re-hued / re-saturated / re-lit, frame by frame the first time each is drawn (so the cost is tiny and nothing is pre-baked). `python3 scripts/palette-preview.py` renders every colour on the real sprites for judging by eye. Each kingdom also flies a unique **banner emblem** (10 shapes × shield/disc frame = 20) shown above its towns and ships (growing as you zoom out so it stays readable) and in the kingdom list — a second identifier for colour-blind players and for colours that sit close together.
- **World** (legacy single-island rules, used by tests): islands are 56–84 tiles across inside a 30-tile margin of open ocean. 2–8 kingdoms. Each AI kingdom gets 1–5 towns; kingdom strength varies, but **neighbours are kept within one town of each other** (two in 6–8 kingdom games) (a spatially smooth strength field plus a relaxation pass), so a big kingdom borders other big ones and a small one other small ones; on *Auto* you are never the weakest. The menu also lets you **pick your own starting town count (1–4)** and rivals are balanced around it. Every town starts with 2 units; the third is yours to produce. AI kingdoms with 4+ towns get a **Barracks** (capacity 5, radius 13, stronger influence). Every town has **two pawns**.
- **Territory** (`TerritorySystem.ts`, constants in `config.ts`): towns reach 11 tiles; units claim a radius‑2 square around their current tile and only change source when entering a new tile. Only sources whose reach covers a tile compete; strength is `weight × (1 − d/falloff)`. Friendly overlap stacks 1.0 / 0.5 each (capped at 2.5×); squads count once per member. **Every unit always owns a guaranteed 2×2 patch (and its own tile)** even deep in enemy land, so an isolated unit is always a visible pocket. Nothing is painted and left behind.
- **Supply & attrition**: 4‑directional flood fill from each faction's towns through its own tiles. Supply flows across an alliance bloc's land, so a unit stepping from an ally's territory into enemy or free ground stays supplied. A unit on an unsupplied tile has a **20 s grace period**, after which it loses 1.2 % of its max HP per second (and cannot regenerate) — **multiplied by 1.25 for every additional unit in the same cut-off pocket** (a pocket is a connected region of unsupplied tiles; clamped to 2× in total, `TERRITORY.pocketMaxMult`), so a big army trapped together dies faster than a lone raider, and a cut-off army can be surrounded and destroyed.
- **Healing**: units regenerate 0.4 % max HP/s whenever no hostile unit is within 5 tiles, 2.5× faster within 2 tiles of an owned town.
- **Towns**: captured the moment a hostile unit touches them **unless an owner's unit stands within 2 tiles** (the same radius that heals). You are only defeated when you have no towns *and* no units; units in allied territory are sheltered (no cut-off or over-capacity damage), so a town-less player can run to an ally. Losing your last town does *not* kill your units — they just have no territory/supply and take damage, and can retake the town. The game is open-ended: there is no victory screen, only defeat when you have no towns and no units.
- **Relations** (`Diplomacy.ts`): you start Neutral with every AI kingdom. Neutral and Allied kingdoms never fight and cannot capture each other's towns. A unit that takes tiles off a neutral kingdom turns relations to **In Conflict**. Conflict cools back to Neutral after 90 quiet seconds; a conflict that drags on 120 s or costs two lives can be escalated by an AI into **At War**, which is permanent. AI↔AI relations start random and follow the same rules. AI units only enter foreign territory when attacking a hostile town (or an ambitious kingdom provoking a neutral neighbour after 150 s).
- **Units** (px/s; 64 px = 1 tile): Warrior 900 HP, 32 px/s (5 tiles ≈ 10 s), melee, 38.4 damage. Archer 225 HP (25 %), 64 px/s (5 tiles ≈ 5 s), 6-tile range, 16 damage, shoots only while standing, cannot block. Lancer 324 HP (36 %), 40 px/s, ~1.5-tile reach, strikes every 2 s and glides the target back a tile (0.22 s ease-out, never a teleport); the shoved unit re-focuses and chases. Idle melee units chase hostiles within 3 tiles. Newly produced units start at 1 HP and recover through normal regeneration (2.5× faster beside a town) — not instantly. Animations play at the pack's native 10 fps (100 ms frames, read from the .aseprite files).
- **Routes survive combat**: a unit with a route stops only for hostiles in its way (ahead of it), fights them until they die or move off, then continues to the end of the path; hostiles behind it never stop a retreat. Waypoints count as reached inside 26 px (12 px at the end) and a stall detector skips unreachable points, so units never get stuck creeping toward a spot.
- **Squads**: Create Squad / Merge combine same-type full-health units (max 5) into one unit with n× health, damage and territory weight that dies when the joint HP is gone. Break returns the members with the squad's remaining HP fraction each.
- **Damage**: a unit's damage is scaled by `max(0.2, health fraction)` — at 80 % health a 100-damage unit deals 80, at 20 % or below it deals 20. Warriors deal 38.4 per hit (+60 %).
- **Existential threat**: when one nation (a kingdom or an alliance bloc — the player counts) holds **more towns than everybody else combined**, every other living AI kingdom lays down its quarrels, joins one alliance and goes to war with the giant — immediately and with no dice (`rallyAgainstThreat`). It applies to a runaway AI as well as to you.
- **Towers captured with their town**: a garrison that belonged to the old owner climbs out and retreats to the nearest friendly supplied ground (it stays and fights as a normal unit if there is none); it never shoots the tower it occupies.
- **Ships** (new rules): the Zumwalt costs **300**; its cannons are on **one side** of the hull, so it swings that broadside toward its target (a quarter-turn per 0.7 s; drawn upside down for a north-facing broadside) and shells leave the **muzzle** of the way it points. **Any enemy troops in reach can hit a ship at sea**: melee troops strike hulls close to the shore, archers and tower garrisons shoot them (a ship never lands under steady fire). Troops aboard a ship do not fight. A kingdom with **no towns left** may keep 2 troops per ship (boat or Zumwalt), up to 5, without over-capacity damage — otherwise ships add no capacity (they only keep troops out of the count while aboard). *Ambush*: an idle unit hit by shells out of nowhere (not fighting another unit, no order) retreats beyond the ship's range, then rushes back to the beach to keep it from landing; AI kingdoms send idle troops to hold the beach against any non-allied ship, and a ship mooring on a peaceful kingdom's shore is a border violation (In Conflict). Rest of the original description:
  *Infantry boat* — half a warrior's HP, carries 5, no weapons. *Zumwalt* — an archer's HP, carries 8, cannons reach 15 tiles: bursts of **two shells 0.5 s apart, 3 s between volleys**, each shell 2.5× a warrior's damage up close falling linearly to 10 % at maximum range; it fires only while at sea and picks targets by the chosen priority (Ships → Buildings → Troops by default; enemy towns only when you set them to RAZE). Ships move at an archer's walking speed. A **docked ship is a mini town**: it claims about 6 tiles of friendly territory and supply around its mooring; land units can attack a docked ship (a ship at sea is out of their reach), and a Zumwalt cannot fire while docked. A ship sunk at sea loses everyone aboard; a docked one lets the crew wade ashore.
- **AI navy**: an AI kingdom at war with a kingdom on *another land mass* builds up to two boats (never in a landlocked lake) that load idle healthy troops, land them at a spot away from enemy towers and troops (trying another spot if the beach is held) and sail home for more; troops that land march on the enemy towns of *that* land. **Large nations** (4+ towns) keep a fleet of Zumwalts (one per 3 towns, at most 5) — but only after every town has its lot and the tower quota is met; to afford one they switch pawn harvesting to *unlimited* until they can pay, then switch back. Zumwalts spread out to stations off the nearest enemy town. A kingdom that has the whole of its land mass to itself eventually declares war on a nearby kingdom overseas; a kingdom with no towns left loads its survivors into boats to retake one elsewhere. Invasions are contested: coastal towers and troops sink many landing boats.
- **AI idling**: no AI unit stays frozen — a block pose lasts at most 25 s (then a 30 s cool-down; lingering threats are attacked instead), last-stand / garrison / bridge holds expire, and an attacker whose target cannot be reached over land tries the next-nearest enemy town.
- **Effects**: hit sparks, ship explosions and splashes (from the Particle FX sheets), a screen shake when a town is captured or razed, and synthesised sound effects (WebAudio, no files). Far out, the map draws fewer trees and no stumps, shrubs or rocks.
- **Ship art**: `python3 scripts/make-ships.py` (needs Pillow, NumPy, SciPy) cuts the four orientations out of `references/Small Infantry Boat.png` and `references/Zumwalt Ship.png` and writes the blue originals into `public/assets/ships/`; the game recolours them (and the units and buildings) for every kingdom colour at load time.
- **Block**: stationary, guard animation, 90 % less damage; a blocker occupies twice the usual personal space (64 px vs 32), hostile units cannot enter it, friendly/neutral ones pass. A new order leaves block mode. Blockers do not attack.
- **Population & Power**: capacity is 3 per town (5 per barracks, +1 per finished lot). **Power income is your free capacity per second** (capacity − troops): a full army earns nothing, a depleted one rebuilds faster. Units above capacity (or after losing towns) take damage, newest first. Archers garrisoned in towers do not count.
- **Towers & lots**: built by a pawn (tower 30 lumber / 30 s, lot 200 lumber / 40 s; a busy pawn is pulled off its tree). **Under construction a structure has one hit point per wood placed**, so an unfinished tower dies to a single blow; finished towers have 2700 HP (3× a warrior). Each belongs to the nearest town of its owner and **changes hands when that town is captured** (a garrisoned archer stays inside until moved out, killed, or the tower is destroyed). An archer inside a tower (it stands full-size in the middle of the platform) shoots 2× as far, and its arrows hit 2× as hard within one tile of the tower, falling off linearly to 1× at maximum range; destroying the tower kills the archer. Archers react to being shot: healthy idle melee units charge the shooter (or tower), badly hurt ones back away.
- **Pawns**: no influence, no fighting; `wander → seek-tree → travel-to-tree → chopping → carrying → return-to-town → deposit` plus `retreat` and `travel-to-build → building`. Tree1/2 take 150 s for 20 lumber, Tree3/4 take 60 s for 10, leaving permanent stumps. Lumber is banked only on delivery.
- **AI** (`AISystem.ts`): rests new/wounded units until 45 % health; at war sends the healthiest 60–80 % of its troops (50 % in a mere conflict) at the enemy town nearest to its reach; presses on while cut off unless below 40 % health or cut off for 30 s; **dashes** at lightly guarded towns accepting the supply risk, holds them if captured, and falls back from resistance; builds border towers (3 normally, 5 on alert; never on the exact front line or beside active fighting) that come with a *free archer* which runs in to man them (not counted against the cap), one lot per town; favours warriors and lancers (4:3:2 with archers) and keeps its archers behind the melee line, skirting away from anything that closes in; wounded units near an overwhelmed town make a **last stand** (blocking in front of it, healing at the town rate) until they recover ~20 points or the enemy withdraws; a war elsewhere that drags on makes idle neutral kingdoms steadily bolder, preferring weaker neighbours; a kingdom that has lost twice its troop capacity in a war declares **Total War** (no reconciliation);  assaults use a cautious **bridge** technique — when a group is cut off and falls back, the first member to reach friendly supplied ground far from home stays put as a bridge (its influence extends supply) while the rest strike again, up to 4 bridges and always one pusher; replans every ~1.4 s per kingdom; defends threatened towns (blocking at the gate), holds a frontline on its own land, attacks the most exposed *hostile* town, reconnects cut-off units, and an exiled kingdom marches on the nearest town to retake it. No hidden bonuses. Deliberately simple for now.
- Units get one of 100 medieval names; kingdoms have a name and a level (Clan 1–3 towns, Village 4–5, Tribe 6–10, Kingdom 11–20, Empire 21+).

## Architecture

```
src/game/
  config.ts          all tuning constants
  rng.ts             seeded PRNG + hash noise
  WorldGenerator.ts  island mask, town placement, trees/decor
  Autotile.ts        flat-ground tile 1–16 selection
  TerritorySystem.ts competition, supply flood fill, border edges
  Game.ts            state, fixed-step loop, orders, captures, squads, towers
  Diplomacy.ts       relations: allied / neutral / conflict / war
  names.ts           100 unit names, kingdom names, tier titles
  MovementSystem.ts  look-ahead path follower, separation, blocker zones
  CombatSystem.ts    melee / ranged / lancer state machine, towers, knockback
  PawnSystem.ts      lumber loop
  AISystem.ts        low-frequency strategic planner
  Routes.ts          RDP simplification, land clipping/detours, Chaikin smoothing
  InputController.ts DOM-free pointer logic (tested)
  Camera.ts / Grid.ts / SpatialHash.ts
  AssetLoader.ts / SpriteAnimator.ts / Renderer.ts
src/app/             React menu, HUD, canvas glue
src/tests/           vitest suites
```

The simulation never touches React state: the HUD snapshot is pulled 5×/s.

## Rendering

Layer order: water pattern → animated foam → cached ground chunks → territory tint (one pixel per tile, scaled with smoothing off) → hatching for unsupplied tiles → border paths → grid → y‑sorted trees/stumps/bushes/rocks/towns/pawns/warriors → selection, routes and block rings → screen-space Block button. Ground is baked in 8 × 8 tile chunks (512 px) on demand and only visible chunks are drawn; foam and sprites are culled to the viewport. Territory/border/hatch paths are rebuilt only when `territoryVersion` changes. Trees are drawn dynamically from tree state, so a stump appears the moment a tree is cut without invalidating any chunk. Pixel art uses `imageSmoothingEnabled = false`, integer device rectangles for chunks, and DPR capped at 2.

## Asset paths and measured metadata

All under `Art Assets - Tiny Swords/Tiny Swords (Free Pack)/` (mirrored in `public/assets/ts/`). Frame counts are derived as `sheetWidth / frameWidth` at load time.

| Asset | File | Size | Frames |
|---|---|---|---|
| Ground | `Terrain/Tileset/Tilemap_color1.png` | 576×384 | 64 px cells; flat tiles 1–16 in a 4×4 block |
| Water | `Terrain/Tileset/Water Background color.png` | 64×64 | pattern |
| Foam | `Terrain/Tileset/Water Foam.png` | 3072×192 | 16 × 192 |
| Trees | `Terrain/Resources/Wood/Trees/Tree1–2.png` / `Tree3–4.png` | 1536×256 / 1536×192 | 8 × 192 |
| Stumps | `Stump 1–4.png` | 192×256 | 1 |
| Bushes / rocks | `Decorations/Bushes/Bushe1–4.png` / `Rocks/Rock1–4.png` | 1024×128 / 64×64 | 8 × 128 / 1 |
| Towns | `Buildings/<Colour> Buildings/House1.png` | 128×192 | 1 |
| Warrior | `Units/<Colour> Units/Warrior/Warrior_{Idle,Run,Attack1,Attack2,Guard}.png` | 192 high | Idle 8, Run 6, Attack 4, Guard 6 |
| Archer | `Units/<Colour> Units/Archer/Archer_{Idle,Run,Shoot}.png`, `Arrow.png` | 192 high / 64×64 | Idle 6, Run 4, Shoot 8 |
| Lancer | `Units/<Colour> Units/Lancer/Lancer_{Idle,Run,Right_Defence,Right/Down/Up/DownRight/UpRight_Attack}.png` | 320 high | Idle 12, Run 6, Defence 6, Attack 3 |
| Barracks / Tower | `Buildings/<Colour> Buildings/{Barracks,Tower}.png` | 192×256 / 128×256 | 1 |
| Pawn | `Pawn_{Idle,Run,Interact Axe,Interact Hammer,Idle Wood,Run Wood}.png` | 192 high | 8 / 6 / 6 / 3 / 8 / 6 |
| UI | `UI Elements/UI Elements/{Buttons,Icons,Papers,...}` | — | round buttons, shield/log/sword icons, nine-slice paper & buttons |

`Shadow.png` (192×192) is copied but unused: this prototype has a single elevation plane. HUD panels and menu buttons are CSS `border-image` built at runtime from the paper/button nine-slice sheets.

## Performance

Measured by `src/tests/perf.test.ts` (Node, Apple silicon) on a maximum-size 143 × 138 world (an ~80-tile island in open ocean) with 5 kingdoms, 12 towns and 36 units converging on the centre for 60 simulated seconds: generation ≈ 9 ms, simulation step avg ≈ 0.16 ms (p95 ≈ 0.5 ms, max ≈ 2 ms), territory recompute avg ≈ 0.5 ms (≈ 420 recomputes). `src/tests/soak.test.ts` runs 12 simulated minutes of a 5-kingdom match (AI, production, wars, captures) at ≈ 0.08 ms/step. In headless Chrome at 1400 × 860 the overlay showed 60 fps, ~0.2 ms sim and ~6 ms draw with ~200 visible sprites and zero chunk builds per frame; open-ocean chunks are never allocated. Canvas 2D was sufficient, so no rendering library was introduced.

## What was replaced

`src/App.tsx`, `src/sim.ts`, `src/render.ts`, `src/sim.test.ts` and the old styles were replaced by the modular layout above (the previous single-file simulation/renderer used a hand-authored 80×52 map and procedural shapes instead of the art pack). `public/assets/map/` (earlier generated art) is untouched but unused. The Tiny Swords pack, references and guides are unmodified.

## Gap analysis against the original revamp prompt

Reviewed after the second iteration. **Met:** seeded connected islands with Tiny Swords autotiles, animated foam with seeded phases, chunked ground cache, territory model (radius 11 / radius‑2 / stacking / reversion / edge-only supply / pockets / attrition), tile borders drawn once per frontline, instant town capture (now rule-gated), one-gesture route drawing with RDP + Chaikin + land clipping, continuous steering, automatic combat on a fixed step, Block, pawn lumber loop, low-frequency AI, spatial hash, fixed timestep with interpolation, perf overlay, README/asset metadata/tests.

**Found and fixed in this pass**
- Routes could stall forever when a unit was shoved back by a blocker (the old arrival test only looked at per-tick motion). Waypoints now have tolerance radii and a net-displacement stall detector.
- Isolated units lost their territory once they were far enough into enemy land (competition beat the tiny unit influence). A guaranteed 2×2 patch now exists per unit.
- The block button next to the unit competed with the HUD bar; removed (the bar button remains).
- Units were ~1.5× faster than the pacing the design needs and combat was short; health ×3, movement 1 tile/s, healing/attrition now percentage-based.
- Instant, unconditional capture and instant elimination made a lost town final; capture is now gated by hostility and the 2-tile defender radius, and exiles survive.
- A victory screen contradicted the open-ended design; removed.
- The renderer allocated a sorted copy of the draw list every frame; it now reuses one array. Open-ocean chunks are skipped.
- Tests only covered the first-playable rules; relations, AI-adjacent behaviour, squads, towers, production, population, healing, stats and a 12-minute soak run are now tested.

**Still short of the original prompt / known limits**
- AI never *cuts enemy corridors* or forms deliberate pincers, and archers/lancers have no special tactics (kiting, flanking).
- Not touch-friendly (no pinch zoom / long-press); no minimap; the grid is drawn over the whole ocean.
- Decorations `Clouds` and `Rubber Duck`, and `Shadow.png`, are unused (no elevation yet).
- Visuals were only checked in headless Chrome screenshots: lancer directional attack art, squads, archers on towers and barracks sprites compile and run but were not reviewed frame by frame; sprite foot anchors for Lancer/Archer/Tower are measured by eye.
- Terrain is still a single elevation plane (multi-level terrain explicitly deferred).

## Deferred

Multi-level terrain, cliffs, stairs and elevation shadows; touch gestures; marching-squares border smoothing; deeper AI (corridor cutting, formations, unit-specific tactics); tower upgrades and more shop buildings; pawn path caching.
