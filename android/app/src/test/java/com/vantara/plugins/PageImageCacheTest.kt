package com.vantara.plugins

import java.io.ByteArrayInputStream
import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

class PageImageCacheTest {
    private fun file(dir: File, digit: Char) = File(dir, digit.toString().repeat(64) + ".jpg")
    private fun fixture(test: (File) -> Unit) {
        val dir = Files.createTempDirectory("vantara-page-cache-test").toFile()
        try { test(dir) } finally { dir.deleteRecursively() }
    }
    private fun fails(test: () -> Unit) {
        try { test(); fail("must reject") } catch (_: IllegalArgumentException) {}
    }
    @Test fun evictsOnlyOldCacheImagesAndKeepsSelectedChapter() = fixture { dir ->
        val active=file(dir,'a').apply { writeBytes(ByteArray(4));setLastModified(1) }
        val old=file(dir,'b').apply { writeBytes(ByteArray(4));setLastModified(2) }
        val user=File(dir,"user-download.jpg").apply { writeBytes(ByteArray(20)) }
        val next=file(dir,'c')
        val cache=PageImageCache(dir,8,freeBytes={Long.MAX_VALUE})
        cache.selectChapter("selected",setOf("a".repeat(64)))
        cache.write(next,ByteArray(4))
        assertTrue(active.exists()); assertFalse(old.exists()); assertTrue(user.exists()); assertTrue(next.exists())
    }
    @Test fun recentlyServedAndProtectedImagesSurviveQuotaFailure() = fixture { dir ->
        val active=file(dir,'a').apply { writeText("keep") }
        val cache=PageImageCache(dir,4,freeBytes={Long.MAX_VALUE})
        cache.touch(active)
        fails { cache.write(file(dir,'b'),ByteArray(4)) }
        assertEquals("keep",active.readText())
        assertEquals(1,dir.listFiles()!!.size)
        val low=PageImageCache(dir,100,freeBytes={0})
        low.selectChapter("active",setOf("a".repeat(64)))
        fails { low.write(file(dir,'b'),ByteArray(4)) }
        assertTrue(active.exists())
    }
    @Test fun boundsChunkedImagesAndRejectsPathsOutsideCache() = fixture { dir ->
        fails { PageImageCache.read(ByteArrayInputStream(ByteArray(6)), -1,5) }
        fails { PageImageCache.read(ByteArrayInputStream(ByteArray(0)), 6,5) }
        assertArrayEquals(ByteArray(4),PageImageCache.read(ByteArrayInputStream(ByteArray(4)),4,5))
        fails { PageImageCache(dir).write(File(dir,"../escape.jpg"),ByteArray(4)) }
    }
}
