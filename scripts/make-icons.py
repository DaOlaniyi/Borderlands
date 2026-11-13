"""Tight-crops the gold and meat resource sprites into HUD icons (the Tiny Swords gold sprite sits in a mostly empty 128x128 frame).
Output: public/assets/icons/{gold,meat}.png   Run:  python3 scripts/make-icons.py
"""
import os
from PIL import Image

SRC = 'public/assets/ts/Terrain/Resources'
OUT = 'public/assets/icons'
os.makedirs(OUT, exist_ok=True)
for name, path in {'gold': 'Gold/Gold Resource/Gold_Resource.png', 'meat': 'Meat/Meat Resource/Meat Resource.png'}.items():
    im = Image.open(os.path.join(SRC, path)).convert('RGBA')
    box = im.getbbox()
    im = im.crop(box)
    pad = Image.new('RGBA', (im.width + 2, im.height + 2), (0, 0, 0, 0))
    pad.paste(im, (1, 1))
    pad.save(os.path.join(OUT, name + '.png'))
    print(name, pad.size)
