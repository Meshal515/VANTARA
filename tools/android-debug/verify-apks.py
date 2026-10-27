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
    """Verify one APK signer and one SHA-256 identity across all schemes.

    apksigner on newer build-tools prints "V2 Signer: certificate ...", whereas
    older versions print "Signer #1 certificate ...". Both must be recognized
    without weakening the single-signer or pinned-certificate contract.
    """
    counts = re.findall(r"^Number of signers:\s*(\d+)\s*$", output, re.M | re.I)
    if len(counts) != 1 or int(counts[0]) != 1:
        raise ValueError("APK signature verifier must report exactly one signer")
    numbered = re.findall(
        r"^\s*Signer\s+#(\d+)\s+certificate\s+SHA-256\s+digest:\s*([0-9a-fA-F]{64})\s*$",
        output, re.M | re.I,
    )
    schemes = re.findall(
        r"^\s*V\d+(?:\.\d+)?\s+Signer:\s*certificate\s+SHA-256\s+digest:\s*([0-9a-fA-F]{64})\s*$",
        output, re.M | re.I,
    )
    all_digests = {digest.lower() for _, digest in numbered} | {digest.lower() for digest in schemes}
    announced = {int(index) for index in re.findall(
        r"^\s*Signer\s+#(\d+)\s+certificate\b", output, re.M | re.I,
    )}
    if len(all_digests) != 1 or (announced and announced != {1}):
        raise ValueError(
            f"Expected one consistent signer certificate; digests={len(all_digests)}, "
            f"numbered_signers={sorted(announced)}; apksigner output: {output[-1200:]!r}"
        )
    return next(iter(all_digests))


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
