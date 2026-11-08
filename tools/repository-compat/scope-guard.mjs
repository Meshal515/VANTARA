/** Pin the current Debug baseline and admit only the explicitly reviewed integration seams. */
import {execFileSync} from 'node:child_process';
// Recovery sprint inherits the inspected Nov 1 Debug video-engine branch.
// This pin is not a claim that its live-provider or player gates passed.
const base='7a266dac8492471948931d3a4e1f600836b44b06';
const lines=execFileSync('git',['diff','--name-status','--no-renames',base],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const prefixes=['extensions/runtime-core/','extensions/runtime-android/','tools/repository-compat/','docs/repository-compat/','docs/addons/'];
// Owner's server-delivery and installation journey regressions. Exact seams;
// no broad legacy allowance and no change to the pinned protection baseline.
const deliverySeams=[
  'android/app/src/main/kotlin/com/vantara/anime/stream/Prepared.kt',
  'android/app/src/test/java/com/vantara/anime/CinemaFastPathTest.kt',
  'android/app/src/test/java/com/vantara/plugins/NativeIconPngStoreTest.kt',
  'android/app/src/androidTest/java/com/vantara/anime/LiveDeliveryUiDeviceTest.kt',
  'apps/web/v35/anime-picker-lifecycle.test.js',
  'apps/web/v35/cinema-picker-lifecycle.test.js',
  'apps/web/v35/server-sheet-lifecycle.test.js',
  'apps/web/v35/shell-addon-navigation.test.js',
  '.github/workflows/addon-delivery-ui-qa.yml',
];
// Owner-authorized handoff verification: run the existing native playback gate on Debug too.
const seams=new Set(['.github/workflows/addon-runtime.yml','apps/web/v35/server-sheet-add-source.test.js','apps/web/lib/source-entitlement.test.js','apps/web/lib/source-entitlement.js','apps/web/lib/extension-engine-entitlement.test.js','apps/web/v35/works.js','apps/web/lib/extension-engine.js','apps/web/app.js','.github/workflows/android-debug.yml','android/settings.gradle','android/app/build.gradle','android/app/src/main/kotlin/com/vantara/anime/AnimeEngine.kt','android/app/src/main/kotlin/com/vantara/anime/episodes/EpisodeResolver.kt','android/app/src/main/kotlin/com/vantara/anime/RuntimeSourceBinding.kt','android/app/src/main/kotlin/com/vantara/anime/bridge/AnimeEnginePlugin.kt','android/app/src/main/kotlin/com/vantara/anime/registry/Manifest.kt','apps/web/addons/cloudstream-runtime.js','apps/web/addons/cloudstream-runtime.test.js','apps/web/addons/native-catalog.js','apps/web/addons/runtime.js','apps/web/pwa/boot.js','android/app/src/test/java/eu/kanade/tachiyomi/network/HttpsUpgradeTest.kt','spike/extension-engine/app/src/main/kotlin/eu/kanade/tachiyomi/network/interceptor/HttpsUpgradeInterceptor.kt','android/app/src/main/kotlin/eu/kanade/tachiyomi/network/interceptor/HttpsUpgradeInterceptor.kt','android/app/src/test/java/eu/kanade/tachiyomi/network/UncaughtLinkageTest.kt','spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/SourceCompatRepairs.kt','spike/extension-engine/app/build.gradle.kts','spike/extension-engine/app/src/main/kotlin/eu/kanade/tachiyomi/network/interceptor/UncaughtExceptionInterceptor.kt','android/app/src/main/kotlin/eu/kanade/tachiyomi/network/interceptor/UncaughtExceptionInterceptor.kt','android/app/src/main/kotlin/dev/vantara/spike/SourceCompatRepairs.kt','.github/workflows/apk-sources-live.yml','spike/extension-engine/app/src/main/kotlin/eu/kanade/tachiyomi/network/interceptor/CloudflareInterceptor.kt','android/app/src/main/kotlin/eu/kanade/tachiyomi/network/interceptor/CloudflareInterceptor.kt','apps/web/v35/work-looks.test.js','apps/web/v35/anime-hero-race.test.js','apps/web/v35/addon-profile-boot.test.js','android/app/src/test/java/com/vantara/plugins/ExtensionFailureTest.kt','android/app/src/main/kotlin/com/vantara/plugins/ExtensionFailure.kt','apps/web/lib/host-breaker.js','apps/web/lib/host-breaker.test.js','apps/web/lib/plugin-vault.js','apps/web/lib/plugin-vault.test.js','apps/web/lib/plugin-failure.js','apps/web/lib/plugin-failure.test.js','apps/web/pwa/sources/registry.js','apps/web/pwa/sources/plugin-persistence.test.js','apps/web/pwa/runtime.js','apps/web/desktop/runtime.js','apps/web/addons/registry.js','apps/web/addons/transport.js','apps/web/addons/persistent-addons.test.js','apps/web/addons/adapters/stremio.js','services/sync-worker/wrangler.toml','services/web-fetcher/wrangler.toml','spike/extension-engine/app/src/main/kotlin/eu/kanade/tachiyomi/network/interceptor/HostCircuitBreaker.kt','android/app/src/test/java/eu/kanade/tachiyomi/network/HostBreakerTest.kt','android/app/src/main/kotlin/eu/kanade/tachiyomi/network/interceptor/HostCircuitBreaker.kt','spike/extension-engine/app/src/main/kotlin/eu/kanade/tachiyomi/network/NetworkHelper.kt','android/app/src/main/kotlin/eu/kanade/tachiyomi/network/NetworkHelper.kt','android/app/src/main/kotlin/com/vantara/plugins/NativeExtensionIcons.kt','spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/FileExtensionLoader.kt','android/app/src/test/java/com/vantara/plugins/UserExtensionVaultTest.kt','android/app/src/test/java/com/vantara/plugins/RepoIndexTest.kt','android/app/src/main/kotlin/dev/vantara/spike/FileExtensionLoader.kt','android/app/src/main/kotlin/com/vantara/plugins/UserExtensions.kt','.github/workflows/web-debug.yml','apps/web/lib/route-validity.test.js','apps/web/lib/route-validity.js','apps/web/v35/cinema.test.js','apps/web/v35/cinema-playback.test.js','apps/web/v35/anime-playback.test.js','apps/web/lib/source-states.js','apps/web/lib/route-failure.test.js','apps/web/desktop/player.test.js','android/app/src/test/java/com/vantara/plugins/BuiltinSourceRefreshTest.kt','android/app/src/main/kotlin/com/vantara/plugins/BuiltinSourceRefresh.kt','android/app/src/main/kotlin/com/vantara/plugins/ExtensionEnginePlugin.kt','android/app/src/test/java/com/vantara/anime/RockResolutionTest.kt','android/app/src/test/java/com/vantara/anime/RateAndResolveTest.kt','android/app/src/test/java/com/vantara/anime/ManifestFileTest.kt','tools/repository-safety.test.mjs','apps/web/pwa/sources/engines/index.js','apps/web/pwa/sources/defs.json','apps/web/anime/sources.json','apps/web/styles.css','apps/web/v35/together.css','apps/web/v35/majlis.css','apps/web/v35/rafiq.css','apps/web/v35/social.css','apps/web/v35/reader.css','apps/web/lib/anime-meta.test.js','apps/web/lib/anime-meta.js','apps/web/v35/work-looks.js','apps/web/v35/appearance.test.js','apps/web/v35/appearance.js','apps/web/v35/core.css','apps/web/v35/cinema.js','apps/web/lib/together/art.js','apps/web/lib/cinema-meta.js','apps/web/lib/anime-art.test.js','apps/web/lib/anime-art.js','apps/web/v35/icons.js','apps/web/v35/addons-v7.css','apps/web/lib/start-memory.js','apps/web/v35/cinema-releases.test.js','apps/web/v35/server-sheet.test.js','apps/web/v35/server-sheet.js','apps/web/v35/server-sheet.css','apps/web/v35/anime-depth.test.js','apps/web/v35/anime-depth.js','apps/web/v35/collapse-hero.test.js','apps/web/v35/collapse-hero.js','apps/web/v35/cinema.css','apps/web/v35/anime.js','apps/web/v35/anime.css','apps/web/v35/anime-work.test.js','apps/web/addons/runtime.test.js','apps/web/addons/native-catalog.test.js','apps/web/addons/native-runtime.js','apps/web/addons/native-runtime.test.js','apps/web/lib/anime-engine.js','apps/web/v35/addons-v7.js','apps/web/v35/addons-v7.test.js','apps/web/v35/shell.js','apps/web/addons/work-view.js','apps/web/addons/work-view.test.js','android/app/src/main/kotlin/com/vantara/verification/VerificationActivity.kt','apps/web/lib/source-verification.js','apps/web/lib/source-verification.test.js','apps/web/v35/anime.js','apps/web/v35/anime-verification-silent.test.js','apps/web/sw.js','tools/android-debug/webview-proof.mjs','tools/native-fingerprint.mjs','.github/workflows/spike-extension-engine.yml','android/.gitignore','tools/bundle-extensions.mjs','.github/workflows/debug-journeys.yml','tools/android-debug/journeys.mjs','tools/android-debug/journeys.sh','apps/web/v35/addons.css','apps/web/v35/source-mode.js','apps/web/v35/source-home.js','apps/web/v35/source-home.test.js','apps/web/lib/anime-engine-native-addons.test.js','apps/api/src/lib/sessions.atomic.test.ts']);
for(const path of deliverySeams)seams.add(path);
// Owner-authorized discovery fixes, reviewed and tested in b8253ccf. Exact files only.
const discoveryGroupOneSeams=[
  "android/app/src/main/kotlin/com/vantara/anime/AnimeEngine.kt",
  "android/app/src/main/kotlin/com/vantara/anime/DiscoveryFailure.kt",
  "android/app/src/main/kotlin/com/vantara/anime/SearchPages.kt",
  "android/app/src/main/kotlin/com/vantara/anime/bridge/AnimeEnginePlugin.kt",
  "android/app/src/main/kotlin/com/vantara/anime/catalog/CatalogCrawler.kt",
  "android/app/src/main/kotlin/com/vantara/anime/episodes/EpisodeResolver.kt",
  "android/app/src/main/kotlin/com/vantara/anime/player/PlaybackWork.kt",
  "android/app/src/main/kotlin/com/vantara/anime/player/PlayerActivity.kt",
  "android/app/src/test/java/com/vantara/anime/CatalogCrawlerTest.kt",
  "android/app/src/test/java/com/vantara/anime/DiscoveryFailureTest.kt",
  "android/app/src/test/java/com/vantara/anime/EpisodeCacheGenerationTest.kt",
  "android/app/src/test/java/com/vantara/anime/SearchPagesTest.kt",
  "android/app/src/test/java/com/vantara/anime/player/PlaybackWorkTest.kt",
  "apps/web/addons/native-preparation.js",
  "apps/web/addons/native-preparation.test.js",
  "apps/web/lib/anime-engine.js",
  "apps/web/lib/anime-engine.test.js",
  "apps/web/lib/anime-title.js",
  "apps/web/lib/discovery-diagnostics.js",
  "apps/web/lib/discovery-diagnostics.test.js",
  "apps/web/sw.js",
  "apps/web/v35/anime-account.js",
  "apps/web/v35/anime-account.test.js",
  "apps/web/v35/anime-picker-lifecycle.test.js",
  "apps/web/v35/anime-playback.test.js",
  "apps/web/v35/anime-work.test.js",
  "apps/web/v35/anime.js",
  "apps/web/v35/work-looks.js",
  "apps/web/v35/work-looks.test.js",
  "docs/addons/DISCOVERY_GROUP1_20261103.ar.md"
];
for(const path of discoveryGroupOneSeams)seams.add(path);


// Owner-authorized focused diagnostics visibility and floating-card visual corrections.
const visualUiSeams = [
  "apps/web/v35/cinema-picker-lifecycle.test.js",
  "apps/web/desktop/overlay.js",
  "apps/web/desktop/overlay.test.js",
  "apps/web/pwa/player/player.js",
  ".github/workflows/runtime-app-debug.yml",
  "android/app/src/main/kotlin/com/vantara/anime/player/PlayerActivity.kt",
  "android/app/src/main/kotlin/com/vantara/plugins/DiagnosticVisibility.kt",
  "android/app/src/main/kotlin/com/vantara/plugins/SystemUiPlugin.kt",
  "android/app/src/test/java/com/vantara/plugins/DiagnosticVisibilityTest.kt",
  "apps/web/lib/diagnostics-ui.js",
  "apps/web/lib/diagnostics-ui.test.js",
  "apps/web/sw.js",
  "apps/web/v35/addons-v7.js",
  "apps/web/v35/addons-v7.test.js",
  "apps/web/v35/addons-view.js",
  "apps/web/v35/addons-view.test.js",
  "apps/web/v35/anime-work.test.js",
  "apps/web/v35/anime.css",
  "apps/web/v35/anime.js",
  "apps/web/v35/cinema.js",
  "apps/web/v35/icons.js",
  "apps/web/v35/logo-layer.js",
  "apps/web/v35/logo-layer.test.js",
  "apps/web/v35/server-sheet.js",
  "apps/web/v35/sheet-lifecycle.js",
  "apps/web/v35/sheet-lifecycle.test.js",
  "apps/web/v35/shell.js",
  "apps/web/v35/work-looks.js",
  "docs/superpowers/plans/2026-11-03-visual-diagnostics.md",
  "docs/superpowers/specs/2026-11-03-visual-diagnostics-design.md",
  "tools/repository-compat/visual-ui.mjs"
];
for (const path of visualUiSeams) seams.add(path);

// Owner-requested anime detail behavioral parity and PC logo repair, Nov 4.
// Exact frontend seams only; no engine, data-schema or release allowance.
const animeDetailSeams = [
  'apps/web/index.html',
  'apps/web/lib/together/art.test.js',
  'apps/web/v35/anime-episodes.js',
  'apps/web/v35/anime-episodes.test.js',
  'apps/web/v35/anime-episode-controls.js',
  'apps/web/v35/anime-episode-controls.test.js',
  'apps/web/v35/anime-episodes.css',
  'apps/web/v35/anime-functional-parity.test.js',
  'apps/web/v35/anime-hero-scheduler.test.js',
  'apps/web/v35/work-dom.js',
  'apps/web/v35/work-dom.test.js',
  'docs/plans/2026-11-04-anime-detail-behavior.md',
  'docs/addons/ANIME_DETAIL_20261104.ar.md',
];
for (const path of animeDetailSeams) seams.add(path);


seams.add('extensions/runtime-android/executor/src/main/java/dev/vantara/runtime/android/AndroidRuntimeClient.java');
seams.add('extensions/runtime-android/executor/src/main/java/dev/vantara/runtime/android/BrokerHostTransport.java');
seams.add('extensions/runtime-android/http/src/main/java/dev/vantara/runtime/http/HttpBroker.java');
// اعتماد المصادر حتى «أعطال فانتارا = صفر» (6 نوفمبر 2026، موافقة المالك على النشر في Debug):
// تحقق Cloudflare على المضيف المتحدّي، وانتقال دومين Aniyomi، وProtoBuf للإضافات، ونظام الاعتماد
// وأدواته ووثائقه، و«فتح» يفتح المصدر مباشرة، وسبب عدم التوفر في سطر السيرفر؛ كلها باختباراتها.
// لا تورنت ولا Stremio ولا مشغّل. التفاصيل: docs/addons/HANDOFF_ENGINE_20261106.ar.md
const certificationSeams = [
  'android/app/src/main/kotlin/com/vantara/anime/net/AnimeHostRouter.kt',
  'android/app/src/main/kotlin/com/vantara/anime/net/Domains.kt',
  'android/app/src/main/kotlin/com/vantara/verification/VerificationActivity.kt',
  'android/app/src/main/kotlin/com/vantara/verification/VerificationPolicy.kt',
  'android/app/src/test/java/com/vantara/verification/VerificationPolicyTest.kt',
  'android/app/src/test/java/com/vantara/anime/net/DomainInterceptorTest.kt',
  'android/app/src/test/java/com/vantara/plugins/ExtensionInjektTest.kt',
  'extensions/runtime-android/integration/src/androidTest/kotlin/com/vantara/runtime/SourceCertificationTest.kt',
  '.github/workflows/source-certification.yml',
  'tools/repository-compat/addon_preflight.mjs',
  'tools/repository-compat/certification-sources.txt',
  'tools/repository-compat/run_source_certification.sh',
  'tools/repository-compat/summarize_certification.mjs',
  'tools/repository-compat/summarize_certification.test.mjs',
  'docs/addons/ENGINE_COMPAT_20261105.ar.md',
  'docs/addons/HANDOFF_CERTIFICATION_20261105.ar.md',
  'docs/addons/HANDOFF_ENGINE_20261106.ar.md',
  'apps/web/addons/native-catalog.js',
  'apps/web/addons/native-catalog.test.js',
  'apps/web/v35/server-sheet.css',
  'apps/web/v35/server-sheet.test.js',
  'apps/web/v35/cinema-releases.test.js',
  // شبكة محجوبة (جوال المالك في السعودية): DoH أولًا وتجزئة SNI لمواقع إضافات CloudStream وسيرفرات فيديوها
  // كما في مسار المصادر المدمجة؛ عميل الوسائط يغيّر سلوكه للمضيفات المعلَّمة فقط (ستريميو كما هو).
  'android/app/src/main/kotlin/com/vantara/addons/NativeAddonMediaNetwork.kt',
  'android/app/src/main/kotlin/com/vantara/anime/net/AnimeDns.kt',
  'android/app/src/main/kotlin/com/vantara/anime/net/SniFragment.kt',
  'extensions/runtime-android/integration/src/test/kotlin/com/vantara/anime/net/CensoredNetworkTest.kt',
  // سيرفرات بلا مستخرج في عامل CloudStream تُحل بآلية فانتارا نفسها (EmbedResolver: مستخرجات، قارئ عام،
  // متصفح مخفي) بدل «لا رابط فيديو»: العامل يعيدها كاملة بمراجعها، والمحوّل يحلّها في التطبيق.
  'extensions/runtime-android/cloudstream/src/main/kotlin/dev/vantara/runtime/cloudstream/CloudStreamProvider.kt',
  'extensions/runtime-android/cloudstream/src/main/kotlin/dev/vantara/runtime/cloudstream/WorkerState.kt',
  'extensions/runtime-android/cloudstream/src/main/kotlin/com/lagradost/cloudstream3/utils/ExtractorApi.kt',
];
for (const path of certificationSeams) seams.add(path);
// الشريط العائم ومبدّل الأقسام وانتقال الطبقات (موافقة المالك على النشر في Debug)؛ للجوال فقط
const floatingNavSeams = [
  'apps/web/v35/dock.js',
  'apps/web/v35/dock.test.js',
  'apps/web/v35/core.css',
  'apps/web/v35/markup.js',
  'apps/web/v35/wide.css',
  'apps/web/v35/cinema-home-layout.test.js',
];
for (const path of floatingNavSeams) seams.add(path);
seams.add('extensions/runtime-android/http/src/test/java/dev/vantara/runtime/http/HttpBrokerTest.java');
seams.add('extensions/runtime-android/integration/src/androidTest/kotlin/com/vantara/runtime/RuntimePostPromotionRecoveryDeviceTest.kt');
seams.add('extensions/runtime-android/integration/src/main/kotlin/com/vantara/runtime/RuntimeHost.kt');
seams.add('extensions/runtime-android/integration/src/test/kotlin/com/vantara/runtime/RuntimeRecoveryGateTest.kt');
seams.add('tools/repository-compat/scope-guard.mjs');
// Test-only manifest: match VANTARA app largeHeap on Android 10 IPC stress tests; runtime engine remains protected.
seams.add('extensions/runtime-android/harness/src/main/AndroidManifest.xml');
seams.add('android/app/src/main/kotlin/com/vantara/anime/loader/AnimeExtensionLoader.kt');
seams.add('android/app/src/test/java/com/vantara/plugins/BoundedRepositoryBodyTest.kt');
seams.add('android/app/src/main/kotlin/com/vantara/anime/bridge/AniyomiUpdateGate.kt');
seams.add('android/app/src/main/kotlin/com/vantara/anime/bridge/AniyomiCandidateMedia.kt');
seams.add('android/app/src/main/kotlin/com/vantara/anime/stream/MediaEvidenceProbe.kt');
seams.add('android/app/src/test/java/com/vantara/anime/bridge/AniyomiUpdateJourneyTest.kt');
seams.add('android/app/src/test/java/com/vantara/anime/bridge/AniyomiCandidateMediaTest.kt');
seams.add('extensions/runtime-android/integration/src/androidTest/kotlin/com/vantara/runtime/LiveRepositorySweepTest.kt');
seams.add('extensions/runtime-android/integration/src/main/kotlin/com/vantara/runtime/RuntimeSourceAdapter.kt');
seams.add('extensions/runtime-android/integration/src/test/kotlin/com/vantara/runtime/RuntimeSourceAdapterTest.kt');
seams.add('tools/repository-compat/run_live_video.sh');
seams.add('tools/repository-compat/summarize_live_sweep.mjs');
seams.add('tools/repository-compat/summarize_live_sweep.test.mjs');
seams.add('.github/workflows/video-compat-cohort.yml');
// Owner-approved Debug QA maintenance: optional artifact uploads may not fail a successful runtime test.
// This explicit file remains subject to every other repository scope guard.
seams.add('.github/workflows/runtime-android.yml');
seams.add('android/app/src/main/kotlin/com/vantara/anime/loader/AnimeVersionPolicy.kt');
seams.add('android/app/src/test/java/com/vantara/anime/AnimeVersionPolicyTest.kt');
// Regression coverage for general search: cooling CloudStream sources remain searchable after healthy sources.
seams.add('android/app/src/test/java/com/vantara/anime/SearchOrderTest.kt');
// Aniyomi torrent extensions (Torrentio Anime) return magnet links: native tickets via the torrent engine's public API.
seams.add('android/app/src/main/kotlin/com/vantara/anime/stream/MagnetLinks.kt');
seams.add('android/app/src/test/java/com/vantara/anime/MagnetLinksTest.kt');
// Measurement plan phase 0: original CloudStream as an isolated CI-only reference (never in the app).
seams.add('.github/workflows/reference-cloudstream.yml');
for (const f of ['ReferenceProbe.kt', 'ReferenceRunTest.kt', 'patch.py', 'plan.txt', 'probe_links.py', 'run_reference.sh', 'test_probe_links.py', 'compare.py', 'test_compare.py', 'run_vantara_compare.sh']) seams.add(`tools/reference/cloudstream/${f}`);
// Phase 1 (small): VANTARA's side of the comparison, same .cs3 and episodes as the reference (androidTest only).
seams.add('extensions/runtime-android/integration/src/androidTest/kotlin/com/vantara/runtime/ReferenceCompareTest.kt');
// Additive nullable Route.type so the sheet renders any adapter's torrent tickets as torrent rows.
seams.add('android/app/src/main/kotlin/com/vantara/anime/stream/Routes.kt');
seams.add('android/app/src/androidTest/java/com/vantara/anime/InstalledVideoRestartDeviceTest.kt');
// Owner's Nov 1 screenshots: optional legacy manga catalogue and direct protobuf repository URLs.
seams.add('android/app/src/main/kotlin/com/vantara/plugins/ExtensionEnginePlugin.kt');
seams.add('android/app/src/main/kotlin/com/vantara/plugins/UserExtensions.kt');
seams.add('android/app/src/test/java/com/vantara/plugins/RepoIndexTest.kt');
seams.add('android/app/src/test/java/com/vantara/plugins/UserRepositoryRemovalTest.kt');
seams.add('android/app/src/test/java/com/vantara/plugins/MangaRepositoryLifecycleTest.kt');
seams.add('apps/web/lib/sync.test.js');
// Explicit source-choice durability: strict enqueue failures must not publish an unsaved overlay.
seams.add('apps/web/lib/sync.js');
// Exact CloudStream host ABI evidenced by the published Mehdi Anime4Up v4 package.
seams.add('extensions/runtime-android/cloudstream/src/main/kotlin/com/lagradost/cloudstream3/Models.kt');
seams.add('extensions/runtime-android/cloudstream/src/main/kotlin/com/lagradost/cloudstream3/utils/ExtractorApi.kt');
seams.add('extensions/runtime-android/cloudstream/src/main/kotlin/com/lagradost/nicehttp/NiceResponse.kt');
seams.add('extensions/runtime-android/cloudstream/src/test/kotlin/dev/vantara/runtime/cloudstream/ObservedAbiTest.kt');
seams.add('android/app/src/androidTest/java/com/vantara/plugins/OptionalMangaRepositoriesDeviceTest.kt');
seams.add('.github/workflows/manga-repository-management-qa.yml');
// Nov 1: emulator-only decoder performance tolerance in the real playback integration test.
// The unchanged real-device frame budget and mandatory playback/seek assertions remain enforced.
seams.add('extensions/runtime-android/integration/src/androidTest/kotlin/com/vantara/runtime/RuntimeAppIntegrationTest.kt');
// Nov 1: bounded video-engine recovery, real quality heights and opt-in device evidence.
seams.add('android/app/src/main/kotlin/com/vantara/anime/registry/UserAnime.kt');
seams.add('android/app/src/main/kotlin/com/vantara/anime/player/PlayerActivity.kt');
seams.add('android/app/src/main/kotlin/com/vantara/anime/player/RouteGroups.kt');
seams.add('android/app/src/test/java/com/vantara/anime/AnimeRepositoryLifecycleTest.kt');
seams.add('android/app/src/test/java/com/vantara/anime/AnimeSourcePublicationTest.kt');
seams.add('android/app/src/test/java/com/vantara/anime/VideoQualityTest.kt');
seams.add('android/app/src/androidTest/java/com/vantara/anime/AniyomiVideoJourneyDeviceTest.kt');
seams.add('android/app/src/androidTest/java/com/vantara/anime/DebugVideoPlaybackProbe.kt');
seams.add('.github/workflows/aniyomi-real-qa.yml');
seams.add('.github/workflows/debug-cloudstream-bridge-qa.yml');
seams.add('.github/workflows/engine-predebug-qa.yml');
seams.add('.github/workflows/video-auto-recovery-qa.yml');
seams.add('.github/workflows/video-cinema-live-qa.yml');
seams.add('.github/workflows/video-player-decoded-frame-qa.yml');
seams.add('.github/workflows/video-repository-live-qa.yml');
// Owner-authorized playback phase two: exact reviewed media/transport regressions and integration seams.
const playbackPhaseTwoSeams = [
  "android/app/src/androidTest/assets/player-audio/README.md",
  "android/app/src/androidTest/assets/player-audio/alternate.m4a",
  "android/app/src/androidTest/assets/player-audio/primary.mp4",
  "android/app/src/androidTest/assets/player-formats/README.md",
  "android/app/src/androidTest/assets/player-formats/dash/chunk-0-001.m4s",
  "android/app/src/androidTest/assets/player-formats/dash/chunk-0-002.m4s",
  "android/app/src/androidTest/assets/player-formats/dash/chunk-0-003.m4s",
  "android/app/src/androidTest/assets/player-formats/dash/chunk-0-004.m4s",
  "android/app/src/androidTest/assets/player-formats/dash/chunk-0-005.m4s",
  "android/app/src/androidTest/assets/player-formats/dash/init-0.m4s",
  "android/app/src/androidTest/assets/player-formats/dash/manifest.mpd",
  "android/app/src/androidTest/assets/player-formats/hls/manifest.m3u8",
  "android/app/src/androidTest/assets/player-formats/hls/segment-00.ts",
  "android/app/src/androidTest/assets/player-formats/hls/segment-01.ts",
  "android/app/src/androidTest/assets/player-formats/hls/segment-02.ts",
  "android/app/src/androidTest/assets/player-formats/hls/segment-03.ts",
  "android/app/src/androidTest/assets/player-formats/hls/segment-04.ts",
  "android/app/src/androidTest/java/com/vantara/addons/NativeAddonHttpPlaybackDeviceTest.kt",
  "android/app/src/androidTest/java/com/vantara/addons/PreparedHttpPlaybackDeviceTest.kt",
  "android/app/src/androidTest/java/com/vantara/anime/player/CandidateExternalAudioDeviceTest.kt",
  "android/app/src/androidTest/java/com/vantara/anime/player/PlayerStartupDeviceTest.kt",
  "android/app/src/main/kotlin/com/vantara/anime/AnimeEngine.kt",
  "android/app/src/main/kotlin/com/vantara/anime/adapters/Adapters.kt",
  "android/app/src/main/kotlin/com/vantara/anime/player/CandidateMediaSources.kt",
  "android/app/src/main/kotlin/com/vantara/anime/player/ExternalAudioFallbackPolicy.kt",
  "android/app/src/main/kotlin/com/vantara/anime/player/ExternalAudioPlan.kt",
  "android/app/src/main/kotlin/com/vantara/anime/player/PlaybackBudgets.kt",
  "android/app/src/main/kotlin/com/vantara/anime/player/PlaybackDiagnostics.kt",
  "android/app/src/main/kotlin/com/vantara/anime/player/PlaybackStartup.kt",
  "android/app/src/main/kotlin/com/vantara/anime/player/PlayerActivity.kt",
  "android/app/src/main/kotlin/com/vantara/anime/player/StartupReveal.kt",
  "android/app/src/main/kotlin/com/vantara/anime/stream/Prepared.kt",
  "android/app/src/main/kotlin/com/vantara/anime/stream/StreamProbe.kt",
  "android/app/src/main/kotlin/com/vantara/anime/stream/Streams.kt",
  "android/app/src/test/java/com/vantara/anime/CinemaFastPathTest.kt",
  "android/app/src/test/java/com/vantara/anime/LazyVideoResolutionTest.kt",
  "android/app/src/test/java/com/vantara/anime/player/ExternalAudioFallbackPolicyTest.kt",
  "android/app/src/test/java/com/vantara/anime/player/ExternalAudioPlanTest.kt",
  "android/app/src/test/java/com/vantara/anime/player/PlaybackDiagnosticsTest.kt",
  "android/app/src/test/java/com/vantara/anime/player/PlaybackStartupTest.kt",
  "android/app/src/test/java/com/vantara/anime/player/StartupRevealTest.kt",
  "android/app/src/test/java/com/vantara/anime/stream/CandidatePreparationTimingTest.kt",
  "android/app/src/test/java/com/vantara/anime/stream/StreamProbeTest.kt",
  "extensions/runtime-android/cloudstream/src/main/kotlin/com/lagradost/nicehttp/Requests.kt",
  "extensions/runtime-android/cloudstream/src/main/kotlin/dev/vantara/runtime/cloudstream/NetworkBridge.kt",
  "extensions/runtime-android/cloudstream/src/test/kotlin/dev/vantara/runtime/cloudstream/NetworkBridgeConcurrencyTest.kt",
  "extensions/runtime-android/executor/src/main/java/dev/vantara/runtime/android/RuntimePipeCapacity.java",
  "extensions/runtime-android/executor/src/main/java/dev/vantara/runtime/android/RuntimePipes.java",
  "extensions/runtime-android/executor/src/test/java/dev/vantara/runtime/android/RuntimePipeCapacityTest.java",
  "extensions/runtime-android/executor/src/test/java/dev/vantara/runtime/android/RuntimePipesQueueTest.java",
  "extensions/runtime-android/harness/src/androidTest/java/dev/vantara/runtime/android/PipeIngressTest.java",
  "tools/repository-compat/run_app_integration.sh"
];
for (const path of playbackPhaseTwoSeams) seams.add(path);
// Owner decision (30 Oct 2026): every built-in anime/cinema source is removed. Deletions are admitted only
// for these exact paths/prefixes; anything else deleted still fails the guard.
const removedPrefixes=['android/app/src/main/assets/anime-extensions/'];
const removed=new Set(['tools/bundle-anime-extensions.mjs','apps/web/pwa/sources/engines/akwam.js','apps/web/pwa/sources/engines/akwam.test.js','apps/web/pwa/sources/engines/arabseed.js','apps/web/pwa/sources/engines/egydead.js','apps/web/pwa/sources/engines/egydead.test.js','apps/web/pwa/sources/engines/okanime.js','apps/web/pwa/sources/engines/ristoanime.js','apps/web/pwa/sources/engines/ristoanime.test.js','apps/web/pwa/sources/engines/shahiid.js','apps/web/pwa/sources/engines/tuktuk.js','apps/web/pwa/sources/engines/witanime.js','apps/web/pwa/sources/engines/witanime-errors.test.js','apps/web/pwa/sources/engines/video-common.js','apps/web/pwa/sources/engines/source-redirects.test.js',
'android/app/src/main/kotlin/com/vantara/anime/adapters/ArabSeedSite.kt','android/app/src/main/kotlin/com/vantara/anime/adapters/RistoAnimeSite.kt','android/app/src/main/kotlin/com/vantara/anime/adapters/ShahiidSite.kt','android/app/src/main/kotlin/com/vantara/anime/adapters/EgyDeadSite.kt','android/app/src/main/kotlin/com/vantara/anime/adapters/WitAnimeSite.kt','android/app/src/main/kotlin/com/vantara/anime/adapters/AkwamSite.kt','android/app/src/main/kotlin/com/vantara/anime/adapters/TukTukSite.kt',
'android/app/src/test/java/com/vantara/anime/AkwamSiteTest.kt','android/app/src/test/java/com/vantara/anime/ArabSeedSiteTest.kt','android/app/src/test/java/com/vantara/anime/EgyDeadSiteTest.kt','android/app/src/test/java/com/vantara/anime/RistoAnimeSiteTest.kt','android/app/src/test/java/com/vantara/anime/ShahiidSiteTest.kt','android/app/src/test/java/com/vantara/anime/TukTukSiteTest.kt','android/app/src/test/java/com/vantara/anime/WitAnimeSiteTest.kt','android/app/src/test/java/com/vantara/anime/NativeSourcesLiveTest.kt','android/app/src/test/java/com/vantara/anime/RockLiveTest.kt']);
// Owner decision (31 Oct 2026): Debug is separated from the bundled manga sources. Each bundled APK may only
// MOVE to the Stable-only source set (src/release) byte-for-byte; a bare deletion still fails the guard.
const movedFrom='android/app/src/main/assets/extensions/',movedTo='android/app/src/release/assets/extensions/';
const sameBlob=(a,b)=>{try{return execFileSync('git',['hash-object',b],{encoding:'utf8'}).trim()===execFileSync('git',['rev-parse',`${base}:${a}`],{encoding:'utf8'}).trim();}catch{return false;}};
const moved=(status,path)=>(status==='D'&&path.startsWith(movedFrom)&&sameBlob(path,movedTo+path.slice(movedFrom.length)))||(status==='A'&&path.startsWith(movedTo)&&sameBlob(movedFrom+path.slice(movedTo.length),path));
// Owner-requested work-page styles (manga) and live-sweep dispatch inputs (all sources, report only).
for(const path of ['apps/web/v35/manga.css','apps/web/v35/markup.js','.github/workflows/video-repository-live-qa.yml','.github/workflows/video-cinema-live-qa.yml','.github/workflows/aniyomi-real-qa.yml','.github/workflows/source-certification.yml'])seams.add(path);
// The general search's parallel slot: a slow Aniyomi source frees its slot instead of being cancelled at 12 s.
for (const path of ['android/app/src/main/kotlin/com/vantara/anime/SearchSlots.kt', 'android/app/src/test/java/com/vantara/anime/SearchSlotsTest.kt']) seams.add(path);
// Debug diagnostics: main-thread blocks and blocking GC for the reader's stall report (never installed in Stable).
for (const path of ['android/app/src/main/kotlin/com/vantara/plugins/MainThreadWatch.kt', 'android/app/src/test/java/com/vantara/plugins/MainThreadBlocksTest.kt']) seams.add(path);
// Reading time is written off the main thread: its fsync there froze the reader's momentum every 5 s.
for (const path of ['android/app/src/main/kotlin/com/vantara/usage/UsagePlugin.kt', 'android/app/src/main/kotlin/com/vantara/usage/UsageWriter.kt', 'android/app/src/test/java/com/vantara/anime/UsageWriterTest.kt']) seams.add(path);
// Project skills for agents working in this repository (text only).
for (const path of ['.claude/skills/vantara-engineering/SKILL.md', '.claude/skills/vantara-ui-ux/SKILL.md']) seams.add(path);
// Emulators start with animations disabled; WebView phases restore them before measuring section motion.
for (const path of ['tools/android-debug/upgrade-check.sh', 'tools/repository-compat/run_app_integration.sh', 'tools/repository-compat/section-motion-proof.mjs']) seams.add(path);
// Manga reader fixes (owner report: kicked out on the next chapter, iPhone scroll jumps, zoom off the fingers).
for (const path of ['apps/web/v35/reader-anchor.test.js', 'apps/web/v35/reader-page-fallback.test.js', 'apps/web/v35/reader-zoom.js', 'apps/web/v35/reader-zoom.test.js', 'apps/web/v35/reader.js', 'apps/web/v35/reader.css', 'apps/web/v35/reader-stalls.js', 'apps/web/v35/reader-stalls.test.js']) seams.add(path);
// Reader stalls in the Debug APK: the whole account mirror crossed Capacitor's bridge, parsed on the main thread mid-scroll.
for (const path of ['apps/web/lib/account-store.js', 'apps/web/lib/account-store.test.js']) seams.add(path);
// Manga home redesign (owner-approved mockup): the wide AniList banner for the «finished» pick.
for (const path of ['apps/web/lib/manga-meta.js']) seams.add(path);
// Inner page motion (owner request): shared work cover and sub-page fade; section switching untouched.
for (const path of ['apps/web/v35/motion.js', 'apps/web/v35/page-motion.js', 'apps/web/v35/page-motion.test.js', 'apps/web/v35/core.css']) seams.add(path);
// Anime home redesign (owner-approved mockup): today banner, continue watching, weekly schedule.
for (const path of ['apps/web/v35/anime-today.js', 'apps/web/v35/anime-today.test.js', 'apps/web/v35/anime.js', 'apps/web/v35/anime.css', 'apps/web/v35/manga.css', 'apps/web/v35/shell.js', 'apps/web/v35/markup.js']) seams.add(path);
// Library open blocked ~0.5s: the alias table was re-prepared for every canonical index (pure memoization, same results).
for (const path of ['apps/web/lib/catalog.js']) seams.add(path);
// Unified work identity (owner priority: one work = one card across sources and sections), with a pinned real-title benchmark.
for (const path of ['apps/web/lib/manga-alias-store.js', 'apps/web/lib/manga-alias-store.test.js', 'apps/web/lib/manga-identity.test.js', 'apps/web/lib/manga-identity-bench.test.js', 'apps/web/lib/fixtures/manga-identity-bench.json', 'apps/web/lib/fixtures/manga-identity-sim.js', 'apps/web/v35/manga-one-card.test.js', 'apps/web/lib/manga-meta.test.js', 'apps/web/v35/friends-reading.js', 'apps/web/v35/friends-reading.test.js', 'apps/web/v35/feed-snapshot.test.js', 'apps/web/v35/anime-discover.js', 'apps/web/lib/unified-identity.js', 'apps/web/lib/unified-identity.test.js', 'apps/web/lib/unified-identity-bench.test.js', 'apps/web/lib/fixtures/unified-identity-bench.json', 'apps/web/lib/anime-imdb.js', 'apps/web/lib/anime-imdb.test.js', 'apps/web/lib/manga-cover.js', 'apps/web/lib/manga-cover.test.js', 'tools/identity-bench/fetch-unified.mjs']) seams.add(path);
// Agent skills, agents and their vendored sources (.claude/) are contributor tooling, never shipped in the app.
for(const row of lines){if(moved(...row.split('\t')))continue;const [status,path]=row.split('\t');if(path.startsWith('.claude/'))continue;if(seams.has(path)&&['A','M'].includes(status))continue;if(status==='D'&&(removed.has(path)||removedPrefixes.some(p=>path.startsWith(p))))continue;if(status!=='A'||!(prefixes.some(p=>path.startsWith(p))||path==='.github/workflows/repository-compat.yml'||path==='.github/workflows/runtime-android.yml'||path==='.github/workflows/runtime-app-debug.yml'||path==='.github/workflows/runtime-live-sweep.yml'||path==='docs/superpowers/plans/2026-10-28-vantara-runtime-worker.md'||path==='docs/superpowers/plans/2026-10-28-repository-compat-runtime.md'))throw Error('Forbidden legacy/scope change: '+row);}
console.log(`Scope verified: ${lines.length} isolated additions and enumerated Debug integration seams; torrent, subtitles and accounts protected; player changes limited to enumerated video seams against ${base}`);
