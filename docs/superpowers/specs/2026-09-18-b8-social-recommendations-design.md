# B8 — Social Activity & Recommendations Design

**Date:** 2026-09-18  
**Owner:** ChatGPT  
**Branch:** `chatgpt/b8-social-recommendations`  
**Base:** `claude/dreamy-faraday-w9rtsp`  
**Status:** DESIGN — approved in chat, implementation not started yet

## Goal

Build VANTARA's social backend without adding chat.

The social surface is a shared activity feed for the three accounts. Real actions performed inside VANTARA generate feed events and, when targeted, internal notifications. A user can inspect friends, presence, reading activity and aggregate stats. Recommendations are visible socially, but response state is independent per recipient.

## Non-goals

- No private chat, group chat, arbitrary text messaging or chat threads.
- No OS push notifications.
- No full privacy-settings system in B8. Existing incognito/privacy behavior must be respected; fine-grained privacy is deferred.
- No frontend screen implementation. B8 delivers backend/domain contracts. UI work remains behind the frontend phase/B12 integration gate.
- No broad refactor of the sync architecture.

## Product model

### Friends

The friend list contains the three configured VANTARA accounts.

Each row can expose:

- identity/profile: username, display name, avatar, banner, bio;
- live presence:
  - green when currently online;
  - red/offline otherwise;
  - examples: `في المكتبة`, `يشاهد Lookism — الفصل 500`;
- last seen when offline.

Presence is derived from the existing D1 `presence` record and beat age. It is not stored as a second truth. Existing incognito/redaction rules remain authoritative.

### Friend profile

A friend profile contract may expose:

- avatar, banner, bio;
- top 5 works;
- unique chapters completed;
- repeat chapter reads;
- total chapter reads;
- active time spent in VANTARA;
- recent reading;
- live/current reading state when present.

Definitions:

- **يشاهد الآن** = a live presence/session state.
- **يتابع حاليًا** = recent/ongoing interest derived from reading/library data; it does not imply the app is currently open.

B8 must derive these from existing D1 social/stat tables and not create a competing reading-history source of truth.

### Social activity feed

The feed is not chat. It is a server-authored journal of meaningful actions that actually succeeded.

Initial B8 event types:

- recommendation sent;
- work rating changed;
- comment created;
- reaction changed.

The feed must not generate an event merely because the client claims that an event happened. The old generic `activity.add` path is treated as an architectural risk and is not used for new B8 producers.

Low-value/noisy actions such as opening a screen or reading a page do not create feed events. Chapter completion remains in stats/presence for B8 unless a later product decision explicitly promotes it into the feed.

Each feed event has a stable deep link chosen by the server:

- work rating → work page;
- recommendation → recommended work/recommendation card;
- comment → the specific comment context in the chapter;
- reaction → the comment that received the reaction.

The client does not infer routing from free-form payload text.

## Delivery and seen receipts

The UX distinguishes three states:

1. **Pending** — local action has not yet been acknowledged by the server. UI may show a small waiting indicator.
2. **Sent/accepted by server** — the originating operation was accepted. This is the single purple sent state.
3. **Delivered/seen by people**:
   - recipient app acknowledges delivery after it has actually received/applied the event;
   - when a user has seen the feed item, their avatar may be shown under the card.

Receipts are per user and per activity event. They are not represented by one global boolean.

Backend contract:

- `activity_receipts(event_id, user_id, delivered_at, seen_at)`.
- Delivery/seen timestamps are monotonic: seen implies delivered; neither may go backwards.
- The sender is not a delivery recipient for their own event.
- Receipt writes are idempotent.
- B8 only defines backend state and operations; exact viewport/visual trigger is a frontend concern.

## Recommendations

### Recommendation object

A recommendation is one social object:

- sender;
- optional named target;
- work reference;
- message;
- creation time.

Target semantics:

- `to_id = user`: everyone may see the feed card, but only the named recipient is actionable/mentioned.
- `to_id = NULL`: broadcast to all accounts except the sender; every other account is a recipient.

### Per-recipient state

The existing single `recommendations.state` cannot represent independent responses for multiple recipients. B8 therefore introduces a recipient table.

`recommendation_recipients`:

- `recommendation_id`;
- `user_id`;
- `state`: `PENDING | ACCEPTED | REJECTED`;
- `intent`: nullable `WATCH_NOW | WATCH_LATER | ADD_TO_LIBRARY`;
- `responded_at`;
- `rev`.

Primary key: `(recommendation_id, user_id)`.

The recommendation row itself remains the shared immutable event. Recipient state is the mutable per-user response.

### Reject

Reject only changes that recipient state to `REJECTED`.

It performs no library/collection action and does not delete the recommendation.

### Accept

Accept changes that recipient state to `ACCEPTED`, then the client asks:

> ماذا ستفعل بهذا العمل؟

Initial actions:

- **WATCH_NOW** — open the work now; no persistent collection side effect is required by the recommendation response itself.
- **WATCH_LATER** — add the work to the existing `read_later` collection.
- **ADD_TO_LIBRARY** — request the existing library-add flow.

Acceptance and intent are separate facts. The server must not silently add a work merely because the user pressed Accept.

For persistent intents, the action must use the existing owner contract:
- read later → D1 collection operation;
- library → Uchiyomi/library owner path, not a duplicate D1 truth.

### Visibility

Everyone may see the recommendation card and recipient response states.

Examples:

- `NGM — قبل · سأشاهده لاحقًا`
- `Mansour — رفض`

Only actual recipients may mutate their own recommendation state.

## Notifications

B8 must use B9's existing general notification producer:

- `notificationTargets(...)`
- `notificationStatements(...)`

B8 must not write `notifications` directly.

Targeted notification producers:

- recommendation → recipient(s);
- comment reply → parent comment author, excluding self;
- reaction → comment author, excluding self.

General feed activity does not automatically create an inbox notification. A rating visible in the feed is not by itself a notification-worthy event.

Recommendation row + recipient rows + notification rows must be written in the same D1 `batch()` as the originating operation when possible, preserving all-or-nothing behavior.

Cloudflare's current D1 contract states that batched statements execute sequentially as a SQL transaction and roll back as a unit on failure. B8 relies on that property.

## Activity generation

New activity rows are server-derived from successful operations.

For each supported operation, the Worker constructs a deterministic social event using the originating `op_id`:

- `recommendation.send` → recommendation feed event;
- `rating.set` → rating feed event;
- `comment.add` → comment feed event;
- `reaction.set` → reaction feed event.

The activity event ID is derived from the operation ID so client retry cannot duplicate the feed.

The event is generated in the same atomic D1 batch as the source write.

The existing generic `activity.add` operation is not expanded. B8 should either stop using it for new flows or explicitly mark it legacy-compatible; removing it outright is deferred unless code/history proves removal is safe.

## Activity schema additions

B8 extends `activity` with structured routing/mention data rather than forcing consumers to parse arbitrary JSON:

- `target_user_id TEXT NULL` — mention/target when applicable;
- `link TEXT NULL` — canonical deep link;
- existing `verb`, `series_ref`, and `payload` remain for compatibility.

A separate `activity_receipts` table records per-viewer delivery/seen state.

## Social query contracts

B8 adds read contracts owned by the Sync Worker/D1 social backend.

### GET /v1/social/friends

Returns friend-list rows:

- profile identity;
- redacted presence;
- derived online/offline status;
- last-seen age/timestamp when allowed;
- short status text.

Must reuse the same incognito/redaction domain logic as `/v1/presence`.

### GET /v1/social/profile/:userId

Returns:

- public profile fields;
- live/redacted presence;
- top 5 works derived from existing reading/rating data;
- unique/repeat/total chapter counts;
- active time;
- recent reading.

The endpoint may return a partial profile if one optional stat source has no rows; it must not invent zeroes when data is unavailable due to a backend failure.

### GET /v1/social/feed

Cursor/pagination based feed query.

Returns activity events plus:

- actor profile descriptor;
- target/mention descriptor when any;
- work descriptor when any;
- canonical link;
- receipt summary suitable for rendering viewer avatars;
- recommendation recipient states when event is a recommendation.

The endpoint must avoid N+1 queries. With only three users, correctness is primary, but the contract should fetch descriptors/receipts in bounded grouped queries.

## Sensitive-content handling

Fine-grained privacy settings are deferred, but B8 must not create a new path that bypasses existing content-policy/adult-content gates.

A recommendation/feed card may later be rendered blurred/hidden by client policy. B8 preserves enough structured work metadata for the policy layer to decide, but B8 does not implement the consent UI.

Do not bake the humorous consent copy into backend logic.

## Data ownership

No ownership changes:

- profiles/presence/activity/comments/reactions/recommendations/settings → D1;
- reading/library truth → Uchiyomi;
- downloadable pages/cache → device;
- operational policy → Postgres;
- identity/session → identity layer.

New B8 tables are D1 social data:
- `recommendation_recipients`
- `activity_receipts`

Update the ownership matrix so CI continues to enforce single ownership.

## Error handling and authorization

- Unknown recommendation → 404-style domain result, not silent creation.
- Non-recipient attempting recommendation response → forbidden.
- A recipient may only mutate their own response.
- Unknown/invalid intent → rejected before write.
- Replaying the same operation ID is idempotent.
- Notification generation failure inside the atomic batch must fail the source operation rather than create recommendation-without-notification drift.
- Feed read failures must not mutate social state.
- Server logs must not include access tokens, signed media URLs or private payload dumps.

## Migration strategy

Create the next unambiguous D1 migration number after reconciling the branch migration sequence at execution time.

Migration responsibilities:

1. add structured activity routing columns;
2. create `activity_receipts`;
3. create `recommendation_recipients`;
4. backfill recipient rows for existing recommendations where possible:
   - targeted recommendation → one recipient;
   - broadcast recommendation → all current accounts except sender.

Backfill must not invent acceptance/rejection. Existing rows become `PENDING`.

The legacy global `recommendations.state` remains temporarily for compatibility but is no longer authoritative after B8. Physical removal is deferred to B12 once all consumers have moved.

## Testing strategy

TDD is mandatory.

Required regression/contract coverage:

- broadcast recommendation creates one independent recipient state per non-sender account;
- one recipient can accept while another rejects without overwriting each other;
- non-recipient cannot respond to targeted recommendation;
- reject has no collection/library side effect;
- accept + WATCH_LATER generates the existing read-later operation/contract, not a second collection implementation;
- accept + ADD_TO_LIBRARY routes to the existing library owner contract;
- duplicate op ID cannot duplicate recommendation, recipient states, activity event or notification;
- recommendation + notifications are atomic under D1 batch construction;
- rating/comment/reaction create one deterministic activity event from the real operation;
- generic client-authored activity is not required for those events;
- comment reply/reaction notifications exclude the actor;
- receipt state is monotonic and per viewer;
- friend/presence query respects incognito redaction;
- profile aggregate math distinguishes unique reads, repeats and total;
- feed links are server-generated and point to the intended entity;
- full repository safety, lint, build, typecheck and tests pass.

## Definition of Done for B8

B8 is READY_FOR_PEER_REVIEW when:

- all new schema/domain/Worker contracts above exist;
- migrations are deterministic and migration numbering has no collision on the B8 base;
- TDD evidence exists for each new behavior;
- full CI is green on the final SHA;
- the ownership matrix is updated;
- no new direct writer to `notifications` exists outside B9's producer;
- no chat/message subsystem was introduced;
- OWNER OFFICE records the final SHA, CI run, confirmed bugs/regressions if any, false alarms and known risks.

B8 is not self-closed by its implementer; peer review is required.
