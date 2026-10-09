# Addon playback compatibility — 2026-10-09

## Diagnosis and implementation

APK previously declared Stremio addons subtitles-only, normalized video replies using PWA constraints, and never passed external stream copies to native preparation. Installing a manifest therefore did not establish a usable video route. These gates now use individual native capabilities. Older APKs without the native stream capability remain gated.

Raw Stremio resources remain independent from VANTARA Remote v1. Catalog, metadata, streams, subtitles, scoped types/prefixes, configured paths/query parameters and extra arguments share the Stremio adapter. The real MediaFusion ID containing `|` now works without relaxing Remote v1 IDs. Update/rollback revalidates the raw manifest against the current adapter.

Native stream preparation reserves addon batches beside core sources, publishes providers progressively, and requires an exact generation token. Closing/replacing a native session cancels preparation and releases the registry snapshot; stale results cannot enter another session. Native-next requests retain the exact provider and episode identity. Sources and THE ROCK remain available; preparation never starts playback.

HTTPS/HLS/DASH/MP4 addon candidates use Media3 with an isolated public-network client. Required request headers are preserved; credentials cannot leak to another origin or subtitle request. Unsupported response transformations reject only that candidate. Browser-only `notWebReady` does not prohibit native playback.

A free native libtorrent/jlibtorrent DataSource handles torrent metadata, selected file index, verified pieces, seek and buffering on Media3's loader thread. No paid API, JS byte path, replacement player or executable addon script is required. The engine has bounded memory/disk/tickets/readers, cancellation, lazy downloading and storage checks. Existing player failure recovery remains in place, with torrent-specific startup budgets. Source/addon subtitles retain this DataSource when selected.

Anime now resolves exact AniList/MAL relationships to Kitsu before compatible provider fan-out. Conflicting mappings fail closed; titles are never used to create a cross-provider identity. `kitsu:N:E` is episodic, and an actual `MOVIE` uses bare `kitsu:N`. AniList parts do not donate an invented season segment. Core discovery and addon discovery race for first copies; only the user starts playback. Long-running series metadata accepts up to 10,000 video entries, separately from catalog limits and the 2 MiB response bound.

## Evidence

- Web: **1115 tests passing / 122 files**.
- Repository safety: **54 tests passing**; service-worker digest refreshed and new modules precached.
- Kotlin JVM: **379 tests passing / 73 classes**.
- Native debug APK and Android instrumented test APK built successfully.
- Actual arm64 ELF and APK 16 KiB alignment checks are documented in `native-torrent/ENGINE.md`.
- Authored legal video/torrent and VTT fixtures exercise native verified bytes → Media3 first frame → seek → continuing frames, and HTTPS → real subtitle cue → seek. **Device execution passed** on API 30 x86_64 at `3904236a7e24a73df2e48fe011735a278a5e2d2a`: [runtime run 37972216861](https://github.com/Meshal515/VANTARA/actions/runs/37972216861), `OK (3 tests)`. Both JSON proofs passed the gate for first frame, decoded video dimensions, seek and continued frames; HTTPS also proved a real external subtitle cue and torrent reads proved a byte SHA-256. The following review fixes are being rechecked on the updated branch. The GitHub runtime gate requires both instrumentation success and explicit JSON evidence; missing proof fails the gate.
- Public addon research/captured responses: `STREMIO-2026-10-09-RESEARCH.md`. Real manifests and catalog/meta/subtitle resources have deterministic regression coverage. OpenSubtitles returned a downloadable SRT with real timestamps. Torrentio/Comet public stream endpoints returned 403 from the execution environment.

## Independent review corrections

Review caught cached Kitsu episode-one copies, mapping that blocked ordinary preparation, late ordinary sources missing from an addon-first picker, and anime movie IMDb subtitles incorrectly classified as series. Regression tests now cover these paths. Core preparation starts before mapping; deferred results use the same session ID on PWA and generation ownership on APK. Active PWA episode context controls addon episode requests/cache keys, including late extension. Subtitle providers choose only compatible exact ID namespaces. JSON API media negotiation is supported without adding arbitrary request credentials.

## Limits / UNVERIFIED

- Public Torrentio playback, cold magnet metadata from public DHT/peers, weak-swarm fallback and hardware-decoded 2K/4K on the user's S23 Ultra are **UNVERIFIED**. Quality labels are advertised metadata, not decoded-resolution evidence.
- The owned torrent fixture uses cached metadata and a web seed. It cannot prove cold DHT discovery or public swarm availability.
- Configured Debrid providers returning HTTPS video use the ordinary native route. Account linking, cached-status probes, Auto/Direct/Debrid controls and hardware/seed/buffer scoring are **not implemented** by this change.
- Plain HTTP media and addon endpoints remain rejected by the existing HTTPS policy. NZB/archive/YouTube/external-page results and arbitrary executable addon runtimes are not claimed as supported.
- Torrentio's localhost subtitle endpoints are blocked; embedded Media3 tracks and real independent subtitle providers remain supported.
- PWA has no native torrent engine. It can use compatible browser video URLs; accepting a manifest does not make raw torrents playable in a browser.
- Ordinary-source discovery arriving after the picker has closed for playback is not guaranteed to join that already-playing session; late sources are attached while the picker is active. This remaining fallback-coverage limit is not a first-frame claim.
- Installed-addon UI → catalog → picker → player as one complete user journey is **UNVERIFIED**; native instrumentation starts at the protocol candidate/prepared-session boundary.
- Upstream protection, empty results, unavailable titles, credentials and peer availability cannot be guaranteed by protocol compatibility. No claim of 100% availability is made.

## Scope

Changes are isolated on `chatgpt/addon-playback-compatibility-20261009` from `a6992ef`. The original dirty source worktree is preserved. No manga translation, account, library, social or CSS redesign changes are included. Third-party notices accompany the permissive native dependency; no GPL/source-available addon application implementation was copied.
