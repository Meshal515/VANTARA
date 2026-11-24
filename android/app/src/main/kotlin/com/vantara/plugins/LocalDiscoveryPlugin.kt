package com.vantara.plugins

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import android.database.sqlite.SQLiteOpenHelper
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.vantara.app.BuildConfig
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.net.URI
import java.net.URISyntaxException
import java.net.URLDecoder
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.Semaphore

// Keep these bridge limits in sync with desktop's discovery-store.cjs.
private const val MAX_REQUESTS = 8
private const val MAX_BATCH = 256
private const val MAX_REQUEST_BYTES = 1024 * 1024
private const val MAX_ROW_BYTES = 32 * 1024
private const val MAX_ID = 8192
private const val MAX_TITLE = 1024
private const val MAX_SOURCE_ID = 512
private const val MAX_URL = 2048
private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
private val sections = setOf("manga", "anime", "cinema")
private val kinds = setOf("chapter", "episode", "movie")
private val sourceFields = setOf("s", "u", "t", "c")
// Keep the public reference rules in sync with web's discovery-store.js.
private val publicQuery = setOf("id", "work_id", "manga_id", "series_id", "slug", "manga", "series", "story", "w", "h", "width", "height", "format")
private val publicQueryValue = Regex("[a-zA-Z0-9_.-]{1,80}")
private val rowFields = setOf("id", "work", "section", "title", "firstSeenAt", "lastCheckedAt")
private val editionFields = rowFields + setOf("sourceId", "source", "lastChapterCheckAt", "baselines")
private val eventFields = rowFields + setOf("kind", "number", "season", "cover", "sources", "at", "publishedAt", "updatedAt")

private class DiscoveryInputException(val code: String) : IllegalArgumentException()

private fun requireInput(valid: Boolean) {
    if (!valid) throw DiscoveryInputException("invalid_discovery_request")
}

private fun requireSize(valid: Boolean) {
    if (!valid) throw DiscoveryInputException("discovery_request_too_large")
}

private fun shape(value: JSONObject, required: Set<String>, optional: Set<String> = emptySet()) {
    requireInput(value.length() <= required.size + optional.size && required.all(value::has) &&
        value.keys().asSequence().all { it in required || it in optional })
}

private fun array(value: Any?, maxLength: Int): JSONArray {
    val rows = value as? JSONArray ?: throw DiscoveryInputException("invalid_discovery_request")
    requireSize(rows.length() <= maxLength)
    return rows
}

private fun integer(value: Any?, min: Long = 0, max: Long = MAX_SAFE_INTEGER) {
    val number = (value as? Number)?.toDouble()
    requireInput(number != null && number >= min && number <= max && number % 1 == 0.0)
}

private fun unit(value: Any?) {
    val number = (value as? Number)?.toDouble()
    requireInput(number != null && number in 0.0..100_000.0)
}

private fun text(value: Any?, max: Int, min: Int = 1): String {
    val string = value as? String ?: throw DiscoveryInputException("invalid_discovery_request")
    requireInput(string.length in min..max && '\u0000' !in string)
    return string
}

private fun validateRow(row: JSONObject, isEdition: Boolean) {
    shape(row, if (isEdition) editionFields else eventFields)

    // Bound the work needed to serialize each row before measuring its exact size.
    var textLength = 0
    fun rowText(value: Any?, max: Int, min: Int = 1) {
        textLength += text(value, max, min).length
        requireSize(textLength <= MAX_ROW_BYTES)
    }
    fun reference(value: Any?) {
        rowText(value, MAX_URL)
        requireInput(isPublicReference(value))
    }
    fun source(value: Any?) {
        val entry = value as? JSONObject ?: throw DiscoveryInputException("invalid_discovery_request")
        shape(entry, emptySet(), sourceFields)
        if (entry.has("s")) rowText(entry.opt("s"), MAX_SOURCE_ID, 0)
        if (entry.has("u")) reference(entry.opt("u"))
        if (entry.has("t")) rowText(entry.opt("t"), MAX_TITLE, 0)
        if (entry.has("c")) requireInput(entry.opt("c") is Boolean)
    }

    rowText(row.opt("id"), MAX_ID)
    rowText(row.opt("work"), MAX_TITLE)
    rowText(row.opt("title"), MAX_TITLE)
    requireInput((row.opt("section") as? String) in sections)
    integer(row.opt("firstSeenAt"))
    integer(row.opt("lastCheckedAt"))
    if (isEdition) {
        rowText(row.opt("sourceId"), MAX_SOURCE_ID, 0)
        source(row.opt("source"))
        integer(row.opt("lastChapterCheckAt"))
        val baselines = array(row.opt("baselines"), 512)
        for (index in 0 until baselines.length()) {
            val pair = array(baselines.opt(index), 2)
            requireInput(pair.length() == 2)
            integer(pair.opt(0))
            unit(pair.opt(1))
        }
    } else {
        requireInput((row.opt("kind") as? String) in kinds)
        unit(row.opt("number"))
        row.opt("season").takeUnless { it === JSONObject.NULL }?.let { integer(it, 1) }
        row.opt("cover").takeUnless { it === JSONObject.NULL }?.let { reference(it) }
        integer(row.opt("at"))
        row.opt("publishedAt").takeUnless { it === JSONObject.NULL }?.let { integer(it) }
        integer(row.opt("updatedAt"))
        val sources = array(row.opt("sources"), 64)
        for (index in 0 until sources.length()) source(sources.opt(index))
    }
}

private fun validateRequest(input: JSONObject) {
    when (val action = input.opt("action")) {
        "snapshot", "commit" -> {
            val commit = action == "commit"
            val fields = setOf("action", "editions", "events")
            shape(input, if (commit) fields + "rev" else fields)
            if (commit) integer(input.opt("rev"))
            val editions = array(input.opt("editions"), MAX_BATCH)
            val events = array(input.opt("events"), MAX_BATCH)
            requireSize(editions.length() + events.length() <= MAX_BATCH)
            val envelope = JSONObject().put("action", action).put("editions", JSONArray()).put("events", JSONArray())
            if (commit) envelope.put("rev", input.opt("rev"))
            var bytes = envelope.toString().toByteArray(Charsets.UTF_8).size
            for ((rows, isEdition) in listOf(editions to true, events to false)) {
                if (rows.length() > 0) bytes--
                for (index in 0 until rows.length()) {
                    val row = rows.opt(index)
                    val serialized = if (commit) {
                        val entry = row as? JSONObject ?: throw DiscoveryInputException("invalid_discovery_request")
                        validateRow(entry, isEdition)
                        entry.toString()
                    } else JSONObject.quote(text(row, MAX_ID))
                    val rowBytes = serialized.toByteArray(Charsets.UTF_8).size
                    if (commit) requireSize(rowBytes <= MAX_ROW_BYTES)
                    bytes += rowBytes + 1
                    requireSize(bytes <= MAX_REQUEST_BYTES)
                }
            }
        }
        "timeline" -> {
            shape(input, setOf("action", "section"), setOf("cursor", "limit"))
            requireInput((input.opt("section") as? String) in sections)
            if (input.has("cursor") && !input.isNull("cursor")) {
                val cursor = input.optJSONArray("cursor")
                requireInput(cursor?.length() == 2)
                // Legacy payload times may be fractional. SQLite indexed their integer part.
                val at = (cursor?.opt(0) as? Number)?.toDouble()
                requireInput(at != null && at >= 0 && at <= MAX_SAFE_INTEGER)
                text(cursor?.opt(1), MAX_ID)
            }
            if (input.has("limit")) integer(input.opt("limit"), 1, 101)
        }
        "known" -> {
            shape(input, setOf("action", "sourceId"), setOf("limit"))
            text(input.opt("sourceId"), MAX_SOURCE_ID, 0)
            if (input.has("limit")) integer(input.opt("limit"), 1, 101)
        }
        else -> requireInput(false)
    }
}

private fun isPublicReference(value: Any?): Boolean {
    val text = value as? String ?: return false
    if (text.isEmpty() || text.length > MAX_URL || text.toByteArray(Charsets.UTF_8).size > MAX_URL ||
        text.any { it <= ' ' || it == '\\' || it == '#' }) return false
    return try {
        val uri = URI(if (text.startsWith("//")) "https://${text.trimStart('/')}" else text)
        if (uri.isAbsolute && (!uri.scheme.equals("http", true) && !uri.scheme.equals("https", true) ||
                uri.rawAuthority.isNullOrEmpty())) return false
        if (uri.rawAuthority?.contains('@') == true) return false
        uri.rawQuery.orEmpty().split('&').all { field ->
            if (field.isEmpty()) return@all true
            val name = URLDecoder.decode(field.substringBefore('='), "UTF-8")
            val part = URLDecoder.decode(field.substringAfter('=', ""), "UTF-8")
            name in publicQuery && publicQueryValue.matches(part)
        }
    } catch (_: URISyntaxException) {
        false
    } catch (_: IllegalArgumentException) {
        false
    }
}

private fun scrubLegacySource(source: JSONObject?): Boolean {
    if (source == null) return false
    var changed = false
    if (source.has("m")) {
        source.remove("m")
        source.put("c", true)
        changed = true
    }
    if (source.has("u") && !isPublicReference(source.opt("u"))) {
        source.remove("u")
        changed = true
    }
    return changed
}

private fun editionIdContainsUrl(id: String, url: String): Boolean {
    if (id.contains(url)) return true
    return try { JSONArray(id).opt(2) == url }
    catch (_: JSONException) { false }
}

@CapacitorPlugin(name = "LocalDiscovery")
class LocalDiscoveryPlugin : Plugin() {
    private val executor = Executors.newSingleThreadExecutor()
    private val requestSlots = Semaphore(MAX_REQUESTS)
    private val storage = lazy { DiscoveryDatabase(context.applicationContext) }

    @PluginMethod
    fun request(call: PluginCall) {
        if (BuildConfig.APPLICATION_ID != "com.vantara.app.local") {
            call.reject("Local discovery is unavailable in this build", "discovery_disabled")
            return
        }
        if (!requestSlots.tryAcquire()) {
            call.reject("Local discovery is busy", "discovery_busy")
            return
        }
        val input = call.data
        try {
            validateRequest(input)
        } catch (error: Exception) {
            requestSlots.release()
            val code = (error as? DiscoveryInputException)?.code ?: "invalid_discovery_request"
            call.reject("Invalid local discovery request", code)
            return
        }
        try {
            synchronized(executor) {
                executor.execute {
                    try { call.resolve(storage.value.request(input)) }
                    catch (_: Exception) {
                        call.reject("Local discovery storage failed", "discovery_storage_error")
                    } finally { requestSlots.release() }
                }
            }
        } catch (_: RejectedExecutionException) {
            requestSlots.release()
            call.reject("Local discovery storage failed", "discovery_storage_error")
        }
    }

    override fun handleOnDestroy() {
        synchronized(executor) {
            if (!executor.isShutdown) {
                if (BuildConfig.APPLICATION_ID == "com.vantara.app.local") {
                    executor.execute { if (storage.isInitialized()) storage.value.close() }
                }
                executor.shutdown()
            }
        }
        super.handleOnDestroy()
    }
}

private class DiscoveryDatabase(context: Context) : SQLiteOpenHelper(context, "vantara-local-discovery.sqlite", null, 2) {
    private var migrated = false

    init { setWriteAheadLoggingEnabled(true) }

    override fun onConfigure(db: SQLiteDatabase) {
        db.execSQL("PRAGMA synchronous=FULL")
        db.rawQuery("PRAGMA secure_delete=ON", null).use { check(it.moveToFirst() && it.getInt(0) == 1) }
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE discovery_meta (id INTEGER PRIMARY KEY, rev INTEGER NOT NULL)")
        db.execSQL("INSERT INTO discovery_meta VALUES (1, 0)")
        db.execSQL("CREATE TABLE editions (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, checked_at INTEGER NOT NULL, payload TEXT NOT NULL)")
        db.execSQL("CREATE INDEX editions_source ON editions(source_id, checked_at, id)")
        db.execSQL("CREATE TABLE events (id TEXT PRIMARY KEY, section TEXT NOT NULL, at INTEGER NOT NULL, payload TEXT NOT NULL)")
        db.execSQL("CREATE INDEX events_timeline ON events(section, at DESC, id DESC)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        check(oldVersion == 1 && newVersion == 2)
        // SQLiteOpenHelper wraps this upgrade and its version change in one transaction.
        for (table in listOf("editions", "events")) {
            val edition = table == "editions"
            var after: Long? = null
            while (true) {
                val filter = if (after == null) "" else " WHERE rowid > ?"
                val args = after?.let { arrayOf(it.toString()) }
                val page = db.rawQuery("SELECT rowid,id,payload FROM $table$filter ORDER BY rowid LIMIT 32", args).use { cursor ->
                    buildList {
                        while (cursor.moveToNext()) {
                            val id = if (cursor.isNull(1)) null else cursor.getString(1)
                            add(Triple(cursor.getLong(0), id, cursor.getString(2)))
                        }
                    }
                }
                if (page.isEmpty()) break
                for ((rowId, id, payload) in page) {
                    val row = JSONObject(payload)
                    val source = if (edition) row.optJSONObject("source") else null
                    val oldUrl = source?.opt("u") as? String
                    var changed = scrubLegacySource(source)
                    if (!edition) {
                        val sources = row.optJSONArray("sources")
                        if (sources != null) for (index in 0 until sources.length()) {
                            if (scrubLegacySource(sources.optJSONObject(index))) changed = true
                        }
                        if (!row.isNull("cover") && !isPublicReference(row.opt("cover"))) {
                            row.put("cover", JSONObject.NULL)
                            changed = true
                        }
                    }
                    if (id != null && !oldUrl.isNullOrEmpty() && source?.has("u") == false &&
                        editionIdContainsUrl(id, oldUrl)) {
                        val safeId = "legacy:" + sha256Hex(id.toByteArray(Charsets.UTF_8))
                        row.put("id", safeId)
                        db.execSQL("UPDATE editions SET id=?,payload=? WHERE rowid=?", arrayOf<Any>(safeId, row.toString(), rowId))
                    } else if (changed) {
                        db.execSQL("UPDATE $table SET payload=? WHERE rowid=?", arrayOf<Any>(row.toString(), rowId))
                    }
                }
                after = page.last().first
            }
        }
        migrated = true
    }

    override fun onOpen(db: SQLiteDatabase) {
        super.onOpen(db)
        if (migrated) {
            // The upgrade has committed by this point. Readers can delay truncation.
            try { db.rawQuery("PRAGMA wal_checkpoint(TRUNCATE)", null).use { it.moveToFirst() } }
            catch (_: SQLiteException) { /* A later SQLite checkpoint can clear the WAL. */ }
            migrated = false
        }
    }

    private fun <T> transact(db: SQLiteDatabase, action: () -> T): T {
        db.beginTransactionNonExclusive()
        try {
            val result = action()
            db.setTransactionSuccessful()
            return result
        } finally { db.endTransaction() }
    }

    private fun revision(db: SQLiteDatabase): Long = db.rawQuery("SELECT rev FROM discovery_meta WHERE id=1", null).use {
        check(it.moveToFirst())
        it.getLong(0)
    }

    private fun rows(db: SQLiteDatabase, query: String, vararg params: String): JSONArray {
        val out = JSONArray()
        db.rawQuery(query, params).use { cursor ->
            while (cursor.moveToNext()) out.put(JSONObject(cursor.getString(0)))
        }
        return out
    }

    private fun selected(db: SQLiteDatabase, table: String, ids: JSONArray): JSONArray {
        val out = JSONArray()
        for (i in 0 until ids.length()) {
            db.rawQuery("SELECT payload FROM $table WHERE id=?", arrayOf(ids.getString(i))).use { cursor ->
                if (cursor.moveToFirst()) out.put(JSONObject(cursor.getString(0)))
            }
        }
        return out
    }

    fun request(input: JSONObject): JSObject {
        val db = writableDatabase
        val limit = input.optInt("limit", 40).toString()
        return when (input.getString("action")) {
            "snapshot" -> transact(db) {
                JSObject().put("rev", revision(db))
                    .put("editions", selected(db, "editions", input.getJSONArray("editions")))
                    .put("events", selected(db, "events", input.getJSONArray("events")))
            }
            "commit" -> transact(db) {
                if (revision(db) != input.getLong("rev")) return@transact JSObject().put("committed", false)
                val editions = input.getJSONArray("editions")
                for (i in 0 until editions.length()) {
                    val entry = editions.getJSONObject(i)
                    db.execSQL("INSERT OR REPLACE INTO editions VALUES (?,?,?,?)",
                        arrayOf(entry.getString("id"), entry.getString("sourceId"), entry.getLong("lastChapterCheckAt"), entry.toString()))
                }
                val events = input.getJSONArray("events")
                for (i in 0 until events.length()) {
                    val entry = events.getJSONObject(i)
                    db.execSQL("INSERT OR REPLACE INTO events VALUES (?,?,?,?)",
                        arrayOf(entry.getString("id"), entry.getString("section"), entry.getLong("at"), entry.toString()))
                }
                db.execSQL("UPDATE discovery_meta SET rev=rev+1 WHERE id=1")
                JSObject().put("committed", true)
            }
            "timeline" -> {
                val section = input.getString("section")
                val cursor = input.optJSONArray("cursor")
                val page = if (cursor == null) {
                    rows(db, "SELECT payload FROM events WHERE section=? ORDER BY at DESC,id DESC LIMIT ?", section, limit)
                } else {
                    val at = cursor.getLong(0).toString()
                    rows(db, "SELECT payload FROM events WHERE section=? AND (at,id)<(?,?) ORDER BY at DESC,id DESC LIMIT ?",
                        section, at, cursor.getString(1), limit)
                }
                JSObject().put("rows", page)
            }
            "known" -> JSObject().put("rows", rows(db,
                "SELECT payload FROM editions WHERE source_id=? ORDER BY checked_at,id LIMIT ?", input.getString("sourceId"), limit))
            else -> error("Unknown Local discovery operation")
        }
    }
}
