# Translation V3 Throughput Root-Cause Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the hidden scheduling and quality failure modes that currently prevent the reader from approaching 100 fresh pages in 120 seconds while preserving local-only vision/cleaning (no home server, no VPS).

**Architecture:** Keep the existing Android-local vision/cleaning + Cloudflare/OpenAI language split, but pipeline resources by stage instead of holding whole-page slots. The reader may have several pages analyzed/network-bound at once, while the native heavy lane stays bounded and ready renders preempt queued heavy work. Quality gates must fail closed per region: free dialogue is never silently treated as SFX, and residual Latin verification must not depend on the same incomplete glyph mask it is trying to verify.

**Tech Stack:** Android/Kotlin, ONNX Runtime Android 1.20.0, Capacitor bridge, JavaScript/Vitest, Cloudflare Worker/TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-05-translation-v2-lettering-performance-design.md` plus the approved 100-pages/120s execution brief from 2026-10-05.

## Global Constraints

- No home server.
- No VPS.
- Keep vision, OCR, cleaning, inpainting and Arabic rendering on-device.
- Luna may classify/translate/style regions, but must not directly edit pixels.
- No full-page CTD/BubbleSeg/LaMa on the normal path once ROI parity is proven.
- Never claim 100 pages <= 120s without a fresh physical-device 100-page benchmark.
- Preserve outside-mask pixels exactly.
- Mixed Arabic/English inside a translated region is a failure, not a success.

## Review Focus

- A focused/textless page arriving while four older pages are network-bound must start detection immediately instead of waiting behind whole-page promises.
- Several analyzed pages waiting on Luna must not idle the native heavy lane, but a ready render must outrank queued heavy analysis.
- Reader-visible pages must participate in bounded Luna batching; interactivity may shorten the batching window, not bypass batching entirely.
- Low-confidence `text_free` dialogue such as “HUH?” must not be pre-classified as SFX and silently skipped.
- Residual verification must detect text missed by the original glyph mask and promote every failing region, not only the first one.

---

### Task 1: Expose and remove the page-level JavaScript queue bottleneck

**Files:**
- Modify: `apps/web/lib/translate.js`
- Modify: `apps/web/v35/reader-translate.js`
- Test: `apps/web/lib/translate.test.js`

**Interfaces:**
- `createQueue()` remains the reader admission queue.
- Add a bounded focus-burst/admission mechanism so the focused page can start even when ordinary whole-page slots are occupied.

- [ ] Write a failing test showing four blocked jobs cannot prevent a newly focused page from starting.
- [ ] Run branch CI and confirm the new test fails for the expected reason.
- [ ] Implement the smallest queue admission change that starts the focused page without unbounded page fan-out.
- [ ] Run the targeted test and the full suite.
- [ ] Commit.

### Task 2: Make reader pages actually use Luna batching

**Files:**
- Modify: `apps/web/lib/translate-batch.js`
- Modify: `apps/web/lib/translate.js`
- Test: `apps/web/lib/translate-batch.test.js`

**Interfaces:**
- `enqueueTextPage(page, { interactive, signal })` keeps the same public signature.
- Interactive pages use a short batching window and bounded in-flight batches instead of direct `/v1/translate/text`.

- [ ] Write a failing test proving two interactive pages can coalesce into one `/v1/translate/text-batch` request.
- [ ] Verify RED.
- [ ] Implement short-window interactive batching with cancellation preserved.
- [ ] Verify targeted and full tests.
- [ ] Commit.

### Task 3: Replace the single hard Luna/render barrier with a bounded analyzed-ahead window

**Files:**
- Modify: `android/app/src/main/kotlin/com/vantara/plugins/translation/PriorityGate.kt`
- Modify: `android/app/src/main/kotlin/com/vantara/plugins/translation/TranslationPlugin.kt`
- Test: `android/app/src/test/java/com/vantara/plugins/translation/PriorityGateTest.kt`

**Interfaces:**
- Keep `expectRender(page)` / `cancelExpectedRender(page)`.
- Track a bounded set of reader pages waiting for render; allow heavy analysis until the window is full.
- Ready reader render always outranks queued heavy work.

- [ ] Write failing tests for filling the ahead window, blocking the next heavy page only at the bound, and immediate render priority.
- [ ] Verify RED.
- [ ] Implement bounded reservations.
- [ ] Verify Android unit tests and debug APK build.
- [ ] Commit.

### Task 4: Stop silently classifying free dialogue as SFX

**Files:**
- Modify: `android/app/src/main/kotlin/com/vantara/plugins/translation/Regions.kt`
- Test: `android/app/src/test/java/com/vantara/plugins/translation/MixedRegionPlanTest.kt`

**Interfaces:**
- Local `text_free` regions remain `free`; Luna decides whether content is SFX from page context.

- [ ] Write a failing test for a low-confidence `text_free` region remaining `free`.
- [ ] Verify RED.
- [ ] Remove the score-based SFX heuristic.
- [ ] Verify targeted and full Android tests.
- [ ] Commit.

### Task 5: Make residual-English verification independent of the original glyph mask

**Files:**
- Modify: `android/app/src/main/kotlin/com/vantara/plugins/translation/ResidualLatin.kt`
- Modify: `android/app/src/main/kotlin/com/vantara/plugins/translation/Pipeline.kt`
- Test: `android/app/src/test/java/com/vantara/plugins/translation/ResidualLatinTest.kt`

**Interfaces:**
- Add a cheap residual candidate mask derived from the cleaned ROI itself.
- Promote all failing translated regions in one pass; do not wait one minute per residual region.

- [ ] Write failing tests for residual letters outside the original glyph mask and for more than one residual region.
- [ ] Verify RED.
- [ ] Implement independent ROI residual candidate generation and multi-region promotion.
- [ ] Verify targeted tests, Android suite, and real-page corpus.
- [ ] Commit.

### Task 6: Instrument the 100-page critical path

**Files:**
- Modify: `apps/web/lib/translate-perf.js`
- Test: `apps/web/lib/translate-perf.test.js`

**Interfaces:**
- Report JS queue wait, native queue wait, pages waiting on Luna, batch size, batch in-flight count, route counts and residual promotions separately.

- [ ] Write failing report tests.
- [ ] Verify RED.
- [ ] Add counters without changing runtime behavior.
- [ ] Verify full web suite.
- [ ] Commit.

### Task 7: Backend race remains benchmark-gated

**Files:**
- Modify only if physical-device evidence exists: `android/app/src/main/kotlin/com/vantara/plugins/translation/Ort.kt`, model wrappers and benchmark reporting.

**Interfaces:**
- XNNPACK remains default unless the physical-device benchmark proves NNAPI/OpenCV faster within the output tolerance.

- [ ] Use the existing engine benchmark on the S23 Ultra.
- [ ] Compare XNNPACK, NNAPI and ROI candidate output/timing.
- [ ] Do not change the default backend without device evidence.
- [ ] Record results in the performance report.

### Task 8: Verification and release gate

- [ ] Full VANTARA CI green.
- [ ] Android debug APK green.
- [ ] Mandatory 11 real translation pages green.
- [ ] No mixed Arabic/English regression in fixtures.
- [ ] Open PR for review.
- [ ] Merge only after review and green CI.
- [ ] Publish stable APK.
- [ ] Run fresh 100-page physical-device benchmark; report actual wall time without extrapolation.
