# Independent 100-second APK translation candidate

هذه نسخة مستقلة تبحث عن المكسب في حذف الانتظار والعمل المكرر، مع حماية الرندر الذي أصبح يعمل. الهدف **100 صفحة جديدة مقبولة ومحفوظة خلال 100 ثانية**. الهدف لم يُثبت على جهاز فعلي بعد: **UNVERIFIED**.

Branch: `chatgpt/translation-100s-independent`. Baseline: `ec083d9ad541fd56b6ca1cf470d3b207df660867` (includes the working Translation V2 renderer and reader-render priority repair). No competing AI branch was fetched/copied/merged. No main merge, stable release, or Cloudflare/PWA deployment.

## Hidden causes and implemented gains

| Finding | Implemented behavior | Evidence / limit |
| --- | --- | --- |
| Whole-page JS slots remained occupied during Luna; textless pages queued behind them | Bounded preparation lane works ahead of dialogue slots. Textless/cache completion has an independent two-task budget; prepared metadata capped at 24 | Reproduced blocked dialogue versus later textless completion; reader and job integration tests pass. Physical milliseconds UNVERIFIED |
| Reader prefetch bypassed existing Luna batching because every reader page was interactive | Only the actual focused page is interactive. Prefetch uses the shared batcher; background jobs use bounded lookahead | Queue focus and network batching tests pass. End-to-end throughput UNVERIFIED |
| Native analysis reserved the heavy lane throughout the network wait | Analysis and render have independent owners/gates; ready-reader render remains first in its render lane. Individual expensive model calls serialize fairly | Real JVM threads/latches verify heavy serialization and independent lightweight work. Physical contention UNVERIFIED |
| Parallel probe could detect a page and the main pipeline detect it again | Routed detections cross into analysis by original-file hash, with JS and native identity guards | Stale-route regression passes; native integration compiles. Direct-device hash-guard E2E UNVERIFIED |
| Missing text was invisible to the known-region residual checker | Bounded high-contrast component sweep proposes up to 12 additional lines; high-confidence actual Latin OCR must confirm before normal mask/ownership gates | Synthetic blank, high/low-confidence existing boxes and short Latin tests pass. Real recall and art false positives UNVERIFIED |
| Missing-text OCR itself waited for the heavy lock and stalled subsequent routing | One detector owner uses a small separate confirmation session; detector/confirmation bypass the heavy lock | Independent-confirmation contention test passes. Actual OCR/model timing UNVERIFIED |
| Cropping still produced repeated 1024 tensors and coalescing could grow to page size | CTD/BubbleSeg use bounded ROI crops, one model call per crop; oversized holders cannot swallow small text ROIs, oversized text is tiled with overlap | Geometry/ownership regression tests pass. Fixed 1024 tensors still have fixed inference cost; no proportional crop-speed claim |
| Heavy models ran when conservative local geometry was sufficient | Accepted flat regions stay fast; uniform free text can use the same conservative mask checks. BubbleSeg runs only for unresolved speech holders | Fast/mixed/ownership tests pass. Real-model quality acceptance UNVERIFIED |
| Splitting owners could retain fifteen decoded pages | Owner-local decoded cache has both two-entry and 16 MiB limits; oversized frames are not cached. Probe retains detection metadata, not pixels | Byte-budget/eviction tests pass. Total Java/native heap, tensors and model allocations are not capped by this cache |
| Residual retry could revisit the same fast route, or cache handoff could discard repair state | Two bounded local mask repairs precede rejection. Failed residuals retain source pixels; versioned compressed snapshots queue one forced-heavy local rescue for the analysis owner's next retry | Mask-boundary, short-Latin and revision-handoff tests pass. Visual repair E2E UNVERIFIED |
| Render-cache eviction could create another CTD/BubbleSeg owner | Pin compressed handoff while awaiting render; cache misses are analyzed by the analysis owner. Production render owner requires an analysis handoff | APK/JVM compilation passes. Eviction/device E2E UNVERIFIED |
| Whitening changed no pixels yet remained translated | Empty/no-op erasure becomes `skipped:no_erase`, preserves the original and participates in whole-bubble preservation | Reproduced no-op acceptance; regression passes |
| Pending preparation was dropped without settling its promise; its late failure could delete a replacement | Drop settles pending promises; both preparation success and failure check job identity | Reproduced stranded replacement and fixed; regression passes |
| Network growth ignored provider throttling | Adaptive batch window starts at 3, grows up to 6, halves on 429 with finite cooldown; queued thumbnails remain bounded. No internal retry of ambiguous paid work | 429/backpressure/batch isolation tests pass. Real provider limits UNVERIFIED |
| Reports hid routing work or called one gate overall local utilization | Reports expose `route.*`, detector timings and separate lane occupancy; benchmark threshold is 100000 ms | Reporting regression passes; no synthetic result is accepted as device evidence |

Rendering fonts, Arabic shaping, source-led lettering, God/Gods validator, save/publish semantics, accepted-preview-first refinement and existing user cache names remain on the baseline implementation. This branch does not redesign the reader or change playback, sources, accounts or add-ons. The shell change is only job-runner limits; service-worker digest tracks changed packaged assets.

## Verification performed

- Full web/worker suite: **150 files, 1208 tests passed**.
- Sync-worker TypeScript: passed (`tsc --noEmit`).
- Android JVM: **281 tests, 279 passed, 2 skipped**, zero failures/errors.
- APK and instrumentation APK: `assembleDebug` and `assembleDebugAndroidTest` passed. Instrumentation was **compiled, not executed**.
- Repository safety: **54 passed**, including shell digest and native-first bridges.
- Fonts: **20 pinned OFL fonts** verified for hashes/notices, Arabic cmap and shaping tables. Physical rendering UNVERIFIED.
- Fresh whole-branch read-only review: no Critical finding; Important OCR-lane contention and decoded-cache multiplication fixed. Dropped-preparation race reproduced and fixed. Native hash shortcut also guarded.
- `git diff --check`: passed. Dependency symlinks and generated workstation-specific Gradle paths excluded.

Build fingerprint: `a32ca4b55f94a257e7b08154`.
Local debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`, 40,520,247 bytes.
SHA-256: `a060b84325add747059e0b65275bef85d9a6b446cab57ab3e010b1fc2dbfc38c`.
This is a debug candidate build, not a stable release.

## Rulings and remaining work

1. **100 seconds supersedes the old 120-second threshold.** Cost: an ambitious target can still fail physically; no guarantee or achieved-speed claim.
2. **Activate bounded ROI and conditional skipping on this independent candidate.** Cost: changed context can alter model recall; reject stable rollout until real-page comparison passes.
3. **Allow only the small detector/confirmation lane to overlap expensive work.** Heavy CTD/BubbleSeg/LaMa/OCR remain serialized. Cost: small-session CPU/thermal contention remains device-dependent.
4. **Limit cached pixels by bytes and entries; retain no probe pixels.** Cost: oversized pages decode again; total heap/model allocations still require device profiling.
5. **Move forced-heavy residual rescue to the analysis owner's next retry.** Cost: rejected regions remain original until retry; avoids another heavy-model instance and protects unrelated ready pages.
6. **Do not select NNAPI or add OpenCV DNN merely from external speed claims.** Existing device diagnostics compare current, split nonspinning, CPU, NNAPI and ROI output/timing. Cost: possible backend gain remains deferred until measured. OpenCV Android integration/benchmark is **UNVERIFIED / not implemented**.

No review minor was left silently deferred. Real S23 Ultra throughput, battery/thermal behavior, peak memory, Luna latency, detection recall ≥99%, untranslated English ≤1%, mixed-language zero, outside-mask zero and corpus-wide visual quality remain **UNVERIFIED**. Synthetic mask tests and a successful build do not establish those requirements.

Run the existing device diagnostic comparison and export a fresh 100-page job's evidence, with actual physical device/model, warm/cold model state, fresh translation-cache state, image-fetch conditions, request start and last accepted save. Check via:

```sh
node tools/translation-chapter-benchmark.mjs device-evidence.json
```

The checker rejects incomplete/unsaved/duplicate pages and cache-based or missing device evidence. Compare both independent branches on the same images and visual annotations. See `docs/translation-v2/VALIDATION.md` for the existing corpus/device acceptance procedure.

## External sources consulted

- [ONNX Runtime XNNPACK](https://onnxruntime.ai/docs/execution-providers/Xnnpack-ExecutionProvider.html): separate ORT/XNNPACK thread pools can contend.
- [ONNX Runtime threading](https://onnxruntime.ai/docs/performance/tune-performance/threading.html): measure per-session pools and spinning.
- [Comic Text Detector inference](https://github.com/dmMaze/comic-text-detector/blob/master/inference.py): historical OpenCV DNN route is a research lead, not Android/S23 performance evidence.
- [makeacopy](https://github.com/egdels/makeacopy): a different Android device/model reported slower NNAPI, illustrating that provider availability does not imply speed here.

No external source code was copied. Research used the Firecrawl skill; implementation/review used the Superpowers debugging, TDD, plan-execution and verification workflow.
