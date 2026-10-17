#!/usr/bin/env python3
"""Generate ROBIN AI launcher icons (adaptive foreground + legacy mipmaps)."""
import math
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = "/home/z/android-build/project/res"

def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

BG = hex_rgb('#0d1126')
CYAN = hex_rgb('#22d3ee')
VIOLET = hex_rgb('#a78bfa')

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def draw_orb(size, padding_ratio, glow=True):
    """Draw the AURA orb scene on a transparent canvas of given size."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    cx = cy = size / 2

    # Outer soft glow
    if glow:
        glow_layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow_layer)
        gr = size * 0.36
        gd.ellipse([cx - gr, cy - gr, cx + gr, cy + gr], fill=CYAN + (70,))
        glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(size * 0.10))
        img = Image.alpha_composite(img, glow_layer)

    d = ImageDraw.Draw(img)

    # Orbit ring (tilted ellipse)
    ring_r = size * 0.40
    ring_w = max(2, int(size * 0.012))
    d.ellipse(
        [cx - ring_r, cy - ring_r * 0.32, cx + ring_r, cy + ring_r * 0.32],
        outline=CYAN + (200,), width=ring_w)

    # Orb body with vertical cyan->violet gradient
    orb_r = size * 0.27
    body = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    steps = 120
    for i in range(steps):
        t = i / (steps - 1)
        col = lerp(CYAN, VIOLET, t) + (255,)
        y0 = cy - orb_r + (2 * orb_r) * (i / steps)
        y1 = cy - orb_r + (2 * orb_r) * ((i + 1) / steps)
        bd.ellipse([cx - orb_r, y0, cx + orb_r, y1], fill=col)
    # Mask to circle
    mask = Image.new('L', (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse([cx - orb_r, cy - orb_r, cx + orb_r, cy + orb_r], fill=255)
    img.paste(body, (0, 0), mask)

    # Specular highlight
    hl = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    hr = orb_r * 0.32
    hx, hy = cx - orb_r * 0.35, cy - orb_r * 0.42
    hd.ellipse([hx - hr, hy - hr * 0.7, hx + hr, hy + hr * 0.7], fill=(255, 255, 255, 110))
    hl = hl.filter(ImageFilter.GaussianBlur(size * 0.02))
    img = Image.alpha_composite(img, hl)

    # Brand letter "R" in the orb center
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', max(8, int(orb_r * 1.25)))
    except OSError:
        font = ImageFont.load_default()
    td = ImageDraw.Draw(img)
    td.text((cx + 0.5, cy - orb_r * 0.04), 'R', font=font, fill=(10, 12, 30, 160), anchor='mm')
    td.text((cx, cy - orb_r * 0.07), 'R', font=font, fill=(255, 255, 255, 245), anchor='mm')

    # Sparkle dots
    for (ang, rr, s) in [(0.6, 0.46, 0.010), (2.4, 0.50, 0.008), (4.2, 0.44, 0.011), (5.5, 0.49, 0.007)]:
        px = cx + rr * size * math.cos(ang)
        py = cy + rr * size * math.sin(ang) * 0.9
        sr = s * size
        d.ellipse([px - sr, py - sr, px + sr, py + sr], fill=(255, 255, 255, 220))

    return img

def compose_legacy(size):
    """Full-bleed legacy icon: dark rounded bg + orb."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    bg = Image.new('RGBA', (size, size), BG + (255,))
    # subtle radial tint via vignette
    vign = Image.new('L', (size, size), 0)
    vd = ImageDraw.Draw(vign)
    vd.ellipse([-size * 0.3, -size * 0.3, size * 1.3, size * 1.3], fill=40)
    vign = vign.filter(ImageFilter.GaussianBlur(size * 0.2))
    bg = Image.composite(Image.new('RGBA', (size, size), hex_rgb('#1a1f3d') + (255,)), bg, vign)
    img = Image.alpha_composite(img, bg)

    orb = draw_orb(size, 0, glow=True)
    img = Image.alpha_composite(img, orb)
    return img

LEGACY = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
FOREGROUND = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}

import os
for dpi, s in LEGACY.items():
    p = os.path.join(OUT, f'mipmap-{dpi}')
    os.makedirs(p, exist_ok=True)
    compose_legacy(s).convert('RGBA').save(os.path.join(p, 'ic_launcher.png'))
    print(f'legacy {dpi}: {s}px')

for dpi, s in FOREGROUND.items():
    p = os.path.join(OUT, f'mipmap-{dpi}')
    os.makedirs(p, exist_ok=True)
    # Foreground must keep orb inside the 66% safe zone -> draw at larger canvas
    img = draw_orb(s, 0, glow=False)
    img.save(os.path.join(p, 'ic_launcher_foreground.png'))
    print(f'foreground {dpi}: {s}px')

print('ICONS DONE')
