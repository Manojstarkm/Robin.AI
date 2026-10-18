#!/usr/bin/env python3
"""Generate ROBIN AI launcher icons from public/robin-icon.png (cyber robin art)."""
import os
from PIL import Image, ImageDraw

SRC = "/home/z/my-project/public/robin-icon.png"
OUT = "/home/z/android-build/project/res"

art = Image.open(SRC).convert("RGBA")  # 1024x1024 cyber robin


def rounded(im, size, radius_ratio):
    im = im.resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    r = int(size * radius_ratio)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    return out


LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
FOREGROUND = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}

# Legacy launcher icons: full-bleed art with rounded corners
for dpi, s in LEGACY.items():
    p = os.path.join(OUT, f"mipmap-{dpi}")
    os.makedirs(p, exist_ok=True)
    rounded(art, s, 0.22).save(os.path.join(p, "ic_launcher.png"))
    print(f"legacy {dpi}: {s}px")

# Adaptive foreground: art scaled into the ~66% safe zone on transparency
for dpi, s in FOREGROUND.items():
    p = os.path.join(OUT, f"mipmap-{dpi}")
    os.makedirs(p, exist_ok=True)
    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    inner = int(s * 0.62)
    a = rounded(art, inner, 0.22)
    canvas.paste(a, ((s - inner) // 2, (s - inner) // 2), a)
    canvas.save(os.path.join(p, "ic_launcher_foreground.png"))
    print(f"foreground {dpi}: {s}px")

print("ICONS DONE")
