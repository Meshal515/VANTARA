# VANTARA Translation Lettering v2 — Design

Date: 2026-10-05  
Base: `c89a7459ff4fc79a5d1b51c8225ac7260470312d`

## Intent

Make VANTARA's manga/manhwa translation feel like real scanlation rather than one Arabic font pasted over every page, while restoring the speed/cleaning quality that regressed on difficult backgrounds.

Success means:

1. `God/god/gods` never renders as `إله`, `رب`, `آلهة`, or a religious equivalent. In VANTARA it must resolve to **حاكم/ملك** (plural **حكام/ملوك**) from story context, with a deterministic fallback to `حاكم`.
2. Arabic lettering follows the **source foreign typesetting first**: source color, outline, relative size and emphasis are visual evidence. Luna supplies semantic intent only where vision cannot decide.
3. The renderer has **20 Arabic lettering profiles/fonts**, including restrained dialogue, narration, whisper, shout, threat, royal, system, impact, and a rare red/bloody dramatic style.
4. Emphasis may affect a whole region or at most **0–3 whole words** in a region. No random “every word a different font” behavior.
5. Difficult cleaning is restored toward the reference path: no needless quality loss from over-downscaling LaMa, and heavy CTD/BubbleSeg work is limited to the hard regions.
6. The user-facing release is **APK only**. Cloudflare Pages must not be enabled. The sync-worker still needs deployment because Luna instructions/schema live there; that is backend deployment, not PWA translation.
7. Target remains **~30–45 seconds for a typical chapter** when most regions are easy, with the visible page prioritized. Hard pages may take longer but must not block unrelated pages for minutes.

## Evidence from current implementation and research

### Current VANTARA facts

- Android currently has one bundled Arabic typeface: `Baloo Bhaijaan 2`.
- `ArabicLayout` draws a single typeface, black/white only, with a white/black stroke over art.
- Luna's text schema currently returns language fields only; it does not return lettering/style metadata.
- Translation memory says “Glossary (use exactly)”, so an old bad term mapping can override later prompt quality unless filtered.
- Android LaMa caps a crop at **1024px**, while the Python reference path uses **1536px**.
- CTD and BubbleSeg dominate difficult-page latency. The reference Python CTD path explicitly documents OpenCV DNN as much faster than ONNX Runtime for that graph.
- Current Android ONNX Runtime uses CPU/XNNPACK. NNAPI is not enabled by default.
- The latest report showed `fast 0 / heavy 14`, so the page-level fast/heavy decision is too coarse.

### External practice worth copying

- BallonsTranslator automatically estimates font/size/color from the original lettering and supports rich-text presets/effects.
- manga-image-translator carries text color/stroke concepts in its renderer and has community work specifically preserving source color.
- Human comic lettering guidance keeps normal dialogue consistent and changes style/size when there is a reason (shouting, whispering, impact), not randomly.
- ONNX Runtime Android exposes NNAPI and XNNPACK execution providers; unsupported NNAPI operators may fall back to CPU unless fallback is deliberately disabled during a diagnostic benchmark.

Research sources:
- https://github.com/dmMaze/BallonsTranslator
- https://github.com/zyddnys/manga-image-translator
- https://github.com/dmMaze/comic-text-detector
- https://onnxruntime.ai/docs/api/java/ai/onnxruntime/OrtSession.SessionOptions.html
- https://blambot.com/pages/comic-book-grammar-tradition

## Chosen architecture

Three approaches were considered:

1. **Luna chooses everything** (font/color/size). Rejected as primary path: visually inconsistent and ignores expert foreign lettering already present in the image.
2. **Pure visual copying** from source. Excellent consistency, but cannot express Arabic-specific semantic emphasis when the source is visually neutral.
3. **Hybrid source-first lettering** — chosen. Local vision extracts source style; Luna emits restrained semantic intent; deterministic Android rules combine them.

Priority rule:

```
source visual evidence > deterministic VANTARA rules > Luna semantic suggestion
```

Luna is never allowed to freely invent arbitrary RGB colors or arbitrary font names.

## 1. God invariant

### Prompt rule

Add a hard instruction to the text prompt:

- English `God/god` in this product is always translated as **حاكم** or **ملك** according to context.
- English `gods` is **حكام** or **ملوك**.
- Never output `إله`, `رب`, `آلهة`, `أرباب`, or a religious equivalent for those source tokens.
- This rule overrides glossary/history/style memory.

### Memory sanitation

Before building `contextText`, filter/normalize glossary entries whose source term is `god/gods` (case-insensitive) so stale mappings such as `God → إله` cannot be injected as “use exactly”.

### Output validator

After Luna returns:

1. If source contains `god/gods` and Arabic contains a forbidden religious equivalent, mark only that region invalid.
2. Retry that region once with a specific correction note.
3. If it still violates the rule, apply deterministic fallback:
   - singular → `حاكم`
   - plural → `حكام`
   while preserving the rest of the sentence as safely as possible.
4. Tests must prove the invariant across first-pass, retry, glossary pollution, and cached repair paths.

This is a product-specific lexical rule, not a general Arabic translation claim.

## 2. Lettering schema from Luna

Bump `TEXT_PROMPT_VERSION`.

Each translated region gains an optional `lettering` object:

```ts
{
  preset:
    | "dialogue"
    | "dialogue_soft"
    | "dialogue_bold"
    | "whisper"
    | "shout"
    | "rage"
    | "fear"
    | "ominous"
    | "bloody"
    | "royal"
    | "formal"
    | "narration"
    | "memory"
    | "system"
    | "tech"
    | "comic"
    | "child"
    | "mystic"
    | "impact"
    | "cold";
  intensity: 0 | 1 | 2 | 3;
  emphasis: Array<{
    text: string;        // exact whole word(s) occurring in arabic
    preset: string;      // one of a restricted emphasis subset
  }>;                    // max 3 entries
}
```

Rules for Luna:

- Read the image and **follow the foreign lettering**: oversized, colored, outlined, whispered, boxed, threatening, etc.
- Normal dialogue stays normal even if the scene is dramatic.
- `bloody`/red is rare. Use it only for a genuinely brutal/ominous beat or where the source lettering itself signals it.
- At most 3 emphasis spans; whole words only.
- No font filenames and no RGB values in the model output.

## 3. Source lettering probe on Android

Add a native `SourceLetteringStyle` derived from the original glyph mask before erasing:

- foreground median RGB from glyph-core pixels
- nearby outline/stroke RGB from a ring around glyphs
- color confidence / chroma
- approximate stroke thickness/density
- relative source glyph height vs region
- whether source lettering is substantially larger/bolder than surrounding text

The probe is deterministic and cheap.

### Color policy

1. If source text has a reliable non-neutral color, preserve it.
2. If source has a reliable outline, preserve/approximate it.
3. If source is neutral black/white:
   - use normal VANTARA palette by default
   - semantic presets may request a controlled accent
4. Red/bloody accent is allowed only for the `bloody` preset (or source-red evidence), and is capped to avoid overuse.

The renderer therefore learns from human foreign scanlators without copying their words.

## 4. Twenty Arabic font profiles

All fonts must have a compatible open license (prefer Google Fonts/OFL). Exact files and SHA-256 are pinned during implementation.

Proposed profile map:

1. Baloo Bhaijaan 2 — default comic dialogue
2. Cairo — clean dialogue
3. Tajawal — soft dialogue
4. Changa — shout/impact
5. El Messiri — dramatic
6. Lemonada — playful/comic
7. Reem Kufi — royal/formal
8. Noto Kufi Arabic — system/tech
9. Noto Sans Arabic — neutral/system
10. Noto Naskh Arabic — narration
11. Amiri — formal/classical
12. Aref Ruqaa — handwritten/elegant
13. Markazi Text — serious narration
14. Mada — dense/narrow
15. Harmattan — whisper/light
16. Lateef — fragile/old
17. Scheherazade New — lore/ancient
18. Mirza — mystic
19. Rakkas — impact/bloody display
20. Almarai — modern/cold

### Packaging

Do not commit unverified binary fonts by hand.

Add a deterministic build step that downloads the exact pinned open-source font files from their canonical repositories, verifies SHA-256, and places them into the Android asset bundle before `cap sync/assemble`.

The APK contains the resulting pack; there is no runtime font-network dependency.

Cloudflare Pages does not need these fonts because manga translation is native-only.

## 5. Renderer changes

### Region-level style

`ArabicLayout` receives a `LetteringStyle` containing:

- Typeface profile
- fill color
- stroke color
- stroke width multiplier
- size multiplier
- optional letter/line-spacing modifiers within safe bounds

### Word emphasis

Emphasis is restricted to whole words separated by spaces, preventing Arabic joining from being split inside a word.

Layout becomes style-aware:

- measure each word with its effective typeface/size
- wrap using the sum of styled word widths
- draw right-to-left runs while preserving the line center
- fallback to the region base style if a requested emphasis cannot fit

No styling may cause text to leave the safe bubble mask.

### Dramatic red/bloody style

The `bloody` preset may use:

- Rakkas/Changa-class display face
- dark blood-red fill
- darker edge/stroke
- slightly larger size

It remains subject to fit/visibility checks. If it does not fit or contrast is poor, degrade to a safe impact style rather than forcing it.

## 6. Speed and difficult-background recovery

This work must not add typography at the cost of translation speed.

### Per-region fast/heavy decision

Replace the current all-or-nothing page gate:

- easy flat regions use the local fast mask/fill path
- only ambiguous/free-text/illustrated regions request CTD/BubbleSeg/LaMa assistance
- the same page can contain both fast and heavy regions

This is expected to turn the last report's `fast 0 / heavy 14` into a mixed distribution.

### CTD execution benchmark

Do not blindly enable NNAPI in production.

Add a device benchmark for CTD and BubbleSeg:

- current XNNPACK
- NNAPI where supported
- compare output masks/bubbles to the current reference
- record latency and output difference
- choose accelerated execution only if accuracy stays inside a strict threshold

During diagnostic benchmarking, CPU fallback can be disabled to reveal whether NNAPI really owns the graph; production keeps a safe fallback.

### LaMa

On capable devices such as S23 Ultra:

- raise difficult-crop max edge from 1024 toward the reference 1536, adaptively
- retain 1024 or lower under thermal/memory pressure
- compare cleaning pixels/quality on the existing real-page corpus

### Full-resolution watchdog

A single full-res render previously consumed >6000 seconds and blocked following pages.

Requirements:

- full-res refinement cannot monopolize the reader's heavy gate indefinitely
- record per-region full-res cost
- impose a bounded timeout/fallback
- show analysis-resolution translated output first when full-res refinement is unexpectedly slow
- continue later pages instead of queueing behind one pathological page

## 7. Residual-English verification

After cleaning + Arabic rendering:

- inspect only known source text boxes/nearby detector regions
- if a region still contains strong Latin glyph evidence and no Arabic replacement, mark it for targeted repair
- rerun the smallest required region, never the full page by default
- keep the original if repair cannot be proven safe

This addresses pages where one English block stayed untouched while neighboring text translated.

## 8. Caching and compatibility

- Prompt/schema version bump makes older translations stale but displayable.
- Existing translated image remains visible while v3 lettering refreshes in the background.
- New cache records persist the Luna lettering metadata used to render the image.
- Old cache entries without lettering render with the default Baloo profile until refreshed.
- The God validator applies to new/repair results regardless of cache path.

## 9. Tests and verification gate

### Unit tests

Worker:
- God glossary poisoning is ignored
- God first-pass violation retries
- persistent violation falls back safely
- schema rejects invalid presets/colors/arbitrary fonts
- max 3 emphasis spans
- exact emphasis words must occur in Arabic text
- old translation cache remains readable

Android:
- source fill/stroke color extraction
- source-red preservation
- neutral source does not become red without `bloody`
- dramatic red remains inside safe region
- 20 typefaces load successfully in release assets
- mixed-font whole-word layout never leaves bubble mask
- styled text visibility rollback still works
- mixed fast/heavy page sends only hard regions through heavy models
- LaMa adaptive edge and thermal fallback
- full-res watchdog releases the queue

### Real-page regression

Use the existing mandatory real-page corpus plus the troublesome purple-background page class.

Compare:
- source pixels outside allowed erase/draw area: exact
- no-op cleaner: zero unless explicitly expected
- residual Latin count
- translated region count
- per-page latency
- CTD/BubbleSeg tiles
- full-res time
- typography output metadata

### Device acceptance

On S23 Ultra after wiping performance log:

- page with no text: target <1s after warm-up
- easy bubble regions: local target ~1–3s
- hard region: must not make unrelated easy regions wait for whole-page heavy processing
- typical chapter target ~30–45s when mostly easy
- no page may block the reader queue for minutes
- God invariant: 0 violations
- visual inspection of at least:
  - normal dialogue
  - shout
  - whisper
  - narration
  - colored source text
  - red/bloody dramatic line
  - difficult art-background text

## 10. Release plan

1. Feature branch only.
2. Red/green tests per behavior.
3. Full repository CI + Android debug build.
4. Code review before merge.
5. Merge only with all Critical/Important findings resolved.
6. `main` CI must pass.
7. User-facing release: Android stable APK.
8. Do **not** enable Cloudflare Pages.
9. Sync-worker deployment is required for the new Luna prompt/schema and is allowed; it does not create PWA manga translation.
10. Verify signed APK release target SHA and update manifest before reporting completion.

## Non-goals

- Do not let Luna emit arbitrary font files/colors.
- Do not restyle SFX/credits that are intentionally left in the art.
- Do not translate PWA manga pages.
- Do not replace every region with dramatic typography.
- Do not sacrifice safe cleaning just to hit the 30-second chapter target.
