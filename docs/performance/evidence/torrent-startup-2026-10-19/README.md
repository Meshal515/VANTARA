# Owned-swarm rendered playback evidence — 2026-10-19

These are Linux x64 loopback engineering measurements using rqbit 9.0.1, mpv 0.40.0, FFmpeg 7.1.5 and an Xvfb rendered window. They do not establish physical Windows display performance, public swarm performance, mixed-speed peer behavior, 4K playback, or a 26 GiB film target.

Every successful run has a nonblack rendered-window PNG, two seconds of live playback progression, and settled forward/back seeks to 12 and 2 seconds. Failed runs remain in the reports. First-render milliseconds include screenshot command completion and polling; they are observed upper bounds, not exact scanout timestamps. OS/seeder caches are warm; cold refers to a fresh application profile.

## Provenance and retained evidence

- `before-n5`, `containers-before`, `slow-before`: published v0.3.14 source commit `23850a566dcc561953a78b565317f88ca44bc1a5`. All five imported source modules match this tree byte for byte. Service SHA-256: `5b5888c5cb00908f40ac596191f379a06e3e9db5c57466049b03e108f58d1f43`.
- `after-n5`: an intermediate working snapshot captured before the final diagnostic changes. Its service SHA-256 is `a7fd17756b757d87aba1aedff07f76bda2c09eea59e0e249a4fc17263e4b9c9c`; it does not match a committed service revision. Its complete eight-module snapshot is retained, so these measurements are reproducible without incorrectly attributing them to the final branch.
- `containers-after`, `slow-after`, `final-n5`: source commit `8292dc09828c7c4876298326e089c278b91fbb1e`. All eight imported source modules match this tree byte for byte. Service SHA-256: `f01c854f8364f4785f722791b0b91b5933d22a184e3e93a460c9853703bd4623`.
- Earlier n5 runs used the benchmark at `bdfda20c`; later container and slow-peer runs use `2b1102ef020f554d6c8513263ad04c6521390ac2`, which adds an empty-output assertion, harness hash and readback of seeder limits. Their measurement path is unchanged. Later reports record their own harness SHA-256.

Each result folder includes sanitized `results.json`, all rendered PNGs, and exact imported source snapshots with SHA-256s. Host paths are replaced by `<baseline-checkout>`, `<improved-checkout>`, `<native-tools>`, `<ffmpeg>`, `<fixture-source>`, and `<evidence>` markers. Numbers, timestamps, authored torrent identities, loopback request/range timings, events, failures and hashes are retained. No authentication headers, public media magnet, external source URLs, profile payloads or third-party media are included. Raw mpv log files and large authored fixture videos are omitted. `fixtures.json` records exact video bytes and hashes; reuse fixture files for a byte-identical rerun because freshly authored MKV headers can differ.

The complete JSON also contains cache-before extent coverage, storage observations and Linux process RSS/CPU-tick samples. These are point samples of live rqbit/mpv processes, not peak-memory instrumentation or normalized CPU benchmarks. The small faststart fixture is 7,622,078 bytes and can be completely covered by replay cache; this is not evidence of caching an entire large film.

## Five-trial faststart MP4

All 90 runs completed rendered proof, progression and both seeks across baseline, intermediate snapshot, and final committed source. The six modes use five samples each. Main comparison is baseline versus final; the intermediate is retained for provenance. The runner tested versions sequentially, but the shared host was not reserved exclusively, so other work and time drift can confound small differences. Final new-source median and p95 are slower than baseline; partial-cache p95 is also slower. These results support a warm/restart improvement in this controlled run, not universal startup acceleration.

| Mode | Baseline median / p95 ms | Final median / p95 ms | Intermediate median / p95 ms |
| --- | --- | --- | --- |
| cold | 666.314 / 774.461 | 603.930 / 787.066 | 652.028 / 761.136 |
| warm | 664.166 / 739.571 | 499.680 / 632.320 | 412.399 / 499.541 |
| restart | 726.290 / 825.435 | 532.351 / 721.645 | 493.324 / 527.846 |
| partial | 623.892 / 675.620 | 565.439 / 1134.529 | 573.144 / 585.512 |
| newsource | 662.569 / 921.257 | 805.339 / 1341.829 | 624.368 / 723.252 |
| nocache | 637.879 / 653.291 | 603.587 / 619.688 | 614.632 / 638.479 |

## Controlled slow peer

A real rqbit seeder is limited to 524,288 bytes/s. Both reports confirm `upload_bps: 524288`. This is one owned slow peer, not HTTP delay emulation or a mixed swarm. The baseline completed 1/3 runs. It rendered all three, but warm and restart failed the two-second progression threshold: 0→1.041667s and 0→0.833333s, respectively, so seeks were not attempted for those failures. The improved committed source completed 3/3 with both seeks in each. With one trial these are smoke results and not reliability estimates.

| Mode | Baseline first render ms / complete | Final first render ms / complete |
| --- | --- | --- |
| cold | 919.191 / pass | 1423.286 / pass |
| warm | 820.204 / fail (stable playback) | 907.965 / pass |
| restart | 707.983 / fail (stable playback) | 609.265 / pass |

## Container smoke

One trial per cell; all 12 runs completed rendered proof, progression and both seeks. The late-moov file is 41,176,510 bytes with a synthetic 32 MiB free box before trailing moov; MKV is 7,624,981 bytes. The final cold samples are slower than baseline. These results show compatibility and cache-path exercise, not a general startup improvement for these containers.

| Fixture / mode | Baseline ms | Final ms |
| --- | --- | --- |
| late-moov / cold | 1051.659 | 1328.503 |
| late-moov / restart | 911.152 | 618.882 |
| late-moov / partial | 779.108 | 750.690 |
| MKV / cold | 671.135 | 1088.003 |
| MKV / restart | 713.288 | 425.388 |
| MKV / partial | 661.186 | 470.574 |

## Remaining limits

The stable observation lasts two seconds, not an entire film. Five samples are a small distribution: nearest-rank p95 is the maximum observed sample. Baseline runs preceded improved runs, so environmental drift and screenshot/decoder startup variability remain. No loss/jitter, piece corruption, interrupted-write recovery, multi-hour playback, cache-volume fallback under real disk pressure, Windows antivirus overhead, physical Windows GPU, or public-swarm target was measured here. Use the benchmark instructions in [torrent-startup-benchmark.md](../../torrent-startup-benchmark.md) to rerun on the supported Windows desktop with the intended workload before making those claims.
