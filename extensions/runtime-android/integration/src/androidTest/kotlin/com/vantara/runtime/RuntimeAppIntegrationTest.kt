package com.vantara.runtime

import android.app.Application
import androidx.test.platform.app.InstrumentationRegistry
import com.vantara.anime.AnimeEngine
import com.vantara.anime.adapters.Listing
import com.vantara.plugins.ensureEngineInjekt
import dev.vantara.runtime.android.AndroidRuntimeClient
import dev.vantara.runtime.api.RuntimeHttpAccess
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import android.webkit.WebView
import android.webkit.CookieManager
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.util.concurrent.atomic.AtomicReference

/** Published DEX -> app host -> existing AnimeEngine adapters. Offline fixtures
 * and the explicitly named live metadata journey are separate. Neither proves playback. */
class RuntimeAppIntegrationTest {
    @Test fun witcherSettingsRotationReplaysOnceAndRevokesLearnedPermissions()=runBlocking {
        val ins=InstrumentationRegistry.getInstrumentation();val context=ins.targetContext
        ensureEngineInjekt(context.applicationContext as Application);val engine=AnimeEngine.get(context)
        val scopes=java.util.concurrent.CopyOnWriteArrayList<Set<String>>()
        val replacement="https://tvnesh8ozy-dsn.algolia.net"
        val factory:(AndroidRuntimeClient.Scope,dev.vantara.runtime.http.HttpBroker)->AndroidRuntimeClient.HostHttpTransport={scope,_->
            scopes.add(scope.allowedOrigins())
            object:AndroidRuntimeClient.HostHttpTransport {
                override fun exchange(caller:AndroidRuntimeClient.Scope,r:RuntimeHttpAccess.Request):RuntimeHttpAccess.Response {
                    val uri=java.net.URI(r.url());var code=200
                    val data=when(uri.host) {
                        "d8lh9i7zl7-dsn.algolia.net"->{code=403;"""{"message":"old application settings"}"""}
                        "firestore.googleapis.com"->{
                            when {
                                uri.path.endsWith("/Settings/constants")->"""{"fields":{"search_settings":{"mapValue":{"fields":{"app_id_v3":{"stringValue":"TVNESH8OZY"},"api_key":{"stringValue":"authored-key"}}}}}}"""
                                uri.path.endsWith("/episodes_summery/summery")->"""{"fields":{"episodes":{"arrayValue":{"values":[{"mapValue":{"fields":{"doc_id":{"stringValue":"ep-1"},"name":{"stringValue":"Episode 1"},"number":{"integerValue":"1"}}}}]}}}}"""
                                uri.path.endsWith("/servers2/all_servers")->"""{"fields":{"servers":{"arrayValue":{"values":[{"mapValue":{"fields":{"name":{"stringValue":"PD"},"quality":{"stringValue":"480p"},"link":{"stringValue":"https://pixeldrain.com/u/AbCd1234"}}}}]}}}}"""
                                uri.path.contains("/Settings/servers/servers/")->"""{"fields":{}}"""
                                else->error("Unexpected offline Firestore document")
                            }
                        }
                        "pixeldrain.com"->{assertTrue(scope.allowedOrigins().contains("https://pixeldrain.com"));"""<html><meta property="og:video" content="https://pixeldrain.com/api/file/AbCd1234"></html>"""}
                        "tvnesh8ozy-dsn.algolia.net"->{
                            assertTrue(scope.allowedOrigins().contains(replacement))
                            assertEquals("TVNESH8OZY",r.headers()["X-Algolia-Application-Id"]?.single())
                            assertEquals("authored-key",r.headers()["X-Algolia-API-Key"]?.single())
                            """{"hits":[{"objectID":"work-1","anime_id":"work-1","name":"Rotated offline work","poster_uri":"https://images.example/poster.jpg"}]}"""
                        }
                        else->error("Unattested offline origin")
                    }
                    return RuntimeHttpAccess.Response(r.url(),code,mapOf("Content-Type" to listOf("application/json")),data.toByteArray())
                }
            }
        }
        val host=RuntimeHost(context,engine,"VANTARA compatibility test",sourceTransport=factory)
        val archive=File.createTempFile("witcher-settings-",".cs3",context.cacheDir)
        val account="settings-"+UUID.randomUUID()
        try {
            host.setProfile(account)
            ins.context.assets.open("Animewitcher.cs3").use { input->archive.outputStream().use { input.copyTo(it) } }
            val pin=ins.context.assets.open("Animewitcher.json").bufferedReader().use { RuntimeJson.parse(it.readText()).jsonObject }
            val pkg=RuntimeHost.packageId("https://repo.example/settings","Animewitcher")
            val installed=host.installFile(archive,pin.text("packageSha256"),pkg,buildJsonObject { put("internalName","Animewitcher");put("version",3);put("content","anime");put("enabled",true) })
            val id=installed.getValue("sourceIds").jsonArray.single().jsonPrimitive.content
            assertEquals("Rotated offline work",engine.adapter(id)!!.page(Listing.POPULAR,1).items.single().title)
            assertEquals(2,scopes.size);assertFalse(scopes[0].contains(replacement));assertTrue(scopes[1].contains(replacement))
            assertFalse("Stale bootstrap permission remained after source migration",scopes[1].contains("https://d8lh9i7zl7-dsn.algolia.net"))
            assertEquals(1,engine.adapter(id)!!.page(Listing.SEARCH,1,"work").items.size)
            assertEquals("Attested origins should avoid a second permission replay",3,scopes.size)
            host.enable(pkg,false);host.enable(pkg,true)
            engine.adapter(id)!!.page(Listing.POPULAR,1)
            assertEquals(5,scopes.size);assertFalse(scopes[3].contains(replacement));assertTrue(scopes[4].contains(replacement))
            host.setProfile(account+"-other");host.setProfile(account)
            engine.adapter(id)!!.page(Listing.POPULAR,1)
            assertEquals(7,scopes.size);assertFalse(scopes[5].contains(replacement))
            val work=engine.adapter(id)!!.page(Listing.POPULAR,1).items.single()
            val episode=engine.adapter(id)!!.episodes(work).single()
            val beforeMedia=scopes.size
            assertEquals("https://pixeldrain.com/api/file/AbCd1234",engine.adapter(id)!!.candidates(episode).single().url)
            assertEquals(beforeMedia+2,scopes.size);assertFalse(scopes[beforeMedia].contains("https://pixeldrain.com"));assertTrue(scopes[beforeMedia+1].contains("https://pixeldrain.com"))
            assertEquals("https://pixeldrain.com/api/file/AbCd1234",engine.adapter(id)!!.candidates(episode).single().url)
            assertEquals(beforeMedia+3,scopes.size)
            host.enable(pkg,false);host.enable(pkg,true)
            val beforeRevoked=scopes.size
            assertEquals("https://pixeldrain.com/api/file/AbCd1234",engine.adapter(id)!!.candidates(episode).single().url)
            assertEquals(beforeRevoked+2,scopes.size);assertFalse(scopes[beforeRevoked].contains("https://pixeldrain.com"))
        }finally{host.close();archive.delete();engine.setRuntimeSources(emptyList())}
    }
    @androidx.annotation.OptIn(markerClass=[androidx.media3.common.util.UnstableApi::class])
    @Test fun witcherLiveEpisodeRunsInTheExistingPlayerWithSustainedClockAndBothSeeks():Unit=runBlocking {
        val ins=InstrumentationRegistry.getInstrumentation();val context=ins.targetContext
        ensureEngineInjekt(context.applicationContext as Application);val engine=AnimeEngine.get(context)
        val host=RuntimeHost(context,engine,"VANTARA live playback validation")
        val archive=File.createTempFile("witcher-playback-",".cs3",context.cacheDir)
        val sessionId="live-player-"+UUID.randomUUID()
        var activity:com.vantara.anime.player.PlayerActivity?=null
        try {
            host.setProfile("live-playback-"+UUID.randomUUID())
            ins.context.assets.open("Animewitcher.cs3").use { input->archive.outputStream().use { input.copyTo(it) } }
            val pin=ins.context.assets.open("Animewitcher.json").bufferedReader().use { RuntimeJson.parse(it.readText()).jsonObject }
            val installed=host.installFile(archive,pin.text("packageSha256"),RuntimeHost.packageId("https://repo.example/live-playback","Animewitcher"),buildJsonObject { put("internalName","Animewitcher");put("version",3);put("content","anime");put("enabled",true) })
            val id=installed.getValue("sourceIds").jsonArray.single().jsonPrimitive.content
            val adapter=engine.adapter(id)!!;val work=adapter.page(Listing.POPULAR,1).items.first();val episode=adapter.episodes(work).first()
            val candidates=adapter.candidates(episode).filter { java.net.URI(it.url).host=="pixeldrain.com" }
            assertTrue("Live episode has no supported media candidate",candidates.isNotEmpty())
            // Real candidates produced by the installed package; only the session
            // fixture is registered here. Production player/network stay untouched.
            val sessionsField=AnimeEngine::class.java.getDeclaredField("sessions").apply { isAccessible=true }
            @Suppress("UNCHECKED_CAST")
            val sessions=sessionsField.get(engine) as MutableMap<String,com.vantara.anime.stream.PlaybackSession>
            sessions[sessionId]=com.vantara.anime.stream.PlaybackSession(candidates,engine.health)
            val launch=com.vantara.anime.player.PlayerActivity.Launch(session=sessionId,title=work.title,episode=episode.number,candidate=candidates.last().id)
            activity=ins.startActivitySync(com.vantara.anime.player.PlayerActivity.intent(context,launch).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) as com.vantara.anime.player.PlayerActivity
            val playerField=com.vantara.anime.player.PlayerActivity::class.java.getDeclaredField("player").apply { isAccessible=true }
            val player=playerField.get(activity) as androidx.media3.exoplayer.ExoPlayer
            fun <T> onMain(read:()->T):T { val value=AtomicReference<T>();ins.runOnMainSync { value.set(read()) };return value.get() }
            fun awaitPosition(target:Long,upper:Long=Long.MAX_VALUE) {
                val deadline=android.os.SystemClock.elapsedRealtime()+30000
                while(android.os.SystemClock.elapsedRealtime()<deadline) {
                    val error=onMain { player.playerError?.errorCodeName };assertNull("Production player reported $error",error)
                    if(onMain { player.isPlaying && player.currentPosition in target..upper })return
                    Thread.sleep(100)
                }
                fail("Production video clock did not reach $target ms")
            }
            onMain { player.volume=0f };awaitPosition(1000)
            val start=onMain { player.currentPosition };val began=android.os.SystemClock.elapsedRealtime()
            val framesAtStart=onMain { player.videoDecoderCounters?.renderedOutputBufferCount ?: 0 }
            val droppedAtStart=onMain { player.videoDecoderCounters?.droppedBufferCount ?: 0 }
            while(android.os.SystemClock.elapsedRealtime()-began<30000) {
                assertNull(onMain { player.playerError?.errorCodeName });Thread.sleep(200)
            }
            val advanced=onMain { player.currentPosition }-start
            assertTrue("Video clock lagged real time: $advanced ms",advanced>=25000)
            val rendered=onMain { player.videoDecoderCounters?.renderedOutputBufferCount ?: 0 }-framesAtStart
            val dropped=onMain { player.videoDecoderCounters?.droppedBufferCount ?: 0 }-droppedAtStart
            assertTrue("No sustained decoded video frames",rendered>=200)
            assertTrue("Excessive dropped frames: $dropped/$rendered",dropped*10<=rendered+dropped)
            val forward=onMain { player.currentPosition+60000 };onMain { player.seekTo(forward) };awaitPosition(forward+1000,forward+5000)
            val backward=(forward-30000).coerceAtLeast(0);onMain { player.seekTo(backward) };awaitPosition(backward+1000,backward+5000)
            val dimensions=onMain { "${player.videoFormat?.width}x${player.videoFormat?.height}" }
            android.util.Log.i("VantaraRuntime","LIVE_WITCHER_PLAYER:existing Activity/transport; elapsed=30000; advanced=$advanced; rendered=$rendered; dropped=$dropped; dimensions=$dimensions; forward/backward passed")
        }finally {
            activity?.let { current->ins.runOnMainSync { current.finish() } }
            engine.closeSession(sessionId);host.close();archive.delete();engine.setRuntimeSources(emptyList())
        }
    }
    @Test fun witcherLiveCatalogueSearchDetailsAndEpisodesForFiveWorks()=runBlocking {
        val ins=InstrumentationRegistry.getInstrumentation();val context=ins.targetContext
        ensureEngineInjekt(context.applicationContext as Application);val engine=AnimeEngine.get(context)
        val host=RuntimeHost(context,engine,"VANTARA live compatibility validation")
        val archive=File.createTempFile("witcher-live-",".cs3",context.cacheDir)
        try {
            host.setProfile("live-witcher-"+UUID.randomUUID())
            ins.context.assets.open("Animewitcher.cs3").use { input->archive.outputStream().use { input.copyTo(it) } }
            val pin=ins.context.assets.open("Animewitcher.json").bufferedReader().use { RuntimeJson.parse(it.readText()).jsonObject }
            val installed=host.installFile(archive,pin.text("packageSha256"),RuntimeHost.packageId("https://repo.example/live-witcher","Animewitcher"),buildJsonObject { put("internalName","Animewitcher");put("version",3);put("content","anime");put("enabled",true) })
            val id=installed.getValue("sourceIds").jsonArray.single().jsonPrimitive.content
            val adapter=engine.adapter(id)!!
            val works=adapter.page(Listing.POPULAR,1).items.distinctBy { java.net.URI(it.url).path }.take(5)
            assertEquals("Live catalogue did not contain five distinct works",5,works.size)
            for((index,work) in works.withIndex()) {
                assertEquals(id,work.sourceId)
                val found=adapter.page(Listing.SEARCH,1,work.title).items
                assertTrue("Live search did not return the selected work",found.any { java.net.URI(it.url).path==java.net.URI(work.url).path })
                val detail=adapter.details(work);assertEquals(id,detail.sourceId);assertTrue(detail.title.isNotBlank())
                val episodes=adapter.episodes(work);assertTrue("Live work returned no episodes",episodes.isNotEmpty());assertTrue(episodes.all { it.sourceId==id && it.url.isNotBlank() })
                android.util.Log.i("VantaraRuntime","LIVE_WITCHER_WORK_${index+1}:catalogue/search/details/episodes passed; episodes=${episodes.size}; playback=NOT_TESTED")
            }
        }finally{host.close();archive.delete();engine.setRuntimeSources(emptyList())}
    }
    @Test fun witcherPublishedPackageTraversesFiveOfflineWorksThroughActualAppAdapter()=runBlocking {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val context=instrumentation.targetContext
        ensureEngineInjekt(context.applicationContext as Application)
        val engine=AnimeEngine.get(context)
        val seen=java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
        fun scalar(value:String)=buildJsonObject { put("stringValue",value) }
        fun fields(value:JsonObject)=buildJsonObject { put("fields",value) }
        fun arrayField(value:JsonObject)=buildJsonObject { put("arrayValue",buildJsonObject { put("values",JsonArray(listOf(buildJsonObject { put("mapValue",fields(value)) }))) }) }
        fun item(n:Int)=buildJsonObject {
            put("objectID","work-$n");put("anime_id","work-$n");put("name","VANTARA Offline Work $n")
            put("doc_ref","anime_list/work-$n");put("poster_uri","https://images.example/work-$n.jpg");put("story","Offline plot $n")
        }
        val host=RuntimeHost(context,engine,"VANTARA offline compatibility test",sourceTransport={scope,_->
            assertEquals(setOf("https://animewitcher.com","https://d8lh9i7zl7-dsn.algolia.net","https://firestore.googleapis.com"),scope.allowedOrigins())
            object:AndroidRuntimeClient.HostHttpTransport {
                override fun exchange(caller:AndroidRuntimeClient.Scope,r:RuntimeHttpAccess.Request):RuntimeHttpAccess.Response {
                    val url=java.net.URI(r.url());seen.add(url.host)
                    val response=when(url.host) {
                        "d8lh9i7zl7-dsn.algolia.net"->{
                            assertEquals("POST",r.method())
                            val params=RuntimeJson.parse(r.body()!!.decodeToString()).jsonObject.text("params")
                            val selected=Regex("work-([1-5])").find(params)?.groupValues?.get(1)?.toInt()
                            buildJsonObject { put("hits",JsonArray((selected?.let { listOf(it) } ?: (1..5).toList()).map(::item))) }
                        }
                        "firestore.googleapis.com"->{
                            val n=Regex("anime_list/work-([1-5])/").find(url.path)?.groupValues?.get(1)?.toInt()
                            when {
                                url.path.endsWith("/episodes_summery/summery")->fields(buildJsonObject { put("episodes",arrayField(buildJsonObject { put("doc_id",scalar("ep-$n"));put("name",scalar("الحلقة $n"));put("number",buildJsonObject { put("integerValue",n.toString()) }) })) })
                                url.path.endsWith("/servers2/all_servers")->fields(buildJsonObject { put("servers",arrayField(buildJsonObject { put("name",scalar("MF"));put("quality",scalar("1080p"));put("link",scalar("https://media.fixture.example/work-$n.mp4")) })) })
                                url.path.contains("/Settings/servers/servers/")->fields(buildJsonObject {})
                                else->error("Unexpected offline Firestore request: ${url.path}")
                            }
                        }
                        else->error("Unexpected offline origin: ${url.host}")
                    }
                    return RuntimeHttpAccess.Response(r.url(),200,mapOf("Content-Type" to listOf("application/json")),response.toString().toByteArray())
                }
            }
        })
        val archive=File.createTempFile("witcher-app-",".cs3",context.cacheDir)
        try {
            host.setProfile("witcher-offline-"+UUID.randomUUID())
            instrumentation.context.assets.open("Animewitcher.cs3").use { input->archive.outputStream().use { input.copyTo(it) } }
            val pin=instrumentation.context.assets.open("Animewitcher.json").bufferedReader().use { RuntimeJson.parse(it.readText()).jsonObject }
            val metadata=buildJsonObject { put("internalName","Animewitcher");put("version",3);put("repoName","Offline fixture repository");put("repoUrl","https://repo.example/witcher");put("content","anime");put("enabled",true) }
            val installed=host.installFile(archive,pin.text("packageSha256"),RuntimeHost.packageId("https://repo.example/witcher","Animewitcher"),metadata)
            assertTrue("Registration emitted source traffic",seen.isEmpty())
            val id=installed.getValue("sourceIds").jsonArray.single().jsonPrimitive.content
            val adapter=engine.adapter(id)!!
            val works=adapter.page(Listing.POPULAR,1).items
            assertEquals(5,works.size);assertEquals(5,works.map { it.url }.distinct().size)
            for(n in 1..5) {
                val work=works.single { it.title=="VANTARA Offline Work $n" }
                assertTrue(adapter.page(Listing.SEARCH,1,"work-$n").items.any { it.title==work.title })
                assertEquals("Offline plot $n",adapter.details(work).description)
                val episode=adapter.episodes(work).single();assertEquals(n.toFloat(),episode.number)
                assertEquals("work-$n|ep-$n",episode.url)
                assertEquals("https://media.fixture.example/work-$n.mp4",adapter.candidates(episode).single().url)
            }
            assertEquals(setOf("d8lh9i7zl7-dsn.algolia.net","firestore.googleapis.com"),seen)
        }finally{host.close();archive.delete();engine.setRuntimeSources(emptyList())}
    }
    @Test fun riftPublisherRestrictionPreventsSourceTrafficAfterActualInstallation()=runBlocking {
        val instrumentation=InstrumentationRegistry.getInstrumentation();val context=instrumentation.targetContext
        ensureEngineInjekt(context.applicationContext as Application);val engine=AnimeEngine.get(context);val calls=AtomicInteger()
        val host=RuntimeHost(context,engine,"VANTARA offline restriction test",sourceTransport={_,_->calls.incrementAndGet();error("Restricted source transport must not be created")})
        val archive=File.createTempFile("rift-app-",".cs3",context.cacheDir)
        try {
            host.setProfile("rift-offline-"+UUID.randomUUID())
            instrumentation.context.assets.open("AnimeRift.cs3").use { input->archive.outputStream().use { input.copyTo(it) } }
            val pin=instrumentation.context.assets.open("AnimeRift.json").bufferedReader().use { RuntimeJson.parse(it.readText()).jsonObject }
            val installed=host.installFile(archive,pin.text("packageSha256"),RuntimeHost.packageId("https://repo.example/rift","AnimeRift"),buildJsonObject { put("internalName","AnimeRift");put("content","anime");put("enabled",true) })
            val id=installed.getValue("sourceIds").jsonArray.single().jsonPrimitive.content
            assertNull("Restricted source was exposed by the public engine router",engine.adapter(id))
            // Even a retained direct binding must not bypass the public router's denial.
            try { engine.runtimeSource(id)!!.adapter.page(Listing.POPULAR,1);fail("Restricted source emitted traffic") }
            catch(expected:IllegalStateException){assertEquals("SOURCE_NETWORK_REVIEW_REQUIRED",expected.message)}
            assertEquals(0,calls.get())
        }finally{host.close();archive.delete();engine.setRuntimeSources(emptyList())}
    }
    @Test fun browserVerificationProfilesKeepAccountCookiesSeparateAndReusable() {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val context=instrumentation.targetContext
        val suffix=UUID.randomUUID().toString()
        val profiles=listOf("runtime_"+RuntimeHost.digest("one-$suffix"),"runtime_"+RuntimeHost.digest("two-$suffix"))
        val cookieName="vantara_scope_"+RuntimeHost.digest(suffix).take(12)
        val views=mutableListOf<WebView>();val jars=mutableListOf<CookieManager>()
        val failure=AtomicReference<Throwable>();val accepted=AtomicInteger();val callbacks=CountDownLatch(2)
        instrumentation.runOnMainSync {
            try {
                check(WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) { "Required verification profile support unavailable on this runner" }
                for(index in profiles.indices) {
                    val view=WebView(context);views.add(view);WebViewCompat.setProfile(view,profiles[index])
                    val jar=WebViewCompat.getProfile(view).cookieManager;jars.add(jar)
                    jar.setCookie("https://profile-fixture.example/","$cookieName=account-$index; Path=/; Max-Age=60; Secure") { ok -> if(ok)accepted.incrementAndGet();callbacks.countDown() }
                }
            }catch(error:Throwable){failure.set(error)}
        }
        try {
            failure.get()?.let { throw AssertionError("Verification profile setup failed",it) }
            assertTrue(callbacks.await(5,TimeUnit.SECONDS));assertEquals(2,accepted.get())
            instrumentation.runOnMainSync {
                try {
                    assertTrue(jars[0].getCookie("https://profile-fixture.example/").contains("$cookieName=account-0"))
                    assertTrue(jars[1].getCookie("https://profile-fixture.example/").contains("$cookieName=account-1"))
                    assertFalse(CookieManager.getInstance().getCookie("https://profile-fixture.example/").orEmpty().contains(cookieName))
                    val restored=WebView(context);views.add(restored);WebViewCompat.setProfile(restored,profiles[0])
                    assertTrue(WebViewCompat.getProfile(restored).cookieManager.getCookie("https://profile-fixture.example/").contains("$cookieName=account-0"))
                }catch(error:Throwable){failure.set(error)}
            }
            failure.get()?.let { throw AssertionError("Verification profile isolation failed",it) }
        }finally { instrumentation.runOnMainSync { views.forEach { it.destroy() } } }
    }
    companion object {
        const val ORIGIN="https://w1.anime4up.rest"
        val HTML="<!doctype html><html><head><title>VANTARA offline catalogue</title></head><body>"+
        "<div class='main-widget'><div class='main-didget-head'><h3>أحدث الأعمال</h3></div>"+
        "<section class='themexblock anime-card-container'><a class='image' href='/anime/vantara-test/'><img src='https://images.example/poster.jpg'></a>"+
        "<div class='anime-grid'><div class='anime-card-themex'><div class='anime-card-title'><h3><a href='/anime/vantara-test/'>VANTARA Offline Test</a></h3></div>"+
        "<div class='anime-thumbnail'><a href='/anime/vantara-test/'><img src='https://images.example/poster.jpg' data-src='https://images.example/poster.jpg'></a></div>"+
        "<div class='anime-card-type'>TV</div></div></div></section></div></body></html>"
        val DETAIL="<!doctype html><html><head><title>VANTARA Offline Test</title></head><body>"+
        "<h1 class='anime-details-title'>VANTARA Offline Test</h1><div class='anime-thumbnail'><img src='https://images.example/poster.jpg'></div>"+
        "<p class='anime-story'>وصف مصدر اختباري</p><div class='anime-info'>2026</div><ul class='anime-genres'><li><a>Action</a></li></ul>"+
        "<div id='episodesList'><div class='themexblock'><a href='"+ORIGIN+"/episode/vantara-test-1/'>الحلقة 1</a><div class='badge light-soft'><span>الحلقة 1</span></div></div></div>"+
        "<ul class='all-episodes-list'><li><a href='"+ORIGIN+"/episode/vantara-test-1/'>الحلقة 1</a></li></ul></body></html>"
        val EPISODE="<!doctype html><html><head><title>VANTARA test episode</title></head><body>"+
        "<div class='anime-page-link'><a href='"+ORIGIN+"/anime/vantara-test/'>VANTARA Offline Test</a></div>"+
        "<ul class='all-episodes-list'><li><a href='"+ORIGIN+"/episode/vantara-test-1/'>الحلقة 1</a></li></ul>"+
        "<div class='download-list'><table class='table'><tbody><tr><td>1080p</td><td class='td-link'><a href='https://video.fixture.example/direct.mp4'>Direct</a></td></tr></tbody></table></div></body></html>"
    }
    @Test fun publishedPackageUsesActualAppCatalogueAndKeepsAccountsAndDisabledStateAcrossReload()=runBlocking {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val context=instrumentation.targetContext
        ensureEngineInjekt(context.applicationContext as Application)
        val engine=AnimeEngine.get(context)
        val calls=AtomicInteger()
        val blockNext=AtomicBoolean(false)
        val entered=CountDownLatch(1);val release=CountDownLatch(1)
        val factory: (AndroidRuntimeClient.Scope,dev.vantara.runtime.http.HttpBroker)->AndroidRuntimeClient.HostHttpTransport={ _,_ ->
            if(blockNext.compareAndSet(true,false)) { entered.countDown();check(release.await(5,TimeUnit.SECONDS)) { "TEST_FACTORY_RELEASE_TIMEOUT" } }
            object: AndroidRuntimeClient.HostHttpTransport {
                override fun exchange(scope: AndroidRuntimeClient.Scope,request: RuntimeHttpAccess.Request): RuntimeHttpAccess.Response {
                    calls.incrementAndGet();assertTrue(request.url().startsWith(ORIGIN+"/"))
                    val html=if(request.url().contains("/episode/"))EPISODE else if(request.url().contains("/anime/vantara-test/"))DETAIL else HTML
                    return RuntimeHttpAccess.Response(request.url(),200,mapOf("Content-Type" to listOf("text/html; charset=utf-8")),html.toByteArray())
                }
            }
        }
        val host=RuntimeHost(context,engine,"VANTARA native integration test",sourceTransport=factory)
        val account="runtime-acceptance-"+UUID.randomUUID()
        host.setProfile(account)
        val archive=File.createTempFile("published-app-",".cs3",context.cacheDir)
        try {
            instrumentation.context.assets.open("Anime4up.cs3").use { input -> archive.outputStream().use { input.copyTo(it) } }
            val pin=instrumentation.context.assets.open("Anime4up.json").bufferedReader().use { RuntimeJson.parse(it.readText()).jsonObject }
            val repo="https://repo.example/unique-repo.json"
            val pkg=RuntimeHost.packageId(repo,"Anime4up")
            val metadata=buildJsonObject { put("internalName","Anime4up");put("name","Anime4up");put("repoUrl",repo);put("repoName","Authored fixture repository");put("content","anime");put("enabled",true) }
            val installed=host.installFile(archive,pin.text("packageSha256"),pkg,metadata)
            assertEquals("No source HTTP is permitted during registration",0,calls.get())
            val id=installed.getValue("sourceIds").jsonArray.single().jsonPrimitive.content
            val adapter=engine.adapter(id) ?: error("Actual source not bound to existing AnimeEngine")
            val page=adapter.page(Listing.POPULAR,1)
            assertTrue(page.items.any { it.title=="VANTARA Offline Test" })
            val work=page.items.single { it.title=="VANTARA Offline Test" }
            assertEquals("وصف مصدر اختباري",adapter.details(work).description)
            val episodes=adapter.episodes(work)
            assertEquals(1,episodes.size);assertEquals(1f,episodes.single().number)
            assertEquals("https://video.fixture.example/direct.mp4",adapter.candidates(episodes.single()).first().url)
            assertTrue(calls.get()>=4)
            host.enable(pkg,false);assertNull(engine.adapter(id))
            // Reinstall/update must preserve an existing user's disabled setting.
            host.installFile(archive,pin.text("packageSha256"),pkg,metadata)
            assertFalse(host.list().getValue("installed").jsonArray.single().jsonObject.getValue("enabled").jsonPrimitive.boolean)
            host.close()
            val next=RuntimeHost(context,engine,"VANTARA native integration test",sourceTransport=factory)
            next.setProfile(account)
            assertNull(engine.adapter(id));assertEquals(pkg,next.list().getValue("installed").jsonArray.single().jsonObject.text("pkg"))
            next.enable(pkg,true);assertNotNull(engine.adapter(id))
            val selected=engine.adapter(id)!!
            val before=calls.get();blockNext.set(true)
            val deferred=async(Dispatchers.IO) { runCatching { selected.page(Listing.POPULAR,1) } }
            assertTrue("Invocation did not reach the pre-worker registration boundary",entered.await(5,TimeUnit.SECONDS))
            next.setProfile(account+"-new")
            release.countDown()
            assertTrue(deferred.await().isFailure)
            assertEquals("A revoked account emitted HTTP from a late worker",before,calls.get())
            assertTrue(next.list().getValue("installed").jsonArray.isEmpty());assertNull(engine.adapter(id))
            try { adapter.page(Listing.POPULAR,1);fail("Old profile adapter retained access") } catch(expected:IllegalStateException) { assertEquals("PROFILE_CHANGED",expected.message) }
            next.setProfile(account);assertNotNull(engine.adapter(id))
            next.uninstall(pkg);assertNull(engine.adapter(id));assertTrue(next.list().getValue("installed").jsonArray.isEmpty())
            next.close()
        }finally { host.close();archive.delete();engine.setRuntimeSources(emptyList()) }
    }
}
