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

/** Actual published DEX -> optional app bridge host -> existing AnimeEngine adapters.
 * Authored offline HTTP fixtures, NOT a live-site, five-work, or real playback claim. */
class RuntimeAppIntegrationTest {
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
