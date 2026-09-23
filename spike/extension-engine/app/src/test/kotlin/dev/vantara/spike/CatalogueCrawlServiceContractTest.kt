package dev.vantara.spike

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * عقد الخدمة الذي لا يحتاج جهازًا.
 *
 * السؤال: هل تُطلق ضغطتان زحفين؟ وهل تعود خدمةٌ أعاد أندرويد إنشاءها إلى زحفها
 * بدل أن تنسى أنه كان جاريًا؟
 */
class CatalogueCrawlServiceContractTest {

    @After
    fun releaseGate() {
        // البوابة على مستوى العملية؛ اختبارٌ يتركها مأخوذة يُفسد ما بعده
        CatalogueCrawlExecutionGate.release()
    }

    @Test
    fun `the first start acquires the gate`() {
        assertTrue(CatalogueCrawlExecutionGate.tryAcquire())
        assertTrue(CatalogueCrawlExecutionGate.isRunning())
    }

    @Test
    fun `a second start while running is refused`() {
        assertTrue(CatalogueCrawlExecutionGate.tryAcquire())
        assertFalse(CatalogueCrawlExecutionGate.tryAcquire())
    }

    @Test
    fun `release lets a later run start`() {
        assertTrue(CatalogueCrawlExecutionGate.tryAcquire())
        CatalogueCrawlExecutionGate.release()

        assertFalse(CatalogueCrawlExecutionGate.isRunning())
        assertTrue(CatalogueCrawlExecutionGate.tryAcquire())
    }

    @Test
    fun `only one of many simultaneous starts wins`() {
        // الضغط السريع المتكرّر على الزر هو الحالة الحقيقية لا النظرية
        val pool = Executors.newFixedThreadPool(8)
        val go = CountDownLatch(1)
        val winners = AtomicInteger()
        repeat(32) {
            pool.execute {
                go.await()
                if (CatalogueCrawlExecutionGate.tryAcquire()) winners.incrementAndGet()
            }
        }
        go.countDown()
        pool.shutdown()
        assertTrue(pool.awaitTermination(10, TimeUnit.SECONDS))

        assertEquals(1, winners.get())
    }

    @Test
    fun `a recreated service resumes a crawl the durable state says was running`() {
        // أندرويد قتل العملية: البوابة فارغة، والحالة الدائمة تقول «كان يجري»
        val decision = CatalogueCrawlServiceContract.onRecreated(durableActive = true)
        assertEquals(CatalogueCrawlServiceContract.Recreated.RESUME, decision)
    }

    @Test
    fun `a recreated service with no running crawl stops itself`() {
        val decision = CatalogueCrawlServiceContract.onRecreated(durableActive = false)
        assertEquals(CatalogueCrawlServiceContract.Recreated.STOP_SELF, decision)
    }

    @Test
    fun `android's six hour limit tells the user how to continue`() {
        // أندرويد ١٥ يوقف dataSync بعد ست ساعات في اليوم؛ فتح التطبيق يصفّر العدّاد
        val text = CatalogueCrawlServiceContract.stopMessage(CatalogueCrawlServiceContract.StopReason.SYSTEM_TIME_LIMIT)
        assertTrue(text.contains("افتح التطبيق"))
        assertTrue(text.contains("استأنف"))
    }

    @Test
    fun `a refused start does not pretend to run`() {
        val text = CatalogueCrawlServiceContract.stopMessage(CatalogueCrawlServiceContract.StopReason.START_NOT_ALLOWED)
        assertTrue(text.contains("استأنف"))
    }

    @Test
    fun `every stop reason keeps the collected works`() {
        CatalogueCrawlServiceContract.StopReason.values().forEach { reason ->
            assertTrue(reason.name, CatalogueCrawlServiceContract.stopMessage(reason).contains("محفوظ"))
        }
    }

    @Test
    fun `start and stop actions are distinct and namespaced`() {
        assertTrue(CatalogueCrawlServiceContract.ACTION_START.startsWith("dev.vantara.spike."))
        assertTrue(CatalogueCrawlServiceContract.ACTION_STOP.startsWith("dev.vantara.spike."))
        assertFalse(CatalogueCrawlServiceContract.ACTION_START == CatalogueCrawlServiceContract.ACTION_STOP)
    }
}
