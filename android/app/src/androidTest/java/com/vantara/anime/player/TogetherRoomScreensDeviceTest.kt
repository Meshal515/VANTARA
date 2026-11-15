package com.vantara.anime.player

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import com.vantara.anime.AnimeEngine
import com.vantara.anime.adapters.SourceAnime
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.PlaybackSession
import com.vantara.anime.stream.Preferences
import com.vantara.anime.stream.PreparedEpisode
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * لقطات حقيقية لغرفة «مشاهدة معًا» في مشغّل الـAPK (طلب المالك: صور التطبيق نفسه لا تصاميم):
 * الغرفة قبل اختيار السيرفر، وورقة السيرفرات بفلتري الجودة والمصدر (وقائمة مفتوحة)، وورقة الحلقات، والغرفة بعد التجهيز.
 * كود المشغّل والغرفة كما هو؛ المحقون فقط: جلسة تجهيز بسيرفرات تشير إلى فيديو محلي مملوك، وخادم غرفة محلي يرسل
 * الترحيب. الفن (خلفية العمل والشعار وصورة الحلقة) من مصادره الحقيقية على الشبكة.
 * اختياري (-e roomShots 1) لأنه توثيق تصميم.
 */
@RunWith(AndroidJUnit4::class)
class TogetherRoomScreensDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    @Test fun captureTogetherRoom() {
        assumeTrue("room screenshots are opt-in", InstrumentationRegistry.getArguments().getString("roomShots") == "1")
        val context = instrumentation.targetContext
        val out = File(context.filesDir, "player-shots").apply { mkdirs() }
        val video = File(context.filesDir, "room-shot.mp4")
        instrumentation.context.assets.open("addon-torrent-proof.mp4").use { input -> video.outputStream().use { input.copyTo(it) } }

        // خادم غرفة محلي: يرسل الترحيب (أنت المضيف، صديق مدعو لم يدخل)، ويرد على ping
        val server = MockWebServer()
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val now = System.currentTimeMillis().toDouble()
                webSocket.send(JSONObject()
                    .put("t", "welcome").put("you", "host").put("proto", 2).put("now", now)
                    .put("room", JSONObject().put("hostUserId", "host").put("mode", "sync").put("control", "host").put("invited", JSONArray().put("friend")))
                    .put("state", JSONObject().put("media", JSONObject().put("key", "anime:97940#2").put("kind", "anime").put("label", "Black Clover — الحلقة 2"))
                        .put("started", false).put("playing", false).put("pos", 0).put("at", now).put("rate", 1).put("seq", 0))
                    .put("roster", JSONArray().put(JSONObject().put("userId", "host").put("name", "أنت").put("host", true).put("state", "preparing").put("joinedAt", 1)))
                    .toString())
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                val m = JSONObject(text)
                if (m.optString("t") == "ping") webSocket.send(JSONObject().put("t", "pong").put("t0", m.opt("t0")).put("ts", System.currentTimeMillis()).toString())
            }
        }))
        server.start(java.net.InetAddress.getByName("127.0.0.1"), 0)

        // كما يفعل التطبيق عند الإقلاع (ومثل PlayerStartupDeviceTest): مكوّنات المحرك قبل استدعائه
        com.vantara.plugins.ensureEngineInjekt(context.applicationContext as android.app.Application)
        val engine = AnimeEngine.get(context)
        val now = System.currentTimeMillis()
        fun candidate(id: String, source: String, server: String, quality: Int, label: String) = Candidate(
            id = id, sourceId = source, sourceName = source, server = server, host = "local.fixture",
            url = Uri.fromFile(video).toString(), quality = quality, label = label, resolvedAt = now, expiresAt = now + 3_600_000,
        )
        val copies = listOf(SourceAnime(sourceId = "torrentio", url = "fixture://black-clover", title = "Black Clover"))
        val session = PlaybackSession(emptyList(), engine.health)
        val prep = PreparedEpisode(id = "room-shots", copies = copies, number = 2f, prefs = Preferences(), session = session, health = engine.health)
        prep.adopt("Torrentio", listOf(
            candidate("t1", "Torrentio", "Torrentio 1080p", 1080, "Black Clover S01E02 1080p · 853 MB · 👤 156"),
            candidate("t2", "Torrentio", "Torrentio 1080p HEVC", 1080, "Black Clover S01E02 HEVC · 180 MB · 👤 113"),
            candidate("t3", "Torrentio", "Torrentio 720p", 720, "Black Clover S01E02 720p · 420 MB · 👤 23"),
        ))
        prep.adopt("AnimeKai", listOf(candidate("k1", "AnimeKai", "MegaUp", 1080, "مترجم عربي")))
        prep.adopt("WitAnime", listOf(candidate("w1", "WitAnime", "StreamWish", 720, "مترجم عربي")))
        AnimeEngine::class.java.getDeclaredField("sessions").apply { isAccessible = true }.let {
            @Suppress("UNCHECKED_CAST") (it.get(engine) as MutableMap<String, PlaybackSession>)["room-shots"] = session
        }
        AnimeEngine::class.java.getDeclaredField("prepared").apply { isAccessible = true }.let {
            @Suppress("UNCHECKED_CAST") (it.get(engine) as MutableMap<String, PreparedEpisode>)["room-shots"] = prep
        }

        val together = JSONObject()
            .put("baseUrl", server.url("/").toString().trimEnd('/')).put("code", "SHOTS2").put("token", "fixture").put("mode", "sync")
            .put("mediaPrefix", "anime:97940").put("kindText", "أنمي").put("title", "Black Clover")
            .put("banner", "https://artworks.thetvdb.com/banners/series/331753/backgrounds/5f28da5d508c9.jpg")
            .put("logo", "https://images.metahub.space/logo/medium/tt7441658/img")
            .put("episodeImage", "https://artworks.thetvdb.com/banners/episodes/331753/6279072.jpg")
            .put("episodeTitle", "The Boys` Promise").put("pick", true)
            .put("invitees", JSONArray().put(JSONObject().put("userId", "friend").put("displayName", "صديق")))
        val launch = PlayerActivity.Launch(
            session = "room-shots", title = "Black Clover", episode = 2f, total = 170,
            copies = Json.encodeToString(ListSerializer(SourceAnime.serializer()), copies), together = together.toString(),
        )
        instrumentation.startActivitySync(PlayerActivity.intent(context, launch).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val activity = waitFor { resumed() as? PlayerActivity }

        fun shot(name: String, settle: Long = 900) {
            Thread.sleep(settle)
            val bitmap = instrumentation.uiAutomation.takeScreenshot() ?: return
            File(out, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        fun call(name: String) = instrumentation.runOnMainSync {
            PlayerActivity::class.java.getDeclaredMethod(name).apply { isAccessible = true }.invoke(activity)
        }
        fun field(name: String, value: Any?) = instrumentation.runOnMainSync {
            PlayerActivity::class.java.getDeclaredField(name).apply { isAccessible = true }.set(activity, value)
        }
        fun refreshSheet() = instrumentation.runOnMainSync {
            val sheet = PlayerActivity::class.java.getDeclaredField("sheet").apply { isAccessible = true }.get(activity)
            sheet.javaClass.getDeclaredMethod("refresh").apply { isAccessible = true }.invoke(sheet)
        }
        @Suppress("DEPRECATION") fun back() { instrumentation.runOnMainSync { activity.onBackPressed() }; Thread.sleep(500) }

        // الفن من الشبكة وحسم الشعار (حتى 1.2 ث) والاتصال بالغرفة
        val end = SystemClock.elapsedRealtime() + 8_000
        while (SystemClock.elapsedRealtime() < end) Thread.sleep(250)
        shot("room-01-pick")
        call("showServers"); shot("room-02-servers")
        field("serverMenu", "q"); refreshSheet(); shot("room-03-servers-quality-menu")
        field("serverMenu", null); field("serverSource", "Torrentio"); refreshSheet(); shot("room-04-servers-filtered")
        field("serverSource", null); back()
        call("showEpisodes"); shot("room-05-episodes"); back()
        // اختيار سيرفر: التجهيز ثم الجاهزية (البدء أزرق)
        instrumentation.runOnMainSync {
            val c = session.take("t1") ?: prep.candidate("t1")
            PlayerActivity::class.java.getDeclaredMethod("start", Candidate::class.java, Long::class.javaPrimitiveType, Boolean::class.javaPrimitiveType)
                .apply { isAccessible = true }.invoke(activity, c, 0L, false)
        }
        shot("room-06-preparing", 1200)
        shot("room-07-ready", 5000)
        instrumentation.runOnMainSync { activity.finish() }
        server.shutdown()
    }

    private fun resumed(): Activity? {
        var found: Activity? = null
        instrumentation.runOnMainSync { found = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).firstOrNull() }
        return found
    }

    private fun <T> waitFor(block: () -> T?): T {
        val end = System.currentTimeMillis() + 20_000
        while (System.currentTimeMillis() < end) { block()?.let { return it }; Thread.sleep(200) }
        error("لم يفتح المشغل")
    }
}
