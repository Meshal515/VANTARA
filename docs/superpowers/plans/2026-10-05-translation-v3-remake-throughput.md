# Translation V3 Remake Throughput Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** إزالة queue amplification والعمل المكرر، تفعيل batch/ROI الحقيقي تدريجيًا، وإغلاق فجوات النص والتبييض للوصول نحو 100 صفحة/120ث على S23 Ultra بدون خادم خاص.

**Architecture:** فصل admission/probe عن heavy/Luna/render؛ الصفحة الحالية interactive فقط، وما أمامها prefetch batchable. الرؤية الثقيلة تصبح ROI-first مع fallback محكوم. Missing/residual text يحصل على detector مستقل محلي بدل الاعتماد على glyph القديم.

**Tech Stack:** Kotlin/Android, ONNX Runtime Android 1.20, JavaScript/Vitest, Cloudflare Worker TypeScript, optional PP-OCRv5 mobile detector, optional OpenCV DNN benchmark.

**Spec:** `docs/superpowers/specs/2026-10-05-translation-v3-remake-throughput-design.md`

## Global Constraints

- No Home Server. No VPS.
- Pixel editing stays on device.
- No performance claim without physical S23 Ultra evidence.
- TDD: RED before production implementation for each task.
- No default NNAPI/OpenCV/ROI switch without parity/quality gate.
- Preserve strict God/Gods terminology rule and Lettering V1 behavior.
- Preserve outside-mask pixel exactness.

## Review Focus

- User jumps far ahead while 4 old reader jobs are running: focused page must not wait behind stale end-to-end slots.
- RT-DETR misses one short/free English text: page must not be finalized textless without secondary evidence.
- Multiple residual-English regions in one page: every one is handled; none is silently ignored.
- Luna returns 429/5xx during a batch: no duplicate paid translation and no stuck native reservation.
- ROI mask differs near a bubble edge: fallback must preserve quality rather than ship a faster damaged mask.

---

### Task 1: Queue truth + reader batching

**Files:**
- Modify: `apps/web/lib/translate.js`
- Modify: `apps/web/v35/reader-translate.js`
- Modify: `apps/web/lib/translate-batch.js`
- Test: `apps/web/lib/translate.test.js`
- Test: `apps/web/lib/translate-batch.test.js`

**Interfaces:**
- `createQueue(...).add(...)` run context adds `interactive:boolean` determined at dispatch from current focus.
- `translatePage` receives `deps.interactive`.
- `priorityOf(deps)` is high only for `via==='reader' && interactive===true`; ahead pages are low/prefetch and batchable.

- [ ] Add failing tests proving focused job can be identified at dispatch and ahead reader pages use batch, not `/text`.
- [ ] Run focused Vitest tests and record RED.
- [ ] Implement interactive classification and batch routing without changing the visible page direct path.
- [ ] Run focused tests GREEN, then web suite.
- [ ] Commit.

### Task 2: Remove JS head-of-line for focused/textless work

**Files:**
- Modify: `apps/web/lib/translate.js`
- Modify: `apps/web/v35/reader-translate.js`
- Modify: `apps/web/lib/translation-native.js`
- Modify: `android/.../TranslationPlugin.kt`
- Modify: `android/.../Pipeline.kt`
- Test: JS queue tests + Kotlin pipeline/plugin helpers.

**Interfaces:**
- Native `probePage({path,chapterKey,pageIndex}) -> {pageHash,textless,perf}`.
- Probe caches detections for later `analyzePage`; text pages do not rerun RT-DETR.
- Reader uses bounded probe admission independently from end-to-end translate slots.

- [ ] RED tests: textless probe completes without waiting for four end-to-end jobs; text probe is reused by subsequent analyze.
- [ ] Implement minimal probe bridge/cache reuse.
- [ ] GREEN focused tests.
- [ ] Commit.

### Task 3: Eliminate duplicate parallel RT-DETR

**Files:**
- Modify: `TranslationPlugin.kt`
- Modify: `Pipeline.kt`
- Test: Kotlin tests around probe/detection reuse.

**Interfaces:**
- A successful text probe provides reusable detections to the main pipeline or makes the old `probePipeline` path unnecessary.

- [ ] RED test counts one detector pass for a probed text page.
- [ ] Replace double-detect path with reusable probe result.
- [ ] GREEN.
- [ ] Commit.

### Task 4: Residual English hard gate

**Files:**
- Modify: `ResidualLatin.kt`
- Modify: `Pipeline.kt`
- Test: `ResidualLatinTest.kt` plus render/cleaning tests.

**Interfaces:**
- residual evaluation accepts a region-local candidate mask independent of original glyph.
- all residual regions are processed; no `residual.first()` special case.

- [ ] RED tests for two residual regions and Latin outside old glyph mask.
- [ ] Implement all-region promotion/repair state and safe fallback.
- [ ] GREEN.
- [ ] Commit.

### Task 5: Missing-text secondary detector

**Files:**
- Modify: `ModelStore.kt`
- Create: `TextSweepDetector.kt`
- Modify: `Pipeline.kt`
- Tests: detector postprocess/decision tests; model manifest safety test.

**Interfaces:**
- `TextSweepDetector.detect(img): List<Box>`.
- only OCR-confirmed Latin candidates can overturn textless.
- pinned official model URL/size/SHA required.

- [ ] Pin official PP-OCRv5 mobile detector artifact and hash.
- [ ] RED geometry/decision tests.
- [ ] Implement detector + candidate OCR confirmation.
- [ ] Keep behind measured policy until device benchmark proves budget/recall.
- [ ] GREEN.
- [ ] Commit.

### Task 6: Production Heavy ROI with fallback

**Files:**
- Modify: `Pipeline.kt`
- Modify: `HeavyRoi.kt`
- Modify: `GlyphSegmenter.kt`
- Modify: `BubbleSegmenter.kt`
- Tests: `HeavyRoiTest.kt`, mixed-region/quality tests.

**Interfaces:**
- heavy regions run `probabilitiesRoi` / conditional `segmentRoi`.
- parity guard/fallback preserves validated full-width behavior.

- [ ] RED tests prove only planned crop is inferred and coordinate mapping is correct.
- [ ] Implement ROI-first.
- [ ] Add explicit fallback counters.
- [ ] GREEN + real corpus CI.
- [ ] Commit.

### Task 7: Conditional BubbleSeg and clean routing

**Files:**
- Modify: `Regions.kt`, `Cleaner.kt`, `Pipeline.kt`
- Tests: fast-flat/bubble mask/edge cases.

- [ ] RED: unambiguous RT-DETR holder/local contour must not require BubbleSeg.
- [ ] Implement conservative local bubble mask acceptance.
- [ ] BubbleSeg remains fallback.
- [ ] GREEN.
- [ ] Commit.

### Task 8: Device backend benchmark and adaptive policy

**Files:**
- Modify: benchmark/reporting only unless device evidence proves a winner.
- Optional OpenCV dependency only in benchmark build path first.

- [ ] Record ORT current, NNAPI candidate and ROI timings/output diffs on S23.
- [ ] Only if output gate passes, select faster backend for the specific model.
- [ ] Do not merge backend default based on desktop/upstream numbers alone.
- [ ] Commit measured policy.

### Task 9: 100-page acceptance report

**Files:**
- Modify: `apps/web/lib/translate-perf.js` and tests.

- [ ] Report JS queue separately from native detect/heavy queues.
- [ ] Record fast/mixed/rescue counts, missing/residual failures, batch size/concurrency.
- [ ] Physical S23 run: 100 uncached pages, fresh translation cache.
- [ ] Target is MET only if all spec acceptance gates pass.
- [ ] Final full CI + code review before merge/publish.
