package com.vantara.plugins

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.vantara.app.BuildConfig
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

@CapacitorPlugin(name = "LocalDiscovery")
class LocalDiscoveryPlugin : Plugin() {
    private val executor = Executors.newSingleThreadExecutor()
    private val storage by lazy { DiscoveryDatabase(context.applicationContext) }

    @PluginMethod
    fun request(call: PluginCall) {
        if (BuildConfig.APPLICATION_ID != "com.vantara.app.local") {
            call.reject("Local discovery is unavailable in this build", "discovery_disabled")
            return
        }
        executor.execute {
            try { call.resolve(storage.request(call.data)) }
            catch (error: Exception) {
                call.reject("Local discovery storage failed", "discovery_storage_error", error)
            }
        }
    }

    override fun handleOnDestroy() {
        if (BuildConfig.APPLICATION_ID == "com.vantara.app.local") executor.execute { storage.close() }
        executor.shutdown()
        super.handleOnDestroy()
    }
}

private class DiscoveryDatabase(context: Context) : SQLiteOpenHelper(context, "vantara-local-discovery.sqlite", null, 1) {
    init { setWriteAheadLoggingEnabled(true) }

    override fun onConfigure(db: SQLiteDatabase) {
        db.execSQL("PRAGMA synchronous=FULL")
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
        error("Unsupported Local discovery schema upgrade")
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
        val limit = input.optInt("limit", 40).coerceIn(1, 101).toString()
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
