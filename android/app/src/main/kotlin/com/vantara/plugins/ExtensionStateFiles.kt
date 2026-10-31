package com.vantara.plugins

import android.util.AtomicFile
import java.io.File

/**
 * Shared durability contract for manga and Aniyomi extension manifests.
 *
 * Missing on first install is empty; corrupt or unreadable existing state is
 * never silently replaced with an empty manifest. AtomicFile restores its
 * previous snapshot if a process crashes during a write.
 */
internal fun readExtensionState(file: File): String? {
    val backup = File(file.path + ".bak")
    if (!file.exists() && !backup.exists()) return null
    return try {
        String(AtomicFile(file).readFully(), Charsets.UTF_8)
    } catch (error: Exception) {
        throw IllegalStateException("EXTENSION_STATE_UNREADABLE: ${file.name}", error)
    }
}

internal fun writeExtensionState(file: File, content: String) {
    file.parentFile?.mkdirs()
    val atomic = AtomicFile(file)
    val output = atomic.startWrite()
    try {
        output.write(content.toByteArray(Charsets.UTF_8))
        atomic.finishWrite(output)
    } catch (error: Throwable) {
        atomic.failWrite(output)
        throw error
    }
}
