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
        val result=LinkCollector.collect(300){_,cb->cb(link(1));cb(link(2));delay(60_000);cb(link(3))}
        assertEquals(listOf("https://media.example/1.m3u8","https://media.example/2.m3u8"),result.links.map{it.url})
        assertFalse(result.complete);assertNull(result.failure)
        assertTrue("waited past the budget",(System.nanoTime()-started)/1_000_000<5_000)
    }
    @Test fun aProviderFailureAfterSomeLinksKeepsThoseLinks() {
        val result=LinkCollector.collect(5_000){_,cb->cb(link(1));error("third server crashed")}
        assertEquals(1,result.links.size);assertTrue(result.complete);assertEquals("third server crashed",result.failure?.message)
    }
    @Test fun aFastProviderCompletesWithAllItsLinks() {
        val result=LinkCollector.collect(5_000){_,cb->repeat(3){cb(link(it))}}
        assertEquals(3,result.links.size);assertTrue(result.complete);assertNull(result.failure)
    }
}
