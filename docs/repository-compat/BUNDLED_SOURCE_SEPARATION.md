# Follow-up release: detach bundled sources without losing existing users' sources

Status: QUEUED after runtime/manager acceptance. No source removal or migration
has run. Owner explicitly requests this follow-up; this document is an execution
queue and acceptance contract, not a claim that a scheduled automation exists.

## Required user-visible result

- An existing account keeps its current sources, installed packages, enabled
  flags, repository associations, settings, sessions and reading/watching progress.
  Previously bundled sources become ordinary independently managed packages,
  removable by the user. No app reinstall or manual reinstallation is required.
- A new account has zero preinstalled sources and repositories. A simple empty
  state uses readable white text and an add-source action. Do not populate fake
  works, report a lost library, or erase an existing library when sources are absent.
- Restoring an EXISTING account on a NEW device must still restore its eligible
  sources. A device-local upgrade marker alone cannot satisfy this requirement.
- Torrent, subtitles, translation, player, signing identities and account/device
  identities remain unchanged. No shared Git history rewriting.

## Ordered gates

1. Finish experimental Debug integration and verify actual source journeys and
   upgrade preservation. Test supported PWA/Windows adapters independently; they
   cannot execute Android DEX merely because the repository was parsed.
2. Inventory exact bundled source IDs, implementations, licenses, source settings,
   repository associations and all stored work/chapter/episode references. Match
   every removal candidate to an installable package with demonstrated behavior.
   Broken or unavailable replacements block that candidate's removal.
3. Inspect existing account backup/sync contracts before selecting a migration
   marker. Establish an authoritative pre-cutover account cohort without changing
   account identity. Keep the old-account entitlement portable across devices.
   Never infer "new account" solely from an empty local addon store or fresh APK.
4. Stage packages privately, validate integrity/format/provenance and exercise
   actual initialization and source functions before publishing registry entries.
   Persist an idempotent account-scoped migration journal. A failed download,
   invalid package, offline login, process death or disk-full failure must leave
   the previous usable state intact and resumable.
5. Preserve old source/work IDs through explicit logical aliases where required.
   Avoid display-name matching and content hashes as permanent package identity.
   Preserve disabled sources as disabled. Do not duplicate already installed
   replacements, collapse different users' settings, or reset health/progress.
6. Ship the migration while the old implementations remain available as rollback
   for existing users. Prove it on signed upgrade fixtures and restored accounts.
   Only after that proof remove each mapped implementation from the main app
   distribution and repository tree, retaining necessary migration metadata and
   all required notices. Newly created accounts get no default package installs.
7. Repeat acceptance on Debug, then independently on the intended Stable build
   after a selective code transfer. A Stable release remains a separate decision.

## Minimum upgrade test cases

| Account/device case | Expected result |
| --- | --- |
| Existing account, existing device, 47 sources | Same source IDs/settings/flags; independent package management |
| Existing account, new device | Restore the same entitled sources and user library |
| New account, clean installation | Zero default sources/repos; intentional empty state |
| New account on an existing shared device | No other account's packages/settings silently assigned |
| Existing account with already installed replacement | No duplicate source or rewritten work IDs |
| Disabled bundled source | Remains disabled after conversion |
| Offline or failed package staging | Prior working source retained; retry is bounded and resumable |
| Process killed before/during registry activation | Atomic old/new state; replay produces no duplicates |
| User removes converted package | Package removed intentionally; library/progress/aliases retained |
| Source website down or human challenge required | Honest status; no automatic UI or deletion |

## Distribution boundaries

Separating source packages from the application does not erase historical Git
objects or guarantee protection from a hosting complaint. Review redistributed
code/package licenses and preserve their notices. Use a factual release
description; do not claim a 90% risk reduction without evidence.
