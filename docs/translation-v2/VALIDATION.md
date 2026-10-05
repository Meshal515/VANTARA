# Translation V2 candidate — implementation and validation

Date: 2026-10-05. Target: native Android APK. Branch: `chatgpt/translation-v2-lettering-performance`.

This is an implemented candidate for review, **not a claim that 100 real pages already finish in 60–120 seconds**. The owner requested branch publication without merging. No stable release, worker deployment or PWA deployment was performed.

## What changed

| Area | Implemented behavior |
| --- | --- |
| Chapter completion | Wall-clock request-to-accepted-and-saved completion; unique page identity; incomplete OCR/render results and failed storage cannot advance completed progress. Cache-only/simulated runs cannot prove the target. |
| Fast/heavy | Conservative per-bubble ownership. Successful fast OCR stays fast when neighbouring bubbles need heavy work. Heavy masks cannot reclaim accepted fast glyphs. Failed fast OCR promotes its own region. |
| Native ownership | Central ORT RunOptions lifetime, cancellation and deadline checks. Inputs/options close only after the native call exits; gate ownership remains held until then. |
| Full resolution | Accepted saved preview first. Optional background refinement has one active and one pending item, generation checks and a 2-second inference budget. Publication uses a new content-addressed path and checks the matching preview/cache generation. Expired/failed refinement preserves the preview. |
| Residual English | Conservative known-region Latin OCR check before Arabic drawing. Residual regions are rejected and locally promoted/reprocessed; unaffected regions retain their accepted results. |
| LaMa | Adaptive 1536px under memory/thermal admission, otherwise 1024px. Existing masking/verification remains authoritative. |
| Luna queue | Background assembly up to 200ms; at most four pages/64 regions per batch and two client batches in flight. Interactive pages bypass assembly. Native image ownership stays bounded. |
| Isolation/accounting | Independent page IDs, cache, claims, quota, storage and exact aggregate token accounting. Bad paid output still records cost. A failed page transaction does not discard good pages. Settlement is acknowledged only after DB commit. Earlier pages win model glossary conflicts within a chapter; learned spellings remain authoritative. |
| Lettering | Closed role/ink/intensity contract, source-visual-first instructions, at most three exact whole-word/phrase emphasis spans. Whole Arabic strings are shaped together, with existing fit/mask/contrast verification. |
| God rule | Case/possessive and Arabic clitic checks, one corrective model request for offending regions, then deterministic ruler-word fallback. Unrelated words such as Godfather/good are excluded. |
| Fonts | Twenty lazily loaded, pinned OFL families with actual role mappings, asset hashes and original license notices. |
| Backend candidates | NNAPI and tight CTD/BubbleSeg ROI comparison are diagnostic candidates, with errors/fallback reported. The validated current CPU/model-context path remains the default until device/corpus evidence supports changing it. |

### ROI and backend limits

Production heavy work is restricted to difficult detections and their necessary tile/row context, and excludes accepted fast ownership. Tight crop inference is implemented **as a benchmark candidate**, not silently enabled: changed model context must pass the real-page quality comparison first. Lower ROI area does not automatically make a fixed 1024 tensor cheaper.

OpenCV DNN has not been added. [CTD's public inference implementation](https://github.com/dmMaze/comic-text-detector/blob/master/inference.py) confirms the historical `cv2.dnn` path; that is not an S23 Ultra speed measurement. NNAPI/OpenCV selection requires actual per-model latency, output quality and fallback evidence.

The refinement budget terminates active ORT runs and checks surrounding CPU work; it is not a hard real-time guarantee for every Android bitmap decode. Optional pending refinements may be superseded by newer reader work. Chapter completion means accepted saved previews, not full-resolution refinement of every page.

## Verification performed

- Web/shared-shell and sync-worker: **149 files, 1197 tests passed**.
- Worker TypeScript typecheck: passed.
- Repository safety: **54 tests passed**.
- Android JVM: **267 discovered, 265 passed, 2 skipped, no failures/errors**.
- Android `testDebugUnitTest`, `assembleDebug`, `assembleDebugAndroidTest`: **BUILD SUCCESSFUL**.
- Font audit: all 20 pinned font/license hashes, Arabic cmap, GSUB and GPOS verified.
- Independent whole-change source review: issues fixed with permanent regressions; final pass reported no remaining blockers in those fixes.
- Diff whitespace checks pass for code; OFL notices intentionally preserve upstream bytes, including upstream CRLF/trailing spaces.

Coverage includes mixed fast/heavy ownership, native budget lifetime, region ROI mapping, LaMa admission, residual Latin, God/clitic fallback, strict lettering normalization, page-scoped batch cost/storage failure, glossary ordering/learning, early/stale/refinement repair events and unsaved progress rejection.

## UNVERIFIED — release gates still outstanding

| Gate | Evidence still required |
| --- | --- |
| **100 real pages in 60–120 seconds on S23 Ultra** | Physical-device cold/warm model benchmark with actual page dimensions/text density, thermal/memory evidence, every accepted page saved and wall-clock completion. No connected Android device was available. |
| Existing 11-page quality corpus | Actual corpus images, whitening/no outside-mask changes, text visibility, no source loss, no clipping, Arabic readability. Corpus was unavailable here. |
| Android cancellation and shaping | Instrumentation tests for a real ORT loop, session reuse, all font loading and shaped emphasis were compiled, **not run on a device**. |
| NNAPI/tight ROI/default choice | Actual S23 model comparisons and corpus equivalence; no device speedup claim. |
| Real Luna network E2E | Worker integration uses real SQLite transactions and controlled model replies, not paid production model requests. Aggregate batching latency, provider limits and lettering judgement require real validation. |
| Residual/LaMa fidelity | Real difficult manga pages and visual comparisons, beyond policy/unit tests. |
| Stable updater/install | Signed release/install and native update compatibility on the physical APK. Candidate debug assembly is not a stable update. |

## Rollout requirements

1. Review this branch; **do not merge automatically**.
2. Apply worker migration `0044_translation_memory_order.sql` before deploying the matching worker. The client falls back to the single-page endpoint only for 404/405, never blindly after a paid request failure.
3. Validate native instrumentation, the quality corpus and real 100-page throughput on S23 Ultra.
4. Only after those gates, release the matching signed APK. Shared-shell precache/digest changes preserve compatibility; **no Cloudflare/PWA release is part of this work**.

Local candidate build evidence:

- Native fingerprint: `3a17cae27f7cba22928ea986`.
- Debug APK SHA-256: `4c52b89922b107fe874db4f4f468e1c518338d8e2f4a00f3db4f1c27bbd2e1b4`.
- Instrumentation APK SHA-256: `1a672b4695f3710b311317db96b4569115825bf3fbce4ad1a4984fe06a803e37`.

The debug build installs alongside stable (`com.vantara.app.debug`). Build artifacts are local evidence, not a published signed release.
