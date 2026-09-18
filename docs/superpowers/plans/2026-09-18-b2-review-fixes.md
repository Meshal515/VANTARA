# B2 Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three blocking findings from Claude's B2 peer review without changing the established v2 identity-token contract.

**Architecture:** Keep B2's trusted-device model and Bearer token unchanged. Add the missing native URL bridge at the web/native boundary, add an owner-only CLI provisioning path for pairing tokens, and make production deployment explicitly provision every Worker secret required by the runtime.

**Tech Stack:** Capacitor 6, plain browser ESM (no bundler), Cloudflare Worker/D1, pnpm, Vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-17-b2-unified-identity-design.md`

## Global Constraints

- Account selection remains one tap: no password/PIN/form in daily UX.
- The browser never receives or mints the legacy Worker token.
- D1 stores only HMACs of device/pairing credentials.
- Production code is changed only after a failing regression test proves each gap.
- B5 queue semantics are not rewritten in this patch.

---

### Task 1: Native pairing URL bridge

**Files:**
- Modify: `services/sync-worker/src/client-auth.test.ts`
- Modify: `apps/web/lib/sync.js`
- Create: `apps/web/lib/native-links.js`
- Modify: `apps/web/app.js`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `createSync().pairDevice(pairingToken)`
- Produces: `createSync().consumePairingUrl(url)`; `installNativeLinkBridge(sync)`

- [ ] Write a failing test proving a `vantara://...?pair=` URL can be consumed independently of `location.href`.
- [ ] Run CI/test target and verify RED.
- [ ] Implement URL parsing in the sync layer.
- [ ] Add a Capacitor-only bridge using `window.Capacitor.Plugins.App` so plain web ESM stays bundle-free; handle both `getLaunchUrl()` and `appUrlOpen`.
- [ ] Add `@capacitor/app` so `npx cap sync android` registers the native plugin.
- [ ] Run targeted tests and CI.

### Task 2: Pairing token provisioning

**Files:**
- Create: `services/sync-worker/tools/create-pairing-token.mjs`
- Create/modify: `services/sync-worker/src/pairing-tool.test.ts`
- Modify: `services/sync-worker/package.json`

**Interfaces:**
- Consumes: `VANTARA_DEVICE_PEPPER`, Cloudflare Wrangler auth, D1 database name.
- Produces: one short-lived raw pairing token for the Owner; D1 receives only its HMAC.

- [ ] Write a failing test for deterministic HMAC/SQL payload generation and required environment validation.
- [ ] Verify RED.
- [ ] Implement the smallest CLI tool that generates a random token, hashes it, and executes the D1 insert through Wrangler.
- [ ] Verify GREEN and document the command in B2 spec.

### Task 3: Production Worker secrets

**Files:**
- Modify: `tools/repository-safety.test.mjs`
- Modify: `.github/workflows/sync-worker.yml`

**Interfaces:**
- Consumes GitHub secrets `VANTARA_SESSION_SECRET`, `VANTARA_IDENTITY_SECRET`, `VANTARA_DEVICE_PEPPER`.
- Produces all three as Worker secrets before smoke verification.

- [ ] Add a failing repository-safety assertion requiring all runtime secrets in verification + `wrangler secret put`.
- [ ] Verify RED.
- [ ] Update workflow minimally.
- [ ] Verify GREEN.

### Task 4: Review cleanup and verification

**Files:**
- Modify: `infra/docker-compose.yml` only to restore operational comments removed by B2.
- Modify: `docs/superpowers/specs/2026-09-17-b2-unified-identity-design.md` with provisioning command/transport note.

- [ ] Restore only the review-identified comments; no behavior changes.
- [ ] Run full CI on the final SHA.
- [ ] Re-read Claude's five requested re-verification items and record evidence in OWNER OFFICE.
- [ ] Leave B2 as `READY_FOR_PEER_REVIEW`; do not self-close it.
