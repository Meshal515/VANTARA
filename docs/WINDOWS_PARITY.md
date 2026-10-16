# Windows and the canonical VANTARA application

Windows 0.2.9 bundled current catalog pages but maintained a separate, plain room panel and player form on a branch that was not merged into main. Updating catalog files therefore did not deliver the native Android room/player experience to Windows. Its preload version was also a handwritten constant.

The Windows runtime now belongs to main, with the platform gate selecting its bridge before the canonical application starts. Android continues to use its native plugins; the browser keeps its existing bridges. Catalogs, source selection, account UI and reader code come from main without the unrelated feed and manga changes that existed on the old Windows branch.

## Room and playback flow

- Accepting a Windows viewing invitation presents the room before opening the source picker. Choosing a source opens the existing episode/source flow; it does not disconnect or create a second room socket.
- `apps/web/lib/together/lobby.js` is the single cinematic room renderer used by Windows and the web player. It shows artwork, identity-backed avatars, pending invitees, readiness, source selection, local timing and the shared countdown.
- MPV prepares the selected stream paused when a room has not started. An invite sent while already watching keeps the current player running. A late joiner aligns to the room clock.
- `apps/web/desktop/together-player.js` retains the existing millisecond room protocol. Source changes preserve the local video offset; a source failure retains the room and the available source choices.
- The Windows player uses VANTARA colors/icons and a compact playback bar. Audio, subtitles and timing live in its settings; video timing appears above subtitle timing. Source selection reuses `v35/server-sheet.js`, including live route updates.
- Episode navigation uses existing source preparation and room `load` commands. The player exposes the episode list/next episode, standalone speed, fit/fill, subtitle size/position, and the shared APK-compatible AniSkip parser for duration-matched opening/ending skips. Synchronized rooms retain clock-controlled speed.
- Windows child HWND video cannot be covered reliably by Chromium HTML. The player explicitly hides its native viewport while the room, source picker or settings are visible, and restores it after playback starts or those panels close. Playback controls reserve their own area beside the native video.

## Release path

`.github/workflows/windows-stable.yml` runs after a successful **Android stable APK** release. It resolves the published stable tag, verifies that commit belongs to main, and builds Windows from that exact commit. Windows version `0.3.N` corresponds to APK `0.0.N`; the Windows update channel remains independent from APK installers.

Publication requires desktop/source tests, compilation of the native video host, installer creation and actual Windows runtime verification. The tests install/reinstall/uninstall with a retained user-data sentinel, verify branding and shortcuts, play an authored clip using the real embedded MPV, select Arabic subtitles, exercise playback/fullscreen/resize, and check the cinematic room, server picker, countdown and local timing against native-window visibility. A branch push builds a candidate but cannot publish it.

The preload receives the installed package version from the main process rather than a source constant. The update manifest is advertised only after the verified installer exists; recovery of an older stable release cannot replace a newer advertised Windows version.

## Reproduction and evidence

`tools/together/windows-player-browser.cjs` uses authored artwork and simulated native IPC to exercise the production room renderer/coordinator in Chromium. Set `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` if those dependencies are not available locally. It checks room entry before video preparation, avatars, timing, the shared source picker, countdown, settings and viewport visibility. The real Windows/MPV counterpart is `apps/desktop/video-smoke.cjs`; its report and room screenshot are uploaded by the release workflow.

These fixtures do not establish playback on the owner's PC or a live session with their friend. External source throughput and torrent availability remain source-dependent.
