"""
Create clean front template with the correctly measured photo position.
Circle: center=(307, 402), outer_r=145
Reduced cleanup radius to 155 to avoid eating into the green stripe (starts ~x=460).
"""
from PIL import Image, ImageDraw

def clean_front_template(src_path, dst_path):
    img = Image.open(src_path).convert("RGB")
    draw = ImageDraw.Draw(img)
    W, H = img.size  # 590 x 1004
    pixels = img.load()
    
    # --- STEP 1: Clear the photo circle area ---
    # Measured: center=(307, 402), outer_r=145
    # Use cleanup radius 155 (just enough to cover photo + border + anti-alias)
    # Max right extent: 307 + 155 = 462 → safe, green stripe starts ~x=465+
    cx, cy, cr = 307, 402, 155
    draw.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=(255, 255, 255))
    
    # --- STEP 2: Clear all text below the photo ---
    # Text blocks: y=600..821+
    # Clear from y=570 to y=870 (generous), x=0 to x=450 (preserve right stripes)
    draw.rectangle([0, 570, 450, 870], fill=(255, 255, 255))
    
    # --- STEP 3: Clean the transition zone (x=450..590, y=570..870) ---
    # Only white-out non-decorative pixels (preserve green/red stripes)
    for y in range(570, 870):
        for x in range(450, W):
            r, g, b = pixels[x, y]
            # Keep green stripe pixels
            if g > 120 and g > r * 1.3 and g > b * 1.3:
                continue
            # Keep red stripe pixels
            if r > 150 and r > g * 1.5 and r > b * 1.3:
                continue
            if r > 120 and g < 60 and b < 60:
                continue
            # Everything else → white
            pixels[x, y] = (255, 255, 255)
    
    # --- STEP 4: Clean remaining non-white in photo area (x=50..455) ---
    for y in range(150, 570):
        for x in range(50, 455):
            r, g, b = pixels[x, y]
            if g > 120 and g > r * 1.3 and g > b * 1.3:
                continue
            if r > 150 and r > g * 1.5 and r > b * 1.3:
                continue
            if r > 120 and g < 60 and b < 60:
                continue
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            if lum < 250:
                pixels[x, y] = (255, 255, 255)
    
    img.save(dst_path, "PNG")
    print(f"Clean front template saved: {dst_path} ({W}x{H})")

src = "/home/karthikeyan/vscode/api-EcoSudar/1.png"
dst = "/home/karthikeyan/vscode/api-EcoSudar/eco-sudar-control/src/assets/id-front.png"
clean_front_template(src, dst)
