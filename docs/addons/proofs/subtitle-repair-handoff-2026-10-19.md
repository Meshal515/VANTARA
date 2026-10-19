# Subtitle repair handoff — 2026-10-19

## Scope and state

User symptom: selecting Arabic subtitles from the provider described as Subscene/SubSource/Substance fails while video continues; OpenSubtitles v3 sometimes works after another tap. The earlier public investigation identified **SubSense** (`com.subsense.nepiraw`, 2.4.1). No exact failing title, installed provider configuration, or handset/Windows failure log was supplied. Do not equate the reported provider name with a proven exact installation.

Working branch: `codex/subtitle-addon-failures-20261019`, worktree `/workspace/VANTARA-subtitle-failures-20261019`. All authored checkpoints are pushed. Initial work was limited to checkpoints; the user subsequently authorized merge and publication after passing required tests and CI, as detailed below. The untracked `node_modules` is an existing link to `/workspace/VANTARA/node_modules`; do not commit it or remove the shared target.

The root integration tree at `8292dc09828c7c4876298326e089c278b91fbb1e` and Windows 0.3.14 release source `23850a566dcc561953a78b565317f88ca44bc1a5` lack these fixes. Windows 0.3.15 work at `511404dd` includes the prior subtitle fixes plus native decoding, but its release/publication status was not queried in this task. A workflow name or commit does not establish that a version was published.

## Proven defects and narrowly scoped commits

Apply these individual commits rather than copying complete files from older trees:

| Commit | Purpose and integration notes |
| --- | --- |
| `b9c41916b6714d1434608309b311d788ad578863` | Android uses a unique selection counter in each subtitle download request ID and suppresses stale failure messages. Web shares pending downloads and prevents duplicate track nodes for repeated taps. Touches `PlayerActivity.kt`, browser subtitle session and test. |
| `11377f619cb9321b02c393ab3a360003dcd16d9b` | Arabic downloads try strict UTF-8 before Windows-1256 fallback. BOM and declared charset take precedence. Web transport/session, Android client/call site, byte-fixture tests. Preserve the root branch's additional `cache` option when resolving `transport.js`. Preserve the root branch's player/moment changes when resolving Android context. |
| `83dd3b4296c10a2bb4cc9d8f264e341838edd6f7` | Browser ignores a failed download belonging to an obsolete selection (e.g. user has chosen Off), so the UI cannot report an old download as the current failure. Active selection errors still propagate. Depends on the selection counter from `b9c41916`. Browser subtitle session/test only. |
| `619bfa0ac4e783e2645cc36e03da0e1511e00a9d` | **Necessary for native Windows playback.** Native downloader previously decoded bytes as UTF-8 and then rejected replacement characters. Adds a decoder callback to `readResponse` and chooses charset only at the subtitle download call. Includes local HTTP fixture tests. This commit exists on the Windows moments branch, not this subtitle branch. Integrator owns `services.mjs`; do not replace the root services file. |
| `2309f3d8c8daf0b45cc7c966ee6d99db21875a08` | Sanitized original public SubSense observations, useful as investigation evidence. Documentation only. |

The native Windows decoder is essential: the browser transport fix alone cannot fix `services.mjs` downloads. Native validation explicitly rejects `\uFFFD`; the same Windows-1256 bytes that merely render incorrectly in a browser are rejected on Windows before MPV sees a file. The existing native decoder commit is only 24 insertions/6 deletions across service and test despite larger branch-to-branch diffs caused by unrelated moment work.

## Verification completed in this resumed task

- New stale-download test first failed with `expected 'failed' to be 'ignored'`; after adding the selection/generation guard it passed.
- `node /workspace/VANTARA/node_modules/vitest/vitest.mjs run apps/web/addons/transport.test.js apps/web/pwa/player/subtitles.test.js apps/web/addons/subtitles.test.js`: **24/24 passed**.
- On `/workspace/VANTARA-windows-moments-20261019` at `511404dd`, `node --test --test-name-pattern='Arabic subtitle downloads|subtitle-load|ملف ترجمة' apps/desktop/src/services.test.mjs`: **4/4 passed**. The tests exercise the real local HTTP body, persisted UTF-8 subtitle content and MPV command fixture, including Windows-1256, declared encoding, UTF-16 BOM, and non-Arabic rejection. This is not real Windows/MPV playback proof.
- `pnpm test` could not start suites because the installed pnpm refuses the pre-existing modules symlink with `ERR_PNPM_UNSAFE_MODULES_DIR`. A direct repository-wide Vitest run was started as the equivalent suite runner; its final result is recorded in the follow-up checkpoint below.
- Synthetic MicroDVD `{frame}{frame}text` input, including a frame-rate declaration, is rejected by `toWebVtt`. Native Windows `validateSubtitleText` accepts SRT/VTT/ASS only. Android `SubtitleText.parse` accepts SRT/VTT only. The public sample previously observed lacked a frame-rate declaration. No frame rate was guessed and no silent timing conversion was added.

## Limits and next validation

The original [sanitized public investigation](subsense-subtitle-investigation-2026-10-19.md) documents 119 Arabic tracks: 61 direct OpenSubtitles downloads and 58 provider/YIFY downloads; three `.sub` tracks were MicroDVD. Two direct SRT files used Windows-1256 and decoded correctly after the repair. A YIFY proxy already returned extracted plain SRT. No archive extraction or blanket retry was justified by those observations.

The failure of an arbitrary first OpenSubtitles tap has not been reproduced from the user's exact installation. Request-ID reuse, repeated-selection races, legacy decoding, and stale error display are proven app defects; they are not proof that every provider failure is fixed. Retrying cannot repair unsupported MicroDVD or a persistent HTML/auth/provider response.

After integration: rerun the focused web tests and native Windows fixture test, run combined Android compilation/tests on the integrating branch, then verify a real Arabic SubSense SRT and OpenSubtitles selection on the target device. For remaining failures, gather only provider name/ID, title ID, language, response status, charset, body-format classification, and byte/cue counts. Never print or commit configured provider URLs, tokens, account identifiers, downloaded subtitle text, or user secrets. Unsupported MicroDVD should direct the user to another SRT/VTT track until timing metadata is available; video must continue.

## Repository-wide runner result

Direct `node /workspace/VANTARA/node_modules/vitest/vitest.mjs run` completed with **208 files passed, 43 suites failed to import, 1,864 tests passed**. Failures are unresolved workspace/external packages in this linked-dependencies worktree (`@vantara/domain`, `@vantara/db`, `@vantara/uchiyomi`, `@fastify/cookie`, `pg`, `zod`), not assertion failures. This is not a green full suite. No shared dependencies were removed or rewritten.

Failed suites, relative to their group directories:

- `apps/api/src/`: `admin-authorization.test.ts`, `app.logging.test.ts`, `app.test.ts`, `auth-logout-all.test.ts`, `cors.test.ts`, `discovery.test.ts`, `failure.test.ts`, `media.test.ts`, `route-surface.test.ts`, `routes/source-contract.test.ts`, `lib/chapter-fallback.test.ts`, `lib/context.identity.test.ts`, `lib/context.relink.test.ts`, `lib/sessions.atomic.test.ts`.
- `apps/web/lib/`: `sync-transport.integration.test.js`.
- `packages/db/src/`: `index.test.ts`.
- `services/web-fetcher/src/`: `index.test.ts`.
- `services/sync-worker/src/`: `accounts.integration.test.ts`, `activity-integrity.integration.test.ts`, `atomic-sync.integration.test.ts`, `authorization.test.ts`, `context.test.ts`, `d1-read-paths.test.ts`, `delta-pagination.integration.test.ts`, `device-approval.integration.test.ts`, `field-merge.integration.test.ts`, `insights.integration.test.ts`, `legacy-session-retirement.test.ts`, `majlis-chat.integration.test.ts`, `majlis-reactions.integration.test.ts`, `majlis-receipts.integration.test.ts`, `media.integration.test.ts`, `ops-ack.test.ts`, `ops.test.ts`, `pairing-tool.test.ts`, `privacy.integration.test.ts`, `secure-index.test.ts`, `source-latest.integration.test.ts`, `sync-privacy.integration.test.ts`, `together-invite.integration.test.ts`, `verify.integration.test.ts`, `work-editions.integration.test.ts`, `work-views.integration.test.ts`.

## Latest-main integration and publication handoff

The user later authorized merging and publishing after verification. Integration starts from current production main `3b70ffdd` (including the latest account-storage recovery and safe addon-reinstall changes). Do not merge an old Windows/source snapshot over main.

- Web subtitle/profile PR: https://github.com/Meshal515/VANTARA/pull/262 — branch `codex/subtitle-main-integration-20261019`, worktree `/workspace/VANTARA-subtitle-main-20261019`, current head `c217be5a`. Final diff is six web files only: transport and subtitle-session source/tests, profile CSS, service-worker digest. Includes profile CSS from `c5b6388c` as `bd9bda40`; its eight real Chromium viewport captures are in `/workspace/VANTARA-artifacts/profile-layout-20261019`.
- Native Android PR: https://github.com/Meshal515/VANTARA/pull/263 — branch `codex/subtitle-android-integration-20261019`, worktree `/workspace/VANTARA-subtitle-android-20261019`, head `940cac0c`. Three Android files only. Splitting is required by `.github/workflows/pwa-guard.yml`: combined PWA/native PRs must not change native fingerprint. The combined attempt failed that guard; the split web PR passed it. No bypass or workflow alteration was made.
- Fresh `corepack pnpm install --frozen-lockfile` in the new worktrees uses pnpm 10.33.0 and fixes the old linked-dependency environment limitation. Full repository build passed; full `corepack pnpm test` passed **795 package tests plus 1,464 web tests**. API cases requiring live Postgres/Uchiyomi report their usual local environment skip. This does not replace the CI live dependency jobs.
- After adding the profile CSS and shell digest, focused subtitle/profile tests passed **40/40**, repository safety **54/54**. Independent code reviewer approved selection, cancellation and charset changes without critical/important findings.
- Local Android tests use `JAVA_HOME=/workspace/VANTARA-artifacts/jdk/jdk-21.0.12.1+1`, `GRADLE_USER_HOME=/workspace/VANTARA-artifacts/gradle`, and Android SDK `/workspace/VANTARA-artifacts/android-sdk`. Run `corepack pnpm exec cap sync android` before Gradle; it generates required ignored Cordova scripts and may modify tracked Capacitor-generated Gradle files. Keep those generated changes out of the PR. System Java lacks `jlink`; default Gradle home has no cached distribution and outbound Java download failed. The cached full JDK/Gradle/SDK avoid both environmental errors.
- Android compilation and targeted tests passed on exact native PR `940cac0c`: `RemoteAddonTest` 13 and `SubtitleTextTest` 5, zero failures/errors/skips. Full `:app:testDebugUnitTest` then passed: **90 suites, 472 tests, zero failures/errors and two expected live-network skips** (`NativeSourcesLiveTest.matrix`, `RockLiveTest.matrix`). Generated Gradle changes were restored; both integration worktrees are clean. Local repository lint and typecheck also passed.
- CI at handoff: web latest-head runs `39312402214` (PR) / `39312391947` (push), Android debug `39312391674`; Android PR CI `39312398536` / push `39312361899`, Android debug `39312361866`. Read the current run status rather than treating this pending snapshot as success.

Merge only once current-head required CI and native build verification succeed. Then monitor the main CI and existing `Android stable APK` workflow. That workflow consumes the exact main SHA that passed CI and assigns its own monotonically increasing version. Do not manually bypass the gate or force a version. No torrent improvement is claimed: the user reported Windows 0.3.16 torrent playback still poor/worse; subtitle/profile publication is independent.
