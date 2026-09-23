# Background catalogue crawl design

Date: 2026-09-21
Branch base: `fix/spike-full-catalogue-routing-20260921` @ `6a4ed422992fab95622047e512c31e0d64637060`

## Goal

Make the full catalogue crawl continue after the user leaves `MainActivity`, while preserving the existing full-catalogue routing and page-level checkpoint guarantees.

Success means:

- starting the crawl is an explicit user action;
- leaving the app or destroying/recreating `MainActivity` does not cancel the crawl;
- progress is persisted after every committed catalogue page;
- reopening the app shows the same running job and saved progress instead of starting a second crawl;
- if Android kills the process, the crawl can restart from the persisted checkpoint rather than page 1;
- one source failure does not abort the rest of the source batch;
- the delivered source batch remains 17 sources as requested by the owner.

## Chosen approach

Use a dedicated Android foreground service for the long-running crawl.

This is the smallest architecture that actually removes the crawl lifetime from the Activity. The current `lifecycleScope.launch` is the root cause of cancellation when the screen/Activity goes away.

The service will:

1. start only from the visible Activity after the user presses the crawl button;
2. call `startForeground()` immediately with an ongoing progress notification;
3. own the loader, `SourceProbe`, source iteration, and catalogue crawl;
4. write page checkpoints through the existing `CatalogueCrawlCheckpointStore`;
5. write crawl status to a small durable state store;
6. return `START_STICKY` so Android may recreate the service after process death;
7. on recreation, detect the persisted active crawl state and resume from checkpoints;
8. stop itself and clear the active marker when every source reaches a terminal state.

No WorkManager dependency is required for this spike. The foreground service already satisfies the immediate, user-initiated, long-running requirement with substantially less lifecycle duplication. The existing durable checkpoint is the recovery mechanism.

## Android contract

Add:

- `android.permission.FOREGROUND_SERVICE`
- `android.permission.FOREGROUND_SERVICE_DATA_SYNC`
- a non-exported `CatalogueCrawlService`
- `android:foregroundServiceType="dataSync"`

The service creates a low-importance notification channel and displays:

- current source;
- current catalogue page;
- unique work count;
- overall source position;
- a stop action.

The foreground service is started while the Activity is visible, which keeps the start within Android foreground-service launch rules.

A user force-stop from Android Settings remains a hard OS boundary: no app process or scheduled component can continue through a force-stop. The persisted checkpoint still prevents data loss when the user later launches the app.

## Separation of responsibilities

### `CatalogueCrawlRunner`

Pure crawl coordinator with no `Activity`, `View`, or notification dependency.

Inputs:

- source specs;
- source loader;
- `SourceProbe`;
- checkpoint store;
- callbacks for progress/events.

Responsibilities:

- iterate the approved source batch;
- restore a per-source checkpoint;
- call `SourceProbe.crawlCatalogue`;
- mark a source complete only after `reachedEnd == true`;
- preserve non-complete sources for later retry;
- continue to the next source after a source-level failure.

### `CatalogueCrawlService`

Android lifecycle owner.

Responsibilities:

- initialize the engine against `applicationContext`;
- acquire one process-wide crawl lock;
- run `CatalogueCrawlRunner` on `Dispatchers.IO`;
- update the foreground notification;
- persist high-level running/current-source status;
- restart from durable state after process recreation;
- reject duplicate start requests.

### `MainActivity`

UI only.

Responsibilities:

- request start/stop;
- render persisted report/status;
- observe crawl state;
- never own the crawl coroutine.

The existing health probe can remain Activity-scoped; this design only moves the long full-catalogue crawl.

## Durable state

Keep the existing page-level files in `CatalogueCrawlCheckpointStore`.

Add a small `CatalogueCrawlStateStore` containing:

- snapshot/schema key;
- active flag;
- current source key/label;
- current page;
- current unique count;
- completed source count;
- last event/error text;
- updated timestamp.

Writes must be atomic. State is informational; catalogue correctness still comes from the existing page checkpoints.

## Source batch

The final delivered crawl build must contain 17 owner-approved sources.

The implementation must reconcile the latest Work branch, which currently contains a 16-source safe snapshot, with the owner's later 17-source decision before publishing an APK. The source list must be asserted in CI rather than inferred from the UI label.

## Failure behavior

- Network timeout/DNS/source parser failure: save current progress, record the reason, continue to the next source.
- Cloudflare/browser verification: record a blocked/waiting terminal result for this run, preserve checkpoint, continue.
- Service/process death: no page rollback beyond the existing at-most-one-page replay boundary.
- Activity destruction: no effect on runner.
- Duplicate crawl button press: attach to existing run, do not enqueue another runner.
- User taps notification stop action: cancel cooperatively after the current request boundary and preserve checkpoint.

## Tests

Add tests before production changes for:

1. Activity-independent runner continues when UI callback/observer disappears.
2. duplicate start requests result in one active run;
3. runner resumes from stored `nextPage` and existing seen keys;
4. source failure does not stop the following source;
5. complete source is not re-run after service recreation;
6. active state survives recreation and is cleared only on terminal completion/explicit stop;
7. manifest contains the required foreground-service type and permissions;
8. workflow asserts exactly 17 packages in the generated snapshot.

Verification gate before publishing:

- full Spike unit-test suite;
- debug APK assembly;
- repository CI;
- Android debug workflow;
- inspect generated snapshot and APK artifact from the exact head SHA.

## Non-goals

- keeping work alive through Android Settings > Force stop;
- parallel crawling of multiple sources;
- moving the ordinary source health probe into the service;
- changing the full-catalogue routing contract already implemented on the Work branch.
