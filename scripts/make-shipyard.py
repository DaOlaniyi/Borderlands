"""Draws a demonstration shipyard / boathouse (blue base colours; the game would recolour it per kingdom) in the palette of the ship sprites:
orange planking, blue tiled roof, gold trim. The building faces the water (south): a slipway of planks runs out from the open boat door with
a half-built hull on it, barrels and crates stand on the quay.
Drawn on a 128x128 pixel grid and enlarged 4x (nearest) to references/Shipyard.png.   Run:  python3 scripts/make-shipyard.py
"""
from PIL import Image, ImageDraw
import random

W = H = 128
S = 4
random.seed(7)
img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

OL = (28, 20, 26, 255)
WOOD = (214, 138, 58, 255); WOOD_L = (242, 176, 84, 255); WOOD_D = (150, 86, 38, 255); WOOD_DD = (104, 58, 30, 255)
BLUE = (62, 96, 160, 255); BLUE_L = (104, 142, 206, 255); BLUE_D = (36, 58, 112, 255)
GOLD = (240, 190, 52, 255); GOLD_D = (178, 124, 30, 255)
STONE = (120, 122, 132, 255); STONE_D = (78, 80, 92, 255)
DARK = (34, 26, 34, 255)


def rect(x0, y0, x1, y1, fill, outline=OL):
    d.rectangle([x0, y0, x1, y1], fill=fill, outline=outline)


def poly(pts, fill, outline=OL):
    d.polygon(pts, fill=fill, outline=outline)


# ---- slipway / pier (planks running south into the water) -------------------------------------------------
rect(40, 84, 88, 126, WOOD_D)
for y in range(86, 126, 5):
    d.line([(41, y), (87, y)], fill=WOOD_DD)
for y in range(84, 126, 5):
    for x in range(42 + (y // 5 % 2) * 6, 88, 12):
        d.point((x, y + 2), fill=WOOD_L)
rect(40, 84, 88, 126, None)
# posts with gold caps
for (x, y) in [(38, 92), (90, 92), (38, 112), (90, 112), (38, 124), (90, 124)]:
    rect(x - 2, y - 4, x + 2, y + 3, WOOD_DD)
    d.rectangle([x - 2, y - 5, x + 2, y - 3], fill=GOLD, outline=OL)
# rope between the posts
for (x0, x1) in [(38, 38), (90, 90)]:
    d.line([(x0, 92), (x1, 112)], fill=(190, 160, 110, 255))

# ---- half-built hull on the slipway ------------------------------------------------------------------------
hull = [(52, 118), (50, 104), (56, 94), (72, 94), (78, 104), (76, 118), (64, 124)]
poly(hull, WOOD_DD)
d.line([(64, 95), (64, 123)], fill=GOLD_D)
for y in range(98, 122, 5):  # ribs
    d.line([(54, y), (74, y)], fill=WOOD_L)
for y in range(98, 122, 5):  # planking only on the lower half
    pass
poly([(53, 112), (51, 106), (56, 108), (72, 108), (77, 106), (75, 112), (64, 120)], WOOD)  # planked section
for y in (110, 114, 118):
    d.line([(56, y), (72, y)], fill=WOOD_D)
d.line(hull + [hull[0]], fill=OL)
# bow marker
d.polygon([(62, 125), (66, 125), (64, 128)], fill=GOLD, outline=OL)

# ---- barrels and crates on the quay -----------------------------------------------------------------------
def barrel(x, y):
    d.ellipse([x - 5, y - 4, x + 5, y + 8], fill=WOOD, outline=OL)
    d.line([(x - 5, y), (x + 5, y)], fill=STONE_D)
    d.line([(x - 5, y + 4), (x + 5, y + 4)], fill=STONE_D)
    d.ellipse([x - 4, y - 5, x + 4, y - 1], fill=WOOD_L, outline=OL)


def crate(x, y):
    rect(x - 6, y - 6, x + 6, y + 6, WOOD)
    d.line([(x - 6, y - 6), (x + 6, y + 6)], fill=WOOD_D)
    d.line([(x + 6, y - 6), (x - 6, y + 6)], fill=WOOD_D)
    rect(x - 6, y - 6, x + 6, y + 6, None)


barrel(26, 96); barrel(34, 100)
crate(20, 108); crate(100, 100); crate(108, 106); barrel(100, 90)

# ---- the boathouse -----------------------------------------------------------------------------------------
# back wall (planked) and its dark shadow under the roof
rect(18, 44, 110, 84, WOOD)
for x in range(22, 110, 8):
    d.line([(x, 46), (x, 83)], fill=WOOD_D)
for y in (56, 70):
    d.line([(19, y), (109, y)], fill=WOOD_D)
for x in range(20, 110, 8):  # nail heads
    d.point((x, 58), fill=WOOD_DD); d.point((x, 72), fill=WOOD_DD)
rect(18, 44, 110, 84, None)
# stone footing
rect(16, 80, 112, 88, STONE)
for x in range(18, 112, 9):
    d.line([(x, 81), (x, 87)], fill=STONE_D)
d.line([(16, 84), (112, 84)], fill=STONE_D)
rect(16, 80, 112, 88, None)
# blue timber corner posts with gold studs
for x0 in (14, 106):
    rect(x0, 40, x0 + 6, 88, BLUE)
    d.line([(x0 + 2, 42), (x0 + 2, 86)], fill=BLUE_L)
    for y in (48, 62, 76):
        d.point((x0 + 3, y), fill=GOLD)
    rect(x0, 40, x0 + 6, 88, None)
# big open boat door (arched), dark inside with the bow of a ship showing
door = [(44, 86), (44, 58), (50, 50), (78, 50), (84, 58), (84, 86)]
poly(door, DARK)
poly([(54, 86), (56, 68), (72, 68), (74, 86)], WOOD_DD)  # hull inside
d.line([(64, 70), (64, 86)], fill=GOLD_D)
for y in (74, 79, 84):
    d.line([(57, y), (71, y)], fill=WOOD)
d.line(door + [door[0]], fill=OL)
# door frame (blue stone arch)
d.line([(43, 86), (43, 57), (49, 49), (79, 49), (85, 57), (85, 86)], fill=BLUE_D, width=3)
d.line([(42, 86), (42, 57), (48, 48), (80, 48), (86, 57), (86, 86)], fill=OL)
d.rectangle([60, 46, 68, 52], fill=GOLD, outline=OL)  # keystone
# little windows
for x0 in (26, 92):
    rect(x0, 56, x0 + 8, 66, DARK)
    d.line([(x0 + 4, 56), (x0 + 4, 66)], fill=WOOD_D)
    rect(x0 - 1, 55, x0 + 9, 67, None, OL)
# ---- roof (blue tiles, gold ridge), overhanging --------------------------------------------------------------
roof = [(6, 46), (22, 12), (106, 12), (122, 46)]
poly(roof, BLUE)
rows = [(14, 22), (22, 30), (30, 38), (38, 46)]
for i, (ya, yb) in enumerate(rows):
    x_in = 22 - (22 - 6) * (ya - 12) / 34
    x_out = 106 + (122 - 106) * (ya - 12) / 34
    n = 0
    x = x_in + (4 if i % 2 else 0)
    while x < x_out - 3:
        d.rectangle([x, ya + 1, x + 8, yb - 1], fill=BLUE_L if (n + i) % 3 == 0 else BLUE, outline=BLUE_D)
        x += 9; n += 1
d.polygon(roof, outline=OL)
d.line([(6, 46), (122, 46)], fill=OL)
d.rectangle([4, 45, 124, 49], fill=BLUE_D, outline=OL)  # eave
d.rectangle([20, 8, 108, 13], fill=GOLD, outline=OL)  # ridge
d.line([(22, 10), (106, 10)], fill=(255, 224, 120, 255))
# gold shield emblem on the gable
poly([(58, 20), (70, 20), (70, 30), (64, 36), (58, 30)], BLUE_D)
poly([(60, 22), (68, 22), (68, 29), (64, 33), (60, 29)], BLUE_L)
d.line([(64, 22), (64, 33)], fill=GOLD)
# little flag on the ridge
d.line([(100, 2), (100, 12)], fill=OL, width=2)
poly([(101, 2), (112, 5), (101, 9)], BLUE_L)
d.rectangle([98, 0, 102, 3], fill=GOLD, outline=OL)
# anchor sign above the door? a plank sign
rect(52, 40, 76, 47, WOOD_L)
d.line([(64, 41), (64, 46)], fill=OL); d.line([(61, 43), (67, 43)], fill=OL)

# ---- soft shadow under everything (kept inside the sprite) --------------------------------------------------
sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
sd = ImageDraw.Draw(sh)
sd.ellipse([10, 84, 118, 98], fill=(0, 0, 0, 60))
img = Image.alpha_composite(sh, img)

out = img.resize((W * S, H * S), Image.NEAREST)
out.save('references/Shipyard.png')
print('wrote references/Shipyard.png', out.size)
