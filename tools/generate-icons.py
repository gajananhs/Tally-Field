"""
Generates TallyField's PWA icon and splash-screen PNGs from the same
navy/blue mark used throughout the app. Run with:
    python3 generate-icons.py --out <output-dir>
Requires Pillow (pip install pillow).
"""
import argparse, os
from PIL import Image, ImageDraw, ImageFont

NAVY = (10, 22, 40, 255)     # #0a1628
BLUE = (47, 111, 237, 255)   # #2f6fed
WHITE = (255, 255, 255, 255)

def load_font(size):
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()

def rounded_rect(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)

def make_icon(size, maskable=False):
    img = Image.new("RGBA", (size, size), NAVY if maskable else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if not maskable:
        rounded_rect(d, (0, 0, size, size), radius=size * 0.19, fill=NAVY)
    # Maskable icons need their content inside the safe zone (~center 80%)
    pad = size * 0.29 if maskable else size * 0.24
    rounded_rect(d, (pad, pad, size - pad, size - pad), radius=(size - 2 * pad) * 0.18, fill=BLUE)
    font_size = int((size - 2 * pad) * 0.46)
    font = load_font(font_size)
    text = "TF"
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - tw) / 2 - bbox[0], (size - th) / 2 - bbox[1]), text, font=font, fill=WHITE)
    return img

def make_apple_touch_icon(size=180):
    # No transparency, no rounding — iOS applies its own mask.
    img = Image.new("RGBA", (size, size), NAVY)
    d = ImageDraw.Draw(img)
    pad = size * 0.24
    rounded_rect(d, (pad, pad, size - pad, size - pad), radius=(size - 2 * pad) * 0.18, fill=BLUE)
    font = load_font(int((size - 2 * pad) * 0.46))
    text = "TF"
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - tw) / 2 - bbox[0], (size - th) / 2 - bbox[1]), text, font=font, fill=WHITE)
    return img.convert("RGB")

def make_splash(width, height):
    img = Image.new("RGB", (width, height), NAVY)
    d = ImageDraw.Draw(img)
    mark = int(min(width, height) * 0.22)
    cx, cy = width // 2, height // 2
    pad = mark * 0.14
    rounded_rect(d, (cx - mark / 2, cy - mark / 2, cx + mark / 2, cy + mark / 2), radius=mark * 0.18, fill=BLUE)
    font = load_font(int(mark * 0.46))
    text = "TF"
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text((cx - tw / 2 - bbox[0], cy - th / 2 - bbox[1]), text, font=font, fill=WHITE)
    label_font = load_font(int(width * 0.045))
    label = "TallyField"
    lb = d.textbbox((0, 0), label, font=label_font)
    lw = lb[2] - lb[0]
    d.text((cx - lw / 2 - lb[0], cy + mark / 2 + mark * 0.22), label, font=label_font, fill=WHITE)
    return img

SPLASH_SIZES = [
    (750, 1334),    # iPhone SE / 8
    (1170, 2532),   # iPhone 12/13/14
    (1284, 2778),   # iPhone Pro Max
    (1620, 2160),   # iPad 10.2"
]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    icons_dir = os.path.join(args.out, "icons")
    splash_dir = os.path.join(args.out, "splash")
    os.makedirs(icons_dir, exist_ok=True)
    os.makedirs(splash_dir, exist_ok=True)

    for size in (192, 512):
        make_icon(size, maskable=False).save(os.path.join(icons_dir, f"icon-{size}.png"))
        make_icon(size, maskable=True).save(os.path.join(icons_dir, f"icon-maskable-{size}.png"))
    make_apple_touch_icon(180).save(os.path.join(icons_dir, "apple-touch-icon.png"))

    for w, h in SPLASH_SIZES:
        make_splash(w, h).save(os.path.join(splash_dir, f"splash-{w}x{h}.png"))

    print("Generated icons in", icons_dir)
    print("Generated splash screens in", splash_dir)

if __name__ == "__main__":
    main()
