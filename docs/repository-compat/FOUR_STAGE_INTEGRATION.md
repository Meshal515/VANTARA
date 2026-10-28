# VANTARA Runtime — actual compatibility and integration plan

> Execute inline using superpowers:executing-plans and test-driven-development. Baseline01e31eb0; same experimental branch/PR301. No main merge or Stable release.

## Spec and constraints

Owner explicitly requests the four remaining stages: actual CloudStream ABI, production network/session/storage broker, connection to existing addon engines, then real acceptance tests. Preserve torrent/player/subtitles/translation/accounts and all existing user repositories/IDs. No upstream GPL implementation reuse; public ABI signatures and permissive dependencies may be used with their notices. On the owner's subsequent instruction, built-in source separation/removal is a FOLLOW-UP after these four stages pass; Git history rewriting remains outside scope. No automatic verification UI or silent CAPTCHA bypass. Avoid AnimeRift source requests while its IP-ban warning remains; isolated/offline execution is allowed.

## Architecture

- An original Kotlin CloudStream ABI profile, versioned and capability-scoped, executes the pinned provider packages. DTO/builders have real semantics; unsupported extractors/Activity requirements report an explicit unsupported capability, never empty-success.
- Pure JVM HTTP core uses a permissively licensed OkHttp dependency; Android host owns per-source/session cookies/settings and bounded IPC. Worker code has no INTERNET and must use broker. GET-only original API remains backward compatible; full exchange carries method/headers/body/status and bounded large payloads.
- Reuse existing Aniyomi/Mihon runtime adapters and managers. Android uses actual native providers; Windows/PWA expose only capabilities they can execute. APK/DEX compatibility is not inferred from repository parsing.
- Integrate via a Debug-only opt-in build feature at first. Stable paths and data remain untouched; registry uses existing source identity and storage migration only if necessary and tested.

## Task1 — HTTP core and sessions

Create http JVM module, RuntimeHttpRequest/Response/Policy/Broker and tests. Real loopback TLS server tests: GET/POST, referer/headers, response bytes>64KiB, redirect-hop origin/DNS checks, no sensitive-header forwarding cross-origin, per-session cookie separation/restart,429 Retry-After and confirmed challenge classification, cancellation and bounded bodies. Defaults reject private/link-local/multicast DNS. Trusted policy may explicitly admit local-network sources; tests use a local TLS origin through that explicit capability, not a bypass of production defaults.

Run Gradle :http:test and Android build. Expected: actual sockets/TLS and assertions pass, not mocked request success.

## Task2 — original CloudStream ABI and worker transport

Create cloudstream-profile Kotlin module with required Plugin/MainAPI/models/builders/Requests/NiceResponse contracts from API_REQUIREMENTS, no NiceHttp GPL implementation. Use existing worker lifecycle with an explicit profile selection and restricted worker Context for the Android plugin API. Pin package bytes and stage registration before publication. Implement direct links and supported extractors with real behavior; others stay unsupported. Tests run external pinned CS3 DEX in isolated process and test registration, catalogue/search/details/episodes/videoLinks with deterministic HTTP responses, then controlled live checks where allowed. Authored fixtures are identified separately.

Preserve original20 worker tests. Add tests that prove raw getBaseClient/newBuilder traffic remains brokered for the admitted profile and direct sockets remain denied. ABI verification is separate from healthy-source verdicts.

## Task3 — manager integration and persistence

Inspect actual existing bridge/registry/configuration/catalogue routes before edits. Add the smallest Debug-only runtime adapter and reuse installed source IDs. Do not replace working Aniyomi/Mihon extraction or Stremio configuration. Restore manager position after source navigation. New/unverified capability never appears as tested stable. No deletion or reinitialization of existing repositories/accounts/progress.

## Task4 — acceptance and delivery

Run all baseline suites, JVM networking, actual Android instrumentation(API29/35 and API26–28 worker allocation where supported), upgrade/storage fixtures and functional source tests. Windows/PWA acceptance covers executable adapters and explicit unsupported native formats. Report live-source vs offline pinned provider vs authored fixture coverage distinctly. Push every code/test/doc change to experimental branch, inspect CI and artifacts. Do not mark all four complete if actual source functions or platform/data gates remain untested.

Owner's additional acceptance condition: for EACH admitted source, verify at least
five distinct available works spanning very popular, popular, moderately known,
less known and obscure works, separately on APK Debug, PWA and Windows where that
runtime is executable. For anime/cinema, reach details and episodes/direct media
and prove actual playback; for manga, reach details, chapters and rendered page
images. Record source/package version, platform/build, work identity, date and
each operation's result. Missing source coverage, absent works, incompatible
platforms and skipped playback must stay explicit; no manifest/catalogue-only
success may be promoted to full acceptance. Existing torrent/subtitle/player
engines remain outside modification scope. These cross-platform five-work checks
have NOT been run in the isolated lab described by the current progress report.

## Review focus

1. Immutable host identity and revocation on failed initialization.
2. Redirect/DNS rebinding and session-bound cookies/headers.
3. Complete response bytes through bounded IPC, cancellation cannot free an active physical lease.
4. Binary Kotlin defaults/suspend and inherited host members really link.
5. Existing source IDs/configuration/update behavior preserved; missing capability is not a source-dead verdict.

## Progress

- [x] Task1 HTTP/session broker core: real TLS, bounded IPC and disk cookies passed; production host binding remains part of Task3.
- [x] Task2 bounded published package execution: four registrations and the Anime4up offline catalogue/search/details/episodes/direct-link journey passed API29/35. This is not universal extractor compatibility or live-site playback.
- [ ] Task3 Debug integration
- [ ] Task4 acceptance/CI/review

Task3 begins by moving the five existing worker/client/IPC classes unchanged from
the lab application into a reusable Android `:executor` library. Its manifest
retains the same unexported, isolated service; the lab is now a consumer of that
library. Original VANTARA application files and stores remain unchanged. A host
HTTP adapter and manager registration follow, with their own acceptance gates.

## Follow-up: safely detach built-in sources

Ruling: remove built-in provider implementations only AFTER replacement packages
are proven functional and an upgrade migration preserves existing source IDs,
settings, sessions and reading/watching progress. Registration alone is not proof
that a source has a working replacement. Never remove torrent, player or subtitles.

Inventory each built-in implementation and its license/origin, map it to a verified
installable replacement, test a previous-install fixture and a clean install
separately, then remove the mapped implementation from the application build and
repository tree. Retain an idempotent compatibility mapping so existing users do
not lose their sources or links. Missing or broken replacement blocks removal of
that source; it does not justify silently deleting user data. Preserve all notices
required for any redistributed code/packages. Do not rewrite shared Git history,
claim old commits disappear, or promise a percentage reduction in GitHub takedown
risk. A neutral description such as "separate source packages from the application"
must remain factually accurate.
