package com.vantara.anime.player

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Outline
import android.graphics.SurfaceTexture
import android.graphics.drawable.GradientDrawable
import android.media.MediaMetadataRetriever
import android.os.Handler
import android.os.SystemClock
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
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.max

/**
 * معاينة شريط التقدم (طلب المالك 15 نوفمبر، مثل CloudStream): مربع فوق المقبض يتبع الإصبع ويعرض إطار الموضع ووقته،
 * وحدك أو في غرفة، ولما قدّامك لا لما مررت عليه فقط.
 *
 * مصادر الإطار، كلها في ذاكرة واحدة مرتبة بالوقت:
 *  1. «لوحة القصة»: مشغّل معاينة صامت (فيديو فقط، أقل جودة، أقرب إطار مفتاحي) يجهّز في الخلفية إطارًا كل دقيقتين على
 *     الأكثر (10 إطارات على الأقل للحلقة)، الأقرب لموضعك قدّامك أولًا. لا يعمل إلا والمشاهدة مستقرة ومخزونها كافٍ.
 *     التورنت عبر قارئ معاينة لا يحرّك نافذة المشاهدة (TorrentEngine.previewDataSourceFactory).
 *  2. أثناء السحب: نفس المشغّل يقفز لموضع الإصبع، وكل إطار يصل يُحفظ.
 *  3. ما شاهدته: إطار من المشغّل نفسه كل ~12 ث (PixelCopy).
 * المشغّل يرسم في سطح مخفي خلف الفيديو (`probe`)، والمربع يعرض صورًا ثابتة فقط: لا سطح فيديو ثانٍ يظهر ويختفي.
 * إن لم يتوفر إطار قريب يبقى المربع ظاهرًا بالوقت، بلا اختفاء ولا قفز.
 */
class SeekPreview(private val ctx: Context, private val main: Handler) {
    private fun dp(v: Number) = ctx.dp(v)

    private val boxW = dp(176)
    private var boxH = dp(99)
    private val frameW = 256
    private var frameH = 144

    private val still = ImageView(ctx).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
    private val ring = View(ctx).apply {
        background = GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setStroke(dp(1.5f), 0x66FFFFFF) }
    }
    private val time = TextView(ctx).apply {
        setTextColor(Color.WHITE); textSize = 13f; typeface = android.graphics.Typeface.DEFAULT_BOLD
        background = GradientDrawable().apply { cornerRadius = dp(8).toFloat(); setColor(0xB3000000.toInt()) }
        setPadding(dp(8), dp(2), dp(8), dp(3))
    }
    /** المربع (يُضاف إلى جذر المشغّل فوق كل الطبقات). */
    val view: FrameLayout = FrameLayout(ctx).apply {
        background = GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setColor(0xFF0B0E16.toInt()) }
        outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) = outline.setRoundRect(0, 0, view.width, view.height, dp(12).toFloat())
        }
        clipToOutline = true
        elevation = dp(10).toFloat()
        addView(still, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        addView(ring, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        addView(time, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = dp(6) })
        visibility = View.GONE
    }

    /**
     * سطح مشغّل المعاينة: يُضاف أول ابن في جذر المشغّل (خلف الفيديو، فلا يُرى) ليبقى يُرسم وتُقرأ صوره بـgetBitmap.
     * سطح مخفي (GONE/INVISIBLE) لا يُنشأ أصلًا، ولهذا هو تحت الفيديو لا مخفيًا.
     */
    val probe = TextureView(ctx).apply {
        surfaceTextureListener = object : TextureView.SurfaceTextureListener {
            override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {}
            override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {}
            override fun onSurfaceTextureDestroyed(surface: SurfaceTexture) = true
            override fun onSurfaceTextureUpdated(surface: SurfaceTexture) = frameArrived()
        }
    }
    // في المنتصف: الفيديو يغطي المنتصف دائمًا (الحواف السوداء الجانبية قد لا تُرسم فوقها)
    val probeSize get() = FrameLayout.LayoutParams(frameW, frameH, Gravity.CENTER)

    // ───── الإطارات ─────
    private val frames = TreeMap<Long, Bitmap>()
    private var watchBucketMs = 12_000L
    private var lastCaptureAt = -1L
    private var copying = false
    private var durationMs = 0L

    // ───── مشغّل المعاينة ─────
    private var source: (() -> MediaSource)? = null
    private var torrent = false
    private var localFile: String? = null
    private val localDecoder = Executors.newSingleThreadExecutor()
    private var localBusy = false
    private var generation = 0L
    private var released = false
    private var preview: ExoPlayer? = null
    private var seekingTo = -1L
    private var seekStartedAt = 0L
    private var wantedMs = -1L
    private var dragging = false
    private var storyboard = ArrayDeque<Long>()
    private val attempts = HashMap<Long, Int>()
    private var restUntil = 0L
    private val giveUp = Runnable { if (seekingTo >= 0) { failed(seekingTo); seekingTo = -1; pump() } }

    /** سيرفر جديد: إطارات ولوحة قصة جديدة. `torrent`: القفزات أبطأ (قطع تُنزَّل)، فالمهلة أطول والراحة بينها أطول. */
    fun bind(source: (() -> MediaSource)?, torrent: Boolean, localFile: String? = null) {
        generation++
        wantedMs = -1L
        restUntil = 0L
        this.localFile = localFile
        releasePlayer()
        still.setImageDrawable(null)
        frames.values.forEach { it.recycle() }
        frames.clear()
        lastCaptureAt = -1L
        storyboard.clear(); attempts.clear(); durationMs = 0L
        this.source = source
        this.torrent = torrent
    }

    fun aspect(width: Int, height: Int) {
        if (width <= 0 || height <= 0) return
        boxH = (boxW * height.toFloat() / width).toInt().coerceIn(dp(72), dp(132))
        val h = (frameW * height.toFloat() / width).toInt().coerceIn(96, 192)
        if (h != frameH) { frameH = h; probe.layoutParams = probe.layoutParams?.apply { this.height = h } }
    }

    /** خطوة لوحة القصة: دقيقتان على الأكثر، و10 إطارات على الأقل للحلقة. */
    private fun storyStep() = if (durationMs > 0) minOf(120_000L, durationMs / 10).coerceAtLeast(20_000L) else 120_000L

    /**
     * كل 500ms من المشغّل: يلتقط ما تشاهده، ويُكمل لوحة القصة إن كانت المشاهدة مستقرة (`healthy`: تعمل، وقدّامها مخزون).
     */
    fun tick(surface: View?, positionMs: Long, duration: Long, playing: Boolean, healthy: Boolean) {
        if (duration > 0 && duration != durationMs) {
            durationMs = duration
            watchBucketMs = max(12_000L, duration / 120)
            val step = storyStep()
            storyboard = ArrayDeque((0 until (duration / step).toInt().coerceAtLeast(1)).map { step / 2 + it * step }.filter { it < duration })
        }
        if (playing) capture(surface, positionMs)
        if (localFile == null && healthy && !dragging && seekingTo < 0 && SystemClock.uptimeMillis() >= restUntil) nextStory(positionMs)
    }

    private fun nextStory(positionMs: Long) {
        if (source == null || storyboard.isEmpty()) return
        // الأقرب قدّامك أولًا، ثم ما خلفك؛ ما له إطار قريب من المشاهدة لا يُكرَّر
        val near = max(15_000L, watchBucketMs)
        storyboard.removeAll { t -> frameNear(t, near) || (attempts[t] ?: 0) >= 3 }
        val next = storyboard.filter { it >= positionMs }.minOrNull() ?: storyboard.maxOrNull() ?: return
        wantedMs = next
        pump()
    }

    private fun frameNear(ms: Long, within: Long): Boolean {
        val lo = frames.floorKey(ms); val hi = frames.ceilingKey(ms)
        return (lo != null && ms - lo <= within) || (hi != null && hi - ms <= within)
    }

    private fun capture(surface: View?, positionMs: Long) {
        val sv = surface as? SurfaceView ?: return
        if (copying || durationMs <= 0 || !sv.holder.surface.isValid) return
        val bucket = positionMs / watchBucketMs * watchBucketMs
        if (bucket == lastCaptureAt || frames.containsKey(bucket)) return
        val bmp = Bitmap.createBitmap(frameW, frameH, Bitmap.Config.ARGB_8888)
        copying = true
        lastCaptureAt = bucket
        val captureGeneration = generation
        runCatching {
            PixelCopy.request(sv, bmp, { result ->
                copying = false
                if (captureGeneration == generation && result == PixelCopy.SUCCESS && !blank(bmp)) store(bucket, bmp) else bmp.recycle()
            }, main)
        }.onFailure { copying = false; bmp.recycle() }
    }

    private fun store(at: Long, bmp: Bitmap) {
        frames.put(at, bmp)?.let { old -> if (old !== bmp) { if (isShowing(old)) still.setImageBitmap(bmp); old.recycle() } }
        if (frames.size > 120) {
            val oldest = frames.entries.firstOrNull { it.key != at && !isShowing(it.value) }
            oldest?.let { frames.remove(it.key)?.recycle() }
        }
    }
    private fun isShowing(b: Bitmap) = (still.drawable as? android.graphics.drawable.BitmapDrawable)?.bitmap === b

    /** إطار أسود تمامًا (قبل أول إطار أو محتوى محمي) لا يُحفظ. */
    private fun blank(b: Bitmap): Boolean {
        val xs = intArrayOf(b.width / 4, b.width / 2, b.width * 3 / 4)
        val ys = intArrayOf(b.height / 4, b.height / 2, b.height * 3 / 4)
        return xs.all { x -> ys.all { y -> (b.getPixel(x, y) and 0xFFFFFF) == 0 } }
    }

    /** بداية السحب أو حركته: `centerX` مركز المقبض و`top` أعلى صف الوقت، كلاهما بإحداثيات جذر المشغّل. */
    fun show(ms: Long, centerX: Float, top: Float, parentWidth: Int) {
        dragging = true
        if (view.visibility != View.VISIBLE) {
            view.layoutParams = (view.layoutParams as? FrameLayout.LayoutParams ?: FrameLayout.LayoutParams(boxW, boxH)).apply {
                width = boxW; height = boxH; gravity = Gravity.TOP or Gravity.LEFT
            }
            view.visibility = View.VISIBLE
        }
        val margin = dp(12).toFloat()
        view.translationX = (centerX - boxW / 2f).coerceIn(margin, max(margin, parentWidth - boxW - margin))
        view.translationY = top - boxH - dp(6)
        time.text = ClipMath.clock(ms)
        val near = nearest(ms)
        if (near != null) { if (!isShowing(near)) still.setImageBitmap(near) } else still.setImageDrawable(null)
        // إطار دقيق للموضع إن لم يكن هناك إطار خلال ثانيتين منه
        if (!frameNear(ms, 2_000L)) { wantedMs = ms; pump() }
    }

    fun hide() {
        dragging = false
        view.visibility = View.GONE
        wantedMs = -1L
    }

    private fun nearest(ms: Long): Bitmap? {
        val lo = frames.floorEntry(ms); val hi = frames.ceilingEntry(ms)
        val best = listOfNotNull(lo, hi).minByOrNull { abs(it.key - ms) } ?: return null
        // لوحة القصة كل دقيقتين على الأكثر: أي موضع له إطار خلال دقيقة منه
        return best.value.takeIf { abs(best.key - ms) <= max(30_000L, storyStep() / 2 + 5_000L) }
    }

    private fun player(): ExoPlayer? {
        preview?.let { return it }
        val make = source ?: return null
        return runCatching {
            ExoPlayer.Builder(ctx).build().apply {
                trackSelectionParameters = trackSelectionParameters.buildUpon()
                    .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, true)
                    .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                    .setMaxVideoSize(854, 480)
                    .setForceLowestBitrate(true)
                    .build()
                setSeekParameters(SeekParameters.CLOSEST_SYNC)
                volume = 0f
                setVideoTextureView(probe)
                addListener(object : Player.Listener {
                    override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                        // قارئ المعاينة فشل (قطعة لم تصل، رابط انتهى): يُعاد بناؤه عند الطلب التالي
                        if (seekingTo >= 0) failed(seekingTo)
                        main.post { releasePlayer(); restUntil = SystemClock.uptimeMillis() + 10_000L }
                    }
                })
                setMediaSource(make())
                playWhenReady = false
                prepare()
            }
        }.getOrNull()?.also { preview = it }
    }

    /** قفزة واحدة في الطريق دائمًا: لا طابور خلف الإصبع، والسحب يسبق لوحة القصة. */
    private fun pump() {
        if (released || localBusy || seekingTo >= 0 || wantedMs < 0) return
        val path = localFile
        if (path != null) {
            decodeLocal(path)
            return
        }
        val p = player() ?: return
        val target = wantedMs
        wantedMs = -1L
        seekingTo = target
        seekStartedAt = SystemClock.uptimeMillis()
        p.seekTo(target)
        main.removeCallbacks(giveUp)
        main.postDelayed(giveUp, if (torrent) 30_000L else 8_000L)
    }

    /** ملف MP4/MKV ونحوه: استخراج إطار عند الطلب من القرص، من دون سطح أو جلسة شبكة. */
    private fun decodeLocal(path: String) {
        val requestGeneration = generation
        val at = wantedMs
        val height = frameH
        wantedMs = -1L
        localBusy = true
        localDecoder.execute {
            val bitmap = runCatching {
                val retriever = MediaMetadataRetriever()
                try {
                    retriever.setDataSource(path)
                    retriever.getScaledFrameAtTime(at * 1000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, frameW, height)
                } finally {
                    retriever.release()
                }
            }.getOrNull()
            main.post {
                localBusy = false
                if (requestGeneration != generation) {
                    bitmap?.recycle()
                } else if (bitmap != null) {
                    store(at, bitmap)
                    if (dragging) nearest(currentShownMs())?.let { if (!isShowing(it)) still.setImageBitmap(it) }
                } else {
                    // حاوية يشغّلها Media3 ولا يستخرج إطارها نظام Android.
                    localFile = null
                    if (dragging && wantedMs < 0) wantedMs = at
                }
                pump()
            }
        }
    }

    /** إطار جديد في سطح المعاينة: يُحفظ عند موضعه ويُعرض إن كان الإصبع قريبًا منه. */
    private fun frameArrived() {
        val at = seekingTo
        if (at < 0 || SystemClock.uptimeMillis() - seekStartedAt < 40) return
        main.removeCallbacks(giveUp)
        seekingTo = -1
        val bmp = runCatching { probe.getBitmap(Bitmap.createBitmap(frameW, frameH, Bitmap.Config.ARGB_8888)) }.getOrNull()
        if (bmp != null && !blank(bmp)) {
            store(at, bmp)
            storyboard.remove(at)
            if (dragging) nearest(currentShownMs())?.let { if (!isShowing(it)) still.setImageBitmap(it) }
        } else bmp?.recycle()
        // راحة بين إطارات لوحة القصة: لا تزاحم المشاهدة (التورنت أطول)
        if (!dragging) restUntil = SystemClock.uptimeMillis() + if (torrent) 4_000L else 1_500L
        pump()
    }

    private fun currentShownMs(): Long = time.text?.toString()?.let { t ->
        t.split(':').mapNotNull { it.toLongOrNull() }.fold(0L) { acc, v -> acc * 60 + v } * 1000
    } ?: 0L

    private fun failed(at: Long) { attempts[at] = (attempts[at] ?: 0) + 1 }

    private fun releasePlayer() {
        main.removeCallbacks(giveUp)
        preview?.release()
        preview = null
        seekingTo = -1L
    }

    fun release() {
        released = true
        generation++
        localDecoder.shutdown()
        hide()
        releasePlayer()
        still.setImageDrawable(null)
        frames.values.forEach { it.recycle() }
        frames.clear()
    }
}
