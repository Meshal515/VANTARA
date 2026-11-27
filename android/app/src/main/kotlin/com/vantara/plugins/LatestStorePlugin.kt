package com.vantara.plugins

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * مخزن «آخر التحديثات» الدائم في أندرويد (خطة 27 نوفمبر، المرحلة 2): SQLite أصلي في `filesDir/latest`
 * (لا الكاش: يبقى بعد تحديث التطبيق وتنظيف الكاش)، ملف لكل حساب باسم بصمة.
 *
 * العقد نفسه في `apps/web/lib/latest-store.js` (IndexedDB) و`apps/desktop/latest-store.cjs` (ويندوز)، والمخطط
 * نفسه نصًا (`latest-store.test.js` يقارنهما). لا حذف ولا تقليم هنا إطلاقًا (قرار المالك: لا تصفير).
 * مدخل واحد `call({method, args})` بأسماء معروفة فقط، يرجع `{value}`.
 */
@CapacitorPlugin(name = "LatestStore")
class LatestStorePlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val dbs = HashMap<String, SQLiteDatabase>()

    @PluginMethod
    fun call(call: PluginCall) {
        val method = call.getString("method") ?: ""
        if (method !in LatestRules.METHODS) { call.reject("عملية غير معروفة على مخزن آخر التحديثات"); return }
        val args = call.getObject("args") ?: JSObject()
        scope.launch {
            try {
                val value = synchronized(dbs) { dispatch(method, args) }
                call.resolve(JSObject().put("value", value ?: JSONObject.NULL))
            } catch (e: Exception) {
                call.reject(e.message ?: "تعذّر الوصول إلى مخزن آخر التحديثات")
            }
        }
    }

    override fun handleOnDestroy() {
        synchronized(dbs) { dbs.values.forEach { runCatching { it.close() } }; dbs.clear() }
    }

    private fun db(account: String): SQLiteDatabase {
        require(account.isNotEmpty()) { "الحساب مطلوب" }
        return dbs.getOrPut(account) { open(context, account) }
    }

    private fun dispatch(method: String, a: JSONObject): Any? {
        val d = db(a.optString("account"))
        return when (method) {
            "putEvents" -> putEvents(d, a.getJSONArray("events"))
            "timeline" -> timeline(d, a.getString("section"), a.optString("before").ifEmpty { null }, a.optInt("limit", 40), a.optString("work").ifEmpty { null })
            "getEvent" -> query(d, "SELECT * FROM events WHERE id = ?", arrayOf(a.getString("id"))) { eventOf(it) }.firstOrNull()
            "getMarks" -> JSONArray().also { out -> val w = a.getJSONArray("works"); for (i in 0 until w.length()) query(d, "SELECT * FROM marks WHERE work = ?", arrayOf(w.getString(i))) { markOf(it) }.forEach { m -> out.put(m) } }
            "putMarks" -> tx(d) { val m = a.getJSONArray("marks"); for (i in 0 until m.length()) { val x = m.getJSONObject(i); d.insertWithOnConflict("marks", null, ContentValues().apply { put("work", x.getString("work")); putOpt("section", x.opt("section")); putOpt("season", x.opt("season")); putOpt("number", x.opt("number")); putOpt("baseline_at", x.opt("baselineAt")); putOpt("updated_at", x.opt("updatedAt")) }, SQLiteDatabase.CONFLICT_REPLACE) }; m.length() }
            "getSourceMarks" -> JSONArray(query(d, "SELECT * FROM source_marks WHERE work = ? ORDER BY source_id", arrayOf(a.getString("work"))) { c -> JSONObject().put("work", c.str("work")).put("sourceId", c.str("source_id")).put("season", c.num("season")).put("number", c.num("number")).put("updatedAt", c.num("updated_at")) })
            "putSourceMarks" -> tx(d) { val m = a.getJSONArray("marks"); for (i in 0 until m.length()) { val x = m.getJSONObject(i); d.insertWithOnConflict("source_marks", null, ContentValues().apply { put("work", x.getString("work")); put("source_id", x.getString("sourceId")); putOpt("season", x.opt("season")); put("number", x.getDouble("number")); putOpt("updated_at", x.opt("updatedAt")) }, SQLiteDatabase.CONFLICT_REPLACE) }; m.length() }
            "putSnapshots" -> tx(d) { val r = a.getJSONArray("rows"); for (i in 0 until r.length()) { val x = r.getJSONObject(i); d.insertWithOnConflict("snapshots", null, ContentValues().apply { put("source_id", x.getString("sourceId")); put("payload", x.opt("payload")?.toString() ?: "null"); put("fetched_at", x.optLong("fetchedAt")) }, SQLiteDatabase.CONFLICT_REPLACE) }; r.length() }
            "getSnapshot" -> query(d, "SELECT * FROM snapshots WHERE source_id = ?", arrayOf(a.getString("sourceId"))) { c -> JSONObject().put("sourceId", c.str("source_id")).put("payload", LatestRules.parseJson(c.str("payload"))).put("fetchedAt", c.num("fetched_at")) }.firstOrNull()
            "getMeta" -> query(d, "SELECT value FROM meta WHERE key = ?", arrayOf(a.getString("key"))) { LatestRules.parseJson(it.str("value")) }.firstOrNull()
            "setMeta" -> { d.insertWithOnConflict("meta", null, ContentValues().apply { put("key", a.getString("key")); put("value", LatestRules.toJson(a.opt("value"))) }, SQLiteDatabase.CONFLICT_REPLACE); true }
            "stats" -> JSONObject().put("events", count(d, "SELECT COUNT(*) FROM events")).put("pinned", count(d, "SELECT COUNT(*) FROM events WHERE pinned = 1")).put("marks", count(d, "SELECT COUNT(*) FROM marks"))
            else -> error("عملية غير معروفة")
        }
    }

    private fun putEvents(d: SQLiteDatabase, events: JSONArray): JSONObject = tx(d) {
        var inserted = 0; var updated = 0
        for (i in 0 until events.length()) {
            val next = events.getJSONObject(i)
            val old = query(d, "SELECT * FROM events WHERE id = ?", arrayOf(next.getString("id"))) { eventOf(it) }.firstOrNull()
            if (old == null) inserted++ else updated++
            val e = LatestRules.merge(old, next)
            d.insertWithOnConflict("events", null, ContentValues().apply {
                put("id", e.getString("id")); put("work", e.getString("work")); put("section", e.getString("section")); put("kind", e.getString("kind"))
                putOpt("season", e.opt("season")); putOpt("number", e.opt("number")); put("title", e.getString("title")); putOpt("cover", e.opt("cover"))
                put("at", e.getLong("at")); putOpt("published_at", e.opt("publishedAt")); put("first_seen_at", e.getLong("firstSeenAt"))
                put("observed_advance", if (e.optBoolean("observedAdvance")) 1 else 0); put("sources", (e.optJSONArray("sources") ?: JSONArray()).toString())
                put("pinned", if (e.optBoolean("pinned")) 1 else 0); put("origin", e.optString("origin", "local")); put("updated_at", e.optLong("updatedAt"))
            }, SQLiteDatabase.CONFLICT_REPLACE)
        }
        JSONObject().put("inserted", inserted).put("updated", updated)
    }

    private fun timeline(d: SQLiteDatabase, section: String, before: String?, limit: Int, work: String?): JSONArray {
        val where = mutableListOf("section = ?"); val binds = mutableListOf(section)
        if (work != null) { where += "work = ?"; binds += work }
        LatestRules.cursor(before)?.let { (at, id) -> where += "(at < ? OR (at = ? AND id < ?))"; binds += listOf(at.toString(), at.toString(), id) }
        val n = limit.coerceIn(1, 100) + 1
        // `at` عدد: المقارنة بالنص في SQLite تتحول لعدد بسبب نوع العمود INTEGER
        return JSONArray(query(d, "SELECT * FROM events WHERE ${where.joinToString(" AND ")} ORDER BY at DESC, id DESC LIMIT $n", binds.toTypedArray()) { eventOf(it) })
    }

    private fun <T> tx(d: SQLiteDatabase, body: () -> T): T { d.beginTransaction(); try { val out = body(); d.setTransactionSuccessful(); return out } finally { d.endTransaction() } }
    private fun <T> query(d: SQLiteDatabase, sql: String, args: Array<String>, map: (Cursor) -> T): List<T> = d.rawQuery(sql, args).use { c -> buildList { while (c.moveToNext()) add(map(c)) } }
    private fun count(d: SQLiteDatabase, sql: String) = d.rawQuery(sql, null).use { if (it.moveToFirst()) it.getLong(0) else 0L }
    private fun Cursor.str(col: String): String? = getColumnIndex(col).takeIf { it >= 0 && !isNull(it) }?.let { getString(it) }
    private fun Cursor.num(col: String): Any? = getColumnIndex(col).takeIf { it >= 0 && !isNull(it) }?.let { if (getType(it) == Cursor.FIELD_TYPE_FLOAT) getDouble(it) else getLong(it) }
    private fun eventOf(c: Cursor) = JSONObject().put("id", c.str("id")).put("work", c.str("work")).put("section", c.str("section")).put("kind", c.str("kind"))
        .put("season", c.num("season") ?: JSONObject.NULL).put("number", c.num("number") ?: JSONObject.NULL).put("title", c.str("title")).put("cover", c.str("cover") ?: JSONObject.NULL)
        .put("at", c.num("at")).put("publishedAt", c.num("published_at") ?: JSONObject.NULL).put("firstSeenAt", c.num("first_seen_at"))
        .put("observedAdvance", c.num("observed_advance") == 1L).put("sources", JSONArray(c.str("sources") ?: "[]"))
        .put("pinned", c.num("pinned") == 1L).put("origin", c.str("origin")).put("updatedAt", c.num("updated_at"))
    private fun markOf(c: Cursor) = JSONObject().put("work", c.str("work")).put("section", c.str("section")).put("season", c.num("season") ?: JSONObject.NULL).put("number", c.num("number") ?: JSONObject.NULL).put("baselineAt", c.num("baseline_at") ?: JSONObject.NULL).put("updatedAt", c.num("updated_at") ?: JSONObject.NULL)
    private fun ContentValues.putOpt(key: String, v: Any?) { when (v) { null, JSONObject.NULL -> putNull(key); is Int -> put(key, v); is Long -> put(key, v); is Double -> put(key, v); is Number -> put(key, v.toDouble()); else -> put(key, v.toString()) } }

    companion object {
        /** ملف لكل حساب في filesDir (دائم)، واسمه بصمة فلا يظهر معرّف الحساب على القرص. */
        fun open(context: Context, account: String): SQLiteDatabase {
            val dir = File(context.filesDir, "latest").apply { mkdirs() }
            val digest = MessageDigest.getInstance("SHA-256").digest(account.toByteArray()).joinToString("") { "%02x".format(it) }.take(24)
            val d = SQLiteDatabase.openOrCreateDatabase(File(dir, "latest-$digest.sqlite"), null)
            d.enableWriteAheadLogging()
            check(d.version <= LatestRules.SCHEMA_VERSION) { "قاعدة آخر التحديثات أحدث من هذا الإصدار؛ لن تُلمس" }
            LatestRules.SCHEMA.split(';').map { it.trim() }.filter { it.isNotEmpty() }.forEach(d::execSQL)
            if (d.version < LatestRules.SCHEMA_VERSION) d.version = LatestRules.SCHEMA_VERSION
            return d
        }
    }
}

/** قواعد المخزن النقية (تُختبر على JVM بلا جهاز): المخطط، والدمج، والمؤشر، وأسماء العمليات. */
object LatestRules {
    const val SCHEMA_VERSION = 1
    val METHODS = setOf("putEvents", "timeline", "getEvent", "getMarks", "putMarks", "getSourceMarks", "putSourceMarks", "putSnapshots", "getSnapshot", "getMeta", "setMeta", "stats")
    // نص المخطط نفسه في apps/desktop/latest-store.cjs؛ latest-store.test.js يقارن النصين
    val SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, work TEXT NOT NULL, section TEXT NOT NULL, kind TEXT NOT NULL,
  season INTEGER, number REAL, title TEXT NOT NULL, cover TEXT,
  at INTEGER NOT NULL, published_at INTEGER, first_seen_at INTEGER NOT NULL,
  observed_advance INTEGER NOT NULL DEFAULT 0, sources TEXT NOT NULL DEFAULT '[]',
  pinned INTEGER NOT NULL DEFAULT 0, origin TEXT NOT NULL DEFAULT 'local', updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_timeline ON events (section, at DESC, id DESC);
CREATE INDEX IF NOT EXISTS events_work ON events (work, at DESC, id DESC);
CREATE TABLE IF NOT EXISTS marks (work TEXT PRIMARY KEY, section TEXT, season INTEGER, number REAL, baseline_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS source_marks (work TEXT NOT NULL, source_id TEXT NOT NULL, season INTEGER, number REAL NOT NULL, updated_at INTEGER, PRIMARY KEY (work, source_id));
CREATE TABLE IF NOT EXISTS snapshots (source_id TEXT PRIMARY KEY, payload TEXT, fetched_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""

    /** مؤشر الصفحة `at~id` كما في الخادم والويب. */
    fun cursor(before: String?): Pair<Long, String>? {
        if (before.isNullOrEmpty()) return null
        val i = before.indexOf('~'); if (i <= 0) return null
        val at = before.substring(0, i).toLongOrNull() ?: return null
        val id = before.substring(i + 1); return if (id.isEmpty()) null else at to id
    }

    /** الأقدم وقتًا يفوز، والمصادر اتحاد بمعرّفها `s`، والتثبيت لا يسقط (مثل mergeEvent في الويب). */
    fun merge(old: JSONObject?, next: JSONObject): JSONObject {
        if (old == null) return next
        val sources = JSONArray(); val seen = HashSet<String>()
        for (list in listOf(old.optJSONArray("sources"), next.optJSONArray("sources"))) for (i in 0 until (list?.length() ?: 0)) {
            val s = list!!.optJSONObject(i) ?: continue; if (seen.add(s.optString("s"))) sources.put(s)
        }
        fun pick(k: String) = if (old.has(k) && !old.isNull(k)) old.get(k) else next.opt(k) ?: JSONObject.NULL
        return JSONObject(old.toString()).apply {
            put("title", old.optString("title").ifEmpty { next.optString("title") })
            put("cover", pick("cover")); put("publishedAt", pick("publishedAt"))
            put("at", minOf(old.getLong("at"), next.getLong("at")))
            put("firstSeenAt", minOf(old.getLong("firstSeenAt"), next.getLong("firstSeenAt")))
            put("observedAdvance", old.optBoolean("observedAdvance") || next.optBoolean("observedAdvance"))
            put("sources", sources); put("pinned", old.optBoolean("pinned") || next.optBoolean("pinned"))
            put("origin", old.optString("origin", "local")); put("updatedAt", maxOf(old.optLong("updatedAt"), next.optLong("updatedAt")))
        }
    }

    fun parseJson(text: String?): Any = try { if (text == null) JSONObject.NULL else org.json.JSONTokener(text).nextValue() } catch (_: Exception) { JSONObject.NULL }
    fun toJson(v: Any?): String = when (v) { null, JSONObject.NULL -> "null"; is String -> JSONObject.quote(v); else -> v.toString() }
}
