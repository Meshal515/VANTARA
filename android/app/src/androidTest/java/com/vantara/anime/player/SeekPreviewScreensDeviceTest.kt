package com.vantara.anime.player

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
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
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * لقطات حقيقية لمعاينة شريط التقدم في مشغّل الـAPK (طلب المالك 15 نوفمبر: «وين المربع»).
 * فيديو حقيقي على الشبكة (Big Buck Bunny، مرخّص CC-BY من Blender) عبر نفس مسار التشغيل والكاش،
 * ثم سحب حقيقي على الشريط بأحداث لمس: موضع بعيد لم يُشاهد (مشغّل المعاينة)، وموضع آخر، ثم موضع شوهد (إطار المشاهدة).
 * اختياري (-e roomShots 1) لأنه توثيق تصميم ويحتاج شبكة.
 */
@RunWith(AndroidJUnit4::class)
class SeekPreviewScreensDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    @Test fun captureSeekPreview() {
        assumeTrue("seek preview screenshots are opt-in", InstrumentationRegistry.getArguments().getString("roomShots") == "1")
        val context = instrumentation.targetContext
        val out = File(context.filesDir, "player-shots").apply { mkdirs() }
        com.vantara.plugins.ensureEngineInjekt(context.applicationContext as android.app.Application)
        val engine = AnimeEngine.get(context)
        val now = System.currentTimeMillis()
        val url = "https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4"
        val c = Candidate(id = "bbb", sourceId = "Fixture", sourceName = "Fixture", server = "Direct 720p", host = "archive.org",
            url = url, quality = 720, label = "Big Buck Bunny 720p", resolvedAt = now, expiresAt = now + 3_600_000)
        val copies = listOf(SourceAnime(sourceId = "fixture", url = "fixture://bbb", title = "Big Buck Bunny"))
        val session = PlaybackSession(emptyList(), engine.health)
        val prep = PreparedEpisode(id = "seek-shots", copies = copies, number = 1f, prefs = Preferences(), session = session, health = engine.health)
        prep.adopt("Fixture", listOf(c))
        AnimeEngine::class.java.getDeclaredField("sessions").apply { isAccessible = true }.let {
            @Suppress("UNCHECKED_CAST") (it.get(engine) as MutableMap<String, PlaybackSession>)["seek-shots"] = session
        }
        AnimeEngine::class.java.getDeclaredField("prepared").apply { isAccessible = true }.let {
            @Suppress("UNCHECKED_CAST") (it.get(engine) as MutableMap<String, PreparedEpisode>)["seek-shots"] = prep
        }
        val launch = PlayerActivity.Launch(session = "seek-shots", title = "Big Buck Bunny", episode = 1f, total = 1,
            copies = Json.encodeToString(ListSerializer(SourceAnime.serializer()), copies))
        instrumentation.startActivitySync(PlayerActivity.intent(context, launch).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val activity = waitFor { resumed() as? PlayerActivity }

        fun <T> field(name: String): T {
            var v: Any? = null
            instrumentation.runOnMainSync { v = PlayerActivity::class.java.getDeclaredField(name).apply { isAccessible = true }.get(activity) }
            @Suppress("UNCHECKED_CAST") return v as T
        }
        fun shot(name: String, settle: Long) {
            Thread.sleep(settle)
            val bitmap = instrumentation.uiAutomation.takeScreenshot() ?: return
            File(out, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        // مشاهدة حقيقية ~25 ث حتى تُلتقط إطارات المشاهدة
        val end = SystemClock.elapsedRealtime() + 40_000
        while (SystemClock.elapsedRealtime() < end && !(field<Boolean>("firstFrameShown"))) Thread.sleep(250)
        // لوحة القصة: 10 إطارات على الأقل للحلقة (كل دقيقتين على الأكثر) تُجهَّز في الخلفية والمشاهدة مستمرة
        val preview0 = field<SeekPreview>("seekPreview")
        fun frameCount(): Int { var n = 0; instrumentation.runOnMainSync {
            n = (SeekPreview::class.java.getDeclaredField("frames").apply { isAccessible = true }.get(preview0) as Map<*, *>).size }; return n }
        val storyBy = SystemClock.elapsedRealtime() + 90_000
        while (SystemClock.elapsedRealtime() < storyBy && frameCount() < 12) Thread.sleep(500)
        File(out, "seek-00-frames.txt").writeText("frames=${frameCount()}")
        assertTrue("لوحة القصة جاهزة قبل السحب (${frameCount()} إطار)", frameCount() >= 10)
        instrumentation.runOnMainSync {
            PlayerActivity::class.java.getDeclaredMethod("setControls", Boolean::class.javaPrimitiveType).apply { isAccessible = true }.invoke(activity, true)
        }
        Thread.sleep(600)
        val bar = field<View>("bar")
        val preview = field<SeekPreview>("seekPreview")
        val y = bar.height / 2f
        val t0 = SystemClock.uptimeMillis()
        fun touch(action: Int, fraction: Float) = instrumentation.runOnMainSync {
            val x = bar.width * fraction
            MotionEvent.obtain(t0, SystemClock.uptimeMillis(), action, x, y, 0).also { bar.dispatchTouchEvent(it); it.recycle() }
        }
        touch(MotionEvent.ACTION_DOWN, 0.42f)
        assertEquals("المربع يظهر مع بداية السحب", View.VISIBLE, preview.view.visibility)
        shot("seek-01-unwatched-42pct", 700) // بلا انتظار: إطار لوحة القصة فوري
        // بلاغ المالك: الإصبع ثابت طويلًا فتختفي الأدوات ويبقى المربع وحده. الآن لا تختفي أثناء السحب
        Thread.sleep(7_000)
        val controls = field<View>("controls")
        assertEquals("الأدوات باقية أثناء السحب", View.VISIBLE, controls.visibility)
        assertTrue("الأدوات غير شفافة أثناء السحب", controls.alpha > 0.9f)
        assertEquals("المربع باقٍ مع الأدوات", View.VISIBLE, preview.view.visibility)
        shot("seek-01b-held-7s", 100)
        for (i in 1..12) { touch(MotionEvent.ACTION_MOVE, 0.42f + i * 0.03f); Thread.sleep(40) }
        shot("seek-02-unwatched-78pct", 3_500)
        for (i in 1..12) { touch(MotionEvent.ACTION_MOVE, 0.78f - i * 0.0625f); Thread.sleep(40) }
        touch(MotionEvent.ACTION_MOVE, 0.025f)
        shot("seek-03-watched-start", 800)
        touch(MotionEvent.ACTION_UP, 0.025f)
        Thread.sleep(400)
        assertEquals("المربع يختفي عند الإفلات", View.GONE, preview.view.visibility)
        shot("seek-04-released", 300)
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
