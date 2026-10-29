package dev.vantara.runtime.cloudstream

import com.lagradost.cloudstream3.utils.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.After
import org.junit.Test

/** Sharing-page suffixes are not evidence of a direct media resource. */
class MediaHostCompatibilityTest {
    @After fun clear() = ExtractorRegistry.clear()
    private fun resolve(url:String):List<ExtractorLink> = runBlocking {
        val links=mutableListOf<ExtractorLink>()
        loadExtractor(url,"https://animewitcher.com",{},links::add)
        links
    }
    @Test fun officialPixeldrainShareAndApiFormsResolveToTheSameMediaEndpoint() {
        for(url in listOf("https://pixeldrain.com/u/AbCd1234","https://pixeldrain.com/api/file/AbCd1234")) {
            val link=resolve(url).single()
            assertEquals("https://pixeldrain.com/api/file/AbCd1234",link.url)
            assertEquals(ExtractorLinkType.VIDEO,link.type)
            assertEquals("https://animewitcher.com",link.referer)
        }
    }
    @Test fun aRegisteredExtractorOwnsItsHostEvenWhenTheSharingPageNameEndsInMp4() {
        ExtractorRegistry.add(object:ExtractorApi() {
            override val mainUrl="https://sharing.example"
            override suspend fun getUrl(url:String,referer:String?)=listOf(ExtractorLink("provider","provider","https://media.example/actual.m3u8",ExtractorLinkType.M3U8))
        })
        assertEquals("https://media.example/actual.m3u8",resolve("https://sharing.example/v/123/episode.mp4").single().url)
    }
    @Test fun streamtapeSharingPageIsNotPassedToThePlayerAsADirectMp4() {
        try { resolve("https://streamtape.com/v/1234/episode.mp4");fail("HTML sharing page was emitted as direct video") }
        catch(expected:UnsupportedExtractor){assertEquals("streamtape.com",expected.host)}
    }
    @Test fun pixeldrainLookalikesAndNonMediaApiPathsStayUnsupported() {
        for(url in listOf("https://pixeldrain.com.evil.example/u/AbCd1234","https://pixeldrain.com/api/file/AbCd1234/info","https://pixeldrain.com/u/AbCd1234?redirect=https://evil.example","https://pixeldrain.com/u/short")) {
            try { resolve(url);fail("Unsupported endpoint resolved: $url") } catch(expected:UnsupportedExtractor) { /* precise unsupported capability */ }
        }
    }
}
