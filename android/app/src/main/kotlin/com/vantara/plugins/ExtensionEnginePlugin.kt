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
    private val loadLock = Mutex()

    private val network by lazy { Injekt.get<NetworkHelper>() }
    private val loader by lazy { FileExtensionLoader(context) }
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    override fun load() {
        // حلّ تحدّي Cloudflare يفتح WebView، وWebView يحتاج Activity حيًّا.
        // بلا هذا السطر يسقط الاعتراض عند أول 403 ويبدو كأن المصدر محجوب.
        WebViewActivityHolder.set(activity)
        // المحرّك مشترك مع الـspike، والـspike يفشل سريعًا أمام تحدّي Cloudflare
        // كي لا تُسرق شاشة الدفعة. القارئ هنا يقلّب بيده: التحدّي المرئي هو
        // الطريق الوحيد، وإلا قرأ «محجوب» ما كان يكفيه أن يحلّه
        CloudflareInteractionMode.batchProbe = false
        // الإضافات تطلب اعتمادياتها بـ`injectLazy()`. التسجيل قبل أول تحميل،
        // وإلا سقط أول مصدر بـIllegalStateException من injekt فيبدو عطل مصدر.
        //
        // ومرة واحدة للعملية لا لكل نسخة من الإضافة: تدوير الشاشة يبني
        // Activity جديدة فتُحمَّل الإضافة من جديد، وتسجيلٌ ثانٍ لنفس المفرد
        // في injekt يرمي — فيسقط التطبيق عند أول تدوير لا عند أول استعمال.
        synchronized(INJEKT_LOCK) {
            if (!injektReady) {
                Injekt.importModule(EngineModule(context.applicationContext as Application))
                injektReady = true
            }
        }
    }

    override fun handleOnDestroy() {
        WebViewActivityHolder.set(null)
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
        val list = JSArray()
        for (spec in SPIKE_SOURCES) {
            if (spec.blockedReason != null) continue
            list.put(
                JSObject()
                    .put("id", spec.pkg)
                    .put("label", spec.label)
                    .put("lib", spec.expectedLib)
                    .put("version", spec.versionName)
                    .put("warning", spec.warning.name)
                    .put("names", JSArray(spec.arabicSourceNames))
                    .put("ready", loaded.containsKey(spec.pkg)),
            )
        }
        call.resolve(JSObject().put("sources", list))
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
                call.reject(t.readable(), t.javaClass.name, t as? Exception)
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
        source.getSearchManga(page, query, FilterList())
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
                call.reject(t.readable(), t.javaClass.name, t as? Exception)
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
                call.reject(t.readable(), t.javaClass.name, t as? Exception)
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
                call.reject(t.readable(), t.javaClass.name, t as? Exception)
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
                val source = obtain(requireSourceId(call))
                val asHttp = source as? HttpSource
                val page = pageFrom(call.getObject("page"))
                val url = page.imageUrl
                    ?: asHttp?.let { runCatching { it.getImageUrl(page) }.getOrNull() }
                    ?: error("page carries no imageUrl")

                val hit = withContext(Dispatchers.IO) { cacheHit(url) }
                val file: java.io.File
                val bytes: ByteArray
                val type: String

                if (hit != null) {
                    file = hit
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
                                res.body.bytes() to res.header("content-type")
                            }
                        } else {
                            network.client.newCall(Request.Builder().url(url).build()).execute().use { res ->
                                require(res.isSuccessful) { "image HTTP ${res.code} ← $url" }
                                res.body.bytes() to res.header("content-type")
                            }
                        }
                    }
                    bytes = fetched.first
                    // حاجزٌ يفصل صورةً عن صفحة حجبٍ تُردّ بـ200: الحجم وحده لا
                    // يكفي، فصفحة HTML كبيرة تمرّ منه. التوقيع يُفحص قبل الكاش
                    require(bytes.size > 1024) { "image too small: ${bytes.size} bytes" }
                    val verdict = ImagePayloadPolicy.validate(fetched.second, bytes)
                    require(verdict.accepted) { "not an image: ${verdict.reason}" }
                    // النوع من الاستجابة أولًا، فإن سكتت فمن امتداد الرابط
                    type = fetched.second?.substringBefore(';')?.trim()?.takeIf {
                        it.startsWith("image/")
                    } ?: typeForUrl(url)
                    file = cacheFile(url, extensionForType(type))
                    withContext(Dispatchers.IO) { file.writeBytes(bytes) }
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
                call.reject(t.readable(), t.javaClass.name, t as? Exception)
            }
        }
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
    private fun cacheHit(url: String): java.io.File? {
        val prefix = digestOf(url) + "."
        return pageCacheDir
            .listFiles { f -> f.name.startsWith(prefix) }
            ?.firstOrNull { it.isFile && it.length() > 1024 }
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
                call.reject(t.readable(), t.javaClass.name, t as? Exception)
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
    private suspend fun obtain(sourceId: String): CatalogueSource = loadLock.withLock {
        loaded[sourceId]?.let { return@withLock it }

        val spec = SPIKE_SOURCES.firstOrNull { it.pkg == sourceId }
            ?: error("unknown sourceId: $sourceId")
        spec.blockedReason?.let { error("${spec.label}: محظور بالسياسة — $it") }

        // الترتيب: نسخة الجهاز المتحقَّق منها، ثم المضمّنة في التطبيق، ثم التنزيل.
        // keiyoushi يحذف إصداراته القديمة، فالتنزيل وحده أسقط كل المصادر مرة
        val apk = withContext(Dispatchers.IO) { loader.readVerifiedCache(spec) }
            ?: withContext(Dispatchers.IO) { readBundled(spec) }
            ?: withContext(Dispatchers.IO) { download(spec) }

        when (val result = withContext(Dispatchers.IO) { loader.load(spec, apk) }) {
            is FileExtensionLoader.Result.Fail ->
                throw IllegalStateException(
                    "${spec.label}: ${result.stage} — ${result.reason}",
                    result.cause,
                )
            is FileExtensionLoader.Result.Ok -> {
                // لا `first()`: أول مصدر في MangaDex قد يكون إنجليزيًا
                val all = result.loaded.sources.filterIsInstance<CatalogueSource>()
                val source = selectArabicSources(spec, all).firstOrNull()
                    ?: error("${spec.label}: لا مصدر عربي في الحزمة (catalogue=${all.size})")
                loaded[sourceId] = source
                source
            }
        }
    }

    /**
     * الإضافة المضمّنة في `assets/extensions/` (`tools/bundle-extensions.mjs`).
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
        .put("chapterNumber", chapter_number.toDouble())
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

    private fun Throwable.readable(): String =
        generateSequence(this) { it.cause }
            .take(3)
            .joinToString(" <- ") { "${it.javaClass.simpleName}: ${it.message?.take(160) ?: "—"}" }

    private companion object {
        val INJEKT_LOCK = Any()

        @Volatile
        var injektReady = false
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
        addSingletonFactory {
            Json {
                ignoreUnknownKeys = true
                explicitNulls = false
            }
        }
    }
}
