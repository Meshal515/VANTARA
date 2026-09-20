import os
import sys
import unittest
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

    def test_mixed_is_not_treated_as_nsfw(self) -> None:
        mixed = ext("Mixed", "pkg.mixed", "CONTENT_WARNING_MIXED")
        selected = gas.select_extensions([mixed], allowed_packages={"pkg.mixed"})
        self.assertEqual(["pkg.mixed"], [item["packageName"] for item in selected])


if __name__ == "__main__":
    unittest.main()
