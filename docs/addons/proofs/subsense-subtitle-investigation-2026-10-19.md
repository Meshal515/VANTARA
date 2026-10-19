# Subtitle download investigation — 2026-10-19

Provider identified: **SubSense**, manifest ID `com.subsense.nepiraw`, version `2.4.1`.
Public source: https://github.com/NepiRaw/Stremio-SubSense
Public manifest: https://subsense.nepiraw.com/manifest.json

## Confirmed application defects and repairs

- Android reused one download request ID for every tap on the same track. `RemoteAddonClient` rejects a second concurrent request with the same ID. Each selection now uses its existing selection counter; a stale selection can no longer display a failure for the current choice.
- The browser/Windows session downloaded the same file twice and appended duplicate track nodes when tapped twice before the first request completed. It now shares that pending download and only the latest selection can attach it. Regression test failed with two downloads, then passed with one.
- Legacy Arabic downloads without a declared charset were decoded as UTF-8 unconditionally. Arabic selections now try strict UTF-8 and use Windows-1256 only when UTF-8 is invalid. Explicit Content-Type charset and UTF-8/UTF-16 BOMs take precedence. Synthetic byte fixtures cover these cases on web and Android.

## Live public observations

Ordinary unauthenticated `curl` requests were used; no user keys or configured private URLs were needed. Python urllib initially received HTTP 403, while curl subsequently received HTTP 200 from both providers. The initial urllib failures are not evidence that the provider itself was down.

- SubSense Arabic configuration for `tt0111161` returned 119 Arabic tracks: 61 direct `dl.opensubtitles.org` downloads and 58 SubSense/YIFY proxy downloads.
- Three direct SRT downloads returned HTTP 200, without redirects or archive payloads. Sizes were 94,238 / 141,595 / 94,239 bytes.
- Two of those SRT downloads were Windows-1256. UTF-8 decoding introduced 30,442 / 30,418 replacement characters. With the fix, both contain zero replacement characters and over 30,000 Arabic characters. The third, UTF-8 SRT also retains zero replacement characters.
- WebVTT conversion of those files produced 1,401 / 1,340 / 1,401 cues.
- One YIFY proxy download returned HTTP 200 with a plain SRT body (156,259 bytes). Provider-side extraction already works for this sample.
- OpenSubtitles v3 for public short `tt1254207` returned two tracks. Its tested download was UTF-8, 134 bytes, and still converts to two cues.
- Three of the 119 SubSense tracks end in `.sub`. One tested file returned MicroDVD frame-based text (`{startFrame}{endFrame}`), without a frame-rate declaration. The current SRT/WebVTT parsers cannot parse that format and return no cues. Converting it correctly requires the matching subtitle/video frame rate; no frame rate was guessed.

## Verification and limits

`node /workspace/VANTARA/node_modules/vitest/vitest.mjs run apps/web/addons/transport.test.js apps/web/pwa/player/subtitles.test.js apps/web/addons/subtitles.test.js`: **23 tests passed**.

Android synthetic HTTP-body fixtures were added to `RemoteAddonTest`; the integrating branch owns the final Android compilation and combined suite. A duplicate local Gradle run was cancelled to avoid contention with that verification.

These are download/parser and application race observations, not handset playback proof. No full subtitle text, download tokens, or user configuration is committed here. The user's exact installed configuration and failing title/track were not supplied, so this report does not claim that every reported first-tap or SubSense failure is resolved. MicroDVD tracks remain unsupported.
