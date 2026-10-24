package com.vantara.anime.player

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.view.View
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * شاشة التحميل كما في Stremio، مرسومة فعلًا على الجهاز وبكسلاتها مفحوصة:
 * عند البدء الشعار بألوانه شفافًا ويمتلئ من اليسار بقدر التقدّم، وعند التوقف أثناء المشاهدة
 * يكون كاملًا ويومض. اختياري (-e loadingStage 1) لأنه يحفظ لقطات للمراجعة.
 */
@RunWith(AndroidJUnit4::class)
class LoadingStageDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val w = 2400
    private val h = 1080

    @Test fun logoFillsLeftToRightThenPulsesWhenStalled() {
        assumeTrue("loading stage shots are opt-in", InstrumentationRegistry.getArguments().getString("loadingStage") == "1")
        val context = instrumentation.targetContext
        val out = File(context.filesDir, "loading-stage").apply { deleteRecursively(); mkdirs() }
        lateinit var stage: LoadingStage
        instrumentation.runOnMainSync {
            stage = LoadingStage(context, "SPIDER-MAN")
            stage.setBackdrop(backdrop())
            stage.setLogo(logo())
            stage.show(beforeFirstFrame = true)
            stage.advance(0.6f)
            stage.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
            stage.layout(0, 0, w, h)
        }
        val startup = render(stage, null)
        save(out, "01-startup-60", startup)
        instrumentation.runOnMainSync { stage.advance(0.97f); stage.finish() }
        val done = render(stage, null)
        // حدود الشعار تُقرأ من الصورة المكتملة (مقاسه من شاشة الجهاز نفسه): أول صف أحمر في الوسط وامتداده
        val row = logoRow(done)
        val reds = (0 until w).filter { Color.red(done.getPixel(it, row)) > 200 && Color.green(done.getPixel(it, row)) < 80 }
        val left = reds.first().toFloat()
        val logoW = (reds.last() - reds.first()).toFloat()
        val filled = Color.red(startup.getPixel((left + logoW * 0.25f).toInt(), row))
        val pending = Color.red(startup.getPixel((left + logoW * 0.85f).toInt(), row))
        println("LOADING-STAGE logo x=${left.toInt()} w=${logoW.toInt()} row=$row filledRed=$filled pendingRed=$pending")
        assertTrue("logo found (w=$logoW)", logoW > 150)
        assertTrue("left 60% of the logo is in full color (red=$filled)", filled > 200)
        assertTrue("the rest is still translucent (red=$pending)", pending in 40..170)

        // توقف أثناء المشاهدة: فوق آخر إطار، الشعار كامل ويومض
        instrumentation.runOnMainSync { stage.hideNow(); stage.show(beforeFirstFrame = false) }
        val frame = videoFrame()
        val samples = (0 until 6).map { i ->
            Thread.sleep(250)
            val shot = render(stage, frame)
            if (i == 0 || i == 3) save(out, "0${2 + i / 3}-stalled-$i", shot)
            val l = Color.red(shot.getPixel((left + logoW * 0.25f).toInt(), row))
            val r = Color.red(shot.getPixel((left + logoW * 0.85f).toInt(), row))
            assertTrue("stalled: logo is whole, not half filled (left=$l right=$r)", kotlin.math.abs(l - r) < 30)
            l
        }
        println("LOADING-STAGE stalled reds=$samples")
        assertTrue("stalled: the logo pulses (reds=$samples)", samples.maxOf { it } - samples.minOf { it } > 60)
        instrumentation.runOnMainSync { stage.hideNow() }
    }

    /** الصف الأول من الشعار الأحمر في وسط الصورة. */
    private fun logoRow(b: Bitmap): Int {
        for (y in 0 until h) if (Color.red(b.getPixel(w / 2, y)) > 200 && Color.green(b.getPixel(w / 2, y)) < 80) return y + 6
        error("logo not found")
    }

    private fun render(stage: LoadingStage, under: Bitmap?): Bitmap {
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        instrumentation.runOnMainSync {
            val c = Canvas(bmp)
            if (under != null) c.drawBitmap(under, 0f, 0f, null) else c.drawColor(Color.BLACK)
            stage.draw(c)
        }
        return bmp
    }

    private fun save(dir: File, name: String, b: Bitmap) = File(dir, "$name.png").outputStream().use { b.compress(Bitmap.CompressFormat.PNG, 100, it) }

    private fun backdrop(): Bitmap = Bitmap.createBitmap(1280, 720, Bitmap.Config.ARGB_8888).also {
        val c = Canvas(it)
        c.drawPaint(Paint().apply { shader = LinearGradient(0f, 0f, 1280f, 720f, 0xFF1B2A4A.toInt(), 0xFF0B0F1A.toInt(), Shader.TileMode.CLAMP) })
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x553A6FD8 }
        c.drawCircle(980f, 260f, 300f, p)
    }

    private fun videoFrame(): Bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also {
        val c = Canvas(it)
        c.drawPaint(Paint().apply { shader = LinearGradient(0f, 0f, w.toFloat(), 0f, 0xFF3C5A3A.toInt(), 0xFF2A3550.toInt(), Shader.TileMode.CLAMP) })
    }

    /** شعار مرسوم: لوح أحمر بعرض كامل وعليه الاسم أبيض (يُكشف الامتلاء على الأحمر). */
    private fun logo(): Bitmap = Bitmap.createBitmap(800, 220, Bitmap.Config.ARGB_8888).also {
        val c = Canvas(it)
        c.drawRoundRect(RectF(0f, 0f, 800f, 220f), 28f, 28f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFE50914.toInt() })
        c.drawText("SPIDER-MAN", 400f, 150f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE; textSize = 120f; typeface = Typeface.DEFAULT_BOLD; textAlign = Paint.Align.CENTER
        })
    }
}
