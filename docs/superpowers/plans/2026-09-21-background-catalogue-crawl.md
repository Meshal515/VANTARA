# Background Catalogue Crawl Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the full VANTARA catalogue crawl out of `MainActivity` into a persistent foreground service that keeps running when the UI disappears and resumes from page checkpoints after process recreation.

**Architecture:** Keep `SourceProbe.crawlCatalogue`, `CatalogueListingResolver`, and `CatalogueCrawlCheckpointStore` as the catalogue truth. Add a UI-free `CatalogueCrawlRunner` that owns source iteration, a durable `CatalogueCrawlStateStore` for user-visible run state, and a `CatalogueCrawlService` that owns the long-lived coroutine and foreground notification. `MainActivity` becomes a start/stop/status client and no longer owns the crawl coroutine.

**Tech Stack:** Android 15/16 foreground service API, Kotlin coroutines, OkHttp/Keiyoushi extension surface already in the Spike, JUnit 4, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-21-background-catalogue-crawl-design.md`

## Global Constraints

- Base implementation on `fix/spike-full-catalogue-routing-20260921` at `6a4ed422992fab95622047e512c31e0d64637060`; do not regress its full-catalogue routing contract.
- Full-catalogue correctness still comes from `CatalogueCrawlCheckpointStore`; the new state store is informational/control state only.
- Commit every successful page before advancing to the next page.
- Activity destruction/backgrounding must not cancel the crawl.
- No parallel source crawls.
- A source-level failure must preserve its checkpoint and continue to the next source.
- Cloudflare/browser verification must preserve checkpoint and continue to the next source.
- Explicit user stop preserves checkpoint.
- Android Settings > Force stop is outside the guarantee.
- Final delivered batch is exactly 17 sources: the latest 16-source Work batch plus `eu.kanade.tachiyomi.extension.ar.arabmanhwa`; Goon Scans stays excluded.
- Do not merge to `main` as part of this plan.
- Publish no APK until the exact-head unit tests, Spike build, VANTARA CI, Android debug workflow, generated snapshot, and artifact have all been verified.

## Review Focus

- Activity recreation while a crawl is active must attach to the same run and never start a duplicate service coroutine.
- Process recreation with an active marker must resume from the stored `nextPage`/seen keys, not page 1.
- A source throwing before or during crawling must not prevent the following source from running.
- A user stop during a request must preserve the last committed page and clear only the active-running marker, not catalogue checkpoints.
- Notification/service startup on targetSdk 35 must have the exact foreground-service permissions/type and start from the visible Activity.

---

### Task 1: Durable crawl state contract

**Files:**
- Create: `spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/CatalogueCrawlStateStore.kt`
- Create: `spike/extension-engine/app/src/test/kotlin/dev/vantara/spike/CatalogueCrawlStateStoreTest.kt`

**Interfaces:**
- Produces:
  - `data class CatalogueCrawlState(...)`
  - `class CatalogueCrawlStateStore(root: File)`
  - `fun read(): CatalogueCrawlState`
  - `fun markStarted(snapshotKey: String, totalSources: Int)`
  - `fun updateProgress(sourceKey: String, sourceLabel: String, sourceIndex: Int, page: Int, uniqueWorks: Int, completedSources: Int)`
  - `fun recordEvent(message: String)`
  - `fun markStopped(message: String)`
  - `fun markFinished(message: String)`
  - `fun clear()`

- [ ] **Step 1: Write failing persistence tests**

Create tests that instantiate the store in a temporary directory and assert:
- default state is inactive;
- `markStarted` survives constructing a second store instance;
- `updateProgress` survives reconstruction with exact page/count/source index;
- `markStopped` sets `active=false` without deleting progress fields;
- `markFinished` sets `active=false`, `finished=true`;
- a partially written temporary file is ignored in favor of the last atomically committed state.

Example assertion shape:

```kotlin
@Test
fun `active crawl state survives store recreation`() {
    val root = temporaryFolder.newFolder()
    CatalogueCrawlStateStore(root).apply {
        markStarted("snapshot-v1", totalSources = 17)
        updateProgress("pkg|1", "Mangalek", 3, page = 42, uniqueWorks = 840, completedSources = 2)
    }

    val restored = CatalogueCrawlStateStore(root).read()

    assertTrue(restored.active)
    assertEquals(42, restored.page)
    assertEquals(840, restored.uniqueWorks)
    assertEquals(2, restored.completedSources)
}
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd spike/extension-engine
./gradlew :app:testDebugUnitTest --tests dev.vantara.spike.CatalogueCrawlStateStoreTest --no-daemon
```

Expected: compilation/test failure because `CatalogueCrawlStateStore` does not exist.

- [ ] **Step 3: Implement the minimal atomic file store**

Use one versioned UTF-8 state file under `filesDir/catalogue-crawl-runtime/`. Serialize line-oriented escaped values or a tiny JSON object using the already-present kotlinx serialization dependency. Every mutation writes to `.tmp` then renames/replaces the target. Do not move seen-work keys into this store.

State fields must include:

```kotlin
data class CatalogueCrawlState(
    val active: Boolean = false,
    val finished: Boolean = false,
    val snapshotKey: String = "",
    val totalSources: Int = 0,
    val completedSources: Int = 0,
    val sourceKey: String = "",
    val sourceLabel: String = "",
    val sourceIndex: Int = 0,
    val page: Int = 0,
    val uniqueWorks: Int = 0,
    val lastEvent: String = "",
    val updatedAtEpochMs: Long = 0L,
)
```

- [ ] **Step 4: Run focused test and full Spike suite**

Run the focused command above, then:

```bash
./gradlew :app:testDebugUnitTest --no-daemon
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/CatalogueCrawlStateStore.kt \
        spike/extension-engine/app/src/test/kotlin/dev/vantara/spike/CatalogueCrawlStateStoreTest.kt
git commit -m "feat(spike): persist catalogue crawl runtime state"
```

---

### Task 2: UI-free catalogue runner

**Files:**
- Create: `spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/CatalogueCrawlRunner.kt`
- Create: `spike/extension-engine/app/src/test/kotlin/dev/vantara/spike/CatalogueCrawlRunnerTest.kt`
- Modify: `spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/MainActivity.kt` only to remove duplicated orchestration after Task 4; do not change it in this task.

**Interfaces:**
- Consumes:
  - `CatalogueCrawlCheckpointStore`
  - `CatalogueCrawlStateStore`
  - `SourceSpec`
  - `CatalogueSource`
  - `SourceProbe.CatalogueReach`
- Produces:
  - `sealed interface CatalogueCrawlEvent`
  - `data class CatalogueRunSummary(...)`
  - `class CatalogueCrawlRunner(...)`
  - `suspend fun run(): CatalogueRunSummary`

Use injected lambdas so unit tests do not need Android/Dex loading:

```kotlin
class CatalogueCrawlRunner(
    private val specs: List<SourceSpec>,
    private val checkpoint: CatalogueCrawlCheckpointStore,
    private val stateStore: CatalogueCrawlStateStore,
    private val loadSources: suspend (SourceSpec) -> List<CatalogueSource>,
    private val crawlSource: suspend (
        spec: SourceSpec,
        source: CatalogueSource,
        resume: CatalogueCrawlCheckpointStore.Resume?,
        onPageCommitted: suspend (page: Int, nextPage: Int, newKeys: List<String>, totalSeen: Int) -> Unit,
        onProgress: suspend (page: Int, found: Int) -> Unit,
    ) -> SourceProbe.CatalogueReach,
    private val emit: suspend (CatalogueCrawlEvent) -> Unit = {},
)
```

- [ ] **Step 1: Write failing runner tests**

Tests must pin:
- a completed source is skipped on a recreated runner;
- resume passes stored `nextPage` and `seenKeys` to `crawlSource`;
- page callback calls `savePage` before progress moves forward;
- source A throws and source B still runs;
- `reachedEnd=true` marks complete;
- non-complete/Cloudflare/error reach remains resumable;
- cancelling the runner rethrows `CancellationException` and leaves the current checkpoint untouched;
- dropping the event callback/UI observer does not stop the runner.

- [ ] **Step 2: Run runner tests and verify RED**

```bash
./gradlew :app:testDebugUnitTest --tests dev.vantara.spike.CatalogueCrawlRunnerTest --no-daemon
```

Expected: failure because the runner/events do not exist.

- [ ] **Step 3: Implement the minimal runner**

The runner must:
1. filter with existing `shouldCrawlCatalogue`;
2. mark runtime state started before source iteration;
3. for each Arabic source build key `${spec.pkg}|${source.id}`;
4. skip `checkpoint.isComplete(key)`;
5. load `checkpoint.load(key)`;
6. update runtime state on each progress callback;
7. save the page in `onPageCommitted`;
8. mark complete only when `reach.reachedEnd`;
9. emit a failure event and continue on source-level exceptions;
10. never catch a real coroutine cancellation;
11. mark runtime finished only after iterating the whole batch.

No Android `Context`, `Activity`, `Notification`, or `View` imports are allowed in this file.

- [ ] **Step 4: Verify runner and full Spike tests**

Run focused runner test, then the full suite.

- [ ] **Step 5: Commit**

```bash
git add spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/CatalogueCrawlRunner.kt \
        spike/extension-engine/app/src/test/kotlin/dev/vantara/spike/CatalogueCrawlRunnerTest.kt
git commit -m "feat(spike): extract activity-independent catalogue runner"
```

---

### Task 3: Foreground-service lifecycle and duplicate-run guard

**Files:**
- Create: `spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/CatalogueCrawlService.kt`
- Create: `spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/CatalogueCrawlServiceContract.kt`
- Create: `spike/extension-engine/app/src/test/kotlin/dev/vantara/spike/CatalogueCrawlServiceContractTest.kt`
- Modify: `spike/extension-engine/app/src/main/AndroidManifest.xml`
- Modify: `spike/extension-engine/app/build.gradle.kts` only if an AndroidX helper is actually required; prefer platform `Service` + `NotificationManager` + existing `androidx.core`.

**Interfaces:**
- Produces:
  - `const val ACTION_START_CATALOGUE_CRAWL`
  - `const val ACTION_STOP_CATALOGUE_CRAWL`
  - `object CatalogueCrawlExecutionGate` with atomic `tryAcquire()/release()/isRunning()`
  - `class CatalogueCrawlService : Service`

- [ ] **Step 1: Write failing contract tests**

Pin pure lifecycle policy:
- first `tryAcquire()` succeeds;
- second concurrent `tryAcquire()` fails;
- release permits a later start;
- a recreated service with durable `active=true` is allowed to resume after acquiring the empty process-local gate;
- stop action maps to cooperative cancellation, not checkpoint deletion.

Also extend `tools/repository-safety.test.mjs` (or add a focused manifest text test) to assert the manifest contains:
- `android.permission.FOREGROUND_SERVICE`
- `android.permission.FOREGROUND_SERVICE_DATA_SYNC`
- non-exported `.CatalogueCrawlService`
- `android:foregroundServiceType="dataSync"`

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
cd spike/extension-engine
./gradlew :app:testDebugUnitTest --tests dev.vantara.spike.CatalogueCrawlServiceContractTest --no-daemon
cd ../..
node --test tools/repository-safety.test.mjs
```

Expected: missing contract/service/manifest assertions fail.

- [ ] **Step 3: Implement service startup and notification**

The service must:
- call `startForeground()` immediately in `onStartCommand(ACTION_START...)`;
- use a low-importance notification channel;
- return `START_STICKY`;
- initialize Injekt using `application` if needed without an Activity reference;
- run one `SupervisorJob + CoroutineScope(Dispatchers.IO)`;
- create real `FileExtensionLoader(applicationContext)`, `SourceProbe(network.client)`, checkpoint/state stores;
- adapt source loading/crawling into `CatalogueCrawlRunner`;
- update notification from runner events with source label/page/unique count/source position;
- on `ACTION_STOP...`, cancel the job, call `stateStore.markStopped("أوقفه المستخدم")`, release gate, and `stopSelf()`;
- in `finally`, release the execution gate;
- on normal terminal completion, mark finished and stop foreground/service;
- never clear `CatalogueCrawlCheckpointStore` on cancellation or source failure.

Notification stop action must target the same service with `ACTION_STOP_CATALOGUE_CRAWL`.

- [ ] **Step 4: Add manifest contract**

Add before `<application>`:

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
```

Add inside `<application>`:

```xml
<service
    android:name=".CatalogueCrawlService"
    android:exported="false"
    android:foregroundServiceType="dataSync" />
```

- [ ] **Step 5: Verify focused tests and assemble debug**

```bash
cd spike/extension-engine
./gradlew :app:testDebugUnitTest --no-daemon
./gradlew :app:assembleDebug --no-daemon
```

Expected: tests and APK assembly succeed.

- [ ] **Step 6: Commit**

```bash
git add spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/CatalogueCrawlService.kt \
        spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/CatalogueCrawlServiceContract.kt \
        spike/extension-engine/app/src/test/kotlin/dev/vantara/spike/CatalogueCrawlServiceContractTest.kt \
        spike/extension-engine/app/src/main/AndroidManifest.xml \
        tools/repository-safety.test.mjs
git commit -m "feat(spike): run catalogue crawl in foreground service"
```

---

### Task 4: Convert MainActivity into a crawl client

**Files:**
- Modify: `spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/MainActivity.kt`
- Create: `spike/extension-engine/app/src/test/kotlin/dev/vantara/spike/CatalogueCrawlUiPolicyTest.kt`

**Interfaces:**
- Consumes:
  - `CatalogueCrawlStateStore.read()`
  - service start/stop actions from Task 3.
- Produces:
  - no crawl coroutine in `MainActivity`;
  - UI helpers that derive button/status text from durable state.

- [ ] **Step 1: Write failing UI-policy tests**

Extract pure helpers and test:
- inactive/no-progress => `"احصِ كتالوج كل المصادر (17) — يطول"`;
- active => button/status says crawl is running and shows current source/page;
- stopped with checkpoints => `"استأنف إحصاء كل المصادر (17)"`;
- finished => completed status;
- pressing Start while state is active produces ATTACH/NOOP rather than another start request.

- [ ] **Step 2: Verify RED**

```bash
./gradlew :app:testDebugUnitTest --tests dev.vantara.spike.CatalogueCrawlUiPolicyTest --no-daemon
```

- [ ] **Step 3: Remove Activity-owned `crawlAll()`**

Delete the long `lifecycleScope.launch` catalogue loop from `MainActivity`.

The crawl button must:
1. retain the existing explicit content-consent dialog;
2. call `ContextCompat.startForegroundService(... ACTION_START_CATALOGUE_CRAWL)` only if not already active;
3. if active, only refresh/render state;
4. offer a visible stop button or toggle that sends `ACTION_STOP_CATALOGUE_CRAWL`.

Do not set `running=true` for the background catalogue job; `running` may continue to guard the separate health probe.

- [ ] **Step 4: Refresh status while Activity is visible**

Use a lifecycle-bound lightweight polling/observer loop that reads `CatalogueCrawlStateStore` every 1 second while STARTED and updates only UI text. Destroying this observer must have no effect on the service.

When Activity is recreated, immediately render durable state and the existing report/checkpoint count.

- [ ] **Step 5: Verify tests and assembly**

Run full Spike tests and debug assembly.

- [ ] **Step 6: Commit**

```bash
git add spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/MainActivity.kt \
        spike/extension-engine/app/src/test/kotlin/dev/vantara/spike/CatalogueCrawlUiPolicyTest.kt
git commit -m "refactor(spike): make activity a background crawl client"
```

---

### Task 5: Restore and lock the requested 17-source batch

**Files:**
- Modify: `.github/workflows/spike-extension-engine.yml`
- Modify: `spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/GeneratedSources.kt` only if the tracked local fallback must mirror the delivered diagnostic batch.
- Modify: `spike/extension-engine/tools/test_generate_arabic_sources.py` if needed to pin the new exact policy.

**Interfaces:**
- Final exact batch = current Work 16:
  - Mangalek
  - MangaSpark
  - Azora
  - MangaSwat
  - Team X
  - 3asq
  - AriaToon
  - Comic Verse
  - Dilar
  - MangaDar
  - Hijala
  - Manga Starz
  - HizoManga
  - Manga Tales
  - MangaTime
  - MangaDex Arabic source
- plus:
  - ArabManhwa
- excluded:
  - Goon Scans
  - MangaLink from the latest Work replacement set.

- [ ] **Step 1: Write/adjust generator policy test first**

Assert exactly:
- package count = 17;
- SAFE = 15;
- MIXED = 1;
- NSFW = 1;
- NSFW set contains only `eu.kanade.tachiyomi.extension.ar.arabmanhwa`;
- Goon Scans absent;
- every selected package exposes at least one Arabic source id.

- [ ] **Step 2: Run generator tests and verify RED**

```bash
cd spike/extension-engine
python3 -m unittest discover -s tools -p 'test_*.py' -v
```

Expected: current 16-source workflow/policy fails the 17-source assertion.

- [ ] **Step 3: Add ArabManhwa to the allowlist and NSFW consent set**

Update workflow comments/count assertions/artifact name to explicitly say 17.

Do not re-add Goon Scans.

- [ ] **Step 4: Run policy tests and inspect generated snapshot**

```bash
python3 -m unittest discover -s tools -p 'test_*.py' -v
python3 tools/generate_arabic_sources.py
python3 - <<'PY'
import json
p=json.load(open('build/arabic-source-snapshot.json', encoding='utf-8'))
assert len(p['packages']) == 17
assert p['counts'] == {'SAFE': 15, 'MIXED': 1, 'NSFW': 1, 'BLOCKED': 0}
assert 'eu.kanade.tachiyomi.extension.ar.goonscans' not in {x['packageName'] for x in p['packages']}
assert 'eu.kanade.tachiyomi.extension.ar.arabmanhwa' in {x['packageName'] for x in p['packages']}
print([x['packageName'] for x in p['packages']])
PY
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/spike-extension-engine.yml \
        spike/extension-engine/tools/test_generate_arabic_sources.py \
        spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/GeneratedSources.kt
git commit -m "ci(spike): lock requested seventeen-source catalogue batch"
```

---

### Task 6: End-to-end regression and exact-head artifact verification

**Files:**
- Modify only files required by failures found here; every code fix requires a reproducing test first.

**Interfaces:**
- Consumes all tasks above.
- Produces a verified debug APK artifact from the exact final head SHA.

- [ ] **Step 1: Run complete local/static verification available in CI**

```bash
cd spike/extension-engine
python3 -m unittest discover -s tools -p 'test_*.py' -v
./gradlew :app:testDebugUnitTest --no-daemon --stacktrace
./gradlew :app:assembleDebug --no-daemon --stacktrace
cd ../..
node --test tools/repository-safety.test.mjs
```

Expected: zero failures.

- [ ] **Step 2: Review the final diff against the spec**

Explicitly verify:
- no `crawlCatalogue` loop remains under `lifecycleScope`;
- service owns the runner coroutine;
- Activity owns only start/stop/status UI;
- checkpoints save every page;
- duplicate-run gate exists;
- cancellation preserves checkpoints;
- manifest service is non-exported/dataSync;
- source snapshot policy is exactly 17.

- [ ] **Step 3: Push commits and wait for all exact-head workflows**

Require success from:
- `Spike — local extension engine (debug APK)`
- `VANTARA CI`
- `Android debug APK`

Do not use a run from an older SHA.

- [ ] **Step 4: Inspect exact-head artifact**

Download the Spike artifact and verify:
- generated snapshot count = 17;
- counts = SAFE 15 / MIXED 1 / NSFW 1 / BLOCKED 0;
- Goon Scans absent;
- ArabManhwa present;
- APK exists;
- record artifact digest and APK SHA-256.

- [ ] **Step 5: Publish only after verification**

Provide the user the APK with:
- exact commit SHA;
- exact workflow run id;
- artifact digest;
- APK SHA-256;
- one concise manual test: start catalogue crawl, leave app for several minutes, reopen, confirm page/count advanced without manual resume.
