# Translation V2 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. Keep work on the translation branch separate from APK addon/torrent work.

**Goal:** Translate and render a real 100-page chapter within 60–120 seconds on Galaxy S23 Ultra while passing the whitening, Arabic and lettering quality gates.

**Architecture:** Use a bounded pipeline for image preparation, native per-region analysis, independently keyed Luna page batches and prioritized native rendering. Heavy inference remains cancellable and measured, and optional full-resolution refinement cannot hold chapter completion hostage.

**Tech Stack:** Kotlin, ONNX Runtime 1.20.0, existing PriorityGate/MediaCache boundaries, Android Canvas/StaticLayout, JavaScript queues, TypeScript sync-worker, D1, Vitest/JUnit and device instrumentation.

**Spec:** `docs/superpowers/specs/2026-10-05-translation-v2-lettering-performance-design.md`.

## Global Constraints

- Target: 100 real pages, 60–120 seconds, from chapter request to all accepted pages ready and saved; device performance stays UNVERIFIED until measured.
- Preserve the existing 11-page quality corpus and outside-mask pixels. Failed/skipped translations cannot count as completed.
- No PWA deployment. Preserve updater compatibility; native changes require an APK update.
- Do not modify Torrentio, addons, playback, accounts, library or social in this branch.
- Keep quota and money reservations atomic and page-scoped; preserve actual aggregate model cost accounting for batches.
- God/god → حاكم or ملك; Gods/gods → حكام or ملوك. Apply the constraint only when the source contains the matching English word.
- Exactly the 20 declared OFL families, packaged with pinned source/hash/notices, loaded lazily; model output chooses an enum role, never an arbitrary asset path.
- Experimental batch limits: four pages or 64 regions; background assembly wait at most 200ms; interactive work bypasses assembly wait. These values require measurement, not speed claims.
- Do not increase unbounded concurrency or keep 100 decoded page images in memory.

## Review Focus

- Same region ID on different pages must not cross-write text, styles, cache or billing.
- Timeout must terminate actual native inference before releasing its CPU owner, including an in-flight fullRes run.
- A malformed/partial Luna reply must retain successful pages and retry only missing work without duplicate successful usage.
- Page navigation/cancellation must prioritize the visible page and prevent stale results from replacing its chapter.
- Mixed fast/heavy pages must preserve the original mask quality and all readable bubbles, not count speed by silently dropping hard text.

## Execution order and interfaces

Each task has a RED → GREEN cycle and a focused commit. Read the current classes before editing; use the existing public methods rather than introducing a second translation engine. Create an execution ledger under `.superpowers/sdd/translation-v2-lettering-performance/progress.md` before product changes. Record branch base, test results, device evidence and any decisions changing this plan.

### Task 1: Chapter benchmark and honest progress

**Files:** `apps/web/lib/translate-perf.js`, `translate-perf.test.js`, `translate-jobs.js`, `translate-jobs.test.js`; new `tools/translation-chapter-benchmark.mjs`.

**Interfaces:** `chapterBenchmark({startedAt, endedAt, expectedPages, pageResults, device, environment})` returns completed/failed counts, wall time, target state and stage aggregates. A page result identifies chapter/page/hash and accepted output, not merely analysis completion.

- [ ] Add failing tests for 100/100 accepted pages, 99/100 plus one failure, a cache-only run, reversed completion order and missing device evidence. None may falsely assert measured device success.
- [ ] Run the focused tests and inspect the expected failures.
- [ ] Implement end-to-end timing and aggregation with explicit cache/network/device labels. Do not sum overlapping page wall times as chapter time.
- [ ] Add a report importer that checks real device evidence and the complete page set. A simulated timing input remains labelled simulation.
- [ ] Run the focused tests; commit the benchmark/progress change.

### Task 2: Per-region fast/heavy partition

**Files:** Kotlin `translation/Regions.kt`, `Pipeline.kt`; tests `src/test/java/com/vantara/plugins/translation/FastFlatRegionsTest.kt` and new `MixedRegionPlanTest.kt`.

**Interfaces:** `Regions.fastFlatPlan(img, gray, pageHash, dets): FastFlatPlan`, with accepted fast regions and heavy detections; `Pipeline.finish` consumes that plan and packs a single Analysis.

- [ ] Write failing cases for a flat bubble beside text_free, a textured bubble beside a flat bubble, no holders, two text boxes sharing a holder and overlapping detections. Preserve stable IDs and deterministic reading order.
- [ ] Run `:app:testDebugUnitTest` restricted to those tests; verify expected failures.
- [ ] Partition by region. Keep the existing conservative mask thresholds. Failed fast OCR promotes only that region, retaining successful OCR from other regions.
- [ ] Restrict CTD/BubbleSeg work to heavy detections and required tiles/rows; do not claim ROI inference is cheaper merely because a crop is still resized to the same fixed 1024 tensor. Preserve model context/coordinate mapping and gate changed ROI inference on corpus comparison.
- [ ] Merge fast and heavy regions without duplicate bubbles/IDs. Report fast/heavy region counts and promoted regions, not only page-wide hits.
- [ ] Run focused JVM tests, the existing region/cleaner tests and the real-page quality harness where available; commit only proven behavior.

### Task 3: Real inference cancellation and background refinement

**Files:** Kotlin `translation/Ort.kt`, model wrappers that call `session.run`, `Pipeline.kt`, `PriorityGate.kt`, `TranslationPlugin.kt`; new `InferenceBudgetTest.kt` and Android inference-cancellation test.

**Interfaces:** `InferenceBudget` owns deadline/cancel state for one native inference owner. The central `Ort.run` wrapper accepts its budget and owns RunOptions/tensor/result cleanup. Existing analysis/render bridge requests retain page identity.

- [ ] Write failing tests for cancellation before acquisition, queued cancellation, active inference cancellation, cleanup after errors and an expired refinement that cannot block the next reader page.
- [ ] Inspect ORT 1.20.0's actual RunOptions termination API and exercise it with a small real model on Android. A fake blocked function tests scheduling only, not ORT cancellation.
- [ ] Implement bounded native cancellation. Release the CPU gate after the underlying call exits, not when a waiting coroutine merely times out. Close inputs/results/options in `finally`/`use` paths.
- [ ] Return a quality-accepted visible render first; schedule optional fullRes refinement at background priority with a budget, same-page generation check and no downgrade on failure.
- [ ] Verify cancelling a fullRes task does not close a shared session used by the next page. Run focused tests and build; record device-only tests as UNVERIFIED when unavailable; commit.

### Task 4: Lettering contract and God validator

**Files:** `services/sync-worker/src/translate.ts`, new `translation-lettering.ts` and `translation-lettering.test.ts`, existing text integration tests; `apps/web/lib/translate.js` and cache tests.

**Interfaces:** `normalizeLettering(input, arabic)` returns bounded enum roles/ink/intensity and at most three exact whole-word emphasis spans. `validateGodTranslation(source, arabic)` reports a correction requirement using English word boundaries and Arabic token boundaries.

- [ ] Write failing singular/plural/case/possessive God tests, unrelated Godfather/good tests, prohibited-token tests and Arabic-word substring tests. Add invalid style/role/scale/span cases and exact whole-word matching cases.
- [ ] Verify failures, then add the closed output schema and prompt rules. Bump text prompt version in both client and worker, preserving legacy-cache display without pretending old entries contain lettering.
- [ ] Perform one directed correction for invalid God output; a second invalid result uses the specified safe wording. Do not rewrite unrelated Arabic outputs or split an Arabic word to style a substring.
- [ ] Run worker text/cache/schema integration tests and client version-parity tests; commit.

### Task 5: Font catalog, styled layout and bounded LaMa

**Files:** Kotlin `translation/ArabicLayout.kt`, new `FontCatalog.kt`, lettering models, `Pipeline.kt`, `Inpainter.kt`; font assets/notices/manifest; font-coverage and renderer tests.

**Interfaces:** `FontCatalog.typeface(role)` resolves only packaged enum roles; `LetteringStyle` carries validated role, ink, intensity and whole-word spans. Existing layout/visibility/mask verification remains authoritative.

- [ ] Write failing role/fallback/glyph tests and instrumented emphasis/mask-bound tests. Pin all 20 font files and OFL notices to immutable hashes before packaging.
- [ ] Implement lazy cached typefaces and shaped run layout using Android text shaping. Keep neutral fallback and existing no-text-outside-mask guards.
- [ ] Add per-run stroke/ink without splitting Arabic joining sequences into independent glyph drawing calls. Test 0–3 spans, RTL punctuation and mixed Arabic/numbers.
- [ ] Add 1536 LaMa crop support under measured memory/thermal limits, with a 1024 fallback. Do not expand the erase mask or call LaMa for proven flat fills.
- [ ] Run font/license checks, Kotlin tests and Android snapshots; build debug APK. Unavailable device checks remain UNVERIFIED; commit.

### Task 6: Native backend and residual-text evidence

**Files:** Kotlin `translation/Ort.kt`, `Pipeline.kt`, `Cleaner.kt`, `Perf.kt`, model wrappers and benchmark tooling; residual/backend tests.

**Interfaces:** Backend evidence identifies model, device, provider, timings, memory and output comparison. Residual checks return only known region IDs and local promotion reasons.

- [ ] Add failing mixed-region residual promotion and backend-failure tests. A hard region must not force successful flat regions back through heavy processing.
- [ ] Benchmark ORT CPU/XNNPACK and NNAPI per model. Preserve a working fallback; do not infer faster execution from the backend name or a desktop speed ratio.
- [ ] Evaluate OpenCV DNN only if measured alternatives need it, including APK size, arm64 output comparison and license inventory. Record the choice and evidence in the ledger.
- [ ] Implement cheap residual checking inside known erased regions, with bounded local retry/promotion. Preserve original pixels on failed quality checks and report remaining untranslated regions honestly.
- [ ] Run focused quality/benchmark tests and build; commit the verified backend/promotion changes.

### Task 7: Bounded Luna page batches with page-scoped transactions

**Files:** new worker `translation-batch.ts` and integration tests, existing router/translate.ts; new client `translate-batch.js` and tests; `translate.js`, `translate-jobs.js`, queue/cache tests.

**Interfaces:** `POST /v1/translate/text-batch` accepts one work/chapter/mode and up to four independently hashed pages / 64 regions. Output identifies each page and each region. Client `enqueueTextPage(page, {interactive, signal})` returns only that page's result; interactive requests bypass the background assembly wait.

- [ ] Write failing tests for duplicate region IDs across pages, mixed identities/modes, malformed partial output, cancellation, retries, concurrent quota reservations, 429 and total model cost accounting. Shared IDs must not cause cross-page writes.
- [ ] Define byte/output limits and enforce them before reserving money. Preserve per-page uniqueness, usage and cache entries while recording the real aggregate cost of a model batch; never refund incurred model cost merely because one page failed.
- [ ] Implement batch adapter and safe individual-page fallback. Retain successful results after partial failure and request only missing work; each page's source image/context remains labelled.
- [ ] Implement at most 200ms background assembly wait and bounded in-flight requests. Visible-page requests bypass assembly; cancellation/navigation removes obsolete pending work and cannot apply stale chapter results.
- [ ] Commit glossary/memory effects in page order. Preserve existing limits and account scoping without modifying account flows or increasing paid usage ceilings.
- [ ] Run worker/client integration suites including money/quota races and update compatibility; commit.

### Task 8: Whole-chapter acceptance, independent review and APK delivery

**Files:** quality/benchmark reports and fixtures where licensed/available; release documentation only after verification.

- [ ] Run full web/worker tests, Kotlin tests, repository safety, typecheck and debug build against the exact candidate commit.
- [ ] Run the mandatory 11 real pages and a fixed real 100-page chapter on S23 Ultra: new translations, cold/warm separation, warm three times, all stages included. Record masks/Arabic/style quality, memory, thermal behavior and retries alongside time.
- [ ] If a device/corpus is unavailable or the time exceeds 120 seconds, report UNVERIFIED or target-not-met respectively. Do not merge under a claim of achieved speed.
- [ ] Obtain an independent whole-branch code review; fix important findings with failing regressions and rerun affected/full checks.
- [ ] Only after the spec's merge gates pass, merge and inspect the stable signed APK/native fingerprint/release. Do not publish PWA; do not remove the legacy web.zip without an updater compatibility proof.

## Current state

Only the specification goal and this implementation plan have changed. Runtime code, worker APIs and pipeline behavior are not yet modified. The connected-device benchmark and 100-page timing remain **UNVERIFIED**.
