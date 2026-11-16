package com.vantara.plugins

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** التسقيف والتفريغ في إدارة المساحة: الأقدم يُحذف أولًا، والمحفوظ عمدًا (حالة DHT) يبقى. */
class StoragePluginTest {
    @get:Rule val tmp = TemporaryFolder()

    private fun file(dir: File, name: String, bytes: Int, at: Long) = File(dir, name).apply { writeBytes(ByteArray(bytes)); setLastModified(at) }

    @Test
    fun `page cache cap keeps the most recently used and drops the oldest`() {
        val dir = tmp.newFolder("pages")
        val old = file(dir, "old.jpg", 400, 1_000_000L)
        val mid = file(dir, "mid.jpg", 400, 2_000_000L)
        val new = file(dir, "new.jpg", 400, 3_000_000L)
        val freed = StoragePlugin.capDir(dir, 900)
        assertEquals(400L, freed)
        assertFalse(old.exists())
        assertTrue(mid.exists() && new.exists())
    }

    @Test
    fun `clearing torrent leftovers keeps the dht state and the folder itself`() {
        val dir = tmp.newFolder("torrent-streams")
        val hash = File(dir, "abc/payload").apply { mkdirs() }
        file(hash, "ep.mkv", 2048, 1L)
        val dht = file(dir, "dht.state", 64, 1L)
        val freed = StoragePlugin.clearDir(dir, keep = setOf("dht.state"))
        assertEquals(2048L, freed)
        assertTrue(dir.isDirectory && dht.exists())
        assertFalse(File(dir, "abc").exists())
    }

    @Test
    fun `size of a missing folder is zero, not an error`() {
        assertEquals(0L, StoragePlugin.sizeOf(File(tmp.root, "nope")))
    }
}
