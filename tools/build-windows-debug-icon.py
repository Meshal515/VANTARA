#!/usr/bin/env python3
"""VANTARA Debug icon: the same official mark as icon-512.png, in white on black.

This mirrors the Android Debug launcher identity (android/app/src/debug/res): no new
artwork, only the purple mark recolored to white; alpha and shape are preserved.
Run: python3 tools/build-windows-debug-icon.py
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
source = Image.open(ROOT / 'apps/web/icons/icon-512.png').convert('RGBA')
out = Image.new('RGBA', source.size)
pixels, target = source.load(), out.load()
for y in range(source.height):
    for x in range(source.width):
        r, g, b, a = pixels[x, y]
        # Brightness of each pixel becomes white intensity: antialiased edges stay smooth.
        level = max(r, g, b)
        target[x, y] = (level, level, level, a)
png = ROOT / 'apps/desktop/assets/vantara-debug.png'
ico = ROOT / 'apps/desktop/assets/vantara-debug.ico'
out.save(png, optimize=True)
out.save(ico, format='ICO', sizes=[(n, n) for n in (16, 24, 32, 48, 64, 128, 256)])
print(png, ico)
