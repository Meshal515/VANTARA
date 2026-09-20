#!/usr/bin/env python3
"""Generate the all-Arabic Keiyoushi spike manifest.

This is deliberately a BUILD-TIME discovery tool, not production update logic.

It pins one Keiyoushi `extensions` commit, reads that exact index.json, keeps
extensions that expose at least one source whose language is exactly "ar",
copies the published apkUrl verbatim, downloads those APK bytes, computes
SHA-256, and renders a Kotlin snapshot consumed by the isolated Android spike.

Why build-time instead of runtime:
- the APK under test gets deterministic metadata and hashes;
- a changed/moved CDN object fails SHA-256 instead of silently changing code;
- the probe can select the Arabic source IDs from multi-language extensions;
- the report records SAFE/MIXED/NSFW without guessing from package names.

Specialized BL/GL sources remain visible in the snapshot/report, but are marked
policy-blocked and the Android spike will never download or execute them.
"""

from __future__ import annotations

import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT_KT = ROOT / "app/src/main/kotlin/dev/vantara/spike/GeneratedSources.kt"
OUT_JSON = ROOT / "build/arabic-source-snapshot.json"

COMMIT = os.environ.get("KEIYOUSHI_INDEX_COMMIT", "").strip()
if not COMMIT:
    raise SystemExit("KEIYOUSHI_INDEX_COMMIT is required; pin the repo branch to an exact commit")

INDEX_URL = f"https://raw.githubusercontent.com/keiyoushi/extensions/{COMMIT}/index.json"
UA = "VANTARA-Arabic-Source-Spike/1.0"

# Owner policy: these specialized themes are excluded entirely from execution.
# Match normalized extension name, package name, and the Arabic source names.
BLOCKED_TOKENS = (
    "paradisebl",
    "boyslove",
    "yaoi",
    "shounenai",
    "yurimoonsub",
    "girlslove",
    "yuri",
    "shoujoai",
)


def fetch_bytes(url: str, *, tries: int = 4, timeout: int = 60) -> bytes:
    last: BaseException | None = None
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return res.read()
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last = exc
            if attempt < tries:
                time.sleep(1.2 * attempt)
    raise RuntimeError(f"download failed after {tries} attempts: {url}: {last}")


def normalize(value: str) -> str:
    return "".join(ch.lower() for ch in value if ch.isalnum())


def blocked_reason(ext: dict, arabic_sources: list[dict]) -> str | None:
    haystacks = [
        normalize(str(ext.get("name", ""))),
        normalize(str(ext.get("packageName", ""))),
        *(normalize(str(s.get("name", ""))) for s in arabic_sources),
    ]
    for token in BLOCKED_TOKENS:
        if any(token in hay for hay in haystacks):
            return "BL/GL specialized source blocked by VANTARA owner policy"
    return None


def warning(value: str | None) -> str:
    raw = str(value or "CONTENT_WARNING_SAFE")
    if raw.endswith("_NSFW"):
        return "NSFW"
    if raw.endswith("_MIXED"):
        return "MIXED"
    if raw.endswith("_SAFE"):
        return "SAFE"
    raise RuntimeError(f"unknown contentWarning: {raw}")


def select_extensions(
    extensions: list[dict],
    *,
    allowed_packages: set[str] | None = None,
) -> list[dict]:
    """Apply owner policy before any APK bytes are downloaded.

    NSFW is excluded unconditionally. An optional package allowlist narrows a
    diagnostic batch without changing the pinned Keiyoushi snapshot semantics.
    """
    selected: list[dict] = []
    for ext in extensions:
        package_name = str(ext.get("packageName", ""))
        if allowed_packages is not None and package_name not in allowed_packages:
            continue

        arabic = [s for s in ext.get("sources", []) if s.get("language") == "ar"]
        if not arabic:
            continue

        content_warning = warning(ext.get("contentWarning"))
        if content_warning == "NSFW":
            continue

        resources = ext.get("resources") or {}
        apk_url = resources.get("apkUrl")
        if not apk_url:
            raise RuntimeError(f"{package_name} has Arabic source(s) but no apkUrl")

        selected.append(
            {
                "label": str(ext["name"]),
                "packageName": package_name,
                "extensionLib": str(ext["extensionLib"]),
                "versionName": str(ext["versionName"]),
                "warning": content_warning,
                "apkUrl": str(apk_url),
                "arabicSourceIds": [str(s["id"]) for s in arabic],
                "arabicSourceNames": [str(s["name"]) for s in arabic],
                "blockedReason": blocked_reason(ext, arabic),
            }
        )
    return selected


def kotlin_string(value: str) -> str:
    return (
        '"'
        + value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\r", "\\r")
        + '"'
    )


def main() -> None:
    print(f"Fetching pinned Keiyoushi index: {COMMIT}")
    index_bytes = fetch_bytes(INDEX_URL, timeout=90)
    index_sha256 = hashlib.sha256(index_bytes).hexdigest()
    root = json.loads(index_bytes)
    extensions = root["extensionList"]["extensions"]

    raw_allowlist = os.environ.get("VANTARA_SOURCE_PACKAGES", "")
    allowed_packages = {p.strip() for p in raw_allowlist.split(",") if p.strip()} or None
    selected = select_extensions(extensions, allowed_packages=allowed_packages)

    if not selected:
        raise RuntimeError("pinned index yielded zero allowed Arabic-capable extensions")

    if allowed_packages is not None:
        found = {item["packageName"] for item in selected}
        missing = sorted(allowed_packages - found)
        if missing:
            raise RuntimeError(
                "batch allowlist contains missing or NSFW packages: " + ", ".join(missing)
            )

    selected.sort(key=lambda x: (x["label"].casefold(), x["packageName"]))
    print(f"Selected Arabic extension packages: {len(selected)}")

    def hash_one(item: dict) -> tuple[str, int]:
        data = fetch_bytes(item["apkUrl"], timeout=90)
        return hashlib.sha256(data).hexdigest(), len(data)

    # Parallel download is build-time only. Runtime probing remains sequential:
    # several sources can invoke a Cloudflare WebView and must not fight over it.
    failures: list[str] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        future_map = {pool.submit(hash_one, item): item for item in selected}
        done = 0
        for fut in concurrent.futures.as_completed(future_map):
            item = future_map[fut]
            done += 1
            try:
                sha, size = fut.result()
                item["sha256"] = sha
                item["apkBytes"] = size
                print(f"[{done:02d}/{len(selected):02d}] {item['label']} {size} B {sha[:12]}…")
            except BaseException as exc:
                failures.append(f"{item['label']} ({item['packageName']}): {exc}")

    if failures:
        print("\nFailed APK downloads:", file=sys.stderr)
        for failure in failures:
            print(f" - {failure}", file=sys.stderr)
        raise SystemExit(1)

    counts = {"SAFE": 0, "MIXED": 0, "NSFW": 0, "BLOCKED": 0}
    for item in selected:
        counts[item["warning"]] += 1
        if item["blockedReason"]:
            counts["BLOCKED"] += 1

    note = (
        f"Keiyoushi {COMMIT[:12]} · {len(selected)} Arabic-capable packages · "
        f"SAFE {counts['SAFE']} · MIXED {counts['MIXED']} · NSFW {counts['NSFW']} · "
        f"policy-blocked {counts['BLOCKED']}"
    )

    lines = [
        "package dev.vantara.spike",
        "",
        "/**",
        " * GENERATED FILE — do not hand edit.",
        f" * index commit: {COMMIT}",
        f" * index sha256: {index_sha256}",
        f" * {note}",
        " */",
        f"const val GENERATED_INDEX_COMMIT = {kotlin_string(COMMIT)}",
        f"const val GENERATED_SNAPSHOT_NOTE = {kotlin_string(note)}",
        "",
        "val GENERATED_SPIKE_SOURCES: List<SourceSpec> = listOf(",
    ]

    for item in selected:
        ids = ", ".join(kotlin_string(v) for v in item["arabicSourceIds"])
        names = ", ".join(kotlin_string(v) for v in item["arabicSourceNames"])
        blocked = (
            "null"
            if item["blockedReason"] is None
            else kotlin_string(item["blockedReason"])
        )
        lines.extend(
            [
                "    SourceSpec(",
                f"        label = {kotlin_string(item['label'])},",
                f"        pkg = {kotlin_string(item['packageName'])},",
                f"        expectedLib = {float(item['extensionLib']):.1f},",
                f"        apkUrl = {kotlin_string(item['apkUrl'])},",
                f"        sha256 = {kotlin_string(item['sha256'])},",
                f"        versionName = {kotlin_string(item['versionName'])},",
                f"        warning = ContentWarning.{item['warning']},",
                f"        arabicSourceIds = setOf({ids}),",
                f"        arabicSourceNames = listOf({names}),",
                f"        blockedReason = {blocked},",
                "    ),",
            ]
        )
    lines.append(")")
    lines.append("")

    OUT_KT.parent.mkdir(parents=True, exist_ok=True)
    OUT_KT.write_text("\n".join(lines), encoding="utf-8")

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(
        json.dumps(
            {
                "indexCommit": COMMIT,
                "indexSha256": index_sha256,
                "counts": counts,
                "packages": selected,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print("\n" + note)
    print(f"Wrote {OUT_KT.relative_to(ROOT)}")
    print(f"Wrote {OUT_JSON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
