# Three-anchor integration: verification record

This record distinguishes executable regressions from real Android/model evidence and physical throughput. Targets are goals, not achieved measurements.

## Completed local checks

- Web + sync-worker: **152 files, 1254 tests passed**. Includes real SQLite worker-context regression with controlled Luna response: page 99 terms/characters cannot enter page 3 of the same chapter.
- Domain, DB, API, web-fetcher: **36 files, 468 tests passed**.
- Repository safety: **54 passed**; service-worker cache digest recomputed from actual shell contents.
- Native app JVM suite: **307 tests, 0 failures/errors, 2 skipped** (305 passed). Includes live anchor ordering, retained-output publication, cumulative erasure, unreadable shared bubbles, propagation through multiple overlap/sibling groups, retained glyphs beyond detector boxes, and expiration while another heavy owner still holds its lock.
- Debug APK and app instrumentation APK built successfully for x86_64 emulator review. The x86_64 override is a temporary machine-local Gradle init script, not a product ABI change.
- sync-worker TypeScript: passed.
- 20 pinned OFL fonts: original hashes/notices, Arabic cmap, shaping tables passed; this does not prove glyph appearance on a physical phone.
- Independent read-only review: reported Important issues were fixed and re-reviewed; no remaining Important code issue identified in those fixes. Duplicate enforcement pass was removed.
- `git diff --check`: passed.

## Actual Android verification

**Verified on Android30 AOSP x86_64 with KVM, original pinned models and packaged fonts:**

- Candidate `44b09cfeb1486a19eef7e179c23d83deaa1865c0`: run [37314420413](https://github.com/Meshal515/VANTARA/actions/runs/37314420413), artifact11347376764, **OK (6 tests)**.
- Peer candidate `f2484667cb1d97ae4e1dff31d6bcaf81da926523`: run [37325631139](https://github.com/Meshal515/VANTARA/actions/runs/37325631139), attempt2, artifact11353105002, **OK (6 tests)**. First attempt failed downloading the Android system image before application execution; it is not a translation product failure.
- Actual source/output PNGs were opened and pixel-compared. The f248 flat/real outputs are pixel-identical to the previously inspected44b09 baseline. Flat output: three joined Arabic bubbles,9,738 changed pixels, zero changes outside the three authored bubble boxes. Real manga output:25,755 changed pixels confined to [174,612,507,765], within the main speech balloon; English removed there, artwork/outline/tail and original screenshot button preserved.
- Test replies are controlled Arabic. This proves actual native detection/OCR/render/save/reopen and font shaping for the two samples; **not live Luna or whole-chapter reader E2E**. Emulator test durations are not chapter throughput measurements.
- Evidence archive SHA256 was checked against the Actions upload digest. Provenance and images: [f248 visual audit](f248-visual/AUDIT.md).
- Any later product change requires a fresh runtime/image review; historical images cannot certify it.

Local Android35 software-emulator service crashes and the very slow Android30 software runtime were test-machine limits. Hosted accelerated Android supplied the completed evidence above.

## Whole-holder rescue candidate

Three focused JVM regressions were observed failing against stale-text-box rescue and passing against the explicit-holder repair: far missed glyphs reach assembly, a1200px holder is covered by tiles≤1024, and one holder coalesces duplicate rescue requests while free text keeps its scope. The complete app JVM suite and both APK builds pass locally.

Additional cache regressions reproduced post-delete file-size accounting failure and pass with pre-delete size capture. The original cache cap/keep budgets remain unchanged. Repair admission has34 focused tests plus a reader integration regression:2old regions→1complete merged output is accepted only with valid geometry and disjoint source-word coverage. Missing words, incomplete output, malformed evidence and repeated-text double counting are rejected.

Candidate108d5e's runtime workflow failed before model execution because `sdkmanager` was absent from PATH. The next workflow uses the hosted SDK executable's explicit path; it still needs a successful run and image audit before merge.

A seventh Android instrumentation test now constructs a1250px-tall holder with English lines separated by880px, injects the stale upper-line analysis, requires actual pinned-model OCR to recover both lines and accepted Arabic render/save. Its final workflow result and actual `source-rescue.png` / `rendered-rescue.png` must be checked before merging. See this branch's [PR153](https://github.com/Meshal515/VANTARA/pull/153) for the final runtime/image evidence; this document does not infer a pass from compilation.

## Still UNVERIFIED

- 100 fresh pages on S23 Ultra in 100s/120s, light chapter in 30s, extremely heavy chapter in 300s.
- Physical thermal/battery/peak heap behavior, network contention, current vs NNAPI/OpenCV winner.
- Live Luna end-to-end reliability, cost and latency.
- Annotated full-corpus detection recall ≥99%, untranslated English ≤1%, mixed Arabic/English zero, no-op whitening zero, outside-mask corruption zero.
- Full chapter after cold/warm model startup, rapid sustained focus saturation, and full-resolution refinement under actual phone load.

The acceptance checker will not report MET unless complete fresh physical timing and matching source/output/build/run quality annotations are supplied. Ordinary job exports without those annotations remain UNVERIFIED.
