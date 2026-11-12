package com.vantara.plugins

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.util.Base64

class NativeIconPngStoreTest {
    private val png = Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6YQAAAAASUVORK5CYII=")

    @Test fun verifiedImageCacheSurvivesProcessStyleReopenAndSeparatesArchiveIdentities() {
        val directory = Files.createTempDirectory("native-icons").toFile()
        try {
            NativeIconPngStore(directory).write("extensions:example.pkg:sha-old", png)
            val reopened = NativeIconPngStore(directory)
            assertArrayEquals(png, reopened.read("extensions:example.pkg:sha-old"))
            assertNull(reopened.read("extensions:example.pkg:sha-new"))
            assertNull(reopened.read("anime-extensions:example.pkg:sha-old"))
        } finally { directory.deleteRecursively() }
    }

    @Test fun cacheBoundsDiskGrowthAndRejectsInvalidImageDimensionsAndLargePayloads() {
        val directory = Files.createTempDirectory("native-icons").toFile()
        try {
            val store = NativeIconPngStore(directory, maxEntries = 2, maxBytes = png.size.toLong() * 2)
            store.write("a", png)
            directory.listFiles()!!.single().setLastModified(1)
            store.write("b", png)
            store.write("c", png)
            assertNull(store.read("a"))
            assertEquals(2, directory.listFiles()!!.size)
            val hugeDimensions = png.copyOf().apply { this[16] = 0x7f }
            store.write("huge-dimensions", hugeDimensions)
            store.write("oversized", ByteArray(65537))
            store.write("wrong-type", "<svg/>".toByteArray())
            assertNull(store.read("huge-dimensions"))
            assertNull(store.read("oversized"))
            assertNull(store.read("wrong-type"))
            assertTrue(directory.listFiles()!!.all { it.name.matches(Regex("[a-f0-9]{64}\\.png")) })
            // On-disk corruption must not reach the WebView, even after a process restart.
            val file = directory.listFiles()!!.first()
            file.writeText("not a PNG")
            assertTrue(listOf("b", "c").any { NativeIconPngStore(directory).read(it) == null })
        } finally { directory.deleteRecursively() }
    }

    @Test fun filesystemKeysNeverBecomePaths() {
        val directory = Files.createTempDirectory("native-icons").toFile()
        try {
            NativeIconPngStore(directory).write("../../outside", png)
            assertArrayEquals(png, NativeIconPngStore(directory).read("../../outside"))
            assertEquals(directory.canonicalFile, directory.listFiles()!!.single().parentFile.canonicalFile)
        } finally { directory.deleteRecursively() }
    }
}
