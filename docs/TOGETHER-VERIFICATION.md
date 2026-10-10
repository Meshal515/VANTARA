# Together repair verification

Run regressions with `node node_modules/vitest/vitest.mjs run apps/web services/sync-worker/src/together* services/web-fetcher` after building `packages/domain`.

The browser harness in `tools/pwa/together-browser-test.mjs` uses the production room client, player, reader bridge and RoomCore over local WebSockets. Authentication in that harness uses test identities; the invite authorization integration suites exercise the authenticated API separately. A mobile browser viewport is not an Android APK.

The real browser assertions cover three overlapping profile images plus `+4` for four additional members, removal of overflow when members leave, and keeping the third avatar visible beside reader translation. Connection details remain accessible through the room panel and the strip's label. A hit-target assertion verifies that the room sheet is above the waiting lobby; mobile title width is checked so the strip cannot collapse the title.

The browser test also waits for welcome before mounting a late joiner's player, after the host has advanced several episodes. It deliberately completes an older episode preparation after a newer one, and releases an old server-healing request after a new episode loads. These scenarios failed before repair; the player now reconciles the cached timeline, cancels old attempts, rejects stale results and closes superseded prepared sessions.

Install test-only `playwright` and `ws` in a separate directory, or set `BROWSER_MODULE_ROOT` and `WS_MODULE_ROOT` to their installation roots. Run `node tools/pwa/together-browser-test.mjs`. `TEST_OUTPUT` selects the evidence directory; `BROWSER_CHANNEL=chrome` selects installed Chrome.

For real Android playback, apply the companion native timing repair, run `node tools/pwa/prepare-together-device.mjs`, then `android/gradlew.bat -p work/together-native-proof :app:assembleDebug` with Java 17 and an Android SDK containing platform 36. Install `work/together-native-proof/app/build/outputs/apk/debug/app-debug.apk` using adb. Set `ADB` to adb's executable and run the browser harness with `--android` on a running emulator. The separate package `com.vantara.proof` runs the current production `TogetherPlayer`, `TogetherClient`, `TogetherSync`, UI helpers and real ExoPlayer; it does not replace the user's VANTARA APK or its signing key.

Device samples are taken every 150ms. The harness extrapolates from the sample's receipt time on the computer, since emulator wall clocks can differ; playback measurements retain uncertainty of a local HTTP transit. It checks both host directions, pause/seek, native reconnect, next episode, waiting before start and absence of orphan connections.

This fixture does not exercise the complete APK's invitation handoff, PlayerActivity, remote source preparation, screen lock or physical-device playback. Full APK building on the test host required an unavailable NDK and more free disk space. Do not present the fixture as a full app installation test.

## Optional private browser source backend

`tools/pwa/browser-fetch-service.mjs` is an opt-in backend for **WitAnime only**, disabled unless `BROWSER_FETCH_URL` and `BROWSER_FETCH_SECRET` are configured on web-fetcher. Nothing in this change deploys or configures it.

Install Playwright and Chromium in the backend host environment. Set a private `BROWSER_FETCH_SECRET` of at least 32 characters in both services. Start the script with Node 22+; it listens on loopback port 8789. A private HTTPS gateway must expose `/fetch` to the Worker. `BROWSER_MODULE_ROOT` can point to a separate Playwright installation; `BROWSER_CHANNEL=chrome` selects installed Chrome for local testing. Never put the backend secret in the web app.

The Worker verifies the user's identity and source allowlist before fallback. Only actual Cloudflare challenge responses trigger it. It hashes each user to a separate bounded cookie session, forwards the source's POST/CSRF semantics, and retains the original challenge error if rendering fails. The backend rejects arbitrary hosts, ads, iframes, redirects and unauthenticated requests. Sessions expire after five idle minutes and concurrency is bounded. Interactive challenges are not automatically solved.

Local browser success proves extraction from this machine, not that a future server IP will be accepted by the source. Validate the configured backend from its hosting network before any production deployment.

Observed on 2026-10-10: default desktop Chrome got WitAnime's own 403 on search. Using the same mobile user agent as web-fetcher, the backend rendered 25 home works, Black Clover search results and 170 episodes. Its source POST still returned 404, including when sent through Chromium's network stack. This fallback is experimental and **does not establish a functioning WitAnime playback path**. Keep it disabled. Run the browser harness with `--sources` to test search/episodes/servers; a denied stage fails explicitly.

The direct live source matrix reached media bytes for RistoAnime (Frieren, 28 episodes, 7 servers), TukTuk (The Gentlemen season 2, 8 episodes, HLS) and EgyDead (Dune Part 2, 4 servers, HLS). Shahiid, ArabSeed, Akwam and OkAnime failed before parsing due to DNS/request failure from the test host. A Worker health response alone is not a playback test, and local success is not proof of production Worker success.
