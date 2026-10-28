# VANTARA Runtime — Android execution lab

This standalone app proves an original DEX execution boundary. It is **not** the VANTARA Debug/Stable app and it is **not** a completed CloudStream/Aniyomi/Mihon ABI implementation.

- Package: `dev.vantara.runtime.lab`; no production signing keys, account data, native-engine hooks, player, torrent or subtitle integration.
- Android 10/API29 minimum for independently named `bindIsolatedService` instances. Production VANTARA's SDK floor is unchanged.
- `api` defines the original `RuntimeProvider`/`RuntimeAccess` profile.
- `fixtures` builds authored Java bytecode into an external DEX with D8. Its provider implementations are absent from the host classpath and exist only in instrumentation assets.
- `harness` loads pinned DEX bytes through `InMemoryDexClassLoader` in an OS-isolated UID, validates its original profile, and exposes host-owned capabilities over Binder.

From the repository root, with Android SDK35 and build-tools35 installed:

```sh
bash android/gradlew -p extensions/runtime-android :harness:assembleDebug :harness:assembleDebugAndroidTest
bash tools/repository-compat/run_android_lab.sh
```

The second command requires a running Android API29+ emulator/device. CI runs API29 and API35. The report's fixture catalogue/page/video URL values are authored test data, not live sources or playback. Broker round trips use an explicit fixture transport; no source websites or production HTTP are requested.

A valid digest is integrity, not publisher authentication. The Python CS3 package inspector is a separate non-executing tool; this worker takes raw DEX for the original VANTARA profile, not an arbitrary CS3 or extension APK. Third-party ABI, controlled native dependencies/resources, production HTTP/cookie/storage brokers, API26–28 allocation and production UI adapters remain integration gates.

Source/session identity comes from immutable host scope and is checked against the exact worker UID/PID at the broker. Limits: 8MiB DEX, 65,536 UTF-16 code units per text value, 8,192 URL characters and 32 permitted origins. Timeout/cancel retire the generation; they do not reuse a possibly executing instance or erase source/user data. Exhausting all Binder control threads and system-wide resource exhaustion remain outside the proven guarantees.

Runtime code in this directory is original. No upstream engine implementation or provider binary is vendored. AndroidX Test uses Apache-2.0; transitive JUnit4.13.2 uses EPL-1.0 and belongs to instrumentation only, not the runtime host. See the engine study for provenance and licensing boundaries.
