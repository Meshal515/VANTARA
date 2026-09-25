package com.vantara.anime.player

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import com.vantara.anime.AnimeEngine
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.Container
import com.vantara.anime.stream.PlaybackSession
import eu.kanade.tachiyomi.network.NetworkHelper
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.get

/**
 * مشغّل VANTARA — Media3 أصلي.
 *
 * لا يعرف أي مصدر ولا أي سيرفر: يأخذ جلسة ([PlaybackSession]) ويشغّل أول
 * مرشّح. عند أي عطل (خطأ شبكة/صيغة، أو لم يبدأ خلال [STARTUP_TIMEOUT_MS])
 * يبلّغ الجلسة فتعطيه التالي، فيكمل **من نفس الثانية**. المستخدم يرى سطرًا
 * صغيرًا «انتقلنا لسيرفر آخر» لا شاشة خطأ.
 *
 * الترويسات (Referer/User-Agent) من المرشّح نفسه، والكوكيز (cf_clearance)
 * من عميل OkHttp المشترك، فما يعمل في المحرك يعمل في المشغّل.
 */
@OptIn(UnstableApi::class)
class PlayerActivity : Activity() {

    private lateinit var player: ExoPlayer
    private lateinit var view: PlayerView
    private lateinit var status: TextView
    private var session: PlaybackSession? = null
    private var sessionId: String = ""
    private var current: Candidate? = null
    private var startedAt = 0L
    private var reportedStart = false
    private val main = Handler(Looper.getMainLooper())
    private val network: NetworkHelper by lazy { Injekt.get<NetworkHelper>() }

    private val startupWatchdog = Runnable {
        if (!reportedStart) fail("لم يبدأ خلال ${STARTUP_TIMEOUT_MS / 1000} ثانية")
    }
    private val progressTick = object : Runnable {
        override fun run() {
            report(final = false)
            main.postDelayed(this, PROGRESS_EVERY_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }

        sessionId = intent.getStringExtra(EXTRA_SESSION).orEmpty()
        session = AnimeEngine.get(this).session(sessionId)
        val title = intent.getStringExtra(EXTRA_TITLE).orEmpty()
        val start = intent.getLongExtra(EXTRA_POSITION, 0L)

        player = ExoPlayer.Builder(this).build()
        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY && !reportedStart) {
                    reportedStart = true
                    main.removeCallbacks(startupWatchdog)
                    current?.let { session?.started(it, System.currentTimeMillis() - startedAt) }
                    status.visibility = View.GONE
                }
                if (state == Player.STATE_ENDED) report(final = true)
            }

            override fun onPlayerError(error: PlaybackException) {
                fail(error.errorCodeName)
            }
        })

        view = PlayerView(this).apply {
            player = this@PlayerActivity.player
            setShowSubtitleButton(true)
            keepScreenOn = true
            setBackgroundColor(Color.BLACK)
        }
        status = TextView(this).apply {
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(14), dp(8), dp(14), dp(8))
            background = GradientDrawable().apply {
                cornerRadius = dp(12).toFloat()
                setColor(0xB3000000.toInt())
            }
            textDirection = View.TEXT_DIRECTION_RTL
        }
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        root.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.END
                addView(TextView(context).apply {
                    text = title
                    setTextColor(Color.WHITE)
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                    typeface = Typeface.DEFAULT_BOLD
                    setShadowLayer(8f, 0f, 1f, Color.BLACK)
                })
                addView(status, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
            },
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.END).apply {
                setMargins(dp(24), dp(18), dp(24), 0)
            },
        )
        setContentView(root)

        val first = session?.next()
        if (first == null) {
            showStatus("لا توجد سيرفرات متاحة لهذه الحلقة")
            main.postDelayed({ finish() }, 2500)
            return
        }
        play(first, start)
        main.postDelayed(progressTick, PROGRESS_EVERY_MS)
    }

    private fun play(c: Candidate, positionMs: Long) {
        current = c
        reportedStart = false
        startedAt = System.currentTimeMillis()
        showStatus("${c.sourceName} · ${c.server}${c.quality?.let { " · ${it}p" } ?: ""}")
        val http = OkHttpDataSource.Factory(network.client).setDefaultRequestProperties(c.headers)
        val item = MediaItem.Builder()
            .setUri(c.url)
            .apply {
                when (c.container) {
                    Container.HLS -> setMimeType(MimeTypes.APPLICATION_M3U8)
                    Container.DASH -> setMimeType(MimeTypes.APPLICATION_MPD)
                    else -> Unit
                }
                if (c.subtitles.isNotEmpty()) {
                    setSubtitleConfigurations(
                        c.subtitles.map { t ->
                            MediaItem.SubtitleConfiguration.Builder(android.net.Uri.parse(t.url))
                                .setMimeType(subtitleMime(t.url))
                                .setLanguage(t.lang)
                                .setSelectionFlags(if (t.lang.contains("ar", true) || t.lang.contains("عرب")) C.SELECTION_FLAG_DEFAULT else 0)
                                .build()
                        },
                    )
                }
            }
            .build()
        player.setMediaSource(DefaultMediaSourceFactory(http).createMediaSource(item), positionMs)
        player.prepare()
        player.playWhenReady = true
        main.removeCallbacks(startupWatchdog)
        main.postDelayed(startupWatchdog, STARTUP_TIMEOUT_MS)
    }

    /** عطل السيرفر الحالي ← التالي من نفس الموضع. */
    private fun fail(reason: String) {
        main.removeCallbacks(startupWatchdog)
        val c = current ?: return
        val at = player.currentPosition.coerceAtLeast(0)
        val next = session?.failed(c, reason)
        if (next == null) {
            showStatus("تعذّر التشغيل من كل السيرفرات المتاحة")
            report(final = true)
            main.postDelayed({ finish() }, 2500)
            return
        }
        showStatus("انتقلنا لسيرفر آخر: ${next.server}")
        play(next, at)
    }

    private fun showStatus(text: String) {
        status.text = text
        status.visibility = View.VISIBLE
    }

    /** التقدّم للواجهة (سجل المشاهدة) — كل ١٠ ثوانٍ وعند الخروج. */
    private fun report(final: Boolean) {
        val c = current ?: return
        PlaybackEvents.emit(
            PlaybackEvents.Progress(
                session = sessionId,
                candidateId = c.id,
                sourceId = c.sourceId,
                positionMs = player.currentPosition.coerceAtLeast(0),
                durationMs = player.duration.takeIf { it > 0 } ?: 0,
                final = final,
            ),
        )
    }

    override fun onPause() {
        super.onPause()
        player.pause()
        report(final = false)
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        report(final = true)
        player.release()
        AnimeEngine.get(this).closeSession(sessionId)
        super.onDestroy()
    }

    private fun subtitleMime(url: String): String = when {
        url.contains(".vtt", true) -> MimeTypes.TEXT_VTT
        url.contains(".srt", true) -> MimeTypes.APPLICATION_SUBRIP
        url.contains(".ass", true) || url.contains(".ssa", true) -> MimeTypes.TEXT_SSA
        else -> MimeTypes.TEXT_VTT
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_SESSION = "session"
        const val EXTRA_TITLE = "title"
        const val EXTRA_POSITION = "position"
        const val STARTUP_TIMEOUT_MS = 15_000L
        const val PROGRESS_EVERY_MS = 10_000L

        fun intent(context: Context, session: String, title: String, positionMs: Long) =
            Intent(context, PlayerActivity::class.java)
                .putExtra(EXTRA_SESSION, session)
                .putExtra(EXTRA_TITLE, title)
                .putExtra(EXTRA_POSITION, positionMs)
    }
}

/** قناة واحدة من المشغّل إلى الجسر (والجسر يبثّها للواجهة). */
object PlaybackEvents {
    data class Progress(
        val session: String,
        val candidateId: String,
        val sourceId: String,
        val positionMs: Long,
        val durationMs: Long,
        val final: Boolean,
    )

    @Volatile var listener: ((Progress) -> Unit)? = null

    fun emit(p: Progress) = listener?.invoke(p)
}
