# Large-piece trailing-index investigation — 2026-10-20

This checkpoint preserves an owned-loopback HEVC stress case and an engineering comparison. **It contains no production strategy change and does not establish the cause of the reported public-swarm Windows or Android failures.** Neither arm passed its full two-run rendered-playback gate, so this is not release evidence for enabling legacy warming.

Both arms use the same service snapshot from `bde2eb4a`, rqbit 9.0.1, Linux mpv 0.40.0 and an Xvfb window. The source modules and binary hashes are retained in the reports. Harness checkpoint `da34d453` exposes piece size and the already-existing strategy option; the imported service implementation is identical between arms.

## Workload

The authored 3-second committed `tools/fixtures/vantara-4k-hevc10.mp4` was looped eight times with stream-copy. The resulting 24-second HEVC Main 10, 3840×2160 video has legal synthetic `free` boxes before its trailing `moov`. This makes metadata far from the head without downloading an external film. The fixture is 270,689,965 bytes, its `moov` begins at byte 270,682,946, its torrent uses 4,194,304-byte pieces, and its real owned seeder is limited to 262,144 bytes/s. Exact fixture identity is in [fixture.json](fixture.json).

This is a deliberately sparse-content container layout, not a realistic 26 GiB/4K bitrate workload. The media payload is much smaller than the synthetic padding. Cold means a fresh app profile; the seeder and OS file cache are warm.

## Observations

| Strategy / trial | Requested moov first byte | Observed rendered PNG | Full playback / seek gate |
| --- | ---: | ---: | --- |
| demand / 0 | 39.706 s | 47.306 s | pass |
| demand / 1 | 40.453 s | unavailable | fail: mpv IPC deadline |
| legacy both / 0 | 23.994 s | 49.195 s | fail: mpv IPC deadline |
| legacy both / 1 | 23.716 s | 42.889 s | pass |

The verified tail body arrived about 16 seconds earlier with legacy head/tail warming in these four samples. The request traces support a piece-scheduling explanation. Demand's first head body arrived at 15.114 / 15.852 seconds; MPV requested the trailing moov at 15.255 / 15.963 seconds, then waited about 24.5 seconds for it. Legacy tail requests started before head verification and completed near 24 seconds.

Rendered-window measurements were unreliable in this run. The harness has a fixed three-second mpv IPC deadline and takes a full-resolution screenshot. In legacy trial 0, mpv reached EOF at 48.357 seconds while screenshot completion was observed at 49.195 seconds; the following IPC call failed. The demand trial 1 and legacy trial 0 processes also overlapped briefly because the second command was launched before the first command had fully ended. Shared CPU/screenshot contention can confound render timings. Do not compare only the successful sample in each arm as a performance distribution. Both process exit statuses were 1 because each retained one failure.

All four PNGs are retained, including screenshots from failed trials. A PNG alone does not make a failed run pass. Successful trials additionally advanced for two seconds and completed seeks to 12 and 2 seconds. The full reports retain exact ranges, first bytes, headers, `/haves`, diagnostics, errors and cache/storage/process observations.

## Upstream scheduling evidence

The bundled `rqbit-v9.0.1-source.tar.gz` was inspected without modifications:

- `crates/librqbit/src/torrent_state/streaming.rs:29–50`: each stream prioritizes the next 32 MiB, clamped to file length. An HTTP Range end does not narrow this queue.
- `streaming.rs:95–101`: stream queues are shuffled and interleaved.
- `torrent_state/live/mod.rs:1669–1738`: a peer acquires a piece and requests all its chunks before choosing another piece.
- `live/mod.rs:995`: the default peer request window is 128 chunks, allowing the next piece to enter the pipeline before the previous piece verifies.
- `file_info.rs:14–25`: native ordering without a stream is first piece, last piece, then middle pieces.

The head reader's 32 MiB window can therefore override native tail preference before MPV discovers that it needs the moov. No public rqbit 9.0.1 HTTP/CLI option was found to reduce this lookahead or assign piece priority directly. Paused streams retain the same lookahead and do not solve that constraint.

Two ideas remain **unimplemented and unmeasured**: a bounded final-piece request only after an early MP4 layout hint identifies `mdat` before `moov`, or deferring the initial head reader until native piece 0 verification allows the native tail request to enter the pipeline. Both require faststart, multi-piece first-frame, seek, cancellation and integrity gates. Raw sparse-file header bytes could only be an untrusted scheduling hint; they must never enter playback or the verified replay cache. No such raw-file inspection is in this checkpoint. rqbit `--fastresume` remains disabled because the separate existing integrity probe demonstrated unsafe behavior.

## Reproduction and files

The raw artifact root is `/workspace/VANTARA-artifacts/torrent-tail-20261020`. Its `fixtures/` contains the exact authored MP4, and `demand-n2/` and `both-n2/` retain original reports, profiles, source snapshots, seed copies and logs. All benchmark processes have exited. This committed bundle replaces host paths with `<evidence>`, `<checkout>`, `<native-tools>`, `<native-libraries>`, `<native-cache>` and `<ffmpeg>` markers. Numbers, authored torrent identities, failures and hashes are unchanged; no authentication header or public source URL is recorded. Each committed `run.json` is also embedded in its arm's `results.json`. The two source snapshots were byte-identical; one shared copy is retained.

Run arms sequentially on an otherwise idle supported desktop. Use the same exact fixture bytes for both:

```sh
node tools/torrent-startup-benchmark.mjs \
  --service-module /path/to/checkout/apps/desktop/src/services.mjs \
  --rqbit /path/to/rqbit-linux-amd64 --mpv /path/to/mpv \
  --xvfb /path/to/Xvfb --library-path /path/to/native-libraries \
  --runs 2 --kinds late-moov --modes cold --padding-mib 256 \
  --piece-length 4194304 --seed-upload-bps 262144 --timeout-ms 90000 \
  --torrent-warmup demand --fixtures-from /path/to/fixtures --output /path/to/demand-n2
```

Repeat after completion with `--torrent-warmup both` and a fresh output directory. For reliable 4K render measurements, first resolve the screenshot/IPC overhead and rerun both arms; do not silently discard these failed samples. Linux Xvfb does not prove physical Windows rendering or Android playback.

The exact fixture construction used FFmpeg 7.1.5 and Python:

```sh
ffmpeg -v error -y -stream_loop 7 -i tools/fixtures/vantara-4k-hevc10.mp4 -c copy /path/to/fixtures/remux.mp4
python3 - <<'PY'
from pathlib import Path
import struct
root = Path('/path/to/fixtures')
b = (root / 'remux.mp4').read_bytes()
offset = 0
while offset + 8 <= len(b):
    size = struct.unpack_from('>I', b, offset)[0]
    if b[offset + 4:offset + 8] == b'moov':
        break
    assert size >= 8
    offset += size
assert b[offset + 4:offset + 8] == b'moov'
prefix_free = 2_247_490 - offset
assert prefix_free >= 8
def free(size):
    return struct.pack('>I', size) + b'free' + bytes(size - 8)
(root / 'authored-late-moov.mp4').write_bytes(
    b[:offset] + free(prefix_free) + free(256 * 1024 * 1024) + b[offset:])
PY
```

Different FFmpeg versions can alter remux metadata and hashes. Preserve/reuse the existing fixture when comparing exact torrent identities. Helper validation: `node --test tools/torrent-startup-benchmark.test.mjs` passes all three assertions.
