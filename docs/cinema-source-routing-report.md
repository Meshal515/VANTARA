# Cinema source repair — replacement debug

Base: main `e582887372d341fdeb38872a5757afbf8c389658`. Branch: `fix/cinema-source-routing`.

This debug supersedes the earlier Cinema debug. No main merge or release is authorized until the requested device playback gate succeeds.

## Observed source pipeline, 2026-10-01

**HTTP** below means a live website/host response from this workspace, not execution of an extension APK on a phone. All four published extension APK downloads match their manifest SHA-256. Android extension execution, decoder playback, sound and device-network behavior still require the replacement APK on the physical phone.

| Source | Old cause | Repair | Search | Details | Episodes | Servers | Playback | Status |
|---|---|---|---|---|---|---|---|---|
| EgyDead 14.29 | Genuine mirror `m6o3p.sbs` rejected as foreign; server page needs `View=1` POST | Vetted mirror in domain plan; declarative server POST fallback, extension first | Shameless HTTP verified | US 2011 HTTP verified | 11 seasons; first season 12 episodes HTTP verified | Four hosts HTTP verified | Mixdrop extracted live MP4; HTTP206,1024bytes,`ftyp`; phone pending | Strongest observed pipeline; device test pending |
| ArabSeed 14.31 | Dead old DNS/domain, migration to MySeed; query and CSS changed | Verified `m.myseed.pics`, old hosts retained as legacy; find→word; manifest search/details/own-episode/watch-server fallback | 40 Shameless source cards HTTP verified | Selected Shameless episode page HTTP verified | Its season's 12 episodes; unrelated recommendations excluded | Eight embed entries HTTP verified | Several old hosts fail or are blocked; phone/media success not proven | Parser/domain repair verified; end-to-end playback pending |
| Cimaleek 14.11 | Foreign redirect to unverified `www433.b2cima.click` | Keep working current `.pw`; exact migration candidate requires source fingerprint; arbitrary sibling hosts rejected | Correct Shameless series HTTP verified | 11 seasons HTTP verified | Season1,12episodes HTTP verified | Watch page Cloudflare403 in workspace | Not proven | Candidate returns520 here; identity/device verification pending |
| FaselHD 14.28 | System DNS fails; IPv4 timeout; usable/cache may omit IPv6 | Fasel-only AAAA retention and live IPv6 preference; existing OkHttp Happy Eyeballs retained | Workspace Cloudflare403 | Blocked | Blocked | Blocked | Not proven | Direct phone IPv4/IPv6 and full pipeline pending |

## Scope and protections

- No source added; no Cinema native adapter added; existing ExtensionAdapter stays first.
- Each opted Cinema HTTP redirect is checked before contacting its destination. Unknown destinations, protocol changes, and candidate siblings are refused. Direct candidate responses require identity proof. Only verified promotion updates the active host.
- Anime manifest entries and default routing/DNS/browser behavior are retained. Cinema resolver clones carry a request-scoped no-browser tag, so the same host can still use Anime's existing fallback. A challenged Cinema source is skipped without a human/browser UI. This intentionally cannot make a human-gated website available.
- Diagnose reports extension load, effective domain and redirect verdicts, system/DoH DNS, separate bounded IPv4/IPv6 TLS probes, matched work, details, actual selected season/episode URL, server failures, fresh media URLs and media-byte tests. Extracted URLs and HTTP success are explicitly distinguished from Android playback.
- Source changes are declarative: extension APK/version/SHA, priority/content, vetted domain plans and optional parser hints. Unseen domains are not automatically trusted.

## Verification and release gate

Local checks: web458/458, build/typecheck pass, repository safety47/47. Focused native checks include unchanged AnimeNet tests, real refused-redirect request counters, IPv6 cache transitions, captured MySeed DOM, HLS segment/header validation, and scoped Cinema/Anime browser behavior. Full Android assemble/unit tests are run by the debug branch workflow.

**Main remains pending**: the user explicitly requires successful APK build, tests, at least one physical-phone source playback and no Anime regression before merge. No phone/adb is attached here. On the replacement debug, test Shameless from EgyDead first, verify picture/sound/seek, then the other three; also play an Anime episode. Keep Diagnose results for any source that fails. Do not label all four sources healthy based only on search or this workspace's HTTP probes.
