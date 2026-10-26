# Optional libtorrent in a local Windows preview

The production torrent backend remains **rqbit**, including when a preview
build carries optional native files.

1. Build a separate verification artifact using `node tools/build-windows.mjs --libtorrent=true` with the other required normal build arguments.
2. Only within that isolated, packaged Windows artifact, run VANTARA.exe with the exact `--vantara-torrent-preview=libtorrent` argument.
3. The process checks the pinned `libtorrent 2.0.13` / Python 3.13.17
   bundle manifest and expects the embedded `python/python.exe`,
   `python/python313._pth` and `server.py`. It never launches system Python,
   installs new dependencies, or silently switches backends.
4. Use the existing playback startup diagnostics and compare against the
   baseline with the **same** stream and cold/warm conditions.
5. An installer should not be promoted to Stable based on a preview flag.
   A real Windows play/seek/4K/update regression gate is required.

This switch does not automatically improve playback and is deliberately
not exposed through the renderer, user account, addons or update settings.
