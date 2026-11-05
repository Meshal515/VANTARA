# VANTARA — Full Engine Dependency and Compatibility Audit (31 Oct 2026)
**Status: READ-ONLY CODE REVIEW + reproducible JS failure; NOT a full live-device certification.**
**Target:** `Meshal515/VANTARA` commit `a982611869532709cbc343c3332f8e06a310d0d5`, branch `claude/supernatural-addons`. Published signed Debug reference: `938b5061`. Do not modify `main`, `Stable`, user libraries/progress, or publish a new Debug without owner approval.

## Scope and methodology
- The complete source snapshot contained **1,902 repository files**; **1,519 code/config text files (245,620 lines)** were automatically indexed across the repo.
- **768 distinct text/code/config/docs/test files (path-defined engine scope)** were classified into the [machine-readable per-file manifest](./engine-file-manifest-2026-10-31.json). This is a **scope map, not a claim that 768 files were manually semantic-reviewed**.
- Within that scope: **626 source-code files**, approximately **77,823 lines**; combined scope **102,235 lines**. Counts include overlaps resolved by unique path.
- Scanned 1,285 JS/TS relative import relationships; upstream closure from extension, source-home, and media entry points contains 130 files/21,851 lines. Scanned Kotlin/Java text symbols in 302 source+test files (35,170 lines).
- Reached the relevant implementation paths: JS/Capacitor bridge → Android anime session → Stremio stream delivery; native APK install → verified vault/loader → source registry → manga reader; CloudStream optional Debug worker and CI; Aniyomi APK loading/identity; source entitlement and UI.
- **No Android SDK/JDK/Gradle/Git or emulator was available in the code-inspection environment**. Existing CI results were checked separately. Do not interpret current source review as a passed device test.

## End-to-end dependency paths
1. **Anime/films:** `apps/web/v35/anime.js` / `cinema.js` → `apps/web/lib/anime-engine.js` → `apps/web/addons/native-preparation.js` → Capacitor `AnimeEnginePlugin.kt` → `AnimeEngine.kt` → `Prepared.kt` → Candidate/Routes → Player. With Stremio, the web registry/adapter/transport fetch streams and Android receives `appendAddonStreams`. With CloudStream, the optional `VantaraRuntime` worker supplies source operations.
2. **Manga:** `apps/web/lib/extension-engine.js` → `ExtensionEnginePlugin.kt` → RepoIndex/RepoClient → `UserExtensions.kt` → `FileExtensionLoader.kt` + Tachiyomi stubs → CatalogueSource → pages/reader.
3. **Aniyomi:** Android `AnimeEnginePlugin.kt` repo/install methods → `UserAnime.kt` → `AnimeExtensionLoader.kt` → `AnimeEngine.kt` manifest/adapter → episodes/streams.
4. **Build separation:** `android/settings.gradle` + `android/app/build.gradle` gate optional `extensions/runtime-android` integration through `vantaraRuntimeDebug`; only special Debug workflow signs/publishes it.

## Findings (evidence-based)
### F01 — P0 — Stremio bridge delivery failure can leave pending addon batches
- JS `native-preparation.js` lines 45–54: per-provider `Promise.all` resolves only when `appendAddonStreams` resolves, without a fallback settlement on bridge rejection. [`native-preparation.js` L45–54](https://github.com/Meshal515/VANTARA/blob/a982611869532709cbc343c3332f8e06a310d0d5/apps/web/addons/native-preparation.js#L45-L54)
- Kotlin `Prepared.kt` lines 176–191 reserves/claims batches; `AnimeEngine.kt` lines 492–529 calls `finish` only after entering the dispatch coroutine. [`Prepared.kt` L176–191](https://github.com/Meshal515/VANTARA/blob/a982611869532709cbc343c3332f8e06a310d0d5/android/app/src/main/kotlin/com/vantara/anime/stream/Prepared.kt#L176-L191) / [`AnimeEngine.kt` L492–530](https://github.com/Meshal515/VANTARA/blob/a982611869532709cbc343c3332f8e06a310d0d5/android/app/src/main/kotlin/com/vantara/anime/AnimeEngine.kt#L492-L530)
- **Reproduced in Node**: controlled mock `appendAddonStreams` rejection causes `plan.start().done` to reject. `anime-engine.js` line 69 then suppresses the error, leaving no independent settlement path.
- **Required fix:** idempotent native `finishAddonBatch(session,sourceId,generation,reason)` or guaranteed deadline drain; do not release a batch twice; results from working siblings must survive. Test bad bridge, cancel, all-fail, duplicate, late-success.

### F02 — P0 — No end-to-end prepare deadline across readiness and bridge
- `runtime.ready` + `configure` + `plugin.prepare` are awaited in series; native JS plan uses `Promise.all`, no unified deadline covering all layers. [`anime-engine.js` L381–405](https://github.com/Meshal515/VANTARA/blob/a982611869532709cbc343c3332f8e06a310d0d5/apps/web/lib/anime-engine.js#L381-L405)
- The Stremio HTTP adapter *does* have request timeouts; do **not** misstate that individual transport calls are unbounded. But arbitrary promise/bridge stalls are not covered by a session-level watchdog.
- Controlled unresolved provider promise remained pending at 100ms (a constructed behavior test, **not proof that the production Stremio adapter hangs**).
- **Required fix:** bounded readiness, transport and native session lifecycle; terminal `done` even when JS disappears; trace id per session/source/stage.

### F03 — P0 — Aniyomi APK update invalidates working local copy before validating new version
- [`AnimeExtensionLoader.kt` L56–99](https://github.com/Meshal515/VANTARA/blob/a982611869532709cbc343c3332f8e06a310d0d5/android/app/src/main/kotlin/com/vantara/anime/loader/AnimeExtensionLoader.kt#L56-L99) deletes `anime-extensions/<pkg>.apk`, writes new bytes, then checks APK metadata, library version, classes and source construction. If latter fails, previous known-good APK is already gone.
- `AnimeEnginePlugin.installExtension` invokes `loader.load` before writing new `UserAnimeExtension`; storage metadata may still point at old hash now absent. [`AnimeEnginePlugin.kt` L390–414](https://github.com/Meshal515/VANTARA/blob/a982611869532709cbc343c3332f8e06a310d0d5/android/app/src/main/kotlin/com/vantara/anime/bridge/AnimeEnginePlugin.kt#L390-L414)
- **Fix:** content-addressed vault like manga: stage new blob, validate, preserve LKG, commit metadata, activate, rollback on any failure; crash/restart injection tests.

### F04 — P1 — Both installed extension-state stores use unsafe rename fallback
- [`UserExtensions.kt` L288–301](https://github.com/Meshal515/VANTARA/blob/a982611869532709cbc343c3332f8e06a310d0d5/android/app/src/main/kotlin/com/vantara/plugins/UserExtensions.kt#L288-L301) and [`UserAnime.kt` L42–55](https://github.com/Meshal515/VANTARA/blob/a982611869532709cbc343c3332f8e06a310d0d5/android/app/src/main/kotlin/com/vantara/anime/registry/UserAnime.kt#L42-L55): if `tmp.renameTo(file)` fails, delete prior `file` and retry; retry result ignored, in-memory state advances even if persistence fails.
- Both constructors use `runCatching(readText/parse).getOrDefault(empty)`, conflating missing-first-install with unreadable/corrupt-existing state.
- **Fix:** `AtomicFile` with preserved backup and explicit distinguish absent/corrupt; never acknowledge mutation on failed commit. Fault-injection tests for write, fsync, rename, restart.

### F05 — P1 — Aniyomi source identity can collide and multi-source packages are not fully exposed
- [`UserAnime.kt` L14–36](https://github.com/Meshal515/VANTARA/blob/a982611869532709cbc343c3332f8e06a310d0d5/android/app/src/main/kotlin/com/vantara/anime/registry/UserAnime.kt#L14-L36) computes source `id = 'user-' + pkg.substringAfterLast('.')`. Two distinct packages with identical last segment yield the same id. **Real collision occurrence unverified**, construction flaw clear.
- [`AnimeExtensionLoader.kt` L85–99](https://github.com/Meshal515/VANTARA/blob/a982611869532709cbc343c3332f8e06a310d0d5/android/app/src/main/kotlin/com/vantara/anime/loader/AnimeExtensionLoader.kt#L85-L99) instantiates potentially multiple sources but selects **one** `AnimeCatalogueSource`. Install path selects one `visibleSources(ext).firstOrNull()` in [`AnimeEnginePlugin.kt` L399–409](https://github.com/Meshal515/VANTARA/blob/a982611869532709cbc343c3332f8e06a310d0d5/android/app/src/main/kotlin/com/vantara/anime/bridge/AnimeEnginePlugin.kt#L399-L409).
- **Fix:** stable package-qualified **source-specific IDs**; enumerate/register *all* supported sources; migrate old ids, history, library and progress transactionally. Never replace by display name.

### F06 — P1 — Mihon/Keiyoushi loading has upstream ABI/class-loader divergence
- [`FileExtensionLoader.kt` L193–213](https://github.com/Meshal515/VANTARA/blob/a982611869532709cbc343c3332f8e06a310d0d5/android/app/src/main/kotlin/dev/vantara/spike/FileExtensionLoader.kt#L193-L213) uses `DexClassLoader` with host parent; contemporary Mihon `ExtensionLoader.kt` uses `DelegateLastClassLoaderCompat`, and the current official Mihon extension-library contract has source factory and package identity requirements.
- **This is a compatibility risk**, not proof that any particular extension currently fails. **Fix:** ABI and dependency matrix by real APK (Mihon-compatible) and all source instances; keep signature/trust checks; device tests for Kotlin linkage, resource and HTTP/cookie behavior.
- Upstream: https://github.com/mihonapp/mihon/blob/main/app/src/main/java/eu/kanade/tachiyomi/extension/util/ExtensionLoader.kt

### F07 — P1 — Manga installation can activate in-memory state before persistent commit
- [`ExtensionEnginePlugin.kt` L378–413](https://github.com/Meshal515/VANTARA/blob/a982611869532709cbc343c3332f8e06a310d0d5/android/app/src/main/kotlin/com/vantara/plugins/ExtensionEnginePlugin.kt#L378-L413): `claimIds`, `forget(pkg)`, `packages[pkg]` update occur before `userStore.update`. Failed commit can leave live owner/loaded maps different from installed metadata.
- **Fix:** stage+validate → durable write → atomic activation; on any failure restore owners/packages/loaded + last-known-good; test simultaneous install/uninstall and storage fault.

### F08 — P1 — Android Debug build and CloudStream runtime flags are not equivalent across branches
- `vantaraRuntimeDebug` gates `VantaraRuntime` bridge/isolated process in [`build.gradle` L35–35](https://github.com/Meshal515/VANTARA/blob/a982611869532709cbc343c3332f8e06a310d0d5/android/app/build.gradle#L35-L35), [`build.gradle` L159–163](https://github.com/Meshal515/VANTARA/blob/a982611869532709cbc343c3332f8e06a310d0d5/android/app/build.gradle#L159-L163), [`build.gradle` L237–244](https://github.com/Meshal515/VANTARA/blob/a982611869532709cbc343c3332f8e06a310d0d5/android/app/build.gradle#L237-L244) and `android/settings.gradle`.
- Special signed upgradeable Debug pipeline runs only on `feat/addons-v7-native-manager-20261027`; normal Claude branch APK build is not the same binary configuration. [`android-debug.yml` L20–35](https://github.com/Meshal515/VANTARA/blob/a982611869532709cbc343c3332f8e06a310d0d5/.github/workflows/android-debug.yml#L20-L35)
- **Current evidence:** Claude `a9826118` CI + Android Build green; Debug journey upgrade green, clean cancelled. Published `938b5061` CI failed at old fixed-date test; CloudStream-specific validations must be checked on **same SHA + same flags as the published artifact**.
- **Fix:** record APK SHA, native fingerprint, feature flags and pass/fail per device journey before any rollout.

### F09 — P1 — CloudStream experimental runtime is not a universal drop-in ABI
- `extensions/runtime-android/README.md` explicitly describes an original DEX isolation lab, not completed CloudStream/Aniyomi/Mihon ABI. Optional integrated `RuntimeHost.kt` has subset of methods with explicit source registration and network-origin broker.
- **Fix:** build capability and ABI coverage table: `getMainPage`, search, details, episodes, `loadLinks`, extractor callbacks, subtitles, cookies/HTTP, plugin registration, lifecycle. Unknown compatible plugin E2E validation. Do not hardcode success for known sources.
- Upstream: https://github.com/recloudstream/cloudstream/blob/master/library/README.md (binary ABI validation is required upstream).

### F10 — P1 — Different extension families have different trust/isolation boundaries
- Manga/An i yomi use direct class loaders in the application process; the optional original DEX runtime uses isolated worker/Binder. APK SHA and publisher key verification do **not** by themselves isolate a loaded plugin from host code.
- **Fix:** document security boundary per family; host-owned network and storage; test a deliberately malformed/adversarial fixture; no automated challenge bypass or trust downgrade.

### F11 — P1 — Source catalog surface masks operational failure as an empty result
- [`source-home.js` L220–240](https://github.com/Meshal515/VANTARA/blob/a982611869532709cbc343c3332f8e06a310d0d5/apps/web/v35/source-home.js#L220-L240) returns `[]` for any error in `popular/latest` calls, displaying `لم يرجع المصدر أعمالا` instead of reporting network/auth/timeout/incompatible causes. `supportsSourceHome` tests only method presence.
- **Fix later:** error classification and contextual retry, capability-first UI, per-source search catalog; retain core engine flow first.

### F12 — P2 — UI may lock work opening after synchronous callback exception
- [`source-home.js` L68–72](https://github.com/Meshal515/VANTARA/blob/a982611869532709cbc343c3332f8e06a310d0d5/apps/web/v35/source-home.js#L68-L72) sets `open.busy=true` before evaluating `onOpenWork(...)` inside `Promise.resolve(...)`; a synchronous throw bypasses `.finally` and can permanently block further opens.
- **Fix after engine:** deferred invocation with `Promise.resolve().then(...).catch(...).finally(...)` and regression test.

### F13 — P1 — Source separation depends on account creation cutoff and offline synchronization
- [`source-entitlement.js` L16–17](https://github.com/Meshal515/VANTARA/blob/a982611869532709cbc343c3332f8e06a310d0d5/apps/web/lib/source-entitlement.js#L16-L17) sets `Date.UTC(2026,10,1)` = 1 Nov 2026 **00:00 UTC** (03:00 Riyadh). `cohortOf` distinguishes old/new accounts using server-synced millisecond timestamp. Sync-worker account inserts `now` and system uses `Date.now`.
- This is an **intentional policy**, not a proven bug. Test upgrade, clean install, offline, unknown account, cross-device settings, and 2 distinct devices before the cutoff. Do not move cutoff without migration design.

### F14 — P1 — Identity mapping intentionally declines title guesses when no IMDb/Kitsu
- `apps/web/addons/video.js` requires an IMDb/Kitsu identity before cross-provider stream fan-out. It prevents unrelated video playback but can leave compatible addons undiscovered. Evidence of a **product limitation**, not a correctness defect.
- **Fix:** explicit identity resolution states and a provider-scoped fallback, never silently pair by similar title.

## Verified strengths (preserve, do not rewrite indiscriminately)
- Manga signed downloads, hash validation, local cache, LKG rollback, source ID collision checks.
- Stremio manifest validation, HTTPS/public-network restrictions, per-request timeouts, subtitle/torrent policy and health circuit breakers.
- CloudStream opt-in isolated worker network policy, debug-only gate.
- Generated source-level diagnostics `VantaraPrepare`, independently ranked source search, streaming results; regression tests in web/Kotlin.
- File audit indicates 21 historical source APKs in **Stable/release asset path** and 0 in Debug asset path; do not confuse them with Debug's newly installed sources.

## Test matrix before claiming full compatibility
| Family | Install & repository | Browse/search | Details | Chapter/episode | Pages/streams | Update/rollback | Device result |
|---|---|---|---|---|---|---|---|
| Mihon | needs real APK signed + trust test | unknown per real extension | unverified | unverified | unverified | unsafe state commit needs work | NOT TESTED IN THIS AUDIT |
| Keiyoushi | compatible family, not separate ABI | unverified per source | unverified | unverified | unverified | verify LKG | NOT TESTED IN THIS AUDIT |
| Aniyomi | implemented, first-source limitation | unverified | unverified | unverified | unverified | UNSAFE replacement path | NOT TESTED IN THIS AUDIT |
| CloudStream | optional Debug runtime only | requires real plugin test | unverified | unverified | unverified | unverified | NOT CERTIFIED HERE |
| Stremio | manifest/registry implemented | unit tests exist | unit tests exist | identity matching | failure path reproduced | rollback tested? not re-run | NOT LIVE CERTIFIED |

**Release gate:** same commit/flags for signed Debug, APK fingerprint, Android install upgrade AND clean, test actual repository → work → episode/chapter → server/page → open, offline restart, update/rollback, failure injection. Run `pnpm test:web`, safety, Android unit/instrumentation and isolate-runtime workflows. Test on handset. No `main`/Stable merge unless owner approves.

## Proposed fix order
1. **P0** Native-addon deadline/settlement contract + tests on JS and Kotlin; ensure `done` reaches terminal state, late results ignored, independent sources survive.
2. **P0** Aniyomi non-destructive APK update vault + restore; reject invalid update without touching old.
3. **P1** AtomicFile and corrupt-state recovery in both stores, plus transactional activation for manga.
4. **P1** Stable source identity migration and multi-source Aniyomi support; preserve old data, add real ABI fixtures for Mihon/Keiyoushi.
5. **P1** CloudStream ABI/registration/callback coverage, fault isolation, unknown-plugin compatibility lab; same-flags Debug acceptance.
6. **P2** Source-home opening/errors and UX after core engine acceptance.

## Test evidence, limitations and safety
- Mock JS failed bridge delivery reproduced: `plan.start().done` rejects when mocked `appendAddonStreams` rejects; a constructed unresolved provider promise remained pending at 100ms. These prove *failure contracts*, **not root cause of the user's live spinner**.
- Existing GitHub Action [CI](https://github.com/Meshal515/VANTARA/actions/runs/41209398252) and [Android Build](https://github.com/Meshal515/VANTARA/actions/runs/41209398256) green for Claude branch. [Debug journeys](https://github.com/Meshal515/VANTARA/actions/runs/41209398216): upgrade passed, clean cancelled. This does not certify the published APK's optional native runtime.
- The source snapshot was actually downloaded and text/indexed; **the 768-file manifest is an inventory with per-file SHA/size/role, not an assertion of a complete line-by-line semantic audit**.
- Audit branch contains documentation/manifest only; no runtime code modified, no build published. Owner's user data, Stable, main and signed Debug untouched.
