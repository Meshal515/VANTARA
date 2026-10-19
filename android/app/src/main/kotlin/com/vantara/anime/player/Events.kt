package com.vantara.anime.player

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** قناة واحدة من المشغّل إلى الجسر (والجسر يبثّها للواجهة). */
object PlaybackEvents {
    data class Progress(
        val session: String,
        val candidateId: String,
        val sourceId: String,
        val animeId: String,
        val episode: Float,
        val positionMs: Long,
        val durationMs: Long,
        val final: Boolean,
        /** رمز السيرفر الذي يعمل (HGC…): الواجهة تتذكّره لهذا الأنمي. */
        val code: String?,
        val watchedRatio: Double = 0.0,
    )

    @Volatile var listener: ((Progress) -> Unit)? = null

    /** أحداث عامة بالاسم: `server` (تفضيل)، `outbox` (شيء ينتظر الإرسال). */
    @Volatile var events: ((String, JSONObject) -> Unit)? = null

    fun emit(p: Progress) = listener?.invoke(p)

    fun emit(name: String, data: JSONObject) = events?.invoke(name, data)
}

/** Account-owned, durable outbox. Reading does not acknowledge delivery. */
object Outbox {
    private const val PREFS = "vantara.player.outbox"
    private const val KEY = "items"


    private fun items(context: Context): JSONArray = runCatching {
        JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]"))
    }.getOrDefault(JSONArray())

    private fun save(context: Context, items: JSONArray) {
        check(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, items.toString()).commit())
    }

    @Synchronized
    fun push(context: Context, item: JSONObject) {
        require(item.optString("userId").isNotBlank())
        val list = items(context)
        if (item.optString("id").isBlank()) item.put("id", "o-${java.util.UUID.randomUUID()}")
        list.put(item.put("at", System.currentTimeMillis()))
        save(context, list)
        PlaybackEvents.emit("outbox", JSONObject().put("count", list.length()))
    }

    @Synchronized
    fun drain(context: Context, userId: String): JSONArray {
        require(userId.isNotBlank())
        val mine = JSONArray()
        val list = items(context)
        for (i in 0 until list.length()) list.optJSONObject(i)?.takeIf { it.optString("userId") == userId }?.let(mine::put)
        return mine
    }

    /** Call only after upload and the server recommendation row are durable. */
    @Synchronized
    fun acknowledge(context: Context, userId: String, id: String) {
        require(userId.isNotBlank())
        val list = items(context)
        val keep = JSONArray()
        var matched: JSONObject? = null
        for (i in 0 until list.length()) {
            val item = list.optJSONObject(i) ?: continue
            if (item.optString("userId") == userId && item.optString("id") == id) matched = item else keep.put(item)
        }
        if (matched == null) return
        // Commit first: if it fails the retry must retain its attachment.
        save(context, keep)

    }
}
