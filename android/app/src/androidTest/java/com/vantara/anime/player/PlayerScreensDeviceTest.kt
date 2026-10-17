package com.vantara.anime.player

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.vantara.anime.AnimeEngine
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.PlaybackSession
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * لقطات حقيقية لمشغل الـAPK (المرجع الذي يُطابَق عليه مشغل ويندوز): أدوات التحكم وكل ورقة.
 * المشغل نفسه بلا تعديل؛ الجلسة فقط تُحقن بمرشحين يشيران إلى فيديو محلي مملوك.
 * اختياري (-e playerShots 1) لأنه أداة توثيق تصميم لا اختبار سلوك.
 */
@RunWith(AndroidJUnit4::class)
class PlayerScreensDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    @Test fun captureEveryPlayerScreen() {
        assumeTrue("player screenshots are opt-in", InstrumentationRegistry.getArguments().getString("playerShots") == "1")
        val context = instrumentation.targetContext
        val out = File(context.filesDir, "player-shots").apply { deleteRecursively(); mkdirs() }
        val video = File(context.filesDir, "player-shot.mp4")
        instrumentation.context.assets.open("addon-torrent-proof.mp4").use { input -> video.outputStream().use { input.copyTo(it) } }

        val engine = AnimeEngine.get(context)
        val now = System.currentTimeMillis()
        fun candidate(id: String, source: String, server: String, quality: Int) = Candidate(
            id = id, sourceId = source, sourceName = source, server = server, host = "local.fixture",
            url = Uri.fromFile(video).toString(), quality = quality, resolvedAt = now, expiresAt = now + 3_600_000,
        )
        val sessionsField = AnimeEngine::class.java.getDeclaredField("sessions").apply { isAccessible = true }
        @Suppress("UNCHECKED_CAST")
        val sessions = sessionsField.get(engine) as MutableMap<String, PlaybackSession>
        sessions["shots"] = PlaybackSession(listOf(candidate("c1", "WitAnime", "Mp4upload", 1080), candidate("c2", "OkAnime", "Streamtape", 720)), engine.health)

        val launch = PlayerActivity.Launch(session = "shots", title = "Frieren: Beyond Journey's End", episode = 3f, total = 28, candidate = "c1")
        instrumentation.startActivitySync(PlayerActivity.intent(context, launch).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val activity = waitFor { resumed() as? PlayerActivity }
        Thread.sleep(4000) // أول إطار

        fun call(name: String) = instrumentation.runOnMainSync {
            PlayerActivity::class.java.getDeclaredMethod(name).apply { isAccessible = true }.invoke(activity)
        }
        fun controls(show: Boolean) = instrumentation.runOnMainSync {
            PlayerActivity::class.java.getDeclaredMethod("setControls", Boolean::class.javaPrimitiveType).apply { isAccessible = true }.invoke(activity, show)
        }
        fun shot(name: String) {
            Thread.sleep(700)
            val bitmap = instrumentation.uiAutomation.takeScreenshot() ?: return
            File(out, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        @Suppress("DEPRECATION") fun back() { instrumentation.runOnMainSync { activity.onBackPressed() }; Thread.sleep(500) }

        instrumentation.runOnMainSync {
            val player = PlayerActivity::class.java.getDeclaredField("player").apply { isAccessible = true }.get(activity) as androidx.media3.exoplayer.ExoPlayer
            player.pause()
        }
        controls(true); shot("01-controls")
        for ((index, method) in listOf("showServers", "showEpisodes", "showQuality", "showSubtitles", "showSpeed", "showMore").withIndex()) {
            call(method); shot("%02d-%s".format(index + 2, method.removePrefix("show").lowercase())); back()
        }
        controls(false); shot("08-clean")
        instrumentation.runOnMainSync { activity.finish() }
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
