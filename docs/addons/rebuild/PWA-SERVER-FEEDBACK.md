# PWA server feedback follow-up — 0.2.2

The user reported Toy Story 5 in the PWA: three ArabSeed MSD quality options became ready, while 22 other routes were unavailable. These are routes/quality options, not independent providers. No claim is made that this patch repairs third-party 403 responses.

## Confirmed defects and changes

- Provider metadata existed in the addon source definition but was lost when preparing routes. The Cinema picker then displayed its internal routing key, including the endpoint. Routes now retain `sourceName`; the picker uses the friendly name and a safe generic fallback for old addon routes.
- Grid children had intrinsic minimum widths, so even a friendly long name overflowed. Only the server tile/top/tag rules gain minimum-width and ellipsis constraints.
- The source facade filtered out every unsupported/expired stream, turning a nonempty response into a false empty result. It now preserves the rejection reason when no usable sibling exists. Mixed responses continue returning usable streams; genuinely empty responses remain empty. Torrent and external-site results have specific explanations.
- Ordinary Cinema feedback translates known empty-result/HTTP-403 diagnostics into Arabic. Raw route diagnostics remain available. Playback verification, ranking, user choice, native Kotlin/Media3 and THE ROCK are unchanged.
- PWA update notes and shell digest/version are updated.

## Verification

- RED: new regressions failed on the previous implementation (missing route metadata, lost unsupported reason and missing presentation helpers).
- Vitest: **182 files / 1632 tests passed**. Repository safety: **54 passed**. After the final CSS correction, the real browser checks and shell safety checks were repeated.
- Actual Chromium, actual PWA shell/runtime/adapter/Cinema picker, isolated protocol fixtures: direct HLS, torrent-only, header-required and HTTP 403 providers. At 390×844 and 1366×768 every tag is inside its own tile; no internal addon key is displayed. Video element count is zero before selection. Clicking rejected routes gives the correct reason; the direct stream remains Ready.
- [Before mobile](screenshots/before-server-feedback-390.png) / [after mobile](screenshots/after-server-feedback-390.png)
- [Before desktop](screenshots/before-server-feedback-1366.png) / [after desktop](screenshots/after-server-feedback-1366.png)
- [Torrent feedback](screenshots/after-server-feedback-torrent.png), [required headers](screenshots/after-server-feedback-header.png), [addon 403](screenshots/after-server-feedback-blocked.png)

## External service evidence and limits

Cinemeta catalog search confirmed Toy Story 5 ID `tt29355505`. Public unconfigured URLs were tested separately from playback fixtures. From the production PWA origin in real Chromium, Torrentio manifest failed at transport; Comet's manifest succeeded but its movie stream request failed. Independent HTTP requests returned 403 for Torrentio manifest/stream and Comet stream, without a readable CORS response. Browser errors alone do not establish an HTTP status or distinguish network/CORS/protection. User-configured URLs were not provided and were not guessed.

**UNVERIFIED:** the user's exact phone/browser/network and configured addon URLs; third-party Toy Story 5 stream-to-playing-video E2E; physical APK behavior. No remote block bypass, arbitrary proxy, new torrent engine or false Ready state is introduced.
