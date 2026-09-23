package dev.vantara.spike

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * ما تعرضه الشاشة، مشتقًّا من الحالة الدائمة ومن حياة الخدمة معًا.
 *
 * السؤال: هل يستطيع المستخدم دائمًا أن يُكمل؟ الحالة الدائمة وحدها تكذب بعد
 * «إيقاف إجباري» من إعدادات أندرويد: تبقى تقول «يجري» ولا خدمة تجري. زرٌّ يثق
 * بها وحدها يعلّق المستخدم أمام «يجري…» إلى الأبد.
 */
class CatalogueCrawlUiPolicyTest {

    private val running = CatalogueCrawlState(
        active = true,
        snapshotKey = "snap",
        totalSources = 16,
        sourceLabel = "Mangalek / Mangalek",
        sourceIndex = 2,
        page = 40,
        uniqueWorks = 812,
        completedSources = 3,
        pass = 2,
    )

    @Test
    fun `a live running crawl is attached to, never started twice`() {
        assertEquals(
            CatalogueCrawlUiPolicy.StartAction.ATTACH,
            CatalogueCrawlUiPolicy.startAction(running, liveService = true),
        )
    }

    @Test
    fun `a stale running marker after a force stop can still be resumed`() {
        // هذه ثغرة الخطة الأولى: «يجري» في الملف، ولا خدمة في العملية
        assertEquals(
            CatalogueCrawlUiPolicy.StartAction.START,
            CatalogueCrawlUiPolicy.startAction(running, liveService = false),
        )
        assertTrue(CatalogueCrawlUiPolicy.isStale(running, liveService = false))
    }

    @Test
    fun `nothing started yet offers a fresh crawl`() {
        val text = CatalogueCrawlUiPolicy.buttonText(
            CatalogueCrawlState(),
            liveService = false,
            sourceCount = 16,
            hasProgress = false,
        )
        assertEquals("احصِ كتالوج كل المصادر (16) — يطول", text)
    }

    @Test
    fun `saved progress offers to resume`() {
        val text = CatalogueCrawlUiPolicy.buttonText(
            CatalogueCrawlState(active = false, page = 9),
            liveService = false,
            sourceCount = 16,
            hasProgress = true,
        )
        assertEquals("استأنف إحصاء كل المصادر (16)", text)
    }

    @Test
    fun `a live crawl offers to stop instead of start`() {
        val text = CatalogueCrawlUiPolicy.buttonText(running, liveService = true, sourceCount = 16, hasProgress = true)
        assertEquals("أوقف الإحصاء", text)
    }

    @Test
    fun `the running status names the source, page, count and pass`() {
        val status = CatalogueCrawlUiPolicy.statusText(running, liveService = true)!!
        assertTrue(status.contains("Mangalek"))
        assertTrue(status.contains("40"))
        assertTrue(status.contains("812"))
        assertTrue(status.contains("3/16"))
        assertTrue(status.contains("الجولة 2"))
    }

    @Test
    fun `the first pass does not announce a round number`() {
        // «الجولة ١» ضجيج: الجولات تُذكر حين يبدأ الرجوع إلى المصادر فقط
        val status = CatalogueCrawlUiPolicy.statusText(running.copy(pass = 1), liveService = true)!!
        assertTrue(!status.contains("الجولة"))
    }

    @Test
    fun `a stale marker explains itself rather than pretending to run`() {
        val status = CatalogueCrawlUiPolicy.statusText(running, liveService = false)!!
        assertTrue(status.contains("توقّف"))
    }

    @Test
    fun `a finished crawl reports completion`() {
        val status = CatalogueCrawlUiPolicy.statusText(
            CatalogueCrawlState(finished = true, lastEvent = "اكتمل كل مصدر حتى نهايته"),
            liveService = false,
        )!!
        assertTrue(status.contains("اكتمل"))
    }

    @Test
    fun `an idle screen with nothing to say shows no status`() {
        assertEquals(null, CatalogueCrawlUiPolicy.statusText(CatalogueCrawlState(), liveService = false))
    }
}
