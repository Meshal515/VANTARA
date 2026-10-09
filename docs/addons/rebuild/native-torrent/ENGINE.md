# Native torrent engine — 2026-10-09

## Choice and provenance

- [FrostWire jlibtorrent](https://github.com/frostwire/frostwire-jlibtorrent), pinned `2.0.12.9`: MIT Java/JNI wrapper, official release May 14, 2026 (latest release checked October 9).
- Underlying [libtorrent](https://github.com/arvidn/libtorrent) is BSD-3-Clause; upstream distribution also includes separately licensed components. Full upstream notice ships in APK assets, alongside the wrapper MIT notice.
- Official Maven repository is restricted to `com.frostwire`. Production ABI stays arm64; x86_64 artifact is supplied for emulator verification. Existing ABI filters prevent it entering production APK.
- Alternatives inspected: libtorrent4j (permissive wrapper, older Android release), archived TorrentStream-Android (2022, limited seeking abstraction), rqbit (Rust streaming, separate Android bridge/toolchain), Animeko anitorrent (GPL-3.0 and unstable high-level API). No GPL client code copied.
- Both downloaded arm64 libraries were previously checked for 16KB ELF LOAD alignment; the new independently written byte-copy JNI shim explicitly links with 16KB alignment. The built arm64 debug APK passed ELF `LOAD` alignment checks (`0x4000`) for both jlibtorrent and the new shim, and `zipalign -c -P 16 -v 4` passed on the whole APK. These static packaging checks do not substitute for a 16KB-device run.

## API and behavior

`TorrentEngine.get(context).register(TorrentRequest(hash, fileIdx, sources, magnet))` produces an opaque `vantara-torrent://<ticket>/file` URI. Registration does **not** start network activity or autoplay. Media3's IO loader resolves metadata only when a user selects playback through `dataSourceFactory(delegate)`.

The native engine preserves the addon's torrent identity and exact `fileIdx`. Without an index, it chooses the largest playable video; a bad explicit index is an error, never a silent switch to a different episode. v1 hash matching, tracker public-host checks, a native private-network IP filter, bounded metadata and file path/symlink checks guard the bridge. No configured addon URL or credential is logged.

Media3 remains the player. A progressive DataSource maps file byte ranges to torrent pieces. Only the forward piece window has priority, and seek replaces its deadlines. Pieces enter the Java reader through libtorrent `read_piece_alert`, copied synchronously while the native buffer is valid, after piece hash verification. No sparse-file read race, reflection, `Unsafe`, JS loader or localhost production proxy is involved. Direct HTTP/HLS/DASH retains its existing delegate.

Memory is capped at 32MiB of verified pieces per active torrent (at most two active torrents); it clears immediately when the last reader closes. Resident native handles are capped at six; selected read-ahead is 12 pieces. Pending tickets are capped at 512. Idle torrents pause, disappear from the native session after one minute, and inactive disk cache prunes to 1GiB. Active physical data is limited to 8GiB per torrent and streaming refuses new windows below 256MiB free space. Sparse-file accounting uses allocated blocks. A very large high-bitrate stream can therefore hit the cache limit and must surface a storage error rather than fill the device.

Close cancels waiting reads; metadata/piece stalls have finite timeouts so existing native playback failure handling can move to a different candidate. Byte-range seek and existing player resume positions work without restarting the video to adjust the source. Idle cached metadata and verified data survive in the bounded cache; libtorrent checks existing payload before reusing it. A full cross-restart resume-data journal is not implemented.

## Evidence, limitations and honest status

- JVM tests cover identity mismatch, explicit file selection, path safety, tracker filtering, byte mapping across piece/file boundaries, EOF and replacing seek windows.
- `TorrentPlaybackDeviceTest` is a real JNI/libtorrent/Media3 test using the authored synthetic AVC fixture. It compares a nonzero cross-piece range byte for byte, requires actual rendered first frame, decodes after seek to 5s, then requires continued frames past 6s. It uses a test-only injected IP-filter dependency and a test-owned loopback webseed; the production factory remains public-only.
- Compiling the test is not executing it. Until a device/emulator result is recorded, first-frame/seek/continuation are **UNVERIFIED**.
- Public DHT/magnet metadata acquisition, actual Torrentio provider responses, 2K/4K codec/hardware performance on the user's S23 Ultra and weak swarm fallback are separate **UNVERIFIED** E2E cases. Provider quality labels alone are not evidence of actual decoded resolution.
- No paid API is needed for the native engine. Configured addons returning debrid HTTP continue through the ordinary HTTP delegate. Account linking, cache probing and hardware-aware Auto scoring are separate integration capabilities, not implied by this engine.

## Authored fixture

`android/app/src/androidTest/assets/addon-torrent-proof.mp4` is generated from FFmpeg `testsrc2`, without third-party footage/audio. Generation:

```
ffmpeg -f lavfi -i testsrc2=size=320x180:rate=15 -t 12 -c:v libx264 -pix_fmt yuv420p -preset veryfast -g 15 -crf 27 -movflags +faststart -an addon-torrent-proof.mp4
```

The test authors its own bencoded metadata and SHA-1 piece table over those exact bytes. It does not rely on a paid account, piracy provider or live community uptime.
