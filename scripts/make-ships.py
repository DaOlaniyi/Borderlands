"""Builds the blue base boat sprites (Small Infantry Boat, Zumwalt, Cargo Boat, Gunship) from the two reference sheets; the game recolours them per kingdom colour.

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
SHEETS = {'boat': ('Small Infantry Boat.png', 195), 'zumwalt': ('Zumwalt Ship (Version 2).png', 330), 'cargo': ('Small Infantry Boat (Resized).png', 100),  # length in px of the long side
          'gunship': ('Gun Boat.png', 135)}  # (the Zumwalt is the teal "Version 2" design with guns on both flanks; "Zumwalt Ship.png" is the old blue one. The "Resized" sheet is the crate-and-sail cargo design at half size; the gunship stays smaller than a Zumwalt)
QUADS = {'up': (0, 0), 'down': (1, 0), 'left': (0, 1), 'right': (1, 1)}


def find_ships(sheet: Image.Image, quads=None) -> dict:
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
        key = (quads or {(0, 0): 'up', (1, 0): 'down', (0, 1): 'left', (1, 1): 'right'})[(int(cx >= 0.5), int(cy >= 0.5))]
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


# ---------------------------------------------------------------------------------------------------------------------
# The barge: a landing craft whose bow is a ramp. Two sheets, ramp raised ("Barge Ship (Closed).png") and lowered ("Barge Ship (open).png"). In them the ramp
# end is the BOW, so the top-left ship points DOWN and the top-right one UP (the reverse of the other sheets). Both are scaled by the same factor
# (long side of the closed side view = BARGE_LEN px) and the open one is registered onto the closed one by its hull, so the game can swap them in place:
#   barge_{dir}.png (closed), bargeopen_{dir}.png (open), and src/game/bargeOffsets.json = where the closed sprite's top-left lies inside the open sprite.
# ---------------------------------------------------------------------------------------------------------------------
import json
BARGE_LEN = 215
BARGE_QUADS = {(0, 0): 'down', (1, 0): 'up', (0, 1): 'left', (1, 1): 'right'}


def crisp(img: Image.Image, k: float) -> Image.Image:
    out = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
    a = np.array(out)
    a[..., 3] = np.where(a[..., 3] >= 128, 255, 0)
    return Image.fromarray(a)


def register(closed: Image.Image, opened: Image.Image):
    """Where (ox, oy) the closed sprite's top-left sits inside the open sprite so their hulls coincide (best overlap of the two silhouettes)."""
    c = np.array(closed)[..., 3] > 0
    pad = 30
    o = np.pad(np.array(opened)[..., 3] > 0, pad)
    ch, cw = c.shape
    best, at = -1e9, (0, 0)
    for oy in range(0, o.shape[0] - ch + 1):
        for ox in range(0, o.shape[1] - cw + 1):
            win = o[oy:oy + ch, ox:ox + cw]
            score = int((c & win).sum()) - 0.6 * int((c & ~win).sum())
            if score > best:
                best, at = score, (ox, oy)
    return at[0] - pad, at[1] - pad


def trim_halo(img: Image.Image) -> Image.Image:
    """The sheets' pale glow survives the alpha cut as a white fringe: everything outside the hull's dark outline (reached by flood fill from the border without crossing it) is cleared."""
    a = np.array(img)
    lum = a[..., :3].astype(float) @ np.array([0.299, 0.587, 0.114])
    solid = a[..., 3] > 0
    dark = solid & (lum < 105)
    free = np.pad(~dark, 1, constant_values=True)
    lab, n = ndimage.label(free)
    outside = lab == lab[0, 0]
    outside = outside[1:-1, 1:-1]
    a[..., 3] = np.where(outside & ~dark, 0, a[..., 3])
    return Image.fromarray(a)


closed = find_ships(Image.open(os.path.join(REF, 'Barge Ship (Closed).png')).convert('RGBA'), BARGE_QUADS)
opened = find_ships(Image.open(os.path.join(REF, 'Barge Ship (open).png')).convert('RGBA'), BARGE_QUADS)
closed = {d: trim_halo(i) for d, i in closed.items()}
opened = {d: trim_halo(i) for d, i in opened.items()}
k = BARGE_LEN / closed['left'].width
offsets = {}
for d in QUADS:
    c = crisp(closed[d], k)
    o0 = crisp(opened[d], k)
    # (the two sheets were not drawn at quite the same size: scale the open one so its beam, the dimension the ramp does not change, equals the closed one's)
    ko = k * ((c.height / o0.height) if d in ('left', 'right') else (c.width / o0.width))
    o = crisp(opened[d], ko)
    c.save(os.path.join(OUT, f'barge_{d}.png')); o.save(os.path.join(OUT, f'bargeopen_{d}.png'))
    offsets[d] = list(register(c, o))
    print('barge', d, c.size, 'open', o.size, 'offset', offsets[d])
with open('src/game/bargeOffsets.json', 'w') as f:
    json.dump(offsets, f)
