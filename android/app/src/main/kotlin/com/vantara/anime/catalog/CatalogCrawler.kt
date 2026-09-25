package com.vantara.anime.catalog

import com.vantara.anime.adapters.SourceAnime
import com.vantara.anime.adapters.SourcePage
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.io.IOException
import kotlin.coroutines.coroutineContext

/**
 * حلب الكتالوج كاملًا لمصدر واحد: صفحة بعد صفحة حتى يقول المصدر نفسه لا
 * يوجد المزيد — لا «الرائج» ولا الصفحة الأولى.
 *
 * يتوقف عند أول واحد من:
 *   - `hasNext=false` من المصدر؛
 *   - صفحة فارغة، أو صفحة كل عناصرها رأيناها (مواقع تعيد آخر صفحة لكل رقم
 *     أكبر منها — بدون هذا يدور الحلب للأبد)؛
 *   - [CatalogCursor.maxPages] سقف أمان.
 *
 * ونقطة الاستئناف تُكتب بعد كل صفحة: إغلاق التطبيق في الصفحة 700 يكمل من 701.
 * الخطأ العابر (مهلة، 5xx، 429) يُعاد بتراجع؛ الخطأ الدائم يوقف الجولة ويحفظ
 * موضعها لجولة لاحقة بدل أن يُعلن الكتالوج «كاملًا» وهو نصف.
 */
@Serializable
data class CatalogCursor(
    val sourceId: String,
    val nextPage: Int = 1,
    val count: Int = 0,
    val done: Boolean = false,
    val pagesFetched: Int = 0,
    val startedAt: Long = 0,
    val finishedAt: Long = 0,
    val lastError: String? = null,
    val maxPages: Int = 5000,
)

class CatalogStore(private val dir: File) {
    private val json = Json { ignoreUnknownKeys = true }

    init {
        dir.mkdirs()
    }

    private fun itemsFile(id: String) = File(dir, "$id.jsonl")
    private fun cursorFile(id: String) = File(dir, "$id.cursor.json")

    fun cursor(id: String): CatalogCursor? =
        cursorFile(id).takeIf { it.isFile }?.let { runCatching { json.decodeFromString<CatalogCursor>(it.readText()) }.getOrNull() }

    fun saveCursor(c: CatalogCursor) {
        val f = cursorFile(c.sourceId)
        val tmp = File(dir, f.name + ".tmp")
        tmp.writeText(json.encodeToString(CatalogCursor.serializer(), c))
        tmp.renameTo(f)
    }

    fun append(id: String, items: List<SourceAnime>) {
        if (items.isEmpty()) return
        itemsFile(id).appendText(items.joinToString("\n", postfix = "\n") { json.encodeToString(SourceAnime.serializer(), it) })
    }

    fun items(id: String): List<SourceAnime> =
        itemsFile(id).takeIf { it.isFile }?.useLines { lines ->
            lines.mapNotNull { l -> runCatching { json.decodeFromString<SourceAnime>(l) }.getOrNull() }.toList()
        }.orEmpty().distinctBy { it.url }

    fun urls(id: String): MutableSet<String> = items(id).mapTo(HashSet()) { it.url }

    /** بدء جولة جديدة من الصفر (تحديث الكتالوج دوريًّا). */
    fun reset(id: String) {
        itemsFile(id).delete()
        cursorFile(id).delete()
    }
}

class CatalogCrawler(
    private val store: CatalogStore,
    private val clock: () -> Long = System::currentTimeMillis,
    private val pause: suspend (Long) -> Unit = { delay(it) },
) {
    fun interface PageFetcher {
        suspend fun fetch(page: Int): SourcePage
    }

    /** خطأ عابر يستحق إعادة المحاولة؟ (مهلة، إعادة ضبط، 429، 5xx) */
    fun transient(t: Throwable): Boolean {
        val chain = generateSequence(t) { it.cause }.toList()
        val http = chain.filterIsInstance<eu.kanade.tachiyomi.network.HttpException>().firstOrNull()?.code
        if (http != null) return http == 429 || http >= 500 || http == 403
        return chain.any { it is IOException }
    }

    /**
     * يكمل الحلب من آخر نقطة. [onPage] للتقدّم في الواجهة. يرجع المؤشّر الأخير.
     */
    suspend fun run(
        sourceId: String,
        fetcher: PageFetcher,
        maxPages: Int = 5000,
        minIntervalMs: Long = 500,
        /** قوائم البيان (urlTemplate) لا نثق بـhasNext محلّلها: نكمل حتى صفحة فارغة. */
        trustHasNext: Boolean = true,
        onPage: (CatalogCursor) -> Unit = {},
    ): CatalogCursor {
        var cursor = store.cursor(sourceId)?.takeUnless { it.done } ?: CatalogCursor(sourceId, maxPages = maxPages, startedAt = clock())
        val seen = store.urls(sourceId)
        while (!cursor.done) {
            coroutineContext.ensureActive()
            if (cursor.nextPage > cursor.maxPages) {
                cursor = cursor.copy(done = true, finishedAt = clock(), lastError = "بلغ سقف الصفحات")
                break
            }
            val page = fetchWithRetry(fetcher, cursor.nextPage) ?: run {
                cursor = cursor.copy(lastError = "توقف عند الصفحة ${cursor.nextPage} — يكمل في الجولة القادمة")
                store.saveCursor(cursor)
                return cursor
            }
            val fresh = page.items.filter { seen.add(it.url) }
            store.append(sourceId, fresh)
            val exhausted = (trustHasNext && !page.hasNext) || page.items.isEmpty() || fresh.isEmpty()
            cursor = cursor.copy(
                nextPage = cursor.nextPage + 1,
                count = cursor.count + fresh.size,
                pagesFetched = cursor.pagesFetched + 1,
                done = exhausted,
                finishedAt = if (exhausted) clock() else 0,
                lastError = null,
            )
            store.saveCursor(cursor)
            onPage(cursor)
            if (!exhausted) pause(minIntervalMs)
        }
        return cursor
    }

    private suspend fun fetchWithRetry(fetcher: PageFetcher, page: Int): SourcePage? {
        var wait = 2_000L
        repeat(RETRIES) { attempt ->
            try {
                return fetcher.fetch(page)
            } catch (t: Throwable) {
                if (t is kotlinx.coroutines.CancellationException) throw t
                if (!transient(t) || attempt == RETRIES - 1) return null
                pause(wait)
                wait *= 2
            }
        }
        return null
    }

    private companion object {
        const val RETRIES = 4
    }
}
