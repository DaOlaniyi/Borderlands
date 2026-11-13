"""Builds the Knight sprite strips from references/Knight/{idle,run,attack}.png (the artist's sheets; they face right).

  idle.png   8 frames in a row         -> public/assets/knight/Knight_Idle.png   (8 cells)
  run.png    6 frames in a row         -> public/assets/knight/Knight_Run.png    (6 cells)
  attack.png 12 frames, 4 across x 3   -> public/assets/knight/Knight_Attack.png (12 cells, read left-to-right, top-to-bottom: ready, couch the lance, thrust, recover)

Every frame is cut out as one connected piece (the lance and its swoosh stay attached to the knight), all are scaled by ONE factor (the attack sheet was drawn
larger, so it gets the matching smaller factor, found by comparing its ready pose with the idle one), and placed in a 192x192 cell:
  * horizontally, by the rider's golden helmet (the horse and lance move a lot in a thrust, the rider's head is the steadiest thing to hold still);
  * vertically, by the hooves: idle and run keep the artist's own bob (one baseline for the whole sheet), the attack frames are each put on the ground.
The game recolours the blues (plume, cloth, lance stripes) per kingdom colour. Run:  python3 scripts/make-knight.py
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = 'references/Knight'
OUT = 'public/assets/knight'
CELL, BASE, K = 192, 146, 0.66   # frame size, row of the hooves, scale of the idle/run sheets
HELMET_X = 94                    # column the helmet is held at
os.makedirs(OUT, exist_ok=True)


def load(name):
    return np.array(Image.open(os.path.join(SRC, f'{name}.png')).convert('RGBA'))


def pieces(a, grid_h=None):
    """The knights of a sheet as (rgba crop, mask crop, x0, y0, helmet x within the crop), in reading order."""
    solid = a[..., 3] >= 128
    lab, n = ndimage.label(ndimage.binary_dilation(solid, iterations=10))
    sizes = ndimage.sum(solid, lab, range(1, n + 1))
    out = []
    for cid in [i + 1 for i, s in enumerate(sizes) if s > 3000]:
        body = ndimage.binary_fill_holes((lab == cid) & solid)
        region = ndimage.binary_dilation(body, iterations=6) & (a[..., 3] > 0)   # keeps the soft swoosh around the lance
        ys, xs = np.where(region)
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        crop = a[y0:y1, x0:x1].copy(); crop[~region[y0:y1, x0:x1]] = 0
        rgb = crop[..., :3].astype(int)
        helmet = (crop[..., 3] > 200) & (rgb[..., 0] >= 170) & (rgb[..., 0] <= 210) & (rgb[..., 1] >= 135) & (rgb[..., 1] <= 172) & (rgb[..., 2] >= 85) & (rgb[..., 2] <= 128) & (rgb[..., 0] - rgb[..., 2] > 55)
        # the helmet is the biggest tan blob in the upper half (the horse's coat is darker, the lance base paler)
        hl, hn = ndimage.label(helmet)
        if hn:
            hs = ndimage.sum(helmet, hl, range(1, hn + 1)); keep = hl == (1 + int(np.argmax(hs)))
            hx = np.where(keep)[1].mean()
        else:
            hx = (x1 - x0) / 2
        out.append((crop, body[y0:y1, x0:x1], x0, y0, hx))
    return out


def strip(frames, k, per_frame_ground, sheet_base=None):
    """Place each piece in its cell. `frames`: pieces in order. Returns the strip image and the per-frame boxes (for the log)."""
    sheet = Image.new('RGBA', (CELL * len(frames), CELL), (0, 0, 0, 0))
    for i, (crop, body, x0, y0, hx) in enumerate(frames):
        img = Image.fromarray(crop)
        w, h = max(1, round(img.width * k)), max(1, round(img.height * k))
        img = img.resize((w, h), Image.LANCZOS)
        arr = np.array(img); arr[..., 3] = np.where(arr[..., 3] < 40, 0, arr[..., 3]); img = Image.fromarray(arr)  # (crisp edges, soft swoosh kept)
        dx = round(HELMET_X - hx * k)
        if per_frame_ground:
            ys = np.where(body.any(axis=1))[0]; bottom = ys.max() + 1
            dy = BASE - round(bottom * k)
        else:
            dy = BASE - round((sheet_base - (y0 + crop.shape[0])) * k) - h   # the artist's own bob: one baseline for the whole sheet
        sheet.alpha_composite(img, (i * CELL + dx, dy))
    return sheet


# ---- idle and run: one row each, left to right
idle = sorted(pieces(load('idle')), key=lambda p: p[2])
run = sorted(pieces(load('run')), key=lambda p: p[2])
sheet_base = max(p[3] + p[0].shape[0] for p in idle)                   # the row of the hooves in the idle sheet
run_base = max(p[3] + p[0].shape[0] for p in run)
strip(idle, K, False, sheet_base).save(os.path.join(OUT, 'Knight_Idle.png'))
strip(run, K, False, run_base).save(os.path.join(OUT, 'Knight_Run.png'))
print('idle', len(idle), 'frames; run', len(run), 'frames')

# ---- attack: a 4x3 grid of cells; the sheet was drawn larger than the others, so scale it to match the idle pose
atk = pieces(load('attack'))
cell = 1448 / 4
atk.sort(key=lambda p: (int(((p[3] + p[0].shape[0] / 2) // cell)), p[2]))
ready_h, idle_h = atk[0][0].shape[0], idle[0][0].shape[0]
ka = K * idle_h / ready_h
strip(atk, ka, True).save(os.path.join(OUT, 'Knight_Attack.png'))
print('attack', len(atk), 'frames; scale', round(ka, 3), 'vs', K)
