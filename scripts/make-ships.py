"""Builds the blue base boat sprites (Small Infantry Boat + Zumwalt) from the two reference sheets; the game recolours them per kingdom colour.

Each reference sheet shows one (blue) ship in four orientations on a transparent glow:
  top-left = bow up, top-right = bow down, bottom-left = bow left, bottom-right = bow right.
The ship body is fully opaque and the glow is partly transparent, so the glow is cut away by thresholding alpha,
the sprite is scaled to game size (64 px tiles).
Output: public/assets/ships/{boat|zumwalt}_{up|down|left|right}.png   (the references are only read)
Run:  python3 scripts/make-ships.py
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage  # noqa  (connected components)

REF = 'references'
OUT = 'public/assets/ships'
os.makedirs(OUT, exist_ok=True)
SHEETS = {'boat': ('Small Infantry Boat.png', 195), 'zumwalt': ('Zumwalt Ship.png', 330)}  # length in px of the long side
QUADS = {'up': (0, 0), 'down': (1, 0), 'left': (0, 1), 'right': (1, 1)}


def find_ships(sheet: Image.Image) -> dict:
    """Segment the four ships over the whole sheet (they are taller than half of it), merging stray pieces such as flags."""
    a = np.array(sheet)
    solid = a[..., 3] >= 200
    merged = ndimage.binary_dilation(solid, iterations=8)
    lab, n = ndimage.label(merged)
    sizes = ndimage.sum(solid, lab, range(1, n + 1))
    top4 = [1 + int(i) for i in np.argsort(sizes)[::-1][:4]]
    h, w = solid.shape
    out = {}
    for cid in top4:
        ys, xs = np.where(lab == cid)
        cx, cy = xs.mean() / w, ys.mean() / h
        key = {(0, 0): 'up', (1, 0): 'down', (0, 1): 'left', (1, 1): 'right'}[(int(cx >= 0.5), int(cy >= 0.5))]
        keep = (lab == cid) & solid
        keep = ndimage.binary_fill_holes(keep)
        tile = a.copy()
        tile[..., 3] = np.where(keep, 255, 0)
        ys, xs = np.where(keep)
        out[key] = Image.fromarray(tile).crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    assert len(out) == 4, out.keys()
    return out


def scale(img: Image.Image, length: int) -> Image.Image:
    w, h = img.size
    k = length / max(w, h)
    out = img.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
    a = np.array(out)
    a[..., 3] = np.where(a[..., 3] >= 128, 255, 0)  # crisp pixel-art edge
    return Image.fromarray(a)


for kind, (fname, length) in SHEETS.items():
    sheet = Image.open(os.path.join(REF, fname)).convert('RGBA')
    found = find_ships(sheet)
    for d in QUADS:
        base = scale(found[d], length)
        base.save(os.path.join(OUT, f'{kind}_{d}.png'))  # the blue original: the game recolours it for every kingdom colour at load time
        print(kind, d, base.size)
