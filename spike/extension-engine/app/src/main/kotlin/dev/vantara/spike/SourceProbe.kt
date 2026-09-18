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
 * كل خطوة تُسجَّل وحدها بنتيجتها ووقتها. فحين يسقط مصدر، نعرف **أين** سقط
 * بلا تخمين — وهذا هو الفرق بين «المصدر خربان» و«المحرك خربان».
 *
 * وخطّ الأساس محسوم قبل أي تشغيل: المصادر الخمسة كلها أعطت HTTP 200 بمحتوى
 * عربي حقيقي لـ`curl` وحده بلا كوكي ولا WebView في 2026‑09‑18. فسقوطٌ في
 * `search` **ليس** عطل مصدر — هو عطل محرك حتى يُثبت العكس.
 */
class SourceProbe(private val http: OkHttpClient) {

    data class Step(
        val name: String,
        val ok: Boolean,
        val detail: String,
        val millis: Long,
    )

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

    private inline fun <T> step(
        name: String,
        into: MutableList<Step>,
        block: () -> T,
    ): T? {
        val started = System.currentTimeMillis()
        return try {
            val value = block()
            into += Step(name, true, describe(value), System.currentTimeMillis() - started)
            value
        } catch (t: Throwable) {
            // الرسالة وحدها لا تكفي للتشخيص: نوع الاستثناء هو ما يفرّق
            // NoClassDefFoundError (المحرك) عن IOException (المصدر).
            val kind = t.javaClass.simpleName
            val msg = t.message?.take(300) ?: "(no message)"
            into += Step(name, false, "$kind: $msg", System.currentTimeMillis() - started)
            null
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

        // ١) البحث
        val found = step("search", steps) {
            val page = source.getSearchManga(1, queryFor(label), FilterList())
            require(page.mangas.isNotEmpty()) { "search returned zero results" }
            page.mangas
        }

        // بلا نتيجة بحث لا معنى لبقية السلسلة: نتوقف ونقول أين
        val first = found?.firstOrNull()
            ?: return Report(label, steps, null, null, null)

        // ٢) تفاصيل العمل
        val details = step("details", steps) {
            source.getMangaUpdate(first, fetchDetails = true, fetchChapters = false).manga
        } ?: first

        // ٣) الفصول
        val chapters = step("chapters", steps) {
            val list = source.getMangaUpdate(details, fetchDetails = false, fetchChapters = true)
                .chapters
            require(list.isNotEmpty()) { "chapter list is empty" }
            list
        }

        val chapter = chapters?.firstOrNull()
        if (chapter == null) return Report(label, steps, null, null, null)

        // ٤) الصفحات
        val pages = step("pages", steps) {
            val list = source.getPageList(chapter)
            require(list.isNotEmpty()) { "page list is empty" }
            list
        }

        // ٥) صورة فعلية — بايتات حقيقية لا رابط فقط
        var imageUrl: String? = null
        var imageBytes: Int? = null
        val page = pages?.firstOrNull()
        if (page != null) {
            step("image", steps) {
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
        /**
         * سقف الصفحات.
         *
         * مصدر بلا نهاية يستنزف البطارية والبيانات ولا يُثبت شيئًا. والسقف
         * يُعلن في التقرير، فلا يُقرأ رقمٌ ناقص كأنه نهاية الكتالوج.
         */
        const val PAGE_CAP = 40
    }
}
