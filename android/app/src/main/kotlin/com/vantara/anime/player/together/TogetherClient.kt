package com.vantara.anime.player.together

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject

/**
 * عميل غرفة Together في المشغّل الأصلي: نفس بروتوكول `apps/web/lib/together/room.js`.
 * الاتصال في الكود الأصلي نفسه، فيبقى والمشغّل في المقدمة أو الشاشة مقفلة. كل
 * الأحداث تصل على الخيط الرئيسي.
 */
data class Member(
    val userId: String,
    val name: String,
    val host: Boolean,
    val joinedAt: Long,
    val pos: Double?,
    val at: Double?,
    val state: String,
    val source: String?,
    val driftMs: Long?,
    val sameVersion: Boolean?,
    /** نفس مفتاح الويب: `/avatars/x.webp` أو رابط. */
    val avatarKey: String? = null,
    /** الحلقة التي أبلغ عنها (لجاهزية «البدء»: تقرير حلقة سابقة لا يُحسب). */
    val mediaKey: String? = null,
    /** هوية سيرفره الثابتة بين الأجهزة («معرّف المصدر|رمز السيرفر»): لاقتراح سيرفر المضيف على الأعضاء. */
    val server: String? = null,
)

/**
 * كشف الاتصال «نصف الميت» بقواعد الويب نفسها (apps/web/lib/together/room.js): نبضة كل [HEARTBEAT_MS]، وصمت أطول من
 * [SILENCE_MS]، أو أمر/نبضة بلا أي رد خلال [ECHO_MS] = اتصال ميت فنعيد الاتصال فورًا. بدونه كان الجوال الذي ينتقل من
 * Wi‑Fi إلى البيانات يبقى على مقبس ميت دقائق: لا يصله أمر المضيف، والمضيف يظنه معه.
 */
internal class ConnectionWatch {
    private var lastRx = 0L
    private var awaitingSince: Long? = null
    fun opened(now: Long) { lastRx = now; awaitingSince = null }
    fun received(now: Long) { lastRx = now; awaitingSince = null }
    /** أرسلنا ما يستحق ردًا (أمرًا يعود صداه، أو نبضة). */
    fun expectReply(now: Long) { if (awaitingSince == null) awaitingSince = now }
    fun dead(now: Long): Boolean = awaitingSince?.let { now - it > ECHO_MS } == true || now - lastRx > SILENCE_MS
    companion object {
        const val HEARTBEAT_MS = 5_000L
        const val SILENCE_MS = 12_000L
        const val ECHO_MS = 2_500L
        const val WATCH_MS = 1_000L
    }
}

class TogetherClient(
    private val http: OkHttpClient,
    private val baseUrl: String,
    private val code: String,
    initialToken: String?,
    /** توكن الهوية يعيش 15 دقيقة: قبل كل إعادة اتصال نطلب جديدًا (على خيط خلفي). */
    private val refreshToken: (() -> String?)?,
    private val listener: Listener,
) {
    @Volatile private var token: String? = initialToken
    interface Listener {
        fun onWelcome() {}
        fun onState(timeline: Timeline, by: String?) {}
        fun onRoster(members: List<Member>) {}
        fun onMode(mode: String) {}
        fun onStatus(userId: String, name: String, state: String, source: String?) {}
        fun onJoined(name: String) {}
        fun onLeft(name: String, kicked: Boolean = false) {}
        fun onHost(userId: String) {}
        /** نهائي: full | gone | uninvited | replaced. لا إعادة محاولة بعده. */
        fun onClosed(reason: String) {}
        fun onConnection(live: Boolean) {}
        /** الخادم رفض أمرًا من هذا الاتصال (ليس المضيف عنده أو لا يملك التحكم). */
        /** رفض الخادم أمرًا. reason=not_ready: ضيوف لم يجهزوا بعد ([waiting] أسماؤهم). */
        fun onDenied(reason: String? = null, waiting: List<String> = emptyList()) {}
    }

    private val main = Handler(Looper.getMainLooper())
    val clock = SharedClock({ SystemClock.elapsedRealtime().toDouble() })
    private var proto = 1
    /**
     * الخادم القديم (proto 1) يختم كل أمر بـ«وصوله + 300ms» تأجيلًا ثابتًا معروفًا: نعيده للحظة وصوله فينفّذ الجميع
     * الأمر فور استلامه، بلا نشر خادم ولا Stable (قرار المالك). العدّ التنازلي للبداية أبعد من ذلك فلا يُمس.
     */
    private fun normalize(t: Timeline): Timeline {
        if (proto >= 2 || !clock.ready) return t
        val lead = t.at - clock.serverNow()
        return if (lead > 0 && lead <= OLD_LEAD_MS + 150) t.copy(at = t.at - OLD_LEAD_MS) else t
    }
    private var ws: WebSocket? = null
    private var closed = false
    private var attempt = 0
    private var live = false

    var me: String? = null; private set
    var hostUserId: String? = null; private set
    var mode = "sync"; private set
    var control = "host"; private set
    /** المدعوون بالمعرّف؛ null = الدعوة للكل. */
    var invited: List<String>? = null; private set
    var timeline: Timeline? = null; private set
    var roster: List<Member> = emptyList(); private set
    val isHost get() = me != null && me == hostUserId
    val canControl get() = isHost || (me != null && control == "all")

    fun connect() {
        if (closed) return
        val url = baseUrl.replaceFirst(Regex("^http"), "ws") + "/v1/together/rooms/$code/ws"
        val req = Request.Builder().url(url).header("Sec-WebSocket-Protocol", "vantara.together").apply {
            token?.let { header("Authorization", "Bearer $it") }
        }.build()
        ws = http.newWebSocket(req, object : WebSocketListener() {
            // أحداث مقبس قديم (أُغلق أو استُبدل) لا تمس الاتصال الحالي: كان إغلاقه المتأخر يمحو المقبس الجديد
            override fun onOpen(webSocket: WebSocket, response: Response) {
                main.post {
                    if (webSocket !== ws) return@post
                    attempt = 0
                    watch.opened(SystemClock.elapsedRealtime())
                    for (i in 0 until 8) main.postDelayed({ ping() }, i * 150L)
                    main.postDelayed(heartbeat, ConnectionWatch.HEARTBEAT_MS)
                    main.postDelayed(watchdog, ConnectionWatch.WATCH_MS)
                }
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                val msg = runCatching { JSONObject(text) }.getOrNull()
                main.post {
                    if (webSocket !== ws) return@post
                    watch.received(SystemClock.elapsedRealtime())
                    msg?.let(::handle)
                }
            }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                // Complete the server's close handshake so onClosed can schedule reconnect.
                webSocket.close(code, reason)
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = main.post { if (webSocket === ws) dropped(code) }.let {}
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = main.post { if (webSocket === ws) dropped(response?.code ?: 1006) }.let {}
        })
    }

    private val watch = ConnectionWatch()
    /** نبضة كل 5 ث (تغذي الساعة المشتركة أيضًا) تنتظر ردًا. */
    private val heartbeat = object : Runnable {
        override fun run() { if (ping()) watch.expectReply(SystemClock.elapsedRealtime()); main.postDelayed(this, ConnectionWatch.HEARTBEAT_MS) }
    }
    /** المقبس الميت يُلغى فيعيد onFailure الاتصال فورًا (أول محاولة بلا انتظار). */
    private val watchdog = object : Runnable {
        override fun run() {
            val socket = ws ?: return
            if (watch.dead(SystemClock.elapsedRealtime())) { socket.cancel(); return }
            main.postDelayed(this, ConnectionWatch.WATCH_MS)
        }
    }
    private fun stopTimers() { main.removeCallbacks(heartbeat); main.removeCallbacks(watchdog) }

    private fun ping() = send(JSONObject().put("t", "ping").put("t0", SystemClock.elapsedRealtime().toDouble()))

    private fun dropped(code: Int) {
        stopTimers()
        ws = null
        setLive(false)
        if (closed) return
        val final = when (code) { 4003 -> "full"; 4001 -> "replaced"; 4004 -> "gone"; 4005 -> "uninvited"; 4006 -> "kicked"; else -> null }
        if (final != null) { finish(final); return }
        val wait = BACKOFF[minOf(attempt, BACKOFF.size - 1)]
        attempt++
        main.postDelayed({
            val refresh = refreshToken ?: return@postDelayed connect()
            Thread {
                val fresh = runCatching { refresh() }.getOrNull()
                main.post { if (fresh != null) token = fresh; connect() }
            }.start()
        }, wait)
    }

    private fun finish(reason: String) {
        if (closed) return
        closed = true
        stopTimers()
        runCatching { ws?.close(1000, reason) }
        listener.onClosed(reason)
    }

    private fun setLive(on: Boolean) { if (live != on) { live = on; listener.onConnection(on) } }

    private fun handle(m: JSONObject) {
        when (m.optString("t")) {
            "pong" -> if (m.has("t0")) clock.sample(m.getDouble("t0"), m.getDouble("ts"), SystemClock.elapsedRealtime().toDouble())
            "welcome" -> {
                me = m.optString("you")
                proto = m.optInt("proto", 1)
                room(m.optJSONObject("room"))
                if (!clock.ready && m.has("now")) { val t = SystemClock.elapsedRealtime().toDouble(); clock.sample(t, m.getDouble("now"), t) }
                parseTimeline(m.optJSONObject("state"))?.let { timeline = it }
                roster = parseRoster(m.optJSONArray("roster"))
                setLive(true)
                listener.onWelcome()
                listener.onRoster(roster)
                timeline?.let { listener.onState(it, null) }
            }
            "state" -> parseTimeline(m.optJSONObject("state"))?.let { raw ->
                if ((timeline?.seq ?: -1) > raw.seq) return
                val t = normalize(raw)
                timeline = t
                listener.onState(t, m.optString("by").takeIf { it.isNotEmpty() && it != "null" })
            }
            "roster" -> { roster = parseRoster(m.optJSONArray("roster")); listener.onRoster(roster) }
            "room" -> { room(m.optJSONObject("room")); listener.onMode(mode) }
            "host" -> { hostUserId = m.optString("userId"); listener.onHost(hostUserId!!) }
            "status" -> listener.onStatus(m.optString("userId"), m.optString("name"), m.optString("state"), m.optString("source").takeIf { it.isNotEmpty() && it != "null" })
            "joined" -> listener.onJoined(m.optString("name"))
            "left" -> listener.onLeft(m.optString("name"), m.optBoolean("kicked"))
            "denied" -> listener.onDenied(
                m.optString("reason").takeIf { it.isNotEmpty() },
                m.optJSONArray("waiting")?.let { a -> (0 until a.length()).mapNotNull { a.optString(it).takeIf(String::isNotEmpty) } } ?: emptyList(),
            )
            "full", "gone", "uninvited", "kicked" -> finish(m.optString("t"))
        }
    }

    private fun room(r: JSONObject?) {
        r ?: return
        hostUserId = r.optString("hostUserId", hostUserId ?: "")
        mode = r.optString("mode", mode)
        control = r.optString("control", control)
        r.optJSONArray("invited")?.let { a -> invited = (0 until a.length()).mapNotNull { a.optString(it).takeIf(String::isNotEmpty) } }
    }

    fun send(o: JSONObject): Boolean = ws?.send(o.toString()) ?: false

    /** at: لحظة الضغط بساعة الغرفة؛ الخادم يختم الأمر بها بدل لحظة وصوله (لا انتظار مصطنع). */
    fun command(op: String, pos: Double? = null, mediaKey: String? = null, mediaLabel: String? = null, countdownMs: Long? = null, at: Double? = null) = send(JSONObject().put("t", "cmd").put("op", op).apply {
        pos?.let { put("pos", it) }
        countdownMs?.let { put("countdownMs", it) }
        at?.let { put("at", Math.round(it)) }
        // نوع العمل من مفتاحه (`cinema:tt…:2#4`): كان «anime» دائمًا، فينقلب مسلسل الغرفة أنميًا عند الويب وويندوز
        if (mediaKey != null) put("media", JSONObject().put("key", mediaKey).put("kind", mediaKind(mediaKey)).put("label", mediaLabel ?: mediaKey))
    }).also { sent -> if (sent) watch.expectReply(SystemClock.elapsedRealtime()) }

    fun report(pos: Double, state: String, source: String?, mediaKey: String?, durationMs: Long?, driftMs: Long?, driftP95: Long?, server: String? = null) = send(
        JSONObject().put("t", "report").put("pos", pos).put("at", clock.serverNow()).put("state", state)
            .put("source", source ?: JSONObject.NULL).put("server", server ?: JSONObject.NULL).put("mediaKey", mediaKey ?: JSONObject.NULL)
            .put("version", JSONObject().put("durationMs", durationMs ?: JSONObject.NULL))
            .put("driftMs", driftMs ?: JSONObject.NULL).put("driftP95", driftP95 ?: JSONObject.NULL),
    )

    fun setMode(next: String) = send(JSONObject().put("t", "mode").put("mode", next))

    /** المضيف يُخرج شخصًا (لا يعود إلا بدعوة جديدة). */
    fun kick(userId: String) = send(JSONObject().put("t", "kick").put("userId", userId))

    /** المضيف ينقل الاستضافة. */
    fun giveHost(userId: String) = send(JSONObject().put("t", "host").put("userId", userId))

    /** «اطلع من الغرفة» صريحًا: «bye» قبل الإغلاق، فإن كنت المضيف تنتقل الاستضافة لأقدم حاضر فورًا (قرار المالك). */
    fun bye() { send(JSONObject().put("t", "bye")) }

    fun close() {
        closed = true
        stopTimers()
        main.removeCallbacksAndMessages(null)
        runCatching { ws?.close(1000, "left") }
        ws = null
    }

    companion object {
        /** نوع العمل كما يفهمه الخادم والويب، من بادئة المفتاح. */
        internal fun mediaKind(key: String): String = key.substringBefore(':').takeIf { it == "anime" || it == "cinema" || it == "manga" } ?: "anime"
        // أول إعادة فورية بعد انقطاع لحظي، ثم تتباعد (كانت تنتظر ثانية كاملة قبل أول محاولة)
        private const val OLD_LEAD_MS = 300.0
        private val BACKOFF = longArrayOf(0, 1_000, 2_000, 4_000, 8_000, 15_000)

        fun parseTimeline(o: JSONObject?): Timeline? {
            o ?: return null
            val media = o.optJSONObject("media")
            return Timeline(
                mediaKey = media?.optString("key"),
                mediaLabel = media?.optString("label"),
                started = o.optBoolean("started", o.optInt("seq") > 0),
                playing = o.optBoolean("playing"),
                pos = o.optDouble("pos", 0.0),
                at = o.optDouble("at", 0.0),
                rate = o.optDouble("rate", 1.0),
                seq = o.optInt("seq"),
            )
        }

        fun parseRoster(a: JSONArray?): List<Member> {
            a ?: return emptyList()
            return (0 until a.length()).mapNotNull { i ->
                val o = a.optJSONObject(i) ?: return@mapNotNull null
                Member(
                    userId = o.optString("userId"),
                    name = o.optString("name", "صديق"),
                    host = o.optBoolean("host"),
                    joinedAt = o.optLong("joinedAt"),
                    pos = if (o.isNull("pos")) null else o.optDouble("pos"),
                    at = if (o.isNull("at")) null else o.optDouble("at"),
                    state = o.optString("state", "preparing"),
                    source = o.optString("source").takeIf { !o.isNull("source") && it.isNotEmpty() },
                    driftMs = if (o.isNull("driftMs")) null else o.optLong("driftMs"),
                    sameVersion = if (o.isNull("sameVersion") || !o.has("sameVersion")) null else o.optBoolean("sameVersion"),
                    avatarKey = o.optString("avatarKey").takeIf { !o.isNull("avatarKey") && it.isNotEmpty() },
                    mediaKey = o.optString("mediaKey").takeIf { !o.isNull("mediaKey") && it.isNotEmpty() },
                    server = o.optString("server").takeIf { !o.isNull("server") && it.isNotEmpty() },
                )
            }
        }
    }
}
