package com.vantara.plugins

import java.io.ByteArrayInputStream
import java.nio.file.Files
import java.security.MessageDigest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeIconArchiveTest {
    private fun sha(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes)
        .joinToString("") { "%02x".format(it) }

    @Test fun centersIconsWithoutStretchingWideOrTallArtwork() {
        assertArrayEquals(intArrayOf(0, 0, 96, 96), NativeIconBounds.fit(48, 48, 96))
        assertArrayEquals(intArrayOf(0, 24, 96, 72), NativeIconBounds.fit(200, 100, 96))
        assertArrayEquals(intArrayOf(24, 0, 72, 96), NativeIconBounds.fit(100, 200, 96))
        assertArrayEquals(intArrayOf(0, 0, 96, 96), NativeIconBounds.fit(-1, -1, 96))
    }

    @Test fun stagesOnlyPinnedBytesInItsOwnTemporaryDirectory() {
        val root = Files.createTempDirectory("native-icon-test").toFile()
        try {
            val userApk = root.resolve("extensions/user.apk").apply { parentFile!!.mkdirs(); writeText("keep user APK") }
            val bytes = "bundled APK fixture".toByteArray()
            val staged = NativeIconArchive.stage(root.resolve("icon-cache"), sha(bytes), 64) { ByteArrayInputStream(bytes) }
            assertTrue(staged != null && staged.isFile)
            assertEquals(root.resolve("icon-cache").canonicalFile, staged!!.parentFile!!.canonicalFile)
            assertArrayEquals(bytes, staged.readBytes())
            assertEquals("keep user APK", userApk.readText())
            staged.delete()
            assertTrue(root.resolve("icon-cache").listFiles().orEmpty().isEmpty())
        } finally { root.deleteRecursively() }
    }

    @Test fun rejectsWrongPinsAndOversizedAssetsWithoutLeavingCopies() {
        val dir = Files.createTempDirectory("native-icon-test").toFile()
        try {
            val bytes = ByteArray(65) { 7 }
            assertNull(NativeIconArchive.stage(dir, "0".repeat(64), 128) { ByteArrayInputStream(bytes) })
            assertNull(NativeIconArchive.stage(dir, sha(bytes), 64) { ByteArrayInputStream(bytes) })
            assertNull(NativeIconArchive.stage(dir, sha(byteArrayOf()), 64) { ByteArrayInputStream(byteArrayOf()) })
            assertTrue(dir.listFiles().orEmpty().isEmpty())
        } finally { dir.deleteRecursively() }
    }

    @Test fun closesStreamsAndRemovesPartialFilesWhenAnAssetReadFails() {
        val dir = Files.createTempDirectory("native-icon-test").toFile()
        var closed = false
        try {
            val input = object : ByteArrayInputStream(ByteArray(8)) {
                override fun read(buffer: ByteArray, offset: Int, length: Int): Int = error("asset read failed")
                override fun close() { closed = true; super.close() }
            }
            assertNull(NativeIconArchive.stage(dir, "0".repeat(64), 64) { input })
            assertTrue(closed)
            assertTrue(dir.listFiles().orEmpty().isEmpty())
        } finally { dir.deleteRecursively() }
    }
}
