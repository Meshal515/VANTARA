# VANTARA APK Debug — Aniyomi & CloudStream repository compatibility audit

**Date:** 2026-11-01. **Working branch:** `codex/vantara-video-repo-debug-20261101`.
**Base commit:** `2c95fd441a7bead3d280a92bebd8c15cb43e944e`, descended from the active Debug development line `a982611869532709cbc343c3332f8e06a310d0d5`.
**Release policy:** no edits to Stremio, `main`, Stable, live user data, production credentials, or published Debug releases. No APK publication without the owner's authorization.

## Goal

Maximize real-world compatibility and crash-free data-safe behavior for **external Aniyomi and CloudStream repositories/plugins** on the Android Debug APK. Verify repository discovery, publisher/signature trust, package download, APK/DEX class loading, source registration, browsing/search, work details, seasons/episodes, playable stream extraction and playback handoff. Distinguish a broken provider site from a faulty VANTARA bridge by comparing the same plugin and site against its native host, where possible. Tests/fixtures are not proof of playback on actual media.

## Priority / acceptance

1. **Compatibility:** real signed APK and CloudStream DEX, complete ABI and callback contracts, multiple sources per package; no fake-success compatibility matrix.
2. **Reliability and persistence:** no fatal crashes, ANR, unbounded waits, data loss or partial updates; preserve previous known-good APK, source IDs, favorites, watch history and progress.
3. **Full user journey:** add repository → inspect → install → source → catalogue/search → detail → episodes → links → player decodes an actual first video frame; seek/restart/recovery tested separately.
4. **Error attribution:** Engine / Addon ABI / publisher repository / remote source / media CDN / environment / not tested. External failure is not silently reclassified as working.

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
