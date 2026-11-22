package com.vantara.anime.player

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
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
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * لقطات أدوات المشغّل الأصلي قبل Glass وبعده (قرار المالك 21 نوفمبر: «شكل زجاجي على أزرار المشغّل الأصلي»).
 * الفيديو نفسه (Big Buck Bunny، CC-BY من Blender) والموضع نفسه، مرة بالمظهر الحالي ومرة بـ material=glass.
 * اختياري (-e roomShots 1) لأنه توثيق تصميم ويحتاج شبكة.
 */
@RunWith(AndroidJUnit4::class)
class GlassPlayerScreensDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    @Test fun captureGlassControls() {
        assumeTrue("glass player screenshots are opt-in", InstrumentationRegistry.getArguments().getString("roomShots") == "1")
        val context = instrumentation.targetContext
        val out = File(context.filesDir, "player-shots").apply { mkdirs() }
        com.vantara.plugins.ensureEngineInjekt(context.applicationContext as android.app.Application)
        val engine = AnimeEngine.get(context)
        for (material in listOf<String?>(null, "glass")) {
            val id = "glass-shots-${material ?: "current"}"
            val now = System.currentTimeMillis()
            val c = Candidate(id = "bbb", sourceId = "Fixture", sourceName = "Fixture", server = "Direct 720p", host = "archive.org",
                url = "https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4",
                quality = 720, label = "Big Buck Bunny 720p", resolvedAt = now, expiresAt = now + 3_600_000)
            val copies = listOf(SourceAnime(sourceId = "fixture", url = "fixture://bbb", title = "Big Buck Bunny"))
            val session = PlaybackSession(emptyList(), engine.health)
            val prep = PreparedEpisode(id = id, copies = copies, number = 1f, prefs = Preferences(), session = session, health = engine.health)
            prep.adopt("Fixture", listOf(c))
            AnimeEngine::class.java.getDeclaredField("sessions").apply { isAccessible = true }.let {
                @Suppress("UNCHECKED_CAST") (it.get(engine) as MutableMap<String, PlaybackSession>)[id] = session
            }
            AnimeEngine::class.java.getDeclaredField("prepared").apply { isAccessible = true }.let {
                @Suppress("UNCHECKED_CAST") (it.get(engine) as MutableMap<String, PreparedEpisode>)[id] = prep
            }
            val launch = PlayerActivity.Launch(session = id, title = "Big Buck Bunny", episode = 1f, total = 3, material = material,
                positionMs = 95_000, copies = Json.encodeToString(ListSerializer(SourceAnime.serializer()), copies))
            instrumentation.startActivitySync(PlayerActivity.intent(context, launch).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            val activity = waitFor { resumed() as? PlayerActivity }
            assertEquals("Glass يتبع الإعداد", material == "glass", Glass.on)
            fun <T> field(name: String): T {
                var v: Any? = null
                instrumentation.runOnMainSync { v = PlayerActivity::class.java.getDeclaredField(name).apply { isAccessible = true }.get(activity) }
                @Suppress("UNCHECKED_CAST") return v as T
            }
            val end = SystemClock.elapsedRealtime() + 40_000
            while (SystemClock.elapsedRealtime() < end && !(field<Boolean>("firstFrameShown"))) Thread.sleep(250)
            Thread.sleep(1_500)
            instrumentation.runOnMainSync {
                PlayerActivity::class.java.getDeclaredMethod("setControls", Boolean::class.javaPrimitiveType).apply { isAccessible = true }.invoke(activity, true)
            }
            Thread.sleep(900)
            instrumentation.uiAutomation.takeScreenshot()?.let { b ->
                File(out, "glass-${material ?: "current"}.png").outputStream().use { b.compress(Bitmap.CompressFormat.PNG, 100, it) }
            }
            instrumentation.runOnMainSync { activity.finish() }
            Thread.sleep(1_500)
        }
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
