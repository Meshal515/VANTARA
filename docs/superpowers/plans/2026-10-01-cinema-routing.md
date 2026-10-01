# Cinema source routing implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Repair the four existing Cinema extensions on latest main, deliver a replacement debug APK, merge only after the user-required live phone playback gate.
**Architecture:** Preserve ExtensionAdapter and all Anime defaults. Vetted domain migrations remain source-scoped; exact candidate hosts require source identity validation before promotion. FaselHD opts into IPv6 preference with live-family cache filtering while OkHttp 5.3.2 retains its existing Happy Eyeballs. Diagnose reports every stage without equating stream extraction with device playback.
**Tech Stack:** Kotlin, OkHttp 5.3.2, Jsoup, Aniyomi APKs, existing web bridge and GitHub debug workflow.
**Spec:** User request 2026-10-01 (four sources, full pipeline, no Anime regression, phone playback before merge).

## Global constraints
- Base e582887372d341fdeb38872a5757afbf8c389658 in /workspace/VANTARA-cinema-routing, branch fix/cinema-source-routing. No main writes until tests, APK and phone playback succeed.
- Only FaselHD, ArabSeed, EgyDead, Cimaleek. No new source, no disabling redirect protection, no blanket network reordering, no native adapter without evidence of extension incompatibility.
- Do not claim HTTP or extracted URLs are actual Android playback; no attached phone/adb in this environment.

## Review Focus
- Unknown redirect followed before final-host validation; refuse before contact for opted Cinema requests.
- Current manifest host continues being used after a verified migration; rewrite current and extension base to active host only with opt-in.
- IPv6 comes online after cached IPv4-only DNS; opted source must retain original answers and apply current family availability on lookup.
- Old extension parses zero items from changed HTML; report stage and use manifest fallback only when proven, preserve extension-first path.
- Same episode numbers across seasons; Diagnose selects exact work/season and reports actual chosen URL; failed source must not surface a browser.

### Task 1: Root cause proof
Files: external /workspace/cinema-routing-probe; this plan.
- [x] Fetch latest main and create isolated branch; web baseline458/458.
- [ ] Verify redirect destinations, current extension versions/APK SHA and source selectors; search Shameless, follow details/season/episode/server, fetch media bytes where reachable.
- [ ] Record per-source observed stage and network limits.

### Task 2: Scoped routing and DNS
Files: net/Domains.kt, net/AnimeDns.kt, net/AnimeHostRouter.kt, registry/Manifest.kt, network/HostRouting.kt, network/NetworkHelper.kt; tests CinemaRoutingTest.kt and AnimeNetTest.kt.
Interfaces: Domains.plan carries opt-in strictRedirects/followActive/preferIpv6 and migrationCandidates; router registers their exact hosts, migration reports and IPv6 preference; default values preserve Anime.
- [ ] Add failing tests for rejected unknown intermediate hop, exact candidate identity validation, active-current rewriting, default Anime policy preservation, IPv6 availability changes after cache, and fast fallback.
- [ ] Implement only opt-in policies, retain rejection and genuine failure text; run native harness and existing network tests.

### Task 3: Source compatibility and diagnosis
Files: apps/web/anime/sources.json, adapters/Adapters.kt and registry/Manifest.kt only if proven fallback needed; new focused diagnostics helper and AnimeEngine.diagnose, v35/cinema.js.
Interfaces: Manifest fallback stays extension-first and carries declarative selectors; Diagnose returns Step(label,state,detail) with actual domain, redirect verdict, separate families, extension/search/details/season/episodes/servers/media/device-playback-not-run.
- [ ] Test demonstrated parser mismatch before adding minimal manifest fallback; never alter Anime manifests or matchers.
- [ ] Add bounded family probes and accurate pipeline diagnostics, cancellation-safe UI; run fixture tests and web regression tests.

### Task 4: Verify, review and ship debug
- [ ] Full applicable native/web/build/typecheck/safety checks, fresh whole-branch review; fix important findings with regression tests.
- [ ] Commit feature branch, debug workflow assemble+native tests, verify actual APK package/assets/hash, send replacement APK plus per-source report.
- [ ] Await actual live phone playback evidence for at least one source. Until then main merge remains pending under explicit user gate.
