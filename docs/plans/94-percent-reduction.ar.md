# VANTARA — 94% انخفاض (Debug only)
 
## Policy
The global collector cadence is 48 AniList + 12 Cinemeta series + 4 Cinemeta movie jobs per UTC day, vs 1080 previously (94.07% fewer scheduled global collector jobs, not a claim about total Workers or D1 usage).
 
- hybrid (migration default): legacy manga unchanged; global schedule reduced.
- manga-local: no legacy manga collector jobs; old manga observation/snapshot writes rejected, global schedule retained.
- exclusive: all legacy content collector jobs stopped; old observation/snapshot writes rejected. Historical reads, account maintenance, backup/restore and friend signals remain available. This may reduce anime/cinema coverage until their local identity and provider support is proven.
- Only the active owner can change the shared server policy. The Debug UI requires completed local migration before enabling the local modes. It displays server-confirmed state and last collector attempts, not inferred request counts.
- Existing historical data and durable pending legacy reports are retained; no destructive migration. Previously running collector invocations may finish after a switch; check later timestamps. Other already-open devices may require re-opening to refresh policy. Old clients may retry a rejected legacy write; update them before a shared switch.
 
## Before publishing
This branch is an isolated implementation, not a deployed Worker or a released APK. The complete repository could not be checked out in this environment. The exact pure scheduler logic was independently checked across 1440 minutes (64 global jobs, no global collisions; exclusive zero). Vitest, full CI, and device validation have not been executed.
 
1. Integrate the latest Debug base without losing its independent verification fixes.
2. On a full checkout, recompute the existing shell cache fingerprint using the existing safety gate:
 
```bash
python3 - <<'PY'
import hashlib, pathlib, re
root = pathlib.Path('apps/web')
sw = root / 'sw.js'
source = sw.read_text()
digest = hashlib.sha256()
for asset in re.findall(r"^\s*'(/[^']+)',$", source, re.M):
    digest.update(asset.encode())
    digest.update((root / ('index.html' if asset == '/' else asset[1:])).read_bytes())
sw.write_text(re.sub(r"const SHELL_DIGEST = '[^']+';", "const SHELL_DIGEST = '" + digest.hexdigest() + "';", source))
PY
node --test tools/repository-safety.test.mjs
node tools/repository-compat/scope-guard.mjs
pnpm exec vitest run services/sync-worker/src/collector-policy.test.ts services/sync-worker/src/collectors.integration.test.ts services/sync-worker/src/admin.integration.test.ts apps/web/lib/update-engine-local.test.js
```
 
3. Run Worker typecheck and full relevant CI. Build isolated Debug artifact, test on real Android/Windows devices.
4. Test migration 0055 against an isolated D1 clone; verify data, owner authorization, rollback, backup/restore, friend signals, and zero subsequent scheduled content fetches in exclusive mode. Do not deploy to production from this branch or modify production deployment rules.
5. Compare seven-day usage and CPU/SQL quota behavior before downgrading Cloudflare. No observed account-wide 94% reduction has been established. The personal cinema calendar is a separate future feature, not implemented here.
