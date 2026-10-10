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
)

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
        fun onLeft(name: String) {}
        fun onHost(userId: String) {}
        /** نهائي: full | gone | uninvited | replaced. لا إعادة محاولة بعده. */
        fun onClosed(reason: String) {}
        fun onConnection(live: Boolean) {}
    }

    private val main = Handler(Looper.getMainLooper())
    val clock = SharedClock({ SystemClock.elapsedRealtime().toDouble() })
    private var ws: WebSocket? = null
    private var closed = false
    private var attempt = 0
    private var live = false

    var me: String? = null; private set
    var hostUserId: String? = null; private set
    var mode = "sync"; private set
    var control = "host"; private set
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
            override fun onOpen(webSocket: WebSocket, response: Response) {
                main.post {
                    attempt = 0
                    for (i in 0 until 8) main.postDelayed({ ping() }, i * 150L)
                    main.postDelayed(resync, RESYNC_MS)
                }
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                val msg = runCatching { JSONObject(text) }.getOrNull() ?: return
                main.post { handle(msg) }
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = main.post { dropped(code) }.let {}
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = main.post { dropped(response?.code ?: 1006) }.let {}
        })
    }

    private val resync = object : Runnable {
        override fun run() { ping(); main.postDelayed(this, RESYNC_MS) }
    }

    private fun ping() = send(JSONObject().put("t", "ping").put("t0", SystemClock.elapsedRealtime().toDouble()))

    private fun dropped(code: Int) {
        main.removeCallbacks(resync)
        ws = null
        setLive(false)
        if (closed) return
        val final = when (code) { 4003 -> "full"; 4001 -> "replaced"; 4004 -> "gone"; 4005 -> "uninvited"; else -> null }
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
        main.removeCallbacks(resync)
        runCatching { ws?.close(1000, reason) }
        listener.onClosed(reason)
    }

    private fun setLive(on: Boolean) { if (live != on) { live = on; listener.onConnection(on) } }

    private fun handle(m: JSONObject) {
        when (m.optString("t")) {
            "pong" -> if (m.has("t0")) clock.sample(m.getDouble("t0"), m.getDouble("ts"), SystemClock.elapsedRealtime().toDouble())
            "welcome" -> {
                me = m.optString("you")
                room(m.optJSONObject("room"))
                if (!clock.ready && m.has("now")) { val t = SystemClock.elapsedRealtime().toDouble(); clock.sample(t, m.getDouble("now"), t) }
                parseTimeline(m.optJSONObject("state"))?.let { timeline = it }
                roster = parseRoster(m.optJSONArray("roster"))
                setLive(true)
                listener.onWelcome()
                listener.onRoster(roster)
                timeline?.let { listener.onState(it, null) }
            }
            "state" -> parseTimeline(m.optJSONObject("state"))?.let { t ->
                if ((timeline?.seq ?: -1) > t.seq) return
                timeline = t
                listener.onState(t, m.optString("by").takeIf { it.isNotEmpty() && it != "null" })
            }
            "roster" -> { roster = parseRoster(m.optJSONArray("roster")); listener.onRoster(roster) }
            "room" -> { room(m.optJSONObject("room")); listener.onMode(mode) }
            "host" -> { hostUserId = m.optString("userId"); listener.onHost(hostUserId!!) }
            "status" -> listener.onStatus(m.optString("userId"), m.optString("name"), m.optString("state"), m.optString("source").takeIf { it.isNotEmpty() && it != "null" })
            "joined" -> listener.onJoined(m.optString("name"))
            "left" -> listener.onLeft(m.optString("name"))
            "full", "gone", "uninvited" -> finish(m.optString("t"))
        }
    }

    private fun room(r: JSONObject?) {
        r ?: return
        hostUserId = r.optString("hostUserId", hostUserId ?: "")
        mode = r.optString("mode", mode)
        control = r.optString("control", control)
    }

    fun send(o: JSONObject): Boolean = ws?.send(o.toString()) ?: false

    fun command(op: String, pos: Double? = null, mediaKey: String? = null, mediaLabel: String? = null) = send(JSONObject().put("t", "cmd").put("op", op).apply {
        pos?.let { put("pos", it) }
        if (mediaKey != null) put("media", JSONObject().put("key", mediaKey).put("kind", "anime").put("label", mediaLabel ?: mediaKey))
    })

    fun report(pos: Double, state: String, source: String?, mediaKey: String?, durationMs: Long?, driftMs: Long?, driftP95: Long?) = send(
        JSONObject().put("t", "report").put("pos", pos).put("at", clock.serverNow()).put("state", state)
            .put("source", source ?: JSONObject.NULL).put("mediaKey", mediaKey ?: JSONObject.NULL)
            .put("version", JSONObject().put("durationMs", durationMs ?: JSONObject.NULL))
            .put("driftMs", driftMs ?: JSONObject.NULL).put("driftP95", driftP95 ?: JSONObject.NULL),
    )

    fun setMode(next: String) = send(JSONObject().put("t", "mode").put("mode", next))

    fun close() {
        closed = true
        main.removeCallbacksAndMessages(null)
        runCatching { ws?.close(1000, "left") }
        ws = null
    }

    companion object {
        private const val RESYNC_MS = 30_000L
        private val BACKOFF = longArrayOf(1_000, 2_000, 4_000, 8_000, 15_000)

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
                )
            }
        }
    }
}
