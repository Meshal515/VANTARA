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

## Review follow-up — revocation, registration, seasons and actual WebView gate

The e325a0ea actual-app device run reached the real app and failed before provider
execution: `registration.invalid` is correctly refused by RuntimeProtocol's
reserved-host policy. Use the admitted reserved `registration.example` origin
while keeping the registration transport categorically network-denied. Do not
weaken the origin policy or call the original failure a source-site outage.
Evidence: Actions40770634449, artifact12853036343, actual instrumentation XML.

Concrete review findings addressed in the candidate:
- Put worker admission and insertion under the same lifecycle lock as revocation;
  check account/package generations at transport ingress and result publication.
  Closing a host revokes future workers too. Device acceptance now deliberately
  pauses before worker registration, switches account, then requires ZERO HTTP
  from the late invocation. Duplicate SDK source names/origin mismatches are
  validated before registry activation; malformed package records stay isolated.
- The manager's previous contract had no season picker. Add optional-family season
  enumeration through its own bridge, use the existing sheet UI, keep the actual
  provider URL intact, and preserve selected-season identity when restoring a work.
- Scope new-family source IDs to the stable account as well as package/provider.
  A reproduced JVM failure showed EpisodeResolver returning a cached list AFTER
  the runtime adapter was revoked. The added guard/adapter-generation check and
  transient new-family cache revocation prevent that. Legacy cache behavior and
  all persistent user data remain unchanged.
- Avoid showing the same CloudStream package twice as a managed install and a
  canonical runtime source. The canonical registry entry remains available.

Local follow-up verification: actual app/test APK assembly;535 app cases with
533 passed and the same two pre-existing live matrices skipped;1839 web cases
passed;54 repository-safety cases plus the optional fingerprint case passed.
Duplicate identity rejection, revoked-cache access, missing season routing and
package-count regressions were observed failing before their respective fixes.

The actual-app workflow additionally launches MainActivity, measures the new
Capacitor plugin from the REAL WebView, runs the inherited30 Home/Addons cycles,
and force-stops/restarts the candidate process. All three phases use the SAME
candidate APK: this is deliberately NOT a signed APK-upgrade claim. Reports and
screenshots are retained. Human CAPTCHA and five-work playback acceptance are
still outstanding; no Stable merge or publication is authorized by this gate.

## Cold metadata follow-up (device regression still required)

Actions40810669209 passed build/unit/Release-isolation gates and reached the real
isolated app worker. Its XML reports OPERATION_TIMEOUT at5.719s of test execution.
The initial load has a10s budget and later source operations15s; the intervening
first capabilities call has the unchanged3s budget. Worker logcat shows the
arm64-only application executing through Berberis on the x86_64 emulator. No
source-site request or ABI exception was reported. The minimal harness's50-case
execution/guard workflow40810674601 and full project CI40810674519 passed.

Candidate optimization: the host-owned fixed metadata schema no longer enters
runBlocking, initializes the Jackson input parser, or uses reflective DTO encoding.
Use a synchronous kotlinx JSON builder while preserving the profile/field names,
sourceFunctionsTested=false, escaping and valid-input parsing. Actual source
operations retain the existing provider code and mapper. The3s acceptance deadline
is unchanged. A new metadata contract test was observed RED then GREEN; all79
kernel JVM cases pass and harness/test assembly/lint pass locally. The actual-app
emulator regression must decide whether this resolves the cold metadata timeout;
no device success or completed runtime release is claimed yet.

## Device fixture correction after cold metadata passes

Actions40812632153 progressed beyond registration, catalogue and details under the
same3s metadata deadline, then failed expected1.0 versus actual-1.0 for an episode.
Inspection of the pinned CS3 DEX confirms `.badge.light-soft span` and
`ul.all-episodes-list li a`. The authored detail fixture omitted the badge; its
separate episode-page fixture omitted the sidebar list, so the actual provider
returned its fallback name `Episode` and no number. VANTARA correctly preserved
that as unknown rather than inventing a list-position number.

Complete the authored fixtures with both actual markup shapes, retain the app's
strict episode1 assertion, and strengthen the standalone published-parser test to
assert the raw episode field is1 too. No production parser/numbering logic or
acceptance assertion is loosened. Both instrumentation APKs compile locally; the
updated device run is required before reporting the complete journey successful.

## 2026-10-29 — silent legacy prompt and private browser profiles

The separate signed Debug hotfix e8e587dc removes the old anime.js needsHuman
listener/pill that displayed `Egy Dead يطلب تحقق` over unrelated pages. Three
DOM regression contexts failed before removal and pass after it. Manual source
verification and passive challenge reporting remain. This integration includes
the same fix; its new runtime is not part of that signed hotfix release.

Runtime challenges now carry the cloudstream kind and route only to the opt-in
runtime bridge. They must not fall back to the legacy shared-cookie verifier or
replay twice in JS after native replay. Explicit browser verification selects an
AndroidX WebView profile keyed by the scoped account/package/source identity,
before navigation. Unsupported profiles fail closed without clearing sessions.
The legacy verification route retains its existing profile. A new device test
requires actual MULTI_PROFILE support, distinct cookie jars, no default-jar
leakage, and profile reuse after recreating a WebView; compilation alone is not
device acceptance or proof of human CAPTCHA completion.

Run40813919915 passed the original actual-app instrumentation journey. Its next
MainActivity launch failed because Gradle UTP had uninstalled the test target.
The acceptance script now reinstalls the same candidate APK before its separate
CDP phase; it still does not claim a signed upgrade. Full rerun is required.

Local checks for this follow-up:1844 web tests in200 files passed;55 safety and
fingerprint checks passed; actual app unit/build and instrumentation APK compile
passed. No main/Stable change, source separation, or live playback acceptance.

Run40816658851 executed both actual-app instrumentation cases successfully,
including real WebView cookie profile isolation. The CDP phase then queried pidof
before Android finished updating its PID map (query04:20:53.18, map04:20:53.20).
Use Activity Manager's existing `start -W` completion handshake before CDP on
both launches; no assertion or timeout is weakened. Full acceptance rerun pending.

Run40817738069 on355f4b49 passed the complete actual-app pipeline, including both
instrumentation cases, MainActivity's real Capacitor runtime capability,30 UI
cycles, and force-stop/restart. Standalone Chromium also passed30 source/catalogue
navigation cycles over141 seconds with no uncaught JS errors or popups. These
remain offline/anonymous UI proofs, not real authentication or media playback.

## Priority providers: Witcher and Rift

Pinned Witcher4c639f93 uses the exact Algolia application origin and Firestore
outside its declared website origin. The app previously admitted only mainUrl.
An exact-archive network profile admits these two observed HTTPS dependencies
while unknown/updated package bytes receive no extra permissions. Public DNS,
TLS, redirect checking, per-source cookies and bounded IPC remain in force. The
new app instrumentation exercises five authored works through the REAL published
DEX and existing AnimeEngine adapter: catalogue/search/details/episodes/direct
links. This is NOT five live works or actual playback. The new two policy JVM
tests were observed RED then GREEN. Device execution is required.

Rift's pinned package generates device/session state and has a publisher IP-ban
warning. The app retains the source silently and denies source transport pending
network review; a new actual-installation test must prove zero transport creation.
A separate isolated harness test exercises its real DEX against authored API
responses for five works, opaque episodes and direct-link headers with ZERO
source sockets. It does not prove persistent source identity across worker
generations or authorize live requests. No VPN, identity rotation, clearance
bypass or user storage deletion was added. Rift live support remains incomplete.
