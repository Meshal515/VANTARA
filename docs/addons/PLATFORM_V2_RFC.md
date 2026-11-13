# VANTARA Add-on Platform v2 — engineering RFC (first slice)

**Status:** Architecture proposal + independently runnable starter kit on this branch. **Not a shipped, complete cross-platform runtime.** Do not merge or publish a Stable build without approval. Existing `addons.v1`, native extensions, libraries, settings, and reading/watching progress must remain intact.

## Goal: one authoring experience, multiple runtimes

The creator should choose **Video, Manga, Subtitles, Metadata, Torrent, or Mixed**, write the minimum logic once, and get the manifest, source capability declarations, icons, smoke tests, logs, and a publishable package. A 100% compatibility claim is invalid without real source-by-source, OS-by-OS evidence.

An addon is not a repository, a catalog is not a stream, and **installed is not working**. Track (1) registered/installed, (2) available capabilities on this platform, and (3) independently observed functionality.

### Proposed central model (normalized after adapters, never instead of native formats)

```text
                     VANTARA Addon Registry
       identity + provenance + permissions + health + state
                                 |
                 capability router / content identity
        +------------+-----------+-----------+------------+
        |            |           |           |            |
   manga reader   anime feed   cinema   stream/tor.    subtitles
        |            |           |           |            |
        +-------- VANTARA native API facade -------------+
                                |
          isolated source runtimes / HTTP adapters
                                |
       Source health · human verification · image resolver
```

### Import/runtime matrix

| Ecosystem | Registry/import | Execute source | Android | Windows | PWA |
| --- | --- | --- | --- | --- | --- |
| Stremio `manifest.json` | Parse canonical HTTP protocol | Call declared `catalog/meta/stream/subtitles` resources, preserving configured URLs and matching filters | Use actual native bridges, verify per resource | HTTP runtime with safety/CORS constraints | HTTPS+CORS and browser playback constraints |
| VANTARA Remote v1 | Already implemented, data-only JSON | Existing `apps/web/addons/` registry & transport | Not all capabilities are bridged; must not lie | Existing remote runtime | Existing remote runtime |
| Mihon / Tachiyomi APK | Signed `index.min.json` and installed APK | Native JVM/Android code and source engine | Supported portions via native extension engine | **Not executable as APK** | **Not executable as APK** |
| Aniyomi APK | Signed source repo / APK | Native Android anime and cinema engine | Supported portions, verify catalog→episode→stream | **Not executable as APK** | **Not executable as APK** |
| CloudStream `.cs3` | `repo.json` → `pluginLists` → `plugins.json` → signed/hashed package | Requires a separate JVM API compatibility layer and source/extractor runtime | **Not yet implemented** | Separate runtime/adapter required | **Not executable in browser**; optional compliant remote adapter only |
| VANTARA SDK add-on | Guided manifest/CLI/Studio | HTTP resource service or future sandboxed native capability | via deployed HTTP bridge where implemented | HTTP | HTTP |

A repo can be indexed without its packages being runnable. Never show **Ready**, **Works**, or a functional Open button based on a manifest alone.

## Two ways to write a VANTARA add-on

**1. Simple (no code):** future Add-on Studio UI — choose a source type, origin and icon, map JSON fields (or approved selectors for static *public* sites), preview real data, test endpoint permissions, click Export. No claim that an arbitrary Cloudflare-protected site works without server-side code and permission.

**2. Developer (minimal code):** generator `node tools/create-vantara-addon.mjs --kind video|manga --name "..." --dir ... --origin https://...`. Output one `manifest.json`, one `index.mjs`, one package file, README. Follow-on SDK will expose `defineAddon({ search, details, episodes, streams, chapters, pages, subtitles })` with typed contracts and capability-specific tests. For video, preserve **Stremio protocol** as a first-class option instead of creating an incompatible substitute. The CLI starter currently returns demonstration metadata and empty resources; **it is not a playback source**.

### Registry & permissions

- Provenance: pinned manifest origin, package hash/signing identity where applicable, verified author only with trusted signing, scoped storage namespace, no writable cross-addon data.
- Explicit capabilities: `catalog/search/details/episodes/streams/subtitles/chapters/pages/metadata/torrent` + declared content types. No implicit privileges because an app icon or repository name looks official.
- HTTPS allowlist, per-domain rate limits, timeouts, cancellation, bounded resource size, bounded concurrency, redacted credentials, no arbitrary redirects to private IP, no raw code eval in web apps.
- Additional rights (verified media headers, cookies, interactive web verification, torrents, local files) are platform-specific and explicitly gated.
- Native runnable plugins need isolation and signature verification; prefer subprocesses/workers where technically viable and do not reuse browser auth cookies.

### Source health vs install status

Keep the immutable install flag separate from evidence and sample real functional paths:

- `unknown`: not checked
- `ready`: appropriate catalog/search, details, episodes/chapters, and reachable stream/image *as applicable* succeed
- `partial`: e.g. search works, video extraction fails
- `needs_verification`: confirmed human challenge with user-initiated embedded browser
- `down`: repeated verified failures
- `unsupported`: package format/runtime capability unavailable on this platform
- `cooldown`: rate limit, never hammer or aggressively retry

Every result includes `lastCheckedAt`, scope/capability, sanitized cause, and status confidence. No automatic deletion when a source breaks.

### Source-to-VANTARA UX contract

```text
Add repo or manifest → inspect provenance and format → preview true capabilities
→ explicit install → optional config/auth → functional probe
→ Open in VANTARA (browse from that source) → work → episode/chapter
→ permitted playback/read path → resume progress
```

For anime/cinema playback show all eligible alternatives together: direct HTTP/HLS/DASH, torrent/magnet adapter, external streaming provider, and independently discovered subtitles. Select quality from factual metadata only. Avoid fallthrough that claims "4K" from an unknown source.

Manga: respect `search/home/details/chapters/pages` contracts, chapter IDs, page order, protected pages, cookies only when consented, optional RTL/LTR/Webtoon scrolling, prefetch and offline save of lawfully accessible resources. External IDs only for safe cross-source matching. Preserve progress by source+work+chapter stable identity and explicit migration tables, not title matching.

### Publishing and support ergonomics

- Repo shortcode and paste URL → autodetect `repo.json`, `index.min.json`, `manifest.json`, or native VANTARA manifest.
- Show *Detected: CloudStream but .cs3 runtime missing* rather than returning generic "invalid repository."
- Add-on profile: real icon, author, capabilities, permissions, version, compatible devices, health, diagnostics, updates, download size and trusted origin.
- Copyable **diagnostics pack** (private tokens redacted), built-in test explorer, source-specific screenshots and source profile — no global spam toasts on app startup.
- `create` / `dev` / `test` / `pack` / `publish` CLI; first slice delivers `create` and working local Node preview. Deploy/publish API and no-code Studio are **not implemented**.

### Built-in source extraction and rights

This RFC defines the add-on platform. The **eventual extraction of every built-in anime, cinema and manga source** is specified in [the source-transition plan](../SOURCES_TRANSITION.md); do not interpret this document as an instruction to keep manga providers embedded permanently. The **16 existing stable manga sources are the last migration milestone**, with a required parity/backup/rollback gate. Their intended private distribution must not leak source code, tokens, or packages through the public VANTARA repository or public CI artifacts; do not assume that private access grants copyright redistribution rights. Until ownership and license checks are complete, keep them in their current stable form.

The repo remains **one GitHub project, VANTARA**. External plugin repositories are imported as user-provided sources; this work does not require hosting a VANTARA-specific public add-on catalog. Choice of VANTARA's open-source license (including a possible AGPL-3.0 license) requires a deliberate owner decision and LICENSE file rather than assumptions in an RFC.

### Delivery milestones and release gates

1. **Platform diagnostics (P0):** inventory all saved sources and formats without mutating state. Restore installer/back navigation/Cloudflare explicit interaction; zero Android crashes.
2. **Actual adapter parity (P1):** Stremio request/response contract tests, Android remote implementation, correct image extraction, real source navigation; unique provenance and safe migrations.
3. **Manga parity (P2):** Mihon native integration end-to-end; canonical chapters/pages + reader; Android tested. Windows/PWA use a *separate* remote runtime rather than pretend to execute APK.
4. **CloudStream (P2):** independent clean-room JVM compatibility design; plugin classloader/extractors; sample `AnimeRift`, `AnimeWitcher`, `Witanime` as gates (when licensed and permitted). Do not copy CloudStream GPL implementation into VANTARA without documented license compatibility and distribution obligations, regardless of VANTARA's eventual license.
5. **Addon SDK/Studio (P3):** one-click templates, in-app builder, validation, local testing, manifests and error explorer.
6. **Source quality (P3):** per-capability health, long-running playback seek tests, metadata fidelity, source failover, import/export/backup.

Each platform/runtime pair needs real observable fixture tests, real-device smoke tests for native systems, a rollback and snapshot restoration test, and owner sign-off before Stable publication. Explicitly identify test evidence and missing coverage.

**References:** `docs/addons/CONTRACTS.md`, `apps/web/addons/registry.js`, `apps/web/addons/assessment.js`, `apps/web/lib/source-verification.js`. External: Stremio protocol/SDK, Mihon third-party APK source documentation, CloudStream GPL and independent source format.
