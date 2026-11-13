"""Cuts the settlement / crate props out of the Cainos TX Props sheet using the slice rectangles Unity wrote to the .meta file.
Output: public/assets/props/{pillar,statue,crate}.png  (the Cainos files are only read; Unity's y axis runs bottom-up)
Run:  python3 scripts/slice-props.py
"""
import os, re
from PIL import Image

TEX = 'Art Assets - Cainos/Pixel Art Top Down - Basic v1.2.3/Texture'
OUT = 'public/assets/props'
os.makedirs(OUT, exist_ok=True)
sheet = Image.open(os.path.join(TEX, 'TX Props.png')).convert('RGBA')
meta = open(os.path.join(TEX, 'TX Props sliced.png.meta')).read()
rects = {m[0]: tuple(float(v) for v in m[1:]) for m in re.findall(r'name: (TX Props copy_\d+)\n\s+rect:\n\s+serializedVersion: 2\n\s+x: ([\d.]+)\n\s+y: ([\d.]+)\n\s+width: ([\d.]+)\n\s+height: ([\d.]+)', meta)}
PICK = {'pillar': 'TX Props copy_28', 'statue': 'TX Props copy_7', 'crate': 'TX Props copy_2'}  # level 1 pillar, level 2 statue (woman), wooden crate
for out, name in PICK.items():
    x, y, w, h = rects[name]
    top = sheet.height - y - h
    sheet.crop((int(x), int(top), int(x + w), int(top + h))).save(os.path.join(OUT, out + '.png'))
    print(out, int(w), int(h))
