# Claude Prompt: Revamp the Borderlands Browser Prototype

You are working inside this project:

`/Users/dolaniyi/Documents/Borderlands`

Your task is to revamp the existing React + TypeScript + Canvas browser prototype into a polished, playable strategy-game demo that resembles the supplied reference images and uses the included Tiny Swords art package correctly.

Do not stop after producing a plan. Inspect the project, make the changes, test them, profile the important paths, and leave the repository in a working state. Make reasonable implementation decisions when details are minor, but honor every non-negotiable behavior below.

## Primary success criterion

The most important feature is a solid, understandable, responsive **tile-based territory system**. Movement, combat, towns, pawns, supply, rendering, and procedural generation should support that territory system.

The prototype is successful when moving battle units across the island visibly changes individual territory cells in a predictable way; opposing armies push a stable frontline; friendly influence joins without internal borders; corridors can be cut; isolated pockets remain locally owned but become unsupplied; and territory correctly returns when temporary enemy influence leaves.

## Read these files before changing code

1. `references/Territory Guide.txt`
2. `references/Tiny Swords Instructions.md`
3. `references/Starting Point Example.png`
4. `references/Kon Empire.png`
5. The current implementation in `src/`
6. Existing tests and `README.md`
7. The asset package under:
   `Art Assets - Tiny Swords/Tiny Swords (Free Pack)/`

The Territory Guide is authoritative for territory competition, connectivity, stranded pockets, and supply. The Tiny Swords Instructions are authoritative for tile assembly and layer order. Re-read them rather than relying on assumptions.

Inspect the actual PNG dimensions and transparency before defining sprite metadata. Do not invent filenames or frame dimensions when the local files can be measured.

Known local asset facts that must still be verified in code:

- Terrain tiles use a 64 × 64 logical grid.
- `Terrain/Tileset/Tilemap_color1.png` through `Tilemap_color5.png` are available.
- `Terrain/Tileset/Water Background color.png` is 64 × 64.
- Local `Shadow.png` is 192 × 192.
- Local `Water Foam.png` is 3072 × 192 and should be interpreted from measured frame metadata.
- Warrior and Pawn animation sheets use 192 px-high frames; derive frame counts from sheet width instead of scattering magic numbers.
- Color families exist for Black, Blue, Purple, Red, and Yellow units and buildings.
- Level-one towns must use each faction's `House1.png`.

## Permission and preservation boundaries

This is a prototype and the existing source code may be heavily reorganized or replaced. You may delete or rewrite obsolete implementation code, styles, tests, and generated build output as needed.

However:

- Do not delete or alter the original Tiny Swords art package.
- Do not delete reference images or guide documents.
- Preserve unrelated user files and existing work that is outside this prototype.
- Do not use destructive Git operations.
- Keep the project browser-native; do not convert it into Unity.
- Prefer Canvas 2D for the prototype. Introduce a rendering library only if profiling proves Canvas 2D insufficient.

## Desired player experience

The game opens on a medium-large procedurally generated island viewed from a fairly wide camera. A square grid is visible over the world. The island, water, shoreline animation, terrain decoration, towns, warriors, pawns, territory tint, and UI use the included Tiny Swords assets.

The player starts with one town and can select a battle unit by pressing on it. In the same continuous mouse gesture, dragging draws a smooth maneuver path. On release, the unit follows that path closely and moves continuously through world space. It must not hop from tile center to tile center like Pac-Man.

Territory remains grid-based even though units move freely. A unit's current territory source cell changes only when the unit crosses into a new 64 × 64 logical tile. This keeps territory stable while preserving fluid movement.

## Match setup

Create a new-game setup screen that allows the number of kingdoms to be selected before generation.

- Supported kingdom count: 2–5.
- Use the five provided color families: Black, Blue, Purple, Red, and Yellow.
- Exactly one kingdom is player-controlled.
- Remaining kingdoms are AI-controlled.
- The player begins with exactly one town.
- Each AI kingdom begins with a procedurally chosen 1–5 towns.
- Spawn towns with enough separation to avoid immediate accidental capture.
- Ensure every kingdom has viable walkable territory and that towns are reachable through land routes.
- Expose and display the procedural seed so a generated match can be reproduced.

## Procedural island generation

Generate one connected island on a square logical grid.

- Random width and height should each fall between 30 and 50 tiles.
- Logical terrain tile size is 64 × 64 source pixels.
- All terrain is on one elevation plane for this prototype.
- Do not implement complex stacked elevation or stairs yet.
- The island outline must be grid-based but should look natural: bays, headlands, broad peninsulas, inlets, and varied coast depth without excessive one-cell noise.
- Use a deterministic seeded generator.
- Keep the largest connected land component.
- Remove isolated cells and fill accidental one-cell holes unless intentionally needed.
- Avoid fragile diagonal-only connections because territory supply uses edge connectivity.
- Avoid starting towns on narrow one-cell peninsulas or near impassable coast edges.
- Reserve meaningful open areas for towns, combat, and maneuvering.

Use the flat-ground Tiny Swords autotile grammar from `references/Tiny Swords Instructions.md`. Select edge, corner, narrow-strip, and isolated-cell sprites from neighboring land occupancy. Do not draw the island as a single AI-generated bitmap.

Render layers in this approximate order:

1. Water background
2. Animated shoreline foam
3. Flat ground/autotiles
4. Territory tint and territory borders
5. Square grid overlay
6. Terrain decorations and resource trees
7. Towns
8. Pawns and battle units
9. Selection, route, combat, and mode indicators
10. HUD and menus

Use `Water Background color.png` and the animated `Water Foam.png`. Give foam instances seeded phase offsets so the whole shoreline does not animate in sync.

Decorate land naturally with assets from `Terrain/Decorations` and the tree assets under `Terrain/Resources/Wood/Trees`. Use deterministic, seeded placement with exclusion zones around towns and critical paths. Avoid uniform spacing and obvious repetition.

## Grid and coordinate systems

Keep these concepts distinct:

1. **Logical territory grid:** 64 × 64 source-pixel cells used for land occupancy, territory, town placement, supply, and unit influence.
2. **Continuous world space:** floating-point coordinates used for unit positions, paths, velocities, collision, and combat.
3. **Screen space:** camera-transformed coordinates used for pointer input and UI placement.

The visible grid should overlay the world, including territory, but should remain subtle enough that the art is readable. Units must not be visually or mechanically snapped to the grid.

Provide tested helpers for:

- screen → world
- world → screen
- world position → logical cell
- logical cell → world bounds/center

## Territory model

Follow `references/Territory Guide.txt` closely.

Territory is evaluated on the regular 64 × 64 logical grid. Each tile stores one current controlling faction or neutral.

### Influence sources

There are two territory-producing source types:

1. Towns
2. Battle units

Pawns contribute **no territory influence**.

Every level-one town has a fixed influence radius of **11 tiles**.

Every battle unit uses the same influence footprint:

- Radius: 2 tiles outward from its current cell.
- Shape: square.
- The unit therefore influences cells within `abs(dx) <= 2` and `abs(dy) <= 2`, subject to valid land and competition.
- Recompute that unit's source cell only when it enters a different logical tile.
- Do not recompute territory merely because the unit moved a few pixels within the same tile.

### Friendly stacking

Friendly battle-unit influence stacks with diminishing returns on overlapping tiles:

- First friendly unit contribution: `1.0`
- Each additional friendly battle unit: `0.5`
- Pawns: `0.0`

Town influence and unit influence must remain separately tunable. Choose clear initial weights and centralize them in configuration. Add tests demonstrating that two overlapping friendly units beat one equal opposing unit, without making large armies infinitely dominant.

### Competition and reversion

When multiple factions reach a tile, the stronger current influence wins. Use the weighted, radius-limited competition described in the Territory Guide. Only eligible sources whose influence reaches the tile may compete.

Territory from moving units is dynamic, not permanently painted behind them:

- If an enemy briefly enters an unguarded area and then leaves, the tile returns completely to the owner it would have under the remaining unchanged sources.
- If territory previously depended on friendly units and those units were pushed backward, that shape does not magically return after the enemy leaves. It returns only if the remaining town/unit sources currently justify it.
- Do not retain abandoned movement trails.
- Town ownership is persistent until another battle unit physically captures the town.

Model this cleanly as current source influence derived from present town ownership and present battle-unit cells. If a separate base-ownership layer is useful, keep it distinct from the derived current-control field.

### Friendly merging and borders

- Connected friendly influence forms one region.
- Do not draw internal borders between friendly towns or friendly units.
- Opposing factions share one frontline along tile edges.
- Territory borders remain tile-based for this prototype; do not smooth them with Marching Squares yet.
- Draw a clear faction-colored outline plus a lightly tinted interior.
- Keep the square grid visible over or with the territory layer.
- Avoid doubled enemy borders, gaps, z-fighting, or accidental seams at multi-faction junctions.

### Supply and isolated pockets

After determining tile ownership, flood-fill each faction's territory outward from that faction's towns.

- Supply connectivity is four-directional only.
- Tiles touching only at a corner are **not connected**.
- A friendly-controlled component connected to any friendly town is supplied.
- A friendly component not connected to a friendly town is an isolated pocket.
- Battle units inside an isolated friendly pocket still project local influence.
- Never draw an artificial connector between a unit and a town.
- Supply returns only when a real edge-connected territorial path reopens.
- Units in isolated pockets take configured damage over time.
- Preserve or improve the existing cut-off attrition mechanic and make its state visually understandable.

Territory recalculation should occur when a meaningful source changes cells, a town changes owner, a battle unit dies/spawns, or relevant configuration changes—not every animation frame.

## Towns and capture

- Level-one towns use `House1.png` for their faction color.
- A town is captured immediately when an enemy **battle unit** makes physical contact with its capture bounds.
- No capture timer is used.
- Pawns cannot capture towns.
- Defense consists of keeping enemy battle units from reaching the town.
- On capture, town ownership and its radius-11 territory source switch immediately.
- Recompute territory, supply, pawn allegiance, and kingdom counts after capture.
- The captured town's pawn switches allegiance to the new owner.
- Prevent repeated capture events from firing every frame while the same unit remains in contact.

Use a sensible town collision/capture radius based on the visible House1 footprint, not the transparent sprite-sheet rectangle.

## Continuous path drawing and unit movement

The player should issue a route in one natural gesture:

1. Pointer-down on a player-controlled battle unit selects it and captures the pointer.
2. A small movement threshold distinguishes a click from a drag.
3. Once dragging begins, pointer movement records a draft route in world coordinates.
4. Render the route live under the cursor.
5. Pointer-up commits the route.
6. The selected unit follows the committed route continuously.

Do not append every raw pointer event. Stabilize the route:

- Sample only after a minimum world-space distance.
- Apply a polyline simplifier such as Ramer–Douglas–Peucker with a small tolerance.
- Optionally use a light Chaikin or Catmull–Rom smoothing pass, but never smooth through water or obstacles.
- Preserve intentional sharp tactical turns.
- Avoid excessive waypoint allocation while dragging.

Movement must be continuous:

- Unit position, velocity, and route points are floating-point world values.
- Use acceleration/turn-rate-limited steering or a look-ahead path follower.
- Do not move between tile centers.
- Do not use four-direction Pac-Man movement.
- A unit should follow the user's curve closely without visibly oscillating around it.
- Stop cleanly at the endpoint.
- Keep units on land.
- If a drawn segment crosses water, clip it to valid land or route locally around the invalid section, then smooth only the valid result.
- Use local collision avoidance so friendly units do not occupy exactly the same point.

Pawns are also selectable and redirectable to a tree, but they may never leave their kingdom's currently controlled territory.

## Camera controls

- Pointer-down and drag on land or water that is not occupied by a selectable unit pans the camera.
- Pointer-down on a selectable unit begins selection/path input instead of camera panning.
- Use pointer capture so gestures remain stable outside the original element.
- Mouse wheel zooms around the cursor position.
- Begin at a fairly wide zoom showing a strategically useful portion of the island.
- Clamp zoom to useful limits.
- Clamp or softly constrain camera motion to the island plus a modest water margin.
- Prevent accidental unit orders when the user intended to pan.

Touch support is welcome but desktop mouse behavior is the primary prototype requirement.

## Kingdoms and units

Use Black, Blue, Purple, Red, and Yellow asset families. Do not tint one faction's sprite sheet at runtime when a correct colored version exists.

### Battle units

Warriors are the initial battle unit and the game's heavy/tank unit.

- Use each faction's `Warrior_Idle.png`, `Warrior_Run.png`, `Warrior_Attack1.png`, `Warrior_Attack2.png`, and `Warrior_Guard.png` as appropriate.
- Detect animation frame count from actual sheet dimensions using 192 × 192 frames.
- Animate idle, run, attack, and guard states.
- Scale the rendered warrior to a sensible world size while keeping crisp pixel art.
- Warriors are manually ordered by the player.
- AI warriors receive explicit orders from a low-frequency AI planner and then use the same movement system; they should not randomly wander every frame.
- Battle units capture towns and produce radius-2 square influence.

### Automatic contact combat

Remove the proposed Fight button. Warriors fight automatically when they make contact with an enemy battle unit.

Implement a simple melee state machine:

```text
idle → moving → engaging → attacking → cooldown
                 ↘ blocked
```

- Contact or close melee range begins combat automatically.
- Play attack animations and apply damage on a defined active frame or normalized active window.
- Use attack cooldowns; do not apply damage every render frame.
- Keep combat deterministic under a fixed simulation step.
- Warriors have high health and should feel heavy.
- Dead units stop influencing territory immediately and play/remove cleanly.

### Block toggle

When a warrior is selected, show one circular **Block** button at the bottom-left of the selected unit. Use the included Tiny Swords round-button/UI assets and an appropriate icon.

The button toggles between:

- **Fighting mode:** normal movement and automatic contact combat.
- **Blocking mode:** the warrior stops moving, cancels or pauses its route, plays the guard animation, prevents enemy units from passing through its blocking radius, and takes 90% reduced incoming damage.

Blocking affects enemy units only. Friendly units may pass or steer around without being stopped.

While blocking:

- The warrior should not advance.
- Enemy units contacting its blocking radius stop or route around it rather than tunneling through.
- The warrior remains a territory source.
- Clearly show the active block state.
- Toggling Block off returns the warrior to fighting mode.
- A new move order may either automatically leave blocking mode or be rejected with clear feedback; choose one consistent rule and document it. Prefer automatically leaving block mode for responsive control.

Anchor the button in screen space near the selected unit and clamp it inside the viewport. Do not let it scale unreadably with world zoom.

## Pawns and lumber loop

Each owned town supports exactly one pawn. Therefore the number of pawns a kingdom owns equals the number of towns it owns.

Pawns:

- Contribute no territory influence.
- Cannot capture towns.
- Do not fight.
- Are the only units that autonomously wander.
- Stay strictly inside their kingdom's currently controlled territory.
- Prefer wandering near safe territory boundaries while looking for valid trees.
- May be selected and redirected to a different valid tree by the player.
- Use the faction's Pawn idle and run animation sheets.

### Tree harvesting

Use the included tree and stump assets.

- Tree1 and Tree2 are conifers.
- Conifers require 150 seconds to cut and yield 20 lumber.
- Other harvestable trees require 60 seconds to cut and yield 10 lumber.
- A pawn must remain in valid interaction range while cutting.
- Show cutting progress with a small, unobtrusive indicator when selected or hovered.
- When harvesting completes, replace the tree permanently with an appropriate stump.
- Trees do not regrow in this prototype.
- The pawn carries the lumber back to the nearest reachable friendly town.
- Kingdom lumber inventory increases only when the pawn reaches that town.
- If the pawn is redirected before delivery, define whether it keeps or drops the carried load. Prefer keeping one carried load and delivering it before accepting another harvest job.
- If a town changes ownership while the pawn is returning, recalculate the nearest friendly destination.
- If the pawn's current position or target becomes outside friendly territory, abort the unsafe task and move toward the nearest supplied friendly tile/town without crossing enemy territory.

When a town is captured, its associated pawn switches allegiance immediately. Update its colored sprite family, allowed territory, destination town, and task safely.

Use a simple pawn state machine:

```text
wander → seek-tree → travel-to-tree → chopping → carrying → return-to-town → deposit
                       ↘ invalid/unsafe → retreat/replan
```

Do not update autonomous pawn plans every frame. Replan at a low fixed frequency or on meaningful events.

## AI behavior

Keep AI intentionally simple but functional:

- AI kingdoms use the same territory, movement, capture, combat, blocking, pawn, and lumber rules as the player.
- AI pawns operate autonomously using the pawn state machine.
- AI battle units receive explicit strategic orders from an AI controller at a low frequency, such as every 0.5–2 seconds with seeded staggering.
- AI goals may include defending towns, forming a frontline, capturing an exposed neighboring town, reconnecting an isolated pocket, or cutting an enemy corridor.
- Do not run expensive global pathfinding for every AI unit every frame.
- Do not give AI hidden territory strength or movement privileges.

## Browser performance architecture

This game should run as a normal browser game. Unity is not required.

The maximum initial map is roughly 50 × 50 = 2,500 logical terrain cells, which is comfortable for Canvas 2D if layers are cached intelligently.

### Rendering separation

Use React for setup screens, HUD, buttons, and infrequently changing panels. Do not put 60 FPS world state into React component state.

Use Canvas 2D for the world. Separate render concerns:

1. Static or rarely changing terrain chunks
2. Animated shoreline/water effects
3. Cached territory/grid layer
4. Dynamic trees/stumps and decorations
5. Towns
6. Dynamic units and effects
7. Selection/routes/world-space indicators

### Terrain caching

A 50 × 50 map at native 64 px resolution is 3200 × 3200 pixels. Avoid keeping many full-resolution duplicate canvases of that size.

- Cache static terrain in chunks, for example 8 × 8 or 10 × 10 logical tiles.
- Draw only camera-visible chunks.
- Invalidate only a decoration/tree chunk when a tree becomes a stump.
- Do not rebuild the procedural tilemap every frame.

### Territory caching

- Store territory/controller/supply in compact typed arrays.
- Recompute only on meaningful dirty events.
- With at most 2,500 cells, a full recalculation on a dirty event is acceptable initially if measured and fast.
- If profiling shows a problem, update only affected source bounds plus connectivity as appropriate.
- Render territory to a low-resolution logical-cell canvas and scale it to world size with smoothing disabled.
- Cache the grid overlay rather than redrawing thousands of identical lines every frame.

### Simulation loop

- Use `requestAnimationFrame` for rendering.
- Use a fixed simulation timestep, approximately 20–30 Hz, with an accumulator.
- Interpolate visual positions between simulation states where helpful.
- Cap large `dt` values after tab suspension.
- Keep territory, AI planning, pawn planning, and animation clocks on appropriate independent frequencies.

### Unit performance

- Use a simple uniform spatial hash/grid for nearby-unit collision, combat contact, and blocking queries.
- Avoid all-pairs O(n²) checks once unit counts grow.
- Cull units, effects, decorations, and foam outside the camera viewport.
- Reuse arrays/objects in hot loops when practical.
- Avoid creating new vectors and closures for every unit every frame.
- Preload each used image once and share it.
- Derive sprite-sheet metadata once during loading.

### Display quality

- Set `imageSmoothingEnabled = false` for pixel-art layers.
- Snap sprite source rectangles and final screen pixels where possible without snapping continuous world movement.
- Cap device pixel ratio, preferably at 2 or lower.
- Keep the wide initial camera legible without rendering the full world at excessive backing-store resolution.

### Performance targets

On a normal desktop browser:

- Target 60 FPS rendering during ordinary play.
- Remain playable at 30 FPS on weaker hardware.
- Avoid long tasks and visible frame spikes during territory updates.
- Avoid continuous garbage-collection churn while drawing routes or moving many units.
- Add a development-only performance overlay or counters for FPS, simulation time, territory recomputation time, visible sprites, and dirty chunks.

Do not prematurely rewrite everything for WebGL. Profile first. If Canvas 2D cannot meet targets after caching and culling, document the measured bottleneck before introducing PixiJS or another renderer.

## Suggested code organization

Avoid continuing with one monolithic simulation or renderer file. A structure similar to this is appropriate:

```text
src/
  app/
    App.tsx
    NewGameScreen.tsx
    Hud.tsx
  game/
    config.ts
    types.ts
    Game.ts
    AssetLoader.ts
    SpriteAnimator.ts
    Camera.ts
    InputController.ts
    Renderer.ts
    WorldGenerator.ts
    Autotile.ts
    TerritorySystem.ts
    SupplySystem.ts
    MovementSystem.ts
    CombatSystem.ts
    PawnSystem.ts
    AISystem.ts
    SpatialHash.ts
  tests/
```

This is guidance rather than a mandatory exact tree. Keep boundaries clear and testable.

## Implementation sequence

Work in vertical slices and keep the project runnable after each phase.

### Phase 1 — Audit and foundations

- Inspect current behavior, guides, art, sprite dimensions, and tests.
- Create centralized configuration and asset metadata.
- Introduce deterministic seeded randomness.
- Establish fixed-step simulation and camera transforms.
- Preserve useful existing mechanics and tests where compatible.

### Phase 2 — Island and visual foundation

- Generate a connected 30–50 tile island.
- Assemble flat Tiny Swords ground autotiles.
- Add water background and animated foam.
- Add cached grid overlay.
- Add seeded terrain decorations and trees.
- Add wide pan/zoom camera.

### Phase 3 — Territory first playable

- Implement radius-11 towns.
- Implement radius-2 square battle-unit sources.
- Implement diminishing friendly stacking.
- Implement weighted competition and dynamic reversion.
- Implement tile-based borders and friendly-region merging.
- Implement edge-only supply flood fill, isolated pockets, and attrition.
- Make this phase independently demonstrable before adding economy complexity.

### Phase 4 — Continuous control and combat

- Implement unit selection and one-gesture route drawing.
- Add route simplification and continuous steering.
- Add Warrior animation and automatic contact combat.
- Add Block toggle, guard animation, 90% damage reduction, and enemy stopping.
- Add instant battle-unit town capture.

### Phase 5 — Pawns and towns

- Spawn one Pawn per town.
- Add autonomous boundary wandering and tree targeting.
- Add configurable chopping durations/yields.
- Replace trees with permanent stumps.
- Add carrying, nearest-town return, and lumber deposit.
- Switch pawn allegiance on town capture.

### Phase 6 — AI, UI, polish, and profiling

- Add selectable 2–5 kingdom setup.
- Add simple AI strategic orders.
- Use included UI assets consistently.
- Add HUD for kingdom, towns, lumber, selected unit, mode, and cut-off status.
- Profile, cache, cull, fix frame spikes, and update documentation.

## Required automated tests

Add or update tests for at least the following:

### Generation

- Seed reproducibility.
- Width and height always within 30–50.
- Island land is one edge-connected component.
- Towns spawn on valid land with required separation.
- Every kingdom has a valid starting town and reachable land.

### Territory

- Town influence radius is exactly 11.
- Battle-unit influence is a radius-2 square.
- Pawns contribute zero influence.
- Territory does not recompute merely from movement within the same tile.
- Territory changes when a battle unit crosses into a new tile.
- First friendly unit contributes 1.0 and additional units contribute 0.5.
- Stronger overlapping influence wins.
- Temporary enemy influence disappears when the enemy leaves.
- Friendly regions have no internal border.
- Diagonal-only tile contact does not provide supply.
- Edge-connected corridors do provide supply.
- Cutting a corridor creates an isolated pocket.
- Isolated units retain influence and take attrition damage.
- Reopening a real corridor restores supply.

### Movement/input

- A click selects without issuing a spurious route.
- A drag creates a simplified route with substantially fewer points than raw pointer events.
- Unit movement uses continuous coordinates and is not restricted to tile centers.
- Routes do not cross water.
- Dragging empty terrain pans the camera instead of commanding a unit.

### Combat/blocking

- Opposing Warriors engage automatically on contact.
- Damage is tied to cooldown/active attack timing, not render FPS.
- Blocking reduces incoming damage by 90%.
- Blocking stops enemy movement but not friendly movement.
- Blocking mode persists until toggled off or a documented new-order rule exits it.
- Dead units stop contributing territory.

### Towns/pawns/resources

- Only battle units capture towns.
- Capture occurs immediately on first valid contact.
- Capturing a town switches ownership once and recomputes territory.
- The town's pawn switches allegiance.
- Pawn count equals owned town count.
- Pawns never leave currently friendly territory.
- Tree1/Tree2 take 150 seconds and yield 20 lumber.
- Other configured trees take 60 seconds and yield 10 lumber.
- Inventory changes only after delivery to a friendly town.
- Harvested trees become permanent stumps.
- A returning pawn replans if its destination town changes ownership.

## Manual acceptance checklist

Before considering the revamp complete, verify all of these in the running browser:

- A new match can be started with 2, 3, 4, or 5 kingdoms.
- The same seed regenerates the same island and placements.
- The island resembles the reference art rather than flat procedural rectangles.
- Water and foam animate naturally.
- The square grid is visible but not overpowering.
- Camera pan begins from empty land or water and feels stable.
- Camera starts zoomed out enough for strategic play.
- Selecting and dragging a Warrior creates a smooth visible route in one gesture.
- Warriors follow curves continuously without grid-step motion.
- Territory updates only when a source crosses a tile boundary.
- Unit lobes, merged regions, corridors, cutoffs, pockets, and reconnections match the Territory Guide.
- Stronger forces push the frontline and territory reverts correctly when they withdraw.
- Town capture is immediate on battle-unit contact.
- Warriors fight automatically on contact.
- The Block toggle uses the provided UI style, stops enemies, and visibly guards.
- Pawns wander, find trees, chop for the correct duration, carry lumber home, and leave stumps.
- Pawns remain inside friendly territory and switch allegiance with captured towns.
- The browser remains responsive with the maximum map size and several kingdoms.
- `npm test` passes.
- `npm run build` passes.

## Final deliverables

When finished:

1. Leave the playable implementation in `/Users/dolaniyi/Documents/Borderlands`.
2. Update `README.md` with setup, controls, rules, architecture, and performance notes.
3. Document the exact asset paths and sprite metadata used.
4. Report which existing files were replaced and why.
5. Report test/build results.
6. Report measured performance for maximum-size generation and a representative battle.
7. List any intentionally deferred features; multi-level terrain is explicitly deferred.
8. Do not claim completion if core territory behaviors are mocked, hard-coded to one seed, or visually disconnected from simulation state.

Prioritize a coherent, playable territory prototype over adding extra unit types or economy systems beyond the specified Pawn lumber loop.
