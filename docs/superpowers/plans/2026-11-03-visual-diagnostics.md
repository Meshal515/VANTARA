# VANTARA visual corrections Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Apply the owner's exact visual brief without changing source/playback engines.
**Architecture:** Central visibility policy from native build type and local preference; existing DOM components and appearance tokens; compositor logo loop within floating cover stage.
**Tech Stack:** JavaScript, CSS, Kotlin, Vitest, Chromium/Playwright.
**Spec:** docs/superpowers/specs/2026-11-03-visual-diagnostics-design.md

## Global Constraints
Debug visibility off by default; Stable denies at native build level. No engine/data changes. Preserve other work styles. Push dedicated development branch only; no Debug/Stable publication.

## Review Focus
- Stale enabled preference on Stable must remain denied.
- Toggling while a work or server sheet is open must remove diagnostics and their space immediately.
- Dark/light accent pressed text must remain legible.
- Current first/last episode must retain complete frame in RTL/LTR scrolling.
- Invalid logo, page hide and reduced motion must not cause broken art or ongoing motion.

### 1. Reproduce and capture
- [ ] Capture production floating card, server sheet and shared icon family before modifications; record clipping/CTA values.
### 2. Diagnostics policy
- [ ] Add failing preference/build/reactivity tests, native build-gated bridge and single preference, bind settings/work/server/advanced diagnostics and native player visual tools; retain error collection.
- [ ] Run focused tests and compile native code.
### 3. Floating card and icons
- [ ] Correct CTA to existing tokens, remove episode paint containment and reserve safe rail space.
- [ ] Build official-logo-only layer behind cover with synchronized white/color lanes and lifecycle guards.
- [ ] Inspect icon contact sheet and production contexts; individually correct optical imbalance.
### 4. Verify and save
- [ ] Run regression suites, inspect real before/after screenshots across phone sizes/colors/directions and logo phases.
- [ ] Update service-worker shell digest, review diff, record report including visual limitations.
- [ ] Commit and push dedicated development branch, with no channel publication.
