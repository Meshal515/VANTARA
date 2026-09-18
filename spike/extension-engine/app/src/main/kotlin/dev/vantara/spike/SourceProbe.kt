package dev.vantara.spike

import eu.kanade.tachiyomi.source.CatalogueSource
import eu.kanade.tachiyomi.source.model.FilterList
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import eu.kanade.tachiyomi.source.online.HttpSource
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * السلسلة الخمس لمصدر واحد، ثم قياس الكتالوج.
 *
 * كل خطوة تُسجَّل باسمها ووقتها ودليلها. **ولا تُصنَّف تلقائيًّا.**
 *
 * وهذا تصحيح مقصود لمنهج أسبق كان يقول: `NoClassDefFoundError` يعني
 * محرّكًا، و`IOException` يعني مصدرًا، وأن موقعًا يرجع 200 لـ`curl` يجعل
 * سقوط البحث عطلَ محرّك. وثلاثتها أقوى من الدليل:
 *
 *  - **200 يثبت أن الموقع حيّ، لا أن عقده لم يتغيّر.** الموقع قد يخدم
 *    صفحة سليمة بترميز HTML جديد يكسر selectors الإضافة، فيسقط التحليل
 *    والموقع بريء والمحرك بريء — والمتغيّر هو الموقع.
 *  - **`IOException` قد يكون من عندنا**: اعتراض مُعدٌّ خطأً، أو `cookieJar`
 *    ناقص، أو ترويسة مفقودة. الاستثناء يقول «فشل نقل»، لا «الموقع مذنب».
 *  - **و`NoClassDefFoundError` قرينة قوية على المحرك، لا برهان**: قد يكون
 *    من صنفٍ اختياري تطلبه الإضافة ولا نوفّره، وهو نقص مستضيف بحقّ — لكن
 *    اسم الصنف هو ما يفصل، لا نوع الاستثناء.
 *
 * فالمسبار يجمع الدليل: نوع الاستثناء واسمه، **وفحصًا حيًّا للموقع في نفس
 * اللحظة** لا خطَّ أساسٍ من الأمس. ثم يعرض **فرضية موسومة كفرضية**،
 * والتصنيف يبقى لقارئ التقرير.
 */
class SourceProbe(private val http: OkHttpClient) {

    data class Step(
        val name: String,
        val ok: Boolean,
        val detail: String,
        val millis: Long,
        /** نوع الاستثناء واسمه عند الفشل. فارغ عند النجاح. */
        val exceptionType: String? = null,
        /**
         * فحص مستقل للموقع **لحظةَ الفشل**.
         *
         * هذا هو الفرق بين دليل وحكم: خطّ أساسٍ قديم لا يقول شيئًا عن
         * الآن، وموقعٌ كان حيًّا أمس قد يكون ساقطًا أو متغيّرًا اليوم.
         */
        val live: LiveCheck? = null,
        /** فرضية موسومة، لا حكم. */
        val hypothesis: String? = null,
    )

    /** ما رآه طلبٌ خامّ للموقع في نفس اللحظة، بلا الإضافة. */
    data class LiveCheck(
        val url: String,
        val status: Int?,
        val bytes: Int?,
        val contentType: String?,
        val error: String?,
    ) {
        fun describe(): String = when {
            error != null -> "الموقع: تعذّر الوصول ($error)"
            else -> "الموقع: HTTP $status · ${bytes ?: 0} بايت · ${contentType ?: "?"}"
        }
    }

    data class CatalogueReach(
        /** عدد الأعمال الفريدة التي كُشفت فعلًا. */
        val uniqueWorks: Int,
        /** كم صفحة طُلبت. */
        val pagesFetched: Int,
        /** هل بلغنا النهاية فعلًا، أو توقفنا عند السقف؟ */
        val reachedEnd: Boolean,
        val stoppedBecause: String,
    )

    data class Report(
        val label: String,
        val steps: List<Step>,
        /** رابط صورة صفحة حقيقية، تُعرض في الشاشة لا تُوصف. */
        val imageUrl: String?,
        val imageBytes: Int?,
        val reach: CatalogueReach?,
    ) {
        val passed: Boolean get() = steps.all { it.ok } && (imageBytes ?: 0) > 0
        val failedAt: String? get() = steps.firstOrNull { !it.ok }?.name
    }

    private suspend fun <T> step(
        name: String,
        into: MutableList<Step>,
        baseUrl: String?,
        block: suspend () -> T,
    ): T? {
        val started = System.currentTimeMillis()
        return try {
            val value = block()
            into += Step(name, true, describe(value), System.currentTimeMillis() - started)
            value
        } catch (t: Throwable) {
            val kind = t.javaClass.name
            val msg = t.message?.take(300) ?: "(no message)"
            // الدليل يُجمع **الآن**: الموقع لحظةَ الفشل، لا أمس
            val live = baseUrl?.let { liveCheck(it) }
            into += Step(
                name = name,
                ok = false,
                detail = "$kind: $msg",
                millis = System.currentTimeMillis() - started,
                exceptionType = kind,
                live = live,
                hypothesis = hypothesise(t, live),
            )
            null
        }
    }

    /**
     * طلب خامّ للموقع، بلا الإضافة وبلا عميلها.
     *
     * غرضه واحد: هل الموقع نفسه يردّ الآن؟ ولا يقول أكثر من ذلك — وتحديدًا
     * **لا يقول** إن عقد الصفحة لم يتغيّر.
     */
    private fun liveCheck(baseUrl: String): LiveCheck = try {
        val request = Request.Builder().url(baseUrl)
            .header("user-agent", RAW_UA)
            .build()
        http.newCall(request).execute().use { res ->
            val body = res.body.bytes()
            LiveCheck(baseUrl, res.code, body.size, res.header("content-type"), null)
        }
    } catch (t: Throwable) {
        LiveCheck(baseUrl, null, null, null, "${t.javaClass.simpleName}: ${t.message?.take(120)}")
    }

    /**
     * فرضية، وتُقرأ كفرضية.
     *
     * لا تُستعمل للحكم ولا تُغلق التشخيص؛ تقول للقارئ من أين يبدأ. وكل
     * فرضية تحمل سببها، فمن يخالفها يخالف سببًا لا نبرة.
     */
    private fun hypothesise(t: Throwable, live: LiveCheck?): String {
        val name = t.javaClass.name
        val missing = (t as? NoClassDefFoundError)?.message?.take(120)

        return when {
            // صنف مفقود يسمّي نفسه: القرينة هنا في **الاسم** لا في النوع
            t is NoClassDefFoundError || t is ClassNotFoundException ->
                "فرضية: نقصٌ في سطح المستضيف — الصنف الغائب «$missing». " +
                    "تُحقَّق بالبحث عنه في `eu/kanade/tachiyomi/` وفي الاعتماديات."
            t is LinkageError ->
                "فرضية: تعارض إصدارات في اعتمادية (OkHttp/serialization). " +
                    "تُحقَّق من `resolutionStrategy` ومن شجرة الاعتماديات."
            live?.error != null ->
                "فرضية: الموقع لا يردّ الآن. تُحقَّق بإعادة المحاولة لاحقًا، " +
                    "ولا تُنسب إلى المحرك قبل ذلك."
            live != null && live.status !in 200..299 ->
                "فرضية: الموقع ردّ HTTP ${live.status}. قد يكون حجبًا أو " +
                    "تغييرَ مسار — ولا يزال محتملًا أن ترويسةً عندنا هي السبب."
            live != null ->
                "فرضية **غير محسومة**: الموقع يردّ ${live.status} الآن، فالعطل " +
                    "إمّا تغيّرُ عقدِ الصفحة (selectors) أو إعدادٌ في محرّكنا " +
                    "(ترويسة، كوكي، اعتراض). الدليل لا يفصل بينهما، " +
                    "ويُفصل بمقارنة صفحة الموقع بما تتوقّعه الإضافة."
            else ->
                "فرضية: غير محسومة — لا فحص حيّ متاح لهذه الخطوة."
        }
    }

    private fun describe(value: Any?): String = when (value) {
        null -> "null"
        is Collection<*> -> "${value.size} عنصرًا"
        is SManga -> value.title.take(60)
        is SChapter -> value.name.take(60)
        else -> value.toString().take(80)
    }

    suspend fun run(label: String, source: CatalogueSource): Report {
        val steps = mutableListOf<Step>()
        // `baseUrl` من المصدر نفسه لا من بياننا: الإضافة قد تكون هاجرت إلى
        // مرآة أخرى (`baseUrl { mirrors(...) }`)، فالفحص الحيّ يجب أن يضرب
        // ما تضربه الإضافة فعلًا.
        // بعض الإضافات تحسب baseUrl عبر تفضيلات/اعتماديات عند أول وصول.
        // فشل getter نفسه لا يجوز أن يهرب خارج المسبار ويسقط التطبيق.
        val base = runCatching { (source as? HttpSource)?.baseUrl }.getOrNull()

        // ١) البحث
        val found = step("search", steps, base) {
            val page = source.getSearchManga(1, queryFor(label), FilterList())
            require(page.mangas.isNotEmpty()) { "search returned zero results" }
            page.mangas
        }

        // بلا نتيجة بحث لا معنى لبقية السلسلة: نتوقف ونقول أين
        val first = found?.firstOrNull()
            ?: return Report(label, steps, null, null, null)

        // ٢) تفاصيل العمل
        val details = step("details", steps, base) {
            // الوسيط الثاني هو الفصول **المعروفة سلفًا**، وهي فارغة في أول
            // استعلام. حذفُه كان خطأً عندي لا في العقد.
            source.getMangaUpdate(
                manga = first,
                chapters = emptyList(),
                fetchDetails = true,
                fetchChapters = false,
            ).manga
        } ?: first

        // ٣) الفصول
        val chapters = step("chapters", steps, base) {
            val list = source.getMangaUpdate(
                manga = details,
                chapters = emptyList(),
                fetchDetails = false,
                fetchChapters = true,
            ).chapters
            require(list.isNotEmpty()) { "chapter list is empty" }
            list
        }

        val chapter = chapters?.firstOrNull()
        if (chapter == null) return Report(label, steps, null, null, null)

        // ٤) الصفحات
        val pages = step("pages", steps, base) {
            val list = source.getPageList(chapter)
            require(list.isNotEmpty()) { "page list is empty" }
            list
        }

        // ٥) صورة فعلية — بايتات حقيقية لا رابط فقط
        var imageUrl: String? = null
        var imageBytes: Int? = null
        val page = pages?.firstOrNull()
        if (page != null) {
            step("image", steps, base) {
                val asHttp = source as? HttpSource
                // المصدر قد يعطي الرابط في الصفحة، أو يشتقه بطلب ثانٍ
                val url = page.imageUrl
                    ?: asHttp?.let { runCatching { it.getImageUrl(page) }.getOrNull() }
                    ?: error("page carries no imageUrl")
                imageUrl = url
                // `imageRequest` محمية في العقد، فنبني الطلب بترويسات المصدر
                // نفسها: كثير من المواقع يرفض بلا `Referer` الصحيح.
                val request = Request.Builder().url(url)
                    .apply { asHttp?.headers?.let { headers(it) } }
                    .build()
                val caller = asHttp?.client ?: http
                caller.newCall(request).execute().use { response ->
                    require(response.isSuccessful) { "image HTTP ${response.code}" }
                    val body = response.body.bytes()
                    require(body.size > 1024) { "image too small: ${body.size} bytes" }
                    imageBytes = body.size
                    "${body.size} بايت · ${response.header("content-type")}"
                }
            }
        }

        // ٦) قياس الكتالوج — لا يُحسب إلا إذا مرّت السلسلة
        val reach = if (steps.all { it.ok }) measureCatalogue(source) else null
        return Report(label, steps, imageUrl, imageBytes, reach)
    }

    /**
     * كم عملًا يستطيع هذا المصدر كشفه فعلًا؟
     *
     * لا نكتفي بـ`hasNextPage`: مصادر تقول `true` إلى الأبد، ومصادر تعيد
     * نفس الصفحة. فالتوقف على ثلاث علامات، وكلٌّ منها يُسجَّل بالاسم:
     *
     *  - `end-of-catalogue`  — الخادم قال لا مزيد، **وهذا وحده إثبات النهاية**
     *  - `repeat`            — الصفحة الجديدة لم تُضف عملًا واحدًا: حلقة
     *  - `page-cap`          — بلغنا سقفنا، فلم نُثبت النهاية ونقولها صريحة
     */
    private suspend fun measureCatalogue(source: CatalogueSource): CatalogueReach {
        val seen = LinkedHashSet<String>()
        var page = 1
        var stoppedBecause = "page-cap"
        var reachedEnd = false

        while (page <= PAGE_CAP) {
            val result = try {
                source.getPopularManga(page)
            } catch (t: Throwable) {
                stoppedBecause = "error: ${t.javaClass.simpleName}"
                break
            }
            val before = seen.size
            result.mangas.forEach { seen += it.url }
            val added = seen.size - before

            if (added == 0) {
                stoppedBecause = "repeat"
                break
            }
            if (!result.hasNextPage) {
                stoppedBecause = "end-of-catalogue"
                reachedEnd = true
                page += 1
                break
            }
            page += 1
        }

        return CatalogueReach(
            uniqueWorks = seen.size,
            pagesFetched = page - 1,
            reachedEnd = reachedEnd,
            stoppedBecause = stoppedBecause,
        )
    }

    private fun queryFor(label: String): String =
        SPIKE_SOURCES.firstOrNull { it.label == label }?.query ?: "مانجا"

    private companion object {
        /** ترويسة الفحص الخامّ: نفس ما استُعمل في خطّ الأساس، فالمقارنة عادلة. */
        const val RAW_UA =
            "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/120 Mobile Safari/537.36"

        /**
         * سقف الصفحات.
         *
         * مصدر بلا نهاية يستنزف البطارية والبيانات ولا يُثبت شيئًا. والسقف
         * يُعلن في التقرير، فلا يُقرأ رقمٌ ناقص كأنه نهاية الكتالوج.
         */
        const val PAGE_CAP = 40
    }
}
