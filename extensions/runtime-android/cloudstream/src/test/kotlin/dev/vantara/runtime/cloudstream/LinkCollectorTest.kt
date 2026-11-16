package dev.vantara.runtime.cloudstream

import com.lagradost.cloudstream3.utils.ExtractorLink
import com.lagradost.cloudstream3.utils.ExtractorLinkType
import kotlinx.coroutines.delay
import org.junit.Assert.*
import org.junit.Test

class LinkCollectorTest {
    private fun link(n:Int)=ExtractorLink("server$n","server$n","https://media.example/$n.m3u8",ExtractorLinkType.M3U8)

    @Test fun linksFoundBeforeASlowServerAreReturnedWhenTheBudgetEnds() {
        val started=System.nanoTime()
        val exited=java.util.concurrent.CountDownLatch(1)
        val result=LinkCollector.collect(300){_,cb->
            try { cb(link(1));cb(link(2));delay(60_000);cb(link(3)) }
            finally { exited.countDown() }
        }
        assertEquals(listOf("https://media.example/1.m3u8","https://media.example/2.m3u8"),result.links.map{it.url})
        assertFalse(result.complete);assertNull(result.failure)
        assertTrue("waited past the budget",(System.nanoTime()-started)/1_000_000<5_000)
        assertTrue("Cooperative coroutine must be cancelled on timeout",exited.await(3,java.util.concurrent.TimeUnit.SECONDS))
    }
    @Test fun aProviderFailureAfterSomeLinksKeepsThoseLinks() {
        val result=LinkCollector.collect(5_000){_,cb->cb(link(1));error("third server crashed")}
        assertEquals(1,result.links.size);assertTrue(result.complete);assertEquals("third server crashed",result.failure?.message)
    }
    @Test fun hungProvidersAreBoundedAndTheirLateVideoCallbacksAreDiscarded() {
        val limiter=java.util.concurrent.Semaphore(2,true)
        val started=java.util.concurrent.CountDownLatch(2)
        val release=java.util.concurrent.CountDownLatch(1)
        val exited=java.util.concurrent.CountDownLatch(2)
        val results=java.util.Collections.synchronizedList(mutableListOf<LinkCollector.Result>())
        val callers=(1..2).map {
            Thread({
                results.add(LinkCollector.collectWithLimiter(200,limiter){_,cb->
                    cb(link(1))
                    started.countDown()
                    try {
                        // A deliberately non-cooperative provider: ignores interrupt on timeout.
                        while(release.count>0L) {
                            try {release.await()} catch(_:InterruptedException) {}
                        }
                        cb(link(2))
                    } finally {exited.countDown()}
                })
            },"hung-provider-caller-$it").apply{start()}
        }
        try {
            assertTrue("Both provider workers started",started.await(3,java.util.concurrent.TimeUnit.SECONDS))
            callers.forEach{it.join(2000)}
            assertEquals(2,results.size)
            assertTrue(results.all{it.links.size==1 && !it.complete})
            val denied=LinkCollector.collectWithLimiter(250,limiter){_,_->fail("Third hung provider must not start")}
            assertEquals("VIDEO_LINK_WORKER_BUSY",denied.failure?.message)
            assertFalse(denied.complete)
            assertTrue(denied.links.isEmpty())
        } finally {
            release.countDown()
            // Cleanup must never mask the original assertion: if one worker never started,
            // its finally block cannot decrement exited, and the primary failure tells why.
            exited.await(3,java.util.concurrent.TimeUnit.SECONDS)
            callers.forEach{it.join(2000)}
        }
        assertEquals("Late callbacks must not change returned results",listOf(1,1),results.map{it.links.size})
    }

    /** Staged: a ready server is handed over while a slow one is still extracting, each link once, then the end. */
    @Test fun aStagedCollectionHandsOverEachServerAsItFinishes() {
        val slowGo=java.util.concurrent.CountDownLatch(1)
        val live=requireNotNull(LinkCollector.startWithLimiter(5_000,java.util.concurrent.Semaphore(1)){_,cb->
            cb(link(1))
            while(slowGo.count>0L) delay(10)
            cb(link(2))
        })
        val started=System.nanoTime()
        val first=live.next(50)
        assertTrue("the first server does not wait for the slow one",(System.nanoTime()-started)/1_000_000<2_000)
        assertEquals(listOf("https://media.example/1.m3u8"),first.links.map{it.url});assertFalse(first.ended)
        slowGo.countDown()
        var rest=live.next(50)
        val later=rest.links.toMutableList()
        while(!rest.ended) { rest=live.next(50);later+=rest.links }
        assertEquals(listOf("https://media.example/2.m3u8"),later.map{it.url})
        assertTrue(rest.complete);assertEquals(2,rest.total)
    }
    /** The budget belongs to the collection: a host that stops asking cannot keep a provider running. */
    @Test fun anAbandonedStagedCollectionStillEndsAtItsBudget() {
        val limiter=java.util.concurrent.Semaphore(1)
        val exited=java.util.concurrent.CountDownLatch(1)
        requireNotNull(LinkCollector.startWithLimiter(200,limiter){_,cb-> try { cb(link(1));delay(60_000) } finally { exited.countDown() } })
        assertTrue("cancelled at its deadline with nobody waiting",exited.await(3,java.util.concurrent.TimeUnit.SECONDS))
        assertTrue("its provider slot is free again",limiter.tryAcquire(2,java.util.concurrent.TimeUnit.SECONDS))
    }

    @Test fun aFastProviderCompletesWithAllItsLinks() {
        val result=LinkCollector.collect(5_000){_,cb->repeat(3){cb(link(it))}}
        assertEquals(3,result.links.size);assertTrue(result.complete);assertNull(result.failure)
    }
}
