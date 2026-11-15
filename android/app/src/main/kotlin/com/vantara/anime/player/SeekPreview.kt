package com.vantara.anime.player

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Outline
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.view.Gravity
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.SeekParameters
import androidx.media3.exoplayer.source.MediaSource
import java.util.TreeMap
import kotlin.math.abs
import kotlin.math.max

/**
 * معاينة شريط التقدم (طلب المالك 15 نوفمبر، مثل CloudStream): مربع فوق المقبض يتبع الإصبع ويعرض إطار الموضع ووقته،
 * في كل تشغيل، وحدك أو في غرفة.
 *
 * مصدران للإطار:
 *  1. مشغّل معاينة ثانٍ صامت (فيديو فقط، أقل جودة، أقرب إطار مفتاحي) على نفس مصدر البيانات والكاش والترويسات.
 *     للروابط المباشرة وHLS فقط. التورنت مستثنى، لأن قارئًا ثانيًا يغيّر أولوية القطع ويسرق تحميل المشاهدة نفسها.
 *  2. إطارات تُلتقط من المشغّل نفسه أثناء المشاهدة (PixelCopy)، بعدد محدود (240 إطارًا كحد أعلى، نحو 14MB).
 *     تظهر فورًا قبل وصول إطار المعاينة، وهي وحدها مصدر التورنت (يعرض أقرب إطار حتى 30 ثانية من الموضع).
 * إن لم يتوفر إطار يبقى المربع ظاهرًا بالوقت، بلا اختفاء ولا قفز.
 */
class SeekPreview(private val ctx: Context, private val main: Handler) {
    private fun dp(v: Number) = ctx.dp(v)

    private val boxW = dp(176)
    private var boxH = dp(99)
    private val frame = FrameLayout(ctx).apply {
        background = GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setColor(0xFF0B0E16.toInt()) }
        outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) = outline.setRoundRect(0, 0, view.width, view.height, dp(12).toFloat())
        }
        clipToOutline = true
        elevation = dp(10).toFloat()
    }
    private val still = ImageView(ctx).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
    private val live = TextureView(ctx).apply { alpha = 0f }
    private val ring = View(ctx).apply {
        background = GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setStroke(dp(1.5f), 0x66FFFFFF) }
    }
    private val time = TextView(ctx).apply {
        setTextColor(Color.WHITE); textSize = 13f; typeface = android.graphics.Typeface.DEFAULT_BOLD
        background = GradientDrawable().apply { cornerRadius = dp(8).toFloat(); setColor(0xB3000000.toInt()) }
        setPadding(dp(8), dp(2), dp(8), dp(3))
    }
    /** المربع كاملًا (يُضاف إلى جذر المشغّل فوق كل الطبقات). */
    val view: FrameLayout = frame.apply {
        addView(still, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        addView(live, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        addView(ring, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        addView(time, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = dp(6) })
        visibility = View.GONE
    }

    // ───── إطارات المشاهدة ─────
    private val frames = TreeMap<Long, Bitmap>()
    private var bucketMs = 6_000L
    private var lastCaptureAt = -1L
    private var copying = false

    // ───── مشغّل المعاينة ─────
    private var source: (() -> MediaSource)? = null
    private var preview: ExoPlayer? = null
    private var seeking = false
    private var targetMs = -1L
    private var wantedMs = -1L
    private var renderedMs = -1L
    private val unstick = Runnable { seeking = false; pump() }

    /** سيرفر جديد: إطارات وأبعاد جديدة. `source` null للتورنت (إطارات المشاهدة فقط). */
    fun bind(source: (() -> MediaSource)?) {
        releasePlayer()
        still.setImageDrawable(null)
        frames.values.forEach { it.recycle() }
        frames.clear()
        lastCaptureAt = -1L
        this.source = source
    }

    fun aspect(width: Int, height: Int) {
        if (width <= 0 || height <= 0) return
        boxH = (boxW * height.toFloat() / width).toInt().coerceIn(dp(72), dp(132))
    }

    /** يُستدعى مع تحديث الشريط أثناء التشغيل: يلتقط إطارًا كل فترة ثابتة من سطح الفيديو. */
    fun capture(surface: View?, positionMs: Long, durationMs: Long) {
        val sv = surface as? SurfaceView ?: return
        if (copying || durationMs <= 0 || !sv.holder.surface.isValid) return
        bucketMs = max(6_000L, durationMs / 240)
        val bucket = positionMs / bucketMs * bucketMs
        if (bucket == lastCaptureAt || frames.containsKey(bucket)) return
        val bmp = Bitmap.createBitmap(dp(160).coerceAtMost(320), (dp(160).coerceAtMost(320) * boxH / boxW).coerceAtLeast(1), Bitmap.Config.ARGB_8888)
        copying = true
        lastCaptureAt = bucket
        runCatching {
            PixelCopy.request(sv, bmp, { result ->
                copying = false
                if (result == PixelCopy.SUCCESS && !blank(bmp)) frames.put(bucket, bmp)?.recycle() else bmp.recycle()
            }, main)
        }.onFailure { copying = false; bmp.recycle() }
    }

    /** إطار أسود تمامًا (قبل أول إطار أو محتوى محمي) لا يُحفظ. */
    private fun blank(b: Bitmap): Boolean {
        val xs = intArrayOf(b.width / 4, b.width / 2, b.width * 3 / 4)
        val ys = intArrayOf(b.height / 4, b.height / 2, b.height * 3 / 4)
        return xs.all { x -> ys.all { y -> (b.getPixel(x, y) and 0xFFFFFF) == 0 } }
    }

    /** بداية السحب أو حركته: `centerX` مركز المقبض و`barTop` أعلى الشريط، كلاهما بإحداثيات جذر المشغّل. */
    fun show(ms: Long, centerX: Float, barTop: Float, parentWidth: Int) {
        if (view.visibility != View.VISIBLE) {
            view.layoutParams = (view.layoutParams as? FrameLayout.LayoutParams ?: FrameLayout.LayoutParams(boxW, boxH)).apply {
                width = boxW; height = boxH; gravity = Gravity.TOP or Gravity.LEFT
            }
            view.visibility = View.VISIBLE
        }
        val margin = dp(12).toFloat()
        view.translationX = (centerX - boxW / 2f).coerceIn(margin, max(margin, parentWidth - boxW - margin))
        view.translationY = barTop - boxH - dp(6)
        time.text = ClipMath.clock(ms)
        nearest(ms)?.let { still.setImageBitmap(it) }
        val hasNear = nearest(ms) != null
        // إطار المعاينة القديم يبقى ما دام قريبًا؛ وإلا يختفي حتى يصل إطار الموضع الجديد
        if (renderedMs < 0 || abs(renderedMs - ms) > (if (hasNear) 2_500L else 20_000L)) live.alpha = 0f
        request(ms)
    }

    fun hide() {
        view.visibility = View.GONE
        wantedMs = -1L
        preview?.playWhenReady = false
    }

    private fun nearest(ms: Long): Bitmap? {
        val lo = frames.floorEntry(ms); val hi = frames.ceilingEntry(ms)
        val best = listOfNotNull(lo, hi).minByOrNull { abs(it.key - ms) } ?: return null
        return best.value.takeIf { abs(best.key - ms) <= max(30_000L, bucketMs * 2) }
    }

    private fun request(ms: Long) {
        val make = source ?: return
        wantedMs = ms
        val p = preview ?: runCatching { create(make()) }.getOrNull() ?: return
        if (preview == null) preview = p
        pump()
    }

    private fun create(media: MediaSource): ExoPlayer = ExoPlayer.Builder(ctx).build().apply {
        trackSelectionParameters = trackSelectionParameters.buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, true)
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
            .setMaxVideoSize(854, 480)
            .setForceLowestBitrate(true)
            .build()
        setSeekParameters(SeekParameters.CLOSEST_SYNC)
        volume = 0f
        setVideoTextureView(live)
        addListener(object : Player.Listener {
            override fun onRenderedFirstFrame() = landed()
            override fun onPlaybackStateChanged(state: Int) { if (state == Player.STATE_READY && seeking) main.postDelayed({ if (seeking) landed() }, 120) }
        })
        setMediaSource(media)
        playWhenReady = false
        prepare()
    }

    private fun landed() {
        main.removeCallbacks(unstick)
        seeking = false
        renderedMs = targetMs
        if (view.visibility == View.VISIBLE && abs(targetMs - wantedMs) <= 2_500L) live.animate().alpha(1f).setDuration(90).start()
        pump()
    }

    /** طلب واحد في الطريق دائمًا: لا طابور قفزات خلف الإصبع. */
    private fun pump() {
        val p = preview ?: return
        if (seeking || wantedMs < 0 || abs(wantedMs - targetMs) < 1_000L && renderedMs == targetMs) return
        targetMs = wantedMs
        seeking = true
        p.seekTo(targetMs)
        main.removeCallbacks(unstick)
        main.postDelayed(unstick, 2_500)
    }

    private fun releasePlayer() {
        main.removeCallbacks(unstick)
        preview?.release()
        preview = null
        seeking = false; targetMs = -1L; renderedMs = -1L
        live.alpha = 0f
    }

    fun release() {
        hide()
        releasePlayer()
        still.setImageDrawable(null)
        frames.values.forEach { it.recycle() }
        frames.clear()
    }
}
