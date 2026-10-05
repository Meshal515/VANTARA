#!/usr/bin/env python3
"""Validate pinned OFL payloads and basic Arabic cmap coverage; Android shaping still needs instrumentation."""
import hashlib, json, pathlib
from fontTools.ttLib import TTFont
root = pathlib.Path(__file__).resolve().parents[1] / 'android/app/src/main/assets'
manifest = json.loads((root / 'fonts/translation-v2/manifest.json').read_text())
assert len(manifest['fonts']) == 20
required = 'ابتثجحخدذرزسشصضطظعغفقكلمنهويءآأؤإئاةى٠١٢٣٤٥٦٧٨٩'
for entry in manifest['fonts']:
    asset = root / entry['asset']
    assert hashlib.sha256(asset.read_bytes()).hexdigest() == entry['sha256'], entry['family']
    notice = (root / entry['license']).read_bytes()
    assert hashlib.sha256(notice).hexdigest() == entry['licenseSha256']
    assert b'SIL OPEN FONT LICENSE Version 1.1' in notice
    with TTFont(asset) as face:
        cmap = face.getBestCmap()
        missing = [char for char in required if ord(char) not in cmap]
        assert not missing, (entry['family'], missing)
        assert 'GSUB' in face and 'GPOS' in face, entry['family']
print('20 pinned OFL fonts: hashes, notices, Arabic cmap and shaping tables verified; device rendering UNVERIFIED')
