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
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
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
    /** صورة الحلقة لزر «البدء» (الخلفية فن العمل نفسه — تصميم الغرفة المعتمد 14 نوفمبر). */
    val episodeImage: String? = null,
    /** تقييم الحلقة («8.7») ومدتها («43 دقيقة») تحت اسمها في الغرفة؛ كلاهما اختياري. */
    val rating: String? = null,
    /** مصدر التقييم: «IMDb» للأفلام والمسلسلات؛ بلا مصدر لا يُعرض تقييم الأنمي المخمَّن. */
    val ratingSource: String? = null,
    val duration: String? = null,
    val invitees: List<Invitee> = emptyList(),
    /** الغرفة أولًا: دخل بلا سيرفر، فالغرفة تعرض «اختر سيرفر» حتى يختار (لا اختيار تلقائي). */
    val pick: Boolean = false,
)

@Serializable
data class Invitee(val userId: String, val displayName: String = "صديق", val avatarKey: String? = null)

/** A live profile photo wins; otherwise retain the matching invitee photo supplied by the app. */
internal fun roomAvatarKey(userId: String, avatarKey: String?, invitees: List<Invitee>): String? =
    avatarKey?.takeIf { it.isNotBlank() } ?: invitees.firstOrNull { it.userId == userId }?.avatarKey

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
        /** ورقة الحلقات في المشغّل (زر «الحلقات» في الغرفة للمضيف). */
        fun openEpisodes() {}
        fun hasEpisodes(): Boolean = false
        /** «OKRU · 1080p» للسيرفر الحالي. */
        fun serverLabel(): String? = sourceName()
        /** هوية السيرفر الحالي الثابتة بين الأجهزة («معرّف المصدر|رمز السيرفر»، بصيغة الويب وويندوز)، أو null. */
        fun serverKey(): String? = null
        /** السيرفرات الجاهزة عندك لهذه الحلقة: (الهوية، معرّف المرشح، الاسم). */
        fun readyServers(): List<Triple<String, String, String>> = emptyList()
        /** شغّل هذا المرشح من الموضع نفسه («نعم» على اقتراح سيرفر المضيف). */
        fun useServer(candidateId: String) {}
        /** تقدّم تجهيز فيديوك الحقيقي 0..1 (مراحل المصدر والتورنت والمشغّل) لامتلاء الشعار ومراحل الغرفة. */
        fun loadProgress(): Float = 0f
        /** المضيف نقل الغرفة لعمل آخر (موسم ثانٍ): يُغلق المشغّل وتفتح الواجهة غرفة الموسم الجديد للاختيار. */
        fun switchWork(key: String, label: String?) {}
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
    private var lobbyBar: LinearLayout? = null
    private var lobbyConn: TextView? = null
    private var lobbyMore: View? = null
    /** إشعار اقتراح سيرفر المضيف (ثابت حتى يرد العضو). */
    private var lobbySuggest: View? = null
    /** بطاقة «البدء» الكبيرة فوق الشريط (المضيف وحده): صورة الحلقة ودائرة تشغيل. */
    private var lobbyStart: FrameLayout? = null
    private var lobbyCount: TextView? = null
    private var countdownAt = 0.0
    private var markFill: View? = null
    private var markRtl = false
    private var stepBars: List<View> = emptyList()
    private var stepText: TextView? = null
    private var progressShown = 0f
    private var lobbySig = ""
    /** «الحلقة N» وعنوانها في شاشة الغرفة: يتحدّثان حين ينقل المضيف الغرفة لحلقة أخرى. */
    private var lobbyEpisode: TextView? = null
    private var lobbyEpisodeTitle: TextView? = null
    /** الحلقة التي فُتح عليها المشغّل: عنوانها من الدعوة لا يُكتب على حلقة أخرى. */
    private var initialEpisode = -1
    /** «أخرج» يحتاج ضغطة تأكيد ثانية خلال 4 ث. */
    private var confirmKick: String? = null
    /** الغرفة أولًا: لم يختر سيرفره بعد. تبقى الغرفة ظاهرة (حتى لو بدأت) لأنه لا فيديو يُشاهد بلا سيرفر. */
    private var awaitingPick = launch.pick
    /** لون القسم: أحمر السينما، ولون الأنمي للأنمي. */
    // لون الواجهة نفسه الذي لبسه المشغّل (Tone.use)، لا أزرق/أحمر ثابت
    private val accent: Int get() = com.vantara.anime.player.Tone.ACCENT
    private fun serverNow() = client.clock.serverNow(SystemClock.elapsedRealtime().toDouble())
    private var intentSeq = -1
    private var intentUntil = 0L
    private fun holdIntent(t: Timeline) { intentSeq = t.seq; intentUntil = SystemClock.elapsedRealtime() + 2000 }
    /** الغرفة بدأت لكن لحظة البدء المشتركة لم تأتِ: العدّ 3-2-1. */
    private fun counting(t: Timeline? = client.timeline) = synced && t != null && t.started && t.at - serverNow() > 400
    private var strip: LinearLayout? = null
    private var panelOpen = false
    /** لوحة الغرفة تُبنى من جديد فقط حين يتغير ما فيها؛ الوقت والفرق يتحدثان في مكانهما، فلا تضيع لمسة (TG2). */
    private var panelSig: String? = null
    private val panelLive = HashMap<String, Pair<TextView, TextView>>()
    /** التطبيق في الخلفية: الغرفة لا تشغّل فيديوك حتى ترجع (TG15). */
    private var foreground = true
    /** «اشتغل الفيديو عند X» مرة لكل شخص في كل حلقة، لا مع كل استئناف (WT1). */
    private val announcedPlaying = HashSet<String>()
    /** «طلع» بعد مهلة سماح: انقطاع لحظي ثم رجوع لا يُعلن (WT8). */
    private val pendingLeft = HashMap<String, Runnable>()
    private val leftGraceMs = 8_000L
    private var quiet = false
    private var connected = false
    private val images = TogetherImages(context, http)
    private val prefs = context.getSharedPreferences("together_offsets", Context.MODE_PRIVATE)

    private val synced get() = client.mode == "sync"
    private fun mediaKey(ep: Int = hooks.episode()) = "${launch.mediaPrefix}#$ep"
    private fun episodeOf(key: String?) = key?.substringAfterLast('#', "")?.toIntOrNull()
    /** حلقة الغرفة الآن (قد تسبق حلقة المشغّل أثناء تجهيز ما اختاره المضيف). */
    private fun roomEpisode() = client.timeline?.mediaKey?.takeIf { it.startsWith("${launch.mediaPrefix}#") }?.let { episodeOf(it) } ?: hooks.episode()
    /** خط الغرفة الزمني يخص الحلقة المعروضة عندي؟ لا = لا يُطبَّق أبدًا (لا تشغيل الحلقة 2 على وقت الحلقة 1). */
    private fun sameEpisode(t: Timeline?) = t != null && episodeOf(t.mediaKey) == hooks.episode()

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
        if (panelOpen) refreshPanelIfChanged()
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
        initialEpisode = hooks.episode()
        client.connect()
        main.post(tick)
        // غرفة متزامنة: شاشة الغرفة من أول لحظة (الأصدقاء، سيرفرك وزر «غيّر»)، لا شاشة سوداء
        // تنتظر الإطار الأول. إن كانت الغرفة بدأت فعلًا يخفيها الترحيب ويقفز للثانية الحالية.
        if (launch.mode == "sync" || awaitingPick) showLobby()
    }

    fun destroy() {
        main.removeCallbacksAndMessages(null)
        pendingLeft.clear()
        report("paused", force = true)
        client.close()
        mute(false)
        images.close()
        lobby?.let { (it.parent as? ViewGroup)?.removeView(it) }
    }

    /** «اطلع من الغرفة»: تخرج من الغرفة ويبقى الفيديو عندك من نفس اللحظة (قرار المالك، 19 نوفمبر). */
    fun leave() {
        destroy()
        lobby = null
        strip?.let { (it.parent as? ViewGroup)?.removeView(it) }
        strip = null
        hooks.player.setPlaybackSpeed(1f)
    }

    /** الخلفية توقف فيديوك وحدك، والغرفة لا تعيد تشغيله حتى ترجع (TG15). */
    fun onBackground() { foreground = false }
    fun onForeground() { foreground = true; report(stateNow(), force = true) }

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
        awaitingPick = false
        progressShown = 0f
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
            // الغرفة على حلقة غير حلقتي (انتقال لم يكتمل) = انتظار أيضًا: لا نشغّل على وقت حلقة أخرى
            if (synced && (t?.started != true || !sameEpisode(t))) {
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
        // المنفصلة: كل واحد بوقته، وبطاقة «الحلقة التالية» العادية
        if (!synced) return false
        if (!client.isHost) {
            hooks.message("بانتظار المضيف للحلقة التالية…")
            return true
        }
        if (!hooks.hasNextEpisode()) return false
        val next = hooks.episode() + 1
        if (!client.command("load", 0.0, mediaKey(next), "الحلقة $next")) { hooks.message("انتظر عودة الاتصال بالغرفة"); return true }
        hooks.switchToEpisode(next)
        return true
    }

    /** هل يبدأ الفيديو وحده عند تحميل سيرفر؟ في غرفة متزامنة لم تبدأ: لا، ينتظر «ابدأ» (onReady يقف عند البداية). */
    fun mayAutoplay(): Boolean = !synced || client.timeline?.started == true

    /** المستخدم ضغط تشغيل/إيقاف. المضيف يأمر الغرفة؛ غيره في المتزامن لا يحرّكها. */
    fun onUserPlayPause(playing: Boolean): Boolean {
        if (applying) return false
        val t = client.timeline ?: return false
        if (!synced) return false
        if (client.canControl) {
            if (!t.started && playing) {
                // من غرفة الانتظار: «ابدأ» بعدّ 3-2-1 مشترك، ولا يشتغل عندي قبل الجميع
                if (ready) client.command("play", 0.0, countdownMs = 3000L) else hooks.message("نجهّز فيديوك…")
                withApplying { hooks.player.playWhenReady = false }
                return true
            }
            client.command(if (playing) "play" else "pause", roomPos(), at = serverNow()); holdIntent(t)
            return false
        }
        hooks.message("المضيف يتحكم بالتشغيل")
        withApplying { hooks.player.playWhenReady = t.playing }
        return true
    }

    /** المستخدم قدّم/رجّع. */
    fun onUserSeek(toMs: Long) {
        if (applying || !synced) return
        if (client.canControl) { client.timeline?.let { holdIntent(it) }; client.command("seek", roomPos(toMs), at = serverNow()) }
        else hooks.message("المضيف يتحكم بالتشغيل — نرجّعك معهم")
    }

    // ───────────── أحداث الغرفة ─────────────

    override fun onWelcome() {
        lastMode = client.mode
        // A fast local source can become ready before the WebSocket welcome.
        // Reconcile that first frame with the room instead of playing behind the lobby.
        val t = client.timeline
        // دخول متأخر (الغرفة بدأت) أو غرفة منفصلة: لا شاشة انتظار
        if (awaitingPick) showLobby()
        else if (counting(t)) startCountdown(t!!.at) else if (!synced || t?.started == true) hideLobby() else showLobby()
        if (synced && ready && t != null) {
            if (!t.started || !sameEpisode(t)) withApplying { hooks.player.playWhenReady = false; if (!t.started) hooks.player.seekTo(max(0L, offsetMs)) }
            else jumpToRoom(t)
        }
        paintStrip()
        report(stateNow(), force = true)
    }

    override fun onState(timeline: Timeline, by: String?) {
        // عمل آخر (موسم ثانٍ مثلًا): لا يُقارن رقم الحلقة وحده، وإلا شغّل «الحلقة 1» من الموسم القديم
        val prefix = timeline.mediaKey?.substringBeforeLast('#', "")?.takeIf { it.isNotEmpty() }
        if (prefix != null && prefix != launch.mediaPrefix) {
            if (synced || by == client.hostUserId) { ready = false; hooks.switchWork(timeline.mediaKey!!, timeline.mediaLabel) }
            return
        }
        val ep = episodeOf(timeline.mediaKey)
        // الحلقة التالية (أو أي حلقة اختارها المضيف): كل واحد يجهّزها بسيرفره
        if (ep != null && ep != hooks.episode()) {
            if (synced || by == client.hostUserId) { ready = false; hooks.switchToEpisode(ep) }
            return
        }
        if (awaitingPick) showLobby()
        else if (counting(timeline)) { mute(false); startCountdown(timeline.at) }
        else if (timeline.started) { hideLobby(); mute(false) } else if (synced && ready) showLobby()
        if (synced && timeline.started && ready && by != client.me) jumpToRoom(timeline)
        paintLobby()
    }

    override fun onRoster(members: List<Member>) { paintStrip(); paintLobby(); if (panelOpen) refreshPanelIfChanged() }
    /** «room» يصل مع كل تغيير في الغرفة (المضيف، التحكم)؛ الوضع يُعلن ويُطبّق حين يتغير فعلًا فقط. */
    private var lastMode: String = launch.mode
    override fun onMode(mode: String) {
        if (mode == lastMode) return
        lastMode = mode
        hooks.message(if (mode == "sync") "صارت المشاهدة متزامنة" else "صارت المشاهدة منفصلة: كل واحد بوقته")
        if (mode != "sync") { if (!awaitingPick) hideLobby(); withApplying { hooks.player.setPlaybackSpeed(1f) }; return }
        // TG10/TG11: التحويل لمتزامنة يعيد خط الغرفة القديم (حالته وحلقته)، فيشتغل الفيديو والمضيف موقِف أو يرجع الكل
        // لحلقة قديمة. المضيف يعلن حلقته وحالته لحظة التحويل، فيتبعه الجميع.
        if (client.isHost && ready && connected) {
            if (episodeOf(client.timeline?.mediaKey) != hooks.episode()) client.command("load", 0.0, mediaKey(), "الحلقة ${hooks.episode()}")
            else {
                client.command(if (hooks.player.playWhenReady) "play" else "pause", roomPos(), at = serverNow())
                client.timeline?.let { holdIntent(it) }
            }
        }
    }
    override fun onStatus(userId: String, name: String, state: String, source: String?) {
        if (userId == client.me) return
        when (state) {
            "playing" -> if (announcedPlaying.add("$userId|${client.timeline?.mediaKey}")) hooks.message("اشتغل الفيديو عند $name")
            "failed" -> hooks.message("تعذّر تشغيل السيرفر عند $name${source?.let { " ($it)" } ?: ""}")
            "ready" -> if (client.timeline?.started == false) hooks.message("$name جاهز")
        }
    }
    override fun onConnection(live: Boolean) { connected = live; paintLobby() }
    override fun onJoined(name: String) {
        // رجع خلال مهلة السماح (تبدّل شبكة مثلًا): لا «طلع» ولا «دخل»
        val pending = pendingLeft.remove(name)
        if (pending != null) { main.removeCallbacks(pending); return }
        hooks.message("$name دخل")
    }
    override fun onLeft(name: String, kicked: Boolean) {
        if (kicked) { hooks.message("المضيف أخرج $name"); return }
        pendingLeft.remove(name)?.let { main.removeCallbacks(it) }
        val announce = Runnable { pendingLeft.remove(name); hooks.message("$name طلع") }
        pendingLeft[name] = announce
        main.postDelayed(announce, leftGraceMs)
    }
    /**
     * «البدء»: الحالة تُقرأ لحظة اللمس لا لحظة رسم الزر، وكل نتيجة لها أثر: عدّ 3-2-1 عند الجميع، أو رسالة بالسبب.
     */
    private var startSentAt = 0L
    private val startWatch = Runnable {
        if (startSentAt != 0L && client.timeline?.started != true && lobbyCount == null) hooks.message(TogetherStart.NO_REPLY)
        startSentAt = 0L
    }
    private fun guestsWaiting() = TogetherStart.notReady(client.roster, client.me, client.timeline?.mediaKey)
    private fun pressStart() {
        val waiting = guestsWaiting()
        val gate = TogetherStart.gate(ready, connected, awaitingPick, waiting.size)
        if (gate == TogetherStart.Gate.GUESTS) { hooks.message(TogetherStart.waitingText(waiting.map { it.name })); paintLobby(); return }
        if (gate != TogetherStart.Gate.SEND) { hooks.message(TogetherStart.message(gate)!!); paintLobby(); return }
        if (!client.command("play", 0.0, countdownMs = TogetherStart.COUNTDOWN_MS)) { hooks.message(TogetherStart.SEND_FAILED); return }
        startSentAt = android.os.SystemClock.uptimeMillis()
        main.removeCallbacks(startWatch)
        main.postDelayed(startWatch, TogetherStart.REPLY_TIMEOUT_MS)
    }

    override fun onDenied(reason: String?, waiting: List<String>) {
        startSentAt = 0L
        main.removeCallbacks(startWatch)
        hooks.message(if (reason == "not_ready") TogetherStart.waitingText(waiting) else TogetherStart.DENIED)
        paintLobby()
    }

    override fun onHost(userId: String) { if (userId == client.me) hooks.message("صرت المضيف"); paintLobby() }
    override fun onClosed(reason: String) {
        hooks.message(when (reason) { "full" -> "الغرفة ممتلئة"; "gone" -> "انتهت الغرفة"; "uninvited" -> "هالغرفة لأشخاص محددين"; "replaced" -> "دخلت الغرفة من جهاز ثاني"; "kicked" -> "المضيف أخرجك من الغرفة"; else -> "انقطعت الغرفة" })
        hideLobby()
        mute(false)
        strip?.visibility = View.GONE
        withApplying { hooks.player.setPlaybackSpeed(1f) }
    }

    // ───────────── المزامنة ─────────────

    private fun paintProgress() {
        val p = when { ready -> 1f; awaitingPick || failedSource != null -> 0f; else -> hooks.loadProgress().coerceIn(0f, 0.97f) }
        progressShown = max(progressShown, p) // لا ينقص داخل نفس الحلقة
        markFill?.let { f ->
            if (f.width > 0) {
                val w = (f.width * progressShown).toInt()
                f.clipBounds = if (markRtl) android.graphics.Rect(f.width - w, 0, f.width, f.height) else android.graphics.Rect(0, 0, w, f.height)
            }
        }
        val done = when { awaitingPick || failedSource != null -> 0; ready -> STEPS.size; else -> STEPS.count { it < 1f && progressShown >= it } }
        stepBars.forEachIndexed { i, v ->
            v.background = rounded(when { i < done -> 0xCCFFFFFF.toInt(); i == done && !awaitingPick && failedSource == null -> accent; else -> 0x29FFFFFF }, context.dp(2).toFloat())
        }
        stepText?.text = when { awaitingPick -> "بانتظار سيرفرك"; failedSource != null -> "تعذّر سيرفرك"; ready -> "جاهز للبدء"; else -> STEP_NAMES[min(done, STEP_NAMES.size - 1)] + "…" }
    }

    private val tick = object : Runnable {
        override fun run() {
            if (lobby != null) paintProgress()
            step()
            main.postDelayed(this, 500)
        }
    }

    private fun step() {
        val p = hooks.player
        val t = client.timeline
        val at = client.clock.serverNow(SystemClock.elapsedRealtime().toDouble())
        // أمر المتحكّم نفسه (إيقاف/تشغيل/تقديم) نُفّذ عنده فورًا: حتى يصل صداه (seq أكبر) لا يُرجعه المؤقت للحالة
        // القديمة. كان الإيقاف من الجوال يعود تشغيلًا لحظة قبل وصول البث (بلاغ المالك 14 نوفمبر).
        val pendingOwn = t != null && intentSeq == t.seq && SystemClock.elapsedRealtime() < intentUntil
        if (t != null && foreground && !pendingOwn && synced && t.started && ready && client.clock.ready && at >= t.at && episodeOf(t.mediaKey) == hooks.episode()) {
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
        if (panelOpen) refreshPanelIfChanged()
    }

    private fun jumpToRoom(t: Timeline, force: Boolean = false) {
        if (!sameEpisode(t)) return
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
            hooks.player.playWhenReady = t.playing && foreground
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
            server = if (failedSource != null) null else hooks.serverKey(),
        )
    }

    /** سيرفرات المضيف التي رفضها العضو («لا»): لا يُعاد اقتراحها في هذه الغرفة. */
    private val declinedServers = mutableSetOf<String>()

    /**
     * اقتراح سيرفر المضيف في اللوبي (قرار المالك، 19 نوفمبر): متوفر عندك جاهزًا وأنت على غيره ⇒ إشعار ثابت «نعم/لا» لا
     * يختفي حتى ترد. «نعم» يجعله سيرفرك، و«لا» يبقيك على اختيارك. لا يُفرض. نفس قاعدة الويب (hostServerSuggestion).
     */
    private fun hostSuggestion(): Triple<String, String, String>? {
        if (client.isHost || awaitingPick) return null
        val host = client.roster.firstOrNull { it.host } ?: return null
        val key = host.server ?: return null
        if (key == hooks.serverKey() || key in declinedServers) return null
        val match = hooks.readyServers().firstOrNull { it.first == key } ?: return null
        return Triple(key, match.second, host.source ?: match.third)
    }

    private fun paintSuggestion(root: FrameLayout, portrait: Boolean) {
        lobbySuggest?.let { root.removeView(it) }
        lobbySuggest = null
        val pick = hostSuggestion() ?: return
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(context.dp(16), context.dp(14), context.dp(16), context.dp(14))
            background = rounded(0xFF121218.toInt(), context.dp(14).toFloat(), context.dp(1), 0x40FFFFFF)
            elevation = context.dp(8).toFloat()
        }
        card.addView(context.label("المضيف يشاهد على ${pick.third}، وهو متوفر عندك. تبي نفس السيرفر؟", 14f, Color.WHITE, bold = false))
        val acts = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val yes = context.label("نعم", 14f, com.vantara.anime.player.Tone.ON_ACCENT, bold = true).apply {
            gravity = Gravity.CENTER
            background = rounded(accent, context.dp(12).toFloat())
            contentDescription = "نعم، استخدم سيرفر المضيف"
            setOnClickListener { declinedServers.add(pick.first); lobbySig = ""; hooks.useServer(pick.second); paintLobby() }
        }
        val no = context.label("لا", 14f, Color.WHITE, bold = true).apply {
            gravity = Gravity.CENTER
            background = rounded(0x8C0A0C14.toInt(), context.dp(12).toFloat(), context.dp(1), 0x29FFFFFF)
            contentDescription = "لا، أبقَ على سيرفري"
            setOnClickListener { declinedServers.add(pick.first); lobbySig = ""; paintLobby() }
        }
        acts.addView(yes, LinearLayout.LayoutParams(0, context.dp(44), 1f).apply { marginEnd = context.dp(8) })
        acts.addView(no, LinearLayout.LayoutParams(0, context.dp(44), 1f))
        card.addView(acts, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = context.dp(12) })
        lobbySuggest = card
        root.addView(card, FrameLayout.LayoutParams(if (portrait) ViewGroup.LayoutParams.MATCH_PARENT else context.dp(400), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.START).apply {
            marginStart = context.dp(16); marginEnd = context.dp(16); bottomMargin = context.dp(if (portrait) 168 else 84)
        })
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
            images.load(roomAvatarKey(userId, avatarKey, launch.invitees), context.dp(size) * 2) { bmp ->
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

    /** جملة الحالة الواحدة في الشريط — نفس كلمات الويب (together-lobby.js lobbyHeadline). */
    private fun headline(): Pair<String, Boolean> {
        fun names(list: List<String>) = list.take(2).joinToString(" و") + if (list.size > 2) " و${list.size - 2} غيرهم" else ""
        if (!connected) return "جاري الاتصال بالغرفة…" to false
        if (awaitingPick) return "اختر سيرفرك عشان نبدأ" to false
        if (failedSource != null) return "تعذّر سيرفرك · اختر سيرفرًا آخر" to true
        if (!ready) return "نجهّز فيديوك…" to false
        val others = client.roster.filter { it.userId != client.me }
        val waiting = pending().map { it.displayName }
        val broken = others.filter { it.state == "failed" }.map { it.name }
        // غير الجاهزين على حلقة الغرفة (يجهّز، أو تقريره من حلقة سابقة)؛ المتعذّر له سطره
        val preparing = TogetherStart.notReady(others, client.me, client.timeline?.mediaKey).filter { it.state != "failed" }.map { it.name }
        return when {
            waiting.isNotEmpty() -> "${names(waiting)} ${if (waiting.size > 1) "ما دخلوا" else "ما دخل"} بعد" to false
            broken.isNotEmpty() -> "سيرفر ${names(broken)} تعذّر" to false
            preparing.isNotEmpty() -> "${names(preparing)} ${if (preparing.size > 1) "يجهّزون" else "يجهّز"}…" to false
            others.isEmpty() -> (if (client.isHost) "فيديوك جاهز · ابدأ متى ما تبي" else "فيديوك جاهز · بانتظار المضيف") to false
            client.isHost -> "الكل جاهز" to false
            else -> "الكل جاهز · بانتظار المضيف" to false
        }
    }

    private fun openPanel() {
        panelOpen = true
        hooks.openPanel(if (synced) "مشاهدة معًا · متزامنة" else "مشاهدة معًا · منفصلة") { body ->
            panelLive.clear()
            panelSig = panelSignature()
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
                val posLabel = context.label(clock(memberPos(m, now)), 14f, Tone.TEXT, bold = true)
                where.addView(posLabel)
                val tagText = memberTags(m)
                val tagsLabel = context.label(tagText, 11f, Tone.TEXT_3).apply { visibility = if (tagText.isEmpty()) View.GONE else View.VISIBLE }
                where.addView(tagsLabel)
                panelLive[m.userId] = posLabel to tagsLabel
                row.addView(where)
                val tools = client.isHost && m.userId != client.me
                body.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = context.dp(if (tools) 2 else 6) })
                // المضيف: «اجعله المضيف» و«أخرج» (بضغطتين حتى لا يقع خطأً)
                if (tools) body.addView(hostTools(m), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = context.dp(8) })
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
            body.addView(button("اطلع من الغرفة", primary = false) { client.bye(); hooks.leaveRoom() }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = context.dp(8) })
        }
    }

    fun panelClosed() { panelOpen = false; confirmKick = null; panelSig = null; panelLive.clear() }

    private fun memberPos(m: Member, now: Double): Double? =
        if (m.state == "playing" && m.pos != null && m.at != null) m.pos + max(0.0, now - m.at) else m.pos

    private fun memberTags(m: Member): String = listOfNotNull(
        if (m.host) "المضيف" else null,
        if (m.sameVersion == false) "نسخة مختلفة" else null,
        if (synced && !m.host && m.driftMs != null) "فرق ${abs(m.driftMs)}ms" else null,
    ).joinToString(" · ")

    /** ما يُرسم في اللوحة عدا الوقت والفرق (يتحدثان في مكانهما). تغيّره وحده يعيد بناء اللوحة. */
    private fun panelSignature(): String = buildString {
        append(synced).append('|').append(client.isHost).append('|').append(confirmKick).append('|').append(offsetMs)
        for (m in client.roster.sortedBy { it.joinedAt }) {
            append('|').append(m.userId).append(',').append(m.name).append(',').append(m.state).append(',').append(m.source)
                .append(',').append(m.host).append(',').append(m.sameVersion).append(',').append(m.avatarKey)
        }
        for (p in pending()) append("|p:").append(p.userId)
    }

    private fun refreshPanelIfChanged() {
        if (!panelOpen) return
        if (panelSignature() != panelSig) { hooks.refreshPanel(); return }
        val now = client.clock.serverNow(SystemClock.elapsedRealtime().toDouble())
        for (m in client.roster) {
            val labels = panelLive[m.userId] ?: continue
            labels.first.text = clock(memberPos(m, now))
            val text = memberTags(m)
            if (labels.second.text.toString() != text) labels.second.text = text
            labels.second.visibility = if (text.isEmpty()) View.GONE else View.VISIBLE
        }
    }

    private fun hostTools(m: Member): View = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL or Gravity.END
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        setPadding(context.dp(10), 0, context.dp(10), 0)
        addView(View(context), LinearLayout.LayoutParams(0, 1, 1f))
        fun pill(text: String, fg: Int, bg: Int, stroke: Int, desc: String, onClick: () -> Unit) = context.label(text, 12.5f, fg, bold = true).apply {
            gravity = Gravity.CENTER
            setPadding(context.dp(12), context.dp(7), context.dp(12), context.dp(7))
            background = rounded(bg, context.dp(16).toFloat(), context.dp(1), stroke)
            contentDescription = desc
            setOnClickListener { onClick() }
        }
        addView(pill("اجعله المضيف", 0xD9FFFFFF.toInt(), 0x0AFFFFFF, 0x2EFFFFFF, "اجعل ${m.name} المضيف") { client.giveHost(m.userId) })
        val armed = confirmKick == m.userId
        addView(pill(if (armed) "تأكيد الإخراج" else "أخرج", if (armed) Color.WHITE else 0xFFFF8B8E.toInt(), if (armed) 0xFFE5484D.toInt() else 0x00000000, if (armed) 0xFFE5484D.toInt() else 0x59FF6B6E, "أخرج ${m.name} من الغرفة") {
            if (confirmKick != m.userId) {
                val id = m.userId
                confirmKick = id
                main.postDelayed({ if (confirmKick == id) { confirmKick = null; refreshPanelIfChanged() } }, 4000)
            } else { confirmKick = null; client.kick(m.userId) }
            refreshPanelIfChanged()
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = context.dp(8) })
    }

    // «اختر سيرفر» عند كل حلقة (قرار 15 نوفمبر) أُلغي بقرار المالك في 19 نوفمبر: الحلقة التالية من العمل نفسه تُجهَّز
    // مسبقًا لكل عضو بسيرفره وجودته وتكمل (PlayerActivity.switchEpisode). تغيير الموسم وحده يعيد اللوبي (handOff).

    /**
     * المضيف نقل الغرفة لموسم آخر: الواجهة تجهّز مشغّل الموسم الجديد تحت هذا المشغّل، وهذا يبقى ظاهرًا بشاشة الغرفة
     * حتى يأخذ الجديد مكانه. يُغلق اتصاله الآن (الجديد يدخل الغرفة بالحساب نفسه).
     */
    fun handOff(label: String?) {
        main.removeCallbacksAndMessages(null)
        client.close()
        awaitingPick = true
        ready = false
        showLobby()
        paintLobby()
        hooks.message(listOfNotNull("ننقل الغرفة", label?.takeIf { it.isNotBlank() }).joinToString(" · ") + "…")
    }

    /** اختيار حلقة من ورقة المشغّل داخل غرفة متزامنة: المضيف ينقل الغرفة كلها، والصديق يُبلَّغ. منفصلة: تبديل محلي. */
    /** الموسم من ورقة الحلقات: المضيف ينقل الغرفة كلها لأول حلقة في الموسم (`anime:<id>#1`)؛ الصديق يُبلَّغ. */
    fun requestWork(prefix: String, label: String): Boolean {
        if (!synced) return false
        if (!client.isHost) { hooks.message("المضيف يختار الموسم"); return true }
        if (prefix == launch.mediaPrefix) return true
        client.command("load", 0.0, "$prefix#1", label)
        return true
    }

    fun requestEpisode(n: Int): Boolean {
        if (!synced) return false
        // «إعادة المحاولة» لنفس الحلقة: محلية، لا تعيد الغرفة كلها لغرفة الانتظار
        if (n == hooks.episode() && n == roomEpisode()) return false
        if (!client.isHost) { hooks.message("المضيف يختار الحلقة"); return true }
        if (!client.command("load", 0.0, mediaKey(n), "الحلقة $n")) hooks.message("انتظر عودة الاتصال بالغرفة")
        return true
    }

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
        // − [القيمة] +: دائرتان بمقاس ثابت والرمز في مركزها تمامًا (بلا حشوة الخط التي كانت تزيحه)،
        // والقيمة بعرض ثابت في الوسط فلا يتحرك شيء حين يتغير الرقم
        val step = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            background = rounded(0x12FFFFFF, context.dp(22).toFloat())
            setPadding(context.dp(4), context.dp(4), context.dp(4), context.dp(4))
        }
        fun stepBtn(label: String, delta: Long, desc: String) = context.label(label, 20f, Color.WHITE, bold = true).apply {
            gravity = Gravity.CENTER
            textAlignment = View.TEXT_ALIGNMENT_CENTER
            includeFontPadding = false
            setPadding(0, 0, 0, 0)
            background = rounded(0x1FFFFFFF, context.dp(18).toFloat())
            contentDescription = desc
            setOnClickListener { setOffset(offsetMs + delta) }
        }
        step.addView(stepBtn("−", -500, "أخّر فيديوك نصف ثانية"), LinearLayout.LayoutParams(context.dp(36), context.dp(36)))
        step.addView(context.label(offsetText(v), 14f, Color.WHITE, bold = true).apply {
            gravity = Gravity.CENTER
            textAlignment = View.TEXT_ALIGNMENT_CENTER
            includeFontPadding = false
            maxLines = 1
            textDirection = View.TEXT_DIRECTION_RTL
        }, LinearLayout.LayoutParams(context.dp(72), context.dp(36)))
        step.addView(stepBtn("+", 500, "قدّم فيديوك نصف ثانية"), LinearLayout.LayoutParams(context.dp(36), context.dp(36)))
        addView(step)
    }


    /**
     * شاشة الغرفة (نفس تصميم الويب together-lobby.js): البنر صافيًا وتعتيم من الأسفل فقط،
     * «مشاهدة معًا» وزر خروج، الشعار كبيرًا وسطر واحد تحته، وشريط سفلي واحد: الوجوه متراكبة،
     * جملة حالة واحدة، سطر السيرفر و«غيّر»، «⋯» (الديلاي)، وزر البدء بلون القسم.
     */
    private fun showLobby() {
        if (lobby == null) {
            val root = FrameLayout(context).apply {
                setBackgroundColor(0xFF050507.toInt())
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                swallowTouches()
            }
            // البنر كاملًا بنسبته (16:9) بارتفاع الشاشة في جهة (لا قصّ في الجوال العريض)، ويذوب
            // طرفه في الخلفية؛ الشعار والمعلومات في الجهة الأخرى — كصفحات الأفلام
            val bannerBox = FrameLayout(context)
            val banner = ImageView(context).apply { scaleType = ImageView.ScaleType.CENTER_CROP; alpha = 0f }
            bannerBox.addView(banner, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            bannerBox.addView(View(context).apply {
                background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0x00050507, 0x00050507, 0x00050507, 0x8C050507.toInt(), 0xFF050507.toInt()))
            }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            root.addView(bannerBox, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.END))
            // تعتيم يساري تكيّفي (LobbyDim): بنر Cinemeta لأعمال مثل أركين أبيض ناصع في نصفه الأيسر فيضيع عليه زر الإغلاق
            // والبطاقة والشريط. يُقاس من إضاءة اليسار بعد وصول الصورة؛ البنر الغامق لا يُمسّ. الجهة اليمنى لها تدرجها المستقل.
            val dim = View(context).apply {
                background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xDB050507.toInt(), 0xB8050507.toInt(), 0x66050507, 0x14050507, 0x00050507))
                alpha = 0f
            }
            images.load(launch.banner, context.resources.displayMetrics.widthPixels) { bmp ->
                if (bmp != null) {
                    banner.setImageBitmap(bmp); banner.animate().alpha(1f).setDuration(420).start()
                    val small = android.graphics.Bitmap.createScaledBitmap(bmp, 32, 18, true)
                    val px = IntArray(32 * 18)
                    small.getPixels(px, 0, 32, 0, 0, 32, 18)
                    dim.animate().alpha(LobbyDim.strength(LobbyDim.leftLuma(px, 32, 18))).setDuration(420).start()
                }
            }
            root.addView(dim, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            // تعتيم خفيف من الأسفل حيث الشريط فقط
            root.addView(View(context).apply {
                background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(0xEB050507.toInt(), 0x66050507, 0x00050507, 0x00050507, 0x00050507))
            }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            root.addView(View(context).apply {
                background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0x73050507, 0x00050507))
            }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, context.dp(90), Gravity.TOP))

            // أعلى: «مشاهدة معًا» بنقطة الاتصال · خروج
            val top = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(context.dp(22), context.dp(12), context.dp(16), 0)
            }
            val conn = context.label("●  مشاهدة معًا", 13f, 0xDBFFFFFF.toInt(), bold = true).apply { setShadowLayer(context.dp(6).toFloat(), 0f, 0f, 0x99000000.toInt()) }
            lobbyConn = conn
            top.addView(conn)
            top.addView(View(context), LinearLayout.LayoutParams(0, 1, 1f))
            top.addView(ImageView(context).apply {
                setImageDrawable(com.vantara.anime.player.Glyph(com.vantara.anime.player.Glyph.Kind.CLOSE, Color.WHITE))
                setPadding(context.dp(10), context.dp(10), context.dp(10), context.dp(10))
                background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(0x61000000) }
                contentDescription = "اطلع من الغرفة"
                setOnClickListener { client.bye(); hooks.leaveRoom() }
            }, LinearLayout.LayoutParams(context.dp(40), context.dp(40)))
            root.addView(top, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))

            // الشعار يُحسم مرة (CLAUDE.md): صورة الشعار إن وصلت خلال 1.2 ث وإلا الاسم، ومكانه محجوز ومخفي حتى الحسم —
            // لا يظهر الاسم ثم يُستبدل بالشعار. طبقتان: رمادية تحت وملوّنة فوق تنكشف بقدر التجهيز الحقيقي في اتجاه كتابتها.
            val hero = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.START }
            val mark = FrameLayout(context).apply { visibility = View.INVISIBLE }
            hero.addView(mark, LinearLayout.LayoutParams(context.dp(240), context.dp(80)))
            var decided = false
            fun decide(bmp: android.graphics.Bitmap?) {
                if (decided) return
                decided = true
                fun layer(ghost: Boolean): View = if (bmp != null) ImageView(context).apply {
                    setImageBitmap(bmp)
                    scaleType = ImageView.ScaleType.FIT_CENTER
                    if (ghost) { alpha = 0.3f; colorFilter = android.graphics.ColorMatrixColorFilter(android.graphics.ColorMatrix().apply { setSaturation(0f) }) }
                } else context.label(launch.title ?: "مشاهدة معًا", 28f, Color.WHITE, bold = true).apply {
                    maxLines = 2
                    textDirection = View.TEXT_DIRECTION_ANY_RTL
                    if (ghost) alpha = 0.3f
                }
                markRtl = bmp == null && Regex("[\u0600-\u06FF]").containsMatchIn(launch.title.orEmpty())
                mark.layoutParams = if (bmp != null) {
                    val h = context.dp(80)
                    LinearLayout.LayoutParams(min(context.dp(280), h * bmp.width / max(1, bmp.height)), h)
                } else LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                mark.removeAllViews()
                mark.addView(layer(true), FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                val fill = layer(false)
                mark.addView(fill, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                markFill = fill
                fill.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> paintProgress() }
                mark.visibility = View.VISIBLE
                paintProgress()
            }
            val logoUrl = launch.logo
            if (logoUrl != null) {
                main.postDelayed({ decide(null) }, 3000) // أول تحميل للشعار على شبكة جوال قد يتجاوز ثانية؛ مكانه مخفي حتى الحسم
                images.load(logoUrl, context.dp(360)) { bmp -> decide(bmp?.takeIf { it.width > 1 }) }
            } else decide(null)
            // النوع صغيرًا، ثم «الحلقة N» بخط كبير، ثم عنوان الحلقة معزول الاتجاه، ثم مراحل التجهيز بأسمائها
            launch.kindText?.takeIf { it.isNotBlank() && it != episodeText() }?.let {
                hero.addView(context.label(it, 13.5f, 0x99FFFFFF.toInt(), bold = true).apply { setPadding(0, context.dp(8), 0, 0) })
            }
            hero.addView(context.label(episodeText(), 26f, Color.WHITE, bold = true).apply { setShadowLayer(context.dp(12).toFloat(), 0f, context.dp(2).toFloat(), 0x80000000.toInt()) }.also { lobbyEpisode = it })
            launch.episodeTitle?.takeIf { it.isNotBlank() }?.let {
                hero.addView(context.label("\u2068$it\u2069", 14f, 0xC7FFFFFF.toInt(), bold = true).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END; visibility = if (roomEpisode() == initialEpisode) View.VISIBLE else View.GONE }.also { lobbyEpisodeTitle = it })
            }
            val steps = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, context.dp(8), 0, 0) }
            val bars = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_LTR }
            stepBars = (0 until STEPS.size).map { View(context).also { v -> bars.addView(v, LinearLayout.LayoutParams(context.dp(20), context.dp(3)).apply { marginEnd = context.dp(4) }) } }
            steps.addView(bars)
            stepText = context.label("", 12.5f, 0xB8FFFFFF.toInt(), bold = true).apply { setPadding(context.dp(8), 0, context.dp(8), 0) }
            steps.addView(stepText)
            hero.addView(steps)
            root.addView(hero, FrameLayout.LayoutParams((context.resources.displayMetrics.widthPixels * 0.44f).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.START).apply {
                marginStart = context.dp(28); bottomMargin = context.dp(92)
            })
            // بطاقة «البدء»: يسار الشاشة (END في الاتجاه RTL) فوق الشريط، ومكانها يُضبط في positionContent
            val startCard = FrameLayout(context).apply { visibility = View.GONE; elevation = context.dp(6).toFloat() }
            lobbyStart = startCard
            root.addView(startCard, FrameLayout.LayoutParams(context.dp(300), context.dp(169), Gravity.BOTTOM or Gravity.END).apply {
                marginEnd = context.dp(28); bottomMargin = context.dp(102)
            })

            // «⋯»: الديلاي (فوق زر «⋯» في نهاية السطر)
            val more = FrameLayout(context).apply {
                visibility = View.GONE
                setPadding(context.dp(6), context.dp(6), context.dp(6), context.dp(6))
                background = rounded(0xFF121218.toInt(), context.dp(14).toFloat(), context.dp(1), 0x1AFFFFFF)
                elevation = context.dp(8).toFloat()
            }
            lobbyMore = more
            root.addView(more, FrameLayout.LayoutParams(context.dp(380), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.END).apply { marginEnd = context.dp(20); bottomMargin = context.dp(76) })

            // الشريط السفلي الواحد
            val bar = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(context.dp(28), context.dp(12), context.dp(20), context.dp(14))
            }
            lobbyBar = bar
            val divider = View(context).apply { setBackgroundColor(0x12FFFFFF) }
            root.addView(divider, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1, Gravity.BOTTOM))
            // Measure the complete two-line status and buttons: a fixed 70dp row clipped
            // Arabic descenders and the server link once padding/font metrics were included.
            root.addView(bar, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
            fun positionContent() {
                val portrait = root.height > root.width
                if ((bar.orientation == LinearLayout.VERTICAL) != portrait && lobby != null) paintLobby()
                val heroParams = hero.layoutParams as FrameLayout.LayoutParams
                val safeBottom = (bar.layoutParams as FrameLayout.LayoutParams).bottomMargin
                val heroWidth = if (portrait) root.width - context.dp(40) else (root.width * 0.44f).toInt()
                val heroBottom = bar.height + safeBottom + context.dp(24)
                val heroStart = context.dp(if (portrait) 20 else 28)
                if (heroParams.width != heroWidth || heroParams.bottomMargin != heroBottom || heroParams.marginStart != heroStart) {
                    heroParams.width = heroWidth; heroParams.bottomMargin = heroBottom; heroParams.marginStart = heroStart
                    hero.layoutParams = heroParams
                }
                // البطاقة: أفقيًا 300×169 يسارًا بحذاء أسفل المعلومات، وطوليًا بعرض الشاشة (حتى 340) وسط الصفحة فوق المعلومات
                val cardW = if (portrait) maxOf(context.dp(120), minOf(root.width - context.dp(40), context.dp(340))) else context.dp(300)
                val cardH = cardW * 9 / 16
                val cardBottom = if (portrait) heroBottom + hero.height + context.dp(16) else heroBottom
                val cardGravity = if (portrait) Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL else Gravity.BOTTOM or Gravity.END
                val cardEnd = if (portrait) 0 else heroStart
                val cp = startCard.layoutParams as FrameLayout.LayoutParams
                if (cp.width != cardW || cp.height != cardH || cp.bottomMargin != cardBottom || cp.gravity != cardGravity || cp.marginEnd != cardEnd) {
                    cp.width = cardW; cp.height = cardH; cp.bottomMargin = cardBottom; cp.gravity = cardGravity; cp.marginEnd = cardEnd
                    startCard.layoutParams = cp
                }
                val moreParams = more.layoutParams as FrameLayout.LayoutParams
                val moreWidth = minOf(context.dp(380), root.width - context.dp(40))
                val moreBottom = bar.height + safeBottom + context.dp(10)
                if (moreParams.width != moreWidth || moreParams.bottomMargin != moreBottom) {
                    moreParams.width = moreWidth; moreParams.bottomMargin = moreBottom; more.layoutParams = moreParams
                }
                val dividerParams = divider.layoutParams as FrameLayout.LayoutParams
                if (dividerParams.bottomMargin != bar.height + safeBottom) {
                    dividerParams.bottomMargin = bar.height + safeBottom; divider.layoutParams = dividerParams
                }
            }
            root.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> positionContent() }
            bar.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> positionContent() }
            ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
                val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
                bar.setPadding(maxOf(context.dp(28), safe.left), context.dp(12), maxOf(context.dp(20), safe.right), context.dp(18))
                val params = bar.layoutParams as FrameLayout.LayoutParams
                if (params.bottomMargin != safe.bottom) { params.bottomMargin = safe.bottom; bar.layoutParams = params }
                top.setPadding(maxOf(context.dp(22), safe.left), maxOf(context.dp(12), safe.top), maxOf(context.dp(16), safe.right), 0)
                insets
            }
            ViewCompat.requestApplyInsets(root)

            lobby = root
            hooks.overlayHost().addView(root, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            root.alpha = 0f
            root.animate().alpha(1f).setDuration(220).start()
        }
        paintLobby()
        paintStrip()
    }

    private fun episodeText(): String {
        val n = roomEpisode()
        if (launch.kindText == "فيلم") return "فيلم"
        return launch.season?.let { "م$it · الحلقة $n" } ?: "الحلقة $n"
    }

    private fun hideLobby() {
        lobby?.let { (it.parent as? ViewGroup)?.removeView(it) }
        lobby = null
        lobbyBar = null
        lobbyConn = null
        lobbyMore = null
        lobbySuggest = null
        lobbyStart = null
        lobbyCount = null
        lobbySig = ""
        lobbyEpisode = null
        lobbyEpisodeTitle = null
        markFill = null
        stepBars = emptyList()
        stepText = null
        paintStrip()
    }

    /** العدّ التنازلي المشترك: رقم كبير حتى لحظة البدء، ثم تختفي الشاشة والكل يبدأ معًا. */
    private fun startCountdown(at: Double) {
        showLobby()
        val root = lobby ?: return
        countdownAt = at
        if (lobbyCount == null) {
            val box = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setBackgroundColor(0x8C050507.toInt())
            }
            val num = context.label("", 120f, Color.WHITE, bold = true).apply { gravity = Gravity.CENTER; includeFontPadding = false }
            box.addView(num)
            box.addView(context.label("نبدأ مع بعض", 16f, 0xBFFFFFFF.toInt(), bold = true).apply { gravity = Gravity.CENTER })
            root.addView(box, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            lobbyBar?.visibility = View.INVISIBLE
            lobbyMore?.visibility = View.GONE
            lobbyCount = num
        }
        val tick = object : Runnable {
            override fun run() {
                val num = lobbyCount ?: return
                if (countdownAt != at) return
                val left = kotlin.math.ceil((at - serverNow()) / 1000.0).toInt()
                if (left <= 0) { hideLobby(); return }
                if (num.text != left.toString()) {
                    num.text = left.toString()
                    num.scaleX = 1.35f; num.scaleY = 1.35f; num.alpha = 0f
                    num.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(500).start()
                }
                main.postDelayed(this, 100)
            }
        }
        main.post(tick)
    }

    private fun paintLobby() {
        // «الحلقة N» من الغرفة نفسها، وعنوان حلقة الدعوة لا يبقى على حلقة أخرى
        lobbyEpisode?.let { v -> val text = episodeText(); if (v.text.toString() != text) v.text = text }
        lobbyEpisodeTitle?.visibility = if (roomEpisode() == initialEpisode) View.VISIBLE else View.GONE
        val bar = lobbyBar ?: return
        if (lobbyCount != null) return
        val root = lobby
        val portrait = (root?.height?.takeIf { it > 0 } ?: context.resources.displayMetrics.heightPixels) >
            (root?.width?.takeIf { it > 0 } ?: context.resources.displayMetrics.widthPixels)
        val sig = listOf(connected, ready, failedSource, awaitingPick, client.isHost, hooks.serverLabel(), portrait,
            client.roster.joinToString { "${it.userId}:${it.state}:${it.host}:${it.name}:${it.mediaKey}:${it.server}" }, pending().joinToString { it.userId }, headline().first,
            hostSuggestion()?.first).joinToString("|")
        if (sig == lobbySig && bar.childCount > 0) return
        lobbySig = sig
        root?.let { paintSuggestion(it, portrait) }
        bar.removeAllViews()
        bar.orientation = if (portrait) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL
        val details = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        bar.addView(details, LinearLayout.LayoutParams(if (portrait) ViewGroup.LayoutParams.MATCH_PARENT else 0, ViewGroup.LayoutParams.WRAP_CONTENT, if (portrait) 0f else 1f))
        lobbyConn?.text = if (connected) "●  مشاهدة معًا" else "●  جاري الاتصال…"
        lobbyConn?.setTextColor(if (connected) 0xDBFFFFFF.toInt() else 0xFFF5C76A.toInt())

        // الوجوه متراكبة: المضيف أولًا، والمدعو والمجهّز شفافان ينبضان بهدوء
        val faces = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val people = client.roster.sortedWith(compareByDescending<Member> { it.host }.thenBy { it.joinedAt })
        val all = people.map { Triple(it.userId, it.name, it.avatarKey) to (it.state to it.host) } +
            pending().map { Triple(it.userId, it.displayName, it.avatarKey) to ("pending" to false) }
        all.take(5).forEachIndexed { i, (who, st) ->
            val box = FrameLayout(context)
            val f = face(who.first, who.second, who.third, st.first, 40)
            box.addView(f, FrameLayout.LayoutParams(context.dp(40), context.dp(40), Gravity.CENTER))
            if (st.second) box.addView(View(context).apply {
                background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(accent); setStroke(context.dp(2), 0xFF050507.toInt()) }
            }, FrameLayout.LayoutParams(context.dp(12), context.dp(12), Gravity.BOTTOM or Gravity.START))
            if (st.first == "pending" || st.first == "preparing") f.animate().alpha(0.35f).setDuration(900).withEndAction(object : Runnable {
                override fun run() { if (f.isAttachedToWindow) f.animate().alpha(if (f.alpha < 0.5f) 0.75f else 0.35f).setDuration(900).withEndAction(this).start() }
            }).start()
            faces.addView(box, LinearLayout.LayoutParams(context.dp(42), context.dp(42)).apply { if (i > 0) marginStart = -context.dp(10) })
        }
        details.addView(faces)

        // جملة الحالة الواحدة + سطر السيرفر
        val info = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(context.dp(14), 0, context.dp(14), 0) }
        val (line, bad) = headline()
        info.addView(context.label(line, 15f, if (bad) 0xFFFF8B8E.toInt() else Color.WHITE, bold = true).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END })
        val server = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, context.dp(2), 0, 0) }
        if (awaitingPick) server.addView(context.label("لم تختر سيرفر بعد", 12.5f, 0xB3FFFFFF.toInt(), bold = true))
        else {
            server.addView(context.label(hooks.serverLabel() ?: "سيرفرك", 12.5f, 0xD9FFFFFF.toInt(), bold = true).apply { textDirection = View.TEXT_DIRECTION_LTR; maxLines = 1 })
            val (stText, stColor) = when { failedSource != null -> "تعذّر" to 0xFFFF8B8E.toInt(); ready -> "جاهز" to 0xFF6FE3A1.toInt(); else -> "يتجهّز…" to 0xFFF5C76A.toInt() }
            server.addView(context.label("  ·  ", 12.5f, 0x80FFFFFF.toInt()))
            server.addView(context.label(stText, 12.5f, stColor, bold = true))
        }
        info.addView(server)
        details.addView(info, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

        // Keep choosing a server visible beside Start, with matching pill geometry.
        val actions = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        bar.addView(actions, LinearLayout.LayoutParams(if (portrait) ViewGroup.LayoutParams.MATCH_PARENT else ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { if (portrait) topMargin = context.dp(14) })
        val moreBtn = ImageView(context).apply {
            setImageDrawable(com.vantara.anime.player.Glyph(com.vantara.anime.player.Glyph.Kind.MORE, Color.WHITE))
            rotation = 90f
            setPadding(context.dp(11), context.dp(11), context.dp(11), context.dp(11))
            background = rounded(0x8C0A0C14.toInt(), context.dp(12).toFloat(), context.dp(1), 0x29FFFFFF)
            contentDescription = "المزيد"
            setOnClickListener {
                val m = lobbyMore as? FrameLayout ?: return@setOnClickListener
                if (m.visibility == View.VISIBLE) m.visibility = View.GONE
                else { m.removeAllViews(); m.addView(offsetRow()); m.visibility = View.VISIBLE }
            }
        }
        actions.addView(moreBtn, LinearLayout.LayoutParams(context.dp(44), context.dp(44)).apply { marginEnd = context.dp(10) })
        // «الحلقات» للمضيف: ورقة الحلقات، واختياره ينقل الغرفة كلها (requestEpisode ← load)
        if (client.isHost && hooks.hasEpisodes()) {
            val episodes = context.label("الحلقات", 14f, Color.WHITE, bold = true).apply {
                gravity = Gravity.CENTER
                maxLines = 1
                setPadding(context.dp(16), 0, context.dp(16), 0)
                background = rounded(0x8C0A0C14.toInt(), context.dp(12).toFloat(), context.dp(1), 0x29FFFFFF)
                contentDescription = "الحلقات"
                setOnClickListener { hooks.openEpisodes() }
            }
            actions.addView(episodes, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, context.dp(46)).apply { marginEnd = context.dp(10) })
        }
        val picking = awaitingPick || failedSource != null
        val choose = context.label(if (picking) "اختر سيرفر" else hooks.serverLabel() ?: "السيرفر", 14f, if (picking) com.vantara.anime.player.Tone.ON_ACCENT else Color.WHITE, bold = true).apply {
            gravity = Gravity.CENTER
            maxLines = 1
            setPadding(context.dp(18), 0, context.dp(18), 0)
            // الخطوة الحالية بالأزرق وحدها: قبل الاختيار هذا هو الزر الأزرق الوحيد في الشاشة
            if (!picking) textDirection = View.TEXT_DIRECTION_LTR
            background = if (picking) rounded(accent, context.dp(12).toFloat()) else rounded(0x8C0A0C14.toInt(), context.dp(12).toFloat(), context.dp(1), 0x29FFFFFF)
            contentDescription = "اختر السيرفر"
            setOnClickListener { hooks.openServers() }
        }
        actions.addView(choose, LinearLayout.LayoutParams(if (portrait) 0 else ViewGroup.LayoutParams.WRAP_CONTENT, context.dp(46), if (portrait) 1f else 0f).apply { marginEnd = context.dp(10) })
        // البدء: بطاقة كبيرة فوق الشريط (lobbyStart) لا زرًا فيه. غير المضيف يرى «بانتظار المضيف» في الشريط
        val canStart = TogetherStart.gate(ready, connected, awaitingPick, guestsWaiting().size) == TogetherStart.Gate.SEND
        val startHost = lobbyStart
        if (startHost != null) {
            if (client.isHost) {
                paintStartCard(startHost, canStart)
                startHost.visibility = View.VISIBLE
            } else {
                startHost.visibility = View.GONE
            }
        }
        if (!client.isHost) actions.addView(context.label("بانتظار المضيف", 14f, 0xB3FFFFFF.toInt(), bold = true).apply { gravity = Gravity.CENTER; setPadding(context.dp(8), 0, context.dp(8), 0) },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, context.dp(46)))
        if ((lobbyMore as? FrameLayout)?.visibility == View.VISIBLE) { (lobbyMore as FrameLayout).removeAllViews(); (lobbyMore as FrameLayout).addView(offsetRow()) }
    }

    /**
     * بطاقة «البدء»: صورة الحلقة تملأها بحواف 10، وبالنص دائرة 60 بمثلث تشغيل، وبلا كتابة. الدائرة بلون القسم حين
     * يجهز فيديوك، وقبل ذلك خافتة والصورة تخفت معها.
     */
    private fun paintStartCard(card: FrameLayout, canStart: Boolean) {
        card.removeAllViews()
        val radius = context.dp(10).toFloat()
        card.background = if (canStart) rounded(0xFF15171F.toInt(), radius) else rounded(0x8C0A0C14.toInt(), radius, context.dp(1), 0x29FFFFFF)
        card.clipToOutline = true
        card.contentDescription = "ابدأ للجميع"
        launch.episodeImage?.let { url ->
            val thumb = ImageView(context).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                if (!canStart) { alpha = 0.6f; colorFilter = android.graphics.ColorMatrixColorFilter(android.graphics.ColorMatrix().apply { setSaturation(0.35f) }) }
            }
            images.load(url, context.dp(480)) { bmp -> if (bmp != null) thumb.setImageBitmap(bmp) }
            card.addView(thumb, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            // تعتيم خفيف يثبّت وضوح الدائرة على أي صورة (فاتحة أو داكنة)
            card.addView(View(context).apply { setBackgroundColor(if (canStart) 0x2E000000 else 0x4D000000) },
                FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        val dot = FrameLayout(context).apply {
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(if (canStart) accent else 0x8C000000.toInt()) }
            elevation = if (canStart) context.dp(4).toFloat() else 0f
        }
        val glyph = context.dp(28)
        dot.addView(ImageView(context).apply {
            setImageDrawable(com.vantara.anime.player.Glyph(com.vantara.anime.player.Glyph.Kind.PLAY, if (canStart) com.vantara.anime.player.Tone.ON_ACCENT else 0xBFFFFFFF.toInt()))
            // التمركز البصري: مركز ثقل المثلث (11.67 من 24) يسبق مركز الإطار قليلًا، فيُزاح نحو رأسه بقدر
            // الفرق (~2.3% من حجمه) لا أكثر: الإزاحة السابقة (1dp) كانت تضع مركز ثقله أبعد من مركز الدائرة
            translationX = glyph * 0.023f
        }, FrameLayout.LayoutParams(glyph, glyph, Gravity.CENTER))
        val dotSize = context.dp(60)
        card.addView(dot, FrameLayout.LayoutParams(dotSize, dotSize, Gravity.CENTER))
        // التقييم بمصدره والمدة: سطر صغير أسفل البطاقة نفسها (لا تحت عنوان الحلقة). لا يظهر ما لا نعرفه ولا يُخترع مصدر.
        val source = launch.ratingSource?.takeIf { it.isNotBlank() }
        val ratingText = launch.rating?.takeIf { it.isNotBlank() }?.let { r -> "\u2066★ " + r + (if (source != null) " " + source else "") + "\u2069" }
        val facts = listOfNotNull(ratingText, launch.duration?.takeIf { it.isNotBlank() })
        if (facts.isNotEmpty()) {
            card.addView(View(context).apply { background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(0x99000000.toInt(), 0x00000000)) },
                FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, context.dp(56), Gravity.BOTTOM))
            card.addView(context.label(facts.joinToString("  ·  "), 12.5f, 0xEBFFFFFF.toInt(), bold = true).apply {
                maxLines = 1; setShadowLayer(context.dp(4).toFloat(), 0f, 0f, 0xB3000000.toInt())
            }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.START).apply {
                marginStart = context.dp(14); bottomMargin = context.dp(10)
            })
        }
        // أول بدء: عدّ 3-2-1 مشترك عند الجميع
        card.setOnClickListener { pressStart() }
    }

    companion object {
        /** نفس ذاكرة الخلف في المشغّل (40 ث): القفز للخلف داخلها رخيص. */
        const val BACK_BUFFER_MS = 40_000L
        /** حد ديلاي الفيديو الشخصي: دقيقتان. */
        const val OFFSET_LIMIT_MS = 120_000L
        /** مراحل التجهيز (نفس عتبات الويب LOBBY_STEPS): اتصال، بيانات الحلقة، أول قطعة، تخزين، أول إطار. */
        val STEPS = floatArrayOf(0.06f, 0.16f, 0.4f, 0.7f, 1f)
        val STEP_NAMES = listOf("اتصال", "بيانات الحلقة", "أول قطعة", "تخزين", "أول إطار")
    }
}
