# Experimental Windows libtorrent worker

This is an executable streaming backend, not an addon provider or a replacement
for mpv. It uses official libtorrent 2.0.13 bindings. Android currently uses
jlibtorrent 2.0.12.9; both wrap libtorrent's 2.0 family, but these are not identical
builds. The existing rqbit backend remains the default. The sibling Java native
bootstrap proves JNI loading only; it has not replaced this worker or rqbit.

The worker implements the authenticated rqbit API subset required by
`services.mjs`: one selected file, retained metadata, verified Range reads,
piece bitfields, stats, pause/resume, deletion and cancellation. Current pieces
get deadline zero, followed by a bounded 12-piece window. No speculative tail
reader competes with an actual container request. Bytes come exclusively from
`read_piece_alert` after libtorrent verification. The existing desktop replay
cache and rolling sparse-file budget continue to apply.

Limits: 64 MiB verified memory cache, 8 concurrent HTTP requests, 8 MiB metadata,
32 metadata records for seven days, 512 KiB DHT snapshot, 512 MiB free disk reserve.
The production CLI cannot allow private peers. Test adapters under `tools/`
enable only the authored loopback fixture and are excluded from the app bundle.

Build the separately pinned runtime with
`node tools/bundle-windows-libtorrent.mjs --output=/absolute/staging/path`.
`tools/build-windows.mjs --libtorrent=true` includes it in a verification build;
this does not select it. The app/service caller must explicitly choose
`torrentBackend: 'libtorrent'` and provide absolute `libtorrentPython` and
`libtorrentScript` binary paths. Python is launched with `-I`, a controlled
embedded `_pth`, and no inherited `PYTHON*` variables.

Run `python -I server_test.py` in a disposable environment with libtorrent2.0.13.
The Windows parity workflow uses the actual bundled x64 interpreter and wheel,
then compares both backends with both seed engines and real mpv screenshots.
Do not switch Stable's engine based on a bootstrap, loopback throughput, or a
`playback-restart` event. Review all failures, first-render timings, steady
playback, seeks and Windows evidence first. Public 4K torrent latency is not
established by these fixtures.
