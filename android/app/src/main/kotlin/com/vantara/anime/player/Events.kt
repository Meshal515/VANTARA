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
    )

    @Volatile var listener: ((Progress) -> Unit)? = null

    /** أحداث عامة بالاسم: `server` (تفضيل)، `outbox` (شيء ينتظر الإرسال). */
    @Volatile var events: ((String, JSONObject) -> Unit)? = null

    fun emit(p: Progress) = listener?.invoke(p)

    fun emit(name: String, data: JSONObject) = events?.invoke(name, data)
}

/**
 * صندوق صادر محفوظ: «أرسل اللحظة لصديق» من المشغّل لا يضيع إن كانت الواجهة
 * نائمة خلفه أو أُغلق التطبيق. الواجهة تسحبه ([drain]) عند الحدث وعند كل عودة،
 * وترسله عبر طابور المزامنة الذي يعيد المحاولة وحده.
 */
object Outbox {
    private const val PREFS = "vantara.player.outbox"
    private const val KEY = "items"

    @Synchronized
    fun push(context: Context, item: JSONObject) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val list = runCatching { JSONArray(prefs.getString(KEY, "[]")) }.getOrDefault(JSONArray())
        list.put(item.put("id", "o-${System.nanoTime()}").put("at", System.currentTimeMillis()))
        prefs.edit().putString(KEY, list.toString()).apply()
        PlaybackEvents.emit("outbox", JSONObject().put("count", list.length()))
    }

    @Synchronized
    fun drain(context: Context): JSONArray {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val list = runCatching { JSONArray(prefs.getString(KEY, "[]")) }.getOrDefault(JSONArray())
        prefs.edit().remove(KEY).apply()
        return list
    }
}
