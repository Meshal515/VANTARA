package com.vantara.anime.player

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.view.MotionEvent
import android.view.View

/**
 * شريط التقدّم: خط رفيع (3dp) بهدف لمس كبير (44dp)، والمقبض يكبر عند السحب.
 * اتجاهه يسار←يمين دائمًا مثل كل مشغّلات الفيديو، حتى في واجهة عربية.
 */
class TimeBar(context: Context) : View(context) {
    var durationMs = 0L
        set(v) { field = v; invalidate() }
    var positionMs = 0L
        set(v) { if (!dragging) { field = v; invalidate() } }
    var bufferedMs = 0L
        set(v) { field = v; invalidate() }

    /** أثناء السحب (للمعاينة)، وعند الإفلات (للقفز). */
    var onScrub: ((Long) -> Unit)? = null
    var onSeek: ((Long) -> Unit)? = null
    var onDragState: ((Boolean) -> Unit)? = null

    private var dragging = false
    private var dragMs = 0L
    private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x40FFFFFF }
    private val buffered = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x66FFFFFF }
    private val played = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Tone.ACCENT }
    private val thumb = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Tone.ACCENT }
    private val halo = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x403B82F6 }

    private val pad get() = dp(10).toFloat()

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), dp(44))
    }

    private fun xOf(ms: Long): Float {
        val w = width - pad * 2
        return pad + if (durationMs > 0) w * (ms.coerceIn(0, durationMs).toFloat() / durationMs) else 0f
    }

    private fun msOf(x: Float): Long {
        val w = width - pad * 2
        return if (w <= 0 || durationMs <= 0) 0 else (((x - pad) / w).coerceIn(0f, 1f) * durationMs).toLong()
    }

    override fun onDraw(canvas: Canvas) {
        val cy = height / 2f
        val h = dp(if (dragging) 4 else 3).toFloat()
        val r = h / 2
        canvas.drawRoundRect(pad, cy - r, width - pad, cy + r, r, r, track)
        canvas.drawRoundRect(pad, cy - r, xOf(bufferedMs), cy + r, r, r, buffered)
        val at = if (dragging) dragMs else positionMs
        val x = xOf(at)
        canvas.drawRoundRect(pad, cy - r, x, cy + r, r, r, played)
        if (dragging) canvas.drawCircle(x, cy, dp(14).toFloat(), halo)
        canvas.drawCircle(x, cy, dp(if (dragging) 8 else 6).toFloat(), thumb)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        if (durationMs <= 0) return false
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                parent?.requestDisallowInterceptTouchEvent(true)
                dragging = true
                dragMs = msOf(e.x)
                onDragState?.invoke(true)
                onScrub?.invoke(dragMs)
                invalidate()
            }
            MotionEvent.ACTION_MOVE -> {
                dragMs = msOf(e.x)
                onScrub?.invoke(dragMs)
                invalidate()
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                dragging = false
                positionMs = dragMs
                onDragState?.invoke(false)
                if (e.actionMasked == MotionEvent.ACTION_UP) onSeek?.invoke(dragMs)
                invalidate()
            }
        }
        return true
    }
}
