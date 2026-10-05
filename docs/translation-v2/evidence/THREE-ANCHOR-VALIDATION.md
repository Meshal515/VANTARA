# Three-anchor integration: verification record

This record distinguishes executable regressions from real Android/model evidence and physical throughput. Targets are goals, not achieved measurements.

## Completed local checks

- Web + sync-worker: **151 files, 1219 tests passed**. Includes real SQLite worker-context regression with controlled Luna response: page 99 terms/characters cannot enter page 3 of the same chapter.
- Domain, DB, API, web-fetcher: **36 files, 468 tests passed**.
- Repository safety: **54 passed**; service-worker cache digest recomputed from actual shell contents.
- Native app JVM suite: **298 tests, 0 failures/errors, 2 skipped** (296 passed). Includes live anchor ordering, retained-output publication, cumulative erasure, unreadable shared bubbles, propagation through multiple overlap/sibling groups, retained glyphs beyond detector boxes, and expiration while another heavy owner still holds its lock.
- Debug APK and app instrumentation APK built successfully for x86_64 emulator review. The x86_64 override is a temporary machine-local Gradle init script, not a product ABI change.
- sync-worker TypeScript: passed.
- 20 pinned OFL fonts: original hashes/notices, Arabic cmap, shaping tables passed; this does not prove glyph appearance on a physical phone.
- Independent read-only review: reported Important issues were fixed and re-reviewed; no remaining Important code issue identified in those fixes. Duplicate enforcement pass was removed.
- `git diff --check`: passed.

## Actual Android verification

Status at branch publication: **UNVERIFIED / IN PROGRESS**. No runtime pass is inferred from compilation or JVM results.

The Android35 software emulator booted but its system services repeatedly crashed during package installation (including `StorageManagerService` null `PackageManagerInternal` and ART thread-suspension timeouts). No physical device or KVM is available. A lighter Android30 AOSP image is being tried independently. This is a test-machine failure, not established VANTARA behavior.

`TranslationRuntimeDeviceTest` preloads the exact pinned SHA-verified RT-DETR, CTD segmentation, BubbleSeg, LaMa, English PP-OCR recognizer and dictionary. It tests textless routing, detection/OCR/render/save/reopen, rejected replacement preserving the accepted image, and an existing real manga corpus page. Arabic replies are controlled. Live Luna, chapter-wide reader UI behavior and physical S23 timing are not represented by this test.

## Still UNVERIFIED

- 100 fresh pages on S23 Ultra in 100s/120s, light chapter in 30s, extremely heavy chapter in 300s.
- Physical thermal/battery/peak heap behavior, network contention, current vs NNAPI/OpenCV winner.
- Live Luna end-to-end reliability, cost and latency.
- Annotated full-corpus detection recall ≥99%, untranslated English ≤1%, mixed Arabic/English zero, no-op whitening zero, outside-mask corruption zero.
- Full chapter after cold/warm model startup, rapid sustained focus saturation, and full-resolution refinement under actual phone load.

The acceptance checker will not report MET unless complete fresh physical timing and matching source/output/build/run quality annotations are supplied. Ordinary job exports without those annotations remain UNVERIFIED.
