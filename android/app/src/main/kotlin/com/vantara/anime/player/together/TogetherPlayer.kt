package com.vantara.anime.player.together

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.widget.ImageView
import android.widget.ScrollView
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
import com.vantara.anime.player.Glyph
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
    // شاشة الغرفة (من الويب، اختيارية): نوع العمل، الاسم، بنر الحلقة، الشعار، عنوان الحلقة
    val kindText: String? = null,
    val title: String? = null,
    val banner: String? = null,
    val logo: String? = null,
    val episodeTitle: String? = null,
    val season: Int? = null,
    val invitees: List<Invitee> = emptyList(),
)

@Serializable
data class Invitee(val userId: String, val displayName: String = "صديق", val avatarKey: String? = null)

/**
 * Together داخل المشغّل الأصلي:
 *  - غرفة الانتظار قبل البداية (المتزامن): أفاتاراتكم جنب بعض و«جاري التجهيز… جاهز»، والمضيف يضغط «ابدأ».
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
        /** «اطلع من الغرفة»: يغلق المشغّل ويغادر. */
        fun leaveRoom() {}
        /** «غيّر» في شاشة الغرفة: ورقة السيرفرات. */
        fun openServers() {}
        /** «OKRU · 1080p» للسيرفر الحالي. */
        fun serverLabel(): String? = sourceName()
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
    private var lobby: FrameLayout? = null
    private var lobbySide: LinearLayout? = null
    private var lobbyConn: TextView? = null
    private var strip: LinearLayout? = null
    private var panelOpen = false
    private var quiet = false
    private var connected = false
    private val images = TogetherImages(context, http)
    private val prefs = context.getSharedPreferences("together_offsets", Context.MODE_PRIVATE)

    private val synced get() = client.mode == "sync"
    private fun mediaKey(ep: Int = hooks.episode()) = "${launch.mediaPrefix}#$ep"
    private fun episodeOf(key: String?) = key?.substringAfterLast('#', "")?.toIntOrNull()

    // ───────────── ديلاي الفيديو الشخصي ─────────────
    // لك وحدك: مصدرك فيه مقدمة 10 ث زيادة؟ +10 ث تجعل فيديوك متقدّمًا عن وقت الغرفة،
    // فتشوفون نفس المشهد. الغرفة تستلم وقتها هي (بلا ديلاي أحد). يُحفظ لكل حلقة وسيرفر.
    private fun offsetKey() = "${mediaKey()}|${hooks.sourceName().orEmpty()}"
    val offsetMs: Long get() = prefs.getLong(offsetKey(), 0L)
    /** موضع الفيديو بوقت الغرفة. */
    private fun roomPos(localMs: Long = hooks.player.currentPosition) = max(0L, localMs - offsetMs).toDouble()

    fun setOffset(ms: Long) {
        val v = ((ms.coerceIn(-OFFSET_LIMIT_MS, OFFSET_LIMIT_MS)) / 100) * 100
        prefs.edit().apply { if (v == 0L) remove(offsetKey()) else putLong(offsetKey(), v) }.apply()
        val t = client.timeline
        if (ready && synced && t != null) {
            if (t.started) jumpToRoom(t, force = true)
            else withApplying { hooks.player.seekTo(max(0L, v)) }
        }
        hooks.message(if (v == 0L) "بدون ديلاي" else "ديلاي فيديوك ${offsetText(v)}")
        paintLobby()
        if (panelOpen) hooks.refreshPanel()
        report(stateNow(), force = true)
    }

    private fun offsetText(v: Long) = if (v == 0L) "0 ث" else "${if (v > 0) "+" else "−"}${"%.1f".format(abs(v) / 1000.0)} ث"

    /** قبل البدء: التجهيز بصمت (لا صوت مفاجئ من أول إطار) ثم الوقوف عند البداية. */
    private fun mute(on: Boolean) {
        if (quiet == on) return
        quiet = on
        hooks.player.volume = if (on) 0f else 1f
    }

    fun start() {
        client.connect()
        main.post(tick)
        // غرفة متزامنة: شاشة الغرفة من أول لحظة (الأصدقاء، سيرفرك وزر «غيّر»)، لا شاشة سوداء
        // تنتظر الإطار الأول. إن كانت الغرفة بدأت فعلًا يخفيها الترحيب ويقفز للثانية الحالية.
        if (launch.mode == "sync") showLobby()
    }

    fun destroy() {
        main.removeCallbacksAndMessages(null)
        report("paused", force = true)
        client.close()
        mute(false)
        images.close()
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

    fun onPreparing() {
        ready = false
        failedSource = null
        if (synced && client.timeline?.started != true) { mute(true); showLobby() }
        report("preparing", force = true)
        paintLobby()
    }

    fun onReady() {
        val t = client.timeline
        if (!ready) {
            ready = true
            preparedEpisode = hooks.episode()
            if (synced && t?.started != true) {
                // غرفة الانتظار: جاهز عند الإطار الأول، متوقف عند البداية (مع ديلايك) حتى «ابدأ».
                // حالة الغرفة لم تصل بعد (السيرفر أسرع من الاتصال)؟ نفس الشيء؛ الترحيب يقفز إن كانت بدأت.
                withApplying { hooks.player.playWhenReady = false; hooks.player.seekTo(max(0L, offsetMs)) }
                mute(false)
                report("ready", force = true)
                showLobby()
                return
            }
            mute(false)
            if (synced && t != null && t.started) {
                // دخول متأخر أو بعد تبديل سيرفر: على طول عند الثانية الحالية
                jumpToRoom(t)
            }
        }
        report(stateNow())
    }

    fun onBuffering() = report("buffering")

    fun onFailed(source: String?) { failedSource = source; mute(false); report("failed", force = true); paintLobby() }

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
            if (!t.started && playing) client.command("play", 0.0) else client.command(if (playing) "play" else "pause", roomPos())
            return false
        }
        hooks.message("المضيف يتحكم بالتشغيل")
        withApplying { hooks.player.playWhenReady = t.playing }
        return true
    }

    /** المستخدم قدّم/رجّع. */
    fun onUserSeek(toMs: Long) {
        if (applying || !synced) return
        if (client.canControl) client.command("seek", roomPos(toMs))
        else hooks.message("المضيف يتحكم بالتشغيل — نرجّعك معهم")
    }

    // ───────────── أحداث الغرفة ─────────────

    override fun onWelcome() {
        // A fast local source can become ready before the WebSocket welcome.
        // Reconcile that first frame with the room instead of playing behind the lobby.
        val t = client.timeline
        // دخول متأخر (الغرفة بدأت) أو غرفة منفصلة: لا شاشة انتظار
        if (!synced || t?.started == true) hideLobby() else showLobby()
        if (synced && ready && t != null) {
            if (!t.started) withApplying { hooks.player.playWhenReady = false; hooks.player.seekTo(max(0L, offsetMs)) }
            else jumpToRoom(t)
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
        if (timeline.started) { hideLobby(); mute(false) } else if (synced && ready) showLobby()
        if (synced && timeline.started && ready && by != client.me) jumpToRoom(timeline)
        paintLobby()
    }

    override fun onRoster(members: List<Member>) { paintStrip(); paintLobby(); if (panelOpen) hooks.refreshPanel() }
    override fun onMode(mode: String) {
        hooks.message(if (mode == "sync") "صارت المشاهدة متزامنة" else "صارت المشاهدة منفصلة: كل واحد بوقته")
        if (mode != "sync") { hideLobby(); withApplying { hooks.player.setPlaybackSpeed(1f) } }
    }
    override fun onStatus(userId: String, name: String, state: String, source: String?) {
        if (userId == client.me) return
        when (state) {
            "playing" -> hooks.message("اشتغل الفيديو عند $name")
            "failed" -> hooks.message("تعذّر تشغيل السيرفر عند $name${source?.let { " ($it)" } ?: ""}")
            "ready" -> if (client.timeline?.started == false) hooks.message("$name جاهز")
        }
    }
    override fun onConnection(live: Boolean) { connected = live; paintLobby() }
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
                offsetMs = offsetMs.toDouble(),
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

    private fun jumpToRoom(t: Timeline, force: Boolean = false) {
        val at = client.clock.serverNow(SystemClock.elapsedRealtime().toDouble())
        if (at < t.at) {
            // Apply the scheduled command at the shared instant, not on receipt.
            main.postDelayed({
                if (synced && ready && client.timeline?.seq == t.seq && episodeOf(t.mediaKey) == hooks.episode()) jumpToRoom(t, force)
            }, (t.at - at).toLong().coerceAtLeast(1L))
            return
        }
        // Explicit commands/late join use the current room position. The drift controller
        // retains its measured seek prediction for subsequent correction.
        val target = targetAt(t, at, offsetMs.toDouble())
        withApplying {
            if (abs(hooks.player.currentPosition - target) > if (force) 50.0 else SyncRules.HOST_CMD_SEEK_MS) { seekIssuedAt = SystemClock.elapsedRealtime(); hooks.player.seekTo(target.roundToLong()) }
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
        val drift = if (t != null && t.started && synced) (hooks.player.currentPosition - targetAt(t, client.clock.serverNow(now.toDouble()), offsetMs.toDouble())).roundToLong() else null
        client.report(
            pos = roomPos(),
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
        "playing", "ready", "paused" -> 0xFF30D178.toInt()
        "preparing", "buffering" -> 0xFFF5B942.toInt()
        "failed" -> 0xFFFF6B6E.toInt()
        "pending" -> 0x59FFFFFF
        else -> 0xFF8A8694.toInt()
    }

    /**
     * وجه دائري: صورة الشخص الحقيقية (نفس أفاتار التطبيق)، وإلى أن تصل — أو إن لم توجد —
     * حرف اسمه بلون ثابت. [ring] حلقة بلون الحالة (غرفة الانتظار).
     */
    private fun face(userId: String, name: String, avatarKey: String?, state: String, size: Int, ring: Boolean = false): TextView =
        context.label(name.take(1), (size / 2.6f), Color.WHITE, bold = true).apply {
            gravity = Gravity.CENTER
            val hue = ((name.hashCode() and 0x7fffffff) % 360).toFloat()
            val stroke = context.dp(if (ring) 3 else 2)
            val strokeColor = if (ring) stateColor(state) else if (state == "failed") 0xFFFF6B6E.toInt() else 0xFF15121C.toInt()
            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(Color.HSVToColor(floatArrayOf(hue, 0.5f, 0.85f)), Color.HSVToColor(floatArrayOf((hue + 25) % 360, 0.7f, 0.5f))),
            ).apply { shape = GradientDrawable.OVAL; setStroke(stroke, strokeColor) }
            alpha = when (state) { "pending" -> 0.45f; "preparing", "buffering" -> if (ring) 0.85f else 0.6f; else -> 1f }
            tag = userId
            images.load(avatarKey, context.dp(size) * 2) { bmp ->
                if (bmp == null || tag != userId) return@load
                val ringDrawable = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.TRANSPARENT); setStroke(stroke, strokeColor) }
                background = images.circle(bmp, ringDrawable)
                text = ""
            }
        }

    private fun face(m: Member, size: Int, ring: Boolean = false) = face(m.userId, m.name, m.avatarKey, m.state, size, ring)

    private fun paintStrip() {
        val s = strip ?: return
        val known = (0 until s.childCount).mapNotNull { s.getChildAt(it).tag as? String }.toSet()
        s.removeAllViews()
        val people = client.roster.sortedWith(compareByDescending<Member> { it.host }.thenBy { it.joinedAt })
        s.addView(View(context).apply {
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(if (people.any { it.state == "failed" }) 0xFFFF6B6E.toInt() else 0xFF30D178.toInt()) }
        }, LinearLayout.LayoutParams(context.dp(7), context.dp(7)).apply { marginEnd = context.dp(7) })
        people.take(3).forEachIndexed { i, m ->
            val f = face(m, 26)
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
        s.visibility = if (people.isEmpty() || lobby != null) View.GONE else View.VISIBLE
    }

    private fun stateLabel(state: String) = when (state) {
        "preparing" -> "يجهّز…"; "ready" -> "جاهز"; "playing" -> "يشاهد"; "paused" -> "متوقف"
        "buffering" -> "يحمّل…"; "failed" -> "تعذّر السيرفر"; "pending" -> "بانتظاره…"; else -> ""
    }

    private fun stateTextColor(state: String) = when (state) {
        "ready", "playing", "paused" -> 0xFF6FE3A1.toInt(); "failed" -> 0xFFFF8B8E.toInt(); "pending" -> Tone.TEXT_3; else -> 0xFFF5C76A.toInt()
    }

    private fun clock(ms: Double?): String {
        if (ms == null || ms < 0) return "—"
        val s = (ms / 1000).toLong()
        return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, (s % 3600) / 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
    }

    /** المدعوون الذين لم يدخلوا بعد (الدعوة «للكل» لا تُعدّ أسماءً). */
    private fun pending(): List<Invitee> {
        val ids = client.invited ?: launch.invitees.map { it.userId }.takeIf { it.isNotEmpty() } ?: return emptyList()
        val inside = client.roster.map { it.userId }.toSet()
        return ids.filter { it != client.me && it !in inside }.map { id -> launch.invitees.firstOrNull { it.userId == id } ?: Invitee(id) }
    }

    /** سطر الحالة الكبير في شاشة الغرفة — نفس كلمات الويب (together-lobby.js). */
    private fun headline(): Pair<String, Boolean> {
        val waiting = pending().let { p ->
            if (p.isEmpty()) "" else "بانتظار ${p.take(2).joinToString(" و") { it.displayName }}${if (p.size > 2) " و${p.size - 2} غيرهم" else ""}…"
        }
        return when {
            failedSource != null -> "تعذّر تشغيل سيرفرك · اختر سيرفرًا آخر" to true
            !ready -> "نجهّز فيديوك من سيرفرك…" to false
            client.isHost -> {
                val notReady = client.roster.count { it.state == "preparing" || it.state == "failed" }
                (waiting.ifEmpty { if (notReady > 0) "${client.roster.size - notReady} من ${client.roster.size} جاهزين · ابدأ متى ما تبي" else "الكل جاهز · ابدأ متى ما تبي" }) to false
            }
            waiting.isNotEmpty() -> "فيديوك جاهز · $waiting" to false
            else -> "فيديوك جاهز ومتوقف عند البداية · بانتظار المضيف" to false
        }
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
                names.addView(context.label(listOfNotNull(stateLabel(m.state), m.source).joinToString(" · "), 12f, stateTextColor(m.state)))
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
            for (p in pending()) {
                val row = LinearLayout(context).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    layoutDirection = View.LAYOUT_DIRECTION_RTL
                    setPadding(context.dp(10), context.dp(9), context.dp(10), context.dp(9))
                }
                row.addView(face(p.userId, p.displayName, p.avatarKey, "pending", 34), LinearLayout.LayoutParams(context.dp(34), context.dp(34)))
                row.addView(context.label("${p.displayName} · لم يدخل بعد", 13f, Tone.TEXT_3).apply { setPadding(context.dp(10), 0, context.dp(10), 0) })
                body.addView(row)
            }
            if (synced) body.addView(offsetRow(), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = context.dp(8); bottomMargin = context.dp(8) })
            if (client.isHost) {
                body.addView(button(if (synced) "حوّلها منفصلة" else "حوّلها متزامنة", primary = false) { client.setMode(if (synced) "free" else "sync") })
            }
            body.addView(button("اطلع من الغرفة", primary = false) { hooks.leaveRoom() }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = context.dp(8) })
        }
    }

    fun panelClosed() { panelOpen = false }

    private fun button(text: String, primary: Boolean, onClick: () -> Unit) = context.label(text, 14f, Color.WHITE, bold = true).apply {
        gravity = Gravity.CENTER
        setPadding(context.dp(18), context.dp(11), context.dp(18), context.dp(11))
        background = rounded(if (primary) Tone.ACCENT else Tone.alpha(Color.WHITE, 0x22), context.dp(22).toFloat())
        setOnClickListener { onClick() }
    }

    /** «ديلاي فيديوك (لك وحدك)  [−] +1.0 ث [+]  صفّر». */
    private fun offsetRow(): View = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        setPadding(context.dp(12), context.dp(6), context.dp(12), context.dp(6))
        background = rounded(0x0DFFFFFF, context.dp(16).toFloat())
        val v = offsetMs
        val text = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        text.addView(context.label("ديلاي فيديوك · لك وحدك", 11.5f, Tone.TEXT_3, bold = true).apply { maxLines = 1 })
        text.addView(context.label(if (v == 0L) "بدون" else "مضبوط على مصدرك", 14f, Color.WHITE, bold = true))
        addView(text, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        if (v != 0L) addView(button("صفّر", primary = false) { setOffset(0) }.apply { setPadding(context.dp(12), context.dp(6), context.dp(12), context.dp(6)); textSize = 12.5f },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = context.dp(8) })
        val step = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            background = rounded(0x12FFFFFF, context.dp(20).toFloat())
            setPadding(context.dp(3), context.dp(3), context.dp(3), context.dp(3))
        }
        fun stepBtn(label: String, delta: Long, desc: String) = context.label(label, 18f, Color.WHITE, bold = true).apply {
            gravity = Gravity.CENTER
            background = rounded(0x1FFFFFFF, context.dp(16).toFloat())
            contentDescription = desc
            setOnClickListener { setOffset(offsetMs + delta) }
        }
        step.addView(stepBtn("−", -500, "أخّر فيديوك نصف ثانية"), LinearLayout.LayoutParams(context.dp(34), context.dp(34)))
        step.addView(context.label(offsetText(v), 13.5f, Color.WHITE, bold = true).apply { gravity = Gravity.CENTER; minWidth = context.dp(64) })
        step.addView(stepBtn("+", 500, "قدّم فيديوك نصف ثانية"), LinearLayout.LayoutParams(context.dp(34), context.dp(34)))
        addView(step)
    }

    private fun chip(text: String): TextView = context.label(text, 12f, 0xE0FFFFFF.toInt(), bold = true).apply {
        gravity = Gravity.CENTER_VERTICAL
        setPadding(context.dp(12), 0, context.dp(12), 0)
        background = rounded(0x1AFFFFFF, context.dp(15).toFloat(), context.dp(1), 0x1FFFFFFF)
        maxLines = 1
    }

    /**
     * شاشة الغرفة (نفس تصميم الويب together-lobby.js): بنر الحلقة خلفية، شعار العمل أو
     * اسمه، الحلقة وعنوانها؛ وبجانبها الأشخاص بصورهم وحالاتهم، سيرفرك وزر «غيّر»، ديلاي
     * فيديوك، و«ابدأ للجميع» للمضيف أو «بانتظار المضيف» للضيف، و«اطلع من الغرفة».
     */
    private fun showLobby() {
        if (lobby == null) {
            val root = FrameLayout(context).apply {
                setBackgroundColor(0xFF07080C.toInt())
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                swallowTouches()
            }
            // البنر + ظل يميل للجهة التي عليها النص
            val banner = ImageView(context).apply { scaleType = ImageView.ScaleType.CENTER_CROP; alpha = 0f }
            root.addView(banner, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            images.load(launch.banner, context.resources.displayMetrics.widthPixels) { bmp -> if (bmp != null) { banner.setImageBitmap(bmp); banner.animate().alpha(1f).setDuration(420).start() } }
            // معتم تحت عمود التحكم (يسار) وشفاف فوق البنر، وتعتيم سفلي تحت الشعار
            root.addView(View(context).apply {
                background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xFF07080C.toInt(), 0xEB07080C.toInt(), 0x5907080C, 0x2607080C))
            }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            root.addView(View(context).apply {
                background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(0xD907080C.toInt(), 0x0007080C))
            }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, context.dp(170), Gravity.BOTTOM))

            // الأعلى: نوع الغرفة والاتصال · اطلع من الغرفة
            val top = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(context.dp(22), context.dp(14), context.dp(22), 0)
            }
            top.addView(chip("${launch.kindText ?: "مشاهدة"} · مشاهدة معًا · متزامنة"), LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, context.dp(30)))
            val conn = chip("متصل")
            lobbyConn = conn
            top.addView(conn, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, context.dp(30)).apply { marginStart = context.dp(8) })
            top.addView(View(context), LinearLayout.LayoutParams(0, 1, 1f))
            top.addView(button("اطلع من الغرفة", primary = false) { hooks.leaveRoom() }.apply { setPadding(context.dp(16), context.dp(8), context.dp(16), context.dp(8)); textSize = 13f })
            root.addView(top, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))

            // المحتوى: البطل (يمين) + البطاقة (يسار)
            val main = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.BOTTOM
                setPadding(context.dp(28), context.dp(58), context.dp(28), context.dp(14))
            }
            val hero = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.BOTTOM or Gravity.START }
            val title = context.label(launch.title ?: "مشاهدة معًا", 26f, Color.WHITE, bold = true).apply {
                maxLines = 3
                setShadowLayer(context.dp(12).toFloat(), 0f, context.dp(3).toFloat(), 0x99000000.toInt())
                textDirection = View.TEXT_DIRECTION_ANY_RTL
            }
            hero.addView(title)
            // الشعار إن وُجد يحلّ محل الاسم؛ وإلا يبقى الاسم الطبيعي
            launch.logo?.let { url ->
                val logo = ImageView(context).apply { scaleType = ImageView.ScaleType.FIT_START; adjustViewBounds = true; contentDescription = launch.title }
                images.load(url, context.dp(360)) { bmp ->
                    if (bmp == null || bmp.width <= 1) return@load
                    logo.setImageBitmap(bmp)
                    val i = hero.indexOfChild(title)
                    if (i >= 0) { hero.removeViewAt(i); hero.addView(logo, i, LinearLayout.LayoutParams(context.dp(300), context.dp(110))) }
                }
            }
            val ep = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, context.dp(12), 0, 0) }
            ep.addView(context.label(episodeText(), 16f, Tone.ACCENT_TEXT, bold = true))
            launch.episodeTitle?.let { ep.addView(context.label(it, 14.5f, 0xC8FFFFFF.toInt()).apply { setPadding(context.dp(10), 0, 0, 0); maxLines = 1; textDirection = View.TEXT_DIRECTION_FIRST_STRONG }) }
            hero.addView(ep)
            main.addView(hero, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = context.dp(24); bottomMargin = context.dp(4) })

            val side = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.BOTTOM
            }
            lobbySide = side
            val scroll = ScrollView(context).apply { isVerticalScrollBarEnabled = false; isFillViewport = false; addView(side) }
            main.addView(scroll, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.1f))
            root.addView(main, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

            lobby = root
            hooks.overlayHost().addView(root, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            root.alpha = 0f
            root.animate().alpha(1f).setDuration(220).start()
        }
        paintLobby()
        paintStrip()
    }

    private fun episodeText(): String {
        val n = hooks.episode()
        if (launch.kindText == "فيلم") return "فيلم"
        return launch.season?.let { "م$it · الحلقة $n" } ?: "الحلقة $n"
    }

    private fun hideLobby() {
        lobby?.let { (it.parent as? ViewGroup)?.removeView(it) }
        lobby = null
        lobbySide = null
        lobbyConn = null
        paintStrip()
    }

    private fun paintLobby() {
        val side = lobbySide ?: return
        side.removeAllViews()
        lobbyConn?.text = if (connected) "●  متصل" else "●  جاري الاتصال…"
        lobbyConn?.setTextColor(if (connected) 0xFF6FE3A1.toInt() else 0xFFF5C76A.toInt())
        // الأشخاص بصورهم وحلقة الحالة، والمدعوون «بانتظاره…»
        val people = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.START }
        fun person(userId: String, name: String, avatarKey: String?, state: String, host: Boolean) {
            val col = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(context.dp(6), 0, context.dp(6), 0) }
            val box = FrameLayout(context)
            box.addView(face(userId, name, avatarKey, state, 54, ring = true), FrameLayout.LayoutParams(context.dp(54), context.dp(54), Gravity.CENTER))
            if (host) box.addView(context.label("المضيف", 9.5f, Color.WHITE, bold = true).apply {
                setPadding(context.dp(6), 0, context.dp(6), context.dp(1))
                background = rounded(Tone.ACCENT, context.dp(8).toFloat(), context.dp(2), 0xFF10121A.toInt())
            }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.CENTER_HORIZONTAL))
            col.addView(box, LinearLayout.LayoutParams(context.dp(62), context.dp(62)))
            col.addView(context.label(name, 12.5f, Color.WHITE, bold = true).apply { gravity = Gravity.CENTER; maxLines = 1 })
            col.addView(context.label(stateLabel(state), 11f, stateTextColor(state), bold = true).apply { gravity = Gravity.CENTER })
            people.addView(col, LinearLayout.LayoutParams(context.dp(70), ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        for (m in client.roster.sortedWith(compareByDescending<Member> { it.host }.thenBy { it.joinedAt })) person(m.userId, if (m.userId == client.me) "أنت" else m.name, m.avatarKey, m.state, m.host)
        for (p in pending()) person(p.userId, p.displayName, p.avatarKey, "pending", false)
        side.addView(android.widget.HorizontalScrollView(context).apply { isHorizontalScrollBarEnabled = false; addView(people) })

        val (line, bad) = headline()
        side.addView(context.label(line, 14f, if (bad) 0xFFFF8B8E.toInt() else Color.WHITE, bold = true).apply { setPadding(context.dp(4), context.dp(10), context.dp(4), context.dp(10)) })

        // سيرفرك: حالته وزر «غيّر»
        val server = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(context.dp(12), context.dp(6), context.dp(12), context.dp(6))
            background = rounded(0x0DFFFFFF, context.dp(16).toFloat())
        }
        val sText = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        sText.addView(context.label("سيرفرك", 11.5f, Tone.TEXT_3, bold = true))
        sText.addView(context.label(hooks.serverLabel() ?: "—", 14f, Color.WHITE, bold = true).apply { maxLines = 1; textDirection = View.TEXT_DIRECTION_LTR })
        server.addView(sText, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val (stText, stColor) = when {
            failedSource != null -> "تعذّر" to 0xFFFF8B8E.toInt()
            ready -> "جاهز · عند البداية" to 0xFF6FE3A1.toInt()
            else -> "يتجهّز…" to 0xFFF5C76A.toInt()
        }
        server.addView(context.label("●  $stText", 12f, stColor, bold = true).apply { setPadding(context.dp(8), 0, context.dp(8), 0) })
        server.addView(button("غيّر", primary = false) { hooks.openServers() }.apply { setPadding(context.dp(13), context.dp(6), context.dp(13), context.dp(6)); textSize = 12.5f })
        side.addView(server, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        side.addView(offsetRow(), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = context.dp(6) })

        // الأفعال
        // أيقونة التشغيل مرسومة (Glyph) لا رمز نصي: الجوال يعرض «▶» إيموجي
        val action = if (client.isHost) LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            background = rounded(Tone.ACCENT, context.dp(22).toFloat())
            alpha = if (ready) 1f else 0.5f
            contentDescription = "ابدأ للجميع"
            addView(ImageView(context).apply { setImageDrawable(Glyph(Glyph.Kind.PLAY, Color.WHITE)) }, LinearLayout.LayoutParams(context.dp(20), context.dp(20)).apply { marginEnd = context.dp(8) })
            addView(context.label("ابدأ للجميع", 15.5f, Color.WHITE, bold = true))
            setOnClickListener { if (ready) client.command("play", 0.0) else hooks.message("نجهّز فيديوك…") }
        } else context.label("●  بانتظار المضيف يبدأ", 14.5f, 0xD9FFFFFF.toInt(), bold = true).apply {
            gravity = Gravity.CENTER
            setPadding(0, context.dp(13), 0, context.dp(13))
            background = rounded(0x12FFFFFF, context.dp(24).toFloat(), context.dp(1), 0x1AFFFFFF)
        }
        side.addView(action, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, context.dp(48)).apply { topMargin = context.dp(12) })
    }

    companion object {
        /** نفس ذاكرة الخلف في المشغّل (40 ث): القفز للخلف داخلها رخيص. */
        const val BACK_BUFFER_MS = 40_000L
        /** حد ديلاي الفيديو الشخصي: دقيقتان. */
        const val OFFSET_LIMIT_MS = 120_000L
    }
}
