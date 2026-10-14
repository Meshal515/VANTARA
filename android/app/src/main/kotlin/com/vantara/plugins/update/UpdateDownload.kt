package com.vantara.plugins.update

import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest

/** A failed or interrupted transfer never replaces an already verified file. */
object UpdateDownload {
    const val RESERVE_BYTES = 16L * 1024 * 1024

    fun write(input: InputStream, out: File, sha256: String, contentLength: Long, maxBytes: Long,
              expectedSize: Long = -1, freeBytes: () -> Long = { out.parentFile!!.usableSpace },
              progress: (Long, Long) -> Unit = { _, _ -> }) {
        require(Regex("[a-f0-9]{64}").matches(sha256)) { "sha256 required" }
        require(maxBytes > 0 && contentLength <= maxBytes && expectedSize <= maxBytes) { "update too large" }
        require(expectedSize < 0 || contentLength < 0 || expectedSize == contentLength) { "update size mismatch" }
        require(out.parentFile!!.isDirectory || out.parentFile!!.mkdirs()) { "update directory unavailable" }
        val needed = if (expectedSize >= 0) expectedSize else contentLength.coerceAtLeast(0)
        require(freeBytes() >= needed + RESERVE_BYTES) { "insufficient update storage" }
        val partial = File.createTempFile(out.name + "-", ".partial", out.parentFile)
        try {
            val digest = MessageDigest.getInstance("SHA-256")
            var received = 0L
            FileOutputStream(partial).use { sink ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (count == 0) continue
                    received += count
                    require(received <= maxBytes && (expectedSize < 0 || received <= expectedSize)) { "update too large" }
                    require(freeBytes() >= count + RESERVE_BYTES) { "insufficient update storage" }
                    sink.write(buffer, 0, count)
                    digest.update(buffer, 0, count)
                    progress(received, if (expectedSize >= 0) expectedSize else contentLength)
                }
                sink.fd.sync()
            }
            require(contentLength < 0 || received == contentLength) { "incomplete update" }
            require(expectedSize < 0 || received == expectedSize) { "update size mismatch" }
            require(received > 0) { "empty update" }
            val actual = digest.digest().joinToString("") { "%02x".format(it) }
            require(actual == sha256) { "sha256 mismatch" }
            // Android 26+ and the JVM both expose rename within the same directory.
            Files.move(partial.toPath(), out.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } finally {
            partial.delete()
        }
    }
}
