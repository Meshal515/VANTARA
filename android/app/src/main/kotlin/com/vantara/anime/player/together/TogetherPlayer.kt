package com.vantara.anime.player.together

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.vantara.anime.player.Tone
import com.vantara.anime.player.dp
import com.vantara.anime.player.label
import com.vantara.anime.player.rounded
import com.vantara.anime.player.swallowTouches
import kotlinx.serialization.Serializable
import okhttp3.OkHttpClient
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong

/** ما يمرّره الويب للمشغّل حين يُفتح داخل غرفة Together. */
@Serializable
data class TogetherLaunch(
    val baseUrl: String,
    val code: String,
    val token: String,
    val mode: String = "sync",
    /** هوية الحلقة: `anime:<id>#<حلقة>` — نفس مفتاح الغرفة. */
    val mediaPrefix: String,
)

/**
 * Together داخل المشغّل الأصلي:
 *  - غرفة الانتظار قبل البداية (المتزامن): أفاتاراتكم جنب بعض و«جاري التجهيز… جاهز ✓»، والمضيف يضغط «ابدأ».
 *  - من يدخل بعد البداية يدخل على طول عند الثانية الحالية.
 *  - كل 500ms: متحكّم الانحراف (سرعة متناسبة أو قفز)، ولا تصحيح أثناء التحميل.
 *  - تشغيل/إيقاف/تقديم المضيف أوامر للغرفة؛ غيره في المتزامن لا يحرّك أحدًا.
 *  - نهاية الحلقة عند المضيف: الحلقة التالية في نفس الغرفة، والكل يتجهّز ويبدأ معًا.
 *  - الأفاتارات في الشريط العلوي للمشغّل: تظهر وتختفي معه، والضغط يفتح اللوحة.
 */
class TogetherPlayer(
    private val context: Context,
    http: OkHttpClient,
    private val launch: TogetherLaunch,
    private val hooks: Hooks,
) : TogetherClient.Listener {
    interface Hooks {
        val player: ExoPlayer
        fun message(text: String)
        fun episode(): Int
        fun sourceName(): String?
        fun switchToEpisode(n: Int)
        fun hasNextEpisode(): Boolean
        fun openPanel(title: String, build: (LinearLayout) -> Unit)
        fun refreshPanel()
        fun overlayHost(): FrameLayout
        /** توكن هوية جديد (شبكة، خيط خلفي)، أو null. */
        fun freshToken(): String?
    }

    private val main = Handler(Looper.getMainLooper())
    val client = TogetherClient(http, launch.baseUrl, launch.code, launch.token, { hooks.freshToken() }, this)
    private val ctl = DriftController()
    private var applying = false
    private var lastReported = ""
    private var lastReportAt = 0L
    private var preparedEpisode = -1
    private var ready = false
    private var failedSource: String? = null
    private var seekIssuedAt = 0L
    private var lobby: LinearLayout? = null
    private var strip: LinearLayout? = null
    private var panelOpen = false

    private val synced get() = client.mode == "sync"
    private fun mediaKey(ep: Int = hooks.episode()) = "${launch.mediaPrefix}#$ep"
    private fun episodeOf(key: String?) = key?.substringAfterLast('#', "")?.toIntOrNull()

    fun start() {
        client.connect()
        main.post(tick)
    }

    fun destroy() {
        main.removeCallbacksAndMessages(null)
        report("paused", force = true)
        client.close()
        lobby?.let { (it.parent as? ViewGroup)?.removeView(it) }
    }

    /** الشريط العلوي: 3 أفاتارات ثم «+N». */
    fun mountStrip(into: LinearLayout) {
        // كبسولة زجاجية: نقطة «مباشر» ثم 3 وجوه و«+N» — نفس تصميم القارئ في الويب
        strip = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(context.dp(9), 0, context.dp(5), 0)
            background = rounded(0x17FFFFFF, context.dp(18).toFloat(), context.dp(1), 0x1FFFFFFF)
            contentDescription = "الغرفة"
            setOnClickListener { openPanel() }
        }
        into.addView(strip, 1, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, context.dp(36)).apply { marginStart = context.dp(8); marginEnd = context.dp(8) })
        paintStrip()
    }

    // ───────────── أحداث المشغّل ─────────────

    fun onPreparing() { ready = false; failedSource = null; report("preparing", force = true) }

    fun onReady() {
        val t = client.timeline
        if (!ready) {
            ready = true
            preparedEpisode = hooks.episode()
            if (synced && t != null && !t.started) {
                // غرفة الانتظار: جاهز عند الإطار الأول، متوقف حتى «ابدأ»
                withApplying { hooks.player.playWhenReady = false; hooks.player.seekTo(0) }
                report("ready", force = true)
                showLobby()
                return
            }
            if (synced && t != null && t.started) {
                // دخول متأخر أو بعد تبديل سيرفر: على طول عند الثانية الحالية
                jumpToRoom(t)
            }
        }
        report(stateNow())
    }

    fun onBuffering() = report("buffering")

    fun onFailed(source: String?) { failedSource = source; report("failed", force = true) }

    /** انتهت الحلقة: المضيف ينقل الغرفة للتالية، والبقية ينتظرونه. يعيد true إن تولّى Together الأمر. */
    fun onEnded(): Boolean {
        if (!client.isHost) {
            if (synced) hooks.message("بانتظار المضيف للحلقة التالية…")
            return synced
        }
        if (!hooks.hasNextEpisode()) return false
        val next = hooks.episode() + 1
        client.command("load", 0.0, mediaKey(next), "الحلقة $next")
        hooks.switchToEpisode(next)
        return true
    }

    /** المستخدم ضغط تشغيل/إيقاف. المضيف يأمر الغرفة؛ غيره في المتزامن لا يحرّكها. */
    fun onUserPlayPause(playing: Boolean): Boolean {
        if (applying) return false
        val t = client.timeline ?: return false
        if (!synced) return false
        if (client.canControl) {
            if (!t.started && playing) client.command("play", 0.0) else client.command(if (playing) "play" else "pause", hooks.player.currentPosition.toDouble())
            return false
        }
        hooks.message("المضيف يتحكم بالتشغيل")
        withApplying { hooks.player.playWhenReady = t.playing }
        return true
    }

    /** المستخدم قدّم/رجّع. */
    fun onUserSeek(toMs: Long) {
        if (applying || !synced) return
        if (client.canControl) client.command("seek", toMs.toDouble())
        else hooks.message("المضيف يتحكم بالتشغيل — نرجّعك معهم")
    }

    // ───────────── أحداث الغرفة ─────────────

    override fun onWelcome() {
        // A fast local source can become ready before the WebSocket welcome.
        // Reconcile that first frame with the room instead of playing behind the lobby.
        if (synced && ready) client.timeline?.let { t ->
            if (!t.started) {
                withApplying { hooks.player.playWhenReady = false; hooks.player.seekTo(0) }
                showLobby()
            } else jumpToRoom(t)
        }
        paintStrip()
        report(stateNow(), force = true)
    }

    override fun onState(timeline: Timeline, by: String?) {
        val ep = episodeOf(timeline.mediaKey)
        // الحلقة التالية (أو أي حلقة اختارها المضيف): كل واحد يجهّزها بسيرفره
        if (ep != null && ep != hooks.episode()) {
            if (synced || by == client.hostUserId) { ready = false; hooks.switchToEpisode(ep) }
            return
        }
        if (timeline.started) hideLobby() else if (synced && ready) showLobby()
        if (synced && timeline.started && ready && by != client.me) jumpToRoom(timeline)
        paintLobby()
    }

    override fun onRoster(members: List<Member>) { paintStrip(); paintLobby(); if (panelOpen) hooks.refreshPanel() }
    override fun onMode(mode: String) {
        hooks.message(if (mode == "sync") "صارت المشاهدة متزامنة" else "صارت المشاهدة منفصلة: كل واحد بوقته")
        if (mode != "sync") withApplying { hooks.player.setPlaybackSpeed(1f) }
    }
    override fun onStatus(userId: String, name: String, state: String, source: String?) {
        if (userId == client.me) return
        when (state) {
            "playing" -> hooks.message("اشتغل الفيديو عند $name")
            "failed" -> hooks.message("تعذّر تشغيل السيرفر عند $name${source?.let { " ($it)" } ?: ""}")
            "ready" -> if (client.timeline?.started == false) hooks.message("$name جاهز")
        }
    }
    override fun onJoined(name: String) = hooks.message("$name دخل")
    override fun onLeft(name: String) = hooks.message("$name طلع")
    override fun onHost(userId: String) { if (userId == client.me) hooks.message("صرت المضيف"); paintLobby() }
    override fun onClosed(reason: String) {
        hooks.message(when (reason) { "full" -> "الغرفة ممتلئة"; "gone" -> "انتهت الغرفة"; "uninvited" -> "هالغرفة لأشخاص محددين"; "replaced" -> "دخلت الغرفة من جهاز ثاني"; else -> "انقطعت الغرفة" })
        hideLobby()
        withApplying { hooks.player.setPlaybackSpeed(1f) }
    }

    // ───────────── المزامنة ─────────────

    private val tick = object : Runnable {
        override fun run() {
            step()
            main.postDelayed(this, 500)
        }
    }

    private fun step() {
        val p = hooks.player
        val t = client.timeline
        val at = client.clock.serverNow(SystemClock.elapsedRealtime().toDouble())
        if (t != null && synced && t.started && ready && client.clock.ready && at >= t.at && episodeOf(t.mediaKey) == hooks.episode()) {
            val pos = p.currentPosition.toDouble()
            val d = ctl.step(
                t, pos, at,
                buffering = p.playbackState == Player.STATE_BUFFERING,
                canRate = !p.isCurrentMediaItemLive,
                bufferedAhead = max(0L, p.bufferedPosition - p.currentPosition).toDouble(),
                bufferedBehind = min(p.currentPosition, BACK_BUFFER_MS).toDouble(),
            )
            withApplying {
                if (p.playWhenReady != d.playing) p.playWhenReady = d.playing
                if (abs(p.playbackParameters.speed - d.rate.toFloat()) > 0.001f) p.playbackParameters = PlaybackParameters(d.rate.toFloat())
                d.seekTo?.let { seekIssuedAt = SystemClock.elapsedRealtime(); p.seekTo(it) }
            }
        }
        if (seekIssuedAt > 0 && p.playbackState == Player.STATE_READY) {
            ctl.seeked(SystemClock.elapsedRealtime() - seekIssuedAt)
            seekIssuedAt = 0
        }
        if (SystemClock.elapsedRealtime() - lastReportAt >= if (synced) 2000 else 5000) report(stateNow())
        if (panelOpen) hooks.refreshPanel()
    }

    private fun jumpToRoom(t: Timeline) {
        val at = client.clock.serverNow(SystemClock.elapsedRealtime().toDouble())
        if (at < t.at) {
            // Apply the scheduled command at the shared instant, not on receipt.
            main.postDelayed({
                if (synced && ready && client.timeline?.seq == t.seq && episodeOf(t.mediaKey) == hooks.episode()) jumpToRoom(t)
            }, (t.at - at).toLong().coerceAtLeast(1L))
            return
        }
        // Explicit commands/late join use the current room position. The drift controller
        // retains its measured seek prediction for subsequent correction.
        val target = targetAt(t, at)
        withApplying {
            if (abs(hooks.player.currentPosition - target) > SyncRules.HOST_CMD_SEEK_MS) { seekIssuedAt = SystemClock.elapsedRealtime(); hooks.player.seekTo(target.roundToLong()) }
            hooks.player.playWhenReady = t.playing
        }
    }

    private fun stateNow(): String {
        val p = hooks.player
        return when {
            failedSource != null -> "failed"
            !ready -> "preparing"
            p.playbackState == Player.STATE_BUFFERING -> "buffering"
            client.timeline?.started == false && synced -> "ready"
            p.isPlaying -> "playing"
            else -> "paused"
        }
    }

    private fun report(state: String, force: Boolean = false) {
        val now = SystemClock.elapsedRealtime()
        if (!force && state == lastReported && now - lastReportAt < 1000) return
        lastReported = state
        lastReportAt = now
        val (_, p95) = ctl.stats()
        val t = client.timeline
        val drift = if (t != null && t.started && synced) (hooks.player.currentPosition - targetAt(t, client.clock.serverNow(now.toDouble()))).roundToLong() else null
        client.report(
            pos = hooks.player.currentPosition.toDouble(),
            state = state,
            source = failedSource ?: hooks.sourceName(),
            mediaKey = mediaKey(),
            durationMs = hooks.player.duration.takeIf { it > 0 },
            driftMs = drift,
            driftP95 = p95,
        )
    }

    private inline fun withApplying(block: () -> Unit) {
        applying = true
        try { block() } finally { main.post { applying = false } }
    }

    // ───────────── الواجهة ─────────────

    private fun stateColor(state: String) = when (state) {
        "playing", "ready" -> 0xFF30D178.toInt()
        "preparing", "buffering" -> 0xFFF5B942.toInt()
        "failed" -> 0xFFFF6B6E.toInt()
        else -> 0xFF8A8694.toInt()
    }

    /** وجه دائري بلون ثابت للاسم. [ring] حلقة بلون الحالة (غرفة الانتظار). */
    private fun face(m: Member, size: Int, ring: Boolean = false): TextView = context.label(m.name.take(1), (size / 2.6f), Color.WHITE, bold = true).apply {
        gravity = Gravity.CENTER
        val hue = ((m.name.hashCode() and 0x7fffffff) % 360).toFloat()
        background = GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            intArrayOf(Color.HSVToColor(floatArrayOf(hue, 0.5f, 0.85f)), Color.HSVToColor(floatArrayOf((hue + 25) % 360, 0.7f, 0.5f))),
        ).apply {
            shape = GradientDrawable.OVAL
            setStroke(context.dp(if (ring) 3 else 2), if (ring) stateColor(m.state) else if (m.state == "failed") 0xFFFF6B6E.toInt() else 0xFF15121C.toInt())
        }
        alpha = if (m.state == "preparing" || m.state == "buffering") (if (ring) 0.8f else 0.6f) else 1f
    }

    private fun paintStrip() {
        val s = strip ?: return
        val known = (0 until s.childCount).mapNotNull { s.getChildAt(it).tag as? String }.toSet()
        s.removeAllViews()
        val people = client.roster.sortedWith(compareByDescending<Member> { it.host }.thenBy { it.joinedAt })
        s.addView(View(context).apply {
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(if (people.any { it.state == "failed" }) 0xFFFF6B6E.toInt() else 0xFF30D178.toInt()) }
        }, LinearLayout.LayoutParams(context.dp(7), context.dp(7)).apply { marginEnd = context.dp(7) })
        people.take(3).forEachIndexed { i, m ->
            val f = face(m, 26).apply { tag = m.userId }
            s.addView(f, LinearLayout.LayoutParams(context.dp(26), context.dp(26)).apply { if (i > 0) marginStart = -context.dp(8) })
            // دخل الحين: ينزلق بنعومة في مكانه
            if (m.userId !in known && known.isNotEmpty()) { f.translationY = -context.dp(10).toFloat(); f.alpha = 0f; f.animate().translationY(0f).alpha(1f).setDuration(380).start() }
        }
        if (people.size > 3) {
            s.addView(context.label("+${people.size - 3}", 10.5f, Color.WHITE, bold = true).apply {
                gravity = Gravity.CENTER
                background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(0xFF2A2635.toInt()); setStroke(context.dp(2), 0xFF15121C.toInt()) }
            }, LinearLayout.LayoutParams(context.dp(26), context.dp(26)).apply { marginStart = -context.dp(8) })
        }
        s.visibility = if (people.isEmpty()) View.GONE else View.VISIBLE
    }

    private fun stateLabel(state: String) = when (state) {
        "preparing" -> "جاري تجهيز الحلقة…"; "ready" -> "جاهز ✓"; "playing" -> "يشاهد"; "paused" -> "متوقف"
        "buffering" -> "يحمّل…"; "failed" -> "تعذّر السيرفر"; else -> ""
    }

    private fun clock(ms: Double?): String {
        if (ms == null || ms < 0) return "—"
        val s = (ms / 1000).toLong()
        return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, (s % 3600) / 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
    }

    private fun openPanel() {
        panelOpen = true
        hooks.openPanel(if (synced) "مشاهدة معًا · متزامنة" else "مشاهدة معًا · منفصلة") { body ->
            val now = client.clock.serverNow(SystemClock.elapsedRealtime().toDouble())
            for (m in client.roster.sortedBy { it.joinedAt }) {
                val row = LinearLayout(context).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    layoutDirection = View.LAYOUT_DIRECTION_RTL
                    setPadding(context.dp(10), context.dp(9), context.dp(10), context.dp(9))
                    background = rounded(0x0AFFFFFF, context.dp(14).toFloat(), context.dp(1), 0x0FFFFFFF)
                }
                val faceBox = FrameLayout(context)
                faceBox.addView(face(m, 34), FrameLayout.LayoutParams(context.dp(34), context.dp(34)))
                faceBox.addView(View(context).apply {
                    background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(stateColor(m.state)); setStroke(context.dp(2), 0xFF0F0D16.toInt()) }
                }, FrameLayout.LayoutParams(context.dp(11), context.dp(11), Gravity.BOTTOM or Gravity.START))
                row.addView(faceBox, LinearLayout.LayoutParams(context.dp(36), context.dp(36)))
                val names = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(context.dp(10), 0, context.dp(10), 0) }
                names.addView(context.label(if (m.userId == client.me) "أنت" else m.name, 14f, Tone.TEXT, bold = true))
                names.addView(context.label(listOfNotNull(stateLabel(m.state), m.source).joinToString(" · "), 12f, when (m.state) { "failed" -> 0xFFFF8B8E.toInt(); "playing", "ready" -> 0xFF6FE3A1.toInt(); "preparing", "buffering" -> 0xFFF5C76A.toInt(); else -> Tone.TEXT_2 }))
                row.addView(names, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                val where = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.END }
                val pos = if (m.state == "playing" && m.pos != null && m.at != null) m.pos + max(0.0, now - m.at) else m.pos
                where.addView(context.label(clock(pos), 14f, Tone.TEXT, bold = true))
                val tags = listOfNotNull(
                    if (m.host) "المضيف" else null,
                    if (m.sameVersion == false) "نسخة مختلفة" else null,
                    if (synced && !m.host && m.driftMs != null) "فرق ${abs(m.driftMs)}ms" else null,
                )
                if (tags.isNotEmpty()) where.addView(context.label(tags.joinToString(" · "), 11f, Tone.TEXT_3))
                row.addView(where)
                body.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = context.dp(6) })
            }
            if (client.isHost) {
                body.addView(button(if (synced) "حوّلها منفصلة" else "حوّلها متزامنة", primary = false) { client.setMode(if (synced) "free" else "sync") })
            }
        }
    }

    fun panelClosed() { panelOpen = false }

    private fun button(text: String, primary: Boolean, onClick: () -> Unit) = context.label(text, 14f, Color.WHITE, bold = true).apply {
        gravity = Gravity.CENTER
        setPadding(context.dp(18), context.dp(11), context.dp(18), context.dp(11))
        background = rounded(if (primary) Tone.ACCENT else Tone.alpha(Color.WHITE, 0x22), context.dp(22).toFloat())
        setOnClickListener { onClick() }
    }

    /** غرفة الانتظار: أفاتاراتكم جنب بعض وتحت كل واحد حالته، والمضيف يضغط «ابدأ». */
    private fun showLobby() {
        if (lobby == null) {
            lobby = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                setBackgroundColor(0xC705040A.toInt())
                swallowTouches()
            }
            hooks.overlayHost().addView(lobby, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        paintLobby()
    }

    private fun hideLobby() {
        lobby?.let { (it.parent as? ViewGroup)?.removeView(it) }
        lobby = null
    }

    private fun paintLobby() {
        val l = lobby ?: return
        l.removeAllViews()
        l.addView(context.label("مشاهدة معًا", 13f, Tone.TEXT_3, bold = true).apply { gravity = Gravity.CENTER })
        l.addView(context.label("الحلقة ${hooks.episode()}", 20f, Color.WHITE, bold = true).apply { gravity = Gravity.CENTER; setPadding(0, context.dp(4), 0, context.dp(18)) })
        val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        for (m in client.roster.sortedBy { it.joinedAt }) {
            val col = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(context.dp(12), 0, context.dp(12), 0) }
            col.addView(face(m, 56, ring = true), LinearLayout.LayoutParams(context.dp(56), context.dp(56)))
            col.addView(context.label(if (m.userId == client.me) "أنت" else m.name, 13f, Color.WHITE, bold = true).apply { gravity = Gravity.CENTER; setPadding(0, context.dp(6), 0, 0) })
            col.addView(context.label(stateLabel(m.state), 11.5f, when (m.state) { "ready", "playing" -> 0xFF6FE3A1.toInt(); "failed" -> 0xFFFF8B8E.toInt(); else -> 0xFFF5C76A.toInt() }).apply { gravity = Gravity.CENTER })
            row.addView(col)
        }
        l.addView(row)
        val readyCount = client.roster.count { it.state == "ready" || it.state == "playing" }
        if (client.isHost) {
            l.addView(button("ابدأ  ($readyCount من ${client.roster.size} جاهزين)", primary = true) { client.command("play", 0.0) },
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = context.dp(22); gravity = Gravity.CENTER_HORIZONTAL })
            l.addView(context.label("من لم يجهز يلحق تلقائيًا", 11.5f, Tone.TEXT_3).apply { gravity = Gravity.CENTER; setPadding(0, context.dp(8), 0, 0) })
        } else {
            l.addView(context.label("بانتظار المضيف يبدأ…", 13f, Tone.TEXT_2).apply { gravity = Gravity.CENTER; setPadding(0, context.dp(22), 0, 0) })
        }
    }

    companion object {
        /** نفس ذاكرة الخلف في المشغّل (40 ث): القفز للخلف داخلها رخيص. */
        const val BACK_BUFFER_MS = 40_000L
    }
}
