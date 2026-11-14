#!/usr/bin/env python3
"""Prepare a CloudStream checkout (pinned commit) as VANTARA's reference engine. CI only; never shipped.

Adds an observation hook at the start of loadExtractor and the instrumentation test. Behaviour is unchanged
when no listener is set. Every edit must match exactly once, or the run stops (no silent drift between
CloudStream versions).

usage: patch.py <cloudstream checkout>
"""
import pathlib
import shutil
import sys

here = pathlib.Path(__file__).resolve().parent
root = pathlib.Path(sys.argv[1]).resolve()
utils = root / "library/src/commonMain/kotlin/com/lagradost/cloudstream3/utils"
extractor_api = utils / "ExtractorApi.kt"

anchor = """suspend fun loadExtractor(
    url: String,
    referer: String? = null,
    subtitleCallback: (SubtitleFile) -> Unit,
    callback: (ExtractorLink) -> Unit
): Boolean {
    // Ensure this coroutine has not timed out
    coroutineScope { ensureActive() }
"""
hook = anchor + "    @Suppress(\"NAME_SHADOWING\") val callback = ReferenceProbe.wrap(url, referer, callback)\n"

text = extractor_api.read_text(encoding="utf-8")
if text.count(anchor) != 1:
    sys.exit(f"loadExtractor anchor found {text.count(anchor)} times in {extractor_api}; CloudStream changed, update patch.py")
extractor_api.write_text(text.replace(anchor, hook), encoding="utf-8")
shutil.copy(here / "ReferenceProbe.kt", utils / "ReferenceProbe.kt")

tests = root / "app/src/androidTest/java/com/lagradost/cloudstream3"
tests.mkdir(parents=True, exist_ok=True)
shutil.copy(here / "ReferenceRunTest.kt", tests / "ReferenceRunTest.kt")
print("reference patch applied:", root)
