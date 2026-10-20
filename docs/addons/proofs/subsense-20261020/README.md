# SubSense actual-title investigation, 2026-10-20

Baseline: main `b5291f505cd7b77e2dbcc34b4077ccf12c92ea14` (APK 0.0.188).
Public provider: `com.subsense.nepiraw`, `https://subsense.nepiraw.com/manifest.json`.
Public title identity: `tt22084616` (Spider-Man: Brand New Day), Arabic language query.

The provider returned 19 subtitle entries. All downloaded with HTTP 200, no redirects and CORS `*`: 17 SRT, one VTT and one direct SSA URL containing an ASS V4+ body. No archive response was observed.

Entry index 6 (`subsense-ssa-opensubtitles-ara-6`) is 379,513 bytes of valid UTF-8. The unchanged production web converter rejects it as unsupported ASS; the compiled unchanged Android `SubtitleText.parse` returns zero cues. Its Events section contains 3,616 Dialogue records: 1,809 text records and 1,807 vector drawing records. A parser must omit vector drawing paths, retain text following drawing-mode reset, respect the Events Format field order, preserve commas in Text, and convert ASS centiseconds and line-break escapes.

The other 18 files parse into approximately 1,594–1,853 cues with existing Android/PWA code. This establishes a deterministic format failure for a subtitle returned for the user's reported title. It does not establish which entry the user selected and is not physical-device playback proof.

Only sanitized response metadata and parser counts are tracked. Download URLs, raw subtitle files, response headers and configured URLs remain outside the repository.

Regression checkpoint `43287f12` adds manually authored ASS/SSA examples, with no downloaded dialogue. Focused command `node node_modules/vitest/vitest.mjs run apps/web/addons/subtitles.test.js` fails as expected on the unchanged implementation: 4 failed, 9 passed. Existing native `SubtitleTextTest` baseline: 5 passed. No production parser change is present at this checkpoint.

Android implementation location: `android/app/src/main/kotlin/com/vantara/anime/player/SubtitleText.kt`; selected addon download/parse/render bridge: `PlayerActivity.kt`, `selectAddonSubtitle`, around line 319. PWA converter: `apps/web/addons/subtitles.js`, `toWebVtt`, around line 138. PWA explicit selection: `apps/web/pwa/player/subtitles.js`, `select`, around line 174.

An independent Windows flow finding on published branch `d53d5e95`: `apps/web/desktop/engine.js:193` downloads every discovered provider result; `apps/desktop/src/services.mjs:921` retains rejected download promises and `:923` serializes all requests and caps loaded tracks at eight; `apps/web/desktop/player.js:203` only exposes loaded native tracks. The root worker owns the separate Windows repair and final cross-platform verification.
