package com.vantara.anime.player

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.ClipDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView

/**
 * شاشة التحميل كما في Stremio: بدل سواد ودائرة، بنر العمل معتّمًا وفوقه شعاره بألوانه شفافًا،
 * يمتلئ من اليسار إلى اليمين كلما اقترب أول إطار (البيانات التي وصلت فعلًا لا وقت وهمي).
 * إذا توقف المقطع أثناء المشاهدة (قفز أو انتظار قطعة): تعتيم فوق آخر إطار والشعار كاملًا يومض
 * في الوسط. بلا شعار يُكتب العنوان بنفس السلوك.
 */
class LoadingStage(context: Context, private val title: String) : FrameLayout(context) {
    private val backdrop = ImageView(context).apply { scaleType = ImageView.ScaleType.CENTER_CROP; alpha = 0f }
    private val scrim = View(context)
    /** الشعار نفسه مرتين في نفس المكان: تحت شفافًا، وفوقه بكامل لونه مقصوصًا من اليسار بقدر التقدّم. */
    private val mark = FrameLayout(context).apply { visibility = View.GONE }
    private val logo = ImageView(context).apply { scaleType = ImageView.ScaleType.FIT_CENTER; adjustViewBounds = true; contentDescription = title; imageAlpha = 90 }
    private val fill = ImageView(context).apply { scaleType = ImageView.ScaleType.FIT_CENTER; adjustViewBounds = true; importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO }
    private var clip: ClipDrawable? = null
    private var pulse: ValueAnimator? = null
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
        // النسختان بنفس الإعداد تمامًا فتنطبق إحداهما على الأخرى (MATCH_PARENT كان يأخذ عرض الصورة الأصلية)
        for (v in listOf(logo, fill)) {
            v.maxHeight = (resources.displayMetrics.heightPixels * 0.3f).toInt()
            mark.addView(v, LayoutParams(width, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        addView(mark, LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        addView(name, LayoutParams((width * 1.4f).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        paint()
    }

    fun setBackdrop(bmp: Bitmap) { backdrop.setImageBitmap(bmp); if (startup) backdrop.animate().alpha(1f).setDuration(380).start() }

    fun setLogo(bmp: Bitmap) {
        logo.setImageBitmap(bmp)
        // Gravity.LEFT مطلقة لا تنقلب مع اتجاه العربية: الامتلاء من اليسار كما في Stremio
        clip = ClipDrawable(BitmapDrawable(resources, bmp), Gravity.LEFT, ClipDrawable.HORIZONTAL).also { fill.setImageDrawable(it) }
        mark.visibility = View.VISIBLE
        name.visibility = View.GONE
        paint()
        if (!startup && visibility == View.VISIBLE) startPulse()
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
        if (startup) stopPulse() else startPulse()
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
        stopPulse()
        progress = 1f
        paint()
        // 100% = الصورة الأولى ظاهرة تحته: يكتمل الشعار ويتلاشى خلال ~300ms، بلا وقوف
        animate().alpha(0f).setStartDelay(60).setDuration(240).withEndAction { visibility = View.GONE; alpha = 1f }.start()
    }

    fun hideNow() { animate().cancel(); stopPulse(); visibility = View.GONE; alpha = 1f }

    override fun onDetachedFromWindow() { stopPulse(); super.onDetachedFromWindow() }

    private fun paint() {
        if (!startup) {
            // التوقف أثناء المشاهدة: الشعار كاملًا والوميض وحده يقول «ينتظر»
            clip?.level = 10_000
            return
        }
        val p = progress
        clip?.level = (10_000 * p).toInt()
        name.alpha = 0.35f + 0.65f * p
    }

    private fun startPulse() {
        stopPulse()
        val target: View = if (mark.visibility == View.VISIBLE) mark else name
        pulse = ValueAnimator.ofFloat(1f, 0.3f).apply {
            duration = 750
            repeatMode = ValueAnimator.REVERSE
            repeatCount = ValueAnimator.INFINITE
            addUpdateListener { target.alpha = it.animatedValue as Float }
            start()
        }
    }

    private fun stopPulse() {
        pulse?.cancel()
        pulse = null
        mark.alpha = 1f
        name.alpha = if (startup) 0.35f + 0.65f * progress else 1f
    }
}
