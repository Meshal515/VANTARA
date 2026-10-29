# Witcher source-owned settings migration

The installed published archive still matches the reviewed4c639f93 SHA256.
Its bootstrap Algolia application is D8LH9I7ZL7; the source's real Firestore
Settings/constants currently declares TVNESH8OZY. A real request with the declared
settings returned HTTP200 and five actual recent works. The old fixed origin set
blocked that legitimate migration with ORIGIN_NOT_ALLOWED. The previous offline
fixtures returned200 from the bootstrap app, so they did not exercise refresh.

The host now accepts an exact replacement origin only from a200 GET response
whose requested AND final URLs identify that reviewed source's own HTTPS
Firestore project/settings document. The application ID must be ten ASCII
alphanumeric characters. Other packages, projects, paths, redirects, malformed
settings and arbitrary/wildcard/private domains do not grant access. No API key
or cookie is cached or logged by this feature.

Each worker keeps an immutable origin set. A read-only source operation may be
replayed once after a newly attested migration; both attempts share the original
10s load +15s operation total budget. No timeout is increased. The latest exact
origin is retained only in host memory for that account/package/hash/source,
and the stale bootstrap origin is retired. Disable/update/uninstall, account
change and host close revoke the cached permission. No wildcard or SSRF/TLS/
redirect/cookie-isolation guard is removed.

Four policy cases were observed RED/GREEN. The added native regression uses the
actual published DEX, bootstrap403, authored settings and replacement API200;
it requires one permission replay, reuse on the next call and revocation on
disable/account changes. A separate REQUIRED live Android test uses the real
broker and original package to verify catalogue/search/details/episodes for five
distinct works. These tests must pass before publication. Metadata success is
not video playback acceptance; Rift live traffic remains denied, unchanged.
