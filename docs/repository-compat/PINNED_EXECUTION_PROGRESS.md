# Published package execution gate

The next Android lab candidate adds four offline registration tests using the
published SHA256-pinned CS3 packages in PACKAGE_OBSERVATIONS.json, plus three real
isolated-process full-HTTP Binder tests. None contact a source site. In particular,
AnimeRift source requests remain prohibited because of its publisher's IP-ban warning.

The worker now selects an explicit CloudStream profile and stages provider/extractor
registration until initialization completes. It passes only an isolated worker
Context, denies direct settings/system-service/Activity capabilities in the wrapper,
and keeps the original authored RuntimeProvider profile unchanged. Linux UID
isolation remains the security boundary; the Context wrapper is not a replacement
for it.

Full HTTP preserves request method/headers/body, redirect preference, actual response
status/headers/final URL and full response bytes. Bodies above8KiB use bounded FD
pipes to avoid the shared Binder transaction budget. Legacy text retains its64KiB
limit. Retiring a worker closes a lifecycle-aware host transport.

Local verification: application/test APKs compile; HTTP24 and CloudStream13 unit tests
pass. Four new registration tests and three IPC tests require API29/35 emulator
execution in GitHub Actions. Do not count them as passed before the XML results exist.

This gate proves plugin initialization/registration only when it passes. It does not
prove catalogue/search/details/episode parsing, extraction, playback, live-source
health, API26–28 support, production manager integration or app upgrade preservation.
Those gates remain open. No production application files or Stable stores changed.

## First actual run and justified follow-up

Run40707787166 (a3314eb4): API29 and35 each ran27 tests:26 passed,
one failed, zero skips. All20 original process tests and all three full-HTTP
IPC tests passed. AnimeWitcher, Anime4up and AnimeRift published initialization
passed. WitAnime died in its own main-looper background player monitor with
`NoClassDefFoundError: androidx.fragment.app.Fragment`.

The follow-up supplies the actual Apache-2.0 AndroidX Fragment dependency. The
isolated worker reports no foreground Activity (`null`) when polled; explicit
attempts to open an Activity remain unsupported. This does not expose or change
VANTARA's player. A regression now samples WitAnime's worker for3seconds after
initialization to avoid counting a race before its background callback as success.

A new descriptor-resolution test also reproduced five missing host ABI members
from the pinned packages (SearchResponseList builder/items and NiceResponse
body/parser/success). They have original implementations, with a paginated search
overload delegating to existing legacy search only for page1. Later pages are
explicitly unsupported unless the provider implements them.

Run40709198655 on5601dd56 passed all27 native tests on each of API29
and35, including all four published registrations and the extended WitAnime
background test. HTTP24 and profile15 tests passed in that workflow. This is
registration/lifecycle proof, not a live-source health verdict.

The next candidate tests actual Anime4up catalogue parsing against original
deterministic HTML delivered over the real isolated HTTP IPC. The package's
declared origin is pinned to `https://w1.anime4up.rest`; the fixture transport
opens no sockets. A legacy provider may implement `getMainPage` without a
`mainPage` section list. The new dispatcher invokes that real provider method
with the empty section request instead of incorrectly declaring it unsupported.
Four unit tests cover legacy/declared sections, base unsupported and honest search
pagination. HTTP also reproduces and fixes an encoding trap: a provider's explicit
`Accept-Encoding` header disabled OkHttp decompression. The broker now owns
negotiation/decompression and rejects unsupported encodings explicitly.

An independent read-only review identified unbounded worker-supplied pipe reads
before host admission. Three new native regressions intentionally expose trailing
writer descriptors, waiting for EOF after a complete frame, and a never-written
pipe. The next CI candidate is a RED reproduction gate for these new tests. It
must not be interpreted as a release candidate. Cookie path acceptance and response
charset preservation also require targeted fixes before further integration.

Run40711414466 on77a803b8 reproduced exactly the three pipe failures on
both API29/35:31 tests,28 passed,3 failed, zero skips per platform. The
published Anime4up catalogue fixture passed on both platforms, including actual
parsed name, absolute work URL and poster URL.

The security candidate now admits HTTP work before body parsing, rejects trailing
Parcel data, bounds local IPC reads/writes to2seconds and four active host writers,
and polls generation cancellation. Incoming FIFO reads reopen an independent
nonblocking file description instead of sharing mutable flags with untrusted code;
unsupported Android FD reopening fails closed. This capability must pass the actual
cross-UID HTTP tests before integration. Tests also cover exact-length completion,
cancellation, independent status flags and bounded unconsumed outbound writers.
No network timeout or existing process assertion was relaxed.

The same candidate fixes valid cross-path Set-Cookie acceptance/deletion and
preserves declared response media type/charset across the broker. The cookie-path
and Windows-1256 regressions failed before their fixes and pass locally afterward.
