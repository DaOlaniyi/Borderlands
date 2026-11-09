# Borderlands Map Assets — Terrain Pass 01

Generated from the supplied `largeMapExample.png` and `medium map.png` as visual references. This pass deliberately includes only vegetation, land terrain, and coastal cliffs. Castles and other structures are reserved for a later pass.

## Contents

- `vegetation/`: 4 transparent conifer sprites, sized for direct Canvas use.
- `terrain/`: 3 opaque 256 × 256 painted terrain textures.
- `coast/`: 4 standalone headland pieces plus 6 narrow coastline edge overlays.
- `sources/`: full-resolution generated source images.
- `previews/index.html`: visual catalog and simple compositing preview.
- `manifest.json`: dimensions, anchors, nominal cell footprints, and tags.
- `generation-prompts.md`: the exact prompt set and generation mode.

## Runtime assumptions

- Borderlands currently uses a 22 px logical cell.
- Standing props use a normalized bottom-center anchor (`0.5`, `0.92`).
- Cliff pieces use a normalized bottom-center anchor (`0.5`, `1.0`).
- Textures are intended to repeat across the terrain canvas. They were explicitly generated as seamless textures, but final edge behavior should be checked in the live renderer before shipping.
- Transparent pieces include soft antialiasing and a restrained painted contact glow/shadow from the source render. Test them over both neutral land and dark water.

## Suggested draw order

1. Base terrain texture
2. Territory tint and border
3. Coastal cliff overlays
4. Vegetation sorted by ground-contact Y
5. Units, paths, selection markers, labels, and UI

## Validation

- 17 unique runtime PNG files
- All four vegetation sprites: RGBA with alpha
- All ten cliff sprites: RGBA with alpha
- All three terrain textures: opaque RGB, 256 × 256
- No duplicate hashes
- No castles, buildings, labels, UI, faction colors, or grids included

The full-resolution files in `sources/` are retained so later revisions can be downsampled differently without regenerating the artwork.
