# Profile design polish implementation plan

> Native execution in this session, followed by independent code review.

**Goal:** Preserve the large number-one favorite, remove small poster/name containers, add an in-app color picker, and blend the banner into the personal background with readable text.
**Architecture:** Keep the existing profile/editor shell. Share position mapping and color math between rendering and tests. Scope dynamic contrast to profile copy; never recolor the app or silently shade the whole chosen gradient.
**Tech stack:** Vanilla JS/CSS, Vitest, Chromium, Capacitor.
**Spec:** User's latest message and screenshots; audit at /workspace/profile-design-audit/REPORT.md with user's correction that first place stays large.

## Constraints
- Keep fonts, editor banner/avatar/name/bio positions, large first card and history layout.
- Use saved favorite positions for owners and visitors, including empty first/third/fourth positions.
- Native color picker must be replaced; preserve valid HEX, reset, cancel, save and sync behavior.
- Frontend only; no backend migration or deployment-gate changes.
- Merge and publish remain authorized by the user's earlier instruction.

## Review focus
- Sparse or duplicate favorite positions: preserve valid places; deterministic fallback for legacy entries.
- White/black gradient: preserve both colors and protect only copy that needs it.
- Light background and light/dark cards: independent text and semantic link/status contrast.
- Picker drag/keyboard/invalid HEX, viewport resize, unsaved cancellation and saving lock.
- Image changes during matching, absent images, and editor cleanup: avoid late mutations.

## Task 1: Favorite layout and history
- [x] Write/run failing tests for fixed position mapping with 1,2,5 and missing first.
- [x] Add `profileTopSlots(items, resolve)`; render the same large first + four fixed places for both owner/visitor.
- [x] Put owner administration in an explicit arranging mode; make empty positions real buttons opening a local work search sheet.
- [x] Remove small poster containers, center fixed two-line titles; retain large first card.
- [x] Organize history chapter/duration and date into predictable lines without changing other history surfaces.
- [x] Verify module tests and browser owner/visitor/empty cases; commit.

## Task 2: Color system and custom picker
- [x] Write/run failing tests for HSV edge colors and semantic contrast, unmodified gradient colors and spatial sampling.
- [x] Implement shared color math, bounded gradient sampling and scoped contrast updates for text blocks.
- [x] Mask banner imagery into the existing background; adapt avatar edges to their local background.
- [x] Implement `createProfileColorPicker(host, options)` with pointer/keyboard SV panel, hue slider, current/new sample, presets, optional HEX and validation.
- [x] Shorten appearance UI to matching buttons + two appearance summaries with inline custom controls; show actual mini stats, poster and history samples.
- [x] Preserve editor save/cancel/locking and trap focus; verify targeted tests and browser flows; commit.

## Task 3: Verification and publication
- [x] Register new modules in SW and recompute shell digest.
- [x] Run all tests, safety checks, typecheck/build/lint and Chromium checks at 320/393/597px.
- [x] Independent whole-change review; fix important findings and reverify.
- [ ] Create PR, await CI, merge and verify stable release APK/web assets contain exact feature files.

## Verification evidence
- 1121 repository tests and 47 safety checks passed. Build, typecheck and lint passed.
- Chromium checks passed at 320/393/597px, including picker drag/keyboard/HEX, save/reopen/reset, sparse owner/visitor ranks, empty-place selection, removal placement and banner masking.
- Independent review found four issues: nested preview contrast, input guard specificity, scroll sampling and initial detached history rendering. All four reproduced before fixes and passed after fixes.
- No physical Android device was available; Android packaging is verified through release CI.
