"""
More precise measurement: look for the circular red border only in the center area.
Also identify the exact text block positions.
"""
from PIL import Image
import numpy as np

img = Image.open("/home/karthikeyan/vscode/api-EcoSudar/1.png").convert("RGB")
px = np.array(img)
H, W, _ = px.shape

r, g, b = px[:,:,0], px[:,:,1], px[:,:,2]

# Red mask — only look in the LEFT portion (x < 450) to avoid right-side stripes
red_mask = (r > 160) & (g < 80) & (b < 80)
# Zero out right side
red_mask[:, 450:] = False
# Zero out top 100px (logo area has some red)
red_mask[:100, :] = False

rows = np.any(red_mask, axis=1)
cols = np.any(red_mask, axis=0)
rmin, rmax = np.where(rows)[0][[0, -1]]
cmin, cmax = np.where(cols)[0][[0, -1]]

print(f"Red circle (filtered, x<450, y>100):")
print(f"  Bounding box: x={cmin}..{cmax}, y={rmin}..{rmax}")
print(f"  Width={cmax-cmin}, Height={rmax-rmin}")
cx = (cmin + cmax) // 2
cy = (rmin + rmax) // 2
radius_w = (cmax - cmin) // 2
radius_h = (rmax - rmin) // 2
print(f"  Center: ({cx}, {cy})")
print(f"  Radius (w): {radius_w}, Radius (h): {radius_h}")
print(f"  Photo inner radius (~border 6px): {radius_w - 6}")

# Find text blocks
gray = 0.299 * r + 0.587 * g + 0.114 * b
text_mask = (gray < 60) & (np.arange(W)[np.newaxis, :] < 500)  # text only, x < 500

# Group text rows into blocks
print(f"\nText blocks (continuous dark row groups):")
in_block = False
block_start = 0
for y in range(500, 900):
    dark_count = np.sum(text_mask[y, :])
    if dark_count > 15:
        if not in_block:
            block_start = y
            in_block = True
    else:
        if in_block:
            # Find the x range for the whole block
            block_pixels = text_mask[block_start:y, :]
            cols_in_block = np.any(block_pixels, axis=0)
            if np.any(cols_in_block):
                xmin = np.where(cols_in_block)[0][0]
                xmax = np.where(cols_in_block)[0][-1]
                block_cy = (block_start + y) // 2
                print(f"  Block y={block_start}..{y-1} (h={y-block_start}), x={xmin}..{xmax}, center_y={block_cy}")
            in_block = False

if in_block:
    y = 900
    block_pixels = text_mask[block_start:y, :]
    cols_in_block = np.any(block_pixels, axis=0)
    if np.any(cols_in_block):
        xmin = np.where(cols_in_block)[0][0]
        xmax = np.where(cols_in_block)[0][-1]
        block_cy = (block_start + y) // 2
        print(f"  Block y={block_start}..{y-1} (h={y-block_start}), x={xmin}..{xmax}, center_y={block_cy}")

print("\n--- Interpretation ---")
print("Block 1 (y~600-627) = Name 'DHANALAKSHMI C M' (28px tall → ~34-36pt font)")
print("Block 2 (y~669-691) = Designation 'PLANT IN CHARGE' (22px tall → ~24-26pt font)")
print("Block 3 (y~751-768) = 'ID Number  :  12345678' (17px tall → ~20-22pt font)")
print("Block 4 (y~804-821) = 'Phone      :  +91 8056001607' (17px tall → ~20-22pt font)")
