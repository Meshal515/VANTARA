package com.vantara.plugins

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NativeIconCacheTest {
    @Test fun reusesIconsAndMissingIconsWithoutReopeningTheArchive() {
        val cache = NativeIconCache(maxEntries = 3, maxChars = 20)
        var reads = 0
        assertEquals("png", cache.getOrPut("a") { reads++; "png" })
        assertEquals("png", cache.getOrPut("a") { error("cached") })
        assertNull(cache.getOrPut("missing") { reads++; null })
        assertNull(cache.getOrPut("missing") { error("negative cached") })
        assertEquals(2, reads)
    }

    @Test fun evictsLeastRecentlyUsedEntriesByCountAndCharacterBudget() {
        val cache = NativeIconCache(maxEntries = 2, maxChars = 6)
        cache.getOrPut("a") { "aaa" }
        cache.getOrPut("b") { "bbb" }
        cache.getOrPut("a") { error("cached") }
        cache.getOrPut("c") { "ccc" }
        assertEquals("new", cache.getOrPut("b") { "new" })
        val budget = NativeIconCache(maxEntries = 10, maxChars = 5)
        budget.getOrPut("a") { "aaaa" }
        budget.getOrPut("b") { "bb" }
        assertEquals("fresh", budget.getOrPut("a") { "fresh" })
    }

    @Test fun rejectsOversizedPayloadsAndUsesArchiveIdentityForUpdates() {
        val cache = NativeIconCache(maxEntries = 3, maxChars = 5)
        assertNull(cache.getOrPut("huge") { "123456" })
        assertNull(cache.getOrPut("huge") { error("oversize is negative cached") })
        assertEquals("old", cache.getOrPut("pkg:old-sha") { "old" })
        assertEquals("new", cache.getOrPut("pkg:new-sha") { "new" })
    }
}
