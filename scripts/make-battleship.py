"""Builds the Battleship sprites from references/Battleship.png (four views of the hull) and references/battleship cannon.png (the deck turret).

Same method as make-ships.py: the sheet shows one ship in four orientations (top-left bow up, top-right bow down, bottom-left bow left, bottom-right bow right) on a
transparent glow that is cut away by thresholding alpha, then scaled to game size.
Output: public/assets/ships/battleship_{up|down|left|right}.png and battleship_turret.png (the triple-barrel turret, barrels pointing UP; the game rotates it).
Run:  python3 scripts/make-battleship.py
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage

REF, OUT = 'references', 'public/assets/ships'
LENGTH = 420  # long side of the hull in px (6.6 tiles of 64)
TURRET_H = 74  # height of the deck turret in px
os.makedirs(OUT, exist_ok=True)


def find_ships(sheet):
    """Each view is cut from its own quadrant (the top views and the side views nearly touch, so a whole-sheet segmentation would merge them)."""
    a = np.array(sheet)
    h, w = a.shape[:2]
    cut = {'up': (0, 0, w // 2, 685), 'down': (w // 2, 0, w, 685), 'left': (0, 685, w // 2, h), 'right': (w // 2, 685, w, h)}
    out = {}
    for key, (x0, y0, x1, y1) in cut.items():
        sub = a[y0:y1, x0:x1].copy()
        solid = sub[..., 3] >= 200
        lab, n = ndimage.label(ndimage.binary_dilation(solid, iterations=8))
        sizes = ndimage.sum(solid, lab, range(1, n + 1))
        keep = ndimage.binary_fill_holes((lab == 1 + int(np.argmax(sizes))) & solid)
        sub[..., 3] = np.where(keep, 255, 0)
        ys, xs = np.where(keep)
        out[key] = Image.fromarray(sub).crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    return out


def crisp(img, k):
    out = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
    a = np.array(out); a[..., 3] = np.where(a[..., 3] >= 128, 255, 0)
    return Image.fromarray(a)


found = find_ships(Image.open(os.path.join(REF, 'Battleship.png')).convert('RGBA'))
k = LENGTH / max(found['left'].size)
for d, im in found.items():
    s = crisp(im, k); s.save(os.path.join(OUT, f'battleship_{d}.png')); print('battleship', d, s.size)

# the turret: cut from its white/transparent background (flood fill from the border through near-white / transparent pixels)
t = Image.open(os.path.join(REF, 'battleship cannon.png')).convert('RGBA')
a = np.array(t)
lum = a[..., :3].astype(float) @ np.array([0.299, 0.587, 0.114])
bg = (a[..., 3] < 40) | (lum > 232)
lab, n = ndimage.label(bg)
edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
outside = np.isin(lab, list(edge))
a[..., 3] = np.where(outside, 0, 255)
t = Image.fromarray(a); t = t.crop(t.getchannel('A').getbbox())
s = crisp(t, TURRET_H / t.height); s.save(os.path.join(OUT, 'battleship_turret.png')); print('turret', s.size)
