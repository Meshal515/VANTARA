# VANTARA Translation V3 — speed, cleaning, terminology and Arabic lettering

Date: 2026-10-05  
Branch: `chatgpt/translation-v3-lettering-performance`  
Base: `c89a7459ff4fc79a5d1b51c8225ac7260470312d`

## 1. Intent and success criteria

VANTARA translation must feel immediate on a strong Android phone (target device: Galaxy S23 Ultra) without trading away the difficult-background quality that motivated the local vision stack.

Success means:

- an empty/textless page does only lightweight detection and should normally clear in well under 1 s after warm-up;
- ordinary flat speech bubbles should use the local fast path and avoid CTD, BubbleSeg and LaMa;
- difficult text-over-art should pay the heavy cost only for the difficult regions, never for the entire page;
- one pathological render/full-resolution region must not block the chapter queue;
- a typical 20–30 page chapter dominated by ordinary bubbles should target roughly 30–60 s of background preparation, while the currently visible page remains prioritized;
- difficult cleaning must preserve art better than the current Android 1024-pixel LaMa path;
- source Latin that should have been translated must not silently remain after render;
- `God`/`god` as a standalone word is never rendered as «إله»، «رب»، «آلهة» or another divine rendering in Arabic. It is constrained to the work-context choice «حاكم» or «ملك» (plural «حكام»/«ملوك»);
- Arabic lettering uses multiple intentional styles instead of one font for the whole chapter, with restrained word-level emphasis and rare dramatic color effects;
- translation remains an APK-only capability. No PWA deployment is required for these changes.

## 2. Evidence from current device diagnostics

The current Android report established:

- fast path hit rate: 0 / 14 pages in the sampled run;
- CTD commonly ~16–30 s/page;
- BubbleSeg commonly ~16–28 s/page;
- Luna commonly ~6–12 s when a fresh language call was actually made;
- one full-resolution render reached ~6116 s and blocked the following page queue for ~6215 s;
- local cleaning is executing (non-zero changed pixels, no-op = 0), so remaining English can be caused by missed/unclassified regions rather than a dead LaMa;
- Android LaMa caps a crop at 1024 while the Python reference path uses 1536;
- the Python CTD reference explicitly uses OpenCV DNN because that graph performed far better there than ONNX Runtime for ConvTranspose-heavy inference.

These observations make page-wide heavy routing and provider choice the primary performance problems, and 1024-resized difficult crops plus missed regions the main cleaning-quality suspects.

## 3. Architecture

### 3.1 Region-level routing, not page-level routing

Replace the current all-or-nothing `fastFlatRegions` decision with a classifier that returns:

- `fastRegions`: text regions that are provably inside flat, uniform bubbles;
- `hardTextDetections`: only the text boxes that fail the flat-bubble checks;
- `textless`: no text detections at all.

For a mixed page:

1. RT-DETR runs once.
2. Flat regions are built immediately from local color/ink geometry.
3. CTD and BubbleSeg receive rows/ROIs only for unresolved hard detections.
4. Heavy regions are assembled and merged with the already accepted fast regions.
5. OCR runs on both classes.
6. Any low-confidence fast OCR region is moved into the hard set instead of forcing the whole page heavy.

A single difficult caption therefore cannot make eight ordinary bubbles pay CTD/BubbleSeg cost.

### 3.2 Heavy-model execution provider selection

The app keeps correctness first.

Add provider candidates for CTD/BubbleSeg:

- current CPU/XNNPACK;
- NNAPI when available;
- future QNN support remains optional and must not be required by this revision.

On first heavy use for a device/model-version pair, benchmark a representative ROI using CPU/XNNPACK vs NNAPI. An accelerated provider is accepted only if:

- the session initializes successfully;
- required outputs are present;
- mask/bubble geometry stays within defined tolerance against the CPU baseline;
- latency is materially lower.

Persist the winner by device fingerprint + model hash. If validation fails, stay on the current CPU path.

Do not blindly enable NNAPI globally. ONNX Runtime officially exposes `SessionOptions.addNnapi()`; execution-provider availability is checked at runtime. The implementation must retain CPU fallback.

External reference:
- https://onnxruntime.ai/docs/execution-providers/NNAPI-ExecutionProvider.html
- https://onnxruntime.ai/docs/execution-providers/QNN-ExecutionProvider.html
- ONNX Runtime Android test uses `OrtEnvironment.getAvailableProviders()`, `addNnapi()`, and `addQnn(...)`.

### 3.3 LaMa difficult-background quality

For strong devices (8+ logical processors and sufficient memory):

- raise difficult-crop maximum edge from Android 1024 to 1536, matching the Python reference;
- keep 1024 fallback under memory pressure / thermal pressure;
- record `lamaInputEdge`, `lamaScaled`, latency and changed pixels per region.

LaMa remains region/crop-based, never page-wide.

### 3.4 Full-resolution isolation

Full-resolution refinement must not own the same gate that blocks analysis/render of the visible or next page.

Rendering becomes two-stage:

1. **reader result**: analysis-resolution cleaned + Arabic result, displayed as soon as it is valid;
2. **refinement result**: full-resolution cleanup/draw generated at lower priority and atomically replaces the reader result.

A watchdog cancels/degrades a full-resolution refinement that exceeds a sane per-region/page budget. A pathological fullRes job must never stall other page analysis.

### 3.5 Residual Latin repair

After cleaning and Arabic draw:

- inspect translated-region boxes and a small margin for strong Latin-letter components that overlap the original source-mask geometry;
- do not treat scene art/credits/SFX as failures;
- if a speech/thought/narration region still contains source Latin, rerun only that region through the hard local path;
- cap repair to one local retry per region;
- log `residualLatinDetected` and `residualLatinRepaired`.

This targets the observed case where one narration block translated while another English block remained intact.

## 4. Language policy: God = ruler/king only

### 4.1 Prompt rule

For standalone English `God`/`god` and plural `Gods`/`gods`:

- allowed Arabic semantic family: `حاكم / ملك / حكام / ملوك` only;
- forbidden in this product: `إله / رب / آلهة` and other divine renderings;
- choose between ruler and king from story context, hierarchy and established glossary;
- once a work establishes a rendering for a title/term, store it in the work glossary and reuse it.

This rule does not automatically rewrite unrelated longer words such as `godlike`; those remain contextual unless the glossary says otherwise.

### 4.2 Hard post-validator

Do not trust prompt compliance alone.

If the source region contains standalone `god`/`gods` and the returned Arabic contains a forbidden divine rendering:

1. reject that region's translation;
2. retry only that region with the allowed set;
3. if the retry still violates the rule, use a deterministic safe fallback from number/context (`حاكم/حكام`) rather than display the forbidden wording.

Tests cover capitalization, possessive forms and plurals.

## 5. Lettering system: 20 Arabic families + semantic roles

### 5.1 Fonts

Use 20 Arabic-capable OFL families, pinned to exact upstream revisions/hashes:

1. Baloo Bhaijaan 2
2. Cairo
3. Tajawal
4. Changa
5. Reem Kufi
6. Noto Kufi Arabic
7. Noto Sans Arabic
8. Noto Naskh Arabic
9. Amiri
10. Aref Ruqaa
11. Markazi Text
12. Scheherazade New
13. Lateef
14. Mirza
15. El Messiri
16. Mada
17. Harmattan
18. Lemonada
19. Almarai
20. Lalezar

The stable APK build pins/downloads the fonts and verifies hashes/licenses. Raw font files are not user-facing downloads.

### 5.2 Do not randomize fonts

Luna returns semantic lettering intent, not arbitrary font filenames.

Extend each translated region with:

- `lettering.role`: one of a bounded enum such as normal_dialogue, narration, thought, whisper, shout, anger, fear, regal, child, comic, ominous, system, sign;
- `lettering.intensity`: 0–3;
- `lettering.emphasis`: at most three Arabic word spans with bounded emphasis roles;
- optional `lettering.colorRole`: normal, muted, warning_red, blood_omen.

The Android renderer maps these roles deterministically to the 20-font palette. Luna never chooses a filesystem path.

### 5.3 Follow source letterers strongly

The page image is authoritative visual context. The model should infer lettering intent from the foreign scanlation's actual treatment:

- unusually large/bold source text => stronger Arabic size/weight;
- small airy source => whisper/aside treatment;
- distinct caption typography => narration role;
- colored or dramatically styled source => allow a corresponding Arabic color/style when readable;
- ordinary dialogue stays visually consistent.

Do not invent dramatic styling when the source gives no signal except for a very rare narrative moment where context and source composition both support it.

External lettering references support this approach:
- Blambot's professional lettering guidance uses emphasis styles for stressed words, distinct caption treatment, smaller dialogue for mutters/whispers, and SFX styles that convey intensity: https://blambot.com/pages/comic-book-grammar-tradition
- contemporary comic-lettering guidance recommends stable dialogue sizing with deliberate larger/bolder emphasis for shouting and smaller/airier treatment for whispers;
- scanlation/webtoon guides commonly separate dialogue, narration, soft SFX and hard SFX instead of using one face everywhere.

### 5.4 Dramatic red / blood style

`blood_omen` is deliberately rare.

Renderer treatment:

- deep red fill;
- dark/black outer stroke for contrast;
- heavy display face (default mapping: Lalezar/Changa based on fit);
- optional subtle shadow;
- no animated effect;
- only for a whole short phrase or up to a few emphasized words;
- never sacrifice readability or paint red text over a background with insufficient contrast.

No random red dialogue.

### 5.5 Word-level emphasis

Arabic words separated by spaces can be laid out as shaped runs. The layout engine becomes run-aware:

- each run has typeface, relative scale, color, weight/stroke policy;
- line width is the sum of run widths;
- wrapping and polygon fit use actual selected run metrics;
- emphasis is normally 0–3 words per bubble;
- no per-letter font switching;
- if a styled run makes the text not fit, reduce its emphasis before shrinking the entire bubble below readability thresholds.

## 6. Structured output and cache versioning

Raise `TEXT_PROMPT_VERSION`.

Extend the translation JSON schema with a bounded `lettering` object. Existing cached pages from older prompt versions are stale for lettering and are repaired/retranslated under the normal version policy.

The work glossary continues to own terminology consistency. Lettering choices are not added to terminology rows; they remain region output because emotion/presentation can vary page by page.

## 7. APK-only release behavior

Translation is already declared APK-only in product capabilities.

The Android stable workflow may continue attaching `VANTARA-web.zip` to the GitHub release because that file is the APK's internal hot-update bundle; this workflow does **not** deploy the PWA to Cloudflare Pages. Removing the web asset would require changing the updater contract and is unnecessary risk.

For this work:

- do not run/deploy a PWA release;
- publish the normal signed stable APK after main CI succeeds;
- native translation changes alter the native fingerprint, so installed clients are directed to the APK update rather than a web-only hot update.

## 8. Testing and verification

### Unit / deterministic

- mixed page: easy regions fast, hard region heavy;
- low-confidence fast OCR falls back only for that region;
- textless page never initializes CTD/BubbleSeg/LaMa;
- NNAPI candidate rejected on output mismatch and accepted only on equivalent output + lower latency policy;
- LaMa edge policy chooses 1536 on strong device and 1024 fallback under constrained policy;
- fullRes timeout cannot hold the translation gate;
- residual Latin triggers one-region repair;
- `God/Gods` validator forbids divine Arabic and accepts only ruler/king family;
- lettering schema rejects unknown font/style/color roles and >3 emphasis spans;
- run-aware layout never draws outside allowed bubble mask;
- blood_omen retains contrast and obeys rarity/bounded rules.

### Existing regression

- Android unit suite;
- Android debug assemble;
- repository safety tests;
- JS/Vitest suite;
- mandatory 11 real-page Python translation suite;
- existing cleaner/visibility/pixel-boundary tests.

### Device evidence before claiming performance

CI cannot prove S23 Ultra latency. Before calling the performance target achieved, the new report must be run on the device after clearing the performance log and translating a single fresh chapter.

Required report fields:

- fast regions vs hard regions, not merely pages;
- provider used per heavy model;
- CTD/BubbleSeg inference time per hard ROI;
- LaMa input edge and scaling;
- immediate reader-render latency;
- background fullRes latency separately;
- residual-Latin detections/repairs;
- lettering-role counts.

Performance targets are goals until measured on the phone; correctness gates are mandatory regardless of speed.

## 9. Rollback

Every optimization fails closed:

- fast-region uncertainty => heavy region path;
- NNAPI/provider mismatch => current CPU/XNNPACK;
- 1536 LaMa memory/thermal issue => 1024;
- lettering font missing => Baloo Bhaijaan 2;
- unsupported lettering metadata => normal_dialogue;
- residual repair failure => keep the safer original/validated render rather than destructive cleaning.

This preserves the current reliable path while allowing aggressive speedups where evidence says they are safe.
