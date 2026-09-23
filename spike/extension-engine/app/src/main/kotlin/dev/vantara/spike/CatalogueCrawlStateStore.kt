package dev.vantara.spike

import java.io.File

/**
 * ما يراه المستخدم من الزحف: هل يجري؟ أين وصل؟ ولماذا توقّف؟
 *
 * **ليس** مصدر حقيقة الكتالوج — ذاك `CatalogueCrawlCheckpointStore` صفحةً
 * بصفحة. هذا حالةٌ وتحكّم: بلاها يُعاد فتح التطبيق فلا يعرف أن خدمةً تزحف في
 * الخلفية، فيعرض زرّ «ابدأ» فوق زحفٍ جارٍ ويطلق زحفًا ثانيًا.
 *
 * والكتابة ذرّية (`.tmp` ثم إعادة تسمية)، والقراءة لا تلمس `.tmp` أبدًا: موت
 * العملية وسط الكتابة يترك آخر حالة مكتملة لا نصف حالة.
 */
data class CatalogueCrawlState(
    val active: Boolean = false,
    val finished: Boolean = false,
    val snapshotKey: String = "",
    val totalSources: Int = 0,
    val completedSources: Int = 0,
    val sourceKey: String = "",
    val sourceLabel: String = "",
    val sourceIndex: Int = 0,
    val page: Int = 0,
    val uniqueWorks: Int = 0,
    /** الجولة الحالية. المصدر الذي لم يكمل دوره يعود في جولة لاحقة. */
    val pass: Int = 0,
    val lastEvent: String = "",
    val updatedAtEpochMs: Long = 0L,
)

/**
 * الرقم النهائي لمصدر، أو آخر رقم وصله قبل أن يتوقف.
 *
 * منفصل عن نقطة الحفظ لأن `markComplete` هناك يمحو قائمة الأعمال (لم يعد
 * يحتاجها للاستئناف) — فيضيع معها العدد، وهو بالضبط ما نحصي لأجله.
 */
data class CatalogueSourceResult(
    val key: String,
    val label: String,
    val uniqueWorks: Int,
    val complete: Boolean,
    val note: String,
)

class CatalogueCrawlStateStore(
    root: File,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val dir = File(root, "catalogue-crawl-runtime")
    private val file = File(dir, "state.txt")
    private val resultsFile = File(dir, "results.txt")

    @Synchronized
    fun read(): CatalogueCrawlState = runCatching { decode(file.readText(Charsets.UTF_8)) }
        .getOrDefault(CatalogueCrawlState())

    @Synchronized
    fun markStarted(snapshotKey: String, totalSources: Int) = write {
        // بدء جديد ينسى «انتهى» السابقة، ويحتفظ بالتقدّم للاستئناف
        it.copy(
            active = true,
            finished = false,
            snapshotKey = snapshotKey,
            totalSources = totalSources,
            lastEvent = "",
        )
    }

    @Synchronized
    fun updateProgress(
        sourceKey: String,
        sourceLabel: String,
        sourceIndex: Int,
        page: Int,
        uniqueWorks: Int,
        completedSources: Int,
        pass: Int,
    ) = write {
        it.copy(
            sourceKey = sourceKey,
            sourceLabel = sourceLabel,
            sourceIndex = sourceIndex,
            page = page,
            uniqueWorks = uniqueWorks,
            completedSources = completedSources,
            pass = pass,
        )
    }

    @Synchronized
    fun recordEvent(message: String) = write { it.copy(lastEvent = message) }

    /** «أوقفه المستخدم» يُنزل علم الجريان وحده، ولا يمحو ما جُمع. */
    @Synchronized
    fun markStopped(message: String) = write { it.copy(active = false, finished = false, lastEvent = message) }

    @Synchronized
    fun markFinished(message: String) = write { it.copy(active = false, finished = true, lastEvent = message) }

    /** نتيجة لكل مصدر، بترتيب أول ظهور؛ نتيجة لاحقة لنفس المصدر تحلّ مكانها. */
    @Synchronized
    fun results(): List<CatalogueSourceResult> = runCatching {
        resultsFile.takeIf { it.isFile }
            ?.readText(Charsets.UTF_8)
            ?.split('\n')
            ?.mapNotNull(::decodeResult)
            .orEmpty()
    }.getOrDefault(emptyList())

    @Synchronized
    fun recordResult(key: String, label: String, uniqueWorks: Int, complete: Boolean, note: String) {
        val next = LinkedHashMap<String, CatalogueSourceResult>()
        results().forEach { next[it.key] = it }
        next[key] = CatalogueSourceResult(key, label, uniqueWorks, complete, note)
        atomicWrite(resultsFile, next.values.joinToString(separator = "") { encodeResult(it) + "\n" })
    }

    @Synchronized
    fun clear() {
        file.delete()
        resultsFile.delete()
        File(dir, "state.txt.tmp").delete()
        File(dir, "results.txt.tmp").delete()
    }

    private fun write(change: (CatalogueCrawlState) -> CatalogueCrawlState) {
        val next = change(read()).copy(updatedAtEpochMs = clock())
        atomicWrite(file, encode(next))
    }

    private fun atomicWrite(target: File, text: String) {
        dir.mkdirs()
        val temporary = File(dir, target.name + ".tmp")
        temporary.writeText(text, Charsets.UTF_8)
        if (!temporary.renameTo(target)) {
            target.writeText(text, Charsets.UTF_8)
            temporary.delete()
        }
    }

    private companion object {
        /**
         * سطر لكل حقل، `key=value`، والقيمة مهرَّبة.
         *
         * رسائل الأخطاء تحمل أسطرًا جديدة وعلامات `=`؛ بلا تهريب تنكسر الصيغة
         * عند أول خطأ، فتُقرأ الحالة فارغة ويبدو زحفٌ جارٍ كأنه لم يبدأ.
         */
        fun encode(state: CatalogueCrawlState): String = buildString {
            fun put(key: String, value: Any) = append(key).append('=').append(escape(value.toString())).append('\n')
            put("active", state.active)
            put("finished", state.finished)
            put("snapshotKey", state.snapshotKey)
            put("totalSources", state.totalSources)
            put("completedSources", state.completedSources)
            put("sourceKey", state.sourceKey)
            put("sourceLabel", state.sourceLabel)
            put("sourceIndex", state.sourceIndex)
            put("page", state.page)
            put("uniqueWorks", state.uniqueWorks)
            put("pass", state.pass)
            put("lastEvent", state.lastEvent)
            put("updatedAtEpochMs", state.updatedAtEpochMs)
        }

        fun decode(text: String): CatalogueCrawlState {
            val fields = HashMap<String, String>()
            for (line in text.split('\n')) {
                val at = line.indexOf('=')
                if (at <= 0) continue
                fields[line.substring(0, at)] = unescape(line.substring(at + 1))
            }
            // ملفٌّ بلا الحقلين الأساسيين تالف، لا حالة: يُقرأ كأن لا زحف
            if ("active" !in fields || "snapshotKey" !in fields) return CatalogueCrawlState()
            fun int(key: String) = fields[key]?.toIntOrNull() ?: 0
            return CatalogueCrawlState(
                active = fields["active"] == "true",
                finished = fields["finished"] == "true",
                snapshotKey = fields["snapshotKey"].orEmpty(),
                totalSources = int("totalSources"),
                completedSources = int("completedSources"),
                sourceKey = fields["sourceKey"].orEmpty(),
                sourceLabel = fields["sourceLabel"].orEmpty(),
                sourceIndex = int("sourceIndex"),
                page = int("page"),
                uniqueWorks = int("uniqueWorks"),
                pass = int("pass"),
                lastEvent = fields["lastEvent"].orEmpty(),
                updatedAtEpochMs = fields["updatedAtEpochMs"]?.toLongOrNull() ?: 0L,
            )
        }

        fun encodeResult(result: CatalogueSourceResult): String = listOf(
            result.key,
            result.label,
            result.uniqueWorks.toString(),
            result.complete.toString(),
            result.note,
        ).joinToString("\t") { escape(it) }

        fun decodeResult(line: String): CatalogueSourceResult? {
            val parts = line.split('\t')
            if (parts.size != 5) return null
            return CatalogueSourceResult(
                key = unescape(parts[0]).ifBlank { return null },
                label = unescape(parts[1]),
                uniqueWorks = parts[2].toIntOrNull() ?: return null,
                complete = parts[3] == "true",
                note = unescape(parts[4]),
            )
        }

        fun escape(value: String): String = buildString {
            for (c in value) when (c) {
                '\\' -> append("\\\\")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> append(c)
            }
        }

        fun unescape(value: String): String = buildString {
            var i = 0
            while (i < value.length) {
                val c = value[i]
                if (c == '\\' && i + 1 < value.length) {
                    when (value[i + 1]) {
                        'n' -> append('\n')
                        'r' -> append('\r')
                        't' -> append('\t')
                        '\\' -> append('\\')
                        else -> append(value[i + 1])
                    }
                    i += 2
                } else {
                    append(c)
                    i += 1
                }
            }
        }
    }
}
