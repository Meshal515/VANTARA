# Experimental runtime dependencies

The `cloudstream` implementation is original interoperability code. Public ABI names
do not mean upstream implementation was imported.

`cs3world` (since 14 Nov 2026, AGPL-3.0 project license) packages CloudStream's own
library `com.github.recloudstream.cloudstream:library-jvm:4.9.1` (GPL-3.0) with its
runtime graph (NiceHttp 0.4.18 GPL-3.0, NewPipeExtractor GPL-3.0, Rhino MPL-2.0, Ktor,
ksoup, cryptography-kotlin, Jackson, kotlinx: Apache-2.0/MIT) as a separate class-loader
world for the isolated worker. Every file is pinned by SHA-256 in `cs3world/world.lock`;
the build fails on any unexpected or changed file.

Direct runtime dependencies, preserved as Maven artifacts with their license metadata:

| Dependency | Version | License |
| --- | --- | --- |
| OkHttp | 5.3.2 | Apache-2.0 |
| Kotlin standard library | 2.2.21 | Apache-2.0 |
| Kotlin coroutines | 1.8.1 | Apache-2.0 |
| Kotlin serialization JSON | 1.8.1 | Apache-2.0 |
| Jackson Kotlin module | 2.18.4 | Apache-2.0 |
| jsoup | 1.22.2 | MIT |
| AndroidX Fragment | 1.6.2 | Apache-2.0 |

JUnit 4.13.2 (EPL-1.0), MockWebServer/okhttp-tls (Apache-2.0) and AndroidX tests
(Apache-2.0) are test dependencies. No third-party CS3 provider package is committed
or shipped with this lab. Any later distribution must retain the applicable dependency
licenses/notices and assess the separately obtained provider package's license.
