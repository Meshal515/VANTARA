package dev.vantara.runtime.cloudstream

import com.lagradost.cloudstream3.*
import com.lagradost.cloudstream3.utils.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class CloudStreamContractTest {
    private val source = object : MainAPI() { override var name = "VANTARA ABI Test"; override var mainUrl = "https://source.vantara.example" }
    @Test fun buildersPreserveOpaqueEpisodeDataAndInitializeRealModels() = runBlocking {
        val episode = source.newEpisode("opaque-not-url") { name = "الحلقة"; episode = 12; season = 2 }
        val loaded = source.newTvSeriesLoadResponse("عمل", "/work", TvType.TvSeries, listOf(episode)) { plot = "وصف"; tags = listOf("أكشن") }
        assertEquals("opaque-not-url", loaded.episodes.single().data)
        assertEquals("https://source.vantara.example/work", loaded.url)
        assertEquals("وصف", loaded.plot);assertEquals(listOf("أكشن"), loaded.tags)
    }
    @Test fun catalogueRowsAndPosterHeadersArePreserved() {
        val item = source.newAnimeSearchResponse("عمل", "/work", TvType.Anime) { posterUrl="https://cdn.vantara.example/a.jpg";posterHeaders=mapOf("Referer" to source.mainUrl) }
        val page = newHomePageResponse("جديد",listOf(item),true)
        assertEquals("عمل",page.items.single().list.single().name)
        assertEquals(source.mainUrl,page.items.single().list.single().posterHeaders!!["Referer"])
        assertTrue(page.hasNext)
    }
    @Test fun animeVariantsAndScoresKeepTheirMeaning() = runBlocking {
        val episode=source.newEpisode("data") { episode=1 }
        val anime=source.newAnimeLoadResponse("عمل","/anime",TvType.Anime) { addEpisodes(this,DubStatus.Subbed,listOf(episode));score=Score.from10(8.5f) }
        assertEquals("data",anime.episodes[DubStatus.Subbed]!!.single().data)
        assertEquals(85,anime.score!!.toInt(100))
    }
    @Test fun unimplementedOperationsFailExplicitlyRatherThanReturningEmptySuccess() = runBlocking {
        try { source.search("query");fail("Unsupported source operation must not look healthy") }
        catch(expected: UnsupportedOperationException) { assertTrue(expected.message!!.contains("search")) }
    }
    @Test fun qualityAndDirectLinkBuildersHaveRealSemantics() = runBlocking {
        val link=newExtractorLink("Provider","Server","https://media.vantara.example/a.m3u8",ExtractorLinkType.M3U8) { quality=getQualityFromName("4K 2160p");referer=this@CloudStreamContractTest.source.mainUrl }
        assertEquals(2160,link.quality);assertEquals(source.mainUrl,link.referer);assertEquals(ExtractorLinkType.M3U8,link.type)
    }
}
