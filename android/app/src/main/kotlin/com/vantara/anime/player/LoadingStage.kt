package com.vantara.anime.player

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Typeface
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView

/**
 * شاشة التحميل كما في Stremio: بدل سواد ودائرة، بنر العمل معتّمًا وفوقه شعاره باهتًا رماديًا
 * يتلوّن نحو لونه الأصلي كلما اقترب أول إطار (البيانات التي وصلت فعلًا لا وقت وهمي).
 * عند القفز أثناء المشاهدة: تعتيم فوق آخر إطار والشعار نفسه يمتلئ. بلا شعار يُكتب العنوان.
 */
class LoadingStage(context: Context, private val title: String) : FrameLayout(context) {
    private val backdrop = ImageView(context).apply { scaleType = ImageView.ScaleType.CENTER_CROP; alpha = 0f }
    private val scrim = View(context)
    private val logo = ImageView(context).apply { scaleType = ImageView.ScaleType.FIT_CENTER; adjustViewBounds = true; visibility = View.GONE; contentDescription = title }
    private val name = TextView(context).apply {
        text = title
        setTextColor(Color.WHITE)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
        typeface = Typeface.DEFAULT_BOLD
        gravity = Gravity.CENTER
        maxLines = 2
        setShadowLayer(16f, 0f, 2f, Color.BLACK)
    }
    /** 0..1، لا يرجع إلى الخلف أثناء نفس التحميل. */
    var progress = 0f
        private set
    /** قبل أول إطار (بنر وخلفية سوداء) أم قفز أثناء المشاهدة (تعتيم فوق الصورة). */
    private var startup = true

    init {
        isClickable = false
        visibility = View.GONE
        addView(backdrop, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        addView(scrim, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        val width = (resources.displayMetrics.widthPixels.coerceAtMost(resources.displayMetrics.heightPixels * 2) * 0.32f).toInt()
        logo.maxHeight = (resources.displayMetrics.heightPixels * 0.3f).toInt()
        addView(logo, LayoutParams(width, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        addView(name, LayoutParams((width * 1.4f).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        paint()
    }

    fun setBackdrop(bmp: Bitmap) { backdrop.setImageBitmap(bmp); if (startup) backdrop.animate().alpha(1f).setDuration(380).start() }

    fun setLogo(bmp: Bitmap) {
        logo.setImageBitmap(bmp)
        logo.visibility = View.VISIBLE
        name.visibility = View.GONE
        paint()
    }

    /** يُظهر الشاشة من الصفر. [beforeFirstFrame]: بداية تشغيل/تبديل سيرفر، وإلا قفز داخل الفيديو. */
    fun show(beforeFirstFrame: Boolean) {
        if (visibility == View.VISIBLE && startup == beforeFirstFrame) return
        startup = beforeFirstFrame
        progress = 0f
        setBackgroundColor(if (startup) Color.BLACK else Color.TRANSPARENT)
        backdrop.visibility = if (startup) View.VISIBLE else View.GONE
        if (startup && backdrop.drawable != null) backdrop.alpha = 1f
        scrim.setBackgroundColor(if (startup) 0x99000000.toInt() else 0x8C000000.toInt())
        animate().cancel()
        alpha = 1f
        visibility = View.VISIBLE
        paint()
    }

    fun advance(value: Float) {
        val next = value.coerceIn(0f, 0.97f)
        if (next <= progress) return
        progress = next
        paint()
    }

    /** اكتمل: يتلوّن الشعار كاملًا ثم تتلاشى الشاشة عن الفيديو. */
    fun finish() {
        if (visibility != View.VISIBLE) return
        progress = 1f
        paint()
        animate().alpha(0f).setStartDelay(120).setDuration(320).withEndAction { visibility = View.GONE; alpha = 1f }.start()
    }

    fun hideNow() { animate().cancel(); visibility = View.GONE; alpha = 1f }

    private fun paint() {
        // رمادي باهت ← اللون الأصلي: التشبّع والعتامة يتبعان ما اكتمل
        val p = progress
        val matrix = ColorMatrix().apply { setSaturation(p) }
        logo.colorFilter = ColorMatrixColorFilter(matrix)
        logo.imageAlpha = (255 * (0.32f + 0.68f * p)).toInt()
        name.alpha = 0.4f + 0.6f * p
    }
}
