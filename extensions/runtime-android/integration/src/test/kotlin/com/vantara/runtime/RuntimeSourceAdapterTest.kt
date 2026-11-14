package com.vantara.runtime

import com.vantara.anime.adapters.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class RuntimeSourceAdapterTest {
    /** Played as the original engine plays it: an http-only server is not rewritten to https (it would not answer). */
    @Test fun publicHttpMediaKeepsItsSchemeLikeTheOriginalEngine()=runBlocking {
        val adapter=RuntimeSourceAdapter(id,"Source") { _,_->objectOf("""{"items":[{"url":"http://media.example/video.mp4","quality":720,"headers":{"Referer":"https://source.example/watch"}}]}""") }
        val candidates=adapter.candidates(SourceEpisode(id,"episode","Episode",1f))
        assertEquals(1,candidates.size)
        assertEquals("http://media.example/video.mp4",candidates.single().url)
        assertEquals("https://source.example/watch",candidates.single().headers["Referer"])
    }
    /** Reference run (AnimeRift, hitwithanime/veldox 1080p): the provider attaches transport headers the original
     *  player ignores. They are dropped, never the link with them (it vanished from the sheet before). */
    @Test fun transportHeadersFromTheProviderAreDroppedNotTheLink()=runBlocking {
        val adapter=RuntimeSourceAdapter(id,"Source") { _,_->objectOf("""{"items":[{"url":"https://videos.cdn.example/1/ar_sub/1080p/v1/master.mp4","name":"CR2 [ar_sub] - 1080P","quality":1080,"type":"VIDEO",
            "headers":{"User-Agent":"libmpv","Accept":"*/*","Range":"bytes=0-","Connection":"close","Icy-MetaData":"1","Host":"videos.cdn.example"}}]}""") }
        val c=adapter.candidates(SourceEpisode(id,"episode","Episode",1f)).single()
        assertEquals("https://videos.cdn.example/1/ar_sub/1080p/v1/master.mp4",c.url)
        assertEquals("libmpv",c.headers["User-Agent"]); assertEquals("1",c.headers["Icy-MetaData"])
        assertTrue(c.headers.keys.none { it.lowercase() in setOf("host","connection","range") })
    }
    @Test fun aHeaderThatCouldInjectIsDroppedAndTheLinkKept()=runBlocking {
        val adapter=RuntimeSourceAdapter(id,"Source") { _,_->objectOf("""{"items":[{"url":"https://media.example/v.mp4","headers":{"X-Bad":"a\r\nX-Injected: 1","Bad Name":"x","Referer":"https://source.example/"}}]}""") }
        val c=adapter.candidates(SourceEpisode(id,"episode","Episode",1f)).single()
        assertEquals(mapOf("Referer" to "https://source.example/"),c.headers.filterKeys { it!="User-Agent" })
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
    /**
     * Protections stay: credentials in a link and local/private addresses never become media.
     * Owner policy (Nov 6): no refusal just for plain http or a non-443 port; the original CloudStream plays them and
     * reference round 1 shows real servers there (Akwam http://…downet.net, mp4upload https://…:183).
     */
    @Test fun credentialsAndPrivateAddressesNeverBecomeMediaButPublicHttpAndPortsDo()=runBlocking {
        val refused=RuntimeSourceAdapter(id,"Source") { _,_->objectOf("""{"items":[{"url":"http://user:secret@media.example/video.mp4"},{"url":"http://127.0.0.1/private.mp4"},{"url":"http://192.168.1.4/lan.mp4"},{"url":"http://nas.local/v.mp4"}]}""") }
        assertTrue(refused.candidates(SourceEpisode(id,"episode","Episode",1f)).isEmpty())
        val admitted=RuntimeSourceAdapter(id,"Source") { _,_->objectOf("""{"items":[{"url":"http://media.example/video.mp4"},{"url":"https://media.example:183/video.mp4"}]}""") }
        assertEquals(listOf("http://media.example/video.mp4","https://media.example:183/video.mp4"),admitted.candidates(SourceEpisode(id,"episode","Episode",1f)).map { it.url }.sorted())
    }
    /** The media policy itself, on every request of the media client too (redirects included). */
    @Test fun mediaPolicyKeepsProtectionsAndLeavesStremioUntouched() {
        for (bad in listOf("http://user:pass@cdn.example/v.mp4", "http://localhost/v.mp4", "http://nas.local/v.mp4", "http://192.168.1.10/v.mp4",
                "http://127.0.0.1:8080/v.mp4", "http://10.0.0.5/v.mp4", "http://[::1]/v.mp4", "ftp://cdn.example/v.mp4")) {
            assertTrue(bad, runCatching { com.vantara.addons.addonMediaUrl(bad, plain = true) }.isFailure)
        }
        assertEquals("93.184.216.34", com.vantara.addons.addonMediaUrl("http://93.184.216.34:8080/v.mp4", plain = true).host)
        assertEquals(183, com.vantara.addons.addonMediaUrl("https://a3.mp4upload.com:183/d/x.mp4", plain = true).port)
        // Remote Stremio addons keep https:443 exactly as before
        assertTrue(runCatching { com.vantara.addons.addonMediaUrl("http://cdn.example/v.mp4", plain = false) }.isFailure)
        assertTrue(runCatching { com.vantara.addons.addonMediaUrl("https://cdn.example:183/v.mp4", plain = false) }.isFailure)
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
    @Test fun serversNoRuntimeExtractorHandlesArePlayedThroughVantarasOwnResolver()=runBlocking {
        // The provider found the episode's server page (share-host style), but the runtime has no extractor for it.
        okhttp3.mockwebserver.MockWebServer().use { server ->
            server.enqueue(okhttp3.mockwebserver.MockResponse().setBody("""<html><script>var player={file:"https://media.example/stream/master.m3u8"};</script></html>"""))
            server.start()
            val embed=server.url("/embed/abc").toString()
            val resolver=com.vantara.anime.hosts.EmbedResolver(okhttp3.OkHttpClient())
            val adapter=RuntimeSourceAdapter(id,"Source",null,resolver) { _,_->
                objectOf("""{"items":[],"missingExtractors":["uqload.example"],"missingEmbeds":[{"url":"$embed","host":"uqload.example","referer":"https://source.example/ep1"}]}""")
            }
            val reports=mutableListOf<com.vantara.anime.stream.RouteReport>()
            val found=adapter.candidates(SourceEpisode(id,"episode","Episode",1f),trace=ResolveTrace { reports+=it })
            assertEquals("https://media.example/stream/master.m3u8",found.single().url)
            assertEquals("the server sheet sees it resolving, then ready",listOf(com.vantara.anime.stream.RouteState.RESOLVING,com.vantara.anime.stream.RouteState.READY),reports.map { it.state })
            assertEquals("the page that linked it is sent as the server expects","https://source.example/ep1",server.takeRequest().getHeader("Referer"))
        }
    }
    /**
     * CloudStream calls back once per server as each extractor finishes. A staged answer reaches the sheet as it
     * arrives: the first server is READY (and probed) while the slow one is still extracting, and the final list
     * carries the same ids, once each.
     */
    @Test fun aReadyServerReachesTheSheetBeforeTheSlowestOneFinishes()=runBlocking {
        val reports=mutableListOf<com.vantara.anime.stream.RouteReport>()
        var readyBeforeTheEnd=0
        val adapter=RuntimeSourceAdapter(id,"Source") { _,_->
            val stream=requireNotNull(kotlin.coroutines.coroutineContext[RuntimeLinkStream]) { "the adapter streams its call" }
            val fast=objectOf("""{"url":"https://fast.example/a.m3u8","name":"Fast","quality":1080,"type":"M3U8"}""")
            val slow=objectOf("""{"url":"https://slow.example/b.mp4","name":"Slow","quality":720,"type":"VIDEO"}""")
            stream.onStage(buildJsonObject { put("items",JsonArray(listOf(fast)));put("pending","t") })
            readyBeforeTheEnd=reports.count { it.state==com.vantara.anime.stream.RouteState.READY }
            stream.onStage(buildJsonObject { put("items",JsonArray(listOf(slow))) })
            buildJsonObject { put("items",JsonArray(listOf(fast,slow)));put("complete",true) }
        }
        val found=adapter.candidates(SourceEpisode(id,"episode","Episode",1f),trace=ResolveTrace { reports+=it })
        assertEquals("the first server is on the sheet before the operation ends",1,readyBeforeTheEnd)
        assertEquals(listOf("https://fast.example/a.m3u8","https://slow.example/b.mp4"),found.map { it.url })
        val reported=reports.filter { it.state==com.vantara.anime.stream.RouteState.READY }.flatMap { it.candidates }.map { it.id }.toSet()
        assertEquals("stages and the final list name every link by the same id",found.map { it.id }.toSet(),reported)
    }
    /** A server no runtime extractor handles starts in VANTARA's resolver when the worker names it, not at the end. */
    @Test fun aServerPageNamedInAnEarlyStageStartsResolvingBeforeTheOperationEnds()=runBlocking {
        okhttp3.mockwebserver.MockWebServer().use { server ->
            server.enqueue(okhttp3.mockwebserver.MockResponse().setBody("""<html><script>var player={file:"https://media.example/early/master.m3u8"};</script></html>"""))
            server.start()
            val embed=server.url("/embed/early").toString()
            val adapter=RuntimeSourceAdapter(id,"Source",null,com.vantara.anime.hosts.EmbedResolver(okhttp3.OkHttpClient())) { _,_->
                val stream=requireNotNull(kotlin.coroutines.coroutineContext[RuntimeLinkStream])
                val page=objectOf("""{"url":"$embed","host":"share.example"}""")
                stream.onStage(buildJsonObject { put("items",JsonArray(emptyList()));put("missingEmbeds",JsonArray(listOf(page)));put("pending","t") })
                // The worker is still extracting other servers: the page must already be requested.
                val asked=kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { server.takeRequest(5,java.util.concurrent.TimeUnit.SECONDS) }
                assertNotNull("resolution started while the operation was still running",asked)
                buildJsonObject { put("items",JsonArray(emptyList()));put("missingEmbeds",JsonArray(listOf(page)));put("complete",true) }
            }
            val found=adapter.candidates(SourceEpisode(id,"episode","Episode",1f))
            assertEquals("resolved once, though the final answer names it again",listOf("https://media.example/early/master.m3u8"),found.map { it.url })
            assertEquals(1,server.requestCount)
        }
    }
    @Test fun aServerVantaraCannotResolveEitherIsReportedWithItsReason()=runBlocking {
        okhttp3.mockwebserver.MockWebServer().use { server ->
            server.enqueue(okhttp3.mockwebserver.MockResponse().setBody("<html>nothing playable</html>"))
            server.start()
            val adapter=RuntimeSourceAdapter(id,"Source",null,com.vantara.anime.hosts.EmbedResolver(okhttp3.OkHttpClient())) { _,_->
                objectOf("""{"items":[],"missingEmbeds":[{"url":"${server.url("/e")}","host":"dead.example"}]}""")
            }
            val reports=mutableListOf<com.vantara.anime.stream.RouteReport>()
            assertTrue(adapter.candidates(SourceEpisode(id,"episode","Episode",1f),trace=ResolveTrace { reports+=it }).isEmpty())
            assertEquals(com.vantara.anime.stream.RouteState.UNAVAILABLE,reports.last().state)
            assertTrue(reports.last().reason!!.contains("dead.example"))
        }
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
    @Test fun theGeneralCardsSeasonHintOpensAMultiSeasonWorkInsteadOfDroppingTheSource()=runBlocking {
        // البطاقة العامة لا تسأل عن الموسم: كان المصدر كله يسقط (SEASON_SELECTION_REQUIRED) فلا يظهر له سيرفر
        val adapter=RuntimeSourceAdapter(id,"Source") { _,_->objectOf("""{"items":[{"data":"s1e3","name":"Three","episode":3,"season":1},{"data":"s2e3","name":"Three","episode":3,"season":2}]}""") }
        assertEquals(listOf("s1e3"),adapter.episodes(work.copy(seasonHint=1)).map { it.url })
        assertEquals(listOf("s2e3"),adapter.episodes(work.copy(seasonHint=2)).map { it.url })
        // اختيار المستخدم الصريح يغلب التلميح
        assertEquals(listOf("s2e3"),adapter.episodes(work.copy(seasonHint=1,requestedSeason=2)).map { it.url })
    }
    @Test fun aSeasonHintNeverFiltersASingleSeasonPage()=runBlocking {
        // صفحة «الموسم الثاني» المنفصلة يرقّم مصدرها حلقاتها موسمًا 1 أو بلا موسم: التلميح لا يفرّغها
        val adapter=RuntimeSourceAdapter(id,"Source") { _,_->objectOf("""{"items":[{"data":"e1","name":"One","episode":1,"season":1},{"data":"e2","name":"Two","episode":2}]}""") }
        assertEquals(listOf("e1","e2"),adapter.episodes(work.copy(seasonHint=2)).map { it.url })
    }
    @Test fun aHintForASeasonTheSourceDoesNotHaveStillAsksInsteadOfGuessing()=runBlocking {
        val adapter=RuntimeSourceAdapter(id,"Source") { _,_->objectOf("""{"items":[{"data":"a","episode":1,"season":1},{"data":"b","episode":1,"season":2}]}""") }
        try { adapter.episodes(work.copy(seasonHint=5));fail("Unknown hinted season must not pick a wrong season") }catch(expected:IllegalArgumentException){assertEquals("SEASON_SELECTION_REQUIRED",expected.message)}
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

    /** The source page shows the provider's own home sections, in its order, and asks for the chosen one only. */
    @Test fun providerSectionsAreItsOwnAndOneSectionIsAskedAlone()=runBlocking {
        val asked=mutableListOf<JsonObject>()
        val adapter=RuntimeSourceAdapter(id,"Source",mainPages=listOf("أفلام أجنبية","مسلسلات تركية")) { op,input -> asked+=input;assertEquals("catalogue",op)
            objectOf("""{"items":[{"name":"x","list":[{"url":"/w/1","name":"Work"}]}],"hasNext":true}""") }
        assertEquals(listOf(SourceSection("section:0","أفلام أجنبية"),SourceSection("section:1","مسلسلات تركية")),adapter.sections())
        val page=adapter.section(1,2)
        assertEquals(listOf("Work"),page.items.map { it.title });assertTrue(page.hasNext)
        assertEquals(1,asked.single()["section"]!!.jsonPrimitive.int);assertEquals(2,asked.single()["page"]!!.jsonPrimitive.int)
        assertEquals(emptyList<SourceSection>(),RuntimeSourceAdapter(id,"Source",mainPages=null) { _,_->error("no request") }.sections())
        assertEquals(listOf(SourceSection("section:0","الرئيسية")),RuntimeSourceAdapter(id,"Source") { _,_->error("no request") }.sections())
    }
}
