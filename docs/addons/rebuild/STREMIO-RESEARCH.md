# Stremio compatibility research

Observed on **2026-10-04 UTC**. This is a protocol and corpus note, not a claim that every listed addon plays media on VANTARA. Product code was read but not modified by this research task. The code findings below refer to the implementation inspected at the start of the rebuild.

## User-facing architecture

An addon sends its own data. A protocol adapter translates that data into VANTARA's common records. The app then decides which records it can show or play:

**Raw provider data → Protocol adapter → Internal VANTARA records → Platform player**.

The adapter should preserve provider IDs, resource matching rules, subtitle file hints, and setup requirements. It should not execute remote addon code or turn every addon into a movie source. A subtitle-only addon belongs in the subtitle provider list. A metadata-only addon can populate browsing without promising playback. Unknown external content types can remain identifiable without being assigned to cinema.

Keep Kotlin, Media3, Aniyomi, and THE ROCK as the existing native/bundled integration layers. A Stremio HTTP manifest is an additional data protocol. It does not replace native engines, imply a torrent engine exists, or make remote source code executable.

## Primary sources and license boundary

Official source snapshots used: SDK commit `ec4e0a49e61bac4f2285891d39414dfbafe93f58`; addon-client commit `7c66830cfc1a8e749373d9df0bb105c7dad33bfd`.

| Subject | Exact source |
| --- | --- |
| HTTP resource and extra paths; CORS | https://github.com/Stremio/stremio-addon-sdk/blob/ec4e0a49e61bac4f2285891d39414dfbafe93f58/docs/protocol.md |
| Manifest, resource objects, catalog extras, user config | https://github.com/Stremio/stremio-addon-sdk/blob/ec4e0a49e61bac4f2285891d39414dfbafe93f58/docs/api/responses/manifest.md |
| Standard content types | https://github.com/Stremio/stremio-addon-sdk/blob/ec4e0a49e61bac4f2285891d39414dfbafe93f58/docs/api/responses/content.types.md |
| Subtitle request video ID and extras | https://github.com/Stremio/stremio-addon-sdk/blob/ec4e0a49e61bac4f2285891d39414dfbafe93f58/docs/api/requests/defineSubtitlesHandler.md |
| Subtitle response and language labels | https://github.com/Stremio/stremio-addon-sdk/blob/ec4e0a49e61bac4f2285891d39414dfbafe93f58/docs/api/responses/subtitles.md |
| Streams and playback hints | https://github.com/Stremio/stremio-addon-sdk/blob/ec4e0a49e61bac4f2285891d39414dfbafe93f58/docs/api/responses/stream.md |
| Configured URL prefixes and Cinemeta episode IDs | https://github.com/Stremio/stremio-addon-sdk/blob/ec4e0a49e61bac4f2285891d39414dfbafe93f58/docs/advanced.md |
| Actual SDK routing, configured manifest transformation, HTTP errors | https://github.com/Stremio/stremio-addon-sdk/blob/ec4e0a49e61bac4f2285891d39414dfbafe93f58/src/getRouter.js |
| SDK root configuration-page route | https://github.com/Stremio/stremio-addon-sdk/blob/ec4e0a49e61bac4f2285891d39414dfbafe93f58/src/serveHTTP.js |
| Official client resource matching | https://github.com/Stremio/stremio-addon-client/blob/7c66830cfc1a8e749373d9df0bb105c7dad33bfd/lib/util/isSupported.js |
| Official client request escaping | https://github.com/Stremio/stremio-addon-client/blob/7c66830cfc1a8e749373d9df0bb105c7dad33bfd/lib/stringifyRequest.js |
| Official client HTTP status handling | https://github.com/Stremio/stremio-addon-client/blob/7c66830cfc1a8e749373d9df0bb105c7dad33bfd/lib/transports/http.js |
| Linter does not enumerate content types; unknown resources are warnings | https://github.com/Stremio/stremio-addon-linter/blob/master/lib/linter.js |
| SDK license | https://github.com/Stremio/stremio-addon-sdk/blob/ec4e0a49e61bac4f2285891d39414dfbafe93f58/LICENSE.md |
| Client license | https://github.com/Stremio/stremio-addon-client/blob/7c66830cfc1a8e749373d9df0bb105c7dad33bfd/LICENSE.md |

The SDK and official client are MIT. The SDK notice is **Copyright © 2019 SmartCode OOD**; any reused code or substantial documentation portions must retain its copyright, MIT permission notice, and disclaimer. This note paraphrases protocol findings, and the authored fixtures contain no copied implementation code. No `stremio-web` GPL implementation was read or copied for this task. Live manifests are minimized public protocol observations, not copied addon source or an assertion of the remote service's content license.

Context7 was used as a secondary index at `/stremio/stremio-addon-sdk`, then checked against the actual official files. Its synthesized subtitle answer incorrectly inferred POST; `src/getRouter.js` explicitly uses **GET**. Treat original files and observed responses as authoritative.

## Protocol findings

1. **Types are external identifiers.** Official type docs list `movie`, `series`, `channel`, and `tv`, but the SDK linter only requires an array, and real manifests include `anime`, `other`, `Podcasts`, and `subtitles`. VANTARA can require bounded, nonempty strings with no control characters and encode path segments safely. Its own manga/anime/movie/series categories are a separate internal vocabulary. Unknown safe types should not make an otherwise usable subtitle addon invalid.

2. **Resource object rules override top-level rules.** A string resource inherits the manifest's `types` and `idPrefixes`. An object resource uses its own `types` and `idPrefixes`; its types need not be a subset of top-level types. Missing object `idPrefixes` means all IDs, even if the manifest has top-level prefixes. The official client treats **explicit `idPrefixes: []` as no IDs**, whereas omitted prefixes match all IDs. Preserve that distinction during normalization. Resource objects should have valid `types`; do not silently turn a malformed object into shorthand semantics.

3. **Catalog lookup is special.** Match the exact declared `catalogs` entry by `{type, id}`, independently of `idPrefixes`. The official SDK also derives catalog handlers from nonempty `catalogs`. The adapter must not dispatch arbitrary catalog IDs merely because a resource has the right type. Known `addon_catalog` discovery metadata can be retained with a capability limitation if VANTARA does not expose addon discovery; its presence must not invalidate Cinemeta.

4. **Extras are a query string in a path segment.** Use `/{resource}/{encodedType}/{encodedId}/{encodedExtra}.json`. The official client uses Node `querystring.encode`; extra values containing `&`, `/`, `+`, `=`, Unicode, or a colon must remain data. `URLSearchParams` encodes spaces as `+`, which the SDK querystring parser accepts; byte-for-byte SDK style uses `%20`. A configured prefix such as `/addon/{settings}/manifest.json` must become `/addon/{settings}/subtitles/...`, preserving every preceding path segment. Query parameters, if explicitly supported by VANTARA, need preservation and their own fixtures; the old official client itself assumes a URL ending literally in `/manifest.json`.

5. **Catalog extras drive browsing.** `extra[].name`, `isRequired`, `options`, and `optionsLimit` are meaningful. A required `search` catalog supports search but must not be fetched as an unfiltered home feed. Required genre/year/date parameters need a chosen value before dispatch. Respect supported `skip` for pagination. Cinemeta currently also carries legacy `extraSupported`/`extraRequired`; prefer `extra` when present and use the legacy form as a compatibility fallback. Live Cinemeta's `year` catalogs require `genre`, and its notification catalogs require ID lists.

6. **Configuration is a state.** Official fields are `behaviorHints.configurable` and `behaviorHints.configurationRequired`, plus optional `config` definitions. The unconfigured addon provides a configuration page, then users install the resulting configured manifest URL. The SDK removes both behavior hints from configured manifest responses. Keep the configured URL privately for future requests; show a hostname or a safe label. Do not expose settings-bearing path/query values in logs, diagnostics, exports, corpus records, or identity keys. Same host plus manifest ID can have multiple configurations: the current `origin|id` key collapses them; use a private opaque identity or digest with collision-safe configuration handling.

   `serveHTTP.js` creates a literal origin-root `/configure` route. `getRouter.js` creates resource/config-prefix routes but does not itself create a configuration page. A custom application can mount the service at a prefix and supply `/prefix/configure`; replacing a mounted `/prefix/manifest.json` suffix with `/configure` is a convention, not a universally verified route. Use known public setup URLs for curated providers, and avoid deriving a visible setup link from an arbitrary settings-bearing path. The SDK full resource notation and client `secondaryMatch` both require resource-object `types`; fallback to manifest types for an object without `types` is not official client behavior.

7. **`config_required` is an extension, not an official manifest flag.** The canonical SDK does not document a universal JSON error envelope. If a real response explicitly supplies a recognized `config_required` code, classify it as setup needed. Do not treat that body as a successful empty list, guess arbitrary credential syntax, or count it as a transient provider outage. This envelope is covered by an authored fixture and is **UNVERIFIED as a live response in this research**.

8. **Current subtitle requests use a video ID.** `defineSubtitlesHandler` specifies `id = videoId`, with optional extra `videoHash`, `videoSize` in bytes, and `filename`. Cinemeta movie video ID equals the IMDb ID; series IDs are `tt...:season:episode`. Preserve actual provider video IDs for other namespaces rather than rebuilding them from display text. No season/episode extra field is universally required by the official SDK; custom addons can define their own conventions. `protocol.md` contains conflicting older prose saying subtitle ID is a hash with `videoID` in extras, and a typo `/subtitle/` in an example. Prefer the current handler docs, plural `/subtitles/`, and live movie/episode endpoints. Do not silently apply a legacy hash route to all addons.

9. **Subtitle hints must survive stream normalization.** The stream's `behaviorHints.filename`, `videoHash`, and `videoSize` feed subtitle requests. VANTARA currently preserves filename but drops hash/size; a request helper cannot recover discarded data. A hash is the OpenSubtitles file hash, not the torrent info hash. Do not fabricate it, label filename-only matches as hash-exact, or invent missing season/episode identity. Providers may return `subtitleFileName`, `movieReleaseName`, or `fpsMilli` as observed OpenSubtitles extensions; preserve bounded advisory metadata and provider provenance without treating it as canonical exact-match proof.

10. **Subtitle response data is separate from rendering support.** Official fields are `id`, `url`, `lang`, and optional `label`. ISO 639-2 examples use `eng`/`ara`, but fallback language labels are permitted. Normalize language aliases separately from provider identity. The SDK permits SRT, VTT, ASS/SSA, and local streaming-server URLs; those are not all PWA-renderable. Keep loopback/local streaming URLs blocked in the remote adapter. Convert only formats supported by the actual VANTARA subtitle pipeline and report ASS styling limitations honestly.

11. **Valid stream objects are broader than direct playback.** Official variants include URL, `infoHash`/`fileIdx`, `ytId`, `externalUrl`, and newer archives/NZB variants. Preserve source-kind identity, then classify platform compatibility. Torrent, archive, Usenet, external-page, YouTube-player, and custom-header variants are not ordinary PWA video URLs. For URLs, `notWebReady` is an explicit compatibility hint, and `proxyHeaders` can contain both request and response headers. A response-header-only requirement also needs a proxy and must not be labeled direct play. Media3 support requires the real native integration and policy, not a broad `apk:true` inferred from manifest resource names. An HTTPS URL still needs codec/media validation; HLS needs supported playback and CORS; DASH support must reflect the current player.

12. **Empty success and failure are different.** `{subtitles: []}`, `{streams: []}`, and `{metas: []}` are successful resource responses. SDK missing handlers become 404; handler exceptions become 500 with `{err: 'handler error'}`. Live services may return HTML or plain text on failure. Keep transport/CORS, timeout, HTTP status, parse failure, schema mismatch, unsupported resource, setup/authentication, empty result, and unsupported playback distinct. Do not penalize an addon for a healthy result containing only unsupported torrent/header streams. Validate each stream entry before touching properties: the current `normalizeStreams` dereferences `s.infoHash` and crashes on `null` entries, discarding usable siblings.

## Inspected VANTARA gaps and recommendations

| Inspected file | Finding | Recommended boundary |
| --- | --- | --- |
| `apps/web/addons/manifest.js` | Whitelist rejects `tv`, `channel`, and real `subtitles` types; resource types must be subset of top types; `addon_catalog` rejected | Accept bounded external strings; resource-specific matching; preserve unsupported known extensions |
| `apps/web/addons/manifest.js` | Drops `behaviorHints`/`config`; derives key from origin and ID; converts absent prefixes to `[]` | Normalize setup metadata and opaque identity; preserve prefix presence semantics |
| `apps/web/addons/adapters/stremio.js` | Preserves configured path prefix, but object prefixes fall back to top prefixes; empty array treated unrestricted; catalog ID unchecked | Keep configured path behavior; use official matching rules and declared catalog lookup |
| `apps/web/addons/runtime.js` | Search selects `extra.search`; catalog-only metadata sources absent from source list; unknown types fall into cinema | Derive UI capabilities from catalog definitions and resource-specific types; subtitle-only stays in provider list |
| `apps/web/addons/runtime.js` | Empty/unplayable stream list becomes `RESOLVER_EMPTY` health failure | Separate result availability and platform support from transport/provider health |
| `apps/web/addons/streams.js` | Hash/size dropped; response-only proxy headers ignored; malformed entry can throw | Safe per-entry normalization; preserve hints; platform compatibility reasons |
| `apps/web/addons/subtitles.js` | Requires IMDb, maps anime to series, rebuilds episode video ID; only filename/hash/size from already-normalized stream | Support exact preserved IDs when provider rules allow; do not guess identities or falsely assert universal non-IMDb support |
| `apps/web/addons/native-runtime.js` | Subtitle resource missing prefixes falls back to top prefixes | Apply the same normalized resource semantics before passing provider descriptors to Kotlin |

## Curated public corpus: LIVE

All URLs below are public and contain no private configured settings. Manifest snapshots contain only selected structural facts. They are stored as `*.observed.json` in `research/`; headers/status/count observations are in `research/live-observations.json`.

| Addon | Manifest URL | Live result | Corpus role |
| --- | --- | --- | --- |
| Cinemeta | https://v3-cinemeta.strem.io/manifest.json | 200, CORS `*`, v3.0.14 | Official catalog/meta, `addon_catalog`, required/optional extras, legacy extras |
| OpenSubtitles v3 | https://opensubtitles-v3.strem.io/manifest.json | 200, CORS `*`, v1.0.0 | Official subtitle-only, top-level movie/series, IMDb prefix |
| SubDL | https://subdl.strem.top/manifest.json | 200, CORS `*`, v1.2.2 | Subtitle-only; external `subtitles` type; configuration required |
| SubSource | https://subsource.strem.top/manifest.json | 200, CORS `*`, v1.4.2 | Subtitle-only; external `subtitles` type; configuration required |
| Subs.ro | https://cdcd7719a6b3-stremio-subs-ro.baby-beamup.club/manifest.json | 200, CORS `*`, v2.3.2 | Top-level `types:[subtitles]`, resource movie/series, `tt`/`tmdb:` prefixes |
| Official static example | https://stremio.github.io/stremio-static-addon-example/manifest.json | 200, CORS `*`, v0.0.1 | Mounted path, custom `BigBuckBunny` ID, HTTP stream limitation |

SubDL, SubSource, and Subs.ro were discovered from the real official community catalog, then their own manifests were fetched: https://v3-cinemeta.strem.io/addon_catalog/all/community.json . The catalog's cached versions differed from the direct live manifests; do not substitute directory snapshots for installed manifest inspection.

| Public request | Live result |
| --- | --- |
| https://v3-cinemeta.strem.io/meta/movie/tt1254207.json | 200; Big Buck Bunny identity matched |
| https://v3-cinemeta.strem.io/meta/series/tt3107288.json | 200; The Flash identity matched; episode records available |
| https://v3-cinemeta.strem.io/catalog/movie/top/search=Big%20Buck%20Bunny.json | 200; 6 metas |
| https://opensubtitles-v3.strem.io/subtitles/movie/tt1254207.json | 200; 2 subtitle records |
| https://opensubtitles-v3.strem.io/subtitles/series/tt3107288%3A1%3A1.json | 200; 97 subtitle records; metadata only, no subtitle files downloaded |
| https://opensubtitles-v3.strem.io/subtitles/movie/tt1254207/filename=big_buck_bunny.mp4.json | 200; 2 subtitle records; extra route accepted, hash matching not proved |
| https://subdl.strem.top/subtitles/movie/tt1254207.json | 404 text response at unconfigured URL |
| https://subsource.strem.top/subtitles/movie/tt1254207.json | 404 text response at unconfigured URL |
| https://stremio.github.io/stremio-static-addon-example/catalog/movie/BigBuckBunnyCatalog.json | 200; custom ID `BigBuckBunny` |
| https://stremio.github.io/stremio-static-addon-example/stream/movie/BigBuckBunny.json | 200; 1 HTTP URL; incompatible with HTTPS-only PWA policy; media not fetched |

The static example returned 404 when first queried with IMDb ID `tt1254207`; its actual catalog ID is `BigBuckBunny`. This is useful evidence for preserving exact provider IDs. Its published URL is documented at https://github.com/Stremio/stremio-static-addon-example/blob/master/README.md . No code from that repository is copied; its GitHub license metadata was absent.

Initial Python `urllib` requests to several addon endpoints returned 403, while subsequent curl requests returned 200. Both outcomes are recorded with transport labels. This is a tool/request difference, not proof of a browser failure or provider downtime. CORS headers on individual responses are observed, but actual browser-origin behavior and playback remain separate verification.

## FIXTURE and UNVERIFIED boundaries

`research/authored-compatibility-fixtures.json` contains **authored deterministic fixtures**, not live addon results: resource overrides; missing vs empty prefixes; custom types; required search; unknown resources; special-character extras; public placeholder configured prefix; `config_required`; empty results; header-only incompatibility; torrent/YouTube/external streams; malformed siblings. Its `example.com` URLs and placeholder hashes are not live corpus endpoints and must not be fetched.

**UNVERIFIED:** configured subtitle retrieval for SubDL/SubSource/Subs.ro; live `config_required` JSON; hash-specific subtitle matching; actual subtitle file rendering; media direct play; native header playback; torrent/Usenet/archive engines; IPFS/legacy transport; unknown resource implementation. Do not claim these are supported because manifest parsing succeeds.

The six `*-response.observed.json` files pin selected actual response fields, original counts, source/date, and sanitization. Subtitle download URLs are replaced with inert `example.com` placeholders and explicitly recorded as rewrites; only their original public origins remain. Metadata/catalog lists retain at most two actual items with identity and short display fields. The static example retains its exact public HTTP Big Buck Bunny URL and was not played. `subdl-unconfigured-error.observed.json` records the actual plain-text 404 at an unconfigured route. `apps/web/addons/adapters/stremio-conformance.test.js` consumes these captures without network access and tests identity preservation, subtitle advisory fields, unsupported HTTP playback, and the manifest configuration gate. It does not claim fixture URL playback or configured-addon success.

Task 1 implementation uses `apps/web/addons/stremio-model.js` for bounded external identifiers, resource rules, catalog extras, configuration state, and safe structured errors. Unknown resources remain diagnostic data. Regression tests were observed failing before production edits; the new response-capture conformance tests additionally pin previously compatible behaviors. Explicit `[]` prefixes remain match-none, and an explicit empty-string prefix `['']` retains the client's match-all meaning. Prerelease plus build version identifiers are accepted together.

Additional public repository identities checked were https://github.com/Kobicohenn1/stremio-subdl-addon and https://github.com/superadlen/stremio-subsource-addon . Neither had a GitHub-recognized license, neither supplied a verified hosted endpoint, and they are **not** assumed to be the source of the `strem.top` services. They are excluded from implementation reuse and the live endpoint corpus.

Recommended verification order: deterministic adapter fixtures first, opt-in public manifest/meta/subtitle probes second, then explicit player/native integration checks using approved playable material. Live service checks should be bounded and should not be mandatory for a reproducible unit-test suite.
