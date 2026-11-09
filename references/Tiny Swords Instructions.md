# Tiny Swords Tilemap Instructions

Use this document when implementing Tiny Swords-style terrain for the Borderlands prototype. The goal is to assemble terrain deterministically from tile sprites—not to ask an image model to redraw a complete map.

## Source material

- [Pixel Frog — Tiny Swords Tilemap Guide](https://pixelfrog-assets.itch.io/tiny-swords/devlog/1138989/tilemap-guide)
- [Tilemap parts diagram](https://img.itch.zone/aW1nLzI0NDc5NzEzLnBuZw==/original/lJYH5D.png)
- [Layer-order diagram](https://img.itch.zone/aW1nLzI0NDc5NzIzLnBuZw==/original/%2BliFdR.png)
- [Shadow placement diagram](https://img.itch.zone/aW1nLzI0NDc5NzI2LnBuZw==/original/7MjCa%2F.png)
- [Water-foam placement diagram](https://img.itch.zone/aW1nLzI0NDc5NzI3LnBuZw==/original/d0cDbd.png)
- [Flat-ground tile-number diagram](https://img.itch.zone/aW1nLzI0NDc5NzMwLnBuZw==/original/5AuCF%2B.png)
- [Elevated-ground tile-number diagram](https://img.itch.zone/aW1nLzI0NDc5NzMyLnBuZw==/original/T6CrMH.png)
- [Stairs placement diagram](https://img.itch.zone/aW1nLzI0NDc5NzM3LnBuZw==/original/lVpFdH.png)

The Tiny Swords source tile size is **64 × 64 pixels**.

## Objective

Build a reusable tilemap system that can create a reliable 20 × 20 starting island and later scale to larger maps. The system must:

- Assemble terrain on a logical square grid.
- Choose edges, corners, isolated cells, cliffs, shadows, foam, and stairs from neighbor relationships.
- Keep the stepped grid-aligned silhouette seen in the reference.
- Permit several stacked elevation levels.
- Separate terrain state from decorative props such as trees, rocks, buildings, and units.
- Produce the same map when given the same seed and terrain data.

Do not generate a complete terrain image with AI at runtime. Compose the map from licensed sprite-sheet regions.

## Core terrain parts

| Part | Purpose |
|---|---|
| BG color | Lowest visual layer and water/background fill outside terrain. |
| Water foam | Animated contact effect wherever terrain touches the water/background. |
| Flat ground | Lowest walkable terrain next to the water. |
| Shadow | Depth cue below each elevated terrain level. |
| Elevated ground top | Walkable surface of a raised level. |
| Elevated cliff | Vertical face connecting elevated ground to lower terrain or water. |
| Stairs | Walkable connection from a lower level to an elevated level. |

The elevated-ground atlas contains two cliff families:

1. A cliff that terminates against walkable terrain below.
2. A cliff that terminates directly against water/background.

Do not substitute one family for the other; the lower edge treatment differs.

## Required render order

Render from back to front:

1. Layer 0 — BG color
2. Layer 1 — water foam
3. Layer 2 — flat ground
4. Layer 3 — shadow for elevation 1
5. Layer 4 — elevated ground level 1
6. Layer 5 — shadow for elevation 2
7. Layer 6 — elevated ground level 2
8. Layer 7 — shadow for elevation 3
9. Layer 8 — elevated ground level 3
10. Decorative terrain props, sorted by ground-contact Y
11. Buildings, units, effects, territory tint, labels, and UI

For more elevation levels, continue repeating `shadow → elevated ground`.

Never draw a raised terrain surface beneath its own shadow. The shadow belongs immediately below the elevated layer it supports.

## Flat-ground tile grammar

The guide numbers the flat-ground atlas like this:

```text
 1   2   3    13
 4   5   6    14
 7   8   9    15
10  11  12    16
```

Use these semantic roles:

| Tile | Role |
|---:|---|
| 1 | top-left outer corner |
| 2 | top edge |
| 3 | top-right outer corner |
| 4 | left edge |
| 5 | fully surrounded center/fill |
| 6 | right edge |
| 7 | bottom-left outer corner |
| 8 | bottom edge |
| 9 | bottom-right outer corner |
| 10 | left end of a one-cell-high horizontal strip |
| 11 | middle of a one-cell-high horizontal strip |
| 12 | right end of a one-cell-high horizontal strip |
| 13 | top end of a one-cell-wide vertical strip |
| 14 | middle of a one-cell-wide vertical strip |
| 15 | bottom end of a one-cell-wide vertical strip |
| 16 | isolated single ground cell |

The 1–9 group handles ordinary filled regions. Tiles 10–16 handle narrow strips and isolated cells that the normal 3 × 3 edge set cannot represent cleanly.

### Flat-ground selection

For every occupied flat-ground cell, inspect its four cardinal neighbors:

```text
N = occupied at x, y-1
E = occupied at x+1, y
S = occupied at x, y+1
W = occupied at x-1, y
```

Select the basic tile as follows:

```text
N E S W       tile
0 0 0 0       16
0 0 1 0       13
1 0 1 0       14
1 0 0 0       15
0 1 0 0       10
0 1 0 1       11
0 0 0 1       12
0 1 1 0       1
0 1 1 1       2
0 0 1 1       3
1 1 1 0       4
1 1 1 1       5
1 0 1 1       6
1 1 0 0       7
1 1 0 1       8
1 0 0 1       9
```

Confirm orientation against the actual atlas during import. If the engine's Y axis or sheet order is inverted, update the atlas mapping once; do not scatter rotation fixes through the renderer.

Use diagonal neighbors only when the supplied atlas includes inner-corner variants or when a concave opening visibly needs a correction overlay.

## Elevated-ground tile grammar

The elevated atlas retains flat-ground tiles 1–16 and adds cliff tiles 17–24:

```text
 1   2   3    13
 4   5   6    14
 7   8   9    15
10  11  12    16
17  18  19    20
21  22  23    24
```

Interpret them as:

- Tiles 1–16: elevated walkable grass/top-surface shapes.
- Tiles 17–20: cliff faces that connect the elevated platform to walkable ground below.
- Tiles 21–24: cliff faces that connect the elevated platform directly to water/background.

Use the atlas artwork—not rotation—to preserve lighting and edge treatment.

An elevated cell has two linked visual concerns:

1. The walkable top tile, selected using the same neighbor rules as flat ground.
2. A cliff-face tile below exposed south/front edges.

Place cliff faces beneath the corresponding elevated top edge. Use the terrain-facing family when the destination cell below is walkable land and the water-facing family when the destination is water/background.

## Shadows

The guide identifies each shadow frame as **128 × 128**, while the logical grid remains 64 × 64.

Rules:

- Place shadow sprites on the 64 × 64 logical grid.
- Allow the 128 × 128 artwork to overlap neighboring cells.
- The shadow corresponds to the same footprint as the elevated walkable area.
- Move the shadow **one complete 64 px cell downward** to create the height illusion.
- Draw the shadow immediately below its elevated layer.
- Never crop the shadow to one tile.

Allocate at least one tile of render padding outside the logical map so oversized shadows are not clipped at the canvas boundary.

## Water foam

Water foam uses the same oversized-placement concept as shadows.

Rules:

- Treat each foam sprite as 128 × 128 artwork placed on the 64 × 64 grid.
- Place foam wherever flat ground or water-facing elevated cliffs touch BG water.
- Draw foam above BG color but below terrain.
- Use all directional/corner variants from the supplied atlas.
- If foam is animated, randomize or seed each placed instance's starting frame so the whole shoreline does not pulse in unison.
- Preserve stable animation timing after the initial phase offset.

## Stairs

Stairs bridge a lower walkable level to elevated ground.

Use the dedicated left and right stair pieces together. Their upper ends must disappear cleanly under or into the elevated top surface.

Two cases are shown in the guide:

### Case 1 — stair beside walkable terrain, not a cliff

Use one elevated-ground center/top piece at the upper landing to cover the stair connection. Do not leave a square bite, seam, or exposed cut line beside the stair.

### Case 2 — stair beside an exposed cliff

Use two supporting pieces:

1. An elevated top/center piece for the walkable upper connection.
2. A matching lower cliff piece to continue the cliff face beside the stair.

The cliff must remain visually continuous on both sides of the stairs. The stairs replace only the opening through which the player ascends.

## Reliable 20 × 20 map format

At native Tiny Swords resolution:

- Logical cells: 20 × 20
- Tile size: 64 × 64 px
- Base logical image area: 1280 × 1280 px
- Recommended offscreen render target with one-tile overscan: 1408 × 1408 px
- Final crop: either retain overscan for shadows/foam or crop intentionally after compositing

For the current Borderlands renderer, which uses a 22 px logical cell:

- Runtime display area: 440 × 440 px
- Source-to-runtime scale: `22 / 64 = 0.34375`
- Keep the original 64 px atlas as the source of truth.
- Pre-render the assembled 20 × 20 terrain at native resolution, then scale the finished terrain canvas. Do not repeatedly resample individual tiles every frame.

### Suggested data model

```ts
type Cell = {
  occupied: boolean
  elevation: number      // 0 for flat; 1+ for raised levels
  terrainStyle: number   // grass color/biome variant
  stairs?: 'north' | 'south' | 'east' | 'west'
}

type Tilemap = Cell[][] // [y][x], exactly 20 × 20 for the starting region
```

Maintain separate masks for each elevation level:

```ts
flatMask[y][x]
elevationMasks[level][y][x]
```

Generate or author the occupied-cell mask first. Then derive sprite selection from neighbors. Never store a manually selected edge sprite as the primary terrain state.

### Deterministic build sequence

```text
1. Validate that map data is exactly 20 × 20.
2. Build the flat-ground occupancy mask.
3. For each occupied cell, choose flat tile 1–16 from cardinal neighbors.
4. Identify every water-contact edge and place the matching foam sprite.
5. For each elevation level from low to high:
   a. Build its occupancy mask.
   b. Place its downward-offset shadow sprites.
   c. Select its top tiles using the same 1–16 grammar.
   d. Add terrain-facing or water-facing cliff tiles to exposed front edges.
6. Insert stairs and their required landing/cliff support pieces.
7. Add decorative trees, rocks, and props using a seeded RNG.
8. Render at native resolution with nearest-neighbor sampling.
9. Scale or crop only after the full terrain composition is complete.
```

## Island-mask guidance

To obtain the stepped border seen in the Borderlands reference:

- Represent the island as occupied square cells.
- Never smooth the silhouette with vector curves.
- Prefer contiguous regions at least two cells thick, except where a deliberate one-cell peninsula or bridge is desired.
- Avoid excessive isolated single cells; tile 16 supports them, but too many make the coast noisy.
- Use tiles 10–15 for narrow horizontal and vertical protrusions.
- Run a connectivity check so all required walkable land belongs to the intended island component.
- Keep spawn areas and critical routes away from accidental one-cell bottlenecks unless gameplay requires them.

For procedural generation, create a binary mask using seeded noise or cellular automata, then apply cleanup passes:

1. Keep the largest connected component.
2. Fill tiny one-cell holes unless they are intentional ponds.
3. Remove isolated cells.
4. Thicken fragile diagonals so cardinal movement remains possible.
5. Recalculate autotiles only after cleanup.

## Decorative props

Trees, rocks, buildings, and units are not part of the terrain autotile mask.

- Store prop anchors in logical cell coordinates.
- Draw props after terrain layers.
- Sort props by bottom/ground-contact Y.
- Keep collision and walkability in map data, not inferred from sprite pixels.
- Use seeded variation so repeated builds remain stable.
- Do not allow a decorative prop to hide stairs, a one-cell route, or a critical cliff opening.

## Rendering requirements

- Disable smoothing for native pixel-art presentation: `ctx.imageSmoothingEnabled = false`.
- Snap every tile origin to integer pixel coordinates.
- Avoid fractional camera translations at the native scale.
- Use source rectangles aligned exactly to the atlas regions.
- Do not rotate edge or cliff tiles unless the pack explicitly supplies rotation-safe artwork.
- Avoid per-tile color filters that blur edges; use alternate terrain palettes or overlays designed for the pack.
- Use a fixed atlas manifest rather than magic source coordinates scattered through rendering code.

Example manifest shape:

```ts
type AtlasFrame = { sx: number; sy: number; sw: number; sh: number }

const flatGround: Record<number, AtlasFrame> = {
  1:  { sx: 0,   sy: 0,   sw: 64, sh: 64 },
  // Populate from the actual licensed sprite sheet.
  16: { sx: 192, sy: 192, sw: 64, sh: 64 },
}
```

The example coordinates above illustrate the data structure only. Measure and verify the real atlas before filling the manifest.

## Validation checklist

- [ ] Logical tile size is 64 × 64.
- [ ] A 20 × 20 map produces a 1280 × 1280 native terrain region.
- [ ] The same seed and map data produce the same result.
- [ ] All ordinary edges and corners use tiles 1–9 correctly.
- [ ] One-cell horizontal strips use 10–12.
- [ ] One-cell vertical strips use 13–15.
- [ ] Isolated cells use 16.
- [ ] Elevated cliffs use the correct lower-terrain or water-facing family.
- [ ] Shadows are oversized, overlap neighboring cells, and are shifted down 64 px.
- [ ] Foam is below terrain and uses varied animation phases.
- [ ] Stairs have correct upper landing coverage.
- [ ] Stairs beside cliffs include both top and lower cliff support pieces.
- [ ] Oversized sprites are not clipped at map edges.
- [ ] No seams appear between adjacent tiles.
- [ ] No fractional-pixel placement or smoothing blurs the pixel art.
- [ ] Gameplay collision comes from cell data, not the rendered bitmap.

## Import caution

The official guide and diagrams identify shadow and foam frames as 128 × 128 placed on a 64 × 64 grid. A discussion in the guide comments reports alternate slicing settings for some distributed sheets. Claude must inspect the actual downloaded sprite-sheet dimensions and metadata before finalizing margins, separation, or texture-region values. Treat the official layout behavior as authoritative, but do not hardcode importer settings until the local asset files are measured.

Use the assets only under the license supplied with the Tiny Swords pack. Do not redistribute the original sprite sheets outside the permitted project scope.
