package dev.vantara.spike

import eu.kanade.tachiyomi.source.CatalogueSource
import java.io.File
import java.nio.file.Files
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * منسّق الزحف، بلا شاشة.
 *
 * السؤال الذي تجيب عنه: هل يمشي الزحف **حتى يقول المصدر «لا مزيد»**؟ الشاشة
 * كانت تقتله حين تُغلق، وسقف الخمس والأربعين دقيقة كان يوقفه ويترك رقمًا
 * ناقصًا ينتظر ضغطة «استئناف». هنا الدور ليس وقوفًا: المصدر الذي لم يكمل يعود
 * في جولة لاحقة من حيث وقف، ولا يتوقف نهائيًّا إلا لسبب حقيقي.
 */
class CatalogueCrawlRunnerTest {

    private class FakeSource(override val id: Long, override val name: String) : CatalogueSource {
        override val lang: String = "ar"
    }

    private fun spec(label: String, pkg: String = "pkg.$label") = SourceSpec(
        label = label,
        pkg = pkg,
        expectedLib = 1.6,
        apkUrl = "https://example.invalid/$label.apk",
        sha256 = "0".repeat(64),
        versionName = "1.0",
        warning = ContentWarning.SAFE,
        arabicSourceIds = setOf("1"),
        arabicSourceNames = listOf(label),
    )

    private fun reach(
        kind: SourceProbe.CatalogueStopKind,
        unique: Int = 0,
        lastPage: Int = 1,
    ) = SourceProbe.CatalogueReach(
        uniqueWorks = unique,
        pagesFetched = 1,
        lastPageAttempted = lastPage,
        reachedEnd = kind == SourceProbe.CatalogueStopKind.COMPLETE,
        stopKind = kind,
        stoppedBecause = kind.name,
    )

    private class Harness(dir: File) {
        val checkpoint = CatalogueCrawlCheckpointStore(dir)
        val state = CatalogueCrawlStateStore(dir)
        val calls = mutableListOf<String>()
        val resumes = mutableMapOf<String, CatalogueCrawlCheckpointStore.Resume?>()
    }

    private fun dir(): File = Files.createTempDirectory("vantara-crawl-runner").toFile()

    private fun runner(
        h: Harness,
        specs: List<SourceSpec>,
        emit: suspend (CatalogueCrawlEvent) -> Unit = {},
        loadFails: Set<String> = emptySet(),
        // الأخير عمدًا: اللامدا اللاحقة في الاختبارات تُربط بالمعامل الأخير
        crawl: suspend (
            key: String,
            resume: CatalogueCrawlCheckpointStore.Resume?,
            commit: suspend (page: Int, nextPage: Int, newKeys: List<String>, totalSeen: Int) -> Unit,
        ) -> SourceProbe.CatalogueReach,
    ) = CatalogueCrawlRunner(
        specs = specs,
        snapshotKey = "snap",
        checkpoint = h.checkpoint,
        stateStore = h.state,
        loadSources = { spec ->
            if (spec.label in loadFails) error("load exploded for ${spec.label}")
            listOf(FakeSource(1L, spec.label))
        },
        crawlSource = { spec, source, resume, onPageCommitted, _ ->
            val key = "${spec.pkg}|${source.id}"
            h.calls += key
            h.resumes[key] = resume
            crawl(key, resume, onPageCommitted)
        },
        emit = emit,
    )

    @Test
    fun `a source that reaches the end is marked complete`() = runBlocking {
        val h = Harness(dir())
        runner(h, listOf(spec("A"))) { _, _, commit ->
            commit(1, 2, listOf("a1"), 1)
            reach(SourceProbe.CatalogueStopKind.COMPLETE, unique = 1)
        }.run()

        assertTrue(h.checkpoint.isComplete("pkg.A|1"))
    }

    @Test
    fun `a completed source is not crawled again by a recreated runner`() = runBlocking {
        val d = dir()
        val first = Harness(d)
        runner(first, listOf(spec("A"))) { _, _, _ ->
            reach(SourceProbe.CatalogueStopKind.COMPLETE)
        }.run()

        val second = Harness(d)
        runner(second, listOf(spec("A"))) { _, _, _ ->
            fail("a complete source must not be crawled again")
            reach(SourceProbe.CatalogueStopKind.COMPLETE)
        }.run()

        assertTrue(second.calls.isEmpty())
    }

    @Test
    fun `resume hands the stored page and seen works to the crawl`() = runBlocking {
        val h = Harness(dir())
        h.checkpoint.savePage("pkg.A|1", nextPage = 17, newKeys = listOf("x", "y"))

        runner(h, listOf(spec("A"))) { _, _, _ ->
            reach(SourceProbe.CatalogueStopKind.COMPLETE)
        }.run()

        val resume = h.resumes["pkg.A|1"]!!
        assertEquals(17, resume.nextPage)
        assertEquals(setOf("x", "y"), resume.seenKeys)
    }

    @Test
    fun `every committed page is written to the checkpoint`() = runBlocking {
        val h = Harness(dir())
        var sawSavedBeforeReturning = false
        runner(h, listOf(spec("A"))) { key, _, commit ->
            commit(1, 2, listOf("a1"), 1)
            // الصفحة محفوظة قبل أن يتقدّم أي شيء: هذا حدّ الانهيار
            sawSavedBeforeReturning = h.checkpoint.load(key)?.nextPage == 2
            reach(SourceProbe.CatalogueStopKind.SOURCE_ERROR, unique = 1)
        }.run()

        assertTrue(sawSavedBeforeReturning)
    }

    @Test
    fun `one source failing to load does not stop the next`() = runBlocking {
        val h = Harness(dir())
        runner(
            h,
            listOf(spec("A"), spec("B")),
            crawl = { _, _, _ -> reach(SourceProbe.CatalogueStopKind.COMPLETE) },
            loadFails = setOf("A"),
        ).run()

        assertEquals(listOf("pkg.B|1"), h.calls)
        assertTrue(h.checkpoint.isComplete("pkg.B|1"))
    }

    @Test
    fun `one source throwing mid crawl does not stop the next`() = runBlocking {
        val h = Harness(dir())
        runner(h, listOf(spec("A"), spec("B"))) { key, _, _ ->
            if (key.startsWith("pkg.A")) error("parser exploded")
            reach(SourceProbe.CatalogueStopKind.COMPLETE)
        }.run()

        assertTrue(h.checkpoint.isComplete("pkg.B|1"))
        assertFalse(h.checkpoint.isComplete("pkg.A|1"))
    }

    @Test
    fun `a self imposed time budget stop comes back in a later pass until the end`() = runBlocking {
        // هذا لبّ المسألة: الخمس والأربعون دقيقة دورٌ لا وقوف. المصدر الكبير
        // يعود من صفحته المحفوظة حتى يقول هو «لا مزيد»
        val h = Harness(dir())
        var page = 1
        runner(h, listOf(spec("Big"))) { _, _, commit ->
            val next = page + 10
            commit(page, next, listOf("w$page"), page)
            page = next
            if (page < 40) {
                reach(SourceProbe.CatalogueStopKind.TIME_BUDGET, lastPage = page)
            } else {
                reach(SourceProbe.CatalogueStopKind.COMPLETE, lastPage = page)
            }
        }.run()

        assertEquals(4, h.calls.size)
        assertTrue(h.checkpoint.isComplete("pkg.Big|1"))
    }

    @Test
    fun `sources take turns so a huge one does not starve the rest`() = runBlocking {
        // الدور بالتناوب: الصغير لا ينتظر ساعات خلف الكبير
        val h = Harness(dir())
        var bigPage = 1
        runner(h, listOf(spec("Big"), spec("Small"))) { key, _, commit ->
            if (key.startsWith("pkg.Big")) {
                val next = bigPage + 1
                commit(bigPage, next, listOf("b$bigPage"), bigPage)
                bigPage = next
                if (bigPage < 3) reach(SourceProbe.CatalogueStopKind.TIME_BUDGET)
                else reach(SourceProbe.CatalogueStopKind.COMPLETE)
            } else {
                reach(SourceProbe.CatalogueStopKind.COMPLETE)
            }
        }.run()

        assertEquals(listOf("pkg.Big|1", "pkg.Small|1", "pkg.Big|1"), h.calls)
    }

    @Test
    fun `a hard stop is not retried in the same run and keeps its checkpoint`() = runBlocking {
        // Cloudflare يريد تدخّلك: العودة إليه كل جولة تضرب الموقع بلا فائدة
        val h = Harness(dir())
        runner(h, listOf(spec("CF"))) { _, _, commit ->
            commit(1, 5, listOf("c1"), 1)
            reach(SourceProbe.CatalogueStopKind.CLOUDFLARE, lastPage = 5)
        }.run()

        assertEquals(1, h.calls.size)
        assertFalse(h.checkpoint.isComplete("pkg.CF|1"))
        assertEquals(5, h.checkpoint.load("pkg.CF|1")!!.nextPage)
    }

    @Test
    fun `a soft stop that makes no progress eventually gives up`() = runBlocking {
        // صفحة تنتهي مهلتها كل مرّة بلا تقدّم: هذا المصدر «يطلب الرحمة»
        val h = Harness(dir())
        runner(h, listOf(spec("Stuck"))) { _, _, _ ->
            reach(SourceProbe.CatalogueStopKind.TIMEOUT)
        }.run()

        assertEquals(CatalogueCrawlRunner.STALL_LIMIT, h.calls.size)
        assertFalse(h.checkpoint.isComplete("pkg.Stuck|1"))
    }

    @Test
    fun `cancellation propagates and leaves the committed page in place`() = runBlocking {
        val h = Harness(dir())
        val started = CompletableDeferred<Unit>()
        val job = async {
            runner(h, listOf(spec("A"))) { _, _, commit ->
                commit(1, 3, listOf("a1"), 1)
                started.complete(Unit)
                kotlinx.coroutines.awaitCancellation()
            }.run()
        }
        started.await()
        job.cancel()

        try {
            job.await()
            fail("cancellation must propagate out of the runner")
        } catch (expected: CancellationException) {
            // صحيح: الإلغاء لا يُبتلع
        }
        assertEquals(3, h.checkpoint.load("pkg.A|1")!!.nextPage)
        assertFalse(h.checkpoint.isComplete("pkg.A|1"))
    }

    @Test
    fun `a broken observer does not stop the crawl`() = runBlocking {
        // الشاشة قد تختفي وسط الزحف؛ مستمعٌ معطوب لا يوقف الخدمة
        val h = Harness(dir())
        runner(
            h,
            listOf(spec("A"), spec("B")),
            crawl = { _, _, _ -> reach(SourceProbe.CatalogueStopKind.COMPLETE) },
            emit = { error("observer is gone") },
        ).run()

        assertTrue(h.checkpoint.isComplete("pkg.A|1"))
        assertTrue(h.checkpoint.isComplete("pkg.B|1"))
    }

    @Test
    fun `the run is marked finished only after the whole batch`() = runBlocking {
        val h = Harness(dir())
        var activeDuringCrawl = false
        runner(h, listOf(spec("A"))) { _, _, _ ->
            activeDuringCrawl = h.state.read().active
            reach(SourceProbe.CatalogueStopKind.COMPLETE)
        }.run()

        assertTrue(activeDuringCrawl)
        val end = h.state.read()
        assertFalse(end.active)
        assertTrue(end.finished)
    }

    @Test
    fun `a completed source keeps its final count after the checkpoint drops its works`() = runBlocking {
        val h = Harness(dir())
        runner(h, listOf(spec("A"))) { _, _, commit ->
            commit(1, 2, listOf("a1", "a2", "a3"), 3)
            reach(SourceProbe.CatalogueStopKind.COMPLETE, unique = 3)
        }.run()

        val result = h.state.results().single()
        assertEquals("pkg.A|1", result.key)
        assertEquals(3, result.uniqueWorks)
        assertTrue(result.complete)
    }

    @Test
    fun `a hard stop is recorded as a partial count with its reason`() = runBlocking {
        val h = Harness(dir())
        runner(h, listOf(spec("CF"))) { _, _, _ ->
            reach(SourceProbe.CatalogueStopKind.CLOUDFLARE, unique = 40)
        }.run()

        val result = h.state.results().single()
        assertEquals(40, result.uniqueWorks)
        assertFalse(result.complete)
        assertTrue(result.note.contains("CLOUDFLARE"))
    }

    @Test
    fun `the summary separates finished sources from ones that still need you`() = runBlocking {
        val h = Harness(dir())
        val summary = runner(h, listOf(spec("Done"), spec("CF"))) { key, _, _ ->
            if (key.startsWith("pkg.Done")) reach(SourceProbe.CatalogueStopKind.COMPLETE)
            else reach(SourceProbe.CatalogueStopKind.CLOUDFLARE)
        }.run()

        assertEquals(1, summary.completed)
        assertEquals(listOf("pkg.CF|1"), summary.stopped.map { it.key })
        assertNull(summary.stopped.firstOrNull { it.key == "pkg.Done|1" })
    }
}
