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
import org.junit.Assert.assertTrue
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
                    .put("state", JSONObject().put("media", JSONObject().put("key", "anime:20958#1").put("kind", "anime").put("label", "Attack on Titan Season 2 — الحلقة 1"))
                        .put("started", false).put("playing", false).put("pos", 0).put("at", now).put("rate", 1).put("seq", 0))
                    .put("roster", JSONArray().put(JSONObject().put("userId", "host").put("name", "أنت").put("host", true).put("state", "preparing").put("joinedAt", 1)))
                    .toString())
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                val m = JSONObject(text)
                if (m.optString("t") == "ping") webSocket.send(JSONObject().put("t", "pong").put("t0", m.opt("t0")).put("ts", System.currentTimeMillis()).toString())
                // مثل RoomCore: أمر load من المضيف يُبثّ حالة جديدة للغرفة كلها (seq أعلى)
                if (m.optString("t") == "cmd" && m.optString("op") == "load") webSocket.send(JSONObject().put("t", "state").put("by", "host")
                    .put("state", JSONObject().put("media", m.optJSONObject("media")).put("started", false).put("playing", false).put("pos", 0)
                        .put("at", System.currentTimeMillis().toDouble()).put("rate", 1).put("seq", 1)).toString())
            }
        }))
        server.start(java.net.InetAddress.getByName("127.0.0.1"), 0)

        // كما يفعل التطبيق عند الإقلاع (ومثل PlayerStartupDeviceTest): مكوّنات المحرك قبل استدعائه
        com.vantara.plugins.ensureEngineInjekt(context.applicationContext as android.app.Application)
        val engine = AnimeEngine.get(context)
        val now = System.currentTimeMillis()
        fun candidate(id: String, source: String, server: String, quality: Int, label: String, url: String = Uri.fromFile(video).toString()) = Candidate(
            id = id, sourceId = source, sourceName = source, server = server, host = "local.fixture",
            url = url, quality = quality, label = label, resolvedAt = now, expiresAt = now + 3_600_000,
        )
        val copies = listOf(SourceAnime(sourceId = "torrentio", url = "fixture://attack-on-titan-s2", title = "Attack on Titan Season 2"))
        val session = PlaybackSession(emptyList(), engine.health)
        val prep = PreparedEpisode(id = "room-shots", copies = copies, number = 1f, prefs = Preferences(), session = session, health = engine.health)
        // تورنت حقيقي الشكل (vantara-torrent:) لقسم «تورنت» ومؤشر السرب؛ لا يُشغَّل في الاختبار (لا تذكرة مسجّلة)
        prep.adopt("Torrentio", listOf(
            candidate("t2", "Torrentio", "Torrentio 1080p", 1080, "Attack on Titan S02E01 1080p · 1.1 GB · 👤 212", "vantara-torrent://fixture-a/0"),
            candidate("t3", "Torrentio", "Torrentio 720p", 720, "Attack on Titan S02E01 720p · 540 MB · 👤 7", "vantara-torrent://fixture-b/0"),
        ))
        prep.allowRuntimeCandidate("t2"); prep.allowRuntimeCandidate("t3")
        prep.adopt("AnimeKai", listOf(candidate("t1", "AnimeKai", "MegaUp", 1080, "مترجم عربي"), candidate("k2", "AnimeKai", "MegaUp 720p", 720, "مترجم عربي")))
        prep.adopt("WitAnime", listOf(candidate("w1", "WitAnime", "StreamWish", 720, "مترجم عربي")))
        AnimeEngine::class.java.getDeclaredField("sessions").apply { isAccessible = true }.let {
            @Suppress("UNCHECKED_CAST") (it.get(engine) as MutableMap<String, PlaybackSession>)["room-shots"] = session
        }
        AnimeEngine::class.java.getDeclaredField("prepared").apply { isAccessible = true }.let {
            @Suppress("UNCHECKED_CAST") (it.get(engine) as MutableMap<String, PreparedEpisode>)["room-shots"] = prep
        }

        val together = JSONObject()
            .put("baseUrl", server.url("/").toString().trimEnd('/')).put("code", "SHOTS2").put("token", "fixture").put("mode", "sync")
            .put("mediaPrefix", "anime:20958").put("kindText", "أنمي").put("title", "Attack on Titan Season 2")
            .put("banner", "https://artworks.thetvdb.com/banners/series/267440/backgrounds/5f8611eaa79ff.jpg")
            .put("logo", "https://images.metahub.space/logo/medium/tt2560140/img")
            .put("episodeImage", "https://artworks.thetvdb.com/banners/episodes/267440/5978808.jpg")
            .put("episodeTitle", "Beast Titan").put("rating", "8.7").put("ratingSource", "IMDb").put("duration", "24 دقيقة").put("pick", true)
            .put("invitees", JSONArray().put(JSONObject().put("userId", "friend").put("displayName", "صديق")))
        val launch = PlayerActivity.Launch(
            session = "room-shots", title = "Attack on Titan Season 2", animeId = "20958", episode = 1f, total = 12,
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
        // تقطيع الورقة: سيرفرات تصل تباعًا أثناء انزلاقها (كما في الواقع). أطول فجوة بين إطارين تُسجَّل
        val gaps = java.util.concurrent.CopyOnWriteArrayList<Long>()
        var lastFrame = 0L
        var measuring = true
        val tickFrame = object : android.view.Choreographer.FrameCallback {
            override fun doFrame(t: Long) { if (lastFrame > 0) gaps += (t - lastFrame) / 1_000_000; lastFrame = t; if (measuring) android.view.Choreographer.getInstance().postFrameCallback(this) }
        }
        instrumentation.runOnMainSync { android.view.Choreographer.getInstance().postFrameCallback(tickFrame) }
        Thread.sleep(300); gaps.clear()
        call("showServers")
        for (i in 1..6) { Thread.sleep(60); prep.adopt("Late$i", listOf(candidate("late$i", "Late$i", "Late $i", 720, "مترجم عربي"))) }
        Thread.sleep(900)
        measuring = false
        File(out, "room-02-sheet-frames.txt").writeText("frames=${gaps.size} maxGapMs=${gaps.maxOrNull()} over50ms=${gaps.count { it > 50 }} gaps=${gaps.joinToString(",")}")
        shot("room-02-servers")
        field("serverMenu", "q"); refreshSheet(); shot("room-03-servers-quality-menu")
        field("serverMenu", null); field("serverSource", "Torrentio"); refreshSheet(); shot("room-04-servers-filtered")
        field("serverSource", null); refreshSheet(); instrumentation.runOnMainSync { PlayerActivity::class.java.getDeclaredField("sheet").apply { isAccessible = true }.get(activity).let { it.javaClass.getDeclaredMethod("scrollTo", Int::class.javaPrimitiveType).apply { isAccessible = true }.invoke(it, 10_000) } }; shot("room-04b-servers-bottom")
        field("serverSource", null); back()
        call("showEpisodes"); shot("room-05-episodes", 6000); back() // ani.zip ثم الصور: وقت للشبكة قبل اللقطة
        // اختيار سيرفر: التجهيز ثم الجاهزية (البدء أزرق)
        instrumentation.runOnMainSync {
            val c = session.take("t1") ?: prep.candidate("t1")
            PlayerActivity::class.java.getDeclaredMethod("start", Candidate::class.java, Long::class.javaPrimitiveType, Boolean::class.javaPrimitiveType)
                .apply { isAccessible = true }.invoke(activity, c, 0L, false)
        }
        shot("room-06-preparing", 1200)
        shot("room-07-ready", 5000)

        // المواسم (طلب المالك): «الحلقات» ← زر «الموسم» المنسدل بسلسلة AniList الحقيقية ← المضيف يختار موسمًا آخر
        val events = java.util.concurrent.CopyOnWriteArrayList<Pair<String, JSONObject>>()
        PlaybackEvents.events = { name, data -> events += name to data }
        call("showEpisodes")
        val seasonsBy = SystemClock.elapsedRealtime() + 20_000
        fun seasonCount(): Int { var n = 0; instrumentation.runOnMainSync {
            n = (PlayerActivity::class.java.getDeclaredField("seasons").apply { isAccessible = true }.get(activity) as? List<*>)?.size ?: -1 }; return n }
        while (SystemClock.elapsedRealtime() < seasonsBy && seasonCount() < 0) Thread.sleep(250)
        assertTrue("سلسلة المواسم من AniList (${seasonCount()})", seasonCount() >= 3)
        shot("room-08-episodes-season-button", 1500)
        // ضغطة حقيقية على زر «الموسم» (لا تعديل حقل): نفس مسار المستخدم
        instrumentation.runOnMainSync {
            val found = ArrayList<android.view.View>()
            activity.window.decorView.findViewsWithText(found, "الموسم: ", android.view.View.FIND_VIEWS_WITH_CONTENT_DESCRIPTION)
            found.firstOrNull { it.isClickable }?.performClick()
        }
        shot("room-09-seasons-menu", 1200)
        var option: android.view.View? = null
        instrumentation.runOnMainSync {
            val found = ArrayList<android.view.View>()
            activity.window.decorView.findViewsWithText(found, "الموسم 3", android.view.View.FIND_VIEWS_WITH_CONTENT_DESCRIPTION)
            option = found.firstOrNull { it.isClickable }
            option?.performClick()
        }
        assertTrue("خيار «الموسم 3» موجود في القائمة", option != null)
        val movedBy = SystemClock.elapsedRealtime() + 8_000
        while (SystemClock.elapsedRealtime() < movedBy && events.none { it.first == "togetherWork" }) Thread.sleep(150)
        val moved = events.firstOrNull { it.first == "togetherWork" }?.second
        PlaybackEvents.events = null
        assertTrue("الغرفة انتقلت لموسم آخر وأُبلغت الواجهة ($moved)", moved != null && moved.optString("code") == "SHOTS2" &&
            moved.optString("key").startsWith("anime:") && moved.optString("key").endsWith("#1") && !moved.optString("key").startsWith("anime:20958#"))
        File(out, "room-10-season-switch.txt").writeText(moved.toString())
        Thread.sleep(800)
        assertTrue("المشغّل أُغلق لتفتح الواجهة غرفة الموسم الجديد", activity.isFinishing || activity.isDestroyed)
        server.shutdown()
    }

    /**
     * الخروج من الغرفة (قرار المالك، 19 نوفمبر): لوحة الغرفة للمضيف، وسؤال زر الرجوع، ثم «كمّل بدون الغرفة»
     * فيبقى المشغّل مفتوحًا والفيديو عندك. اللقطات leave-* تُقرأ من فحوص CI.
     */
    @Test fun captureRoomLeave() {
        assumeTrue("room screenshots are opt-in", InstrumentationRegistry.getArguments().getString("roomShots") == "1")
        val context = instrumentation.targetContext
        val out = File(context.filesDir, "player-shots").apply { mkdirs() }
        val video = File(context.filesDir, "room-leave.mp4")
        instrumentation.context.assets.open("addon-torrent-proof.mp4").use { input -> video.outputStream().use { input.copyTo(it) } }
        val server = MockWebServer()
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val now = System.currentTimeMillis().toDouble()
                webSocket.send(JSONObject()
                    .put("t", "welcome").put("you", "host").put("proto", 2).put("now", now)
                    .put("room", JSONObject().put("hostUserId", "host").put("mode", "sync").put("control", "host").put("invited", JSONArray().put("friend")))
                    .put("state", JSONObject().put("media", JSONObject().put("key", "anime:20958#1").put("kind", "anime").put("label", "Attack on Titan Season 2 — الحلقة 1"))
                        .put("started", true).put("playing", true).put("pos", 0).put("at", now).put("rate", 1).put("seq", 1))
                    .put("roster", JSONArray()
                        .put(JSONObject().put("userId", "host").put("name", "أنت").put("host", true).put("state", "playing").put("joinedAt", 1))
                        .put(JSONObject().put("userId", "friend").put("name", "منصور").put("host", false).put("state", "playing").put("source", "MegaUp").put("pos", 0).put("at", now).put("joinedAt", 2)))
                    .toString())
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                val m = JSONObject(text)
                if (m.optString("t") == "ping") webSocket.send(JSONObject().put("t", "pong").put("t0", m.opt("t0")).put("ts", System.currentTimeMillis()).toString())
            }
        }))
        server.start(java.net.InetAddress.getByName("127.0.0.1"), 0)
        com.vantara.plugins.ensureEngineInjekt(context.applicationContext as android.app.Application)
        val engine = AnimeEngine.get(context)
        val now = System.currentTimeMillis()
        val copies = listOf(SourceAnime(sourceId = "animekai", url = "fixture://attack-on-titan-s2", title = "Attack on Titan Season 2"))
        val session = PlaybackSession(emptyList(), engine.health)
        val prep = PreparedEpisode(id = "room-leave", copies = copies, number = 1f, prefs = Preferences(), session = session, health = engine.health)
        prep.adopt("AnimeKai", listOf(Candidate(id = "l1", sourceId = "AnimeKai", sourceName = "AnimeKai", server = "MegaUp", host = "local.fixture",
            url = Uri.fromFile(video).toString(), quality = 1080, label = "مترجم عربي", resolvedAt = now, expiresAt = now + 3_600_000)))
        AnimeEngine::class.java.getDeclaredField("sessions").apply { isAccessible = true }.let {
            @Suppress("UNCHECKED_CAST") (it.get(engine) as MutableMap<String, PlaybackSession>)["room-leave"] = session
        }
        AnimeEngine::class.java.getDeclaredField("prepared").apply { isAccessible = true }.let {
            @Suppress("UNCHECKED_CAST") (it.get(engine) as MutableMap<String, PreparedEpisode>)["room-leave"] = prep
        }
        val together = JSONObject()
            .put("baseUrl", server.url("/").toString().trimEnd('/')).put("code", "LEAVE2").put("token", "fixture").put("mode", "sync")
            .put("mediaPrefix", "anime:20958").put("kindText", "أنمي").put("title", "Attack on Titan Season 2").put("pick", false)
            .put("invitees", JSONArray().put(JSONObject().put("userId", "friend").put("displayName", "منصور")))
        val launch = PlayerActivity.Launch(
            session = "room-leave", title = "Attack on Titan Season 2", animeId = "20958", episode = 1f, total = 12,
            copies = Json.encodeToString(ListSerializer(SourceAnime.serializer()), copies), together = together.toString(),
        )
        instrumentation.startActivitySync(PlayerActivity.intent(context, launch).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val activity = waitFor { resumed() as? PlayerActivity }
        fun shot(name: String, settle: Long = 900) {
            Thread.sleep(settle)
            val bitmap = instrumentation.uiAutomation.takeScreenshot() ?: return
            File(out, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        fun room(): Any? { var r: Any? = null; instrumentation.runOnMainSync {
            r = PlayerActivity::class.java.getDeclaredField("together").apply { isAccessible = true }.get(activity) }; return r }
        @Suppress("DEPRECATION") fun back() { instrumentation.runOnMainSync { activity.onBackPressed() }; Thread.sleep(600) }
        val end = SystemClock.elapsedRealtime() + 8_000
        while (SystemClock.elapsedRealtime() < end) Thread.sleep(250)
        assertTrue("الغرفة متصلة", room() != null)
        // لوحة الغرفة كما يفتحها المضيف من الشريط العلوي، وتبقى ثابتة (لا تُبنى كل نصف ثانية)
        val panelOwner = room()!!
        instrumentation.runOnMainSync { panelOwner.javaClass.getDeclaredMethod("openPanel").apply { isAccessible = true }.invoke(panelOwner) }
        shot("leave-01-panel", 1500)
        back()
        // زر الرجوع بلا ورقة مفتوحة: سؤال بدل خروج صامت
        back()
        shot("leave-02-back-confirm", 900)
        var pressed = false
        instrumentation.runOnMainSync {
            val found = ArrayList<android.view.View>()
            activity.window.decorView.findViewsWithText(found, "كمّل الفيديو بدون الغرفة", android.view.View.FIND_VIEWS_WITH_TEXT)
            found.firstOrNull { it.isClickable }?.let { pressed = it.performClick() }
        }
        assertTrue("زر «كمّل الفيديو بدون الغرفة» موجود", pressed)
        shot("leave-03-solo", 1500)
        assertTrue("المشغّل ما زال مفتوحًا بعد الخروج من الغرفة", !activity.isFinishing && !activity.isDestroyed)
        assertTrue("لا غرفة بعد الخروج", room() == null)
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
