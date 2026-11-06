package com.vantara.runtime

import com.vantara.anime.adapters.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class RuntimeSourceAdapterTest {
    @Test fun publicHttpMediaIsUpgradedToTlsBeforeSharedMediaAdmission()=runBlocking {
        val adapter=RuntimeSourceAdapter(id,"Source") { _,_->objectOf("""{"items":[{"url":"http://media.example/video.mp4","quality":720,"headers":{"Referer":"https://source.example/watch"}}]}""") }
        val candidates=adapter.candidates(SourceEpisode(id,"episode","Episode",1f))
        assertEquals(1,candidates.size)
        assertEquals("https://media.example/video.mp4",candidates.single().url)
        assertEquals("https://source.example/watch",candidates.single().headers["Referer"])
    }
    @Test fun extractedRuntimeCandidatesReportRoutesSoNativePreparationCanProbeThem()=runBlocking {
        val adapter=RuntimeSourceAdapter(id,"Source") { _,_->objectOf("""{"items":[{"url":"https://media.example/master.m3u8","name":"CDN","quality":720,"type":"M3U8","referer":"https://source.example/watch"}]}""") }
        val health=com.vantara.anime.health.HealthStore(null)
        val prep=com.vantara.anime.stream.PreparedEpisode("runtime",listOf(work),1f,
            com.vantara.anime.stream.Preferences(),com.vantara.anime.stream.PlaybackSession(emptyList(),health),health,probe=true)
        val toProbe=mutableListOf<com.vantara.anime.stream.Candidate>()
        val returned=adapter.candidates(SourceEpisode(id,"opaque-episode","Episode",1f),trace=ResolveTrace { report ->
            prep.report(report)
            if(report.state==com.vantara.anime.stream.RouteState.READY)toProbe+=report.candidates
        })
        assertEquals("Native preparation probes route callbacks, not the returned extraction list",returned,toProbe)
        assertEquals(returned.single().id,prep.candidatesOf(prep.routes().single().id).single().id)
        assertNull("Extracted media still needs an actual probe",prep.best())
        val candidate=toProbe.single()
        prep.markProbe(requireNotNull(prep.routeOf(candidate.id)).id,true,1,candidate.id)
        assertEquals(candidate.id,prep.best()?.id)
        assertEquals("https://source.example/watch",candidate.headers["Referer"])
    }
    @Test fun httpCredentialsAndNonstandardPortsNeverBecomePermittedMedia()=runBlocking {
        val adapter=RuntimeSourceAdapter(id,"Source") { _,_->objectOf("""{"items":[{"url":"http://user:secret@media.example/video.mp4"},{"url":"http://media.example:8080/video.mp4"},{"url":"http://127.0.0.1/private.mp4"}]}""") }
        assertTrue(adapter.candidates(SourceEpisode(id,"episode","Episode",1f)).isEmpty())
    }
    @Test fun revokedRuntimeSourceCannotReturnPreviouslyCachedEpisodes()=runBlocking {
        val dir=kotlin.io.path.createTempDirectory("runtime-episodes-").toFile()
        try {
            var active: AnimeAdapter?=RuntimeSourceAdapter(id,"Source") { _,_->objectOf("""{"items":[{"data":"private-episode-token","episode":1}]}""") }
            val resolver=com.vantara.anime.episodes.EpisodeResolver({ active },com.vantara.anime.health.HealthStore(java.io.File(dir,"health.json")))
            val copy=com.vantara.anime.episodes.EpisodeResolver.Copy(id,work)
            assertEquals(1,resolver.episodes(copy).size);active=null
            assertTrue("Removed/disabled runtime adapter leaked its previous cached episodes",resolver.episodes(copy).isEmpty())
        }finally{dir.deleteRecursively()}
    }
    @Test fun duplicateRegisteredSourceNamesAreRejectedBeforeActivation() {
        val validator=runCatching { Class.forName("com.vantara.runtime.RuntimeRegistration") }.getOrNull()
        assertNotNull("Registration must validate identities before writing an installed record",validator)
        val method=validator!!.getMethod("validate",JsonObject::class.java,String::class.java)
        val duplicate=objectOf("""{"sources":[{"name":"Repeated","mainUrl":"https://source.example"},{"name":"Repeated","mainUrl":"https://source.example"}]}""")
        try { method.invoke(null,duplicate,"cs3_0123456789abcdef0123456789abcdef");fail("Ambiguous source names admitted") }
        catch(expected:java.lang.reflect.InvocationTargetException){assertEquals("DUPLICATE_SOURCE_ID",expected.targetException.message)}
    }
    private val id="addon|cs3|cs3_0123456789abcdef0123456789abcdef|provider"
    private val work=SourceAnime(id,"https://source.example/work","العمل")
    private fun objectOf(value: String)=RuntimeJson.parse(value).jsonObject
    @Test fun linksWithoutAnAgentPlayWithTheBrowserAgentTheProviderUsedAsCloudStreamsPlayerDoes()=runBlocking {
        val browser="Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36"
        val adapter=RuntimeSourceAdapter(id,"Source",browser) { _,_->objectOf("""{"items":[{"url":"https://media.example/a.mp4","referer":"https://source.example/"},{"url":"https://media.example/b.mp4","headers":{"user-agent":"Provider/1.0"}}]}""") }
        val byUrl=adapter.candidates(SourceEpisode(id,"episode","Episode",1f)).associateBy { it.url }
        assertEquals(browser,byUrl.getValue("https://media.example/a.mp4").headers["User-Agent"])
        assertEquals("A provider's own agent is kept","Provider/1.0",byUrl.getValue("https://media.example/b.mp4").headers.entries.first { it.key.equals("User-Agent",true) }.value)
    }
    @Test fun detailsThenEpisodesCostsOneProviderLoadLikeCloudStream()=runBlocking {
        val calls=mutableListOf<String>()
        val adapter=RuntimeSourceAdapter(id,"Source") { operation,_->
            calls+=operation
            objectOf("""{"item":{"name":"Work","url":"https://source.example/work","episodes":{"Subbed":[{"data":"one","episode":1},{"data":"two","episode":2}]}}}""")
        }
        adapter.details(work)
        assertEquals(listOf("one","two"),adapter.episodes(work).map { it.url })
        assertEquals("episodes after a fresh details answer must not run load() again in a new worker",listOf("details"),calls)
        val movie=RuntimeSourceAdapter(id,"Source") { operation,_->
            calls+=operation
            objectOf("""{"item":{"name":"Film","url":"https://source.example/film","dataUrl":"film-links"}}""")
        }
        calls.clear();movie.details(work)
        assertEquals(listOf("film-links"),movie.episodes(work).map { it.url })
        assertEquals(listOf("details"),calls)
    }
    @Test fun aRefreshAfterTheFirstEpisodesListAsksTheProviderAgain()=runBlocking {
        val calls=mutableListOf<String>()
        val adapter=RuntimeSourceAdapter(id,"Source") { operation,_->
            calls+=operation
            if(operation=="details") objectOf("""{"item":{"name":"Work","url":"https://source.example/work","episodes":[{"data":"one","episode":1}]}}""")
            else objectOf("""{"items":[{"data":"one","episode":1},{"data":"two","episode":2}]}""")
        }
        adapter.details(work)
        assertEquals(1,adapter.episodes(work).size)
        assertEquals("a newly published episode appears on refresh",2,adapter.episodes(work).size)
        assertEquals(listOf("details","episodes"),calls)
    }
    @Test fun episodesWithoutRecentDetailsStillAskTheProvider()=runBlocking {
        val calls=mutableListOf<String>()
        val adapter=RuntimeSourceAdapter(id,"Source") { operation,_->calls+=operation;objectOf("""{"items":[{"data":"one","episode":1}]}""") }
        assertEquals(1,adapter.episodes(work).size)
        assertEquals(listOf("episodes"),calls)
    }
    @Test fun selectedSeasonDetailsDoNotRequestSeasonSelectionAgain()=runBlocking {
        val adapter=RuntimeSourceAdapter(id,"Source") { _,_->objectOf("""{"item":{"name":"Work","url":"https://source.example/work","episodes":{"Subbed":[{"data":"one","season":1},{"data":"two","season":2}]}}}""") }
        assertFalse(adapter.details(work.copy(requestedSeason=2,seasonNumber=2.0)).hasSeasons)
    }
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
        assertEquals(RuntimeHost.sourceId(first,"One","account-a"),RuntimeHost.sourceId(first,"One","account-a"))
        assertNotEquals(RuntimeHost.sourceId(first,"One","account-a"),RuntimeHost.sourceId(first,"One","account-b"))
    }
    @Test fun excessiveJsonNestingIsRejectedBeforeRecursiveDecoder() {
        try{RuntimeJson.parse("[".repeat(33)+"0"+"]".repeat(33));fail("Accepted excessive nesting")}
        catch(expected:IllegalArgumentException){assertEquals("JSON_NESTING_LIMIT",expected.message)}
    }
    @Test fun bracesAndEscapedQuotesInsideJsonStringsAreNotNesting() {
        assertEquals("a{[\"b",RuntimeJson.parse("""{"value":"a{[\"b"}""").jsonObject.text("value"))
    }
}
