# Addon playback compatibility implementation plan

> **For agentic workers:** Use parallel independent tasks with shared interface contracts; review the combined native and web changes before release.

**Goal:** Real Stremio catalog, metadata, streams and subtitle support on APK, including a free native Torrentio streaming path, while keeping PWA restrictions accurate.

**Architecture:** Keep Raw Stremio → adapter → normalized VANTARA data. Runtime capabilities determine stream normalization. Native prepared sessions accept independently completed addon batches beside existing source batches; Media3 reads torrent pieces through a native DataSource and keeps its existing HTTP path.

**Tech stack:** Kotlin, Media3, OkHttp, permissively licensed libtorrent/jlibtorrent, existing JavaScript addon adapters. No untrusted executable addon code.

**Spec:** User's approved APK Torrentio and Addon Fabric requirements, `docs/addons/SPEC.md`, current code and official Stremio SDK contracts. Public network failures and advertised quality are not playback proof.

## Constraints

- Preserve native sources, Aniyomi, THE ROCK, progressive readiness and user-selected playback.
- No autoplay from addon responses; subtitle requests never block video.
- Public HTTPS and guarded native network access; never route provider secrets into labels or logs.
- No copied GPL stremio-web or source-available addon implementation.
- Preserve all existing changes in the dirty source worktree; use the isolated addon compatibility branch.
- Capabilities, runtime readiness and verified first frame are separate evidence.

## Review focus

- An old APK without the new native capability method must not advertise torrent playback.
- A fast source batch must not mark a session complete while addons are pending.
- Closed or replaced sessions must reject late results and duplicate completions.
- Malformed streams must not hide usable siblings or retain unsafe headers/local subtitle URLs.
- Configured paths and query credentials must survive requests without appearing in diagnostics.

## Tasks

1. **Normalizer and web/native orchestration** — `apps/web/addons/streams.js`, `adapters/stremio.js`, `video.js`, `lib/anime-engine.js`, new native preparation module. Write failing platform, torrent metadata, headers, extra arguments and lifecycle tests; implement only matching seams; run web/addon regressions.
2. **Native capability/catalog boundary** — manifest, assessment, runtime, native runtime and existing addon browser. Test catalog/meta/HTTP/DASH capability access and old-APK gating before enabling them. Keep remote VANTARA protocols gated unless implemented.
3. **Native streaming engine** — isolated torrent package, bounded verified-piece cache, lazy metadata acquisition, file-index selection, deadline priorities, seek/cancellation, dependency and notices. Test invalid hash/fileIndex, read boundaries and cancellation; use a legal authored torrent for native runtime checks.
4. **Native prepared-session integration** — reserve addon provider batches before launching native sources; import public normalized HTTP/DASH/torrent candidates; idempotent completion and session scoping; preserve subtitle references. Wire the native DataSource into Media3 without changing playback policy. Test session races and candidate parsing.
5. **Primary-source conformance research** — pinned public Stremio contracts and current GitHub/Reddit findings; real public manifests/resources, deterministic regressions for discovered incompatibilities. Record upstream failures honestly; do not store configured account secrets.
6. **Combined verification and release** — inspect full diff, run affected web/native suites and safety checks, build APK and native runtime checks where available. Record first-frame/seek evidence or `UNVERIFIED` explicitly, then push/merge/publish only the reviewed result authorized by the user.

## Evidence log

- Baseline: 22 stream-normalizer/Stremio adapter tests passed at `a6992ef`.
- Investigation: APK blanket subtitles-only capability gates; native stream fanout disabled; header and torrent results normalized with PWA assumptions.
- Live Torrentio endpoint returned HTTP 403 from this execution environment on 2026-10-09. A manifest response cannot establish first-frame support.
