# VANTARA APK Debug — Aniyomi & CloudStream repository compatibility audit

**Date:** 2026-11-01. **Working branch:** `codex/vantara-video-repo-debug-20261101`.
**Base commit:** `2c95fd441a7bead3d280a92bebd8c15cb43e944e`, descended from the active Debug development line `a982611869532709cbc343c3332f8e06a310d0d5`.
**Release policy:** no edits to Stremio, `main`, Stable, live user data, production credentials, or published Debug releases. No APK publication without the owner's authorization.

## Goal

Maximize real-world compatibility and crash-free data-safe behavior for **external Aniyomi and CloudStream repositories/plugins** on the Android Debug APK. Verify repository discovery, publisher/signature trust, package download, APK/DEX class loading, source registration, browsing/search, work details, seasons/episodes, playable stream extraction and playback handoff. Distinguish a broken provider site from a faulty VANTARA bridge by comparing the same plugin and site against its native host, where possible. Tests/fixtures are not proof of playback on actual media.

## Fixed five-stage execution workflow — owner-approved order

**Mandatory sequence:** 1. Compatibility → 2. Self-Healing & Stability → 3. Full Playback Journey → 4. Evidence & Verification → 5. Zero Data Loss & Final Regression Sweep.

Complete a stage with recorded evidence before asserting the next stage is accepted. Development may add non-destructive instrumentation needed for an earlier stage, but never activate unverified production updates as a shortcut. Data protection remains a hard invariant in **every** stage, with an independent deep audit at stage 5.

### Stage 1 — Compatibility (Aniyomi first, CloudStream second; both highest priority)

- Use actual published, signed Aniyomi APKs and CloudStream DEX extensions from active repositories, not custom success-only fixtures.
- Audit repository index versions, signatures and package identity, class-loader/library ABI, dependencies and callbacks, multi-source factories, registration, extractor interfaces, network/media headers, and native player handoff contracts.
- Reproduce incompatibilities against the original app/compatible native host under comparable network conditions. If a source demonstrably works there, a failure in VANTARA is **not** excused as a broken website.
- **Exit criterion:** each tested package registers all real applicable sources without an avoidable VANTARA ABI, loading or identity failure. Produce a source-by-source compatibility matrix; unknown is **untested**, not successful.

### Stage 2 — Self-Healing & Stability (a core engine feature)

- Implement a guarded update pipeline: **discover → download → verify publisher and hash → stage without touching active package → isolated compatibility probe → real content health probe → compare existing and candidate → atomic activation → post-activation watch → rollback/quarantine on regression**.
- A candidate is **not promoted** for a valid signature, successful class-loading, nonempty manifest, valid page URL, or higher version alone. Probe actual catalogue/search → work detail → episodes → link resolution → usable video content, with bounded timeouts and no user-history mutation.
- On a failing/inconclusive probe: preserve the last-known-good installation, source IDs, account bindings, preferences, cookies and media progress; mark update `pending-unverified` or `failed` with a reason; retry later with rate limits and exponential backoff. Do not silently downgrade a known-working installed package.
- Health-check actual known working sources individually and compare against baseline. A single temporarily failing host should not incorrectly condemn every source in a multi-source APK. A degraded package may have partial-but-real capability; report per-source health, preserve working sources, and avoid claiming total health.
- Auto-recover from transient timeout, DNS/network change, stale caches, process death, server choice failures and authenticated host-origin changes **only where observable and safe**. Respect site identity, publisher identity, HTTPS/trust constraints, user-required verification and credentials. No guess-based URL substitution, silent third-party site scraping, bot challenge circumvention or unlimited retry loops.
- **Exit criterion:** reproducible worker/plugin failures do not crash/freeze VANTARA; interrupted/failed update never destroys its predecessor; viable updated package demonstrates real media and can be rolled back without data changes.

### Stage 3 — Full End-to-End Playback

- Exercise add repository → list repository extensions → download/install → register source → catalogue/search → detail → season/episode → `loadLinks`/extractor → choose stream → native VANTARA player **decodes a first video frame** → seek/resume → close/restart.
- Test multiple live, independent source plugins for both Aniyomi and CloudStream, different extractors, required `Referer`, origin and cookies, and HLS/DASH/direct media as actually encountered.
- An HTTP 200, an extracted URL and downloaded media bytes are only *intermediate* milestones. No decoded-frame evidence means playback is **not yet proven**.
- **Exit criterion:** per-source real-device journeys succeed for working sources; failures are isolated, bounded and actionable.

### Stage 4 — Evidence & Verification

- Run compile/unit/instrumentation/emulator/actual signed-APK checks **on the same commit and feature flags as the Debug binary under test**, with linked logs, source names, site health and stage timings.
- Classify every failure: VANTARA engine / addon ABI / repository/signature / provider site down / human action required / video host / environment / not tested. If host app works but VANTARA fails, classify as our compatibility failure until contradicted.
- Verify first-frame playback separately from page, episodes, stream-link and network checks. Never equate a green CI workflow with a verified playable provider.
- **Exit criterion:** an auditable matrix for every sampled package and source, including evidence, fixes and unresolved limits.

### Stage 5 — Zero Data Loss & Final Round

- Execute upgrade, failed update, interrupted download, crash during commit, force-stop/restart, corrupted metadata, rollback, cache invalidation, repository removal, and account/profile switching with real existing data.
- Compare before/after **source IDs, app library, favorites, watched and resume positions, history, user preferences, trusted repository list, credentials/cookies and local metadata**. No accidental deletion, reset or cross-profile contamination.
- Re-run the *entire* compatibility → self-healing → end-to-end playback → verification matrix after the last change. Explicitly verify Stremio unchanged and main/Stable untouched.
- **Exit criterion:** no observed data loss under the tested failure matrix, no outstanding critical regression and full traceable evidence for the tested packages. This is not a mathematical guarantee for untested providers.

### Mandatory rules

- **Any currently working source and compatible extension ought to work in VANTARA.** A working upstream source that fails solely because of VANTARA is an engine defect to prioritize. Publisher site outages are not engine defects, but must not damage the app.
- Update preflight may run *quietly* without interrupting the user, but must be strictly bounded, minimally invasive, privacy-preserving and never mark content viewed or change the user's watch state. Don't claim it can always verify every media link without side effects or internet access.
- User data, publisher trust, full security checks and Stable isolation are non-negotiable in all five stages. No changes to Stremio, main, Stable or released APK without explicit approval.
- Findings and fixes must reference `file:line`, repro, root cause, narrowly scoped remedy, exact test evidence and remaining uncertainty.

## Verified inputs at project start

- Parent Debug commit `a9826118` contains 1,902 tracked file blobs (GitHub recursive tree). A deliberately broad engine-adjacent path filter found 949 file blobs including 459 under `android/`. This is inventory, **not** 949 semantic code reviews.
- `fix/engine-core-predebug-20261031` adds 22 commits beyond parent and already addresses parts of Aniyomi multi-source identity, safe archive updates, native batch settlement and storage. Its existing CI and Debug APK jobs passed. The optional real-Aniyomi emulator job failed at `ANIYOMI_REPO_NO_SIGNED_MULTI_SOURCE_FACTORY`, **before** testing actual APK execution.
- Published Yuzono `index.min.json` fetched on 2026-11-01 contained 248 entries, including non-NSFW `eu.kanade.tachiyomi.animeextension.all.animeworldindia` declaring **9** sources. This does not establish that VANTARA's preferred `index.pb` parser returns the same list. The new instrumentation diagnostic checks both representations without changing production code or accepting an unsigned APK.
- `docs/audits/engine-compatibility-review-2026-10-31.md` is a source audit, not an E2E certificate; its Aniyomi F03–F05 fixes are present in the base branch in part. CloudStream F09 remains a *coverage risk*, not an assertion that every plugin fails.
- Existing `LiveRepositorySweepTest` probes actual CloudStream repository registration, catalogue, details, episodes, video links and segment headers, but the test's HEAD/MEDIA heuristic **does not** prove a first decoded frame in VANTARA's player.

## Next verification gates

| Gate | Proof required | Current status |
|---|---|---|
| A. Aniyomi v2 repo ingestion | Current `index.pb` source count and publisher-matched `index.min.json`, signed package selection | Diagnostic instrumentation added; execution pending |
| B. Aniyomi binary compatibility | Download signed multi-source APK; instantiate all sources and route IDs | Untested on this branch |
| C. Aniyomi data safety | Fault-injected store/metadata failure, valid previous APK retained through update/restart | Prior base tests exist; fresh verification pending |
| D. CloudStream ABI | ABI/missing method matrix against real published plugins, no `NoSuchMethodError` | Untested on this branch |
| E. CloudStream full journey | Per provider source registration → search/catalogue → work → episodes → streams, native extracted media bytes | Untested on this branch |
| F. Native player | Actual first decoded frame, seek, headers/subtitles, exit/relaunch and no crash/ANR | Untested on this branch |
| G. Regression and isolation | Stremio unchanged, no changes in Stable or `main`, no published Debug | Isolated branch verified by GitHub history |

### Rules for future findings

Every claimed fix must identify: `file:line`, condition, reproduced failure, evidence link/test output, smallest fix, regression result, affected platform, and remaining limitation. A passing CI compilation never upgrades an E2E status to Verified. Real providers that are themselves broken must be recorded separately, not rewritten into “VANTARA success”.

### Traceable evidence

- Baseline signed Aniyomi test failure: https://github.com/Meshal515/VANTARA/actions/runs/41235752127
- Core branch before this audit: https://github.com/Meshal515/VANTARA/tree/fix/engine-core-predebug-20261031
- Previous code audit: https://github.com/Meshal515/VANTARA/blob/fix/engine-core-predebug-20261031/docs/audits/engine-compatibility-review-2026-10-31.md
- Real Aniyomi index: https://raw.githubusercontent.com/yuzono/anime-repo/repo/index.min.json

**Tested status for this working branch:** No end-to-end APK proof recorded as of this audit entry. No fix to production engine code is claimed.

---

## 2026-11-01 — Actual Debug execution evidence (supersedes the initial pending test inventory above)

**Tested application commit:** `7517b76bb26dc8730a2388030350b89fcb985e78` for native video and synthetic update failure; `30424164c949716a9a174f2f1970de5264026b29` for strict public-site source sweep; `5827ad368d472a466f49cef46c5d3e2d408681fa` for the subsequent Aniyomi candidate-source catalogue canary and all Android unit/regression QA. These are scoped tests, **not** certification of every plugin or user-data migration.

| Acceptance gate | Observed evidence | Scope and remaining limitation |
|---|---|---|
| 1. Real external plugin compatibility | Signed multi-source Aniyomi APK 9 source identities: [run 41244416828](https://github.com/Meshal515/VANTARA/actions/runs/41244416828). Real CloudStream source journeys: [run 41269557258](https://github.com/Meshal515/VANTARA/actions/runs/41269557258), 2 of 3 fully reached media bytes. Android worker ABI/API profile checks pass [run 41268827795](https://github.com/Meshal515/VANTARA/actions/runs/41268827795). | Aniyomi 9-source test is factory registration, not episode playback. Other published extensions and unsupported/missing extractors are not certified. |
| 2. Candidate safety / rollback | On-device synthetic broken CloudStream update refuses activation, old version and unrelated user byte sentinel remain unchanged: [run 41268827892](https://github.com/Meshal515/VANTARA/actions/runs/41268827892). Executor real-file tests cover exact CAS rollback, stale metadata, foreign-account guards and corrupt immutable object: [run 41269979203](https://github.com/Meshal515/VANTARA/actions/runs/41269979203). Aniyomi new candidate live-catalogue per-source admission unit tests pass on this same later run. | CloudStream live canary currently checks non-empty catalogue, not details/episodes/streams for **each update**. Aniyomi actual published upgrade + full video canary, scheduled silent update checks, durable last-known-good automatic rollback on later regression are **not verified**. |
| 3. Native decoded-video playback | Real pinned Animewitcher source → real episode/candidate → existing VANTARA `PlayerActivity` and Media3 ExoPlayer on API 35. Test requires ≥200 rendered decoder buffers, ≥25 seconds playback advance over 30 seconds, dropped frames ≤10%, both forward/back seeks: [run 41268827892](https://github.com/Meshal515/VANTARA/actions/runs/41268827892) **SUCCESS**. | One published CloudStream provider / site, not all streams, HTTP headers, HLS/DASH variants, Aniyomi native player or long-running error cases. Detailed logcat and instrumentation outputs in the run's `actual-player-decoded-frame-evidence` artifact. |
| 4. Evidence | Source-stage status, verified links and reachable media byte counts printed in CI [run 41269557258](https://github.com/Meshal515/VANTARA/actions/runs/41269557258). Four Node tests reject false-green zero-success/missing-source output. Main VANTARA CI [run 41268827763](https://github.com/Meshal515/VANTARA/actions/runs/41268827763) and latest optional-runtime Android tests [run 41269979203](https://github.com/Meshal515/VANTARA/actions/runs/41269979203) passed. | Full cross-plugin/source/playback baseline matrix still outstanding. |
| 5. Data integrity and last sweep | Real atomic install/rollback filesystem tests, account separation and synthetic external watch-history sentinel preserved, Android emulator API 26/28/29/35 compatibility regression suite green, backend/web CI green on tested commits. | Full actual user library/bookmarks/history/resume/cookies migration after restart/crash across Aniyomi and CloudStream **not yet exhaustively tested**. Stable/main/Stremio untouched by these isolated branch commits; no publication. |

### Exact real CloudStream site results — strict 2026-11-01 run 41269557258
- **Anime4up:** install, catalogue, details, episodes and videoLinks **PASS**; 9 extracted links; media-byte probe positive. Missing extractors include multiple media host names; link success does not imply all hosts are supported.
- **AnimeWitcher:** all five stages **PASS**; 3 extracted links; media-byte probe positive. The separate native decoded-frame and seek test passed in run 41268827892.
- **Witanime:** install **PASS**; catalogue **VERIFICATION_REQUIRED**, so details/episodes/links not proven. The RuntimePlugin already wires the bounded CloudflareInterceptor silentClearance callback; this result does not establish whether CloudStream original can currently open that site. Do not assign this failure to VANTARA or the publisher without side-by-side comparison.
- **Aggregate:** 3 source journeys inspected, 2 extracted link results, 2 with reachable media bytes, **2 confirmed full five-step media journeys**. This metric is media-byte access, *not* frame decoding.

### Release gate verdict
**NOT YET CERTIFIED FOR PUBLISH** as of this entry: some scoped tests are proven; universal host compatibility and late-degradation Self-Healing, broader first-frame decoding coverage, and full user-data integrity matrix have not been proven. Do not turn a green CI run into a blanket "100%" claim. No merge, Stable/main edit, or APK publication is authorized.
