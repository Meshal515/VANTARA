#!/usr/bin/env python3
"""Fail closed on any break in the published Debug APK upgrade contract."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

PACKAGE = 'com.vantara.app.debug'


def parse_single_signer(output):
    """Fail closed on zero, multiple or conflicting APK signer certificates.

    apksigner versions vary in whitespace/capitalization. No certificate pin is
    weakened: the normalized digest still must match the hard-coded pin.
    """
    matches = re.findall(
        r"^\s*Signer\s+#(\d+)\s+certificate\s+SHA-256\s+digest:\s*([0-9a-fA-F]{64})\s*$",
        output, re.MULTILINE | re.IGNORECASE,
    )
    unique = {(int(index), digest.lower()) for index, digest in matches}
    announced = {int(index) for index in re.findall(
        r"^\s*Signer\s+#(\d+)\s+certificate\b", output, re.MULTILINE | re.IGNORECASE,
    )}
    if len(unique) != 1 or announced != {1} or {i for i, _ in unique} != {1}:
        raise ValueError(
            f"Expected exactly one signer with complete SHA-256 certificate; "
            f"parsed={len(unique)}, announced={sorted(announced)}; "
            f"apksigner output: {output[-1200:]!r}"
        )
    return next(iter(unique))[1]


def inspect(apk, build_tools):
    certs = subprocess.check_output(
        [str(build_tools / 'apksigner'), 'verify', '--verbose', '--print-certs', str(apk)],
        text=True,
    )
    signer = parse_single_signer(certs)
    badging = subprocess.check_output([str(build_tools / 'aapt2'), 'dump', 'badging', str(apk)], text=True)
    match = re.search(r"^package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'", badging, re.M)
    if not match:
        raise ValueError('Missing APK package/version metadata')
    return dict(
        package=match[1], code=int(match[2]), name=match[3], certificate=signer,
        sha256=hashlib.sha256(apk.read_bytes()).hexdigest(), size=apk.stat().st_size,
    )


def validate(previous, candidate, manifest, pinned, expected_code):
    for label, apk in [('previous', previous), ('candidate', candidate)]:
        if apk['package'] != PACKAGE or apk['certificate'] != pinned:
            raise ValueError(f'{label}: Debug package or permanent signing identity changed')
    if manifest.get('channel') != 'debug' or manifest.get('format') != 2:
        raise ValueError('Previous release is not a Debug v2 manifest')
    if any(previous[k] != manifest.get(v) for k, v in [('code', 'versionCode'), ('name', 'versionName')]):
        raise ValueError('Previous manifest version does not describe its APK')
    if any(previous[k] != manifest.get('apk', {}).get(k) for k in ['sha256', 'size']):
        raise ValueError('Previous manifest hash/size does not describe its APK')
    if candidate['code'] <= previous['code'] or candidate['code'] != expected_code:
        raise ValueError('Candidate versionCode must match this build and increase over the published Debug APK')
    if candidate['name'] != f'0.0.{expected_code}' or not 0 < expected_code <= 2100000000:
        raise ValueError('Candidate versionName/code must match the independent Debug manifest')


def main():
    parser = argparse.ArgumentParser()
    for option in ['previous', 'candidate', 'manifest', 'build-tools', 'pin-source', 'output']:
        parser.add_argument('--' + option, type=Path, required=True)
    parser.add_argument('--expected-code', type=int, required=True)
    args = parser.parse_args()
    pinned = re.search(r'STABLE_CERT_SHA256 = "([0-9a-f]{64})"', args.pin_source.read_text())
    if not pinned:
        raise ValueError('Missing permanent signing certificate pin')
    previous, candidate = [inspect(apk, args.build_tools) for apk in [args.previous, args.candidate]]
    validate(previous, candidate, json.loads(args.manifest.read_text()), pinned[1], args.expected_code)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dict(previous=previous, candidate=candidate, passed=True), indent=2) + '\n')
    print(f"Verified same Debug package/certificate; versionCode {previous['code']} → {candidate['code']}")


if __name__ == '__main__':
    main()
