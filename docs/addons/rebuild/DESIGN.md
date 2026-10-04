# VANTARA Addon Fabric rebuild

## Intent and boundaries
Implement the user's October 4 brief in the existing data-only Addon Fabric. Keep the fixed puzzle sidebar entry, existing section themes, Arabic RTL, native transport and all original source engines. No changes to Kotlin, Media3, playback selection, THE ROCK, manga reader, accounts or library schemas. No remote code execution, provider iframe, copying GPL code, or new framework.

## Audit
The manager is a stack of generic buttons and technical red text rather than a library. The installation form accepts only URLs; filters can conceal a successful install. Exact repeated installation is treated as a destructive replacement and blocked by any source/playback snapshot, although nothing changed. Public Cinemeta and subtitle-only/configurable manifests demonstrate genuine whitelist and resource-prefix conformance bugs. Stremio raw and VANTARA internal assumptions are mixed. Source Mode lacks explicit required catalog filters. Native external providers support subtitles only; this limitation must remain visible rather than pretending video extensions work on APK.

Fresh Chromium screenshots and a live OpenSubtitles reproduction are under screenshots/. BrowserAct has no API key/browser in this environment; local Chromium runs the actual shell and components in an isolated store. No production account state is written.

## UX
One addon hub, independent of the active content section. A restrained gradient/puzzle header, two library tabs (Explore/My addons), content filters, search, responsive cards with logo/fallback, name, description, type/language chips, honest health and primary Install/Open/Configure action. Source Mode keeps the same visual identity with catalog tabs and supported catalog filters. Empty states offer a next action.

Import opens a compact inline area with Link / JSON / File tabs. URL preview fetches a real manifest; JSON/file import understands one manifest, URL entry, array or addons bundle. Each entry has an individually selectable preview. Invalid entries remain visible with plain-language errors; unresolved raw manifests require an explicit service URL, never an invented endpoint. Cancel aborts old previews; disabled pending actions prevent duplicate mutations. Installation confirms results and reveals them regardless of the previous filter. Exact repeats are successful no-ops.

Details expose enable/disable, update staging, activation, rollback, permissions and advanced diagnostics. Configurable Stremio providers open their own HTTPS setup page in a new tab; the user returns with a configured URL. No provider iframe or secret-bearing configured URL is rendered. Default discovery is a small source-linked list of actual services, not fake addons or a claim that the entire community catalog is certified.

## Architecture
1. Raw Stremio manifest stays data and retains external resource/type/catalog semantics.
2. A focused Stremio model maps supported resource capabilities and VANTARA section categories without narrowing raw types to VANTARA's four types. Unknown resources are retained for diagnosis, never executed.
3. Adapter validates resource dispatch, exact catalog declarations/required extras, bounds responses and translates known response objects to the existing internal contracts.
4. Import parser handles bounded JSON data only; registry owns all trusted previews and validates again at installation. Full endpoint plus canonical manifest equality defines an exact repeat. Genuine replacement/update remains session guarded.
5. Runtime retains existing cache epochs and provider health. Configuration-required providers are installed but not used until configured; failures in one provider do not become playback dependencies. Diagnostics probe only declared and addressable resources; no fabricated evidence for stream/subtitle capability without a matching identity.

## Health language
Candidate = no complete recent functional evidence. Stable = every supported functional capability has successful current-version/runtime evidence, with no unresolved failing capability. Broken = actual failed/cooling capability, scoped and explained. Config required/disabled/unsupported are separate states, not network failure. Installing or fetching a manifest does not prove playback. Cached content and manifest declarations never count as a new live health test.

## Acceptance
URL, JSON text, single/multiple JSON file all run through the same preview and registry; partial invalid bundles do not prevent valid selections. Unsafe URLs, oversized inputs and malformed nested data fail safely. Real corpus pins Cinemeta, OpenSubtitles, SubDL, SubSource and Subs.ro protocol shapes; live public requests are recorded separately with date and limitations. Progressive streams and subtitle playback isolation remain covered by existing tests. Desktop/mobile real component screenshots and interaction assertions cover cards, previews, details, Source Mode and errors. Actual phone, configured paid/key providers, arbitrary third-party E2E and unsupported runtime capabilities are explicitly UNVERIFIED.
