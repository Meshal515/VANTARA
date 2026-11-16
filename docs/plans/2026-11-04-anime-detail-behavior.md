# Anime detail behavior repair

Scope: current Debug-derived isolated branch. Preserve core and four alternate visual compositions, banner shadows, depth animations, storage shape, playback engines and Stable. No deployment in this task.

Confirmed causes: eased logo entry differs from linear repeat; desktop masking uses a guessed boundary; alternatives lack shared episode actions; filtering occurs after paging and title searches bypass bounds; manual seen marks overwrite playback pointer; hero requests wait for artwork/1200ms; hidden core image trees still load behind alternative layouts.

Implementation: constant 12px/s logo controller with measured transparent masking; pure available-episode/resume/page model and persistent per-view controls; keyed DOM updates retaining image and logo nodes; parallel prioritized hero fallbacks and bounded visible episode images. Real seasons remain relations, never page ranges. Preserve actual playback on manual marks.

Verification: pure model edge cases, real createAnime functional parity and cancellation, existing artwork race tests, all relevant web regression tests, Chromium mobile/desktop actual animation measurements and screenshots, controlled network image timings before/after. Browser measurements do not establish Android/Windows native behavior. Missing-logo user titles require reproducing evidence; do not bypass transparency or network validation speculatively.

Latest steering: visually inspect the core still-play button in actual Chromium. Remove its redundant 2px CSS shift while retaining the shared glyph optical correction. Compare cropped screenshots and rendered preview bounds across 360/390/430/1440px, RTL/LTR and white/gold/red accents. Keep the inspection browser running until verification finishes.
