package com.vantara.plugins

import android.util.AtomicFile
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/** Independent of WebView/localStorage/IndexedDB quotas. AtomicFile retains the
 * previous complete copy if writing or syncing its replacement fails. No API
 * clears these files on a browser quota error, logout, or an APK update. */
@CapacitorPlugin(name = "AccountBackup")
class AccountBackupPlugin : Plugin() {
    private val lock = Any()

    private fun file(call: PluginCall): AtomicFile {
        val userId = call.getString("userId") ?: error("missing account")
        require(userId.matches(Regex("[A-Za-z0-9_-]{1,80}"))) { "invalid account" }
        val kind = call.getString("kind")
        require(kind == "snapshot" || kind == "queue") { "invalid backup kind" }
        val directory = File(context.noBackupFilesDir, "account-recovery")
        check(directory.isDirectory || directory.mkdirs()) { "backup directory unavailable" }
        return AtomicFile(File(directory, "$userId.$kind.json"))
    }

    @PluginMethod
    fun read(call: PluginCall) {
        synchronized(lock) {
            try {
                val backup = file(call)
                val result = JSObject()
                if (backup.baseFile.exists() || File(backup.baseFile.path + ".bak").exists()) {
                    val value = String(backup.readFully(), Charsets.UTF_8)
                    require(JSONObject(value).optString("userId") == call.getString("userId")) { "backup account mismatch" }
                    result.put("value", value)
                }
                call.resolve(result)
            } catch (error: Exception) {
                call.reject("account backup read failed", error)
            }
        }
    }

    @PluginMethod
    fun write(call: PluginCall) {
        synchronized(lock) {
            var backup: AtomicFile? = null
            var output: FileOutputStream? = null
            try {
                val value = call.getString("value") ?: error("missing backup")
                require(JSONObject(value).optString("userId") == call.getString("userId")) { "backup account mismatch" }
                backup = file(call)
                output = backup.startWrite()
                output.write(value.toByteArray(Charsets.UTF_8))
                backup.finishWrite(output)
                call.resolve()
            } catch (error: Exception) {
                if (output != null) backup?.failWrite(output)
                call.reject("account backup write failed", error)
            }
        }
    }
}
