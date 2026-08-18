"""
Clean the remaining red arc artifacts from the front template.
The previous cleanup left two small dark-red arc segments from the
original photo border circle. This script removes them.
"""
from PIL import Image

def main():
    path = "/home/karthikeyan/vscode/api-EcoSudar/eco-sudar-control/src/assets/id-front.png"
    img = Image.open(path).convert("RGB")
    pixels = img.load()
    W, H = img.size
    
    # The red arc remnants are in the region roughly:
    # y: 430-530, x: 100-490
    # They're dark red pixels (r > 100, g < 50, b < 50) on white background
    for y in range(400, 540):
        for x in range(80, 500):
            r, g, b = pixels[x, y]
            # If pixel is dark/reddish and NOT part of right-side stripes
            if x < 450:
                lum = 0.299 * r + 0.587 * g + 0.114 * b
                if lum < 250:  # Not white
                    pixels[x, y] = (255, 255, 255)
    
    # Also clean any remaining dark pixels in the top header area
    # that might be residual (between the logo and the stripes)
    # But preserve the logo (x < 200, y < 140) and the text
    
    img.save(path, "PNG")
    print(f"Cleaned red arc artifacts. Saved: {path}")

if __name__ == "__main__":
    main()
