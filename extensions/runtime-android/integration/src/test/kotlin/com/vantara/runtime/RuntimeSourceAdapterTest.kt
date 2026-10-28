package com.vantara.runtime

import com.vantara.anime.adapters.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class RuntimeSourceAdapterTest {
    private val id="addon|cs3|cs3_0123456789abcdef0123456789abcdef|provider"
    private val work=SourceAnime(id,"https://source.example/work","العمل")
    private fun objectOf(value: String)=RuntimeJson.parse(value).jsonObject
    @Test fun unknownEpisodeNumberIsNeverReplacedWithItsListPosition()=runBlocking {
        val adapter=RuntimeSourceAdapter(id,"Source") { _,_->objectOf("""{"items":[{"data":"opaque-A","name":"مقدمة"},{"data":"opaque-B","name":"الحلقة 12"}]}""") }
        val episodes=adapter.episodes(work)
        assertEquals(-1f,episodes[0].number);assertEquals(12f,episodes[1].number)
        assertEquals(listOf("opaque-A","opaque-B"),episodes.map { it.url })
    }
    @Test fun publishedEpisodeNumbersAndSeasonSelectionArePreserved()=runBlocking {
        val adapter=RuntimeSourceAdapter(id,"Source") { _,_->objectOf("""{"items":[{"data":"first","name":"One","episode":2,"season":1},{"data":"second","name":"Two","episode":2,"season":2}]}""") }
        try { adapter.episodes(work);fail("Mixed seasons without selection") }catch(expected:IllegalArgumentException){assertEquals("SEASON_SELECTION_REQUIRED",expected.message)}
        val episodes=adapter.episodes(work.copy(requestedSeason=2))
        assertEquals(1,episodes.size);assertEquals(2f,episodes.single().number);assertEquals("second",episodes.single().url)
    }
    @Test fun catalogueSectionsMapToExistingVantaraWorksWithoutDuplicatingUrls()=runBlocking {
        val adapter=RuntimeSourceAdapter(id,"Source") { operation,input->
            assertEquals("catalogue",operation);assertEquals(2,input.getValue("page").jsonPrimitive.int)
            objectOf("""{"items":[{"name":"A","list":[{"name":"عمل","url":"https://source.example/work","posterUrl":"https://images.example/cover.jpg"}]},{"name":"B","list":[{"name":"عمل","url":"https://source.example/work"}]}],"hasNext":true}""")
        }
        val page=adapter.page(Listing.POPULAR,2)
        assertEquals(1,page.items.size);assertEquals(id,page.items.single().sourceId);assertEquals("https://images.example/cover.jpg",page.items.single().thumbnail);assertTrue(page.hasNext)
    }
    @Test fun searchUsesTheProviderSearchOperationAndRetainsItsOpaqueWorkIdentity()=runBlocking {
        val adapter=RuntimeSourceAdapter(id,"Source") { operation,input->
            assertEquals("search",operation);assertEquals("query",input.text("query"))
            objectOf("""{"items":[{"name":"Found","url":"opaque-work-data"}],"hasNext":false}""")
        }
        assertEquals("opaque-work-data",adapter.page(Listing.SEARCH,1,"query").items.single().url)
    }
    @Test fun packageIdentitySurvivesVersionAndBinaryChangesButDiffersAcrossRepositories() {
        val first=RuntimeHost.packageId("https://repo.example/repo.json","Provider")
        assertEquals(first,RuntimeHost.packageId("https://repo.example/repo.json","Provider"))
        assertNotEquals(first,RuntimeHost.packageId("https://other.example/repo.json","Provider"))
        assertNotEquals(RuntimeHost.sourceId(first,"One"),RuntimeHost.sourceId(first,"Two"))
    }
    @Test fun excessiveJsonNestingIsRejectedBeforeRecursiveDecoder() {
        try{RuntimeJson.parse("[".repeat(33)+"0"+"]".repeat(33));fail("Accepted excessive nesting")}
        catch(expected:IllegalArgumentException){assertEquals("JSON_NESTING_LIMIT",expected.message)}
    }
    @Test fun bracesAndEscapedQuotesInsideJsonStringsAreNotNesting() {
        assertEquals("a{[\"b",RuntimeJson.parse("""{"value":"a{[\"b"}""").jsonObject.text("value"))
    }
}
