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

## Long-work transport gate

Before the app adapter consumes episode JSON, the candidate adds an explicit
`invokeJson` opcode using the already bounded FD transport (4MiB UTF8 output).
Legacy `invoke` stays64KiB and all its existing rejection assertions remain.
The real published Anime4up parser receives a local authored1200-episode page;
the test requires the old call to reject it and the new call to return ALL1200
distinct opaque episode URLs. Native frame tests reject malformed UTF8, trailing
payload and multibyte text above the byte budget. This is not a live-source or
five-work acceptance claim. Local73 JVM tests, APK/test assembly and lint pass;
the expanded native suite must pass before adopting the new transport in UI.

## 2026-10-28 — actual Debug integration candidate (not accepted/published)

The branch now adds a strictly opt-in `-PvantaraRuntimeDebug=true` composite build.
Only Debug receives the worker/bootstrap and app-specific bridge sources. A real
Release runtime-classpath report was generated locally with the opt-in enabled;
it contains no runtime project/module. Default builds do not resolve it at all.
The permanent signing configuration, package identity and protected Debug channel
workflow are unchanged. No new APK has been published to testers by this work.

Implemented seams: Debug pre-create plugin registration; account-scoped repository
and package operations; actual isolated registration before installation; stable
repository/package/source IDs; existing AnimeEngine adapter routing for catalogue,
search, details, seasons, episodes and validated direct links; optional third
repository store in V7; awaitable account barrier; disable/update/uninstall; repo
unlink retains installed packages. Updating a disabled package retains its disabled
setting. A removed/changed account/package revokes worker generations and stale
results. No torrent/player/subtitle implementation or preparation adapter changed.

Human challenges only record silent pending state. The explicit manager button can
open the existing isolated VerificationActivity; nonce/origin/account/User-Agent
checks precede saving precisely one scoped host-only clearance cookie. The original
source operation is replayed once. No login cookies or other users' sessions are
copied; no app/browser storage is cleared. This new flow still requires actual
Android manual verification acceptance; compiling it is NOT acceptance evidence.

Local evidence for the candidate before CI:
- app APK and instrumentation APK compile successfully;
- 532 app unit cases: 530 pass, two pre-existing opt-in live matrices are skipped
  (`NativeSourcesLiveTest.matrix`, `RockLiveTest.matrix`); they are NOT successes;
- seven new mapping/identity/JSON cases run inside that app unit suite;
- 85 targeted manager/native-contract cases pass after the actual-action changes;
- complete web suite earlier in this candidate: 1834 cases pass (199 files);
- 54 repository-safety cases pass after refreshing the shell digest and precaching
  the new imported module;
- kernel unit suite: 78 cases pass (executor31/http27/profile20).

The new `runtime-app-debug.yml` runs the actual app instrumentation test using the
real pinned published Anime4up DEX and our deterministic offline HTML through the
existing AnimeEngine adapter. It asserts no source traffic during registration,
actual catalogue/details/episodes/direct-candidate mapping, disable/update retention,
controller reconstruction, account isolation/stale-adapter denial and explicit
uninstall. Its result is pending. It is NOT a five-live-work, video-decoding,
physical-device, APK-upgrade or full multi-platform compatibility claim.

Remaining: device CI and bootstrap/WebView proof; human verification and cookie
replay acceptance; five real works per executable source; actual playback/pages;
image/header cases; signed install-r retention; PWA/Windows family compatibility
and preview artifacts. CloudStream is the bounded original v1 Android profile,
not all upstream APIs/extractors/resource/dependency profiles. AnimeRift source
traffic stays refused; unsupported dependencies remain explicit failures. No claim
that parsing a .cs3 repository makes Android DEX executable on PWA/Windows.
