# VANTARA Runtime — isolated Android execution

## Intent

Expand the repository engine study beyond issue reports, and implement the execution boundary with observable Android behavior. Existing VANTARA engines, torrent/player/subtitles, accounts and storage are unchanged. This is a separate harness application, not an APK update or a claim that CloudStream ABI is implemented.

## Decision

Original Java API and Binder protocol, independent Gradle project under extensions/runtime-android. API 29+ bindIsolatedService creates a unique OS-isolated process per worker generation; this harness floor does not change VANTARA's minSdk. Load bounded SHA-256-pinned DEX through InMemoryDexClassLoader. No upstream implementation code, binaries or app resources are bundled.

A shared-process loader is simpler but cannot contain process exit/OOM. A second process sharing the app UID still has account/file permissions. An Android isolated process has a distinct UID and no inherited app permissions; host-owned IPC capabilities provide only specific services. Public Android class loading contracts are used, not copied loader implementation.

## Trust and lifecycle

Host passes a read-only DEX descriptor, expected digest and explicit entry point. Worker rechecks digest and length. The original RuntimeProvider API has initialize and invoke; registration is published only after initialization succeeds. No Activity, Context, account store, preferences or WebView is passed to a provider. Isolated process death is a typed runtime failure, not a dead-source verdict. Each new generation receives a distinct service instance.

Network requests go through a host Binder capability capturing source/session identity. Plugin arguments cannot supply that identity. Host validates allowed HTTPS origins, request/response length and supported operations before calling an explicitly supplied transport. This phase uses deterministic fixture transport only, with no production HTTP, redirects, DNS broker, cookies or live source traffic. No claim of comprehensive sandbox/SSRF protection or IP-ban prevention follows from these tests.

Calls use a bounded one-at-a-time executor. Timeout/cancel closes that generation and requests process termination over a separate Binder control transaction. Tests must prove actual process death/rebind, not just object recreation. Binder process death and initialization failures close the lease; no automatic restart loop. Cooperative control failure cannot guarantee instant termination of a malicious worker exhausting all Binder threads; fail closed, do not reuse it.

## Evidence required

An authored external DEX (not provider classes compiled into the host) executes catalogue/search/details/chapters/pages/episodes/videoLinks fixtures. Test a distinct UID/PID, successful broker round trip with trusted identity, host-file denial, INTERNET permission denial, bad digest, failed initialization without publication, a thrown provider error, real process exit/restart and noncooperative operation timeout. The host storage sentinel must persist. Tests do not prove third-party CS3/APK ABI or real source playback.

## Integration gate

No production registration until family ABI profiles implement real semantics and actual packages pass search/catalogue/details/chapters or episodes/link tests. API 26–28 execution requires a separately tested worker allocation path. Windows/PWA do not gain DEX execution from this Android module.
