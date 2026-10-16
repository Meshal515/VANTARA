#!/usr/bin/env python3
"""Convert the existing VANTARA app artwork to a Windows multi-image icon.

Run with Pillow installed: python3 tools/build-windows-icon.py
No recoloring or redesign: all frames come from apps/web/icons/icon-512.png.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
source = Image.open(ROOT / 'apps/web/icons/icon-512.png').convert('RGBA')
target = ROOT / 'apps/desktop/assets/vantara.ico'
target.parent.mkdir(parents=True, exist_ok=True)
source.save(target, format='ICO', sizes=[(n, n) for n in (16, 24, 32, 48, 64, 128, 256)])
print(target)
