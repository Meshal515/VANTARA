# Bounded Witcher media compatibility and UTF-8 allocation

Direct source diagnostics returned HTML for its Pixeldrain sharing page. The
page's own og:video pointed to the official same-host /api/file endpoint; a
bounded Range request returned206 video/mp4 with an MP4 ftyp header. This is
resource availability evidence, not proof of playback inside VANTARA.

The compatibility shim lacked that extractor. It also accepted any path ending
in .mp4 before consulting registered extractors; a sharing page with a filename
suffix could incorrectly become a direct-video candidate. Three new regression
cases failed before the fix. Registered extractors now take precedence. The
official Pixeldrain /u/<8-character-id> and /api/file/<id> forms map to its exact
HTTPS API endpoint. Streamtape sharing pages remain explicitly unsupported until
a real extractor is present; a filename suffix cannot pretend they are video.

The reviewed Witcher archive may receive the exact Pixeldrain origin only when
its own successful HTTPS Firestore server document declares a PD /u/<id> link.
Requested/final URL, project, document path, bounded JSON and exact media host
are checked. Foreign projects/packages, redirects, arbitrary hosts, credentials,
HTTP, query injection and non-media paths do not grant permissions. Immutable
worker scopes use the existing single permission-sync replay and original total
time budget. Scoped host-memory grants revoke on disable/package/account change.
No other media host or wildcard is authorized.

The required Android live suite retains the five-work metadata test and adds a
separate actual production PlayerActivity test, using real installed-package
candidates. It requires30 seconds of video-clock progress, sustained decoded
frames, bounded drops and successful forward/backward seeks. It is not a
synthetic video URL or a first-frame-only assertion. Device results are pending.

Publication of the preceding metadata fix was correctly blocked by API29:
JsonResultFrameTest.byteLimitStillAppliesToMultibyteText hit an OutOfMemoryError
in CharsetUtils while allocating6000016 bytes with only5626120 free. The code
encoded the full string before checking its4MiB byte limit. A preflight now
counts UTF-8 bytes without a large allocation and rejects oversize text before
encoding or writing a success frame. The original multibyte rejection assertion
remains, strengthened to require an untouched Parcel. No heap/timeout/assertion
relaxation is used. JVM tests cover exact byte boundaries, mixed scripts,
supplementary pairs and unpaired-surrogate compatibility.

Main/Stable, existing source engines, player, torrent, subtitles, account data,
signing identities and databases are unchanged. Rift remains restricted; these
changes make no claim of live Rift support or complete CloudStream compatibility.
