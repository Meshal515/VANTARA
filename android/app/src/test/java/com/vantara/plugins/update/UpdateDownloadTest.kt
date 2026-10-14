package com.vantara.plugins.update

import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.nio.file.Files
import java.security.MessageDigest
import org.junit.Assert.*
import org.junit.Test

class UpdateDownloadTest {
    private fun hash(data: ByteArray) = MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { "%02x".format(it) }
    private fun withFile(test: (File) -> Unit) {
        val dir = Files.createTempDirectory("vantara-update-test").toFile()
        try { test(File(dir, "VANTARA.apk")) } finally { dir.deleteRecursively() }
    }
    private fun fails(test: () -> Unit) {
        try { test(); fail("transfer should fail") } catch (_: IllegalArgumentException) {} catch (_: IOException) {}
    }
    @Test fun completeDownloadIsVerifiedAndPromoted() = withFile { out ->
        out.writeText("old")
        val bytes = "verified apk".toByteArray()
        UpdateDownload.write(ByteArrayInputStream(bytes), out, hash(bytes), bytes.size.toLong(), 100, bytes.size.toLong(), { Long.MAX_VALUE })
        assertArrayEquals(bytes, out.readBytes())
        assertEquals(listOf(out.name), out.parentFile!!.listFiles()!!.map { it.name })
    }
    @Test fun interruptedAndCorruptTransfersPreserveExistingFileAndCleanPartials() = withFile { out ->
        out.writeText("old verified file")
        val bytes = "new apk".toByteArray()
        for (input in listOf<InputStream>(ByteArrayInputStream(bytes), object : InputStream() { override fun read(): Int = throw IOException("offline") })) {
            fails { UpdateDownload.write(input, out, "0".repeat(64), bytes.size.toLong(), 100, freeBytes = { Long.MAX_VALUE }) }
            assertEquals("old verified file", out.readText())
            assertEquals(listOf(out.name), out.parentFile!!.listFiles()!!.map { it.name })
        }
    }
    @Test fun truncatedOversizedAndLowStorageTransfersAreRejected() = withFile { out ->
        out.writeText("keep")
        val bytes = "abcdef".toByteArray()
        fails { UpdateDownload.write(ByteArrayInputStream(bytes), out, hash(bytes), 9, 100, freeBytes = { Long.MAX_VALUE }) }
        fails { UpdateDownload.write(ByteArrayInputStream(bytes), out, hash(bytes), -1, 5, freeBytes = { Long.MAX_VALUE }) }
        fails { UpdateDownload.write(ByteArrayInputStream(bytes), out, hash(bytes), 6, 100, freeBytes = { 0 }) }
        fails { UpdateDownload.write(ByteArrayInputStream(bytes), out, hash(bytes), 6, 100, 8, { Long.MAX_VALUE }) }
        assertEquals("keep", out.readText())
        assertEquals(listOf(out.name), out.parentFile!!.listFiles()!!.map { it.name })
    }
}
