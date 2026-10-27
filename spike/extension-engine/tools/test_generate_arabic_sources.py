import copy
import hashlib
import json
from contextlib import redirect_stdout
from io import StringIO
import os
import sys
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import patch
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
os.environ.setdefault("KEIYOUSHI_INDEX_COMMIT", "test-commit")

import generate_arabic_sources as gas


def ext(name: str, pkg: str, warning: str = "CONTENT_WARNING_SAFE") -> dict:
    return {
        "name": name,
        "packageName": pkg,
        "extensionLib": "1.6",
        "versionName": "1.0",
        "contentWarning": warning,
        "resources": {"apkUrl": f"https://example.invalid/{pkg}.apk"},
        "sources": [{"language": "ar", "id": "1", "name": name}],
    }


class SourceSelectionTest(unittest.TestCase):
    def test_batch_allowlist_and_owner_nsfw_policy_are_both_enforced(self) -> None:
        safe = ext("Safe", "pkg.safe")
        nsfw = ext("Adult", "pkg.nsfw", "CONTENT_WARNING_NSFW")
        outside = ext("Outside", "pkg.outside")

        selected = gas.select_extensions(
            [safe, nsfw, outside],
            allowed_packages={"pkg.safe", "pkg.nsfw"},
        )

        self.assertEqual(["pkg.safe"], [item["packageName"] for item in selected])
        self.assertTrue(all(item["warning"] != "NSFW" for item in selected))

    def test_explicit_consent_allowlist_admits_only_named_nsfw_packages(self) -> None:
        approved = ext("Adult Arabic", "pkg.nsfw.approved", "CONTENT_WARNING_NSFW")
        unapproved = ext("Other Adult", "pkg.nsfw.other", "CONTENT_WARNING_NSFW")

        selected = gas.select_extensions(
            [approved, unapproved],
            allowed_packages={"pkg.nsfw.approved", "pkg.nsfw.other"},
            consented_nsfw_packages={"pkg.nsfw.approved"},
        )

        self.assertEqual(
            ["pkg.nsfw.approved"],
            [item["packageName"] for item in selected],
        )
        self.assertEqual("NSFW", selected[0]["warning"])

    def test_consent_never_overrides_bl_gl_owner_block(self) -> None:
        specialized = ext("Paradise BL", "pkg.paradisebl", "CONTENT_WARNING_NSFW")

        selected = gas.select_extensions(
            [specialized],
            allowed_packages={"pkg.paradisebl"},
            consented_nsfw_packages={"pkg.paradisebl"},
        )

        self.assertEqual([], selected)

    def test_mixed_is_not_treated_as_nsfw(self) -> None:
        mixed = ext("Mixed", "pkg.mixed", "CONTENT_WARNING_MIXED")
        selected = gas.select_extensions([mixed], allowed_packages={"pkg.mixed"})
        self.assertEqual(["pkg.mixed"], [item["packageName"] for item in selected])


class LocalPayloadTest(unittest.TestCase):
    # Removing metadata or digest validation would admit changed executable bytes
    # or silently replace the reviewed source snapshot with different metadata.
    def setUp(self):
        self.folder = TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.manifest = self.root / "GeneratedSources.kt"
        self.apk = self.root / "pkg.safe.apk"
        self.apk.write_bytes(b"abc")
        self.selected = [{
            "label": "Safe", "packageName": "pkg.safe", "extensionLib": "1.6",
            "versionName": "1.0", "warning": "SAFE",
            "apkUrl": "https://example.invalid/pkg.safe.apk",
            "arabicSourceIds": ["1"], "arabicSourceNames": ["Safe"],
            "blockedReason": None,
        }]
        self.manifest.write_text('''package dev.vantara.spike
/**
 * index sha256: ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
 */
const val GENERATED_INDEX_COMMIT = "test-commit"
val GENERATED_SPIKE_SOURCES: List<SourceSpec> = listOf(
    SourceSpec(
        label = "Safe",
        pkg = "pkg.safe",
        expectedLib = 1.6,
        apkUrl = "https://example.invalid/pkg.safe.apk",
        sha256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        versionName = "1.0",
        warning = ContentWarning.SAFE,
        arabicSourceIds = setOf("1"),
        arabicSourceNames = listOf("Safe"),
        blockedReason = null,
    ),
)
''', encoding="utf-8")

    def verify(self, *, index_sha256="f" * 64):
        return gas.verify_local_payloads(self.selected, index_sha256, self.manifest, self.root)

    def test_exact_pinned_payload_returns_hash_and_size(self):
        self.assertEqual(self.verify(), {"pkg.safe": (
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", 3,
        )})

    def test_local_mode_writes_verified_snapshot_without_fetching_apk_urls(self):
        index_bytes = json.dumps({"extensionList": {"extensions": [ext("Safe", "pkg.safe")]}}).encode()
        self.manifest.write_text(self.manifest.read_text().replace("f" * 64, hashlib.sha256(index_bytes).hexdigest()))
        original_manifest = self.manifest.read_text()
        output = self.root / "snapshot.json"

        def index_only(url, **kwargs):
            if url != gas.INDEX_URL:
                raise AssertionError(f"local mode tried downloading executable bytes: {url}")
            return index_bytes

        with patch.object(gas, "OUT_KT", self.manifest), patch.object(gas, "OUT_JSON", output), \
                patch.object(gas, "ROOT", self.root), patch.object(gas, "fetch_bytes", side_effect=index_only), \
                patch.dict(os.environ, {"VANTARA_SOURCE_PACKAGES": "pkg.safe", "VANTARA_NSFW_SOURCE_PACKAGES": ""}), \
                redirect_stdout(StringIO()):
            gas.main(["--local-apk-dir", str(self.root)])
        snapshot = json.loads(output.read_text())
        self.assertEqual(snapshot["counts"], {"SAFE": 1, "MIXED": 0, "NSFW": 0, "BLOCKED": 0})
        self.assertEqual(snapshot["packages"][0]["sha256"], "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        self.assertEqual(snapshot["packages"][0]["apkBytes"], 3)
        self.assertEqual(snapshot["packages"][0]["apkUrl"], "https://example.invalid/pkg.safe.apk")

        # A corrupt payload must fail before either generated output is changed.
        self.manifest.write_text(original_manifest)
        output.unlink()
        self.apk.write_bytes(b"changed")
        with patch.object(gas, "OUT_KT", self.manifest), patch.object(gas, "OUT_JSON", output), \
                patch.object(gas, "fetch_bytes", side_effect=index_only), \
                patch.dict(os.environ, {"VANTARA_SOURCE_PACKAGES": "pkg.safe", "VANTARA_NSFW_SOURCE_PACKAGES": ""}), \
                redirect_stdout(StringIO()), self.assertRaisesRegex(RuntimeError, "SHA-256"):
            gas.main(["--local-apk-dir", str(self.root)])
        self.assertEqual(self.manifest.read_text(), original_manifest)
        self.assertFalse(output.exists())

    def test_changed_or_missing_local_payload_fails_closed(self):
        self.apk.write_bytes(b"changed")
        with self.assertRaisesRegex(RuntimeError, "SHA-256"):
            self.verify()
        self.apk.unlink()
        with self.assertRaises(FileNotFoundError):
            self.verify()

    def test_changed_index_commit_or_hash_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "index"):
            self.verify(index_sha256="e" * 64)
        self.manifest.write_text(self.manifest.read_text().replace('"test-commit"', '"another-commit"'))
        with self.assertRaisesRegex(RuntimeError, "index"):
            self.verify()

    def test_index_metadata_must_match_every_reviewed_source_field(self):
        original = copy.deepcopy(self.selected)
        changes = {
            "label": "Changed", "packageName": "pkg.other", "extensionLib": "1.7",
            "versionName": "2.0", "warning": "MIXED", "apkUrl": "https://example.invalid/new.apk",
            "arabicSourceIds": ["2"], "arabicSourceNames": ["Changed"], "blockedReason": "blocked",
        }
        for key, value in changes.items():
            with self.subTest(field=key), self.assertRaises(RuntimeError):
                self.selected = copy.deepcopy(original)
                self.selected[0][key] = value
                self.verify()

    def test_duplicate_or_missing_snapshot_packages_fail_closed(self):
        self.selected *= 2
        with self.assertRaises(RuntimeError):
            self.verify()
        self.selected = []
        with self.assertRaises(RuntimeError):
            self.verify()
        self.selected = [{"packageName": "../escape"}]
        with self.assertRaises(RuntimeError):
            self.verify()


if __name__ == "__main__":
    unittest.main()
