package dev.vantara.spike

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * حالة الزحف الظاهرة للمستخدم.
 *
 * السؤال: حين يُقتل التطبيق ويُعاد، هل يعرف أن زحفًا كان جاريًا وأين وصل؟
 * وهل «إيقاف» يمحو ما جُمع؟ صحّة الكتالوج نفسها في `CatalogueCrawlCheckpointStore`؛
 * هذا المخزن حالةٌ وتحكّم فقط.
 */
class CatalogueCrawlStateStoreTest {

    private fun freshDir(): File = Files.createTempDirectory("vantara-crawl-state").toFile()

    @Test
    fun `default state is inactive and unfinished`() {
        val state = CatalogueCrawlStateStore(freshDir()).read()

        assertFalse(state.active)
        assertFalse(state.finished)
        assertEquals(0, state.page)
    }

    @Test
    fun `active crawl state survives store recreation`() {
        val dir = freshDir()
        CatalogueCrawlStateStore(dir).apply {
            markStarted("snapshot-v1", totalSources = 16)
            updateProgress(
                sourceKey = "pkg|1",
                sourceLabel = "Mangalek",
                sourceIndex = 3,
                page = 42,
                uniqueWorks = 840,
                completedSources = 2,
                pass = 1,
            )
        }

        val restored = CatalogueCrawlStateStore(dir).read()

        assertTrue(restored.active)
        assertEquals("snapshot-v1", restored.snapshotKey)
        assertEquals(16, restored.totalSources)
        assertEquals("Mangalek", restored.sourceLabel)
        assertEquals(3, restored.sourceIndex)
        assertEquals(42, restored.page)
        assertEquals(840, restored.uniqueWorks)
        assertEquals(2, restored.completedSources)
    }

    @Test
    fun `stop clears only the running flag and keeps the progress`() {
        // «أوقفه المستخدم» لا يعني «امحُ ما جمعناه»
        val dir = freshDir()
        CatalogueCrawlStateStore(dir).apply {
            markStarted("snap", totalSources = 16)
            updateProgress("pkg|1", "Azora", 0, page = 9, uniqueWorks = 180, completedSources = 0, pass = 1)
            markStopped("أوقفه المستخدم")
        }

        val restored = CatalogueCrawlStateStore(dir).read()

        assertFalse(restored.active)
        assertFalse(restored.finished)
        assertEquals(9, restored.page)
        assertEquals(180, restored.uniqueWorks)
        assertEquals("أوقفه المستخدم", restored.lastEvent)
    }

    @Test
    fun `finish marks the run done and inactive`() {
        val dir = freshDir()
        CatalogueCrawlStateStore(dir).apply {
            markStarted("snap", totalSources = 16)
            markFinished("اكتمل")
        }

        val restored = CatalogueCrawlStateStore(dir).read()

        assertFalse(restored.active)
        assertTrue(restored.finished)
    }

    @Test
    fun `a new start forgets the previous finished marker`() {
        val dir = freshDir()
        CatalogueCrawlStateStore(dir).apply {
            markStarted("snap", totalSources = 16)
            markFinished("اكتمل")
            markStarted("snap", totalSources = 16)
        }

        val restored = CatalogueCrawlStateStore(dir).read()

        assertTrue(restored.active)
        assertFalse(restored.finished)
    }

    @Test
    fun `a half written temporary file never replaces the committed state`() {
        // موت العملية أثناء الكتابة يترك `.tmp` ناقصًا؛ القراءة لا تلمسه
        val dir = freshDir()
        val store = CatalogueCrawlStateStore(dir)
        store.markStarted("snap", totalSources = 16)
        store.updateProgress("pkg|1", "Team X", 1, page = 5, uniqueWorks = 100, completedSources = 0, pass = 1)

        val runtime = File(dir, "catalogue-crawl-runtime")
        File(runtime, "state.txt.tmp").writeText("active=fal", Charsets.UTF_8)

        val restored = CatalogueCrawlStateStore(dir).read()
        assertTrue(restored.active)
        assertEquals(5, restored.page)
    }

    @Test
    fun `event text with line breaks round trips intact`() {
        // رسائل الأخطاء تحمل أسطرًا جديدة؛ صيغة السطور لا يجوز أن تنكسر بها
        val dir = freshDir()
        CatalogueCrawlStateStore(dir).recordEvent("خطأ\nفي السطر الثاني=نعم")

        assertEquals("خطأ\nفي السطر الثاني=نعم", CatalogueCrawlStateStore(dir).read().lastEvent)
    }

    @Test
    fun `a corrupt state file reads as inactive instead of throwing`() {
        val dir = freshDir()
        val runtime = File(dir, "catalogue-crawl-runtime").apply { mkdirs() }
        File(runtime, "state.txt").writeText("garbage\n\u0000\u0001", Charsets.UTF_8)

        val state = CatalogueCrawlStateStore(dir).read()
        assertFalse(state.active)
    }

    @Test
    fun `clear resets to the default state`() {
        val dir = freshDir()
        CatalogueCrawlStateStore(dir).apply {
            markStarted("snap", totalSources = 16)
            recordResult("pkg|1", "Azora", uniqueWorks = 10, complete = true, note = "COMPLETE")
            clear()
        }

        assertFalse(CatalogueCrawlStateStore(dir).read().active)
        assertTrue(CatalogueCrawlStateStore(dir).results().isEmpty())
    }

    @Test
    fun `a source's final count survives recreation`() {
        // نقطة الحفظ تمحو قائمة الأعمال حين يكتمل المصدر؛ الرقم نفسه لا يجوز
        // أن يضيع معها — هو ما نحصي لأجله
        val dir = freshDir()
        CatalogueCrawlStateStore(dir).recordResult(
            "pkg|1",
            "Mangalek / Mangalek",
            uniqueWorks = 4_812,
            complete = true,
            note = "COMPLETE",
        )

        val results = CatalogueCrawlStateStore(dir).results()
        assertEquals(1, results.size)
        assertEquals("Mangalek / Mangalek", results[0].label)
        assertEquals(4_812, results[0].uniqueWorks)
        assertTrue(results[0].complete)
    }

    @Test
    fun `a later result for the same source replaces the earlier one in place`() {
        val dir = freshDir()
        CatalogueCrawlStateStore(dir).apply {
            recordResult("pkg|A", "A", uniqueWorks = 100, complete = false, note = "TIME_BUDGET")
            recordResult("pkg|B", "B", uniqueWorks = 7, complete = true, note = "COMPLETE")
            recordResult("pkg|A", "A", uniqueWorks = 900, complete = true, note = "COMPLETE")
        }

        val results = CatalogueCrawlStateStore(dir).results()
        assertEquals(listOf("pkg|A", "pkg|B"), results.map { it.key })
        assertEquals(900, results[0].uniqueWorks)
        assertTrue(results[0].complete)
    }

    @Test
    fun `result notes with tabs and line breaks round trip intact`() {
        val dir = freshDir()
        CatalogueCrawlStateStore(dir).recordResult(
            "pkg|1",
            "X\tY",
            uniqueWorks = 1,
            complete = false,
            note = "HTTP 403\nمن Cloudflare",
        )

        val result = CatalogueCrawlStateStore(dir).results().single()
        assertEquals("X\tY", result.label)
        assertEquals("HTTP 403\nمن Cloudflare", result.note)
    }
}
