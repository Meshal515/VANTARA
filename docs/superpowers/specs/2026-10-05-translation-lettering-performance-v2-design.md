# VANTARA Translation V2 — speed, whitening, contextual terminology, and expressive Arabic lettering

Date: 2026-10-05  
Base: `main@c89a7459ff4fc79a5d1b51c8225ac7260470312d`

## Intent

Make Android translation feel immediate on a strong phone such as S23 Ultra **without trading away whitening quality**, while upgrading Arabic lettering from one font per chapter to context-aware comic lettering.

The target is a typical chapter becoming usable in roughly **30 seconds** after warm start/prefetch, not by lowering output quality but by avoiding heavy models where they are unnecessary and parallelizing/batching work that does not depend on prior pages.

## Non-negotiable language rule

For English source token `god` / `gods` (case-insensitive), Arabic output may use only:

- `حاكم` / `حكام`
- `ملك` / `ملوك`

The model must choose between ruler/king from story context. It must **never** emit `إله`، `رب`، `آلهة` or religious equivalents for that source token.

This rule is enforced twice:
1. in Luna instructions and examples;
2. by a post-response validator. If the source contains `god/gods` and the returned Arabic violates the allowed set, that region is repaired before caching.

No global replacement of unrelated Arabic words is allowed.

## Success criteria

### Speed
On S23 Ultra-class hardware, measured on-device:
- textless page: target < 1s after detector warm-up;
- flat/easy bubble local vision: target 1–2s;
- difficult art-backed region: target 3–10s local vision;
- no single full-resolution refinement may block the translation queue for > 20s;
- typical 20–30 page chapter: target ~30–45s to have all visible dialogue usable after warm-up/prefetch; if the chapter is dominated by art-backed text, quality wins and the report must show why it exceeded target.

### Correctness
- speech/thought/narration cannot silently remain English;
- SFX/credits may remain source text by policy;
- no translated region is whitened unless its Arabic fits;
- no whitening outside the permitted mask;
- hard-background whitening must preserve art better than the current 1024px LaMa path;
- residual Latin text after render is detected and repaired region-by-region.

### Lettering
- 20 Arabic font roles available locally in the APK;
- Luna may choose a whole-bubble role plus at most 3 emphasized phrases;
- emphasis can change face, weight, scale, stroke, and color;
- dramatic red/blood styling is allowed only for strong visual/semantic moments and is intentionally rare;
- original foreign letterer's visual choices are a first-class signal: source color, size, all-caps, relative weight, balloon kind, and placement guide the Arabic styling.

## Research decisions

### Upstream image-translation behavior
- `manga-image-translator` explicitly notes that insufficient inpainting resolution can leave source text visible and recommends increasing inpainting size for high-resolution images.
- Its CTD reference path uses OpenCV DNN because ORT ConvTranspose was materially slower on that graph.
- `comic-translate` and BallonsTranslator use the original page/text geometry as a guide for rendering and expose font/style controls rather than treating all translated text identically.

### Comic-lettering practice
Professional lettering references consistently use emphasis sparingly:
- bold/bold-italic for selected words;
- enlarged words for shouting/impact;
- visual hierarchy instead of changing every word.

Therefore VANTARA will not let Luna freely decorate every token. Styling is semantic and bounded.

### Android inference
ONNX Runtime Android exposes NNAPI alongside CPU/XNNPACK. NNAPI supports the key 2D Conv/Resize/quantized operators needed by many mobile vision graphs, but provider compatibility is model-specific. VANTARA will benchmark/fallback per model rather than blindly forcing NNAPI.

## Architecture

### 1. Per-region routing instead of page-level fast/heavy

Current behavior is effectively page-level: one hard element can force CTD + BubbleSeg for the whole page.

New flow:

```
RT-DETR once
  -> textless? finish immediately
  -> classify each detected text region
       easy flat bubble -> FastRegion
       ambiguous/art/free text -> HardRegion
  -> merge overlapping HardRegion ROIs
  -> run CTD/BubbleSeg only on those ROIs
  -> OCR each region
  -> Luna
  -> clean/draw each region with its own path
```

Easy and hard regions may coexist on the same page.

#### FastRegion
Requires all conservative checks:
- contained by a confident RT-DETR bubble;
- locally flat background;
- extracted ink coverage within safe limits;
- OCR confidence above the fast threshold.

It skips CTD, BubbleSeg and LaMa.

#### HardRegion
Uses a padded ROI around the text/bubble, not full-page 1024px tiles.
- text over art: CTD ROI; BubbleSeg only when a balloon boundary is actually needed;
- complex balloon: CTD + BubbleSeg ROI;
- LaMa only on the final erase mask for that region.

If ROI inference cannot produce a safe mask, preserve the original rather than erase art.

### 2. Textless fast lane

RT-DETR remains the only required model for proving a page has no text.

On >=8-core devices:
- a small detector-only session may run independently when the heavy lane is busy;
- no CTD/BubbleSeg/OCR/LaMa/Luna is entered for a proven textless page.

The performance report records detector tiles, queue time, and whether the independent lane was used.

### 3. CTD execution strategy

Do not assume one backend is fastest.

For CTD and BubbleSeg:
- keep CPU/XNNPACK as safe fallback;
- add an NNAPI-capable engine;
- run a deterministic device benchmark on representative ROIs;
- accept an accelerated engine only if its masks/boxes pass configured equivalence and safety thresholds;
- persist the selected engine for that device/model version.

The benchmark must report both speed and mask agreement. A faster provider that changes cleaning outside tolerance is rejected.

OpenCV DNN is a reference option, not automatically added to Android because bundling OpenCV materially increases the APK. It is considered only if NNAPI/ROI work is still insufficient.

### 4. LaMa quality restoration

Current Android max edge is 1024 while the Python reference uses 1536.

New policy:
- strong device (>=8 cores and sufficient runtime memory): max edge 1536;
- constrained device: 1024;
- always operate on a bounded ROI around the erase mask;
- record whether scaling occurred and the effective inference dimensions.

No full-page LaMa.

### 5. Full-resolution render cannot stall the reader

The 6116s `fullRes` sample is treated as a critical failure mode.

Rendering becomes two-stage:

1. **Reader result:** clean/draw at analysis resolution and publish immediately.
2. **Full-res refinement:** operate only on translated ROIs on the original image in background priority.

Budgets:
- per hard region and per page wall-time limits;
- if refinement exceeds budget, fall back to a scaled clean patch for that region and continue;
- refinement must never hold the foreground translation gate while another page waits.

The reader swaps in the refined image when available; failure leaves the already translated preview intact.

### 6. Residual Latin repair

After cleaning/drawing:
- inspect only translated dialogue/narration regions plus a small halo;
- detect substantial Latin remnants outside the Arabic glyph bounds;
- ignore known SFX/credits and intentional signs;
- if residue is found, enqueue a **region-only** hard repair, never redo the whole page.

Metrics:
- residualRegions
- residualPixels
- repairedResidualRegions
- residualRepairMs

### 7. Luna translation + lettering contract

Each region keeps the existing language fields and gains:

```json
{
  "lettering": {
    "role": "dialogue|clean|compact|soft|whisper|loud|command|authority|royal|narration|ancient|handwritten|serious|playful|dense|impact|ominous|mystic|energetic|tech",
    "emphasis": [
      {
        "phrase": "exact Arabic phrase",
        "style": "strong|shout|whisper|blood|cold|royal|impact"
      }
    ]
  }
}
```

Rules:
- 0–3 emphasis entries;
- each `phrase` must appear exactly once in `arabic`, otherwise that emphasis is dropped;
- Luna chooses semantics, not raw RGB values or arbitrary font filenames;
- local renderer maps roles/styles to vetted fonts, weights, colors and effects;
- source visual signals are sent in context and have priority over invented styling.

### 8. Original lettering signals

For every source region calculate lightweight local signals:
- median ink color / hue;
- light-vs-dark;
- relative glyph height;
- uppercase ratio for Latin OCR;
- approximate stroke density;
- balloon/free-text kind;
- on-art vs flat background.

These signals go to Luna as hints such as:
`source_style={red:true, oversized:true, dense:false, onArt:true}`.

If the original foreign typesetter already used red, unusual scale, or a display style, VANTARA should preserve that intent whenever Arabic readability allows it.

### 9. Arabic typography pack — 20 roles

All production faces must have redistribution-compatible licenses (prefer OFL) and be pinned by URL + SHA-256 + license in a manifest.

Initial role mapping:

| Role | Face |
|---|---|
| dialogue | Baloo Bhaijaan 2 |
| clean | Cairo |
| compact | Tajawal |
| soft | Mada |
| whisper | Lateef |
| loud | Changa |
| command | El Messiri |
| authority | Noto Kufi Arabic |
| royal | Amiri |
| narration | Noto Naskh Arabic |
| ancient | Scheherazade New |
| handwritten | Aref Ruqaa |
| serious | Markazi Text |
| playful | Lemonada |
| dense | Harmattan |
| impact | Lalezar |
| ominous | Rakkas |
| mystic | Katibeh |
| energetic | Marhey |
| tech | Readex Pro |

Baloo remains the hard fallback.

The fonts are Android-only assets. They are not exposed or shipped to the user separately.

### 10. Dramatic red/blood style

`blood` is a renderer preset, not a freeform color request:
- display face from the impact/ominous family;
- deep red fill;
- dark outline;
- optional modest scale increase;
- no gore texture generation;
- used only when original lettering or Luna context strongly indicates a decisive threat/violent beat.

A full sentence may receive `blood` when warranted; otherwise emphasis is phrase-level.

### 11. Layout with mixed styles

Current layout assumes one Paint/typeface per line.

New layout:
- wrapping still happens by Arabic words and balloon geometry;
- style runs are measured with their actual typefaces;
- line width is the sum of shaped run widths;
- baseline follows the dominant run metrics;
- emphasized run may scale within a bounded range;
- all final glyph bounds must remain inside the safe balloon mask.

If styled text no longer fits:
1. reduce emphasis scale;
2. fall back emphasized face to region face;
3. reduce overall size;
4. if still no fit, use the current single-font safe renderer.

No region is erased based on a styled layout that cannot fit.

### 12. Chapter scheduling toward 30s

Local analysis and Luna are pipelined:
- reader page always highest priority;
- prepare several upcoming pages concurrently;
- textless/easy pages do not wait for heavy regions from another page;
- Luna requests may overlap up to a conservative bounded concurrency;
- context-critical ordering remains preserved by using committed glossary/style memory and page indices.

A later batch endpoint is only introduced if measured Luna wall time remains the limiting factor after local ROI work. The first implementation does **not** sacrifice context consistency merely to hit a benchmark.

### 13. APK-only release for this feature

Cloudflare Pages production is already disabled unless `VANTARA_WEB_ENABLED=true`.

For this translation release:
- native changes force a new APK fingerprint;
- sync-worker changes deploy normally from main after CI;
- stable release supports an **APK-only manifest** with `web: null`;
- no `VANTARA-web.zip` is attached for this release;
- updater already ignores a missing/null web payload and offers the APK when native fingerprint differs.

The APK still contains the bundled web assets used internally by Capacitor; “APK-only” means no independent PWA/web-bundle update channel is published.

### 14. Caching/versioning

Bump text prompt engine version because language/lettering output contract changes.

Cache compatibility:
- old translated pages remain readable;
- old entries without lettering metadata render with default `dialogue`/existing Baloo behavior;
- new engine results are cached separately;
- repaired `god/gods` violations never enter the new cache.

### 15. Tests and verification

#### Unit
- god/gods validator: prohibited outputs fail and repair path is invoked;
- lettering schema sanitization, max 3 emphasis spans, exact-phrase validation;
- font-role fallback;
- mixed-style wrapping remains within mask;
- red/blood style only from allowed semantic preset;
- easy/hard region classifier;
- ROI merge and coordinate remapping;
- residual Latin checker ignores SFX/credits;
- LaMa strong-device edge selection;
- APK-only update manifest.

#### Android
- synthetic flat bubble stays fast and bypasses heavy models;
- a page with one easy bubble + one art-backed caption uses both paths on the same page;
- hard ROI inference never modifies pixels outside the mapped erase mask;
- full-res refinement timeout does not block a following reader page;
- typography with multiple Arabic faces renders shaped RTL text and stays inside balloon.

#### Existing suites
- all Node lint/build/typecheck/tests;
- Android debug assemble + unit tests;
- mandatory 11-page Python reference suite;
- repository safety checks.

#### Device evidence after release
The performance report must expose per page:
- number easy/hard regions;
- CTD/BubbleSeg pixels/tiles actually processed;
- selected execution provider;
- LaMa effective edge;
- preview-ready time;
- full-res refinement time separately;
- Luna/cache time;
- residual repair count;
- typography role/emphasis count.

## Merge gate

Do not merge to `main` until:
1. branch CI is fully green;
2. Android debug build/unit tests are green on the exact head SHA;
3. reference 11-page suite is green;
4. no Critical/Important code-review finding remains;
5. APK-only manifest/update behavior is covered by tests;
6. final diff is reviewed against this spec.

After merge, wait for:
- main VANTARA CI success;
- sync-worker production deploy success;
- stable signed APK success;
- GitHub release containing APK + manifest and no web zip for this feature.

Only then report the release as published.
