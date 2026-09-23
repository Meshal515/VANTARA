package dev.vantara.spike

import eu.kanade.tachiyomi.source.CatalogueSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException

/** ما يحدث أثناء الزحف، لمن يريد أن يعرض. غيابُ من يسمع لا يوقف شيئًا. */
sealed interface CatalogueCrawlEvent {
    data class Started(val totalSources: Int) : CatalogueCrawlEvent
    data class SourceStarted(
        val key: String,
        val label: String,
        val pass: Int,
        val resumeFromPage: Int?,
        val alreadySeen: Int,
    ) : CatalogueCrawlEvent
    data class Progress(val key: String, val label: String, val page: Int, val found: Int) : CatalogueCrawlEvent
    data class SourceFinished(val key: String, val label: String, val reach: SourceProbe.CatalogueReach) : CatalogueCrawlEvent
    data class SourceFailed(val key: String, val label: String, val reason: String) : CatalogueCrawlEvent
    data class Finished(val summary: CatalogueRunSummary) : CatalogueCrawlEvent
}

/** مصدرٌ توقّف لسبب حقيقي في هذا التشغيل، ونقطة حفظه باقية. */
data class StoppedSource(
    val key: String,
    val label: String,
    /** `null` حين سقط قبل أن يُرجع الزحف نتيجة (تحميل، استثناء). */
    val kind: SourceProbe.CatalogueStopKind?,
    val reason: String,
)

data class CatalogueRunSummary(
    val completed: Int,
    val stopped: List<StoppedSource>,
    val passes: Int,
)

/**
 * منسّق الزحف على الكتالوج كله، بلا شاشة ولا إشعار ولا `Context`.
 *
 * كان هذا الزحف يسكن `lifecycleScope` في الشاشة الرئيسية، فيموت حين تُغلق — وهو
 * سبب أن الأعداد تظهر أقلّ من الحقيقة. وهنا لا يعرف شيئًا عن أندرويد، فتملكه
 * خدمة تعيش بعد الشاشة، ويُختبر بلا جهاز.
 *
 * **والدور ليس وقوفًا.** `SourceProbe` يعطي كل مصدر خمسًا وأربعين دقيقة ثم
 * يتوقّف بـ`TIME_BUDGET`. وكان ذلك ينهي المصدر الكبير برقم ناقص ينتظر ضغطة
 * «استئناف». المالك طلب كل الأعمال «حتى يقول المصدر لا مزيد»، والدور وقوفٌ منّا
 * لا من المصدر. فيعود المصدر في جولة لاحقة من صفحته المحفوظة، والمصادر تتناوب
 * فلا يجوع الصغير خلف الكبير ساعات.
 *
 * ولا يتوقّف المصدر نهائيًّا في هذا التشغيل إلا لسبب حقيقي: Cloudflare يريد
 * تدخّلك، أو مضيف ميت، أو صفحة تتكرّر، أو خطأ محلّل، أو سقف الصفحات البعيد.
 * أو حين يعود إليه الزحف [STALL_LIMIT] جولات متتالية فلا يتقدّم صفحة — فذاك
 * مصدرٌ «يطلب الرحمة»، والعودة إليه كل جولة تضرب موقعًا لا يجيب.
 *
 * والانتهاء مضمون: كل جولة إما تُقدّم صفحة المصدر (وسقفها بعيد لكنه محدود)،
 * وإما تعدّ له جمودًا (وسقفه [STALL_LIMIT]).
 *
 * **ملاحظة للمنادي:** ربطُ نقاط الحفظ بلقطة المصادر (`ensureSnapshot`) مسؤوليته
 * قبل [run]، كما تفعل الشاشة اليوم. المنسّق يثق بما في المخزن ولا يمحوه.
 */
class CatalogueCrawlRunner(
    private val specs: List<SourceSpec>,
    private val snapshotKey: String,
    private val checkpoint: CatalogueCrawlCheckpointStore,
    private val stateStore: CatalogueCrawlStateStore,
    private val loadSources: suspend (SourceSpec) -> List<CatalogueSource>,
    private val crawlSource: suspend (
        spec: SourceSpec,
        source: CatalogueSource,
        resume: CatalogueCrawlCheckpointStore.Resume?,
        onPageCommitted: suspend (page: Int, nextPage: Int, newKeys: List<String>, totalSeen: Int) -> Unit,
        onProgress: suspend (page: Int, found: Int) -> Unit,
    ) -> SourceProbe.CatalogueReach,
    private val emit: suspend (CatalogueCrawlEvent) -> Unit = {},
) {
    /**
     * `key` مفتاح نقطة الحفظ ويحمل وسم مسار التصفّح؛ `resultKey` مفتاح المصدر
     * في جدول النتائج. مصدرٌ تغيّر مساره يبدأ نقطة حفظ جديدة، ويبقى صفًّا
     * واحدًا في الجدول يحلّ رقمه الجديد محلّ القديم.
     */
    private class CrawlTarget(
        val spec: SourceSpec,
        val source: CatalogueSource,
        val key: String,
        val resultKey: String,
        val label: String,
    )

    suspend fun run(): CatalogueRunSummary {
        val eligible = specs.filter { shouldCrawlCatalogue(it.warning, it.blockedReason) }
        // «يجري» من اللحظة الأولى: تنزيل الحزم قد يطول، والشاشة لا يجوز أن تعرض
        // «ابدأ» فوق زحفٍ بدأ فعلًا
        stateStore.markStarted(snapshotKey, eligible.size)
        notify(CatalogueCrawlEvent.Started(eligible.size))

        val stopped = mutableListOf<StoppedSource>()
        val targets = mutableListOf<CrawlTarget>()
        for (spec in eligible) {
            val sources = try {
                loadSources(spec)
            } catch (t: Throwable) {
                rethrowIfCancelled(t)
                val reason = describe(t)
                stopped += StoppedSource(spec.pkg, spec.label, null, "load: $reason")
                stateStore.recordEvent("${spec.label} — تعذّر التحميل: $reason")
                notify(CatalogueCrawlEvent.SourceFailed(spec.pkg, spec.label, reason))
                continue
            }
            sources.forEach { source ->
                val base = "${spec.pkg}|${source.id}"
                targets += CrawlTarget(
                    spec,
                    source,
                    key = base + CatalogueFilterPolicy.traversalTag(source),
                    resultKey = base,
                    label = "${spec.label} / ${source.name}",
                )
            }
        }
        stateStore.markStarted(snapshotKey, targets.size)

        var completed = targets.count { checkpoint.isComplete(it.key) }
        var active = targets.filterNot { checkpoint.isComplete(it.key) }
        val stalls = HashMap<String, Int>()
        var pass = 0

        while (active.isNotEmpty()) {
            pass += 1
            val again = ArrayList<CrawlTarget>(active.size)

            for (target in active) {
                val before = checkpoint.load(target.key)
                val index = targets.indexOf(target)
                stateStore.updateProgress(
                    sourceKey = target.key,
                    sourceLabel = target.label,
                    sourceIndex = index,
                    page = before?.nextPage ?: 1,
                    uniqueWorks = before?.seenKeys?.size ?: 0,
                    completedSources = completed,
                    pass = pass,
                )
                notify(
                    CatalogueCrawlEvent.SourceStarted(
                        key = target.key,
                        label = target.label,
                        pass = pass,
                        resumeFromPage = before?.nextPage,
                        alreadySeen = before?.seenKeys?.size ?: 0,
                    ),
                )

                val reach = try {
                    crawlSource(
                        target.spec,
                        target.source,
                        before,
                        { _, nextPage, newKeys, _ ->
                            // حدّ الانهيار: الصفحة تُحفظ قبل أي تقدّم
                            checkpoint.savePage(target.key, nextPage, newKeys)
                        },
                        { page, found ->
                            stateStore.updateProgress(
                                sourceKey = target.key,
                                sourceLabel = target.label,
                                sourceIndex = index,
                                page = page,
                                uniqueWorks = found,
                                completedSources = completed,
                                pass = pass,
                            )
                            notify(CatalogueCrawlEvent.Progress(target.key, target.label, page, found))
                        },
                    )
                } catch (t: Throwable) {
                    rethrowIfCancelled(t)
                    val reason = describe(t)
                    stopped += StoppedSource(target.key, target.label, null, reason)
                    stateStore.recordResult(
                        target.resultKey,
                        target.label,
                        uniqueWorks = checkpoint.load(target.key)?.seenKeys?.size ?: 0,
                        complete = false,
                        note = reason,
                    )
                    stateStore.recordEvent("${target.label} — $reason")
                    notify(CatalogueCrawlEvent.SourceFailed(target.key, target.label, reason))
                    continue
                }

                notify(CatalogueCrawlEvent.SourceFinished(target.key, target.label, reach))
                // الرقم يُسجَّل قبل `markComplete`: ذاك يمحو قائمة الأعمال
                stateStore.recordResult(
                    target.resultKey,
                    target.label,
                    uniqueWorks = reach.uniqueWorks,
                    complete = reach.reachedEnd,
                    note = if (reach.reachedEnd) reach.stopKind.name else "${reach.stopKind.name}: ${reach.stoppedBecause}",
                )

                when {
                    reach.reachedEnd -> {
                        checkpoint.markComplete(target.key)
                        completed += 1
                    }
                    isRetryableInLaterPass(reach.stopKind) -> {
                        val advanced = (checkpoint.load(target.key)?.nextPage ?: 1) > (before?.nextPage ?: 1)
                        val streak = if (advanced) 0 else (stalls[target.key] ?: 0) + 1
                        stalls[target.key] = streak
                        if (streak >= STALL_LIMIT) {
                            stopped += StoppedSource(
                                target.key,
                                target.label,
                                reach.stopKind,
                                "لم يتقدّم $streak جولات: ${reach.stoppedBecause}",
                            )
                        } else {
                            again += target
                        }
                    }
                    else -> stopped += StoppedSource(target.key, target.label, reach.stopKind, reach.stoppedBecause)
                }
            }

            active = again
        }

        val summary = CatalogueRunSummary(completed = completed, stopped = stopped, passes = pass)
        stateStore.markFinished(
            if (stopped.isEmpty()) "اكتمل كل مصدر حتى نهايته"
            else "اكتمل $completed · ينتظر ${stopped.size}",
        )
        notify(CatalogueCrawlEvent.Finished(summary))
        return summary
    }

    /** مستمعٌ معطوب — شاشةٌ اختفت مثلًا — لا يوقف الزحف. الإلغاء وحده يمرّ. */
    private suspend fun notify(event: CatalogueCrawlEvent) {
        try {
            emit(event)
        } catch (t: Throwable) {
            rethrowIfCancelled(t)
        }
    }

    companion object {
        /**
         * كم جولة متتالية بلا صفحة واحدة جديدة قبل أن نعدّ المصدر «يطلب الرحمة».
         *
         * ثلاث: صفحةٌ تنتهي مهلتها مرّة قد تكون شبكة، ومرّتين قد تكون صدفة،
         * وثلاثًا موقعٌ لا يجيب.
         */
        const val STALL_LIMIT = 3

        /**
         * وقوفٌ منّا لا من المصدر: يعود في جولة لاحقة.
         *
         * `TIME_BUDGET` دورٌ انتهى، و`TIMEOUT` صفحة واحدة تأخّرت. الباقي أسباب
         * حقيقية لا تزول بالمحاولة الفورية — والعودة إليها كل جولة تضرب موقعًا
         * يطلب تدخّلك أو لا يجيب.
         */
        fun isRetryableInLaterPass(kind: SourceProbe.CatalogueStopKind): Boolean =
            kind == SourceProbe.CatalogueStopKind.TIME_BUDGET ||
                kind == SourceProbe.CatalogueStopKind.TIMEOUT ||
                kind == SourceProbe.CatalogueStopKind.TRANSIENT_HTTP

        private fun rethrowIfCancelled(t: Throwable) {
            // المهلة إلغاءٌ في نوعها لا في معناها: هي فشل صفحة، لا طلب إيقاف
            if (t is CancellationException && t !is TimeoutCancellationException) throw t
        }

        private fun describe(t: Throwable): String =
            "${t.javaClass.simpleName}: ${t.message?.take(300) ?: "—"}"
    }
}
