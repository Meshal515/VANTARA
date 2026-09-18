# B8 Social Activity & Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement VANTARA's non-chat social backend: server-derived activity feed, per-recipient recommendation state, delivery/seen receipts, friend/profile social reads, and B9-integrated notifications.

**Architecture:** D1 remains the owner for social data. Existing source operations (`rating.set`, `comment.add`, `reaction.set`, `recommendation.send`) become the only producers of feed events. Recommendations keep one shared recommendation row and add one mutable recipient row per recipient. Activity receipts are per viewer. All coupled writes use the existing D1 `batch()` transaction path.

**Tech Stack:** TypeScript, Cloudflare Workers, D1, Vitest, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-09-18-b8-social-recommendations-design.md`

## Global Constraints

- No chat subsystem.
- No OS push notifications.
- D1 remains the single owner for social activity/recommendations/receipts.
- Reading/library truth remains owned by Uchiyomi.
- B8 must use B9's notification producer and must not create a second notification writer.
- TDD is mandatory for every behavior.
- B8 migration number is `0008` because B2 already owns `0007_trusted_devices.sql`.
- Reject has no collection/library side effect.
- Accept and intent are separate facts.
- New feed events come from successful server operations, not a generic client-authored `activity.add`.

---

### Task 1: Domain contracts for recommendation responses and activity receipts

**Files:**
- Create: `packages/domain/src/social.ts`
- Create: `packages/domain/src/social.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Produces:
  - `RECOMMENDATION_STATES`
  - `RECOMMENDATION_INTENTS`
  - `isRecommendationState(value)`
  - `isRecommendationIntent(value)`
  - `advanceReceipt(current, next)`
  - `receiptState(row)`
  - `socialLinkFor(input)`
- Consumers: Sync Worker write/read paths in Tasks 3 and 4.

- [ ] Write failing tests in `social.test.ts` for:
  - only `PENDING|ACCEPTED|REJECTED` are accepted;
  - only `WATCH_NOW|WATCH_LATER|ADD_TO_LIBRARY` are accepted;
  - receipt state is monotonic: none → delivered → seen, never backwards;
  - `seen` implies delivered;
  - links are deterministic:
    - work/recommendation → `vantara://series/<encoded>`
    - comment/reaction → `vantara://series/<encoded>/comment/<encoded>`.
- [ ] Run `pnpm --filter @vantara/domain test -- social.test.ts` and verify RED for missing exports.
- [ ] Implement the minimal pure-domain functions.
- [ ] Export `./social.ts` from `packages/domain/src/index.ts`.
- [ ] Re-run the targeted test and verify GREEN.
- [ ] Run `pnpm --filter @vantara/domain typecheck`.
- [ ] Commit as `feat(b8): add social domain contracts`.

### Task 2: D1 schema and ownership

**Files:**
- Create: `services/sync-worker/migrations/0008_social_receipts_and_recommendation_states.sql`
- Modify: `packages/domain/src/ownership.ts`
- Modify: `packages/domain/src/ownership.test.ts`
- Modify: `services/sync-worker/src/ops.test.ts`

**Interfaces:**
- Produces tables:
  - `recommendation_recipients(recommendation_id, user_id, state, intent, responded_at, rev)`
  - `activity_receipts(event_id, user_id, delivered_at, seen_at, rev)`
- Produces activity columns:
  - `target_user_id`
  - `link`

- [ ] Write a failing ownership test requiring both new tables to be owned by D1 and no duplicate owner.
- [ ] Write a failing repository/schema assertion that `0008` exists and includes:
  - FK to recommendations/accounts where valid;
  - composite PK for recommendation recipients;
  - composite PK for activity receipts;
  - CHECK constraints for state/intent;
  - indexes for recommendation recipient lookup and activity receipt lookup;
  - `ALTER TABLE activity ADD COLUMN target_user_id TEXT`;
  - `ALTER TABLE activity ADD COLUMN link TEXT`.
- [ ] Verify RED.
- [ ] Implement migration `0008`.
- [ ] Update ownership matrix:
  - `social.recommendations` tables include `recommendations`, `recommendation_recipients`;
  - `social.activity` tables include `activity`, `activity_receipts`.
- [ ] Re-run targeted tests and typecheck.
- [ ] Commit as `feat(b8): add social receipt schema`.

### Task 3: Write path — server-derived activity, recommendation recipients, receipts and notifications

**Files:**
- Modify: `services/sync-worker/src/index.ts`
- Modify: `services/sync-worker/src/ops.test.ts`
- Modify: `packages/domain/src/notifications.ts` only if a new notification-target helper is needed; otherwise leave unchanged.

**Interfaces:**
- Consumes Task 1 social validators/link builder.
- Produces operation contracts:
  - `recommendation.send`
  - `recommendation.respond`
  - `activity.delivered`
  - `activity.seen`
- Extends real producers:
  - `rating.set`
  - `comment.add`
  - `reaction.set`

- [ ] RED: targeted recommendation creates:
  - one recommendation row;
  - one `recommendation_recipients` row for named recipient;
  - one notification via existing B9 producer;
  - one activity row with target + canonical link.
- [ ] RED: broadcast recommendation creates one recipient row per non-sender account and one notification per recipient.
- [ ] RED: recommendation recipients are independent; response SQL scopes by `recommendation_id + user_id`.
- [ ] RED: invalid response state/intent produces no statements.
- [ ] RED: reject writes only recipient state; it does not write collections/library.
- [ ] RED: accept + `WATCH_LATER` writes recipient state and the existing `collections` contract with `read_later`.
- [ ] RED: accept + `ADD_TO_LIBRARY` does **not** invent a D1 library truth; it returns/persists only recipient intent and leaves library ownership to the existing client/API flow.
- [ ] RED: rating/comment/reaction each generate one deterministic `activity` row using the source `op_id`.
- [ ] RED: comment reply notifies parent author excluding self.
- [ ] RED: reaction notifies comment author excluding self. Because author lookup is DB-dependent, add a pre-read context only for reaction/comment-reply operations that need it; do not query accounts for all ops.
- [ ] RED: `activity.delivered` and `activity.seen` write only the current viewer's receipt and are monotonic:
  - delivered never clears seen;
  - seen sets delivered if absent;
  - neither lowers timestamps/state.
- [ ] Verify every RED fails for the missing behavior, not test setup.
- [ ] Implement the minimal Worker changes.
- [ ] Keep `activity.add` legacy-compatible but stop using it for new B8 producers.
- [ ] Re-run `pnpm --filter @vantara/sync-worker test` and typecheck.
- [ ] Commit as `feat(b8): derive social activity from real ops`.

### Task 4: Social read APIs

**Files:**
- Modify: `services/sync-worker/src/index.ts`
- Create: `services/sync-worker/src/social-read.test.ts` if current recorder cannot cleanly test read contracts; otherwise extend existing tests.

**Interfaces:**
- Produces:
  - `GET /v1/social/friends`
  - `GET /v1/social/profile/:userId`
  - `GET /v1/social/feed?before=<cursor>&limit=<n>`

- [ ] RED friends contract:
  - returns account/profile identity;
  - derives online/offline from beat age using existing presence domain logic;
  - reuses incognito redaction;
  - returns last-seen data when offline.
- [ ] RED profile aggregate math:
  - unique chapters = count of chapter rows;
  - total chapters = sum read_count;
  - repeats = total - unique;
  - active time = sum usage_daily.active_ms;
  - top 5 derived from existing reads/ratings without introducing a new truth.
- [ ] RED feed contract:
  - bounded pagination;
  - actor descriptor;
  - optional target descriptor;
  - optional work descriptor;
  - canonical link from stored structured column;
  - per-viewer receipt summary/avatars;
  - recommendation recipient states for recommendation events.
- [ ] RED authorization: unknown profile is 404-style; feed/friends require valid session through existing Worker auth.
- [ ] RED query-count guard: feed read must not issue one query per event. Use grouped/batched reads with a bounded query count.
- [ ] Implement minimal handlers and route wiring.
- [ ] Re-run sync-worker tests and typecheck.
- [ ] Commit as `feat(b8): add social friend and feed reads`.

### Task 5: Integration verification and peer-review handoff

**Files:**
- Modify: `docs/VANTARA_DATA_OWNERSHIP.md` if it exists separately from the executable matrix and needs truth-sync.
- Modify: `docs/VANTARA_MASTER_PLAN.md` only for B8 status/evidence, not for speculative future UI.
- No production behavior changes unless verification finds a confirmed bug.

**Interfaces:**
- Produces final B8 evidence for OWNER OFFICE.

- [ ] Re-read the spec line-by-line and verify every B8 requirement has code/test evidence.
- [ ] Run targeted domain tests.
- [ ] Run targeted sync-worker tests.
- [ ] Run `pnpm lint`.
- [ ] Run `pnpm build`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm test:safety`.
- [ ] Inspect final diff against the B8 base for unrelated refactors.
- [ ] Confirm no new direct `INSERT INTO notifications` path exists outside the existing B9 producer.
- [ ] Confirm migration number does not collide with B2 `0007_trusted_devices.sql`.
- [ ] Record confirmed bugs, regressions, false alarms, risks, final SHA and CI run in OWNER OFFICE.
- [ ] Mark B8 `READY_FOR_PEER_REVIEW`, not DONE.
- [ ] Request Claude review against the spec and final SHA.
