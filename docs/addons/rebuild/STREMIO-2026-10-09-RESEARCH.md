# Stremio / Torrentio interoperability review — 2026-10-09

This report separates a provider's declared capabilities, valid responses, and actual playback. A successful manifest request is **not** proof of first frame, subtitle rendering, seek, or 4K decoding. Live captures and pinned repository identities are in `research/2026-10-09/`. No implementation code from external addons was copied.

## What is actually stopping VANTARA

At the starting revision `a6992efc736ace7746fb9d7f22d64b3ddd8b13a7`, APK external-addon capability assessment admitted subtitles but generally excluded catalog/meta/streams. The shared stream normalizer applied browser rules to every platform: it discarded torrent identity, rejected `notWebReady`, and rejected HTTP request headers. Installing a manifest therefore could not turn Torrentio into native playback. These are VANTARA boundaries to fix; a host's 403 or a torrent with no available peers is a separate outcome. The refreshed corpus also found a concrete additional bug: MediaFusion's actual manifest ID `stremio.addons.mediafusion|elfhosted` was rejected by VANTARA's reverse-DNS-like ID whitelist. Stremio IDs need independent safe opaque-string validation; VANTARA Remote IDs retain their own stricter contract. Two captured-manifest tests failed before that fix and passed afterward.

The current raw manifest adapter already handles resource-specific types/prefixes, catalog extras, configured URL prefixes, and additional safe content types. Preserve these behaviors rather than replacing them with special-case rules for Torrentio or a particular work title.

## Official protocol rules that matter

Primary reference: [official MIT Stremio Addon SDK](https://github.com/Stremio/stremio-addon-sdk/tree/ec4e0a49e61bac4f2285891d39414dfbafe93f58). This is still the observed current SDK commit. References are protocol facts; VANTARA independently implements them.

| Contract | Correct interpretation |
| --- | --- |
| [Stream variants](https://github.com/Stremio/stremio-addon-sdk/blob/ec4e0a49e61bac4f2285891d39414dfbafe93f58/docs/api/responses/stream.md) | `url`, `infoHash`, `ytId`, `externalUrl`, NZB and archive variants are different source kinds. A URL can require native codec support; a torrent needs an engine. Do not relabel a browser limitation as a provider failure. |
| `infoHash` + `fileIdx` | Preserve torrent identity and exact zero-based file index, including `0`. An absent index means select the largest file according to the official contract; this differs from an explicit index. Reject malformed/negative indexes instead of silently playing a different episode. |
| `sources` | Optional peer-discovery hints: `tracker:<protocol>://...` and `dht:<node_id/info_hash>`. They are not direct media URLs. Validate and bound them independently. |
| `notWebReady` | A browser readiness hint for URL streams, not a global native ban. Media3 still needs codec and media validation. |
| `proxyHeaders.request` | Native HTTP can send validated request headers. Bound names/values and reject CR/LF. Do not forward private credentials to unrelated redirect origins. |
| `proxyHeaders.response` | Describes a proxy's response behavior. It cannot be implemented by setting request headers. Native can ignore CORS-only hints because CORS is a browser rule. If an actual response transformation such as a Content-Encoding override is needed and no proxy semantics exist, preserve an explicit per-stream limitation. |
| `behaviorHints.filename`, `videoHash`, `videoSize` | Feed subtitle matching. `videoHash` is the 16-character OpenSubtitles file hash, **not** the 40-character BitTorrent info hash. Never substitute one for the other. |
| [Subtitle requests](https://github.com/Stremio/stremio-addon-sdk/blob/ec4e0a49e61bac4f2285891d39414dfbafe93f58/docs/api/requests/defineSubtitlesHandler.md) | Use the actual video ID, with season/episode in Cinemeta IDs where applicable. Supply available filename/hash/size as extra arguments. Subtitle discovery must not block video. |
| [Resource matching](https://github.com/Stremio/stremio-addon-sdk/blob/ec4e0a49e61bac4f2285891d39414dfbafe93f58/docs/api/responses/manifest.md) | Resource-object types/prefixes are independent of top-level defaults. Missing prefixes mean unrestricted; `[]` means match none. Catalog IDs are not filtered by video ID prefixes. |
| Configured manifests | Preserve configured path/query exactly for requests. Redact them from user-facing errors, diagnostic summaries, reports and screenshots: settings may contain account credentials. Configuration-required is not broken. |
| Extra args | Catalog extra rules determine required filters/options. Encode values once, preserve Unicode, `&`, `+`, slash and percent characters. Unknown safe addon types remain external identifiers. |

### Torrentio-specific observations from current source

Pinned [Torrentio source](https://github.com/TheBeastLT/torrentio-scraper/tree/d812d87aa8f65a1fe0d4f15a66bee7ebdba9bdd0), Apache-2.0. Its `addon/lib/streamInfo.js` emits `infoHash`, `fileIdx`, `sources`, filename/binge-group hints and human display text. Seeders and size occur in that display text; there is no universal structured seeders guarantee. A parsed seeders label is advisory, and an engine's actual peers/buffer throughput is stronger evidence.

Its torrent-associated subtitle URLs can point to Stremio's own localhost streaming server. VANTARA must keep remote localhost links blocked; using these subtitles would require mapping torrent file identity to VANTARA's own owned runtime. Dropping that subtitle must not discard a valid video torrent.

Its Debrid stream is an HTTP resolver path that can redirect to a CDN. A configured Debrid result can reach Media3 without implementing torrent transport, but does not make a subscription mandatory for the native torrent path. Do not log configured resolver paths or share one account between users.

`torrentio-stream.contract.json` is an independently authored example of this source contract, **not** a captured live torrent or playback proof. It uses inert placeholder hashes/hosts. Tracker discovery and torrent decoding remain native engine responsibilities.

## Current addon shortlist and honest evidence

The following recommendations concern interoperability coverage and alternative providers. They are not a promise that every title, release, language, codec, peer swarm or hosted instance will work.

| Addon | Role | Fresh direct observation | Recommendation / boundary |
| --- | --- | --- | --- |
| Torrentio | Torrent stream discovery; optional Debrid results | Official public manifest and Big Buck Bunny stream route returned **403** from this workspace | Highest-priority native torrent contract; live Torrentio request and playback **UNVERIFIED** here. A 403 is not fixed by accepting its manifest. |
| [AIOStreams](https://github.com/Viren070/AIOStreams) | Aggregates configured providers, deduplicates/filters/formats results; optional services | GitHub current commit/license inspected; no private configured instance available | Useful single protocol entry point. It does not supply an Android torrent engine. Treat configured credentials as private. Hosted/configured resource and playback **UNVERIFIED**. |
| [Comet](https://github.com/g0ldyy/comet) | Stream discovery / alternative indexers | `https://comet.elfhosted.com/manifest.json` **200**; public Big Buck Bunny stream route **403** | Manifest compatibility can be tested. Do not claim public instance stream health or first frame. |
| [MediaFusion](https://github.com/mhdzumair/MediaFusion) | Catalog / stream / live-event source capabilities | Public manifest **200**; public Big Buck Bunny stream route **200**, `streams:[]` | Empty success is not transport failure. Resource-specific `movie/series/tv/events` and prefix rules matter. Playback **UNVERIFIED**. |
| [StremThru Torz](https://github.com/MunifTanjim/stremthru) | Crowdsourced torrent results; configured stores | Actual `/stremio/torz/manifest.json` **200**, v0.105.3, configuration required | Real manifest uses top-level `types:[]` and nonempty stream resource types. Accept scoped types; require user setup. Configured resources/playback **UNVERIFIED**. |
| OpenSubtitles v3 | Subtitle-only baseline, no catalog needed | Manifest **200**; Big Buck Bunny request **200**, two subtitle records | Strong baseline real resource conformance. Listing and a real English BBB SRT download (200; two timestamp cues) are verified; actual player rendering is a separate proof. |
| SubDL | Independent subtitle provider | Manifest **200**, v1.2.2, configuration required | Preserve safe extra top-level type `subtitles`; do not show setup as provider failure. Configured subtitle retrieval/rendering **UNVERIFIED**. |
| SubSource | Independent subtitle provider | Manifest **200**, v1.4.2, configuration required | Same capability/configuration principle. Configured subtitle retrieval/rendering **UNVERIFIED**. |
| [SubPool by Diavelin](https://github.com/MrDiavelin/subpool) | New multi-provider subtitle list with free/download-quota labels and release matching | Manifest **200**, v3.15.0, configuration required; unconfigured BBB returns setup-message SRT | Worth interoperability coverage for Arabic and anime namespaces. The setup-message track is not a real subtitle: gate unconfigured discovery. Each user supplies their own accounts/keys. Configured subtitle results/rendering **UNVERIFIED**. |

SubPool's source license permits inspection only and explicitly prohibits code reuse/hosting without written permission. Its README claims anime IDs, archive unpacking, ASS-to-SRT and experimental style preservation; these are provider claims, not VANTARA renderer proof. No SubPool implementation or branding asset was copied.

Repository snapshots record exact observed commits and license metadata. AIOStreams is AGPL-3.0 and Comet GPL-3.0: consume their public data protocol without copying their implementation into VANTARA. MediaFusion/StremThru are MIT. Any future permitted code reuse must retain actual upstream notices; inspecting a README is not code reuse.

## Reddit findings, checked against original repositories

- [18 July 2026 free-addon roundup](https://www.reddit.com/r/StremioAddons/comments/1uzygxu/the_ultimate_list_of_free_addons/) groups Torrentio, StremThru Torz, Comet and MediaFusion as P2P options and separates HTTP alternatives. This supports **source-kind-aware** integration, not pretending all results are browser video URLs.
- [16 August 2026 addon discussion](https://www.reddit.com/r/StremioAddons/comments/1vq867l/best_addons_august_2026/) reports public-instance changes and different preferences for aggregation versus standalone backups. This supports per-provider outcomes, deduplication and alternatives; it does not establish uptime rankings or paid-service superiority.
- [7 October 2026 SubPool announcement](https://www.reddit.com/r/StremioAddons/comments/1x0ao1k/subpool_one_subtitle_list_from_opensubtitles/) describes multi-provider subtitle aggregation and warns that Stremio's Android menu can omit provider labels. VANTARA should preserve genuine labels/provenance and distinguish actual subtitle results from setup/help tracks.
- [Community subtitle engine update](https://www.reddit.com/r/StremioAddons/comments/1qprz39/stremio_community_subtitles_v060_performance/) discusses asynchronous provider handling. It is additional evidence for independent, nonblocking subtitle requests; no code was copied.

Reddit is discovery and user experience evidence. Protocol contracts come from official SDK/client and original source; operational status comes from direct probes and player tests. There is no defensible universal “best addon” or “100% upstream availability” claim.

## Corpus and verification boundaries

`research/2026-10-09/` includes minimized fresh manifests for seven reachable providers, HTTP outcomes (including failures and empty success), exact primary repository commits/licenses, and an explicitly authored Torrentio contract fixture. Configured account secrets, signatures, media download URLs, branding assets and implementation source are not committed.

Run deterministic captured-corpus tests offline. These prove parsing, routing, identity/matching semantics and platform classification. Live service checks are separate and bounded; they must not make a reproducible unit suite depend on current provider uptime.

For a capability badge, keep distinct stages: **manifest accepted → resource response valid → native/browser transport available → first frame → seek/continued playback**. Only the latter proves playback. Native torrent metadata, file selection, piece-prioritized random reads, cancellation and Media3 seek need a native owned test torrent plus first-frame evidence. Advertised “4K” does not prove decoded 2160-line video or hardware decoding.

**UNVERIFIED:** live Torrentio/Comet streams in this environment; configured AIOStreams/StremThru/Debrid requests; configured SubDL/SubSource/SubPool actual subtitles; native torrent first frame/seek until engine E2E runs; actual Arabic subtitle rendering from these new providers; actual 2K/4K decoder capability on the user's APK device. PWA raw-torrent playback still requires a separate browser-compatible service and must not be advertised by native capability alone.

## Deterministic conformance result

`apps/web/addons/adapters/stremio-oct9-conformance.test.js`: **31 tests passed** after compatibility fixes. The fresh MediaFusion opaque ID and native response-transform cases were observed failing before the fixes. Tests exercise real captured manifests/resources alongside clearly labelled authored transport fixtures: scoped types, empty top-level types, namespaces, configuration gating, native vs PWA source kinds, torrent file index zero/absence/malformed values, local-subtitle isolation, subtitle hash identity, direct HTTPS siblings, HTTP headers, configured paths and Unicode extras, structured failures and secret redaction. These tests establish contract behavior, not live torrent first frame or hardware decoding.
