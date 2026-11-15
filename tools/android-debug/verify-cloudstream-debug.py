#!/usr/bin/env python3
"""Fail closed when experimental Debug accidentally ships without its runtime bridge.

This verifies shipped APK bytes, not Gradle flags or a successful compilation.
It does not assert real source/video playback, which instrumentation must prove.
"""
from __future__ import annotations

import sys
from pathlib import Path
from zipfile import ZipFile, BadZipFile

REQUIRED = (
    b"com/vantara/runtime/RuntimePlugin",
    b"dev/vantara/runtime/bootstrap/RuntimeBootstrap",
    b"dev/vantara/runtime/android/RuntimeWorkerService",
)

def verify(apk: Path) -> None:
    if not apk.is_file():
        raise ValueError(f"APK_MISSING: {apk}")
    try:
        with ZipFile(apk) as package:
            dex_files = [name for name in package.namelist() if
                         name.startswith("classes") and name.endswith(".dex") and "/" not in name]
            if not dex_files:
                raise ValueError("DEBUG_NO_DEX")
            # Search dex string tables for class descriptors. Apk split/main DEX is supported.
            binaries = [package.read(name) for name in dex_files]
    except BadZipFile as e:
        raise ValueError("DEBUG_APK_INVALID") from e
    missing = [name.decode() for name in REQUIRED if not any(name in dex for dex in binaries)]
    if missing:
        raise ValueError("DEBUG_RUNTIME_CLASSES_MISSING: " + ",".join(missing))

if __name__ == "__main__":
    try:
        verify(Path(sys.argv[1]))
    except (ValueError, IndexError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    print("DEBUG_RUNTIME_BRIDGE_PRESENT (APK-byte proof; not functional video proof)")
