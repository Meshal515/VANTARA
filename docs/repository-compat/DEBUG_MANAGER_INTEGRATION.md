# Debug manager integration — current-base foundation

Branch: `feat/runtime-debug-integration-20261028`.
Base: PR298's current f959ad673804ff36ebce0c23c2762f82ec0b9e4b.
Core snapshot: PR301's 1e933ddd133327e444f324cf6d69a17d50503835.

Ruling: use the current signed Debug branch as the integration base rather than
copying an older main build/update configuration. This keeps PR298's permanent
Debug signature, monotonic channel version, previous-APK verification and actual
install-r/storage/Home/Addons acceptance workflow intact. The existing protected
publish job does NOT admit this new branch; no release is implicitly authorized
by copying code or by a successful standalone lab run.

This foundation copies only isolated runtime libraries, tests, workflows and
documentation. All original files of f959ad67 remain unchanged; the additions-only
scope guard compares against that pinned base. No main merge, Stable change,
source removal, account migration or torrent/player/subtitle change occurred.

## Remaining implementation gates

1. Add the smallest Debug-opt-in native runtime bridge and connect actual package
   install/update/disable/remove operations to the existing manager. Reuse the
   dedicated atomic new-family store; real isolated registration precedes record
   activation. Stable IDs must not be derived from package content hashes.
2. Route registered catalogue/search/details/episodes/videoLinks through existing
   VANTARA source/work interfaces. Preserve Stremio's in-app configuration and
   functioning Mihon/Aniyomi adapters. Reuse existing UI and player contracts.
3. Connect silent health/challenge state and explicit user verification to the
   existing coordinator, with correct per-profile cookies and request User-Agent.
   Clearing a challenge flag alone is NOT proof of a restored source session.
4. Test actual Debug install-r from the previous signed channel APK, data/session
   preservation, repeated UI navigation and source journeys. For each executable
   source/platform, five distinct works and actual media/pages must be recorded;
   missing/blocked/unsupported cases remain explicit. Android DEX does not become
   executable in PWA or Windows through repository parsing.
5. Only after these gates pass, prepare the approved Debug artifact and a factual
   platform compatibility report. Source separation stays queued behind this
   release, using BUNDLED_SOURCE_SEPARATION.md; no reinstall or data reset.

The inherited generic Debug build can compile this foundation without exposing
the new runtime in the app. It must NOT be sent as a completed runtime update.
