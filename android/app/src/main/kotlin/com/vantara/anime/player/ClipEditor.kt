package com.vantara.anime.player

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.SeekParameters
import com.vantara.anime.stream.Candidate
import okhttp3.OkHttpClient

/**
 * محرّر «الكاميرا»: مقطع فيديو حول اللحظة، لا لقطة شاشة.
 *
 * المعاينة حيّة وفورية بلا أي ملف: المشغّل نفسه يدور داخل المدى المختار
 * (من البداية للنهاية ثم يعود)، من ذاكرته — المشغّل يحتفظ بآخر 40 ثانية
 * ([PlayerActivity.BACK_BUFFER_MS]) فالرجوع لما قبل اللحظة لا يُنزّل شيئًا.
 * لا يُصنع ملف إلا عند «حفظ» أو «مشاركة»، ويُحذف عند الإغلاق.
 * حين يُغلق المحرّر يرجع المشغّل للحظة الأصلية كما كان ([onClosed]).
 */
@OptIn(UnstableApi::class)
class ClipEditor(
    private val activity: PlayerActivity,
    private val root: FrameLayout,
    private val player: ExoPlayer,
    private val candidate: Candidate,
    initial: ClipRange,
    private val durationMs: Long,
    client: OkHttpClient,
    private val episodeLabel: String,
    private val title: String,
    /** بداية مقطع HLS الذي يحوي الموضع (إطار مفتاحي)، أو null. */
    private val keyframeAt: (Long) -> Long?,
    private val onClosed: () -> Unit,
) {
    private val ctx = activity
    private val main = Handler(Looper.getMainLooper())
    private val exporter = ClipExporter(ctx, client)
    private var range = initial
    private var previewing = false
    private var unsupported = false
    private var lastScrub = 0L
    private var closed = false

    private val panel: LinearLayout
    private val timeline = ClipTimeline(ctx)
    private val startText: TextView
    private val lengthText: TextView
    private val endText: TextView
    private val previewButton: TextView
    private val actions: LinearLayout
    private val busy: LinearLayout
    private val busyBar: ProgressBar
    private val busyText: TextView
    private val saveButton: View
    private val shareButton: View

    private val previewTick = object : Runnable {
        override fun run() {
            if (!previewing) return
            val pos = player.currentPosition
            timeline.playheadMs = pos
            if (pos >= range.endMs) player.seekTo(range.startMs)
            main.postDelayed(this, 40)
        }
    }

    init {
        val (lo, hi) = ClipMath.bounds(range.momentMs, durationMs)
        timeline.windowStartMs = lo
        timeline.windowEndMs = hi
        timeline.range = range
        timeline.onDrag = { start, to ->
            stopPreview()
            range = if (start) ClipMath.moveStart(range, to, durationMs) else ClipMath.moveEnd(range, to, durationMs)
            timeline.range = range
            paintStats()
            // إطار المقبض يظهر في الفيديو أثناء السحب (أسرع إطار مفتاحي)
            val now = System.currentTimeMillis()
            if (now - lastScrub > 150) {
                lastScrub = now
                player.setSeekParameters(SeekParameters.CLOSEST_SYNC)
                player.seekTo(if (start) range.startMs else range.endMs)
            }
        }
        timeline.onDragEnd = { startPreview() }

        panel = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            background = GradientDrawable().apply {
                setColor(0xF20D111B.toInt())
                val r = ctx.dp(24).toFloat()
                cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
                setStroke(ctx.dp(1), Tone.LINE)
            }
            setPadding(ctx.dp(20), ctx.dp(12), ctx.dp(20), ctx.dp(14))
            swallowTouches()
        }

        // الرأس: إغلاق، العنوان، معاينة
        val head = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        head.addView(ctx.iconButton(Glyph.Kind.CLOSE, iconDp = 20, boxDp = 44, desc = "إغلاق") { close() })
        head.addView(LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(ctx.dp(8), 0, ctx.dp(8), 0)
            addView(ctx.label("مقطع من $episodeLabel", 15.5f, Tone.TEXT, bold = true))
            addView(ctx.label("اللحظة ${ClipMath.clock(range.momentMs)} · اسحب الطرفين حتى 35 ث قبلها وبعدها", 12f, Tone.TEXT_3).apply { setPadding(0, ctx.dp(4), 0, 0) })
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        previewButton = activity.pillButton("معاينة", primary = false) { togglePreview() }.apply {
            setCompoundDrawablesRelativeWithIntrinsicBounds(Glyph(Glyph.Kind.PLAY, Color.WHITE, ctx.dp(14)), null, null, null)
            compoundDrawablePadding = ctx.dp(6)
        }
        head.addView(previewButton)
        panel.addView(head)

        // البداية · المدة · النهاية (باتجاه خط الزمن: يسار←يمين)
        val stats = FrameLayout(ctx).apply { layoutDirection = View.LAYOUT_DIRECTION_LTR }
        startText = stat()
        lengthText = ctx.label("", 20f, Tone.TEXT, bold = true)
        endText = stat()
        stats.addView(startText, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.LEFT or Gravity.CENTER_VERTICAL))
        stats.addView(lengthText, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        stats.addView(endText, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.RIGHT or Gravity.CENTER_VERTICAL))
        panel.addView(stats, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = ctx.dp(12); leftMargin = ctx.dp(18); rightMargin = ctx.dp(18)
        })
        timeline.layoutDirection = View.LAYOUT_DIRECTION_LTR
        panel.addView(timeline, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        actions = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        saveButton = action(Glyph.Kind.SAVE, "حفظ") { save() }
        shareButton = action(Glyph.Kind.SHARE, "مشاركة") { share() }
        actions.addView(saveButton, weight())
        actions.addView(shareButton, weight())
        actions.addView(action(Glyph.Kind.SEND, "أرسل لصديق") { sendToFriend() }, weight())
        actions.addView(action(Glyph.Kind.SPARK, "في المجلس") { activity.queueMoment(null, "الجميع", range) }, weight())
        panel.addView(actions, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = ctx.dp(6) })

        busyBar = ProgressBar(ctx, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progressTintList = android.content.res.ColorStateList.valueOf(Tone.ACCENT)
            progressBackgroundTintList = android.content.res.ColorStateList.valueOf(Tone.SURFACE_3)
        }
        busyText = ctx.label("", 13f, Tone.TEXT_2, bold = true)
        busy = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            visibility = View.GONE
            minimumHeight = ctx.dp(64)
            addView(busyText, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(busyBar, LinearLayout.LayoutParams(0, ctx.dp(6), 1f).apply { marginStart = ctx.dp(12); marginEnd = ctx.dp(12) })
            addView(activity.pillButton("إلغاء", primary = false) { cancelExport() })
        }
        panel.addView(busy, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = ctx.dp(6) })

        root.addView(panel, FrameLayout.LayoutParams(minOf(root.width.takeIf { it > 0 } ?: Int.MAX_VALUE, ctx.dp(720)), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL))
        panel.translationY = ctx.dp(300).toFloat()
        panel.animate().translationY(0f).setDuration(240).start()
        paintStats()
        // المعاينة تبدأ فورًا: لا إيقاف ولا ملف، المشغّل يدور داخل المدى
        startPreview()
    }

    private fun stat() = ctx.label("", 12.5f, Tone.TEXT_2, bold = true)

    private fun weight() = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = ctx.dp(8) }

    private fun action(kind: Glyph.Kind, text: String, onClick: () -> Unit): View = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        textAlignment = View.TEXT_ALIGNMENT_CENTER
        minimumHeight = ctx.dp(64)
        background = pressable(Tone.SURFACE_2, ctx.dp(16).toFloat())
        addView(ImageView(ctx).apply { setImageDrawable(Glyph(kind, Color.WHITE)) }, LinearLayout.LayoutParams(ctx.dp(22), ctx.dp(22)))
        addView(ctx.label(text, 12.5f, Tone.TEXT, bold = true).apply { setPadding(0, ctx.dp(6), 0, 0); textAlignment = View.TEXT_ALIGNMENT_CENTER })
        setOnClickListener { onClick() }
    }

    private fun paintStats() {
        startText.text = "البداية  ${ClipMath.clock(range.startMs)}"
        endText.text = "${ClipMath.clock(range.endMs)}  النهاية"
        lengthText.text = ClipMath.length(range.durationMs)
    }

    private fun togglePreview() = if (previewing) stopPreview() else startPreview()

    private fun startPreview() {
        if (closed) return
        previewing = true
        main.removeCallbacks(previewTick)
        player.setSeekParameters(SeekParameters.EXACT)
        player.seekTo(range.startMs)
        player.playWhenReady = true
        previewButton.text = "إيقاف"
        previewButton.setCompoundDrawablesRelativeWithIntrinsicBounds(Glyph(Glyph.Kind.PAUSE, Color.WHITE, ctx.dp(14)), null, null, null)
        main.post(previewTick)
    }

    private fun stopPreview() {
        if (!previewing) return
        previewing = false
        player.playWhenReady = false
        timeline.playheadMs = null
        previewButton.text = "معاينة"
        previewButton.setCompoundDrawablesRelativeWithIntrinsicBounds(Glyph(Glyph.Kind.PLAY, Color.WHITE, ctx.dp(14)), null, null, null)
        main.removeCallbacks(previewTick)
    }

    /** من ساعة المشغّل؛ المعاينة لها ساعتها الأدق. */
    fun tick(@Suppress("UNUSED_PARAMETER") pos: Long) = Unit

    private fun run(what: String, then: (java.io.File) -> Unit) {
        if (unsupported) return activity.message("هذا السيرفر لا يسمح بقصّ المقاطع — بدّل السيرفر أو أرسل اللحظة")
        if (exporter.busy) return
        stopPreview()
        actions.visibility = View.GONE
        busy.visibility = View.VISIBLE
        busyText.text = "نجهّز المقطع"
        busyBar.progress = 0
        exporter.export(
            candidate, range, keyframeAt(range.startMs),
            onProgress = { p ->
                busyBar.progress = p
                busyText.text = "نجهّز المقطع $p٪"
            },
            onResult = { r ->
                if (closed) return@export
                busy.visibility = View.GONE
                actions.visibility = View.VISIBLE
                when (r) {
                    is ClipExporter.Result.Done -> {
                        val from = exporter.lastStartMs
                        if (from != null && from < range.startMs - 500) activity.message("القصّ المباشر يبدأ من أقرب نقطة قطع: ${ClipMath.clock(from)}")
                        then(r.file)
                    }
                    is ClipExporter.Result.Failed -> {
                        if (r.unsupported) {
                            unsupported = true
                            saveButton.alpha = 0.4f
                            shareButton.alpha = 0.4f
                        }
                        activity.message(r.message, long = true)
                    }
                }
            },
        )
        activity.message("$what: قصّ مباشر لـ${ClipMath.length(range.durationMs)} فقط، بلا إعادة ترميز")
    }

    private fun save() = run("حفظ") { file ->
        val uri = exporter.saveToGallery(file, activity.clipName(range))
        // النسخة في المعرض مستقلة: الملف المؤقت يُحذف فورًا
        exporter.purge()
        activity.message(if (uri != null) "حُفظ المقطع في المعرض (Movies/VANTARA)" else "تعذّر الحفظ في المعرض")
    }

    private fun share() = run("مشاركة") { file -> activity.shareClip(file, range) }

    private fun sendToFriend() {
        stopPreview()
        activity.pickFriend("أرسل اللحظة") { to, name -> activity.queueMoment(to, name, range) }
    }

    private fun cancelExport() {
        exporter.cancel()
        busy.visibility = View.GONE
        actions.visibility = View.VISIBLE
    }

    fun close() {
        if (closed) return
        closed = true
        stopPreview()
        exporter.cancel()
        // المشاركة انتهت بالعودة هنا: لا يبقى ملف مقطع على الجهاز
        exporter.purge()
        panel.animate().translationY(panel.height.toFloat()).setDuration(200).withEndAction { root.removeView(panel) }.start()
        onClosed()
    }

    fun release() {
        closed = true
        main.removeCallbacksAndMessages(null)
        exporter.cancel()
        exporter.purge()
    }
}
