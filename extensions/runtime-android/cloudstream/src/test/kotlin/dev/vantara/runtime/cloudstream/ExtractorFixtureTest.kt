package dev.vantara.runtime.cloudstream

import com.lagradost.cloudstream3.utils.ExtractorLink
import com.lagradost.cloudstream3.utils.ExtractorLinkType
import com.lagradost.cloudstream3.utils.loadExtractor
import dev.vantara.runtime.cloudstream.extractors.PlayerPage
import dev.vantara.runtime.cloudstream.extractors.Streamtape
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.*
import org.junit.Test

/** Offline fixtures shaped like each host's embed page. Live behaviour is checked separately by LiveExtractorProbeTest. */
class ExtractorFixtureTest {
    @After fun reset(){NetworkBridge.reset();WorkerState.takeMissingExtractors();WorkerState.takeMissingSamples()}
    private fun serve(pages:Map<String,String>) = NetworkBridge.install{request,_->
        val body=pages.entries.firstOrNull{request.url.toString().startsWith(it.key)}?.value
        Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(if(body==null)404 else 200).message("")
            .body((body?:"").toResponseBody("text/html".toMediaType())).build()
    }
    private fun resolve(url:String):List<ExtractorLink> = runBlocking{mutableListOf<ExtractorLink>().also{loadExtractor(url,"https://site.example/",{},it::add)}}

    @Test fun streamtapeUsesTheRobotlinkAssignmentAndIgnoresDecoys() {
        val html="""<script>document.getElementById('ideoolink').innerHTML = '//streamtape.com/get_video?id=decoy' + ('xyzabc').substring(2);
            document.getElementById('robotlink').innerHTML = '//streamtape.com/get_video?id=AbC&expires=1&ip=x&token=' + ('xcdTOKEN9').substring(1).substring(2);</script>"""
        assertEquals("https://streamtape.com/get_video?id=AbC&expires=1&ip=x&token=TOKEN9",Streamtape.videoAddress(html))
        serve(mapOf("https://streamtape.com/e/AbC" to html))
        val link=resolve("https://streamtape.com/v/AbC/episode.mp4").single()
        assertEquals("https://streamtape.com/get_video?id=AbC&expires=1&ip=x&token=TOKEN9&stream=1",link.url);assertEquals(ExtractorLinkType.VIDEO,link.type)
    }
    @Test fun doodReadsThePassEndpointAndBuildsTheTokenisedAddress() {
        serve(mapOf("https://playmogo.com/e/abc123" to "<script>\$.get('/pass_md5/9-1-2/tok3n', function(d){})</script>",
            "https://playmogo.com/pass_md5/9-1-2/tok3n" to "https://cdn.example/stream/xyz~"))
        val link=resolve("https://playmogo.com/d/abc123").single()
        assertTrue(link.url,Regex("""https://cdn\.example/stream/xyz~[A-Za-z0-9]{10}\?token=tok3n&expiry=\d+""").matches(link.url))
        assertEquals("https://playmogo.com/",link.referer)
    }
    @Test fun registeredPlayerHostResolvesThroughLoadExtractorAndOtherHostsDoNot() {
        val page="""<script>jwplayer("v").setup({sources:[{file:"https://cdn.example/hls/master.m3u8"}],image:"https://cdn.example/poster.jpg"});</script>"""
        serve(mapOf("https://vidmoly.org/embed-abc.html" to page,"https://unknown-host.example/embed-abc.html" to page))
        val link=resolve("https://vidmoly.org/embed-abc.html").single()
        assertEquals("https://cdn.example/hls/master.m3u8",link.url);assertEquals(ExtractorLinkType.M3U8,link.type)
        assertEquals("https://vidmoly.org/",link.referer)
        // A host outside the verified list is never parsed as a player page
        assertTrue(resolve("https://unknown-host.example/embed-abc.html").isEmpty())
    }
    @Test fun playerPageReadsPackedJwPlayerSourcesButNotAdvertFiles() {
        val packed="eval(function(p,a,c,k,e,d){while(c--)if(k[c])p=p.replace(new RegExp('\\\\b'+c.toString(a)+'\\\\b','g'),k[c]);return p}('0.1({2:[{3:\"4://5.6/7.8\"}]});',9,9,'jwplayer|setup|sources|file|https|cdn|example|master|m3u8'.split('|')))"
        val html="<a href=\"https://ads.example/promo.mp4\">ad</a><script>$packed</script>"
        val text=PlayerPage.scripts(html)
        assertEquals(listOf("https://cdn.example/master.m3u8"),PlayerPage.mediaUrls(text,"https://host.example/e/1"))
    }
    @Test fun playerPageResolvesProtocolRelativeAndEscapedAddresses() {
        assertEquals(listOf("https://cdn.example/v.mp4"),PlayerPage.mediaUrls("""sources:[{src:"\/\/cdn.example\/v.mp4",type:"video/mp4"}]""".replace("\\/","/").let{"""{file:"//cdn.example/v.mp4"}"""},"https://host.example/e/1"))
    }
}
