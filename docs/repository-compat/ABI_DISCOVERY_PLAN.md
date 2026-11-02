# VANTARA Runtime — inherited ABI discovery cohort

Goal: distinguish direct external references from host member lookups through extension classes, without claiming runtime linkage or implementing GPL dependencies.

Baseline:6a12a4f6. Production application and Android worker are unchanged. The native worker's20/API29+35 tests are recorded separately. No source websites or third-party execution.

- [x] Reproduce missed inherited member with authored DEX metadata fixture (five RED tests).
- [x] Parse bounded class_data declaration metadata, aggregate across DEX, report external ancestor lookup candidates, suppress local declarations.
- [x] Inspect four pinned published packages; discover their registerMainAPI host lookups without executing them.
- [x] Fresh review of this cohort: hierarchy bounds, overrides/interfaces, malformed declarations and metadata budget.
- [x] Address Important findings through RED→GREEN and update ABI requirements.
- [ ] Record final CI result in PR#301 after push.

No direct methodReferences compatibility break. An inherited lookup is an obligation for future host-profile resolution; it is not a guessed defining class, successful linkage or an implemented capability. Reflection and instruction-level data flow remain outside static evidence.

Review fix pass: two Important findings reproduced and corrected. Depth insertion-order inconsistency regraded Important because identical ancestry must not change admission verdict with encoding order;64-node boundary tested. Aggregate traversal limit is1,000,000 charged work units and256 visited nodes per lookup, in addition to metadata budget. Duplicate interface entries rejected. Class-method precedence does not incorrectly replace field precedence. Third-party execution still false. CI outcome is recorded in PR#301.
