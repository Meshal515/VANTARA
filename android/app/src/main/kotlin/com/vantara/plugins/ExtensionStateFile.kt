package com.vantara.plugins

import java.io.File
import java.io.FileOutputStream
import java.io.IOException

/**
 * Crash-recoverable, Android/JVM-compatible state storage.
 * A validated previous state is never erased before a replacement is durable.
 * Incomplete writes leave a recoverable .bak file; no silent empty-state fallback.
 */
internal class ExtensionStateFile(private val file: File) {
    private val backup = File(file.path + ".bak")
    private val staged = File(file.path + ".new")

    fun <T> read(default: T, decode: (String) -> T): T {
        if (!file.exists() && !backup.exists()) return default
        val candidate = if (file.exists()) file else backup
        try {
            val loaded = decode(candidate.readText(Charsets.UTF_8))
            if (candidate == backup && !backup.renameTo(file)) {
                throw IOException("EXTENSION_STATE_RESTORE_FAILED")
            }
            if (candidate == file) backup.delete()
            return loaded
        } catch (error: Throwable) {
            if (candidate == file && backup.exists()) {
                try {
                    val previous = decode(backup.readText(Charsets.UTF_8))
                    if (file.exists() && !file.delete()) throw IOException("EXTENSION_STATE_RESTORE_FAILED")
                    if (!backup.renameTo(file)) throw IOException("EXTENSION_STATE_RESTORE_FAILED")
                    return previous
                } catch (recovery: Throwable) {
                    throw IllegalStateException("EXTENSION_STATE_UNRECOVERABLE", recovery)
                }
            }
            throw IllegalStateException("EXTENSION_STATE_CORRUPTED", error)
        }
    }

    /**
     * ES1: الملف ونسخته تالفان معًا فلا يُقرأ أيهما. كان الاستثناء يُسقط التطبيق عند كل إقلاع. يُنقلان جانبًا باسم
     * `.corrupt-<وقت>` (لا يُحذفان: للاستعادة والتشخيص)، والإقلاع يكمل بحالة فارغة مع إعلام المستخدم. يعيد مسار النسخة.
     */
    fun quarantine(now: Long = System.currentTimeMillis()): File? {
        var kept: File? = null
        for (source in listOf(file, backup, staged)) {
            if (!source.exists()) continue
            val target = File("${source.path}.corrupt-$now")
            if (source.renameTo(target) || runCatching { source.copyTo(target, overwrite = true); source.delete() }.getOrDefault(false)) {
                if (source == file || kept == null) kept = target
            }
        }
        return kept
    }

    fun write(text: String) {
        file.parentFile?.mkdirs()
        try {
            FileOutputStream(staged).use { output ->
                output.write(text.toByteArray(Charsets.UTF_8))
                output.fd.sync()
            }
            if (file.exists()) {
                if (backup.exists() && !backup.delete()) throw IOException("EXTENSION_STATE_BACKUP_FAILED")
                if (!file.renameTo(backup)) throw IOException("EXTENSION_STATE_BACKUP_FAILED")
            }
            if (!staged.renameTo(file)) {
                if (!file.exists() && backup.exists()) backup.renameTo(file)
                throw IOException("EXTENSION_STATE_COMMIT_FAILED")
            }
            backup.delete()
        } finally {
            if (staged.exists()) staged.delete()
        }
    }
}
