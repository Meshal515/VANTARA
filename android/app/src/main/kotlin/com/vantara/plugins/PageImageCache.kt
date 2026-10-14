package com.vantara.plugins

import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/** Only evicts reproducible page images in this app-private cache, never user downloads. */
class PageImageCache(private val directory: File, private val maxBytes: Long = 512L * 1024 * 1024,
                     private val now: () -> Long = System::currentTimeMillis,
                     private val freeBytes: () -> Long = { directory.usableSpace }) {
    private val chapters = linkedMapOf<String, Set<String>>()
    private val servingUntil = mutableMapOf<String, Long>()
    private val cachedName = Regex("[a-f0-9]{64}[.](jpg|png|webp|gif|avif)")

    @Synchronized fun selectChapter(key: String, digests: Set<String>) {
        chapters.remove(key)
        chapters[key] = digests
        while (chapters.size > 2) chapters.remove(chapters.keys.first())
    }

    @Synchronized fun find(digest: String, minBytes: Long): File? {
        for (extension in listOf("jpg", "png", "webp", "gif", "avif")) {
            val file = File(directory, "$digest.$extension")
            if (file.isFile && file.length() in (minBytes + 1)..MAX_IMAGE_BYTES.toLong()) {
                touch(file)
                return file
            }
        }
        return null
    }

    @Synchronized fun touch(file: File) {
        servingUntil[file.name] = now() + 10 * 60 * 1000L
        file.setLastModified(now())
    }

    @Synchronized fun write(file: File, bytes: ByteArray) {
        require(file.parentFile!!.canonicalFile == directory.canonicalFile && cachedName.matches(file.name)) { "unsafe image cache path" }
        require(bytes.isNotEmpty() && bytes.size <= MAX_IMAGE_BYTES) { "image too large" }
        require(directory.isDirectory || directory.mkdirs()) { "image cache unavailable" }
        servingUntil.entries.removeAll { it.value <= now() }
        val protected = chapters.values.flatten().toSet()
        val files = directory.listFiles()?.filter { it.isFile && cachedName.matches(it.name) }.orEmpty()
        var total = files.sumOf { it.length() } - if (file.isFile) file.length() else 0L
        for (old in files.sortedBy { it.lastModified() }) {
            if (total + bytes.size <= maxBytes && freeBytes() >= bytes.size + RESERVE_BYTES) break
            if (old == file || old.name in servingUntil || old.name.substringBefore('.') in protected) continue
            val size = old.length()
            if (old.delete()) total -= size
        }
        require(total + bytes.size <= maxBytes && freeBytes() >= bytes.size + RESERVE_BYTES) { "insufficient image cache space; current chapter is protected" }
        val partial = File.createTempFile(file.name + "-", ".part", directory)
        try {
            partial.writeBytes(bytes)
            Files.move(partial.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            touch(file)
        } finally { partial.delete() }
    }

    companion object {
        const val MAX_IMAGE_BYTES = 64 * 1024 * 1024
        private const val RESERVE_BYTES = 16L * 1024 * 1024

        /** Bound both advertised length and chunked/decompressed responses before allocating. */
        fun read(input: InputStream, contentLength: Long, maxBytes: Int = MAX_IMAGE_BYTES): ByteArray {
            require(contentLength <= maxBytes) { "image too large" }
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                require(output.size().toLong() + count <= maxBytes) { "image too large" }
                output.write(buffer, 0, count)
            }
            return output.toByteArray()
        }
    }
}
