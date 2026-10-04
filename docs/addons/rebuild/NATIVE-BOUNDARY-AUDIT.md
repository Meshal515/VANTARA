# Add-on native boundary audit

Audit baseline: GitHub main `9794e5b`, inspected in `/workspace/VANTARA-pr141`. Read-only source investigation; this report is the only authored file. Native Kotlin, Media3, Aniyomi, source engines and THE ROCK are outside the proposed rebuild.

## Verified install failure

`apps/web/addons/registry.js:124` throws `انتظر انتهاء الجلسة قبل استبدال نسخة الإضافة` whenever the manifest key already exists and **any** registry snapshot is retained. It does not compare endpoints, versions or manifest content. This proves an existing registry entry and a retained snapshot; it does not prove OpenSubtitles is broken, an active player, or a leaked snapshot.

Keys combine HTTPS origin and manifest ID. Two configured paths/query strings on the same host with the same ID therefore collide deliberately. An installed subtitle provider declaring `movie`/`series` is hidden by the anime content filter (`apps/web/v35/addons-view.js`, `paint`); its absence from that view does not imply it is uninstalled.

An independent Node script using the actual registry and a cloned in-memory store reproduced all three behaviors with an OpenSubtitles-shaped manifest:

1. Install succeeds and `list({content:'anime'})` returns no entry.
2. Acquire `registry.snapshot()`, inspect the identical endpoint again, and install: the exact Arabic error is thrown.
3. Release the snapshot and install the identical endpoint/manifest: `cacheEpoch` changes and a previously disabled entry becomes enabled.

Existing tests passed with `./node_modules/.bin/vitest run apps/web/addons/registry.test.js apps/web/addons/native-transport.test.js`: 2 files, 11 tests. These tests do not currently assert repeat-install identity preservation. A prior `pnpm exec` attempt aborted its automatic dependency check before running tests; no dependency installation was authorized or completed by this audit.

## Snapshot ownership and warm lifecycle

| Owner | Acquisition | Release and interpretation |
| --- | --- | --- |
| PWA anime bridge | Every `prepare`, including core-only copies (`pwa/bridges/anime.js:401`) | Only `closeSession` releases (`:450`). Preparation completion does not release: a prepared session can legitimately remain reusable or player-owned. |
| Add-on source browsing, either platform | `v35/shell.js:3578` | `closeAddonSource` releases. Opening the manager calls it before loading. Main-page navigation and shell destruction call it too. Work navigation pauses/retains the source view for back navigation. |
| APK Kotlin anime/player preparation | Kotlin `AnimeEngine.prepare`, warm sessions, player sessions | Does **not** call the JavaScript add-on registry snapshot. Native player activity alone cannot increment this counter. |
| APK subtitle launch | JavaScript exports provider descriptors, Kotlin copies them into player launch state | No JavaScript registry snapshot. Kotlin discovery retains its launch descriptors independently. |

Two concrete PWA lifecycle problems exist in the cinema warm path:

- **Cancellation race:** `dropWarm` closes only the assigned `w.session` (`v35/cinema.js:807`). During `await engine.prepare(...)`, that field is null. If warmth is dropped during the await, the bridge can still create a session/snapshot; when its result arrives, `if(w.closed)return` (`:877`) discards the session without closing it. Reproduce with a deferred preparation: start warmth A, replace/drop A before resolving preparation, resolve A with a created session, and observe no `closeSession(A)` call. The anime server sheet handles the analogous race by closing the returned session (`v35/anime.js:1490`).
- **Warm navigation retention:** the eight-minute TTL is checked only when calling `warmUp` again (`v35/cinema.js:814`), with no expiry timer. Cinema exposes no `leaveDetail` cleanup; `shell.showPage` calls `anime.leaveDetail`, but no equivalent cinema hook. Open a cinema work, let warm preparation complete, navigate directly to the add-on manager: its PWA snapshot can remain retained. Keeping a warm session while still on its work is valid; retaining it indefinitely after navigation/TTL conflicts with the source comment promising closure on leaving/expiry.

The user's specific phone failure has **not** been reproduced on a physical phone. Platform, retained session owner, exact configured endpoint and installed raw manifest remain unverified. The screenshot/message alone cannot identify which lifecycle path occurred. Record those facts before claiming a phone leak or an APK fix. A successful no-op reinstall would resolve the duplicate symptom without proving all lifecycle owners are correct.

## Minimal safe repeat-install policy

After registry readiness and trusted preview lookup, compare the existing record **before** checking the session replacement guard:

- Endpoint equality must retain configured path and query. Normalize through the URL parser and `stremio://` to HTTPS; ignore fragments consistently because fragments are not sent over the network. Do not equate URLs by origin or manifest ID alone, and do not display credential-bearing paths/queries.
- Compare complete parsed raw JSON using a deterministic structural comparison that ignores object property order but preserves array order and values. Compare the validated normalized manifest as an additional consistency check. Equality of normalized fields alone is unsafe: normalization drops unknown configuration/behavior fields. Same version alone is also insufficient.
- For an identical endpoint and manifest, consume the successful preview and return the existing view. Do not save, replace the row, reset health, rotate `cacheEpoch`, re-enable it, change installation time, alter pins, clear staged/previous data, or release anyone else's snapshot.
- Different endpoint/configuration, raw manifest, normalized manifest or version remains a replacement and must keep the existing active-session guard. Explicit enable/update/rollback continue to own those state changes.

Tests should cover disabled/pinned/failed-health/staged/previous preservation; nested raw-object key reordering; changed endpoint query/path with the same ID/version; changed raw fields that normalization omits; changed version; multiple snapshots; replacement only after every snapshot releases. Do not clear snapshots just to make installation pass. Existing snapshots contain cloned listing metadata, not adapters pinned to an immutable registry connection, so removing the replacement guard would not establish safe session isolation.

## Ingestion and supported runtime boundary

The current input accepts one HTTPS manifest URL or a `stremio://` equivalent. JSON text, files and bundles need a shared **data-only** ingestion layer producing the same trusted `{manifestUrl, rawManifest, validatedManifest}` record before installation. Keep transport selection outside format parsing: PWA network reads use `createTransport`; APK reads use `createNativeTransport` and Kotlin `AddonEngine.request/cancel`, without browser fallback.

| Input/resource | PWA | APK today |
| --- | --- | --- |
| HTTPS/Stremio manifest link | Bounded GET, no cookies/auth/redirects; browser CORS applies | Native bounded GET, public-address DNS validation, no cookies/auth/redirects; no browser CORS |
| Stremio catalog/meta | Existing JavaScript adapter and source view | No supported external source browsing/playback integration |
| Stremio streams | Direct HTTPS MP4/HLS paths; torrent, external-player, request-header streams unsupported; source wrapper excludes DASH | External stream copies explicitly excluded on Android by `lib/anime-engine.js:withAddonCopies` |
| Stremio subtitles | Existing discovery/file fetch with confirmed media identity | Existing Kotlin standalone provider discovery and user-selected SRT/VTT file loading in Media3 |
| VANTARA Remote v1 | Existing capability/resource adapter; interactive verification unsupported | Manifest compatibility remains false; no Kotlin Remote v1 provider protocol |
| Pasted JSON/file/bundle | New parsing can reuse existing adapters after endpoint resolution/validation | Same parsing can coexist with native transport, but cannot grant additional native resource capabilities |

For a Stremio JSON/file manifest, require an explicit public HTTPS `manifestUrl`: its resource base cannot be inferred from the file location, ID, logo or arbitrary website link. For Remote v1, retain the existing validated same-origin `baseUrl` contract and define endpoint provenance explicitly. A file/blob/content URI is import input, never a remote resource endpoint. Bundle entries must each carry their own endpoint/raw manifest, validate independently under shared size/count limits, deduplicate/configuration-check against the registry, and preview all results before commit. Avoid importing executable JavaScript/APKs or replacing core adapters through this path. Local formats can parse offline but remote resources still need network access.

## Interface risks to retain or expose

- Capability compatibility must remain per runtime and resource. `compatibility.apk=true` currently means the Stremio manifest contains subtitles; it does not mean its catalog/meta/streams are native-supported. The manager currently blocks external source opening on APK; preserve that boundary.
- Native provider descriptors are `{key,name,manifestUrl,types,idPrefixes}`. Kotlin discovery requires the endpoint path to end exactly `/manifest.json`; the web adapter also accepts a trailing slash. Imported endpoints must report/normalize that restriction explicitly.
- Native descriptors currently use the **first** `subtitles` resource's rules, while the web adapter considers every matching resource. A manifest with multiple differently scoped subtitle resources can work on PWA and lose native coverage. Do not promise identical capability coverage without a deliberate rule representation change.
- Native subtitles require confirmed IMDb identity; series additionally require season and an integer episode. Missing identity can correctly produce no translations even after successful install. Neither manifest install nor catalog health establishes subtitle availability.
- APK subtitle discovery bypasses the JavaScript adapter's success/failure health callbacks. The manager cannot currently infer native subtitle health from a successful Kotlin result. Do not fabricate a healthy native badge from installation; a real feedback interface would be separate work.
- The public preview manifest is currently trusted at install time although the WeakMap retains only URL/raw. New import entry points should validate or retain an immutable trusted normalized record internally, rather than allowing mutable preview objects to define executable capabilities.

Recommended rebuild seam: shared import/preview/identity policy and manager UI; retain current PWA adapters, native transport, native subtitle descriptor contract, and all native source/player ownership. Treat warm lifecycle fixes as narrowly justified snapshot cleanup work with focused reproduction, not a reason to redesign native playback.
