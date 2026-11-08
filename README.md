# Borderlands Online — First Playable

A browser-only strategy prototype focused on squad maneuver and moving territorial borders. The React layer owns setup and HUD; the Canvas 2D renderer draws a simulation implemented in plain TypeScript.

## Run

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. A production build is available with `npm run build`, and simulation verification runs with `npm test`.

## Controls

- Left-click a teal infantry counter to select it.
- With a squad selected, right-drag across passable land to draw its route. A quick right-click still creates a direct path.
- Shift + drag (or middle-drag) to pan.
- Scroll to zoom.
- Hover a tile to inspect its claim, current controller, and supply status.

## Design notes

- The repeatable 80 × 52 island includes water, forests, mountain barriers, a central river, two designated crossings, and a southern alternate route.
- Town claim, current control, occupation, and supply are stored in flat tile arrays.
- Town claims use four-direction breadth-first reachability and stable town-ID tie-breaking.
- Squad influence is recomputed while units move, shrinks when detached, and resolves overlapping influence by a stable score.
- Friendly towns and squads contribute additive metaball-style influence. Nearby sources pull their virtual centers together, producing wider joined territory and softly blended contested edges.
- Nearby cut-off squads link into a larger shared bubble while remaining independently selectable. Cut-off squads also lose health slowly until supply is restored.
- Movement uses damped steering, curved cornering, and slight lateral variation rather than perfectly straight interpolation.
- Supply uses four-direction connectivity through friendly-controlled tiles.
- `GAME_CONFIG` at the top of `src/sim.ts` contains town radius, squad influence, movement speed, capture duration, and combat tuning.

