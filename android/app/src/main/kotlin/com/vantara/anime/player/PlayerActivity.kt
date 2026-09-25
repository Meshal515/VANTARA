package com.vantara.anime.player

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.hls.HlsManifest
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.SeekParameters
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.vantara.anime.AnimeEngine
import com.vantara.anime.adapters.SourceAnime
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.Container
import com.vantara.anime.stream.PlaybackSession
import com.vantara.anime.stream.Preferences
import com.vantara.anime.stream.PreparedEpisode
import com.vantara.anime.stream.Route
import com.vantara.anime.stream.RouteState
import com.vantara.anime.stream.Variant
import eu.kanade.tachiyomi.network.NetworkHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import org.json.JSONArray
import org.json.JSONObject
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.get
import kotlin.math.abs
import kotlin.math.floor

/**
 * مشغّل VANTARA — Media3 أصلي بواجهة خاصة.
 *
 * لا يعرف مصدرًا ولا سيرفرًا: يأخذ حلقة تتجهّز ([PreparedEpisode]) ويشغّل
 * أفضل ما جهز. عند أي عطل (خطأ، لم يبدأ خلال [STARTUP_TIMEOUT_MS]، علق
 * التحميل) يبلّغ الجلسة ويكمل بالتالي **من نفس الثانية** وفي ملء الشاشة،
 * ولا يرى المستخدم إلا «تم التبديل إلى سيرفر آخر». وإن فرغت القائمة والتجهيز
 * ما زال يعمل ينتظر أول سيرفر يجهز بدل أن يستسلم.
 *
 * الترويسات (Referer/User-Agent) من المرشّح نفسه، والكوكيز (cf_clearance)
 * من عميل OkHttp المشترك، فما يعمل في المحرك يعمل في المشغّل وفي قصّ المقاطع.
 */
@OptIn(UnstableApi::class)
class PlayerActivity : Activity() {

    @Serializable
    data class Launch(
        val session: String,
        val title: String,
        val animeId: String = "",
        val episode: Float = 1f,
        /** آخر حلقة متاحة (لقائمة الحلقات و«التالية»). */
        val total: Int = 0,
        val positionMs: Long = 0,
        /** السيرفر الذي اختاره المستخدم من الورقة؛ وإلا الأفضل. */
        val candidate: String? = null,
        /** رمز السيرفر المفضّل لهذا الأنمي: ترجيح لا قفل. */
        val preferCode: String? = null,
        val poster: String? = null,
        /** أصدقاء المستخدم (JSON: [{userId, displayName}]) لـ«أرسل لصديق». */
        val friends: String? = null,
        /** نسخ الأنمي من المصادر (JSON) لتبديل الحلقة من داخل المشغّل. */
        val copies: String? = null,
        val quality: Int = 1080,
        val variant: String = "SUB",
        /** مواضع الحلقات غير المكتملة (JSON: {"12": 61000}). */
        val resume: String? = null,
    )

    private lateinit var launch: Launch
    private lateinit var player: ExoPlayer
    private lateinit var video: PlayerView
    private lateinit var root: FrameLayout
    private lateinit var controls: FrameLayout
    private lateinit var sheet: VSheet
    private lateinit var titleView: TextView
    private lateinit var episodeView: TextView
    private lateinit var timeNow: TextView
    private lateinit var timeTotal: TextView
    private lateinit var bar: TimeBar
    private lateinit var playButton: ImageView
    private lateinit var fitButton: ImageView
    private lateinit var nextButton: ImageView
    private lateinit var qualityLabel: TextView
    private lateinit var spinner: ProgressBar
    private lateinit var pill: TextView
    private lateinit var level: LinearLayout
    private lateinit var levelText: TextView
    private lateinit var levelIcon: ImageView
    private lateinit var seekLeft: TextView
    private lateinit var seekRight: TextView
    private lateinit var unlockButton: ImageView
    private var errorCard: View? = null
    private var countdownCard: View? = null
    private var clip: ClipEditor? = null

    private val engine by lazy { AnimeEngine.get(this) }
    private val network: NetworkHelper by lazy { Injekt.get<NetworkHelper>() }
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val main = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private var sessionId = ""
    private var episode = 1f
    private var session: PlaybackSession? = null
    private var prep: PreparedEpisode? = null
    private var unlisten: (() -> Unit)? = null
    private var current: Candidate? = null
    private var preferCode: String? = null
    private var startedAt = 0L
    private var reportedStart = false
    private var expanded = false
    private var waiting: Job? = null
    private var locked = false
    private var fill = false
    private var copies: List<SourceAnime> = emptyList()
    private var resume: MutableMap<Int, Long> = mutableMapOf()
    private val settings by lazy { getSharedPreferences("vantara.player", MODE_PRIVATE) }

    private val startupWatchdog = Runnable { if (!reportedStart) fail("لم يبدأ خلال ${STARTUP_TIMEOUT_MS / 1000} ثانية") }

    /** بدأ ثم علق التحميل: ExoPlayer لا يعدّه خطأ، فالمراقبة هنا. */
    private val stallWatchdog = Runnable {
        if (player.playbackState == Player.STATE_BUFFERING) fail("توقف التحميل ${STALL_TIMEOUT_MS / 1000} ثانية")
    }
    private val hideControls = Runnable { setControls(false) }
    private val progressTick = object : Runnable {
        override fun run() {
            report(final = false)
            main.postDelayed(this, PROGRESS_EVERY_MS)
        }
    }
    private val clockTick = object : Runnable {
        override fun run() {
            updateTime()
            main.postDelayed(this, 500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.attributes = window.attributes.apply {
            layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        immersive()

        launch = runCatching { json.decodeFromString(Launch.serializer(), intent.getStringExtra(EXTRA_LAUNCH).orEmpty()) }
            .getOrElse { Launch(session = intent.getStringExtra(EXTRA_SESSION).orEmpty(), title = "") }
        sessionId = launch.session
        episode = launch.episode
        preferCode = launch.preferCode
        copies = launch.copies?.let { runCatching { json.decodeFromString(ListSerializer(SourceAnime.serializer()), it) }.getOrNull() }.orEmpty()
        resume = launch.resume?.let { r ->
            runCatching { JSONObject(r).let { o -> o.keys().asSequence().associate { it.toFloat().toInt() to o.getLong(it) } } }.getOrNull()
        }.orEmpty().toMutableMap()
        fill = settings.getBoolean("fill", false)

        MediaCache.acquire(this)
        player = ExoPlayer.Builder(this)
            // آخر 40 ثانية تبقى في الذاكرة: معاينة المقطع (حتى 35 ث قبل اللحظة)
            // والعودة للحظة بعد إغلاقه بلا تنزيل ولا انتظار
            .setLoadControl(DefaultLoadControl.Builder().setBackBuffer(BACK_BUFFER_MS, true).build())
            .setSeekBackIncrementMs(SEEK_MS)
            .setSeekForwardIncrementMs(SEEK_MS)
            .build()
        player.addListener(listener)
        buildUi()
        attach(sessionId)

        val prep = prep
        val s = session
        if (s == null) {
            showError("انتهت جلسة الحلقة — افتحها من جديد")
            return
        }
        val picked = launch.candidate?.let { s.take(it) }
        if (picked != null) {
            start(picked, launch.positionMs)
        } else if (prep != null) {
            spinner.visibility = View.VISIBLE
            message("نجهّز أفضل سيرفر…", long = true)
            waiting = scope.launch {
                val best = prep.awaitBest(preferCode, BEST_WAIT_MS)?.let { s.take(it.id) } ?: s.next()
                if (best != null) start(best, launch.positionMs) else showError("لم يجهز أي سيرفر لهذه الحلقة")
            }
        } else {
            s.next()?.let { start(it, launch.positionMs) } ?: showError("لا توجد سيرفرات متاحة لهذه الحلقة")
        }
        main.postDelayed(progressTick, PROGRESS_EVERY_MS)
        main.post(clockTick)
    }

    /** يربط المشغّل بحلقة: الجلسة والتجهيز، وتحديث ورقة السيرفرات لحظة يتغيّر شيء. */
    private fun attach(id: String) {
        unlisten?.invoke()
        sessionId = id
        session = engine.session(id)
        prep = engine.prepared(id)
        unlisten = prep?.listen { main.post { if (openSheet == SheetKind.SERVERS) sheet.refresh() } }
        expanded = false
        titleView.text = launch.title
        episodeView.text = "الحلقة ${fmtEpisode(episode)}"
        nextButton.visibility = if (hasNext()) View.VISIBLE else View.GONE
    }

    // ───────────── التشغيل والتبديل ─────────────

    private val listener = object : Player.Listener {
        override fun onPlaybackStateChanged(state: Int) {
            if (state == Player.STATE_BUFFERING) {
                spinner.visibility = View.VISIBLE
                if (reportedStart) {
                    main.removeCallbacks(stallWatchdog)
                    main.postDelayed(stallWatchdog, STALL_TIMEOUT_MS)
                }
            } else {
                main.removeCallbacks(stallWatchdog)
            }
            if (state == Player.STATE_READY) {
                spinner.visibility = View.GONE
                if (!reportedStart) {
                    reportedStart = true
                    main.removeCallbacks(startupWatchdog)
                    current?.let { c ->
                        session?.started(c, System.currentTimeMillis() - startedAt)
                        codeOf(c)?.let { code -> PlaybackEvents.emit("server", JSONObject().put("animeId", launch.animeId).put("code", code)) }
                    }
                    updateQualityLabel()
                }
            }
            if (state == Player.STATE_ENDED) {
                report(final = false)
                onEnded()
            }
            bar.durationMs = player.duration.takeIf { it > 0 } ?: 0
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (isPlaying) scheduleHide() else main.removeCallbacks(hideControls)
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            playButton.setImageDrawable(Glyph(if (playWhenReady) Glyph.Kind.PAUSE else Glyph.Kind.PLAY, Color.WHITE))
            playButton.contentDescription = if (playWhenReady) "إيقاف مؤقت" else "تشغيل"
        }

        override fun onPlayerError(error: PlaybackException) = fail(error.errorCodeName)

        override fun onTracksChanged(tracks: Tracks) = updateQualityLabel()
    }

    private fun start(c: Candidate, positionMs: Long) {
        waiting?.cancel()
        hideError()
        current = c
        reportedStart = false
        startedAt = System.currentTimeMillis()
        spinner.visibility = View.VISIBLE
        val http = MediaCache.factory(this, network.client, c.headers)
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
                                .setLabel(t.lang)
                                .setSelectionFlags(if (t.lang.contains("ar", true) || t.lang.contains("عرب")) C.SELECTION_FLAG_DEFAULT else 0)
                                .build()
                        },
                    )
                }
            }
            .build()
        // جودة اختارها المستخدم تخص السيرفر السابق؛ السيرفر الجديد يبدأ تلقائيًا
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_VIDEO).build()
        player.setMediaSource(DefaultMediaSourceFactory(http).createMediaSource(item), positionMs.coerceAtLeast(0))
        player.prepare()
        player.playWhenReady = clip == null
        main.removeCallbacks(startupWatchdog)
        main.postDelayed(startupWatchdog, STARTUP_TIMEOUT_MS)
        updateQualityLabel()
        if (openSheet == SheetKind.SERVERS) sheet.refresh()
    }

    private fun position(): Long = player.currentPosition.coerceAtLeast(0)

    /** عطل السيرفر الحالي ← التالي من نفس الموضع، أو انتظار ما يجهز. */
    private fun fail(reason: String) {
        main.removeCallbacks(startupWatchdog)
        main.removeCallbacks(stallWatchdog)
        val c = current ?: return
        current = null
        val at = position()
        val next = session?.failed(c, reason)
        if (openSheet == SheetKind.SERVERS) sheet.refresh()
        if (next != null) {
            message("تم التبديل إلى سيرفر آخر")
            start(next, at)
            return
        }
        player.stop()
        spinner.visibility = View.VISIBLE
        val p = prep
        waiting = scope.launch {
            val again = when {
                p != null && !p.done -> {
                    message("نجهّز سيرفرًا آخر…", long = true)
                    p.awaitNext(WAIT_NEXT_MS)
                }
                p == null && !expanded -> {
                    // جلسة من المسار القديم: كل السيرفرات من كل المصادر هذه المرة
                    expanded = true
                    val more = runCatching { withContext(Dispatchers.IO) { engine.more(sessionId) } }.getOrDefault(emptyList())
                    session?.append(more)
                    session?.next()
                }
                else -> session?.next()
            }
            if (again != null) {
                message("تم التبديل إلى سيرفر آخر")
                start(again, at)
            } else {
                spinner.visibility = View.GONE
                report(final = false)
                showError("تعذّر التشغيل من كل السيرفرات المتاحة")
            }
        }
    }

    /** اختيار من ورقة السيرفرات: هذا السيرفر الآن، من نفس الثانية. */
    private fun switchTo(route: Route) {
        val p = prep ?: return
        val s = session ?: return
        val c = p.rank(p.candidatesOf(route.id)).firstOrNull()?.let { s.take(it.id) }
        if (c == null) {
            message("هذا السيرفر لم يعد متاحًا")
            return
        }
        preferCode = route.code
        PlaybackEvents.emit("server", JSONObject().put("animeId", launch.animeId).put("code", route.code).put("picked", true))
        val at = position()
        report(final = false)
        sheet.close()
        message("تم التبديل إلى سيرفر آخر")
        start(c, at)
    }

    private fun playBest() {
        val p = prep ?: return
        val s = session ?: return
        val cur = current
        val best = p.best(preferCode)
        if (best == null) {
            message(if (p.done) "لا يوجد سيرفر جاهز آخر" else "ما زالت السيرفرات تتجهّز…")
            return
        }
        if (cur != null && (best.id == cur.id || p.routeOf(best.id)?.id == p.routeOf(cur.id)?.id) && reportedStart) {
            sheet.close()
            message("أنت على أفضل سيرفر الآن")
            return
        }
        val c = s.take(best.id) ?: return
        sheet.close()
        message("تم التبديل إلى سيرفر آخر")
        start(c, position())
    }

    private fun codeOf(c: Candidate): String? = prep?.routeOf(c.id)?.code

    // ───────────── الحلقات ─────────────

    private fun episodeInt() = floor(episode).toInt()

    private fun hasNext() = copies.isNotEmpty() && launch.total > 0 && episodeInt() + 1 <= launch.total

    private fun switchEpisode(n: Int) {
        if (copies.isEmpty()) return message("افتح الحلقة من صفحة الأنمي")
        cancelCountdown()
        sheet.close()
        // ليست نهاية المشاهدة: «final» للواجهة يعني أن المشغّل أُغلق
        report(final = false)
        current?.let { resume[episodeInt()] = position() }
        waiting?.cancel()
        main.removeCallbacks(startupWatchdog)
        main.removeCallbacks(stallWatchdog)
        player.stop()
        current = null
        engine.closeSession(sessionId)
        val id = "s-${System.nanoTime()}"
        val prefs = Preferences(
            quality = launch.quality,
            variant = runCatching { Variant.valueOf(launch.variant) }.getOrDefault(Variant.SUB),
        )
        engine.prepare(id, copies, n.toFloat(), prefs)
        episode = n.toFloat()
        attach(id)
        hideError()
        spinner.visibility = View.VISIBLE
        message("نجهّز الحلقة $n…", long = true)
        PlaybackEvents.emit("episode", JSONObject().put("animeId", launch.animeId).put("episode", n).put("session", id))
        val p = prep ?: return
        val s = session ?: return
        val from = resume[n] ?: 0L
        waiting = scope.launch {
            val best = p.awaitBest(preferCode, BEST_WAIT_MS)?.let { s.take(it.id) } ?: s.next()
            if (best != null) start(best, from) else showError("لم يجهز أي سيرفر للحلقة $n")
        }
    }

    private fun onEnded() {
        val seconds = settings.getInt("autoNext", 10)
        setControls(true)
        if (!hasNext() || seconds <= 0) return
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            background = rounded(0xE60D111B.toInt(), dp(18).toFloat(), dp(1), Tone.LINE)
            setPadding(dp(16), dp(14), dp(16), dp(14))
            swallowTouches()
        }
        val count = label("", 13f, Tone.TEXT_2)
        card.addView(label("الحلقة التالية", 12f, Tone.TEXT_3, bold = true))
        card.addView(label("الحلقة ${episodeInt() + 1}", 17f, Tone.TEXT, bold = true).apply { setPadding(0, dp(4), 0, dp(4)) })
        card.addView(count)
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(12), 0, 0) }
        row.addView(pillButton("شغّل الآن", primary = true) { switchEpisode(episodeInt() + 1) })
        row.addView(View(this), LinearLayout.LayoutParams(dp(8), 1))
        row.addView(pillButton("إلغاء", primary = false) { cancelCountdown() })
        card.addView(row)
        root.addView(card, FrameLayout.LayoutParams(dp(240), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.START).apply {
            setMargins(dp(28), 0, dp(28), dp(130))
        })
        countdownCard = card
        var left = seconds
        val tick = object : Runnable {
            override fun run() {
                if (countdownCard !== card) return
                if (left <= 0) return switchEpisode(episodeInt() + 1)
                count.text = "تبدأ خلال $left ث"
                left--
                main.postDelayed(this, 1000)
            }
        }
        tick.run()
    }

    private fun cancelCountdown() {
        countdownCard?.let(root::removeView)
        countdownCard = null
    }

    // ───────────── الواجهة ─────────────

    private enum class SheetKind { SERVERS, EPISODES, QUALITY, SUBTITLES, SPEED, MORE, FRIENDS }

    private var openSheet: SheetKind? = null

    private fun buildUi() {
        root = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            layoutDirection = View.LAYOUT_DIRECTION_LTR
        }
        video = PlayerView(this).apply {
            player = this@PlayerActivity.player
            useController = false
            keepScreenOn = true
            setShutterBackgroundColor(Color.BLACK)
            resizeMode = if (fill) AspectRatioFrameLayout.RESIZE_MODE_ZOOM else AspectRatioFrameLayout.RESIZE_MODE_FIT
        }
        root.addView(video, match())

        val gestures = View(this)
        gestures.setOnTouchListener(Gestures())
        root.addView(gestures, match())

        seekLeft = seekBadge()
        seekRight = seekBadge()
        root.addView(seekLeft, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER_VERTICAL or Gravity.LEFT).apply { leftMargin = dp(90) })
        root.addView(seekRight, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER_VERTICAL or Gravity.RIGHT).apply { rightMargin = dp(90) })

        levelIcon = ImageView(this)
        levelText = label("", 18f, Color.WHITE, bold = true).apply { setShadowLayer(10f, 0f, 1f, Color.BLACK) }
        level = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            visibility = View.GONE
            addView(levelIcon, LinearLayout.LayoutParams(dp(28), dp(28)))
            addView(levelText, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { leftMargin = dp(10) })
        }
        root.addView(level, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER_VERTICAL or Gravity.LEFT).apply { leftMargin = dp(120) })

        spinner = ProgressBar(this).apply {
            isIndeterminate = true
            indeterminateTintList = android.content.res.ColorStateList.valueOf(Tone.ACCENT)
            visibility = View.GONE
        }
        root.addView(spinner, FrameLayout.LayoutParams(dp(46), dp(46), Gravity.CENTER))

        controls = FrameLayout(this)
        buildTop()
        buildBottom()
        root.addView(controls, match())

        pill = label("", 13.5f, Color.WHITE, bold = true).apply {
            setPadding(dp(16), dp(9), dp(16), dp(9))
            background = rounded(0xD90D111B.toInt(), dp(20).toFloat(), dp(1), Tone.LINE)
            textDirection = View.TEXT_DIRECTION_RTL
            alpha = 0f
            visibility = View.GONE
        }
        root.addView(pill, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply { topMargin = dp(84) })

        unlockButton = iconButton(Glyph.Kind.LOCK, iconDp = 22, boxDp = 52, bg = 0x990D111B.toInt(), desc = "إلغاء قفل الشاشة") { setLocked(false) }.apply { visibility = View.GONE }
        root.addView(unlockButton, FrameLayout.LayoutParams(dp(52), dp(52), Gravity.CENTER_VERTICAL or Gravity.RIGHT).apply { rightMargin = dp(28) })

        sheet = VSheet(root)
        sheet.onClose = {
            openSheet = null
            if (player.isPlaying) scheduleHide()
        }
        setContentView(root)
        setControls(true)
    }

    private fun buildTop() {
        val shade = View(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0xB3000000.toInt(), 0x00000000))
        }
        controls.addView(shade, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(120), Gravity.TOP))
        // الشريط العلوي بالعربية: الرجوع والعنوان يمينًا، الأدوات يسارًا
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(20), dp(14), dp(20), 0)
        }
        top.addView(iconButton(Glyph.Kind.BACK, desc = "رجوع") { finish() })
        titleView = label("", 16f, Color.WHITE, bold = true).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END; textDirection = View.TEXT_DIRECTION_ANY_RTL }
        episodeView = label("", 12.5f, Tone.TEXT_2).apply { setPadding(0, dp(4), 0, 0) }
        top.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(8), 0, dp(8), 0)
            addView(titleView)
            addView(episodeView)
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        top.addView(iconButton(Glyph.Kind.CAMERA, desc = "قصّ مقطع من هذه اللحظة") { openClip() })
        fitButton = iconButton(if (fill) Glyph.Kind.FIT else Glyph.Kind.FILL, desc = "ملء الشاشة / ملاءمة") { toggleFit() }
        top.addView(fitButton)
        top.addView(iconButton(Glyph.Kind.MORE, desc = "المزيد") { showMore() })
        controls.addView(top, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))
    }

    private fun buildBottom() {
        val shade = View(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(0xCC000000.toInt(), 0x00000000))
        }
        controls.addView(shade, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(190), Gravity.BOTTOM))
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), 0, dp(22), dp(10))
        }
        val times = FrameLayout(this)
        timeNow = label("0:00", 13f, Color.WHITE, bold = true)
        timeTotal = label("0:00", 13f, Tone.TEXT_2, bold = true)
        times.addView(timeNow, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.LEFT))
        times.addView(timeTotal, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.RIGHT))
        col.addView(times, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { leftMargin = dp(8); rightMargin = dp(8) })
        bar = TimeBar(this).apply {
            onDragState = { dragging -> if (dragging) main.removeCallbacks(hideControls) else scheduleHide() }
            onScrub = { ms -> timeNow.text = ClipMath.clock(ms) }
            onSeek = { ms -> player.seekTo(ms) }
        }
        col.addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        // الصف السفلي كما في المرجع: التشغيل في الوسط، والأدوات على الطرفين
        val row = FrameLayout(this)
        val left = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        nextButton = iconButton(Glyph.Kind.NEXT, desc = "الحلقة التالية") { switchEpisode(episodeInt() + 1) }
        left.addView(nextButton)
        left.addView(iconButton(Glyph.Kind.EPISODES, desc = "الحلقات") { showEpisodes() })
        left.addView(iconButton(Glyph.Kind.SERVERS, desc = "السيرفرات") { showServers() })
        row.addView(left, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.LEFT or Gravity.CENTER_VERTICAL))

        val center = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        center.addView(iconButton(Glyph.Kind.REWIND10, iconDp = 28, boxDp = 52, desc = "رجوع 10 ثوانٍ") { seekBy(-1) })
        playButton = iconButton(Glyph.Kind.PAUSE, iconDp = 26, boxDp = 60, desc = "إيقاف مؤقت") { togglePlay() }.apply {
            background = android.graphics.drawable.RippleDrawable(
                android.content.res.ColorStateList.valueOf(0x33FFFFFF),
                GradientDrawable().apply { shape = GradientDrawable.OVAL; setStroke(dp(2), Color.WHITE); setColor(0x33000000) },
                null,
            )
        }
        center.addView(playButton, LinearLayout.LayoutParams(dp(60), dp(60)).apply { leftMargin = dp(26); rightMargin = dp(26) })
        center.addView(iconButton(Glyph.Kind.FORWARD10, iconDp = 28, boxDp = 52, desc = "تقديم 10 ثوانٍ") { seekBy(1) })
        row.addView(center, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))

        val right = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        qualityLabel = label("HD", 12.5f, Color.WHITE, bold = true).apply {
            gravity = Gravity.CENTER
            textAlignment = View.TEXT_ALIGNMENT_CENTER
            minWidth = dp(48)
            minHeight = dp(48)
            setPadding(dp(8), 0, dp(8), 0)
            background = android.graphics.drawable.RippleDrawable(android.content.res.ColorStateList.valueOf(0x33FFFFFF), null, rounded(Color.WHITE, dp(24).toFloat()))
            contentDescription = "الجودة"
            setOnClickListener { showQuality() }
        }
        right.addView(qualityLabel)
        right.addView(iconButton(Glyph.Kind.SUBTITLES, desc = "الترجمة") { showSubtitles() })
        right.addView(iconButton(Glyph.Kind.SPEED, desc = "السرعة") { showSpeed() })
        right.addView(iconButton(Glyph.Kind.UNLOCK, desc = "قفل الشاشة") { setLocked(true) })
        row.addView(right, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.RIGHT or Gravity.CENTER_VERTICAL))
        col.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(64)))
        controls.addView(col, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
    }

    private fun match() = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)

    private fun seekBadge() = label("", 15f, Color.WHITE, bold = true).apply {
        gravity = Gravity.CENTER
        textAlignment = View.TEXT_ALIGNMENT_CENTER
        setPadding(dp(18), dp(12), dp(18), dp(12))
        background = rounded(0x800D111B.toInt(), dp(30).toFloat())
        visibility = View.GONE
    }

    fun pillButton(text: String, primary: Boolean, onClick: () -> Unit): TextView = label(text, 13.5f, Color.WHITE, bold = true).apply {
        gravity = Gravity.CENTER
        textAlignment = View.TEXT_ALIGNMENT_CENTER
        minHeight = dp(40)
        setPadding(dp(16), 0, dp(16), 0)
        background = pressable(if (primary) Tone.ACCENT else Tone.SURFACE_3, dp(20).toFloat())
        setOnClickListener { onClick() }
    }

    private fun updateTime() {
        if (!::bar.isInitialized) return
        val d = player.duration.takeIf { it > 0 } ?: 0
        bar.durationMs = d
        bar.positionMs = position()
        bar.bufferedMs = player.bufferedPosition
        timeNow.text = ClipMath.clock(position())
        timeTotal.text = if (d > 0) ClipMath.clock(d) else "--:--"
        clip?.tick(position())
    }

    private fun updateQualityLabel() {
        val h = player.videoFormat?.height?.takeIf { it > 0 } ?: current?.quality
        qualityLabel.text = h?.let { "${bucket(it)}p" } ?: "HD"
    }

    private fun bucket(h: Int) = when {
        h >= 2000 -> 2160
        h >= 1000 -> 1080
        h >= 700 -> 720
        h >= 460 -> 480
        h >= 340 -> 360
        else -> h
    }

    private fun setControls(show: Boolean) {
        if (locked || clip != null) {
            controls.visibility = View.GONE
            return
        }
        main.removeCallbacks(hideControls)
        if (show) {
            controls.visibility = View.VISIBLE
            controls.animate().alpha(1f).setDuration(160).start()
            updateTime()
            scheduleHide()
        } else {
            controls.animate().alpha(0f).setDuration(220).withEndAction { if (controls.alpha == 0f) controls.visibility = View.GONE }.start()
        }
    }

    private fun scheduleHide() {
        main.removeCallbacks(hideControls)
        if (player.isPlaying && openSheet == null) main.postDelayed(hideControls, HIDE_AFTER_MS)
    }

    private fun controlsShown() = controls.visibility == View.VISIBLE && controls.alpha > 0.5f

    private fun togglePlay() {
        if (player.playbackState == Player.STATE_ENDED) player.seekTo(0)
        player.playWhenReady = !player.playWhenReady
        setControls(true)
    }

    private fun seekBy(dir: Int) {
        val d = player.duration.takeIf { it > 0 } ?: Long.MAX_VALUE
        player.seekTo((position() + dir * SEEK_MS).coerceIn(0, d))
        updateTime()
        if (controlsShown()) scheduleHide()
    }

    private fun toggleFit() {
        fill = !fill
        settings.edit().putBoolean("fill", fill).apply()
        video.resizeMode = if (fill) AspectRatioFrameLayout.RESIZE_MODE_ZOOM else AspectRatioFrameLayout.RESIZE_MODE_FIT
        fitButton.setImageDrawable(Glyph(if (fill) Glyph.Kind.FIT else Glyph.Kind.FILL, Color.WHITE))
        message(if (fill) "ملء الشاشة" else "ملاءمة الشاشة")
        scheduleHide()
    }

    private fun setLocked(on: Boolean) {
        locked = on
        if (on) {
            sheet.close(animated = false)
            controls.visibility = View.GONE
            message("الشاشة مقفلة — المس للفتح")
        } else {
            unlockButton.visibility = View.GONE
            setControls(true)
        }
    }

    private val hideUnlock = Runnable { unlockButton.visibility = View.GONE }

    private fun flashUnlock() {
        unlockButton.visibility = View.VISIBLE
        main.removeCallbacks(hideUnlock)
        main.postDelayed(hideUnlock, 2500)
    }

    /** رسالة عابرة أعلى الشاشة؛ لا نص تقني دائم. */
    fun message(text: String, long: Boolean = false) {
        pill.text = text
        pill.visibility = View.VISIBLE
        pill.animate().cancel()
        pill.animate().alpha(1f).setDuration(150).start()
        main.removeCallbacks(hidePill)
        main.postDelayed(hidePill, if (long) 6000 else 2200)
    }

    private val hidePill = Runnable {
        pill.animate().alpha(0f).setDuration(250).withEndAction { pill.visibility = View.GONE }.start()
    }

    private fun showError(text: String) {
        hideError()
        spinner.visibility = View.GONE
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            background = rounded(0xF20D111B.toInt(), dp(22).toFloat(), dp(1), Tone.LINE)
            setPadding(dp(24), dp(22), dp(24), dp(20))
            swallowTouches()
        }
        card.addView(label(text, 16f, Tone.TEXT, bold = true).apply { gravity = Gravity.CENTER })
        card.addView(label("جرّب سيرفرًا آخر أو أعد المحاولة بعد قليل", 13f, Tone.TEXT_3).apply { gravity = Gravity.CENTER; setPadding(0, dp(8), 0, dp(16)) })
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        if (prep != null) row.addView(pillButton("السيرفرات", primary = true) { showServers() })
        row.addView(View(this), LinearLayout.LayoutParams(dp(8), 1))
        if (copies.isNotEmpty()) row.addView(pillButton("إعادة المحاولة", primary = false) { switchEpisode(episodeInt()) })
        row.addView(View(this), LinearLayout.LayoutParams(dp(8), 1))
        row.addView(pillButton("رجوع", primary = false) { finish() })
        card.addView(row)
        root.addView(card, root.indexOfChild(controls), FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        errorCard = card
        setControls(true)
    }

    private fun hideError() {
        errorCard?.let(root::removeView)
        errorCard = null
    }

    // ───────────── الأوراق ─────────────

    private fun open(kind: SheetKind, title: String, subtitle: String? = null, build: (LinearLayout) -> Unit) {
        main.removeCallbacks(hideControls)
        openSheet = kind
        sheet.open(title, subtitle, build = build)
        openSheet = kind
    }

    /** نفس نموذج ورقة الواجهة: رموز لا أسماء، مجمّعة بالجودة، بحالتها الآن. */
    private fun showServers() {
        val p = prep ?: return message("السيرفرات غير متاحة لهذه الجلسة")
        open(SheetKind.SERVERS, "السيرفرات", "الحلقة ${fmtEpisode(episode)}") { body ->
            val routes = p.routes()
            val currentRoute = current?.let { p.routeOf(it.id)?.id }
            val ready = routes.count { it.state == RouteState.READY }
            body.addView(pillButton("شغّل الأفضل", primary = true) { playBest() }.apply {
                minHeight = dp(48)
                setCompoundDrawablesRelativeWithIntrinsicBounds(Glyph(Glyph.Kind.SPARK, Color.WHITE, dp(16)), null, null, null)
                compoundDrawablePadding = dp(8)
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(6) })
            val status = when {
                !p.done -> "يتجهّز… $ready جاهز حتى الآن"
                ready == 0 -> "لم يجهز أي سيرفر لهذه الحلقة"
                else -> "$ready سيرفر جاهز"
            }
            body.addView(label(status, 12f, Tone.TEXT_3).apply { setPadding(dp(4), dp(6), dp(4), 0) })
            for ((name, list) in RouteGroups.group(routes)) {
                body.addView(sectionLabel(name))
                // مربعات رموز (مثل HGC · MPU) أربعة في الصف: كل السيرفرات في نظرة
                val perRow = 4
                list.chunked(perRow).forEach { chunk ->
                    val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
                    chunk.forEach { r -> row.addView(routeTile(r, r.id == currentRoute), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(8) }) }
                    repeat(perRow - chunk.size) { row.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f).apply { marginEnd = dp(8) }) }
                    body.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(8) })
                }
            }
        }
    }

    private fun routeTile(r: Route, isCurrent: Boolean): View {
        val (text, color, pulse) = when {
            isCurrent -> Triple(if (reportedStart) "يعمل الآن" else "يبدأ…", Tone.ACCENT, !reportedStart)
            r.state == RouteState.RESOLVING -> Triple("يتجهّز…", Tone.WARN, true)
            r.state == RouteState.READY -> Triple("جاهز", Tone.OK, false)
            r.state == RouteState.FAILED -> Triple("فشل التشغيل", Tone.BAD, false)
            else -> Triple("غير متاح", Tone.TEXT_4, false)
        }
        val playable = !isCurrent && r.state == RouteState.READY
        val dim = r.state == RouteState.UNAVAILABLE || r.state == RouteState.RESOLVING
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            minimumHeight = dp(72)
            setPadding(dp(14), dp(12), dp(14), dp(10))
            val bg = when {
                isCurrent -> Tone.ACCENT_SOFT
                dim -> 0x80131826.toInt()
                else -> Tone.SURFACE_2
            }
            background = if (playable) pressable(bg, dp(16).toFloat(), dp(1), Tone.LINE)
            else rounded(bg, dp(16).toFloat(), dp(1), if (isCurrent) 0x6B3B82F6 else Tone.LINE)
            val top = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            top.addView(label(r.code, 17f, if (r.state == RouteState.UNAVAILABLE) Tone.TEXT_4 else if (isCurrent) Tone.ACCENT_TEXT else Tone.TEXT, bold = true).apply { letterSpacing = 0.08f }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            if (r.variant == Variant.DUB) top.addView(chip("مدبلج", Tone.ACCENT_TEXT, Tone.ACCENT_SOFT))
            else if (r.code == preferCode && !isCurrent) top.addView(chip("آخر اختيار", Tone.ACCENT_TEXT, Tone.ACCENT_SOFT))
            addView(top)
            val state = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(8), 0, 0) }
            state.addView(StatusDot(context, color, pulse))
            state.addView(label(text, 12f, if (r.state == RouteState.FAILED) Tone.BAD else Tone.TEXT_2, bold = true), LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(7) })
            addView(state)
            contentDescription = "سيرفر ${r.code}، $text"
            if (playable) setOnClickListener { switchTo(r) }
        }
    }

    private fun showEpisodes() {
        val total = launch.total
        if (total <= 0 || copies.isEmpty()) return message("قائمة الحلقات من صفحة الأنمي")
        open(SheetKind.EPISODES, "الحلقات", "$total حلقة") { body ->
            val cur = episodeInt()
            val perRow = 6
            var row: LinearLayout? = null
            for (n in 1..total) {
                if ((n - 1) % perRow == 0) {
                    row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
                    body.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(8) })
                }
                val on = n == cur
                val watched = resume.containsKey(n)
                row!!.addView(label("$n", 15f, if (on) Color.WHITE else Tone.TEXT, bold = true).apply {
                    gravity = Gravity.CENTER
                    textAlignment = View.TEXT_ALIGNMENT_CENTER
                    minHeight = dp(48)
                    background = pressable(if (on) Tone.ACCENT else Tone.SURFACE_2, dp(12).toFloat(), if (watched && !on) dp(1) else 0, 0x6B3B82F6)
                    setOnClickListener { if (n != cur) switchEpisode(n) else sheet.close() }
                }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(8) })
            }
            // الصف الأخير يكمل بفراغ فلا تتمدد أرقامه
            val last = row
            if (last != null) repeat((perRow - total % perRow) % perRow) { last.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f).apply { marginEnd = dp(8) }) }
        }
        // تمرير للحلقة الحالية
        main.postDelayed({ sheet.scrollTo(((episodeInt() - 1) / 6 - 1) * dp(56)) }, 280)
    }

    private fun showQuality() {
        open(SheetKind.QUALITY, "الجودة") { body ->
            val video = player.currentTracks.groups.filter { it.type == C.TRACK_TYPE_VIDEO }
            val options = video.flatMap { g -> (0 until g.length).filter { g.isTrackSupported(it) }.map { Triple(g, it, g.getTrackFormat(it).height) } }
                .filter { it.third > 0 }
                .distinctBy { bucket(it.third) }
                .sortedByDescending { it.third }
            val overrides = player.trackSelectionParameters.overrides.values.filter { it.type == C.TRACK_TYPE_VIDEO }
            val playingH = player.videoFormat?.height?.let(::bucket)
            if (options.size > 1) {
                // «تلقائي» فقط حين توجد جودات فعلًا يختار بينها
                val auto = overrides.isEmpty()
                body.addView(sheetRow("تلقائي", playingH?.let { "الآن ${it}p حسب سرعة اتصالك" }, trailing = if (auto) check() else null, selected = auto) {
                    player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_VIDEO).build()
                    sheet.close()
                })
                for ((g, i, h) in options) {
                    val on = overrides.any { it.mediaTrackGroup == g.mediaTrackGroup && i in it.trackIndices }
                    body.addView(sheetRow("${bucket(h)}p", null, trailing = if (on) check() else null, selected = on) {
                        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
                            .setOverrideForType(TrackSelectionOverride(g.mediaTrackGroup, i))
                            .build()
                        sheet.close()
                        message("${bucket(h)}p")
                    })
                }
            } else {
                val h = playingH ?: current?.quality?.let(::bucket)
                body.addView(sheetRow(h?.let { "${it}p" } ?: "جودة السيرفر", "الجودة الوحيدة في هذا السيرفر", trailing = check(), selected = true))
            }
            // جودات أخرى تعني سيرفرًا آخر: تُعرض بالجودة والرمز، والتبديل من نفس الثانية
            val p = prep
            val cur = current?.let { p?.routeOf(it.id)?.id }
            val others = p?.routes().orEmpty()
                .filter { it.state == RouteState.READY && it.id != cur && it.quality != null && bucket(it.quality) != playingH }
                .sortedByDescending { it.quality }
                .distinctBy { bucket(it.quality!!) }
            if (others.isNotEmpty()) {
                body.addView(sectionLabel("من سيرفر آخر"))
                for (r in others) body.addView(sheetRow("${bucket(r.quality!!)}p", r.code) { switchTo(r) })
            }
        }
    }

    private fun showSubtitles() {
        open(SheetKind.SUBTITLES, "الترجمة") { body ->
            val text = player.currentTracks.groups.filter { it.type == C.TRACK_TYPE_TEXT }
            if (text.isEmpty()) {
                body.addView(sheetRow("الترجمة مدمجة في الفيديو", "هذا السيرفر لا يوفّر ترجمة منفصلة", selected = true))
                return@open
            }
            val disabled = player.trackSelectionParameters.disabledTrackTypes.contains(C.TRACK_TYPE_TEXT)
            body.addView(sheetRow("إيقاف", null, trailing = if (disabled) check() else null, selected = disabled) {
                player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build()
                sheet.close()
            })
            for (g in text) for (i in 0 until g.length) {
                val f = g.getTrackFormat(i)
                val on = !disabled && g.isTrackSelected(i)
                val name = f.label ?: f.language?.let { java.util.Locale(it).getDisplayLanguage(java.util.Locale("ar")) } ?: "ترجمة ${i + 1}"
                body.addView(sheetRow(name, null, trailing = if (on) check() else null, selected = on) {
                    player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
                        .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                        .setOverrideForType(TrackSelectionOverride(g.mediaTrackGroup, i))
                        .build()
                    sheet.close()
                })
            }
        }
    }

    private fun showSpeed() {
        open(SheetKind.SPEED, "السرعة") { body ->
            val now = player.playbackParameters.speed
            for (s in listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 2f)) {
                val on = abs(now - s) < 0.01f
                val name = if (s == 1f) "عادية" else "${s}x".replace(".0x", "x")
                body.addView(sheetRow(name, null, trailing = if (on) check() else null, selected = on) {
                    player.playbackParameters = PlaybackParameters(s)
                    sheet.close()
                    if (s != 1f) message("السرعة ${s}x".replace(".0x", "x"))
                })
            }
        }
    }

    private fun showMore() {
        open(SheetKind.MORE, "المزيد") { body ->
            body.addView(sheetRow("قفل الشاشة", "يمنع اللمس العارض أثناء المشاهدة", leading = glyphView(Glyph.Kind.LOCK)) { sheet.close(); setLocked(true) })
            if (friends().isNotEmpty() || launch.animeId.isNotEmpty()) {
                body.addView(sheetRow("رشّح الحلقة لصديق", "تصله في المجلس ويفتحها من عندك", leading = glyphView(Glyph.Kind.SEND)) {
                    pickFriend("رشّح الحلقة ${fmtEpisode(episode)}") { to, name -> queueMoment(to, name, null) }
                })
            }
            body.addView(sectionLabel("الحلقة التالية تلقائيًا"))
            val cur = settings.getInt("autoNext", 10)
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            for ((v, name) in listOf(0 to "إيقاف", 5 to "5 ث", 10 to "10 ث", 15 to "15 ث")) {
                val on = v == cur
                row.addView(label(name, 13.5f, if (on) Color.WHITE else Tone.TEXT_2, bold = true).apply {
                    gravity = Gravity.CENTER
                    textAlignment = View.TEXT_ALIGNMENT_CENTER
                    minHeight = dp(44)
                    background = pressable(if (on) Tone.ACCENT else Tone.SURFACE_2, dp(12).toFloat())
                    setOnClickListener {
                        settings.edit().putInt("autoNext", v).apply()
                        sheet.refresh()
                    }
                }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(8) })
            }
            body.addView(row)
        }
    }

    private fun glyphView(kind: Glyph.Kind) = ImageView(this).apply {
        setImageDrawable(Glyph(kind, Tone.TEXT_2, dp(22)))
        layoutParams = LinearLayout.LayoutParams(dp(22), dp(22))
    }

    private fun check() = ImageView(this).apply {
        setImageDrawable(Glyph(Glyph.Kind.CHECK, Tone.ACCENT_TEXT, dp(20)))
        layoutParams = LinearLayout.LayoutParams(dp(20), dp(20))
    }

    // ───────────── الأصدقاء واللحظات ─────────────

    data class Friend(val id: String, val name: String)

    fun friends(): List<Friend> = runCatching {
        val arr = JSONArray(launch.friends ?: "[]")
        (0 until arr.length()).map { arr.getJSONObject(it) }.map { Friend(it.optString("userId"), it.optString("displayName")) }.filter { it.id.isNotEmpty() }
    }.getOrDefault(emptyList())

    /** «الجميع» (المجلس) أولًا، ثم الأصدقاء. [onPick] يستلم (المعرّف أو null للجميع، الاسم). */
    fun pickFriend(title: String, onPick: (String?, String) -> Unit) {
        open(SheetKind.FRIENDS, title, "يظهر لهم في المجلس") { body ->
            body.addView(sheetRow("الجميع", "كل أصدقائك في المجلس", leading = avatar("✦")) { sheet.close(); onPick(null, "الجميع") })
            val list = friends()
            if (list.isEmpty()) body.addView(label("ما عندك أصدقاء بعد — أضفهم من المجلس", 13f, Tone.TEXT_3).apply { setPadding(dp(4), dp(8), dp(4), dp(4)) })
            for (f in list) body.addView(sheetRow(f.name, null, leading = avatar(f.name.take(1))) { sheet.close(); onPick(f.id, f.name) })
        }
    }

    private fun avatar(letter: String) = label(letter, 15f, Color.WHITE, bold = true).apply {
        gravity = Gravity.CENTER
        textAlignment = View.TEXT_ALIGNMENT_CENTER
        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Tone.SURFACE_3) }
        layoutParams = LinearLayout.LayoutParams(dp(36), dp(36))
    }

    /**
     * اللحظة تُرسل كترشيح في المجلس (عنوان الحلقة ومداها)، وصديقك يفتحها
     * عنده من نفس الثانية. ملف الفيديو نفسه لا يُرفع: لا خادم ملفات لدينا،
     * و«مشاركة» تعطيك الملف لأي تطبيق.
     */
    fun queueMoment(to: String?, name: String, range: ClipRange?) {
        val item = JSONObject()
            .put("type", if (range != null) "moment" else "episode")
            .put("animeId", launch.animeId)
            .put("title", launch.title)
            .put("poster", launch.poster)
            .put("episode", episode.toDouble())
            .put("toId", to ?: JSONObject.NULL)
        if (range != null) item.put("startMs", range.startMs).put("endMs", range.endMs).put("atMs", range.momentMs)
        Outbox.push(this, item)
        message(if (to == null) "انرسلت للمجلس" else "انرسلت لـ $name")
    }

    // ───────────── المقطع ─────────────

    private fun openClip() {
        val c = current
        val d = player.duration
        if (c == null || !reportedStart || d <= 0) return message("انتظر حتى يبدأ التشغيل")
        sheet.close(animated = false)
        cancelCountdown()
        val moment = position()
        val wasPlaying = player.playWhenReady
        controls.visibility = View.GONE
        // لا إيقاف: المحرّر يُبقي المشغّل يعمل ويدوّره داخل المدى
        clip = ClipEditor(
            this, root, player, c, ClipMath.initial(moment, d), d, network.client,
            episodeLabel = "الحلقة ${fmtEpisode(episode)}", title = launch.title,
            keyframeAt = ::segmentStartAt,
        ) {
            clip = null
            // اللحظة الأصلية لا تضيع: نعود إليها كما كنا (من الذاكرة، بلا إعادة تحميل)
            player.setSeekParameters(SeekParameters.EXACT)
            player.seekTo(moment)
            player.playWhenReady = wasPlaying
            setControls(true)
        }
    }

    /** بداية مقطع HLS الذي يحوي [ms] (يبدأ بإطار مفتاحي)؛ null لغير HLS. */
    private fun segmentStartAt(ms: Long): Long? {
        val m = player.currentManifest as? HlsManifest ?: return null
        return ClipMath.snapDown(m.mediaPlaylist.segments.map { it.relativeStartTimeUs / 1000 }, ms)
    }

    fun shareClip(file: java.io.File, range: ClipRange) {
        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "video/mp4"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_TEXT, "${launch.title} — الحلقة ${fmtEpisode(episode)} (${ClipMath.clock(range.startMs)}–${ClipMath.clock(range.endMs)})")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivity(Intent.createChooser(send, "شارك المقطع"))
    }

    fun clipName(range: ClipRange) = "${launch.title} - الحلقة ${fmtEpisode(episode)} - ${ClipMath.clock(range.momentMs).replace(':', '.')}"

    // ───────────── الإيماءات ─────────────

    /**
     * نقرة: إظهار/إخفاء. نقرتان يمينًا +10 ث ويسارًا −10 ث (والنقرات المتتالية
     * تتراكم: +20، +30…). سحب عمودي يمينًا للصوت ويسارًا للسطوع.
     */
    private inner class Gestures : View.OnTouchListener {
        private var streakSide = 0
        private var streakAt = 0L
        private var streakTotal = 0
        private var consumed = false
        private var mode = 0 // 0 لم يُحدَّد، 1 صوت، 2 سطوع، -1 تجاهل
        private var volume = -1f
        private var brightness = -1f
        private val audio by lazy { getSystemService(AUDIO_SERVICE) as AudioManager }

        private val detector = GestureDetector(this@PlayerActivity, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(e: MotionEvent) = true

            override fun onSingleTapUp(e: MotionEvent): Boolean {
                val side = sideOf(e.x)
                if (!locked && side != 0 && side == streakSide && System.currentTimeMillis() - streakAt < STREAK_MS) {
                    consumed = true
                    doubleSeek(side)
                    return true
                }
                return false
            }

            override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
                if (consumed) {
                    consumed = false
                    return true
                }
                if (clip != null) return true
                if (locked) flashUnlock() else setControls(!controlsShown())
                return true
            }

            override fun onDoubleTap(e: MotionEvent): Boolean {
                if (locked || clip != null) return true
                val side = sideOf(e.x)
                if (side == 0) togglePlay() else doubleSeek(side)
                return true
            }

            override fun onScroll(e1: MotionEvent?, e2: MotionEvent, dx: Float, dy: Float): Boolean {
                if (locked || clip != null || e1 == null) return false
                val h = root.height.toFloat()
                if (mode == 0) {
                    // حواف الشاشة لإيماءات النظام
                    if (e1.y < h * 0.1f || e1.y > h * 0.9f) { mode = -1; return false }
                    val tx = e2.x - e1.x
                    val ty = e2.y - e1.y
                    if (abs(ty) < dp(14)) return false
                    mode = if (abs(ty) > abs(tx) * 1.3f) (if (e1.x > root.width / 2f) 1 else 2) else -1
                    if (mode == 1) volume = audio.getStreamVolume(AudioManager.STREAM_MUSIC).toFloat()
                    if (mode == 2) brightness = currentBrightness()
                }
                val delta = dy / (h * 0.7f)
                when (mode) {
                    1 -> {
                        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
                        volume = (volume + delta * max).coerceIn(0f, max.toFloat())
                        audio.setStreamVolume(AudioManager.STREAM_MUSIC, volume.toInt(), 0)
                        showLevel(Glyph.Kind.VOLUME, volume / max, right = true)
                    }
                    2 -> {
                        brightness = (brightness + delta).coerceIn(0.01f, 1f)
                        window.attributes = window.attributes.apply { screenBrightness = brightness }
                        showLevel(Glyph.Kind.BRIGHTNESS, brightness, right = false)
                    }
                }
                return mode > 0
            }
        })

        private fun sideOf(x: Float): Int {
            val w = root.width.toFloat()
            return when {
                x < w * 0.4f -> -1
                x > w * 0.6f -> 1
                else -> 0
            }
        }

        private fun doubleSeek(side: Int) {
            val now = System.currentTimeMillis()
            streakTotal = if (side == streakSide && now - streakAt < STREAK_MS) streakTotal + 10 else 10
            streakSide = side
            streakAt = now
            seekBy(side)
            val badge = if (side > 0) seekRight else seekLeft
            (if (side > 0) seekLeft else seekRight).visibility = View.GONE
            badge.text = if (side > 0) "+$streakTotal ث" else "−$streakTotal ث"
            badge.visibility = View.VISIBLE
            badge.alpha = 1f
            badge.animate().cancel()
            badge.animate().alpha(0f).setStartDelay(STREAK_MS).setDuration(200).withEndAction { badge.visibility = View.GONE }.start()
        }

        override fun onTouch(v: View, e: MotionEvent): Boolean {
            detector.onTouchEvent(e)
            if (e.actionMasked == MotionEvent.ACTION_UP || e.actionMasked == MotionEvent.ACTION_CANCEL) {
                if (mode > 0) main.postDelayed(hideLevel, 700)
                mode = 0
            }
            return true
        }
    }

    private fun currentBrightness(): Float {
        val w = window.attributes.screenBrightness
        if (w >= 0) return w
        return runCatching { Settings.System.getInt(contentResolver, Settings.System.SCREEN_BRIGHTNESS) / 255f }.getOrDefault(0.5f)
    }

    private val hideLevel = Runnable { level.visibility = View.GONE }

    private fun showLevel(kind: Glyph.Kind, value: Float, right: Boolean) {
        main.removeCallbacks(hideLevel)
        levelIcon.setImageDrawable(Glyph(kind, Color.WHITE))
        levelText.text = "${(value * 100).toInt()}%"
        level.layoutParams = (level.layoutParams as FrameLayout.LayoutParams).apply {
            gravity = Gravity.CENTER_VERTICAL or if (right) Gravity.RIGHT else Gravity.LEFT
            leftMargin = if (right) 0 else dp(120)
            rightMargin = if (right) dp(120) else 0
        }
        level.visibility = View.VISIBLE
    }

    // ───────────── دورة الحياة ─────────────

    /** التقدّم للواجهة (سجل المشاهدة) — كل ١٠ ثوانٍ وعند كل تبديل وخروج. */
    private fun report(final: Boolean) {
        val c = current
        if (c == null || !reportedStart) {
            // لم يبدأ شيء: لا تقدّم يُسجَّل، لكن الواجهة تعرف أن المشغّل أُغلق
            if (final) PlaybackEvents.emit(PlaybackEvents.Progress(sessionId, "", "", launch.animeId, episode, 0, 0, true, null))
            return
        }
        val d = player.duration.takeIf { it > 0 } ?: 0
        val at = position()
        if (d > 0 && at < d * 0.9) resume[episodeInt()] = at else resume.remove(episodeInt())
        PlaybackEvents.emit(
            PlaybackEvents.Progress(
                session = sessionId,
                candidateId = c.id,
                sourceId = c.sourceId,
                animeId = launch.animeId,
                episode = episode,
                positionMs = at,
                durationMs = d,
                final = final,
                code = codeOf(c),
            ),
        )
    }

    private fun immersive() {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) immersive()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        when {
            clip != null -> clip?.close()
            sheet.isOpen -> sheet.close()
            locked -> flashUnlock()
            else -> @Suppress("DEPRECATION") super.onBackPressed()
        }
    }

    override fun onPause() {
        super.onPause()
        player.playWhenReady = false
        report(final = false)
    }

    override fun onDestroy() {
        clip?.release()
        unlisten?.invoke()
        scope.cancel()
        main.removeCallbacksAndMessages(null)
        report(final = true)
        player.release()
        engine.closeSession(sessionId)
        // لا أثر على مساحة الجهاز: المقاطع المؤقتة وكاش البث يُحذفان مع المشغّل
        MediaCache.purgeClips(this)
        MediaCache.release(this)
        super.onDestroy()
    }

    private fun subtitleMime(url: String): String = when {
        url.contains(".vtt", true) -> MimeTypes.TEXT_VTT
        url.contains(".srt", true) -> MimeTypes.APPLICATION_SUBRIP
        url.contains(".ass", true) || url.contains(".ssa", true) -> MimeTypes.TEXT_SSA
        else -> MimeTypes.TEXT_VTT
    }

    private fun fmtEpisode(e: Float) = if (e == floor(e)) e.toInt().toString() else e.toString()

    companion object {
        const val EXTRA_LAUNCH = "launch"
        const val EXTRA_SESSION = "session"
        const val STARTUP_TIMEOUT_MS = 15_000L
        const val STALL_TIMEOUT_MS = 20_000L
        const val PROGRESS_EVERY_MS = 10_000L
        const val HIDE_AFTER_MS = 3_500L
        const val SEEK_MS = 10_000L
        const val STREAK_MS = 800L
        const val BEST_WAIT_MS = 45_000L
        const val BACK_BUFFER_MS = 40_000
        const val WAIT_NEXT_MS = 60_000L

        private val json = Json { encodeDefaults = true }

        fun intent(context: Context, launch: Launch): Intent =
            Intent(context, PlayerActivity::class.java)
                .putExtra(EXTRA_LAUNCH, json.encodeToString(Launch.serializer(), launch))
                .putExtra(EXTRA_SESSION, launch.session)
    }
}

/** تجميع السيرفرات للورقة (المشغّل والواجهة بنفس القاعدة). */
object RouteGroups {
    fun bucket(q: Int?): Int? = when {
        q == null -> null
        q >= 1000 -> 1080
        q >= 700 -> 720
        q >= 460 -> 480
        else -> 360
    }

    /** [(«1080p»، سيرفرات)…] من الأعلى، ثم غير المحددة، وغير المتاحة في الآخر. */
    fun group(routes: List<Route>): List<Pair<String, List<Route>>> {
        val usable = routes.filter { it.state != RouteState.UNAVAILABLE }
        val out = mutableListOf<Pair<String, List<Route>>>()
        usable.groupBy { bucket(it.quality) }
            .toSortedMap(compareByDescending<Int?> { it ?: -1 })
            .forEach { (b, list) -> out += (b?.let { "${it}p" } ?: "جودة غير محددة") to list.sortedBy { order(it.state) } }
        val dead = routes.filter { it.state == RouteState.UNAVAILABLE }
        if (dead.isNotEmpty()) out += "غير متاح" to dead
        return out
    }

    private fun order(s: RouteState) = when (s) {
        RouteState.READY -> 0
        RouteState.RESOLVING -> 1
        RouteState.FAILED -> 2
        RouteState.UNAVAILABLE -> 3
    }
}
