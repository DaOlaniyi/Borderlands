"""Dev tool: renders every kingdom colour on the real sprites so the palette can be judged by eye (and tuned).

The 5 native Tiny Swords families (Blue, Red, Yellow, Purple, Black) are used as they are. Every other colour is made from the Blue
family: the pixels that differ between the families are the "team" pixels; only those are hue-shifted / re-saturated / re-lit.
The same maths lives in src/game/Palette.ts (the game recolours at run time) - keep them in step.
Run:  python3 scripts/palette-preview.py [out.png]
"""
import colorsys, glob, json, os, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TS = os.path.join(ROOT, 'public/assets/ts')
FAMS = ['Black', 'Blue', 'Purple', 'Red', 'Yellow']
PALETTE = json.load(open(os.path.join(ROOT, 'src/game/palette.json')))
BAND = (150, 270, 0.12)  # hue range (deg) and minimum saturation of the Blue family's team colour


def img(fam, rel):
    return np.array(Image.open(os.path.join(TS, rel.replace('FAM', fam))).convert('RGBA'))


def team_mask(rel):
    arrs = [img(f, rel).astype(int) for f in FAMS]
    d = np.zeros(arrs[0].shape[:2], bool)
    for a in arrs:
        d |= np.abs(arrs[1] - a).sum(-1) > 0
    return d & (arrs[1][..., 3] > 0)


def recolor(base, mask, spec):
    out = base.copy().astype(np.float32) / 255
    ys, xs = np.where(mask)
    shift, smul, lmul, ladd = spec['shift'], spec['sat'], spec['light'], spec.get('lightAdd', 0)
    for y, x in zip(ys, xs):
        r, g, b = out[y, x, :3]
        h, l, s = colorsys.rgb_to_hls(r, g, b)
        if not (BAND[0] <= h * 360 <= BAND[1]) or s < BAND[2]:
            continue  # wood, gold, skin etc. keep their colour even where the families differ
        h = (h + shift / 360) % 1
        s = min(1, s * smul)
        l = min(1, max(0, l * lmul + ladd))
        out[y, x, :3] = colorsys.hls_to_rgb(h, l, s)
    return Image.fromarray((out * 255).astype(np.uint8))


SPR = [('Units/FAM Units/Warrior/Warrior_Idle.png', 192, 0), ('Units/FAM Units/Archer/Archer_Idle.png', 192, 0), ('Units/FAM Units/Lancer/Lancer_Idle.png', 320, 0),
       ('Units/FAM Units/Pawn/Pawn_Idle.png', 192, 0), ('Buildings/FAM Buildings/House1.png', 0, 0), ('Buildings/FAM Buildings/Tower.png', 0, 0)]
CELL = 150
sheet = Image.new('RGBA', (len(SPR) * CELL + 150, len(PALETTE) * CELL), (96, 150, 70, 255))
from PIL import ImageDraw
dr = ImageDraw.Draw(sheet)
for row, c in enumerate(PALETTE):
    dr.rectangle([4, row * CELL + 4, 140, row * CELL + CELL - 4], fill=tuple(int(c['hex'][i:i + 2], 16) for i in (1, 3, 5)) + (255,))
    dr.text((10, row * CELL + 10), f"{row} {c['name']}", fill=(255, 255, 255, 255))
    for col, (rel, fw, fr) in enumerate(SPR):
        native = c.get('native')
        fam = native if native else 'Blue'
        a = img(fam, rel)
        if fw:
            a = a[:, fr * fw:(fr + 1) * fw]
        if not native:
            m = team_mask(rel)
            if fw:
                m = m[:, fr * fw:(fr + 1) * fw]
            im = recolor(a, m, c)
        else:
            im = Image.fromarray(a)
        bb = im.getbbox() or (0, 0, 1, 1)
        im = im.crop(bb)
        k = min((CELL - 10) / im.width, (CELL - 10) / im.height, 1.0)
        im = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.NEAREST)
        sheet.alpha_composite(im, (150 + col * CELL + (CELL - im.width) // 2, row * CELL + (CELL - im.height) // 2))
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ.get('TMPDIR', '/tmp'), 'palette.png')
sheet.save(out)
print('wrote', out)
