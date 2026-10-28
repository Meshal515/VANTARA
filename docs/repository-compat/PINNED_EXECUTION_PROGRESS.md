# Published package execution gate

## Latest verified gate and reusable executor candidate

Run [40725070538](https://github.com/Meshal515/VANTARA/actions/runs/40725070538)
on984c1ae4 completed successfully on both API29 and35, including the newly added
published Anime4up search/details/episode/direct-video-link journey and the
unsupported-capability classification regression. The source responses in that
journey are deterministic authored HTML; this is not a live website or playback
claim. The preceding RED run40722580722 failed only the unsupported-capability
classification on both APIs; the published journey already passed there.

Task3 candidate: extract the five worker/client/IPC classes without changes into
the Android `:executor` library. The isolated service manifest moves with them;
the lab now exercises the same reusable artifact a future Debug adapter consumes.
Local app/test assembly and both library/application lint passed. Emulator tests
must run again on the moved code before the extraction is considered verified.
No original application files, identities, repositories or user stores change.

---

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

Run40714140987 on2175d5b3 exercised34 tests per platform. All original
process tests, four published registrations, catalogue parsing and the original
three blocking-read regressions passed. API29 had four failures and API35 two:
`fcntlInt` is a public API30 method, and reopening a peer-owned FIFO is not allowed
across isolated UIDs. No assertion was reduced to hide either regression.

The follow-up uses Unix stream socket pairs and per-call Linux nonblocking flags
for large body transport. These flags cannot be disabled by changing the shared
file-description status. Existing FIFO regressions remain and use independent
reopening only for descriptors they can safely reopen. The exact same full HTTP
request/response tests remain required. Two additional socket deadline/flag tests
and an actual Android disk-cookie test are added. The latter also guards against
accidentally using Java `List.of` (API30) on the lab's API29 minimum; replacing it
with `Arrays.asList` preserves the cookie namespace hash and requires no migration.
Android lint joins the build gate to catch minimum-API mistakes before execution.
The standalone lab pins lint8.13.2 through AGP's supported override: its bundled
older lint printed Kotlin2.2 metadata errors while returning success. The workflow
now rejects that diagnostic explicitly, and the newer lint completed locally with
zero errors and two lab manifest warnings (backup rules/icon). Production Gradle
plugins and signing settings are unchanged.

Run40718472023 on64372ed3 passed all37 native tests on each of API29 and35,
zero failures/errors/skips, plus47 JVM tests. Artifacts were downloaded and XML
checked. This includes actual Android cookie persistence, full cross-UID HTTP and
socket/FIFO cancellation/resource tests. All13 GitHub checks on that commit passed.
Filtered emulator logcat contains no FATAL EXCEPTION, ANR or OutOfMemoryError.

The next39-test candidate expands the published Anime4up fixture journey to search,
details, episodes and a direct video URL using its actual provider code. This is
extraction, not video playback or live-site proof. A separate authored regression
requires an unsupported runtime capability to remain distinct from a failed source;
that classification test is expected RED before its targeted worker fix.

Run40722580722 on352d66b5 ran39 tests per API:38 passed and exactly the
authored unsupported-capability regression failed, zero skips. The actual published
Anime4up search → details → episodes → direct video URL journey passed on API29
and35 using the local HTML transport. It does not download/play the video or prove
the live site. The failing classification returned PROVIDER_FAILED for a real
UnsupportedOperationException; the targeted fix returns CAPABILITY_UNSUPPORTED
without terminating a healthy generation or changing ordinary provider failures.
