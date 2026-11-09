# Generation prompts

Mode: built-in image generation tool, using both supplied map images as style references. The approved medium forest cluster was also used as a style anchor for the other vegetation sprites. Transparent output was requested for all vegetation and cliff pieces.

## Shared vegetation prompt

```text
Use case: stylized-concept
Asset type: isolated 2D strategy-game map vegetation sprite
Input images: Images 1 and 2 are map-art style references only. Image 3 is the approved visual style anchor; match its ink weight, conifer construction, muted palette, elevated map angle, and upper-left lighting. Do not reproduce any UI or map layout.
Style/medium: original hand-inked medieval atlas game illustration, dark brown charcoal outlines, restrained hatching, softly painted fills, slightly irregular hand-drawn forms, strong small-scale silhouette.
Composition/framing: shallow elevated top-down map view with modest front faces; isolated centered sprite; bottom-center ground-contact anchor; generous transparent padding; no cropping.
Color palette: dark evergreen #244B36 to muted forest #3E6A43, subdued olive highlights, brown trunks and ink.
Constraints: genuinely transparent background with preserved alpha; no ground tile; no text; no watermark; no grid; no UI; no territory tint; no buildings; no flags.
Avoid: photorealism, glossy 3D, strict isometric art, pixel art, flat vector art, neon colors, dramatic shadows, opaque backdrop.
```

Subjects: one mature pine; one 5–7 tree cluster; one 14–20 tree medium cluster; one 28–36 tree large forest mass.

## Shared terrain prompt

```text
Use case: stylized-concept
Asset type: seamless tileable 2D strategy-game land texture
Input images: Images 1 and 2 are style and palette references only; use only their un-tinted neutral terrain language. Do not reproduce UI, grid, territory overlays, symbols, roads, rivers, trees, mountains, buildings, or map layout.
Style/medium: original hand-painted medieval atlas ground texture, subtle parchment grain, restrained ink-like grass marks, softly mottled color, low contrast, clean strategy-game readability.
Composition/framing: perfectly square direct top-down texture, edge-to-edge, uniformly distributed detail, no central focal point, designed to repeat seamlessly on all four edges.
Lighting/mood: neutral diffuse daylight with no directional cast shadow.
Constraints: opaque square image; genuinely seamless/tileable left-to-right and top-to-bottom; no border; no frame; no text; no watermark; no grid; no tile lines; no objects; no territory tint.
Avoid: photorealistic soil, glossy 3D, obvious repeating motifs, vignette, large stones, flowers, paths, rivers, shadows, symbols, pixel art, flat vector art.
```

Subjects: muted ochre-green meadow; warm dry yellow-green grassland; neutral warm bare earth.

## Shared coastal cliff prompt

```text
Use case: stylized-concept
Asset type: isolated modular 2D strategy-game coastal cliff overlay sprite
Input images: Images 1 and 2 are style references only. Match their rocky island coastline: narrow muted ochre-green land rim above a visible gray-brown faceted cliff face. Do not reproduce UI, grid, territory overlays, buildings, trees, mountains, roads, water field, or map layout.
Style/medium: original hand-inked medieval atlas illustration, dark brown charcoal outlines, angular hand-painted stone planes, restrained inner hatching, slightly irregular contour, bold small-scale silhouette.
View: shallow elevated top-down map view. The land surface is visible above; the cliff face descends toward the viewer/lower edge. Warm upper-left light; compact shading lower right.
Color palette: muted meadow top #AAA663 to #C0B66F, pale sandy rim #C8B574, stone mid #81786C, stone dark #514B47, light planes #B8AA91, dark brown ink.
Constraints: genuinely transparent background with preserved alpha; isolated complete modular cliff piece; transparent padding; no rectangular background; no ocean fill; no text; no watermark; no grid; no UI; no territory tint; no buildings; no vegetation.
Avoid: photorealism, glossy 3D, strict isometric blocks, pixel art, flat vector art, floating island, giant boulders, caves, waterfalls, dramatic shadows, neon color, cropped silhouette.
```

Subjects: straight ledge; convex outer headland; concave inlet corner; isolated shoreline outcrop.

## Narrow coastline edge overlay prompt

```text
Use case: stylized-concept
Asset type: modular 2D strategy-game coastline trim sprite
Input images: Image 1 is the exact meadow color reference. Image 2 is the previous coastal rock style reference. Image 3 is the approved narrow cliff-edge anchor; match its thin lip, rock height, line weight, faceted planes, muted medieval-atlas palette, and upper-left lighting.
Primary construction rule: This is narrow coastline trim placed beneath a separately rendered land polygon, never a land platform. Grass lip is only 8–12% of object height, pale sandy rim about 5–8%, exposed rock face 75–85%. No broad meadow top.
Style/medium: original hand-inked medieval atlas illustration with dark brown charcoal outline, restrained hatching, angular softly painted stone planes.
Connection rule: every open end must match the approved anchor's cliff-face height and terminate cleanly so pieces can overlap 10–15%.
Constraints: genuinely transparent background and preserved alpha; one isolated complete edge piece; clean antialiased boundary; no haze, glow, mist, shadow cloud, speckles, or stray pixels outside the artwork; no ocean fill; no land mass; no island; no trees; no buildings; no grid; no UI; no territory tint; no text; no watermark; no cropping.
Avoid: broad grassy surface, floating slab, photorealism, glossy 3D, strict isometric blocks, pixel art, flat vector art.
```

Subjects: straight edge, rising diagonal, falling diagonal, convex bend, concave bend, and right end cap. Two cleanup passes used background extraction to remove generated haze while preserving the cliff artwork.
