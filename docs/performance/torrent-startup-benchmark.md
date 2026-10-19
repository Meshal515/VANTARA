# Reproducible torrent startup benchmark

`tools/torrent-startup-benchmark.mjs` runs authored video through real rqbit and real mpv. It verifies a nonblack **rendered-window PNG**, actual playback progression for two seconds, and real forward/back seek commands. A playback-restart event or video-out dimensions alone does not pass the benchmark.

The script is an engineering test adapter, never app code. It intercepts the configured child-process calls in its own Node process, exposes a loopback API forwarding server, and injects only its owned local seeder into rqbit add requests. Real rqbit/mpv children remain attached to ordinary service cleanup. DHT, public trackers, LSD, and UPnP are disabled. No public swarm, media addon, or copyrighted film is contacted.

## Before and after

Use an isolated checkout at published Windows v0.3.14 commit `23850a566dcc561953a78b565317f88ca44bc1a5` for the baseline. Pass the improved service module path separately. The benchmark snapshots each module's local runtime dependencies and records SHA-256 values before execution; edits during the run cannot change the loaded snapshot.

Linux example (use the actual binary paths on the machine):

```sh
node tools/torrent-startup-benchmark.mjs \
  --service-module /path/to/published-checkout/apps/desktop/src/services.mjs \
  --rqbit /path/to/rqbit-linux-amd64 --mpv /path/to/mpv \
  --ffmpeg /usr/bin/ffmpeg --xvfb /path/to/Xvfb \
  --library-path /path/to/native/shared-libraries \
  --runs 5 --output /tmp/benchmark-before

node tools/torrent-startup-benchmark.mjs \
  --service-module /path/to/improved-checkout/apps/desktop/src/services.mjs \
  --rqbit /path/to/rqbit-linux-amd64 --mpv /path/to/mpv \
  --ffmpeg /usr/bin/ffmpeg --xvfb /path/to/Xvfb \
  --library-path /path/to/native/shared-libraries \
  --fixtures-from /tmp/benchmark-before/seed \
  --runs 5 --output /tmp/benchmark-after
```

Reuse `--fixtures-from` so both versions use byte-identical MP4/MKV files and therefore identical torrent hashes. Newly generated MKV headers may otherwise differ. Run versions sequentially to avoid benchmark-induced CPU contention. The seeder and OS page cache are warm for both versions; “cold” means a fresh application profile, not a physical cold disk.

On Windows, invoke the same Node script with absolute `--service-module`, `--rqbit ...\rqbit.exe`, `--mpv ...\mpv.exe`, and `--ffmpeg ...\ffmpeg.exe` paths. Omit Xvfb and library-path. A usable desktop session/graphics output is required; a headless runner failing rendered-window proof must remain a failure. No Windows result is inferred from Linux. Process CPU/RSS is currently measured on Linux only; unavailable Windows process metrics are explicitly reported instead of fabricated. Allocated disk bytes are also null on Windows; logical file bytes are available.

## Workload and modes

Default fixtures are 24-second authored MPEG-4 video at 640×360/24 fps: faststart MP4, moov-at-end MP4, and MKV. Late-moov MP4 includes a legal 32 MiB `free` box inserted after media data, before its moov. This is synthetic container layout stress, **not** a real 26 GiB/4K torrent. `--padding-mib` changes the padding; the file byte length and padding are recorded.

Each fixture has five trials by default, with the same sequence:

| Mode | Exact state |
| --- | --- |
| cold | Fresh userData profile; no application payload cache. |
| warm | stop/start on the same service factory and userData. Does not assume the old implementation retains anything. |
| restart | Close factory, create a new factory with the same userData. This models application-owned persistence, not an OS reboot. |
| partial | Close factory; trim only this benchmark's verified replay head extent to at most 256 KiB, remove its other extents, recompute its stored digest, then reopen. Baseline without a replay cache records cache unavailable and acts as its cold control. This is deliberate fixture preparation, not an engine bitfield change. |
| newsource | Use identical authored media bytes under a different torrent filename/info hash. Existing source cache must not apply. |
| nocache | New factory with replayCache:false. Baseline ignores this new option, which is also its existing no-replay behavior. |

Use `--modes cold,warm,restart` and `--kinds mp4` for a shorter matrix. `--runs 1` is a smoke run, not a distribution estimate. `--seed-upload-bps 524288` rate-limits the real rqbit seeder to a controlled 512 KiB/s; this tests one slow peer, not a mixed-speed swarm. The script does not claim that an HTTP delay is peer/network behavior.

## Evidence and interpretation

Every run stores its rendered-window PNG, mpv error log, events, HTTP request/header/first-body-byte timings, exact infoHash/fileIdx, source snapshots, hashes of native binaries, stable-playback positions, seek settling times, app-cache coverage, CPU/RSS observations where available, and disk observations in results.json and per-run run.json. Range logging is confined to the local engine API; it contains no external source magnet or addon URL.

`firstRenderedMs` is the time at which mpv confirms screenshot-to-file completed and the PNG subsequently passes pixel checks. It is an **upper bound on first render observed by this polling method**, including the screenshot command, not the exact display scanout instant. Linux Xvfb proves a rendered virtual window, not a physical Windows display. Medians and nearest-rank p95 use successful measured runs; failed counts remain visible and failures make the process exit nonzero.

Seek settling uses live mpv time-pos following a service seek command. Stable playback must advance at least 60% of the elapsed observation interval. It is not a promise of an entire film without stalls. A favorable localhost result establishes reproducibility and rendered playback, not the requested public-swarm or Windows targets.

Run helper assertions with:

```sh
node --test tools/torrent-startup-benchmark.test.mjs
```

## Recorded local evidence

The [2026-10-19 evidence bundle](evidence/torrent-startup-2026-10-19/README.md) preserves seven completed matrices, 108 rendered PNGs, exact source snapshots and sanitized JSON reports. It includes the final committed-source five-trial MP4 comparison, one-trial MKV/late-moov cases, and controlled 512 KiB/s peer cases with two baseline stability failures retained. Its README reports slower cases and scope limits alongside warm/restart improvements.
