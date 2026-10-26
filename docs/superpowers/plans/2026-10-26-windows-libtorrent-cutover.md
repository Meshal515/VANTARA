# VANTARA Windows libtorrent cutover — implementation contract

Date: 2026-10-26. Parent: fix/windows-update-release-parity-20261026.
Status: StageArt parity implemented. Native libtorrent migration NOT implemented or benchmarked.

## Audit

Android TorrentEngine.kt uses jlibtorrent (libtorrent-rasterbar), with Media3 demand-driven DataSource. Windows services.mjs launches rqbit and pipes HTTP ranges to mpv. Sharing Stremio adapters does NOT replace the torrent backend. Media3 is Android-specific; retaining mpv on Windows is viable.

## Native backend cutover requirements

1. Build a versioned Windows x64 worker around libtorrent-rasterbar. Pin its dependency versions, package a reproducible executable and validate licenses and hashes in Windows CI.
2. Implement a narrow native session IPC with torrent identity, BTIH, fileIdx (including zero), metadata, byte-range reads, seeking, priorities, statistics, cancellation and clean shutdown. Renderer never has direct worker access.
3. Apply bounded piece deadlines and lookahead as in Android. Persist DHT state safely; reuse metadata and warm verified pieces. Never treat partially received pieces as complete.
4. Keep normalizeTorrentFields and addon source discovery shared. Preserve external URL validation, SSRF guards, tracker policies, selected file and subtitles. Assert add-on counts and configuration survive restart.
5. Isolate disposable torrent caches from user and account records. Do not delete user-owned files or move account settings without an explicitly tested migration.

## Required performance evidence

With same known hash, fileIdx, network, codec, device and cold/warm metadata state, compare Android, current rqbit Windows and candidate libtorrent Windows. Record source request, available stream, metadata, first peer, first verified piece, first HTTP payload, first decoded video frame, 10-second stable playback; include seek and subtitle checks. Repeat at least five times and report median and P95 for 1080p and 4K.

User-observed Android first-frame baseline is around 6 seconds. No Windows 6-10 second guarantee without real device tests.

## Update/release gating

Maintain Codex anti-rollback, unified Stable version logic and installer validation. Run the engine in a preview installer first. Verify clean install, upgrade, reboot, account/session preservation, extension count, speed and two full restart/update cycles before replacing rqbit in Stable.

## Implemented sibling changes

StageArt images (banner/backdrop and logo, fallback title) now render on the transparent Electron overlay above native mpv, with first-frame and buffering lifecycle. Native mpv is preserved. Preview updates remain on a separate branch and never change main automatically.

DO NOT claim native libtorrent migration from a UI-only commit.