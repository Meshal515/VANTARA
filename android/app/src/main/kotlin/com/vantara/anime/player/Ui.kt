package com.vantara.anime.player

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.content.res.ColorStateList
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * عدّة واجهة المشغّل: ألوان قسم الأنمي نفسها في الواجهة (anime.css)، أيقونات
 * خطّية مرسومة (لا صور)، وأوراق سفلية بتصميم VANTARA بدل نوافذ أندرويد.
 */
object Tone {
    const val BG = 0xFF05070D.toInt()
    const val SURFACE = 0xFF0D111B.toInt()
    const val SURFACE_2 = 0xFF131826.toInt()
    const val SURFACE_3 = 0xFF1B2233.toInt()
    const val LINE = 0x1FA0BEFF
    const val TEXT = 0xFFF3F6FC.toInt()
    const val TEXT_2 = 0xFFB4BDD0.toInt()
    const val TEXT_3 = 0xFF7D879D.toInt()
    const val TEXT_4 = 0xFF4E576B.toInt()
    const val ACCENT = 0xFF3B82F6.toInt()
    const val ACCENT_TEXT = 0xFF8FB8FF.toInt()
    const val ACCENT_SOFT = 0x293B82F6
    const val OK = 0xFF34D399.toInt()
    const val WARN = 0xFFFBBF24.toInt()
    const val BAD = 0xFFF87171.toInt()
    const val SCRIM = 0xB3000000.toInt()
}

fun Context.dp(v: Number): Int = (v.toFloat() * resources.displayMetrics.density + 0.5f).toInt()
fun View.dp(v: Number): Int = context.dp(v)

fun rounded(color: Int, radius: Float, stroke: Int = 0, strokeColor: Int = 0) = GradientDrawable().apply {
    cornerRadius = radius
    setColor(color)
    if (stroke > 0) setStroke(stroke, strokeColor)
}

/** خلفية قابلة للضغط بموجة خفيفة. */
fun pressable(color: Int, radius: Float, stroke: Int = 0, strokeColor: Int = 0): Drawable =
    RippleDrawable(ColorStateList.valueOf(0x33FFFFFF), rounded(color, radius, stroke, strokeColor), rounded(Color.WHITE, radius))

fun Context.label(text: String, sp: Float, color: Int = Tone.TEXT, bold: Boolean = false): TextView = TextView(this).apply {
    this.text = text
    setTextColor(color)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
    if (bold) typeface = Typeface.DEFAULT_BOLD
    includeFontPadding = false
    // المحاذاة باتجاه الواجهة (يمين في العربية) حتى لنص لاتيني مثل «HGC» أو اسم الأنمي
    textAlignment = View.TEXT_ALIGNMENT_VIEW_START
}

/**
 * أيقونات خطّية على شبكة 24×24 مثل أيقونات الواجهة (icons.js): خط 1.8،
 * أطراف دائرية. مرسومة بالكود، فتتلوّن وتتحجّم بلا ملفات.
 */
class Glyph(private val kind: Kind, private var color: Int = Color.WHITE, private val sizePx: Int = 0) : Drawable() {
    enum class Kind {
        BACK, PLAY, PAUSE, REWIND10, FORWARD10, CAMERA, MORE, EPISODES, SERVERS, QUALITY, SUBTITLES,
        SPEED, FIT, FILL, NEXT, CHECK, CLOSE, VOLUME, BRIGHTNESS, SHARE, SAVE, SEND, LOCK, UNLOCK, RETRY, SPARK,
    }

    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER
        typeface = Typeface.DEFAULT_BOLD
    }

    fun tint(c: Int) {
        color = c
        invalidateSelf()
    }

    override fun getIntrinsicWidth() = sizePx.takeIf { it > 0 } ?: -1
    override fun getIntrinsicHeight() = sizePx.takeIf { it > 0 } ?: -1

    override fun draw(canvas: Canvas) {
        val b = bounds
        val s = minOf(b.width(), b.height()) / 24f
        canvas.save()
        canvas.translate(b.left + (b.width() - 24 * s) / 2, b.top + (b.height() - 24 * s) / 2)
        canvas.scale(s, s)
        stroke.color = color
        stroke.strokeWidth = 1.8f
        fill.color = color
        text.color = color
        val p = Path()
        when (kind) {
            // الرجوع في واجهة عربية يشير لليمين
            Kind.BACK -> { p.moveTo(5f, 12f); p.lineTo(19f, 12f); p.moveTo(13f, 6f); p.lineTo(19f, 12f); p.lineTo(13f, 18f); canvas.drawPath(p, stroke) }
            Kind.PLAY -> { p.moveTo(8f, 5.5f); p.lineTo(19f, 12f); p.lineTo(8f, 18.5f); p.close(); canvas.drawPath(p, fill) }
            Kind.PAUSE -> { canvas.drawRoundRect(RectF(6.5f, 5f, 10f, 19f), 1.2f, 1.2f, fill); canvas.drawRoundRect(RectF(14f, 5f, 17.5f, 19f), 1.2f, 1.2f, fill) }
            Kind.REWIND10, Kind.FORWARD10 -> {
                val fwd = kind == Kind.FORWARD10
                val r = RectF(3.5f, 3.5f, 20.5f, 20.5f)
                if (fwd) canvas.drawArc(r, -60f, 300f, false, stroke) else canvas.drawArc(r, -120f, -300f, false, stroke)
                if (fwd) { p.moveTo(16f, 2.2f); p.lineTo(16.9f, 5.2f); p.lineTo(13.8f, 5.9f) } else { p.moveTo(8f, 2.2f); p.lineTo(7.1f, 5.2f); p.lineTo(10.2f, 5.9f) }
                canvas.drawPath(p, stroke)
                text.textSize = 7.6f
                canvas.drawText("10", 12f, 14.7f, text)
            }
            Kind.CAMERA -> {
                canvas.drawRoundRect(RectF(2.5f, 6.5f, 15.5f, 17.5f), 2.5f, 2.5f, stroke)
                p.moveTo(15.5f, 10.5f); p.lineTo(21.5f, 7f); p.lineTo(21.5f, 17f); p.lineTo(15.5f, 13.5f)
                canvas.drawPath(p, stroke)
                canvas.drawCircle(6.5f, 10.5f, 1.2f, fill)
            }
            Kind.MORE -> { for (y in listOf(5f, 12f, 19f)) canvas.drawCircle(12f, y, 1.7f, fill) }
            Kind.EPISODES -> {
                canvas.drawRoundRect(RectF(3f, 4f, 21f, 15f), 2.5f, 2.5f, stroke)
                p.moveTo(10.5f, 7.5f); p.lineTo(14.5f, 9.5f); p.lineTo(10.5f, 11.5f); p.close(); canvas.drawPath(p, fill)
                canvas.drawLine(5f, 19f, 19f, 19f, stroke)
            }
            Kind.SERVERS -> {
                canvas.drawRoundRect(RectF(3.5f, 4f, 20.5f, 10.5f), 2f, 2f, stroke)
                canvas.drawRoundRect(RectF(3.5f, 13.5f, 20.5f, 20f), 2f, 2f, stroke)
                canvas.drawCircle(7.5f, 7.25f, 1.1f, fill); canvas.drawCircle(7.5f, 16.75f, 1.1f, fill)
                canvas.drawLine(12f, 7.25f, 17f, 7.25f, stroke); canvas.drawLine(12f, 16.75f, 17f, 16.75f, stroke)
            }
            Kind.QUALITY -> {
                canvas.drawRoundRect(RectF(2.5f, 5.5f, 21.5f, 18.5f), 3f, 3f, stroke)
                text.textSize = 7.8f
                canvas.drawText("HD", 12f, 14.8f, text)
            }
            Kind.SUBTITLES -> {
                canvas.drawRoundRect(RectF(2.5f, 5f, 21.5f, 19f), 3f, 3f, stroke)
                canvas.drawLine(6f, 11.5f, 11f, 11.5f, stroke); canvas.drawLine(13.5f, 11.5f, 18f, 11.5f, stroke)
                canvas.drawLine(6f, 15f, 14f, 15f, stroke); canvas.drawLine(16.5f, 15f, 18f, 15f, stroke)
            }
            Kind.SPEED -> {
                canvas.drawArc(RectF(3f, 5f, 21f, 23f), 180f, 180f, false, stroke)
                canvas.drawLine(12f, 14f, 16.5f, 9f, stroke)
                canvas.drawCircle(12f, 14f, 1.6f, fill)
                canvas.drawLine(3f, 14f, 3f, 18f, stroke); canvas.drawLine(21f, 14f, 21f, 18f, stroke)
            }
            Kind.FIT -> {
                // أسهم للداخل: «ملاءمة»
                canvas.drawRoundRect(RectF(2.5f, 5f, 21.5f, 19f), 2.5f, 2.5f, stroke)
                canvas.drawRoundRect(RectF(7.5f, 9f, 16.5f, 15f), 1.5f, 1.5f, stroke)
            }
            Kind.FILL -> {
                // زوايا للخارج: «ملء»
                p.moveTo(3f, 9f); p.lineTo(3f, 5f); p.lineTo(7f, 5f)
                p.moveTo(17f, 5f); p.lineTo(21f, 5f); p.lineTo(21f, 9f)
                p.moveTo(21f, 15f); p.lineTo(21f, 19f); p.lineTo(17f, 19f)
                p.moveTo(7f, 19f); p.lineTo(3f, 19f); p.lineTo(3f, 15f)
                canvas.drawPath(p, stroke)
            }
            Kind.NEXT -> {
                p.moveTo(5f, 5.5f); p.lineTo(15f, 12f); p.lineTo(5f, 18.5f); p.close(); canvas.drawPath(p, fill)
                canvas.drawRoundRect(RectF(16.5f, 5.5f, 19f, 18.5f), 1f, 1f, fill)
            }
            Kind.CHECK -> { p.moveTo(5f, 12.5f); p.lineTo(10f, 17.5f); p.lineTo(19f, 7f); canvas.drawPath(p, stroke) }
            Kind.CLOSE -> { canvas.drawLine(6f, 6f, 18f, 18f, stroke); canvas.drawLine(18f, 6f, 6f, 18f, stroke) }
            Kind.VOLUME -> {
                p.moveTo(3.5f, 9.5f); p.lineTo(7f, 9.5f); p.lineTo(11.5f, 5.5f); p.lineTo(11.5f, 18.5f); p.lineTo(7f, 14.5f); p.lineTo(3.5f, 14.5f); p.close()
                canvas.drawPath(p, stroke)
                canvas.drawArc(RectF(10f, 8f, 18f, 16f), -50f, 100f, false, stroke)
                canvas.drawArc(RectF(9f, 4.5f, 22f, 19.5f), -50f, 100f, false, stroke)
            }
            Kind.BRIGHTNESS -> {
                canvas.drawCircle(12f, 12f, 4f, stroke)
                for (i in 0 until 8) {
                    val a = Math.toRadians(i * 45.0)
                    canvas.drawLine(12f + 7f * Math.cos(a).toFloat(), 12f + 7f * Math.sin(a).toFloat(), 12f + 9.5f * Math.cos(a).toFloat(), 12f + 9.5f * Math.sin(a).toFloat(), stroke)
                }
            }
            Kind.SHARE -> {
                canvas.drawCircle(18f, 5.5f, 2.5f, stroke); canvas.drawCircle(6f, 12f, 2.5f, stroke); canvas.drawCircle(18f, 18.5f, 2.5f, stroke)
                canvas.drawLine(8.2f, 10.8f, 15.8f, 6.8f, stroke); canvas.drawLine(8.2f, 13.2f, 15.8f, 17.2f, stroke)
            }
            Kind.SAVE -> {
                canvas.drawLine(12f, 3.5f, 12f, 15f, stroke)
                p.moveTo(7f, 10.5f); p.lineTo(12f, 15.5f); p.lineTo(17f, 10.5f)
                p.moveTo(4f, 15.5f); p.lineTo(4f, 19.5f); p.lineTo(20f, 19.5f); p.lineTo(20f, 15.5f)
                canvas.drawPath(p, stroke)
            }
            Kind.SEND -> {
                p.moveTo(21f, 3f); p.lineTo(3f, 10.5f); p.lineTo(10.5f, 13.5f); p.lineTo(13.5f, 21f); p.close()
                p.moveTo(21f, 3f); p.lineTo(10.5f, 13.5f)
                canvas.drawPath(p, stroke)
            }
            Kind.LOCK, Kind.UNLOCK -> {
                canvas.drawRoundRect(RectF(4.5f, 10.5f, 19.5f, 20.5f), 2.5f, 2.5f, stroke)
                if (kind == Kind.LOCK) canvas.drawArc(RectF(7.5f, 3.5f, 16.5f, 14.5f), 180f, 180f, false, stroke)
                else canvas.drawArc(RectF(7.5f, 3.5f, 16.5f, 14.5f), 180f, 150f, false, stroke)
                if (kind == Kind.LOCK) { canvas.drawLine(7.5f, 9f, 7.5f, 10.5f, stroke); canvas.drawLine(16.5f, 9f, 16.5f, 10.5f, stroke) }
                canvas.drawCircle(12f, 15.5f, 1.3f, fill)
            }
            Kind.RETRY -> {
                canvas.drawArc(RectF(4f, 4f, 20f, 20f), -80f, 300f, false, stroke)
                p.moveTo(12.5f, 1.8f); p.lineTo(15.2f, 4.2f); p.lineTo(12.4f, 6.6f)
                canvas.drawPath(p, stroke)
            }
            Kind.SPARK -> {
                p.moveTo(12f, 3f); p.lineTo(14f, 10f); p.lineTo(21f, 12f); p.lineTo(14f, 14f); p.lineTo(12f, 21f); p.lineTo(10f, 14f); p.lineTo(3f, 12f); p.lineTo(10f, 10f); p.close()
                canvas.drawPath(p, fill)
            }
        }
        canvas.restore()
    }

    override fun setAlpha(alpha: Int) {
        stroke.alpha = alpha; fill.alpha = alpha; text.alpha = alpha
    }

    override fun setColorFilter(colorFilter: ColorFilter?) {
        stroke.colorFilter = colorFilter; fill.colorFilter = colorFilter; text.colorFilter = colorFilter
    }

    @Deprecated("Deprecated in Java")
    override fun getOpacity() = PixelFormat.TRANSLUCENT
}

/** زر أيقونة دائري: هدف لمس 48dp مهما صغرت الأيقونة. */
fun Context.iconButton(kind: Glyph.Kind, iconDp: Int = 24, boxDp: Int = 48, bg: Int = 0, desc: String, onClick: () -> Unit): ImageView =
    ImageView(this).apply {
        setImageDrawable(Glyph(kind, Color.WHITE))
        val pad = dp((boxDp - iconDp) / 2f)
        setPadding(pad, pad, pad, pad)
        background = RippleDrawable(ColorStateList.valueOf(0x33FFFFFF), if (bg != 0) rounded(bg, dp(boxDp).toFloat()) else null, rounded(Color.WHITE, dp(boxDp).toFloat()))
        contentDescription = desc
        layoutParams = ViewGroup.LayoutParams(dp(boxDp), dp(boxDp))
        setOnClickListener { onClick() }
    }

/**
 * ورقة سفلية بتصميم VANTARA داخل نافذة المشغّل نفسها (لا Dialog): تنزلق من
 * الأسفل فوق غطاء معتم، مقبض صغير، عنوان، ومحتوى قابل للتمرير. المشغّل لا
 * يخرج من ملء الشاشة ولا يتوقف الفيديو خلفها.
 */
class VSheet(private val host: FrameLayout) {
    private val ctx = host.context
    private fun dp(v: Number) = ctx.dp(v)
    private var scrim: View? = null
    private var panel: LinearLayout? = null
    var onClose: (() -> Unit)? = null
    val isOpen get() = panel != null

    /** [build] يملأ جسم الورقة؛ يُعاد نداؤه بـ[refresh] لتحديث حيّ. */
    private var build: ((LinearLayout) -> Unit)? = null
    private var body: LinearLayout? = null
    private var scroller: ScrollView? = null

    fun scrollTo(y: Int) { scroller?.smoothScrollTo(0, y.coerceAtLeast(0)) }

    fun open(title: String, subtitle: String? = null, maxWidthDp: Int = 560, build: (LinearLayout) -> Unit) {
        close(animated = false)
        this.build = build
        val s = View(ctx).apply {
            setBackgroundColor(Tone.SCRIM)
            alpha = 0f
            setOnClickListener { close() }
        }
        val p = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            background = GradientDrawable().apply {
                setColor(Tone.SURFACE)
                cornerRadii = floatArrayOf(dp(22).toFloat(), dp(22).toFloat(), dp(22).toFloat(), dp(22).toFloat(), 0f, 0f, 0f, 0f)
                setStroke(dp(1), Tone.LINE)
            }
            setPadding(dp(18), dp(8), dp(18), dp(14))
            isClickable = true
            // لمسة داخل الورقة لا تصل للمشغّل تحتها
            setOnTouchListener { _, _ -> false }
        }
        p.addView(View(ctx).apply { background = rounded(0x33FFFFFF, dp(3).toFloat()) }, LinearLayout.LayoutParams(dp(36), dp(4)).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = dp(12) })
        val head = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        head.addView(ctx.label(title, 17f, Tone.TEXT, bold = true))
        if (subtitle != null) head.addView(ctx.label(subtitle, 12.5f, Tone.TEXT_3).apply { setPadding(0, dp(5), 0, 0) })
        p.addView(head, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(12) })
        val b = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        val scroll = ScrollView(ctx).apply {
            isVerticalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            addView(b)
        }
        p.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        body = b
        scroller = scroll
        build(b)

        val h = host.height.takeIf { it > 0 } ?: ctx.resources.displayMetrics.heightPixels
        val w = host.width.takeIf { it > 0 } ?: ctx.resources.displayMetrics.widthPixels
        host.addView(s, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        host.addView(
            p,
            FrameLayout.LayoutParams(minOf(w, ctx.dp(maxWidthDp)), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL),
        )
        // سقف الارتفاع: 88% من الشاشة، والباقي يُمرَّر
        p.post {
            val cap = (h * 0.88f).toInt()
            if (p.height > cap) p.layoutParams = (p.layoutParams as FrameLayout.LayoutParams).apply { height = cap }
        }
        scrim = s
        panel = p
        p.translationY = h * 0.6f
        p.animate().translationY(0f).setDuration(260).setInterpolator(DecelerateInterpolator(2f)).start()
        s.animate().alpha(1f).setDuration(200).start()
    }

    /** يعيد بناء المحتوى (سيرفر جهز، حالة تغيّرت) بلا إغلاق ولا قفزة. */
    fun refresh() {
        val b = body ?: return
        val f = build ?: return
        b.removeAllViews()
        f(b)
    }

    fun close(animated: Boolean = true) {
        val p = panel ?: return
        val s = scrim
        panel = null
        scrim = null
        body = null
        scroller = null
        build = null
        if (!animated) {
            host.removeView(p); s?.let(host::removeView)
        } else {
            p.animate().translationY(p.height.toFloat()).setDuration(200).withEndAction { host.removeView(p) }.start()
            s?.animate()?.alpha(0f)?.setDuration(200)?.withEndAction { host.removeView(s) }?.start()
        }
        onClose?.invoke()
    }
}

/** صف قابل للضغط داخل ورقة: عنوان، سطر ثانوي، ونهاية (علامة/حالة). */
fun Context.sheetRow(
    title: CharSequence,
    detail: CharSequence? = null,
    leading: View? = null,
    trailing: View? = null,
    selected: Boolean = false,
    enabled: Boolean = true,
    onClick: (() -> Unit)? = null,
): LinearLayout = LinearLayout(this).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    minimumHeight = dp(56)
    setPadding(dp(14), dp(10), dp(14), dp(10))
    background = if (onClick != null && enabled) {
        pressable(if (selected) Tone.ACCENT_SOFT else Tone.SURFACE_2, dp(14).toFloat(), if (selected) dp(1) else 0, 0x6B3B82F6)
    } else {
        rounded(if (selected) Tone.ACCENT_SOFT else Tone.SURFACE_2, dp(14).toFloat())
    }
    alpha = if (enabled) 1f else 0.5f
    leading?.let {
        val w = it.layoutParams?.width ?: ViewGroup.LayoutParams.WRAP_CONTENT
        val h = it.layoutParams?.height ?: ViewGroup.LayoutParams.WRAP_CONTENT
        addView(it, LinearLayout.LayoutParams(w, h).apply { marginEnd = dp(12) })
    }
    val copy = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        addView(label(title.toString(), 15f, if (selected) Tone.ACCENT_TEXT else Tone.TEXT, bold = true).apply { text = title })
        if (detail != null) addView(label(detail.toString(), 12f, Tone.TEXT_3).apply { text = detail; setPadding(0, dp(4), 0, 0) })
    }
    addView(copy, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    trailing?.let {
        val w = it.layoutParams?.width ?: ViewGroup.LayoutParams.WRAP_CONTENT
        val h = it.layoutParams?.height ?: ViewGroup.LayoutParams.WRAP_CONTENT
        addView(it, LinearLayout.LayoutParams(w, h))
    }
    if (onClick != null && enabled) setOnClickListener { onClick() }
    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(8) }
}

fun Context.sectionLabel(text: String): TextView = label(text, 12f, Tone.TEXT_3, bold = true).apply {
    setPadding(dp(4), dp(10), dp(4), dp(8))
}

/** نقطة حالة صغيرة؛ «يتجهّز» تنبض. */
class StatusDot(context: Context, color: Int, pulse: Boolean) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color }
    private var anim: ValueAnimator? = null

    init {
        layoutParams = ViewGroup.LayoutParams(dp(10), dp(10))
        if (pulse) {
            anim = ValueAnimator.ofFloat(1f, 0.25f).apply {
                duration = 700
                repeatMode = ValueAnimator.REVERSE
                repeatCount = ValueAnimator.INFINITE
                addUpdateListener { alpha = it.animatedValue as Float }
            }
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        anim?.start()
    }

    override fun onDetachedFromWindow() {
        anim?.cancel()
        super.onDetachedFromWindow()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) = setMeasuredDimension(dp(10), dp(10))

    override fun onDraw(canvas: Canvas) = canvas.drawCircle(width / 2f, height / 2f, width / 2f, paint)
}

/** حبّة صغيرة: «الآن»، «مدبلج»، «فشل التشغيل». */
fun Context.chip(text: String, fg: Int, bg: Int): TextView = label(text, 11f, fg, bold = true).apply {
    setPadding(dp(8), dp(4), dp(8), dp(4))
    background = rounded(bg, dp(8).toFloat())
}

/** يمنع وصول اللمس للطبقات تحت العنصر. */
fun View.swallowTouches() = setOnTouchListener { _, e: MotionEvent -> true.also { if (e.action == MotionEvent.ACTION_UP) performClick() } }
