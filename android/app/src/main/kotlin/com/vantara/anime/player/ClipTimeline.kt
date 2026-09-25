package com.vantara.anime.player

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.MotionEvent
import android.view.View
import kotlin.math.abs

/**
 * خط زمن المقطع: النافذة كلها (حتى ٣٥ ث قبل اللحظة و٣٥ بعدها)، والمقطع
 * المختار بإطار ومقبضين يُسحب كل منهما وحده، واللحظة الأصلية علامة ثابتة
 * لا تتحرك. أثناء المعاينة خط يمشي عليه.
 */
class ClipTimeline(context: Context) : View(context) {
    var range: ClipRange = ClipRange(0, 10_000, 5_000)
        set(v) { field = v; invalidate() }
    var windowStartMs = 0L
    var windowEndMs = 70_000L
    var playheadMs: Long? = null
        set(v) { field = v; invalidate() }

    /** يستلم المقبض المسحوب والموضع الجديد؛ يرجع المقطع بعد القيود. */
    var onDrag: ((start: Boolean, toMs: Long) -> Unit)? = null
    var onDragEnd: (() -> Unit)? = null

    private var dragging: Boolean? = null // true = البداية، false = النهاية
    private val rail = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Tone.SURFACE_3 }
    private val tick = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x33FFFFFF; strokeWidth = 2f }
    private val sel = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x333B82F6 }
    private val frame = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Tone.ACCENT; style = Paint.Style.STROKE }
    private val handle = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Tone.ACCENT }
    private val grip = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xCCFFFFFF.toInt(); strokeWidth = 3f; strokeCap = Paint.Cap.ROUND }
    private val moment = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFFFFFFF.toInt() }
    private val head = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFFFFFFF.toInt(); strokeWidth = 4f }

    private val side get() = dp(18).toFloat()

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) =
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), dp(76))

    private fun span() = (windowEndMs - windowStartMs).coerceAtLeast(1)

    private fun xOf(ms: Long) = side + (width - side * 2) * ((ms - windowStartMs).toFloat() / span()).coerceIn(0f, 1f)

    private fun msOf(x: Float) = windowStartMs + (((x - side) / (width - side * 2)).coerceIn(0f, 1f) * span()).toLong()

    override fun onDraw(canvas: Canvas) {
        val top = dp(18).toFloat()
        val bottom = height - dp(10).toFloat()
        val r = dp(10).toFloat()
        canvas.drawRoundRect(side, top, width - side, bottom, r, r, rail)
        // علامة كل خمس ثوانٍ: إحساس بالطول بلا أرقام مزدحمة
        var t = ((windowStartMs + 4_999) / 5_000) * 5_000
        while (t < windowEndMs) {
            val x = xOf(t)
            canvas.drawLine(x, top + dp(14), x, bottom - dp(14), tick)
            t += 5_000
        }
        val sx = xOf(range.startMs)
        val ex = xOf(range.endMs)
        canvas.drawRoundRect(sx, top, ex, bottom, r, r, sel)
        frame.strokeWidth = dp(2).toFloat()
        canvas.drawRoundRect(RectF(sx, top, ex, bottom), r, r, frame)
        // المقبضان
        val hw = dp(14).toFloat()
        for ((x, start) in listOf(sx to true, ex to false)) {
            val left = if (start) x - hw else x
            val active = dragging == start
            handle.alpha = if (active) 255 else 235
            canvas.drawRoundRect(left, top - dp(if (active) 3 else 0), left + hw, bottom + dp(if (active) 3 else 0), dp(6).toFloat(), dp(6).toFloat(), handle)
            val cx = left + hw / 2
            canvas.drawLine(cx, top + (bottom - top) * 0.35f, cx, top + (bottom - top) * 0.65f, grip)
        }
        // اللحظة الأصلية: مثلث فوق الشريط وخط رفيع
        val mx = xOf(range.momentMs)
        val tri = Path().apply {
            moveTo(mx - dp(6), top - dp(12)); lineTo(mx + dp(6), top - dp(12)); lineTo(mx, top - dp(3)); close()
        }
        canvas.drawPath(tri, moment)
        moment.strokeWidth = dp(1.5f).toFloat()
        canvas.drawLine(mx, top, mx, bottom, moment)
        playheadMs?.let {
            val px = xOf(it)
            canvas.drawLine(px, top - dp(2), px, bottom + dp(2), head)
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                val ds = abs(e.x - xOf(range.startMs))
                val de = abs(e.x - xOf(range.endMs))
                val reach = dp(40)
                dragging = when {
                    ds > reach && de > reach -> (e.x < xOf(range.momentMs)) // لمسة بعيدة: أقرب طرف لجهتها
                    ds <= de -> true
                    else -> false
                }
                parent?.requestDisallowInterceptTouchEvent(true)
                onDrag?.invoke(dragging!!, msOf(e.x))
            }
            MotionEvent.ACTION_MOVE -> dragging?.let { onDrag?.invoke(it, msOf(e.x)) }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                dragging = null
                invalidate()
                onDragEnd?.invoke()
            }
        }
        return true
    }
}
