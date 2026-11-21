package com.vantara.plugins

import android.app.Application
import android.util.Base64
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import dev.vantara.spike.CatalogueFilterPolicy
import dev.vantara.spike.CatalogueListingKind
import dev.vantara.spike.CloudflareInteractionMode
import dev.vantara.spike.resolveFullCatalogueListing
import dev.vantara.spike.FileExtensionLoader
import dev.vantara.spike.ImagePayloadPolicy
import dev.vantara.spike.SPIKE_SOURCES
import dev.vantara.spike.SourceCompatRepairs
import dev.vantara.spike.SourceSpec
import dev.vantara.spike.selectArabicSources
import eu.kanade.tachiyomi.network.NetworkHelper
import eu.kanade.tachiyomi.network.interceptor.WebViewActivityHolder
import eu.kanade.tachiyomi.source.CatalogueSource
import eu.kanade.tachiyomi.source.model.FilterList
import eu.kanade.tachiyomi.source.model.MangasPage
import eu.kanade.tachiyomi.source.model.Page
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import eu.kanade.tachiyomi.source.model.SMangaUpdate
import eu.kanade.tachiyomi.source.online.HttpSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import okhttp3.Request
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.InjektModule
import uy.kohesive.injekt.api.InjektRegistrar
import uy.kohesive.injekt.api.addSingleton
import uy.kohesive.injekt.api.addSingletonFactory
import uy.kohesive.injekt.api.get
import java.io.IOException

/**
 * جسر القارئ إلى محرّك الإضافات المحلي.
 *
 * الجافاسكربت يطلب بالاسم، والمحرّك يحمّل إضافة Keiyoushi من ملف ويشغّلها في
 * نفس العملية. لا سيرفر، ولا Suwayomi، ولا تثبيت إضافة يدويًّا.
 *
 * ثلاثة قيود تحكم هذا الملف:
 *
 * 1. **`memo` يجب أن يعود كما خرج.** عقد lib 1.6 يعطي كل عمل وفصل حالةً
 *    خاصة بالمصدر (`SManga.memo`) يحتاجها حين نطلب تفاصيله أو فصوله. إسقاطها
 *    في الرحلة إلى JS يعني أن المصدر يستقبل عملًا لا يعرفه — والعطل يظهر
 *    بعد خطوتين من موضعه. فكل DTO هنا يحمل `memo` نصًّا ويعيده كما هو.
 *
 * 2. **الصورة تُجلب بعميل المصدر وترويساته.** مضيفات الصور تردّ 403 بلا
 *    `Referer` الصحيح. عميلٌ عامّ يُنزّل الصورة نفسها ويفشل، فتُقرأ صورة
 *    صحيحة على أنها محجوبة.
 *
 * 3. **المصدر يُحمَّل مرة واحدة ويُحفظ.** كل نداء يعيد التنزيل والتحقق وفكّ
 *    الـDEX كان سيجعل تقليب صفحة واحدة ثوانيَ. والقفل يمنع نداءين متوازيين
 *    من تحميل نفس الحزمة مرتين.
 */
@CapacitorPlugin(name = "ExtensionEngine")
class ExtensionEnginePlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /**
     * خريطة متزامنة لا `mutableMapOf`.
     *
     * `sources()` تقرأها على خيط الجسر بينما `obtain()` تكتبها على خيط
     * إدخال/إخراج. خريطة عادية هنا تعني `ConcurrentModificationException`
     * يظهر عشوائيًّا حين يفتح القارئ قائمة المصادر أثناء تحميل مصدر.
     */
    private val loaded = java.util.concurrent.ConcurrentHashMap<String, CatalogueSource>()

    private val network by lazy { Injekt.get<NetworkHelper>() }
    private val loader by lazy { FileExtensionLoader(context) }
    /** مستودعات المستخدم وإضافاته (UserExtensions.kt). */
    private val userStore by lazy { UserExtensionStore(java.io.File(context.filesDir, "extensions/user-repos.json")) }
    private val repoClient by lazy { RepoClient(context, network.client) }
    private val builtinSpecs by lazy { BuiltinSourceRefresh(java.io.File(context.filesDir, "extensions/builtin-refresh.json")) }
    private val builtinVisibility by lazy { BuiltinVisibility(java.io.File(context.filesDir, "extensions/builtin-visible.json")) }

    /** حزمة مدمجة سابقًا صارت إضافة (رُحّلت أو ثُبّتت/حُذفت كإضافة): مسار المدمجة لها مغلق (BuiltinMigration). */
    private fun builtinClosed(pkg: String): Boolean = runCatching { pkg in userStore.state.formerBuiltins }.getOrDefault(false)

    /** نسخة الحزمة موجودة على الجهاز (متحقَّق منها) أو داخل التطبيق: تحميلها لا يلمس الشبكة. */
    private fun hasLocalCopy(pkg: String): Boolean {
        val spec = packageSpec(pkg)?.let { builtinSpecs.current(it) } ?: return false
        return loader.readVerifiedCache(spec) != null || readBundled(spec) != null
    }
    /** Durable legacy entitlement: inspect verified local artifacts only, without preparing a source. */
    private fun localArtifactSpec(base: SourceSpec): SourceSpec? {
        val candidates = listOfNotNull(builtinSpecs.current(base), builtinSpecs.previousOf(base), base)
            .distinctBy { it.sha256.lowercase() }
        return candidates.firstOrNull { candidate ->
            loader.readVerifiedCache(candidate) != null ||
                // Match the loader's preference: a valid current bundled artifact wins
                // before an older cached candidate. Only the base digest can use assets.
                (candidate.sha256.equals(base.sha256, true) && readBundled(base) != null)
        }
    }
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    override fun load() {
        // حلّ تحدّي Cloudflare يفتح WebView، وWebView يحتاج Activity حيًّا.
        // بلا هذا السطر يسقط الاعتراض عند أول 403 ويبدو كأن المصدر محجوب.
        WebViewActivityHolder.set(activity)
        // المصادر الخلفية لا تفتح تحديًا فوق Activity. التحقق المرئي محصور
        // في VerificationCoordinator وبطلب صريح من المستخدم.
        CloudflareInteractionMode.batchProbe = true
        // الإضافات تطلب اعتمادياتها بـ`injectLazy()`. التسجيل قبل أول تحميل،
        // وإلا سقط أول مصدر بـIllegalStateException من injekt فيبدو عطل مصدر.
        //
        // ومرة واحدة للعملية لا لكل نسخة من الإضافة: تدوير الشاشة يبني
        // Activity جديدة فتُحمَّل الإضافة من جديد، وتسجيلٌ ثانٍ لنفس المفرد
        // في injekt يرمي — فيسقط التطبيق عند أول تدوير لا عند أول استعمال.
        ensureEngineInjekt(context.applicationContext as Application)
        // محلّل الأسماء الاحتياطي (DNS عبر HTTPS) للمانجا من أول لحظة: كان يُركَّب عند تشغيل محرك الأنمي فقط،
        // فمن يفتح المانجا مباشرة يبقى على DNS مزوّده، ومواقع يحجبها بالـDNS تفشل («تعذّر الوصول لاسم الموقع»).
        // النظام أولًا كما هو، وDoH فقط حين يفشل أو يعيد عنوان حجب؛ محرك الأنمي يستبدله بنسخته لاحقًا.
        if (eu.kanade.tachiyomi.network.HostRouting.dns == null) eu.kanade.tachiyomi.network.HostRouting.dns = com.vantara.anime.net.AnimeDns(eu.kanade.tachiyomi.network.HostRouting::isSourceHost)
        // المصادر تُحمَّل من أول لحظة لا عند أول طلب: الصفحة الرئيسية والأغلفة
        // والقارئ يجدونها جاهزة، ولا يسبق مصدرٌ غيره لأنه حُمِّل أولًا
        scope.launch {
            // المصادر المدمجة سابقًا: ما أضافه الحساب الحالي فقط (تبلّغه الواجهة بـsetVisibleBuiltins). قبل أول تبليغ
            // لا شيء (EE1): حساب جديد = صفر مصادر، والحساب الموجود تُجهَّز مصادره عند تبليغ اختياره (stageVisible).
            // يُقرأ الاختيار الحالي في كل نداء: التحديث اليومي بعد دقيقة يرى ما بلّغته الواجهة في الأثناء.
            fun eager(pkg: String) = !builtinClosed(pkg) && (builtinVisibility.read()?.contains(pkg) ?: false)
            for (spec in SPIKE_SOURCES) {
                if (spec.blockedReason != null || !eager(spec.pkg)) continue
                launch { runCatching { obtain(spec.pkg) } }
            }
            // التكملة الإنجليزية بعد العربي: لا تسبقه على خانات التحميل الأربع
            for (filler in FILLER_SOURCES) if (eager(filler.pkg)) launch { runCatching { obtain("${filler.pkg}@${filler.lang}") } }
            // ES1: حالة تالفة لا تُسقط الإقلاع من هذا المسار (الخطأ يظهر في نداءات الواجهة حيث يُلتقط)
            for (ext in runCatching { userStore.state.extensions }.getOrDefault(emptyList())) for (src in ext.sources) launch { runCatching { obtain("${ext.pkg}#${src.id}") } }
            launch { runCatching { refreshBuiltinsDaily(::eager) } }
            // SE3: إضافات المستخدم تتحدث وحدها، بشرط أن يعمل الإصدار الجديد فعلًا (MangaSelfUpdate)
            launch { runCatching { autoUpdateUserExtensionsDaily() } }
        }
    }

    override fun handleOnDestroy() {
        WebViewActivityHolder.clear(activity)
        scope.cancel()
    }

    // ───────────────────────────── النداءات ─────────────────────────────

    /**
     * بيان المصادر المتاحة. لا يلمس الشبكة ولا يحمّل شيئًا.
     *
     * `warning` يعبر إلى الواجهة كما في الفهرس (SAFE/MIXED): MangaDex مختلط،
     * والقرار في عرضه قرار واجهة لا يُتّخذ هنا صامتًا. والمحظور بالسياسة لا
     * يُعرض أصلًا.
     */
    @PluginMethod
    fun sources(call: PluginCall) {
        scope.launch(Dispatchers.IO) {
            try {
                val st = userStore.state
                val list = JSArray()
                // Filler language rows can share a package. Cache misses as well as hits so
                // each package's archive digests are checked only once during this listing.
                val artifacts = mutableMapOf<String, SourceSpec?>()
                fun artifact(base: SourceSpec): SourceSpec? {
                    if (!artifacts.containsKey(base.pkg)) artifacts[base.pkg] = localArtifactSpec(base)
                    return artifacts[base.pkg]
                }
                // قراءة الصيغتين (LegacySourceIds): مصدر حزمة مدمجة سابقًا مثبّتة من مستودع يظهر بمعرّفه القديم، مرة واحدة
                fun visibleIds(ext: UserExtension): List<Pair<UserSource, String>> {
                    val entries = ext.sources.map { LegacySourceIds.Entry(it.id, it.lang) }
                    return ext.sources.map { it to LegacySourceIds.visibleId(ext.pkg, LegacySourceIds.Entry(it.id, it.lang), entries) }
                }
                val takenByInstalled = st.extensions.flatMap { ext -> visibleIds(ext).map { it.second } }.filter { '#' !in it }.toSet()
                for (spec in SPIKE_SOURCES) {
                    if (spec.blockedReason != null || spec.pkg in takenByInstalled || spec.pkg in st.formerBuiltins) continue
                    val installed = artifact(spec)
                    list.put(
                        JSObject()
                            .put("id", spec.pkg)
                            .put("pkg", spec.pkg)
                            .put("label", spec.label)
                            .put("lib", spec.expectedLib)
                            .put("version", spec.versionName)
                            .put("warning", spec.warning.name)
                            .put("names", JSArray(spec.arabicSourceNames))
                            .put("lang", "ar")
                            .put("domain", runCatching { (loaded[spec.pkg] as? HttpSource)?.baseUrl }.getOrNull())
                            .put("ready", loaded.containsKey(spec.pkg))
                            .put("artifactPresent", installed != null)
                            .put("installedVersion", installed?.versionName ?: org.json.JSONObject.NULL)
                            .withIcon(NativeExtensionIcons.iconUrl(context, "extensions", spec.pkg, spec.sha256)),
                    )
                }
                // التكملة: تُعلن للواجهة بعلامتها، والواجهة لا تبني منها قوائم
                for (filler in FILLER_SOURCES) {
                    val spec = packageSpec(filler.pkg)?.takeIf { it.blockedReason == null } ?: continue
                    val id = "${filler.pkg}@${filler.lang}"
                    if (id in takenByInstalled || filler.pkg in st.formerBuiltins) continue
                    val installed = artifact(spec)
                    list.put(
                        JSObject()
                            .put("id", id)
                            .put("pkg", filler.pkg)
                            .put("label", filler.label)
                            .put("lib", spec.expectedLib)
                            .put("version", spec.versionName)
                            .put("warning", spec.warning.name)
                            .put("names", JSArray(listOf(filler.label)))
                            .put("lang", filler.lang)
                            .put("filler", true)
                            .put("domain", runCatching { (loaded[id] as? HttpSource)?.baseUrl }.getOrNull())
                            .put("ready", loaded.containsKey(id))
                            .put("artifactPresent", installed != null)
                            .put("installedVersion", installed?.versionName ?: org.json.JSONObject.NULL)
                            .withIcon(NativeExtensionIcons.iconUrl(context, "extensions", spec.pkg, spec.sha256)),
                    )
                }
                // ما ثبّته المستخدم من مستودعاته: معرّفه pkg#sourceId، والعربي يظهر في القوائم
                for (ext in st.extensions) {
                    val icon = NativeExtensionIcons.iconUrl(context, "extensions", ext.pkg, ext.sha256)
                        ?: RepoIndex.iconUrl(ext.iconUrl, ext.repoUrl) ?: RepoIndex.legacyIconUrl(ext.repoUrl, ext.pkg)
                    for ((src, id) in visibleIds(ext)) {
                        list.put(
                            JSObject()
                                .put("id", id)
                                .put("pkg", ext.pkg)
                                .put("label", src.name)
                                .put("lib", ext.lib)
                                .put("version", ext.versionName)
                                .put("warning", if (ext.nsfw) "MIXED" else "SAFE")
                                .put("names", JSArray(listOf(src.name)))
                                .put("lang", src.lang)
                                .put("filler", !src.lang.equals("ar", ignoreCase = true))
                                .put("user", true)
                                .put("repo", st.repos.firstOrNull { it.url == ext.repoUrl }?.name)
                                .put("repoUrl", ext.repoUrl)
                                .put("domain", runCatching { (loaded[id] as? HttpSource)?.baseUrl }.getOrNull())
                                .put("ready", loaded.containsKey(id))
                                .withIcon(icon),
                        )
                    }
                }
                // ES1: حالة الإضافات كانت تالفة فنُقلت جانبًا عند الإقلاع: الواجهة تقولها مرة (لا انهيار ولا صمت)
                call.resolve(JSObject().put("sources", list).put("stateRecovered", userStore.quarantined != null))
            } catch (t: Throwable) { call.reject(t.message ?: t.readable()) }
        }
    }

    /**
     * الحزم المدمجة سابقًا الظاهرة للحساب الحالي (lib/source-entitlement.js). تلميح للتحميل المسبق عند
     * الإقلاع فقط: لا يحذف ملفًا ولا يمنع طلبًا، والقرار نفسه في الواجهة ومن المزامنة.
     */
    @PluginMethod
    fun setVisibleBuiltins(call: PluginCall) {
        val array = call.getArray("pkgs") ?: return call.reject("pkgs مطلوبة")
        val pkgs = (0 until array.length()).mapNotNull { array.optString(it).takeIf { pkg -> packageSpec(pkg) != null } }.toSet()
        scope.launch(Dispatchers.IO) {
            try {
                builtinVisibility.write(pkgs)
                call.resolve()
            } catch (t: Throwable) { return@launch call.reject(t.message ?: t.readable()) }
            stageVisible(pkgs)
        }
    }

    /**
     * حذف مصدر كان مدمجًا من الجهاز فعلًا (بعد إزالته من الحساب في الواجهة): يخرج من الذاكرة وتُحذف نسخه
     * المحفوظة ومثبّت إصداره، فإعادة تثبيته تنزّله من Keiyoushi موقّعًا. المكتبة والتقدم في المزامنة لا تُمس.
     */
    @PluginMethod
    fun removeBuiltin(call: PluginCall) {
        val pkg = call.getString("pkg") ?: return call.reject("الإضافة مطلوبة")
        packageSpec(pkg) ?: return call.reject("ليست إضافة كانت مدمجة")
        scope.launch(Dispatchers.IO) {
            try {
                forget(pkg)
                loaded.keys.removeAll { ownedBy(it, pkg) }
                staged.remove(pkg)
                builtinSpecs.reset(pkg)
                loader.prune(pkg, emptySet())
                call.resolve()
            } catch (t: Throwable) { call.reject(t.message ?: t.readable()) }
        }
    }

    /**
     * المرحلة 2 من «صفر مصادر مدمجة» (BuiltinMigration): الحزم المدمجة الظاهرة لهذا الحساب (قرار الواجهة من المزامنة،
     * lib/source-entitlement.js) تصير إضافات مثبّتة بالنسخة نفسها التي على الجهاز. لا شبكة ولا تحميل كود: السجل يشير
     * إلى البصمة الحالية، والنسخة تُقرأ أو تُنزَّل موثّقة بها عند أول طلب كما كانت. `keepRepository`: الحساب القديم
     * و«بلا حساب» يُحفظ لهما مستودع Keiyoushi (قرار المالك 21 نوفمبر). فشل حزمة لا يوقف غيرها ولا يخفيها: تبقى مدمجة
     * وتُعاد في التبليغ التالي.
     */
    @PluginMethod
    fun migrateBuiltins(call: PluginCall) {
        val array = call.getArray("pkgs") ?: return call.reject("pkgs مطلوبة")
        val keepRepository = call.getBoolean("keepRepository", false) == true
        val pkgs = (0 until array.length()).mapNotNull { array.optString(it).takeIf { pkg -> packageSpec(pkg) != null && packageSpec(pkg)?.blockedReason == null } }.distinct()
        scope.launch(Dispatchers.IO) {
            try {
                val failed = JSArray()
                val records = pkgs.mapNotNull { pkg ->
                    runCatching {
                        val base = packageSpec(pkg)!!
                        val current = localArtifactSpec(base) ?: builtinSpecs.current(base)
                        val previous = builtinSpecs.previousOf(base)?.takeIf { loader.readVerifiedCache(it) != null }
                        val loadedSources = packages[pkg]?.map { UserSource(it.id.toString(), it.name, it.lang) }
                        BuiltinMigration.record(base, current, previous, BuiltinMigration.sourcesOf(pkg, loadedSources))
                            .takeIf { it.sources.isNotEmpty() } ?: error("no declared source")
                    }.onFailure {
                        if (it is CancellationException) throw it
                        failed.put(pkg)
                        android.util.Log.w("ExtensionEngine", "BUILTIN_MIGRATION_DEFERRED:$pkg ${it.javaClass.simpleName}")
                    }.getOrNull()
                }
                var outcome: BuiltinMigration.Outcome? = null
                userStore.update { st -> BuiltinMigration.apply(st, records, keepRepository).also { outcome = it }.state }
                val done = outcome!!
                if (done.migrated.isNotEmpty()) android.util.Log.i("ExtensionEngine", "BUILTIN_MIGRATED:${done.migrated.joinToString(",")}")
                call.resolve(JSObject().put("migrated", JSArray(done.migrated)).put("skipped", JSArray(done.skipped)).put("failed", failed))
            } catch (t: Throwable) {
                if (t is CancellationException) throw t
                call.reject(t.message ?: t.readable())
            }
        }
    }

    /** الحزم التي جُهّزت في هذه العملية: التبليغ يتكرر مع كل تغيّر مزامنة ولا يعيد التنزيل. */
    private val staged = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()

    /**
     * Debug مفصول بلا نسخ مضمّنة: المصدر الظاهر للحساب بلا نسخة على الجهاز يُجهَّز الآن في الخلفية (تنزيل
     * موثّق ← تحميل فعلي ← المخزن) فيفتح القارئ كما كان قبل الفصل. فشل التجهيز (شبكة، موقع) لا يُظهر شيئًا
     * ولا يحذف شيئًا، ويُعاد عند فتح المصدر أو في الإقلاع التالي.
     */
    private fun stageVisible(pkgs: Set<String>) {
        for (pkg in pkgs) {
            if (loaded.keys.any { splitSourceId(it.substringBefore('#')).first == pkg } || hasLocalCopy(pkg) || !staged.add(pkg)) continue
            val id = if (SPIKE_SOURCES.any { it.pkg == pkg }) pkg
                else FILLER_SOURCES.firstOrNull { it.pkg == pkg }?.let { "${it.pkg}@${it.lang}" } ?: continue
            scope.launch(Dispatchers.IO) {
                runCatching { obtain(id) }.onFailure {
                    staged.remove(pkg)
                    android.util.Log.i("ExtensionEngine", "BUILTIN_STAGE_DEFERRED:$pkg ${ExtensionFailure.classify(it).code}")
                }
            }
        }
    }

    // ───────────────────────── مستودعات المستخدم ─────────────────────────

    private fun JSObject.withIcon(iconUrl: String?) = apply { iconUrl?.let { put("iconUrl", it) } }
    private fun repoJson(repo: UserRepo) = JSObject().put("url", repo.url).put("name", repo.name).withIcon(repo.iconUrl)

    @PluginMethod
    fun repos(call: PluginCall) {
        scope.launch {
            try {
                val st = userStore.state
                call.resolve(
                    JSObject()
                        .put("readyCatalogDismissed", st.readyCatalogDismissed)
                        .put("repos", JSArray(st.repos.map { repoJson(it) }))
                        .put("installed", JSArray(st.extensions.map {
                            JSObject().put("pkg", it.pkg).put("name", it.name).put("version", it.versionName).put("repo", it.repoUrl)
                                .withIcon(NativeExtensionIcons.iconUrl(context, "extensions", it.pkg, it.sha256)
                                    ?: RepoIndex.iconUrl(it.iconUrl, it.repoUrl)
                                    ?: RepoIndex.legacyIconUrl(it.repoUrl, it.pkg)
                                    ?: st.repos.firstOrNull { repo -> repo.url == it.repoUrl }?.iconUrl)
                        })),
                )
            } catch (t: Throwable) { call.reject(t.message ?: t.readable()) }
        }
    }

    /** يضيف مستودعًا بعد قراءة repo.json (مفتاح التوقيع) وindex.min.json. */
    @PluginMethod
    fun addRepo(call: PluginCall) {
        scope.launch {
            try {
                val base = RepoIndex.base(call.getString("url") ?: error("رابط المستودع مطلوب"))
                val (meta, list) = repoClient.read(base)
                val count = list.size
                val repo = UserRepo(base, meta.name, meta.fingerprint, meta.iconUrl)
                userStore.registerRepository(repo)
                call.resolve(JSObject().put("repo", repoJson(repo)).put("count", count))
            } catch (t: Throwable) {
                rejectMangaMutation(call, t)
            }
        }
    }

    @PluginMethod
    fun removeRepo(call: PluginCall) {
        scope.launch {
            try {
                val base = RepoIndex.base(call.getString("url") ?: error("رابط المستودع مطلوب"))
                userStore.unlinkRepository(base)
                call.resolve()
            } catch (t: Throwable) {
                rejectMangaMutation(call, t)
            }
        }
    }

    /** «مصادر جاهزة» قائمة اختيارية في القناتين بعد فصل Stable (RS2). إخفاؤها لا يزيل حزمة ولا مصدرًا. */
    @PluginMethod
    fun removeReadySources(call: PluginCall) {
        try {
            userStore.dismissReadyCatalogue()
            call.resolve()
        } catch (t: Throwable) { call.reject(t.message ?: t.readable()) }
    }

    /** إضافات المستودع كما يعلنها الآن، مع حالتها عندنا (مثبتة، تحديث، مدمجة، أنمي). */
    @PluginMethod
    fun repoIndex(call: PluginCall) {
        scope.launch {
            try {
                val base = RepoIndex.base(call.getString("url") ?: error("رابط المستودع مطلوب"))
                userStore.state.repos.firstOrNull { it.url == base } ?: error("أضف المستودع أولًا")
                val list = JSArray()
                for (ext in repoClient.read(base).second) {
                    val mine = userStore.extension(ext.pkg)
                    list.put(
                        JSObject()
                            .put("pkg", ext.pkg)
                            .put("name", ext.name)
                            .put("version", ext.version)
                            .put("lang", ext.lang)
                            .put("nsfw", ext.nsfw)
                            .put("anime", ext.anime)
                            .put("arabic", ext.sources.any { it.lang.equals("ar", ignoreCase = true) })
                            .put("builtin", packageSpec(ext.pkg) != null && mine == null && !builtinClosed(ext.pkg))
                            .put("installed", mine?.versionName)
                            .put("update", mine != null && mine.versionName != ext.version)
                            .put("sources", JSArray(RepoIndex.visibleSources(ext).map { it.name }))
                            .withIcon(mine?.let { NativeExtensionIcons.iconUrl(context, "extensions", it.pkg, it.sha256) }
                                ?: packageSpec(ext.pkg)?.let { NativeExtensionIcons.iconUrl(context, "extensions", it.pkg, it.sha256) }
                                ?: ext.iconUrl ?: userStore.state.repos.firstOrNull { it.url == base }?.iconUrl),
                    )
                }
                call.resolve(JSObject().put("extensions", list))
            } catch (t: Throwable) {
                call.reject(t.message ?: t.readable())
            }
        }
    }

    /**
     * تنزيل ⇒ التحقق من توقيع المستودع ⇒ تثبيت البصمة ⇒ تحميل تجريبي. لا يُحفظ شيء
     * إن لم تُحمَّل الحزمة فعلًا وتُخرج مصادرها.
     */
    /** تثبيت أو تحديث مُجهَّز: نُزّل ووُقّع وحُمّل تجريبيًا، ولم يُفعَّل بعد. */
    private class StagedInstall(
        val token: UserExtensionStore.InstallToken, val user: UserExtension, val all: List<CatalogueSource>,
        val sourceIds: List<String>, val ids: List<String>, val entry: RepoIndex.Extension,
    )

    /**
     * تنزيل ⇒ التحقق من توقيع المستودع ⇒ تثبيت البصمة ⇒ تحميل تجريبي. لا يُحفظ شيء هنا: [commitStaged] يفعّله.
     * التحديث لا يمس الإصدار العامل حتى يثبت الجديد: يُكتب بجانبه في المخزن ويُحمَّل تجريبيًا، وإن فشل بقي القديم
     * محمَّلًا ومثبّتًا كما هو (كان يُحذف أولًا فيضيع آخر إصدار سليم).
     */
    private suspend fun stageInstall(base: String, pkg: String): StagedInstall {
        val token = userStore.beginInstall(pkg, base)
        val repo = token.repository
        val ext = repoClient.readTrusted(repo).firstOrNull { it.pkg == pkg } ?: error("الإضافة لم تعد في المستودع")
        require(!ext.anime) { "إضافات الأنمي (Aniyomi) غير مدعومة بعد" }
        // لا رجوع لإصدار أقدم من المستودع: فهرس قديم أو متلاعب به لا يعيد ثغرة أُصلحت (أسلوب TUF)
        token.previous?.let { mine ->
            require(ext.versionCode <= 0 || ext.versionCode >= mine.versionCode) { "${ext.name}: الإصدار في المستودع (${ext.version}) أقدم من المثبت عندك (${mine.versionName})؛ لا نرجع لإصدار أقدم" }
        }
        val apkUrl = ext.apkUrl
        val bytes = repoClient.downloadSigned(apkUrl, repo.fingerprint)
        val visible = RepoIndex.visibleSources(ext)
        val fresh = UserExtension(
            repoUrl = base, name = ext.name, pkg = pkg, apkUrl = apkUrl, sha256 = sha256Hex(bytes),
            versionName = ext.version, lib = ext.lib, lang = ext.lang, nsfw = ext.nsfw,
            sources = visible.map { UserSource(it.id, it.name, it.lang) }, versionCode = ext.versionCode, iconUrl = ext.iconUrl,
        )
        val user = token.previous?.upgradedTo(fresh) ?: fresh
        val all = when (val result = loader.load(user.spec(), bytes)) {
            is FileExtensionLoader.Result.Fail -> error("${ext.name}: ${result.stage} — ${result.reason}")
            is FileExtensionLoader.Result.Ok -> result.loaded.sources.filterIsInstance<CatalogueSource>()
        }
        val sourceIds = all.map { it.id.toString() }
        require(visible.any { it.id in sourceIds }) { "${ext.name}: الحزمة لا تحوي المصادر التي أعلنها المستودع" }
        return StagedInstall(token, user, all, sourceIds, visible.map { "$pkg#${it.id}" }, ext)
    }

    private fun commitStaged(staged: StagedInstall) {
        val pkg = staged.user.pkg
        userStore.commitInstall(staged.token, staged.user, this@ExtensionEnginePlugin,
            validate = { validateSourceIds(pkg, staged.sourceIds) }) {
            publishSourceIds(pkg, staged.sourceIds)
            forget(pkg)
            packages[pkg] = staged.all
            // No later install/uninstall may race an old version's cleanup.
            try { loader.prune(pkg, setOfNotNull(staged.user.sha256, staged.user.previous?.sha256)) }
            catch (cleanup: Exception) {
                if (cleanup is CancellationException) throw cleanup
                // Optional garbage collection cannot turn an activated install into a false failure.
                android.util.Log.w("ExtensionEngine", "MANGA_PRUNE_DEFERRED:$pkg ${cleanup.javaClass.simpleName}")
            }
        }
    }

    @PluginMethod
    fun installExtension(call: PluginCall) {
        scope.launch {
            try {
                val base = RepoIndex.base(call.getString("repo") ?: error("المستودع مطلوب"))
                val pkg = call.getString("pkg") ?: error("الإضافة مطلوبة")
                val staged = stageInstall(base, pkg)
                commitStaged(staged)
                // تحديث يدوي: المستخدم اختار هذا الإصدار، فيُرفع أي تثبيت على إصدار سابق رجع إليه
                updateHolds.edit().remove(pkg).apply()
                call.resolve(JSObject().put("ids", JSArray(staged.ids)))
            } catch (t: Throwable) {
                rejectMangaMutation(call, t)
            }
        }
    }

    // ───────────────────────── التحديث الذاتي الآمن (MangaSelfUpdate) ─────────────────────────

    /** الإصدار الذي رجع منه المستخدم يدويًا لكل حزمة: التلقائي لا يعود إليه، ويُحدَّث فقط إلى أحدث منه. */
    private val updateHolds by lazy { context.getSharedPreferences("vantara_manga_update_holds", android.content.Context.MODE_PRIVATE) }
    /** آخر نتيجة تحديث تلقائي لكل حزمة (للواجهة: «حُدّثت تلقائيًا» أو «الإصدار الجديد لم يعمل فبقي الحالي»). */
    private val autoUpdateLog by lazy { context.getSharedPreferences("vantara_manga_auto_updates", android.content.Context.MODE_PRIVATE) }
    private val failureChecks = java.util.concurrent.ConcurrentHashMap<String, Long>()

    /** هل يعمل الإصدار المجهَّز فعلًا؟ مصدر واحد يرجع أعمالًا من الرائج (أو آخر التحديثات) يكفي. */
    private suspend fun preflight(staged: StagedInstall): UpdatePreflight.Verdict {
        val wanted = staged.user.sources.map { it.id }.toSet()
        val candidates = staged.all.filter { it.id.toString() in wanted }.ifEmpty { staged.all }.take(3)
        val outcomes = candidates.map { source ->
            try {
                kotlinx.coroutines.withTimeout(UpdatePreflight.PER_SOURCE_MS) {
                    val page = runCatching { source.getPopularManga(1) }.getOrElse { source.getLatestUpdates(1) }
                    if (page.mangas.isNotEmpty()) UpdatePreflight.Outcome.Passed
                    else UpdatePreflight.Outcome.Failed(IllegalStateException("CANDIDATE_CATALOGUE_EMPTY"))
                }
            } catch (failure: Throwable) {
                if (failure is CancellationException && failure !is kotlinx.coroutines.TimeoutCancellationException) throw failure
                UpdatePreflight.Outcome.Failed(failure)
            }
        }
        return UpdatePreflight.decide(outcomes)
    }

    /** فحص إضافة واحدة: إصدار أحدث، غير مثبَّت عنه، ويعمل فعلًا ⇒ يُفعَّل. يعيد القرار. */
    private suspend fun autoUpdate(ext: UserExtension, entry: RepoIndex.Extension): MangaSelfUpdate.Action {
        val newer = MangaSelfUpdate.newer(ext.versionCode, ext.versionName, entry.versionCode, entry.version)
        val held = updateHolds.getLong(ext.pkg, -1L).takeIf { it >= 0 }
        val early = MangaSelfUpdate.decide(newer, held, entry.versionCode, UpdatePreflight.Verdict(true, "RUNTIME_UPDATE_VERIFIED"))
        if (early != MangaSelfUpdate.Action.APPLY) return early
        val staged = runCatching { stageInstall(ext.repoUrl, ext.pkg) }
            .onFailure { if (it is CancellationException) throw it }.getOrNull()
        val verdict = staged?.let { preflight(it) }
        val action = MangaSelfUpdate.decide(newer, held, entry.versionCode, verdict)
        if (action == MangaSelfUpdate.Action.APPLY) commitStaged(staged!!)
        else if (staged != null) runCatching { loader.prune(ext.pkg, setOfNotNull(ext.sha256, ext.previous?.sha256)) }
        autoUpdateLog.edit().putString(ext.pkg, "${action.name}|${entry.version}|${verdict?.code ?: "STAGE_FAILED"}|${System.currentTimeMillis()}").apply()
        android.util.Log.i("ExtensionEngine", "MANGA_AUTO_UPDATE:${ext.pkg} ${entry.version} ${action.name} ${verdict?.code}")
        return action
    }

    /** فحص يومي لإضافات المستخدم (SE3): بعد دقيقة ونصف من الإقلاع، مرة كل 24 ساعة، ومستودع كل إضافة يُقرأ مرة. */
    private suspend fun autoUpdateUserExtensionsDaily() {
        val stamp = java.io.File(context.filesDir, "extensions/user-update-at")
        val last = runCatching { stamp.readText().trim().toLong() }.getOrDefault(0L)
        if (System.currentTimeMillis() - last < MangaSelfUpdate.DAILY_MS) return
        kotlinx.coroutines.delay(90_000)
        val mine = runCatching { userStore.state.extensions }.getOrDefault(emptyList())
        for ((repoUrl, exts) in mine.groupBy { it.repoUrl }) {
            val repo = userStore.state.repos.firstOrNull { it.url == repoUrl } ?: continue
            val index = runCatching { repoClient.readTrusted(repo) }.getOrNull() ?: continue
            for (ext in exts) {
                val entry = index.firstOrNull { it.pkg == ext.pkg && !it.anime } ?: continue
                runCatching { autoUpdate(ext, entry) }.onFailure { if (it is CancellationException) throw it }
            }
        }
        runCatching { stamp.parentFile?.mkdirs(); stamp.writeText(System.currentTimeMillis().toString()) }
    }

    /** EF1: فشل يعني أن الموقع تغيّر ⇒ فحص تحديث فوري لتلك الإضافة (مرة كل 6 ساعات على الأكثر). */
    private fun checkUpdateAfterFailure(sourceId: String?, code: String) {
        if (sourceId.isNullOrBlank() || !MangaSelfUpdate.suggestsUpdate(code)) return
        // المعرّف القديم لحزمة مثبّتة من مستودع يُفحص أيضًا (بلا إضافة مثبّتة يعود أدناه كما كان)
        val pkg = if ('#' in sourceId) sourceId.substringBefore('#') else splitSourceId(sourceId).first
        val now = System.currentTimeMillis()
        if (now - (failureChecks[pkg] ?: 0L) < MangaSelfUpdate.FAILURE_CHECK_GAP_MS) return
        failureChecks[pkg] = now
        scope.launch(Dispatchers.IO) {
            runCatching {
                val ext = userStore.extension(pkg) ?: return@runCatching
                val repo = userStore.state.repos.firstOrNull { it.url == ext.repoUrl } ?: return@runCatching
                val entry = repoClient.readTrusted(repo).firstOrNull { it.pkg == pkg && !it.anime } ?: return@runCatching
                autoUpdate(ext, entry)
            }.onFailure { if (it is CancellationException) throw it }
        }
    }

    /** «ارجع للإصدار السابق»: آخر إصدار سليم محفوظ على الجهاز يصير الحالي، ويُثبَّت عليه فلا يعيده التلقائي. */
    @PluginMethod
    fun rollbackExtension(call: PluginCall) {
        scope.launch(Dispatchers.IO) {
            try {
                val pkg = call.getString("pkg") ?: error("الإضافة مطلوبة")
                val user = userStore.extension(pkg) ?: error("الإضافة غير مثبتة")
                val previous = user.previousSpec() ?: error("لا إصدار سابق محفوظ لهذه الإضافة")
                loader.readVerifiedCache(previous) ?: error("نسخة الإصدار السابق لم تعد على الجهاز")
                val back = user.rolledBack() ?: error("لا إصدار سابق محفوظ لهذه الإضافة")
                userStore.update { st -> st.copy(extensions = st.extensions.map { if (it.pkg == pkg) back else it }) }
                forget(pkg)
                if (user.versionCode > 0) updateHolds.edit().putLong(pkg, user.versionCode).apply()
                call.resolve(JSObject().put("version", back.versionName).put("from", user.versionName))
            } catch (t: Throwable) {
                rejectMangaMutation(call, t)
            }
        }
    }

    /** حالة التحديث لإضافة مثبتة: هل لها إصدار سابق للرجوع، وآخر نتيجة تلقائية. */
    @PluginMethod
    fun updateState(call: PluginCall) {
        val pkg = call.getString("pkg") ?: return call.reject("الإضافة مطلوبة")
        val user = userStore.extension(pkg)
        val last = autoUpdateLog.getString(pkg, null)?.split('|')
        call.resolve(
            JSObject()
                .put("installed", user?.versionName)
                .put("previous", user?.previous?.versionName)
                .put("held", updateHolds.getLong(pkg, -1L).takeIf { it >= 0 })
                .put("lastAction", last?.getOrNull(0))
                .put("lastVersion", last?.getOrNull(1))
                .put("lastCode", last?.getOrNull(2))
                .put("lastAt", last?.getOrNull(3)?.toLongOrNull()),
        )
    }

    @PluginMethod
    fun uninstallExtension(call: PluginCall) {
        val pkg = call.getString("pkg") ?: return call.reject("الإضافة مطلوبة")
        try {
            // EE2: الحزمة المدمجة سابقًا تُحذف كأي إضافة، ولا تعود مدمجة بعدها (BuiltinMigration)
            if (packageSpec(pkg) != null) userStore.update { st -> if (pkg in st.formerBuiltins) st else st.copy(formerBuiltins = st.formerBuiltins + pkg) }
            userStore.uninstall(pkg, this@ExtensionEnginePlugin, {
                forget(pkg)
                owners.values.removeAll { it == pkg }
            }, { loader.erase(pkg) })
            call.resolve()
        } catch (error: Throwable) {
            rejectMangaMutation(call, error)
        }
    }

    private fun rejectMangaMutation(call: PluginCall, error: Throwable) {
        if (error is CancellationException) throw error
        val code = error.message
        val message = when (code) {
            "MANGA_PACKAGE_CHANGED" -> "تغيّرت الإضافة أو حُذفت أثناء الفحص؛ لم تُفعّل هذه المحاولة. أعد المحاولة إذا رغبت."
            "MANGA_REPOSITORY_CHANGED" -> "تغيّر المستودع أثناء التثبيت أو التحديث؛ لم تُفعّل هذه المحاولة. أعد المحاولة."
            "MANGA_REPOSITORY_KEY_CHANGED" -> "تغيّر مفتاح توقيع المستودع؛ احتُفظ بالمستودع وإضافاته الحالية ولم يُعتمد المفتاح الجديد."
            else -> null
        }
        if (message == null) call.reject(error.message ?: error.readable())
        else call.reject(message, code)
    }

    /** يُخرج الحزمة من الذاكرة فقط؛ ملفاتها في المخزن تبقى (الحذف بـ[FileExtensionLoader.erase]). */
    private fun forget(pkg: String) {
        packages.remove(pkg)
        loaded.keys.removeAll { ownedBy(it, pkg) }
        // SE2: إصدار جديد (تحديث، رجوع، حذف) = حقبة جديدة لكاش صفحاته؛ صورة «تحذير» قديمة بتوقيع صورة سليم لا تبقى
        runCatching { cacheEpochs.edit().putLong(pkg, System.currentTimeMillis()).apply() }
    }

    /** حقبة كاش صفحات الحزمة (0 = لم تُحدَّث منذ وُجد الكاش، فيبقى مفتاحه القديم صالحًا). */
    private val cacheEpochs by lazy { context.getSharedPreferences("vantara_page_cache_epochs", android.content.Context.MODE_PRIVATE) }
    private fun pageCacheKey(sourceId: String, url: String): String =
        pageCacheKeyOf(cacheEpochs.getLong(splitSourceId(sourceId.substringBefore('#')).first, 0L), url)

    /** مالك كل معرّف مصدر محمَّل: حزمتان بمعرّف واحد تتشاركان تفضيلات `source_<id>` وكوكيزه. */
    private val owners = java.util.concurrent.ConcurrentHashMap<String, String>()

    /**
     * يحجز معرّفات مصادر الحزمة أو يرفضها كلها: معرّف تملكه حزمة أخرى أو المعرّف 0 (المصدر المحلي) يرمي
     * `ID_COLLISION` ولا يحلّ مصدرٌ محلّ آخر بصمت كما في Mihon (PERSISTENT_PLUGINS §3.2).
     */
    @Synchronized private fun claimIds(pkg: String, sources: List<CatalogueSource>) {
        val ids = sources.map { it.id.toString() }
        validateSourceIds(pkg, ids)
        publishSourceIds(pkg, ids)
    }

    /** Called only while holding this plugin's publication monitor; never accesses the store. */
    private fun validateSourceIds(pkg: String, ids: List<String>) {
        ids.firstOrNull { it == "0" }?.let { error("ID_COLLISION: المعرّف 0 محجوز") }
        ids.firstOrNull { owners[it]?.let { owner -> owner != pkg } == true }?.let { error("ID_COLLISION: المعرّف $it تملكه ${owners[it]}") }
    }

    private fun publishSourceIds(pkg: String, ids: List<String>) {
        owners.values.removeAll { it == pkg }
        for (id in ids) owners[id] = pkg
    }



    /** تنزيل ⇒ تحقّق بصمة ⇒ تحميل من ملف. يُستدعى مرة، ثم يُخدَم من الذاكرة. */
    @PluginMethod
    fun prepare(call: PluginCall) {
        scope.launch {
            try {
                val source = obtain(requireSourceId(call))
                // `baseUrl` قد يُحسب عند أول وصول عبر تفضيلات أو مرايا، وفشل
                // الـgetter نفسه لا يجوز أن يُسقط نداءً نجح تحميلُه.
                val base = runCatching { (source as? HttpSource)?.baseUrl }.getOrNull()
                call.resolve(
                    JSObject()
                        .put("ok", true)
                        .put("name", source.name)
                        .put("lang", source.lang)
                        .put("baseUrl", base),
                )
            } catch (t: Throwable) {
                fail(call, t)
            }
        }
    }

    /**
     * الكتالوج كاملًا: ما يتصفّحه «استكشاف».
     *
     * `popular` ليس كتالوجًا: Dilar يرجع ترتيبه من عشرة أعمال (والكتالوج 8998)،
     * وMangaDex يتصفّح 85,664 عملًا بكل اللغات (العربي 990)، وAzora بترتيبه
     * الافتراضي يكرّر ويُسقط خُمس أعماله. المسار يُحسم مرة لكل مصدر بنفس محلّل
     * الـspike وبفلاتر `CatalogueFilterPolicy` نفسها.
     */
    @PluginMethod
    fun catalogue(call: PluginCall) = paged(call) { source, page ->
        val sourceId = requireSourceId(call)
        val filters = CatalogueFilterPolicy.catalogueFilters(source)
        suspend fun fetch(kind: CatalogueListingKind, at: Int) = when (kind) {
            CatalogueListingKind.SEARCH_ALL -> source.getSearchManga(at, "", filters)
            CatalogueListingKind.POPULAR -> source.getPopularManga(at)
            CatalogueListingKind.LATEST -> source.getLatestUpdates(at)
        }
        val known = listings[sourceId]
        if (known != null) {
            fetch(known, page)
        } else {
            val resolved = resolveFullCatalogueListing { kind -> fetch(kind, 1) }
            listings[sourceId] = resolved.kind
            if (page == 1) resolved.firstPage else fetch(resolved.kind, page)
        }
    }

    /** المسار الذي حُسم لكل مصدر؛ حسمه يكلّف حتى ثلاثة طلبات فلا يُعاد. */
    private val listings = java.util.concurrent.ConcurrentHashMap<String, CatalogueListingKind>()

    /** الرائج: هذه هي الواجهة الأولى التي يراها القارئ عند فتح مصدر. */
    @PluginMethod
    fun popular(call: PluginCall) = paged(call) { source, page ->
        source.getPopularManga(page)
    }

    /** آخر التحديثات — وهذا مصدر «الجلب التلقائي» للفصول الجديدة. */
    @PluginMethod
    fun latest(call: PluginCall) = paged(call) { source, page ->
        source.getLatestUpdates(page)
    }

    /**
     * أعمال تصنيفٍ من مصدر، بفلتر المصدر نفسه لا بالبحث عن الكلمة.
     * مصدرٌ بلا هذا التصنيف يرجع صفحة فارغة فتتجاوزه الواجهة.
     */
    @PluginMethod
    fun genre(call: PluginCall) = paged(call) { source, page ->
        val names = call.getArray("names")?.toList<String>().orEmpty()
        val filters = dev.vantara.spike.GenreFilterPolicy.filters(source, names)
        if (filters == null) {
            eu.kanade.tachiyomi.source.model.MangasPage(emptyList(), false)
        } else {
            source.getSearchManga(page, "", filters)
        }
    }

    @PluginMethod
    fun search(call: PluginCall) = paged(call) { source, page ->
        val query = call.getString("query").orEmpty()
        // فلاتر المصدر الافتراضية كما يمرّرها Mihon: بعض الإضافات (Manga Tales)
        // تبحث عن فلترها في القائمة وتنهار إن جاءت فارغة
        source.getSearchManga(page, query, runCatching { source.getFilterList() }.getOrElse { FilterList() })
    }

    /**
     * تفاصيل عمل وفصوله في **نداء واحد**. يأخذ العمل كاملًا لا رابطه، فـ`memo`
     * يعود معه.
     *
     * الجمع ليس تحسينًا بل تصحيحُ عقد. `getMangaUpdate` في lib 1.6 مصمَّمة
     * لتردّ الاثنين معًا، وإضافاتها تحرس ضد ندائين متوازيين لنفس العمل فترمي
     * `getMangaUpdate must not be called concurrently for same manga`. وشطرُها
     * إلى `details` و`chapters` متوازيين كان يُسقط كل مصدر 1.6 سقوطًا يبدو
     * عشوائيًّا — يمرّ حين يسبق أحد النداءين الآخر، ويثبت حين يفشل الجلب
     * فيترك حارس الإضافة العملَ مسمومًا إلى أن يُعاد تشغيل التطبيق. ومصادر
     * 1.4 كانت تنجو لأن جسرنا يترجم النداء بلا حارس — وهذا وحده سبب أن
     * Mangalek كان يعمل وغيره لا.
     *
     * والتفاصيل تبقى ثانوية كما كانت: إن سقط النداء الجامع طُلبت الفصول
     * وحدها — بالتتابع لا بالتوازي — فوصفٌ مكسور لا يمنع القراءة.
     */
    @PluginMethod
    fun series(call: PluginCall) {
        scope.launch {
            try {
                val source = obtain(requireSourceId(call))
                val input = mangaFrom(call.getObject("manga"))
                val update = try {
                    // إصلاحات المصادر (Hizo) تمرّ من هنا؛ الباقي نداءٌ جامع واحد
                    SourceCompatRepairs.loadSeries(source, input)
                } catch (cancel: CancellationException) {
                    // لا `runCatching` هنا: يبتلع الإلغاء فيطلق نداءً شبكيًّا
                    // ثانيًا بعد أن تكون الشاشة أُغلقت.
                    throw cancel
                } catch (ignored: Throwable) {
                    SMangaUpdate(input, SourceCompatRepairs.loadChapters(source, input))
                }
                // محلّلات التفاصيل ترجع عادةً SManga جزئيًّا بلا url. المستضيف
                // يعرف الرابط الأصلي من البحث ويجب أن يحمله معه.
                val out = update.manga
                out.url = input.url
                if (!out.isTitleSet()) out.title = input.title
                val chapters = JSArray()
                update.chapters.forEach { chapters.put(it.toJs()) }
                call.resolve(
                    JSObject()
                        .put("manga", out.toJs())
                        .put("chapters", chapters)
                        .put("count", update.chapters.size),
                )
            } catch (t: Throwable) {
                fail(call, t)
            }
        }
    }

    /**
     * فصول عمل بلا تفاصيله.
     *
     * هذا طريق الدمج: حين يوجد العمل في أكثر من مصدر نطلب فصول البقية وحدها،
     * فوصفُها لا يعنينا وقد جاء من المصدر الأول. ولا تصادم مع [series]: كل
     * مصدر كائنٌ مستقل بحارسه، والنداءات تتوازى بين المصادر لا داخل الواحد.
     */
    @PluginMethod
    fun chapters(call: PluginCall) {
        scope.launch {
            try {
                val source = obtain(requireSourceId(call))
                val manga = mangaFrom(call.getObject("manga"))
                val list = SourceCompatRepairs.loadChapters(source, manga)
                val out = JSArray()
                list.forEach { out.put(it.toJs()) }
                call.resolve(JSObject().put("chapters", out).put("count", list.size))
            } catch (t: Throwable) {
                fail(call, t)
            }
        }
    }

    @PluginMethod
    fun pages(call: PluginCall) {
        scope.launch {
            try {
                val source = obtain(requireSourceId(call))
                val chapter = chapterFrom(call.getObject("chapter"))
                // Dilar وMangaDar يحتاجان إصلاح صفحاتٍ أثبته الـspike على الجهاز
                val list = SourceCompatRepairs.loadPages(source, chapter)
                val out = JSArray()
                list.forEach { out.put(it.toJs()) }
                call.resolve(JSObject().put("pages", out).put("count", list.size))
            } catch (t: Throwable) {
                fail(call, t)
            }
        }
    }

    /**
     * صورة صفحة، تُكتب في كاش التطبيق ويُرجَع مسارها.
     *
     * مسارٌ لا base64 بقصد: فصلٌ من ثلاثين صفحة بمتوسط ٢م يصير ٨٠م نصًّا بعد
     * الترميز، يمرّ كله عبر جسر JSON ويسكن ذاكرة الصفحة. أما الملف فيقرؤه
     * `<img>` من خادم Capacitor المحلي بلا نسخة ثانية، ويتكفّل المتصفح
     * بتفريغه. ومن أراد البايتات في النداء نفسه يطلب `inline: true`.
     *
     * والجلب بعميل المصدر وترويساته: مضيفات الصور تردّ 403 بلا `Referer`
     * الصحيح، فعميلٌ عامّ يفشل على صورةٍ سليمة ويُقرأ الفشل كعطل مصدر.
     */
    @PluginMethod
    fun image(call: PluginCall) {
        scope.launch {
            try {
                val sourceId = requireSourceId(call)
                val source = obtain(sourceId)
                val asHttp = source as? HttpSource
                val page = pageFrom(call.getObject("page"))
                val url = page.imageUrl
                    ?: asHttp?.let { runCatching { it.getImageUrl(page) }.getOrNull() }
                    ?: throw PageImageException("page carries no imageUrl", noImageUrl = true)

                val cacheKey = pageCacheKey(sourceId, url)
                val hit = withContext(Dispatchers.IO) { cacheHit(cacheKey) }
                val file: java.io.File
                val bytes: ByteArray
                val type: String

                if (hit != null) {
                    file = hit
                    // «آخر استعمال» للتسقيف: الصفحة التي تقرؤها الآن لا تُطرد أولًا
                    runCatching { hit.setLastModified(System.currentTimeMillis()) }
                    bytes = withContext(Dispatchers.IO) { hit.readBytes() }
                    type = typeForExtension(hit.extension)
                } else {
                    page.imageUrl = url
                    val fetched = withContext(Dispatchers.IO) {
                        if (asHttp != null) {
                            // Preserve the extension's imageRequest override
                            // (Referer/Origin/custom headers) and keep the
                            // streaming response alive until its body is read.
                            asHttp.getImage(page).use { res ->
                                // رمز الخطأ نفسه (403/429…) لا «ليست صورة» بعد قراءة صفحة الخطأ
                                if (!res.isSuccessful) throw eu.kanade.tachiyomi.network.HttpException(res.code)
                                res.body.bytes() to res.header("content-type")
                            }
                        } else {
                            network.client.newCall(Request.Builder().url(url).build()).execute().use { res ->
                                require(res.isSuccessful) { "image HTTP ${res.code} ← $url" }
                                res.body.bytes() to res.header("content-type")
                            }
                        }
                    }
                    // IP1: HEIC لا يفكه WebView: يُحوَّل JPEG هنا (أندرويد 9+ يفكه)، وإلا سبب واضح لا صفحة فارغة
                    bytes = if (ImagePayloadPolicy.sniffType(fetched.first) == "image/heic") heicToJpeg(fetched.first) else fetched.first
                    // حاجزٌ يفصل صورةً عن صفحة حجبٍ تُردّ بـ200: التوقيع هو الحكم (لا الحجم: صفحة فاصلة
                    // بيضاء PNG أقل من كيلوبايت صورة صحيحة، وكانت تُرفض فيفشل الفصل كله). يُفحص قبل الكاش
                    val verdict = ImagePayloadPolicy.validate(fetched.second, bytes)
                    if (!verdict.accepted) throw PageImageException("not an image (${bytes.size} bytes): ${verdict.reason}")
                    // النوع من البايتات أولًا، ثم الاستجابة، ثم امتداد الرابط
                    type = ImagePayloadPolicy.sniffType(bytes) ?: fetched.second?.substringBefore(';')?.trim()?.takeIf {
                        it.startsWith("image/")
                    } ?: typeForUrl(url)
                    file = cacheFile(cacheKey, extensionForType(type))
                    // كتابة ذرّية: القارئ والترجمة المقدّمة قد يطلبان الصفحة نفسها معًا، وملفٌ
                    // نصف مكتوب كان يُقرأ «موجودًا» فتُحلَّل صفحة مبتورة. مؤقت ثم إعادة تسمية
                    // كاش الصفحات كان بلا سقف: كل صفحة قُرئت تبقى للأبد (جيجابايتات). يُسقَّف كل 150 صفحة جديدة
                    if (++pageWrites % 150 == 0) scope.launch(Dispatchers.IO) { runCatching { StoragePlugin.capDir(pageCacheDir, StoragePlugin.PAGE_CACHE_CAP) } }
                    withContext(Dispatchers.IO) {
                        val tmp = java.io.File(file.parentFile, "${file.name}.${System.nanoTime()}.part")
                        tmp.writeBytes(bytes)
                        if (!tmp.renameTo(file)) {
                            tmp.delete()
                            if (!(file.isFile && file.length() == bytes.size.toLong())) error("cannot cache page image")
                        }
                    }
                }

                val out = JSObject()
                    .put("path", file.absolutePath)
                    .put("bytes", bytes.size)
                    .put("contentType", type)
                    .put("cached", hit != null)
                    .put("sourceUrl", url)
                if (call.getBoolean("inline", false) == true) {
                    out.put(
                        "dataUrl",
                        "data:$type;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP),
                    )
                }
                call.resolve(out)
            } catch (t: Throwable) {
                fail(call, t)
            }
        }
    }

    /**
     * غلاف عمل، يُحفظ على الجهاز ويُرجَع مساره.
     *
     * الغلاف كان `<img>` يطلب الرابط مباشرة من WebView: بلا `Referer` المصدر ولا
     * كوكي Cloudflare، فمصادر مثل AriaToon تردّ 403 ويظهر الحرف الأول مكان
     * الغلاف — ولا يظهر إلا بعد فتح العمل. هنا يُجلب بعميل المصدر وترويساته كما
     * يفعل Mihon، ويُكتب في `files/covers` لا الكاش: ما نزل مرة يبقى ظاهرًا بلا
     * شبكة، ولا يمسحه النظام عند ضيق الكاش.
     */
    @PluginMethod
    fun cover(call: PluginCall) {
        scope.launch {
            try {
                val url = call.getString("url")?.takeIf { it.startsWith("http") } ?: error("cover url is required")
                val hit = withContext(Dispatchers.IO) { coverHit(url) }
                if (hit != null) {
                    call.resolve(JSObject().put("path", hit.absolutePath).put("cached", true))
                    return@launch
                }
                val sourceId = call.getString("sourceId")
                val source = sourceId?.let { runCatching { obtain(it) }.getOrNull() } as? HttpSource
                val client = source?.client ?: network.client
                val sourceHeaders = runCatching { source?.headers }.getOrNull()
                // مصدر الغلاف غير مثبت أو رُفض الطلب: Referer من موقع الصورة قبل الاستسلام (CoverReferers)
                var lastError: Throwable? = null
                var fetched: Pair<ByteArray, String?>? = null
                // سقف واحد للغلاف كله (callTimeout يلغي الطلب الجاري فعلًا، لا يتركه في الخلفية)
                val deadline = System.currentTimeMillis() + CoverReferers.BUDGET_MS
                for (attempt in CoverReferers.attempts(url, sourceHeaders != null)) {
                    val left = deadline - System.currentTimeMillis()
                    if (left <= 0) break
                    val request = Request.Builder().url(url).apply {
                        when (attempt) {
                            CoverReferers.SOURCE_HEADERS -> sourceHeaders?.let { headers(it) }
                            CoverReferers.NO_REFERER -> Unit
                            else -> header("Referer", attempt)
                        }
                    }.build()
                    var status: Int? = null
                    val got = runCatching {
                        withContext(Dispatchers.IO) {
                            client.newCall(request).also { it.timeout().timeout(left, java.util.concurrent.TimeUnit.MILLISECONDS) }.execute().use { res ->
                                status = res.code
                                require(res.isSuccessful) { "cover HTTP ${res.code}" }
                                res.body.bytes() to res.header("content-type")
                            }
                        }
                    }.onFailure { lastError = it }.getOrNull()
                    fetched = got?.takeIf { it.first.size > 256 && ImagePayloadPolicy.validate(it.second, it.first).accepted }
                    if (fetched != null) break
                    if (!CoverReferers.worthNextAttempt(status, gotNonImage = got != null)) break
                }
                val (bytes, contentType) = fetched ?: throw (lastError ?: IllegalStateException("cover not an image"))
                require(bytes.size > 256) { "cover too small: ${bytes.size} bytes" }
                val verdict = ImagePayloadPolicy.validate(contentType, bytes)
                require(verdict.accepted) { "not an image: ${verdict.reason}" }
                val original = contentType?.substringBefore(';')?.trim()?.takeIf { it.startsWith("image/") } ?: typeForUrl(url)
                // غلاف بميغابايتين يُحفظ بحجم البطاقة: يُفكّ فورًا في كل فتحة بعدها
                val shrunk = withContext(Dispatchers.Default) { runCatching { CoverShrink.shrink(bytes) }.getOrNull() }
                val type = shrunk?.second ?: original
                val file = java.io.File(coverDir, "${digestOf(url)}.${extensionForType(type)}")
                withContext(Dispatchers.IO) {
                    // امتداد قديم لنفس الرابط لا يسبق الجديد في البحث
                    CACHE_EXTENSIONS.forEach { ext -> java.io.File(coverDir, "${digestOf(url)}.$ext").takeIf { it != file }?.delete() }
                    file.writeBytes(shrunk?.first ?: bytes)
                    pruneCovers()
                }
                call.resolve(JSObject().put("path", file.absolutePath).put("cached", false))
            } catch (t: Throwable) {
                fail(call, t)
            }
        }
    }

    private val coverDir by lazy {
        java.io.File(context.filesDir, "covers").apply { mkdirs() }
    }

    private fun coverHit(url: String): java.io.File? = hitIn(coverDir, url, 256)?.also {
        // «آخر استعمال» للتقليم: الغلاف الذي تراه كل يوم لا يُترك أولًا
        it.setLastModified(System.currentTimeMillis())
    }

    /** سقفٌ للأغلفة: ألفا غلاف تكفي مكتبة ثلاثة أصدقاء، والأقدم استعمالًا يُترك أولًا. */
    private var coverWrites = 0
    private fun pruneCovers() {
        // المسح مكلف: مرة كل خمسين غلافًا جديدًا تكفي
        if (++coverWrites % 50 != 1) return
        val files = coverDir.listFiles() ?: return
        if (files.size <= MAX_COVERS) return
        files.sortedBy { it.lastModified() }.take(files.size - MAX_COVERS + 200).forEach { it.delete() }
    }

    /** إفراغ كاش الصفحات. القارئ يناديه عند ضيق التخزين أو عند «امسح التنزيلات». */
    @PluginMethod
    fun clearImageCache(call: PluginCall) {
        scope.launch {
            val freed = withContext(Dispatchers.IO) {
                var n = 0L
                pageCacheDir.listFiles()?.forEach { n += it.length(); it.delete() }
                n
            }
            call.resolve(JSObject().put("freedBytes", freed))
        }
    }

    private fun heicToJpeg(heic: ByteArray): ByteArray {
        val bitmap = android.graphics.BitmapFactory.decodeByteArray(heic, 0, heic.size)
            ?: throw PageImageException("HEIC page image cannot be decoded on this Android version")
        return try {
            java.io.ByteArrayOutputStream().use { out ->
                bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 92, out)
                out.toByteArray()
            }
        } finally { bitmap.recycle() }
    }

    @Volatile private var pageWrites = 0
    private val pageCacheDir by lazy {
        java.io.File(context.cacheDir, "pages").apply { mkdirs() }
    }

    /**
     * اسم الملف من بصمة الرابط لا من مساره.
     *
     * مسارات الصفحات تتكرر بين الأعمال (`/01.jpg`)، والاسم المشتقّ من المسار
     * يجعل صفحةً تحلّ محلّ أخرى في الكاش فيرى القارئ صورة عملٍ آخر.
     *
     * والامتداد ليس زينة: خادم Capacitor المحلي يستنتج `Content-Type` من
     * امتداد الملف، وملفٌ بلا امتداد يُخدَم `application/octet-stream`
     * فيرفضه `<img>` — صورةٌ نُزّلت سليمة ولا تظهر، والعطل يُقرأ على المصدر.
     */
    private fun digestOf(url: String): String =
        java.security.MessageDigest.getInstance("SHA-256")
            .digest(url.toByteArray())
            .joinToString("") { "%02x".format(it) }

    private fun cacheFile(url: String, extension: String): java.io.File =
        java.io.File(pageCacheDir, "${digestOf(url)}.$extension")

    /**
     * الملف المحفوظ لهذا الرابط أيًّا كان امتداده.
     *
     * الامتداد يُقرَّر من نوع الاستجابة وقت التنزيل، فلا يُعرف وقت البحث في
     * الكاش. والبحث بالبادئة يجد الملف بلا أن نخمّن نوعه مرة ثانية.
     */
    private fun cacheHit(url: String): java.io.File? = hitIn(pageCacheDir, url, 64)

    /**
     * الملف المحفوظ لرابط، بفحص مباشر لا بمسح المجلد: مسحُ آلاف الملفات عند
     * كل صفحة وكل غلاف كان يأكل من وقت الفتح أكثر مما تأكله الشبكة.
     */
    private fun hitIn(dir: java.io.File, url: String, minBytes: Long): java.io.File? {
        val digest = digestOf(url)
        for (ext in CACHE_EXTENSIONS) {
            val f = java.io.File(dir, "$digest.$ext")
            if (f.isFile && f.length() > minBytes) return f
        }
        return null
    }

    private fun typeForUrl(url: String): String =
        typeForExtension(url.substringBefore('?').substringAfterLast('.', ""))

    private fun typeForExtension(extension: String): String = when (extension.lowercase()) {
        "png" -> "image/png"
        "webp" -> "image/webp"
        "gif" -> "image/gif"
        "avif" -> "image/avif"
        else -> "image/jpeg"
    }

    private fun extensionForType(type: String): String = when (type.lowercase()) {
        "image/png" -> "png"
        "image/webp" -> "webp"
        "image/gif" -> "gif"
        "image/avif" -> "avif"
        else -> "jpg"
    }

    // ───────────────────────────── الداخل ─────────────────────────────

    private fun paged(call: PluginCall, block: suspend (CatalogueSource, Int) -> MangasPage) {
        scope.launch {
            try {
                val source = obtain(requireSourceId(call))
                val page = call.getInt("page") ?: 1
                val result = block(source, page)
                val out = JSArray()
                result.mangas.forEach { out.put(it.toJs()) }
                call.resolve(
                    JSObject()
                        .put("mangas", out)
                        .put("hasNextPage", result.hasNextPage)
                        .put("page", page),
                )
            } catch (t: Throwable) {
                fail(call, t)
            }
        }
    }

    private fun requireSourceId(call: PluginCall): String =
        call.getString("sourceId") ?: error("sourceId is required")

    /**
     * المصدر من الذاكرة، أو يُحمَّل الآن.
     *
     * القفل يمنع نداءين متوازيين (القارئ يطلب الرائج والبحث معًا) من تنزيل
     * نفس الحزمة وفكّ الـDEX مرتين.
     */
    private suspend fun obtain(sourceId: String): CatalogueSource {
        // المحمَّل لا ينتظر أحدًا: قفلٌ واحد للكل كان يُوقف صور الفصل والأغلفة
        // خلف تحميل خمسة عشر مصدرًا آخر عند فتح التطبيق
        loaded[sourceId]?.let { return it }
        // القفل للحزمة لا للمعرّف: العربي والتكملة من حزمة واحدة يُفكّان مرة
        val lock = loadLocks.getOrPut(splitSourceId(sourceId.substringBefore('#')).first) { Mutex() }
        return lock.withLock {
            loaded[sourceId]?.let { return@withLock it }
            loadSlots.withPermit { load(sourceId) }
        }
    }

    /** مصادر الحزمة كلها بعد تحميلها مرة، لكل لغاتها. */
    private val packages = java.util.concurrent.ConcurrentHashMap<String, List<CatalogueSource>>()

    /** مصدرٌ لكل قفل، وأربعة تُفكّ معًا على الأكثر: توازٍ بلا خنق الجهاز. */
    private val loadLocks = java.util.concurrent.ConcurrentHashMap<String, Mutex>()
    private val loadSlots = kotlinx.coroutines.sync.Semaphore(4)

    private suspend fun load(sourceId: String): CatalogueSource {
        // مصدر من مستودع المستخدم: pkg#sourceId، والبصمة ثُبّتت عند تثبيته
        if ('#' in sourceId) {
            val userPkg = sourceId.substringBefore('#')
            val sid = sourceId.substringAfter('#')
            val ext = userStore.extension(userPkg)
            if (ext == null) {
                // قراءة الصيغتين (LegacySourceIds): pkg#id لحزمة مدمجة غير مثبّتة من مستودع يُحمَّل من المدمجة نفسها
                if (builtinClosed(userPkg)) error(NOT_INSTALLED)
                val base = packageSpec(userPkg) ?: error("unknown sourceId: $sourceId")
                val spec = builtinSpecs.current(base)
                spec.blockedReason?.let { error("${spec.label}: محظور بالسياسة — $it") }
                val all = packages[userPkg] ?: loadPackage(spec).also { packages[userPkg] = it }
                val source = all.firstOrNull { it.id.toString() == sid } ?: error("${spec.label}: المصدر غير موجود في الحزمة")
                loaded[sourceId] = source
                noteHost(source)
                return source
            }
            val all = packages[userPkg] ?: loadPackage(ext.spec()).also { packages[userPkg] = it }
            // المعرّف المحفوظ في المكتبة قد يكون قديمًا: يُتبع جدول الترحيل إلى المصدر الحالي
            val current = userStore.extension(userPkg) ?: ext
            val source = all.firstOrNull { it.id.toString() == sid }
                ?: all.firstOrNull { it.id.toString() == current.resolve(sid) }
                ?: error("${ext.name}: المصدر غير موجود في الحزمة")
            loaded[sourceId] = source
            noteHost(source)
            return source
        }
        val (pkg, lang) = splitSourceId(sourceId)
        // قراءة الصيغتين (LegacySourceIds): الحزمة مثبّتة من مستودع ⇒ المعرّف القديم يعني مصدرها نفسه في الإضافة المثبّتة
        userStore.extension(pkg)?.let { ext ->
            val all = packages[pkg] ?: loadPackage(ext.spec()).also { packages[pkg] = it }
            val sid = LegacySourceIds.sourceIdFor(sourceId, all.map { LegacySourceIds.Entry(it.id.toString(), it.lang) })
                ?: error("${ext.name}: لا مصدر يطابق $sourceId في الحزمة")
            val source = all.first { it.id.toString() == sid }
            loaded[sourceId] = source
            noteHost(source)
            return source
        }
        // رُحّلت ثم حُذفت: لا تعود مدمجة
        if (builtinClosed(pkg)) error(NOT_INSTALLED)
        // المواصفة المضمّنة، أو آخر إصدار رسمي نُزّل من مستودع Keiyoushi وتحقق توقيعه (معرّف المصدر نفسه)
        val spec = builtinSpecs.current(packageSpec(pkg) ?: error("unknown sourceId: $sourceId"))
        spec.blockedReason?.let { error("${spec.label}: محظور بالسياسة — $it") }
        val filler = if (lang == null) null else FILLER_SOURCES.firstOrNull { it.pkg == pkg && it.lang == lang } ?: error("unknown sourceId: $sourceId")
        // الإنجليزية المستقلة ليست مصدرًا عربيًا: لا تُطلب إلا بلغتها
        if (lang == null && SPIKE_SOURCES.none { it.pkg == pkg }) error("unknown sourceId: $sourceId")

        val all = packages[pkg] ?: loadPackage(spec).also { packages[pkg] = it }
        val source = if (lang == null) {
            // لا `first()`: أول مصدر في MangaDex قد يكون إنجليزيًا
            selectArabicSources(spec, all).firstOrNull()
                ?: error("${spec.label}: لا مصدر عربي في الحزمة (catalogue=${all.size})")
        } else {
            // المعرّف المثبّت أولًا: MangaFire يحمل عشر لغات، فلا نعتمد ترتيبها
            (filler?.sourceId?.let { id -> all.firstOrNull { it.id.toString() == id } } ?: all.firstOrNull { it.lang.equals(lang, ignoreCase = true) })
                ?: error("${spec.label}: لا مصدر بلغة $lang في الحزمة")
        }
        loaded[sourceId] = source
        noteHost(source)
        return source
    }

    /** DNS1: مضيف المصدر يأخذ DoH أولًا كمصادر الأنمي (HostRouting.isSourceHost). */
    private fun noteHost(source: CatalogueSource) {
        eu.kanade.tachiyomi.network.HostRouting.noteSourceHost(runCatching { (source as? HttpSource)?.baseUrl }.getOrNull())
    }

    /**
     * الحزمة من نسختها المحلية أولًا، مستقلة عن بقاء مستودعها (PERSISTENT_PLUGINS §3.1):
     *  1. الإصدار الحالي من مخزن الجهاز، أو من التطبيق إن طابقت بصمته، أو من رابطه المثبّت بالبصمة نفسها.
     *  2. آخر إصدار سليم قبله (LKG) من المخزن: إن تعطّل الحالي يُرجع إليه ويُحفظ الرجوع.
     *  3. للمدمجة سابقًا: النسخة المضمّنة في التطبيق (Stable فقط؛ Debug مفصول بلا نسخ مضمّنة)، ثم الإصدار
     *     الرسمي الحالي من Keiyoushi بمفتاحه المثبّت. في Debug تمر المدمجة بالمسار نفسه لأي إضافة: مخزن الجهاز
     *     ثم الشبكة الموثّقة، والتعافي (LKG، التحديث الذاتي) كما هو.
     * لا كود يُقبل في أي خطوة دون مطابقة بصمة أو توقيع: التعافي لا يفتح بابًا لكود بديل غير موثّق.
     * والإصدار الرسمي للمدمجة فقط: إضافة من مستودع المستخدم لا تُستبدل بنسخة مستودع آخر ولو بالاسم نفسه.
     */
    private suspend fun loadPackage(spec: dev.vantara.spike.SourceSpec): List<CatalogueSource> = withContext(Dispatchers.IO) {
        val user = userStore.extension(spec.pkg)
        val base = if (user == null) packageSpec(spec.pkg) else null
        val failures = mutableListOf<String>()
        fun attempt(s: dev.vantara.spike.SourceSpec, bytes: ByteArray?): List<CatalogueSource>? {
            bytes ?: return null
            return when (val result = loader.load(s, bytes)) {
                is FileExtensionLoader.Result.Fail -> { failures += "${result.stage} — ${result.reason}"; null }
                is FileExtensionLoader.Result.Ok -> result.loaded.sources.filterIsInstance<CatalogueSource>()
                    .ifEmpty { failures += "instantiate — no catalogue source"; null }
                    ?.also { claimIds(s.pkg, it) }
            }
        }

        // ١) الإصدار الحالي
        val active = loader.readVerifiedCache(spec)
            ?: base?.takeIf { it.sha256.equals(spec.sha256, ignoreCase = true) }?.let { readBundled(it) }
            ?: runCatching { download(spec) }.getOrNull()
        attempt(spec, active)?.let {
            // ما عدا الحالي وآخر سليم قبله يُنظَّف من المخزن، ومعه ملف ما قبل المخزن (<pkg>.apk) بعد نسخه
            loader.prune(spec.pkg, setOf(spec.sha256) + (user?.previous?.sha256?.let(::setOf) ?: builtinSpecs.keep(spec.pkg)))
            return@withContext it
        }

        // ٢) آخر إصدار سليم من مخزن الجهاز فقط
        val lkg = if (user != null) user.previousSpec() else base?.let { builtinSpecs.previousOf(it) }
        if (lkg != null) attempt(lkg, loader.readVerifiedCache(lkg))?.let {
            if (user != null) user.rolledBack()?.let { back -> userStore.update { st -> st.copy(extensions = st.extensions.map { e -> if (e.pkg == back.pkg) back else e }) } }
            else builtinSpecs.rollback(spec.pkg)
            return@withContext it
        }

        if (base != null) {
            // ٣) النسخة المضمّنة في التطبيق: المرجع الأخير الموثوق للمدمجة سابقًا
            if (!base.sha256.equals(spec.sha256, ignoreCase = true)) attempt(base, readBundled(base))?.let {
                builtinSpecs.reset(base.pkg)
                return@withContext it
            }
            // ٤) الإصدار الرسمي الحالي، يُثبَّت بعد نجاح تحميله فقط ويبقى ما قبله آخر سليم
            builtinSpecs.fromRepository(base, repoClient)?.let { (next, bytes) ->
                attempt(next, bytes)?.let {
                    // ما قبله تعطّل أو غاب، فلا يُحفظ «آخر سليم»: المضمّنة تبقى المرجع الضمني
                    builtinSpecs.reset(base.pkg)
                    builtinSpecs.confirm(next)
                    loader.prune(base.pkg, builtinSpecs.keep(base.pkg))
                    return@withContext it
                }
            }
        }
        throw IllegalStateException("${spec.label}: ${failures.lastOrNull() ?: "لا نسخة صالحة على الجهاز، والمستودع لا يوفّرها الآن"}")
    }

    /**
     * الإضافة المضمّنة في `assets/extensions/` (`tools/bundle-extensions.mjs`)، في بناء Stable وحده
     * (`src/release/assets`). Debug مفصول: لا نسخ مضمّنة فيُرجع null دائمًا، والسلسلة تكمل إلى الشبكة الموثّقة.
     * تُقبل فقط إن طابقت بصمتها المثبّتة: ملفٌّ قديم بقي من بناء سابق يُتجاهل
     * ويُنزَّل البديل، بدل أن يُحمَّل كود لم يُتحقق منه.
     */
    private fun readBundled(spec: SourceSpec): ByteArray? {
        val bytes = runCatching {
            context.assets.open("extensions/${spec.pkg}.apk").use { it.readBytes() }
        }.getOrNull() ?: return null
        val digest = java.security.MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { "%02x".format(it) }
        return bytes.takeIf { spec.sha256.equals(digest, ignoreCase = true) }
    }

    /** ثلاث محاولات: انقطاع لحظي عن github لا يجب أن يُسقط مصدرًا. */
    private fun download(spec: SourceSpec): ByteArray {
        var lastIo: IOException? = null
        repeat(3) { attempt ->
            try {
                return network.client
                    .newCall(Request.Builder().url(spec.apkUrl).build())
                    .execute().use { res ->
                        require(res.isSuccessful) { "HTTP ${res.code} ← ${spec.apkUrl}" }
                        res.body.bytes()
                    }
            } catch (io: IOException) {
                lastIo = io
                if (attempt < 2) Thread.sleep(800L * (attempt + 1))
            }
        }
        throw lastIo ?: IOException("download failed without an I/O cause")
    }

    // ── DTO: كل حقل يعبر الجسر ذهابًا وإيابًا، و`memo` منها ──

    private fun SManga.toJs(): JSObject = JSObject()
        .put("url", url)
        .put("title", title)
        .put("thumbnailUrl", thumbnail_url)
        .put("author", author)
        .put("artist", artist)
        .put("description", description)
        .put("genre", genre)
        .put("status", status)
        .put("initialized", initialized)
        .put("memo", json.encodeToString(JsonObject.serializer(), memo))

    private fun mangaFrom(js: JSObject?): SManga {
        val o = js ?: error("manga is required")
        return SManga.create().apply {
            url = o.getString("url") ?: error("manga.url is required")
            title = o.getString("title") ?: ""
            thumbnail_url = o.getString("thumbnailUrl")
            author = o.getString("author")
            artist = o.getString("artist")
            description = o.getString("description")
            genre = o.getString("genre")
            status = o.getInteger("status") ?: SManga.UNKNOWN
            memo = o.memo()
        }
    }

    private fun SChapter.toJs(): JSObject = JSObject()
        .put("url", url)
        .put("name", name)
        .put("dateUpload", date_upload)
        .put("chapterNumber", ChapterNumbers.forJs(chapter_number))
        .put("scanlator", scanlator)
        .put("memo", json.encodeToString(JsonObject.serializer(), memo))

    private fun chapterFrom(js: JSObject?): SChapter {
        val o = js ?: error("chapter is required")
        return SChapter.create().apply {
            url = o.getString("url") ?: error("chapter.url is required")
            name = o.getString("name") ?: ""
            // `optLong`/`optDouble` لا `getLong`/`getDouble`: الأخيران من
            // `JSONObject` يرميان حين يغيب المفتاح، وفصلٌ بلا تاريخ رفعٍ
            // حالةٌ عادية لا خطأ.
            date_upload = o.optLong("dateUpload", 0L)
            chapter_number = o.optDouble("chapterNumber", -1.0).toFloat()
            scanlator = o.getString("scanlator")
            memo = o.memo()
        }
    }

    private fun Page.toJs(): JSObject = JSObject()
        .put("index", index)
        .put("url", url)
        .put("imageUrl", imageUrl)

    private fun pageFrom(js: JSObject?): Page {
        val o = js ?: error("page is required")
        return Page(
            index = o.getInteger("index") ?: 0,
            url = o.getString("url") ?: "",
            imageUrl = o.getString("imageUrl"),
        )
    }

    /** `memo` غائبًا أو تالفًا يعود فارغًا، ولا يُسقط النداء. */
    private fun JSObject.memo(): JsonObject {
        val raw = getString("memo")
        if (raw.isNullOrBlank()) return JsonObject(emptyMap())
        return runCatching {
            json.decodeFromString(JsonObject.serializer(), raw)
        }.getOrDefault(JsonObject(emptyMap()))
    }

    /** `title` في `SMangaImpl` هو `lateinit`، وقراءته قبل الإسناد ترمي. */
    private fun SManga.isTitleSet(): Boolean = runCatching { title }.isSuccess

    /**
     * رفض النداء، مع تعافٍ تلقائي إن كان العطل من كود الإضافة نفسه لا من الموقع (PERSISTENT_PLUGINS §3.3/6).
     * عطل الموقع (HTTP، شبكة، تغيّر صفحاته) لا يُصلحه إصدار أقدم، فيُعرض سببه كما هو.
     */
    private fun fail(call: PluginCall, t: Throwable) {
        val healed = runCatching { recover(call.getString("sourceId"), t) }.getOrDefault(false)
        if (healed) return call.reject("تعطّل إصدار هذه الإضافة على جهازك فرجعنا تلقائيًا لآخر إصدار سليم؛ أعد المحاولة", "RECOVERED_TO_LKG", t as? Exception)
        // تحدّي Cloudflare يبقى برمزه القديم (اسم الصنف) ورسالته: source-pulse.js يعرف به «تحتاج تحقق»
        generateSequence(t) { it.cause }.take(4).firstOrNull { it.javaClass.simpleName == "CloudflareBypassException" }?.let {
            return call.reject(it.message ?: "الموقع يطلب تحققًا (حماية Cloudflare)", it.javaClass.name, it as? Exception)
        }
        val verdict = ExtensionFailure.classify(t)
        android.util.Log.w("ExtensionEngine", "${verdict.code}:${verdict.owner} <- ${t.readable()}")
        // عطل من كود الإضافة أو عدم توافقها: إصدار رسمي أحدث قد يصلحه (الموقع تغيّر والإضافة المثبّتة قديمة)
        if (verdict.owner == ExtensionFailure.Owner.EXTENSION || verdict.code == "ENGINE_INCOMPATIBLE") refreshBuiltin(call.getString("sourceId"))
        // EF1: إضافة من مستودع المستخدم والموقع تغيّر (صفحة اختفت، قراءة فشلت): فحص تحديث آمن فوري لها
        runCatching { checkUpdateAfterFailure(call.getString("sourceId"), verdict.code) }
        call.reject(verdict.message, verdict.code, t as? Exception, JSObject().put("owner", verdict.owner.name.lowercase()))
    }

    private val refreshTried = java.util.concurrent.ConcurrentHashMap<String, Long>()

    /**
     * تحديث ذاتي موثّق للمصادر المدمجة: كانت تبقى على الإصدار المثبّت ما دام يُحمَّل، ولو تغيّر الموقع وأصلحت
     * Keiyoushi إضافتها. عند عطل يملكه كود الإضافة يُطلب الإصدار الرسمي الحالي (المفتاح المثبّت، لا رجوع لأقدم)،
     * ويُثبَّت فقط بعد أن يُحمَّل ويُخرج مصادره؛ السابق يبقى آخر سليم. محاولة لكل حزمة كل 6 ساعات، في الخلفية.
     */
    private fun refreshBuiltin(sourceId: String?) {
        if (sourceId.isNullOrBlank()) return
        val pkg = if ('#' in sourceId) sourceId.substringBefore('#') else splitSourceId(sourceId).first
        val base = packageSpec(pkg) ?: return
        if (userStore.extension(pkg) != null) return
        val now = System.currentTimeMillis()
        if (refreshTried[pkg]?.let { now - it < 6 * 3_600_000L } == true) return
        refreshTried[pkg] = now
        scope.launch(Dispatchers.IO) { updateBuiltin(base) }
    }

    /**
     * يثبّت الإصدار الرسمي الأحدث لحزمة مدمجة إن نُشر: المفتاح المثبّت، لا رجوع لأقدم، ويُعتمد بعد أن يُحمَّل
     * ويُخرج مصادره فقط؛ السابق يبقى آخر سليم. فحص الموقع الحي: Dilar المثبّت 1.6.14 يفشل في الصفحات
     * (بروتوكول الموقع 17) والرسمي 1.6.20 يقرأها.
     */
    private fun updateBuiltin(base: SourceSpec, index: Pair<RepoIndex.Meta, List<RepoIndex.Extension>>? = null): Boolean {
        val pkg = base.pkg
        val current = builtinSpecs.current(base)
        val (next, bytes) = builtinSpecs.fromRepository(base, repoClient, index, onlyIfNewer = true) ?: return false
        if (next.sha256.equals(current.sha256, ignoreCase = true)) return false
        val sources = (loader.load(next, bytes) as? FileExtensionLoader.Result.Ok)?.loaded?.sources?.filterIsInstance<CatalogueSource>()
        if (sources.isNullOrEmpty()) return false
        runCatching { claimIds(pkg, sources) }.getOrElse { return false }
        builtinSpecs.confirm(next)
        forget(pkg)
        loader.prune(pkg, builtinSpecs.keep(pkg))
        android.util.Log.i("ExtensionEngine", "BUILTIN_UPDATED:$pkg ${current.versionName} -> ${next.versionName}")
        return true
    }

    /**
     * التحقق اليومي من إصدارات المدمجة كما يفعل Mihon لإضافاته: الفهرس يُقرأ مرة، ولا يُنزَّل إلا ما تغيّر
     * إصداره، ولما أضافه الحساب (أو له نسخة على الجهاز) فقط. بعد دقيقة من الإقلاع، مرة كل 24 ساعة.
     */
    private suspend fun refreshBuiltinsDaily(eager: (String) -> Boolean) {
        val stamp = java.io.File(context.filesDir, "extensions/builtin-refresh-at")
        val last = runCatching { stamp.readText().trim().toLong() }.getOrDefault(0L)
        if (System.currentTimeMillis() - last < 24 * 3_600_000L) return
        kotlinx.coroutines.delay(60_000)
        val index = runCatching { repoClient.read(BuiltinSourceRefresh.KEIYOUSHI_BASE) }.getOrNull() ?: return
        for (base in SPIKE_SOURCES + FILLER_PACKAGES) {
            if (base.blockedReason != null || !eager(base.pkg) || userStore.extension(base.pkg) != null || builtinClosed(base.pkg)) continue
            runCatching { updateBuiltin(base, index) }
        }
        runCatching { stamp.parentFile?.mkdirs(); stamp.writeText(System.currentTimeMillis().toString()) }
    }

    /**
     * عدم توافق إصدار الإضافة مع التطبيق (صنف أو دالة مفقودة، نوع غير متوقع) يظهر عند أول نداء لا عند
     * التحميل. يُرجع إلى آخر إصدار سليم إن وُجد، أو إلى النسخة المضمّنة للمدمجة سابقًا، ويُخرج الحزمة من
     * الذاكرة لتُحمَّل من جديد. لا يُنزّل شيئًا ولا يقبل كودًا جديدًا.
     */
    private fun recover(sourceId: String?, t: Throwable): Boolean {
        val defect = generateSequence(t) { it.cause }.take(4).any { it is LinkageError || it is ClassCastException || it is AbstractMethodError }
        if (!defect || sourceId.isNullOrBlank()) return false
        val pkg = if ('#' in sourceId) sourceId.substringBefore('#') else splitSourceId(sourceId).first
        val user = userStore.extension(pkg)
        val healed = if (user != null) {
            val back = user.rolledBack() ?: return false
            userStore.update { st -> st.copy(extensions = st.extensions.map { if (it.pkg == pkg) back else it }) }
            true
        } else {
            val base = packageSpec(pkg) ?: return false
            when {
                builtinSpecs.previousOf(base) != null -> { builtinSpecs.rollback(pkg); true }
                builtinSpecs.current(base) !== base -> { builtinSpecs.reset(pkg); true }
                else -> false
            }
        }
        if (healed) {
            forget(pkg)
            owners.values.removeAll { it == pkg }
        }
        return healed
    }

    private fun Throwable.readable(): String =
        generateSequence(this) { it.cause }
            .take(3)
            .joinToString(" <- ") { "${it.javaClass.simpleName}: ${it.message?.take(160) ?: "—"}" }

    private companion object {
        const val MAX_COVERS = 2000
        /** مصدر حزمة رُحّلت ثم حُذفت: الواجهة تقول «ثبّته» لا خطأ مصدر. */
        const val NOT_INSTALLED = "هذا المصدر غير مثبّت؛ ثبّته من صفحة الإضافات"
        val CACHE_EXTENSIONS = listOf("jpg", "webp", "png", "gif", "avif")
    }
}

private val INJEKT_LOCK = Any()

@Volatile
private var injektReady = false

/**
 * تسجيل ما تطلبه الإضافات من injekt، مرة واحدة للعملية. يناديه محرك المانجا
 * ومحرك الأنمي كلاهما، وأيهما سبق سجّل: تسجيلٌ ثانٍ لنفس المفرد يرمي.
 */
fun ensureEngineInjekt(app: Application) {
    synchronized(INJEKT_LOCK) {
        if (!injektReady) {
            Injekt.importModule(EngineModule(app))
            injektReady = true
        }
    }
}

/**
 * ما تطلبه الإضافات من المستضيف عبر injekt.
 *
 * `NetworkHelper` هو الأهم: الإضافة تأخذ منه `client` فيمرّ كل طلبها
 * باعتراضاتنا — ومنها اعتراض Cloudflare الذي يحلّ التحدّي بـWebView الجهاز.
 * و`Application` جزء من العقد لا التفاف: Keiyoushi core نفسه يطلبه عبر
 * Injekt (مثل `getBaseUrl` للمرايا)، وMangalek أثبت ذلك على الجهاز.
 */
private class EngineModule(private val app: Application) : InjektModule {
    override fun InjektRegistrar.registerInjectables() {
        addSingleton<Application>(app)
        addSingletonFactory { NetworkHelper(app) }
        registerExtensionFormats()
    }
}

/**
 * The serialization formats Mihon/Aniyomi's AppModule hands to extensions. Extensions that speak protobuf APIs take
 * ProtoBuf from Injekt in a static initializer; without it that class fails once and every later use is
 * NoClassDefFoundError (Manga Million, Keiyoushi 1.6.3, source certification rounds 11–13).
 */
internal fun InjektRegistrar.registerExtensionFormats() {
    addSingletonFactory {
        Json {
            ignoreUnknownKeys = true
            explicitNulls = false
        }
    }
    addSingletonFactory<kotlinx.serialization.protobuf.ProtoBuf> { kotlinx.serialization.protobuf.ProtoBuf }
}
