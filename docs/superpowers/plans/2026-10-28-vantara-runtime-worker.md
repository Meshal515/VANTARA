# VANTARA Runtime Android Worker Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans task-by-task.

**Goal:** Study pinned engine execution paths and prove independent Android DEX process isolation and recovery.
**Architecture:** Separate API/fixture/harness Gradle modules, pinned DEX input, OS-isolated worker and host-owned Binder capabilities. No production hooks.
**Tech Stack:** Java 17/8 bytecode, Android API29/35, AGP8.7.3, Gradle8.9, AndroidJUnit4 instrumentation.
**Spec:** docs/repository-compat/ANDROID_WORKER_DESIGN.md

## Global Constraints
- Keep all original f20723d application files identical; no torrent/player/subtitles/accounts/legacy engine changes.
- No copying engine implementation; research snapshots stay outside Git.
- No source-site requests, deployment, main merge or Stable publication.
- Authored external DEX tests are not third-party CS3 execution evidence.

## Review Focus
- Constructor/initialize failure must not publish the candidate.
- Timeout must retire the physical generation rather than reuse a hung worker.
- Source/session identity comes only from host metadata, never plugin JSON.
- Worker cannot read the host's storage sentinel or inherit INTERNET permission.
- Restart must create a fresh PID and preserve host data.

## Task 1 — engine lifecycle study
- [ ] Read pinned loader/manager/source/network/storage contracts and record evidence with source paths, ranges and limitations.
- [ ] Document cross-family lifecycle and concrete decisions; distinguish source reading from reproduced upstream defects.

## Task 2 — actual isolated Android execution
- [ ] Author instrumented acceptance tests and external DEX fixture before implementing the service/client.
- [ ] Prove failing behavior, implement bounded API/Binder/client/service, compile and run tests.
- [ ] Cover SHA/entry/ABI errors, process death, timeout and successful operations with real DEX.

## Task 3 — CI and review
- [ ] Add independent emulator CI (API29/35), preserve reports/logcat and inspect failures.
- [ ] Run original core/regression/scope checks and review the whole change.
- [ ] Push experimental branch, wait CI, report actual coverage and remaining ABI work. No merge or release.
