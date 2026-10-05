# Translation V3 Remake — 100 pages ≤ 120s

**Date:** 2026-10-05  
**Target:** Android APK, first-class target Samsung S23 Ultra class hardware  
**Branch:** `chatgpt/translation-remake-100p120s`  
**Base:** `main@ec083d9ad541fd56b6ca1cf470d3b207df660867`  
**Integration rule:** this branch is a competing candidate. **Do not merge automatically.** Compare it against the other AI branch after implementation and device evidence.

---

## 1. Intent

The goal is not merely to make the current translator "a little faster". The goal is to turn VANTARA's manga translation into a **remake pipeline**:

- contextual Arabic quality stays at or above the current Luna quality,
- every real dialogue region is found with extremely high recall,
- source English does not survive silently under/next to Arabic,
- whitening is deterministic, pixel-safe and visually clean,
- lettering remains expressive and source-aware,
- chapter throughput targets **100 uncached pages in ≤120 seconds** after pipeline warm-up,
- no Home Server,
- no VPS,
- production work remains Android-local for vision/cleaning/rendering plus the existing Cloudflare/OpenAI translation path.

This target is deliberately aggressive. It is a **benchmark target**, not a claim that current hardware already meets it.

---

## 2. Current baseline: do not rebuild what already exists

The current `main` already contains major V2 work that the new design must reuse rather than duplicate:

- per-region fast/heavy ownership via `Regions.fastFlatPlan`,
- accepted fast regions can survive heavy neighbours,
- residual-Latin checking for **known translated regions**,
- adaptive LaMa admission,
- 20 Arabic lettering fonts and Luna lettering metadata,
- strict `God` terminology handling,
- client/server Luna batching for non-interactive pages,
- native reader/render priority reservations,
- a Heavy ROI benchmark candidate,
- engine benchmarking candidates including CPU/XNNPACK/NNAPI,
- chapter wall-clock benchmarking and persisted-page accounting.

Therefore V3 is primarily about **scheduler architecture, coverage recovery, whitening repair, model skipping and per-model inference policy**.

---

## 3. Evidence from the current build

The most recent real-device sample:

- text page median: ~60.6 s,
- `analyze.queue`: ~46.0 s,
- CTD: ~2.68 s,
- BubbleSeg: ~3.58 s,
- Luna: ~7.03 s,
- render: ~0.91 s,
- erase: ~0.56 s,
- one textless page: ~53.7 s total while its actual local analysis was ~0.46 s,
- native model gate busy ~57%.

This tells us the chapter is **not compute-saturated**. A large amount of wall time is queue policy.

The observed page screenshots also show a separate quality failure class:

- entire English bubbles can be missed,
- source text can survive under Arabic,
- free text / edge text is less reliable than clean bubble text,
- whitening quality varies sharply by background type.

---

## 4. Root causes found in the code

### 4.1 Textless pages are often waiting in the JavaScript page queue, not doing vision work

`createQueue` measures `waitedMs` before `job.run()` starts.  
The reported ~53 s textless page had only ~0.46 s of local analysis.

**Consequence:** a native textless shortcut alone cannot solve this. The page has to reach a cheap probe **before** it waits behind complete page translation jobs.

---

### 4.2 Every reader-prefetch page is currently treated as interactive/high priority

`priorityOf(deps)` returns high for everything that is not `job` or `repair`.

The reader runs four page promises concurrently, so the current page **and its prefetched neighbours** all enter native code as reader-high work.

In `TranslationPlugin.analyzePage`, every high page that needs Luna calls `gate.expectRender(page)`.

`PriorityGate` then blocks subsequent heavy reader analysis while that page waits for Luna/render.

This policy solved the old "Luna returned but render waits behind CTD" problem, but it also serializes chapter throughput far more than intended.

**Design correction:** only the actually focused page gets the strict render reservation. Prefetch pages must not reserve the heavy lane while waiting for Luna.

---

### 4.3 Reader traffic bypasses the Luna batcher

`createTextBatcher.enqueueTextPage(... interactive=true)` calls `/v1/translate/text` directly.

Because all reader pages are classified high/interactive today, the reader's prefetch pages do not use the existing 4-page/64-region batch path.

**Design correction:** current visible page = interactive/direct. Reader prefetch = batchable.

---

### 4.4 Tight ROI already exists, but it is intentionally benchmark-only

`HeavyRoi`, `probabilitiesRoi`, and `segmentRoi` exist.

However both CTD and BubbleSeg still execute a fixed `1024×1024` model input per inference. A smaller source crop does **not automatically reduce network FLOPs** if it is resized/padded to the same 1024 tensor.

ROI can still help by:

- reducing the number of full-width tiles,
- reducing mask/post-processing work,
- allowing isolated rescue work,
- avoiding unrelated regions.

But the biggest speed win is to **skip CTD/BubbleSeg entirely whenever possible**, not merely crop them.

---

### 4.5 Residual-English verification cannot find text that was never detected

`ResidualLatin` examines known translated regions after erase.

It cannot discover:

- a complete bubble whose text box never became a region,
- `HUH?` / short text omitted before Luna,
- free text missed by RT-DETR.

V3 therefore needs a separate **Missing-Text Sweep** before translation completion.

---

### 4.6 Current XNNPACK threading is a real performance hypothesis

Current ORT sessions use roughly:

- ORT intra-op threads = 4,
- XNNPACK threads = 4,
- ORT thread spinning enabled.

ONNX Runtime's official XNNPACK guidance recommends, when XNNPACK owns the compute-heavy nodes:

- disable ORT intra-op spinning,
- set XNNPACK threads to the physical core count,
- set ORT intra-op threads to 1.

Source: https://onnxruntime.ai/docs/execution-providers/Xnnpack-ExecutionProvider.html

The current setup is therefore a valid benchmark target, not an assumed optimum.

There is an extra risk: `probePipeline` can run RT-DETR concurrently with the main heavy pipeline, potentially producing thread-pool contention on an 8-core phone.

---

### 4.7 Upstream evidence supports two experiments, but neither is a default yet

1. ONNX Runtime says Android CPU/XNNPACK/NNAPI choice is model/device-specific; partitioning on NNAPI can degrade performance.  
   Source: https://onnxruntime.ai/docs/tutorials/mobile

2. The manga-image-translator CTD history reports OpenCV DNN CPU inference as roughly 4–5× faster for its 1024 CTD path in that environment.  
   Source: https://github.com/zyddnys/manga-image-translator/issues/39

3. OpenCV provides ONNX DNN loading and backend/target selection.  
   Source: https://docs.opencv.org/4.13.0/d6/d0f/group__dnn.html

This is evidence for benchmarking, **not proof of S23 Ultra speed or output parity**.

---

## 5. Success criteria

### 5.1 Performance target

For a real 100-page chapter:

- exactly 100 unique pages,
- translation cache fresh,
- pages actually fetched from the source,
- every accepted result persisted,
- physical-device evidence,
- wall-clock from first admitted page to 100th accepted/persisted page,
- target: **≤120,000 ms**.

Target steady-state throughput:

> approximately one completed page every 1.2 seconds after pipeline saturation.

### 5.2 Quality gates

The performance target is invalid if quality regresses.

Required:

- dialogue/text detection recall ≥ 99% on the quality corpus,
- mixed Arabic + surviving English in a translated bubble = **0**,
- untranslated real dialogue ≤ 1% and never silently marked complete,
- outside-mask corruption = **0 pixels** in exact verification regions,
- source art outside approved erase/draw bounds remains unchanged,
- `no-op` erase regions = 0 for accepted translated regions,
- Arabic text visible and fitted,
- no accidental SFX/credits destruction,
- Luna translation quality and glossary consistency do not regress.

### 5.3 Route distribution target

For ordinary dialogue-heavy chapters:

- Instant/Fast: ≥70% pages,
- Mixed: 20–25% preferred ceiling,
- Rescue: ≤5–10%,
- full-page CTD/BubbleSeg: debug/rescue only, effectively ~0% in ordinary production flow.

---

## 6. Architecture: staged chapter pipeline

A page is no longer one monolithic promise occupying a queue slot from start to finish.

Each page moves through states:

```
DISCOVERED
  -> PROBED
  -> TEXTLESS_DONE
  -> ROUTED_FAST | ROUTED_MIXED | ROUTED_RESCUE
  -> OCR_READY
  -> LUNA_PENDING
  -> LUNA_READY
  -> CLEAN_READY
  -> VERIFIED
  -> RENDERED
  -> SAVED
```

Logical lanes:

1. **Probe/Detect lane**
2. **Heavy Vision lane**
3. **Luna Network lane**
4. **Render/Clean lane**

These are logical lanes, not permission to run four neural models blindly at once.

A resource arbiter controls actual heavy native inference:

- RT-DETR may preempt for the focused page,
- CTD/BubbleSeg/LaMa do not run concurrently with each other by default,
- fill/layout/encoding may overlap network,
- optional detector overlap is enabled only when device benchmark shows net throughput improvement,
- thermal/memory admission can reduce concurrency.

---

## 7. Focused page vs prefetch page

The scheduler must carry an explicit page role:

- `focused` — currently visible page,
- `near` — next few pages,
- `prefetch` — chapter background pages,
- `repair` — incomplete/residual retry.

Only `focused` receives:

- direct Luna call if batching would add latency,
- strict render reservation,
- RT-DETR preemption,
- optional emergency lightweight detector overlap.

`near` and `prefetch`:

- are batchable,
- may continue probing while focused page waits on Luna,
- never hold the heavy native lane merely because Luna has not returned,
- ready renders still outrank new heavy analysis.

This preserves the latency fix from #152 without sacrificing chapter throughput.

---

## 8. Phase A route: Instant

Candidate conditions:

- RT-DETR text holder is clear,
- bubble/background geometry passes deterministic checks,
- local glyph mask is strong enough,
- OCR confidence passes the fast threshold,
- no unresolved sibling text.

Work:

- RT-DETR,
- deterministic bubble/text mask,
- PPOCR recognition,
- local fill cleaner,
- Luna,
- render.

No CTD.  
No BubbleSeg.  
No LaMa unless post-clean verification proves fill is insufficient.

Expected local vision budget on S23-class device:

- ~0.3–0.8 s/page is the desired target after provider/thread tuning.

---

## 9. Phase B route: Mixed

A page can contain both fast and difficult regions.

Only difficult regions escalate.

Possible difficult conditions:

- non-flat/gradient holder,
- text_free,
- unusual orientation,
- failed fast OCR,
- ambiguous bubble ownership,
- residual text after first cleaning pass.

Heavy work is restricted to candidate context, while accepted fast regions retain ownership.

Important: V3 must measure **number of neural inferences**, not only crop area. A tight ROI that still executes one 1024 CTD + one 1024 BubbleSeg pass may not be materially cheaper than one full-width tile.

---

## 10. Phase C route: Rescue

Rescue is for genuinely difficult regions, not a normal path.

Tools, in order:

1. stronger deterministic mask expansion,
2. CTD ROI refinement,
3. BubbleSeg ROI only if holder mask remains ambiguous,
4. LaMa crop,
5. post-clean residual verification.

If the region still cannot be cleaned safely:

- it is marked incomplete,
- source pixels are preserved,
- it does not count as completed translation.

---

## 11. Missing-Text Sweep

This is a new subsystem and addresses a failure class V2 cannot see.

### 11.1 Soft RT-DETR candidates

Detector post-processing should retain a lower-confidence candidate band for validation, while normal production acceptance remains conservative.

Example concept:

- accepted text: ≥ current production threshold,
- soft candidate: below production threshold but above a lower floor,
- soft candidate becomes a region only if geometry + OCR validate it.

Lowering the candidate floor does not require another neural inference.

### 11.2 Orphan bubble sweep

For every detected bubble/holder with no accepted text region:

1. estimate holder background,
2. derive unclaimed ink-like connected components using existing mask primitives,
3. group plausible word/line components,
4. run PPOCR only on the candidate,
5. synthesize a text region when OCR is confidently Latin dialogue.

This directly targets "bubble detected, text box missed".

### 11.3 Free-text sweep

For uncovered areas:

- inspect unclaimed high-contrast component groups,
- reject art-like groups aggressively by geometry,
- use OCR as the final validator,
- only escalate to CTD ROI when local evidence is strong enough.

False-positive candidates are acceptable internally; false translated art is not.

### 11.4 Completion semantics

A page cannot be marked complete solely because every **known** region was translated.

Completion must also record that Missing-Text Sweep produced no unresolved dialogue candidates.

---

## 12. Whitening V3

Luna does **not** directly edit pixels.

The pixel path remains local and deterministic.

Four conceptual cleaners:

### FlatCleaner
- clean homogeneous bubble,
- exact local fill,
- no LaMa.

### BubbleCleaner
- non-uniform but bounded holder,
- text mask + constrained repair,
- protects outline and neighbouring art.

### ArtCleaner
- free text over artwork,
- exact/expanded glyph mask,
- crop-only LaMa when necessary.

### RescueCleaner
- mask repair after residual detection,
- CTD refinement if needed,
- strongest safe local inpainting.

The implementation may share code; these are decision modes, not necessarily four classes.

---

## 13. Mask-repair loop

Current residual verification happens after the initial erase. V3 turns it into a bounded repair loop.

For each translated region:

1. erase using planned mask,
2. run cheap residual candidate gate,
3. if Latin remains:
   - identify residual connected components,
   - expand/union only around the residual source glyphs,
   - re-erase locally,
4. OCR verify again,
5. if still failing:
   - CTD ROI refinement,
   - re-erase,
6. if still failing:
   - preserve the source region,
   - mark incomplete/rescue failure,
   - never draw Arabic over surviving source text.

No page-wide retry for one failed bubble.

---

## 14. Luna's role in whitening

Luna may participate only as an **advisory classifier inside the existing translation response**, never as a pixel editor.

Optional metadata:

```json
{
  "surface": "flat | bubble | art | free",
  "erase": "conservative | normal | strong"
}
```

Rules:

- no extra Luna request for whitening,
- local image evidence remains authoritative,
- Luna cannot force an unsafe fill/inpaint mode,
- invalid/missing metadata falls back to deterministic local classification,
- this metadata is introduced only if A/B tests show measurable quality gain.

The first implementation milestone does **not require** Luna cleanup metadata.

---

## 15. BubbleSeg becomes conditional

RT-DETR already provides bubble/text relationships and VANTARA already has deterministic mask utilities.

V3 adds a local `BubbleMasker` candidate:

- region growing/flood from estimated holder paper,
- connected-component cleanup,
- hole fill,
- containment and border validation.

BubbleSeg runs only when:

- local holder extraction fails,
- bubble boundary is ambiguous,
- overlapping/linked bubbles cannot be separated safely.

This direction is consistent with other comic translation pipelines that use algorithmic segmentation from detector boxes rather than a segmentation model on every region.

Reference: https://github.com/ogkalu2/comic-translate

---

## 16. CTD becomes conditional

CTD is no longer "heavy path means always CTD".

First try deterministic local glyph extraction:

- dark-on-light and light-on-dark contrast,
- adaptive local background,
- connected-component geometry,
- anti-alias expansion,
- OCR validation.

CTD is invoked only when:

- local glyph mask fails validation,
- free text/art requires stronger segmentation,
- residual cleanup needs mask refinement.

The existing CTD remains the high-quality rescue model.

---

## 17. Provider/thread policy

Benchmark per model, not one global engine assumption.

Candidate matrix:

### RT-DETR int8
- CPU EP candidate,
- current XNNPACK candidate,
- recommended XNNPACK threading candidate,
- NNAPI candidate.

Because it is quantized, ONNX Runtime's mobile guidance says CPU is the first baseline worth testing.

### CTD / BubbleSeg
- current 4 ORT + 4 XNNPACK + spin,
- ORT 1 + XNNPACK N + no spin,
- CPU-only variants,
- NNAPI candidate,
- OpenCV DNN CTD experiment only if integration cost/size is justified.

### LaMa / OCR
Measured separately; no provider switch based on another model's result.

No candidate becomes default unless:

- result equivalence is within the declared tolerance,
- speed wins on the S23 target,
- memory/thermal behavior is acceptable.

---

## 18. One-time engine calibration candidate

To avoid hardcoding assumptions for every Android device, V3 may cache a device/model engine choice.

Key:

```
(model SHA, device model, Android build, VANTARA model version)
```

Calibration policy:

- never delay the focused first page with a large benchmark,
- run after first successful page or during explicit benchmark mode,
- compare safe candidate outputs,
- persist fastest valid provider/thread choice,
- clear cache when model/app version changes.

This is optional until the explicit S23 benchmark proves the value.

---

## 19. Luna batching

The current server batch contract is retained because it already preserves per-page cache/quota/storage semantics.

Client policy changes:

- focused page: direct request,
- reader near/prefetch: batchable,
- background job: batchable,
- up to 4 pages / 64 regions,
- bounded in-flight batches,
- adaptive downshift on 429/busy,
- no blind retry after a paid ambiguous upstream result.

The scheduler should attempt to keep Luna busy while native heavy vision works on other pages.

---

## 20. Probe wave and textless bypass

New native bridge concept:

`probePage({path, chapterKey, pageIndex, role})`

It performs only:

- read/hash reuse,
- decode reuse,
- RT-DETR,
- textless decision,
- caches detections for later heavy finish.

Critical implementation rule:

**full analyze must reuse cached probe detections and must not run RT-DETR again.**

The chapter scheduler can admit many pages through the probe lane before they occupy full translation slots.

Textless pages then finish at probe time and never wait for:

- CTD,
- BubbleSeg,
- Luna,
- render,
- LaMa.

---

## 21. Scheduler resource policy

The target is throughput without thermal collapse.

Initial conservative policy:

- one heavy native inference at a time,
- one focused detect may preempt queued heavy work,
- no default simultaneous CTD + BubbleSeg sessions,
- Luna/network overlaps native compute,
- fill/layout/encoding can overlap network,
- heavy page count and thermal status feed back into prefetch depth,
- if thermal status reaches severe, reduce prefetch/concurrency before sleeping the entire pipeline.

Parallel detector overlap remains a measured candidate, not assumed beneficial.

---

## 22. Instrumentation required

Every page records:

- JS queue wait,
- probe queue,
- RT-DETR time and tile count,
- route: fast/mixed/rescue,
- local-mask time,
- CTD calls/tiles,
- BubbleSeg calls/tiles,
- OCR calls,
- Luna batch ID/size and latency,
- render queue,
- erase mode,
- residual passes,
- repaired mask pixels,
- unresolved candidates,
- engine/provider selected,
- thermal status,
- gate occupancy,
- saved completion time.

Chapter summary records:

- wall time,
- route distribution,
- textless count,
- residual failures,
- missing-text recovered count,
- heavy model invocation counts,
- batch sizes,
- p50/p95 stage latency,
- accepted/persisted page count.

---

## 23. TDD and validation strategy

Implementation follows red-green-refactor.

### Scheduler tests
- textless probe completes before old full-page queue order,
- focused page alone receives direct Luna and render reservation,
- prefetch pages batch,
- ready render outranks new heavy work,
- reservation cancellation cannot deadlock,
- no duplicate RT-DETR after probe,
- cancellation and retry preserve page identity.

### Coverage tests
Fixtures for:

- bubble with detector text miss,
- short `HUH?`,
- large `I KNEW IT!`,
- free text outside a bubble,
- low-confidence valid text,
- SFX that must not be translated,
- linked bubbles,
- dark bubble / white text.

### Whitening tests
- partial English survives first mask -> repaired,
- failed repair preserves original instead of Arabic-over-English,
- outside-mask pixels exact,
- bubble outline untouched,
- fill path avoids LaMa,
- art path does not flatten artwork,
- multiple residual regions repair independently.

### Engine tests
- engine configuration is explicit per model,
- benchmark candidate failures fall back safely,
- cached engine key invalidates with model/app change.

### Worker/batch tests
- focused direct vs prefetch batch,
- page identity isolation,
- missing one page output does not corrupt peers,
- exact cost accounting remains valid,
- 429 causes bounded concurrency adaptation.

---

## 24. Real-device benchmark gates

A branch is not "winner" from CI alone.

Required S23 Ultra evidence:

### Benchmark A — 100 pages, warm models
- translation cache fresh,
- local model files already installed,
- 100 actual source pages,
- no page cache,
- target ≤120 s,
- all 100 accepted and persisted.

### Benchmark B — quality corpus
At minimum the existing difficult reader pages plus the user's failure examples.

Record:

- expected dialogue count,
- found count,
- translated count,
- residual English count,
- mixed-language count,
- whitening defects,
- outside-mask changes.

### Benchmark C — engine/provider
Same heavy pages under:

- current,
- recommended XNNPACK threading,
- CPU candidate,
- NNAPI candidate,
- OpenCV CTD candidate only if built.

No provider switch without this evidence.

---

## 25. Performance budget

A plausible target distribution for 100 pages:

- 70–80 fast,
- 15–25 mixed,
- ≤5–10 rescue.

However the budget is based on **critical path**, not the sum of page totals.

Approximate desired chapter timeline:

```
0–10 s      probe wave begins; first pages route
5–15 s      first Luna responses + renders
10–90 s     saturated overlap: probe / local vision / Luna / render
90–120 s    final mixed/rescue tail
```

Important correction from the earlier rough plan:

A 350×500 ROI fed into a fixed 1024 model is **not automatically a 350×500 neural workload**. The design will count actual model executions and measured latency rather than assume ROI area equals speedup.

---

## 26. Files expected to change

Likely Android:

- `TranslationPlugin.kt`
- `Pipeline.kt`
- `PriorityGate.kt` or replacement resource scheduler
- `Detector.kt`
- `Regions.kt`
- `ResidualLatin.kt`
- new missing-text/local-mask components
- model wrappers / `Ort.kt`
- native tests

Likely Web:

- `apps/web/lib/translate.js`
- `apps/web/lib/translate-batch.js`
- `apps/web/lib/translate-perf.js`
- `apps/web/lib/translation-native.js`
- `apps/web/v35/reader-translate.js`
- queue/scheduler tests

Likely Worker:

- `services/sync-worker/src/translation-batch.ts`
- only if adaptive batching or optional cleanup metadata requires contract changes.

No PWA translation engine is introduced.

---

## 27. Non-goals

- no Home Server,
- no VPS,
- no remote image inpainting service,
- no replacing Luna translation quality with a cheaper translator,
- no unbounded model parallelism,
- no automatic OpenCV/NNAPI activation without device evidence,
- no page-wide destructive cleanup because one region failed,
- no merging this branch automatically.

---

## 28. Implementation order

1. Add benchmark/instrumentation needed to prove queue root causes.
2. Split focused vs prefetch priority semantics.
3. Add probe wave and cached-detection reuse.
4. Enable reader-prefetch Luna batching.
5. Add Missing-Text Sweep.
6. Add whitening residual repair loop.
7. Make BubbleSeg conditional.
8. Make CTD conditional.
9. Measure/activate safe ROI where it reduces actual inference count or proven latency.
10. Benchmark per-model ORT thread/provider policies.
11. Add optional engine self-calibration only if worthwhile.
12. Run full CI and independent code review.
13. Produce branch comparison report.
14. **Stop. Do not merge.**

---

## 29. Branch comparison rubric

When both AI implementations are ready, compare them on the same inputs.

Weighted decision:

- **35% visual correctness** — missing text, whitening, mixed languages,
- **30% chapter wall time**,
- **15% detection recall**,
- **10% thermal/memory stability**,
- **5% Luna translation consistency**,
- **5% implementation risk/maintainability**.

If one branch has the better scheduler and the other has the better cleaner/detector, prefer a deliberate cherry-pick/integration plan after comparison rather than picking a winner by commit size.

---

## 30. Approval gate

This spec defines the architectural candidate for `chatgpt/translation-remake-100p120s`.

After the owner approves this written spec:

1. invoke Superpowers `writing-plans`,
2. create a concrete task-by-task implementation plan,
3. review the plan,
4. execute with TDD,
5. verify and code-review the branch,
6. leave the result isolated for comparison.

**No merge is authorized by this spec.**
