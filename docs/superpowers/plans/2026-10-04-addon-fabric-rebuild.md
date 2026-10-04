# VANTARA Addon Fabric Rebuild Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or subagent-driven-development to implement these tasks and verify the shared boundaries.

**Goal:** Ship an ordinary-user addon library with trustworthy URL/JSON/file import and protocol-based Stremio compatibility.

**Architecture:** Preserve raw Stremio semantics in a dedicated model, adapt only supported capabilities into existing VANTARA contracts, and keep registry-owned preview/update/session protection. Build a scoped addon UI over these interfaces.

**Tech Stack:** Existing ES modules, DOM/CSS, Vitest/Linkedom, Chromium/Playwright; no new dependencies.

**Spec:** `docs/addons/rebuild/DESIGN.md`

## Global Constraints
- Data only; no eval, arbitrary JS or provider iframe.
- Preserve original sources, Native Kotlin, Media3, Aniyomi and THE ROCK; no autoplay.
- No unrelated player/manga/accounts/library changes; configured URLs are private.
- APK external addon support remains capability scoped; do not fabricate video support.

## Review Focus
- Duplicate install while a source snapshot exists must preserve enabled/epoch/health/pins.
- Configured URL secrets must never enter labels, errors, diagnostics or corpus files.
- A naked raw manifest has no service endpoint: request one rather than guess.
- Config-required, empty results, unsupported formats and actual failures are distinct.
- Cancel/close and partial bundle failures must not leave late UI updates or hidden installs.

### Task 1: Stremio conformance boundary
Files: `addons/stremio-model.js`, `manifest.js`, `adapters/stremio.js`, associated tests/corpus.
Interface: `validateManifest(raw,{origin})` keeps existing return shape, adds normalized configuration and raw external types. Adapter methods keep catalog/meta/streams/subtitles signatures.
- [x] Add failing real-shape tests for safe types/resources, object/string prefix rules, catalog matching/required extras and configured endpoints.
- [x] Run focused tests, implement model/adapter, run green.
- [x] Record live public corpus evidence and licensing; no provider secrets.

### Task 2: Trusted import and lifecycle
Files: `addons/import.js`, `registry.js`, `import.test.js`, `registry.test.js`.
Interfaces: `parseAddonImport(text,{serviceUrl}) -> entries`; registry `inspectData(text,{serviceUrl,signal}) -> per-entry {preview,error,name}`, `inspect(url,{signal})`, `install(preview)`.
- [x] Add failing single/array/bundle/unsafe/oversized/endpoint-missing tests and exact-repeat versus changed-install session tests.
- [x] Implement bounded parser and registry-owned immutable trust records; install revalidates, preserves full row on exact repeat.
- [x] Test rollback/save failure and configuration states.

### Task 3: Library, cards and Source Mode
Files: `v35/addons-view.js`, `v35/addons.css`, `v35/source-mode.js`, corresponding tests.
Consumes existing registry plus inspectData, optional `onCheck` probe callback. Produces actual DOM hub and source view with existing lifecycle methods.
- [x] Add interaction tests for filters, plain-text rendering, import choices/cancel, visibility after install and real configuration actions.
- [x] Implement scoped responsive cards/import/details; preserve Source Mode open-work callbacks.
- [x] Add supported required catalog controls and isolated pagination/cancellation tests.

### Task 4: Runtime integration and diagnostics
Files: `addons/runtime.js`, `native-runtime.js` (only necessary boundary), `v35/shell.js`, `index.html`, `sw.js`.
Interfaces: runtime `diagnose(key,{signal}) -> scoped capability evidence`; UI receives callback, existing sources/subtitles signatures unchanged.
- [x] Test configuration exclusion, pure health readiness, truthful stable/candidate/broken derivation and probe errors/abort.
- [x] Wire stylesheet/UI diagnostics and bound catalog-only/unknown type integration without pretending they provide streams.
- [x] Update offline asset list/digest after all code changes.

### Task 5: Verify and report
- [x] Capture actual before/after 390/1366/1920 library/import/details/Source Mode screenshots; exercise file/bundle and progressive results.
- [x] Run all addon/UI tests, complete Vitest suite and repository safety; run applicable native boundary checks.
- [x] Review full tracked diff, document live corpus and every unproved E2E as UNVERIFIED in `docs/addons/rebuild/REPORT.md`.
