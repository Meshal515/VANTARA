# HTTP and original CloudStream profile — experimental, not production integrated

The standalone lab now contains a real OkHttp HTTP broker and an originally authored
CloudStream/NiceHttp public-contract profile. Neither is included in Stable or the
existing APK runtime. Existing providers, player, torrent, subtitles and accounts
have not been changed.

## Evidence collected locally

- HTTP: 24 JUnit tests passed, zero failures/errors/skips. These include real TLS
  loopback sockets, redirect/origin/DNS enforcement, request/response preservation,
  response bytes larger than 64KiB, resource limits, rate limiting, cancellation,
  non-interactive challenge classification and account/source cookie isolation.
- Five of those tests reconstruct cookies from disk. They preserve an unrelated
  library sentinel, test every identity dimension, deletion/path behavior, two
  vault handles, and explicit failure without deletion for corrupt owned files.
  This is not an Android app upgrade or force-stop test.
- CloudStream profile: nine local contract tests passed, zero failures/errors/skips.
  Builders preserve content/episode metadata; raw client clones preserve application
  interceptors/redirect flags while using the installed transport. Missing transport,
  unsupported operations and attempts to disable TLS fail explicitly.

## Reproduced defects prevented in the new broker

1. Inheriting a host client's application/network interceptors could execute legacy
   interactive verification. The broker removes those interceptors. A failing
   regression installed a legacy interactive interceptor, then passed after isolation.
2. Inheriting an account-independent HTTP cache could return account A's content to
   account B. The broker disables inherited cache; the TLS regression requires two
   distinct server responses for the same URL.
3. IPv4-mapped IPv6 and NAT64 representations could bypass the private-address filter.
   The resolver policy handles mapped addresses and the well-known NAT64 prefix,
   rejects the local-use prefix, and checks the connection's actual DNS result.

These findings concern the new broker design; they are not evidence that these
defects explain previously reported Stable crashes.

## Boundaries still open

- Real published CS3 packages have not yet executed against this profile.
- Full HTTP exchange is not yet connected to the isolated worker IPC.
- Persistent cookie files require a dedicated host-private directory and a single
  owning vault controller. They do not import, migrate or erase existing user stores.
- Explicit response caching, network interceptors, arbitrary UI/Activity APIs,
  unsupported extractors and resource-dependent plugins are not silently emulated.
- Aniyomi/Mihon manager integration and Android upgrade/device acceptance are pending.
- No AnimeRift source-site traffic is authorized by this test plan.

The four-stage plan remains incomplete. No Stable merge or release is warranted by
these contract tests alone.
