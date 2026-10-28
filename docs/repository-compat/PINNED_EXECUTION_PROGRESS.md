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
