# Native Together repair

This branch changes only production Android Together code and this note. The web/reader/source repair and emulator fixture are in the companion `fix/together-web-reader-sources` branch.

The real emulator test initially failed its 500ms drift bound: 764ms was measured at startup, settling only after correction. A source can become ready before the WebSocket welcome; the old welcome handler reported ready without stopping local playback behind the lobby. Explicit room jumps also added the controller's default 800ms load prediction and applied scheduled commands on receipt. The server close handshake lacked `onClosing`, so a graceful restart did not reach reconnect within the 20-second test.

The repair reconciles readiness at welcome, preserves the ready state in the unstarted lobby, applies commands at their shared scheduled instant, uses the current room position for explicit jumps and acknowledges server closure. It retains the existing drift controller for subsequent correction.

Validation: Java 17 built an isolated fixture with the current production `TogetherPlayer`, `TogetherClient`, `TogetherSync` and UI helpers, plus real Media3 ExoPlayer. A headless Android emulator and actual desktop Chrome connected to production RoomCore through a local WebSocket broker, each playing its own authored MP4. Tests passed for both host directions, ready-before-start, play/pause/seek, native reconnect, next episode and zero remaining room connections on exit.

Across successful runs, desktop-host/Android-guest samples peaked at 14-249ms. The final Android-host/desktop-guest sample was 127ms, next episode 30ms; paused seek/reconnect positions agreed at the recorded samples. Measurements extrapolate native samples from computer receipt time and retain local HTTP transit uncertainty. These are fixture measurements, not performance guarantees for remote streaming hosts.

The complete VANTARA APK, its PlayerActivity/invitation handoff, source preparation, locked screen, physical phones and deployed services were not exercised by this fixture. Full APK building required a missing NDK and more disk space. No signing settings, secrets or production deployment were changed.

Reproduce using `tools/pwa/prepare-together-device.mjs` and `tools/pwa/together-browser-test.mjs --android` from the companion web branch, with these native changes applied; setup instructions are in `docs/TOGETHER-VERIFICATION.md` there.
