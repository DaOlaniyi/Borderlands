"""Crops the shipyard art (references/Shipyard.png, slipway on the right = water to the east) to its visible pixels and scales it to game size.
Output: public/assets/props/yard.png    Run:  python3 scripts/make-yard.py
"""
import os
from PIL import Image
im = Image.open('references/Shipyard.png').convert('RGBA')
a = im.split()[3].point(lambda v: 255 if v > 40 else 0)
im = im.crop(a.getbbox())
W = 225  # about 3.5 tiles wide
im = im.resize((W, round(im.height * W / im.width)), Image.LANCZOS)
os.makedirs('public/assets/props', exist_ok=True)
im.save('public/assets/props/yard.png')
print(im.size)
